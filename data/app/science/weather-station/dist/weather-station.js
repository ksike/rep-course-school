/**
 * Estación meteorológica — the reference Open Coach **tool**.
 *
 * The falling-blocks game shows what an app does with sessions and scores. This one shows the three
 * things a tool needs instead, and it is deliberately small so each is easy to find:
 *
 * - **Settings.** The reader's town comes from `init.config.city`, the units from the channel's own
 *   setting. Neither is in this file, because neither is the author's to decide.
 * - **An external service.** `coach.request("forecast", …)` names a call the manifest declared. There
 *   is no URL here and there cannot be: the app never reaches the network, Open Coach does.
 * - **A secret it never sees.** If the provider needs a key, it is written `{{secret:API_KEY}}` in the
 *   manifest and substituted server-side. Nothing in this file could read it, which is the point.
 *
 * It reports no score. A tool that invented one would land in a ranking and mean nothing there.
 */

(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var MAX_ENTRIES = 60;

  var coach = null;
  var settings = {};
  var place = null;
  var log = [];

  var TEXT = {
    es: {
      humidity: "Humedad", wind: "Viento", max: "Máxima", min: "Mínima", refresh: "Actualizar",
      note: "Apuntar hoy", log: "Tus apuntes", empty: "Todavía no has apuntado ninguna temperatura.",
      noCity: "Falta indicar tu localidad en los ajustes de la app.",
      notFound: "No he encontrado esa localidad. Revisa cómo está escrita en los ajustes.",
      failed: "No he podido consultar el tiempo ahora mismo.",
      noted: "Apuntado.", loading: "Consultando…",
    },
    en: {
      humidity: "Humidity", wind: "Wind", max: "High", min: "Low", refresh: "Refresh",
      note: "Note today", log: "Your notes", empty: "You have not noted a temperature yet.",
      noCity: "Your town is not set in the app's settings yet.",
      notFound: "I could not find that town. Check how it is spelled in the settings.",
      failed: "I could not look up the weather just now.",
      noted: "Noted.", loading: "Looking up…",
    },
  };
  var t = TEXT.es;

  function say(text, kind) {
    var element = document.getElementById("message");
    element.textContent = text || "";
    if (kind) element.setAttribute("data-kind", kind);
    else element.removeAttribute("data-kind");
  }

  function set(id, value) {
    document.getElementById(id).textContent = value;
  }

  /* ─────────────────────────── the external calls ─────────────────────────── */

  /**
   * Two calls, both declared in the manifest: find the town, then ask for its weather.
   *
   * Every answer is parsed defensively. It arrives from a service neither we nor the platform control,
   * and an app that assumed a shape would break on the day that service changed one.
   */
  async function lookup() {
    var city = settings.city;
    if (!city) {
      say(t.noCity, "error");
      return;
    }

    say(t.loading);

    if (!place) {
      var found = await coach.request("geocode", { city: city });
      if (!found.ok) return say(found.error || t.failed, "error");

      var geo = parse(found.body);
      var first = geo && geo.results && geo.results[0];
      if (!first) return say(t.notFound, "error");

      place = { lat: String(first.latitude), lon: String(first.longitude), name: first.name, country: first.country };
      set("place", place.name + (place.country ? ", " + place.country : ""));
    }

    var answer = await coach.request("forecast", {
      lat: place.lat,
      lon: place.lon,
      units: settings.units === "fahrenheit" ? "fahrenheit" : "celsius",
    });
    if (!answer.ok) return say(answer.error || t.failed, "error");

    var data = parse(answer.body);
    var now = (data && data.current) || {};
    var daily = (data && data.daily) || {};
    var degree = settings.units === "fahrenheit" ? "°F" : "°C";

    set("temp", now.temperature_2m !== undefined ? Math.round(now.temperature_2m) + degree : "—");
    set("humidity", now.relative_humidity_2m !== undefined ? now.relative_humidity_2m + "%" : "—");
    set("wind", now.wind_speed_10m !== undefined ? Math.round(now.wind_speed_10m) + " km/h" : "—");
    set("max", daily.temperature_2m_max ? Math.round(daily.temperature_2m_max[0]) + degree : "—");
    set("min", daily.temperature_2m_min ? Math.round(daily.temperature_2m_min[0]) + degree : "—");

    say("");
    return now.temperature_2m;
  }

  function parse(body) {
    try {
      return JSON.parse(body);
    } catch (error) {
      return null;
    }
  }

  /* ─────────────────────────── what the reader keeps ─────────────────────────── */

  /** One entry per day, kept in the app's own store so it follows the reader between devices. */
  async function note() {
    var temperature = await lookup();
    if (temperature === undefined) return;

    var today = new Date().toISOString().slice(0, 10);
    log = log.filter(function (entry) {
      return entry.day !== today;
    });
    log.push({ day: today, t: Math.round(temperature * 10) / 10 });
    log = log.slice(-MAX_ENTRIES);

    await coach.data.set("log", log);
    draw();
    say(t.noted);
  }

  /** The log as a line, drawn in SVG so it scales and prints rather than blurring. */
  function draw() {
    var chart = document.getElementById("chart");
    while (chart.firstChild) chart.removeChild(chart.firstChild);
    document.getElementById("log-empty").style.display = log.length ? "none" : "";
    if (log.length === 0) return;

    var values = log.map(function (entry) {
      return entry.t;
    });
    var low = Math.min.apply(null, values);
    var high = Math.max.apply(null, values);
    var span = high - low || 1;

    var points = log.map(function (entry, index) {
      var x = log.length === 1 ? 160 : (index / (log.length - 1)) * 300 + 10;
      var y = 100 - ((entry.t - low) / span) * 80;
      return { x: x, y: y, entry: entry };
    });

    var baseline = document.createElementNS(SVG_NS, "line");
    baseline.setAttribute("x1", "10");
    baseline.setAttribute("x2", "310");
    baseline.setAttribute("y1", "105");
    baseline.setAttribute("y2", "105");
    chart.appendChild(baseline);

    var line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute(
      "points",
      points
        .map(function (point) {
          return point.x + "," + point.y;
        })
        .join(" ")
    );
    chart.appendChild(line);

    points.forEach(function (point) {
      var dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
      dot.setAttribute("r", "2.5");
      var title = document.createElementNS(SVG_NS, "title");
      title.textContent = point.entry.day + ": " + point.entry.t;
      dot.appendChild(title);
      chart.appendChild(dot);
    });

    [points[0], points[points.length - 1]].forEach(function (point, index) {
      if (points.length === 1 && index === 1) return;
      var label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", String(point.x));
      label.setAttribute("y", "116");
      label.setAttribute("text-anchor", index === 0 ? "start" : "end");
      label.textContent = point.entry.day.slice(5);
      chart.appendChild(label);
    });
  }

  /* ─────────────────────────────── start ─────────────────────────────── */

  document.getElementById("refresh").addEventListener("click", function () {
    lookup();
  });
  document.getElementById("note").addEventListener("click", note);

  coach = window.OpenCoach.connect({
    onInit: function (init) {
      t = TEXT[(init.locale || "es").slice(0, 2)] || TEXT.es;
      document.documentElement.lang = (init.locale || "es").slice(0, 2);
      settings = init.config || {};

      var tokens = init.themeTokens || {};
      var map = {
        "--background": "--coach-bg",
        "--foreground": "--coach-fg",
        "--muted-foreground": "--coach-muted",
        "--border": "--coach-border",
        "--primary": "--coach-accent",
      };
      Object.keys(map).forEach(function (name) {
        if (tokens[name]) document.documentElement.style.setProperty(map[name], tokens[name]);
      });

      ["humidity", "wind", "max", "min", "log"].forEach(function (key) {
        var label = document.getElementById("l-" + key);
        if (label) label.textContent = t[key];
      });
      document.getElementById("refresh-text").textContent = t.refresh;
      document.getElementById("note-text").textContent = t.note;
      document.getElementById("log-empty").textContent = t.empty;

      coach.data.get("log").then(function (stored) {
        log = Array.isArray(stored) ? stored : [];
        draw();
      });

      lookup();
    },
  });
})();
