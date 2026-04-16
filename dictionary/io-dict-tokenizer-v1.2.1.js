/*! io-dict-tokenizer v1.2.1 — Session 51 (companion to dict v1.2.1; hotfix for false-positive place tags)
 *  Bigram-first (actually longest-match: trigram → bigram → unigram) tokenizer + matcher.
 *  Pure logic. No DOM. Node-testable.
 *
 *  Consumes an ioDict-shaped object: { lookup, isStopword, normalize }.
 *  Exact match only in v1 — no stems, no fuzzy. Designer decision 2026-04-10.
 *
 *  Output shape:
 *    {
 *      version: "1.0.0",
 *      tokens: [ { text, role, canonical, confidence, source, ambiguous?, dispatchable, roles?, modules?, depth? } ],
 *      cleanMatch: boolean,        // STRICT: every non-stopword resolved, zero ambiguity
 *      dispatchable: boolean,      // PRAGMATIC: safe to short-circuit classify-v5
 *      nonStopwordCount: number,
 *      resolved: number,
 *      unresolved: number,
 *      ambiguous: number,
 *      stripped: number            // stopword count
 *    }
 *
 *  TWO signals, by design:
 *    cleanMatch  → "tokenizer saw no conflicts whatsoever". Conservative.
 *    dispatchable → "safe to short-circuit classify-v5 using the primary role/canonical".
 *                   Loose: honours the Session 34 Task 2 finding that the consolidator's
 *                   first-in-wins ordering makes the primary r/c field authoritative when
 *                   ambiguity is cross-role (curated vs harvest) or same-role-shallow
 *                   (top-level category vs deep-leaf collision).
 *
 *  Task 4 dispatcher should use `dispatchable` as the short-circuit gate.
 *  `cleanMatch` remains available as a stricter signal for UX labelling ("100% matched")
 *  or future telemetry.
 *
 *  Per-token `dispatchable` rules (bottom-up):
 *    - unresolved → false
 *    - not ambiguous → true
 *    - ambiguous, r2 has 2+ roles (cross-role) → true (curated primary wins)
 *    - ambiguous, same-role, d ≤ 3 (shallow) → true (parent category = sane default)
 *    - ambiguous, same-role, d > 3 or missing → false (deep-leaf collision, needs context)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ioDictTokenize = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.2.1';

  // Longest n-gram window tried before falling back to unigram.
  // Covers Trade Me slugs like "0 - 50 disc" (4 tokens) and "cars and vehicles"
  // (3). Very few real slugs exceed 4 tokens, and user queries that long are
  // the classify-v5 safety net's job anyway.
  var MAX_NGRAM = 4;

  // Split query into words using dict-compatible normalization.
  // Uses dict.normalize to stay in lockstep with dictionary keys, then strips
  // user-typed punctuation (dictionary keys never contain , . ; : ! ? etc.).
  // Preserves apostrophes (hawke's bay) and hyphens (0 - 50 disc).
  function splitWords(query, dict) {
    if (query == null) return [];
    var s;
    if (dict && typeof dict.normalize === 'function') {
      s = dict.normalize(query);
    } else {
      s = String(query).toLowerCase()
        .replace(/_/g, ' ')
        .replace(/&/g, 'and')
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (!s) return [];
    // Strip punctuation that dictionary keys never contain.
    s = s.replace(/[.,;:!?()[\]{}"`]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return [];
    return s.split(' ');
  }

  // Decide whether an ambiguous entry is safe to dispatch via its primary role.
  // See header comment for the rule set.
  function isDispatchable(entry) {
    if (!entry || !entry.r) return false;
    if (!entry.a) return true;
    // Cross-role: r2 lists multiple roles → curated primary wins.
    if (entry.r2 && entry.r2.length > 1) return true;
    // Same-role shallow: d ≤ 3 means the primary canonical is a top-level category.
    if (entry.d != null && entry.d <= 3) return true;
    // Same-role deep or unknown depth → genuinely needs classify-v5.
    return false;
  }

  // Build a token from a dictionary entry.
  // v1.1.0: also surfaces `parent` so consumers can do positional inference
  // (e.g. "size 10" — "10" is preference of size IF previous token's text or
  // role aligns with one of "10"'s parent qualifiers).
  function buildToken(text, entry) {
    return {
      text: text,
      role: entry.r || null,
      canonical: (entry.c != null ? entry.c : null),
      confidence: entry.a ? 0.5 : 1.0,
      source: 'dict',
      ambiguous: !!entry.a,
      dispatchable: isDispatchable(entry),
      roles: entry.r2 || null,
      modules: entry.m || null,
      depth: (entry.d != null ? entry.d : null),
      parent: entry.parent || null
    };
  }

  function unresolvedToken(text) {
    return {
      text: text,
      role: null,
      canonical: null,
      confidence: 0,
      source: 'unresolved',
      ambiguous: false,
      dispatchable: false,
      roles: null,
      modules: null,
      depth: null
    };
  }

  function emptyResult() {
    return {
      version: VERSION,
      tokens: [],
      cleanMatch: false,
      dispatchable: false,
      nonStopwordCount: 0,
      resolved: 0,
      unresolved: 0,
      ambiguous: 0,
      stripped: 0
    };
  }

  // Core tokenize function.
  function tokenize(query, dict) {
    var out = emptyResult();

    if (!dict || typeof dict.lookup !== 'function' || typeof dict.isStopword !== 'function') {
      out.error = 'no_dict';
      return out;
    }

    var words = splitWords(query, dict);
    if (!words.length) return out;

    var n = words.length;
    var i = 0;

    while (i < n) {
      var w = words[i];

      // Multi-word phrase lookups are tried BEFORE stopword stripping.
      // This is critical for "bay of plenty" — "of" is a stopword, but the
      // whole phrase is a single dictionary key. If we stripped first we'd
      // never see the trigram.
      //
      // Longest match wins: walk from MAX_NGRAM down to 2.
      var hit = null;
      var hitText = null;
      var hitLen = 0;

      var maxK = Math.min(MAX_NGRAM, n - i);
      for (var k = maxK; k >= 2; k--) {
        var parts = words.slice(i, i + k).join(' ');
        var maybe = dict.lookup(parts);
        if (maybe) {
          hit = maybe;
          hitText = parts;
          hitLen = k;
          break;
        }
      }

      if (hit) {
        out.tokens.push(buildToken(hitText, hit));
        out.nonStopwordCount += hitLen; // count all consumed words as non-stopword for clean logic
        out.resolved++;
        if (hit.a) out.ambiguous++;
        i += hitLen;
        continue;
      }

      // Single word. Stopword? Strip.
      if (dict.isStopword(w)) {
        out.stripped++;
        i++;
        continue;
      }

      out.nonStopwordCount++;

      var uniHit = dict.lookup(w);
      if (uniHit) {
        out.tokens.push(buildToken(w, uniHit));
        out.resolved++;
        if (uniHit.a) out.ambiguous++;
      } else {
        out.tokens.push(unresolvedToken(w));
        out.unresolved++;
      }
      i++;
    }

    // cleanMatch (strict): no unresolved, no ambiguous anywhere.
    out.cleanMatch = (
      out.tokens.length > 0 &&
      out.unresolved === 0 &&
      out.ambiguous === 0
    );

    // dispatchable (pragmatic): every token is individually dispatchable.
    // Empty / stopword-only results are not dispatchable (nothing to act on).
    var allDispatchable = out.tokens.length > 0 && out.unresolved === 0;
    if (allDispatchable) {
      for (var ti = 0; ti < out.tokens.length; ti++) {
        if (!out.tokens[ti].dispatchable) { allDispatchable = false; break; }
      }
    }
    out.dispatchable = allDispatchable;

    return out;
  }

  // Public API.
  return {
    version: VERSION,
    tokenize: tokenize,
    _splitWords: splitWords
  };
}));
