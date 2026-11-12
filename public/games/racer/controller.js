// ============ Controller-Modul: MICRO RACER ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
// Lenken: links / rechts halten. Beide zugleich = Bremse. Dazu Nitro und (wenn an) ein Item-Knopf.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #racePad { flex:1; display:grid; gap:12px; padding:16px; min-height:0;
             grid-template-columns:1fr 1fr; grid-template-rows:0.7fr 2fr; }
  #racePad button { border:none; border-radius:20px; background:rgba(0,0,0,.30); color:#fff; font-weight:800; }
  #racePad button:active, #racePad button.on { background:rgba(255,255,255,.30); }
  #racePad #race-nitro { font-size:24px; background:linear-gradient(180deg, rgba(255,120,40,.55), rgba(0,0,0,.30)); }
  #racePad #race-nitro.cooldown { opacity:.35; }
  #racePad #race-item { font-size:24px; background:linear-gradient(180deg, rgba(90,160,255,.55), rgba(0,0,0,.30)); }
  #racePad #race-item.empty { opacity:.35; }
  #racePad.noitems #race-item { display:none; }
  #racePad.noitems #race-nitro { grid-column:1/span 2; }
  #race-left, #race-right { font-size:52px; }
  #racePad.brake #race-left, #racePad.brake #race-right { background:rgba(255,59,48,.75); }
  #racePad.out { opacity:.4; }
  #v-race.danger { animation:raceDanger .35s infinite alternate; }
  @keyframes raceDanger { from { box-shadow:inset 0 0 0 0 rgba(255,59,48,0); } to { box-shadow:inset 0 0 0 14px rgba(255,59,48,.9); } }
</style>
<!-- MICRO RACER -->
<div id="v-race" class="view">
  <div class="bar"><span class="word">🏎️ Micro Racer</span><span id="raceRank" class="timer"></span></div>
  <div id="racePad">
    <button id="race-nitro">🔥 NITRO</button>
    <button id="race-item" class="empty">🎁 Item</button>
    <button id="race-left">↺</button>
    <button id="race-right">↻</button>
  </div>
  <div id="raceStatus" class="muted" style="text-align:center; padding:0 16px 14px"></div>
  <button id="raceAgainBtn" class="btn go" style="display:none; margin:0 16px 14px; font-size:18px">🔁 Nochmal</button>
