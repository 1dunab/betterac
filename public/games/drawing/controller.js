// ============ Controller-Modul: DRAWING ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<!-- DRAWING: PROMPT -->
<div id="v-d-prompt" class="view">
  <div class="bar"><span class="word">Denk dir ein Wort aus 💭</span></div>
  <div class="center">
    <div class="muted">Startet eine Kette und wandert durch alle.</div>
    <input id="promptInput" type="text" placeholder="z.B. Einhorn…" autocomplete="off">
    <button id="submitPrompt" class="btn go" style="width:100%; max-width:340px">Abschicken</button>
    <div class="muted">Weiter, sobald alle abgegeben haben.</div>
  </div>
</div>
<!-- DRAWING: ZEICHNEN -->
<div id="v-d-draw" class="view">
  <div class="bar"><span class="word">Zeichne: <span id="drawWord">…</span></span><span id="drawTimer" class="timer">–</span></div>
  <canvas id="pad" width="600" height="700"></canvas>
  <div class="tools">
    <span class="sw sel" data-col="#111111" style="background:#111"></span>
    <span class="sw" data-col="#ff2d55" style="background:#ff2d55"></span>
    <span class="sw" data-col="#0a84ff" style="background:#0a84ff"></span>
    <span class="sw" data-col="#30d158" style="background:#30d158"></span>
    <span class="sw" data-col="#ffd60a" style="background:#ffd60a"></span>
    <button id="eraser" class="btn">Radierer</button>
    <button id="undo" class="btn">↶</button>
    <button id="clear" class="btn">Leeren</button>
    <button id="submitDraw" class="btn go">Fertig</button>
  </div>
</div>
<!-- DRAWING: RATEN -->
<div id="v-d-guess" class="view">
  <div class="bar"><span class="word">Was ist das?</span><span id="guessTimer" class="timer">–</span></div>
  <canvas id="guessCanvas" width="600" height="520"></canvas>
  <div class="tools" style="flex-direction:column; align-items:stretch">
    <input id="guessInput" type="text" placeholder="Dein Tipp…" autocomplete="off" style="max-width:none">
    <button id="submitGuess" class="btn go" style="margin-top:8px">Abschicken</button>
  </div>
</div>
<!-- DRAWING: WAIT / PRERECAP / RECAP -->
<div id="v-d-wait" class="view"><div class="center"><div class="big">Eingereicht ✓</div><div class="muted">Warte auf die anderen…</div></div></div>
<div id="v-d-prerecap" class="view"><div class="center"><div class="big">✅ Alle Runden geschafft!</div>
  <div id="recapHostBox" style="display:none; width:100%; max-width:340px;"><button id="startRecapBtn" class="btn go" style="width:100%; font-size:20px">🎬 Recap starten</button></div>
  <div id="recapGuestBox" class="muted" style="display:none">Warte auf den Host, der den Rückblick startet…</div>
</div></div>
<div id="v-d-recap" class="view"><div class="center"><div class="big">🎬 Schaut auf den großen Bildschirm!</div>
  <button id="advanceBtn" class="btn" style="font-size:20px">Weiter ▶</button>
  <button id="saveEvoBtn" class="btn" style="font-size:18px; display:none">💾 Evolution speichern</button>
