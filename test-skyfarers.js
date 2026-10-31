// Regeltests Skyfarers: Welt (world.js), Simulation (sim.js), Bots, Determinismus, Balance, Performance.
const fs = require('fs');
const World = require('./public/games/skyfarers/world.js');
const Sim = require('./public/games/skyfarers/sim.js');
const C = Sim.CONST, B = World.BUILDINGS;

let checks = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function eq(a, b, msg) { checks++; if (a !== b) fail(msg + ' (erwartet ' + b + ', war ' + a + ')'); }
function near(a, b, tol, msg) { checks++; if (!(Math.abs(a - b) <= tol)) fail(msg + ' (erwartet ' + b + ' ±' + tol + ', war ' + a + ')'); }

// ---- helpers ----
// A world with islets at known places (static) and no initial clouds, so scenarios are not disturbed.
function fixedWorld(seed) {
  const w = JSON.parse(JSON.stringify(World.make(seed || 1)));
  const at = [[50, 30], [0, 38], [-50, 30], [0, -38], [50, -30], [-65, 0], [-50, -30]];
  w.islets.forEach((o, i) => { o.ax = at[i][0]; o.ay = at[i][1]; o.orbitR = 0; });
  w.clouds = [];
  return w;
}
const ISL = { kristall0: [50, 30], holz1: [0, 38] };
function mk(o) {
  o = o || {};
  return Sim.create({ seed: o.seed || 1, world: o.world || fixedWorld(o.seed), dauer: o.dauer || 'kurz', schwierigkeit: o.schwierigkeit || 'normal',
    captains: o.captains || [{ pid: 1 }, { pid: 2 }] });
}
const ship = (sim, pid) => sim.state.ships.find(s => s.pid === pid);
function place(sim, pid, x, y, vx, vy) { const s = ship(sim, pid); s.x = s.px = x; s.y = s.py = y; s.vx = vx || 0; s.vy = vy || 0; return s; }
function run(sim, n, fn) { const log = []; for (let i = 0; i < n && !sim.state.over; i++) { if (fn) fn(sim, i); log.push(...sim.step()); } return log; }
// advance until sim time >= t; god = keep the heart topped up
function advanceTo(sim, t, god, fn) {
  const log = [];
  while (sim.state.t < t - 1e-9 && !sim.state.over) { if (god) sim.state.herz = 100; if (fn) fn(sim); log.push(...sim.step()); }
  return log;
}
function put(sim, i, kind, extra) {
  const sl = sim.state.slots[i];
  Object.assign(sl, { kind, stage: kind === 'sternwarte' ? 1 : 1, build: 1, hp: B[kind].hp, fire: 0, ruined: false }, extra || {});
  return sl;
}
const count = (log, t) => log.filter(e => e.t === t).length;
function allFinite(o) {
  if (typeof o === 'number') return isFinite(o);
  if (o && typeof o === 'object') return Object.values(o).every(allFinite);
  return true;
}

// ---- catalogs ----
{
  eq(World.DAUER.kurz, 240, 'DAUER kurz'); eq(World.DAUER.normal, 360, 'DAUER normal'); eq(World.DAUER.lang, 480, 'DAUER lang');
  const ev = (d) => World.EVENTS[d].map(e => e.kind + ':' + e.at + '-' + e.until).join(' ');
  eq(ev('kurz'), 'sturm:70-110 nacht:185-235', 'EVENTS kurz');
  eq(ev('normal'), 'sturm:90-135 drachen:210-250 nacht:300-355', 'EVENTS normal');
  eq(ev('lang'), 'sturm:90-135 drachen:200-240 sturm:300-345 nacht:410-470', 'EVENTS lang');
  const cost = (k) => B[k].cost.holz + 'h' + B[k].cost.kristall + 'k/' + B[k].buildS + 's/' + B[k].hp + 'hp/' + B[k].stages;
  eq(cost('windrad'), '2h1k/6s/60hp/1', 'Windrad'); eq(cost('kanone'), '3h2k/10s/80hp/1', 'Kanone'); eq(cost('zisterne'), '3h0k/8s/70hp/1', 'Zisterne');
  eq(cost('werkstatt'), '2h2k/8s/70hp/1', 'Werkstatt'); eq(cost('sternwarte'), '9h9k/12s/120hp/3', 'Sternwarte');
  eq(World.DIFF.leicht.lightning + '/' + World.DIFF.normal.lightning + '/' + World.DIFF.heftig.lightning, '3.5/2.5/1.6', 'DIFF Blitz');
  eq(JSON.stringify(World.DIFF.heftig.dragons) + World.DIFF.leicht.fire + World.DIFF.heftig.fire, '{"drachen":4,"nacht":3}0.030.06', 'DIFF Drachen/Feuer');
  eq(JSON.stringify(World.DIFF.leicht.start) + JSON.stringify(World.DIFF.normal.start), '{"holz":4,"kristall":2}{"holz":2,"kristall":0}', 'DIFF Startvorrat');
  eq(C.DT, 1 / 30, 'CONST.DT'); eq(C.SPEED, 12, 'CONST.SPEED'); eq(C.WATER_CAP, 3, 'CONST.WATER_CAP');
}

// ---- world generation ----
{
  const sig = (w) => JSON.stringify(w);
  for (let seed = 1; seed <= 60; seed++) {
    const w = World.make(seed);
    eq(w.w, 160, 'Welt-Breite'); eq(w.h, 100, 'Welt-Höhe'); eq(w.seed, seed, 'Seed gemerkt');
    eq(w.islets.filter(o => o.kind === 'kristall').length, 4, 'seed ' + seed + ': 4 Kristallfelsen');
    eq(w.islets.filter(o => o.kind === 'holz').length, 3, 'seed ' + seed + ': 3 Holzinseln');
    let good = true;
    for (const a of w.islets) {
      const ring = Math.hypot(a.ax / 1.5, a.ay);
      if (ring < 29.9 || ring > 46.1) good = false;
      if (Math.abs(a.ax) + a.r + a.orbitR > 80 || Math.abs(a.ay) + a.r + a.orbitR > 50) good = false;
      if (a.orbitR < 2 || a.orbitR > 4 || a.orbitT < 60 || a.orbitT > 120) good = false;
      for (const b of w.islets) if (a !== b && Math.hypot(a.ax - b.ax, a.ay - b.ay) < 14) good = false;
    }
    ok(good, 'seed ' + seed + ': Ring, Abstand >= 14, Grenzen, Orbit-Parameter');
    ok(w.clouds.length >= 2 && w.clouds.length <= 3, 'seed ' + seed + ': 2-3 Anfangswolken');
    eq(w.home.slots.length, 7, '7 Bauplätze');
    near(Math.hypot(w.home.slots[3].x, w.home.slots[3].y), 10, 1e-9, 'Ringplatz Radius 10');
    eq(sig(w), sig(World.make(seed)), 'seed ' + seed + ': deterministisch');
  }
  ok(sig(World.make(1)) !== sig(World.make(2)), 'verschiedene Seeds -> verschiedene Welten');
  const isl = World.make(5).islets[0], p0 = World.isletPos(isl, 0), p1 = World.isletPos(isl, isl.orbitT), pm = World.isletPos(isl, 10);
  near(p0.x, p1.x, 1e-9, 'isletPos periodisch x'); near(p0.y, p1.y, 1e-9, 'isletPos periodisch y');
  near(Math.hypot(pm.x - isl.ax, pm.y - isl.ay), isl.orbitR, 1e-9, 'isletPos liegt auf dem Orbit');
  eq(JSON.stringify(World.isletPos(isl, 33)), JSON.stringify(World.isletPos(isl, 33)), 'isletPos rein');
}

