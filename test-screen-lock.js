// One screen per server, and a running screen can't be stolen (docs/FURTFEHDE.md, "S — one screen per server").
// Against the real server.js. Raw `ws` clients check the protocol (busy, the screen secret, the 8 s grace, the
// heartbeat), real screen.html pages (jsdom) check what a person sees and that the page stays quiet.
// Test servers live on ports 3995-3999 only. About 20 s: the grace (8 s) and the heartbeat (10-20 s) run in real
// time, so the four scenarios run side by side, each on its own server.
'use strict';
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');
const { makeDom } = require('./test-helpers');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Poll check() until it returns something truthy (and return that); every wait has a deadline.
async function until(what, ms, check) {
  const end = Date.now() + ms;
  for (;;) {
    const got = await check();
    if (got) return got;
    if (Date.now() > end) throw Error('Timeout: ' + what);
    await pause(25);
  }
}

// ---- servers: ports 3995-3999, killed by PID ----
const PORTS = [3995, 3996, 3997, 3998, 3999], taken = new Set(), children = [], sockets = [], windows = [];
const isFree = port => new Promise(resolve => {
  const probe = net.createServer();
  probe.once('error', () => resolve(false));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
});
async function startServer() {
  let port = 0;
  for (const p of PORTS) {
    if (taken.has(p)) continue;
    taken.add(p);                                  // claimed before the first await: the scenarios start together
    if (await isFree(p)) { port = p; break; }      // (a port someone else holds stays claimed, so we skip it)
  }
  if (!port) throw Error('no free test port in 3995-3999');
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  let exited = false; child.once('exit', () => { exited = true; }); children.push(child);
  const srv = { port, base: 'http://127.0.0.1:' + port, wsUrl: 'ws://127.0.0.1:' + port, info: async () => (await fetch(srv.base + '/info')).json() };
  await until('the server on ' + port + ' starts', 6000, async () => {
    if (exited) throw Error('the server on ' + port + ' exited');
    try { return (await fetch(srv.base + '/info')).ok; } catch (_) { return false; }
  });
  return srv;
}

// ---- clients ----
function open(srv, options) {
  const ws = new WebSocket(srv.wsUrl, options);
  ws.inbox = [];
  ws.on('message', raw => ws.inbox.push(JSON.parse(raw)));
  ws.on('error', () => {});
  sockets.push(ws);
  return new Promise((resolve, reject) => { ws.once('open', () => resolve(ws)); ws.once('error', reject); });
}
async function join(srv, registration, options) {
  const ws = await open(srv, options);
  ws.send(JSON.stringify({ type: 'register', ...registration }));
  return ws;
}
// (a timeout says what was waited for and what had arrived instead)
const get = (ws, predicate, ms = 3000) => until('a message ' + predicate.toString().slice(0, 90), ms, () => { const i = ws.inbox.findIndex(predicate); return i >= 0 ? ws.inbox.splice(i, 1)[0] : null; })
  .catch(error => { throw Error(error.message + ' — inbox: ' + JSON.stringify(ws.inbox).slice(0, 240)); });
const welcome = ws => get(ws, m => m.type === 'welcome');
const closes = (ws, ms = 3000) => until('the socket closes', ms, () => ws.readyState === WebSocket.CLOSED);
const send = (ws, obj) => ws.send(JSON.stringify(obj));
// A screen register that must be refused: `busy`, then the server closes the socket; no welcome, no id.
async function refused(srv, extra, what) {
  const ws = await join(srv, { role: 'screen', ...extra });
  const first = await get(ws, m => m.type === 'busy' || m.type === 'welcome');
  assert.equal(first.type, 'busy', what + ' is refused');
  await closes(ws);
  assert.ok(!ws.inbox.some(m => m.type === 'welcome'), what + ' gets no welcome');
}

