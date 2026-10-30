# ⚡ Neonspur — design notes

An original 3D light-cycle game in the classic light-wall genre: 1–4 riders (phones +
bots) race over a square arena, pull a wall of light behind them, steer in 90° steps and
**jump** over walls, blocks and onto raised terraces. Last rider standing wins the round;
first to *N* round wins takes the match. The TV shows one 3D view per human (split-screen)
or a shared overview; phones are the controllers.

This file is the **contract** between the modules. If you change a shape or a rule here,
change it in the code and in the tests too.

## Files

| File | Loaded by | Owns |
|---|---|---|
| `public/games/neonspur/meta.js` | screen + controller | key, label, settings |
| `public/games/neonspur/maps.js` | screen (+ Node tests) | arena definitions → `window.NeonspurMaps` |
| `public/games/neonspur/sim.js` | screen (+ Node tests) | rules, collision, bots → `window.NeonspurSim` |
| `public/games/neonspur/render.js` | screen | three.js scene + cameras → `window.NeonspurView` |
| `public/games/neonspur/screen.js` | screen | glue: lifecycle, round flow, HUD, blit, phone protocol |
| `public/games/neonspur/controller.js` | controller | phone UI |
| `public/dev-neonspur.html` | — | full TV harness (real sim + render + glue, bots) |
| `public/dev-neonspur-view.html` | — | renderer-only preview with a scripted fake state |
| `test-neonspur.js` | Node | rule tests against `sim.js` + `maps.js` |
| `test-neonspur-flow.js` | Node/JSDOM | screen + phones end-to-end with a stub view |

`maps.js` and `sim.js` are plain scripts that also work under Node:

