// ============ Controller-Modul: HIMMELSZÜNDER ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #hzForms { display:flex; gap:8px; padding:8px 12px; }
  #hzForms button { flex:1; border:none; border-radius:12px; background:#2a2a38; color:#fff;
                    font-size:15px; font-weight:800; padding:10px 4px; }
  #hzForms button.sel { background:#4a3a5e; outline:2px solid #bf5af2; }
  #hzPad { flex:1; margin:6px 12px; border-radius:20px; position:relative; overflow:hidden; touch-action:none;
           background:linear-gradient(180deg, #050312, #12081e 60%, #241436); border:3px solid #333;
           display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; }
  #hzPad.flying { border-color:#ffd60a; }
  #hzMain { font-size:30px; font-weight:800; text-align:center; pointer-events:none; }
  #hzSub { font-size:14px; opacity:.7; text-align:center; padding:0 14px; pointer-events:none; }
  #hzCharge { width:70%; height:16px; border-radius:8px; background:rgba(255,255,255,.12);
              overflow:hidden; display:none; pointer-events:none; }
  #hzChargeFill { height:100%; width:0%; background:#ffd60a; }
  #hzAmmo { height:6px; border-radius:3px; background:rgba(255,255,255,.15); margin:6px 14px 4px; overflow:hidden; }
  #hzAmmoFill { height:100%; width:100%; background:#7dffb1; border-radius:3px; }
</style>
<!-- HIMMELSZÜNDER -->
<div id="v-hz" class="view">
  <div class="bar"><span class="word">🎆 Himmelszünder</span><span id="hzPoints" class="timer">0</span></div>
  <div id="hzForms">
    <button data-form="peony" class="sel">🌸 Pfingstrose</button>
    <button data-form="willow">🌿 Weide</button>
    <button data-form="ring">⭕ Ring</button>
  </div>
  <div id="hzPad">
    <div id="hzMain">👆 Halten = laden</div>
    <div id="hzSub">Dann nach oben wischen — im Flug tippen zum ZÜNDEN!</div>
    <div id="hzCharge"><div id="hzChargeFill"></div></div>
  </div>
  <div id="hzAmmo"><div id="hzAmmoFill"></div></div>
  <div id="hzStatus" class="muted" style="text-align:center; padding:0 16px 10px">Triff die Beat-Ringe — synchron mit den anderen!</div>
  <button id="hzAgainBtn" class="btn go" style="display:none; margin:0 14px 12px; font-size:18px">🔁 Nochmal</button>
</div>`);
  VIEWS.push('hz');

  const pad = $('hzPad');
  let form = 'peony', flying = false, ammo = 100;
  let hold = null, charge = 0, chargeRAF = null;

  document.querySelectorAll('#hzForms button').forEach(b => b.addEventListener('click', () => {
    form = b.getAttribute('data-form');
    document.querySelectorAll('#hzForms button').forEach(o => o.classList.toggle('sel', o === b));
  }));

  function setFlying(on) {
    flying = on;
    pad.classList.toggle('flying', on);
    $('hzMain').textContent = on ? '💥 TIPP ZUM ZÜNDEN!' : '👆 Halten = laden';
    $('hzSub').textContent = on ? 'Genau im Ring, genau im Beat!' : 'Dann nach oben wischen — im Flug tippen zum ZÜNDEN!';
  }

  function startHold(x, y) {
    if (flying) { ac.message(AirConsole.SCREEN, { t: 'hzDet' }); return; }
    hold = { x0: x, y0: y, t0: performance.now(), fired: false };
    charge = 0;
    $('hzCharge').style.display = 'block';
    const tick = () => {
      if (!hold || hold.fired) { $('hzCharge').style.display = 'none'; return; }
      charge = Math.min(100, (performance.now() - hold.t0) / 12);
      $('hzChargeFill').style.width = charge + '%';
      $('hzChargeFill').style.background = charge > 66 ? '#ff5f2e' : charge > 33 ? '#ff9f43' : '#ffd60a';
      if (charge > 33 && Math.floor(charge) % 33 === 0) { try { navigator.vibrate && navigator.vibrate(15); } catch (e) {} }
      chargeRAF = requestAnimationFrame(tick);
    };
    tick();
  }
  function endHold(x, y) {
    if (!hold || hold.fired) { hold = null; return; }
    const h = hold; hold = null;
    if (chargeRAF) cancelAnimationFrame(chargeRAF);
    $('hzCharge').style.display = 'none';
    const dx = x - h.x0, dy = y - h.y0;
    const dist = Math.hypot(dx, dy);
    if (dist < 30 || dy > -20) return;                   // kein Wisch nach oben
    const r = pad.getBoundingClientRect();
    const norm = Math.min(r.width, r.height);
    const dt = Math.max(40, performance.now() - h.t0);   // Gesamthaltezeit egal, Kraft aus Wischtempo
    const kaliber = charge > 66 ? 3 : charge > 33 ? 2 : 1;
    ac.message(AirConsole.SCREEN, {
      t: 'hzLaunch',
      ang: Math.atan2(dy, dx),
      power: Math.min(3, (dist / Math.max(60, performance.now() - h.t0 - 0)) * (340 / norm) + dist / norm),
      kaliber, form
    });
    try { navigator.vibrate && navigator.vibrate(30); } catch (e) {}
  }
  pad.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.touches[0]; startHold(t.clientX, t.clientY); });
  pad.addEventListener('touchend', (e) => { e.preventDefault(); const t = e.changedTouches[0]; endHold(t.clientX, t.clientY); });
  pad.addEventListener('touchcancel', () => { hold = null; $('hzCharge').style.display = 'none'; });
  pad.addEventListener('mousedown', (e) => { e.preventDefault(); startHold(e.clientX, e.clientY); });
  window.addEventListener('mouseup', (e) => { if (hold) endHold(e.clientX, e.clientY); });

  $('hzAgainBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'hzAgain' }));

  const HZc = {
    activate() {
      form = 'peony'; flying = false; hold = null;
      setFlying(false);
      $('hzPoints').textContent = '0';
      $('hzAmmoFill').style.width = '100%';
      $('hzAgainBtn').style.display = 'none';
      $('hzStatus').textContent = 'Triff die Beat-Ringe — synchron mit den anderen!';
      showView('hz');
    },
    onMessage(d) {
      if (d.t === 'hzYou') {
        if (d.ammo !== undefined) { ammo = d.ammo; $('hzAmmoFill').style.width = Math.round(ammo) + '%'; }
        if (d.points !== undefined) $('hzPoints').textContent = d.points;
        if (d.flying !== undefined) setFlying(!!d.flying);
        if (d.sync) { try { navigator.vibrate && navigator.vibrate([50, 40, 50, 40, 90]); } catch (e) {} }
        if (d.msg) $('hzStatus').textContent = d.msg;
      } else if (d.t === 'hzState') {
        $('hzAgainBtn').style.display = 'none';
        if (d.msg) $('hzStatus').textContent = d.msg;
      } else if (d.t === 'hzEnd') {
        setFlying(false);
        $('hzStatus').textContent = (d.win ? '👑 DU bist Pyro-Champion! ' : '👑 ' + d.name + ' gewinnt. ') + 'Show-Note: ' + d.grade;
        $('hzAgainBtn').style.display = d.host ? 'block' : 'none';
      }
    }
  };
  registerGame({ key: 'himmelszuender', controller: HZc });
})();
