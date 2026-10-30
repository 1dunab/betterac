// Regeltests Neonspur: Simulation (sim.js), Arenen (maps.js), Bots, Determinismus, Performance.
const Sim = require('./public/games/neonspur/sim.js');
const Maps = require('./public/games/neonspur/maps.js');
const { TRAIL_H, JUMP_CD_MS } = Sim.CONST;

let checks = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function eq(a, b, msg) { checks++; if (a !== b) fail(msg + ' (erwartet ' + b + ', war ' + a + ')'); }

// ---- tiny test arenas: bordered w x h box; opts.a / opts.b = [x, y, dir] spawns of rider 1 / 2 ----
function box(o) {
  const w = o.w || 60, h = o.h || 12, c = [];
  for (let y = 0; y < h; y++) c.push(Array.from({ length: w }, (_, x) => (!o.open && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) ? '#' : '.'));
  for (const [x, y, ch] of o.set || []) c[y][x] = ch;
  for (const [x, y, rw, rh, ch] of o.rect || []) for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) c[j][i] = ch;
  const a = o.a || [2, 2, 0], b = o.b || [2, h - 2, 0];
  return Sim.parseMap({ key: 't', label: 't', theme: {}, rows: c.map(r => r.join('')),
    spawns: [{ x: a[0], y: a[1], dir: a[2] }, { x: b[0], y: b[1], dir: b[2] }] });
}
const mk = (o, tempo, extras) => Sim.create({ map: box(o), riders: [{ pid: 1 }, { pid: 2 }], tempo: tempo || 'normal', seed: 7, extras });
function steps(sim, n, inputs) {
  const log = [];
  for (let i = 0; i < n; i++) {
    for (const [p, c] of (inputs && inputs[i]) || []) sim.input(p, c);
    log.push(...sim.step());
  }
  return log;
}
// n rider moves (normal speed = 2 subticks each); inputs[k] are sent before move k
function mv(sim, n, inputs) {
  const log = [];
  for (let k = 0; k < n; k++) {
    for (const [p, c] of (inputs && inputs[k]) || []) sim.input(p, c);
    log.push(...steps(sim, 2));
  }
  return log;
}
const A = (sim) => sim.state.riders[0], B = (sim) => sim.state.riders[1];
const pos = (r) => r.x + ',' + r.y;

// ---- arenas ----
for (const def of Maps) {
  const m = Sim.parseMap(def), W = m.w;
  ok(def.rows.length === m.h && def.rows.every(r => r.length === W), def.key + ': alle Zeilen gleich lang');
  let border = true;
  for (let x = 0; x < W; x++) if (!m.wall[x] || !m.wall[(m.h - 1) * W + x]) border = false;
  for (let y = 0; y < m.h; y++) if (!m.wall[y * W] || !m.wall[y * W + W - 1]) border = false;
  ok(border, def.key + ': Rand geschlossen');
  eq(m.spawns.length, 4, def.key + ': 4 Spawns');
  m.spawns.forEach((s, i) => {
    const cell = def.rows[s.y][s.x];
    ok(cell === '.', def.key + ' Spawn ' + i + ' auf freiem Boden');
    let free = 0;
    for (let k = 1; k <= 8; k++) {
      const x = s.x + [1, 0, -1, 0][s.dir] * k, y = s.y + [0, 1, 0, -1][s.dir] * k;
      if (def.rows[y][x] === '.') free++;
    }
    eq(free, 8, def.key + ' Spawn ' + i + ': 8 freie Zellen voraus');
  });
  // riders 0/1 face each other, 2/3 too
  eq((m.spawns[0].dir + 2) % 4, m.spawns[1].dir, def.key + ': Spawn 0/1 gegenueber');
  eq((m.spawns[2].dir + 2) % 4, m.spawns[3].dir, def.key + ': Spawn 2/3 gegenueber');
  let ramps = 0;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < W; x++) {
    const d = m.rampDir[y * W + x];
    if (d < 0) continue;
    ramps++;
    const dx = [1, 0, -1, 0][d], dy = [0, 1, 0, -1][d];
    const back = (y - dy) * W + (x - dx), front = (y + dy) * W + (x + dx);
    ok(!m.wall[back] && m.floor[back] === 0, def.key + ' Rampe ' + x + ',' + y + ': Boden dahinter');
    ok(!m.wall[front] && m.floor[front] === 1, def.key + ' Rampe ' + x + ',' + y + ': Terrasse davor');
  }
  console.log('  Arena ' + def.key + ' ' + W + 'x' + m.h + ': ' + ramps + ' Rampenzellen');
}

// ---- turning ----
{
  let s = mk({ a: [5, 2, 0] });
  let ev = mv(s, 1, [[[1, 'R']]]);
  eq(A(s).dir, 1, 'R: Ost -> Sued'); eq(pos(A(s)), '5,3', 'R: bewegt sich nach dem Drehen');
  ok(ev.some(e => e.t === 'turn' && e.pid === 1 && e.dir === 1), 'turn-Event');
  s = mk({ a: [5, 2, 0] }); mv(s, 1, [[[1, 'L']]]);
  eq(A(s).dir, 3, 'L: Ost -> Nord');
  s = mk({ a: [5, 5, 0] }); mv(s, 2, [[[1, 'R'], [1, 'R']]]);
  eq(A(s).dir, 2, 'Doppeltipp: Kehrtwende'); eq(pos(A(s)), '4,6', 'Doppeltipp: eine Spur weiter');
  s = mk({ a: [5, 5, 0] }); mv(s, 3, [[[1, 'R'], [1, 'R'], [1, 'R']]]);
  eq(A(s).dir, 2, 'Queue Tiefe 2: dritter Input verworfen');
  s = mk({}); s.input(99, 'L'); s.input(1, 'X'); s.input(1, undefined); mv(s, 1);
  eq(A(s).dir, 0, 'unbekannte Rider/Befehle ignoriert');
}

