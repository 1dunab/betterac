// Fotosalat end to end: the real shell + real controllers in JSDOM. JSDOM has no camera and cannot decode
// pictures, so the photo button's shrinking is replaced by a stand-in that returns a tiny JPEG data URL.
// Checks the photo button, the three mini-games, hearts, votes, the riddle, a phone reload in the middle of a
// round, joining and leaving, the end and the rematch.
const { makeDom, makeBus, visible } = require('./test-helpers');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(5); }
  fail('Timeout: ' + what); return false;
}

const SPEED = 20;   // the screen's clock runs 20× faster: grace periods and the zoom take a moment only
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';
const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const cs = {};
function addPhone(l) {
  cs[l] = makeDom('controller.html', 'controller', bus, l);
  const w = cs[l].window;
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();   // the wake-lock video: JSDOM cannot play
  let n = 0;
  w.Snap.shrink = async () => ({ url: JPEG + l + (++n), w: 4, h: 3 });
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
  shown(id) { return this.$(id).style.display !== 'none'; },
  // the camera app "returns" a picture: the hidden file input changes
  async snap() {
    const w = cs[l].window, inp = w.document.querySelector('input[type=file][accept="image/*"]');
    Object.defineProperty(inp, 'files', { value: [{ name: 'x.jpg', type: 'image/jpeg', size: 9 }], configurable: true });
    inp.dispatchEvent(new w.Event('change'));
    await sleep(30);
  }
});
const join = (p, name) => { p.$('nameInput').value = name; p.$('joinBtn').click(); };