// ---- state shape ----
{
  const sim = mk({ captains: [{ pid: 1 }, { pid: -1, bot: true }] });
  const s = sim.state;
  eq(Object.keys(s).join(), 't,dayT,over,survived,stars,herz,energy,shieldOn,stock,wind,event,next,ships,slots,islets,clouds,gusts,drops,dragons,strikes', 'State-Felder');
  eq(Object.keys(s.ships[0]).join(), 'pid,bot,x,y,px,py,vx,vy,h,ph,boost,boosting,cargo,cap,water,act,acting,docked,stunned,score,stats', 'Schiff-Felder');
  eq(Object.keys(s.ships[0].stats).join(), 'delivered,built,fires,dragonHits,repairs', 'Stats-Felder');
  eq(Object.keys(s.slots[0]).join(), 'i,kind,stage,build,hp,fire,ruined', 'Slot-Felder');
  eq(Object.keys(s.islets[0]).join(), 'id,kind,x,y,px,py,amount,max', 'Islet-Felder');
  eq(s.slots.length, 7, '7 Slots'); eq(s.slots[3].kind, null, 'leerer Slot kind null');
  eq(s.herz, 100, 'Herz 100'); eq(s.over, false, 'läuft'); eq(sim.dt, 1 / 30, 'sim.dt');
  eq(s.next.kind + s.next.at, 'sturm70', 'next am Anfang');
  eq(s.ships[1].bot, true, 'Bot markiert');
  eq(JSON.stringify(s.stock), '{"holz":2,"kristall":0}', 'Startvorrat normal');
  eq(JSON.stringify(mk({ schwierigkeit: 'leicht' }).state.stock), '{"holz":4,"kristall":2}', 'Startvorrat leicht');
  eq(JSON.stringify(mk({ schwierigkeit: 'heftig' }).state.stock), '{"holz":0,"kristall":0}', 'Startvorrat heftig');
  ok(s.ships[0].docked && s.ships[0].cargo.holz === 0 && s.ships[0].cap === 6, 'Schiff startet am Dock, cap 6');
  sim.step(); ok(allFinite(sim.state), 'State endlich');
}

// ---- movement, input ----
{
  const sim = mk();
  place(sim, 1, 30, 0);
  sim.input(1, { sx: 1, sy: 0 });
  run(sim, 60);
  const s = ship(sim, 1);
  near(s.vx, 12, 0.05, 'volle Fahrt = SPEED'); near(s.h, 0, 0.01, 'Kurs folgt der Fahrt');
  sim.input(1, { sx: 3, sy: 4 }); run(sim, 90);
  near(Math.hypot(s.vx, s.vy), 12, 0.05, 'Stick wird auf die Einheitsscheibe geklemmt');
  near(Math.atan2(s.vy, s.vx), Math.atan2(4, 3), 0.02, 'geklemmter Stick behält die Richtung');
  // turn rate
  place(sim, 1, 0, -30, 12, 0); s.h = 0; sim.input(1, { sx: 0, sy: -1 });
  const h0 = s.h; run(sim, 3); ok(Math.abs(s.h - h0) <= C.TURN * sim.dt * 3 + 1e-9, 'Drehrate <= TURN');
  // garbage input
  place(sim, 1, 30, 0); sim.input(1, { sx: NaN, sy: Infinity, boost: 0, act: 0 });
  run(sim, 40); near(Math.hypot(s.vx, s.vy), 0, 1e-6, 'NaN/Infinity -> Stick 0');
  sim.input(99, { sx: 1, sy: 1 }); sim.input(1, null); sim.input(1, {}); ok(true, 'unbekannte pid / leere Eingabe ignoriert');
  // partial inputs keep the rest
  sim.input(1, { sx: 1 }); sim.input(1, { sy: 0 }); run(sim, 30); ok(s.vx > 5, 'Teil-Eingaben bleiben erhalten');
  // acceleration limit
  place(sim, 1, 30, 0); sim.input(1, { sx: 1, sy: 0 }); run(sim, 6);
  ok(s.vx <= C.ACCEL * 6 * sim.dt + 1e-6, 'Beschleunigung <= ACCEL');
  // boost
  place(sim, 1, -40, 10); sim.input(1, { sx: 1, sy: 0, boost: true }); const b0 = s.boost; run(sim, 50);
  ok(s.boosting && s.boost < b0 - 0.3, 'Boost verbraucht'); near(Math.hypot(s.vx, s.vy), 12 * C.BOOST_MUL, 0.1, 'Boost-Tempo');
  sim.input(1, { sx: 0, sy: 0, boost: false }); run(sim, 60); ok(!s.boosting, 'Boost aus');
  const b1 = s.boost; run(sim, 30); near(s.boost - b1, C.BOOST_REGEN, 0.003, 'Boost lädt mit BOOST_REGEN');
  s.boost = 0; sim.input(1, { sx: 1, sy: 0, boost: true }); run(sim, 5); ok(!s.boosting, 'ohne Boost kein Boosten');
  // island and edges
  place(sim, 1, 30, 0); sim.input(1, { sx: -1, sy: 0, boost: false }); let minD = 99; run(sim, 150, () => { minD = Math.min(minD, Math.hypot(s.x, s.y)); });
  ok(minD >= C.HOME_R + 1.2 - 1e-6, 'Schiff dringt nicht in die Heimatinsel ein (' + minD.toFixed(2) + ')');
  place(sim, 1, 70, 0); sim.input(1, { sx: 1, sy: 0, boost: true }); s.boost = 1; run(sim, 200);
  ok(s.x <= 79.01 && s.x > 60, 'Rand: weich zurückgedrückt, nie hinaus (' + s.x.toFixed(1) + ')');
  place(sim, 1, 0, 40); sim.input(1, { sx: 0, sy: 1, boost: false }); run(sim, 200); ok(s.y <= 49.01, 'Rand y');
  // islet collision
  place(sim, 1, ISL.kristall0[0] + 20, ISL.kristall0[1]); sim.input(1, { sx: -1, sy: 0 });
  let minI = 99; run(sim, 120, () => { minI = Math.min(minI, Math.hypot(s.x - ISL.kristall0[0], s.y - ISL.kristall0[1])); });
  ok(minI >= 4 + 1.2 - 1e-6, 'Schiff dringt nicht in Inseln ein');
  // ship-ship push
  const t = mk(); place(t, 1, 40, 0); place(t, 2, 40.2, 0); run(t, 30);
  ok(Math.hypot(ship(t, 1).x - ship(t, 2).x, ship(t, 1).y - ship(t, 2).y) > 2.2, 'Schiffe schieben sich auseinander');
  // prev values
  const u = mk(); place(u, 1, 30, 0); u.input(1, { sx: 1, sy: 0 }); const x0 = ship(u, 1).x; u.step();
  eq(ship(u, 1).px, x0, 'px = x vom Schritt davor');
  eq(u.state.islets[0].px, u.state.islets[0].x, 'Islet px (statisch)');
  const mv = Sim.create({ seed: 3, dauer: 'kurz', captains: [{ pid: 1 }] }); const i0 = mv.state.islets[0].x; mv.step();
  eq(mv.state.islets[0].px, i0, 'Islet px = vorheriges x'); ok(mv.state.islets[0].x !== i0, 'Islets driften');
}

