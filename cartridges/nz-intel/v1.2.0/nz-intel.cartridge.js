var IoCartridge_NzIntel = (function() {
  "use strict";

  // ══════════════════════════════════════════════════════════════
  // NZ INTELLIGENCE CARTRIDGE v1.2.0
  // Born: Session 43 (extracted from sweep v1.10.0)
  // v1.2.0 (S78): NEW MODULE — realestate-listing-detail.
  //      HTML-scrape path for the 4 public signals that the realestate
  //      JSON:API does NOT expose: totalViews, suburbMedianPrice,
  //      suburbYoYPercent (with direction), and listedDate/daysOnMarket.
  //      Data is server-side-rendered into the listing detail HTML by
  //      Ember Fastboot; the auth-gated /account/v1/.../metrics JSON
  //      endpoint (401 unauthenticated) is off-limits to us, but the
  //      HTML is public. Adapter fires on detail-panel open.
  //      Added: fetchText() for HTML, buildRealestateHtmlHeaders(),
  //      parseRealestateDetailHtml(), investigateListing() route
  //      when opts.listing_id is set. Gated qualifiesWhen:['listing_id']
  //      so normal search flows never dispatch it.
  //      Verified live 2026-04-23 against www.realestate.co.nz sample
  //      listing 43030408 (metrics block + market-insights block).
  // S76: added realestate-sale module (realestate.co.nz residential sales)
  //      — honours opts.modules for marketplace dispatch
  //      — skips geocode when all requested modules are keyword-only
  //      — per-module fetch headers for stealth on non-TM hosts
  // S77: realestate.co.nz API schema realignment
  //      — filter[listingSubType]  → filter[category]           (values unchanged: res_sale, com_sale, …)
  //      — filter[listingCategoryCode] → filter[propertyType]   (values now NUMERIC: 1=House, 2=Apartment, 4=Townhouse, 5=Unit, 6=Home&Income, 7=Lifestyle, 9=Section)
  //      — page[size]              → page[limit]
  //      — sort is no longer accepted (server returns 400). Removed entirely.
  //      — boolean prefs must be camelCase (isMortgageeSale, not is-mortgagee-sale). featured removed (isFeatured 400s).
  //      Verified live 2026-04-23 against api.realestate.co.nz/search/v1/listings.
  // S77 v1.1.2: removed page[number]=1 — API now returns HTTP 400
  //      with message '"number" is not allowed'. page[limit] alone paginates
  //      from page 1. Pagination (if needed later) uses page[offset] not page[number].
  //      Verified live 2026-04-23 — Auckland returned 16,262 listings.
  // S77 v1.1.3: image URL construction — real API shape is
  //      photos[0] = { "base-url": "/listings/...", small, medium, large,
  //                    square, thumbnail, ... } where each size field is a
  //      literal crop suffix like ".crop.140x178.jpg". No `urls` object.
  //      mediaserver.realestate.co.nz serves ANY .crop.WxH.jpg suffix — we
  //      build a card-optimal 800x600 URL here so the adapter stays CDN-free.
  //      Verified live 2026-04-23 — image load returns 200 OK.
  // Modules: geocode, search, quakes, volcanoes, weather,
  //          elevation, poi, wikipedia, wikidata, intensity,
  //          realestate-sale
  // ══════════════════════════════════════════════════════════════

  var meta = {
    id: "nz-intel",
    label: "NZ Intelligence",
    version: "1.2.0",
    born: "Session 43",
    extracted_from: "sweep v1.10.0",
    modules: {
      geocode:                      { name: "Nominatim Reverse Geocode",          category: "geo",       layout: "rows" },
      search:                       { name: "Nominatim Forward Search",            category: "geo",       layout: "rows" },
      quakes:                       { name: "GeoNet Recent Quakes",                category: "seismic",   layout: "rows" },
      volcanoes:                    { name: "GeoNet Volcano Alert Levels",         category: "seismic",   layout: "rows" },
      weather:                      { name: "Open-Meteo Current Weather",          category: "weather",   layout: "rows" },
      elevation:                    { name: "Open Elevation",                      category: "geo",       layout: "rows" },
      poi:                          { name: "OpenStreetMap Points of Interest",    category: "local",     layout: "rows" },
      wikipedia:                    { name: "Wikipedia Geosearch",                 category: "knowledge", layout: "rows" },
      wikidata:                     { name: "Wikidata Entity Search",              category: "knowledge", layout: "rows" },
      intensity:                    { name: "GeoNet Measured Intensity",           category: "seismic",   layout: "rows" },
      "realestate-sale":            { name: "realestate.co.nz Residential Sales",  category: "property",  layout: "cards" },
      "realestate-listing-detail":  { name: "realestate.co.nz Listing Detail",     category: "property",  layout: "reference" }
    }
  };

  // ── SHARED UTILITIES ──────────────────────────────────────────

  function haversine(lat1, lng1, lat2, lng2) {
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 12742 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Generic JSON fetch. customHeaders lets modules override stealth profile per host.
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

  // v1.2.0 (S78): Generic HTML fetch. Same shape as fetchJson but returns
  // response.text() — for modules that scrape server-rendered markup.
  // redirect:"follow" so realestate.co.nz's /{id} → /{id}/{slug} 301 works.
  function fetchText(url, timeout, customHeaders) {
    var ms = timeout || 10000;
    var headers = customHeaders || { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
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

  // ── STEALTH HEADER POOLS (self-contained per cartridge) ───────
  // Follows 10-STEALTH.md: UA rotation, source-matched Referer, minimal options.
  // nz-intel's base fetchJson uses generic Accept. Modules that need different
  // headers (e.g. realestate.co.nz JSON:API) declare mod.fetchHeaders.

  var UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0"
  ];

  var ACCEPT_LANG_POOL = ["en-NZ,en;q=0.9", "en-NZ,en-AU;q=0.9,en;q=0.8", "en-AU,en-NZ;q=0.9,en;q=0.8"];

  function pickFrom(pool) { return pool[Math.floor(Math.random() * pool.length)]; }

  // Build stealth headers for realestate.co.nz (JSON:API 1.0 spec).
  // Rebuilt per-call so UA rotates. Referer matches the source's own site.
  function buildRealestateHeaders() {
    return {
      "User-Agent": pickFrom(UA_POOL),
      "Accept": "application/vnd.api+json, application/json;q=0.9, */*;q=0.1",
      "Accept-Language": pickFrom(ACCEPT_LANG_POOL),
      "Referer": "https://www.realestate.co.nz/",
      "Cache-Control": "no-cache"
    };
  }

  // v1.2.0 (S78): Build stealth headers for realestate.co.nz HTML scrape.
  // Different Accept header (text/html first); everything else mirrors the
  // JSON:API profile so we blend with the same traffic shape.
  function buildRealestateHtmlHeaders() {
    return {
      "User-Agent": pickFrom(UA_POOL),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": pickFrom(ACCEPT_LANG_POOL),
      "Referer": "https://www.realestate.co.nz/",
      "Cache-Control": "no-cache"
    };
  }

  // v1.2.0 (S78): Parse the realestate.co.nz listing detail page HTML for
  // the four publicly-rendered signals that the JSON:API hides. The markup
  // patterns were verified 2026-04-23 against listing 43030408. Regex bails
  // to null-on-field on pattern drift, so the rest of Io keeps running.
  function parseRealestateDetailHtml(html) {
    if (typeof html !== "string" || html.length < 500) return null;

    var out = {
      totalViews: null,
      suburbMedianPrice: null,
      suburbMedianPriceNumeric: null,
      suburbMedianSuburb: null,
      suburbYoYPercent: null,
      suburbYoYDirection: null,
      listedDate: null,
      listedDateIso: null,
      daysOnMarket: null
    };

    // Total views — <div class="metrics ...">...<span class="rounded-full ...">N,NNN</span>...Total views
    var viewsRe = /class="metrics[\s\S]{0,600}rounded-full[^>]*>\s*([\d,]+)\s*<\/span>\s*[\s\S]{0,40}Total views/i;
    var viewsMatch = html.match(viewsRe);
    if (viewsMatch && viewsMatch[1]) {
      var cleaned = viewsMatch[1].replace(/,/g, "");
      var n = parseInt(cleaned, 10);
      if (!isNaN(n)) out.totalViews = n;
    }

    // Suburb median — "Median sale price in {Suburb}" then "$1,600,000" in a sibling div.
    // The site may break the label across whitespace-separated nodes; normalise.
    var medianRe = /Median\s+sale\s+price\s+in\s+([\s\S]{1,80}?)<\/div>[\s\S]{0,400}?\$([\d,]+)/i;
    var medianMatch = html.match(medianRe);
    if (medianMatch) {
      out.suburbMedianSuburb = medianMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      out.suburbMedianPrice = "$" + medianMatch[2];
      var nm = parseInt(medianMatch[2].replace(/,/g, ""), 10);
      if (!isNaN(nm)) out.suburbMedianPriceNumeric = nm;
    }

    // YoY — colour class encodes direction (green=up, red=down), arrow + percent follow.
    var yoyRe = /class="(text-green-600|text-red-600)[^"]*"[\s\S]{0,60}?([\d.]+)\s*%/;
    var yoyMatch = html.match(yoyRe);
    if (yoyMatch) {
      out.suburbYoYDirection = (yoyMatch[1].indexOf("green") >= 0) ? "up" : "down";
      var p = parseFloat(yoyMatch[2]);
      if (!isNaN(p)) out.suburbYoYPercent = p;
    }

    // Listed date — <span data-test="description__listed-date">Listed on 17 April</span>
    var listedRe = /description__listed-date[^>]*>\s*Listed on\s*([^<]+)</i;
    var listedMatch = html.match(listedRe);
    if (listedMatch && listedMatch[1]) {
      out.listedDate = listedMatch[1].replace(/\s+/g, " ").trim();
      // The page typically omits the year. Assume current year; roll back a year
      // if the resulting date is in the future (e.g. listed on "30 December" in Jan).
      var now = new Date();
      var parsed = Date.parse(out.listedDate + " " + now.getFullYear());
      if (!isNaN(parsed) && parsed > now.getTime()) {
        parsed = Date.parse(out.listedDate + " " + (now.getFullYear() - 1));
      }
      if (!isNaN(parsed)) {
        out.listedDateIso = new Date(parsed).toISOString().slice(0, 10);
        out.daysOnMarket = Math.max(0, Math.floor((now.getTime() - parsed) / 86400000));
      }
    }

    return out;
  }

  // ── REALESTATE.CO.NZ TRANSLATION TABLES ───────────────────────
  // Authoritative numeric region IDs pulled from /search/v1/locations
  // (verified 2026-04-22 by Io 1.2).

  var REALESTATE_REGIONS = {
    "auckland": 35,
    "wellington": 42,
    "christchurch": 45,
    "hamilton": 36,
    "tauranga": 37,
    "dunedin": 46,
    "queenstown": 50,
    "napier": 39,
    "hastings": 39,
    "palmerston north": 56,
    "palmy": 56,
    "nelson": 43,
    "rotorua": 37,
    "new plymouth": 40,
    "whangarei": 34,
    "invercargill": 47,
    // Regional councils (direct)
    "northland": 34,
    "waikato": 36,
    "bay of plenty": 37,
    "gisborne": 38,
    "hawkes bay": 39,
    "taranaki": 40,
    "canterbury": 45,
    "otago": 46,
    "southland": 47,
    "coromandel": 48,
    "central otago": 50,
    "lakes district": 50,
    "marlborough": 51,
    "wairarapa": 52,
    "central north island": 55,
    "manawatu": 56,
    "manawatu whanganui": 56,
    "whanganui": 56,
    "west coast": 44,
    "nelson bays": 43
  };

  // propertyType enum values (verified live 2026-04-23 by Io 1.2 probe).
  // S77: Values are NUMERIC IDs now — API rejects string names with 400.
  // These map IoQL "kind" to filter[propertyType][]=<id>.
  //   1 = House            (26,783 nationwide)
  //   2 = Apartment        ( 2,183)
  //   4 = Townhouse        ( 3,612)
  //   5 = Unit             ( 1,347)
  //   6 = Home & Income    (   376)
  //   7 = Lifestyle Prop.  ( 3,512)
  //   9 = Section          ( 5,259)
  // (id 3 returns 28 listings, undocumented; 8 is Lifestyle Section / rural_sale.)
  var REALESTATE_KINDS = {
    "house": 1,
    "houses": 1,
    "apartment": 2,
    "apartments": 2,
    "townhouse": 4,
    "townhouses": 4,
    "unit": 5,
    "units": 5,
    "home and income": 6,
    "home & income": 6,
    "lifestyle": 7,
    "lifestyle property": 7,
    "section": 9,
    "sections": 9
  };

  // IoQL "preference" → realestate.co.nz boolean filter.
  // S77: Names are camelCase now. Kebab-case 400s. "featured" removed (isFeatured 400s).
  var REALESTATE_PREFS = {
    "mortgagee": "isMortgageeSale",
    "mortgagee sale": "isMortgageeSale",
    "new build": "isNewConstruction",
    "new construction": "isNewConstruction",
    "new": "isNewConstruction",
    "waterfront": "isCoastalWaterfront",
    "coastal": "isCoastalWaterfront"
  };

  // IoQL "qualifier"/"preference" → JSON:API sort spec
  // S77: The API no longer accepts sort/order/orderBy/sortBy — any of them 400.
  // Table retained (empty) so the lookup path still compiles if/when sort returns.
  var REALESTATE_SORTS = {};

  // ── MODULE DEFINITIONS ────────────────────────────────────────

  var modules = {
    geocode: {
      name: "Nominatim Reverse Geocode",
      category: "geo",
      description: "Address, suburb, city, postcode from coordinates",
      query: function(lat, lng) {
        return "https://nominatim.openstreetmap.org/reverse?lat=" + lat + "&lon=" + lng + "&format=json&zoom=16&addressdetails=1";
      },
      parse: function(data) {
        if (!data || data.error) return null;
        var a = data.address || {};
        return {
          display: data.display_name,
          road: a.road || a.street || null,
          suburb: a.suburb || a.neighbourhood || a.hamlet || null,
          city: a.city || a.town || a.village || null,
          district: a.county || a.state_district || null,
          region: a.state || null,
          postcode: a.postcode || null,
          country: a.country || null
        };
      }
    },

    search: {
      name: "Nominatim Forward Search",
      category: "geo",
      description: "Coordinates and bounding box from place name",
      queryByName: function(place) {
        return "https://nominatim.openstreetmap.org/search?q=" + encodeURIComponent(place) + "+New+Zealand&format=json&limit=3&addressdetails=1";
      },
      parse: function(data) {
        if (!data || !Array.isArray(data) || data.length === 0) return null;
        return data.map(function(item) {
          return {
            name: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            type: item.type,
            boundingBox: item.boundingbox
          };
        });
      }
    },

    quakes: {
      name: "GeoNet Recent Quakes",
      category: "seismic",
      description: "Recent earthquakes near location",
      qualifierTranslations: {
        "strong": 5, "big": 5, "major": 5, "large": 5,
        "felt": 3, "noticeable": 3, "moderate": 4,
        "any": 1, "all": 1, "small": 2, "minor": 2
      },
      scopeTranslations: {
        "nearby": 0.5, "close": 0.5, "local": 1, "regional": 2,
        "national": 180, "all": 180, "country": 180
      },
      timeRangeTranslations: {
        "today": 1, "now": 1, "last 24 hours": 1, "last day": 1,
        "yesterday": 2, "this week": 7, "last week": 7, "last 7 days": 7,
        "this month": 30, "last month": 30, "last 30 days": 30,
        "this year": 365, "last year": 365
      },
      query: function(lat, lng, opts) {
        var mmi = 2;
        if (opts && opts.qualifier) {
          var translated = this.qualifierTranslations[opts.qualifier.toLowerCase()];
          if (translated) mmi = translated;
        }
        var daysBack = 0;
        if (opts && opts.time_range) {
          var tr = this.timeRangeTranslations[opts.time_range.toLowerCase()];
          if (tr) daysBack = tr;
        }
        if (daysBack > 30) {
          var now = new Date();
          var then = new Date(now.getTime() - (daysBack * 24 * 3600 * 1000));
          var bbox = (lng - 2) + "," + (lat - 2) + "," + (lng + 2) + "," + (lat + 2);
          return "https://api.geonet.org.nz/quake/search?bbox=" + bbox +
                 "&startdate=" + then.toISOString().split("T")[0] +
                 "&enddate=" + now.toISOString().split("T")[0] +
                 "&minmag=" + Math.max(0, mmi - 1);
        }
        return "https://api.geonet.org.nz/quake?MMI=" + mmi;
      },
      parse: function(data, lat, lng, opts) {
        if (!data || !data.features) return null;
        var radiusDeg = 1;
        if (opts && opts.scope) {
          var scopeKeys = {
            "nearby": 0.5, "close": 0.5, "local": 1, "regional": 2,
            "national": 180, "all": 180, "country": 180
          };
          var mapped = scopeKeys[opts.scope.toLowerCase()];
          if (mapped) radiusDeg = mapped;
        }
        var limit = 10;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "national" || s === "all" || s === "country") limit = 50;
          if (s === "top" || s === "biggest") limit = 5;
        }
        var timeCutoffMs = null;
        if (opts && opts.time_range) {
          var trDays = this.timeRangeTranslations ? this.timeRangeTranslations[opts.time_range.toLowerCase()] : 0;
          if (trDays && trDays <= 30) {
            timeCutoffMs = Date.now() - (trDays * 24 * 3600 * 1000);
          }
        }
        var nearby = data.features.filter(function(f) {
          var c = f.geometry.coordinates;
          if (Math.abs(c[1] - lat) >= radiusDeg || Math.abs(c[0] - lng) >= radiusDeg) return false;
          if (timeCutoffMs !== null && f.properties.time) {
            var t = new Date(f.properties.time).getTime();
            if (!isNaN(t) && t < timeCutoffMs) return false;
          }
          return true;
        }).slice(0, limit);
        return {
          nearbyCount: nearby.length,
          totalNational: data.features.length,
          radiusDeg: radiusDeg,
          time_range: (opts && opts.time_range) || null,
          nearest: nearby.map(function(f) {
            return {
              magnitude: f.properties.magnitude,
              depth: f.properties.depth,
              locality: f.properties.locality,
              time: f.properties.time,
              distance_km: Math.round(haversine(lat, lng, f.geometry.coordinates[1], f.geometry.coordinates[0]))
            };
          })
        };
      }
    },

    volcanoes: {
      name: "GeoNet Volcano Alert Levels",
      category: "seismic",
      description: "All NZ volcanic alert levels with distance from location",
      query: function(lat, lng) {
        return "https://api.geonet.org.nz/volcano/val";
      },
      parse: function(data, lat, lng) {
        if (!data || !data.features) return null;
        return data.features.map(function(f) {
          var c = f.geometry.coordinates;
          return {
            name: f.properties.volcanoTitle || f.properties.volcanoID,
            level: f.properties.level,
            activity: f.properties.activity,
            hazards: f.properties.hazards,
            distance_km: Math.round(haversine(lat, lng, c[1], c[0]))
          };
        }).sort(function(a, b) { return a.distance_km - b.distance_km; });
      }
    },

    weather: {
      name: "Open-Meteo Current Weather",
      category: "weather",
      description: "Temperature, wind, conditions from coordinates",
      timeRangeTranslations: {
        "today": "current", "now": "current", "right now": "current",
        "this week": "forecast7", "next week": "forecast7", "weekly": "forecast7",
        "tomorrow": "forecast1", "next few days": "forecast3",
        "3 days": "forecast3", "3 day": "forecast3"
      },
      query: function(lat, lng, opts) {
        var base = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lng + "&timezone=Pacific%2FAuckland";
        var mode = "current";
        if (opts && opts.time_range) {
          var translated = this.timeRangeTranslations[opts.time_range.toLowerCase()];
          if (translated) mode = translated;
        }
        if (mode === "forecast7") {
          return base + "&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&forecast_days=7";
        }
        if (mode === "forecast3") {
          return base + "&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&forecast_days=3";
        }
        if (mode === "forecast1") {
          return base + "&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&forecast_days=2";
        }
        return base + "&current_weather=true";
      },
      parse: function(data) {
        if (!data) return null;
        var codes = {
          0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
          45: "Fog", 48: "Depositing rime fog",
          51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
          61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
          71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
          80: "Slight showers", 81: "Moderate showers", 82: "Violent showers",
          95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail"
        };
        var result = {};
        if (data.current_weather) {
          var w = data.current_weather;
          result.current = {
            temperature_c: w.temperature,
            windspeed_kmh: w.windspeed,
            wind_direction: w.winddirection,
            weather_code: w.weathercode,
            conditions: codes[w.weathercode] || "Unknown (" + w.weathercode + ")",
            time: w.time
          };
        }
        if (data.daily && data.daily.time) {
          result.forecast = data.daily.time.map(function(day, i) {
            return {
              date: day,
              max_c: data.daily.temperature_2m_max[i],
              min_c: data.daily.temperature_2m_min[i],
              rain_mm: data.daily.precipitation_sum[i],
              conditions: codes[data.daily.weathercode[i]] || "Unknown"
            };
          });
        }
        return result.current || result.forecast ? result : null;
      }
    },

    elevation: {
      name: "Open Elevation",
      category: "geo",
      description: "Metres above sea level from coordinates",
      query: function(lat, lng) {
        return "https://api.open-elevation.com/api/v1/lookup?locations=" + lat + "," + lng;
      },
      parse: function(data) {
        if (!data || !data.results || !data.results[0]) return null;
        return { elevation_m: data.results[0].elevation };
      }
    },

    poi: {
      name: "OpenStreetMap Points of Interest",
      category: "local",
      description: "Schools, shops, parks, hospitals near location",
      kindTranslations: {
        "restaurants": "amenity=restaurant", "restaurant": "amenity=restaurant",
        "food": "amenity=restaurant", "eat": "amenity=restaurant",
        "cafes": "amenity=cafe", "cafe": "amenity=cafe", "coffee": "amenity=cafe",
        "schools": "amenity=school", "school": "amenity=school",
        "hospitals": "amenity=hospital", "hospital": "amenity=hospital",
        "medical": "amenity=hospital",
        "doctors": "amenity=doctors", "doctor": "amenity=doctors",
        "pharmacy": "amenity=pharmacy", "pharmacies": "amenity=pharmacy", "chemist": "amenity=pharmacy",
        "parks": "leisure=park", "park": "leisure=park",
        "supermarkets": "shop=supermarket", "supermarket": "shop=supermarket",
        "shops": "shop", "shopping": "shop",
        "petrol": "amenity=fuel", "fuel": "amenity=fuel", "gas station": "amenity=fuel",
        "banks": "amenity=bank", "bank": "amenity=bank", "atm": "amenity=atm",
        "parking": "amenity=parking",
        "library": "amenity=library", "libraries": "amenity=library",
        "churches": "amenity=place_of_worship", "church": "amenity=place_of_worship"
      },
      scopeTranslations: {
        "nearby": 1000, "close": 500, "walking": 1000, "driving": 5000, "far": 5000
      },
      _buildUrl: function(lat, lng, radius, limit, filter) {
        var overpass;
        if (filter) {
          overpass = "[out:json][timeout:10];(node(around:" + radius + "," + lat + "," + lng + ")[" + filter + "];);out " + limit + ";";
        } else {
          overpass = "[out:json][timeout:10];(node(around:" + radius + "," + lat + "," + lng + ")[amenity];node(around:" + radius + "," + lat + "," + lng + ")[shop];);out " + limit + ";";
        }
        return "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(overpass);
      },
      query: function(lat, lng, opts) {
        var radius = 2000;
        if (opts && opts.scope) {
          var r = this.scopeTranslations[opts.scope.toLowerCase()];
          if (r) radius = r;
        }
        var filter = null;
        if (opts && opts.kind) {
          var kTranslated = this.kindTranslations[opts.kind.toLowerCase()];
          if (kTranslated) filter = kTranslated;
        }
        if (!filter && opts && opts.thing) {
          var thingTranslated = this.kindTranslations[opts.thing.toLowerCase()];
          if (thingTranslated) filter = thingTranslated;
        }
        var limit = filter ? 40 : 20;
        return this._buildUrl(lat, lng, radius, limit, filter);
      },
      // Session 43: retry with smaller radius on Overpass 504/429
      retryQuery: function(lat, lng, opts) {
        var filter = null;
        if (opts && opts.kind) {
          var kTranslated = this.kindTranslations[opts.kind.toLowerCase()];
          if (kTranslated) filter = kTranslated;
        }
        return this._buildUrl(lat, lng, 500, 10, filter);
      },
      parse: function(data) {
        if (!data || !data.elements) return null;
        var categories = {};
        data.elements.forEach(function(el) {
          var type = el.tags.amenity || el.tags.shop || el.tags.leisure || "other";
          if (!categories[type]) categories[type] = [];
          categories[type].push({ name: el.tags.name || "(unnamed)", lat: el.lat, lng: el.lon });
        });
        return { total: data.elements.length, categories: categories };
      }
    },

    wikipedia: {
      name: "Wikipedia Geosearch",
      category: "knowledge",
      description: "Wikipedia articles about nearby places and features",
      query: function(lat, lng) {
        return "https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=" + lat + "|" + lng + "&gsradius=5000&gslimit=10&format=json&origin=*";
      },
      parse: function(data) {
        if (!data || !data.query || !data.query.geosearch) return null;
        return data.query.geosearch.map(function(item) {
          return {
            title: item.title,
            distance_m: item.dist,
            url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(item.title.replace(/ /g, "_"))
          };
        });
      }
    },

    wikidata: {
      name: "Wikidata Entity Search",
      category: "knowledge",
      description: "Structured knowledge graph data about the location",
      qualifiesWhen: ["place"],
      queryByName: function(place) {
        return "https://www.wikidata.org/w/api.php?action=wbsearchentities&search=" + encodeURIComponent(place) + "&language=en&format=json&origin=*&limit=5";
      },
      parse: function(data) {
        if (!data || !data.search) return null;
        return data.search.map(function(item) {
          return {
            id: item.id,
            label: item.label,
            description: item.description,
            url: item.concepturi
          };
        });
      }
    },

    intensity: {
      name: "GeoNet Measured Intensity",
      category: "seismic",
      description: "Ground shaking intensity measurements across NZ",
      query: function(lat, lng) {
        return "https://api.geonet.org.nz/intensity?type=measured";
      },
      parse: function(data, lat, lng) {
        if (!data || !data.features) return null;
        var sorted = data.features.map(function(f) {
          var c = f.geometry.coordinates;
          return {
            mmi: f.properties.mmi,
            distance_km: Math.round(haversine(lat, lng, c[1], c[0]))
          };
        }).sort(function(a, b) { return a.distance_km - b.distance_km; });
        return {
          nearestStation: sorted[0] || null,
          stationsWithin50km: sorted.filter(function(s) { return s.distance_km <= 50; }).length,
          totalStations: data.features.length
        };
      }
    },

    // ── realestate.co.nz Residential Sales ──────────────────────
    // JSON:API 1.0 backend. Keyword-only (no coords needed). Region ID
    // translation table above. Stealth headers via mod.fetchHeaders.
    // Contract enabled=false in Firebase until Activation.
    "realestate-sale": {
      name: "realestate.co.nz Residential Sales",
      category: "property",
      description: "Residential sale listings from realestate.co.nz (res_sale vertical)",
      // Module can fire without a place (nationwide default) but typically needs one.
      qualifiesWhen: [],
      // Keyword-only — no coords required. The run() short-circuit uses this flag
      // to skip the Nominatim geocode when this is the only module requested.
      keywordOnly: true,
      // Tell runModule to use realestate.co.nz stealth headers for this fetch.
      // fetchHeaders is a function (not a static object) so UA rotates per call.
      fetchHeaders: function() { return buildRealestateHeaders(); },
      // Larger timeout — realestate.co.nz agg queries can be ~3-5s.
      timeoutMs: 15000,

      queryByName: function(place, opts) {
        var o = opts || {};
        var params = [];

        // Vertical filter — always res_sale. S77: the param is now
        // filter[category][] (was filter[listingSubType][]). Values unchanged.
        params.push("filter[category][]=res_sale");

        // Region translation: "auckland" → 35 (numeric, no change in S77).
        if (place) {
          var placeKey = String(place).toLowerCase().trim();
          var regionId = REALESTATE_REGIONS[placeKey];
          if (regionId) {
            params.push("filter[region][]=" + regionId);
          }
          // If not matched, fall through to nationwide — don't silently fail.
        }

        // Kind (house/apartment/etc) → filter[propertyType][]=<numeric id>.
        // S77: values are numeric IDs now (House=1, Apartment=2, …).
        if (o.kind) {
          var kindKey = String(o.kind).toLowerCase().trim();
          var kindId = REALESTATE_KINDS[kindKey];
          if (kindId) {
            params.push("filter[propertyType][]=" + kindId);
          }
        }
        // Fallback: thing may carry the property kind ("houses in auckland")
        if (!o.kind && o.thing) {
          var thingKey = String(o.thing).toLowerCase().trim();
          var thingKindId = REALESTATE_KINDS[thingKey];
          if (thingKindId) {
            params.push("filter[propertyType][]=" + thingKindId);
          }
        }

        // Preference → boolean attribute filter (camelCase keys, S77).
        if (o.preference) {
          var prefKey = String(o.preference).toLowerCase().trim();
          var prefField = REALESTATE_PREFS[prefKey];
          if (prefField) {
            params.push("filter[" + prefField + "]=true");
          }
        }

        // Qualifier/preference → sort. S77: API no longer accepts sort/order/
        // orderBy/sortBy; any of them 400. Server default order (featured)
        // is used until the sort surface returns. Table kept empty for forward compat.

        // Page size — 25 matches the site default and gives a rich card grid.
        // S77: page[size] → page[limit]. page[number] is no longer accepted
        // (API 400s with '"number" is not allowed'). page[limit] alone paginates
        // from page 1. Future pagination will use page[offset] when needed.
        params.push("page[limit]=25");

        // Facet aggregations — meta[aggs] must be a comma-separated STRING,
        // not an array (array form 400s with "aggs must be a string").
        // S77: API still silently accepts the old agg names (listingCategoryCode,
        // listingSubType) but returns nothing for them. Ask for current names.
        params.push("meta[aggs]=region,district,propertyType,category");

        return "https://api.realestate.co.nz/search/v1/listings?" + params.join("&");
      },

      parse: function(data, lat, lng, opts) {
        if (!data) return null;
        var dataArr = Array.isArray(data.data) ? data.data : [];
        var metaObj = data.meta || {};
        var total = (typeof metaObj.totalResults === "number") ? metaObj.totalResults : dataArr.length;

        var listings = dataArr.map(function(item) {
          var a = (item && item.attributes) || {};
          var addr = a.address || {};

          // Photo URL — the realestate.co.nz API returns photos[0] with a
          // `base-url` path and literal crop-suffix size fields (".crop.WxH.jpg").
          // mediaserver.realestate.co.nz accepts any .crop.WxH.jpg suffix, so we
          // build a card-optimal 800x600 URL here. Keeps the adapter CDN-agnostic.
          var image = null;
          if (Array.isArray(a.photos) && a.photos.length > 0) {
            var firstPhoto = a.photos[0];
            if (firstPhoto && firstPhoto["base-url"]) {
              image = "https://mediaserver.realestate.co.nz" +
                      firstPhoto["base-url"] +
                      ".crop.800x600.jpg";
            }
          }

          // Listing URL — prefer absolute website-full-url, fall back to slug.
          var href = a["website-full-url"] ||
                     (a["website-slug"] ? "https://www.realestate.co.nz" + a["website-slug"] : null);

          // Subtitle preference: suburb + district + region
          var subtitleParts = [];
          if (addr.suburb) subtitleParts.push(addr.suburb);
          if (addr.district && addr.district !== addr.suburb) subtitleParts.push(addr.district);
          if (addr.region && subtitleParts.length < 2) subtitleParts.push(addr.region);

          return {
            id: item.id || null,
            title: a.header || (addr.full && addr.full.split(",")[0]) || "(no title)",
            address: addr.full || null,
            subtitle: subtitleParts.join(", "),
            priceDisplay: a["price-display"] || null,
            priceCode: a["price-code"] || null,
            bedrooms: a["bedroom-count"] || null,
            bathrooms: a["bathrooms-total-count"] || a["bathroom-count"] || null,
            landArea: a["land-area"] || null,
            landAreaUnit: a["land-area-unit"] || null,
            floorArea: a["floor-area"] || null,
            floorAreaUnit: a["floor-area-unit"] || null,
            parkingGarage: a["parking-garage-count"] || null,
            parkingCovered: a["parking-covered-count"] || null,
            listingCategory: a["listing-category-code"] || null,
            listingSubType: a["listing-sub-type"] || null,
            listingStatus: a["listing-status"] || null,
            listingNo: a["listing-no"] || null,
            auctionDate: a["auction-date"] || null,
            publishedDate: a["publication-date"] || a["created-date"] || null,
            image: image,
            href: href,
            flags: {
              mortgagee: !!a["is-mortgagee-sale"],
              newBuild: !!a["is-new-construction"],
              coastal: !!a["is-coastal-waterfront"],
              featured: !!a["is-featured"],
              superFeatured: !!a["is-super-featured"]
            },
            raw: a
          };
        });

        // Facet cloud from meta.aggs (string keys, doc_count).
        var facets = {};
        if (metaObj.aggs && typeof metaObj.aggs === "object") {
          Object.keys(metaObj.aggs).forEach(function(facetKey) {
            var bucket = metaObj.aggs[facetKey];
            if (Array.isArray(bucket)) {
              facets[facetKey] = bucket.map(function(b) {
                return { key: b.key, count: b.doc_count };
              });
            }
          });
        }

        return {
          totalCount: total,
          returned: listings.length,
          listings: listings,
          facets: facets
        };
      }
    },

    // ── realestate.co.nz Listing Detail (v1.2.0, S78) ───────────
    // HTML scrape of the public listing detail page. Returns the four
    // signals the JSON:API does not expose: totalViews, suburbMedianPrice,
    // suburbYoYPercent/Direction, listedDate/daysOnMarket.
    //
    // qualifiesWhen:['listing_id'] — normal search flows never dispatch it;
    // only investigateListing() (see run() route) fires this module.
    // Adapter-side: fire on detail-panel open (cheap: 1 HTML fetch).
    "realestate-listing-detail": {
      name: "realestate.co.nz Listing Detail",
      category: "property",
      description: "Scrapes views + suburb median + YoY + listed-date from the public listing detail HTML",
      qualifiesWhen: ["listing_id"],
      primaryField: "listing_id",
      keywordOnly: true,
      fetchHeaders: function() { return buildRealestateHtmlHeaders(); },
      timeoutMs: 10000,

      queryByName: function(listingId, opts) {
        // /{id} 301-redirects to /{id}/residential/sale/{slug}; fetchText
        // follows redirects so we don't need the slug.
        return "https://www.realestate.co.nz/" + encodeURIComponent(listingId);
      },

      parse: function(html, lat, lng, opts) {
        return parseRealestateDetailHtml(html);
      }
    }
  };

  // ── KEYED SLOTS (dormant — need API keys to activate) ─────────

  var keyedSlots = {
    nzbn: { name: "NZBN Business Registry", keyParam: "Ocp-Apim-Subscription-Key", url: "https://api.business.govt.nz/gateway/nzbn/v5/entities", status: "dormant" },
    stats_nz: { name: "Stats NZ Demographics", keyParam: "key", url: "https://datafinder.stats.govt.nz/services/query/v1/vector.json", status: "dormant" },
    niwa_tides: { name: "NIWA Tide Predictions", keyParam: "x-apikey", url: "https://api.niwa.co.nz/tides/data", status: "dormant" },
    linz_data: { name: "LINZ Property & Address Data", keyParam: "key", url: "https://data.linz.govt.nz/services/api/v1/", status: "dormant" }
  };

  // ── ORCHESTRATION ─────────────────────────────────────────────

  // Resolve per-module fetch headers. If mod.fetchHeaders is a function,
  // call it fresh every time (so UA rotates per request). If it's an object,
  // use it as-is. If undefined, fall back to the generic Accept header.
  function resolveModuleHeaders(mod) {
    if (!mod || typeof mod.fetchHeaders === "undefined") return null;
    if (typeof mod.fetchHeaders === "function") return mod.fetchHeaders();
    return mod.fetchHeaders;
  }

  function runModule(name, mod, lat, lng, opts) {
    var url;
    if (mod.queryByName && opts && opts.place) {
      url = mod.queryByName(opts.place, opts);
    } else if (mod.queryByName && mod.keywordOnly) {
      // Keyword-only modules can run without a place (e.g. nationwide real estate).
      url = mod.queryByName(null, opts);
    } else if (mod.query && lat !== null && lng !== null) {
      url = mod.query(lat, lng, opts);
    } else {
      return Promise.resolve({ module: name, name: mod.name, category: mod.category, status: "no_query" });
    }

    var headers = resolveModuleHeaders(mod);
    var timeout = mod.timeoutMs || 10000;

    return fetchJson(url, timeout, headers).then(function(data) {
      var parsed = mod.parse(data, lat, lng, opts);
      return { module: name, name: mod.name, category: mod.category, status: parsed ? "ok" : "empty", data: parsed };
    }).catch(function(err) {
      // POI retry on Overpass 504/429
      var retryable = /\b(504|429|Timeout)\b/.test(err.message);
      if (retryable && mod.retryQuery) {
        var retryUrl = mod.retryQuery(lat, lng, opts);
        console.log("[nz-intel] " + name + " retrying at reduced radius");
        return fetchJson(retryUrl, timeout, headers).then(function(data) {
          var parsed = mod.parse(data, lat, lng, opts);
          return { module: name, name: mod.name, category: mod.category, status: parsed ? "ok" : "empty", data: parsed, _retried: true };
        }).catch(function(retryErr) {
          return { module: name, name: mod.name, category: mod.category, status: "error", error: retryErr.message, _retried: true };
        });
      }
      return { module: name, name: mod.name, category: mod.category, status: "error", error: err.message };
    });
  }

  function investigate(lat, lng, opts) {
    var options = opts || {};
    var requested = options.modules || Object.keys(modules);
    var start = Date.now();

    // Filter to only modules this cartridge owns and that can fire
    var active = requested.filter(function(name) {
      if (name === "search") return false; // search is internal (geocoding)
      var mod = modules[name];
      if (!mod) return false;
      // qualifiesWhen gate
      if (mod.qualifiesWhen && mod.qualifiesWhen.length > 0) {
        for (var q = 0; q < mod.qualifiesWhen.length; q++) {
          if (!options[mod.qualifiesWhen[q]]) return false;
        }
      }
      return true;
    });

    console.log("[nz-intel] Investigating " + lat + ", " + lng + " | " + active.length + " modules");

    var tasks = active.map(function(name) {
      return runModule(name, modules[name], lat, lng, options);
    });

    return Promise.all(tasks).then(function(results) {
      var response = {
        cartridge: meta.id,
        version: meta.version,
        query: { lat: lat, lng: lng, place: options.place || null, thing: options.thing || null, qualifier: options.qualifier || null, scope: options.scope || null },
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - start,
        modules: {}
      };
      var ok = 0, errors = 0;
      results.forEach(function(r) {
        response.modules[r.module] = r;
        if (r.status === "ok") ok++;
        if (r.status === "error") errors++;
      });
      response.summary = { total: results.length, ok: ok, errors: errors, empty: results.length - ok - errors };
      console.log("[nz-intel] Complete | " + ok + "/" + results.length + " ok | " + response.duration_ms + "ms");
      return response;
    });
  }

  function investigateByKeyword(opts) {
    var options = opts || {};
    var start = Date.now();
    var requested = options.modules || Object.keys(modules);

    // Only modules with queryByName can fire without coords.
    // When opts.modules is specified, honour it verbatim (filtered to keyword-capable).
    var keywordModules = requested.filter(function(key) {
      if (key === "search") return false;
      var mod = modules[key];
      if (!mod) return false;
      if (!mod.queryByName) return false;
      if (mod.qualifiesWhen && mod.qualifiesWhen.length > 0) {
        for (var q = 0; q < mod.qualifiesWhen.length; q++) {
          if (!options[mod.qualifiesWhen[q]]) return false;
        }
      }
      // If a module needs a place but we don't have one, skip — unless it's keywordOnly.
      if (!options.place && !mod.keywordOnly) return false;
      return true;
    });

    console.log("[nz-intel] Keyword-only | " + keywordModules.length + " modules");

    var tasks = keywordModules.map(function(key) {
      return runModule(key, modules[key], null, null, options);
    });

    return Promise.all(tasks).then(function(results) {
      var response = {
        cartridge: meta.id,
        version: meta.version,
        query: { lat: null, lng: null, place: options.place || null, thing: options.thing || null },
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - start,
        geocode: "not_needed",
        modules: {}
      };
      var ok = 0, errors = 0;
      results.forEach(function(r) {
        response.modules[r.module] = r;
        if (r.status === "ok") ok++;
        if (r.status === "error") errors++;
      });
      response.summary = { total: results.length, ok: ok, errors: errors, empty: results.length - ok - errors };
      return response;
    });
  }

  // v1.2.0 (S78): Listing-detail route. Fires when the kit-runner is
  // called with opts.listing_id set — typically triggered by the
  // adapter when a detail panel opens. Single-module HTML scrape,
  // no geocode, no search pipeline.
  function investigateListing(listingId, opts) {
    var start = Date.now();
    var mod = modules["realestate-listing-detail"];
    if (!mod) {
      return Promise.resolve({
        cartridge: meta.id,
        version: meta.version,
        _noop: true,
        error: "realestate-listing-detail module not loaded"
      });
    }
    var url = mod.queryByName(listingId, opts);
    var headers = resolveModuleHeaders(mod);
    var timeout = mod.timeoutMs || 10000;

    return fetchText(url, timeout, headers).then(function(html) {
      var parsed = mod.parse(html, null, null, opts);
      return {
        cartridge: meta.id,
        version: meta.version,
        query: { listing_id: listingId },
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - start,
        modules: {
          "realestate-listing-detail": {
            module: "realestate-listing-detail",
            name: mod.name,
            category: mod.category,
            status: parsed ? "ok" : "empty",
            data: parsed
          }
        },
        summary: { total: 1, ok: parsed ? 1 : 0, errors: 0, empty: parsed ? 0 : 1 }
      };
    }).catch(function(err) {
      return {
        cartridge: meta.id,
        version: meta.version,
        query: { listing_id: listingId },
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - start,
        modules: {
          "realestate-listing-detail": {
            module: "realestate-listing-detail",
            name: mod.name,
            category: mod.category,
            status: "error",
            error: err.message
          }
        },
        summary: { total: 1, ok: 0, errors: 1, empty: 0 }
      };
    });
  }

  // Check if all modules in the requested list can run without coords.
  // If so, we can skip the Nominatim geocode call entirely (saves ~500ms + one API hit).
  function allModulesKeywordOnly(requestedList) {
    if (!Array.isArray(requestedList) || requestedList.length === 0) return false;
    for (var i = 0; i < requestedList.length; i++) {
      var name = requestedList[i];
      var mod = modules[name];
      if (!mod) return false;
      // Needs coords if it has query() but no queryByName, OR it needs coords for parse.
      if (!mod.queryByName) return false;
      if (!mod.keywordOnly && !mod.qualifiesWhen) {
        // Ambiguous — assume it prefers coords. Safer to geocode.
        return false;
      }
    }
    return true;
  }

  // ── PUBLIC API (the cartridge contract) ───────────────────────

  return {
    meta: meta,

    // Single entry point — the kit-runner calls this
    run: function(params) {
      var p = params || {};

      if (p.status) return Promise.resolve(this.status());

      // v1.2.0 (S78) Route 0: Listing detail (listing_id present).
      // Dispatched by the adapter when a detail panel opens. Single
      // HTML-scrape module, no geocode, no search pipeline. Gated by
      // realestate-listing-detail's own qualifiesWhen:['listing_id'].
      if (p.listing_id) {
        return investigateListing(p.listing_id, p);
      }

      // Route 1: direct coords
      if (p.lat && p.lng) {
        var lat = parseFloat(p.lat);
        var lng = parseFloat(p.lng);
        if (isNaN(lat) || isNaN(lng)) {
          return Promise.reject(new Error("Invalid coordinates"));
        }
        return investigate(lat, lng, p);
      }

      // Route 2: place name → keyword short-circuit OR geocode → coords
      if (p.place) {
        var opts = p;
        // Short-circuit: if every requested module is keyword-only (e.g.
        // realestate-sale by itself), skip the Nominatim geocode entirely —
        // the module translates place → region ID via its own lookup table.
        if (opts.modules && allModulesKeywordOnly(opts.modules)) {
          console.log("[nz-intel] All requested modules keyword-only — skipping geocode");
          return investigateByKeyword(opts);
        }
        return fetchJson(modules.search.queryByName(p.place)).then(function(data) {
          var parsed = modules.search.parse(data);
          if (!parsed || parsed.length === 0) {
            console.log("[nz-intel] Geocode failed for '" + p.place + "' — keyword only");
            return investigateByKeyword(opts);
          }
          var best = parsed[0];
          console.log("[nz-intel] Resolved to: " + best.lat + ", " + best.lng);
          return investigate(best.lat, best.lng, opts);
        }).catch(function(err) {
          console.log("[nz-intel] Geocode error: " + err.message + " — keyword only");
          return investigateByKeyword(opts);
        });
      }

      // Route 3: keyword only (no place, no coords) — modules must be keywordOnly
      if (p.thing || (p.modules && allModulesKeywordOnly(p.modules))) {
        return investigateByKeyword(p);
      }

      // No actionable params
      return Promise.resolve({
        cartridge: meta.id,
        _noop: true,
        error: "Missing parameters (need lat+lng, place, or thing)"
      });
    },

    status: function() {
      var activeNames = Object.keys(modules);
      var dormantNames = Object.keys(keyedSlots);
      return {
        cartridge: meta.id,
        version: meta.version,
        born: meta.born,
        description: "NZ Intelligence Cartridge v1.1.0 — location sweep, seismic, weather, knowledge graph, realestate.co.nz residential sales.",
        activeModules: activeNames.length,
        keyedSlots: dormantNames.length,
        modules: activeNames.map(function(key) {
          return { id: key, name: modules[key].name, category: modules[key].category };
        }),
        dormant: dormantNames.map(function(key) {
          return { id: key, name: keyedSlots[key].name, status: "needs_api_key" };
        })
      };
    }
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = IoCartridge_NzIntel;
}
