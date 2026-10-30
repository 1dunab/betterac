// ============ Controller-Modul: NEONSPUR ============
// Phone = Lenkrad: LINKS / RECHTS / SPRUNG / TURBO (halten) + Kamera. Protokoll: docs/NEONSPUR.md "Phone protocol".
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #v-neonspur { --ns:#00e5ff; background:#05060f; color:#fff; position:relative; }
  #v-neonspur .bar { padding:8px 14px; background:#0a0c1a; border-bottom:2px solid var(--ns); box-shadow:0 0 16px var(--ns); flex:none; }
  #v-neonspur .word { font-size:20px; color:var(--ns); text-shadow:0 0 10px var(--ns); }
  #v-neonspur.host .bar { padding-right:128px !important; gap:6px; }
  #v-neonspur.host .word { font-size:16px; }
  #v-neonspur.host #nsCam { padding:5px 8px; font-size:14px; }
  #v-neonspur .word { white-space:nowrap; }
  #v-neonspur.host.shield .word { font-size:13px; }
  #v-neonspur.host.shield #nsCam { padding:4px 6px; font-size:12px; }
  #nsWins { white-space:nowrap; font-size:18px; font-weight:800; }
  #nsCam { border:2px solid var(--ns); background:#05060f; color:#fff; border-radius:12px; padding:6px 12px; font-size:15px; font-weight:800; box-shadow:0 0 10px var(--ns) inset; }
  #nsCam:active { background:var(--ns); color:#000; }
  #nsPad { flex:1; min-height:0; display:grid; gap:12px; padding:12px; box-sizing:border-box;
           grid-template-columns:1fr 1fr; grid-template-rows:3fr 1fr; grid-template-areas:"l r" "j j"; }
  #nsPad.hide { visibility:hidden; }
  #nsPad button { position:relative; overflow:hidden; border:3px solid var(--ns); border-radius:22px; background:#0a0d1f; color:#fff;
                  font-weight:900; letter-spacing:1px; box-shadow:0 0 18px var(--ns), inset 0 0 22px rgba(255,255,255,.06);
                  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; padding:0; }
  #nsPad.ex { grid-template-areas:"l r" "j t"; }
  #nsL { grid-area:l; } #nsR { grid-area:r; } #nsJ { grid-area:j; } #nsT { grid-area:t; }
  #nsL .arr, #nsR .arr { font-size:64px; line-height:1; color:var(--ns); text-shadow:0 0 14px var(--ns); }
  #nsL .lab, #nsR .lab, #nsJ .lab { font-size:24px; position:relative; z-index:1; }
  #nsJ .lab { font-size:28px; }
  #nsPad.ex #nsJ .lab, #nsT .lab { font-size:22px; }
  #nsT .fill { position:absolute; left:0; top:0; bottom:0; width:0; background:var(--ns); opacity:.45; }
  #nsT.anim .fill { transition:width .18s linear; }
  #nsT .sub { font-size:13px; position:relative; z-index:1; height:15px; line-height:15px; opacity:0; text-shadow:0 0 8px var(--ns); }
  #nsT { opacity:.55; border-color:rgba(255,255,255,.35) !important; box-shadow:none !important; touch-action:none; }
  #nsT.some { opacity:.8; border-color:var(--ns) !important; }
  #nsT.full { opacity:1; border-color:var(--ns) !important; box-shadow:0 0 30px var(--ns), inset 0 0 26px var(--ns) !important; }
  #nsT.full .sub { opacity:1; }
  #nsT.full .fill { opacity:.3; }
  #nsT.pulse { animation:nsPulse .45s ease-in-out infinite; }
  #nsT.pop { animation:nsPop .5s ease-out; }
  #nsToast { position:absolute; left:50%; top:46%; transform:translate(-50%,-50%); z-index:4; pointer-events:none; opacity:0; transition:opacity .25s;
             background:rgba(5,6,15,.88); border:2px solid var(--ns); border-radius:18px; padding:12px 22px; font-size:24px; font-weight:900;
             white-space:nowrap; box-shadow:0 0 22px var(--ns); text-shadow:0 0 10px var(--ns); }
  #nsToast.show { opacity:1; }
  #nsShield { display:none; font-size:20px; filter:drop-shadow(0 0 6px #4da3ff); }
  #v-neonspur.shield #nsShield { display:inline; }
  #v-neonspur.shield #nsPad { box-shadow:inset 0 0 34px rgba(77,163,255,.55); border-radius:18px; }
  @keyframes nsPulse { 0%,100% { box-shadow:0 0 14px var(--ns), inset 0 0 14px var(--ns); transform:scale(1); } 50% { box-shadow:0 0 36px var(--ns), inset 0 0 30px var(--ns); transform:scale(.985); } }
  @keyframes nsPop { 0% { transform:scale(1); } 35% { transform:scale(1.06); } 100% { transform:scale(1); } }
  #nsPad button.flash { background:var(--ns); color:#000; box-shadow:0 0 34px var(--ns); }
  #nsPad button.flash .arr { color:#000; text-shadow:none; }
  #nsJ .fill { position:absolute; left:0; top:0; bottom:0; width:0; background:var(--ns); opacity:.35; }
  #nsJ.charging { opacity:.6; border-color:rgba(255,255,255,.35); box-shadow:none; }
  #nsJ.ready { animation:nsReady 1.2s ease-in-out infinite; }
  #nsJ.nope { animation:nsShake .3s; }
  @keyframes nsReady { 0%,100% { box-shadow:0 0 14px var(--ns), inset 0 0 22px rgba(255,255,255,.06); } 50% { box-shadow:0 0 34px var(--ns), inset 0 0 30px var(--ns); } }
  @keyframes nsShake { 0%,100% { transform:translateX(0); } 20% { transform:translateX(-10px); } 40% { transform:translateX(10px); } 60% { transform:translateX(-7px); } 80% { transform:translateX(7px); } }
  #nsOver { position:absolute; left:0; right:0; top:46px; bottom:0; display:none; flex-direction:column; align-items:center; justify-content:center;
            gap:12px; text-align:center; padding:20px; pointer-events:none; z-index:5; }
  #nsOver.show { display:flex; }
  #nsOver.dim { background:rgba(5,6,15,.78); }
  #nsOver .t { font-size:30px; font-weight:900; text-shadow:0 0 14px var(--ns); }
  #nsOver .t.num { font-size:150px; line-height:1; color:var(--ns); text-shadow:0 0 30px var(--ns); }
  #nsOver .s { font-size:17px; opacity:.85; max-width:320px; }
  #nsAgain { pointer-events:auto; display:none; font-size:26px; padding:18px 34px; border:3px solid var(--ns); border-radius:20px; background:var(--ns); color:#000; font-weight:900; box-shadow:0 0 28px var(--ns); }
  @media (orientation:landscape) {
    #v-neonspur .bar { padding:4px 14px; }
    #v-neonspur .word { font-size:17px; }
    #nsPad { grid-template-columns:2fr 1fr 2fr; grid-template-rows:1fr; grid-template-areas:"l j r"; padding:8px; gap:10px; }
    #nsPad.ex { grid-template-columns:2fr 1.3fr 2fr; grid-template-rows:1fr 1fr; grid-template-areas:"l j r" "l t r"; }
    #nsPad.ex #nsJ .lab, #nsT .lab { font-size:18px; }
    #nsToast { top:50%; font-size:20px; }
    #nsOver { top:38px; }
    #nsOver .t.num { font-size:100px; }
    #nsOver .t { font-size:26px; }
    #nsL .arr, #nsR .arr { font-size:48px; }
    #nsJ .lab { font-size:20px; }
  }