// ---- deaths ----
{
  let s = mk({ a: [5, 2, 0] });
  mv(s, 2, [[[1, 'R'], [1, 'R']]]); mv(s, 2, [[[1, 'R'], [1, 'R']]]);
  eq(A(s).alive, false, 'eigene Spur toetet'); eq(A(s).killer, 'self', 'killer self');
  s = mk({ a: [2, 5, 0], b: [8, 2, 1] });
  const ev = mv(s, 8);
  eq(A(s).killer, 2, 'fremde Spur: killer = pid');
  ok(ev.some(e => e.t === 'crash' && e.pid === 1 && e.by === 2), 'crash-Event mit by=pid');
  s = mk({ set: [[6, 2, '#']] }); mv(s, 4);
  eq(A(s).alive, false, 'Wandblock toetet'); eq(A(s).killer, 'wall', 'killer wall');
  s = mk({ open: true, w: 12, h: 5, a: [1, 1, 2], b: [1, 3, 0] }); mv(s, 3);
  eq(A(s).killer, 'edge', 'Arenarand ohne Mauer: killer edge');
  s = mk({ a: [2, 2, 3] }); mv(s, 2);
  eq(A(s).killer, 'wall', 'Randmauer toetet');
}

// ---- jump ----
{
  // other rider's wall right in front: jump clears it, gap in the trail, brk at landing
  let s = mk({ a: [2, 5, 0], b: [6, 2, 1] });
  mv(s, 3);
  eq(pos(A(s)), '5,5', 'Vorlauf'); ok(pos(B(s)) === '6,5', 'Gegner legt Wand');
  let ev = mv(s, 4, [[[1, 'J']]]);
  eq(A(s).alive, true, 'Sprung ueber Spur');
  ok(ev.some(e => e.t === 'jump' && e.pid === 1 && !e.pad), 'jump-Event');
  ok(ev.some(e => e.t === 'land' && e.pid === 1), 'land-Event');
  eq(pos(A(s)), '9,5', 'Landung nach 4 Zellen');
  const tr = A(s).trail;
  ok(tr.every(p => p[0] <= 5 || p[0] === 9), 'keine Spur unter dem Flug');
  const last = tr[tr.length - 1];
  eq(last[3], 1, 'brk am Landepunkt'); eq(last[0], 9, 'Landepunkt in trail');
  ok(tr.slice(0, -1).every(p => !p[3] || p === tr[0]), 'kein brk sonst');
  // cooldown
  s = mk({});
  const evs = []; let t0 = null, tPrev = 0;
  for (let i = 0; i < 80 && !s.state.over; i++) {
    const tm = s.state.time; s.input(1, 'J');
    for (const e of s.step()) if (e.t === 'jump' && e.pid === 1) evs.push(tm);
    tPrev = tm;
  }
  ok(evs.length >= 2, 'zweiter Sprung nach Cooldown');
  if (evs.length >= 2) ok(evs[1] - evs[0] >= JUMP_CD_MS, 'Cooldown blockt: ' + (evs[1] - evs[0]).toFixed(0) + ' ms >= ' + JUMP_CD_MS);
  ok(evs.length < 2 || evs[1] - evs[0] < JUMP_CD_MS + 300, 'Sprung kommt direkt nach Cooldown');
  // onto terrace at k=4
  s = mk({ rect: [[6, 1, 7, 4, '=']] });
  mv(s, 4, [[[1, 'J']]]);
  eq(pos(A(s)), '6,2', 'Terrassen-Landung bei k=4'); eq(A(s).alt, 1, 'alt 1'); eq(A(s).air, false, 'gelandet');
  eq(A(s).trail[A(s).trail.length - 1][2], 1, 'Wand-Basis 1 auf Terrasse');
  // off a terrace: 5 cells
  s = mk({ rect: [[1, 1, 4, 4, '=']] });
  ev = mv(s, 5, [[[1, 'J']]]);
  eq(pos(A(s)), '7,2', 'Absprung von Terrasse landet nach 5 Zellen'); eq(A(s).alt, 0, 'alt 0');
  ok(!ev.some(e => e.t === 'drop'), 'Sprung ist kein drop');
  // too low into terrace side
  s = mk({ rect: [[7, 1, 6, 4, '=']] });
  mv(s, 5, [[[1, 'J']]]);
  eq(A(s).alive, false, 'zu niedrig gegen Terrassenseite'); eq(A(s).killer, 'wall', 'killer wall');
  // jump path helper
  s = mk({ rect: [[6, 1, 7, 4, '=']] });
  const jp = s.jumpPath(1);
  ok(jp.landed && jp.cells.length === 4 && jp.end.alt === 1, 'jumpPath: Landung auf Terrasse');
  // air steering
  s = mk({ a: [5, 5, 0] }); mv(s, 2, [[[1, 'J']], [[1, 'R']]]);
  eq(A(s).dir, 1, 'Drehen in der Luft'); eq(A(s).air, true, 'noch in der Luft');
}