```js
(function (root) {
  const api = { /* … */ };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.NeonspurSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

`sim.js` must be **deterministic**: no `Math.random`, no `Date`, no `performance.now` —
only its seeded RNG and its own tick counter.

## Coordinates

- The arena is a grid of `w × h` cells, cell `(x, y)`, index `i = y * w + x`.
- Directions: `0 = +x (east)`, `1 = +y (south)`, `2 = −x (west)`, `3 = −y (north)`.
  `DX = [1, 0, -1, 0]`, `DY = [0, 1, 0, -1]`. Right turn `R: dir → (dir + 1) % 4`,
  left turn `L: dir → (dir + 3) % 4`.
- three.js world: **X = x + 0.5, Z = y + 0.5, Y = height**, 1 cell = 1 unit, Y up.
  A rider facing +X has +Z on its right, which matches `R = dir + 1`.
  Yaw for a direction (rotation about +Y so that the object's local −Z points along the
  direction): `yaw = [-Math.PI / 2, Math.PI, Math.PI / 2, 0][dir]`.

## Rules

### Movement and walls
- Every tick each living rider moves exactly one cell in its direction.
- Steering is relative: `L` / `R` turn by 90°. Each rider has an input queue of at most
  2 turns; one queued turn is applied per tick, right before the move. A quick double tap
  is therefore a U-turn one lane over (that is how you go "back"). Turns also work in the
  air.
- When a rider **enters a cell while grounded**, that cell gets a light wall owned by the
  rider: base = the cell's floor height, top = base + `TRAIL_H`. The spawn cell gets a
  wall at round start. While airborne no wall is laid → a gap in the wall.
- Every wall kills, **including your own**.

### Heights
- Each cell has a floor height: `0` (ground), `0.5` (ramp), `1` (raised terrace), or is a
  solid **wall block** (top `WALL_H = 3`, never drivable, never jumpable).
- Grounded move from cell A to B (floor `fa`, `fb`):
  - `fb − fa > 0.5` → crash (you hit the side of a terrace).
  - `|fb − fa| ≤ 0.5` → fine, **except** a ramp may only be entered or left along its
    axis (its direction or the opposite); any other entry/exit → crash.
  - `fb − fa ≤ −1` → **drop**: you drive off the edge and land on B immediately (event
    `drop`); B gets a wall at its floor height. The renderer animates the fall from
    `palt` to `alt`.
- Ramps: `floor = 0.5`, with a direction `rampDir` = the direction in which it rises
  (ground side → terrace side).
- Jump pads: floor `0` (or `1` on a terrace); entering one grounded (driving, dropping or
  landing on it) triggers a free jump (does not touch the cooldown). The `jump` event
  (`pad: true`) is emitted on entering the pad; the flight itself starts with the next move.

### Jump
- Input `J`: allowed when grounded and `time >= jumpReadyAt`. The jump starts with the
  next move (checked and the `jump` event emitted then; a `J` that is not allowed at that
  tick is dropped, not buffered). Cooldown `JUMP_CD_MS` (sim time) counted from takeoff.
- `base` = floor at takeoff. After `k` cells in the air the altitude is
  `alt(k) = base + JUMP_H · 4 · (k / JUMP_LEN) · (1 − k / JUMP_LEN)` (the parabola keeps
  going below `base` for `k > JUMP_LEN`). With `JUMP_LEN = 4`, `JUMP_H = 1.6`:
  `alt = base + 1.2, 1.6, 1.2, 0, −2, …`.
- Entering cell `c` at altitude `a = alt(k)`:
  - wall block (`a < WALL_H`) → crash; out of bounds → crash.
  - another rider's or your own light wall in `c` with `a < floor(c) + TRAIL_H` → crash.
  - `a ≤ floor(c)` → **landing**: if `alt(k − 1) ≥ floor(c) − 0.01` land on `c` at
    `floor(c)` (it gets a wall, a new wall run starts, event `land`); otherwise crash
    (you hit the side of a terrace). A landing ramp must be entered along its axis, like
    on the ground.
  - otherwise keep flying.
- So a jump clears a wall right in front of you, gets you from the ground onto a terrace
  (land on it at `k = 4`), and off a terrace you fly 5 cells.

### Collisions between riders
- All riders move simultaneously. Walls laid in this tick only matter for riders entering
  the same cell this tick.
- Two or more riders entering the same cell in the same tick with
  `|alt difference| < TRAIL_H` → all of them crash (`by: 'head'`). Swapping cells head-on
  kills both (each runs into the other's wall).

### Speed and round end
- Speed (cells/s) starts at the tempo's `start`, grows by `accel` per sim second, capped
  at `max`; `tickMs = 1000 / speed`.

  | tempo | start | accel | max |
  |---|---|---|---|
  | `chill` | 5.5 | 0.06 | 9 |
  | `normal` | 7 | 0.10 | 12 |
  | `fast` | 9 | 0.14 | 15 |

  (Phase 2: one `step()` is a **subtick** — see "Phase 2" below.)
- Dead riders' walls stay. A crash keeps the rider in the cell it crashed into (`x, y` of
  the `crash` event); for `'edge'` (out of bounds) it stays on its last cell. Hitting a
  terrace side, ramp side or wall block gives `by: 'wall'`. Inputs are ignored for bots.
  `step()` after the round is over returns `[]`. `sim.jumpPath(pid, dir?)` returns the
  cells/altitudes a jump would pass (`{ landed, cells, end }`).
- Round ends when ≤ 1 rider is alive: `winner` = the survivor's pid, or `null` for a
  draw (last riders died in the same tick).

All tunables are named constants at the top of `sim.js` and exported as
`NeonspurSim.CONST` (`TRAIL_H = 0.8`, `JUMP_H = 1.6`, `JUMP_LEN = 4`,
`JUMP_CD_MS = 2500`, `WALL_H = 3`, `TEMPO`).

### Bots
Bots live in `sim.js`, run once per tick before the move, and use only the seeded RNG.
`botLevel` is `'easy' | 'normal' | 'hard'`: easy looks ahead a few cells and
occasionally reacts late; normal compares straight/left/right by reachable area (bounded
flood fill); hard also avoids cells next to other riders' heads and uses jumps
deliberately (escape a dead end, cross a wall into open space, climb terraces).

## Maps (`maps.js`)

```js
window.NeonspurMaps = [
  { key: 'raster', label: 'Raster',
    theme: { floor: '#05060f', grid: '#1b2a6b', wall: '#0b0f24', edge: '#3d6bff', raised: '#0a1030', sky: '#020208' },
    rows: [ '########…', '#.......…', … ],   // h strings of w chars
    spawns: [ { x, y, dir }, { x, y, dir }, { x, y, dir }, { x, y, dir } ] },
  …
];
```

Legend: `.` ground · `#` wall block · `=` terrace (floor 1) · `>` `v` `<` `^` ramp
rising east / south / west / north · `*` jump pad on the ground · `+` jump pad on a
terrace. Spawns are ordered so that riders 0 and 1 face each other on one axis and 2 and
3 on the other; a 2-rider round uses spawns 0 and 1.

