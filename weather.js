/*
 * What to Wear — weather + geocoding via Open-Meteo (free, no API key).
 * Exposes window.WTWeather. Network-facing but returns plain data objects.
 */
(function (root) {
  "use strict";

  var FORECAST = "https://api.open-meteo.com/v1/forecast";
  var GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";

  // Fetch today's morning-relevant weather for a coordinate.
  // Returns { temp, feelsLike, windKmh, precipProb, uvIndex, code, tempMin, tempMax, unit }
  async function getWeather(lat, lon, unit) {
    var tempUnit = unit === "fahrenheit" ? "fahrenheit" : "celsius";
    var url = FORECAST +
      "?latitude=" + encodeURIComponent(lat) +
      "&longitude=" + encodeURIComponent(lon) +
      "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation" +
      "&daily=precipitation_probability_max,uv_index_max,temperature_2m_max,temperature_2m_min" +
      "&wind_speed_unit=kmh&timezone=auto&forecast_days=1" +
      "&temperature_unit=" + tempUnit;

    var res = await fetch(url);
    if (!res.ok) throw new Error("Weather request failed (" + res.status + ")");
    var d = await res.json();
    var cur = d.current || {};
    var daily = d.daily || {};

    // The engine reasons in °C. If the user picked °F, convert feels-like for the rules
    // but keep display values in their chosen unit.
    var feelsDisplay = num(cur.apparent_temperature);
    var feelsC = tempUnit === "fahrenheit" ? fToC(feelsDisplay) : feelsDisplay;

    return {
      unit: tempUnit,
      temp: num(cur.temperature_2m),
      feelsLikeDisplay: feelsDisplay,
      feelsLike: feelsC,               // always °C, for the rule engine
      windKmh: num(cur.wind_speed_10m),
      precipProb: firstNum(daily.precipitation_probability_max),
      uvIndex: firstNum(daily.uv_index_max),
      code: num(cur.weather_code),
      tempMax: firstNum(daily.temperature_2m_max),
      tempMin: firstNum(daily.temperature_2m_min)
    };
  }

  // City name → { name, lat, lon }. Throws if nothing found.
  async function geocode(query) {
    var url = GEOCODE + "?name=" + encodeURIComponent(query) + "&count=1&language=en&format=json";
    var res = await fetch(url);
    if (!res.ok) throw new Error("Geocoding failed (" + res.status + ")");
    var d = await res.json();
    if (!d.results || !d.results.length) throw new Error("No place found for \"" + query + "\"");
    var r = d.results[0];
    var label = r.name + (r.admin1 ? ", " + r.admin1 : "") + (r.country ? ", " + r.country : "");
    return { name: label, lat: r.latitude, lon: r.longitude };
  }

  function num(v) { return typeof v === "number" ? v : (v == null ? 0 : Number(v) || 0); }
  function firstNum(arr) { return Array.isArray(arr) && arr.length ? num(arr[0]) : 0; }
  function fToC(f) { return (f - 32) * 5 / 9; }

  root.WTWeather = { getWeather: getWeather, geocode: geocode };
})(typeof self !== "undefined" ? self : this);
