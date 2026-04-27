/*! io-dict-loader v1.3.0 - Session 82 (NZ suburb additions from TM Localities harvest)
 *  Two-tier dictionary loader for plain-language tokenization.
 *  Core loads sync, full loads async after first paint.
 *  Self-gates on window.io.dimensions.dictionary. Never throws.
 *  API: window.ioDict.{ready,fullReady,lookup,has,isStopword,normalize,stats}
 *
 *  v1.3.0: payload only. 2015 net-new NZ place entries (regions/districts/
 *          suburbs) added to dictionary-full from TM /v1/Localities.json
 *          harvest. 4 region aliases added to core. Closes 1.1's deferred
 *          suburb-tier work (functions/index.js:5166). 17 conflicts left
 *          untouched - server translation table handles them. Loader code
 *          itself unchanged from v1.2.1.
 *  v1.2.1: demotes 17 false-positive place tags that v1.2.0 Channel A
 *          over-promoted via generic parent-attribute hits. The numerals
 *          1-6, stopwords (new/other/city/bay/island/region), abbreviations
 *          (te/mt/st), and garbage tokens ((nz)/4 nz) all get restored to
 *          their v1.1.2 roles. The 480 legitimate place elevations and all
 *          16 lane elevations are preserved. Loader code itself unchanged.
 *  v1.2.0: role elevation applied as a transformation over v1.1.2.
 *    (1) 497 entries elevated to r:place — NZ regions, cities and
 *        suburbs now route geographically instead of as attribute-option
 *        preferences. Two channels: parent-attribute clue (boat
 *        location, district, region, etc.) and known-NZ-name match
 *        (16 regions + common multi-word cities).
 *    (2) 16 lane vocabulary entries promoted/synthesized to r:lane —
 *        rent/rental/for rent/buy/for sale/lease/hire/flatmate. `lane`
 *        is a new dict role (not an IoQL word), consumed by the
 *        dispatcher for section routing before IoQL classification.
 *  Deferred v1.2.1: umbrella-over-leaf rescore for ambiguous category
 *  keywords (e.g. "houses" → Toys/Dolls vs Property) — requires harvest
 *  re-fetch to compare depth and breadth.
 *  Loader code itself unchanged from v1.1.2 — only the payload evolved.
 */