Arenas: **Raster** (classic, open, 44×44), **Säulenhalle** (high pillars, low terraces to
hop onto, jump pads, 48×48), **Terrassen** (a central raised plateau with ramps and pads,
side terraces, 52×52).

## Sim API (`sim.js`)

```js
NeonspurSim.CONST                       // tunables (see above)
NeonspurSim.parseMap(def) → map
NeonspurSim.create({ map, riders: [{ pid, bot, botLevel }], tempo, seed, extras }) → sim   // extras default true
sim.input(pid, 'L' | 'R' | 'J' | 'B+' | 'B-')   // ignored for dead / unknown riders and for bots
sim.kill(pid) → events[]                // player left mid-round: crash in place (by: 'left'), may end the round
sim.step() → events[]                   // advance one subtick (see Phase 2)
sim.tickMs                              // current subtick length in ms = 1000 / (2 · speed), updates with speed
sim.jumpPath(pid, dir?) → { landed, cells, end } | null
sim.probe(pid, dir) → { ok, by } | null // would the rider's next grounded move in absolute `dir` be safe?
                                        // same rules as a real move; ignores other riders' simultaneous moves and a held shield
sim.state                               // live object, read-only for everyone else
```

Parsed map:

```js
{ key, label, w, h, theme,
  floor:   Float32Array(w*h),   // 0 | 0.5 | 1 (meaningless on wall blocks)
  wall:    Uint8Array(w*h),     // 1 = wall block (top WALL_H)
  rampDir: Int8Array(w*h),      // −1 or 0..3
  pad:     Uint8Array(w*h),     // 1 = jump pad
  spawns:  [{ x, y, dir }] }
```

State:

```js
{ map, tick, time,              // time = sim ms (sum of tick lengths)
  speed, over, winner,          // winner: pid | null (draw); only meaningful when over
  riders: [{
    pid, slot, bot, alive,
    x, y, dir, alt,             // after the last step (alt = absolute height)
    px, py, pdir, palt,         // before the last step — render interpolates p* → current
    air,                        // true while airborne
    jumpReadyAt,                // sim ms
    trail: [[x, y, h, brk], …], // one entry per walled cell, in order; h = wall base;
                                // brk = 1 → this point starts a new wall run (after a gap)
    deadAt,                     // tick of death or null
    killer                      // pid | 'self' | 'wall' | 'edge' | 'head' | 'left' | null
  }] }
```

Consecutive trail points without `brk` are adjacent cells; their heights may differ
(ramps, drops) — the renderer connects them with a slanted piece.

Events returned by `step()`:

```js
{ t: 'turn',  pid, dir }
{ t: 'jump',  pid, pad }         // pad: true for jump pads
{ t: 'land',  pid }
{ t: 'drop',  pid }
{ t: 'crash', pid, x, y, alt, by }   // by: pid | 'self' | 'wall' | 'edge' | 'head' | 'left'
{ t: 'over',  winner }               // pid | null
```

## Renderer API (`render.js`)

```js
const view = new NeonspurView(THREE, { width: 960, height: 600, quality: 'high' }); // throws without WebGL
view.canvas                    // its WebGL canvas (preserveDrawingBuffer: true), not in the DOM
view.setRound(state, look)     // look = { [pid]: { color: '#rrggbb', name } } — builds the arena, resets walls
view.event(ev, state)          // sim events → effects (crash burst, jump flash, landing ring)
view.render(state, alpha, opts)
  // alpha 0..1 = interpolation between p* and the current values
  // opts = { layout: 'split' | 'overview', views: [{ pid, cam: 'pov' | 'chase' }], now }
  // 'split' renders one viewport per entry in views; 'overview' one shared camera
NeonspurView.layout(n, layout) → [{ x, y, w, h }]   // viewport rects in canvas px, top-left origin
view.setQuality('high' | 'low')  // switch at any time; 'high' is the default
view.dispose()
view.drawCalls                 // draw calls of the last render() call (all viewports)
```