// ---- docking, unloading, crates ----
{
  const sim = mk(); const s = ship(sim, 1);
  place(sim, 1, 30, 0); run(sim, 1);
  const log = [];
  place(sim, 1, 19, 0); s.cargo.holz = 2; s.cargo.kristall = 1;
  log.push(...run(sim, 1)); ok(s.docked, 'am Dock (r<=21, langsam) = docked'); eq(count(log, 'dock'), 1, 'dock-Event');
  const s0 = JSON.stringify(sim.state.stock);
  log.push(...run(sim, 3)); eq(JSON.stringify(sim.state.stock), s0, 'noch nichts abgeladen (<0.15 s)');
  log.push(...run(sim, 3)); eq(sim.state.stock.holz + sim.state.stock.kristall, 2 + 1, 'erste Einheit nach ~0.15 s');
  log.push(...run(sim, 30));
  eq(sim.state.stock.holz, 2 + 2, 'Holz abgeladen'); eq(sim.state.stock.kristall, 1, 'Kristall abgeladen');
  eq(s.cargo.holz + s.cargo.kristall, 0, 'Frachtraum leer'); eq(count(log, 'unload'), 3, '3 unload-Events'); eq(s.stats.delivered, 3, 'delivered');
  place(sim, 1, 19, 0, 10, 0); sim.input(1, { sx: 1, sy: 0 }); run(sim, 1); ok(!s.docked, 'zu schnell = nicht docked'); eq(s.docked, false, 'undock');
  place(sim, 1, 30, 0); sim.input(1, { sx: 0, sy: 0 }); const lg = run(sim, 2); ok(!s.docked, 'außerhalb DOCK_R nicht docked'); ok(count(lg, 'undock') <= 1, 'undock-Event');
  // crates and stun
  const t = mk(); const a = ship(t, 1);
  place(t, 1, -30, 0); a.cargo.holz = 3; a.cargo.kristall = 2;
  t.state.strikes.push({ id: 900, x: -30, y: 0, at: 0.01, target: 'ship', pid: 1 });
  const lg2 = run(t, 2);
  ok(a.stunned > 0 && count(lg2, 'stun') === 1, 'Blitz auf Schiff betäubt'); eq(a.cargo.holz + a.cargo.kristall, 2, 'halbe Fracht (aufgerundet) verloren');
  eq(t.state.drops.length, 1, 'eine Kiste'); eq(t.state.drops[0].holz + t.state.drops[0].kristall, 3, 'Kiste enthält 3'); eq(count(lg2, 'drop'), 1, 'drop-Event');
  t.input(1, { sx: 1, sy: 0 }); run(t, 30); ok(Math.hypot(a.vx, a.vy) <= 12 * C.STUN_SPEED + 0.2, 'betäubt: 40 % Tempo');
  t.state.strikes.push({ id: 901, x: a.x, y: a.y, at: 0.01, target: 'ship', pid: 1 }); const lg3 = run(t, 2); eq(count(lg3, 'stun'), 0, 'betäubt: keine doppelte Betäubung');
  run(t, 60); eq(a.stunned, 0, 'Betäubung endet nach 2.5 s');
  const d = t.state.drops[0]; place(t, 2, d.x, d.y); const lg4 = run(t, 40);
  eq(count(lg4, 'pickup'), 1, 'pickup-Event'); eq(ship(t, 2).cargo.holz + ship(t, 2).cargo.kristall, 3, 'Kiste aufgesammelt'); eq(t.state.drops.length, 0, 'Kiste weg');
  // full hold: partial pickup
  const f = mk(); place(f, 1, 30, 30); ship(f, 1).cargo.holz = 5; f.state.drops.push({ id: 1, x: 30, y: 30, holz: 3, kristall: 0, age: 0 }); run(f, 2); eq(ship(f, 1).cargo.holz, 5, 'frische Kiste: Aufnahme-Verzögerung'); run(f, 30);
  eq(ship(f, 1).cargo.holz, 6, 'Kiste füllt nur bis cap'); eq(f.state.drops[0].holz, 2, 'Rest bleibt liegen');
  // fade
  const g = mk(); g.state.drops.push({ id: 5, x: 20, y: 40, holz: 1, kristall: 0, age: 0 }); run(g, 29 * 30); eq(g.state.drops.length, 1, 'Kiste nach 29 s noch da');
  run(g, 2 * 30); eq(g.state.drops.length, 0, 'Kiste verblasst nach 30 s');
  // removeCaptain
  const r = mk(); place(r, 2, 30, 30); ship(r, 2).cargo.kristall = 4; eq(r.removeCaptain(2), true, 'removeCaptain'); eq(r.state.ships.length, 1, 'Schiff weg');
  eq(r.state.drops.length, 1, 'Fracht als Kiste'); eq(r.state.drops[0].kristall, 4, 'ganze Fracht'); eq(r.removeCaptain(2), false, 'zweites Mal false');
  eq(r.addCaptain(7, false), true, 'addCaptain'); eq(r.addCaptain(7, false), false, 'doppelte pid'); r.input(7, { sx: 1 }); r.step();
  const many = mk({ captains: [] }); for (let i = 1; i <= 10; i++) many.addCaptain(i); eq(many.state.ships.length, 8, 'höchstens 8 Schiffe');
}

// ---- harvest and regrow ----
{
  const sim = mk(); const s = ship(sim, 1), isl = sim.state.islets[0];
  place(sim, 1, ISL.kristall0[0], ISL.kristall0[1] + 6); sim.input(1, { act: true });
  run(sim, 1); eq(s.act, 'harvest', 'act = harvest am Kristallfelsen');
  eq(s.cargo.kristall, 1, 'erste Einheit sofort'); eq(isl.amount, C.CRYSTAL_MAX - 1, 'Vorrat sinkt');
  run(sim, Math.round(C.HARVEST_S * 30) - 4); eq(s.cargo.kristall, 1, 'nicht schneller als HARVEST_S');
  const lg = run(sim, 8); eq(s.cargo.kristall, 2, 'zweite Einheit nach HARVEST_S'); eq(count(lg, 'harvest'), 1, 'harvest-Event');
  run(sim, 30 * 40); eq(s.cargo.holz + s.cargo.kristall, 6, 'Fracht bis cap'); eq(s.act, 'horn', 'voller Laderaum -> kein harvest');
  // wood
  const w = mk(); place(w, 1, ISL.holz1[0], ISL.holz1[1] - 6); w.input(1, { act: true }); run(w, 1);
  eq(ship(w, 1).act, 'harvest', 'Holz ernten'); eq(ship(w, 1).cargo.holz, 1, 'Holz +1'); eq(w.state.islets[1].max, 10, 'Holzinsel 10');
  // regrow
  const r = mk(); r.state.islets[0].amount = 0; r.state.islets[1].amount = 0;
  run(r, C.CRYSTAL_REGROW * 30 - 3); eq(r.state.islets[0].amount, 0, 'noch kein Nachwuchs'); run(r, 6); eq(r.state.islets[0].amount, 1, 'Kristall wächst nach');
  run(r, 30 * (C.WOOD_REGROW * 2 - C.CRYSTAL_REGROW) + 5); eq(r.state.islets[1].amount, 2, 'Holz wächst nach (2 Einheiten)');
  const x = mk(); run(x, 30 * 200); eq(x.state.islets[0].amount, 8, 'nie über max');
  // empty node: no harvest
  const e = mk(); e.state.islets[0].amount = 0; place(e, 1, ISL.kristall0[0], ISL.kristall0[1] + 6); e.input(1, { act: true }); run(e, 1); eq(ship(e, 1).act, 'horn', 'leerer Fels: keine Ernte');
}

// ---- building: costs, slots, stages, ruins ----
{
  const sim = mk(); const s = ship(sim, 1);
  place(sim, 1, 19, 0); run(sim, 1);
  eq(sim.build(1, 'foo').reason, 'unknown', 'unbekannte Art'); eq(sim.build(77, 'windrad').reason, 'unknown', 'unbekannte pid');
  eq(sim.build(1, 'toString').reason, 'unknown', 'Prototyp-Name abgelehnt');
  eq(sim.build(1, 'windrad').reason, 'cost', 'zu wenig Vorrat'); eq(sim.state.stock.holz, 2, 'nichts abgebucht');
  Object.assign(sim.state.stock, { holz: 100, kristall: 100 });
  place(sim, 2, 40, -40); run(sim, 1); eq(sim.build(2, 'windrad').reason, 'notDocked', 'nicht am Dock');
  const r = sim.build(1, 'windrad'); ok(r.ok, 'Windrad bestellt'); eq(sim.state.stock.holz, 98, 'Holz abgebucht'); eq(sim.state.stock.kristall, 99, 'Kristall abgebucht');
  eq(sim.state.slots[6].kind, 'windrad', 'erster Platz: im Uhrzeigersinn ab Schiffsseite (Slot 6 bei Winkel 0)');
  eq(s.stats.built, 1, 'built-Statistik'); eq(sim.state.slots[6].build, 0, 'Bau beginnt bei 0');
  ok(sim.build(1, 'zisterne').ok, 'zweite Bestellung'); eq(sim.state.slots[5].kind, 'zisterne', 'nächster Platz im Uhrzeigersinn (Slot 5)');
  const lg = run(sim, 6 * 30 + 3); eq(count(lg, 'buildDone'), 1, 'Windrad nach 6 s fertig'); eq(sim.state.slots[6].build, 1, 'build = 1'); eq(sim.state.slots[5].build < 1, true, 'Zisterne braucht länger (8 s)');
  eq(sim.state.slots[6].hp, 60, 'hp = Katalog');
  ok(sim.build(1, 'kanone').ok && sim.build(1, 'werkstatt').ok && sim.build(1, 'kanone').ok && sim.build(1, 'windrad').ok, '6 Ringplätze belegbar');
  eq(sim.build(1, 'kanone').reason, 'noSlot', 'Ring voll -> noSlot');
  // Sternwarte stages
  eq(sim.build(1, 'sternwarte').ok, true, 'Sternwarte Stufe 1'); eq(sim.state.slots[0].kind, 'sternwarte', 'Sternwarte in der Mitte');
  eq(sim.build(1, 'sternwarte').reason, 'stage', 'Stufe 2 erst nach Stufe 1'); eq(sim.state.stock.holz, sim.state.stock.holz, '');
  const h0 = sim.state.stock.holz;
  run(sim, 12 * 30 + 3); eq(sim.state.slots[0].build, 1, 'Stufe 1 fertig nach 12 s');
  ok(sim.build(1, 'sternwarte').ok, 'Stufe 2'); eq(sim.state.slots[0].stage, 2, 'stage 2'); eq(sim.state.slots[0].build, 0, 'build zurückgesetzt');
  eq(sim.state.stock.holz, h0 - 9, 'Stufe 2 kostet 9 Holz'); eq(sim.state.slots[0].hp, 120, 'Sternwarte hp 120');
  run(sim, 12 * 30 + 3); ok(sim.build(1, 'sternwarte').ok, 'Stufe 3'); run(sim, 12 * 30 + 3);
  eq(sim.build(1, 'sternwarte').reason, 'stage', 'nach Stufe 3 nichts mehr');
  // ruins and rebuild
  const w = sim.state.slots[6]; w.hp = 0; w.fire = 0.5;
  const lr = run(sim, 1); eq(count(lr, 'ruined'), 1, 'ruined-Event'); eq(w.ruined, true, 'Slot ruiniert'); eq(w.fire, 0, 'Feuer aus bei Ruine'); eq(w.kind, 'windrad', 'Art bleibt');
  const st0 = JSON.stringify(sim.state.stock);
  ok(sim.build(1, 'windrad').ok, 'Wiederaufbau'); eq(sim.state.slots[6].ruined, false, 'nicht mehr ruiniert'); eq(sim.state.slots[6].build, 0, 'Wiederaufbau startet bei 0');
  eq(sim.state.slots[6].hp, 60, 'volle hp');
  eq(sim.state.stock.holz, JSON.parse(st0).holz - 1, 'Wiederaufbau 50 % (Holz 2 -> 1)'); eq(sim.state.stock.kristall, JSON.parse(st0).kristall - 1, 'Wiederaufbau 50 % (Kristall 1 -> 1)');
  eq(sim.state.slots.filter(x => x.kind === 'windrad').length, 2, 'kein zusätzlicher Platz belegt');
  // ruined Sternwarte keeps stage
  const c = sim.state.slots[0]; c.hp = -1; run(sim, 1);
  eq(c.ruined, true, 'Sternwarte ruiniert'); eq(c.stage, 3, 'Stufenzahl bleibt'); eq(sim.state.over, false, 'Spiel läuft');
  ok(sim.build(1, 'sternwarte').ok, 'Sternwarte wiederaufbauen'); eq(c.stage, 3, 'Stufe bleibt 3'); eq(c.ruined, false, 'repariert');
  // can't order a second Sternwarte elsewhere while ring stays; the 50% rounds up (Sternwarte 4 -> 2)
}