// ---- 1. protocol: strangers, the running screen, the same tab ----
async function protocol() {
  const srv = await startServer();
  assert.equal((await srv.info()).screen, false, 'no screen yet');
  const screen = await join(srv, { role: 'screen' });
  const w1 = await welcome(screen);
  assert.equal(w1.device_id, 0);
  assert.ok(typeof w1.secret === 'string' && w1.secret.length >= 16, 'the screen gets a secret with its welcome');
  assert.equal((await srv.info()).screen, true, '/info reports the screen');
  const phone = await join(srv, { role: 'controller' });
  const wp = await welcome(phone);
  assert.ok(wp.secret && wp.secret !== w1.secret, 'a phone keeps its own resume secret');
  await get(screen, m => m.type === 'connect' && m.device_id === wp.device_id);
  const viewer = await join(srv, { role: 'viewer' });
  assert.equal((await welcome(viewer)).device_id, -1, 'viewers still get no id');
  await get(screen, m => m.type === 'viewers' && m.n === 1);
  screen.inbox.length = phone.inbox.length = viewer.inbox.length = 0;

  // a second screen is refused, whatever it brings
  for (const [what, extra] of [['a stranger', {}], ['a wrong secret', { secret: 'wrong' }], ['a phone\'s secret', { secret: wp.secret, resume: wp.device_id }],
    ['an empty secret', { secret: '' }], ['a number', { secret: 12345 }], ['null', { secret: null }]]) await refused(srv, extra, what);
  // ...and whatever a refused socket sends right behind its register goes nowhere
  const sneaky = await open(srv);
  send(sneaky, { type: 'register', role: 'screen' });
  send(sneaky, { type: 'message', to: wp.device_id, data: { t: 'evil' } });
  send(sneaky, { type: 'message', to: null, data: { t: 'evil' } });
  send(sneaky, { type: 'frame', data: 'data:evil' });
  await closes(sneaky);
  await pause(150);
  assert.deepEqual(screen.inbox, [], 'the running screen was not touched (no kicked, connect, disconnect, message)');
  assert.deepEqual(phone.inbox, [], 'nothing from a refused socket reaches the phones');
  assert.deepEqual(viewer.inbox, [], 'nothing from a refused socket reaches the viewers');
  assert.equal(screen.readyState, WebSocket.OPEN);
  assert.equal((await srv.info()).screen, true);

  // the first screen keeps working: phone <-> screen, frames to the viewer
  send(phone, { type: 'message', to: 0, data: { t: 'ping' } });
  assert.equal((await get(screen, m => m.type === 'message' && m.data.t === 'ping')).from, wp.device_id, 'a phone message still reaches the first screen');
  send(screen, { type: 'message', to: wp.device_id, data: { t: 'pong' } });
  await get(phone, m => m.type === 'message' && m.data.t === 'pong');
  send(screen, { type: 'frame', data: 'data:image/jpeg;base64,AAAA' });
  assert.equal((await get(viewer, m => m.type === 'frame')).data, 'data:image/jpeg;base64,AAAA', 'frames still reach the viewer');

  // the same tab (its secret) takes the seat silently while its old socket still hangs there
  const again = await join(srv, { role: 'screen', secret: w1.secret });
  const w2 = await welcome(again);
  assert.equal(w2.device_id, 0);
  assert.equal(w2.secret, w1.secret, 'the same tab keeps its secret');
  assert.ok(w2.devices.includes(wp.device_id), 'and sees the phones');
  await get(screen, m => m.type === 'kicked');
  await closes(screen);
  await get(phone, m => m.type === 'connect' && m.device_id === 0);
  await get(again, m => m.type === 'viewers' && m.n === 1);
  await pause(100);
  assert.equal((await srv.info()).screen, true, 'the replaced socket\'s close does not free the slot');
  send(phone, { type: 'message', to: 0, data: { t: 'ping2' } });
  await get(again, m => m.type === 'message' && m.data.t === 'ping2');

  // a reload: the screen closes, a stranger comes inside the grace, the same tab comes back
  phone.inbox.length = 0;
  const t0 = Date.now();
  again.close(); await closes(again);
  await pause(150);
  assert.equal((await srv.info()).screen, true, 'a closed screen keeps its seat during the grace');
  await refused(srv, {}, 'a stranger inside the grace');
  const reload = await join(srv, { role: 'screen', secret: w1.secret });
  const w3 = await welcome(reload);
  assert.equal(w3.secret, w1.secret, 'the reload reclaims the seat with its secret');
  await get(reload, m => m.type === 'viewers' && m.n === 1);
  // the grace timer of the socket it replaced must leave it alone
  await until('past the old grace', 12000, () => Date.now() - t0 > 8800);
  assert.equal((await srv.info()).screen, true, 'the old grace timer left the new screen alone');
  assert.ok(!phone.inbox.some(m => m.type === 'disconnect'), 'the phones never saw the screen leave');
  send(phone, { type: 'message', to: 0, data: { t: 'ping3' } });
  await get(reload, m => m.type === 'message' && m.data.t === 'ping3');
  return 'strangers refused (6 kinds), the running screen untouched and working, same-tab takeover and reload inside the grace';
}

