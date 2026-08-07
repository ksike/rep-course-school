/**
 * Falling blocks — a standalone Open Coach game (tier C).
 *
 * Everything here is the package's own: the rules, the drawing, the keyboard, the sound. The platform
 * contributes four things through the SDK and nothing else — the locale, the theme, the saved game and a
 * place to report the score. That separation is the point of the tier: the game can be written, built and
 * published by somebody with no access to the platform's code.
 *
 * The pieces are the seven tetrominoes, each stored as a list of rotations so rotation is a lookup rather
 * than a matrix transform with edge cases. Wall kicks are the simple two-step version: try the rotation
 * where it is, then one cell left, then one right. It is not the competitive standard, and for a game
 * somebody plays for four minutes it does not need to be.
 */

(function () {
  "use strict";

  var COLS = 10;
  var ROWS = 20;
  var CELL = 30;

  var SHAPES = {
    I: { colour: "#4cc2ff", cells: [[[0, 1], [1, 1], [2, 1], [3, 1]], [[2, 0], [2, 1], [2, 2], [2, 3]]] },
    O: { colour: "#ffd34c", cells: [[[1, 0], [2, 0], [1, 1], [2, 1]]] },
    T: { colour: "#c07cff", cells: [
      [[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [1, 2]], [[1, 0], [0, 1], [1, 1], [1, 2]],
    ] },
    S: { colour: "#5ddc82", cells: [[[1, 0], [2, 0], [0, 1], [1, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]]] },
    Z: { colour: "#ff6b6b", cells: [[[0, 0], [1, 0], [1, 1], [2, 1]], [[2, 0], [1, 1], [2, 1], [1, 2]]] },
    J: { colour: "#7c9bff", cells: [
      [[0, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]], [[1, 0], [1, 1], [0, 2], [1, 2]],
    ] },
    L: { colour: "#ffa14c", cells: [
      [[2, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]], [[0, 0], [1, 0], [1, 1], [1, 2]],
    ] },
  };
  var KEYS = Object.keys(SHAPES);

  /** Points per simultaneous line, the classic curve: four at once is worth far more than four in a row. */
  var LINE_SCORE = [0, 100, 300, 500, 800];

  var board = document.getElementById("board");
  var ctx = board.getContext("2d");
  var nextCanvas = document.getElementById("next");
  var nextCtx = nextCanvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var linesEl = document.getElementById("lines");
  var overEl = document.getElementById("over");
  var overText = document.getElementById("over-text");

  var TEXT = {
    es: { score: "Puntos", best: "Récord", lines: "Líneas", next: "Siguiente", end: "Terminar",
          again: "Jugar otra vez", over: "Fin de la partida", paused: "En pausa",
          result: function (s, l) { return s + " puntos, " + l + " líneas."; },
          noSave: "No has iniciado sesión: esta partida no se guardará." },
    en: { score: "Score", best: "Best", lines: "Lines", next: "Next", end: "Finish",
          again: "Play again", over: "Game over", paused: "Paused",
          result: function (s, l) { return s + " points, " + l + " lines."; },
          noSave: "You are not signed in: this game will not be saved." },
  };
  var t = TEXT.es;

  var grid, current, next, score, lines, dropEvery, dropTimer, lastFrame, paused, over, best = 0;
  var coach = null;
  var canSave = false;
  var startedAt = Date.now();

  /* ── sound ───────────────────────────────────────────────────────────── */

  // Synthesised rather than shipped: four sounds as audio files would be most of the package's weight,
  // and a square wave is exactly the right instrument for this.
  var audio = null;
  function beep(frequency, ms, type) {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      var oscillator = audio.createOscillator();
      var gain = audio.createGain();
      oscillator.type = type || "square";
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.04;
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + ms / 1000);
    } catch (err) {
      // Sound is a nicety; a browser that refuses it must not stop the game.
    }
  }

  /* ── rules ───────────────────────────────────────────────────────────── */

  function emptyGrid() {
    var rows = [];
    for (var y = 0; y < ROWS; y++) rows.push(new Array(COLS).fill(null));
    return rows;
  }

  function spawn() {
    var key = KEYS[Math.floor(Math.random() * KEYS.length)];
    return { key: key, rotation: 0, x: 3, y: -1 };
  }

  function cellsOf(piece) {
    var shape = SHAPES[piece.key];
    return shape.cells[piece.rotation % shape.cells.length];
  }

  function fits(piece, dx, dy, rotation) {
    var test = { key: piece.key, rotation: rotation === undefined ? piece.rotation : rotation, x: piece.x + dx, y: piece.y + dy };
    var cells = cellsOf(test);
    for (var i = 0; i < cells.length; i++) {
      var x = test.x + cells[i][0];
      var y = test.y + cells[i][1];
      if (x < 0 || x >= COLS || y >= ROWS) return false;
      if (y >= 0 && grid[y][x]) return false;
    }
    return true;
  }

  function lock() {
    var cells = cellsOf(current);
    for (var i = 0; i < cells.length; i++) {
      var x = current.x + cells[i][0];
      var y = current.y + cells[i][1];
      if (y < 0) {
        finish(true);
        return;
      }
      grid[y][x] = SHAPES[current.key].colour;
    }

    var cleared = 0;
    for (var row = ROWS - 1; row >= 0; row--) {
      if (grid[row].every(function (cell) { return cell !== null; })) {
        grid.splice(row, 1);
        grid.unshift(new Array(COLS).fill(null));
        cleared++;
        row++;
      }
    }

    if (cleared > 0) {
      lines += cleared;
      score += LINE_SCORE[cleared];
      beep(cleared === 4 ? 880 : 620, 120, "triangle");
      if (coach) coach.event("line-clear", [cleared === 4 ? "quadruple" : "single"]);
      // Every ten lines the drop speeds up, which is what turns a puzzle into a game.
      dropEvery = Math.max(90, 600 - Math.floor(lines / 10) * 60);
      save();
    } else {
      beep(180, 40);
    }

    current = next;
    next = spawn();
    if (!fits(current, 0, 0)) finish(true);
    paint();
  }

  function move(dx) {
    if (fits(current, dx, 0)) {
      current.x += dx;
      paint();
    }
  }

  function rotate() {
    var shape = SHAPES[current.key];
    var wanted = (current.rotation + 1) % shape.cells.length;
    // Where it is, then one cell to each side: enough to turn against a wall without a kick table.
    var offsets = [0, -1, 1];
    for (var i = 0; i < offsets.length; i++) {
      if (fits(current, offsets[i], 0, wanted)) {
        current.x += offsets[i];
        current.rotation = wanted;
        beep(320, 30);
        paint();
        return;
      }
    }
  }

  function drop(hard) {
    if (hard) {
      while (fits(current, 0, 1)) current.y++;
      beep(120, 60);
      lock();
      return;
    }
    if (fits(current, 0, 1)) {
      current.y++;
      paint();
    } else {
      lock();
    }
  }

  /* ── drawing ─────────────────────────────────────────────────────────── */

  function block(context, x, y, size, colour) {
    context.fillStyle = colour;
    context.fillRect(x + 1, y + 1, size - 2, size - 2);
    context.fillStyle = "rgba(255,255,255,.16)";
    context.fillRect(x + 1, y + 1, size - 2, 3);
  }

  function paint() {
    ctx.clearRect(0, 0, board.width, board.height);

    ctx.strokeStyle = "rgba(255,255,255,.04)";
    for (var x = 1; x < COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL, 0);
      ctx.lineTo(x * CELL, ROWS * CELL);
      ctx.stroke();
    }

    for (var row = 0; row < ROWS; row++) {
      for (var col = 0; col < COLS; col++) {
        if (grid[row][col]) block(ctx, col * CELL, row * CELL, CELL, grid[row][col]);
      }
    }

    // The landing shadow, which is what makes the game playable rather than a guessing exercise.
    var ghost = { key: current.key, rotation: current.rotation, x: current.x, y: current.y };
    while (fits(ghost, 0, 1)) ghost.y++;
    var ghostCells = cellsOf(ghost);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    for (var g = 0; g < ghostCells.length; g++) {
      ctx.fillRect((ghost.x + ghostCells[g][0]) * CELL + 1, (ghost.y + ghostCells[g][1]) * CELL + 1, CELL - 2, CELL - 2);
    }

    var cells = cellsOf(current);
    for (var i = 0; i < cells.length; i++) {
      var cy = current.y + cells[i][1];
      if (cy < 0) continue;
      block(ctx, (current.x + cells[i][0]) * CELL, cy * CELL, CELL, SHAPES[current.key].colour);
    }

    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    var preview = cellsOf(next);
    for (var n = 0; n < preview.length; n++) {
      block(nextCtx, preview[n][0] * 22 + 6, preview[n][1] * 22 + 6, 22, SHAPES[next.key].colour);
    }

    scoreEl.textContent = String(score);
    linesEl.textContent = String(lines);
    bestEl.textContent = String(best);
  }

  /* ── the platform ────────────────────────────────────────────────────── */

  function save() {
    if (!coach || !canSave) return;
    coach.save({ best: Math.max(best, score), lines: lines });
  }

  function finish(gameOver) {
    if (over) return;
    over = true;
    best = Math.max(best, score);
    save();
    if (coach) {
      coach.finish({ score: score, maxScore: 20000, durationMs: Date.now() - startedAt });
    }
    overText.textContent = t.result(score, lines);
    overEl.classList.add("on");
    if (gameOver) beep(90, 300, "sawtooth");
  }

  function restart() {
    grid = emptyGrid();
    current = spawn();
    next = spawn();
    score = 0;
    lines = 0;
    dropEvery = 600;
    dropTimer = 0;
    paused = false;
    over = false;
    startedAt = Date.now();
    overEl.classList.remove("on");
    paint();
  }

  function loop(now) {
    if (!lastFrame) lastFrame = now;
    var delta = now - lastFrame;
    lastFrame = now;

    if (!paused && !over) {
      dropTimer += delta;
      if (dropTimer >= dropEvery) {
        dropTimer = 0;
        drop(false);
      }
    }
    requestAnimationFrame(loop);
  }

  document.addEventListener("keydown", function (event) {
    if (over) return;
    var handled = true;
    switch (event.key) {
      case "ArrowLeft": move(-1); break;
      case "ArrowRight": move(1); break;
      case "ArrowUp": rotate(); break;
      case "ArrowDown": drop(false); break;
      case " ": drop(true); break;
      case "p": case "P":
        paused = !paused;
        overText.textContent = t.paused;
        break;
      default: handled = false;
    }
    // Arrows and space scroll a page; inside a game they are the controls.
    if (handled) event.preventDefault();
  });

  document.getElementById("end").addEventListener("click", function () { finish(false); });
  document.getElementById("again").addEventListener("click", restart);

  restart();
  requestAnimationFrame(loop);

  coach = window.OpenCoach.connect({
    onInit: function (init) {
      canSave = init.canSave;
      t = TEXT[(init.locale || "es").slice(0, 2)] || TEXT.es;

      // The theme arrives as CSS custom properties, so the game follows light or dark without knowing how.
      Object.keys(init.themeTokens || {}).forEach(function (name) {
        document.documentElement.style.setProperty(name, init.themeTokens[name]);
      });

      document.getElementById("l-score").textContent = t.score;
      document.getElementById("l-best").textContent = t.best;
      document.getElementById("l-lines").textContent = t.lines;
      document.getElementById("l-next").textContent = t.next;
      document.getElementById("end").textContent = t.end;
      document.getElementById("again").textContent = t.again;
      document.getElementById("over-title").textContent = t.over;
      document.documentElement.lang = (init.locale || "es").slice(0, 2);

      if (init.resume && typeof init.resume.best === "number") best = init.resume.best;
      if (!init.canSave) overText.textContent = t.noSave;
      paint();
    },
  });
})();