</div></div>`);
  VIEWS.push('d-prompt', 'd-draw', 'd-guess', 'd-wait', 'd-prerecap', 'd-recap');

  const pad = $('pad'), pctx = pad.getContext('2d');
  let strokes = [], cur = null, drawing = false, color = '#111111', sizeFrac = 0.012, erasing = false, submitted = false;
  const clampN = (v) => Math.max(0, Math.min(1, v)), r3 = (v) => Math.round(v * 1000) / 1000;
  function clearPad() { pctx.fillStyle = '#fff'; pctx.fillRect(0, 0, pad.width, pad.height); }
  function redraw() {
    clearPad(); pctx.lineCap = 'round'; pctx.lineJoin = 'round';
    for (const s of strokes) { if (!s.p.length) continue; pctx.strokeStyle = s.c; pctx.lineWidth = Math.max(1, s.w * pad.width); pctx.beginPath(); pctx.moveTo(s.p[0][0] * pad.width, s.p[0][1] * pad.height); for (let i = 1; i < s.p.length; i++) pctx.lineTo(s.p[i][0] * pad.width, s.p[i][1] * pad.height); if (s.p.length === 1) pctx.lineTo(s.p[0][0] * pad.width + 0.5, s.p[0][1] * pad.height); pctx.stroke(); }
  }
  function padPos(e) { const r = pad.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; return [clampN((t.clientX - r.left) / r.width), clampN((t.clientY - r.top) / r.height)]; }
  function sStart(e) { e.preventDefault(); drawing = true; cur = { c: erasing ? '#ffffff' : color, w: erasing ? 0.06 : sizeFrac, p: [padPos(e).map(r3)] }; strokes.push(cur); redraw(); }
  function sMove(e) { if (!drawing || !cur) return; e.preventDefault(); cur.p.push(padPos(e).map(r3)); redraw(); }
  function sEnd(e) { if (e) e.preventDefault(); drawing = false; cur = null; }
  pad.addEventListener('touchstart', sStart); pad.addEventListener('touchmove', sMove); pad.addEventListener('touchend', sEnd); pad.addEventListener('touchcancel', sEnd);
  pad.addEventListener('mousedown', sStart); pad.addEventListener('mousemove', sMove); window.addEventListener('mouseup', sEnd);
  document.querySelectorAll('#v-d-draw .sw').forEach(sw => sw.addEventListener('click', () => { document.querySelectorAll('#v-d-draw .sw').forEach(o => o.classList.remove('sel')); sw.classList.add('sel'); color = sw.getAttribute('data-col'); erasing = false; $('eraser').style.outline = ''; }));
  $('eraser').addEventListener('click', () => { erasing = !erasing; $('eraser').style.outline = erasing ? '3px solid #fff' : ''; if (erasing) document.querySelectorAll('#v-d-draw .sw').forEach(o => o.classList.remove('sel')); });
  $('undo').addEventListener('click', () => { strokes.pop(); redraw(); });
  $('clear').addEventListener('click', () => { strokes = []; redraw(); });
  function submitDrawing() { if (submitted) return; submitted = true; stopTimer(); ac.message(AirConsole.SCREEN, { t: 'drawing', strokes }); showView('d-wait'); }
  $('submitDraw').addEventListener('click', submitDrawing);

  const gc = $('guessCanvas'), gctx = gc.getContext('2d');
  function renderGuess(strokesIn) {
    gctx.fillStyle = '#fff'; gctx.fillRect(0, 0, gc.width, gc.height); gctx.lineCap = 'round'; gctx.lineJoin = 'round';
    for (const s of (strokesIn || [])) { if (!s.p || !s.p.length) continue; gctx.strokeStyle = s.c; gctx.lineWidth = Math.max(1, s.w * gc.width); gctx.beginPath(); gctx.moveTo(s.p[0][0] * gc.width, s.p[0][1] * gc.height); for (let i = 1; i < s.p.length; i++) gctx.lineTo(s.p[i][0] * gc.width, s.p[i][1] * gc.height); if (s.p.length === 1) gctx.lineTo(s.p[0][0] * gc.width + 0.5, s.p[0][1] * gc.height); gctx.stroke(); }
  }
  function submitGuess() { if (submitted) return; submitted = true; stopTimer(); ac.message(AirConsole.SCREEN, { t: 'guess', text: $('guessInput').value }); showView('d-wait'); }
  $('submitGuess').addEventListener('click', submitGuess);
  $('guessInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGuess(); });
  function submitPrompt() { if (submitted) return; submitted = true; ac.message(AirConsole.SCREEN, { t: 'word', text: $('promptInput').value }); showView('d-wait'); }
  $('submitPrompt').addEventListener('click', submitPrompt);
  $('promptInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPrompt(); });
  $('startRecapBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'startRecap' }));
  $('advanceBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'advance' }));
  $('saveEvoBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'save' }));

  const Dc = {
    activate() { showView('d-wait'); },
    onMessage(d) {
      if (d.t === 'prompt') { submitted = false; $('promptInput').value = ''; showView('d-prompt'); setTimeout(() => $('promptInput').focus(), 50); }
      else if (d.t === 'draw') { submitted = false; strokes = []; redraw(); $('drawWord').textContent = d.word; showView('d-draw'); startTimer(d.ms, $('drawTimer'), submitDrawing); }
      else if (d.t === 'guess') { submitted = false; $('guessInput').value = ''; renderGuess(d.strokes); showView('d-guess'); startTimer(d.ms, $('guessTimer'), submitGuess); setTimeout(() => $('guessInput').focus(), 50); }
      else if (d.t === 'wait') { stopTimer(); showView('d-wait'); }
      else if (d.t === 'prerecap') { stopTimer(); myHost = d.host; updateAbort(); $('recapHostBox').style.display = d.host ? 'block' : 'none'; $('recapGuestBox').style.display = d.host ? 'none' : 'block'; showView('d-prerecap'); }
      else if (d.t === 'recap') { stopTimer(); myHost = d.host; updateAbort(); $('saveEvoBtn').style.display = d.host ? 'inline-block' : 'none'; showView('d-recap'); }
    }
  };
  clearPad();
  registerGame({ key: 'drawing', controller: Dc });
})();
