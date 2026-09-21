'use strict';
const assert = require('node:assert/strict');
const { Match } = require('./public/games/breach/simulation');
const { objective } = require('./public/games/breach/feedback');
function live(mode = 'tactical') { const m = new Match(['a', 'b'], { mode, pvp: true, teams: { b: 1 }, fillBots: false }); m.phase = 'live'; m.remaining = 90; return m; }
function test(name, fn) { fn(); console.log('✓ ' + name); }
test('Phone hints follow actual planting, movement, cancellation and detonation states', () => {
  const m = live(), p = m.actors[0]; assert.equal(objective(m, p).ready, false);
  Object.assign(p, { x: -13, z: -6 }); assert.equal(objective(m, p).ready, true);
  m.input('a', { use: true }); for (let i = 0; i < 30; i++) m.step(1 / 60);
  const partial = objective(m, p); assert.ok(partial.progress > 0.19 && partial.progress < 0.21); assert.equal(partial.action, 'LEGEN');
  m.input('a', { use: true, forward: 1 }); m.step(1 / 60); const moving = objective(m, p); assert.equal(moving.ready, false); assert.equal(moving.progress, 0); assert.match(moving.detail, /Stehen bleiben/);
  m.input('a', { use: true }); for (let i = 0; i < 160; i++) { m.input('a', { use: true }); m.step(1 / 60); }
  assert.ok(m.bomb); assert.match(objective(m, p).title, /sichern/); assert.equal(objective(m, p).ready, false);
});
test('Defusing hints distinguish distance, another defuser, own progress and movement', () => {
  const m = live(), p = m.actors[1]; m.bomb = { site: 'B', x: 16, z: -9, left: 20, defuse: 0, defuser: null };
  assert.match(objective(m, p).detail, /Zur Bombe/); Object.assign(p, { x: 16, z: -9 }); assert.equal(objective(m, p).ready, true);
  m.bomb.defuser = 'other'; assert.equal(objective(m, p).ready, false); assert.match(objective(m, p).detail, /Team entschärft/);
  m.bomb.defuser = p.id; m.bomb.defuse = 2; assert.equal(objective(m, p).progress, 0.4);
  p.input.forward = 1; assert.equal(objective(m, p).ready, false);
});
test('Deathmatch and respawn hints never instruct players to plant bombs', () => {
  const m = live('deathmatch'), p = m.actors[0]; assert.equal(objective(m, p).target, null); assert.match(objective(m, p).detail, /Abschüsse/);
  p.alive = false; p.respawn = 2.2; assert.match(objective(m, p).title, /3 s/); p.alive = true; p.spawnShield = 1.7; assert.match(objective(m, p).title, /Startschutz/);
  m.phase = 'prep'; assert.match(objective(m, p).detail, /Wiedereinstieg/);
  m.phase = 'end'; m.result = { reason: '5 : 3 Abschüsse' }; assert.match(objective(m, p).title, /5 : 3/);
});
