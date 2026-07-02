// ============ Controller-Modul: SLITHER ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #pad3 { flex:1; display:grid; grid-template-columns:1fr 1fr; grid-template-rows:0.8fr 2fr; gap:12px; padding:16px; }
  #pad3 button { border:none; border-radius:20px; background:rgba(0,0,0,.30); color:#fff; font-weight:700; }
  #pad3 button:active, #pad3 button.on { background:rgba(255,255,255,.30); }
  #sl-boost { grid-column:1/span 2; font-size:24px; } #sl-left, #sl-right { font-size:46px; }
</style>
<!-- SLITHER -->
<div id="v-sl" class="view">
  <div class="bar"><span class="word">🐍 Slither</span></div>
  <div id="pad3"><button id="sl-boost">🚀 BOOST</button><button id="sl-left">↺</button><button id="sl-right">↻</button></div>
  <div class="muted" style="text-align:center; padding:0 16px 14px">Lenken halten · Boost kostet Masse</div>
</div>`);
  VIEWS.push('sl');

  const slState = { left: false, right: false, boost: false };
  function slSend() { ac.message(AirConsole.SCREEN, { steer: (slState.right ? 1 : 0) - (slState.left ? 1 : 0), boost: slState.boost }); }
  function slBind(id, key) {
    const el = $(id);
    const on = (e) => { e.preventDefault(); slState[key] = true; el.classList.add('on'); slSend(); };
    const off = (e) => { e.preventDefault(); slState[key] = false; el.classList.remove('on'); slSend(); };
    el.addEventListener('touchstart', on); el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
    el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
  }
  slBind('sl-left', 'left'); slBind('sl-right', 'right'); slBind('sl-boost', 'boost');
  const SLc = { activate() { slState.left = slState.right = slState.boost = false; showView('sl'); }, onMessage() {} };
  registerGame({ key: 'slither', controller: SLc });
})();
