# 🏰 Furt & Fehde — design notes

> **Status:** Phases 0, 1 and 1b are built (2026-10-31 → 2026-11-10). This file is the module
> contract; the "Implementation notes" at the end record what was really built and win over the
> older text. Phase 2 is being planned.

A competitive castle-building strategy game for Party Hub on one shared map. 2–4 lords each
own one quarter of a river valley. They farm, store grain, cut wood, quarry stone, build a
barracks and send banners of soldiers across fords and bridges at their neighbours. The
**TV** shows the whole valley as one living 3D diorama in the Skyfarers style. Every **phone**
is its lord's war table: a painted parchment map for placing buildings on a free grid,
recruiting troops and dragging banners.

> Player-facing text is German with emoji. Docs and code comments are English.

## Decisions (planning session 2026-10-31)

| Topic | Decision |
|---|---|
| Name | **🏰 Furt & Fehde**, key `furtfehde`, message prefix `ff`, browser globals `Furt*` |
| Genre | an original castle-building RTS: own rules, units and names. Inspired by the genre, not a remake of any existing game |
| Rendering | three.js 3D (vendored r185), stylized low-poly like Skyfarers, one fixed camera that always shows the whole map |
| Screen device | a PC or the Samsung M7 browser → quality **Auto / Voll / Sparsam** |
| Players | up to 4 lords (houses); bots fill empty houses; with 5–8 players, two phones share a house (both with full control) |
| Control | the phone is a **war table** (2D map, free building grid, banner drag). No cursor on the TV |
| Building | **free grid** inside the lord's own quarter |
| Economy | **real carrying**: every unit of goods is carried by a peasant from the producer to a store (one step). Longer chains (mill → bakery, smithy) come in Phase 2 |
| Win | setting **Modus**: *Ruhm-Rennen* (Phase 1 default: timer, nobody is eliminated) and *Eroberung* (Phase 2: fallen lords ride on as robber knights, the last keep standing wins) |
| Match length | host setting, default 12 min, adjustable |
| Extras | pacts, a bounty on the leader, fire with torch-bearers (Phase 1); custom coat of arms later. No Werder score zone, no chronicle |
| Process | Phase 0 first (look, map, phone prototype), then plan further |

## Phases

| Phase | Content | Ends with |
|---|---|---|
| **0 Diorama** ✅ | map generator, 3D landscape with river, fords and flood, all Phase 1 models, view v0 with a scripted fake state, phone war-table prototype | 🚦 feedback 1: look on the TV, the map, phone handling, M7 bench |
| **1 Erste Fehde** ✅ | sim (carrying economy, 10 buildings, 5 unit kinds, banners, combat, fire, flood truce, bounty, pacts), bots, glue, HUD, sound, fx | 🚦 feedback 2: a real match with phones |
| **1b Nachschliff** ✅ | feedback 2: no dead end, farmers stay on the fields, pause, Burgbrunnen, building info, guide and advisor on the phone, troop sending, calmer Auto quality and TV sound | 🚦 feedback 3: the next test round |
| **2 Mauern & Söldner** 🔨 | palisades, stone walls and gatehouses with a Wehrgang (garrisoned archers); the Rammbock, and troops that breach walls; a Markt with 💰 gold; the Söldnerlager with torch-bearers and horse archers | playtest |
| **2b Jahreszeiten & Eroberung** | Eroberung mode with robber knights; seasons (spring flood, harvest, frozen river); burnable bridges; catapult; mill, bakery, smithy; herald voice; music | playtest |
| **3 Großer Fehdenabend** | alliances and 2v2, lord and marshal roles, more map types, events, coat-of-arms editor, photo mode | — |

## The valley ("Flusskreuz")

```
[NW]   ,,,,,          ::                            ,,,,,   [NO]
       ,,,,,  ^^^     == Steg               ^^^     ,,,,,
              ^^^     ::                    ^^^
     Aue         Furt oo                               Aue
~~~~~~~~~~ooo~~~~~~~~~~~~~~~~||~~~~~~~~~~~~~~~~~~~ooo~~~~~~~~~~~
~~ Fluss ~ooo~~~~~~~~~~~~ [Werder] ~~~~~~~~~~~~~~~ooo~~~~~~~~~~~
~~~~~~~~~~ooo~~~~~~~~~~~~~~~~||~~~~~~~~~~~~~~~~~~~ooo~~~~~~~~~~~
     Aue                             oo Furt           Aue
               ^^^                   ::      ^^^
       ,,,,,   ^^^              Steg ==      ^^^    ,,,,,
[SW]   ,,,,,                         ::             ,,,,,   [SO]

~~ river   :: stream   ooo ford   || Steinbrücke   == Steg   ^^^ forest   ,,, fields
```

- **Coordinates:** the playable map is `x ∈ [−72, 72]`, `y ∈ [−45, 45]` (144 × 90 units, 16:10),
  and **y grows southwards**. Grid `GW = 144`, `GH = 90`, one cell = one unit. Cell `(i, j)`
  covers `x ∈ [−72 + i, −71 + i)`, `y ∈ [−45 + j, −44 + j)`; index `k = j · GW + i`; centre
  `(−71.5 + i, −44.5 + j)`.
- **three.js:** X = x, Z = y, Y = up. The camera looks from the south, so north (−y) is at the
  top of the TV, the same orientation as the phone map. A heading `h` is in radians: 0 = +x,
  counter-clockwise towards +y. A model whose nose points along +X gets `rotation.y = −h`.
- **Height field** `heights`: one vertex every 0.5 units over the playable map plus a
  decorative **border of 12 units** on every side, so `x ∈ [−84, 84]`, `y ∈ [−57, 57]` →
  `HX = 337` × `HY = 229` floats, row-major from the north-west corner. The border is landscape
  only (hills, forest, the waters running out of the frame) and never playable.
- **Main river (Fluss)** flows west → east through the middle. Its centre line stays within
  `|y| ≤ 7` on the playable map, with gentle meanders. The water is 6–9 wide at the normal
  level, with banks and a floodplain on both sides.
- **The Werder:** an elongated island in the middle (`|x| ≤ 10`, about 16–20 × 5–8). The river
  splits into two arms around it. A low **Steinbrücke** (two spans, 2 cells wide) crosses both
  arms over the island. A ruined tower (decor) stands on the island's dry hump.
- **Nordbach / Südbach:** two streams from the north and south edges flow into the river near
  the Werder. Each stream's mean x is within ±3 of 0, so the quarters are the same size. A
  stream may bend to join the river up to 8 from x = 0, point-symmetric: the Nordbach joins west
  of the Werder, the Südbach east of it. The water is 2–3 wide, with a deep channel. Each stream
  has one **Furt** and one wooden **Steg** (2 cells wide), 10–25 apart along the stream.
- **River fords:** **Westfurt** (`x ∈ [−52, −34]`) and **Ostfurt** (`x ∈ [34, 52]`). Each is a
  gravel bar across the channel (bed −0.45 … −0.15) with 1–3 small dry **sandbanks**, 5–7 cells
  long along the river.
- **Point bars:** dry sand on the inner bends of the river (decor, walkable).
- **Embankments:** a low causeway (Damm, h ≈ 0.6, 2 cells wide) crosses the floodplain to each
  bridge and Steg, so bridges open before the fords when the water recedes.
- **Four quarters**, one castle site each: 0 Nordwest, 1 Nordost, 2 Südwest, 3 Südost. The keep
  centre is ≈ `(±46, ±27)` ± 4, on a hill plateau (h ≈ 3.5, flat radius ≥ 7), with a 6 × 6 keep
  footprint. A quarter is the land reachable from its keep without crossing water, and it is
  the lord's building land.
- **Floodplain (Aue)** along the river (3–10 cells wide, wider on inner bends) and narrow along
  the streams: low land (0.2 ≤ h < `FLOOD_Y`). It is fertile and it floods. Reed patches lie in it.
- **Forests:** 2–4 patches per quarter, the nearest edge 8–16 from the keep, plus forest belts in
  the border. Willows grow along the banks, and single trees are scattered across the meadows.
- **Rock outcrops** (stone): 2 per quarter, 18–34 from the keep. Cliffs appear only on steep hills.
- **Decorative roads** run from each keep to its nearest crossings. They are painted on and are
  not a class.
- **Seating:** 4 lords → all sites; 3 lords → sites 0, 1, 3 (the empty quarter becomes decor,
  Phase 1 detail); 2 lords → sites 0 and 3 (diagonal).

### Water level and passability (the flood rule)

The water surface is one number for the whole map: `surf(L) = L · FLOOD_Y`, with the level
`L ∈ [0, 1]` (0 = normal, 1 = flood) and `FLOOD_Y = 1.2`. For each cell, `h` is the ground
height (the cell mean; for bridge cells the deck height), and `depth = surf(L) − h`.

| Rule | Condition |
|---|---|
| walkable | the class allows walking **and** `depth ≤ WADE_MAX` (0.45) |
| wading (slow, weaker in a fight) | `0 < depth ≤ WADE_MAX` → speed × 0.45 |
| dry (buildable, plantable) | `depth ≤ −DRY_EPS` (0.05) |

All consequences follow automatically. During the flood (L = 1), every crossing and the whole
floodplain are under water and the quarters are cut off from each other (**Burgfrieden**). When
the water recedes, the crossings open one after the other: the Steinbrücke (deck 0.55) at
L ≈ 0.83, the Stege (deck 0.45) at L ≈ 0.75, and the fords last (L ≈ 0.04–0.15; the two river
fords may differ by ≤ 0.06). The floodplain dries from its high edge towards the river, and the
sandbanks emerge. The renderer shows exactly this: the water surface is a plane at `surf(L)`,
so what is dry on screen is dry in the rules. Phase 2 ice is a separate flag (`frozen`: all
water walkable).

### Cell classes

| Key | Index | Class | Meaning | Walk speed when dry | Build |
|---|---|---|---|---|---|
| `W` | 0 | Wasser | deep channel (h < −0.45) | – | – |
| `F` | 1 | Flach | shallow water at the normal level (−0.45 ≤ h < 0): fords, river edges | (always wading at L = 0) | – |
| `S` | 2 | Sand | banks, sandbanks, point bars | 1.0 | – |
| `B` | 3 | Brücke | bridge or Steg deck, and the embankments | 1.0 | – |
| `M` | 4 | Ried | reed and marsh patches in the floodplain | 0.6 | – |
| `A` | 5 | Aue | fertile floodplain (0.2 ≤ h < 1.2) | 1.0 | ✓ (fields × 1.5) |
| `G` | 6 | Wiese | high meadow (h ≥ 1.2) | 1.0 | ✓ |
| `T` | 7 | Wald | forest (trees on the cell) | 0.7 | – (becomes `G` when cleared, Phase 1) |
| `R` | 8 | Fels | rock outcrop (stone) | – | – (quarries stand next to it) |
| `H` | 9 | Steilhang | cliff, too steep | – | – |

Speeds are multiplied by the wading factor where a cell is wet. `hq[k]` is the cell height in
decimetres (Int8Array, clamped to −30 … +30). Phones need it to evaluate the flood rule.

## Catalogs (`world.js`, shared by TV and phone)

**Buildings.** The footprint in cells is `[w, h]` at `rot 0`; `rot 1` swaps the two. `mat`
`holz` burns, `stein` does not. Costs, HP and timings are **Phase 1 drafts** (a `draft`
sub-object per entry). Names, icons, sizes and placement rules are binding for Phase 0.

| Key | Name | Icon | Size | Mat | Placement (always: own quarter, dry, free, on `G`/`A`, one free cell to every other building) | Draft role |
|---|---|---|---|---|---|---|
| `bergfried` | Bergfried | 🏰 | 6×6 | stein | fixed on the site | home, small store for everything, houses 8, shoots arrows |
| `huette` | Hütte | 🏠 | 2×2 | holz | — | +4 people |
| `hof` | Hof | 🌾 | 5×4 | holz | — ; yield × (1 + 0.5 · share of `A` cells) | farmhouse 2×2 in one corner, the field on the rest; 1 farmer |
| `kornspeicher` | Kornspeicher | 🏚️ | 3×3 | holz | — | stores 🌾 |
| `lager` | Lagerplatz | 📦 | 3×3 | holz | — | stores 🪵 and 🪨 |
| `holzfaeller` | Holzfäller | 🪓 | 2×2 | holz | ≥ 12 `T` cells within radius 8 of its centre | 1 woodcutter |
| `steinbruch` | Steinbruch | ⛏️ | 3×3 | holz | the footprint touches ≥ 2 `R` cells edge-to-edge | 2 stonecutters |
| `kaserne` | Kaserne | ⚔️ | 4×3 | stein | — | recruits soldiers |
| `wachturm` | Wachturm | 🗼 | 2×2 | stein | — | shoots arrows |
| `brunnen` | Brunnen | 🪣 | 1×1 | stein | — | bucket chain against fire within radius 12 |

**Units.** The models are in `art.js`; the stats are Phase 1 drafts.

| Key | Name | Icon | Height | Role |
|---|---|---|---|---|
| `bauer` | Bauer | 🧑‍🌾 | 1.0 | worker and carrier; carries `korn` (sack), `holz` (logs), `stein` (block), `eimer` (bucket) |
| `speer` | Speerträger | 🗡️ | 1.15 | melee, cheap, strong against riders |
| `bogen` | Bogenschütze | 🏹 | 1.1 | ranged |
| `ritter` | Ritter | 🐎 | 1.8 (horse ≈ 1.8 long) | fast and strong, beats archers |
| `fackel` | Fackelträger | 🔥 | 1.05 | fast and fragile, sets fields and wooden buildings on fire |

## World API (`world.js`)

Use the Node-compatible wrapper from Skyfarers' `world.js`: `module.exports` in Node,
`window.FurtWorld` in the browser. **No `Math.random` and no `Date`**, only its own seeded RNG.
Generation may use `Math.sin` and friends. Results do not have to be bit-identical across
browsers, because the TV generates the map and phones receive the encoded grid.

```js
FurtWorld.GW, GH, VRES, BORDER, HX, HY, FX, FY   // 144, 90, 2, 12, 337, 229, 168, 114
FurtWorld.FLOOD_Y, WADE_MAX, DRY_EPS, WADE_SPEED  // 1.2, 0.45, 0.05, 0.45
FurtWorld.CLASSES        // [{ key: 'W', name, walk, build, color }, …]; index = class number
FurtWorld.BUILDINGS, FurtWorld.UNITS              // the catalogs above (+ draft numbers)
FurtWorld.make(seed) → world      // ≤ 200 ms in Node; retries internal sub-seeds until the fairness rules hold
FurtWorld.surf(L)
FurtWorld.cellOf(x, y) → k | −1;  FurtWorld.cellXY(k) → { x, y }   // −1 outside the playable map
FurtWorld.heightAt(world, x, y)   // bilinear on `heights`, valid on the full extent incl. the border
FurtWorld.walk(g, k, L) → speed factor 0..1        // 0 = blocked
FurtWorld.dry(g, k, L) → bool
FurtWorld.canPlace(g, kind, i, j, rot, { lord, L, occ }) → { ok, reason? }
    // (i, j) = top-left cell; reason: 'bounds' | 'owner' | 'terrain' | 'wet' | 'occupied' | 'tight' | 'forest' | 'rock'
FurtWorld.suggest(g, kind, lord, { L, occ }) → { i, j, rot } | null   // best spot; shared by phones and bots
FurtWorld.field(g, targets /* [k] */, L, out?) → Float32Array          // travel-time field: Dijkstra, 8 neighbours, no corner cutting
FurtWorld.path(g, from /* {x,y} */, to, L) → [{ x, y }] | null          // smoothed by line of sight
FurtWorld.encode(world) → { cls, hq, owner }        // RLE strings, see below
FurtWorld.decode({ cls, hq, owner }) → { GW, GH, cls: Uint8Array, hq: Int8Array, owner: Int8Array }
```

- `g` is a full `world` **or** a decoded grid. Every helper works on both, so phones can check
  placements and preview routes.
- `occ` is a `Uint8Array(GW · GH)` (non-zero = occupied) or omitted. Bergfried footprints
  always count as occupied.
- **RLE format:** the alphabet is `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`. Each
  run is one value letter followed by an optional decimal run length (`G12A3W40`); a missing
  length means 1. Values: `cls` = class index; `hq` = hq + 20, clamped to −20 … +25, which is
  enough for the flood rule; `owner` = owner + 1.

`world`:

```js
{
  seed, GW, GH,
  cls: Uint8Array, hq: Int8Array, owner: Int8Array,  // per cell; owner = site index, or −1 for water, bridges and the Werder
  heights: Float32Array(HX · HY),                     // terrain vertices incl. the river beds
  flow: Float32Array(FX · FY · 2),                     // water flow per unit cell over the full extent: downstream
                                                       // direction × speed (river 1, streams 0.6, floodplain 0.25)
  rivers: [{ id: 'fluss' | 'nordbach' | 'suedbach', pts: [{ x, y, w }] }],   // centre lines, downstream order;
                                                       // w = half width of the water at L = 0
  werder: { x, y, rx, ry, tower: { x, y } },
  crossings: [{ id, kind: 'furt' | 'bruecke' | 'steg', water, name, x, y, rot, len, cells: [k], open }],
                                                       // open = highest L at which this crossing alone connects its banks
  sites: [{ s, name, x, y, keep: { i, j } }],         // keep = top-left cell of the 6×6 footprint
  trees: [{ x, y, s, kind: 'laub' | 'nadel' | 'weide', k }],   // k = cell, or −1 in the border
  rocks: [{ x, y, s, k }],
  deco:  [{ x, y, s, kind: 'schilf' | 'blume' | 'stein' | 'busch' }],
  roads: [[{ x, y }]],
  stats: { sites: [{ area, build, aue, forest, rock }], pairs: [{ a, b, type: 'bach' | 'fluss' | 'diagonal', len }] },
  unfair?: true                                        // only if no sub-seed met the fairness rules
}
```

Crossing names (German, for the herald and the phone): Westfurt, Ostfurt, Steinbrücke,
Nordsteg, Nordfurt, Südsteg, Südfurt.

**Fairness rules** (enforced by `make`, checked by the tests):

- quarter areas within ±8 % of their mean; buildable cells within ±10 %;
- `forest` (`T` cells within 30 of the keep) ≥ 120 and within ±20 %;
- `rock` (`R` within 34) ≥ 30 and within ±25 %;
- `aue` ≥ 60 and within ±25 %;
- at L = 0, the keep-to-keep path lengths of each pair type (across a stream, across the river,
  diagonal) within ±12 % of each other;
- at L = 1, no keep reaches another.

## Art API (`art.js`)

These are pure model factories with no scene and no game state. `art.js` is a plain script, and
THREE is passed as the first argument of every factory. The models are low-poly and
flat-shaded with vertex colours. Materials are cached per quality (`high` Standard, `low`
Lambert), and static parts are merged. Copy the patterns of `skyfarers/art.js`: palette, `C()`,
the merge helper, the `onBeforeCompile` patches and `stats`.

- **Lord colour:** a vertex attribute `aTeam` (0..1) marks surfaces that take the lord's colour
  (flags, roof trims, tabards, shields). The final colour is `mix(vertexColor, teamColor, aTeam)`.
  Individual meshes get the team colour from a per-object uniform; instanced meshes get it from
  a per-instance attribute.
- **Shared time and night:** `FurtArt.tick(t)` sets one shared `uTime` (flags, tree sway, unit
  animation); `FurtArt.setNight(n)` sets the glow of windows and torches (for dusk).

