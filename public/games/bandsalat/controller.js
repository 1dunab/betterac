// ============ Controller-Modul: BANDSALAT ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
// Erst ein Instrument wählen, dann spielen: Flächen für mehrere Finger, darunter der Looper (⏺ nimmt ab dem
// nächsten Takt auf, danach läuft es weiter). Der Baukasten ist ein Raster aus 16 Schritten zum An- und Abwählen.
// Das Handy macht keinen Ton: es schickt nur „Fläche n gedrückt“, der Fernseher rechnet Tonhöhe und Zeitpunkt.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #v-bspick .center { justify-content:flex-start; gap:10px; padding:6px 14px 12px; }
  #bsInsts { display:grid; grid-template-columns:1fr 1fr; gap:10px; width:100%; max-width:460px; }
  .bsinst { border:none; border-radius:16px; padding:12px 6px; font-size:17px; font-weight:800; color:#fff; background:rgba(255,255,255,.1);
            display:flex; flex-direction:column; align-items:center; gap:2px; }
  .bsinst span { font-size:32px; } .bsinst small { font-weight:400; opacity:.7; font-size:12px; }
  .bsinst.wide { grid-column:1 / -1; }
  #bsHostBox { width:100%; max-width:460px; display:none; gap:8px; flex-wrap:wrap; align-items:center; justify-content:center;
               background:rgba(0,0,0,.3); border-radius:14px; padding:10px; box-sizing:border-box; }
  #bsBpm { font-size:18px; font-weight:800; min-width:92px; }
  #v-bsplay .bar { padding:8px 10px; gap:10px; justify-content:flex-start; }
  #v-bsplay.host .bar { padding-right:132px; }
  #bsBack { white-space:nowrap; font-size:17px; } #bsChord { font-size:19px; white-space:nowrap; }
  #bsBeat { display:flex; gap:5px; margin-left:auto; }
  #bsBeat i { width:11px; height:11px; border-radius:50%; background:rgba(255,255,255,.22); }
  #bsBeat i.on { background:#fff; } #bsBeat i.one.on { background:#ff9f0a; }
  #bsOpts, #bsLoopBar { display:flex; gap:6px; padding:0 10px 8px; flex-wrap:wrap; align-items:center; }
  .bschip { border:none; border-radius:10px; padding:8px 11px; font-size:14px; font-weight:700; color:#fff; background:rgba(255,255,255,.14); }
  .bschip.sel { background:#fff; color:#10141a; }
  #bsRec.armed { background:#7a2a25; } #bsRec.rec { background:#ff453a; }
  #bsSurface { flex:1; min-height:0; display:grid; gap:8px; padding:0 10px 8px; touch-action:none; }
  .bspad { border-radius:16px; background:rgba(255,255,255,.13); display:flex; flex-direction:column; align-items:center; justify-content:center;
           font-weight:800; font-size:16px; text-align:center; overflow:hidden; }
  .bspad span { font-size:30px; pointer-events:none; }
  .bspad.hi { box-shadow:inset 0 0 0 3px rgba(255,214,10,.85); }
  .bspad.on { background:rgba(255,255,255,.9); color:#10141a; }
  #bsSurface.drums { grid-template-columns:1fr 1fr; grid-template-rows:repeat(3,1fr); }
  #bsSurface.bass, #bsSurface.perc { grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; }
  #bsSurface.keys { grid-template-columns:repeat(5,1fr); grid-template-rows:1fr 1fr; gap:5px; }
  #bsSurface.keys .bspad { border-radius:10px; }
  /* Baukasten: hochkant läuft die Zeit von oben nach unten, quer von links nach rechts */
  #bsSurface.seq { grid-template-columns:repeat(5,1fr); grid-auto-rows:1fr; gap:3px; }
  .bscell { border-radius:6px; background:rgba(255,255,255,.1); font-size:10px; display:flex; align-items:center; justify-content:center; overflow:hidden; color:rgba(255,255,255,.6); }
  .bscell.q { background:rgba(255,255,255,.2); }
  .bscell.on { background:#fff; color:#10141a; }
  .bscell.now { box-shadow:inset 0 0 0 2px #ffd60a; }
  @media (orientation:landscape) {
    #bsSurface.drums { grid-template-columns:repeat(3,1fr); grid-template-rows:1fr 1fr; }
    #bsSurface.bass, #bsSurface.perc { grid-template-columns:repeat(4,1fr); grid-template-rows:1fr; }
    #bsSurface.keys { grid-template-columns:repeat(10,1fr); grid-template-rows:1fr; }
    #bsSurface.keys .bspad { order:var(--o); }
    #bsSurface.seq { grid-auto-flow:column; grid-template-columns:none; grid-template-rows:repeat(5,1fr); grid-auto-columns:1fr; }
    #bsInsts { grid-template-columns:repeat(3,1fr); max-width:none; } .bsinst.wide { grid-column:auto; }
    .bsinst { padding:8px 6px; } .bsinst span { font-size:24px; }
  }
</style>
<!-- BANDSALAT: Instrument wählen -->
<div id="v-bspick" class="view">
  <div class="bar"><span class="word">🎶 Bandsalat</span></div>
  <div class="center">
    <div id="bsPickText" class="muted">Such dir ein Instrument aus</div>
    <div id="bsInsts"></div>
    <div id="bsHostBox">
      <button id="bsSlower" class="bschip">−</button><span id="bsBpm">80 BPM</span><button id="bsFaster" class="bschip">+</button>
      <button id="bsClear" class="bschip">🧹 Alles aus</button>
      <button id="bsFinale" class="bschip" style="background:#ffd60a; color:#10141a">🎬 Finale</button>
    </div>
    <button id="bsAgain" class="btn go" style="display:none; width:100%; max-width:460px; flex:0; font-size:20px">🔁 Zugabe</button>
  </div>
</div>
<!-- BANDSALAT: spielen -->
<div id="v-bsplay" class="view">
  <div class="bar">
    <button id="bsBack" class="bschip">◀</button>
    <span id="bsChord" class="word"></span>
    <span id="bsBeat"><i class="one"></i><i></i><i></i><i></i></span>
  </div>
  <div id="bsOpts"></div>
  <div id="bsSurface"></div>
  <div id="bsLoopBar">
    <button id="bsRec" class="bschip">⏺ Loop aufnehmen</button>
    <span id="bsLens" style="display:flex; gap:6px"></span>
    <span id="bsLoops" style="display:flex; gap:6px; flex-wrap:wrap"></span>
  </div>
  <div id="bsStatus" class="muted" style="text-align:center; padding:0 10px 8px; min-height:18px"></div>
</div>`);
  VIEWS.push('bspick', 'bsplay');

  // pads in the order they sit on the phone: [n, label, emoji]
  const INST = {
    drums: { emo: '🥁', name: 'Schlagzeug', hint: 'sechs Flächen', tint: '#3d1c1c',
      pads: [[4, 'Tom', '🥁'], [5, 'Becken', '💥'], [2, 'Hi-Hat', '🎩'], [3, 'Hi-Hat offen', '🎩'], [0, 'Bassdrum', '🦶'], [1, 'Snare', '🥁']] },
    keys: { emo: '🎹', name: 'Keyboard', hint: 'fünf Klänge', tint: '#1a2748', hold: true, glide: true,
      pads: [5, 6, 7, 8, 9, 0, 1, 2, 3, 4].map(n => [n, '', '']) },
    bass: { emo: '🎸', name: 'Bass', hint: 'folgt den Akkorden', tint: '#2c1b47', hold: true,
      pads: [[4, 'Oktave', ''], [3, 'Würze', ''], [0, 'Grundton', ''], [2, 'Quinte', '']] },
    perc: { emo: '🔔', name: 'Rassel-Kiste', hint: 'Shaker & Co.', tint: '#3d3312',
      pads: [[2, 'Kuhglocke', '🔔'], [3, 'Klatschen', '👏'], [0, 'Shaker (wischen)', '🧂'], [1, 'Tamburin', '✨']] },
    seq: { emo: '🎛️', name: 'Baukasten', hint: 'Beat und Töne zum An- und Abwählen', tint: '#103434', wide: true }
  };
  const KEY_SOUNDS = [['piano', 'Klavier'], ['epiano', 'E-Piano'], ['orgel', 'Orgel'], ['synth', 'Synth'], ['glocken', 'Glocken']];
  const TONE_SOUNDS = [['pling', 'Pling'], ['synth', 'Synth'], ['bass', 'Bass']];
  const SEQ_LABELS = { beat: ['HH offen', 'Hi-Hat', 'Clap', 'Snare', 'Kick'], tone: ['hoch', '', '', '', 'tief'] };
  const WIPE = 26;                    // px of wiping per shaker hit
  const KEYS = 'asdfghjkl;';          // computer keyboard for testing at the desk

  const toScreen = (m) => ac.message(AirConsole.SCREEN, m);
  const vib = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
  const playing = () => $('v-bsplay').classList.contains('on');
  const chip = (cls, data, text, sel) => '<button class="bschip ' + cls + (sel ? ' sel' : '') + '" ' + data + '>' + text + '</button>';

  let me = null, bar = null, built = null, seqTab = 'beat', grids = { beat: [], tone: [] };
  let recAt = 0, recEnd = 0, timer = null, shownBeat = -1, shownCol = -1, statusUntil = 0;

  // ---------- Instrument wählen, Host ----------
  $('bsInsts').innerHTML = Object.keys(INST).map(k => '<button class="bsinst' + (INST[k].wide ? ' wide' : '') + '" data-inst="' + k + '"><span>' + INST[k].emo + '</span>' + INST[k].name + '<small>' + INST[k].hint + '</small></button>').join('');
  $('bsInsts').addEventListener('click', (e) => { const b = e.target.closest('.bsinst'); if (b) toScreen({ t: 'bsPick', inst: b.dataset.inst }); });
  $('bsBack').addEventListener('click', () => { letGo(); toScreen({ t: 'bsPick', inst: null }); });
  $('bsSlower').addEventListener('click', () => toScreen({ t: 'bsTempo', d: -1 }));
  $('bsFaster').addEventListener('click', () => toScreen({ t: 'bsTempo', d: 1 }));
  $('bsClear').addEventListener('click', () => toScreen({ t: 'bsClear' }));
  $('bsFinale').addEventListener('click', () => toScreen({ t: 'bsFinale' }));
  $('bsAgain').addEventListener('click', () => toScreen({ t: 'bsAgain' }));

  // ---------- Spielfläche bauen ----------
  function buildSeq() {
    const g = grids[seqTab], lab = SEQ_LABELS[seqTab];
    let h = '';
    for (let s = 0; s < 16; s++) for (let r = 0; r < 5; r++)
      h += '<div class="bscell' + (s % 4 === 0 ? ' q' : '') + (g[r * 16 + s] ? ' on' : '') + '" data-r="' + r + '" data-s="' + s + '">' + (s === 0 ? lab[r] : '') + '</div>';
    $('bsSurface').innerHTML = h;
    shownCol = -1;
  }
  function build() {
    const k = me.inst, I = INST[k], sf = $('bsSurface');
    letGo();
    sf.className = k;
    if (k === 'seq') buildSeq();
    else sf.innerHTML = I.pads.map(([n, label, emo]) => '<div class="bspad" data-n="' + n + '" style="--o:' + n + '"' + (k === 'perc' && n === 0 ? ' data-wipe="1"' : '') + '>' + (emo ? '<span>' + emo + '</span>' : '') + label + '</div>').join('');
    built = k;
    $('bsBack').textContent = '◀ ' + I.emo;
    try { document.body.style.background = I.tint; } catch (e) {}
    $('bsLoopBar').style.display = k === 'seq' ? 'none' : 'flex';
    lightKeys();
  }
  function opts() {
    const k = me.inst;
    let h = '';
    if (k === 'keys') h = KEY_SOUNDS.map(([v, l]) => chip('bssound', 'data-v="' + v + '"', l, me.sound === v)).join('')
      + chip('bsoct', 'data-d="-1"', '▼', false) + '<span class="muted">Oktave ' + (me.oct > 0 ? '+' : '') + me.oct + '</span>' + chip('bsoct', 'data-d="1"', '▲', false);
    else if (k === 'seq') h = chip('bstab', 'data-k="beat"', '🥁 Beat', seqTab === 'beat') + chip('bstab', 'data-k="tone"', '🎵 Töne', seqTab === 'tone')
      + (seqTab === 'tone' ? TONE_SOUNDS.map(([v, l]) => chip('bstone', 'data-v="' + v + '"', l, me.seq.sound === v)).join('') : '')
      + chip('bspreset', '', '✨ Vorlage', false) + chip('bsempty', '', '🧹 Leeren', false);
    $('bsOpts').innerHTML = h;
    $('bsOpts').style.display = h ? 'flex' : 'none';
  }
  $('bsOpts').addEventListener('click', (e) => {
    const b = e.target.closest('.bschip');
    if (!b || !me) return;
    if (b.classList.contains('bssound')) { me.sound = b.dataset.v; toScreen({ t: 'bsSet', sound: me.sound }); }
    else if (b.classList.contains('bsoct')) { me.oct = Math.max(-1, Math.min(1, me.oct + +b.dataset.d)); letGo(); toScreen({ t: 'bsSet', oct: me.oct }); }
    else if (b.classList.contains('bstab')) { seqTab = b.dataset.k; buildSeq(); }
    else if (b.classList.contains('bstone')) { me.seq.sound = b.dataset.v; toScreen({ t: 'bsSeqSound', s: me.seq.sound }); }
    else if (b.classList.contains('bspreset')) toScreen({ t: 'bsSeqPreset', k: seqTab });
    else if (b.classList.contains('bsempty')) toScreen({ t: 'bsSeqClear', k: seqTab });
    opts();
  });
  function lightKeys() {
    if (built !== 'keys' || !bar) return;
    $('bsSurface').querySelectorAll('.bspad').forEach(p => p.classList.toggle('hi', bar.hi.includes(+p.dataset.n)));
  }

  // ---------- Looper ----------
  function loopBar() {
    $('bsLens').innerHTML = [1, 2, 4].map(n => chip('bslen', 'data-len="' + n + '"', n + (n === 1 ? ' Takt' : ' Takte'), me.len === n)).join('');
    $('bsLoops').innerHTML = me.loops.map(l => chip('bsloop', 'data-id="' + l.id + '"', (INST[l.inst] ? INST[l.inst].emo : '🔁') + ' ' + l.bars + 'T ✕', false)).join('');
    recLabel();
  }
  function recLabel() {
    const b = $('bsRec'), now = performance.now(), r = me && me.rec;
    b.classList.toggle('armed', !!r && now < recAt); b.classList.toggle('rec', !!r && now >= recAt);
    if (!r) b.textContent = me && me.full ? '🔁 Drei Loops laufen (✕ zum Löschen)' : '⏺ Loop aufnehmen';
    else if (now < recAt) b.textContent = '⏺ gleich… ' + Math.max(1, Math.ceil((recAt - now) / ((bar ? bar.stepMs : 150) * 4))) + ' (abbrechen)';
    else b.textContent = '⏺ Aufnahme läuft… ' + Math.max(0, Math.ceil((recEnd - now) / 1000)) + ' s';
  }
  $('bsRec').addEventListener('click', () => toScreen({ t: 'bsRec' }));
  $('bsLens').addEventListener('click', (e) => { const b = e.target.closest('.bslen'); if (b && me) { me.len = +b.dataset.len; toScreen({ t: 'bsSet', len: me.len }); loopBar(); } });
  $('bsLoops').addEventListener('click', (e) => { const b = e.target.closest('.bsloop'); if (b) toScreen({ t: 'bsDel', id: +b.dataset.id }); });
  function status(text, ms) { $('bsStatus').textContent = text; statusUntil = performance.now() + (ms || 3000); }

  // ---------- Flächen: mehrere Finger, Gleiten übers Keyboard, Wischen auf dem Shaker ----------
  const fingers = {}, count = new Map();
  function down(pad) {
    const c = (count.get(pad) || 0) + 1, I = INST[built];
    count.set(pad, c);
    if (c > 1 && I.hold) return;
    pad.classList.add('on'); vib(10);
    toScreen({ t: 'bsOn', n: +pad.dataset.n });
  }
  function up(pad) {
    const c = (count.get(pad) || 1) - 1;
    count.set(pad, c);
    if (c > 0) return;
    pad.classList.remove('on');
    if (INST[built] && INST[built].hold) toScreen({ t: 'bsOff', n: +pad.dataset.n });
  }
  function letGo() { for (const id in fingers) { up(fingers[id].pad); delete fingers[id]; } count.clear(); }
  function toggle(cell) {
    const r = +cell.dataset.r, s = +cell.dataset.s, on = grids[seqTab][r * 16 + s] ? 0 : 1;
    grids[seqTab][r * 16 + s] = on;
    cell.classList.toggle('on', !!on); vib(8);
    toScreen({ t: 'bsCell', k: seqTab, r, s, on });
  }
  function press(id, target, x, y) {
    if (!target || !target.closest) return;
    const cell = target.closest('.bscell'), pad = target.closest('.bspad');
    if (cell) toggle(cell);
    else if (pad && !fingers[id]) { fingers[id] = { pad, x, y, d: 0 }; down(pad); }
  }
  function drag(id, x, y) {
    const f = fingers[id];
    if (!f) return;
    if (f.pad.dataset.wipe) {
      f.d += Math.hypot(x - f.x, y - f.y); f.x = x; f.y = y;
      if (f.d >= WIPE) { f.d = 0; toScreen({ t: 'bsOn', n: +f.pad.dataset.n }); }
    } else if (INST[built].glide && document.elementFromPoint) {
      const el = document.elementFromPoint(x, y), p = el && el.closest ? el.closest('.bspad') : null;
      if (p && p !== f.pad) { up(f.pad); f.pad = p; down(p); }
    }
  }
  function lift(id) { const f = fingers[id]; if (f) { up(f.pad); delete fingers[id]; } }
  const sf = $('bsSurface');
  sf.addEventListener('touchstart', (e) => { e.preventDefault(); for (const t of e.changedTouches) press('t' + t.identifier, t.target || e.target, t.clientX, t.clientY); });
  sf.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) drag('t' + t.identifier, t.clientX, t.clientY); });
  const end = (e) => { e.preventDefault(); for (const t of e.changedTouches) lift('t' + t.identifier); };
  sf.addEventListener('touchend', end); sf.addEventListener('touchcancel', end);
  // Maus und Tastatur zum Testen am Rechner
  sf.addEventListener('mousedown', (e) => { e.preventDefault(); press('mouse', e.target, e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => drag('mouse', e.clientX, e.clientY));
  window.addEventListener('mouseup', () => lift('mouse'));
  const padOfKey = (key) => { const n = KEYS.indexOf(key.toLowerCase()); return n < 0 || !playing() ? null : sf.querySelector('.bspad[data-n="' + n + '"]'); };
  document.addEventListener('keydown', (e) => { const p = e.repeat ? null : padOfKey(e.key); if (p && !fingers['k' + e.key]) { fingers['k' + e.key] = { pad: p, d: 0 }; down(p); e.preventDefault(); } });
  document.addEventListener('keyup', (e) => lift('k' + e.key));
  window.addEventListener('blur', () => { if (playing()) letGo(); });

  // ---------- Takt: der Fernseher meldet jeden Taktstrich, dazwischen zählt das Handy selbst ----------
  function tick() {
    if (!playing() && !$('v-bspick').classList.contains('on')) {       // the song is over for this phone
      clearInterval(timer); timer = null;
      if ($('v-shelllobby').classList.contains('on')) { try { document.body.style.background = ''; } catch (e) {} }
      return;
    }
    const now = performance.now();
    if (statusUntil && now > statusUntil) { statusUntil = 0; $('bsStatus').textContent = ''; }
    if (!bar || !playing()) return;
    const col = Math.floor((now - bar.start) / bar.stepMs) % 16, beat = col >> 2;
    if (beat !== shownBeat) { shownBeat = beat; [...$('bsBeat').children].forEach((el, i) => el.classList.toggle('on', i === beat)); }
    if (built === 'seq' && col !== shownCol) {
      shownCol = col;
      sf.querySelectorAll('.bscell').forEach(c => c.classList.toggle('now', +c.dataset.s === col));
    }
    if (me && me.rec) recLabel();
  }

  function onYou(d) {
    me = d;
    $('v-bsplay').classList.toggle('host', !!d.host);
    $('bsHostBox').style.display = d.host && !d.over ? 'flex' : 'none';
    $('bsBpm').textContent = d.bpm + ' BPM';
    $('bsAgain').style.display = d.host && d.over ? 'block' : 'none';
    $('bsInsts').style.display = d.over ? 'none' : 'grid';
    grids = { beat: d.seq.beat.split('').map(Number), tone: d.seq.tone.split('').map(Number) };
    if (d.rec) { recAt = performance.now() + d.rec.inMs; recEnd = recAt + d.rec.lenMs; }
    if (d.over || !d.inst) {
      letGo();
      $('bsPickText').textContent = d.over ? '🎬 Das war\'s! Du hast ' + d.notes + (d.notes === 1 ? ' Ton' : ' Töne') + ' gespielt.' + (d.host ? '' : ' Der Host kann eine Zugabe starten.')
        : (d.style + ' · ' + (d.loops.length ? 'deine Loops laufen weiter' : 'such dir ein Instrument aus'));
      try { document.body.style.background = ''; } catch (e) {}
      built = null;
      if (d.over) vib([120, 60, 240]);
      showView('bspick');
      return;
    }
    if (built !== d.inst) build(); else if (d.inst === 'seq') buildSeq();
    opts(); loopBar();
    if (d.flash === 'loop') { status('🔁 Dein Loop läuft! Spiel drüber oder wechsle das Instrument.', 4000); vib([40, 40, 40]); }
    else if (d.flash === 'empty') status('Nichts gespielt, kein Loop.');
    if (!playing()) showView('bsplay');
  }

  registerGame({ key: 'bandsalat', controller: {
    activate() {
      me = null; bar = null; built = null; seqTab = 'beat'; shownBeat = shownCol = -1;
      $('bsStatus').textContent = ''; $('bsPickText').textContent = 'Such dir ein Instrument aus';
      $('bsHostBox').style.display = 'none'; $('bsAgain').style.display = 'none'; $('bsInsts').style.display = 'grid';
      try { document.body.style.background = ''; } catch (e) {}
      if (!timer) timer = setInterval(tick, 40);
      showView('bspick');
      toScreen({ t: 'bsHello' });            // the screen answers with who we are in the band and where the bar is
    },
    onMessage(d) {
      if (d.t === 'bsYou') onYou(d);
      else if (d.t === 'bsBar') {
        bar = d; bar.start = performance.now() - d.pos * d.stepMs;
        $('bsChord').textContent = d.chord + ' → ' + d.next;
        lightKeys();
      }
    }
  } });
})();