// ---- ramps, drops ----
{
  const ramp = { rect: [[6, 1, 7, 4, '=']], set: [[5, 2, '>']] };
  let s = mk(Object.assign({}, ramp, { a: [3, 2, 0] }));
  const alts = []; for (let i = 0; i < 4; i++) { mv(s, 1); alts.push(A(s).alt); }
  eq(alts.join(), '0,0.5,1,1', 'Rampe hoch: 0 -> 0.5 -> 1');
  eq(A(s).alive, true, 'Rampe lebt');
  s = mk(Object.assign({}, ramp, { a: [8, 2, 2] }));
  const alts2 = []; for (let i = 0; i < 5; i++) { mv(s, 1); alts2.push(A(s).alt); }
  eq(alts2.join(), '1,1,0.5,0,0', 'Rampe runter: 1 -> 0.5 -> 0');
  s = mk(Object.assign({}, ramp, { a: [5, 5, 3] })); mv(s, 4);
  eq(A(s).alive, false, 'Seiteneinfahrt in Rampe crasht');
  s = mk(Object.assign({}, ramp, { a: [3, 3, 0] })); mv(s, 4);
  eq(A(s).alive, false, 'gegen Terrassenseite gefahren crasht');
  s = mk({ rect: [[1, 1, 5, 4, '=']], a: [4, 2, 0] });
  const ev = mv(s, 2);
  ok(ev.some(e => e.t === 'drop' && e.pid === 1), 'drop-Event'); eq(A(s).alt, 0, 'nach drop alt 0');
  eq(A(s).palt, 1, 'palt vor dem Fall = 1'); eq(A(s).alive, true, 'drop lebt');
  eq(A(s).trail[A(s).trail.length - 1][2], 0, 'Wand nach drop auf Bodenhoehe');
}

// ---- pad ----
{
  let s = mk({ set: [[5, 2, '*']] });
  let ev = mv(s, 3);
  ok(ev.some(e => e.t === 'jump' && e.pad === true), 'Pad loest Sprung aus');
  mv(s, 4);
  eq(pos(A(s)), '9,2', 'Pad-Sprung landet nach 4'); eq(A(s).jumpReadyAt, 0, 'Pad verbraucht den Cooldown nicht');
  ev = mv(s, 1, [[[1, 'J']]]);
  ok(ev.some(e => e.t === 'jump' && e.pad === false), 'danach normaler Sprung sofort moeglich');
}

// ---- head-on ----
{
  let s = mk({ a: [2, 2, 0], b: [8, 2, 2] });
  let ev = mv(s, 3);
  ok(!A(s).alive && !B(s).alive, 'Frontal im selben Feld: beide tot');
  eq(A(s).killer, 'head', 'killer head');
  ok(s.state.over && s.state.winner === null, 'Runde vorbei, Unentschieden');
  ok(ev.some(e => e.t === 'over' && e.winner === null), 'over-Event');
  s = mk({ a: [2, 2, 0], b: [3, 2, 2] }); mv(s, 1);
  ok(!A(s).alive && !B(s).alive && s.state.winner === null, 'Tausch Kopf an Kopf: beide tot');
  s = mk({ a: [2, 2, 0], b: [2, 8, 0], set: [[4, 2, '#']] });
  mv(s, 3);
  eq(s.state.over, true, 'Runde endet bei einem Ueberlebenden'); eq(s.state.winner, 2, 'winner = Ueberlebender');
  eq(mv(s, 1).length, 0, 'step nach Rundenende ist leer');
}

// ---- speed ----
for (const tp of ['chill', 'normal', 'fast']) {
  const T = Sim.CONST.TEMPO[tp];
  const s = mk({ open: true, w: 4000, h: 4, a: [1, 1, 0], b: [1, 2, 0] }, tp);
  ok(Math.abs(500 / s.tickMs - T.start) < 1e-9, tp + ': Starttempo (' + (500 / s.tickMs) + ')');
  let prev = s.tickMs, mono = true;
  for (let i = 0; i < 3000 && !s.state.over; i++) { s.step(); if (s.tickMs > prev + 1e-9) mono = false; prev = s.tickMs; }
  ok(mono, tp + ': tickMs sinkt monoton');
  ok(Math.abs(500 / s.tickMs - T.max) < 1e-6, tp + ': Tempo bei max gedeckelt (' + (500 / s.tickMs).toFixed(2) + ')');
}

// ---- bots ----
const botRound = (map, levels, seed, tempo, max) => {
  const sim = Sim.create({ map, riders: levels.map((l, i) => ({ pid: -(i + 1), bot: true, botLevel: l })), tempo: tempo || 'normal', seed });
  const log = [];
  while (!sim.state.over && sim.state.tick < (max || 12000)) log.push(...sim.step());
  return { sim, log };
};
{
  const a = botRound(Sim.parseMap(Maps[0]), ['normal', 'hard', 'easy', 'normal'], 5);
  const b = botRound(Sim.parseMap(Maps[0]), ['normal', 'hard', 'easy', 'normal'], 5);
  const c = botRound(Sim.parseMap(Maps[0]), ['normal', 'hard', 'easy', 'normal'], 6);
  eq(JSON.stringify(a.log), JSON.stringify(b.log), 'Determinismus: gleicher Seed, gleiche Events');
  ok(JSON.stringify(a.log) !== JSON.stringify(c.log), 'anderer Seed -> anderer Verlauf');
  // humans + same inputs deterministic too
  const run = () => { const s = mk({ a: [5, 5, 0] }); return JSON.stringify(mv(s, 6, [[[1, 'R']], [[1, 'L']], [[1, 'J']]])); };
  eq(run(), run(), 'Determinismus mit Spieler-Inputs');
}

