# Roadmap

Prioritized backlog for Party Hub. Effort tags: **S** = an hour or two, **M** = an
evening, **L** = several evenings. Items are great first issues for contributors —
open an issue before starting the L ones.

## Phase 1 — Bugs & robustness

- [x] **1. Drawing Evolution: incremental pad rendering (S, confirmed bug)**
  `sMove` calls `redraw()` on every touch move, repainting *all* strokes — O(n²) over a
  drawing session, laggy on older phones once the picture fills up.
  *Requirement:* draw only the new line segment on move; full `redraw()` only on
  undo/clear/round start. Visual result must be identical (round caps/joins).

- [x] **2. Host leaves on an end screen → nobody has the rematch button (S, confirmed)**
  The shell updates `myHost`/abort on host change, but game-specific end-screen buttons
  (Boss Raid, Space Arena, Sintflut, Kometen, Hexenschicht, Himmelszünder, Fake Artist,
  Racer) are only sent on phase entry.
  *Requirement:* in `onDisconnect`, while in an end phase, re-send the end message so the
  new host gets the button (Spion's `sendPhase` pattern). Fix all affected games.

- [ ] **3. Screen reload loses the lobby (M)**
  A TV browser crash mid-evening dumps everyone back to the name prompt.
  *Requirement:* screen snapshots lobby state (names/colors per device-id) into
  `sessionStorage`; on takeover/reload, restore named players instead of re-prompting.
  Restoring *running games* is out of scope.

- [ ] **4. All-games smoke test (S, high leverage)**
  `npm test` covers 3 of 17 games.
  *Requirement:* a generic JSDOM test that, for every registered game, boots the shell
  with `min` bot players, starts the game, runs ~100 frames and asserts no uncaught
  errors (WebGL games may exit to lobby — that's a pass). Chain into `npm test`.

- [ ] **5. CI via GitHub Actions (S)**
  *Requirement:* `.github/workflows/test.yml` running `npm ci && npm test` on push/PR,
  Node 18 + 20. Badge in the README.

## Phase 2 — Quick wins for game night

- [ ] **6. QR code in the lobby (S, biggest onboarding win)**
  Typing `192.168.x.y:3000/controller.html` is the worst part of the evening.
  *Requirement:* vendor a minimal MIT QR encoder, render the controller URL as a QR on
  the screen's lobby (server already knows its LAN IPs — expose via a `/info` endpoint
  or embed at page load).

- [ ] **7. Wake Lock (S)**
  Phones dim during watch-phases (Spion!), TVs start screensavers.
  *Requirement:* `navigator.wakeLock` on controller and screen, re-acquired on
  visibilitychange; silent no-op where unsupported.

- [ ] **8. Remember player names (S)**
  *Requirement:* controller stores the last name in `localStorage`, prefills the input,
  auto-focuses; joining is one tap on return visits.

- [ ] **9. Fullscreen button on the screen page (S)**
  *Requirement:* small ⛶ button (auto-hiding, like the cursor) toggling the Fullscreen
  API on the whole page.

- [ ] **10. 🎲 Random game button (S)**
  *Requirement:* one extra picker button that host-selects a random game (respecting
  current player count vs `min`).

## Phase 3 — Platform features

- [ ] **11. Sound engine (M, the missing sense)**
  The platform is completely silent.
  *Requirement:* a tiny WebAudio synth on the screen page — no audio assets: noise-burst
  explosions, countdown beeps, victory fanfare, per-game ambient loops. Shell API
  `sfx(name)` + a documented sound palette so games (and contributors) can trigger them.
  Global mute toggle. Must start only after a user gesture (browser autoplay policy).

- [ ] **12. Game-night mode: evening meta-scoreboard (M)**
  *Requirement:* games report winners (`endToLobby` gains an optional `winnerIds`
  param or a `reportWinners(ids)` helper); the shell tallies evening points per player,
  shows a standings strip in the lobby and crowns a champion via a "Feierabend" button.
  Persist across screen reloads together with item 3.

- [ ] **13. Host tools (S–M)**
  *Requirement:* host lobby gains per-player actions: kick (server closes the socket)
  and rename. Guard against kicking yourself.

## Phase 4 — Perf & polish

- [ ] **14. Perf pass on the heavy renderers (M)**
  Sintflut rebuilds a 64k-pixel ImageData per frame plus a full-grid scan; Boss Raid
  does O(bullets × players) each frame.
  *Requirement:* profile on a weak device (old laptop / TV browser), then: dirty-row
  tracking for the sand sim, spatial pruning for bullet checks — only if measurements
  say it's needed. Numbers first.

- [ ] **15. README media upgrade (S)**
  *Requirement:* animated GIFs (harness + screen recording) for 2–3 games; they sell the
  project far better than stills.

## New game candidates

Jury scores from the concept brainstorm: fun / graphics-wow / feasibility / novelty (of 10).

### ⚙️ Murmelwerk — co-op Pachinko machine *(8/8/8/8, effort M)*
3 rounds: 25s build phase — every player places 3 random parts (ramp, bumper, trampoline,
funnel, rotor, magnet) on anchor points of a shared vertical board via a phone mini-map —
then **250 glowing marbles rain through the machine**; marbles landing in *your* bucket
score. During the rain each player has 3 impulse shockwaves to bend marble streams.
Parts persist across rounds, the machine grows absurd. Screen: additive glow trails
(trail canvas with per-frame fade), bumper flashes, slow-mo for the last 10 marbles.
*Risks:* build-phase UX on small screens → coarse anchor grid, not free placement.
Physics: circle-vs-segment with spatial hash, fixed timestep, cap ~250 marbles.

### ☢️ Kessel-Kommando — Spaceteam-style reactor panic *(9/6/8/8, effort M)*
Everyone gets a procedurally assembled control panel (toggle flick, dial twist, pump
hammer-tap, slider, guarded button) with absurd German part names. Commands appear on
*other* players' phones — you must read yours aloud and hope the owner reacts. Fulfilled
commands cool the reactor; missed ones heat it and trigger disruptions (panels swap
widgets, labels smoke over). 3 shifts, shared core HP, co-op highscore.
*Risks:* the German nonsense-name generator is the real core — curated prefix+suffix
word lists, collision-checked per round, must be short and readable aloud.
*Note:* same DNA as the "Panik an Bord" concept — build only one of the two.

### ⛳ Blitz-Putt — simultaneous chaos minigolf *(8/7/8/7, effort M–L)*
5–7 short holes, **all balls putt at the same time** (0.8s cooldown once your ball is
slow). Points by hole-in order 10/7/5/3/2/1. Drag-back flick on the phone with a live
ghost-arrow on the TV; one emergency brake per hole. Ball-on-ball contact is legal and
encouraged (shove rivals into the kill hole). Rocket-ball pickup only spawns for the
bottom half of the scoreboard; final hole counts double with a wandering gold cup.
*Risks:* course design eats time → strict declarative tile/segment course format;
physics substeps against tunneling through thin walls.

### 🏰 Bollwerk — Warlords reborn *(8/7/8/6, effort M)*
Circular arena, each player defends an arc: 3 brick rows + a 3-HP core. Plasma balls
ricochet; a touchstrip paddle (absolute 1:1 thumb position) blocks, catch-and-aim throw
is the skill move. +1 ball and +8% speed every 20s; eliminated players become
poltergeists who deflect balls and steal power-ups — nobody just watches. Best-of-3.
*Risks:* ball-paddle tunneling at high speed → polar coordinates + swept collision
with fixed substeps. Poltergeist role is a launch requirement, not a stretch goal.

### ❓ Quiz-Buzzer — the missing genre *(effort M, content-heavy)*
Classic party quiz: question on the TV, four answers, phones are buzzers/answer pads.
Modes: fastest-finger (buzz, then answer solo) and all-answer (everyone locks in, points
by speed + streak multiplier). Host settings: category, rounds; `text` setting for
custom "Fragen über uns" questions (format `Frage;A;B;C;D;richtigIndex`).
*Risks:* needs a curated German question bank (~200 questions to feel fresh over several
evenings) — the code is the easy half. Good community-contribution magnet: questions
are data PRs.

## Done

- 17 games, reconnect + heartbeat, resume secrets, declarative settings, view-injection
  modules, contributor docs + template (see git history for the journey).
