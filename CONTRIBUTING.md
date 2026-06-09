# Adding a Minigame

This project stays intentionally plain: Node serves static files, and the browser runs vanilla JavaScript.

To add a game:

1. Create `public/games/<game-key>/`.
2. Add `screen.js` and register `screen: function () { ... }`.
3. Add `controller.js` and register `controller: { activate() {}, onMessage(data) {} }`.
4. Include both scripts in `screen.html` and `controller.html`.
5. Add controller HTML only if the game needs its own phone UI.

Use the same `key` on screen and controller. The shell uses that key for lobby selection, game start, and message routing.

Existing examples:

- `public/games/lightcycles/`: small controller, canvas game loop.
- `public/games/drawing/`: timed round flow and save/export.
- `public/games/geoguess/`: game-local asset data plus touch gestures.