```js
FurtArt.palette
FurtArt.tick(t); FurtArt.setNight(n01)
FurtArt.keep(T, { color, emblem, quality })      // 6×6 footprint centred on the origin, base y = 0;
                                                  // tower ≈ 9 high, small curtain wall with a gate
  → { group, setDamage(hp01), setBurnt(b01), setRuined(bool), anchors: { flag, gate, top } }
FurtArt.building(T, kind, { color, quality, rot }) // any BUILDINGS kind except bergfried; footprint exactly
                                                    // `size` cells, centred, base y = 0
  → { group, setBuild(p01), setDamage(hp01), setBurnt(b01), setRuined(bool), setGrowth(g01) /* hof */,
      animate(t, { working, night }), anchors: { door, chimney?, work? } }
FurtArt.units(T, { quality }) → kit
kit.create(kind, max) → { mesh /* InstancedMesh, frustumCulled false */, count(n), commit(),
                          set(i, x, y, z, yaw, anim, phase, rgb, carry) }
  // anim 0 idle · 1 walk · 2 fight · 3 work; rgb = 0xRRGGBB team colour;
  // carry (bauer, fackel) 0 none · 1 korn · 2 holz · 3 stein · 4 eimer
FurtArt.banner(T, { color, emblem, quality }) → { group, animate(t, { moving }) }
  // pole ≈ 3.2 high, flag ≈ 1.4 × 0.9, waving; one draw call
FurtArt.tree(T, kind, { quality }) → { geometry, material, stump: { geometry, material } }   // for instancing; 'laub' | 'nadel' | 'weide'
FurtArt.rock(T, { variant, quality }) → { geometry, material }
FurtArt.deco(T, kind, { quality }) → { geometry, material }       // 'schilf' | 'blume' | 'stein' | 'busch'
FurtArt.bridge(T, { kind: 'stein' | 'steg', len, quality }) → { group }
  // along +X, 2 wide, deck top at y = 0 (the caller lifts it to the deck height)
FurtArt.ruin(T, { quality }) → { group }          // the ruined tower on the Werder
FurtArt.prop(T, kind) → Mesh                      // 'korn' sack, 'holz' log pile, 'stein' blocks, 'eimer' (stockpile dressing)
FurtArt.emblems                                    // 4 simple charges: 0 Balken, 1 Kreuz, 2 Sparren, 3 Kreis (custom arms later)
FurtArt.stats(root) → { tris, calls }
```

- **`setBuild`:** the plot marked with pegs and string → foundation and timber frame in
  scaffolding (plus a small crane) → finished.
- **Draw calls:** a **finished building is ONE mesh** (one draw call), lord-coloured parts
  included. Construction adds ≤ 2 meshes.
- **Hof field:** furrows at growth 0, sprouts at 0.3, green at 0.6, golden at 1; `setBurnt`
  shows black stubble.
- **Units:** animated in the vertex shader from per-instance attributes and `uTime`. One draw
  call per kind; nose along +X, feet at y = 0.

**Sizes:** people are 1.0–1.15 tall, slightly oversized so they read on a TV. Hut ridge ≈ 2.4,
keep tower ≈ 9, trees 2.5–5, banner pole 3.2.

**Triangle budgets (high / low):**

| Model | High | Low |
|---|---|---|
| finished building | ≤ 1.5 k | ≤ 0.8 k |
| keep | ≤ 4 k | ≤ 2 k |
| person | ≤ 300 | ≤ 150 |
| knight with horse | ≤ 500 | ≤ 250 |
| tree | ≤ 120 | ≤ 60 |
| rock | ≤ 80 | ≤ 80 |
| banner | ≤ 200 | ≤ 200 |
| bridge | ≤ 1.5 k | ≤ 1.5 k |

## Terrain API (`terrain.js`)

```js
const land = new FurtTerrain(T, world, { quality })
land.group                  // add it to the scene
land.setLevel(L)            // water plane at surf(L); the floodplain turns wet and muddy; sandbanks emerge by themselves
land.update(t, dt, { sunDir, dayT })   // water flow, glints, foam, sway
land.setTree(id, f01)       // 1 = full tree, 0 = stump, in between a sapling growing back
land.setGround(k, { burnt, path, plot })   // dynamic ground layer (DataTexture GW × GH): scorched,
                                           // trampled, construction dirt (0..1 each)
land.heightAt(x, y)
land.setQuality(q); land.dispose(); land.stats → { calls, tris }
```

- **Ground:** one mesh built from `world.heights` (high: every vertex; low: every second one).
  Colours come from the class, height, slope and noise: lush floodplain green, sunny meadow,
  darker forest floor, sand and gravel at the water, grey rock, brown cliffs. The decorative
  roads are painted in. The shader samples the dynamic ground layer, so it costs no extra draw
  calls.
- **Water:** **one** mesh at `surf(L)`, covering everything that can ever be wet. It uses a
  custom shader:
  - depth from a height texture of `world.heights` → a colour ramp (deep blue-green →
    turquoise → clear over sand);
  - animated flow from `world.flow` (two-phase flow map);
  - foam on shores, around sandbanks and on fords; sun glints; soft edges;
  - a flood tint (brown, more foam) that rises with `L`. Wet sand stays darker for a while
    after the water has left.
- **Vegetation and structures:** trees (instanced per kind, plus stumps), rocks, reeds, flowers
  and bushes. The bridges and the ruin come from `art.js` and are placed at `world.crossings`
  and `world.werder`. Budgets per quality.

## View API (`render.js`, v0)

```js
const view = new FurtView(T, { width, height, quality })   // throws without WebGL
view.canvas                     // its own WebGL canvas, preserveDrawingBuffer: true
view.setWorld(world, lords)     // lords = [{ i, site, color, name, emblem }]; builds terrain, keeps, structures
view.render(state, alpha, { now, dt, snap })   // now in ms; state = the actor state below
view.project(x, y, height) → { x, y, visible } // world → internal canvas px (for the Phase 1 HUD)
view.setQuality(q); view.resize(w, h); view.dispose()
view.debugCam(preset | null)    // 'ford' | 'castle' | 'bridge' | 'stream' close-ups for inspection; null = game camera
view.drawCalls, view.triangles, view.lastMs, view.W, view.H
view.land                       // the FurtTerrain (for fx in Phase 1)
```

- **Camera:** fixed, with a narrow FOV (≈ 24°) and an elevation of ≈ 58°, looking from the
  south. It frames the whole playable map at 16:10 with a thin margin of border. No drift: this
  is a strategy map. At most a very slow breathing.
- **Light:** a sun plus hemisphere fill, keyed by `dayT`: 0 = morning sun from the east,
  0.45 = noon, 0.8 = warm afternoon, 1 = golden dusk from the west. Soft shadows on `high` (one
  2048 map over the playable area): buildings, keeps and trees cast shadows; units get blob
  shadows. Fog only at the edges of the frame.
- **Quality:**
  - `high`: shadows, antialias, internal size up to 1920 × 1200, full vegetation;
  - `low`: no shadows, 960 × 600, terrain from every second vertex, ≤ 50 % of the small
    vegetation;
  - neither needs a post pass in Phase 0.
- **Budgets** with the full fake state (4 lords, ~40 buildings, ~300 units, 8 banners): draw
  calls `high` ≤ 150 / `low` ≤ 80; triangles `high` ≤ 500 k / `low` ≤ 180 k. Retune after the
  M7 bench.
- Phase 1 adds the fx hook (`window.FurtFx`, as in Skyfarers), projectiles, fire and HUD support.

## Actor state (draft: what the view renders and what the Phase 1 sim will produce)

```js
{
  t, dayT, level,
  lords: [{ i, site, color, name, emblem, crown }],
  buildings: [{ id, lord, kind, i, j, rot, build, hp, fire, burnt, ruined, growth }],   // build/hp/fire/burnt/growth 0..1
  units: [{ id, lord, kind, x, y, px, py, h, ph, anim: 'idle' | 'walk' | 'fight' | 'work',
            carry: null | 'korn' | 'holz' | 'stein' | 'eimer' }],
  banners: [{ id, lord, n, x, y, px, py, count, moving }],   // n = 1..3
  trees: Float32Array | null, treeV                          // per world tree: 1 full … 0 stump; treeV changes when trees changes
}
```

- `px, py, ph` are the previous step's values, for interpolation with `alpha`.
- Units stand on `heightAt`, so in a ford they are knee- or waist-deep. That is intended.
- Buildings: `(i, j)` is the top-left cell. The view centres the model on the footprint and
  turns it by 90° for `rot 1`.

## War table (`warmap.js`) and phone prototype (`controller.js`)

`FurtWarmap` is a 2D canvas map for phones (no three.js). The Phase 1 controller reuses it.

```js
const map = new FurtWarmap(canvas, { grid /* decoded */, sites, crossings, me, lords })
map.setLevel(L); map.setBoard({ buildings, banners, fires }); map.view('all' | 'mine')   // animated zoom presets
map.setGhost({ kind, i, j, rot } | null)   // footprint preview: green/red plus a reason icon (FurtWorld.canPlace)
map.pick(px, py) → { k, i, j, x, y, building?, banner?, crossing?, site? }
map.on('tap' | 'ghostMove' | 'bannerDrop', fn)
map.render()                               // static layer cached offscreen, dynamic layer per frame
map.resize(w, h); map.dispose()
```

**Look:** a painted parchment war map.

- Paper grain and stains; ink rivers with flow strokes; dotted fords; beige sand; green washes
  for floodplain and meadow; small tree symbols; hatched rocks and cliffs; plank bridges.
- Dashed quarter borders in the lords' colours, castle icons, crossing names in a serif italic,
  a compass rose.
- Flooded cells are drawn as water, computed from `hq` and `L`.
- Own buildings appear as footprints with icons, banners as pins with numbers. Crisp on
  high-DPI screens.

**The prototype `controller.js`** (finished in Phase 1) is landscape-first and also works in
portrait:

- **Top:** a stock strip (🌾 🪵 🪨 👥), Ruhm, and 👑 when leading.
- **Centre:** the map, with buttons for *Mein Land* / *Ganze Karte*.
- **🏗️ Bauen:** one card per building with icon, name and draft cost. Tap a card → the map
  zooms to the own quarter and shows the ghost at `suggest`. Drag it with the finger (the ghost
  sits above the finger), ↻ rotates it, ✓ / ✕ confirms or cancels → `ffBuild`.
- **⚔️ Truppen:** +🗡️ +🏹 +🐎 +🔥 into banner I/II/III or the 🏰 Burgwache, with the queue
  shown → `ffRecruit`.
- **⚑ Banner:** drag one of the three own banner pins. A route preview comes from
  `FurtWorld.path`. Dropping snaps to crossings, sites and enemy buildings within 4 cells →
  `ffBanner`.

## Phone protocol (draft; `ffMap` is binding)

**Phone → screen:**

- `{ t: 'ffBuild', kind, i, j, rot }`
- `{ t: 'ffRecruit', unit, n }` (n 0 = Burgwache, 1..3 = banner)
- `{ t: 'ffBanner', n, x, y }`
- `{ t: 'ffPact', to, on }`
- `{ t: 'ffAgain' }`

**Screen → phone:**

| Message | When |
|---|---|
| `{ t: 'ffInfo', lord, color, host, lords }` | seat assignment |
| `{ t: 'ffMap', grid: FurtWorld.encode(world), sites, crossings }` | once per match and on join |
| `{ t: 'ffLevel', L }` | ≤ 4/s while the level changes |
| `{ t: 'ffYou', stock, cap, pop, popCap, idle, queue, ruhm, crown }` | ≤ 2/s |
| `{ t: 'ffBoard', b: [[id, lord, kind, i, j, rot, build, hp, fire], …], banners: [[lord, n, x, y, count], …] }` | ≤ 2/s |
| `{ t: 'ffToast', text }` | short feedback |
| `{ t: 'ffPhase', phase, result? }` | phase changes |

## Look (style guide)

- A painted tabletop model in late-afternoon sun: warm and saturated but soft. Flat-shaded
  low-poly models stand on a softly shaded landscape.
- **Water is the star.** It must flow visibly, glitter and foam at fords and sandbanks, and
  read as "deep / wadeable / dry" at a glance.
- Lord colours appear only where they read from the sofa: flags, banners, roof trims, tabards
  and shields. Everything else is natural.
- Thatch for wooden buildings; red tiles or slate for stone ones; grey-ochre stone; warm timber.
- Nothing may hide the river crossings: no tall trees right at fords, and bridges clearly visible.

## Dev harnesses and tests (Phase 0)

| File | Owner | What it does |
|---|---|---|
| `public/dev-furtfehde-map.html` | A1 | 2D preview of `FurtWorld.make`:<br>• layers: classes, hillshade, owner, flow, water at L, trees and rocks, roads, sites<br>• seed browser, level slider, crossings with their `open` values<br>• path tool (click two points: route, length, time), fairness table<br>• URL: `?seed=&layer=&L=&grid=1&a=x,y&b=x,y` |
| `test-furtfehde-world.js` | A1 | Node tests:<br>• the rules above, determinism, fairness over 30 seeds (printed table), flood cut-off, order in which crossings open<br>• path and field, `canPlace`/`suggest` for every kind and lord, encode/decode<br>• timings, no `Math.random` |
| `public/dev-furtfehde-art.html` | A2 | gallery of every model on a turntable, with tris/calls per model:<br>• buildings in all construction stages, damaged, burnt, ruined; Hof growth stages<br>• units in all animations and carry variants in 4 team colours; a marching column of 20 instanced spearmen<br>• trees and stumps, rocks, deco, bridges, the ruin, banners, props<br>• URL: `?only=&quality=&spin=0&t=` |
| `public/dev-furtfehde-view.html` | A3 | the **diorama**: real world + view + a scripted fake actor state<br>• castles with 6–10 buildings each, placed via `suggest`; fields at different growth stages, one burning<br>• peasants carrying goods; two banners per lord marching along `FurtWorld.path` over bridges and fords; a skirmish in the Westfurt; torch-bearers running to a field<br>• UI: seed, `dayT`, level slider with "🌊 Flut ablaufen lassen", quality, camera presets, actors on/off, stats<br>• URL: `?seed=&dayT=&level=&flood=1&quality=&cam=&actors=0&lords=&bench=N&blit=1&ui=0` |
| `public/dev-furtfehde-phone.html` | A4 | the phone prototype against a fake screen (panel + iframe `?phone=1`, like `dev-skyfarers-phone.html`)<br>• fake `ffInfo/ffMap/ffLevel/ffYou/ffBoard`; sent messages shown in a log<br>• URL: `?w=&h=&mode=bauen\|truppen\|banner&L=&lord=&autotest=1` |

## Phase 1 — Erste Fehde (contract)

> Binding for the Phase 1 agents B1–B5. The main session wrote it on 2026-11-08 after feedback 1.
> The user may still flip the decisions below. All numbers are first guesses: they live in
> `FurtSim.CONST` and are tuned against the bot tournament (report changed values).

### Phase 1 decisions

| Topic | Decision |
|---|---|
| Mode | only **Ruhm-Rennen**; the `modus` setting comes with Eroberung in Phase 2 |
| Match | `dauer` minutes (default 12) · flood truce `burgfrieden` s (default 120) · ebb 25 s · war until the end · the last minute is announced |
| Houses | `burgen` 2–4 (default 4); bots fill empty houses; ≤ 2 phones per house, both with full control; more players spectate |
| Takeover | a bot runs a house whose humans all left, until a human of that house returns |
| Economy | every good is carried by a peasant (one hop). Stores: keep (everything), Kornspeicher (🌾), Lagerplatz (🪵 🪨). A builder fetches the materials for a site |
| Housing | soldiers and peasants both count against the housing cap |
| Forests | renewable (stumps regrow); `T` cells stay unbuildable |
| Military | 3 banners + the Burgwache per house; soldiers fight on their own; orders snap to the nearest reachable cell |
| Fire | wooden buildings and fields burn and spread; the Brunnen's bucket chain fights fires; burnt fields are resown |
| Keep falls | plundered: loot to the attacker, the defender's Burgwache dies, the keep stands again with 30 % HP and 60 s protection, the attackers march home |
| Kopfgeld | the leader (≥ 10 Ruhm ahead) wears 👑; Ruhm won against the crowned house × 1.5 |
| Pacts | offer → accept, 180 s; breaking it is betrayal (−5 Ruhm, the victim gets 60 s „Zorn“ = +25 % damage); no pacts with 2 houses |
| TV | fills the screen, native resolution where the device copes; **Kampf-Kamera** (picture-in-picture close-up of big fights, `high` only); order arrows on the map |
| Keeps | gates face the river: sites 0/1 open south, sites 2/3 north (the view turns the southern keeps by π) |
| Names | houses by site: Haus Falkenstein, Haus Wolfsberg, Haus Eichenhain, Haus Hirschfurt. Bots: 🤖 Graf Grimbart, 🤖 Gräfin Gundula, 🤖 Herzog Hagen, 🤖 Baronin Brunhild |

### Match flow

| Phase | `state.phase` | Water `level` | What happens |
|---|---|---|---|
| intro (glue only) | — | 1 | 4 s title card; the sim is not stepped |
| Burgfrieden | `frieden` | 1 | build-up; every crossing is flooded; warning 15 s before the end |
| Ebbe | `ebbe` | 1 → 0 linear over `EBB_S` (25 s) | crossings open one by one (`crossingOpen`) |
| Fehde | `fehde` | 0 | war; `lastMinute` 60 s before the end |
| Ende | `over` | 0 | `over` with the ranking; `step()` returns `[]` afterwards |

`dayT = t / (dauer · 60)`. Ranking order: Ruhm, then people, then finished buildings.

### Houses and seats (glue)

- **Sites:** `burgen` houses: 4 → sites 0, 1, 2, 3; 3 → 0, 1, 3; 2 → 0, 3. Lord index `i` = position in that list.
- **Seating:** humans are dealt round-robin over the houses in join order, ≤ 2 per house. Houses
  without humans get a bot of strength `staerke`. More humans than 2 × houses spectate.
- **Late joiners** take the house with the fewest humans (< 2), preferring bot-run houses (that
  bot steps down). Otherwise they spectate.
- **Takeover:** when a house's last human leaves, a bot takes over („🤖 Graf Grimbart übernimmt
  Haus Wolfsberg“). The house returns to a human of that house who reconnects with the same device id.