const ROUNDS = 50;
console.log('\nBot-Statistik (' + ROUNDS + ' Runden je Arena, 4 normale Bots):');
console.log('  Arena       | Ø Züge | frühe Tode | Sprünge/Runde | Rundenende');
for (const def of Maps) {
  const map = Sim.parseMap(def);
  let total = 0, early = 0, jumps = 0, over = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const { sim, log } = botRound(map, ['normal', 'normal', 'normal', 'normal'], r + 1);
    total += sim.state.tick; if (sim.state.over) over++;
    if (log.some(e => e.t === 'crash' && sim.state.riders.find(x => x.pid === e.pid).deadAt < 30)) early++;
    jumps += log.filter(e => e.t === 'jump').length;
  }
  const avg = total / ROUNDS / 2;   // Subticks -> Züge
  console.log('  ' + def.key.padEnd(11) + ' | ' + avg.toFixed(0).padStart(7) + ' | ' + (early + '/' + ROUNDS).padStart(10) + ' | ' + (jumps / ROUNDS).toFixed(1).padStart(13) + ' | ' + over + '/' + ROUNDS);
  ok(avg >= 60, def.key + ': Ø Rundenlänge >= 60 Züge (' + avg.toFixed(0) + ')');   // schwächere normale Bots (Phase 2) -> kürzere Runden
  ok(early / ROUNDS <= 0.05, def.key + ': Frühtode <= 5% (' + early + '/' + ROUNDS + ')');
  eq(over, ROUNDS, def.key + ': alle Runden enden');
}
{
  const map = Sim.parseMap(Maps[2]);
  let jumps = 0, climbed = 0, early = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const { sim, log } = botRound(map, ['hard', 'hard', 'hard', 'hard'], 100 + r);
    jumps += log.filter(e => e.t === 'jump').length;
  }
  // alt-1 check needs per-tick state
  for (let r = 0; r < ROUNDS; r++) {
    const sim = Sim.create({ map, riders: [0, 1, 2, 3].map(i => ({ pid: -(i + 1), bot: true, botLevel: 'hard' })), tempo: 'normal', seed: 100 + r });
    let seen = false;
    while (!sim.state.over && sim.state.tick < 12000) { sim.step(); if (sim.state.riders.some(x => x.alive && !x.air && x.alt >= 1)) seen = true; }
    if (seen) climbed++;
  }
  console.log('  terrassen (4 harte Bots): ' + jumps + ' Sprung-Events, Terrasse erreicht in ' + climbed + '/' + ROUNDS + ' Runden');
  ok(jumps > 0, 'harte Bots springen auf Terrassen'); ok(climbed > 0, 'ein Bot erreicht alt 1');
  void early;
}
{
  const map = Sim.parseMap(Maps[0]);
  const wins = { hard: 0, easy: 0, draw: 0 };
  for (let r = 0; r < ROUNDS; r++) {
    const { sim } = botRound(map, ['hard', 'hard', 'easy', 'easy'], 200 + r);
    const w = sim.state.winner;
    if (w === null) wins.draw++; else if (w === -1 || w === -2) wins.hard++; else wins.easy++;
  }
  console.log('  2 harte vs 2 leichte Bots (raster): hart ' + wins.hard + ' / leicht ' + wins.easy + ' / unentschieden ' + wins.draw);
  ok(wins.hard >= wins.easy * 2 && wins.hard - wins.easy >= 15, 'harte Bots gewinnen deutlich öfter');
}

// ================= Phase 2: Subticks, Turbo, Extras =================
const { BOOST_GAIN, BOOST_USE, ITEM_EVERY_MS, ITEM_MAX, BLAST_R } = Sim.CONST;
const near = (a, b, msg) => ok(Math.abs(a - b) < 1e-9, msg + ' (erwartet ' + b + ', war ' + a + ')');
const putItem = (sim, kind, x, y, h) => sim.state.items.push({ id: 900 + sim.state.items.length, kind, x, y, h: h || 0 });
// renderer rebuilds walls from the array: consecutive points must be adjacent unless the second has brk
function trailsOk(sim) {
  const m = sim.state.map;
  for (const r of sim.state.riders) {
    for (let i = 0; i < r.trail.length; i++) {
      const p = r.trail[i];
      if (i === 0) { if (!p[3]) return 'erster Punkt ohne brk (' + r.pid + ')'; continue; }
      const q = r.trail[i - 1];
      if (!p[3] && Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) !== 1) return 'nicht benachbart ohne brk bei ' + p[0] + ',' + p[1] + ' (' + r.pid + ')';
    }
  }
  return '';
}

