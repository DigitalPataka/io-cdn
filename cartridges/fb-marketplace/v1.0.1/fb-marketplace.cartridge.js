var IoCartridge_FbMarketplace = (function () {
  "use strict";

  // ══════════════════════════════════════════════════════════════
  // FB MARKETPLACE CARTRIDGE v1.0.1
  // ══════════════════════════════════════════════════════════════
  // v1.0.1 (S87 same-day fix): buildResult shape mismatch with kit-
  //   runner. v1.0.0 returned {results:[],context,durationMs} but
  //   kit-runner's merge loop reads cr.modules (map) + cr.duration_ms
  //   + cr.query. Mismatch silently dropped FB output from
  //   merged.modules; FB tab never appeared. Caught live via Chrome
  //   MCP probe of /api/kit-runner before any user-visible failure.
  //   v1.0.1 mirrors trademe.cartridge buildResult exactly.
  //
  // Born: Session 87 (2026-05-09) — Designer Shonty greenlit the
  //   FB Marketplace onboarding under doc 19-MODULE-ONBOARDING.md.
  //
  // Architecture (Step 3, Option B):
  //   Cartridge stays dumb. It hits the io-matua-kore CF endpoint
  //   /api/fb-marketplace-search via a clean GET with query params.
  //   That CF owns the heavy lifting:
  //     - rotating session-token harvest (lsd, jazoest, fb_dtsg, ...)
  //     - POST to facebook.com/api/graphql/ with marketplace_search
  //       persisted-query doc_id
  //     - cursor replay for pagination beyond the 24-server-cap
  //     - 3-city fan-out across NZ + dedupe by listing.id
  //   The cartridge therefore looks like any TM module — build URL,
  //   GET, parse — even though FB requires substantially more
  //   machinery underneath.
  //
  // Severability:
  //   - Master gate: /io/flags/fb_marketplace_enabled (CF-side, default
  //     false). When false the CF returns 503 and this cartridge's
  //     parse() returns null (= status:'empty'). Search still runs;
  //     other modules continue as normal.
  //   - Contract gate: /contracts/fb-marketplace/enabled. When false,
  //     resolver never dispatches us.
  //
  // Cross-platform role (per insight_fb_buynow_tm_auction.md):
  //   FB is the buy-now/static-asking observatory; TM remains the
  //   demand observatory (watchers/bids/auction urgency).
  //   Matcher equation: FB asking ↔ TM buy-now-mean of same SKU.
  //   Never FB asking ↔ TM auction bid (mid-discovery vs final ask).
  // ══════════════════════════════════════════════════════════════

  var meta = {
    id: "fb-marketplace",
    label: "FB Marketplace",
    version: "1.0.1",
    born: "Session 87",
    extracted_from: null,
    modules: {
      "fb-marketplace": {
        name: "FB Marketplace",
        category: "marketplace",
        layout: "cards",
        sections: ["sale"]
      }
    }
  };

  // ── SHARED UTILITIES ──────────────────────────────────────────

  // Cartridge runs inside the kit-runner CF. Same Firebase project,
  // same region — going through the public hosting rewrite is fine
  // and lets the same code run from a browser dev console too.
  var FB_MP_BASE = "https://io-matua-kore.web.app/api/fb-marketplace-search";

  function fetchJson(url, timeout, customHeaders) {
    var ms = timeout || 25000;
    var headers = customHeaders || { "Accept": "application/json, text/plain, */*" };
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error("Timeout after " + ms + "ms"));
      }, ms);
      fetch(url, {
        headers: headers,
        credentials: "omit",
        referrerPolicy: "no-referrer"
      }).then(function (res) {
        clearTimeout(timer);
        if (res.ok) return res.json();
        return res.text().then(function (body) {
          reject(new Error("HTTP " + res.status + " body=" + (body || "").slice(0, 200)));
        });
      }).then(resolve).catch(function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // ── FILTER + SORT TRANSLATION ─────────────────────────────────
  // IoQL qualifier → FB sortBy enum.

  var QUALIFIER_TO_SORT = {
    "cheapest":          "price_ascend",
    "lowest price":      "price_ascend",
    "affordable":        "price_ascend",
    "budget":            "price_ascend",
    "most expensive":    "price_descend",
    "highest price":     "price_descend",
    "priciest":          "price_descend",
    "newest":            "creation_time_descend",
    "just listed":       "creation_time_descend",
    "latest":            "creation_time_descend",
    "recently listed":   "creation_time_descend",
    "closest":           "distance_ascend",
    "nearby":            "distance_ascend",
    "near me":           "distance_ascend",
    "best match":        "best_match",
    "most relevant":     "best_match",
    "relevance":         "best_match"
  };

  // IoQL kind → FB itemCondition enum (lowercase-snake exact value).

  var KIND_TO_CONDITION = {
    "new":           "new",
    "brand new":     "new",
    "used":          "used_good",
    "second hand":   "used_good",
    "secondhand":    "used_good",
    "good":          "used_good",
    "used good":     "used_good",
    "fair":          "used_fair",
    "used fair":     "used_fair",
    "like new":      "used_like_new",
    "used like new": "used_like_new",
    "mint":          "used_like_new"
  };

  // IoQL preference → days_since_listed.

  var PREFERENCE_TO_DAYS = {
    "fresh listings":    1,
    "today":             1,
    "this week":         7,
    "past week":         7,
    "recent":            7,
    "this month":        30,
    "past month":        30
  };

  function resolveSort(opts) {
    if (!opts) return null;
    if (opts.qualifier) {
      var q = String(opts.qualifier).toLowerCase().trim();
      if (QUALIFIER_TO_SORT[q]) return QUALIFIER_TO_SORT[q];
    }
    if (opts.preference) {
      var p = String(opts.preference).toLowerCase().trim();
      if (QUALIFIER_TO_SORT[p]) return QUALIFIER_TO_SORT[p];
    }
    return null;
  }

  function resolveCondition(opts) {
    if (!opts || !opts.kind) return null;
    var k = String(opts.kind).toLowerCase().trim();
    return KIND_TO_CONDITION[k] || null;
  }

  function resolveDays(opts) {
    if (!opts) return null;
    if (opts.preference) {
      var p = String(opts.preference).toLowerCase().trim();
      if (PREFERENCE_TO_DAYS[p]) return PREFERENCE_TO_DAYS[p];
    }
    return null;
  }

  // ── PRICE PARSER (same shape as trademe cartridge) ────────────

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
    var rangeMatch = s.match(/^\$?([0-9]+(?:\.[0-9]+)?[mk]?)\s*(?:-|to)\s*\$?([0-9]+(?:\.[0-9]+)?[mk]?)$/);
    if (rangeMatch) {
      return { min: parseNumber(rangeMatch[1]), max: parseNumber(rangeMatch[2]) };
    }
    var underMatch = s.match(/^(?:under|below|less than|<)\s*\$?([0-9]+(?:\.[0-9]+)?[mk]?)$/);
    if (underMatch) return { min: null, max: parseNumber(underMatch[1]) };
    var overMatch = s.match(/^(?:over|above|more than|>)\s*\$?([0-9]+(?:\.[0-9]+)?[mk]?)$/);
    if (overMatch) return { min: parseNumber(overMatch[1]), max: null };
    var single = parseNumber(s.replace(/^\$/, ""));
    return single ? { min: single, max: single } : null;
  }

  // ── MODULE DEFINITION ─────────────────────────────────────────

  var modules = {
    "fb-marketplace": {
      name: "FB Marketplace",
      category: "marketplace",
      description: "FB Marketplace listings — buy-now-only, static asking prices, NZ-domestic supply observatory",
      primaryField: "thing",
      qualifiesWhen: ["thing"],
      qualifierTranslations: QUALIFIER_TO_SORT,
      queryByName: function (query, opts) {
        // FB search is exact-phrase. Send the single primary noun.
        // Multi-word qualifier-laden raw input would yield 0 results.
        var searchTerm = query;
        if (opts && opts.thing) searchTerm = opts.thing;

        var params = "q=" + encodeURIComponent(searchTerm);

        // Price → CF min_price/max_price
        if (opts && opts.price) {
          var pr = parsePrice(opts.price);
          if (pr) {
            if (pr.min !== null && typeof pr.min !== "undefined") {
              params = params + "&min_price=" + pr.min;
            }
            if (pr.max !== null && typeof pr.max !== "undefined") {
              params = params + "&max_price=" + pr.max;
            }
          }
        }

        // Kind → condition
        var cond = resolveCondition(opts);
        if (cond) params = params + "&condition=" + encodeURIComponent(cond);

        // Preference → days_since_listed
        var days = resolveDays(opts);
        if (days) params = params + "&days_since_listed=" + days;

        // Qualifier → sort_by
        var sort = resolveSort(opts);
        if (sort) params = params + "&sort_by=" + encodeURIComponent(sort);

        // Geographic strategy: default to NZ-wide fan-out.
        // Single-origin override only when opts has explicit lat/lng
        // (e.g. listing-detail follow-ups, future use).
        if (opts && typeof opts.lat === "number" && typeof opts.lng === "number") {
          params = params + "&lat=" + opts.lat + "&lng=" + opts.lng + "&fan_out=false";
        } else {
          params = params + "&fan_out=true";
        }

        // Page count — scope=top trims, otherwise 6 cursor pages per city.
        var pageCount = 6;
        if (opts && opts.scope) {
          var s = String(opts.scope).toLowerCase();
          if (s === "top" || s === "best" || s === "first") pageCount = 2;
        }
        params = params + "&page_count=" + pageCount;

        return FB_MP_BASE + "?" + params;
      },
      fetchHeaders: { "Accept": "application/json" },
      timeoutMs: 28000,
      parse: function (data) {
        // The CF already normalises; we trust its shape and pass
        // through with one additional flatten for downstream sorts.
        if (!data || data.ok !== true) return null;
        var rows = Array.isArray(data.listings) ? data.listings : [];
        return {
          totalCount: data.totalUnique || rows.length,
          totalRaw: data.totalRaw || rows.length,
          perCity: data.perCity || null,
          query: data.query || null,
          fanOut: data.fanOut === true,
          radius: data.radius || null,
          pageCount: data.pageCount || null,
          listings: rows.map(function (item) {
            return {
              id: item.id,
              title: item.title || null,
              url: item.url || null,
              priceDisplay: item.priceDisplay || null,
              startPrice: item.price || null,
              buyNowPrice: item.price || null,  // FB is buy-now-only
              hasBuyNow: true,
              isBuyNowOnly: true,
              currency: item.currency || null,
              photoUrl: item.photoUrl || null,
              photoUrls: item.photoUrl ? [item.photoUrl] : null,
              region: item.state || null,
              suburb: item.city || null,
              country: item.country || null,
              latitude: item.latitude || null,
              longitude: item.longitude || null,
              cityOrigin: item.cityOrigin || null,
              isLive: item.isLive === true,
              isPending: item.isPending === true,
              isSold: item.isSold === true,
              deliveryTypes: item.deliveryTypes || null,
              shippingOffered: item.shippingOffered === true,
              localPickupOffered: item.localPickupOffered === true,
              taxonomyPath: item.taxonomyPath || null,
              taxonomyLeaf: item.taxonomyLeaf || null,
              category: item.taxonomyLeaf || null,
              categoryPath: Array.isArray(item.taxonomyPath) ? item.taxonomyPath.join(" > ") : null,
              // detail-only — null until enrichment fires
              condition: item.condition || null,
              creationTime: item.creationTime || null,
              descriptionText: item.descriptionText || null,
              attributes: item.attributes || null,
              // FB has NO demand signals — explicit nulls so downstream
              // grammar sees them as "not available" rather than 0.
              bidCount: null,
              watcherCount: null,
              viewCount: null,
              hasReserve: false,
              isReserveMet: null,
              // Source tag — distinguishes mixed-source result sets.
              source: "fb-marketplace"
            };
          })
        };
      }
    }
  };

  // ── MODULE QUALIFIER ──────────────────────────────────────────

  function qualifyModules(opts) {
    var ids = [];
    var hasSpecialist = false;
    for (var name in modules) {
      var mod = modules[name];
      var qualifies = (mod.qualifiesWhen || []).every(function (f) { return !!opts[f]; });
      if (qualifies) ids.push(name);
    }
    return { modules: ids, hasSpecialist: hasSpecialist };
  }

  // ── RUN MODULE ────────────────────────────────────────────────

  function runModule(name, url, mod, opts) {
    return fetchJson(url, mod.timeoutMs || null, mod.fetchHeaders || null).then(function (data) {
      var parsed = mod.parse(data);
      return {
        module: name,
        name: mod.name,
        category: mod.category,
        status: parsed ? "ok" : "empty",
        data: parsed
      };
    }).catch(function (err) {
      return {
        module: name,
        name: mod.name,
        category: mod.category,
        status: "error",
        error: err.message
      };
    });
  }

  // ── BUILD RESULT ──────────────────────────────────────────────
  // v1.0.1 fix: shape MUST match trademe.cartridge buildResult — the
  // kit-runner's merge loop reads cr.modules (map keyed by module id)
  // and cr.duration_ms (snake_case). v1.0.0 returned an array-shaped
  // result with camelCase durationMs and was silently dropped from
  // merged.modules; FB tab never appeared in search results.

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
    results.forEach(function (r) {
      response.modules[r.module] = r;
      if (r.status === "ok") ok++;
      if (r.status === "error") errors++;
    });
    response.summary = {
      total: results.length,
      ok: ok,
      errors: errors,
      empty: results.length - ok - errors
    };
    return response;
  }

  // ── ENTRY POINT ───────────────────────────────────────────────

  function run(params) {
    var opts = params || {};
    var start = Date.now();

    // FB requires a `thing` (the search noun). No category browse,
    // no listing detail in v1.0.0 — those surfaces will be added
    // as fb-marketplace-listing-detail in a later cartridge bump.
    if (!opts.thing) {
      return Promise.resolve(buildResult(
        [{ module: "fb-marketplace", name: "FB Marketplace", category: "marketplace", status: "no_query", data: null }],
        { thing: null },
        start
      ));
    }

    var active;
    if (opts.modules && Array.isArray(opts.modules) && opts.modules.length > 0) {
      active = opts.modules.filter(function (n) { return !!modules[n]; });
    } else {
      active = qualifyModules(opts).modules;
    }

    var tasks = active.map(function (name) {
      var mod = modules[name];
      var queryValue = opts[mod.primaryField] || "";
      if (!queryValue) {
        return Promise.resolve({ module: name, name: mod.name, category: mod.category, status: "no_query", data: null });
      }
      var url = mod.queryByName(queryValue, opts);
      return runModule(name, url, mod, opts);
    });

    return Promise.all(tasks).then(function (results) {
      return buildResult(results, {
        thing: opts.thing || null,
        place: opts.place || null,
        kind: opts.kind || null,
        qualifier: opts.qualifier || null,
        preference: opts.preference || null,
        scope: opts.scope || null,
        price: opts.price || null
      }, start);
    });
  }

  // ── STATUS ────────────────────────────────────────────────────

  function status() {
    var moduleNames = Object.keys(modules);
    return {
      cartridge: meta.id,
      version: meta.version,
      born: meta.born,
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
  module.exports = IoCartridge_FbMarketplace;
}
