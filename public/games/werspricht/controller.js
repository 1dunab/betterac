// ============ Controller-Modul: WER SPRICHT DA? ============
// Injiziert seine View selbst — controller.html muss nur das Skript einbinden (dazu core/mic.js und core/voiceclip.js).
// Der Fernseher sagt mit wsState, was dieses Handy zeigen soll: den Satz zum Einsprechen, dann zu jeder Stimme
// die Namen zum Antippen. Aufgenommen wird wie bei Rückwärtsgang: Live-Mikrofon, wo der Browser es erlaubt
// (https), sonst über die Aufnahme-App des Handys.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #v-werspricht .bar { justify-content:flex-start; gap:12px; }
  #wsClock { min-width:0; text-align:left; color:#ffd60a; }
  #wsBody { flex:1; min-height:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:0 14px 14px; text-align:center; }
  #wsText { font-size:24px; font-weight:800; line-height:1.2; }
  #wsLine { font-size:30px; font-weight:800; line-height:1.15; color:#ffd60a; overflow-wrap:anywhere; }
  #wsBody .btn { width:100%; max-width:440px; flex:0; font-size:19px; padding:15px 12px; }
  #wsBody .btn:disabled { opacity:.5; }
  #wsRec { font-size:24px !important; padding:24px 12px !important; }
  #wsRec.live { background:#ff453a; color:#fff; }
  #wsRec.got { background:#3a3a48; color:#fff; }
  #wsAlt { background:none !important; font-size:15px !important; padding:6px !important; text-decoration:underline; opacity:.8; }
  #wsOpts { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; width:100%; max-width:440px; }
  #wsOpts .btn { flex:1 1 40%; font-size:20px; padding:18px 10px; }
  #wsOpts .btn.sel { background:#0a84ff; }
  #wsNote { color:#ffd60a; min-height:20px; }
</style>
<!-- WER SPRICHT DA? -->
<div id="v-werspricht" class="view">
  <div class="bar"><span class="word">🗣️ Wer spricht da?</span><span id="wsClock" class="timer"></span></div>
  <div id="wsBody">
    <div id="wsText"></div>
    <div id="wsLine"></div>
    <div id="wsSub" class="muted"></div>
    <button id="wsRec" class="btn go">🎤 Aufnehmen</button>
    <button id="wsAlt" class="btn"></button>
    <div id="wsNote" class="muted"></div>
    <div id="wsOpts"></div>
    <button id="wsPlay" class="btn">▶ Nochmal abspielen</button>
    <button id="wsNext" class="btn">⏭ Weiter</button>
    <button id="wsRestart" class="btn go">🔁 Nochmal</button>
  </div>
