/*
 * What to Wear — app shell: storage, screens, CRUD, weather wiring, notifications.
 * Depends on WTW (recommend.js) and WTWeather (weather.js).
 */
(function () {
  "use strict";

  var LS_PREFS = "wtw.prefs.v1";
  var LS_WARDROBE = "wtw.wardrobe.v1";

  // ---- State ---------------------------------------------------------------
  var prefs = load(LS_PREFS, null);
  var wardrobe = load(LS_WARDROBE, []);
  var lastWeather = null;
  var skipToday = {};          // item ids swapped out via "Not today" this session
  var editingId = null;        // wardrobe item currently being edited
  var pendingLocation = null;  // location chosen during onboarding before save

  var STARTER = [
    { name: "T-shirt",           type: "top",       warmth: "light",  waterproof: false, windproof: false },
    { name: "Long-sleeve shirt", type: "top",       warmth: "medium", waterproof: false, windproof: false },
    { name: "Wool sweater",      type: "top",       warmth: "heavy",  waterproof: false, windproof: false },
    { name: "Jeans",             type: "bottom",    warmth: "medium", waterproof: false, windproof: false },
    { name: "Shorts",            type: "bottom",    warmth: "light",  waterproof: false, windproof: false },
    { name: "Light jacket",      type: "outer",     warmth: "light",  waterproof: false, windproof: true  },
    { name: "Rain jacket",       type: "outer",     warmth: "medium", waterproof: true,  windproof: true  },
    { name: "Winter coat",       type: "outer",     warmth: "heavy",  waterproof: true,  windproof: true  },
    { name: "Sneakers",          type: "shoes",     warmth: "medium", waterproof: false, windproof: false },
    { name: "Waterproof boots",  type: "shoes",     warmth: "medium", waterproof: true,  windproof: false },
    { name: "Sunglasses",        type: "accessory", warmth: "light",  waterproof: false, windproof: false },
    { name: "Wool scarf & hat",  type: "accessory", warmth: "heavy",  waterproof: false, windproof: true  }
  ];

  // ---- Storage helpers -----------------------------------------------------
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save() {
    localStorage.setItem(LS_PREFS, JSON.stringify(prefs));
    localStorage.setItem(LS_WARDROBE, JSON.stringify(wardrobe));
  }
  function uid() { return "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function defaultPrefs() {
    return {
      location: null,
      commuteMode: "walking",
      notificationTime: "07:00",
      tempUnit: "celsius",
      dismissedSuggestions: []  // running log of skipped item ids (stretch: weighting)
    };
  }

  // Turn the dismissed log into a { id: count } map for the engine.
  function dismissalCounts() {
    var m = {};
    (prefs.dismissedSuggestions || []).forEach(function (id) { m[id] = (m[id] || 0) + 1; });
    return m;
  }

  // ==========================================================================
  //  Wardrobe item form (shared by onboarding + wardrobe tab)
  // ==========================================================================
  function itemFormHtml(prefix) {
    return '' +
      '<div class="row">' +
      '  <div class="grow"><label>Name</label><input id="' + prefix + 'Name" placeholder="e.g. Grey wool jacket" autocomplete="off"></div>' +
      '</div>' +
      '<div class="row" style="margin-top:10px">' +
      '  <div class="grow"><label>Type</label><select id="' + prefix + 'Type">' +
      '    <option value="top">Top</option><option value="bottom">Bottom</option>' +
      '    <option value="outer">Outer</option><option value="shoes">Shoes</option>' +
      '    <option value="accessory">Accessory</option></select></div>' +
      '  <div class="grow"><label>Warmth</label><select id="' + prefix + 'Warmth">' +
      '    <option value="light">Light</option><option value="medium" selected>Medium</option>' +
      '    <option value="heavy">Heavy</option></select></div>' +
      '</div>' +
      '<div class="row" style="margin-top:12px">' +
      '  <label class="toggle"><input type="checkbox" id="' + prefix + 'Water"> Waterproof</label>' +
      '  <label class="toggle"><input type="checkbox" id="' + prefix + 'Wind"> Windproof</label>' +
      '</div>' +
      '<div class="row" style="margin-top:12px">' +
      '  <button class="btn" id="' + prefix + 'Save">Add item</button>' +
      '  <button class="btn ghost hidden" id="' + prefix + 'Cancel">Cancel</button>' +
      '</div>';
  }

  function readItemForm(prefix) {
    var name = $(prefix + "Name").value.trim();
    if (!name) { alert("Please give the item a name."); return null; }
    return {
      name: name,
      type: $(prefix + "Type").value,
      warmth: $(prefix + "Warmth").value,
      waterproof: $(prefix + "Water").checked,
      windproof: $(prefix + "Wind").checked
    };
  }
  function clearItemForm(prefix) {
    $(prefix + "Name").value = "";
    $(prefix + "Type").value = "top";
    $(prefix + "Warmth").value = "medium";
    $(prefix + "Water").checked = false;
    $(prefix + "Wind").checked = false;
  }

  // ==========================================================================
  //  Onboarding
  // ==========================================================================
  function initOnboarding() {
    $("obAddForm").innerHTML = itemFormHtml("ob");

    $("obGps").onclick = function () { useGps(setObLocation); };
    $("obCityBtn").onclick = function () { findCity($("obCity").value, setObLocation); };
    $("obCity").addEventListener("keydown", function (e) { if (e.key === "Enter") $("obCityBtn").click(); });

    $("obSeed").onclick = function () {
      STARTER.forEach(function (s) { wardrobe.push(Object.assign({ id: uid(), active: true }, s)); });
      renderObList();
    };

    $("obSave").onclick = function () {
      var data = readItemForm("ob");
      if (!data) return;
      wardrobe.push(Object.assign({ id: uid(), active: true }, data));
      clearItemForm("ob");
      renderObList();
    };

    $("obFinish").onclick = finishOnboarding;
    renderObList();
    updateObFinishHint();
  }

  function setObLocation(loc) {
    pendingLocation = loc;
    $("obLocResult").textContent = "📍 " + loc.name;
    updateObFinishHint();
  }

  function renderObList() {
    var list = $("obList");
    list.innerHTML = "";
    if (!wardrobe.length) { list.appendChild(el("p", "muted", "No items yet.")); updateObFinishHint(); return; }
    wardrobe.forEach(function (it) {
      var row = el("div", "item");
      row.appendChild(el("div", "meta", '<div class="t">' + esc(it.name) + '</div><div class="muted">' +
        it.type + " · " + it.warmth + tagsText(it) + "</div>"));
      var del = el("button", "btn small danger", "✕");
      del.onclick = function () { wardrobe = wardrobe.filter(function (x) { return x.id !== it.id; }); renderObList(); };
      var act = el("div", "actions"); act.appendChild(del); row.appendChild(act);
      list.appendChild(row);
    });
    updateObFinishHint();
  }

  function updateObFinishHint() {
    var need = [];
    if (!pendingLocation && !(prefs && prefs.location)) need.push("a location");
    if (wardrobe.length < 3) need.push("at least 3 items");
    $("obFinishHint").textContent = need.length ? "Still need: " + need.join(" and ") + "." : "";
  }

  function finishOnboarding() {
    if (!pendingLocation && !(prefs && prefs.location)) { alert("Please set a location first."); return; }
    if (wardrobe.length < 3) { alert("Add at least 3 clothing items."); return; }
    prefs = prefs || defaultPrefs();
    prefs.location = pendingLocation || prefs.location;
    prefs.commuteMode = $("obCommute").value;
    save();
    $("onboarding").classList.remove("show");
    startApp();
  }

  // ==========================================================================
  //  Location helpers
  // ==========================================================================
  function useGps(cb) {
    if (!navigator.geolocation) { alert("Geolocation not available on this device."); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      cb({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: "My location" });
    }, function () {
      alert("Couldn't get GPS location. Enter a city instead.");
    }, { timeout: 10000 });
  }
  function findCity(query, cb) {
    query = (query || "").trim();
    if (!query) { alert("Type a city name."); return; }
    WTWeather.geocode(query).then(cb).catch(function (e) { alert(e.message); });
  }

  // ==========================================================================
  //  Today screen
  // ==========================================================================
  function tempStr(c) {
    if (c == null) return "—";
    return Math.round(c) + "°" + (prefs.tempUnit === "fahrenheit" ? "F" : "C");
  }

  function refreshToday() {
    if (!prefs || !prefs.location) return;
    var loc = prefs.location;
    $("weatherCard").innerHTML = '<div class="muted">Loading weather for ' + esc(loc.name) + '…</div>';
    WTWeather.getWeather(loc.lat, loc.lon, prefs.tempUnit)
      .then(function (wx) { lastWeather = wx; renderWeather(wx); renderRecommendation(); })
      .catch(function (e) {
        $("weatherCard").innerHTML = '<div class="flag">Could not load weather: ' + esc(e.message) +
          '<br><span class="muted">Check your connection and tap Refresh.</span></div>';
      });
  }

  function renderWeather(wx) {
    var d = WTW.describeWeatherCode(wx.code);
    var feels = wx.unit === "fahrenheit" ? wx.feelsLikeDisplay : wx.feelsLike;
    $("weatherCard").innerHTML =
      '<div class="wx">' +
      '  <div class="ico">' + d[1] + '</div>' +
      '  <div><div class="big">' + tempStr(wx.temp) + '</div><div class="cond">' + esc(d[0]) + '</div></div>' +
      '</div>' +
      '<div class="wxstats">' +
      '  <span>Feels like<b>' + tempStr(feels) + '</b></span>' +
      '  <span>Wind<b>' + Math.round(wx.windKmh) + ' km/h</b></span>' +
      '  <span>Rain<b>' + Math.round(wx.precipProb) + '%</b></span>' +
      '  <span>UV<b>' + Math.round(wx.uvIndex) + '</b></span>' +
      '</div>';
  }

  function renderRecommendation() {
    var area = $("recArea");
    var flagArea = $("flagArea");
    area.innerHTML = "";
    flagArea.innerHTML = "";
    if (!lastWeather) return;

    var excludeIds = Object.keys(skipToday).filter(function (id) { return skipToday[id]; });
    var rec = WTW.recommendOutfit(lastWeather, wardrobe, {
      commuteMode: prefs.commuteMode,
      dismissals: dismissalCounts(),
      excludeIds: excludeIds
    });

    var head = el("div", "card");
    head.appendChild(el("h2", null, "Today: " + esc(rec.baseLabel)));
    if (!rec.picks.length) {
      head.appendChild(el("p", "muted", "No wardrobe items to suggest. Add clothes in the Wardrobe tab."));
    }
    rec.picks.forEach(function (p) {
      var row = el("div", "pick");
      row.appendChild(el("div", "cat", p.category));
      var nm = el("div", "name", esc(p.item.name) + tagsText(p.item) + (p.ideal ? "" : ' <span class="sub">closest match</span>'));
      row.appendChild(nm);
      var swap = el("button", "btn small ghost", "Not today");
      swap.onclick = function () { skipItem(p.item.id); };
      row.appendChild(swap);
      head.appendChild(row);
    });
    if (Object.keys(skipToday).length) {
      var reset = el("button", "btn small ghost", "↺ Restore skipped");
      reset.onclick = function () { skipToday = {}; renderRecommendation(); };
      head.appendChild(reset);
    }
    area.appendChild(head);

    rec.flags.forEach(function (f) { flagArea.appendChild(el("div", "flag", esc(f))); });
  }

  function skipItem(id) {
    skipToday[id] = true;
    prefs.dismissedSuggestions.push(id);   // persistent log for lightweight future weighting
    if (prefs.dismissedSuggestions.length > 500) prefs.dismissedSuggestions.splice(0, 250);
    save();
    renderRecommendation();
  }

  function tagsText(it) {
    var t = "";
    if (it.waterproof) t += '<span class="tag">💧 waterproof</span>';
    if (it.windproof) t += '<span class="tag">💨 windproof</span>';
    return t;
  }

  // ==========================================================================
  //  Wardrobe tab
  // ==========================================================================
  function initWardrobeTab() {
    $("wAddForm").innerHTML = itemFormHtml("w");
    $("wSave").onclick = onWardrobeSave;
    $("wCancel").onclick = cancelEdit;
  }

  function onWardrobeSave() {
    var data = readItemForm("w");
    if (!data) return;
    if (editingId) {
      var it = wardrobe.find(function (x) { return x.id === editingId; });
      if (it) Object.assign(it, data);
      cancelEdit();
    } else {
      wardrobe.push(Object.assign({ id: uid(), active: true }, data));
    }
    clearItemForm("w");
    save();
    renderWardrobe();
    renderRecommendation();
  }

  function startEdit(it) {
    editingId = it.id;
    $("wName").value = it.name;
    $("wType").value = it.type;
    $("wWarmth").value = it.warmth;
    $("wWater").checked = it.waterproof;
    $("wWind").checked = it.windproof;
    $("wSave").textContent = "Save changes";
    $("wCancel").classList.remove("hidden");
    $("wFormTitle").textContent = "Edit item";
    switchTab("wardrobe");
    window.scrollTo(0, 0);
  }
  function cancelEdit() {
    editingId = null;
    clearItemForm("w");
    $("wSave").textContent = "Add item";
    $("wCancel").classList.add("hidden");
    $("wFormTitle").textContent = "Add an item";
  }

  function renderWardrobe() {
    var list = $("wardrobeList");
    list.innerHTML = "";
    $("wCount").textContent = wardrobe.length;
    if (!wardrobe.length) { list.appendChild(el("p", "muted", "No items yet — add your first above.")); return; }

    var order = { top: 0, bottom: 1, outer: 2, shoes: 3, accessory: 4 };
    wardrobe.slice().sort(function (a, b) { return (order[a.type] - order[b.type]) || a.name.localeCompare(b.name); })
      .forEach(function (it) {
        var row = el("div", "item" + (it.active ? "" : " inactive"));
        row.appendChild(el("div", "meta", '<div class="t">' + esc(it.name) + '</div><div class="muted">' +
          it.type + " · " + it.warmth + tagsText(it) + (it.active ? "" : " · (in laundry)") + "</div>"));

        var actions = el("div", "actions");
        var toggle = el("button", "btn small ghost", it.active ? "🧺" : "↩");
        toggle.title = it.active ? "Mark unavailable (laundry)" : "Mark available";
        toggle.onclick = function () { it.active = !it.active; save(); renderWardrobe(); renderRecommendation(); };
        var edit = el("button", "btn small ghost", "✎");
        edit.onclick = function () { startEdit(it); };
        var del = el("button", "btn small danger", "✕");
        del.onclick = function () {
          if (!confirm("Delete \"" + it.name + "\"?")) return;
          wardrobe = wardrobe.filter(function (x) { return x.id !== it.id; });
          save(); renderWardrobe(); renderRecommendation();
        };
        actions.appendChild(toggle); actions.appendChild(edit); actions.appendChild(del);
        row.appendChild(actions);
        list.appendChild(row);
      });
  }

  // ==========================================================================
  //  Settings tab
  // ==========================================================================
  function initSettingsTab() {
    $("setCityBtn").onclick = function () {
      findCity($("setCity").value, function (loc) {
        prefs.location = loc; save(); syncSettings(); refreshToday(); $("setCity").value = "";
      });
    };
    $("setCity").addEventListener("keydown", function (e) { if (e.key === "Enter") $("setCityBtn").click(); });
    $("setGpsBtn").onclick = function () {
      useGps(function (loc) { prefs.location = loc; save(); syncSettings(); refreshToday(); });
    };
    $("setCommute").onchange = function () { prefs.commuteMode = this.value; save(); renderRecommendation(); };
    $("setUnit").onchange = function () { prefs.tempUnit = this.value; save(); refreshToday(); };
    $("setNotifTime").onchange = function () { prefs.notificationTime = this.value; save(); scheduleDailyNotification(); };
    $("setNotifEnable").onclick = enableNotifications;
    $("setNotifTest").onclick = function () { showOutfitNotification(true); };
    $("resetBtn").onclick = function () {
      if (!confirm("Erase all data and restart setup?")) return;
      localStorage.removeItem(LS_PREFS);
      localStorage.removeItem(LS_WARDROBE);
      location.reload();
    };
  }

  function syncSettings() {
    $("setLocName").textContent = prefs.location ? prefs.location.name : "—";
    $("setCommute").value = prefs.commuteMode;
    $("setUnit").value = prefs.tempUnit;
    $("setNotifTime").value = prefs.notificationTime;
    $("hdrLoc").textContent = prefs.location ? prefs.location.name : "—";
    updateNotifStatus();
  }

  // ==========================================================================
  //  Notifications (best-effort while app runs; Capacitor LocalNotifications
  //  is the reliable background path once wrapped — see README).
  // ==========================================================================
  var notifTimer = null;

  function updateNotifStatus() {
    var s = $("notifStatus");
    if (!("Notification" in window)) { s.textContent = "Notifications not supported on this device."; return; }
    if (Notification.permission === "granted") s.textContent = "✅ Enabled — daily reminder at " + prefs.notificationTime + ".";
    else if (Notification.permission === "denied") s.textContent = "⛔ Blocked in browser/app settings.";
    else s.textContent = "Tap “Enable notifications” to get a daily reminder.";
  }

  function enableNotifications() {
    if (!("Notification" in window)) { alert("Notifications aren't supported here."); return; }
    Notification.requestPermission().then(function () { updateNotifStatus(); scheduleDailyNotification(); });
  }

  function scheduleDailyNotification() {
    if (notifTimer) clearTimeout(notifTimer);
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    var parts = (prefs.notificationTime || "07:00").split(":");
    var now = new Date();
    var next = new Date();
    next.setHours(+parts[0] || 7, +parts[1] || 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    notifTimer = setTimeout(function () {
      showOutfitNotification(false);
      scheduleDailyNotification();  // reschedule for the following day
    }, next - now);
  }

  // Fetch fresh weather, compute the outfit, and show it in the notification body.
  function showOutfitNotification(isTest) {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      if (isTest) alert("Enable notifications first.");
      return;
    }
    if (!prefs.location) return;
    WTWeather.getWeather(prefs.location.lat, prefs.location.lon, prefs.tempUnit).then(function (wx) {
      var rec = WTW.recommendOutfit(wx, wardrobe, { commuteMode: prefs.commuteMode, dismissals: dismissalCounts() });
      var items = rec.picks.map(function (p) { return p.item.name; }).join(", ");
      var d = WTW.describeWeatherCode(wx.code);
      var body = tempStr(wx.temp) + " " + d[0] + (items ? " — " + items : "");
      if (rec.flags.length) body += "\n" + rec.flags[0];
      new Notification("What to Wear" + (isTest ? " (test)" : ""), { body: body, tag: "wtw-daily" });
    }).catch(function () {
      new Notification("What to Wear", { body: "Open the app to see today's outfit." });
    });
  }

  // ==========================================================================
  //  Tabs + boot
  // ==========================================================================
  function switchTab(name) {
    document.querySelectorAll("nav button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === name);
    });
    document.querySelectorAll("section.tab").forEach(function (s) {
      s.classList.toggle("active", s.id === "tab-" + name);
    });
  }

  function initTabs() {
    document.querySelectorAll("nav button").forEach(function (b) {
      b.onclick = function () { switchTab(b.dataset.tab); };
    });
  }

  function startApp() {
    syncSettings();
    renderWardrobe();
    refreshToday();
    scheduleDailyNotification();
    // Re-fetch when the app returns to the foreground (weather goes stale).
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refreshToday();
    });
  }

  function boot() {
    initTabs();
    initWardrobeTab();
    initSettingsTab();
    $("refreshBtn").onclick = refreshToday;

    if (!prefs || !prefs.location) {
      prefs = prefs || defaultPrefs();
      initOnboarding();
      $("onboarding").classList.add("show");
    } else {
      startApp();
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
