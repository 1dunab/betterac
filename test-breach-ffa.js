'use strict';
const assert = require('node:assert/strict');
const { Match, blocked } = require('./public/games/breach/simulation');
const W = require('./public/games/breach/world');
const { objective, ranking } = require('./public/games/breach/feedback');
const tick = (m, seconds) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) m.step(1 / 60); };
function duel(extra = {}) { const m = new Match(['a', 'b'], { mode: 'ffa', fillBots: false, teams: { a: 0, b: 0 }, random: () => 0.5, ...extra }); m.phase = 'live'; m.remaining = 180; return m; }
function line(m, weapon = 'sniper') { const [a, b] = m.actors; m.switchWeapon(a, weapon); Object.assign(a, { x: 26, z: 20, yaw: 0, pitch: -0.1, cooldown: 0 }); Object.assign(b, { x: 26, z: 15 }); return [a, b]; }
function test(name, fn) { fn(); console.log('✓ ' + name); }
test('FFA ignores former teams, uses separate reachable spawns and retains free weapon choice', () => {
  W.ffaSpawns.forEach(p => assert.equal(blocked(p.x, p.z), false));
  const m = duel(); assert.equal(m.cfg.pvp, true); assert.equal(m.actors.length, 2); assert.ok(m.enemy(...m.actors)); assert.equal(m.enemy(m.actors[0], m.actors[0]), false);
  assert.ok(Math.hypot(m.actors[0].x - m.actors[1].x, m.actors[0].z - m.actors[1].z) > 20);
  for (const key of Object.keys(W.weapons)) { m.input('a', { weapon: key }); assert.equal(m.actors[0].weapon, key); }
  const [a, b] = line(m, 'rifle'); m.shoot(a); assert.ok(b.hp < 100); assert.equal(a.hp, 100);
});
test('FFA bots attack each other; one solo player has an opponent and humans get no co-op advantages', () => {
  const m = new Match(['a'], { mode: 'ffa', random: () => 0.5 }); const bots = m.actors.filter(p => p.bot); assert.equal(m.actors.length, 6); assert.ok(m.enemy(bots[0], bots[1]));
  Object.assign(bots[0], { x: 26, z: 20, yaw: 0, cooldown: 0 }); Object.assign(bots[1], { x: 26, z: 15 }); m.phase = 'live'; m.shoot(bots[0]); assert.ok(bots[1].hp < 100);
  assert.equal(new Match(['a'], { mode: 'ffa', fillBots: false }).actors.length, 2);
  const d = duel(); d.actors[0].hp = 40; d.actors[0].lastDamage = -100; tick(d, 1); assert.equal(d.actors[0].hp, 40); assert.equal(d.actors[0].armor, 40);
});
test('Quickscope fires one scoped body shot after a short windup and survives immediate release', () => {
  const m = duel(), [a, b] = line(m);
  m.input('a', { quickscope: true, yaw: 0, pitch: -0.1 }); m.input('a', { fire: false });
  assert.equal(a.input.aim, true); tick(m, 0.05); assert.equal(a.ammo, 6);
  tick(m, 0.1); assert.equal(a.ammo, 5); assert.equal(b.alive, false); assert.equal(m.stats.a.quickscopes, 1); assert.equal(m.stats.a.kills, 1);
  assert.equal(m.events.find(e => e.type === 'kill').quickscope, true); tick(m, 1); assert.equal(a.ammo, 5);
  assert.deepEqual(m.teamKills, [0, 0]);
});
test('Mouse-style quick aiming is recognized, prolonged aiming is not a quickscope', () => {
  const m = duel(); line(m); m.input('a', { aim: true }); tick(m, 0.1); m.input('a', { aim: true, fireTap: true }); tick(m, 0.05); assert.equal(m.stats.a.quickscopes, 1);
  const n = duel(); line(n); n.input('a', { aim: true }); tick(n, 0.5); n.input('a', { aim: true, fireTap: true }); tick(n, 0.05); assert.equal(n.stats.a.quickscopes || 0, 0); assert.equal(n.stats.a.kills, 1);
});
test('Quickscope rejects incompatible weapons and cancels on pointer cancellation, reset or switch', () => {
  for (const change of [{ cancelQuickscope: true }, { reset: true }, { weapon: 'rifle' }]) {
    const m = duel(), [a] = line(m); m.input('a', { quickscope: true }); m.input('a', change); tick(m, 0.5); assert.equal(m.stats.a.kills, 0); assert.equal(a.quickQueued, false);
    assert.equal(a.ammo, W.weapons[a.weapon].mag);
  }
  const m = duel(); m.input('a', { quickscope: true }); tick(m, 0.5); assert.equal(m.actors[0].ammo, 30);
  const n = duel(); const [a] = line(n); a.cooldown = 0.5; n.input('a', { quickscope: true }); tick(n, 0.2); assert.equal(a.ammo, 6); tick(n, 0.35); assert.equal(a.ammo, 5);
});
test('FFA win, draw, ranking and respawn depend on individual results, not team kills', () => {
  const m = duel(), [a] = line(m); m.stats.a.kills = 14; m.input('a', { quickscope: true }); tick(m, 0.2);
  assert.equal(m.phase, 'end'); assert.equal(m.result.winnerId, 'a'); assert.equal(m.events.filter(e => e.type === 'result').length, 1);
  const n = duel(); n.stats.a.kills = 3; n.stats.b.kills = 5; n.remaining = 0; n.step(1 / 60); assert.equal(n.result.winnerId, 'b'); assert.equal(ranking(n)[0].id, 'b');
  const tie = duel(); tie.stats.a.kills = tie.stats.b.kills = 3; tie.stats.a.deaths = 5; tie.remaining = 0; tie.step(1 / 60); assert.equal(tie.result.winnerId, null);
  const r = duel(); line(r); r.actors[0].alive = false; r.actors[0].respawn = 0.01; r.stats.a.kills = 4; tick(r, 0.05);
  assert.equal(r.actors[0].weapon, 'sniper'); assert.equal(r.actors[0].hp, 100); assert.ok(r.actors[0].spawnShield > 0); assert.equal(r.stats.a.kills, 4);
  assert.match(objective(r, r.actors[0]).title, /4 \/ 15/); assert.equal(objective(r, r.actors[0]).target, null);
});