// ---- subticks ----
{
  let s = mk({ a: [5, 5, 0] });
  const xs = [], pxs = [];
  for (let i = 0; i < 6; i++) { s.step(); xs.push(A(s).x); pxs.push(A(s).px); }
  eq(xs.join(), '5,6,6,7,7,8', 'normaler Fahrer zieht jeden 2. Subtick');
  eq(pxs.join(), '5,5,5,6,6,7', 'p* nur bei Zuegen aktualisiert');
  eq(A(s).ms, 0, 'ms nach dem Zug 0'); eq(A(s).mp, 2, 'mp 2');
  eq(s.state.tick, 6, 'tick zaehlt Subticks');
  // turn applied right before the move, not on idle subticks
  s = mk({ a: [5, 5, 0] }); s.step(); s.input(1, 'R'); s.step();
  eq(A(s).dir, 1, 'Drehung beim naechsten Zug'); eq(pos(A(s)), '5,6', 'Drehung + Zug im selben Subtick');
  s = mk({ a: [5, 5, 0] }); s.step(); s.input(1, 'R');
  eq(A(s).dir, 0, 'Drehung wartet bis zum Zug');
  // boosted rider moves every subtick, no hitch at the speed change
  s = mk({ a: [5, 5, 0] });
  A(s).boost = 1; s.input(1, 'B+');
  const ev = steps(s, 2);
  ok(ev.some(e => e.t === 'boost' && e.pid === 1 && e.on === true), 'boost-Event an'); eq(A(s).boosting, true, 'boosting'); eq(A(s).mp, 1, 'mp 1');
  eq(A(s).ms, 0, 'kein Ruckler: ms 0 beim Wechsel');
  const bx = []; for (let i = 0; i < 4; i++) { s.step(); bx.push(A(s).x); }
  eq(bx.join(), '7,8,9,10', 'geboosteter Fahrer zieht jeden Subtick');
  eq(A(s).px, 9, 'p* = Zelle vor dem letzten Zug');
  // drain and release
  near(A(s).boost, 1 - 4 * BOOST_USE, 'Boost sinkt pro geboostetem Zug');
  steps(s, 1); s.input(1, 'B-'); const ev3 = steps(s, 1);
  ok(ev3.some(e => e.t === 'boost' && e.on === false), 'B-: boost-Event aus'); eq(A(s).mp, 2, 'zurueck auf mp 2');
  // runs dry
  s = mk({ a: [5, 5, 0] }); A(s).boost = 0.1; s.input(1, 'B+');
  const evd = steps(s, 12);
  const offs = evd.filter(e => e.t === 'boost');
  eq(offs.length, 2, 'Boost an und (leer) wieder aus'); eq(offs[1].on, false, 'leer -> aus');
  eq(A(s).boost, 0, 'Meter leer'); eq(A(s).mp, 2, 'wieder normal');
  // boost works in the air
  s = mk({ a: [5, 5, 0] }); A(s).boost = 1; s.input(1, 'B+'); s.input(1, 'J');
  steps(s, 2); eq(A(s).air, true, 'in der Luft'); eq(A(s).boosting, true, 'Boost in der Luft');
  const ax = A(s).x; steps(s, 2); eq(A(s).x, ax + 2, 'Boost wirkt in der Luft');
  // jump cooldown counts sim-ms, speed independent
  s = mk({}); s.input(1, 'J'); steps(s, 2);
  ok(A(s).jumpReadyAt >= JUMP_CD_MS, 'Cooldown ab Absprung (Sim-ms, nicht Subticks)');
}

// ---- grind / turbo gain ----
{
  let s = mk({ h: 5, a: [2, 1, 0], b: [2, 3, 0] });
  mv(s, 5);
  eq(A(s).grind, 1, 'Grinden links (Wand oben)'); near(A(s).boost, 5 * BOOST_GAIN, 'Gewinn links 5 x 0.04');
  s = mk({ h: 3, a: [2, 1, 0], b: [30, 1, 0] });
  mv(s, 5);
  eq(A(s).grind, 3, 'Grinden beidseitig'); near(A(s).boost, 5 * 2 * BOOST_GAIN, 'Gewinn beidseitig doppelt');
  s = mk({ a: [2, 5, 0], b: [3, 6, 0] });
  mv(s, 4);
  eq(A(s).grind & 2, 2, 'Grinden an fremder Lichtwand (rechts)');
  s = mk({ h: 3, a: [2, 1, 0], b: [30, 1, 0] });
  A(s).boost = 0.98; mv(s, 3); eq(A(s).boost, 1, 'Meter bei 1 gedeckelt');
  s = mk({ h: 3, a: [2, 1, 0], b: [30, 1, 0] }); s.input(1, 'J'); mv(s, 3);
  eq(A(s).grind, 0, 'in der Luft kein Grinden');
  // extras off: nothing
  s = mk({ h: 3, a: [2, 1, 0], b: [30, 1, 0] }, 'normal', false);
  s.input(1, 'B+'); const e0 = mv(s, 6);
  eq(A(s).boost, 0, 'extras:false: kein Gewinn'); eq(A(s).boosting, false, 'extras:false: kein Boost');
  ok(!e0.some(e => e.t === 'boost'), 'extras:false: keine boost-Events'); eq(A(s).mp, 2, 'extras:false: mp 2');
  eq(s.state.extras, false, 'state.extras');
}

