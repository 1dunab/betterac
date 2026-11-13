// ============ Controller-Modul: RÜCKWÄRTSGANG ============
// Injiziert seine View selbst — controller.html muss nur das Skript einbinden (dazu core/mic.js und clip.js).
// Der Fernseher sagt mit rwState, was dieses Handy zeigen soll. Wer dran ist, nimmt auf: über das Live-Mikrofon,
// wo der Browser es erlaubt (https), sonst über die Aufnahme-App des Handys. Das Handy schneidet die Aufnahme,
// rechnet sie klein und schickt sie zum Fernseher; abgespielt wird nur dort.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #rwBody { flex:1; min-height:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:0 14px 14px; text-align:center; }
  #rwText { font-size:24px; font-weight:800; line-height:1.2; }
  #rwWord { font-size:44px; font-weight:800; line-height:1.1; color:#ffd60a; overflow-wrap:anywhere; }
  #rwBody .btn { width:100%; max-width:440px; flex:0; font-size:19px; padding:15px 12px; }
  #rwRec { font-size:24px !important; padding:24px 12px !important; }
  #rwRec.live { background:#ff453a; color:#fff; }
  #rwAlt { background:none !important; font-size:15px !important; padding:6px !important; text-decoration:underline; opacity:.8; }
  #rwOpts { display:flex; flex-direction:column; gap:8px; width:100%; max-width:440px; }
  #rwOpts .btn.sel { background:#ff2d55; }
  #rwNote { color:#ffd60a; min-height:20px; }
</style>
<!-- RÜCKWÄRTSGANG -->
<div id="v-rueckwaerts" class="view">
  <div class="bar"><span class="word">⏪ Rückwärtsgang</span></div>
  <div id="rwBody">
    <div id="rwText"></div>
    <div id="rwWord"></div>
    <div id="rwSub" class="muted"></div>
    <button id="rwRec" class="btn go">🎤 Aufnehmen</button>
    <button id="rwAlt" class="btn"></button>
    <div id="rwNote" class="muted"></div>
    <button id="rwPlay" class="btn">▶ Nochmal hören</button>
    <button id="rwAgain" class="btn"></button>
    <button id="rwDone" class="btn go">✔ Fertig, weiter</button>
    <div id="rwOpts"></div>
    <button id="rwNext" class="btn">⏭ Weiter</button>
    <button id="rwRestart" class="btn go">🔁 Nochmal</button>
  </div>