// ---- working buildings ----
{
  const sim = mk(); place(sim, 1, 19, 0); run(sim, 1);
  put(sim, 1, 'werkstatt'); run(sim, 1);
  eq(ship(sim, 1).cap, 8, 'Werkstatt: cap +2');
  sim.state.slots[1].fire = 0.5; run(sim, 1); eq(ship(sim, 1).cap, 6, 'brennende Werkstatt arbeitet nicht');
  sim.state.slots[1].fire = 0;
  put(sim, 2, 'windrad'); const hp0 = (sim.state.slots[2].hp = 30); run(sim, 30); near(sim.state.slots[2].hp, hp0 + C.WERK_HEAL, 0.1, 'Werkstatt heilt 2 HP/s');
  // energy
  const e = mk(); put(e, 1, 'windrad'); put(e, 2, 'windrad'); run(e, 30); near(e.state.energy, 4 * C.ENERGY_GEN / 2, 0.1, 'Energie +2/s pro Windrad (außerhalb von Stürmen)');
  run(e, 30 * 100); eq(e.state.energy, 100, 'Energie Deckel 100');
  // zisterne refills water
  const z = mk(); put(z, 1, 'zisterne'); place(z, 1, 19, 0); run(z, 1); eq(ship(z, 1).water, 3, 'Zisterne füllt Wasser am Dock');
  const nz = mk(); place(nz, 1, 19, 0); run(nz, 5); eq(ship(nz, 1).water, 0, 'ohne Zisterne bleibt der Tank leer');
  // rain cloud
  const c = mk(); c.state.clouds.push({ id: 50, x: -40, y: 5, px: -40, py: 5, r: 8 }); place(c, 1, -40, 5); run(c, 15);
  near(ship(c, 1).water, 0.5, 0.15, 'Regenwolke füllt 1/s'); run(c, 120); eq(ship(c, 1).water, 3, 'Wassertank Deckel 3');
}

// ---- fire: spread, burning, extinguish ----
{
  const sim = mk(); put(sim, 6, 'kanone', { hp: 1e6 }); put(sim, 1, 'kanone', { hp: 1e6 }); put(sim, 5, 'kanone', { hp: 1e6 }); put(sim, 3, 'kanone', { hp: 1e6 });
  sim.state.slots[6].fire = 0.7;
  const lg = run(sim, 5 * 30); eq(count(lg, 'fireStart'), 0, 'noch keine Ausbreitung nach 5 s');
  ok(sim.state.slots[6].fire > 0.7, 'Feuer wächst'); ok(sim.state.herz < 100, 'Feuer verbrennt das Herz');
  const lg2 = run(sim, 2 * 30);
  ok(count(lg2, 'fireStart') >= 1 && sim.state.slots[1].fire > 0, 'Feuer springt nach 6 s auf den Nachbarn'); eq(sim.state.slots[3].fire, 0, 'Nicht-Nachbar bleibt');
  ok(sim.state.slots[6].hp < 1e6, 'Feuer verbrennt Gebäude-HP');
  // damage rate
  const d = mk(); put(d, 2, 'sternwarte', { hp: 120 }); d.state.slots[2].fire = 0.5; d.state.herz = 100; run(d, 30);
  near(d.state.slots[2].hp, 120 - C.FIRE_DAMAGE * 0.5, 2, 'HP-Verlust = FIRE_DAMAGE * fire pro s');
  // ruin on burn-down
  const k = mk(); put(k, 2, 'windrad', { hp: 5 }); k.state.slots[2].fire = 1; const lk = run(k, 30); eq(count(lk, 'ruined'), 1, 'abgebrannt = ruiniert'); eq(k.state.slots[2].fire, 0, 'Feuer danach aus');
  // extinguish
  const e = mk(); put(e, 6, 'windrad'); e.state.slots[6].fire = 0.5; const s = place(e, 1, 21.8, 0); s.water = 3;
  e.input(1, { act: true }); const le = run(e, 1);
  eq(s.act, 'extinguish', 'act = extinguish'); ok(!s.docked, 'außerhalb DOCK_R'); eq(count(le, 'spray'), 1, 'spray-Event sofort');
  near(e.state.slots[6].fire, 0.5 - C.SPRAY_FIRE + C.FIRE_RAIN * 0, 0.02, 'Spray -0.35 Feuer'); near(s.water, 2, 1e-9, 'Spray -1 Wasser');
  const le2 = run(e, 20);
  eq(count(le2, 'fireOut'), 1, 'fireOut'); eq(e.state.slots[6].fire, 0, 'Feuer gelöscht'); eq(le2.find(x => x.t === 'fireOut').pid, 1, 'fireOut mit pid');
  ok(s.water > 0.5 && s.water < 2, 'Wasser nur teilweise verbraucht'); eq(s.stats.fires, 5, 'fires-Statistik in 0.1-Schritten');
  eq(s.score, 5, 'Score = fires');
  // no water -> no extinguish
  const n = mk(); put(n, 6, 'windrad'); n.state.slots[6].fire = 0.5; place(n, 1, 21.8, 0); n.input(1, { act: true }); run(n, 1); eq(ship(n, 1).act, 'horn', 'ohne Wasser kein extinguish');
  // too far
  const f = mk(); put(f, 3, 'windrad'); f.state.slots[3].fire = 0.5; place(f, 1, 22, 0); ship(f, 1).water = 3; run(f, 1); eq(ship(f, 1).act, 'horn', 'zu weit vom Feuer');
  // zisterne reduces fire on neighbours
  const z = mk(); put(z, 2, 'zisterne'); put(z, 1, 'windrad', { hp: 1e6 }); put(z, 4, 'windrad', { hp: 1e6 });
  z.state.slots[1].fire = 0.3; z.state.slots[4].fire = 0.3; run(z, 150);
  ok(z.state.slots[1].fire < 0.3 + 0.0001, 'Zisterne bremst Nachbar-Feuer (fire ' + z.state.slots[1].fire.toFixed(3) + ')'); ok(z.state.slots[4].fire > 0.3, 'entfernter Slot wächst');
  // rain in storms
  const r = mk(); advanceTo(r, 70.1, true); put(r, 3, 'windrad', { hp: 1e6 }); r.state.slots[3].fire = 0.3; const f0 = r.state.slots[3].fire; run(r, 30);
  near(r.state.slots[3].fire - f0, World.DIFF.normal.fire - C.FIRE_RAIN, 0.002, 'Regen im Sturm -0.02/s');
}

