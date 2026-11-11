// ============ Controller module: FURT & FEHDE (the lord's war table) ============
// Phone = a painted parchment map (FurtWarmap) plus four modes: 🏗️ Bauen, ⚔️ Truppen, ⚑ Fahnen, 🤝 Pakte (only with 3+ houses). Landscape first, portrait works.
// It explains itself (Phase 1b): what every building is for on its card and in the placing panel, a ❓ guide, an advisor line with the most urgent tip, the food balance by 🌾,
// 💤 resting workplaces and a tap-to-send way to order banners (tap a banner, then the map). Phase 1b addendum: the war map shows what the wells cover (blue discs, 💧 / orange rings) while a Brunnen is placed or the card of a
// Brunnen or the own keep is open, and the top bar shows every store's cap; a tap on a good opens the 📦 Lager sheet.
// Phase 2 (docs "Phase 2 — Mauern & Söldner"): 💰 in the top bar (a tap opens the Markt); the wall tool (Palisade and Mauer are lines: drag one over the map, ↻ turns the corner, ✓ sends the pieces as one ffWall); the Torhaus (placed like a building);
// the ⚖️ Markt (the 📦 sheet's second page: sell and buy per good); the units grouped by the house that trains them (⚔️ Kaserne, ⛺ Söldnerlager); the Wehrgang (a banner dropped on an own Mauer, Torhaus or Wachturm sends its archers in;
// the card shows „🏹 n / m besetzt“, the map a 🏹 badge); advisor tips 11 (hungry with gold: buy 🌾), 12 (a full good: sell), 13 (enemy walls and no ram).
// Needs world.js and warmap.js loaded before it. Protocol: docs/FURTFEHDE.md "Phone protocol (Phase 1, binding)" as interpreted in its Implementation notes:
//   screen → phone  ffInfo { lord (index, −1 = spectator), color, host, lords [{ i, site, color, name, emblem, bot }], shared (co-player's name | false), costs { build: { kind: cost }, units: { unit: cost }, rebuild },
//                           rules { bucketR, keepWellR, capKeep, capKorn, capLager, keepHouses, hutHouses, tradePack, prices { sell { korn, holz, stein }, buy { … } } } (FurtSim.CONST: the well coverage, the 📦 Lager sheet and the Markt need them; without it the sim's defaults and the contract's 5 / 1-1-2 / 3-3-5) } · ffMap { grid, sites, crossings } · ffLevel { L }
//                   ffPhase { phase 'frieden'|'ebbe'|'fehde'|'over', endsAt (sim s the CURRENT phase ends), now (sim s) } · ffYou { stock { korn, holz, stein, gold }, cap { korn, holz, stein } (gold has none), pop, popCap, idle, hunger, queue [{ unit, n, p, wait? }] (wait: no peasant has been sent to the Kaserne for this recruit yet), ruhm, crown, pacts [{ with, state, until }], banners? [{ n (0 = Burgwache), count, x, y, tx, ty }], now?, food? { prod, eat } (sacks per minute) }
//                   ffBoard { b: [[id, lord, kind, i, j, rot, build, hp, fire, ruined, noWood?, workers?, rest?, len?, garrison?]], banners: [[lord, n, x, y, count]] } (rest: 0 works · 1 rests by order (💤) · 2 rests because its store is full; len = the length of a wall piece, garrison = the archers inside; old rows with 9 – 14 fields mean: works, len 1, garrison 0) · ffAlert { kind, text, x?, y? } · ffToast { text } · ffResult { ranking, you? }
//   phone → screen  ffBuild { kind, i, j, rot, len? } (also = rebuild a ruin; len only for a wall piece's ruin) · ffWall { kind, pieces [[i, j, rot, len], …] } (the good pieces of a line, in order) · ffTrade { good, side 'sell'|'buy', packs } · ffCancel { id } · ffRecruit { unit, n }
//                   · ffBanner { n, x, y } (a drop within 1 cell of an own Mauer, Torhaus or Wachturm keeps its exact point: it is a garrison order) · ffHome · ffPact { to, on } · ffPause { id, on } (a workplace rests / works again) · ffAgain (host, end screen)
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #v-furtfehde { --c:#d9a441; position:relative; overflow:hidden; color:#f3e7c9; background:#241a11; font-family:system-ui,sans-serif; }
  #v-furtfehde button { font-family:inherit; color:inherit; }
  #ffTop { flex:none; display:flex; align-items:center; gap:2px 12px; padding:3px 12px; min-height:42px; box-sizing:border-box; flex-wrap:wrap; z-index:6;
           background:linear-gradient(#45331f,#2e2216); border-bottom:3px solid var(--c); font-weight:800; font-size:16px; }
  .ff-r1, .ff-r2 { display:contents; }
  #v-furtfehde.host #ffTop { padding-right:142px; }
  #ffLord { display:flex; align-items:center; gap:7px; font-family:Georgia,'Palatino Linotype',serif; font-style:italic; font-size:17px; margin-right:2px; min-width:0; }
  #ffLord i { flex:none; width:15px; height:20px; border-radius:2px 2px 8px 8px; background:var(--c); border:2px solid #fff7e2; box-sizing:border-box; }
  #ffLord .nm { display:flex; flex-direction:column; line-height:1.05; min-width:0; }
  #ffLordNm { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #ffMit { font:700 11px system-ui,sans-serif; opacity:.78; white-space:nowrap; }
  #ffMit:empty { display:none; }
  .ff-res { display:flex; flex-wrap:wrap; align-items:baseline; align-content:center; min-width:46px; line-height:1.05; border-radius:8px; cursor:pointer; position:relative; }   /* wide: „🌾 30/90 +20 −6“ on one line, the bar under it */
  .ff-res::after { content:''; position:absolute; inset:-6px -4px; }   /* a bigger target for the thumb: a tap on a good opens the 📦 Lager */
  .ff-res > span { white-space:nowrap; }
  .ff-res b { font-variant-numeric:tabular-nums; margin-left:3px; }
  .ff-res .cap { font-size:10.5px; font-weight:700; opacity:.6; margin-left:1px; letter-spacing:-.2px; font-variant-numeric:tabular-nums; }
  .ff-res.full { background:rgba(255,142,52,.2); box-shadow:inset 0 0 0 1.5px rgba(255,160,80,.9); padding:0 3px; margin:0 -3px; }   /* a full store is marked */
  .ff-res.full b, .ff-res.full .cap { color:#ffb36b; opacity:1; }
  .ff-bar { display:block; flex:0 0 100%; order:3; height:3px; margin-top:2px; border-radius:2px; background:rgba(255,255,255,.18); overflow:hidden; }
  .ff-bar u { display:block; height:100%; width:0; background:#e8c26a; text-decoration:none; transition:width .3s; }
  .ff-res.full .ff-bar u { background:#ff9a4a; }
  .ff-res.hungry { background:#b3261e; padding:0 5px; margin:0 -5px; animation:ffPulse 1s ease-in-out infinite; }
  #ffFood { display:none; order:2; font-style:normal; font-size:11px; font-weight:800; margin-left:4px; padding:0 4px; border-radius:6px; background:rgba(0,0,0,.3); letter-spacing:-.2px; white-space:nowrap; }
  #ffFood.show { display:block; } #ffFood.pos { color:#9be58f; } #ffFood.neg { color:#ff9c8c; }
  #ffGold { min-width:0; } #ffGold b { color:#ffd666; }   /* 💰 has no cap and no bar; a tap opens the Markt */
  #ffPop { cursor:pointer; position:relative; } #ffPop::after { content:''; position:absolute; inset:-6px -4px; }
  #ffHelp { order:10; flex:none; width:32px; height:32px; padding:0; border:2px solid #7a5a36; border-radius:16px; background:rgba(46,34,22,.88); font-size:16px; line-height:1; display:flex; align-items:center; justify-content:center; }
  #ffHelp.pulse { border-color:#ffd666; animation:ffHelpPulse 1.15s ease-in-out infinite; }
  @keyframes ffHelpPulse { 0%,100% { box-shadow:0 0 0 0 rgba(255,214,102,.8); transform:scale(1); } 50% { box-shadow:0 0 0 7px rgba(255,214,102,0); transform:scale(1.14); } }
  #ffRuhm, #ffPop, #ffLvl { white-space:nowrap; }
  #ffRuhm small { font-size:12px; font-weight:700; opacity:.7; }
  #ffCrown { display:none; font-size:20px; filter:drop-shadow(0 0 5px #ffd60a); }
  #ffLvl { order:9; margin-left:auto; font-size:14px; padding:2px 9px; border-radius:11px; background:rgba(90,150,190,.28); }
  #ffLvl.high { background:#a8431e; } #ffLvl.mid { background:#7a6a2a; }
  #ffPhase { order:9; margin-left:auto; flex:none; white-space:nowrap; font-size:14px; font-weight:800; padding:3px 11px; border-radius:13px; background:#2c6f8f;
             box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.3); font-variant-numeric:tabular-nums; }
  #ffPhase .sh { display:none; }
  #ffPhase.ebbe { background:#3a7fb0; } #ffPhase.fehde { background:#8f2c22; } #ffPhase.over { background:#5a5148; }
  #ffPhase.warn { background:#c9731c; animation:ffPulse 1s ease-in-out infinite; } #ffPhase.letzte { background:#c62828; animation:ffPulse .8s ease-in-out infinite; }
  @keyframes ffPulse { 0%,100% { filter:none; } 50% { filter:brightness(1.35); } }
  /* the advisor: one line under the top bar with the most urgent tip (it takes no space when there is none) */
  #ffTip { flex:none; display:none; align-items:center; gap:6px; box-sizing:border-box; min-height:34px; padding:3px 4px 3px 11px; text-align:left; z-index:5; border-bottom:2px solid rgba(230,184,48,.6);
           background:linear-gradient(#4c3b1c,#3b2d17); color:#ffeab5; font-size:13px; font-weight:800; line-height:1.2; }
  #ffTip.show { display:flex; } #v-furtfehde.placing #ffTip { display:none; } #ffTip.hot { background:linear-gradient(#6a2a1c,#4a2016); border-bottom-color:rgba(255,120,90,.7); color:#ffd9cf; }
  #ffTip .tx { flex:1; min-width:0; cursor:pointer; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  #ffTip .go { flex:none; opacity:.7; font-size:16px; cursor:pointer; }
  #ffTip .x { flex:none; width:32px; height:32px; border:none; border-radius:16px; background:rgba(0,0,0,.22); font-size:13px; font-weight:900; opacity:.85; }
  #ffBody { flex:1; min-height:0; display:flex; flex-direction:row; }
  #ffModes { flex:none; width:78px; display:flex; flex-direction:column; gap:7px; padding:7px 6px; box-sizing:border-box; background:#2a1e14; }
  .ff-mode { position:relative; flex:1; min-height:0; border:2px solid #6a4c2c; border-radius:14px; background:linear-gradient(#4d3822,#3a2a1a); font-weight:800; font-size:12px;
             display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; padding:2px; letter-spacing:.2px; }
  .ff-mode .ic { font-size:28px; line-height:1; }
  .ff-mode.on { border-color:#fff3cf; background:linear-gradient(var(--c),#3a2a1a 160%); box-shadow:0 0 14px var(--c); color:var(--ct,#fff); }
  .ff-mode .bd { position:absolute; top:3px; right:3px; min-width:19px; height:19px; padding:0 4px; box-sizing:border-box; border-radius:10px; background:#d93025; color:#fff; font-size:12px; font-weight:900;
                 line-height:19px; text-align:center; display:none; box-shadow:0 0 0 2px #2a1e14; }
  .ff-mode .bd.ok { background:#2e9e4a; } .ff-mode .bd.hot { animation:ffPulse .9s ease-in-out infinite; }
  #ffMapWrap { flex:1; min-width:0; position:relative; background:#d8c89e; overflow:hidden; }
  #ffCanvas { position:absolute; left:0; top:0; width:100%; height:100%; background:#d8c89e; margin:0; border-radius:0; touch-action:none; display:block; }
  #ffZoom { position:absolute; left:8px; top:8px; display:flex; gap:4px; z-index:3; }
  #ffZoom button { border:2px solid #6a4c2c; border-radius:15px; background:rgba(46,34,22,.88); font-size:13px; font-weight:800; padding:7px 11px; }
  #ffZoom button.on { background:var(--c); border-color:#fff3cf; color:var(--ct,#fff); }
  #ffToasts { position:absolute; left:0; right:0; bottom:10px; z-index:8; display:flex; flex-direction:column; align-items:center; gap:6px; pointer-events:none; }
  #v-furtfehde.offer #ffToasts { bottom:104px; }
  .ff-toast { background:rgba(36,26,16,.93); border:2px solid var(--c); border-radius:16px; padding:7px 15px; font-size:15px; font-weight:800; max-width:86%; text-align:center; animation:ffIn .22s ease-out; transition:opacity .4s; }
  .ff-toast.out { opacity:0; }
  @keyframes ffIn { from { transform:translateY(10px); opacity:0; } to { transform:none; opacity:1; } }
  #ffPanel { flex:none; width:min(36vw,248px); box-sizing:border-box; padding:7px; background:#33261a; border-left:2px solid #5a4126; overflow:hidden; display:flex; flex-direction:column; }
  .ff-sec { display:none; flex:1; min-height:0; flex-direction:column; gap:7px; overflow-y:auto; touch-action:pan-y; scrollbar-width:thin; scrollbar-color:#7a5a36 transparent; }
  .ff-sec.on { display:flex; }
  .ff-h { flex:none; font-size:13px; font-weight:800; opacity:.85; letter-spacing:.2px; }
  .ff-h small { font-weight:600; opacity:.75; }
  #ffCards { flex:1; min-height:0; overflow-y:auto; touch-action:pan-y; display:flex; flex-direction:column; gap:6px; scrollbar-width:thin; scrollbar-color:#7a5a36 transparent; }
  #ffPBau.placing #ffCards, #ffPBau.placing > .ff-h { display:none; }
  .ff-card { flex:none; display:grid; grid-template-columns:38px 1fr; grid-template-rows:auto auto auto; column-gap:8px; align-items:center; text-align:left; padding:6px 9px; min-height:52px;
             border:2px solid #7a5a36; border-radius:12px; background:linear-gradient(#4f3a24,#3d2d1d); }
  .ff-card { min-width:0; }
  .ff-card .ic { grid-row:1 / 4; font-size:30px; text-align:center; line-height:1; }
  .ff-card .wz { font-size:11.5px; font-weight:600; opacity:.8; line-height:1.2; margin:1px 0 3px; }
  .ff-card .nm { font-size:15px; font-weight:800; line-height:1.1; overflow-wrap:break-word; }
  .ff-card .nm small { font-weight:600; opacity:.65; font-size:11px; margin-left:1px; white-space:nowrap; }
  .ff-card .cost, .ff-ucost { display:flex; gap:4px; flex-wrap:wrap; }
  .ff-chip { font-size:12px; font-weight:800; padding:0 6px; border-radius:9px; background:rgba(255,255,255,.16); white-space:nowrap; }
  .ff-chip.miss { background:#b3261e; }
  .ff-card.poor { opacity:.72; }
  .ff-cg { flex:none; grid-column:1 / -1; font-size:11px; font-weight:900; letter-spacing:.6px; text-transform:uppercase; opacity:.62; padding:3px 2px 0; }
  .ff-chip.pc { background:none; padding:0 1px; font-weight:700; opacity:.8; }   /* „je Feld“ after the cost of a wall */
  .ff-card:active, .ff-unit:active, .ff-tg:active, .ff-home:active, .pt-b button:active, #ffCBtns button:active { filter:brightness(1.3); }
  .ff-card.no { animation:ffShake .3s; }
  @keyframes ffShake { 0%,100% { transform:translateX(0); } 25% { transform:translateX(-6px); } 75% { transform:translateX(6px); } }
  #ffPlace { display:none; flex:1; min-height:0; flex-direction:column; gap:6px; }
  #ffPBau.placing #ffPlace { display:flex; }
  #ffPHead { flex:none; display:flex; align-items:center; gap:9px; }
  #ffPIc { font-size:32px; line-height:1; }
  #ffPNm { font-size:17px; font-weight:900; line-height:1.1; }
  #ffPInfo { flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; touch-action:pan-y; display:flex; flex-direction:column; gap:5px; scrollbar-width:thin; scrollbar-color:#7a5a36 transparent; }
  #ffPRule { flex:none; font-size:12px; opacity:.78; line-height:1.25; }
  #ffPRule:empty { display:none; }
  .ff-il { flex:none; font-size:13px; line-height:1.32; }
  .ff-il b { font-size:10.5px; font-weight:900; letter-spacing:.5px; text-transform:uppercase; color:#e8c26a; margin-right:5px; }
  #ffPCover { flex:none; display:none; padding:5px 10px; border-radius:10px; background:rgba(70,140,215,.26); box-shadow:inset 0 0 0 1.5px rgba(120,185,245,.5); color:#d9ecff; font-size:13px; font-weight:800; line-height:1.28; }
  #ffPCover.show { display:block; } #ffPCover > span { display:inline-block; } #ffPCover i { font-style:normal; }
  @media (orientation:landscape) { #ffPCover { padding:4px 9px; font-size:12.5px; } #ffPCover > span { display:block; } #ffPCover .sep, #ffPCover .x { display:none; } }   /* the narrow side panel: two short lines */
  #ffReason { flex:none; min-height:38px; display:flex; align-items:center; border-radius:10px; padding:5px 10px; font-size:14.5px; font-weight:800; line-height:1.2; background:rgba(98,198,92,.18); color:#bff0b0; }
  #ffPHint { flex:none; font-size:11px; line-height:1.3; opacity:.6; margin-top:1px; }
  #ffReason.bad { background:rgba(224,72,58,.24); color:#ffc2b8; } #ffReason.idle { background:rgba(255,255,255,.1); color:#e8dcc0; } #ffReason.warn { background:rgba(230,184,48,.22); color:#ffe9a8; }
  #ffPSum { flex:none; display:none; padding:5px 10px; border-radius:10px; background:rgba(230,184,48,.18); box-shadow:inset 0 0 0 1.5px rgba(230,184,48,.5); color:#ffe9a8; font-size:13.5px; font-weight:800; line-height:1.25; }
  #ffPSum.show { display:block; }
  #ffPBtns { flex:none; display:flex; gap:7px; }
  #ffPBtns button { flex:1; height:48px; border:none; border-radius:14px; font-size:26px; font-weight:900; background:#4d3a26; }
  #ffOk { flex:1.7 !important; background:#2f9a44 !important; color:#fff; }
  #ffOk.bad { background:#6e4c44 !important; color:#d8b8b0; }
  #ffNo { background:#8a3a2e !important; }
  #ffTargets { flex:none; display:grid; grid-template-columns:repeat(4,1fr); gap:5px; }
  .ff-tg { border:2px solid #7a5a36; border-radius:11px; background:#43321f; padding:5px 2px; font-size:13px; font-weight:900; line-height:1.15; display:flex; flex-direction:column; align-items:center; }
  .ff-tg .ic { font-size:18px; } .ff-tg small { font-size:10px; font-weight:700; opacity:.8; }
  .ff-tg.on { border-color:#fff3cf; background:var(--c); color:var(--ct,#fff); }
  .ff-send { flex:none; min-height:40px; border:2px solid #fff3cf; border-radius:12px; background:linear-gradient(var(--c),#3a2a1a 220%); color:var(--ct,#fff) !important; font-size:14.5px; font-weight:900; text-shadow:0 1px 3px rgba(0,0,0,.35); }
  .ff-send[hidden] { display:none; } .ff-send.poor { opacity:.72; } .ff-send:active { filter:brightness(1.25); }
  #ffUnits { flex:none; display:flex; flex-direction:column; gap:9px; }
  .ff-grp { display:flex; flex-direction:column; gap:5px; }
  .ff-gh { display:flex; align-items:baseline; gap:6px; font-size:13px; font-weight:900; letter-spacing:.2px; } .ff-gh small { margin-left:auto; font-size:11px; font-weight:700; opacity:.78; }
  .ff-gunits { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
  .ff-grp.off .ff-gunits { opacity:.4; filter:grayscale(.55); }   /* its house is missing: dimmed, the note says what to build */
  .ff-gnote { flex:none; min-height:38px; border:2px dashed rgba(255,214,102,.55); border-radius:11px; background:rgba(230,184,48,.16); color:#ffe9a8 !important; font-size:12.5px; font-weight:800; line-height:1.25; padding:4px 9px; text-align:left; }
  .ff-gnote[hidden] { display:none; } .ff-gnote:active { filter:brightness(1.3); }
  .ff-unit { min-height:76px; border:2px solid #7a5a36; border-radius:13px; background:linear-gradient(#4f3a24,#3d2d1d); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; padding:3px; }
  .ff-unit .big { font-size:26px; font-weight:900; line-height:1; } .ff-unit .nm { font-size:12px; font-weight:800; text-align:center; line-height:1.1; }
  .ff-unit .ff-ucost { justify-content:center; }
  .ff-unit.poor { opacity:.7; } .ff-unit.no { animation:ffShake .3s; }
  .ff-unit.sent { animation:ffPop .35s; }
  @keyframes ffPop { 0% { transform:scale(1); } 40% { transform:scale(1.1); background:var(--c); } 100% { transform:scale(1); } }
  #ffQueue { flex:none; display:flex; gap:5px; flex-wrap:wrap; min-height:24px; align-items:center; }
  .ff-q { position:relative; font-size:13px; font-weight:800; padding:2px 8px; border-radius:10px; background:rgba(255,255,255,.14); overflow:hidden; white-space:nowrap; }
  .ff-q u { position:absolute; left:0; top:0; bottom:0; background:rgba(255,255,255,.2); text-decoration:none; }
  .ff-q span { position:relative; }
  .ff-q.wait { background:rgba(230,184,48,.2); box-shadow:inset 0 0 0 1.5px rgba(230,184,48,.55); color:#ffe9a8; }
  .ff-qwait { flex:1 0 100%; font-size:12px; font-weight:700; line-height:1.3; color:#ffe9a8; }
  #ffBans { display:flex; flex-direction:column; gap:6px; }
  .ff-ban { border:2px solid #7a5a36; border-radius:12px; background:#43321f; padding:6px 10px; display:flex; align-items:center; gap:10px; text-align:left; font-size:14px; font-weight:800; }
  .ff-ban i { flex:none; width:26px; height:30px; border-radius:50% 50% 50% 50% / 55% 55% 45% 45%; background:var(--c); border:2px solid #fff7e2; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font:700 13px Georgia,serif; color:#fff; font-style:normal; }
  .ff-ban small { display:block; font-size:11px; font-weight:600; opacity:.75; }
  #ffBanHint { flex:none; font-size:13px; line-height:1.35; opacity:.9; padding:5px 9px; border-radius:9px; background:rgba(255,255,255,.07); }
  #ffBanHint.armed { opacity:1; font-weight:900; font-size:14px; background:rgba(255,214,102,.24); color:#fff0c4; box-shadow:inset 0 0 0 2px rgba(255,214,102,.6); }
  .ff-ban.on { border-color:#ffd666; background:#5a4620; box-shadow:0 0 12px rgba(255,214,102,.45); }
  .ff-home { flex:none; margin-top:auto; min-height:48px; border:2px solid #fff3cf; border-radius:13px; background:linear-gradient(var(--c),#3a2a1a 200%); color:var(--ct,#fff) !important; font-size:16px; font-weight:900; text-shadow:0 1px 3px rgba(0,0,0,.35); }
  /* 🤝 Pakte */
  #ffPacts { flex:1; min-height:0; overflow-y:auto; touch-action:pan-y; display:flex; flex-direction:column; gap:7px; scrollbar-width:thin; scrollbar-color:#7a5a36 transparent; }
  .ff-pact { flex:none; border:2px solid #6a4c2c; border-left:6px solid var(--hc,#6a4c2c); border-radius:12px; background:linear-gradient(#4a3722,#3a2a1a); padding:5px 8px 6px; display:flex; flex-direction:column; gap:4px; }
  .ff-pact.active { border-color:#3f9c55; border-left-color:var(--hc); } .ff-pact.incoming { border-color:#e6b830; border-left-color:var(--hc); box-shadow:0 0 14px rgba(230,184,48,.35); } .ff-pact.offered { border-color:#6a8fb0; border-left-color:var(--hc); }
  .pt-h { display:flex; align-items:center; gap:7px; }
  .pt-h .nm { flex:1; min-width:0; font-size:15px; font-weight:800; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .pt-s { flex:none; font-size:13px; font-weight:800; padding:1px 8px; border-radius:10px; background:rgba(255,255,255,.14); font-variant-numeric:tabular-nums; white-space:nowrap; }
  .pt-s:empty { display:none; }
  .ff-pact.active .pt-s { background:#2e7d43; } .ff-pact.incoming .pt-s { background:#a8841c; } .ff-pact.offered .pt-s { background:#3d6a8f; }
  .pt-t { font-size:12px; line-height:1.3; opacity:.82; }
  .pt-t:empty { display:none; }
  .pt-b { display:flex; gap:6px; flex-wrap:wrap; }
  .pt-b button { flex:1 1 0; min-width:0; min-height:38px; border:none; border-radius:11px; font-size:12.5px; font-weight:900; padding:3px 2px; background:#5a4630; line-height:1.15; }
  .pt-b .go { background:#2f9a44; color:#fff; } .pt-b .no { background:#8a3a2e; color:#fff; } .pt-b .brk { background:#7a2a2a; color:#fff; }
  .pt-b button[hidden] { display:none; }
  .ff-pact.busy .pt-b button { opacity:.45; pointer-events:none; }
  #ffPNote { flex:none; display:none; font-size:11px; line-height:1.35; opacity:.62; padding:0 3px; }
  #ffOffer { position:absolute; left:8px; right:8px; bottom:8px; z-index:8; display:none; flex-direction:column; gap:6px; padding:7px 9px 10px; border:2px solid #e6b830; border-radius:16px; overflow:hidden;
             background:linear-gradient(#5a4528,#3a2a1a); box-shadow:0 6px 22px rgba(0,0,0,.55), 0 0 18px rgba(230,184,48,.4); }
  #ffOffer.show { display:flex; animation:ffIn .25s ease-out; }
  #ffOffer .of-h { display:flex; align-items:center; gap:8px; font-size:15px; font-weight:800; line-height:1.15; }
  #ffOffer .of-h .tx { flex:1; min-width:0; }
  #ffOffer .of-h b.t { flex:none; font-variant-numeric:tabular-nums; background:rgba(255,255,255,.16); border-radius:10px; padding:1px 8px; font-size:14px; }
  #ffOffer .of-b { display:flex; gap:7px; }
  #ffOffer .of-b button { flex:1; min-height:42px; border:none; border-radius:12px; font-size:15px; font-weight:900; color:#fff; }
  #ffOfYes { background:#2f9a44; } #ffOfNo { background:#8a3a2e; } #ffOfLater { flex:none !important; width:46px; background:#4d3a26; font-size:16px !important; }
  #ffOffer .of-bar { position:absolute; left:0; right:0; bottom:0; height:4px; background:rgba(0,0,0,.35); }
  #ffOffer .of-bar u { display:block; height:100%; width:100%; background:#e6b830; text-decoration:none; }
  /* building card */
  #ffPanel.card > .ff-sec { display:none !important; } #ffPanel.card > #ffPCard { display:flex !important; }
  #ffPCard { gap:7px; overflow-y:auto; touch-action:pan-y; }
  #ffCHead { flex:none; display:flex; align-items:center; gap:9px; }
  #ffCIc { font-size:34px; line-height:1; }
  #ffCNm { font-size:18px; font-weight:900; line-height:1.05; } #ffCSz { font-size:11px; font-weight:600; opacity:.65; }
  #ffCClose { margin-left:auto; flex:none; width:40px; height:40px; border:none; border-radius:12px; background:#4d3a26; font-size:18px; font-weight:900; }
  .ff-hp { flex:none; display:flex; align-items:center; gap:7px; font-size:13px; font-weight:800; }
  .ff-hp[hidden], .ff-il[hidden] { display:none; }
  .ff-hpbar { flex:1; height:13px; border-radius:7px; background:rgba(0,0,0,.42); overflow:hidden; box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.22); }
  .ff-hpbar u { display:block; height:100%; width:0; background:#5cc24a; text-decoration:none; transition:width .3s; }
  .ff-hp b { min-width:34px; text-align:right; font-variant-numeric:tabular-nums; }
  #ffCState { flex:none; font-size:16px; font-weight:900; line-height:1.15; padding:7px 10px; border-radius:10px; background:rgba(255,255,255,.12); }
  #ffCState.work { background:rgba(92,194,74,.24); color:#c8f5bc; } #ffCState.wait { background:rgba(230,184,48,.24); color:#ffe9a8; } #ffCState.fire { background:rgba(224,72,58,.32); color:#ffc2b8; }
  #ffCState.build { background:rgba(120,170,220,.26); color:#cfe4ff; } #ffCState.ruin { background:rgba(150,140,128,.32); color:#eadfce; } #ffCState.rest { background:rgba(90,120,190,.3); color:#d5e1ff; }
  #ffCGar { flex:none; font-size:15px; font-weight:900; line-height:1.2; padding:6px 10px; border-radius:10px; background:rgba(255,255,255,.12); }
  #ffCGar[hidden] { display:none; } #ffCGar.some { background:rgba(230,184,48,.24); color:#ffe9a8; } #ffCGar.full { background:rgba(92,194,74,.24); color:#c8f5bc; }
  #ffCGar small { display:block; font-size:12px; font-weight:600; line-height:1.3; opacity:.88; margin-top:2px; }
  #ffCPause { flex:none; min-height:46px; border:none; border-radius:13px; font-size:15px; font-weight:900; padding:5px 8px; line-height:1.15; background:#3f5a94; color:#fff; }
  #ffCPause[hidden] { display:none; } #ffCPause.go { background:#2f9a44; } #ffCPause:active { filter:brightness(1.3); }
  #ffCInfo { flex:none; display:flex; flex-direction:column; gap:5px; }
  #ffCCost { flex:none; display:flex; align-items:center; gap:5px; flex-wrap:wrap; font-size:12px; font-weight:700; opacity:.95; }
  #ffCCost:empty { display:none; }
  #ffCBtns { flex:none; display:flex; flex-direction:column; gap:6px; margin-top:6px; }
  @media (orientation:landscape) { #ffCBtns { margin-top:auto; } }
  #ffCBtns button { min-height:46px; border:none; border-radius:13px; font-size:15px; font-weight:900; padding:5px 8px; line-height:1.15; background:#5a4630; color:#fff; }
  #ffCBtns button[hidden], #ffCBtns .row[hidden] { display:none; }
  #ffCBtns .go { background:#2f9a44; } #ffCBtns .bad { background:#8a3a2e; } #ffCBtns .dim { background:#6e4c44; color:#d8b8b0; }
  #ffCBtns .row { display:flex; gap:6px; } #ffCBtns .row button { flex:1; }
  #ffCAsk { flex:none; font-size:13px; font-weight:800; line-height:1.3; color:#ffd0c8; }
  #ffCAsk[hidden] { display:none; }
  /* the guide: full screen over everything but the alerts */
  .ff-guide { position:absolute; inset:0; z-index:10; display:none; flex-direction:column; background:#2a1e14; }
  .ff-guide.show { display:flex; animation:ffIn .2s ease-out; }
  .gd-head { flex:none; display:flex; align-items:center; gap:10px; padding:7px 10px; background:linear-gradient(#45331f,#2e2216); border-bottom:3px solid var(--c); }
  #v-furtfehde.host .gd-head { padding-right:150px; }
  #ffGuideX { flex:none; width:46px; height:42px; border:none; border-radius:13px; background:#7a3a2e; font-size:20px; font-weight:900; }
  .gd-t { flex:1; min-width:0; font-size:19px; font-weight:900; font-family:Georgia,'Palatino Linotype',serif; font-style:italic; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .gd-nav { flex:none; display:flex; gap:6px; overflow-x:auto; padding:7px 10px; background:#33261a; border-bottom:2px solid #5a4126; touch-action:pan-x; scrollbar-width:none; }
  .gd-nav::-webkit-scrollbar { display:none; }
  .gd-nav button { flex:none; border:2px solid #7a5a36; border-radius:15px; background:#43321f; font-size:13px; font-weight:800; padding:5px 11px; white-space:nowrap; }
  .gd-nav button.on { background:var(--c); border-color:#fff3cf; color:var(--ct,#fff); }
  .gd-body { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; touch-action:pan-y; padding:12px 14px 44px; position:relative; scrollbar-width:thin; scrollbar-color:#7a5a36 transparent; }
  .gd-sec { max-width:640px; margin:0 auto 20px; }
  .gd-sec h3 { margin:0 0 9px; font-size:19px; font-family:Georgia,'Palatino Linotype',serif; font-style:italic; border-bottom:2px solid rgba(255,255,255,.18); padding-bottom:5px; }
  .gd-sec ul { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:8px; }
  .gd-sec li { font-size:14.5px; line-height:1.42; }
  .gd-sec li b { color:#ffe19a; }
  .gd-bld { margin:0 0 9px; padding:7px 10px 8px; border:2px solid #6a4c2c; border-radius:12px; background:linear-gradient(#4a3722,#3a2a1a); display:flex; flex-direction:column; gap:4px; }
  .gd-bld .hd { display:flex; align-items:center; gap:9px; font-size:16px; font-weight:900; }
  .gd-bld .hd .ic { font-size:26px; line-height:1; } .gd-bld .hd small { font-weight:600; opacity:.65; font-size:11.5px; margin-left:5px; }
  .gd-bld .ff-il { font-size:13.5px; }
  /* 📦 Lager: what every good holds and where the room comes from; it drops from the top bar when a good or 👥 is tapped */
  .ff-lager { position:absolute; left:0; right:0; bottom:0; top:var(--sh,64px); z-index:9; display:none; background:rgba(12,8,4,.6); }
  .ff-lager.show { display:block; animation:ffFade .18s ease-out; }
  @keyframes ffFade { from { opacity:0; } to { opacity:1; } }
  .lg-sheet { position:absolute; left:0; right:0; top:0; margin:0 auto; max-width:780px; max-height:100%; box-sizing:border-box; overflow-y:auto; overscroll-behavior:contain; touch-action:pan-y; padding:7px 10px 12px;
              background:linear-gradient(#3b2c1c,#2a1e14); border-bottom:3px solid var(--c); border-radius:0 0 16px 16px; box-shadow:0 12px 28px rgba(0,0,0,.6); scrollbar-width:thin; scrollbar-color:#7a5a36 transparent; animation:ffDrop .2s ease-out; }
  .lg-head { display:flex; align-items:center; gap:8px; padding:0 0 7px; }
  .lg-t { flex:1; min-width:0; font-size:20px; font-weight:900; font-family:Georgia,'Palatino Linotype',serif; font-style:italic; }
  #ffLagerX { flex:none; width:46px; height:40px; border:none; border-radius:13px; background:#7a3a2e; font-size:19px; font-weight:900; }
  .lg-body { display:grid; grid-template-columns:1fr; gap:7px; }
  .lg-row { display:flex; flex-direction:column; gap:4px; padding:6px 10px 8px; border-radius:12px; background:rgba(255,255,255,.07); min-width:0; }
  .lg-row.full { background:rgba(255,142,52,.14); box-shadow:inset 0 0 0 2px rgba(255,160,80,.8); }
  .lg-h { display:flex; align-items:baseline; gap:7px; font-size:15px; font-weight:800; }
  .lg-h .ic { font-size:19px; line-height:1; align-self:center; }
  .lg-h .amt { margin-left:auto; font-size:19px; font-variant-numeric:tabular-nums; } .lg-h .cp { font-size:13px; opacity:.62; font-variant-numeric:tabular-nums; margin-left:-4px; }
  .lg-row.full .lg-h .amt, .lg-row.full .lg-h .cp { color:#ffb36b; opacity:1; }
  .lg-bar { height:9px; border-radius:5px; background:rgba(0,0,0,.42); overflow:hidden; box-shadow:inset 0 0 0 1px rgba(255,255,255,.14); }
  .lg-bar u { display:block; height:100%; width:0; text-decoration:none; background:linear-gradient(#f3d57e,#d6a53c); transition:width .3s; }
  .lg-row.full .lg-bar u { background:linear-gradient(#ffb877,#ee7b28); }
  .lg-src { font-size:12.5px; line-height:1.3; opacity:.85; }
  .lg-note { font-size:13px; font-weight:800; line-height:1.3; } .lg-note:empty { display:none; } .lg-note.pos { color:#a7efa0; } .lg-note.neg { color:#ffaa9c; }
  .lg-tips { display:flex; gap:6px; flex-wrap:wrap; } .lg-tips:empty { display:none; }
  .lg-tip { min-height:36px; border:2px solid #ffb066; border-radius:11px; background:rgba(255,154,74,.24); color:#ffe6cc !important; font-size:12.5px; font-weight:800; padding:4px 8px; line-height:1.15; text-align:left; }
  .lg-tip:active { filter:brightness(1.3); }
  .lg-more { min-height:40px; border:2px solid #7a5a36; border-radius:12px; background:#43321f; font-size:13.5px; font-weight:800; }
  #ffLager [hidden] { display:none !important; }   /* (the sheet's own display rules must not beat the attribute) */
  /* ⚖️ Markt: the second page of the same sheet (💰 in the top bar, the Markt's card, „⚖️ Zum Markt“ in the 📦 Lager) */
  .mk-top { display:flex; align-items:center; gap:8px; padding:5px 10px; border-radius:12px; background:rgba(255,255,255,.07); min-width:0; }
  .mk-gold { flex:1; min-width:0; font-size:21px; font-weight:900; font-variant-numeric:tabular-nums; color:#ffd666; } .mk-gold small { font-size:12px; font-weight:700; color:#f3e7c9; opacity:.75; margin-left:6px; }
  .mk-mul { flex:none; display:flex; gap:5px; align-items:center; font-size:12px; font-weight:800; } .mk-mul span { opacity:.7; margin-right:2px; }
  .mk-mul button { min-width:46px; min-height:38px; border:2px solid #7a5a36; border-radius:11px; background:#43321f; font-size:15px; font-weight:900; } .mk-mul button.on { background:var(--c); border-color:#fff3cf; color:var(--ct,#fff); }
  .mk-btns { display:flex; gap:7px; }
  .mk-b { flex:1; min-width:0; min-height:50px; border:2px solid rgba(255,255,255,.25); border-radius:12px; color:#fff; font-size:13.5px; font-weight:900; line-height:1.15; padding:4px 6px; display:flex; flex-direction:column; align-items:center; justify-content:center; touch-action:manipulation; -webkit-touch-callout:none; }
  .mk-b small { font-size:12.5px; font-weight:700; opacity:.95; white-space:nowrap; } .mk-b.sell { background:#2f7a40; } .mk-b.buy { background:#8c5f1a; }
  .mk-b:disabled { opacity:.36; border-color:transparent; } .mk-b:active:not(:disabled) { filter:brightness(1.3); } .mk-b.hold { filter:brightness(1.35); box-shadow:0 0 0 3px rgba(255,214,102,.8); }
  .mk-none { display:flex; flex-direction:column; gap:8px; align-items:stretch; padding:8px 10px 10px; border-radius:12px; background:rgba(255,255,255,.07); }
  .mk-none .big { font-size:19px; font-weight:900; line-height:1.2; } .mk-none .sub { font-size:13.5px; line-height:1.35; opacity:.88; }
  .mk-none button { min-height:46px; border:2px solid #fff3cf; border-radius:12px; background:linear-gradient(var(--c),#3a2a1a 220%); color:var(--ct,#fff) !important; font-size:15px; font-weight:900; }
  .mk-note { font-size:12px; line-height:1.35; opacity:.75; padding:0 4px; }
  @media (orientation:landscape) and (min-width:700px) { .lg-body { grid-template-columns:1fr 1fr; } .lg-more { grid-column:1 / -1; } }
  @media (max-height:480px) { .lg-sheet { padding:4px 10px 8px; } .lg-head { padding-bottom:4px; } #ffLagerX { height:34px; } .lg-t { font-size:18px; } .lg-row { padding:4px 9px 6px; gap:3px; } .lg-more { min-height:34px; } .lg-body { gap:6px; } .lg-tip { min-height:30px; padding:3px 7px; font-size:12px; } }
  /* alerts */
  #ffAlert { position:absolute; left:0; right:0; top:var(--sh,44px); z-index:12; display:none; align-items:center; gap:11px; padding:8px 14px; box-sizing:border-box; color:#fff; background:#b3261e;
             font-size:17px; font-weight:900; line-height:1.15; text-shadow:0 1px 4px rgba(0,0,0,.55); border-bottom:3px solid rgba(255,255,255,.55); box-shadow:0 6px 18px rgba(0,0,0,.5); }
  #v-furtfehde.host #ffAlert { padding-right:14px; }
  #ffAlert.show { display:flex; animation:ffDrop .28s ease-out; }
  #ffAlert .ic { flex:none; font-size:28px; line-height:1; text-shadow:none; }
  #ffAlert.attack .ic, #ffAlert.fire .ic, #ffAlert.plunder .ic { animation:ffWob .5s ease-in-out 3; }
  @keyframes ffWob { 0%,100% { transform:rotate(0); } 25% { transform:rotate(-16deg) scale(1.15); } 75% { transform:rotate(16deg) scale(1.15); } }
  #ffAlert .tx { flex:1; min-width:0; }
  #ffAlert .x { flex:none; opacity:.7; font-size:15px; }
  #ffAlert.attack { background:#b3261e; } #ffAlert.fire { background:#d9531e; } #ffAlert.hunger { background:#8a5a1c; } #ffAlert.plunder { background:#7d1f5a; }
  #ffAlert.crossing { background:#1f6fa8; } #ffAlert.pact { background:#2a8a45; } #ffAlert.crown { background:#e0a820; color:#2b1d0e; text-shadow:none; border-bottom-color:rgba(255,255,255,.8); }
  @keyframes ffDrop { from { transform:translateY(-100%); opacity:0; } to { transform:none; opacity:1; } }
  #ffFlash { position:absolute; inset:0; z-index:11; pointer-events:none; opacity:0; background:radial-gradient(ellipse at center, rgba(230,40,30,0) 40%, rgba(230,40,30,.62) 100%); }
  #ffFlash.go { animation:ffFlash 1s ease-out; }
  @keyframes ffFlash { 0% { opacity:1; } 100% { opacity:0; } }
  /* overlays */
  .ff-over { position:absolute; inset:0; z-index:9; display:none; flex-direction:column; align-items:center; justify-content:center; gap:12px; text-align:center; padding:20px; box-sizing:border-box;
             background:radial-gradient(ellipse at center,#4a3a24,#241a11); font-size:24px; font-weight:800; }
  .ff-over.show { display:flex; }
  .ff-over .sub { font-size:15px; font-weight:600; opacity:.75; max-width:320px; }
  /* spectator: the map plus the list of houses */
  #v-furtfehde.spec #ffModes, #v-furtfehde.spec #ffZoom, #v-furtfehde.spec .ff-res, #v-furtfehde.spec #ffPop, #v-furtfehde.spec #ffRuhm, #v-furtfehde.spec #ffCrown, #v-furtfehde.spec #ffLord i { display:none; }
  #v-furtfehde.spec .ff-sec { display:none !important; } #v-furtfehde.spec #ffPSpec { display:flex !important; }
  #ffPSpec { gap:8px; overflow-y:auto; touch-action:pan-y; }
  #ffSpecT { flex:none; font-size:19px; font-weight:900; line-height:1.15; }
  #ffSpecS { flex:none; font-size:13px; opacity:.75; margin-top:-3px; }
  #ffSpecL { display:flex; flex-direction:column; gap:6px; }
  .ff-spl { display:flex; align-items:center; gap:8px; padding:5px 9px; border-radius:11px; background:rgba(255,255,255,.1); font-size:14px; font-weight:800; line-height:1.1; min-width:0; }
  .ff-spl .nm { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ff-spl small { display:block; font-size:11px; font-weight:600; opacity:.65; }
  .dot { flex:none; width:14px; height:19px; border-radius:2px 2px 8px 8px; border:2px solid #fff7e2; box-sizing:border-box; background:var(--hc,#888); }
  /* end screen */
  #ffEnd { justify-content:flex-start; flex-direction:column; align-items:stretch; overflow-y:auto; touch-action:pan-y; gap:14px; padding:18px 18px 22px; font-size:16px; scrollbar-width:thin; scrollbar-color:#7a5a36 transparent;
           background:radial-gradient(ellipse at 50% 18%,#5f4a2a,#2a1e13 72%); }
  #ffEnd.show { display:flex; }
  #ffEnd .col { display:flex; flex-direction:column; gap:10px; width:100%; max-width:460px; margin:0 auto; min-width:0; }
  #ffEndHead { text-align:center; }
  #ffEndT { font-size:24px; font-weight:900; line-height:1.15; text-shadow:0 2px 8px rgba(0,0,0,.45); }
  #ffEndS { font-size:15px; font-weight:700; opacity:.85; margin-top:3px; }
  #ffRank { display:flex; flex-direction:column; gap:6px; }
  .rk { display:flex; align-items:center; gap:9px; padding:6px 10px; border-radius:13px; background:rgba(255,255,255,.1); border:2px solid transparent; min-width:0; }
  .rk .no { flex:none; width:30px; text-align:center; font-size:22px; font-weight:900; line-height:1; }
  .rk .nm { flex:1; min-width:0; font-size:16px; font-weight:900; line-height:1.1; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .rk .nm small { display:block; font-size:12px; font-weight:600; opacity:.7; overflow:hidden; text-overflow:ellipsis; }
  .rk .you { flex:none; font-size:11px; font-weight:900; letter-spacing:.4px; padding:1px 7px; border-radius:9px; background:#fff3cf; color:#2b1d0e; }
  .rk .sc { flex:none; font-size:17px; font-weight:900; font-variant-numeric:tabular-nums; }
  .rk.win { background:rgba(230,184,48,.2); } .rk.me { border-color:#fff3cf; background:rgba(255,243,207,.16); }
  #ffEndH { font-size:13px; font-weight:800; opacity:.8; letter-spacing:.3px; }
  #ffStats { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
  #ffStats div { background:rgba(255,255,255,.1); border-radius:12px; padding:6px 9px; font-size:12px; font-weight:700; line-height:1.2; }
  #ffStats b { display:block; font-size:20px; font-weight:900; }
  #ffAgain { min-height:56px; font-size:22px; padding:12px 28px; border:none; border-radius:18px; background:#30d158; color:#06250f !important; font-weight:900; display:none; box-shadow:0 4px 16px rgba(48,209,88,.35); }
  #ffWaitHost { font-size:15px; font-weight:600; opacity:.75; text-align:center; display:none; }
  #v-furtfehde.host #ffEnd { padding-top:52px; }
  @media (orientation:landscape) {
    #ffEnd.show { flex-direction:row; align-items:center; gap:22px; padding:10px 22px; }
    #v-furtfehde.host #ffEnd.show { padding-top:48px; padding-bottom:10px; }
    #ffEnd .col { margin:0; max-width:none; flex:1; }
    #ffEndHead { text-align:left; } #ffEndT { font-size:21px; }
    #ffEnd .col2 { flex:none; width:44%; }
  }
  @media (max-width:960px) { #ffLvl .w, #ffRuhm .w, #ffLord .pre { display:none; } #ffTop { gap:2px 8px; } #ffLord { font-size:15px; } #ffPhase { font-size:13px; padding:3px 9px; } }   /* 💰 joined the bar: a phone in landscape (≈ 800 px) must still keep it on one line */
  @media (max-width:350px) { .ff-unit .nm { font-size:10px; letter-spacing:-.1px; } .ff-card { grid-template-columns:30px 1fr; column-gap:6px; padding:6px 7px; } .ff-card .ic { font-size:25px; } .ff-card .nm { font-size:13.5px; } #ffPhase { font-size:12px !important; padding:3px 8px !important; } #ffTop { padding-left:6px; padding-right:6px; } .ff-r2 { gap:5px !important; flex-wrap:wrap; } .ff-res { min-width:0 !important; } .ff-res .cap { font-size:10px; letter-spacing:-.4px; } #ffFood { font-size:10px; padding:0 3px; } #ffPop, #ffRuhm { font-size:13px; } }   /* a 320 px wide phone */
  @media (orientation:portrait) {
    #ffBody { flex-direction:column; }
    #ffMapWrap { flex:none; height:68vw; max-height:48%; min-height:230px; order:1; }
    @media (max-height:700px) { #ffMapWrap { height:58vw; min-height:200px; } }   /* a small phone: the panel (info, buttons) needs the room more than the map */
    @media (min-height:780px) { .ff-il { font-size:14px; } #ffPHint { font-size:12px; } }   /* a tall phone has the room: read more easily */
    @media (max-height:700px) { .ff-tg { padding:3px 2px; } .ff-send { min-height:34px; font-size:13.5px; } .ff-unit { min-height:66px; } .ff-gnote { min-height:32px; padding:3px 8px; font-size:11.5px; } }   /* a small phone: keep the recruit buttons in reach */
    @media (max-height:600px) { #v-furtfehde[data-mode="truppen"] #ffMapWrap { height:36vw; min-height:128px; } #ffModes { padding:4px 8px 5px; } .ff-mode { height:46px; } .ff-mode .ic { font-size:21px; } #ffPBtns button { height:42px; } #ffReason { min-height:32px; padding:3px 9px; font-size:13.5px; }
                                #ffPHead > div { display:flex; align-items:center; gap:8px; flex-wrap:wrap; } #ffPIc { font-size:26px; } #ffPCover, #ffPSum { padding:3px 8px; font-size:12px; } }   /* 320 × 568: the placing panel needs every pixel (the Brunnen's summary line comes on top) */
    #ffPanel { order:2; flex:1; width:auto; border-left:none; border-top:2px solid #5a4126; padding:7px 8px; }
    #ffModes { order:3; width:auto; flex-direction:row; padding:6px 8px 8px; gap:7px; }
    .ff-mode { flex-direction:column; gap:0; font-size:12px; height:56px; flex:1; min-width:0; }
    .ff-mode .ic { font-size:25px; }
    #ffTop { flex-direction:column; align-items:stretch; flex-wrap:nowrap; gap:3px; font-size:14px; padding:4px 9px 5px; }
    .ff-r1 { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .ff-r2 { display:flex; align-items:flex-start; flex-wrap:wrap; gap:2px 8px; }   /* the resource chips can be two lines high: the first lines line up; a crowded row (no phase chip yet: the water level takes room) wraps instead of overlapping */
    .ff-res { width:min-content; } .ff-bar { order:2; } #ffFood { order:3; margin:2px 0 0; font-size:10.5px; }   /* portrait: the chip is as wide as „🌾 30/90“; the food balance goes under its bar */
    #ffPop, #ffRuhm { line-height:1.05; padding-top:0; }
    #v-furtfehde.host #ffTop { padding-right:9px; } #v-furtfehde.host .ff-r1 { padding-right:134px; min-height:36px; }   /* the shell's ✕ Abbrechen (≈ 42 px tall) must not cover the second row */
    #ffPhase, #ffLvl, #ffHelp { order:0; margin-left:0; } #ffLvl { margin-left:auto; } #ffHelp { margin-left:auto; width:34px; height:32px; border-radius:16px; align-self:center; }
    #ffPhase { font-size:13px; padding:3px 10px; } #v-furtfehde.host #ffPhase .lg { display:none; } #v-furtfehde.host #ffPhase .sh { display:inline; }
    #ffLord { font-size:15px; } #ffLord .pre { display:none; }
    .ff-res { min-width:38px; }
    #ffCards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-content:start; }
    .ff-card { min-height:60px; }
    .ff-gunits { grid-template-columns:repeat(auto-fit,minmax(66px,1fr)); }   /* the Kaserne's four units in a row, the Söldnerlager's two share the width */
    #ffZoom button { font-size:12px; padding:5px 8px; }
    #ffLvl .w, #ffRuhm .w { display:none; }
    #ffPNote { display:block; }
    #v-furtfehde.offer #ffToasts { bottom:114px; }
    #v-furtfehde.spec #ffMapWrap { height:64vw; max-height:44%; }
    #ffEnd .col2 { width:100%; }
  }
</style>
<div id="v-furtfehde" class="view">
  <div id="ffTop">
    <div class="ff-r1">
      <span id="ffLord"><i></i><span class="nm"><span id="ffLordNm"></span><span id="ffMit"></span></span></span>
      <span id="ffPhase" style="display:none"><span class="lg"></span><span class="sh"></span></span>
      <button id="ffHelp" aria-label="Anleitung">❓</button>
    </div>
    <div class="ff-r2">
      <span class="ff-res" id="ffKorn"><span>🌾<b>0</b><small class="cap"></small></span><i id="ffFood"></i><span class="ff-bar"><u></u></span></span>
      <span class="ff-res" id="ffHolz"><span>🪵<b>0</b><small class="cap"></small></span><span class="ff-bar"><u></u></span></span>
      <span class="ff-res" id="ffStein"><span>🪨<b>0</b><small class="cap"></small></span><span class="ff-bar"><u></u></span></span>
      <span class="ff-res" id="ffGold" title="Gold – tippe zum Handeln"><span>💰<b>0</b></span></span>
      <span id="ffPop">👥 0/0</span>
      <span id="ffRuhm">⭐ 0</span><span id="ffCrown">👑</span>
      <span id="ffLvl">🌊 100 %</span>
    </div>
  </div>
  <div id="ffTip" role="button"><span class="tx" id="ffTipTx"></span><span class="go" id="ffTipGo">›</span><button class="x" id="ffTipX" aria-label="Tipp ausblenden">✕</button></div>
  <div id="ffBody">
    <div id="ffModes">
      <button class="ff-mode on" id="ffMode-bauen"><span class="ic">🏗️</span>Bauen</button>
      <button class="ff-mode" id="ffMode-truppen"><span class="ic">⚔️</span>Truppen</button>
      <button class="ff-mode" id="ffMode-banner"><span class="ic">⚑</span>Fahnen</button>
      <button class="ff-mode" id="ffMode-pakte" style="display:none"><span class="ic">🤝</span>Pakte<span class="bd" id="ffBd-pakte"></span></button>
    </div>
    <div id="ffMapWrap">
      <canvas id="ffCanvas"></canvas>
      <div id="ffZoom"><button id="ffZ-mine">🏰 Mein Land</button><button id="ffZ-all">🗺️ Ganze Karte</button></div>
      <div id="ffOffer">
        <div class="of-h"><i class="dot" id="ffOfDot"></i><span class="tx" id="ffOfTx"></span><b class="t" id="ffOfT"></b></div>
        <div class="of-b"><button id="ffOfYes">✅ Annehmen</button><button id="ffOfNo">✖ Ablehnen</button><button id="ffOfLater" title="später">▾</button></div>
        <div class="of-bar"><u id="ffOfBar"></u></div>
      </div>
      <div id="ffToasts"></div>
    </div>
    <div id="ffPanel">
      <div class="ff-sec on" id="ffPBau">
        <div class="ff-h">🏗️ Was soll gebaut werden?</div>
        <div id="ffCards"></div>
        <div id="ffPlace">
          <div id="ffPHead"><span id="ffPIc"></span><div><div id="ffPNm"></div><div class="ff-ucost" id="ffPCost"></div></div></div>
          <div id="ffPInfo">
            <div id="ffPRule"></div>
            <div class="ff-il"><b>Wozu</b><span id="ffPWozu"></span></div>
            <div class="ff-il"><b>Wohin</b><span id="ffPWohin"></span></div>
            <div class="ff-il"><b>Wie viele</b><span id="ffPViele"></span></div>
            <div id="ffPHint">☝️ Plan ziehen · ↻ dreht ihn · ✌️ zwei Finger = Karte</div>
          </div>
          <div id="ffPCover"></div>
          <div id="ffPSum"></div>
          <div id="ffReason"></div>
          <div id="ffPBtns"><button id="ffRot">↻</button><button id="ffNo">✕</button><button id="ffOk">✓</button></div>
        </div>
      </div>
      <div class="ff-sec" id="ffPTru">
        <div class="ff-h">⚔️ Wohin sollen sie? <span id="ffIdle"></span></div>
        <div id="ffTargets"></div>
        <button class="ff-send" id="ffSend" hidden>📍 Schicken</button>
        <div id="ffUnits"></div>
        <div id="ffQueue"></div>
      </div>
      <div class="ff-sec" id="ffPBan">
        <div class="ff-h">⚑ Fahnen losschicken</div>
        <div id="ffBanHint"></div>
        <div id="ffBans"></div>
        <button class="ff-home" id="ffHome">🏰 Alle heim</button>
      </div>
      <div class="ff-sec" id="ffPPak">
        <div class="ff-h">🤝 Pakte <small>· 3 Min, dann ist Schluss</small></div>
        <div id="ffPacts"></div>
        <div id="ffPNote">Verbündete greifen sich nicht an und betreten ihr Land nicht. Wer einen Pakt bricht, verliert 5 Ruhm und der Verratene wird zornig.</div>
      </div>
      <div class="ff-sec" id="ffPSpec">
        <div id="ffSpecT">👀 Alle Burgen sind besetzt</div>
        <div id="ffSpecS">Schau auf den Fernseher.</div>
        <div id="ffSpecL"></div>
      </div>
      <div class="ff-sec" id="ffPCard">
        <div id="ffCHead"><span id="ffCIc"></span><div><div id="ffCNm"></div><div id="ffCSz"></div></div><button id="ffCClose" aria-label="Schließen">✕</button></div>
        <div class="ff-hp" id="ffCHp"><span>❤️</span><span class="ff-hpbar"><u id="ffCHpU"></u></span><b id="ffCHpT"></b></div>
        <div id="ffCState"></div>
        <div id="ffCGar" hidden></div>
        <button id="ffCPause" hidden>💤 Ruhen lassen</button>
        <div id="ffCInfo">
          <div class="ff-il"><b>Wozu</b><span id="ffCWozu"></span></div>
          <div class="ff-il" id="ffCRowWohin"><b>Wohin</b><span id="ffCWohin"></span></div>
          <div class="ff-il" id="ffCRowViele"><b>Wie viele</b><span id="ffCViele"></span></div>
          <div class="ff-il" id="ffCRowCover" hidden><b>Schutz</b><span id="ffCCover"></span></div>
        </div>
        <div id="ffCCost"></div>
        <div id="ffCBtns">
          <div id="ffCAsk" hidden></div>
          <button id="ffCardMarkt" class="go" hidden>⚖️ Zum Markt</button>
          <button id="ffCardLager" hidden>📦 Lager ansehen</button>
          <button id="ffCardRebuild" class="go" hidden>♻️ Wiederaufbau ½</button>
          <button id="ffCardClear" hidden>🧹 Räumen</button>
          <button id="ffCardDemolish" class="bad" hidden>🔨 Abreißen</button>
          <div class="row" id="ffCConfirm" hidden><button id="ffCardKeep">Zurück</button><button id="ffCardConfirm" class="bad">✔ Ja</button></div>
        </div>
      </div>
    </div>
  </div>
  <div id="ffGuide" class="ff-guide" role="dialog" aria-modal="true" aria-label="Anleitung">
    <div class="gd-head"><button id="ffGuideX" aria-label="Anleitung schließen">✕</button><span class="gd-t">📖 Anleitung</span></div>
    <div class="gd-nav" id="ffGuideNav"></div>
    <div class="gd-body" id="ffGuideBody"></div>
  </div>
  <div id="ffLager" class="ff-lager" role="dialog" aria-modal="true" aria-label="Lager">
    <div class="lg-sheet">
      <div class="lg-head"><span class="lg-t" id="ffLagerT">📦 Lager</span><button id="ffLagerX" aria-label="Lager schließen">✕</button></div>
      <div class="lg-body" id="ffLagerBody"></div>
      <div class="lg-body" id="ffMarktBody" hidden></div>
    </div>
  </div>
  <div id="ffAlert"><span class="ic"></span><span class="tx"></span><span class="x">✕</span></div>
  <div id="ffFlash"></div>
  <div id="ffWait" class="ff-over show">🏰 Warte auf die Karte…<div class="sub">Der Fernseher zeichnet gerade das Tal.</div></div>
  <div id="ffEnd" class="ff-over">
    <div class="col">
      <div id="ffEndHead"><div id="ffEndT"></div><div id="ffEndS"></div></div>
      <div id="ffRank"></div>
    </div>
    <div class="col col2">
      <div id="ffEndH">Deine Runde</div>
      <div id="ffStats"></div>
      <button id="ffAgain">🔁 Nochmal</button>
      <div id="ffWaitHost">Warte auf den Host …</div>
    </div>
  </div>
</div>`);
  VIEWS.push('furtfehde');

  const root = $('v-furtfehde'), cv = $('ffCanvas'), wrap = $('ffMapWrap');
  const send = (m) => ac.message(AirConsole.SCREEN, m);
  const vib = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* no vibration here */ } };
  const STILL = /[?&]still=1\b/.test(location.search);
  const T0 = performance.now();
  const nowMs = () => STILL ? T0 : performance.now();   // still=1 (screenshots) freezes every countdown
  const RES_ICON = { korn: '🌾', holz: '🪵', stein: '🪨', gold: '💰' };
  // the houses that train units (the sim's UNIT[unit].at) and what each trains; `need` completes „Bau zuerst …“ while the house is missing (Phase 2: the Söldnerlager trains the torch-bearer and the horse archer)
  const TRAINERS = [
    { at: 'kaserne', ic: '⚔️', nm: 'Kaserne', units: ['speer', 'bogen', 'ritter', 'ramme'], need: 'eine ⚔️ Kaserne' },
    { at: 'soeldnerlager', ic: '⛺', nm: 'Söldnerlager', units: ['fackel', 'reiterschuetze'], need: 'ein ⛺ Söldnerlager' }
  ];
  const TRAINER_OF = {}; TRAINERS.forEach((g) => g.units.forEach((u) => { TRAINER_OF[u] = g.at; }));
  const GAR_WHAT = { mauer: 'die Mauer', torhaus: 'das Tor', wachturm: 'den Turm' };   // „🏹 Bogenschützen besetzen die Mauer“
  const CARD_GROUPS = [   // the Bauen list, grouped (a kind missing from the catalog is skipped; one missing here comes last)
    { t: '🏠 Dorf', kinds: ['huette', 'hof', 'kornspeicher', 'lager', 'holzfaeller', 'steinbruch', 'brunnen'] },
    { t: '⚔️ Heer & Handel', kinds: ['kaserne', 'soeldnerlager', 'markt'] },
    { t: '🧱 Verteidigung', kinds: ['wachturm', 'palisade', 'mauer', 'torhaus'] }
  ];
  const TARGETS = [{ n: 0, ic: '🏰', lb: 'Burgwache' }, { n: 1, ic: '⚑', lb: 'I' }, { n: 2, ic: '⚑', lb: 'II' }, { n: 3, ic: '⚑', lb: 'III' }];
  const ROMAN = ['', 'I', 'II', 'III'];
  const MODES = ['bauen', 'truppen', 'banner', 'pakte'];
  const PANELS = { bauen: 'ffPBau', truppen: 'ffPTru', banner: 'ffPBan', pakte: 'ffPPak' };
  const ALERTS = {   // a colour, an icon and a vibration pattern per kind
    attack:   { ic: '⚔️', buzz: [320, 110, 320, 110, 560], ms: 7000, dflt: 'Angriff auf dein Land!' },
    fire:     { ic: '🔥', buzz: [180, 90, 180, 90, 180], ms: 6000, dflt: 'Feuer in deiner Burg!' },
    hunger:   { ic: '🍞', buzz: [140, 80, 140], ms: 6000, dflt: 'Hunger! Das Korn ist aus.' },
    plunder:  { ic: '💰', buzz: [450, 140, 200, 140, 450], ms: 7000, dflt: 'Deine Burg wurde geplündert!' },
    crossing: { ic: '🌊', buzz: [90, 60, 90], ms: 4500, dflt: 'Eine Furt ist frei!' },
    pact:     { ic: '🤝', buzz: [70, 50, 70, 50, 150], ms: 5500, dflt: 'Pakt-Angebot' },
    crown:    { ic: '👑', buzz: [60, 40, 60, 40, 220], ms: 5000, dflt: 'Die Krone wechselt den Besitzer' }
  };
  // What every building is for (docs "Phase 1b", the building texts). `kurz` is the one line on the build card; wozu / wohin / viele fill the placing panel, the building card and the guide.
  const FARM_FEEDS = 5;   // people one Hof feeds: C1 measures it (R4); until then „etwa 5“. The only place the number lives.
  const INFO = {
    huette: { kurz: '+4 Wohnplätze', wozu: '🏠 +4 Wohnplätze; neue Bauern kommen nur, wenn Platz frei ist', wohin: 'irgendwo im eigenen Land', viele: 'eine, bevor 👥 voll ist' },
    hof: { kurz: 'Bauer erntet 🌾 Korn', wozu: '🌾 1 Bauer sät und erntet Korn', wohin: 'auf die grüne Aue (+50 % Ertrag), nah an Bergfried oder Kornspeicher', viele: '1 Hof ernährt etwa ' + FARM_FEEDS + ' Leute' },
    kornspeicher: { kurz: '+60 🌾 Lagerplatz', wozu: '🏚️ +60 🌾 Platz; die Bauern liefern zum nächsten Speicher', wohin: 'neben weit entfernte Höfe', viele: 'erst wenn 🌾 voll ist (30) oder die Höfe weit weg liegen' },
    lager: { kurz: '+60 🪵 +60 🪨 Lager', wozu: '📦 +60 🪵 und +60 🪨 Platz', wohin: 'egal', viele: 'erst wenn 🪵 oder 🪨 voll ist (30)' },
    holzfaeller: { kurz: 'fällt Bäume für 🪵', wozu: '🪓 1 Bauer fällt Bäume im Umkreis von 10; sie wachsen nach', wohin: 'direkt an den Wald', viele: '1–2' },
    steinbruch: { kurz: 'bricht 🪨 aus dem Fels', wozu: '⛏️ 2 Bauern brechen 🪨 für Mauern, Turm, Kaserne, Brunnen und Ritter', wohin: 'am grauen Fels', viele: '1; ist 🪨 voll, ruht er von selbst' },
    kaserne: { kurz: 'bildet Soldaten aus', wozu: '⚔️ bildet Bauern zu Soldaten aus – jede Kaserne 3 zugleich', wohin: 'nah am Bergfried', viele: '1; eine zweite bildet doppelt so schnell aus' },
    wachturm: { kurz: 'schießt von selbst', wozu: '🗼 schießt von selbst (Reichweite 12, Fackelträger zuerst). 3 Bogenschützen können einziehen: sie schießen weiter und sind geschützt', wohin: 'an Furten und Brücken, vor die Höfe', viele: '2–3' },
    brunnen: { kurz: 'löscht Brände', wozu: '🪣 Bauern löschen Brände im Umkreis von 12; der Bergfried schützt nur seine Nähe', wohin: 'mitten zwischen die Holzgebäude', viele: '1 pro Dorfteil' },
    // Phase 2 (docs "Phase 2 — Mauern & Söldner")
    palisade: { kurz: 'billiger Pfahlzaun', wozu: '🪵 Eine Wand aus Holzpfählen: Fußvolk und Ritter müssen sie erst einreißen. Sie brennt, fast ohne Pfeilschutz – Fackelträger zünden sie an', wohin: 'als Linie quer vor die Wege zum Dorf, mit einer Lücke oder einem Torhaus für dein Volk', viele: 'so lang wie die Linie (1 🪵 pro Feld)' },
    mauer: { kurz: 'Steinwand mit Wehrgang', wozu: '🧱 Eine Steinwand, die nicht brennt. Pfeile prallen ab, nur ein Rammbock bricht sie schnell. 1 Bogenschütze pro Feld kann oben einziehen', wohin: 'als Linie quer vor die Wege zum Dorf, mit einem 🏯 Torhaus als Durchgang', viele: 'so lang wie die Linie (2 🪨 pro Feld)' },
    torhaus: { kurz: 'Tor mit offener Gasse', wozu: '🏯 Ein Tor mit offener Gasse: dein Volk und deine Paktpartner gehen durch, Feinde müssen es einreißen. 4 Bogenschützen können in den Türmen einziehen', wohin: 'mitten in die Mauerlinie, wo dein Volk hindurch soll; ↻ dreht die Gasse. Vor und hinter der Gasse bleibt Platz frei', viele: '1 pro Durchgang' },
    markt: { kurz: 'Waren gegen 💰 tauschen', wozu: '⚖️ Hier verkaufst du Überschuss (🌾 🪵 🪨) für 💰 Gold und kaufst, was fehlt – teurer. Söldner und Rammböcke kosten Gold', wohin: 'egal, nahe der Burg ist sicher', viele: '1 reicht' },
    soeldnerlager: { kurz: 'wirbt Söldner an', wozu: '⛺ wirbt 🏇 Reiterschützen und 🔥 Fackelträger an. Beide kosten 💰 Gold', wohin: 'nah am Bergfried', viele: '1; jedes Lager bildet 3 zugleich aus' }
  };
  // The guide (❓): short sections; **bold** marks key words. `gebaeude` is built from INFO.
  const GUIDE = [
    { id: 'ziel', nav: '🏆 Ziel', t: '🏆 Ziel & Ruhm', lines: [
      'Wer am Ende die meisten **⭐ Ruhm** hat, gewinnt. Die Zeit läuft, keiner scheidet aus.',
      'Ruhm gibt es für besiegte Gegner (+1, Ritter +2), zerstörte Gebäude (+3, Kaserne und Turm +5), verbrannte Felder (+1), eine geplünderte Burg (+20) und für Wohlstand: +1 je 8 Leute alle 30 Sekunden.',
      '**👑 Die Krone** trägt, wer mindestens 10 Ruhm vorn liegt. Ruhm, den man gegen den Kronenträger holt, zählt ×1,5.',
      'Ein gebrochener Pakt kostet 5 Ruhm.'] },
    { id: 'ablauf', nav: '🌊 Ablauf', t: '🌊 Ablauf: Hochwasser → Ebbe → Fehde', lines: [
      '**🌊 Burgfrieden:** Das Tal steht unter Wasser, niemand kommt zu dir. Nutze die Zeit zum Aufbauen.',
      '**🌊 Ebbe:** Das Wasser fällt. Furten, Stege und Brücken öffnen sich nacheinander, die Furten zuletzt.',
      '**⚔️ Fehde:** Alle Wege sind frei, jetzt wird gekämpft, bis die Zeit um ist. Die **⏳ letzte Minute** wird angesagt.',
      'Oben siehst du Wasserstand und Uhr. Flaches Wasser ist watbar, aber langsam und im Kampf schwächer.'] },
    { id: 'korn', nav: '👥 Leute & Korn', t: '👥 Leute & Korn', lines: [
      'Alle Leute, Bauern wie Soldaten, brauchen **Wohnplätze** (👥 6/12). Die Burg bietet 8, jede 🏠 Hütte 4 mehr.',
      'Etwa alle 6 Sekunden kommt ein neuer Bauer an, wenn Platz ist und Korn da ist.',
      'Jeder isst etwa **1 🌾 pro Minute**. Neben 🌾 oben steht **+Ernte −Verbrauch** pro Minute: grün heißt genug, rot heißt zu wenig. Dann bau noch einen Hof.',
      '**🍞 Hunger** (kein 🌾 mehr): keine neuen Bauern, alle arbeiten langsamer, nach und nach laufen Bauern weg, aber **nie unter 4**.',
      'Für Baustellen und Rekruten holt das Dorf zuerst Steinmetze und Holzfäller. **Hofbauern bleiben auf dem Feld.**',
      '**📦 Volles Lager:** Ist ein Lager voll (🌾, 🪵 oder 🪨), hört der Betrieb dafür von selbst auf. Seine Arbeiter sind dann frei, zum Beispiel zum Ausbilden. Gibt es wieder Platz, arbeiten sie weiter. Den Überschuss kannst du auf dem ⚖️ Markt verkaufen.',
      '**💤 Ruhen lassen:** Tippe einen Betrieb (Hof, Holzfäller, Steinbruch) auf der Karte an und wähle 💤. Seine Arbeiter sind dann frei, zum Beispiel für Baustellen. Mit ▶ arbeitet er weiter.',
      '**📦 Lager:** Tippe oben auf 🌾 🪵 🪨 oder 👥. Du siehst, wie viel Platz du hast, woher er kommt und was hilft, wenn ein Lager voll ist.'] },
    { id: 'gebaeude', nav: '🏗️ Gebäude', t: '🏗️ Gebäude', intro: 'Gebaut wird nur auf deinem Land, auf trockenem Boden und mit einem Feld Abstand zu anderen Gebäuden (Wände dürfen sich, Tor und Turm berühren). Tippe unter 🏗️ Bauen ein Gebäude an und zieh den Plan an die richtige Stelle.', kinds: true },
    { id: 'truppen', nav: '⚔️ Truppen', t: '⚔️ Truppen', lines: [
      '**1.** Baue eine ⚔️ Kaserne. Jede bildet 3 Bauern zugleich aus, mit einer zweiten geht es doppelt so schnell. Dort kommen 🗡️ Speerträger, 🏹 Bogenschützen, 🐎 Ritter und 🪵 Rammböcke her; 🔥 Fackelträger und 🏇 Reiterschützen wirbt das ⛺ Söldnerlager an.',
      '**2.** Wähle unter ⚔️ Truppen, wohin die Neuen sollen: 🏰 Burgwache (verteidigt die Burg) oder Fahne I, II, III. Tippe dann auf eine Einheit: ein freier Bauer wird ausgebildet. Ist keiner frei, steht in der Schlange **⏳ wartet auf einen freien Bauern**: bau Hütten oder lass einen Betrieb 💤 ruhen.',
      '**3. Fahne losschicken:** Tippe unter ⚑ Fahnen eine Fahne an, dann aufs Ziel auf der Karte. Du kannst die Fahne auch mit dem Finger hinziehen. Furten, Brücken und Feindburgen rasten ein. Im Reiter ⚔️ führt dich der Knopf **📍 Fahne … schicken** direkt dorthin.',
      '**4.** 🏰 **Alle heim** ruft alle Fahnen zurück.',
      'Soldaten kämpfen von selbst, sobald Feinde nahe sind. Ohne Befehl bleiben sie an der Burg.',
      '🗡️ **Speerträger:** stark gegen 🐎 Ritter.',
      '🏹 **Bogenschütze:** schießt aus der Ferne, stark gegen 🔥 Fackelträger.',
      '🐎 **Ritter:** schnell, stark gegen 🏹 Bogenschützen und 🏇 Reiterschützen.',
      '🏇 **Reiterschütze:** schießt im Reiten und weicht Nahkämpfern aus. Stark gegen 🗡️ Speerträger und 🔥 Fackelträger, aber 🐎 Ritter holen ihn ein.',
      '🔥 **Fackelträger:** zündet Holzgebäude und Palisaden an und kämpft nie. Er kommt jetzt aus dem ⛺ Söldnerlager.',
      '🪵 **Rammbock:** bricht Mauern und Tore, verletzt aber keine Leute.',
      'Merke: 🗡️ schlägt 🐎, 🐎 schlägt 🏹 und 🏇, 🏇 schlägt 🗡️ und 🔥, 🏹 schlägt 🔥.'] },
    { id: 'mauern', nav: '🧱 Mauern', t: '🧱 Mauern & Tore', lines: [
      '**Linie ziehen:** Tippe unter 🏗️ Bauen eine 🪵 Palisade oder 🧱 Mauer an und zieh mit dem Finger eine Linie über dein Land. Mit einer Ecke wird daraus ein L, ↻ dreht die Ecke. Rote Stücke gehen nicht (zu nass, zu eng, belegt), ✓ baut den Rest.',
      () => 'Eine Palisade kostet ' + costText(costOf('palisade')) + ', eine Mauer ' + costText(costOf('mauer')) + ' pro Feld. Die Stücke (bis 4 Felder) werden der Reihe nach gebaut. Reicht das Material nicht, bleibt der Rest der Linie leer.',
      '**Was sie tun:** Wände halten Fußvolk und Ritter auf. Feinde müssen sie erst einreißen: Speerträger und Ritter nur langsam, ein 🪵 Rammbock schnell. Pfeile helfen kaum: gegen Stein gar nicht, gegen Holz wenig.',
      '**🔥 Palisaden brennen.** Fackelträger zünden sie an, Steinmauern nicht.',
      '**🏯 Torhaus:** Die Gasse in der Mitte steht dir und deinen Paktpartnern offen, Feinde müssen das Tor einreißen. Setz es in die Linie, wo dein Volk durch soll, ↻ dreht es. Ohne Tor oder Lücke sperrst du dein eigenes Volk ein!',
      '**🏹 Wehrgang:** Schick eine Fahne auf eine Mauer, ein Torhaus oder einen 🗼 Wachturm (tippen oder hinziehen). Ihre Bogenschützen ziehen ein: 1 pro Mauerfeld, 4 ins Torhaus, 3 in den Turm. Oben schießen sie 3 Felder weiter, Pfeile treffen sie nur halb so hart und Nahkämpfer erreichen sie nicht. Zieht die Fahne woandershin, steigen sie herab. Die 🏰 Burgwache besetzt freie Plätze nahe der Burg von selbst.',
      '**🧱 Ruinen:** Fällt ein Stück, bleibt Geröll liegen. Man kann es langsam überqueren und für ½ wieder aufbauen.'] },
    { id: 'markt', nav: '⚖️ Markt', t: '⚖️ Markt & Gold', lines: [
      '**💰 Gold** gibt es nur auf dem ⚖️ Markt (4×3 Felder): Dort verkaufst du Überschuss und kaufst, was fehlt. Gold hat keine Obergrenze.',
      () => 'Gehandelt wird in **Paketen zu ' + packN() + '**, sofort und ohne Träger. Verkaufen bringt pro Paket ' + LG_GOODS.map((g) => g.ic + ' ' + priceOf('sell', g.k)).join(', ') + ' 💰. Kaufen kostet pro Paket ' + LG_GOODS.map((g) => g.ic + ' ' + priceOf('buy', g.k)).join(', ') + ' 💰, ist also teurer.',
      '**So geht es:** Tippe oben auf 💰 oder auf deinen Markt. Pro Ware gibt es **Verkaufen** und **Kaufen**; ×5 oder langes Drücken handelt gleich 5 Pakete. Kaufen geht nur, solange im Lager Platz ist.',
      '**Wozu Gold?** 🏇 Reiterschützen und 🔥 Fackelträger aus dem ⛺ Söldnerlager und 🪵 Rammböcke kosten 💰.',
      'Ist ein Lager voll, hilft der Markt: verkaufen statt Arbeit verschenken. Eine geplünderte Burg verliert die Hälfte ihres Goldes.'] },
    { id: 'soeldner', nav: '⛺ Söldner', t: '⛺ Söldner', lines: [
      () => 'Das **⛺ Söldnerlager** (5×4 Felder) wirbt an: 🔥 Fackelträger (' + costText(unitCost('fackel')) + ') und 🏇 Reiterschützen (' + costText(unitCost('reiterschuetze')) + '). Wie jeder Rekrut braucht jeder Söldner einen freien Bauern, und jedes Lager bildet 3 zugleich aus.',
      '**🏇 Reiterschütze:** schnell, schießt im Reiten und weicht Nahkämpfern aus, während er nachlädt. Stark gegen 🗡️ Speerträger und 🔥 Fackelträger, aber 🐎 Ritter schlagen ihn.',
      '**🔥 Fackelträger** kommen nicht mehr aus der Kaserne, sondern von hier. Sie zünden Holzgebäude und Palisaden an.'] },
    { id: 'ramme', nav: '🪵 Rammbock', t: '🪵 Rammbock', lines: [
      () => 'Der **🪵 Rammbock** (' + costText(unitCost('ramme')) + ') kommt aus der ⚔️ Kaserne. Er rollt vorn in der Fahne und schlägt die nächste feindliche Wand, das Tor oder ein Gebäude in 3 Feldern Reichweite.',
      'Er verletzt **keine Leute** und ist langsam. Pfeile treffen ihn nur zu einem Viertel, aber Nahkämpfer richten vollen Schaden an: Schick Speerträger und Ritter als Schutz mit.',
      'Eine Wand oder ein Tor bricht er viel schneller als Fußvolk. Schick die Fahne mit ihm vor die Wand: tippen, dann aufs Ziel.'] },
    { id: 'feuer', nav: '🔥 Feuer', t: '🔥 Feuer & Brunnen', lines: [
      'Holzgebäude und Felder brennen, Stein nicht. Feuer springt auf Nachbarn über. Ein abgebranntes Feld wird neu besät.',
      '**🔥 Fackelträger** zünden Gebäude an. Türme und die Burg schießen sie zuerst ab und treffen sie doppelt. Kleine Holzhäuser brennen meist allein ab, große Gebäude stecken ihre Nachbarn an.',
      '**🪣 Brunnen:** Bauern löschen mit einer Eimerkette alles im Umkreis von 12 Feldern. Stell ihn mitten zwischen die Holzgebäude, einen pro Dorfteil.',
      '**🏰 Burgbrunnen:** Auch der Bergfried löscht, aber nur Gebäude im Umkreis von 12 Feldern um die Burg. Höfe weiter draußen brauchen einen eigenen Brunnen.',
      '**💧 Schutz-Ansicht:** Wenn du einen Brunnen platzierst oder deinen Brunnen oder die Burg antippst, malt die Karte blaue Kreise dorthin, wo schon gelöscht wird. Ein **blauer 💧-Ring** an einem Holzgebäude heißt „geschützt“, ein **oranger Ring** heißt „ungeschützt“.'] },
    { id: 'pakte', nav: '🤝 Pakte', t: '🤝 Pakte', lines: [
      'Ab drei Häusern kannst du unter 🤝 Pakte einem Haus einen Pakt anbieten (3 Minuten). Nimmt es an, greifen sich beide nicht an und betreten das Land des anderen nicht.',
      '**🗡️ Wer einen Pakt bricht**, verliert 5 Ruhm. Der Verratene wird zornig: +25 % Schaden für 1 Minute.'] },
    { id: 'bots', nav: '🤖 Bots', t: '🤖 Bot-Stärken', lines: [
      'Leere Häuser spielt ein Bot. Der Gastgeber stellt vor dem Start die **Bot-Stärke** ein:',
      '🛡️ **Knappe:** leicht.',
      '⚔️ **Ritter:** mittel.',
      '👑 **Kriegsherr:** schwer.',
      'Geht ein Mitspieler, übernimmt ein Bot sein Haus, bis er zurückkommt.'] }
  ];
  const SLOTS = { hof: 1, holzfaeller: 1, steinbruch: 2 };   // worker slots (the screen sends `workers`)
  // The numbers of the rules (docs "Phase 1b addendum"): the screen sends them as ffInfo.rules (FurtSim.CONST); without them these, the sim's defaults
  const RULES0 = { bucketR: 12, keepWellR: 12, capKeep: 30, capKorn: 60, capLager: 60, keepHouses: 8, hutHouses: 4 };
  // Phase 2: the Markt's prices (💰 per pack of `tradePack` goods) are ffInfo.rules.prices { sell: { korn, holz, stein }, buy: { … } } and ffInfo.rules.tradePack; without them the contract's numbers
  const PRICES0 = { sell: { korn: 1, holz: 1, stein: 2 }, buy: { korn: 3, holz: 3, stein: 5 } }, PACK0 = 5;
  const rulesFrom = (r) => {
    const o = Object.assign({}, RULES0), ok = (v) => typeof v === 'number' && isFinite(v) && v >= 0;
    o.tradePack = PACK0; o.prices = { sell: Object.assign({}, PRICES0.sell), buy: Object.assign({}, PRICES0.buy) };
    if (r && typeof r === 'object') {
      for (const k in RULES0) if (ok(r[k])) o[k] = r[k];
      if (ok(r.tradePack) && r.tradePack >= 1) o.tradePack = Math.round(r.tradePack);
      if (r.prices && typeof r.prices === 'object') for (const side of ['sell', 'buy']) { const q = r.prices[side]; if (q && typeof q === 'object') for (const g in PRICES0[side]) if (ok(q[g]) && q[g] > 0) o.prices[side][g] = q[g]; }
    }
    return o;
  };
  const KEEP = 'keep';   // the card of the own castle has no building id

  let st, map = null, raf = 0, ro = null, toastN = 0, tickT = 0, alertT = 0;

  function reset() {
    cancelAnimationFrame(raf); raf = 0; clearInterval(tickT); tickT = 0; clearTimeout(alertT); alertT = 0;
    if (map) { map.dispose(); map = null; }
    st = { lord: null, site: null, color: '#d9a441', host: false, shared: '', lords: [], lordsKey: '', info: false, mapMsg: null, grid: null, L: 0, you: null, boardMsg: null,
           mode: 'bauen', sel: null, target: 1, ownBanners: {}, lastReason: '', bld: [], byId: {}, costs: null, youBanners: {}, haveYouBanners: false, hungerUntil: 0,
           phase: null, endsAt: 0, clock: null, lastFlag: false, warned: false, lastBuzz: false, pacts: [], busy: {}, breaking: null, snooze: {}, card: null, cardArm: 0, alert: null, result: null,
           arm: 0, ordered: false, recruited: false, pauseWant: {}, tipSnooze: {}, hofSince: null, forceTip: 0, tip: null, rules: rulesFrom(null), sheet: 'lager', marktMul: 1, rams: 0 };
    root.classList.remove('host', 'spec', 'offer', 'placing'); root.style.removeProperty('--c'); root.style.removeProperty('--ct');
    $('ffToasts').innerHTML = '';
    $('ffWait').classList.add('show'); $('ffEnd').classList.remove('show'); $('ffAlert').classList.remove('show'); $('ffOffer').classList.remove('show');
    $('ffPBau').classList.remove('placing'); $('ffPanel').classList.remove('card'); $('ffTip').classList.remove('show', 'hot');
    $('ffGuide').classList.remove('show'); guideHist = false; $('ffLager').classList.remove('show'); lagerHist = false;
    $('ffMode-pakte').style.display = 'none'; $('ffPacts').innerHTML = '';
    renderTop(); setMode('bauen', true);
  }

  // ---------- helpers ----------
  const isSpec = () => st.lord == null || st.lord < 0;
  const houseName = (l) => String((l && l.name) || '').split(' · ')[0];      // "Haus Falkenstein · Anna & Ben" → "Haus Falkenstein"; a bot's name stays whole
  const playerNames = (l) => String((l && l.bot) ? 'Bot' : String((l && l.name) || '').split(' · ').slice(1).join(' · '));
  const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return ((s / 60) | 0) + ':' + ('0' + (s % 60)).slice(-2); };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const sharedName = (v) => typeof v === 'string' ? v : Array.isArray(v) ? v.map((x) => (x && x.name) || x).filter(Boolean).join(' & ') : v && typeof v === 'object' ? String(v.name || '') : v ? 'Mitspieler' : '';
  // The sim's clock: ffPhase and ffYou carry `now` (sim seconds); between two messages it runs on this phone's own clock.
  function setClock(now) { if (typeof now === 'number' && isFinite(now)) st.clock = { sim: now, wall: nowMs() }; }
  const simNow = () => st.clock ? st.clock.sim + (nowMs() - st.clock.wall) / 1000 : null;
  const remaining = (until) => { const n = simNow(); return n == null || !(until > 0) ? null : until - n; };

  // the Markt's numbers (ffInfo.rules, or the contract's) and a cost as text: { holz: 10, gold: 4 } → „🪵 10 💰 4“
  const packN = () => st.rules.tradePack > 0 ? st.rules.tradePack : PACK0;
  const priceOf = (side, g) => { const q = st.rules.prices && st.rules.prices[side]; return q && q[g] > 0 ? q[g] : PRICES0[side][g]; };
  const costText = (cost) => Object.keys(cost || {}).filter((r) => cost[r]).map((r) => (RES_ICON[r] || r) + ' ' + cost[r]).join(' ');

  // ---------- top strip ----------
  function setRes(id, v, cap) {   // „🌾 30/90“: the cap small and dimmed; a full store is marked (orange)
    const el2 = $(id), b = el2.querySelector('b'), cp = el2.querySelector('.cap'), t = String(v | 0), c = cap > 0 ? '/' + (cap | 0) : '';
    if (b.textContent !== t) b.textContent = t;
    if (cp.textContent !== c) cp.textContent = c;
    const f = cap > 0 ? Math.min(1, v / cap) : 0;
    el2.querySelector('u').style.width = (f * 100) + '%'; el2.classList.toggle('full', cap > 0 && v >= cap);
  }
  function renderTop() {
    const y = st.you || { stock: {}, cap: {} }, stock = y.stock || {}, cap = y.cap || {};
    setRes('ffKorn', stock.korn || 0, cap.korn); setRes('ffHolz', stock.holz || 0, cap.holz); setRes('ffStein', stock.stein || 0, cap.stein);
    { const gb = $('ffGold').querySelector('b'), gt = String(stock.gold | 0); if (gb.textContent !== gt) gb.textContent = gt; }   // 💰: no cap, no bar
    $('ffKorn').classList.toggle('hungry', hungerNow());
    $('ffPop').textContent = '👥 ' + (y.pop | 0) + '/' + (y.popCap | 0);
    $('ffRuhm').innerHTML = '⭐ ' + (y.ruhm | 0) + '<small class="w"> Ruhm</small>';
    $('ffCrown').style.display = y.crown ? 'inline' : 'none';
    const pct = Math.round(st.L * 100), lv = $('ffLvl');
    lv.innerHTML = '🌊 <span class="w">' + (st.L > 0.7 ? 'Hochwasser ' : st.L > 0.04 ? 'Pegel ' : 'Normal ') + '</span>' + pct + ' %';
    lv.classList.toggle('high', st.L > 0.7); lv.classList.toggle('mid', st.L > 0.04 && st.L <= 0.7);
    renderFood();
    const l = st.lords && st.lords[st.lord], hn = houseName(l);
    if (isSpec()) $('ffLordNm').textContent = '👀 Zuschauer';
    else { const m = /^(Haus |Burg )(.*)$/.exec(hn); $('ffLordNm').innerHTML = m ? '<span class="pre">' + m[1] + '</span>' + m[2] : hn || 'Mein Haus'; }
    $('ffMit').textContent = st.shared && !isSpec() ? 'mit ' + st.shared : '';
    renderPhase(); renderHelp(); renderTip(); renderLager();
  }
  // „+p −e“ by 🌾: sacks harvested and eaten per minute (ffYou.food); nothing to show while the screen does not send it
  function renderFood() {
    const f = st.you && st.you.food, b = $('ffFood');
    if (!f || !isFinite(f.prod) || !isFinite(f.eat)) { b.className = ''; b.textContent = ''; return; }
    const t = '+' + Math.round(f.prod) + ' −' + Math.round(f.eat);
    if (b.textContent !== t) b.textContent = t;
    b.className = 'show ' + (f.prod >= f.eat ? 'pos' : 'neg'); b.title = 'Ernte und Verbrauch pro Minute';
  }
  // the ❓ pulses during the Burgfrieden until the guide was opened once on this device
  function renderHelp() { $('ffHelp').classList.toggle('pulse', st.phase === 'frieden' && !guideSeen && !isSpec()); }
  // the phase chip: „🌊 Burgfrieden 1:12“ counting down, „🌊 Ebbe 64 %“, „⚔️ Fehde 7:32“, „⏳ Letzte Minute 0:42“
  function phaseInfo() {
    const ph = st.phase; if (!ph) return null;
    const rem = st.endsAt > 0 ? remaining(st.endsAt) : null, left = rem == null ? null : Math.max(0, rem), t = left == null ? '' : ' ' + mmss(left);
    if (ph === 'over') return { cls: 'over', text: '🏁 Ende', short: '🏁 Ende' };
    if (ph === 'frieden') return { cls: left != null && left <= 15 ? 'warn' : 'frieden', text: '🌊 Burgfrieden' + t, short: '🌊 Frieden' + t };
    if (ph === 'ebbe') { const e = '🌊 Ebbe ' + Math.round(st.L * 100) + ' %'; return { cls: 'ebbe', text: e, short: e }; }
    return st.lastFlag || (left != null && left <= 60) ? { cls: 'letzte', text: '⏳ Letzte Minute' + t, short: '⏳' + t } : { cls: 'fehde', text: '⚔️ Fehde' + t, short: '⚔️ Fehde' + t };
  }
  const hungerNow = () => nowMs() < st.hungerUntil;   // the sim's hunger flag flaps every few seconds: hold it for 4 s
  function renderPhase() {
    $('ffKorn').classList.toggle('hungry', hungerNow());
    const chip = $('ffPhase'), p = phaseInfo();
    if (!p) { chip.style.display = 'none'; $('ffLvl').style.display = ''; return; }   // no ffPhase yet: the old water-level chip
    $('ffLvl').style.display = 'none'; chip.style.display = '';
    const lg = chip.firstChild, sh = chip.lastChild;
    if (lg.textContent !== p.text) lg.textContent = p.text;
    if (sh.textContent !== p.short) sh.textContent = p.short;
    const cls = p.cls; if (chip.dataset.cls !== cls) { chip.dataset.cls = cls; chip.className = cls; }
    if (cls === 'warn' && !st.warned) { st.warned = true; vib(90); }
    if (cls === 'letzte' && !st.lastBuzz) { st.lastBuzz = true; vib([120, 70, 120]); }
  }

  // ---------- toasts ----------
  function toast(text) {
    const box = $('ffToasts'), e = document.createElement('div');
    e.className = 'ff-toast'; e.textContent = String(text).slice(0, 80); e.id = 'ffToast' + (++toastN);
    box.appendChild(e);
    while (box.children.length > 2) box.removeChild(box.firstChild);
    setTimeout(() => { e.classList.add('out'); setTimeout(() => { if (e.parentNode) e.parentNode.removeChild(e); }, 450); }, 2400);
  }

  const sizeTxt = (kind) => { const B = FurtWorld.BUILDINGS[kind]; return B.wall ? '1×1–' + (B.maxLen || 4) : B.size[0] + '×' + B.size[1]; };   // a wall is a line of 1–4 cells
  // ---------- ❓ guide: full screen, scrollable, closes with ✕ and with the back gesture ----------
  let guideSeen = false, guideBuilt = false, guideHist = false, ignorePop = 0, guideMark = null;
  try { guideSeen = localStorage.getItem('ffGuideSeen') === '1'; } catch (e) { /* no storage: the ❓ pulses until it was opened in this page */ }
  function rich(parent, text) {   // **bold** → <b>
    String(text).split('**').forEach((part, i) => { if (part) parent.appendChild(i % 2 ? el('b', '', part) : document.createTextNode(part)); });
    return parent;
  }
  function buildGuide() {
    if (guideBuilt || !window.FurtWorld) return;
    guideBuilt = true;
    const nav = $('ffGuideNav'), body = $('ffGuideBody'); nav.innerHTML = ''; body.innerHTML = '';
    GUIDE.forEach((g) => {
      const chip = el('button', '', g.nav); chip.id = 'ffGuideNav-' + g.id; chip.addEventListener('click', () => scrollGuide(g.id)); nav.appendChild(chip);
      const sec = el('div', 'gd-sec'); sec.id = 'ffGuideSec-' + g.id; sec.appendChild(el('h3', '', g.t));
      if (g.intro) { const p = el('p'); p.style.cssText = 'margin:0 0 10px;font-size:14.5px;line-height:1.42'; sec.appendChild(rich(p, g.intro)); }
      if (g.kinds) Object.keys(FurtWorld.BUILDINGS).filter((k) => k !== 'bergfried' && INFO[k]).forEach((kind) => {
        const B = FurtWorld.BUILDINGS[kind], I = INFO[kind], card = el('div', 'gd-bld'), hd = el('div', 'hd'), nm = el('span', '', B.name);
        nm.appendChild(el('small', '', sizeTxt(kind) + (B.mat === 'holz' ? ' · Holz' : ' · Stein'))); hd.appendChild(el('span', 'ic', B.icon)); hd.appendChild(nm); card.appendChild(hd);
        [['Wozu', I.wozu], ['Wohin', I.wohin], ['Wie viele', I.viele]].forEach(([k, v]) => { const l = el('div', 'ff-il'); l.appendChild(el('b', '', k)); l.appendChild(document.createTextNode(v)); card.appendChild(l); });
        sec.appendChild(card);
      });
      if (g.lines) { const ul = el('ul'); g.lines.forEach((t) => ul.appendChild(rich(el('li'), typeof t === 'function' ? t() : t))); sec.appendChild(ul); }
      body.appendChild(sec);
    });
    const pad = el('div'); pad.style.height = '38vh'; body.appendChild(pad);   // so even the last section can scroll up to the top
    body.addEventListener('scroll', () => markGuide());
  }
  function markGuide(id) {   // the chip of the section in view (a tapped chip wins for a moment: the last sections cannot scroll all the way up)
    const body = $('ffGuideBody');
    if (id) guideMark = { id, until: nowMs() + 700 };
    let cur = guideMark && nowMs() < guideMark.until ? guideMark.id : null;
    if (!cur) { cur = GUIDE[0].id; GUIDE.forEach((g) => { const sec = $('ffGuideSec-' + g.id); if (sec && sec.offsetTop - 60 <= body.scrollTop) cur = g.id; }); }
    GUIDE.forEach((g) => { const c = $('ffGuideNav-' + g.id); if (c) { const on = g.id === cur; if (c.classList.contains('on') !== on) c.classList.toggle('on', on); if (on) { const nav = $('ffGuideNav'); if (c.offsetLeft < nav.scrollLeft + 10 || c.offsetLeft + c.offsetWidth > nav.scrollLeft + nav.clientWidth - 10) nav.scrollLeft = Math.max(0, c.offsetLeft - 16); } } });
  }
  function scrollGuide(id) {
    const sec = $('ffGuideSec-' + id); if (!sec) return;
    $('ffGuideBody').scrollTop = Math.max(0, sec.offsetTop - 8); markGuide(id);
  }
  function openGuide(id) {
    buildGuide();
    const g = $('ffGuide');
    if (lagerOpen()) { if (lagerHist) { lagerHist = false; guideHist = true; try { history.replaceState({ ffGuide: 1 }, ''); } catch (e) { /* ignore */ } } closeLager(true); }   // the 📦 sheet hands its history entry over to the guide
    if (!g.classList.contains('show')) {
      g.classList.add('show');
      if (!guideHist) { try { history.pushState({ ffGuide: 1 }, ''); guideHist = true; } catch (e) { guideHist = false; } }   // the back gesture closes the guide
    }
    if (!guideSeen) { guideSeen = true; try { localStorage.setItem('ffGuideSeen', '1'); } catch (e) { /* ignore */ } }
    renderHelp();
    $('ffGuideBody').scrollTop = 0; guideMark = null;
    if (id) scrollGuide(id); else markGuide();
  }
  function closeGuide(fromPop) {
    const g = $('ffGuide'); if (!g.classList.contains('show')) return;
    g.classList.remove('show');
    if (guideHist) { guideHist = false; if (!fromPop) { ignorePop++; try { history.back(); } catch (e) { ignorePop = 0; } } }   // our own history entry goes away
    if (map) map.dirty = true;
  }
  $('ffHelp').addEventListener('click', () => { vib(8); openGuide(); });
  $('ffGuideX').addEventListener('click', () => closeGuide(false));
  window.addEventListener('popstate', () => {
    if (ignorePop > 0) { ignorePop--; return; }
    if ($('ffGuide').classList.contains('show')) { guideHist = false; closeGuide(true); }
    if (lagerOpen()) { lagerHist = false; closeLager(true); }
  });

  // ---------- 📦 Lager and ⚖️ Markt: one sheet with two pages ----------
  // 📦 Lager (docs "W2"): a tap on a good (or on 👥) in the top bar drops this sheet down: per good the amount, the cap, a bar and where the room comes from; for 🌾 the food balance; a tip when a good is full;
  // and 👥 people, housing and the idle peasants. ⚖️ Markt (Phase 2): the same sheet's second page (💰 in the top bar, the Markt's card, „⚖️ Zum Markt“ below): sell and buy per good.
  // It closes with ✕, a tap outside or the back gesture, and it updates while it is open.
  const LG_GOODS = [{ k: 'korn', ic: '🌾', nm: 'Korn' }, { k: 'holz', ic: '🪵', nm: 'Holz' }, { k: 'stein', ic: '🪨', nm: 'Stein' }];
  const LG_NAMES = { kornspeicher: ['Kornspeicher', 'Kornspeicher'], lager: ['Lagerplatz', 'Lagerplätze'], huette: ['Hütte', 'Hütten'] };   // singular, plural
  let lagerBuilt = false, marktBuilt = false, lagerHist = false;
  const lagerOpen = () => $('ffLager').classList.contains('show');
  const marktOpen = () => lagerOpen() && st.sheet === 'markt';
  function setSheet(page) {   // which page of the sheet shows
    st.sheet = page === 'markt' ? 'markt' : 'lager';
    $('ffLagerBody').hidden = st.sheet !== 'lager'; $('ffMarktBody').hidden = st.sheet !== 'markt';
    const t = $('ffLagerT'), txt = st.sheet === 'markt' ? '⚖️ Markt' : '📦 Lager'; if (t.textContent !== txt) t.textContent = txt;
    $('ffLager').querySelector('.lg-sheet').scrollTop = 0;
  }
  function buildLager() {
    if (lagerBuilt) return;
    lagerBuilt = true;
    const body = $('ffLagerBody'); body.innerHTML = '';
    const row = (id, ic, nm) => {
      const r = el('div', 'lg-row'), h = el('div', 'lg-h'), bar = el('div', 'lg-bar'); r.id = 'ffLg-' + id;
      h.appendChild(el('span', 'ic', ic)); h.appendChild(el('span', 'nm', nm)); h.appendChild(el('b', 'amt')); h.appendChild(el('span', 'cp')); bar.appendChild(el('u'));
      r.appendChild(h); r.appendChild(bar); r.appendChild(el('div', 'lg-src')); r.appendChild(el('div', 'lg-note')); r.appendChild(el('div', 'lg-tips')); body.appendChild(r);
    };
    LG_GOODS.forEach((g) => row(g.k, g.ic, g.nm)); row('pop', '👥', 'Leute');
    const mk = el('button', 'lg-more', '⚖️ Zum Markt'); mk.id = 'ffLagerMarkt'; mk.addEventListener('click', () => openLager('markt')); body.appendChild(mk);
    const more = el('button', 'lg-more', '📖 Mehr dazu in der Anleitung'); more.id = 'ffLagerGuide'; more.addEventListener('click', () => openGuide('korn')); body.appendChild(more);
  }
  function lagerBuild(kind) { closeLager(false); setMode('bauen'); selectKind(kind); }   // a tip: straight to the placing of that building
  function lagerTips(k) {   // what to do about a full good: [{ id, text, go }] — a store for it, and the Markt (Phase 2: a full workplace rests by itself, so no „ruhen lassen“ any more)
    const store = k === 'korn' ? { id: 'kornspeicher', text: '🏚️ Kornspeicher bauen', go: () => lagerBuild('kornspeicher') } : { id: 'lager', text: '📦 Lagerplatz bauen', go: () => lagerBuild('lager') };
    return [store, marktReady() ? { id: 'verkaufen', text: '⚖️ Überschuss verkaufen', go: () => openLager('markt') } : { id: 'markt', text: '⚖️ Markt bauen', go: () => lagerBuild('markt') }];
  }
  function renderLager() {
    if (!lagerOpen()) return;
    if (st.sheet === 'markt') { renderMarkt(); return; }
    buildLager();
    const y = st.you || {}, stock = y.stock || {}, cap = y.cap || {}, R = st.rules, own = st.bld.filter((b) => b.lord === st.lord && !b.ruined);
    const put = (node, t) => { if (node.textContent !== t) node.textContent = t; };
    const source = (base, kind, per) => {   // „Bergfried 30 · 2 Kornspeicher +120 · 1 im Bau“
      let done = 0, site = 0; for (const b of own) if (b.kind === kind) { if (b.build >= 1) done++; else site++; }
      const nm = LG_NAMES[kind];
      return 'Bergfried ' + base + (done ? ' · ' + done + ' ' + nm[done === 1 ? 0 : 1] + ' +' + done * per : ' · noch kein ' + nm[0]) + (site ? ' · ' + site + ' im Bau' : '');
    };
    const fill = (id, v, cp, src, tips) => {
      const r = $('ffLg-' + id), full = cp > 0 && v >= cp, box = r.querySelector('.lg-tips'), list = full ? tips : [], key = list.map((t) => t.id).join();
      put(r.querySelector('.amt'), String(v | 0)); put(r.querySelector('.cp'), cp > 0 ? '/ ' + (cp | 0) : ''); r.querySelector('u').style.width = (cp > 0 ? Math.min(1, v / cp) * 100 : 0) + '%';
      r.classList.toggle('full', full); put(r.querySelector('.lg-src'), src);
      if (box.dataset.k !== key) { box.dataset.k = key; box.innerHTML = ''; list.forEach((t) => { const b = el('button', 'lg-tip', t.text); b.addEventListener('click', () => t.go()); box.appendChild(b); }); }   // rebuilt only when the tips change (a tap must not hit a new button)
      return r;
    };
    LG_GOODS.forEach((g) => fill(g.k, stock[g.k] || 0, cap[g.k], source(R.capKeep, g.k === 'korn' ? 'kornspeicher' : 'lager', g.k === 'korn' ? R.capKorn : R.capLager), lagerTips(g.k)));
    const f = y.food, ok = !!f && isFinite(f.prod) && isFinite(f.eat), note = $('ffLg-korn').querySelector('.lg-note');
    put(note, (hungerNow() ? '🍞 Hunger! ' : '') + (ok ? 'Ernte +' + Math.round(f.prod) + ' · Verbrauch −' + Math.round(f.eat) + ' pro Min' : '')); note.className = 'lg-note' + (ok ? f.prod >= f.eat ? ' pos' : ' neg' : '');
    const pr = fill('pop', y.pop || 0, y.popCap, source(R.keepHouses, 'huette', R.hutHouses), [{ id: 'huette', text: '🏠 Hütte bauen', go: () => lagerBuild('huette') }]), idle = y.idle | 0;
    put(pr.querySelector('.lg-note'), y.idle == null ? '' : '👷 ' + (idle === 0 ? 'Alle Bauern arbeiten' : idle === 1 ? '1 Bauer frei' : idle + ' Bauern frei'));
  }

  // ---- ⚖️ Markt (the sheet's second page). A trade moves one or more packs (`tradePack` goods each) at once: sell → 💰, buy ← 💰. The screen validates and answers with its next ffYou (and a toast when it refuses);
  // the phone shows the result at once (optimistic) and only asks for what its numbers allow. „×1 / ×5“ in the sheet or a long press on a button trades 5 packs at a time.
  const marktOf = () => {   // the own Markt: { ready, b }, a site → { ready: false, b }, none → null
    const own = st.bld.filter((b) => b.lord === st.lord && b.kind === 'markt' && !b.ruined), done = own.find((b) => b.build >= 1);
    return done ? { ready: true, b: done } : own.length ? { ready: false, b: own[0] } : null;
  };
  const marktReady = () => { const m = marktOf(); return !!(m && m.ready); };
  // what a trade of `want` packs can do now: { n (packs that work), why (a text when none) }
  function tradeCalc(good, side, want) {
    const y = st.you || {}, stock = y.stock || {}, cap = y.cap || {}, P = packN(), price = priceOf(side, good), have = stock[good] | 0, gold = stock.gold | 0;
    if (side === 'sell') { const n = Math.min(want, Math.floor(have / P)); return { n, why: n < 1 ? 'Zu wenig ' + RES_ICON[good] : '' }; }
    const afford = Math.floor(gold / price), room = cap[good] > 0 ? Math.max(0, Math.floor((cap[good] - have) / P)) : want, n = Math.min(want, afford, room);
    return { n, why: n < 1 ? (room < 1 ? RES_ICON[good] + ' Lager voll' : 'Zu wenig 💰') : '' };
  }
  function doTrade(good, side, want) {
    if (!st.you || !marktReady()) { toast('⚖️ Bau zuerst einen Markt'); return; }
    const t = tradeCalc(good, side, want);
    if (t.n < 1) { vib(30); toast('❌ ' + t.why); return; }
    const stock = st.you.stock, P = packN(), price = priceOf(side, good), sg = side === 'sell' ? 1 : -1;   // the numbers move at once (before the order leaves: an answer that comes at once replaces them); the next ffYou is the truth
    stock[good] = (stock[good] | 0) - sg * t.n * P; stock.gold = (stock.gold | 0) + sg * t.n * price;
    send({ t: 'ffTrade', good, side, packs: t.n }); vib(14);
    renderTop(); renderMarkt(); renderCards(); renderTroops();
  }
  const LONG_MS = 480;
  let press = null, lastLong = null;
  function tradeTap(good, side, long) { doTrade(good, side, long ? 5 : st.marktMul); }
  function pressEnd() { if (press) { clearTimeout(press.tm); press = null; } }
  function pressStart(btn) {   // a long press trades 5 packs at once, when the time is up (not on release)
    pressEnd();
    press = { btn, tm: setTimeout(() => {
      if (!press || press.btn !== btn) return; press = null;
      if (btn.disabled) return;
      lastLong = { btn, until: nowMs() + 700 }; btn.classList.add('hold'); setTimeout(() => btn.classList.remove('hold'), 220);
      tradeTap(btn.dataset.good, btn.dataset.side, true);
    }, LONG_MS) };
  }
  function buildMarkt() {
    if (marktBuilt) return;
    marktBuilt = true;
    const body = $('ffMarktBody'); body.innerHTML = '';
    const none = el('div', 'mk-none'); none.id = 'ffMkNone'; none.appendChild(el('div', 'big')); none.appendChild(el('div', 'sub'));
    const nb = el('button', '', '🏗️ Markt bauen'); nb.id = 'ffMkBuild'; nb.addEventListener('click', () => lagerBuild('markt')); none.appendChild(nb); body.appendChild(none);
    const top = el('div', 'mk-top'); top.id = 'ffMkTop'; const gold = el('div', 'mk-gold'); gold.id = 'ffMkGold'; top.appendChild(gold);
    const mul = el('div', 'mk-mul'); mul.appendChild(el('span', '', 'Menge'));
    [1, 5].forEach((m) => { const b = el('button', '', '×' + m); b.id = 'ffMkMul-' + m; b.addEventListener('click', () => { st.marktMul = m; renderMarkt(); vib(8); }); mul.appendChild(b); });
    top.appendChild(mul); body.appendChild(top);
    LG_GOODS.forEach((g) => {
      const r = el('div', 'lg-row'), h = el('div', 'lg-h'), bar = el('div', 'lg-bar'), bs = el('div', 'mk-btns'); r.id = 'ffMk-' + g.k;
      h.appendChild(el('span', 'ic', g.ic)); h.appendChild(el('span', 'nm', g.nm)); h.appendChild(el('b', 'amt')); h.appendChild(el('span', 'cp')); bar.appendChild(el('u'));
      ['sell', 'buy'].forEach((side) => {
        const b = el('button', 'mk-b ' + side); b.id = 'ffMkB-' + side + '-' + g.k; b.dataset.good = g.k; b.dataset.side = side;
        b.appendChild(el('span', 'tt', side === 'sell' ? 'Verkaufen' : 'Kaufen')); b.appendChild(el('small'));
        b.addEventListener('click', () => { if (lastLong && lastLong.btn === b && nowMs() < lastLong.until) { lastLong = null; return; } tradeTap(g.k, side, false); });
        b.addEventListener('pointerdown', () => pressStart(b));
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, pressEnd));
        b.addEventListener('contextmenu', (e) => e.preventDefault());
        bs.appendChild(b);
      });
      r.appendChild(h); r.appendChild(bar); r.appendChild(bs); r.appendChild(el('div', 'lg-note')); body.appendChild(r);
    });
    body.appendChild(el('div', 'mk-note')).id = 'ffMkNote';
    const lg = el('button', 'lg-more', '📦 Zum Lager'); lg.id = 'ffMkLager'; lg.addEventListener('click', () => { setSheet('lager'); renderLager(); }); body.appendChild(lg);
    const more = el('button', 'lg-more', '📖 Mehr dazu in der Anleitung'); more.id = 'ffMkGuide'; more.addEventListener('click', () => openGuide('markt')); body.appendChild(more);
  }
  function renderMarkt() {
    if (!marktOpen()) return;
    buildMarkt();
    const y = st.you || {}, stock = y.stock || {}, cap = y.cap || {}, m = marktOf(), ready = !!(m && m.ready), P = packN();
    const put = (node, t) => { if (node.textContent !== t) node.textContent = t; };
    const none = $('ffMkNone'); none.hidden = ready; $('ffMkTop').hidden = !ready;
    LG_GOODS.forEach((g) => { $('ffMk-' + g.k).hidden = !ready; });
    $('ffMkNote').hidden = !ready; $('ffMkLager').hidden = false;
    if (!ready) {
      put(none.querySelector('.big'), 'Bau zuerst einen ⚖️ Markt');
      put(none.querySelector('.sub'), m ? '🔨 Dein Markt ist noch im Bau · ' + Math.round(m.b.build * 100) + ' %. Dort verkaufst du Überschuss für 💰 und kaufst, was fehlt.' : 'Dort verkaufst du Überschuss für 💰 und kaufst, was fehlt. Söldner und Rammböcke kosten Gold.');
      $('ffMkBuild').hidden = !!m;
      return;
    }
    const gold = $('ffMkGold'), gt = '💰 ' + (stock.gold | 0); if (gold.firstChild == null || gold.firstChild.textContent !== gt) { gold.textContent = gt; gold.appendChild(el('small', '', 'Gold')); }
    [1, 5].forEach((mm) => $('ffMkMul-' + mm).classList.toggle('on', st.marktMul === mm));
    LG_GOODS.forEach((g) => {
      const r = $('ffMk-' + g.k), have = stock[g.k] | 0, cp = cap[g.k], sell = tradeCalc(g.k, 'sell', st.marktMul), buy = tradeCalc(g.k, 'buy', st.marktMul), notes = [];
      put(r.querySelector('.amt'), String(have)); put(r.querySelector('.cp'), cp > 0 ? '/ ' + (cp | 0) : ''); r.querySelector('u').style.width = (cp > 0 ? Math.min(1, have / cp) * 100 : 0) + '%'; r.classList.toggle('full', cp > 0 && have >= cp);
      const sb = $('ffMkB-sell-' + g.k), bb = $('ffMkB-buy-' + g.k), sn = Math.max(1, sell.n), bn = Math.max(1, buy.n);
      sb.disabled = sell.n < 1; bb.disabled = buy.n < 1;
      put(sb.querySelector('small'), sn * P + ' ' + g.ic + ' → 💰 ' + sn * priceOf('sell', g.k)); put(bb.querySelector('small'), '💰 ' + bn * priceOf('buy', g.k) + ' → ' + bn * P + ' ' + g.ic);
      if (sell.n < 1) notes.push('weniger als ' + P + ' ' + g.ic + ' zum Verkaufen'); if (buy.n < 1) notes.push(buy.why === 'Zu wenig 💰' ? 'zu wenig 💰 zum Kaufen' : 'Lager voll');
      put(r.querySelector('.lg-note'), notes.join(' · '));
    });
    put($('ffMkNote'), 'Ein Paket = ' + P + ' Waren. Verkaufen bringt 💰, Kaufen kostet mehr.');
  }

  function placeLager() { $('ffLager').style.setProperty('--sh', $('ffTop').offsetHeight + 'px'); }   // the sheet starts right under the top bar
  function openLager(page) {
    if (isSpec()) return;
    page = page === 'markt' ? 'markt' : 'lager';
    if (lagerOpen()) { if (st.sheet !== page) { setSheet(page); renderLager(); } return; }   // already open: switch the page
    buildLager(); buildMarkt(); placeLager(); setSheet(page);
    $('ffLager').classList.add('show');
    if (!guideHist && !lagerHist) { try { history.pushState({ ffLager: 1 }, ''); lagerHist = true; } catch (e) { lagerHist = false; } }   // the back gesture closes the sheet
    renderLager();
  }
  function closeLager(fromPop) {
    if (!lagerOpen()) return;
    $('ffLager').classList.remove('show'); pressEnd();
    if (lagerHist) { lagerHist = false; if (!fromPop) { ignorePop++; try { history.back(); } catch (e) { ignorePop = 0; } } }   // our own history entry goes away
  }
  ['ffKorn', 'ffHolz', 'ffStein', 'ffPop'].forEach((id) => $(id).addEventListener('click', () => { vib(8); if (lagerOpen() && st.sheet === 'lager') closeLager(false); else openLager('lager'); }));
  $('ffGold').addEventListener('click', () => { vib(8); if (marktOpen()) closeLager(false); else openLager('markt'); });
  $('ffLagerX').addEventListener('click', () => closeLager(false));
  $('ffLager').addEventListener('click', (e) => { if (e.target === $('ffLager')) closeLager(false); });   // a tap outside the sheet

  // ---------- advisor: the most urgent tip under the top bar (docs "P3 Berater") ----------
  const WOODEN = { huette: 1, hof: 1, kornspeicher: 1, lager: 1, holzfaeller: 1, steinbruch: 1, markt: 1, soeldnerlager: 1 };   // (a palisade line is no „Holzgebäude“ for the Brunnen tip)
  // Round 2 / Phase 2: a full workplace rests by itself, so the tip offers a store or the Markt (not „ruhen lassen“); with a finished Markt it says to sell
  const FULL_TIP = { stein: '🪨 Stein voll – bau ein 📦 Lager oder einen ⚖️ Markt', holz: '🪵 Holz voll – bau ein 📦 Lager oder einen ⚖️ Markt', korn: '🌾 Korn voll – bau einen 🏚️ Kornspeicher oder einen ⚖️ Markt' };
  const TIP_SNOOZE_MS = 150000;   // ✕ hides a tip for this long
  // In priority order (the array order is the priority; `id` is what ✕ snoozes and ?advice=<id> shows, so the ids 1–10 of Phase 1b stay): `when(c)` decides, `text(c)` words it, `go` is where a tap leads (a guide section, a mode or the Markt).
  // The Markt tips come first in their kind: 11 (hungry, gold and a Markt: buying fixes it at once) before 1, 12 (a full good and a Markt: sell) before 6; 13 (enemy walls, no ram) is the last.
  const TIPS = [
    { id: 11, hot: 1, go: { markt: 1 }, when: (c) => hungerNow() && c.markt && c.gold >= priceOf('buy', 'korn'), text: () => '⚖️ Hunger – kauf 🌾 auf dem Markt' },
    { id: 1, hot: 1, go: { guide: 'korn' }, when: () => hungerNow(), text: (c) => c.hofs ? '🍞 Hunger! Bau mehr 🌾 Höfe – Bauern gehen zuerst aufs Feld' : '🍞 Hunger! Bau sofort einen 🌾 Hof' },
    { id: 2, hot: 1, go: { guide: 'korn' }, when: (c) => c.hofs > 0 && c.hofAge >= 90 && !!c.food && c.food.prod < c.food.eat, text: (c) => '🌾 Ernte +' + Math.round(c.food.prod) + ', Verbrauch −' + Math.round(c.food.eat) + ' pro Min – bau noch einen Hof' },
    { id: 3, hot: 1, go: { guide: 'feuer' }, when: (c) => c.unwatched, text: () => '🔥 Feuer! Ein 🪣 Brunnen in der Nähe löscht es' },
    { id: 4, go: { mode: 'bauen' }, when: (c) => c.popCap > 0 && c.pop >= c.popCap, text: () => '🏠 Kein Platz für neue Bauern – bau eine Hütte' },
    { id: 5, go: { guide: 'korn' }, when: (c) => c.idle === 0 && (c.waiting > 0 || c.freshSite), text: (c) => c.waiting > 0 ? '👷 Niemand frei für die Ausbildung – bau Hütten oder lass einen Betrieb 💤 ruhen' : '👷 Alle Bauern arbeiten – bau eine Hütte oder lass einen Betrieb 💤 ruhen' },
    { id: 12, go: { markt: 1 }, when: (c) => !!c.full && c.markt, text: (c) => '⚖️ ' + RES_ICON[c.full] + ' ' + LG_GOODS.find((g) => g.k === c.full).nm + ' voll – verkauf Überschuss auf dem Markt' },
    { id: 6, go: { guide: 'gebaeude' }, when: (c) => !!c.full, text: (c) => FULL_TIP[c.full] },
    { id: 7, go: { guide: 'gebaeude' }, when: (c) => c.noWood, text: () => '🪓 Keine Bäume in Reichweite – näher am Wald bauen' },
    { id: 8, go: { guide: 'feuer' }, when: (c) => (c.phase === 'ebbe' || c.phase === 'fehde') && c.wooden >= 6 && !c.brunnen, text: () => '🪣 Noch kein Brunnen – Fackelträger könnten dein Dorf abbrennen' },
    { id: 9, go: { mode: 'bauen' }, when: (c) => c.phase === 'fehde' && !c.kaserne, text: () => '⚔️ Ohne Kaserne keine Truppen' },
    { id: 10, go: { mode: 'banner' }, when: (c) => c.phase === 'fehde' && c.soldiers > 0 && !st.ordered, text: () => '⚑ Schick deine Truppen: Fahne antippen, dann aufs Ziel tippen' },
    { id: 13, go: { mode: 'truppen' }, when: (c) => c.phase === 'fehde' && c.enemyWalls && !c.rams, text: () => '🧱 Feinde haben Mauern – ein 🪵 Rammbock bricht sie schnell' }
  ];
  // recruits in the queue that no peasant has been sent for (ffYou.queue[].wait; an older screen sends no flag: none)
  // (with no finished house for the unit the missing house is the news, not the peasant)
  const waitingRecruits = () => { const q = st.you && Array.isArray(st.you.queue) ? st.you.queue : []; let n = 0; for (const e of q) if (e && !Array.isArray(e) && e.wait && trainerReady(TRAINER_OF[e.unit] || 'kaserne')) n++; return n; };
  function tipCtx() {
    const y = st.you || {}, own = st.bld.filter((b) => b.lord === st.lord && !b.ruined), done = own.filter((b) => b.build >= 1), keep = (st.sites || []).find((q) => q.s === st.site);
    const wells = done.filter((b) => b.kind === 'brunnen'), stock = y.stock || {}, cap = y.cap || {};
    // a burning building counts as unwatched when neither a finished Brunnen nor the keep (Burgbrunnen, 12 round its centre) reaches it
    const unwatched = own.some((b) => b.fire > 0.05 && !(keep && Math.hypot(MXc(b) - keep.x, MYc(b) - keep.y) <= 12) && !wells.some((w) => Math.hypot(MXc(w) - MXc(b), MYc(w) - MYc(b)) <= 12));
    let full = null; for (const r of ['stein', 'holz', 'korn']) if (cap[r] > 0 && (stock[r] | 0) >= cap[r]) { full = r; break; }
    let soldiers = 0; for (let n = 1; n <= 3; n++) { const o = st.ownBanners[n] || st.youBanners[n]; if (o && o.count) soldiers += o.count; }
    // enemy walls that bar the way: a Mauer or Torhaus of a house that is no active pact partner. „No ram“: the phone cannot see what a banner is made of, so it counts the rams it ordered (or saw queued) this match
    const partner = (l) => st.pacts.some((p) => p.with === l && p.state === 'active');
    return { phase: st.phase, hofs: done.filter((b) => b.kind === 'hof').length, hofAge: st.hofSince == null ? 0 : (nowMs() - st.hofSince) / 1000, food: y.food || null, unwatched,
      pop: y.pop | 0, popCap: y.popCap | 0, idle: y.idle, freshSite: own.some((b) => b.build <= 0.005), waiting: waitingRecruits(), full, noWood: done.some((b) => b.kind === 'holzfaeller' && b.noWood && !pausedNow(b) && !b.full),
      wooden: own.filter((b) => WOODEN[b.kind]).length, brunnen: own.some((b) => b.kind === 'brunnen'), kaserne: own.some((b) => b.kind === 'kaserne'), soldiers,
      markt: marktReady(), gold: stock.gold | 0, rams: st.rams > 0, enemyWalls: st.bld.some((b) => b.lord !== st.lord && !b.ruined && b.build >= 1 && (b.kind === 'mauer' || b.kind === 'torhaus') && !partner(b.lord)) };
  }
  function computeTip() {
    if (isSpec() || !st.you || st.phase === 'over' || st.result) return null;
    const c = tipCtx(), t = nowMs();
    for (let i = 0; i < TIPS.length; i++) {
      if (st.tipSnooze[TIPS[i].id] > t) continue;
      let hit = false; try { hit = !!TIPS[i].when(c); } catch (e) { hit = false; }
      if (hit) return { id: TIPS[i].id, hot: !!TIPS[i].hot, go: TIPS[i].go, text: TIPS[i].text(c) };
    }
    return null;
  }
  function forcedTip(n) {   // the harness (?advice=n): tip n whatever the state says
    const T = TIPS.find((q) => q.id === n); if (!T) return null;
    const c = tipCtx(); if (!c.food) c.food = { prod: 6, eat: 13 };
    if (n === 1) c.hofs = c.hofs || 1;
    if ((n === 6 || n === 12) && !c.full) c.full = 'stein';
    return { id: n, hot: !!T.hot, go: T.go, text: T.text(c) };
  }
  function renderTip() {
    const box = $('ffTip'), tip = st.forceTip ? forcedTip(st.forceTip) : computeTip();
    if (!tip) { st.tip = null; box.classList.remove('show', 'hot'); return; }
    if (!st.tip || st.tip.id !== tip.id || st.tip.text !== tip.text) $('ffTipTx').textContent = tip.text;
    st.tip = tip; box.classList.add('show'); box.classList.toggle('hot', tip.hot);
  }
  function tipGo() {
    const t = st.tip; if (!t) return;
    if (t.go.guide) openGuide(t.go.guide);
    else if (t.go.markt) openLager('markt');
    else if (t.go.mode === 'banner') { setMode('banner'); const n = [1, 2, 3].find((k) => { const o = st.ownBanners[k] || st.youBanners[k]; return o && o.count; }); if (n && st.arm !== n) armBanner(n); }
    else if (t.go.mode) setMode(t.go.mode);
  }
  $('ffTipTx').addEventListener('click', tipGo); $('ffTipGo').addEventListener('click', tipGo);
  $('ffTipX').addEventListener('click', (e) => { e.stopPropagation(); const t = st.tip; if (!t) return; st.tipSnooze[t.id] = nowMs() + TIP_SNOOZE_MS; if (st.forceTip === t.id) st.forceTip = 0; renderTip(); });

  // ---------- alerts: a full-width banner, a colour and a vibration pattern per kind ----------
  function alertShow(kind, text, x, y) {
    const a = ALERTS[kind]; if (!a) return;
    const box = $('ffAlert'), clean = String(text || '').replace(/^[^\p{L}\p{N}„"(]+/u, '').slice(0, 90) || a.dflt;   // the icon is ours: drop the herald's leading emoji
    box.className = 'show ' + kind; box.querySelector('.ic').textContent = a.ic; box.querySelector('.tx').textContent = clean;
    box.style.setProperty('--sh', $('ffTop').offsetHeight + 'px');
    clearTimeout(alertT); st.alert = { kind, until: nowMs() + a.ms };
    if (!STILL) alertT = setTimeout(alertHide, a.ms);
    vib(a.buzz);
    if (kind === 'attack') { const f = $('ffFlash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
    if (map && typeof x === 'number' && typeof y === 'number') map.ping(x, y, kind === 'fire' ? '#e8601c' : kind === 'attack' ? '#d93025' : '#7d1f5a');
  }
  function alertHide() { clearTimeout(alertT); alertT = 0; st.alert = null; $('ffAlert').classList.remove('show'); }
  $('ffAlert').addEventListener('click', alertHide);

  // ---------- costs ----------
  function affordance(cost) {   // → list of missing resources
    const stock = (st.you && st.you.stock) || null, miss = [];
    if (!stock) return miss;
    for (const r in cost || {}) if ((stock[r] | 0) < cost[r]) miss.push(r);
    return miss;
  }
  function costChips(box, cost, suffix) {   // suffix: a small word after the chips („je Feld“ for a wall, which is paid per cell)
    const miss = affordance(cost), key = JSON.stringify(cost || {}) + '|' + miss.join() + '|' + (suffix || '');
    if (box.dataset.k === key) return;
    box.dataset.k = key; box.innerHTML = '';
    for (const r in cost || {}) { if (!cost[r]) continue; const c = document.createElement('span'); c.className = 'ff-chip' + (miss.indexOf(r) >= 0 ? ' miss' : ''); c.textContent = cost[r] + ' ' + RES_ICON[r]; box.appendChild(c); }
    if (suffix) { const c = document.createElement('span'); c.className = 'ff-chip pc'; c.textContent = suffix; box.appendChild(c); }
  }
  const isWallKind = (k) => { const B = FurtWorld.BUILDINGS[k]; return !!(B && B.wall); };
  // The real costs live in the sim (FurtSim.CONST); the screen sends them with ffInfo.costs. Only without them the (stale) world.js drafts are used.
  function takeCosts(c) {
    if (!c || typeof c !== 'object') return;
    const ok = (o) => o && typeof o === 'object', u = ok(c.units) ? c.units : ok(c.unit) ? c.unit : null;
    if (ok(c.build) || u) { st.costs = { build: ok(c.build) ? c.build : null, units: u, rebuild: typeof c.rebuild === 'number' && c.rebuild >= 0 ? c.rebuild : 0.5 }; if (map) { renderCards(); renderTroops(); renderCard(); } }
  }
  function costOf(kind) { const c = st.costs && st.costs.build && st.costs.build[kind]; return c || ((FurtWorld.BUILDINGS[kind] || {}).draft || {}).cost || {}; }
  function unitCost(u) { const c = st.costs && st.costs.units && st.costs.units[u]; return c || ((FurtWorld.UNITS[u] || {}).draft || {}).cost || {}; }
  function halfCost(kind, len) { const c = costOf(kind), k = st.costs ? st.costs.rebuild : 0.5, m = isWallKind(kind) ? len >= 1 ? len | 0 : 1 : 1, out = {}; for (const r in c) out[r] = Math.ceil(c[r] * m * k); return out; }   // a ruin is rebuilt for ½ (rounded up; a wall piece costs per cell)
  function missText(miss) { return 'Zu wenig ' + miss.map((r) => RES_ICON[r]).join(' '); }

  // ---------- cards (Bauen) ----------
  const cardKinds = () => {   // the catalog's buildings in the order of CARD_GROUPS (a kind no group names comes last)
    const all = Object.keys(FurtWorld.BUILDINGS).filter((k) => k !== 'bergfried'), out = [];
    CARD_GROUPS.forEach((g) => { const ks = g.kinds.filter((k) => all.indexOf(k) >= 0); if (ks.length) out.push({ t: g.t, kinds: ks }); });
    const rest = all.filter((k) => !CARD_GROUPS.some((g) => g.kinds.indexOf(k) >= 0)); if (rest.length) out.push({ t: '🏗️ Weiteres', kinds: rest });
    return out;
  };
  function buildCards() {
    const box = $('ffCards'); box.innerHTML = '';
    cardKinds().forEach((g) => {
      box.appendChild(el('div', 'ff-cg', g.t));
      g.kinds.forEach((kind) => {
        const B = FurtWorld.BUILDINGS[kind], card = document.createElement('button');
        card.className = 'ff-card'; card.id = 'ffCard-' + kind;
        card.innerHTML = '<span class="ic"></span><span class="nm"></span><span class="wz"></span><span class="cost"></span>';
        card.querySelector('.ic').textContent = B.icon; card.querySelector('.wz').textContent = (INFO[kind] || {}).kurz || '';
        card.querySelector('.nm').innerHTML = B.name + ' <small>' + sizeTxt(kind) + '</small>';   // (the space is where a long name may break)
        card.addEventListener('click', () => selectKind(kind));
        box.appendChild(card);
      });
    });
    renderCards();
  }
  function renderCards() {
    cardKinds().forEach((g) => g.kinds.forEach((kind) => {
      const card = $('ffCard-' + kind); if (!card) return;
      costChips(card.querySelector('.cost'), costOf(kind), isWallKind(kind) ? 'je Feld' : '');
      card.classList.toggle('poor', affordance(costOf(kind)).length > 0);
    }));
    if (st.sel) { costChips($('ffPCost'), costOf(st.sel), isWallKind(st.sel) ? 'je Feld' : ''); if (isWallKind(st.sel)) updateWallUI(); }
  }

  // ---------- placement (ghost) ----------
  // A building is placed with the ghost (drag, ↻, ✓). A wall (Palisade, Mauer) is a line: the map's wall tool draws it with one drag (↻ turns the corner), and ✓ sends the pieces as one ffWall.
  const wallSel = () => !!st.sel && isWallKind(st.sel);
  // why a spot is refused, in words (the Torhaus has its own rules: its lane needs room at both ends)
  function reasonText(kind, r) {
    if (kind === 'torhaus' && r === 'tight') return 'Zu eng – vor und hinter der Gasse muss Platz bleiben';
    if (kind === 'torhaus' && r === 'bounds') return 'Zu nah am Kartenrand';
    if (isWallKind(kind) && r === 'tight') return 'Zu eng – lass ein Feld Abstand (nur Wände, Tor und Turm dürfen sich berühren)';
    return map.REASON_TEXT[r] || 'Geht nicht';
  }
  function selectKind(kind) {
    if (!map) return;
    closeCard();
    const wall = isWallKind(kind);
    st.sel = kind; root.classList.add('placing');
    const B = FurtWorld.BUILDINGS[kind], miss = affordance(costOf(kind));
    map.view('mine');
    map.setGhost(null); map.setWall(null);
    if (wall) { map.setWall({ kind }); map.setTool('wall'); }
    else {
      const sp = FurtWorld.suggest(st.grid, kind, st.site, { L: st.L, occ: map.occ });
      if (sp) map.setGhost({ kind, i: sp.i, j: sp.j, rot: sp.rot });
      else {
        const site = st.sites.find((q) => q.s === st.site) || { x: 0, y: 0 };
        map.setGhost({ kind, i: Math.round(site.x + 72 + 4), j: Math.round(site.y + 45 + 4), rot: 0 });
        toast('Kein freier Platz gefunden – zieh den Plan selbst');
      }
      map.setTool('ghost');
    }
    $('ffPIc').textContent = B.icon; $('ffPNm').textContent = B.name; $('ffPRule').textContent = B.rule ? '📐 ' + B.rule : '';
    $('ffPHint').textContent = wall ? '☝️ Linie ziehen · ↻ dreht die Ecke · ✌️ zwei Finger = Karte' : '☝️ Plan ziehen · ↻ dreht ihn · ✌️ zwei Finger = Karte';
    const I = INFO[kind] || {}; $('ffPWozu').textContent = I.wozu || ''; $('ffPWohin').textContent = I.wohin || ''; $('ffPViele').textContent = I.viele || ''; $('ffPInfo').scrollTop = 0;
    $('ffPBau').classList.add('placing');
    renderCards(); if (wall) updateWallUI(); else updatePlaceUI(map.getGhost()); renderCover();
    if (miss.length) toast('⚠️ ' + missText(miss));
  }
  function cancelPlace() {
    st.sel = null; root.classList.remove('placing');
    if (map) { map.setGhost(null); map.setWall(null); map.setTool(st.mode === 'banner' ? 'banner' : null); }
    $('ffPBau').classList.remove('placing'); $('ffPSum').classList.remove('show'); $('ffReason').className = ''; renderCover(); renderCoverLine();
  }
  function refreshPlaceUI() { if (!st.sel || !map) return; if (wallSel()) updateWallUI(); else updatePlaceUI(map.getGhost()); }   // the board, the water or the stock changed under the plan
  function updatePlaceUI(g) {
    if (!g) return;
    renderCoverLine();
    const ok = g.ok, why = !ok && g.reason ? reasonText(g.kind, g.reason) : '';
    const r = $('ffReason'); r.className = ok ? '' : 'bad';
    r.textContent = ok ? '✅ Passt hier – bestätige mit ✓' : '❌ ' + why;
    $('ffOk').classList.toggle('bad', !ok); st.lastReason = ok ? '' : g.reason;
  }
  // the wall line: how many cells and what they cost, which pieces the stock reaches, what the first refusal is; → the summary line, the verdict and the bubble at the end of the line
  function wallPlan(w) {
    const kind = st.sel, per = costOf(kind), B = FurtWorld.BUILDINGS[kind], stock = Object.assign({}, (st.you && st.you.stock) || {}), res = { w, kind, per, B, cells: w.okCells, afford: 0, affordCells: 0, miss: [] };
    for (const pc of w.pieces) {   // the sim builds the pieces in order while the stock lasts
      if (!pc.ok) continue;
      const need = {}; for (const r in per) need[r] = per[r] * pc.len;
      const lack = Object.keys(need).filter((r) => (stock[r] | 0) < need[r]);
      if (lack.length) { res.miss = lack; break; }
      for (const r in need) stock[r] -= need[r];
      res.afford++; res.affordCells += pc.len;
    }
    return res;
  }
  function updateWallUI(w) {
    if (!map || !wallSel()) return;
    w = w || map.getWall();
    const r = $('ffReason'), sum = $('ffPSum'), ok = $('ffOk');
    if (!w) { r.className = 'idle'; r.textContent = '☝️ Zieh eine Linie über dein Land'; sum.classList.remove('show'); ok.classList.add('bad'); map.setWallLabel(''); st.lastReason = ''; return; }
    const P = wallPlan(w), n = P.cells, tot = {}; for (const k in P.per) tot[k] = P.per[k] * n;
    const cells = n === 1 ? '1 Feld' : n + ' Felder', cost = costText(tot), gaps = w.badRuns ? ' · ' + w.badRuns + (w.badRuns === 1 ? ' Lücke' : ' Lücken') : '';
    const line = P.B.icon + ' ' + (n ? cells + (cost ? ' · ' + cost : '') : 'nichts baubar') + gaps;
    if (sum.textContent !== line) sum.textContent = line;
    sum.classList.add('show');
    let cls = '', txt = '✅ Passt hier – bestätige mit ✓', good = true;
    if (!n) { cls = 'bad'; txt = '❌ ' + reasonText(P.kind, w.reason); good = false; }
    else if (P.afford === 0) { cls = 'bad'; txt = '❌ ' + missText(P.miss); good = false; }
    else if (P.afford < w.okPieces) { cls = 'warn'; txt = '⚠️ ' + P.miss.map((x) => RES_ICON[x]).join(' ') + ' reicht nur für ' + P.affordCells + ' von ' + n + ' Feldern'; }
    else if (w.badRuns) { cls = 'warn'; txt = '⚠️ Rot geht nicht – ✓ baut den Rest'; }
    r.className = cls; if (r.textContent !== txt) r.textContent = txt;
    ok.classList.toggle('bad', !good); st.lastReason = good ? '' : w.reason || '';
    map.setWallLabel(n ? cells + (cost ? ' · ' + cost : '') : '');
  }
  function confirmWall() {
    const w = map.getWall();
    if (!w) { vib(30); toast('☝️ Zieh erst eine Linie über dein Land'); return; }
    if (!w.okCells) { vib(30); toast('❌ ' + reasonText(w.kind, w.reason)); return; }
    const P = wallPlan(w);
    if (P.afford === 0) { vib(30); toast('❌ ' + missText(P.miss)); return; }
    send({ t: 'ffWall', kind: w.kind, pieces: w.send }); vib(25);
    cancelPlace();
  }
  function confirmPlace() {
    if (!map || !st.sel) return;
    if (wallSel()) { confirmWall(); return; }
    const g = map.getGhost(); if (!g) return;
    if (!g.ok) { map.shake(); vib(30); toast('❌ ' + reasonText(g.kind, g.reason)); return; }
    const miss = affordance(costOf(g.kind));
    if (miss.length) { map.shake(); vib(30); toast('❌ ' + missText(miss)); return; }
    const m = { t: 'ffBuild', kind: g.kind, i: g.i, j: g.j, rot: g.rot };
    send(m);
    vib(25);
    cancelPlace();
  }
  $('ffOk').addEventListener('click', confirmPlace);
  $('ffNo').addEventListener('click', () => { cancelPlace(); });
  $('ffRot').addEventListener('click', () => { if (!map || !st.sel) return; if (wallSel()) map.flipWall(); else map.rotateGhost(); });

  // ---------- Truppen ----------
  // The units are grouped by the house that trains them (TRAINERS): „⚔️ Kaserne“ and „⛺ Söldnerlager“. A group whose house is not finished is dimmed and says „Bau zuerst …“ (a tap on the note starts the placing).
  const trainerReady = (at) => st.bld.some((b) => b.lord === st.lord && b.kind === at && !b.ruined && b.build >= 1);
  function buildTroops() {
    const tg = $('ffTargets'); tg.innerHTML = '';
    TARGETS.forEach((t) => {
      const b = document.createElement('button'); b.className = 'ff-tg' + (t.n === st.target ? ' on' : ''); b.id = 'ffTarget-' + t.n;
      b.innerHTML = '<span class="ic">' + t.ic + '</span>' + (t.n ? t.lb : '<small>' + t.lb + '</small>') + '<small id="ffTCnt-' + t.n + '"></small>';
      b.addEventListener('click', () => { st.target = t.n; renderTargets(); if (map) { map.selPin = t.n; if (t.n) map.pulsePin(t.n); } });
      tg.appendChild(b);
    });
    const un = $('ffUnits'); un.innerHTML = '';
    TRAINERS.forEach((g) => {
      const grp = el('div', 'ff-grp'), head = el('div', 'ff-gh'), row = el('div', 'ff-gunits'), note = el('button', 'ff-gnote'); grp.id = 'ffGrp-' + g.at;
      head.appendChild(el('span', '', g.ic + ' ' + g.nm)); head.appendChild(el('small', 'st'));
      note.id = 'ffGNote-' + g.at; note.hidden = true; note.addEventListener('click', () => { if (!note.disabled) { setMode('bauen'); selectKind(g.at); } });
      g.units.forEach((u) => {
        const U = FurtWorld.UNITS[u], b = document.createElement('button'); b.className = 'ff-unit'; b.id = 'ffUnit-' + u;
        b.innerHTML = '<span class="big"></span><span class="nm"></span><span class="ff-ucost"></span>';
        b.querySelector('.big').textContent = '+' + U.icon; b.querySelector('.nm').textContent = U.name;
        b.addEventListener('click', () => recruit(u, b));
        row.appendChild(b);
      });
      grp.appendChild(head); grp.appendChild(note); grp.appendChild(row); un.appendChild(grp);
    });
    renderTroops();
  }
  function recruit(u, btn) {
    const at = TRAINER_OF[u], g = TRAINERS.find((x) => x.at === at), cost = unitCost(u), miss = affordance(cost);
    if (g && st.bld.length && !trainerReady(at)) { btn.classList.remove('no'); void btn.offsetWidth; btn.classList.add('no'); vib(30); toast('🔨 Bau zuerst ' + g.need); return; }
    if (miss.length) { btn.classList.remove('no'); void btn.offsetWidth; btn.classList.add('no'); vib(30); toast('❌ ' + missText(miss)); return; }
    if (st.you && st.you.idle === 0) { toast('⚠️ Niemand frei zum Ausbilden'); }
    send({ t: 'ffRecruit', unit: u, n: st.target }); vib(18);
    if (u === 'ramme') st.rams = 1;   // (a flag: the phone cannot see the banners' men; advisor tip 13 stops once a ram was ordered)
    btn.classList.remove('sent'); void btn.offsetWidth; btn.classList.add('sent');
    if (!st.recruited && trainerReady(at) && !(st.you && st.you.idle === 0)) { st.recruited = true; setTimeout(() => toast('💡 Ausgebildete Truppen schickst du unter ⚑ Fahnen los'), 700); }   // the first recruit of a match
  }
  $('ffSend').addEventListener('click', () => { if (st.target >= 1) sendTroops(st.target); });
  function renderTargets() {
    TARGETS.forEach((t) => {
      const b = $('ffTarget-' + t.n); if (!b) return;
      b.classList.toggle('on', t.n === st.target);
      const c = $('ffTCnt-' + t.n); if (!c) return;
      const o = t.n ? st.ownBanners[t.n] : null, y = st.youBanners[t.n], cnt = o ? o.count : y ? y.count : null;
      c.textContent = cnt != null ? '×' + cnt : t.n || st.haveYouBanners ? '–' : '';   // the Burgwache has a count only when ffYou lists the banners
    });
    // „📍 Schicken“: from ⚔️ straight to ⚑ with this banner picked (the Burgwache stays at the keep)
    const sb = $('ffSend'), n = st.target;
    if (n >= 1) { const o = st.ownBanners[n] || st.youBanners[n]; sb.hidden = false; sb.textContent = '📍 Fahne ' + ROMAN[n] + ' schicken'; sb.classList.toggle('poor', !(o && o.count)); } else sb.hidden = true;
  }
  function renderTroops() {
    const known = st.bld.length > 0;   // before the first ffBoard nothing is known: no group is dimmed
    TRAINERS.forEach((g) => {
      const grp = $('ffGrp-' + g.at); if (!grp) return;
      const mine = st.bld.filter((b) => b.lord === st.lord && b.kind === g.at && !b.ruined), done = mine.some((b) => b.build >= 1), off = known && !done, site = mine[0], pct = site ? Math.round(site.build * 100) : 0;
      grp.classList.toggle('off', off);
      const sm = grp.querySelector('.ff-gh .st'), st2 = !known ? '' : done ? 'bereit' : site ? 'im Bau ' + pct + ' %' : 'fehlt'; if (sm.textContent !== st2) sm.textContent = st2;
      const note = $('ffGNote-' + g.at), nt = '🔨 Bau zuerst ' + g.need + (site ? ' · im Bau ' + pct + ' %' : ' – tippe hier'); note.hidden = !off; note.disabled = !!site; if (note.textContent !== nt) note.textContent = nt;
      g.units.forEach((u) => {
        const b = $('ffUnit-' + u); if (!b) return;
        const cost = unitCost(u);
        costChips(b.querySelector('.ff-ucost'), cost); b.classList.toggle('poor', affordance(cost).length > 0);
      });
    });
    renderTargets();
    const y = st.you || {}, q = Array.isArray(y.queue) ? y.queue : [], box = $('ffQueue'); box.innerHTML = '';
    $('ffIdle').textContent = y.idle != null ? '· 👥 ' + (y.idle | 0) + ' frei' : '';
    let waits = 0;   // recruits nobody has taken while no peasant is free: „⏳ wartet auf einen freien Bauern“
    q.slice(0, 8).forEach((e) => {
      const it = Array.isArray(e) ? { unit: e[0], n: e[1], p: e[2] } : e, U = FurtWorld.UNITS[it.unit]; if (!U) return;
      const wt = !!it.wait && y.idle === 0 && trainerReady(TRAINER_OF[it.unit] || 'kaserne'); if (wt) waits++;
      const c = document.createElement('span'); c.className = 'ff-q' + (wt ? ' wait' : '');
      c.innerHTML = '<u style="width:' + Math.round(100 * (it.p || 0)) + '%"></u><span>' + (wt ? '⏳ ' : '') + U.icon + '→' + (it.n ? ROMAN[it.n] : '🏰') + '</span>';
      box.appendChild(c);
    });
    if (waits) { const c = document.createElement('div'); c.className = 'ff-qwait'; c.textContent = '⏳ wartet auf einen freien Bauern'; box.appendChild(c); }
    if (!q.length) { const c = document.createElement('span'); c.style.cssText = 'font-size:12px;opacity:.6'; c.textContent = 'Keine Ausbildung läuft'; box.appendChild(c); }
  }

  // ---------- Banner ----------
  function buildBans() {
    const box = $('ffBans'); box.innerHTML = '';
    [1, 2, 3].forEach((n) => {
      const b = document.createElement('button'); b.className = 'ff-ban'; b.id = 'ffBan-' + n;
      b.innerHTML = '<i>' + ROMAN[n] + '</i><span>Fahne ' + ROMAN[n] + '<small></small></span>';
      b.addEventListener('click', () => armBanner(n));
      box.appendChild(b);
    });
    renderBans();
  }
  function renderBans() {
    let any = false;
    [1, 2, 3].forEach((n) => {
      const b = $('ffBan-' + n); if (!b) return; const o = st.ownBanners[n] || st.youBanners[n]; if (o && o.count) any = true;
      const t = st.arm === n ? '📍 wartet aufs Ziel' : o && o.count ? '⚔️ ' + o.count + ' Mann' : o ? 'sammelt Rekruten' : 'wartet an der Burg';
      const sm = b.querySelector('small'); if (sm.textContent !== t) sm.textContent = t;
      b.classList.toggle('on', st.arm === n);
    });
    const h = $('ffBanHint'), tx = st.arm ? '📍 Tippe aufs Ziel für Fahne ' + ROMAN[st.arm]
      : any ? 'Tippe eine Fahne an, dann aufs Ziel. Oder zieh die Fahne mit dem Finger zu Furt, Brücke oder Feindburg.'
      : 'Noch keine Truppen: bilde sie unter ⚔️ aus. Eine Fahne ohne Truppen setzt den Sammelpunkt.';
    if (h.textContent !== tx) h.textContent = tx;
    h.className = st.arm ? 'armed' : '';
    renderTargets();
  }
  // tap-to-send: a banner waits for its target (a gold ring round its pin); the next tap on the map sends it. Tapping it again lets it go.
  function armBanner(n) {
    if (!map || isSpec() || !(n >= 1 && n <= 3)) return;
    st.arm = st.arm === n ? 0 : n;
    map.setArm(st.arm); if (st.arm) { map.selPin = n; map.pulsePin(n); vib(8); }
    renderBans();
  }
  function sendTroops(n) { st.target = n; st.arm = 0; setMode('banner'); armBanner(n); }   // from ⚔️: switch to ⚑ with that banner picked
  $('ffHome').addEventListener('click', () => { send({ t: 'ffHome' }); vib(20); toast('🏰 Alle Fahnen ziehen heim'); if (map) for (let n = 1; n <= 3; n++) map.setOrder(n, null); });

  // ---------- 🤝 Pakte ----------
  const pactsOn = () => !isSpec() && st.lords.filter(Boolean).length > 2;
  const pactOf = (i) => {
    const p = st.pacts.find((x) => x.with === i);
    if (!p) return { with: i, state: 'none', until: 0, left: null };
    const left = typeof p.left === 'number' ? p.left : remaining(p.until);
    return { with: i, state: left != null && left <= 0 ? 'none' : p.state, until: p.until, left };
  };
  function buildPactRows() {
    const box = $('ffPacts'); box.innerHTML = '';
    st.lords.forEach((l) => {
      if (!l || l.i === st.lord) return;
      const row = el('div', 'ff-pact'), i = l.i; row.id = 'ffPact-' + i; row.style.setProperty('--hc', l.color || '#8a7656');
      const h = el('div', 'pt-h');
      h.appendChild(el('i', 'dot')); h.appendChild(el('span', 'nm')); h.appendChild(el('span', 'pt-s')); row.appendChild(h);
      row.appendChild(el('div', 'pt-t'));
      const bs = el('div', 'pt-b'); row.appendChild(bs);
      const mk = (id, cls, label, fn) => { const b = el('button', cls, label); b.id = id + '-' + i; b.addEventListener('click', fn); b.hidden = true; bs.appendChild(b); return b; };
      mk('ffPOffer', '', '🤝 Pakt anbieten · 3 Min', () => pactSend(i, true));
      mk('ffPWithdraw', '', '↩️ Angebot zurückziehen', () => pactSend(i, false));
      mk('ffPYes', 'go', '✅ Annehmen', () => pactSend(i, true));
      mk('ffPNo', 'no', '✖ Ablehnen', () => pactSend(i, false));
      mk('ffPBreak', 'brk', '🗡️ Pakt brechen', () => { st.breaking = i; renderPacts(); });
      mk('ffPBack', '', 'Zurück', () => { st.breaking = null; renderPacts(); });
      mk('ffPSure', 'brk', '🗡️ Ja, brechen', () => { st.breaking = null; pactSend(i, false); vib([60, 40, 160]); });
      box.appendChild(row);
    });
  }
  function pactSend(to, on) {
    send({ t: 'ffPact', to, on }); vib(on ? [30, 30, 60] : 25);
    st.busy[to] = nowMs() + 1500; delete st.snooze[to]; renderPacts();
  }
  function renderPacts() {
    const on = pactsOn(), btn = $('ffMode-pakte');
    btn.style.display = on ? '' : 'none';
    if (!on) { if (st.mode === 'pakte') setMode('bauen'); updateOffer(); return; }
    let incoming = 0, active = [];
    st.lords.forEach((l) => {
      if (!l || l.i === st.lord) return;
      const i = l.i, row = $('ffPact-' + i); if (!row) return;
      const p = pactOf(i), left = p.left, busy = (st.busy[i] || 0) > nowMs(), brk = st.breaking === i && p.state === 'active';
      if (p.state === 'incoming') incoming++; if (p.state === 'active') active.push(i);
      row.className = 'ff-pact ' + p.state + (busy ? ' busy' : '');
      row.querySelector('.nm').textContent = houseName(l) || 'Haus ' + (i + 1);
      row.querySelector('.pt-s').textContent = p.state === 'none' || left == null ? '' : mmss(left);
      const pl = playerNames(l), msg = brk ? 'Verrat kostet 5 Ruhm, und das Haus wird zornig (+25 % Schaden, 1 Min).' :
        { none: '', offered: 'Angebot läuft …', incoming: 'bietet einen Pakt an', active: 'ihr seid verbündet' }[p.state];
      row.querySelector('.pt-t').textContent = brk ? msg : pl && msg ? pl + ' · ' + msg : pl || msg;
      const show = (id, v) => { $(id + '-' + i).hidden = !v; };
      show('ffPOffer', p.state === 'none'); show('ffPWithdraw', p.state === 'offered'); show('ffPYes', p.state === 'incoming'); show('ffPNo', p.state === 'incoming');
      show('ffPBreak', p.state === 'active' && !brk); show('ffPBack', brk); show('ffPSure', brk);
    });
    const bd = $('ffBd-pakte');
    if (incoming) { bd.textContent = incoming; bd.className = 'bd hot'; bd.style.display = 'block'; }
    else if (active.length) { bd.textContent = active.length; bd.className = 'bd ok'; bd.style.display = 'block'; }
    else bd.style.display = 'none';
    if (map) map.setPartners(active);
    updateOffer();
  }
  function updateOffer() {   // the prompt: an incoming offer, whatever mode the player is in
    const box = $('ffOffer');
    let best = null;
    if (pactsOn()) for (const l of st.lords) {
      if (!l || l.i === st.lord) continue;
      const p = pactOf(l.i);
      if (p.state === 'incoming' && !(st.snooze[l.i] && st.snooze[l.i] === p.until) && (!best || (p.left == null ? 99 : p.left) < (best.p.left == null ? 99 : best.p.left))) best = { l, p };
    }
    st.offerTo = best ? best.l.i : null;
    const vis = !!best && st.mode !== 'pakte';
    root.classList.toggle('offer', vis); box.classList.toggle('show', vis);
    if (!best) return;
    $('ffOfDot').style.setProperty('--hc', best.l.color || '#8a7656');
    const tx = $('ffOfTx'), name = houseName(best.l) || 'Ein Haus', html = '🤝 <b></b> bietet dir einen Pakt an';
    if (tx.dataset.k !== name) { tx.dataset.k = name; tx.innerHTML = html; tx.querySelector('b').textContent = name; }
    $('ffOfT').textContent = best.p.left != null ? mmss(best.p.left) : '';
    $('ffOfBar').style.width = best.p.left != null ? Math.max(0, Math.min(100, best.p.left / 30 * 100)) + '%' : '100%';
  }
  $('ffOfYes').addEventListener('click', () => { if (st.offerTo != null) pactSend(st.offerTo, true); });
  $('ffOfNo').addEventListener('click', () => { if (st.offerTo != null) pactSend(st.offerTo, false); });
  $('ffOfLater').addEventListener('click', () => { if (st.offerTo != null) { st.snooze[st.offerTo] = pactOf(st.offerTo).until; updateOffer(); } });

  // ---------- well coverage (docs "W1") ----------
  // While a Brunnen is placed, or the card of an own Brunnen or of the own castle is open, the war map shows what the wells reach (warmap.js does the drawing and the counting, by the sim's rule:
  // a wooden building is protected when its centre is within the radius of a finished Brunnen's centre or of the keep's centre).
  const coverOn = () => !isSpec() && (st.sel === 'brunnen' || st.card === KEEP || (st.card != null && !!st.byId[st.card] && st.byId[st.card].kind === 'brunnen'));
  function renderCover() { if (map) map.setCoverage(coverOn() ? { r: st.rules.bucketR, keepR: st.rules.keepWellR } : null); }
  const holzAcc = 'Holzgebäude', holzDat = (n) => n === 1 ? 'Holzgebäude' : 'Holzgebäuden';   // „3 Holzgebäude“, „von 10 Holzgebäuden“
  // the summary line of the placing panel: „🪣 Geschützt: 7 von 10 Holzgebäuden · dieser Brunnen schützt 3 weitere“
  function renderCoverLine() {
    const box = $('ffPCover');
    if (st.sel !== 'brunnen' || !map) { box.classList.remove('show'); return; }
    const c = map.coverage(st.rules.bucketR, st.rules.keepWellR);
    const a = c.wood ? '🪣 Geschützt: ' + c.covered + ' von ' + c.wood : '🪣 Noch keine Holzgebäude, die Schutz brauchen', ax = c.wood ? ' ' + holzDat(c.wood) : '';   // `ax` is the part the landscape panel drops
    const b = c.wood ? 'dieser Brunnen schützt ' + (c.extra ? c.extra + (c.extra === 1 ? ' weiteres' : ' weitere') : 'keine weiteren') : '';
    if (box.dataset.k !== a + ax + '|' + b) {
      box.dataset.k = a + ax + '|' + b; box.innerHTML = '';
      const sa = el('span', '', a); if (ax) sa.appendChild(el('span', 'x', ax)); box.appendChild(sa);
      if (b) { box.appendChild(el('i', 'sep', ' · ')); box.appendChild(el('span', '', b)); }
    }
    box.classList.add('show');
  }
  // the „Schutz“ row on the card of a Brunnen or of the own castle
  function renderCardCover(b) {
    const row = $('ffCRowCover'), keep = b === KEEP;
    if (!map || !(keep || (b && b.kind === 'brunnen' && !b.ruined))) { row.hidden = true; return; }
    const c = map.coverage(st.rules.bucketR, st.rules.keepWellR), d = c.discs.find((q) => keep ? q.kind === 'keep' : q.id === b.id);
    if (!d) { row.hidden = true; return; }
    const n = c.marks.filter((m) => Math.hypot(m.x - d.x, m.y - d.y) <= d.r).length, all = c.covered + ' von ' + c.wood + ' ' + holzDat(c.wood);
    $('ffCCover').textContent = !d.live ? 'Noch im Bau – er löscht erst, wenn er fertig ist. Bisher geschützt: ' + all + '.'
      : keep ? 'Der Bergfried schützt ' + n + ' ' + holzAcc + ' im Umkreis von ' + c.keepR + '. Zusammen mit den Brunnen sind ' + all + ' geschützt.'
      : 'Dieser Brunnen schützt ' + n + ' ' + holzAcc + ' im Umkreis von ' + c.r + '. Zusammen mit Burg und allen Brunnen sind ' + all + ' geschützt.';
    row.hidden = false;
  }

  // ---------- the card of the own castle (a tap on it): no HP or buttons, but the Burgbrunnen and the stores ----------
  function openKeepCard() {
    if (isSpec() || !map || st.site == null) return;
    cancelPlace(); st.card = KEEP; st.cardArm = 0;
    $('ffPanel').classList.add('card'); map.setSelected(KEEP);
    renderCard(); renderCover(); vib(8);
  }
  function renderKeepCard() {
    const B = FurtWorld.BUILDINGS.bergfried, R = st.rules, sEl = $('ffCState');
    $('ffCIc').textContent = B.icon; $('ffCNm').textContent = B.name; $('ffCSz').textContent = B.size[0] + '×' + B.size[1] + ' · Stein, feuerfest';
    $('ffCHp').hidden = true;
    sEl.textContent = '🏰 Burgbrunnen: löscht im Umkreis von ' + R.keepWellR; sEl.className = 'work';
    $('ffCWozu').textContent = '🏰 Dein Zuhause: lagert je ' + R.capKeep + ' 🌾 🪵 🪨, bietet ' + R.keepHouses + ' Wohnplätze, schießt auf Feinde und löscht als Burgbrunnen Brände im Umkreis von ' + R.keepWellR;
    $('ffCRowWohin').hidden = $('ffCRowViele').hidden = true; $('ffCPause').hidden = true; $('ffCCost').innerHTML = ''; $('ffCAsk').hidden = true; $('ffCConfirm').hidden = true;
    ['ffCardRebuild', 'ffCardClear', 'ffCardDemolish'].forEach((id) => { $(id).hidden = true; });
    $('ffCardLager').hidden = false; $('ffCardMarkt').hidden = true; $('ffCGar').hidden = true;
    renderCardCover(KEEP);
  }

  // ---------- building card (tap an own building) ----------
  // a workplace's rest: the tap shows at once (pauseWant), the next ffBoard confirms it; a refusal lets the old state come back after 1.8 s
  const pausedNow = (b) => { const w = st.pauseWant[b.id]; return w && nowMs() < w.until ? w.on : !!b.paused; };
  function cardState(b) {   // → { txt, cls }: the words of the contract
    if (b.ruined) return { txt: '🏚️ Ruine', cls: 'ruin' };
    if (b.fire > 0.05) return { txt: '🔥 brennt', cls: 'fire' };
    if (b.build < 1) return { txt: '🔨 im Bau ' + Math.round(b.build * 100) + ' %', cls: 'build' };
    const slots = SLOTS[b.kind];
    if (slots && pausedNow(b)) return { txt: '💤 ruht – die Arbeiter sind frei', cls: 'rest' };
    if (slots && b.full) return { txt: '📦 Lager voll – die Arbeiter sind frei', cls: 'rest' };   // the screen's 13th board field = 2: the store of its good is full
    if (b.kind === 'holzfaeller' && b.noWood) return { txt: '🌲 kein Wald in Reichweite', cls: 'wait' };
    if (slots) {
      if (b.workers == null) return { txt: '✔ fertig', cls: 'work' };
      if (b.workers >= slots) return { txt: '⚙️ arbeitet', cls: 'work' };
      if (b.workers > 0) return { txt: '⚙️ arbeitet · ' + b.workers + ' von ' + slots, cls: 'work' };
      return { txt: '⏳ wartet auf Arbeiter', cls: 'wait' };
    }
    if (b.kind === 'kaserne' || b.kind === 'soeldnerlager') {   // the queue entries of the units this house trains
      const q = (st.you && Array.isArray(st.you.queue) ? st.you.queue : []).filter((e) => e && TRAINER_OF[Array.isArray(e) ? e[0] : e.unit] === b.kind).length;
      return q ? { txt: (b.kind === 'kaserne' ? '⚔️' : '⛺') + ' bildet aus · ' + q, cls: 'work' } : { txt: '✔ bereit', cls: 'work' };
    }
    return { txt: '✔ fertig', cls: 'work' };
  }
  // archer slots of a building (the catalog's numbers: a Mauer has `slots` per cell, a Torhaus 4, a Wachturm 3); 0 = nothing can be garrisoned
  const garSlots = (b) => { const B = FurtWorld.BUILDINGS[b.kind]; return B && B.slots ? B.slots * (B.wall ? Math.max(1, b.len | 0) : 1) : 0; };
  function openCard(b) {
    cancelPlace(); st.card = b.id; st.cardArm = 0;
    $('ffPanel').classList.add('card'); if (map) map.setSelected(b.id);
    renderCard(); renderCover(); vib(8);
  }
  function closeCard() {
    if (st.card == null) return;
    st.card = null; st.cardArm = 0; $('ffPanel').classList.remove('card'); if (map) map.setSelected(null);
    renderCover();
  }
  function renderCard() {
    if (st.card == null) return;
    if (st.card === KEEP) { renderKeepCard(); return; }
    const b = st.byId[st.card];
    if (!b || b.lord !== st.lord) { closeCard(); return; }
    const B = FurtWorld.BUILDINGS[b.kind]; if (!B) { closeCard(); return; }
    $('ffCHp').hidden = false; $('ffCardLager').hidden = true; renderCardCover(b);
    const hp = b.ruined ? 0 : Math.max(0, Math.min(1, b.hp == null ? 1 : b.hp)), s = cardState(b), arm = st.cardArm && nowMs() < st.cardArm;
    $('ffCIc').textContent = B.icon; $('ffCNm').textContent = B.name; $('ffCSz').textContent = (B.wall ? (b.len | 0 || 1) + (b.len > 1 ? ' Felder lang' : ' Feld') : B.size[0] + '×' + B.size[1]) + (B.mat === 'holz' ? ' · Holz, brennbar' : ' · Stein, feuerfest');
    const slots = garSlots(b), gar = $('ffCGar');   // 🏹 2 / 4 besetzt: the archers inside (the 15th board field) of the slots this building has
    if (slots && !b.ruined && b.build >= 1) {
      const n = Math.min(b.garrison | 0, slots), key = n + '/' + slots; gar.hidden = false; gar.className = n >= slots ? 'full' : n > 0 ? 'some' : '';
      if (gar.dataset.k !== key) { gar.dataset.k = key; gar.textContent = '🏹 ' + n + ' / ' + slots + ' besetzt'; if (!n) gar.appendChild(el('small', '', 'Schick eine Fahne mit 🏹 Bogenschützen hierher: tippen oder hinziehen.')); }
    } else gar.hidden = true;
    $('ffCardMarkt').hidden = !(b.kind === 'markt' && !b.ruined && b.build >= 1);
    const u = $('ffCHpU'); u.style.width = Math.round(hp * 100) + '%'; u.style.background = hp > 0.5 ? '#5cc24a' : hp > 0.25 ? '#e6b830' : '#d6382a';
    $('ffCHpT').textContent = Math.round(hp * 100) + ' %';
    const sEl = $('ffCState'); sEl.textContent = s.txt; sEl.className = s.cls;
    const I = INFO[b.kind] || {}; $('ffCWozu').textContent = I.wozu || ''; $('ffCWohin').textContent = I.wohin || ''; $('ffCViele').textContent = I.viele || '';
    $('ffCRowWohin').hidden = $('ffCRowViele').hidden = !!b.ruined;   // a ruin keeps only its Wozu
    const pz = $('ffCPause'), rest = !!SLOTS[b.kind] && !b.ruined && b.build >= 1 && pausedNow(b);
    pz.hidden = !(SLOTS[b.kind] && !b.ruined && b.build >= 1); pz.classList.toggle('go', rest); pz.textContent = rest ? '▶ Weiterarbeiten' : '💤 Ruhen lassen';
    const site = !b.ruined && b.build < 1, ask = $('ffCAsk');
    const cost = $('ffCCost'); cost.innerHTML = '';
    if (b.ruined) { cost.appendChild(el('span', '', 'Wiederaufbau kostet nur ½:')); const c = el('span'); c.style.display = 'contents'; cost.appendChild(c); costChips(c, halfCost(b.kind, b.len)); }
    const rb = $('ffCardRebuild'), cl = $('ffCardClear'), dm = $('ffCardDemolish'), cf = $('ffCConfirm');
    rb.hidden = !b.ruined; cl.hidden = !b.ruined;
    dm.hidden = !!b.ruined || arm; cf.hidden = !arm;
    ask.hidden = !arm;
    dm.textContent = site ? '↩️ Baustelle abbrechen' : '🔨 Abreißen';
    ask.textContent = site ? 'Baustelle wirklich abbrechen? Das Material kommt zurück.' : 'Wirklich abreißen? Dafür gibt es nichts zurück.';
    $('ffCardConfirm').textContent = site ? '✔ Ja, abbrechen' : '✔ Ja, abreißen';
    if (b.ruined) rb.classList.toggle('dim', affordance(halfCost(b.kind, b.len)).length > 0);
  }
  $('ffCClose').addEventListener('click', closeCard);
  $('ffCardLager').addEventListener('click', () => { closeCard(); openLager('lager'); });
  $('ffCardMarkt').addEventListener('click', () => { closeCard(); openLager('markt'); });
  $('ffCPause').addEventListener('click', () => {
    const b = st.byId[st.card]; if (!b || !SLOTS[b.kind] || b.ruined || b.build < 1) return;
    const on = !pausedNow(b);
    send({ t: 'ffPause', id: b.id, on }); vib(on ? 18 : 12);
    st.pauseWant[b.id] = { on, until: nowMs() + 1800 }; b.paused = on; if (map) map.dirty = true;   // the map shows the badge at once
    renderCard(); renderTip();
  });
  $('ffCardDemolish').addEventListener('click', () => { st.cardArm = nowMs() + 6000; renderCard(); vib(10); });
  $('ffCardKeep').addEventListener('click', () => { st.cardArm = 0; renderCard(); });
  $('ffCardConfirm').addEventListener('click', () => {
    const b = st.byId[st.card]; if (!b) return closeCard();
    send({ t: 'ffCancel', id: b.id }); vib([40, 30, 80]); toast(b.build < 1 && !b.ruined ? '↩️ Baustelle abgebrochen' : '🔨 Wird abgerissen'); closeCard();
  });
  $('ffCardClear').addEventListener('click', () => {
    const b = st.byId[st.card]; if (!b) return closeCard();
    send({ t: 'ffCancel', id: b.id }); vib(25); toast('🧹 Die Ruine wird geräumt'); closeCard();
  });
  $('ffCardRebuild').addEventListener('click', () => {
    const b = st.byId[st.card]; if (!b) return closeCard();
    const miss = affordance(halfCost(b.kind, b.len));
    if (miss.length) { vib(30); toast('❌ ' + missText(miss)); return; }
    const m = { t: 'ffBuild', kind: b.kind, i: b.i, j: b.j, rot: b.rot | 0 }; if (isWallKind(b.kind)) m.len = b.len | 0 || 1;   // a wall ruin is rebuilt only with its own length
    send(m); vib(25); toast('♻️ Wiederaufbau für ½'); closeCard();
  });

  // ---------- modes ----------
  function setMode(m, silent) {
    if (m === 'pakte' && !pactsOn()) m = 'bauen';
    st.mode = m; root.dataset.mode = m;
    MODES.forEach((k) => { $('ffMode-' + k).classList.toggle('on', k === m); $(PANELS[k]).classList.toggle('on', k === m); });
    if (m !== 'bauen' && st.sel) cancelPlace();
    if (m !== 'banner' && st.arm) { st.arm = 0; if (map) map.setArm(0); }
    closeCard();
    if (!map) return;
    map.setTool(m === 'banner' ? 'banner' : (m === 'bauen' && st.sel ? 'ghost' : null));
    if (!silent) map.view(m === 'bauen' ? 'mine' : 'all');
    if (m === 'truppen') renderTroops();
    if (m === 'banner') renderBans();
    if (m === 'pakte') renderPacts(); else updateOffer();
  }
  MODES.forEach((m) => $('ffMode-' + m).addEventListener('click', () => { setMode(m); vib(8); }));
  $('ffZ-mine').addEventListener('click', () => { if (map) map.view('mine'); });
  $('ffZ-all').addEventListener('click', () => { if (map) map.view('all'); });
  function renderZoom(name) { $('ffZ-mine').classList.toggle('on', name === 'mine'); $('ffZ-all').classList.toggle('on', name === 'all'); }

  // ---------- map events ----------
  const MXc = (b) => -72 + b.i + FurtWorld.footprintOf(b.kind, b.rot | 0, b.len)[0] / 2, MYc = (b) => -45 + b.j + FurtWorld.footprintOf(b.kind, b.rot | 0, b.len)[1] / 2;
  function onTap(p) {
    if (st.mode === 'banner' && !isSpec()) {   // ⚑: tap a banner (on its chip or on the map), then the target
      if (p.banner && p.banner.own) { closeCard(); armBanner(p.banner.n); return; }
      if (st.arm) { const n = st.arm; st.arm = 0; map.setArm(0); closeCard(); map.sendBanner(n, p.x, p.y); renderBans(); return; }
    }
    if (p.banner && !p.banner.own) { const l = st.lords[p.banner.lord]; closeCard(); map.callout(p.banner.x, p.banner.y - 1, '⚑ ' + (houseName(l) || 'Feind') + ' · ' + p.banner.count + ' Mann', 2400); return; }
    const own = (b) => b && b.lord === st.lord && !isSpec(), cand = [];
    if (p.building) cand.push({ k: 'b', d: p.dBuilding - (own(p.building) ? 0.5 : 0) });   // the nearest thing wins; an own building wins ties
    if (p.crossing) cand.push({ k: 'c', d: p.dCrossing });
    if (p.site) cand.push({ k: 's', d: p.dSite });
    if (!cand.length) { closeCard(); return; }
    cand.sort((a, b) => a.d - b.d);
    const w = cand[0].k;
    if (w === 'b') {
      const b = p.building;
      if (own(b)) { openCard(b); return; }
      closeCard();
      const B = FurtWorld.BUILDINGS[b.kind], l = st.lords[b.lord];
      map.callout(MXc(b), MYc(b), B.icon + ' ' + B.name + ' · ' + (houseName(l) || 'Feind') + (b.ruined ? ' · Ruine' : b.fire > 0.05 ? ' · 🔥' : ''), 2600);
    } else if (w === 'c') {
      closeCard();
      const c = p.crossing, ic = c.kind === 'furt' ? '🌊' : c.kind === 'steg' ? '🪵' : '🌉', open = st.L <= c.open + 1e-9;
      map.callout(c.x, c.y, ic + ' ' + c.name + (open ? ' · offen' : ' · überflutet'), 2800);
    } else if (!isSpec() && p.site.s === st.site) openKeepCard();   // the own castle has a card (Burgbrunnen, stores)
    else {
      closeCard();
      const l = st.lords.find((q) => q && q.site === p.site.s);
      map.callout(p.site.x, p.site.y - 3, '🏰 ' + (l && l.name ? houseName(l) : p.site.name), 2600);
    }
  }
  function onBannerDrop(d) {
    send({ t: 'ffBanner', n: d.n, x: d.x, y: d.y }); vib(20); st.ordered = true;
    if (st.arm === d.n) { st.arm = 0; if (map) map.setArm(0); }
    const real = !!(st.ownBanners[d.n] || (st.youBanners[d.n] && st.youBanners[d.n].count)), gar = d.snap && d.snap.kind === 'garrison';   // gar: dropped on (or within 1 of) an own Mauer, Torhaus or Wachturm
    if (!d.route) toast(st.L > 0.55 ? '🌊 Hochwasser – die Fahne wartet am Ufer' : '✖ Kein Weg – die Fahne wartet');
    else if (!real) toast('📍 Sammelpunkt für Fahne ' + ROMAN[d.n] + ' gesetzt');
    else if (gar) toast('🏹 Bogenschützen besetzen ' + (GAR_WHAT[d.snap.bkind] || 'das Gebäude'));
    else toast('⚑ ' + ROMAN[d.n] + (d.snap ? ' → ' + d.snap.name : ' marschiert los'));
    renderBans();
  }

  // ---------- start once the seat and the map are known ----------
  const mapLords = () => st.lords.map((l) => l ? Object.assign({}, l, { name: houseName(l) }) : l);   // castle labels on the map: the house, not "· Anna & Ben"
  function tryStart() {
    if (map || !st.info || !st.mapMsg) return;
    if (!window.FurtWorld || !window.FurtWarmap) { $('ffWait').firstChild.textContent = '⚠️ world.js oder warmap.js fehlt'; return; }
    let grid;
    try { grid = FurtWorld.decode(st.mapMsg.grid); } catch (e) { $('ffWait').firstChild.textContent = '⚠️ Karte kaputt'; return; }
    const spec = isSpec();
    grid.crossings = st.mapMsg.crossings; st.grid = grid; st.sites = st.mapMsg.sites || []; st.crossings = st.mapMsg.crossings || [];
    takeCosts(st.mapMsg.costs);
    const l = st.lords[st.lord]; st.site = spec ? null : l && l.site != null ? l.site : st.lord;
    const r = wrap.getBoundingClientRect();
    cv.style.width = '100%'; cv.style.height = '100%';
    map = new FurtWarmap(cv, { grid, sites: st.sites, crossings: st.crossings, me: spec ? -1 : st.lord, lords: mapLords(), still: STILL });
    map.resize(r.width || 400, r.height || 300);
    map.on('tap', onTap); map.on('bannerDrop', onBannerDrop); map.on('view', renderZoom);
    map.on('ghostMove', updatePlaceUI); map.on('ghostEnd', updatePlaceUI); map.on('wallMove', updateWallUI); map.on('wallEnd', updateWallUI);
    map.setLevel(st.L);
    if (st.boardMsg) { const bm = st.boardMsg; st.boardMsg = null; applyBoard(bm); }   // a board that arrived before the map (once)
    if (spec) { map.view('all', true); renderZoom('all'); renderSpec(); }
    else {
      buildCards(); buildTroops(); buildBans(); buildPactRows(); renderPacts();
      map.selPin = st.target;
      setMode(st.mode, true); map.view(st.mode === 'bauen' ? 'mine' : 'all', true); renderZoom(map.viewName);
    }
    renderCover();
    $('ffWait').classList.remove('show');
    if (window.ResizeObserver && !ro) { ro = new ResizeObserver(() => fit()); ro.observe(wrap); }
    map.render(performance.now());
    startLoop();
  }
  function fit() { if (lagerOpen()) placeLager(); if (!map) return; const r = wrap.getBoundingClientRect(); if (r.width > 10 && r.height > 10) { map.resize(r.width, r.height); map.render(performance.now()); } }   // resizing clears the canvas: draw it again right away
  window.addEventListener('resize', fit); window.addEventListener('orientationchange', () => setTimeout(fit, 80));
  function loop(t) {
    raf = 0;
    if (!map || !root.classList.contains('on')) return;
    if (!$('ffGuide').classList.contains('show')) map.render(t);
    raf = requestAnimationFrame(loop);
  }
  function startLoop() { if (!raf && map) raf = requestAnimationFrame(loop); }
  // a slow clock for everything that counts down: the phase chip, the pact timers, the offer prompt
  function tick() {
    if (!root.classList.contains('on')) { clearInterval(tickT); tickT = 0; return; }
    renderPhase(); renderTip(); renderLager();
    if (pactsOn()) renderPacts();
    if (st.card != null && st.cardArm && nowMs() >= st.cardArm) { st.cardArm = 0; renderCard(); }   // an unanswered „Wirklich abreißen?“ expires
    for (const id in st.pauseWant) if (nowMs() >= st.pauseWant[id].until) {   // a pause the screen never confirmed: back to what the board says
      delete st.pauseWant[id]; const b = st.byId[id]; if (b && map) { b.paused = !!b.truth; map.dirty = true; } if (st.card == +id) renderCard();
    }
  }
  function startTick() { if (!tickT) tickT = setInterval(tick, 250); }
  function renderSpec() {   // spectators: the list of houses beside / below the live map
    const box = $('ffSpecL'); box.innerHTML = '';
    st.lords.forEach((l) => {
      if (!l) return;
      const row = el('div', 'ff-spl'); row.style.setProperty('--hc', l.color || '#8a7656');
      const nm = el('span', 'nm'); nm.appendChild(document.createTextNode(houseName(l))); const sm = el('small', '', playerNames(l)); if (sm.textContent) nm.appendChild(sm);
      row.appendChild(el('i', 'dot')); row.appendChild(nm); box.appendChild(row);
    });
  }

  // ---------- end view ----------
  function renderEnd() {
    const r = st.result; if (!r) return;
    const rows = r.ranking.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99)), win = rows[0], spec = isSpec();
    const mine = spec ? null : rows.find((x) => x.lord === st.lord) || (r.you && r.you.lord === st.lord ? r.you : null);
    const wl = win ? st.lords[win.lord] : null, wn = houseName(wl) || 'Ein Haus';
    if (mine && win && mine.lord === win.lord) { $('ffEndT').textContent = '🏆 Sieg für dein Haus!'; $('ffEndS').textContent = 'Das berühmteste Haus im Tal · ⭐ ' + (mine.ruhm | 0) + ' Ruhm'; }
    else if (mine) { const rk = (mine.rank | 0) || rows.indexOf(mine) + 1; $('ffEndT').textContent = '🏁 ' + wn + ' gewinnt'; $('ffEndS').textContent = 'Dein Haus wird ' + (['Erster', 'Zweiter', 'Dritter', 'Vierter'][rk - 1] || rk + '.') + ' · ⭐ ' + (mine.ruhm | 0) + ' Ruhm'; }
    else { $('ffEndT').textContent = '🏁 ' + wn + ' gewinnt'; $('ffEndS').textContent = win ? 'Mit ⭐ ' + (win.ruhm | 0) + ' Ruhm.' : ''; }
    const box = $('ffRank'); box.innerHTML = '';
    rows.forEach((x, k) => {
      const l = st.lords[x.lord], row = el('div', 'rk' + (k === 0 ? ' win' : '') + (!spec && x.lord === st.lord ? ' me' : ''));
      row.style.setProperty('--hc', (l && l.color) || '#8a7656');
      const nm = el('span', 'nm'); nm.appendChild(document.createTextNode(houseName(l) || 'Haus ' + (x.lord + 1))); const pn = playerNames(l); if (pn) nm.appendChild(el('small', '', pn));
      row.appendChild(el('b', 'no', ['🥇', '🥈', '🥉'][k] || (k + 1) + '.')); row.appendChild(el('i', 'dot')); row.appendChild(nm);
      if (!spec && x.lord === st.lord) row.appendChild(el('span', 'you', 'DU'));
      row.appendChild(el('span', 'sc', '⭐ ' + (x.ruhm | 0)));
      box.appendChild(row);
    });
    const stats = $('ffStats'); stats.innerHTML = '';
    $('ffEndH').style.display = mine ? '' : 'none';
    if (mine) {
      const s = mine.stats || {}, tiles = [['⭐', 'Ruhm', mine.ruhm, 1], ['⚔️', 'Besiegte', s.kills, 1], ['💥', 'Zerstört', s.razed, 0], ['🏗️', 'Gebaut', s.built, 1], ['🔥', 'Brände gelegt', s.ignites, 0],
        ['🏰', 'Plünderungen', s.plunders, 0], ['🤝', 'Pakte', s.pacts, 0], ['🗡️', 'Verrat', s.betrayals, 0], ['👥', 'Volk', mine.people, 0]];
      tiles.forEach((t) => { if (t[2] == null || (!t[3] && !t[2])) return; const d = el('div'); d.appendChild(el('b', '', t[0] + ' ' + Math.round(t[2]))); d.appendChild(document.createTextNode(t[1])); stats.appendChild(d); });
    }
    $('ffAgain').style.display = st.host ? 'block' : 'none'; $('ffWaitHost').style.display = st.host ? 'none' : 'block';
  }
  $('ffAgain').addEventListener('click', () => { if (st.host) { send({ t: 'ffAgain' }); vib(30); } });
  function showEnd(d) {
    const rk = Array.isArray(d.ranking) ? d.ranking.filter((x) => x && typeof x === 'object') : [];
    st.result = { ranking: rk, you: d.you && typeof d.you === 'object' ? d.you : null };
    st.phase = 'over'; cancelPlace(); closeCard(); closeLager(false); alertHide(); st.card = null;
    renderEnd(); renderTop();
    $('ffEnd').classList.add('show'); $('ffEnd').scrollTop = 0;
  }
  function newMatch() {   // a new ffMap or ffPhase after the end: the rematch started
    st.result = null; st.phase = null; st.pacts = []; st.you = null; st.bld = []; st.byId = {}; st.ownBanners = {}; st.youBanners = {}; st.haveYouBanners = false; st.busy = {}; st.snooze = {}; st.breaking = null;
    st.lastBuzz = false; st.warned = false; st.lastFlag = false; st.endsAt = 0; st.clock = null; st.hungerUntil = 0; st.boardMsg = null;
    st.arm = 0; st.ordered = false; st.recruited = false; st.pauseWant = {}; st.tipSnooze = {}; st.hofSince = null; st.tip = null; st.rams = 0; if (map) map.setArm(0);
    $('ffEnd').classList.remove('show'); closeCard(); alertHide(); if (map) map.setBoard({ buildings: [], banners: [], fires: [] });
    renderTop(); renderPacts();
  }

  // ---------- messages from the screen ----------
  function applyBoard(d) {
    if (!map) { st.boardMsg = d; return; }
    const blds = (d.b || []).map((a) => ({ id: a[0], lord: a[1], kind: a[2], i: a[3], j: a[4], rot: a[5], build: a[6], hp: a[7], fire: a[8], ruined: (a.length > 9 ? a[9] : a[7] <= 0 && a[6] >= 1) ? 1 : 0,   // without the 10th field a finished building at 0 HP is a ruin
                                          noWood: !!a[10], workers: a.length > 11 && typeof a[11] === 'number' ? a[11] : null,
                                          truth: a.length > 12 && a[12] === 1, paused: a.length > 12 && a[12] === 1, full: a.length > 12 && a[12] === 2,   // the 13th field: 1 rests by order (💤), 2 rests because its store is full (older screens: never)
                                          len: a.length > 13 && a[13] >= 1 ? a[13] | 0 : 1, garrison: a.length > 14 && a[14] > 0 ? a[14] | 0 : 0 }));   // Phase 2: the 14th field is the length of a wall piece, the 15th the archers inside (shorter rows: 1 and 0)
    const bans = (d.banners || []).map((a) => ({ lord: a[0], n: a[1], x: a[2], y: a[3], count: a[4] }));
    st.ownBanners = {}; bans.forEach((b) => { if (b.lord === st.lord) st.ownBanners[b.n] = b; });
    for (const b of blds) { const w = st.pauseWant[b.id]; if (!w) continue; if (b.truth === w.on) delete st.pauseWant[b.id]; else if (nowMs() < w.until) b.paused = w.on; else delete st.pauseWant[b.id]; }   // the tap shows until the screen confirms it
    st.bld = blds; st.byId = {}; blds.forEach((b) => { st.byId[b.id] = b; });
    const hof = blds.some((b) => b.lord === st.lord && b.kind === 'hof' && !b.ruined && b.build >= 1);   // since when a finished Hof stands (the advisor waits 90 s before it trusts the food balance)
    if (hof && st.hofSince == null) st.hofSince = nowMs(); else if (!hof) st.hofSince = null;
    map.setBoard({ buildings: blds, banners: bans, fires: [] });
    if (st.mode === 'banner' || st.mode === 'truppen') renderBans();
    if (st.mode === 'truppen') renderTroops();
    refreshPlaceUI();
    if (st.card != null) renderCard();
    renderTip(); renderLager();
  }
  function lordsKey(ls) { return JSON.stringify(ls.map((x) => x ? [x.i, x.site, x.color, x.name, x.bot ? 1 : 0] : 0)); }
  registerGame({ key: 'furtfehde', controller: {
    activate() {
      reset();
      showView('furtfehde');
      startLoop(); startTick();
    },
    onMessage(d) {
      switch (d.t) {
        case 'ffInfo': {
          const wasSpec = isSpec(), wasLord = st.lord, hadInfo = st.info;
          st.info = true; st.lord = typeof d.lord === 'number' ? d.lord : null; st.lords = Array.isArray(d.lords) ? d.lords : []; st.shared = sharedName(d.shared); takeCosts(d.costs); st.rules = rulesFrom(d.rules);
          if (typeof d.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(d.color)) {
            st.color = d.color; root.style.setProperty('--c', d.color);
            const n = parseInt(d.color.slice(1, 7), 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
            root.style.setProperty('--ct', lum > 0.62 ? '#2b1d0e' : '#fff');   // text on the lord's colour
          }
          st.host = !!d.host; myHost = st.host; updateAbort(); root.classList.toggle('host', st.host);
          root.classList.toggle('spec', isSpec());
          if (map && (hadInfo && (wasSpec !== isSpec() || wasLord !== st.lord))) {   // another seat (a spectator got a house, or the other way round): start the map afresh
            map.dispose(); map = null; cancelAnimationFrame(raf); raf = 0; st.sel = null; $('ffPBau').classList.remove('placing'); root.classList.remove('placing'); closeCard();
          } else if (map) {
            const l = st.lords[st.lord], key = lordsKey(st.lords); st.site = l && l.site != null ? l.site : st.lord;
            if (key !== st.lordsKey) { map.setLords(mapLords(), isSpec() ? -1 : st.lord); if (st.sel) cancelPlace(); map.view(map.viewName, true); }
          }
          if (map && isSpec()) renderSpec();
          if (!isSpec() && (st.lordsKey !== lordsKey(st.lords) || !$('ffPacts').children.length)) buildPactRows();
          st.lordsKey = lordsKey(st.lords);
          renderTop(); renderPacts(); if (st.result) renderEnd(); tryStart(); renderCover(); refreshPlaceUI();
          break;
        }
        case 'ffMap':
          if (st.result || st.phase === 'over') newMatch();
          st.mapMsg = d; if (map) { map.dispose(); map = null; cancelAnimationFrame(raf); raf = 0; closeCard(); } tryStart(); break;
        case 'ffLevel': {
          st.L = Math.max(0, Math.min(1, +d.L || 0));
          if (map) map.setLevel(st.L);
          renderTop();
          refreshPlaceUI();
          break;
        }
        case 'ffPhase': {
          if (typeof d.phase !== 'string') break;
          const ph = d.phase === 'letzte' || d.phase === 'lastMinute' ? 'fehde' : d.phase;
          if (st.phase === 'over' && ph !== 'over' && st.result) newMatch();   // a phase after the end: the rematch has started
          st.phase = ph; st.lastFlag = d.phase === 'letzte' || d.phase === 'lastMinute' || d.last === true;
          if (typeof d.endsAt === 'number') st.endsAt = d.endsAt;
          setClock(typeof d.now === 'number' ? d.now : d.simT);
          renderTop(); renderPacts();
          break;
        }
        case 'ffYou': {
          st.you = { stock: d.stock || {}, cap: d.cap || {}, pop: d.pop, popCap: d.popCap, idle: d.idle, hunger: !!d.hunger, queue: d.queue || [], ruhm: d.ruhm, crown: !!d.crown,
                     food: d.food && typeof d.food === 'object' && isFinite(d.food.prod) && isFinite(d.food.eat) ? { prod: +d.food.prod, eat: +d.food.eat } : null };   // {prod, eat}: sacks per minute (R9); older screens do not send it
          if (d.hunger) st.hungerUntil = nowMs() + 4000;
          if (st.you.queue.some((e) => e && (Array.isArray(e) ? e[0] : e.unit) === 'ramme')) st.rams = Math.max(st.rams, 1);   // a ram in the queue counts as ordered (advisor tip 13)
          st.pacts = Array.isArray(d.pacts) ? d.pacts.filter((p) => p && typeof p.with === 'number') : [];
          for (const k in st.busy) if (nowMs() > st.busy[k] - 900) delete st.busy[k];   // a tapped row stays dimmed for ≥ 0.6 s, so a stale update cannot flash the old buttons
          if (typeof d.now === 'number') setClock(d.now);
          st.haveYouBanners = Array.isArray(d.banners); st.youBanners = {};
          if (st.haveYouBanners) d.banners.forEach((b) => {   // the sim's own view of its banners: the Burgwache (n 0) and the real targets (a snapped order ends elsewhere than it was dropped)
            if (!b || typeof b.n !== 'number') return;
            st.youBanners[b.n] = b;
            if (map && b.n >= 1 && b.n <= 3 && isFinite(b.tx) && isFinite(b.ty) && isFinite(b.x) && isFinite(b.y) && Math.hypot(b.tx - b.x, b.ty - b.y) > 2.2) { map.setOrder(b.n, b.tx, b.ty); st.ordered = true; }
          });
          renderTop(); renderPacts(); if (map) { renderCards(); renderTroops(); renderBans(); if (st.card != null) renderCard(); }
          break;
        }
        case 'ffBoard': applyBoard(d); break;
        case 'ffAlert': alertShow(d.kind, d.text, d.x, d.y); break;
        case 'ffResult': showEnd(d); break;
        case 'ffToast': if (d.text) toast(d.text); break;
      }
    }
  } });
  // dev hooks for the harness (dev-furtfehde-phone.html): the map, the state, a forced redraw
  window.__ff = { get map() { return map; }, get st() { return st; }, send, toast, openCard, closeCard, openKeepCard, openGuide, closeGuide, openLager, closeLager, renderLager, armBanner, renderTip, tipCtx, pausedNow, INFO, GUIDE, TIPS, selectKind,
    openMarkt() { openLager('markt'); }, longPress(good, side) { tradeTap(good, side, true); }, get longMs() { return LONG_MS; }, tradeCalc, wallPlan, TRAINERS,   // the Markt sheet; a long press without waiting for the timer
    get seen() { return guideSeen; }, set seen(v) { guideSeen = !!v; renderHelp(); },   // has the guide been opened on this device (the ❓ pulses until it has)
    get ignorePop() { return ignorePop; }, set ignorePop(v) { ignorePop = v | 0; },   // the synchronous autotest cannot wait for the late popstate of a ✕ (history.back): it clears this before it fakes a back gesture
    advice(n) { st.forceTip = n | 0; renderTip(); },   // ?advice=n: show tip n whatever the state says (0 = back to the real ones)
    draw() { if (map) { map.dirty = true; map.render(performance.now()); } } };
})();
