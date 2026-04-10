/*! io-dict-envelope v1.0.0 — Session 34 Task 4
 *  Envelope builder + hybrid dispatcher.
 *
 *  Converts io-dict-tokenizer output into an IoQL envelope matching the shape
 *  that classify-v5 emits, so the downstream resolver/kit-runner pipeline
 *  doesn't need to know which path produced it.
 *
 *  Three layers:
 *    1. buildEnvelope(tokenResult, rawQuery) — pure function, tokens → envelope
 *    2. shouldShortCircuit(tokenResult, mode) — gate decision per flag mode
 *    3. dispatch(query, { dict, tokenize, classifyFn, mode }) — async orchestrator
 *
 *  Flag modes (window.io.flags.dictionary_dispatch_mode):
 *    - "off"              : never short-circuit, always classify-v5 (default)
 *    - "hybrid"           : if dispatchable → envelope, else → classify-v5
 *    - "hybrid_parallel"  : when dispatchable, return envelope AND kick
 *                           classify-v5 in background for telemetry only
 *
 *  IoQL 9-word schema (see Firebase /contracts/schema):
 *    place, thing, kind, price, qualifier, preference, time_range, scope, lane, raw
 *
 *  Role → field mapping (direct):
 *    place → place         kind → kind (stacks if multiple)
 *    thing → thing         lane → lane
 *    qualifier → qualifier scope → scope
 *    preference → preference
 *    time_range → time_range
 *
 *  Price is NOT set by the tokenizer — numbers need classify-v5 context
 *  (e.g., "under $500" needs comparator detection). A dispatchable envelope
 *  leaves price undefined.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ioDictEnvelope = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  // IoQL roles that map directly onto envelope fields.
  var DIRECT_FIELDS = {
    place: 'place',
    thing: 'thing',
    qualifier: 'qualifier',
    preference: 'preference',
    time_range: 'time_range',
    scope: 'scope',
    lane: 'lane'
  };

  // Build an IoQL envelope from tokenizer output.
  //
  // Shape returned:
  //   {
  //     raw,          // original query string
  //     place?, thing?, kind?, qualifier?, preference?, time_range?, scope?, lane?,
  //     _source: 'dict',
  //     _confidence: 0..1,
  //     _tokens: [...],   // original tokens, for UI chip painting
  //     _meta: { version, dispatchable, cleanMatch, rule }
  //   }
  //
  // Multiple 'kind' tokens stack as an array (Recipe Stacks pattern — child.kind = parent.thing).
  // Everything else keeps only the first hit per field; later hits are dropped because
  // the envelope has one slot per role. Task 4 spec: don't overwrite, keep first.
  function buildEnvelope(tokenResult, rawQuery) {
    var env = {
      raw: String(rawQuery == null ? '' : rawQuery),
      _source: 'dict',
      _confidence: 0,
      _tokens: (tokenResult && tokenResult.tokens) ? tokenResult.tokens.slice() : [],
      _meta: {
        version: VERSION,
        dispatchable: !!(tokenResult && tokenResult.dispatchable),
        cleanMatch: !!(tokenResult && tokenResult.cleanMatch),
        rule: null
      }
    };

    if (!tokenResult || !tokenResult.tokens || !tokenResult.tokens.length) {
      env._meta.rule = 'empty_tokens';
      return env;
    }

    var kindStack = [];
    var confidences = [];

    for (var i = 0; i < tokenResult.tokens.length; i++) {
      var t = tokenResult.tokens[i];
      if (t.source === 'unresolved' || !t.role) continue;

      confidences.push(t.confidence || 0);

      if (t.role === 'kind') {
        // Stack kinds as tuples {text, canonical, depth}. First wins the top slot,
        // subsequent kinds become children (Recipe Stacks vertical dimension).
        kindStack.push({
          thing: t.text,
          canonical: t.canonical,
          depth: t.depth
        });
        continue;
      }

      var field = DIRECT_FIELDS[t.role];
      if (!field) continue;

      if (env[field] == null) {
        env[field] = {
          text: t.text,
          canonical: t.canonical
        };
      }
    }

    if (kindStack.length) {
      // Flat shape: top kind goes into envelope.kind, deeper kinds into a stack
      // mirrored from the resolver pipeline (see insight_recipe_stacks.md).
      env.kind = {
        text: kindStack[0].thing,
        canonical: kindStack[0].canonical,
        depth: kindStack[0].depth
      };
      if (kindStack.length > 1) {
        env.kind.stack = kindStack.slice(1);
      }
    }

    // Average confidence across matched tokens.
    if (confidences.length) {
      var sum = 0;
      for (var ci = 0; ci < confidences.length; ci++) sum += confidences[ci];
      env._confidence = sum / confidences.length;
    }

    env._meta.rule = tokenResult.cleanMatch
      ? 'clean_match'
      : (tokenResult.dispatchable ? 'dispatchable_primary' : 'below_threshold');

    return env;
  }

  // Decide whether the tokenizer result qualifies to short-circuit classify-v5.
  //
  // Mode semantics:
  //   off             → never
  //   hybrid          → yes iff dispatchable
  //   hybrid_parallel → yes iff dispatchable (same gate, different side-effect)
  function shouldShortCircuit(tokenResult, mode) {
    if (!tokenResult) return false;
    if (mode === 'off' || !mode) return false;
    if (mode !== 'hybrid' && mode !== 'hybrid_parallel') return false;
    return !!tokenResult.dispatchable;
  }

  // Async orchestrator. Takes a raw query and dependencies and returns an
  // envelope promise. The caller passes in:
  //   - dict:      an ioDict-shaped object (from window.ioDict)
  //   - tokenize:  the ioDictTokenize.tokenize function
  //   - classify:  async function(query) → envelope  (classify-v5 wrapper)
  //   - mode:      one of 'off' | 'hybrid' | 'hybrid_parallel'
  //   - telemetry: optional function({ path, envelope, classifyEnvelope, ms })
  //
  // Returns { envelope, path, ms }
  //   path is one of: 'classify' | 'dict' | 'dict_parallel'
  function dispatch(query, opts) {
    opts = opts || {};
    var dict = opts.dict;
    var tokenize = opts.tokenize;
    var classify = opts.classify;
    var mode = opts.mode || 'off';
    var telemetry = typeof opts.telemetry === 'function' ? opts.telemetry : null;
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    function now() {
      return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }

    function done(path, envelope) {
      return {
        path: path,
        envelope: envelope,
        ms: now() - t0
      };
    }

    // If we can't tokenize or have no dict, go straight to classify.
    if (!tokenize || !dict || typeof classify !== 'function') {
      if (typeof classify === 'function') {
        return Promise.resolve(classify(query)).then(function (env) {
          return done('classify', env);
        });
      }
      return Promise.resolve(done('classify', null));
    }

    var tokenResult;
    try {
      tokenResult = tokenize(query, dict);
    } catch (e) {
      tokenResult = null;
    }

    if (!shouldShortCircuit(tokenResult, mode)) {
      return Promise.resolve(classify(query)).then(function (env) {
        return done('classify', env);
      });
    }

    // Short-circuit path: build envelope from tokens directly.
    var envelope = buildEnvelope(tokenResult, query);

    // hybrid_parallel: still call classify in the background for telemetry.
    if (mode === 'hybrid_parallel') {
      try {
        Promise.resolve(classify(query)).then(function (classifyEnvelope) {
          if (telemetry) {
            try {
              telemetry({
                path: 'dict_parallel',
                envelope: envelope,
                classifyEnvelope: classifyEnvelope,
                ms: now() - t0
              });
            } catch (e) { /* swallow */ }
          }
        }).catch(function () { /* swallow */ });
      } catch (e) { /* swallow */ }
      return Promise.resolve(done('dict_parallel', envelope));
    }

    // Plain hybrid: return the envelope and we're done.
    return Promise.resolve(done('dict', envelope));
  }

  return {
    version: VERSION,
    buildEnvelope: buildEnvelope,
    shouldShortCircuit: shouldShortCircuit,
    dispatch: dispatch,
    _directFields: DIRECT_FIELDS
  };
}));
