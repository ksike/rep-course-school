/**
 * Bloques que caen — the reference Open Coach app.
 *
 * It is a complete game, and it is also the worked example of what the platform gives an app, so every
 * capability appears exactly once and is commented where it is used:
 *
 * - **`init`** brings the locale, the reader's theme tokens and the saved game, before the first frame.
 * - **`progress`** and **`event`** report what is happening, and the platform turns them into the
 *   activity summary and the player's weak areas.
 * - **`save`** keeps the game in progress; **`data`** keeps what outlives it — the record, the totals —
 *   in the app's own store, which no other app can read.
 * - **`finish`** reports the score once, and the ranking is built from that.
 *
 * There is no build step and no dependency: this file is the whole game. Rendering is SVG, updated one
 * cell at a time and only where something changed, so a full board costs a handful of attribute writes
 * per frame rather than a repaint.
 */

(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var COLS = 10;
  var ROWS = 20;
  var CELL = 30;

  /** The seven pieces, as their rotation states. Written out rather than rotated at runtime: it is
   *  four small arrays per piece, and it makes the wall kicks below readable. */
  var PIECES = {
    I: { colour: "#22d3ee", cells: [[[0, 1], [1, 1], [2, 1], [3, 1]], [[2, 0], [2, 1], [2, 2], [2, 3]], [[0, 2], [1, 2], [2, 2], [3, 2]], [[1, 0], [1, 1], [1, 2], [1, 3]]] },
    J: { colour: "#60a5fa", cells: [[[0, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [2, 2]], [[1, 0], [1, 1], [0, 2], [1, 2]]] },
    L: { colour: "#fb923c", cells: [[[2, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 2]], [[0, 1], [1, 1], [2, 1], [0, 2]], [[0, 0], [1, 0], [1, 1], [1, 2]]] },
    O: { colour: "#facc15", cells: [[[1, 0], [2, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [2, 1]]] },
    S: { colour: "#4ade80", cells: [[[1, 0], [2, 0], [0, 1], [1, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]], [[1, 1], [2, 1], [0, 2], [1, 2]], [[0, 0], [0, 1], [1, 1], [1, 2]]] },
    T: { colour: "#c084fc", cells: [[[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [2, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [1, 2]], [[1, 0], [0, 1], [1, 1], [1, 2]]] },
    Z: { colour: "#f87171", cells: [[[0, 0], [1, 0], [1, 1], [2, 1]], [[2, 0], [1, 1], [2, 1], [1, 2]], [[0, 1], [1, 1], [1, 2], [2, 2]], [[1, 0], [0, 1], [1, 1], [0, 2]]] },
  };
  var NAMES = ["I", "J", "L", "O", "S", "T", "Z"];

  /** Standard line scores, multiplied by the level. A four-line clear is worth more than four singles,
   *  which is the whole reason anybody stacks. */
  var LINE_SCORE = [0, 100, 300, 500, 800];

  var TEXT = {
    es: {
      score: "Puntos", best: "Récord", lines: "Líneas", next: "Siguiente", pause: "Pausa", resume: "Seguir",
      end: "Terminar", again: "Jugar otra vez", over: "Fin de la partida", paused: "En pausa",
      newBest: "¡Nuevo récord!", result: "{score} puntos · {lines} líneas · nivel {level}",
      settingsTitle: "Antes de empezar", settingsDone: "Empezar",
      sound: "Sonido", soundHelp: "Efectos de movimiento, línea y fin de partida.",
      ghost: "Sombra de la pieza", ghostHelp: "Muestra dónde va a caer. Desactívala si el juego va lento.",
    },
    en: {
      score: "Score", best: "Best", lines: "Lines", next: "Next", pause: "Pause", resume: "Resume",
      end: "Finish", again: "Play again", over: "Game over", paused: "Paused",
      newBest: "New best!", result: "{score} points · {lines} lines · level {level}",
      settingsTitle: "Before you start", settingsDone: "Start",
      sound: "Sound", soundHelp: "Movement, line and game-over effects.",
      ghost: "Piece shadow", ghostHelp: "Shows where it will land. Turn it off if the game feels slow.",
    },
  };

  /* ─────────────────────────────── state ─────────────────────────────── */

  var grid = [];
  var piece = null;
  var bag = [];
  var nextPiece = null;
  var score = 0;
  var lines = 0;
  var level = 1;
  var over = false;
  var paused = false;
  var startedAt = Date.now();
  var best = 0;
  var totals = { games: 0, lines: 0, tetrises: 0 };

  var coach = null;
  var t = TEXT.es;
  var lastProgress = -1;
  var dropTimer = 0;
  var lastFrame = 0;

  var boardEl = document.getElementById("board");
  var nextEl = document.getElementById("next");
  var cells = [];
  var painted = [];


  /* ─────────────────────────────── sound ─────────────────────────────── */

  /**
   * Sound, synthesised rather than shipped.
   *
   * No files: an app runs in a frame whose only reachable origin is its own package, so every sound
   * would be a download the pack has to carry, a licence somebody has to check, and bytes every player
   * pays for. Six oscillators cost nothing, work offline, and are the whole of the code below.
   *
   * The context is created on the first interaction, never at load. A browser refuses to start audio
   * without a gesture, and an app that tries anyway just fills the console with warnings.
   */
  var audio = null;
  var settings = { sound: true, ghost: true };

  function context() {
    if (!settings.sound) return null;
    if (!audio) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audio = new Ctor();
    }
    if (audio.state === "suspended") audio.resume();
    return audio;
  }

  /**
   * One tone. `type` shapes it: a square reads as an action, a sine as a reward, a sawtooth as a fall.
   * Kept short — anything above about 150 ms in a game this fast becomes a drone.
   */
  function tone(frequency, ms, type, volume, sweepTo) {
    var ctx = context();
    if (!ctx) return;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var now = ctx.currentTime;

    osc.type = type || "square";
    osc.frequency.setValueAtTime(frequency, now);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, now + ms / 1000);

    // A ramp rather than a stop: cutting a waveform at full amplitude is the click everybody hears.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume || 0.06, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + ms / 1000 + 0.02);
  }

  var SOUND = {
    move: function () { tone(220, 30, "square", 0.03); },
    rotate: function () { tone(340, 45, "square", 0.04); },
    drop: function () { tone(180, 90, "sawtooth", 0.05, 70); },
    lock: function () { tone(130, 60, "triangle", 0.05); },
    line: function (count) {
      // A chord, one note per line: four cleared at once should sound like more than four singles.
      var notes = [523, 659, 784, 1047];
      for (var i = 0; i < count; i++) {
        (function (index) {
          setTimeout(function () { tone(notes[index], 130, "sine", 0.07); }, index * 55);
        })(i);
      }
    },
    level: function () { tone(660, 90, "sine", 0.06, 990); },
    over: function () {
      [392, 330, 262, 196].forEach(function (note, index) {
        setTimeout(function () { tone(note, 220, "triangle", 0.07); }, index * 130);
      });
    },
  };

  /* ─────────────────────────────── rendering ─────────────────────────────── */

  /** One rect per cell, made once. After this, drawing is setting a fill. */
  function buildBoard() {
    var fragment = document.createDocumentFragment();
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", String(x * CELL + 1));
        rect.setAttribute("y", String(y * CELL + 1));
        rect.setAttribute("width", String(CELL - 2));
        rect.setAttribute("height", String(CELL - 2));
        rect.setAttribute("rx", "3");
        rect.setAttribute("fill", "transparent");
        fragment.appendChild(rect);
        cells.push(rect);
        painted.push("transparent");
      }
    }
    boardEl.appendChild(fragment);
  }

  function paint(index, colour) {
    if (painted[index] === colour) return;
    painted[index] = colour;
    cells[index].setAttribute("fill", colour);
  }

  function draw() {
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) paint(y * COLS + x, grid[y][x] || "transparent");
    }

    if (!piece) return;

    // The ghost: where the piece would land. It is what turns guesswork into a decision, and it is
    // also a second pass over the board, so it is what the settings offer to switch off.
    if (settings.ghost) {
    var ghost = piece.y;
    while (fits(piece.name, piece.rotation, piece.x, ghost + 1)) ghost++;
    each(piece.name, piece.rotation, piece.x, ghost, function (x, y) {
      if (y >= 0) paint(y * COLS + x, "color-mix(in srgb, " + PIECES[piece.name].colour + " 22%, transparent)");
    });
    }

    each(piece.name, piece.rotation, piece.x, piece.y, function (x, y) {
      if (y >= 0) paint(y * COLS + x, PIECES[piece.name].colour);
    });
  }

  function drawNext() {
    while (nextEl.firstChild) nextEl.removeChild(nextEl.firstChild);
    if (!nextPiece) return;
    each(nextPiece, 0, 0, 0, function (x, y) {
      var rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(x * 28 + 6));
      rect.setAttribute("y", String(y * 28 + 20));
      rect.setAttribute("width", "24");
      rect.setAttribute("height", "24");
      rect.setAttribute("rx", "3");
      rect.setAttribute("fill", PIECES[nextPiece].colour);
      nextEl.appendChild(rect);
    });
  }

  /* ─────────────────────────────── rules ─────────────────────────────── */

  function each(name, rotation, offsetX, offsetY, fn) {
    var shape = PIECES[name].cells[rotation % 4];
    for (var i = 0; i < shape.length; i++) fn(shape[i][0] + offsetX, shape[i][1] + offsetY);
  }

  function fits(name, rotation, offsetX, offsetY) {
    var ok = true;
    each(name, rotation, offsetX, offsetY, function (x, y) {
      if (x < 0 || x >= COLS || y >= ROWS) ok = false;
      else if (y >= 0 && grid[y][x]) ok = false;
    });
    return ok;
  }

  /** A seven-bag: every piece appears once before any appears twice, so a run of four S pieces —
   *  which feels like the game cheating — cannot happen. */
  function nextName() {
    if (bag.length === 0) {
      bag = NAMES.slice();
      for (var i = bag.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var swap = bag[i];
        bag[i] = bag[j];
        bag[j] = swap;
      }
    }
    return bag.pop();
  }

  function spawn() {
    piece = { name: nextPiece || nextName(), rotation: 0, x: 3, y: -1 };
    nextPiece = nextName();
    drawNext();
    if (!fits(piece.name, piece.rotation, piece.x, piece.y)) finish();
  }

  function move(dx, dy) {
    if (!piece || over || paused) return false;
    if (!fits(piece.name, piece.rotation, piece.x + dx, piece.y + dy)) return false;
    piece.x += dx;
    piece.y += dy;
    draw();
    return true;
  }

  /** Rotation with wall kicks: against a wall, try shifting one or two columns before refusing. Without
   *  them a piece beside the edge simply will not turn, which reads as the game being broken. */
  function rotate() {
    if (!piece || over || paused) return;
    var turned = (piece.rotation + 1) % 4;
    var kicks = [0, -1, 1, -2, 2];
    for (var i = 0; i < kicks.length; i++) {
      if (fits(piece.name, turned, piece.x + kicks[i], piece.y)) {
        piece.x += kicks[i];
        piece.rotation = turned;
        draw();
        coach && coach.event("rotate", ["piece-" + piece.name.toLowerCase()]);
        SOUND.rotate();
        return;
      }
    }
  }

  function lock() {
    each(piece.name, piece.rotation, piece.x, piece.y, function (x, y) {
      if (y >= 0) grid[y][x] = PIECES[piece.name].colour;
    });

    var cleared = 0;
    for (var y = ROWS - 1; y >= 0; y--) {
      var full = true;
      for (var x = 0; x < COLS; x++) if (!grid[y][x]) full = false;
      if (!full) continue;
      grid.splice(y, 1);
      grid.unshift(new Array(COLS).fill(null));
      cleared++;
      y++;
    }

    var previousLevel = level;
    if (cleared > 0) {
      score += LINE_SCORE[cleared] * level;
      lines += cleared;
      totals.lines += cleared;
      level = Math.floor(lines / 10) + 1;

      // The tags are this game's own vocabulary, and the platform never interprets them: they are what
      // turns "played for ten minutes" into "good at clearing four at once".
      coach && coach.event("line-clear", [cleared === 4 ? "tetris" : "lines-" + cleared, "level-" + level]);
      SOUND.line(cleared);
      if (level > previousLevel) SOUND.level();
      if (cleared === 4) totals.tetrises++;

      report();
    }

    if (cleared === 0) SOUND.lock();
    spawn();
    refresh();
  }

  function drop() {
    if (!piece || over || paused) return;
    var distance = 0;
    while (move(0, 1)) distance++;
    score += distance * 2;
    coach && coach.event("hard-drop", ["rows-" + distance]);
    SOUND.drop();
    lock();
  }

  /* ─────────────────────────── the platform ─────────────────────────── */

  /**
   * Progress, as a fraction of what this app considers a full game.
   *
   * Reported only when the whole number changes, because the platform coalesces writes and a report per
   * frame would be refused anyway. It is what lets the listing say "continue" rather than "start".
   */
  function report() {
    if (!coach) return;
    var percent = Math.min(100, Math.round((score / 20000) * 100));
    if (percent === lastProgress) return;
    lastProgress = percent;
    coach.progress(percent, "level-" + level);
  }

  function refresh() {
    document.getElementById("score").textContent = String(score);
    document.getElementById("lines").textContent = String(lines);
    document.getElementById("best").textContent = String(Math.max(best, score));
    draw();
  }

  /** The game in progress, small enough to be state rather than assets: the board, the piece, the counts. */
  function snapshot() {
    return {
      grid: grid.map(function (row) {
        return row.map(function (cell) {
          return cell ? NAMES.indexOf(colourName(cell)) : -1;
        });
      }),
      piece: piece,
      nextPiece: nextPiece,
      score: score,
      lines: lines,
      level: level,
    };
  }

  function colourName(colour) {
    for (var i = 0; i < NAMES.length; i++) if (PIECES[NAMES[i]].colour === colour) return NAMES[i];
    return "I";
  }

  function restore(state) {
    if (!state || !state.grid) return false;
    grid = state.grid.map(function (row) {
      return row.map(function (index) {
        return index >= 0 ? PIECES[NAMES[index]].colour : null;
      });
    });
    piece = state.piece;
    nextPiece = state.nextPiece;
    score = state.score || 0;
    lines = state.lines || 0;
    level = state.level || 1;
    drawNext();
    refresh();
    return true;
  }

  /**
   * The end of a game, and the only place a score is reported.
   *
   * Three different things are written, to three different places, and the difference is the point:
   * the **session** is the run and belongs to the platform's statistics and the ranking; the **record**
   * and the **totals** are the app's own memory of this player; and the **save** is cleared, because a
   * finished game is not a game to resume.
   */
  function finish() {
    if (over) return;
    over = true;
    SOUND.over();

    var beaten = score > best;
    if (beaten) best = score;
    totals.games++;

    if (coach) {
      coach.data.set("best", best);
      coach.data.set("totals", totals);
      coach.save(null);
      coach.finish({
        score: score,
        maxScore: 20000,
        durationMs: Date.now() - startedAt,
      });
    }

    document.getElementById("over-title").textContent = beaten ? t.newBest : t.over;
    document.getElementById("over-text").textContent = t.result
      .replace("{score}", String(score))
      .replace("{lines}", String(lines))
      .replace("{level}", String(level));
    document.getElementById("over").classList.add("on");
    refresh();
  }

  function restart() {
    grid = [];
    for (var y = 0; y < ROWS; y++) grid.push(new Array(COLS).fill(null));
    score = 0;
    lines = 0;
    level = 1;
    over = false;
    paused = false;
    startedAt = Date.now();
    lastProgress = -1;
    bag = [];
    nextPiece = null;
    document.getElementById("over").classList.remove("on");
    spawn();
    refresh();
  }

  function setPaused(value, persist) {
    paused = value;
    document.getElementById("pause-text").textContent = paused ? t.resume : t.pause;
    document.getElementById("pause-icon").dataset.icon = paused ? "play" : "pause";
    // A pause is a good moment to persist: the player has stopped, and the write costs nothing now.
    // Not when the settings panel is what paused it, though: opening and closing it would be two
    // writes a second apart, and the second is refused — correctly, and noisily.
    if (paused && persist !== false && coach && !over) coach.save(snapshot());
  }

  /* ─────────────────────────────── loop ─────────────────────────────── */

  function frame(now) {
    requestAnimationFrame(frame);
    if (over || paused) {
      lastFrame = now;
      return;
    }

    var elapsed = now - lastFrame;
    lastFrame = now;
    dropTimer += elapsed;

    // Faster with every level, with a floor: below about 60 ms the game stops being playable and
    // starts being a slideshow of losses.
    var interval = Math.max(60, 800 - (level - 1) * 65);
    if (dropTimer < interval) return;
    dropTimer = 0;

    if (!move(0, 1)) lock();
  }

  /* ─────────────────────────────── input ─────────────────────────────── */

  function onKey(event) {
    var handled = true;
    switch (event.key) {
      case "ArrowLeft": if (move(-1, 0)) SOUND.move(); break;
      case "ArrowRight": if (move(1, 0)) SOUND.move(); break;
      case "ArrowDown": if (move(0, 1)) score += 1; refresh(); break;
      case "ArrowUp": case "x": case "X": rotate(); break;
      case " ": drop(); break;
      case "p": case "P": setPaused(!paused); break;
      default: handled = false;
    }
    if (handled) event.preventDefault();
  }

  /** Touch: a tap turns the piece, a swipe moves it, a swipe down drops it. */
  function touch() {
    var from = null;
    boardEl.addEventListener("touchstart", function (event) {
      from = { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() };
    }, { passive: true });

    boardEl.addEventListener("touchend", function (event) {
      if (!from) return;
      var dx = event.changedTouches[0].clientX - from.x;
      var dy = event.changedTouches[0].clientY - from.y;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24 && Date.now() - from.at < 300) rotate();
      else if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1, 0);
      else if (dy > 0) drop();
      from = null;
    }, { passive: true });
  }

  /* ─────────────────────────────── settings ─────────────────────────────── */

  /**
   * Shown once before the first game, and reachable afterwards from the sound button.
   *
   * Kept in the app's own store, so somebody who turned the sound off does not have to turn it off
   * again on their phone. Paused while it is open: reading a panel is not a reason to lose a game.
   */
  function applySettings() {
    document.getElementById("opt-sound").checked = settings.sound;
    document.getElementById("opt-ghost").checked = settings.ghost;
    document.getElementById("sound-icon").dataset.icon = settings.sound ? "sound-on" : "sound-off";
    draw();
  }

  function saveSettings() {
    settings.sound = document.getElementById("opt-sound").checked;
    settings.ghost = document.getElementById("opt-ghost").checked;
    applySettings();
    if (coach) coach.data.set("settings", settings);
  }

  function openSettings() {
    if (!over) setPaused(true, false);
    applySettings();
    document.getElementById("settings").classList.add("on");
  }

  function closeSettings() {
    saveSettings();
    document.getElementById("settings").classList.remove("on");
    if (!over && paused) setPaused(false, false);
  }

  /* ─────────────────────────────── start ─────────────────────────────── */

  buildBoard();
  restart();
  touch();
  document.addEventListener("keydown", onKey);
  document.getElementById("pause").addEventListener("click", function () { setPaused(!paused); });
  document.getElementById("end").addEventListener("click", finish);
  document.getElementById("again").addEventListener("click", restart);
  document.getElementById("settings-open").addEventListener("click", openSettings);
  document.getElementById("settings-done").addEventListener("click", closeSettings);
  ["opt-sound", "opt-ghost"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", saveSettings);
  });
  requestAnimationFrame(frame);

  coach = window.OpenCoach.connect({
    onInit: function (init) {
      t = TEXT[(init.locale || "es").slice(0, 2)] || TEXT.es;
      document.documentElement.lang = (init.locale || "es").slice(0, 2);

      // The reader's theme, as plain custom properties. The app follows light or dark without knowing
      // anything about the application that sent them.
      var tokens = init.themeTokens || {};
      var map = { "--background": "--coach-bg", "--foreground": "--coach-fg", "--muted-foreground": "--coach-muted", "--border": "--coach-border", "--primary": "--coach-accent" };
      Object.keys(map).forEach(function (name) {
        if (tokens[name]) document.documentElement.style.setProperty(map[name], tokens[name]);
      });

      ["score", "best", "lines", "next", "pause", "end", "again"].forEach(function (key) {
        var label = document.getElementById("l-" + key) || document.getElementById(key + "-text");
        if (label) label.textContent = t[key];
      });
      document.getElementById("settings-title").textContent = t.settingsTitle;
      document.getElementById("settings-done-text").textContent = t.settingsDone;
      document.getElementById("l-sound").textContent = t.sound;
      document.getElementById("l-sound-help").textContent = t.soundHelp;
      document.getElementById("l-ghost").textContent = t.ghost;
      document.getElementById("l-ghost-help").textContent = t.ghostHelp;

      // What outlives a game comes from the app's own store; the game in progress comes from the save.
      // Both are the platform's, tied to the account, so they follow the player between devices.
      coach.data.get("best").then(function (value) {
        best = Number(value || 0);
        refresh();
      });
      coach.data.get("totals").then(function (value) {
        if (value) totals = value;
      });

      // The panel opens on the first game and never again: somebody who has already answered does not
      // want to be asked every time they play.
      coach.data.get("settings").then(function (stored) {
        if (stored) {
          settings = stored;
          applySettings();
        } else {
          openSettings();
        }
      });

      if (init.resume) restore(init.resume);
    },
  });

  // A game left mid-air is a game somebody wants back. Saved when the tab goes away, which is the last
  // moment the browser reliably gives us.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && coach && !over) {
      setPaused(true);
      coach.save(snapshot());
    }
  });
})();
