/*! io-dict-loader v1.1.0 — Session 50
 *  Two-tier dictionary loader for plain-language tokenization.
 *  Core loads sync, full loads async after first paint.
 *  Self-gates on window.io.dimensions.dictionary. Never throws.
 *  API: window.ioDict.{ready,fullReady,lookup,has,isStopword,normalize,stats}
 *
 *  v1.1.0: dictionary data regenerated from full harvest projection — every
 *  word of every Trade Me category slug, every attribute name, every
 *  attribute value (including numeric size values) carries an entry. Entries
 *  may include a `parent` array naming the qualifier(s) the value belongs
 *  to, enabling client-side positional inference at the consumer layer.
 *  POI and other module entries from v1.0.0 preserved.
 */
(function(){
  'use strict';

  var VERSION = '1.1.0';
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
