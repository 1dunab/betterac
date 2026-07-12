# Game Developer Guide

Every game is a self-contained folder under `public/games/<key>/`. The shell (lobby,
players, settings, message routing) is already built — you write three small files and
your game shows up in the lobby picker.

**Fastest start:** copy [`_template/`](_template/) to `public/games/<yourkey>/`, rename the
key inside the three files, wire it up (step 4 below), and you have a working game to
mutate. The template is a complete, commented mini-game.

---

## 1. Anatomy of a game

```
public/games/meingame/
├── meta.js         ← shared metadata: key, label, min players, settings schema
├── screen.js       ← TV logic: simulation, rendering, scoring
├── controller.js   ← phone UI: injects its views, sends inputs
└── (assets.js)     ← optional data files (see geoguess/mapdata.js)
```

Why three files? The **screen page only loads `screen.js`**, the **controller page only
loads `controller.js`** — but both load `meta.js`, so label/min/settings live in exactly
one place. `registerGame()` merges all three registrations by `key`:

```js
// meta.js — loaded by BOTH pages
registerGame({ key: 'meingame', label: '🎮 Mein Spiel', min: 2, settings: { /* see §5 */ } });

// screen.js — factory returning a fresh game instance per round
registerGame({ key: 'meingame', screen: function () { return { start() {}, /* §3 */ }; } });

// controller.js — singleton with activate/onMessage
registerGame({ key: 'meingame', controller: { activate() {}, onMessage(d) {} } });
```

## 2. Wiring it up

Add script tags to **both** HTML files at the marked spot (`▼ Register new games here`):

```html
<!-- public/screen.html -->
<script src="games/meingame/meta.js"></script>
<script src="games/meingame/screen.js"></script>

<!-- public/controller.html -->
<script src="games/meingame/meta.js"></script>
<script src="games/meingame/controller.js"></script>
```

⚠️ Use exactly this one-line `<script src="..."></script>` form — the JSDOM test runner
inlines scripts with a regex that expects it.

## 3. The screen module — lifecycle contract

`screen` is a **factory**: it's called once per game start and returns an instance:

```js
registerGame({ key: 'meingame', screen: function () {
  let state;                       // your per-round state lives in this closure
  return {
    acceptsJoin: false,            // true = players joining mid-game call onConnect(id)
                                   // and enter the game; false = they spectate
    start(ids, cfg) {},            // ids: sorted array of player device-ids
                                   // cfg: current settings values (see §5)
    stop() {},                     // host aborted — clear timers, DOM, etc.
    onMessage(id, d) {},           // message d from player id (your own t-types)
    onDisconnect(id) {},           // REQUIRED in spirit: remove the player, end the
                                   // round if too few remain (call endToLobby(msg))
    render() {},                   // called every animation frame — simulate + draw
    canSave() {}, save() {},       // optional: enables the 💾 button (see drawing/)
    _debug() { return state; }     // optional but recommended: powers dev harness bots
  };
}});
```

There is **no separate tick loop** — do your simulation inside `render()` using
`performance.now()` deltas (clamp dt: `Math.min(0.05, (now - lastT) / 1000)`).

### Shell API available in screen.js (globals)

| Global | What it is |
|---|---|
| `cv`, `ctx` | the shared 960×600 canvas + 2D context (CSS scales it to the window) |
| `ac` | the AirConsole shim: `ac.message(id, data)` sends to one phone |
| `players` | `{ id: { color, name, named } }` for connected players |
| `nameOf(id)`, `shortName(id)` | display names (short = max 9 chars) |
| `hostId()` | current host's id — gate host-only actions (`rematch`, `reveal`, …) |
| `clamp(v, lo, hi)`, `shuffle(arr)` | the obvious helpers |
| `setBanner(text, ms)` | overlay banner drawn by the shell (works even in lobby) |
| `endToLobby(msg)` | end the game and return everyone to the lobby |
| `rr(ctx, x, y, w, h, r)` | rounded-rect path helper |
| `fitFont(ctx, text, maxWidth, startPx)` | shrink font until text fits |
| `drawStrokesOn(ctx, strokes, x, y, w, h)` | render normalized drawing strokes |
| `sfx(name)`, `sfx.ambient(name)` | sound engine — see the palette below |
| `GAME_META` | all registered metadata (rarely needed) |