(function(){
  'use strict';

  var VERSION = '1.3.0';
  var FEATURE_KEY = 'dictionary';
  var PRIMARY = 'https://cdn.jsdelivr.net/gh/DigitalPataka/io-cdn@main/dictionary/';
  var FALLBACK = 'https://raw.githubusercontent.com/DigitalPataka/io-cdn/main/dictionary/';
  var CORE_FILE = 'dictionary-core-v' + VERSION + '.json';
  var FULL_FILE = 'dictionary-full-v' + VERSION + '.json';

  // Self-gate: if dimension flag is off, install a noop stub and bail.
  var io = window.io = window.io || {};
  io.dimensions = io.dimensions || {};
  if (!io.dimensions[FEATURE_KEY]) {
    window.ioDict = stub('flag_off');
    return;
  }

  var coreMap = Object.create(null);
  var fullMap = null;   // becomes same reference as coreMap once full has merged
  var stopwords = Object.create(null);
  var state = {
    core_loaded: false,
    full_loaded: false,
    core_ms: null,
    full_ms: null,
    core_entries: 0,
    full_entries: 0,
    core_source: null,
    full_source: null,
    errors: []
  };

  // Same normalizer as the consolidator (Session34-dictionary-consolidator.js).
  // Any drift here will break every lookup — keep in lockstep.
  function normalize(s){
    return String(s || '').toLowerCase()
      .replace(/_/g, ' ')
      .replace(/&/g, 'and')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function lookup(word){
    var w = normalize(word);
    if (!w) return undefined;
    return coreMap[w];
  }
  function has(word){
    return lookup(word) !== undefined;
  }
  function isStopword(word){
    var w = normalize(word);
    return !!(w && stopwords[w]);
  }
  function stats(){
    return {
      version: VERSION,
      core_loaded: state.core_loaded,
      full_loaded: state.full_loaded,
      core_entries: state.core_entries,
      full_entries: state.full_entries,
      core_ms: state.core_ms,
      full_ms: state.full_ms,
      core_source: state.core_source,
      full_source: state.full_source,
      stopword_count: Object.keys(stopwords).length,
      errors: state.errors.slice()
    };
  }

  // Fetch with jsDelivr primary, raw GitHub fallback.
  // Returns { json, source } or throws.
  function fetchWithFallback(filename){
    var t0 = Date.now();
    return fetch(PRIMARY + filename, { cache: 'force-cache' })
      .then(function(r){
        if (!r.ok) throw new Error('jsd ' + r.status);
        return r.json().then(function(j){ return { json: j, source: 'jsdelivr', ms: Date.now() - t0 }; });
      })
      .catch(function(primaryErr){
        return fetch(FALLBACK + filename, { cache: 'force-cache' })
          .then(function(r){
            if (!r.ok) throw new Error('raw ' + r.status);
            return r.json().then(function(j){
              return { json: j, source: 'github_raw', ms: Date.now() - t0, primary_err: String(primaryErr) };
            });
          });
      });
  }

  // Merge loaded entries into coreMap (last-write-wins; full is a superset of core
  // so identical overlapping words are fine).
  function mergeEntries(entries){
    if (!entries || typeof entries !== 'object') return 0;
    var added = 0;
    for (var k in entries){
      if (Object.prototype.hasOwnProperty.call(entries, k)){
        coreMap[k] = entries[k];
        added++;
      }
    }
    return added;
  }
  function mergeStopwords(list){
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++){
      stopwords[normalize(list[i])] = 1;
    }
  }

  // ---- Load core (blocks ready promise but not first paint) ----
  var readyResolve, fullReadyResolve;
  var ready = new Promise(function(res){ readyResolve = res; });
  var fullReady = new Promise(function(res){ fullReadyResolve = res; });

  fetchWithFallback(CORE_FILE).then(function(r){
    var j = r.json;
    if (!j || !j.e){
      throw new Error('core payload missing e{}');
    }
    mergeEntries(j.e);
    mergeStopwords(j.sw || []);
    state.core_loaded = true;
    state.core_ms = r.ms;
    state.core_entries = Object.keys(coreMap).length;
    state.core_source = r.source;
    readyResolve({ ok: true, entries: state.core_entries });
    scheduleFullLoad();
  }).catch(function(err){
    state.errors.push('core: ' + String(err));
    // Resolve ready anyway with ok:false so callers don't hang forever.
    // Lookups will return undefined and the hybrid dispatcher will fall through
    // to classify-v5 — graceful degradation.
    readyResolve({ ok: false, error: String(err) });
    // Still try the full fetch after a delay — maybe it will succeed and rescue us.
    scheduleFullLoad();
  });

  // ---- Load full (after first paint + idle) ----
  function scheduleFullLoad(){
    var kick = function(){ loadFull(); };
    // Prefer requestIdleCallback; fall back to setTimeout.
    if (document.readyState === 'complete'){
      if (window.requestIdleCallback) window.requestIdleCallback(kick, { timeout: 2000 });
      else setTimeout(kick, 100);
    } else {
      window.addEventListener('load', function(){
        if (window.requestIdleCallback) window.requestIdleCallback(kick, { timeout: 2000 });
        else setTimeout(kick, 100);
      }, { once: true });
    }
  }

  function loadFull(){
    fetchWithFallback(FULL_FILE).then(function(r){
      var j = r.json;
      if (!j || !j.e){
        throw new Error('full payload missing e{}');
      }
      var added = mergeEntries(j.e);
      state.full_loaded = true;
      state.full_ms = r.ms;
      state.full_entries = Object.keys(coreMap).length;
      state.full_source = r.source;
      fullMap = coreMap;
      fullReadyResolve({ ok: true, entries: state.full_entries, merged: added });
    }).catch(function(err){
      state.errors.push('full: ' + String(err));
      fullReadyResolve({ ok: false, error: String(err) });
    });
  }

  // ---- Public API ----
  window.ioDict = {
    version: VERSION,
    ready: ready,
    fullReady: fullReady,
    lookup: lookup,
    has: has,
    isStopword: isStopword,
    normalize: normalize,
    stats: stats,
    // Escape hatch for dev/debug only — exposes the live map.
    _map: function(){ return coreMap; },
    _stopwords: function(){ return stopwords; }
  };

  // Self-describing log so boot timing is visible without opening devtools manually.
  ready.then(function(r){
    try { console.log('[ioDict v' + VERSION + '] core:', r.ok ? (state.core_entries + ' entries in ' + state.core_ms + 'ms via ' + state.core_source) : ('FAILED: ' + r.error)); } catch(_){}
  });
  fullReady.then(function(r){
    try { console.log('[ioDict v' + VERSION + '] full:', r.ok ? ('+' + r.merged + ' entries in ' + state.full_ms + 'ms via ' + state.full_source + ', total ' + state.full_entries) : ('FAILED: ' + r.error)); } catch(_){}
  });

  // ---- Stub used when flag is off or load fails catastrophically ----
  function stub(reason){
    var never = new Promise(function(){});
    var resolved = Promise.resolve({ ok: false, error: reason });
    return {
      version: VERSION,
      disabled: true,
      reason: reason,
      ready: resolved,
      fullReady: resolved,
      lookup: function(){ return undefined; },
      has: function(){ return false; },
      isStopword: function(){ return false; },
      normalize: normalize,
      stats: function(){ return { disabled: true, reason: reason, version: VERSION }; }
    };
  }
})();