// ---- 2. the grace: after it a stranger may take the seat, with a fresh secret ----
async function grace() {
  const srv = await startServer();
  const screen = await join(srv, { role: 'screen' });
  const w1 = await welcome(screen);
  const phone = await join(srv, { role: 'controller' });
  await welcome(phone);
  const t0 = Date.now();   // taken before the close: under load this process may notice the close late, the server's 8 s start at the close
  screen.close(); await closes(screen);
  await pause(200);
  await refused(srv, {}, 'a stranger right after the close');
  await until('5 s into the grace', 8000, () => Date.now() - t0 > 5000);
  assert.equal((await srv.info()).screen, true, 'still held 5 s after the close');
  await refused(srv, {}, 'a stranger 5 s into the grace');
  await get(phone, m => m.type === 'disconnect' && m.device_id === 0, 10000);
  const held = Date.now() - t0;
  assert.ok(held >= 7500 && held <= 14000, 'the seat is held about 8 s (' + held + ' ms)');
  assert.equal((await srv.info()).screen, false, 'free after the grace');
  const fresh = await join(srv, { role: 'screen' });
  const w2 = await welcome(fresh);
  assert.equal(w2.device_id, 0);
  assert.notEqual(w2.secret, w1.secret, 'a fresh seat gets a fresh secret');
  await get(phone, m => m.type === 'connect' && m.device_id === 0);
  await refused(srv, { secret: w1.secret }, 'the former screen\'s secret');
  assert.equal(fresh.readyState, WebSocket.OPEN, 'the new screen is untouched');
  return 'refused 0.2 s and 5 s after the close, accepted after ' + (held / 1000).toFixed(1) + ' s with a new secret; the old secret is dead';
}

// ---- 3. a screen that stops answering is replaced once the heartbeat has found it ----
async function heartbeat() {
  const srv = await startServer();
  const dead = await join(srv, { role: 'screen' }, { autoPong: false });   // the socket stays open but never pongs
  const w1 = await welcome(dead);
  const phone = await join(srv, { role: 'controller' });
  await welcome(phone);
  await refused(srv, {}, 'a stranger while the screen still looks alive');
  assert.equal((await srv.info()).screen, true);
  await until('the heartbeat finds the silent screen', 30000, () => dead.readyState === WebSocket.CLOSED);
  const t1 = Date.now();
  // free at once: no second grace on top of the heartbeat's 10-20 s of silence
  const fresh = await until('a fresh screen right after the heartbeat', 2000, async () => {
    const ws = await join(srv, { role: 'screen' });
    const first = await get(ws, m => m.type === 'welcome' || m.type === 'busy');
    if (first.type === 'welcome') { ws.first = first; return ws; }
    await closes(ws);
    return null;
  });
  assert.equal(fresh.first.device_id, 0);
  assert.notEqual(fresh.first.secret, w1.secret, 'the dead screen\'s secret is dead');
  await get(phone, m => m.type === 'disconnect' && m.device_id === 0);
  await get(phone, m => m.type === 'connect' && m.device_id === 0);
  assert.equal((await srv.info()).screen, true);
  return 'a silent screen is dropped by the heartbeat and replaced ' + (Date.now() - t1) + ' ms later, without a grace';
}

