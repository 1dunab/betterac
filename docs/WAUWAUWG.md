# 🐶 Wauwau-WG — design notes (Phase 1)

![Wauwau-WG on the TV](screenshots/wauwauwg.png)

A cozy Nintendogs-style dog game for Party Hub. Every player owns a dog. The **TV** is
the shared flat ("WG"), street and park where all dogs live, play and sniff around
together. The **phone** shows *your* dog up close: pet, brush, feed and bathe it with
touch gestures, walk it on a leash, throw its toys, shop.

**Your dog lives on your phone** (`localStorage`) and comes back next game night with
its love, toys and Taler. The TV additionally keeps a backup per player name.

> Player-facing text is German with emoji. Docs and code comments are English.

## Phase 1 scope

| Feature | Status |
|---|---|
| Adoption (Tierheim): 8 breeds × 3 coats, name with 🎲 ideas, restore offer from the TV backup | ✅ |
| Care on the phone: pet (favorite spot), brush, feed (kibble / meat), water, treats, three-step bath | ✅ |
| Needs: food, water, clean, mood, energy — they only change while the game runs | ✅ |
| Love (Zuneigung) with 6 levels, daily caps per source | ✅ |
| Gassi: leash, sniff spots + digging, loot, puddles, poop pickup, cat chase | ✅ |
| Park: swipe-throw ball / frisbee / duck / stick, air catches, steals, tired dogs nap | ✅ |
| Shop (food, treats, shampoo, frisbee, duck); sell walk finds from the bag | ✅ |
| Day loop with night summary + "Hund des Tages" for the evening scoreboard | ✅ |
| Persistence on the phone (one slot per owner name) + TV backup by player name | ✅ |
| Tricks, competitions, accessories, tug-of-war rope, more walk routes, NPC dogs | Phase 2 |
| Friendships, personalities, decorating the flat, weather & seasons, "Hundepass" export | Phase 3 |

Breeds: Dackel, Labrador, Mops, Husky, Corgi, Pudel, Schäferhund, Mischling (`WW.BREEDS`).

## The day (one round ≈ 3–8 min, host setting `tag`)

| Phase | TV scene | Phone view | Kurz / Normal / Lang |
|---|---|---|---|
| `home` ☀️ Morgen in der WG | the flat by day (home.js) | Zuhause: care, 🛒 Laden, 🎒 Tasche | 45 / 70 / 110 s |
| `walk` 🦮 Gassi-Runde | side-scrolling street (walk.js) | leash pad + 🛑 Bei Fuß, 🐾 Buddeln, 💩 Weg damit | 65 / 100 / 160 s |
| `park` 🎾 Ab in den Park | park lawn (park.js) | throw pad + toy picker | 55 / 80 / 130 s |
| `night` 🌙 Feierabend | the flat at night (home.js) | Zuhause + night summary | until the host taps **☀️ Nächster Tag** |

- Lengths live in `WW.DAY`; the lobby calls the setting **Tageslänge** (Kurz ~3 min,
  Normal ~5 min, Lang ~8 min per day). The phase timer pauses while nobody has a dog
  yet: the TV shows a welcome panel with all breeds and "⏸ Die Uhr läuft, sobald ein
  Hund da ist".
- **Nightfall** ranks the dogs by love earned today. The leader (ties allowed, at least 1
  love) is "👑 Hund des Tages"; with ≥ 2 dogs in the WG it is reported via `reportWinners`
  (evening scoreboard). Every dog present gets `days + 1`, and the TV saves its backup.
- Care and shop stay open at night. The host's **☀️ Nächster Tag** counts once the night is
  3 s old (`NIGHT_MIN`); an earlier tap is answered with "🌙 Einen Moment — erst die
  Tagesbilanz genießen", taps from guests are ignored. Next morning: `WW.wakeUp`
  (+45 energy, +5 mood), fresh `today` stats, "☀️ Guten Morgen! Tag 2" on the phones.
- **Latecomers** join any time (`acceptsJoin: true`): they adopt or bring their dog, which
  appears in the current scene. A dog (`uid`) lives only once in the WG — a phone that comes
  back under a new device id takes its dog along from the stale seat.