### Sound palette (`core/sfx.js`)

Everything is synthesized in WebAudio — no audio files, no assets to license. Call
`sfx('name')` from `screen.js` whenever something happens; it is a silent no-op until
the browser allows audio (first click/keypress on the screen page) and when muted
(🔊 button, persisted). One-shots:

| Name | Character | Typical use |
|---|---|---|
| `pop` | soft blip | player joins, UI feedback |
| `tick` | tiny click | selection, menu |
| `beep` | short mid beep | countdown steps |
| `go` | bright long beep | round start signal |
| `coin` | two rising notes | point scored, success |
| `powerup` | rising sweep | pickup collected |
| `buzz` | low rasp | wrong answer, false start |
| `hit` | short noise snap | small impact |
| `thud` | dull low punch | body hit, landing |
| `splash` | watery noise | water contact |
| `whoosh` | filtered sweep | launch, dash, game start |
| `explosion` | big noise + sub drop | the big one |
| `fanfare` | 4-note arpeggio | winner screen |
| `sad` | descending notes | defeat, elimination |

Ambient loops run until replaced or the game ends (the shell calls `sfx.ambient(null)`
in `endToLobby`): `sfx.ambient('wind' | 'drone' | 'space' | 'rain')`. Start one in your
`start()` if it fits the mood — Sintflut uses `wind`, Boss Raid `drone`, Space Arena
`space`. Keep it subtle; ambients are quiet by design.

Needing WebGL? See `racer/screen.js`: it creates its own canvas + 2D HUD overlay that
replace `cv` during the game (`window.THREE` is provided by the vendored three.js) and
falls back to the lobby when WebGL is unavailable. Force `background: transparent` on
overlay canvases — the page's global `canvas` CSS rule would otherwise cover your scene.

## 4. The controller module — phone UI

The controller **injects its own views** — `controller.html` only contains the shell views:

