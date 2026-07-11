// ============ Controller-Modul: SINTFLUT ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #flPad { flex:1; display:grid; gap:10px; padding:12px; min-height:0;
           grid-template-columns:1.4fr 1fr; grid-template-rows:1fr 1fr 1fr 1fr; }
  #flStick { grid-column:1; grid-row:1/span 4; position:relative; border-radius:18px; overflow:hidden;
             touch-action:none; background-color:rgba(0,0,0,.30);
             background-image:
               linear-gradient(to top right, transparent calc(50% - 1px), rgba(255,255,255,.14) 50%, transparent calc(50% + 1px)),
               linear-gradient(to bottom right, transparent calc(50% - 1px), rgba(255,255,255,.14) 50%, transparent calc(50% + 1px)); }
  #flStick .arrow { position:absolute; font-size:28px; font-weight:800; color:rgba(255,255,255,.4);
                    transform:translate(-50%,-50%); pointer-events:none; }
  #flDot { position:absolute; width:24px; height:24px; border-radius:50%; background:rgba(120,220,255,.7);
           transform:translate(-50%,-50%); pointer-events:none; display:none; box-shadow:0 0 14px rgba(60,200,255,.9); }
  #flPad .act { border:none; border-radius:16px; color:#fff; font-size:17px; font-weight:800; }
  #flPad .act:active, #flPad .act.on { filter:brightness(1.5); }
  #fl-sand { background:#8a6b3a; }
  #fl-dig  { background:#4a4456; }
  #fl-tnt  { background:#a83226; }
  #fl-ice  { background:#2a6e8e; }
  #flPad .act:disabled { opacity:.3; }
  #flTank { height:6px; border-radius:3px; background:rgba(255,255,255,.15); margin:0 14px 4px; overflow:hidden; }
  #flTankFill { height:100%; width:100%; background:#e8c88a; border-radius:3px; }
</style>
<!-- SINTFLUT -->
<div id="v-fl" class="view">
  <div class="bar"><span class="word">🌊 Sintflut</span><span id="flFill" class="timer">0%</span></div>
  <div id="flPad">
    <div id="flStick">
      <span class="arrow" style="left:50%; top:14%">↑</span>
      <span class="arrow" style="left:50%; top:86%">↓</span>
      <span class="arrow" style="left:13%; top:50%">←</span>
      <span class="arrow" style="left:87%; top:50%">→</span>
      <div id="flDot"></div>
    </div>
    <button id="fl-sand" class="act">🏖️ SAND</button>
    <button id="fl-dig" class="act">⛏️ GRABEN</button>
    <button id="fl-tnt" class="act">🧨 TNT ×3</button>
    <button id="fl-ice" class="act">❄️ EIS ×1</button>
  </div>
  <div id="flTank"><div id="flTankFill"></div></div>
  <div id="flStatus" class="muted" style="text-align:center; padding:0 16px 12px">Dämm dein Haus — leite die Flut zu den Nachbarn!</div>
  <button id="flAgainBtn" class="btn go" style="display:none; margin:0 14px 14px; font-size:18px">🔁 Nochmal</button>
