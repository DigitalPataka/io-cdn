var IoCartridge_Trademe = (function() {
  "use strict";

  // ══════════════════════════════════════════════════════════════
  // TRADE ME MARKETPLACE CARTRIDGE v1.5.1
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
  // ══════════════════════════════════════════════════════════════

  var meta = {
    id: "trademe",
    label: "Trade Me",
    version: "1.5.1",
    born: "Session 43",
    extracted_from: "sweep v1.10.0",
    modules: {
      "trademe":                  { name: "Trade Me Marketplace",        category: "marketplace", layout: "cards" },
      "trademe-rental":           { name: "Trade Me Rental Properties",  category: "property",    layout: "cards" },
      "trademe-property":         { name: "Trade Me Property For Sale",  category: "property",    layout: "cards" },
      "trademe-cars":             { name: "Trade Me Used Cars",          category: "motors",      layout: "cards" },
      "trademe-bikes":            { name: "Trade Me Motorbikes",         category: "motors",      layout: "cards" },
      "trademe-boats":            { name: "Trade Me Boats",              category: "motors",      layout: "cards" },
      "trademe-jobs":             { name: "Trade Me Jobs",               category: "employment",  layout: "cards" },
      "trademe-flatmates":        { name: "Trade Me Flatmates Wanted",   category: "flatmates",   layout: "cards" },
      "trademe-categories":       { name: "Trade Me Category Tree",      category: "reference",   layout: "rows" },
      "trademe-localities":       { name: "Trade Me Localities",         category: "reference",   layout: "rows" },
      "trademe-listing-detail":   { name: "Trade Me Listing Detail",     category: "marketplace", layout: "cards" },
      "trademe-similar":          { name: "Trade Me Similar Listings",   category: "marketplace", layout: "cards" },
      "trademe-stats":            { name: "Trade Me Site Statistics",    category: "reference",   layout: "rows" },
      "trademe-commercial-sale":  { name: "Trade Me Commercial Sale",   category: "property",    layout: "cards" },
      "trademe-commercial-lease": { name: "Trade Me Commercial Lease",  category: "property",    layout: "cards" },
      "trademe-lifestyle":        { name: "Trade Me Lifestyle Property", category: "property",    layout: "cards" },
      "trademe-rural":            { name: "Trade Me Rural Property",     category: "property",    layout: "cards" },
      "trademe-open-homes":       { name: "Trade Me Open Homes",         category: "property",    layout: "cards" },
      "trademe-retirement":       { name: "Trade Me Retirement Villages", category: "property",   layout: "cards" },
      "trademe-stores":           { name: "Trade Me Stores",             category: "marketplace", layout: "cards" }
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
        // ── Listing date ──
        "newest": "ListingDateDesc",
        "just listed": "ListingDateDesc",
        "latest": "ListingDateDesc",
        "recently listed": "ListingDateDesc",
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
        // ── Alphabetical ──
        "alphabetical": "TitleAsc",
        "a to z": "TitleAsc",
        "by name": "TitleAsc"
      },
      queryByName: function(query, opts) {
        var searchTerm = (opts && opts.raw) ? opts.raw : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.category) {
          params = params + "&category=" + encodeURIComponent(opts.category);
        }
        if (opts && opts.region) {
          params = params + "&region=" + encodeURIComponent(opts.region);
        }
        if (opts && opts.qualifier) {
          var sortOrder = this.qualifierTranslations[opts.qualifier.toLowerCase()];
          if (sortOrder) {
            params = params + "&sort_order=" + sortOrder;
          }
        }
        var rows = 20;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "count" || s === "all" || s === "total") rows = 100;
          if (s === "top" || s === "best" || s === "first") rows = 5;
        }
        params = params + "&rows=" + rows;
        params = appendPriceParams(params, opts);
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
              startDate: item.StartDate || null,
              closingDate: item.EndDate,
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
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.qualifier) {
          var sorts = {"cheapest": "Rent", "lowest rent": "Rent", "lowest price": "Rent", "affordable": "Rent", "budget": "Rent", "most expensive": "RentDesc", "highest rent": "RentDesc", "priciest": "RentDesc", "newest": "ListingDate", "latest": "ListingDate", "just listed": "ListingDate", "recently listed": "ListingDate", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        var rows = 20;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
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
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.qualifier) {
          var sorts = {"cheapest": "Price", "lowest price": "Price", "affordable": "Price", "budget": "Price", "newest": "ListingDate", "latest": "ListingDate", "just listed": "ListingDate", "recently listed": "ListingDate", "most expensive": "PriceDesc", "highest price": "PriceDesc", "priciest": "PriceDesc", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost", "featured": "PropertyFeature", "premium": "PropertyFeature", "next open home": "EarliestOpenHome", "soonest open home": "EarliestOpenHome"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        var rows = 20;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
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
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.qualifier) {
          var sorts = {"cheapest": "PriceAsc", "lowest price": "PriceAsc", "affordable": "PriceAsc", "budget": "PriceAsc", "most expensive": "PriceDesc", "highest price": "PriceDesc", "priciest": "PriceDesc", "newest": "Latest", "latest": "Latest", "just listed": "Latest", "recently listed": "Latest", "lowest km": "Odometer", "least km": "Odometer", "lowest mileage": "Odometer", "lowest odometer": "Odometer", "highest km": "HighOdometer", "most km": "HighOdometer", "newest car": "MotorsLatestVehicle", "newest vehicle": "MotorsLatestVehicle", "newest model": "MotorsLatestVehicle", "latest model": "MotorsLatestVehicle", "oldest car": "MotorsOldestVehicle", "oldest vehicle": "MotorsOldestVehicle", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost", "most bids": "BidsMost", "high bid count": "BidsMost", "closing soon": "ExpiryAsc", "ending soon": "ExpiryAsc"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        params += "&rows=20";
        params = appendPriceParams(params, opts);
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
      thingTriggers: ["motorbike", "motorbikes", "motorcycle", "motorcycles", "bike", "harley", "honda", "yamaha", "kawasaki", "suzuki", "ducati"],
      queryByName: function(query, opts) {
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.qualifier) {
          var sorts = {"cheapest": "PriceAsc", "lowest price": "PriceAsc", "most expensive": "PriceDesc", "highest price": "PriceDesc", "newest": "Latest", "latest": "Latest", "just listed": "Latest", "lowest km": "Odometer", "least km": "Odometer", "newest bike": "MotorsLatestVehicle", "newest model": "MotorsLatestVehicle", "oldest bike": "MotorsOldestVehicle", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost", "most bids": "BidsMost", "closing soon": "ExpiryAsc", "ending soon": "ExpiryAsc"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        params += "&rows=20";
        params = appendPriceParams(params, opts);
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
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.qualifier) {
          var sorts = {"cheapest": "PriceAsc", "lowest price": "PriceAsc", "most expensive": "PriceDesc", "highest price": "PriceDesc", "newest": "Latest", "latest": "Latest", "just listed": "Latest", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost", "most bids": "BidsMost", "closing soon": "ExpiryAsc", "ending soon": "ExpiryAsc"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        params += "&rows=20";
        params = appendPriceParams(params, opts);
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
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.qualifier) {
          var sorts = {"highest pay": "PayDesc", "highest paying": "PayDesc", "best paid": "PayDesc", "top paying": "PayDesc", "most pay": "PayDesc", "highest salary": "PayDesc", "lowest pay": "PayAsc", "lowest salary": "PayAsc", "newest": "ListingDate", "latest": "ListingDate", "just listed": "ListingDate", "recently listed": "ListingDate", "closing soon": "ExpiryAsc", "ending soon": "ExpiryAsc", "best match": "BestMatch", "most relevant": "BestMatch", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        params += "&rows=20";
        params = appendPriceParams(params, opts);
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
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        params += "&rows=20";
        params = appendPriceParams(params, opts);
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
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.qualifier) {
          var sorts = {"cheapest": "Price", "lowest price": "Price", "most expensive": "PriceDesc", "highest price": "PriceDesc", "newest": "ListingDate", "latest": "ListingDate", "just listed": "ListingDate", "recently listed": "ListingDate", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost", "featured": "PropertyFeature", "premium": "PropertyFeature"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        var rows = 20;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
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
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.qualifier) {
          var sorts = {"cheapest": "Rent", "lowest rent": "Rent", "lowest price": "Rent", "affordable": "Rent", "most expensive": "RentDesc", "highest rent": "RentDesc", "priciest": "RentDesc", "newest": "ListingDate", "latest": "ListingDate", "just listed": "ListingDate", "recently listed": "ListingDate", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost", "featured": "PropertyFeature", "premium": "PropertyFeature"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        var rows = 20;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
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
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.qualifier) {
          var sorts = {"cheapest": "Price", "lowest price": "Price", "most expensive": "PriceDesc", "highest price": "PriceDesc", "newest": "ListingDate", "latest": "ListingDate", "just listed": "ListingDate", "recently listed": "ListingDate", "biggest": "LandAreaDesc", "largest": "LandAreaDesc", "most land": "LandAreaDesc", "smallest": "LandArea", "least land": "LandArea", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost", "featured": "PropertyFeature", "premium": "PropertyFeature"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        var rows = 20;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
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
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.qualifier) {
          var sorts = {"cheapest": "Price", "lowest price": "Price", "most expensive": "PriceDesc", "highest price": "PriceDesc", "newest": "ListingDate", "latest": "ListingDate", "just listed": "ListingDate", "recently listed": "ListingDate", "biggest": "LandAreaDesc", "largest": "LandAreaDesc", "most land": "LandAreaDesc", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost", "featured": "PropertyFeature", "premium": "PropertyFeature"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        var rows = 20;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
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
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.qualifier) {
          var sorts = {"cheapest": "Price", "lowest price": "Price", "most expensive": "PriceDesc", "highest price": "PriceDesc", "soonest": "OpenHomeDate", "next": "OpenHomeDate", "earliest": "EarliestOpenHome", "next open home": "EarliestOpenHome", "newest": "ListingDate", "latest": "ListingDate", "just listed": "ListingDate", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        var rows = 20;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
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
        var searchTerm = (opts && opts.place) ? opts.place : query;
        var params = "search_string=" + encodeURIComponent(searchTerm);
        if (opts && opts.qualifier) {
          var sorts = {"cheapest": "Price", "lowest price": "Price", "most expensive": "PriceDesc", "highest price": "PriceDesc", "newest": "ListingDate", "latest": "ListingDate", "just listed": "ListingDate", "recently listed": "ListingDate", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        var rows = 20;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
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
        if (opts && opts.qualifier) {
          var sorts = {"cheapest": "PriceAsc", "lowest price": "PriceAsc", "affordable": "PriceAsc", "most expensive": "PriceDesc", "highest price": "PriceDesc", "newest": "ListingDateDesc", "just listed": "ListingDateDesc", "latest": "ListingDateDesc", "recently listed": "ListingDateDesc", "closing soon": "ExpiryAsc", "ending soon": "ExpiryAsc", "most bids": "BidsMost", "highest bids": "BidsMost", "high bid count": "BidsMost", "most watched": "WatchersMost", "most watchers": "WatchersMost", "trending": "WatchersMost", "most popular": "WatchersMost", "biggest discount": "LargestDiscount", "best deal": "LargestDiscount", "best reviewed": "ReviewsDesc", "highest rated": "ReviewsDesc"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        var rows = 20;
        if (opts && opts.scope) {
          var s = opts.scope.toLowerCase();
          if (s === "all" || s === "total") rows = 50;
          if (s === "top" || s === "first") rows = 5;
        }
        params += "&rows=" + rows;
        params = appendPriceParams(params, opts);
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
        return {
          id: data.ListingId,
          title: data.Title || null,
          subtitle: data.Subtitle || null,
          body: data.Body || null,
          url: "https://www.trademe.co.nz/a/listing/" + data.ListingId,
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
              closingDate: item.EndDate || null,
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
  function runModule(name, url, mod, opts) {
    return fetchJson(url, null, mod.fetchHeaders || null).then(function(data) {
      var parsed = mod.parse(data);
      if (parsed && mod.integrityFilter) {
        parsed = mod.integrityFilter(parsed, opts);
      }
      if (parsed && mod.applyPreference) {
        parsed = mod.applyPreference(parsed, opts);
      }
      return { module: name, name: mod.name, category: mod.category, status: parsed ? "ok" : "empty", data: parsed };
    }).catch(function(err) {
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
      var qualified = qualifyModules(opts);
      var active = qualified.modules;

      // If caller specified which modules to fire, intersect
      if (opts.modules && Array.isArray(opts.modules)) {
        var requested = opts.modules;
        active = active.filter(function(n) { return requested.indexOf(n) !== -1; });
      }

      console.log("[trademe] Qualified: " + active.length + "/" + Object.keys(modules).length + (qualified.hasSpecialist ? " (specialist matched)" : ""));

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

  function investigateListing(listingId, opts, start) {
    var s = start || Date.now();
    var detailMod = modules["trademe-listing-detail"];
    var similarMod = modules["trademe-similar"];
    var tasks = [];

    if (detailMod) {
      var detailUrl = detailMod.queryByName(listingId, opts);
      tasks.push(runModule("trademe-listing-detail", detailUrl, detailMod, opts));
    }
    if (similarMod) {
      var similarUrl = similarMod.queryByName(listingId, opts);
      tasks.push(runModule("trademe-similar", similarUrl, similarMod, opts));
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
