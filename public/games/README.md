# Minigames

Each minigame lives in its own folder and registers itself with the tiny runtime in `public/core/game-registry.js`.

A game usually has:

- `meta.js`: single source for key, label, min players and the settings schema — loaded by **both** pages.
- `screen.js`: big-screen logic, rendering, scoring, messages to controllers.
- `controller.js`: phone UI bindings and messages back to the screen.
- optional local assets/data next to those files.

`registerGame` merges by key, so each file only contributes its part:

```js
// meta.js — shared metadata + declarative settings
registerGame({ key: 'mygame', label: 'My Game', min: 2, settings: {
  rounds: { label: 'Runden', type: 'number', default: 5, min: 3, max: 12, step: 1 },
  mode:   { label: 'Modus', type: 'choice', default: 'easy', options: [
            { v: 'easy', label: 'Leicht' }, { v: 'hard', label: 'Schwer' }] },
  words:  { label: 'Eigene Wörter', type: 'text', default: '', max: 90 }
} });

// screen.js
registerGame({ key: 'mygame', screen: function () {
  return { start(ids, cfg) {}, stop() {}, onMessage(id, data) {}, render() {} };
} });

// controller.js
registerGame({ key: 'mygame', controller: { activate() {}, onMessage(data) {} } });
```

The shell renders the settings UI in the host lobby from the schema, clamps incoming values against it, and passes the current values as `cfg` into `screen.start(ids, cfg)` — games never touch the shell for settings.

Then include `meta.js` + the page's file in `screen.html` and `controller.html` (meta.js first).

## Controller views

The controller module injects its own views — `controller.html` only contains the shell views (name, lobby, spectate). Wrap the module in an IIFE, inject the markup (plus any game-specific CSS in a `<style>` block), and register the view keys:

```js
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #myPad { flex:1; }
</style>
<div id="v-mygame" class="view">
  <div class="bar"><span class="word">My Game</span></div>
  <div id="myPad"></div>
</div>`);
  VIEWS.push('mygame');

  // DOM bindings go after the injection, then:
  registerGame({ key: 'mygame', label: 'My Game', min: 2, controller: {
    activate() { showView('mygame'); },
    onMessage(data) {}
  }});
})();
```

Generic shell styles (`.view`, `.bar`, `.btn`, `.center`, `.tools`, `.timer`, `.step`, `.modes`, …) are defined in `controller.html` and can be reused. If the game needs shared assets, keep them in the game folder and include them before the game scripts.