// ---- item spawning ----
{
  const run = (seed) => {
    const w = 400, rows = [];
    for (let y = 0; y < 40; y++) rows.push(Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === 39) ? '#' : (x === 200 && y > 15 && y < 25 ? '#' : '.')).join(''));
    const m = Sim.parseMap({ key: 't', label: 't', theme: {}, rows, spawns: [{ x: 2, y: 10, dir: 0 }, { x: 2, y: 30, dir: 0 }] });
    const sim = Sim.create({ map: m, riders: [{ pid: 1 }, { pid: 2 }], tempo: 'chill', seed });
    const spawns = []; let maxN = 0, bad = '', cleared = false;
    while (!sim.state.over && sim.state.time < 60000) {
      for (const e of sim.step()) if (e.t === 'itemSpawn') {
        spawns.push([e.kind, e.x, e.y, e.h].join(':'));
        const c = e.y * m.w + e.x;
        if (m.wall[c]) bad = 'Item auf Wand';
        if (sim.state.riders.some(r => r.trail.some(p => p[0] === e.x && p[1] === e.y))) bad = 'Item auf Spur';
        if (sim.state.riders.some(r => r.alive && Math.max(Math.abs(r.x - e.x), Math.abs(r.y - e.y)) < 4)) bad = 'Item zu nah am Kopf';
      }
      maxN = Math.max(maxN, sim.state.items.length);
      if (spawns.length === ITEM_MAX && sim.state.items.length === ITEM_MAX && !cleared) { cleared = true; sim.state.items.length = 0; }   // picked up -> refills
    }
    return { spawns, maxN, bad, t: sim.state.time, items: sim.state.items.slice() };
  };
  const a = run(3), b = run(3), c = run(4);
  eq(a.bad, '', 'Item-Spawn-Regeln'); ok(a.spawns.length >= 6 && a.spawns.length <= 11, 'Items spawnen regelmaessig (' + a.spawns.length + ')');
  eq(a.maxN, ITEM_MAX, 'maximal ' + ITEM_MAX + ' Items gleichzeitig');
  eq(a.spawns.join('|'), b.spawns.join('|'), 'Item-Spawns deterministisch');
  ok(a.spawns.join('|') !== c.spawns.join('|'), 'anderer Seed -> andere Items');
  ok(a.items.every(t => ['boost', 'jump', 'shield', 'blast'].includes(t.kind)), 'nur bekannte Kinds');
  {
    const s = mk({ w: 300, h: 40, a: [2, 10, 0], b: [2, 30, 0] }); let first = null;
    for (let i = 0; i < 400 && first === null; i++) for (const e of s.step()) if (e.t === 'itemSpawn') first = s.state.time;
    ok(first !== null && first >= ITEM_EVERY_MS && first < ITEM_EVERY_MS + 300, 'erstes Item nach ~' + ITEM_EVERY_MS + ' ms (' + (first | 0) + ')');
  }
  // never on ramps/pads: all 3 arenas, bots
  for (const def of Maps) {
    const map = Sim.parseMap(def);
    for (let r = 0; r < 6; r++) {
      const sim = Sim.create({ map, riders: [{ pid: -1, bot: true, botLevel: 'easy' }, { pid: -2, bot: true, botLevel: 'easy' }], tempo: 'chill', seed: r + 1 });
      while (!sim.state.over && sim.state.tick < 8000) for (const e of sim.step()) if (e.t === 'itemSpawn') {
        const ci = e.y * map.w + e.x;
        ok(!map.pad[ci] && map.rampDir[ci] < 0 && !map.wall[ci] && e.h === map.floor[ci], def.key + ': Item nicht auf Wand/Rampe/Pad');
      }
    }
  }
  // extras off: never
  const so = mk({ w: 300, h: 40, a: [2, 10, 0], b: [2, 30, 0] }, 'chill', false);
  steps(so, 200); ok(so.state.time > ITEM_EVERY_MS && so.state.items.length === 0, 'extras:false: keine Items');
}

// ---- pickup ----
{
  let s = mk({ a: [3, 5, 0] }); putItem(s, 'boost', 6, 5, 0);
  let ev = mv(s, 2); eq(s.state.items.length, 1, 'noch nicht eingesammelt');
  ev = mv(s, 1);
  ok(ev.some(e => e.t === 'item' && e.pid === 1 && e.kind === 'boost' && e.x === 6 && e.y === 5), 'item-Event am Boden');
  eq(s.state.items.length, 0, 'Item entfernt'); eq(A(s).boost, 1, 'Turbo-Akku: boost = 1');
  // airborne high: passes over a ground item untouched (alt 1.6 >= 0.8)
  s = mk({ a: [3, 5, 0] }); putItem(s, 'boost', 5, 5, 0);   // k = 2 -> alt 1.6
  s.input(1, 'J'); ev = mv(s, 4);
  eq(s.state.items.length, 1, 'Sprung hoch ueber Item: nicht eingesammelt'); ok(!ev.some(e => e.t === 'item'), 'kein item-Event');
  // airborne low: flying over a terrace item (alt 1.6 < 1 + 0.8)
  s = mk({ a: [4, 2, 0], rect: [[6, 1, 7, 4, '=']] }); putItem(s, 'shield', 7, 2, 1);   // k = 3 -> alt 1.2 < 1.8 -> low
  s.input(1, 'J'); ev = mv(s, 4);
  ok(ev.some(e => e.t === 'item' && e.kind === 'shield'), 'niedrig ueber Terrassen-Item: eingesammelt'); eq(A(s).shield, true, 'Schild aktiv');
  // jump item resets the cooldown
  s = mk({ a: [3, 5, 0] }); s.input(1, 'J'); mv(s, 1); ok(A(s).jumpReadyAt > s.state.time + 1000, 'Cooldown laeuft');
    mv(s, 4); putItem(s, 'jump', A(s).x + 1, 5, 0); mv(s, 2);
  ok(A(s).jumpReadyAt <= s.state.time, 'Sprungfeder: Cooldown zurueckgesetzt');
  // dead riders collect nothing; item stays when the cell is not entered
  s = mk({ a: [3, 5, 0] }); putItem(s, 'boost', 4, 6, 0); mv(s, 3); eq(s.state.items.length, 1, 'Item abseits bleibt liegen');
}