// ---- repair ----
{
  const sim = mk(); place(sim, 1, 19, 0); const s = ship(sim, 1);
  put(sim, 2, 'windrad'); sim.state.slots[2].hp = 10; sim.state.stock.holz = 3;
  sim.input(1, { act: true }); run(sim, 1);
  eq(s.act, 'repair', 'act = repair'); eq(sim.state.stock.holz, 2, '1 Holz pro 50 HP (sofort abgebucht)');
  run(sim, 30); near(sim.state.slots[2].hp, 10 + C.REPAIR_RATE * (31 / 30), 1.5, 'Reparatur +20 HP/s');
  run(sim, 30 * 5); near(sim.state.slots[2].hp, 60, 1e-6, 'bis max repariert'); ok(s.stats.repairs >= 0, 'repairs gezählt');
  const r = mk(); place(r, 1, 19, 0); put(r, 2, 'sternwarte'); r.state.slots[2].hp = 0; r.state.slots[2].hp = 1; r.state.stock.holz = 10; r.input(1, { act: true });
  run(r, 30 * 12); ok(ship(r, 1).stats.repairs >= 2, 'repairs = pro 50 HP (' + ship(r, 1).stats.repairs + ')'); ok(ship(r, 1).score >= 4, 'Score aus Reparaturen ×2');
  const n = mk(); place(n, 1, 19, 0); put(n, 2, 'windrad'); n.state.slots[2].hp = 10; n.state.stock.holz = 0; n.input(1, { act: true }); run(n, 1); eq(ship(n, 1).act, 'horn', 'ohne Holz keine Reparatur');
  const q = mk(); place(q, 1, 19, 0); put(q, 2, 'windrad'); q.state.slots[2].ruined = true; q.state.slots[2].hp = 0; q.state.stock.holz = 5; q.input(1, { act: true }); run(q, 1); eq(ship(q, 1).act, 'horn', 'Ruinen werden nicht repariert (nur neu gebaut)');
}

// ---- events schedule ----
{
  const sim = mk({ captains: [{ pid: 1 }] }); const log = [];
  eq(sim.state.event, null, 'kein Event am Anfang');
  const times = {};
  while (!sim.state.over) {
    sim.state.herz = 100;
    for (const e of sim.step()) { log.push(e); if (['warn', 'eventStart', 'eventEnd'].includes(e.t)) times[e.t + ':' + e.kind] = sim.state.t; }
    if (sim.state.t > 54 && sim.state.t < 54.2) eq(sim.state.next.kind + sim.state.next.at, 'sturm70', 'next vor dem Sturm');
    if (Math.abs(sim.state.t - 80) < 0.02) { eq(sim.state.event.kind, 'sturm', 'Sturm läuft'); eq(sim.state.event.until, 110, 'until'); eq(sim.state.next.kind + sim.state.next.at, 'nacht185', 'next während des Sturms'); }
  }
  near(times['warn:sturm'], 55, 0.05, 'Warnung 15 s vorher'); near(times['eventStart:sturm'], 70, 0.05, 'Sturm startet bei 70'); near(times['eventEnd:sturm'], 110, 0.05, 'Sturm endet bei 110');
  near(times['warn:nacht'], 170, 0.05, 'Nacht-Warnung'); near(times['eventStart:nacht'], 185, 0.05, 'Nacht startet'); near(times['eventEnd:nacht'], 235, 0.05, 'Nacht endet');
  eq(count(log, 'warn'), 2, '2 Warnungen'); eq(log.filter(e => e.t === 'warn')[0].in, 15, 'warn.in = 15');
  eq(sim.state.next, null, 'next null nach dem letzten Event'); eq(count(log, 'over'), 1, 'over genau einmal');
  eq(sim.state.dayT, 1, 'dayT = 1 am Ende'); near(sim.state.t, 240, 0.04, 'Ende bei 240 s');
  const w = mk(); advanceTo(w, 69, true); eq(w.state.wind.x, 0, 'Wind vorher 0'); advanceTo(w, 85, true);
  const mag = Math.hypot(w.state.wind.x, w.state.wind.y); ok(mag >= 6 - 1e-9 && mag <= 10 + 1e-9, 'Sturmwind 6..10 (' + mag.toFixed(2) + ')');
  advanceTo(w, 111, true); eq(w.state.wind.x, 0, 'Wind danach 0');
  const n = mk({ dauer: 'normal' }); advanceTo(n, 100, true); near(n.state.dayT, 100 / 360, 1e-3, 'dayT = t / Länge');
}

// ---- lightning ----
{
  const sim = mk({ captains: [{ pid: 1 }] }); let first = null, tWarn = 0; const warns = [];
  advanceTo(sim, 70, true);
  eq(sim.state.strikes.length, 0, 'vor dem Sturm keine Blitze');
  for (let i = 0; i < 30 * 40; i++) {
    sim.state.herz = 100;
    const lg = sim.step();
    for (const e of lg) {
      if (e.t === 'strikeWarn') { warns.push({ id: e.id, t: sim.state.t }); if (!first) { first = e; tWarn = sim.state.t; } }
      if (e.t === 'strike' && e.id === first.id && !first.done) {
        first.done = true; near(sim.state.t - tWarn, C.STRIKE_DELAY, 0.04, 'Einschlag 0.8 s nach der Warnung');
        ok(['slot', 'ship', 'sky'].includes(e.target), 'Einschlagsziel'); eq(typeof e.absorbed, 'boolean', 'absorbed ist bool');
      }
    }
    if (first && !first.done) { const k = sim.state.strikes.find(x => x.id === first.id); ok(!!k && Math.abs(k.at - (tWarn + C.STRIKE_DELAY)) < 0.04, 'strikes[].at = t + 0.8'); }
  }
  ok(first && first.done, 'Blitz warnt und schlägt ein');
  const gaps = warns.slice(1).map((w, i) => w.t - warns[i].t);
  near(gaps[0], World.DIFF.normal.lightning / World.EVENTS.kurz[0].strength, 0.05, 'Blitzabstand normal 2.5 s');
  // difficulty changes rate
  const rate = (d) => { const s = mk({ schwierigkeit: d }); const lg = advanceTo(s, 109, true); return count(lg, 'strikeWarn'); };
  const rl = rate('leicht'), rn = rate('normal'), rh = rate('heftig');
  ok(rl < rn && rn < rh, 'Blitzrate leicht < normal < heftig (' + [rl, rn, rh] + ')');
  // lightning on a slot / sky / ship
  const t = mk(); put(t, 2, 'windrad', { hp: 1e6 }); t.state.strikes.push({ id: 800, x: 0, y: 0, at: 0.01, target: 'slot', slot: 2 });
  const lt = run(t, 2); const ev = lt.find(e => e.t === 'strike'); ok(ev && ev.slot === 2 && ev.absorbed === false, 'strike-Event mit slot'); near(t.state.slots[2].fire, C.STRIKE_SLOT_FIRE, 0.05, 'Blitz auf Gebäude: Feuer'); eq(count(lt, 'fireStart'), 1, 'fireStart');
  t.state.strikes.push({ id: 801, x: 0, y: 0, at: 0.01, target: 'slot', slot: 4 }); const h0 = t.state.herz; run(t, 2);
  near(h0 - t.state.herz, C.STRIKE_EMPTY_HEART, 0.6, 'Blitz auf leeren Platz: Herz');
  t.state.strikes.push({ id: 802, x: 0, y: 40, at: 0.01, target: 'sky' }); const h1 = t.state.herz; const ls = run(t, 2); near(t.state.herz, h1, 0.6, 'Himmelsblitz harmlos'); eq(count(ls, 'strike'), 1, 'Himmelsblitz-Event');
  place(t, 1, -30, 0); t.state.strikes.push({ id: 803, x: -26, y: 0, at: 0.01, target: 'ship', pid: 1 }); const lm = run(t, 2); eq(count(lm, 'stun'), 0, 'Schiff > 3 vom Einschlag: nicht betäubt');
}

