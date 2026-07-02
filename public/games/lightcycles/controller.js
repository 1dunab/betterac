// ============ Controller-Modul: LIGHT CYCLES ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #pad2 { flex:1; display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:16px; }
  #pad2 button { font-size:46px; border:none; border-radius:20px; background:rgba(0,0,0,.30); color:#fff; }
  #pad2 button:active { background:rgba(255,255,255,.30); }
</style>
<!-- LIGHT CYCLES -->
<div id="v-lc" class="view">
  <div class="bar"><span class="word">🏍️ Light Cycles</span></div>
  <div id="pad2"><button data-turn="left">↺</button><button data-turn="right">↻</button></div>
  <div class="muted" style="text-align:center; padding:0 16px 14px">Links / rechts abbiegen — weiche aus!</div>
</div>`);
  VIEWS.push('lc');

  const LCc = {
    activate() { showView('lc'); },
    onMessage() {}
  };
  document.querySelectorAll('#pad2 button[data-turn]').forEach(btn => {
    const fire = (e) => { e.preventDefault(); ac.message(AirConsole.SCREEN, { turn: btn.getAttribute('data-turn') }); };
    btn.addEventListener('touchstart', fire); btn.addEventListener('mousedown', fire);
  });
  registerGame({ key: 'lightcycles', label: '🏍️ Light Cycles', min: 2, controller: LCc });
})();
