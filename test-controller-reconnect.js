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
  async function connect(registration) {
    const ws = new WebSocket(base.replace('http:', 'ws:')); sockets.push(ws); ws.inbox = [];
    ws.on('message', raw => ws.inbox.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ type: 'register', ...registration }));
    return [ws, await wait(ws, msg => msg.type === 'welcome')];
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/info')).ok) { ready = true; break; } } catch (_) {} await pause(30); }
    assert.ok(ready, 'Server starts');
    for (const file of ['controller.html', 'screen.html', 'breach.html', 'games/breach/controls.css']) {
      const response = await fetch(base + '/' + file);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      if (file.endsWith('.html')) {
        const html = await response.text();
        assert.ok([...html.matchAll(/(?:src|href)="(games\/breach\/[^" ]+\.(?:js|css)[^"]*)"/g)].every(match => match[1].includes('?v=')), 'BREACH assets bypass old unversioned caches');
      }
    }
    const [screen] = await connect({ role: 'screen' });
    const [phone, identity] = await connect({ role: 'controller' });
    await wait(screen, msg => msg.type === 'connect' && msg.device_id === identity.device_id);
    phone.close(); await new Promise(resolve => phone.once('close', resolve)); await pause(120);
    assert.ok(!screen.inbox.some(msg => msg.type === 'disconnect'), 'Reload does not immediately remove the actor');
    const [resumed, recovered] = await connect({ role: 'controller', resume: identity.device_id, secret: identity.secret });
    assert.equal(recovered.device_id, identity.device_id); assert.equal(recovered.secret, identity.secret);
    resumed.send(JSON.stringify({ type: 'message', to: 0, data: { t: 'shellSync' } }));
    const sync = await wait(screen, msg => msg.type === 'message' && msg.data.t === 'shellSync');
    assert.equal(sync.from, identity.device_id);
    assert.ok(!screen.inbox.some(msg => msg.type === 'connect' || msg.type === 'disconnect'), 'Resume preserves the existing seat');
    const [stranger, other] = await connect({ role: 'controller', resume: identity.device_id, secret: 'wrong' });
    assert.notEqual(other.device_id, identity.device_id, 'Resume still requires its secret');
    screen.send(JSON.stringify({ type: 'kick', id: other.device_id }));
    await wait(stranger, msg => msg.type === 'kicked');
    await wait(screen, msg => msg.type === 'disconnect' && msg.device_id === other.device_id);
    resumed.close();
    await wait(screen, msg => msg.type === 'disconnect' && msg.device_id === identity.device_id, 10000);
    console.log('✓ Cache-safe assets, authenticated phone reload, state resync, immediate kicks and departure after the grace period.');
  } finally {
    sockets.forEach(ws => ws.terminate());
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
