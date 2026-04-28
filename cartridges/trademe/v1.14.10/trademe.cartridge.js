var IoCartridge_Trademe = (function() {
  "use strict";

  // ══════════════════════════════════════════════════════════════
  // TRADE ME MARKETPLACE CARTRIDGE v1.11.5
  // v1.11.5 (Session 79): DELETED trademe-listing-geo module. v1.11.4's
  //   JSON API probe proved TM exposes GeographicLocation.Latitude /
  //   GeographicLocation.Longitude at the top level of the /v1/Listings
  //   /{id}.json response. The HTML-scrape path we built in v1.11.0 was
  //   unnecessary — extraction now lives directly in trademe-listing-
  //   detail's parse() function. One network call per listing instead
  //   of two; homes.co.nz enrichment now fires on any TM property
  //   listing via d.modules['trademe-listing-detail'].data.latitude/
  //   .longitude. MODULE_META + investigateListing + manifest all
  //   aligned. Kung fu lesson banked: walk the JSON API recursively
  //   before drifting to HTML-scrape.
  // v1.11.4 (Session 79): PIVOT trademe-listing-geo from HTML-scrape to
  //   JSON API recursive key walk — diagnostic that discovered the geo
  //   was in the JSON all along.
  // v1.11.0-3 (Session 79): HTML-scrape path + debug iterations. All
  //   dead code. Kept v1.11.1-4 directories on io-cdn as archeology.
  // v1.11.0 (Session 79): NEW MODULE — trademe-listing-geo.
  //   HTML-scrapes lat/lng from the public TM listing page's
  //   schema.org JSON-LD GeoCoordinates block. Unblocks homes.co.nz
  //   enrichment for TM property listings, which couldn't fire before
  //   because TM's JSON API doesn't expose geographic coordinates.
  //   Same HTML-scrape pattern as realestate-listing-detail in nz-intel.
  //   Gated on qualifiesWhen:['listing_id']; normal search flows never
  //   dispatch it. Silent fail on HTML drift.
  // Born: Session 43 (extracted from sweep v1.10.0)
  // v1.1.0: trademe-stats (Session 43)
  // v1.2.0: trademe-commercial-sale, trademe-commercial-lease (Session 43)
  // v1.3.1: trademe-lifestyle, trademe-rural, trademe-open-homes,
  //         trademe-retirement, trademe-stores (Session 43)
  // v1.4.0: Full sort vocabulary — WatchersMost, BuyNow, Reviews,
  //         LargestDiscount, motors sorts across all 20 modules (Session 44)
  // v1.5.1: Price params — parsePrice utility, price_min/price_max
  //         appended to all search modules. Auto-category pre-query
  //         when price set without category (Session 45)
  // v1.6.0: Attribute params — reads opts.module_attributes from
  //         resolver, appends structured params (transmission,
  //         body_style, fuel_type, property_type, etc.) to API URLs.
  //         Resolver reads translation tables from Firebase. (Session 45)
  // v1.10.0: Resolver-authoritative dispatch. When opts.modules is a
  //         non-empty array, run exactly those modules and skip
  //         qualifyModules() entirely. Prior behaviour (intersect with
  //         qualified set) silently dropped resolver T4-section picks
  //         when the cartridge's trigger match disagreed with the
  //         resolver's section decision — e.g. lane=rent + thing=house
  //         resolved to trademe-rental, but qualifyModules picked
  //         trademe-property from "house" triggers and the intersect
  //         emptied. Resolver knows section; cartridge stays dumb.
  //         Session 52 Phase 2+ fix. (2026-04-16)
  // v1.10.1: Attribute retry defense. If TM API returns 400 and the
  //         URL contains attribute params from module_attributes, retry
  //         the call without those params. Attributes are optional
  //         enrichments from the resolver's translation tables. A bad
  //         attribute value (e.g. body_style=RVSUV instead of SUV)
  //         should narrow results, not kill the search. Session 56.
  // v1.10.2: Region-based location filtering. Specialist modules now
  //         use TM region params instead of search_string=placename.
  //         PLACE_TO_REGION lookup maps NZ place names to official TM
  //         Localities API codes. Two param families:
  //           Motors (cars/bikes/boats): user_region= (seller location)
  //           Property/Jobs/Flatmates: region= (listing location)
  //         This mirrors TM's own website behaviour and fixes parity gap:
  //         text-searching "auckland" returned ~37K extra nationwide
  //         results. General Search also wired: place→user_region
  //         (same family as Motors). Unrecognised places fall back to
  //         search_string (safe degradation). Session 57 parity fix.
  // v1.10.3: Session 60 — Pattern A fix. All 13 specialist modules
  //         rewritten from either/or ternary (region replaced search_string)
  //         to both search_string AND region. "toyota corolla auckland"
  //         went from 25,368 → 667. Search term always passes through.
  // v1.10.4: Session 60 — Pattern C fix (BestMatch tested, reverted).
  //         Category injection from tmIntel is the real fix. Default
  //         sort stays ExpiryDesc. BestMatch/relevance qualifiers added.
  // v1.10.5: Session 60 — Pattern B fix. Universal resolveSortOrder()
  //         replaces 14 per-module qualifier-only lookups. Both IoQL
  //         qualifier (explicit) and preference (inferred) now translate
  //         to API sort_order. Qualifier wins when both present. One
  //         function, every module calls it. Severable: revert to
  //         qualifier-only by replacing resolveSortOrder calls with
  //         direct opts.qualifier lookups.
  // ══════════════════════════════════════════════════════════════

  var meta = {
    id: "trademe",
    label: "Trade Me",
    version: "1.14.10",  // S83-F10f: two fixes. (1) Bare TM unauth API actually DOES return Questions.List with shells (answer=null, masked nicknames "r********i", raw .NET dates "/Date(...)/"). v1.14.9 stitched these onto detail.questions, fooling the lazy gate into thinking Spider already ran — answers stopped rendering. v1.14.10 leaves detail.questions=[] (Spider is the authoritative source); only questionCount/unansweredQuestionCount/supportsQuestionsAndAnswers come from bare API. (2) Spider parser now also extracts bid history from .tm-bid-history-modal__bid-container DOM (price/member/time). One Spider call covers Q&A + bid history.
    born: "Session 43",
    extracted_from: "sweep v1.11.0",
    modules: {
      // Session 51 D — `sections` declares which transactional lanes
      // this module belongs to. Resolver uses it to filter module
      // candidates after classify-v5 derives the query's section from
      // lane words. A module can belong to multiple sections (rare,
      // but allowed — e.g. trademe-flatmates is really rent + flatmate).
      "trademe":                  { name: "Trade Me Marketplace",         category: "marketplace", layout: "cards", sections: ["sale"] },
      "trademe-rental":           { name: "Trade Me Rental Properties",   category: "property",    layout: "cards", sections: ["rent"] },
      "trademe-property":         { name: "Trade Me Property For Sale",   category: "property",    layout: "cards", sections: ["sale"] },
      "trademe-cars":             { name: "Trade Me Used Cars",           category: "motors",      layout: "cards", sections: ["sale"] },
      "trademe-bikes":            { name: "Trade Me Motorbikes",          category: "motors",      layout: "cards", sections: ["sale"] },
      "trademe-boats":            { name: "Trade Me Boats",               category: "motors",      layout: "cards", sections: ["sale"] },
      "trademe-jobs":             { name: "Trade Me Jobs",                category: "employment",  layout: "cards", sections: ["jobs"] },
      "trademe-flatmates":        { name: "Trade Me Flatmates Wanted",    category: "flatmates",   layout: "cards", sections: ["rent"] },
      "trademe-categories":       { name: "Trade Me Category Tree",       category: "reference",   layout: "rows",  sections: ["reference"] },
      "trademe-localities":       { name: "Trade Me Localities",          category: "reference",   layout: "rows",  sections: ["reference"] },
      "trademe-listing-detail":   { name: "Trade Me Listing Detail",      category: "marketplace", layout: "cards", sections: ["reference"] },
      "trademe-listing-questions":{ name: "Trade Me Listing Q&A",         category: "marketplace", layout: "rows",  sections: ["reference"] },
      "trademe-similar":          { name: "Trade Me Similar Listings",    category: "marketplace", layout: "cards", sections: ["reference"] },
      "trademe-stats":            { name: "Trade Me Site Statistics",     category: "reference",   layout: "rows",  sections: ["reference"] },
      "trademe-commercial-sale":  { name: "Trade Me Commercial Sale",     category: "property",    layout: "cards", sections: ["sale"] },
      "trademe-commercial-lease": { name: "Trade Me Commercial Lease",    category: "property",    layout: "cards", sections: ["rent"] },
      "trademe-lifestyle":        { name: "Trade Me Lifestyle Property",  category: "property",    layout: "cards", sections: ["sale"] },
      "trademe-rural":            { name: "Trade Me Rural Property",      category: "property",    layout: "cards", sections: ["sale"] },
      "trademe-open-homes":       { name: "Trade Me Open Homes",          category: "property",    layout: "cards", sections: ["sale"] },
      "trademe-retirement":       { name: "Trade Me Retirement Villages", category: "property",    layout: "cards", sections: ["sale"] },
      "trademe-stores":           { name: "Trade Me Stores",              category: "marketplace", layout: "cards", sections: ["sale"] }
    }
  };

  // ── SHARED UTILITIES ──────────────────────────────────────────

  function fetchJson(url, timeout, customHeaders) {
    var ms = timeout || 10000;
    var headers = customHeaders || { "Accept": "application/json, text/plain, */*" };
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() {
        reject(new Error("Timeout after " + ms + "ms"));
      }, ms);
      fetch(url, {
        headers: headers,
        credentials: "omit",
        referrerPolicy: "no-referrer"
      }).then(function(res) {
        clearTimeout(timer);
        if (res.ok) return res.json();
        reject(new Error("HTTP " + res.status));
      }).then(resolve).catch(function(err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // v1.11.0 — fetchText for HTML-scrape modules. Mirrors fetchJson
  // but returns res.text() so modules like trademe-listing-geo can
  // regex-parse raw HTML. Modules opt into this by declaring
  // parseAs: 'text' in their slot definition.
  function fetchText(url, timeout, customHeaders) {
    var ms = timeout || 10000;
    var headers = customHeaders || { "Accept": "text/html,*/*" };
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() {
        reject(new Error("Timeout after " + ms + "ms"));
      }, ms);
      fetch(url, {
        headers: headers,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "follow"
      }).then(function(res) {
        clearTimeout(timer);
        if (res.ok) return res.text();
        reject(new Error("HTTP " + res.status));
      }).then(resolve).catch(function(err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  var TM_BASE = "https://api.trademe.co.nz/v1";
  var TM_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://www.trademe.co.nz/"
  };

  function tmDate(d) { return d ? new Date(parseInt(d.replace(/[^0-9]/g, ""))).toISOString() : null; }

  // ── PRICE PARSER (v1.5.1) ─────────────────────────────────────
  // Parses IoQL price string into {min, max} integers.
  // Handles: "under $10k", "over $500", "$200-$500", "$10000",
  //          "10k", "under 500", "200 to 500", "less than $1000"

  function parseNumber(s) {
    if (!s) return null;
    var cleaned = String(s).replace(/[$,\s]/g, "").toLowerCase();
    var mMatch = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)m$/);
    if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1000000);
    var kMatch = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)k$/);
    if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
    var num = parseFloat(cleaned);
    return isNaN(num) ? null : Math.round(num);
  }

  function parsePrice(priceStr) {
    if (!priceStr) return null;
    var s = String(priceStr).toLowerCase().trim();
    var result = { min: null, max: null };

    // Range: "$200-$500", "200 to 500", "$10k-$20k"
    var rangeMatch = s.match(/([0-9$.,]+[km]?)\s*(?:-|to)\s*([0-9$.,]+[km]?)/);
    if (rangeMatch) {
      result.min = parseNumber(rangeMatch[1]);
      result.max = parseNumber(rangeMatch[2]);
      if (result.min !== null || result.max !== null) return result;
    }

    // "under $10k", "less than $500", "below $1000", "up to $800"
    var underMatch = s.match(/(?:under|less than|below|up to|max|at most)\s*([0-9$.,]+[km]?)/);
    if (underMatch) {
      result.max = parseNumber(underMatch[1]);
      if (result.max !== null) return result;
    }

    // "over $500", "more than $1000", "above $200", "at least $100", "from $500"
    var overMatch = s.match(/(?:over|more than|above|at least|from|min|minimum)\s*([0-9$.,]+[km]?)/);
    if (overMatch) {
      result.min = parseNumber(overMatch[1]);
      if (result.min !== null) return result;
    }

    // Bare number: "$10000", "10k" — treat as max (user typically means "up to")
    var bare = parseNumber(s);
    if (bare !== null) {
      result.max = bare;
      return result;
    }

    return null;
  }

  function appendPriceParams(params, opts) {
    if (!opts || !opts.price) return params;
    var p = parsePrice(opts.price);
    if (!p) return params;
    if (p.min !== null) params = params + "&price_min=" + p.min;
    if (p.max !== null) params = params + "&price_max=" + p.max;
    return params;
  }

  // Appends structured attribute params from resolver translation tables.
  // opts.module_attributes is keyed by module ID, each value is an object
  // of { param: value } pairs. Example:
  //   opts.module_attributes["trademe-cars"] = { transmission: "2", body_style: "Sedan" }
  // Becomes: &transmission=2&body_style=Sedan
  function appendAttributeParams(params, opts, moduleId) {
    if (!opts || !opts.module_attributes) return params;
    var attrs = opts.module_attributes[moduleId];
    if (!attrs || typeof attrs !== "object") return params;
    var keys = Object.keys(attrs);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = attrs[k];
      if (v !== null && v !== undefined && v !== "") {
        // Session 62 — skip keys already present in params to prevent
        // duplicates. resolvePlace sets region=; the resolver's place-fold
        // also injects region into module_attributes. Duplicate region=
        // causes TM's Rental/Property APIs to return 0 results.
        var encoded = encodeURIComponent(k);
        if (params.indexOf(encoded + "=") !== -1) continue;
        params = params + "&" + encoded + "=" + encodeURIComponent(v);
      }
    }
    return params;
  }

  // ── PLACE → REGION LOOKUP (v1.10.2) ───────────────────────────
  // TM API region codes from /v1/Localities.json. When the user says
  // "cars auckland", we send region=1 instead of search_string=auckland.
  // This mirrors what TM's own website does — proper region filtering
  // rather than text-matching the place name across listing descriptions.
  // Unrecognised places fall back to search_string (district-level, etc.).

  var PLACE_TO_REGION = {
    "northland": 9, "whangarei": 9, "far north": 9, "kaipara": 9,
    "auckland": 1, "north shore": 1, "waitakere": 1, "manukau": 1, "papakura": 1, "franklin": 1, "rodney": 1,
    "waikato": 14, "hamilton": 14, "tauranga": 2, "rotorua": 2, "taupo": 14, "thames": 14, "matamata": 14, "te awamutu": 14, "cambridge": 14, "morrinsville": 14, "huntly": 14, "ngaruawahia": 14, "tokoroa": 14,
    "bay of plenty": 2, "whakatane": 2, "mount maunganui": 2, "te puke": 2,
    "gisborne": 4,
    "hawkes bay": 5, "hawke's bay": 5, "napier": 5, "hastings": 5,
    "taranaki": 12, "new plymouth": 12,
    "manawatu": 6, "whanganui": 6, "palmerston north": 6, "levin": 6, "feilding": 6, "wanganui": 6,
    "wellington": 15, "lower hutt": 15, "upper hutt": 15, "porirua": 15, "kapiti": 15, "paraparaumu": 15, "masterton": 15, "hutt valley": 15,
    "nelson": 8, "tasman": 8, "richmond": 8, "motueka": 8,
    "marlborough": 7, "blenheim": 7, "picton": 7,
    "west coast": 16, "greymouth": 16, "hokitika": 16,
    "canterbury": 3, "christchurch": 3, "timaru": 3, "ashburton": 3, "rangiora": 3, "kaiapoi": 3, "rolleston": 3, "selwyn": 3,
    "otago": 10, "dunedin": 10, "queenstown": 10, "wanaka": 10, "oamaru": 10, "alexandra": 10, "cromwell": 10,
    "southland": 11, "invercargill": 11, "gore": 11, "te anau": 11
  };

  // Motors user_region codes — completely different numbering to Localities API.
  // Extracted from TM's Angular SPA searchAreas config (Session 57).
  // Key splits vs Localities: Manawatu/Whanganui are separate (8 vs 9),
  // Wairarapa (11) split from Wellington (12), Timaru-Oamaru (17) split from Canterbury (16).
  var PLACE_TO_USER_REGION = {
    "northland": 1, "whangarei": 1, "far north": 1, "kaipara": 1,
    "auckland": 2, "north shore": 2, "waitakere": 2, "manukau": 2, "papakura": 2, "franklin": 2, "rodney": 2,
    "waikato": 3, "hamilton": 3, "taupo": 3, "thames": 3, "matamata": 3, "te awamutu": 3, "cambridge": 3, "morrinsville": 3, "huntly": 3, "ngaruawahia": 3, "tokoroa": 3,
    "bay of plenty": 4, "tauranga": 4, "rotorua": 4, "whakatane": 4, "mount maunganui": 4, "te puke": 4,
    "gisborne": 5,
    "hawkes bay": 6, "hawke's bay": 6, "napier": 6, "hastings": 6,
    "taranaki": 7, "new plymouth": 7,
    "whanganui": 8, "wanganui": 8,
    "manawatu": 9, "palmerston north": 9, "levin": 9, "feilding": 9,
    "wairarapa": 11, "masterton": 11,
    "wellington": 12, "lower hutt": 12, "upper hutt": 12, "porirua": 12, "kapiti": 12, "paraparaumu": 12, "hutt valley": 12,
    "nelson": 13, "tasman": 13, "richmond": 13, "motueka": 13,
    "marlborough": 14, "blenheim": 14, "picton": 14,
    "west coast": 15, "greymouth": 15, "hokitika": 15,
    "canterbury": 16, "christchurch": 16, "ashburton": 16, "rangiora": 16, "kaiapoi": 16, "rolleston": 16, "selwyn": 16,
    "timaru": 17, "oamaru": 17,
    "otago": 18, "dunedin": 18, "queenstown": 18, "wanaka": 18, "alexandra": 18, "cromwell": 18,
    "southland": 19, "invercargill": 19, "gore": 19, "te anau": 19
  };

  // Resolve place to region code. Returns {region, searchTerm} where:
  //   - region is the TM region code (number) or null if unrecognised
  //   - searchTerm is the leftover text for search_string (null if place was fully consumed)
  // useMotors=true selects the user_region table (Motors endpoints).
  // useMotors=false/undefined selects the Localities table (Property/Jobs/Flatmates).
  function resolvePlace(opts, useMotors) {
    if (!opts || !opts.place) return { region: null, searchTerm: null };
    var place = opts.place.toLowerCase().trim();
    var table = useMotors ? PLACE_TO_USER_REGION : PLACE_TO_REGION;
    var regionCode = table[place];
    if (regionCode !== undefined) {
      return { region: regionCode, searchTerm: null };
    }
    // Unrecognised place — fall back to text search
    return { region: null, searchTerm: opts.place };
  }

  // Build the base location params for a specialist module.
  // If place resolves to a region, uses region= (no search_string for location).
  // If not, uses search_string=place (legacy fallback).
  // Any thing/keyword-based search_string should be added separately by the caller.
  function buildLocationParams(opts) {
    var resolved = resolvePlace(opts);
    var params = "";
    if (resolved.region !== null) {
      params = "region=" + resolved.region;
    } else if (resolved.searchTerm) {
      params = "search_string=" + encodeURIComponent(resolved.searchTerm);
    }
    return params;
  }

  // ── SHARED PREFERENCE REGISTRY (v1.9.0) ───────────────────────

  var TM_PREFERENCES = {
    "biggest-discount": {
      synonyms: ["biggest discount", "best deal", "best deals", "biggest price drop", "biggest saving", "largest discount", "deepest discount"],
      filter: function(l) { return l.percentageOff != null && l.percentageOff > 0; },
      sort: function(a, b) { return (b.percentageOff || 0) - (a.percentageOff || 0); },
      describes: "Percentage-off sorted descending, items without a markdown dropped"
    },
    "on-sale": {
      synonyms: ["on sale", "price drop", "price drops", "discounted", "reduced", "marked down", "price lowered"],
      filter: function(l) { return l.wasPrice != null && l.wasPrice > 0; },
      describes: "Any listing that has a WasPrice (seller lowered it)"
    },
    "clearance": {
      synonyms: ["clearance", "clearance items", "end of line", "clearance sale"],
      filter: function(l) { return l.isClearance === true; },
      describes: "Seller flagged as clearance stock"
    },
    "no-bids": {
      synonyms: ["no bids", "no bids yet", "unbidden", "zero bids", "still no bids"],
      filter: function(l) { return (l.bidCount || 0) === 0 && l.isBuyNowOnly === false; },
      describes: "Auction listings with zero bids so far (excludes buy-now-only where bidding isn't possible)"
    },
    "has-bids": {
      synonyms: ["has bids", "with bids", "bidding active", "already bidding"],
      filter: function(l) { return (l.bidCount || 0) > 0; },
      sort: function(a, b) { return (b.bidCount || 0) - (a.bidCount || 0); },
      describes: "Listings with at least one bid, most-bid-first"
    },
    "reserve-not-met": {
      synonyms: ["reserve not met", "below reserve", "reserve still not met", "reserve unmet"],
      filter: function(l) { return l.hasReserve === true && l.reserveState !== 1; },
      describes: "Reserve set but not yet met (ReserveState !== Met)"
    },
    "reserve-met": {
      synonyms: ["reserve met", "above reserve", "reserve reached"],
      filter: function(l) { return l.reserveState === 1 || l.isReserveMet === true; },
      describes: "Reserve has been met"
    },
    "super-seller": {
      synonyms: ["super seller", "super sellers", "trusted seller", "trusted sellers", "top seller"],
      filter: function(l) { return l.isSuperSeller === true; },
      describes: "Trade Me Super Seller badge present"
    },
    "dealer": {
      synonyms: ["dealer", "from dealer", "from a dealer", "dealership", "dealer only"],
      filter: function(l) { return l.isDealer === true; },
      describes: "Listing from a commercial dealer"
    },
    "private-sale": {
      synonyms: ["private sale", "private seller", "from private", "not dealer", "private only"],
      filter: function(l) { return l.isDealer === false; },
      describes: "Listing from a private (non-dealer) seller"
    },
    "buy-now-only": {
      synonyms: ["buy now only", "buy now", "no auction", "fixed price", "instant buy"],
      filter: function(l) { return l.isBuyNowOnly === true; },
      describes: "Fixed-price buy-now listings, no auction"
    },
    "pickup-available": {
      synonyms: ["pickup available", "pickup", "can pick up", "local pickup"],
      filter: function(l) { return (typeof l.allowsPickups === "number" && l.allowsPickups > 0) || l.allowsPickups === true; },
      describes: "Seller allows local pickup"
    },
    "afterpay": {
      synonyms: ["afterpay", "with afterpay", "afterpay available"],
      filter: function(l) { return l.hasAfterpay === true; },
      describes: "Afterpay accepted"
    }
  };

  function tmApplyPreference(parsed, opts) {
    if (!parsed || !parsed.listings || parsed.listings.length === 0) return parsed;
    if (!opts || !opts.preference) return parsed;
    var pref = String(opts.preference).toLowerCase().trim();
    if (!pref) return parsed;
    var matched = null;
    var matchKey = null;
    var prefKeys = Object.keys(TM_PREFERENCES);
    for (var i = 0; i < prefKeys.length; i++) {
      var p = TM_PREFERENCES[prefKeys[i]];
      for (var j = 0; j < p.synonyms.length; j++) {
        if (p.synonyms[j] === pref) {
          matched = p;
          matchKey = prefKeys[i];
          break;
        }
      }
      if (matched) break;
    }
    if (!matched) return parsed;
    var originalCount = parsed.listings.length;
    var working = parsed.listings;
    if (matched.filter) { working = working.filter(matched.filter); }
    if (matched.sort)   { working = working.slice().sort(matched.sort); }
    parsed.listings = working;
    if (parsed.apiTotalCount == null) { parsed.apiTotalCount = parsed.totalCount; }
    parsed.totalCount = working.length;
    parsed.preferenceGate = {
      active: true,
      version: "1.9.0",
      preference: matchKey,
      input: pref,
      describes: matched.describes || null,
      beforeCount: originalCount,
      afterCount: working.length,
      outcome: working.length === 0 ? "no_match" : "filtered"
    };
    return parsed;
  }

  function tmIntegrityFilter(parsed, opts) {
    if (!parsed || !parsed.listings || parsed.listings.length === 0) return parsed;
    if (!opts || !opts.raw) return parsed;
    var raw = String(opts.raw).toLowerCase();
    var sizeMatch = raw.match(/\bsize\s+([a-z0-9]+)\b/);
    if (!sizeMatch) return parsed;
    var sizeToken = sizeMatch[1];
    if (!/^\d+$/.test(sizeToken)) return parsed;
    var sizePattern = new RegExp("(^|[^a-z0-9])" + sizeToken + "([^a-z0-9]|$)", "i");
    var originalCount = parsed.listings.length;
    var kept = [];
    for (var i = 0; i < parsed.listings.length; i++) {
      var item = parsed.listings[i];
      if (item && item.title && sizePattern.test(item.title)) {
        kept.push(item);
      }
    }
    var droppedCount = originalCount - kept.length;
    parsed.apiTotalCount = parsed.totalCount;
    parsed.listings = kept;
    parsed.totalCount = kept.length;
    parsed.integrityGate = {
      active: true,
      version: "1.9.0",
      constraint: { type: "size", value: sizeToken },
      dropped: droppedCount,
      outcome: kept.length === 0 ? "no_match" : "filtered"
    };
    return parsed;
  }

  // ── UNIVERSAL SORT RESOLVER (v1.10.5) ─────────────────────────
  // Session 60 — Pattern B fix. IoQL has two sort-carrying fields:
  //   qualifier = explicit user sort intent ("sort by most bids")
  //   preference = inferred from adjective descriptors ("cheap houses" → cheapest)
  // Both should translate to API sort_order. Qualifier wins when both
  // are present (explicit intent > inferred). One function, every
  // module calls it — no per-module duplication.
  //
  // This does NOT replace TM_PREFERENCES (client-side post-filters
  // like "on sale" and "has bids"). Those are filters, not sorts.
  // A preference value like "most bids" flows through BOTH paths:
  //   resolveSortOrder → API sort_order=BidsMost (server-side)
  //   tmApplyPreference → no match in TM_PREFERENCES → no-op (correct)
  function resolveSortOrder(opts, translations) {
    // Qualifier first (explicit), then preference (inferred)
    var sortField = (opts && opts.qualifier) ? opts.qualifier
                  : (opts && opts.preference) ? opts.preference
                  : null;
    if (!sortField || !translations) return null;
    return translations[sortField.toLowerCase()] || null;
  }

  // ── MODULE DEFINITIONS ────────────────────────────────────────

  var modules = {

    // ---- GENERAL MARKETPLACE ----
    trademe: {
      name: "Trade Me Marketplace",
      category: "marketplace",
      description: "NZ marketplace listings with prices, bids, reserve status",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      qualifierTranslations: {
        // ── Bids ──
        "most bids": "BidsMost",
        "highest bids": "BidsMost",
        "high bid count": "BidsMost",
        "most bidded": "BidsMost",
        "most bid on": "BidsMost",
        "popular auctions": "BidsMost",
        // ── Watchers ──
        "most watched": "WatchersMost",
        "most watchers": "WatchersMost",
        "high watch count": "WatchersMost",
        "most popular": "WatchersMost",
        "trending": "WatchersMost",
        "most interest": "WatchersMost",
        "least watched": "WatchersLeast",
        // ── Price ──
        "cheapest": "PriceAsc",
        "lowest price": "PriceAsc",
        "affordable": "PriceAsc",
        "budget": "PriceAsc",
        "most expensive": "PriceDesc",
        "highest price": "PriceDesc",
        "priciest": "PriceDesc",
        // ── Buy Now price ──
        "cheapest buy now": "BuyNowAsc",
        "lowest buy now": "BuyNowAsc",
        "buy now cheapest": "BuyNowAsc",
        "most expensive buy now": "BuyNowDesc",
        "highest buy now": "BuyNowDesc",
        // ── Current bid ──
        "lowest current bid": "HighestBidAsc",
        "lowest bid": "HighestBidAsc",
        "cheapest bid": "HighestBidAsc",
        // ── Expiry / time ──
        "closing soon": "ExpiryAsc",
        "ending soon": "ExpiryAsc",
        "expiring soon": "ExpiryAsc",
        "about to end": "ExpiryAsc",
        "most time left": "ExpiryDesc",
        "longest running": "ExpiryDesc",
        // ── Listing date (TM website uses ExpiryDesc for "Latest listings") ──
        "newest": "ExpiryDesc",
        "just listed": "ExpiryDesc",
        "latest": "ExpiryDesc",
        "recently listed": "ExpiryDesc",
        // ── Seller reviews ──
        "best reviewed": "ReviewsDesc",
        "highest rated": "ReviewsDesc",
        "most reviews": "ReviewsDesc",
        "top rated seller": "ReviewsDesc",
        "best seller": "ReviewsDesc",
        "worst reviewed": "ReviewsAsc",
        "lowest rated": "ReviewsAsc",
        // ── Discount ──
        "biggest discount": "LargestDiscount",
        "largest discount": "LargestDiscount",
        "best deal": "LargestDiscount",
        "biggest saving": "LargestDiscount",
        "biggest price drop": "LargestDiscount",
        "most reduced": "LargestDiscount",
        // ── Relevance (TM website uses "Default" for best match) ──
        "best match": "Default",
        "most relevant": "Default",
        "relevance": "Default",
        // ── Alphabetical ──
        "alphabetical": "TitleAsc",
        "a to z": "TitleAsc",
        "by name": "TitleAsc"
      },
      queryByName: function(query, opts) {
        var searchTerm = (opts && opts.raw) ? opts.raw : query;
        // General Search uses user_region= (same numbering as Motors).
        // Resolve place → user_region code; unrecognised places fold into search_string.
        var resolved = resolvePlace(opts, true);
        if (resolved.searchTerm) {
          searchTerm = searchTerm + " " + resolved.searchTerm;
        }
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) {
          params = params + "&user_region=" + resolved.region;
        }
        if (opts && opts.category) {
          params = params + "&category=" + encodeURIComponent(opts.category);
        }
        var sortOrder = resolveSortOrder(opts, this.qualifierTranslations);
        if (sortOrder) {
          params = params + "&sort_order=" + sortOrder;
        }
        // Session 60 — Default sort kept as ExpiryDesc. BestMatch was
        // tried but TM's public API rewards keyword density, not product
        // relevance (accessories with "laptop" repeated dominate). The
        // real Pattern C fix is category injection from tmIntel — the
        // kit-runner passes opts.category from tmIntel breadcrumbs,
        // scoping results to the correct product category.
        if (params.indexOf("sort_order=") === -1) {
          params = params + "&sort_order=ExpiryDesc";
        }
        var rows = 500;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          // 500 is the per-call optimum (TM's max). Narrow scopes only
          // shrink, never expand.
          if (s === "top" || s === "best" || s === "first") rows = 5;
        }
        params = params + "&rows=" + rows;
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return "https://api.trademe.co.nz/v1/Search/General.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          page: data.Page,
          pageSize: data.PageSize,
          didYouMean: data.DidYouMean || null,
          foundCategories: data.FoundCategories || null,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              startPrice: item.StartPrice,
              buyNowPrice: item.BuyNowPrice || null,
              priceDisplay: item.PriceDisplay || null,
              wasPrice: item.WasPrice || null,
              percentageOff: item.PercentageOff || null,
              isClearance: item.IsClearance === true,
              maxBidAmount: item.MaxBidAmount || null,
              bidCount: item.BidCount || 0,
              hasReserve: item.HasReserve === true,
              reserveState: item.ReserveState != null ? item.ReserveState : null,
              isReserveMet: item.IsReserveMet === true,
              hasBuyNow: item.HasBuyNow === true,
              isBuyNowOnly: item.IsBuyNowOnly === true,
              isNew: item.IsNew === true,
              memberId: item.MemberId || null,
              isDealer: item.IsDealer === true,
              isSuperSeller: item.IsSuperSeller === true,
              hasAfterpay: item.HasAfterpay === true,
              hasPing: item.HasPing === true,
              allowsPickups: item.AllowsPickups || 0,
              category: item.Category,
              categoryPath: item.CategoryPath || null,
              region: item.Region,
              suburb: item.Suburb,
              startDate: item.StartDate ? tmDate(item.StartDate) : null,
              closingDate: item.EndDate ? tmDate(item.EndDate) : null,
              listingLength: item.ListingLength || null,
              asAt: item.AsAt || null,
              photoUrl: item.PictureHref || null,
              photoUrls: item.PhotoUrls || null,
              year: item.Year || null,
              make: item.Make || null,
              model: item.Model || null,
              odometer: item.Odometer || null,
              fuel: item.Fuel || null,
              transmission: item.Transmission || null,
              engineSize: item.EngineSize || null,
              bodyStyle: item.BodyStyle || null
            };
          })
        };
      },
      integrityFilter: tmIntegrityFilter,
      applyPreference: tmApplyPreference
    },

    // ---- RENTAL PROPERTIES ----
    "trademe-rental": {
      name: "Trade Me Rental Properties",
      category: "property",
      description: "Rental properties: flats, houses, rooms for rent in NZ",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["flat", "flats", "rental", "rent", "rentals", "apartment", "apartments", "room", "rooms", "boarding", "unit", "units", "lease", "to rent", "for rent"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A
        var resolved = resolvePlace(opts);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&region=" + resolved.region;
        // Session 60 — sort constants verified from TM website dropdown (Rental)
        var sorts = {"cheapest": "PriceAsc", "lowest rent": "PriceAsc", "lowest price": "PriceAsc", "affordable": "PriceAsc", "budget": "PriceAsc", "most expensive": "PriceDesc", "highest rent": "PriceDesc", "priciest": "PriceDesc", "newest": "ExpiryDesc", "latest": "ExpiryDesc", "just listed": "ExpiryDesc", "recently listed": "ExpiryDesc", "featured": "Default"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        var rows = 500;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Property/Rental.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              address: item.Address || null,
              rentPerWeek: item.RentPerWeek || item.StartPrice || null,
              bedrooms: item.Bedrooms || null,
              bathrooms: item.Bathrooms || null,
              propertyType: item.PropertyType || null,
              availableDate: item.AvailableDate || null,
              region: item.Region,
              suburb: item.Suburb,
              district: item.District || null,
              agency: item.Agency || null,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      }
    },

    // ---- PROPERTY FOR SALE ----
    "trademe-property": {
      name: "Trade Me Property For Sale",
      category: "property",
      description: "Houses, sections, lifestyle blocks for sale in NZ",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["house", "houses", "property", "properties", "section", "sections", "land", "lifestyle", "home", "homes", "buy house", "for sale"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A
        var resolved = resolvePlace(opts);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&region=" + resolved.region;
        // Session 60 — sort constants verified from TM website dropdown (Property family)
        var sorts = {"cheapest": "PriceAsc", "lowest price": "PriceAsc", "affordable": "PriceAsc", "budget": "PriceAsc", "most expensive": "PriceDesc", "highest price": "PriceDesc", "priciest": "PriceDesc", "newest": "ExpiryDesc", "latest": "ExpiryDesc", "just listed": "ExpiryDesc", "recently listed": "ExpiryDesc", "featured": "Default", "premium": "Default", "next open home": "EarliestOpenHome", "soonest open home": "EarliestOpenHome", "earliest open home": "EarliestOpenHome"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        var rows = 500;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Property/Residential.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              address: item.Address || null,
              askingPrice: item.PriceDisplay || item.StartPrice || null,
              bedrooms: item.Bedrooms || null,
              bathrooms: item.Bathrooms || null,
              propertyType: item.PropertyType || null,
              landArea: item.LandArea || null,
              floorArea: item.FloorArea || null,
              rateable: item.RateableValue || null,
              region: item.Region,
              suburb: item.Suburb,
              district: item.District || null,
              agency: item.Agency || null,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      }
    },

    // ---- USED CARS ----
    "trademe-cars": {
      name: "Trade Me Used Cars",
      category: "motors",
      description: "Used cars and vehicles for sale in NZ",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["car", "cars", "vehicle", "vehicles", "auto", "sedan", "suv", "ute", "hatchback", "wagon", "van", "truck", "4wd", "4x4"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A: always include search_string so the
        // API filters by the user's actual search term (e.g. "toyota corolla"),
        // not just the section. Region is added alongside, not instead of.
        var resolved = resolvePlace(opts, true);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&user_region=" + resolved.region;
        // Session 60 — sort constants verified from TM website dropdown
        var sorts = {"cheapest": "MotorsPriceAsc", "lowest price": "MotorsPriceAsc", "affordable": "MotorsPriceAsc", "budget": "MotorsPriceAsc", "most expensive": "MotorsPriceDesc", "highest price": "MotorsPriceDesc", "priciest": "MotorsPriceDesc", "cheapest buy now": "MotorsBuyNowAsc", "lowest buy now": "MotorsBuyNowAsc", "most expensive buy now": "MotorsBuyNowDesc", "highest buy now": "MotorsBuyNowDesc", "newest": "MotorsLatestListings", "latest": "MotorsLatestListings", "just listed": "MotorsLatestListings", "recently listed": "MotorsLatestListings", "lowest km": "MotorsLowestKilometres", "least km": "MotorsLowestKilometres", "lowest mileage": "MotorsLowestKilometres", "lowest odometer": "MotorsLowestKilometres", "highest km": "MotorsHighestKilometres", "most km": "MotorsHighestKilometres", "newest car": "MotorsNewestVehicle", "newest vehicle": "MotorsNewestVehicle", "newest model": "MotorsNewestVehicle", "latest model": "MotorsNewestVehicle", "oldest car": "MotorsOldestVehicle", "oldest vehicle": "MotorsOldestVehicle", "featured": "MotorsFeatureFirst", "closing soon": "MotorsExpiryAsc", "ending soon": "MotorsExpiryAsc"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        params += "&rows=20";
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Motors/Used.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              price: item.PriceDisplay || item.StartPrice || null,
              priceDisplay: item.PriceDisplay || null,
              startPrice: item.StartPrice != null ? item.StartPrice : null,
              buyNowPrice: item.BuyNowPrice != null ? item.BuyNowPrice : null,
              wasPrice: item.WasPrice != null ? item.WasPrice : null,
              percentageOff: item.PercentageOff != null ? item.PercentageOff : null,
              isClearance: item.IsClearance === true,
              hasBuyNow: item.HasBuyNow === true,
              isBuyNowOnly: item.IsBuyNowOnly === true,
              hasReserve: item.HasReserve === true,
              reserveState: item.ReserveState != null ? item.ReserveState : null,
              isReserveMet: item.IsReserveMet === true,
              bidCount: item.BidCount != null ? item.BidCount : 0,
              maxBidAmount: item.MaxBidAmount != null ? item.MaxBidAmount : null,
              isSuperSeller: item.IsSuperSeller === true,
              isDealer: item.IsDealer === true,
              hasAfterpay: item.HasAfterpay === true,
              hasPing: item.HasPing === true,
              allowsPickups: item.AllowsPickups != null ? item.AllowsPickups : null,
              make: item.Make || null,
              model: item.Model || null,
              year: item.Year || null,
              odometer: item.Odometer || null,
              engineSize: item.EngineSize || null,
              transmission: item.Transmission || null,
              bodyStyle: item.BodyStyle || null,
              fuelType: item.FuelType || null,
              region: item.Region,
              suburb: item.Suburb,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      },
      integrityFilter: tmIntegrityFilter,
      applyPreference: tmApplyPreference
    },

    // ---- MOTORBIKES ----
    "trademe-bikes": {
      name: "Trade Me Motorbikes",
      category: "motors",
      description: "Motorbikes and motorcycles for sale in NZ",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      // Session 62 — brand names removed (harley, honda, yamaha, kawasaki,
      // suzuki, ducati). Brands are cross-category; "honda civic" was routing
      // to bikes via word-boundary match on "honda". Descriptor nouns are
      // unambiguous; brand-only queries fall to general search where TM NLU
      // resolves the correct category.
      thingTriggers: ["motorbike", "motorbikes", "motorcycle", "motorcycles", "bike", "bikes"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A
        var resolved = resolvePlace(opts, true);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&user_region=" + resolved.region;
        // Session 60 — sort constants verified from TM website dropdown (Motors family)
        var sorts = {"cheapest": "MotorsPriceAsc", "lowest price": "MotorsPriceAsc", "most expensive": "MotorsPriceDesc", "highest price": "MotorsPriceDesc", "cheapest buy now": "MotorsBuyNowAsc", "most expensive buy now": "MotorsBuyNowDesc", "newest": "MotorsLatestListings", "latest": "MotorsLatestListings", "just listed": "MotorsLatestListings", "lowest km": "MotorsLowestKilometres", "least km": "MotorsLowestKilometres", "newest bike": "MotorsNewestVehicle", "newest model": "MotorsNewestVehicle", "oldest bike": "MotorsOldestVehicle", "featured": "MotorsFeatureFirst", "closing soon": "MotorsExpiryAsc", "ending soon": "MotorsExpiryAsc"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        params += "&rows=20";
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Motors/Bikes.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              price: item.PriceDisplay || item.StartPrice || null,
              priceDisplay: item.PriceDisplay || null,
              startPrice: item.StartPrice != null ? item.StartPrice : null,
              buyNowPrice: item.BuyNowPrice != null ? item.BuyNowPrice : null,
              wasPrice: item.WasPrice != null ? item.WasPrice : null,
              percentageOff: item.PercentageOff != null ? item.PercentageOff : null,
              isClearance: item.IsClearance === true,
              hasBuyNow: item.HasBuyNow === true,
              isBuyNowOnly: item.IsBuyNowOnly === true,
              hasReserve: item.HasReserve === true,
              reserveState: item.ReserveState != null ? item.ReserveState : null,
              isReserveMet: item.IsReserveMet === true,
              bidCount: item.BidCount != null ? item.BidCount : 0,
              maxBidAmount: item.MaxBidAmount != null ? item.MaxBidAmount : null,
              isSuperSeller: item.IsSuperSeller === true,
              isDealer: item.IsDealer === true,
              hasAfterpay: item.HasAfterpay === true,
              hasPing: item.HasPing === true,
              allowsPickups: item.AllowsPickups != null ? item.AllowsPickups : null,
              make: item.Make || null,
              year: item.Year || null,
              engineSize: item.EngineSize || null,
              odometer: item.Odometer || null,
              region: item.Region,
              suburb: item.Suburb,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      },
      integrityFilter: tmIntegrityFilter,
      applyPreference: tmApplyPreference
    },

    // ---- BOATS ----
    "trademe-boats": {
      name: "Trade Me Boats",
      category: "motors",
      description: "Boats and marine vessels for sale in NZ",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["boat", "boats", "yacht", "yachts", "dinghy", "kayak", "jet ski", "jetski", "marine"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A
        var resolved = resolvePlace(opts, true);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&user_region=" + resolved.region;
        // Session 60 — sort constants verified from TM website dropdown (Motors family)
        var sorts = {"cheapest": "MotorsPriceAsc", "lowest price": "MotorsPriceAsc", "most expensive": "MotorsPriceDesc", "highest price": "MotorsPriceDesc", "cheapest buy now": "MotorsBuyNowAsc", "most expensive buy now": "MotorsBuyNowDesc", "newest": "MotorsLatestListings", "latest": "MotorsLatestListings", "just listed": "MotorsLatestListings", "featured": "MotorsFeatureFirst", "closing soon": "MotorsExpiryAsc", "ending soon": "MotorsExpiryAsc"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        params += "&rows=20";
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Motors/Boats.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              price: item.PriceDisplay || item.StartPrice || null,
              priceDisplay: item.PriceDisplay || null,
              startPrice: item.StartPrice != null ? item.StartPrice : null,
              buyNowPrice: item.BuyNowPrice != null ? item.BuyNowPrice : null,
              wasPrice: item.WasPrice != null ? item.WasPrice : null,
              percentageOff: item.PercentageOff != null ? item.PercentageOff : null,
              isClearance: item.IsClearance === true,
              hasBuyNow: item.HasBuyNow === true,
              isBuyNowOnly: item.IsBuyNowOnly === true,
              hasReserve: item.HasReserve === true,
              reserveState: item.ReserveState != null ? item.ReserveState : null,
              isReserveMet: item.IsReserveMet === true,
              bidCount: item.BidCount != null ? item.BidCount : 0,
              maxBidAmount: item.MaxBidAmount != null ? item.MaxBidAmount : null,
              isSuperSeller: item.IsSuperSeller === true,
              isDealer: item.IsDealer === true,
              hasAfterpay: item.HasAfterpay === true,
              hasPing: item.HasPing === true,
              allowsPickups: item.AllowsPickups != null ? item.AllowsPickups : null,
              length: item.Length || null,
              boatType: item.BoatType || null,
              region: item.Region,
              suburb: item.Suburb,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      },
      integrityFilter: tmIntegrityFilter,
      applyPreference: tmApplyPreference
    },

    // ---- JOBS ----
    "trademe-jobs": {
      name: "Trade Me Jobs",
      category: "jobs",
      description: "Job listings across NZ",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["job", "jobs", "work", "employment", "career", "careers", "hiring", "vacancy", "vacancies", "position", "positions"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A
        var resolved = resolvePlace(opts);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&region=" + resolved.region;
        // Session 60 — sort constants verified from TM website dropdown:
        // HighestSalary, LowestSalary, JobsLatestListingDesc, BestMatch, Default
        var sorts = {"highest pay": "HighestSalary", "highest paying": "HighestSalary", "best paid": "HighestSalary", "top paying": "HighestSalary", "most pay": "HighestSalary", "highest salary": "HighestSalary", "lowest pay": "LowestSalary", "lowest salary": "LowestSalary", "newest": "JobsLatestListingDesc", "latest": "JobsLatestListingDesc", "just listed": "JobsLatestListingDesc", "recently listed": "JobsLatestListingDesc", "closing soon": "ExpiryAsc", "ending soon": "ExpiryAsc", "best match": "BestMatch", "most relevant": "BestMatch", "featured": "Default", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        params += "&rows=20";
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Jobs.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              company: item.Company || null,
              salary: item.Salary || null,
              jobType: item.JobType || null,
              contractDuration: item.ContractDuration || null,
              region: item.Region,
              suburb: item.Suburb,
              district: item.District || null,
              closingDate: item.EndDate ? tmDate(item.EndDate) : null,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      }
    },

    // ---- FLATMATES ----
    "trademe-flatmates": {
      name: "Trade Me Flatmates Wanted",
      category: "flatmates",
      description: "Flatmates wanted and rooms available in NZ",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["flatmate", "flatmates", "roommate", "roommates", "shared", "share house", "boarding"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A
        var resolved = resolvePlace(opts);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&region=" + resolved.region;
        params += "&rows=20";
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Flatmates.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              rentPerWeek: item.RentPerWeek || item.StartPrice || null,
              currentFlatmates: item.CurrentFlatmates || null,
              idealFlatmate: item.IdealFlatmate || null,
              availableDate: item.AvailableDate || null,
              region: item.Region,
              suburb: item.Suburb,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      }
    },

    // ---- CATEGORY TREE ----
    "trademe-categories": {
      name: "Trade Me Category Tree",
      category: "reference",
      description: "Full marketplace category hierarchy with drill-down",
      queryByName: function(query, opts) {
        if (opts && opts.category) {
          return TM_BASE + "/Categories/" + encodeURIComponent(opts.category) + ".json";
        }
        return TM_BASE + "/Categories.json";
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.Subcategories) return null;
        var result = {
          name: data.Name,
          number: data.Number || null,
          path: data.Path || null,
          isSubcategory: !!data.Number
        };
        result.subcategories = data.Subcategories.map(function(cat) {
          return {
            name: cat.Name,
            number: cat.Number,
            path: cat.Path,
            subcategoryCount: cat.Subcategories ? cat.Subcategories.length : 0,
            hasClassifieds: cat.HasClassifieds || false,
            isLeaf: cat.IsLeaf || false
          };
        });
        if (!data.Number) {
          result.topLevel = result.subcategories;
        }
        return result;
      }
    },

    // ---- LOCALITIES ----
    "trademe-localities": {
      name: "Trade Me Localities",
      category: "reference",
      description: "NZ regions, districts, and suburbs hierarchy",
      qualifiesWhen: ["place"],
      queryByName: function() {
        return TM_BASE + "/Localities.json";
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !Array.isArray(data)) return null;
        return {
          regions: data.map(function(r) {
            return {
              id: r.LocalityId,
              name: r.Name,
              districtCount: r.Districts ? r.Districts.length : 0
            };
          })
        };
      }
    },

    // ---- SITE STATISTICS (Session 43, v1.1.0) ----
    "trademe-stats": {
      name: "Trade Me Site Statistics",
      category: "reference",
      description: "Live marketplace vitals: members online, active members, active listings",
      qualifiesWhen: [],
      queryByName: function() {
        return TM_BASE + "/SiteStats.json";
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data) return null;
        return {
          membersOnline: data.MembersOnline || 0,
          activeMembers: data.ActiveMembers || 0,
          activeListings: data.ActiveListings || 0,
          polledAt: new Date().toISOString()
        };
      }
    },

    // ---- COMMERCIAL PROPERTY FOR SALE (Session 43, v1.2.0) ----
    "trademe-commercial-sale": {
      name: "Trade Me Commercial Sale",
      category: "property",
      description: "Commercial properties for sale — offices, retail, industrial, land",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["commercial", "office", "offices", "retail", "industrial", "warehouse", "factory", "shop", "business premises", "commercial property", "commercial sale"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A
        var resolved = resolvePlace(opts);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&region=" + resolved.region;
        // Session 60 — sort constants verified from TM website dropdown
        var sorts = {"cheapest": "PriceAsc", "lowest price": "PriceAsc", "most expensive": "PriceDesc", "highest price": "PriceDesc", "newest": "ExpiryDesc", "latest": "ExpiryDesc", "just listed": "ExpiryDesc", "recently listed": "ExpiryDesc", "featured": "Default", "premium": "Default", "next open home": "EarliestOpenHome", "soonest open home": "EarliestOpenHome", "earliest open home": "EarliestOpenHome"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        var rows = 500;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Property/CommercialSale.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              address: item.Address || null,
              askingPrice: item.PriceDisplay || item.StartPrice || null,
              propertyType: item.PropertyType || null,
              landArea: item.LandArea || null,
              floorArea: item.FloorArea || null,
              region: item.Region,
              suburb: item.Suburb,
              district: item.District || null,
              agency: item.Agency || null,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      }
    },

    // ---- COMMERCIAL PROPERTY FOR LEASE (Session 43, v1.2.0) ----
    "trademe-commercial-lease": {
      name: "Trade Me Commercial Lease",
      category: "property",
      description: "Commercial properties for lease — offices, retail, industrial spaces",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["lease", "leasing", "commercial lease", "office lease", "retail lease", "industrial lease", "warehouse lease", "office space", "retail space"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A
        var resolved = resolvePlace(opts);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&region=" + resolved.region;
        // Session 60 — sort constants verified from TM website dropdown (Rental)
        var sorts = {"cheapest": "PriceAsc", "lowest rent": "PriceAsc", "lowest price": "PriceAsc", "affordable": "PriceAsc", "most expensive": "PriceDesc", "highest rent": "PriceDesc", "priciest": "PriceDesc", "newest": "ExpiryDesc", "latest": "ExpiryDesc", "just listed": "ExpiryDesc", "recently listed": "ExpiryDesc", "featured": "Default"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        var rows = 500;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Property/CommercialLease.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              address: item.Address || null,
              rentPerAnnum: item.RentPerAnnum || null,
              rentDisplay: item.PriceDisplay || null,
              propertyType: item.PropertyType || null,
              landArea: item.LandArea || null,
              floorArea: item.FloorArea || null,
              region: item.Region,
              suburb: item.Suburb,
              district: item.District || null,
              agency: item.Agency || null,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      }
    },

    // ---- LIFESTYLE PROPERTY (Session 43, v1.3.1) ----
    "trademe-lifestyle": {
      name: "Trade Me Lifestyle Property",
      category: "property",
      description: "Lifestyle blocks, smallholdings, hobby farms for sale in NZ",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["lifestyle", "lifestyle block", "lifestyle blocks", "smallholding", "hobby farm", "small farm", "tramping", "tramping land", "acre", "acres", "hectare", "hectares"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A
        var resolved = resolvePlace(opts);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&region=" + resolved.region;
        // Session 60 — sort constants verified from TM website dropdown (Property family)
        var sorts = {"cheapest": "PriceAsc", "lowest price": "PriceAsc", "most expensive": "PriceDesc", "highest price": "PriceDesc", "newest": "ExpiryDesc", "latest": "ExpiryDesc", "just listed": "ExpiryDesc", "recently listed": "ExpiryDesc", "biggest": "LandAreaDesc", "largest": "LandAreaDesc", "most land": "LandAreaDesc", "smallest": "LandArea", "least land": "LandArea", "featured": "Default"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        var rows = 500;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Property/Lifestyle.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              address: item.Address || null,
              askingPrice: item.PriceDisplay || item.StartPrice || null,
              propertyType: item.PropertyType || null,
              landArea: item.LandArea || null,
              floorArea: item.FloorArea || null,
              bedrooms: item.Bedrooms || null,
              bathrooms: item.Bathrooms || null,
              region: item.Region,
              suburb: item.Suburb,
              district: item.District || null,
              agency: item.Agency || null,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      }
    },

    // ---- RURAL PROPERTY (Session 43, v1.3.1) ----
    "trademe-rural": {
      name: "Trade Me Rural Property",
      category: "property",
      description: "Rural properties, farms, dairy, horticulture land for sale",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["rural", "farm", "farms", "farming", "dairy", "dairy farm", "horticulture", "viticulture", "vineyard", "orchard", "pastoral", "arable", "forestry", "grazing"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A
        var resolved = resolvePlace(opts);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&region=" + resolved.region;
        // Session 60 — sort constants verified from TM website dropdown (Property family)
        var sorts = {"cheapest": "PriceAsc", "lowest price": "PriceAsc", "most expensive": "PriceDesc", "highest price": "PriceDesc", "newest": "ExpiryDesc", "latest": "ExpiryDesc", "just listed": "ExpiryDesc", "recently listed": "ExpiryDesc", "biggest": "LandAreaDesc", "largest": "LandAreaDesc", "most land": "LandAreaDesc", "featured": "Default"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        var rows = 500;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Property/Rural.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              address: item.Address || null,
              askingPrice: item.PriceDisplay || item.StartPrice || null,
              propertyType: item.PropertyType || null,
              landArea: item.LandArea || null,
              floorArea: item.FloorArea || null,
              region: item.Region,
              suburb: item.Suburb,
              district: item.District || null,
              agency: item.Agency || null,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      }
    },

    // ---- OPEN HOMES (Session 43, v1.3.1) ----
    "trademe-open-homes": {
      name: "Trade Me Open Homes",
      category: "property",
      description: "Upcoming open home inspections schedule",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["open home", "open homes", "open house", "inspection", "inspections", "viewing", "viewings"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A
        var resolved = resolvePlace(opts);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&region=" + resolved.region;
        // Session 60 — sort constants verified from TM website dropdown
        var sorts = {"cheapest": "PriceAsc", "lowest price": "PriceAsc", "most expensive": "PriceDesc", "highest price": "PriceDesc", "soonest": "EarliestOpenHome", "next": "EarliestOpenHome", "earliest": "EarliestOpenHome", "next open home": "EarliestOpenHome", "newest": "ExpiryDesc", "latest": "ExpiryDesc", "just listed": "ExpiryDesc", "featured": "Default"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        var rows = 500;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Property/OpenHomes.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              address: item.Address || null,
              askingPrice: item.PriceDisplay || item.StartPrice || null,
              openHomeStart: item.OpenHomeStart || item.OpenHome || null,
              openHomeEnd: item.OpenHomeEnd || null,
              bedrooms: item.Bedrooms || null,
              bathrooms: item.Bathrooms || null,
              propertyType: item.PropertyType || null,
              region: item.Region,
              suburb: item.Suburb,
              district: item.District || null,
              agency: item.Agency || null,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      }
    },

    // ---- RETIREMENT VILLAGES (Session 43, v1.3.1) ----
    "trademe-retirement": {
      name: "Trade Me Retirement Villages",
      category: "property",
      description: "Retirement village units and lifestyle villages",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["retirement", "retirement village", "retirement villages", "over 55", "over 65", "lifestyle village", "rest home", "retirement unit"],
      queryByName: function(query, opts) {
        // Session 60 fix — Pattern A
        var resolved = resolvePlace(opts);
        var searchTerm = query;
        if (resolved.searchTerm) searchTerm = searchTerm + " " + resolved.searchTerm;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (resolved.region !== null) params += "&region=" + resolved.region;
        // Session 60 — sort constants verified from TM website dropdown (Property family)
        var sorts = {"cheapest": "PriceAsc", "lowest price": "PriceAsc", "most expensive": "PriceDesc", "highest price": "PriceDesc", "newest": "ExpiryDesc", "latest": "ExpiryDesc", "just listed": "ExpiryDesc", "recently listed": "ExpiryDesc", "featured": "Default"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        var rows = 500;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Property/Retirement.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              address: item.Address || null,
              askingPrice: item.PriceDisplay || item.StartPrice || null,
              propertyType: item.PropertyType || null,
              bedrooms: item.Bedrooms || null,
              bathrooms: item.Bathrooms || null,
              region: item.Region,
              suburb: item.Suburb,
              district: item.District || null,
              agency: item.Agency || null,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              photoUrl: item.PictureHref || null
            };
          })
        };
      }
    },

    // ---- STORE SEARCH (Session 43, v1.3.1) ----
    "trademe-stores": {
      name: "Trade Me Stores",
      category: "marketplace",
      description: "Search listings within a specific Trade Me store by seller",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      thingTriggers: ["store", "stores", "shop", "seller store", "trademe store"],
      queryByName: function(query, opts) {
        var searchTerm = (opts && opts.raw) ? opts.raw : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        // Session 60 — sort constants verified from TM website dropdown (General Search family)
        var sorts = {"cheapest": "PriceAsc", "lowest price": "PriceAsc", "affordable": "PriceAsc", "most expensive": "PriceDesc", "highest price": "PriceDesc", "newest": "ExpiryDesc", "just listed": "ExpiryDesc", "latest": "ExpiryDesc", "recently listed": "ExpiryDesc", "closing soon": "ExpiryAsc", "ending soon": "ExpiryAsc", "most bids": "BidsMost", "highest bids": "BidsMost", "high bid count": "BidsMost", "best match": "Default", "most relevant": "Default", "biggest discount": "LargestDiscount", "best deal": "LargestDiscount"};
        var s = resolveSortOrder(opts, sorts);
        if (s) params += "&sort_order=" + s;
        var rows = 500;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
        params = appendAttributeParams(params, opts, opts._moduleId || "");
        return TM_BASE + "/Search/Stores.json?" + params;
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.List) return null;
        return {
          totalCount: data.TotalCount,
          listings: data.List.map(function(item) {
            return {
              id: item.ListingId || item.StoreId || null,
              title: item.Title || item.StoreName || item.Name || null,
              url: item.ListingId ? "https://www.trademe.co.nz/a/listing/" + item.ListingId : null,
              storeUrl: item.StoreUrl || null,
              priceDisplay: item.PriceDisplay || null,
              startPrice: item.StartPrice != null ? item.StartPrice : null,
              bidCount: item.BidCount != null ? item.BidCount : 0,
              region: item.Region || null,
              suburb: item.Suburb || null,
              photoUrl: item.PictureHref || item.Logo || null
            };
          })
        };
      }
    },

    // ---- LISTING DETAIL (Session 37, v1.10.0) ----
    "trademe-listing-detail": {
      name: "Trade Me Listing Detail",
      category: "marketplace",
      description: "Full detail for a single Trade Me listing by ID",
      qualifiesWhen: ["listing_id"],
      primaryField: "listing_id",
      queryByName: function(listingId) {
        // S83-F10 v2: bare endpoint — Questions array is included naturally
        // alongside ViewCount/BidderAndWatchers/Body. v1.14.0's attempt to
        // add ?return_questions=true triggered an auth gate (TM's docs
        // describe that param as a premium feature), but the param turns
        // out to be unnecessary because the bare endpoint already
        // surfaces Questions to unauth callers.
        return TM_BASE + "/Listings/" + encodeURIComponent(listingId) + ".json";
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data || !data.ListingId) return null;
        var photos = [];
        if (Array.isArray(data.Photos)) {
          data.Photos.forEach(function(p) {
            var v = (p && p.Value) ? p.Value : p;
            if (!v) return;
            photos.push({
              id: v.PhotoId || (p && p.Key) || null,
              thumbnail: v.Thumbnail || null,
              medium: v.Medium || null,
              large: v.Large || null,
              full: v.FullSize || v.Full || null,
              gallery: v.Gallery || null,
              plus: v.Plus || null
            });
          });
        } else if (Array.isArray(data.PhotoUrls)) {
          data.PhotoUrls.forEach(function(u) {
            photos.push({ id: null, thumbnail: u, medium: u, large: u, full: u, gallery: u, plus: null });
          });
        }
        var attributes = [];
        if (Array.isArray(data.Attributes)) {
          data.Attributes.forEach(function(a) {
            if (!a) return;
            attributes.push({
              name: a.Name || null,
              displayName: a.DisplayName || a.Name || null,
              value: a.Value != null ? a.Value : null
            });
          });
        }
        var memberRaw = data.Member || data.AskingMember || null;
        var member = null;
        if (memberRaw) {
          member = {
            id: memberRaw.MemberId || null,
            nickname: memberRaw.Nickname || null,
            feedbackCount: memberRaw.FeedbackCount != null ? memberRaw.FeedbackCount : null,
            uniquePositive: memberRaw.UniquePositive != null ? memberRaw.UniquePositive : null,
            uniqueNegative: memberRaw.UniqueNegative != null ? memberRaw.UniqueNegative : null,
            dateJoined: memberRaw.DateJoined || null,
            isDealer: memberRaw.IsDealer === true,
            isAddressVerified: memberRaw.IsAddressVerified === true,
            isAuthenticated: memberRaw.IsAuthenticated === true,
            photoUrl: memberRaw.Photo || null
          };
        }
        var shipping = [];
        if (Array.isArray(data.ShippingOptions)) {
          data.ShippingOptions.forEach(function(s) {
            if (!s) return;
            shipping.push({
              type: s.Type || null,
              price: s.Price != null ? s.Price : null,
              method: s.ShippingMethod || null
            });
          });
        }
        var pickup = null;
        if (data.PickupLocality) {
          pickup = {
            suburb: data.PickupLocality.Suburb || null,
            district: data.PickupLocality.District || null,
            region: data.PickupLocality.Region || null
          };
        }
        // v1.11.5 — GeographicLocation extraction. TM's JSON API
        // exposes lat/lng at the top level for property listings;
        // proved by v1.11.4's recursive key walk against listing
        // 5686128595 (Whanganui). Pull out the two fields downstream
        // consumers need — the homes.co.nz enrichment adapter, any
        // future LINZ-parcel join, and the consolidated-result join
        // key — and normalise field names (Latitude → latitude).
        // Deep-location objects (GeographicLocation, MapLocation)
        // may carry Northing/Easting/Accuracy too; we only surface
        // the WGS84 pair since that's all enrichment needs.
        var latitude = null, longitude = null;
        if (data.GeographicLocation && typeof data.GeographicLocation === "object") {
          var gl = data.GeographicLocation;
          if (typeof gl.Latitude === "number" && typeof gl.Longitude === "number") {
            // NZ sanity range — rejects any accidental off-globe values
            if (gl.Latitude > -48 && gl.Latitude < -33 &&
                gl.Longitude > 165 && gl.Longitude < 180) {
              latitude = gl.Latitude;
              longitude = gl.Longitude;
            }
          }
        }
        return {
          id: data.ListingId,
          title: data.Title || null,
          subtitle: data.Subtitle || null,
          body: data.Body || null,
          url: "https://www.trademe.co.nz/a/listing/" + data.ListingId,
          latitude: latitude,
          longitude: longitude,
          priceDisplay: data.PriceDisplay || null,
          startPrice: data.StartPrice != null ? data.StartPrice : null,
          buyNowPrice: data.BuyNowPrice != null ? data.BuyNowPrice : null,
          wasPrice: data.WasPrice != null ? data.WasPrice : null,
          percentageOff: data.PercentageOff != null ? data.PercentageOff : null,
          isClearance: data.IsClearance === true,
          maxBidAmount: data.MaxBidAmount != null ? data.MaxBidAmount : null,
          minimumNextBidAmount: data.MinimumNextBidAmount != null ? data.MinimumNextBidAmount : null,
          bidCount: data.BidCount != null ? data.BidCount : 0,
          bidderAndWatchers: data.BidderAndWatchers != null ? data.BidderAndWatchers : null,
          hasReserve: data.HasReserve === true,
          reserveState: data.ReserveState != null ? data.ReserveState : null,
          isReserveMet: data.IsReserveMet === true,
          hasBuyNow: data.HasBuyNow === true,
          isBuyNowOnly: data.IsBuyNowOnly === true,
          isNew: data.IsNew === true,
          isFeatured: data.IsFeatured === true,
          isBold: data.IsBold === true,
          isHighlighted: data.IsHighlighted === true,
          isClassified: data.IsClassified === true,
          hasPayNow: data.HasPayNow === true,
          hasAfterpay: data.HasAfterpay === true,
          hasPing: data.HasPing === true,
          allowsPickups: data.AllowsPickups != null ? data.AllowsPickups : 0,
          member: member,
          memberId: data.MemberId || (member ? member.id : null),
          isDealer: data.IsDealer === true || (member ? member.isDealer === true : false),
          isSuperSeller: data.IsSuperSeller === true,
          category: data.Category || null,
          categoryPath: data.CategoryPath || null,
          categoryName: data.CategoryName || null,
          startDate: data.StartDate || null,
          closingDate: data.EndDate || null,
          asAt: data.AsAt || null,
          listingLength: data.ListingLength || null,
          region: data.Region || null,
          suburb: data.Suburb || null,
          pickupLocality: pickup,
          viewCount: data.ViewCount != null ? data.ViewCount : null,
          // S83-F10e1 — TM's `Questions` is an OBJECT (<Questions>) per dev
          // docs at /api-reference/listing-methods/retrieve-the-details-of-
          // a-single-listing, with shape:
          //   Questions: { TotalCount: <int>, List: [<Question>, ...] | null }
          // For UNAUTH callers TM strips `List` (returns null/empty) but
          // KEEPS `TotalCount` populated — that's the free gate signal we
          // need to lazy-fire Spider only when count > 0. v1.14.8 read
          // `data.Questions.length` (treated as array) and silently captured
          // 0 for every listing — UI was always firing Spider blind.
          //
          // Belt-and-braces: also handle the (theoretical) case where TM
          // ever returns Questions as a flat array — fall back to .length.
          questionCount: (function() {
            var q = data.Questions;
            if (!q) return 0;
            if (Array.isArray(q)) return q.length;
            if (typeof q.TotalCount === 'number') return q.TotalCount;
            if (Array.isArray(q.List)) return q.List.length;
            return 0;
          })(),
          // Bonus signals from the same endpoint:
          //   - UnansweredQuestionCount (Integer or null) — useful for
          //     "X open questions" UX hints
          //   - SupportsQuestionsAndAnswers (Boolean) — kill-switch; some
          //     categories (e.g. classifieds) disable Q&A entirely
          unansweredQuestionCount: typeof data.UnansweredQuestionCount === 'number' ? data.UnansweredQuestionCount : null,
          supportsQuestionsAndAnswers: data.SupportsQuestionsAndAnswers !== false,
          // S83-F10f — Bare TM unauth API DOES return Questions.List, but
          // every item is a shell: answer=null, askerNickname masked
          // ("r********i"), askedDate in raw .NET format ("/Date(123)/"),
          // and crucially NO answer body. Stitching these shells onto
          // detail.questions broke the lazy gate (UI saw a non-empty array
          // and thought Spider had run, so answers never appeared).
          // v1.14.10 leaves the array empty — Spider's HTML scrape is the
          // authoritative source. Bare API only contributes questionCount.
          questions: [],
          noteDate: data.NoteDate || null,
          photos: photos,
          photoCount: photos.length,
          attributes: attributes,
          shipping: shipping,
          year: data.Year || null,
          make: data.Make || null,
          model: data.Model || null,
          odometer: data.Odometer || null,
          fuelType: data.FuelType || null,
          transmission: data.Transmission || null,
          engineSize: data.EngineSize || null,
          bodyStyle: data.BodyStyle || null
        };
      }
    },

    // ---- LISTING GEO — DELETED (Session 79, v1.11.5) ----
    // This slot used to hold trademe-listing-geo, an HTML-scrape module
    // that fetched the public listing page for lat/lng. v1.11.4's JSON
    // API probe proved TM's /v1/Listings/{id}.json exposes
    // GeographicLocation.Latitude / GeographicLocation.Longitude at
    // the top level. trademe-listing-detail's parser now extracts
    // these fields directly, saving a network hop. Kung fu lesson
    // banked: walk the JSON API recursively BEFORE drifting to
    // HTML-scrape. See insight_public_api_discovery_kungfu.md.

    // ---- LISTING Q&A (Session 83, v1.14.3) — Two-stage anon-JWT pattern ----
    // The bare /v1/Listings/{id}/Questions.json endpoint requires
    // application credentials (a Bearer JWT). The frontend never sends
    // OAuth — it uses an anonymous JWT issued automatically to any
    // visitor in the SSR state at NGRX_STATE.auth.token, plus the
    // tradeMeClientId at NGRX_STATE.tradeMeClientId. Both anonymous
    // values are minted by TM for ANY caller (including bots — the
    // 99KB stub we get from Cloud Function still contains them).
    //
    // Two-stage fetch:
    //   Stage 1 — GET /a/marketplace/listing/{id} (no auth)
    //             extract auth.token + tradeMeClientId from frend-state JSON
    //   Stage 2 — GET api.trademe.co.nz/v1/listings/{id}/questions.json
    //             with Authorization: Bearer <token>
    //                  x-trademe-uniqueclientid: <clientId>
    //
    // Returns parsed Questions list plus _qProbe diagnostics.
    //
    // Module marked customFetch:true so investigateListing uses the
    // dedicated Promise chain below instead of the standard runModule
    // single-fetch flow.
    "trademe-listing-questions": {
      name: "Trade Me Listing Q&A",
      category: "marketplace",
      description: "Q&A thread for a single Trade Me listing (anon-JWT API call)",
      qualifiesWhen: ["listing_id"],
      primaryField: "listing_id",
      customFetch: true,  // signal to investigateListing to use fetchListingQuestions()
      timeoutMs: 8000
    },

    // ---- SIMILAR LISTINGS (Session 37, v1.10.0) ----
    "trademe-similar": {
      name: "Trade Me Similar Listings",
      category: "marketplace",
      description: "Listings similar to a given Trade Me listing ID",
      qualifiesWhen: ["listing_id"],
      primaryField: "listing_id",
      queryByName: function(listingId) {
        return TM_BASE + "/Listings/" + encodeURIComponent(listingId) + "/Similar.json";
      },
      fetchHeaders: TM_HEADERS,
      parse: function(data) {
        if (!data) return null;
        var listRaw = null;
        var totalCount = null;
        if (data.RelatedListings && Array.isArray(data.RelatedListings.List)) {
          listRaw = data.RelatedListings.List;
          totalCount = data.RelatedListings.TotalCount != null ? data.RelatedListings.TotalCount : listRaw.length;
        } else if (Array.isArray(data.List)) {
          listRaw = data.List;
          totalCount = data.TotalCount != null ? data.TotalCount : listRaw.length;
        } else if (Array.isArray(data)) {
          listRaw = data;
          totalCount = listRaw.length;
        }
        if (!listRaw) return null;
        return {
          totalCount: totalCount,
          listings: listRaw.map(function(item) {
            return {
              id: item.ListingId,
              title: item.Title,
              url: "https://www.trademe.co.nz/a/listing/" + item.ListingId,
              priceDisplay: item.PriceDisplay || null,
              startPrice: item.StartPrice != null ? item.StartPrice : null,
              buyNowPrice: item.BuyNowPrice != null ? item.BuyNowPrice : null,
              wasPrice: item.WasPrice != null ? item.WasPrice : null,
              percentageOff: item.PercentageOff != null ? item.PercentageOff : null,
              bidCount: item.BidCount != null ? item.BidCount : 0,
              hasReserve: item.HasReserve === true,
              isReserveMet: item.IsReserveMet === true,
              hasBuyNow: item.HasBuyNow === true,
              isBuyNowOnly: item.IsBuyNowOnly === true,
              region: item.Region || null,
              suburb: item.Suburb || null,
              closingDate: item.EndDate ? tmDate(item.EndDate) : null,
              photoUrl: item.PictureHref || null
            };
          })
        };
      }
    }
  };

  // ── ORCHESTRATION ─────────────────────────────────────────────
  // The cartridge owns its own Guess Who filtering, specialist
  // suppression, and all five investigation routes.

  // Run a single module with integrity + preference gates
  // v1.10.1 — strip attribute params from a URL. Used by the retry
  // defense below when the initial call 400s due to bad attribute values.
  // Removes any param that came from appendAttributeParams (i.e. any
  // param NOT in the base set: search_string, sort_order, rows, region,
  // price_min, price_max, page, category, date_from).
  var BASE_PARAMS = { search_string:1, sort_order:1, rows:1, region:1, price_min:1, price_max:1, page:1, category:1, date_from:1 };
  function stripAttributeParams(url) {
    var qIdx = url.indexOf("?");
    if (qIdx === -1) return url;
    var base = url.substring(0, qIdx);
    var qs = url.substring(qIdx + 1);
    var parts = qs.split("&");
    var kept = [];
    for (var i = 0; i < parts.length; i++) {
      var eqIdx = parts[i].indexOf("=");
      var key = eqIdx > -1 ? parts[i].substring(0, eqIdx) : parts[i];
      if (BASE_PARAMS[key]) kept.push(parts[i]);
    }
    return kept.length > 0 ? base + "?" + kept.join("&") : base;
  }

  function runModule(name, url, mod, opts) {
    // v1.11.0 — modules with parseAs:'text' get HTML-scrape fetch
    // (returns res.text() instead of res.json()). Everything else
    // uses the JSON path. Added for trademe-listing-geo.
    var fetcher = (mod.parseAs === "text") ? fetchText : fetchJson;
    return fetcher(url, mod.timeoutMs || null, mod.fetchHeaders || null).then(function(data) {
      var parsed = mod.parse(data);
      if (parsed && mod.integrityFilter) {
        parsed = mod.integrityFilter(parsed, opts);
      }
      if (parsed && mod.applyPreference) {
        parsed = mod.applyPreference(parsed, opts);
      }
      return { module: name, name: mod.name, category: mod.category, status: parsed ? "ok" : "empty", data: parsed };
    }).catch(function(err) {
      // v1.10.1 — attribute retry defense. If the API returns 400
      // and the URL contains attribute params beyond the base set,
      // retry without them. Attributes are optional enrichments;
      // a bad value should narrow results, not kill the search.
      if (err.message && err.message.indexOf("400") !== -1) {
        var cleanUrl = stripAttributeParams(url);
        if (cleanUrl !== url) {
          console.log("[trademe] " + name + ": 400 with attributes, retrying without → " + cleanUrl.substring(cleanUrl.indexOf("?") + 1, cleanUrl.indexOf("?") + 80));
          return fetchJson(cleanUrl, null, mod.fetchHeaders || null).then(function(retryData) {
            var parsed = mod.parse(retryData);
            if (parsed && mod.integrityFilter) {
              parsed = mod.integrityFilter(parsed, opts);
            }
            if (parsed && mod.applyPreference) {
              parsed = mod.applyPreference(parsed, opts);
            }
            return { module: name, name: mod.name, category: mod.category, status: parsed ? "ok" : "empty", data: parsed, _retried: true };
          }).catch(function(retryErr) {
            return { module: name, name: mod.name, category: mod.category, status: "error", error: retryErr.message, _retried: true };
          });
        }
      }
      return { module: name, name: mod.name, category: mod.category, status: "error", error: err.message };
    });
  }

  // Guess Who: qualify which modules should fire for this query
  function qualifyModules(opts) {
    var thingLower = opts.thing ? opts.thing.toLowerCase() : null;
    var active = Object.keys(modules).filter(function(name) {
      var mod = modules[name];
      if (!mod) return false;
      if (mod.qualifiesWhen) {
        for (var q = 0; q < mod.qualifiesWhen.length; q++) {
          if (!opts[mod.qualifiesWhen[q]]) return false;
        }
        if (mod.thingTriggers && thingLower) {
          var matched = false;
          for (var t = 0; t < mod.thingTriggers.length; t++) {
            if (thingLower.indexOf(mod.thingTriggers[t]) !== -1) { matched = true; break; }
          }
          if (!matched) return false;
        }
        return true;
      }
      return false;
    });

    // Specialist suppression: if any specialist qualified, suppress General Search
    var hasSpecialist = active.some(function(n) { return modules[n] && modules[n].thingTriggers; });
    if (hasSpecialist && active.indexOf("trademe") !== -1) {
      active = active.filter(function(n) { return n !== "trademe"; });
    }

    return { modules: active, hasSpecialist: hasSpecialist };
  }

  // Build result envelope (byte-compatible with sweep output)
  function buildResult(results, query, start) {
    var response = {
      cartridge: meta.id,
      version: meta.version,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - start,
      query: query,
      modules: {},
      summary: { total: 0, ok: 0, errors: 0, empty: 0 }
    };
    var ok = 0, errors = 0;
    results.forEach(function(r) {
      response.modules[r.module] = r;
      if (r.status === "ok") ok++;
      if (r.status === "error") errors++;
    });
    response.summary = { total: results.length, ok: ok, errors: errors, empty: results.length - ok - errors };
    return response;
  }

  // ── ENTRY POINT ───────────────────────────────────────────────
  // The kit-runner calls run(params). Params contains all IoQL
  // fields: thing, place, qualifier, scope, preference, raw,
  // category, region, listing_id, plus modules[] if selective.

  function run(params) {
    var opts = params || {};
    var start = Date.now();

    // Route 1: Listing detail (listing_id present)
    if (opts.listing_id) {
      return investigateListing(opts.listing_id, opts, start);
    }

    // Route 2: Category browse (category present, no thing)
    if (opts.category && !opts.thing) {
      return investigateCategoryOnly(opts.category, opts, start);
    }

    // Route 3: Region browse (region present, may have thing)
    if (opts.region && !opts.category && !opts.listing_id) {
      return investigateRegionOnly(opts.region, opts, start);
    }

    // Route 4: Standard search (thing required for most modules)

    // ── Price pre-query (v1.5.1) ────────────────────────────────
    // TM's General Search ignores price_min/price_max unless a
    // category is also present. When the user provides a price but
    // no category, do a lightweight rows=1 preflight to discover
    // the top category, then inject it into opts so the real query
    // gets filtered results. Only fires when needed (~300 ms).
    var pricePre = Promise.resolve();
    if (opts.price && !opts.category && opts.thing) {
      pricePre = fetchJson(
        TM_BASE + "/Search/General.json?search_string=" + encodeURIComponent(opts.thing) + "&rows=1",
        5000,
        TM_HEADERS
      ).then(function(data) {
        if (data && data.FoundCategories && data.FoundCategories.length > 0) {
          opts.category = String(data.FoundCategories[0].Category);
          console.log("[trademe] Price pre-query: auto-category " + opts.category);
        }
      }).catch(function(e) {
        console.log("[trademe] Price pre-query failed: " + e.message);
      });
    }

    return pricePre.then(function() {
      // v1.10.0 — resolver-authoritative dispatch.
      //
      // When opts.modules is a non-empty array, the resolver has already
      // decided the section-correct set (e.g. lane=rent + thing=house →
      // ['trademe-rental']). Honour it verbatim and skip qualifyModules.
      // Filter to known modules only for safety (unknown names are no-ops).
      //
      // When opts.modules is absent, fall back to the Guess-Who auto-
      // qualifier — preserves v1.9.0 behaviour for direct /api/kit-runner
      // callers that don't go through the resolver.
      //
      // Prior behaviour (intersect with qualifyModules output) silently
      // dropped resolver picks whenever the cartridge's trigger match
      // disagreed with the resolver's section decision. Session 52.
      var active;
      var qualified;
      if (opts.modules && Array.isArray(opts.modules) && opts.modules.length > 0) {
        active = opts.modules.filter(function(n) { return !!modules[n]; });
        qualified = { modules: active, hasSpecialist: false };
        console.log("[trademe] Resolver-directed: " + active.length + "/" + opts.modules.length + " requested modules recognised");
      } else {
        qualified = qualifyModules(opts);
        active = qualified.modules;
        console.log("[trademe] Qualified: " + active.length + "/" + Object.keys(modules).length + (qualified.hasSpecialist ? " (specialist matched)" : ""));
      }

      var tasks = active.map(function(name) {
        var mod = modules[name];
        var queryValue = null;
        if (mod.primaryField && opts[mod.primaryField]) {
          queryValue = opts[mod.primaryField];
        } else if (opts.place) {
          queryValue = opts.place;
        }
        if (!queryValue && !mod.queryByName) {
          return Promise.resolve({ module: name, name: mod.name, category: mod.category, status: "no_query", data: null });
        }
        opts._moduleId = name;  // Tag for appendAttributeParams (v1.6.0)
        var url = mod.queryByName(queryValue || "", opts);
        return runModule(name, url, mod, opts);
      });

      return Promise.all(tasks).then(function(results) {
        return buildResult(results, {
          place: opts.place || null,
          lat: opts.lat || null,
          lng: opts.lng || null,
          thing: opts.thing || null,
          qualifier: opts.qualifier || null,
          scope: opts.scope || null,
          preference: opts.preference || null,
          raw: opts.raw || null
        }, start);
      });
    });
  }

  // ── DEDICATED ROUTES ──────────────────────────────────────────

  // S83-F10d — MULTI-VARIANT PROBE.
  // Logged-out incognito Chrome navigation gets full 430KB SSR with Q&A
  // (Shonty proved with screenshot). Cookieless server fetch gets 99KB
  // bot stub. Find which fetch shape closes the gap.
  //
  // Tries three variants in PARALLEL:
  //   A — bare fetch (current cartridge behaviour)
  //   B — navigation-shaped headers (Sec-Fetch-Dest:document, etc.)
  //   C — two-stage cookie warming via /a/ home then re-fetch listing
  //
  // For each variant: htmlLen + first 200 chars + parse-stage + Q count
  // if reachable. The winner is whichever returns 430KB+ with Q&A.
  // S83-F10i — POST-HYDRATION DOM SCRAPER. Spider returns the page after
  // Angular has run, so the SSR transfer state JSON is gone. Q&A lives in
  // the rendered DOM with this exact shape (verified live via Chrome):
  //
  //   <h4>Questions & Answers (N)</h4>          ← count
  //   <li>
  //     <tg-comment class="o-comment o-comment--alt">     ← question
  //       <tg-comment-text class="o-comment__text">{Q text}</...>
  //       <tg-comment-note class="o-comment__note">{nick} ({fb}) • {date}</...>
  //       <tm-member-reputation>...</tm-member-reputation>
  //     </tg-comment>
  //     <tg-comment class="o-comment">                    ← answer (no --alt)
  //       <tg-comment-text class="o-comment__text">{A text}</...>
  //       <tg-comment-note class="o-comment__note">{nick} ({fb}) • {date}</...>
  //     </tg-comment>
  //   </li>
  //
  // Pure regex — no DOM available in cartridge sandbox.
  function tryParseSsrQuestions(html, variantLabel) {
    var probe = { variant: variantLabel, htmlLen: html ? html.length : 0 };
    if (!html) { probe.stage = "empty"; return { probe: probe, questions: [], questionCount: 0 }; }
    probe.first200 = html.slice(0, 200).replace(/[\w\-+/=]{40,}/g, "<long>");

    // Step 1 — find heading "Questions & Answers (N)" for total count.
    // The N may be wrapped in nested tags or split across whitespace.
    var headingMatch = html.match(/Questions\s*&(?:amp;)?\s*Answers\s*\(\s*(\d+)\s*\)/);
    var totalCount = headingMatch ? parseInt(headingMatch[1], 10) : null;
    probe.headingCount = totalCount;
    probe.headingFound = !!headingMatch;
    if (!headingMatch) {
      probe.stage = "no-qa-heading";
      return { probe: probe, questions: [], questionCount: 0 };
    }

    // Step 2 — extract every <tg-comment ...>...</tg-comment> block in source order.
    // Class with "--alt" → question; without → answer.
    var commentRe = /<tg-comment\b[^>]*class="([^"]*o-comment[^"]*)"[^>]*>([\s\S]*?)<\/tg-comment>/gi;
    var comments = [];
    var m;
    while ((m = commentRe.exec(html)) && comments.length < 200) {
      comments.push({ cls: m[1], inner: m[2] });
    }
    probe.commentBlockCount = comments.length;
    if (!comments.length) {
      probe.stage = "no-tg-comment-blocks";
      return { probe: probe, questions: [], questionCount: totalCount || 0 };
    }

    // Step 3 — for each comment extract body + note. Strip nested tags.
    function stripTags(s) {
      return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    }
    function extract(inner, klass) {
      // Match <anytag class="...{klass}..."...>INNER</anytag>. Capture the
      // opening tag name so the closing match uses a backreference — without
      // it the regex would close at the FIRST nested tag (e.g. </span> inside
      // the note's tm-member-reputation child) and lose the meaningful body.
      // TM uses tg-comment-text / tg-comment-note but we match by class so a
      // tag rename doesn't break us.
      var re = new RegExp('<([a-z\\-]+)\\b[^>]*class="[^"]*' + klass + '[^"]*"[^>]*>([\\s\\S]*?)<\\/\\1>', 'i');
      var match = inner.match(re);
      return match ? stripTags(match[2]) : null;
    }
    function parseNote(noteText) {
      // "rachaeltui (761) • 12:07 am, Fri, 24 Apr"
      var nick = null, feedback = null, date = null;
      if (!noteText) return { nick: nick, feedback: feedback, date: date };
      var nm = noteText.match(/^(\S+)\s*\((\d+)\)/);
      if (nm) {
        nick = nm[1];
        feedback = parseInt(nm[2], 10);
      }
      var dm = noteText.match(/[•·]\s*(.+)$/);
      if (dm) date = dm[1].trim();
      return { nick: nick, feedback: feedback, date: date };
    }
    var parsed = comments.map(function(c) {
      var isQuestion = c.cls.indexOf("--alt") >= 0;
      var body = extract(c.inner, "o-comment__text");
      var note = extract(c.inner, "o-comment__note");
      var p = parseNote(note);
      return {
        kind: isQuestion ? "q" : "a",
        text: body || "",
        nick: p.nick,
        feedback: p.feedback,
        date: p.date
      };
    }).filter(function(x) { return x.text; });

    // Step 4 — pair sequential q→a entries
    var paired = [];
    for (var i = 0; i < parsed.length; i++) {
      if (parsed[i].kind === "q") {
        var nextA = (i + 1 < parsed.length && parsed[i + 1].kind === "a") ? parsed[i + 1] : null;
        paired.push({
          listingQuestionId: null,  // not in DOM scrape — identifier only in API path
          question: parsed[i].text,
          askedDate: parsed[i].date,
          answer: nextA ? nextA.text : null,
          answeredDate: nextA ? nextA.date : null,
          askerNickname: parsed[i].nick,
          askerFeedback: parsed[i].feedback,
          isSellerComment: false
        });
        if (nextA) i++;  // consumed the answer
      }
    }

    probe.stage = "ok";
    probe.normalisedCount = paired.length;
    probe.totalCount = totalCount;
    return { probe: probe, questions: paired, questionCount: totalCount != null ? totalCount : paired.length };
  }

  // S83-F10f — Bid history scrape from the SAME post-hydration HTML.
  // TM renders the full bid history modal into the page DOM (hidden by
  // default; the "view history" button just toggles display). No extra
  // network call — Spider already returned this. Live DOM verified in
  // Chrome:
  //   <... class="tm-bid-history-modal__bid-container">
  //     <... class="tm-bid-history-modal__price">$1,040</...>
  //     <... class="tm-bid-history-modal__member">imthebakerr (244)</...>
  //     <... class="tm-bid-history-modal__time">8:42 pm</...>
  //   </...>
  // Header: "Bid history (31 bids , showing latest 10 )" — TM caps the
  // modal at 10 most recent. We surface bidHistoryShown (parsed count
  // returned) AND bidHistoryTotal (count from header) so UI can show
  // "showing latest 10 of 31" honestly. Same backreference-closing
  // pattern as Q&A for nested-tag safety.
  function tryParseSsrBidHistory(html) {
    var probe = { htmlLen: html ? html.length : 0 };
    if (!html) { probe.stage = "empty"; return { probe: probe, bidHistory: [], bidHistoryShown: 0, bidHistoryTotal: null }; }

    // Header: "Bid history (31 bids, showing latest 10)" or just "(31 bids)".
    var hdrTotal = html.match(/Bid\s+history[^(]*\(\s*(\d+)\s+bids?\s*[,\)]/i);
    var hdrShown = html.match(/showing\s+latest\s+(\d+)/i);
    var bidHistoryTotal = hdrTotal ? parseInt(hdrTotal[1], 10) : null;
    var hintShown = hdrShown ? parseInt(hdrShown[1], 10) : null;
    probe.headerTotal = bidHistoryTotal;
    probe.headerHintShown = hintShown;

    // Walk every bid container in source order. Backreference closing
    // for nested-tag safety (member name has its own <span> child).
    var containerRe = /<([a-z\-]+)\b[^>]*class="[^"]*tm-bid-history-modal__bid-container[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
    var bids = [];
    var m;
    var loopGuard = 0;
    while ((m = containerRe.exec(html)) !== null) {
      if (++loopGuard > 50) break;  // hard cap — modal shows ≤10
      bids.push(m[2]);
    }
    probe.containerCount = bids.length;
    if (!bids.length) {
      probe.stage = "no-bid-containers";
      return { probe: probe, bidHistory: [], bidHistoryShown: 0, bidHistoryTotal: bidHistoryTotal };
    }

    function stripTags(s) { return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
    function extractByClass(inner, klass) {
      var re = new RegExp('<([a-z\\-]+)\\b[^>]*class="[^"]*' + klass + '[^"]*"[^>]*>([\\s\\S]*?)<\\/\\1>', 'i');
      var match = inner.match(re);
      return match ? stripTags(match[2]) : null;
    }
    function parseBidMember(memberText) {
      // "imthebakerr (244)" → { nickname:"imthebakerr", feedback:244 }
      if (!memberText) return { nickname: null, feedback: null };
      var nm = memberText.match(/^(\S+)\s*\((\d+)\)/);
      if (nm) return { nickname: nm[1], feedback: parseInt(nm[2], 10) };
      return { nickname: memberText, feedback: null };
    }
    function parsePrice(s) {
      // "$1,040" → 1040 (number) ; preserve raw too for display fidelity
      if (!s) return { display: null, amount: null };
      var n = parseFloat(s.replace(/[^\d.]/g, ""));
      return { display: s.trim(), amount: isNaN(n) ? null : n };
    }

    var history = bids.map(function(inner) {
      var priceTxt = extractByClass(inner, "tm-bid-history-modal__price");
      var memberTxt = extractByClass(inner, "tm-bid-history-modal__member");
      var timeTxt = extractByClass(inner, "tm-bid-history-modal__time");
      var price = parsePrice(priceTxt);
      var member = parseBidMember(memberTxt);
      return {
        amount: price.amount,
        amountDisplay: price.display,
        bidderNickname: member.nickname,
        bidderFeedback: member.feedback,
        when: timeTxt || null
      };
    }).filter(function(b) { return b.amountDisplay || b.bidderNickname; });

    probe.stage = "ok";
    probe.normalisedCount = history.length;
    return {
      probe: probe,
      bidHistory: history,
      bidHistoryShown: history.length,
      bidHistoryTotal: bidHistoryTotal != null ? bidHistoryTotal : history.length
    };
  }

  function fetchListingQuestions(listingId, mod) {
    var moduleName = "trademe-listing-questions";
    var listingUrl = "https://www.trademe.co.nz/a/marketplace/listing/" + encodeURIComponent(listingId);

    function envelope(status, data) {
      return { module: moduleName, name: mod.name, category: mod.category, status: status, data: data };
    }
    function err(msg, probe) {
      return envelope("error", { questions: [], questionCount: 0, _qProbe: Object.assign({ error: msg }, probe || {}) });
    }

    // S83-F10f — use browserFetch (got-scraping) which mimics Chrome's
    // TLS handshake + HTTP/2 fingerprint + header order. Bypasses
    // Cloudflare's bot detection that flags Node undici's TLS.
    if (typeof browserFetch !== "function") {
      return Promise.resolve(err("browserFetch unavailable in cartridge sandbox — kit-runner needs got-scraping installed and exposed in functions/index.js"));
    }

    return browserFetch(listingUrl, { timeout: mod.timeoutMs || 10000 }).then(function(res) {
      var probe = { stage: "ssr-fetch", status: res.status };
      return res.text().then(function(html) {
        probe.htmlLen = html ? html.length : 0;
        if (!html) return err("empty response body", probe);
        if (res.status !== 200) return err("non-200 status: " + res.status, probe);
        var parsed = tryParseSsrQuestions(html, "got_scraping");
        // S83-F10f — same HTML, second pass: scrape bid history modal.
        // No additional Spider credit — this is the same response body.
        var bidParsed = tryParseSsrBidHistory(html);
        probe = Object.assign(probe, parsed.probe || {});
        probe.bidHistory = bidParsed.probe || {};
        var hasAnyData = (parsed.questions && parsed.questions.length) || (bidParsed.bidHistory && bidParsed.bidHistory.length);
        return envelope(hasAnyData ? "ok" : "empty", {
          listingId: parseInt(listingId, 10) || listingId,
          questions: parsed.questions || [],
          questionCount: parsed.questionCount || 0,
          bidHistory: bidParsed.bidHistory || [],
          bidHistoryShown: bidParsed.bidHistoryShown || 0,
          bidHistoryTotal: bidParsed.bidHistoryTotal,
          _qProbe: probe
        });
      });
    }).catch(function(e) {
      return err("browserFetch threw: " + (e && e.message), { stage: "ssr-fetch" });
    });
  }

  // Legacy two-stage code kept below (commented for archeology)
  function _ioOldFetchListingQuestions_v143(listingId, mod) {
    var moduleName = "trademe-listing-questions";
    var stage1Url = "https://www.trademe.co.nz/a/marketplace/listing/" + encodeURIComponent(listingId);
    var stage1Headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-NZ,en;q=0.9",
      "Referer": "https://www.trademe.co.nz/"
    };
    var probe = { stage: "stage1-fetch" };

    function envelope(status, data) {
      return { module: moduleName, name: mod.name, category: mod.category, status: status, data: data };
    }
    function err(msg, dataExtras) {
      var d = { questions: [], questionCount: 0, _qProbe: Object.assign({}, probe, { error: msg }, dataExtras || {}) };
      return envelope("error", d);
    }

    return fetchText(stage1Url, mod.timeoutMs || 8000, stage1Headers).then(function(html) {
      probe.stage = "stage1-parse";
      probe.stage1Len = html ? html.length : 0;
      if (!html || typeof html !== "string") return err("stage1 empty html");
      var startTag = '<script id="frend-state" type="application/json">';
      var startIdx = html.indexOf(startTag);
      if (startIdx < 0) return err("frend-state tag missing", { hasNgrxKeyword: html.indexOf("NGRX_STATE") >= 0 });
      var bodyStart = startIdx + startTag.length;
      var endIdx = html.indexOf("</script>", bodyStart);
      if (endIdx < 0) return err("frend-state close tag missing");
      probe.frendStateLen = endIdx - bodyStart;
      var state;
      try { state = JSON.parse(html.substring(bodyStart, endIdx)); }
      catch (e) { return err("frend-state JSON parse failed: " + e.message); }

      var auth = state && state.NGRX_STATE && state.NGRX_STATE.auth;
      var token = auth && auth.token;
      var clientId = state && state.NGRX_STATE && state.NGRX_STATE.tradeMeClientId;
      probe.hasToken = !!token;
      probe.tokenLen = token ? token.length : 0;
      probe.hasClientId = !!clientId;
      probe.ngrxKeys = state && state.NGRX_STATE ? Object.keys(state.NGRX_STATE).slice(0, 12) : null;

      if (!token) return err("no anon JWT in stage1 frend-state");

      // Stage 2: hit the API with the harvested credentials
      probe.stage = "stage2-fetch";
      var apiUrl = "https://api.trademe.co.nz/v1/listings/" + encodeURIComponent(listingId) + "/questions.json";
      var apiHeaders = {
        "Accept": "application/json",
        "Authorization": "Bearer " + token,
        "User-Agent": stage1Headers["User-Agent"]
      };
      if (clientId) apiHeaders["x-trademe-uniqueclientid"] = clientId;

      return fetchJson(apiUrl, mod.timeoutMs || 8000, apiHeaders).then(function(json) {
        probe.stage = "stage2-parse";
        probe.stage2Status = "ok";
        if (!json) return err("stage2 empty json");
        // Normalise to the same shape we ship from other modules
        function unwrapTmDate(v) {
          // TM REST returns dates as "/Date(1776926467307)/" — convert to ISO
          if (typeof v !== "string") return v;
          var m = v.match(/^\/Date\((\d+)\)\/$/);
          if (m) {
            try { return new Date(parseInt(m[1], 10)).toISOString(); } catch (e) {}
          }
          return v;
        }
        var rawList = Array.isArray(json.List) ? json.List : [];
        var normalised = rawList.map(function(q) {
          if (!q) return null;
          var answer = null, answerDate = null;
          if (q.Answer) {
            // q.Answer is sometimes an object { Comment, AnswerDate, ... }, sometimes the answer string itself
            if (typeof q.Answer === "string") {
              answer = q.Answer;
              answerDate = unwrapTmDate(q.AnswerDate || null);
            } else {
              answer = q.Answer.Comment || q.Answer.Text || null;
              answerDate = unwrapTmDate(q.Answer.AnswerDate || q.Answer.AnsweredDate || q.AnswerDate || null);
            }
          }
          return {
            listingQuestionId: q.ListingQuestionId || null,
            question: q.Comment || "",
            askedDate: unwrapTmDate(q.CommentDate || null),
            answer: answer,
            answeredDate: answerDate,
            askerNickname: (q.AskingMember && (q.AskingMember.Nickname || q.AskingMember.NickName)) || null,
            askerMemberId: (q.AskingMember && q.AskingMember.MemberId) || null,
            askerFeedback: (q.AskingMember && q.AskingMember.FeedbackCount) || null,
            isSellerComment: q.IsSellerComment === true
          };
        }).filter(function(q) { return q && q.question; });

        probe.normalisedCount = normalised.length;
        probe.totalCount = json.TotalCount;
        probe.stage = "ok";

        return envelope("ok", {
          listingId: parseInt(listingId, 10) || listingId,
          questions: normalised,
          questionCount: json.TotalCount != null ? json.TotalCount : normalised.length,
          _qProbe: probe
        });
      }).catch(function(e2) {
        probe.stage2Error = e2 && e2.message;
        return err("stage2 fetch failed: " + (e2 && e2.message));
      });
    }).catch(function(e1) {
      probe.stage1Error = e1 && e1.message;
      return err("stage1 fetch failed: " + (e1 && e1.message));
    });
  }

  function investigateListing(listingId, opts, start) {
    var s = start || Date.now();
    var detailMod = modules["trademe-listing-detail"];
    var similarMod = modules["trademe-similar"];
    var questionsMod = modules["trademe-listing-questions"];  // S83-F10c
    // v1.11.5 — trademe-listing-geo module deleted. The detail module
    // (Listings/{id}.json) already carries GeographicLocation at the
    // top level; v1.11.4's JSON-API probe proved this. Lat/lng is
    // extracted directly in trademe-listing-detail's parse().
    var tasks = [];

    if (detailMod) {
      var detailUrl = detailMod.queryByName(listingId, opts);
      tasks.push(runModule("trademe-listing-detail", detailUrl, detailMod, opts));
    }
    if (similarMod) {
      var similarUrl = similarMod.queryByName(listingId, opts);
      tasks.push(runModule("trademe-similar", similarUrl, similarMod, opts));
    }
    if (questionsMod && opts && opts.include_questions === true) {
      // S83-F10e3 — opt-in only. Spider-backed scrape is expensive
      // (~2-3s per call + a Spider credit). Default investigateListing
      // returns detail-only so the panel paints fast. UI inspects
      // detail.data.questionCount (now sourced from the FREE
      // Questions.TotalCount field on the bare TM API — see v1.14.9
      // parser fix) and only re-fires kit-runner with
      // ?include_questions=1 when count > 0 AND
      // supportsQuestionsAndAnswers !== false.
      tasks.push(fetchListingQuestions(listingId, questionsMod));
    }

    return Promise.all(tasks).then(function(results) {
      return buildResult(results, { listing_id: listingId, place: null, lat: null, lng: null, thing: null }, s);
    });
  }

  function investigateCategoryOnly(categoryNumber, opts, start) {
    var s = start || Date.now();
    opts.category = categoryNumber;
    var tasks = [];

    var catMod = modules["trademe-categories"];
    if (catMod) {
      var catUrl = catMod.queryByName(null, opts);
      tasks.push(runModule("trademe-categories", catUrl, catMod, opts));
    }

    var tmMod = modules["trademe"];
    if (tmMod) {
      var tmUrl = tmMod.queryByName("", opts);
      tasks.push(runModule("trademe", tmUrl, tmMod, opts));
    }

    return Promise.all(tasks).then(function(results) {
      return buildResult(results, { place: null, lat: null, lng: null, thing: null, category: categoryNumber }, s);
    });
  }

  function investigateRegionOnly(regionId, opts, start) {
    var s = start || Date.now();
    opts.region = regionId;
    var tasks = [];

    var tmMod = modules["trademe"];
    if (tmMod) {
      var searchTerm = opts.thing || "";
      var tmUrl = tmMod.queryByName(searchTerm, opts);
      tasks.push(runModule("trademe", tmUrl, tmMod, opts));
    }

    return Promise.all(tasks).then(function(results) {
      return buildResult(results, { place: null, lat: null, lng: null, thing: opts.thing || null, region: regionId }, s);
    });
  }

  // ── STATUS ────────────────────────────────────────────────────

  function status() {
    var moduleNames = Object.keys(modules);
    return {
      cartridge: meta.id,
      version: meta.version,
      born: meta.born,
      extracted_from: meta.extracted_from,
      modules: moduleNames.length,
      moduleList: moduleNames,
      health: "ok"
    };
  }

  // ── PUBLIC CONTRACT ───────────────────────────────────────────

  return {
    meta: meta,
    run: run,
    status: status
  };

})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = IoCartridge_Trademe;
}
