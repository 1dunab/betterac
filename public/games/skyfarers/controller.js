// ============ Controller module: SKYFARERS ============
// Phone = airship cockpit: floating analog stick (whole surface), BOOST hold, big context button,
// build drawer while docked, event alerts, end view. Protocol: docs/SKYFARERS.md "Phone protocol".
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #v-skyfarers { --c:#4da3ff; --act:min(40vw,160px); --bst:min(22vw,88px); --padH:calc(var(--act) + var(--bst) + 40px);
                 position:relative; overflow:hidden; color:#fff;
                 background:linear-gradient(180deg,#0c1a33 0%,#17355a 55%,#245a76 100%); }
  #v-skyfarers.night { background:linear-gradient(180deg,#070a1c 0%,#101a3d 60%,#1b2750 100%); }
  #skStatus { flex:none; display:flex; align-items:center; gap:10px; padding:8px 12px; min-height:46px; box-sizing:border-box;
              background:rgba(0,0,0,.35); border-bottom:2px solid var(--c); z-index:6; padding-right:134px; }
  #v-skyfarers:not(.host) #skStatus { padding-right:12px; }
  #skCargo { flex:1; min-width:0; }
  #skCargoTxt { font-size:17px; font-weight:800; white-space:nowrap; letter-spacing:.3px; }
  #skCargoTxt.full { color:#ffd60a; }
  .sk-bar { height:7px; border-radius:4px; background:rgba(255,255,255,.18); overflow:hidden; margin-top:4px; }
  .sk-bar > i { display:block; height:100%; width:0; border-radius:4px; background:var(--c); transition:width .2s; }
  .sk-bar.red > i { background:#ff453a; } .sk-bar.amber > i { background:#ffd60a; } .sk-bar.full > i { background:#ffd60a; }
  #skWater { display:flex; gap:2px; font-size:20px; flex:none; }
  #skWater span { transition:opacity .2s, transform .2s; }
  #skWater span.e { opacity:.22; filter:grayscale(.6); }
  #skChips { display:flex; align-items:center; gap:6px; flex:none; }
  #skBuildChip { display:none; border:2px solid #ffd60a; background:rgba(255,214,10,.16); color:#ffd60a; border-radius:12px;
                 font-size:14px; font-weight:800; padding:5px 9px; }
  #skEvtChip { display:none; border-radius:12px; padding:4px 9px; font-size:14px; font-weight:800; background:#4a6580; }
  #skEvtChip.sturm { background:#4a6580; } #skEvtChip.drachen { background:#b8341e; } #skEvtChip.nacht { background:#4040a8; }
  #skStage { position:relative; flex:1; min-height:0; }
  #skStick { position:absolute; inset:0; touch-action:none; z-index:1; }
  #skHome { position:absolute; left:20px; bottom:20px; width:128px; height:128px; border-radius:50%; border:3px dashed rgba(255,255,255,.28);
            display:flex; align-items:center; flex-direction:column; justify-content:center; font-size:34px; color:rgba(255,255,255,.4); pointer-events:none; text-align:center; }
  #skHome small { font-size:12px; font-weight:700; }
  #skRing { position:absolute; width:128px; height:128px; margin:-64px 0 0 -64px; border-radius:50%; display:none; pointer-events:none;
            border:3px solid rgba(255,255,255,.5); background:rgba(255,255,255,.07); }
  #skKnob { position:absolute; left:50%; top:50%; width:58px; height:58px; margin:-29px 0 0 -29px; border-radius:50%;
            background:var(--c); box-shadow:0 0 22px var(--c); opacity:.92; }
  #skBtns { position:absolute; right:14px; bottom:14px; display:flex; flex-direction:column; align-items:center; gap:14px; z-index:3; }
  #skBoostRing { width:var(--bst); height:var(--bst); border-radius:50%; padding:6px; box-sizing:border-box; --p:0;
                 background:conic-gradient(#7fe3ff calc(var(--p) * 1turn), rgba(255,255,255,.16) 0); }
  #skBoost { width:100%; height:100%; border-radius:50%; border:none; color:#fff; font-weight:900; font-size:14px; line-height:1.1;
             background:#17355a; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:0; touch-action:none; }
  #skBoost b { font-size:24px; font-weight:400; }
  #skBoost.on, #skBoost.key { background:#1f7fa8; box-shadow:0 0 22px #7fe3ff; }
  #skBoostRing.empty { opacity:.55; }
  #skAct { --ac:#4da3ff; width:var(--act); height:var(--act); border-radius:28%; border:4px solid var(--ac); color:#fff; font-weight:900;
           background:radial-gradient(circle at 50% 30%, rgba(255,255,255,.18), rgba(0,0,0,.35)), var(--ac);
           background-blend-mode:normal; box-shadow:0 0 26px var(--ac), inset 0 0 26px rgba(255,255,255,.12);
           display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; padding:0; touch-action:none; }
  #skAct .ic { font-size:calc(var(--act) * .42); line-height:1; }
  #skAct .lb { font-size:calc(var(--act) * .13); text-shadow:0 1px 4px rgba(0,0,0,.6); letter-spacing:.3px; }
  #skAct.horn { --ac:#6c7a96; filter:saturate(.7); }
  #skAct.shield { --ac:#3d8bff; } #skAct.extinguish { --ac:#17a6d6; } #skAct.shoot { --ac:#e0572f; }
  #skAct.harvest { --ac:#2fa866; } #skAct.repair { --ac:#d9902a; }
  #skAct.on, #skAct.key { filter:brightness(1.35); transform:scale(.96); }
  #skAct.pop { animation:skPop .45s ease-out; }
  @keyframes skPop { 0% { transform:scale(1); } 35% { transform:scale(1.14); } 100% { transform:scale(1); } }
  /* build drawer */
  #skDrawer { position:absolute; left:8px; right:8px; top:8px; bottom:var(--padH); z-index:4; display:flex; flex-direction:column;
              background:rgba(8,16,34,.94); border:2px solid #ffd60a; border-radius:18px; padding:10px; box-sizing:border-box;
              transform:translateY(115%); opacity:0; pointer-events:none; transition:transform .28s ease, opacity .2s; }
  #skDrawer.open { transform:none; opacity:1; pointer-events:auto; }
  #skDHead { flex:none; display:flex; align-items:center; gap:10px; }
  #skDHead .stock { font-size:18px; font-weight:800; flex:none; }
  #skBars { flex:1; display:flex; flex-direction:column; gap:3px; min-width:0; font-size:12px; font-weight:700; }
  #skBars .row { display:flex; align-items:center; gap:6px; } #skBars .row .sk-bar { flex:1; margin:0; height:8px; }
  #skDClose { flex:none; width:34px; height:34px; border:none; border-radius:10px; background:#3a3a48; color:#fff; font-size:16px; font-weight:800; }
  #skCards, #skEnd { scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.3) transparent; }
  #skCards { flex:1; min-height:0; overflow-y:auto; touch-action:pan-y; margin-top:8px; display:grid; grid-template-columns:1fr 1fr; gap:8px;
             align-content:start; }
  .sk-card { position:relative; border:2px solid #2d6a4f; border-radius:14px; background:#10283a; color:#fff; padding:8px 6px; text-align:center;
             display:flex; flex-direction:column; align-items:center; gap:3px; min-height:84px; }
  .sk-card .ic { font-size:28px; line-height:1; } .sk-card .nm { font-size:15px; font-weight:800; }
  .sk-card .cost { display:flex; gap:5px; justify-content:center; flex-wrap:wrap; }
  .sk-chip { font-size:13px; font-weight:800; padding:1px 7px; border-radius:9px; background:rgba(255,255,255,.14); }
  .sk-chip.miss { background:#b3261e; }
  .sk-card .why { font-size:12px; font-weight:700; color:#ffb4a8; min-height:15px; }
  .sk-card .dots { font-size:12px; letter-spacing:1px; color:#ffd60a; white-space:nowrap; }
  .sk-card .why.good { color:#9be7b4; }
  .sk-card .cnt { position:absolute; right:6px; top:4px; font-size:12px; font-weight:800; opacity:.7; }
  .sk-card.ok { border-color:#30d158; background:#12382e; } .sk-card.ok:active { filter:brightness(1.4); }
  .sk-card:not(.ok) { opacity:.78; }
  .sk-card.no { animation:skShake .3s; }
  .sk-card.sent { animation:skPop .4s; }
  @keyframes skShake { 0%,100% { transform:translateX(0); } 25% { transform:translateX(-6px); } 75% { transform:translateX(6px); } }
  /* alert banner + toasts */
  #skBanner { position:absolute; left:0; right:0; top:0; z-index:7; display:none; align-items:center; justify-content:center; gap:10px;
              padding:10px 14px; font-size:20px; font-weight:900; text-shadow:0 1px 5px rgba(0,0,0,.6); background:#4a6580; }
  #skBanner.show { display:flex; animation:skDrop .3s ease-out; }
  #skBanner.sturm { background:#4a6580; } #skBanner.drachen { background:#b8341e; } #skBanner.nacht { background:#4040a8; }
  #skBanner .n { font-size:26px; font-variant-numeric:tabular-nums; min-width:44px; text-align:center; }
  @keyframes skDrop { from { transform:translateY(-100%); } to { transform:none; } }
  #skToasts { position:absolute; left:0; right:0; top:58px; z-index:8; display:flex; flex-direction:column; align-items:center; gap:6px; pointer-events:none; }
  .sk-toast { background:rgba(0,0,0,.78); border:2px solid var(--c); border-radius:16px; padding:8px 16px; font-size:17px; font-weight:800;
              max-width:88%; text-align:center; animation:skToastIn .25s ease-out; transition:opacity .4s; }
  .sk-toast.out { opacity:0; }
  @keyframes skToastIn { from { transform:translateY(-12px); opacity:0; } to { transform:none; opacity:1; } }
  /* stun */
  #skVig { position:absolute; inset:0; z-index:5; pointer-events:none; opacity:0; transition:opacity .2s;
           background:radial-gradient(ellipse at center, rgba(255,0,0,0) 45%, rgba(255,30,30,.55) 100%); }
  #v-skyfarers.stun #skVig { opacity:1; animation:skVig .5s ease-in-out infinite alternate; }
  #v-skyfarers.stun #skStage { animation:skShakeAll .22s linear infinite; }
  @keyframes skVig { from { opacity:.65; } to { opacity:1; } }
  @keyframes skShakeAll { 0%,100% { transform:translate(0,0); } 25% { transform:translate(-3px,2px); } 50% { transform:translate(3px,-2px); } 75% { transform:translate(-2px,-3px); } }
  /* overlays: intro / spectator / end / waiting */
  .sk-over { position:absolute; inset:0; z-index:9; display:none; flex-direction:column; align-items:center; justify-content:center; gap:14px;
             text-align:center; padding:20px; box-sizing:border-box; }
  .sk-over.show { display:flex; }
  #skIntro { background:rgba(8,16,34,.72); pointer-events:none; font-size:26px; font-weight:900; }
  #skIntro .sub { font-size:16px; font-weight:600; opacity:.85; max-width:300px; }
  #skSpec, #skWait { background:linear-gradient(180deg,#0c1a33,#17355a); font-size:24px; font-weight:800; }
  #skEnd { background:linear-gradient(180deg,#0c1a33,#1d3a5f); overflow-y:auto; touch-action:pan-y; gap:22px; }
  #skEnd .col { display:flex; flex-direction:column; align-items:center; gap:12px; width:100%; max-width:360px; }
  #skEnd.show { margin:0; }
  #skStars { font-size:52px; letter-spacing:6px; filter:drop-shadow(0 0 14px rgba(255,214,10,.6)); }
  #skStars .off { opacity:.25; filter:grayscale(1); }
  #skEndT { font-size:24px; font-weight:900; } #skEndMvp { font-size:17px; font-weight:700; }
  #skEndMvp .me { color:#ffd60a; }
  #skStats { display:grid; grid-template-columns:1fr 1fr; gap:8px; width:100%; max-width:340px; }
  #skStats div { background:rgba(255,255,255,.1); border-radius:12px; padding:8px 6px; font-size:14px; font-weight:700; }
  #skStats b { display:block; font-size:24px; }
  #skAgain { font-size:22px; padding:14px 30px; border:none; border-radius:18px; background:#30d158; color:#06250f; font-weight:900; display:none; }
  #skWaitHost { font-size:15px; font-weight:600; opacity:.75; }
  @media (orientation:landscape) {
    #v-skyfarers { --act:min(26vw,44vh); --bst:min(15vw,26vh); }
    #skStatus { min-height:36px; padding-top:4px; padding-bottom:4px; }
    #skCargoTxt { font-size:15px; } #skWater { font-size:17px; }
    #skDrawer { left:max(28%,150px); right:calc(var(--act) + 36px); top:6px; bottom:6px; }
    #skCargo { flex:none; width:230px; }
    #skCards { grid-template-columns:1fr 1fr 1fr; gap:6px; margin-top:6px; }
    .sk-card { min-height:60px; padding:5px 3px; gap:1px; }
    .sk-card .ic { font-size:22px; } .sk-card .nm { font-size:13px; } .sk-chip { font-size:12px; padding:0 5px; } .sk-card .why { font-size:11px; min-height:0; }
    #skDrawer { padding:8px; }
    #skHome { width:110px; height:110px; bottom:14px; }
    #skStars { font-size:40px; }
    #skEnd.show { flex-direction:row; padding:10px 20px; gap:28px; }
    #skEnd .col { max-width:none; flex:1; }
    #skEnd .col:first-child { padding-right:0; } #skEndT { font-size:20px; }
    #skToasts { top:50px; }
    #skBanner { font-size:17px; padding:6px 14px; } #skBanner .n { font-size:20px; }
  }
</style>
<!-- SKYFARERS -->
<div id="v-skyfarers" class="view">
  <div id="skStatus">
    <div id="skCargo"><div id="skCargoTxt">💎 0 🪵 0 / 6</div><div class="sk-bar" id="skCargoBar"><i></i></div></div>
    <div id="skWater"></div>
    <div id="skChips"><button id="skBuildChip">🏗️ Bauen</button><span id="skEvtChip"></span></div>
  </div>
  <div id="skStage">
    <div id="skStick"><div id="skHome">🕹️<small>ziehen = fliegen</small></div><div id="skRing"><div id="skKnob"></div></div></div>
    <div id="skBtns">
      <div id="skBoostRing"><button id="skBoost"><b>🌬️</b>BOOST</button></div>
      <button id="skAct" class="horn"><span class="ic">📯</span><span class="lb">Hupe</span></button>
    </div>
    <div id="skDrawer">
      <div id="skDHead">
        <div class="stock" id="skStock">💎 0 🪵 0</div>
        <div id="skBars">
          <div class="row">❤️<div class="sk-bar" id="skHerzBar"><i></i></div></div>
          <div class="row">⚡<div class="sk-bar amber" id="skEnBar"><i></i></div></div>
        </div>
        <button id="skDClose">▾</button>
      </div>
      <div id="skCards"></div>
    </div>
    <div id="skBanner"><span id="skBanTxt"></span><span class="n" id="skBanN"></span></div>
    <div id="skToasts"></div>
  </div>
  <div id="skVig"></div>
  <div id="skWait" class="sk-over show">🎈 Warte aufs Schiff…</div>
  <div id="skIntro" class="sk-over"><div>🎈 Gleich geht's los!</div><div class="sub">Sammle 💎 und 🪵, dock zu Hause an und bau die Insel aus.</div></div>
  <div id="skSpec" class="sk-over"><div>👀 Alle Schiffe sind besetzt</div><div style="font-size:18px;font-weight:600;opacity:.85">schau auf den Fernseher</div></div>
  <div id="skEnd" class="sk-over">
    <div class="col"><div id="skStars"></div><div id="skEndT"></div><div id="skEndMvp"></div></div>
    <div class="col"><div id="skStats"></div>
      <button id="skAgain">🔁 Nochmal</button><div id="skWaitHost">Warte auf den Host…</div></div>
  </div>
</div>`);
  VIEWS.push('skyfarers');

  const root = $('v-skyfarers'), stickEl = $('skStick'), ringEl = $('skRing'), knobEl = $('skKnob');
  const actEl = $('skAct'), boostEl = $('skBoost'), boostRing = $('skBoostRing');
  const send = (m) => ac.message(AirConsole.SCREEN, m);
  const vib = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };

  // Building catalog copied from world.js BUILDINGS (the phone does not load it); cost is per stage for the Sternwarte.
  const BUILDINGS = {
    windrad:    { name: 'Windrad',     icon: '🌀', cost: { holz: 2, kristall: 1 }, stages: 1 },
    kanone:     { name: 'Kanonenturm', icon: '💣', cost: { holz: 3, kristall: 2 }, stages: 1 },
    zisterne:   { name: 'Zisterne',    icon: '💧', cost: { holz: 3, kristall: 0 }, stages: 1 },
    werkstatt:  { name: 'Werkstatt',   icon: '🔧', cost: { holz: 2, kristall: 2 }, stages: 1 },
    sternwarte: { name: 'Sternwarte',  icon: '🔭', cost: { holz: 9, kristall: 9 }, stages: 3 }
  };
  const ORDER = ['windrad', 'kanone', 'zisterne', 'werkstatt', 'sternwarte'];
  const ACTS = {
    shield:     { ic: '🛡️', lb: 'Schild halten' },
    extinguish: { ic: '💧', lb: 'Löschen' },
    shoot:      { ic: '🎯', lb: 'Harpune' },
    harvest:    { ic: '⛏️', lb: 'Ernten' },
    repair:     { ic: '🔧', lb: 'Reparieren' },
    horn:       { ic: '📯', lb: 'Hupe' }
  };
  const EVENTS = {
    sturm:   { ic: '⛈️', name: 'Sturm',      buzz: [200, 100, 200, 100, 400] },
    drachen: { ic: '🐉', name: 'Drachen',    buzz: [300, 100, 300, 100, 300, 100, 500] },
    nacht:   { ic: '🌩️', name: 'Sturmnacht', buzz: [400, 150, 200, 150, 200, 150, 600] }
  };
  const STAT_LABEL = [['delivered', '📦', 'Geliefert'], ['built', '🏗️', 'Gebaut'], ['fires', '🔥', 'Gelöscht'], ['dragonHits', '🎯', 'Drachentreffer'], ['repairs', '🔧', 'Repariert']];

  let st;                                   // all local state, rebuilt by reset()
  let toastN = 0, tickTimer = null;
  let stickTouch = null, stickMouse = false, stickKeys = { x: 0, y: 0 };
  let sx = 0, sy = 0, sentX = 0, sentY = 0, lastStickAt = 0, stickPend = null;
  let actTouch = null, actMouse = false, actKey = false, actOn = false;
  let boostTouch = null, boostMouse = false, boostKey = false, boostOn = false;
  const keysDown = {};

  function reset() {
    st = { ship: null, color: '#4da3ff', host: false, phase: 'wait', act: 'horn', res: null, docked: false, stunned: false, haveYou: false,
           cargo: { kristall: 0, holz: 0 }, cap: 6, water: 0, waterCap: 3, boost: 1, base: null, drawerOpen: true, alert: null, event: null, result: null };
    clearTimeout(stickPend); stickPend = null; clearInterval(tickTimer); tickTimer = null;
    stickTouch = null; stickMouse = false; stickKeys = { x: 0, y: 0 }; sx = sy = sentX = sentY = 0; lastStickAt = 0;
    actTouch = null; actMouse = false; actKey = false; actOn = false;
    boostTouch = null; boostMouse = false; boostKey = false; boostOn = false;
    for (const k in keysDown) delete keysDown[k];
    ringEl.style.display = 'none'; $('skHome').style.display = '';
    actEl.classList.remove('on', 'key', 'pop'); boostEl.classList.remove('on', 'key');
    $('skToasts').innerHTML = ''; $('skBanner').classList.remove('show');
    root.classList.remove('stun', 'night', 'host'); document.documentElement.style.removeProperty('--c'); root.style.removeProperty('--c');
    $('skCards').innerHTML = '';
    renderAct(false); renderYou(); renderChips(); renderBase(); renderOverlays();
  }

  // ---------- Analog stick: floating origin, deadzone, unit disc, throttled ----------
  const STICK_R = 58, DEAD = 0.12, EPS = 0.04, GAP = 50;
  let ox = 0, oy = 0;
  function stickFrom(cx, cy) {
    const r = stickEl.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  }
  function stickBegin(cx, cy) {
    const p = stickFrom(cx, cy); ox = p.x; oy = p.y;
    ringEl.style.left = ox + 'px'; ringEl.style.top = oy + 'px'; ringEl.style.display = 'block';
    $('skHome').style.display = 'none';
    knobEl.style.transform = '';
    stickMove(cx, cy);
  }
  function stickMove(cx, cy) {
    const p = stickFrom(cx, cy);
    let dx = (p.x - ox) / STICK_R, dy = (p.y - oy) / STICK_R;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    knobEl.style.transform = 'translate(' + dx * STICK_R * 0.8 + 'px,' + dy * STICK_R * 0.8 + 'px)';
    const m = Math.min(1, len);
    if (m < DEAD) setStick(0, 0);
    else { const k = (m - DEAD) / (1 - DEAD) / m; setStick(dx * k, dy * k); }   // dx,dy already clamped to the unit disc
  }
  function stickEnd() {
    ringEl.style.display = 'none'; $('skHome').style.display = '';
    setStick(0, 0);
  }
  // Queue a stick value; send when it changed by EPS and >= GAP ms since the last send, trailing flush otherwise.
  function setStick(x, y) { sx = Math.round(x * 100) / 100; sy = Math.round(y * 100) / 100; flushStick(); }
  function flushStick() {
    clearTimeout(stickPend); stickPend = null;
    const rel = sx === 0 && sy === 0;
    const changed = Math.abs(sx - sentX) >= EPS || Math.abs(sy - sentY) >= EPS || (rel && (sentX !== 0 || sentY !== 0));
    if (!changed) return;
    const wait = GAP - (performance.now() - lastStickAt);
    if (wait > 0) { stickPend = setTimeout(flushStick, wait + 1); return; }
    lastStickAt = performance.now(); sentX = sx; sentY = sy;
    send({ t: 'skStick', x: sx, y: sy });
  }
  stickEl.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (stickTouch !== null) return;
    const t = e.changedTouches[0]; stickTouch = t.identifier; stickBegin(t.clientX, t.clientY);
  }, { passive: false });
  stickEl.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === stickTouch) stickMove(t.clientX, t.clientY);
  }, { passive: false });
  const stickTouchEnd = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === stickTouch) { stickTouch = null; stickEnd(); }
  };
  stickEl.addEventListener('touchend', stickTouchEnd, { passive: false });
  stickEl.addEventListener('touchcancel', stickTouchEnd, { passive: false });
  stickEl.addEventListener('mousedown', (e) => { e.preventDefault(); stickMouse = true; stickBegin(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (stickMouse) stickMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { if (stickMouse) { stickMouse = false; stickEnd(); } });

  // ---------- Hold buttons (boost, context action) ----------
  function setAct(on) { if (on === actOn) return; actOn = on; actEl.classList.toggle('on', on); send({ t: 'skAct', on }); }
  function setBoost(on) { if (on === boostOn) return; boostOn = on; boostEl.classList.toggle('on', on); send({ t: 'skBoost', on }); }
  const actWant = () => actTouch !== null || actMouse || actKey;
  const boostWant = () => boostTouch !== null || boostMouse || boostKey;
  function holdBinder(el, get, set) {
    el.addEventListener('touchstart', (e) => { e.preventDefault(); if (get().t === null) { set.t(e.changedTouches[0].identifier); } sync(); }, { passive: false });
    const end = (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === get().t) set.t(null); sync(); };
    el.addEventListener('touchend', end, { passive: false }); el.addEventListener('touchcancel', end, { passive: false });
    el.addEventListener('mousedown', (e) => { e.preventDefault(); set.m(true); sync(); });
    window.addEventListener('mouseup', () => { if (get().m) { set.m(false); sync(); } });
    function sync() { set.apply(); }
  }
  holdBinder(actEl, () => ({ t: actTouch, m: actMouse }), { t: (v) => { actTouch = v; }, m: (v) => { actMouse = v; }, apply: () => setAct(actWant()) });
  holdBinder(boostEl, () => ({ t: boostTouch, m: boostMouse }), { t: (v) => { boostTouch = v; }, m: (v) => { boostMouse = v; }, apply: () => setBoost(boostWant()) });

  // ---------- Keyboard fallback: WASD / arrows, Shift = boost, Space = action ----------
  function keyVec() {
    const k = keysDown;
    let x = ((k.d || k.arrowright) ? 1 : 0) - ((k.a || k.arrowleft) ? 1 : 0);
    let y = ((k.s || k.arrowdown) ? 1 : 0) - ((k.w || k.arrowup) ? 1 : 0);
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  function onKey(e, down) {
    if (!root.classList.contains('on') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = (e.key || '').toLowerCase();
    if (k === ' ' || k === 'spacebar') { e.preventDefault(); actKey = down; actEl.classList.toggle('key', down); setAct(actWant()); return; }
    if (k === 'shift') { boostKey = down; boostEl.classList.toggle('key', down); setBoost(boostWant()); return; }
    if (!/^(w|a|s|d|arrowup|arrowdown|arrowleft|arrowright)$/.test(k)) return;
    e.preventDefault();
    if (down) keysDown[k] = true; else delete keysDown[k];
    if (stickTouch === null && !stickMouse) { const v = keyVec(); setStick(v.x, v.y); }
  }
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  // never leave a held control stuck when the page goes away
  function releaseAll() {
    stickTouch = null; stickMouse = false; for (const k in keysDown) delete keysDown[k];
    if (ringEl.style.display !== 'none') stickEnd(); else setStick(0, 0);
    actTouch = null; actMouse = false; actKey = false; boostTouch = null; boostMouse = false; boostKey = false;
    actEl.classList.remove('key'); boostEl.classList.remove('key');
    setAct(false); setBoost(false);
  }
  window.addEventListener('blur', () => { if (root.classList.contains('on')) releaseAll(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && root.classList.contains('on')) releaseAll(); });

  // ---------- Rendering ----------
  function renderAct(pop) {
    const a = ACTS[st.act] || ACTS.horn;
    let ic = a.ic, lb = a.lb;
    if (st.act === 'harvest' && st.res === 'holz') { ic = '🪓'; lb = 'Holz hacken'; }
    actEl.className = st.act in ACTS ? st.act : 'horn';
    if (actOn) actEl.classList.add('on');
    actEl.querySelector('.ic').textContent = ic; actEl.querySelector('.lb').textContent = lb;
    if (pop) { actEl.classList.remove('pop'); void actEl.offsetWidth; actEl.classList.add('pop'); }
  }
  function renderYou() {
    const c = st.cargo, total = (c.kristall | 0) + (c.holz | 0), cap = Math.max(1, st.cap | 0);
    const full = total >= cap;
    $('skCargoTxt').textContent = '💎 ' + (c.kristall | 0) + '  🪵 ' + (c.holz | 0) + ' / ' + cap;
    $('skCargoTxt').classList.toggle('full', full);
    $('skCargoBar').classList.toggle('full', full);
    $('skCargoBar').firstChild.style.width = Math.min(100, total / cap * 100) + '%';
    const w = $('skWater'), n = Math.max(1, st.waterCap | 0);
    if (w.children.length !== n) { w.innerHTML = ''; for (let i = 0; i < n; i++) w.appendChild(Object.assign(document.createElement('span'), { textContent: '💧' })); }
    for (let i = 0; i < n; i++) {
      const f = Math.max(0, Math.min(1, st.water - i));
      w.children[i].className = f < 0.34 ? 'e' : '';
      w.children[i].style.transform = f >= 0.34 && f < 1 ? 'scale(' + (0.7 + f * 0.3) + ')' : '';
    }
    boostRing.style.setProperty('--p', Math.max(0, Math.min(1, st.boost)));
    boostRing.classList.toggle('empty', st.boost < 0.05);
    root.classList.toggle('stun', !!st.stunned);
  }
  function renderChips() {
    const showBuild = st.docked && !st.drawerOpen && st.phase === 'live';
    $('skBuildChip').style.display = showBuild ? 'block' : 'none';
    const ev = $('skEvtChip');
    if (st.event) { ev.style.display = 'block'; ev.className = st.event; ev.textContent = EVENTS[st.event].ic; }
    else ev.style.display = 'none';
    root.classList.toggle('night', st.event === 'nacht');
    $('skDrawer').classList.toggle('open', st.docked && st.drawerOpen && st.phase === 'live');
  }
  function renderOverlays() {
    $('skWait').classList.toggle('show', st.phase === 'wait' || (st.ship === null && st.phase !== 'end'));
    $('skSpec').classList.toggle('show', st.ship === false && st.phase !== 'end' && st.phase !== 'wait');
    $('skIntro').classList.toggle('show', st.ship === true && st.phase === 'intro');
    $('skEnd').classList.toggle('show', st.phase === 'end');
    $('skAgain').style.display = st.phase === 'end' && st.host ? 'block' : 'none';
    $('skWaitHost').style.display = st.phase === 'end' && !st.host ? 'block' : 'none';
  }
  function chip(txt, miss) { const s = document.createElement('span'); s.className = 'sk-chip' + (miss ? ' miss' : ''); s.textContent = txt; return s; }
  function bar(id, v, max) { $(id).firstChild.style.width = Math.max(0, Math.min(100, (v || 0) / max * 100)) + '%'; }
  // Sternwarte progress derived from the slots: finished stages and the stage that is in progress
  function sternStages(slots) {
    for (const s of slots || []) if (s && s.kind === 'sternwarte') return { done: s.build >= 1 ? s.stage : Math.max(0, s.stage - 1), stage: s.stage, ruined: !!s.ruined };
    return { done: 0, stage: 0, ruined: false };
  }
  function reasonFor(kind, why, stock, need) {
    if (why === 'noSlot') return 'Kein Bauplatz frei';
    if (why === 'stage') {
      const sw = sternStages(st.base.slots);
      if (kind === 'sternwarte' && sw.done >= 3) return 'Schon komplett 🎉';
      return 'Erst Stufe ' + Math.max(1, sw.stage) + ' fertig bauen';
    }
    if (why === 'cost') {
      const m = [];
      if ((stock.holz | 0) < need.holz) m.push('🪵');
      if ((stock.kristall | 0) < need.kristall) m.push('💎');
      return 'Zu wenig ' + (m.join(' ') || '🪵💎');
    }
    return '';
  }
  function renderBase() {
    const b = st.base, wrap = $('skCards');
    if (!b) { wrap.innerHTML = ''; return; }
    const stock = b.stock || {};
    $('skStock').textContent = '💎 ' + (stock.kristall | 0) + '  🪵 ' + (stock.holz | 0);
    bar('skHerzBar', b.herz, 100); bar('skEnBar', b.energy, 100);
    $('skHerzBar').classList.toggle('red', (b.herz || 0) < 35);
    const can = b.canBuild || {}, slots = b.slots || [];
    wrap.innerHTML = '';
    ORDER.forEach(kind => {
      const def = BUILDINGS[kind], ok = can[kind] === true;
      const have = slots.filter(s => s && s.kind === kind);
      const ruined = kind !== 'sternwarte' && have.some(s => s.ruined);
      const need = { holz: ruined ? Math.ceil(def.cost.holz / 2) : def.cost.holz, kristall: ruined ? Math.ceil(def.cost.kristall / 2) : def.cost.kristall };
      const card = document.createElement('button');
      card.className = 'sk-card' + (ok ? ' ok' : '');
      const ic = Object.assign(document.createElement('span'), { className: 'ic', textContent: def.icon });
      const nm = Object.assign(document.createElement('span'), { className: 'nm', textContent: def.name });
      const cost = document.createElement('span'); cost.className = 'cost';
      if (need.holz) cost.appendChild(chip(need.holz + ' 🪵', (stock.holz | 0) < need.holz));
      if (need.kristall) cost.appendChild(chip(need.kristall + ' 💎', (stock.kristall | 0) < need.kristall));
      card.append(ic, nm, cost);
      if (kind === 'sternwarte') {
        const sw = sternStages(slots);
        const dots = document.createElement('span'); dots.className = 'dots';
        dots.textContent = [0, 1, 2].map(i => i < sw.done ? '●' : (i === sw.done && sw.stage > sw.done ? '◐' : '○')).join('') + ' ' + sw.done + '/3';
        card.appendChild(dots);
      } else if (have.length) card.appendChild(Object.assign(document.createElement('span'), { className: 'cnt', textContent: '×' + have.length }));
      card.appendChild(Object.assign(document.createElement('span'), { className: 'why' + (ok && ruined ? ' good' : ''), textContent: ok ? (ruined ? '♻️ Wiederaufbau ½' : '') : reasonFor(kind, can[kind], stock, need) }));
      card.addEventListener('click', () => {
        if (can[kind] === true) {
          send({ t: 'skBuild', kind }); vib(15);
          card.classList.remove('sent'); void card.offsetWidth; card.classList.add('sent');
        } else {
          card.classList.remove('no'); void card.offsetWidth; card.classList.add('no'); vib(30);
          toast('❌ ' + (reasonFor(kind, can[kind], stock, need) || 'Geht gerade nicht'));
        }
      });
      wrap.appendChild(card);
    });
  }
  $('skDClose').addEventListener('click', () => { st.drawerOpen = false; renderChips(); });
  $('skBuildChip').addEventListener('click', () => { st.drawerOpen = true; renderChips(); });
  $('skAgain').addEventListener('click', () => send({ t: 'skAgain' }));

  // ---------- Alerts and toasts ----------
  function toast(text) {
    const box = $('skToasts'), el = document.createElement('div');
    el.className = 'sk-toast'; el.textContent = String(text).slice(0, 80);
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 450); }, 2600);
  }
  function renderAlert() {
    const ban = $('skBanner'), a = st.alert;
    if (!a) { ban.classList.remove('show'); return; }
    const left = Math.max(0, Math.ceil((a.until - performance.now()) / 1000));
    if (left <= 0) { st.alert = null; ban.classList.remove('show'); return; }
    const e = EVENTS[a.kind];
    ban.className = 'show ' + a.kind;
    $('skBanTxt').textContent = e.ic + ' ' + e.name + ' in';
    $('skBanN').textContent = left + ' s';
  }
  function tick() {
    renderAlert();
    if (!st.alert) { clearInterval(tickTimer); tickTimer = null; }
  }

  // ---------- End view ----------
  function renderEnd() {
    const r = st.result || {};
    const stars = Math.max(0, Math.min(3, r.stars | 0));
    $('skStars').innerHTML = [0, 1, 2].map(i => '<span class="' + (i < stars && r.survived ? '' : 'off') + '">⭐</span>').join('');
    $('skEndT').textContent = r.survived ? '🌅 Die Insel hat die Nacht überstanden!' : '🌊 Die Insel ist gesunken…';
    const mvp = r.mvp, mv = $('skEndMvp'); mv.textContent = '';
    if (mvp) {
      const name = typeof mvp === 'string' ? mvp : (mvp.name || '');
      const me = typeof mvp === 'object' && (mvp.you || mvp.me || mvp.isYou);
      if (name) { const s = document.createElement('span'); s.className = me ? 'me' : ''; s.textContent = '⭐ Kapitän der Runde: ' + name + (me ? ' (du!)' : ''); mv.appendChild(s); }
    }
    const you = r.you || {}, stats = you.stats || {}, box = $('skStats');
    box.innerHTML = '';
    const mk = (ic, lab, v) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = ic + ' ' + v; d.append(b, lab); box.appendChild(d); };
    if (you.score != null) mk('🏅', 'Punkte', Math.round(you.score));
    STAT_LABEL.forEach(s => { if (stats[s[0]] != null) mk(s[1], s[2], Math.round(stats[s[0]])); });
  }

  // ---------- Module ----------
  registerGame({ key: 'skyfarers', controller: {
    activate() {
      reset();
      showView('skyfarers');
    },
    onMessage(d) {
      switch (d.t) {
        case 'skInfo': {
          st.ship = d.ship !== false;
          if (typeof d.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(d.color)) { st.color = d.color; root.style.setProperty('--c', d.color); }
          st.host = !!d.host; myHost = st.host; updateAbort(); root.classList.toggle('host', st.host);
          if (st.phase === 'wait') st.phase = 'intro';
          renderOverlays(); renderChips();
          break;
        }
        case 'skPhase': {
          if (d.phase !== 'intro' && d.phase !== 'live' && d.phase !== 'end') break;
          st.phase = d.phase;
          if (d.phase === 'end') { st.result = d.result || null; if (actOn || boostOn) releaseAll(); else setStick(0, 0); renderEnd(); }
          if (d.phase !== 'live') { st.docked = false; }
          renderOverlays(); renderChips();
          break;
        }
        case 'skYou': {
          const prevAct = st.act, first = !st.haveYou;
          st.haveYou = true;
          if (d.cargo) st.cargo = { kristall: +d.cargo.kristall || 0, holz: +d.cargo.holz || 0 };
          if (typeof d.cap === 'number') st.cap = d.cap;
          if (typeof d.water === 'number') st.water = d.water;
          if (typeof d.waterCap === 'number') st.waterCap = d.waterCap;
          if (typeof d.boost === 'number') st.boost = d.boost;
          if (typeof d.act === 'string') st.act = d.act;
          st.res = d.res || null;
          const wasDocked = st.docked;
          if (d.docked !== undefined) st.docked = !!d.docked && st.phase === 'live';
          if (st.docked && !wasDocked) { st.drawerOpen = true; vib(20); }
          if (!st.docked && wasDocked) st.base = null;
          const wasStun = st.stunned;
          if (d.stunned !== undefined) st.stunned = d.stunned;
          if (st.stunned && !wasStun) vib([120, 60, 220]);
          const changed = st.act !== prevAct;
          renderAct(changed && !first);
          if (changed && !first && st.act !== 'horn') vib(25);
          renderYou(); renderChips(); if (!st.docked) renderBase();
          break;
        }
        case 'skBase': {
          st.base = { stock: d.stock || {}, energy: d.energy, herz: d.herz, slots: Array.isArray(d.slots) ? d.slots : [], canBuild: d.canBuild || {} };
          renderBase();
          break;
        }
        case 'skAlert': {
          if (!EVENTS[d.kind]) break;
          st.alert = { kind: d.kind, until: performance.now() + Math.max(0, +d.in || 0) * 1000 };
          vib(EVENTS[d.kind].buzz);
          renderAlert();
          clearInterval(tickTimer); tickTimer = setInterval(tick, 250);
          break;
        }
        case 'skEvent': {
          if (!EVENTS[d.kind]) break;
          if (d.on) { st.event = d.kind; if (st.alert && st.alert.kind === d.kind) { st.alert = null; renderAlert(); } vib([100, 60, 100]); }
          else if (st.event === d.kind) st.event = null;
          renderChips();
          break;
        }
        case 'skToast': if (d.text) toast(d.text); break;
      }
    }
  }});
})();
