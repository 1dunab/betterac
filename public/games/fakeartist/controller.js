// ============ Controller-Modul: FAKE ARTIST ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<!-- FAKE ARTIST: ROLLE ANSEHEN -->
<div id="v-fa-card" class="view">
  <div class="bar"><span class="word">🖌️ Fake Artist — <span id="faRoundLbl"></span></span></div>
  <div class="center">
    <div class="muted">Halte die Karte gedrückt, um deine Rolle zu sehen.<br>Niemandem zeigen! 🤫</div>
    <div id="faHold" style="width:100%; max-width:340px; min-height:180px; border-radius:16px;
         background:#2a2a38; display:flex; flex-direction:column; align-items:center; justify-content:center;
         gap:8px; padding:18px; box-sizing:border-box; font-weight:800; font-size:22px; text-align:center;">
      <span>👆 Gedrückt halten</span>
    </div>
    <button id="faSeenBtn" class="btn go" style="width:100%; max-width:340px">Alles klar ✓</button>
  </div>
</div>
<!-- FAKE ARTIST: ZEICHNEN (genau ein Strich) -->
<div id="v-fa-draw" class="view">
  <div class="bar"><span class="word">Du bist dran! 🖌️ <span id="faTurnLbl" class="muted"></span></span></div>
  <canvas id="faPad" width="600" height="620"></canvas>
  <div class="tools">
    <button id="faRetry" class="btn">↶ Nochmal</button>
    <button id="faSend" class="btn go">Abschicken ✓</button>
  </div>
  <div class="muted" style="text-align:center; padding:0 16px 14px">Genau EIN Strich — Finger absetzen beendet ihn.</div>
</div>
<!-- FAKE ARTIST: WARTEN / ERGEBNIS -->
<div id="v-fa-wait" class="view"><div class="center">
  <div id="faWaitTitle" class="big">👀 Schaut auf den Bildschirm</div>
  <div id="faWaitInfo" class="muted"></div>
  <button id="faNextBtn" class="btn go" style="display:none; font-size:18px">▶ Nächste Runde</button>
</div></div>
<!-- FAKE ARTIST: ABSTIMMEN -->
<div id="v-fa-vote" class="view"><div class="center">
  <div class="big">Wer ist der Fake? 🕵️</div>
  <div id="faVoteList" class="modes" style="flex-direction:column; width:100%; max-width:340px"></div>
