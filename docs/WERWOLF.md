# 🐺 Werwolfnacht — design notes

A social-deduction game with an **automatic moderator**: the TV is the village and the
narrator (on-screen text + optional browser speech), every phone is a private role card
and the input for secret night actions. Nobody has to moderate, nobody has to close their
eyes — at night *everyone* taps on their phone at the same time, so tapping gives nothing
away.

This file is the **contract** between the modules. If you change a shape or a rule, change
it here too.

## Files

| File | Loaded by | Owns |
|---|---|---|
| `public/games/werwolf/meta.js` | screen + controller | key, label, `min: 5`, settings |
| `public/games/werwolf/rules.js` | screen (+ Node tests) | roles, deal, night/vote resolution, win check, chronicle → `window.WerwolfRules` |
| `public/games/werwolf/narrator.js` | screen | narration texts (German) + speech → `window.WerwolfNarrator` |
| `public/games/werwolf/village.js` | screen | 2D village scene, role emblems, end roster → `window.WerwolfVillage` |
| `public/games/werwolf/screen.js` | screen | glue: phases, timers, HUD, phone protocol |
| `public/games/werwolf/controller.js` | controller | phone UI |
| `public/dev-werwolf.html` | — | TV harness with bot players and a fast clock |
| `public/dev-werwolf-village.html` | — | village/narrator preview with scripted scenes |
| `public/dev-werwolf-phone.html` | — | phone UI against a fake screen |
| `test-werwolf.js` | Node | rule tests |
| `test-werwolf-flow.js` | Node/JSDOM | full games through screen + phones |

`rules.js` is a plain script that also works under Node (same wrapper as Neonspur's
`sim.js`) and is **deterministic**: seeded RNG only, no `Math.random`/`Date`.
Everything renders on the shell's 2D canvas `cv` (960×600) — Mitschauen works for free.

## Roles