`NeonspurView.layout(n, layout, W = 960, H = 600)` returns rects in order: 1 → `[full]`; 2 → `[top, bottom]`;
3 and 4 → 2×2 row-major `[TL, TR, BL, BR]`. **`layout(3)` returns 4 rects**; rect index 3 (BR) is the
overview. `layout === 'overview'` → `[full]` (then `opts.views` is ignored). In `render`, `views[i]` is drawn into
`rects[i]`; a missing view (the 4th with 3 views) gets the overview camera. A view whose pid has no rider also
falls back to the overview. Viewports are inset by 1 px for a thin dark gap. `cam: 'pov'` hides the viewer's own bike.

**Quality.** `'high'` renders all viewports into one full-size MSAA render target (half-float if
the GPU can) and composites bloom once over the whole canvas (bright pass, half- and quarter-res
Gaussian blur), draws the star/nebula sky, the glossy floor (translucent floor over mirrored light
walls, bikes and neon rims) and the extra effects. `'low'` = no bloom render targets, no
reflections (opaque floor), no nebula, fewer stars/particles/item layers — for weak TV browsers.
`render()` also reads Phase 2 state per rider (`mp`/`ms` for the move progress `a`, `trailRev`,
`boosting`, `grind`, `shield`) and `state.items`; missing fields fall back to the Phase 1 behaviour.
Events used for effects: `crash jump land drop boost itemSpawn item shield blast`. Everything is
animated from `opts.now`. `drawCalls` includes the bloom passes.

Split layouts: 1 view = full screen; 2 = stacked top/bottom (960×300 each, wide like a
racing view); 3–4 = 2×2. With 3 views the 4th quadrant shows the overview camera. The
renderer only draws 3D; names, scores and the minimap are the glue's HUD.

**Headless note:** in headless Firefox a WebGL canvas in the DOM does not show up in
screenshots, but `ctx.drawImage(webglCanvas, …)` into a 2D canvas does (needs
`preserveDrawingBuffer: true`). That is why the glue blits `view.canvas` into the
shell's `cv` every frame — which also makes 👀 Mitschauen work (it mirrors `cv`).

## Glue (`screen.js`)

- `start(ids, cfg)`: the first 4 ids ride, the rest spectate. Bots =
  `min(cfg.bots, 4 − humans)`, raised so that humans + bots ≥ 2. Bot pids are negative
  (`-1, -2, …`) with fixed neon colours and names (`🤖 Volt`, `🤖 Pixel`, `🤖 Blitz`).
- No WebGL (`!window.THREE || !window.NeonspurView`, or the constructor throws) →
  `endToLobby('⚡ Neonspur braucht einen Browser mit WebGL.')`.
- Per round: `countdown` (3 s, sim frozen) → `live` → `roundOver` (3 s, banner) → next
  round, or `final` (standings, `reportWinners` with the human champion, host rematch).
- In `render()`: accumulate `dt`, `while (acc >= sim.tickMs) step()`, feed events to the
  view, `sfx`, and the phones; `alpha = acc / sim.tickMs`; `view.render(…)`;
  `ctx.drawImage(view.canvas, 0, 0)`; then draw the HUD on `ctx`.
- Late joiners (`acceptsJoin: true`) take a free seat at the next round, replacing a bot
  if needed; with 4 humans they spectate. A human leaving mid-round crashes out; no humans
  left → `endToLobby`.
- Dead humans' viewports follow a living rider (their killer if alive).

## Phone protocol

Phone → screen:

| Message | Meaning |
|---|---|
| `{ t: 'nsTurn', d: 'L' \| 'R' }` | turn |
| `{ t: 'nsJump' }` | jump |
| `{ t: 'nsCam' }` | toggle own camera `pov` ↔ `chase` |
| `{ t: 'nsAgain' }` | host only, on the final screen: rematch |

Screen → phone:

