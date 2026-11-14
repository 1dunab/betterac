# 🎲 Würfelverlies — design notes

An original dice-dungeon board game for 1–4 phones (plus bots, 2–4 seats). Everyone rolls three dice from a
private pool of 15; two summon stars of the same level call a monster. Its die unfolds into a six-cell piece of
dungeon path on the shared board, and monsters walk those paths to the other masters. A master has three hearts.
The last master standing wins.

The mechanics follow the classic dice-dungeon formula: crests, levels, summon pairs, unfolding cube nets, path-only
movement and hearts. Everything you can see or read is our own: the name, the 28 monsters and three items, the
portraits (painted in code), the crest glyphs, the board look and all texts. No picture, sound or text from any
existing game is used.

This file is the **contract** between the modules. If you change a shape or a rule here, change it in the code and
in the tests too.

## Files

| File | Loaded by | Owns |
|---|---|---|
| `public/games/verlies/meta.js` | screen + controller | key, label, settings |
| `public/games/verlies/data.js` | screen, controller, Node | crests, cube nets, abilities, items, monsters, dice bags, seats → `window.VerliesData` |
| `public/games/verlies/rules.js` | screen, controller, Node | the rules engine → `window.VerliesRules` |
| `public/games/verlies/bots.js` | screen, Node | bot decisions → `window.VerliesBots` |
| `public/games/verlies/art.js` | screen + controller | portraits painted in code, crest glyphs → `window.VerliesArt` |
| `public/games/verlies/render.js` | screen | the TV picture → `window.VerliesView` |
| `public/games/verlies/screen.js` | screen | glue: seats, bag choice, turn flow, bots, timers, phone protocol |
| `public/games/verlies/controller.js` | controller | the phone |
| `public/dev-verlies.html` | — | TV with bots only: `?n=2..4&sim=<ms>&modus=…&feld=…`; `&humans=1&show=place` shows a human's placement preview (`dx`/`dy` push it off the valid spot) |
| `public/dev-verlies-phone.html` | — | the real phone UI on made-up states: `?stage=prep\|roll\|summon\|place\|act\|move\|wait\|defend\|over` |
| `public/dev-verlies-art.html` | — | every portrait and crest on one page |
| `test-verlies.js` | Node | rules, data, bots |
| `test-verlies-flow.js` | Node/JSDOM | shell + phones end-to-end |

`data.js`, `rules.js` and `bots.js` are plain scripts that also run under Node (`module.exports`). `rules.js` is
deterministic: its only randomness is the seeded generator `st.rng` (mulberry32). The phone loads `rules.js`
as well and runs it on the state it receives, so reach, targets and valid places show up without a round trip;
the screen checks every action again.

## Board

- Square grid, `w × h`, cell `(x, y)`, index `i = y * w + x`. Size by seats: 2 → 15, 3 → 17, 4 → 19 (setting `feld`
  overrides: 15/17/19/21).
- `st.kind[i]`: `0` empty, `1` path, `2` master. `st.owner[i]`: seat or `−1`. `st.piece[i]`: piece id (for seams).
- Masters sit on the board edge: 2 seats bottom/top (centre), 3 seats bottom centre + left and right edge at 16 % of
  the height (nearly an equilateral triangle), 4 seats bottom/top/left/right (centre). Seat 0 red (bottom),
  1 blue (top), 2 green (left), 3 violet (right). With 3 seats blue is left and green right.

## Dice and crests

- Crests: `SUM` (summon star), `MOV` 👣, `ATK` ⚔️, `DEF` 🛡️, `MAG` ✨, `TRP` 🕸️. A face can carry 2 or 3 of one crest.
- A die belongs to one monster (or item) and has six fixed faces: `5 − level` summon faces (level 1: four,
  level 4: one), the rest is written in `faces` (`'M2AG'` = 👣×2, ⚔️, ✨).
- Bags (15 dice each): 5× level 1, 4× level 2 + 1 item die (level 2), 3× level 3, 2× level 4.
  🔥 Glutschmiede, 🌿 Wildwuchs, 💀 Gebeinkammer, 🌊 Tiefenflut. Everyone picks one on the phone before the
  game (45 s, then random); bots pick a free one.
- Crest pool per seat: `MOV ATK DEF MAG TRP`, starts at 0, capped by setting `lager` (default 10). Gains above the
  cap are lost (the roll event reports them as `lost`). Spending never goes below 0.