</style>
<!-- NEONSPUR -->
<div id="v-neonspur" class="view">
  <div class="bar"><span class="word">⚡ Neonspur</span><span id="nsShield">🛡️</span><span id="nsWins"></span><button id="nsCam">🎥 Ego</button></div>
  <div id="nsPad" class="ex">
    <button id="nsL"><span class="arr">◀</span><span class="lab">LINKS</span></button>
    <button id="nsR"><span class="arr">▶</span><span class="lab">RECHTS</span></button>
    <button id="nsJ"><span class="fill"></span><span class="lab">⤴ SPRUNG</span></button>
    <button id="nsT"><span class="fill"></span><span class="lab">🚀 TURBO</span><span class="sub">voll!</span></button>
  </div>
  <div id="nsToast"></div>
  <div id="nsOver"><div class="t" id="nsOverT"></div><div class="s" id="nsOverS"></div><button id="nsAgain">🔁 Nochmal</button></div>
</div>`);
  VIEWS.push('neonspur');

  const root = $('v-neonspur'), padEl = $('nsPad'), jumpEl = $('nsJ'), fillEl = jumpEl.querySelector('.fill');
  const turboEl = $('nsT'), tFill = turboEl.querySelector('.fill'), toastEl = $('nsToast');
  const TOASTS = { boost: '🔋 Turbo voll!', jump: '🦘 Sprung bereit!', shield: '🛡️ Schild aktiv!', blast: '💥 Schockwelle!' };
  const camName = (c) => c === 'chase' ? 'Verfolger' : 'Ego';
  let st, readyTimer = null, toastTimer = null, boosting = false, turboTouch = null, turboKey = false, turboMouse = false;

  function reset() {
    st = { rider: true, color: '#00e5ff', cam: 'pov', camToggle: true, phase: 'wait', n: 0, alive: true, killer: null, wins: 0, winner: null, champion: null, host: false, started: false, extras: true, boost: 0, shield: false };
    releaseTurbo(); clearTimeout(toastTimer); toastTimer = null; toastEl.classList.remove('show');
    clearTimeout(readyTimer); readyTimer = null;
    setJump(0, true); renderTurbo(); root.classList.remove('shield');
  }

  function vib(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  const send = (m) => ac.message(AirConsole.SCREEN, m);

  // ---- Sprung-Cooldown: Füllung läuft über jumpIn ms, dann Ready-Glow ----
  function setJump(ms, silent) {
    clearTimeout(readyTimer); readyTimer = null;
    fillEl.style.transition = 'none'; fillEl.style.width = '0';
    if (!(ms > 0)) { jumpEl.classList.remove('charging'); jumpEl.classList.add('ready'); return; }
    jumpEl.classList.add('charging'); jumpEl.classList.remove('ready');
    void fillEl.offsetWidth;   // Reflow, damit die Transition neu startet
    fillEl.style.transition = 'width ' + ms + 'ms linear'; fillEl.style.width = '100%';
    readyTimer = setTimeout(() => {
      readyTimer = null; jumpEl.classList.remove('charging'); jumpEl.classList.add('ready');
      fillEl.style.transition = 'none'; fillEl.style.width = '0';
      vib(8);
    }, ms);
  }

  // ---- Turbo (halten) ----
  function setBoost(on) {
    if (on === boosting) return;
    boosting = on; send({ t: 'nsBoost', on }); if (on) vib(10);
    renderTurbo();
  }
  function releaseTurbo() { turboTouch = null; turboKey = false; turboMouse = false; setBoost(false); }
  function turboHeld() { return turboTouch !== null || turboKey || turboMouse; }
  function canTurbo() { return st.rider && st.extras && st.alive && st.phase !== 'roundOver' && st.phase !== 'final'; }
  function syncTurbo() { if (turboHeld() && canTurbo()) setBoost(true); else if (boosting) setBoost(false); }
  function renderTurbo() {
    const b = st.boost, full = b >= 0.98;
    tFill.style.width = Math.round(b * 100) + '%';
    turboEl.classList.toggle('full', full);
    turboEl.classList.toggle('some', b > 0.02 && !full);
    turboEl.classList.toggle('pulse', boosting && b > 0.02);
  }
  function setBoostLevel(v) {
    const was = st.boost >= 0.98;
    st.boost = Math.max(0, Math.min(1, +v || 0));
    if (!was && st.boost >= 0.98 && st.alive) {
      vib(15); turboEl.classList.remove('pop'); void turboEl.offsetWidth; turboEl.classList.add('pop');
      setTimeout(() => turboEl.classList.remove('pop'), 520);
    }
    renderTurbo();
  }
  function touchId(e, ended) {
    const l = ended ? e.changedTouches : (e.changedTouches || e.touches);
    return l && l.length ? l[0].identifier : 0;
  }
  function hasTouch(e, id) {
    if (!e.changedTouches) return true;
    for (let i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === id) return true;
    return false;
  }
  turboEl.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (turboTouch === null) turboTouch = touchId(e); syncTurbo();
  }, { passive: false });
  const tEnd = (e) => { e.preventDefault(); e.stopPropagation(); if (turboTouch !== null && hasTouch(e, turboTouch)) { turboTouch = null; syncTurbo(); } };
  turboEl.addEventListener('touchend', tEnd, { passive: false });
  turboEl.addEventListener('touchcancel', tEnd, { passive: false });
  turboEl.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); turboMouse = true; syncTurbo(); });
  turboEl.addEventListener('mouseleave', () => { if (turboMouse) { turboMouse = false; syncTurbo(); } });
  window.addEventListener('mouseup', () => { if (turboMouse) { turboMouse = false; syncTurbo(); } });
  turboEl.addEventListener('click', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseTurbo(); });
  window.addEventListener('blur', releaseTurbo);
  window.addEventListener('pagehide', releaseTurbo);
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || e.key === 'b' || e.key === 'B') { turboKey = false; syncTurbo(); }
  });

  function toast(kind) {
    if (!TOASTS[kind]) return;
    toastEl.textContent = TOASTS[kind]; toastEl.classList.add('show'); vib(30);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastTimer = null; toastEl.classList.remove('show'); }, 1600);
  }

  function flash(el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 110); }

  // ---- Eingaben ----
  function turn(d) { if (!st.rider) return; send({ t: 'nsTurn', d }); vib(12); flash(d === 'L' ? $('nsL') : $('nsR')); }
  function jump() {
    if (!st.rider) return;
    send({ t: 'nsJump' }); vib(12); flash(jumpEl);
    if (jumpEl.classList.contains('charging')) {
      jumpEl.classList.remove('nope'); void jumpEl.offsetWidth; jumpEl.classList.add('nope');
      setTimeout(() => jumpEl.classList.remove('nope'), 320);
    }
  }
  function camToggle() { if (st.camToggle) send({ t: 'nsCam' }); }
  function bind(el, fn) {
    const on = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
    el.addEventListener('touchstart', on, { passive: false }); el.addEventListener('mousedown', on);
    el.addEventListener('click', (e) => e.preventDefault());
  }
  bind($('nsL'), () => turn('L')); bind($('nsR'), () => turn('R')); bind(jumpEl, jump); bind($('nsCam'), camToggle);
  $('nsAgain').addEventListener('click', () => send({ t: 'nsAgain' }));

  document.addEventListener('keydown', (e) => {
    if (!root.classList.contains('on') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'Shift' || k === 'b' || k === 'B') { turboKey = true; syncTurbo(); return; }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') turn('L');
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') turn('R');
    else if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') jump();
    else if (k === 'c' || k === 'C') camToggle();
    else return;
    e.preventDefault();
  });

  // ---- Anzeige ----
  function setColor(c) {
    if (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c)) st.color = c;
    root.style.setProperty('--ns', st.color);
  }
  function render() {
    $('nsCam').textContent = '🎥 ' + camName(st.cam);
    $('nsCam').style.display = st.camToggle ? '' : 'none';
    padEl.classList.toggle('ex', st.extras);
    turboEl.style.display = st.extras ? '' : 'none';
    root.classList.toggle('shield', st.shield && st.alive && st.rider);
    $('nsWins').textContent = st.rider ? '🏆 ' + st.wins : '';
    root.classList.toggle('host', !!myHost);
    const o = $('nsOver'), t = $('nsOverT'), s = $('nsOverS'), again = $('nsAgain');
    let T = '', S = '', dim = false, num = false, showAgain = false;
    if (!st.rider) { T = '👀 Du schaust zu'; S = 'beim nächsten freien Platz bist du dabei'; dim = true; }
    else if (st.phase === 'final') {
      T = '👑 ' + (st.champion || '???') + ' gewinnt!'; dim = true;
      if (st.host) showAgain = true; else S = 'Warte auf den Host…';
    } else if (st.phase === 'roundOver') {
      T = st.winner ? '🏁 ' + st.winner + ' gewinnt die Runde!' : '🤝 Unentschieden!';
      S = '🏆 Deine Siege: ' + st.wins; dim = true;
    } else if (!st.alive) {
      T = '💀 Ausgeschieden'; S = (st.killer ? 'durch ' + st.killer + '\n' : '') + 'Du schaust zu — nächste Runde geht\'s weiter'; dim = true;
    } else if (st.phase === 'countdown' && st.n > 0) { T = String(st.n); num = true; }
    else if (!st.started) { T = 'Gleich geht\'s los…'; }
    o.classList.toggle('show', !!T); o.classList.toggle('dim', dim);
    t.textContent = T; t.classList.toggle('num', num);
    s.textContent = S; s.style.whiteSpace = 'pre-line';
    again.style.display = showAgain ? 'block' : 'none';
    padEl.classList.toggle('hide', !st.rider);
    padEl.style.opacity = (!st.alive && st.rider) ? '.35' : '';
  }

  const NS = {
    activate() {
      reset();
      turboEl.classList.remove('anim'); setTimeout(() => turboEl.classList.add('anim'), 500);
      showView('neonspur');
      render();
    },
    onMessage(d) {
      if (!d || !st) return;
      if (d.host !== undefined) { myHost = d.host; updateAbort(); st.host = !!d.host; }
      if (d.t === 'nsInfo') {
        st.rider = d.rider !== false; setColor(d.color);
        if (d.cam) st.cam = d.cam;
        st.camToggle = d.camToggle !== false;
        st.extras = d.extras !== false;
        if (!st.extras) releaseTurbo();
        if (!st.rider) st.phase = 'wait';
      } else if (d.t === 'nsPhase') {
        st.phase = d.phase; st.started = true;
        if (d.n !== undefined) st.n = d.n;
        if (d.wins !== undefined) st.wins = d.wins;
        st.winner = d.winner || null; st.champion = d.champion || null;
        if (d.phase === 'countdown') { st.alive = true; st.killer = null; }
        if (d.phase === 'live') st.n = 0;
        if (d.phase === 'roundOver' || d.phase === 'final') { releaseTurbo(); st.shield = false; }
      } else if (d.t === 'nsYou') {
        const was = st.alive;
        st.alive = d.alive !== false; st.killer = d.killer || null;
        if (d.boost !== undefined) setBoostLevel(d.boost);
        if (d.shield !== undefined) st.shield = !!d.shield;
        if (st.alive) setJump(d.jumpIn || 0);
        else { st.shield = false; releaseTurbo(); setJump(0); jumpEl.classList.remove('ready'); if (was) vib([80, 40, 120]); }
      } else if (d.t === 'nsItem') {
        if (st.rider && st.alive) toast(d.kind);
      } else if (d.t === 'nsCamIs') {
        if (d.cam) st.cam = d.cam;
      } else return;
      render();
    }
  };
  reset();
  registerGame({ key: 'neonspur', controller: NS });
})();
