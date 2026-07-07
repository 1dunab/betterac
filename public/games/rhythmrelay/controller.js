// ============ Controller-Modul: RHYTHM RELAY ================
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #rhythmPad { flex:1; display:grid; gap:12px; padding:16px; min-height:0;
               grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; }
  #rhythmPad button { border:none; border-radius:20px; background:rgba(0,0,0,.30); color:#fff; font-size:36px; font-weight:800; }
  #rhythmPad button:active { background:rgba(255,255,255,.30); }
</style>
<!-- RHYTHM RELAY -->
<div id="v-rhythm" class="view">
  <div class="bar"><span class="word">🎵 Rhythm Relay</span></div>
  <div id="rhythmPad">
    <button data-rhythm="up">↑</button>
    <button data-rhythm="right">→</button>
    <button data-rhythm="left">←</button>
    <button data-rhythm="down">↓</button>
  </div>
  <div id="rhythmStatus" class="muted" style="text-align:center; padding:0 16px 14px">Warte...</div>
</div>`);
  VIEWS.push('rhythm');

  function sendRhythm(dir) { ac.message(AirConsole.SCREEN, { t: 'rhythmTap', dir }); }
  document.querySelectorAll('#rhythmPad button[data-rhythm]').forEach(b => {
    const fire = e => { e.preventDefault(); sendRhythm(b.getAttribute('data-rhythm')); };
    b.addEventListener('touchstart', fire); b.addEventListener('mousedown', fire);
  });
  const RHYTHMc = {
    activate() { $('rhythmStatus').textContent = 'Schau auf den Screen und triff die Pfeile.'; showView('rhythm'); },
    onMessage(d) {
      if (d.t === 'rhythmStart') $('rhythmStatus').textContent = 'Bereit...';
      else if (d.t === 'rhythmScore') $('rhythmStatus').textContent = d.hit + ' · ' + d.score + ' Punkte · Combo x' + d.combo;
      else if (d.t === 'rhythmDone') $('rhythmStatus').textContent = d.winner ? 'Du gewinnst!' : d.name + ' gewinnt.';
    }
  };
  registerGame({ key: 'rhythmrelay', controller: RHYTHMc });
})();
