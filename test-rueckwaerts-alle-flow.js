// Rückwärtsgang end to end, mode "alle dasselbe Wort": the real shell + real controllers in JSDOM. JSDOM has no microphone and no WebAudio,
// so reading a recorded file is replaced by a stand-in that returns a made-up wave. The phone's own cutting,
// shrinking and packing (clip.js) runs for real, and so does the screen's unpacking.
// Checks a round with everybody recording at once, the show with applause, the result, and a round where
// they record one after the other.
const { makeDom, makeBus, visible } = require('./test-helpers');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(5); }
  fail('Timeout: ' + what); return false;
}

// 0.2 s of a tone between two stretches of silence, at 48 kHz, as a phone's recorder would deliver it
function tone(hz, amp) {
  const rate = 48000, x = new Float32Array(rate * 0.6);
  for (let i = rate * 0.2; i < rate * 0.4; i++) x[i] = (amp === undefined ? 0.3 : amp) * Math.sin(2 * Math.PI * hz * i / rate);
  return { x, rate };
}
const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const cs = {};
function addPhone(l) {
  cs[l] = makeDom('controller.html', 'controller', bus, l);
  const w = cs[l].window;
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();   // the wake-lock video: JSDOM cannot play
  w.Mic.audio = () => ({});
  w.__next = tone(300);
  w.Mic.decodeFile = async () => w.__next;
  const h = bus.handlers[l], orig = h.deliver; h.inbox = [];
  h.deliver = (m) => { if (m.type === 'message') h.inbox.push(m.data); orig(m); };
  return phone(l);
}
const phone = (l) => ({
  l, get id() { return bus.handlers[l]._id; }, dom: cs[l], $: (id) => cs[l].window.document.getElementById(id),
  qa: (sel) => [...cs[l].window.document.querySelectorAll(sel)],
  all: (t) => bus.handlers[l].inbox.filter(m => m.t === t),
  last(t) { return this.all(t).pop(); },
  send: (data) => bus.fromClient(l, JSON.stringify({ type: 'message', to: 0, data })),
  shown(id) { return this.$(id).style.display !== 'none'; },
  // the recorder app "returns" a file: the hidden input changes
  async record(clip, kind) {
    const w = cs[l].window, inp = w.document.querySelector('input[type=file][accept="' + (kind || 'audio') + '/*"]');
    w.__next = clip || tone(300);
    Object.defineProperty(inp, 'files', { value: [{ name: 'x.m4a', type: 'audio/x-m4a', size: 9 }], configurable: true });
    inp.dispatchEvent(new w.Event('change'));
    await sleep(40);
  }
});
const join = (p, name) => { p.$('nameInput').value = name; p.$('joinBtn').click(); };