- **Colours and names:**
  - The house colour is its first human's player colour. Bot houses get hues away from the humans
    (copy Neonspur's `pickBotColors`). Emblem = lord index.
  - The display name is the house name plus the player names („Haus Falkenstein · Anna & Ben“) or
    the bot name.

### Economy

**People**
- `people` = peasants + soldiers. `popCap` = 8 (keep) + 4 per finished, not ruined hut.
- **Arrivals:** a peasant arrives at the keep gate every `ARRIVE_S` (6 s) while
  `people < popCap`, 🌾 ≥ 1 and the house is not hungry.
- **Eating:** everybody eats; the house loses `people / EAT_S` 🌾 per second (`EAT_S` = 45).
- **Hunger** (🌾 = 0): no arrivals, work speed × `HUNGER_WORK` (0.6), and every `LEAVE_S`
  (15 s) one peasant leaves (walks off the map). Hunger ends at 🌾 ≥ 1.
- **Start:** keep, 6 peasants, stock 🌾 20 · 🪵 25 · 🪨 0.

**Stores**
- One stock per good and house. Its cap is the sum over finished, not ruined stores: keep 30 of
  each; Kornspeicher +60 🌾; Lagerplatz +60 🪵 and +60 🪨.
- A carrier delivers to the store that accepts the good and is nearest by path time. If the
  house is at the cap for that good, the carrier waits there and retries every 2 s.
- Costs are paid from the stock when an order is placed (build, recruit).

**Jobs** — idle peasants are re-assigned every second, nearest first, in this priority:
1. bucket chain at a burning building within 12 of a finished Brunnen (≤ 4 per Brunnen; if fewer
   than 2 are idle, pull the nearest workers);
2. queued recruits;
3. construction sites without a builder;
4. empty worker slots (hof 1, holzfaeller 1, steinbruch 2).

Idle peasants wait in the keep yard (within 4 of the gate, anim idle).

**Cycles**
- **Holzfäller:**
  1. walk to the nearest standing tree within `WOOD_R` (10) of the hut and reserve it;
  2. chop for `CHOP_S` (5 s);
  3. the tree becomes a stump: `trees[id] = 0`, regrowing linearly to 1 over `REGROW_S` (120 s),
     standing again at ≥ 0.6;
  4. carry `WOOD_N` (3) 🪵 (carry `holz`) to a store, walk back, repeat.

  No tree in range → wait at the hut (`noWood`).
- **Steinbruch:** each of the 2 workers works `QUARRY_S` (8 s), carries `STONE_N` (2) 🪨 to a
  store and returns. The stone never runs out.
- **Hof:** the field has `growth` 0..1.
  1. The farmer sows for `SOW_S` (6 s), growth 0 → 0.05.
  2. The field grows by itself to 1 over `GROW_S` (45 s); the farmer waits at the farmhouse.
  3. Harvest for `HARVEST_S` (6 s): `yield = round(6 · (1 + 0.5 · aueShare))` sacks.
  4. The sacks are carried `KORN_N` (2) per trip to a 🌾 store; then sow again.

  A burnt field (`burnt > 0.5`) must be resown from growth 0.
- **Construction:**
  1. The builder walks to the nearest store holding the materials (the keep on ties).
  2. It picks them up (carry `holz` or `stein`, whichever part is larger) and walks to the site.
  3. It builds for `buildS` (anim work), `build` 0 → 1.

  A site without a builder stays at `build` 0, so the plot is visible.
- **Recruiting:** an idle peasant walks to the nearest finished Kaserne, trains for `train` s,
  turns into the soldier and walks to its banner slot (or to the Burgwache spot).
- **Fleeing:** a peasant with an enemy soldier within `FLEE_R` (6) drops its job (its load is
  lost) and runs to the keep gate. It resumes 8 s after no enemy is within 10.
- Workers stop working while their building has `fire > 0.25`.

**Buildings** (sizes and placement as in *Catalogs*):

| Kind | Cost | Build s | HP | Workers | Function |
|---|---|---|---|---|---|
| bergfried | — | — | 3000 | — | store 30/30/30, houses 8, shoots arrows (range 12, 6 dmg every 2 s) |
| huette | 🪵 4 | 8 | 120 | 0 | +4 housing |
| hof | 🪵 5 | 10 | 160 | 1 | field cycle |
| kornspeicher | 🪵 6 | 12 | 200 | 0 | +60 🌾 cap |
| lager | 🪵 5 | 10 | 180 | 0 | +60 🪵 and +60 🪨 cap |
| holzfaeller | 🪵 3 | 8 | 120 | 1 | wood |
| steinbruch | 🪵 6 | 12 | 200 | 2 | stone |
| kaserne | 🪵 8 🪨 8 | 18 | 500 | 0 | recruiting |
| wachturm | 🪵 2 🪨 10 | 16 | 600 | 0 | shoots arrows (range 12, 7 dmg every 1.5 s) |
| brunnen | 🪨 4 | 6 | 250 | 0 | bucket chain within 12 |

- A building under construction has HP in proportion to `build`, at least 10 %.
- **`cancel`:** a site → full refund; a finished building → demolished, no refund; a ruin →
  cleared.
- **Ruins** (HP 0) have no function and still block the footprint. Ordering the same kind on
  exactly its footprint rebuilds it for 50 % of the cost (rounded up), keeping the id.
- **Doors:** the door cell at rot 0 is just south of the footprint's middle,
  `(i + ⌊fw/2⌋, j + fh)`. At rot 1 it is just west, `(i − 1, j + ⌊fh/2⌋)` (fw/fh = the rotated
  footprint). Workers walk to the door cell.
- **Keep gates:** the cell in front of the gate, centre south of the footprint for sites 0/1 and
  north of it for sites 2/3.

**Units**

| Kind | Cost | Train s | HP | Dmg | Cooldown s | Range | Speed | Radius | Notes |
|---|---|---|---|---|---|---|---|---|---|
| bauer | — | — | 25 | 2 | 1.5 | 1.0 | 2.4 | 0.3 | flees; fights only when cornered |
| speer | 🌾 2 🪵 2 | 4 | 60 | 8 | 1.0 | 1.3 | 2.6 | 0.35 | × 2 vs ritter |
| bogen | 🌾 2 🪵 3 | 4 | 40 | 6 | 1.4 | 9 | 2.6 | 0.35 | arrows fly 0.35–0.7 s; × 1.5 vs fackel |
| ritter | 🌾 4 🪨 3 | 6 | 140 | 14 | 1.2 | 1.5 | 4.2 | 0.6 | × 2 vs bogen |
| fackel | 🌾 1 🪵 1 | 3 | 30 | — | — | 1.2 | 4.0 | 0.3 | sets fires, never fights |

- **Damage against buildings:** speer × 1, ritter × 0.6, bogen × 0.3. Bauer and fackel deal none
  (the fackel ignites instead).
- **Wading** (0 < depth ≤ `WADE_MAX`): speed per the flood rule (× 0.45), damage dealt × 0.7,
  damage taken × 1.25.
- **Zorn** (after a betrayal): damage × 1.25 for 60 s.

### Military

**Banners**
- Per house: banners 1–3 plus the Burgwache (n = 0). A banner exists while it has at least one
  soldier, or soldiers in training for it.
- **Targets:** `banner(lord, n, x, y)` sets the target cell.
  - If that cell is unreachable at the current level, the nearest reachable cell within 12 is
    used instead (`reason: 'snapped'`).
  - If nothing within 12 is reachable, the banner goes to its own keep gate
    (`reason: 'unreachable'`).
  - Targets on a pact partner's buildings, or within 6 cells of them, are refused
    (`reason: 'pact'`).
- **Movement:** one travel field per banner target (`FurtWorld.field` with building footprints
  blocked), recomputed on every new order and whenever a crossing opens. Units follow the field,
  then their formation slot: rows of up to 6, spacing 1.3, facing the march direction, ritter in
  front, bogen at the back.

**Fighting**
- **Engagement:** every 0.5 s each soldier picks the nearest enemy within its aggro radius (melee
  6, bogen 10), never a pact partner. It leaves its slot to fight and returns when it is more than
  `LEASH` (12) from the slot.
- **Buildings:** with no enemy units around and the banner standing on or within 3 of an enemy
  building, melee units attack that building.
- **Burgwache:** holds near the keep gate and engages enemies within 16 of the keep or within 8 of
  itself.
- **Fackelträger** run to the target building.
  - If it burns (`holz` or a Hof), they ignite it (`fire += 0.5`) and move on to the next enemy
    burnable within 15 of the banner target.
  - They never fight, and they dodge melee units within 3.
- **Keeps and towers** shoot the nearest enemy in range, fackel first.
- **Separation:** units push each other apart (radii above). No unit stands in deep water or on
  a blocked cell.

### Fire

- **Burnable:** buildings with `mat: 'holz'`, including the Hof field. Each building has `fire`
  0..1, which grows by 0.03/s and does `20 · fire` HP damage per second.
- **Spread:** after 5 s above 0.6, the fire ignites (`fire` 0.2) every burnable building whose
  footprint is within 3 cells (Hof fields: within 4).
- **Hof field:** above `fire` 0.3 the crop burns: growth → 0, `burnt` → 1. `burnt` fades over 60 s
  once the fire is out, and the field can be resown once `fire` = 0.
- **Extinguishing:** each bucket peasant within 12 of a finished Brunnen removes 0.06 fire/s.
- Stone buildings never burn. At HP 0 the fire goes out and the building is a ruin.

### Ruhm and Kopfgeld

| Action | Ruhm |
|---|---|
| kill a bauer, speer, bogen or fackel | +1 |
| kill a ritter | +2 |
| destroy a building (kaserne or wachturm) | +3 (+5) |
| burn a crop (growth > 0.3) | +1 |
| plunder a keep | +20 |
| prosperity, every 30 s | +1 per full 8 people |
| break a pact | −5 |

- **Credit:** Ruhm goes to the house of the killer or destroyer (the last hit for buildings and keeps).
- **👑:** recomputed every 5 s. The leader holds the crown if it is ≥ 10 Ruhm ahead of the second.
- Ruhm won against the crowned house counts × 1.5, rounded to 0.5.

### Keep plunder

- At keep HP 0 a **plunder** happens:
  - The attacker (last hit) gets +20 Ruhm plus loot: 50 % of each of the defender's goods. The
    defender loses that amount; the attacker receives it up to its caps.
  - The defender's Burgwache dies.
- **The keep stands again** at 30 % HP with `prot` = 60 s:
  - it is invulnerable and keeps shooting;
  - the banners of other houses whose target lies within 16 of it are sent home.
- In Ruhm-Rennen a keep never stays a ruin.

### Pacts

- **Offer:** `pact(a, to, true)` makes an offer that lasts 30 s. If `to` has already offered to
  `a`, the pact becomes active for `PACT_S` (180 s).
- **During a pact** both sides' units ignore each other, and banner targets in the partner's zone
  are refused.
- **`pact(a, to, false)`:** declines an offer, withdraws one's own offer, or breaks an active pact.
  Breaking is betrayal: −5 Ruhm for `a`, and `to` gets Zorn for 60 s.
- **Events:** `pactOffer`, `pactOn`, `pactOff { reason: 'expired' | 'broken' | 'declined' }`.
- With only 2 houses there are no pacts (`reason: 'zwei'`).
- **Bots** accept offers from a house with a stronger army than their own, or while they are
  fighting someone else; otherwise they decline. In Phase 1 bots never offer and never break.

### Bots (`bots.js`)

- **API:** `FurtBots.create(sim, lord, { strength, seed })` → `{ step() }`. The caller steps every
  bot before each `sim.step()`, in a fixed order.
- Bots use only the public sim API and read `sim.state` / `sim.youOf`. Their RNG is their own and
  deterministic. They think every 15 steps (1 s); the knappe every 30.
- **Economy priorities:**
  1. food balance first: enough farms for the people;
  2. a hut when close to the cap;
  3. a Kornspeicher once there are two farms;
  4. a Lager once the keep store is ≥ 70 % full;
  5. the quarry before the Kaserne;
  6. a Brunnen next to wooden clusters;
  7. a tower facing the nearest crossing.

  All placements via `FurtWorld.suggest`.
- **Army:** after the Kaserne, recruit while the stock allows. Fill the Burgwache to 4, then
  banners 1–2 with speer 40 % / bogen 35 % / ritter 15 % / fackel 10 %. The knappe recruits no
  ritter.
- **Attack:** once the Fehde has started and a banner reaches the threshold (knappe 14, ritter 10,
  kriegsherr 8 soldiers):
  - target the crowned house if it is reachable, otherwise the nearest enemy by path time;
  - fields and huts at the enemy's edge first, then the keep;
  - retreat home below 40 % strength;
  - fackel squads raid fields.
- **Defence:** enemies near own buildings call the banners home.

### Sim API (`sim.js`)

```js
const sim = FurtSim.create({ seed, world, dauer /* min */, burgfrieden /* s */, lords: [{ i, site }] });
sim.dt                                            // 1 / 15 s
sim.build(lord, kind, i, j, rot) → { ok, id?, reason? }   // canPlace reasons + 'cost' | 'phase' | 'kind'
sim.cancel(lord, id) → { ok, reason? }
sim.recruit(lord, unit, n) → { ok, reason? }              // 'cost' | 'kaserne' | 'pop' | 'unit'
sim.banner(lord, n, x, y) → { ok, x, y, reason? }         // 'snapped' | 'unreachable' | 'pact' | 'none'
sim.home(lord) → { ok }                                    // every banner to the keep gate
sim.pact(lord, to, on) → { ok, reason?, state }           // state 'offered' | 'active' | 'none'
sim.step() → events[]
sim.state                                         // read-only for everyone else, see below
sim.youOf(lord) → { stock, cap, pop, popCap, idle, hunger, queue: [{ unit, n, p }], ruhm, crown,
                    banners: [{ n, count, x, y, tx, ty }], pacts: [{ with, state, until }] }
FurtSim.CONST                                     // every tunable, named and commented
```

- Use the Node/browser wrapper of `world.js`.
- Deterministic: no `Math.random`, `Date` or `performance.now`. Use separate RNG streams
  (economy, combat, …).
- Invalid input (unknown lord, NaN, unknown kind) returns `{ ok: false, reason }` and never throws.
- `step()` averages < 2 ms with 4 houses at 60 soldiers + 40 peasants each.
- B1 may extend `world.js` additively (for example a `block` mask for `field`/`path`), keeping
  `test-furtfehde-world.js` green.

**`sim.state`** extends the Phase 0 actor state:

```js
{
  t, dayT, level, phase, endsAt,
  lords: [{ i, site, emblem, crown, ruhm, people, soldiers, prot /* s left */, zorn /* s left */, hunger }],
  buildings: [{ id, lord, kind, i, j, rot, build, hp, fire, burnt, ruined, growth, workers }],
  units: [{ id, lord, kind, x, y, px, py, h, ph, hp, anim, carry, n /* banner; −1 = peasant */ }],
  banners: [{ id, lord, n, x, y, px, py, count, moving, tx, ty }],   // x, y = centroid of its soldiers
  trees: Float32Array, treeV,
  pacts: [{ a, b, until } | { a, b, offerUntil }],
  ranking                                          // set when over
}
```

The glue supplies colours and names; the view keeps its own `lords`.

**Events** from `step()` (`{ t: '…', … }`):

| Group | Events |
|---|---|
| Phases | `frieden`, `warn { kind: 'ebbe', in }`, `ebbe`, `crossingOpen { id }`, `fehde`, `lastMinute`, `over { ranking }` |
| People | `arrive { lord }`, `leave { lord }`, `hunger { lord, on }` |
| Buildings | `build { lord, id, kind }`, `buildDone { id }`, `cancel { id }`, `ruined { id, by }`, `rebuild { id }` |
| Production | `chop { lord, tree }`, `deliver { lord, res, n, store }`, `harvest { id, n }`, `sow { id }` |
| Recruiting | `recruit { lord, unit, n }`, `trained { lord, id, unit }` |
| Combat | `order { lord, n, x, y }`, `shot { from: [x, y], to: [x, y], flight, src: 'bogen' \| 'turm' \| 'keep' }`, `clash { x, y }`, `hit { id, x, y }`, `death { id, lord, kind, x, y, by }` |
| Fire | `ignite { id, by }`, `fireOut { id }`, `cropBurnt { id }`, `bucket { brunnen, id }` |
| Keeps, crown | `plunder { lord, by, loot }`, `protEnd { lord }`, `crown { lord }` (`lord` null = nobody) |
| Pacts | `pactOffer { from, to }`, `pactOn { a, b, until }`, `pactOff { a, b, reason, by? }` |
| Alerts | `attack { lord, x, y }` (a house is under attack; at most 1 per 10 s per house) |

### View additions (`render.js`, `terrain.js`)

- **Keeps:** the keeps of sites 2/3 are turned by π, so their gates face the river.
- **`view.inset(rect, focus)`:** picture-in-picture close-up.
  - `rect = { x, y, w, h }` in internal canvas px; `focus = { x, y, dist }`.
  - It renders a second camera of the same scene into that viewport, with a frame; `null` turns it off.
  - `high` only. It costs a second scene pass, so the glue shows it only during fights.
- **Flooded bridges and Stege:** whitewater and a visible wake over a submerged deck (terrain
  shader), so a flooded bridge reads as „überflutet“, not as a glitch.
- The HUD draws the banner count labels and keep names via `view.project`. Order arrows and the
  protection dome belong to fx.

### Fx (`fx.js`) and sound (`sound.js`)

**Fx API**, as in Skyfarers:
- `new FurtFx(T, { scene, camera, quality, view })`;
- `event(ev, state)`, `update(state, alpha, { now, dt, dayT, sunDir })`;
- `setQuality(q)`, `dispose()`.

**It owns:**
- **Combat:** arrows (instanced streaks on ballistic arcs from `shot`), hit sparks, clash dust,
  death poofs.
- **Fire and building:** flames, smoke and embers per burning building (replacing the view's
  stand-in); collapse dust on `ruined`; construction dust and chips; chimney smoke (huette, hof,
  kaserne).
- **Water:** ripples and splashes around wading units, driftwood during the flood, a sparkle sweep
  across a crossing on `crossingOpen`, rare fish jumps.
- **Signals:** order arrows (a dashed ground arrow in the lord colour from banner to target, 3 s,
  on `order`); the protection dome while `prot > 0`; the plunder burst (coins + smoke).
- **Life:** bird flocks that flush from fights.

**Budget:** ≤ 8 draw calls on high, ≤ 6 on low. Particle budgets go in a `BUDGET` constant.

**Sound:**
- `FurtSound.play(name, { vol })`, `FurtSound.ambience('calm' | 'flood' | 'battle' | null)` and
  `FurtSound.battle(level01)`, a drum and clash layer that follows the number of fighting units.
- Names:
  - combat: `clash`, `arrow`, `horn` (order), `alarm` (attack on a house);
  - work: `hammer`, `chop`, `stone`, `crackle`, `collapse`;
  - water: `bell` (crossing open), `splash`;
  - events: `cheer` (plunder), `fanfare` (herald), `chime` (pact), `sting` (betrayal).
- Everything is synthesized. It stays silent without WebAudio and while the shell is muted (use
  Skyfarers' check).

### Glue (`screen.js`) — like Skyfarers

- **Seats:** houses, bots and takeover as above. `cfg.seed` is for tests; a rematch increments
  the match number and gets a new world seed.
- **No WebGL** → `endToLobby('🏰 Furt & Fehde braucht einen Browser mit WebGL.')`.
- **Display:**
  - A wrapper over `cv` holds the view canvas plus a transparent HUD canvas and **fills the
    window**.
  - Internal size = window × DPR, capped per quality. The setting `aufloesung: nativ` lifts the
    cap via `view.setCap`.
  - Mitschauen mirrors every 125 ms; `?blit=1` for harness screenshots.
- **Quality `auto`:** as in Skyfarers: start on high; after 5 s of play, an average above 22 ms
  switches to low once. The Kampf-Kamera runs only on high.
- **Loop:** fixed steps (at most 8 per frame), bots stepped before each sim step, events passed
  on to view/fx, sound, phones and the herald.
- **HUD** (German):
  - **top centre:** clock and phase („🌊 Burgfrieden 1:12“, „⚔️ Fehde“, „⏳ Letzte Minute“);
  - **four lord panels** at the edges next to their castles: colour, house name with player or
    bot name, Ruhm, 👑, 👥 people, ⚔️ soldiers, 🌾 🪵 🪨, warning icons 🔥 ⚔️ 🍞, 🤝 pacts;
  - banner count labels over the banners;
  - a herald line with the last 3 messages;
  - **end screen:** ranking with a Ruhm breakdown, titles („⚔️ Schlächter“, „🏗️ Baumeister“,
    „🔥 Brandstifter“, „🤝 Diplomat“) and the host's „🔁 Nochmal“.
- **Kampf-Kamera:**
  - **trigger:** ≥ 12 units fighting within 8 of each other (from `clash`/`death` density), or a
    keep under attack;
  - shows `view.inset` bottom centre at 30 % width for 7 s, cooldown 12 s;
  - labelled with the nearest crossing or keep („⚔️ Schlacht an der Westfurt“).
- **Herald texts** (German), for example:
  - „🌊 Die Steinbrücke ist frei!“
  - „🔥 Haus Wolfsberg brennt!“
  - „🏰 Haus Falkenstein wurde geplündert!“
  - „🤝 Pakt zwischen … für 3 Minuten“, „🗡️ Verrat! …“
  - „👑 … trägt die Krone“
- `reportWinners(humans of the winning house)` exactly once.
- `_debug()` → `{ sim, phase, view, seats, bots }`.
- **Load order:**
  - TV: `meta → world → sim → bots → art → terrain → fx → render → sound → screen`;
  - phone: `meta → world → warmap → controller` (exact one-line tags).

### Phone protocol (Phase 1, binding)

**Phone → screen:**

| Message | Meaning |
|---|---|
| `{ t: 'ffBuild', kind, i, j, rot }` | place, or rebuild a ruin of the same kind |
| `{ t: 'ffCancel', id }` | cancel a site, demolish, or clear a ruin |
| `{ t: 'ffRecruit', unit, n }` | one unit into banner n (0 = Burgwache) |
| `{ t: 'ffBanner', n, x, y }` | move banner n |
| `{ t: 'ffHome' }` | all banners home |
| `{ t: 'ffPact', to, on }` | offer or accept (`true`); decline, withdraw or break (`false`) |
| `{ t: 'ffAgain' }` | host, on the end screen: rematch |

**Screen → phone:**

| Message | When |
|---|---|
| `{ t: 'ffInfo', lord, color, host, lords: [{ i, site, color, name, emblem, bot }], shared }` | seat, join, host change. `lord: −1` = spectator |
| `{ t: 'ffMap', grid, sites, crossings }` | once per match and on join (no `cells`), followed by `ffLevel` |
| `{ t: 'ffLevel', L }` | on change, ≤ 4/s |
| `{ t: 'ffPhase', phase, endsAt, now }` | on a phase change, and every 10 s. `endsAt` = end of the **current** phase (frieden: `burgfrieden`, ebbe: `+ EBB_S`, fehde: match end); `now` = sim seconds |
| `{ t: 'ffYou', … }` | as in Phase 0, plus `hunger` and `pacts: [{ with, state, until }]`; ≤ 2/s |
| `{ t: 'ffBoard', b, banners }` | ≤ 2/s; `b` rows gain `ruined` (0/1) as a 10th field |
| `{ t: 'ffAlert', kind, text }` | `attack` · `fire` · `hunger` · `plunder` · `crossing` · `pact` · `crown`; the phone vibrates and shows a banner |
| `{ t: 'ffToast', text }` | feedback („❌ Zu wenig Holz“) |
| `{ t: 'ffResult', ranking, you }` | at the end |

Validate everything on the screen.

### Phone (`controller.js`) completion

- **Views:** waiting, the war table (from the Phase 0 prototype), spectator
  („👀 Alle Burgen sind besetzt“), end (ranking, own stats, the host's 🔁).
- **Phase chip** (Burgfrieden countdown, Fehde, letzte Minute), alerts with vibration, toasts.
- **🤝 Pakte sheet:**
  - the other houses with their state and an offer button (3 Min);
  - an incoming offer prompt (Annehmen / Ablehnen, 30 s);
  - active pacts with a timer and „🗡️ Pakt brechen“ (with confirmation).
- **Building card** (tap an own building): name, HP and state („arbeitet / wartet / kein Wald /
  brennt“), with „Abreißen“, „♻️ Wiederaufbau ½“ or „🧹 Räumen“.
- **Banner mode:** „🏰 Alle heim“.
- **Shared house:** both phones show the same state, and either can act.

### Settings (`meta.js`)

```js
registerGame({ key: 'furtfehde', label: '🏰 Furt & Fehde', min: 1, settings: {
  dauer:       { label: 'Dauer', type: 'number', default: 12, min: 6, max: 30, step: 2, unit: ' Min' },
  burgen:      { label: 'Burgen', type: 'number', default: 4, min: 2, max: 4, step: 1 },
  staerke:     { label: 'Bots', type: 'choice', default: 'ritter', options: [
                 { v: 'knappe', label: '🛡️ Knappe' }, { v: 'ritter', label: '⚔️ Ritter' }, { v: 'kriegsherr', label: '👑 Kriegsherr' }] },
  burgfrieden: { label: 'Burgfrieden', type: 'choice', default: '120', options: [
                 { v: '60', label: '1 Min' }, { v: '120', label: '2 Min' }, { v: '180', label: '3 Min' }] },
  quality:     { label: 'Grafik', type: 'choice', default: 'auto', options: [
                 { v: 'auto', label: '🤖 Auto' }, { v: 'high', label: '✨ Voll' }, { v: 'low', label: '🔋 Sparsam' }] },
  aufloesung:  { label: 'Auflösung', type: 'choice', default: 'normal', options: [
                 { v: 'normal', label: 'Normal' }, { v: 'nativ', label: '🔍 Nativ (4K)' }] }
} });
```

### Harnesses and tests (Phase 1)

| File | Owner | What it does |
|---|---|---|
| `test-furtfehde-sim.js` | B1 | Node tests:<br>• determinism; invalid input; performance<br>• economy: arrival, eating, hunger, carrying, caps, choice of store<br>• construction: fetch, build, cancel, ruin, rebuild; recruiting<br>• banner orders (snap, unreachable, pact refusal); pathing across fords; flood blocking<br>• combat: RPS duels, wading penalty, building damage, towers<br>• fire: ignite, spread, Brunnen<br>• plunder, protection and the march home; Ruhm and Kopfgeld<br>• pacts: offer, accept, expire, break, decline, refusal with 2 houses |
| `test-furtfehde-bots.js` | B3 | full matches, 4 bots × 3 strengths × 10 seeds:<br>• no errors; every bot reaches ≥ 12 buildings, ≥ 15 soldiers and ≥ 1 attack<br>• prints a balance table: winner per site, Ruhm spread, plunders, time to the first fight |
| `test-furtfehde-flow.js` | B5 | JSDOM end to end with a stub view, 5 phones on 4 houses (one shared):<br>• messages reach the sim; `ffMap`/`ffLevel`/`ffYou`/`ffBoard` arrive<br>• build, recruit, banner and pact round trips<br>• late joiner; the last human leaves → bot takeover → reconnect<br>• end → ranking → host rematch; everybody leaves → lobby |
| `public/dev-furtfehde.html` | B5 | full TV harness:<br>• real sim, bots on every house (or `n` human stand-ins)<br>• fake clock `?sim=<ms>`, `bench=N`, `blit=1` |
| `public/dev-furtfehde-view.html` | B2 | adds scripted Phase 1 events for fx: shots, clashes, fire, plunder, orders, crossings opening |
| `public/dev-furtfehde-phone.html` | B4 | every new phone state as a preset: `end`, `spectator`, `pact`, `alert=…`, `card=…` |

**Balance targets** (4 ritter bots, 12 min, 10 seeds):
- every site wins 10–40 % of the matches;
- the winner's Ruhm is at most 4 × the last place's;
- at least one plunder in ≥ 50 % of the matches;
- the first fight comes within 60 s after `fehde`;
- no house starves for more than 60 s in a row;
- `step()` averages < 2 ms.

### Agent waves (Phase 1)

- **W1:** **B1 Regeln** (`sim.js`, `test-furtfehde-sim.js`, additive `world.js`) ∥ **B2 Leben &
  Klang** (`fx.js`, `sound.js`, the view additions in `render.js`/`terrain.js`,
  `dev-furtfehde-view.html`)
- **W2:** **B3 Bots** (`bots.js`, `test-furtfehde-bots.js`; may tune `CONST` in `sim.js`) ∥
  **B4 Handy** (`controller.js`, `warmap.js`, `dev-furtfehde-phone.html`)
- **W3:** **B5 Glue** (`screen.js`, `meta.js`, the shell script tags, `dev-furtfehde.html`,
  `test-furtfehde-flow.js`, `package.json`)
- **🚦 Feedback 2:** a real match with phones.

## Phase 1b — Nachschliff (feedback 2, contract)

### Feedback 2 (2026-11-09)

The user's first real matches ran in the PC browser, with the M7 only as the display. Nothing
stuttered, and the user liked the game overall. Their findings:

1. **A dead end.** Every peasant starved away. One archer was left, nobody farmed, and no new
   peasant ever came.
2. **8 farms did not feed 13 people.**
   - In peace, 8 farms near the keep feed 16 people (main-session experiment).
   - But every construction site and every recruit pulls the nearest worker after 3 s, often a
     farmer, so the fields lie idle.
   - Hunger then cuts the work speed to 0.6, and the house spirals down.
3. **The phone never says what a building is for,** what must be near it, or how many of it you
   need. Examples: Hütte, Kornspeicher, Lagerplatz, and whether towers need a crew. The user
   wants a guide.
4. **Pause instead of demolish:** let a workplace rest (💤) and resume later, for example the
   quarry while the stone is full.
5. **Sending troops was not understood.**
6. **One torch-bearer burnt the whole village** right after the ebb. It was the ritter bot's
   first torch probe.
7. **Auto quality jumped to Sparsam** after a few minutes, although nothing stuttered.
8. **The TV chime on every finished building is annoying;** the phone's feedback is enough.
9. **The settings were unclear.** „Knappe / Ritter / Kriegsherr“ wasn't recognisable as the bot
   strength, and 12 min felt short.

### Rules (sim) — the numbers are binding unless the bots tournament proves them wrong

| # | Rule | CONST |
|---|---|---|
| R1 | **Never a dead end.** Hunger never drives a house below `FLOOR` peasants: `leaveOne` does nothing while the house has ≤ `FLOOR` peasants. While it has fewer than `FLOOR` peasants (and `people < popCap`), a peasant arrives every `ARRIVE_S`, even when hungry or out of 🌾. | `FLOOR: 4` |
| R2 | **Farmers stay on the fields.** The 3-s pull for construction sites and recruits (`takeWorker`) never takes a Hof worker. It takes Steinbruch workers first, then Holzfäller workers, nearest first within each. The bucket chain may still pull anyone. | — |
| R3 | **Food first.** While the house is hungry or has 🌾 < `FOOD_LOW`, empty Hof slots are filled right after the bucket chain, before recruits and sites. The other worker slots keep their place. | `FOOD_LOW: 6` |
| R4 | **Food tuning.** `EAT_S` 45 → 60, `KORN_N` 2 → 3. C1 measures what one Hof feeds (near the keep, no Aue, and on full Aue) and reports it. The phone texts use that number. | `EAT_S: 60`, `KORN_N: 3` |
| R5 | **Pause.** `sim.pause(lord, id, on)`, details below. | — |
| R6 | **Burgbrunnen.** The keep acts as a well: its bucket chain fights fires on own buildings whose centre is within `KEEP_WELL_R` of the keep centre, with up to `BUCKET_MAX` peasants filling at the gate. Finished Brunnen work as before. | `KEEP_WELL_R: 12` |
| R7 | **Arrows against torches.** Keep and tower arrows deal × `ARROW_FACKEL` against a fackel (they still pick fackel first). | `ARROW_FACKEL: 2` |
| R8 | **Slower spread.** A fire must stay above 0.6 for `SPREAD_AFTER_S` before it spreads. | `SPREAD_AFTER_S` 5 → 8 |
| R9 | **Food rate.** `youOf().food = { prod, eat }`, both whole sacks per minute. `prod` = 🌾 delivered to the stores over the last 60 s (a rolling window of 60 one-second buckets). `eat` = `round(people · 60 / EAT_S)`. | — |

**Pause (R5):**
- **What can rest:** only finished, not ruined workplaces with worker slots (hof, holzfaeller,
  steinbruch). Anything else returns `{ ok: false, reason: 'kind' }`; an unknown id or another
  house's building returns `'none'`. Pausing twice is fine (`ok: true`).
- **`on = true`:**
  - workers walking to it or working there go to the yard at once;
  - a worker who carries goods delivers them first, then goes idle instead of returning;
  - no new workers are assigned while it rests;
  - a Hof's field keeps growing and can be harvested after the pause.
- **`on = false`:** the slots fill again in the normal job priority.
- **State:** `buildings[].paused` (boolean, default `false`). Ruin or rebuild → `false`.
- **Event:** `pause { id, on }`, emitted only when the state really changes.
- Bots never pause.

**Bots:**
- **No early torch raid:** no torch sortie before `RAID_AFTER_S` after `fehde` — ritter 120 s,
  kriegsherr 60 s. The knappe sends none, as before.
- **Retune** the food model (`food`, `stock`) to R4, and the wells to R6 (the keep now guards the
  core; wells belong at the outlying fields).
- **Gates:** the hard checks stay. „No house hungry > 60 s in a row“ becomes a hard check for the
  ritter and kriegsherr tables. The other balance targets stay soft and printed.

### Protocol additions (binding)

- Phone → TV: **`ffPause { id, on }`**. The glue only accepts it for the sender's own finished
  workplace and answers a refusal with an `ffToast`.
- **`ffBoard.b` rows** gain a 13th field, **`paused`** (0/1):
  `[id, lord, kind, i, j, rot, build, hp, fire, ruined, noWood, workers, paused]`.
- **`ffYou.food = { prod, eat }`** (= `youOf().food`).

### Phone (`controller.js`, `warmap.js`)

**P1 Building info.**
- Each build card shows its one-line *Wozu*.
- The placing panel shows *Wozu · Wohin · Wie viele* from the table below. The finger hint
  shrinks to one small line under it.
- The building card (tap on an own building) shows the same text plus the live state.

**P2 📖 Anleitung.** A „❓“ button in the top bar opens a full-screen, scrollable guide with short
German sections:
- Ziel & Ruhm;
- Ablauf: Hochwasser → Ebbe → Fehde;
- Leute & Korn: arrivals, eating, hunger, the food rate, „nie unter 4 Bauern“;
- Gebäude: the table below;
- Truppen: Kaserne → ausbilden → Fahne schicken, the four units and who beats whom;
- Feuer & Brunnen, including the Burgbrunnen;
- Pakte;
- Bot-Stärken: Knappe leicht, Ritter mittel, Kriegsherr schwer.

During the Burgfrieden the ❓ pulses until it has been opened once on this device
(`localStorage`, wrapped in try/catch).

**P3 Berater (advisor).** One line under the top bar shows the most urgent tip. Tapping it
opens the matching guide section or mode. Priority:

| # | When | Text (gist) |
|---|---|---|
| 1 | `hunger` | „🍞 Hunger! Bau mehr 🌾 Höfe – Bauern gehen zuerst aufs Feld“ (without a finished Hof: „Bau sofort einen 🌾 Hof“) |
| 2 | ≥ 1 finished Hof for 90 s and `food.prod < food.eat` | „🌾 Ernte +p, Verbrauch −e pro Min – bau noch einen Hof“ |
| 3 | an own building burns, no Brunnen within 12 and outside 12 of the keep | „🔥 Feuer! Ein 🪣 Brunnen in der Nähe löscht es“ |
| 4 | `pop ≥ popCap` | „🏠 Kein Platz für neue Bauern – bau eine Hütte“ |
| 5 | `idle = 0` and an own site at `build 0` | „👷 Alle Bauern arbeiten – bau eine Hütte oder lass einen Betrieb 💤 ruhen“ |
| 6 | a good at its cap | „🪨 Stein voll – Steinbruch 💤 ruhen lassen oder 📦 Lagerplatz bauen“ (🌾 → Kornspeicher, 🪵 → Lagerplatz) |
| 7 | a Holzfäller with `noWood` | „🪓 Keine Bäume in Reichweite – näher am Wald bauen“ |
| 8 | ebbe or fehde, ≥ 6 wooden buildings, no Brunnen | „🪣 Noch kein Brunnen – Fackelträger könnten dein Dorf abbrennen“ |
| 9 | fehde, no Kaserne | „⚔️ Ohne Kaserne keine Truppen“ |
| 10 | fehde, soldiers in banners 1–3, none ordered yet this match | „⚑ Schick deine Truppen: Fahne antippen, dann aufs Ziel tippen“ |

**P4 Food balance.** Next to 🌾 in the top bar a small „+p −e“: green when `prod ≥ eat`, red
otherwise.

**P5 Pause.**
- The card of an own finished workplace gets „💤 Ruhen lassen“ / „▶ Weiterarbeiten“.
- The card state reads „💤 ruht – die Arbeiter sind frei“.
- The war map draws a 💤 badge on paused buildings.

**P6 Sending troops.**
- In the ⚑ mode, **tap a banner chip, then tap the map** to send it; dragging stays.
- A live line says what to do next: „Tippe aufs Ziel für Fahne II“.
- Each banner row in ⚔️ Truppen gets „📍 Schicken“, which switches to ⚑ with that banner picked.
- The first recruit of a match toasts „Ausgebildete Truppen schickst du unter ⚑ Fahnen los“.
- The mode button reads „⚑ Fahnen“.

**Building texts** (German; the wording may be polished, the facts are binding; C1 confirms the
farm number):

| Kind | Wozu | Wohin | Wie viele |
|---|---|---|---|
| huette | 🏠 +4 Wohnplätze; neue Bauern kommen nur, wenn Platz frei ist | irgendwo im eigenen Land | eine, bevor 👥 voll ist |
| hof | 🌾 1 Bauer sät und erntet Korn | auf die grüne Aue (+50 % Ertrag), nah an Bergfried oder Kornspeicher | 1 Hof ernährt etwa 5 Leute |
| kornspeicher | 🏚️ +60 🌾 Platz; die Bauern liefern zum nächsten Speicher | neben weit entfernte Höfe | erst wenn 🌾 voll ist (30) oder die Höfe weit weg liegen |
| lager | 📦 +60 🪵 und +60 🪨 Platz | egal | erst wenn 🪵 oder 🪨 voll ist (30) |
| holzfaeller | 🪓 1 Bauer fällt Bäume im Umkreis von 10; sie wachsen nach | direkt an den Wald | 1–2 |
| steinbruch | ⛏️ 2 Bauern brechen 🪨 für Kaserne, Turm, Brunnen und Ritter | am grauen Fels | 1; 💤 ruhen lassen, wenn 🪨 voll ist |
| kaserne | ⚔️ bildet Bauern zu Soldaten aus | nah am Bergfried | 1 reicht |
| wachturm | 🗼 schießt von selbst, ohne Besatzung (Reichweite 12, Fackelträger zuerst) | an Furten und Brücken, vor die Höfe | 2–3 |
| brunnen | 🪣 Bauern löschen Brände im Umkreis von 12; der Bergfried schützt nur seine Nähe | mitten zwischen die Holzgebäude | 1 pro Dorfteil |

**Units:**
- Speerträger: stark gegen Ritter.
- Bogenschütze: schießt aus der Ferne, stark gegen Fackelträger.
- Ritter: schnell, stark gegen Bogenschützen.
- Fackelträger: zündet Holzgebäude an und kämpft nie.

### TV (`screen.js`, `fx.js`, `sound.js`, `meta.js`)

- **T1 💤:** a 💤 sign floats above paused buildings, readable from the sofa and cheap: one
  sprite per paused building or a single points/instanced set.
- **T2 Quieter building:**
  - `buildDone` makes no sound on the TV;
  - the `build`/`rebuild` hammer plays at half its volume, at most once per 2 s overall.
- **T3 Auto quality decides only on sustained slowness:**
  - it uses the **median** frame interval over a 10-s window;
  - it ignores intervals > 250 ms and the 5 s after one (tab switch, GC, shader compile);
  - threshold 40 ms (below 25 fps), not before 30 s into `live`;
  - **two steps:** with `aufloesung: nativ` the native cap drops to the normal cap first; only
    the next sustained slowness switches to Sparsam;
  - the TV announces each step.
- **T4 Settings (`meta.js`):**
  - `staerke`: label „Bot-Stärke“, options „🛡️ Knappe (leicht)“, „⚔️ Ritter (mittel)“,
    „👑 Kriegsherr (schwer)“;
  - `dauer`: default 20, max 40 (also the glue's `cfg` default).
- **T5 Glue:** `ffPause` → `sim.pause`, the 13th `ffBoard` field, `ffYou.food`.
- **T6 Sound unlock:**
  - check that the TV's audio context resumes on the first gesture (the lobby click);
  - while it is suspended in a match, a small „🔇 Klick oder Taste für Ton“ shows in a HUD corner
    until the next click or key.

### Phase 1b addendum — well coverage and storage overview (user wish, 2026-11-09 evening)

**W1 Brunnen-Abdeckung (phone).** The war map shows the own house's fire coverage:
- **When:** while a Brunnen is being placed, and while the card of an own Brunnen or the own
  Bergfried is open.
- **Discs:**
  - a translucent blue disc of radius `BUCKET_R` (12 cells) around the centre of every own
    finished, not-ruined Brunnen;
  - a dashed outline only for own Brunnen still under construction (they don't put out fires
    yet);
  - the Burgbrunnen disc of radius `KEEP_WELL_R` (12) around the keep centre;
  - the planned well's disc follows the plan with a brighter outline.
- **Markers on own wooden buildings** (`mat: 'holz'`, the Hof included, finished or not):
  - covered: a small blue 💧 ring;
  - uncovered: an orange ring.
  - The rule is the sim's: the building centre lies within 12 of a finished Brunnen's centre or
    of the keep centre.
- **Summary line in the placing panel:** „🪣 Geschützt: 7 von 10 Holzgebäuden · dieser Brunnen
  schützt 3 weitere“.

**W2 Lager-Übersicht (phone).**
- **Top bar:** shows the cap next to each good, e.g. „🌾 30/90“ with the „/90“ small and dimmed.
  A full good is marked. It must fit on 390 px and 320 px portrait phones.
- **Tapping the resource row** opens a „📦 Lager“ sheet:
  - per good: the amount and cap, a bar, and where the room comes from („Bergfried 30 ·
    2 Kornspeicher +120“);
  - for 🌾: „Ernte +p · Verbrauch −e pro Min“;
  - when a good is full, a tip: „🏚️ Kornspeicher bauen“, „📦 Lagerplatz bauen“, or for stone
    „⛏️ Steinbruch 💤 ruhen lassen“;
  - 👥 people and housing („Bergfried 8 · 3 Hütten +12“) and the idle peasants.

  It closes with ✕, a tap outside, or the back gesture.

**Protocol:** `ffInfo.rules = { bucketR, keepWellR, capKeep, capKorn, capLager, keepHouses,
hutHouses }` comes from `FurtSim.CONST`. Without it, the phone falls back to 12, 12, 30, 60, 60,
8, 4.

**Agent:** C3 owns `controller.js`, `warmap.js`, `screen.js` (only `ffInfo.rules`),
`dev-furtfehde-phone.html` and `test-furtfehde-flow.js`.

### Phase 1b, round 2 — feedback 3 (2026-11-10)

**Feedback 3:** the user won their first match (default settings, ritter bots) and liked the
Kampf-Kamera at a ford. Two problems:
1. **The house stopped growing at 44 of 88 people,** although every store was full, and nobody
   came free for training.
2. **A second Kaserne did not train faster.**

**Main-session analysis:**
- The likely cause of (1) is `GATE_SAFE_R` from round 1: **every** arrival waits while an enemy
  soldier stands within 8 of the gate.
  - The crowned leader is besieged often (the ritter bots aim at the crown).
  - A siege at the keep therefore stops all arrivals, so no recruit gets a peasant, so no
    defender ever comes: a new dead end.
- On top of that, the workers of full goods sit in `CARRY` at the full store, retrying every
  2 s. `takeWorker` never takes a carrier, and R2 never takes a farmer, so recruits find nobody.
- (2): `TRAIN_PAR` (3) is per house, and recruits always use the *first* finished Kaserne.

**Rules:**

| # | Rule |
|---|---|
| R10 | **The gate rule covers hunger arrivals only.** Only the arrivals that exist because of R1 (below `FLOOR` peasants while hungry or out of 🌾) wait while an enemy soldier is within `GATE_SAFE_R` of the gate. Normal arrivals continue during a siege; they are the house's reinforcements. |
| R11 | **A full store frees its workers.** While a good is at its cap: (a) a Hof, Holzfäller or Steinbruch of that good takes no new worker; (b) a worker who would start a new work cycle goes idle instead; (c) a carrier waiting at a full store gives up after `FULL_WAIT_S` (his load is lost) and goes idle. As soon as there is room again, the slots fill in the normal job priority. A field keeps growing meanwhile. |
| R12 | **Training per Kaserne.** At most `TRAIN_PAR` (3) recruits per *finished Kaserne* are on their way or in training. Each recruit picks the nearest finished Kaserne with a free place, so 2 Kasernen train twice as fast. |

- **State:** `buildings[].full` (boolean) is true while R11 rests a workplace (a finished
  workplace whose good is at its cap, not paused by order).
- **`ffBoard` 13th field:** 0 working · 1 resting by order (💤) · 2 resting because the store is
  full.
- **Phone:**
  - **The card of a field-2 workplace:** „📦 Lager voll – die Arbeiter sind frei“. „💤 Ruhen
    lassen“ stays possible, and a paused one shows 1.
  - **The Kaserne texts:** *Wozu* „⚔️ bildet Bauern zu Soldaten aus – jede Kaserne 3 zugleich“
    and *Wie viele* „1; eine zweite bildet doppelt so schnell aus“. The guide is adjusted.
  - **Advisor tip 5** also fires when recruits wait and `idle = 0`: „👷 Niemand frei für die
    Ausbildung – bau Hütten oder lass einen Betrieb 💤 ruhen“.
  - **The queue** shows „⏳ wartet auf einen freien Bauern“ for a recruit nobody has taken.
- **TV:** the 💤 sign shows for both resting kinds.
- **Bots** benefit automatically; they never pause.
- **Fire look (user question):** only torch-bearers light fires, but damage visuals looked like
  burning. The keep's orange embers at low HP are replaced by grey dust and falling stones, so
  orange flames mean real fire only. Damaged stone buildings keep their grey smoke.

**Tests:**
- **Sim:**
  - R10: a siege at the gate with free housing and food → arrivals continue; hungry and below
    `FLOOR` → they wait;
  - R11: wood at its cap → the woodcutter goes idle within `FULL_WAIT_S` plus one cycle, and a
    recruit gets him; room again → the slot fills;
  - R12: 2 Kasernen → 6 in training at once, each at the nearer Kaserne;
  - **the user's scene:** popCap 88, 44 people, full stores, a recruit queue and an enemy banner
    at the keep → the house grows and trains.
- **Bots:** hard checks green; print the table.
- **Flow:** the 13th field 2 → the card text; the advisor's recruit tip.

### Harnesses and tests (Phase 1b)

- **C1:**
  - `test-furtfehde-sim.js` covers R1–R9 and pause, with the pinned numbers updated;
  - `test-furtfehde-bots.js` gets the new hard hunger check, and prints the table and the food
    experiment.
- **C2:**
  - `test-furtfehde-flow.js` covers the `ffPause` round trip, the 13th field and `ffYou.food`;
  - a stub-clock check that Auto ignores a 1-s hitch but steps down on a sustained 45-ms median;
  - no TV sound on `buildDone`;
  - phone harness presets `guide`, `advice=<n>` and a paused card; the phone autotest is
    extended.

### Agent wave (Phase 1b)

- **C1 Regeln** (`sim.js`, `bots.js`, `test-furtfehde-sim.js`, `test-furtfehde-bots.js`) ∥
  **C2 Handy & TV** (`controller.js`, `warmap.js`, `screen.js`, `meta.js`, `fx.js`, `sound.js`,
  `dev-furtfehde-phone.html`, `dev-furtfehde.html`, `test-furtfehde-flow.js`).
- **Order:**
  - C1 lands the API first (R5 pause and R9 food), then the rules and the bots;
  - C2 builds the phone and TV parts first and the `ffPause`/`food` integration last;
  - if `sim.pause` isn't there yet, C2 reports it, and the main session runs the final check.
- **🚦 Feedback 3:** the next test round.

## Phase 2 — Mauern & Söldner (contract, draft 2026-11-10)

### Phase 2 decisions (user, 2026-11-10)

| Topic | Decision |
|---|---|
| Defense | **Palisade** (wood, burns) and **Mauer** (stone) drawn as lines; a **Torhaus**; a **Wehrgang**: archers garrison stone walls, gatehouses and watchtowers. No pitch ditch or pits for now |
| Siege | a **Rammbock** breaks walls and gates fast; **troops can attack walls too**, only slower |
| Barracks | two kinds. The **Kaserne** trains Speerträger, Bogenschütze, Ritter and the Rammbock. The new **Söldnerlager** trains **Fackelträger** (moved from the Kaserne) and **Reiterschützen** (horse archers). No third mercenary unit |
| Gold | a **Markt** sells surplus 🌾 🪵 🪨 for **💰 Gold** and buys goods dearer; mercenaries cost gold |
| Later (2b) | Eroberung with robber knights, seasons, catapult, mill and bakery, herald voice, music |

### Catalog additions (`world.js`, binding sizes)

| Kind | Name | Icon | Size (cells) | Mat | Cost | Build s | HP | Notes |
|---|---|---|---|---|---|---|---|---|
| `palisade` | Palisade | 🪵 | 1 × `len` (1–4) | holz | 🪵 1 per cell | 2 per cell | 150 per cell | burns; no garrison |
| `mauer` | Mauer | 🧱 | 1 × `len` (1–4) | stein | 🪨 2 per cell | 4 per cell | 450 per cell | 1 archer per cell |
| `torhaus` | Torhaus | 🏯 | 3 × 2 | stein | 🪵 4 🪨 12 | 20 | 1400 | middle lane open for own and pact units; 4 archers |
| `markt` | Markt | ⚖️ | 4 × 3 | holz | 🪵 10 | 14 | 300 | trading |
| `soeldnerlager` | Söldnerlager | ⛺ | 5 × 4 | holz | 🪵 12 | 16 | 350 | mercenaries |

- **Walls** (`palisade`, `mauer`) are buildings with a length. Footprint: `rot 0` = `len` cells
  along +i (x), `rot 1` = along +j (y).
  - On the phone the player drags a line. The phone splits it into an L of axis-aligned pieces
    of up to 4 cells.
- **The Torhaus** spans 3 cells across its passage and 2 along it. `rot 0`: the lane is its
  middle column and runs north–south; `rot 1` turns it. Walls attach to its two flanks.
- **The Wachturm** gains 3 archer slots.
- **Placement:**
  - own quarter, dry at the current level;
  - walls may touch walls, Torhaus and Wachturm, but keep the usual one free cell to every other
    building, its door cell and the keep gate;
  - nothing goes on fords, bridges or footbridges.

**Units:**

| Kind | Name | Icon | Where | Cost | Train s | HP | Dmg | Cd | Range | Speed | Radius |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `reiterschuetze` | Reiterschütze | 🏇 | Söldnerlager | 💰 6 🌾 2 | 4 | 70 | 6 | 1.3 | 8 | 4.4 | 0.6 |
| `fackel` | Fackelträger | 🔥 | Söldnerlager (moved) | 💰 2 🌾 1 | 2 | 30 | — | — | 1.2 | 4.0 | 0.3 |
| `ramme` | Rammbock | 🪵 | Kaserne | 🪵 10 💰 4 | 10 | 400 | 60 vs buildings | 2.0 | 1.6 | 1.6 | 0.9 |

- **Every recruit takes one peasant**, mercenaries and the ram included, so housing still limits
  armies.
- **Reiterschütze:**
  - shoots while moving and backs away from melee within 3 while reloading;
  - × 1.5 against speer and fackel; the ritter deals × 1.5 against it.
- **Rammbock:**
  - deals no damage to units;
  - arrows deal × 0.25 against it, melee full;
  - it stands in front of its banner and attacks the nearest enemy wall, gate or building
    within 3.

### Rules (sim)

**Gold and the Markt**
- `stock.gold` (💰) has no cap and starts at 0. A plunder takes 50 % of it like every good.
- Trading needs a finished Markt and happens at once (no carrying), in packs of `TRADE_PACK` = 5
  goods.
- **Prices** in 💰 per pack:

  | | 🌾 | 🪵 | 🪨 |
  |---|---|---|---|
  | sell | 1 | 1 | 2 |
  | buy | 3 | 3 | 5 |

- Buying stops at the store cap (`reason: 'cap'`).
- `sim.trade(lord, good, side, packs) → { ok, n, reason? }`, with `n` = the packs actually
  traded and reasons `'markt'`, `'cost'`, `'cap'`, `'good'`, `'side'`.

**Recruiting:** `recruit(lord, unit, n)` picks the building from the unit. A missing building
gives reason `'kaserne'` or `'lager'`; missing gold gives `'cost'`. `TRAIN_PAR` counts per
building (round 2, R12).

**Walls and gates**
- Wall and Torhaus cells block movement like buildings. The Torhaus lane is open for its owner
  and active pact partners, and blocked for everybody else.
- **Way-finding:**
  - peasants and the own banners use their house's view, with their own lanes open;
  - an enemy banner's travel field treats enemy wall and closed lane cells as passable at
    `BREACH_COST` extra (a weighted field). With no open way, the field leads to the cheapest
    breach.
- `world.js` gains an optional per-cell cost grid for `field`, additively; the world test stays
  green.
- **Breaching:** a melee soldier or a ram whose next field step is an enemy wall or gate cell
  attacks that piece.
- **Wall damage multipliers `VS_WALL`:** speer 0.4, ritter 0.25, ramme 1. Arrows: 0 against
  stone, 0.15 against palisades.
- **Fire:** torch-bearers ignite palisades (wooden), with spread as usual.
- **A broken piece** becomes a ruin. A wall ruin is passable rubble at `RUBBLE_SLOW` (0.6 ×
  speed) and can be rebuilt like any ruin.

**Wehrgang (garrison)**
- **Slots:** a Mauer has 1 per cell, a Torhaus 4, a Wachturm 3. Only `bogen` garrison.
- **Entering:** when a banner's target lies on or within 1 of an own garrisonable building, its
  archers enter the free slots of such buildings within 4 of the target, nearest first. The
  others form up behind.
- **The Burgwache's archers** garrison by themselves: the free slots within `GUARD_R` of the
  keep, nearest the gate first.
- **Inside:**
  - +3 range;
  - arrows against them × 0.5;
  - melee cannot reach them;
  - they keep their banner.
- **Leaving:** they leave when the banner gets a target elsewhere. When their building is ruined
  they drop to the nearest free cell with 20 % damage.
- **State:** `units[].on` = the building id while inside (else `null`) plus `slot` (index). `x/y`
  are the slot's ground position; the view lifts the unit to the slot anchor.

**Ram:** a unit with a banner. Its blow lands at the end of its swing (`cd` 2 s), and the view
shows the swing with anim 2.

### State and protocol (binding)

- **`buildings[]`** gains `len` (1 for non-walls) and `garrison` (the archers inside).
- **`lords[]`** gains `gold`.
- **`youOf().stock.gold`.**
- **`ffBoard.b` rows:** `[id, lord, kind, i, j, rot, build, hp, fire, ruined, noWood, workers,
  rest (0/1/2), len, garrison]`.
- **Phone → TV:**
  - `ffWall { kind, pieces: [[i, j, rot, len], …] }`: the glue places them in order, as long as
    the stock lasts, answering with one toast;
  - `ffTrade { good, side, packs }`;
  - `ffRecruit` unchanged.
- **`ffInfo.rules`** gains `prices: { sell: { korn, holz, stein }, buy: { … } }` and
  `tradePack`; `ffInfo.costs.units` gains gold.

### Phone

- **Wall tool:**
  - pick Palisade or Mauer, then drag a line (an L with axis-aligned legs);
  - the plan shows the pieces, red where blocked, plus the total cost;
  - ✓ sends `ffWall`.
- **Torhaus** places like a building, with ↻ to turn it.
- **Markt sheet:** opened from the Markt card and from the 📦 Lager sheet. It has sell and buy
  buttons per good with prices and the stock, and 💰 sits in the top bar.
- **Truppen:**
  - the units are grouped by building („⚔️ Kaserne“, „⛺ Söldnerlager“);
  - costs show 💰;
  - a missing building shows its hint.
- **Garrison:**
  - drag a banner onto an own Mauer, Torhaus or Wachturm, and a toast says „🏹 Bogenschützen
    besetzen die Mauer“;
  - the card of a garrisonable building shows its slots.
- **Texts:** info texts for every new kind and unit; guide sections Mauern & Tore, Markt & Gold,
  Söldner, Rammbock.
- **New advisor tips:**
  - stores full and a Markt → sell;
  - hungry with gold and a Markt → buy 🌾;
  - an enemy wall blocks a banner and it has no ram → „Bring einen 🪵 Rammbock“.

### TV

**Models (`art.js`):**
- **`palisade`** (1 × `len`):
  - sharpened stakes about 2.2 high on a cross beam;
  - posts at both ends, so pieces join without gaps;
  - small lord-coloured rags on the end posts.
- **`mauer`** (1 × `len`):
  - about 3 high, with merlons, a walk on top and lord-coloured shields every 2 cells;
  - `anchors.slots` = one per cell, on the walk.
- **`torhaus`** (3 × 2):
  - two flanking towers about 4.5 high and an arch with wooden doors;
  - `setOpen(0..1)` opens the doors;
  - a lord banner over the arch;
  - `anchors.slots` × 4 and `anchors.gate`.
- **`wachturm`** gains `anchors.slots` × 3 on its platform.
- **`markt`:**
  - 2–3 stalls with striped awnings (one stripe lord-coloured), crates, sacks and a scale;
  - an `animate` sway of the awnings.
- **`soeldnerlager`:**
  - 3 bright tents of different shapes (a round one with a pole, a ridge tent, a large pavilion);
  - a fenced paddock with 2 horses (idle bob in `animate`), a weapon rack and a campfire
    (`anchors.fire`);
  - a lord-coloured pennant.
- **Units** (via the units kit, one draw call per kind):
  - **`reiterschuetze`:** a light horse with a rider and a short bow, and a lord-coloured saddle
    cloth and tabard. Anims: 0 idle, 1 gallop, 2 shoot (draw and release on the move), 3 unused.
  - **`ramme`:** a covered log on 4 wheels, about 3 × 1.4 × 1.6, with a hide roof (one
    lord-coloured hide) and 4 pairs of crew legs underneath. Anims: 0 idle, 1 roll (wheels turn,
    legs walk), 2 swing (the log swings).
- Every building supports `setBuild`, `setDamage`, `setBurnt` (wooden ones) and `setRuined`.
  Wall ruins are low rubble or broken stakes.
- **Triangle budgets (high / low):**

  | Model | High | Low |
  |---|---|---|
  | wall piece of 4 | ≤ 600 | ≤ 300 |
  | Torhaus, Markt, Söldnerlager | ≤ 1.5 k | ≤ 0.8 k |
  | Reiterschütze | ≤ 500 | ≤ 250 |
  | Rammbock | ≤ 600 | ≤ 300 |

- **Gallery:** `dev-furtfehde-art.html` shows every new model in all states, plus a demo yard: an
  L-shaped Mauer with a Torhaus and two Wachtürme, a palisade line, and archers standing on the
  slot anchors.

**View, fx, sound** (wave 3):
- garrisoned archers drawn at the slot anchors;
- the Torhaus opens while own units pass its lane;
- 💰 in the lord panels;
- stone chips when walls are hit, dust and a thud from the ram, rubble on a breach, coins when
  gold is plundered.

### Bots (wave 3)

- **Markt:** sell when a good is full, buy 🌾 when hungry and gold allows.
- **Söldnerlager:** the torch squad and horse archers come from here.
- **Walls (ritter and kriegsherr):** a palisade or Mauer line across the approach from their
  crossings to the village, with a Torhaus and garrisoned archers. The knappe builds none.
- **Rams:** a banner whose target is walled takes a ram along.
- **Gates:** the existing hard checks stay, and new soft goals are printed.

### Agent waves (Phase 2)

- **W1 (now, parallel to round 2's D1):** **E1 Modelle** (`art.js`, `dev-furtfehde-art.html`). It
  works in a separate copy of the worktree until D1 is done and Phase 1b is committed; then the
  main session copies its two files back.
- **W2:** **E2 Regeln** (`world.js` additive: catalog, placement, field costs; `sim.js` and its
  tests) ∥ **E3 Handy** (`controller.js`, `warmap.js`, phone harness), against this protocol.
- **W3:** **E4 Bots** ∥ **E5 Glue & TV** (`screen.js`, `render.js`, `fx.js`, `sound.js`, `meta.js`,
  flow test).
- **🚦 Feedback:** a test round.

## Implementation notes (interpretations)

_Filled in by the main session from the agents' reports. Where a note contradicts the text
above, the note wins._

### Round 2 — as built (Phase 1b, D1)

**Tests:**
- sim 2562 checks, flow 295, bots 58 hard checks; the autotest runs steps 1–22.
- The bots table is about unchanged: sites 30/10/35/25 %, winner/last Ø 1.52×, longest hunger
  25 s.

**Reproduction of the user's scene:**
- **Setup:** popCap 88, 44 people, full stores, a recruit queue, and 3 enemy ritters 7 cells
  from the gate.
- **Over 300 s:** before, 44 → 44 people with 4 trained; after, 44 → 78 with 37 trained.
- **Carrier-seconds lost at full stores:** 3684 → 8.

**R10–R12 details:**
- **`FULL_WAIT_S` 8:** every sack that fits restarts the wait. A carrier who gives up loses his
  load and is idle at once.
- **`buildings[].full`:**
  - key order `…workers, paused, full[, noWood]`;
  - refreshed at the start of every step and by `pause()`;
  - false for non-workplaces, sites, ruins and paused workplaces.
- **A full Hof:** it starts no new cycle, sowing included. A farmer waiting for growth is freed;
  the field keeps growing and stays ripe. A Hof still hauling (`rest > 0`) keeps hauling. A
  harvest that would go into a store that has meanwhile filled up is not taken, so the crop
  stays ripe.
- **Woodcutters and stonecutters** are freed only at the start of a cycle.
- **R12:**
  - the first pick is the nearest pair of idle peasant and Kaserne with room;
  - a pulled worker goes to the free Kaserne nearest the gate;
  - when a Kaserne falls, its recruit goes to the nearest one with room, else back to the yard
    with the order kept.
- **Deviation:** `youOf().queue[].wait` (boolean: nobody has taken this order yet). The phone
  shows ⏳ only when `wait`, `idle === 0` and a finished Kaserne exists; tip 5 uses the same
  rule.
- **Phone:**
  - field 13: 1 = `paused`, 2 = `full`;
  - the card checks paused, then full, then noWood;
  - tip 5 prefers the recruit text.
- **`fx.js`:** the keep at hp < 0.32 makes grey dust and stone chips with no additive particles
  (stone-grey palette entries 27 and 28). A burning hut still sparks orange.
- **`bots.js`:** the quarry-shed check (`c.unst`) ignores full workplaces.

**Left for Phase 2's phone agent (E3):**
- *Redundant texts:* tip 6, the Lager sheet's „⛏️ Steinbruch 💤 ruhen lassen“ and
  `INFO.steinbruch.viele` still advise resting a full quarry, which now rests by itself. The
  autotest pins these texts.
- *Missing badge:* `warmap.js` draws the 💤 badge only for `paused`, not for `full`.

**Watch:**
- R11 plus a long recruit queue can turn farmers freed by a full 🌾 store into soldiers. Only R3
  (`korn < 6`) and `PEASANT_MIN` brake that.
- Peasants who fled stay in `FLEE` while an enemy is within `CALM_R` 10, which is more than
  `GATE_SAFE_R` 8.

### Well coverage and storage overview — as built (Phase 1b addendum, C3)

**Tests:**
- flow: 269 checks;
- the phone autotest: steps 1–21, at 844 × 390, 390 × 844, 320 × 568, 360 × 780 and
  568 × 320. Step 20 checks the coverage against an independent oracle in the harness, and
  step 21 checks the storage sheet.
- Drawing a moving planned well costs about 1.45 ms per frame in headless Firefox
  (`&place=brunnen&bench=drag`).

**Keep card (new):** a tap on the own castle opens a minimal card with:
- the Burgbrunnen text, stores and housing;
- a „Schutz“ row and a „📦 Lager ansehen“ button;
- no HP bar, because the glue sends no keep row, and no demolish button.

Other castles keep the name callout. The Brunnen card gets the same „Schutz“ row, and its disc
is highlighted.

**Coverage:**
- **Counting:** ruins are excluded and sites count. „7 von 10“ counts finished wells plus the
  keep; „weitere“ counts what only the plan would add.
- **Drawing:**
  - the discs are drawn as one union, with one wash and one outline;
  - the area only the plan adds is tinted stronger;
  - unfinished wells get a dashed outline and no wash;
  - the plan and the selected well or keep get a bright outline;
  - the marker rings sit at each building's top-left corner.

**Storage sheet:**
- 🌾 🪵 🪨 and 👥 open it; a second tap closes it.
- The old 🌾 tap into the guide is replaced by the sheet's „📖 Mehr dazu in der Anleitung“.
- **Tips are buttons:** a build tip switches to Bauen with that building picked; the Steinbruch
  tip opens its card, and only shows for a finished, working Steinbruch; full 👥 shows
  „🏠 Hütte bauen“.
- Two lines were added to `GUIDE` (Lager, Schutz-Ansicht).

**Top bar:**
- The food chip sits under 🌾's bar in portrait and inline in landscape.
- The portrait second row may wrap.
- Portrait phones ≤ 600 px tall get a compact mode row.
- Landscape phones of about 750–800 px may wrap the top bar.

**Harness:**
- the fake screen sends `ffInfo.rules` (`?rules=0` leaves it out);
- caps and popCap are computed from its buildings, with default caps 90/90/90;
- new presets: `place=brunnen&dash=1`, `lager=1|full`, `card=keep`, `bench=drag`;
- autotest step 19 now taps an empty spot found with `pick()`; it used to tap near banner II
  on 390-px maps;
- dev hook `__ff.ignorePop`.

**Main session:** the guide's fire text now says that towers and the keep hit torch-bearers
twice as hard, and that small wooden houses usually burn down alone while big ones set their
neighbours alight.

**Known gaps:**
- touch and back are tested only synthetically;
- `INFO`/`GUIDE` texts still hard-code 12, 30 and 60 (only the coverage and the sheet read
  `ffInfo.rules`);
- on 320 × 568 the Brunnen's *Wozu* scrolls while placing.

### Rules and bots — as built (Phase 1b, C1 + main session)

**Tests:**
- sim: 2454 checks; `step()` averages 0.3–0.6 ms;
- bots: 58 hard checks;
- the soft goals still missed are plunders (0 of 20) and „first fight ≤ 60 s after `fehde`“,
  which is impossible by design now; the informational goal „≤ `RAID_AFTER_S` + 30 s“ is met.

**`CONST`:**
- new: `FLOOR` 4, `FOOD_LOW` 6, `KEEP_WELL_R` 12, `ARROW_FACKEL` 2;
- changed: `EAT_S` 60, `KORN_N` 3, `SPREAD_AFTER_S` 8;
- **main session:** `GATE_SAFE_R` 8 — no arrival while an enemy soldier stands within 8 of the
  gate. The timer waits at its threshold, and the next peasant comes as soon as the gate is
  clear.
  - C1 found that R1 alone turned a besieged, starving house into a Ruhm farm: a peasant every
    6 s, straight into the enemy.
  - Tested in the R1 block.
- the food window `FOOD_WIN` (60 one-second buckets) is a module constant, not in `CONST`.

**Food (measured):**
- one person eats 1 🌾 per minute;
- one lone Hof:
  - near the keep without Aue: 6.0 sacks/min;
  - on full Aue but far from a store: Ø 5.6 (5.1–6.4);
  - on full Aue with a Kornspeicher at its door: Ø 8.1.

  So „1 Hof ernährt etwa 5 Leute“ is right and conservative (`FARM_FEEDS` 5).
- 8 Höfe with 16 people:
  - 6 sites always open → no hunger after minute 2;
  - a recruit queue plus 3 sites → still 16 people.
  - Under the Phase 1 rules, the same setup starved 553 of 600 s.

**API:**
- `sim.pause` reasons are `'lord'`, `'phase'` (after the end), `'none'` and `'kind'`; `'kind'`
  also covers sites and ruins.
- A ruin or rebuild clears `paused` silently, with no `pause` event.
- Key order of a building: `…workers, paused, noWood`.
- `youOf().food` is the last key:
  - `prod` includes the current second (a 59–60 s window) and under-reports in the first minute;
  - `eat` counts soldiers and recruits too.

**Behaviour:**
- **Pause:** a carrier leaves the crew at once (`workers` 0) but still delivers. A farmer's
  unhauled sacks are lost, as on any release.
- **R1:** peasants are `bauer` units not leaving; soldiers don't count; arrivals still need
  `people < popCap`.
- **R6:** the keep's chain is the Brunnen code. It reaches 12 from the keep centre and may pull
  up to 2 workers, farmers included.
- **R8 side effect:** a hut or woodcutter (120 HP) lit by one torch burns down in ≈ 9.4 s, before
  it could spread (11.3 s). Only Hof, Lager, Kornspeicher and Steinbruch still spread. One torch
  now costs about one building instead of the village.

**Bots:**
- **`FurtBots.RAID_AFTER_S`** = `{ knappe: Infinity, ritter: 120, kriegsherr: 60 }`, also
  `PROFILES[x].raidAfter`:
  - it gates the torch squad and a field banner with a torch-bearer in it;
  - it counts from the first `fehde` the bot sees, so a takeover in the middle of the Fehde has
    no delay;
  - first torch fire: ritter median 129 s, kriegsherr 70 s.
- **Food model:** `FEED` 5.0 / `FEED_KS` 5.5 is the measured base. The margins are ritter 0.6,
  kriegsherr 0.57 and knappe 1.7; the knappe deliberately under-farms so that the kriegsherr's
  mixed win rate stays ≥ 70 % (85 %).
  - Ritter and kriegsherr plant about 2× the fields they need (≈ 5 farmers per 40 people); that
    is the price of the hunger gate.
- **Wells:** a bot builds a Brunnen only when ≥ 3 wooden buildings lie outside the keep's 12
  and every Brunnen's reach. The well keeps outside 9 of the keep centre and 6 of other wells.
- **Hard checks:**
  - no house is hungry for more than 60 s (ritter 80 houses, kriegsherr 40; the maximum seen
    is 25 s);
  - no torch fire before `RAID_AFTER_S`;
  - bots never pause;
  - 1 Hof feeds ≥ 5.
- The takeover test no longer requires `people > 0` at the end, since an overrun house is
  legitimate.

**Balance, Phase 1 → 1b** (20 ritter matches):

| | Phase 1 | Phase 1b |
|---|---|---|
| Sites | 20/15/25/40 % | 40/10/25/25 % |
| Winner/last | Ø 1.78×, max 3.0× | Ø 1.54×, max 2.0× |
| Hunger events per match | 66 | 1 |
| Longest hunger | 86 s | 25 s |
| ruined / ignite per match | 37 / 81 | 21 / 49 |
| Plunders | 0 | 0 |

### Phone and TV — as built (Phase 1b, C2)

**Tests:**
- flow: 257 checks;
- the phone autotest: steps 1–19, `AUTOTEST OK` in landscape and portrait;
- `test-allgames.js` green.

**Phone (`controller.js`, `warmap.js`):**
- **Send button (deviation from P6):** ⚔️ Truppen has no banner rows but its 4-chip target
  grid, so it gets **one** contextual button, „📍 Fahne II schicken“, for the selected banner.
  It is hidden for the Burgwache.
- **Arming a banner:**
  - tapping a chip, or an own banner pin on the map, arms that banner;
  - a gold ring marks the pin, and the line reads „📍 Tippe aufs Ziel für Fahne II“;
  - the next map tap sends it, with the same snapping and route check as a drag;
  - tapping the chip again disarms it.
- **`warmap.js` change:** a pin tap without a drag used to order the point 46 px above the
  finger; now it only picks the banner. New: `map.setArm(n)`, `map.sendBanner(n, x, y)`.
- **Advisor:**
  - The line shows only when a tip applies, may wrap to two lines, and ✕ snoozes a tip for
    150 s.
  - It is hidden while placing a building.
  - Tip 10 also arms the first banner with soldiers. Tip 1 follows the phone's 4-s hunger hold.
  - Tip 2's 90 s count on the phone clock from the first finished Hof.
  - Tip 6 order: stone, wood, grain. The grain text is „🌾 Korn voll – bau einen 🏚️ Kornspeicher“.
- **Pause UI:** the change shows at once and the next `ffBoard` confirms it. A refusal toasts
  and restores the old state after 1.8 s; success makes no toast.
- **Layout:**
  - the ❓ sits in the second top row (the shell's „✕ Abbrechen“ covers the host's first row);
  - in portrait the host's first row is 36 px;
  - landscape phones under 960 px drop the words „Haus“/„Ruhm“;
  - portrait phones under 700 px tall get a shorter map.
- **Guide:**
  - its ✕ is on the left;
  - the back gesture works through `history.pushState`/`popstate`;
  - the pulse flag is `localStorage` `ffGuideSeen`;
  - the info scrolls while the confirm buttons stay put.
- **Short texts:** the build cards show a short `kurz` line; the full *Wozu* text is in the
  placing panel, the card and the guide.
- **Numbers in texts:**
  - `FARM_FEEDS` (`controller.js`) holds the farm number for „1 Hof ernährt etwa N Leute“;
  - the guide (`GUIDE`) states 6 s between arrivals, „nie unter 4“, Burg 8 / Hütte +4,
    „etwa 1 🌾 pro Minute“ per person, the 12-field radius for Brunnen and Burgbrunnen, the Ruhm
    values, the crown at 10 ahead × 1.5, and pacts of 3 min with −5 Ruhm and Zorn +25 % for
    1 min;
  - the building texts equal the Phase 1b table.

**TV (`screen.js`, `fx.js`, `sound.js`, `meta.js`):**
- **T1:** the 💤 is a procedural „Zzz“ badge in the existing camera-facing quad mesh, with no
  extra draw call or texture.
  - `SIGN_R` 2.3 (≈ 60 px at 1920 px).
  - In the Kampf-Kamera inset it faces the main camera, like the other billboards.
- **T2:** `buildDone` is neither forwarded to `FurtSound` nor in its table. `build` and
  `rebuild` share one 2-s limit, at volume 0.25.
- **T3:**
  - **Safety valve (ours):** ≥ 10 frames over 250 ms within 20 s count as sustained slowness,
    so a picture at 4 fps is still judged.
  - **Steps:** „🔍 Auflösung auf Normal gestellt“ (`setCap(0, 0)`), then, after a fresh 10-s
    window, „🔋 Grafik auf Sparsam gestellt“. `autoDone` is set only after the Sparsam step.
- **T4:** `dauer` 6–40, default 20, also in the glue clamp and the harness.
- **T5:**
  - `ffPause` is accepted for the sender's own finished workplace (`CONST.BUILD[kind].workers > 0`);
  - refusal toasts: „❌ Das gibt es nicht mehr“, „❌ Nur Hof, Holzfäller und Steinbruch können
    ruhen“, „❌ Nur fertige Betriebe können ruhen“, „❌ Das geht gerade nicht“.
- **T6:**
  - „🔇 Klick oder Taste für Ton“ shows top left under the first house panel during `live`;
  - it is hidden when audio runs, is muted, or is unsupported/failed;
  - audio unlocks on `click`, `pointerup` or `touchend` and resumes any non-running state.
- **Debug and harnesses:**
  - `_debug()` also returns `capDropped`, `banners` and `soundHint`;
  - phone presets: `guide=1|<section>`, `advice=1..10`, `card=paused`, `food=low`, `arm=1..3`;
  - TV presets: `?pause=1|hof`, `?cam=x,y,dist[,el]`.

**Known gaps:**
- touch, vibration and the back gesture are tested only synthetically;
- the sound unlock is unheard on a real device;
- on 320 × 568 the recruit buttons need a scroll;
- no tip fires in the first minute until something goes wrong (the pulsing ❓ is the only
  pointer).

### Bots (`bots.js`) — as built (Phase 1 W2, B3)

**API:**
- `FurtBots.create(sim, lord, { strength, seed })` → `{ step(), stats, info(), strength, lord }`,
  plus `FurtBots.PROFILES`.
- It never throws; an unknown strength falls back to ritter. `opts.trace` is for debugging.
- It uses only the public sim API and is deterministic.

**Takeover:** create a fresh bot on the existing house at any time and step it before each
`sim.step()`. It adopts the running banners. When the human returns, stop stepping it; the
banner orders stay.

**Behaviour:**
- **Economy:** opening with 3 farms, a woodcutter and a quarry; farms only within carrying
  distance of a store; door-aware spots; wells right after the Kaserne (up to 6).
- **Army:** recruits come only from hands no workplace needs. Guard first, then a 1-torch probe
  at the Fehde, then the field army (banners 1–2). Torch squads (banner 3) come late.
- **Targets:** ritter go for the crown, kriegsherr for the weak, knappe for the nearest.
  Economy buildings first, then military, then the keep. Retreat below 40 %.
- **Pacts:** accepted from stronger houses or while fighting someone else; never offered, never
  broken.

**Test `test-furtfehde-bots.js`:** 43 hard checks and soft goals, ≈ 50 s with worker threads.
Switches: `FF_QUICK=1`, `FF_JOBS=n`, `FF_TUNE='{"EAT_S":60}'` for what-if `CONST` overrides.

**Balance** (20 matches with 4 ritter bots, default `CONST`):

| Measure | Value | Target |
|---|---|---|
| wins per site | NW 10 · NO 30 · SW 25 · SO 35 % | met |
| winner / last Ruhm | Ø 2.25×, max 5.8× | the max is missed |
| plunders | 1 in 20 matches | missed (bot-limited) |
| first fight after the start of the Fehde | median 9 s | met |
| longest hunger | 86 s (2 of 80 houses over 60 s), after the route fix below | missed |
| step time | sim 0.31 ms, bots 0.22 ms | met |
| 1 kriegsherr vs 3 knappe | kriegsherr wins 95 % | met |

**No `CONST` was changed**, because the sim test pins the values. What-ifs:
- `EAT_S` 45 → 60 fixes the ratio and most of the hunger, but the mixed matches fall to 60 %
  (the knappe handicap would need retuning).
- Keep HP 1500 → more plunders.

**Main-session fix (2026-11-09), from B3's finding:** peasants kept following stale routes after
a building went up (they could stand ≈ 100 s at a new Brunnen).
- Routes now replan when `gridVer` changes (`p.gv`).
- `nudge` reports only real movement, so stuck walkers notice and replan.
- All four test suites stay green; the longest hunger went from 106 s to 86 s.

**Open findings for Phase 2 / polish:**
- the keep door jams with ≈ 10 idle peasants;
- fire dominates destruction, and the bucket chain flees from raiders;
- `suggest` ranks by distance to the keep centre, not by door distance (doors face south/west
  while the southern keeps' gates face north);
- plunders are rare because the main armies launch late (median t ≈ 600 s).

### Glue (`screen.js`) — as built (Phase 1 W3, B5)

**Files and tests:**
- `screen.js`, `meta.js` (the six settings), `dev-furtfehde.html`, `test-furtfehde-flow.js`.
- The shell tags follow the doc's load order. `package.json` chains world → sim → bots → flow into
  `test`, and adds `test:furtfehde`.
- `npm test` is green, all games included (≈ 6 min).
- The flow test has 187 checks in 4 scenarios: 5 phones on 4 houses with one shared house;
  takeover and return; 9 phones; settings, fill mode and the WebGL fallbacks.
- The existing `test-werwolf-flow.js` timing check (≤ 60 ms spread) can fail when the machine is
  busy: rerun it quietly.

**Protocol as sent:**
- `ffInfo` (always with `costs`; `shared` = the co-player's name or `false`) goes out on start, on
  every seat change and on host change.
- `sendFull(id)` sends ffInfo, ffMap, ffLevel, ffPhase, ffYou, ffBoard (and ffResult after the
  end). It runs on start, on a late join (+120 ms), when a spectator is seated, and on
  `onReconnect`; `canResume`/`onReconnect` are implemented.
- **Rates:** `ffYou`/`ffBoard` evaluated every 520 ms and sent when changed (`ffYou` also every
  4 s); `ffLevel` every 260 ms; `ffPhase` on change and every 10 s.
- **Alerts:** routed per house. Fire at most one per 12 s per house, hunger one per 30 s.
- **Toasts:** a German text for every reason code, plus „🔨 … wird gebaut“, „✅ … ist fertig“,
  „💥 … ist zerstört“, „💰 Beute“.

**Seating:**
- Round-robin as specified. A returning device id gets its old house back, and a freed seat goes
  to a waiting spectator before a bot takes over.
- House colours stay fixed for the whole match (the view has no `setColor`).

**Kampf-Kamera:**
- It opens at ≥ 8 distinct soldiers in `fight` within radius 8 over the last 2 s (`FIGHT_MIN`;
  the doc said 12), on a `hit` to an unprotected keep, and on a plunder.
- It shows for 7 s, then 12 s cooldown; high only. The label names the nearest keep (< 15) or
  crossing (< 24).

**Display:** a fixed 100vw × 100vh wrapper; internal size = window × DPR;
`aufloesung: nativ` → `view.setCap(100000, 100000)`. The Mitschauen mirror (letterboxed,
125 ms) is skipped while nobody watches.

**HUD:**
- four corner panels with heraldic shield, house and owner, Ruhm, 👑, people, soldiers, goods,
  icons 🔥 ⚔️ 🍞 🤝 🛡️ 😠;
- a clock chip with a progress bar; keep name tags with an HP bar; banner labels („I · 7“);
- a herald with the last 3 lines; big banners;
- an end screen with the titles Schlächter, Baumeister, Brandstifter and Diplomat.

**Harness `dev-furtfehde.html`:**
- `n=0` puts bots on every house; `n=1..8` seats stand-in humans driven by bots over the protocol.
- `until=fehde|ebbe|lastminute|plunder|end`, `plunder=<s>` and `pact=<s>` force those events.
- Also: `sim`, `bench`, `blit`, `seed`, `burgen`, `dauer`, `burgfrieden`, `staerke`, `quality`,
  `aufloesung`, `dbg`, `watch`.

**Known gaps:**
- **Budgets:** a real bot match at minute 5 draws **268 calls on high and 139 on low**, above the
  budgets, which assumed ≈ 40 buildings. One draw call per building does not scale: instance the
  finished buildings per kind (phase 2 / polish).
- **Balance:** plunders are rare in bot matches, and fights stay small.
- The corner panels cover a little land at the map corners.
- Touch and vibration are untested on real devices.

### Phone (`controller.js`, `warmap.js`) — as built (Phase 1 W2, B4)

**Files and autotest:**
- `controller.js` was rewritten with the Phase 0 behaviour kept.
- `warmap.js` gained (additively) ruins, `setSelected`, `ping(x, y)`, `setPartners`, a
  spectator mode (`me = −1`), and `pick()` distances.
- The harness's fake screen loads `sim.js` and builds `ffInfo.costs` from `FurtSim.CONST`.
- `?autotest=1` → `AUTOTEST OK` (14 steps). The touch step needs
  `dom.w3c_touch_events.enabled = 1` in the profile.

**What the glue must send — screen → phone:**
- **`ffInfo { lord, color, host, lords, shared, costs }`**
  - on seat, join, host change and bot takeover; **`costs` in every `ffInfo`**;
  - `lords` ordered so that index = `i`;
  - `lords[].name` = „Haus Falkenstein · Anna & Ben“ or the bot name; the phone splits at
    „ · “;
  - **`shared` = the co-player's name** (a string), only to the phones of a shared house;
  - `lord: −1` = spectator.
- **`ffMap`:** unchanged; send `ffLevel` right after it. An `ffMap` or a non-`over` `ffPhase`
  after `ffResult` counts as a rematch: the phone leaves the end view.
- **`ffPhase { phase, endsAt, now }`:**
  - phases: `frieden` · `ebbe` · `fehde` · `over`;
  - „⏳ Letzte Minute“ is derived on the phone from `endsAt − now ≤ 60`.
- **`ffYou`:** the Phase 0 fields plus
  - `hunger` (the phone holds the red 🌾 for 4 s);
  - `pacts` (= `youOf().pacts`, absolute `until`);
  - `banners` (= `youOf().banners`: the Burgwache count and `tx/ty` for the order line);
  - **`now` (sim s) in every `ffYou`**, for the pact timers.
- **`ffBoard.b` rows:** `[id, lord, kind, i, j, rot, build, hp, fire, ruined, noWood, workers]`.
  `workers` (12th field, the number of assigned workers) drives „arbeitet / wartet auf Arbeiter“.
- **`ffAlert { kind, text, x?, y? }`:**
  - own-house kinds (`attack`, `fire`, `hunger`, `plunder`) go only to that house's phones;
    `crossing`, `pact` and `crown` may go to everyone;
  - `x, y` put a ping on the map;
  - send `{ kind: 'pact' }` to the target house on `pactOffer`;
  - throttle `hunger`.
- **`ffResult { ranking }`:** the sim's ranking rows unchanged, to every phone, together with
  `ffPhase over`. The 🔁 button follows `ffInfo.host`, so re-send `ffInfo` on a host change.
- **Reason codes never reach the phone:** turn refused orders into German `ffToast`s
  („❌ Zu wenig Holz“, „🌊 Kein Weg – die Fahne wartet am Ufer“, …).

**What arrives — phone → screen:**
- `ffBuild` on a ruin's footprint = rebuild.
- `ffCancel { id }`.
- `ffBanner`, also for not-yet-existing banners (rally point).
- `ffHome`, `ffPact { to, on }` (the phone confirms breaks itself), `ffAgain` (host only).
- `ffBuild` and `ffRecruit` are sent only when `ffYou.stock` covers the cost.

**Fixed texts on the phone:** pact „3 Min“, offer countdown 30 s, betrayal
„−5 Ruhm, +25 % Zorn 1 Min“.

**Known gaps:**
- touch and vibration tested only synthetically;
- no card for the keep;
- no fire, Zorn or protection indicator in the strip;
- the phone has no sounds.

### Sim (`sim.js`) — as built (Phase 1 W1, B1)

**Tests and performance:**
- `test-furtfehde-sim.js`: 2182 checks in ≈ 10 s. Determinism over 6000 steps; 3 full 12-min
  matches with a dumb driver; all 37 documented event types observed with exactly the documented
  fields.
- Step time: Ø 0.04 ms in a match; 400 units fighting 0.27 ms; 640 units 0.55 ms.
- `world.js` additions (additive): an optional block mask for `field(g, targets, L, out, block)`,
  `path(g, from, to, L, { block, look })` and `pathTime(…, block)`. `test-furtfehde-world.js`
  now has 8562 checks.

**Costs — single source of truth:**
- `FurtSim.CONST.BUILD[kind].cost` and `FurtSim.CONST.UNIT[unit].cost` (`{ korn?, holz?, stein? }`).
  `CONST.REBUILD_COST` = 0.5.
- The `draft` costs in `world.js` are stale.
- **Protocol addition:** the glue sends
  `ffInfo.costs = { build: { kind: cost }, units: { unit: cost }, rebuild: 0.5 }`, built from the
  sim's `CONST`. The phone prefers it over the `world.js` drafts.
- **Protocol addition:** `ffBoard.b` rows carry `noWood` (0/1) as an optional 11th field, after
  `ruined`.

**Extras and shapes:**
- Extras: `sim.world`, `sim.seed`, `sim.occ` (a Uint8Array with 1 + BUILDINGS index per cell; keeps
  = 1). Use it with `FurtWorld.canPlace/suggest(…, { L: state.level, occ })`; `canPlace` takes the
  **site** as `lord`. `sim.dev` holds test hooks only.
- Public objects carry only the documented fields (private data sits in a non-enumerable `_`).
  Extra: `noWood` on Holzfäller buildings.
- Units and buildings share one id counter. Banner `id = lord·4 + n`.
- **`state.banners`** holds only existing banners 1–3. **The Burgwache is not a banner entry**: its
  units have `n = 0`, and it appears only in `youOf(lord).banners` with `n: 0`.
- An order to a non-existent banner is a rally point for its future recruits. When a banner dies
  out, its target resets to its post.
- Unit `hp` is absolute; building `hp` is a fraction.
- Times are sim seconds: `endsAt`, `until` and `offerUntil` are absolute; `prot` and `zorn` are
  seconds left.
- `people` includes recruits in training.

**`youOf(lord)`:**
- integer `stock`; `cap { korn, holz, stein }`; `idle`; `hunger` (bool); `queue [{ unit, n, p }]`;
- `pacts`: every other house as `{ with, state: 'none' | 'offered' | 'incoming' | 'active', until }`.
  `incoming` drives the phone's prompt.

**`ranking` rows:**
- `{ rank, lord, ruhm, people, soldiers, buildings, stats, by }`;
- `stats`: `kills, lost, razed, crops, plunders, built, ignites, pacts, betrayals`;
- `by` (the Ruhm breakdown): `kills, buildings, crops, plunder, prosperity, betrayal`. Use these
  for the titles.

**Events:**
- Events caused by API calls are returned by the **next** `step()`. `frieden` fires on step 1.
- `leave` fires when the peasant is gone (after ≈ 14 units of walking). `plunder.loot` is what
  the attacker received after its caps. `pactOn.a` is the offerer.
- `hit.id` is a unit or building id (shared id space).
- `attack` fires on the first non-fire enemy damage, at most once per 10 s per house.
- **`hunger` flaps** on and off every few seconds when food is scarce: the glue must throttle the
  herald and the icon.

**Reason codes:**
- `build`: `lord`, `kind`, `phase`, `bounds`, the `canPlace` reasons, `cost`, `wet` (also: no dry
  way from the keep).
- `cancel`: `lord`, `phase`, `none`, `kind`.
- `recruit`: `lord`, `unit`, `banner`, `phase`, `kaserne`, `pop` (fewer than 2 peasants would
  remain, or the queue holds 12), `cost`.
- `banner`:
  - accepted (`ok: true`): `snapped` (the target becomes the cell centre) or `unreachable`;
  - refused (`ok: false`): `pact`, `none`, `lord`, `phase`.
  - "Reachable" means the leader's connected area at the current level, with footprints blocked.
- `pact`: `lord`, `self`, `zwei`, `phase`, `none`; the answer always carries `state`.

**Peasants — `anim`/`carry`:**

| Activity | anim | carry |
|---|---|---|
| idle or waiting | idle | null |
| walking empty | walk | null |
| carrying goods | walk | the good |
| waiting at a full store | idle | the good |
| builder on the way to the site | walk | holz or stein |
| chop, quarry, sow, harvest, build, training | work | null |
| bucket chain: fill / carry / pour | work / walk / work | null / eimer / eimer |
| cornered | fight | null |

Soldiers use idle/walk/fight; torch-bearers show `work` while igniting.

**Rules decided:**
- **Crops:** growth 0.05 at sowing, then +1/45 per s.
- **Ruhm:** prosperity is not crown-multiplied; Ruhm may go negative; spreading fire credits the
  igniter.
- **Stores:** the nearest accepting store by straight distance.
- **Peasant pulling:** after 3 s without an idle peasant for a site or recruit, the nearest worker
  is pulled. At most 3 recruits per house on their way or training at once.
- **Burgwache:** posted 6 cells in front of the gate, leash 20 from the keep. Soldiers retaliate
  against attackers up to 14 away.
- **Plunder:** the Burgwache dies silently. Every other house's banner with a target within 16
  goes home, with an `order` event each.
- **Flood:** the level is bucketed into 26 steps; the `open` thresholds fall on bucket edges.
- **Arrows:** they always hit (homing); damage is computed at launch.

**Known gaps:**
- untuned balance: the dumb driver starves and rarely plunders, so tuning falls to the bot
  tournament;
- crowds only push each other (no unit-versus-unit pathing);
- archers never kite;
- not yet run in a browser.

### Fx, sound and view additions — as built (Phase 1 W1, B2)

**Files:**
- `fx.js` (`FurtFx`) and `sound.js` (`FurtSound`) are new.
- `render.js`: keeps of sites 2/3 (and ruin keeps) turned by π; `view.inset`; `fx.setWorld`; the
  fire stand-in is off whenever `this.fx` exists.
  - **Fixed:** state lords without a `color` no longer wipe the view's colours.
- `terrain.js`: whitewater over up to 4 submerged decks (`uDeckA/B` from `land.decks`), with no
  measurable cost.

**Budgets** (headless software GL):

| Quality | Calls without fx | Calls with fx | ms |
|---|---|---|---|
| high | 142 | 146 | ≈ 20 → 20.8 |
| low | 78 | 82 | ≈ 6.2 |

- **fx itself uses 4 calls** (soft Points, additive Points, one quad mesh, the dome); 3 when no
  house has `prot`.
- **Decision (main session):** the low total budget becomes **≤ 85 calls**, pending the M7 bench.
- **Kampf-Kamera inset:** +40 calls / +381 k tris in its own pass, ≈ +0.6–1.8 ms. `view.drawCalls`
  stays main-pass only; the inset reports `insetCalls/insetTris/insetMs`.

**Glue duties:**
- for every sim event: `view.event(ev, sim.state)` (forwards to fx) **and**
  `FurtSound.event(ev)` (maps events to sounds, rate-limited);
- per frame: `view.render(state, alpha, { now, dt })`;
- at the match end: `FurtSound.ambience(null)` and `FurtSound.battle(0)`.

The view creates fx in `setWorld` and calls `fx.pass`/`fx.setQuality` itself.
`view.fx.setEnabled(bool)` and `view.fx.stats` exist.

**Inset:**
- `view.inset({ x, y, w, h } internal px top-left, { x, y, dist })`: call it every frame while
  the Kampf-Kamera is on (the focus is eased); `null` turns it off; a no-op on low.
- It draws a 2 px dark + 2 px gold frame itself. The HUD draws the label using `view.insetRect`.

**FurtSound:**
- `play(name, { vol, force })` for the 15 names of the contract.
- `ambience('calm' | 'flood' | 'battle' | null)` with 3 s crossfades.
- `battle(level01)`: a layer of drums from 76 to 126 BPM, plus toms, rims, clashes and shouts.
- `event(ev)`, `unlock()` (it hooks pointer, key and touch itself), `stats`.
- Mute check `sfx.muted === true`. Calls made before the unlock replay the last 6 one-shots.

**fx reads:**
- `lords[].prot` and `zorn`;
- buildings: `fire`, `hp`, `build`, `ruined`, `burnt`;
- units: `x, y, px, py, anim`; banners: `id, lord, n, x, y, px, py`;
- the level via `land.surf`.

Every sim event shape was checked against `sim.js`'s field names.

**Known gaps:**
- billboards face the main camera, so they look slightly off in the inset;
- birds are simple;
- smoke is not depth-sorted;
- the sound mix is still unheard;
- no M7 measurement yet.

### World (`world.js`) — as built (wave 1, A1)

**Extra exports:** `CI` (class index by key), `components(g, L)`, `keepMask`, `footprintOf`,
`pathTime`, `PAIRS`, `SITE_NAMES`, `mulberry32`, `_gen` (test hooks).

**Tests and timings:**
- `test-furtfehde-world.js`: 8551 checks in ≈ 7 s.
- `make` ≈ 44 ms, `field` ≈ 1.2 ms, `path` ≈ 0.9 ms (max 7.8), `suggest` ≈ 0.3 ms.

**Fairness over 30 seeds:**
- area ±3.7 %, buildable ±4.4 %, Aue ±14.4 %;
- forest and rock are equal per quarter by construction;
- pair spread ≤ 6.5 %;
- no seed needs a retry.

**Classes come from `hq`** (decimetres, rounded half up):

| Class | hq |
|---|---|
| W | ≤ −5 |
| F | −4 … −1 |
| S | 0 … 1 (forced sandbanks up to 5) |
| A | 2 … 11 |
| G | ≥ 12 |

Overlays:
- B: decks and causeways, hq ≥ 4;
- M: on A, hq 2–6;
- T and R: on G;
- H: one crag per quarter, ≈ 15 cells.

**The flood rule is evaluated in integer decimetres:** `depth = 12·L − hq`. Wading when > 0,
blocked when > 4.5, dry when ≤ −0.5.

**Decks:**
- Steinbrücke hq 6, Stege hq 5, causeways max(terrain, 6).
- **`open`: Steinbrücke 0.875, Stege 0.792** (≈ 0.04 above the text above). Fords 0.042 or
  0.125: both river fords are always equal, the stream fords are independent.
- The crossing record carries the nominal model deck height `deck` (0.55 / 0.45 / null).

**Crossing records:**
- Extra fields: `ends` (two bank points), `joins` (`[s, s]`), `deck`, `hq`. Fords add
  `fin`/`fout`. The bridge adds `spans`: two `[from, to]` distances along the axis from the
  north end, with earth under the deck between them (the island).
- `rot` = heading from `ends[0]` to `ends[1]`: ≈ π/2 for river crossings, 0 for stream crossings.
- `len` = deck length (bridge, Steg) or the wet length (fords ≈ 8).
- `cells`: for fords, all F and S cells of the corridor (≈ 200); for bridge and Steg, exactly
  the B cells.

**Sites:** `sites[].x/y` is the keep centre (an integer cell corner), with |x| 42–50 and
|y| 24–31. The plateau is flat at h 3.5 to radius 7.6. Keep footprint cells have hq 30 (the clamp).

**Werder:** extra `wa` (arm water width) and `xb` (bridge axis x). `rivers[0]` runs through it
(`w` widens to 6.1–6.8). The ruin stands on the island's west part.

**Streams:** they run from |y| = 66 to the river. Mouths at x ≈ −8…−7 (Nordbach) and 7…8
(Südbach). **The Steg is the far crossing (y = ±26…34), the Furt the near one (±12…16).**

**`heights`:**
- Index `v·HX + u`, with x = −84 + u/2 and y = −57 + v/2.
- It includes the beds, the flat ford bars, sandbanks, the island and the 0.6 causeways.
- It does **not** include the bridge or Steg decks: the river bed lies beneath them.
- The border waters run out at −1.65 (river) and −0.7…−1.0 (streams).

**`flow`:** index `(fj·FX + fi)·2`; cell (fi, fj) covers x ∈ [−84 + fi, −83 + fi). Speeds:

| Water | Speed |
|---|---|
| river | 1.0, falling to 0.55 at the banks |
| streams | 0.6, falling to 0.33 |
| floodplain below 1.2 | 0.25 |
| elsewhere | 0 |

There is no blending at the stream mouths.

**Trees and decor:**
- `trees`: the index is a stable id. T cells hold 1–2 trees; border trees have `k = −1`.
- About 14 solo meadow trees per quarter stand on G cells, **so a building footprint can
  overlap a tree: the view hides trees on occupied cells** (Phase 1: the sim fells them).
- `rocks`: the border ones have `k = −1`. `deco` has no `k`.
- `roads`: exactly 3 per keep, from the keep wall to the bank side of the crossings.

**Codec:**
- The `owner` string encodes keep footprint cells as `5 + site`. `decode` returns `owner` plus
  an extra `keep: Uint8Array`. About 12 KB in total.
- **After `decode`, set `grid.crossings = msg.crossings`**, because `suggest` uses it.
- `ffMap.crossings` should drop `cells` (large) and carry `id, kind, name, x, y, rot, len, open,
  ends, joins`.

**Helpers:**
- `canPlace`: `lord` is required; `bergfried` → `occupied`; T or R under the footprint →
  `terrain`; `forest`/`rock` = a missing requirement.
- `suggest`: `occ` values may be `1 + index of the BUILDINGS key`, which enables smarter
  heuristics; any non-zero value counts as occupied.
- `path`: A* plus exact line-of-sight smoothing (a shortcut only if it is not slower). The array
  carries `.cost` (= the field value), `.len` and `.time`. A 5th argument `{ look }` limits the
  smoothing. Returns `null` if an end is blocked or outside.
- `field`: `Infinity` means unreachable.

**Preview `dev-furtfehde-map.html`:**
- Extra URL params `s` (px per unit), `view=x0,y0,x1,y1`, `ex` (hillshade exaggeration),
  `panel=0`.
- Layers: classes, shade, owner, flow, water, trees, deco, roads, sites, cross, cells, build.
  A 🌊 button plays the ebb.

**Known gaps:** no cliffs at cut banks; flow not blended at the mouths; the river meanders look
fairly regular (topic for feedback 1).

### Landscape and view (`terrain.js`, `render.js`) — as built (wave 2, A3)

**Measured** with the full fake state (4 lords, 40 buildings + 4 keeps, 292 units, 8 banners),
shadow pass included, in headless Firefox:

| Quality | Size | Calls | Tris | Frame |
|---|---|---|---|---|
| high | 1920 × 1200 | 143 | 448–464 k | ≈ 20 ms |
| low | 960 × 600 | 78–79 | 161–164 k | ≈ 6 ms |

- Budgets are met, but **high has only ≈ 7 calls of headroom for fx**.
- High breakdown: land 26 calls / 291 k, buildings 52 / 27 k, keeps 4 / 10 k, units 5 / 82 k,
  banners 8 / 0.7 k.
- `setWorld` takes ≈ 105–130 ms.

**Terrain handles:**
- Meshes and state: `land.ground`, `land.water`, `land.U` (shared uniforms), `land.level`,
  `land.surf`.
- Queries: `land.heightAt`, `land.waterDepth(x, y)`.
- **`land.standY(x, y)`** returns the deck height on bridges and Stege. Anything standing on a
  bridge must use `standY`.
- `setTrees(Float32Array)`.
- `setBlockers(rects)` hides trees, rocks and deco inside building footprints. The view passes
  the building rects plus 8 × 8 around each keep.
- `resetWet()`.

**Water geometry:** depth is computed per fragment from the ground's own vertex buffer, with no
height texture. The water index is sorted by each quad's lowest corner, so L is a `drawRange`
prefix: 17 k tris at L = 0, 40 k at L = 1.

**Display heights are smoothed** (2 × [1 2 1] below 1.5, fading out by 2.6; at most 0.37 off,
at ford edges). Rules and the sim keep using `FurtWorld`; actors use
`land.heightAt`/`standY`.

**Ground:**
- Mesh: high = every vertex in the playable rectangle and every second one in the border;
  low = 1-unit spacing inside, 2-unit in the border.
- Material: patched Standard (high) or Lambert (low), so it takes the same lights and
  `PCFShadowMap` as the art.
- Colour map at vertex resolution, roads drawn via canvas. The shader adds mottling, cloud
  shadows, the dynamic layer, shore dampness and edge haze.
- **Dynamic layer** `setGround(k, { burnt, path, plot })`: RGBA8 `GW × GH`, uploaded in
  `update`. The view drives `plot` from construction and `burnt` from fire; Phase 1 may write
  `path`.
- **Wet memory:** a high-water mark that sinks 0.014 u/s. The wet amplitude fades over 70 s
  once L < 0.03; `snap` resets it.

**Driving the terrain:** `land.update(t, dt, { sunDir, sunCol, amb, sky, haze })`, with defaults
when only `{ sunDir, dayT }` is given. `uFlood = smoothstep(0.12, 0.95, L)`.

**Water look:**
- clear/turquoise up to depth ≈ 0.45, deep beyond;
- two-phase flow from `world.flow`;
- shore foam (also around sandbanks), white water on fast shallows, flood froth;
- sharper normals for the glints;
- three-tone silt during floods.

**Vegetation and edges:**
- Forest and border trees use the low tree model even on high. Border trees more than 8.8
  outside the playable rectangle are dropped.
- Interior trees cast shadows through ≈ 8-tri proxies.
- `H` cells get 2 boulders each (`world.js` has no model for them).
- Edge haze: the clear colour equals the haze colour; ground and water fade between 3 and 11.5
  units outside the playable rectangle.

**View API:**
- Handles: `view.land`, `view.sunDir`, `view.cur`, `view.project`, `view.buildingObj(id)`,
  `view.keepObj(lord)`, `view.bannerObj(id)`.
- `setQuality` recreates every actor object, so never cache art handles across a switch.
- `render(state, alpha, { now, dt, snap, draw })`: `draw: false` runs only the CPU update.
  **`render` calls `FurtArt.tick` and `setNight` itself.**
- **Camera:** FOV 24°, elevation 58°, looking north. `frameGame()` fits the playable box
  (+3 %) at any aspect. `debugCam(preset | { x, y, dist, el, az, h } | null)`.
- **Light:**
  - a `KF` table, with az 0 = east, 90 = south, 180 = west; low suns stand on the north side so
    they glint on the water;
  - `night = smoothstep(0.85, 1, dayT)`;
  - the key light stays ≥ 15.6°, and the shadow camera is refitted every frame.

**State conventions:**
- `units[].lord` and `buildings[].lord` are the lord index `i`.
- **Keeps:** `setWorld` builds one per lord. A `bergfried` entry in `state.buildings` only drives
  that keep's hp/burnt/ruined. Empty sites get a grey ruined keep.
- **Buildings:** keyed by `kind:lord:rot:i:j` (a change recreates the object), placed at the
  mean height of the footprint. `fire > 0.05` stops the work animation.
- **Units:** caps per kind are bauer 460, speer 340, bogen 300, ritter 160, fackel 120; entries
  beyond a cap are dropped. Up to 1500 blob shadows.
- **Banners:** scaled × 1.55, no shadow.
- Low has no cranes.

**Fire and fx:**
- A built-in fire stand-in (flame cards + smoke, ≤ 2 calls) switches itself off when
  `window.FurtFx` exists.
- The fx hook works as in Skyfarers:
  - `new FurtFx(T, { scene, camera, quality, view })`;
  - `fx.update(state, alpha, { now, dt, dayT, sunDir })`;
  - `view.event(ev, state)` forwards to `fx.event`.

**Harness `dev-furtfehde-view.html`:**
- URL params: `seed, dayT, level, flood=1 (50 s cycle), quality, cam, actors=0, lords, units=N,
  bldg=N, t, w, h, pause, auto=1, ui=0, blit=1, bench=N, dbg=1|2|3, labels=1,
  test=fx,qswitch,dispose`.
- It loads `games/furtfehde/fx.js` optionally (a 404 is harmless today).

**Main-session fix after feedback 1 (2026-11-08):**
- `view.setCap(maxW, maxH)` overrides the internal-size cap; 0 restores the quality default.
- **Fill mode:** without `blit`, the harness fills the window. Internal size = window × DPR,
  capped by the quality; CSS stretches it. `res=native` or the „Auflösung“ button lifts the cap.
- **Bar:** „⛶ Vollbild“; in fullscreen the bar fades out after 3 s, and H toggles it.
- **Bench:** the bench mode shows a result box (avg incl. `gl.finish`, fps, size, calls, tris)
  and re-measures after a quality or resolution change. The black screen came from a canvas
  resize without a redraw.
- The stats line labels `lastMs` as CPU.
- The Phase 1 glue must likewise fill the screen and offer native resolution where the device
  can do it (the user's 4K monitor).

**Requests:**
- `world.js`: smoother banks and ford edges in `heights`; rocks on `H` cells; document the order
  of `ends` (aligned with `joins`).
- `art.js`: a no-crane option on low; `setColor`; lower-poly units if the M7 needs them (units
  are ≈ 82 k of 449 k tris).

**Known gaps:**
- no M7 bench;
- no reflections, refraction or caustics;
- the fire stand-in is crude;
- shadows are static;
- no camera breathing;
- units are not clamped out of deep water.

### War table (`warmap.js`, `controller.js`) — as built (wave 2, A4)

**Files:**
- `warmap.js`: its API is documented in the header.
- `controller.js`: registers only the controller module; no `meta.js` or shell tags yet.
- `dev-furtfehde-phone.html`: loads `game-registry.js`, `world.js`, `warmap.js` and
  `controller.js`. Opened as `?phone=1` directly on a real phone, it runs phone and fake screen
  in one page; 🛠 opens the panel.

**Autotest:** `?autotest=1` → `AUTOTEST OK`. The touch step needs
`dom.w3c_touch_events.enabled=1`.

**Costs** (headless, software rendering):
- dynamic frame ≈ 1.1–1.25 ms (max 2.0) at 518 × 348;
- static layer ≈ 20 ms per zoom preset (the other preset is pre-rendered 400 ms later);
- flood mask 13–19 ms, rebuilt only when L changes (≤ 10/s) or while mud fades;
- grid preparation 61–67 ms once per map;
- idle frames are skipped.

**Protocol as the phone expects it** (the Phase 1 glue must match):

*Seats and the map*
- `ffInfo.lord` is the lord index `i`, and `ffInfo.lords = [{ i, site, color, name, emblem }]`
  (the same as the view's `lords`).
- The grid's `owner` holds **site** indices, so the phone passes `lords[lord].site` to
  `canPlace`/`suggest`. Messages (`ffBoard` lords, banner `lord`) use the lord index.
- `ffInfo` and `ffMap` may arrive in any order.
- `ffMap = { grid: encode(world), sites: [{ s, name, x, y, keep }], crossings: [{ id, kind, water,
  name, x, y, rot, len, open, ends, joins, spans?, deck? }] }`, without `cells` (≈ 12 KB). The
  phone needs `ends` (fords can be diagonal) and `spans` (to draw the bridge).
- **Send `ffLevel` once right after `ffMap`**; the phone assumes L = 0 until then.

*State*
- `ffYou = { stock: { korn, holz, stein }, cap, pop, popCap, idle, queue: [{ unit, n, p }], ruhm,
  crown }`. `p` is 0..1; `n` is 0 (Burgwache) or 1..3 (banner). `[unit, n, p]` arrays are
  accepted too.
- `ffBoard`:
  - `b: [[id, lord, kind, i, j, rot, build, hp, fire]]`, with build, hp and fire 0..1 and
    hp 1 = full;
  - `banners: [[lord, n, x, y, count]]`, with the current position. **A banner missing from
    `banners` doesn't exist yet**; its pin waits south of the own keep;
  - keeps may be included as `bergfried` or left out (the phone uses `sites` + `grid.keep`).

*Orders*
- `ffBanner` is always sent on drop, also without a route. The phone warns with „Kein Weg“ (or
  „Hochwasser“ when L > 0.55) and shows a toast; the TV decides what an unreachable order means.
- The phone draws a dashed order line to the last target until the banner arrives (≤ 1.8) or
  2 min pass. The protocol has no target field.
- `ffBuild` is sent only when `canPlace` is ok **and** the draft cost is covered by
  `ffYou.stock`. `ffRecruit` only has a cost check. The TV validates everything again.
- Not handled yet: `ffPhase`, `ffPact`, `ffAgain` (Phase 1).

**Grid use:**
- `grid.crossings = msg.crossings` after `decode`.
- `occ` = `1 + BUILDINGS index` for every building of all lords.
- `path` returns `null` when the start cell is blocked. A banner standing in a ford when L rises
  therefore gets „Kein Weg“ for every target.
- Everything is drawn from `cls`, `hq`, `owner`, `crossings` and `sites`. The flow strokes come
  from a structure tensor on the water mask.

**UX decisions:**
- `mine` is the 0.4–99.6 percentile bounding box of the own quarter plus a 3.5 margin; `all` is
  the map plus a frame.
- An extra `free` camera: one-finger pan on the empty map, pinch, mouse wheel. A crisp static
  layer is re-rendered after the gesture.
- Touch lift: the ghost sits 56 px above the finger, a banner pin 46 px. No lift with a mouse.
- The flood mask follows the integer rule and is blurred for rounded fronts. Land that just
  dried shows mud for ≈ 24 s.

**Harness extras:** `view=`, `mud=1`, `crown=1`, `wait=1`, `to=<crossing id>`, `seed=`,
`bench=1`.

**Known gaps:**
- Touch was tested only synthetically.
- The portrait full map has only ≈ 2.6 px per unit (pinch helps).
- Building icons on the map are emoji.
- Vibration only, no sounds.
- Canvas fonts vary per device.

### Art (`art.js`) — as built (wave 1, A2)

Exports `FurtArt = { palette, tick, setNight, keep, building, units, banner, tree, rock, deco,
bridge, ruin, prop, emblems, stats }`. The gallery is `dev-furtfehde-art.html`, with
`?only=<section|kind>&quality=low&spin=0&t=<s>&anim=1&night=1&shadow=1&team=&cell=&pick=&el=&zoom=&fov=`.

**Measured** (tris / draw calls, high / low):

| Model | High | Low |
|---|---|---|
| keep | 2389 / 1 | 1509 / 1 |
| buildings | 172–1081 / 1 | 158–718 / 1 |
| under construction | ≤ 1.9 k / 3 | ≤ 1.9 k / 3 |
| units (per instance, 1 call per kind) | 183–429 | 122–232 |
| banner | 72–116 / 1 | 72–116 / 1 |
| trees (+ stump 45) | 55–111 | 30–58 |
| rocks | 80 | 80 |
| bridges | 206–872 | 172–390 |
| ruin | 488 | 330 |

All within budget. Measured in headless Firefox software GL only; no real GPU or M7 yet.

**Team colour**
- `building()`, `keep()` and `banner()` create their own material (one shared program per
  quality and kind). The lord colour is that material's `uTeam` uniform, set from `opts.color`
  (`'#rrggbb'`, a number or a `THREE.Color`).
- **There is no `setColor`:** create a new object instead.
- Units take the colour per instance (attribute `aTeamCol`, linear rgb; `set()` accepts a
  number or a hex string).
- Trees, rocks, deco, bridges, the ruin and props have no team surfaces and use shared cached
  materials.

**Disposal:** `building()`/`keep()` results expose `mesh`, `material` and `dispose()`. Call
`dispose()` when removing one; it frees the own material, not the shared geometry. Never
dispose the geometry or material from `tree()`, `rock()` or `deco()`: they are shared per quality.

**Materials:**
- Never replace or clone FurtArt materials, and never use `scene.overrideMaterial`: they carry
  `onBeforeCompile` patches and a `customProgramCacheKey`.
- Shadows work with the default depth materials, but the shadow shape is static: flag waves,
  sway and unit poses are not in the shadow pass.
- `building().mesh.castShadow` is false while under construction and true when finished. Units
  do not cast shadows by default (`mesh.castShadow = true` works).
- Use `PCFShadowMap`; r185 deprecates `PCFSoftShadowMap`.

**Per frame:**
- `FurtArt.tick(t)`: seconds, any monotonic clock. Drives flags, sway, unit animation and
  flame flicker.
- `FurtArt.setNight(n01)`: windows, torches, flames, embers.
- Every building's `animate(t, { working, night })`: it eases the working state (quarry
  derrick, well bucket) and swings the crane during construction. `night` is forwarded to
  `setNight`.
- `banner.animate(t, { moving })`: eases how much the flag streams.

**Units kit:** `kit.create(kind, max)` returns `{ mesh, count(n), commit(), set(...),
dispose() }`. The mesh is an `InstancedMesh` with `frustumCulled = false`.
- `set(i, x, y, z, yaw, anim, phase, rgb, carry)` takes scene coordinates with y up.
- **`yaw` is applied as `rotation.y`: pass `−h`.**
- `phase` is in turns and wraps (an id hash works). `carry` is used by `bauer` only; the
  `fackel` always carries its torch.
- `commit()` uploads only the used range.
- 13 vertex attributes: `aInst` (anim, phase, carry), `aTeamCol`, `aRig` (pivot + part id),
  `aGlow`, `aTeam`, `aWear`, … Anim 3 (`work`) shows the peasant's hammer.

**Geometry conventions:**
- Every model is centred on the origin with its base at y = 0. Plinths and rocks reach to about
  −0.15; the quarry's boulders to about −0.6.
- Doors and fronts face +z at rot 0. `hof`: long side along x, farmhouse in the north-west
  corner (x −2.5..−0.5, z −2..0).
- `opts.rot` presets `group.rotation.y = −rot · π/2`. The renderer may overwrite it: set it,
  don't add to it.

**Anchors** are `Object3D` children, so they follow the rotation:
- `door`: ground point in front of the door; `work`: where workers stand.
- `chimney`: on huette, hof, holzfaeller and kaserne.
- The keep has `flag` (pole top ≈ 12.6), `gate` (outside, +z) and `top` (parapet ≈ 8.8).

**Building states:**
- `setBuild(p)`:
  - p < 0.33: only the site mesh (pegs and string → footing → timber frame and scaffolding)
    plus the crane;
  - from 0.33: the walls rise, and the roof drops in at the end;
  - p = 1: the body only.
- `setBurnt` is scaled by 0.45 on stone buildings (soot).
- `setRuined(true)` swaps in a ruin mesh; the hof ruin includes burnt fields.
- `setGrowth` (hof only) defaults to 1.
- Extras: `building(T, 'bergfried', …)` forwards to `keep()`, and the keep has no-op
  `setBuild`/`setGrowth`/`animate`.

**Other models:**
- `banner`: pole base at the origin, flag along +x.
- `tree`/`rock`/`deco`: made for `InstancedMesh`. Sway phase and ±10 % brightness come from the
  instance position; `setColorAt` is honoured; bases at y ≈ −0.05.
- `bridge`: spans x −len/2 … +len/2, 2 wide, deck top at y = 0. Piers reach −2.4 (stein) or
  −2.0 (steg). `len` is rounded to 0.25; the stone bridge has `round(len / 5)` arches.
- `prop(T, kind, { quality })`.
- `emblems[i] = { name, fit: 'wide' | 'square', polys }`: convex polygons in [−1, 1], y up.
  The phone map can draw them directly.

**Known gaps:**
- Peasants vary only in brightness.
- The ritter with lance and plume is ≈ 2.4 high.
- Cream emblems look light grey in side light.

## Later ideas

- **Siege:** walls drawn with the finger, gates and wall towers, ram and catapult; Eroberung mode
  with robber knights.
- **Seasons:** a spring flood mid-match, a harvest festival, winter with a frozen river that is
  walkable everywhere; burnable and rebuildable bridges.
- **Economy:** mill → bakery, smithy, market and gold.
- **Atmosphere:** a herald voice (reuse Werwolf's narrator), generative music.
- **Players:** alliances and 2v2, lord and marshal roles.
- **World:** map types (lake district, mountain pass, delta), events (wolves, merchant train,
  robber knights).
- **Personal touches:** a coat-of-arms editor on the phone, photo mode.
