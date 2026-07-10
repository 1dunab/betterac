// ============ Controller-Modul: BOSS RAID ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #brClassPick { display:flex; flex-direction:column; gap:12px; width:100%; max-width:340px; }
  #brClassPick button { border:none; border-radius:16px; padding:16px; font-size:18px; font-weight:800; color:#fff; text-align:left; }
  #brPad { flex:1; display:flex; flex-direction:column; gap:10px; padding:14px; min-height:0; }
  /* Vollflächen-Pad, diagonal in 4 Quadranten geteilt — keine Lücken, Finger kann gleiten */
  #brStick { flex:1; position:relative; border-radius:18px; overflow:hidden; min-height:0; touch-action:none;
             background-color:rgba(0,0,0,.30);
             background-image:
               linear-gradient(to top right, transparent calc(50% - 1px), rgba(255,255,255,.16) 50%, transparent calc(50% + 1px)),
               linear-gradient(to bottom right, transparent calc(50% - 1px), rgba(255,255,255,.16) 50%, transparent calc(50% + 1px)); }
  #brStick .arrow { position:absolute; font-size:34px; font-weight:800; color:rgba(255,255,255,.55);
                    transform:translate(-50%,-50%); pointer-events:none; transition:color .1s; }
  #brStick .arrow.on { color:#fff; text-shadow:0 0 14px rgba(120,60,255,.9); }
  #brDot { position:absolute; width:26px; height:26px; border-radius:50%; background:rgba(255,255,255,.65);
           transform:translate(-50%,-50%); pointer-events:none; display:none; box-shadow:0 0 16px rgba(120,60,255,.9); }
  #br-skill { border:none; border-radius:18px; color:#fff; font-size:22px; font-weight:800; padding:18px;
              background:linear-gradient(180deg, rgba(120,60,255,.55), rgba(0,0,0,.30)); }
  #br-skill:active { filter:brightness(1.3); }
  #br-skill.cooldown { opacity:.35; }
  #brHearts { letter-spacing:3px; }
</style>
<!-- BOSS RAID: KLASSE WÄHLEN -->
<div id="v-br-pick" class="view"><div class="center">
  <div class="big">Wähle deine Klasse ⚔️</div>
  <div id="brClassPick">
    <button data-cls="tank" style="background:#1e4976">🛡️ TANK<br><span style="font-weight:600; font-size:13px; opacity:.8">Schild-Blase: blockt Kugeln für das Team</span></button>
    <button data-cls="healer" style="background:#1e6e46">💚 HEALER<br><span style="font-weight:600; font-size:13px; opacity:.8">Heilkreis: heilt & belebt Geister wieder</span></button>
    <button data-cls="dd" style="background:#6e2a5e">⚡ DAMAGE<br><span style="font-weight:600; font-size:13px; opacity:.8">Mega-Laser: brutzelt den Boss</span></button>
  </div>
  <div id="brPickInfo" class="muted">Der Kampf startet, wenn alle gewählt haben.</div>
</div></div>
<!-- BOSS RAID: KAMPF -->
<div id="v-br-fight" class="view">
  <div class="bar"><span class="word" id="brCls">⚔️</span><span id="brHearts" class="timer">❤️❤️❤️</span></div>
  <div id="brPad">
    <div id="brStick">
      <span class="arrow" data-dir="up" style="left:50%; top:16%">↑</span>
      <span class="arrow" data-dir="down" style="left:50%; top:84%">↓</span>
      <span class="arrow" data-dir="left" style="left:12%; top:50%">←</span>
      <span class="arrow" data-dir="right" style="left:88%; top:50%">→</span>
      <div id="brDot"></div>
    </div>
    <button id="br-skill">SKILL</button>
  </div>
  <div id="brStatus" class="muted" style="text-align:center; padding:0 16px 12px">Weiche aus — geschossen wird automatisch!</div>
  <button id="brAgainBtn" class="btn go" style="display:none; margin:0 14px 14px; font-size:18px">🔁 Nochmal</button>
