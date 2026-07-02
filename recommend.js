/*
 * What to Wear — rule-based recommendation engine (no ML).
 * Pure functions only: no DOM, no storage, no network. Unit-testable in isolation.
 * Works both as a browser global (window.WTW) and a Node module (require).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WTW = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WARMTH_RANK = { light: 1, medium: 2, heavy: 3 };

  // --- Base layer from "feels like" temperature (°C) -----------------------
  // Mirrors the decision table in the spec.
  function baseTier(feelsLike) {
    if (feelsLike > 22)  return { tier: "hot",      top: "light",  bottom: "light",  outer: null,     accessories: false, label: "Light top only" };
    if (feelsLike >= 15) return { tier: "warm",     top: "light",  bottom: "light",  outer: "light",  accessories: false, label: "Light top + light layer" };
    if (feelsLike >= 8)  return { tier: "mild",     top: "medium", bottom: "medium", outer: "medium", accessories: false, label: "Medium top + medium outer" };
    if (feelsLike >= 0)  return { tier: "cold",     top: "medium", bottom: "medium", outer: "heavy",  accessories: false, label: "Medium top + heavy outer" };
    return                      { tier: "freezing", top: "heavy",  bottom: "heavy",  outer: "heavy",  accessories: true,  label: "Heavy top + heavy outer + accessories" };
  }

  function closestByWarmth(items, targetWarmth) {
    if (!items.length) return null;
    var target = WARMTH_RANK[targetWarmth] || 2;
    return items.slice().sort(function (a, b) {
      var da = Math.abs((WARMTH_RANK[a.warmth] || 2) - target);
      var db = Math.abs((WARMTH_RANK[b.warmth] || 2) - target);
      return da - db;
    })[0];
  }

  // Pick the best item of a category for the required warmth/tags.
  // Returns { item, ideal, note } or null when the wardrobe has nothing of the type.
  function pickItem(pool, type, opts) {
    opts = opts || {};
    var candidates = pool.filter(function (i) { return i.type === type; });
    if (!candidates.length) return null;

    var reasons = [];
    var working = candidates;

    // Hard-ish tag requirements: try to satisfy, but relax (with a flag) if impossible.
    if (opts.requireWindproof) {
      var wind = working.filter(function (i) { return i.windproof; });
      if (wind.length) working = wind; else reasons.push("no windproof " + type);
    }
    if (opts.requireWaterproof) {
      var water = working.filter(function (i) { return i.waterproof; });
      if (water.length) working = water; else reasons.push("no waterproof " + type);
    }

    var exactWarmth = opts.warmth
      ? working.filter(function (i) { return i.warmth === opts.warmth; })
      : working;

    var ideal = true;
    var chosen;
    if (opts.warmth && exactWarmth.length) {
      chosen = leastDismissed(exactWarmth, opts.dismissals);
    } else if (opts.warmth) {
      chosen = closestByWarmth(working, opts.warmth);
      ideal = false;
      reasons.push("no ideal " + opts.warmth + " " + type);
    } else {
      chosen = leastDismissed(working, opts.dismissals);
    }

    return { item: chosen, ideal: ideal && reasons.length === 0, note: reasons.join("; ") };
  }

  // Lightly prefer items the user dismisses less often (stretch-goal seed, no ML).
  function leastDismissed(items, dismissals) {
    dismissals = dismissals || {};
    return items.slice().sort(function (a, b) {
      return (dismissals[a.id] || 0) - (dismissals[b.id] || 0);
    })[0];
  }

  function looksLikeSunProtection(item) {
    var n = (item.name || "").toLowerCase();
    return /sun|shade|hat|cap|glass/.test(n);
  }

  /**
   * Core recommendation.
   * @param weather  { feelsLike, temp, windKmh, precipProb, uvIndex, code }
   * @param wardrobe array of items { id, name, type, warmth, waterproof, windproof, active }
   * @param prefs    { commuteMode, dismissals?, excludeIds? }
   * @returns { tier, baseLabel, picks:[{category,item,ideal,note}], flags:[] }
   */
  function recommendOutfit(weather, wardrobe, prefs) {
    prefs = prefs || {};
    var w = weather || {};
    var flags = [];
    var walking = prefs.commuteMode === "walking";
    var mixed = prefs.commuteMode === "mixed";

    var base = baseTier(typeof w.feelsLike === "number" ? w.feelsLike : (w.temp || 15));

    // Modifier thresholds — tightened for people on foot, relaxed a bit for drivers.
    var windThreshold = walking ? 20 : (mixed ? 25 : 30);
    var rainThreshold = walking ? 30 : (mixed ? 40 : 45);

    var windy = (w.windKmh || 0) > windThreshold;
    var rainy = (w.precipProb || 0) > rainThreshold;
    var uvHigh = (w.uvIndex || 0) > 6;

    var excluded = {};
    (prefs.excludeIds || []).forEach(function (id) { excluded[id] = true; });
    var pool = wardrobe.filter(function (i) { return i.active && !excluded[i.id]; });

    var dismissals = prefs.dismissals || {};
    var picks = [];

    // Top
    var top = pickItem(pool, "top", { warmth: base.top, dismissals: dismissals });
    if (top) picks.push(withCat("top", top));

    // Bottom
    var bottom = pickItem(pool, "bottom", { warmth: base.bottom, dismissals: dismissals });
    if (bottom) picks.push(withCat("bottom", bottom));

    // Outer (only when the tier calls for one, or wind/rain make it advisable)
    if (base.outer || windy || rainy) {
      var outer = pickItem(pool, "outer", {
        warmth: base.outer || "light",
        requireWindproof: windy,
        requireWaterproof: rainy,
        dismissals: dismissals
      });
      if (outer) picks.push(withCat("outer", outer));
    }

    // Shoes — prefer waterproof when it's likely to rain.
    var shoes = pickItem(pool, "shoes", { requireWaterproof: rainy, dismissals: dismissals });
    if (shoes) picks.push(withCat("shoes", shoes));

    // Accessory — for freezing tiers and for strong sun.
    if (base.accessories || uvHigh) {
      var accPool = pool.filter(function (i) { return i.type === "accessory"; });
      if (uvHigh && accPool.some(looksLikeSunProtection)) {
        accPool = accPool.filter(looksLikeSunProtection);
      }
      var acc = accPool.length ? { item: leastDismissed(accPool, dismissals), ideal: true, note: "" } : null;
      if (acc) picks.push(withCat("accessory", acc));
    }

    // --- Flags (user-facing advisories) -------------------------------------
    if (rainy) {
      var haveWaterproof = pool.some(function (i) { return i.waterproof; });
      flags.push(haveWaterproof
        ? "Rain likely (" + Math.round(w.precipProb) + "%) — waterproof picked."
        : "Rain likely (" + Math.round(w.precipProb) + "%) — no waterproof item, bring an umbrella.");
    }
    if (windy) flags.push("Windy (" + Math.round(w.windKmh) + " km/h) — windproof layer preferred.");
    if (uvHigh) {
      var haveSun = pool.some(function (i) { return i.type === "accessory" && looksLikeSunProtection(i); });
      flags.push(haveSun ? "High UV (" + Math.round(w.uvIndex) + ") — sun protection picked."
                         : "High UV (" + Math.round(w.uvIndex) + ") — bring sunglasses/hat.");
    }
    picks.forEach(function (p) {
      if (p.note) flags.push("No ideal match for " + p.category + " (" + p.note + ").");
    });
    // Missing whole categories
    ["top", "bottom", "shoes"].forEach(function (cat) {
      if (!picks.some(function (p) { return p.category === cat; })) {
        flags.push("No " + cat + " in your wardrobe — add one.");
      }
    });

    return { tier: base.tier, baseLabel: base.label, picks: picks, flags: flags };
  }

  function withCat(category, res) {
    return { category: category, item: res.item, ideal: res.ideal, note: res.note };
  }

  // WMO weather-code → { label, icon }. Small, human-readable subset.
  function describeWeatherCode(code) {
    var map = {
      0: ["Clear sky", "☀️"], 1: ["Mainly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁️"],
      45: ["Fog", "🌫️"], 48: ["Rime fog", "🌫️"],
      51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌧️"],
      56: ["Freezing drizzle", "🌧️"], 57: ["Freezing drizzle", "🌧️"],
      61: ["Light rain", "🌦️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
      66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"],
      71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"], 77: ["Snow grains", "🌨️"],
      80: ["Rain showers", "🌦️"], 81: ["Rain showers", "🌧️"], 82: ["Violent showers", "⛈️"],
      85: ["Snow showers", "🌨️"], 86: ["Snow showers", "❄️"],
      95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm + hail", "⛈️"], 99: ["Thunderstorm + hail", "⛈️"]
    };
    return map[code] || ["—", "🌡️"];
  }

  return {
    recommendOutfit: recommendOutfit,
    baseTier: baseTier,
    describeWeatherCode: describeWeatherCode,
    WARMTH_RANK: WARMTH_RANK
  };
});
