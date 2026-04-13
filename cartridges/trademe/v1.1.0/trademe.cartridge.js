var IoCartridge_Trademe = (function() {
  "use strict";

  // ══════════════════════════════════════════════════════════════
  // TRADE ME MARKETPLACE CARTRIDGE v1.1.0
  // Born: Session 43 (extracted from sweep v1.10.0)
  // v1.1.0: trademe-stats onboarded (Session 43)
  // Modules: trademe, trademe-rental, trademe-property,
  //          trademe-cars, trademe-bikes, trademe-boats,
  //          trademe-jobs, trademe-flatmates, trademe-categories,
  //          trademe-localities, trademe-listing-detail,
  //          trademe-similar, trademe-stats
  // ══════════════════════════════════════════════════════════════

  var meta = {
    id: "trademe",
    label: "Trade Me",
    version: "1.1.0",
    born: "Session 43",
    extracted_from: "sweep v1.10.0",
    modules: {
      "trademe":                { name: "Trade Me Marketplace",       category: "marketplace", layout: "cards" },
      "trademe-rental":         { name: "Trade Me Rental Properties", category: "property",    layout: "cards" },
      "trademe-property":       { name: "Trade Me Property For Sale", category: "property",    layout: "cards" },
      "trademe-cars":           { name: "Trade Me Used Cars",         category: "motors",      layout: "cards" },
      "trademe-bikes":          { name: "Trade Me Motorbikes",        category: "motors",      layout: "cards" },
      "trademe-boats":          { name: "Trade Me Boats",             category: "motors",      layout: "cards" },
      "trademe-jobs":           { name: "Trade Me Jobs",              category: "employment",  layout: "cards" },
      "trademe-flatmates":      { name: "Trade Me Flatmates Wanted",  category: "flatmates",   layout: "cards" },
      "trademe-categories":     { name: "Trade Me Category Tree",     category: "reference",   layout: "rows" },
      "trademe-localities":     { name: "Trade Me Localities",        category: "reference",   layout: "rows" },
      "trademe-listing-detail": { name: "Trade Me Listing Detail",    category: "marketplace", layout: "cards" },
      "trademe-similar":        { name: "Trade Me Similar Listings",  category: "marketplace", layout: "cards" },
      "trademe-stats":          { name: "Trade Me Site Statistics",   category: "reference",   layout: "rows" }
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
        "most bids": "BidsMost",
        "most popular": "BidsMost",
        "cheapest": "PriceAsc",
        "lowest price": "PriceAsc",
        "most expensive": "PriceDesc",
        "highest price": "PriceDesc",
        "closing soon": "ExpiryAsc",
        "ending soon": "ExpiryAsc",
        "newest": "ListingDateDesc",
        "just listed": "ListingDateDesc",
        "most time left": "ExpiryDesc"
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
          var sorts = {"cheapest": "Rent", "lowest rent": "Rent", "lowest price": "Rent", "affordable": "Rent", "most expensive": "RentDesc", "highest rent": "RentDesc", "newest": "ListingDate", "latest": "ListingDate", "just listed": "ListingDate"};
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
          var sorts = {"cheapest": "Price", "lowest price": "Price", "affordable": "Price", "newest": "ListingDate", "latest": "ListingDate", "just listed": "ListingDate", "most expensive": "PriceDesc", "highest price": "PriceDesc", "priciest": "PriceDesc"};
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
          var sorts = {"cheapest": "PriceAsc", "lowest price": "PriceAsc", "affordable": "PriceAsc", "most expensive": "PriceDesc", "highest price": "PriceDesc", "priciest": "PriceDesc", "newest": "Latest", "latest": "Latest", "just listed": "Latest", "lowest km": "Odometer", "least km": "Odometer", "lowest mileage": "Odometer"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        params += "&rows=20";
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
        params += "&rows=20";
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
        params += "&rows=20";
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
          var sorts = {"highest pay": "PayDesc", "highest paying": "PayDesc", "best paid": "PayDesc", "top paying": "PayDesc", "most pay": "PayDesc", "lowest pay": "PayAsc", "newest": "ListingDate", "latest": "ListingDate", "just listed": "ListingDate", "closing soon": "ExpiryAsc", "ending soon": "ExpiryAsc"};
          var s = sorts[opts.qualifier.toLowerCase()];
          if (s) params += "&sort_order=" + s;
        }
        params += "&rows=20";
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
