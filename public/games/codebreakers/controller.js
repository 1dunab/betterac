// ============ Controller-Modul: CODE BREAKERS ===============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #codePad { flex:1; display:grid; gap:12px; padding:16px; min-height:0;
             grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; }
  #codePad button { border:none; border-radius:20px; background:rgba(0,0,0,.30); color:#fff;
                    font-size:22px; font-weight:800; text-shadow:0 1px 4px rgba(0,0,0,.35); }
  #codePad button:active { background:rgba(255,255,255,.30); }
</style>
<!-- CODE BREAKERS -->
<div id="v-code" class="view">
  <div class="bar"><span class="word">🔐 Code Breakers</span></div>
  <div id="codePad">
    <button data-code="red" style="background:#ff453a">Rot</button>
    <button data-code="blue" style="background:#0a84ff">Blau</button>
    <button data-code="green" style="background:#30d158">Gruen</button>
    <button data-code="yellow" style="background:#ffd60a; color:#241b00">Gelb</button>
  </div>
  <div id="codeStatus" class="muted" style="text-align:center; padding:0 16px 14px">Warte...</div>
</div>`);
  VIEWS.push('code');

  document.querySelectorAll('#codePad button[data-code]').forEach(b => {
    const fire = e => { e.preventDefault(); ac.message(AirConsole.SCREEN, { t: 'codePress', key: b.getAttribute('data-code') }); };
    b.addEventListener('touchstart', fire); b.addEventListener('mousedown', fire);
  });
  const CODEc = {
    activate() { $('codeStatus').textContent = 'Merke die Reihenfolge auf dem Screen.'; showView('code'); },
    onMessage(d) {
      if (d.t === 'codeStart') $('codeStatus').textContent = 'Bereit...';
      else if (d.t === 'codeRound') $('codeStatus').textContent = 'Merken: ' + d.len + ' Farben';
      else if (d.t === 'codeScore') $('codeStatus').textContent = (d.ok ? 'Richtig' : 'Falsch') + ' · ' + d.progress + '/' + d.len + ' · ' + d.score + ' Punkte';
      else if (d.t === 'codeDone') $('codeStatus').textContent = d.winner ? 'Du gewinnst!' : d.name + ' gewinnt.';
    }
  };
  registerGame({ key: 'codebreakers', controller: CODEc });
})();
