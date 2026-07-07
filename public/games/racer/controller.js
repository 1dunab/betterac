// ============ Controller-Modul: MICRO RACER ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #racePad { flex:1; display:grid; gap:12px; padding:16px; min-height:0;
             grid-template-columns:1fr 1fr; grid-template-rows:0.7fr 2fr; }
  #racePad button { border:none; border-radius:20px; background:rgba(0,0,0,.30); color:#fff; font-weight:800; }
  #racePad button:active, #racePad button.on { background:rgba(255,255,255,.30); }
  #race-nitro { grid-column:1/span 2; font-size:26px; background:linear-gradient(180deg, rgba(255,120,40,.55), rgba(0,0,0,.30)); }
  #race-nitro.cooldown { opacity:.35; }
  #race-left, #race-right { font-size:52px; }
</style>
<!-- MICRO RACER -->
<div id="v-race" class="view">
  <div class="bar"><span class="word">🏎️ Micro Racer</span><span id="raceRank" class="timer"></span></div>
  <div id="racePad">
    <button id="race-nitro">🔥 NITRO</button>
    <button id="race-left">↺</button>
    <button id="race-right">↻</button>
  </div>
  <div id="raceStatus" class="muted" style="text-align:center; padding:0 16px 14px">Gas gibt's automatisch — lenken und überleben!</div>
  <button id="raceAgainBtn" class="btn go" style="display:none; margin:0 16px 14px; font-size:18px">🔁 Nochmal</button>
</div>`);
  VIEWS.push('race');

  const steer = { left: false, right: false };
  function sendSteer() { ac.message(AirConsole.SCREEN, { t: 'raceSteer', s: (steer.right ? 1 : 0) - (steer.left ? 1 : 0) }); }
  function bindHold(id, key) {
    const el = $(id);
    const on = (e) => { e.preventDefault(); steer[key] = true; el.classList.add('on'); sendSteer(); };
    const off = (e) => { e.preventDefault(); steer[key] = false; el.classList.remove('on'); sendSteer(); };
    el.addEventListener('touchstart', on); el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
    el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
  }
  bindHold('race-left', 'left'); bindHold('race-right', 'right');

  let nitroReady = true;
  const nitroBtn = $('race-nitro');
  const fireNitro = (e) => {
    e.preventDefault();
    if (!nitroReady) return;
    ac.message(AirConsole.SCREEN, { t: 'raceNitro' });
  };
  nitroBtn.addEventListener('touchstart', fireNitro); nitroBtn.addEventListener('mousedown', fireNitro);

  function setNitro(ready) {
    nitroReady = ready;
    nitroBtn.classList.toggle('cooldown', !ready);
    nitroBtn.textContent = ready ? '🔥 NITRO' : '⏳ NITRO';
  }

  $('raceAgainBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'raceAgain' }));

  const RACEc = {
    activate() {
      steer.left = steer.right = false;
      setNitro(true);
      $('raceRank').textContent = '';
      $('raceAgainBtn').style.display = 'none';
      $('raceStatus').textContent = 'Gas gibt\'s automatisch — lenken und überleben!';
      showView('race');
    },
    onMessage(d) {
      if (d.t === 'raceState') {
        $('raceAgainBtn').style.display = 'none';
        if (d.phase === 'countdown') { setNitro(true); $('raceStatus').textContent = 'Gleich geht\'s los… 🚦'; }
        else if (d.phase === 'race') $('raceStatus').textContent = 'Fahr! 🏁';
      } else if (d.t === 'raceYou') {
        if (d.nitro !== undefined) setNitro(!!d.nitro);
        if (d.rank) $('raceRank').textContent = 'P' + d.rank;
        if (d.out) $('raceStatus').textContent = '💥 Rausgeflogen — nächster Heat kommt bestimmt!';
        else if (d.msg) $('raceStatus').textContent = d.msg;
      } else if (d.t === 'raceScore') {
        $('raceStatus').textContent = (d.won ? '🏆 Heat gewonnen! ' : '') + 'Punkte: ' + d.points + ' / ' + d.target;
      } else if (d.t === 'raceFinal') {
        $('raceStatus').textContent = d.winner ? '👑 DU GEWINNST DAS TURNIER!' : '👑 ' + d.name + ' gewinnt das Turnier.';
        $('raceAgainBtn').style.display = d.host ? 'block' : 'none';
      }
    }
  };
  registerGame({ key: 'racer', controller: RACEc });
})();
