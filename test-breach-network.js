'use strict';
const assert = require('node:assert/strict');
const http = require('http');
const { WebSocket } = require('ws');
const makeServer = require('./breach-server');
async function run() {
  const server = http.createServer(), game = makeServer(); const clients = [];
  server.on('upgrade', (req, socket, head) => game.upgrade(req, socket, head));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'ws://127.0.0.1:' + server.address().port;
  const pause = ms => new Promise(r => setTimeout(r, ms));
  async function connect(name, code) {
    const ws = new WebSocket(url); clients.push(ws); ws.inbox = [];
    ws.on('message', raw => ws.inbox.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ t: 'join', name, code })); return ws;
  }
  async function wait(ws, predicate, ms = 3000) {
    const start = Date.now(); while (Date.now() - start < ms) {
      const i = ws.inbox.findIndex(predicate); if (i >= 0) return ws.inbox.splice(i, 1)[0]; await pause(10);
    }
    throw new Error('Timed out waiting for websocket event');
  }
  try {
    const a = await connect('Anna', ''), welcomeA = await wait(a, d => d.t === 'welcome');
    const b = await connect('Ben', welcomeA.code), welcomeB = await wait(b, d => d.t === 'welcome');
    const lobby = await wait(b, d => d.t === 'room'); assert.equal(lobby.players.length, 2); assert.equal(lobby.host, welcomeA.id);
    const bad = await connect('Invalid', 'ZZZZZ'); assert.equal((await wait(bad, d => d.t === 'error')).message.includes('nicht gefunden'), true);
    b.send(JSON.stringify({ t: 'start' })); await pause(50); assert.equal(game.rooms.get(welcomeA.code).match, null);
    a.send(JSON.stringify({ t: 'config', mode: 'tactical', target: 1, fillBots: false }));
    a.send(JSON.stringify({ t: 'start' }));
    const firstA = await wait(a, d => d.t === 'state'), firstB = await wait(b, d => d.t === 'state');
    assert.equal(firstA.version, firstB.version); assert.deepEqual(firstA.state.score, firstB.state.score); assert.equal(firstA.state.actors.length, 2);
    assert.ok(firstA.state.actors.every(p => Number.isFinite(p.spawnShield)));
    const model = game.rooms.get(welcomeA.code).match; model.phase = 'live'; model.remaining = 90;
    const before = model.actors.find(p => p.id === welcomeA.id).z, other = model.actors.find(p => p.id === welcomeB.id).z;
    a.send(JSON.stringify({ t: 'input', input: { forward: 1, yaw: 0, hp: 999, x: 999, ammo: 999 } })); await pause(150);
    const actor = model.actors.find(p => p.id === welcomeA.id); assert.ok(actor.z < before); assert.equal(actor.hp, 100); assert.equal(actor.ammo, 30); assert.equal(model.actors.find(p => p.id === welcomeB.id).z, other);
    a.send(JSON.stringify({ t: 'input', input: { fireTap: true, fire: true } }));
    a.send(JSON.stringify({ t: 'input', input: { fire: false } }));
    const fired = await wait(a, d => d.t === 'state' && d.state.actors.find(p => p.id === welcomeA.id).ammo === 29);
    assert.ok(fired.state.actors.every(p => Number.isFinite(p.shotTimer)));
    await pause(150); assert.equal(actor.ammo, 29);
    a.send(JSON.stringify({ t: 'input', input: { weapon: 'burst' } }));
    await wait(a, d => d.t === 'state' && d.state.actors.find(p => p.id === welcomeA.id).weapon === 'burst');
    a.send(JSON.stringify({ t: 'input', input: { fireTap: true } }));
    a.send(JSON.stringify({ t: 'input', input: {} }));
    await wait(b, d => d.t === 'state' && d.state.actors.find(p => p.id === welcomeA.id).weapon === 'burst' && d.state.actors.find(p => p.id === welcomeA.id).ammo === 27);
    a.send(JSON.stringify({ t: 'input', input: { weapon: 'rifle' } }));
    await wait(a, d => d.t === 'state' && d.state.actors.find(p => p.id === welcomeA.id).weapon === 'rifle' && d.state.actors.find(p => p.id === welcomeA.id).ammo === 29);
    for (const mode of ['ffa', 'arsenal', 'control', 'survival']) {
      a.send(JSON.stringify({ t: 'lobby' }));
      a.send(JSON.stringify({ t: 'config', mode, fillBots: false, target: 1 }));
      a.send(JSON.stringify({ t: 'start' }));
      const next = await wait(a, d => d.t === 'state' && d.state.cfg.mode === mode);
      const peer = await wait(b, d => d.t === 'state' && d.state.cfg.mode === mode);
      assert.equal(next.version, peer.version);
      const current = game.rooms.get(welcomeA.code).match; current.phase = 'live';
      if (mode === 'ffa') {
        const ffaRoom = await wait(b, d => d.t === 'room' && d.cfg.mode === 'ffa'); assert.ok(ffaRoom.players.every(p => p.team === null));
        a.send(JSON.stringify({ t: 'input', input: { weapon: 'sniper' } }));
        await wait(a, d => d.t === 'state' && d.state.cfg.mode === mode && d.state.actors[0].weapon === 'sniper');
        Object.assign(current.actors[0], { x: 26, z: 20, yaw: 0, pitch: -0.1, cooldown: 0 }); Object.assign(current.actors[1], { x: 26, z: 15 }); current.stats[welcomeA.id].kills = 14;
        a.send(JSON.stringify({ t: 'input', input: { quickscope: true, yaw: 0, pitch: -0.1 } }));
        a.send(JSON.stringify({ t: 'input', input: { fire: false } }));
        const won = await wait(b, d => d.t === 'state' && d.state.cfg.mode === mode && d.state.phase === 'end');
        assert.equal(won.state.result.winnerId, welcomeA.id); assert.equal(won.state.stats[welcomeA.id].quickscopes, 1);
      } else if (mode === 'arsenal') {
        assert.ok(next.state.actors.every(p => p.weapon === 'pistol'));
        a.send(JSON.stringify({ t: 'input', input: { weapon: 'sniper' } })); await pause(50);
        assert.equal(current.actors[0].weapon, 'pistol');
        Object.assign(current.actors[0], { x: 26, z: 20, yaw: 0, pitch: 0 }); Object.assign(current.actors[1], { x: 26, z: 18, hp: 1, armor: 0 });
        a.send(JSON.stringify({ t: 'input', input: { fireTap: true, yaw: 0, pitch: 0 } }));
        const advanced = await wait(b, d => d.t === 'state' && d.state.arsenalProgress?.[0] === 1);
        assert.equal(advanced.state.actors[0].weapon, 'smg');
      } else if (mode === 'control') {
        assert.equal(next.state.zones.length, 2); assert.deepEqual(next.state.zoneScores, [0, 0]);
        current.zones[0].owner = 0; current.zoneScores[0] = 12;
        await wait(b, d => d.t === 'state' && d.state.cfg.mode === mode && d.state.zoneScores[0] >= 12 && d.state.zones[0].owner === 0);
      } else {
        assert.equal(next.state.cfg.target, 5); assert.ok(next.state.actors.filter(p => !p.bot).every(p => p.team === 0));
        assert.ok(next.state.actors.some(p => p.bot && p.team === 1));
        const coopRoom = await wait(b, d => d.t === 'room' && d.cfg.mode === 'survival'); assert.ok(coopRoom.players.every(p => p.team === 0));
      }
    }
    a.close(); await wait(b, d => d.t === 'room' && d.host === welcomeB.id); assert.equal(game.rooms.get(welcomeA.code).host, welcomeB.id);
    assert.ok(game.rooms.get(welcomeA.code).match.actors.some(p => p.bot && p.id.startsWith('bot-departed')));
    b.close(); await pause(80); assert.equal(game.rooms.size, 0);
    console.log('✓ Two real WebSocket clients: rooms, host permissions, snapshots, independent inputs, short-tap delivery, bursts, preserved magazines, untrusted input, host migration and cleanup.');
  } finally {
    clients.forEach(ws => ws.terminate()); game.close(); await new Promise(resolve => server.close(resolve));
  }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
