// ============ Controller-Modul: SPACE ARENA ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #saPad { flex:1; display:grid; gap:12px; padding:16px; min-height:0;
           grid-template-columns:1fr 1fr; grid-template-rows:1fr 1.25fr; }
  #saPad button { border:none; border-radius:20px; background:rgba(0,0,0,.30); color:#fff; font-size:40px; font-weight:800; }
  #saPad button:active, #saPad button.on { background:rgba(255,255,255,.30); }
  #sa-thrust { background:linear-gradient(180deg, rgba(50,140,255,.5), rgba(0,0,0,.30)); font-size:30px; }
  #sa-fire { background:linear-gradient(180deg, rgba(255,80,60,.5), rgba(0,0,0,.30)); font-size:30px; }
</style>
<!-- SPACE ARENA -->
<div id="v-sa" class="view">
  <div class="bar"><span class="word">🚀 Space Arena</span><span id="saPoints" class="timer"></span></div>
  <div id="saPad">
    <button id="sa-left">↺</button>
    <button id="sa-right">↻</button>
    <button id="sa-thrust">🚀 SCHUB</button>
    <button id="sa-fire">🔥 FEUER</button>
  </div>
  <div id="saStatus" class="muted" style="text-align:center; padding:0 16px 12px">Drehen · Schub · Feuer — das All vergisst nicht.</div>
  <button id="saAgainBtn" class="btn go" style="display:none; margin:0 16px 14px; font-size:18px">🔁 Nochmal</button>
</div>`);
  VIEWS.push('sa');

  const ctl = { turn: 0, thrust: false, fire: false };
  let left = false, right = false;
  function sendCtl() {
    ctl.turn = (right ? 1 : 0) - (left ? 1 : 0);
    ac.message(AirConsole.SCREEN, { t: 'saCtl', turn: ctl.turn, thrust: ctl.thrust, fire: ctl.fire });
  }
  function bindHold(id, set) {
    const el = $(id);
    const on = (e) => { e.preventDefault(); set(true); el.classList.add('on'); sendCtl(); };
    const off = (e) => { e.preventDefault(); set(false); el.classList.remove('on'); sendCtl(); };
    el.addEventListener('touchstart', on); el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
    el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
  }
  bindHold('sa-left', v => left = v);
  bindHold('sa-right', v => right = v);
  bindHold('sa-thrust', v => ctl.thrust = v);
  bindHold('sa-fire', v => ctl.fire = v);
  $('saAgainBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'saAgain' }));

  const SAc = {
    activate() {
      left = right = false; ctl.turn = 0; ctl.thrust = ctl.fire = false;
      $('saPoints').textContent = '';
      $('saAgainBtn').style.display = 'none';
      $('saStatus').textContent = 'Drehen · Schub · Feuer — das All vergisst nicht.';
      showView('sa');
    },
    onMessage(d) {
      if (d.t === 'saState') {
        $('saAgainBtn').style.display = 'none';
        if (d.phase === 'countdown') $('saStatus').textContent = '🚦 Runde ' + d.round + ' — gleich geht\'s los…';
        else if (d.phase === 'fight') $('saStatus').textContent = '⚔️ Letztes Schiff gewinnt!';
      } else if (d.t === 'saYou') {
        if (d.points !== undefined) $('saPoints').textContent = d.points + ' / ' + d.target;
        if (d.dead) $('saStatus').textContent = '💥 Zerstört — schau der Runde zu!';
        else if (d.msg) $('saStatus').textContent = d.msg;
      } else if (d.t === 'saFinal') {
        $('saStatus').textContent = d.winner ? '👑 DU BEHERRSCHST DAS ALL!' : '👑 ' + d.name + ' gewinnt.';
        $('saAgainBtn').style.display = d.host ? 'block' : 'none';
      }
    }
  };
  registerGame({ key: 'spacearena', controller: SAc });
})();
