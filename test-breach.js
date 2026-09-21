'use strict';
const assert = require('node:assert/strict');
const { Match, blocked, pathTo, move } = require('./public/games/breach/simulation');
const W = require('./public/games/breach/world');
function test(name, fn) { fn(); console.log('✓ ' + name); }
function match(cfg = {}) {
  const m = new Match(['a', 'b'], { pvp: true, teams: { a: 0, b: 1 }, fillBots: false, target: 1, random: () => 0.5, ...cfg });
  m.phase = 'live'; m.remaining = 90; return m;
}
function tick(m, n, input = {}) { for (let t = 0; t < n; t++) { for (const [id, d] of Object.entries(input)) m.input(id, d); m.step(1 / 60); } }
test('All spawn points and both objectives are reachable without intersecting cover', () => {
  [...W.spawns, ...W.guards, ...W.sites].forEach(p => assert.equal(blocked(p.x, p.z), false));
  for (const a of W.spawns) for (const b of W.sites) assert.ok(pathTo(a, b).length > 0);
});
test('Swept collision stops players at walls and permits sliding', () => {
  const p = { x: 4, z: 24 }; move(p, -12, -12); assert.equal(blocked(p.x, p.z), false);
  move(p, 100, 0); assert.ok(p.x <= 28.65); assert.equal(blocked(p.x, p.z), false);
});
test('Headshots kill, report once and only damage opposing teams', () => {
  const m = match(), [a, b] = m.actors; Object.assign(a, { x: 26, z: 20, yaw: 0 }); Object.assign(b, { x: 26, z: 15 });
  m.shoot(a); assert.ok(b.hp < 60); a.cooldown = 0; m.shoot(a); assert.equal(b.alive, false); assert.equal(m.stats.a.kills, 1);
  tick(m, 2); assert.equal(m.phase, 'end'); assert.deepEqual(m.score, [1, 0]); assert.equal(m.events.filter(e => e.type === 'result').length, 1);
  const n = match(), [c, d] = n.actors; Object.assign(c, { x: 26, z: 20 }); Object.assign(d, { x: 26, z: 15, team: 0 }); n.shoot(c); assert.equal(d.hp, 100);
});
test('Cover blocks shots; smoke blocks bot sight', () => {
  const m = match(), [a, b] = m.actors; Object.assign(a, { x: 1, z: 20, yaw: 0 }); Object.assign(b, { x: 1, z: 3 });
  m.shoot(a); assert.equal(b.hp, 100); assert.equal(m.visible(a, b), false);
  Object.assign(a, { x: 26, z: 20 }); Object.assign(b, { x: 26, z: 5 }); assert.equal(m.visible(a, b), true);
  m.smokes.push({ x: 26, z: 12, r: 3, life: 10 }); assert.equal(m.visible(a, b), false);
});
test('Reload consumes reserve correctly and stale inputs stop movement/fire', () => {
  const m = match(), a = m.actors[0]; a.ammo = 1; a.reserve = 4; m.reload(a); m.shoot(a); assert.equal(a.ammo, 1);
  tick(m, 120); assert.equal(a.ammo, 5); assert.equal(a.reserve, 0);
  m.input('a', { forward: 1 }); tick(m, 100); const z = a.z; tick(m, 100); assert.equal(a.z, z);
  m.input('a', { forward: NaN, yaw: Infinity, pitch: Infinity }); tick(m, 1); assert.ok(Number.isFinite(a.x + a.z + a.yaw + a.pitch));
});
test('Only attackers plant; planting cancels when released and defenders can defuse', () => {
  const m = match(), [a, b] = m.actors; Object.assign(a, { x: -13, z: -6 }); Object.assign(b, { x: 16, z: -9 });
  tick(m, 180, { b: { use: true } }); assert.equal(m.bomb, null);
  tick(m, 90, { a: { use: true } }); assert.ok(a.plant > 1); tick(m, 1, { a: {} }); assert.equal(a.plant, 0);
  tick(m, 155, { a: { use: true } }); assert.equal(m.bomb.site, 'A');
  Object.assign(b, { x: -13, z: -6 }); tick(m, 120, { b: { use: true } }); assert.ok(m.bomb.defuse > 1.9);
  tick(m, 1, { b: {} }); assert.equal(m.bomb.defuse, 0);
  tick(m, 310, { b: { use: true } }); assert.equal(m.phase, 'end'); assert.equal(m.result.reason, 'Bombe entschärft');
});
test('Bomb can win after all attackers die; timer expiry favours defenders', () => {
  const m = match(); m.actors[0].alive = false; m.bomb = { x: -13, z: -6, left: 0.1, defuse: 0, defuser: null }; tick(m, 10);
  assert.equal(m.result.team, 0); assert.equal(m.result.reason, 'Ziel zerstört');
  const n = match(); n.remaining = 0.01; tick(n, 1); assert.equal(n.result.team, 1);
});
test('Deathmatch respawns with clean controls and ends at the time limit', () => {
  const m = match({ mode: 'deathmatch' }); m.actors[0].alive = false; m.actors[0].respawn = 0.1; tick(m, 10);
  assert.equal(m.actors[0].alive, true); assert.equal(m.actors[0].hp, 100); m.remaining = 0.01; tick(m, 1); assert.equal(m.phase, 'end');
  assert.equal(m.result.team, null);
  const n = match({ mode: 'deathmatch' }); n.teamKills = [2, 5]; n.remaining = 0.01; tick(n, 1); assert.equal(n.result.team, 1);
});
test('PvP fills both sides, independent controls and rematches preserve chosen loadouts', () => {
  const m = new Match(['a', 'b'], { pvp: true, teams: { a: 0, b: 1 } });
  assert.equal(m.actors.filter(a => a.team === 0).length, 3); assert.equal(m.actors.filter(a => a.team === 1).length, 3);
  m.input('a', { weapon: { toString: 'invalid' } }); assert.equal(m.actors[0].weapon, 'rifle');
  m.input('a', { weapon: 'pistol' }); assert.equal(m.actors[0].weapon, 'pistol'); m.resetRound(); assert.equal(m.actors[0].weapon, 'pistol');
  m.phase = 'live'; const before = m.actors[1].z; tick(m, 10, { a: { forward: 1 } }); assert.equal(m.actors[1].z, before);
});
test('A released tap fires once, survives cooldown, and reset cancels pending fire', () => {
  const m = match(), a = m.actors[0]; a.cooldown = 0.08;
  m.input('a', { fire: true, fireTap: true }); m.input('a', { fire: false });
  tick(m, 15); assert.equal(a.ammo, 29); assert.ok(m.events.some(e => e.type === 'shot'));
  tick(m, 15); assert.equal(a.ammo, 29);
  a.cooldown = 0.2; m.input('a', { fireTap: true }); m.input('a', { reset: true }); tick(m, 30); assert.equal(a.ammo, 29);
});
test('Every weapon auto-reloads after its last shot, including released triggers and partial reserves', () => {
  assert.equal(Object.keys(W.weapons).length, 10);
  for (const [key, weapon] of Object.entries(W.weapons)) {
    const m = match(), a = m.actors[0]; m.switchWeapon(a, key); a.cooldown = 0; a.ammo = 1; a.reserve = 3;
    m.input('a', { fireTap: true }); tick(m, 1); assert.equal(a.ammo, 0, key); assert.ok(a.reload > 0, key);
    tick(m, Math.ceil(weapon.reload * 60) + 2, { a: {} }); assert.equal(a.ammo, 3, key); assert.equal(a.reserve, 0, key);
    assert.equal(a.reload, 0); assert.equal(m.events.filter(e => e.type === 'loaded').length, 1);
  }
});
test('Held fire continues after automatic reload and selecting weapons never refills inventory', () => {
  const m = match(), a = m.actors[0]; a.ammo = 1;
  tick(m, 100, { a: { fire: true } }); assert.ok(a.reserve < W.weapons.rifle.reserve); assert.ok(a.ammo < 30 && a.ammo > 0);
  const ammo = a.ammo, reserve = a.reserve; m.input('a', { weapon: 'shotgun' }); assert.equal(a.ammo, 8);
  m.input('a', { weapon: 'rifle' }); assert.equal(a.ammo, ammo); assert.equal(a.reserve, reserve);
  m.input('a', { reload: true }); assert.ok(a.reload > 0); m.input('a', { weapon: 'pistol' }); assert.equal(a.reload, 0);
  m.input('a', { weapon: 'rifle' }); assert.equal(a.ammo, ammo);
});
test('Pulse fires one three-round burst per tap; shotgun emits eight pellets and one sound', () => {
  const m = match(), a = m.actors[0]; m.switchWeapon(a, 'burst'); a.cooldown = 0;
  m.input('a', { fireTap: true }); tick(m, 35, { a: {} }); assert.equal(a.ammo, 27); assert.equal(m.events.filter(e => e.type === 'shot').length, 3);
  m.switchWeapon(a, 'shotgun'); a.cooldown = 0; m.events.length = 0; m.input('a', { fireTap: true }); tick(m, 1);
  assert.equal(a.ammo, 7); assert.equal(m.events.filter(e => e.type === 'shot').length, 8); assert.equal(m.events.filter(e => e.type === 'shot' && e.audible).length, 1);
});
test('Easy co-op is forgiving; PvP retains equal human health and no healing or aim magnetism', () => {
  const easy = new Match(['a', 'b']), hard = new Match(['a', 'b'], { difficulty: 'hard' });
  assert.equal(easy.cfg.difficulty, 'easy'); assert.equal(easy.actors.filter(a => a.bot).length, 3); assert.equal(easy.actors[0].armor, 65);
  assert.ok(easy.actors.filter(a => a.bot).length < hard.actors.filter(a => a.bot).length);
  easy.phase = 'live'; easy.remaining = 90; easy.actors.filter(a => a.bot).forEach(a => { a.cooldown = 999; }); easy.actors[0].hp = 40; easy.actors[0].lastDamage = easy.time;
  tick(easy, 350); assert.equal(easy.actors[0].hp, 40); tick(easy, 130); assert.ok(easy.actors[0].hp > 50);
  const pvp = match(), [a, b] = pvp.actors; a.hp = 40; tick(pvp, 480); assert.equal(a.hp, 40); assert.equal(a.armor, b.armor);
  Object.assign(a, { x: 26, z: 20, yaw: 0.06, pitch: -0.05 }); Object.assign(b, { x: 26, z: 10 });
  pvp.input('a', { assist: true }); pvp.shoot(a); assert.equal(b.hp, 100);
});
console.log('BREACH simulation checks passed.');