(async () => {
  const [p1, p2, p3] = ['c1', 'c2', 'c3'].map(addPhone);
  await sleep(100);
  const w = screen.window;
  const reported = [];
  const origReport = w.reportWinners;
  w.reportWinners = (ids) => { reported.push(ids.slice()); origReport(ids); };
  const dbg = () => w.eval('active && active._debug()');
  const st = () => dbg().state;
  const all = [p1, p2, p3];
  const by = (id) => all.find(p => p.id === id);
  const idle = async () => { await until(() => !dbg().game.busy(w.performance.now()), 6000, 'the TV finishes playing'); await sleep(80); };
  const clap = (p) => { const e = new p.dom.window.Event('touchstart', { bubbles: true, cancelable: true }); p.$('rwClap').dispatchEvent(e); };
  const start = async (cfg) => { p1.send({ t: 'shellConfig', game: 'rueckwaerts', cfg }); await sleep(40); p1.$('startBtn').click(); await sleep(150); };

  join(p1, 'Anna'); join(p2, 'Ben'); join(p3, 'Cleo');
  await sleep(100);
  [...p1.dom.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '⏪ Rückwärtsgang').click(); await sleep(60);
  const settings = p1.$('gameSettings').textContent;
  check(/Alle dasselbe Wort/.test(settings) && /Alle nehmen zugleich auf/.test(settings) && /Wörter/.test(settings) && !/Runden/.test(settings), 'the settings offer the mode, how to record and how many words');
  p1.send({ t: 'shellConfig', game: 'rueckwaerts', cfg: { modus: 'einzeln' } }); await sleep(60);
  check(!/zugleich/.test(p1.$('gameSettings').textContent) && /Runden/.test(p1.$('gameSettings').textContent), 'the other mode has rounds instead');

  // ================= everybody at once =================
  await start({ modus: 'alle', aufnahme: 'zugleich', anzahl: 2, stufe: 'leicht', wertung: 'an' });
  check(dbg() && dbg().game.cfg.modus === 'alle' && st().phase.kind === 'say' && st().phase.round === 1, 'start: round one, somebody speaks the word');
  let sp = by(st().phase.id), rest = all.filter(p => p !== sp);
  check(/Du sprichst vor/.test(sp.$('rwText').textContent) && sp.$('rwWord').textContent === st().phase.word && sp.shown('rwRec') && !sp.$('rwRec').disabled, 'the speaker sees the word and can record');
  check(rest.every(p => !p.shown('rwRec') && /spricht vor/.test(p.$('rwText').textContent) && /nach/.test(p.$('rwSub').textContent)), 'the others are told to get ready');
  await rest[0].record();
  check(st().phase.kind === 'say', 'only the speaker\'s recording counts');
  await sp.record(tone(300));
  check(st().phase.kind === 'listen' && rest.every(p => /Hör gut zu/.test(p.$('rwText').textContent) && !p.shown('rwRec') && !p.shown('rwDone')), 'the word is in: everybody listens');
  check(sp.shown('rwDone') && sp.$('rwDone').disabled && sp.$('rwPlay').disabled, 'the speaker\'s "go" waits until the TV has played it');
  await idle();
  check(!sp.$('rwDone').disabled && /Los/.test(sp.$('rwDone').textContent) && !sp.$('rwPlay').disabled && sp.shown('rwAgain'), 'then the speaker can replay, say it again, or start');
  rest[0].send({ t: 'rwDone' }); await sleep(30);
  check(st().phase.kind === 'listen', 'nobody else can start');
  sp.$('rwDone').click(); await sleep(60);
  check(st().phase.kind === 'rec' && st().phase.turn === null, 'go: everybody records at once');
  check(all.every(p => p.shown('rwRec') && !p.$('rwRec').disabled && /Nachsprechen/.test(p.$('rwRec').textContent) && Number(p.$('rwClock').textContent) > 30), 'every phone has the record button and the clock');
  check(p1.shown('rwNext') && /0\/3/.test(p1.$('rwNext').textContent), 'the host sees how many are in');
  await rest[0].record(tone(400));
  check(st().phase.clips[rest[0].id] && /Aufnahme ist da/.test(rest[0].$('rwText').textContent) && /Nochmal/.test(rest[0].$('rwRec').textContent) && /1\/3/.test(p1.$('rwNext').textContent), 'a recording is in; that phone may still redo it');
  const firstRef = st().phase.clips[rest[0].id].ref;
  await rest[0].record(tone(420));
  check(st().phase.clips[rest[0].id].ref !== firstRef && !dbg().clips[firstRef], 'a second recording replaces the first');
  await rest[0].record(tone(400, 0));
  check(/nichts zu hören/.test(rest[0].$('rwNote').textContent) && st().phase.clips[rest[0].id], 'a silent one is refused, the good one stays');
  await sp.record(tone(380)); await rest[1].record(tone(500));
  await until(() => st().phase.kind === 'show', 5000, 'everybody delivered: the show');
  await sleep(60);

  // ---- the show ----
  check(st().phase.items.length === 3 && st().phase.i === 0, 'three imitations');
  let it = st().phase.items[0], owner = by(it.id), fans = all.filter(p => p !== owner);
  check(!owner.shown('rwClap') && /Das bist du/.test(owner.$('rwText').textContent) && fans.every(p => p.shown('rwClap') && p.$('rwText').textContent.includes(owner === p1 ? 'Anna' : owner === p2 ? 'Ben' : 'Cleo')), 'everybody but its owner gets the clap button and sees whose it is');
  check(all.every(p => !p.shown('rwRec')), 'no recording during the show');
  clap(fans[0]); clap(fans[0]); clap(fans[1]); owner.send({ t: 'rwClap' });
  await sleep(40);
  check(it.total === 3 && it.claps[fans[0].id] === 2 && !it.claps[owner.id], 'every tap is a clap, none for yourself');
  const states = fans[1].all('rwState').length;
  for (let i = 0; i < 6; i++) clap(fans[0]);
  await sleep(40);
  check(fans[1].all('rwState').length === states && it.total === 9, 'clapping does not flood the phones with messages');
  p1.$('rwNext').click(); await sleep(60);
  check(st().phase.i === 1, 'the host moves on');
  await until(() => st().phase.i === 2, 9000, 'the next one comes by itself');
  p1.$('rwNext').click(); await sleep(80);

  // ---- the result, and round two ----
  check(st().phase.kind === 'result' && st().score[it.id] === 9, 'after the last one: the result, applause is the score');
  check(/meisten Applaus/.test(owner.$('rwText').textContent) && fans.every(p => /für dich/.test(p.$('rwText').textContent)), 'the phones tell who got the most');
  p2.send({ t: 'rwNext' }); await sleep(30);
  check(st().phase.kind === 'result', 'a guest cannot move on');
  p1.$('rwNext').click(); await sleep(80);
  const sp2 = by(st().phase.id);
  check(st().phase.kind === 'say' && st().phase.round === 2 && sp2 !== sp, 'round two: another speaker');
  // a phone reloads in the middle of recording
  await sp2.record(tone(300)); p1.$('rwNext').click(); await sleep(60);
  check(st().phase.kind === 'rec', 'the host starts the recording for the speaker');
  const other = all.find(p => p !== sp2);
  await other.record(tone(450));
  const n0 = other.all('rwState').length;
  other.send({ t: 'shellSync' }); await sleep(80);
  check(other.all('rwState').length > n0 && visible(other.dom) === 'v-rueckwaerts' && other.last('rwState').done === true && /Aufnahme ist da/.test(other.$('rwText').textContent), 'a reloaded phone knows its recording is already in');
  p1.$('rwNext').click(); await sleep(80);
  check(st().phase.kind === 'show' && st().phase.items.length === 1, 'the host stops waiting: the show with what there is');
  p1.$('rwNext').click(); await sleep(60); p1.$('rwNext').click(); await sleep(100);
  check(st().over && reported.length === 1 && reported[0].join() === String(it.id), 'after the last word: over, the most applause wins the evening point');
  check(/gewonnen/.test(owner.$('rwText').textContent) && /9 👏/.test(owner.$('rwSub').textContent) && p1.shown('rwRestart'), 'the phones know');
  p1.$('abortBtn').click(); await sleep(150);

  // ================= one after the other =================
  await start({ modus: 'alle', aufnahme: 'reihum', anzahl: 1, woerter: 'frei', wertung: 'aus' });
  sp = by(st().phase.id);
  check(/ein Wort oder einen kurzen Satz/.test(sp.$('rwWord').textContent), 'own words: the speaker says what they like');
  await sp.record(tone(300)); await idle();
  sp.$('rwDone').click(); await sleep(60);
  check(st().phase.kind === 'rec' && st().phase.turn !== null, 'one after the other');
  for (let k = 0; k < 3; k++) {
    const turn = by(st().phase.turn), waiting = all.filter(p => p !== turn && !st().phase.clips[p.id]);
    check(turn.shown('rwRec') && !turn.$('rwRec').disabled && waiting.every(p => !p.shown('rwRec') && /nimmt auf/.test(p.$('rwText').textContent)), 'turn ' + (k + 1) + ': one phone records, the others wait');
    if (waiting.length) { await waiting[0].record(tone(350)); check(!st().phase.clips[waiting[0].id], 'out of turn nothing is taken'); }
    await turn.record(tone(350 + k * 40));
  }
  check(st().phase.kind === 'show' && st().phase.items.length === 3, 'all three are in: the show');
  for (let i = 0; i < 4 && st().phase.kind === 'show'; i++) { p1.$('rwNext').click(); await sleep(50); }
  check(st().phase.kind === 'result', 'result');
  p1.$('rwNext').click(); await sleep(80);
  check(st().over && reported.length === 1 && !/gewonnen/.test(p1.$('rwText').textContent + p2.$('rwText').textContent + p3.$('rwText').textContent), 'scoring off: nobody wins');

  // ---- leaving ----
  p1.$('rwRestart').click(); await sleep(80);
  const sp3 = by(st().phase.id);
  bus.disconnect(sp3.l); await sleep(80);
  check(w.eval('active') !== null && st().phase.kind === 'say' && st().phase.id !== sp3.id && st().phase.round === 1, 'the speaker leaves: somebody else speaks');
  for (const p of all.filter(p => p !== sp3)) bus.disconnect(p.l);
  await sleep(100);
  check(w.eval('active') === null, 'nobody left → back to the lobby');

  console.log(process.exitCode ? '❌ Rückwärtsgang-Flow (alle) fehlgeschlagen' : '✅ Alle Rückwärtsgang-Flow-Checks (alle dasselbe Wort) bestanden');
  process.exit(process.exitCode || 0);
})();
