// ============ Controller-Modul: STADT LAND FLUSS ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #slfInputs { display:flex; flex-direction:column; gap:10px; padding:0 14px; overflow-y:auto; flex:1; }
  #slfInputs label { font-weight:700; font-size:14px; opacity:.8; }
  #slfInputs input { max-width:none; font-size:18px; padding:11px; }
</style>
<!-- STADT LAND FLUSS: SCHREIBEN -->
<div id="v-slf-write" class="view">
  <div class="bar"><span class="word">🔤 Buchstabe: <span id="slfLetter" style="color:#ffd60a">?</span></span><span id="slfTimer" class="timer">–</span></div>
  <div id="slfInputs"></div>
  <div class="tools"><button id="slfDone" class="btn go">Fertig ✋</button></div>
</div>
<!-- STADT LAND FLUSS: WARTEN / ERGEBNIS -->
<div id="v-slf-wait" class="view"><div class="center">
  <div id="slfWaitTitle" class="big">Abgegeben ✓</div>
  <div id="slfWaitInfo" class="muted"></div>
  <button id="slfNextBtn" class="btn go" style="display:none; font-size:18px">▶ Weiter</button>
</div></div>`);
  VIEWS.push('slf-write', 'slf-wait');

  let submitted = false, lastResult = '';

  function buildInputs(cats) {
    const wrap = $('slfInputs'); wrap.innerHTML = '';
    (cats || []).forEach(cat => {
      const lab = document.createElement('label'); lab.textContent = cat;
      const inp = document.createElement('input');
      inp.type = 'text'; inp.autocomplete = 'off'; inp.setAttribute('autocapitalize', 'words');
      inp.setAttribute('data-cat', cat); inp.placeholder = cat + '…';
      wrap.appendChild(lab); wrap.appendChild(inp);
    });
  }
  function collectAnswers() {
    const a = {};
    document.querySelectorAll('#slfInputs input').forEach(inp => { a[inp.getAttribute('data-cat')] = inp.value; });
    return a;
  }
  function submitAnswers() {
    if (submitted) return;
    submitted = true; stopTimer();
    const a = collectAnswers();
    // Erst View wechseln, dann senden — die Auswertung kann sofort eintreffen
    $('slfWaitTitle').textContent = 'Abgegeben ✓';
    $('slfWaitInfo').textContent = 'Warte auf die anderen…';
    $('slfNextBtn').style.display = 'none';
    showView('slf-wait');
    ac.message(AirConsole.SCREEN, { t: 'slfAnswers', a });
  }
  $('slfDone').addEventListener('click', submitAnswers);
  $('slfNextBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'slfNext' }));

  const SLFc = {
    activate() { submitted = false; lastResult = ''; $('slfWaitTitle').textContent = '👀 Schaut auf den Bildschirm'; $('slfWaitInfo').textContent = ''; $('slfNextBtn').style.display = 'none'; showView('slf-wait'); },
    onMessage(d) {
      if (d.t === 'slfRound') {
        submitted = false; lastResult = '';
        $('slfLetter').textContent = d.letter;
        buildInputs(d.cats);
        showView('slf-write');
        startTimer(d.ms, $('slfTimer'), submitAnswers);
        const first = document.querySelector('#slfInputs input');
        if (first) setTimeout(() => first.focus(), 50);
      } else if (d.t === 'slfResult') {
        lastResult = '+' + d.gained + ' Punkte · Gesamt: ' + d.total;
      } else if (d.t === 'slfPhase') {
        myHost = d.host; updateAbort();
        stopTimer(); submitted = true;
        if (d.phase === 'score') {
          $('slfWaitTitle').textContent = '📊 Auswertung!';
          $('slfWaitInfo').textContent = (lastResult ? lastResult + ' — ' : '') + 'Schaut auf den großen Bildschirm.';
          $('slfNextBtn').textContent = '▶ Weiter';
        } else if (d.phase === 'final') {
          $('slfWaitTitle').textContent = '🏆 Endstand!';
          $('slfWaitInfo').textContent = (lastResult ? lastResult + ' — ' : '') + 'Schaut auf den großen Bildschirm.';
          $('slfNextBtn').textContent = '🔁 Nochmal';
        }
        $('slfNextBtn').style.display = d.host ? 'inline-block' : 'none';
        showView('slf-wait');
      }
    }
  };
  registerGame({ key: 'categories', controller: SLFc });
})();
