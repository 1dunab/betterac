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

If the controller needs custom UI, add the HTML view to `controller.html`, add its view key to `VIEWS`, and bind it from the game controller. If the game needs shared assets, keep them in the game folder and include them before the game scripts.