</div>`);
  VIEWS.push('race');

  const HINT = 'Gas gibt\'s automatisch. Beide Pfeile zugleich = Bremse 🛑';
  const ITEMS = { rocket: '🚀 Rakete', oil: '🛢️ Öl', shield: '🛡️ Schild', bolt: '⚡ Blitz', magnet: '🧲 Magnet' };
  const vib = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
  const toScreen = (m) => ac.message(AirConsole.SCREEN, m);

  // ---------- lenken + bremsen ----------
  const steer = { left: false, right: false };
  let braking = false;
  function sendSteer() {
    const b = steer.left && steer.right;
    if (b && !braking) vib(20);
    braking = b;
    $('racePad').classList.toggle('brake', b);
    $('race-left').textContent = b ? '🛑' : '↺';
    $('race-right').textContent = b ? '🛑' : '↻';
    toScreen({ t: 'raceSteer', s: b ? 0 : (steer.right ? 1 : 0) - (steer.left ? 1 : 0), b });
  }
  function hold(key, down) {
    if (steer[key] === down) return;
    steer[key] = down;
    $('race-' + key).classList.toggle('on', down);
    sendSteer();
  }
  function bindHold(key) {
    const el = $('race-' + key);
    const on = (e) => { e.preventDefault(); hold(key, true); };
    const off = (e) => { e.preventDefault(); hold(key, false); };
    el.addEventListener('touchstart', on); el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
    el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
  }
  bindHold('left'); bindHold('right');
  // Finger weg, auch wenn das touchend verloren ging (App-Wechsel, neuer Heat)
  function release() { hold('left', false); hold('right', false); }
  window.addEventListener('blur', () => { if ($('v-race').classList.contains('on')) release(); });

  // ---------- Nitro + Item ----------
  let nitroReady = true, item = null;
  function tap(id, fn) {
    const h = (e) => { e.preventDefault(); fn(); };
    $(id).addEventListener('touchstart', h); $(id).addEventListener('mousedown', h);
  }
  const fireNitro = () => { if (nitroReady) toScreen({ t: 'raceNitro' }); };
  const fireItem = () => { if (item) toScreen({ t: 'raceItem' }); };
  tap('race-nitro', fireNitro); tap('race-item', fireItem);

  function setNitro(ready) {
    nitroReady = ready;
    $('race-nitro').classList.toggle('cooldown', !ready);
    $('race-nitro').textContent = ready ? '🔥 NITRO' : '⏳ NITRO';
  }
  function setItem(kind) {
    if (kind && kind !== item) vib(30);
    item = kind || null;
    $('race-item').classList.toggle('empty', !item);
    $('race-item').textContent = item ? (ITEMS[item] || '🎁') : '🎁 Item';
  }

  // Tastatur zum Testen am Rechner: Pfeile lenken (beide = Bremse), Leertaste Nitro, ↑ Item
  const racing = () => $('v-race').classList.contains('on');
  document.addEventListener('keydown', (e) => {
    if (!racing() || e.repeat) return;
    if (e.key === 'ArrowLeft') hold('left', true);
    else if (e.key === 'ArrowRight') hold('right', true);
    else if (e.key === ' ') fireNitro();
    else if (e.key === 'ArrowUp') fireItem();
    else return;
    e.preventDefault();
  });
  document.addEventListener('keyup', (e) => {
    if (!racing()) return;
    if (e.key === 'ArrowLeft') hold('left', false);
    else if (e.key === 'ArrowRight') hold('right', false);
  });

  $('raceAgainBtn').addEventListener('click', () => toScreen({ t: 'raceAgain' }));

  let out = false;
  function setOut(v) { out = v; $('racePad').classList.toggle('out', v); if (v) setDanger(false); }
  function setDanger(v) {
    if (v && !$('v-race').classList.contains('danger')) vib([60, 40, 60]);
    $('v-race').classList.toggle('danger', v);
  }
  const status = (t) => { $('raceStatus').textContent = t; };

  const RACEc = {
    activate() {
      steer.left = steer.right = braking = false;
      $('race-left').classList.remove('on'); $('race-right').classList.remove('on');
      $('racePad').classList.remove('brake');
      $('race-left').textContent = '↺'; $('race-right').textContent = '↻';
      setNitro(true); setItem(null); setOut(false); setDanger(false);
      $('raceRank').textContent = '';
      $('raceAgainBtn').style.display = 'none';
      status(HINT);
      showView('race');
    },
    onMessage(d) {
      if (d.t === 'raceState') {
        $('raceAgainBtn').style.display = 'none';
        $('racePad').classList.toggle('noitems', d.items === false);
        if (d.phase === 'countdown') { setNitro(true); setItem(null); setOut(false); setDanger(false); $('raceRank').textContent = ''; status('Heat ' + d.heat + ' — gleich geht\'s los… 🚦'); }
        else if (d.phase === 'race' && !out) status(HINT);
      } else if (d.t === 'raceYou') {
        if (d.nitro !== undefined) setNitro(!!d.nitro);
        if (d.item !== undefined) setItem(d.item);
        if (d.rank) $('raceRank').textContent = 'P' + d.rank + (d.of ? '/' + d.of : '');
        if (d.danger !== undefined && !out) { setDanger(!!d.danger); status(d.danger ? '⚠️ Du bist aus dem Bild — aufholen!' : HINT); }
        if (d.buzz) vib(80);
        if (d.out) {
          setOut(true); vib([120, 60, 200]);
          status(d.why === 'lava' ? '🔥 In die Lava gefahren — nächster Heat kommt bestimmt!' : '💥 Aus dem Bild gefallen — nächster Heat kommt bestimmt!');
        } else if (d.msg) status(d.msg);
      } else if (d.t === 'raceScore') {
        setDanger(false);
        status((d.won ? '🏆 Heat gewonnen! ' : '') + 'Punkte: ' + d.points + ' / ' + d.target);
      } else if (d.t === 'raceFinal') {
        setDanger(false);
        status(d.winner ? '👑 DU GEWINNST DAS TURNIER!' : '👑 ' + d.name + ' gewinnt das Turnier.');
        $('raceAgainBtn').style.display = d.host ? 'block' : 'none';
      }
    }
  };
  registerGame({ key: 'racer', controller: RACEc });
})();