(async () => {
  const [p1, p2, p3] = ['c1', 'c2', 'c3'].map(addPhone);
  await sleep(100);
  const w = screen.window;
  check(w.FotoRules && w.FotoArt.length >= 24 && w.FotoTasks.length >= 50, 'rules, paintings and tasks are loaded on the screen page');
  check(typeof p1.dom.window.Snap.bind === 'function' && !w.Snap, 'the photo button module is on the phones only');
  const real = w.performance.now.bind(w.performance), t0 = real();
  w.performance.now = () => t0 + (real() - t0) * SPEED;
  const reported = [];
  const origReport = w.reportWinners;
  w.reportWinners = (ids) => { reported.push(ids.slice()); origReport(ids); };
  const dbg = () => w.eval('active && active._debug()');
  const st = () => dbg().state;
  const start = async (cfg) => {
    p1.send({ t: 'shellConfig', game: 'fotosalat', cfg });
    await sleep(40);
    p1.$('startBtn').click();
    await sleep(150);
  };

  join(p1, 'Anna'); join(p2, 'Ben'); join(p3, 'Cleo');
  await sleep(100);
  const picker = () => [...p1.dom.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '📸 Fotosalat');
  check(!!picker(), 'Fotosalat is in the game picker');
  picker().click(); await sleep(60);
  check(/Nur Gemälde/.test(p1.$('gameSettings').textContent), 'the templates setting shows for Nachmachen');
  p1.send({ t: 'shellConfig', game: 'fotosalat', cfg: { spiel: 'jagd' } }); await sleep(60);
  check(!/Nur Gemälde/.test(p1.$('gameSettings').textContent) && /Mit Wertung/.test(p1.$('gameSettings').textContent), 'and hides for the other mini-games');

  // ================= Nachmachen: a painting round, then own poses =================
  await start({ spiel: 'nachmachen', vorlagen: 'mix', runden: 2, zeit: 180, wertung: 'an' });
  check(dbg() && st().phase.kind === 'copy' && st().phase.src === 'art', 'start: round 1, paintings');
  check([p1, p2, p3].every(p => visible(p.dom) === 'v-fotosalat'), 'the phones are in the game');
  let s1 = p1.last('fsState');
  check(s1.phase === 'copy' && /^games\/fotosalat\/art\/.+\.jpg$/.test(s1.tpl.art) && s1.tpl.title && s1.host === true && p2.last('fsState').host === false, 'fsState: a painting with title, and who the host is');
  check(new Set([p1, p2, p3].map(p => p.last('fsState').tpl.art)).size === 3, 'three different paintings');
  check(p1.$('fsPic').getAttribute('src') === s1.tpl.art && p1.$('fsCap').textContent.includes(s1.tpl.title) && p1.shown('fsRow'), 'the phone shows painting, title and the photo button');
  check(p1.shown('fsNext') && !p2.shown('fsNext') && /0\/3/.test(p1.$('fsNext').textContent), 'only the host can stop waiting');
  check(Number(p1.$('fsClock').textContent) > 100, 'the clock runs');

  await p1.snap();
  check(st().phase.shots[p1.id] !== undefined && Object.keys(dbg().pics).length === 1, 'Anna takes a photo: it arrives on the TV');
  check(/Foto ist da/.test(p1.$('fsShoot').textContent) && p1.shown('fsMine') && p1.last('fsState').done === true && p2.last('fsState').count === 1, 'her phone says so, the others see the count');
  const firstRef = st().phase.shots[p1.id];
  await p1.snap();
  check(st().phase.shots[p1.id] !== firstRef && Object.keys(dbg().pics).length === 1, 'a second photo replaces the first, the old one is dropped');
  p2.send({ t: 'fsPhoto', url: 'javascript:alert(1)' }); p2.send({ t: 'fsPhoto', url: JPEG + 'x'.repeat(700000) }); p2.send({ t: 'fsPhoto' });
  await sleep(30);
  check(st().phase.shots[p2.id] === undefined && Object.keys(dbg().pics).length === 1, 'only small JPEG data URLs are accepted');

  // a phone that reloads while the camera app is open finds its way back
  const n0 = p2.all('fsState').length;
  p2.send({ t: 'shellSync' }); await sleep(60);
  check(p2.all('fsState').length > n0 && visible(p2.dom) === 'v-fotosalat' && p2.last('fsState').tpl.art && p2.last('fsState').done === false, 'a reloaded phone gets its painting again');
  await p2.snap();
  p2.send({ t: 'fsNext' }); await sleep(30);
  check(st().phase.kind === 'copy', 'a guest cannot move on');
  p1.$('fsNext').click(); await sleep(60);
  check(st().phase.kind === 'pose' && st().pairs.length === 2, 'the host stops waiting: two pairs so far, now the poses');
  check(/Pose/.test(p3.$('fsText').textContent) && !p3.shown('fsPicWrap') && !/Foto ist da/.test(p3.$('fsShoot').textContent), 'new phase: the phones start fresh');

  await p1.snap(); await p2.snap(); await p3.snap();
  check(Object.keys(st().phase.shots).length === 3, 'three poses');
  await until(() => st().phase.kind === 'copy', 3000, 'everybody delivered: on after a short grace');
  await sleep(40);
  const tpl = st().phase.tpl;
  check([p1, p2, p3].every(p => tpl[p.id].pose && tpl[p.id].by !== p.id), 'everybody copies somebody else\'s pose');
  check([p1, p2, p3].every(p => p.last('fsTpl') && p.last('fsTpl').url === dbg().pics[tpl[p.id].pose].url && p.$('fsPic').getAttribute('src') === p.last('fsTpl').url), 'the pose travels to the phone and is shown');
  check(p1.$('fsCap').textContent === 'Pose von ' + w.eval('shortName')(tpl[p1.id].by), 'with the name of who struck it');
  const tplBefore = p3.all('fsTpl').length;
  p3.send({ t: 'shellSync' }); await sleep(60);
  check(p3.all('fsTpl').length === tplBefore + 1, 'after a reload the pose is sent again');
  await p1.snap(); await p2.snap(); await p3.snap();
  await until(() => st().phase.kind === 'show', 3000, 'the show');
  await sleep(40);
  check(st().phase.list.length === 5 && st().phase.step === 0, 'five pairs, the original first');
  check(!p1.shown('fsRow') && !p1.shown('fsHeart') && /Aufdecken/.test(p1.$('fsNext').textContent), 'phones: no photo button, the host can reveal');
  await until(() => st().phase.step === 1, 3000, 'the copy appears');
  await sleep(40);
  const pair = st().phase.list[0], owner = [p1, p2, p3].find(p => p.id === pair.by), fans = [p1, p2, p3].filter(p => p.id !== pair.by);
  check(!owner.shown('fsHeart') && fans.every(p => p.shown('fsHeart')) && /deins/.test(owner.$('fsText').textContent), 'everybody but the photographer gets the heart button');
  fans[0].$('fsHeart').click(); await sleep(40);
  check(pair.hearts.length === 1 && st().score[pair.by] === 1 && fans[0].$('fsHeart').classList.contains('on') && !fans[1].$('fsHeart').classList.contains('on'), 'a heart counts and lights up');
  owner.send({ t: 'fsHeart' }); fans[0].send({ t: 'fsHeart' }); await sleep(30);
  check(pair.hearts.length === 1, 'not for yourself, not twice');
  check(w.eval('active.canSave()') === true, 'the 💾 button is offered during the show');
  for (let i = 0; i < 12 && st().phase.kind === 'show'; i++) { p1.$('fsNext').click(); await sleep(25); }
  check(st().phase.kind === 'over' && st().over, 'the host taps through: over');
  await sleep(60);
  check(reported.length === 1 && reported[0].join() === String(pair.by), 'the heart wins the evening point');
  check(/gewonnen/.test(owner.$('fsText').textContent) && /Das war/.test(fans[0].$('fsText').textContent) && /1 Punkt/.test(owner.$('fsSub').textContent), 'the phones know who won');
  check(p1.shown('fsAgain') && !p2.shown('fsAgain'), 'only the host can start again');
  p2.send({ t: 'fsAgain' }); await sleep(30);
  check(st().over, 'fsAgain from a guest is ignored');
  p1.$('fsAgain').click(); await sleep(80);
  check(!st().over && st().phase.kind === 'copy' && st().pairs.length === 0 && Object.keys(dbg().pics).length === 0 && p2.last('fsState').phase === 'copy', 'again: a fresh game, the old photos are gone');
  p1.$('abortBtn').click(); await sleep(150);
  check(w.eval('active') === null && visible(p1.dom) === 'v-shelllobby', 'abort → lobby');

  // ================= the hunt, with a latecomer and somebody leaving =================
  await start({ spiel: 'jagd', runden: 1, zeit: 180, wertung: 'an' });
  check(st().phase.kind === 'task' && p2.last('fsState').task === w.FotoTasks[st().phase.task] && p2.$('fsText').textContent.includes(p2.last('fsState').task), 'the hunt: every phone shows the task');
  const p4 = addPhone('c4');
  await sleep(100); join(p4, 'Dino'); await sleep(150);
  check(visible(p4.dom) === 'v-fotosalat' && st().players.includes(p4.id) && p4.last('fsState').phase === 'task', 'Dino comes later and hunts along');
  await p1.snap(); await p2.snap(); await p4.snap();
  check(p4.$('fsPic').getAttribute('src').startsWith(JPEG) && p4.shown('fsPicWrap'), 'the phone shows the photo just taken');
  bus.disconnect('c3'); await sleep(80);
  check(w.eval('active') !== null && !st().players.includes(p3.id), 'Cleo leaves without a photo');
  await until(() => st().phase.kind === 'gallery', 3000, 'now everybody has delivered: the gallery');
  await sleep(40);
  check(st().phase.items.length === 3, 'three photos');
  check(p1.qa('#fsOpts .btn').length === 2 && !p1.qa('#fsOpts .btn').some(b => b.textContent.includes('Anna')), 'vote buttons for the others\' photos');
  p1.q('#fsOpts .btn[data-vote="' + p2.id + '"]').click(); p4.q('#fsOpts .btn[data-vote="' + p2.id + '"]').click(); await sleep(40);
  check(p1.q('#fsOpts .btn.sel').dataset.vote === String(p2.id) && st().phase.votes[p1.id] === p2.id, 'a vote is marked');
  p1.$('fsNext').click(); await sleep(80);
  check(st().phase.kind === 'over' && st().score[p2.id] === 2 && reported.length === 2 && reported[1].join() === String(p2.id), 'Ben wins the hunt with two votes');
  p1.$('abortBtn').click(); await sleep(150);

  // ================= the zoom riddle, without scoring =================
  await start({ spiel: 'zoom', runden: 1, zeit: 180, wertung: 'aus' });
  check(st().phase.kind === 'zshoot', 'the zoom riddle: first the photos');
  await p1.snap();
  check(p1.shown('fsCross') && /Tipp auf die Stelle/.test(p1.$('fsSub').textContent), 'after the photo the phone asks for the zoom point');
  const box = p1.$('fsPic');
  box.getBoundingClientRect = () => ({ left: 100, top: 200, width: 200, height: 100 });
  const ev = new p1.dom.window.Event('touchstart', { bubbles: true, cancelable: true });
  ev.changedTouches = [{ clientX: 150, clientY: 280 }];
  p1.$('fsPicBox').dispatchEvent(ev); await sleep(30);
  check(Math.abs(st().phase.focus[p1.id].x - 0.25) < 1e-6 && Math.abs(st().phase.focus[p1.id].y - 0.8) < 1e-6 && p1.$('fsCross').style.left === '25%', 'a tap on the photo sets the zoom point');
  await p2.snap(); await p4.snap();
  await until(() => st().phase.kind === 'riddle', 3000, 'the riddles');
  await sleep(40);
  const all = [p1, p2, p4];
  let it = st().phase.items[st().phase.i], own = all.find(p => p.id === it.id), rest = all.filter(p => p.id !== it.id);
  check(own.qa('#fsOpts .btn').length === 3 && rest.every(p => !p.shown('fsOpts')) && /Nichts verraten/.test(own.$('fsText').textContent), 'the photographer gets the names of the others and "nobody"');
  check(dbg().game.zoom(w.performance.now()) > 3, 'the TV is zoomed in');
  rest[0].send({ t: 'fsGuess', id: rest[0].id }); await sleep(30);
  check(st().phase.solved === null, 'only the photographer decides');
  own.q('#fsOpts .btn[data-guess="' + rest[1].id + '"]').click(); await sleep(40);
  check(st().phase.solved && st().phase.solved.by === rest[1].id && /hat's erkannt/.test(rest[0].$('fsText').textContent), 'they tap who called it: solved, everybody sees it');
  check(st().score[rest[1].id] === 0 && !rest[0].shown('fsHeart'), 'scoring off: no points, no hearts');
  await until(() => st().phase.i === 1, 3000, 'next riddle by itself');
  await sleep(40);
  it = st().phase.items[1]; own = all.find(p => p.id === it.id);
  own.q('#fsOpts .btn[data-guess="0"]').click(); await sleep(40);
  check(st().phase.solved.by === 0 && /Niemand/.test(own.$('fsText').textContent), '"nobody": shown without a winner');
  p1.$('fsNext').click(); await sleep(40);
  check(st().phase.i === 2 && st().phase.solved === null, 'the host goes on to the last riddle');
  await until(() => st().phase.solved, 4000, 'the zoom runs out');
  check(st().phase.solved.by === 0, 'nobody called it in time');
  await until(() => st().phase.kind === 'over', 3000, 'over');
  await sleep(40);
  check(reported.length === 2 && !/gewonnen/.test(p1.$('fsText').textContent + p2.$('fsText').textContent), 'no winner without scoring');

  // ---- everybody leaves ----
  for (const l of ['c2', 'c4']) bus.disconnect(l);
  await sleep(80);
  check(w.eval('active') !== null, 'one photographer left: the game stays');
  bus.disconnect('c1'); await sleep(100);
  check(w.eval('active') === null, 'nobody left → back to the lobby');

  console.log(process.exitCode ? '❌ Fotosalat-Flow fehlgeschlagen' : '✅ Alle Fotosalat-Flow-Checks bestanden');
  process.exit(process.exitCode || 0);
})();
