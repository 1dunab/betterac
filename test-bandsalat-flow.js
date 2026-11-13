// Bandsalat end to end: the real shell + real controllers in JSDOM. JSDOM has no WebAudio, so the synth gets a
// fake AudioContext that swallows everything: its code runs, nothing sounds.
// Checks picking instruments, pads, held keys, the step grid, recording a loop, host controls, joining and
// leaving mid-song, a phone reload, the finale and the encore.
const { makeDom, makeBus, visible } = require('./test-helpers');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(5); }
  fail('Timeout: ' + what); return false;
}

const SPEED = 4;   // the screen's clock runs 4× faster: a techno bar takes half a second
const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const cs = {};
function addPhone(l) {
  cs[l] = makeDom('controller.html', 'controller', bus, l);
  cs[l].window.HTMLMediaElement.prototype.play = () => Promise.resolve();   // the wake-lock video: JSDOM cannot play
  const h = bus.handlers[l], orig = h.deliver; h.inbox = [];
  h.deliver = (m) => { if (m.type === 'message') h.inbox.push(m.data); orig(m); };
  return phone(l);
}
const phone = (l) => ({
  l, get id() { return bus.handlers[l]._id; }, dom: cs[l], $: (id) => cs[l].window.document.getElementById(id),
  q: (sel) => cs[l].window.document.querySelector(sel), qa: (sel) => [...cs[l].window.document.querySelectorAll(sel)],
  all: (t) => bus.handlers[l].inbox.filter(m => m.t === t),
  last(t) { return this.all(t).pop(); },
  send: (data) => bus.fromClient(l, JSON.stringify({ type: 'message', to: 0, data })),
  touch(el, type, x, y, finger) {
    const w = cs[l].window, e = new w.Event(type, { bubbles: true, cancelable: true });
    e.changedTouches = [{ identifier: finger || 7, clientX: x || 0, clientY: y || 0 }];
    el.dispatchEvent(e);
  },
  pad(n) { return this.q('#bsSurface .bspad[data-n="' + n + '"]'); },
  cell(r, s) { return this.q('#bsSurface .bscell[data-r="' + r + '"][data-s="' + s + '"]'); },
  tap(n) { this.touch(this.pad(n), 'touchstart'); this.touch(this.pad(n), 'touchend'); },
  pick(inst) { this.q('#bsInsts .bsinst[data-inst="' + inst + '"]').click(); },
  key(type, key) { const w = cs[l].window; w.document.dispatchEvent(new w.KeyboardEvent(type, { key, bubbles: true, cancelable: true })); }
});
const join = (p, name) => { p.$('nameInput').value = name; p.$('joinBtn').click(); };

// an AudioContext that accepts every call and plays nothing
function fakeAudio(w) {
  const any = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : any), set: () => true, apply: () => any });
  const ctx = new Proxy({}, { get: (t, k) => (k === 'currentTime' ? w.performance.now() / 1000 : k === 'sampleRate' ? 8 : any) });
  return { ctx, out: any };
}