// ---- shield ----
{
  const sim = mk(); put(sim, 1, 'windrad'); place(sim, 1, 19, 0);
  advanceTo(sim, 69, true); const s = ship(sim, 1);
  sim.input(1, { act: true }); run(sim, 1); eq(s.act, 'horn', 'vor dem Sturm: kein Schild'); eq(sim.state.shieldOn, false, 'Schild aus');
  eq(sim.state.energy, 100, 'Windrad lädt Energie');
  const lg = advanceTo(sim, 70.1, true); eq(sim.state.event.kind, 'sturm', 'Sturm läuft'); sim.state.herz = 100;
  lg.push(...run(sim, 1)); eq(s.act, 'shield', 'act = shield (angedockt, Sturm, Windrad)'); eq(s.acting, true, 'acting'); eq(sim.state.shieldOn, true, 'Schild an');
  eq(count(lg, 'shieldOn'), 1, 'shieldOn-Event');
  const e0 = sim.state.energy; run(sim, 30); ok(sim.state.energy < e0 - 5, 'Schild verbraucht Energie (' + (e0 - sim.state.energy).toFixed(1) + ')');
  sim.state.strikes.push({ id: 700, x: 0, y: 0, at: 0, target: 'slot', slot: 1 });
  const la = run(sim, 2).filter(e => e.t === 'strike' && e.id === 700)[0]; eq(la.absorbed, true, 'Blitz auf Insel wird absorbiert'); eq(sim.state.slots[1].fire, 0, 'kein Feuer unter dem Schild');
  const hh = sim.state.herz; sim.state.strikes.push({ id: 701, x: 0, y: 0, at: 0, target: 'slot', slot: 4 }); run(sim, 2); eq(sim.state.herz, hh, 'kein Herzschaden unter dem Schild');
  sim.input(1, { act: false }); const lo = run(sim, 2); eq(sim.state.shieldOn, false, 'loslassen = Schild aus'); eq(count(lo, 'shieldOff'), 1, 'shieldOff-Event');
  sim.state.strikes.push({ id: 702, x: 0, y: 0, at: 0, target: 'slot', slot: 1 });
  const lb = run(sim, 2).filter(e => e.t === 'strike' && e.id === 702)[0]; eq(lb.absorbed, false, 'ohne Schild nicht absorbiert'); ok(sim.state.slots[1].fire > 0, 'Feuer ohne Schild');
  // empty energy
  sim.state.slots[1].fire = 0; sim.input(1, { act: true }); sim.state.energy = 0.05; let offSeen = false; run(sim, 60, () => { sim.state.herz = 100; if (!s.acting) offSeen = true; }); ok(sim.state.energy < 1, 'Energie leer (Schild frisst mehr als die Windräder liefern)'); ok(offSeen, 'ohne Energie acting false (Schild flackert)'); eq(s.act, 'shield', 'act bleibt shield');
  // undocked ship cannot shield
  place(sim, 1, 24, 0); run(sim, 2); ok(s.act !== 'shield', 'ungedockt kein Schild');
}

// ---- context action priority ----
{
  const sim = mk(); const s = place(sim, 1, 19, 0);
  run(sim, 1); eq(s.act, 'horn', 'sonst: horn');
  // horn rising edge
  const h = mk(); const lh = []; h.input(1, { act: true }); lh.push(...run(h, 5)); h.input(1, { act: false }); h.step(); h.input(1, { act: true }); lh.push(...run(h, 5));
  eq(count(lh, 'horn'), 2, 'horn nur bei steigender Flanke');
  // shoot beats harvest; extinguish beats shoot; shield beats everything
  const p = mk(); const a = place(p, 1, ISL.kristall0[0], ISL.kristall0[1] + 6); p.input(1, { act: true });
  p.state.dragons.push({ id: 1, x: a.x + 8, y: a.y, px: a.x + 8, py: a.y, h: 0, ph: 0, hp: 6, state: 'circle' });
  p.step(); eq(a.act, 'shoot', 'shoot vor harvest');
  put(p, 6, 'windrad'); p.state.slots[6].fire = 0.4; place(p, 1, 21.8, 0); a.water = 3; p.step(); eq(a.act, 'extinguish', 'extinguish vor shoot');
  const q = mk(); put(q, 1, 'windrad'); advanceTo(q, 75, true); place(q, 1, 19, 0); ship(q, 1).water = 3; put(q, 6, 'windrad'); q.state.slots[6].fire = 0.4;
  q.state.dragons.push({ id: 1, x: 20, y: 0, px: 20, py: 0, h: 0, ph: 0, hp: 6, state: 'circle' }); q.input(1, { act: true }); q.step(); eq(ship(q, 1).act, 'shield', 'shield vor allem');
  // dragon fleeing is not targeted
  const f = mk(); place(f, 1, 30, 0); f.state.dragons.push({ id: 1, x: 35, y: 0, px: 35, py: 0, h: 0, ph: 0, hp: 0, state: 'flee' }); f.step(); eq(ship(f, 1).act, 'horn', 'fliehende Drachen nicht anvisierbar');
  // harpoon
  const hp = mk({ seed: 4 }); const sh = place(hp, 1, 30, 0); hp.input(1, { act: true });
  hp.state.dragons.push({ id: 1, x: 40, y: 0, px: 40, py: 0, h: 0, ph: 0, hp: 6, state: 'circle' });
  const lh2 = run(hp, 30 * 30, (sm) => { const d = sm.state.dragons[0]; if (d) { sh.x = d.x - 8; sh.y = d.y; sh.vx = sh.vy = 0; } });
  ok(count(lh2, 'harpoon') >= 10, 'Harpune schießt alle 0.8 s (' + count(lh2, 'harpoon') + ')'); ok(sh.stats.dragonHits >= 6, 'Treffer gezählt'); ok(sh.score >= 12, 'Score: Treffer ×2');
  ok(lh2.some(e => e.t === 'dragonHit' && e.by === 1), 'dragonHit mit by'); ok(count(lh2, 'dragonFlee') === 1, 'Drache flieht bei 0 HP');
}

// ---- dragons ----
{
  for (const [d, nD, nN] of [['leicht', 2, 1], ['normal', 3, 2], ['heftig', 4, 3]]) {
    const sim = mk({ dauer: 'normal', schwierigkeit: d });
    const l1 = advanceTo(sim, 210.1, true); eq(sim.state.dragons.length, nD, d + ': Drachen im Drachen-Event'); eq(count(l1, 'dragonSpawn'), nD, d + ': dragonSpawn');
    const l2 = advanceTo(sim, 250.1, true); eq(sim.state.event, null, 'Event vorbei');
    ok(sim.state.dragons.every(x => x.state === 'flee'), d + ': Drachen fliehen am Event-Ende'); eq(count(l2, 'dragonFlee'), nD, d + ': dragonFlee je Drache');
    advanceTo(sim, 262, true); eq(sim.state.dragons.length, 0, d + ': Drachen verlassen die Karte');
    const l3 = advanceTo(sim, 300.1, true); eq(count(l3, 'dragonSpawn'), nN, d + ': Nacht-Drachen');
  }
  // approach, circle, breath
  const sim = mk({ dauer: 'normal', schwierigkeit: 'normal' }); put(sim, 1, 'windrad', { hp: 1e6 }); put(sim, 2, 'kanone', { hp: 1e6 });
  advanceTo(sim, 211, true, (sm) => { sm.state.slots[2].fire = 0; }); const d0 = sim.state.dragons[0]; ok(Math.hypot(d0.x, d0.y) > 60, 'Drache startet am Kartenrand');
  eq(d0.hp, 6, 'Drache hat 6 HP');
  const log = advanceTo(sim, 235, true, (sm) => { sm.state.slots[2].fire = 0; });
  ok(sim.state.dragons.every(d => d.state === 'circle'), 'Drachen kreisen'); ok(sim.state.dragons.every(d => { const r = Math.hypot(d.x, d.y); return r >= 17.5 && r <= 24.5; }), 'Kreisradius 18-24');
  const fires = log.filter(e => e.t === 'dragonFire'); ok(fires.length >= 4, 'Drachen speien Feuer (' + fires.length + ')'); ok(fires.every(e => e.slot === 1 || e.slot === 2), 'nur auf vorhandene Gebäude');
  ok(count(log, 'cannon') > 0, 'Kanone schießt'); ok(log.some(e => e.t === 'dragonHit' && e.by === 'kanone'), 'Kanonentreffer');
  // no buildings: heart
  const e = mk({ dauer: 'normal' }); advanceTo(e, 210.1, true); const h0 = 100; const le = [];
  for (let i = 0; i < 30 * 8 && !e.state.over; i++) { const dr = e.step(); le.push(...dr); if (dr.some(x => x.t === 'dragonFire')) break; if (i === 0) e.state.herz = h0; }
  const df = le.find(x => x.t === 'dragonFire'); ok(df && df.slot === -1 && !df.absorbed, 'Drachenfeuer ohne Gebäude: slot -1'); near(e.state.herz, h0 - C.DRAGON_HEART, 0.5, 'Drachenfeuer ohne Gebäude: Herz');
  // tail swipe
  const t = mk({ dauer: 'normal' }); advanceTo(t, 215, true); const dr = t.state.dragons[0]; const sh = place(t, 1, dr.x, dr.y); sh.cargo.holz = 4; const lt = run(t, 1);
  eq(count(lt, 'stun'), 1, 'Schwanzschlag betäubt'); eq(lt.find(x => x.t === 'stun').by, 'dragon', 'by dragon'); eq(sh.cargo.holz, 2, 'Schwanzschlag: halbe Fracht weg');
  // dragon fire absorbed by shield
  const sd = mk({ dauer: 'normal' }); put(sd, 1, 'windrad', { hp: 1e6 }); advanceTo(sd, 300.2, true, (sm) => { sm.state.slots[1].fire = 0; sm.state.slots[1].hp = 60; }); place(sd, 1, 19, 0); sd.state.energy = 100; sd.input(1, { act: true });
  const ls = [];
  for (let i = 0; i < 30 * 12; i++) { sd.state.herz = 100; sd.state.energy = 100; sd.state.slots[1].fire = 0; place(sd, 1, 19, 0); ls.push(...sd.step()); }
  const abs = ls.filter(e => e.t === 'dragonFire'); ok(abs.length > 0 && abs.every(e => e.absorbed), 'Drachenfeuer prallt am Schild ab'); eq(sd.state.slots[1].fire, 0, 'kein Feuer durchs Schild');
}

