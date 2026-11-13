// ============ Controller-Modul: FOTOSALAT ============
// Injiziert seine View selbst — controller.html muss nur das Skript einbinden (und core/snap.js für den Foto-Knopf).
// Der Fernseher sagt mit fsState, was dieses Handy gerade zeigen soll; das Handy malt nur danach. So findet
// es auch nach einem Neuladen zurück (manche Handys laden die Seite neu, während die Kamera-App offen ist).
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #v-fotosalat .bar { justify-content:flex-start; gap:12px; }
  #fsClock { min-width:0; text-align:left; color:#ffd60a; }
  #fsBody { flex:1; min-height:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:0 14px 14px; text-align:center; }
  #fsText { font-size:24px; font-weight:800; line-height:1.2; }
  #fsPicWrap { flex:1; min-height:0; width:100%; display:flex; align-items:center; justify-content:center; }
  #fsPicBox { position:relative; max-width:100%; max-height:100%; display:flex; }
  #fsPic { max-width:100%; max-height:100%; border-radius:12px; object-fit:contain; display:block; margin:auto; background:#000; }
  #fsCross { position:absolute; width:54px; height:54px; margin:-27px 0 0 -27px; border:3px solid #ffd60a; border-radius:50%; box-shadow:0 0 0 2px rgba(0,0,0,.6); pointer-events:none; display:none; }
  #fsRow { display:flex; gap:10px; align-items:center; width:100%; max-width:440px; }
  #fsMine { width:64px; height:64px; border-radius:10px; object-fit:cover; display:none; }
  #fsShoot { font-size:22px; padding:18px 16px; }
  #fsOpts { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; width:100%; max-width:440px; }
  #fsOpts .btn { flex:1 1 40%; font-size:19px; padding:16px 10px; }
  #fsOpts .btn.sel { background:#ff2d55; }
  #fsHeart { font-size:64px; padding:24px 44px; border-radius:28px; background:rgba(255,255,255,.12); }
  #fsHeart.on { background:#ff2d55; }
  #fsNext, #fsAgain { width:100%; max-width:440px; flex:0; font-size:19px; }
</style>
<!-- FOTOSALAT -->
<div id="v-fotosalat" class="view">
  <div class="bar"><span class="word">📸 Fotosalat</span><span id="fsClock" class="timer"></span></div>
  <div id="fsBody">
    <div id="fsText"></div>
    <div id="fsSub" class="muted"></div>
    <div id="fsPicWrap"><div id="fsPicBox"><img id="fsPic" alt=""><div id="fsCross"></div></div></div>
    <div id="fsCap" class="muted"></div>
    <div id="fsRow"><img id="fsMine" alt=""><button id="fsShoot" class="btn go">📷 Foto machen</button></div>
    <div id="fsOpts"></div>
    <button id="fsHeart" class="btn">❤️</button>
    <button id="fsNext" class="btn">⏭ Weiter</button>
    <button id="fsAgain" class="btn go">🔁 Nochmal</button>
  </div>
