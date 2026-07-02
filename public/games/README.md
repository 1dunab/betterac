# Minigames

Each minigame lives in its own folder and registers itself with the tiny runtime in `public/core/game-registry.js`.

A game usually has:

- `screen.js`: big-screen logic, rendering, scoring, messages to controllers.
- `controller.js`: phone UI bindings and messages back to the screen.
- optional local assets/data next to those files.

Register the same key on both sides:

```js
registerGame({
  key: 'mygame',
  label: 'My Game',
  min: 2,
  screen: function () {
    return { start(ids, settings) {}, stop() {}, onMessage(id, data) {}, render() {} };
  }
});

registerGame({
  key: 'mygame',
  label: 'My Game',
  min: 2,
  controller: { activate() {}, onMessage(data) {} }
});
```

Then include both files in `screen.html` and `controller.html`.

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
