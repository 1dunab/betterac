// ============ Controller-Modul: AUTOBALL ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
// Vor dem Anpfiff: Team wählen. Im Spiel: Daumen-Stick (zeigt, wohin das Auto auf dem Fernseher
// fahren soll) links und ein Boost-Knopf rechts — für zwei Daumen, hochkant wie quer.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #v-abteams .abteam { border-radius:18px; padding:14px 18px; font-size:26px; font-weight:800; color:#10141a; min-width:220px; }
  #abLists { display:flex; gap:10px; width:100%; max-width:380px; }
  #abLists > div { flex:1; border-radius:12px; padding:8px; background:rgba(0,0,0,.28); font-size:15px; line-height:1.5; min-height:60px; }
  #abLists b { display:block; margin-bottom:2px; }
  #abPad { flex:1; display:grid; gap:12px; padding:12px 16px 16px; min-height:0; grid-template-columns:1.6fr 1fr; }
  #ab-stick { order:1; } #ab-boost { order:2; }
  #ab-boost { border:none; border-radius:20px; color:#fff; font-weight:800; font-size:26px; position:relative; overflow:hidden;
              background:rgba(0,0,0,.30); }
  #ab-boost.on { background:rgba(255,255,255,.30); }
  #ab-boost.empty { opacity:.45; }
  #abTank { position:absolute; left:0; bottom:0; height:10px; width:50%; background:linear-gradient(90deg,#ff9f0a,#ffd60a); }
  #ab-stick { border-radius:20px; background:rgba(0,0,0,.30); position:relative; overflow:hidden; touch-action:none; }
  #abRing, #abKnob { position:absolute; border-radius:50%; pointer-events:none; transform:translate(-50%,-50%); }
  #abRing { width:124px; height:124px; border:3px solid rgba(255,255,255,.35); left:50%; top:50%; }
  #abKnob { width:62px; height:62px; background:rgba(255,255,255,.85); left:50%; top:50%; }
  #abHint { position:absolute; left:0; right:0; bottom:10px; text-align:center; opacity:.6; font-size:14px; pointer-events:none; }
</style>
<!-- AUTOBALL: Teamwahl -->
<div id="v-abteams" class="view">
  <div class="bar"><span class="word">⚽ Autoball</span></div>
  <div class="center">
    <div class="muted">Du fährst für</div>
    <div id="abTeamName" class="abteam">Team</div>
    <button id="abSwitch" class="btn" style="font-size:18px">↔ Team wechseln</button>
    <div id="abLists"><div id="abList0"></div><div id="abList1"></div></div>
    <button id="abStart" class="btn go" style="display:none; width:100%; max-width:380px; flex:0; font-size:20px">⚽ Anpfiff</button>
    <div id="abWait" class="muted">Der Host pfeift an…</div>
  </div>
</div>
<!-- AUTOBALL: Spiel -->
<div id="v-abpad" class="view">
  <div class="bar"><span id="abScore" class="word">0 : 0</span><span id="abRoof" class="muted"></span></div>
  <div id="abPad">
    <button id="ab-boost">🚀 BOOST<span id="abTank"></span></button>
    <div id="ab-stick"><div id="abRing"></div><div id="abKnob"></div><div id="abHint">Daumen hier: zeig, wohin dein Auto fahren soll</div></div>
  </div>
  <div id="abStatus" class="muted" style="text-align:center; padding:0 16px 12px; min-height:20px"></div>
  <button id="abAgain" class="btn go" style="display:none; margin:0 16px 14px; flex:0; font-size:18px">🔁 Nochmal (Teams neu wählen)</button>
