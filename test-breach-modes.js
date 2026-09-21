'use strict';
const assert = require('node:assert/strict');
const { Match } = require('./public/games/breach/simulation');
const W = require('./public/games/breach/world');
const { objective } = require('./public/games/breach/feedback');
const tick = (m, seconds) => { for (let n = 0; n < Math.ceil(seconds * 60); n++) m.step(1 / 60); };
function live(mode, extra = {}) {
  const m = new Match(['a', 'b'], { mode, pvp: true, teams: { b: 1 }, fillBots: false, random: () => 0.5, ...extra });
  m.phase = 'live'; m.remaining = W.modes[mode].duration; return m;
}
function test(name, fn) { fn(); console.log('✓ ' + name); }
test('Each mode starts with its own timer; invalid modes fall back safely', () => {
  for (const [mode, definition] of Object.entries(W.modes)) { const m = new Match(['a'], { mode }); m.remaining = 0.01; m.step(1 / 60); assert.equal(m.cfg.mode, mode); assert.equal(m.remaining, definition.duration); }
  for (const mode of ['__proto__', 'invalid', { toString: 2 }, null]) assert.equal(new Match(['a'], { mode }).cfg.mode, 'tactical');
});
test('Weapon race awards exactly one stage per kill shot and locks manual weapon selection', () => {
  const m = live('arsenal');
  for (let stage = 0; stage < W.arsenalOrder.length; stage++) {
    const a = m.actors[0], b = m.actors[1];
    assert.equal(a.weapon, W.arsenalOrder[stage]);
    m.input('a', { weapon: 'sniper' }); assert.equal(a.weapon, W.arsenalOrder[stage]);
    Object.assign(a, { x: 26, z: 20, yaw: 0, pitch: 0, cooldown: 0 });
    Object.assign(b, { x: 26, z: 18, alive: true, hp: 1, armor: 0, spawnShield: 0 });
    assert.equal(m.shoot(a), true); assert.equal(m.arsenalProgress[0], stage + 1);
    if (stage < 9) { assert.equal(m.phase, 'live'); assert.equal(a.ammo, W.weapons[a.weapon].mag); }
  }
  assert.equal(m.phase, 'end'); assert.equal(m.result.team, 0); assert.equal(m.stats.a.kills, 10);
  assert.equal(m.events.filter(e => e.type === 'result').length, 1);
});
test('Team weapon progress affects teammates and survives a death; timeouts use stages', () => {
  const m = live('arsenal', { teams: { b: 0 } }); m.advanceArsenal(0);
  m.actors[0].ammo = 0; m.actors[0].reserve = 0; m.reload(m.actors[0]); assert.ok(m.actors[0].reload > 0 && m.actors[0].reserve > 0);
  assert.ok(m.actors.every(a => a.weapon === 'smg'));
  m.actors[0].alive = false; m.actors[0].respawn = 0.1; tick(m, 0.2);
  assert.equal(m.actors[0].weapon, 'smg'); assert.equal(m.actors[0].spawnShield > 0, true);
  m.remaining = 0; m.step(1 / 60); assert.equal(m.result.team, 0);
  const tie = live('arsenal'); tie.remaining = 0; tie.step(1 / 60); assert.equal(tie.result.team, null);
});
test('Zones need continuous occupancy, contest stops capture and points, enemy can retake', () => {
  const m = live('control'), [a, b] = m.actors, zone = m.zones[0];
  Object.assign(a, { x: zone.x, z: zone.z }); Object.assign(b, { x: 26, z: 20 });
  tick(m, 1); assert.ok(zone.progress > 0.3 && zone.progress < 0.35); assert.equal(zone.owner, null);
  a.z += 8; tick(m, 0.1); assert.equal(zone.progress, 0);
  a.z = zone.z; tick(m, 1); const progress = zone.progress; Object.assign(b, { x: zone.x, z: zone.z });
  tick(m, 1); assert.equal(zone.progress, progress); assert.equal(zone.contested, true); assert.deepEqual(m.zoneScores, [0, 0]);
  b.z += 8; tick(m, 2.1); assert.equal(zone.owner, 0); assert.ok(m.zoneScores[0] > 0);
  b.z = zone.z; const points = m.zoneScores[0]; tick(m, 1); assert.equal(m.zoneScores[0], points);
  a.z += 8; tick(m, 3.1); assert.equal(zone.owner, 1); assert.ok(m.zoneScores[1] > 0);
  assert.equal(m.bomb, null); assert.equal(m.phase, 'live');
});
test('Both zones score independently; points, timeouts and respawns finish correctly', () => {
  const m = live('control'); m.actors.forEach(p => { p.x = 26; p.z = 20; }); m.zones.forEach(z => z.owner = 0);
  tick(m, 2); assert.ok(Math.abs(m.zoneScores[0] - 4) < 0.001);
  m.zoneScores[0] = 59.99; tick(m, 0.05); assert.equal(m.phase, 'end'); assert.equal(m.result.team, 0);
  const n = live('control'); n.actors[0].alive = false; n.actors[0].respawn = 0.01; tick(n, 0.05); assert.equal(n.actors[0].alive, true);
  n.remaining = 0; n.step(1 / 60); assert.equal(n.result.team, null);
});
test('Survival forces cooperative teams, revives and resupplies between waves, wins after five', () => {
  const m = live('survival', { target: 1 }); assert.equal(m.cfg.pvp, false); assert.equal(m.cfg.target, 5);
  assert.ok(m.actors.filter(a => !a.bot).every(a => a.team === 0));
  const sizes = [], health = [];
  for (let wave = 1; wave <= 5; wave++) {
    assert.equal(m.round, wave); m.phase = 'live'; m.remaining = 120;
    sizes.push(m.actors.filter(a => a.bot).length); health.push(m.actors.find(a => a.bot).hp);
    m.actors[0].alive = false; m.actors[1].hp = 12; m.actors[1].ammo = 2;
    m.actors.filter(a => a.bot).forEach(a => a.alive = false); m.step(1 / 60);
    if (wave < 5) { assert.equal(m.phase, 'roundOver'); m.remaining = 0; m.step(1 / 60); assert.ok(m.actors.filter(a => !a.bot).every(a => a.alive && a.hp === 100 && a.ammo === 30)); }
  }
  assert.equal(m.phase, 'end'); assert.equal(m.result.team, 0); assert.equal(m.score[0], 5);
  assert.ok(sizes[4] > sizes[0]); assert.ok(health[4] > health[0]);
});
test('Survival team wipe or timeout ends immediately; fallen players wait for their team', () => {
  const m = live('survival'); m.actors.filter(a => !a.bot).forEach(a => a.alive = false); m.step(1 / 60); assert.equal(m.phase, 'end'); assert.equal(m.result.team, 1);
  const n = live('survival'); n.remaining = 0; n.step(1 / 60); assert.equal(n.phase, 'end'); assert.equal(n.result.team, 1);
  const s = live('survival'); s.actors[0].alive = false; s.actors[0].respawn = 0; s.step(1 / 60); assert.equal(s.actors[0].alive, false); assert.match(objective(s, s.actors[0]).detail, /nächsten Welle/);
});
test('New mode hints report progress and never instruct players to plant bombs', () => {
  for (const mode of ['arsenal', 'control', 'survival']) {
    const m = live(mode), p = m.actors[0];
    assert.doesNotMatch(JSON.stringify(objective(m, p)), /Bombe|entschärf/i);
    m.phase = 'prep'; assert.doesNotMatch(objective(m, p).detail, /Bombe|entschärf/i);
    m.phase = 'live'; p.alive = false; assert.match(objective(m, p).title, mode === 'survival' ? /Team/ : /Wiedereinstieg/);
  }
  const m = live('control'), p = m.actors[0], zone = m.zones[0]; Object.assign(p, { x: zone.x, z: zone.z }); m.actors[1].z = 20;
  tick(m, 1); const hint = objective(m, p); assert.equal(hint.action, 'EROBERN'); assert.ok(hint.progress > 0.3); assert.equal(hint.ready, false);
});