</div></div>`);
  VIEWS.push('fa-card', 'fa-draw', 'fa-wait', 'fa-vote');

  let role = null; // { fake, word, hint }
  const hold = $('faHold');
  function renderCard(show) {
    if (!show || !role) { hold.innerHTML = '<span>👆 Gedrückt halten</span>'; hold.style.background = '#2a2a38'; return; }
    if (role.fake) {
      hold.style.background = '#5a1720';
      hold.innerHTML = '<span style="font-size:26px">🖌️ Du bist der FAKE ARTIST!</span>' +
        '<span class="muted" style="font-weight:600">Du kennst das Wort nicht.<br>Hinweis — Kategorie:</span>' +
        '<span style="color:#ffd60a">' + role.hint + '</span>' +
        '<span class="muted" style="font-weight:600; font-size:13px">Male mit — flieg nicht auf!</span>';
    } else {
      hold.style.background = '#173a5a';
      hold.innerHTML = '<span class="muted" style="font-weight:600">Gemeinsam zeichnet ihr:</span>' +
        '<span style="font-size:30px; color:#64d2ff">' + role.word + '</span>' +
        '<span class="muted" style="font-weight:600; font-size:13px">Ein Strich pro Zug — nicht zu deutlich, der Fake schaut zu!</span>';
    }
  }
  const down = (e) => { e.preventDefault(); renderCard(true); };
  const up = (e) => { if (e) e.preventDefault(); renderCard(false); };
  hold.addEventListener('touchstart', down); hold.addEventListener('touchend', up); hold.addEventListener('touchcancel', up);
  hold.addEventListener('mousedown', down); window.addEventListener('mouseup', () => renderCard(false));
  // Erst View wechseln, dann senden — die Antwort (faTurn) kann sofort eintreffen
  $('faSeenBtn').addEventListener('click', () => { renderCard(false); showWait('👀 Schaut auf den Bildschirm', 'Gleich geht es los…'); ac.message(AirConsole.SCREEN, { t: 'faSeen' }); });

  // --- Ein-Strich-Pad (normalisierte Koordinaten wie beim Drawing-Spiel) ---
  const pad = $('faPad'), pctx = pad.getContext('2d');
  let baseStrokes = [], stroke = null, drawing = false, done = false, myColor = '#ff2d55';
  const clampN = (v) => Math.max(0, Math.min(1, v)), r3 = (v) => Math.round(v * 1000) / 1000;
  function drawAll() {
    pctx.fillStyle = '#fff'; pctx.fillRect(0, 0, pad.width, pad.height);
    pctx.lineCap = 'round'; pctx.lineJoin = 'round';
    for (const s of baseStrokes.concat(stroke ? [stroke] : [])) {
      if (!s.p.length) continue;
      pctx.strokeStyle = s.c; pctx.lineWidth = Math.max(1, s.w * pad.width);
      pctx.beginPath(); pctx.moveTo(s.p[0][0] * pad.width, s.p[0][1] * pad.height);
      for (let i = 1; i < s.p.length; i++) pctx.lineTo(s.p[i][0] * pad.width, s.p[i][1] * pad.height);
      if (s.p.length === 1) pctx.lineTo(s.p[0][0] * pad.width + 0.5, s.p[0][1] * pad.height);
      pctx.stroke();
    }
  }
  function padPos(e) { const r = pad.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; return [clampN((t.clientX - r.left) / r.width), clampN((t.clientY - r.top) / r.height)]; }
  function syncTools() { $('faSend').disabled = !done; $('faSend').style.opacity = done ? 1 : 0.5; }
  function fStart(e) { if (done || stroke) return; e.preventDefault(); drawing = true; stroke = { c: myColor, w: 0.012, p: [padPos(e).map(r3)] }; drawAll(); }
  function fMove(e) { if (!drawing || !stroke) return; e.preventDefault(); stroke.p.push(padPos(e).map(r3)); drawAll(); }
  function fEnd(e) { if (e) e.preventDefault(); if (!drawing) return; drawing = false; if (stroke) { done = true; syncTools(); } }
  pad.addEventListener('touchstart', fStart); pad.addEventListener('touchmove', fMove); pad.addEventListener('touchend', fEnd); pad.addEventListener('touchcancel', fEnd);
  pad.addEventListener('mousedown', fStart); pad.addEventListener('mousemove', fMove); window.addEventListener('mouseup', fEnd);
  $('faRetry').addEventListener('click', () => { stroke = null; done = false; drawing = false; syncTools(); drawAll(); });
  $('faSend').addEventListener('click', () => {
    if (!done || !stroke) return;
    const s = stroke; stroke = null; done = false;
    // Erst View wechseln, dann senden — die Antwort (z.B. faVote) kann sofort eintreffen
    showWait('👀 Schaut auf den Bildschirm', 'Strich abgeschickt ✓');
    ac.message(AirConsole.SCREEN, { t: 'faStroke', s });
  });

  function showWait(title, info) {
    $('faWaitTitle').textContent = title; $('faWaitInfo').textContent = info || '';
    $('faNextBtn').style.display = 'none';
    showView('fa-wait');
  }
  $('faNextBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'faNext' }));

  const FAc = {
    activate() { role = null; showWait('👀 Schaut auf den Bildschirm', ''); },
    onMessage(d) {
      if (d.t === 'faRole') {
        role = { fake: d.fake, word: d.word, hint: d.hint };
        myHost = d.host; updateAbort();
        $('faRoundLbl').textContent = 'Runde ' + d.round;
        renderCard(false);
        showView('fa-card');
      } else if (d.t === 'faTurn') {
        myColor = d.color || myColor; baseStrokes = d.strokes || [];
        stroke = null; done = false; drawing = false; syncTools(); drawAll();
        $('faTurnLbl').textContent = 'Strich ' + d.turn + '/' + d.of;
        showView('fa-draw');
      } else if (d.t === 'faWait') {
        showWait('🖌️ ' + d.current + ' zeichnet…', '👀 Schaut auf den Bildschirm');
      } else if (d.t === 'faVote') {
        const list = $('faVoteList'); list.innerHTML = '';
        (d.options || []).filter(o => o.id !== ac.getDeviceId()).forEach(o => {
          const b = document.createElement('button'); b.className = 'modebtn'; b.style.fontSize = '18px'; b.style.padding = '14px';
          b.textContent = o.name;
          b.addEventListener('click', () => { showWait('🗳️ Stimme abgegeben', 'Warte auf die anderen…'); ac.message(AirConsole.SCREEN, { t: 'faVoteFor', target: o.id }); });
          list.appendChild(b);
        });
        showView('fa-vote');
      } else if (d.t === 'faPhase' && d.phase === 'result') {
        myHost = d.host; updateAbort();
        showWait('🎭 Aufgelöst!', 'Schaut auf den großen Bildschirm.');
        $('faNextBtn').style.display = d.host ? 'inline-block' : 'none';
      }
    }
  };
  registerGame({ key: 'fakeartist', controller: FAc });
})();