// ---- 4. the pages: what a person sees (real screen.html in jsdom against the real server) ----
async function pages() {
  const srv = await startServer();
  const page = (opts = {}) => {
    const dom = makeDom('screen.html', 'screen', null, 'page', { realWs: true, url: srv.base + '/screen.html', fetch: u => fetch(srv.base + u), ...opts });
    windows.push(dom.window);
    return dom;
  };
  const $ = (dom, id) => dom.window.document.getElementById(id);
  const dialog = dom => $(dom, 'busy').style.display === 'flex';
  const secretOf = dom => dom.window.sessionStorage.getItem('ac_screen');
  const lobby = name => m => m.type === 'message' && m.data && m.data.t === 'shell' && m.data.cmd === 'lobby' && (!name || m.data.name === name);
  const askName = m => m.type === 'message' && m.data && m.data.t === 'shell' && m.data.cmd === 'name';

  // the TV opens the screen: nobody there yet, no dialog, it connects and keeps its secret
  const tv = page();
  await until('the first screen connects', 10000, () => secretOf(tv));
  assert.ok(!dialog(tv), 'no dialog for the first screen');
  assert.equal(tv.window.__sockets, 1);
  assert.equal((await srv.info()).screen, true);
  const phone = await join(srv, { role: 'controller' });
  const wp = await welcome(phone);
  await get(phone, askName, 6000);
  send(phone, { type: 'message', to: 0, data: { t: 'shellName', name: 'Anna' } });
  await get(phone, lobby('Anna'), 6000);
  const answers = async what => { send(phone, { type: 'message', to: 0, data: { t: 'shellSync' } }); await get(phone, lobby('Anna'), 5000).catch(() => { throw Error('the running screen stopped answering ' + what); }); };

  // another device opens screen.html: /info says a screen runs, so it never even connects
  const guest = page();
  await until('the dialog for a second device', 10000, () => dialog(guest));
  await pause(300);
  assert.equal(guest.window.__sockets, 0, 'no connection attempt while /info says a screen runs');
  assert.deepEqual([...$(guest, 'busy').querySelectorAll('button')].map(b => b.textContent), ['👀 Mitschauen', '🔄 Nochmal versuchen'], 'Mitschauen and Nochmal versuchen, no takeover');
  assert.ok(!$(guest, 'busyTake'), 'Trotzdem übernehmen is gone');
  await answers('after a second device opened the page');

  // the race (/info said "free", somebody else registered first): the server says busy, the page shows the dialog and stays quiet
  const racer = page({ fetch: () => Promise.resolve({ json: () => Promise.resolve({ screen: false }) }) });
  await until('busy from the server shows the dialog', 10000, () => dialog(racer));
  assert.equal(racer.window.__sockets, 1);
  await pause(2000);   // a reconnect loop would have opened more sockets by now (the shim's backoff starts at 800 ms)
  assert.equal(racer.window.__sockets, 1, 'no reconnect loop after busy');
  assert.equal(secretOf(racer), null, 'a refused page holds no secret');
  await answers('after a refused register');

  // "Nochmal versuchen" while the other screen runs: tried once, refused, said so
  $(racer, 'busyRetry').click();
  assert.equal($(racer, 'busyRetry').disabled, true, 'the button shows that it is trying');
  await until('refused again', 6000, () => racer.window.__sockets === 2 && !$(racer, 'busyRetry').disabled);
  assert.ok(dialog(racer) && /Immer noch belegt/.test($(racer, 'busyNote').textContent), 'the dialog says it is still taken');
  await pause(1500);
  assert.equal(racer.window.__sockets, 2, 'one socket per retry, no loop');

  // the TV's tab reloads (same sessionStorage): its secret brings it back while a stranger waits at the door
  const secret = secretOf(tv), snap = tv.window.sessionStorage.getItem('shellSnapshot');
  assert.ok(snap, 'the lobby snapshot exists');
  tv.window.close();
  await pause(300);
  assert.equal((await srv.info()).screen, true, 'a closed screen keeps its seat');
  const tv2 = page({ seedSession: { ac_screen: secret, shellSnapshot: snap } });
  await get(phone, lobby('Anna'), 10000);   // the reloaded screen restored Anna from its snapshot, so it is registered and working
  assert.ok(!dialog(tv2), 'a reload gets no dialog');
  assert.equal(secretOf(tv2), secret, 'the reload reclaimed the seat with the same secret');
  assert.ok(!phone.inbox.some(m => m.type === 'disconnect'), 'the phones never saw the screen leave');
  await answers('after its own reload');

  // the TV closes for good: a retry inside the grace is refused, after the grace the seat is free
  const t0 = Date.now();
  tv2.window.close();
  await pause(300);
  $(racer, 'busyRetry').click();
  await until('refused inside the grace', 6000, () => racer.window.__sockets === 3 && !$(racer, 'busyRetry').disabled);
  assert.ok(dialog(racer), 'a retry inside the grace is refused');
  await until('the grace is over', 15000, () => Date.now() - t0 > 8800);
  await until('the retry is accepted', 12000, async () => {   // like a person: again and again (the server's 8 s start when the close reaches it)
    if (dialog(racer) && !$(racer, 'busyRetry').disabled) $(racer, 'busyRetry').click();
    await pause(400);
    return !dialog(racer) && secretOf(racer);
  });
  assert.notEqual(secretOf(racer), secret, 'the new screen has a new secret');
  await get(phone, askName, 8000);   // the new screen has no snapshot: it asks the phone for its name again
  assert.equal((await srv.info()).screen, true);
  return 'dialog without a connection, busy without a reconnect loop, Nochmal versuchen, own reload reclaims the seat';
}

// ---- run ----
// Every scenario reports for itself: one failing does not hide (or cut short) the others.
const failures = [];
async function run(name, fn) {
  try { console.log('✅ Screen lock, ' + name + ': ' + await fn()); }
  catch (error) { failures.push(name); console.error('❌ Screen lock, ' + name + ': ' + (error && error.stack || error)); }
}
async function cleanup() {
  for (const w of windows) { try { w.close(); } catch (_) {} }
  for (const ws of sockets) { try { ws.terminate(); } catch (_) {} }
  await Promise.all(children.map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode) return resolve();
    child.once('exit', resolve); child.kill(); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
  })));
}
const guard = setTimeout(async () => { console.error('❌ test-screen-lock: timeout'); await cleanup(); process.exit(1); }, 120000);
(async () => {
  // `node test-screen-lock.js grace pages` runs just those scenarios
  const only = process.argv.slice(2), want = name => !only.length || only.includes(name);
  await Promise.all([['protocol', protocol], ['grace', grace], ['heartbeat', heartbeat], ['pages', pages]].filter(([name]) => want(name)).map(([name, fn]) => run(name, fn)));
  clearTimeout(guard);
  await cleanup();
  process.exit(failures.length || process.exitCode ? 1 : 0);   // (a runtime error inside a page sets exitCode, see makeDom)
})();
