// ============ Controller-Modul: HEXENSCHICHT ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #hxItems { display:flex; gap:8px; padding:8px 12px; }
  #hxItems .chip { flex:1; border:none; border-radius:14px; background:#2a2a38; color:#fff;
                   font-size:26px; padding:10px 4px 6px; position:relative; }
  #hxItems .chip .st { display:block; font-size:11px; font-weight:700; opacity:.8; }
  #hxItems .chip.sel { background:#4a3a5e; outline:2px solid #bf5af2; }
  #hxItems .chip:disabled { opacity:.25; }
  #hxMain { flex:1; margin:6px 12px 10px; border-radius:18px; background:rgba(0,0,0,.3);
            position:relative; overflow:hidden; touch-action:none; min-height:0;
            display:flex; flex-direction:column; }
  #hxTargets { display:flex; gap:6px; padding:8px; }
  #hxTargets button { flex:1; border:none; border-radius:12px; color:#fff; font-weight:800;
                      font-size:13px; padding:10px 2px; background:#3a3a48; }
  #hxGesture { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
               gap:10px; text-align:center; position:relative; }
  #hxBig { font-size:44px; }
  #hxLabel { font-size:17px; font-weight:800; padding:0 12px; }
  #hxSub { font-size:13px; opacity:.7; padding:0 14px; }
  #hxBurnBar { width:78%; height:16px; border-radius:8px; background:rgba(255,255,255,.12);
               overflow:hidden; display:none; position:relative; }
  #hxBurnFill { height:100%; width:0%; background:#ff9f43; }
  #hxBurnZone { position:absolute; top:0; height:100%; left:70%; width:25%;
                background:rgba(80,220,120,.4); }
  #hxStir { display:none; width:150px; height:150px; border-radius:50%;
            border:4px dashed rgba(255,255,255,.4); align-items:center; justify-content:center; font-size:40px; }
</style>
<!-- HEXENSCHICHT -->
<div id="v-hx" class="view">
  <div class="bar"><span class="word" id="hxTool">🧪 Hexenschicht</span><span id="hxScore" class="timer"></span></div>
  <div id="hxItems"></div>
  <div id="hxMain">
    <div id="hxTargets"></div>
    <div id="hxGesture">
      <div id="hxBig">🧪</div>
      <div id="hxLabel">Warte auf Zutaten…</div>
      <div id="hxSub"></div>
      <div id="hxBurnBar"><div id="hxBurnFill"></div><div id="hxBurnZone"></div></div>
      <div id="hxStir">🌀</div>
    </div>
  </div>
  <div id="hxStatus" class="muted" style="text-align:center; padding:0 16px 10px">Zutat antippen → verarbeiten oder werfen!</div>
  <button id="hxAgainBtn" class="btn go" style="display:none; margin:0 14px 12px; font-size:18px">🔁 Nochmal</button>
