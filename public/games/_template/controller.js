// TEMPLATE — the phone side of "Blitz-Klicker".
// Controllers inject their own views: controller.html only contains the shell
// (name entry, lobby, spectate). Wrap everything in an IIFE, inject markup
// first, then bind events, then register.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  /* Game-specific CSS goes here. Generic shell classes you can reuse:
     .view .bar .word .timer .btn .btn.go .center .big .muted .tools .modes .modebtn .step */
  #mgBtn { flex:1; margin:14px; border:none; border-radius:24px; font-size:44px; font-weight:800;
           background:linear-gradient(180deg, rgba(120,60,255,.55), rgba(0,0,0,.3)); color:#fff; }
  #mgBtn:active { filter:brightness(1.4); }
</style>
<div id="v-meingame" class="view">
  <div class="bar"><span class="word">🎮 Blitz-Klicker</span><span id="mgCount" class="timer">0</span></div>
  <button id="mgBtn">KLICK! 👆</button>
  <div id="mgStatus" class="muted" style="text-align:center; padding:0 16px 12px">Hämmer den Knopf!</div>
  <button id="mgAgainBtn" class="btn go" style="display:none; margin:0 14px 14px; font-size:18px">🔁 Nochmal</button>
</div>`);
  VIEWS.push('meingame');   // register the view key so showView() knows it

  let myClicks = 0;

  // Bind touchstart AND mousedown (desktop testing); always preventDefault.
  const tap = (e) => {
    e.preventDefault();
    myClicks++;
    $('mgCount').textContent = myClicks;
    ac.message(AirConsole.SCREEN, { t: 'mgClick' });
    try { navigator.vibrate && navigator.vibrate(15); } catch (err) {} // no vibrate on iOS
  };
  $('mgBtn').addEventListener('touchstart', tap);
  $('mgBtn').addEventListener('mousedown', tap);
  $('mgAgainBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'mgAgain' }));

  registerGame({ key: 'meingame', controller: {
    // Called when the game starts — ALWAYS reset local state here,
    // the controller object is a singleton that survives between rounds.
    activate() {
      myClicks = 0;
      $('mgCount').textContent = '0';
      $('mgAgainBtn').style.display = 'none';
      $('mgStatus').textContent = 'Hämmer den Knopf!';
      showView('meingame');
    },
    // Messages from the screen:
    onMessage(d) {
      if (d.t === 'mgState') {
        myClicks = 0;
        $('mgCount').textContent = '0';
        $('mgAgainBtn').style.display = 'none';
        $('mgStatus').textContent = 'Erster bei ' + d.ziel + ' gewinnt!';
      } else if (d.t === 'mgEnd') {
        $('mgStatus').textContent = d.win ? '🏆 DU gewinnst!' : '💥 ' + d.name + ' gewinnt.';
        // Only the host gets the rematch button:
        $('mgAgainBtn').style.display = d.host ? 'block' : 'none';
      }
    }
  }});
})();