```js
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  /* game-specific CSS here — generic classes (.view .bar .btn .center .muted
     .big .timer .tools .modes .modebtn .step) come from the shell */
</style>
<div id="v-meingame" class="view">
  <div class="bar"><span class="word">🎮 Mein Spiel</span></div>
  <div class="center"><button id="mg-go" class="btn go">LOS!</button></div>
</div>`);
  VIEWS.push('meingame');

  $('mg-go').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'mgGo' }));

  registerGame({ key: 'meingame', controller: {
    activate() { showView('meingame'); },   // game started — reset local state here!
    onMessage(d) { /* messages from the screen */ }
  }});
})();
```

### Shell API available in controller.js (globals)

| Global | What it is |
|---|---|
| `ac`, `AirConsole.SCREEN` | `ac.message(AirConsole.SCREEN, {t: '...'})` sends to the TV |
| `$` | `document.getElementById` shorthand |
| `VIEWS`, `showView(key)` | view registry — push your view keys, switch with showView |
| `myHost`, `updateAbort()` | if the screen tells you `host: true`, set `myHost = d.host; updateAbort();` so the ✕ abort button appears |
| `startTimer(ms, el, cb)`, `stopTimer()` | shared countdown (renders seconds into `el`, calls `cb` at zero) |

Touch tips: always `e.preventDefault()` in touch handlers; bind `touchstart/touchend/
touchcancel` *and* `mousedown/mouseup` (desktop testing); `navigator.vibrate` (in a
try/catch — iOS doesn't have it) makes buttons feel great.

## 5. Declarative settings

Declare settings in `meta.js`; the shell renders the host's settings UI, clamps incoming
values, echoes them to the lobby summary, and hands them to `screen.start(ids, cfg)`:

```js
settings: {
  rounds:  { label: 'Runden', type: 'number', default: 5, min: 3, max: 12, step: 1 },
  mode:    { label: 'Modus', type: 'choice', default: 'easy',
             options: [{ v: 'easy', label: 'Leicht' }, { v: 'hard', label: 'Schwer' }] },
  words:   { label: 'Eigene Wörter', type: 'text', default: '', max: 90 },
  seconds: { label: 'Zeit', type: 'number', default: 30, min: 10, max: 90, step: 5, unit: 's' }
}
```

Games never build settings UI themselves.

## 6. Messaging

Everything rides on small JSON objects with a `t` type field.

- **Prefix your types with your game key** (`mgGo`, `mgState`, …). Names starting with
  `shell` are reserved for the shell.
- The screen receives `(id, data)` in `onMessage`; **always validate**: is `id` a current
  player? Is it their turn? Is the value in range? Phones are friends, but bugs aren't.
- **Race pitfall:** the message bus can be synchronous in tests. On the controller,
  switch views *before* sending a message whose reply switches views again — otherwise
  your `showView` overwrites the reply's view.
- Throttle high-frequency state (ranks, tank meters) to ~2–4 messages/sec per player.
- Analog inputs: send on change with a small epsilon + ~50ms min interval
  (see `bossraid/controller.js` for a full-surface analog pad).

## 7. Conventions (what makes it feel like Party Hub)

- **German UI with emoji** on screen and phone (`'💀 ' + nameOf(id) + ' wurde zerstört!'`).
  Docs and code comments may be English; player-facing text is German.
- Rounds are **2–6 minutes**. Nobody sits out: eliminated players get ghost roles,
  spectate modes, or fast respawns.
- End screens offer a **host rematch button** (`{t:'mgAgain'}` gated on `hostId()`)
  instead of dumping everyone to the lobby.
- `min` players in meta gates the START button; still call `endToLobby()` from
  `onDisconnect` when the game becomes unplayable.
- Visual kit that ships in most games and is easy to copy: cached radial-gradient glow
  sprites + `'lighter'` compositing for particles, screen shake, announcement texts.
  Steal from `spacearena/screen.js` or `sintflut/screen.js`.

## 8. The dev harness (`public/dev-<key>.html`)

Every game ships a standalone page that runs it without lobby or phones: shell globals
are stubbed, bots send inputs, and `performance.now()` can be replaced by a fake clock
driven in a tight loop — so `?sim=60000` renders "one minute into the game" synchronously.
Copy `_template/dev.html`, adapt the bots, then screenshot headlessly:

```bash
PORT=3995 node server.js &
firefox --headless --no-remote --profile /tmp/ffp --window-size=980,620 \
  --screenshot out.png "http://localhost:3995/dev-meingame.html?sim=30000"
```

This is how every screenshot in the README was made, and it's the fastest way to tune
balance without four phones on your desk.

## 9. Tests

`npm test` boots the real `screen.html` + `controller.html` in JSDOM against an
in-process bus (`test-helpers.js`) and plays full rounds of several games. Your game
must not break these (loading errors in your files fail every test). If your game logic
is deterministic, add a `test-<key>.js` following `test-categories.js` and chain it in
`package.json`.

## 10. Checklist before you open a PR

- [ ] `meta.js` / `screen.js` / `controller.js` registered under one unique key
- [ ] Script tags added to **both** HTMLs at the marker, exact one-line format
- [ ] `onDisconnect` handled; `stop()` clears any timers
- [ ] Settings (if any) declared in meta — no hand-rolled settings UI
- [ ] German UI strings, host rematch on the end screen
- [ ] `dev-<key>.html` harness with at least dumb bots
- [ ] `npm test` green
- [ ] A screenshot from your harness in the PR description
