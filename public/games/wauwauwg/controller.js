// Wauwau-WG phone: your dog up close. Tierheim → Zuhause (care, shop, bag,
// night summary) → Gassi (leash pad) → Park (throw pad). The screen is
// authoritative: this file draws, turns gestures into messages and persists
// every wwYou record. Protocol + views: docs/WAUWAUWG.md
(function () {
  'use strict';
  const KEY = 'wauwauwg.dog';
  const STROKE_PX = 60;                    // rubbing distance per counted pet/brush stroke
  const CARE_GAP_MS = 250;                 // ≤ 4 counted strokes per second
  const MOVE_EPS = 0.08, MOVE_GAP_MS = 50, DEADZONE = 0.12;   // leash pad
  const DIG_GAP_MS = 80;
  const PARK_GUARD_S = 24;                 // the TV frees a toy after 18 s at the latest; if its wwPark never comes, throw again
  const HELLO_RETRY_MS = 2500;
  const BATH_FOAM = 0.7, BATH_RINSE = 0.1, BATH_DRY = 0.75;   // bath step goals
  const GRID_C = 12, GRID_R = 14;          // bath grid laid over the dog
  const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const TOY_ACC = { ball: 'den Ball', frisbee: 'das Frisbee', duck: 'die Ente', stick: 'das Stöckchen' };
  const BATH_STEPS = ['🧴 1/3 Einschäumen', '🚿 2/3 Abduschen', '🧺 3/3 Abtrocknen'];
  const BRUSH_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="10.2" y="1.5" width="3.6" height="11.5" rx="1.8" fill="#d9984f"/><rect x="4.5" y="11.5" width="15" height="5.5" rx="2.4" fill="#8a5530"/><g stroke="#f6e7cf" stroke-width="1.7" stroke-linecap="round"><line x1="6.5" y1="17.8" x2="6.5" y2="21.4"/><line x1="9.3" y1="17.8" x2="9.3" y2="22"/><line x1="12" y1="17.8" x2="12" y2="22.3"/><line x1="14.7" y1="17.8" x2="14.7" y2="22"/><line x1="17.5" y1="17.8" x2="17.5" y2="21.4"/></g></svg>';

  document.body.insertAdjacentHTML('beforeend', `
<style>
  .ww { color:#fff; position:relative; overflow:hidden;
        background:radial-gradient(130% 70% at 50% -10%, #4a2f52 0%, #241a2c 55%, #17121d 100%); }
  .ww .bar { padding:10px 12px 4px; min-height:46px; box-sizing:border-box; }
  .ww .bar .word { font-size:20px; line-height:1.15; min-width:0; overflow:hidden; overflow-wrap:anywhere;
                   display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
  body.ww-host .ww .bar { padding-right:136px; }
  .ww canvas { margin:0; border-radius:0; background:transparent; flex:none; display:block; touch-action:none; }
  .ww canvas.ww-fill { position:absolute; left:0; top:0; width:100%; height:100%; }
  .ww canvas.ww-mini { width:112px; height:112px; border-radius:24px; background:radial-gradient(circle at 50% 40%, #ffe7c7, #f2c08e); }
  .ww-title { display:flex; align-items:center; gap:8px; min-width:0; flex:1; }
  .ww-name { font-size:21px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  .ww-pill { display:inline-flex; align-items:center; gap:4px; padding:6px 11px; border-radius:999px; background:rgba(255,255,255,.1);
             font-weight:800; font-size:15px; white-space:nowrap; flex:none; }
  .ww-pill.gold { background:linear-gradient(180deg,#ffd66b,#f5a937); color:#3a2208; }
  .ww-pill.bump { animation:wwBump .35s; }
  @keyframes wwBump { 40% { transform:scale(1.18); } }
  .ww-ib { width:42px; height:42px; flex:none; border:none; border-radius:14px; background:rgba(255,255,255,.1); color:#fff; font-size:20px; padding:0; }
  .ww-ib:active, .ww-tool:active, .ww-big:active, .ww-cta:active, .ww-act:active, .ww-price:active, .ww-toy:active, .ww-food:active, .ww-coat:active { transform:scale(.94); }
  .ww-sub { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 14px 6px; min-height:22px;
            font-size:13px; font-weight:700; color:rgba(255,255,255,.72); }
  .ww-sub > span:first-child { overflow:hidden; min-width:0; line-height:1.25; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
  .ww-hearts { letter-spacing:1px; font-size:13px; flex:none; }
  .ww-chip { border:none; border-radius:999px; padding:5px 11px; font-weight:800; font-size:12px; background:#5b4a8a; color:#fff; display:none; flex:none; }
  .ww-needs { display:grid; grid-template-columns:repeat(5,1fr); gap:9px; padding:2px 14px 10px; }
  .ww-need { display:flex; flex-direction:column; align-items:center; gap:5px; font-size:17px; line-height:1; }
  .ww-nb { width:100%; height:8px; border-radius:5px; background:rgba(255,255,255,.12); overflow:hidden; }
  .ww-nb i { display:block; height:100%; width:50%; border-radius:5px; transition:width .5s ease; }
  .ww-need.low .ww-nb i { background:#ff5a5f !important; animation:wwBlink 1s infinite; }
  .ww-need.low .ww-ni { animation:wwHop .8s infinite; }
  @keyframes wwBlink { 50% { opacity:.35; } }
  @keyframes wwHop { 50% { transform:translateY(-3px); } }
  .ww-stage { flex:1; min-height:0; position:relative; margin:0 10px; border-radius:24px; overflow:hidden; touch-action:none;
              box-shadow:0 12px 30px rgba(0,0,0,.4), inset 0 0 0 2px rgba(255,255,255,.07); background:#2a2033; }
  .ww-tools { display:flex; gap:5px; padding:10px 8px 4px; }
  .ww-tool { flex:1; min-width:0; border:none; border-radius:16px; padding:7px 0 6px; background:rgba(255,255,255,.08); color:#fff; position:relative;
             display:flex; flex-direction:column; align-items:center; gap:3px; font-size:10px; font-weight:800; transition:background .15s, transform .1s; }
  .ww-tool b { font-size:25px; line-height:26px; height:26px; display:flex; align-items:center; }
  .ww-tool span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
  .ww-tool.sel { background:linear-gradient(180deg,#ffbf69,#ff7aa2); color:#2b1020; box-shadow:0 6px 16px rgba(255,122,162,.4); }
  .ww-tool.off { opacity:.35; }
  .ww-badge { position:absolute; top:2px; right:4px; min-width:17px; height:17px; padding:0 4px; box-sizing:border-box; border-radius:9px;
              background:#fff; color:#2b1020; font-style:normal; font-size:11px; font-weight:800; line-height:17px; text-align:center; }
  .ww-badge.zero { background:#ff5a5f; color:#fff; }
  .ww-row { display:flex; gap:8px; padding:6px 10px 12px; }
  .ww-big { flex:1; border:none; border-radius:16px; padding:13px 10px; font-size:16px; font-weight:800; color:#fff; background:rgba(255,255,255,.1); transition:transform .1s; }
  .ww-big.shop { background:linear-gradient(180deg,#ffbf69,#f59a3e); color:#3a2208; }
  .ww-danger { background:rgba(255,90,95,.16); color:#ff8a8d; width:100%; margin-top:6px; }
  .ww-danger.armed { background:#ff5a5f; color:#fff; }
  .ww-cta { border:none; border-radius:18px; padding:16px; font-size:19px; font-weight:800; color:#06250f;
            background:linear-gradient(180deg,#5be39b,#25b86c); box-shadow:0 8px 22px rgba(61,220,132,.35); transition:transform .1s; }
  .ww-cta:disabled { opacity:.55; }
  .nudge { animation:wwNudge .4s; }
  @keyframes wwNudge { 20% { transform:translateX(-6px); } 40% { transform:translateX(6px); } 60% { transform:translateX(-4px); } 80% { transform:translateX(3px); } }
  .ww-dim { position:absolute; inset:0; z-index:19; background:rgba(8,6,12,.55); display:none; }
  .ww-dim.open { display:block; }
  .ww-sheet { position:absolute; left:0; right:0; bottom:0; top:12%; z-index:20; display:none; flex-direction:column; background:#261d2f;
              border-radius:26px 26px 0 0; box-shadow:0 -14px 40px rgba(0,0,0,.55); }
  .ww-sheet.open { display:flex; animation:wwUp .22s ease-out; }
  @keyframes wwUp { from { transform:translateY(60px); opacity:0; } }
  .ww-sheet-head { display:flex; align-items:center; gap:10px; padding:18px 14px 10px; font-size:20px; font-weight:800; position:relative; }
  .ww-sheet-head b { flex:1; }
  .ww-grab { position:absolute; top:7px; left:50%; width:44px; height:5px; margin-left:-22px; border-radius:3px; background:rgba(255,255,255,.2); }
  .ww-x { width:40px; height:40px; border:none; border-radius:50%; background:rgba(255,255,255,.1); color:#fff; font-size:17px; font-weight:800; flex:none; padding:0; }
  .ww-scroll { flex:1; min-height:0; overflow-y:auto; touch-action:pan-y; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; padding:2px 12px 18px;
                scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.28) transparent; }
  .ww-sec { margin:14px 4px 8px; font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,.5); }
  .ww-item { display:flex; align-items:center; gap:12px; padding:10px; border-radius:18px; background:rgba(255,255,255,.055); margin-bottom:8px; }
  .ww-item.flash { animation:wwFlash .5s; }
  @keyframes wwFlash { 30% { background:rgba(255,214,107,.35); } }
  .ww-em { width:48px; height:48px; flex:none; border-radius:15px; background:rgba(255,255,255,.08); display:flex; align-items:center; justify-content:center; font-size:27px; }
  .ww-tx { flex:1; min-width:0; }
  .ww-tx b { display:block; font-size:15px; }
  .ww-tx span { display:block; font-size:12.5px; color:rgba(255,255,255,.65); margin-top:2px; }
  .ww-price { border:none; border-radius:13px; padding:10px 12px; min-width:72px; font-weight:800; font-size:15px; color:#3a2208;
              background:linear-gradient(180deg,#ffd66b,#f5a937); flex:none; }
  .ww-price.poor { background:rgba(255,255,255,.1); color:rgba(255,255,255,.55); }
  .ww-price.owned { background:rgba(61,220,132,.16); color:#5be39b; }
  .ww-price.sell { background:linear-gradient(180deg,#8be0ff,#4fb6e8); color:#082a3a; }
  .ww-chips { display:flex; flex-wrap:wrap; gap:8px; }
  .ww-chipi { padding:8px 12px; border-radius:14px; background:rgba(255,255,255,.07); font-weight:700; font-size:14px; }
  .ww-empty { padding:14px; border-radius:16px; background:rgba(255,255,255,.04); color:rgba(255,255,255,.6); font-size:14px; text-align:center; }
  .ww-stats { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .ww-stat { padding:10px 12px; border-radius:14px; background:rgba(255,255,255,.05); font-size:12.5px; color:rgba(255,255,255,.65); }
  .ww-stat b { display:block; font-size:20px; color:#fff; }
  .ww-pop { position:absolute; left:10px; right:10px; bottom:10px; z-index:6; display:none; gap:8px; }
  .ww-pop.open { display:flex; animation:wwUp .18s ease-out; }
  .ww-food { flex:1; border:none; border-radius:18px; padding:12px 8px; background:rgba(30,22,38,.93); color:#fff; display:flex; flex-direction:column;
             align-items:center; gap:2px; font-weight:800; font-size:13px; box-shadow:0 8px 20px rgba(0,0,0,.35); }
  .ww-food b { font-size:30px; }
  .ww-food small { font-size:12px; color:#ffd66b; }
  .ww-food.empty { opacity:.5; }
  .ww-bathbar { position:absolute; left:10px; right:10px; top:10px; z-index:6; display:none; align-items:center; gap:10px; padding:7px 7px 7px 14px;
                border-radius:18px; background:rgba(18,44,66,.82); font-weight:800; font-size:14px; }
  .ww-bathbar.open { display:flex; }
  .ww-bathbar span:first-child { white-space:nowrap; }
  .ww-prog { flex:1; height:9px; border-radius:5px; background:rgba(255,255,255,.18); overflow:hidden; }
  .ww-prog i { display:block; height:100%; width:0; border-radius:5px; background:linear-gradient(90deg,#8be0ff,#ffffff); transition:width .15s; }
  .ww-card { position:absolute; inset:0; z-index:8; display:none; flex-direction:column; align-items:center; justify-content:center; gap:12px;
             padding:18px; text-align:center; background:rgba(16,12,30,.88); }
  .ww-card.open { display:flex; animation:wwFade .25s ease-out; }
  @keyframes wwFade { from { opacity:0; } }
  .ww-card .big { font-size:23px; }
  .ww-card .ww-cta, .ww-card .ww-big { width:100%; max-width:340px; flex:none; }
  .ww-nrows { width:100%; max-width:420px; display:flex; flex-direction:column; gap:6px; flex:0 1 auto; min-height:0; overflow-y:auto; touch-action:pan-y;
              scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.28) transparent; }
  .ww-nrow { flex:none; display:grid; grid-template-columns:1fr auto; gap:1px 8px; padding:9px 12px; border-radius:14px; background:rgba(255,255,255,.07); text-align:left; }
  .ww-nrow b { font-size:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ww-nrow i { font-style:normal; font-size:12px; color:rgba(255,255,255,.55); }
  .ww-nrow span { grid-row:1 / span 2; grid-column:2; align-self:center; font-weight:800; font-size:14px; white-space:nowrap; }
  .ww-nrow.you { box-shadow:inset 0 0 0 2px #ffbf69; }
  .ww-nrow.best { background:linear-gradient(90deg,rgba(255,214,107,.3),rgba(255,255,255,.06)); }
  #v-ww-adopt .ww-stage { flex:1.4; }
  .ww-nav { position:absolute; top:50%; z-index:3; width:50px; height:50px; margin-top:-25px; border:none; border-radius:50%; padding:0;
            background:rgba(255,255,255,.78); color:#7a3d1c; font-size:21px; font-weight:800; box-shadow:0 4px 12px rgba(0,0,0,.2); }
  .ww-nav.prev { left:10px; } .ww-nav.next { right:10px; }
  .ww-breed { display:flex; align-items:baseline; justify-content:center; gap:10px; padding:10px 14px 0; }
  .ww-breed b { font-size:24px; font-weight:800; }
  .ww-breed span { font-size:14px; color:rgba(255,255,255,.65); font-weight:700; }
  .ww-dots { display:flex; justify-content:center; gap:6px; padding:8px 0 4px; }
  .ww-dots i { width:7px; height:7px; border-radius:4px; background:rgba(255,255,255,.22); transition:all .2s; }
  .ww-dots i.on { width:20px; background:#ffbf69; }
  .ww-coats { display:flex; justify-content:center; gap:16px; padding:6px 0 8px; }
  .ww-coat { width:46px; height:46px; border-radius:50%; border:3px solid rgba(255,255,255,.18); padding:0; transition:transform .1s; }
  .ww-coat.sel { border-color:#fff; box-shadow:0 0 0 3px #ffbf69; }
  .ww-namebox { display:flex; gap:8px; padding:4px 14px 0; }
  .ww-namebox input { flex:1; min-width:0; max-width:none; font-size:18px; padding:13px 14px; border-radius:15px; border:none; font-weight:700;
                      -webkit-user-select:text; user-select:text; }
  #wwAdoptBtn { margin:10px 14px 14px; }
  .ww-actions { display:flex; gap:8px; padding:10px 10px 14px; }
  .ww-act { flex:1; position:relative; overflow:hidden; border:none; border-radius:18px; padding:15px 6px; font-size:16px; font-weight:800; color:#fff;
            background:rgba(255,255,255,.07); opacity:.42; transition:opacity .2s, transform .1s; }
  .ww-act.on { opacity:1; }
  #wwDigBtn { flex:1.5; }
  #wwDigBtn.on { background:linear-gradient(180deg,#d9984f,#a8682f); animation:wwPulse .9s infinite; }
  #wwPoopBtn.on { background:linear-gradient(180deg,#9b7a5f,#6f513a); animation:wwWiggle .5s infinite; }
  #wwHeelBtn.on { background:linear-gradient(180deg,#ff7a6e,#e0464f); animation:wwPulse .7s infinite; }
  @keyframes wwPulse { 50% { transform:scale(1.04); } }
  @keyframes wwWiggle { 25% { transform:rotate(-3deg); } 75% { transform:rotate(3deg); } }
  #wwDigProg { position:absolute; left:0; bottom:0; height:5px; width:0; background:#fff3c4; transition:width .12s; }
  .ww-find { position:absolute; left:50%; top:50%; z-index:5; width:76%; max-width:300px; padding:18px 14px; box-sizing:border-box; border-radius:24px;
             text-align:center; pointer-events:none; background:rgba(255,250,240,.97); color:#3a2208; font-weight:800; font-size:16px;
             box-shadow:0 14px 34px rgba(0,0,0,.35); transform:translate(-50%,-50%) scale(.6); opacity:0;
             transition:transform .28s cubic-bezier(.2,1.6,.4,1), opacity .2s; }
  .ww-find.show { transform:translate(-50%,-50%) scale(1); opacity:1; }
  .ww-find.rare { background:linear-gradient(180deg,#fff6c9,#ffd66b); box-shadow:0 0 0 4px #fff3c4, 0 14px 40px rgba(255,200,60,.55); }
  .ww-find .em { font-size:58px; line-height:1.15; }
  .ww-find small { display:block; margin-top:4px; font-size:12px; color:#a0602a; }
  .ww-toys { display:flex; gap:8px; padding:10px 10px 14px; overflow-x:auto; touch-action:pan-x; }
  .ww-toy { flex:1; min-width:74px; border:none; border-radius:16px; padding:9px 6px; background:rgba(255,255,255,.08); color:#fff; font-weight:800; font-size:12px;
            display:flex; flex-direction:column; align-items:center; gap:2px; }
  .ww-toy b { font-size:26px; }
  .ww-toy.sel { background:linear-gradient(180deg,#8be0ff,#4fb6e8); color:#082a3a; }
  .ww-toy:disabled { opacity:.4; }
  .ww-paw { font-size:64px; animation:wwPaw 1s ease-in-out infinite; }
  @keyframes wwPaw { 50% { transform:translateY(-10px) rotate(-8deg); } }
  .ww-pass { display:flex; gap:14px; align-items:center; padding:4px 4px 10px; }
  .ww-pass-name { font-size:24px; font-weight:800; }
  .ww-lovebox { padding:12px; border-radius:16px; background:rgba(255,255,255,.05); margin:4px 0 4px; font-weight:800; }
  .ww-lovebox .ww-prog { margin:8px 0 6px; }
  .ww-lovebox .ww-prog i { background:linear-gradient(90deg,#ff7aa2,#ffbf69); }
  @media (max-width:380px) { .ww-tools { gap:4px; padding:8px 6px 4px; } .ww-tool { font-size:9.5px; letter-spacing:-.2px; } }
  @media (max-height:700px) { .ww-card { gap:8px; padding:12px; } .ww-card .big { font-size:20px; } .ww-card .ww-cta { padding:12px; font-size:17px; } .ww-card .ww-big { padding:10px; } }
  #wwToasts { position:fixed; left:0; right:0; top:58px; z-index:900; display:flex; flex-direction:column; align-items:center; gap:6px; pointer-events:none; }
  .ww-toast { max-width:86%; padding:10px 16px; border-radius:16px; font:800 15px ${FONT}; color:#fff; text-align:center;
              background:rgba(34,26,44,.95); box-shadow:0 10px 26px rgba(0,0,0,.4); animation:wwToast .28s cubic-bezier(.2,1.4,.4,1); transition:opacity .3s, transform .3s; }
  .ww-toast.good { background:linear-gradient(180deg,#43d28a,#22a865); }
  .ww-toast.bad { background:linear-gradient(180deg,#ff7a7a,#e0464f); }
  .ww-toast.find { background:linear-gradient(180deg,#ffe08a,#f5b13e); color:#3a2208; }
  .ww-toast.out { opacity:0; transform:translateY(-10px); }
  @keyframes wwToast { from { opacity:0; transform:translateY(-14px) scale(.9); } }
</style>
<div id="v-ww-hi" class="view ww"><div class="center"><div class="ww-paw">🐾</div><div class="big">Wauwau-WG</div><div class="muted" id="wwHiText">Dein Hund wird geweckt…</div></div></div>

<div id="v-ww-adopt" class="view ww">
  <div class="bar"><span class="word">🏠 Tierheim</span></div>
  <div class="ww-sub"><span>👆 Wische oder tippe ◀ ▶ — wer zieht ein?</span></div>
  <div class="ww-stage" id="wwAdoptStage">
    <canvas id="wwAdoptCanvas" class="ww-fill"></canvas>
    <button id="wwBreedPrev" class="ww-nav prev" aria-label="Vorherige Rasse">◀</button>
    <button id="wwBreedNext" class="ww-nav next" aria-label="Nächste Rasse">▶</button>
  </div>
  <div class="ww-breed"><b id="wwBreedName">…</b><span id="wwCoatName"></span></div>
  <div class="ww-dots" id="wwBreedDots"></div>
  <div class="ww-coats" id="wwCoats"></div>
  <div class="ww-namebox"><input id="wwNameInput" type="text" autocomplete="off" placeholder="Name deines Hundes…"><button id="wwNameDice" class="ww-ib" aria-label="Namensidee">🎲</button></div>
  <button id="wwAdoptBtn" class="ww-cta">🐾 Adoptieren!</button>
  <div class="ww-card" id="wwRestoreCard">
    <canvas id="wwRestoreCanvas" class="ww-mini" style="width:150px;height:150px"></canvas>
    <div class="big">Willkommen zurück! 👋</div>
    <div class="muted" id="wwRestoreText"></div>
    <button id="wwRestoreYes" class="ww-cta">🐾 Ja, das ist mein Hund!</button>
    <button id="wwRestoreNo" class="ww-big">Nein, neuen Hund adoptieren</button>
  </div>
</div>

<div id="v-ww-home" class="view ww">
  <div class="bar">
    <span class="ww-title"><button id="wwMenuBtn" class="ww-ib" aria-label="Hundepass">☰</button><span id="wwHomeName" class="ww-name">…</span></span>
    <span id="wwCoins" class="ww-pill gold">🪙 0</span>
  </div>
  <div class="ww-sub"><span id="wwPhaseLine"></span><button id="wwNightOpen" class="ww-chip">🌙 Bilanz</button><span id="wwHearts" class="ww-hearts"></span></div>
  <div class="ww-needs" id="wwNeeds"></div>
  <div class="ww-stage" id="wwHomeStage">
    <canvas id="wwHomeCanvas" class="ww-fill"></canvas>
    <div class="ww-bathbar" id="wwBathBar"><span id="wwBathStep"></span><span class="ww-prog"><i id="wwBathProg"></i></span><button id="wwBathCancel" class="ww-x" aria-label="Bad abbrechen">✕</button></div>
    <div class="ww-pop" id="wwFeedPick">
      <button id="wwFeed-kibble" class="ww-food" data-food="kibble"><b>🥣</b><span>Trockenfutter</span><small></small></button>
      <button id="wwFeed-meat" class="ww-food" data-food="meat"><b>🥫</b><span>Fleischdose</span><small></small></button>
    </div>
    <div class="ww-card" id="wwNightCard">
      <div class="big" id="wwNightTitle">🌙 Tagesbilanz</div>
      <div class="muted" id="wwNightBest"></div>
      <div class="ww-nrows" id="wwNightRows"></div>
      <button id="wwNextBtn" class="ww-cta">☀️ Nächster Tag</button>
      <div id="wwNightWait" class="muted">Der Host startet gleich den nächsten Tag…</div>
      <button id="wwNightClose" class="ww-big">Noch ein bisschen kuscheln 🐾</button>
    </div>
  </div>
  <div class="ww-tools" id="wwTools"></div>
  <div class="ww-row"><button id="wwShopBtn" class="ww-big shop">🛒 Laden</button><button id="wwBagBtn" class="ww-big">🎒 Tasche</button></div>
  <div class="ww-dim" id="wwDim"></div>
  <div class="ww-sheet" id="wwShop">
    <div class="ww-sheet-head"><span class="ww-grab"></span><b>🛒 Laden</b><span id="wwShopCoins" class="ww-pill gold"></span><button class="ww-x ww-close" aria-label="Schließen">✕</button></div>
    <div class="ww-scroll" id="wwShopList"></div>
  </div>
  <div class="ww-sheet" id="wwBag">
    <div class="ww-sheet-head"><span class="ww-grab"></span><b>🎒 Tasche</b><span id="wwBagCoins" class="ww-pill gold"></span><button class="ww-x ww-close" aria-label="Schließen">✕</button></div>
    <div class="ww-scroll" id="wwBagBody"></div>
  </div>
  <div class="ww-sheet" id="wwMenu">
    <div class="ww-sheet-head"><span class="ww-grab"></span><b>🐾 Hundepass</b><button class="ww-x ww-close" aria-label="Schließen">✕</button></div>
    <div class="ww-scroll">
      <div class="ww-pass"><canvas id="wwPassCanvas" class="ww-mini"></canvas><div><div id="wwPassName" class="ww-pass-name"></div><div id="wwPassBreed" class="muted"></div><div id="wwPassDays" class="muted"></div></div></div>
      <div class="ww-lovebox"><div id="wwPassLove"></div><div class="ww-prog"><i id="wwPassLoveBar"></i></div><div id="wwPassNext" class="muted"></div></div>
      <div class="ww-sec">Heute</div>
      <div class="ww-stats" id="wwPassToday"></div>
      <div class="ww-sec">Umzug</div>
      <button id="wwMoveOutBtn" class="ww-big ww-danger">🏠 Hund abgeben</button>
    </div>
  </div>
</div>

<div id="v-ww-walk" class="view ww">
  <div class="bar"><span class="word" id="wwWalkTitle">🦮 Gassi</span><span id="wwWalkTime" class="ww-pill"></span></div>
  <div class="ww-sub"><span id="wwWalkHint"></span><span id="wwWalkStats" class="ww-hearts"></span></div>
  <div class="ww-stage">
    <canvas id="wwWalkPad" class="ww-fill"></canvas>
    <div class="ww-find" id="wwFindCard"><div class="em" id="wwFindEmoji">🎁</div><div id="wwFindText"></div><small id="wwFindRare">✨ Selten!</small></div>
  </div>
  <div class="ww-actions">
    <button id="wwHeelBtn" class="ww-act">🛑 Bei Fuß</button>
    <button id="wwDigBtn" class="ww-act">🐾 Buddeln<i id="wwDigProg"></i></button>
    <button id="wwPoopBtn" class="ww-act">💩 Weg damit</button>
  </div>
</div>

<div id="v-ww-park" class="view ww">
  <div class="bar"><span class="word" id="wwParkTitle">🎾 Park</span><span id="wwParkTime" class="ww-pill"></span></div>
  <div class="ww-sub"><span id="wwParkHint"></span><span id="wwParkStats" class="ww-hearts"></span></div>
  <div class="ww-stage"><canvas id="wwThrowPad" class="ww-fill"></canvas></div>
  <div class="ww-toys" id="wwToyPicker"></div>
</div>
<div id="wwToasts"></div>`);
  VIEWS.push('ww-hi', 'ww-adopt', 'ww-home', 'ww-walk', 'ww-park');

  // ---------- state ----------
  const S = {};
  const home = {}, walk = {}, park = {}, adopt = {};
  function resetState() {
    Object.assign(S, {
      dog: null, today: null, level: 0, haveDog: false, adoptOpen: false, backup: null, adopting: false,
      phase: 'home', day: 1, left: -1, leftAt: 0, host: false,
      tool: 'pet', sheet: null, night: null, nightHidden: false,
      walk: { dig: 0, digP: 0, poop: 0, cat: 0 }, park: { ready: 1, tired: 0, toy: null }, toy: 'ball'
    });
    Object.assign(home, { L: null, happy: 0, finger: null, stroke: null, trail: 0, lastCare: 0, parts: [], bowl: null, treat: null,
      shake: -9, bath: null, hint: null });
    Object.assign(walk, { origin: null, finger: null, vec: { x: 0, y: 0 }, lastSent: 0, lastX: 0, lastY: 0, lastDig: 0, parts: [],
      pawT: 0, tufts: null, tuftKey: '' });
    Object.assign(park, { anim: 'hand', drag: null, fly: null, dogPos: null, toyPos: null, carry: false, parts: [], toySig: '', G: null, idleT: 0 });
    Object.assign(adopt, { slide: null, happy: 0, parts: [], swipe: null });
  }
  resetState();
  adopt.breedIdx = 0; adopt.coat = 0;   // the Tierheim choice survives between rounds

  // ---------- helpers ----------
  const send = (m) => ac.message(AirConsole.SCREEN, m);
  const nowS = () => performance.now() / 1000;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const onView = (k) => { const v = $('v-' + k); return !!v && v.classList.contains('on'); };
  const amHost = () => (typeof myHost !== 'undefined' && myHost) || S.host;
  const dogName = () => (S.dog ? S.dog.name : 'dein Hund');
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  // One storage slot per player name: desktop tabs share localStorage and each
  // tab is its own player. The TV names the slot in every wwYou; the tab keeps it
  // in sessionStorage so a reload finds its own dog. Before the first wwYou the
  // typed name decides. The bare KEY is the pre-slot record, migrated on save.
  const SLOT = 'wauwauwg.slot';
  function slotKey() {
    let s = '';
    try { s = sessionStorage.getItem(SLOT) || ''; } catch (e) {}
    if (!s) s = String(($('nameInput') || {}).value || '').trim().toLowerCase();
    return s ? KEY + '.' + s : KEY;
  }
  function loadDog() {
    try { return JSON.parse(localStorage.getItem(slotKey()) || localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function saveDog(d, slot) {
    try {
      if (typeof slot === 'string' && slot) sessionStorage.setItem(SLOT, slot.slice(0, 40));
      const k = slotKey();
      localStorage.setItem(k, JSON.stringify(d));
      if (k !== KEY) localStorage.removeItem(KEY);
    } catch (e) {}
  }
  function forgetDog() { try { localStorage.removeItem(slotKey()); localStorage.removeItem(KEY); } catch (e) {} }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const fmtTime = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  function leftNow() { return S.left < 0 ? -1 : Math.max(0, Math.ceil(S.left - (performance.now() - S.leftAt) / 1000)); }
  function nudge(id) { const e = $(id); e.classList.remove('nudge'); void e.offsetWidth; e.classList.add('nudge'); setTimeout(() => e.classList.remove('nudge'), 450); }
  function bump(id) { const e = $(id); e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); }
  function heartsText(level) { let s = ''; for (let i = 0; i < 5; i++) s += i < level ? '❤️' : '🤍'; return s; }

  // ---------- incoming data ----------
  // The TV is our own code, but a stale TV tab or an old build can still send odd data.
  // Everything is checked on arrival, so a bad message is dropped instead of breaking
  // the phone — or being saved to localStorage and sent back.
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  const item = (k) => (own(WW.ITEMS, k) ? WW.ITEMS[k] : null);
  const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');
  const nat = (v) => Math.max(0, Math.min(1e6, Math.floor(+v) || 0));
  const KINDS = ['good', 'bad', 'info', 'find'];
  // A dog record that survived WW.sanitizeDog with its uid intact, else null.
  function cleanDog(raw) {
    if (!raw || typeof raw !== 'object' || !own(WW.BREEDS, raw.breed)) return null;
    try { const d = WW.sanitizeDog(raw); return d && d.uid === raw.uid ? d : null; } catch (e) { return null; }
  }
  function cleanToday(t) {
    t = t && typeof t === 'object' ? t : {};
    return { love: nat(t.love), coins: nat(t.coins), finds: (Array.isArray(t.finds) ? t.finds : []).filter(item).slice(0, 40) };
  }
  function cleanNight(d) {
    const rows = Array.isArray(d.rows) ? d.rows : [];
    return {
      host: d.host === true,
      rows: rows.filter(r => r && typeof r === 'object').slice(0, 12).map(r => ({
        owner: str(r.owner, 24), dog: str(r.dog, 24), love: nat(r.love), coins: nat(r.coins),
        finds: (Array.isArray(r.finds) ? r.finds : []).filter(item).slice(0, 8), best: r.best === true, you: r.you === true
      }))
    };
  }

  function toast(text, kind) {
    if (!text) return;
    const box = $('wwToasts'), t = el('div', 'ww-toast ' + (kind || 'info'), text);
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 320); }, 2600);
  }

  // Sharp canvases at any devicePixelRatio; JSDOM has no layout, so fall back to a phone-ish size.
  function fitCanvas(c) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = c.clientWidth || 320, h = c.clientHeight || 380;
    if (c._w !== w || c._h !== h || c._dpr !== dpr) {
      c._w = w; c._h = h; c._dpr = dpr;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    const g = c._g || (c._g = c.getContext('2d'));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    return { g, w, h };
  }

  // One finger per pad: touch (tracked by identifier) + mouse for desktop testing.
  function bindPad(elm, h) {
    let tid = null, mouse = false;
    const pos = (cx, cy) => { const r = elm.getBoundingClientRect(); return [cx - r.left, cy - r.top]; };
    const find = (list) => { for (let i = 0; i < list.length; i++) if (list[i].identifier === tid) return list[i]; return null; };
    elm.addEventListener('touchstart', (e) => {
      e.preventDefault();
      // A second finger is ignored — but a touchend that never arrived (view hidden mid-drag,
      // system gesture) must not leave the pad dead: our finger has to be still down to count.
      if (tid !== null) { if (find(e.touches || [])) return; tid = null; }
      const t = e.changedTouches[0];
      tid = t.identifier;
      h.down.apply(null, pos(t.clientX, t.clientY));
    }, { passive: false });
    elm.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = find(e.changedTouches);
      if (t) h.move.apply(null, pos(t.clientX, t.clientY));
    }, { passive: false });
    elm.addEventListener('touchend', (e) => {
      e.preventDefault();
      const t = find(e.changedTouches);
      if (t) { tid = null; h.up.apply(null, pos(t.clientX, t.clientY)); }
    });
    elm.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      if (tid !== null) { tid = null; (h.cancel || h.up)(0, 0); }
    });
    elm.addEventListener('mousedown', (e) => { e.preventDefault(); mouse = true; h.down.apply(null, pos(e.clientX, e.clientY)); });
    window.addEventListener('mousemove', (e) => { if (mouse) h.move.apply(null, pos(e.clientX, e.clientY)); });
    window.addEventListener('mouseup', (e) => { if (mouse) { mouse = false; h.up.apply(null, pos(e.clientX, e.clientY)); } });
  }

  // ---------- canvas drawing kit ----------
  function rrect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function oval(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); }
  function dot(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); }
  function heart(g, x, y, s, col) {
    g.save(); g.translate(x, y); g.scale(s / 14, s / 14);
    g.fillStyle = col; g.beginPath(); g.moveTo(0, 7);
    g.bezierCurveTo(-12, -3, -7, -13, 0, -6); g.bezierCurveTo(7, -13, 12, -3, 0, 7); g.fill();
    g.restore();
  }
  function sparkle(g, x, y, r, col) {
    g.fillStyle = col; g.beginPath(); g.moveTo(x, y - r);
    g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r);
    g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.fill();
  }
  function emoji(g, ch, x, y, size, rot) {
    g.save(); g.translate(x, y); if (rot) g.rotate(rot);
    g.font = Math.round(size) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, 0, 0); g.restore();
  }
  function label(g, text, x, y, size, col, weight) {
    g.font = (weight || 800) + ' ' + Math.round(size) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = col; g.fillText(text, x, y);
  }
  function pill(g, text, x, y, size) {
    g.font = '800 ' + Math.round(size) + 'px ' + FONT;
    const w = g.measureText(text).width + size * 1.6, h = size * 2;
    g.fillStyle = 'rgba(30,20,40,.72)'; rrect(g, x - w / 2, y - h / 2, w, h, h / 2); g.fill();
    label(g, text, x, y + 1, size, '#fff');
  }

  // Tiny particle system shared by all pads.
  function addPart(list, p) {
    list.push(Object.assign({ life: 0, max: 1, vx: 0, vy: 0, g: 0, rot: 0, vr: 0, size: 12, color: '#fff', kind: 'spark' }, p));
    if (list.length > 240) list.shift();
  }
  function stepParts(list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life += dt;
      if (p.life >= p.max) { list.splice(i, 1); continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
  }
  function drawParts(g, list) {
    for (const p of list) {
      const a = p.life / p.max;
      g.globalAlpha = clamp((1 - a) * 1.6, 0, 1);
      const s = p.size * (p.kind === 'heart' ? 0.7 + 0.5 * Math.min(1, a * 4) : 1);
      if (p.kind === 'heart') heart(g, p.x, p.y, s, p.color);
      else if (p.kind === 'spark') sparkle(g, p.x, p.y, s * (1 - a * 0.5), p.color);
      else if (p.kind === 'bubble') {
        g.fillStyle = 'rgba(255,255,255,.85)'; dot(g, p.x, p.y, s); g.fill();
        g.strokeStyle = 'rgba(120,200,255,.7)'; g.lineWidth = 1.2; g.stroke();
        g.fillStyle = '#fff'; dot(g, p.x - s * 0.35, p.y - s * 0.35, s * 0.25); g.fill();
      } else if (p.kind === 'drop') {
        g.fillStyle = p.color; g.beginPath(); g.moveTo(p.x, p.y - s);
        g.quadraticCurveTo(p.x + s * 0.7, p.y + s * 0.2, p.x, p.y + s * 0.6); g.quadraticCurveTo(p.x - s * 0.7, p.y + s * 0.2, p.x, p.y - s); g.fill();
      } else if (p.kind === 'fur') {
        g.strokeStyle = p.color; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath();
        g.moveTo(p.x, p.y); g.quadraticCurveTo(p.x + s * Math.cos(p.rot), p.y + s * 0.4, p.x + s * Math.cos(p.rot + 1), p.y + s * Math.sin(p.rot)); g.stroke();
      } else if (p.kind === 'dirt' || p.kind === 'crumb') {
        g.fillStyle = p.color; dot(g, p.x, p.y, s * (1 - a * 0.4)); g.fill();
      } else if (p.kind === 'text') {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.font = '800 ' + Math.round(s) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = p.color; g.fillText(p.text, 0, 0); g.restore();
      } else if (p.kind === 'paw') {
        g.fillStyle = p.color;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        oval(g, 0, s * 0.25, s * 0.42, s * 0.34); g.fill();
        [[-0.42, -0.3], [-0.15, -0.55], [0.15, -0.55], [0.42, -0.3]].forEach(([dx, dy]) => { oval(g, dx * s, dy * s, s * 0.15, s * 0.19); g.fill(); });
        g.restore();
      }
    }
    g.globalAlpha = 1;
  }
  function burst(list, x, y, n, kind, color, size, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random() * 0.6) * (speed || 120);
      addPart(list, { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, g: kind === 'heart' ? -30 : 160, kind,
        color: Array.isArray(color) ? color[i % color.length] : color, size: size * (0.7 + Math.random() * 0.6), max: 0.7 + Math.random() * 0.5,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 6 });
    }
  }

  // ============================================================
  // TIERHEIM
  // ============================================================
  const breedKey = () => WW.BREED_KEYS[adopt.breedIdx];
  function sizeWord(key) { const s = (WW.art.SIZE || {})[key] || 1; return s < 0.85 ? 'Klein' : s < 1.08 ? 'Mittel' : 'Groß'; }
  (function buildAdopt() {
    $('wwNameInput').maxLength = WW.NAME_MAX;
    WW.BREED_KEYS.forEach(() => $('wwBreedDots').appendChild(el('i')));
    for (let i = 0; i < 3; i++) {
      const b = el('button', 'ww-coat');
      b.dataset.coat = i;
      b.addEventListener('click', () => { adopt.coat = i; adopt.happy = 1; updateAdoptUi(); vibrate(8); });
      $('wwCoats').appendChild(b);
    }
  })();
  function updateAdoptUi() {
    const key = breedKey(), b = WW.BREEDS[key];
    adopt.coat = clamp(adopt.coat, 0, b.coats.length - 1);
    $('wwBreedName').textContent = b.label;
    $('wwCoatName').textContent = b.coats[adopt.coat].label + ' · ' + sizeWord(key);
    [...$('wwBreedDots').children].forEach((d, i) => d.classList.toggle('on', i === adopt.breedIdx));
    [...$('wwCoats').children].forEach((c, i) => {
      const coat = b.coats[i];
      c.style.display = coat ? '' : 'none';
      if (!coat) return;
      c.style.background = 'linear-gradient(135deg,' + WW.art.swatch(key, i) + ' 0 58%,' + coat.fur2 + ' 58% 100%)';
      c.classList.toggle('sel', i === adopt.coat);
      c.setAttribute('aria-label', coat.label);
    });
    const name = WW.cleanName($('wwNameInput').value);
    $('wwAdoptBtn').textContent = '🐾 ' + (name || 'Hund') + ' adoptieren!';
  }
  function stepBreed(dir) {
    const n = WW.BREED_KEYS.length;
    adopt.slide = { from: breedKey(), fromCoat: adopt.coat, dir, t0: nowS() };
    adopt.breedIdx = (adopt.breedIdx + dir + n) % n;
    adopt.coat = 0;
    updateAdoptUi();
    vibrate(8);
  }
  $('wwBreedPrev').addEventListener('click', () => stepBreed(-1));
  $('wwBreedNext').addEventListener('click', () => stepBreed(1));
  $('wwNameDice').addEventListener('click', () => {
    const cur = WW.cleanName($('wwNameInput').value), pool = WW.NAME_IDEAS.filter(n => n !== cur);
    $('wwNameInput').value = WW.pick(pool);
    updateAdoptUi(); nudge('wwNameDice'); vibrate(8);
  });
  $('wwNameInput').addEventListener('input', updateAdoptUi);
  $('wwNameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('wwNameInput').blur(); });
  $('wwAdoptBtn').addEventListener('click', () => {
    if (S.adopting) return;
    const name = WW.cleanName($('wwNameInput').value) || WW.pick(WW.NAME_IDEAS);
    S.adopting = true;
    $('wwAdoptBtn').disabled = true;
    setTimeout(() => { S.adopting = false; $('wwAdoptBtn').disabled = false; }, 3000);
    vibrate([20, 40, 20]);
    send({ t: 'wwAdoptDone', name, breed: breedKey(), coat: adopt.coat });
  });
  $('wwRestoreYes').addEventListener('click', () => { S.adopting = true; vibrate(20); send({ t: 'wwRestore' }); });
  $('wwRestoreNo').addEventListener('click', () => { S.backup = null; $('wwRestoreCard').classList.remove('open'); });
  bindPad($('wwAdoptCanvas'), {
    down(x, y) { adopt.swipe = { x0: x, y0: y }; },
    move() {},
    up(x, y) {
      const sw = adopt.swipe;
      adopt.swipe = null;
      if (!sw) return;
      const dx = x - sw.x0;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(y - sw.y0)) stepBreed(dx < 0 ? 1 : -1);
      else { adopt.happy = 1; burst(adopt.parts, x, y, 4, 'heart', ['#ff6f91', '#ff9eb1'], 14, 90); vibrate(10); }
    },
    cancel() { adopt.swipe = null; }
  });
  function showAdopt() {
    if (!$('wwNameInput').value) $('wwNameInput').value = WW.pick(WW.NAME_IDEAS);
    $('wwAdoptBtn').disabled = false;
    const b = S.backup;
    if (b && WW.BREEDS[b.breed]) $('wwRestoreText').textContent = 'Ist ' + b.name + ' (' + WW.BREEDS[b.breed].label + ') dein Hund?';
    $('wwRestoreCard').classList.toggle('open', !!(b && WW.BREEDS[b.breed]));
    updateAdoptUi();
  }
  function drawKennel(g, w, h, t) {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#ffe9cc'); bg.addColorStop(1, '#f7c99a');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.35)';
    for (let y = 18; y < h * 0.76; y += 36) for (let x = (y / 36 % 2) * 22 + 10; x < w; x += 44) { dot(g, x, y, 3.5); g.fill(); }
    const glow = g.createRadialGradient(w / 2, h * 0.45, 10, w / 2, h * 0.45, Math.max(w, h) * 0.6);
    glow.addColorStop(0, 'rgba(255,255,255,.75)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e3a56d'; g.fillRect(0, h * 0.78, w, h * 0.22);
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, h * 0.78, w, 5);
    // cushion
    g.fillStyle = '#ff9eb1'; oval(g, w / 2, h * 0.86, w * 0.36, h * 0.06); g.fill();
    g.fillStyle = '#ffc2cf'; oval(g, w / 2, h * 0.85, w * 0.3, h * 0.04); g.fill();
    // little bone sign
    g.save(); g.translate(w * 0.5, h * 0.06 + 14); g.rotate(Math.sin(t * 1.3) * 0.04);
    pill(g, '🏠 Tierheim Pfotenglück', 0, 0, 12); g.restore();
  }
  function drawAdopt(dt) {
    const { g, w, h } = fitCanvas($('wwAdoptCanvas')), t = nowS();
    drawKennel(g, w, h, t);
    adopt.happy = Math.max(0, adopt.happy - dt * 0.5);
    const size = Math.min(h * 0.74, w * 0.72), cy = h * 0.5;
    const opts = { t, happy: adopt.happy, tongue: adopt.happy > 0.3, look: { x: Math.sin(t * 0.7) * 0.4, y: Math.sin(t * 0.43) * 0.2 } };
    const cur = { breed: breedKey(), coat: adopt.coat };
    const sl = adopt.slide;
    if (sl) {
      const a = clamp((t - sl.t0) / 0.32, 0, 1), e = 1 - Math.pow(1 - a, 3);
      WW.art.drawPortrait(g, { breed: sl.from, coat: sl.fromCoat }, w / 2 - sl.dir * e * w, cy, size, opts);
      WW.art.drawPortrait(g, cur, w / 2 + sl.dir * (1 - e) * w, cy, size, opts);
      if (a >= 1) adopt.slide = null;
    } else {
      WW.art.drawPortrait(g, cur, w / 2, cy, size, opts);
    }
    stepParts(adopt.parts, dt);
    drawParts(g, adopt.parts);
    if ($('wwRestoreCard').classList.contains('open') && S.backup) {
      const r = fitCanvas($('wwRestoreCanvas'));
      r.g.clearRect(0, 0, r.w, r.h);
      WW.art.drawPortrait(r.g, S.backup, r.w / 2, r.h * 0.52, r.h * 0.9, { t, happy: 0.6 + 0.4 * Math.sin(t * 2), tongue: true });
    }
  }

  // ============================================================
  // ZUHAUSE — status, tools, care gestures, bath, sheets, night
  // ============================================================
  (function buildHome() {
    WW.NEEDS.forEach(k => {
      const n = el('div', 'ww-need'), info = WW.NEED_INFO[k];
      n.dataset.need = k;
      n.appendChild(el('span', 'ww-ni', info.emoji));
      const b = el('span', 'ww-nb'), i = el('i');
      i.style.background = info.color;
      b.appendChild(i); n.appendChild(b);
      n.addEventListener('click', () => { if (S.dog) toast(info.emoji + ' ' + info.label + ': ' + Math.round(S.dog.needs[k]) + ' %', 'info'); });
      $('wwNeeds').appendChild(n);
    });
    [
      { k: 'pet', icon: '✋', label: 'Streicheln' }, { k: 'brush', svg: BRUSH_SVG, label: 'Bürsten' },
      { k: 'feed', icon: '🥣', label: 'Füttern' }, { k: 'water', icon: '💧', label: 'Wasser' },
      { k: 'treat', icon: '🍪', label: 'Leckerli' }, { k: 'bath', icon: '🛁', label: 'Baden' }
    ].forEach(tl => {
      const b = el('button', 'ww-tool');
      b.id = 'wwTool-' + tl.k;
      b.dataset.tool = tl.k;
      const ic = el('b');
      if (tl.svg) ic.innerHTML = tl.svg; else ic.textContent = tl.icon;   // static markup only
      const badge = el('em', 'ww-badge');
      badge.style.display = 'none';
      b.append(ic, el('span', null, tl.label), badge);
      b.addEventListener('click', () => useTool(tl.k));
      $('wwTools').appendChild(b);
    });
  })();

  function renderStatus() {
    const d = S.dog;
    if (!d) return;
    $('wwHomeName').textContent = d.name;
    const coins = '🪙 ' + d.coins;
    if ($('wwCoins').textContent !== coins) { if ($('wwCoins').textContent !== '🪙 0') bump('wwCoins'); $('wwCoins').textContent = coins; }
    $('wwShopCoins').textContent = coins; $('wwBagCoins').textContent = coins;
    $('wwHearts').textContent = heartsText(S.level);
    [...$('wwNeeds').children].forEach(n => {
      const v = d.needs[n.dataset.need];
      n.querySelector('i').style.width = Math.round(v) + '%';
      n.classList.toggle('low', v < WW.LOW);
    });
    const badge = (k, n) => { const b = $('wwTool-' + k).querySelector('.ww-badge'); b.style.display = ''; b.textContent = n; b.classList.toggle('zero', !n); };
    badge('feed', (d.inv.kibble || 0) + (d.inv.meat || 0));
    badge('treat', d.inv.treat || 0);
    badge('bath', d.inv.shampoo || 0);
    ['kibble', 'meat'].forEach(k => {
      const b = $('wwFeed-' + k), n = d.inv[k] || 0;
      b.querySelector('small').textContent = n ? '× ' + n : 'leer — im Laden';
      b.classList.toggle('empty', !n);
    });
    const stats = '⚡' + Math.round(d.needs.energy) + '  ✨' + Math.round(d.needs.clean) + '  💧' + Math.round(d.needs.water);
    $('wwWalkStats').textContent = stats; $('wwParkStats').textContent = '⚡' + Math.round(d.needs.energy) + '  😊' + Math.round(d.needs.mood);
    $('wwWalkTitle').textContent = '🦮 Gassi mit ' + d.name;
    $('wwParkTitle').textContent = '🎾 Park mit ' + d.name;
    if (S.sheet === 'shop') renderShop();
    if (S.sheet === 'bag') renderBag();
    if (S.sheet === 'menu') renderMenu();
    renderToys();
    updateWalkUi(); updateParkUi();
    markTools();
  }
  function markTools() {
    const caring = S.phase === 'home' || S.phase === 'night';
    [...$('wwTools').children].forEach(b => {
      b.classList.toggle('sel', !home.bath && b.dataset.tool === S.tool);
      b.classList.toggle('off', !!home.bath || !caring);
    });
  }
  function hint(text) { home.hint = { text, t0: nowS() }; }

  function useTool(k) {
    if (!S.dog || home.bath) return;
    if (k !== 'feed') $('wwFeedPick').classList.remove('open');
    if (k === 'pet' || k === 'brush') {
      S.tool = k; markTools(); vibrate(6);
      hint(k === 'pet' ? '✋ Streichle ' + dogName() + ' mit dem Finger' : '✨ Bürste das Fell — Strich für Strich');
    } else if (k === 'feed') {
      $('wwFeedPick').classList.toggle('open');
    } else if (k === 'water') {
      home.bowl = { kind: 'water', t0: nowS(), refuse: S.dog.needs.water >= 90 };
      vibrate(10);
      send({ t: 'wwCare', act: 'water' });
    } else if (k === 'treat') {
      if (!(S.dog.inv.treat > 0)) { toast('Keine Leckerlis mehr — ab in den Laden 🛒', 'bad'); nudge('wwShopBtn'); return; }
      home.treat = { t0: nowS(), hit: false };
      vibrate(10);
      send({ t: 'wwCare', act: 'treat' });
    } else if (k === 'bath') {
      startBath();
    }
  }
  [...$('wwFeedPick').children].forEach(b => b.addEventListener('click', () => {
    const item = b.dataset.food, d = S.dog;
    $('wwFeedPick').classList.remove('open');
    if (!d) return;
    if (!(d.inv[item] > 0)) { toast('Kein ' + WW.ITEMS[item].label + ' mehr — ab in den Laden 🛒', 'bad'); nudge('wwShopBtn'); return; }
    home.bowl = { kind: item, t0: nowS(), refuse: d.needs.food >= 90 };
    vibrate(10);
    send({ t: 'wwCare', act: 'feed', item });
  }));

  // --- petting + brushing: one counted stroke per STROKE_PX of rubbing over the dog ---
  function strokeMove(x, y, d) {
    const L = home.L, st = home.stroke;
    if (!L || !st || !S.dog) return;
    const zone = WW.art.portraitZone(S.dog, L.size, x - L.cx, y - L.cy);
    if (!zone) return;
    const brushing = S.tool === 'brush';
    const fav = !brushing && zone === WW.favoriteSpot(S.dog);
    st.dist += d;
    st.zones[zone] = (st.zones[zone] || 0) + d;
    home.happy = Math.min(1, home.happy + d * (brushing ? 0.003 : fav ? 0.009 : 0.005));
    home.trail += d;
    if (home.trail > 18) {
      home.trail = 0;
      if (brushing) {
        addPart(home.parts, { kind: 'spark', x: x + (Math.random() - 0.5) * 20, y: y + (Math.random() - 0.5) * 20, vy: -30, color: '#fff7c2', size: 7, max: 0.6 });
        const coat = WW.BREEDS[S.dog.breed].coats[S.dog.coat] || {};
        addPart(home.parts, { kind: 'fur', x, y, vx: (Math.random() - 0.5) * 60, vy: -20, g: 60, color: coat.fur || '#c98b4a', size: 8, max: 0.9, rot: Math.random() * 6 });
      } else {
        addPart(home.parts, { kind: 'heart', x: x + (Math.random() - 0.5) * 16, y: y - 10, vx: (Math.random() - 0.5) * 30, vy: -70, color: fav ? '#ff4f8b' : '#ff8fab', size: fav ? 20 : 13, max: 1.1 });
      }
    }
    if (st.dist >= STROKE_PX) {
      const now = performance.now();
      if (now - home.lastCare >= CARE_GAP_MS) {
        const best = Object.keys(st.zones).sort((a, b) => st.zones[b] - st.zones[a])[0];
        send(brushing ? { t: 'wwCare', act: 'brush' } : { t: 'wwCare', act: 'pet', zone: best });
        home.lastCare = now;
        st.dist = 0; st.zones = {};
        vibrate(fav ? 14 : 5);
        if (fav) burst(home.parts, x, y - 10, 3, 'heart', ['#ff4f8b', '#ff8fab'], 16, 110);
      }
    }
  }
  bindPad($('wwHomeCanvas'), {
    down(x, y) {
      $('wwFeedPick').classList.remove('open');
      home.finger = { x, y, dx: 0, dy: 0 };
      if (home.bath) { bathRub(x, y, 0); return; }
      home.stroke = { dist: 0, zones: {} };
    },
    move(x, y) {
      const f = home.finger;
      if (!f) return;
      const d = Math.hypot(x - f.x, y - f.y);
      home.finger = { x, y, dx: x - f.x, dy: y - f.y };
      if (home.bath) bathRub(x, y, d);
      else strokeMove(x, y, d);
    },
    up() { home.finger = null; home.stroke = null; },
    cancel() { home.finger = null; home.stroke = null; }
  });

  // --- bath minigame: foam → rinse → towel, tracked on a grid over the dog ---
  function startBath() {
    if (!(S.dog.inv.shampoo > 0)) { toast('Kein Shampoo 🧴 — ab in den Laden 🛒', 'bad'); nudge('wwShopBtn'); return; }
    $('wwFeedPick').classList.remove('open');
    const n = GRID_C * GRID_R;
    home.bath = { step: 1, p: 0, foam: new Array(n).fill(0), wet: new Array(n).fill(0), mask: [], key: '' };
    home.bowl = null; home.treat = null;
    hint('🧴 Rubbel ' + dogName() + ' schön ein!');
    vibrate(15);
    send({ t: 'wwCare', act: 'bathStart' });
    updateBathBar(); markTools();
  }
  function ensureMask(B, L) {
    const key = Math.round(L.cx) + ':' + Math.round(L.cy) + ':' + Math.round(L.size);
    if (B.key === key) return;
    B.key = key;
    B.x0 = L.cx - L.size * 0.38; B.y0 = L.cy - L.size * 0.48;
    B.cw = L.size * 0.76 / GRID_C; B.ch = L.size * 0.86 / GRID_R;
    const tubTop = L.cy + L.size * 0.2;
    B.mask = [];
    for (let i = 0; i < GRID_C * GRID_R; i++) {
      const cx = B.x0 + (i % GRID_C + 0.5) * B.cw, cy = B.y0 + (Math.floor(i / GRID_C) + 0.5) * B.ch;
      if (cy > tubTop - B.ch * 0.3) continue;
      if (WW.art.portraitZone(S.dog, L.size, cx - L.cx, cy - L.cy)) B.mask.push(i);
    }
  }
  function bathRub(x, y, d) {
    const B = home.bath, L = home.L;
    if (!B || !L) return;
    ensureMask(B, L);
    const r = L.size * 0.14;
    for (const i of B.mask) {
      const cx = B.x0 + (i % GRID_C + 0.5) * B.cw, cy = B.y0 + (Math.floor(i / GRID_C) + 0.5) * B.ch;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > r) continue;
      const amt = (0.05 + d * 0.006) * (1 - dist / r);
      if (B.step === 1) B.foam[i] = Math.min(1, B.foam[i] + amt);
      else if (B.step === 2) B.foam[i] = Math.max(0, B.foam[i] - amt * 1.4);
      else B.wet[i] = Math.max(0, B.wet[i] - amt * 0.9);
    }
    if (d > 0 && Math.random() < 0.35) {
      if (B.step === 1) addPart(home.parts, { kind: 'bubble', x: x + (Math.random() - 0.5) * 30, y, vy: -40 - Math.random() * 40, vx: (Math.random() - 0.5) * 30, size: 4 + Math.random() * 6, max: 1.2 });
      if (B.step === 3) addPart(home.parts, { kind: 'spark', x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 20, vy: -20, color: '#ffffff', size: 6, max: 0.5 });
    }
    bathProgress();
  }
  function bathProgress() {
    const B = home.bath;
    if (!B) return;
    let n = 0, foamed = 0, foamy = 0, dry = 0;
    for (const i of B.mask) {
      n++;
      if (B.foam[i] >= 0.6) foamed++;
      if (B.foam[i] > 0.15) foamy++;
      if (B.wet[i] <= 0.25) dry++;
    }
    if (!n) { B.p = 1; finishBath(); return; }
    if (B.step === 1) {
      B.p = foamed / n / BATH_FOAM;
      if (foamed / n >= BATH_FOAM) {
        B.step = 2; B.p = 0;
        B.mask.forEach(i => { B.wet[i] = 1; });
        hint('🚿 Super! Jetzt abduschen'); vibrate(25);
      }
    } else if (B.step === 2) {
      B.p = clamp((1 - foamy / n) / (1 - BATH_RINSE), 0, 1);
      if (foamy / n <= BATH_RINSE) { B.step = 3; B.p = 0; hint('🧺 Und jetzt trockenrubbeln!'); vibrate(25); }
    } else {
      B.p = dry / n / BATH_DRY;
      if (dry / n >= BATH_DRY) finishBath();
    }
    updateBathBar();
  }
  function finishBath() {
    home.bath = null;
    home.shake = nowS();
    home.happy = 1;
    const L = home.L;
    if (L) burst(home.parts, L.cx, L.cy - L.size * 0.1, 14, 'spark', ['#ffffff', '#fff3a0', '#8be0ff'], 10, 220);
    vibrate([30, 40, 30, 40, 70]);
    send({ t: 'wwCare', act: 'bath' });
    updateBathBar(); markTools();
  }
  function cancelBath(quiet) {
    if (!home.bath) return;
    home.bath = null;
    send({ t: 'wwCare', act: 'bathCancel' });
    if (!quiet) toast('🛁 Bad abgebrochen', 'info');
    updateBathBar(); markTools();
  }
  function updateBathBar() {
    const B = home.bath;
    $('wwBathBar').classList.toggle('open', !!B);
    if (!B) return;
    $('wwBathStep').textContent = BATH_STEPS[B.step - 1];
    $('wwBathProg').style.width = Math.round(clamp(B.p, 0, 1) * 100) + '%';
  }
  $('wwBathCancel').addEventListener('click', () => cancelBath(false));

  // --- home drawing ---
  function drawRoom(g, w, h, night, t) {
    const fy = h * 0.68;
    const wall = g.createLinearGradient(0, 0, 0, fy);
    wall.addColorStop(0, night ? '#3a3360' : '#fde8cf'); wall.addColorStop(1, night ? '#2b2549' : '#f6d4ae');
    g.fillStyle = wall; g.fillRect(0, 0, w, fy);
    g.fillStyle = night ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.4)';
    for (let x = 8; x < w; x += 30) g.fillRect(x, 0, 12, fy);
    // window
    const ww = Math.min(w * 0.3, 140), wh = Math.min(h * 0.24, 116), wx = w * 0.07, wy = h * 0.07;
    g.fillStyle = night ? '#4a3a52' : '#b77b4b'; rrect(g, wx - 6, wy - 6, ww + 12, wh + 12, 9); g.fill();
    const sky = g.createLinearGradient(0, wy, 0, wy + wh);
    sky.addColorStop(0, night ? '#0f1a42' : '#7cc6ff'); sky.addColorStop(1, night ? '#2a376f' : '#cdeeff');
    g.fillStyle = sky; g.fillRect(wx, wy, ww, wh);
    g.save(); g.beginPath(); g.rect(wx, wy, ww, wh); g.clip();
    if (night) {
      g.fillStyle = '#fff5c4'; dot(g, wx + ww * 0.7, wy + wh * 0.32, wh * 0.14); g.fill();
      g.fillStyle = sky; dot(g, wx + ww * 0.75, wy + wh * 0.27, wh * 0.12); g.fill();
      for (let i = 0; i < 7; i++) {
        g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2 + i * 1.7);
        sparkle(g, wx + ww * ((i * 0.37) % 1), wy + wh * ((i * 0.53 + 0.1) % 0.9), 2.4, '#ffffff');
      }
      g.globalAlpha = 1;
    } else {
      g.fillStyle = '#ffe066'; dot(g, wx + ww * 0.74, wy + wh * 0.3, wh * 0.13); g.fill();
      const cx = wx - 40 + ((t * 7) % (ww + 80));
      g.fillStyle = 'rgba(255,255,255,.95)';
      dot(g, cx, wy + wh * 0.6, wh * 0.1); g.fill(); dot(g, cx + wh * 0.13, wy + wh * 0.55, wh * 0.13); g.fill(); dot(g, cx + wh * 0.28, wy + wh * 0.6, wh * 0.09); g.fill();
    }
    g.restore();
    g.fillStyle = night ? '#4a3a52' : '#b77b4b';
    g.fillRect(wx + ww / 2 - 3, wy, 6, wh); g.fillRect(wx, wy + wh / 2 - 3, ww, 6);
    g.fillStyle = night ? '#7a5577' : '#ff9eb1';
    [[wx - 10, 1], [wx + ww + 10, -1]].forEach(([cx, s]) => {
      g.beginPath(); g.moveTo(cx, wy - 10); g.lineTo(cx + s * ww * 0.22, wy - 10);
      g.quadraticCurveTo(cx + s * ww * 0.05, wy + wh * 0.5, cx + s * ww * 0.12, wy + wh + 14); g.lineTo(cx, wy + wh + 14); g.closePath(); g.fill();
    });
    // paw picture
    const pw = Math.min(w * 0.2, 86), ph = pw * 0.82, px = w * 0.9 - pw, py = h * 0.09;
    g.fillStyle = night ? '#4a3a52' : '#8d5a3b'; rrect(g, px - 5, py - 5, pw + 10, ph + 10, 6); g.fill();
    g.fillStyle = night ? '#433d6a' : '#fff4e2'; g.fillRect(px, py, pw, ph);
    addPawShape(g, px + pw / 2, py + ph * 0.55, ph * 0.42, night ? '#8a6aa0' : '#ff9eb1');
    // floor
    const fl = g.createLinearGradient(0, fy, 0, h);
    fl.addColorStop(0, night ? '#5a4436' : '#d69d68'); fl.addColorStop(1, night ? '#3d2e24' : '#b67c4b');
    g.fillStyle = fl; g.fillRect(0, fy, w, h - fy);
    g.strokeStyle = 'rgba(0,0,0,.1)'; g.lineWidth = 1.5;
    let gap = 12, row = 0;
    for (let y = fy + gap; y < h; y += gap, gap *= 1.25, row++) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      for (let x = (row % 2) * 60 + 20; x < w; x += 120) { g.beginPath(); g.moveTo(x, y - gap / 1.25); g.lineTo(x, y); g.stroke(); }
    }
    g.fillStyle = night ? '#4b3e5c' : '#fff1de'; g.fillRect(0, fy - 7, w, 9);
    // rug
    g.fillStyle = night ? '#7a4f6e' : '#ff9eb1'; oval(g, w / 2, h * 0.875, w * 0.42, h * 0.075); g.fill();
    g.strokeStyle = night ? '#9a6f8e' : '#ffd0db'; g.lineWidth = 3; oval(g, w / 2, h * 0.875, w * 0.35, h * 0.055); g.stroke();
    // plant
    const plx = w * 0.9, ply = fy + 4;
    g.fillStyle = night ? '#3f6a4a' : '#5fb36a';
    [[-0.7, 26], [-0.25, 34], [0.25, 32], [0.75, 24]].forEach(([a, l]) => {
      g.save(); g.translate(plx, ply - 18); g.rotate(a + Math.sin(t * 1.4 + a) * 0.04);
      oval(g, 0, -l / 2, 7, l / 2); g.fill(); g.restore();
    });
    g.fillStyle = night ? '#7a4a3a' : '#d9734a'; rrect(g, plx - 15, ply - 22, 30, 26, 5); g.fill();
    if (night) {
      const lamp = g.createRadialGradient(w * 0.86, h * 0.3, 4, w * 0.86, h * 0.3, h * 0.6);
      lamp.addColorStop(0, 'rgba(255,214,140,.32)'); lamp.addColorStop(1, 'rgba(255,214,140,0)');
      g.fillStyle = lamp; g.fillRect(0, 0, w, h);
    }
  }
  function addPawShape(g, x, y, s, col) {
    g.fillStyle = col;
    oval(g, x, y + s * 0.25, s * 0.42, s * 0.34); g.fill();
    [[-0.42, -0.28], [-0.15, -0.52], [0.15, -0.52], [0.42, -0.28]].forEach(([dx, dy]) => { oval(g, x + dx * s, y + dy * s, s * 0.15, s * 0.19); g.fill(); });
  }
  function drawBathroom(g, w, h, t) {
    g.fillStyle = '#dff3fb'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#bfe0ee'; g.lineWidth = 2;
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = '#9dd3e8'; g.fillRect(0, h * 0.82, w, h * 0.18);
    // shelf + duck
    g.fillStyle = '#c9a27a'; g.fillRect(w * 0.06, h * 0.16, w * 0.24, 7);
    g.fillStyle = '#ffd60a'; dot(g, w * 0.14, h * 0.16 - 11, 10); g.fill(); dot(g, w * 0.17, h * 0.16 - 22, 7); g.fill();
    g.fillStyle = '#ff9f0a'; g.fillRect(w * 0.17 + 5, h * 0.16 - 24, 7, 4);
    for (let i = 0; i < 6; i++) {
      const y = h - ((t * 26 + i * 70) % (h + 40)), x = w * ((i * 0.31 + 0.12) % 1) + Math.sin(t + i) * 8;
      g.strokeStyle = 'rgba(120,190,230,.5)'; g.lineWidth = 2; dot(g, x, y, 5 + (i % 3) * 3); g.stroke();
    }
  }
  function drawFoam(g, B, t) {
    for (const i of B.mask) {
      const f = B.foam[i];
      if (f < 0.05) continue;
      const cx = B.x0 + (i % GRID_C + 0.5) * B.cw, cy = B.y0 + (Math.floor(i / GRID_C) + 0.5) * B.ch;
      const r = Math.max(B.cw, B.ch) * (0.3 + 0.45 * f);
      g.globalAlpha = Math.min(1, f * 1.4);
      for (let k = 0; k < 3; k++) {
        const ox = Math.sin(i * 12.9 + k * 2.1) * B.cw * 0.4, oy = Math.cos(i * 7.3 + k * 1.7) * B.ch * 0.4;
        g.fillStyle = k === 2 ? '#eef8ff' : '#ffffff';
        dot(g, cx + ox, cy + oy + Math.sin(t * 3 + i + k) * 1.2, r * (0.55 + 0.18 * k)); g.fill();
      }
    }
    g.globalAlpha = 1;
  }
  function drawTub(g, L, w, h, t) {
    const top = L.cy + L.size * 0.2, x0 = L.cx - L.size * 0.52, x1 = L.cx + L.size * 0.52;
    for (let i = 0; i < 9; i++) {
      g.fillStyle = 'rgba(255,255,255,.95)';
      dot(g, x0 + (x1 - x0) * (i + 0.5) / 9, top - 2 + Math.sin(t * 2 + i) * 2, L.size * 0.045 + (i % 3) * 2); g.fill();
    }
    const body = g.createLinearGradient(x0, 0, x1, 0);
    body.addColorStop(0, '#d3e6f1'); body.addColorStop(0.5, '#ffffff'); body.addColorStop(1, '#cfe2ee');
    g.fillStyle = body; rrect(g, x0, top, x1 - x0, h - top + 30, L.size * 0.1); g.fill();
    g.fillStyle = '#ffffff'; rrect(g, x0 - 7, top - 7, x1 - x0 + 14, 15, 8); g.fill();
    g.strokeStyle = 'rgba(80,140,180,.25)'; g.lineWidth = 2; rrect(g, x0 - 7, top - 7, x1 - x0 + 14, 15, 8); g.stroke();
    addPawShape(g, L.cx, top + (h - top) * 0.45, L.size * 0.07, '#8fd0ec');
  }
  function drawBowl(g, x, y, s, kind, fill, t) {
    g.fillStyle = 'rgba(0,0,0,.2)'; oval(g, x, y + 3, s * 0.56, s * 0.1); g.fill();
    const top = y - s * 0.3;
    const col = kind === 'water' ? '#4fb6e8' : kind === 'meat' ? '#e0464f' : '#ff9f43';
    g.fillStyle = kind === 'water' ? '#2f86b8' : '#5a3a22'; oval(g, x, top, s * 0.47, s * 0.09); g.fill();
    if (fill > 0.02) {
      if (kind === 'water') {
        g.fillStyle = 'rgba(140,220,255,.95)'; oval(g, x, top + 1, s * 0.42 * (0.6 + 0.4 * fill), s * 0.07 * (0.6 + 0.4 * fill)); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; oval(g, x, top + 1, s * 0.15 * (1 + (t * 1.5) % 1), s * 0.025 * (1 + (t * 1.5) % 1)); g.stroke();
      } else {
        g.fillStyle = kind === 'meat' ? '#c2453f' : '#b0703a';
        g.beginPath(); g.ellipse(x, top, s * 0.4, Math.max(0.1, s * 0.17 * fill), 0, Math.PI, 0); g.fill();
        g.fillStyle = kind === 'meat' ? '#e06a5f' : '#8a5428';
        for (let i = 0; i < 7; i++) { dot(g, x + (i - 3) * s * 0.1, top - s * 0.07 * fill * (1 - Math.abs(i - 3) / 4), s * 0.04); g.fill(); }
      }
    }
    g.fillStyle = col;
    g.beginPath(); g.moveTo(x - s * 0.5, top); g.lineTo(x + s * 0.5, top); g.lineTo(x + s * 0.38, y); g.lineTo(x - s * 0.38, y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x - s * 0.5, top, s, s * 0.05);
    addPawShape(g, x, top + (y - top) * 0.55, s * 0.12, 'rgba(255,255,255,.8)');
  }
  function drawCookie(g, x, y, r, rot) {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.fillStyle = '#d9a066'; dot(g, 0, 0, r); g.fill();
    g.fillStyle = '#6b3f22'; [[-0.35, -0.25], [0.3, -0.1], [-0.05, 0.4], [0.4, 0.38]].forEach(([dx, dy]) => { dot(g, dx * r, dy * r, r * 0.16); g.fill(); });
    g.restore();
  }
  function drawThought(g, x, y, s, ch, t) {
    const bob = Math.sin(t * 2.4) * s * 0.05;
    g.fillStyle = 'rgba(255,255,255,.95)';
    dot(g, x - s * 0.5, y + s * 0.62, s * 0.06); g.fill();
    dot(g, x - s * 0.36, y + s * 0.44, s * 0.1); g.fill();
    oval(g, x, y + bob, s * 0.42, s * 0.33); g.fill();
    emoji(g, ch, x, y + bob + 1, s * 0.34);
  }
  function drawStink(g, L, t) {
    g.strokeStyle = 'rgba(122,160,64,.75)'; g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const x = L.cx + (i - 1) * L.size * 0.36, y0 = L.cy + L.size * 0.05;
      g.beginPath();
      for (let k = 0; k <= 10; k++) {
        const yy = y0 - k * L.size * 0.025 - ((t * 24 + i * 13) % 18), xx = x + Math.sin(k * 0.9 + t * 4 + i) * 5;
        if (k) g.lineTo(xx, yy); else g.moveTo(xx, yy);
      }
      g.stroke();
    }
    g.fillStyle = '#222';
    for (let i = 0; i < 2; i++) {
      const a = t * (3 + i) + i * 2;
      dot(g, L.cx + Math.cos(a) * L.size * (0.35 + i * 0.08), L.cy - L.size * 0.25 + Math.sin(a * 1.3) * L.size * 0.12, 2.6); g.fill();
    }
  }
  function drawBrush(g, x, y, s, ang) {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = '#d9984f'; rrect(g, -s * 0.12, -s * 1.1, s * 0.24, s * 0.8, s * 0.1); g.fill();
    g.fillStyle = '#8a5530'; rrect(g, -s * 0.5, -s * 0.35, s, s * 0.35, s * 0.12); g.fill();
    g.strokeStyle = '#f6e7cf'; g.lineWidth = 2;
    for (let i = 0; i < 6; i++) { const bx = -s * 0.4 + i * s * 0.16; g.beginPath(); g.moveTo(bx, 0); g.lineTo(bx, s * 0.22); g.stroke(); }
    g.restore();
  }
  function drawShower(g, x, y, s) {
    g.save(); g.translate(x, y);
    g.strokeStyle = '#9aa7b1'; g.lineWidth = s * 0.08; g.lineCap = 'round';
    g.beginPath(); g.moveTo(s * 0.1, -s * 0.2); g.quadraticCurveTo(s * 0.5, -s * 0.6, s * 0.9, -s * 0.5); g.stroke();
    g.fillStyle = '#c7d2da'; rrect(g, -s * 0.32, -s * 0.28, s * 0.64, s * 0.24, s * 0.1); g.fill();
    g.fillStyle = '#7f8c96'; for (let i = 0; i < 4; i++) { dot(g, -s * 0.21 + i * s * 0.14, -s * 0.08, s * 0.03); g.fill(); }
    g.restore();
  }
  function drawTowel(g, x, y, s, t) {
    g.save(); g.translate(x, y); g.rotate(Math.sin(t * 9) * 0.15);
    g.fillStyle = '#ff9eb1'; rrect(g, -s * 0.45, -s * 0.3, s * 0.9, s * 0.6, s * 0.08); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(-s * 0.45, -s * 0.12, s * 0.9, s * 0.08); g.fillRect(-s * 0.45, s * 0.06, s * 0.9, s * 0.08);
    g.restore();
  }

  function drawHome(dt) {
    const { g, w, h } = fitCanvas($('wwHomeCanvas')), t = nowS(), d = S.dog;
    if (!d) return;
    const L = home.L = { cx: w / 2, cy: h * 0.47, size: Math.min(h * 0.74, w * 0.9) };
    const B = home.bath, night = S.phase === 'night';
    if (!home.stroke) home.happy = Math.max(0, home.happy - dt * 0.4);
    if (B) drawBathroom(g, w, h, t); else drawRoom(g, w, h, night, t);

    // reactions: eating, drinking, refusing, treats, shaking
    let eat = 0, lapping = false, tilt = 0, sx = 0;
    const bowl = home.bowl;
    if (bowl) {
      const a = t - bowl.t0;
      if (a > (bowl.refuse ? 1.7 : 2.6)) home.bowl = null;
      else if (bowl.refuse) { if (a > 0.3) tilt = -0.2 * Math.min(1, (a - 0.3) * 4); }
      else if (a > 0.35 && a < 2.2) {
        eat = 0.5 + 0.5 * Math.sin(a * 14);
        lapping = bowl.kind === 'water';
        if (Math.random() < 0.15) addPart(home.parts, lapping
          ? { kind: 'drop', x: L.cx + (Math.random() - 0.5) * 20, y: L.cy + L.size * 0.36, vx: (Math.random() - 0.5) * 80, vy: -90, g: 400, color: '#7fd0ff', size: 4, max: 0.5 }
          : { kind: 'crumb', x: L.cx + (Math.random() - 0.5) * 30, y: L.cy + L.size * 0.36, vx: (Math.random() - 0.5) * 90, vy: -80, g: 420, color: bowl.kind === 'meat' ? '#c2453f' : '#8a5428', size: 2.5, max: 0.6 });
      }
    }
    const tr = home.treat;
    let treatPos = null;
    if (tr) {
      const a = (t - tr.t0) / 0.55;
      if (a < 1) {
        const x0 = w * 0.88, y0 = h * 1.02, x1 = L.cx, y1 = L.cy - L.size * 0.07;
        treatPos = { x: lerp(x0, x1, a), y: lerp(y0, y1, a) - Math.sin(a * Math.PI) * h * 0.22, rot: a * 9 };
      } else {
        if (!tr.hit) { tr.hit = true; home.happy = 1; burst(home.parts, L.cx, L.cy - L.size * 0.1, 5, 'heart', ['#ff6f91', '#ff9eb1'], 15, 120); burst(home.parts, L.cx, L.cy - L.size * 0.05, 6, 'crumb', '#b07a45', 2.5, 140); }
        if (a < 2.2) eat = 0.5 + 0.5 * Math.sin(a * 16);
        else home.treat = null;
      }
    }
    const sh = t - home.shake;
    if (sh >= 0 && sh < 1.2) {
      sx = Math.sin(sh * 42) * L.size * 0.035 * (1 - sh / 1.2);
      if (Math.random() < 0.6) addPart(home.parts, { kind: 'drop', x: L.cx + (Math.random() - 0.5) * L.size * 0.7, y: L.cy + (Math.random() - 0.6) * L.size * 0.6, vx: (Math.random() - 0.5) * 360, vy: -120 - Math.random() * 120, g: 600, color: '#8fd6ff', size: 4 + Math.random() * 3, max: 0.7 });
    }

    // the dog
    let look = { x: Math.sin(t * 0.5) * 0.35, y: Math.sin(t * 0.37) * 0.2 };
    if (home.finger) look = { x: clamp((home.finger.x - L.cx) / (L.size * 0.5), -1, 1), y: clamp((home.finger.y - (L.cy - L.size * 0.2)) / (L.size * 0.5), -1, 1) };
    else if (treatPos) look = { x: clamp((treatPos.x - L.cx) / (L.size * 0.5), -1, 1), y: 0.6 };
    if (home.finger && home.stroke) tilt += clamp((home.finger.x - L.cx) / L.size, -0.5, 0.5) * 0.24;
    let dirt = clamp((55 - d.needs.clean) / 55, 0, 1), wet = 0;
    if (B) {
      if (B.step === 2) dirt *= 1 - clamp(B.p, 0, 1);
      if (B.step === 3) dirt = 0;
      wet = B.step === 1 ? 0 : B.step === 2 ? 1 : 1 - clamp(B.p, 0, 1) * 0.9;
    } else if (sh >= 0 && sh < 2.5) { wet = Math.max(0, 1 - sh / 2.5); dirt = 0; }
    const sleepy = d.needs.energy < 20 && !home.stroke;
    const happy = Math.max(home.happy, eat ? 0.45 : 0, sleepy ? 0.8 : 0);
    WW.art.drawPortrait(g, d, L.cx + sx, L.cy, L.size, { t, happy, tongue: (home.happy > 0.55 && !eat) || lapping, dirt, wet, look, tilt, eat });

    if (B) {
      ensureMask(B, L);
      drawFoam(g, B, t);
      drawTub(g, L, w, h, t);
      if (home.finger && B.step === 2) {
        for (let i = 0; i < 2; i++) addPart(home.parts, { kind: 'drop', x: home.finger.x + (Math.random() - 0.5) * L.size * 0.16, y: home.finger.y, vy: 260 + Math.random() * 120, g: 500, color: '#7fd0ff', size: 3 + Math.random() * 2, max: 0.6 });
      }
    } else if (d.needs.clean < WW.LOW) drawStink(g, L, t);
    if (bowl) {
      const a = t - bowl.t0, slide = Math.min(1, a / 0.3), out = bowl.refuse ? Math.max(0, (a - 1.3) / 0.4) : Math.max(0, (a - 2.2) / 0.4);
      const fill = bowl.refuse ? 1 : clamp(1 - (a - 0.35) / 1.85, 0, 1);
      drawBowl(g, L.cx, L.cy + L.size * 0.5 + (1 - slide) * h * 0.3 + out * h * 0.3, L.size * 0.36, bowl.kind, fill, t);
      if (bowl.refuse && a > 0.4) drawThought(g, L.cx + L.size * 0.36, L.cy - L.size * 0.4, L.size * 0.3, '😌', t);
    }
    if (treatPos) drawCookie(g, treatPos.x, treatPos.y, L.size * 0.045, treatPos.rot);
    if (!B && !bowl && !tr) {
      const urgent = WW.urgentNeed(d);
      const icon = urgent === 'food' ? '🍖' : urgent === 'water' ? '💧' : urgent === 'clean' ? '🛁' : urgent === 'mood' ? '🎾' : urgent === 'energy' ? '😴' : null;
      if (icon) drawThought(g, L.cx + L.size * 0.36, L.cy - L.size * 0.42, L.size * 0.3, icon, t);
    }
    if (sleepy && !B && Math.random() < dt * 1.2) addPart(home.parts, { kind: 'text', text: 'z', x: L.cx + L.size * 0.2, y: L.cy - L.size * 0.32, vx: 18, vy: -26, color: '#ffffff', size: 16 + Math.random() * 8, max: 1.6, rot: -0.2 });

    stepParts(home.parts, dt);
    drawParts(g, home.parts);

    // the tool under the finger
    const f = home.finger;
    if (f) {
      if (B) {
        if (B.step === 1) emoji(g, '🧴', f.x + 6, f.y - 18, L.size * 0.13, -0.3);
        else if (B.step === 2) drawShower(g, f.x, f.y - 6, L.size * 0.32);
        else drawTowel(g, f.x, f.y, L.size * 0.3, t);
      } else if (S.tool === 'brush') drawBrush(g, f.x, f.y, L.size * 0.17, clamp((f.dx || 0) * 0.04, -0.6, 0.6));
      else emoji(g, '✋', f.x, f.y - 6, L.size * 0.13, clamp((f.dx || 0) * 0.03, -0.4, 0.4));
    }
    if (home.hint) {
      const a = t - home.hint.t0;
      if (a > 2.6) home.hint = null;
      else { g.globalAlpha = Math.min(1, a * 5, (2.6 - a) * 3); pill(g, home.hint.text, w / 2, B ? 96 : 24, 14); g.globalAlpha = 1; }
    }
  }

  // --- shop + bag + passport sheets ---
  function openSheet(name) {
    if (!S.dog) return;
    $('wwFeedPick').classList.remove('open');
    S.sheet = name;
    ['wwShop', 'wwBag', 'wwMenu'].forEach(id => $(id).classList.toggle('open', id === { shop: 'wwShop', bag: 'wwBag', menu: 'wwMenu' }[name]));
    $('wwDim').classList.toggle('open', !!name);
    if (name === 'shop') renderShop();
    if (name === 'bag') renderBag();
    if (name === 'menu') { renderMenu(); disarmMoveOut(); }
    vibrate(6);
  }
  function closeSheets() {
    S.sheet = null;
    ['wwShop', 'wwBag', 'wwMenu'].forEach(id => $(id).classList.remove('open'));
    $('wwDim').classList.remove('open');
  }
  $('wwShopBtn').addEventListener('click', () => openSheet('shop'));
  $('wwBagBtn').addEventListener('click', () => openSheet('bag'));
  $('wwMenuBtn').addEventListener('click', () => openSheet('menu'));
  $('wwDim').addEventListener('click', closeSheets);
  document.querySelectorAll('#v-ww-home .ww-close').forEach(b => b.addEventListener('click', closeSheets));

  const shopRows = {};
  function renderShop() {
    const d = S.dog, list = $('wwShopList');
    if (!d) return;
    if (!list.children.length) {
      list.appendChild(el('div', 'ww-sec', 'Futter & Pflege'));
      WW.SHOP.forEach((k, idx) => {
        const it = WW.ITEMS[k];
        if (idx > 0 && it.kind === 'toy' && WW.ITEMS[WW.SHOP[idx - 1]].kind !== 'toy') list.appendChild(el('div', 'ww-sec', 'Spielzeug'));
        const row = el('div', 'ww-item'), tx = el('div', 'ww-tx'), btn = el('button', 'ww-price');
        row.dataset.item = k;
        btn.dataset.item = k;
        tx.append(el('b', null, it.label), el('span', null, it.desc));
        row.append(el('div', 'ww-em', it.emoji), tx, btn);
        btn.addEventListener('click', () => {
          if (btn.classList.contains('owned')) { toast(it.emoji + ' ' + it.label + ' hast du schon', 'info'); return; }
          row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
          vibrate(12);
          send({ t: 'wwBuy', item: k });
        });
        shopRows[k] = { row, tx, btn };
        list.appendChild(row);
      });
      list.appendChild(el('div', 'ww-empty', '💡 Fundstücke vom Gassi verkaufst du in der 🎒 Tasche.'));
    }
    WW.SHOP.forEach(k => {
      const it = WW.ITEMS[k], r = shopRows[k], owned = it.kind === 'toy' && d.toys.indexOf(k) >= 0;
      r.btn.className = 'ww-price' + (owned ? ' owned' : d.coins < it.price ? ' poor' : '');
      r.btn.textContent = owned ? '✓ Hast du' : it.price + ' 🪙';
      r.tx.lastChild.textContent = it.desc + (it.kind === 'use' ? ' · im Schrank: ' + (d.inv[k] || 0) : '');
    });
  }
  let bagSig = '';
  function renderBag() {
    const d = S.dog, body = $('wwBagBody');
    if (!d) return;
    const sig = JSON.stringify([d.inv, d.toys, d.finds, d.stats, d.days, d.love]);
    if (sig === bagSig && body.children.length) return;
    bagSig = sig;
    body.textContent = '';
    body.appendChild(el('div', 'ww-sec', 'Vorräte'));
    const sup = el('div', 'ww-chips');
    WW.USES.forEach(k => sup.appendChild(el('span', 'ww-chipi', WW.ITEMS[k].emoji + ' ' + WW.ITEMS[k].label + ' × ' + (d.inv[k] || 0))));
    body.appendChild(sup);
    body.appendChild(el('div', 'ww-sec', 'Spielzeug'));
    const toys = el('div', 'ww-chips');
    d.toys.forEach(k => toys.appendChild(el('span', 'ww-chipi', WW.ITEMS[k].emoji + ' ' + WW.ITEMS[k].label)));
    body.appendChild(toys);
    body.appendChild(el('div', 'ww-sec', 'Fundstücke'));
    const finds = WW.FINDS.filter(k => d.finds[k] > 0);
    if (!finds.length) body.appendChild(el('div', 'ww-empty', 'Noch nichts gefunden — beim Gassi an 💨 Schnüffelstellen buddeln!'));
    finds.forEach(k => {
      const it = WW.ITEMS[k], row = el('div', 'ww-item'), tx = el('div', 'ww-tx');
      tx.append(el('b', null, it.label + ' × ' + d.finds[k]), el('span', null, WW.RARE[k] ? '✨ Selten!' : 'Trödel vom Gassi'));
      const btn = el('button', 'ww-price sell', '+' + it.sell + ' 🪙');
      btn.dataset.item = k;
      btn.addEventListener('click', () => { vibrate(12); send({ t: 'wwSell', item: k }); });
      row.append(el('div', 'ww-em', it.emoji), tx, btn);
      body.appendChild(row);
    });
    body.appendChild(el('div', 'ww-sec', 'Rekorde'));
    const st = el('div', 'ww-stats');
    [['📅', d.days, 'Tage in der WG'], ['🦮', d.stats.walks, 'Gassi-Runden'], ['🎾', d.stats.fetches, 'Mal apportiert'], ['🔎', d.stats.finds, 'Funde'], ['🛁', d.stats.baths, 'Schaumbäder'], ['❤️', d.love, 'Zuneigung']].forEach(([e, n, l]) => {
      const c = el('div', 'ww-stat'); c.append(el('b', null, e + ' ' + n), document.createTextNode(l)); st.appendChild(c);
    });
    body.appendChild(st);
  }
  function renderMenu() {
    const d = S.dog;
    if (!d) return;
    const b = WW.BREEDS[d.breed], lv = S.level, lo = WW.LOVE_LEVELS[lv], hi = WW.LOVE_LEVELS[lv + 1];
    $('wwPassName').textContent = d.name;
    $('wwPassBreed').textContent = b.label + ' · ' + (b.coats[d.coat] || b.coats[0]).label;
    $('wwPassDays').textContent = d.days ? '📅 seit ' + d.days + (d.days === 1 ? ' Tag' : ' Tagen') + ' in der WG' : '📅 ganz neu in der WG';
    $('wwPassLove').textContent = heartsText(lv) + '  ' + WW.LOVE_NAMES[lv];
    $('wwPassLoveBar').style.width = (hi ? Math.round(clamp((d.love - lo) / (hi - lo), 0, 1) * 100) : 100) + '%';
    $('wwPassNext').textContent = hi ? 'Noch ' + (hi - d.love) + ' ❤️ bis „' + WW.LOVE_NAMES[lv + 1] + '“' : 'Unzertrennlich! 💞';
    const td = S.today || { love: 0, coins: 0, finds: [] }, box = $('wwPassToday');
    box.textContent = '';
    [['❤️', '+' + td.love, 'Zuneigung'], ['🪙', '+' + td.coins, 'Taler'], ['🔎', (td.finds || []).length, 'Funde'], ['😊', Math.round(d.needs.mood), 'Laune']].forEach(([e, n, l]) => {
      const c = el('div', 'ww-stat'); c.append(el('b', null, e + ' ' + n), document.createTextNode(l)); box.appendChild(c);
    });
  }
  let moveOutArm = 0;
  function disarmMoveOut() { moveOutArm = 0; $('wwMoveOutBtn').classList.remove('armed'); $('wwMoveOutBtn').textContent = '🏠 Hund abgeben'; }
  $('wwMoveOutBtn').addEventListener('click', () => {
    if (!S.dog) return;
    if (Date.now() < moveOutArm) {
      disarmMoveOut();
      closeSheets();
      forgetDog();
      S.haveDog = false; S.dog = null; S.adoptOpen = true; S.backup = null;
      showAdopt(); route();
      vibrate([40, 60, 40]);
      send({ t: 'wwMoveOut' });
    } else {
      moveOutArm = Date.now() + 3000;
      $('wwMoveOutBtn').classList.add('armed');
      $('wwMoveOutBtn').textContent = 'Wirklich? ' + S.dog.name + ' zieht aus 😢 — nochmal tippen';
      setTimeout(() => { if (Date.now() >= moveOutArm) disarmMoveOut(); }, 3100);
    }
  });

  // --- night summary ---
  function renderNight() {
    const N = S.night, open = S.phase === 'night' && !!N && !S.nightHidden;
    $('wwNightCard').classList.toggle('open', open);
    $('wwNightOpen').style.display = S.phase === 'night' && N && S.nightHidden ? 'inline-block' : 'none';
    if (!N) return;
    $('wwNightTitle').textContent = '🌙 Tagesbilanz · Tag ' + S.day;
    const rows = $('wwNightRows'), best = N.rows.filter(r => r.best);
    rows.textContent = '';
    N.rows.forEach(r => {
      const row = el('div', 'ww-nrow' + (r.you ? ' you' : '') + (r.best ? ' best' : ''));
      const finds = r.finds.slice(0, 4).map(k => item(k).emoji).join('');
      row.append(el('b', null, (r.best ? '👑 ' : '') + r.dog), el('span', null, '+' + r.love + ' ❤️  +' + r.coins + ' 🪙' + (finds ? '  ' + finds : '')), el('i', null, r.owner + (r.you ? ' (du)' : '')));
      rows.appendChild(row);
    });
    $('wwNightBest').textContent = best.length
      ? (best.some(r => r.you) ? '🎉 ' : '') + best.map(r => r.dog).join(' & ') + (best.length > 1 ? ' sind' : ' ist') + ' Hund des Tages!'
      : 'Ein gemütlicher Tag in der WG 🐾';
    const host = amHost();
    $('wwNextBtn').style.display = host ? '' : 'none';
    $('wwNightWait').style.display = host ? 'none' : '';
  }
  $('wwNextBtn').addEventListener('click', () => { vibrate(15); send({ t: 'wwNext' }); });
  $('wwNightClose').addEventListener('click', () => { S.nightHidden = true; renderNight(); });
  $('wwNightOpen').addEventListener('click', () => { S.nightHidden = false; renderNight(); });

  // ============================================================
  // GASSI — floating leash pad + dig / poop / heel
  // ============================================================
  function sendMove(x, y, force) {
    const now = performance.now();
    if (!force && (now - walk.lastSent < MOVE_GAP_MS || (Math.abs(x - walk.lastX) < MOVE_EPS && Math.abs(y - walk.lastY) < MOVE_EPS))) return;
    walk.lastSent = now; walk.lastX = x; walk.lastY = y;
    send({ t: 'wwMove', x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  }
  function leashTo(x, y) {
    const o = walk.origin, R = walk.R || 70;
    let dx = (x - o.x) / R, dy = (y - o.y) / R;
    const m = Math.hypot(dx, dy);
    if (m > 1) { o.x = x - dx / m * R; o.y = y - dy / m * R; dx /= m; dy /= m; }   // the base follows: a leash, not a box
    walk.finger = { x, y };
    walk.vec = Math.hypot(dx, dy) < DEADZONE ? { x: 0, y: 0 } : { x: dx, y: dy };
    sendMove(walk.vec.x, walk.vec.y, false);
  }
  function leashUp() {
    walk.origin = null; walk.finger = null; walk.vec = { x: 0, y: 0 };
    sendMove(0, 0, true);
  }
  bindPad($('wwWalkPad'), {
    down(x, y) { walk.origin = { x, y }; walk.finger = { x, y }; vibrate(5); },
    move(x, y) { if (walk.origin) leashTo(x, y); },
    up: leashUp,
    cancel: leashUp
  });
  $('wwDigBtn').addEventListener('click', () => {
    if (!S.walk.dig) { nudge('wwDigBtn'); toast('💨 Erst eine Schnüffelstelle finden!', 'info'); return; }
    const now = performance.now();
    if (now - walk.lastDig < DIG_GAP_MS) return;
    walk.lastDig = now;
    send({ t: 'wwDig' });
    vibrate(8);
    const c = $('wwWalkPad');
    burst(walk.parts, (c._w || 320) / 2, (c._h || 380) * 0.62, 5, 'dirt', ['#8a5a2b', '#a87442', '#6b4420'], 4, 170);
  });
  $('wwPoopBtn').addEventListener('click', () => {
    if (!S.walk.poop) { nudge('wwPoopBtn'); return; }
    S.walk.poop = 0; updateWalkUi();
    vibrate(15);
    send({ t: 'wwPoop' });
  });
  $('wwHeelBtn').addEventListener('click', () => {
    if (!S.walk.cat) { nudge('wwHeelBtn'); return; }
    S.walk.cat = 0; updateWalkUi();
    vibrate([20, 30, 20]);
    send({ t: 'wwHeel' });
  });
  function updateWalkUi() {
    const st = S.walk, name = dogName();
    $('wwDigBtn').classList.toggle('on', !!st.dig);
    $('wwPoopBtn').classList.toggle('on', !!st.poop);
    $('wwHeelBtn').classList.toggle('on', !!st.cat);
    $('wwDigProg').style.width = Math.round(clamp(st.digP || 0, 0, 1) * 100) + '%';
    $('wwWalkHint').textContent = st.cat ? '🐈 Eine Katze! Ruf ' + name + ' zurück!'
      : st.poop ? '💩 Hoppla — bitte aufsammeln!'
        : st.dig ? '💨 ' + name + ' hat was gewittert — buddeln!'
          : 'Zieh am Feld, um ' + name + ' zu führen';
  }
  function showFind(d) {
    const it = item(d.item);
    $('wwFindEmoji').textContent = it ? it.emoji : '🎁';
    $('wwFindText').textContent = d.text;
    const card = $('wwFindCard'), rare = !!(it && WW.RARE[d.item]);
    card.classList.toggle('rare', rare);
    $('wwFindRare').style.display = rare ? '' : 'none';
    card.classList.remove('show'); void card.offsetWidth; card.classList.add('show');
    clearTimeout(walk.findTimer);
    walk.findTimer = setTimeout(() => card.classList.remove('show'), 2600);
    const c = $('wwWalkPad');
    burst(walk.parts, (c._w || 320) / 2, (c._h || 380) / 2, rare ? 18 : 10, 'spark', rare ? ['#ffd66b', '#fff3a0', '#ffffff'] : ['#ffffff', '#fff3c4'], 9, 240);
  }
  function walkTufts(w, h) {
    const key = w + 'x' + h;
    if (walk.tuftKey === key) return walk.tufts;
    walk.tuftKey = key;
    const r = WW.rng(17), list = [];
    for (let i = 0; i < Math.round(w * h / 1800); i++) list.push({ x: r() * w, y: r() * h, s: 4 + r() * 6, flower: r() < 0.08 ? WW.pick(['#ffffff', '#ffd60a', '#ff9eb1', '#bf9aff'], r) : null });
    return (walk.tufts = list);
  }
  function drawFaceKnob(g, d, x, y, r, t, happy) {
    g.fillStyle = 'rgba(0,0,0,.18)'; oval(g, x, y + r * 0.95, r * 0.9, r * 0.25); g.fill();
    g.save(); dot(g, x, y, r); g.fillStyle = '#fff1dd'; g.fill(); g.clip();
    const size = r * 3.3;
    WW.art.drawPortrait(g, d, x, y + size * 0.22, size, { t, happy, tongue: happy > 0.5 });
    g.restore();
    g.strokeStyle = '#ffffff'; g.lineWidth = 4; dot(g, x, y, r); g.stroke();
  }
  function drawWalk(dt) {
    const { g, w, h } = fitCanvas($('wwWalkPad')), t = nowS(), d = S.dog;
    if (!d) return;
    const R = walk.R = clamp(Math.min(w, h) * 0.2, 46, 100);
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#a6df8f'); bg.addColorStop(1, '#5fae5f');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // winding path scrolling past while walking
    const scroll = (t * 40) % 80;
    g.strokeStyle = '#ead6a6'; g.lineWidth = w * 0.24; g.lineCap = 'round';
    g.beginPath(); g.moveTo(w * 0.5, h + 30); g.bezierCurveTo(w * 0.12, h * 0.68, w * 0.88, h * 0.34, w * 0.5, -30); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3; g.setLineDash([14, 18]); g.lineDashOffset = -scroll;
    g.beginPath(); g.moveTo(w * 0.5, h + 30); g.bezierCurveTo(w * 0.12, h * 0.68, w * 0.88, h * 0.34, w * 0.5, -30); g.stroke();
    g.setLineDash([]);
    walkTufts(w, h).forEach(tf => {
      if (tf.flower) { g.fillStyle = tf.flower; for (let k = 0; k < 5; k++) { dot(g, tf.x + Math.cos(k * 1.26) * 3.5, tf.y + Math.sin(k * 1.26) * 3.5, 2.6); g.fill(); } g.fillStyle = '#ffcc33'; dot(g, tf.x, tf.y, 2); g.fill(); return; }
      g.strokeStyle = 'rgba(40,110,50,.45)'; g.lineWidth = 2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(tf.x - tf.s * 0.4, tf.y - tf.s); g.lineTo(tf.x, tf.y); g.lineTo(tf.x + tf.s * 0.4, tf.y - tf.s); g.stroke();
    });
    // paw prints trail behind the knob
    const m = Math.hypot(walk.vec.x, walk.vec.y);
    walk.pawT += dt * m;
    if (walk.finger && walk.pawT > 0.18) {
      walk.pawT = 0;
      const side = (walk.pawSide = -(walk.pawSide || 1));
      const ang = Math.atan2(walk.vec.y, walk.vec.x) + Math.PI / 2;
      addPart(walk.parts, { kind: 'paw', x: walk.finger.x - walk.vec.x * R * 0.6 + Math.cos(ang - Math.PI / 2) * side * 8, y: walk.finger.y - walk.vec.y * R * 0.6 + Math.sin(ang - Math.PI / 2) * side * 8, rot: ang, color: 'rgba(90,60,30,.35)', size: 9, max: 1.4 });
    }
    stepParts(walk.parts, dt);
    drawParts(g, walk.parts);
    const happy = 0.4 + 0.3 * Math.sin(t * 3);
    if (walk.origin && walk.finger) {
      const o = walk.origin, f = walk.finger;
      g.fillStyle = 'rgba(255,255,255,.14)'; dot(g, o.x, o.y, R); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 3; g.setLineDash([8, 8]); dot(g, o.x, o.y, R); g.stroke(); g.setLineDash([]);
      g.strokeStyle = '#d6453d'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(o.x, o.y); g.quadraticCurveTo((o.x + f.x) / 2, (o.y + f.y) / 2 + R * 0.35 * (1 - m), f.x, f.y); g.stroke();
      g.fillStyle = '#d6453d'; dot(g, o.x, o.y, 9); g.fill();
      if (m > 0.2) {
        const ang = Math.atan2(walk.vec.y, walk.vec.x);
        g.fillStyle = 'rgba(255,255,255,.85)';
        for (let i = 0; i < 2; i++) {
          const k = R * (0.75 + i * 0.28) + ((t * 60) % 14);
          g.save(); g.translate(f.x + Math.cos(ang) * k * 0.6, f.y + Math.sin(ang) * k * 0.6); g.rotate(ang);
          g.beginPath(); g.moveTo(8, 0); g.lineTo(-4, -7); g.lineTo(-1, 0); g.lineTo(-4, 7); g.closePath(); g.fill(); g.restore();
        }
      }
      drawFaceKnob(g, d, f.x, f.y, R * 0.46, t, happy);
    } else {
      const cx = w / 2, cy = h * 0.5, pulse = 1 + 0.06 * Math.sin(t * 3);
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 3; g.setLineDash([8, 8]); dot(g, cx, cy, R * pulse); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,.75)';
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([ax, ay]) => {
        g.save(); g.translate(cx + ax * R * 1.25, cy + ay * R * 1.25); g.rotate(Math.atan2(ay, ax));
        g.beginPath(); g.moveTo(10, 0); g.lineTo(-6, -9); g.lineTo(-6, 9); g.closePath(); g.fill(); g.restore();
      });
      drawFaceKnob(g, d, cx, cy, R * 0.5, t, happy);
      pill(g, 'Ziehen zum Führen', cx, cy + R * 1.8, 13);
    }
    if (S.walk.dig) {
      for (let i = 0; i < 3; i++) {
        const a = t * 1.6 + i * 2.1, x = w / 2 + Math.cos(a) * R * 1.6, y = h * 0.2 + Math.sin(a * 1.3) * 12 + i * 6;
        g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 4 + i); emoji(g, '💨', x, y, 26); g.globalAlpha = 1;
      }
    }
    if (S.walk.cat) {
      const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      v.addColorStop(0, 'rgba(255,60,60,0)'); v.addColorStop(1, 'rgba(255,60,60,' + (0.25 + 0.15 * Math.sin(t * 8)) + ')');
      g.fillStyle = v; g.fillRect(0, 0, w, h);
      emoji(g, '🐈', w - 40, 42 + Math.sin(t * 6) * 5, 40);
    }
  }

  // ============================================================
  // PARK — swipe to throw, toy picker, a little fetch mirror
  // ============================================================
  function canThrow() { return !!S.park.ready && park.anim === 'hand'; }
  function renderToys() {
    const d = S.dog, box = $('wwToyPicker');
    if (!d) return;
    if (d.toys.indexOf(S.toy) < 0) S.toy = 'ball';
    const sig = d.toys.join();
    if (sig !== park.toySig) {
      park.toySig = sig;
      box.textContent = '';
      d.toys.forEach(k => {
        const b = el('button', 'ww-toy');
        b.dataset.toy = k;
        b.append(el('b', null, WW.ITEMS[k].emoji), el('span', null, WW.ITEMS[k].label));
        b.addEventListener('click', () => { if (!canThrow()) { nudge('wwThrowPad'); return; } S.toy = k; renderToys(); vibrate(6); });
        box.appendChild(b);
      });
    }
    [...box.children].forEach(b => { b.classList.toggle('sel', b.dataset.toy === S.toy); b.disabled = !canThrow(); });
  }
  function updateParkUi() {
    const p = S.park, name = dogName();
    $('wwParkHint').textContent = p.tired ? '😴 ' + name + ' ist müde — kurze Pause'
      : !p.ready || park.anim !== 'hand' ? '🐕 ' + name + ' holt ' + (TOY_ACC[p.toy || S.toy] || 'das Spielzeug') + '…'
        : '⬆️ Nach oben wischen — Schwung = Weite';
    [...$('wwToyPicker').children].forEach(b => { b.disabled = !canThrow(); });
  }
  bindPad($('wwThrowPad'), {
    down(x, y) {
      park.idleT = 0;
      if (!canThrow()) { vibrate(5); return; }
      park.drag = { x0: x, y0: y, x, y, hist: [{ x, y, t: performance.now() }] };
    },
    move(x, y) {
      const dr = park.drag;
      if (!dr) return;
      dr.x = x; dr.y = y;
      const now = performance.now();
      dr.hist.push({ x, y, t: now });
      while (dr.hist.length > 2 && now - dr.hist[0].t > 100) dr.hist.shift();
    },
    up(x, y) {
      const dr = park.drag;
      park.drag = null;
      if (!dr) return;
      const dx = x - dr.x0, dy = y - dr.y0, dist = Math.hypot(dx, dy);
      if (dist < 30) return;
      if (dy > -12) { toast('⬆️ Nach oben wischen zum Werfen!', 'info'); return; }
      const now = performance.now(), h0 = dr.hist[0];
      const speed = Math.hypot(x - h0.x, y - h0.y) / Math.max(16, now - h0.t);      // px per ms over the last ~100 ms
      const c = $('wwThrowPad'), norm = Math.min(c._w || 320, c._h || 380);
      const power = clamp(speed * 320 / norm / 2.4, 0.12, 1);
      const nx = dx / dist, ny = dy / dist;
      send({ t: 'wwThrow', toy: S.toy, dx: Math.round(nx * 100) / 100, dy: Math.round(ny * 100) / 100, power: Math.round(power * 100) / 100 });
      vibrate(15);
      throwLocal(nx, power, { x, y });
      S.park.ready = 0; S.park.toy = S.toy;
      updateParkUi();
    },
    cancel() { park.drag = null; }
  });
  function parkGeo(w, h) { return { W: w, H: h, hz: h * 0.36, hand: { x: w / 2, y: h * 0.86 }, seat: { x: w * 0.22, y: h * 0.93 } }; }
  function persp(G, y) { return (0.3 + 0.85 * clamp((y - G.hz) / (G.H - G.hz), 0, 1)) * Math.min(1.4, G.W / 380); }
  function throwLocal(nx, power, from) {
    const G = park.G || parkGeo(320, 380);
    const reach = 0.25 + 0.75 * power;
    park.anim = 'fly';
    park.fly = {
      t0: nowS(), from: { x: from.x, y: from.y }, toy: S.toy, reach, dur: 0.5 + 0.5 * reach,
      to: { x: clamp(G.W / 2 + nx * G.W * 0.6 * reach, G.W * 0.08, G.W * 0.92), y: G.H - (G.H - G.hz) * (0.15 + 0.78 * reach) }
    };
    park.carry = false; park.toyPos = null;
    park.guard = nowS() + PARK_GUARD_S;
  }
  function moveDog(p, tgt, speed, dt) {
    const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy);
    if (d < 4) { p.moving = false; return true; }
    const step = Math.min(d, speed * dt);
    p.x += dx / d * step; p.y += dy / d * step;
    p.moving = true;
    if (Math.abs(dx) > 1) p.face = dx > 0 ? 1 : -1;
    return false;
  }
  function drawLawn(g, G, t) {
    const { W: w, H: h, hz } = G;
    const sky = g.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#79c6ff'); sky.addColorStop(1, '#d8f1ff');
    g.fillStyle = sky; g.fillRect(0, 0, w, hz + 2);
    g.fillStyle = '#fff1a8'; dot(g, w * 0.82, hz * 0.32, hz * 0.14); g.fill();
    g.fillStyle = 'rgba(255,255,255,.9)';
    [[0.2, 0.3, 1], [0.6, 0.18, 0.8]].forEach(([fx, fy, s], i) => {
      const cx = ((fx * w + t * (6 + i * 4)) % (w + 120)) - 60, cy = hz * fy;
      dot(g, cx, cy, 16 * s); g.fill(); dot(g, cx + 18 * s, cy - 6 * s, 20 * s); g.fill(); dot(g, cx + 38 * s, cy, 14 * s); g.fill();
    });
    g.fillStyle = '#7cc47f';
    g.beginPath(); g.moveTo(0, hz); g.quadraticCurveTo(w * 0.25, hz - h * 0.08, w * 0.55, hz); g.quadraticCurveTo(w * 0.8, hz - h * 0.06, w, hz); g.lineTo(w, hz + 4); g.lineTo(0, hz + 4); g.fill();
    for (let i = 0; i < 7; i++) {
      const x = (i + 0.3) * w / 6.5, s = 10 + (i % 3) * 4;
      g.fillStyle = '#6b4a2b'; g.fillRect(x - 2, hz - s * 0.4, 4, s * 0.6);
      g.fillStyle = i % 2 ? '#3f8f4a' : '#4fa156'; dot(g, x, hz - s * 0.9, s * 0.75); g.fill();
    }
    const lawn = g.createLinearGradient(0, hz, 0, h);
    lawn.addColorStop(0, '#8fd36f'); lawn.addColorStop(1, '#4e9f48');
    g.fillStyle = lawn; g.fillRect(0, hz, w, h - hz);
    g.fillStyle = 'rgba(255,255,255,.07)';
    const vx = w / 2, vy = hz - h * 0.5;
    for (let i = -6; i <= 6; i += 2) {
      const xa = w / 2 + i * w * 0.18, xb = w / 2 + (i + 1) * w * 0.18;
      const k = (hz - vy) / (h - vy);
      g.beginPath(); g.moveTo(vx + (xa - vx) * k, hz); g.lineTo(vx + (xb - vx) * k, hz); g.lineTo(xb, h); g.lineTo(xa, h); g.closePath(); g.fill();
    }
    const r = WW.rng(5);
    for (let i = 0; i < 14; i++) {
      const fy = hz + (h - hz) * (0.1 + r() * 0.85), fx = r() * w, s = persp(G, fy) * 3;
      g.fillStyle = WW.pick(['#ffffff', '#ffd60a', '#ff9eb1'], r);
      dot(g, fx, fy, s); g.fill();
    }
  }
  function drawPark(dt) {
    const { g, w, h } = fitCanvas($('wwThrowPad')), t = nowS(), d = S.dog;
    if (!d) return;
    const G = park.G = parkGeo(w, h);
    if (park.anim !== 'hand' && park.guard && t > park.guard) {   // no news from the TV: take the toy back
      park.anim = 'hand'; park.carry = false; park.toyPos = null; park.fly = null; park.guard = 0; S.park.ready = 1;
      updateParkUi(); renderToys();
    }
    drawLawn(g, G, t);
    const tired = !!S.park.tired;
    const dp = park.dogPos || (park.dogPos = { x: G.seat.x, y: G.seat.y, face: 1 });
    const spd = h * 0.6 * (tired ? 0.5 : 1);
    let flying = null;
    if (park.anim === 'fly') {
      const F = park.fly, a = (t - F.t0) / F.dur;
      if (a >= 1) {
        park.anim = 'fetch'; park.toyPos = { x: F.to.x, y: F.to.y };
        burst(park.parts, F.to.x, F.to.y, 6, 'dirt', ['#5d9b4b', '#86c96b'], 3, 90);
      } else {
        flying = { x: lerp(F.from.x, F.to.x, a), y: lerp(F.from.y, F.to.y, a) - Math.sin(a * Math.PI) * h * 0.28 * (0.5 + F.reach), s: lerp(2.6, persp(G, F.to.y) * 1.6, a), rot: a * 10 };
      }
      moveDog(dp, F.to, spd * 0.85, dt);
    }
    if (park.anim === 'fetch' && moveDog(dp, park.toyPos, spd, dt)) {
      park.carry = true; park.toyPos = null; park.anim = 'hold'; vibrate(8);
    }
    if (park.anim === 'hold' && S.park.ready) park.anim = 'return';
    if (park.anim === 'return' && moveDog(dp, { x: G.hand.x - w * 0.12, y: G.hand.y + h * 0.04 }, spd, dt)) {
      park.anim = 'hand'; park.carry = false;
      burst(park.parts, G.hand.x, G.hand.y - 20, 6, 'heart', ['#ff6f91', '#ff9eb1'], 15, 120);
      vibrate([15, 30, 15]);
      updateParkUi(); renderToys();
    }
    if (park.anim === 'hand') moveDog(dp, G.seat, spd * 0.45, dt);
    // depth order: toy on the ground and the dog by y
    const items = [{ y: dp.y, draw: () => {
      const pose = dp.moving ? 'run' : park.anim === 'hand' ? (tired ? 'sleep' : 'sit') : 'stand';
      WW.art.drawDog(g, d, dp.x, dp.y, { scale: persp(G, dp.y) * 1.25, facing: dp.face || 1, pose, t, wag: 1, mouth: park.carry ? (park.fly ? park.fly.toy : S.toy) : null, tongue: dp.moving || park.anim === 'hold' });
      if (tired && !dp.moving && Math.random() < dt) addPart(park.parts, { kind: 'text', text: 'z', x: dp.x + 10, y: dp.y - 40, vx: 14, vy: -22, color: '#ffffff', size: 16, max: 1.5 });
    } }];
    if (park.toyPos) items.push({ y: park.toyPos.y, draw: () => WW.art.drawToy(g, park.fly.toy, park.toyPos.x, park.toyPos.y - 4, persp(G, park.toyPos.y) * 1.6, 0) });
    items.sort((a, b) => a.y - b.y).forEach(it => it.draw());
    if (flying) {
      g.fillStyle = 'rgba(0,0,0,.15)'; oval(g, flying.x, lerp(park.fly.from.y, park.fly.to.y, (t - park.fly.t0) / park.fly.dur), 10 * flying.s * 0.6, 3 * flying.s * 0.6); g.fill();
      WW.art.drawToy(g, park.fly.toy, flying.x, flying.y, flying.s, flying.rot);
    }
    // the toy in your hand
    if (park.anim === 'hand') {
      const ready = !!S.park.ready, dr = park.drag;
      g.globalAlpha = ready ? 1 : 0.35;
      if (dr) {
        const dx = dr.x - dr.x0, dy = dr.y - dr.y0, len = Math.hypot(dx, dy);
        if (len > 10 && dy < 0) {
          g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 3; g.setLineDash([6, 10]);
          g.beginPath(); g.moveTo(dr.x, dr.y); g.lineTo(dr.x + dx / len * h * 0.35, dr.y + dy / len * h * 0.35); g.stroke(); g.setLineDash([]);
        }
        WW.art.drawToy(g, S.toy, dr.x, dr.y, 2.9, 0);
      } else {
        park.idleT += dt;
        const bob = Math.sin(t * 3) * 4;
        g.fillStyle = 'rgba(0,0,0,.15)'; oval(g, G.hand.x, G.hand.y + 24, 22, 6); g.fill();
        WW.art.drawToy(g, S.toy, G.hand.x, G.hand.y + bob, 2.9, 0);
        if (ready && park.idleT > 1.5) {
          const k = (t * 0.9) % 1;
          g.globalAlpha = (1 - k) * 0.8;
          emoji(g, '👆', G.hand.x + 26, G.hand.y + 10 - k * h * 0.25, 30);
        }
      }
      g.globalAlpha = 1;
    }
    stepParts(park.parts, dt);
    drawParts(g, park.parts);
    if (tired && park.anim === 'hand') pill(g, '😴 ' + d.name + ' braucht eine Pause', w / 2, G.hz + 26, 13);
  }

  // ============================================================
  // messages + routing
  // ============================================================
  function route() {
    if (!S.haveDog) { showView(S.adoptOpen ? 'ww-adopt' : 'ww-hi'); return; }
    showView(S.phase === 'walk' ? 'ww-walk' : S.phase === 'park' ? 'ww-park' : 'ww-home');
  }
  function onYou(d) {
    const dog = cleanDog(d.dog);
    if (!dog) return;
    const first = !S.haveDog, oldLevel = S.level;
    S.dog = dog; S.today = cleanToday(d.today);
    S.level = typeof d.level === 'number' && isFinite(d.level) ? clamp(d.level | 0, 0, WW.LOVE_LEVELS.length - 1) : WW.loveLevel(dog.love);
    saveDog(dog, d.slot);
    S.haveDog = true; S.adoptOpen = false;
    $('wwRestoreCard').classList.remove('open');
    if (first) {
      if (S.adopting) { toast('🏠 Willkommen zuhause, ' + dog.name + '!', 'good'); home.happy = 1; vibrate([20, 40, 20, 40, 80]); }
      S.adopting = false;
      $('wwAdoptBtn').disabled = false;
    } else if (S.level > oldLevel && home.L) {
      burst(home.parts, home.L.cx, home.L.cy - home.L.size * 0.3, 10, 'heart', ['#ff4f8b', '#ff8fab', '#ffbf69'], 18, 180);
    }
    renderStatus();
    route();
  }
  // The TV has no dog for this seat (new phone, moved out, refused record): drop the local copy too.
  // Otherwise a wwYou that was still on the wire when "Hund abgeben" was confirmed would bring it back.
  function onAdopt(d) {
    const b = d.backup;
    S.haveDog = false; S.dog = null; S.adopting = false;
    S.adoptOpen = true;
    S.backup = b && typeof b === 'object' && own(WW.BREEDS, b.breed) ? { name: WW.cleanName(str(b.name, 40)) || 'Wuffi', breed: b.breed, coat: clamp(b.coat | 0, 0, 2) } : null;
    forgetDog();
    closeSheets(); home.bath = null; updateBathBar();
    showAdopt();
    route();
  }
  function onPhase(d) {
    if (WW.PHASES.indexOf(d.phase) < 0) return;
    const prev = S.phase;
    S.phase = d.phase; S.day = d.day | 0 || S.day; S.left = typeof d.left === 'number' && isFinite(d.left) ? d.left : -1; S.leftAt = performance.now(); S.host = d.host === true;
    if (prev !== S.phase) {
      if (S.phase !== 'home' && S.phase !== 'night') { cancelBath(true); closeSheets(); $('wwFeedPick').classList.remove('open'); home.bowl = null; home.treat = null; home.finger = null; home.stroke = null; }
      if (S.phase !== 'walk') { walk.origin = null; walk.finger = null; walk.vec = { x: 0, y: 0 }; walk.lastX = 0; walk.lastY = 0; S.walk = { dig: 0, digP: 0, poop: 0, cat: 0 }; }
      if (S.phase !== 'park') { park.anim = 'hand'; park.drag = null; park.carry = false; park.toyPos = null; park.dogPos = null; S.park = { ready: 1, tired: 0, toy: null }; }
      if (S.phase === 'night') S.nightHidden = false;
      else S.night = null;
      if (S.phase === 'home' && prev === 'night' && S.haveDog) toast('☀️ Guten Morgen! Tag ' + S.day, 'info');
    }
    renderNight();
    renderStatus();
    route();
    tickTimes(true);
  }
  function onEvent(d) {
    const text = str(d.text, 160);
    if (!text) return;
    const kind = KINDS.indexOf(d.kind) >= 0 ? d.kind : 'info';
    if (kind === 'find' && onView('ww-walk')) showFind({ text, item: d.item });
    else toast(text, kind);
    vibrate(kind === 'bad' ? [30, 40, 30] : kind === 'find' ? [20, 30, 70] : kind === 'good' ? 18 : 10);
    if (kind === 'bad' && /Laden/.test(text) && onView('ww-home')) nudge('wwShopBtn');
  }
  let lastTick = 0;
  function tickTimes(force) {
    const now = performance.now();
    if (!force && now - lastTick < 250) return;
    lastTick = now;
    const l = leftNow(), time = l < 0 ? '' : fmtTime(l), info = WW.PHASE_INFO[S.phase] || WW.PHASE_INFO.home;
    $('wwPhaseLine').textContent = 'Tag ' + S.day + ' · ' + info.emoji + ' ' + info.label + (time ? ' · ' + time : '');
    $('wwWalkTime').textContent = time ? '⏱ ' + time : '';
    $('wwParkTime').textContent = time ? '⏱ ' + time : '';
    $('wwWalkTime').style.display = time ? '' : 'none';
    $('wwParkTime').style.display = time ? '' : 'none';
  }

  // ---------- frame loop (draws only the visible pad) ----------
  let lastFrame = performance.now(), loopError = false;
  function frame() {
    const now = performance.now(), dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    const views = ['ww-adopt', 'ww-home', 'ww-walk', 'ww-park'];
    const on = views.find(onView);
    if (!on && !onView('ww-hi')) return;
    document.body.classList.toggle('ww-host', !!amHost());
    if (on === 'ww-adopt') drawAdopt(dt);
    else if (on === 'ww-home') drawHome(dt);
    else if (on === 'ww-walk') drawWalk(dt);
    else if (on === 'ww-park') drawPark(dt);
    if (on === 'ww-home' && S.sheet === 'menu' && S.dog) {
      const r = fitCanvas($('wwPassCanvas'));
      r.g.clearRect(0, 0, r.w, r.h);
      WW.art.drawPortrait(r.g, S.dog, r.w / 2, r.h * 0.53, r.h * 0.92, { t: nowS(), happy: 0.5 + 0.5 * Math.sin(nowS() * 1.7), tongue: true });
    }
    if (on) tickTimes(false);
  }
  (function loop() {
    if (!$('v-ww-home')) return;   // page replaced (kicked by the host): stop drawing
    try { frame(); } catch (e) {
      // keep the phone alive, but surface the first error (tests listen for it)
      if (!loopError) { loopError = true; setTimeout(() => { throw e; }); }
    }
    requestAnimationFrame(loop);
  })();

  let helloTimer = null, helloTries = 0;
  function sendHello() {
    clearTimeout(helloTimer);
    helloTimer = setTimeout(() => {
      if (S.haveDog || S.adoptOpen) return;
      if (helloTries++ < 3) sendHello();
      else $('wwHiText').textContent = 'Der Fernseher antwortet nicht — lade diese Seite neu 🔄';
    }, HELLO_RETRY_MS);
    const dog = loadDog();
    send({ t: 'wwHello', dog: dog && typeof dog === 'object' && own(WW.BREEDS, dog.breed) ? dog : null });   // a broken record never reaches the TV
  }

  registerGame({ key: 'wauwauwg', controller: {
    activate() {
      if (home.bath) send({ t: 'wwCare', act: 'bathCancel' });   // reconnect mid-bath: the dog may leave the tub
      resetState();
      closeSheets();
      ['wwFeedPick', 'wwNightCard', 'wwRestoreCard', 'wwBathBar'].forEach(id => $(id).classList.remove('open'));
      $('wwFindCard').classList.remove('show');
      helloTries = 0;
      $('wwHiText').textContent = 'Dein Hund wird geweckt…';
      showView('ww-hi');
      sendHello();   // last: the reply may arrive synchronously
    },
    onMessage(d) {
      if (!d || typeof d !== 'object') return;
      switch (d.t) {
        case 'wwAdopt': onAdopt(d); break;
        case 'wwYou': onYou(d); break;
        case 'wwPhase': onPhase(d); break;
        case 'wwEvent': onEvent(d); break;
        case 'wwNight': {
          const was = JSON.stringify(S.night);
          S.night = cleanNight(d); S.host = S.night.host;
          if (JSON.stringify(S.night) !== was) S.nightHidden = false;   // only news re-opens it
          renderNight();
          break;
        }
        case 'wwWalk':
          S.walk = { dig: d.dig ? 1 : 0, digP: clamp(+d.digP || 0, 0, 1), poop: d.poop ? 1 : 0, cat: d.cat ? 1 : 0 };
          if (S.walk.cat && !$('wwHeelBtn').classList.contains('on')) vibrate([40, 30, 40]);
          if (S.walk.poop && !$('wwPoopBtn').classList.contains('on')) vibrate(25);
          updateWalkUi();
          break;
        case 'wwPark':
          S.park = { ready: d.ready ? 1 : 0, tired: d.tired ? 1 : 0, toy: WW.TOYS.indexOf(d.toy) >= 0 ? d.toy : null };
          updateParkUi(); renderToys();
          break;
      }
    }
  }});

  // Dev/test handle (dev-wauwauwg-phone.html, test-wauwauwg-phone.js)
  window.__wwPhone = {
    S, home, walk, park, frame,
    bath(step, fill) {
      if (!home.bath) startBath();
      const B = home.bath;
      if (!B) return;
      if (home.L) ensureMask(B, home.L);
      B.step = step;
      B.mask.forEach((i, k) => {
        const on = ((k * 7) % 10) / 10 < fill;
        if (step === 1) B.foam[i] = on ? 1 : 0;
        if (step === 2) { B.foam[i] = on ? 0 : 1; B.wet[i] = 1; }
        if (step === 3) { B.foam[i] = 0; B.wet[i] = on ? 0 : 1; }
      });
      B.p = fill;
      updateBathBar();
    }
  };
})();