| key | Name | Team | Ability |
|---|---|---|---|
| `wolf` | 🐺 Werwolf | wolves | knows the pack; each night the pack picks one victim (non-wolf) |
| `villager` | 🧑‍🌾 Dorfbewohner | village | — |
| `seer` | 🔮 Seherin | village | each night sees the exact role of one living player (not herself); her first pick is final |
| `guard` | 🛡️ Beschützer | village | each night protects one living player (himself allowed) from the wolves; not the same player two nights in a row |
| `cupid` | 💘 Amor | village | night 1 only: links two living players (himself allowed) as lovers |
| `witch` | 🧪 Hexe | village | once per game a healing potion (saves the wolves' victim, herself included), once per game a poison (kills any living player but herself); both in the same night allowed |
| `hunter` | 🏹 Jäger | village | when he dies — for any reason — he immediately shoots one living player |

**Lovers:** they learn each other's name (not role) at the end of night 1. When one lover
dies, the other dies of grief right after (`cause: 'grief'`). A *mixed* pair (one wolf,
one non-wolf) leaves their teams: they win only if they are the last two alive, and they
are excluded from their role team's victory.

**Deal** (`deal(ids, opts, seed)`): wolves `auto` = 1 for ≤ 6 players, 2 for ≤ 10, 3 for
≤ 14, else 4; a manual count is clamped to `1 … floor((n − 1) / 2)`. Enabled specials are
dealt in priority order seer, witch, hunter, guard, cupid while at least one plain
villager remains (max specials = `n − wolves − 1`). The rest are villagers. Shuffle with the
seed.

## Game flow

```
roles → night (A, B) → dawn → [hunter] → win? → day → vote → [runoff] → verdict → [hunter] → win? → night …
                                                                                                    → end
```

- **roles** — every phone shows its role card (hold to reveal); wolves see their pack.
  Phase ends when everyone tapped "Bereit" or after `ROLES_MAX_MS`.
- **night, step A** — simultaneous tasks for every living player:
  wolves `wolf` (pick a victim; the pack sees each other's picks live; picks can change),
  seer `seer` (pick → immediate result, locked), guard `guard`, cupid `cupid` (night 1:
  two targets, locked), everyone else a **decoy** `suspect` ("Wem misstraust du am
  meisten?", changeable). The wolves' target resolves at the end of step A: unanimous
  pick, otherwise the plurality (ties broken by the seeded RNG), no picks → no victim.
- **night, step B** — the witch gets `witch` (sees step A's victim — even if guarded — and
  her remaining potions); everyone else a second decoy `trust` ("Wem vertraust du am
  meisten?"). **Step B always happens with the same timing**, even without a living witch,
  so nothing leaks.
- **Night timing never leaks:** each step lasts at least `STEP_MIN` + a random 0–5 s,
  ends early only once everyone acted *and* that minimum passed, and is cut at `STEP_MAX`
  (missing actions = none). Constants in `screen.js`.
- **dawn** — resolve the night: wolves' victim dies unless guarded or healed; poison
  victim dies; grief chains. Lovers get their private notice. The TV announces each death
  (role shown if the `reveal` setting is on) or "niemand ist gestorben", then shows the
  **Misstrauens-Barometer**: the most-suspected and most-trusted player from the decoys
  (only if at least two players named them).
- **hunter** — whenever the hunter dies, a `hunter` phase gives him `HUNTER_MAX_MS` to
  shoot (no pick = no shot); grief chains again.
- **day** — discussion timer (`talk` setting). Ends early when the host skips or ⅔ of the
  living tapped "Bereit zur Abstimmung".
- **vote** — every living player votes for a living player or "Niemand"; public result on
  the TV (arrows voter → target). Plurality is executed; "Niemand" winning or a tie in the
  **runoff** (a second vote among the tied) → nobody dies. `VOTE_MAX_MS`, missing = abstain.
- **verdict** — announcement, role (per `reveal`), hunter/grief chains.
- **win check** after dawn and after the verdict (see rules).
- **end** — winner banner, then all roles revealed and the **Chronik**: a night-by-night
  replay of who did what (wolves' picks, seer, guard, witch, cupid, votes, deaths).
  `reportWinners` with the winning players; host rematch deals new roles.

**Ghosts:** dead players see every role and the night's actions live on their phone
(they must not talk — the TV reminds them). **Offline players** (phone locked, Wi-Fi gone)
stay in the game: their actions are missing (= none / abstain) and they resume where the
game is (`canResume` / `onReconnect`). The shell deletes `players[id]` *before*
`onDisconnect`, so the glue caches names and colours at start.

## Win check (`checkWin()`)

In this order:
1. nobody alive → `nobody`.
2. a mixed lover pair are exactly the living players → `lovers` (winners: the two).
3. no wolf alive → `village` (winners: every non-wolf, dead or alive, except a mixed lover).
4. living wolves ≥ living non-wolves → `wolves` (winners: every wolf, except a mixed lover).

## Rules API (`rules.js`)

```js
WerwolfRules.ROLES                    // { key: { name, icon, team } } as in the table
WerwolfRules.deal(ids, opts, seed) → { [id]: roleKey }
   // opts: { wolves: 'auto' | 1..4, seer, witch, hunter, guard, cupid: bool }
const g = WerwolfRules.create({ players: ids, roles, seed })
g.state      // { night, day, alive: {id: bool}, roles, lovers: [a, b] | null,
             //   potions: { heal, poison }, guardLast, over: null | { winner, winners } }
g.beginNight() → { [id]: task }       // step A tasks for living players; night++
g.beginStepB() → { [id]: task }       // resolves the wolves' target first
g.act(id, payload) → { ok, result? }  // payload per task kind (below); result for the seer
g.packPicks() → { [wolfId]: targetId | null }
g.stepDone() → bool                   // every living player with a task has acted (wolves: all picked)
g.endNight() → { deaths: [{ id, cause }], lovers: [a, b] | null, suspect, trust, hunter }
g.shoot(hunterId, target | null) → { deaths, hunter }
g.vote(ballots, candidates?) → { counts, result: 'execute' | 'tie' | 'none', target, tied }
g.execute(id) → { deaths, hunter }
g.checkWin() → null | { winner: 'village' | 'wolves' | 'lovers' | 'nobody', winners: [ids] }
g.chronicle  // array of night/day entries for the end recap (shape documented in rules.js)
```

Tasks: `{ step: 'A' | 'B', kind, options: [ids], pick: 1 | 2, … }` with kinds `wolf`,
`seer`, `guard`, `cupid` (pick 2), `suspect`, `witch` (`victim`, `canHeal`, `canPoison`),
`trust`. Payloads: `{ target }`, `{ targets: [a, b] }` (cupid), `{ heal: bool, poison: id |
null }` (witch). Death causes: `wolves`, `poison`, `grief`, `hunter`, `vote`. `hunter` in a
result = id of a hunter who just died and must shoot (else null). Invalid actions return
`{ ok: false }` and change nothing.

### Rules API — implementation decisions (as built)

- **Failures:** every refused call returns `{ ok: false, reason }` (`state`, `player`, `dead`, `notask`, `payload`, `target`, `locked`, `heal`); wrong-state `beginNight` / `beginStepB` return `null`. Nothing changes on failure. Successful results carry `ok: true`.
- **`create({ players, roles, seed, names })`**: `roles` defaults to `deal(players, {}, seed)`; `names` is `{ id: name }` for `ghostLines()` (fallback: the id). `deal`: a special is enabled unless its opt is explicitly `false`.
- **State:** `g.state.phase` is `'idle'` (before night 1 and between dawn and the next night), `'A'` or `'B'`. `state.victim` = the wolves' fixed target (set by `beginStepB`, else null). `state.potions = { heal, poison }` are `true` while **unused**. `state.day = state.night` after `endNight`. `guardLast` becomes null when the guard picked nobody. `vote` / `execute` only work in `'idle'` after night 1; `beginNight` only in `'idle'` and not over.
- **Tasks:** a task is only created if it has enough options. Seer and cupid lock for the night after one valid act (`reason: 'locked'`); cupid's task exists only in night 1. The seer's `act` returns `result: { target, role }`. Witch (step B): `options` = living players except herself (poison targets); `{ heal, poison }` is validated as a whole, an invalid payload keeps the previous one; `canHeal` is false without a victim. Wolf / guard / decoy / witch may re-send until `endNight`. Dead players have no task. `stepDone()` is false outside A/B.
- **`endNight()`** → `{ ok, deaths: [{id, cause}], lovers, suspect, trust, hunter }`. `lovers` is the pair **only in the night cupid acted** (else null; `state.lovers` stays). Lovers are set *before* deaths, so grief can hit in the same night. Order of deaths: wolves' victim, poison victim, each followed by its grief. Guard/heal only stop `wolves`. Poison on someone already dead still consumes the potion.
- **Hunter:** only one hunter exists. `hunter` = id of a hunter who died in that result and has not shot; `shoot(id, target|null)` works once per dead hunter (also with `null` = gives up), target must be living; result `{ ok, deaths, hunter }` (hunter always null). Win check is the glue's job *after* the shot.
- **`vote(ballots, candidates?)`** → `{ ok, counts: {id: n}, nobody: n, result, target, tied }`. Ballots of dead/unknown voters and invalid targets (dead, not in `candidates`) are ignored; missing ballots abstain. Self-votes are allowed. `none` also when nobody voted. **A tie in a runoff (call with `candidates`) still returns `tie`; the glue must treat it as `none`.** The runoff vote is open to all living players.
- **`checkWin()`** is idempotent: once `state.over` is set it returns it. The literal doc order applies (wolf = role wolf, a mixed-lover wolf still counts as a living wolf for steps 3/4).
- **`ghostLines()`** → German lines for the current (or just finished) night, from the first `beginNight` until the next: `🐺 Anna & Ben wollen Cleo` (one line per target), `🔮 X prüft Y`, `🛡️ X schützt Y`, `💘 X verbindet A & B`, `🧪 X heilt Y`, `🧪 X vergiftet Y`. Decoys are not shown. Empty before night 1.
- **`g.chronicle`** (flat, in order; ids everywhere):
  - `{ type: 'night', night, wolves: {wolfId: target|null}, target, seer: {by,target,role}|null, guard: {by,target}|null, cupid: {by,targets}|null, witch: {by,heal,poison}|null, saved: null|'guard'|'heal'|'both', suspect, trust, deaths: [{id,cause}], hunter }`
  - `{ type: 'vote', day, runoff: bool, ballots: {voter: target|null}, counts, nobody, result, target, tied }` (one per `vote()` call, so a runoff is a second entry)
  - `{ type: 'execute', day, id, deaths, hunter }`
  - `{ type: 'shoot', day, by, target, deaths }`
  - `{ type: 'end', winner, winners }` (once, on the first `checkWin` that finds a result)

## Narrator API (`narrator.js`)

```js
WerwolfNarrator.line(key, vars) → string     // German, several variants per key, picked at random
WerwolfNarrator.say(text) → ms              // speaks via speechSynthesis (de-DE) if enabled; returns an estimated duration
WerwolfNarrator.setVoice(on)                // 'voice' setting
WerwolfNarrator.stop()                      // cancel speech (stop / endToLobby)
WerwolfNarrator.available() → bool
```

Additions: `WerwolfNarrator.keys` (all keys), `.roleName(key)` ("Seherin"), `.rolePhrase(key)` ("die Seherin").
`say()` returns ms: speech ≈ 80 ms/char + 0.5 s (min 1.5 s), silent (voice off / no API) ≈ 55 ms/char + 0.7 s
(min 1.2 s) — pace phases with it. `line()` vars: `name`, `role` (role key; text gets the article: "ein Werwolf",
"die Seherin", "der Jäger", "Amor"), `n` (day/night number). Variants needing a missing var are skipped, so
`line('deathVote', { name })` works without a role. Extra keys: `stepHurry`, `everyoneReady`, `offline` (name),
`welcomeBack` (name), `loversBound`, `hunterMiss`. Keys (at least): `intro`, `roles`, `nightFalls`, `nightDeep`, `dawn`, `deathWolves`,
`deathPoison`, `deathGrief`, `deathHunter`, `deathVote`, `noDeath`, `suspicion`, `trust`,
`hunterRises`, `dayTalk`, `talkHurry`, `voteOpen`, `runoff`, `noExecution`, `ghostsQuiet`,
`winVillage`, `winWolves`, `winLovers`, `winNobody`. Vars: `name`, `role` (the narrator
adds the German article: "die Seherin", "der Jäger", "ein Werwolf"), `n`. Atmospheric with
a wink — original texts, no quotes from published games. Speech is a no-op until the
browser allows audio and must never throw.

## Village API (`village.js`)

```js
const v = new WerwolfVillage({ width: 960, height: 600 })
v.setPlayers([{ id, name, color }])          // one house per player, arranged around the square
v.draw(ctx, scene, now)                      // full-canvas scene
  // scene = { sky: 0..1 (0 = night, 1 = day), alive: {id: bool}, revealed: {id: roleKey},
  //           offline: {id: bool}, highlight: [ids], votes: {voterId: targetId},
  //           ready: {id: bool}, mood: 'calm' | 'tense' }
v.houseRect(id) → { x, y, w, h }             // for HUD overlays
WerwolfVillage.roleArt(ctx, roleKey, x, y, size)   // procedural role emblem (no image files)
v.drawRoster(ctx, rect, roster, now)        // end screen: all players with role emblems,
                                            // dead/alive, winners highlighted, lovers linked
```

Details: layout is an ellipse ring, houses occupy y ≈ 85..545 (name signs sit directly under each house, ~25 px,
drawn on top of everything incl. arrows); `houseRect` is the house body incl. roof (x/y/w/h), top-centre = good
anchor for HUD tags. `sky` also drives lit windows (<0.5), stars, moon/sun, dusk glow; `mood: 'tense'` eases in/out
(red vignette + heartbeat). `votes` values that are not a house id (e.g. `null` = Niemand) are ignored; self-votes
draw a small loop; the target with the most votes (≥2) gets a red badge. Static helpers: `WerwolfVillage.roleName(key)`,
`.roleColor(key)`, `.ROLE_NAME`, `.ROLE_COLOR`. `drawRoster` entries:
`{ id, name, color, role, alive, winner, lover: partnerId | null }` (the lover link is drawn once per pair); it
draws only the cards (the glue dims the scene and adds the headline). `draw()` expects the shell's `performance.now()` ms.

The glue must never pass `ready` during the night (it would leak who acted).

## Phone protocol

Phone → screen:

| Message | When |
|---|---|
| `{ t: 'wwReady' }` | roles: "Bereit" |
| `{ t: 'wwAct', target }` / `{ t: 'wwAct', targets: [a, b] }` / `{ t: 'wwAct', heal, poison }` | night task |
| `{ t: 'wwShoot', target }` | hunter |
| `{ t: 'wwTalkReady' }` | day: ready to vote |
| `{ t: 'wwSkip' }` | day, host only: start the vote now |
| `{ t: 'wwVote', target }` | vote / runoff (`null` = Niemand) |
| `{ t: 'wwAgain' }` | end, host only: new game |

Screen → phone (`p` = `{ id, name, color }`):

| Message | Meaning |
|---|---|
| `{ t: 'wwRole', role, pack: [p], host }` | own role; `pack` only for wolves |
| `{ t: 'wwPhase', phase, night, day, secs, alive, host }` | phase change; `secs` = seconds left (0 = open) |
| `{ t: 'wwTask', step, kind, options: [p], pick, victim?, canHeal?, canPoison?, locked?, current? }` | night task; `victim` = `p` or null; `current` = the player's current pick (target id, `[a, b]` for cupid, `{ heal, poison }` for the witch) so a reconnected phone shows it |
| `{ t: 'wwPack', picks: { wolfId: targetId \| null } }` | live pack picks (wolves only) |
| `{ t: 'wwSeen', target: p, role }` | seer result |
| `{ t: 'wwLover', partner: p }` | lovers, at dawn of night 1 |
| `{ t: 'wwDead', cause }` | you died → ghost |
| `{ t: 'wwGhost', roster: [{ ...p, role, alive }], night: [lines] }` | ghosts: all roles + tonight's actions as German lines |
| `{ t: 'wwShootTask', options: [p], secs }` | hunter |
| `{ t: 'wwBallot', options: [p], runoff, secs, current? }` | vote open; `current` = own ballot (id or null) after a reconnect |
| `{ t: 'wwEnd', winner, won, roster, host }` | game over; `roster` like `wwGhost`'s plus `won: bool` per entry |

All of them are re-sent on `onReconnect`. Order matters: `wwPhase` first (a new phase/night/day clears the phone's per-phase state), then that phase's `wwTask` / `wwBallot` / `wwShootTask` (the latter only during phase `hunter`). The phone shows a countdown only for day, vote, runoff and hunter — never at night.

## Settings (`meta.js`)

Werwölfe (Automatisch / 1–4), 🔮 Seherin, 🧪 Hexe, 🏹 Jäger, 🛡️ Beschützer, 💘 Amor
(each An/Aus), Diskussion (60–420 s), Rolle beim Tod zeigen (Ja/Nein), Erzählerstimme
(An/Aus). `min: 5`.

## Later ideas

Bürgermeister election (double vote), more roles, role presets, a "Spielleiter" mode for
the host to pause.
