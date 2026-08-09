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

  /** What `scoring.passScore` says in `game.json`: the same number the platform marks a pass at. */
  var PASS_SCORE = 5000;

  /**
   * Three ways to play, and each one changes what the game *is* rather than only its numbers.
   *
   * Slower or faster is the obvious half. The other half is the shadow: on hard it is gone, so the
   * landing spot has to be read off the well instead of being drawn, and that is a different skill.
   * Lines per level moves too — ten is a long time to wait for the first level on easy, and a player
   * who never reaches level two never finds out the game has levels at all.
   */
  var LEVELS = {
    easy: { speed: 1.35, ghost: true, linesPerLevel: 6 },
    normal: { speed: 1, ghost: true, linesPerLevel: 10 },
    hard: { speed: 0.62, ghost: false, linesPerLevel: 12 },
  };

  /** The chosen difficulty, or the sane one if a stored setting names something we dropped. */
  function rules() {
    return LEVELS[settings.difficulty] || LEVELS.normal;
  }

  /**
   * The languages this game speaks, and the one it falls back to.
   *
   * The strings themselves live in `lang/es.json` and `lang/en.json` beside `game.json`, loaded by the
   * SDK: adding a third language is a file and a line here, not a change to this script. Whatever is
   * declared in `game.json` under `locales` should match, because that is what the platform lists.
   */
  var LOCALES = ["es", "en"];
  var LOCALE_NAMES = { es: "Espanol", en: "English" };
  var FALLBACK = "es";

  /** Filled from the loaded bundle before anything is drawn; the keys are the same as before. */
  var t = {};

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
  var settings = { sound: true, music: true, volume: 0.7, ghost: true, locale: null, difficulty: "normal" };
  var lastProgress = -1;
  var lastSaveAt = 0;
  var dropTimer = 0;
  var lastFrame = 0;

  var boardEl = document.getElementById("board");
  var nextEl = document.getElementById("next");
  var cells = [];
  var painted = [];


  /* --------------------------------- sound --------------------------------- */

  /**
   * Sound, synthesised rather than shipped, and built around one problem: a browser will not start
   * audio until somebody has interacted with the page.
   *
   * The first version created the context inside each effect and called `resume()` there. `resume()`
   * is asynchronous, so whichever notes were scheduled before it settled were scheduled against a
   * suspended clock and never played -- which is why some key presses were silent and others were
   * not, with no pattern anybody could hear.
   *
   * So: one context, made once, unlocked by the first real gesture, and every effect scheduled only
   * while the clock is actually running. Everything goes through a master gain, which is what the
   * volume control moves.
   */
  var Audio = {
    ctx: null,
    master: null,
    musicGain: null,
    ready: false,

    /** Called from the first key press or tap, which is the only moment a browser accepts. */
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

      // Music sits on its own gain so it can stay under the effects without touching the master.
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = settings.music ? 0.34 : 0;
      this.musicGain.connect(this.master);

      if (this.ctx.state === "suspended") this.ctx.resume().then(markReady, noop);
      else markReady();
    },

    /** True only when a note scheduled now will actually be heard. */
    live: function () {
      return this.ready && this.ctx && this.ctx.state === "running";
    },

    setVolume: function (value) {
      if (!this.master || !this.ctx) return;
      // A ramp rather than a jump: moving a slider should not click.
      this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
    },

    setMusic: function (on) {
      if (!this.musicGain || !this.ctx) return;
      this.musicGain.gain.setTargetAtTime(on ? 0.34 : 0, this.ctx.currentTime, 0.05);
    },
  };

  function noop() {}

  function markReady() {
    Audio.ready = true;
    if (settings.music) Music.start();
  }

  /**
   * One note.
   *
   * `at` lets the sequencer place notes ahead of the clock; effects pass nothing and play now. The
   * gain ramps down instead of the oscillator stopping at full amplitude, because that cut is the
   * click everybody hears and nobody can place.
   */
  function tone(options) {
    if (!options.music && !settings.sound) return;
    if (!Audio.live()) return;

    var ctx = Audio.ctx;
    var at = Math.max(options.at || 0, ctx.currentTime);
    var seconds = (options.ms || 80) / 1000;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();

    osc.type = options.type || "square";
    osc.frequency.setValueAtTime(options.hz, at);
    if (options.to) osc.frequency.exponentialRampToValueAtTime(options.to, at + seconds);

    var peak = options.volume || 0.18;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

    osc.connect(gain);
    gain.connect(options.music ? Audio.musicGain : Audio.master);
    osc.start(at);
    osc.stop(at + seconds + 0.03);
  }

  var SOUND = {
    move: function () { tone({ hz: 240, ms: 40, type: "square", volume: 0.1 }); },
    rotate: function () { tone({ hz: 360, ms: 55, type: "square", volume: 0.13 }); },
    drop: function () { tone({ hz: 200, ms: 110, type: "sawtooth", volume: 0.16, to: 70 }); },
    lock: function () { tone({ hz: 140, ms: 70, type: "triangle", volume: 0.15 }); },
    line: function (count) {
      // A chord, one note per line and rising: four at once should sound like more than four singles.
      var notes = [523, 659, 784, 1047];
      var now = Audio.live() ? Audio.ctx.currentTime : 0;
      for (var i = 0; i < count; i++) {
        tone({ hz: notes[i], ms: 160, type: "sine", volume: 0.2, at: now + i * 0.06 });
      }
    },
    level: function () {
      var now = Audio.live() ? Audio.ctx.currentTime : 0;
      tone({ hz: 660, ms: 130, type: "sine", volume: 0.18, to: 990 });
      tone({ hz: 990, ms: 200, type: "triangle", volume: 0.14, at: now + 0.12 });
    },
    /**
     * Losing: four notes walking down, the last one flat and held.
     *
     * The ending has to *say* which ending it was. One tone for both meant somebody who had just beaten
     * their record heard the same thing as somebody who had been buried, which is the game shrugging.
     */
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

    /** Winning: a major arpeggio climbing, then the octave over it. */
    win: function () {
      var now = Audio.live() ? Audio.ctx.currentTime : 0;
      [523, 659, 784, 1047].forEach(function (note, index) {
        tone({ hz: note, ms: 180, type: "sine", volume: 0.2, at: now + index * 0.1 });
      });
      tone({ hz: 1047, ms: 520, type: "triangle", volume: 0.17, at: now + 0.42 });
      tone({ hz: 1568, ms: 520, type: "sine", volume: 0.12, at: now + 0.46 });
    },
  };

  /* --------------------------------- music --------------------------------- */

  /**
   * A loop, written here rather than downloaded.
   *
   * An original phrase in A minor: nothing to license, nothing to fetch, and the frame has no network
   * to fetch it with anyway. Two voices, a melody and a bass on the root, which is enough to sound
   * composed and cheap enough to run beside the game.
   *
   * Scheduled with a look-ahead rather than one timer per note. `setInterval` drifts and stutters
   * whenever the tab is busy; the audio clock does not, so the loop stays in time while the board is
   * redrawing.
   */
  var Music = {
    timer: null,
    next: 0,
    step: 0,

    /** `[semitones from A, beats]`, `null` is a rest. */
    melody: [
      [0, 1], [7, 0.5], [3, 0.5], [5, 1], [7, 0.5], [5, 0.5],
      [3, 1], [0, 0.5], [3, 0.5], [5, 1], [3, 0.5], [0, 0.5],
      [-2, 1], [3, 0.5], [0, 0.5], [-2, 1], [null, 1],
      [0, 1], [5, 0.5], [8, 0.5], [7, 1], [5, 0.5], [3, 0.5],
      [0, 1], [3, 0.5], [7, 0.5], [8, 2],
    ],

    hz: function (semitone) {
      return 440 * Math.pow(2, semitone / 12);
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

    /** Keep about a quarter of a second of notes ahead of the clock, and no more. */
    fill: function () {
      if (!Audio.live() || !settings.music) return;
      var beat = 0.34;

      while (this.next < Audio.ctx.currentTime + 0.25) {
        var note = this.melody[this.step % this.melody.length];
        var length = note[1] * beat;

        if (note[0] !== null) {
          tone({ hz: this.hz(note[0] + 12), ms: length * 900, type: "triangle", volume: 0.14, at: this.next, music: true });
        }
        // The bass lands on the first beat of each bar and holds under the phrase.
        if (this.step % 4 === 0) {
          tone({ hz: this.hz(-24), ms: beat * 1800, type: "sine", volume: 0.22, at: this.next, music: true });
        }

        this.next += length;
        this.step += 1;
      }
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
    if (settings.ghost && rules().ghost) {
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
      level = Math.floor(lines / rules().linesPerLevel) + 1;

      // The tags are this game's own vocabulary, and the platform never interprets them: they are what
      // turns "played for ten minutes" into "good at clearing four at once".
      coach && coach.event("line-clear", [cleared === 4 ? "tetris" : "lines-" + cleared, "level-" + level]);
      SOUND.line(cleared);
      flash();
      if (level > previousLevel) {
        SOUND.level();
        celebrate(18);
        showLevelUp(level);
      }
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
    document.getElementById("level").textContent = String(level);

    // How far to the next level, as a number somebody can act on rather than a level that changes
    // without warning. The denominator is the difficulty's, so the bar always means what it shows.
    var per = rules().linesPerLevel;
    var into = lines % per;
    document.getElementById("toNext").textContent = into + "/" + per;
    document.getElementById("level-fill").style.width = (into / per) * 100 + "%";

    draw();
  }

  /** A short flash on the well: a cleared line and a new level should be visible, not only audible. */
  function flash() {
    var board = document.getElementById("board");
    board.classList.add("flash");
    setTimeout(function () {
      board.classList.remove("flash");
    }, 260);
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

  /**
   * Pick a saved game back up.
   *
   * A save without a live piece is a save that has to spawn one, and until now it did not: the well
   * came back, the score came back, and nothing fell ever again — a game that looks alive and ignores
   * every key. A save written between two pieces is a normal save, so this is not a corrupt file, it
   * is a moment.
   */
  function restore(state) {
    if (!state || !state.grid) return false;
    grid = state.grid.map(function (row) {
      return row.map(function (index) {
        return index >= 0 ? PIECES[NAMES[index]].colour : null;
      });
    });
    piece = state.piece || null;
    nextPiece = state.nextPiece;
    score = state.score || 0;
    lines = state.lines || 0;
    level = state.level || 1;

    // No piece in the save means one is owed, not that the game is over.
    if (!piece) spawn();

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
    Music.stop();

    // What counts as winning: the score the manifest calls a pass, or a new personal best. Both are
    // reasons to be told something other than "you lost".
    var beatenBest = score > best && score > 0;
    var won = score >= PASS_SCORE || beatenBest;
    if (won) {
      SOUND.win();
      celebrate(60);
    } else {
      SOUND.lose();
    }

    if (beatenBest) best = score;
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

    document.getElementById("over").classList.toggle("won", won);
    document.getElementById("fig-win").classList.toggle("on", won);
    document.getElementById("fig-lose").classList.toggle("on", !won);
    document.getElementById("over-title").textContent = beatenBest ? t.newBest : won ? t.passed : t.over;
    document.getElementById("over-text").textContent = t.result
      .replace("{score}", String(score))
      .replace("{lines}", String(lines))
      .replace("{level}", String(level));
    document.getElementById("over").classList.add("on");
    document.body.classList.add("over");
    syncOverlays();
    refresh();
    showRanking();
  }

  /**
   * The leaderboard, on the screen where somebody has just found out how they did.
   *
   * Asked for **after** the score was reported, so the table already includes this game. The platform
   * builds it from its own sessions: the app never keeps a table of who is winning, which would be a
   * table it could write.
   */
  function showRanking() {
    var list = document.getElementById("ranking");
    list.innerHTML = "";
    if (!coach || !coach.ranking) return;

    coach.ranking({ limit: 5 }).then(function (answer) {
      if (!answer || !answer.ok || !answer.rows || answer.rows.length === 0) return;

      var rows = answer.rows.slice();
      // Somebody in fortieth place still wants to know they are fortieth, and a table that stops at
      // five tells them nothing about themselves.
      if (answer.you && !rows.some(function (row) { return row.isYou; })) {
        answer.you.isYou = true;
        rows.push(answer.you);
      }

      rows.forEach(function (row) {
        var item = document.createElement("li");
        if (row.isYou) item.className = "you";
        item.innerHTML =
          '<span class="rank">' + row.rank + "</span>" +
          '<span class="name"></span>' +
          '<span class="score">' + row.score + "</span>";
        // The name goes in as text: it comes from another person's profile, and building it into a
        // string would be the one place this app could be made to render somebody else's markup.
        item.querySelector(".name").textContent = row.name;
        list.appendChild(item);
      });
    });
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
    document.body.classList.remove("over");
    document.getElementById("confirm").classList.remove("on");
    syncOverlays();
    if (settings.music) Music.start();
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
    if (paused && persist !== false && coach && !over) persist_();

    syncOverlays();

    // Music follows the game rather than the tab: nobody wants a loop playing over a pause screen.
    if (paused || over) Music.stop();
    else if (settings.music) Music.start();
  }

  /**
   * Save, unless the platform would only refuse it.
   *
   * Writes are coalesced to one a second per key, so asking again inside that window earns a 429 and
   * a red line in the console for nothing — the app already holds the state, and the previous save is
   * still there. Better not to ask than to be told no.
   */
  function persist_() {
    if (!coach || over) return;
    var now = Date.now();
    if (now - lastSaveAt < 1500) return;
    lastSaveAt = now;
    coach.save(snapshot());
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
    // Easy gives more time per row, hard less, and the level still tightens it either way.
    var interval = Math.max(50, (800 - (level - 1) * 65) * rules().speed);
    if (dropTimer < interval) return;
    dropTimer = 0;

    if (!move(0, 1)) lock();
  }

  /* ─────────────────────────────── input ─────────────────────────────── */

  /** Which drawn key belongs to which real one, so the panel can light up with the keyboard. */
  var KEYCAP = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", " ": "wide", p: null, P: null,
  };

  function litKey(key, on) {
    var name = KEYCAP[key];
    if (name === undefined || name === null) return;
    var cap = document.querySelector(".keycap--" + name);
    if (cap) cap.classList.toggle("down", on);
  }

  function onKey(event) {
    Audio.unlock();
    litKey(event.key, true);
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
      Audio.unlock();
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

  /**
   * The banner for a new level.
   *
   * Over the board and out of the way: no pause, nothing to dismiss, pointer events off. Congratulating
   * somebody by interrupting the piece they are placing is worse than not congratulating them.
   */
  function showLevelUp(reached) {
    var banner = document.getElementById("levelup");
    document.getElementById("levelup-value").textContent = String(reached);
    document.getElementById("levelup-label").textContent = t.level;

    // Restarting the animation needs the class off and a reflow, or two levels in a row show nothing.
    banner.classList.remove("on");
    void banner.offsetWidth;
    banner.classList.add("on");

    clearTimeout(showLevelUp.timer);
    showLevelUp.timer = setTimeout(function () {
      banner.classList.remove("on");
    }, 1500);
  }

  /**
   * Confetti, in the same SVG the rest of the game is drawn in.
   *
   * A handful of rectangles with a CSS animation and a timeout that removes them: no library, no
   * images, and nothing left running afterwards. Skipped entirely when somebody asked for reduced
   * motion — a celebration nobody wanted is just movement in the way.
   */
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

  /**
   * The reader's theme, as plain custom properties. The app follows light or dark without knowing
   * anything about the application that sent them, and follows a change the same way.
   */
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

  /**
   * Put every label in the reader's language, and be able to do it again.
   *
   * The wording used to be written once inside `onInit`, so changing the language afterwards left the
   * game in the old one until it was reloaded — and reloading throws away the run. Every label is
   * named here, and the host sends `update` when somebody changes it.
   */
  /**
   * Load a language and put it on screen, without disturbing the game underneath.
   *
   * Called when the platform says the reader changed language and when the reader changes it in the
   * game's own settings. Nothing is reset and nothing is reloaded: a language is a set of labels, and
   * losing a game in progress to change one is not a trade anybody would accept.
   */
  function applyLanguage(locale) {
    if (!coach || !coach.i18n) return Promise.resolve();
    return coach.i18n({ locale: locale, fallback: FALLBACK }).then(function (bundle) {
      /*
        The bundle *is* the table. Copying it key by key meant naming every label twice — once where it
        is used and once in a list to copy it across — and the list was already out of date.

        `|| {}` is not defensive noise: an older platform's SDK returns a bundle with no `strings`, and
        without this the next line reads a property of `undefined` and the whole relabelling dies —
        which showed up as a settings panel whose language and difficulty lists were empty. An app must
        degrade against an older host, never take it down with it.
      */
      t = bundle.strings || {};
      paintLanguage(bundle.locale);
      return bundle.locale;
    });
  }

  function paintLanguage(locale) {
    document.documentElement.lang = String(locale || FALLBACK).slice(0, 2);

    // Built here rather than in the markup: the list is whatever the game declares, and the first
    // option has to be worded in the language currently on screen.
    var levels = document.getElementById("opt-difficulty");
    if (levels) {
      levels.innerHTML = "";
      ["easy", "normal", "hard"].forEach(function (name) {
        var option = document.createElement("option");
        option.value = name;
        option.textContent = t["difficulty_" + name] || name;
        levels.appendChild(option);
      });
      levels.value = settings.difficulty || "normal";
    }

    var select = document.getElementById("opt-locale");
    if (select) {
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
    }

    var labels = {
      "l-score": t.score, "l-best": t.best, "l-lines": t.lines, "l-next": t.next, "l-level": t.level,
      "l-toNext": t.toNext, "l-panel-stats": t.panelStats, "l-panel-controls": t.panelControls,
      "l-panel-keys": t.panelKeys, "l-sound": t.sound, "l-sound-help": t.soundHelp,
      "l-music": t.music, "l-music-help": t.musicHelp, "l-volume": t.volume,
      "l-ghost": t.ghost, "l-ghost-help": t.ghostHelp,
      "l-language": t.language, "l-language-help": t.languageHelp,
      "l-difficulty": t.difficulty, "l-difficulty-help": t.difficultyHelp,
      "pause-text": paused ? t.resume : t.pause, "end-text": t.end, "again-text": t.again,
      "leave-text": t.leave, "restart-text": t.restart, "settings-open-text": t.settingsOpen,
      "settings-title": t.settingsTitle, "settings-done-text": t.settingsDone,
      "paused-title": t.pausedTitle, "paused-help": t.pausedHelp,
      "confirm-title": t.confirmTitle, "confirm-text": t.confirmText,
      "confirm-yes-text": t.confirmYes, "confirm-no-text": t.confirmNo,
      "k-rotate": t.kRotate, "k-left": t.kLeft, "k-right": t.kRight, "k-down": t.kDown,
      "k-drop": t.kDrop, "k-pause": t.kPause,
    };

    Object.keys(labels).forEach(function (id) {
      var node = document.getElementById(id);
      if (node && labels[id] !== undefined) node.textContent = labels[id];
    });

    // The one label that is not static: the ending already on screen, if there is one.
    if (over) {
      document.getElementById("over-title").textContent =
        document.getElementById("over").classList.contains("won") ? t.passed : t.over;
    }
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
    document.getElementById("opt-music").checked = settings.music;
    document.getElementById("opt-ghost").checked = settings.ghost;
    document.getElementById("opt-locale").value = settings.locale || "";
    document.getElementById("opt-difficulty").value = settings.difficulty || "normal";
    // The shadow is the difficulty's to allow: on hard the checkbox says why it cannot be turned on.
    document.getElementById("opt-ghost").disabled = !rules().ghost;
    document.getElementById("l-ghost-help").textContent = rules().ghost ? t.ghostHelp : t.ghostHard;
    document.getElementById("opt-volume").value = String(Math.round(settings.volume * 100));
    document.getElementById("quick-volume").value = String(Math.round(settings.volume * 100));
    document.getElementById("volume-value").textContent = Math.round(settings.volume * 100) + "%";
    document.getElementById("sound-icon").dataset.icon = settings.sound ? "sound-on" : "sound-off";

    // The difficulty decides how many lines a level takes, so the panel has to be repainted with it:
    // changing to the gentle one and still reading "0/10" is the game contradicting itself.
    refresh();

    Audio.setVolume(settings.volume);
    Audio.setMusic(settings.music);
    if (settings.music) Music.start();
    else Music.stop();
    draw();
  }

  function saveSettings() {
    // Any change is a gesture, which is the moment a browser lets audio start.
    Audio.unlock();
    settings.sound = document.getElementById("opt-sound").checked;
    settings.music = document.getElementById("opt-music").checked;
    settings.ghost = document.getElementById("opt-ghost").checked;
    settings.difficulty = document.getElementById("opt-difficulty").value;
    settings.volume = Number(document.getElementById("opt-volume").value) / 100;

    // An empty choice means "follow the platform", which is why it is stored as null rather than as a
    // language code: the reader who never chose should keep following the site when they change it.
    var picked = document.getElementById("opt-locale").value;
    if (picked !== (settings.locale || "")) {
      settings.locale = picked || null;
      applyLanguage(settings.locale);
    }

    applySettings();
    if (coach) coach.data.set("settings", settings);
  }

  function openSettings() {
    // Reopened mid-game it is a settings panel, not an introduction: "Before you start / Start" read
    // as though answering it would restart the game, which is the opposite of what it does.
    var started = totals.games > 0 || score > 0 || lines > 0;
    document.getElementById("settings-title").textContent = started ? t.settingsOpen : t.settingsTitle;
    document.getElementById("settings-done-text").textContent = started ? t.back : t.settingsDone;

    document.getElementById("settings").classList.add("on");
    if (!over) setPaused(true, false);
    applySettings();
    syncOverlays();
  }

  function closeSettings() {
    saveSettings();
    document.getElementById("settings").classList.remove("on");
    if (!over && paused) setPaused(false, false);
    syncOverlays();
  }

  /* ─────────────────────────────── start ─────────────────────────────── */

  buildBoard();
  restart();
  touch();
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", function (event) {
    litKey(event.key, false);
  });
  /*
    Audio waits for a gesture, and a key is one.

    Only `pointerdown` unlocked it, so somebody who started playing the way this game is meant to be
    played — Space, then the arrows — heard nothing at all, and the first thing that ever made a sound
    was reaching for the volume slider with a mouse. Which reads as "the music is broken", and is.
  */
  document.addEventListener("pointerdown", Audio.unlock.bind(Audio), { once: false });
  document.addEventListener("keydown", Audio.unlock.bind(Audio), { once: false });
  document.getElementById("pause").addEventListener("click", function () { setPaused(!paused); });
  document.getElementById("end").addEventListener("click", finish);
  document.getElementById("again").addEventListener("click", restart);

  // Leaving is the platform's to do: a sandboxed frame cannot navigate the page it sits in, so it asks.
  document.getElementById("leave").addEventListener("click", function () {
    if (coach && coach.exit) coach.exit();
  });
  document.getElementById("settings-open").addEventListener("click", openSettings);

  /**
   * Restart, always reachable.
   *
   * Confirmed only when there is something to lose: asking "are you sure?" about a board with two
   * pieces on it is a question nobody wants. It is also the way out of any state the game has got
   * itself into, which is worth having within reach rather than behind a reload.
   */
  document.getElementById("restart").addEventListener("click", function () {
    // Nothing to lose, nothing to ask.
    if (over || score === 0) {
      restart();
      return;
    }
    document.getElementById("confirm").classList.add("on");
    if (!paused) setPaused(true, false);
    syncOverlays();
  });

  document.getElementById("confirm-yes").addEventListener("click", function () {
    document.getElementById("confirm").classList.remove("on");
    restart();
    syncOverlays();
  });

  document.getElementById("confirm-no").addEventListener("click", function () {
    document.getElementById("confirm").classList.remove("on");
    if (paused && !over) setPaused(false, false);
    syncOverlays();
  });

  // The volume beside the board, mirrored into the settings panel and kept in the account.
  document.getElementById("quick-volume").addEventListener("input", function () {
    settings.volume = Number(this.value) / 100;
    Audio.unlock();
    Audio.setVolume(settings.volume);
    var inPanel = document.getElementById("opt-volume");
    if (inPanel) inPanel.value = this.value;
    var label = document.getElementById("volume-value");
    if (label) label.textContent = this.value + "%";
  });
  document.getElementById("quick-volume").addEventListener("change", function () {
    if (coach) coach.data.set("settings", settings);
  });
  document.getElementById("settings-done").addEventListener("click", closeSettings);
  ["opt-sound", "opt-music", "opt-ghost", "opt-locale", "opt-difficulty"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", saveSettings);
  });
  // `input` rather than `change`: a volume slider that only reacts when you let go is a slider you
  // cannot set by ear.
  document.getElementById("opt-volume").addEventListener("input", function () {
    settings.volume = Number(this.value) / 100;
    document.getElementById("volume-value").textContent = this.value + "%";
    Audio.unlock();
    Audio.setVolume(settings.volume);
  });
  document.getElementById("opt-volume").addEventListener("change", saveSettings);
  requestAnimationFrame(frame);

  /**
   * The platform, if it is there.
   *
   * `OpenCoach` is absent when the SDK could not load — an older host whose policy does not allow it,
   * or the file opened straight from disk. Calling `connect` on nothing threw, the script died before
   * the board was built, and the result was a black screen with no explanation: the worst possible
   * failure for the one thing a reader was trying to open.
   *
   * So the game runs either way. Without a host it keeps nothing and reports nothing, and says so,
   * which is a game somebody can still play rather than a page that is simply broken.
   */
  if (!window.OpenCoach || typeof window.OpenCoach.connect !== "function") {
    refresh();
    return;
  }

  coach = window.OpenCoach.connect({
    /** The reader changed the language or the theme while playing: relabel, do not reload. */
    onUpdate: function (update) {
      applyTheme(update.themeTokens);
      // A choice made in the game's own settings outranks the site's: somebody reading in one language
      // and playing in another asked for that on purpose, and a site-wide switch should not undo it.
      if (!settings.locale) applyLanguage(update.locale);
    },

    onInit: function (init) {

      applyTheme(init.themeTokens);

      applyLanguage(init.locale);

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
          Object.keys(stored).forEach(function (key) {
            if (stored[key] !== undefined) settings[key] = stored[key];
          });
          // The stored choice arrives after the first paint, so the labels are redrawn if it differs.
          if (settings.locale) applyLanguage(settings.locale);
          applySettings();
        } else {
          openSettings();
        }
      });

      if (init.resume) restore(init.resume);
    },
  });

  /**
   * Leaving the tab pauses and saves; coming back says so instead of sitting there.
   *
   * Pausing on `visibilitychange` is right — the last moment the browser reliably gives us to save —
   * but only pausing was a trap: the board is still drawn, so the game looks alive while every key is
   * ignored, and nothing on screen says why. Coming back now shows the pause overlay, and the first
   * key or click resumes.
   */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (!over && !paused) setPaused(true);
      return;
    }
    if (!over && paused) syncOverlays();
  });

  /**
   * One place that decides which overlay is showing.
   *
   * There are four — settings, confirm, game over, paused — and only one may be on top. Each used to
   * manage its own visibility, which meant the answer depended on the order the calls happened in:
   * pausing to open the settings raised the pause panel *before* the settings panel was marked, so it
   * covered the buttons underneath and swallowed the clicks meant for them. Twice.
   *
   * So nothing toggles `paused` directly any more. Everything changes state and calls this, and this
   * decides — which is the difference between a rule and a habit.
   */
  function syncOverlays() {
    var open = function (id) {
      return document.getElementById(id).classList.contains("on");
    };
    var blocked = open("settings") || open("confirm") || open("over");
    document.getElementById("paused").classList.toggle("on", paused && !over && !blocked);
  }

  function resumeFromPause() {
    if (over || !paused) return;
    setPaused(false, false);
    syncOverlays();
  }

  document.getElementById("paused").addEventListener("click", resumeFromPause);
  document.addEventListener("keydown", function (event) {
    // Any key resumes, except the one that would immediately pause again.
    if (document.getElementById("confirm").classList.contains("on")) return;
    if (document.getElementById("settings").classList.contains("on")) return;
    if (paused && !over && event.key !== "p" && event.key !== "P") resumeFromPause();
  }, true);
})();
