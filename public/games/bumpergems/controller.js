// ============ Controller-Modul: BUMPER GEMS =================
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #bumperPad { flex:1; display:grid; gap:12px; padding:16px; min-height:0;
               grid-template-columns:1fr 1fr 1fr; grid-template-rows:1fr 1fr 1fr; }
  #bumperPad button { border:none; border-radius:20px; background:rgba(0,0,0,.30); color:#fff; font-size:36px; font-weight:800; }
  #bumperPad button:active, #bumperPad button.on { background:rgba(255,255,255,.30); }
  #bumper-up { grid-column:2; grid-row:1; } #bumper-left { grid-column:1; grid-row:2; }
  #bumper-right { grid-column:3; grid-row:2; } #bumper-down { grid-column:2; grid-row:3; }
</style>
<!-- BUMPER GEMS -->
<div id="v-bumper" class="view">
  <div class="bar"><span class="word">💎 Bumper Gems</span></div>
  <div id="bumperPad">
    <button id="bumper-up">↑</button>
    <button id="bumper-left">←</button>
    <button id="bumper-right">→</button>
    <button id="bumper-down">↓</button>
  </div>
  <div id="bumperStatus" class="muted" style="text-align:center; padding:0 16px 14px">Warte...</div>
</div>`);
  VIEWS.push('bumper');

  const bumperState = { up: false, down: false, left: false, right: false };
  function sendBumperMove() {
    ac.message(AirConsole.SCREEN, { t: 'bumperMove', x: (bumperState.right ? 1 : 0) - (bumperState.left ? 1 : 0), y: (bumperState.down ? 1 : 0) - (bumperState.up ? 1 : 0) });
  }
  function bindBumper(id, key) {
    const el = $(id);
    const on = e => { e.preventDefault(); bumperState[key] = true; el.classList.add('on'); sendBumperMove(); };
    const off = e => { e.preventDefault(); bumperState[key] = false; el.classList.remove('on'); sendBumperMove(); };
    el.addEventListener('touchstart', on); el.addEventListener('mousedown', on);
    el.addEventListener('touchend', off); el.addEventListener('touchcancel', off); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
  }
  bindBumper('bumper-up', 'up'); bindBumper('bumper-down', 'down'); bindBumper('bumper-left', 'left'); bindBumper('bumper-right', 'right');
  const BUMPERc = {
    activate() { Object.keys(bumperState).forEach(k => bumperState[k] = false); $('bumperStatus').textContent = 'Sammle Diamanten und remple die anderen weg.'; showView('bumper'); },
    onMessage(d) {
      if (d.t === 'bumperStart') $('bumperStatus').textContent = 'Los!';
      else if (d.t === 'bumperState') $('bumperStatus').textContent = 'Punkte: ' + d.score;
      else if (d.t === 'bumperDone') $('bumperStatus').textContent = d.winner ? 'Du gewinnst!' : d.name + ' gewinnt.';
    }
  };
  registerGame({ key: 'bumpergems', controller: BUMPERc });
})();