</div>`);
  VIEWS.push('rueckwaerts');

  const toScreen = (m) => ac.message(AirConsole.SCREEN, m);
  const vib = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
  const show = (id, on) => { $(id).style.display = on ? 'block' : 'none'; };
  const Mic = window.Mic, Clip = window.RwClip;

  let s = null, busyUntil = 0, busyTimer = null, working = false, note = '';
  const busy = () => performance.now() < busyUntil;
  const canRecord = () => !!s && s.mine && (s.phase === 'say' || s.phase === 'listen') && !busy() && !working;

  // ---------- Aufnehmen ----------
  // a fresh recording from either way: cut it, shrink it, send it
  function gotClip(c) {
    working = false;
    const p = Clip.prepare(c.x, c.rate);
    if (!s || !s.mine || (s.phase !== 'say' && s.phase !== 'listen')) { note = ''; }
    else if (!p) { note = '🤔 Da war nichts zu hören. Näher ans Handy und nochmal!'; vib([40, 60, 40]); }
    else { note = ''; vib(30); toScreen({ t: 'rwClip', pcm: p.pcm }); }
    if (s) render();
  }
  const failed = (msg) => { working = false; note = '⚠️ ' + msg; if (s) render(); };
  const started = () => { working = true; note = ''; if (s) render(); };
  // without the live microphone: the phone's recorder app, or a short video whose sound is used
  const first = Mic.ios ? 'video' : 'audio', other = first === 'audio' ? 'video' : 'audio';
  const inputs = {};
  [first, other].forEach(kind => { inputs[kind] = Mic.fileInput({ kind, onStart: started, onClip: gotClip, onError: failed }); });
  const open = (kind) => { Mic.audio(); inputs[kind].value = ''; inputs[kind].click(); };

  $('rwRec').addEventListener('click', () => {
    if (Mic.recording()) { Mic.stop(); return; }
    if (!canRecord()) return;
    if (!Mic.canLive()) { open(first); return; }
    note = ''; working = true; render();           // the browser may ask for permission first: no second press meanwhile
    Mic.start({ onStart: () => { working = false; vib(20); render(); }, onEnd: gotClip, onError: failed });
  });
  $('rwAlt').addEventListener('click', () => { if (canRecord()) open(other); });
  $('rwPlay').addEventListener('click', () => { if (!busy()) toScreen({ t: 'rwPlay' }); });
  $('rwAgain').addEventListener('click', () => toScreen({ t: 'rwAgain' }));
  $('rwDone').addEventListener('click', () => toScreen({ t: 'rwDone' }));
  $('rwNext').addEventListener('click', () => toScreen({ t: 'rwNext' }));
  $('rwRestart').addEventListener('click', () => toScreen({ t: 'rwRestart' }));
  $('rwOpts').addEventListener('click', (e) => { const b = e.target.closest('.btn'); if (b) { vib(15); toScreen({ t: 'rwVote', i: +b.dataset.i }); } });

  function render() {
    const d = s, turn = d.phase === 'say' || d.phase === 'listen' || d.phase === 'reveal', mine = turn && d.mine, wait = busy();
    let head = '', word = '', sub = '', opts = '';
    if (mine && d.phase === 'say') { head = '🎤 Du bist dran! Sag:'; word = d.word || 'ein Wort oder einen kurzen Satz'; sub = 'Deutlich und nah am Handy sprechen.'; }
    else if (mine && d.phase === 'listen') { head = wait ? '👂 Hör gut zu …' : '🎤 Jetzt du: sprich das Rückwärts-Wort nach'; sub = wait ? 'Erst vorwärts, dann rückwärts.' : 'So genau, wie du kannst. Auch die Melodie.'; }
    else if (mine && d.phase === 'reveal') { head = wait ? '🥁 Und umgedreht …' : (d.word ? 'Klang das nach „' + d.word + '“?' : 'Klang das wie dein Original?'); sub = 'Versuch ' + d.tries; }
    else if (turn) { head = '📺 ' + d.curName + ' ist dran'; sub = d.soon ? 'Du bist gleich dran!' : (d.nextNames.length ? 'Danach: ' + d.nextNames.join(', ') : ''); }
    else if (d.phase === 'recap') { head = '🎬 Die Show'; sub = d.i + ' von ' + d.n + ' · ' + d.curName + (d.word ? ': ' + d.word : ''); }
    else if (d.phase === 'vote') {
      head = '❤️ Wer war am nächsten dran?'; sub = d.options.length ? '' : 'Die anderen stimmen ab.';
      opts = d.options.map(o => '<button class="btn' + (d.voted === o.i ? ' sel' : '') + '" data-i="' + o.i + '">' + (d.voted === o.i ? '❤️ ' : '') + o.label + '</button>').join('');
    }
    else if (d.phase === 'over') { head = d.wertung && d.won ? '🏆 Du hast gewonnen!' : '⏪ Das war\'s!'; sub = d.wertung ? d.score + (d.score === 1 ? ' Stimme' : ' Stimmen') : (d.host ? '' : 'Der Host kann nochmal starten.'); }
    $('rwText').textContent = head; $('rwWord').textContent = word; show('rwWord', !!word); $('rwSub').textContent = sub;
    $('rwNote').textContent = note;

    const rec = mine && d.phase !== 'reveal', live = Mic.canLive(), on = Mic.recording();
    show('rwRec', rec);
    $('rwRec').disabled = !on && !canRecord();
    $('rwRec').classList.toggle('live', on);
    $('rwRec').textContent = on ? '⏹ Fertig' : working ? '⏳ Einen Moment …' : wait ? '👂 Erst zuhören …'
      : live ? (d.phase === 'say' ? '🎤 Aufnahme starten' : '🎤 Nachsprechen') : (first === 'video' ? '🎥 Aufnehmen (kurzes Video)' : '🎙️ Aufnehmen');
    show('rwAlt', rec && !live && !wait && !working);
    $('rwAlt').textContent = other === 'video' ? 'Klappt nicht? Als kurzes Video aufnehmen' : 'Klappt nicht? Mit der Ton-App aufnehmen';
    show('rwPlay', mine && d.phase !== 'say'); $('rwPlay').disabled = wait;
    show('rwAgain', mine && d.phase !== 'say' && !on);
    $('rwAgain').textContent = d.phase === 'listen' ? '↩ Wort neu aufnehmen' : '🔁 Nochmal versuchen';
    show('rwDone', mine && d.phase === 'reveal');
    $('rwOpts').innerHTML = opts; $('rwOpts').style.display = opts ? 'flex' : 'none';
    const next = { say: '⏭ Überspringen', listen: '⏭ Überspringen', reveal: '⏭ Weiter', recap: '⏭ Weiter', vote: '⏭ Abstimmung beenden' }[d.phase];
    show('rwNext', d.host && !!next && !mine); if (next) $('rwNext').textContent = next + (turn ? ' (' + d.curName + ')' : '');
    show('rwRestart', d.host && d.phase === 'over');
  }

  registerGame({ key: 'rueckwaerts', controller: {
    activate() {
      s = null; note = ''; working = false; busyUntil = 0; clearTimeout(busyTimer);
      if (Mic.recording()) Mic.stop();
      try { document.body.style.background = ''; } catch (e) {}
      $('rwText').textContent = '⏪ Gleich geht\'s los …'; $('rwSub').textContent = ''; $('rwNote').textContent = '';
      ['rwWord', 'rwRec', 'rwAlt', 'rwPlay', 'rwAgain', 'rwDone', 'rwOpts', 'rwNext', 'rwRestart'].forEach(id => show(id, false));
      showView('rueckwaerts');
      toScreen({ t: 'rwHello' });            // the screen answers with what this phone should show
    },
    onMessage(d) {
      if (d.t !== 'rwState') return;
      const turned = !s || s.phase !== d.phase || s.cur !== d.cur;
      if (turned) { note = ''; if (Mic.recording() && !(d.mine && (d.phase === 'say' || d.phase === 'listen'))) Mic.stop(); }
      s = d;
      // while the TV plays, the buttons wait: the microphone would hear the TV
      busyUntil = performance.now() + (d.busyMs || 0);
      clearTimeout(busyTimer);
      if (d.busyMs > 0) busyTimer = setTimeout(() => { if (s) render(); }, d.busyMs + 30);
      if (turned && d.mine && d.phase === 'say') vib([80, 50, 80]);
      render();
    }
  } });
})();
