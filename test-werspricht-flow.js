// "Wer spricht da?" end to end: the real shell + real controllers in JSDOM. JSDOM has no microphone and no
// WebAudio, so reading a recorded file is replaced by a stand-in that returns a made-up wave; the phone's own
// cutting and packing (core/voiceclip.js) runs for real.
// Checks recording, guessing with name buttons, the reveal, points, the host's buttons, a reload and leaving.
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
    const w = cs[l].window, list = w.document.querySelectorAll('input[type=file][accept="' + (kind || 'audio') + '/*"]'), inp = list[list.length - 1];   // each voice game has its own; this game's come last
    w.__next = clip || tone(300);
    Object.defineProperty(inp, 'files', { value: [{ name: 'x.m4a', type: 'audio/x-m4a', size: 9 }], configurable: true });
    inp.dispatchEvent(new w.Event('change'));
    await sleep(40);
  }
});
const join = (p, name) => { p.$('nameInput').value = name; p.$('joinBtn').click(); };

(async () => {
  const [p1, p2, p3, p4] = ['c1', 'c2', 'c3', 'c4'].map(addPhone);
  await sleep(100);
  const w = screen.window;
  check(w.WsRules && w.WsSentences.length >= 30 && w.VoiceClip, 'rules, sentences and the clip maths are on the screen page');
  const reported = [];
  const origReport = w.reportWinners;
  w.reportWinners = (ids) => { reported.push(ids.slice()); origReport(ids); };
  const dbg = () => w.eval('active && active._debug()');
  const st = () => dbg().state;
  const all = [p1, p2, p3, p4];
  const by = (id) => all.find(p => p.id === id);
  const nameOf = (p) => ['Anna', 'Ben', 'Cleo', 'Dino'][all.indexOf(p)];
  const opt = (p, target) => p.dom.window.document.querySelector('#wsOpts .btn[data-id="' + target.id + '"]');

  join(p1, 'Anna'); join(p2, 'Ben'); join(p3, 'Cleo'); join(p4, 'Dino');
  await sleep(100);
  const pick = [...p1.dom.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '🗣️ Wer spricht da?');
  check(!!pick, '"Wer spricht da?" is in the game picker');
  pick.click(); await sleep(60);
  p1.send({ t: 'shellConfig', game: 'werspricht', cfg: { verzerrung: 'hoch', runden: 1, wertung: 'an' } });
  await sleep(40);
  p1.$('startBtn').click();
  await sleep(150);

  // ---- everybody records the sentence ----
  check(dbg() && st().phase.kind === 'rec' && w.WsSentences.includes(st().phase.text), 'start: everybody gets the same sentence');
  check(all.every(p => visible(p.dom) === 'v-werspricht' && p.$('wsLine').textContent === '„' + st().phase.text + '“' && p.shown('wsRec') && !p.$('wsRec').disabled && p.shown('wsAlt')), 'every phone shows it with the record buttons');
  check(Number(p2.$('wsClock').textContent) > 30 && p1.shown('wsNext') && /0\/4/.test(p1.$('wsNext').textContent) && !p2.shown('wsNext'), 'a clock runs; the host sees how many are in');
  await p2.record(tone(300, 0));
  check(!st().phase.clips[p2.id] && /nichts zu hören/.test(p2.$('wsNote').textContent), 'a silent recording is refused');
  await p2.record(tone(300));
  check(st().phase.clips[p2.id] && /Aufnahme ist da/.test(p2.$('wsText').textContent) && /Nochmal/.test(p2.$('wsRec').textContent) && /1\/4/.test(p1.$('wsNext').textContent), 'a recording is in; the phone may redo it');
  const ref0 = st().phase.clips[p2.id].ref;
  await p2.record(tone(320), 'video');
  check(st().phase.clips[p2.id].ref !== ref0 && !dbg().clips[ref0] && Object.keys(dbg().clips).length === 1, 'a second one (through the video way) replaces the first');
  p3.send({ t: 'wsClip', pcm: 'garbage!!' }); p3.send({ t: 'wsClip', pcm: 'A'.repeat(400000) }); await sleep(30);
  check(!st().phase.clips[p3.id], 'garbage is ignored');
  // a phone that reloads knows it has delivered
  const n0 = p2.all('wsState').length;
  p2.send({ t: 'shellSync' }); await sleep(80);
  check(p2.all('wsState').length > n0 && visible(p2.dom) === 'v-werspricht' && p2.last('wsState').done === true, 'a reloaded phone knows its recording is in');
  await p1.record(tone(250)); await p3.record(tone(400)); await p4.record(tone(500));
  await until(() => st().phase.kind === 'guess', 5000, 'everybody delivered: the guessing starts');
  await sleep(60);

  // ---- guessing ----
  check(st().phase.items.length === 4 && st().phase.items.every(it => it.rate === w.WsRules.RATES.hoch), 'four voices, all as chipmunks');
  let it = st().phase.items[0], owner = by(it.id), rest = all.filter(p => p !== owner);
  check(/Das bist du/.test(owner.$('wsText').textContent) && !owner.shown('wsOpts') && !owner.shown('wsRec'), 'whose voice it is gets no buttons');
  check(rest.every(p => p.qa('#wsOpts .btn').length === 3 && !p.qa('#wsOpts .btn').some(b => b.textContent === nameOf(p)) && p.qa('#wsOpts .btn').some(b => b.textContent === nameOf(owner))), 'the others get the names of everybody else to tap');
  check(p1.shown('wsPlay') && p1.$('wsPlay').disabled && !p2.shown('wsPlay'), 'the host can replay the voice, once it has played');
  owner.send({ t: 'wsGuess', id: rest[0].id }); rest[0].send({ t: 'wsGuess', id: rest[0].id }); await sleep(30);
  check(Object.keys(it.guesses).length === 0, 'the owner cannot guess, nobody can guess themselves');
  opt(rest[0], rest[1]).click(); await sleep(40);
  check(it.guesses[rest[0].id] === rest[1].id && opt(rest[0], rest[1]).classList.contains('sel') && /wechseln/.test(rest[0].$('wsSub').textContent), 'a tap is a guess and is marked');
  opt(rest[0], owner).click(); await sleep(40);
  check(it.guesses[rest[0].id] === owner.id && opt(rest[0], owner).classList.contains('sel') && !opt(rest[0], rest[1]).classList.contains('sel'), 'it can be changed');
  await until(() => !dbg().game.busy(w.performance.now()), 5000, 'the voice has played'); await sleep(80);
  const at0 = st().phase.at;
  p2.send({ t: 'wsPlay' }); await sleep(30);
  check(st().phase.at === at0 || p2 === p1, 'a guest cannot replay');
  check(!p1.$('wsPlay').disabled, 'now the host may');
  p1.$('wsPlay').click(); await sleep(60);
  check(st().phase.at > at0, 'and the voice plays again');
  opt(rest[1], rest[0]).click(); await sleep(40);
  check(st().phase.kind === 'guess', 'two of three have guessed');
  opt(rest[2], owner).click(); await sleep(80);

  // ---- the reveal ----
  check(st().phase.kind === 'reveal' && it.right.length === 2 && it.wrong.join() === String(rest[1].id), 'everybody has guessed: the reveal');
  check(/Richtig, das war/.test(rest[0].$('wsText').textContent) && /Nein, das war/.test(rest[1].$('wsText').textContent) && rest[0].$('wsText').textContent.includes(nameOf(owner)), 'the phones say right or wrong, and who it was');
  check(/1 reingelegt/.test(owner.$('wsText').textContent) && /2 haben dich erkannt/.test(owner.$('wsSub').textContent), 'the owner hears how many were fooled');
  check(st().score[rest[0].id] === 1 && st().score[rest[1].id] === 0 && st().score[owner.id] === 1, 'a point for a right guess, and one for the owner per player fooled');
  check(dbg().game.cues()[0].rate === 1, 'the TV plays the real voice');
  p2.send({ t: 'wsNext' }); await sleep(30);
  check(st().phase.kind === 'reveal' || p2 === p1, 'a guest cannot move on');
  p1.$('wsNext').click(); await sleep(80);
  check(st().phase.kind === 'guess' && st().phase.i === 1, 'the host moves on to the next voice');
  // somebody leaves in the middle; the host resolves the rest
  const gone = all.find(p => p !== p1 && p.id !== st().phase.items[1].id);
  bus.disconnect(gone.l); await sleep(80);
  check(w.eval('active') !== null && !st().players.includes(gone.id) && st().phase.voices.includes(gone.id), 'somebody leaves: the game goes on, their voice stays');
  for (let i = 0; i < 8 && !st().over; i++) { p1.$('wsNext').click(); await sleep(50); }
  check(st().over, 'the host taps through to the end');
  await sleep(60);
  const best = Math.max(...st().players.map(id => st().score[id]));
  check(reported.length === 1 && reported[0].every(id => st().score[id] === best), 'the most points win the evening point');
  check(all.filter(p => p !== gone).some(p => /gewonnen/.test(p.$('wsText').textContent)) && p1.shown('wsRestart') && /Punkt/.test(p1.$('wsSub').textContent), 'the phones know');
  p1.$('wsRestart').click(); await sleep(80);
  check(!st().over && st().phase.kind === 'rec' && Object.keys(dbg().clips).length === 0, 'again: a fresh game, the old recordings are gone');
  p1.$('abortBtn').click(); await sleep(150);
  check(w.eval('active') === null && visible(p1.dom) === 'v-shelllobby', 'abort → lobby');

  console.log(process.exitCode ? '❌ Wer-spricht-da-Flow fehlgeschlagen' : '✅ Alle Wer-spricht-da-Flow-Checks bestanden');
  process.exit(process.exitCode || 0);
})();
