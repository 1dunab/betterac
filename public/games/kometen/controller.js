// ============ Controller-Modul: KOMETEN-KLATSCHE ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #kkSwipe { flex:1; margin:12px; border-radius:20px; position:relative; overflow:hidden; touch-action:none;
             background:radial-gradient(circle at 50% 60%, #12081e, #05030c); border:3px solid #333; }
  #kkSwipe.hot { border-color:var(--kk-col, #fff); box-shadow:0 0 24px var(--kk-col, #fff) inset; }
  #kkSwipe.flash { background:#fff; }
  #kkSwipe.lock { border-color:#552; opacity:.6; }
  #kkHint { position:absolute; left:0; right:0; top:44%; text-align:center; font-size:26px; font-weight:800;
            color:rgba(255,255,255,.5); pointer-events:none; }
  #kkTrail { position:absolute; pointer-events:none; width:22px; height:22px; border-radius:50%;
             background:radial-gradient(circle, #fff, transparent 70%); display:none; transform:translate(-50%,-50%); }
</style>
<!-- KOMETEN-KLATSCHE -->
<div id="v-kk" class="view">
  <div class="bar"><span class="word" id="kkTeam">☄️ Kometen-Klatsche</span><span id="kkScore" class="timer"></span></div>
  <div id="kkSwipe">
    <div id="kkHint">WISCH! 👋</div>
    <div id="kkTrail"></div>
  </div>
  <div id="kkStatus" class="muted" style="text-align:center; padding:0 16px 12px">Wenn dein Feld glüht: wischen! Richtung + Schwung zählen.</div>
  <button id="kkAgainBtn" class="btn go" style="display:none; margin:0 14px 14px; font-size:18px">🔁 Nochmal</button>
</div>`);
  VIEWS.push('kk');

  const pad = $('kkSwipe'), trail = $('kkTrail');
  let swipe = null, locked = false;

  function beginSwipe(x, y) {
    if (locked) return;
    swipe = { x0: x, y0: y, t0: performance.now() };
    trail.style.display = 'block';
    moveSwipe(x, y);
  }
  function moveSwipe(x, y) {
    if (!swipe) return;
    const r = pad.getBoundingClientRect();
    trail.style.left = (x - r.left) + 'px';
    trail.style.top = (y - r.top) + 'px';
  }
  function endSwipe(x, y) {
    trail.style.display = 'none';
    if (!swipe) return;
    const dx = x - swipe.x0, dy = y - swipe.y0;
    const dt = Math.max(30, performance.now() - swipe.t0);
    swipe = null;
    const dist = Math.hypot(dx, dy);
    if (dist < 24) return;                       // Tap, kein Wisch
    const r = pad.getBoundingClientRect();
    // Richtung + Tempo (px/ms), normalisiert auf Pad-Größe — fair über Handygrößen
    const norm = Math.min(r.width, r.height);
    ac.message(AirConsole.SCREEN, {
      t: 'kkSwipe',
      dx: dx / dist, dy: dy / dist,
      power: Math.min(3, (dist / dt) * (300 / norm))
    });
  }
  pad.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.touches[0]; beginSwipe(t.clientX, t.clientY); });
  pad.addEventListener('touchmove', (e) => { e.preventDefault(); const t = e.touches[0]; moveSwipe(t.clientX, t.clientY); });
  pad.addEventListener('touchend', (e) => { e.preventDefault(); const t = e.changedTouches[0]; endSwipe(t.clientX, t.clientY); });
  pad.addEventListener('touchcancel', () => { swipe = null; trail.style.display = 'none'; });
  pad.addEventListener('mousedown', (e) => { e.preventDefault(); beginSwipe(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (swipe) moveSwipe(e.clientX, e.clientY); });
  window.addEventListener('mouseup', (e) => { if (swipe) endSwipe(e.clientX, e.clientY); });

  $('kkAgainBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'kkAgain' }));

  function setHot(on) {
    pad.classList.toggle('hot', on);
    $('kkHint').textContent = on ? 'WISCH! 👋' : '…';
    $('kkHint').style.color = on ? 'var(--kk-col, #fff)' : 'rgba(255,255,255,.35)';
  }

  const KKc = {
    activate() {
      swipe = null; locked = false;
      setHot(false);
      $('kkScore').textContent = '';
      $('kkAgainBtn').style.display = 'none';
      $('kkStatus').textContent = 'Wenn dein Feld glüht: wischen! Richtung + Schwung zählen.';
      showView('kk');
    },
    onMessage(d) {
      if (d.t === 'kkTeam') {
        pad.style.setProperty('--kk-col', d.color);
        $('kkTeam').textContent = d.team === 0 ? '🔴 Team Rot' : '🔵 Team Blau';
      } else if (d.t === 'kkTurn') {
        setHot(!!d.hot);
        if (d.hot) { try { navigator.vibrate && navigator.vibrate(60); } catch (e) {} }
      } else if (d.t === 'kkFx') {
        if (d.smash) {
          pad.classList.add('flash');
          setTimeout(() => pad.classList.remove('flash'), 120);
          try { navigator.vibrate && navigator.vibrate([40, 30, 80]); } catch (e) {}
        }
        if (d.lock !== undefined) {
          locked = !!d.lock;
          pad.classList.toggle('lock', locked);
          if (locked) setTimeout(() => { locked = false; pad.classList.remove('lock'); }, 550);
        }
      } else if (d.t === 'kkScore') {
        $('kkScore').textContent = d.a + ' : ' + d.b;
        if (d.msg) $('kkStatus').textContent = d.msg;
      } else if (d.t === 'kkEnd') {
        setHot(false);
        $('kkStatus').textContent = d.win ? '🏆 EUER TEAM GEWINNT!' : '💥 ' + d.name + ' gewinnt.';
        $('kkAgainBtn').style.display = d.host ? 'block' : 'none';
      }
    }
  };
  registerGame({ key: 'kometen', controller: KKc });
})();
