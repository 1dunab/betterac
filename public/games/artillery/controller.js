// ============ Controller-Modul: ARTILLERY HILLS =============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<!-- ARTILLERY HILLS -->
<div id="v-artillery" class="view">
  <div class="bar"><span class="word">💥 Artillery Hills</span><span id="artWind" class="timer">Wind: 0</span></div>
  <div class="center" style="justify-content:flex-start; padding-top:58px;">
    <div id="artStatus" class="big">Warte...</div>
    <div style="width:100%; max-width:360px; text-align:left;">
      <div class="bar" style="padding:10px 0"><span class="word">Waffe</span><span id="artTankInfo" class="timer">Tank</span></div>
      <select id="artWeapon" style="width:100%; font-size:18px; padding:12px; border:none; border-radius:12px; background:#fff; color:#111;"></select>
      <div class="bar" style="padding:10px 0"><span class="word">Winkel</span><span id="artAngleVal" class="timer">45°</span></div>
      <input id="artAngle" type="range" min="5" max="175" value="45" style="width:100%">
      <div class="step" style="margin-top:8px"><button data-art-angle="-5">−</button><span style="flex:1; text-align:center">Feinwinkel</span><button data-art-angle="5">+</button></div>
      <div class="bar" style="padding:20px 0 10px"><span class="word">Kraft</span><span id="artPowerVal" class="timer">58%</span></div>
      <input id="artPower" type="range" min="20" max="100" value="58" style="width:100%">
      <div class="step" style="margin-top:8px"><button data-art-power="-5">−</button><span style="flex:1; text-align:center">Feinkraft</span><button data-art-power="5">+</button></div>
      <div class="step" style="margin-top:16px"><button data-art-move="-1">←</button><span id="artMoveVal" style="flex:1; text-align:center">Bewegung: 0</span><button data-art-move="1">→</button></div>
    </div>
    <button id="artFire" class="btn go" style="width:100%; max-width:360px; margin-top:22px; font-size:22px">FEUER</button>
  </div>
</div>`);
  VIEWS.push('artillery');

  let artAngle = 45, artPower = 58, artWeapon = 'rocket', artActive = false, artClock = null, artEndAt = 0, artWindText = 'Wind: 0';
  const artAngleEl = $('artAngle'), artPowerEl = $('artPower'), artWeaponEl = $('artWeapon');

  function syncArtillery(send) {
    artAngle = parseInt(artAngleEl.value, 10);
    artPower = parseInt(artPowerEl.value, 10);
    $('artAngleVal').textContent = artAngle + '°';
    $('artPowerVal').textContent = artPower + '%';
    artWeapon = artWeaponEl.value || artWeapon;
    if (send && artActive) ac.message(AirConsole.SCREEN, { t: 'artilleryAim', angle: artAngle, power: artPower, weapon: artWeapon });
  }

  artAngleEl.addEventListener('input', () => syncArtillery(true));
  artPowerEl.addEventListener('input', () => syncArtillery(true));
  artWeaponEl.addEventListener('change', () => syncArtillery(true));
  document.querySelectorAll('button[data-art-angle]').forEach(b => b.addEventListener('click', () => {
    artAngleEl.value = Math.max(5, Math.min(175, artAngle + parseInt(b.getAttribute('data-art-angle'), 10)));
    syncArtillery(true);
  }));
  document.querySelectorAll('button[data-art-power]').forEach(b => b.addEventListener('click', () => {
    artPowerEl.value = Math.max(20, Math.min(100, artPower + parseInt(b.getAttribute('data-art-power'), 10)));
    syncArtillery(true);
  }));
  document.querySelectorAll('button[data-art-move]').forEach(b => b.addEventListener('click', () => {
    if (!artActive) return;
    ac.message(AirConsole.SCREEN, { t: 'artilleryMove', dir: parseInt(b.getAttribute('data-art-move'), 10) });
  }));
  $('artFire').addEventListener('click', () => {
    if (!artActive) return;
    artActive = false;
    $('artFire').disabled = true;
    $('artFire').style.opacity = 0.5;
    ac.message(AirConsole.SCREEN, { t: 'artilleryFire', angle: artAngle, power: artPower, weapon: artWeapon });
  });

  function setWeaponOptions(weapons, selected) {
    const opts = weapons || [{ key: 'rocket', label: 'Rakete' }];
    artWeaponEl.innerHTML = '';
    opts.forEach(w => {
      const o = document.createElement('option');
      o.value = w.key; o.textContent = w.label;
      artWeaponEl.appendChild(o);
    });
    artWeaponEl.value = selected || opts[0].key;
    artWeapon = artWeaponEl.value;
  }

  function stopArtClock() { if (artClock) { clearInterval(artClock); artClock = null; } }
  function startArtClock(ms, wind) {
    stopArtClock(); artEndAt = performance.now() + ms; artWindText = 'Wind: ' + wind;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((artEndAt - performance.now()) / 1000));
      $('artWind').textContent = artWindText + ' · ' + secs + 's';
    };
    tick(); artClock = setInterval(tick, 200);
  }

  const ARTc = {
    activate() { showView('artillery'); $('artStatus').textContent = 'Warte auf deinen Zug...'; stopArtClock(); },
    onMessage(d) {
      if (d.t === 'artilleryTurn') {
        artActive = !!d.active;
        artAngle = d.angle || artAngle; artPower = d.power || artPower;
        setWeaponOptions(d.weapons, d.weapon);
        artAngleEl.value = artAngle; artPowerEl.value = artPower; syncArtillery(false);
        startArtClock(d.ms || 30000, d.wind);
        $('artMoveVal').textContent = 'Bewegung: ' + (d.moveLeft || 0);
        $('artTankInfo').textContent = (d.tankType || 'Tank') + ' · ' + d.hp + '/' + d.maxHp;
        $('artFire').disabled = !artActive; $('artFire').style.opacity = artActive ? 1 : 0.45;
        $('artStatus').textContent = artActive ? 'Du bist dran: Winkel und Kraft einstellen.' : d.name + ' ist dran.';
        showView('artillery');
      } else if (d.t === 'artilleryMove') {
        $('artMoveVal').textContent = 'Bewegung: ' + (d.moveLeft || 0);
      } else if (d.t === 'artilleryWait') {
        stopArtClock(); $('artWind').textContent = artWindText;
        artActive = false; $('artFire').disabled = true; $('artFire').style.opacity = 0.45; $('artStatus').textContent = 'Schuss unterwegs...';
      } else if (d.t === 'artilleryDone') {
        stopArtClock();
        artActive = false; $('artFire').disabled = true; $('artFire').style.opacity = 0.45;
        $('artStatus').textContent = d.winner ? 'Du gewinnst!' : d.name + ' gewinnt.';
      }
    }
  };

  registerGame({ key: 'artillery', controller: ARTc });
})();