// ---- shield ----
{
  const cross = { a: [2, 5, 0], b: [7, 2, 1] };
  let s = mk(cross); mv(s, 4);
  A(s).shield = true;
  const trB = B(s).trail.length;
  let ev = mv(s, 1);
  eq(A(s).alive, true, 'Schild: Wand durchfahren'); eq(pos(A(s)), '7,5', 'steht in der Wandzelle');
  ok(ev.some(e => e.t === 'shield' && e.pid === 1 && e.x === 7 && e.y === 5), 'shield-Event'); eq(A(s).shield, false, 'Schild verbraucht');
  ok(!B(s).trail.some(p => p[0] === 7 && p[1] === 5), 'Wandzelle aus der Spur des Besitzers geloescht');
  ok(B(s).trail.length <= trB, 'Spur kuerzer'); eq(B(s).trailRev, 1, 'trailRev erhoeht'); eq(trailsOk(s), '', 'Spuren konsistent nach Schild');
  // the point after the hole starts a new run
  const after = B(s).trail.find(p => p[1] === 6); ok(after && after[3] === 1, 'Punkt nach der Luecke hat brk');
  // consumed once: the next wall kills
  mv(s, 1, [[[1, 'R']]]);
  mv(s, 1);
  eq(A(s).alive, false, 'zweite Wand toetet wieder'); ok(A(s).killer === 2, 'killer = Besitzer');
  // only light walls: wall block, edge, head-on
  s = mk({ set: [[6, 2, '#']] }); A(s).shield = true; mv(s, 5);
  eq(A(s).alive, false, 'Schild schuetzt nicht vor Wandblock'); eq(A(s).shield, true, 'Schild unverbraucht');
  s = mk({ open: true, w: 12, h: 5, a: [9, 1, 0], b: [1, 3, 0] }); A(s).shield = true; mv(s, 4);
  eq(A(s).killer, 'edge', 'Schild schuetzt nicht vor Arenarand');
  s = mk({ a: [2, 2, 0], b: [8, 2, 2] }); A(s).shield = true; B(s).shield = true; mv(s, 3);
  ok(!A(s).alive && !B(s).alive && A(s).killer === 'head', 'Schild schuetzt nicht vor Kopf-an-Kopf');
}

// ---- blast ----
{
  let s = mk({ a: [8, 2, 1], b: [2, 5, 0] });
  mv(s, 3);
  putItem(s, 'blast', 6, 5, 0);
  const ev = mv(s, 1);
  ok(ev.some(e => e.t === 'blast' && e.pid === 2 && e.x === 6 && e.y === 5 && e.r === BLAST_R), 'blast-Event');
  const inR = (p) => Math.abs(p[0] - 6) <= BLAST_R && Math.abs(p[1] - 5) <= BLAST_R;
  for (const r of [A(s), B(s)]) ok(r.trail.every(p => !inR(p) || (p[0] === r.x && p[1] === r.y)), 'Radius leergeraeumt, Koepfe bleiben (' + r.pid + ')');
  ok(B(s).trail.some(p => p[0] === 6 && p[1] === 5) && A(s).trail.some(p => p[0] === A(s).x && p[1] === A(s).y), 'Koepfe behalten ihre Wand');
  ok(B(s).trail.some(p => p[0] === 2 && p[1] === 5), 'Spur ausserhalb des Radius bleibt');
  ok(A(s).trailRev >= 1 && B(s).trailRev >= 1, 'trailRev erhoeht'); eq(trailsOk(s), '', 'Spuren nach Blast konsistent');
  eq(s.probe(2, 2).ok, true, 'geleerte eigene Zelle ist wieder befahrbar (Belegung)');
  eq(s.probe(1, 3).ok, true, 'geleerte Zelle des anderen Fahrers befahrbar');
  mv(s, 3); eq(trailsOk(s), '', 'Spuren weiter konsistent'); eq(B(s).alive, true, 'Blast-Fahrer lebt');
  // whole bot rounds: trails stay renderable
  for (const def of Maps) {
    const map = Sim.parseMap(def);
    for (let r = 0; r < 4; r++) {
      const sim = Sim.create({ map, riders: [0, 1, 2, 3].map(i => ({ pid: -(i + 1), bot: true, botLevel: i % 2 ? 'hard' : 'normal' })), tempo: 'fast', seed: 40 + r });
      let bad = '', cnt = 0;
      while (!sim.state.over && sim.state.tick < 12000) { const e = sim.step(); cnt += e.filter(q => q.t === 'blast' || q.t === 'shield').length; if (sim.state.tick % 40 === 0) bad = bad || trailsOk(sim); }
      eq(bad || trailsOk(sim), '', def.key + ': Spuren konsistent (Bot-Runde, ' + cnt + ' Erase-Events)');
    }
  }
}

// ---- probe ----
{
  let s = mk({ a: [5, 1, 0], set: [[6, 1, '#']] });
  eq(s.probe(1, 0).ok, false, 'probe: Wand voraus'); eq(s.probe(1, 0).by, 'wall', 'probe by wall');
  eq(s.probe(1, 1).ok, true, 'probe: Seite frei'); eq(s.probe(1, 3).ok, false, 'probe: Randmauer');
  eq(s.probe(99, 0), null, 'probe: unbekannter Fahrer');
  s = mk({ a: [5, 5, 0] }); mv(s, 1);
  eq(s.probe(1, 2).ok, false, 'probe: eigene Spur'); eq(s.probe(1, 2).by, 'self', 'probe by self');
  eq(s.probe(1, 0).ok, true, 'probe: freie Zelle voraus');
  const sp = s.state.riders[0].x; mv(s, 0); eq(s.state.riders[0].x, sp, 'probe veraendert nichts');
}

