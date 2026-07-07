// ============ Controller-Modul: REAKTIONSDUELL ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #rxZone { flex:1; margin:12px; border-radius:20px; display:flex; flex-direction:column;
            align-items:center; justify-content:center; gap:10px; background:#3a3a48;
            font-weight:800; font-size:34px; text-align:center; transition:background .1s; }
  #rxSub { font-size:16px; font-weight:600; opacity:.8; }
</style>
<!-- REAKTIONSDUELL -->
<div id="v-rx" class="view">
  <div class="bar"><span class="word">⚡ Reaktionsduell</span></div>
  <div id="rxZone"><span id="rxMain">Bereit machen…</span><span id="rxSub"></span></div>
  <button id="rxAgainBtn" class="btn go" style="display:none; margin:0 12px 14px">🔁 Nochmal</button>
</div>`);
  VIEWS.push('rx');

  const zone = $('rxZone');
  function setZone(bg, main, sub) {
    zone.style.background = bg;
    $('rxMain').textContent = main;
    $('rxSub').textContent = sub || '';
  }
  const tap = (e) => { e.preventDefault(); ac.message(AirConsole.SCREEN, { t: 'rxTap' }); };
  zone.addEventListener('touchstart', tap); zone.addEventListener('mousedown', tap);
  $('rxAgainBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'rxAgain' }));

  const RXc = {
    activate() { $('rxAgainBtn').style.display = 'none'; setZone('#3a3a48', 'Bereit machen…', ''); showView('rx'); },
    onMessage(d) {
      if (d.t === 'rxState') {
        $('rxAgainBtn').style.display = 'none';
        if (d.phase === 'armed') setZone('#5a1720', '🔴 Warte…', 'Tippe erst, wenn es GRÜN wird!');
        else if (d.phase === 'go') setZone('#0f5a2b', 'TIPP! 👆', '');
      } else if (d.t === 'rxYou') {
        if (d.res === 'early') setZone('#3d0c14', 'Zu früh! ❌', 'Diese Runde bist du raus.');
        else if (d.res === 'win') setZone('#173a5a', '🎉 Gewonnen!', d.ms + ' ms');
        else if (d.res === 'ok') setZone('#2a2a38', d.ms + ' ms', 'Nicht schnell genug…');
        else if (d.res === 'none') setZone('#2a2a38', 'Verpennt 😴', 'Kein Tap in dieser Runde.');
      } else if (d.t === 'rxPhase' && d.phase === 'final') {
        myHost = d.host; updateAbort();
        setZone('#2a2a38', '🏆 Fertig!', 'Schaut auf den großen Bildschirm.');
        $('rxAgainBtn').style.display = d.host ? 'block' : 'none';
      }
    }
  };
  registerGame({ key: 'reaction', controller: RXc });
})();
