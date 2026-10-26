// Mitschauen against the real server.js: the landing page, the /info screen
// flag, frames relayed only from the screen to viewers, viewers counted for the
// screen but invisible to the game (no device ids, no connect events, ignored).
'use strict';
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
  const base = 'http://127.0.0.1:' + port, sockets = [];
  async function wait(ws, predicate, timeout = 3000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const index = ws.inbox.findIndex(predicate);
      if (index >= 0) return ws.inbox.splice(index, 1)[0];
      await pause(10);
    }
    throw Error('Expected relay message was not delivered');
  }
  async function connect(role) {
    const ws = new WebSocket(base.replace('http:', 'ws:')); sockets.push(ws); ws.inbox = [];
    ws.on('message', raw => ws.inbox.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ type: 'register', role }));
    return [ws, await wait(ws, msg => msg.type === 'welcome')];
  }
  const info = async () => (await fetch(base + '/info')).json();
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/info')).ok) { ready = true; break; } } catch (_) {} await pause(30); }
    assert.ok(ready, 'Server starts');
    const landing = await (await fetch(base + '/')).text();
    assert.ok(/Mitspielen/.test(landing) && /Mitschauen/.test(landing) && !/Party Hub — Screen/.test(landing), '/ is the landing page, not the screen');
    assert.equal((await info()).screen, false, 'no screen yet');

    const [screen] = await connect('screen');
    assert.equal((await info()).screen, true, '/info reports the running screen');
    const [phone, phoneWelcome] = await connect('controller');
    await wait(screen, m => m.type === 'connect' && m.device_id === phoneWelcome.device_id);

    const [viewer, viewerWelcome] = await connect('viewer');
    assert.equal(viewerWelcome.device_id, -1, 'viewers get no player id');
    await wait(screen, m => m.type === 'viewers' && m.n === 0);   // sent when the screen registered
    assert.equal((await wait(screen, m => m.type === 'viewers')).n, 1, 'the screen learns that someone watches');
    await pause(80);
    assert.ok(!screen.inbox.some(m => m.type === 'connect') && !phone.inbox.some(m => m.type === 'connect'), 'viewers are invisible to the game');

    screen.send(JSON.stringify({ type: 'frame', data: 'data:image/jpeg;base64,AAAA' }));
    assert.equal((await wait(viewer, m => m.type === 'frame')).data, 'data:image/jpeg;base64,AAAA', 'screen frames reach the viewer');
    phone.send(JSON.stringify({ type: 'frame', data: 'data:fake' }));
    viewer.send(JSON.stringify({ type: 'message', to: 0, data: { t: 'shellAbort' } }));
    viewer.send(JSON.stringify({ type: 'frame', data: 'data:fake' }));
    await pause(120);
    assert.ok(!viewer.inbox.some(m => m.type === 'frame'), 'only the screen can send frames');
    assert.ok(!screen.inbox.some(m => m.type === 'message'), 'whatever a viewer sends is ignored');

    viewer.close();
    assert.equal((await wait(screen, m => m.type === 'viewers')).n, 0, 'a leaving viewer is uncounted');
    console.log('✅ Mitschauen: landing page, /info, frame relay, invisible viewers');
  } finally {
    sockets.forEach(ws => ws.terminate());
    child.kill();
  }
})().catch(error => { console.error('❌ ' + error.message); process.exitCode = 1; });
