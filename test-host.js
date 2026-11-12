// Who is host: the first to join, and they stay host until they leave. Then the player who has been in the
// room longest takes over — and keeps it, even when the old host comes back with their old device id.
const { makeDom, makeBus, visible } = require('./test-helpers');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const c1 = makeDom('controller.html', 'controller', bus, 'c1');
const c2 = makeDom('controller.html', 'controller', bus, 'c2');
const c3 = makeDom('controller.html', 'controller', bus, 'c3');
const isHost = (dom) => visible(dom) === 'v-shelllobby' && dom.window.document.getElementById('hostLobby').style.display === 'block';
const join = (dom, name) => { dom.window.document.getElementById('nameInput').value = name; dom.window.document.getElementById('joinBtn').click(); };
const hosts = (...doms) => doms.map(d => isHost(d) ? 'H' : '-').join('');

(async () => {
  await sleep(100);
  join(c1, 'Anna'); join(c2, 'Ben'); join(c3, 'Cleo');
  await sleep(100);
  check(hosts(c1, c2, c3) === 'H--', 'the first to join is host');
  const annaId = bus.handlers.c1._id, resume = c1.window.sessionStorage.getItem('ac_resume');
  check(annaId === 1 && !!resume, 'Anna has device id 1 and the means to get it back');

  // ---- the host leaves: the one who has been here longest takes over ----
  bus.disconnect('c1'); await sleep(100);
  check(hosts(c2, c3) === 'H-', 'Anna leaves → Ben is host');

  // ---- she comes back in the same tab and gets her old id: Ben stays host ----
  const c1b = makeDom('controller.html', 'controller', bus, 'c1b', { seedSession: { ac_resume: resume } });
  await sleep(100);
  check(bus.handlers.c1b._id === annaId, 'Anna is back with her old device id');
  check(hosts(c2, c3) === 'H-', 'before she has typed her name, Ben is host');
  join(c1b, 'Anna'); await sleep(100);
  check(hosts(c1b, c2, c3) === '-H-', 'Anna is back in the lobby as a guest, Ben stays host');
  const w = screen.window;
  bus.fromClient('c1b', JSON.stringify({ type: 'message', to: 0, data: { t: 'shellSelect', game: 'spy' } }));
  bus.fromClient('c2', JSON.stringify({ type: 'message', to: 0, data: { t: 'shellSelect', game: 'reaction' } }));
  await sleep(60);
  check(w.eval('shell.selected') === 'reaction', 'only Ben can pick the game');

  // ---- a screen reload keeps the host ----
  const screen2 = makeDom('screen.html', 'screen', bus, 'screen2', { seedSession: {
    shellSnapshot: w.sessionStorage.getItem('shellSnapshot'), ac_screen: w.sessionStorage.getItem('ac_screen') } });
  await sleep(200);
  check(hosts(c1b, c2, c3) === '-H-', 'after a screen reload Ben is still host (not the lowest id)');

  // ---- the host leaves again: next in line is whoever has been here longest, not the lowest id ----
  bus.disconnect('c2'); await sleep(100);
  check(hosts(c1b, c3) === '-H', 'Ben leaves → Cleo is host, Anna came back later');
  bus.disconnect('c3'); await sleep(100);
  check(hosts(c1b) === 'H', 'Cleo leaves → Anna, the last one left, is host');

  // ---- in a running game: the returning old host does not get the abort button back ----
  const c4 = makeDom('controller.html', 'controller', bus, 'c4'), c5 = makeDom('controller.html', 'controller', bus, 'c5');
  await sleep(100); join(c4, 'Dino'); join(c5, 'Eva'); await sleep(100);
  const anna2 = c1b.window.sessionStorage.getItem('ac_resume');
  [...c1b.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent.includes('Bumper')).click(); await sleep(60);
  c1b.window.document.getElementById('startBtn').click(); await sleep(150);
  const abort = (dom) => dom.window.document.getElementById('abortBtn').style.display === 'block';
  const running = () => screen2.window.eval('active') !== null;
  check(running() && abort(c1b) && !abort(c4) && !abort(c5), 'a game runs, Anna (host) has the abort button');
  bus.disconnect('c1b'); await sleep(100);
  check(running() && abort(c4) && !abort(c5), 'Anna leaves mid-game → Dino can abort');
  const c1c = makeDom('controller.html', 'controller', bus, 'c1c', { seedSession: { ac_resume: anna2 } });
  await sleep(100); join(c1c, 'Anna'); await sleep(150);
  check(bus.handlers.c1c._id === annaId && visible(c1c) === 'v-spectate', 'Anna returns with id 1 and watches');
  check(running() && !abort(c1c) && abort(c4), 'the abort button stays with Dino');

  console.log(process.exitCode ? '❌ Host-Test fehlgeschlagen' : '✅ Alle Host-Checks bestanden');
  process.exit(process.exitCode || 0);
})();
