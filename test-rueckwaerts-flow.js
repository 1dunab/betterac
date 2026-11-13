// Rückwärtsgang end to end, mode "jeder sein Wort": the real shell + real controllers in JSDOM. JSDOM has no microphone and no WebAudio,
// so reading a recorded file is replaced by a stand-in that returns a made-up wave. The phone's own cutting,
// shrinking and packing (clip.js) runs for real, and so does the screen's unpacking.
// Checks a whole turn, a silent recording, trying again, the host skipping, a phone reload, joining and leaving,
// the recap, the vote and the rematch.
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
  check(w.RwRules && w.VoiceClip && w.RwWords && !w.Mic, 'rules, clip maths and words are on the screen page; the microphone module is not');
  check(typeof p1.dom.window.Mic.fileInput === 'function' && p1.dom.window.VoiceClip && p1.dom.window.Mic.canLive() === false, 'the phones have microphone and clip maths; over http there is no live microphone');
  check(p1.qa('input[type=file][accept="audio/*"]').length === 1 && p1.qa('input[type=file][accept="video/*"]').length === 1, 'two ways without it: the recorder app and a short video');
  const reported = [];
  const origReport = w.reportWinners;
  w.reportWinners = (ids) => { reported.push(ids.slice()); origReport(ids); };
  const dbg = () => w.eval('active && active._debug()');
  const st = () => dbg().state;
  const all = [p1, p2, p3];
  const cur = () => all.find(p => p.id === st().phase.id);
  const idle = async () => { await until(() => !dbg().game.busy(w.performance.now()), 6000, 'the TV finishes playing'); await sleep(80); };

  join(p1, 'Anna'); join(p2, 'Ben'); join(p3, 'Cleo');
  await sleep(100);
  const picker = () => [...p1.dom.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '⏪ Rückwärtsgang');
  check(!!picker(), 'Rückwärtsgang is in the game picker');
  picker().click(); await sleep(60);
  p1.send({ t: 'shellConfig', game: 'rueckwaerts', cfg: { modus: 'einzeln', woerter: 'liste', stufe: 'leicht', runden: 1, wertung: 'an' } });
  await sleep(40);
  p1.$('startBtn').click();
  await sleep(150);

  // ---- say ----
  check(dbg() && st().phase.kind === 'say' && st().turns.length === 3 && w.RwWords.leicht.includes(st().phase.word), 'start: three turns, an easy word for the first player');
  check(all.every(p => visible(p.dom) === 'v-rueckwaerts'), 'the phones are in the game');
  let a = cur(), others = all.filter(p => p !== a);
  check(a.$('rwWord').textContent === st().phase.word && a.shown('rwRec') && !a.$('rwRec').disabled && a.shown('rwAlt'), 'whose turn it is sees the word and the record buttons');
  check(others.every(p => !p.shown('rwRec') && p.$('rwText').textContent.includes('ist dran')), 'the others see who is on');
  check(all.filter(p => p.shown('rwNext')).length === (a === p1 ? 0 : 1) && !p2.shown('rwNext'), 'only the host can skip, and not their own turn');
  await others[0].record();
  others[0].send({ t: 'rwClip', pcm: w.VoiceClip.pack(new w.Float32Array(4000).fill(0.5)) });
  a.send({ t: 'rwClip', pcm: 'not-base64!!' }); a.send({ t: 'rwClip', pcm: 'QUJD' }); a.send({ t: 'rwClip' }); a.send({ t: 'rwClip', pcm: 'A'.repeat(400000) });
  await sleep(40);
  check(st().phase.kind === 'say' && Object.keys(dbg().clips).length === 0, 'recordings from the wrong player and garbage are ignored');
  await a.record(tone(300, 0));
  check(st().phase.kind === 'say' && /nichts zu hören/.test(a.$('rwNote').textContent), 'a silent recording: the phone says so and sends nothing');
  await a.record(tone(300));
  check(st().phase.kind === 'listen' && Object.keys(dbg().clips).length === 1, 'the word is recorded: the TV has it');
  const clipA = dbg().clips[st().phase.a];
  check(Math.abs(clipA.x.length / 16000 - 0.3) < 0.02 && clipA.env.length === 96, 'cut to the sound (0.2 s plus air), at 16 kHz, with a wave to draw');
  check(Math.abs(st().phase.durA - 300) < 20, 'the rules know its length');

  // ---- listen ----
  check(a.$('rwRec').disabled && /zuhören/.test(a.$('rwRec').textContent) && a.$('rwPlay').disabled && !a.shown('rwAlt') && a.last('rwState').busyMs > 500, 'while the TV plays, the phone waits');
  check(dbg().game.cues().map(c => c.label).join() === 'vor,zurueck', 'the TV plays the word forwards, then backwards');
  await idle();
  check(!a.$('rwRec').disabled && !a.$('rwPlay').disabled && a.shown('rwAgain') && /Wort neu/.test(a.$('rwAgain').textContent) && a.shown('rwAlt'), 'then it may record, replay or say the word again');
  const at0 = st().phase.at;
  a.$('rwPlay').click(); await sleep(60);
  check(st().phase.at > at0 && a.$('rwPlay').disabled, 'replay: the TV plays it again, the phone waits again');
  others[0].send({ t: 'rwPlay' }); others[0].send({ t: 'rwAgain' }); others[0].send({ t: 'rwDone' }); await sleep(30);
  check(st().phase.kind === 'listen', 'the others cannot press the player\'s buttons');
  await idle();
  a.$('rwAgain').click(); await sleep(60);
  check(st().phase.kind === 'say' && Object.keys(dbg().clips).length === 0, 'say the word again: the old recording is dropped');
  await a.record(tone(500), 'video');
  check(st().phase.kind === 'listen', 'the video way delivers a recording too');
  await idle();

  // a phone that reloads in the middle of its turn finds its way back
  const n0 = a.all('rwState').length;
  a.send({ t: 'shellSync' }); await sleep(80);
  check(a.all('rwState').length > n0 && visible(a.dom) === 'v-rueckwaerts' && a.last('rwState').mine && a.last('rwState').phase === 'listen' && a.shown('rwRec'), 'a reloaded phone is back in its turn');

  // ---- reveal ----
  await a.record(tone(450));
  check(st().phase.kind === 'reveal' && st().phase.tries === 1 && dbg().game.cues().map(c => c.label + c.rev).join() === 'ergebnistrue,originalfalse', 'the imitation is in: the TV plays it backwards, then the original');
  check(!a.shown('rwRec') && a.shown('rwDone') && /Nochmal versuchen/.test(a.$('rwAgain').textContent) && a.$('rwText').textContent.length > 0, 'the phone offers: again, or done');
  a.$('rwAgain').click(); await sleep(60);
  check(st().phase.kind === 'listen' && Object.keys(dbg().clips).length === 1, 'try again: back to listening, the attempt is dropped');
  await idle();
  await a.record(tone(450));
  check(st().phase.kind === 'reveal' && st().phase.tries === 2, 'second try');
  a.$('rwDone').click(); await sleep(60);
  check(st().results.length === 1 && st().results[0].id === a.id && st().results[0].tries === 2 && st().phase.kind === 'say' && st().phase.id !== a.id, 'done: the result is kept, the next player is on');

  // ---- the host skips, somebody joins, somebody leaves ----
  const b = cur();
  const p4 = addPhone('c4');
  await sleep(100); join(p4, 'Dino'); await sleep(150);
  all.push(p4);
  check(visible(p4.dom) === 'v-rueckwaerts' && st().turns.filter(t => t.id === p4.id).length === 1, 'Dino comes later and gets a turn at the end');
  if (b === p1) { await b.record(); await idle(); await b.record(); b.$('rwDone').click(); }
  else { check(p1.shown('rwNext') && /Überspringen/.test(p1.$('rwNext').textContent), 'the host can skip a turn that hangs'); p2.send({ t: 'rwNext' }); await sleep(30); check(st().phase.id === b.id, 'a guest cannot'); p1.$('rwNext').click(); }
  await sleep(80);
  const c = cur();
  check(c !== a && c !== b && st().phase.kind === 'say', 'the third player');
  await c.record(tone(350)); await idle();
  const gone = c !== p1 ? c : null;
  if (gone) { bus.disconnect(gone.l); await sleep(80); check(w.eval('active') !== null && st().phase.id === p4.id && st().results.length === (b === p1 ? 2 : 1), 'the player on turn leaves: on to the next, nothing kept'); }
  else { await c.record(tone(350)); c.$('rwDone').click(); await sleep(60); }
  check(cur() === p4 && p4.shown('rwRec'), 'the latecomer\'s turn');
  await p4.record(tone(600)); await idle(); await p4.record(tone(650)); await sleep(30);
  p1.$('rwNext').click(); await sleep(80);       // the host moves on from the reveal: the result counts

  // ---- recap, vote, over ----
  check(st().phase.kind === 'recap' && st().results.some(r => r.id === p4.id), 'all turns done: the recap, with the latecomer\'s result');
  const guest = all.find(p => p !== p1 && p !== gone);
  check(/Show/.test(guest.$('rwText').textContent) && p1.shown('rwNext') && !guest.shown('rwNext'), 'the phones say so, the host can hurry it');
  const first = st().phase.i;
  await until(() => st().phase.kind !== 'recap' || st().phase.i > first, 8000, 'the recap goes on by itself');
  for (let i = 0; i < 6 && st().phase.kind === 'recap'; i++) { p1.$('rwNext').click(); await sleep(40); }
  check(st().phase.kind === 'vote', 'scoring on: a vote');
  const here = all.filter(p => p !== gone);
  check(here.every(p => p.qa('#rwOpts .btn').length === st().results.filter(r => r.id !== p.id).length), 'everybody chooses among the others\' results');
  const target = st().results.findIndex(r => r.id === p4.id);
  for (const p of here.filter(p => p !== p4)) { p.dom.window.document.querySelector('#rwOpts .btn[data-i="' + target + '"]').click(); await sleep(30); }
  check(here.find(p => p !== p4).dom.window.document.querySelector('#rwOpts .btn.sel').dataset.i === String(target), 'the vote is marked');
  const mine = st().results.findIndex(r => r.id !== p4.id);
  p4.send({ t: 'rwVote', i: target }); await sleep(30);
  check(st().phase.kind === 'vote' && st().phase.votes[p4.id] === undefined, 'nobody votes for themselves');
  p4.dom.window.document.querySelector('#rwOpts .btn[data-i="' + mine + '"]').click();
  await until(() => st().over, 3000, 'everybody voted: over');
  await sleep(60);
  check(reported.length === 1 && reported[0].join() === String(p4.id), 'Dino wins the evening point');
  check(/gewonnen/.test(p4.$('rwText').textContent) && /Das war/.test(p1.$('rwText').textContent) && p1.shown('rwRestart') && !guest.shown('rwRestart'), 'the phones know who won; the host can start again');
  guest.send({ t: 'rwRestart' }); await sleep(30);
  check(st().over, 'rwRestart from a guest is ignored');
  p1.$('rwRestart').click(); await sleep(80);
  check(!st().over && st().phase.kind === 'say' && st().results.length === 0 && Object.keys(dbg().clips).length === 0 && st().turns.length === here.length, 'again: a fresh game with everybody who is still there');

  // ---- abort, and everybody leaving ----
  p1.$('abortBtn').click(); await sleep(150);
  check(w.eval('active') === null && visible(p1.dom) === 'v-shelllobby', 'abort → lobby');
  p1.send({ t: 'shellConfig', game: 'rueckwaerts', cfg: { modus: 'einzeln', woerter: 'frei', wertung: 'aus' } }); await sleep(40);
  p1.$('startBtn').click(); await sleep(150);
  const f = cur();
  check(st().phase.word === null && /ein Wort oder einen kurzen Satz/.test(f.$('rwWord').textContent), 'own words: the phone asks for any word');
  for (const p of here.filter(p => p !== p1)) bus.disconnect(p.l);
  await sleep(80);
  check(w.eval('active') !== null && st().phase.id === p1.id, 'one player left: the game goes on with them');
  bus.disconnect('c1'); await sleep(100);
  check(w.eval('active') === null, 'nobody left → back to the lobby');

  console.log(process.exitCode ? '❌ Rückwärtsgang-Flow fehlgeschlagen' : '✅ Alle Rückwärtsgang-Flow-Checks bestanden');
  process.exit(process.exitCode || 0);
})();