// ---- heart, sinking, win, stars ----
{
  const sim = mk(); put(sim, 2, 'windrad', { hp: 1e6 }); sim.state.slots[2].fire = 1; sim.state.herz = 0.3;
  const lg = run(sim, 3); eq(sim.state.over, true, 'Herz 0 = Ende'); eq(sim.state.survived, false, 'nicht überlebt'); eq(sim.state.stars, 0, '0 Sterne');
  eq(count(lg, 'sink'), 1, 'sink-Event'); eq(count(lg, 'over'), 1, 'over-Event'); eq(lg.find(e => e.t === 'over').survived, false, 'over.survived false'); eq(sim.state.herz, 0, 'Herz bei 0');
  const t0 = sim.state.t; eq(sim.step().length, 0, 'step nach dem Ende gibt []'); eq(sim.state.t, t0, 'Zeit steht'); sim.input(1, { sx: 1 }); eq(sim.step().length, 0, 'weiter []');
  eq(sim.build(1, 'windrad').ok, false, 'nach dem Ende kein Bauen');
  // herzLow
  const h = mk(); h.state.herz = 29; const hl = run(h, 2); eq(count(hl, 'herzLow'), 1, 'herzLow-Event'); eq(count(run(h, 5), 'herzLow'), 0, 'herzLow nur einmal');
  // regen only outside events and without fire
  const r = mk(); r.state.herz = 50; run(r, 30); near(r.state.herz, 50.5, 0.05, 'Herz +0.5/s'); r.state.herz = 50; put(r, 2, 'windrad', { hp: 1e6 }); r.state.slots[2].fire = 0.1; run(r, 30); ok(r.state.herz < 50, 'keine Regeneration bei Feuer');
  const ev = mk(); advanceTo(ev, 75, true); ev.state.herz = 50; run(ev, 1); ok(ev.state.herz <= 50, 'keine Regeneration im Event');
  // stars
  const keep = (sm) => { const c = sm.state.slots[0]; if (c.kind) { c.fire = 0; c.hp = 120; c.ruined = false; } };   // lightning would otherwise burn the lone Sternwarte down
  const build3 = (sm) => {
    const st = sm.state; place(sm, 1, 19, 0); run(sm, 1); st.stock.holz = 100; st.stock.kristall = 100;
    for (let stage = 1; stage <= 3; stage++) { if (!sm.build(1, 'sternwarte').ok) throw new Error('stage ' + stage); run(sm, 12 * 30 + 3, () => { st.herz = 100; keep(sm); }); }
  };
  const w1 = mk(); const l1 = advanceTo(w1, 241, true); eq(w1.state.over, true, 'Ende nach 240 s'); eq(w1.state.survived, true, 'überlebt'); eq(w1.state.stars, 1, '1 Stern ohne Sternwarte'); eq(count(l1, 'over'), 1, 'over einmal');
  eq(l1.find(e => e.t === 'over').stars, 1, 'over.stars'); eq(l1.find(e => e.t === 'over').survived, true, 'over.survived');
  const w3 = mk(); build3(w3); eq(w3.state.slots[0].stage, 3, 'Sternwarte fertig'); advanceTo(w3, 241, true, keep); eq(w3.state.stars, 3, '3 Sterne: Sternwarte + Herz >= 60');
  const w2 = mk(); build3(w2); advanceTo(w2, 238, true, keep); const sm = w2.state; while (!sm.over) { sm.herz = 50; keep(w2); w2.step(); } eq(sm.stars, 2, '2 Sterne: Sternwarte, Herz < 60'); eq(sm.survived, true, '2 Sterne überlebt');
  const wp = mk(); place(wp, 1, 19, 0); run(wp, 1); wp.state.stock.holz = 50; wp.state.stock.kristall = 50;
  for (let stage = 1; stage <= 3; stage++) { wp.build(1, 'sternwarte'); advanceTo(wp, wp.state.t + 12.2, true); }
  wp.state.slots[0].stage = 2; wp.state.slots[0].build = 1; advanceTo(wp, 241, true, (sm) => { sm.state.slots[0].stage = 2; sm.state.slots[0].fire = 0; sm.state.slots[0].hp = 120; }); eq(wp.state.stars, 1, 'unvollständige Sternwarte zählt nicht');
  const wr = mk(); build3(wr); wr.state.slots[0].ruined = true; advanceTo(wr, 241, true, (sm) => { sm.state.slots[0].ruined = true; sm.state.slots[0].fire = 0; }); eq(wr.state.stars, 1, 'ruinierte Sternwarte zählt nicht als fertig');
}

// ---- scoring ----
{
  const sim = mk(); place(sim, 1, 19, 0); const s = ship(sim, 1);
  Object.assign(sim.state.stock, { holz: 10, kristall: 10 }); sim.build(1, 'windrad'); s.cargo.holz = 2; run(sim, 40);
  eq(s.stats.built, 1, 'built'); eq(s.stats.delivered, 2, 'delivered'); eq(s.score, 2 * 1 + 1 * 3, 'Score = delivered + built*3 (+...)');
  ok(allFinite(sim.state.ships), 'Scores endlich');
}

// ---- bots ----
{
  let built = 0, sunk = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const sim = Sim.create({ seed, dauer: 'kurz', schwierigkeit: 'normal', captains: [{ pid: -1, bot: true }, { pid: -2, bot: true }, { pid: -3, bot: true }] });
    let err = null, n = 0, log = [];
    try { while (!sim.state.over && n++ < 8000) log.push(...sim.step()); } catch (e) { err = e; }
    ok(!err, 'Bot-Match seed ' + seed + ' ohne Fehler' + (err ? ': ' + err.stack : ''));
    ok(sim.state.over, 'Bot-Match seed ' + seed + ' endet'); ok(allFinite(sim.state), 'Bot-Match: alle Zahlen endlich');
    const b = count(log, 'buildStart'); built += b; if (!sim.state.survived) sunk++;
    ok(b >= 3, 'Bots bauen >= 3 Gebäude in kurz (seed ' + seed + ': ' + b + ')');
    ok(sim.state.ships.every(s => s.bot), 'nur Bots'); ok(sim.state.ships.some(s => s.stats.delivered > 0), 'Bots liefern ab');
    ok(sim.state.ships.every(s => Math.abs(s.x) <= 79 && Math.abs(s.y) <= 49), 'Bots bleiben auf der Karte');
  }
  console.log('  Bots: ' + built + ' Bauaufträge in 5 kurzen Matches, ' + sunk + ' verloren');
  // bots use the public API: they do not move without input(); a captain without bot flag stays idle
  const idle = mk({ captains: [{ pid: 1 }] }); run(idle, 300); near(Math.hypot(ship(idle, 1).vx, ship(idle, 1).vy), 0, 1e-9, 'Mensch ohne Eingabe bleibt stehen');
  // separate RNG streams: extra bots do not change lightning or dragons
  const seqOf = (caps) => {
    const sim = Sim.create({ seed: 9, dauer: 'normal', captains: caps }); const out = [];
    while (sim.state.t < 305 && !sim.state.over) {
      sim.state.herz = 100;
      for (const e of sim.step()) {
        if (e.t === 'strikeWarn') { const k = sim.state.strikes.find(x => x.id === e.id); out.push('w' + e.id + '@' + sim.state.t.toFixed(2) + ':' + k.target + (k.target === 'slot' ? k.slot : '') + (k.target === 'sky' ? e.x.toFixed(3) : '')); }
        if (e.t === 'dragonSpawn') { const d = sim.state.dragons.find(x => x.id === e.id); out.push('d' + e.id + '@' + sim.state.t.toFixed(2) + ':' + d.x.toFixed(3) + ',' + d.y.toFixed(3)); }
        if (e.t === 'warn') out.push('warn' + e.kind);
      }
    }
    return out.join('|');
  };
  const sa = seqOf([{ pid: 1 }]), sb = seqOf([{ pid: 1 }, { pid: -1, bot: true }, { pid: -2, bot: true }]);
  ok(sa.length > 200, 'Blitzfolge nicht leer'); eq(sa, sb, 'Zusätzliche Bots ändern Blitze und Drachen nicht');
}