// ---- novice proxy vs bot levels (fixed policy, do not tune to the targets) ----
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function noviceRound(level, seed) {
  const sim = Sim.create({ map: Sim.parseMap(Maps[0]), riders: [{ pid: 1, bot: false }, { pid: -1, bot: true, botLevel: level }], tempo: 'normal', seed, extras: true });
  const rnd = mulberry(seed * 31 + 5), me = sim.state.riders[0];
  while (!sim.state.over && sim.state.tick < 40000) {
    if (me.alive && !me.air && me.ms + 1 >= me.mp) {
      const d = me.dir, sides = [['L', (d + 3) % 4], ['R', (d + 1) % 4]];
      const safe = sides.filter(q => sim.probe(1, q[1]).ok);
      if (!sim.probe(1, d).ok) { if (rnd() >= 0.25 && safe.length) sim.input(1, safe[(rnd() * safe.length) | 0][0]); }
      else if (rnd() < 0.03) { const q = sides[rnd() < 0.5 ? 0 : 1]; if (sim.probe(1, q[1]).ok) sim.input(1, q[0]); }
    }
    sim.step();
  }
  return sim.state.over ? sim.state.winner : undefined;
}
{
  const N = 200, rate = {};
  console.log('\nSchwierigkeit: Anfaenger-Proxy 1v1 auf Raster, normal, Extras an, ' + N + ' Runden');
  console.log('  Gegner | Anfaenger gewinnt | Bot gewinnt | unentschieden | Anfaenger-Quote (entschiedene)');
  for (const lv of ['easy', 'normal', 'hard']) {
    let nw = 0, bw = 0, dr = 0;
    for (let r = 0; r < N; r++) { const w = noviceRound(lv, r + 1); if (w === 1) nw++; else if (w === -1) bw++; else dr++; }
    rate[lv] = nw / (nw + bw);
    console.log('  ' + lv.padEnd(6) + ' | ' + String(nw).padStart(17) + ' | ' + String(bw).padStart(11) + ' | ' + String(dr).padStart(13) + ' | ' + (100 * rate[lv]).toFixed(1) + ' %');
  }
  ok(rate.easy >= 0.55, 'Anfaenger schlaegt easy in >= 55 % (' + (100 * rate.easy).toFixed(1) + ')');
  ok(rate.normal >= 0.25 && rate.normal <= 0.45, 'Anfaenger schlaegt normal in 25-45 % (' + (100 * rate.normal).toFixed(1) + ')');
  ok(1 - rate.hard >= 0.85, 'hard schlaegt den Anfaenger in >= 85 % (' + (100 * (1 - rate.hard)).toFixed(1) + ')');
}

// ---- bots and Phase 2 ----
{
  const map = Sim.parseMap(Maps[2]);
  const count = (levels, n) => {
    const c = { boost: 0, item: 0, jump: 0, shield: 0, blast: 0 };
    for (let r = 0; r < n; r++) {
      const { log } = botRound(map, levels, 500 + r, 'normal');
      for (const e of log) { if (e.t === 'boost' && e.on) c.boost++; else if (e.t === 'item') c.item++; else if (e.t === 'jump' && !e.pad) c.jump++; else if (e.t === 'shield') c.shield++; else if (e.t === 'blast') c.blast++; }
    }
    return c;
  };
  const e = count(['easy', 'easy', 'easy', 'easy'], 30), h = count(['hard', 'hard', 'hard', 'hard'], 30), nm = count(['normal', 'normal', 'normal', 'normal'], 30);
  console.log('  Extras-Nutzung (30 Runden terrassen, 4 Bots): easy ' + JSON.stringify(e) + '\n    normal ' + JSON.stringify(nm) + '\n    hard ' + JSON.stringify(h));
  eq(e.boost, 0, 'easy boostet nie'); eq(e.jump, 0, 'easy springt nie absichtlich');
  ok(h.boost > 0 && h.item > 0, 'hard nutzt Turbo und sammelt Items'); ok(nm.item > 0, 'normal sammelt Items ein');
  // easy ignores items: not more pickups than random driving would give
  ok(e.item <= h.item, 'easy sammelt nicht gezielt');
}

// ---- player leaves mid-round ----
{
  const sim = mk({});
  mv(sim, 2);
  const ev = sim.kill(2);
  ok(ev.some(e => e.t === 'crash' && e.pid === 2 && e.by === 'left'), 'kill: crash-Event mit by "left"');
  ok(!B(sim).alive && B(sim).killer === 'left', 'kill: Fahrer ist raus');
  ok(sim.state.over && sim.state.winner === 1, 'kill: letzter Fahrer gewinnt');
  eq(sim.kill(2).length, 0, 'kill: zweites Mal ohne Wirkung');
}

// ---- performance ----
{
  const map = Sim.parseMap(Maps[2]);
  let n = 0, ms = 0;
  for (let r = 0; r < 20; r++) {
    const sim = Sim.create({ map, riders: [0, 1, 2, 3].map(i => ({ pid: -(i + 1), bot: true, botLevel: 'hard' })), tempo: 'normal', seed: 300 + r });
    while (!sim.state.over && sim.state.tick < 6000) { const t = process.hrtime.bigint(); sim.step(); ms += Number(process.hrtime.bigint() - t) / 1e6; n++; }
  }
  const avg = ms / n;
  console.log('  Performance: Ø ' + (avg * 1000).toFixed(0) + ' µs pro Subtick (4 harte Bots, terrassen, ' + n + ' steps)');
  ok(avg < 1.0, 'Ø step < 1.0 ms (' + avg.toFixed(3) + ')');
}

console.log(process.exitCode ? '\nFEHLER aufgetreten' : '\nOK: ' + checks + ' Prüfungen bestanden');