- **A dropped phone** takes its dog off the TV ("💤 Krümel macht ein Nickerchen") right after
  its backup is saved. When the last player leaves, the game ends ("🐾 Die WG ist leer —
  bis bald!").

## Files

| File | What |
|---|---|
| `public/games/wauwauwg/meta.js` | key, label, `min: 1`, the `tag` setting |
| `public/games/wauwauwg/core.js` | catalogs + pure rules (`window.WW`): breeds, needs, items, love, care, shop, loot, `sanitizeDog`, seeded `WW.rng`. No DOM; `test-wauwauwg.js` runs it in a vm |
| `public/games/wauwauwg/dogart.js` | `WW.art` — procedural drawing of every dog and toy |
| `public/games/wauwauwg/sound.js` | `WW.sound(name)` — tiny WebAudio dog synth (TV only) |
| `public/games/wauwauwg/screen.js` | TV backbone: lifecycle, authoritative dog records, the day, phone sync, backup, HUD |
| `public/games/wauwauwg/home.js` | `WW.scenes.home` — the flat by day and at night |
| `public/games/wauwauwg/walk.js` | `WW.scenes.walk` — the Gassi street |
| `public/games/wauwauwg/park.js` | `WW.scenes.park` — park and fetch |
| `public/games/wauwauwg/controller.js` | the phone: all views, gestures, local storage |
| `public/dev-wauwauwg.html` | TV harness with bot dogs |
| `public/dev-wauwauwg-phone.html` | phone harness against a fake screen |
| `public/dev-wauwauwg-dogs.html` | art gallery: breeds, coats, poses, portraits, toys |
| `test-wauwauwg.js` | core rules + backbone protocol (raw bus phones) |
| `test-wauwauwg-phone.js` | JSDOM end to end through the real phone UI |

Load order (exact one-line tags in both HTML files): `meta → core → dogart → sound →
home → walk → park → screen` on the TV, `meta → core → dogart → controller` on the phone.
`core.js` precedes the other Wauwau-WG files: it creates `window.WW` and `WW.scenes`.

## The dog record

```js
{
  v: 1, uid: 'k3j4h5x9q2',          // [a-z0-9]{4,16} — the dog's identity across devices
  name: 'Krümel', breed: 'dackel', coat: 0,   // name ≤ 12 chars; WW.BREEDS[breed].coats[coat]
  born: 1729850000000, days: 3,      // days = completed in-game days (counted at nightfall)
  needs: { food, water, clean, mood, energy },  // 0 = urgent … 100 = perfect
  love: 57,                          // Zuneigung; WW.loveLevel(love) → 0..5
  coins: 42,                         // Taler 🪙
  inv: { kibble, meat, treat, shampoo },        // consumables, ≤ 99 each
  toys: ['ball', 'frisbee'],         // permanent; 'ball' always
  finds: { sock: 2, gem: 1 },        // sellable walk loot
  stats: { walks, fetches, baths, finds }
}
```

A new dog (`WW.newDog`) starts with food 80, water 80, clean 90, mood 75, energy 90,
30 Taler, 3 kibble, 3 treats, 2 shampoo and the ball. Per-day stats
(`today: {love, coins, finds, caps}`) are not part of the record: the TV keeps them per
seat, resets them every morning and sends `love, coins, finds` along with every `wwYou`.

The **screen is authoritative** while playing: it sanitizes every incoming record
(`WW.sanitizeDog`: unknown breed → rejected, bad uid → new uid, everything else clamped
or dropped), applies all rules from `core.js`, and pushes the record back (`wwYou`). The
phone never edits the record itself — it only stores what it receives.

Where the dog lives:

- **Phone:** `localStorage['wauwauwg.dog.<slot>']`. The slot is the owner name in lower
  case, named by the TV in every `wwYou` (`slot`) and remembered per tab in
  `sessionStorage['wauwauwg.slot']` — desktop tabs share one `localStorage` but each tab is
  its own player, and a reload finds its own dog. Before the first `wwYou` the typed name
  decides. A bare `wauwauwg.dog` from before the slots is read as a fallback and migrated
  on the next save.
- **TV backup:** `localStorage['wauwauwg.backup']` on the screen, keyed by lower-case owner
  name, the 30 most recent dogs. Saved when a dog arrives, every 20 s, at nightfall, when a
  phone drops and when the game stops; deleted by "Hund abgeben". A phone's storage is per
  site address, so a new phone, cleared storage or a changed LAN IP would orphan the dog —
  a phone that says hello without a record is offered the backup for its owner name (unless
  that dog is already in the WG). Shell default names ("Spieler 3") are no identity: the TV
  sends an empty slot and keeps no backup for them.
- Both stores are per address: a dog adopted at `192.168.…:3000` does not exist on an
  online server (see [ONLINE.md](ONLINE.md)).

## Message protocol

All messages are `{ t: 'ww…', … }`. Screen → phone:

| `t` | Fields | When |
|---|---|---|
| `wwAdopt` | `backup: null \| {name, breed, coat}` | the seat has no dog (hello without a valid record, after a move-out, a failed restore) → Tierheim, with a restore offer if `backup`. **The phone deletes its local copy**, so a `wwYou` still on the wire cannot bring a moved-out dog back. |
| `wwYou` | `dog` (full record), `today: {love, coins, finds:[keys]}`, `level`, `slot` (storage slot, `''` for default names) | after any change: at once for phone actions, ≤ every 0.15 s for scene events, every 2 s for decay; on hello, join, reconnect, nightfall and morning. **The phone saves `dog` on every valid `wwYou`.** |
| `wwPhase` | `phase`, `day`, `left` (s, −1 = untimed), `host` | phase start, hello / join / reconnect, when a player leaves (the host may change), every 5 s in timed phases |
| `wwEvent` | `text` (German), `kind: good \| bad \| info \| find`, `item` | toast + vibration on the phone (`find` during the walk: the find card) |
| `wwNight` | `rows: [{owner, dog, love, coins, finds, best, you}]`, `host` | nightfall; again for anyone arriving at night, and for everyone when a player leaves |
| `wwWalk` | `dig: 0\|1`, `digP: 0..1`, `poop: 0\|1`, `cat: 0\|1` | walk HUD (walk.js), on change, ≤ 4/s per dog; all zero on leave |
| `wwPark` | `ready: 0\|1`, `tired: 0\|1`, `toy` (your toy in play, or null) | park HUD (park.js), on change; reset on leave |

Phone → screen:

| `t` | Fields | Phase | Notes |
|---|---|---|---|
| `wwHello` | `dog` (stored record or null) | any | sent by `activate()` **as its last statement** (the test bus answers synchronously); a stored record without a known breed goes out as null |
| `wwAdoptDone` | `name, breed, coat` | any | the screen builds the record (`WW.newDog`, starter kit); a seat that already has a dog just gets `wwYou` again |
| `wwRestore` | — | any | accept the backup offer; if it is gone, the TV answers `wwAdopt` without backup |
| `wwMoveOut` | — | any | "🏠 Hund abgeben" (two taps); the phone forgets the dog first, the TV drops dog + backup and answers `wwAdopt` |
| `wwCare` | `act`, `item` (feed: `kibble`\|`meat`), `zone` (pet: `head`\|`ears`\|`chin`\|`belly`\|`body`) | home, night | acts: `pet brush feed water treat bathStart bath bathCancel`; ignored in other phases. The screen counts ≤ 1 `pet`/`brush` per 0.18 s |
| `wwBuy` / `wwSell` | `item` | home, night | otherwise answered with "🛒 Der Laden hat nur morgens und abends offen" |
| `wwNext` | — | night | host only, ≥ 3 s after nightfall (earlier: a toast, the night stays) |
| `wwMove` | `x, y` ∈ [−1, 1] (screen axes: +x right, +y down) | walk | on change (ε 0.08, ≥ 50 ms apart) and `0,0` on release; the screen clamps to the unit circle |
| `wwDig` | — | walk | one tap of 🐾 Buddeln (≥ 80 ms apart, only while `dig` is lit) |
| `wwPoop` | — | walk | 💩 Weg damit — pick up (within 7 s) |
| `wwHeel` | — | walk | 🛑 Bei Fuß — ends a cat chase |
| `wwThrow` | `toy`, `dx, dy` (unit swipe direction, phone axes: −dy = away from you), `power` 0..1 | park | ignored unless the dog owns the toy and none of yours is out; `power` is clamped to 0.15–1 |

Care results come back as `wwYou` (+ `wwEvent` for refusals and notable successes).
All user strings (dog names!) are rendered with `textContent` / canvas, never `innerHTML`.

## Scenes (TV) — `WW.scenes.<key> = function (api) { return scene; }`

Each scene file registers a factory; the backbone creates one instance per game and
reuses it for every visit (home serves both `home` and `night`). If a scene file is
missing, a plain fallback scene keeps the game running.

```js
scene = {
  enter(ids, opts),   // phase starts. ids = player ids that have a dog. opts = { day, night }
  leave(),            // phase ends — drop transient stuff, reset the phone HUD (wwWalk / wwPark)
  addDog(id),         // a dog arrived mid-phase (adoption / reconnect)
  removeDog(id),      // a dog left (disconnect / move out)
  onMessage(id, d),   // phone messages the backbone does not handle (wwMove, wwDig, wwThrow, …)
  onCare(id, act, r), // home only: a care action was applied; r = WW.care() result
                      //   (r.fx: hearts|sparkle|drink|eat|treat|tub|shake|untub|refuse|null)
  update(dt),         // dt in seconds (≤ 0.05) of SIM time — never read the wall clock
  draw(ctx),          // draw the full 960×600 world; the backbone draws its HUD on top
  dogPos(id),         // → {x, y} screen point just above the dog's head (floaters), or null
  devBot(id, rnd)     // optional, harness only: return a phone message (or null) per frame
}
```

`api` (from the backbone):

| Member | Meaning |
|---|---|
| `W, H, TOP, BOTTOM` | canvas size; keep gameplay between `TOP` (34, under the top bar) and `BOTTOM` (538, above the player cards) |
| `rnd()` | the game's random source (seeded when the harness passes `seed`) — use it instead of `Math.random` for gameplay |
| `time()`, `phase()`, `day()` | sim seconds, current phase, day number |
| `ids()`, `dog(id)` | ids with dogs; live record (read it; change it only via the helpers below) |
| `color(id)`, `owner(id)` | player color, short owner name |
| `speed(id)`, `tired(id)` | `WW.speedFactor` (0.5–1), `WW.isTired` (energy < 15) |
| `love(id, n, source)` | add love within the daily cap of `source` (`'fetch'`, `'walk'`, …) → applied amount; a level-up toasts "💖 Krümel & du: Vertraut!" |
| `coins(id, n)`, `needs(id, delta)`, `stat(id, key, n)` | Taler, need deltas (clamped), lifetime stats (`n` defaults to 1) |
| `find(id, key)` | apply walk loot (`WW.rollFind(api.rnd)`) → `{item, coins, text}` |
| `event(id, text, {kind, item, float, floatText, color})` | phone toast + TV floater above the dog (`float: false` = toast only) |
| `float(x, y, text, color)`, `floatAt(id, text, color)` | TV floaters (stacked when they start at the same spot) |
| `send(id, msg)` | raw message to a phone (`wwWalk`, `wwPark`) |
| `sfx(name)` | dog sounds (`woof yip squeak slurp crunch dig find shake snore whine`, via `WW.sound`) or any shell palette name |

On top of every scene the backbone draws the top bar (day, phase, countdown), up to 8
player cards (portrait, dog name, love hearts, owner, five need bars — low ones blink — and
a badge for the most urgent need; "adoptiert" with running dots while a player is still in
the Tierheim), floaters, toasts, the phase title card and the night summary.

What the scenes do:

- **home.js** — the flat: the WG door on the left, a bed in the owner's color (with the
  dog's name) plus a food and a water bowl per dog, a bathroom with a three-seat tub (a
  queue forms when it is full), a window whose sky follows the time of day. Dogs live on
  their own — wake up and stretch, wander, sniff, sit, lie, scratch, nap when tired,
  play-bow and chase each other — and show their most urgent need in a thought bubble;
  dirty dogs get stink lines (and flies). Every `onCare` is acted out: hearts, sparkles
  and fur tufts, eating or drinking at the dog's own bowl, begging for a treat tossed from
  the couch, the foam tub and the big shake (wet for ~24 s), a head shake with "💧✋" /
  "🍖✋" when the dog is not thirsty or hungry. A dog left in the tub without news hops out
  dry after 90 s. At night the room dims, the lamp glows, and the dogs come home through
  the door and go to bed.
