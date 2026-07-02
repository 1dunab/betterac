// ============ Controller-Modul: SPION ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<!-- SPION: ROLLE ANSEHEN -->
<div id="v-spy-card" class="view">
  <div class="bar"><span class="word">🕵️ Spion — <span id="spyRoundLbl"></span></span></div>
  <div class="center">
    <div class="muted">Halte die Karte gedrückt, um deine Rolle zu sehen.<br>Niemandem zeigen! 🤫</div>
    <div id="spyHold" style="width:100%; max-width:340px; min-height:180px; border-radius:16px;
         background:#2a2a38; display:flex; flex-direction:column; align-items:center; justify-content:center;
         gap:8px; padding:18px; box-sizing:border-box; font-weight:800; font-size:22px; text-align:center;">
      <span>👆 Gedrückt halten</span>
    </div>
    <button id="spySeenBtn" class="btn go" style="width:100%; max-width:340px">Alles klar ✓</button>
  </div>
</div>
<!-- SPION: TISCHPHASE -->
<div id="v-spy-table" class="view">
  <div class="center">
    <div id="spyTableTitle" class="big">📵 Handy weglegen!</div>
    <div id="spyTableInfo" class="muted">Schaut auf den großen Bildschirm.</div>
    <button id="spyRevealBtn" class="btn" style="display:none; background:#ff3b30; font-size:18px">🕵️ Spion aufdecken</button>
    <button id="spyNextBtn" class="btn go" style="display:none; font-size:18px">▶ Nächste Runde</button>
  </div>
</div>`);
  VIEWS.push('spy-card', 'spy-table');

  let role = null; // { spy, word, hint }

  const hold = $('spyHold');
  function renderCard(show) {
    if (!show || !role) { hold.innerHTML = '<span>👆 Gedrückt halten</span>'; hold.style.background = '#2a2a38'; return; }
    if (role.spy) {
      hold.style.background = '#5a1720';
      hold.innerHTML = '<span style="font-size:26px">🕵️ Du bist der SPION!</span>' +
        '<span class="muted" style="font-weight:600">Du kennst das Wort nicht.<br>Hinweis — Kategorie:</span>' +
        '<span style="color:#ffd60a">' + role.hint + '</span>' +
        '<span class="muted" style="font-weight:600; font-size:13px">Bluffe dich durch & errate das Wort!</span>';
    } else {
      hold.style.background = '#173a5a';
      hold.innerHTML = '<span class="muted" style="font-weight:600">Das geheime Wort:</span>' +
        '<span style="font-size:30px; color:#64d2ff">' + role.word + '</span>' +
        '<span class="muted" style="font-weight:600; font-size:13px">Beschreibe es subtil — der Spion hört mit!</span>';
    }
  }
  const down = (e) => { e.preventDefault(); renderCard(true); };
  const up = (e) => { if (e) e.preventDefault(); renderCard(false); };
  hold.addEventListener('touchstart', down); hold.addEventListener('touchend', up); hold.addEventListener('touchcancel', up);
  hold.addEventListener('mousedown', down); window.addEventListener('mouseup', () => renderCard(false));

  function syncTable(phase, host) {
    $('spyRevealBtn').style.display = (host && phase === 'discuss') ? 'inline-block' : 'none';
    $('spyNextBtn').style.display = (host && phase === 'exposed') ? 'inline-block' : 'none';
    $('spyTableTitle').textContent = phase === 'exposed' ? '🎭 Aufgelöst!' : '📵 Handy weglegen!';
    $('spyTableInfo').textContent = phase === 'exposed'
      ? 'Hat ihr den Spion erwischt?'
      : 'Schaut auf den großen Bildschirm — reihum ein Wort nennen.';
  }
  $('spySeenBtn').addEventListener('click', () => { ac.message(AirConsole.SCREEN, { t: 'spySeen' }); renderCard(false); showView('spy-table'); syncTable('reveal', false); });
  $('spyRevealBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'spyReveal' }));
  $('spyNextBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'spyNext' }));

  const Sc = {
    activate() { showView('spy-table'); syncTable('reveal', false); },
    onMessage(d) {
      if (d.t === 'spyRole') {
        role = { spy: d.spy, word: d.word, hint: d.hint };
        myHost = d.host; updateAbort();
        $('spyRoundLbl').textContent = 'Runde ' + d.round;
        renderCard(false);
        showView('spy-card');
      } else if (d.t === 'spyPhase') {
        myHost = d.host; updateAbort();
        showView('spy-table'); syncTable(d.phase, d.host);
      }
    }
  };
  registerGame({ key: 'spy', controller: Sc });
})();