</div>`);
  VIEWS.push('fl');

  // Analog-Stick (Muster vom Boss-Raid-Pad)
  const stick = $('flStick'), dot = $('flDot');
  let lastSent = 0, lastX = 0, lastY = 0;
  function sendMove(x, y, force) {
    const now = performance.now();
    if (!force && now - lastSent < 50 && Math.abs(x - lastX) < 0.08 && Math.abs(y - lastY) < 0.08) return;
    lastSent = now; lastX = x; lastY = y;
    ac.message(AirConsole.SCREEN, { t: 'flMove', x, y });
  }
  function stickInput(clientX, clientY) {
    const r = stick.getBoundingClientRect();
    let dx = (clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (clientY - (r.top + r.height / 2)) / (r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len < 0.12) { dx = 0; dy = 0; }
    else if (len > 1) { dx /= len; dy /= len; }
    dot.style.display = 'block';
    dot.style.left = (clientX - r.left) + 'px';
    dot.style.top = (clientY - r.top) + 'px';
    sendMove(Math.round(dx * 100) / 100, Math.round(dy * 100) / 100);
  }
  function stickEnd(e) {
    if (e) e.preventDefault();
    dot.style.display = 'none';
    sendMove(0, 0, true);
  }
  stick.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.touches[0]; stickInput(t.clientX, t.clientY); });
  stick.addEventListener('touchmove', (e) => { e.preventDefault(); const t = e.touches[0]; stickInput(t.clientX, t.clientY); });
  stick.addEventListener('touchend', stickEnd); stick.addEventListener('touchcancel', stickEnd);
  let mouseHeld = false;
  stick.addEventListener('mousedown', (e) => { e.preventDefault(); mouseHeld = true; stickInput(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (mouseHeld) stickInput(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { if (mouseHeld) { mouseHeld = false; stickEnd(); } });

  // Halte-Aktionen Sand/Graben
  const act = { sand: false, dig: false };
  function sendAct() { ac.message(AirConsole.SCREEN, { t: 'flAct', sand: act.sand, dig: act.dig }); }
  function bindHold(id, key) {
    const el = $(id);
    const on = (e) => { e.preventDefault(); act[key] = true; el.classList.add('on'); sendAct(); };
    const off = (e) => { e.preventDefault(); act[key] = false; el.classList.remove('on'); sendAct(); };
    el.addEventListener('touchstart', on); el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
    el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
  }
  bindHold('fl-sand', 'sand'); bindHold('fl-dig', 'dig');

  const fireTnt = (e) => { e.preventDefault(); ac.message(AirConsole.SCREEN, { t: 'flTnt' }); };
  const fireIce = (e) => { e.preventDefault(); ac.message(AirConsole.SCREEN, { t: 'flIce' }); };
  $('fl-tnt').addEventListener('touchstart', fireTnt); $('fl-tnt').addEventListener('mousedown', fireTnt);
  $('fl-ice').addEventListener('touchstart', fireIce); $('fl-ice').addEventListener('mousedown', fireIce);
  $('flAgainBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'flAgain' }));

  const FLc = {
    activate() {
      act.sand = act.dig = false;
      $('flFill').textContent = '0%';
      $('flTankFill').style.width = '100%';
      $('fl-tnt').textContent = '🧨 TNT ×3'; $('fl-tnt').disabled = false;
      $('fl-ice').textContent = '❄️ EIS ×1'; $('fl-ice').disabled = false;
      $('flAgainBtn').style.display = 'none';
      $('flStatus').textContent = 'Dämm dein Haus — leite die Flut zu den Nachbarn!';
      showView('fl');
    },
    onMessage(d) {
      if (d.t === 'flYou') {
        if (d.fill !== undefined) $('flFill').textContent = Math.round(d.fill * 100) + '%';
        if (d.tank !== undefined) $('flTankFill').style.width = Math.round(d.tank) + '%';
        if (d.tnt !== undefined) { $('fl-tnt').textContent = '🧨 TNT ×' + d.tnt; $('fl-tnt').disabled = d.tnt <= 0; }
        if (d.ice !== undefined) { $('fl-ice').textContent = '❄️ EIS ×' + d.ice; $('fl-ice').disabled = d.ice <= 0; }
        if (d.ghost) { $('flFill').textContent = '👻'; $('flStatus').textContent = '👻 Abgesoffen — grab und troll weiter!'; }
        else if (d.msg) $('flStatus').textContent = d.msg;
      } else if (d.t === 'flState') {
        $('flAgainBtn').style.display = 'none';
        if (d.phase === 'run') $('flStatus').textContent = '🌊 Das Wasser kommt!';
      } else if (d.t === 'flEnd') {
        $('flStatus').textContent = d.winner ? '🏆 DEIN HAUS STEHT NOCH!' : '👑 ' + d.name + ' bleibt trocken.';
        $('flAgainBtn').style.display = d.host ? 'block' : 'none';
      }
    }
  };
  registerGame({ key: 'sintflut', controller: FLc });
})();