## Turn

`st.turn = { seat, first, round, n, stage, roll, chosen, pending }`. Stages:

1. **roll** — choose exactly 3 unused dice (or all that are left; with none left the turn starts at `act`).
   Non-summon faces go to the pool. If at least two dice show the summon star of the same level, those dice are
   the summon options — unless the seat has no valid placement anywhere (`noRoom`), then there is no summon.
2. **summon** — pick one option die, or `null` to skip (the dice stay unused).
3. **place** — pick net (0–10), orientation, anchor; `unchoose` goes back to step 2. A placement is valid when all
   six cells are on the board and empty, and at least one of them touches (orthogonally) a tile of your own path
   or your own master. Path tiles never move again. The monster (or item) appears on the anchor cell, which is
   the net's middle face (`NETS[i].s`); the die is used for good.
4. **act** — any number of actions until `endTurn`:
   - **move** (once per monster and turn, `sprint` allows a second): along path tiles only (anyone's), never
     diagonally, never over empty cells; enemy monsters block, own (and team mates') monsters can be passed but not
     stopped on, masters block. `flug` passes over every monster. Cost: 1 👣 per cell (`flink`: one less, at
     least 1). An enemy trap on the way stops the walk on its cell; only walked cells are paid.
   - **attack** (once per monster and turn, 1 ⚔️; afterwards the monster cannot move): orthogonal neighbour, or 2
     cells straight with `reich`. Target an enemy (or wild) monster or an enemy master.
     A master loses one heart, no defence. A monster attack waits for the defender (`st.turn.pending`).
   - **ability**: see below.
- The next living seat follows; a round is complete when the turn passes the first player again. At the start of a
  turn: move/attack/ability markers reset, frozen/rooted flags apply, springs and crystals work.

### Defence and damage

`pending = { att, tgt, seat, atk, opts }`; `opts` from `defenseOptions`: `none`, `defend` (1 🛡️), reaction
abilities of the target that can be paid. Only the defender answers (`respond`). The screen gives a human 20 s,
then the bot's answer; bots and phones that are away answer after a short pause.

The one damage rule is `damage(atk, def, defended, formula)` (values in tens, never negative):

| `formel` | undefended | defended |
|---|---|---|
| `klassisch` (default) | ATK | max(0, ATK − DEF) |
| `panzer` | ATK − ⌊DEF/20⌋·10 | ATK − DEF |
| `kratzer` | ATK | max(10, ATK − DEF) (or ATK if smaller) |

`preview(st, a, t, choice)` computes the outcome without changing anything (the phones show it). Reactions:
`counter` attacker −10 afterwards, `dodge` no damage, `mirror` the attacker takes the undefended damage instead.
Passives: `dornen` attacker −10 whenever it is not dodged, `raub` +10 LP when dealing damage. 0 LP → destroyed.

### Abilities (one system)

`ABIL[key] = { name, icon, kind: passive|active|reaction, cost, target, range?, dmg?, amount?, item?, text }`.
Active ones are used in your own turn, once per monster and turn, paid with crests; `pit` (dig a trap, 2 🕸️) every
monster has, once per player and turn. Targets: `self`, `ally` (self or own neighbour), `enemy` (within `range`,
Manhattan), `own` (another own monster), `cell` (free path cell next to it, no monster, no item), `none` (area).
`abilityBlock(st, m, ab)` returns the reason a button is off ('' = usable).

Items are hidden: everyone sees that something lies there, only the owner what (`revealed` once it worked).
`grube`/`pit`/`netz` trigger on the first enemy monster that steps on them (20/10/20 damage, it stops, `netz`
also roots it for its next turn). `quelle` heals an own monster standing on it by 20 at the start of your turn,
`kristall` gives +2 ✨ the same way.

## Elimination and victory

- 0 hearts → the seat is out. Setting `monster`: `vanish` (default) removes its monsters, `stay` turns them into
  wild obstacles (`seat −1`, anyone may attack them, they never act). Setting `pfade`: `stay` (default) or
  `vanish` (its free path tiles crumble; tiles under monsters stay). Its traps go away.
- Setting `modus`: `last` (default, last master standing), `first` (whoever knocks out a master first wins),
  `team` (4 seats only: red & blue vs green & violet; team mates can't attack each other and can pass each other;
  a team wins when both enemy masters fell). With fewer seats `team` falls back to `last`.
- Setting `runden` (20/30): after the last round the most hearts win, then the most life on the board.
- `st.over = { winners: [seats], why: last|first|team|limit, round }`. The screen reports the winners' device ids
  once (`reportWinners`), bots don't count.

## Seats, bots, phones that drop out

- Humans in join order take seats 0…3, the rest spectate; setting `bots` adds bots up to 4 seats, at least 2 seats.
- A phone that disconnects keeps its seat; a bot plays it (`offline`) until it comes back (`canResume` /
  `onReconnect`). If no human seat is connected any more the game ends.
- Setting `zugzeit` (default 90 s): think time per step for humans. When it runs out the autopilot takes that one
  step: roll as a bot would, skip the summon, give up the placement, or end the turn. `0` = no limit.

## Phone protocol

Phone → screen (validated by seat and turn; errors come back as `vlToast`):

| Message | Meaning |
|---|---|
| `vlHello` | send me my state |
| `vlBag { bag }` | bag choice (prep) |
| `vlRoll { dice: [k…] }` | roll these dice |
| `vlPick { die \| null }` | summon this die / don't summon |
| `vlBack` | back from placing to the summon choice |
| `vlPiece { shape, ori, x, y }` | placement preview (TV only, no state change) |
| `vlPlace { shape, ori, x, y }` | unfold here |
| `vlSel { mon, mode: move\|attack\|ability\|null, ab }` | what the phone is aiming at (TV highlights reach / targets) |
| `vlMove { mon, to }`, `vlAttack { mon, target: {mon}\|{dm} }`, `vlAbility { mon, ab, target: {}\|{mon}\|{cell} }` | actions |
| `vlDefend { choice }` | answer to an attack on my monster |
| `vlEnd` | end my turn |
| `vlAgain` | host: rematch (new bag choice) |

Screen → phone: `vlState` after every change (and once a second while a clock runs), `vlToast { text }`,
`vlBuzz` (your turn). `vlState = { phase: prep|play|over, me, host, seats: [{ name, color, bot, offline, bag }],
prep?: { bags, left }, g?, secs, defSecs }`. `g` is the rules state as this phone may see it: `board` is a string
(`.` empty, `a`–`d` path of seat 0–3, `A`–`D` master), other seats' crests are zero and their dice keys empty,
other players' hidden items have no key. The phone rebuilds `kind`/`owner` from `board` and calls `rules.js` on it.

## TV

`VerliesView` draws into its own full-window canvas (device pixels, at most 4K), the shell canvas is hidden and
gets a copy a few times a second only while Mitschauen viewers exist. Board floor and path tiles are cached
layers (64 px per cell); tokens, masters, items, previews and effects are drawn live. Camera: fits the board,
follows the action gently (`kamera: auto`, max 1.45×), mouse wheel zooms, drag pans, double-click or `0` goes back
to automatic; `+`/`-` zoom by keyboard. Animations run on the view's clock and never hold up the game: the rules
have already moved on; bots wait (`BOT_STEP`, `ROLL_PAUSE`) so people can follow them.

## Tests and tools

- `node test-verlies.js` — nets fold into cubes, dice faces, bags, placement, rolling and summoning, crest caps,
  movement, combat and all formulas, every ability, traps and items, elimination options, all victory modes,
  round limit, resigning, bot games with 2/3/4 seats and teams (deterministic per seed).
- `node test-verlies-flow.js` — lobby → bag choice → roll by tapping dice → summon → place → move → attack with the
  defender's dialog → a phone drops out (bot takes over) → game over → rematch → spectator → abort.
- Screenshots: `dev-verlies.html?n=4&sim=150000` (TV), `dev-verlies-phone.html?stage=act` (phone, 400×860),
  `dev-verlies-art.html` (portraits). The cover `public/covers/verlies.jpg` is the TV at 1920×1200, scaled.

## Open

- Nobody has played it with real phones yet. Balance (dice faces, monster values, ability costs) comes from bot
  games only; bots rush the masters and use few reactions.
- No sound of its own: it uses the shell palette (`whoosh`, `powerup`, `thud`, `hit`, `explosion`, `fanfare`).
