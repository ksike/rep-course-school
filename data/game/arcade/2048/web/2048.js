/**
 * 2048, as an Open Coach app.
 *
 * The rules are the ones everybody knows: slide the board, equal tiles merge, one new tile appears
 * after every move that changed something. What is worth reading here is the rest — the parts a game
 * needs to be a *package* rather than a page:
 *
 * - it talks to the platform through the SDK, so the score, the save and the ranking belong to the
 *   account rather than to this browser;
 * - it speaks whatever language the reader is in, from its own `lang/` files, and lets them choose
 *   another inside the game;
 * - it makes its own sound, synthesised, so the package ships no audio files;
 * - it degrades. An older host, a missing style kit, a save written between two moves: none of them
 *   may leave somebody looking at a dead board.
 *
 * Written to be read alongside `falling-blocks`, which does the same things for a different game.
 */

(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  /** What the manifest calls a pass, so the game and the platform agree on what a good game is. */
  var PASS_SCORE = 8000;
  var GOAL = 2048;

  /**
   * Three ways to play.
   *
   * Bigger board, more room, gentler game — that is the honest lever in 2048, not speed. Hard adds
   * fours to the tiles that appear, which fills the board faster and punishes a wasted move.
   */
  var LEVELS = {
    easy: { size: 5, fourChance: 0 },
    normal: { size: 4, fourChance: 0.1 },
    hard: { size: 4, fourChance: 0.3 },
  };

  var LOCALES = ["es", "en"];
  var LOCALE_NAMES = { es: "Espanol", en: "English" };
  var FALLBACK = "es";

  /* ─────────────────────────────── state ─────────────────────────────── */

  var grid = [];
  var size = 4;
  var score = 0;
  var best = 0;
  var moves = 0;
  var highest = 2;
  var over = false;
  var won = false;
  var paused = false;
  var startedAt = Date.now();
  var history = [];
  var totals = { games: 0, merges: 0, best: 0 };

  var coach = null;
  var t = {};
  var settings = { sound: true, music: true, volume: 0.7, locale: null, difficulty: "normal" };
  var lastSaveAt = 0;
  var lastProgress = -1;

  var boardEl = document.getElementById("board");
  var cells = [];

  function rules() {
    return LEVELS[settings.difficulty] || LEVELS.normal;
  }

  /* ─────────────────────────────── sound ─────────────────────────────── */

  /**
   * Synthesised, never shipped.
   *
   * A package that carries audio files is a package that is mostly audio files, and every one of them
   * is another thing to fetch before the game can be played. Two oscillators and an envelope cover
   * everything this game needs to say.
   */
  var Audio = {
    ctx: null,
    master: null,
    musicGain: null,
    ready: false,

    unlock: function () {
      if (this.ctx) {
        if (this.ctx.state === "suspended") this.ctx.resume().then(markReady, noop);
        return;
      }
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;

      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = settings.volume;
      this.master.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = settings.music ? 0.3 : 0;
      this.musicGain.connect(this.master);

      if (this.ctx.state === "suspended") this.ctx.resume().then(markReady, noop);
      else markReady();
    },

    live: function () {
      return this.ready && this.ctx && this.ctx.state === "running";
    },

    setVolume: function (value) {
      if (!this.master || !this.ctx) return;
      this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
    },

    setMusic: function (on) {
      if (!this.musicGain || !this.ctx) return;
      this.musicGain.gain.setTargetAtTime(on ? 0.3 : 0, this.ctx.currentTime, 0.05);
    },
  };

  function noop() {}

  function markReady() {
    Audio.ready = true;
    if (settings.music && !paused && !over) Music.start();
  }

  /** One note. `at` lets the sequencer place notes ahead of the clock; effects pass nothing. */
  function tone(options) {
    if (!options.music && !settings.sound) return;
    if (!Audio.live()) return;

    var start = options.at || Audio.ctx.currentTime;
    var seconds = (options.ms || 120) / 1000;
    var osc = Audio.ctx.createOscillator();
    var gain = Audio.ctx.createGain();

    osc.type = options.type || "sine";
    osc.frequency.setValueAtTime(options.hz, start);
    if (options.to) osc.frequency.exponentialRampToValueAtTime(options.to, start + seconds);

    // Ramped down rather than cut: the cut is the click everybody hears and nobody can place.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(options.volume || 0.2, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);

    osc.connect(gain);
    gain.connect(options.music ? Audio.musicGain : Audio.master);
    osc.start(start);
    osc.stop(start + seconds + 0.02);
  }

  var SOUND = {
    move: function () {
      tone({ hz: 220, ms: 70, type: "triangle", volume: 0.09 });
    },

    /** Merging climbs with the tile: joining two 512s should not sound like joining two 2s. */
    merge: function (value) {
      var steps = Math.min(10, Math.round(Math.log(value) / Math.log(2)));
      tone({ hz: 180 * Math.pow(1.14, steps), ms: 140, type: "sine", volume: 0.18, to: 260 * Math.pow(1.14, steps) });
    },

    blocked: function () {
      tone({ hz: 130, ms: 90, type: "square", volume: 0.06 });
    },

    level: function () {
      var now = Audio.live() ? Audio.ctx.currentTime : 0;
      tone({ hz: 660, ms: 130, type: "sine", volume: 0.18, to: 990 });
      tone({ hz: 990, ms: 200, type: "triangle", volume: 0.14, at: now + 0.12 });
    },

    /** Winning: a major arpeggio climbing, then the octave over it. */
    win: function () {
      var now = Audio.live() ? Audio.ctx.currentTime : 0;
      [523, 659, 784, 1047].forEach(function (note, index) {
        tone({ hz: note, ms: 180, type: "sine", volume: 0.2, at: now + index * 0.1 });
      });
      tone({ hz: 1047, ms: 520, type: "triangle", volume: 0.17, at: now + 0.42 });
      tone({ hz: 1568, ms: 520, type: "sine", volume: 0.12, at: now + 0.46 });
    },

    /** Losing: four notes walking down, the last one flat and held. A different ending needs to sound like one. */
    lose: function () {
      var now = Audio.live() ? Audio.ctx.currentTime : 0;
      [392, 330, 262, 175].forEach(function (note, index) {
        tone({
          hz: note,
          ms: index === 3 ? 620 : 240,
          type: "triangle",
          volume: 0.2,
          at: now + index * 0.15,
          to: index === 3 ? note * 0.85 : undefined,
        });
      });
    },
  };

  /** A loop, kept a quarter of a second ahead of the clock so the timer's jitter is never heard. */
  var Music = {
    timer: null,
    next: 0,
    step: 0,

    melody: [
      [0, 1], [4, 0.5], [7, 0.5], [4, 1], [0, 0.5], [4, 0.5],
      [5, 1], [9, 0.5], [5, 0.5], [2, 1], [null, 1],
      [-3, 1], [2, 0.5], [5, 0.5], [7, 1], [4, 0.5], [0, 0.5],
    ],

    hz: function (semitone) {
      return 220 * Math.pow(2, semitone / 12);
    },

    start: function () {
      if (this.timer || !Audio.live()) return;
      this.next = Audio.ctx.currentTime + 0.1;
      this.step = 0;
      this.timer = setInterval(this.fill.bind(this), 120);
    },

    stop: function () {
      clearInterval(this.timer);
      this.timer = null;
    },

    fill: function () {
      if (!Audio.live() || !settings.music) return;
      var beat = 0.36;

      while (this.next < Audio.ctx.currentTime + 0.25) {
        var note = this.melody[this.step % this.melody.length];
        var length = note[1] * beat;

        if (note[0] !== null) {
          tone({ hz: this.hz(note[0]), ms: length * 900, type: "sine", volume: 0.1, at: this.next, music: true });
          tone({ hz: this.hz(note[0] - 12), ms: length * 900, type: "triangle", volume: 0.06, at: this.next, music: true });
        }

        this.next += length;
        this.step++;
      }
    },
  };

  /* ─────────────────────────────── the board ─────────────────────────────── */

  function build() {
    size = rules().size;
    boardEl.style.gridTemplateColumns = "repeat(" + size + ", 1fr)";
    boardEl.innerHTML = "";
    cells = [];
    for (var i = 0; i < size * size; i++) {
      var cell = document.createElement("div");
      cell.className = "cell";
      boardEl.appendChild(cell);
      cells.push(cell);
    }
  }

  function empty() {
    var out = [];
    for (var y = 0; y < size; y++) {
      var row = [];
      for (var x = 0; x < size; x++) row.push(0);
      out.push(row);
    }
    return out;
  }

  /** A tile in a free square: a four only when the difficulty says fours happen. */
  function spawn(mark) {
    var free = [];
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!grid[y][x]) free.push([x, y]);
    if (!free.length) return null;

    var spot = free[Math.floor(Math.random() * free.length)];
    grid[spot[1]][spot[0]] = Math.random() < rules().fourChance ? 4 : 2;
    if (mark) mark.push(spot[1] * size + spot[0]);
    return spot;
  }

  /**
   * The class a value is drawn with.
   *
   * Named rather than computed so the palette lives in the stylesheet, where a designer can read it,
   * and so a tile nobody has ever reached still has a colour instead of turning invisible.
   */
  function classOf(value) {
    return value >= 4096 ? "vbig" : "v" + value;
  }

  function draw(fresh, merged) {
    fresh = fresh || [];
    merged = merged || [];
    var fontFor = size === 5 ? 1.5 : 1.9;

    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var index = y * size + x;
        var cell = cells[index];
        var value = grid[y][x];

        cell.className = "cell" + (value ? " " + classOf(value) : "");
        cell.textContent = value ? String(value) : "";
        cell.style.fontSize = value >= 1024 ? fontFor * 0.62 + "rem" : value >= 128 ? fontFor * 0.78 + "rem" : fontFor + "rem";

        if (value && fresh.indexOf(index) >= 0) cell.classList.add("new");
        if (value && merged.indexOf(index) >= 0) cell.classList.add("merged");
      }
    }
  }

  /* ─────────────────────────────── moving ─────────────────────────────── */

  /** One line, slid towards index 0 and merged once per tile. Every direction is this, rotated. */
  function slide(line) {
    var kept = line.filter(function (value) {
      return value !== 0;
    });
    var out = [];
    var gained = 0;
    var mergedAt = [];

    for (var i = 0; i < kept.length; i++) {
      if (kept[i] === kept[i + 1]) {
        var value = kept[i] * 2;
        out.push(value);
        mergedAt.push(out.length - 1);
        gained += value;
        i++;
      } else {
        out.push(kept[i]);
      }
    }

    while (out.length < line.length) out.push(0);
    return { line: out, gained: gained, mergedAt: mergedAt };
  }

  function lineOf(direction, index) {
    var line = [];
    for (var i = 0; i < size; i++) {
      if (direction === "left") line.push(grid[index][i]);
      else if (direction === "right") line.push(grid[index][size - 1 - i]);
      else if (direction === "up") line.push(grid[i][index]);
      else line.push(grid[size - 1 - i][index]);
    }
    return line;
  }

  function putLine(direction, index, line, mergedAt, mergedCells) {
    for (var i = 0; i < size; i++) {
      var x;
      var y;
      if (direction === "left") { x = i; y = index; }
      else if (direction === "right") { x = size - 1 - i; y = index; }
      else if (direction === "up") { x = index; y = i; }
      else { x = index; y = size - 1 - i; }

      grid[y][x] = line[i];
      if (mergedAt.indexOf(i) >= 0) mergedCells.push(y * size + x);
    }
  }

  function move(direction) {
    if (over || paused) return;

    var beforeState = snapshot();
    var changed = false;
    var gained = 0;
    var mergedCells = [];

    for (var index = 0; index < size; index++) {
      var line = lineOf(direction, index);
      var result = slide(line);
      if (String(result.line) !== String(line)) changed = true;
      gained += result.gained;
      putLine(direction, index, result.line, result.mergedAt, mergedCells);
    }

    if (!changed) {
      SOUND.blocked();
      return;
    }

    // Only a move that changed something is a move: one step of undo, kept from before it happened.
    history.push(beforeState);
    if (history.length > 1) history.shift();

    score += gained;
    moves++;
    if (gained) totals.merges += mergedCells.length;

    var fresh = [];
    spawn(fresh);

    var reached = topTile();
    if (reached > highest) {
      highest = reached;
      levelUp(reached);
    } else if (gained) {
      SOUND.merge(gained);
      flash();
    } else {
      SOUND.move();
    }

    draw(fresh, mergedCells);
    refresh();
    report();
    persist();

    if (reached >= GOAL && !won) {
      won = true;
      finish(true);
      return;
    }
    if (stuck()) finish(false);
  }

  function topTile() {
    var top = 0;
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (grid[y][x] > top) top = grid[y][x];
    return top;
  }

  /** Nowhere to go: no empty square, and no neighbour equal to its neighbour. */
  function stuck() {
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (!grid[y][x]) return false;
        if (x + 1 < size && grid[y][x] === grid[y][x + 1]) return false;
        if (y + 1 < size && grid[y][x] === grid[y + 1][x]) return false;
      }
    }
    return true;
  }

  function undo() {
    if (!history.length || over) {
      say(t.noUndo);
      return;
    }
    var state = history.pop();
    grid = state.grid.map(function (row) {
      return row.slice();
    });
    score = state.score;
    moves = state.moves;
    highest = state.highest;
    draw();
    refresh();
  }

  function snapshot() {
    return {
      grid: grid.map(function (row) {
        return row.slice();
      }),
      score: score,
      moves: moves,
      highest: highest,
    };
  }

  /* ─────────────────────────────── the panel ─────────────────────────────── */

  function refresh() {
    document.getElementById("score").textContent = String(score);
    document.getElementById("best").textContent = String(Math.max(best, score));
    document.getElementById("moves").textContent = String(moves);

    // The level *is* the highest tile: 2 is level 1, 4 is level 2, and so on. It is the thing a player
    // is already watching, so naming it the level costs nothing and gives the progress bar a meaning.
    var level = Math.round(Math.log(highest) / Math.log(2));
    document.getElementById("level").textContent = String(level);
    document.getElementById("toNext").textContent = String(highest * 2);

    // How much of the board is already worth the next tile: two of these and it appears.
    var need = highest;
    var have = 0;
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (grid[y][x] === need) have++;
    document.getElementById("level-fill").style.width = Math.min(100, have * 50) + "%";
  }

  function flash() {
    boardEl.classList.add("flash");
    setTimeout(function () {
      boardEl.classList.remove("flash");
    }, 220);
  }

  function say(text) {
    var node = document.getElementById("over-text");
    if (node && over) node.textContent = text;
  }

  /**
   * The banner for a new best tile.
   *
   * Over the board and out of the way: nothing to dismiss, no pause. Congratulating somebody by
   * interrupting the move they are making is worse than not congratulating them.
   */
  function levelUp(reached) {
    SOUND.level();
    celebrate(reached >= 256 ? 40 : 18);

    var banner = document.getElementById("levelup");
    document.getElementById("levelup-value").textContent = String(reached);
    document.getElementById("levelup-label").textContent = t.level || "";

    // Restarting the animation needs the class off and a reflow, or two in a row show nothing.
    banner.classList.remove("on");
    void banner.offsetWidth;
    banner.classList.add("on");

    clearTimeout(levelUp.timer);
    levelUp.timer = setTimeout(function () {
      banner.classList.remove("on");
    }, 1500);

    coach && coach.event("tile", ["reached-" + reached]);
  }

  /** Confetti, drawn rather than shipped, and skipped for anybody who asked for less movement. */
  function celebrate(count) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var layer = document.getElementById("confetti");
    var colours = ["#22d3ee", "#facc15", "#4ade80", "#f87171", "#c084fc", "#60a5fa"];
    layer.classList.add("on");

    for (var i = 0; i < count; i++) {
      var piece = document.createElementNS(SVG_NS, "rect");
      piece.setAttribute("x", Math.random() * 100 + "%");
      piece.setAttribute("y", "0");
      piece.setAttribute("width", String(4 + Math.random() * 6));
      piece.setAttribute("height", String(8 + Math.random() * 10));
      piece.setAttribute("fill", colours[i % colours.length]);
      piece.style.animationDelay = Math.random() * 0.5 + "s";
      piece.style.animationDuration = 1.4 + Math.random() * 0.9 + "s";
      layer.appendChild(piece);
    }

    setTimeout(function () {
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      layer.classList.remove("on");
    }, 2600);
  }

  /* ─────────────────────────────── overlays ─────────────────────────────── */

  /**
   * One place that decides which overlay is showing.
   *
   * Four of them, and only one may be on top. Letting each manage its own visibility makes the answer
   * depend on the order the calls happen in, and then a pause panel covers the buttons of the question
   * underneath it and swallows the clicks meant for them.
   */
  function syncOverlays() {
    var open = function (id) {
      return document.getElementById(id).classList.contains("on");
    };
    var blocked = open("settings") || open("confirm") || open("over");
    document.getElementById("paused").classList.toggle("on", paused && !over && !blocked);
  }

  function setPaused(value) {
    paused = Boolean(value);
    document.getElementById("pause-text").textContent = paused ? t.resume : t.pause;
    if (paused || over) Music.stop();
    else if (settings.music) Music.start();
    syncOverlays();
  }

  /* ─────────────────────────────── the ending ─────────────────────────────── */

  function finish(reachedGoal) {
    if (over) return;
    over = true;
    Music.stop();

    var beatenBest = score > best && score > 0;
    var good = reachedGoal || score >= PASS_SCORE || beatenBest;

    if (good) {
      SOUND.win();
      celebrate(60);
    } else {
      SOUND.lose();
    }

    if (beatenBest) best = score;
    totals.games++;
    totals.best = Math.max(totals.best || 0, highest);

    document.getElementById("over").classList.toggle("won", good);
    document.getElementById("fig-win").classList.toggle("on", good);
    document.getElementById("fig-lose").classList.toggle("on", !good);
    document.getElementById("over-title").textContent = reachedGoal
      ? t.won
      : beatenBest
        ? t.newBest
        : good
          ? t.passed
          : t.over;
    document.getElementById("over-text").textContent = (t.result || "")
      .replace("{score}", String(score))
      .replace("{best}", String(highest))
      .replace("{moves}", String(moves));

    document.getElementById("over").classList.add("on");
    document.body.classList.add("over");
    syncOverlays();
    refresh();
    showRanking();

    if (coach) {
      coach.data.set("best", Math.max(best, score));
      coach.data.set("totals", totals);
      coach.finish({
        score: score,
        maxScore: 40000,
        passed: good,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  function showRanking() {
    var list = document.getElementById("ranking");
    list.innerHTML = "";
    if (!coach || !coach.ranking) return;

    coach.ranking({ window: "all", limit: 5 }).then(function (answer) {
      if (!answer || !answer.ok || !answer.rows) return;
      answer.rows.forEach(function (row) {
        var item = document.createElement("li");
        if (row.isYou) item.className = "you";
        item.innerHTML =
          "<span>" + row.rank + "</span><span></span><span>" + row.score + "</span>";
        item.children[1].textContent = row.name;
        list.appendChild(item);
      });
    });
  }

  function restart() {
    grid = empty();
    score = 0;
    moves = 0;
    highest = 2;
    over = false;
    won = false;
    history = [];
    startedAt = Date.now();

    build();
    var fresh = [];
    spawn(fresh);
    spawn(fresh);

    document.getElementById("over").classList.remove("on");
    document.getElementById("confirm").classList.remove("on");
    document.body.classList.remove("over");
    syncOverlays();

    draw(fresh);
    refresh();
    if (settings.music && !paused) Music.start();
  }

  /* ─────────────────────────────── the platform ─────────────────────────────── */

  function report() {
    if (!coach) return;
    var percent = Math.min(99, Math.round((Math.log(highest) / Math.log(GOAL)) * 100));
    if (percent === lastProgress) return;
    lastProgress = percent;
    coach.progress(percent, "tile-" + highest);
  }

  /**
   * Save, unless the platform would only refuse it.
   *
   * Writes are coalesced, so asking again inside the window earns a 429 and a red line in the console
   * for nothing: the app already holds the state and the previous save is still there.
   */
  function persist() {
    if (!coach || over) return;
    var now = Date.now();
    if (now - lastSaveAt < 3000) return;
    lastSaveAt = now;

    coach.save({
      grid: grid,
      score: score,
      moves: moves,
      highest: highest,
      size: size,
      totals: totals,
    });
  }

  function restore(state) {
    if (!state || !state.grid || !state.grid.length) return false;

    size = state.size || state.grid.length;
    boardEl.style.gridTemplateColumns = "repeat(" + size + ", 1fr)";
    build();

    grid = state.grid.map(function (row) {
      return row.slice();
    });
    score = state.score || 0;
    moves = state.moves || 0;
    highest = state.highest || topTile() || 2;
    if (state.totals) totals = state.totals;

    draw();
    refresh();
    return true;
  }

  /* ─────────────────────────────── language ─────────────────────────────── */

  function applyLanguage(locale) {
    if (!coach || !coach.i18n) return Promise.resolve();
    return coach.i18n({ locale: locale, fallback: FALLBACK }).then(function (bundle) {
      // `|| {}` is not noise: an older platform's SDK returns a bundle with no `strings`, and reading a
      // property of `undefined` would take the whole relabelling down with it.
      t = bundle.strings || {};
      paintLanguage(bundle.locale);
      return bundle.locale;
    });
  }

  function paintLanguage(locale) {
    document.documentElement.lang = String(locale || FALLBACK).slice(0, 2);

    var levels = document.getElementById("opt-difficulty");
    levels.innerHTML = "";
    ["easy", "normal", "hard"].forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      option.textContent = t["difficulty_" + name] || name;
      levels.appendChild(option);
    });
    levels.value = settings.difficulty || "normal";

    var select = document.getElementById("opt-locale");
    select.innerHTML = "";
    var follow = document.createElement("option");
    follow.value = "";
    follow.textContent = t.languagePlatform || "Platform language";
    select.appendChild(follow);
    LOCALES.forEach(function (code) {
      var option = document.createElement("option");
      option.value = code;
      option.textContent = LOCALE_NAMES[code] || code;
      select.appendChild(option);
    });
    select.value = settings.locale || "";

    var labels = {
      "l-score": t.score, "l-best": t.best, "l-moves": t.moves, "l-level": t.level,
      "l-toNext": t.toNext, "l-panel-stats": t.panelStats, "l-panel-controls": t.panelControls,
      "l-panel-keys": t.panelKeys, "l-sound": t.sound, "l-sound-help": t.soundHelp,
      "l-music": t.music, "l-music-help": t.musicHelp, "l-volume": t.volume,
      "l-difficulty": t.difficulty, "l-difficulty-help": t.difficultyHelp,
      "l-language": t.language, "l-language-help": t.languageHelp,
      "pause-text": paused ? t.resume : t.pause, "undo-text": t.undo, "restart-text": t.restart,
      "settings-open-text": t.settingsOpen, "end-text": t.end,
      "again-text": t.again, "leave-text": t.leave,
      "paused-title": t.pausedTitle, "paused-help": t.pausedHelp,
      "confirm-title": t.confirmTitle, "confirm-text": t.confirmText,
      "confirm-yes-text": t.confirmYes, "confirm-no-text": t.confirmNo,
      "k-up": t.kUp, "k-down": t.kDown, "k-left": t.kLeft, "k-right": t.kRight,
      "k-undo": t.kUndo, "k-pause": t.kPause,
    };

    Object.keys(labels).forEach(function (id) {
      var node = document.getElementById(id);
      if (node && labels[id] !== undefined) node.textContent = labels[id];
    });

    // The panel is an introduction before the first game and a settings panel after it.
    var started = totals.games > 0 || moves > 0;
    document.getElementById("settings-title").textContent = started ? t.settingsOpen : t.settingsTitle;
    document.getElementById("settings-done-text").textContent = started ? t.back : t.settingsDone;

    if (over) {
      document.getElementById("over-title").textContent =
        document.getElementById("over").classList.contains("won") ? t.passed : t.over;
    }
  }

  function applyTheme(tokens) {
    var map = {
      "--background": "--coach-bg",
      "--foreground": "--coach-fg",
      "--muted-foreground": "--coach-muted",
      "--border": "--coach-border",
      "--primary": "--coach-accent",
    };
    Object.keys(map).forEach(function (name) {
      if (tokens && tokens[name]) document.documentElement.style.setProperty(map[name], tokens[name]);
    });
  }

  /* ─────────────────────────────── settings ─────────────────────────────── */

  function applySettings() {
    document.getElementById("opt-sound").checked = settings.sound;
    document.getElementById("opt-music").checked = settings.music;
    document.getElementById("opt-volume").value = String(Math.round(settings.volume * 100));
    document.getElementById("quick-volume").value = String(Math.round(settings.volume * 100));
    document.getElementById("volume-value").textContent = Math.round(settings.volume * 100) + "%";
    document.getElementById("opt-difficulty").value = settings.difficulty || "normal";
    document.getElementById("opt-locale").value = settings.locale || "";
    document.getElementById("sound-icon").dataset.icon = settings.sound ? "sound-on" : "sound-off";

    Audio.setVolume(settings.volume);
    Audio.setMusic(settings.music);
    if (settings.music && !paused && !over) Music.start();
    else if (!settings.music) Music.stop();
  }

  function saveSettings() {
    // Any change is a gesture, which is the moment a browser lets audio start.
    Audio.unlock();

    settings.sound = document.getElementById("opt-sound").checked;
    settings.music = document.getElementById("opt-music").checked;
    settings.volume = Number(document.getElementById("opt-volume").value) / 100;

    var picked = document.getElementById("opt-locale").value;
    if (picked !== (settings.locale || "")) {
      settings.locale = picked || null;
      applyLanguage(settings.locale);
    }

    // A different board size is a different game, so changing it starts one rather than resizing the
    // one in progress and pretending the score still means the same thing.
    var level = document.getElementById("opt-difficulty").value;
    if (level !== settings.difficulty) {
      settings.difficulty = level;
      restart();
    }

    applySettings();
    if (coach) coach.data.set("settings", settings);
  }

  function openSettings() {
    document.getElementById("settings").classList.add("on");
    if (!over) setPaused(true);
    applySettings();
    paintLanguage(settings.locale || document.documentElement.lang);
    syncOverlays();
  }

  function closeSettings() {
    saveSettings();
    document.getElementById("settings").classList.remove("on");
    if (!over && paused) setPaused(false);
    syncOverlays();
  }

  /* ─────────────────────────────── input ─────────────────────────────── */

  var CAPS = { ArrowUp: "cap-up", ArrowDown: "cap-down", ArrowLeft: "cap-left", ArrowRight: "cap-right" };

  function litKey(key, on) {
    var id = CAPS[key];
    if (id) document.getElementById(id).classList.toggle("down", on);
  }

  document.addEventListener("keydown", function (event) {
    // Audio waits for a gesture, and a key is one: a game played with the keyboard would otherwise
    // never make a sound until somebody reached for the mouse.
    Audio.unlock();

    if (document.getElementById("settings").classList.contains("on")) return;
    if (document.getElementById("confirm").classList.contains("on")) return;

    if (paused && !over) {
      setPaused(false);
      return;
    }

    var moved = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[event.key];
    if (moved) {
      event.preventDefault();
      litKey(event.key, true);
      move(moved);
      return;
    }

    if (event.key === "z" || event.key === "Z") undo();
    if (event.key === "p" || event.key === "P") setPaused(!paused);
  });

  document.addEventListener("keyup", function (event) {
    litKey(event.key, false);
  });

  document.addEventListener("pointerdown", Audio.unlock.bind(Audio), { once: false });

  document.getElementById("pause").addEventListener("click", function () {
    setPaused(!paused);
  });
  document.getElementById("undo").addEventListener("click", undo);
  document.getElementById("end").addEventListener("click", function () {
    finish(false);
  });
  document.getElementById("again").addEventListener("click", restart);
  document.getElementById("settings-open").addEventListener("click", openSettings);
  document.getElementById("settings-done").addEventListener("click", closeSettings);

  // Leaving is the platform's to do: a sandboxed frame cannot navigate the page it sits in, so it asks.
  document.getElementById("leave").addEventListener("click", function () {
    if (coach && coach.exit) coach.exit();
  });

  document.getElementById("restart").addEventListener("click", function () {
    // Nothing to lose, nothing to ask.
    if (over || moves === 0) {
      restart();
      return;
    }
    document.getElementById("confirm").classList.add("on");
    if (!paused) setPaused(true);
    syncOverlays();
  });

  document.getElementById("confirm-yes").addEventListener("click", function () {
    document.getElementById("confirm").classList.remove("on");
    restart();
    syncOverlays();
  });

  document.getElementById("confirm-no").addEventListener("click", function () {
    document.getElementById("confirm").classList.remove("on");
    if (paused && !over) setPaused(false);
    syncOverlays();
  });

  ["opt-sound", "opt-music", "opt-difficulty", "opt-locale"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", saveSettings);
  });

  // `input` rather than `change`: a volume slider that only reacts when you let go cannot be set by ear.
  document.getElementById("opt-volume").addEventListener("input", function () {
    settings.volume = Number(this.value) / 100;
    document.getElementById("volume-value").textContent = this.value + "%";
    Audio.unlock();
    Audio.setVolume(settings.volume);
    document.getElementById("quick-volume").value = this.value;
  });

  document.getElementById("quick-volume").addEventListener("input", function () {
    settings.volume = Number(this.value) / 100;
    document.getElementById("opt-volume").value = this.value;
    document.getElementById("volume-value").textContent = this.value + "%";
    Audio.unlock();
    Audio.setVolume(settings.volume);
    if (coach) coach.data.set("settings", settings);
  });

  // Leaving the tab pauses; coming back says so rather than looking alive and ignoring every key.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && !over) setPaused(true);
    else syncOverlays();
  });

  /* ─────────────────────────────── start ─────────────────────────────── */

  restart();

  /**
   * Without the SDK this is still a game, just a private one.
   *
   * A host too old to serve the SDK, or a page opened directly, should leave somebody able to play
   * rather than looking at a board that does nothing.
   */
  if (!window.OpenCoach || typeof window.OpenCoach.connect !== "function") {
    refresh();
    return;
  }

  coach = window.OpenCoach.connect({
    /** The reader changed the language or the theme while playing: relabel, do not reload. */
    onUpdate: function (update) {
      applyTheme(update.themeTokens);
      // A choice made in the game's own settings outranks the site's.
      if (!settings.locale) applyLanguage(update.locale);
    },

    onInit: function (init) {
      applyTheme(init.themeTokens);
      applyLanguage(init.locale);

      coach.data.get("best").then(function (value) {
        best = Number(value || 0);
        refresh();
      });
      coach.data.get("totals").then(function (value) {
        if (value) totals = value;
      });

      coach.data.get("settings").then(function (stored) {
        if (stored) {
          Object.keys(stored).forEach(function (key) {
            if (stored[key] !== undefined) settings[key] = stored[key];
          });
          if (settings.locale) applyLanguage(settings.locale);
          if (rules().size !== size) restart();
          applySettings();
        } else {
          openSettings();
        }
      });

      // The game in progress, if there is one. Restoring is silent: somebody who left mid-game and came
      // back expects to find it, not to be asked about it.
      if (init.resume) restore(init.resume);
    },

    onPause: function () {
      if (!over) setPaused(true);
    },
  });
})();
