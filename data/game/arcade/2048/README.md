# 2048

Slide the board, join equal tiles, reach 2048. Arrows move, `Z` undoes the last move, `P` pauses.

Built on the Open Coach app SDK, so it is a package rather than a page:

- the score, the best tile and the game in progress are kept on the account, not in this browser;
- the ranking is the platform's, shown where the player is already looking;
- the words come from `lang/es.json` and `lang/en.json`, and the language follows the site unless the
  player chooses another in the game's own settings;
- the sound is synthesised, so nothing is downloaded to hear it.

Three difficulties change what the game *is* rather than only its numbers: **Gentle** is a 5×5 board
where only twos appear, **Normal** is the classic 4×4, and **Hard** keeps 4×4 but spawns fours often
enough that a wasted move costs something.

The level is the highest tile reached, which is what a player is watching anyway, so the progress bar
means "how close to the next one".