- **walk.js** — a side-scrolling street, a different stretch every day. Owners walk in
  their player colors with name tags; the dog on its leash (≤ 168 px) follows `wwMove`,
  trots back to heel when the stick is idle (stepping around puddles), and its owner leans
  when it pulls. Events:
  - *Sniff spots* (leaf piles, mole hills, bushes, flower beds): an idle dog stops at a
    fresh smell; 6 `wwDig` taps unearth it (progress decays when you stop) → `WW.rollFind`
    loot and +1 love; rare finds (💎 ⌚ 👑) get a gold burst and "✨ Selten! ✨". New smells
    often pop up right in front of the dog with the fewest finds and stay reserved for it
    for 3 s; every dog starts with one.
  - *Puddles*: "Platsch! 💦 Krümel ist voller Matsch" — −25 clean, +3 mood, muddy and wet,
    then a shake.
  - *Poop*: first squat after 14–32 s, then every 40–70 s; "💩 Weg damit" within 7 s →
    +3 love, +2 Taler ("Vorbildlich! +2 🪙").
  - *Cat*: 30–45 s into the walk (again 60–80 s later, so only long walks see a second
    one) a cat on a fence dashes off ("🐈 Miau!"); dogs within reach chase it for 2.5 s.
    "🛑 Bei Fuß" → +2 love ("Brav! 🐕 Krümel hört aufs Wort"), otherwise "🐈💨 Die Katze ist
    entwischt!" (+4 mood, −4 energy).