| Message | Meaning |
|---|---|
| `{ t: 'nsInfo', rider, color, cam, camToggle, host, target }` | on start, on joining a seat, on host change. `rider: false` = spectator; `camToggle: false` when the TV uses the overview camera (phone hides 🎥) |
| `{ t: 'nsPhase', phase, n, round, wins, winner, champion, host }` | phase = `countdown` (n = 3, 2, 1) / `live` / `roundOver` / `final`; `wins` = own round wins; `winner` / `champion` = display names or null |
| `{ t: 'nsYou', alive, jumpIn, killer }` | `jumpIn` = ms until the jump is ready (0 = ready); `killer` = display name or null. Sent at round start, on jump, when the cooldown ends, on death |
| `{ t: 'nsCamIs', cam }` | reply to `nsCam` |

## Settings (`meta.js`)

Arena (Raster / Säulenhalle / Terrassen / Zufall), Bots (0–3), Bot-Stärke, Tempo,
Rundensiege (1–9), Fernseher (Split-Screen / Übersicht). `min: 1` — solo play gets at
least one bot.

## Phase 2 — Turbo, Extras, difficulty, look

Phase 2 extends the contract above; where it says otherwise, this section wins.

### Subticks (needed for Turbo)
- `sim.step()` advances one **subtick**; `sim.tickMs = 1000 / (speed · 2)`. Riders move
  on subticks: each rider has a move period `mp` in subticks (`2` normally, `1` while
  boosting) and a counter `ms` (subticks since its last move). Per subtick every living
  rider does `ms++`; if `ms >= mp` it moves (`ms = 0`). So normal riders still move
  `speed` cells/s and boosting riders twice as fast. All rules (turn queue, jump arc
  per *move*, walls, collisions) apply per move; collisions are resolved among the riders
  moving in that subtick (a rider that does not move this subtick still has a wall in its
  head cell). When `mp` changes, keep the displayed position continuous (e.g. rescale
  `ms`), no visible hitch.
- `p*` (`px, py, pdir, palt`) now mean "before this rider's **last move**" and are only
  updated when the rider moves. Per-rider render progress:
  `a = min(1, (r.ms + alpha) / r.mp)` with `alpha` = the global subtick interpolation.
- Turns are applied right before a rider's move (not every subtick). `state.tick` counts
  subticks; `deadAt` is a subtick.

### Turbo
- Meter `r.boost` in 0..1. **Grinding** charges it: after a grounded move, each side cell
  (left/right of the new cell, relative to `dir`) holding a light wall (any owner) or a
  wall block adds `BOOST_GAIN = 0.04`. `r.grind` = bitmask of the grinding sides
  (1 = left, 2 = right, 0 = none) of the last move.
- Input `B+` / `B-` (hold): while held and `boost > 0`, `mp = 1`; each boosted move
  costs `BOOST_USE = 0.07`. `r.boosting` mirrors the state; event
  `{ t: 'boost', pid, on }` when it toggles. Works in the air too.
- With `extras: false` there is no Turbo (no gain, `B±` ignored).

### Extras (power-ups)
- `state.items = [{ id, kind, x, y, h }]` (`h` = floor height). Every `ITEM_EVERY_MS =
  6000` sim ms, if fewer than `ITEM_MAX = 3` items exist, one spawns (seeded) on a free
  ground/terrace cell: no wall block, no light wall, no ramp or pad, at least 4 cells away
  from every living rider's head. Event `{ t: 'itemSpawn', id, kind, x, y, h }`.
- A rider **entering** an item's cell grounded, or airborne with
  `alt < h + TRAIL_H`, collects it: event `{ t: 'item', pid, kind, id, x, y }`.
- Kinds:
  - `'boost'` 🔋 Turbo-Akku: `boost = 1`.
  - `'jump'` 🦘 Sprungfeder: jump cooldown reset (`jumpReadyAt = time`).
  - `'shield'` 🛡️ Schild: `r.shield = true` until used or round end. The next crash into
    a **light wall** is survived: the rider drives through, that wall cell is erased,
    event `{ t: 'shield', pid, x, y }`. No protection against wall blocks, terrace
    sides, the arena edge or same-cell/head-on collisions.
  - `'blast'` 💥 Schockwelle: erases every light wall cell within Chebyshev radius
    `BLAST_R = 3` of the rider, except cells under living riders' heads. Event
    `{ t: 'blast', pid, x, y, r }`.