// ---- determinism ----
{
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  const play = (seed) => {
    const sim = Sim.create({ seed, dauer: 'kurz', schwierigkeit: 'normal', captains: [{ pid: 1 }, { pid: 2 }, { pid: -1, bot: true }] });
    let rs = seed * 7 + 1; const rnd = () => (rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let evh = '';
    for (let i = 0; i < 3000; i++) {
      if (i % 20 === 0) { sim.input(1, { sx: rnd() * 2 - 1, sy: rnd() * 2 - 1, boost: rnd() < 0.3, act: rnd() < 0.5 }); sim.input(2, { sx: Math.sin(i / 50), sy: Math.cos(i / 70), act: i % 100 < 50 }); }
      if (i % 200 === 100) sim.build(1, ['windrad', 'zisterne', 'kanone', 'werkstatt'][(i / 200) | 0 % 4]);
      if (i === 1500) sim.addCaptain(3, false);
      if (i === 2000) sim.removeCaptain(2);
      for (const e of sim.step()) evh += e.t;
    }
    return { state: JSON.stringify(sim.state), ev: hash(evh) };
  };
  const a = play(11), b = play(11), c = play(12);
  eq(hash(a.state), hash(b.state), 'gleicher Seed + Eingaben -> gleicher Zustands-Hash (3000 Schritte)'); eq(a.state, b.state, 'Zustand identisch'); eq(a.ev, b.ev, 'Events identisch');
  ok(hash(a.state) !== hash(c.state), 'anderer Seed -> anderer Verlauf');
  console.log('  Zustands-Hash nach 3000 Schritten (seed 11): ' + hash(a.state));
}

// ---- source hygiene ----
{
  for (const f of ['world.js', 'sim.js']) {
    const src = fs.readFileSync(__dirname + '/public/games/skyfarers/' + f, 'utf8');
    for (const re of [/Math\.random/, /\bDate\b/, /performance\.now/]) ok(!re.test(src), f + ' enthält kein ' + re.source);
  }
}

// ---- balance table (informational) ----
{
  const N = 20, DUR = { kurz: 240, normal: 360, lang: 480 };
  const balance = (dauer, diff) => {
    let surv = 0, stars = 0, bld = 0, herz = 0, three = 0, stock = 0, sw = 0, swT = 0;
    for (let seed = 1; seed <= N; seed++) {
      const sim = Sim.create({ seed, dauer, schwierigkeit: diff, captains: [{ pid: -1, bot: true }, { pid: -2, bot: true }, { pid: -3, bot: true }] });
      let n = 0, t3 = null;
      while (!sim.state.over && n++ < 20000) { for (const e of sim.step()) if (e.t === 'buildDone' && e.kind === 'sternwarte' && e.stage === 3 && t3 === null) t3 = sim.state.t; }
      ok(sim.state.over, 'Balance-Lauf endet');
      const s = sim.state; if (s.survived) surv++; stars += s.stars; if (s.stars === 3) three++; bld += s.slots.filter(x => x.kind && !x.ruined).length; herz += s.herz;
      stock += (s.stock.holz | 0) + (s.stock.kristall | 0);
      if (t3 !== null) { sw++; swT += t3; }
    }
    return { dauer, diff, surv: surv / N * 100, stars: stars / N, three: three / N * 100, bld: bld / N, herz: herz / N, stock: stock / N, sw, swT: sw ? swT / sw : null, swPct: sw ? swT / sw / DUR[dauer] * 100 : null };
  };
  const rows = [];
  for (const diff of ['leicht', 'normal', 'heftig']) rows.push(balance('normal', diff));
  rows.push(balance('kurz', 'leicht'), balance('kurz', 'normal'), balance('lang', 'leicht'), balance('lang', 'normal'), balance('lang', 'heftig'));
  console.log('\n  Balance (3 Bots, ' + N + ' Seeds)');
  console.log('  Dauer  Stufe    überlebt  Ø Sterne  3 Sterne  Ø Gebäude  Ø Herz  Ø Rest 💎+🪵  Sternwarte 3/3 (Seeds, Ø Zeit)');
  for (const r of rows) console.log('  ' + r.dauer.padEnd(6) + ' ' + r.diff.padEnd(8) + ' ' + (r.surv.toFixed(0) + ' %').padStart(8) + '  ' + r.stars.toFixed(2).padStart(8) + '  ' + (r.three.toFixed(0) + ' %').padStart(8) + '  ' + r.bld.toFixed(1).padStart(9) + '  ' + r.herz.toFixed(0).padStart(6) + '  ' + r.stock.toFixed(1).padStart(12) + '  ' + (r.sw + '/' + N + (r.swT === null ? ' –' : ', ' + r.swT.toFixed(0) + ' s = ' + r.swPct.toFixed(0) + ' %')).padStart(24));
  const by = (d, f) => rows.find(r => r.dauer === d && r.diff === f);
  if (by('normal', 'leicht').surv < 90) console.log('  HINWEIS: leicht unter 90 % Überleben');
  if (by('normal', 'normal').surv < 70 || by('normal', 'normal').three > 40) console.log('  HINWEIS: normal ausserhalb der Ziele (>=70 % überleben, <=40 % drei Sterne)');
  if (by('normal', 'normal').stock > 25) console.log('  HINWEIS: normal Ø Rest > 25');
  if (by('normal', 'normal').swPct !== null && by('normal', 'normal').swPct < 60) console.log('  HINWEIS: normal Sternwarte 3/3 vor 60 % der Dauer');
  if (by('normal', 'heftig').surv < 30 || by('normal', 'heftig').surv > 70) console.log('  HINWEIS: heftig ausserhalb 30-70 % Überleben');
  if (by('kurz', 'leicht').three < 33) console.log('  HINWEIS: kurz leicht unter 1/3 drei Sterne');
}

// ---- performance ----
{
  const caps = []; for (let i = 1; i <= 8; i++) caps.push({ pid: -i, bot: true });
  const sim = Sim.create({ seed: 5, dauer: 'normal', schwierigkeit: 'heftig', captains: caps });
  advanceTo(sim, 300.5, true);
  eq(sim.state.event.kind, 'nacht', 'Perf: Sturmnacht läuft');
  while (sim.state.dragons.length < 4) { const x = 90, y = 0; sim.state.dragons.push({ id: 100 + sim.state.dragons.length, x, y, px: x, py: y, h: Math.PI, ph: Math.PI, hp: 6, state: 'approach' }); }
  let n = 0, ms = 0, maxDr = 0;
  while (n < 1500 && !sim.state.over) { sim.state.herz = 100; maxDr = Math.max(maxDr, sim.state.dragons.length); const t = process.hrtime.bigint(); sim.step(); ms += Number(process.hrtime.bigint() - t) / 1e6; n++; }
  const avg = ms / n;
  console.log('\n  Performance: Ø ' + (avg * 1000).toFixed(0) + ' µs pro step() (8 Schiffe, bis zu ' + maxDr + ' Drachen, Sturmnacht, ' + n + ' Schritte)');
  ok(avg < 0.3, 'Ø step < 0.3 ms (' + avg.toFixed(3) + ')');
}

console.log(process.exitCode ? '\nFEHLER aufgetreten' : '\nOK: ' + checks + ' Prüfungen bestanden');
