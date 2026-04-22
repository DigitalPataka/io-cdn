var IoCartridge_NzIntel = (function() {
  "use strict";

  // ══════════════════════════════════════════════════════════════
  // NZ INTELLIGENCE CARTRIDGE v1.1.0
  // Born: Session 43 (extracted from sweep v1.10.0)
  // S76: added realestate-sale module (realestate.co.nz residential sales)
  //      — honours opts.modules for marketplace dispatch
  //      — skips geocode when all requested modules are keyword-only
  //      — per-module fetch headers for stealth on non-TM hosts
  // Modules: geocode, search, quakes, volcanoes, weather,
  //          elevation, poi, wikipedia, wikidata, intensity,
  //          realestate-sale
  // ══════════════════════════════════════════════════════════════

  var meta = {
    id: "nz-intel",
    label: "NZ Intelligence",
    version: "1.1.0",
    born: "Session 43",
    extracted_from: "sweep v1.10.0",
    modules: {
      geocode:            { name: "Nominatim Reverse Geocode",       category: "geo",       layout: "rows" },
      search:             { name: "Nominatim Forward Search",         category: "geo",       layout: "rows" },
      quakes:             { name: "GeoNet Recent Quakes",             category: "seismic",   layout: "rows" },
      volcanoes:          { name: "GeoNet Volcano Alert Levels",      category: "seismic",   layout: "rows" },
      weather:            { name: "Open-Meteo Current Weather",       category: "weather",   layout: "rows" },
      elevation:          { name: "Open Elevation",                   category: "geo",       layout: "rows" },
      poi:                { name: "OpenStreetMap Points of Interest", category: "local",     layout: "rows" },
      wikipedia:          { name: "Wikipedia Geosearch",              category: "knowledge", layout: "rows" },
      wikidata:           { name: "Wikidata Entity Search",           category: "knowledge", layout: "rows" },
      intensity:          { name: "GeoNet Measured Intensity",        category: "seismic",   layout: "rows" },
      "realestate-sale":  { name: "realestate.co.nz Residential Sales", category: "property", layout: "cards" }
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

  // listing-category-code enum values (verified by probe).
  // These map IoQL "kind" to the filter parameter.
  var REALESTATE_KINDS = {
    "house": "House",
    "houses": "House",
    "apartment": "Apartment",
    "apartments": "Apartment",
    "townhouse": "Townhouse",
    "townhouses": "Townhouse",
    "unit": "Unit",
    "units": "Unit",
    "section": "Section",
    "sections": "Section",
    "lifestyle": "Lifestyle",
    "lifestyle property": "Lifestyle"
  };

  // IoQL "preference" → realestate.co.nz boolean attribute
  var REALESTATE_PREFS = {
    "mortgagee": "is-mortgagee-sale",
    "mortgagee sale": "is-mortgagee-sale",
    "new build": "is-new-construction",
    "new construction": "is-new-construction",
    "new": "is-new-construction",
    "waterfront": "is-coastal-waterfront",
    "coastal": "is-coastal-waterfront",
    "featured": "is-featured"
  };

  // IoQL "qualifier"/"preference" → JSON:API sort spec
  // Default ordering (no sort param) matches site featured order.
  var REALESTATE_SORTS = {
    "cheapest": "price.asc",
    "cheap": "price.asc",
    "lowest": "price.asc",
    "expensive": "price.desc",
    "dearest": "price.desc",
    "newest": "-publication-date",
    "latest": "-publication-date",
    "oldest": "publication-date",
    "largest": "-floor-area",
    "biggest": "-floor-area",
    "smallest": "floor-area"
  };

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

        // Vertical filter — always res_sale. This is the default listingSubType
        // per the spine contract. listingType=Sale is an alternate but res_sale
        // is what's verified against the 45,631 nationwide count.
        params.push("filter[listingSubType][]=res_sale");

        // Region translation: "auckland" → 35
        if (place) {
          var placeKey = String(place).toLowerCase().trim();
          var regionId = REALESTATE_REGIONS[placeKey];
          if (regionId) {
            params.push("filter[region][]=" + regionId);
          }
          // If not matched, fall through to nationwide — don't silently fail.
        }

        // Kind (house/apartment/etc) → listing-category-code
        if (o.kind) {
          var kindKey = String(o.kind).toLowerCase().trim();
          var kindCode = REALESTATE_KINDS[kindKey];
          if (kindCode) {
            params.push("filter[listingCategoryCode][]=" + encodeURIComponent(kindCode));
          }
        }
        // Fallback: thing may carry the property kind ("houses in auckland")
        if (!o.kind && o.thing) {
          var thingKey = String(o.thing).toLowerCase().trim();
          var thingKindCode = REALESTATE_KINDS[thingKey];
          if (thingKindCode) {
            params.push("filter[listingCategoryCode][]=" + encodeURIComponent(thingKindCode));
          }
        }

        // Preference → boolean attribute filter
        if (o.preference) {
          var prefKey = String(o.preference).toLowerCase().trim();
          var prefField = REALESTATE_PREFS[prefKey];
          if (prefField) {
            params.push("filter[" + prefField + "]=true");
          }
        }

        // Qualifier/preference → JSON:API sort
        var sortKey = (o.qualifier && String(o.qualifier).toLowerCase().trim()) ||
                      (o.preference && String(o.preference).toLowerCase().trim());
        if (sortKey) {
          var sortVal = REALESTATE_SORTS[sortKey];
          if (sortVal) {
            params.push("sort=" + encodeURIComponent(sortVal));
          }
        }

        // Page size — 25 matches the site default and gives a rich card grid.
        // Backend uses page[size]/page[number] per JSON:API spec.
        params.push("page[size]=25");
        params.push("page[number]=1");

        // Facet aggregations — CRITICAL: meta[aggs] must be a STRING (comma-list),
        // NOT an array. meta[aggs][]=region returns 400 "aggs must be a string".
        // Facet cloud lives under meta.aggs in the response.
        params.push("meta[aggs]=region,district,listingCategoryCode,listingSubType");

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

          // Photo URL — the "large" or "standard" variant is best for cards.
          var image = null;
          if (Array.isArray(a.photos) && a.photos.length > 0) {
            var firstPhoto = a.photos[0];
            if (firstPhoto && firstPhoto.urls) {
              image = firstPhoto.urls.large ||
                      firstPhoto.urls.standard ||
                      firstPhoto.urls.medium ||
                      firstPhoto.urls.small ||
                      null;
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