- **Erasing walls:** erased points are removed from their owner's `trail` array, the
  point after a removed one gets `brk = 1`, and the owner's `trailRev` (integer, starts
  at 0) is incremented. The renderer rebuilds a rider's wall when `trailRev` changes and
  otherwise appends incrementally as before.
- With `extras: false` no items spawn.

### State / API additions
- `NeonspurSim.create({ …, extras })` (default `true`); `sim.input(pid, 'B+' | 'B-')`.
- Rider fields: `mp, ms, boost, boosting, grind, shield, trailRev`. State: `items`,
  `extras`.
- New constants in `CONST`: `BOOST_GAIN, BOOST_USE, ITEM_EVERY_MS, ITEM_MAX, BLAST_R`.

### Difficulty
Playtest feedback: a first-time player lost every round, even against Leicht. Targets,
measured in `test-neonspur.js` with a fixed **novice proxy** policy (see the test) in 1v1
on Raster, normal tempo, 200 rounds: novice beats `easy` in ≥ 55 % of the decided rounds,
beats `normal` in 25–45 %, `hard` beats the novice in ≥ 85 %. Easy bots never boost,
never jump on purpose and don't chase items; normal bots boost/jump only to escape and
take items that are close and safe; hard bots use everything.

### Look ("spacier, more neon-glossy")
- Bloom (bright-pass + blurred glow composited once over the whole canvas, built from
  three core: render targets + shader passes; no addons), a space sky (gradient, twinkling
  starfield, nebula), glossy floor with mirrored light-wall reflections, hotter walls
  (white-hot core / saturated body / soft halo).
- Renderer option `new NeonspurView(THREE, { width, height, quality })` with `quality`
  `'high' | 'low'` (low = no bloom, no reflections, fewer particles) and
  `view.setQuality(q)`.
- Phase 2 visuals: per-rider progress `a` (above), wall rebuild on `trailRev`, floating
  holo items per kind with a light beam, pickup burst, shield bubble while `r.shield`,
  shield-break flash, blast shockwave ring, boost exhaust + wider glow + FOV kick for the
  boosting rider's own views, grind sparks on `r.grind` sides.

### Glue / phone additions
- Settings: `extras` (Extras & Turbo: An / Aus, default An), `quality` (Grafik: Voll /
  Sparsam, default Voll).
- Phone → screen: `{ t: 'nsBoost', on }` (hold TURBO).
- Screen → phone: `nsYou` gains `boost` (0..1) and `shield` (bool); boost level is sent
  when it changed by ≥ 0.05, at most ~6×/s per phone. `{ t: 'nsItem', kind }` on pickup
  (toast). `nsInfo` gains `extras` (phone hides TURBO when false).
- HUD: Turbo meter per viewport, item pickups in a small feed.

### Phase 2 implementation notes (interpretations)
- A rider starts with `ms = 0`, so the first move happens on subtick 2. `mp` changes only
  right after a move (`ms = 0`), so there is no hitch; pressing `B+` therefore takes effect
  after the rider's next move. A move made while `boosting` costs `BOOST_USE`; the move that
  switches boosting on is not charged. The boost event is emitted after that move.
- Bots think only on subticks where they move (`ms + 1 >= mp` before the step).
- Item pickup is instant (blast fires on pickup); pickups are handled in rider order, so a
  blast erases walls as they are at that moment (a rider processed later in the same subtick
  still lays its wall afterwards).
- Items are seeded by an RNG separate from the bots', so the item layout does not depend on
  bot choices. Distance to heads is Chebyshev ≥ 4. Shield does not pass through a wall that is
  a living rider's head cell.
- Bot levels (Phase 2): easy = 2 cells of sight, 50 % late reaction, 10 % random wandering,
  random side, never boosts/jumps/fetches items. normal = flood fill, 45 % chance to miss a
  light wall straight ahead (never architecture), boosts only when boxed in, small item pull
  (radius 5). hard = as before plus item pull (radius 12, stronger for blast when boxed in),
  boosts to reach items or to close in on an enemy.

## Later ideas

Fading walls / shrinking arena, more arenas.