- **park.js** — a pseudo-3D lawn (x, depth, height) with flower beds and a pond; owners
  line up on the front path. One toy per owner can be out at a time: 🎾 ball (bouncy),
  🥏 frisbee (glides and curves, easiest to catch), 🦆 duck (erratic bounces, squeaks),
  🪵 stick. The owner's dog always runs; a dog clearly closer to the landing point may try
  to steal it (chance from mood + energy; 60 % for the nearest dog when the owner's dog
  can't go). Dogs jump for toys in flight — a catch before the toy touched the grass is
  worth +2 bonus Taler ("✨ Fang!"). Whoever brings a toy back gets the credit: +2 love
  (`fetch`), +1 Taler, `stats.fetches`. A thief delivers to its own owner, who tosses the
  toy back; the victim's phone gets "😂 Balu hat deinen Tennisball geklaut!". Unclaimed toys
  tempt idle dogs after 2.5 s and pop back to the owner after 10 s (18 s at most). Tired
  dogs (energy < 15) lie down and nap until 24 energy ("😴 Krümel ist zu müde zum
  Spielen"). Idle dogs roam, sniff flowers and do zoomies in pairs; breeds run at
  different speeds.

## Art — `WW.art` (dogart.js, loaded on both pages)

| Function | Contract |
|---|---|
| `drawDog(ctx, dog, x, y, opts)` | Side view. `(x, y)` = ground point under the body center; faces right unless `facing: -1`. `opts`: `scale` (1 ≈ 100 px long medium dog; breeds vary via `art.SIZE`), `pose` (`stand walk run sit lie sleep dig eat shake beg squat jump`), `t` (seconds, drives gait/tail/breath/blinks), `wag` 0..1, `dirt` 0..1, `wet` 0..1, `mouth` (toy key carried), `tongue`, `alpha`, `shadow` (default true), `collar` (CSS color, default red; `false` = none) |
| `points(dog, scale)` | `{w, h, nose:[dx,dy], head:[dx,dy], tail:[dx,dy]}` for a right-facing dog (mirror `dx` for left) — leashes, bowls, floaters |
| `dogSize(dog, scale)` | `{w, h}` |
| `drawPortrait(ctx, dog, cx, cy, size, opts)` | Front view, sitting (phone close-up, Tierheim, TV player cards). `size` = figure height. `opts`: `t`, `happy` 0..1 (eyes squint/close), `tongue`, `dirt`, `wet`, `look:{x,y}`, `tilt`, `eat` 0..1, `collar` |
| `portraitZone(dog, size, dx, dy)` | petting zone at an offset from the portrait center → `head ears chin belly body` or null |
| `drawToy(ctx, key, x, y, scale, rot)` | `ball frisbee duck stick`, centered; scale 1 ≈ 14 px ball |
| `swatch(breed, coat)` | CSS color for coat buttons |
| `SIZE` | relative size per breed (1 = Labrador-ish); also the Tierheim's Klein / Mittel / Groß |

Everything is procedural canvas drawing — no image files, no fonts beyond system-ui, no
`Math.random` (a dog looks the same on every device), and nothing is read back from the
context, so it runs in JSDOM too. Coat colors live in `WW.BREEDS` (core.js).

## Phone (controller.js)

The phone injects its own views (reusing shell classes) and shows "Dein Hund wird
geweckt…" until the TV answers `wwHello` — retried every 2.5 s; after three retries it
says "Der Fernseher antwortet nicht — lade diese Seite neu 🔄". `wwPhase` alone never
leaves this view: `wwAdopt` opens the Tierheim, the first valid `wwYou` the dog's views.

- **🏠 Tierheim** — breed carousel with a live portrait (swipe or ◀ ▶; a tap on the
  portrait just makes the dog happy), size word, coat swatches, name field pre-filled with
  a name idea + 🎲, and "🐾 Krümel adoptieren!" (locked until the TV answers, 3 s at most).
  A TV backup shows "Willkommen zurück! 👋" with "🐾 Ja, das ist mein Hund!" / "Nein,
  neuen Hund adoptieren".
- **Zuhause** (home and night) — name, 🪙 pill and ☰ Hundepass; "Tag 1 · ☀️ Morgen in der
  WG · 1:10" plus hearts for the love level; five need bars (tap one for the exact %); the
  portrait stage (thought bubble for the most urgent need, stink lines, zzz when sleepy);
  the tool bar ✋ Streicheln · Bürsten (drawn brush icon) · 🥣 Füttern (picker:
  🥣 Trockenfutter / 🥫 Fleischdose) · 💧 Wasser · 🍪 Leckerli · 🛁 Baden with stock
  badges; 🛒 Laden and 🎒 Tasche.
  - *Petting / brushing*: rub over the portrait — one counted stroke per 60 px of rubbing,
    at most 4 per second; `pet` carries the zone rubbed most (`art.portraitZone`). The
    favorite spot (stable per dog, from its uid) gives bigger hearts and, once a day,
    "💕 Lieblingsstelle gefunden!".
  - *Bath* on a 12 × 14 grid over the dog: "🧴 1/3 Einschäumen" (70 % foamed) →
    "🚿 2/3 Abduschen" (≤ 10 % foam left) → "🧺 3/3 Abtrocknen" (75 % dry) → `bath`.
    ✕ cancels (`bathCancel`, no shampoo used). The other tools are locked meanwhile;
    leaving the phase or reconnecting cancels the bath.
  - Out-of-stock taps are caught on the phone ("Kein Shampoo 🧴 — ab in den Laden 🛒")
    and nudge the 🛒 button; nothing is sent.
  - Sheets: **🛒 Laden** ("Futter & Pflege", "Spielzeug"; unaffordable prices greyed out,
    owned toys "✓ Hast du"), **🎒 Tasche** (Vorräte, Spielzeug, Fundstücke with sell
    buttons, Rekorde), **🐾 Hundepass** (portrait, breed · coat, days in the WG, love level
    and the way to the next one, today's stats, "🏠 Hund abgeben" — a second tap within
    3 s confirms).
  - *Night*: the "🌙 Tagesbilanz · Tag 1" card (👑 for the Hund des Tages, your own row
    outlined); the host gets "☀️ Nächster Tag", guests "Der Host startet gleich den
    nächsten Tag…". "Noch ein bisschen kuscheln 🐾" hides the card for more care,
    "🌙 Bilanz" brings it back.
- **Gassi** — a floating leash pad: the base follows the finger (a leash, not a box) and
  the knob is the dog's face → `wwMove`. 🛑 Bei Fuß, 🐾 Buddeln (with dig progress) and
  💩 Weg damit light up from `wwWalk` (cat and poop also vibrate); a find pops up as a
  card, golden for rare ones.
- **Park** — swipe up to throw: the speed of the last ~100 ms sets `power`, swipes under
  30 px are ignored, other directions toast "⬆️ Nach oben wischen zum Werfen!". The toy
  picker lists the dog's toys and locks while one is out; a small animation mirrors the
  fetch. If `wwPark` never reports the toy back, the pad frees itself after 24 s.

General: toasts for `wwEvent`, vibration in try/catch, one finger per pad (touch tracked
by identifier, mouse for desktop testing), `e.preventDefault()`; canvases override the
shell's global `canvas` CSS. Everything from the TV is validated on arrival — a record
must survive `WW.sanitizeDog` with its uid intact, unknown phases, kinds, toys and items
are dropped, strings are capped — so a bad message is ignored instead of breaking the
phone or ending up in `localStorage`. `window.__wwPhone` is the dev/test handle.

## Tuning

Balance numbers live in `core.js` and as named constants at the top of every scene file,
`screen.js` and `controller.js`. **All of them are first guesses** — tune them after
watching real players. Starting points:

| What | Where | Now |
|---|---|---|
| Phase lengths | `WW.DAY` | see the day table |
| Needs per minute, by phase | `WW.RATES`, `WW.LOW_MOOD_DRAIN` | e.g. walk: water −14, energy −9; night: energy +8; food, water or clean below 25 cost 4 extra mood each |
| Love levels | `WW.LOVE_LEVELS`, `WW.LOVE_NAMES` | 0 / 25 / 70 / 150 / 270 / 450 — "Neu in der WG" … "Seelenhund" |
| Love per day and source | `WW.LOVE_CAPS` | pet 12, brush 10, treat 6, fetch 20, walk 15, care 30 (food, water, bath) |
| Prices, starter kit | `WW.ITEMS`, `WW.STARTER` | kibble 4, meat 10, treat 2, shampoo 6, duck 20, frisbee 35; 30 Taler to start |
| Loot | `WW.FIND_TABLE`, `ITEMS[…].sell` | coins most often, 👑 rarest (sells for 60) |
| Walk / park / home feel | top of walk.js, park.js, home.js | dig taps, cat timing, leash length, toy physics, catch odds, … |

## Dev harness & tests

- **TV:** `public/dev-wauwauwg.html` runs the screen standalone with bot dogs (each scene's
  `devBot`) on a fake clock: `?sim=<ms>`, `?freeze=1`, `?seed=7`, `?players=4` (1–8),
  `?phase=home|walk|park|night`, `?tag=kurz|normal|lang`, `?nodogs=1`, `?arrive=1` (dogs
  walk in instead of waking up), `?act=bathStart` / `?act2=bath&at2=8000` (scripted care),
  `?bots=0`, `?needs=clean:10,energy:5`. Messages for the phones land in
  `window.__phone[id]`; `__game._debug()` exposes the state and `jump(phase)`.
  Example: `/dev-wauwauwg.html?phase=walk&sim=20000&freeze=1`.
- **Phone:** `public/dev-wauwauwg-phone.html` runs the controller against a fake screen
  that applies the real `core.js` rules:
  `?view=adopt|restore|home|shop|bag|menu|bath|feed|walk|find|park|night`, `?freeze=1`,
  `?host=0`, `?breed=husky&coat=1&dirty=1&name=Wuffi`, `?toast=…`, `?step=2&fill=0.5`
  (bath). Runtime errors show as a red banner.
  Example: `/dev-wauwauwg-phone.html?view=home`.
- **Art:** `public/dev-wauwauwg-dogs.html` — every breed × coat, pose, portrait and toy;
  `?freeze=1` for stills, the filters are listed at the top of the file.
- Screenshots: `firefox --headless --no-remote --profile <own dir> --window-size=980,620
  --screenshot out.png "<url>"` (`--window-size=390,844` for the phone page).
- `npm run test:wauwauwg` runs `test-wauwauwg.js` (core rules + backbone protocol with raw
  bus phones: adoption, sanitizing, care, shop, day/night, Hund des Tages, backup restore,
  guards) and `test-wauwauwg-phone.js` (JSDOM end to end through the real phone UI with
  synthetic touches and clicks, including junk messages from a confused TV). Both are part
  of `npm test`; `test-allgames.js` smoke-tests Wauwau-WG along with every other game.

## Later phases

Phase 2 (tricks, evening competitions, accessories, tug-of-war rope, more walk routes,
NPC dogs) and Phase 3 (friendships, personalities, decorating the flat, weather and
seasons, "Hundepass" export code) are tracked in the [roadmap](ROADMAP.md). Anything new
in the dog record must also go into `WW.sanitizeDog` — it rebuilds the record from known
fields only, so phones and backups would silently drop the rest.