(async () => {
  const [p1, p2, p3] = ['c1', 'c2', 'c3'].map(addPhone);
  await sleep(100);
  const w = screen.window;
  check(w.BandMusic && w.BandSynth && typeof w.sfx.audio === 'function', 'music.js and synth.js are loaded on the screen page, sfx hands out its audio');
  check(w.sfx.audio() === null, 'without WebAudio there is no audio, and nothing breaks');
  const real = w.performance.now.bind(w.performance), t0 = real();
  w.performance.now = () => t0 + (real() - t0) * SPEED;
  const audio = fakeAudio(w);
  w.sfx.audio = () => audio;
  const reported = [];
  const origReport = w.reportWinners;
  w.reportWinners = (ids) => { reported.push(ids); origReport(ids); };

  // ---- lobby → pick an instrument ----
  join(p1, 'Anna'); join(p2, 'Ben'); join(p3, 'Cleo');
  await sleep(100);
  const picker = () => [...p1.dom.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '🎶 Bandsalat');
  check(!!picker(), 'Bandsalat is in the game picker');
  picker().click(); await sleep(60);
  p1.send({ t: 'shellConfig', game: 'bandsalat', cfg: { stil: 'techno', raster: '16', begleitung: 'aus' } });
  await sleep(40);
  p1.$('startBtn').click();
  await sleep(150);
  const dbg = () => w.eval('active && active._debug()');
  const st = () => dbg().state;
  const pl = (p) => st().players[p.id];
  check(dbg() && st().styleKey === 'techno' && st().grid === 1 && st().backing === 'off', 'start: the band plays in the chosen style');
  check(st().order.length === 3 && [p1, p2, p3].every(p => visible(p.dom) === 'v-bspick'), 'three players, all phones show the instruments');
  check(p1.qa('#bsInsts .bsinst').length === 5, 'five instruments to choose from');
  check(p1.$('bsHostBox').style.display === 'flex' && p2.$('bsHostBox').style.display === 'none', 'only the host gets tempo, broom and finale');
  check(p1.last('bsYou').host === true && p2.last('bsYou').host === false && p1.last('bsYou').inst === null, 'bsYou: host, no instrument yet');
  await until(() => dbg().synth, 2000, 'the synth is built once audio is there');

  // ---- drums: one-shots ----
  p1.pick('drums'); await sleep(40);
  check(visible(p1.dom) === 'v-bsplay' && pl(p1).inst === 'drums' && p1.qa('#bsSurface .bspad').length === 6, 'Anna takes the drums: six pads');
  p1.touch(p1.pad(0), 'touchstart');
  check(p1.pad(0).classList.contains('on') && pl(p1).notes === 1 && dbg().shown.some(n => n.owner === p1.id && n.v === 'kick'), 'a finger on the bass drum: a kick on the stage');
  p1.touch(p1.pad(1), 'touchstart', 0, 0, 8);
  check(pl(p1).notes === 2 && dbg().shown.some(n => n.v === 'snare'), 'a second finger at the same time: the snare');
  p1.touch(p1.pad(0), 'touchend'); p1.touch(p1.pad(1), 'touchend', 0, 0, 8);
  check(!p1.pad(0).classList.contains('on') && p1.all('bsBar').length > 0 && /→/.test(p1.$('bsChord').textContent), 'the phone knows the chord and the next one');
  p1.send({ t: 'bsOn', n: 99 }); p1.send({ t: 'bsOn' }); p1.send({ t: 'bsOn', n: 'x' });
  check(pl(p1).notes <= 3, 'nonsense from a phone plays nothing unexpected');

  // ---- keyboard: held notes, sound, octave ----
  p2.pick('keys'); await sleep(40);
  check(visible(p2.dom) === 'v-bsplay' && p2.qa('#bsSurface .bspad').length === 10 && p2.qa('#bsOpts .bssound').length === 5, 'Ben takes the keyboard: ten keys, five sounds');
  check(p2.qa('#bsSurface .bspad.hi').length >= 2, 'the keys of the current chord are lit');
  p2.q('#bsOpts .bssound[data-v="orgel"]').click();
  p2.q('#bsOpts .bsoct[data-d="1"]').click();
  await sleep(30);
  check(pl(p2).sound === 'orgel' && pl(p2).oct === 1 && p2.q('#bsOpts .bssound.sel').dataset.v === 'orgel', 'organ, one octave up');
  p2.touch(p2.pad(3), 'touchstart');
  check(pl(p2).held[3] && dbg().holds[p2.id + ':3'] && dbg().synth.held.length === 1, 'a key held: the note sounds on');
  const note = dbg().shown.find(n => n.owner === p2.id);
  check(note.sound === 'orgel' && note.midi === w.BandMusic.keyMidi(st().style, 3, 1), 'in that sound and octave');
  p2.touch(p2.pad(3), 'touchend');
  check(!pl(p2).held[3] && !dbg().holds[p2.id + ':3'] && dbg().synth.held.length === 0, 'finger up: the note ends');
  p2.key('keydown', 'a'); check(pl(p2).held[0], 'computer keyboard: A plays the first key');
  p2.key('keyup', 'a'); check(!pl(p2).held[0], 'and lets go');
  p2.touch(p2.pad(1), 'touchstart'); p2.touch(p2.pad(2), 'touchstart', 0, 0, 8);
  p2.$('bsBack').click(); await sleep(40);
  check(visible(p2.dom) === 'v-bspick' && pl(p2).inst === null && Object.keys(pl(p2).held).length === 0 && dbg().synth.held.length === 0, 'back to the instruments: nothing keeps ringing');
  p2.pick('bass'); await sleep(40);
  check(pl(p2).inst === 'bass' && p2.qa('#bsSurface .bspad').length === 4, 'Ben switches to the bass: four pads');
  p2.tap(0);
  check(dbg().shown.some(n => n.owner === p2.id && n.inst === 'bass' && n.midi === w.BandMusic.bassMidi(st().style, st().bar % 4, 0)), 'the bass plays the root of the current chord');

  // ---- the step grid ----
  p3.pick('seq'); await sleep(40);
  check(visible(p3.dom) === 'v-bsplay' && p3.qa('#bsSurface .bscell').length === 80 && p3.$('bsLoopBar').style.display === 'none', 'Cleo opens the step grid: 5 × 16 cells, no looper');
  p3.touch(p3.cell(4, 0), 'touchstart');
  check(p3.cell(4, 0).classList.contains('on') && pl(p3).seq.beat[4 * 16] === 1, 'a cell switched on');
  await until(() => dbg().shown.some(n => n.owner === p3.id && n.src === 'seq' && n.v === 'kick'), 3000, 'the pattern plays');
  p3.touch(p3.cell(4, 0), 'touchstart');
  check(!p3.cell(4, 0).classList.contains('on') && pl(p3).seq.beat[4 * 16] === 0, 'and off again');
  p3.q('#bsOpts .bspreset').click(); await sleep(40);
  check(p3.qa('#bsSurface .bscell.on').length >= 6 && pl(p3).seq.beat.filter(Boolean).length === p3.qa('#bsSurface .bscell.on').length, 'a ready-made beat fills the grid');
  p3.q('#bsOpts .bstab[data-k="tone"]').click();
  check(p3.qa('#bsSurface .bscell.on').length === 0 && p3.qa('#bsOpts .bstone').length === 3, 'the tone page is empty and offers three sounds');
  p3.touch(p3.cell(0, 5), 'touchstart');
  p3.q('#bsOpts .bstone[data-v="bass"]').click(); await sleep(30);
  check(pl(p3).seq.tone[5] === 1 && pl(p3).seq.sound === 'bass', 'a tone set, played as a bass');
  p3.q('#bsOpts .bsempty').click(); await sleep(40);
  check(pl(p3).seq.tone.every(x => !x) && pl(p3).seq.beat.some(Boolean) && p3.qa('#bsSurface .bscell.on').length === 0, 'the broom clears this page only');
  p3.send({ t: 'bsCell', k: 'beat', r: 9, s: 99, on: 1 }); p3.send({ t: 'bsCell', k: 'nope', r: 0, s: 0, on: 1 });
  check(pl(p3).seq.beat.length === 80, 'cells outside the grid are refused');

  // ---- record a loop ----
  p1.$('bsRec').click(); await sleep(30);
  check(pl(p1).rec && !pl(p1).rec.on && p1.last('bsYou').rec && p1.$('bsRec').classList.contains('armed'), '⏺: armed, waiting for the bar line');
  await until(() => pl(p1).rec && pl(p1).rec.on, 3000, 'recording starts');
  await sleep(30);
  check(p1.last('bsYou').rec.on === true, 'the phone is told that it runs');
  p1.tap(0); await sleep(130); p1.tap(1);
  await until(() => !pl(p1).rec, 3000, 'recording ends');
  await sleep(30);
  check(st().loops.length === 1 && st().loops[0].owner === p1.id && st().loops[0].events.length === 2, 'one bar later the recording is a loop with both hits');
  check(p1.qa('#bsLoops .bsloop').length === 1 && /Loop läuft/.test(p1.$('bsStatus').textContent), 'the phone shows the loop');
  await until(() => dbg().shown.some(n => n.owner === p1.id && n.src === 'loop'), 3000, 'the loop plays by itself');
  p1.$('bsBack').click(); await sleep(40); p1.pick('perc'); await sleep(40);
  check(pl(p1).inst === 'perc' && st().loops.length === 1 && p1.qa('#bsLoops .bsloop').length === 1, 'Anna switches to the shaker box, her drum loop plays on');
  const before = pl(p1).notes;
  p1.touch(p1.pad(0), 'touchstart', 10, 10);
  for (let x = 20; x <= 200; x += 10) p1.touch(p1.pad(0), 'touchmove', x, 10);
  p1.touch(p1.pad(0), 'touchend', 200, 10);
  check(pl(p1).notes > before, 'wiping over the shaker rattles');
  p2.send({ t: 'bsDel', id: st().loops[0].id }); await sleep(30);
  check(st().loops.length === 1, 'nobody else can delete her loop');
  p1.q('#bsLoops .bsloop').click(); await sleep(40);
  check(st().loops.length === 0 && p1.qa('#bsLoops .bsloop').length === 0, 'a tap on the loop deletes it');
  p3.send({ t: 'bsRec' }); await sleep(30);
  check(!pl(p3).rec, 'the step grid cannot record');

  // ---- host controls ----
  p2.send({ t: 'bsTempo', d: 1 }); p2.send({ t: 'bsClear' }); p2.send({ t: 'bsFinale' }); await sleep(30);
  check(dbg().band.tr.bpm === 126 && pl(p3).seq.beat.some(Boolean) && st().finalAt === null, 'a guest cannot change tempo, clear or end the song');
  p1.$('bsBack').click(); await sleep(40);
  p1.$('bsFaster').click(); await sleep(40);
  check(dbg().band.tr.bpm === 130 && p1.$('bsBpm').textContent === '130 BPM' && p2.last('bsBar').bpm === 130, 'the host speeds up, the phones follow');
  p1.$('bsClear').click(); await sleep(40);
  check(!pl(p3).seq.beat.some(Boolean) && p3.qa('#bsSurface .bscell.on').length === 0, 'the host\'s broom clears every pattern, also on the phones');

  // ---- joining, reloading and leaving in the middle of the song ----
  const p4 = addPhone('c4');
  await sleep(100); join(p4, 'Dino'); await sleep(150);
  check(visible(p4.dom) === 'v-bspick' && pl(p4) && st().order.length === 4, 'Dino comes later and picks an instrument');
  p4.pick('keys'); await sleep(40); p4.tap(2);
  check(pl(p4).notes === 1, 'and plays along');
  const n0 = p2.all('bsYou').length;
  p2.send({ t: 'shellSync' }); await sleep(60);
  check(p2.all('bsYou').length > n0 && visible(p2.dom) === 'v-bsplay' && p2.last('bsYou').inst === 'bass', 'a reloaded phone gets its instrument back');
  p3.touch(p3.cell(4, 0), 'touchstart'); await sleep(20);
  bus.disconnect('c3'); await sleep(80);
  check(w.eval('active') !== null && !pl(p3) && st().order.length === 3, 'Cleo leaves: the band plays on without her pattern');

  // ---- finale and encore ----
  p1.$('bsFinale').click(); await sleep(30);
  check(st().finalAt !== null && !st().over, 'the host calls the finale: the song ends on the next bar line');
  await until(() => st().over, 3000, 'over');
  await sleep(60);
  check(dbg().shown.some(n => n.src === 'finale'), 'a last chord');
  check([p1, p2, p4].every(p => visible(p.dom) === 'v-bspick' && /Das war/.test(p.$('bsPickText').textContent)), 'the phones say goodbye');
  check(p1.$('bsAgain').style.display === 'block' && p2.$('bsAgain').style.display === 'none' && p1.$('bsInsts').style.display === 'none', 'only the host can start an encore');
  check(reported.length === 0, 'nobody wins a jam');
  p2.send({ t: 'bsAgain' }); await sleep(40);
  check(st().over, 'bsAgain from a guest is ignored');
  const played = pl(p2).notes;
  p2.send({ t: 'bsOn', n: 0 });
  check(pl(p2).notes === played && played === 5, 'after the end the pads are silent');
  p1.$('bsAgain').click(); await sleep(80);
  check(!st().over && st().order.length === 3 && pl(p2).inst === 'bass' && visible(p2.dom) === 'v-bsplay' && pl(p2).notes === 0, 'encore: a fresh song, everybody keeps their instrument');
  check(visible(p1.dom) === 'v-bspick' && p1.$('bsInsts').style.display === 'grid', 'who had none picks one');

  // ---- abort, and everybody leaving ----
  p1.$('abortBtn').click(); await sleep(150);
  check(w.eval('active') === null && visible(p1.dom) === 'v-shelllobby', 'abort → lobby');
  p1.$('startBtn').click(); await sleep(150);
  check(w.eval('active') !== null, 'started again');
  for (const l of ['c2', 'c4']) bus.disconnect(l);
  await sleep(80);
  check(w.eval('active') !== null && st().order.length === 1, 'one player is enough for a band');
  bus.disconnect('c1'); await sleep(100);
  check(w.eval('active') === null, 'nobody left → back to the lobby');

  console.log(process.exitCode ? '❌ Bandsalat-Flow fehlgeschlagen' : '✅ Alle Bandsalat-Flow-Checks bestanden');
  process.exit(process.exitCode || 0);
})();