</div>`);
  VIEWS.push('fotosalat');

  const SHOOT = ['pose', 'copy', 'task', 'zshoot'];
  const toScreen = (m) => ac.message(AirConsole.SCREEN, m);
  const vib = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
  const show = (id, on, as) => { $(id).style.display = on ? (as || 'block') : 'none'; };

  // what this phone knows beyond the TV's word: the pose it was sent, its own last photo, and for which phase
  let s = null, tplUrl = null, mine = null, mineKey = null, busy = false, note = '';

  function cross(f) {
    const on = !!(s && s.phase === 'zshoot' && mine && f);
    show('fsCross', on);
    if (on) { $('fsCross').style.left = f.x * 100 + '%'; $('fsCross').style.top = f.y * 100 + '%'; }
  }
  function picture(url) {
    show('fsPicWrap', !!url, 'flex');
    if (url && $('fsPic').getAttribute('src') !== url) $('fsPic').src = url;
  }

  function render() {
    const d = s, shoot = SHOOT.includes(d.phase);
    if (mineKey !== d.key) { mine = null; mineKey = d.key; note = ''; }        // a new phase: the old photo is history
    let head = '', sub = '', cap = '', pic = null, opts = '';
    if (shoot) startTimer(d.left, $('fsClock'), () => {}); else { stopTimer(); $('fsClock').textContent = ''; }

    if (d.phase === 'pose') { head = '🕺 Mach eine Pose vor!'; sub = 'Die anderen müssen sie gleich nachstellen.'; pic = mine; }
    else if (d.phase === 'copy') {
      head = '🖼️ Stell das nach!';
      if (d.tpl && d.tpl.art) { pic = d.tpl.art; cap = d.tpl.title + ' · ' + d.tpl.by; }
      else if (d.tpl) { pic = tplUrl; cap = 'Pose von ' + d.tpl.by; }
    }
    else if (d.phase === 'task') { head = '🏃 „' + d.task + '“'; sub = 'Finde es und fotografiere es!'; pic = mine; }
    else if (d.phase === 'zshoot') {
      head = '🔍 Fotografiere etwas hier im Raum'; pic = mine;
      sub = mine ? 'Tipp auf die Stelle, an der das Zoomen anfangen soll.' : 'Die anderen müssen es erraten, während der Fernseher herauszoomt.';
    }
    else if (d.phase === 'show') {
      head = d.mine ? (d.step ? '😎 Das ist deins!' : '🥁 Gleich bist du dran …') : '📺 Schau zum Fernseher';
      sub = d.i + ' von ' + d.n + (d.wertung && d.step && !d.mine ? ' · Gefällt es dir? Dann ein Herz!' : '');
    }
    else if (d.phase === 'gallery') {
      head = '📺 „' + d.task + '“';
      sub = d.wertung ? (d.options.length ? 'Welches Foto ist das beste?' : 'Die anderen stimmen ab.') : 'Schau zum Fernseher.';
      if (d.wertung) opts = d.options.map(o => '<button class="btn' + (d.voted === o.id ? ' sel' : '') + '" data-vote="' + o.id + '">' + (d.voted === o.id ? '❤️ ' : '') + o.name + '</button>').join('');
    }
    else if (d.phase === 'riddle') {
      if (d.solved !== null) { head = d.solved ? '✅ ' + d.solvedName + ' hat\'s erkannt!' : '🤷 Niemand hat\'s erkannt'; sub = 'Foto von ' + d.byName; }
      else if (d.owner) {
        head = '🤫 Dein Foto! Nichts verraten.'; sub = 'Wer hat es zuerst richtig gerufen?';
        opts = d.options.map(o => '<button class="btn" data-guess="' + o.id + '">' + o.name + '</button>').join('') + '<button class="btn" data-guess="0" style="flex-basis:100%">🤷 Niemand – auflösen</button>';
      } else { head = '🔍 Was ist das?'; sub = 'Ruf es laut! ' + d.byName + ' entscheidet, wer es zuerst hatte.'; }
    }
    else if (d.phase === 'over') {
      head = d.wertung ? (d.won ? '🏆 Du hast gewonnen!' : '📸 Das war\'s!') : '📸 Das war\'s!';
      sub = (d.wertung ? d.score + (d.score === 1 ? ' Punkt' : ' Punkte') + ' · ' : '') + (d.host ? 'Der 💾-Knopf am Fernseher speichert die Fotos.' : 'Der Host kann nochmal starten.');
    }

    $('fsText').textContent = head;
    $('fsSub').textContent = note || sub;
    $('fsCap').textContent = cap;
    picture(pic);
    cross(d.focus);
    show('fsRow', shoot, 'flex');
    if (shoot) {
      $('fsShoot').disabled = busy;
      $('fsShoot').textContent = busy ? '⏳ Einen Moment …' : (d.done ? '✅ Foto ist da · 📷 Nochmal' : '📷 Foto machen');
      $('fsShoot').style.background = d.done && !busy ? '#3a3a48' : ''; $('fsShoot').style.color = d.done && !busy ? '#fff' : '';
      show('fsMine', d.phase === 'copy' && !!mine);
      if (d.phase === 'copy' && mine) $('fsMine').src = mine;
    }
    $('fsOpts').innerHTML = opts; show('fsOpts', !!opts, 'flex');
    show('fsHeart', d.phase === 'show' && d.wertung && d.step === 1 && !d.mine);
    $('fsHeart').classList.toggle('on', !!d.hearted);
    const nextText = { show: d.step ? '⏭ Nächstes Paar' : '⏭ Aufdecken', gallery: '⏭ Weiter', riddle: d.solved !== null && d.solved !== undefined ? '⏭ Nächstes Rätsel' : '⏭ Auflösen' }[d.phase]
      || (shoot ? '⏭ Nicht mehr warten (' + d.count + '/' + d.of + ')' : '');
    show('fsNext', d.host && !!nextText); $('fsNext').textContent = nextText;
    show('fsAgain', d.host && d.phase === 'over');
  }

  // ---------- Foto-Knopf ----------
  window.Snap.bind($('fsShoot'), {
    onStart() { busy = true; note = ''; if (s) render(); },
    onPhoto(p) {
      busy = false;
      if (!s || !SHOOT.includes(s.phase)) { if (s) { note = 'Zu spät, die Runde ist schon vorbei.'; render(); } return; }
      mine = p.url; mineKey = s.key; s.done = true; s.focus = { x: 0.5, y: 0.5 };
      vib(30);
      toScreen({ t: 'fsPhoto', url: p.url });
      render();
    },
    onError(msg) { busy = false; note = '⚠️ ' + msg + ' Versuch es nochmal.'; if (s) render(); }
  });

  // Zoom-Rätsel: ein Tipp aufs eigene Foto setzt die Stelle, an der das Zoomen anfängt
  function setFocus(e) {
    if (!s || s.phase !== 'zshoot' || !mine) return;
    const t = e.changedTouches ? e.changedTouches[0] : e, r = $('fsPic').getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (t.clientY - r.top) / r.height));
    e.preventDefault();
    s.focus = { x, y }; cross(s.focus);
    toScreen({ t: 'fsFocus', x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  }
  $('fsPicBox').addEventListener('touchstart', setFocus);
  $('fsPicBox').addEventListener('mousedown', setFocus);

  $('fsOpts').addEventListener('click', (e) => {
    const b = e.target.closest('.btn');
    if (!b) return;
    if (b.dataset.vote) { vib(15); toScreen({ t: 'fsVote', id: +b.dataset.vote }); }
    else if (b.dataset.guess !== undefined) { vib(15); toScreen({ t: 'fsGuess', id: +b.dataset.guess }); }
  });
  $('fsHeart').addEventListener('click', () => { vib(20); toScreen({ t: 'fsHeart' }); });
  $('fsNext').addEventListener('click', () => toScreen({ t: 'fsNext' }));
  $('fsAgain').addEventListener('click', () => toScreen({ t: 'fsAgain' }));

  registerGame({ key: 'fotosalat', controller: {
    activate() {
      s = null; tplUrl = null; mine = null; mineKey = null; busy = false; note = '';
      try { document.body.style.background = ''; } catch (e) {}
      $('fsText').textContent = '📸 Gleich geht\'s los …'; $('fsSub').textContent = ''; $('fsCap').textContent = ''; $('fsClock').textContent = '';
      ['fsPicWrap', 'fsRow', 'fsOpts', 'fsHeart', 'fsNext', 'fsAgain'].forEach(id => show(id, false));
      showView('fotosalat');
      toScreen({ t: 'fsHello' });            // the screen answers with what this phone should show
    },
    onMessage(d) {
      if (d.t === 'fsTpl') { tplUrl = d.url; if (s) render(); }
      else if (d.t === 'fsState') {
        const turn = !s || s.phase !== d.phase || s.i !== d.i || s.step !== d.step;
        s = d;
        if (turn && (d.phase === 'show' && d.mine && d.step === 1)) vib([60, 40, 60]);
        render();
      }
    }
  } });
})();