</div>`);
  VIEWS.push('abteams', 'abpad');

  const TEAM_NAMES = ['Orange', 'Blau'], TEAM_ICONS = ['🟠', '🔵'], R = 62;      // R: stick travel in px
  const toScreen = (m) => ac.message(AirConsole.SCREEN, m);
  const vib = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
  const playing = () => $('v-abpad').classList.contains('on');
  function tint(color) { try { document.body.style.background = shade(color); } catch (e) {} }

  // ---------- Teamwahl ----------
  $('abSwitch').addEventListener('click', () => toScreen({ t: 'abTeam' }));
  $('abStart').addEventListener('click', () => toScreen({ t: 'abStart' }));
  $('abAgain').addEventListener('click', () => toScreen({ t: 'abAgain' }));
  function showTeams(d) {
    $('abTeamName').textContent = TEAM_ICONS[d.team] + ' Team ' + TEAM_NAMES[d.team];
    $('abTeamName').style.background = d.color;
    [0, 1].forEach(t => {
      const el = $('abList' + t);
      el.innerHTML = '';
      const head = document.createElement('b'); head.textContent = TEAM_ICONS[t] + ' ' + TEAM_NAMES[t]; el.appendChild(head);
      (d.lists[t] || []).forEach(n => { const row = document.createElement('div'); row.textContent = n; el.appendChild(row); });
    });
    $('abStart').style.display = d.host ? 'block' : 'none';
    $('abStart').disabled = !d.canStart; $('abStart').style.opacity = d.canStart ? 1 : 0.5;
    $('abWait').textContent = d.host ? (d.canStart ? '' : 'Beide Teams brauchen mindestens ein Auto.') : 'Der Host pfeift an…';
    tint(d.color);
    release();
    showView('abteams');
  }

  // ---------- Stick ----------
  let sx = 0, sy = 0, sentX = 0, sentY = 0, sentAt = 0, touchId = null, ox = 0, oy = 0, boost = false;
  const keys = {};
  function sendStick(force) {
    const now = Date.now();
    if (!force && (now - sentAt < 50 || (Math.abs(sx - sentX) < 0.03 && Math.abs(sy - sentY) < 0.03))) return;
    sentAt = now; sentX = sx; sentY = sy;
    toScreen({ t: 'abStick', x: Math.round(sx * 100) / 100, y: Math.round(sy * 100) / 100 });
  }
  function knob() {
    const zone = $('ab-stick'), r = zone.getBoundingClientRect();
    const cx = touchId === null ? r.width / 2 : ox - r.left, cy = touchId === null ? r.height / 2 : oy - r.top;
    $('abRing').style.left = cx + 'px'; $('abRing').style.top = cy + 'px';
    $('abKnob').style.left = (cx + sx * R) + 'px'; $('abKnob').style.top = (cy + sy * R) + 'px';
  }
  function setStick(x, y, force) {
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    sx = x; sy = y;
    knob(); sendStick(force);
  }
  // the stick starts where the thumb lands; pulled further than its travel, it follows the thumb
  function move(px, py) {
    let dx = px - ox, dy = py - oy;
    const m = Math.hypot(dx, dy);
    if (m > R) { ox += dx * (1 - R / m); oy += dy * (1 - R / m); dx = px - ox; dy = py - oy; }
    setStick(dx / R, dy / R);
  }
  const stick = $('ab-stick');
  stick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (touchId !== null) return;
    const t = e.changedTouches[0];
    touchId = t.identifier; ox = t.clientX; oy = t.clientY;
    $('abHint').style.display = 'none';
    setStick(0, 0);
  });
  stick.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === touchId) move(t.clientX, t.clientY);
  });
  const lift = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === touchId) { touchId = null; setStick(0, 0, true); }
  };
  stick.addEventListener('touchend', lift); stick.addEventListener('touchcancel', lift);
  // Maus zum Testen am Rechner
  stick.addEventListener('mousedown', (e) => { e.preventDefault(); touchId = 'mouse'; ox = e.clientX; oy = e.clientY; $('abHint').style.display = 'none'; setStick(0, 0); });
  window.addEventListener('mousemove', (e) => { if (touchId === 'mouse') move(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { if (touchId === 'mouse') { touchId = null; setStick(0, 0, true); } });

  // ---------- Boost ----------
  function setBoost(on) {
    if (boost === on) return;
    boost = on;
    $('ab-boost').classList.toggle('on', on);
    toScreen({ t: 'abBoost', on });
  }
  const bb = $('ab-boost');
  bb.addEventListener('touchstart', (e) => { e.preventDefault(); setBoost(true); });
  bb.addEventListener('touchend', (e) => { e.preventDefault(); setBoost(false); });
  bb.addEventListener('touchcancel', (e) => { e.preventDefault(); setBoost(false); });
  bb.addEventListener('mousedown', (e) => { e.preventDefault(); setBoost(true); });
  bb.addEventListener('mouseup', () => setBoost(false)); bb.addEventListener('mouseleave', () => setBoost(false));

  // Tastatur zum Testen am Rechner: Pfeile / WASD = Stick, Leertaste = Boost
  const KEY = { ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r', ArrowUp: 'u', w: 'u', ArrowDown: 'd', s: 'd' };
  function fromKeys() { setStick((keys.r ? 1 : 0) - (keys.l ? 1 : 0), (keys.d ? 1 : 0) - (keys.u ? 1 : 0), true); }
  document.addEventListener('keydown', (e) => {
    if (!playing() || e.repeat) return;
    if (e.key === ' ') setBoost(true);
    else if (KEY[e.key]) { keys[KEY[e.key]] = true; fromKeys(); }
    else return;
    e.preventDefault();
  });
  document.addEventListener('keyup', (e) => {
    if (!playing()) return;
    if (e.key === ' ') setBoost(false);
    else if (KEY[e.key]) { keys[KEY[e.key]] = false; fromKeys(); }
  });

  // Finger weg, auch wenn das touchend verloren ging (App-Wechsel, Anstoß)
  function release() {
    touchId = null; for (const k in keys) keys[k] = false;
    if (sx || sy) setStick(0, 0, true); else knob();
    setBoost(false);
  }
  window.addEventListener('blur', () => { if (playing()) release(); });

  function setTank(v) {
    $('abTank').style.width = Math.round(v * 100) + '%';
    $('ab-boost').classList.toggle('empty', v < 0.12);
  }

  let phase = null;
  registerGame({ key: 'autoball', controller: {
    activate() {
      phase = null;
      $('abAgain').style.display = 'none'; $('abStatus').textContent = '';
      setTank(0.5);
      showView('abteams');
      toScreen({ t: 'abHello' });              // the screen answers with where we are (team selection or a running match)
    },
    onMessage(d) {
      if (d.t === 'abTeams') { phase = 'teams'; showTeams(d); }
      else if (d.t === 'abYou') { if (d.tank !== undefined) setTank(d.tank); }
      else if (d.t === 'abState') {
        if (!playing()) { showView('abpad'); knob(); }
        tint(d.color);
        $('abScore').textContent = TEAM_ICONS[0] + ' ' + d.score[0] + ' : ' + d.score[1] + ' ' + TEAM_ICONS[1];
        $('abRoof').innerHTML = 'Team ' + TEAM_NAMES[d.team] + ' · dein Dach: <span style="color:' + d.roof + '">⬤</span>';
        if (d.phase !== phase) {
          if (d.phase === 'kickoff') { release(); $('abStatus').textContent = 'Anstoß… 🚦'; }
          else if (d.phase === 'play') $('abStatus').textContent = '';
          else if (d.phase === 'goal') vib([80, 50, 160]);
          else if (d.phase === 'over') { release(); vib([120, 60, 240]); }
          phase = d.phase;
        }
        if (d.phase === 'over') $('abStatus').textContent = (d.won ? '🏆 Ihr habt gewonnen! ' : '😵 Verloren. ') + d.score[0] + ' : ' + d.score[1];
        else if (d.text) $('abStatus').textContent = d.text;
        else if (d.golden) $('abStatus').textContent = '✨ Golden Goal — das nächste Tor gewinnt!';
        $('abAgain').style.display = (d.phase === 'over' && d.host) ? 'block' : 'none';
      }
    }
  } });
})();
