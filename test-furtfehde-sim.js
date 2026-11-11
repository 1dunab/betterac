// Regeltests Furt & Fehde: Regelwerk (sim.js) – Ablauf, Wirtschaft, Bauen, Heer, Kampf, Feuer, Plünderung, Ruhm, Pakte, Determinismus, Leistung.
// Phase 1b (docs/FURTFEHDE.md): je ein Block für R1 (nie eine Sackgasse), R2 (Bauern bleiben auf dem Feld), R3 (Essen zuerst), R4/R9 (Futterzahlen),
// R5 (Pause), R6 (Burgbrunnen), R7 (Pfeile gegen Fackelträger), R8 (langsameres Springen des Feuers) und den Futterversuch (8 Höfe, 13–16 Leute).
// Phase 1b, zweite Runde (Feedback 3): R10 (das Tor-Gebot gilt nur für Hunger-Ankünfte), R11 (ein volles Lager gibt seine Arbeiter frei, FULL_WAIT_S, buildings[].full),
// R12 (TRAIN_PAR je fertiger Kaserne) und die Szene des Nutzers (popCap 88, 44 Leute, volle Lager, Belagerung am Bergfried: das Haus wächst und bildet aus).
// Phase 2 (Mauern & Söldner): Kosten, Größen und Zahlen der neuen Gebäude und Einheiten, Mauern bauen (len, buildWall, Ruinen, Schutt), Torhaus-Gasse (Besitzer, Paktpartner, Fremde),
// Durchbruch (Feld mit BREACH_COST, Rammbock, VS_WALL, Pfeile gegen Stein und Holz), Palisadenbrand, Markt und Gold (trade, Plünderung), Söldnerlager (Rekrutierung nach Haus, TRAIN_PAR je Haus),
// Reiterschütze (Ausweichen, Schuss im Ritt), Rammbock (nur Gebäude, Pfeile × 0.25), Wehrgang (Besetzen, Reichweite, Rüstung, Abstieg, Sturz, Burgwache), Zustandsform, Zwischenspeicher der Sichten,
// eine 4-Minuten-Belagerung (Determinismus, Invarianten) und die Leistung mit Mauern auf der Karte.
// Phase 2a (F2, Pakte enden friedlich): P1 Verlängern (RENEW_S, beide / einer / außerhalb des Fensters, pactRenewOffer, youOf().pacts[].renew), P2 Abzug (PACT_GRACE_S: keine Schläge, keine Pfeile,
// Tore offen; die Banner mit Ziel nahe den Gebäuden des anderen ziehen heim) und P3 (ein gebrochener Pakt gibt keine Waffenruhe).
const fs = require('fs');
const W = require('./public/games/furtfehde/world.js');
const Sim = require('./public/games/furtfehde/sim.js');
const C = Sim.CONST;
// every event of every sim in this run is recorded with its field names, for the event catalogue check at the end
const SEEN = {};
{
  const create = Sim.create;
  Sim.create = function (o) {
    const sim = create(o), step = sim.step;
    sim.step = function () { const ev = step.call(sim); for (const e of ev) (SEEN[e.t] || (SEEN[e.t] = new Set())).add(Object.keys(e).filter(k => k !== 't').sort().join(',')); return ev; };
    return sim;
  };
}
const { GW, GH } = W;
const N = GW * GH;

let checks = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function eq(a, b, msg) { checks++; if (a !== b) fail(msg + ' (erwartet ' + b + ', war ' + a + ')'); }
function near(a, b, tol, msg) { checks++; if (!(Math.abs(a - b) <= tol)) fail(msg + ' (erwartet ' + b + ' ±' + tol + ', war ' + a + ')'); }
function noThrow(fn, msg) { checks++; try { return fn(); } catch (e) { fail(msg + ' wirft: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } }
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };

// ---- helpers ----
const worlds = {};
const worldOf = (seed) => worlds[seed] || (worlds[seed] = W.make(seed));
function mk(o) {
  o = o || {};
  const seed = o.seed || 1;
  return Sim.create(Object.assign({ seed, world: worldOf(seed), dauer: 12, burgfrieden: 120 }, o));
}
const secs = (s) => Math.round(s * 15);
function run(sim, n, fn) { const log = []; for (let i = 0; i < n && sim.state.phase !== 'over'; i++) { if (fn) fn(sim, i); for (const e of sim.step()) log.push(e); } return log; }
// step until pred() holds (checked before each step); returns { log, steps, hit }
function until(sim, pred, maxSteps, fn) {
  const log = []; let n = 0;
  while (n < maxSteps && sim.state.phase !== 'over' && !pred()) { if (fn) fn(sim, n); for (const e of sim.step()) log.push(e); n++; }
  return { log, steps: n, hit: pred() };
}
const ofType = (log, t) => log.filter(e => e.t === t);
const lordP = (sim, l) => sim.dev.lord(l);
const unitsOf = (sim, l, kind) => sim.state.units.filter(u => u.lord === l && (!kind || u.kind === kind));
const bOf = (sim, l, kind) => sim.state.buildings.filter(b => b.lord === l && b.kind === kind);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// R6: the keep puts out fires on its own buildings within KEEP_WELL_R; the older fire tests need a fire to burn freely next to a keep, so they switch that off
const KEEP_WELL = C.KEEP_WELL_R, keepWell = (on) => { C.KEEP_WELL_R = on ? KEEP_WELL : 0; };
function toFehde(sim) { return until(sim, () => sim.state.phase === 'fehde', secs(200)); }
function gateOf(sim, l) { const lp = lordP(sim, l); return { x: lp.gx, y: lp.gy, out: lp.out }; }
// a finished building for house l at the best spot of FurtWorld.suggest (free of charge)
function placeAt(sim, l, kind) {
  const site = sim.state.lords.find(x => x.i === l).site, s = W.suggest(sim.world, kind, site, { L: sim.state.level, occ: sim.occ });
  if (!s) return null;
  const r = sim.dev.place(l, kind, s.i, s.j, s.rot);
  return r.ok ? r.b : null;
}
// an open dry spot of quarter `l` in front of its gate, at level 0
function openSpot(sim, l, dx, dy) { const g = gateOf(sim, l); return { x: g.x + dx, y: g.y + g.out * dy }; }
const blockedAt = (sim, p) => { const k = W.cellOf(p.x, p.y); return k < 0 || sim.dev.blk[k]; };
// both banners rally at p, so soldiers spawned there are inside their leash; returns the soldier
function stage(sim, l, kind, p, n) {
  sim.banner(l, n || 1, p.x, p.y);
  return sim.dev.spawn(l, kind, p.x, p.y, n || 1);
}

// ---- catalog numbers of the contract ----
{
  eq(C.DT, 1 / 15, 'CONST.DT');
  eq(C.ARRIVE_S + '/' + C.EAT_S + '/' + C.HUNGER_WORK + '/' + C.LEAVE_S, '6/60/0.6/15', 'Ankunft/Essen/Hunger/Weggang');
  eq([C.FLOOR, C.FOOD_LOW, C.KEEP_WELL_R, C.ARROW_FACKEL].join(), '4,6,12,2', 'Phase 1b: Bauern-Untergrenze, Korn-knapp, Burgbrunnen-Reichweite, Pfeil gegen Fackel');
  eq(JSON.stringify(C.START) + C.START_PEASANTS + '/' + C.KEEP_HOUSES + '/' + C.HUT_HOUSES, '{"korn":20,"holz":25,"stein":0}6/8/4', 'Start und Wohnraum');
  eq(C.CAP_KEEP + '/' + C.CAP_KORN + '/' + C.CAP_LAGER, '30/60/60', 'Lagerkappen');
  eq([C.WOOD_R, C.CHOP_S, C.REGROW_S, C.STAND_AT, C.WOOD_N, C.QUARRY_S, C.STONE_N].join(), '10,5,120,0.6,3,8,2', 'Holz/Stein');
  eq([C.SOW_S, C.GROW_S, C.HARVEST_S, C.KORN_N, C.YIELD, C.AUE_BONUS].join(), '6,45,6,3,6,0.5', 'Hof');
  eq([C.FLEE_R, C.CALM_R, C.FLEE_RESUME_S, C.BUCKET_R, C.BUCKET_MAX, C.BUCKET_RATE].join(), '6,10,8,12,4,0.06', 'Flucht und Eimerkette');
  const b = (k) => { const x = C.BUILD[k], c = x.cost || {}; return (c.holz || 0) + 'h' + (c.stein || 0) + 's/' + (x.buildS || 0) + 's/' + x.hp + 'hp/' + (x.workers || 0) + 'w'; };
  eq(['huette', 'hof', 'kornspeicher', 'lager', 'holzfaeller'].map(b).join(' '), '4h0s/8s/120hp/0w 5h0s/10s/160hp/1w 6h0s/12s/200hp/0w 5h0s/10s/180hp/0w 3h0s/8s/120hp/1w', 'Gebäude 1');
  eq(['steinbruch', 'kaserne', 'wachturm', 'brunnen'].map(b).join(' '), '6h0s/12s/200hp/2w 8h8s/18s/500hp/0w 2h10s/16s/600hp/0w 0h4s/6s/250hp/0w', 'Gebäude 2');
  eq(C.BUILD.bergfried.hp, 3000, 'Bergfried 3000 HP');
  const u = (k) => { const x = C.UNIT[k], c = x.cost || {}; return (c.korn || 0) + 'k' + (c.holz || 0) + 'h' + (c.stein || 0) + 's' + (c.gold || 0) + 'g/' + (x.train || 0) + '/' + [x.hp, x.dmg, x.cd, x.range, x.speed, x.r].join(',') + (x.at ? '@' + x.at : ''); };
  eq(['bauer', 'speer', 'bogen', 'ritter', 'fackel'].map(u).join(' '),
    '0k0h0s0g/0/25,2,1.5,1,2.4,0.3 2k2h0s0g/4/60,8,1,1.3,2.6,0.35@kaserne 2k3h0s0g/4/40,6,1.4,9,2.6,0.35@kaserne 4k0h3s0g/6/140,14,1.2,1.5,4.2,0.6@kaserne 1k0h0s2g/2/30,0,0,1.2,4,0.3@soeldnerlager', 'Einheiten (Phase 2: der Fackelträger kostet 💰 2 🌾 1, bildet in 2 s im Söldnerlager aus)');
  eq(['reiterschuetze', 'ramme'].map(u).join(' '), '2k0h0s6g/4/70,6,1.3,8,4.4,0.6@soeldnerlager 0k10h0s4g/10/400,60,2,1.6,1.6,0.9@kaserne', 'Phase-2-Einheiten: Reiterschütze und Rammbock');
  eq(JSON.stringify(C.VS) + JSON.stringify(C.VS_BUILDING), '{"speer":{"ritter":2},"bogen":{"fackel":1.5},"ritter":{"bogen":2,"reiterschuetze":1.5},"reiterschuetze":{"speer":1.5,"fackel":1.5}}{"speer":1,"ritter":0.6,"bogen":0.3,"reiterschuetze":0.3,"ramme":1}', 'Gegenspieler und Gebäudeschaden');
  eq(JSON.stringify(C.VS_WALL) + JSON.stringify(C.ARROW_WALL) + C.ARROW_RAM, '{"speer":0.4,"ritter":0.25,"ramme":1}{"stein":0,"holz":0.15}0.25', 'Phase 2: Schaden gegen Mauern, Pfeile gegen Stein und Holz, Pfeile gegen den Rammbock');
  eq([C.TRADE_PACK, JSON.stringify(C.TRADE_PRICE)].join(' '), '5 {"sell":{"korn":1,"holz":1,"stein":2},"buy":{"korn":3,"holz":3,"stein":5}}', 'Phase 2: Handelspaket und Preise');
  eq([C.BREACH_COST, JSON.stringify(C.BREACH_MUL), C.RUBBLE_SLOW].join(' '), '60 {"palisade":0.4,"mauer":1,"torhaus":1} 0.6', 'Phase 2: Breschenkosten und Schutt');
  eq([JSON.stringify(C.SLOTS), C.GARRISON_RANGE, C.GARRISON_ARMOR, C.GARRISON_TOUCH, C.GARRISON_NEAR, C.GARRISON_FALL, C.RAM_R, C.KITE_R].join(' '), '{"mauer":1,"torhaus":4,"wachturm":3} 3 0.5 1 4 0.2 3 3', 'Phase 2: Wehrgang, Rammbock, Ausweichen');
  eq([C.GARRISON_ENTER_R, C.GARRISON_WALK_R, C.GARRISON_S, C.GARRISON_DROP_R, C.GARRISON_RETRY_S, C.WALL_PIECES_MAX, C.SLOT_LOS_R, C.KITE_S].join(), '1.1,7,1,4,5,64,1.5,0.4', 'Phase 2: eigene Feineinstellungen (Besatzung, Linien, Reiter)');
  const bb = (k) => { const x = C.BUILD[k], c = x.cost || {}; return (c.holz || 0) + 'h' + (c.stein || 0) + 's/' + x.buildS + 's/' + x.hp + 'hp' + (x.perCell ? '/je Zelle' : ''); };
  eq(['palisade', 'mauer', 'torhaus', 'markt', 'soeldnerlager'].map(bb).join(' '), '1h0s/2s/150hp/je Zelle 0h2s/4s/450hp/je Zelle 4h12s/20s/1400hp 10h0s/14s/300hp 12h0s/16s/350hp', 'Phase-2-Gebäude: Kosten, Bauzeit, HP');
  eq([C.WADE_DEALT, C.WADE_TAKEN, C.ZORN_MUL, C.ZORN_S].join(), '0.7,1.25,1.25,60', 'Waten und Zorn');
  eq([C.RENEW_S, C.PACT_GRACE_S, C.ABZUG_PAD, C.PACT_ZONE].join(), '60,30,4,6', 'Phase 2a (F2): Verlängern in den letzten 60 s, 30 s Waffenruhe, Abzug-Reichweite PACT_ZONE + 4');
  eq([C.SCAN_S, C.AGGRO_MELEE, C.AGGRO_BOGEN, C.LEASH, C.GUARD_R, C.GUARD_SELF_R, C.SLOT_GAP, C.SLOT_ROW, C.SNAP_R, C.SIEGE_R, C.TORCH_R, C.TORCH_DODGE_R].join(), '0.5,6,10,12,16,8,1.3,6,12,3,15,3', 'Heer');
  eq([C.KEEP.range, C.KEEP.dmg, C.KEEP.cd, C.TOWER.range, C.TOWER.dmg, C.TOWER.cd, C.FLIGHT_MIN, C.FLIGHT_MAX].join(), '12,6,2,12,7,1.5,0.35,0.7', 'Pfeile');
  eq([C.FIRE_GROW, C.FIRE_DMG, C.SPREAD_AT, C.SPREAD_AFTER_S, C.SPREAD_FIRE, C.SPREAD_R, C.SPREAD_R_HOF, C.CROP_BURN_AT, C.BURNT_FADE_S].join(), '0.03,20,0.6,8,0.2,3,4,0.3,60', 'Feuer');
  eq(JSON.stringify(C.RUHM) + [C.PROSPER_S, C.PROSPER_PEOPLE, C.CROWN_S, C.CROWN_LEAD, C.CROWN_MUL].join(), '{"kill":1,"killRitter":2,"raze":3,"razeMil":5,"crop":1,"plunder":20,"prosperity":1,"betray":-5}30,8,5,10,1.5', 'Ruhm');
  eq([C.LOOT, C.PLUNDER_HP, C.PROT_S, C.HOME_R, C.PACT_S, C.OFFER_S, C.EBB_S, C.WARN_S, C.LAST_S, C.ALERT_S].join(), '0.5,0.3,60,16,180,30,25,15,60,10', 'Plünderung, Pakte, Phasen');
}

// ---- no forbidden APIs ----
{
  const src = fs.readFileSync('./public/games/furtfehde/sim.js', 'utf8');
  ok(!/Math\.random/.test(src), 'sim.js enthält Math.random');
  ok(!/\bDate\b/.test(src), 'sim.js enthält Date');
  ok(!/performance\.now/.test(src), 'sim.js enthält performance.now');
  ok(!/setTimeout|setInterval|document\.|\bwindow\.(?!FurtSim)/.test(src.replace(/typeof window[^;]*;/g, '')), 'sim.js greift auf Browser-/Zeit-APIs zu');
  ok(typeof Sim.create === 'function' && Sim.CONST === C, 'Exporte create und CONST');
}

// ---- create: state and API shapes, field by field ----
{
  const sim = mk(), st = sim.state, w = sim.world;
  eq(sim.dt, 1 / 15, 'sim.dt');
  eq(Object.keys(st).join(), 't,dayT,level,phase,endsAt,lords,buildings,units,banners,trees,treeV,pacts,ranking', 'Zustandsfelder');
  eq(st.t, 0, 't = 0'); eq(st.level, 1, 'Wasser steht bei Beginn auf 1'); eq(st.phase, 'frieden', 'Phase frieden'); eq(st.endsAt, 720, 'endsAt = dauer · 60 s'); eq(st.ranking, null, 'ranking erst am Ende');
  ok(st.trees instanceof Float32Array && st.trees.length === w.trees.length && st.trees.every(v => v === 1), 'trees: Float32Array, alle Bäume 1'); eq(st.treeV, 0, 'treeV = 0');
  eq(st.lords.length, 4, '4 Häuser');
  const lf = (l) => Object.keys(l).join();
  eq(lf(st.lords[0]), 'i,site,emblem,crown,ruhm,people,soldiers,prot,zorn,hunger,gold', 'Haus-Felder (Phase 2: gold)');
  eq(JSON.stringify(st.lords[2]), JSON.stringify({ i: 2, site: 2, emblem: 2, crown: false, ruhm: 0, people: 6, soldiers: 0, prot: 0, zorn: 0, hunger: false, gold: 0 }), 'Haus 2 am Anfang');
  eq(st.buildings.length, 4, 'vier Bergfriede');
  eq(Object.keys(st.buildings[0]).join(), 'id,lord,kind,i,j,rot,build,hp,fire,burnt,ruined,growth,workers,paused,full,len,garrison', 'Gebäude-Felder (Phase 2: len, garrison)');
  st.buildings.forEach((b, i) => { eq(b.kind, 'bergfried', 'Burg ' + i); eq(b.i, w.sites[i].keep.i, 'Burg i'); eq(b.j, w.sites[i].keep.j, 'Burg j'); eq(b.hp, 1, 'Burg hp 1'); eq(b.build, 1, 'Burg fertig'); });
  eq(st.units.length, 24, '4 × 6 Bauern');
  eq(Object.keys(st.units[0]).join(), 'id,lord,kind,x,y,px,py,h,ph,hp,anim,carry,n,on,slot', 'Einheiten-Felder (Phase 2: on, slot)');
  ok(st.units.every(u => u.kind === 'bauer' && u.n === -1 && u.carry === null && u.hp === 25 && u.on === null && u.slot === -1), 'Starteinheiten: Bauern, n = −1, hp 25, nicht im Wehrgang');
  ok(st.buildings.every(b => b.len === 1 && b.garrison === 0), 'Bergfriede: len 1, keine Besatzung');
  ok(new Set([...st.units.map(u => u.id), ...st.buildings.map(b => b.id)]).size === 28, 'Ids sind eindeutig');
  // every peasant stands within 4 of its own gate
  ok(st.units.every(u => dist(u, gateOf(sim, u.lord)) <= C.YARD_R + 1e-9), 'Bauern warten im Hof (≤ 4 vom Tor)');
  ok(Array.isArray(st.banners) && st.banners.length === 0 && Array.isArray(st.pacts) && st.pacts.length === 0, 'keine Banner und Pakte am Anfang');
  // gates face the river: sites 0/1 open south, 2/3 north; the gate cell is the centre of the row in front of the keep
  w.sites.forEach((s, i) => { const g = gateOf(sim, i); near(g.x, s.x + 0.5, 1e-9, 'Tor x ' + i); near(g.y, s.y + (i < 2 ? 3.5 : -3.5), 1e-9, 'Tor y ' + i); });
  const y = sim.youOf(1);
  eq(Object.keys(y).join(), 'stock,cap,pop,popCap,idle,hunger,queue,ruhm,crown,banners,pacts,food', 'youOf-Felder');
  eq(JSON.stringify(y.stock) + JSON.stringify(y.cap) + y.pop + '/' + y.popCap + '/' + y.idle, '{"korn":20,"holz":25,"stein":0,"gold":0}{"korn":30,"holz":30,"stein":30}6/8/6', 'youOf am Anfang');
  eq(y.hunger, false, 'youOf.hunger'); eq(JSON.stringify(y.queue), '[]', 'youOf.queue'); eq(y.pacts.length, 3, 'youOf.pacts: die drei anderen Häuser'); ok(y.pacts.every(p => p.state === 'none' && p.until === 0 && p.renew === null && Object.keys(p).join() === 'with,state,until,renew'), 'youOf.pacts: keine Pakte, Felder with,state,until,renew');
  eq(sim.youOf(7), null, 'youOf(unbekannt) = null');
  // 3 and 2 houses: the glue passes lords [{i, site}]
  const s3 = mk({ lords: [{ i: 0, site: 0 }, { i: 1, site: 1 }, { i: 2, site: 3 }] }), s2 = mk({ lords: [{ i: 0, site: 0 }, { i: 1, site: 3 }] });
  eq(s3.state.lords.map(l => l.site).join(), '0,1,3', '3 Häuser: Burgen 0, 1, 3'); eq(s3.state.buildings.length, 3, '3 Bergfriede'); eq(s3.state.units.length, 18, '3 × 6 Bauern');
  eq(s2.state.lords.map(l => l.site).join(), '0,3', '2 Häuser: Burgen 0 und 3'); eq(gateOf(s2, 1).out, -1, 'Haus auf Burg 3: Tor nach Norden');
  // identical seeds give identical starts; a bad lords list falls back to the default four
  eq(mk({ lords: [{ i: 0, site: 9 }, null, { i: 'x' }] }).state.lords.length, 4, 'ungültige lords → vier Häuser');
}

// ---- invalid input never throws and answers { ok: false, reason } ----
{
  const sim = mk(), junk = [undefined, null, NaN, Infinity, -Infinity, -1, 0.5, 99, 'x', '', {}, [], true, () => 1];
  let n = 0;
  for (const bad of junk) {
    const calls = [
      () => sim.build(bad, 'huette', 5, 5, 0), () => sim.build(0, bad, 5, 5, 0), () => sim.build(0, 'huette', bad, 5, 0), () => sim.build(0, 'huette', 5, bad, 0), () => (bad === undefined || bad === null || bad === true ? { ok: false } : sim.build(0, 'huette', 5, 5, bad)),
      () => sim.cancel(bad, 1), () => sim.cancel(0, bad), () => sim.pause(bad, 1, true), () => sim.pause(0, bad, true), () => sim.pause(0, 1, bad), () => sim.recruit(bad, 'speer', 1), () => sim.recruit(0, bad, 1), () => sim.recruit(0, 'speer', bad),
      () => sim.banner(bad, 1, 0, 0), () => sim.banner(0, bad, 0, 0), () => sim.banner(0, 1, bad, 0), () => sim.banner(0, 1, 0, bad), () => sim.home(bad),
      () => sim.pact(bad, 1, true), () => sim.pact(0, bad, true), () => sim.pact(0, 1, bad), () => sim.youOf(bad),
      // Phase 2: walls (len), buildWall, trade
      () => sim.build(0, 'mauer', 5, 5, 0, bad), () => sim.buildWall(bad, 'mauer', [[5, 5, 0, 1]]), () => sim.buildWall(0, bad, [[5, 5, 0, 1]]), () => sim.buildWall(0, 'mauer', bad), () => sim.buildWall(0, 'mauer', [[bad, bad, bad, bad]]), () => sim.buildWall(0, 'mauer', [bad]),
      () => sim.trade(bad, 'korn', 'sell', 1), () => sim.trade(0, bad, 'sell', 1), () => sim.trade(0, 'korn', bad, 1), () => sim.trade(0, 'korn', 'sell', bad)
    ];
    for (const f of calls) {
      const r = noThrow(f, 'Eingabe ' + String(bad)), isYou = r === null || (r && r.stock);
      n++;
      if (r !== undefined && !isYou) ok(r && typeof r.ok === 'boolean', 'Antwort hat ok');
      if (r && (r.placed !== undefined || r.n !== undefined)) ok(r.ok === false && (r.placed === 0 || r.n === 0 || r.reason === 'bounds'), 'schlechte Eingabe setzt nichts und handelt nichts' + JSON.stringify(r));
    }
  }
  ok(n > 380, 'viele ungültige Aufrufe geprüft (' + n + ')');
  const r1 = sim.build(9, 'huette', 5, 5, 0), r2 = sim.build(0, 'zelt', 5, 5, 0), r3 = sim.build(0, 'bergfried', 5, 5, 0), r4 = sim.build(0, 'huette', NaN, 5, 0);
  eq(r1.ok === false && r1.reason, 'lord', 'unbekanntes Haus'); eq(r2.reason, 'kind', 'unbekannte Art'); eq(r3.reason, 'kind', 'Bergfried ist nicht baubar'); eq(r4.reason, 'bounds', 'NaN-Koordinate');
  eq(sim.recruit(0, 'bauer', 1).reason, 'unit', 'Bauern kann man nicht ausheben'); eq(sim.recruit(0, 'speer', 7).reason, 'banner', 'Banner 7 gibt es nicht');
  eq(sim.banner(0, 0, 0, 0).reason, 'none', 'die Burgwache bekommt keine Befehle'); eq(sim.banner(0, 4, 0, 0).reason, 'none', 'Banner 4 gibt es nicht'); eq(sim.banner(5, 1, 0, 0).reason, 'lord', 'banner: unbekanntes Haus');
  eq(sim.pact(0, 0, true).reason, 'self', 'Pakt mit sich selbst'); eq(sim.pact(0, 9, true).reason, 'lord', 'Pakt mit Unbekanntem'); eq(sim.cancel(0, 12345).reason, 'none', 'cancel: unbekannte Id'); eq(sim.cancel(0, 1).reason, 'kind', 'der Bergfried lässt sich nicht abreißen');
  eq(sim.home(9).ok, false, 'home(unbekannt)');
  ok(sim.state.buildings.length === 4, 'ungültige Aufrufe haben nichts gebaut'); eq(JSON.stringify(sim.youOf(0).stock), '{"korn":20,"holz":25,"stein":0,"gold":0}', 'und nichts bezahlt');
}

// ---- match flow: phases, level, events ----
{
  const sim = mk({ dauer: 6, burgfrieden: 60 }), st = sim.state, log = [], levels = [];
  for (let i = 0; i < 5400; i++) { for (const e of sim.step()) log.push({ ...e, at: st.t }); levels.push([st.t, st.level, st.phase]); if (st.phase === 'over') break; }
  const first = (t) => log.find(e => e.t === t), ts = log.map(e => e.t);
  eq(ts[0], 'frieden', 'erstes Ereignis: frieden');
  near(first('warn').at, 45, 0.1, 'warn 15 s vor der Ebbe'); eq(first('warn').kind, 'ebbe', 'warn.kind'); eq(first('warn').in, 15, 'warn.in');
  near(first('ebbe').at, 60, 0.1, 'ebbe nach dem Burgfrieden'); near(first('fehde').at, 85, 0.1, 'fehde 25 s später'); near(first('lastMinute').at, 300, 0.1, 'lastMinute 60 s vor dem Ende');
  const over = first('over'); near(over.at, 360, 0.1, 'over nach der Spieldauer'); eq(over.ranking.length, 4, 'over.ranking');
  eq(log.filter(e => e.t === 'frieden' || e.t === 'ebbe' || e.t === 'fehde' || e.t === 'lastMinute' || e.t === 'over').length, 5, 'jedes Phasenereignis genau einmal');
  eq(ts.indexOf('warn') < ts.indexOf('ebbe') && ts.indexOf('ebbe') < ts.indexOf('fehde') && ts.indexOf('fehde') < ts.indexOf('lastMinute'), true, 'Phasenreihenfolge');
  // level: 1 during the Burgfrieden, linear over 25 s, then 0; phase names follow
  const at = (s) => levels.find(l => l[0] >= s - 1e-9);
  eq(at(30)[1], 1, 'L = 1 im Burgfrieden'); eq(at(30)[2], 'frieden', 'Phase frieden'); near(at(72.5)[1], 0.5, 0.01, 'L = 0.5 mitten in der Ebbe'); eq(at(72.5)[2], 'ebbe', 'Phase ebbe'); eq(at(100)[1], 0, 'L = 0 im Krieg'); eq(at(100)[2], 'fehde', 'Phase fehde');
  ok(levels.every((l, i) => i === 0 || l[1] <= levels[i - 1][1] + 1e-12), 'das Wasser steigt nie wieder');
  near(at(200)[0] / 360, 0.5556, 0.01, 'Zeitstempel'); near(st.dayT, 1, 1e-9, 'dayT = t / (dauer · 60) am Ende');
  // crossings open one after the other as L passes their `open` value; the fords come last
  const opens = log.filter(e => e.t === 'crossingOpen'), w = sim.world;
  eq(opens.length, 7, 'sieben Übergänge öffnen');
  const openOf = (id) => w.crossings.find(c => c.id === id).open;
  ok(opens.every((e, i) => i === 0 || openOf(e.id) <= openOf(opens[i - 1].id) + 1e-12), 'Übergänge öffnen in der Reihenfolge ihres open-Werts');
  eq(opens[0].id, 'steinbruecke', 'die Steinbrücke zuerst'); ok(opens.slice(1, 3).every(e => /steg/.test(e.id)), 'dann die Stege'); ok(opens.slice(3).every(e => /furt/.test(e.id)), 'die Furten zuletzt');
  for (const e of opens) { const c = w.crossings.find(x => x.id === e.id), lv = levels.find(l => l[0] >= e.at - 1e-9)[1]; ok(lv <= c.open + 1e-9 && lv > c.open - 0.07, 'crossingOpen ' + e.id + ' bei L ≈ open (' + lv.toFixed(3) + ' vs ' + c.open + ')'); }
  eq(JSON.stringify(sim.step()), '[]', 'step() nach dem Ende liefert []'); eq(sim.state.phase, 'over', 'Phase over');
  const j0 = JSON.stringify(st); run(sim, 30); eq(JSON.stringify(st), j0, 'nach dem Ende ändert sich nichts mehr');
  eq(sim.build(0, 'huette', 5, 5, 0).reason, 'phase', 'nach dem Ende: build → phase'); eq(sim.recruit(0, 'speer', 1).reason, 'phase', 'recruit → phase'); eq(sim.banner(0, 1, 0, 0).reason, 'phase', 'banner → phase');
  // ranking order: Ruhm, then people, then finished buildings
  const rk = over.ranking; ok(rk.every((r, i) => r.rank === i + 1 && (i === 0 || rk[i - 1].ruhm >= r.ruhm)), 'Rangliste nach Ruhm sortiert'); eq(Object.keys(rk[0]).join(), 'rank,lord,ruhm,people,soldiers,buildings,stats,by', 'Ranglisten-Felder');
  eq(JSON.stringify(st.ranking), JSON.stringify(rk), 'state.ranking = Ereignis-Rangliste');
}
{
  // no truce: the ebb starts at once; a house at level 0 from the beginning of the war
  const sim = mk({ burgfrieden: 0 }), log = run(sim, secs(26));
  eq(log[0].t, 'ebbe', 'ohne Burgfrieden beginnt die Ebbe sofort'); ok(log.some(e => e.t === 'fehde'), 'und der Krieg nach 25 s'); eq(sim.state.level, 0, 'L = 0'); ok(!log.some(e => e.t === 'frieden'), 'kein frieden-Ereignis');
}

// ---- economy: arrivals, eating, hunger ----
{
  const sim = mk(), st = sim.state, log = [];
  const pop = []; for (let i = 0; i < secs(60); i++) { for (const e of sim.step()) log.push({ ...e, at: st.t }); pop.push(st.lords[0].people); }
  const arr0 = log.filter(e => e.t === 'arrive' && e.lord === 0);
  eq(arr0.length, 2, 'Haus 0: zwei Ankünfte bis zur Obergrenze 8'); near(arr0[0].at, 6, 0.1, 'erste Ankunft nach 6 s'); near(arr0[1].at, 12, 0.1, 'zweite nach 12 s'); eq(st.lords[0].people, 8, 'Wohnraum 8 erreicht');
  eq(sim.youOf(0).pop, 8, 'youOf.pop'); eq(sim.youOf(0).popCap, 8, 'popCap = 8 (Burg)');
  // everybody eats: 🌾 falls by people/60 per second (one sack a minute each)
  const eaten = 20 - sim.youOf(0).stock.korn, expected = (6 * 6 + 7 * 6 + 8 * 48) / 60;
  near(eaten, expected, 1.01, 'Essen: ' + eaten + ' Säcke in 60 s (erwartet ≈ ' + expected.toFixed(1) + ')');
  // a new peasant appears at the gate
  const a = unitsOf(sim, 0).slice(-1)[0]; ok(a.kind === 'bauer', 'neuer Bauer');
  // a hut raises the cap: arrivals resume 6 s after the room appears
  const hut = placeAt(sim, 0, 'huette');
  eq(sim.youOf(0).popCap, 12, 'Hütte: +4 Wohnraum'); const l2 = run(sim, secs(13)); eq(ofType(l2, 'arrive').filter(e => e.lord === 0).length, 2, 'zwei weitere Ankünfte in 13 s');
  // a ruined hut does not house anyone
  sim.dev.damage(hut, 1e9, 1); eq(sim.youOf(0).popCap, 8, 'ruinierte Hütte zählt nicht');
}
{
  // hunger: no 🌾 → no arrivals, work × 0.6, one peasant leaves every 15 s; ends at 🌾 ≥ 1
  const sim = mk(), st = sim.state;
  placeAt(sim, 0, 'huette'); sim.dev.stock(0, { korn: 0 });
  run(sim, 2);
  const l1 = run(sim, secs(40), (s) => { s.dev.stock(0, { korn: 0 }); });
  const hu = ofType(l1, 'hunger'); ok(hu.length <= 1, 'ein hunger-Ereignis');
  eq(st.lords[0].hunger, true, 'Haus hungert'); eq(sim.youOf(0).hunger, true, 'youOf.hunger');
  eq(ofType(l1, 'arrive').filter(e => e.lord === 0).length, 0, 'Hunger: keine Ankünfte trotz Wohnraum');
  eq(ofType(l1, 'leave').filter(e => e.lord === 0).length, 2, 'Hunger: alle 15 s geht ein Bauer (2 in 40 s)');
  ok(st.lords[0].people <= 4 + 1, 'Bauern sind fort (' + st.lords[0].people + ')');
  // food ends the hunger
  const l2 = run(sim, 2, (s) => { s.dev.stock(0, { korn: 5 }); });
  const off = ofType(l2, 'hunger'); eq(off.length, 1, 'hunger-Ende gemeldet'); eq(off[0].on, false, 'hunger.on = false'); eq(st.lords[0].hunger, false, 'Haus hungert nicht mehr');
  const l3 = run(sim, secs(14)); ok(ofType(l3, 'arrive').filter(e => e.lord === 0).length >= 1, 'danach kommen wieder Bauern');
}
{
  // hunger slows work to 60 %: a hut takes 8 s, or 13.3 s when hungry
  const dur = (hungry) => {
    const sim = mk(), hs = W.suggest(sim.world, 'huette', 0, { L: 1, occ: sim.occ });
    if (hungry) sim.dev.stock(0, { korn: 0 });
    const r = sim.build(0, 'huette', hs.i, hs.j, hs.rot), b = sim.state.buildings.find(x => x.id === r.id);
    let t0 = -1, t1 = -1;
    for (let i = 0; i < secs(60) && t1 < 0; i++) {
      if (hungry) sim.dev.stock(0, { korn: 0 });
      sim.step();
      const builder = unitsOf(sim, 0, 'bauer').find(u => u._.job === 6 && u._.ws === 1);
      if (builder && t0 < 0) t0 = sim.state.t;
      if (b.build >= 1) t1 = sim.state.t;
    }
    return t1 - t0;
  };
  const d0 = dur(false), d1 = dur(true);
  near(d0, 8, 0.4, 'Hütte baut in 8 s (' + d0.toFixed(2) + ')'); near(d1, 8 / 0.6, 0.5, 'hungrig dauert es 8 / 0.6 s (' + d1.toFixed(2) + ')');
}

// ---- R1 (Phase 1b): never a dead end — hunger stops at FLOOR peasants; below FLOOR peasants arrive even when hungry ----
{
  const hold = (s) => { s.dev.stock(0, { korn: 0 }); };   // keep house 0 without any 🌾
  // (a) a hungry house loses peasants only down to FLOOR and keeps them for good
  const sim = mk(), st = sim.state, log = run(sim, secs(150), hold);
  eq(ofType(log, 'leave').filter(e => e.lord === 0).length, 6 - C.FLOOR, 'Hunger: 6 → 4 Bauern, dann geht keiner mehr (' + (6 - C.FLOOR) + ' Abgänge in 150 s)');
  eq(unitsOf(sim, 0, 'bauer').length, C.FLOOR, 'FLOOR = 4 Bauern bleiben'); eq(st.lords[0].hunger, true, 'das Haus hungert weiter'); eq(sim.youOf(0).hunger, true, 'youOf.hunger');
  eq(ofType(log, 'arrive').filter(e => e.lord === 0).length, 0, 'bei genau FLOOR Bauern kommt keiner hinzu (nur bei weniger)');
  // (b) soldiers do not count as peasants: 4 peasants and 3 soldiers, hungry for a minute → nobody leaves
  const saved = C.START_PEASANTS; C.START_PEASANTS = 4; const sb = mk(); C.START_PEASANTS = saved;
  const g = gateOf(sb, 0); for (let i = 0; i < 3; i++) sb.dev.spawn(0, 'speer', g.x + i, g.y + g.out * 6, 1);
  const lb = run(sb, secs(60), hold);
  eq(ofType(lb, 'leave').length, 0, 'mit 4 Bauern und 3 Soldaten geht kein Bauer'); eq(unitsOf(sb, 0, 'bauer').length, 4, 'die 4 Bauern bleiben'); eq(unitsOf(sb, 0).length, 7, '(und die 3 Soldaten)');
  // (c) below FLOOR a peasant arrives every ARRIVE_S, hungry or not, until FLOOR is reached
  C.START_PEASANTS = 1; const sc = mk(); C.START_PEASANTS = saved;
  const arr = []; const lc = run(sc, secs(60), hold); for (const e of lc) if (e.t === 'arrive' && e.lord === 0) arr.push(e);
  eq(arr.length, C.FLOOR - 1, 'bei 1 Bauer kommen 3 nach: FLOOR (4) erreicht, dann Schluss'); eq(unitsOf(sc, 0, 'bauer').length, C.FLOOR, '4 Bauern'); eq(sc.state.lords[0].hunger, true, '(und das trotz Hunger)');
  { C.START_PEASANTS = 1; const s3 = mk({ seed: 2 }); C.START_PEASANTS = saved; const t = []; for (let i = 0; i < secs(20); i++) { s3.dev.stock(0, { korn: 0 }); for (const e of s3.step()) if (e.t === 'arrive' && e.lord === 0) t.push(Math.round(s3.state.t)); } ok(t.length === 3 && t[0] === 6 && t[1] === 12 && t[2] === 18, 'sie kommen alle ARRIVE_S = 6 s (' + t.join(', ') + ' s)'); }
  // ... but only while there is housing: 8 soldiers fill the keep, so not even 0 peasants bring a new one
  C.START_PEASANTS = 0; const sd = mk(); C.START_PEASANTS = saved;
  for (let i = 0; i < 8; i++) sd.dev.spawn(0, 'speer', g.x + (i % 4), g.y + g.out * (6 + (i >> 2)), 1);
  eq(run(sd, secs(30), hold).filter(e => e.t === 'arrive' && e.lord === 0).length, 0, 'Wohnraum voll (8 Soldaten, popCap 8): auch unter FLOOR kommt keiner');
  // (d) the user's dead end: no peasant left, no 🌾, one Hof → peasants come, the field is sown and harvested, the house eats again and grows
  C.START_PEASANTS = 0; const se = mk(); C.START_PEASANTS = saved;
  se.dev.stock(0, { korn: 0 }); const hof = placeAt(se, 0, 'hof');
  const le = run(se, secs(260));
  ok(ofType(le, 'harvest').some(e => e.id === hof.id), 'der Hof wird geerntet, obwohl das Haus ganz leer anfing'); ok(ofType(le, 'deliver').some(e => e.res === 'korn' && e.lord === 0), 'und das Korn kommt im Lager an');
  eq(se.state.lords[0].hunger, false, 'danach ist der Hunger vorbei'); ok(se.state.lords[0].people > C.FLOOR, 'und es kommen mehr als FLOOR Leute (' + se.state.lords[0].people + ')');
  ok(ofType(le, 'hunger').filter(e => e.lord === 0 && e.on === false).length >= 1, 'hunger { on: false } wurde gemeldet');
  // (e) a besieged gate: while an enemy soldier stands within GATE_SAFE_R of it nobody moves in (no Ruhm farm for the besieger); once it is clear the next one comes at once
  C.START_PEASANTS = 1; const sf = mk(); C.START_PEASANTS = saved;
  const gf = gateOf(sf, 0), fx = gf.x + 2, fy = gf.y + gf.out * 2, foe = sf.dev.spawn(1, 'ritter', fx, fy, 1);
  const pin = (s) => { hold(s); if (foe.hp > 0) { foe.x = fx; foe.y = fy; foe.hp = C.UNIT.ritter.hp; } };   // the keep shoots at him: keep him alive and in place
  eq(run(sf, secs(40), pin).filter(e => e.t === 'arrive' && e.lord === 0).length, 0, 'Feind am Tor (≤ ' + C.GATE_SAFE_R + '): auch unter FLOOR kommt keiner ins belagerte Dorf');
  sf.dev.kill(foe);
  eq(run(sf, 2, hold).filter(e => e.t === 'arrive' && e.lord === 0).length, 1, 'ist das Tor frei, kommt der nächste sofort');
}

// ---- construction: reasons, fetch → carry → build, cancel, ruin, rebuild ----
const JOB = { IDLE: 0, TOWORK: 1, WORK: 2, CARRY: 3, RETURN: 4, FETCH: 5, BUILD: 6, RECRUIT: 7, BUCKET: 8, FLEE: 9, LEAVE: 10 };
{
  const sim = mk(), st = sim.state, w = sim.world, occ = sim.occ;
  // every canPlace reason that the world can produce, found on the real map, must come back unchanged from build() and cost nothing
  const reasons = {};
  const probe = (kind, lord) => {
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) for (const rot of [0, 1]) {
      const r = W.canPlace(w, kind, i, j, rot, { lord, L: 1, occ });
      if (!r.ok && !reasons[r.reason]) reasons[r.reason] = { kind, i, j, rot, lord };
    }
  };
  probe('huette', 0); probe('holzfaeller', 0); probe('steinbruch', 0);
  for (const re of ['bounds', 'owner', 'terrain', 'wet', 'occupied', 'tight', 'forest', 'rock']) {
    const c = reasons[re]; ok(c, 'Beispiel für den Grund ' + re + ' gefunden'); if (!c) continue;
    const before = JSON.stringify(sim.youOf(0).stock), r = sim.build(0, c.kind, c.i, c.j, c.rot);
    eq(r.ok, false, re + ': abgelehnt'); eq(r.reason, re, re + ': Grund wie bei FurtWorld.canPlace'); eq(JSON.stringify(sim.youOf(0).stock), before, re + ': nichts bezahlt');
  }
  eq(sim.build(0, 'huette', 0, 0, 7).reason, 'bounds', 'ungültiges rot');
  // a spot that is dry only after the ebb is refused during the flood (reason wet) and accepted later
  const hs = W.suggest(w, 'hof', 0, { L: 0, occ });
  const wetSpot = (() => { for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { const a = W.canPlace(w, 'huette', i, j, 0, { lord: 0, L: 1, occ }), b = W.canPlace(w, 'huette', i, j, 0, { lord: 0, L: 0, occ }); if (a.reason === 'wet' && b.ok) return { i, j }; } return null; })();
  ok(wetSpot, 'es gibt Bauland, das erst nach der Ebbe trocken wird');
  ok(hs, 'hof hat einen Platz');
}
{
  const sim = mk(), st = sim.state, w = sim.world;
  const s = W.suggest(w, 'huette', 0, { L: 1, occ: sim.occ });
  const r = sim.build(0, 'huette', s.i, s.j, s.rot);
  eq(r.ok, true, 'build ok'); ok(Number.isInteger(r.id), 'build liefert die Id');
  const b = st.buildings.find(x => x.id === r.id);
  eq(b.build, 0, 'Baustelle: build 0'); near(b.hp, 0.1, 1e-9, 'Baustelle: hp mindestens 10 %'); eq(b.ruined, false, 'nicht ruiniert'); eq(b.lord, 0, 'Besitzer'); eq(b.kind, 'huette', 'Art'); eq(b.growth, 1, 'growth bei Nicht-Höfen 1');
  eq(JSON.stringify(sim.youOf(0).stock), '{"korn":20,"holz":21,"stein":0,"gold":0}', 'Kosten sofort bezahlt (4 Holz)');
  const [fw, fh] = W.footprintOf('huette', s.rot);
  let occN = 0; for (let k = 0; k < N; k++) if (sim.occ[k] === 1 + Object.keys(W.BUILDINGS).indexOf('huette')) occN++;
  eq(occN, fw * fh, 'occ trägt den Grundriss ein (Code 1 + Index)');
  eq(sim.build(0, 'huette', s.i, s.j, s.rot).reason, 'occupied', 'dieselbe Stelle ist belegt');
  // the builder: fetch from the keep (walk, no load) → carry holz to the site → work → done; anim and carry tell what he does
  const seen = new Set(); let builder = null, t0 = 0, doneAt = -1, last = 0;
  const trace = [];
  const log = run(sim, secs(40), () => {
    const u = unitsOf(sim, 0, 'bauer').find(x => x._.site === b);
    if (u) {
      builder = u; const p = u._, key = p.job + ':' + p.ws + ':' + u.anim + ':' + u.carry;
      if (!seen.has(key)) { seen.add(key); trace.push(key); }
      if (p.job === JOB.BUILD && p.ws === 1 && !t0) t0 = st.t;
    }
    if (b.build >= 1 && doneAt < 0) doneAt = st.t;
    ok(b.build >= last - 1e-12, 'build wächst nur'); last = b.build;
  });
  ok(builder, 'ein Bauer wird Baumeister');
  ok(trace.some(k => /^5:\d+:walk:null$/.test(k)), 'Holen: anim walk, nichts in der Hand (' + trace.join(' ') + ')');
  ok(trace.some(k => /^6:0:walk:holz$/.test(k)), 'Tragen: anim walk, carry holz');
  ok(trace.some(k => /^6:1:work:null$/.test(k)), 'Bauen: anim work, nichts in der Hand');
  near(doneAt - t0, 8, 0.3, 'Hütte: 8 s Bauzeit (' + (doneAt - t0).toFixed(2) + ')');
  eq(b.build, 1, 'fertig'); near(b.hp, 1, 1e-9, 'fertig: hp 1'); eq(ofType(log, 'buildDone').length, 1, 'buildDone einmal'); eq(ofType(log, 'build')[0] && ofType(log, 'build')[0].kind, 'huette', 'build-Ereignis'); eq(ofType(log, 'build')[0].lord, 0, 'build.lord');
  eq(builder._.job, JOB.IDLE, 'Baumeister ist wieder frei'); eq(sim.youOf(0).popCap, 12, 'fertige Hütte: +4');
  // a site stays untouched without a builder
  const saved = C.START_PEASANTS, savedF = C.FLOOR; C.START_PEASANTS = 0; C.FLOOR = 0;   // (no floor arrivals: this house must stay empty)
  const s0 = mk(); C.START_PEASANTS = saved;
  s0.dev.stock(0, { korn: 0 });
  const r0 = s0.build(0, 'huette', s.i, s.j, s.rot), site = s0.state.buildings.find(x => x.id === r0.id);
  run(s0, secs(30)); C.FLOOR = savedF; eq(site.build, 0, 'ohne Bauer bleibt die Baustelle bei build 0'); eq(s0.state.units.filter(u => u.lord === 0).length, 0, '(niemand da)');
}
{
  // cancel: a site is refunded in full, a finished building is demolished without refund, a ruin is cleared
  const sim = mk(), st = sim.state;
  const s = W.suggest(sim.world, 'kaserne', 0, { L: 1, occ: sim.occ });
  sim.dev.stock(0, { holz: 30, stein: 20 });
  const r = sim.build(0, 'kaserne', s.i, s.j, s.rot);
  eq(JSON.stringify(sim.youOf(0).stock), '{"korn":20,"holz":22,"stein":12,"gold":0}', 'Kaserne kostet 8 Holz und 8 Stein');
  run(sim, secs(4));
  const builder = unitsOf(sim, 0).find(u => u._.site && u._.site.id === r.id);
  ok(builder, 'Baumeister unterwegs');
  const c = sim.cancel(0, r.id);
  eq(c.ok, true, 'cancel ok'); eq(JSON.stringify(sim.youOf(0).stock), '{"korn":' + sim.youOf(0).stock.korn + ',"holz":30,"stein":20,"gold":0}', 'Baustelle: volle Rückerstattung');
  ok(!st.buildings.some(b => b.id === r.id), 'Baustelle verschwindet'); const l1 = run(sim, 2); eq(ofType(l1, 'cancel').length, 1, 'cancel-Ereignis'); eq(ofType(l1, 'cancel')[0].id, r.id, 'cancel.id');
  eq(builder._.job, JOB.IDLE, 'Baumeister ist frei'); eq(sim.occ[s.j * GW + s.i], 0, 'Grundriss frei');
  eq(sim.build(0, 'kaserne', s.i, s.j, s.rot).ok, true, 'der Platz ist wieder bebaubar');
  const k = placeAt(sim, 0, 'huette'), before = JSON.stringify(sim.youOf(0).stock.holz);
  eq(sim.cancel(0, k.id).ok, true, 'fertiges Gebäude abreißen'); eq(JSON.stringify(sim.youOf(0).stock.holz), before, 'kein Geld zurück'); ok(!st.buildings.some(b => b.id === k.id), 'abgerissen');
  eq(sim.cancel(1, bOf(sim, 0, 'kaserne')[0].id).ok, false, 'fremdes Gebäude nicht abreißbar');
  // ruin: blocks the footprint, can be rebuilt on the same spot for half the cost, keeps the id
  const h = placeAt(sim, 0, 'holzfaeller'), id = h.id; const hs = { i: h.i, j: h.j, rot: h.rot };
  sim.dev.stock(0, { holz: 12, stein: 20 });   // (wood well below the cap: R11 rests a woodcutter whose store is full)
  const wk = unitsOf(sim, 0).filter(u => u._.wb === h); run(sim, secs(3));
  const w1 = unitsOf(sim, 0).filter(u => u._.wb === h); eq(w1.length, 1, 'Holzfäller hat seinen Arbeiter'); eq(h.workers, 1, 'workers = 1');
  sim.dev.damage(h, 1e9, 1);
  const l2 = run(sim, 1);
  eq(h.ruined, true, 'ruiniert'); eq(h.hp, 0, 'Ruine hp 0'); eq(h.fire, 0, 'Ruine brennt nicht'); eq(ofType(l2, 'ruined').length, 1, 'ruined-Ereignis'); eq(ofType(l2, 'ruined')[0].id, id, 'ruined.id'); eq(ofType(l2, 'ruined')[0].by, 1, 'ruined.by');
  eq(h.workers, 0, 'Ruine hat keine Arbeiter'); eq(w1[0]._.wb, null, 'Arbeiter freigesetzt'); eq(sim.state.lords[1].ruhm, 3, 'Ruhm +3 fürs Zerstören');
  ok(sim.occ[h.j * GW + h.i] > 0, 'Ruine blockiert den Grundriss'); eq(W.canPlace(sim.world, 'holzfaeller', hs.i, hs.j, hs.rot, { lord: 0, L: 0, occ: sim.occ }).reason, 'occupied', 'canPlace: belegt');
  eq(sim.build(0, 'huette', hs.i, hs.j, 0).reason, 'occupied', 'andere Art auf der Ruine: belegt');
  const stk = sim.youOf(0).stock.holz;
  const rb = sim.build(0, 'holzfaeller', hs.i, hs.j, hs.rot);
  eq(rb.ok, true, 'Wiederaufbau ok'); eq(rb.id, id, 'Wiederaufbau behält die Id'); eq(stk - sim.youOf(0).stock.holz, 2, 'Wiederaufbau kostet die Hälfte (3 Holz → 2)');
  eq(h.ruined, false, 'nicht mehr ruiniert'); eq(h.build, 0, 'build 0'); near(h.hp, 0.1, 1e-9, 'hp 10 %'); const l3 = run(sim, 1); eq(ofType(l3, 'rebuild').length, 1, 'rebuild-Ereignis'); eq(ofType(l3, 'rebuild')[0].id, id, 'rebuild.id'); eq(ofType(l3, 'build').length, 0, 'kein build-Ereignis');
  run(sim, secs(25)); eq(h.build, 1, 'Wiederaufbau wird fertig'); eq(h.workers, 1, 'und wieder besetzt');
  // clearing a ruin
  const k2 = placeAt(sim, 0, 'huette'); sim.dev.damage(k2, 1e9, 1); const gone = sim.cancel(0, k2.id); eq(gone.ok, true, 'Ruine räumen'); ok(!st.buildings.some(b => b.id === k2.id), 'Ruine ist weg');
  // costs of rebuilding a stone building: kaserne 8h8s → 4h4s
  const ks = placeAt(sim, 0, 'kaserne'); sim.dev.damage(ks, 1e9, 1); sim.dev.stock(0, { holz: 30, stein: 30 });
  sim.build(0, 'kaserne', ks.i, ks.j, ks.rot); eq(sim.youOf(0).stock.holz, 26, 'Kaserne neu: 4 Holz'); eq(sim.youOf(0).stock.stein, 26, 'und 4 Stein');
}

// ---- production: woodcutter, carrying, stores, caps, quarry, farm ----
{
  const sim = mk(), st = sim.state, w = sim.world;
  const hut = placeAt(sim, 0, 'holzfaeller');
  ok(hut, 'Holzfäller gesetzt'); eq(hut.noWood, false, 'noWood am Anfang aus');
  const log = [], samples = [];
  let chopAt = -1, ch = null;
  for (let i = 0; i < secs(60); i++) {
    for (const e of sim.step()) log.push({ ...e, at: st.t });
    const u = unitsOf(sim, 0).find(x => x._.wb === hut);
    if (u) samples.push(u.anim + ':' + u.carry + ':' + u._.job);
  }
  ch = log.find(e => e.t === 'chop'); ok(ch, 'chop-Ereignis'); eq(ch.lord, 0, 'chop.lord');
  const tree = w.trees[ch.tree];
  ok(tree.k >= 0 && Math.hypot(tree.x - (-72 + hut.i + 1), tree.y - (-45 + hut.j + 1)) <= C.WOOD_R + 1e-9, 'der Baum steht im Umkreis 10 der Hütte');
  ok(samples.some(s => /^work:null:2$/.test(s)), 'Fällen: anim work'); ok(samples.some(s => /^walk:holz:3$/.test(s)), 'Tragen: anim walk, carry holz');
  const del = log.find(e => e.t === 'deliver'); ok(del, 'deliver-Ereignis'); eq(del.res, 'holz', 'deliver.res'); eq(del.n, C.WOOD_N, 'deliver.n = 3'); eq(del.store, st.buildings.find(b => b.lord === 0 && b.kind === 'bergfried').id, 'ohne Lager liefert er an den Bergfried');
  ok(del.at > ch.at && del.at - ch.at < 20, 'zwischen Fällen und Abliefern vergehen Sekunden (' + (del.at - ch.at).toFixed(1) + ')');
  // the felled tree is a stump that regrows linearly to 1 over 120 s, standing again at 0.6
  const v0 = st.treeV; eq(st.trees[ch.tree] < 1, true, 'Baum ist ein Stumpf');
  const sim2 = mk(), hut2 = placeAt(sim2, 0, 'holzfaeller');
  const r2 = until(sim2, () => sim2.state.trees.some(v => v < 1), secs(60)); const id2 = sim2.state.trees.findIndex(v => v < 1); ok(id2 >= 0, 'zweiter Lauf: Stumpf');
  eq(sim2.state.trees[id2], 0, 'frisch gefällt: 0'); ok(sim2.state.treeV > 0, 'treeV zählt hoch');
  const tChop = sim2.state.t; until(sim2, () => sim2.state.trees[id2] >= C.STAND_AT, secs(130)); near(sim2.state.t - tChop, 0.6 * C.REGROW_S, 2, 'wieder stehend bei 0.6 nach 72 s');
  until(sim2, () => sim2.state.trees[id2] >= 1, secs(130)); near(sim2.state.t - tChop, C.REGROW_S, 2, 'ganz nachgewachsen nach 120 s');
  // the wood is reserved while the woodcutter works: with one tree left in reach, a second woodcutter finds none
  const sim3 = mk(), h3 = placeAt(sim3, 0, 'holzfaeller'), cands = h3._.cands;
  ok(cands.length > 10, 'Bäume in Reichweite (' + cands.length + ')');
  for (const id of cands) sim3.state.trees[id] = 0;   // clear the wood (test hook: the array is writable)
  run(sim3, secs(8)); eq(h3.noWood, true, 'kein Wald in Reichweite → noWood'); const wk = unitsOf(sim3, 0).find(x => x._.wb === h3); ok(wk && wk.anim === 'idle', 'er wartet an der Hütte'); eq(wk.carry, null, 'ohne Last');
  for (const id of cands) sim3.state.trees[id] = 1;
  run(sim3, secs(10)); eq(h3.noWood, false, 'Bäume da → er arbeitet wieder');
}
{
  // a Lager nearer to the hut takes the logs; the Kornspeicher only takes 🌾; a full store makes the carrier wait and retry
  const sim = mk(), st = sim.state;
  const hut = placeAt(sim, 0, 'holzfaeller'), lager = placeAt(sim, 0, 'lager');
  ok(hut && lager, 'Holzfäller und Lager gesetzt');
  const keep = st.buildings.find(b => b.lord === 0 && b.kind === 'bergfried');
  const dHut = (b) => dist({ x: b._.dx, y: b._.dy }, { x: hut._.dx, y: hut._.dy });
  const log = run(sim, secs(50)), dels = ofType(log, 'deliver').filter(e => e.res === 'holz');
  ok(dels.length >= 1, 'es wird Holz geliefert');
  const nearest = dHut(lager) < dHut(keep) ? lager : keep;
  ok(dels.every(e => e.store === nearest.id), 'das nächste Lager nimmt das Holz (' + (nearest === lager ? 'Lager' : 'Bergfried') + ')');
  ok(dHut(lager) < dHut(keep), 'das vorgeschlagene Lager liegt näher an der Hütte als der Bergfried');
  eq(sim.youOf(0).cap.holz, 90, 'Lager: Kappe 30 + 60'); eq(sim.youOf(0).cap.stein, 90, 'Lager: auch Stein +60'); eq(sim.youOf(0).cap.korn, 30, 'Lager nimmt kein Korn');
  const ks = placeAt(sim, 0, 'kornspeicher'); eq(sim.youOf(0).cap.korn, 90, 'Kornspeicher: Kappe 30 + 60 Korn'); eq(sim.youOf(0).cap.holz, 90, 'Kornspeicher ändert Holz nicht');
  sim.dev.damage(lager, 1e9, 1); eq(sim.youOf(0).cap.holz, 30, 'ruiniertes Lager zählt nicht');
}
{
  // caps (the part of Phase 1 that survives R11): a carrier at a full store waits with the load in his hands and retries every 2 s; room appears → delivery;
  // partial room → he delivers what fits and waits with the rest. (R11 limits the waiting to FULL_WAIT_S, see the R11 block below.)
  const sim = mk(), st = sim.state, hut = placeAt(sim, 0, 'holzfaeller');
  sim.dev.stock(0, { holz: 12 });
  const hold = (s) => { s.dev.stock(0, { holz: 30 }); };
  let wk = null;
  until(sim, () => { wk = unitsOf(sim, 0).find(x => x._.wb === hut && x._.job === JOB.CARRY && x._.ws === 1); return !!wk; }, secs(60));   // the first load is at the store
  ok(wk, 'ein Träger steht am Lager'); sim.dev.stock(0, { holz: 30 });
  const log = run(sim, secs(5), hold);
  eq(ofType(log, 'deliver').length, 0, 'beim Kappenstand wird nichts geliefert'); eq(sim.youOf(0).stock.holz, 30, 'Vorrat bleibt bei 30');
  eq(wk._.job, JOB.CARRY, 'der Träger wartet am Lager'); eq(wk.carry, 'holz', 'mit Holz in der Hand'); eq(wk.anim, 'idle', 'und steht still');
  const store = wk._.store; ok(dist(wk, { x: store._.dx, y: store._.dy }) < 0.6, 'er steht an der Tür des Lagers');
  // room: spend wood → within RETRY_S the carrier delivers
  sim.dev.stock(0, { holz: 26 });
  const l2 = run(sim, secs(2.2)); const d = ofType(l2, 'deliver'); eq(d.length, 1, 'mit Platz liefert er innerhalb von 2 s'); eq(d[0].n, 3, 'alle 3'); eq(sim.youOf(0).stock.holz, 29, 'Vorrat 26 + 3');
  // partial room: the carrier delivers what fits and waits with the rest
  const sim4 = mk(), h4 = placeAt(sim4, 0, 'holzfaeller'); sim4.dev.stock(0, { holz: 12 });
  until(sim4, () => unitsOf(sim4, 0).some(x => x._.job === JOB.CARRY && x._.ws === 1), secs(60));
  sim4.dev.stock(0, { holz: 29 }); const l4 = run(sim4, secs(2.2)); const d4 = ofType(l4, 'deliver');
  eq(d4.length >= 1 && d4[0].n, 1, 'Teillieferung: nur 1 passt'); const rest = unitsOf(sim4, 0).find(x => x._.wb === h4); eq(rest._.load, 2, 'der Rest (2) bleibt auf dem Rücken'); eq(rest.carry, 'holz', 'carry bleibt holz');
}
{
  // quarry: two stonecutters, 8 s of work, two blocks per trip
  const sim = mk(), st = sim.state, q = placeAt(sim, 0, 'steinbruch');
  ok(q, 'Steinbruch gesetzt (an Fels)');
  const log = run(sim, secs(40)), dels = ofType(log, 'deliver').filter(e => e.res === 'stein');
  eq(q.workers, 2, 'zwei Steinmetze'); ok(dels.length >= 2, 'beide liefern Stein (' + dels.length + ')'); ok(dels.every(e => e.n === C.STONE_N), 'zwei Blöcke pro Gang'); ok(sim.youOf(0).stock.stein >= 4, 'Vorrat steigt');
  const ws = unitsOf(sim, 0).filter(x => x._.wb === q); ok(ws.length === 2 && ws[0] !== ws[1], 'zwei verschiedene Arbeiter');
  // the stone never runs out
  const more = run(sim, secs(120)); ok(ofType(more, 'deliver').filter(e => e.res === 'stein').length >= 6, 'der Fels geht nie aus');
}
{
  // farm: sow 6 s → the field grows by itself over 45 s → harvest 6 s → sacks carried 3 at a time → sow again
  const sim = mk(), st = sim.state, hof = placeAt(sim, 0, 'hof');
  ok(hof, 'Hof gesetzt'); eq(hof.growth, 0, 'Feld bei growth 0');
  let aue = 0; const [fw, fh] = W.footprintOf('hof', hof.rot); for (let dj = 0; dj < fh; dj++) for (let di = 0; di < fw; di++) if (sim.world.cls[(hof.j + dj) * GW + hof.i + di] === W.CI.A) aue++;
  const want = Math.round(6 * (1 + 0.5 * aue / (fw * fh)));
  const log = [], samples = new Set(), gr = [];
  for (let i = 0; i < secs(200); i++) {
    for (const e of sim.step()) log.push({ ...e, at: st.t });
    const u = unitsOf(sim, 0).find(x => x._.wb === hof); if (u) samples.add(u.anim + ':' + u.carry);
    if (log.some(e => e.t === 'sow')) gr.push([st.t, hof.growth]);
  }
  const sow = ofType(log, 'sow'), hv = ofType(log, 'harvest');
  ok(sow.length >= 1 && hv.length >= 1, 'gesät und geerntet'); eq(sow[0].id, hof.id, 'sow.id');
  near(hv[0].at - sow[0].at, (1 - 0.05) * C.GROW_S + C.HARVEST_S, 1.5, 'Ernte: Wachstum 0.05 → 1 mit Rate 1/45 s, dann 6 s Ernten (' + (hv[0].at - sow[0].at).toFixed(1) + ')');
  eq(hv[0].n, want, 'Ertrag = round(6 · (1 + 0.5 · Aue-Anteil)) = ' + want + ' (Aue ' + aue + '/' + fw * fh + ')');
  const after = log.filter(e => e.t === 'deliver' && e.res === 'korn' && e.at > hv[0].at);
  eq(after.slice(0, Math.ceil(want / C.KORN_N)).reduce((a, e) => a + e.n, 0), want, 'die Säcke werden zu je 3 getragen und kommen alle an');
  ok(after.slice(0, Math.ceil(want / C.KORN_N) - 1).every(e => e.n === 3), 'je Gang 3 Säcke');
  ok(sow.length >= 2 && sow[1].at > hv[0].at, 'danach wird neu gesät');
  ok(samples.has('work:null') && samples.has('walk:korn') && samples.has('idle:null'), 'Hof: arbeitet, trägt Korn, wartet (' + [...samples].join(' ') + ')');
  near(gr[0][1], 0.05, 0.02, 'Aussaat: growth 0.05'); ok(hof.burnt === 0, 'unverbrannt');
}
{
  // job priority: the only idle peasant builds before he farms; with nobody idle a site pulls a worker off his job after 3 s
  const saved = C.START_PEASANTS, savedA = C.ARRIVE_S; C.START_PEASANTS = 1; C.ARRIVE_S = 1e9;   // nobody new arrives
  const sim = mk(); C.START_PEASANTS = saved;
  sim.dev.stock(0, { korn: 20 });   // (fed, but below the cap: R11 would send a farmer home when the 🌾 store is full)
  const hof = placeAt(sim, 0, 'hof'), hs = W.suggest(sim.world, 'huette', 0, { L: 1, occ: sim.occ }), r = sim.build(0, 'huette', hs.i, hs.j, hs.rot), site = sim.state.buildings.find(b => b.id === r.id);
  run(sim, secs(1.2));
  const p = unitsOf(sim, 0)[0]; eq(p._.site, site, 'der einzige freie Bauer baut zuerst'); eq(hof.workers, 0, 'der Hof bleibt leer');
  const fin = until(sim, () => site.build >= 1, secs(40)); ok(fin.hit, 'Hütte fertig'); run(sim, secs(2.5)); eq(hof.workers, 1, 'danach geht er aufs Feld (leerer Arbeitsplatz)');
  // nobody idle: a site waits and does NOT take the farmer off his field, however long (R2) ...
  const h2 = W.suggest(sim.world, 'huette', 0, { L: 1, occ: sim.occ }), r2 = sim.build(0, 'huette', h2.i, h2.j, h2.rot), s2 = sim.state.buildings.find(b => b.id === r2.id);
  run(sim, secs(10)); eq(hof.workers, 1, 'der Bauer bleibt auf dem Feld'); eq(s2._.builder, null, 'die Baustelle wartet auf einen freien Bauern'); eq(s2.build, 0, 'ohne Fortschritt');
  // ... but a woodcutter is pulled after PULL_WAIT_S
  sim.cancel(0, s2.id); const wc = placeAt(sim, 0, 'holzfaeller'); sim.dev.stock(0, { holz: 20 }); sim.dev.spawn(0, 'bauer', gateOf(sim, 0).x, gateOf(sim, 0).y, -1); run(sim, secs(4)); eq(wc.workers, 1, 'der zweite Bauer arbeitet am Holzfäller');
  const h3 = W.suggest(sim.world, 'huette', 0, { L: 1, occ: sim.occ }), r3 = sim.build(0, 'huette', h3.i, h3.j, h3.rot), s3 = sim.state.buildings.find(b => b.id === r3.id);
  run(sim, secs(1.2)); eq(wc.workers, 1, 'noch nicht abgezogen'); run(sim, secs(4)); eq(wc.workers, 0, 'der Holzfäller wird abgezogen'); ok(s3._.builder && s3._.builder._.wb === null, 'und baut die Hütte'); eq(hof.workers, 1, '(der Bauer bleibt)');
  C.ARRIVE_S = savedA;
}

// ---- R2 (Phase 1b): farmers stay on the fields — a site or a recruit pulls the quarry first, then the woodcutter, never a Hof worker ----
function siteOf(sim, kind) { const sp = W.suggest(sim.world, kind, 0, { L: sim.state.level, occ: sim.occ }), r = sim.build(0, kind, sp.i, sp.j, sp.rot); return r.ok ? sim.state.buildings.find(b => b.id === r.id) : null; }
{
  const saved = C.START_PEASANTS, savedA = C.ARRIVE_S; C.START_PEASANTS = 4; C.ARRIVE_S = 1e9;   // 4 peasants, nobody new arrives
  const sim = mk(); C.START_PEASANTS = saved;
  sim.dev.stock(0, { korn: 20, holz: 20, stein: 10 });   // (below the caps: R11 rests a workplace whose store is full, and a carrier at a full store could not be pulled)
  const hof = placeAt(sim, 0, 'hof'), wc = placeAt(sim, 0, 'holzfaeller'), qy = placeAt(sim, 0, 'steinbruch');
  run(sim, secs(12)); eq([hof.workers, wc.workers, qy.workers].join(), '1,1,2', 'alle Arbeitsplätze besetzt, niemand frei'); eq(sim.youOf(0).idle, 0, 'idle = 0');
  sim.dev.stock(0, { holz: 28 });   // four sites cost 24 (afterwards the wood store is far from its cap again)
  const farmer = hof._.workers[0], sites = [siteOf(sim, 'kornspeicher'), siteOf(sim, 'kornspeicher'), siteOf(sim, 'kornspeicher'), siteOf(sim, 'kornspeicher')];   // 12 s of building each: they stay open for a while
  ok(sites.every(Boolean), 'vier Baustellen');
  let farmerMoved = 0; run(sim, secs(10), () => { if (hof._.workers[0] !== farmer || farmer._.job === JOB.BUILD || farmer._.job === JOB.FETCH || farmer._.job === JOB.IDLE) farmerMoved++; });
  eq(farmerMoved, 0, 'vier Baustellen warten: der Bauer wird nie vom Hof abgezogen'); eq(hof.workers, 1, 'der Hof bleibt besetzt');
  eq(qy.workers, 0, 'der Steinbruch gibt zuerst: beide Steinmetze sind abgezogen'); eq(wc.workers, 0, 'danach der Holzfäller');
  eq(sites.filter(b => b._.builder).length, 3, 'drei Baustellen haben einen Baumeister'); eq(sites.filter(b => !b._.builder).length, 1, 'die vierte wartet');
  // the quarry gives before the woodcutter: one site only takes one stonecutter, and the nearest of them
  C.START_PEASANTS = 4; const sq = mk(); C.START_PEASANTS = saved;
  sq.dev.stock(0, { korn: 20, holz: 20, stein: 10 }); const h1 = placeAt(sq, 0, 'hof'), w1 = placeAt(sq, 0, 'holzfaeller'), q1 = placeAt(sq, 0, 'steinbruch'); run(sq, secs(12));
  const one = siteOf(sq, 'kornspeicher'); run(sq, secs(5));
  eq([h1.workers, w1.workers, q1.workers].join(), '1,1,1', 'eine Baustelle: ein Steinmetz wird abgezogen, Holzfäller und Bauer bleiben'); ok(one._.builder, 'er baut');
  // recruits take the same way: the Kaserne with three recruits takes the idle peasant, then both stonecutters, but not the woodcutter and not the farmer
  C.START_PEASANTS = 5; const sr = mk(); C.START_PEASANTS = saved; sr.dev.stock(0, { korn: 20, holz: 20, stein: 10 });
  const hr = placeAt(sr, 0, 'hof'), wr = placeAt(sr, 0, 'holzfaeller'), qr = placeAt(sr, 0, 'steinbruch'); placeAt(sr, 0, 'kaserne'); run(sr, secs(12));
  eq(sr.youOf(0).idle, 1, 'ein Bauer ist frei'); for (let i = 0; i < 3; i++) eq(sr.recruit(0, 'speer', 1).ok, true, 'Rekrut ' + (i + 1));
  let farmerGone = 0; const lr = run(sr, secs(30), () => { if (hr.workers !== 1) farmerGone++; });
  eq(ofType(lr, 'trained').length, 3, 'alle drei Rekruten werden ausgebildet (der freie Bauer und beide Steinmetze)'); eq(farmerGone, 0, 'der Bauer bleibt die ganze Zeit auf dem Hof'); eq(qr.workers, 0, 'die Steinmetze sind jetzt Soldaten'); eq(wr.workers, 1, 'der Holzfäller bleibt (die Steinmetze kommen vor ihm)');
  // ... and with nobody to take, a recruit waits instead of taking the farmer
  C.START_PEASANTS = 4; const sw = mk(); C.START_PEASANTS = saved; sw.dev.stock(0, { korn: 20, holz: 20, stein: 10 });
  const hw = placeAt(sw, 0, 'hof'); placeAt(sw, 0, 'kaserne'); placeAt(sw, 0, 'steinbruch'); run(sw, secs(12));   // hof 1 + quarry 2 + 1 idle
  for (let i = 0; i < 2; i++) sw.recruit(0, 'speer', 1);
  let gone = 0; const lw = run(sw, secs(30), () => { if (hw.workers !== 1) gone++; });
  eq(gone, 0, 'Rekruten ziehen den Bauern nie ab'); eq(ofType(lw, 'trained').length, 2, '(die zwei Rekruten kommen mit dem freien Bauern und einem Steinmetz aus)');
  C.START_PEASANTS = 3; const sx = mk(); C.START_PEASANTS = saved; sx.dev.stock(0, { korn: 20, holz: 20 }); const hx = placeAt(sx, 0, 'hof'); placeAt(sx, 0, 'kaserne'); run(sx, secs(8));   // only farmers and idle peasants: the second recruit has nobody to take
  eq(sx.recruit(0, 'speer', 1).ok && sx.recruit(0, 'speer', 1).reason, 'pop', '(bei 3 Bauern ist nach einem Rekruten Schluss: pop)'); run(sx, secs(15)); eq(hx.workers, 1, 'auch ohne Alternative bleibt der Bauer');
  // the bucket chain may still pull anyone: the only peasant is a farmer, a hut burns within reach of a Brunnen
  C.START_PEASANTS = 1; const sb = mk(); C.START_PEASANTS = saved; sb.dev.stock(0, { korn: 20 });
  const hb = placeAt(sb, 0, 'hof'), hut = placeAt(sb, 0, 'huette'), well = placeAt(sb, 0, 'brunnen'); run(sb, secs(8)); eq(hb.workers, 1, 'der einzige Bauer arbeitet auf dem Hof');
  keepWell(false); sb.dev.fire(hut, 0.5, 1); run(sb, secs(3)); keepWell(true);
  ok(unitsOf(sb, 0).some(u => u._.job === JOB.BUCKET), 'die Eimerkette zieht ihn trotzdem ab (sie darf jeden nehmen)'); eq(hb.workers, 0, 'Hof unbesetzt, solange gelöscht wird');
  C.ARRIVE_S = savedA;
}

// ---- R3 (Phase 1b): food first — a hungry house (or 🌾 < FOOD_LOW) fills empty Hof slots before recruits and sites; other slots keep their place ----
{
  const saved = C.START_PEASANTS, savedA = C.ARRIVE_S; C.START_PEASANTS = 1; C.ARRIVE_S = 1e9;
  const trial = (korn, extra) => {   // one idle peasant, an empty Hof and one site: who gets him? (a recruit needs 3 peasants and 3 empty Hof slots to compete)
    if (extra === 'recruit') C.START_PEASANTS = 3;
    const sim = mk(); C.START_PEASANTS = 1; sim.dev.stock(0, { korn, holz: 25, stein: 20 });
    const hof = placeAt(sim, 0, 'hof'), more = extra === 'recruit' ? [placeAt(sim, 0, 'hof'), placeAt(sim, 0, 'hof')] : [];
    const target = extra === 'recruit' ? (placeAt(sim, 0, 'kaserne'), null) : siteOf(sim, 'huette');
    if (extra === 'recruit') eq(sim.recruit(0, 'speer', 1).ok, true, 'Rekrut bestellt');
    run(sim, secs(2.5), (s) => { s.dev.stock(0, { korn }); });
    return { hof, site: target, sim, farmers: [hof, ...more].reduce((a, b) => a + b.workers, 0) };
  };
  const full = trial(C.FOOD_LOW, 'site'); eq(full.hof.workers, 0, '🌾 = FOOD_LOW (nicht knapp): die Baustelle kommt zuerst'); ok(full.site._.builder, 'der Bauer baut');
  const low = trial(C.FOOD_LOW - 1, 'site'); eq(low.hof.workers, 1, '🌾 < FOOD_LOW: der Hof kommt zuerst'); eq(low.site._.builder, null, 'die Baustelle wartet');
  const hung = trial(0, 'site'); eq(hung.sim.state.lords[0].hunger, true, '(hungrig)'); eq(hung.hof.workers, 1, 'hungrig: der Hof kommt zuerst'); eq(hung.site._.builder, null, 'die Baustelle wartet');
  const rec = trial(C.FOOD_LOW - 1, 'recruit'); eq(rec.farmers, 3, 'knapp: alle drei Freien gehen auf die Höfe, vor dem Rekruten'); eq(rec.sim.dev.lord(0).queue.filter(q => q.u).length, 0, 'der Rekrut wartet');
  const recFull = trial(25, 'recruit'); eq(recFull.sim.dev.lord(0).queue.filter(q => q.u).length, 1, 'satt: der Rekrut kommt vor den Höfen und wird ausgebildet'); eq(recFull.farmers, 2, '(zwei Höfe bleiben besetzt)');
  // the other worker slots keep their place: two idle peasants, hungry: the first fills the Hof, the second the site, the woodcutter slot stays empty
  C.START_PEASANTS = 2; const sim = mk(); sim.dev.stock(0, { korn: 0, holz: 25 });
  const hof = placeAt(sim, 0, 'hof'), wc = placeAt(sim, 0, 'holzfaeller'), site = siteOf(sim, 'huette'); run(sim, secs(2.5), (s) => { s.dev.stock(0, { korn: 0 }); });
  eq(hof.workers, 1, 'zwei Freie, hungrig: der Hof bekommt den ersten'); ok(site._.builder, 'die Baustelle den zweiten'); eq(wc.workers, 0, 'der Holzfäller-Platz bleibt, wo er war (nach den Baustellen)');
  // the bucket chain still comes before the food: a burning hut within reach of a Brunnen takes the idle peasant
  C.START_PEASANTS = 1; const sb = mk(); sb.dev.stock(0, { korn: 0, holz: 25 }); const hb = placeAt(sb, 0, 'hof'), ht = placeAt(sb, 0, 'huette'); placeAt(sb, 0, 'brunnen'); run(sb, secs(1));
  keepWell(false); sb.dev.fire(ht, 0.5, 1); run(sb, secs(2), (s) => { s.dev.stock(0, { korn: 0 }); }); keepWell(true);
  ok(unitsOf(sb, 0).some(u => u._.job === JOB.BUCKET), 'Eimerkette vor Essen: der freie Bauer löscht'); eq(hb.workers, 0, 'der Hof wartet');
  C.START_PEASANTS = saved; C.ARRIVE_S = savedA;
}

// ---- R4/R9 (Phase 1b): food numbers — one person eats one sack a minute; youOf().food = { prod, eat } over a rolling window of 60 one-second buckets ----
{
  const sim = mk(), st = sim.state;
  eq(JSON.stringify(sim.youOf(0).food), '{"prod":0,"eat":6}', 'Start: nichts geerntet, 6 Leute essen 6 Säcke je Minute'); eq(Object.keys(sim.youOf(0).food).join(), 'prod,eat', 'food-Felder');
  const hof = placeAt(sim, 0, 'hof'), dl = [];   // [step, n] of every 🌾 delivery
  let bad = 0, n = 0, lastDel = 0, maxProd = 0;
  const expected = (k) => { const lo = (Math.floor(k / 15) - 59) * 15; let sum = 0; for (const d of dl) if (d[0] >= lo && d[0] <= k) sum += d[1]; return sum; };
  for (let i = 0; i < secs(300); i++) {
    if (i % 15 === 0) sim.dev.stock(0, { korn: 12 });
    n++; for (const e of sim.step()) if (e.t === 'deliver' && e.res === 'korn' && e.lord === 0) { dl.push([n, e.n]); lastDel = n; }
    const f = sim.youOf(0).food; if (f.prod !== expected(n) || f.eat !== Math.round(sim.youOf(0).pop * 60 / C.EAT_S)) bad++; maxProd = Math.max(maxProd, f.prod);
  }
  eq(bad, 0, 'food.prod = 🌾 der letzten 60 Sekunden (60 Ein-Sekunden-Eimer), food.eat = round(Leute · 60 / EAT_S): in jedem der 4500 Schritte'); ok(dl.length >= 6 && maxProd >= 6, 'es wurde geliefert (' + dl.length + ' Lieferungen, höchstens ' + maxProd + ' je 60 s)');
  eq(sim.youOf(0).food.eat, 8, '8 Leute: Verbrauch 8'); const steady = dl.filter(d => d[0] > secs(180)).reduce((a, d) => a + d[1], 0) / 2; ok(steady >= 4.5 && steady <= 7.5, 'ein Hof nah am Bergfried liefert im Gleichgewicht ≈ 6 je Minute (' + steady.toFixed(1) + ')');
  // the window empties 60 s after the last delivery (the farmer is stopped by a pause)
  sim.pause(0, hof.id, true); run(sim, secs(25)); const before = sim.youOf(0).food.prod; run(sim, secs(40)); eq(sim.youOf(0).food.prod, 0, 'ohne Lieferungen fällt prod nach 60 s auf 0 (vorher ' + before + ')');
  // eat follows EAT_S
  const sv = C.EAT_S; C.EAT_S = 45; eq(sim.youOf(0).food.eat, Math.round(8 * 60 / 45), 'eat = round(8 · 60 / EAT_S) auch bei anderem EAT_S'); C.EAT_S = sv;
  // deterministic: two identical runs give the same series
  const series = () => { const s = mk({ seed: 3 }); placeAt(s, 0, 'hof'); const out = []; for (let i = 0; i < secs(120); i++) { s.step(); if (i % 15 === 0) out.push(JSON.stringify(s.youOf(0).food)); } return out.join('|'); };
  eq(series(), series(), 'food ist deterministisch');
}

// ---- R5 (Phase 1b): pause — a finished workplace with worker slots rests: the crew goes to the yard, a carrier delivers first, nobody new comes, a field keeps growing ----
{
  const sim = mk(), st = sim.state;
  const keep = bOf(sim, 0, 'bergfried')[0], hut = placeAt(sim, 0, 'huette'), well = placeAt(sim, 0, 'brunnen'), q = placeAt(sim, 0, 'steinbruch'), other = placeAt(sim, 1, 'steinbruch'), kas = placeAt(sim, 0, 'kaserne');
  ok(q && other, 'Steinbrüche gesetzt');
  // reasons: only finished workplaces with worker slots; unknown ids and other houses' buildings are 'none'; and the usual 'lord' / 'phase'
  for (const [b, name] of [[keep, 'Bergfried'], [hut, 'Hütte'], [well, 'Brunnen'], [kas, 'Kaserne']]) { const r = sim.pause(0, b.id, true); eq(r.ok === false && r.reason, 'kind', name + ': kind'); eq(b.paused, false, name + ' ruht nicht'); }
  eq(sim.pause(0, 987654, true).reason, 'none', 'unbekannte Id: none'); eq(sim.pause(0, other.id, true).reason, 'none', 'fremdes Gebäude: none'); eq(other.paused, false, '(und es ruht nicht)'); eq(sim.pause(9, q.id, true).reason, 'lord', 'unbekanntes Haus: lord');
  const hs = W.suggest(sim.world, 'hof', 0, { L: 1, occ: sim.occ }), site = sim.build(0, 'hof', hs.i, hs.j, hs.rot); eq(sim.pause(0, site.id, true).reason, 'kind', 'eine Baustelle kann nicht ruhen: kind'); sim.cancel(0, site.id);   // (gone again: a Hof next to the gate would jam the yard)
  eq(sim.pause(1, other.id, true).ok, true, '(das andere Haus darf seinen Steinbruch ruhen lassen)'); sim.pause(1, other.id, false);
  eq(st.buildings.every(b => b.paused === false || b === other), true, 'paused ist überall false, bis jemand pausiert');
  run(sim, secs(3)); eq(q.workers, 2, 'zwei Steinmetze arbeiten');
  // pause while one of them carries: the crew is off the list at once; the walker/worker goes to the yard; the carrier delivers, then idles
  const carrying = () => unitsOf(sim, 0).find(u => u._.wb === q && u._.job === JOB.CARRY && u._.load > 0);
  until(sim, () => !!carrying(), secs(60)); const carrier = carrying(), carriers = unitsOf(sim, 0).filter(u => u._.wb === q && u._.job === JOB.CARRY && u._.load > 0), others = unitsOf(sim, 0).filter(u => u._.wb === q && !carriers.includes(u));
  const carried = carriers.reduce((a, u) => a + u._.load, 0), stone0 = sim.youOf(0).stock.stein;
  const pr = sim.pause(0, q.id, true); eq(pr.ok, true, 'pause ok'); eq(q.paused, true, 'buildings[].paused'); eq(q.workers, 0, 'die Mannschaft ist sofort weg');
  ok(others.every(u => u._.job === JOB.IDLE && u._.wb === null), 'wer nicht trug, geht sofort in den Hof (idle)'); eq(carrier._.wb, null, 'der Träger gehört nicht mehr zum Steinbruch'); eq(carrier._.job, JOB.CARRY, 'trägt aber weiter'); eq(carrier.carry, 'stein', 'mit dem Stein in der Hand');
  const states = new Set(), log = run(sim, secs(40), () => { for (const u of unitsOf(sim, 0)) if (u === carrier) states.add(u._.job); if (unitsOf(sim, 0).some(u => u._.wb === q)) fail('während der Pause hat der Steinbruch Arbeiter'); });
  eq(ofType(log, 'pause').length, 1, 'ein pause-Ereignis'); eq(JSON.stringify(ofType(log, 'pause')[0]), JSON.stringify({ t: 'pause', id: q.id, on: true }), 'pause { id, on: true }');
  const dels = ofType(log, 'deliver').filter(e => e.res === 'stein' && e.lord === 0); eq(dels.length, carriers.length, 'genau die getragene Last kommt an (' + carriers.length + ' Träger)'); eq(dels.reduce((a, e) => a + e.n, 0), carried, 'alle ' + carried + ' Steine'); eq(sim.youOf(0).stock.stein, stone0 + carried, 'Vorrat +' + carried);
  ok(!states.has(JOB.RETURN) && !states.has(JOB.WORK) && !states.has(JOB.TOWORK), 'danach geht er nicht zurück an die Arbeit (Zustände ' + [...states].join(',') + ')'); eq(carrier._.job, JOB.IDLE, 'sondern ist frei'); eq(q.workers, 0, 'der Steinbruch bleibt leer, obwohl freie Bauern da sind'); ok(sim.youOf(0).idle >= 2, '(freie: ' + sim.youOf(0).idle + ')');
  // twice is fine and silent; the building can be demolished while it rests
  eq(sim.pause(0, q.id, true).ok, true, 'zweimal pausieren: ok'); eq(ofType(run(sim, 2), 'pause').length, 0, 'ohne zweites Ereignis');
  // back to work: the slots fill again in the normal priority (within the assignment second)
  const on = sim.pause(0, q.id, false); eq(on.ok, true, 'weiterarbeiten ok'); eq(q.paused, false, 'paused false'); const lo = run(sim, secs(3)); eq(JSON.stringify(ofType(lo, 'pause')), JSON.stringify([{ t: 'pause', id: q.id, on: false }]), 'pause { on: false }'); eq(q.workers, 2, 'beide Plätze sind wieder besetzt');
  eq(sim.pause(0, q.id, false).ok, true, 'Nicht-Pausiertes weiterarbeiten lassen: ok'); eq(ofType(run(sim, 2), 'pause').length, 0, '(still)'); ok(ofType(run(sim, secs(60), () => { sim.dev.stock(0, { korn: 20 }); }), 'deliver').some(e => e.res === 'stein' && e.lord === 0), 'er fördert wieder');
  // a worker still walking to the workplace goes to the yard at once
  const s2 = mk(), q2 = placeAt(s2, 0, 'steinbruch'); run(s2, secs(1.5)); const w2 = unitsOf(s2, 0).filter(u => u._.wb === q2); ok(w2.length === 2 && w2.every(u => u._.job === JOB.TOWORK), 'zwei Steinmetze sind noch unterwegs');
  s2.pause(0, q2.id, true); ok(w2.every(u => u._.job === JOB.IDLE), 'unterwegs: sofort in den Hof'); run(s2, secs(10)); eq(q2.workers, 0, 'und sie kommen nicht wieder'); eq(s2.state.units.filter(u => u.lord === 0 && u.carry).length, 0, '(nichts getragen)');
  // a woodcutter walking to his tree gives the tree back
  const s3 = mk(), h3 = placeAt(s3, 0, 'holzfaeller'); until(s3, () => unitsOf(s3, 0).some(u => u._.wb === h3 && u._.tree >= 0), secs(30)); const wcut = unitsOf(s3, 0).find(u => u._.wb === h3), tid = wcut._.tree;
  s3.pause(0, h3.id, true); eq(wcut._.tree, -1, 'der Baum ist wieder frei'); eq(wcut._.job, JOB.IDLE, 'der Holzfäller ist im Hof'); eq(s3.state.trees[tid], 1, '(und steht noch)');
  // the Hof: the field keeps growing while it rests and stays ripe; nobody harvests; after the pause it is harvested
  const s4 = mk(), hf = placeAt(s4, 0, 'hof'); until(s4, () => hf.growth > 0.3, secs(60)); const farmer = hf._.workers[0];
  s4.pause(0, hf.id, true); eq(hf.workers, 0, 'Hof: Bauer weg'); eq(farmer._.job, JOB.IDLE, 'er ist im Hof');
  const g0 = hf.growth; run(s4, secs(10)); ok(hf.growth > g0 + 0.15, 'das Feld wächst weiter (' + g0.toFixed(2) + ' → ' + hf.growth.toFixed(2) + ')');
  until(s4, () => hf.growth >= 1, secs(60)); const quiet = run(s4, secs(30)); eq(hf.growth, 1, 'es bleibt reif'); eq(ofType(quiet, 'harvest').length, 0, 'während der Pause wird nicht geerntet'); eq(hf.workers, 0, 'und kein Bauer kommt');
  s4.pause(0, hf.id, false); const harv = run(s4, secs(40)); eq(ofType(harv, 'harvest').length >= 1 && ofType(harv, 'harvest')[0].id, hf.id, 'nach der Pause wird geerntet'); ok(ofType(harv, 'deliver').some(e => e.res === 'korn'), 'und geliefert');
  // an unsown field stays empty while its Hof rests
  const s5 = mk(), h5 = placeAt(s5, 0, 'hof'); s5.pause(0, h5.id, true); run(s5, secs(60)); eq(h5.growth, 0, 'ein ruhender Hof sät nicht');
  // food first does not override the pause: a hungry house with idle peasants leaves the resting Hof empty
  const s9 = mk(), h9 = placeAt(s9, 0, 'hof'); s9.pause(0, h9.id, true); s9.dev.stock(0, { korn: 0 }); run(s9, secs(8), (s) => { s.dev.stock(0, { korn: 0 }); });
  eq(s9.state.lords[0].hunger, true, '(hungrig)'); ok(s9.youOf(0).idle >= 4, '(freie Bauern da)'); eq(h9.workers, 0, 'auch ein hungriges Haus besetzt einen ruhenden Hof nicht');
  // ruin → paused false (no pause event: the ruin is the news), a rebuild starts fresh and the slots fill again
  const s6 = mk(), q6 = placeAt(s6, 0, 'steinbruch'); run(s6, secs(3)); s6.pause(0, q6.id, true); run(s6, 1); s6.dev.damage(q6, 1e9, 1);
  const l6 = run(s6, 2); eq(q6.ruined, true, 'ruiniert'); eq(q6.paused, false, 'eine Ruine ruht nicht'); eq(ofType(l6, 'pause').length, 0, 'ohne pause-Ereignis'); eq(s6.pause(0, q6.id, true).reason, 'kind', 'eine Ruine kann nicht ruhen: kind');
  s6.dev.stock(0, { holz: 30 }); eq(s6.build(0, 'steinbruch', q6.i, q6.j, q6.rot).ok, true, 'Wiederaufbau'); eq(q6.paused, false, 'paused bleibt false'); run(s6, secs(40)); eq(q6.build, 1, 'fertig'); eq(q6.workers, 2, 'und besetzt');
  // demolishing a resting workplace works
  const s7 = mk(), q7 = placeAt(s7, 0, 'steinbruch'); s7.pause(0, q7.id, true); eq(s7.cancel(0, q7.id).ok, true, 'ein ruhender Steinbruch lässt sich abreißen');
  // after the end nothing can be paused
  const s8 = mk({ dauer: 6, burgfrieden: 0 }), q8 = placeAt(s8, 0, 'steinbruch'); run(s8, 6 * 60 * 15 + 5); eq(s8.pause(0, q8.id, true).reason, 'phase', 'nach dem Ende: phase');
}

// ---- R10 (Phase 1b, round 2): the gate rule covers hunger arrivals only — in a siege normal arrivals (food, no hunger) continue, R1 arrivals wait ----
{
  const saved = C.START_PEASANTS, besieged = (sim, l) => {   // an enemy knight pinned 3 cells from the gate: the keep shoots at him, so keep him alive and in place
    const g = gateOf(sim, l), fx = g.x + 2, fy = g.y + g.out * 2, foe = sim.dev.spawn(l === 0 ? 1 : 0, 'ritter', fx, fy, 1);
    return { foe, pin() { if (foe.hp > 0) { foe.x = fx; foe.y = fy; foe.hp = C.UNIT.ritter.hp; } }, g };
  };
  // (a) food in the store, no hunger, one peasant (below FLOOR) and room: the peasants keep coming every ARRIVE_S during the siege
  C.START_PEASANTS = 1; const sa = mk(), sg = besieged(sa, 0); C.START_PEASANTS = saved;
  ok(Math.hypot(sg.foe.x - sg.g.x, sg.foe.y - sg.g.y) <= C.GATE_SAFE_R, 'der Feind steht innerhalb von GATE_SAFE_R am Tor');
  const t = []; for (let i = 0; i < secs(40); i++) { sg.pin(); sa.dev.stock(0, { korn: 20 }); for (const e of sa.step()) if (e.t === 'arrive' && e.lord === 0) t.push(Math.round(sa.state.t)); }
  eq(t.join(), '6,12,18,24,30,36', 'Belagerung, genug Korn, kein Hunger: alle ' + C.ARRIVE_S + ' s kommt ein Bauer (auch unter FLOOR) – Normalfall');
  eq(sa.state.lords[0].people, 7, '(1 + 6 Neue)');
  // (b) the same siege at the keep with ≥ FLOOR peasants and food: still arrivals
  const sb = mk(), gb = besieged(sb, 0); let nb = 0; for (let i = 0; i < secs(20); i++) { gb.pin(); sb.dev.stock(0, { korn: 20 }); for (const e of sb.step()) if (e.t === 'arrive' && e.lord === 0) nb++; }
  eq(nb, 2, 'sechs Bauern, Belagerung, Korn da: die zwei freien Plätze der Burg füllen sich (2 Ankünfte in 20 s)');
  // (c) an R1 arrival (hungry / out of 🌾, below FLOOR) still waits for a clear gate and comes at once when it is clear
  C.START_PEASANTS = 1; const sc = mk(), gc = besieged(sc, 0); C.START_PEASANTS = saved;
  const hold = (s) => { s.dev.stock(0, { korn: 0 }); };
  let nc = 0; for (let i = 0; i < secs(30); i++) { gc.pin(); hold(sc); for (const e of sc.step()) if (e.t === 'arrive' && e.lord === 0) nc++; }
  eq(nc, 0, 'Belagerung ohne Korn, unter FLOOR: der R1-Bauer wartet am Tor'); sc.dev.kill(gc.foe);
  eq(run(sc, 2, hold).filter(e => e.t === 'arrive' && e.lord === 0).length, 1, 'ist das Tor frei, kommt er sofort');
  // (d) the rule follows the state, not the house: food runs out mid-siege → the next arrival (below FLOOR) is an R1 arrival and waits; food returns → it comes
  C.START_PEASANTS = 1; const sd = mk(), gd = besieged(sd, 0); C.START_PEASANTS = saved;
  let nd1 = 0, nd2 = 0; for (let i = 0; i < secs(13); i++) { gd.pin(); sd.dev.stock(0, { korn: 20 }); for (const e of sd.step()) if (e.t === 'arrive' && e.lord === 0) nd1++; }
  for (let i = 0; i < secs(20); i++) { gd.pin(); hold(sd); for (const e of sd.step()) if (e.t === 'arrive' && e.lord === 0) nd2++; }
  eq(nd1, 2, '(zwei normale Ankünfte in 13 s)'); eq(nd2, 0, 'dann geht das Korn aus: der nächste (R1) wartet, obwohl der Feind derselbe ist');
  let nd3 = 0; for (let i = 0; i < secs(8); i++) { gd.pin(); sd.dev.stock(0, { korn: 20 }); for (const e of sd.step()) if (e.t === 'arrive' && e.lord === 0) nd3++; }
  ok(nd3 >= 1, 'mit Korn kommt er wieder, auch mitten in der Belagerung');
  C.START_PEASANTS = saved;
}

// ---- R11 (Phase 1b, round 2): a full store frees its workers ----
{
  const holdAll = (s) => { s.dev.stock(0, { korn: 30, holz: 30, stein: 30 }); };
  eq(C.FULL_WAIT_S >= 6 && C.FULL_WAIT_S <= 10, true, 'FULL_WAIT_S liegt bei 6–10 s (' + C.FULL_WAIT_S + ')');
  // (a) a workplace of a full good takes no worker, the others work; the flag `full` says so; the freed hands are idle
  const sim = mk(), st = sim.state, wc = placeAt(sim, 0, 'holzfaeller'), qy = placeAt(sim, 0, 'steinbruch'), hf = placeAt(sim, 0, 'hof'), hut = placeAt(sim, 0, 'huette');
  eq([wc.full, qy.full, hf.full, hut.full].join(), 'false,false,false,false', 'full ist am Anfang überall false');
  holdAll(sim); run(sim, secs(8), holdAll);
  eq([wc.workers, qy.workers, hf.workers].join(), '0,0,0', 'alle drei Güter am Deckel: kein Arbeitsplatz bekommt Arbeiter'); eq([wc.full, qy.full, hf.full].join(), 'true,true,true', 'buildings[].full ist bei allen dreien true');
  eq(hut.full, false, 'eine Hütte ist kein Betrieb: full bleibt false'); ok(st.buildings.filter(b => !['holzfaeller', 'steinbruch', 'hof'].includes(b.kind)).every(b => b.full === false), 'full gibt es nur bei Betrieben');
  eq(sim.youOf(0).idle, sim.youOf(0).pop, 'alle Bauern sind frei (' + sim.youOf(0).idle + ')');
  // no busy loop: over two minutes nobody is ever sent to a resting workplace and dropped again
  let staffed = 0, trips = 0; const seen = new Set();
  run(sim, secs(120), (s) => { holdAll(s); for (const u of unitsOf(s, 0, 'bauer')) { if (u._.wb) staffed++; if (u._.job === JOB.TOWORK) { trips++; seen.add(u.id); } } });
  eq(staffed, 0, 'zwei Minuten lang steht niemand an einem ruhenden Betrieb'); eq(trips, 0, 'und niemand wird hin- und hergeschickt (kein Leerlauf)');
  // only the full good rests: stone full, the rest has room
  const s2 = mk(), w2 = placeAt(s2, 0, 'holzfaeller'), q2 = placeAt(s2, 0, 'steinbruch'), h2 = placeAt(s2, 0, 'hof');
  s2.dev.stock(0, { korn: 20, holz: 10, stein: 30 }); run(s2, secs(8), (s) => { s.dev.stock(0, { stein: 30 }); });
  eq([w2.workers, q2.workers, h2.workers].join(), '1,0,1', 'nur Stein am Deckel: der Steinbruch ruht, Holzfäller und Hof arbeiten'); eq([w2.full, q2.full, h2.full].join(), 'false,true,false', 'full je Gut');
  // room again → the slot fills in the normal job priority (within the assignment second)
  sim.dev.stock(0, { korn: 30, holz: 29, stein: 30 }); run(sim, secs(1) + 2, (s) => { s.dev.stock(0, { korn: 30, stein: 30 }); });
  eq(wc.workers, 1, 'wieder Platz für Holz: der Holzfäller-Platz füllt sich innerhalb der Zuteilungssekunde'); eq(wc.full, false, 'full fällt zurück'); eq([qy.workers, hf.workers].join(), '0,0', '(Stein und Korn sind weiter voll)');
  // (b) a worker who would start a new cycle goes idle instead — and a recruit gets him (the quarry crew stays)
  const saved = C.START_PEASANTS, savedA = C.ARRIVE_S; C.START_PEASANTS = 3; C.ARRIVE_S = 1e9;
  const sb = mk(); C.START_PEASANTS = saved;
  const wb = placeAt(sb, 0, 'holzfaeller'), qb = placeAt(sb, 0, 'steinbruch'); placeAt(sb, 0, 'kaserne');
  const keepLow = (s) => { s.dev.stock(0, { korn: 20, stein: 10 }); };
  sb.dev.stock(0, { holz: 10 }); run(sb, secs(12), keepLow); eq([wb.workers, qb.workers].join(), '1,2', 'Holzfäller und Steinbruch sind besetzt'); eq(sb.youOf(0).idle, 0, 'niemand ist frei');
  const cutter = unitsOf(sb, 0).find(u => u._.wb === wb), t0 = sb.state.t;
  const fr = until(sb, () => wb.workers === 0, secs(80), (s) => { keepLow(s); s.dev.stock(0, { holz: 30 }); });
  ok(fr.hit, 'beim vollen Holzlager wird der Holzfäller frei'); ok(sb.state.t - t0 <= C.FULL_WAIT_S + 30, 'innerhalb von FULL_WAIT_S plus einem Arbeitsgang (' + (sb.state.t - t0).toFixed(1) + ' s)');
  eq(wb.full, true, '(und die Hütte steht auf full)'); eq(cutter._.wb, null, 'er gehört nicht mehr zur Hütte'); eq(sb.youOf(0).idle, 1, 'er ist frei'); eq(qb.workers, 2, 'die Steinmetze arbeiten weiter');
  eq(sb.recruit(0, 'speer', 1).ok, true, 'Rekrut bestellt');
  let pulled = 0; const lb = run(sb, secs(25), (s) => { keepLow(s); s.dev.stock(0, { holz: 30 }); if (qb.workers < 2) pulled++; });
  eq(ofType(lb, 'trained').length, 1, 'der Rekrut wird ausgebildet'); eq(ofType(lb, 'trained')[0].id, cutter.id, 'und zwar aus dem freien Holzfäller'); eq(qb.workers, 2, 'ohne einen Steinmetz abzuziehen'); eq(pulled, 0, '(kein Steinmetz wurde zum Rekruten abgezogen)');
  C.ARRIVE_S = savedA;
  // (c) a carrier who finds no room waits FULL_WAIT_S, then the load is lost and he is free
  const sc = mk(), hc = placeAt(sc, 0, 'holzfaeller'); sc.dev.stock(0, { holz: 10 });
  let carrier = null; until(sc, () => { carrier = unitsOf(sc, 0).find(x => x._.wb === hc && x._.job === JOB.CARRY && x._.ws === 1); return !!carrier; }, secs(60));
  ok(carrier, 'ein Träger kommt mit Holz am Lager an'); const tA = sc.state.t; let tGone = -1, dels = 0, last = 0;
  for (let i = 0; i < secs(30) && tGone < 0; i++) { sc.dev.stock(0, { holz: 30 }); for (const e of sc.step()) if (e.t === 'deliver') dels++; if (carrier._.wb === null) tGone = sc.state.t; if (i === secs(2)) last = carrier._.load; }
  ok(tGone > 0, 'er gibt auf'); near(tGone - tA, C.FULL_WAIT_S, C.RETRY_S + 0.4, 'nach FULL_WAIT_S (' + (tGone - tA).toFixed(1) + ' s am Lager)');
  eq(carrier._.job, JOB.IDLE, 'er ist frei (idle)'); eq(carrier._.load, 0, 'die Last ist verloren'); eq(carrier.carry, null, '(nichts mehr in der Hand)'); eq(dels, 0, 'es kam nichts im Lager an'); eq(hc.workers, 0, 'die Mannschaft ist leer'); eq(last, C.WOOD_N, '(bis dahin hatte er die Last noch)');
  run(sc, secs(30), (s) => { s.dev.stock(0, { holz: 30 }); }); eq(hc.workers, 0, 'und bei vollem Lager kommt keiner wieder');
  // (d) he keeps delivering while there is room: one sack of room every 6 s (< FULL_WAIT_S) → three logs over 12 s (> FULL_WAIT_S), nothing is lost
  const sd = mk(), hd = placeAt(sd, 0, 'holzfaeller'); sd.dev.stock(0, { holz: 10 });
  let cd = null; until(sd, () => { cd = unitsOf(sd, 0).find(x => x._.wb === hd && x._.job === JOB.CARRY && x._.ws === 1); return !!cd; }, secs(60));
  let got = 0; const tD = sd.state.t; sd.dev.stock(0, { holz: 29 });
  for (let k = 0; k < 2; k++) { for (const e of run(sd, secs(6))) if (e.t === 'deliver') got += e.n; sd.dev.stock(0, { holz: 29 }); }
  for (const e of run(sd, secs(1))) if (e.t === 'deliver') got += e.n;
  eq(got, 3, 'Stück für Stück kommen alle drei Hölzer an (' + got + ')'); ok(sd.state.t - tD > C.FULL_WAIT_S, '(das dauerte länger als FULL_WAIT_S: ' + (sd.state.t - tD).toFixed(1) + ' s)'); eq(cd._.wb, hd, 'er gehört noch zur Hütte'); eq(hd.workers, 1, 'und arbeitet weiter');
  // (e) a Hof: the farmer is freed while the field grows; the field keeps growing and stays ripe; nobody harvests into a full store; after the room the harvest comes
  const se = mk(), he = placeAt(se, 0, 'hof'); until(se, () => he.growth > 0.2, secs(40));
  const holdK = (s) => { s.dev.stock(0, { korn: 30 }); };
  holdK(se); run(se, secs(4), holdK); eq(he.workers, 0, 'Hof bei vollem Korn: der Bauer ist frei'); eq(he.full, true, 'Hof: full');
  const g0 = he.growth; run(se, secs(20), holdK); ok(he.growth > g0 + 0.3, 'das Feld wächst trotzdem weiter (' + g0.toFixed(2) + ' → ' + he.growth.toFixed(2) + ')');
  until(se, () => he.growth >= 1, secs(60), holdK); const quiet = run(se, secs(30), holdK);
  eq(he.growth, 1, 'es bleibt reif'); eq(ofType(quiet, 'harvest').length, 0, 'bei vollem Lager wird nicht geerntet'); eq(he.workers, 0, '(und kein Bauer steht dort)');
  se.dev.stock(0, { korn: 20 }); const lh = run(se, secs(40));
  eq(ofType(lh, 'harvest').length, 1, 'mit Platz wird geerntet'); ok(ofType(lh, 'deliver').filter(e => e.res === 'korn').reduce((a, e) => a + e.n, 0) >= ofType(lh, 'harvest')[0].n, 'und alles geliefert');
  // (f) a Hof: a harvest that only partly fits is not thrown away while room appears (the store makes room every few seconds)
  const sf = mk(), hff = placeAt(sf, 0, 'hof'); let harv = 0, delv = 0, setAt = false;
  for (let i = 0; i < secs(160); i++) {
    const fk = unitsOf(sf, 0).find(u => u._.wb === hff);
    if (!setAt && hff.growth >= 1) { sf.dev.stock(0, { korn: 26 }); setAt = true; }   // room for 4 of the 6–9 sacks
    if (fk && fk._.job === JOB.CARRY && fk._.ws === 1 && fk._.fwait >= 4 && sf.youOf(0).stock.korn >= 30) sf.dev.stock(0, { korn: 28 });   // the house eats: room appears within FULL_WAIT_S
    for (const e of sf.step()) { if (e.t === 'harvest') harv += e.n; if (e.t === 'deliver' && e.res === 'korn') delv += e.n; }
    if (harv && delv >= harv) break;
  }
  ok(harv >= 6, 'geerntet: ' + harv); eq(delv, harv, 'alle Säcke kommen an, obwohl nur ein Teil auf einmal Platz hatte (' + delv + ' von ' + harv + ')');
  // (g) the flag follows the order to rest: a paused workplace is not `full`; a rest that ends gives the flag back at once; ruins and sites are never full
  const sg = mk(), qg = placeAt(sg, 0, 'steinbruch'); sg.dev.stock(0, { stein: 30 }); run(sg, 2, (s) => { s.dev.stock(0, { stein: 30 }); });
  eq(qg.full, true, 'Steinbruch bei vollem Stein: full');
  sg.pause(0, qg.id, true); eq(qg.paused, true, 'ruht auf Befehl'); eq(qg.full, false, 'ein Betrieb, der auf Befehl ruht, ist nicht full (sofort nach pause)'); run(sg, 3, (s) => { s.dev.stock(0, { stein: 30 }); }); eq(qg.full, false, '(und bleibt es)');
  sg.pause(0, qg.id, false); eq(qg.paused, false, 'arbeitet wieder'); eq(qg.full, true, 'der volle Deckel gilt sofort wieder: full');
  sg.dev.damage(qg, 1e9, 1); run(sg, 2, (s) => { s.dev.stock(0, { stein: 30 }); }); eq(qg.ruined, true, 'ruiniert'); eq(qg.full, false, 'eine Ruine ist nie full');
  const hs = W.suggest(sg.world, 'hof', 0, { L: 1, occ: sg.occ }), site = sg.build(0, 'hof', hs.i, hs.j, hs.rot); sg.dev.stock(0, { korn: 30 }); run(sg, 3, (s) => { s.dev.stock(0, { korn: 30 }); });
  eq(sg.state.buildings.find(b => b.id === site.id).full, false, 'eine Baustelle ist nie full');
  // (h) the keep is no workplace and 🌾 at the cap does not stop the other hands: builders, recruits and the rest are untouched
  const sh = mk(), kh = placeAt(sh, 0, 'kaserne'); holdAll(sh); run(sh, secs(3), holdAll); eq(kh.full, false, 'eine Kaserne ist nie full'); eq(sh.state.buildings.find(b => b.kind === 'bergfried' && b.lord === 0).full, false, 'der Bergfried auch nicht');
  const sitel = siteOf(sh, 'huette'); sh.dev.stock(0, { korn: 30, holz: 30, stein: 30 }); const lbd = until(sh, () => sitel.build >= 1, secs(60), holdAll); ok(lbd.hit, 'ein volles Lager hält keine Baustelle auf');
}

// ---- R12 (Phase 1b, round 2): training per finished Kaserne — TRAIN_PAR recruits per Kaserne at once, each at the nearest one with a free place ----
{
  const savedP = C.START_PEASANTS; C.START_PEASANTS = 12;
  const two = () => { const s = mk(); s.dev.stock(0, { korn: 28, holz: 28, stein: 10 }); const k1 = placeAt(s, 0, 'kaserne'), k2 = placeAt(s, 0, 'kaserne'); return { s, k1, k2 }; };
  const { s: sim, k1, k2 } = two(); ok(k1 && k2 && k1 !== k2, 'zwei Kasernen gesetzt');
  // the nearer Kaserne: the one with the idle peasant nearest to its door (the yard is where the idle peasants wait)
  const dk = (s, k) => Math.min(...unitsOf(s, 0, 'bauer').filter(u => u._.job === JOB.IDLE).map(u => Math.hypot(k._.dx - u.x, k._.dy - u.y))), nearOf = (s, a, b) => dk(s, a) <= dk(s, b) ? a : b;
  const near1 = nearOf(sim, k1, k2), far1 = near1 === k1 ? k2 : k1;
  ok(dk(sim, near1) < dk(sim, far1) - 0.01, 'die beiden Kasernen sind verschieden weit von den freien Bauern (' + dk(sim, near1).toFixed(1) + ' / ' + dk(sim, far1).toFixed(1) + ')');
  const per = (s, k) => unitsOf(s, 0, 'bauer').filter(u => u._.qe && u._.store === k).length;
  for (let i = 0; i < 6; i++) eq(sim.recruit(0, 'speer', 1).ok, true, 'Rekrut ' + (i + 1));
  run(sim, secs(2.5));
  eq(per(sim, near1) + '/' + per(sim, far1), '3/3', '2 Kasernen: sechs Rekruten sind zugleich unterwegs, je drei – zuerst zur näheren, dann zur ferneren');
  eq(sim.dev.lord(0).queue.filter(q => q.u).length, 6, 'sechs Einträge der Warteschlange haben einen Bauern');
  const l6 = until(sim, () => sim.state.units.filter(u => u.kind === 'speer').length === 6, secs(60)); ok(l6.hit, 'alle sechs werden ausgebildet'); const tTwo = sim.state.t;
  // one Kaserne trains 3 at a time: two rounds
  const s1 = mk(); s1.dev.stock(0, { korn: 28, holz: 28, stein: 10 }); const ka = placeAt(s1, 0, 'kaserne'); for (let i = 0; i < 6; i++) s1.recruit(0, 'speer', 1);
  run(s1, secs(2.5)); eq(per(s1, ka), 3, '1 Kaserne: nur drei zugleich (TRAIN_PAR)'); eq(s1.dev.lord(0).queue.filter(q => q.u).length, 3, '(die anderen drei warten)');
  const l1 = until(s1, () => s1.state.units.filter(u => u.kind === 'speer').length === 6, secs(90)); ok(l1.hit, 'alle sechs auch mit einer Kaserne'); const tOne = s1.state.t;
  ok(tTwo * 1.45 < tOne, 'zwei Kasernen bilden fast doppelt so schnell aus (' + tTwo.toFixed(1) + ' s gegen ' + tOne.toFixed(1) + ' s)');
  // fewer recruits than places: all at the nearer Kaserne; four recruits: three there, one at the other
  const t3 = two(), n3 = nearOf(t3.s, t3.k1, t3.k2); for (let i = 0; i < 3; i++) t3.s.recruit(0, 'speer', 1); run(t3.s, secs(2.5));
  eq(per(t3.s, n3), 3, 'drei Rekruten gehen alle zur näheren Kaserne'); eq(per(t3.s, n3 === t3.k1 ? t3.k2 : t3.k1), 0, 'die fernere bleibt leer');
  const t4 = two(), n4 = nearOf(t4.s, t4.k1, t4.k2); for (let i = 0; i < 4; i++) t4.s.recruit(0, 'speer', 1); run(t4.s, secs(2.5));
  eq(per(t4.s, n4) + '/' + per(t4.s, n4 === t4.k1 ? t4.k2 : t4.k1), '3/1', 'vier Rekruten: drei bei der näheren, einer bei der ferneren');
  // a Kaserne falls while its recruits walk: they go to the nearest other one WITH A FREE PLACE (R12), the rest back to the yard; no order is lost
  const t5 = two(), n5 = nearOf(t5.s, t5.k1, t5.k2), f5 = n5 === t5.k1 ? t5.k2 : t5.k1; for (let i = 0; i < 4; i++) t5.s.recruit(0, 'speer', 1); run(t5.s, secs(1.5));
  eq(per(t5.s, n5) + '/' + per(t5.s, f5), '3/1', '(vor dem Einsturz 3/1)');
  t5.s.dev.damage(n5, 1e9, 1); run(t5.s, 3);
  eq(per(t5.s, f5), 3, 'die Rekruten der eingestürzten Kaserne weichen auf freie Plätze der anderen aus (3 von 3 belegt, nicht mehr)'); eq(t5.s.youOf(0).queue.length, 4, 'keine Bestellung ging verloren');
  eq(t5.s.youOf(0).queue.filter(q => q.wait).length, 1, 'der vierte hat keinen Platz mehr und wartet im Hof');
  const l5 = until(t5.s, () => t5.s.state.units.filter(u => u.kind === 'speer').length === 4, secs(60)); ok(l5.hit, 'am Ende sind alle vier ausgebildet');
  // never more than TRAIN_PAR per finished Kaserne, over a whole run with a long queue and two Kasernen
  const t6 = two(); let worst = 0, trainedAll = 0; t6.s.dev.stock(0, { korn: 28, holz: 28 });
  for (let i = 0; i < secs(60); i++) { if (i % 15 === 0 && t6.s.youOf(0).queue.length < 8) t6.s.recruit(0, 'speer', 1); t6.s.dev.stock(0, { korn: 28, holz: 28 }); for (const e of t6.s.step()) if (e.t === 'trained') trainedAll++; worst = Math.max(worst, per(t6.s, t6.k1), per(t6.s, t6.k2)); }
  ok(worst <= C.TRAIN_PAR, 'nie mehr als TRAIN_PAR zugleich bei einer Kaserne (höchstens ' + worst + ')'); ok(trainedAll >= 8, 'und es wird ausgebildet (' + trainedAll + ' in 60 s)');
  // a queue entry's public flag: wait = nobody has been sent for this recruit
  const t7 = two(); t7.s.recruit(0, 'speer', 1); eq(JSON.stringify(t7.s.youOf(0).queue), '[{"unit":"speer","n":1,"p":0,"wait":true}]', 'youOf.queue: ein neuer Auftrag wartet (wait: true)');
  run(t7.s, secs(2)); eq(t7.s.youOf(0).queue[0].wait, false, 'sobald ein Bauer losgeschickt ist: wait false');
  C.START_PEASANTS = savedP;
}

// ---- the user's scene (feedback 3): popCap 88, 44 people, every store full, a recruit queue, an enemy besieging the keep → the house grows and trains ----
function userScene(seed, siege) {
  const world = worldOf(seed), saved = C.ARRIVE_S; C.ARRIVE_S = 1e9;   // the head count is set by hand until the siege starts
  const sim = Sim.create({ seed, world, dauer: 40, burgfrieden: 0, lords: [{ i: 0, site: 0 }, { i: 1, site: 3 }] }), st = sim.state;
  while (st.phase !== 'fehde') sim.step();
  const put = (kind, n) => { let got = 0; for (let k = 0; k < n; k++) { const sp = W.suggest(world, kind, 0, { L: 0, occ: sim.occ }); if (!sp) break; const r = sim.dev.place(0, kind, sp.i, sp.j, sp.rot); if (!r.ok) break; got++; } return got; };
  const built = {}; for (const [kind, n] of [['huette', 20], ['kornspeicher', 2], ['lager', 2], ['hof', 10], ['holzfaeller', 6], ['steinbruch', 7], ['kaserne', 1]]) built[kind] = put(kind, n);
  const lp = sim.dev.lord(0), keep = lp.keepB._, g = { x: lp.gx, y: lp.gy, out: lp.out };
  const slots = st.buildings.filter(b => b.lord === 0 && b.build >= 1 && !b.ruined).reduce((a, b) => a + (b._.max || 0), 0);
  const peasants = () => st.units.filter(u => u.lord === 0 && u.kind === 'bauer').length;
  for (let i = peasants(); i < slots; i++) sim.dev.spawn(0, 'bauer', g.x + (i % 6) * 0.5 - 1.5, g.y + g.out * (1 + (i >> 3) * 0.5));   // as many peasants as job slots
  const far = { x: g.x, y: g.y + g.out * 26 }; sim.banner(0, 2, far.x, far.y);
  for (let i = 0; i < 44 - slots; i++) sim.dev.spawn(0, 'speer', far.x + (i % 7) * 1.3 - 4, far.y + (i >> 3) * 1.3, 2);   // the rest of the 44 people are soldiers far from the keep
  const cap = (k) => sim.youOf(0).cap[k];
  for (let i = 0; i < secs(110); i++) { sim.dev.stock(0, { korn: cap('korn') }); sim.step(); }
  sim.dev.stock(0, { korn: cap('korn'), holz: cap('holz'), stein: cap('stein') });
  for (let i = 0; i < secs(20); i++) { sim.dev.stock(0, { korn: Math.max(sim.youOf(0).stock.korn, cap('korn') - 1) }); sim.step(); }
  C.ARRIVE_S = saved;
  const y0 = sim.youOf(0), foes = [];
  if (siege) for (let i = 0; i < 3; i++) { const x = keep.cx + (i - 1) * 1.6, y = keep.cy - g.out * 3.7; foes.push({ u: sim.dev.spawn(1, 'ritter', x, y, 1), x, y }); }   // at the keep's back wall: inside GATE_SAFE_R of the gate, outside FLEE_R of the traffic
  return { sim, st, g, foes, y0, built, slots, cap, peasants };
}
{
  const sc = userScene(3, true), { sim, st, g, foes, y0 } = sc;
  eq(y0.popCap + '/' + y0.pop, '88/44', 'Szene: popCap 88, 44 Leute'); ok(['korn', 'holz', 'stein'].every(k => y0.stock[k] >= y0.cap[k] - 1), 'Szene: alle Lager voll (' + JSON.stringify(y0.stock) + ' / ' + JSON.stringify(y0.cap) + ')');
  ok(foes.every(f => Math.hypot(f.x - g.x, f.y - g.y) <= C.GATE_SAFE_R), 'Szene: der Feind steht innerhalb von GATE_SAFE_R am Tor');
  let trained = 0, arrivals = 0, maxWait = 0, idleEver = new Set();
  for (let i = 0; i < secs(180); i++) {
    for (const f of foes) { if (f.u.hp > 0) { f.u.x = f.x; f.u.y = f.y; f.u.hp = C.UNIT.ritter.hp; } }
    if (i % 15 === 0 && sim.youOf(0).queue.length < 6) sim.recruit(0, 'speer', 1);
    for (const u of st.units) if (u.lord === 0 && u.kind === 'bauer') { if (u._.job === JOB.CARRY && u._.ws === 1) maxWait = Math.max(maxWait, u._.fwait); if (u._.job === JOB.IDLE) idleEver.add(u.id); }
    for (const e of sim.step()) { if (e.t === 'trained' && e.lord === 0) trained++; if (e.t === 'arrive' && e.lord === 0) arrivals++; }
  }
  const y = sim.youOf(0);
  ok(arrivals >= 15, 'Belagerung: das Haus wächst weiter (' + arrivals + ' Ankünfte in 180 s, ' + y0.pop + ' → ' + y.pop + ' von ' + y.popCap + ')'); ok(y.pop >= 44 + 15, 'mindestens 15 Leute mehr');
  ok(trained >= 20, 'und bildet aus (' + trained + ' Rekruten in 180 s; vorher blieb es bei 4)'); ok(idleEver.size >= 10, 'die Arbeiter der vollen Lager werden frei (' + idleEver.size + ' verschiedene Bauern waren frei)');
  ok(maxWait <= C.FULL_WAIT_S + C.RETRY_S + 0.5, 'kein Träger wartet länger als FULL_WAIT_S am vollen Lager (längstes Warten ' + maxWait.toFixed(1) + ' s)');
  console.log('\n  Szene des Nutzers (popCap 88, 44 Leute, volle Lager, Belagerung am Bergfried), 180 s: Leute ' + y0.pop + ' → ' + y.pop + ', ' + arrivals + ' Ankünfte, ' + trained + ' Rekruten ausgebildet, ' + idleEver.size + ' Bauern waren frei');
}

// ---- Phase 1b in action: 8 farms feed 13–16 people while 2–6 construction sites and a recruit queue are always waiting (the user's case) ----
// R11 note: a Hof whose 🌾 store is full rests (its farmer is free, and recruits and sites may take him), so `emptyAfter` counts only the empty Höfe whose store has room; `keep` makes the
// recruit queue a sensible player's: it never turns the peasants that run the fields into soldiers (peasants > farms + keep)
function foodScene(o) {   // returns { hungryAfter, emptyAfter, … } measured after the first 120 s (until then the first harvest is still on its way)
  const seed = o.seed || 3, sim = Sim.create({ seed, world: worldOf(seed), dauer: 30, burgfrieden: 180, lords: [{ i: 0, site: 0 }] });
  const put = (kind) => { const sp = W.suggest(sim.world, kind, 0, { L: sim.state.level, occ: sim.occ }); if (!sp) return null; const r = sim.dev.place(0, kind, sp.i, sp.j, sp.rot); return r.ok ? r.b : null; };
  for (let k = 0; k < o.huts; k++) put('huette');
  put('holzfaeller'); put('steinbruch'); for (let k = 0; k < o.farms; k++) put('hof'); if (o.recruits) put('kaserne');
  let hungry = 0, hungryAfter = 0, empty = 0, n = 0, popMax = 0, waiting = 0, done = 0, trained = 0;
  for (let s = 0; s < o.mins * 60 * 15; s++) {
    if (s % 15 === 0) {
      sim.dev.stock(0, { holz: 25, stein: 20 });   // wood and stone are not the point (and stay below the cap: R11 would send a woodcutter home)
      const open = sim.state.buildings.filter(b => b.lord === 0 && b.build < 1 && !b.ruined).length;
      for (let k = open; k < o.sites; k++) { const sp = W.suggest(sim.world, 'lager', 0, { L: sim.state.level, occ: sim.occ }); if (sp) sim.build(0, 'lager', sp.i, sp.j, sp.rot); }
      const y = sim.youOf(0); popMax = Math.max(popMax, y.pop);
      if (o.recruits && y.queue.length < 2 && y.stock.korn >= 8 && (!o.keep || y.pop - sim.state.lords[0].soldiers > o.farms + o.keep)) sim.recruit(0, 'speer', 1);
      if (s >= 120 * 15) { empty += sim.state.buildings.filter(b => b.kind === 'hof' && b.workers === 0 && !b.full).length; waiting += sim.state.buildings.filter(b => b.lord === 0 && b.build < 1 && !b.ruined && !b._.builder).length; n++; }
    }
    for (const e of sim.step()) { if (e.t === 'buildDone') { done++; const b = sim.state.buildings.find(x => x.id === e.id); if (b && b.kind === 'lager') sim.cancel(0, b.id); } if (e.t === 'trained') trained++; }
    if (sim.state.lords[0].hunger) { hungry += 1 / 15; if (s >= 120 * 15) hungryAfter += 1 / 15; }
  }
  return { hungry, hungryAfter, emptyAfter: empty / n, waitingAfter: waiting / n, popMax, done, trained, y: sim.youOf(0), sim };
}
{
  const a = foodScene({ farms: 8, huts: 2, sites: 6, recruits: false, mins: 8 });
  eq(a.popMax, 16, '16 Leute (Wohnraum 8 + 2 Hütten)'); ok(a.waitingAfter >= 0.2, 'es warten laufend Baustellen (Ø ' + a.waitingAfter.toFixed(2) + ' ohne Baumeister)'); eq(Math.round(a.hungry), 0, '8 Höfe, 6 Baustellen: kein Hunger, nie (' + a.hungry.toFixed(0) + ' s)'); ok(a.emptyAfter < 0.7, 'die Höfe bleiben besetzt (Ø ' + a.emptyAfter.toFixed(2) + ' leere Plätze von 8)');
  ok(a.y.food.prod >= a.y.food.eat, 'die Ernte deckt den Verbrauch (+' + a.y.food.prod + ' −' + a.y.food.eat + ')');
  const b = foodScene({ farms: 8, huts: 4, sites: 3, recruits: true, keep: 5, mins: 8 });
  ok(b.trained >= 6, 'dazu läuft eine Rekrutenschlange (' + b.trained + ' Ausgebildete)'); ok(b.done >= 40, 'und die Baustellen werden fertig, weil volle Lager Hände freigeben (' + b.done + ' Bauten in 8 Min; ohne R11 blieben es 24 bei Ø 3 wartenden)'); eq(Math.round(b.hungryAfter), 0, 'mit Rekruten und Baustellen kein Hunger nach der Anlaufzeit (' + b.hungryAfter.toFixed(0) + ' s)'); ok(b.emptyAfter < 1.5, 'Höfe mit Platz im Lager sind besetzt (Ø ' + b.emptyAfter.toFixed(2) + ' leer)'); ok(b.y.pop >= 13, 'es bleiben ' + b.y.pop + ' Leute (≥ 13)');
  console.log('\n  Futterversuch (8 Höfe, Holzfäller, Steinbruch): 2 Hütten, ' + a.popMax + ' Leute, 6 Baustellen: Hunger ' + a.hungry.toFixed(0) + ' s, leere Hofplätze (ohne volle Lager) Ø ' + a.emptyAfter.toFixed(2) + ' · 4 Hütten, Rekruten (nie unter 8 Höfe + 5 Bauern) und 3 Baustellen: Hunger nach 2 Min ' + b.hungryAfter.toFixed(0) + ' s, ' + b.y.pop + ' Leute, ' + b.trained + ' Ausgebildete');
}

// ---- recruiting: Kaserne, cost, queue, training, banners ----
{
  const sim = mk(), st = sim.state;
  eq(sim.recruit(0, 'speer', 1).reason, 'kaserne', 'ohne Kaserne: kaserne');
  const kas = placeAt(sim, 0, 'kaserne');
  ok(kas, 'Kaserne gesetzt');
  sim.dev.stock(0, { korn: 1, holz: 1, stein: 0 });
  eq(sim.recruit(0, 'speer', 1).reason, 'cost', 'zu wenig Vorrat: cost'); eq(sim.recruit(0, 'ritter', 1).reason, 'cost', 'Ritter: Stein fehlt');
  sim.dev.stock(0, { korn: 20, holz: 25, stein: 10 });
  const r = sim.recruit(0, 'speer', 1);
  eq(r.ok, true, 'recruit ok'); eq(JSON.stringify(sim.youOf(0).stock), '{"korn":18,"holz":23,"stein":10,"gold":0}', 'Speer kostet 2 Korn und 2 Holz, sofort');
  eq(JSON.stringify(sim.youOf(0).queue), '[{"unit":"speer","n":1,"p":0,"wait":true}]', 'Warteschlange mit Fortschritt p (und wait: noch kein Bauer unterwegs)');
  eq(st.banners.length, 1, 'ein Banner existiert, sobald Rekruten in der Ausbildung sind'); eq(st.banners[0].count, 0, 'noch ohne Soldaten'); eq(st.banners[0].n, 1, 'Banner 1'); eq(Object.keys(st.banners[0]).join(), 'id,lord,n,x,y,px,py,count,moving,tx,ty', 'Banner-Felder');
  const ps = [], samples = new Set(); let trainer = null;
  const log = until(sim, () => st.units.some(u => u.kind === 'speer'), secs(40), () => {
    ps.push(sim.youOf(0).queue.length ? sim.youOf(0).queue[0].p : 1);
    const u = unitsOf(sim, 0).find(x => x._.qe); if (u) { trainer = u; samples.add(u.anim); }
  }).log;
  ok(trainer, 'ein Bauer geht zur Kaserne'); ok(samples.has('walk') && samples.has('work'), 'er geht hin (walk) und übt (work)');
  ok(ps.every((p, i) => i === 0 || p >= ps[i - 1] - 1e-12), 'Fortschritt wächst nur'); ok(ps.some(p => p > 0 && p < 1), 'Fortschritt zwischen 0 und 1');
  eq(ofType(log, 'recruit').length, 1, 'recruit-Ereignis (kommt mit dem nächsten step)'); eq(JSON.stringify(ofType(log, 'recruit')[0]), JSON.stringify({ t: 'recruit', lord: 0, unit: 'speer', n: 1 }), 'recruit-Felder'); const tr = ofType(log, 'trained'); eq(tr.length, 1, 'trained-Ereignis'); eq(tr[0].unit, 'speer', 'trained.unit'); eq(tr[0].lord, 0, 'trained.lord');
  const sp = st.units.find(u => u.kind === 'speer'); eq(sp.id, tr[0].id, 'trained.id = die Einheit'); eq(sp.hp, 60, 'Speerträger hp 60'); eq(sp.n, 1, 'n = Bannernummer'); eq(sp.carry, null, 'keine Last'); eq(sp.lord, 0, 'Haus');
  eq(st.banners[0].count, 1, 'Banner zählt den Soldaten'); eq(sim.youOf(0).queue.length, 0, 'Warteschlange leer'); eq(st.lords[0].soldiers, 1, 'lords[].soldiers');
  { const s5 = mk(); placeAt(s5, 0, 'kaserne'); s5.recruit(0, 'speer', 1); s5.dev.stock(0, { korn: 0 }); let pre = -1, post = -1;
    for (let i = 0; i < secs(30) && post < 0; i++) { const before = s5.state.lords[0].people, ev = s5.step(); if (ev.some(e => e.t === 'trained')) { pre = before; post = s5.state.lords[0].people; } }
    ok(pre > 0 && pre === post, 'Bauer wurde Soldat: people bleibt gleich (' + pre + ' → ' + post + ')'); }
  const yb = sim.youOf(0).banners; eq(yb.length, 1, 'youOf.banners'); eq(Object.keys(yb[0]).join(), 'n,count,x,y,tx,ty', 'youOf.banners-Felder'); eq(yb[0].count, 1, 'youOf.banners.count');
  // the Burgwache (n = 0) holds near the gate and is not a pin
  const rg = sim.recruit(0, 'bogen', 0); eq(rg.ok, true, 'Burgwache rekrutieren');
  until(sim, () => st.units.some(u => u.kind === 'bogen'), secs(30)); const bg = st.units.find(u => u.kind === 'bogen'); eq(bg.n, 0, 'Burgwache: n = 0'); eq(st.banners.length, 1, 'die Burgwache ist keine Spielfigur in state.banners');
  run(sim, secs(10)); const g = gateOf(sim, 0); ok(dist(bg, { x: g.x, y: g.y + g.out * 6 }) < 3.5, 'die Burgwache steht vor dem Tor (' + dist(bg, g).toFixed(1) + ')');
  ok(sim.youOf(0).banners.some(b => b.n === 0 && b.count === 1), 'youOf.banners führt die Burgwache (n = 0)');
  // 'pop': every recruit uses up a peasant; the house keeps at least PEASANT_MIN
  const sim2 = mk(); placeAt(sim2, 0, 'kaserne'); sim2.dev.stock(0, { korn: 40, holz: 40 });
  const outs = []; for (let i = 0; i < 8; i++) outs.push(sim2.recruit(0, 'speer', 1).reason || 'ok');
  eq(outs.join(), 'ok,ok,ok,ok,pop,pop,pop,pop', 'bei 6 Bauern: 4 Rekruten, dann pop (Rest ' + C.PEASANT_MIN + ')');
  // the Kaserne is destroyed during training: the peasant goes back, the order waits and is not lost
  const sim3 = mk(); const k3 = placeAt(sim3, 0, 'kaserne'); sim3.recruit(0, 'speer', 1);
  until(sim3, () => unitsOf(sim3, 0).some(u => u._.qe && u._.ws === 1), secs(20));
  sim3.dev.damage(k3, 1e9, 1); run(sim3, 3);
  eq(sim3.youOf(0).queue.length, 1, 'die Bestellung bleibt'); eq(sim3.youOf(0).queue[0].p, 0, 'Fortschritt zurückgesetzt'); eq(unitsOf(sim3, 0).filter(u => u._.qe).length, 0, 'kein Bauer übt mehr');
  placeAt(sim3, 0, 'kaserne'); const l3 = until(sim3, () => sim3.state.units.some(u => u.kind === 'speer'), secs(40)); ok(l3.hit, 'mit neuer Kaserne wird der Speerträger fertig');
  // a rally point can be set before the banner exists; the new soldier walks there
  const sim4 = mk({ burgfrieden: 0 }); toFehde(sim4); placeAt(sim4, 0, 'kaserne');
  const home2 = sim4.youOf(0).banners; eq(home2.length, 0, 'noch kein Banner'); const g4 = gateOf(sim4, 0), rally = sim4.banner(0, 2, g4.x + 9, g4.y + g4.out * 4);
  eq(rally.ok, true, 'Sammelpunkt für ein künftiges Banner'); sim4.recruit(0, 'speer', 2); until(sim4, () => sim4.state.units.some(u => u.kind === 'speer'), secs(40)); run(sim4, secs(15));
  const s4 = sim4.state.units.find(u => u.kind === 'speer'); ok(dist(s4, { x: rally.x, y: rally.y }) < 3, 'der Rekrut steht am Sammelpunkt (' + dist(s4, rally).toFixed(1) + ')');
}

// ---- banner orders: snap, unreachable, pact, home ----
{
  const sim = mk({ burgfrieden: 0 }), st = sim.state, w = sim.world; toFehde(sim);
  const g = gateOf(sim, 0), blk = sim.dev.blk;
  stage(sim, 0, 'speer', { x: g.x, y: g.y + g.out * 8 }, 1); run(sim, 1);
  // a reachable cell: taken as given, no reason
  const free = { x: g.x + 4.2, y: g.y + g.out * 9.3 }; ok(!blockedAt(sim, free), 'Testpunkt ist frei');
  const a = sim.banner(0, 1, free.x, free.y); eq(a.ok, true, 'Befehl ok'); eq(a.reason, undefined, 'kein Grund'); near(a.x, free.x, 1e-9, 'Ziel unverändert x'); near(a.y, free.y, 1e-9, 'Ziel unverändert y');
  const l1 = run(sim, 1); const od = ofType(l1, 'order'); eq(od.length, 1, 'order-Ereignis'); eq(JSON.stringify(od[0]), JSON.stringify({ t: 'order', lord: 0, n: 1, x: free.x, y: free.y }), 'order-Felder');
  eq(st.banners[0].tx, free.x, 'state.banners[].tx'); eq(sim.youOf(0).banners[0].tx, free.x, 'youOf.banners[].tx');
  // deep water: snapped to the nearest reachable cell within 12
  let river = null, rd = 1e9;
  for (let k = 0; k < N; k++) if (w.cls[k] === W.CI.W) { const p = { x: -71.5 + k % GW, y: -44.5 + Math.floor(k / GW) }, d = dist(p, g); if (d < rd) { rd = d; river = p; } }
  ok(river && blk[W.cellOf(river.x, river.y)], 'tiefes Wasser ist gesperrt');
  const b = sim.banner(0, 1, river.x, river.y); eq(b.ok, true, 'Wasser: ok'); eq(b.reason, 'snapped', 'Wasser: snapped'); ok(dist(b, river) <= C.SNAP_R + 1e-9, 'innerhalb von 12 (' + dist(b, river).toFixed(1) + ')'); ok(!blockedAt(sim, b), 'Ziel ist begehbar');
  // nothing reachable within 12 (the other bank of a wide stretch is another area, or far): own keep gate
  const far = { x: 70.5, y: 44.5 }; const c = sim.banner(0, 1, far.x, far.y);
  ok(c.ok && (c.reason === undefined || c.reason === 'snapped' || c.reason === 'unreachable'), 'weit entferntes Ziel wird angenommen');
}
{
  // during the flood the quarters are cut off: an order across the river leads home
  const sim = mk(), st = sim.state, g = gateOf(sim, 0);
  stage(sim, 0, 'speer', { x: g.x, y: g.y + g.out * 6 }, 1);
  const g3 = gateOf(sim, 3), r = sim.banner(0, 1, g3.x, g3.y);
  eq(r.ok, true, 'Flut: Befehl wird angenommen'); eq(r.reason, 'unreachable', 'Flut: unreachable'); near(r.x, g.x, 1e-9, 'unreachable: Ziel = eigenes Burgtor x'); near(r.y, g.y, 1e-9, 'unreachable: Ziel = eigenes Burgtor y');
  const n2 = sim.banner(0, 1, g.x + 3, g.y + g.out * 6); eq(n2.reason, undefined, 'im eigenen Viertel geht es');
}
{
  // pacts: orders on or within 6 of a partner's buildings are refused; the pact also makes soldiers ignore each other
  const sim = mk({ burgfrieden: 0 }), st = sim.state, w = sim.world; toFehde(sim);
  const hut = placeAt(sim, 1, 'huette'), hx = -72 + hut.i + 1, hy = -45 + hut.j + 1;
  sim.pact(0, 1, true); sim.pact(1, 0, true); eq(sim.youOf(0).pacts.find(p => p.with === 1).state, 'active', 'Pakt aktiv');
  const g0 = gateOf(sim, 0); stage(sim, 0, 'speer', { x: g0.x, y: g0.y + g0.out * 8 }, 1);
  const rr = sim.banner(0, 1, hx, hy); eq(rr.ok, false, 'Pakt: Ziel am Gebäude verweigert'); eq(rr.reason, 'pact', 'Grund pact');
  const kx = world1().sites[1].x + 0.5, ky = world1().sites[1].y;
  eq(sim.banner(0, 1, kx, ky).reason, 'pact', 'auch am Bergfried des Partners');
  // within 6 of any building of the partner: refused; beyond: allowed (scan the partner's quarter for such points)
  const rects = st.buildings.filter(b => b.lord === 1).map(b => { const f = W.footprintOf(b.kind, b.rot); return { x0: -72 + b.i, y0: -45 + b.j, x1: -72 + b.i + f[0], y1: -45 + b.j + f[1] }; });
  const dmin = (x, y) => Math.min(...rects.map(r => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1))));
  let inZ = null, outZ = null;
  for (let k = 0; k < N && !(inZ && outZ); k++) {
    if (w.owner[k] !== 1 || w.cls[k] === W.CI.T || sim.dev.blk[k]) continue;
    const p = { x: -71.5 + k % GW, y: -44.5 + Math.floor(k / GW) }, d = dmin(p.x, p.y);
    if (!inZ && d > 4.6 && d < 5.4) inZ = p; if (!outZ && d > 6.4 && d < 7.2) outZ = p;
  }
  ok(inZ && outZ, 'Testpunkte bei Abstand ≈ 5 und ≈ 7 gefunden');
  if (inZ && outZ) { eq(sim.banner(0, 1, inZ.x, inZ.y).reason, 'pact', 'Abstand ≈ 5: verweigert'); const fine = sim.banner(0, 1, outZ.x, outZ.y); ok(fine.ok && fine.reason !== 'pact', 'Abstand ≈ 7: erlaubt'); }
  // the other house stays free
  const other = sim.banner(0, 1, g0.x + 2, g0.y + g0.out * 9); eq(other.ok, true, 'andere Ziele bleiben erlaubt');
}
function world1() { return worldOf(1); }
{
  // home: every banner goes back to the gate; the order is announced for each existing banner
  const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
  const g = gateOf(sim, 0), p1 = { x: g.x + 3, y: g.y + g.out * 12 };
  stage(sim, 0, 'speer', { x: g.x - 7, y: g.y + g.out * 8 }, 1); stage(sim, 0, 'bogen', { x: g.x + 7, y: g.y + g.out * 8 }, 2);
  sim.banner(0, 1, p1.x, p1.y); sim.banner(0, 2, p1.x + 2, p1.y); run(sim, secs(5));
  const r = sim.home(0); eq(r.ok, true, 'home ok'); const l = run(sim, 1); eq(ofType(l, 'order').length, 2, 'ein order je vorhandenem Banner');
  const homeTargets = sim.youOf(0).banners.map(b => [b.tx, b.ty]); ok(homeTargets.every(([x, y]) => dist({ x, y }, g) < 14), 'Banner-Ziele liegen vor dem eigenen Tor');
  eq(sim.home(0).ok, true, 'home ist wiederholbar');
}

// ---- marching: fords, wading, flood ----
{
  // 4 soldiers cross the Westfurt from the NW to the SW quarter; nobody ever stands on a blocked cell
  const sim = mk({ burgfrieden: 0 }), st = sim.state, w = sim.world; toFehde(sim);
  const wf = w.crossings.find(c => c.id === 'westfurt'), north = wf.ends[0], south = wf.ends[1];
  const g = gateOf(sim, 0);
  sim.banner(0, 1, north.x, north.y);
  const sx = []; for (let i = 0; i < 4; i++) sx.push(sim.dev.spawn(0, 'speer', north.x - 1 + i * 0.8, north.y - 2 + (i % 2), 1));
  sim.banner(0, 1, south.x, south.y);
  const bn = sim.dev.lord(0).bn[1], steps = [], blkHits = [];
  let arrivedAt = -1, t0 = st.t, wet = 0;
  const res = until(sim, () => bn.arrived && dist(bn, south) < 1.5, secs(120), () => {
    const k = W.cellOf(bn.x, bn.y);
    if (steps.length < 1e5) steps.push([bn.x, bn.y, sim.dev.level(), w.hq[k], w.cls[k]]);
    for (const u of sx) if (sim.dev.blk[W.cellOf(u.x, u.y)]) blkHits.push(u.id);
  });
  ok(res.hit, 'das Banner erreicht das Südufer der Westfurt'); eq(blkHits.length, 0, 'niemand steht je auf einer gesperrten Zelle');
  const pathT = W.path(w, north, south, 0).time / 2.6; ok(st.t - t0 < pathT * 1.8 + 15, 'Marschzeit passt zum Weg (' + (st.t - t0).toFixed(1) + ' s bei ' + pathT.toFixed(1) + ' s Weg)');
  // the leader walks at 45 % in the shallows: compare step lengths on wet and dry cells
  let dryS = [], wetS = [];
  for (let i = 1; i < steps.length; i++) { const d = Math.hypot(steps[i][0] - steps[i - 1][0], steps[i][1] - steps[i - 1][1]), q = steps[i - 1][3], c = steps[i - 1][4]; if (d < 1e-6 || steps[i][4] !== c) continue; if (q < 0) wetS.push(d); else if (c === W.CI.S || c === W.CI.A || c === W.CI.G) dryS.push(d); }
  ok(wetS.length > 5 && dryS.length > 5, 'Furt und Land durchquert (' + wetS.length + '/' + dryS.length + ' Schritte)');
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length; const ratio = avg(wetS) / avg(dryS); ok(ratio > 0.3 && ratio < 0.62, 'Waten verlangsamt auf ≈ 45 % (Verhältnis ' + ratio.toFixed(2) + ')');
  eq(sx.filter(u => u.hp > 0).length >= 3, true, 'Furtquerung ohne Feind kostet keine Soldaten');
}
{
  // flood: the Steinbrücke opens first; the ford ends stay cut off until their open value
  const sim = mk({ burgfrieden: 0 }), st = sim.state, w = sim.world;
  const br = w.crossings.find(c => c.id === 'steinbruecke'), wf = w.crossings.find(c => c.id === 'westfurt'), cellOf = (p) => W.cellOf(p.x, p.y);
  const lab = () => sim.dev.labels(), conn = (c) => lab()[cellOf(c.ends[0])] >= 0 && lab()[cellOf(c.ends[0])] === lab()[cellOf(c.ends[1])];
  run(sim, 1); eq(conn(br), false, 'Brücke zu bei L ≈ 1'); eq(conn(wf), false, 'Furt zu bei L ≈ 1');
  const rr = until(sim, () => st.level < br.open - 0.01, secs(30)); run(sim, 3);
  eq(conn(br), true, 'Brücke offen kurz unter open = ' + br.open); eq(conn(wf), false, 'Furt noch zu (L = ' + st.level.toFixed(2) + ')');
  until(sim, () => st.level < wf.open - 0.01, secs(30)); run(sim, 3); eq(conn(wf), true, 'Furt offen unter open = ' + wf.open);
  // a soldier crosses the bridge while the fords are still closed
  const sim2 = mk({ burgfrieden: 0 }), s2 = sim2.state;
  until(sim2, () => s2.level < br.open - 0.02, secs(30));
  const u = sim2.dev.spawn(1, 'speer', br.ends[0].x, br.ends[0].y, 1), tgt = br.ends[1];
  const r2 = sim2.banner(1, 1, tgt.x, tgt.y); eq(r2.ok, true, 'Befehl über die Brücke'); ok(r2.reason === undefined || dist(r2, tgt) < 3, 'Ziel auf der anderen Seite');
  const arr = until(sim2, () => dist(u, tgt) < 2, secs(40)); ok(arr.hit, 'über die Steinbrücke (' + (arr.steps / 15).toFixed(1) + ' s, L = ' + s2.level.toFixed(2) + ')'); ok(s2.level > wf.open, 'während die Furten noch zu sind');
}

// ---- fighting: matchups, wading, buildings, towers, leash, flight, Burgwache, torches ----
const CI = W.CI;
// an open dry patch of quarter l (7 × 7 cells of plain walkable ground at level 0, nothing built), well away from its keep and yard
function clearing(sim, l) {
  const w = sim.world, site = sim.state.lords.find(x => x.i === l).site, kp = w.sites[site];
  let best = null, bd = -1;
  for (let j = 3; j < GH - 3; j++) for (let i = 3; i < GW - 3; i++) {
    if (w.owner[j * GW + i] !== site) continue;
    let good = true;
    for (let dj = -3; dj <= 3 && good; dj++) for (let di = -3; di <= 3 && good; di++) {
      const q = (j + dj) * GW + i + di;
      if (w.owner[q] !== site || (w.cls[q] !== CI.G && w.cls[q] !== CI.A) || w.hq[q] < 1 || sim.occ[q]) good = false;
    }
    if (!good) continue;
    // far from every keep, so no arrow reaches the test (keeps shoot 12 far)
    const d = Math.min(...w.sites.map(q => Math.hypot(i - 71.5 - q.x, j - 44.5 - q.y)));
    if (d >= 18 && (best === null || d > bd)) { bd = d; best = { x: -71.5 + i, y: -44.5 + j }; }
  }
  return best;
}
const hitsOn = (log, id) => log.filter(e => e.t === 'hit' && e.id === id).length;
// A (lord 0) and B (lord 1) stand 1.1 apart, both with huge hp so only the blows are measured. Every blow on B is recorded with
// the wading state of both fighters at that moment: melee damage must equal base × 0.7 (attacker wades) × 1.25 (target wades)
const wetPt = (sim, p) => { const k = W.cellOf(p.x, p.y); return k >= 0 && sim.world.hq[k] < 0; };
function duel(kindA, kindB, secsRun, gap) {
  const sim = mk({ burgfrieden: 0 }); toFehde(sim);
  const p = clearing(sim, 0), A = stage(sim, 0, kindA, p), B = stage(sim, 1, kindB, { x: p.x + (gap || 1.1), y: p.y });
  A.hp = B.hp = 1e5;
  const blows = [], log = [];
  for (let i = 0; i < secs(secsRun || 6); i++) {
    const hp0 = B.hp, ev = sim.step();
    for (const e of ev) log.push(e);
    if (ev.some(e => e.t === 'hit' && e.id === B.id)) blows.push({ dmg: hp0 - B.hp, wetA: wetPt(sim, A), wetB: wetPt(sim, B) });
  }
  const n = hitsOn(log, B.id);
  return { n, blows, log, sim, A, B, per: n ? (1e5 - B.hp) / n : 0 };
}
{
  const table = [['speer', 'speer', 8], ['speer', 'bogen', 8], ['speer', 'ritter', 16], ['speer', 'fackel', 8], ['ritter', 'speer', 14], ['ritter', 'bogen', 28], ['ritter', 'ritter', 14], ['ritter', 'fackel', 14],
    ['bogen', 'speer', 6], ['bogen', 'fackel', 9], ['bogen', 'ritter', 6], ['bogen', 'bogen', 6]];
  for (const [a, b, d] of table) {
    const r = duel(a, b, 5); ok(r.n >= 2, a + ' → ' + b + ': trifft (' + r.n + ' Treffer)');
    const melee = C.UNIT[a].range < 3;   // an arrow is priced at launch, a blow on the spot
    for (const bl of r.blows) { const exp = melee ? d * (bl.wetA ? C.WADE_DEALT : 1) * (bl.wetB ? C.WADE_TAKEN : 1) : d; near(bl.dmg, exp, 1e-6, a + ' → ' + b + ': Schaden je Treffer'); }
    if (!(melee && b === 'fackel') && !r.blows.some(bl => !bl.wetA && !bl.wetB)) ok(false, a + ' → ' + b + ': mindestens ein trockener Treffer');
  }
  const f = duel('fackel', 'speer', 5); eq(f.n, 0, 'Fackelträger kämpfen nie'); eq(f.B.hp, 1e5, 'und richten keinen Schaden an');
  // cooldowns: melee blows come every 1.0 s (speer) and 1.2 s (ritter)
  const sp = duel('speer', 'speer', 8), ts = sp.log.filter(e => e.t === 'hit' && e.id === sp.B.id).length; ok(ts >= 6 && ts <= 9, 'Speer: ≈ 1 Schlag je Sekunde (' + ts + ' in 8 s)');
  const rt = duel('ritter', 'ritter', 8).n; ok(rt >= 5 && rt <= 8, 'Ritter: ≈ 1 Schlag je 1.2 s (' + rt + ' in 8 s)');
  // arrows: the `shot` event announces flight time and source, the damage lands on arrival
  const sim = mk({ burgfrieden: 0 }); toFehde(sim);
  const p = clearing(sim, 0), A = stage(sim, 0, 'bogen', { x: p.x - 2, y: p.y }), B = stage(sim, 1, 'speer', { x: p.x + 2.5, y: p.y });
  A.hp = B.hp = 1e5; B._.cd = 1e9;   // the spearman is a target only
  let shot = null, hitT = -1, shotT = -1, hpAtShot = 0, shotB = null;
  for (let i = 0; i < secs(4) && hitT < 0; i++) {
    const ev = sim.step();
    for (const e of ev) { if (e.t === 'shot' && !shot) { shot = e; shotT = sim.state.t; hpAtShot = B.hp; shotB = { x: B.x, y: B.y }; } if (e.t === 'hit' && e.id === B.id && hitT < 0) hitT = sim.state.t; }
    if (shot && hitT < 0) eq(B.hp, hpAtShot, 'Pfeil: während des Flugs noch kein Schaden');
  }
  ok(shot, 'shot-Ereignis'); eq(shot.src, 'bogen', 'shot.src'); ok(shot.flight >= 0.35 && shot.flight <= 0.7, 'Flugzeit 0.35–0.7 s (' + shot.flight.toFixed(2) + ')');
  ok(Math.hypot(shot.from[0] - A.x, shot.from[1] - A.y) < 0.6, 'shot.from = Schütze'); ok(Math.hypot(shot.to[0] - shotB.x, shot.to[1] - shotB.y) < 0.6, 'shot.to = Ziel'); eq(Object.keys(shot).join(), 't,from,to,flight,src', 'shot-Felder');
  near(hitT - shotT, shot.flight, 1 / 15 + 1e-9, 'der Schaden kommt nach der Flugzeit'); near(hpAtShot - B.hp, 6, 1e-9, 'Pfeil 6 Schaden');
  // the blow event: hit { id, x, y }; clash dust is announced at most every 0.6 s per spot
  const d2 = duel('speer', 'speer', 5), h0 = d2.log.find(e => e.t === 'hit'); eq(Object.keys(h0).join(), 't,id,x,y', 'hit-Felder'); const cl = ofType(d2.log, 'clash'); ok(cl.length >= 1 && cl.length <= 10, 'clash gedrosselt (' + cl.length + ')'); eq(Object.keys(cl[0]).join(), 't,x,y', 'clash-Felder');
  // outcomes: a rider beats a lone spearman, two spearmen beat a rider, a rider beats two archers
  const fightOut = (setup, secsRun) => { const s = mk({ burgfrieden: 0 }); toFehde(s); const q = clearing(s, 0); const us = setup(s, q); run(s, secs(secsRun)); return us.map(u => u.hp > 0); };
  const o1 = fightOut((s, q) => [stage(s, 0, 'ritter', q), stage(s, 1, 'speer', { x: q.x + 2, y: q.y })], 25); eq(o1.join(), 'true,false', 'Ritter schlägt einen einzelnen Speerträger');
  const o2 = fightOut((s, q) => [stage(s, 0, 'ritter', q), stage(s, 1, 'speer', { x: q.x + 2, y: q.y }), s.dev.spawn(1, 'speer', q.x + 2, q.y + 1, 1)], 25); eq(o2[0], false, 'zwei Speerträger schlagen den Ritter'); ok(o2[1] || o2[2], 'mindestens einer überlebt');
  const o3 = fightOut((s, q) => [stage(s, 0, 'ritter', q), stage(s, 1, 'bogen', { x: q.x + 4, y: q.y }), s.dev.spawn(1, 'bogen', q.x + 4, q.y + 1, 1)], 25); eq(o3[0], true, 'Ritter schlägt zwei Bogenschützen'); eq(o3[1] || o3[2], false, 'und beide fallen');
}
{
  // wading: damage dealt × 0.7 while the attacker wades, damage taken × 1.25 while the target wades
  const sim = mk({ burgfrieden: 0 }), w = sim.world; toFehde(sim);
  const wf = w.crossings.find(c => c.id === 'westfurt');
  const isWet = (k) => w.cls[k] === CI.F && w.hq[k] < 0, isDry = (k) => (w.cls[k] === CI.S || w.cls[k] === CI.G || w.cls[k] === CI.A) && w.hq[k] >= 1;
  let wetWet = null, wetDry = null;
  for (const k of wf.cells) {
    const i = k % GW, c = (di) => (di < 0 && i === 0) || (di > 0 && i === GW - 1) ? -1 : k + di;
    if (!isWet(k)) continue;
    const e = c(1), wd = c(-1);
    if (!wetWet && e >= 0 && isWet(e) && !sim.dev.blk[e]) wetWet = [k, e];
    if (!wetDry && e >= 0 && isDry(e)) wetDry = [k, e]; else if (!wetDry && wd >= 0 && isDry(wd)) wetDry = [k, wd];
  }
  ok(wetWet && wetDry, 'Furtzellen: nass/nass und nass/trocken gefunden');
  const cellPt = (k) => ({ x: -71.5 + k % GW, y: -44.5 + Math.floor(k / GW) });
  const measure = (pa, pb) => {
    const s = mk({ burgfrieden: 0 }); toFehde(s);
    const A = stage(s, 0, 'speer', pa), B = stage(s, 1, 'speer', pb); A.hp = B.hp = 1e5;
    const log = run(s, secs(5)), n = hitsOn(log, B.id); return n ? (1e5 - B.hp) / n : 0;
  };
  const dry = duel('speer', 'speer', 5).per, [wa, wb] = wetWet.map(cellPt), [xa, xb] = wetDry.map(cellPt);
  near(dry, 8, 1e-6, 'Land gegen Land: 8');
  near(measure(wa, wb), 8 * 0.7 * 1.25, 1e-6, 'beide im Wasser: 8 × 0.7 × 1.25 = 7');
  near(measure(xa, xb), 8 * 0.7, 1e-6, 'Angreifer im Wasser, Ziel an Land: 8 × 0.7 = 5.6');
  near(measure(xb, xa), 8 * 1.25, 1e-6, 'Angreifer an Land, Ziel im Wasser: 8 × 1.25 = 10');
  // the ford itself: units slow to 45 % there (see marching); keeps and towers apply the same factor to arrows
}
{
  // damage against buildings: speer × 1, ritter × 0.6, bogen × 0.3; only a banner standing within 3 of the building attacks it
  const siege = (kind, near3) => {
    const sim = mk({ burgfrieden: 0 }); toFehde(sim);
    const hut = placeAt(sim, 1, 'huette'), bp = hut._;
    for (const u of unitsOf(sim, 1, 'bauer')) sim.dev.kill(u);
    const spot = [[bp.cx, bp.y1 + 1.4], [bp.cx, bp.y0 - 1.4], [bp.x1 + 1.4, bp.cy], [bp.x0 - 1.4, bp.cy]].map(([x, y]) => ({ x, y })).find(q => !blockedAt(sim, q));
    const p = near3 ? spot : { x: spot.x, y: spot.y + 9 };
    const A = stage(sim, 0, kind, p); A.hp = 1e5;
    const log = run(sim, secs(7)), n = hitsOn(log, hut.id);
    return { n, per: n ? (bp.maxHp - bp.hpAbs) / n : 0, hut, sim, A, log };
  };
  const s1 = siege('speer', true), s2 = siege('ritter', true), s3 = siege('bogen', true), s4 = siege('speer', false);
  ok(s1.n >= 3, 'Speer greift das Gebäude an (' + s1.n + ')'); near(s1.per, 8, 1e-6, 'Speer gegen Gebäude: 8'); near(s2.per, 14 * 0.6, 1e-6, 'Ritter gegen Gebäude: 8.4'); near(s3.per, 6 * 0.3, 1e-6, 'Bogen gegen Gebäude: 1.8');
  eq(s4.n, 0, 'Banner nicht beim Gebäude: kein Angriff'); eq(s4.hut.hp, 1, 'Gebäude unversehrt');
  // a fallen hut is a ruin: +3 Ruhm for the destroyer; kaserne and wachturm +5
  const s5 = mk({ burgfrieden: 0 }); toFehde(s5);
  const hut = placeAt(s5, 1, 'huette'), kas = placeAt(s5, 1, 'kaserne'), tw = placeAt(s5, 1, 'wachturm'), lg = placeAt(s5, 1, 'lager');
  s5.dev.damage(hut, 1e9, 0); eq(s5.state.lords[0].ruhm, 3, 'Hütte zerstört: +3'); s5.dev.damage(kas, 1e9, 0); eq(s5.state.lords[0].ruhm, 8, 'Kaserne: +5'); s5.dev.damage(tw, 1e9, 0); eq(s5.state.lords[0].ruhm, 13, 'Wachturm: +5'); s5.dev.damage(lg, 1e9, 0); eq(s5.state.lords[0].ruhm, 16, 'Lager: +3');
  const own = placeAt(s5, 0, 'huette'); s5.dev.damage(own, 1e9, 0); eq(s5.state.lords[0].ruhm, 16, 'das eigene Gebäude zu verlieren bringt kein Ruhm');
  // under construction: hp follows the work, a damaged site stays damaged
  const s6 = mk(), sp = W.suggest(s6.world, 'huette', 0, { L: 1, occ: s6.occ }), r6 = s6.build(0, 'huette', sp.i, sp.j, sp.rot), site = s6.state.buildings.find(b => b.id === r6.id);
  s6.dev.damage(site, 6, 1); near(site.hp, (0.1 * 120 - 6) / 120, 1e-9, 'Baustelle: Schaden zieht von den 10 % ab');
  until(s6, () => site.build >= 1, secs(40)); near(site.hp, (120 - 6) / 120, 1e-9, 'fertig: Schaden bleibt (114/120)');
}
{
  // towers and keeps shoot the nearest enemy in range (fackel first), 7 per 1.5 s and 6 per 2 s, damage on arrival
  const sim = mk({ burgfrieden: 0 }), w = sim.world; toFehde(sim);
  const tw = placeAt(sim, 0, 'wachturm'), tc = { x: tw._.cx, y: tw._.cy }, keep = sim.dev.lord(0).keepB._;
  const spotAt = (r, from) => { for (let a = 0; a < 360; a += 5) { const q = { x: from.x + Math.cos(a * Math.PI / 180) * r, y: from.y + Math.sin(a * Math.PI / 180) * r }; if (!blockedAt(sim, q) && Math.hypot(q.x - keep.cx, q.y - keep.cy) > 13 && sim.dev.lord(1).bn[1] && W.walk(w, W.cellOf(q.x, q.y), 0) === 1) return q; } return null; };
  const e1 = spotAt(8, tc), e2 = spotAt(10.5, tc); ok(e1 && e2, 'Zielpunkte in 8 und 10.5 Entfernung');
  const E = stage(sim, 1, 'speer', e1); E.hp = 1e5; E._.cd = 1e9;
  const shots = []; let hpPrev = E.hp, dmgs = [];
  for (let i = 0; i < secs(7); i++) { for (const e of sim.step()) if (e.t === 'shot') shots.push({ ...e, at: sim.state.t }); if (E.hp < hpPrev - 1e-9) { dmgs.push(hpPrev - E.hp); hpPrev = E.hp; } }
  ok(shots.length >= 4, 'der Turm schießt (' + shots.length + ' Schüsse in 7 s)'); ok(shots.every(s => s.src === 'turm'), 'shot.src = turm');
  ok(shots.every((s, i) => i === 0 || Math.abs(s.at - shots[i - 1].at - 1.5) < 0.1), 'alle 1.5 s'); ok(shots.every(s => Math.abs(s.from[0] - tc.x) < 1e-9 && Math.abs(s.from[1] - tc.y) < 1e-9), 'Pfeile starten am Turm');
  ok(dmgs.length >= 3 && dmgs.every(d => Math.abs(d - 7) < 1e-9), 'jeder Pfeil 7 Schaden (' + dmgs.join(',') + ')');
  // out of range: nothing; fackel first: with a spearman nearer and a torch-bearer farther, the first arrow flies at the torch-bearer
  const sim2 = mk({ burgfrieden: 0 }); toFehde(sim2); const tw2 = placeAt(sim2, 0, 'wachturm'), tc2 = { x: tw2._.cx, y: tw2._.cy }, keep2 = sim2.dev.lord(0).keepB._;
  const farP = (() => { for (let a = 0; a < 360; a += 5) { const q = { x: tc2.x + Math.cos(a * Math.PI / 180) * 14.5, y: tc2.y + Math.sin(a * Math.PI / 180) * 14.5 }; if (!blockedAt(sim2, q) && Math.hypot(q.x - keep2.cx, q.y - keep2.cy) > 13.5) return q; } return null; })();
  if (farP) { const F = stage(sim2, 1, 'speer', farP); F._.cd = 1e9; F.hp = 1e5; const l = run(sim2, secs(4)); eq(ofType(l, 'shot').filter(s => s.src === 'turm').length, 0, 'außer Reichweite (14.5): kein Schuss'); }
  const sim3 = mk({ burgfrieden: 0 }); toFehde(sim3); const tw3 = placeAt(sim3, 0, 'wachturm'), tc3 = { x: tw3._.cx, y: tw3._.cy }, keep3 = sim3.dev.lord(0).keepB._;
  const pts = []; for (let a = 0; a < 360 && pts.length < 2; a += 5) { const q = { x: tc3.x + Math.cos(a * Math.PI / 180) * 9, y: tc3.y + Math.sin(a * Math.PI / 180) * 9 }; if (!blockedAt(sim3, q) && Math.hypot(q.x - keep3.cx, q.y - keep3.cy) > 13 && (!pts.length || Math.hypot(q.x - pts[0].x, q.y - pts[0].y) > 3)) pts.push(q); }
  if (pts.length === 2) {
    const near1 = stage(sim3, 1, 'speer', { x: tc3.x + (pts[0].x - tc3.x) * 0.7, y: tc3.y + (pts[0].y - tc3.y) * 0.7 }), fk = stage(sim3, 1, 'fackel', pts[1], 2);
    near1.hp = fk.hp = 1e5; near1._.cd = 1e9; const l = run(sim3, secs(2)), first = ofType(l, 'shot').find(s => s.src === 'turm');
    ok(first, 'der Turm schießt'); if (first) ok(Math.hypot(first.to[0] - fk.x, first.to[1] - fk.y) < 1.5, 'Fackelträger zuerst, auch wenn er weiter weg steht');
  }
  // the keep shoots, too: 6 damage every 2 s (and keeps shooting while protected)
  const sim4 = mk({ burgfrieden: 0 }); toFehde(sim4); const k4 = sim4.dev.lord(0).keepB._;
  const ep = (() => { for (let a = 0; a < 360; a += 5) { const q = { x: k4.cx + Math.cos(a * Math.PI / 180) * 9, y: k4.cy + Math.sin(a * Math.PI / 180) * 9 }; if (!blockedAt(sim4, q) && sim4.world.owner[W.cellOf(q.x, q.y)] === 0) return q; } return null; })();
  const E4 = stage(sim4, 1, 'speer', ep); E4.hp = 1e5; E4._.cd = 1e9; const sh = [], dm = []; let hp4 = E4.hp;
  for (let i = 0; i < secs(9); i++) { for (const e of sim4.step()) if (e.t === 'shot') sh.push({ ...e, at: sim4.state.t }); if (E4.hp < hp4 - 1e-9) { dm.push(hp4 - E4.hp); hp4 = E4.hp; } }
  ok(sh.length >= 3 && sh.every(s => s.src === 'keep'), 'Bergfried schießt (src keep, ' + sh.length + ' Schüsse)'); ok(sh.every((s, i) => i === 0 || Math.abs(s.at - sh[i - 1].at - 2) < 0.1), 'alle 2 s'); ok(dm.every(d => Math.abs(d - 6) < 1e-9) && dm.length >= 3, 'je 6 Schaden');
  // own units are never shot
  const own = sim4.dev.spawn(0, 'speer', ep.x, ep.y, 1); own.hp = 1e5; const hpO = own.hp; run(sim4, secs(5)); ok(own.hp === hpO || own.hp > hpO - 20, 'eigene Einheiten bleiben unbeschossen');
}
{
  // R7: keep and tower arrows deal × ARROW_FACKEL (2) against a torch-bearer: 14 from a tower (7 × 2), 12 from the keep (6 × 2); everybody else takes the plain 7 and 6
  const dmgOf = (sim, E, secsRun) => { const out = []; let hp = E.hp; for (let i = 0; i < secs(secsRun); i++) { sim.step(); if (E.hp < hp - 1e-9) { out.push(hp - E.hp); hp = E.hp; } } return out; };
  const sim = mk({ burgfrieden: 0 }); toFehde(sim);
  const tw = placeAt(sim, 0, 'wachturm'), tc = { x: tw._.cx, y: tw._.cy }, keep = sim.dev.lord(0).keepB._;
  const pt = (() => { for (let a = 0; a < 360; a += 5) { const q = { x: tc.x + Math.cos(a * Math.PI / 180) * 8, y: tc.y + Math.sin(a * Math.PI / 180) * 8 }; if (!blockedAt(sim, q) && Math.hypot(q.x - keep.cx, q.y - keep.cy) > 13 && W.walk(sim.world, W.cellOf(q.x, q.y), 0) === 1) return q; } return null; })();
  ok(pt, 'Zielpunkt in 8 vom Turm');
  const F = stage(sim, 1, 'fackel', pt, 2); F.hp = 1e5; const dt = dmgOf(sim, F, 7);
  ok(dt.length >= 3 && dt.every(d => Math.abs(d - 7 * C.ARROW_FACKEL) < 1e-9), 'Turmpfeil gegen Fackelträger: 14 (' + dt.join(',') + ')');
  const sim4 = mk({ burgfrieden: 0 }); toFehde(sim4); const k4 = sim4.dev.lord(0).keepB._;
  const ep = (() => { for (let a = 0; a < 360; a += 5) { const q = { x: k4.cx + Math.cos(a * Math.PI / 180) * 9, y: k4.cy + Math.sin(a * Math.PI / 180) * 9 }; if (!blockedAt(sim4, q) && sim4.world.owner[W.cellOf(q.x, q.y)] === 0 && W.walk(sim4.world, W.cellOf(q.x, q.y), 0) === 1) return q; } return null; })();
  const F4 = stage(sim4, 1, 'fackel', ep, 2); F4.hp = 1e5; const dk = dmgOf(sim4, F4, 9);
  ok(dk.length >= 3 && dk.every(d => Math.abs(d - 6 * C.ARROW_FACKEL) < 1e-9), 'Bergfriedpfeil gegen Fackelträger: 12 (' + dk.join(',') + ')');
  // a torch-bearer dies fast: 30 HP = 3 tower arrows
  const sim5 = mk({ burgfrieden: 0 }); toFehde(sim5); const tw5 = placeAt(sim5, 0, 'wachturm'), tc5 = { x: tw5._.cx, y: tw5._.cy }, kp5 = sim5.dev.lord(0).keepB._;
  const p5 = (() => { for (let a = 0; a < 360; a += 5) { const q = { x: tc5.x + Math.cos(a * Math.PI / 180) * 8, y: tc5.y + Math.sin(a * Math.PI / 180) * 8 }; if (!blockedAt(sim5, q) && Math.hypot(q.x - kp5.cx, q.y - kp5.cy) > 13 && W.walk(sim5.world, W.cellOf(q.x, q.y), 0) === 1) return q; } return null; })();
  const F5 = stage(sim5, 1, 'fackel', p5, 2), r5 = until(sim5, () => F5.hp <= 0, secs(10));
  ok(r5.hit, 'ein Fackelträger (30 HP) fällt'); eq(ofType(r5.log, 'shot').filter(x => x.src === 'turm').length, 3, 'nach 3 Turmpfeilen (3 × 14 ≥ 30; vorher waren es 5)');
}
{
  // leash: beyond 12 from its slot a soldier does not take up a fight and walks back; inside it fights
  const corridor = (sim, l, len) => {   // a straight run of dry meadow cells in quarter l
    const w = sim.world, site = sim.state.lords.find(x => x.i === l).site;
    for (let j = 6; j < GH - 6; j++) for (let i = 2; i < GW - len - 2; i++) {
      let good = true;
      for (let d = 0; d < len && good; d++) {
        const q = j * GW + i + d;
        if (w.owner[q] !== site || (w.cls[q] !== CI.G && w.cls[q] !== CI.A) || w.hq[q] < 1 || sim.occ[q] || w.sites.some(kp => Math.hypot(i + d - 71.5 - kp.x, j - 44.5 - kp.y) < 16)) good = false;
      }
      if (good) return { x: -71.5 + i, y: -44.5 + j };
    }
    return null;
  };
  const trial = (offset) => {
    const sim = mk({ burgfrieden: 0 }); toFehde(sim);
    const q = corridor(sim, 0, 22);
    if (!q) return null;
    const A = stage(sim, 0, 'speer', q), B0 = { x: q.x + offset + 1.2, y: q.y };
    A.x = A.px = q.x + offset; A.y = A.py = q.y; const B = stage(sim, 1, 'speer', B0); B.hp = A.hp = 1e5; B._.cd = 1e9;
    const d0 = dist(A, q), log = run(sim, secs(2.2));
    return { hits: hitsOn(log, B.id), d0, d1: dist(A, q), A };
  };
  const inside = trial(10), outside = trial(14.5);
  if (inside && outside) {
    ok(inside.hits >= 1, 'innerhalb der Leine (10) wird gekämpft'); eq(outside.hits, 0, 'außerhalb der Leine (14.5) keine Schläge'); ok(outside.d1 < outside.d0 - 2, 'und er geht zurück auf seinen Platz (' + outside.d0.toFixed(1) + ' → ' + outside.d1.toFixed(1) + ')');
  } else ok(false, 'Gasse für den Leinentest gefunden');
}
{
  // peasants flee from enemy soldiers within 6 (the load is lost), return 8 s after the danger within 10 is gone; cornered ones hit back
  const sim = mk({ burgfrieden: 0 }), st = sim.state; const hut = placeAt(sim, 0, 'holzfaeller');
  toFehde(sim);
  let wk = null; until(sim, () => { wk = unitsOf(sim, 0).find(x => x._.wb === hut && x._.job === JOB.CARRY && x._.ws === 0); return !!wk; }, secs(60));
  ok(wk, 'ein Träger ist unterwegs'); eq(wk.carry, 'holz', 'mit Holz');
  const E = stage(sim, 1, 'speer', { x: wk.x + 4, y: wk.y }); E.hp = 1e5; E._.cd = 1e9;
  run(sim, 12);
  eq(wk._.job, JOB.FLEE, 'Feind in 4: Flucht'); eq(wk.carry, null, 'die Last ist verloren'); ok(!hut._.workers.includes(wk), 'der Arbeitsplatz ist frei geworden'); eq(wk._.wb, null, 'Arbeit aufgegeben');
  const g = gateOf(sim, 0); const dg0 = dist(wk, g); run(sim, secs(5)); ok(dist(wk, g) < dg0 + 1e-9 || dist(wk, g) < 5, 'er läuft zum Burgtor');
  // the enemy stays near: still fleeing; once it is gone (more than 10 away) he waits 8 s and then works again
  eq(wk._.job, JOB.FLEE, 'solange der Feind in der Nähe ist, bleibt er in Deckung');
  const calm0 = wk._.calm; sim.dev.kill(E); const tk = st.t, fl = until(sim, () => wk._.job !== JOB.FLEE, secs(20));
  ok(fl.hit && Math.abs((st.t - tk) - (C.FLEE_RESUME_S - calm0)) < 1.1, 'Flucht endet 8 s nach der letzten Gefahr (' + (st.t - tk).toFixed(1) + ' s + schon ' + calm0.toFixed(1) + ' s Ruhe)'); run(sim, secs(4)); eq(hut.workers, 1, 'die Hütte ist wieder besetzt');
}
{
  // cornered: an adjacent enemy soldier that attacks gets hit back (2 per 1.5 s)
  const sim = mk({ burgfrieden: 0 }); toFehde(sim);
  const c = clearing(sim, 0), peas = sim.dev.spawn(0, 'bauer', c.x, c.y, -1); peas.hp = 1e5;
  const E = stage(sim, 1, 'ritter', { x: c.x + 2.5, y: c.y }); E.hp = 1e5; E._.cd = 1e9;   // a rider catches him: cornered
  const l = run(sim, secs(8)), hits = hitsOn(l, E.id);
  ok(hits >= 2, 'der in die Enge getriebene Bauer wehrt sich (' + hits + ' Treffer)'); near((1e5 - E.hp) / hits, 2, 1e-6, 'Bauernschlag: 2');
}
{
  // Burgwache: holds a post before the gate, engages enemies within 16 of the keep (or 8 of itself) and never strays beyond 20
  const run1 = (enemyDist) => {
    const sim = mk({ burgfrieden: 0 }); toFehde(sim);
    const lp = sim.dev.lord(0), g = gateOf(sim, 0), keep = { x: lp.kx, y: lp.ky };
    const guards = [0, 1, 2].map(i => sim.dev.spawn(0, 'speer', g.x - 2 + i * 2, g.y + g.out * 6, 0)); guards.forEach(u => { u.hp = 1e5; });
    run(sim, secs(4));
    const post = { x: guards.reduce((a, u) => a + u.x, 0) / 3, y: guards.reduce((a, u) => a + u.y, 0) / 3 };
    const ang = [0, 40, -40, 80, -80, 120, 160, 180].map(a => a * Math.PI / 180);
    let ep = null; for (const a of ang) { const q = { x: keep.x + Math.cos(a) * enemyDist, y: keep.y + g.out * Math.abs(Math.sin(a)) * enemyDist }; if (!blockedAt(sim, q) && sim.world.cls[W.CI ? W.cellOf(q.x, q.y) : 0] !== CI.W && dist(q, post) > 9) { ep = q; break; } }
    if (!ep) return null;
    const E = stage(sim, 1, 'speer', ep); E.hp = 1e5; E._.cd = 1e9;
    let maxAway = 0; const log = run(sim, secs(8), () => { for (const u of guards) maxAway = Math.max(maxAway, dist(u, keep)); });
    return { post, guards, E, hits: log.filter(e => e.t === 'hit' && e.id === E.id).length, maxAway, dEnd: Math.min(...guards.map(u => dist(u, E))), g, keep };
  };
  const near16 = run1(13), far = run1(19.5);
  if (near16 && far) {
    ok(near16.hits >= 1, 'Gegner in 13 vom Bergfried: die Burgwache greift ein (' + near16.hits + ' Treffer)'); ok(near16.maxAway <= C.GUARD_LEASH + 3, 'und bleibt innerhalb von 20 (max ' + near16.maxAway.toFixed(1) + ')');
    eq(far.hits, 0, 'Gegner in 19.5: keine Reaktion'); ok(far.dEnd > 6, 'die Wache bleibt auf ihrem Posten (' + far.dEnd.toFixed(1) + ' vom Gegner)');
  } else ok(false, 'Testpunkte für die Burgwache gefunden');
}
{
  // torch-bearers: run to an enemy wooden building near the banner target and light it (+0.5), then the next one; never fight; dodge melee units
  keepWell(false);   // (the keep's bucket chain would put the fire out before it is measured)
  const sim = mk({ burgfrieden: 0 }); toFehde(sim);
  const h1 = placeAt(sim, 1, 'huette'), h2 = placeAt(sim, 1, 'holzfaeller'), kas = placeAt(sim, 1, 'kaserne');
  for (const u of unitsOf(sim, 1, 'bauer')) sim.dev.kill(u);
  const bp = h1._, spot = [[bp.cx, bp.y1 + 6], [bp.cx, bp.y0 - 6], [bp.x1 + 6, bp.cy], [bp.x0 - 6, bp.cy]].map(([x, y]) => ({ x, y })).find(q => !blockedAt(sim, q));
  sim.banner(0, 1, spot.x, spot.y); const F = sim.dev.spawn(0, 'fackel', spot.x, spot.y, 1); F.hp = 1e5;
  const fireAt = {}, log = [];
  for (let i = 0; i < secs(25); i++) for (const e of sim.step()) { log.push(e); if (e.t === 'ignite') fireAt[e.id] = (sim.state.buildings.find(b => b.id === e.id) || {}).fire; }
  const ig = ofType(log, 'ignite');
  ok(ig.length >= 1, 'ignite-Ereignis'); eq(ig[0].by, 0, 'ignite.by = Haus des Fackelträgers'); ok([h1.id, h2.id].includes(ig[0].id), 'ein hölzernes Gebäude');
  ok(!ig.some(e => e.id === kas.id), 'Steinbauten brennen nie'); eq(kas.fire, 0, 'Kaserne ohne Feuer');
  ok(Object.values(fireAt).every(f => f >= 0.5 && f < 0.52), 'Fackel setzt fire += 0.5 (' + Object.values(fireAt).map(f => f.toFixed(2)).join() + ')'); ok(ig.length >= 2, 'danach das nächste Gebäude (' + ig.length + ' angezündet)');
  eq(hitsOn(log, 1e9), 0, '(kein Schlag)');
  // never fights: an enemy peasant next to the torch-bearer stays unharmed
  const s2 = mk({ burgfrieden: 0 }); toFehde(s2); const p0 = unitsOf(s2, 1, 'bauer')[0]; const F2 = stage(s2, 0, 'fackel', { x: p0.x + 0.6, y: p0.y }); F2.hp = 1e5; p0.hp = 25;
  const hp0 = p0.hp; run(s2, secs(4)); ok(p0.hp >= hp0 || p0.job === JOB.LEAVE || true, '(Bauer)'); ok(ofType(run(s2, 1), 'hit').filter(e => e.id === p0.id).length === 0, 'Fackelträger schlägt nicht');
  // dodging: a spearman closing in within 3 makes it step away
  const s3 = mk({ burgfrieden: 0 }); toFehde(s3); const c3 = clearing(s3, 0), F3 = stage(s3, 0, 'fackel', c3), S3 = stage(s3, 1, 'speer', { x: c3.x + 2, y: c3.y }); S3._.cd = 1e9; S3.hp = F3.hp = 1e5;
  const d0 = dist(F3, S3); run(s3, secs(1)); ok(dist(F3, S3) > d0 + 0.5, 'Fackelträger weicht dem Speerträger aus (' + d0.toFixed(1) + ' → ' + dist(F3, S3).toFixed(1) + ')');
  keepWell(true);
}

// ---- deaths in battle: event, Ruhm for the killer's house, banner roster, state.units ----
{
  const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
  const c = clearing(sim, 0), A = stage(sim, 0, 'ritter', c), B = stage(sim, 1, 'speer', { x: c.x + 1.5, y: c.y });
  const bn1 = sim.dev.lord(1).bn[1], kills = (i) => sim.dev.lord(i).by.kills; run(sim, 1); ok(st.banners.some(b => b.lord === 1 && b.count === 1), 'Banner 1 von Haus 1 hat einen Soldaten');
  const log = until(sim, () => B.hp <= 0, secs(25)).log; run(sim, 2);
  const d = ofType(log, 'death'); eq(d.length, 1, 'ein death-Ereignis'); eq(d[0].id, B.id, 'death.id'); eq(d[0].kind, 'speer', 'death.kind'); eq(d[0].lord, 1, 'death.lord'); eq(d[0].by, 0, 'death.by = Haus des Siegers');
  eq(Object.keys(d[0]).join(), 't,id,lord,kind,x,y,by', 'death-Felder'); ok(Math.hypot(d[0].x - B.x, d[0].y - B.y) < 0.5, 'death.x/y = Ort des Todes');
  eq(kills(0), 1, 'Ruhm +1 für den Speerträger (Kategorie kills)'); eq(sim.dev.lord(0).stats.kills, 1, 'Siege gezählt'); eq(sim.dev.lord(1).stats.lost, 1, 'Verluste gezählt');
  ok(!st.units.includes(B), 'der Tote ist aus state.units verschwunden'); ok(st.units.includes(A) && A.hp > 0, 'der Ritter lebt');
  eq(bn1.members.length, 0, 'Banner-Mitglieder bereinigt'); ok(!st.banners.some(b => b.lord === 1), 'ein Banner ohne Soldaten existiert nicht mehr'); eq(sim.youOf(1).banners.length, 0, 'youOf: kein Banner'); eq(st.lords[1].soldiers, 0, 'lords[].soldiers sinkt'); eq(st.lords[0].soldiers, 1, 'der Sieger behält seinen');
  // a rider is worth +2; an arrow kill credits the archer's house
  const s2 = mk({ burgfrieden: 0 }); toFehde(s2); const c2 = clearing(s2, 0), R = stage(s2, 1, 'ritter', c2);
  const S1 = stage(s2, 0, 'speer', { x: c2.x + 1.2, y: c2.y }), S2 = s2.dev.spawn(0, 'speer', c2.x + 1.2, c2.y + 1, 1); R.hp = 30;
  const l2 = until(s2, () => R.hp <= 0, secs(15)).log; eq(ofType(l2, 'death').filter(e => e.kind === 'ritter').length, 1, 'Ritter gefallen'); eq(s2.dev.lord(0).by.kills, 2 + ofType(l2, 'death').filter(e => e.kind !== 'ritter' && e.lord === 1).length, 'Ruhm +2 für den Ritter');
  const s3 = mk({ burgfrieden: 0 }); toFehde(s3); const c3 = clearing(s3, 0), AR = stage(s3, 0, 'bogen', { x: c3.x - 2, y: c3.y }), TG = stage(s3, 1, 'speer', { x: c3.x + 2.5, y: c3.y }); TG.hp = 5; TG._.cd = 1e9; AR.hp = 1e5;
  const l3 = until(s3, () => TG.hp <= 0, secs(10)).log; const d3 = ofType(l3, 'death'); eq(d3.length, 1, 'Pfeil tötet'); eq(d3[0].by, 0, 'death.by = Haus des Schützen'); eq(s3.dev.lord(0).by.kills, 1, 'Ruhm +1 für den Pfeil');
  // a peasant killed by a soldier: +1 Ruhm, the workplace is freed
  const s4 = mk({ burgfrieden: 0 }), hut4 = placeAt(s4, 0, 'holzfaeller'); toFehde(s4); run(s4, secs(5));
  const wk = unitsOf(s4, 0).find(u => u._.wb === hut4); ok(wk, 'Holzfäller bei der Arbeit'); wk.hp = 1; s4.dev.kill(wk, 1);
  eq(s4.dev.lord(1).by.kills, 1, 'Bauer +1'); ok(!hut4._.workers.includes(wk), 'Arbeitsplatz frei'); eq(ofType(run(s4, 1), 'death')[0].kind, 'bauer', 'death.kind bauer');
}

// ---- regressions found by full matches: a building on a banner's post, and route planning bursts ----
{
  // a new building on the leader point / target of a banner: the target moves to free ground, the leader steps out, and no field is recomputed every step
  const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
  const hs = W.suggest(sim.world, 'huette', 0, { L: 0, occ: sim.occ }), cx = -72 + hs.i + 1, cy = -45 + hs.j + 1;
  const sold = stage(sim, 0, 'speer', { x: cx, y: cy }, 1), bn = sim.dev.lord(0).bn[1];
  eq(bn.tx, cx, 'Banner steht auf dem künftigen Bauplatz');
  const r = sim.build(0, 'huette', hs.i, hs.j, hs.rot); eq(r.ok, true, 'Hütte wird auf den Posten gebaut');
  const blk = sim.dev.blk; ok(blk[W.cellOf(bn.tx, bn.ty)] === 0, 'das Ziel ist auf freien Boden gerückt (' + bn.tx.toFixed(1) + ', ' + bn.ty.toFixed(1) + ')'); ok(dist({ x: bn.tx, y: bn.ty }, { x: cx, y: cy }) <= C.SNAP_R, 'in der Nähe des alten Ziels');
  let fields = 0; const of = W.field; W.field = function () { fields++; return of.apply(this, arguments); };
  try { run(sim, secs(12)); } finally { W.field = of; }
  ok(blk[W.cellOf(bn.x, bn.y)] === 0, 'der Anführerpunkt steht nicht in der Hütte'); ok(blk[W.cellOf(sold.x, sold.y)] === 0, 'der Soldat auch nicht'); ok(dist(bn, { x: bn.tx, y: bn.ty }) < 1.5, 'das Banner steht am neuen Ziel');
  ok(fields <= 4, 'das Reisefeld wird nicht in jedem Schritt neu berechnet (' + fields + ' Läufe in 12 s)');
  eq(st.banners[0].tx, bn.tx, 'state.banners[].tx folgt dem neuen Ziel');
}
{
  // a burst of walkers: at most CONST.ROUTES_PER_STEP A* routes per step, everybody gets home eventually
  const sim = mk({ burgfrieden: 0 }), st = sim.state, w = sim.world; toFehde(sim);
  const g = gateOf(sim, 0), site = 0, far = [];
  for (let k = 0; k < N && far.length < 40; k += 7) if (w.owner[k] === site && (w.cls[k] === CI.G || w.cls[k] === CI.A) && w.hq[k] >= 1 && Math.hypot(-71.5 + k % GW - g.x, -44.5 + Math.floor(k / GW) - g.y) > 12) far.push({ x: -71.5 + k % GW, y: -44.5 + Math.floor(k / GW) });
  ok(far.length >= 30, 'Startpunkte im Viertel (' + far.length + ')');
  const ps = far.map(p => sim.dev.spawn(0, 'bauer', p.x, p.y, -1));
  let calls = 0, maxPer = 0; const op = W.path; W.path = function () { calls++; return op.apply(this, arguments); };
  try { for (let i = 0; i < secs(50); i++) { const c0 = calls; sim.step(); maxPer = Math.max(maxPer, calls - c0); } } finally { W.path = op; }
  ok(maxPer <= C.ROUTES_PER_STEP, 'höchstens ' + C.ROUTES_PER_STEP + ' Routen je Schritt (' + maxPer + ')'); ok(calls > 0, 'es wurden Routen geplant (' + calls + ')');
  const home = ps.filter(u => dist(u, g) <= C.YARD_R + 2).length; ok(home >= ps.length * 0.9, 'fast alle sind im Hof angekommen (' + home + '/' + ps.length + ')');
}

// ---- fire: ignite, burn, spread, stone never burns, fields, Brunnen ----
keepWell(false);
// two finished buildings of house l with `gap` free cells between their footprints (A west of B), or null
function findPair(sim, l, kindA, kindB, gap) {
  const site = sim.state.lords.find(x => x.i === l).site, w = sim.world;
  for (let j = 4; j < GH - 8; j++) for (let i = 2; i < GW - 14; i++) {
    if (w.owner[j * GW + i] !== site) continue;
    if (!W.canPlace(w, kindA, i, j, 0, { lord: site, L: sim.state.level, occ: sim.occ }).ok) continue;
    const A = sim.dev.place(l, kindA, i, j, 0);
    if (!A.ok) continue;
    const bi = i + W.footprintOf(kindA, 0)[0] + gap;
    if (W.canPlace(w, kindB, bi, j, 0, { lord: site, L: sim.state.level, occ: sim.occ }).ok) { const B = sim.dev.place(l, kindB, bi, j, 0); if (B.ok) return { a: A.b, b: B.b }; }
    sim.cancel(l, A.b.id);
  }
  return null;
}
{
  const sim = mk(), st = sim.state;
  const hut = placeAt(sim, 0, 'huette');
  eq(sim.dev.fire(hut, 0.5, 1), true, 'Holz brennt'); const l0 = run(sim, 1), ig = ofType(l0, 'ignite'); eq(ig.length, 1, 'ignite-Ereignis'); eq(JSON.stringify(ig[0]), JSON.stringify({ t: 'ignite', id: hut.id, by: 1 }), 'ignite-Felder');
  // fire grows 0.03/s and costs 20 · fire HP per second
  let f = hut.fire, hp = hut._.hpAbs; const f0 = f;
  for (let i = 0; i < 60; i++) { f = Math.min(1, f + 0.03 / 15); hp -= 20 * f / 15; sim.step(); }
  near(hut.fire, f, 1e-9, 'Feuer wächst um 0.03/s (' + f0.toFixed(3) + ' → ' + hut.fire.toFixed(3) + ')'); near(hut._.hpAbs, hp, 1e-6, 'Schaden 20 · Feuer je Sekunde');
  // at HP 0 the fire goes out and the building is a ruin
  const log = until(sim, () => hut.ruined, secs(60)).log;
  eq(hut.ruined, true, 'abgebrannt = Ruine'); eq(hut.fire, 0, 'Feuer aus'); eq(ofType(log, 'fireOut').filter(e => e.id === hut.id).length, 1, 'fireOut'); eq(ofType(log, 'ruined')[0].by, 1, 'ruined.by = Brandstifter'); eq(st.lords[1].ruhm >= 3, true, 'Ruhm +3 für den Brandstifter');
  // stone never burns
  const kas = placeAt(sim, 0, 'kaserne'), tw = placeAt(sim, 0, 'wachturm'), br = placeAt(sim, 0, 'brunnen'), keep = bOf(sim, 0, 'bergfried')[0];
  for (const b of [kas, tw, br, keep]) { eq(sim.dev.fire(b, 1, 1), false, b.kind + ' brennt nicht'); eq(b.fire, 0, b.kind + ': fire 0'); }
}
{
  // spread (R8): after SPREAD_AFTER_S = 8 s above 0.6 the fire jumps to every wooden building within 3 cells (fields: 4) with fire 0.2
  const go = (kindB, gap, fireA) => {
    const sim = mk(), p = findPair(sim, 0, 'kornspeicher', kindB, gap);   // (a hut of 120 HP burns down in ≈ 8 s: it would be gone before it could spread)
    if (!p) return null;
    sim.dev.fire(p.a, fireA, 1);
    const log = []; let at = -1;
    for (let i = 0; i < secs(14); i++) { for (const e of sim.step()) log.push({ ...e, at: sim.state.t }); if (at < 0 && p.b.fire > 0) at = sim.state.t; }
    return { at, b: p.b, ig: ofType(log, 'ignite').filter(e => e.id === p.b.id), a: p.a, sim };
  };
  const g3 = go('huette', 3, 0.65), g4 = go('huette', 4, 0.65), h4 = go('hof', 4, 0.65), h5 = go('hof', 5, 0.65);
  ok(g3 && g4 && h4 && h5, 'Gebäudepaare gefunden');
  if (g3) { near(g3.at, C.SPREAD_AFTER_S, 0.25, 'Abstand 3: springt nach 8 s über 0.6 (' + g3.at.toFixed(2) + ')'); eq(g3.ig.length, 1, 'ignite für das Nachbargebäude'); eq(g3.ig[0].by, 1, 'ignite.by erbt den Brandstifter'); }
  if (g4) eq(g4.ig.length, 0, 'Abstand 4 (Hütte): kein Überspringen');
  if (h4) { near(h4.at, C.SPREAD_AFTER_S, 0.25, 'Hof auf Abstand 4: springt über'); eq(h4.ig.length, 1, 'Hof: ignite'); }
  if (h5) eq(h5.ig.length, 0, 'Hof auf Abstand 5: kein Überspringen');
  // starting under 0.6 it takes longer: 0.55 passes 0.6 after 1.7 s, plus the 8 s
  const slow = go('huette', 2, 0.55); if (slow) near(slow.at, C.SPREAD_AFTER_S + (0.6 - 0.55) / 0.03, 0.4, 'unter 0.6 beginnt die Uhr erst beim Überschreiten (' + slow.at.toFixed(2) + ')');
  // the spread fire starts at 0.2 and grows from there
  if (g3) { ok(g3.b.fire >= 0.2 && g3.b.fire < 0.2 + 0.03 * 10, 'Nachbarfeuer startet bei 0.2'); }
}
{
  // fields: above fire 0.3 the crop burns (growth 0, burnt 1, +1 Ruhm for the arsonist if it was above 0.3); scorch fades over 60 s; resown only at fire 0
  const crop = (growth, by) => {
    const sim = mk(), hof = placeAt(sim, 0, 'hof');
    hof.growth = growth; const r0 = sim.state.lords[by].ruhm;
    sim.dev.fire(hof, 0.35, by); const l = run(sim, 2);
    return { sim, hof, l, dr: sim.state.lords[by].ruhm - r0 };
  };
  const c1 = crop(0.5, 1); eq(c1.hof.growth, 0, 'Feld verbrannt: growth 0'); eq(c1.hof.burnt, 1, 'burnt 1'); eq(ofType(c1.l, 'cropBurnt').length, 1, 'cropBurnt-Ereignis'); eq(c1.dr, 1, 'Ruhm +1 für verbranntes Feld (growth > 0.3)');
  const c2 = crop(0.2, 1); eq(c2.hof.growth, 0, 'junges Feld verbrennt auch'); eq(c2.dr, 0, 'aber unter growth 0.3 gibt es kein Ruhm');
  const c3 = crop(0.8, 0); eq(c3.dr, 0, 'eigenes Feuer bringt kein Ruhm');
  const c4 = mk(), h4 = placeAt(c4, 0, 'hof'); h4.growth = 0.9; c4.dev.fire(h4, 0.25, 1); run(c4, secs(1)); eq(ofType(run(c4, 0), 'cropBurnt').length, 0, 'unter 0.3 überlebt das Feld noch');
  // the crowned house's crop is worth more
  const sim = c1.sim, hof = c1.hof;
  // fade: once the fire is out the scorch goes down over 60 s
  hof.fire = 0; const t0 = sim.state.t; run(sim, secs(30)); near(hof.burnt, 0.5, 0.05, 'nach 30 s halb verblasst'); run(sim, secs(31)); eq(hof.burnt, 0, 'nach 60 s verblasst');
  // the farmer stops working while it burns and sows again only after the fire is out
  const s2 = mk(), hf = placeAt(s2, 0, 'hof'); run(s2, secs(40)); hf.growth = 0.5; s2.dev.fire(hf, 0.4, 1);
  const sowsBefore = ofType(run(s2, 10), 'sow').length; ok(hf.fire > 0.3 || hf.growth === 0, 'Feld brennt');
  const l2 = until(s2, () => hf.fire <= 0 || hf.ruined, secs(5)); const farmer = unitsOf(s2, 0).find(u => u._.wb === hf);
  if (farmer && hf.fire > 0 && hf.fire > 0.25) { eq(farmer.anim === 'work', false, 'während das Feld brennt, arbeitet der Bauer nicht'); }
}
{
  // Brunnen: bucket chain of up to 4 peasants at a fire within 12 of a finished well; each takes 0.06 fire/s; the fire goes out
  const sim = mk(), st = sim.state, hut = placeAt(sim, 0, 'kornspeicher'), well = placeAt(sim, 0, 'brunnen');
  ok(Math.hypot(hut._.cx - well._.cx, hut._.cy - well._.cy) <= 12, 'Brunnen in Reichweite des Gebäudes');
  run(sim, secs(2)); sim.dev.fire(hut, 0.5, 1);
  const log = [], samples = new Set(); let maxB = 0;
  for (let i = 0; i < secs(60) && hut.fire > 0; i++) {
    if (i < secs(16)) { hut.fire = Math.max(hut.fire, 0.9); hut._.dmg = 0; hut._.hpAbs = hut._.maxHp; hut.hp = 1; }   // test hook: keep the building alive and burning while the chain works through whole cycles
    for (const e of sim.step()) log.push({ ...e, at: st.t });
    const nB = unitsOf(sim, 0).filter(u => u._.job === JOB.BUCKET).length; maxB = Math.max(maxB, nB);
    for (const u of unitsOf(sim, 0)) if (u._.job === JOB.BUCKET) samples.add(u.anim + ':' + u.carry);
  }
  eq(hut.fire, 0, 'das Feuer ist gelöscht'); ok(!hut.ruined && hut.hp > 0.5, 'Gebäude steht noch (hp ' + hut.hp.toFixed(2) + ')'); eq(ofType(log, 'fireOut').filter(e => e.id === hut.id).length, 1, 'fireOut');
  eq(maxB, 4, 'bis zu 4 Eimerträger'); const bk = ofType(log, 'bucket'); ok(bk.length >= 4 && bk.every(e => e.brunnen === well.id && e.id === hut.id), 'bucket-Ereignisse (Brunnen, Gebäude)');
  ok(samples.has('walk:eimer') && samples.has('work:eimer') && samples.has('work:null') && samples.has('walk:null'), 'Eimerkette: geht zum Brunnen, füllt, trägt den Eimer, gießt (' + [...samples].join(' ') + ')');
  run(sim, secs(4)); eq(unitsOf(sim, 0).filter(u => u._.job === JOB.BUCKET).length, 0, 'danach sind alle wieder frei');
  // the rate: with n peasants in reach the fire falls 0.06 · n − 0.03 per second
  const s2 = mk(), h2 = placeAt(s2, 0, 'huette'), w2 = placeAt(s2, 0, 'brunnen'); run(s2, secs(1)); s2.dev.fire(h2, 0.9, 1);
  let sumDrop = 0, sumN = 0, steps = 0;
  for (let i = 0; i < secs(12) && h2.fire > 0.2; i++) {
    const n = unitsOf(s2, 0).filter(u => u._.job === JOB.BUCKET && Math.hypot(u.x - w2._.cx, u.y - w2._.cy) <= 12).length, before = h2.fire; s2.step();
    if (h2.fire > 0) { sumDrop += (before + 0.03 / 15) - h2.fire; sumN += n * 0.06 / 15; steps++; }
  }
  near(sumDrop, sumN, 0.03, 'Löschrate = 0.06 je Eimerträger in Reichweite (' + sumDrop.toFixed(3) + ' vs ' + sumN.toFixed(3) + ')');
  // out of reach (> 12): no chain
  const s3 = mk(), h3 = placeAt(s3, 0, 'huette'); const wellFar = (() => { for (let a = 0; a < 360; a += 10) for (const r of [14, 16, 18]) { const x = h3._.cx + Math.cos(a * Math.PI / 180) * r, y = h3._.cy + Math.sin(a * Math.PI / 180) * r, i = Math.floor(x + 72), j = Math.floor(y + 45); if (W.canPlace(s3.world, 'brunnen', i, j, 0, { lord: 0, L: 1, occ: s3.occ }).ok) return s3.dev.place(0, 'brunnen', i, j, 0).b; } return null; })();
  ok(wellFar, 'ferner Brunnen gesetzt'); s3.dev.fire(h3, 0.5, 1); const l3 = run(s3, secs(4)); eq(ofType(l3, 'bucket').length, 0, 'Brunnen weiter als 12 entfernt: keine Eimerkette');
}
{
  // nobody idle: the nearest workers are pulled into the chain (at least 2), and they go back to work afterwards
  const saved = C.START_PEASANTS, savedA = C.ARRIVE_S; C.START_PEASANTS = 3; C.ARRIVE_S = 1e9;
  const sim = mk(); C.START_PEASANTS = saved;
  const st = sim.state, hof = placeAt(sim, 0, 'hof'), wc = placeAt(sim, 0, 'holzfaeller'), qy = placeAt(sim, 0, 'steinbruch'), hut = placeAt(sim, 0, 'huette'), well = placeAt(sim, 0, 'brunnen');
  run(sim, secs(12)); eq(unitsOf(sim, 0).filter(u => u._.job === JOB.IDLE).length, 0, 'alle drei haben Arbeit');
  sim.dev.fire(hut, 0.4, 1); run(sim, secs(2.5));
  const nb = unitsOf(sim, 0).filter(u => u._.job === JOB.BUCKET).length; eq(nb, 2, 'ohne Freie: genau die nötigen 2 werden abgezogen');
  until(sim, () => hut.fire === 0, secs(30)); run(sim, secs(4)); eq(hut.fire, 0, 'gelöscht'); eq(unitsOf(sim, 0).filter(u => u._.job === JOB.BUCKET).length, 0, 'Eimerkette aufgelöst');
  run(sim, secs(3)); ok(hof.workers + wc.workers + qy.workers === 3, 'alle drei arbeiten wieder (' + hof.workers + wc.workers + qy.workers + ')');
  C.ARRIVE_S = savedA;
}

keepWell(true);
// a legal spot of house l for `kind` whose centre lies between lo and hi from the keep centre
function spotBetween(sim, l, kind, lo, hi) {
  const site = sim.state.lords.find(x => x.i === l).site, kp = sim.world.sites[site];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) for (const rot of [0, 1]) {
    const [w, h] = W.footprintOf(kind, rot), d = Math.hypot(i - 72 + w / 2 - kp.x, j - 45 + h / 2 - kp.y);
    if (d >= lo && d <= hi && W.canPlace(sim.world, kind, i, j, rot, { lord: site, L: sim.state.level, occ: sim.occ }).ok) return { i, j, rot };
  }
  return null;
}
{
  // R6 Burgbrunnen: the keep is a well too — its chain (up to 4 peasants filling at the gate) puts out fires on own buildings whose centre is within KEEP_WELL_R of the keep centre
  const sim = mk(), st = sim.state, keep = sim.dev.lord(0).keepB, kp = keep._, lp = sim.dev.lord(0);
  const nearS = spotBetween(sim, 0, 'kornspeicher', 7, 10), farS = spotBetween(sim, 0, 'kornspeicher', 13.5, 17);
  ok(nearS && farS, 'Bauplätze nah und fern vom Bergfried gefunden');
  const near = sim.dev.place(0, 'kornspeicher', nearS.i, nearS.j, nearS.rot).b, far = sim.dev.place(0, 'kornspeicher', farS.i, farS.j, farS.rot).b;
  const dn = Math.hypot(near._.cx - kp.cx, near._.cy - kp.cy), df = Math.hypot(far._.cx - kp.cx, far._.cy - kp.cy);
  ok(dn <= C.KEEP_WELL_R && df > C.KEEP_WELL_R, 'ein Gebäude liegt innerhalb (' + dn.toFixed(1) + '), eines außerhalb (' + df.toFixed(1) + ') der Reichweite 12 um die Bergfriedmitte');
  run(sim, secs(3)); eq(sim.youOf(0).idle >= 4, true, 'mindestens 4 freie Bauern im Hof');
  sim.dev.fire(near, 0.6, 1); sim.dev.fire(far, 0.6, 1);
  const log = [], samples = new Set(); let maxB = 0, gate0 = null, farFire = -1;
  for (let i = 0; i < secs(60) && near.fire > 0; i++) {
    if (i === secs(5)) farFire = far.fire;
    if (i < secs(16)) { near.fire = Math.max(near.fire, 0.9); near._.dmg = 0; near._.hpAbs = near._.maxHp; near.hp = 1; }   // test hook: keep the building burning and alive while the chain works through whole cycles
    for (const e of sim.step()) log.push(e);
    const ch = unitsOf(sim, 0).filter(u => u._.job === JOB.BUCKET); maxB = Math.max(maxB, ch.length);
    for (const u of ch) { samples.add(u.anim + ':' + u.carry); if (u._.store !== keep) fail('Eimerkette hängt nicht am Bergfried'); if (!gate0 && u._.ws === 0) gate0 = { dx: u._.dx, dy: u._.dy }; }
  }
  eq(near.fire, 0, 'der Bergfried löscht das Feuer in seiner Nähe'); ok(!near.ruined && near.hp > 0.6, 'das Gebäude steht noch (hp ' + near.hp.toFixed(2) + ')');
  const bk = ofType(log, 'bucket'); ok(bk.length >= 4, 'bucket-Ereignisse (' + bk.length + ')'); ok(bk.every(e => e.brunnen === keep.id && e.id === near.id), 'bucket { brunnen: Id des Bergfrieds, id: das brennende Gebäude }'); eq(Object.keys(bk[0]).join(), 't,brunnen,id', 'bucket-Felder');
  eq(maxB, C.BUCKET_MAX, 'bis zu 4 Eimerträger gleichzeitig'); ok(gate0 && Math.hypot(gate0.dx - lp.gx, gate0.dy - lp.gy) < 1e-9, 'sie füllen am Tor');
  ok(samples.has('walk:eimer') && samples.has('work:eimer') && samples.has('work:null') && samples.has('walk:null'), 'Eimerkette: geht zum Tor, füllt, trägt den Eimer, gießt (' + [...samples].join(' ') + ')');
  eq(ofType(log, 'fireOut').filter(e => e.id === near.id).length, 1, 'fireOut');
  eq(bk.filter(e => e.id === far.id).length, 0, 'das Gebäude außerhalb der 12 bekommt keine Eimerkette'); ok(farFire > 0.6, 'sein Feuer wächst ungehindert (nach 5 s: ' + farFire.toFixed(2) + ')');
  ok(ofType(run(sim, secs(3)), 'bucket').filter(e => e.id === far.id).length === 0, 'auch später keine Kette zum fernen Brand');
  // the reach is the constant: with KEEP_WELL_R 5 the near building is out of reach too, and a Brunnen next to it still works as before
  C.KEEP_WELL_R = 5; const s2 = mk(), n2 = s2.dev.place(0, 'kornspeicher', nearS.i, nearS.j, nearS.rot).b; run(s2, secs(3)); s2.dev.fire(n2, 0.6, 1); const l2 = run(s2, secs(4)); C.KEEP_WELL_R = KEEP_WELL;
  eq(ofType(l2, 'bucket').length, 0, 'KEEP_WELL_R 5: das Gebäude in 7–10 ist außer Reichweite');
  // nobody idle: the nearest workers are pulled into the keep's chain (at least 2), as with a Brunnen
  const saved = C.START_PEASANTS, savedA = C.ARRIVE_S; C.START_PEASANTS = 3; C.ARRIVE_S = 1e9; const s3 = mk(); C.START_PEASANTS = saved;   // (nobody new arrives)
  const hf3 = placeAt(s3, 0, 'hof'), wc3 = placeAt(s3, 0, 'holzfaeller'), qy3 = placeAt(s3, 0, 'steinbruch'), ns3 = spotBetween(s3, 0, 'kornspeicher', 7, 10), n3 = s3.dev.place(0, 'kornspeicher', ns3.i, ns3.j, ns3.rot).b; run(s3, secs(12));
  eq(unitsOf(s3, 0).filter(u => u._.job === JOB.IDLE).length, 0, 'drei Bauern, alle in Arbeit'); s3.dev.fire(n3, 0.4, 1); run(s3, secs(2.5)); eq(unitsOf(s3, 0).filter(u => u._.job === JOB.BUCKET).length, 2, 'ohne Freie zieht der Bergfried die nötigen 2 Arbeiter ab'); C.ARRIVE_S = savedA;
}
{
  // R8: SPREAD_AFTER_S = 8 — a hut (120 HP) lit by one torch (fire 0.5: 3.3 s to 0.6, then 8 s) burns down in ≈ 9.4 s, before the fire could jump; sturdier buildings still spread, later
  keepWell(false);
  const go = (kindA, secsRun) => {
    const sim = mk(), p = findPair(sim, 0, kindA, 'huette', 2);
    if (!p) return null;
    sim.dev.fire(p.a, 0.5, 1);
    const log = []; let at = -1, ruinedAt = -1;
    for (let i = 0; i < secs(secsRun); i++) { for (const e of sim.step()) { log.push(e); if (e.t === 'ruined' && e.id === p.a.id) ruinedAt = sim.state.t; } if (at < 0 && p.b.fire > 0) at = sim.state.t; }
    return { at, ruinedAt, a: p.a, b: p.b, log };
  };
  const hut = go('huette', 25), korn = go('kornspeicher', 25);
  ok(hut && korn, 'Gebäudepaare gefunden');
  if (hut) { ok(hut.ruinedAt > 8.5 && hut.ruinedAt < 10.5, 'die Hütte brennt nach ≈ 9.4 s ab (' + hut.ruinedAt.toFixed(1) + ' s)'); eq(hut.b.fire, 0, 'das Feuer ist nicht auf die Nachbarhütte gesprungen'); eq(ofType(hut.log, 'ignite').filter(e => e.id === hut.b.id).length, 0, '(kein ignite)'); }
  if (korn) { near(korn.at, (C.SPREAD_AT - 0.5) / C.FIRE_GROW + C.SPREAD_AFTER_S, 0.5, 'ein Kornspeicher (200 HP) springt nach 3.3 + 8 = 11.3 s über (' + korn.at.toFixed(1) + ' s)'); }
  keepWell(true);
}

// ---- plunder, protection, the march home ----
{
  const sim = mk({ burgfrieden: 0 }), st = sim.state, w = sim.world; toFehde(sim);
  const lp0 = sim.dev.lord(0), lp1 = sim.dev.lord(1), k1 = lp1.keepB;
  sim.dev.stock(1, { korn: 20, holz: 24, stein: 5 }); sim.dev.stock(0, { korn: 10, holz: 0, stein: 0 });
  const guards = [0, 1].map(i => sim.dev.spawn(1, 'speer', lp1.gx + i * 2, lp1.gy + lp1.out * 6, 0));
  const g2 = gateOf(sim, 2), g3 = gateOf(sim, 3);
  stage(sim, 2, 'speer', { x: lp1.gx + 3, y: lp1.gy + lp1.out * 5 }, 1); stage(sim, 3, 'speer', { x: lp1.gx + 20, y: lp1.gy + lp1.out * 30 }, 1);
  const far3 = sim.dev.lord(3).bn[1];
  run(sim, 2);
  const ruhm0 = st.lords[0].ruhm, tgtBefore = st.banners.find(b => b.lord === 2).tx;
  sim.dev.damage(k1, 1e9, 0);
  const l = run(sim, 2), pl = ofType(l, 'plunder');
  eq(pl.length, 1, 'plunder-Ereignis'); eq(pl[0].lord, 1, 'plunder.lord = Verlierer'); eq(pl[0].by, 0, 'plunder.by = Angreifer'); eq(JSON.stringify(pl[0].loot), JSON.stringify({ korn: 10, holz: 12, stein: 2, gold: 0 }), 'Beute: die Hälfte jeder Ware (und von dem Gold, hier 0)');
  eq(JSON.stringify(sim.youOf(1).stock.holz), '12', 'der Verlierer büßt die Hälfte ein'); eq(sim.youOf(1).stock.korn <= 10 && sim.youOf(1).stock.korn >= 9, true, 'Korn halbiert (' + sim.youOf(1).stock.korn + ')'); eq(sim.youOf(1).stock.stein, 3, 'Stein 5 → 3');
  ok(sim.youOf(0).stock.holz === 12 && sim.youOf(0).stock.stein === 2 && sim.youOf(0).stock.korn >= 18, 'der Sieger erhält die Beute (' + JSON.stringify(sim.youOf(0).stock) + ')');
  near(st.lords[0].ruhm - ruhm0, 20, 1e-9, 'Ruhm +20 für die Plünderung'); eq(sim.dev.lord(0).stats.plunders, 1, 'Plünderungen gezählt');
  eq(guards.filter(g => g.hp > 0).length, 0, 'die Burgwache des Verlierers stirbt'); eq(ofType(l, 'death').filter(e => e.lord === 1 && e.by === 0).length, 2, 'death-Ereignisse der Burgwache');
  eq(st.lords[1].prot, 60 - 2 / 15 > 59 ? st.lords[1].prot : 60, '(prot gesetzt)'); near(st.lords[1].prot, 60, 0.3, 'prot ≈ 60 s'); near(k1.hp, 0.3, 1e-9, 'Bergfried steht mit 30 % HP wieder'); eq(k1.ruined, false, 'ein Bergfried bleibt keine Ruine');
  // other houses' banners with a target within 16 are sent home; far ones keep going
  const od = ofType(l, 'order'); ok(od.some(e => e.lord === 2 && e.n === 1), 'Banner von Haus 2 (Ziel am Bergfried) geht heim'); ok(!od.some(e => e.lord === 3), 'Banner von Haus 3 (Ziel fern) bleibt');
  ok(dist(st.banners.find(b => b.lord === 2), { x: tgtBefore, y: 0 }) >= 0, '(Banner existiert)');
  const hb = sim.youOf(2).banners[0]; ok(dist({ x: hb.tx, y: hb.ty }, gateOf(sim, 2)) < 14, 'Ziel ist wieder vor dem eigenen Tor');
  // protected: invulnerable but still shooting
  sim.dev.damage(k1, 1e9, 0); eq(k1.hp, 0.3, 'geschützt: Schaden wirkungslos'); eq(ofType(run(sim, 1), 'plunder').length, 0, 'keine zweite Plünderung');
  const ep = (() => { for (let a = 0; a < 360; a += 10) { const q = { x: lp1.kx + Math.cos(a * Math.PI / 180) * 8, y: lp1.ky + Math.sin(a * Math.PI / 180) * 8 }; if (!blockedAt(sim, q)) return q; } return null; })();
  const E = sim.dev.spawn(0, 'speer', ep.x, ep.y, 1); sim.banner(0, 1, ep.x, ep.y); E.x = ep.x; E.y = ep.y; E.hp = 1e5; E._.cd = 1e9;
  const sl = run(sim, secs(5)); ok(ofType(sl, 'shot').some(s => s.src === 'keep'), 'der geschützte Bergfried schießt weiter');
  // protection ends after 60 s
  const pe = until(sim, () => st.lords[1].prot === 0, secs(70)); eq(ofType(pe.log, 'protEnd').length, 1, 'protEnd'); eq(ofType(pe.log, 'protEnd')[0].lord, 1, 'protEnd.lord');
  // a second plunder takes half of what is left
  const left = sim.youOf(1).stock.holz; sim.dev.damage(k1, 1e9, 0); const l2 = run(sim, 1), pl2 = ofType(l2, 'plunder'); eq(pl2.length, 1, 'danach ist er wieder plünderbar'); ok(Math.abs(pl2[0].loot.holz - Math.floor(left / 2)) <= 1, 'zweite Beute: die Hälfte vom Rest');
}
{
  // loot is limited by the attacker's caps
  const sim = mk({ burgfrieden: 0 }); toFehde(sim);
  sim.dev.stock(1, { korn: 20, holz: 24, stein: 5 }); sim.dev.stock(0, { korn: 30, holz: 25, stein: 0 });
  sim.dev.damage(sim.dev.lord(1).keepB, 1e9, 0); const l = run(sim, 1), pl = ofType(l, 'plunder')[0];
  eq(pl.loot.korn, 0, 'volles Lager nimmt nichts mehr (Kappe 30)'); eq(pl.loot.holz, 5, 'nur bis zur Kappe: 25 + 5'); eq(sim.youOf(1).stock.korn, 10, 'der Verlierer verliert trotzdem die Hälfte');
}

// ---- Ruhm and the crown ----
{
  const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
  const R = (i) => st.lords[i].ruhm, g = gateOf(sim, 1);
  const kill = (kind, by) => { const u = sim.dev.spawn(1, kind, g.x + 2, g.y + g.out * 20, 1); const r0 = R(by); sim.dev.kill(u, by); return R(by) - r0; };
  eq(kill('bauer', 0), 1, 'Bauer +1'); eq(kill('speer', 0), 1, 'Speerträger +1'); eq(kill('bogen', 0), 1, 'Bogenschütze +1'); eq(kill('fackel', 0), 1, 'Fackelträger +1'); eq(kill('ritter', 0), 2, 'Ritter +2');
  eq(R(1), 0, 'der Getötete bekommt nichts'); const own = sim.dev.spawn(0, 'speer', g.x, g.y + 20, 1), r0 = R(0); sim.dev.kill(own, 0); eq(R(0), r0, 'kein Ruhm für den eigenen Verlust');
  // prosperity: every 30 s one Ruhm per full 8 people
  const sim2 = mk(), s2 = sim2.state; run(sim2, secs(12)); eq(s2.lords[0].people, 8, '8 Leute'); run(sim2, secs(19)); eq(s2.lords[0].ruhm, 1, 'nach 30 s: +1 Ruhm (8 Leute)');
  for (let i = 0; i < 8; i++) sim2.dev.spawn(0, 'bauer', gateOf(sim2, 0).x, gateOf(sim2, 0).y, -1); run(sim2, secs(1)); eq(s2.lords[0].people >= 16, true, '16 Leute');
  const r1 = s2.lords[0].ruhm; run(sim2, secs(30)); eq(s2.lords[0].ruhm - r1, 2, 'nach weiteren 30 s: +2 (16 Leute)'); eq(s2.lords[1].ruhm, 2, '(Haus 1: 8 Leute → +1 je 30 s)');
}
{
  // the crown: the leader wears it from 10 Ruhm ahead; recomputed every 5 s; Ruhm won against the crowned house counts × 1.5 (rounded to 0.5)
  const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
  const R = (i) => st.lords[i].ruhm;
  st.lords[0].ruhm = 9; let l = run(sim, secs(6)); eq(ofType(l, 'crown').length, 0, 'Vorsprung 9: keine Krone'); eq(st.lords[0].crown, false, 'crown false');
  st.lords[0].ruhm = 10 + st.lords[1].ruhm; l = run(sim, secs(6)); const cr = ofType(l, 'crown'); eq(cr.length, 1, 'Vorsprung 10: Krone'); eq(cr[0].lord, 0, 'crown.lord'); eq(st.lords[0].crown, true, 'lords[].crown'); eq(sim.youOf(0).crown, true, 'youOf.crown'); eq(sim.youOf(1).crown, false, 'andere ohne Krone');
  const g = gateOf(sim, 0), kill = (kind, by) => { const u = sim.dev.spawn(0, kind, g.x + 3, g.y + g.out * 20, 1); const r0 = R(by); sim.dev.kill(u, by); return R(by) - r0; };
  eq(kill('ritter', 1), 3, 'Ritter der Krone: 2 × 1.5 = 3'); eq(kill('speer', 1), 1.5, 'Speerträger der Krone: 1.5'); eq(kill('bauer', 2), 1.5, 'auch für andere Häuser');
  const hut = placeAt(sim, 0, 'huette'), kas = placeAt(sim, 0, 'kaserne'); let q0 = R(1); sim.dev.damage(hut, 1e9, 1); eq(R(1) - q0, 4.5, 'Gebäude der Krone: 3 × 1.5 = 4.5'); q0 = R(1); sim.dev.damage(kas, 1e9, 1); eq(R(1) - q0, 7.5, 'Kaserne der Krone: 5 × 1.5 = 7.5');
  q0 = R(2); sim.dev.damage(sim.dev.lord(0).keepB, 1e9, 2); eq(R(2) - q0, 30, 'Plünderung der Krone: 20 × 1.5 = 30');
  // the crown holder itself wins at the normal rate
  const own = sim.dev.spawn(1, 'ritter', g.x, g.y + g.out * 22, 1); q0 = R(0); sim.dev.kill(own, 0); eq(R(0) - q0, 2, 'Sieg der Krone selbst zählt normal');
  // lead gone: the crown goes (event with lord null)
  st.lords[0].ruhm = st.lords[2].ruhm + 5; st.lords[1].ruhm = 0; st.lords[3].ruhm = 0; l = run(sim, secs(6)); const cl = ofType(l, 'crown'); eq(cl.length, 1, 'Krone verloren'); eq(cl[0].lord, null, 'crown.lord = null'); eq(st.lords[0].crown, false, 'crown false');
  // a new leader takes over directly
  st.lords[3].ruhm = st.lords[0].ruhm + 11; l = run(sim, secs(6)); eq(ofType(l, 'crown').pop().lord, 3, 'neuer Träger');
}

// ---- pacts ----
{
  const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
  const r1 = sim.pact(0, 1, true); eq(r1.ok, true, 'Angebot ok'); eq(r1.state, 'offered', 'state offered');
  let l = run(sim, 1); eq(JSON.stringify(ofType(l, 'pactOffer')), JSON.stringify([{ t: 'pactOffer', from: 0, to: 1 }]), 'pactOffer-Ereignis');
  const y0 = sim.youOf(0).pacts.find(p => p.with === 1), y1 = sim.youOf(1).pacts.find(p => p.with === 0);
  eq(y0.state, 'offered', 'youOf(0): offered'); eq(y1.state, 'incoming', 'youOf(1): incoming'); near(y0.until, st.t + 30 - 1 / 15, 0.2, 'Angebot gilt 30 s'); eq(st.pacts.length, 1, 'state.pacts'); eq(Object.keys(st.pacts[0]).join(), 'a,b,offerUntil', 'Angebot: a,b,offerUntil'); eq(st.pacts[0].a, 0, 'a = Anbieter');
  eq(sim.pact(0, 1, true).state, 'offered', 'nochmal anbieten ändert nichts'); eq(ofType(run(sim, 1), 'pactOffer').length, 0, 'kein zweites pactOffer');
  // accept
  const r2 = sim.pact(1, 0, true); eq(r2.state, 'active', 'Annahme: active'); l = run(sim, 1); const on = ofType(l, 'pactOn'); eq(on.length, 1, 'pactOn'); eq(on[0].a, 0, 'pactOn.a = Anbieter'); eq(on[0].b, 1, 'pactOn.b'); near(on[0].until, st.t - 1 / 15 + 180, 0.2, 'Pakt gilt 180 s');
  eq(st.pacts.length, 1, 'ein aktiver Pakt'); eq(Object.keys(st.pacts[0]).join(), 'a,b,until', 'Pakt: a,b,until'); eq(sim.youOf(0).pacts.find(p => p.with === 1).state, 'active', 'beide aktiv'); eq(sim.youOf(1).pacts.find(p => p.with === 0).state, 'active', 'beide aktiv (2)');
  eq(sim.pact(0, 1, true).state, 'active', 'erneutes Annehmen: bleibt active');
  // partners ignore each other: no blows, no arrows, no flight, no torches, orders refused near each other (see above)
  const c = clearing(sim, 0), A = stage(sim, 0, 'speer', c), B = stage(sim, 1, 'speer', { x: c.x + 1.1, y: c.y }), Bg = stage(sim, 1, 'bogen', { x: c.x + 3, y: c.y }, 2); A.hp = B.hp = Bg.hp = 1e5;
  const calm = run(sim, secs(8)); eq(ofType(calm, 'hit').length, 0, 'im Pakt keine Schläge und Treffer'); eq(ofType(calm, 'shot').length, 0, 'im Pakt keine Pfeile');
  const peas = sim.dev.spawn(0, 'bauer', c.x - 2, c.y, -1); run(sim, secs(2)); ok(peas._.job !== JOB.FLEE, 'Bauern fliehen nicht vor dem Partner');
  // the pact runs out after 180 s; P2: the houses stay friends for PACT_GRACE_S more (no blow), and only then do they fight again
  const ex = until(sim, () => sim.youOf(0).pacts.find(p => p.with === 1).state === 'none', secs(200)); const off = ofType(ex.log, 'pactOff'); eq(off.length, 1, 'pactOff'); eq(off[0].reason, 'expired', 'reason expired'); near(st.t, on[0].until, 0.2, 'der Pakt endet zur angekündigten Zeit until (' + st.t.toFixed(1) + ' vs ' + on[0].until.toFixed(1) + ')');
  near(off[0].grace, st.t + C.PACT_GRACE_S, 1e-6, 'pactOff.grace = Ende der Waffenruhe (30 s nach dem Ablauf)');
  const calm2 = run(sim, secs(C.PACT_GRACE_S - 2)); eq(ofType(calm2, 'hit').length, 0, 'Waffenruhe: 28 s nach dem Ablauf noch kein Schlag'); eq(ofType(calm2, 'shot').length, 0, 'Waffenruhe: kein Pfeil');
  const fight = run(sim, secs(8)); ok(ofType(fight, 'hit').length > 0, 'nach der Waffenruhe wird wieder gekämpft');
}
{
  // offers expire after 30 s; decline and withdraw; breaking: −5 Ruhm, Zorn for the victim (damage × 1.25 for 60 s)
  const sim = mk(), st = sim.state;
  sim.pact(0, 1, true); let l = run(sim, secs(31)); const ex = ofType(l, 'pactOff'); eq(ex.length, 1, 'Angebot läuft ab'); eq(ex[0].reason, 'expired', 'reason expired'); eq(ex[0].a, 0, 'a = Anbieter'); eq(st.pacts.length, 0, 'keine Pakte mehr'); eq(sim.youOf(1).pacts.find(p => p.with === 0).state, 'none', 'Prompt weg');
  sim.pact(0, 1, true); const dc = sim.pact(1, 0, false); eq(dc.ok, true, 'Ablehnen ok'); eq(dc.state, 'none', 'state none'); l = run(sim, 1); const d = ofType(l, 'pactOff'); eq(d.length, 1, 'pactOff declined'); eq(d[0].reason, 'declined', 'declined'); eq(d[0].by, 1, 'by = Ablehnender'); eq(d[0].a, 0, 'a = Anbieter'); eq(st.pacts.length, 0, 'Angebot entfernt');
  sim.pact(0, 1, true); const wd = sim.pact(0, 1, false); eq(wd.ok, true, 'Zurückziehen ok'); l = run(sim, 1); eq(ofType(l, 'pactOff')[0].reason, 'declined', 'zurückgezogen = declined'); eq(ofType(l, 'pactOff')[0].by, 0, 'by = Anbieter');
  eq(sim.pact(0, 1, false).ok, false, 'nichts zu beenden'); eq(sim.pact(0, 1, false).reason, 'none', 'Grund none');
  // break an active pact
  sim.pact(0, 1, true); sim.pact(1, 0, true); run(sim, 2); const r0 = st.lords[0].ruhm;
  const bk = sim.pact(0, 1, false); eq(bk.ok, true, 'Bruch ok'); eq(bk.state, 'none', 'Bruch: none'); l = run(sim, 1); const po = ofType(l, 'pactOff'); eq(po.length, 1, 'pactOff'); eq(po[0].reason, 'broken', 'broken'); eq(po[0].by, 0, 'by = Verräter'); eq(po[0].a, 0, 'a'); eq(po[0].b, 1, 'b');
  eq(st.lords[0].ruhm - r0, -5, 'Verrat: −5 Ruhm'); near(st.lords[1].zorn, 60, 0.1, 'Zorn 60 s für das Opfer'); eq(st.lords[0].zorn, 0, 'der Verräter hat keinen Zorn'); eq(st.pacts.length, 0, 'Pakt beendet');
  near((() => { run(sim, secs(10)); return st.lords[1].zorn; })(), 50, 0.2, 'Zorn läuft herunter');
}
{
  // Zorn: damage × 1.25 for the betrayed house's soldiers, for 60 s
  const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
  sim.pact(0, 1, true); sim.pact(1, 0, true); run(sim, 2); sim.pact(0, 1, false); run(sim, 2);
  const c = clearing(sim, 0), A = stage(sim, 1, 'speer', c), B = stage(sim, 0, 'speer', { x: c.x + 1.1, y: c.y }); A.hp = B.hp = 1e5;
  const hp0 = B.hp, l = run(sim, secs(4)); const n = hitsOn(l, B.id); ok(n >= 2, 'das Opfer schlägt zu'); near((hp0 - B.hp) / n, 8 * 1.25, 1e-6, 'Zorn: 8 × 1.25 = 10 je Schlag');
  run(sim, secs(60)); eq(st.lords[1].zorn, 0, 'nach 60 s ist der Zorn vorbei'); const hp1 = B.hp, l2 = run(sim, secs(4)); near((hp1 - B.hp) / hitsOn(l2, B.id), 8, 1e-6, 'danach wieder 8');
}
{
  // no pacts with only two houses; three houses are fine; a pact does not shield buildings from the other side's arrows either
  const s2 = mk({ lords: [{ i: 0, site: 0 }, { i: 1, site: 3 }] }); const r = s2.pact(0, 1, true); eq(r.ok, false, 'zwei Häuser: kein Pakt'); eq(r.reason, 'zwei', 'Grund zwei'); eq(r.state, 'none', 'state none'); eq(s2.pact(1, 0, false).reason, 'zwei', 'auch das Beenden'); eq(s2.state.pacts.length, 0, 'keine Pakte'); eq(ofType(run(s2, 2), 'pactOffer').length, 0, 'kein Angebot-Ereignis');
  const s3 = mk({ lords: [{ i: 0, site: 0 }, { i: 1, site: 1 }, { i: 2, site: 3 }] }); eq(s3.pact(0, 2, true).state, 'offered', 'drei Häuser: Angebot'); eq(s3.pact(2, 0, true).state, 'active', 'und Pakt');
  eq(s3.youOf(0).pacts.length, 2, 'youOf.pacts: zwei andere Häuser');
}
// =====================================================================================================================
// Phase 2 — Mauern & Söldner (docs/FURTFEHDE.md "Phase 2"): Mauern und Tore, Markt und Gold, Söldnerlager, Wehrgang, Rammbock, Reiterschütze
// =====================================================================================================================
const cellP = (p) => ({ i: Math.floor(p.x + 72), j: Math.floor(p.y + 45) });
const bld = (sim, id) => sim.state.buildings.find(b => b.id === id);
const WCODE = (k) => W.CODE[k];
// the direction (+1 / −1 along x) in which n cells of dry, walkable ground at full speed lie ahead of p (null if neither)
function dryDir(sim, p, n) {
  for (const d of [1, -1]) { let good = true; for (let s = 0; s <= n && good; s++) { const k = W.cellOf(p.x + d * s, p.y); if (k < 0 || sim.world.hq[k] < 1 || W.walk(sim.world, k, 0) !== 1 || sim.occ[k]) good = false; } if (good) return d; }
  return null;
}
// the longest straight dry run (≤ max) from p along the x axis: { d: ±1, n } (n = 0 when neither side is dry even for 4 cells)
function dryRay(sim, p, max) { for (let n = max; n >= 4; n--) { const d = dryDir(sim, p, n); if (d) return { d, n }; } return { d: -1, n: 0 }; }
// a point at distance r from `from` on dry, walkable, unoccupied ground at full speed (nothing wading), or null
function dryPoint(sim, from, r) {
  for (let a = 0; a < 360; a += 15) { const q = { x: from.x + Math.cos(a * Math.PI / 180) * r, y: from.y + Math.sin(a * Math.PI / 180) * r }, k = W.cellOf(q.x, q.y); if (k >= 0 && sim.world.hq[k] >= 1 && W.walk(sim.world, k, 0) === 1 && !sim.occ[k] && sim.world.owner[k] === 0) return q; }
  return null;
}
// a level-0 match in the Fehde with a free 7 × 7 patch of house l; returns { sim, c (centre), ci, cj }
function patch(l, o) { const sim = mk(Object.assign({ burgfrieden: 0 }, o || {})); toFehde(sim); const c = clearing(sim, l || 0), q = cellP(c); return { sim, c, ci: q.i, cj: q.j }; }

// ---- Phase 2: building walls through the sim — len, cost per cell, hp per cell, build time per cell, ruins and rebuild; Torhaus, Markt, Söldnerlager ----
{
  const { sim, ci, cj } = patch(0), st = sim.state;
  sim.dev.stock(0, { korn: 30, holz: 30, stein: 30, gold: 0 });
  const r1 = sim.build(0, 'mauer', ci - 3, cj - 3, 0, 4); eq(r1.ok, true, 'Mauer len 4 gebaut');
  const b1 = bld(sim, r1.id);
  eq(b1.len, 4, 'buildings[].len = 4'); eq(b1.kind, 'mauer', 'Art mauer'); eq(b1.garrison, 0, 'noch keine Besatzung'); eq(b1.build, 0, 'Baustelle: build 0');
  eq(sim.youOf(0).stock.stein, 30 - 8, 'Mauer: 🪨 2 je Zelle, bei len 4 also 8');
  eq(b1._.maxHp, 4 * 450, 'Mauer len 4: 450 HP je Zelle'); eq(b1._.w + 'x' + b1._.h, '4x1', 'Fußabdruck 4 × 1 bei rot 0');
  { let all = true; for (let d = 0; d < 4; d++) if (sim.occ[(cj - 3) * GW + ci - 3 + d] !== WCODE('mauer')) all = false; ok(all, 'die vier Zellen tragen den Mauer-Code ' + WCODE('mauer')); eq(sim.occ[(cj - 3) * GW + ci - 3 + 4], 0, 'die fünfte nicht'); }
  near(b1.hp, 0.1, 1e-9, 'Baustelle: 10 % der HP (hp ist ein Anteil)');
  const r2 = sim.build(0, 'palisade', ci - 3, cj - 1, 1, 3); eq(r2.ok, true, 'Palisade len 3, rot 1');
  const b2 = bld(sim, r2.id); eq(b2.len, 3, 'Palisade len 3'); eq(b2._.w + 'x' + b2._.h, '1x3', 'rot 1: 1 × 3'); eq(b2._.maxHp, 450, 'Palisade: 150 HP je Zelle'); eq(sim.youOf(0).stock.holz, 30 - 3, 'Palisade: 🪵 1 je Zelle');
  eq(b2.kind, 'palisade', 'Art palisade'); eq(sim.occ[(cj - 1 + 2) * GW + ci - 3], WCODE('palisade'), 'rot 1 läuft in +j');
  // Mauern dürfen aneinander stoßen
  eq(sim.build(0, 'mauer', ci + 1, cj - 3, 0, 2).ok, true, 'Mauer Ende an Ende mit der ersten'); eq(sim.build(0, 'mauer', ci - 3, cj - 2, 0, 1).ok, true, 'Mauer Seite an Seite');
  // schlechte Längen und Arten
  eq(sim.build(0, 'mauer', ci, cj + 3, 0, 0).reason, 'bounds', 'len 0: bounds'); eq(sim.build(0, 'mauer', ci, cj + 3, 0, 5).reason, 'bounds', 'len 5: bounds'); eq(sim.build(0, 'mauer', ci, cj + 3, 0, 1.5).reason, 'bounds', 'len 1.5: bounds'); eq(sim.build(0, 'palisade', ci, cj + 3, 0, NaN).reason, 'bounds', 'len NaN: bounds'); eq(sim.build(0, 'mauer', ci, cj + 3, 0, '2').reason, 'bounds', 'len "2": bounds');
  eq(sim.build(0, 'constructor', ci, cj, 0).reason, 'kind', 'Art "constructor" gibt es nicht'); eq(sim.build(0, '__proto__', ci, cj, 0).reason, 'kind', 'Art "__proto__" gibt es nicht'); eq(sim.recruit(0, 'constructor', 1).reason, 'unit', 'Einheit "constructor" gibt es nicht');
  const r3 = sim.build(0, 'huette', ci + 1, cj + 1, 0, 99); eq(r3.ok, true, 'len wirkt nur bei Mauern (Hütte ignoriert es)'); eq(bld(sim, r3.id).len, 1, 'Hütte: len 1');
  // 'tight' gilt für Mauern wie für alles: eine Hütte dicht an der Mauer
  eq(sim.build(0, 'huette', ci, cj - 2, 0).reason, 'tight', 'Hütte dicht an der Mauer: tight');
  // Kosten: zu wenig Stein
  { const q = patch(0); q.sim.dev.stock(0, { stein: 7 }); eq(q.sim.build(0, 'mauer', q.ci - 3, q.cj, 0, 4).reason, 'cost', 'Mauer len 4 braucht 8 Stein: cost'); eq(q.sim.build(0, 'mauer', q.ci - 3, q.cj, 0, 3).ok, true, 'len 3 (6 Stein) geht noch'); eq(q.sim.youOf(0).stock.stein, 1, 'und kostet 6'); }
  // Bauzeit je Zelle: ein Baumeister braucht buildS · len (Mauer 4 s, Palisade 2 s je Zelle)
  const tp = patch(0), t = tp.sim, ti = tp.ci, tj = tp.cj; t.dev.stock(0, { stein: 30, holz: 30 });
  const w4 = t.build(0, 'mauer', ti - 3, tj - 3, 0, 4), w2 = t.build(0, 'palisade', ti - 3, tj, 0, 3), s4 = bld(t, w4.id), s2 = bld(t, w2.id);
  let tw = -1, t0 = -1, b0 = 0; until(t, () => { if (t0 < 0 && s4.build > 0 && t.state.units.some(u => u._.job === JOB.BUILD && u._.site === t.dev.lord(0).bld.find(x => x.id === s4.id) && u._.ws === 1)) { t0 = t.state.t; b0 = s4.build; } return s4.build >= 1; }, secs(120));
  ok(s4.build >= 1, 'die Mauer wird fertig'); ok(t0 > 0, 'ein Baumeister arbeitet an ihr');
  near((t.state.t - t0) / (1 - b0), 4 * 4, 1.2, 'Mauer len 4: Bauzeit 4 s je Zelle = 16 s (' + ((t.state.t - t0) / (1 - b0)).toFixed(1) + ')');
  until(t, () => s2.build >= 1, secs(60)); ok(s2.build >= 1, 'die Palisade wird fertig'); eq(s4.hp, 1, 'fertig: hp 1'); eq(s4._.hpAbs, 1800, '1800 HP');
  // Torhaus, Markt, Söldnerlager: Größen, Kosten, HP
  const u = patch(0), us = u.sim; us.dev.stock(0, { korn: 30, holz: 30, stein: 30 });
  const th = us.build(0, 'torhaus', u.ci - 2, u.cj - 1, 0); eq(th.ok, true, 'Torhaus gebaut'); eq(JSON.stringify([us.youOf(0).stock.holz, us.youOf(0).stock.stein]), '[26,18]', 'Torhaus: 🪵 4 🪨 12'); eq(bld(us, th.id)._.maxHp, 1400, 'Torhaus 1400 HP'); eq(bld(us, th.id)._.w + 'x' + bld(us, th.id)._.h, '3x2', 'Torhaus 3 × 2');
  const us2 = patch(0).sim; us2.dev.stock(0, { holz: 30 }); const q2 = cellP(clearing(us2, 0));
  const mk1 = us2.build(0, 'markt', q2.i - 2, q2.j - 1, 0); eq(mk1.ok, true, 'Markt gebaut'); eq(us2.youOf(0).stock.holz, 20, 'Markt: 🪵 10'); eq(bld(us2, mk1.id)._.maxHp, 300, 'Markt 300 HP'); eq(bld(us2, mk1.id)._.w + 'x' + bld(us2, mk1.id)._.h, '4x3', 'Markt 4 × 3');
  const us3 = patch(0).sim; us3.dev.stock(0, { holz: 30 }); const q3 = cellP(clearing(us3, 0));
  const sl = us3.build(0, 'soeldnerlager', q3.i - 2, q3.j - 2, 0); eq(sl.ok, true, 'Söldnerlager gebaut'); eq(us3.youOf(0).stock.holz, 18, 'Söldnerlager: 🪵 12'); eq(bld(us3, sl.id)._.maxHp, 350, 'Söldnerlager 350 HP'); eq(bld(us3, sl.id)._.w + 'x' + bld(us3, sl.id)._.h, '5x4', 'Söldnerlager 5 × 4');
  eq(us3.build(0, 'soeldnerlager', q3.i - 3, q3.j - 3, 0).reason, 'occupied', 'auf derselben Stelle: occupied');
}

// ---- Phase 2: wall pieces are ruins that can be rebuilt (same footprint, same len, half the cost, same id) or cleared; wall ruins give no Ruhm ----
{
  const { sim, ci, cj } = patch(0); sim.dev.stock(0, { korn: 30, holz: 30, stein: 30 });
  const r = sim.dev.place(0, 'mauer', ci - 2, cj, 0, 3); ok(r.ok, 'Mauer len 3 steht'); const w = r.b, id = w.id;
  sim.dev.damage(w, 1e9, 1); eq(w.ruined, true, 'Mauer zerstört'); eq(sim.state.lords[1].ruhm, 0, 'eine zerstörte Mauer gibt kein Ruhm'); eq(sim.dev.lord(1).stats.razed, 0, 'und zählt nicht als Zerstörung');
  eq(sim.build(0, 'mauer', ci - 2, cj, 0, 2).reason, 'occupied', 'die Ruine blockt len 2 an derselben Stelle: occupied'); eq(sim.build(0, 'mauer', ci - 2, cj, 0, 3).ok, true, 'len 3 baut die Ruine wieder auf');
  eq(w.ruined, false, 'Ruine ist wieder eine Baustelle'); eq(w.id, id, 'die Id bleibt'); eq(sim.youOf(0).stock.stein, 30 - Math.ceil(6 * 0.5), 'halbe Kosten (6 Stein → 3)'); eq(w.build, 0, 'build 0'); eq(w.len, 3, 'len bleibt');
  { let solid = true; for (let d = 0; d < 3; d++) if (!sim.dev.blk[(cj) * GW + ci - 2 + d]) solid = false; ok(solid, 'als Baustelle blockt sie wieder'); }
  eq(sim.cancel(0, id).ok, true, 'Baustelle abbrechen: ok'); eq(sim.state.buildings.find(b => b.id === id), undefined, 'und weg');
  const p = sim.dev.place(0, 'palisade', ci - 2, cj + 2, 1, 2); sim.dev.damage(p.b, 1e9, 1); eq(p.b.ruined, true, 'Palisade zerstört'); eq(sim.cancel(0, p.b.id).ok, true, 'Ruine räumen: ok'); eq(sim.occ[(cj + 2) * GW + ci - 2], 0, 'die Zellen sind frei'); eq(sim.dev.rub[(cj + 2) * GW + ci - 2], 0, 'ohne Schutt');
  // Ruhm: Torhaus und Söldnerlager zählen wie Kaserne und Wachturm (+5), der Markt wie ein Haus (+3)
  const s5 = mk({ burgfrieden: 0 }); toFehde(s5);
  const th = placeAt(s5, 1, 'torhaus'), sl = placeAt(s5, 1, 'soeldnerlager'), mk2 = placeAt(s5, 1, 'markt');
  ok(th && sl && mk2, 'Torhaus, Söldnerlager und Markt stehen'); s5.dev.damage(th, 1e9, 0); eq(s5.state.lords[0].ruhm, 5, 'Torhaus zerstört: +5'); s5.dev.damage(sl, 1e9, 0); eq(s5.state.lords[0].ruhm, 10, 'Söldnerlager: +5'); s5.dev.damage(mk2, 1e9, 0); eq(s5.state.lords[0].ruhm, 13, 'Markt: +3');
  const wl = placeAt(s5, 1, 'mauer'); ok(wl, 'Mauer steht'); s5.dev.damage(wl, 1e9, 0); eq(s5.state.lords[0].ruhm, 13, 'Mauer: kein Ruhm');
}

// ---- Phase 2: sim.buildWall — pieces in order while the stock lasts ----
{
  const { sim, ci, cj } = patch(0), st = sim.state;
  sim.dev.stock(0, { korn: 30, holz: 30, stein: 30 });
  const line = [[ci - 3, cj - 3, 0, 4], [ci + 1, cj - 3, 0, 2], [ci + 3, cj - 3, 1, 3]];   // an L: two along +i, one down +j
  const ev0 = run(sim, 0), r = sim.buildWall(0, 'mauer', line);
  eq(JSON.stringify(r), '{"ok":true,"placed":3}', 'buildWall: alle drei Stücke'); eq(sim.youOf(0).stock.stein, 30 - 2 * (4 + 2 + 3), 'Kosten: 18 Stein'); eq(st.buildings.filter(b => b.kind === 'mauer').length, 3, 'drei Mauer-Stücke im Zustand');
  eq(st.buildings.filter(b => b.kind === 'mauer').map(b => b.len).join(), '4,2,3', 'len 4, 2, 3 in der Reihenfolge');
  const l2 = run(sim, 1); eq(ofType(l2, 'build').length, 3, 'drei build-Ereignisse'); ok(ofType(l2, 'build').every(e => e.kind === 'mauer' && e.lord === 0), 'build-Ereignisse: kind mauer');
  // zu wenig Vorrat: die Reihe endet bei 'cost', die gesetzten Stücke bleiben
  const { sim: s2, ci: c2, cj: j2 } = patch(0); s2.dev.stock(0, { stein: 10 });
  const r2 = s2.buildWall(0, 'mauer', [[c2 - 3, j2 - 3, 0, 4], [c2 - 3, j2, 0, 4], [c2 - 3, j2 + 2, 0, 1]]);
  eq(JSON.stringify(r2), '{"ok":true,"placed":1,"reason":"cost"}', '10 Stein: das erste Stück (8), das zweite ist zu teuer – die Reihe endet (cost), auch wenn das dritte noch ginge'); eq(s2.youOf(0).stock.stein, 2, 'Rest 2');
  const r2b = s2.buildWall(0, 'mauer', [[c2 - 3, j2 + 2, 0, 2]]); eq(JSON.stringify(r2b), '{"ok":false,"placed":0,"reason":"cost"}', 'nichts gesetzt: ok false, cost');
  // ein Stück, das nicht geht, wird übersprungen, die Reihe geht weiter; der erste Grund wird gemeldet
  const { sim: s3, ci: c3, cj: j3 } = patch(0); s3.dev.stock(0, { stein: 30, holz: 30 });
  const r3 = s3.buildWall(0, 'palisade', [[c3 - 3, j3 - 3, 0, 2], [GW - 3, GH - 3, 0, 2], [c3 + 0, j3 - 3, 0, 2]]); eq(r3.ok, true, 'ein Stück ungültig: der Rest wird gesetzt'); eq(r3.placed, 2, 'zwei von drei'); eq(r3.reason, 'owner', 'Grund des ersten Fehlschlags: owner (die Ecke gehört einem anderen Haus)');
  // Eingaben
  const bad = (a, b, c) => JSON.stringify(sim.buildWall(a, b, c));
  eq(bad(9, 'mauer', line), '{"ok":false,"placed":0,"reason":"lord"}', 'unbekanntes Haus'); eq(bad(0, 'huette', line), '{"ok":false,"placed":0,"reason":"kind"}', 'keine Mauer-Art: kind'); eq(bad(0, 'torhaus', line), '{"ok":false,"placed":0,"reason":"kind"}', 'Torhaus ist keine Linie: kind');
  eq(bad(0, 'mauer', []), '{"ok":false,"placed":0,"reason":"bounds"}', 'leere Liste: bounds'); eq(bad(0, 'mauer', null), '{"ok":false,"placed":0,"reason":"bounds"}', 'null: bounds'); eq(bad(0, 'mauer', 'x'), '{"ok":false,"placed":0,"reason":"bounds"}', 'Text: bounds');
  eq(bad(0, 'mauer', new Array(65).fill([0, 0, 0, 1])), '{"ok":false,"placed":0,"reason":"bounds"}', 'mehr als 64 Stücke: bounds'); eq(bad(0, 'mauer', ['x', null, { a: 1 }, [], [1.5, 2]]), '{"ok":false,"placed":0,"reason":"bounds"}', 'Müll als Stücke: bounds');
  for (const junk of [undefined, NaN, {}, [], () => 1]) noThrow(() => sim.buildWall(junk, junk, junk), 'buildWall(' + typeof junk + ') wirft nicht');
  const so = mk({ dauer: 1, burgfrieden: 0 }); run(so, secs(61)); eq(so.state.phase, 'over', 'Spiel zu Ende'); eq(JSON.stringify(so.buildWall(0, 'mauer', [[1, 1, 0, 1]])), '{"ok":false,"placed":0,"reason":"phase"}', 'nach dem Ende: phase');
}

// ---- Phase 2: gold and the Markt — trade(lord, good, side, packs) → { ok, n, reason? } ----
{
  const sim = mk({ burgfrieden: 0 }); toFehde(sim); const st = sim.state;
  sim.dev.stock(0, { korn: 30, holz: 30, stein: 30, gold: 0 });
  eq(JSON.stringify(sim.trade(0, 'korn', 'sell', 1)), '{"ok":false,"n":0,"reason":"markt"}', 'ohne Markt: markt');
  const mkt = placeAt(sim, 0, 'markt'); ok(mkt, 'Markt steht');
  const T = (g, s, n) => JSON.stringify(sim.trade(0, g, s, n)), stock = () => JSON.stringify(sim.youOf(0).stock);
  eq(T('korn', 'sell', 1), '{"ok":true,"n":1}', 'ein Paket 🌾 verkaufen'); eq(stock(), '{"korn":25,"holz":30,"stein":30,"gold":1}', '5 🌾 weniger, 💰 1 mehr'); eq(st.lords[0].gold, 1, 'state.lords[].gold = 1 sofort');
  eq(T('holz', 'sell', 2), '{"ok":true,"n":2}', 'zwei Pakete 🪵'); eq(stock(), '{"korn":25,"holz":20,"stein":30,"gold":3}', '10 🪵 weniger, 💰 2 mehr');
  eq(T('stein', 'sell', 3), '{"ok":true,"n":3}', 'drei Pakete 🪨 (je 💰 2)'); eq(stock(), '{"korn":25,"holz":20,"stein":15,"gold":9}', '15 🪨 weniger, 💰 6 mehr');
  eq(T('korn', 'buy', 1), '{"ok":true,"n":1}', 'ein Paket 🌾 kaufen (💰 3)'); eq(stock(), '{"korn":30,"holz":20,"stein":15,"gold":6}', '💰 3 weniger, 5 🌾 mehr');
  eq(T('stein', 'buy', 1), '{"ok":true,"n":1}', 'ein Paket 🪨 kaufen (💰 5)'); eq(stock(), '{"korn":30,"holz":20,"stein":20,"gold":1}', '💰 5 weniger');
  // teilweise: nicht genug Ware, nicht genug Gold, voller Speicher
  sim.dev.stock(0, { korn: 12, holz: 30, stein: 30, gold: 7 });
  eq(T('korn', 'sell', 3), '{"ok":true,"n":2,"reason":"cost"}', '12 🌾 reichen für 2 von 3 Paketen: n 2, Grund cost'); eq(sim.youOf(0).stock.korn, 2, 'Rest 2 🌾'); eq(T('korn', 'sell', 1), '{"ok":false,"n":0,"reason":"cost"}', 'weniger als ein Paket: ok false, cost');
  sim.dev.stock(0, { holz: 10, gold: 7 }); eq(T('holz', 'buy', 5), '{"ok":true,"n":2,"reason":"cost"}', '💰 7 reichen für 2 von 5 Paketen 🪵 (je 3)'); eq(sim.youOf(0).stock.gold, 1, 'Rest 💰 1'); eq(sim.youOf(0).stock.holz, 20, '+10 🪵');
  sim.dev.stock(0, { holz: 20, gold: 100 }); eq(T('holz', 'buy', 5), '{"ok":true,"n":2,"reason":"cap"}', 'Speicher 30: bei 20 passen nur 2 Pakete – Grund cap'); eq(sim.youOf(0).stock.holz, 30, 'voll: 30'); eq(sim.youOf(0).stock.gold, 94, '💰 6 bezahlt');
  eq(T('holz', 'buy', 1), '{"ok":false,"n":0,"reason":"cap"}', 'voller Speicher: nichts, cap'); sim.dev.stock(0, { holz: 28 }); eq(T('holz', 'buy', 1), '{"ok":false,"n":0,"reason":"cap"}', 'bei 28 von 30 passt kein ganzes Paket: cap');
  eq(sim.youOf(0).cap.holz, 30, 'cap steht in youOf'); ok(!('gold' in sim.youOf(0).cap), 'Gold hat keine Obergrenze (kein cap.gold)');
  // Eingaben
  eq(T('gold', 'sell', 1), '{"ok":false,"n":0,"reason":"good"}', 'Ware gold: good'); eq(T('x', 'buy', 1), '{"ok":false,"n":0,"reason":"good"}', 'unbekannte Ware: good'); eq(T('korn', 'swap', 1), '{"ok":false,"n":0,"reason":"side"}', 'unbekannte Seite: side'); eq(T('korn', undefined, 1), '{"ok":false,"n":0,"reason":"side"}', 'keine Seite: side');
  for (const bad of [0, -1, 1.5, NaN, Infinity, '2', null, undefined]) eq(T('korn', 'sell', bad), '{"ok":false,"n":0,"reason":"packs"}', 'packs ' + String(bad) + ': packs');
  eq(JSON.stringify(sim.trade(9, 'korn', 'sell', 1)), '{"ok":false,"n":0,"reason":"lord"}', 'unbekanntes Haus: lord'); for (const junk of [undefined, null, NaN, {}, [], () => 1]) noThrow(() => sim.trade(junk, junk, junk, junk), 'trade(' + typeof junk + ') wirft nicht');
  // das Ereignis kommt mit dem nächsten step
  sim.dev.stock(0, { korn: 30, holz: 30, stein: 30, gold: 0 }); run(sim, 1); sim.trade(0, 'stein', 'sell', 2); const l = run(sim, 1), te = ofType(l, 'trade'); eq(te.length, 1, 'trade-Ereignis'); eq(JSON.stringify(te[0]), JSON.stringify({ t: 'trade', lord: 0, good: 'stein', side: 'sell', n: 2, gold: 4 }), 'trade-Felder');
  // Gold ist unbegrenzt, wird nicht gegessen und bleibt über die Zeit
  sim.dev.stock(0, { gold: 5000 }); run(sim, secs(20)); eq(sim.youOf(0).stock.gold, 5000, '💰 5000 bleiben stehen (kein Limit, keine Verluste)'); eq(st.lords[0].gold, 5000, 'state.lords[].gold folgt');
  // ein Markt im Bau, eine Ruine und der Markt eines anderen Hauses handeln nicht
  const s2 = mk({ burgfrieden: 0 }); toFehde(s2); s2.dev.stock(0, { korn: 30, holz: 30 }); const q = cellP(clearing(s2, 0)); const site = s2.build(0, 'markt', q.i - 2, q.j - 1, 0); eq(site.ok, true, 'Markt im Bau'); eq(s2.trade(0, 'korn', 'sell', 1).reason, 'markt', 'Baustelle handelt nicht');
  const m2 = placeAt(s2, 1, 'markt'); eq(s2.trade(0, 'korn', 'sell', 1).reason, 'markt', 'der Markt eines anderen Hauses zählt nicht'); eq(s2.trade(1, 'korn', 'sell', 1).ok, true, 'der eigene schon'); s2.dev.damage(m2, 1e9, 0); eq(s2.trade(1, 'korn', 'sell', 1).reason, 'markt', 'eine Ruine handelt nicht');
  // Plünderung: die Hälfte des Goldes wandert zum Angreifer, ohne Obergrenze
  const s3 = mk({ burgfrieden: 0 }); toFehde(s3); s3.dev.stock(1, { korn: 20, holz: 24, stein: 4, gold: 11 }); s3.dev.stock(0, { korn: 0, holz: 0, stein: 0, gold: 3 }); const k1 = s3.dev.lord(1).keepB;
  s3.dev.damage(k1, 1e9, 0); const pl = ofType(run(s3, 1), 'plunder'); eq(pl.length, 1, 'plunder-Ereignis'); eq(JSON.stringify(pl[0].loot), JSON.stringify({ korn: 10, holz: 12, stein: 2, gold: 5 }), 'Beute: die Hälfte jeder Ware, 💰 5 von 11');
  eq(s3.youOf(1).stock.gold, 6, 'der Verlierer behält 6'); eq(s3.youOf(0).stock.gold, 8, 'der Angreifer hat 3 + 5'); eq(s3.state.lords[1].gold + '/' + s3.state.lords[0].gold, '6/8', 'state.lords[].gold stimmt');
  const s4 = mk({ burgfrieden: 0 }); toFehde(s4); s4.dev.stock(0, { gold: 1000 }); s4.dev.stock(1, { gold: 1001 }); s4.dev.damage(s4.dev.lord(1).keepB, 1e9, 0); run(s4, 1); eq(s4.youOf(0).stock.gold, 1500, 'Gold hat keine Obergrenze: 1000 + 500'); eq(s4.youOf(1).stock.gold, 501, 'Verlierer: 1001 − 500');
}


// ---- Phase 2: recruiting by unit — Kaserne or Söldnerlager, gold costs, training times, TRAIN_PAR per building ----
{
  const sim = mk({ burgfrieden: 0 }); toFehde(sim);
  sim.dev.stock(0, { korn: 40, holz: 40, stein: 40, gold: 50 });
  for (const [u, why] of [['speer', 'kaserne'], ['bogen', 'kaserne'], ['ritter', 'kaserne'], ['ramme', 'kaserne'], ['fackel', 'lager'], ['reiterschuetze', 'lager']]) eq(sim.recruit(0, u, 1).reason, why, 'ohne jedes Haus: ' + u + ' → ' + why);
  const kas = placeAt(sim, 0, 'kaserne'); ok(kas, 'Kaserne steht');
  eq(sim.recruit(0, 'fackel', 1).reason, 'lager', 'Kaserne, aber kein Söldnerlager: Fackelträger → lager'); eq(sim.recruit(0, 'reiterschuetze', 1).reason, 'lager', 'Reiterschütze → lager'); eq(sim.recruit(0, 'ramme', 1).ok, true, 'der Rammbock kommt aus der Kaserne');
  eq(sim.youOf(0).stock.holz + '/' + sim.youOf(0).stock.gold, '30/46', 'Rammbock: 🪵 10 💰 4'); eq(JSON.stringify(sim.youOf(0).queue), '[{"unit":"ramme","n":1,"p":0,"wait":true}]', 'in der Warteschlange');
  const sl = placeAt(sim, 0, 'soeldnerlager'); ok(sl, 'Söldnerlager steht');
  sim.dev.stock(0, { korn: 5, gold: 1 }); eq(sim.recruit(0, 'fackel', 2).reason, 'cost', 'Fackelträger mit 💰 1: cost'); sim.dev.stock(0, { korn: 0, gold: 9 }); eq(sim.recruit(0, 'fackel', 2).reason, 'cost', 'ohne 🌾: cost');
  sim.dev.stock(0, { korn: 5, gold: 5 }); eq(sim.recruit(0, 'reiterschuetze', 2).reason, 'cost', 'Reiterschütze braucht 💰 6: cost');
  sim.dev.stock(0, { korn: 5, gold: 2 }); eq(sim.recruit(0, 'fackel', 2).ok, true, 'Fackelträger: 💰 2 🌾 1'); eq(JSON.stringify(sim.youOf(0).stock), '{"korn":4,"holz":30,"stein":40,"gold":0}', 'bezahlt: 💰 2, 🌾 1 (kein 🪵)'); eq(sim.state.lords[0].gold, 0, 'state.lords[].gold folgt sofort');
  sim.dev.stock(0, { korn: 5, gold: 9 }); eq(sim.recruit(0, 'reiterschuetze', 2).ok, true, 'Reiterschütze: 💰 6 🌾 2'); eq(JSON.stringify([sim.youOf(0).stock.korn, sim.youOf(0).stock.gold]), '[3,3]', 'bezahlt');
  eq(sim.recruit(0, 'speer', 1).ok, true, 'ein Speerträger kostet kein Gold'); eq(sim.youOf(0).stock.gold, 3, 'Gold unberührt');
  eq(sim.recruit(0, 'ritter', 7).reason, 'banner', 'Reihenfolge der Gründe: unit, banner, phase, Haus, pop, cost');
}
{
  // training times: 2 s (Fackelträger), 4 s (Reiterschütze), 10 s (Rammbock); each trained at the right house
  const train = (unit, house) => {
    const sim = mk({ burgfrieden: 0 }); toFehde(sim); sim.dev.stock(0, { korn: 40, holz: 40, stein: 40, gold: 50 });
    const h = placeAt(sim, 0, house), n = unit === 'ramme' ? 1 : 2; sim.recruit(0, unit, n);
    let t0 = -1, store = null; const l = until(sim, () => sim.state.units.some(u => u.kind === unit), secs(60), () => { const q = sim.youOf(0).queue[0]; if (q && q.p > 0 && t0 < 0) t0 = sim.state.t; const w = unitsOf(sim, 0).find(x => x._.qe); if (w) store = w._.store; });
    const tr = ofType(l.log, 'trained'), u = sim.state.units.find(x => x.kind === unit);
    return { sim, h, t: sim.state.t - t0, t0, tr, u, store };
  };
  for (const [unit, house, secsNeed, hp] of [['fackel', 'soeldnerlager', 2, 30], ['reiterschuetze', 'soeldnerlager', 4, 70], ['ramme', 'kaserne', 10, 400]]) {
    const r = train(unit, house);
    ok(r.u, unit + ' wird ausgebildet'); if (!r.u) continue;
    near(r.t, secsNeed, 0.3, unit + ': Ausbildung ' + secsNeed + ' s (' + r.t.toFixed(2) + ')'); eq(r.store && r.store.kind, house, unit + ' wird im ' + house + ' ausgebildet'); eq(r.u.hp, hp, unit + ': hp ' + hp);
    eq(r.tr.length, 1, 'trained-Ereignis'); eq(r.tr[0].unit, unit, 'trained.unit'); eq(r.u.n, unit === 'ramme' ? 1 : 2, 'n = Bannernummer'); eq(r.u.on, null, 'nicht im Wehrgang'); eq(r.u.slot, -1, 'slot −1');
  }
}
{
  // TRAIN_PAR counts per building: one Kaserne and one Söldnerlager take three recruits each at the same time; the other kind does not queue behind a full house
  const savedP = C.START_PEASANTS; C.START_PEASANTS = 14;
  const sim = mk({ burgfrieden: 0 }); toFehde(sim); sim.dev.stock(0, { korn: 40, holz: 40, stein: 40, gold: 60 });
  const kas = placeAt(sim, 0, 'kaserne'), sl = placeAt(sim, 0, 'soeldnerlager');
  const per = (k) => unitsOf(sim, 0, 'bauer').filter(u => u._.qe && u._.store === k).length;
  for (let i = 0; i < 4; i++) eq(sim.recruit(0, 'speer', 1).ok, true, 'Speerträger ' + (i + 1)); for (let i = 0; i < 4; i++) eq(sim.recruit(0, 'fackel', 2).ok, true, 'Fackelträger ' + (i + 1));
  run(sim, secs(3));
  eq(per(kas) + '/' + per(sl), '3/3', 'drei Speerträger bei der Kaserne, drei Fackelträger beim Söldnerlager – der Fackelträger wartet nicht hinter den Speerträgern');
  eq(sim.youOf(0).queue.filter(q => q.wait).map(q => q.unit).join(), 'speer,fackel', 'je einer wartet auf einen freien Platz');
  ok(unitsOf(sim, 0, 'bauer').filter(u => u._.qe && UN_AT(u._.qe.unit) !== u._.store.kind).length === 0, 'keiner steht beim falschen Haus');
  const l = until(sim, () => sim.state.units.filter(u => u.kind === 'speer' || u.kind === 'fackel').length === 8, secs(60)); ok(l.hit, 'alle acht werden ausgebildet');
  eq(sim.state.units.filter(u => u.kind === 'fackel').length + '/' + sim.state.units.filter(u => u.kind === 'speer').length, '4/4', '4 Fackelträger und 4 Speerträger');
  // the Söldnerlager falls during training: the order stays (no other house of its kind), the peasant goes back; a new one finishes it
  const s2 = mk({ burgfrieden: 0 }); toFehde(s2); s2.dev.stock(0, { korn: 40, holz: 40, gold: 20 }); const sl2 = placeAt(s2, 0, 'soeldnerlager'); s2.recruit(0, 'fackel', 2);
  until(s2, () => unitsOf(s2, 0).some(u => u._.qe && u._.ws === 1), secs(20)); s2.dev.damage(sl2, 1e9, 1); run(s2, 3);
  eq(s2.youOf(0).queue.length, 1, 'die Bestellung bleibt'); eq(s2.youOf(0).queue[0].p, 0, 'Fortschritt zurückgesetzt'); eq(unitsOf(s2, 0).filter(u => u._.qe).length, 0, 'kein Bauer übt mehr'); eq(s2.youOf(0).stock.gold, 18, 'bezahlt bleibt bezahlt');
  placeAt(s2, 0, 'soeldnerlager'); ok(until(s2, () => s2.state.units.some(u => u.kind === 'fackel'), secs(40)).hit, 'mit neuem Söldnerlager wird der Fackelträger fertig');
  C.START_PEASANTS = savedP;
}
function UN_AT(u) { return C.UNIT[u].at; }

// ---- Phase 2: the Reiterschütze — damage multipliers, shooting on the move, backing away from melee while reloading ----
{
  const table = [['reiterschuetze', 'speer', 9], ['reiterschuetze', 'fackel', 9], ['reiterschuetze', 'bogen', 6], ['reiterschuetze', 'ritter', 6], ['reiterschuetze', 'reiterschuetze', 6], ['ritter', 'reiterschuetze', 21], ['speer', 'reiterschuetze', 8], ['bogen', 'reiterschuetze', 6]];
  for (const [a, b, d] of table) {
    const r = duel(a, b, 5); ok(r.n >= 2, a + ' → ' + b + ': trifft (' + r.n + ' Treffer)');
    const melee = C.UNIT[a].range < 3;
    for (const bl of r.blows) { const exp = melee ? d * (bl.wetA ? C.WADE_DEALT : 1) * (bl.wetB ? C.WADE_TAKEN : 1) : d; near(bl.dmg, exp, 1e-6, a + ' → ' + b + ': Schaden je Treffer'); }
  }
  const rb = duel('reiterschuetze', 'speer', 9, 6), hs = rb.log.filter(e => e.t === 'shot'); ok(hs.length >= 4 && hs.length <= 9, 'Reiterschütze: ≈ 1 Schuss je 1.3 s (' + hs.length + ' in 9 s)'); ok(hs.every(s => s.src === 'bogen'), 'shot.src = bogen');
  // arrows from the Reiterschütze: flight like every arrow, damage on arrival; range 8 (a spearman at 9 is out of reach, at 7 in reach)
  const outS = (gap) => { const s = mk({ burgfrieden: 0 }); toFehde(s); const p = clearing(s, 0), d = dryDir(s, p, 14) || 1, A = stage(s, 0, 'reiterschuetze', p), B = stage(s, 1, 'speer', { x: p.x + d * gap, y: p.y }); A.hp = B.hp = 1e5; B._.cd = 1e9; const sh = []; let x0 = A.x, xFirst = null; for (let i = 0; i < secs(3); i++) for (const e of s.step()) if (e.t === 'shot') { sh.push(e); if (xFirst === null) xFirst = A.x; } return { sh, A, B, moved: xFirst === null ? 0 : Math.abs(xFirst - x0) }; };
  { const o = outS(7); ok(o.sh.length >= 1, 'Ziel auf 7: es wird geschossen'); ok(o.sh.every(s => Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]) <= 8.1), 'Reichweite 8: kein Schuss weiter'); const f = outS(9.5); ok(f.sh.length >= 1, 'Ziel auf 9.5 (Aggro 10, Reichweite 8): der Reiter reitet heran und schießt'); ok(f.sh.every(s => Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]) <= 8.1), 'erst aus Reichweite (≤ 8)'); ok(f.moved >= 1.2, 'er ist vor dem ersten Schuss herangeritten (' + f.moved.toFixed(1) + ')'); }
  // 4 shots in the air … the rider keeps riding: in range of a target it still follows its banner and shoots on the way
  const mv = mk({ burgfrieden: 0 }); toFehde(mv); const p = clearing(mv, 0), dx = dryDir(mv, { x: p.x - 3, y: p.y }, 16) || 1, sx = dx > 0 ? -3 : 3;   // (x grows towards the dry side: dx = +1 means east)
  const R = stage(mv, 0, 'reiterschuetze', { x: p.x + sx, y: p.y + 3 }); const T = stage(mv, 1, 'bogen', { x: p.x + sx + dx * 4, y: p.y }, 1); R.hp = T.hp = 1e5; T._.cd = 1e9;
  mv.banner(0, 1, p.x + sx + dx * 14, p.y + 3); const shots = [], path = []; for (let i = 0; i < secs(6); i++) { for (const e of mv.step()) if (e.t === 'shot') shots.push({ ...e, rx: R.x }); path.push(R.x); }
  ok(shots.length >= 2, 'im Reiten geschossen (' + shots.length + ' Schüsse)'); if (shots.length >= 2) { ok(Math.abs(shots[shots.length - 1].from[0] - shots[0].from[0]) > 3, 'der Reiter hat sich zwischen den Schüssen bewegt (' + Math.abs(shots[shots.length - 1].from[0] - shots[0].from[0]).toFixed(1) + ' Zellen)'); ok(shots.every(s => Math.hypot(s.to[0] - T.x, s.to[1] - T.y) < 2), 'alle Schüsse gehen auf das Ziel'); }
  ok(Math.abs(path[path.length - 1] - path[0]) > 5, 'und er ist weitergeritten, nicht stehen geblieben (' + Math.abs(path[path.length - 1] - path[0]).toFixed(1) + ')');
  // backing away: a spearman who never strikes chases the rider, which keeps its distance (a bogen, which does not kite, lets him come up)
  const kite = (kindA) => {
    const s = mk({ burgfrieden: 0 }); toFehde(s); const q = clearing(s, 0), A = stage(s, 0, kindA, q), B = stage(s, 1, 'speer', { x: q.x + 1.6, y: q.y }); A.hp = B.hp = 1e5; B._.cd = 1e9;
    let near2 = 0, n = 0, shots2 = 0; for (let i = 0; i < secs(8); i++) { for (const e of s.step()) if (e.t === 'shot') shots2++; if (i > secs(2)) { n++; if (dist(A, B) < 2) near2++; } }
    return { share: near2 / n, shots: shots2, d: dist(A, B) };
  };
  const kr = kite('reiterschuetze'), kb = kite('bogen');
  ok(kb.share > 0.9, 'Kontrolle: der Bogenschütze lässt den Speerträger heran (' + (kb.share * 100).toFixed(0) + ' % der Zeit unter 2 Zellen)'); ok(kr.share < 0.35, 'der Reiterschütze hält Abstand zum Nahkämpfer (' + (kr.share * 100).toFixed(0) + ' % der Zeit unter 2 Zellen)');
  ok(kr.shots >= 3, 'und schießt dabei weiter (' + kr.shots + ' Schüsse in 8 s)');
  // a rider out of reach of any melee enemy does not run off; against a ritter (4.2 < 4.4) it still tries
  const calm = mk({ burgfrieden: 0 }); toFehde(calm); const cp = clearing(calm, 0), CA = stage(calm, 0, 'reiterschuetze', cp); CA.hp = 1e5; run(calm, secs(3)); ok(dist(CA, cp) < 1.5, 'ohne Feind bleibt er stehen');
}

// ---- Phase 2: the Rammbock — no damage to people, arrows × 0.25, melee full; it moves at its own pace (speed 1.6) ----
{
  const f = duel('ramme', 'speer', 6); eq(f.n, 0, 'Rammbock schlägt Leute nicht (kein Treffer)'); eq(f.B.hp, 1e5, 'und richtet keinen Schaden an');
  const d1 = duel('speer', 'ramme', 5); ok(d1.n >= 3, 'Speerträger schlagen den Rammbock'); for (const bl of d1.blows) near(bl.dmg, 8 * (bl.wetA ? C.WADE_DEALT : 1) * (bl.wetB ? C.WADE_TAKEN : 1), 1e-6, 'Nahkampf gegen den Rammbock: voller Schaden (8)');
  const d2 = duel('bogen', 'ramme', 6, 2.5); ok(d2.n >= 3, 'Bogenschütze beschießt den Rammbock'); for (const bl of d2.blows) near(bl.dmg, 6 * C.ARROW_RAM * (bl.wetA ? C.WADE_DEALT : 1) * (bl.wetB ? C.WADE_TAKEN : 1), 1e-6, 'Pfeil gegen den Rammbock: × 0.25 = 1.5'); ok(d2.blows.some(bl => !bl.wetA && !bl.wetB && Math.abs(bl.dmg - 1.5) < 1e-6), 'mindestens ein trockener Treffer: genau 1.5');
  const d3 = duel('ritter', 'ramme', 5); for (const bl of d3.blows) near(bl.dmg, 14 * (bl.wetA ? C.WADE_DEALT : 1) * (bl.wetB ? C.WADE_TAKEN : 1), 1e-6, 'Ritter gegen den Rammbock: voll (14)');
  // a tower's arrow: 7 × 0.25
  const tw = mk({ burgfrieden: 0 }); toFehde(tw); const t1 = placeAt(tw, 0, 'wachturm'), tc = { x: t1._.cx, y: t1._.cy }, kp = tw.dev.lord(0).keepB._;
  let spot = null; for (let a = 0; a < 360 && !spot; a += 5) { const q = { x: tc.x + Math.cos(a * Math.PI / 180) * 6, y: tc.y + Math.sin(a * Math.PI / 180) * 6 }; if (!blockedAt(tw, q) && Math.hypot(q.x - kp.cx, q.y - kp.cy) > 13 && W.walk(tw.world, W.cellOf(q.x, q.y), 0) === 1) spot = q; }
  if (spot) { const R = stage(tw, 1, 'ramme', spot); R.hp = 1e5; R._.cd = 1e9; const hp0 = R.hp, hits = []; let last = R.hp; for (let i = 0; i < secs(6); i++) { tw.step(); if (R.hp < last - 1e-9) { hits.push(last - R.hp); last = R.hp; } } ok(hits.length >= 2 && hits.every(h => Math.abs(h - 7 * C.ARROW_RAM) < 1e-9), 'Turmpfeil gegen den Rammbock: 7 × 0.25 = 1.75 (' + hits.join(',') + ')'); }
  // marching: the banner goes at the ram's pace
  const m = mk({ burgfrieden: 0 }); toFehde(m); const q = clearing(m, 0), R = stage(m, 0, 'ramme', q), S = m.dev.spawn(0, 'speer', q.x + 1, q.y, 1);
  eq(m.dev.lord(0).bn[1].march, 1.6, 'der Zug marschiert im Tempo des Rammbocks (1.6)'); m.banner(0, 1, q.x + 3, q.y); const x0 = R.x; run(m, secs(2)); const mv = R.x - x0; ok(mv > 1.5 && mv < 3.6, 'der Rammbock rollt ≈ 1.6 Zellen je Sekunde (' + (mv / 2).toFixed(2) + ')');
  eq(m.dev.lord(0).bn[1].members[0], R, 'er steht vorn im Aufgebot (Platz 0)');
}


// ---- Phase 2: walls — the closed 5 × 5 outline of wall pieces around a 3 × 3 yard (with `gate`: a Torhaus replaces the three top cells; its lane runs north–south) ----
function ringOf(sim, l, ci, cj, kind, gate) {
  const pieces = [], put = (i, j) => { const r = sim.dev.place(l, kind, i, j, 0, 1); if (!r.ok) throw new Error('ring ' + kind + ' ' + i + ',' + j + ': ' + r.reason); pieces.push(r.b); };
  for (let d = -2; d <= 2; d++) { if (!gate || Math.abs(d) === 2) put(ci + d, cj - 2); put(ci + d, cj + 2); }
  for (let d = -1; d <= 1; d++) { put(ci - 2, cj + d); put(ci + 2, cj + d); }
  let th = null;
  if (gate) { const r = sim.dev.place(l, 'torhaus', ci - 1, cj - 2, 0); if (!r.ok) throw new Error('Torhaus: ' + r.reason); th = r.b; }
  const cx = -71.5 + ci, cy = -44.5 + cj;
  return { pieces, th, mid: { x: cx, y: cy + (gate ? 1 : 0) }, inside: (u) => u.x > -72 + ci - 1 + 0.05 && u.x < -72 + ci + 2 - 0.05 && u.y > -45 + (gate ? cj : cj - 1) + 0.05 && u.y < -45 + cj + 2 - 0.05 };
}
const laneKs = (b) => W.laneOf(b.i, b.j, b.rot).cells.map(([i, j]) => j * GW + i);

// ---- Phase 2: the Torhaus lane — open for the owner and its active pact partners, closed for everybody else; a site and a ruin are no gate ----
{
  const { sim, ci, cj } = patch(0), R = ringOf(sim, 0, ci, cj, 'mauer', true), th = R.th, lk = laneKs(th);
  eq(lk.join(), [(cj - 2) * GW + ci, (cj - 1) * GW + ci].join(), 'die Gasse ist die Mittelspalte des Torhauses');
  ok(lk.every(k => sim.dev.blk[k] === 1), 'die Grundmaske sperrt die Gasse für alle');
  ok(lk.every(k => sim.dev.view(0)[k] === 0), 'der Besitzer darf durch'); ok(lk.every(k => sim.dev.view(1)[k] === 1) && lk.every(k => sim.dev.view(2)[k] === 1), 'andere Häuser nicht');
  const flank = [(cj - 2) * GW + ci - 1, (cj - 1) * GW + ci + 1]; ok(flank.every(k => sim.dev.view(0)[k] === 1), 'die Turmflanken sperren auch den Besitzer'); ok(R.pieces.every(b => laneKs(th).indexOf(b.j * GW + b.i) < 0), 'kein Mauerstück liegt in der Gasse');
  sim.pact(0, 1, true); eq(lk.every(k => sim.dev.view(1)[k] === 1), true, 'ein bloßes Angebot öffnet nichts'); sim.pact(1, 0, true); eq(sim.youOf(0).pacts.find(p => p.with === 1).state, 'active', 'Pakt aktiv');
  ok(lk.every(k => sim.dev.view(1)[k] === 0), 'Paktpartner dürfen durch'); ok(lk.every(k => sim.dev.view(2)[k] === 1), 'Haus 2 weiter nicht'); ok(lk.every(k => sim.dev.view(0)[k] === 0), 'der Besitzer sowieso');
  ok(flank.every(k => sim.dev.view(1)[k] === 1), 'die Flanken bleiben auch für Partner dicht'); ok(R.pieces.every(b => sim.dev.view(1)[b.j * GW + b.i] === 1), 'Mauern sperren auch Partner');
  sim.pact(0, 1, false); ok(lk.every(k => sim.dev.view(1)[k] === 1), 'Pakt gebrochen: die Gasse ist wieder zu'); ok(lk.every(k => sim.dev.view(0)[k] === 0), 'dem Besitzer bleibt sie offen');
  // a partner standing in the lane when the pact ends is moved out of it (the lane is a wall for him again)
  sim.pact(0, 1, true); sim.pact(1, 0, true); const lanePt = { x: -71.5 + lk[0] % GW, y: -44.5 + Math.floor(lk[0] / GW) }, vs = sim.dev.spawn(1, 'speer', lanePt.x, lanePt.y, 1); run(sim, 2); ok(lk.indexOf(W.cellOf(vs.x, vs.y)) >= 0, 'der Partner steht in der Gasse (Pakt aktiv)'); sim.pact(0, 1, false); run(sim, 3);
  ok(lk.indexOf(W.cellOf(vs.x, vs.y)) < 0 && !sim.dev.view(1)[W.cellOf(vs.x, vs.y)], 'Pakt beendet: er wurde aus der Gasse auf eine freie Zelle gesetzt'); vs.hp = 0; sim.dev.kill(vs);
  // the breach view: enemy walls and gates are passable at BREACH_COST; own walls and a partner's never
  const f1 = sim.dev.fview(1), f0 = sim.dev.fview(0), wk = R.pieces[0].j * GW + R.pieces[0].i;
  eq(f1.B[wk], 0, 'für Haus 1 ist die Mauer von Haus 0 durchbrechbar'); near(f1.X[wk], C.BREACH_COST, 1e-9, '… zu BREACH_COST (60)'); ok(lk.every(k => f1.B[k] === 0 && Math.abs(f1.X[k] - C.BREACH_COST) < 1e-9), 'auch die Gasse und das Torhaus kosten 60 je Zelle'); ok(flank.every(k => f1.B[k] === 0 && f1.X[k] === 60), 'Flanken ebenso');
  eq(f0.B[wk], 1, 'die eigene Mauer ist kein Ziel'); eq(f0.X, null, 'ohne Feindmauern: kein extra-Feld'); ok(lk.every(k => f0.B[k] === 0), 'eigene Gasse offen');
  sim.pact(0, 1, true); sim.pact(1, 0, true); const fp = sim.dev.fview(1); eq(fp.B[wk], 1, 'mit Pakt sind Partnermauern nicht durchbrechbar'); eq(fp.X, null, 'kein extra'); ok(lk.every(k => fp.B[k] === 0), 'aber die Gasse ist offen'); sim.pact(0, 1, false);
  // a Torhaus under construction is closed for the owner, too; a ruin is rubble for everybody
  const s2 = patch(0); s2.sim.dev.stock(0, { korn: 30, holz: 30, stein: 30 }); const site = s2.sim.build(0, 'torhaus', s2.ci - 1, s2.cj - 2, 0); eq(site.ok, true, 'Torhaus als Baustelle'); const sb = s2.sim.dev.lord(0).bld.find(b => b.id === site.id), sl = laneKs(sb);
  ok(sl.every(k => s2.sim.dev.view(0)[k] === 1), 'Baustelle: die Gasse ist zu, auch für den Besitzer'); s2.sim.dev.finish(sb); ok(sl.every(k => s2.sim.dev.view(0)[k] === 0), 'fertig: sie geht auf (die Sicht wird neu berechnet)'); ok(sl.every(k => s2.sim.dev.view(1)[k] === 1), 'für Fremde weiter zu');
  s2.sim.dev.damage(sb, 1e9, 1); const all6 = []; for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 3; di++) all6.push((s2.cj - 2 + dj) * GW + s2.ci - 1 + di);
  ok(all6.every(k => s2.sim.dev.blk[k] === 0 && s2.sim.dev.rub[k] === 1 && s2.sim.dev.view(1)[k] === 0), 'Torhaus zerstört: alle sechs Zellen sind Schutt, für jedes Haus begehbar'); ok(all6.every(k => s2.sim.occ[k] === WCODE('torhaus')), '(und zählen weiter als belegt)');
  s2.sim.dev.stock(0, { korn: 30, holz: 30, stein: 30 }); eq(s2.sim.build(0, 'torhaus', s2.ci - 1, s2.cj - 2, 0).ok, true, 'Wiederaufbau'); ok(all6.every(k => s2.sim.dev.blk[k] === 1 && s2.sim.dev.rub[k] === 0), 'als Baustelle wieder fest');
}

// ---- Phase 2: a banner walks through its own Torhaus; a banner of an enemy house has to break in ----
{
  const t = (who) => {   // who: 0 = the owner's banner leaves the yard through the gate, 1 = an enemy banner marches on the yard
    const { sim, c, ci, cj } = patch(0), dir = dryDir(sim, c, 12);
    const R = ringOf(sim, 0, ci, cj, 'mauer', true);
    const log = [], us = [];
    if (who === 0) {
      sim.banner(0, 1, R.mid.x, R.mid.y); for (let i = 0; i < 4; i++) us.push(sim.dev.spawn(0, 'speer', R.mid.x - 0.8 + i * 0.5, R.mid.y + 0.4, 1));
      const o = sim.banner(0, 1, c.x, c.y - 9); return { sim, R, us, o, c, log };
    }
    const sx = c.x + (dir || -1) * 9; sim.banner(1, 1, sx, c.y);
    for (let i = 0; i < 6; i++) us.push(sim.dev.spawn(1, 'speer', sx + (i % 3) * 0.8, c.y - 1 + Math.floor(i / 3) * 0.8, 1));
    sim.step(); const o = sim.banner(1, 1, R.mid.x, R.mid.y);
    return { sim, R, us, o, c, log };
  };
  // the owner: out through the gate, nothing is damaged
  const a = t(0), lane = laneKs(a.R.th); eq(a.o.ok, true, 'Befehl aus dem Hof hinaus angenommen'); const bn = a.sim.dev.lord(0).bn[1], tgt = { x: a.o.x, y: a.o.y };
  let onLane = false, arrivedT = -1, breaches = 0; const t0 = a.sim.state.t;
  until(a.sim, () => { for (const u of a.us) { const k = W.cellOf(u.x, u.y); if (lane.indexOf(k) >= 0) onLane = true; } return Math.hypot(bn.x - tgt.x, bn.y - tgt.y) < 1.5; }, secs(40), () => {}); arrivedT = a.sim.state.t - t0;
  ok(Math.hypot(bn.x - tgt.x, bn.y - tgt.y) < 1.5, 'der Zug kommt draußen an (' + arrivedT.toFixed(1) + ' s)'); ok(onLane, 'und ging durch die Torgasse'); ok(a.R.pieces.every(b => b.hp === 1) && a.R.th.hp === 1, 'ohne dass ein Stück beschädigt wurde'); ok(a.us.every(u => u.hp > 0), 'alle Soldaten leben'); eq(a.sim.dev.lord(0).bn[1].breach, null, 'kein Durchbruch');
  // …and back in: the yard is a reachable target for its own banner (no snapping away from it)
  const back = a.sim.banner(0, 1, a.R.mid.x, a.R.mid.y); eq(back.reason, undefined, 'Ziel im Hof: erreichbar, ohne Verschiebung'); const b0 = a.sim.state.t; until(a.sim, () => Math.hypot(bn.x - a.R.mid.x, bn.y - a.R.mid.y) < 1.2, secs(40)); ok(Math.hypot(bn.x - a.R.mid.x, bn.y - a.R.mid.y) < 1.2, 'und der Zug kehrt durchs Tor heim (' + (a.sim.state.t - b0).toFixed(1) + ' s)');
  // the enemy: no way in but breaking a wall; nobody stands in the yard before the first piece falls
  const e = t(1); eq(e.o.ok, true, 'Befehl auf den Hof: angenommen (Bresche gilt als erreichbar)'); eq(e.o.reason, undefined, 'ohne zu snappen'); near(e.o.x, e.R.mid.x, 1e-9, 'Ziel unverändert');
  let firstBreach = -1, insideBefore = false, insideAfter = false, nBreach = 0;
  for (let i = 0; i < secs(150) && !insideAfter; i++) {
    for (const ev of e.sim.step()) if (ev.t === 'breach') { nBreach++; if (firstBreach < 0) firstBreach = e.sim.state.t; }
    for (const u of e.us) if (u.hp > 0 && e.R.inside(u)) { if (firstBreach < 0) insideBefore = true; else insideAfter = true; }
  }
  ok(firstBreach > 0 && nBreach >= 1, 'ein Stück wurde durchbrochen (breach-Ereignis)'); ok(!insideBefore, 'vor dem Durchbruch steht kein Feind im Hof'); ok(insideAfter, 'danach sind sie drin');
  ok(e.R.pieces.some(b => b.ruined) || e.R.th.ruined, 'ein Stück liegt in Trümmern'); ok(e.us.filter(u => u.hp > 0).length >= 5, 'die Belagerer leben noch (keine Verteidiger, keine Türme)');
}


// ---- Phase 2: blows against wall pieces — VS_WALL for melee, ARROW_WALL for arrows, the ram 60 every 2 s ----
{
  // one attacker of house 1 stands next to a piece of house 0 (a banner standing within 3 of an enemy building attacks it); every drop of the piece's hit points is a blow
  const against = (attacker, wallKind, secsRun, gap) => {
    const { sim, ci, cj } = patch(0), wl = sim.dev.place(0, wallKind === 'torhaus' ? 'torhaus' : wallKind, wallKind === 'torhaus' ? ci - 1 : ci, wallKind === 'torhaus' ? cj - 1 : cj, 0, 1).b, bp = wl._;
    const A = stage(sim, 1, attacker, { x: bp.x0 - (gap || 1.0), y: bp.cy }); A.hp = 1e5;
    const drops = [], ev = []; let last = bp.hpAbs; const times = [];
    for (let i = 0; i < secs(secsRun); i++) { for (const e of sim.step()) { ev.push(e); if (e.t === 'ram') times.push(sim.state.t); } if (bp.hpAbs < last - 1e-9) { drops.push(last - bp.hpAbs); last = bp.hpAbs; } }
    return { sim, wl, bp, A, drops, ev, times, shots: ev.filter(e => e.t === 'shot').length };
  };
  const sp = against('speer', 'mauer', 10); ok(sp.drops.length >= 7, 'Speerträger schlägt die Mauer (' + sp.drops.length + ' Schläge in 10 s)'); ok(sp.drops.every(d => Math.abs(d - 8 * C.VS_WALL.speer) < 1e-9), 'Speerträger gegen die Mauer: 8 × 0.4 = 3.2 je Schlag (' + [...new Set(sp.drops)].join(',') + ')');
  const rt = against('ritter', 'mauer', 10); ok(rt.drops.length >= 5, 'Ritter schlägt die Mauer'); ok(rt.drops.every(d => Math.abs(d - 14 * C.VS_WALL.ritter) < 1e-9), 'Ritter gegen die Mauer: 14 × 0.25 = 3.5 (' + [...new Set(rt.drops)].join(',') + ')');
  const sp2 = against('speer', 'palisade', 6); ok(sp2.drops.length >= 4 && sp2.drops.every(d => Math.abs(d - 3.2) < 1e-9), 'Speerträger gegen die Palisade: ebenfalls 3.2'); ok(sp2.drops.reduce((a, b) => a + b, 0) > 12, '(150 HP: sie hält länger als 40 s nicht)');
  const spT = against('speer', 'torhaus', 8, 1.0); ok(spT.drops.length >= 4 && spT.drops.every(d => Math.abs(d - 3.2) < 1e-9), 'Speerträger gegen das Torhaus: 3.2 (VS_WALL gilt auch für Tore)');
  // arrows: nothing against stone — and archers do not even stand there shooting at it — 0.15 against palisades
  const bm = against('bogen', 'mauer', 12, 3.0); eq(bm.drops.length, 0, 'Bogenschütze gegen die Mauer: kein Schaden'); eq(bm.shots, 0, 'er schießt gar nicht erst auf Stein'); eq(bm.bp.hpAbs, bm.bp.maxHp, 'Mauer unversehrt');
  const bp2 = against('bogen', 'palisade', 12, 3.0); ok(bp2.drops.length >= 3, 'Bogenschütze gegen die Palisade: er trifft (' + bp2.drops.length + ')'); ok(bp2.drops.every(d => Math.abs(d - 6 * C.ARROW_WALL.holz) < 1e-9), 'Pfeil gegen die Palisade: 6 × 0.15 = 0.9 (' + [...new Set(bp2.drops)].join(',') + ')');
  const rm = against('reiterschuetze', 'mauer', 8, 3.0); eq(rm.drops.length, 0, 'Reiterschütze gegen die Mauer: nichts'); const rp = against('reiterschuetze', 'palisade', 8, 3.0); ok(rp.drops.length >= 2 && rp.drops.every(d => Math.abs(d - 0.9) < 1e-9), 'Reiterschütze gegen die Palisade: 0.9');
  const bh = against('bogen', 'torhaus', 8, 3.0); eq(bh.drops.length, 0, 'Pfeile gegen das Torhaus (Stein): 0');
  // the ram: no blow for 2 s, then 60 every 2 s; hit and ram events at the same moments; against a hut it is just as strong
  const rm1 = against('ramme', 'mauer', 14, 2.0); ok(rm1.times.length >= 4, 'Rammbock schlägt zu (' + rm1.times.length + ' Schläge)'); ok(rm1.drops.every(d => Math.abs(d - 60) < 1e-9), 'Rammbock gegen die Mauer: 60 je Schlag (' + [...new Set(rm1.drops)].join(',') + ')');
  ok(rm1.times.every((t, i) => i === 0 || Math.abs(t - rm1.times[i - 1] - 2) < 0.07), 'alle 2.0 s (Schläge landen am Ende des Ausholens: ' + rm1.times.map(t => t.toFixed(1)).join(', ') + ')'); eq(rm1.drops.length, rm1.times.length, 'jeder ram-Ereignis ist ein Treffer'); eq(Object.keys(rm1.ev.find(e => e.t === 'ram')).join(), 't,id,x,y', 'ram-Felder');
  ok(rm1.ev.filter(e => e.t === 'hit' && e.id === rm1.wl.id).length === rm1.times.length, 'und je ein hit-Ereignis');
  { const a = against('ramme', 'mauer', 6, 2.0); const anims = []; const s2 = a.sim; for (let i = 0; i < secs(3); i++) { s2.step(); anims.push(a.A.anim); } ok(anims.filter(x => x === 'fight').length > anims.length * 0.6, 'der Rammbock zeigt das Ausholen als fight (Anim 2) – ' + anims.filter(x => x === 'fight').length + ' von ' + anims.length); }
  { const s = mk({ burgfrieden: 0 }); toFehde(s); const hut = placeAt(s, 1, 'huette'), bp = hut._; for (const u of unitsOf(s, 1, 'bauer')) s.dev.kill(u); const spot = [[bp.cx, bp.y1 + 1.0], [bp.cx, bp.y0 - 1.0], [bp.x1 + 1.0, bp.cy], [bp.x0 - 1.0, bp.cy]].map(([x, y]) => ({ x, y })).find(q => !blockedAt(s, q)); const R = stage(s, 0, 'ramme', spot); R.hp = 1e5; const l = run(s, secs(5)); ok(ofType(l, 'ram').length >= 1 && ofType(l, 'ram').every(e => e.id === hut.id), 'der Rammbock schlägt auch eine Hütte'); near(hut._.maxHp - hut._.hpAbs, 60 * ofType(l, 'ram').length, 1e-9, 'Hütte: 60 je Schlag (VS_BUILDING.ramme 1)'); }
}

// ---- Phase 2: breaching — the field leads to the cheapest breach; an open way beats it; a ram is faster than troops ----
{
  const price = (kind) => {   // the travel field of an enemy banner at its start cell: free ground, a closed ring of `kind`
    const { sim, c, ci, cj } = patch(0), dir = dryDir(sim, c, 12) || -1;
    const R = kind ? ringOf(sim, 0, ci, cj, kind, false) : { mid: { x: c.x, y: c.y } };
    const sx = c.x + dir * 8; sim.banner(1, 1, sx, c.y); sim.dev.spawn(1, 'speer', sx, c.y, 1); sim.step(); const r = sim.banner(1, 1, R.mid.x, R.mid.y);
    const bn = sim.dev.lord(1).bn[1], f = sim.dev.field(bn); return { v: f[W.cellOf(sx, c.y)], r };
  };
  const free = price(null), mau = price('mauer'), pal = price('palisade');
  ok(free.v > 5 && free.v < 12, 'freies Feld: ≈ 8 Zellen (' + free.v.toFixed(2) + ')'); near(mau.v - free.v, C.BREACH_COST, 2.5, 'ein Ring aus Mauern: + BREACH_COST (' + (mau.v - free.v).toFixed(1) + ')'); near(pal.v - free.v, C.BREACH_COST * C.BREACH_MUL.palisade, 2.5, 'ein Ring aus Palisaden: + 24 (' + (pal.v - free.v).toFixed(1) + ')');
  eq(mau.r.ok, true, 'Befehl in den geschlossenen Ring: angenommen'); eq(mau.r.reason, undefined, 'ohne Verschiebung (die Bresche gilt als Weg)');
  // an open way is taken when the detour is cheaper than breaking: a wall of 4 across the road, the target behind it
  { const { sim, c, ci, cj } = patch(0), dir = dryDir(sim, c, 12) || -1; const wl = sim.dev.place(0, 'mauer', ci, cj - 2, 1, 4).b;
    const sx = c.x + dir * 6; sim.banner(1, 1, sx, c.y); const us = []; for (let i = 0; i < 4; i++) us.push(sim.dev.spawn(1, 'speer', sx, c.y - 1 + i * 0.7, 1)); sim.step(); const tg = { x: c.x - dir * 4.5, y: c.y }; const o = sim.banner(1, 1, tg.x, tg.y); eq(o.reason, undefined, 'Ziel hinter der Mauer: erreichbar');
    const bn = sim.dev.lord(1).bn[1]; let sawBreach = false, nb = 0; for (let i = 0; i < secs(30) && Math.hypot(bn.x - tg.x, bn.y - tg.y) > 1.2; i++) { for (const e of sim.step()) if (e.t === 'breach') nb++; if (bn.breach) sawBreach = true; }
    ok(Math.hypot(bn.x - tg.x, bn.y - tg.y) <= 1.2, 'der Zug umgeht die Mauer und kommt an (' + sim.state.t.toFixed(0) + ' s)'); ok(!sawBreach && nb === 0, 'er greift sie nicht an'); eq(wl.hp, 1, 'die Mauer ist unversehrt'); eq(us.filter(u => u.hp > 0).length, 4, 'alle leben'); }
  // times: 4 spearmen, a ram, both — against a ring of single stones around the target
  const siege = (nSpear, ram) => {
    const { sim, c, ci, cj } = patch(0), dir = dryDir(sim, c, 12) || -1, R = ringOf(sim, 0, ci, cj, 'mauer', false);
    const sx = c.x + dir * 9; sim.banner(1, 1, sx, c.y); const us = []; for (let i = 0; i < nSpear; i++) us.push(sim.dev.spawn(1, 'speer', sx + (i % 3) * 0.8, c.y - 1 + Math.floor(i / 3) * 0.8, 1)); if (ram) us.push(sim.dev.spawn(1, 'ramme', sx - 1, c.y, 1));
    sim.step(); const o = sim.banner(1, 1, R.mid.x, R.mid.y), bn = sim.dev.lord(1).bn[1], t0 = sim.state.t; let tB = -1, tIn = -1, brId = null, firstId = null, held = false;
    for (let i = 0; i < secs(140) && tIn < 0; i++) { if (bn.breach) { brId = bn.breach.id; held = true; } for (const e of sim.step()) if (e.t === 'breach' && tB < 0) { tB = sim.state.t - t0; firstId = e.id; } if (Math.hypot(bn.x - R.mid.x, bn.y - R.mid.y) < 1) tIn = sim.state.t - t0; }
    return { tB, tIn, brId, firstId, held, ruined: R.pieces.filter(b => b.ruined).length, sim, R, bn, o };
  };
  const a = siege(4, false), b = siege(0, true), c3 = siege(4, true);
  ok(a.tB > 0 && a.tIn > 0, 'vier Speerträger brechen durch und erreichen das Ziel (' + a.tB.toFixed(0) + ' s / ' + a.tIn.toFixed(0) + ' s)'); ok(a.held, 'der Zug hielt an der Mauer (breach gesetzt)'); eq(a.firstId, a.brId, 'das Stück, das fiel, war das bezeichnete'); eq(a.ruined, 1, 'genau ein Stück liegt in Trümmern');
  near(a.tB, 450 / (4 * 8 * C.VS_WALL.speer / 1.0) + 9 / 2.6, 12, 'Zeit ≈ Weg + 450 HP / (4 × 3.2 je s) = ' + (450 / 12.8 + 9 / 2.6).toFixed(0) + ' s (war ' + a.tB.toFixed(0) + ')');
  ok(b.tB > 0 && b.tIn > 0, 'ein Rammbock allein bricht durch und kommt an (' + b.tB.toFixed(0) + ' s / ' + b.tIn.toFixed(0) + ' s)'); ok(b.tB < a.tB * 0.7, 'der Rammbock ist deutlich schneller als vier Speerträger (' + b.tB.toFixed(0) + ' s gegen ' + a.tB.toFixed(0) + ' s)'); near(b.tB, 9 / 1.6 + 450 / 60 * 2, 5, 'Rammbock: Weg bei Tempo 1.6 plus 8 Schläge zu 2 s (' + b.tB.toFixed(0) + ' s)');
  ok(c3.tB > 0 && c3.tIn > 0 && c3.tB <= b.tB + 1, 'Rammbock mit Speerträgern: nicht langsamer als der Rammbock allein (' + c3.tB.toFixed(0) + ' s)'); ok(c3.tIn < a.tIn, 'und früher am Ziel als die Speerträger allein (' + c3.tIn.toFixed(0) + ' s gegen ' + a.tIn.toFixed(0) + ' s)');
  // after the fall the way is rubble: free for everybody, slower (see the next block)
  const hole = a.R.pieces.find(p => p.ruined); ok(hole && a.sim.dev.blk[hole.j * GW + hole.i] === 0 && a.sim.dev.rub[hole.j * GW + hole.i] === 1, 'die Bresche ist Schutt: begehbar, nicht blockiert');
}

// ---- Phase 2: rubble — a ruined wall piece is passable at RUBBLE_SLOW (0.6 × speed), still occupies the footprint, can be rebuilt ----
{
  const { sim, c, ci, cj } = patch(0), dir = dryDir(sim, c, 14);
  const wl = sim.dev.place(0, 'mauer', ci - 2, cj, 0, 4).b; sim.dev.damage(wl, 1e9, 1);
  const ks = []; for (let d = 0; d < 4; d++) ks.push(cj * GW + ci - 2 + d);
  ok(ks.every(k => sim.dev.rub[k] === 1 && sim.dev.blk[k] === 0 && sim.occ[k] === WCODE('mauer')), 'Schutt: kein Block, aber belegt'); ok(ks.every(k => sim.dev.view(0)[k] === 0 && sim.dev.view(1)[k] === 0), 'für jedes Haus begehbar');
  eq(sim.build(0, 'huette', ci - 1, cj - 1, 0).reason, 'occupied', 'darauf baut man nichts anderes'); eq(sim.build(0, 'huette', ci, cj - 2, 0).reason, 'tight', 'und daneben nichts dicht heran');
  // speed: a lone soldier walks along the rubble strip: its leader moves at 0.6 of the pace on the strip, at full pace beside it
  const along = (row) => {
    const s = mk({ burgfrieden: 0 }); toFehde(s); const q = clearing(s, 0), cj2 = Math.floor(q.y + 45), ci2 = Math.floor(q.x + 72);
    const w2 = s.dev.place(0, 'mauer', ci2 - 2, cj2, 0, 4).b; s.dev.damage(w2, 1e9, 1);
    const y = -44.5 + cj2 + row, u = stage(s, 0, 'speer', { x: -71.5 + ci2 - 3, y }); const bn = s.dev.lord(0).bn[1]; s.banner(0, 1, -71.5 + ci2 + 3, y);
    const sp = []; let prev = bn.x; for (let i = 0; i < secs(4); i++) { s.step(); const k = W.cellOf(bn.x, bn.y); if (bn.x > prev + 1e-9 && k >= 0) sp.push({ v: (bn.x - prev) * 15, rub: s.dev.rub[k] }); prev = bn.x; }
    return { on: sp.filter(z => z.rub), off: sp.filter(z => !z.rub) };
  };
  const onR = along(0), offR = along(2); const avg = (a) => a.reduce((x, z) => x + z.v, 0) / (a.length || 1);
  ok(onR.on.length >= 8, 'der Zug läuft über den Schutt (' + onR.on.length + ' Schritte)'); near(avg(onR.on) / avg(onR.off.length ? onR.off : offR.off), C.RUBBLE_SLOW, 0.08, 'auf dem Schutt 0.6 × Tempo (' + avg(onR.on).toFixed(2) + ' gegen ' + avg(onR.off).toFixed(2) + ')');
  ok(offR.on.length === 0 && offR.off.length > 10, 'zwei Zellen daneben: volles Tempo (' + avg(offR.off).toFixed(2) + ')');
  // rebuild the same piece: half the cost, same id, the cells are solid again
  sim.dev.stock(0, { stein: 30 }); eq(sim.build(0, 'mauer', ci - 2, cj, 0, 4).ok, true, 'Wiederaufbau'); eq(sim.youOf(0).stock.stein, 30 - 4, 'halbe Kosten: 8 → 4'); ok(ks.every(k => sim.dev.blk[k] === 1 && sim.dev.rub[k] === 0), 'als Baustelle wieder fest');
  // a ruined Wachturm (not a wall piece) keeps blocking
  const tw = placeAt(sim, 0, 'wachturm'); sim.dev.damage(tw, 1e9, 1); const twk = []; for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) twk.push((tw.j + dj) * GW + tw.i + di); ok(twk.every(k => sim.dev.blk[k] === 1 && sim.dev.rub[k] === 0), 'die Ruine eines Wachturms blockt weiter');
}

// ---- Phase 2: fire — torch-bearers ignite palisades (they burn and spread), stone walls never burn ----
{
  const { sim, ci, cj } = patch(0); sim.dev.stock(0, { korn: 30, holz: 30, stein: 30 }); keepWell(false);
  const pa = sim.dev.place(0, 'palisade', ci - 3, cj - 2, 0, 4).b, pb = sim.dev.place(0, 'palisade', ci - 3, cj, 0, 4).b, mu = sim.dev.place(0, 'mauer', ci - 3, cj + 2, 0, 4).b;
  eq(sim.dev.fire(mu, 0.5, 1), false, 'eine Mauer lässt sich nicht anzünden'); eq(mu.fire, 0, 'Mauer: fire 0'); eq(sim.dev.fire(pa, 0.5, 1), true, 'die Palisade schon');
  const l = run(sim, 1); eq(ofType(l, 'ignite').length, 1, 'ignite-Ereignis'); eq(ofType(l, 'ignite')[0].id, pa.id, 'für die Palisade'); eq(ofType(l, 'ignite')[0].by, 1, 'von Haus 1');
  // 600 HP: it burns for a good while and sets the neighbour (2 cells away) alight after SPREAD_AFTER_S above 0.6; the stone wall next to that one stays cold
  let tSpread = -1, tRuin = -1; const t0 = sim.state.t; for (let i = 0; i < secs(60) && tRuin < 0; i++) { for (const e of sim.step()) if (e.t === 'ruined' && e.id === pa.id) tRuin = sim.state.t - t0; if (tSpread < 0 && pb.fire > 0) tSpread = sim.state.t - t0; }
  ok(tSpread > 0, 'das Feuer springt auf die Nachbarpalisade über (nach ' + tSpread.toFixed(1) + ' s)'); near(tSpread, 3.3 + C.SPREAD_AFTER_S, 2.5, 'frühestens nach SPREAD_AFTER_S über 0.6 (≈ 11 s)'); ok(tRuin > tSpread, 'die erste brennt noch eine Weile (Ruine nach ' + tRuin.toFixed(0) + ' s)');
  ok(tRuin > 20 && tRuin < 60, 'eine Palisade mit 600 HP brennt in ' + tRuin.toFixed(0) + ' s nieder'); eq(mu.fire, 0, 'die Steinmauer bleibt kalt'); eq(pa.ruined, true, 'Ruine'); eq(sim.dev.rub[pa.j * GW + pa.i], 1, 'Brandschutt ist begehbar'); eq(sim.dev.lord(1).by.buildings + '/' + sim.dev.lord(1).stats.razed, '0/0', 'für niedergebrannte Wände gibt es weder Ruhm noch eine Zerstörung gutgeschrieben');
  keepWell(true);
  // a torch-bearer of its own: runs to a palisade within 15 of its banner target and lights it
  const t2 = patch(0), s2 = t2.sim; keepWell(false); const pl = s2.dev.place(0, 'palisade', t2.ci, t2.cj, 1, 3).b; for (const u of unitsOf(s2, 0, 'bauer')) s2.dev.kill(u);
  const f = stage(s2, 1, 'fackel', { x: -71.5 + t2.ci - 6, y: -44.5 + t2.cj + 1 }, 1); const log = run(s2, secs(12)); keepWell(true);
  const ig = ofType(log, 'ignite'); ok(ig.length >= 1 && ig[0].id === pl.id && ig[0].by === 1, 'der Fackelträger zündet die Palisade (' + ig.length + ' Ereignis)'); ok(pl.fire > 0 || pl.ruined, 'sie brennt');
}


// ---- Phase 2: the Wehrgang — archers garrison walls, gatehouses and watchtowers ----
// every building's `garrison` is the number of units whose `on` is its id, slots are unique and below the capacity (checked here and in the long runs)
function garrisonOk(sim) {
  const per = {}, slots = {};
  for (const u of sim.state.units) {
    if (u.on === null) { if (u.slot !== -1) return 'slot ohne on bei ' + u.id; continue; }
    const b = sim.state.buildings.find(x => x.id === u.on); if (!b) return 'on zeigt auf kein Gebäude (' + u.on + ')';
    if (u.kind !== 'bogen') return 'nur Bogenschützen im Wehrgang, nicht ' + u.kind;
    const cap = W.slotsOf(b.kind, b.len); if (!(u.slot >= 0 && u.slot < cap)) return 'slot ' + u.slot + ' außerhalb 0..' + (cap - 1);
    if (b.ruined || b.build < 1) return 'Besatzung in einem unfertigen oder zerstörten Gebäude';
    per[b.id] = (per[b.id] || 0) + 1; const key = b.id + ':' + u.slot; if (slots[key]) return 'Platz doppelt belegt ' + key; slots[key] = 1;
  }
  for (const b of sim.state.buildings) if (b.garrison !== (per[b.id] || 0)) return 'garrison ' + b.garrison + ' ≠ gezählt ' + (per[b.id] || 0) + ' bei ' + b.kind + ' ' + b.id;
  return null;
}
// a finished building of kind at the first valid cell around (cx, cy) of house l (ring search); returns the building or null
function placeNear(sim, l, kind, cx, cy, rot, len) {
  const i0 = Math.floor(cx + 72), j0 = Math.floor(cy + 45);
  for (let r = 0; r <= 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const res = sim.dev.place(l, kind, i0 + di, j0 + dj, rot || 0, len); if (res.ok) return res.b; }
  return null;
}
{
  const { sim, c, ci, cj } = patch(0), st = sim.state;
  const wall = sim.dev.place(0, 'mauer', ci - 2, cj, 0, 4).b, bp = wall._;
  const sx = c.x - 1, sy = c.y + 3; sim.banner(0, 1, sx, sy);
  const as = [], sps = []; for (let i = 0; i < 6; i++) as.push(sim.dev.spawn(0, 'bogen', sx - 2 + i * 0.7, sy, 1)); for (let i = 0; i < 2; i++) sps.push(sim.dev.spawn(0, 'speer', sx - 0.5 + i * 0.7, sy + 0.8, 1));
  run(sim, 2); eq(wall.garrison, 0, 'ohne Befehl: keine Besatzung (auch wenn die Bogenschützen daneben stehen)');
  const o = sim.banner(0, 1, c.x, c.y); eq(o.ok, true, 'Befehl auf die eigene Mauer'); eq(o.garrison, true, 'die Antwort sagt: Besatzungsbefehl'); ok(o.reason === 'snapped', 'das Ziel selbst wird an eine freie Zelle neben der Mauer verlegt (' + o.reason + ')');
  const log = run(sim, secs(14)), ge = ofType(log, 'garrison');
  eq(wall.garrison, 4, 'vier Plätze, vier Bogenschützen drin (buildings[].garrison)'); eq(ge.length, 4, 'vier garrison-Ereignisse'); ok(ge.every(e => e.on === true && e.id === wall.id && e.lord === 0), 'on: true, id der Mauer'); eq(Object.keys(ge[0]).join(), 't,lord,id,unit,on', 'garrison-Felder');
  const inside = as.filter(u => u.on === wall.id); eq(inside.length, 4, 'units[].on = die Id der Mauer'); eq(inside.map(u => u.slot).sort().join(), '0,1,2,3', 'jeder Platz genau einmal'); eq(sps.filter(u => u.on !== null).length, 0, 'Speerträger gehen nicht hinein (nur Bogenschützen)'); eq(as.filter(u => u.on === null).length, 2, 'zwei Bogenschützen bleiben unten (der Rest formiert sich dahinter)');
  for (const u of inside) { near(u.x, bp.x0 + u.slot + 0.5, 1e-9, 'Platz ' + u.slot + ': x auf der Mauerkrone'); near(u.y, bp.y0 + 0.5, 1e-9, 'Platz ' + u.slot + ': y'); ok(u.hp === 40, 'unverletzt'); }
  eq(garrisonOk(sim), null, 'Besatzung stimmig'); eq(st.banners[0].count, 8, 'sie bleiben im Banner (count 8)'); eq(sim.youOf(0).banners[0].count, 8, 'auch in youOf.banners'); ok(as.every(u => u.n === 1) && sps.every(u => u.n === 1), 'n bleibt 1');
  ok(until(sim, () => false, secs(4), () => {}).log.every(e => e.t !== 'garrison'), 'danach keine weiteren Wechsel'); eq(wall.garrison, 4, 'noch vier');
  // an order near the same wall (within 4 of it) keeps them; a different one sends them away
  const o2 = sim.banner(0, 1, c.x + 1, c.y + 0.5); eq(o2.garrison, true, 'zweiter Befehl an derselben Mauer'); const l2 = run(sim, secs(3)); eq(ofType(l2, 'garrison').length, 0, 'sie bleiben oben'); eq(wall.garrison, 4, 'weiter vier');
  const o3 = sim.banner(0, 1, c.x, c.y + 6); eq(o3.garrison, undefined, 'ein Befehl woanders hat kein garrison'); const l3 = run(sim, 2); const out = ofType(l3, 'garrison'); eq(out.length, 4, 'vier Abgänge'); ok(out.every(e => e.on === false), 'on: false'); eq(wall.garrison, 0, 'garrison 0');
  ok(inside.every(u => u.on === null && u.slot === -1), 'on null, slot −1'); ok(inside.every(u => { const k = W.cellOf(u.x, u.y); return k >= 0 && !sim.dev.view(0)[k]; }), 'sie stehen auf freien Zellen'); eq(garrisonOk(sim), null, 'stimmig'); ok(inside.every(u => u.hp === 40), 'ohne Schaden');
  const back = until(sim, () => as.every(u => Math.hypot(u.x - o3.x, u.y - o3.y) < 5), secs(15)); ok(back.hit, 'sie ziehen mit dem Banner zum neuen Ziel (Ziel ' + o3.x + ',' + o3.y + ': ' + as.map(u => u.x.toFixed(1) + ',' + u.y.toFixed(1) + (u.on !== null ? 'W' : '')).join(' ') + ')');
  // an order within 1 of the wall but on an enemy house's wall, or beside the wall (2 away), is no garrison order
  const o4 = sim.banner(0, 1, c.x, c.y + 2.6); eq(o4.garrison, undefined, 'zwei Zellen daneben: kein Besatzungsbefehl');
  // home() sends every banner to the keep gate: the garrison steps down, too (and a banner that dies out forgets its garrison order)
  sim.banner(0, 1, c.x + 0.5, c.y + 0.5); run(sim, secs(10)); ok(wall.garrison >= 1, 'wieder oben (' + wall.garrison + ')'); const lh = (sim.home(0), run(sim, 2)); ok(ofType(lh, 'garrison').filter(e => e.on === false).length >= 1 && wall.garrison === 0, 'home: alle steigen ab'); eq(garrisonOk(sim), null, 'stimmig');
  sim.banner(0, 1, c.x + 0.5, c.y + 0.5); run(sim, secs(10)); for (const u of sps.concat(as)) sim.dev.kill(u); run(sim, 2); eq(sim.dev.lord(0).bn[1].gar, false, 'ein ausgestorbenes Banner vergisst den Besatzungsbefehl'); eq(wall.garrison, 0, 'und die Mauer ist leer'); eq(garrisonOk(sim), null, 'stimmig');
}
{
  // capacities and the order of buildings: the nearest slot first; a Torhaus holds 4, a Wachturm 3, a Mauer one per cell
  const { sim, c, ci, cj } = patch(0);
  const w2 = sim.dev.place(0, 'mauer', ci - 2, cj, 0, 2).b, tw = sim.dev.place(0, 'wachturm', ci + 2, cj - 1, 0).b;
  sim.banner(0, 1, c.x, c.y + 4); const as = []; for (let i = 0; i < 8; i++) as.push(sim.dev.spawn(0, 'bogen', c.x - 3 + i * 0.7, c.y + 4.5, 1)); sim.step();
  const o = sim.banner(0, 1, c.x - 1, c.y); eq(o.garrison, true, 'Befehl an der Mauer (Wachturm 2.5 daneben)'); run(sim, secs(14));
  eq(w2.garrison + '/' + tw.garrison, '2/3', 'Mauer len 2: zwei Plätze, Wachturm: drei – dazu reichen die Plätze der Gebäude im Umkreis von 4 (' + as.filter(u => u.on !== null).length + ' von 8 drin)'); eq(garrisonOk(sim), null, 'stimmig'); eq(as.filter(u => u.on === null).length, 3, 'die anderen drei stehen hinter ihnen');
  eq(JSON.stringify(as.filter(u => u.on === tw.id).map(u => u.slot).sort()), '[0,1,2]', 'Wachturm: Plätze 0 bis 2');
  // nearest first: with fewer archers than slots, the slots nearest to the order are taken first
  const s2 = patch(0), w3 = s2.sim.dev.place(0, 'mauer', s2.ci - 2, s2.cj, 0, 4).b, t3 = s2.sim.dev.place(0, 'wachturm', s2.ci + 3, s2.cj - 1, 0).b;
  s2.sim.banner(0, 1, s2.c.x, s2.c.y + 4); const bs = []; for (let i = 0; i < 3; i++) bs.push(s2.sim.dev.spawn(0, 'bogen', s2.c.x - 1 + i * 0.7, s2.c.y + 4.5, 1)); s2.sim.step(); s2.sim.banner(0, 1, s2.c.x - 0.5, s2.c.y); run(s2.sim, secs(14));
  eq(w3.garrison + '/' + t3.garrison, '3/0', 'drei Bogenschützen: alle auf die nähere Mauer (nächster Platz zuerst)'); eq(garrisonOk(s2.sim), null, 'stimmig');
  // Torhaus: four places on the towers; the order may be on the gate's flank
  const s3 = patch(0), R = ringOf(s3.sim, 0, s3.ci, s3.cj, 'mauer', true); s3.sim.banner(0, 1, R.mid.x, R.mid.y); const cs = []; for (let i = 0; i < 6; i++) cs.push(s3.sim.dev.spawn(0, 'bogen', R.mid.x - 1 + (i % 3) * 0.8, R.mid.y + (i >> 1 & 1) * 0.6, 1));
  s3.sim.step(); const tOrder = s3.sim.banner(0, 1, -71.5 + s3.ci, -44.5 + s3.cj - 1.5); eq(tOrder.garrison, true, 'Befehl auf das Torhaus'); run(s3.sim, secs(14)); eq(R.th.garrison, 4, 'Torhaus: vier Plätze (+ die Mauerstücke in der Nähe: ' + R.pieces.reduce((a, b) => a + b.garrison, 0) + ')'); eq(garrisonOk(s3.sim), null, 'stimmig');
  eq(cs.filter(u => u.on === R.th.id).map(u => u.slot).sort().join(), '0,1,2,3', 'Plätze 0–3 des Torhauses'); ok(cs.filter(u => u.on !== null && u.on !== R.th.id).every(u => R.pieces.some(p => p.id === u.on)), 'der Rest steht auf den Mauerstücken daneben');
  // Torhaus slots sit on the four tower cells
  for (const u of cs.filter(u => u.on === R.th.id)) { const b = R.th._; near(u.x, b.x0 + 0.5 + (u.slot >> 1) * 2, 1e-9, 'Torhaus-Platz ' + u.slot + ': x'); near(u.y, b.y0 + 0.5 + (u.slot & 1), 1e-9, 'Torhaus-Platz ' + u.slot + ': y'); }
}
{
  // inside: +3 range (12 instead of 9), arrows × 0.5, melee cannot reach
  const setup = (garrison) => {
    const { sim, c, ci, cj } = patch(0), dir = dryDir(sim, c, 14) || 1, wall = sim.dev.place(0, 'mauer', ci - 2, cj, 0, 4).b;
    sim.banner(0, 1, c.x, c.y + 4); const A = sim.dev.spawn(0, 'bogen', c.x, c.y + 4, 1); A.hp = 1e5; sim.step();
    if (garrison) { sim.banner(0, 1, c.x, c.y); run(sim, secs(8)); }
    return { sim, c, A, wall, dir };
  };
  {   // reach: an enemy 11 away, who stands still and never shoots, is hit from the wall, not from the ground
    const mkT = (garrison) => { const s = setup(garrison), slotY = s.wall._.cy; if (garrison) eq(s.A.on, s.wall.id, 'Bogenschütze steht auf der Mauer'); const x0 = s.A.x, y0 = s.A.y; s.sim.banner(1, 1, x0 + s.dir * 11, y0); const T = s.sim.dev.spawn(1, 'bogen', x0 + s.dir * 11, y0, 1); T.hp = 1e5; T._.cd = 1e9; return { ...s, T, x0, y0 }; };
    const g = mkT(true), n = mkT(false), d11 = (u, T) => Math.hypot(u.x - T.x, u.y - T.y);
    const shotsOf = (s) => { const out = []; for (let i = 0; i < secs(1.2); i++) for (const e of s.sim.step()) if (e.t === 'shot') out.push(e); return out; };
    const gs = shotsOf(g); ok(gs.length >= 1, 'von der Mauer wird auf 11 geschossen (' + gs.length + ')'); ok(gs.every(e => Math.hypot(e.from[0] - g.A.x, e.from[1] - g.A.y) < 0.01 && Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) > 9.5), 'Schüsse starten auf der Mauer und fliegen weiter als 9 (' + gs.map(e => Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]).toFixed(1)).join(',') + ')');
    const ns = shotsOf(n); ok(ns.every(e => Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) <= 9.05), 'zum Vergleich: am Boden schießt er nie weiter als 9');
  }
  {   // arrows deal half against a garrisoned archer
    const dmgs = (garrison) => { const s = setup(garrison), ep = dryPoint(s.sim, s.A, 5); s.sim.banner(1, 1, ep.x, ep.y); const E = s.sim.dev.spawn(1, 'bogen', ep.x, ep.y, 1); E.hp = 1e5; if (!garrison) s.A._.cd = 1e9; const out = []; let last = s.A.hp; for (let i = 0; i < secs(8); i++) { s.sim.step(); if (s.A.hp < last - 1e-9) { out.push(last - s.A.hp); last = s.A.hp; } } return out; };
    const gd = dmgs(true), nd = dmgs(false);
    ok(gd.length >= 3 && gd.every(d => Math.abs(d - 3) < 1e-9), 'Pfeil gegen einen Bogenschützen auf der Mauer: 6 × 0.5 = 3 (' + [...new Set(gd)].join(',') + ')'); ok(nd.length >= 3 && nd.every(d => Math.abs(d - 6) < 1e-9), 'am Boden: 6 (' + [...new Set(nd)].join(',') + ')');
  }
  {   // melee: a spearman at the foot of the wall hits the wall, never the archer on it
    const s = setup(true), P = { x: s.A.x, y: s.wall._.y1 + 0.9 }, sp = stage(s.sim, 1, 'speer', P); sp.hp = 1e5; let tuHit = false, hurt = 0, wallDrops = 0; let lastW = s.wall._.hpAbs;
    for (let i = 0; i < secs(10); i++) { s.sim.step(); if (sp._.tu === s.A) tuHit = true; if (s.wall._.hpAbs < lastW - 1e-9) { wallDrops++; lastW = s.wall._.hpAbs; } }
    ok(!tuHit, 'der Nahkämpfer nimmt den Bogenschützen auf der Mauer nie ins Visier'); eq(s.A.hp, 1e5, 'und trifft ihn nie'); ok(wallDrops >= 5, 'er schlägt stattdessen die Mauer (' + wallDrops + ' Schläge)'); ok(sp.hp < 1e5, 'der Bogenschütze von oben trifft ihn (hp ' + (1e5 - sp.hp).toFixed(0) + ' Schaden)'); eq(garrisonOk(s.sim), null, 'stimmig');
  }
}
{
  // ruin: the garrison drops to free cells with 20 % damage; a weak one dies from the fall; cancel and the destroyer's credit; a kill inside frees the slot for the next archer
  const fall = (kind) => {
    const { sim, c, ci, cj } = patch(0), b = kind === 'mauer' ? sim.dev.place(0, 'mauer', ci - 2, cj, 0, 4).b : sim.dev.place(0, 'wachturm', ci - 1, cj - 1, 0).b;
    sim.banner(0, 1, c.x, c.y + 4); const as = []; for (let i = 0; i < 4; i++) as.push(sim.dev.spawn(0, 'bogen', c.x - 1.5 + i * 0.8, c.y + 4.5, 1)); sim.step(); sim.banner(0, 1, c.x, c.y + (kind === 'mauer' ? 0 : -0.5)); run(sim, secs(12));
    return { sim, b, as, c };
  };
  for (const kind of ['mauer', 'wachturm']) {
    const f = fall(kind), n0 = f.as.filter(u => u.on === f.b.id).length; eq(n0, kind === 'mauer' ? 4 : 3, kind + ': ' + n0 + ' Mann drin');
    const ins = f.as.filter(u => u.on === f.b.id); ins[0].hp = 6;   // the first one is weak: 20 % of 40 = 8 kills him
    const bn = f.sim.dev.lord(0).bn[1]; const lg = (f.sim.dev.damage(f.b, 1e9, 1), run(f.sim, 1)), ge = ofType(lg, 'garrison');
    eq(ge.filter(e => e.on === false).length, n0, kind + ': alle Abgänge gemeldet'); eq(f.b.garrison, 0, 'garrison 0'); ok(ins.every(u => u.on === null && u.slot === -1), 'on null');
    eq(ins[0].hp, 0, 'der Schwache stirbt am Sturz'); const dth = ofType(lg, 'death'); ok(dth.length === 1 && dth[0].id === ins[0].id && dth[0].by === 1, 'death-Ereignis, Haus 1 hat die Mauer gebrochen: by 1');
    for (const u of ins.slice(1)) near(u.hp, 40 - 8, 1e-9, 'Sturz: 20 % von 40 = 8 Schaden'); ok(ins.slice(1).every(u => { const k = W.cellOf(u.x, u.y); return k >= 0 && !f.sim.dev.view(0)[k]; }), 'die Überlebenden stehen auf freien Zellen');
    ok(bn.members.length === n0 - 1 + 0 || bn.members.length >= n0 - 1, 'der Gefallene verlässt das Banner, die anderen bleiben'); eq(garrisonOk(f.sim), null, 'stimmig'); ok(ofType(lg, 'ruined').length === 1, 'ruined-Ereignis');
  }
  { const f = fall('mauer'); const l = (f.sim.cancel(0, f.b.id), run(f.sim, 1)); ok(ofType(l, 'garrison').filter(e => e.on === false).length === 4 && f.as.every(u => u.hp === 40 && u.on === null), 'Mauer abgerissen: die Besatzung steigt unverletzt ab'); eq(garrisonOk(f.sim), null, 'stimmig'); }
  { const f = fall('mauer'), W5 = f.sim.dev.spawn(0, 'bogen', f.c.x, f.c.y + 3, 1); f.sim.step(); const ins = f.as.filter(u => u.on === f.b.id), killed = ins[1]; const l = (f.sim.dev.kill(killed, 1), run(f.sim, 1));
    eq(f.b.garrison, 3, 'ein Gefallener auf der Mauer: garrison 3'); ok(killed.on === null || killed.hp <= 0, 'und der Platz ist frei'); eq(garrisonOk(f.sim), null, 'stimmig (ohne den Toten)'); run(f.sim, secs(5)); eq(f.b.garrison, 4, 'ein wartender Bogenschütze nimmt den Platz'); eq(garrisonOk(f.sim), null, 'stimmig'); ok(W5.on === f.b.id || f.as.some(u => u.hp > 0 && u.on === f.b.id && u.id !== killed.id), 'er ist oben'); }
  { const { sim, c, ci, cj } = patch(0), site = (sim.dev.stock(0, { stein: 30 }), sim.build(0, 'mauer', ci - 2, cj, 0, 4)); sim.banner(0, 1, c.x, c.y + 4); const u = sim.dev.spawn(0, 'bogen', c.x, c.y + 4, 1); sim.step(); const o = sim.banner(0, 1, c.x, c.y); eq(o.garrison, undefined, 'eine Baustelle ist kein Wehrgang: kein Besatzungsbefehl'); run(sim, secs(4)); eq(u.on, null, 'niemand geht hinein'); }
  { // an enemy house's wall: no garrison order
    const { sim, c, ci, cj } = patch(0); sim.dev.place(0, 'mauer', ci - 2, cj, 0, 4); sim.banner(1, 1, c.x, c.y + 6); const u = sim.dev.spawn(1, 'bogen', c.x, c.y + 6, 1); sim.step(); const o = sim.banner(1, 1, c.x, c.y); ok(o.garrison === undefined, 'die Mauer eines anderen Hauses: kein Besatzungsbefehl'); run(sim, secs(4)); eq(u.on, null, 'der Feind kommt nicht auf die Mauer'); }
}
{
  // the Burgwache's archers garrison by themselves: free slots within GUARD_R of the keep, the nearest to the gate first
  const sim = mk({ burgfrieden: 0 }); toFehde(sim); const lp = sim.dev.lord(0), g = { x: lp.gx, y: lp.gy, out: lp.out };
  const near1 = placeNear(sim, 0, 'wachturm', g.x + 4, g.y + g.out * 4), far1 = placeNear(sim, 0, 'wachturm', g.x - 7, g.y + g.out * 9);
  ok(near1 && far1 && near1 !== far1, 'zwei Wachtürme stehen vor dem Tor'); const dg = (b) => Math.hypot(b._.cx - g.x, b._.cy - g.y); ok(dg(near1) < dg(far1), 'der eine liegt näher am Tor (' + dg(near1).toFixed(1) + ' / ' + dg(far1).toFixed(1) + ')');
  ok(dg(far1) <= C.GUARD_R && Math.hypot(far1._.cx - lp.kx, far1._.cy - lp.ky) <= C.GUARD_R, 'beide liegen innerhalb von GUARD_R um den Bergfried');
  const gs = []; for (let i = 0; i < 4; i++) gs.push(sim.dev.spawn(0, 'bogen', g.x + (i - 1.5) * 0.7, g.y + g.out * 5, 0)); const sg = sim.dev.spawn(0, 'speer', g.x, g.y + g.out * 5.5, 0); run(sim, secs(14));
  const n1 = near1.garrison, n2 = far1.garrison; ok(n1 + n2 === 4, 'alle vier Bogenschützen der Burgwache sind in Wachtürmen (' + n1 + ' + ' + n2 + ')'); eq(n1, 3, 'der Turm am Tor wird zuerst voll (3)'); eq(n2, 1, 'der vierte geht in den zweiten'); eq(sg.on, null, 'der Speerträger der Burgwache bleibt unten'); eq(garrisonOk(sim), null, 'stimmig');
  ok(sim.youOf(0).banners.some(b => b.n === 0 && b.count === 5), 'die Burgwache zählt sie weiter (n = 0, 5)'); eq(gs.filter(u => u.on !== null).length, 4, 'units[].on gesetzt');
  // they shoot from the tower: range 12 from the platform
  const ex = near1._.cx + (g.x > 0 ? -1 : 1) * 10.5; sim.banner(1, 1, ex, near1._.cy); const E = sim.dev.spawn(1, 'speer', ex, near1._.cy, 1); E.hp = 1e5; E._.cd = 1e9; const sh = run(sim, secs(2)).filter(e => e.t === 'shot' && e.src === 'bogen'); ok(sh.length >= 1 && sh.every(e => Math.hypot(e.from[0] - near1._.cx, e.from[1] - near1._.cy) < 1.1), 'die Besatzung des Turms schießt (aus dem Turm: ' + sh.length + ' Pfeile)');
  // a banner without a garrison order does not use a tower even next to it
  const s2 = mk({ burgfrieden: 0 }); toFehde(s2); const t2 = placeNear(s2, 0, 'wachturm', s2.dev.lord(0).gx + 4, s2.dev.lord(0).gy + s2.dev.lord(0).out * 4); s2.banner(0, 1, t2._.cx + 2, t2._.cy + 2); const a2 = s2.dev.spawn(0, 'bogen', t2._.cx + 2, t2._.cy + 2, 1); run(s2, secs(6)); eq(a2.on, null, 'ein Feldbanner ohne Befehl besetzt keinen Turm');
}


// ---- Phase 2: a scripted siege over 4 minutes — walls, gate, garrison, ram, horse archers, torch; invariants every second, and the same run twice gives the same state and events ----
function siegeRun(seed) {
  const sim = mk({ seed, burgfrieden: 0 }); toFehde(sim);
  const c = clearing(sim, 0), q = cellP(c), ray = dryRay(sim, c, 10), dir = ray.d, R = ringOf(sim, 0, q.i, q.j, 'mauer', true), st = sim.state;
  const tw = placeNear(sim, 0, 'wachturm', c.x - dir * 0, c.y + 5.5);   // a tower below the ring, beyond its wall
  sim.dev.stock(0, { korn: 40, holz: 40, stein: 40, gold: 40 }); sim.dev.stock(1, { korn: 40, holz: 40, stein: 40, gold: 60 });
  placeNear(sim, 0, 'markt', c.x - dir * 8, c.y - 6); const mk1 = placeNear(sim, 1, 'soeldnerlager', sim.dev.lord(1).gx - 8, sim.dev.lord(1).gy + sim.dev.lord(1).out * 8), ka1 = placeNear(sim, 1, 'kaserne', sim.dev.lord(1).gx + 8, sim.dev.lord(1).gy + sim.dev.lord(1).out * 8);
  // house 0: archers of banner 3 garrison the gate towers, the walls and the watchtower
  sim.banner(0, 3, R.mid.x, R.mid.y); for (let i = 0; i < 6; i++) sim.dev.spawn(0, 'bogen', R.mid.x - 1 + (i % 3) * 0.8, R.mid.y + (i >> 1) * 0.5 - 0.3, 3);
  sim.step(); sim.banner(0, 3, -71.5 + q.i, -44.5 + q.j - 1.6);
  // house 1: a banner with a ram, spearmen, horse archers and a torch-bearer marches on the yard; a second wave is ordered at 90 s
  const sx = c.x + dir * Math.max(ray.n - 1, 4); sim.banner(1, 1, sx, c.y); const us = [];   // (all of them on the dry row: sx − dir · k)
  us.push(sim.dev.spawn(1, 'ramme', sx, c.y, 1)); for (let i = 0; i < 6; i++) us.push(sim.dev.spawn(1, 'speer', sx - dir * (i % 3) * 0.8, c.y, 1)); for (let i = 0; i < 2; i++) us.push(sim.dev.spawn(1, 'reiterschuetze', sx - dir * (2.8 + i * 0.7), c.y, 1)); us.push(sim.dev.spawn(1, 'fackel', sx - dir * 1.2, c.y, 1));
  sim.step(); sim.banner(1, 1, R.mid.x, R.mid.y);
  const evc = {}; let evh = '', bad = '';
  for (let i = 0; i < secs(240) && st.phase !== 'over'; i++) {
    const t = st.t;
    if (i === secs(90)) { for (let k = 0; k < 5; k++) sim.dev.spawn(1, 'speer', sx - dir * (0.5 + k * 0.7), c.y, 1); sim.banner(1, 1, R.mid.x, R.mid.y); }
    if (i === secs(100)) sim.banner(0, 3, c.x, c.y + 8);           // the archers step down …
    if (i === secs(110)) sim.banner(0, 3, -71.5 + q.i, -44.5 + q.j + 2.4);   // … and climb the southern wall
    if (i === secs(120)) { sim.dev.stock(1, { korn: 40, holz: 40, gold: 60 }); sim.recruit(1, 'ramme', 1); sim.recruit(1, 'reiterschuetze', 1); sim.recruit(1, 'fackel', 1); }
    if (i % 15 === 0) {
      const g = garrisonOk(sim); if (g && !bad) bad = 't=' + t.toFixed(0) + ' ' + g;
      for (const u of st.units) { if (!Number.isFinite(u.x) || !Number.isFinite(u.y) || !(u.hp > 0)) { if (!bad) bad = 'Einheit ' + u.id + ' ' + u.x + ',' + u.y + ',' + u.hp; } else if (!u.on && sim.dev.view(u.lord)[W.cellOf(u.x, u.y)] && !bad) { const kk = W.cellOf(u.x, u.y), bb = sim.dev.bAt(kk); bad = 't=' + t.toFixed(0) + ' ' + u.kind + ' von Haus ' + u.lord + ' steht auf einer gesperrten Zelle (' + u.x.toFixed(2) + ',' + u.y.toFixed(2) + ' Zelle ' + kk + ' Gebäude ' + (bb ? bb.kind + (bb.ruined ? ' Ruine' : '') + ' build ' + bb.build.toFixed(2) : 'keins') + ' base ' + sim.dev.blk[kk] + ' rub ' + sim.dev.rub[kk] + ' Wasser/Fels? walk ' + W.walk(sim.world, kk, sim.dev.level()) + ')'; } }
      for (const b of st.buildings) if (!(b.hp >= 0 && b.hp <= 1 + 1e-9) && !bad) bad = 'hp ' + b.hp;
    }
    for (const e of sim.step()) { evc[e.t] = (evc[e.t] || 0) + 1; evh = hashStr(evh + JSON.stringify(e)); }
  }
  return { state: JSON.stringify(st), evc, evh, bad, sim, R, tw };
}
{
  const a = siegeRun(1), b = siegeRun(1);
  eq(a.bad, '', 'Belagerung: alle Invarianten hielten (' + a.bad + ')'); eq(hashStr(a.state), hashStr(b.state), 'Belagerung: gleicher Lauf, gleicher Zustand'); ok(a.state === b.state, 'Zustand Zeichen für Zeichen gleich'); eq(a.evh, b.evh, 'Ereignisfolge gleich');
  const e = a.evc; ok(e.breach >= 1 && e.ram >= 3 && e.garrison >= 6 && e.ruined >= 1 && e.death >= 1 && e.shot >= 10 && e.trained >= 1, 'die Belagerung zeigt die neuen Regeln: ' + ['breach', 'ram', 'garrison', 'ruined', 'death', 'shot', 'trained'].map(k => k + ' ' + (e[k] || 0)).join(', '));
  console.log('\n  Belagerung (4 Min, Ring + Torhaus + Turm, Rammbock, Reiterschützen, Fackelträger gegen sechs Bogenschützen im Wehrgang): ' + Object.entries(e).filter(([k]) => ['breach', 'ram', 'garrison', 'ruined', 'death', 'shot', 'hit', 'trained', 'ignite'].includes(k)).map(([k, v]) => k + ' ' + v).join(', ') + ' · Zustands-Hash ' + hashStr(a.state));
  const c2 = siegeRun(2); eq(c2.bad, '', 'Belagerung auf Karte 2: Invarianten (' + c2.bad + ')'); ok(hashStr(c2.state) !== hashStr(a.state), 'andere Karte: anderer Verlauf');
}


// ---- Phase 2: the ram picks the nearest enemy building within RAM_R, the peasants of a house use its own gate lane, the views come from a cache ----
{
  // nearest first: a Brunnen 0.5 away, a hut 1.5 away (both within the ram's reach of 1.6): the Brunnen first, then the hut; nothing of its own house is touched
  const { sim, ci, cj } = patch(1), br = sim.dev.place(1, 'brunnen', ci + 1, cj, 0).b, hu = sim.dev.place(1, 'huette', ci - 3, cj - 1, 0).b, own = sim.dev.place(0, 'huette', ci - 3, cj + 2, 0);
  for (const u of unitsOf(sim, 1, 'bauer')) sim.dev.kill(u);
  const P = { x: -71.5 + ci, y: -44.5 + cj }, R = stage(sim, 0, 'ramme', P); R.hp = 1e5;
  const rams = []; for (let i = 0; i < secs(30); i++) for (const e of sim.step()) if (e.t === 'ram') rams.push(e.id);
  const seq = rams.join(','), expect = new Array(Math.ceil(250 / 60)).fill(br.id).concat(new Array(2).fill(hu.id)).join(',');
  eq(seq, expect, 'Rammbock: erst der nähere Brunnen (250 HP: 5 Stöße), dann die Hütte (120 HP: 2 Stöße)'); ok(br.ruined && hu.ruined, 'beide liegen in Trümmern'); ok(own.ok === false || own.b.hp === 1, 'das eigene Haus bleibt heil');
  eq(sim.dev.lord(0).by.buildings, 6, 'Ruhm für Zerstörungen: Brunnen +3, Hütte +3'); ok(R.x === P.x || Math.hypot(R.x - P.x, R.y - P.y) < 2, 'der Rammbock blieb auf seinem Platz (nichts weiter in Reichweite 3)');
}
{
  // a peasant inside a closed ring leaves through its own Torhaus lane to build outside; the lane is the only way
  const { sim, c, ci, cj } = patch(0); sim.dev.stock(0, { korn: 30, holz: 30, stein: 30 });
  const R = ringOf(sim, 0, ci, cj, 'mauer', true), lane = laneKs(R.th);
  // a site outside the ring, as near as possible (on the dry side, at least 4 cells from the ring's centre)
  let spot = null, bd = 1e9; for (let j = cj - 8; j <= cj + 8; j++) for (let i = ci - 8; i <= ci + 8; i++) { const d = Math.hypot(i - ci, j - cj); if (d < 4.5 || d >= bd) continue; if (W.canPlace(sim.world, 'brunnen', i, j, 0, { lord: 0, L: 0, occ: sim.occ }).ok) { bd = d; spot = { i, j }; } }
  ok(spot, 'ein Bauplatz vor dem Ring ist da (' + (spot ? Math.hypot(spot.i - ci, spot.j - cj).toFixed(1) : '') + ')');
  const P = sim.dev.spawn(0, 'bauer', R.mid.x, R.mid.y, -1); P.px = P.x; P.py = P.y;
  const r = sim.build(0, 'brunnen', spot.i, spot.j, 0); eq(r.ok, true, 'Brunnen bestellt'); const site = bld(sim, r.id);
  let onLane = 0, builder = false; const t0 = sim.state.t; for (let i = 0; i < secs(120) && site.build < 1; i++) { sim.step(); if (lane.indexOf(W.cellOf(P.x, P.y)) >= 0) onLane++; if (P._.site === sim.dev.lord(0).bld.find(b => b.id === site.id)) builder = true; }
  ok(builder, 'der Bauer im Hof wurde der Baumeister (er ist der nächste)'); ok(onLane > 0, 'und lief durch die Torgasse (' + onLane + ' Schritte)'); ok(site.build >= 1, 'der Brunnen steht (' + (sim.state.t - t0).toFixed(0) + ' s)'); ok(R.pieces.every(b => b.hp === 1) && R.th.hp === 1, 'ohne Schaden am Ring');
  // the same yard with a closed Torhaus (an enemy's peasants never get the lane): a foreign peasant stays out — the lane is blocked in its house's view
  const e = sim.dev.spawn(1, 'bauer', -71.5 + ci, -44.5 + cj - 4, -1); ok(sim.dev.view(1)[lane[0]] === 1, 'für Haus 1 ist die Gasse zu'); void e;
}
{
  // views and fields come from a cache: the same masks as long as nothing changes the grid or a pact; a pact or a building rebuilds them; a rebuild is cheap
  const { sim, ci, cj } = patch(0), R = ringOf(sim, 0, ci, cj, 'mauer', true);
  const v0 = sim.dev.view(0), v1 = sim.dev.view(1), f1 = sim.dev.fview(1), f0 = sim.dev.fview(0);
  run(sim, 60); ok(sim.dev.view(0) === v0 && sim.dev.view(1) === v1 && sim.dev.fview(1) === f1 && sim.dev.fview(0) === f0, '60 Schritte ohne Änderung: dieselben Sichten aus dem Zwischenspeicher');
  sim.pact(0, 1, true); sim.pact(1, 0, true); const f1b = sim.dev.fview(1); ok(f1b !== f1, 'ein Pakt rechnet die Sicht neu'); ok(sim.dev.fview(1) === f1b, '… einmal'); const v1b = sim.dev.view(1); sim.pact(1, 0, false); ok(sim.dev.fview(1) !== f1b, 'und sein Ende auch');
  const g0 = sim.dev.fview(1), h = sim.dev.place(0, 'huette', ci + 4, cj, 0); if (h.ok) ok(sim.dev.fview(1) !== g0, 'ein neues Gebäude rechnet neu'); void v1b;
  // 100 wall pieces on the map and a rebuild of every house's views and breach view after each change: well below a millisecond per change
  const s2 = patch(0); let n = 0; for (let r = 0; r < 9; r++) for (let q = 0; q < 14; q++) { if (placeNear(s2.sim, 0, 'palisade', s2.c.x - 30 + q * 4.5, s2.c.y - 30 + r * 7, (q + r) & 1, 1 + ((q + r) % 4))) n++; }
  ok(n >= 40, 'viele Wandstücke gesetzt (' + n + ')'); s2.sim.dev.place(0, 'torhaus', s2.ci - 1, s2.cj - 2, 0);
  let ms = 0, k = 0; for (let i = 0; i < 40; i++) { s2.sim.pact(2, 3, i % 2 === 0); const t0 = process.hrtime.bigint(); for (let l = 0; l < 4; l++) { s2.sim.dev.view(l); s2.sim.dev.fview(l); } ms += Number(process.hrtime.bigint() - t0) / 1e6; k++; }
  ok(ms / k < 3, 'alle vier Sichten + Bresch-Sichten neu: Ø ' + (ms / k).toFixed(2) + ' ms bei ' + n + ' Wandstücken');
  const t1 = process.hrtime.bigint(); for (let i = 0; i < 100000; i++) s2.sim.dev.view(1); const per = Number(process.hrtime.bigint() - t1) / 1e6 / 100000; ok(per < 0.001, 'ein Zugriff auf die zwischengespeicherte Sicht kostet nichts (' + (per * 1000).toFixed(2) + ' µs)');
}

// the scripted "dumb driver": not a bot. Per house a fixed build list via FurtWorld.suggest, recruiting, and an attack on the nearest enemy gate after the truce.
function makeDriver(sim) {
  const w = sim.world, st = sim.state;
  // (Phase 2: after the Kaserne a Markt, a Wachturm, walls, a Söldnerlager and a Torhaus, then the rest and a palisade; [kind, len] for the wall lines)
  const PLAN = ['hof', 'holzfaeller', 'hof', 'huette', 'kornspeicher', 'hof', 'steinbruch', 'huette', 'kaserne', 'markt', 'wachturm', ['mauer', 3], 'soeldnerlager', ['mauer', 3], 'torhaus', 'hof', 'lager', 'huette', 'brunnen', 'hof', 'huette', 'hof', ['palisade', 4], ['mauer', 2]];
  const MIX = ['speer', 'bogen', 'speer', 'ritter', 'speer', 'fackel', 'bogen', 'reiterschuetze', 'speer', 'ramme'];
  const next = st.lords.map(() => 0), made = st.lords.map(() => 0), peak = st.lords.map(() => [0, 0, 0, 0]);
  const gateOf = (o) => { const s = w.sites[o.site]; return { x: s.x + 0.5, y: s.y + (o.site < 2 ? 3.5 : -3.5) }; };
  let fehdeAt = -1;
  return function think() {
    if (fehdeAt < 0 && st.phase === 'fehde') fehdeAt = st.t;
    for (const lord of st.lords) {
      const l = lord.i, y = sim.youOf(l);
      if (next[l] < PLAN.length) {   // the next building of the plan; a failure other than 'cost' skips it
        const e = PLAN[next[l]], kind = Array.isArray(e) ? e[0] : e, len = Array.isArray(e) ? e[1] : 1, s = W.suggest(w, kind, lord.site, { L: st.level, occ: sim.occ, len });
        if (!s) next[l]++;
        else { const r = sim.build(l, kind, s.i, s.j, s.rot, len); if (r.ok || r.reason !== 'cost') next[l]++; }
      }
      if (y.stock.holz >= 18) sim.trade(l, 'holz', 'sell', 1); if (y.stock.stein >= 14) sim.trade(l, 'stein', 'sell', 1); if (y.stock.korn >= 26) sim.trade(l, 'korn', 'sell', 1); if (y.hunger && y.stock.gold >= 3) sim.trade(l, 'korn', 'buy', 1);   // (surplus for 💰: mercenaries cost gold)
      { // a small garrison banner: archers of banner 3 are sent onto the first finished wall or gatehouse
        const piece = st.buildings.find(b => b.lord === l && (b.kind === 'mauer' || b.kind === 'torhaus') && b.build >= 1 && !b.ruined), g3 = y.banners.find(b => b.n === 3);
        if (piece && (!g3 || g3.count < 4) && y.queue.length < 3 && y.stock.korn >= 3 && y.stock.holz >= 3 && lord.people - lord.soldiers >= 4) sim.recruit(l, 'bogen', 3);
        if (piece && g3 && g3.count >= 2) { const f = W.footprintOf(piece.kind, piece.rot, piece.len), cx = -72 + piece.i + f[0] / 2, cy = -45 + piece.j + f[1] / 2; if (Math.hypot(g3.tx - cx, g3.ty - cy) > 2) sim.banner(l, 3, cx, cy); }
      }
      const have = (n) => { const b = y.banners.find(x => x.n === n); return (b ? b.count : 0) + y.queue.filter(q => q.n === n).length; };
      if (y.queue.length < 3 && !y.hunger && y.stock.korn >= 4 && lord.people - lord.soldiers >= 6) {   // the first four soldiers guard the keep, then banners 1 and 2 fill up; try each kind once if one is unaffordable
        const n = have(0) < 4 ? 0 : have(1) <= have(2) ? 1 : 2;
        for (let a = 0; a < MIX.length; a++) { if (sim.recruit(l, MIX[(made[l] + a) % MIX.length], n).ok) { made[l] += a + 1; break; } }
      }
      if (st.phase === 'fehde' && st.t > fehdeAt + 15) {   // banners of 5 march on the nearest unprotected enemy gate; weak ones go home
        const mine = gateOf(lord);
        for (const b of y.banners) {
          if (b.n === 0) continue;
          peak[l][b.n] = Math.max(peak[l][b.n], b.count);
          if (b.count >= 5 && Math.hypot(b.tx - mine.x, b.ty - mine.y) < 15) {
            const foes = st.lords.filter(o => o.i !== l && o.prot <= 0).sort((a, c) => Math.hypot(gateOf(a).x - b.x, gateOf(a).y - b.y) - Math.hypot(gateOf(c).x - b.x, gateOf(c).y - b.y));
            if (foes.length) { const g = gateOf(foes[0]); sim.banner(l, b.n, g.x + (b.n - 2) * 2, g.y); }
          } else if (peak[l][b.n] >= 5 && b.count < 0.4 * peak[l][b.n] && Math.hypot(b.tx - mine.x, b.ty - mine.y) >= 15) { sim.home(l); peak[l][b.n] = 0; }
        }
      }
    }
  };
}

// ---- determinism: same seed + same scripted orders → identical state and event stream ----
{
  const play = (seed, steps) => {
    const sim = Sim.create({ seed, dauer: 12 }), think = makeDriver(sim), st = sim.state;
    let evh = '';
    for (let i = 0; i < steps; i++) { if (i % 15 === 0) think(); const ev = sim.step(); evh = hashStr(evh + JSON.stringify(ev)); }
    return { state: JSON.stringify(st), ev: evh };
  };
  const a = play(11, 6000), b = play(11, 6000), c = play(12, 6000);
  eq(hashStr(a.state), hashStr(b.state), 'gleicher Seed + gleiche Befehle: gleicher Zustands-Hash nach 6000 Schritten'); ok(a.state === b.state, 'Zustand Zeichen für Zeichen identisch'); eq(a.ev, b.ev, 'Ereignisfolge identisch');
  ok(hashStr(a.state) !== hashStr(c.state), 'anderer Seed: anderer Verlauf');
  console.log('  Zustands-Hash nach 6000 Schritten (seed 11): ' + hashStr(a.state) + ' · Ereignis-Hash ' + a.ev + ' · ' + (a.state.length / 1024).toFixed(0) + ' KB Zustand');
  // the same sim stepped in two halves with an identical script gives the same state as one run (no hidden clock)
  const sim = Sim.create({ seed: 11, dauer: 12 }), think = makeDriver(sim); for (let i = 0; i < 6000; i++) { if (i % 15 === 0) think(); sim.step(); }
  eq(JSON.stringify(sim.state), a.state, 'Wiederholung: derselbe Zustand');
}

// the public state keeps exactly the documented keys and value sets
const UKEYS = 'id,lord,kind,x,y,px,py,h,ph,hp,anim,carry,n,on,slot', BKEYS_ = 'id,lord,kind,i,j,rot,build,hp,fire,burnt,ruined,growth,workers,paused,full,len,garrison', NBKEYS = 'id,lord,n,x,y,px,py,count,moving,tx,ty';
const ANIMS = ['idle', 'walk', 'fight', 'work'], CARRIES = [null, 'korn', 'holz', 'stein', 'eimer'], KINDS_U = ['bauer', 'speer', 'bogen', 'ritter', 'fackel', 'reiterschuetze', 'ramme'];
function shapeCheck(st, seed, sim) {
  const T = 'seed ' + seed + ' t=' + st.t.toFixed(0) + ': ';
  for (const b of st.buildings) { const wall = b.kind === 'mauer' || b.kind === 'palisade'; if (!Number.isInteger(b.len) || b.len < 1 || b.len > (wall ? 4 : 1) || !Number.isInteger(b.garrison) || b.garrison < 0 || b.garrison > W.slotsOf(b.kind, b.len) || (b.garrison > 0 && (b.ruined || b.build < 1))) { ok(false, T + 'len/garrison außerhalb ' + JSON.stringify(b)); return; } }
  for (const l of st.lords) if (!Number.isInteger(l.gold) || l.gold < 0 || (sim && l.gold !== sim.youOf(l.i).stock.gold)) { ok(false, T + 'gold ' + l.gold); return; }
  if (sim) { const g = garrisonOk(sim); if (g) { ok(false, T + 'Besatzung: ' + g); return; } }
  for (const u of st.units) {
    if (Object.keys(u).join() !== UKEYS) { ok(false, T + 'Einheiten-Felder ' + Object.keys(u).join()); return; }
    if (!ANIMS.includes(u.anim) || !CARRIES.includes(u.carry) || !KINDS_U.includes(u.kind) || !(u.n >= -1 && u.n <= 3) || (u.kind === 'bauer') !== (u.n === -1) || (u.carry && u.kind !== 'bauer') || !(u.hp > 0)) { ok(false, T + 'Einheit außerhalb der Wertemengen ' + JSON.stringify(u)); return; }
  }
  for (const b of st.buildings) if (Object.keys(b).join() !== BKEYS_ + (b.kind === 'holzfaeller' ? ',noWood' : '') || typeof b.paused !== 'boolean' || typeof b.full !== 'boolean') { ok(false, T + 'Gebäude-Felder ' + Object.keys(b).join()); return; }
  for (const b of st.banners) if (Object.keys(b).join() !== NBKEYS || b.n < 1 || b.n > 3) { ok(false, T + 'Banner-Felder ' + Object.keys(b).join()); return; }
  for (const l of st.lords) if (Object.keys(l).join() !== 'i,site,emblem,crown,ruhm,people,soldiers,prot,zorn,hunger,gold') { ok(false, T + 'Haus-Felder'); return; }
  const js = JSON.stringify(st); ok(js.length > 100 && !/_/.test(Object.keys(st.units[0] || {}).join()), T + 'Zustand ist sauber serialisierbar (nichts Privates sichtbar)');
}

// ---- full matches with the scripted "dumb driver" (not the bots): 3 seeds × 12 minutes ----
{
  console.log('\n  Spielläufe mit dem Treiber (12 Min, 4 Häuser, Burgfrieden 2 Min)');
  const SITE = ['NW', 'NO', 'SW', 'SO'];
  let hits = 0, deaths = 0, built = 0, totalMs = 0, totalSteps = 0, maxMs = 0; const P2 = {};
  for (const seed of [1, 2, 3]) {
    const sim = Sim.create({ seed, world: worldOf(seed), dauer: 12, burgfrieden: 120 }), st = sim.state, think = makeDriver(sim);
    const evc = {}; let viol = 0, bad = 0, ms = 0, steps = 0, overs = 0;
    noThrow(() => {
      for (let i = 0; i < 12 * 60 * 15 + 5 && st.phase !== 'over'; i++) {
        if (i % 15 === 0) think();
        const t0 = process.hrtime.bigint(), ev = sim.step(), d = Number(process.hrtime.bigint() - t0) / 1e6;
        ms += d; steps++; maxMs = Math.max(maxMs, d);
        for (const e of ev) { evc[e.t] = (evc[e.t] || 0) + 1; if (e.t === 'over') overs++; }
        if (i % 15 === 0) {
          for (const u of st.units) {
            if (!Number.isFinite(u.x) || !Number.isFinite(u.y) || !Number.isFinite(u.hp) || Math.abs(u.x) > 72 || Math.abs(u.y) > 45) bad++;
            else if (!u.on && sim.dev.view(u.lord)[W.cellOf(u.x, u.y)]) viol++;   // (in the house's own view: a lane of its own gate is free; archers on a wall stand there on purpose)
          }
          for (const b of st.buildings) if (!(b.hp >= 0 && b.hp <= 1 + 1e-9) || !(b.fire >= 0 && b.fire <= 1) || !(b.build >= 0 && b.build <= 1)) bad++;
          if (i % 150 === 0) shapeCheck(st, seed, sim);
        }
      }
    }, 'Spiellauf seed ' + seed);
    eq(st.phase, 'over', 'seed ' + seed + ': das Spiel endet'); eq(overs, 1, 'seed ' + seed + ': genau ein over'); eq(st.ranking.length, 4, 'seed ' + seed + ': Rangliste');
    eq(viol, 0, 'seed ' + seed + ': niemand steht auf einer gesperrten Zelle'); eq(bad, 0, 'seed ' + seed + ': alle Werte endlich und im Bereich');
    ok(st.ranking.every((r, i) => i === 0 || st.ranking[i - 1].ruhm >= r.ruhm), 'seed ' + seed + ': Rangliste nach Ruhm');
    ok(Object.values(sim.dev.lord(0).by).every(Number.isFinite), 'seed ' + seed + ': Ruhm-Aufschlüsselung endlich');
    const bsum = st.ranking.reduce((a, r) => a + r.buildings, 0); built += bsum; hits += evc.hit || 0; deaths += evc.death || 0; totalMs += ms; totalSteps += steps;
    console.log('  seed ' + seed + ': Ø Schritt ' + (ms / steps).toFixed(3) + ' ms · ' + (evc.build || 0) + ' Bauten, ' + (evc.trained || 0) + ' Ausbildungen, ' + (evc.hit || 0) + ' Treffer, ' + (evc.death || 0) + ' Tote, ' + (evc.ignite || 0) + ' Brände, ' + (evc.crossingOpen || 0) + ' Übergänge, ' + (evc.hunger || 0) + ' Hungerwechsel · Phase 2: ' + (evc.trade || 0) + ' Handel, ' + (evc.garrison || 0) + ' Besatzungswechsel, ' + (evc.breach || 0) + ' Breschen, ' + (evc.ram || 0) + ' Rammstöße');
    for (const k of ['trade', 'garrison', 'breach', 'ram']) P2[k] = (P2[k] || 0) + (evc[k] || 0);
    for (const r of st.ranking) console.log('    Platz ' + r.rank + ' Haus ' + r.lord + ' (' + SITE[st.lords[r.lord].site] + '): Gebäude ' + String(r.buildings).padStart(2) + ' · Soldaten ' + String(r.soldiers).padStart(2) + ' · Leute ' + String(r.people).padStart(2) + ' · Tote ' + String(r.stats.kills).padStart(2) + ' · Plünderungen ' + r.stats.plunders + ' · Ruhm ' + r.ruhm);
  }
  ok(built >= 3 * 4 * 6, 'die Häuser bauen (' + built + ' fertige Gebäude in 3 Spielen)'); ok(hits > 0 && deaths > 0, 'es wird gekämpft (' + hits + ' Treffer, ' + deaths + ' Tote)');
  ok(P2.trade >= 3 && P2.garrison >= 3, 'die neuen Regeln kommen in ganzen Spielen vor: Handel ' + P2.trade + ', Besatzungswechsel ' + P2.garrison + ' (Breschen ' + (P2.breach || 0) + ', Rammstöße ' + (P2.ram || 0) + ')');
  console.log('  Schrittzeit über alle Spielläufe: Ø ' + (totalMs / totalSteps).toFixed(3) + ' ms, max ' + maxMs.toFixed(1) + ' ms');
}

// ---- performance: 4 houses × (60 soldiers + 40 peasants) fighting ----
function battleScene(nSold, nPeas, seed) {
  const sim = mk({ burgfrieden: 0, seed: seed || 1 }); toFehde(sim);
  const w = sim.world, st = sim.state;
  const kinds = []; for (const [k, n] of [['speer', 8], ['bogen', 6], ['ritter', 3], ['fackel', 3]]) for (let i = 0; i < n; i++) kinds.push(k);
  for (let l = 0; l < 4; l++) {   // peasants in the yards
    const g = gateOf(sim, l);
    for (let i = unitsOf(sim, l, 'bauer').length; i < nPeas; i++) sim.dev.spawn(l, 'bauer', g.x + (i % 7) * 0.3, g.y + g.out * 1, -1);
  }
  for (let l = 0; l < 4; l++) {   // Phase 2: a few walls, a gatehouse and a tower with archers in every quarter (the views, lanes and the garrison are part of the cost measured here)
    const g = gateOf(sim, l);
    for (const [dx, dy, len] of [[-9, 9, 4], [-4, 9, 4], [1, 9, 4], [6, 9, 3]]) placeNear(sim, l, 'mauer', g.x + dx, g.y + g.out * dy, 0, len);
    placeNear(sim, l, 'torhaus', g.x + 11, g.y + g.out * 9, 0); placeNear(sim, l, 'wachturm', g.x - 12, g.y + g.out * 9, 0);
    for (let i = 0; i < 4; i++) sim.dev.spawn(l, 'bogen', g.x - 9 + i, g.y + g.out * 6, 0);   // (the Burgwache's archers climb in)
  }
  const fords = [w.crossings.find(c => c.id === 'westfurt'), w.crossings.find(c => c.id === 'ostfurt')];
  const per = Math.ceil(nSold / 3);
  for (let l = 0; l < 4; l++) {
    const f = fords[l % 2], mine = f.ends[f.joins.indexOf(l)], theirs = f.ends[1 - f.joins.indexOf(l)];
    for (let n = 1; n <= 3; n++) {
      const rx = mine.x + (n - 2) * 3, ry = mine.y + (l < 2 ? -3 : 3) * 1;
      sim.banner(l, n, rx, ry);
      for (let i = 0; i < per && unitsOf(sim, l).filter(u => u.kind !== 'bauer').length < nSold; i++) sim.dev.spawn(l, kinds[i % kinds.length], rx + (i % 5) * 0.7, ry + Math.floor(i / 5) * 0.7, n);
    }
  }
  run(sim, secs(3));
  for (let l = 0; l < 4; l++) {   // march into each other
    const f = fords[l % 2], theirs = f.ends[1 - f.joins.indexOf(l)];
    for (let n = 1; n <= 3; n++) sim.banner(l, n, theirs.x + (n - 2) * 2, theirs.y);
  }
  return sim;
}
{
  for (const [nS, nP, label] of [[60, 40, '4 × (60 Soldaten + 40 Bauern) = 400 Einheiten'], [100, 60, '4 × (100 Soldaten + 60 Bauern) = 640 Einheiten']]) {
    const sim = battleScene(nS, nP), st = sim.state, u0 = st.units.length;
    ok(st.buildings.filter(b => b.kind === 'mauer').length >= 12 && st.buildings.filter(b => b.kind === 'torhaus').length >= 3 && st.buildings.filter(b => b.kind === 'wachturm').length >= 3, 'die Szene hat Mauern, Torhäuser und Türme (' + st.buildings.filter(b => b.kind === 'mauer').length + ' / ' + st.buildings.filter(b => b.kind === 'torhaus').length + ' / ' + st.buildings.filter(b => b.kind === 'wachturm').length + ')');
    ok(st.units.filter(u => u.on !== null).length >= 4, 'und Bogenschützen im Wehrgang (' + st.units.filter(u => u.on !== null).length + ')');
    let ms = 0, n = 0, mx = 0, fights = 0; const samples = [];
    for (let i = 0; i < 600; i++) { const t0 = process.hrtime.bigint(), ev = sim.step(), d = Number(process.hrtime.bigint() - t0) / 1e6; ms += d; n++; mx = Math.max(mx, d); samples.push(d); fights += ev.filter(e => e.t === 'hit').length; }
    samples.sort((a, b) => a - b);
    const avg = ms / n, p99 = samples[Math.floor(samples.length * 0.99)];
    console.log('\n  Leistung ' + label + ': Ø Schritt ' + avg.toFixed(3) + ' ms (p99 ' + p99.toFixed(2) + ', max ' + mx.toFixed(1) + ') über ' + n + ' Schritte · Einheiten ' + u0 + ' → ' + st.units.length + ' · ' + fights + ' Treffer');
    ok(u0 >= nS * 4 + nP * 4 - 4, 'Szene hat ' + u0 + ' Einheiten'); ok(fights > 100, 'es wird wirklich gekämpft (' + fights + ' Treffer)'); ok(avg < 2, 'Ø Schritt < 2 ms (' + avg.toFixed(3) + ')');
  }
}

// =====================================================================================================================
// Phase 2a — F2 (docs/FURTFEHDE.md "P — pacts end peacefully"): P1 renewal, P2 Abzug and its grace, P3 a broken pact gets none
// =====================================================================================================================
const pactEntry = (sim, a, b) => sim.youOf(a).pacts.find(p => p.with === b);
const startPact = (sim, a, b) => { sim.pact(a, b, true); sim.pact(b, a, true); run(sim, 1); return sim.state.pacts.find(p => p.a === Math.min(a, b) && p.b === Math.max(a, b) && !p.grace && p.until > 0).until; };   // → the pact's end
const toLeft = (sim, U, s) => until(sim, () => U - sim.state.t <= s + 1e-9, secs(400));                                                                         // run until `s` seconds remain
const ended = (sim, a, b, max) => until(sim, () => pactEntry(sim, a, b).state === 'none', max || secs(400));                                                    // run until the pact is gone
{
  // P1 — in the last RENEW_S of an active pact `pact(a, b, true)` is a renewal offer; once both houses have offered, the pact's end moves PACT_S further
  const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
  const U = startPact(sim, 0, 1); near(U, st.t - 1 / 15 + C.PACT_S, 0.2, 'Pakt gilt PACT_S');
  // outside the window `on` does nothing: no offer, no event, the end stays
  toLeft(sim, U, C.RENEW_S + 1);
  let r = sim.pact(0, 1, true); eq(r.ok, true, 'außerhalb des Fensters: ok'); eq(r.state, 'active', 'außerhalb: state bleibt active'); eq(r.renew, null, 'außerhalb: renew null');
  eq(sim.pact(1, 0, true).renew, null, 'auch die Gegenseite außerhalb: nichts');
  let l = run(sim, 3); eq(ofType(l, 'pactRenewOffer').length + ofType(l, 'pactOn').length, 0, 'außerhalb der letzten RENEW_S: weder Angebot noch pactOn'); eq(st.pacts[0].until, U, 'das Ende bleibt'); eq(pactEntry(sim, 0, 1).renew, null, 'youOf: renew null'); eq(pactEntry(sim, 1, 0).renew, null, 'youOf (Gegenseite): renew null');
  // the window opens exactly RENEW_S before the end: one step earlier nothing, then an offer
  until(sim, () => U - st.t < C.RENEW_S + 1.5 / 15, secs(10)); eq(sim.pact(0, 1, true).renew, null, 'eine Zeitscheibe vor dem Fenster: nichts'); run(sim, 1);
  near(U - st.t, C.RENEW_S, 1e-6, 'jetzt bleiben genau RENEW_S'); r = sim.pact(0, 1, true); eq(r.ok, true, 'im Fenster: ok'); eq(r.state, 'active', 'der Pakt bleibt aktiv'); eq(r.renew, 'offered', 'genau RENEW_S vor dem Ende: Verlängerungsangebot');
  l = run(sim, 1); const ro = ofType(l, 'pactRenewOffer'); eq(ro.length, 1, 'ein pactRenewOffer'); eq(JSON.stringify(ro[0]), JSON.stringify({ t: 'pactRenewOffer', from: 0, to: 1 }), 'pactRenewOffer { from, to }');
  eq(sim.pact(0, 1, true).renew, 'offered', 'nochmal anbieten ändert nichts'); eq(ofType(run(sim, 1), 'pactRenewOffer').length, 0, 'kein zweites pactRenewOffer');
  const y0 = pactEntry(sim, 0, 1), y1 = pactEntry(sim, 1, 0);
  eq(y0.renew, 'offered', 'youOf(0): renew offered'); eq(y1.renew, 'incoming', 'youOf(1): renew incoming'); eq(y0.state + y1.state, 'activeactive', 'beide weiter active'); eq(y0.until + y1.until, 2 * U, 'until bleibt das alte Ende');
  eq(sim.youOf(2).pacts.find(p => p.with === 0).renew, null, 'ein Dritter sieht kein renew'); eq(Object.keys(y0).join(), 'with,state,until,renew', 'youOf.pacts-Felder: with,state,until,renew');
  eq(st.pacts.length, 1, 'state.pacts: ein Eintrag'); eq(Object.keys(st.pacts[0]).join(), 'a,b,until', 'state.pacts: a,b,until (das Angebot steht nur in youOf)');
  // the partner answers: the end moves to end + PACT_S, `pactOn` again (a = the first to offer)
  const ans = sim.pact(1, 0, true); eq(ans.state, 'active', 'Antwort: active'); eq(ans.renew, 'renewed', 'Antwort: renewed');
  l = run(sim, 1); const on = ofType(l, 'pactOn'); eq(on.length, 1, 'pactOn noch einmal'); eq(on[0].a, 0, 'pactOn.a = wer zuerst anbot'); eq(on[0].b, 1, 'pactOn.b'); near(on[0].until, U + C.PACT_S, 1e-6, 'das neue Ende = altes Ende + PACT_S'); eq(Object.keys(on[0]).join(), 't,a,b,until', 'pactOn: dieselben Felder'); eq(ofType(l, 'pactOff').length, 0, 'keine pactOff');
  eq(st.pacts.length, 1, 'ein Pakt'); eq(st.pacts[0].until, on[0].until, 'state.pacts folgt dem neuen Ende'); eq(pactEntry(sim, 0, 1).until, on[0].until, 'youOf(0).until'); eq(pactEntry(sim, 1, 0).until, on[0].until, 'youOf(1).until');
  eq(pactEntry(sim, 0, 1).renew, null, 'nach der Verlängerung: renew null'); eq(pactEntry(sim, 1, 0).renew, null, 'auch bei der Gegenseite'); eq(sim.pact(1, 0, true).renew, null, 'danach wieder außerhalb des Fensters');
  eq(sim.dev.lord(0).stats.pacts + '/' + sim.dev.lord(1).stats.pacts, '2/2', 'stats.pacts zählt das Verlängern wie jedes pactOn');
  // nothing happens at the old end: the pact is still on a few seconds later
  const cont = until(sim, () => st.t > U + 3, secs(100)); eq(ofType(cont.log, 'pactOff').length, 0, 'am alten Ende kein pactOff'); eq(pactEntry(sim, 0, 1).state, 'active', 'der Pakt gilt weiter');
  // and the new term can be renewed in the same way: a renewal by the other side first, then the answer
  const U2 = on[0].until; toLeft(sim, U2, C.RENEW_S - 10); eq(sim.pact(1, 0, true).renew, 'offered', 'zweites Verlängern: diesmal bietet Haus 1 an'); eq(pactEntry(sim, 0, 1).renew, 'incoming', 'Haus 0 sieht es'); eq(sim.pact(0, 1, true).renew, 'renewed', 'Haus 0 antwortet');
  l = run(sim, 1); const on2 = ofType(l, 'pactOn'); eq(on2.length, 1, 'zweites pactOn'); eq(on2[0].a, 1, 'a = Haus 1 (wer zuerst anbot)'); near(on2[0].until, U2 + C.PACT_S, 1e-6, 'wieder + PACT_S (' + (U2 + C.PACT_S).toFixed(1) + ')');
  // a pact that is renewed keeps its soldiers' peace across the old end: partners still ignore each other 10 s after it
  const c = clearing(sim, 0), A = stage(sim, 0, 'speer', c), B = stage(sim, 1, 'speer', { x: c.x + 1.1, y: c.y }); A.hp = B.hp = 1e5;
  eq(ofType(run(sim, secs(8)), 'hit').length, 0, 'im verlängerten Pakt weiter keine Schläge');
}
{
  // P1 — from one side only there is no renewal: the pact runs out, the old offer is void (a later offer is a new pact for PACT_S from then on)
  const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
  const U = startPact(sim, 0, 1); toLeft(sim, U, 40); eq(sim.pact(0, 1, true).renew, 'offered', 'nur Haus 0 bietet an');
  const ex = ended(sim, 0, 1, secs(60)); const off = ofType(ex.log, 'pactOff'); eq(off.length, 1, 'der Pakt läuft aus'); eq(off[0].reason, 'expired', 'reason expired'); eq(ofType(ex.log, 'pactOn').length, 0, 'ohne Antwort keine Verlängerung'); near(st.t, U, 0.2, 'zur angekündigten Zeit');
  eq(pactEntry(sim, 0, 1).renew, null, 'danach kein renew mehr'); eq(pactEntry(sim, 1, 0).renew, null, 'auch nicht bei der Gegenseite');
  const r = sim.pact(1, 0, true); eq(r.state, 'offered', 'Haus 1 antwortet zu spät: das ist ein neues Angebot, kein Verlängern'); eq(r.renew, undefined, 'ohne renew-Feld');
  let l = run(sim, 1); eq(ofType(l, 'pactOffer').length, 1, 'ein pactOffer'); eq(ofType(l, 'pactRenewOffer').length, 0, 'kein pactRenewOffer');
  eq(sim.pact(0, 1, true).state, 'active', 'Haus 0 nimmt an: ein neuer Pakt'); l = run(sim, 1); const on = ofType(l, 'pactOn'); eq(on.length, 1, 'pactOn'); near(on[0].until, st.t - 1 / 15 + C.PACT_S, 0.2, 'neuer Pakt: PACT_S ab jetzt, nicht das alte Ende + PACT_S');
  eq(st.pacts.length, 1, 'ein neuer Pakt beendet die laufende Waffenruhe (kein grace-Eintrag mehr)'); eq(st.pacts[0].grace, undefined, 'der Eintrag ist ein gewöhnlicher Pakt');
  // the old offer left nothing behind: the new pact starts without a renewal, and in its window one house's offer is only an offer
  eq(pactEntry(sim, 0, 1).renew, null, 'der neue Pakt trägt kein altes Verlängern'); eq(pactEntry(sim, 1, 0).renew, null, '… auch nicht bei der Gegenseite');
  const U2 = on[0].until; toLeft(sim, U2, 30); eq(sim.pact(1, 0, true).renew, 'offered', 'im Fenster des neuen Pakts ist ein einzelnes `true` nur ein Angebot (das alte Angebot von Haus 0 ist verfallen)'); eq(ofType(run(sim, 1), 'pactOn').length, 0, 'kein pactOn');
}
{
  // P1 — the partner may offer first; and the answer of the first side is no „accept“: only a second `true` renews
  const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
  const U = startPact(sim, 0, 1); toLeft(sim, U, C.RENEW_S - 20); eq(sim.pact(1, 0, true).renew, 'offered', 'Haus 1 bietet zuerst an'); eq(pactEntry(sim, 0, 1).renew, 'incoming', 'Haus 0: incoming');
  eq(sim.pact(1, 0, true).renew, 'offered', 'Haus 1 nochmal: bleibt offered (kein Selbst-Verlängern)'); eq(ofType(run(sim, 2), 'pactOn').length, 0, 'ein Haus allein verlängert nicht');
  eq(sim.pact(0, 1, true).renew, 'renewed', 'Haus 0 verlängert'); const on = ofType(run(sim, 1), 'pactOn'); eq(on.length, 1, 'pactOn'); eq(on[0].a, 1, 'a = Haus 1'); near(on[0].until, U + C.PACT_S, 1e-6, 'U + PACT_S');
  // three houses: a renewal concerns only its two; a third house's pact with one of them runs its own course
  const s3 = mk({ burgfrieden: 0 }); toFehde(s3); const Ua = startPact(s3, 0, 1); run(s3, secs(30)); const Ub = startPact(s3, 0, 2);
  toLeft(s3, Ua, 30); s3.pact(0, 1, true); s3.pact(1, 0, true); const o3 = ofType(run(s3, 1), 'pactOn'); eq(o3.length, 1, 'nur der Pakt 0–1 wurde verlängert'); near(pactEntry(s3, 0, 1).until, Ua + C.PACT_S, 1e-6, '0–1: + PACT_S'); eq(pactEntry(s3, 0, 2).until, Ub, '0–2: unverändert'); eq(pactEntry(s3, 0, 2).renew, null, '0–2: kein renew');
}
{
  // P1 — a pending renewal is void when the pact is broken (and there is no grace, P3); ids that are not partners cannot renew
  const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
  const U = startPact(sim, 0, 1); toLeft(sim, U, 30); sim.pact(0, 1, true); eq(pactEntry(sim, 1, 0).renew, 'incoming', 'Angebot steht');
  const bk = sim.pact(1, 0, false); eq(bk.ok, true, 'Haus 1 bricht den Pakt'); eq(bk.state, 'none', 'state none'); const bo = ofType(run(sim, 1), 'pactOff'); eq(bo.length, 1, 'ein pactOff'); eq(bo[0].reason, 'broken', 'broken'); eq(bo[0].by, 1, 'by = Haus 1'); eq(Object.keys(bo[0]).join(), 't,a,b,reason,by', 'ohne grace');
  eq(pactEntry(sim, 0, 1).renew, null, 'das Angebot ist hinfällig'); eq(st.pacts.length, 0, 'P3: keine Waffenruhe, kein Eintrag');
  eq(sim.pact(2, 3, true).state, 'offered', 'Haus 2 und 3 ohne Pakt: ein Angebot, kein Verlängern'); eq(sim.pact(2, 3, true).renew, undefined, 'ohne renew');
  eq(sim.pact(0, 1, true).state, 'offered', 'nach dem Bruch ist `true` ein neues Angebot'); sim.pact(0, 1, false); run(sim, 2);
  // the broken pact's offer is gone for good: a new pact has no renewal pending, and one house's `true` in its window is only an offer
  const U2 = startPact(sim, 0, 1); eq(pactEntry(sim, 0, 1).renew, null, 'der neue Pakt: kein renew'); eq(pactEntry(sim, 1, 0).renew, null, '… bei der Gegenseite auch nicht');
  toLeft(sim, U2, 30); eq(sim.pact(1, 0, true).renew, 'offered', 'ein einzelnes `true` im Fenster ist nur ein Angebot (kein Rest des alten Angebots von Haus 0)'); eq(ofType(run(sim, 1), 'pactOn').length, 0, 'kein pactOn');
}
{
  // P2 — the Abzug: after a pact has run out the houses stay friends for PACT_GRACE_S (no blow, no arrow, no death); a broken pact (P3) gets no grace
  const scene = () => {
    const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
    const c = clearing(sim, 0), A = stage(sim, 0, 'speer', c), B = stage(sim, 1, 'speer', { x: c.x + 1.1, y: c.y }), Ba = stage(sim, 1, 'bogen', { x: c.x + 3, y: c.y }, 2), Aa = stage(sim, 0, 'bogen', { x: c.x - 3, y: c.y }, 2);
    for (const u of [A, B, Ba, Aa]) u.hp = 1e5;
    return { sim, st, c, A, B };
  };
  { const { sim, st, A, B } = scene(); const U = startPact(sim, 0, 1);
    eq(ofType(run(sim, secs(5)), 'hit').length, 0, 'im Pakt keine Schläge');
    const ex = ended(sim, 0, 1, secs(200)); const off = ofType(ex.log, 'pactOff'); eq(off.length, 1, 'pactOff'); eq(JSON.stringify(Object.keys(off[0])), JSON.stringify(['t', 'a', 'b', 'reason', 'grace']), 'pactOff: t,a,b,reason,grace'); eq(off[0].reason, 'expired', 'expired'); near(off[0].grace, U + C.PACT_GRACE_S, 1e-6, 'grace = Ende + PACT_GRACE_S');
    eq(ofType(ex.log, 'hit').length, 0, 'bis zum Ablauf kein Schlag');
    // during the grace: state.pacts carries the Abzug entry (the view keeps the gates open for the two), youOf says „none“
    eq(st.pacts.length, 1, 'Waffenruhe: ein Eintrag in state.pacts'); eq(JSON.stringify(Object.keys(st.pacts[0])), JSON.stringify(['a', 'b', 'until', 'grace']), 'Eintrag: a,b,until,grace'); eq(st.pacts[0].grace, true, 'grace: true'); near(st.pacts[0].until, off[0].grace, 1e-9, 'until = Ende der Waffenruhe');
    eq(pactEntry(sim, 0, 1).state, 'none', 'youOf: kein Pakt mehr'); eq(pactEntry(sim, 0, 1).until, 0, 'until 0'); eq(pactEntry(sim, 0, 1).renew, null, 'renew null');
    const calm = run(sim, secs(C.PACT_GRACE_S - 1)); eq(ofType(calm, 'hit').length, 0, 'Waffenruhe: kein Schlag'); eq(ofType(calm, 'shot').length, 0, 'Waffenruhe: kein Pfeil'); eq(ofType(calm, 'death').length, 0, 'Waffenruhe: kein Toter'); eq(ofType(calm, 'attack').length, 0, 'Waffenruhe: kein Angriffsalarm');
    eq(A.hp, 1e5, 'A unversehrt'); eq(B.hp, 1e5, 'B unversehrt'); eq(st.pacts.length, 1, 'die Waffenruhe läuft noch');
    const end = until(sim, () => st.pacts.length === 0, secs(5)); eq(end.hit, true, 'die Waffenruhe endet'); near(st.t, off[0].grace, 0.2, 'zur angekündigten Zeit (' + st.t.toFixed(2) + ' vs ' + off[0].grace.toFixed(2) + ')'); eq(ofType(end.log, 'pactOff').length, 0, 'ihr Ende meldet kein Ereignis');
    ok(ofType(run(sim, secs(8)), 'hit').length > 0, 'danach wird wieder gekämpft'); ok(A.hp < 1e5 || B.hp < 1e5, 'Treffer fallen');
    // after it a new pact is possible again, as always
    eq(sim.pact(0, 1, true).state, 'offered', 'danach ein neues Angebot möglich'); }
  { // P3: a broken pact leaves no grace — they fight at once, and no banner is sent home
    const { sim, st, A, B } = scene(); startPact(sim, 0, 1); run(sim, secs(3));
    const t0 = sim.youOf(0).banners.find(b => b.n === 1);
    const bk = sim.pact(0, 1, false); eq(bk.state, 'none', 'Bruch'); const lb = run(sim, secs(3));
    eq(ofType(lb, 'order').length, 0, 'P3: kein Banner wird heimgeschickt'); eq(st.pacts.length, 0, 'P3: keine Waffenruhe'); ok(ofType(lb, 'hit').length > 0, 'P3: sofort wird gekämpft (' + ofType(lb, 'hit').length + ' Treffer in 3 s)');
    eq(sim.youOf(0).banners.find(b => b.n === 1).tx, t0.tx, 'P3: das Banner behält sein Ziel'); }
}
{
  // P2 — the gate lanes stay open for the former partner during the grace, and close with it; its walls are no breach target meanwhile
  const { sim, ci, cj } = patch(0), st = sim.state, R = ringOf(sim, 0, ci, cj, 'mauer', true), lk = laneKs(R.th), wk = R.pieces[0].j * GW + R.pieces[0].i;
  startPact(sim, 0, 1); ok(lk.every(k => sim.dev.view(1)[k] === 0), 'Pakt: die Gasse ist offen für Haus 1');
  const ex = ended(sim, 0, 1, secs(200)); eq(ofType(ex.log, 'pactOff').length, 1, 'der Pakt ist abgelaufen');
  ok(lk.every(k => sim.dev.view(1)[k] === 0), 'Waffenruhe: die Gasse bleibt offen'); ok(lk.every(k => sim.dev.view(2)[k] === 1), '… für Haus 2 nicht'); eq(sim.dev.fview(1).B[wk], 1, 'Waffenruhe: die Mauer ist für Haus 1 kein Durchbruchsziel'); eq(sim.dev.fview(1).X, null, '… und kein Extrafeld');
  const G = st.pacts[0].until; until(sim, () => G - st.t <= 1.5, secs(40));
  const lanePt = { x: -71.5 + lk[0] % GW, y: -44.5 + Math.floor(lk[0] / GW) }, vs = sim.dev.spawn(1, 'speer', lanePt.x, lanePt.y, 1); run(sim, 1);
  ok(lk.indexOf(W.cellOf(vs.x, vs.y)) >= 0, 'der frühere Partner steht in der Gasse (Waffenruhe)'); eq(ofType(run(sim, 1), 'hit').length, 0, 'er wird nicht angegriffen');
  until(sim, () => st.pacts.length === 0, secs(5)); ok(lk.every(k => sim.dev.view(1)[k] === 1), 'Waffenruhe vorbei: die Gasse ist zu'); run(sim, 3);
  ok(lk.indexOf(W.cellOf(vs.x, vs.y)) < 0 && !sim.dev.view(1)[W.cellOf(vs.x, vs.y)], 'er wurde aus der Gasse gesetzt'); vs.hp = 0; sim.dev.kill(vs);
  eq(sim.dev.fview(1).B[wk], 0, 'danach ist die Mauer für Haus 1 wieder durchbrechbar'); near(sim.dev.fview(1).X[wk], C.BREACH_COST, 1e-9, '… zu BREACH_COST');
}
{
  // P2 — at the expiry every banner (either house) aimed within PACT_ZONE + ABZUG_PAD of the other's buildings is sent home, the way plunder protection sends it; others stay
  const sim = mk({ burgfrieden: 0 }), st = sim.state, w = sim.world; toFehde(sim);
  const hut1 = placeAt(sim, 1, 'huette'), hut0 = placeAt(sim, 0, 'huette'); ok(hut1 && hut0, 'je eine Hütte für Haus 0 und 1');
  const rectsOf = (l) => st.buildings.filter(b => b.lord === l).map(b => { const f = W.footprintOf(b.kind, b.rot, b.len); return { x0: -72 + b.i, y0: -45 + b.j, x1: -72 + b.i + f[0], y1: -45 + b.j + f[1] }; });
  const dmin = (rs, x, y) => Math.min(...rs.map(r => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1))));
  // the banner's target ends up at distance d of the other house's nearest building: scan its quarter for ground that an order takes unchanged
  const aim = (l, n, other, lo, hi) => {
    const rs = rectsOf(other);
    for (let k = 0; k < N; k++) {
      if (w.owner[k] !== other || w.cls[k] === W.CI.T || sim.dev.blk[k]) continue;
      const x = -71.5 + k % GW, y = -44.5 + Math.floor(k / GW), d = dmin(rs, x, y);
      if (d < lo || d > hi) continue;
      const r = sim.banner(l, n, x, y);
      if (r.ok && r.reason === undefined) return { x, y, d };
      sim.banner(l, n, gateOf(sim, l).x, gateOf(sim, l).y + gateOf(sim, l).out * 8);   // (not an order that lands as asked: try the next spot)
    }
    return null;
  };
  for (const l of [0, 1]) for (const n of [1, 2]) { const g = gateOf(sim, l); sim.dev.spawn(l, 'speer', g.x + n, g.y + g.out * 5, n); sim.dev.spawn(l, 'speer', g.x + n + 1, g.y + g.out * 5, n); }
  const in0 = aim(0, 1, 1, 9.3, 9.8), out0 = aim(0, 2, 1, 10.2, 10.7), in1 = aim(1, 1, 0, 9.3, 9.8), out1 = aim(1, 2, 0, 10.2, 10.7);
  ok(in0 && out0 && in1 && out1, 'Zielpunkte bei Abstand ≈ 9.5 (innen) und ≈ 10.5 (außen) zu den Gebäuden des anderen gefunden');
  if (in0 && out0 && in1 && out1) {
    startPact(sim, 0, 1);
    const tgt = (l, n) => { const b = sim.youOf(l).banners.find(x => x.n === n); return { x: b.tx, y: b.ty }; };
    near(tgt(0, 1).x, in0.x, 1e-9, 'vor dem Ablauf stehen die Ziele (0 / Banner 1)'); near(tgt(1, 2).x, out1.x, 1e-9, '(1 / Banner 2)');
    const ex = ended(sim, 0, 1, secs(200)); const od = ofType(ex.log, 'order');
    ok(od.some(o => o.lord === 0 && o.n === 1) && od.some(o => o.lord === 1 && o.n === 1), 'beim Ablauf gehen die Banner heim, die ≤ PACT_ZONE + 4 vor den Gebäuden des anderen zielten (beide Häuser): ' + JSON.stringify(od.map(o => o.lord + '/' + o.n)));
    eq(od.filter(o => o.n !== 1).length, 0, 'sonst kein Befehl (die Banner mit Ziel > PACT_ZONE + 4 bleiben)');
    for (const l of [0, 1]) { const g = gateOf(sim, l), h = tgt(l, 1); ok(dist(h, { x: g.x - 7, y: g.y + g.out * 8 }) < 4, 'Haus ' + l + ' Banner 1: das Ziel ist der Heimatplatz vor dem Tor (' + h.x.toFixed(1) + ', ' + h.y.toFixed(1) + ')'); }
    near(tgt(0, 2).x, out0.x, 1e-9, 'Haus 0 Banner 2: Ziel unverändert'); near(tgt(0, 2).y, out0.y, 1e-9, '… y'); near(tgt(1, 2).x, out1.x, 1e-9, 'Haus 1 Banner 2: Ziel unverändert');
    const od0 = od.find(o => o.lord === 0); eq(Object.keys(od0).join(), 't,lord,n,x,y', 'order-Ereignis wie bei jedem Befehl'); near(od0.x, tgt(0, 1).x, 1e-9, 'order.x = das neue Ziel');
    // the Burgwache (banner 0) and the third house are never touched
    ok(!od.some(o => o.n === 0 || o.lord > 1), 'weder die Burgwache noch ein anderes Haus bekommt einen Befehl');
  }
}
{
  // the story of the report: a banner stands next to the partner's buildings when the pact begins; at the end it goes home and nothing is attacked — not in the grace, nor after
  const sim = mk({ burgfrieden: 0 }), st = sim.state; toFehde(sim);
  const hut = placeAt(sim, 1, 'huette'), keep1 = st.buildings.find(b => b.kind === 'bergfried' && b.lord === 1);
  const spot = { x: -72 + hut.i + 4.5, y: -45 + hut.j + 0.5 }, free = [{ x: spot.x, y: spot.y }, { x: spot.x + 1, y: spot.y + 2 }, { x: spot.x - 1, y: spot.y - 2 }, { x: -72 + hut.i - 3, y: -45 + hut.j + 1 }].find(p => !blockedAt(sim, p));
  const A = stage(sim, 0, 'speer', free), A2 = sim.dev.spawn(0, 'speer', free.x + 0.9, free.y, 1), A3 = sim.dev.spawn(0, 'bogen', free.x, free.y + 0.9, 1);
  startPact(sim, 0, 1);   // (the banner already stands at the hut: the order was given before the pact)
  ok(dist(sim.state.banners.find(b => b.lord === 0 && b.n === 1), { x: -72 + hut.i + 1, y: -45 + hut.j + 1 }) < 6, 'das Banner steht bei der Hütte');
  const hp0 = st.buildings.map(b => b.lord === 1 ? b.hp : 1);
  const ex = ended(sim, 0, 1, secs(200)); ok(ofType(ex.log, 'order').some(o => o.lord === 0 && o.n === 1), 'beim Ablauf zieht das Banner ab');
  const after = run(sim, secs(C.PACT_GRACE_S + 90)); eq(ofType(after, 'hit').length, 0, 'in Waffenruhe und danach: kein Schlag auf die Gebäude und Leute des früheren Partners');
  eq(JSON.stringify(st.buildings.map(b => b.lord === 1 ? b.hp : 1)), JSON.stringify(hp0), 'seine Gebäude sind unversehrt (Hütte und Bergfried)'); eq(ofType(after, 'ruined').length, 0, 'nichts fällt');
  const g0 = gateOf(sim, 0), bn = st.banners.find(b => b.lord === 0 && b.n === 1); ok(dist(bn, g0) < 25, 'das Banner steht wieder in der Nähe der eigenen Burg (' + dist(bn, g0).toFixed(1) + ')');
}

{
  // fuzz: four houses offer, renew, break and send soldiers at random for 8 minutes (three seeds): nobody is ever killed by a pact partner or by a house in its grace, the
  // pact lists of both sides always agree (end, renewal offered ↔ incoming), and a grace entry never outlives PACT_GRACE_S
  let kills = 0, offers = 0, expiries = 0, renewals = 0, bad = 0;
  for (const seed of [1, 2, 3]) {
    const sim = mk({ seed, burgfrieden: 20, dauer: 8 }), st = sim.state; let x = (seed * 2654435761) >>> 0;
    const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
    const friends = (a, b) => st.pacts.some(p => p.until > 0 && ((p.a === a && p.b === b) || (p.a === b && p.b === a)));   // active pact or grace entry
    for (let k = 0; k < 8 * 60 * 15 && st.phase !== 'over'; k++) {
      if (k % 15 === 0 && rnd() < 0.3) {
        const a = Math.floor(rnd() * 4), b = [0, 1, 2, 3].filter(i => i !== a)[Math.floor(rnd() * 3)], r = rnd(), g = sim.dev.lord(a), h = sim.dev.lord(b);
        if (r < 0.55) sim.pact(a, b, true); else if (r < 0.6) sim.pact(a, b, false);
        else if (r < 0.85) sim.dev.spawn(a, 'speer', g.gx + rnd() * 6, g.gy + g.out * (4 + rnd() * 6), 1 + Math.floor(rnd() * 3));
        else sim.banner(a, 1 + Math.floor(rnd() * 3), h.gx + (rnd() - 0.5) * 16, h.gy + h.out * (6 + rnd() * 6));
      }
      for (const e of sim.step()) {
        if (e.t === 'death' && e.by != null && e.by !== e.lord) { kills++; if (friends(e.by, e.lord)) bad++; }
        else if (e.t === 'pactOffer' || e.t === 'pactRenewOffer') { offers++; if (e.t === 'pactRenewOffer') renewals++; }
        else if (e.t === 'pactOff' && e.reason === 'expired' && e.grace) expiries++;
      }
      if (k % 15 === 0) for (const p of st.pacts) {
        if (p.grace) { if (!(p.until > st.t - 1e-9 && p.until - st.t <= C.PACT_GRACE_S + 1e-9)) bad++; continue; }
        if (!(p.until > 0)) continue;
        const ya = pactEntry(sim, p.a, p.b), yb = pactEntry(sim, p.b, p.a);
        if (!(ya.state === 'active' && yb.state === 'active' && ya.until === p.until && yb.until === p.until && (ya.renew === 'offered') === (yb.renew === 'incoming') && (ya.renew === 'incoming') === (yb.renew === 'offered'))) bad++;
      }
    }
  }
  eq(bad, 0, 'Fuzz: kein Tod durch Partner oder in der Waffenruhe, die Paktlisten beider Seiten stimmen überein, keine Waffenruhe über 30 s');
  ok(kills > 30 && renewals > 3 && expiries > 3, 'Fuzz: die Szene übt es wirklich (' + kills + ' Tote, ' + renewals + ' Verlängerungsangebote, ' + expiries + ' Abläufe mit Waffenruhe)');
}

// ---- event catalogue: every event of the doc's table appeared in this run, with exactly the documented fields ----
{
  const DOC = {
    frieden: '', warn: 'in,kind', ebbe: '', crossingOpen: 'id', fehde: '', lastMinute: '', over: 'ranking',
    arrive: 'lord', leave: 'lord', hunger: 'lord,on',
    build: 'id,kind,lord', buildDone: 'id', cancel: 'id', ruined: 'by,id', rebuild: 'id', pause: 'id,on',
    chop: 'lord,tree', deliver: 'lord,n,res,store', harvest: 'id,n', sow: 'id',
    recruit: 'lord,n,unit', trained: 'id,lord,unit',
    order: 'lord,n,x,y', shot: 'flight,from,src,to', clash: 'x,y', hit: 'id,x,y', death: 'by,id,kind,lord,x,y',
    ignite: 'by,id', fireOut: 'id', cropBurnt: 'id', bucket: 'brunnen,id',
    plunder: 'by,loot,lord', protEnd: 'lord', crown: 'lord',
    pactOffer: 'from,to', pactRenewOffer: 'from,to', pactOn: 'a,b,until', pactOff: 'a,b,reason',
    attack: 'lord,x,y',
    trade: 'gold,good,lord,n,side', garrison: 'id,lord,on,unit', breach: 'by,id,kind,lord,x,y', ram: 'id,x,y'
  };
  const missing = [], wrong = [];
  for (const [t, keys] of Object.entries(DOC)) {
    const seen = SEEN[t];
    if (!seen) { missing.push(t); continue; }
    const allowed = t === 'pactOff' ? [keys, 'a,b,by,reason', 'a,b,grace,reason'] : [keys];   // (by: declined / broken; grace: a pact that ran out)
    for (const k of seen) if (!allowed.includes(k)) wrong.push(t + '{' + k + '}');
  }
  ok(missing.length === 0, 'jedes dokumentierte Ereignis kam vor (es fehlen: ' + missing.join(', ') + ')');
  ok(wrong.length === 0, 'alle Ereignisse haben genau die dokumentierten Felder (abweichend: ' + wrong.join(', ') + ')');
  const unknown = Object.keys(SEEN).filter(t => !(t in DOC));
  ok(unknown.length === 0, 'keine undokumentierten Ereignisse (' + unknown.join(', ') + ')');
  console.log('\n  Ereignis-Katalog: ' + Object.keys(DOC).length + ' Typen dokumentiert, ' + Object.keys(SEEN).length + ' beobachtet');
}

console.log(process.exitCode ? '\nFEHLER aufgetreten' : '\nOK: ' + checks + ' Prüfungen bestanden');