</div>`);
  VIEWS.push('hx');

  const ICONS = { auge: '👁️', pilz: '🍄', kraut: '🌿', knochen: '🦴', kaefer: '🪲', kristall: '💎' };
  const TOOL_META = {
    hacken: { icon: '🔪', name: 'Hackbrett' },
    moersern: { icon: '🥣', name: 'Mörser' },
    brennen: { icon: '🔥', name: 'Brenner' },
    kessel: { icon: '🍲', name: 'Kessel' }
  };
  const STEP_ICON = (s) => TOOL_META[s] ? TOOL_META[s].icon : '🍲';

  let myTool = null, targets = [], items = [], selUid = null, kesselReady = false;
  let chopCount = 0, grindAngle = 0, lastAng = null, burn = null, stirAngle = 0, stirLast = null;

  const selItem = () => items.find(i => i.uid === selUid) || null;

  function renderItems() {
    const wrap = $('hxItems'); wrap.innerHTML = '';
    if (myTool === 'kessel') return;
    for (let k = 0; k < 3; k++) {
      const it = items[k];
      const b = document.createElement('button');
      b.className = 'chip' + (it && it.uid === selUid ? ' sel' : '');
      if (it) {
        b.innerHTML = ICONS[it.type] + '<span class="st">' + it.steps.map((s, i) => i < it.done ? '✓' : STEP_ICON(s)).join(' ') + '</span>';
        b.addEventListener('click', () => { selUid = it.uid; resetGesture(); renderAll(); });
      } else { b.innerHTML = '·'; b.disabled = true; }
      wrap.appendChild(b);
    }
  }

  function renderTargets() {
    const wrap = $('hxTargets'); wrap.innerHTML = '';
    const it = selItem();
    const throwing = myTool !== 'kessel' && it && it.next !== myTool;
    wrap.style.display = throwing ? 'flex' : 'none';
    if (!throwing) return;
    targets.forEach(tg => {
      const b = document.createElement('button');
      b.style.background = tg.color;
      const hint = it.next === 'fertig' ? (tg.tool === 'kessel' ? ' ⭐' : '') : (tg.tool === it.next ? ' ⭐' : '');
      b.innerHTML = TOOL_META[tg.tool].icon + '<br>' + tg.name + hint;
      b.addEventListener('click', () => throwTo(tg.id));
      wrap.appendChild(b);
    });
  }

  function throwTo(to) {
    const it = selItem();
    if (!it) return;
    ac.message(AirConsole.SCREEN, { t: 'hxThrow', uid: it.uid, to });
    selUid = null; resetGesture();
  }

  function resetGesture() {
    chopCount = 0; grindAngle = 0; lastAng = null; burn = null;
    $('hxBurnBar').style.display = 'none';
    $('hxBurnFill').style.width = '0%';
  }

  function renderGesture() {
    const big = $('hxBig'), label = $('hxLabel'), sub = $('hxSub');
    $('hxStir').style.display = 'none';
    $('hxBurnBar').style.display = 'none';
    if (myTool === 'kessel') {
      big.textContent = '🍲';
      if (kesselReady) {
        label.textContent = '🌀 UMRÜHREN!';
        sub.textContent = 'Kreise mit dem Finger über den Kessel!';
        $('hxStir').style.display = 'flex';
      } else {
        label.textContent = 'Der Kessel wartet…';
        sub.textContent = 'Sag den anderen, was das Rezept braucht — sie werfen dir fertige Zutaten zu.';
      }
      return;
    }
    const it = selItem();
    if (!it) {
      big.textContent = TOOL_META[myTool] ? TOOL_META[myTool].icon : '🧪';
      label.textContent = items.length ? 'Zutat oben antippen!' : 'Warte auf Zutaten…';
      sub.textContent = 'Dein Werkzeug: ' + (TOOL_META[myTool] ? TOOL_META[myTool].name : '');
      return;
    }
    big.textContent = ICONS[it.type];
    if (it.next === myTool) {
      if (myTool === 'hacken') { label.textContent = '🔪 HACKEN: wische ' + (3 - chopCount) + '×!'; sub.textContent = 'Schnelle Schnitte quer über die Fläche.'; }
      else if (myTool === 'moersern') { label.textContent = '🥣 MÖRSERN: kreisen!'; sub.textContent = Math.min(100, Math.round(grindAngle / (4 * Math.PI) * 100)) + '% zerrieben'; }
      else if (myTool === 'brennen') {
        label.textContent = '🔥 RÖSTEN: halten…';
        sub.textContent = 'Im grünen Bereich loslassen — nicht verbrennen!';
        $('hxBurnBar').style.display = 'block';
      }
    } else if (it.next === 'fertig') {
      label.textContent = '✅ Fertig — ab zum Kessel!';
      sub.textContent = 'Wirf sie dem Kessel-Spieler zu (oben ⭐).';
    } else {
      label.textContent = '➡️ Braucht: ' + STEP_ICON(it.next);
      sub.textContent = 'Wirf die Zutat zum richtigen Werkzeug (oben ⭐).';
    }
  }

  function renderAll() { renderItems(); renderTargets(); renderGesture(); }

  // ---------- Gesten ----------
  const area = $('hxGesture');
  let touch = null;
  function angAt(x, y, r) { return Math.atan2(y - (r.top + r.height / 2), x - (r.left + r.width / 2)); }
  function gestureStart(x, y) {
    const it = selItem();
    if (myTool === 'kessel') {
      if (!kesselReady) return;
      stirLast = angAt(x, y, area.getBoundingClientRect());
      return;
    }
    if (!it || it.next !== myTool) return;
    if (myTool === 'hacken') touch = { x0: x, y0: y };
    else if (myTool === 'moersern') lastAng = angAt(x, y, area.getBoundingClientRect());
    else if (myTool === 'brennen' && !burn) {
      burn = { t0: performance.now() };
      $('hxBurnBar').style.display = 'block';
      const tick = () => {
        if (!burn) return;
        const q = Math.min(100, (performance.now() - burn.t0) / 22);
        $('hxBurnFill').style.width = q + '%';
        $('hxBurnFill').style.background = q > 95 ? '#ff453a' : q > 70 ? '#50dc78' : '#ff9f43';
        if (q >= 100) { finishBurn(100); return; }
        requestAnimationFrame(tick);
      };
      tick();
    }
  }
  function gestureMove(x, y) {
    const r = area.getBoundingClientRect();
    if (myTool === 'kessel' && stirLast !== null) {
      const a = angAt(x, y, r);
      let d = a - stirLast; stirLast = a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      stirAngle += Math.abs(d);
      if (stirAngle > 3.5 * Math.PI) { stirAngle = 0; ac.message(AirConsole.SCREEN, { t: 'hxStir' }); }
      return;
    }
    const it = selItem();
    if (!it || it.next !== myTool) return;
    if (myTool === 'hacken' && touch) {
      if (Math.hypot(x - touch.x0, y - touch.y0) > 70) {
        touch = null;
        chopCount++;
        try { navigator.vibrate && navigator.vibrate(25); } catch (e) {}
        if (chopCount >= 3) { ac.message(AirConsole.SCREEN, { t: 'hxDone', uid: it.uid }); chopCount = 0; }
        renderGesture();
      }
    } else if (myTool === 'moersern' && lastAng !== null) {
      const a = angAt(x, y, r);
      let d = a - lastAng; lastAng = a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      grindAngle += Math.abs(d);
      if (grindAngle >= 4 * Math.PI) { ac.message(AirConsole.SCREEN, { t: 'hxDone', uid: it.uid }); grindAngle = 0; }
      renderGesture();
    }
  }
  function finishBurn(qOverride) {
    const it = selItem();
    if (!burn) return;
    const q = qOverride !== undefined ? qOverride : Math.min(100, (performance.now() - burn.t0) / 22);
    burn = null;
    $('hxBurnFill').style.width = '0%';
    if (!it || it.next !== myTool) return;
    if (q >= 70) {
      ac.message(AirConsole.SCREEN, { t: 'hxDone', uid: it.uid, q });
      try { navigator.vibrate && navigator.vibrate(q > 95 ? [80, 40, 80] : 40); } catch (e) {}
    }
    renderGesture();
  }
  function gestureEnd() {
    touch = null; lastAng = null; stirLast = null;
    if (burn) finishBurn();
  }
  area.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.touches[0]; gestureStart(t.clientX, t.clientY); });
  area.addEventListener('touchmove', (e) => { e.preventDefault(); const t = e.touches[0]; gestureMove(t.clientX, t.clientY); });
  area.addEventListener('touchend', (e) => { e.preventDefault(); gestureEnd(); });
  area.addEventListener('touchcancel', gestureEnd);
  let mdown = false;
  area.addEventListener('mousedown', (e) => { e.preventDefault(); mdown = true; gestureStart(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (mdown) gestureMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { if (mdown) { mdown = false; gestureEnd(); } });

  $('hxAgainBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'hxAgain' }));

  const HXc = {
    activate() {
      myTool = null; targets = []; items = []; selUid = null; kesselReady = false;
      resetGesture();
      $('hxScore').textContent = '';
      $('hxAgainBtn').style.display = 'none';
      $('hxStatus').textContent = 'Zutat antippen → verarbeiten oder werfen!';
      renderAll();
      showView('hx');
    },
    onMessage(d) {
      if (d.t === 'hxSetup') {
        myTool = d.tool; targets = d.targets || [];
        $('hxTool').textContent = TOOL_META[myTool].icon + ' ' + TOOL_META[myTool].name;
        if (d.msg) $('hxStatus').textContent = d.msg;
        selUid = null; resetGesture(); renderAll();
        try { navigator.vibrate && navigator.vibrate(50); } catch (e) {}
      } else if (d.t === 'hxInv') {
        const had = items.length;
        items = d.items || [];
        if (!items.find(i => i.uid === selUid)) selUid = items.length ? items[0].uid : null;
        if (items.length > had) { try { navigator.vibrate && navigator.vibrate(45); } catch (e) {} }
        renderAll();
      } else if (d.t === 'hxKessel') {
        kesselReady = !!d.ready;
        if (kesselReady) { try { navigator.vibrate && navigator.vibrate([50, 40, 50]); } catch (e) {} }
        renderGesture();
      } else if (d.t === 'hxScore') {
        $('hxScore').textContent = d.score + 'P';
        if (d.msg) $('hxStatus').textContent = d.msg;
      } else if (d.t === 'hxEnd') {
        $('hxStatus').textContent = '🧪 Schichtende! ' + d.score + ' Punkte — ' + d.potions + ' Tränke.';
        $('hxAgainBtn').style.display = d.host ? 'block' : 'none';
      }
    }
  };
  registerGame({ key: 'hexenschicht', controller: HXc });
})();