</div>`);
  VIEWS.push('br-pick', 'br-fight');

  const SKILL_LABEL = { tank: '🛡️ SCHILD', healer: '💚 HEILKREIS', dd: '⚡ MEGA-LASER' };
  const CLS_LABEL = { tank: '🛡️ Tank', healer: '💚 Healer', dd: '⚡ Damage' };
  let myCls = null, skillReady = true;

  document.querySelectorAll('#brClassPick button').forEach(b => b.addEventListener('click', () => {
    myCls = b.getAttribute('data-cls');
    $('brPickInfo').textContent = CLS_LABEL[myCls] + ' gewählt — warte auf die anderen…';
    ac.message(AirConsole.SCREEN, { t: 'brClass', cls: myCls });
  }));

  // Analog-Stick: Richtung = Vektor vom Pad-Zentrum zum Finger (mit Deadzone)
  const stick = $('brStick'), dot = $('brDot');
  let lastSent = 0, lastX = 0, lastY = 0;
  function sendMove(x, y, force) {
    const now = performance.now();
    if (!force && now - lastSent < 50 && Math.abs(x - lastX) < 0.08 && Math.abs(y - lastY) < 0.08) return;
    lastSent = now; lastX = x; lastY = y;
    ac.message(AirConsole.SCREEN, { t: 'brMove', x, y });
  }
  function syncArrows(x, y) {
    const active = (Math.abs(x) + Math.abs(y)) > 0.1
      ? (Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up'))
      : null;
    document.querySelectorAll('#brStick .arrow').forEach(a => a.classList.toggle('on', a.getAttribute('data-dir') === active));
  }
  function stickInput(clientX, clientY) {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (clientX - cx) / (r.width / 2), dy = (clientY - cy) / (r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len < 0.12) { dx = 0; dy = 0; }
    else if (len > 1) { dx /= len; dy /= len; }
    dot.style.display = 'block';
    dot.style.left = (clientX - r.left) + 'px';
    dot.style.top = (clientY - r.top) + 'px';
    syncArrows(dx, dy);
    sendMove(Math.round(dx * 100) / 100, Math.round(dy * 100) / 100);
  }
  function stickEnd(e) {
    if (e) e.preventDefault();
    dot.style.display = 'none';
    syncArrows(0, 0);
    sendMove(0, 0, true);
  }
  stick.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.touches[0]; stickInput(t.clientX, t.clientY); });
  stick.addEventListener('touchmove', (e) => { e.preventDefault(); const t = e.touches[0]; stickInput(t.clientX, t.clientY); });
  stick.addEventListener('touchend', stickEnd); stick.addEventListener('touchcancel', stickEnd);
  let mouseHeld = false;
  stick.addEventListener('mousedown', (e) => { e.preventDefault(); mouseHeld = true; stickInput(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (mouseHeld) stickInput(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { if (mouseHeld) { mouseHeld = false; stickEnd(); } });

  const skillBtn = $('br-skill');
  const fireSkill = (e) => { e.preventDefault(); if (skillReady) ac.message(AirConsole.SCREEN, { t: 'brSkill' }); };
  skillBtn.addEventListener('touchstart', fireSkill); skillBtn.addEventListener('mousedown', fireSkill);
  function setSkill(ready) {
    skillReady = ready;
    skillBtn.classList.toggle('cooldown', !ready);
    skillBtn.textContent = (ready ? '' : '⏳ ') + (SKILL_LABEL[myCls] || 'SKILL');
  }
  $('brAgainBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'brAgain' }));

  const BRc = {
    activate() {
      myCls = null; skillReady = true;
      stickEnd();
      $('brPickInfo').textContent = 'Der Kampf startet, wenn alle gewählt haben.';
      $('brAgainBtn').style.display = 'none';
      showView('br-pick');
    },
    onMessage(d) {
      if (d.t === 'brState') {
        $('brAgainBtn').style.display = 'none';
        if (d.phase === 'fight') {
          $('brCls').textContent = CLS_LABEL[myCls] || '⚔️';
          setSkill(true);
          $('brStatus').textContent = 'Weiche aus — geschossen wird automatisch!';
          showView('br-fight');
        } else if (d.phase === 'pick') {
          BRc.activate();
        }
      } else if (d.t === 'brYou') {
        if (d.hp !== undefined) $('brHearts').textContent = d.hp > 0 ? '❤️'.repeat(d.hp) : '👻';
        if (d.skill !== undefined) setSkill(!!d.skill);
        if (d.ghost) $('brStatus').textContent = '👻 Du bist ein Geist — Teammates können dich wiederbeleben!';
        else if (d.revived) $('brStatus').textContent = '✨ Wiederbelebt! Weiter geht\'s!';
        else if (d.msg) $('brStatus').textContent = d.msg;
      } else if (d.t === 'brEnd') {
        $('brStatus').textContent = d.win ? '🏆 BOSS BESIEGT!' : '💀 Wipe… Boss erholt sich!';
        if (d.win) $('brAgainBtn').style.display = d.host ? 'block' : 'none';
      }
    }
  };
  registerGame({ key: 'bossraid', controller: BRc });
})();