test('Deathmatch respawns have brief protection, cancelled by firing, and avoid occupied spawns', () => {
  const m = match({ mode: 'deathmatch' }); m.actors[0].alive = false; m.actors[0].respawn = 0.01; tick(m, 1);
  const [a, b] = m.actors; assert.ok(a.spawnShield > 1.9);
  Object.assign(a, { x: 26, z: 15 }); Object.assign(b, { x: 26, z: 20, yaw: 0 });
  m.shoot(b); assert.equal(a.hp, 100); assert.equal(a.armor, 40); assert.equal(b.hit, 0);
  m.shoot(a); assert.equal(a.spawnShield, 0); b.cooldown = 0; m.shoot(b); assert.ok(a.hp < 100);
  const n = match({ mode: 'deathmatch' }); n.actors[0].spawnShield = 0.03; tick(n, 3); assert.equal(n.actors[0].spawnShield, 0);
  const crowded = new Match(['a', 'b', 'c'], { mode: 'deathmatch', pvp: true, teams: { c: 1 }, fillBots: false });
  crowded.phase = 'live'; crowded.remaining = 90; crowded.actors.slice(0, 2).forEach(p => { p.alive = false; p.respawn = 0.01; }); tick(crowded, 1);
  assert.ok(Math.hypot(crowded.actors[0].x - crowded.actors[1].x, crowded.actors[0].z - crowded.actors[1].z) > 1.2);
});
test('Eight defenders have distinct valid spawns and bots keep truthful statistics', () => {
  const ids = Array.from({ length: 8 }, (_, i) => String(i)), teams = Object.fromEntries(ids.map(id => [id, 1]));
  const m = new Match(ids, { pvp: true, teams, fillBots: false });
  assert.equal(new Set(m.actors.map(p => p.x + ',' + p.z)).size, 8); m.actors.forEach(p => assert.equal(blocked(p.x, p.z), false));
  const n = new Match(['a'], { random: () => 0.5 }); n.phase = 'live'; const human = n.actors[0], bot = n.actors[1];
  Object.assign(human, { x: 26, z: 15, hp: 1, armor: 0 }); Object.assign(bot, { x: 26, z: 20, yaw: 0, cooldown: 0 });
  n.shoot(bot); assert.equal(n.stats[bot.id].kills, 1); assert.equal(n.stats.a.deaths, 1);
});
test('A bot cannot bank planting progress while fighting or moving between sites', () => {
  const m = new Match(['a'], { pvp: true, teams: { a: 1 }, random: () => 0.5 }); m.phase = 'live';
  const bot = m.actors.find(p => p.bot && p.team === 0), enemy = m.actors.find(p => p.team === 1);
  Object.assign(bot, { x: 26, z: 20, plant: 2, cooldown: 999 }); Object.assign(enemy, { x: 26, z: 15 }); m.bot(bot, 1 / 60); assert.equal(bot.plant, 0);
  m.actors.filter(p => p.team === 1).forEach(p => { p.alive = false; }); bot.plant = 2; m.bot(bot, 1 / 60); assert.equal(bot.plant, 0);
});