</div>`);
  VIEWS.push('werspricht');

  const toScreen = (m) => ac.message(AirConsole.SCREEN, m);
  const vib = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
  const show = (id, on) => { $(id).style.display = on ? 'block' : 'none'; };
  const Mic = window.Mic, Clip = window.VoiceClip;

  let s = null, working = false, note = '', busyUntil = 0, busyTimer = null;
  const canRecord = () => !!s && !!s.canRec && !working;

  // ---------- Aufnehmen ----------
  function gotClip(c) {
    working = false;
    const p = Clip.prepare(c.x, c.rate);
    if (!s || !s.canRec) { note = ''; }
    else if (!p) { note = '🤔 Da war nichts zu hören. Näher ans Handy und nochmal!'; vib([40, 60, 40]); }
    else { note = ''; vib(30); toScreen({ t: 'wsClip', pcm: p.pcm }); }
    if (s) render();
  }
  const failed = (msg) => { working = false; note = '⚠️ ' + msg; if (s) render(); };
  const started = () => { working = true; note = ''; if (s) render(); };
  // without the live microphone: the phone's recorder app, or a short video whose sound is used
  const first = Mic.ios ? 'video' : 'audio', other = first === 'audio' ? 'video' : 'audio';
  const inputs = {};
  [first, other].forEach(kind => { inputs[kind] = Mic.fileInput({ kind, onStart: started, onClip: gotClip, onError: failed }); });
  const open = (kind) => { Mic.audio(); inputs[kind].value = ''; inputs[kind].click(); };

  $('wsRec').addEventListener('click', () => {
    if (Mic.recording()) { Mic.stop(); return; }
    if (!canRecord()) return;
    if (!Mic.canLive()) { open(first); return; }
    note = ''; working = true; render();           // the browser may ask for permission first: no second press meanwhile
    Mic.start({ onStart: () => { working = false; vib(20); render(); }, onEnd: gotClip, onError: failed });
  });
  $('wsAlt').addEventListener('click', () => { if (canRecord()) open(other); });
  $('wsOpts').addEventListener('click', (e) => { const b = e.target.closest('.btn'); if (b) { vib(15); toScreen({ t: 'wsGuess', id: +b.dataset.id }); } });
  $('wsPlay').addEventListener('click', () => toScreen({ t: 'wsPlay' }));
  $('wsNext').addEventListener('click', () => toScreen({ t: 'wsNext' }));
  $('wsRestart').addEventListener('click', () => toScreen({ t: 'wsRestart' }));

  function render() {
    const d = s, on = Mic.recording(), live = Mic.canLive();
    let head = '', line = '', sub = '', opts = '', recText = '', nextText = '';
    if (d.phase === 'rec') {
      head = d.done ? '✅ Deine Aufnahme ist da' : '🎤 Sag ins Handy:'; line = '„' + d.text + '“';
      sub = d.done ? 'Nicht zufrieden? Nimm es nochmal auf.' : 'Verstell ruhig deine Stimme!';
      if (d.canRec) recText = d.done ? 'Nochmal aufnehmen' : 'Aufnahme starten';
      nextText = '⏭ Nicht mehr warten (' + d.count + '/' + d.of + ')';
    } else if (d.phase === 'guess') {
      if (d.mine) { head = '🤫 Das bist du!'; sub = 'Lass dir nichts anmerken.'; }
      else {
        head = (d.high ? '🐿️' : '👹') + ' Wer spricht da?'; sub = d.guessed ? 'Getippt. Du kannst noch wechseln.' : 'Stimme ' + d.i + ' von ' + d.n;
        opts = d.options.map(o => '<button class="btn' + (d.guessed === o.id ? ' sel' : '') + '" data-id="' + o.id + '">' + o.name + '</button>').join('');
      }
      nextText = '⏭ Auflösen (' + d.count + '/' + d.of + ')';
    } else if (d.phase === 'reveal') {
      head = d.mine ? (d.fooled ? '😎 ' + d.fooled + ' reingelegt!' : '🙈 Alle haben dich erkannt') : d.right === null ? 'Das war ' + d.byName : d.right ? '✅ Richtig, das war ' + d.byName + '!' : '❌ Nein, das war ' + d.byName;
      sub = d.mine ? (d.caught ? d.caught + ' haben dich erkannt.' : 'Niemand hat dich erkannt.') : '';
      nextText = '⏭ Weiter';
    } else if (d.phase === 'over') {
      head = d.wertung && d.won ? '🏆 Du hast gewonnen!' : '🗣️ Das war\'s!';
      sub = d.wertung ? d.score + (d.score === 1 ? ' Punkt' : ' Punkte') : (d.host ? '' : 'Der Host kann nochmal starten.');
    }
    $('wsText').textContent = head; $('wsLine').textContent = line; show('wsLine', !!line); $('wsSub').textContent = sub; $('wsNote').textContent = note;
    if (d.phase === 'rec') startTimer(d.left, $('wsClock'), () => {}); else { stopTimer(); $('wsClock').textContent = ''; }

    const rec = !!recText || on;
    show('wsRec', rec);
    $('wsRec').disabled = !on && !canRecord();
    $('wsRec').classList.toggle('live', on); $('wsRec').classList.toggle('got', !on && !!d.done);
    $('wsRec').textContent = on ? '⏹ Fertig' : working ? '⏳ Einen Moment …' : (live ? '🎤 ' : first === 'video' ? '🎥 ' : '🎙️ ') + recText + (!live && first === 'video' ? ' (kurzes Video)' : '');
    show('wsAlt', rec && !on && !live && !working);
    $('wsAlt').textContent = other === 'video' ? 'Klappt nicht? Als kurzes Video aufnehmen' : 'Klappt nicht? Mit der Ton-App aufnehmen';
    $('wsOpts').innerHTML = opts; $('wsOpts').style.display = opts ? 'flex' : 'none';
    show('wsPlay', d.host && d.phase === 'guess'); $('wsPlay').disabled = performance.now() < busyUntil;
    show('wsNext', d.host && !!nextText); $('wsNext').textContent = nextText;
    show('wsRestart', d.host && d.phase === 'over');
  }

  registerGame({ key: 'werspricht', controller: {
    activate() {
      s = null; note = ''; working = false; busyUntil = 0; clearTimeout(busyTimer);
      if (Mic.recording()) Mic.stop();
      try { document.body.style.background = ''; } catch (e) {}
      $('wsText').textContent = '🗣️ Gleich geht\'s los …'; $('wsSub').textContent = ''; $('wsNote').textContent = ''; $('wsClock').textContent = '';
      ['wsLine', 'wsRec', 'wsAlt', 'wsOpts', 'wsPlay', 'wsNext', 'wsRestart'].forEach(id => show(id, false));
      showView('werspricht');
      toScreen({ t: 'wsHello' });            // the screen answers with what this phone should show
    },
    onMessage(d) {
      if (d.t !== 'wsState') return;
      const turned = !s || s.phase !== d.phase || s.i !== d.i || s.round !== d.round;
      if (turned) { note = ''; if (Mic.recording() && !d.canRec) Mic.stop(); }
      s = d;
      // the host's replay button waits while the voice is playing
      busyUntil = performance.now() + (d.busyMs || 0);
      clearTimeout(busyTimer);
      if (d.busyMs > 0) busyTimer = setTimeout(() => { if (s) render(); }, d.busyMs + 30);
      if (turned && (d.phase === 'rec' || (d.phase === 'guess' && !d.mine))) vib(40);
      if (turned && d.phase === 'reveal' && d.right === true) vib([40, 40, 40]);
      render();
    }
  } });
})();
