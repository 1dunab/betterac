// Bot-Tests Furt & Fehde: die KI-Lords (bots.js) – API, Determinismus, Pakt-Antworten, Übernahme, ganze Spiele in drei Stärken, Balance-Tabelle.
// Phase 1b: harte Prüfung „kein Haus hungert länger als 60 s am Stück“ (Ritter- und Kriegsherr-Tabelle), kein Fackelzug vor RAID_AFTER_S, die Bots
// pausieren nie, und der Futterversuch (was ernährt ein Hof, halten 8 Höfe 16 Leute bei wartenden Baustellen?) wird mit ausgegeben.
// Zweite Runde: R11 lässt einen Hof mit vollem 🌾-Lager ruhen – der Futterversuch zählt leere Höfe nur bei Platz im Lager und lässt die Rekruten nie unter 8 Höfe + 5 Bauern gehen.
// Phase 2 (E4, Mauern & Söldner): harte Prüfungen: Ritter und Kriegsherr bauen Markt und Söldnerlager (≥ 90 % der Häuser), die Fackelzüge kommen wieder, kein Haus lässt Bauern
// stranden (≥ 3 Untätige bei freien Arbeitsplätzen über 60 s), „greifen an“ wieder ≥ 97 %; ein Belagerungsversuch (Bot gegen ein von Steinmauern umschlossenes Haus: Ramme, Bruch);
// weiche Ziele werden ausgegeben: Mauern, Brüche, Rammen, gehandeltes Gold.
// Phase 2a (F2, Pakte enden friedlich): ein Bot verlängert einen Pakt in dessen letzter Minute, wenn er mit ihm zufrieden ist (stärkerer Partner oder Bedrängnis durch Dritte) und nichts gegen den Partner plant
// (der Kronenträger, auf den ein Ritter zielt, wird nicht verlängert); ganze Spiele und Balance-Tabelle bleiben Zahl für Zahl wie vorher (Bots bieten untereinander keine Pakte an).
// Ganze Spiele laufen parallel in worker_threads (jedes Spiel ist deterministisch, die Reihenfolge der Ergebnisse spielt keine Rolle).
//   FF_JOBS=n      Zahl der Worker (Standard: Kerne, höchstens 10)
//   FF_QUICK=1     kleine Ausgabe: 3 Seeds je Stärke, 6 Mischspiele (nur zum schnellen Ansehen, die Schwellen gelten dann nicht)
//   FF_TUNE='{"EAT_S":60}'   was-wäre-wenn: überschreibt Werte in FurtSim.CONST (auch "BUILD.bergfried.hp"), nur für Messungen
'use strict';
const fs = require('fs');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const W = require('./public/games/furtfehde/world.js');
const Sim = require('./public/games/furtfehde/sim.js');
const Bots = require('./public/games/furtfehde/bots.js');
const C = Sim.CONST;

const STRENGTHS = ['knappe', 'ritter', 'kriegsherr'];
const SITE = ['NW', 'NO', 'SW', 'SO'];
const TICKS = 15;

function applyTune(tune) {   // FF_TUNE: dotted paths into CONST
  for (const k in tune || {}) { const p = k.split('.'); let t = C; for (let i = 0; i < p.length - 1; i++) t = t[p[i]]; t[p[p.length - 1]] = tune[k]; }
}

// ---- one full match with bots on the given houses; every metric the table needs ----
function playMatch(job) {
  applyTune(job.tune);
  const seed = job.seed, strengths = job.strengths, n = strengths.length, dauer = job.dauer || 12;
  const lords = job.lords || strengths.map((_, i) => ({ i, site: i }));
  const sim = Sim.create({ seed, world: W.make(seed), dauer, burgfrieden: job.burgfrieden === undefined ? 120 : job.burgfrieden, lords });
  const bots = strengths.map((s, k) => Bots.create(sim, lords[k].i, { strength: s, seed: seed * 31 + k }));
  const st = sim.state;
  const m = {
    seed, strengths, lords, peakSold: new Array(n).fill(0), peakB: new Array(n).fill(0), hungerMax: new Array(n).fill(0), hungerTot: new Array(n).fill(0),
    trained: new Array(n).fill(0), hrun: new Array(n).fill(0), fehdeT: -1, firstAttack: -1, firstKill: -1, firstIgnite: -1, plunders: 0, ev: {}, botMs: 0, simMs: 0, steps: 0,
    // Phase 2, per bot: first time a kind stood finished, stranding monitor (≥ 3 idle peasants while workplaces have empty slots: current and longest run in seconds), gold and walls
    kinds: lords.map(() => ({})), srun: new Array(n).fill(0), strandMax: new Array(n).fill(0), goldSold: new Array(n).fill(0), goldBought: new Array(n).fill(0), tradeN: new Array(n).fill(0),
    wallsBuilt: new Array(n).fill(0), torBuilt: new Array(n).fill(0), ramsRecruited: new Array(n).fill(0), riders: new Array(n).fill(0), garrisoned: new Array(n).fill(0), breached: new Array(n).fill(0), ramBlows: 0, breachByKind: {}, ignites: new Array(n).fill(0)
  };
  const idx = {}; lords.forEach((l, k) => { idx[l.i] = k; });
  const maxSteps = dauer * 60 * TICKS + 10;   // step cap: a match never runs longer than its clock
  for (let i = 0; i < maxSteps && st.phase !== 'over'; i++) {
    const t0 = process.hrtime.bigint();
    for (const b of bots) b.step();
    const t1 = process.hrtime.bigint();
    const ev = sim.step();
    const t2 = process.hrtime.bigint();
    m.botMs += Number(t1 - t0) / 1e6; m.simMs += Number(t2 - t1) / 1e6; m.steps++;
    for (const e of ev) {
      m.ev[e.t] = (m.ev[e.t] || 0) + 1;
      if (e.t === 'fehde') m.fehdeT = st.t;
      else if (e.t === 'attack' && m.firstAttack < 0) m.firstAttack = st.t;
      else if (e.t === 'death' && e.by !== null && e.by !== e.lord && m.firstKill < 0) m.firstKill = st.t;
      else if (e.t === 'ignite' && e.by !== null) { const b = st.buildings.find(x => x.id === e.id); if (b && b.lord !== e.by) { if (m.firstIgnite < 0) m.firstIgnite = st.t; if (idx[e.by] !== undefined) m.ignites[idx[e.by]]++; } }
      else if (e.t === 'plunder') m.plunders++;
      else if (e.t === 'trained' && idx[e.lord] !== undefined) m.trained[idx[e.lord]]++;
      else if (e.t === 'buildDone') { const b = st.buildings.find(x => x.id === e.id); if (b && idx[b.lord] !== undefined && m.kinds[idx[b.lord]][b.kind] === undefined) m.kinds[idx[b.lord]][b.kind] = st.t; }
      else if (e.t === 'build' && idx[e.lord] !== undefined) { if (e.kind === 'palisade' || e.kind === 'mauer') m.wallsBuilt[idx[e.lord]]++; else if (e.kind === 'torhaus') m.torBuilt[idx[e.lord]]++; }
      else if (e.t === 'trade' && idx[e.lord] !== undefined) { m.tradeN[idx[e.lord]]++; if (e.side === 'sell') m.goldSold[idx[e.lord]] += e.gold; else m.goldBought[idx[e.lord]] += e.gold; }
      else if (e.t === 'recruit' && idx[e.lord] !== undefined) { if (e.unit === 'ramme') m.ramsRecruited[idx[e.lord]]++; else if (e.unit === 'reiterschuetze') m.riders[idx[e.lord]]++; }
      else if (e.t === 'garrison' && e.on && idx[e.lord] !== undefined) m.garrisoned[idx[e.lord]]++;
      else if (e.t === 'breach') { if (idx[e.lord] !== undefined) m.breached[idx[e.lord]]++; m.breachByKind[e.kind] = (m.breachByKind[e.kind] || 0) + 1; }
      else if (e.t === 'ram') m.ramBlows++;
    }
    if (i % TICKS === 0) for (let k = 0; k < n; k++) {   // once per second
      const l = st.lords[k];
      if (l.soldiers > m.peakSold[k]) m.peakSold[k] = l.soldiers;
      if (l.hunger) { m.hrun[k]++; m.hungerTot[k]++; if (m.hrun[k] > m.hungerMax[k]) m.hungerMax[k] = m.hrun[k]; } else m.hrun[k] = 0;
      // stranding: at least 3 idle peasants while a finished workplace that is neither full nor resting has an empty worker slot
      let empty = 0;
      for (const x of st.buildings) if (x.lord === l.i && x.build >= 1 && !x.ruined && !x.paused && !x.full && (C.BUILD[x.kind].workers || 0) > (x.workers || 0)) empty++;
      if (empty > 0 && sim.youOf(l.i).idle >= 3) { m.srun[k]++; if (m.srun[k] > m.strandMax[k]) m.strandMax[k] = m.srun[k]; } else m.srun[k] = 0;
    }
    if (i % (TICKS * 10) === 0) for (let k = 0; k < n; k++) {   // every 10 s
      let b = 0;
      for (const x of st.buildings) if (x.lord === st.lords[k].i && x.kind !== 'bergfried' && x.build >= 1 && !x.ruined) b++;
      if (b > m.peakB[k]) m.peakB[k] = b;
    }
  }
  const fights = [m.firstAttack, m.firstKill, m.firstIgnite].filter(x => x >= 0);
  m.fight = fights.length ? Math.min(...fights) : -1;
  m.over = st.phase === 'over';
  m.ranking = st.ranking ? st.ranking.map(r => ({ lord: r.lord, k: idx[r.lord], site: st.lords.find(l => l.i === r.lord).site, ruhm: r.ruhm, people: r.people, soldiers: r.soldiers, buildings: r.buildings, stats: r.stats, by: r.by })) : null;
  m.bots = bots.map(b => ({ errors: b.stats.errors, lastError: b.stats.lastError, attacks: b.stats.attacks, raids: b.stats.raids, retreats: b.stats.retreats, defends: b.stats.defends, thinks: b.stats.thinks, builds: b.stats.builds, recruits: b.stats.recruits, trades: b.stats.trades, wallPieces: b.stats.wallPieces, rams: b.stats.rams, garrisons: b.stats.garrisons }));
  return m;
}

if (!isMainThread) {   // a worker plays one match and hands the metrics back
  let out;
  try { out = playMatch(workerData); } catch (e) { out = { error: String(e && e.stack || e).split('\n').slice(0, 4).join(' | '), seed: workerData.seed }; }
  parentPort.postMessage(out);
  return;
}

// =====================================================================================================================
let checks = 0, misses = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function eq(a, b, msg) { checks++; if (a !== b) fail(msg + ' (erwartet ' + b + ', war ' + a + ')'); }
function goal(cond, msg) { if (!cond) misses++; console.log('  ' + (cond ? '✓ Ziel erreicht: ' : '✗ Ziel verfehlt:  ') + msg); }   // balance targets: reported, they do not fail the run
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const pct = (a, b) => (b ? Math.round(100 * a / b) : 0) + ' %';
const T0 = process.hrtime.bigint();
const secs = () => Number(process.hrtime.bigint() - T0) / 1e9;

const QUICK = !!process.env.FF_QUICK;
let TUNE = null;
if (process.env.FF_TUNE) { TUNE = JSON.parse(process.env.FF_TUNE); applyTune(TUNE); }
const SEEDS = QUICK ? 3 : 10, EXTRA = QUICK ? 0 : 10, MIXSEEDS = QUICK ? 2 : 5;

function mk(opts) {
  opts = opts || {};
  const seed = opts.seed || 1;
  return Sim.create(Object.assign({ seed, world: W.make(seed), dauer: 12, burgfrieden: 120 }, opts));
}
function run(sim, bots, steps, each) {   // step the bots, then the sim; returns the events
  const log = [];
  for (let i = 0; i < steps && sim.state.phase !== 'over'; i++) {
    if (each) each(i);
    for (const b of bots) if (b) b.step();
    for (const e of sim.step()) log.push(e);
  }
  return log;
}
const ofType = (log, t) => log.filter(e => e.t === t);

console.log('Bot-Tests Furt & Fehde' + (QUICK ? ' (FF_QUICK: kleine Ausgabe, Schwellen gelten nicht)' : '') + (TUNE ? ' · FF_TUNE ' + JSON.stringify(TUNE) : ''));

// ---- source hygiene: public sim API only, no clock, no unseeded randomness ----
{
  const src = fs.readFileSync('./public/games/furtfehde/bots.js', 'utf8');
  ok(!/Math\.random/.test(src), 'bots.js enthält Math.random');
  ok(!/\bDate\b/.test(src), 'bots.js enthält Date');
  ok(!/performance\.now|setTimeout|setInterval|requestAnimationFrame/.test(src), 'bots.js greift auf Zeit-APIs zu');
  ok(!/\bdev\b/.test(src.replace(/\/\/.*$/gm, '')), 'bots.js benutzt Test-Hooks (sim.dev)');
  const code = src.replace(/\/\/.*$/gm, '').replace(/'[^'\n]*'/g, "''");   // without comments and string literals
  const used = new Set(); let mt; const re = /\bsim\.(\w+)/g;
  while ((mt = re.exec(code))) used.add(mt[1]);
  const allowed = ['build', 'buildWall', 'cancel', 'recruit', 'trade', 'banner', 'home', 'pact', 'state', 'youOf', 'world', 'occ', 'dt'];
  ok([...used].every(k => allowed.includes(k)), 'bots.js benutzt nur die öffentliche Sim-API (benutzt: ' + [...used].join(', ') + ')');
  ok(['build', 'buildWall', 'recruit', 'banner', 'pact', 'youOf', 'state', 'trade'].every(k => used.has(k)), 'bots.js benutzt build, buildWall, recruit, banner, pact, youOf, state, trade');
  ok(!used.has('pause'), 'bots.js ruft sim.pause nie auf (Bots lassen keinen Betrieb ruhen)');
  console.log('\n  Quelltext: öffentliche Sim-API (' + [...used].sort().join(', ') + '), keine Uhr, kein Math.random');
}

// ---- API: create, strengths, bad input ----
{
  const sim = mk();
  const bot = Bots.create(sim, 0, { strength: 'ritter', seed: 1 });
  eq(typeof bot.step, 'function', 'create → step()');
  eq(Object.keys(Bots.PROFILES).join(), 'knappe,ritter,kriegsherr', 'drei Stärken');
  const P = Bots.PROFILES;
  eq([P.knappe.think, P.ritter.think, P.kriegsherr.think].join(), '30,15,15', 'Denkintervall: Knappe alle 2 s, die anderen jede Sekunde');
  eq([P.knappe.thr, P.ritter.thr, P.kriegsherr.thr].join(), '14,10,8', 'Angriffsschwellen 14 / 10 / 8');
  eq(P.knappe.knights, false, 'der Knappe hebt keine Ritter aus'); ok(P.ritter.knights && P.kriegsherr.knights, 'Ritter und Kriegsherr heben Ritter aus');
  eq([Bots.RAID_AFTER_S.knappe, Bots.RAID_AFTER_S.ritter, Bots.RAID_AFTER_S.kriegsherr].join(), 'Infinity,120,60', 'RAID_AFTER_S: Knappe nie, Ritter 120 s, Kriegsherr 60 s nach dem Beginn der Fehde');
  eq([P.knappe.raidAfter, P.ritter.raidAfter, P.kriegsherr.raidAfter].join(), 'Infinity,120,60', 'die Profile tragen raidAfter');
  eq(Bots.create(sim, 0, { strength: 'quatsch' }).strength, 'ritter', 'unbekannte Stärke → ritter');
  let threw = false;
  try { const a = Bots.create(sim, 99, { strength: 'ritter' }), b = Bots.create(null, 0, {}), c = Bots.create(sim, 'x'); a.step(); b.step(); c.step(); } catch (e) { threw = true; }
  ok(!threw, 'unbekanntes Haus / kein Sim / schiefe Eingabe wirft nicht');
  // thinking rhythm: the knappe thinks half as often
  const s2 = mk({ seed: 2 }), kn = Bots.create(s2, 0, { strength: 'knappe', seed: 2 }), ri = Bots.create(s2, 1, { strength: 'ritter', seed: 2 });
  run(s2, [kn, ri], 60 * TICKS);
  ok(Math.abs(kn.stats.thinks - 30) <= 1 && Math.abs(ri.stats.thinks - 60) <= 1, 'Denkrhythmus in 60 s: Knappe ' + kn.stats.thinks + ' (≈ 30), Ritter ' + ri.stats.thinks + ' (≈ 60)');
  // after the end it stays quiet
  const s3 = mk({ seed: 3, dauer: 6 }), b3 = Bots.create(s3, 0, { strength: 'ritter', seed: 3 });
  run(s3, [b3], 6 * 60 * TICKS + 5); let after = true; try { for (let i = 0; i < 30; i++) b3.step(); } catch (e) { after = false; }
  ok(s3.state.phase === 'over' && after && b3.stats.errors === 0, 'nach dem Ende: step() ist still und wirft nicht');
  console.log('  API: create/step, drei Stärken (Denken 2 s / 1 s / 1 s, Schwellen 14 / 10 / 8), schiefe Eingaben ohne Fehler');
}

// ---- determinism: same seed, same orders → the same state and the same bot decisions ----
{
  const play = () => {
    const sim = mk({ seed: 7 }), bots = ['knappe', 'ritter', 'kriegsherr', 'ritter'].map((s, i) => Bots.create(sim, i, { strength: s, seed: 7 + i }));
    run(sim, bots, 300 * TICKS);
    return { state: JSON.stringify(sim.state), stats: JSON.stringify(bots.map(b => b.stats)) };
  };
  const a = play(), b = play();
  ok(a.state === b.state, 'gleicher Seed: identischer Zustand nach 300 s');
  ok(a.stats === b.stats, 'gleicher Seed: identische Entscheidungen (Statistik)');
  console.log('  Determinismus: zwei Läufe über 300 s, Zustands-Hash ' + hashStr(a.state) + ' · Entscheidungs-Hash ' + hashStr(a.stats));
}

// ---- pacts: answer offers, never offer, never break ----
{
  const lords = [{ i: 0, site: 0 }, { i: 1, site: 1 }, { i: 2, site: 3 }];
  const state = (sim, a, b) => sim.youOf(a).pacts.find(p => p.with === b).state;
  // (a) a weaker house asks a bot: declined
  let sim = mk({ seed: 4, lords }), bots = [null, Bots.create(sim, 1, { strength: 'ritter', seed: 4 }), Bots.create(sim, 2, { strength: 'ritter', seed: 5 })];
  run(sim, bots, 5 * TICKS);
  sim.dev.spawn(1, 'speer', sim.dev.lord(1).gx, sim.dev.lord(1).gy + 6, 1);   // the bot's house has one soldier more
  sim.pact(0, 1, true); let log = run(sim, bots, 2 * TICKS);
  eq(state(sim, 0, 1), 'none', 'Pakt: der schwächere Anfragende wird abgelehnt'); ok(ofType(log, 'pactOff').some(e => e.reason === 'declined'), 'Pakt: pactOff { declined }'); eq(ofType(log, 'pactOn').length, 0, 'Pakt: kein pactOn bei Ablehnung');
  // (b) a stronger house asks: accepted
  for (let k = 0; k < 4; k++) sim.dev.spawn(0, 'speer', sim.dev.lord(0).gx + k, sim.dev.lord(0).gy + 6, 1);
  sim.pact(0, 1, true); log = run(sim, bots, 2 * TICKS);
  eq(state(sim, 0, 1), 'active', 'Pakt: das stärkere Haus wird angenommen'); ok(ofType(log, 'pactOn').length === 1, 'Pakt: pactOn');
  // (c) while somebody else is at its throat a bot accepts from a weaker house: the keep of bot 2 has enemy soldiers of house 1 in front of it
  const g2 = sim.dev.lord(2);
  for (let k = 0; k < 3; k++) sim.dev.spawn(1, 'speer', g2.gx + k, g2.gy + g2.out * 8, 1);
  run(sim, bots, 2 * TICKS);
  sim.dev.spawn(2, 'speer', g2.gx, g2.gy + g2.out * 4, 1); sim.dev.spawn(2, 'speer', g2.gx + 1, g2.gy + g2.out * 4, 1); sim.dev.spawn(2, 'speer', g2.gx + 2, g2.gy + g2.out * 4, 1); sim.dev.spawn(2, 'speer', g2.gx + 3, g2.gy + g2.out * 4, 1);   // bot 2 itself is the stronger one
  sim.pact(0, 2, true); log = run(sim, bots, 2 * TICKS);
  eq(state(sim, 0, 2), 'active', 'Pakt: wer von einem Dritten bedrängt wird, nimmt auch vom Schwächeren an');
  // (d) a pact is respected: no campaign against the partner while it holds
  const tr = [], s4 = mk({ seed: 6, lords }), pb = [null, Bots.create(s4, 1, { strength: 'kriegsherr', seed: 6, trace: tr }), Bots.create(s4, 2, { strength: 'kriegsherr', seed: 7 })];
  run(s4, pb, 100 * TICKS); for (let k = 0; k < 8; k++) s4.dev.spawn(0, 'speer', s4.dev.lord(0).gx + k * 0.5, s4.dev.lord(0).gy + 6, 1);
  s4.pact(0, 1, true); run(s4, pb, 3 * TICKS);
  const on = state(s4, 0, 1) === 'active'; const t1 = s4.state.t;
  run(s4, pb, 150 * TICKS);
  ok(on, 'Pakt (Achtung): angenommen'); ok(!tr.some(x => x[1] === 'launch' && x[4] === 0 && x[0] >= t1 && x[0] <= t1 + 150), 'Pakt (Achtung): in 150 s Pakt kein Angriff auf den Partner');
  console.log('  Pakte: Anfrage des Schwächeren abgelehnt, des Stärkeren und bei Bedrängnis durch Dritte angenommen, der Partner wird nicht angegriffen');
}

// ---- F2: pacts end peacefully — a bot renews a pact it is happy with (the judgement of accepting, and no plan against the partner), and none it is not ----
{
  const lords = [0, 1, 2, 3].map(i => ({ i, site: i }));
  const entry = (sim, a, b) => sim.youOf(a).pacts.find(p => p.with === b);
  const ticks = (s) => Math.round(s * TICKS);
  const runTo = (sim, bots, pred, max) => { const log = []; for (let i = 0; i < max && sim.state.phase !== 'over' && !pred(); i++) { for (const b of bots) if (b) b.step(); for (const e of sim.step()) log.push(e); } return log; };
  // house 0 is the human (14 soldiers) and asks bot 1 (ritter) for a pact: accepted, the human being the stronger one. The scene runs up to 5 s before the renewal window opens;
  // `crown` = a house that is given 80 Ruhm then (a ritter aims at the crown), `weaken` = the human's army is killed and bot 1 gets six soldiers more (it is no longer pleased)
  const scene = (crown, weaken) => {
    const sim = mk({ seed: 1, lords, burgfrieden: 0 }), st = sim.state, bots = [null, 1, 2, 3].map(i => i && Bots.create(sim, i, { strength: 'ritter', seed: 5 + i }));
    run(sim, bots, 5 * TICKS);
    for (let k = 0; k < 14; k++) sim.dev.spawn(0, 'speer', -60 + k * 0.5, -30, 1);
    run(sim, bots, 2 * TICKS); sim.pact(0, 1, true); run(sim, bots, 3 * TICKS);
    const U = entry(sim, 0, 1).until; ok(entry(sim, 0, 1).state === 'active' && U > 0, 'Verlängern: der Pakt steht (Bot 1 nimmt den Stärkeren an)');
    runTo(sim, bots, () => U - st.t <= C.RENEW_S + 5, ticks(400));
    if (crown != null) st.lords[crown].ruhm += 80;
    if (weaken) { for (const u of st.units.slice()) if (u.lord === 0 && u.kind !== 'bauer') sim.dev.kill(u); for (let k = 0; k < 6; k++) sim.dev.spawn(1, 'speer', sim.dev.lord(1).gx + k * 0.5, sim.dev.lord(1).gy + 6, 1); }
    return { sim, st, bots, U };
  };
  // (a) pleased (the partner is stronger) and no plan against it: no offer before the window, one within a think (1 s) after it opened; the human's answer renews
  { const { sim, st, bots, U } = scene(null, false);
    const lg = runTo(sim, bots, () => U - st.t <= C.RENEW_S + 1e-9, ticks(10)); eq(ofType(lg, 'pactRenewOffer').length, 0, 'Verlängern: vor dem Fenster kein Angebot des Bots'); const tOpen = st.t;
    const lg2 = runTo(sim, bots, () => entry(sim, 0, 1).renew === 'incoming', ticks(5)); const ro = ofType(lg2, 'pactRenewOffer');
    eq(ro.length, 1, 'Verlängern: der Bot bietet genau einmal an'); eq(ro[0].from + '>' + ro[0].to, '1>0', 'von Bot 1 an Haus 0'); ok(st.t - tOpen <= 1.1, 'höchstens eine Sekunde nach dem Öffnen des Fensters (' + (st.t - tOpen).toFixed(2) + ' s)'); eq(bots[1].stats.renews, 1, 'stats.renews = 1');
    eq(entry(sim, 0, 1).renew, 'incoming', 'der Mensch sieht „incoming“'); eq(ofType(runTo(sim, bots, () => false, ticks(10)), 'pactRenewOffer').length, 0, 'und das Angebot wird nicht wiederholt'); eq(bots[1].stats.renews, 1, 'stats.renews bleibt 1');
    ok(bots[1].info().banners.every(b => !b || b.house !== 0 || (b.mode !== 'march' && b.mode !== 'siege')), 'der Bot plant nichts gegen den Partner');
    eq(sim.pact(0, 1, true).renew, 'renewed', 'der Mensch verlängert'); const on = ofType(run(sim, bots, 2), 'pactOn'); eq(on.length, 1, 'pactOn'); eq(on[0].a, 1, 'a = der Bot (hat zuerst angeboten)'); ok(Math.abs(on[0].until - (U + C.PACT_S)) < 1e-6, 'das Ende rückt um PACT_S');
    runTo(sim, bots, () => st.t > U + 3, ticks(100)); eq(entry(sim, 0, 1).state, 'active', 'der Pakt gilt über das alte Ende hinaus'); eq(bots.slice(1).reduce((n, b) => n + b.stats.errors, 0), 0, 'keine Bot-Fehler'); }
  // (b) the human asks first (before any think of the bot): the bot answers, the end moves
  { const { sim, st, bots, U } = scene(null, false); runTo(sim, bots, () => U - st.t <= C.RENEW_S + 1e-9, ticks(10));
    eq(sim.pact(0, 1, true).renew, 'offered', 'der Mensch bietet das Verlängern zuerst an'); const lg = runTo(sim, bots, () => entry(sim, 0, 1).until > U + 1, ticks(5));
    const on = ofType(lg, 'pactOn'); eq(on.length, 1, 'der Bot antwortet: pactOn'); eq(on[0].a, 0, 'a = der Mensch'); ok(Math.abs(on[0].until - (U + C.PACT_S)) < 1e-6, 'das Ende rückt um PACT_S'); eq(ofType(lg, 'pactRenewOffer').filter(e => e.from === 1).length, 0, 'der Bot braucht kein eigenes Angebot'); eq(bots[1].stats.renews, 1, 'stats.renews = 1'); }
  // (c) a partner the bot would attack next — the crown holder, which a ritter aims at — is not renewed: the pact runs out in peace (with the grace)
  { const { sim, st, bots, U } = scene(0, false); const lg = runTo(sim, bots, () => U - st.t <= 0.5, ticks(70));
    ok(st.lords[0].crown, 'der Partner trägt die Krone'); eq(ofType(lg, 'pactRenewOffer').length, 0, 'Verlängern: kein Angebot an den Kronenträger'); eq(bots[1].stats.renews, 0, 'stats.renews 0'); eq(entry(sim, 0, 1).renew, null, 'kein renew');
    const off = ofType(runTo(sim, bots, () => entry(sim, 0, 1).state === 'none', ticks(5)), 'pactOff'); eq(off.length, 1, 'der Pakt läuft aus'); eq(off[0].reason, 'expired', 'expired'); ok(off[0].grace > st.t, 'mit Waffenruhe (grace)'); }
  // (d) not pleased any more (the partner lost its army, nobody else threatens the bot): no renewal either
  { const { sim, st, bots, U } = scene(null, true); const lg = runTo(sim, bots, () => U - st.t <= 0.5, ticks(70));
    ok(st.lords[0].soldiers < st.lords[1].soldiers, 'der Partner ist jetzt schwächer (' + st.lords[0].soldiers + ' gegen ' + st.lords[1].soldiers + ' Soldaten)'); eq(ofType(lg, 'pactRenewOffer').length, 0, 'Verlängern: kein Angebot an einen Schwächeren'); eq(bots[1].stats.renews, 0, 'stats.renews 0'); }
  console.log('  Verlängern: der Bot bietet in der letzten Minute an (stärkerer Partner, kein Angriffsplan), antwortet auf das Angebot des Menschen, verlängert nicht für den Kronenträger und nicht für einen Schwächeren');
}

// ---- takeover: a bot created in the middle of a match continues the house it is given ----
{
  const strengths = ['ritter', 'kriegsherr', 'ritter', 'knappe'];
  // (a) a fresh bot replaces the running one at 300 s
  let sim = mk({ seed: 8 }), bots = strengths.map((s, i) => Bots.create(sim, i, { strength: s, seed: 8 + i }));
  run(sim, bots, 300 * TICKS);
  const before = sim.state.buildings.filter(b => b.lord === 2 && b.kind !== 'bergfried' && !b.ruined).length;
  bots[2] = Bots.create(sim, 2, { strength: 'kriegsherr', seed: 99 });
  run(sim, bots, 300 * TICKS);
  const after = sim.state.buildings.filter(b => b.lord === 2 && b.kind !== 'bergfried' && !b.ruined).length;
  ok(bots.every(b => b.stats.errors === 0), 'Übernahme (neuer Bot): keine Fehler');
  ok(bots[2].stats.thinks > 250 && (bots[2].stats.builds + bots[2].stats.recruits + bots[2].stats.rebuilds) > 0 && (after > 0 || sim.state.lords[2].people > 0), 'Übernahme (neuer Bot): das Haus wird weitergeführt (Gebäude ' + before + ' → ' + after + ', ' + bots[2].stats.builds + ' Bauten, ' + bots[2].stats.recruits + ' Aushebungen)');   // (a house the neighbours overran at the very end may stand empty for a moment: it counts that the bot acts on it)
  // (b) a house run by a (scripted) human for 240 s, then taken over
  sim = mk({ seed: 9 }); bots = [Bots.create(sim, 0, { strength: 'knappe', seed: 1 }), Bots.create(sim, 1, { strength: 'knappe', seed: 2 }), null, Bots.create(sim, 3, { strength: 'knappe', seed: 3 })];   // peaceful neighbours: the human's house is still standing at 240 s
  const PLAN = ['hof', 'holzfaeller', 'steinbruch', 'hof', 'huette', 'hof'], site2 = sim.state.lords.find(l => l.i === 2).site; let next = 0;
  run(sim, bots, 240 * TICKS, (i) => { if (i % (12 * TICKS) === 0 && next < PLAN.length) { const s = W.suggest(sim.world, PLAN[next], site2, { L: sim.state.level, occ: sim.occ }); if (s && sim.build(2, PLAN[next], s.i, s.j, s.rot).ok) next++; } });
  const own = () => sim.state.buildings.filter(b => b.lord === 2 && b.kind !== 'bergfried' && !b.ruined).length, n0 = own();
  bots[2] = Bots.create(sim, 2, { strength: 'ritter', seed: 5 });
  run(sim, bots, 240 * TICKS);
  ok(bots.every(b => b.stats.errors === 0), 'Übernahme (Menschen-Haus): keine Fehler');
  ok(own() >= n0 + 4 && bots[2].stats.builds + bots[2].stats.rebuilds >= 4, 'Übernahme (Menschen-Haus): der Bot baut weiter (Gebäude ' + n0 + ' → ' + own() + ', ' + bots[2].stats.builds + ' Bauten + ' + bots[2].stats.rebuilds + ' Wiederaufbauten)');
  // (c) taken over while its banners are away: the bot adopts them instead of dropping them
  sim = mk({ seed: 10 }); bots = strengths.map((s, i) => Bots.create(sim, i, { strength: s, seed: 10 + i }));
  run(sim, bots, 420 * TICKS);
  const away = sim.youOf(1).banners.filter(b => b.n > 0 && Math.hypot(b.tx - sim.dev.lord(1).gx, b.ty - sim.dev.lord(1).gy) > 25).length;
  bots[1] = Bots.create(sim, 1, { strength: 'kriegsherr', seed: 77 });
  run(sim, bots, 15 * TICKS);
  const modes = bots[1].info().banners.slice(1).map(s => s.mode);
  run(sim, bots, 120 * TICKS);
  ok(bots.every(b => b.stats.errors === 0) && modes.every(m => ['home', 'march', 'siege', 'retreat'].includes(m)), 'Übernahme (Banner unterwegs): keine Fehler, Banner-Zustände gültig (' + away + ' Banner waren unterwegs: ' + modes.join('/') + ')');
  console.log('  Übernahme: neuer Bot für ein laufendes Haus, für ein Menschen-Haus nach 240 s und für ein Haus mit Bannern im Feld');
}

// ---- Belagerung (Phase 2): ein Haus, dessen Bergfried ein Ring aus Mauern umschließt: der Bot nimmt eine Ramme mit (Stein), bricht Holz mit Nahkämpfern, Bogenschützen allein gehen nie gegen eine Mauer ----
{
  // attacker = lord 0 (bot, site 0), defender = lord 1 (site 3, no bot) with a closed ring of `kind` pieces around its keep; the attacker gets a Kaserne, huts, peasants, stock and a banner of `army`
  function siege(kind, o) {
    const seed = 1, world = W.make(seed), sim = Sim.create({ seed, world, dauer: 12, burgfrieden: 0, lords: [{ i: 0, site: 0 }, { i: 1, site: 3 }] }), D = sim.dev;
    const k1 = world.sites[3].keep, i0 = k1.i - 4, i1 = k1.i + 9, j0 = k1.j - 4, j1 = k1.j + 9;
    let pieces = 0;
    const put = (i, j, rot, len) => { if (D.place(1, kind, i, j, rot, len).ok) pieces++; };
    for (let i = i0; i <= i1; i += 4) { put(i, j0, 0, Math.min(4, i1 - i + 1)); put(i, j1, 0, Math.min(4, i1 - i + 1)); }
    for (let j = j0 + 1; j <= j1 - 1; j += 4) { put(i0, j, 1, Math.min(4, j1 - j)); put(i1, j, 1, Math.min(4, j1 - j)); }
    const blk = new Uint8Array(sim.occ), F = W.field(world, [W.keepGate(world, 0)], 0, null, blk);   // every building blocks: is the defender's gate reachable?
    const sealed = !(F[W.keepGate(world, 3)] < Infinity);
    const g0 = D.lord(0), kas = W.suggest(world, 'kaserne', 0, { L: 0, occ: sim.occ }); if (!o.noKaserne) D.place(0, 'kaserne', kas.i, kas.j, kas.rot);   // (without a Kaserne no melee soldier can join the banner)
    D.stock(0, { korn: 80, holz: 80, stein: 20, gold: o.gold });
    for (let k = 0; k < 8; k++) { const h = W.suggest(world, 'huette', 0, { L: 0, occ: sim.occ }); if (h) D.place(0, 'huette', h.i, h.j, h.rot); }
    for (let k = 0; k < 45; k++) D.spawn(0, 'bauer', g0.gx + (k % 5) - 2, g0.gy + g0.out * 3, -1);
    for (let k = 0; k < 12; k++) D.spawn(0, o.army(k), g0.gx + (k % 6) - 3, g0.gy + g0.out * (7 + Math.floor(k / 6)), 1);
    const bot = Bots.create(sim, 0, { strength: 'kriegsherr', seed: 5 }), ev = { ram: [], breach: [], blows: 0 }, st = sim.state;
    for (let i = 0; i < o.secs * TICKS && st.phase !== 'over'; i++) {
      bot.step();
      for (const e of sim.step()) {
        if (e.t === 'recruit' && e.lord === 0 && e.unit === 'ramme') ev.ram.push(e.n);
        else if (e.t === 'breach' && e.lord === 1) ev.breach.push(e.kind);
        else if (e.t === 'ram') ev.blows++;
      }
    }
    return { sealed, pieces, bot, ev, sim };
  }
  const mixed = (k) => (k % 3 === 0 ? 'bogen' : 'speer');
  // (a) a stone ring: the bot orders a ram for the banner that goes, marches with it and breaks the wall
  const a = siege('mauer', { gold: 12, secs: 600, army: mixed });
  ok(a.sealed && a.pieces >= 12, 'Belagerung: der Mauerring ist geschlossen (' + a.pieces + ' Stücke, ohne Bruch ist das Tor nicht erreichbar)');
  ok(a.ev.ram.length >= 1 && a.ev.ram[0] >= 1, 'Belagerung (Mauer): der Bot bildet eine Ramme für ein Banner aus (' + a.ev.ram.length + ' Rammen, Banner ' + a.ev.ram.join('/') + ')');
  ok(a.ev.breach.includes('mauer') && a.ev.blows > 0, 'Belagerung (Mauer): die Mauer wird gebrochen (' + a.ev.breach.filter(x => x === 'mauer').length + ' Brüche, ' + a.ev.blows + ' Rammschläge)');
  ok(a.bot.stats.errors === 0 && a.bot.stats.sieges >= 1, 'Belagerung (Mauer): keine Fehler, ein Angriff durch Mauern gezählt (' + a.bot.stats.sieges + ')');
  // (b) a wooden ring: melee soldiers are enough, no ram is ordered
  const b = siege('palisade', { gold: 12, secs: 400, army: mixed });
  ok(b.sealed, 'Belagerung (Palisade): der Ring ist geschlossen');
  ok(b.ev.ram.length === 0 && b.ev.breach.includes('palisade'), 'Belagerung (Palisade): ohne Ramme, die Palisade fällt durch Nahkämpfer (' + b.ev.breach.filter(x => x === 'palisade').length + ' Brüche)');
  // (c) stone and no gold: no ram can be had, and the banner stays at home instead of marching into the wall
  const c0 = siege('mauer', { gold: 0, secs: 300, army: mixed });
  ok(c0.ev.ram.length === 0 && c0.bot.stats.attacks === 0 && c0.bot.stats.errors === 0, 'Belagerung (Stein, ohne Gold): keine Ramme, kein Angriff gegen die Mauer (' + c0.bot.stats.attacks + ' Angriffe)');
  // (d) archers alone never go against a wall, not even a wooden one (their arrows scratch a palisade at 15 %)
  const d = siege('palisade', { gold: 12, secs: 300, army: () => 'bogen', noKaserne: true });
  ok(d.bot.stats.attacks === 0 && d.ev.ram.length === 0 && d.ev.breach.length === 0 && d.bot.stats.errors === 0, 'Belagerung: ein reines Bogenschützen-Banner marschiert nicht gegen die Palisade (' + d.bot.stats.attacks + ' Angriffe)');
  console.log('  Belagerung: Mauerring (Ramme ' + a.ev.ram.length + ', ' + a.ev.breach.filter(x => x === 'mauer').length + ' Brüche), Palisadenring (' + b.ev.breach.filter(x => x === 'palisade').length + ' Brüche, keine Ramme), ohne Gold bleibt das Banner daheim, Bogenschützen allein gehen nicht');
}

// ---- takeover with walls, Markt, camp and gold: a house run by a (scripted) human, taken over by a bot ----
{
  const seed = 2, world = W.make(seed), sim = Sim.create({ seed, world, dauer: 12, burgfrieden: 0, lords: [{ i: 0, site: 0 }, { i: 1, site: 3 }] }), D = sim.dev, st = sim.state;
  const put = (kind) => { const sp = W.suggest(world, kind, 0, { L: 0, occ: sim.occ }); const r = sp ? D.place(0, kind, sp.i, sp.j, sp.rot) : null; return r && r.ok ? r.b : null; };
  for (let k = 0; k < 3; k++) put('hof'); put('holzfaeller'); put('steinbruch'); put('huette'); put('kaserne'); put('markt'); put('soeldnerlager'); put('wachturm');
  // a short palisade line south of the keep (the first row that takes it), pieces of 3 cells side by side
  const wall = [], kp = world.sites[0].keep;
  for (let dj = 9; dj <= 18 && wall.length < 4; dj++) for (let k = 0; k < 4; k++) { const r = D.place(0, 'palisade', kp.i - 6 + k * 3, kp.j + dj, 0, 3); if (r.ok) wall.push(r.b); else if (wall.length) break; }
  D.stock(0, { korn: 100, holz: 90, stein: 30, gold: 6 });
  const bot1 = Bots.create(sim, 1, { strength: 'ritter', seed: 3 });
  run(sim, [bot1], 200 * TICKS);   // the human's house runs by itself while the other one has a bot
  ok(wall.length >= 2, 'Übernahme: die Mauer des Menschen steht (' + wall.length + ' Stücke)');
  const lost = wall[0]; D.damage(lost, 1e9, 1);   // a wall piece falls just before the takeover
  const count = (kind) => st.buildings.filter(b => b.lord === 0 && b.kind === kind && !b.ruined).length;
  const before = { markt: count('markt'), lager: count('soeldnerlager') };
  const bot0 = Bots.create(sim, 0, { strength: 'kriegsherr', seed: 9 });
  const log = run(sim, [bot0, bot1], 240 * TICKS);
  ok(bot0.stats.errors === 0 && bot1.stats.errors === 0, 'Übernahme (Mauern, Markt, Lager, Gold): keine Fehler');
  ok(count('markt') === before.markt && count('soeldnerlager') === before.lager, 'Übernahme: der Bot baut keinen zweiten Markt und kein zweites Söldnerlager (' + count('markt') + ' / ' + count('soeldnerlager') + ')');
  ok(ofType(log, 'trade').some(e => e.lord === 0), 'Übernahme: der Bot handelt auf dem vorhandenen Markt (' + ofType(log, 'trade').filter(e => e.lord === 0).length + ' Geschäfte)');
  ok(ofType(log, 'rebuild').some(e => e.id === lost.id) || !lost.ruined, 'Übernahme: das gefallene Mauerstück wird wieder aufgebaut');
  console.log('  Übernahme mit Mauern: vorhandenen Markt und Lager weitergenutzt (kein Doppelbau), Geschäfte, das gefallene Stück wieder aufgebaut');
}

// ---- Futterversuch (Phase 1b): was ernährt ein Hof, und halten 8 Höfe 16 Leute, während Baustellen und Rekruten warten? (ohne Bots) ----
{
  const GW = W.GW, GH = W.GH;
  const gateOf = (world, site) => ({ x: world.sites[site].x + 0.5, y: world.sites[site].y + (site < 2 ? 3.5 : -3.5) });
  // every legal Hof spot of a quarter at level 0 with its Aue share and the distance of its door to the keep gate
  function hofSpots(world, site, occ) {
    const out = [], g = gateOf(world, site);
    for (let rot = 0; rot < 2; rot++) {
      const fp = W.footprintOf('hof', rot);
      for (let j = 0; j + fp[1] <= GH; j++) for (let i = 0; i + fp[0] <= GW; i++) {
        if (!W.canPlace(world, 'hof', i, j, rot, { lord: site, L: 0, occ }).ok) continue;
        let a = 0; for (let dj = 0; dj < fp[1]; dj++) for (let di = 0; di < fp[0]; di++) if (world.cls[(j + dj) * GW + i + di] === W.CI.A) a++;
        const ci = rot ? i - 1 : i + (fp[0] >> 1), cj = rot ? j + (fp[1] >> 1) : j + fp[1];
        out.push({ i, j, rot, aue: a / (fp[0] * fp[1]), door: { x: ci - 71.5, y: cj - 44.5 }, gap: Math.hypot(ci - 71.5 - g.x, cj - 44.5 - g.y) });
      }
    }
    return out;
  }
  // sacks per minute one lone Hof delivers once it runs steadily (minutes 4–10); the stock is held up so that hunger never slows the farmer
  function hofRate(seed, site, spot, granary) {
    const world = W.make(seed), sim = Sim.create({ seed, world, dauer: 30, burgfrieden: 0, lords: [{ i: 0, site }] });
    for (let k = 0; k < 26 * 15; k++) sim.step();   // the ebb: Aue is dry at level 0
    const h = sim.dev.place(0, 'hof', spot.i, spot.j, spot.rot);
    if (!h.ok) return null;
    if (granary) {   // a Kornspeicher right next to the field's door
      let best = null, bd = 1e9;
      for (let j = 0; j + 3 <= GH; j++) for (let i = 0; i + 3 <= GW; i++) {
        const d = Math.hypot(i + 1 - 71.5 + 0.5 - spot.door.x, j + 3 - 44.5 - spot.door.y);
        if (d < bd && d > 1.5 && W.canPlace(world, 'kornspeicher', i, j, 0, { lord: site, L: 0, occ: sim.occ }).ok) { bd = d; best = { i, j }; }
      }
      if (!best || !sim.dev.place(0, 'kornspeicher', best.i, best.j, 0).ok) return null;
    }
    const per = []; let m = 0;
    for (let k = 0; k < 10 * 60 * 15; k++) {
      if (k % 15 === 0) sim.dev.stock(0, { korn: 12 });
      for (const e of sim.step()) if (e.t === 'deliver' && e.res === 'korn') m += e.n;
      if ((k + 1) % 900 === 0) { per.push(m); m = 0; }
    }
    const steady = per.slice(3); return steady.reduce((a, b) => a + b, 0) / steady.length;
  }
  const rows = { near: [], aue: [], aueKs: [] };
  for (const seed of [1, 2, 3, 4]) {
    const world = W.make(seed);
    for (let site = 0; site < 4; site++) {
      const probe = Sim.create({ seed, world, dauer: 30, burgfrieden: 0, lords: [{ i: 0, site }] }), sp = hofSpots(world, site, probe.occ);
      const pick = (f) => sp.filter(f).sort((a, b) => a.gap - b.gap)[0];
      const near = pick(x => x.aue === 0 && x.gap >= 4), aue = pick(x => x.aue >= 0.999 && x.gap >= 4);
      if (near) rows.near.push({ rate: hofRate(seed, site, near), gap: near.gap });
      if (aue) { rows.aue.push({ rate: hofRate(seed, site, aue), gap: aue.gap }); rows.aueKs.push({ rate: hofRate(seed, site, aue, true), gap: aue.gap }); }
    }
  }
  const stat = (a) => { const v = a.map(r => r.rate).filter(x => x !== null).sort((x, y) => x - y); return { n: v.length, min: v[0], max: v[v.length - 1], mean: avg(v), med: v[v.length >> 1] }; };
  const eatPerMin = 60 / C.EAT_S, sn = stat(rows.near), sa = stat(rows.aue), sk = stat(rows.aueKs);
  const gaps = (a) => { const g = a.map(r => r.gap), lo = Math.min(...g).toFixed(0), hi = Math.max(...g).toFixed(0); return lo === hi ? lo : lo + '–' + hi; };
  console.log('\n  Futterversuch Hof (1 Hof allein, Vorrat gehalten, Gleichgewicht Minute 4–10, 4 Seeds × 4 Burgen; ein Mensch isst ' + eatPerMin.toFixed(2) + ' Sack je Minute, EAT_S ' + C.EAT_S + ', KORN_N ' + C.KORN_N + '):');
  for (const [name, a, g] of [['Hof am Bergfried, ohne Aue (Tür ' + gaps(rows.near) + ' vom Tor)', sn], ['Hof auf voller Aue (Tür ' + gaps(rows.aue) + ' vom Tor)', sa], ['dasselbe mit einem Kornspeicher an der Tür', sk]].map((x, i) => [x[0], x[1]]))
    console.log('    ' + name.padEnd(54) + 'Ø ' + a.mean.toFixed(1) + ' Säcke/Min (' + a.min.toFixed(1) + ' – ' + a.max.toFixed(1) + ', Median ' + a.med.toFixed(1) + ') → ernährt ' + (a.mean / eatPerMin).toFixed(1) + ' Leute (mindestens ' + (a.min / eatPerMin).toFixed(1) + ')');
  ok(sn.n >= 12 && sa.n >= 12, 'Futterversuch: genug Messpunkte (' + sn.n + ' / ' + sa.n + ')');
  ok(sn.min / eatPerMin >= 5.5, '1 Hof am Bergfried ernährt mindestens 5 Leute (' + (sn.min / eatPerMin).toFixed(1) + ')'); ok(sa.min / eatPerMin >= 4.9, '1 Hof auf Aue ernährt mindestens 5 Leute (' + (sa.min / eatPerMin).toFixed(1) + ')'); ok(sk.mean > sa.mean, 'ein Kornspeicher an der Tür bringt mehr (' + sk.mean.toFixed(1) + ' > ' + sa.mean.toFixed(1) + ')');
  // 8 Höfe, 2 Hütten (16 Leute), ein Holzfäller, ein Steinbruch; dauernd offene Baustellen (und eine Rekrutenschlange): keine Hungersnot.
  // R11: ein Hof, dessen 🌾-Lager voll ist, ruht (sein Bauer ist frei, Rekruten und Baustellen dürfen ihn nehmen): leere Hofplätze zählen nur bei Höfen mit Platz im Lager;
  // `keep` macht die Rekrutenschlange zu der eines vernünftigen Spielers: sie macht nie aus den Bauern, die die Felder bestellen, Soldaten (Bauern > 8 Höfe + keep)
  function scene(o) {
    const seed = o.seed || 3, world = W.make(seed), sim = Sim.create({ seed, world, dauer: 30, burgfrieden: 180, lords: [{ i: 0, site: 0 }] });
    const put = (kind) => { const sp = W.suggest(world, kind, 0, { L: sim.state.level, occ: sim.occ }); if (!sp) return null; const r = sim.dev.place(0, kind, sp.i, sp.j, sp.rot); return r.ok ? r.b : null; };
    for (let k = 0; k < (o.huts || 2); k++) put('huette'); put('holzfaeller'); put('steinbruch'); for (let k = 0; k < 8; k++) put('hof'); if (o.recruits) put('kaserne');
    let hungry = 0, empty = 0, n = 0, wait = 0;
    for (let k = 0; k < o.mins * 60 * 15; k++) {
      if (k % 15 === 0) {
        sim.dev.stock(0, { holz: 25, stein: 20 });   // (unter der Kappe: R11 schickt sonst Holzfäller und Steinmetz heim)
        const open = sim.state.buildings.filter(b => b.lord === 0 && b.build < 1 && !b.ruined).length;
        for (let q = open; q < o.sites; q++) { const sp = W.suggest(world, 'lager', 0, { L: sim.state.level, occ: sim.occ }); if (sp) sim.build(0, 'lager', sp.i, sp.j, sp.rot); }
        const y = sim.youOf(0); if (o.recruits && y.queue.length < 2 && y.stock.korn >= 8 && (!o.keep || y.pop - sim.state.lords[0].soldiers > 8 + o.keep)) sim.recruit(0, 'speer', 1);
        if (k >= 120 * 15) { empty += sim.state.buildings.filter(b => b.kind === 'hof' && b.workers === 0 && !b.full).length; wait += sim.state.buildings.filter(b => b.lord === 0 && b.build < 1 && !b.ruined && !b._.builder).length; n++; }
      }
      for (const e of sim.step()) if (e.t === 'buildDone') { const b = sim.state.buildings.find(x => x.id === e.id); if (b && b.kind === 'lager') sim.cancel(0, b.id); }
      if (k >= 120 * 15 && sim.state.lords[0].hunger) hungry += 1 / 15;
    }
    return { hungry, empty: empty / n, wait: wait / n, y: sim.youOf(0) };
  }
  const a8 = scene({ sites: 6, recruits: false, mins: 8 }), b8 = scene({ huts: 4, sites: 3, recruits: true, keep: 5, mins: 8 });
  console.log('    8 Höfe, 2 Hütten (' + a8.y.pop + ' Leute), Holzfäller und Steinbruch, 6 Baustellen laufend offen (Ø ' + a8.wait.toFixed(1) + ' ohne Baumeister): Hunger nach 2 Min ' + a8.hungry.toFixed(0) + ' s, leere Hofplätze Ø ' + a8.empty.toFixed(2) + ', Ernte ' + a8.y.food.prod + ' / Verbrauch ' + a8.y.food.eat + ' je Minute');
  console.log('    4 Hütten (24 Leute), Rekrutenschlange (nie unter 8 Höfe + 5 Bauern) und 3 Baustellen (Ø ' + b8.wait.toFixed(1) + ' warten): Hunger nach 2 Min ' + b8.hungry.toFixed(0) + ' s, leere Hofplätze Ø ' + b8.empty.toFixed(2) + ', ' + b8.y.pop + ' Leute (' + b8.y.pop + ' ≥ 13)');
  ok(a8.hungry <= 3 && b8.hungry <= 3, '8 Höfe ernähren 13–16 Leute, auch wenn Baustellen und Rekruten warten (Hunger ' + a8.hungry.toFixed(0) + ' s / ' + b8.hungry.toFixed(0) + ' s)');
  ok(a8.empty < 0.7 && b8.empty < 1.5 && b8.y.pop >= 13, 'die Bauern bleiben auf den Feldern (leere Hofplätze Ø ' + a8.empty.toFixed(2) + ' / ' + b8.empty.toFixed(2) + ')');
}
console.log('  (Vorbereitende Prüfungen: ' + secs().toFixed(1) + ' s)');

// ---- full matches in worker threads ----
function pool(jobs, size, done, budget) {   // jobs flagged `optional` are skipped once the clock is past `budget` seconds
  const out = new Array(jobs.length); let next = 0, running = 0, finished = 0;
  const launch = () => {
    while (running < size && next < jobs.length) {
      const k = next++;
      if (jobs[k].optional && secs() > budget) { out[k] = { skipped: true, seed: jobs[k].seed }; finished++; if (finished === jobs.length && !running) return done(out); continue; }
      running++;
      const w = new Worker(__filename, { workerData: jobs[k] });
      let got = false;
      const end = (r) => { if (got) return; got = true; out[k] = r; running--; finished++; if (finished === jobs.length) done(out); else launch(); };
      w.once('message', (r) => end(r)); w.once('error', (e) => end({ error: String(e && e.stack || e).split('\n').slice(0, 3).join(' | '), seed: jobs[k].seed }));
      w.once('exit', () => end({ error: 'Worker ohne Ergebnis beendet', seed: jobs[k].seed }));
    }
  };
  if (!jobs.length) return done(out);
  launch();
}

const jobs = [];   // [{ group, ...job }]
const add = (group, job) => jobs.push(Object.assign({ group, tune: TUNE }, job));
for (const s of STRENGTHS) for (let seed = 1; seed <= SEEDS; seed++) add('full-' + s, { seed, strengths: [s, s, s, s] });
for (let seat = 0; seat < 4; seat++) for (let seed = 1; seed <= MIXSEEDS; seed++) { const s = ['knappe', 'knappe', 'knappe', 'knappe']; s[seat] = 'kriegsherr'; add('mixed', { seed, strengths: s, seat, optional: seed > 2 }); }   // two seeds per seat are a must, the rest comes while there is time
for (let seed = SEEDS + 1; seed <= SEEDS + EXTRA; seed++) add('full-ritter', { seed, strengths: ['ritter', 'ritter', 'ritter', 'ritter'], optional: true });
const SIZE = Math.max(1, Math.min(+process.env.FF_JOBS || os.cpus().length, 10));
console.log('\n  Ganze Spiele: ' + jobs.length + ' × 12 Min (' + STRENGTHS.map(s => SEEDS + ' × 4 ' + s).join(', ') + (EXTRA ? ', +' + EXTRA + ' × 4 ritter' : '') + ', ' + 4 * MIXSEEDS + ' × 1 Kriegsherr gegen 3 Knappe) auf ' + SIZE + ' Workern');
const t0 = secs();

const BUDGET = 170;   // seconds: optional games are not started after this (slow machines run fewer games and say so)
pool(jobs, SIZE, (raw) => {
  const wall = secs() - t0;
  jobs.forEach((j, k) => { raw[k].group = j.group; raw[k].seat = j.seat; });
  const skipped = raw.filter(r => r.skipped).length, res = raw.filter(r => !r.skipped);
  if (skipped) console.log('  (' + skipped + ' optionale Spiele übersprungen: Zeitbudget ' + BUDGET + ' s)');
  const failed = res.filter(r => r.error);
  ok(failed.length === 0, 'alle Spiele laufen fehlerfrei durch' + (failed.length ? ' (' + failed.map(f => 'seed ' + f.seed + ': ' + f.error).join('; ') + ')' : ''));
  const good = res.filter(r => !r.error);
  ok(good.every(r => r.over && r.ranking && r.ranking.length === r.strengths.length), 'jedes Spiel endet mit Rangliste');
  const errs = good.reduce((n, r) => n + r.bots.reduce((a, b) => a + b.errors, 0), 0);
  ok(errs === 0, 'Bots: keine internen Fehler (' + errs + ')' + (errs ? ' z. B. ' + good.map(r => r.bots.map(b => b.lastError).find(Boolean)).find(Boolean) : ''));
  ok(good.every(r => !r.ev.pactOffer && !r.ev.pactOn && !r.ev.pactOff), 'Bots bieten keine Pakte an und brechen keine');

  // ---- per strength: the minimums of the brief ----
  console.log('\n  Ganze Spiele nach Stärke (4 gleiche Bots; Spitze = größte Zahl auf einmal, ausgebildet = insgesamt):');
  console.log('    Stärke       Bots   ≥ 12 Gebäude   ≥ 15 Soldaten (Spitze)   ≥ 15 ausgebildet   greift an   Ø Spitze   Ø Gebäude   Ø ausgebildet');
  const sum = {};
  for (const s of STRENGTHS) {
    const rs = good.filter(r => r.group === 'full-' + s && (s !== 'ritter' || r.seed <= SEEDS)), cells = [];
    rs.forEach(r => r.strengths.forEach((_, k) => cells.push({ b: r.peakB[k], s: r.peakSold[k], tr: r.trained[k], at: r.bots[k].attacks })));
    sum[s] = { n: cells.length, b12: cells.filter(c => c.b >= 12).length, s15: cells.filter(c => c.s >= 15).length, t15: cells.filter(c => c.tr >= 15).length, at: cells.filter(c => c.at >= 1).length };
    console.log('    ' + s.padEnd(12) + String(cells.length).padStart(5) + String(sum[s].b12).padStart(12) + String(sum[s].s15).padStart(18) + String(sum[s].t15).padStart(21) + String(sum[s].at).padStart(14) + avg(cells.map(c => c.s)).toFixed(1).padStart(12) + avg(cells.map(c => c.b)).toFixed(1).padStart(11) + avg(cells.map(c => c.tr)).toFixed(1).padStart(15));
  }
  const all = STRENGTHS.reduce((a, s) => ({ n: a.n + sum[s].n, b12: a.b12 + sum[s].b12, s15: a.s15 + sum[s].s15, t15: a.t15 + sum[s].t15 }), { n: 0, b12: 0, s15: 0, t15: 0 });
  const att = ['ritter', 'kriegsherr'].reduce((a, s) => ({ n: a.n + sum[s].n, at: a.at + sum[s].at }), { n: 0, at: 0 });
  if (!QUICK) {
    ok(all.b12 === all.n, 'jeder Bot kommt auf ≥ 12 fertige Gebäude (' + all.b12 + ' von ' + all.n + ')');
    // (Phase 2: E2 had to loosen this to 0.90 while the bots had no Söldnerlager and so no torch squad; since E4 the bots have both, and it is 0.97 again)
    ok(att.at >= att.n * 0.97, 'Ritter und Kriegsherren greifen mindestens einmal an (' + att.at + ' von ' + att.n + ')');
    ok(all.t15 >= all.n * 0.9, 'fast jeder Bot bildet ≥ 15 Soldaten aus (' + all.t15 + ' von ' + all.n + ')');
    ok(all.s15 >= all.n * 0.7, 'die meisten Bots haben irgendwann ≥ 15 Soldaten (' + all.s15 + ' von ' + all.n + ' = ' + pct(all.s15, all.n) + ')');
  }
  goal(all.s15 === all.n, 'jeder Bot hat irgendwann ≥ 15 Soldaten (' + all.s15 + ' von ' + all.n + ')');
  goal(att.at === att.n, 'jeder Ritter und Kriegsherr greift an (' + att.at + ' von ' + att.n + ')');

  // ---- Phase 2: Markt, Söldnerlager, Mauern, Gold, Rammen (4 gleiche Bots; die Ritter-Tabelle zählt hier alle 20 Ritter-Spiele) ----
  {
    const cells = (s) => good.filter(r => r.group === 'full-' + s).flatMap(r => r.strengths.map((_, k) => ({ r, k })));
    const sums = (cs, f) => cs.reduce((a, x) => a + f(x.r, x.k), 0);
    console.log('\n  Phase 2 (je Stärke, 4 gleiche Bots): Bots mit Markt / Söldnerlager / Torhaus · Ø Mauerstücke · Ø Handel (verkauft + gekauft 💰) · Reiterschützen · Rammen · Garnison · Brüche');
    console.log('    Stärke       Bots   Markt   Lager   Torhaus   Mauerstücke   💰 verkauft   💰 gekauft   Handel    Reiter   Rammen (Schläge)   Besetzt   Brüche je Spiel');
    for (const st of STRENGTHS) {
      const cs = cells(st), g = good.filter(r => r.group === 'full-' + st);
      console.log('    ' + st.padEnd(12) + String(cs.length).padStart(4) + String(cs.filter(x => x.r.kinds[x.k].markt !== undefined).length).padStart(8) + String(cs.filter(x => x.r.kinds[x.k].soeldnerlager !== undefined).length).padStart(8)
        + String(cs.filter(x => x.r.kinds[x.k].torhaus !== undefined).length).padStart(10) + (sums(cs, (r, k) => r.wallsBuilt[k]) / cs.length).toFixed(1).padStart(14) + (sums(cs, (r, k) => r.goldSold[k]) / cs.length).toFixed(1).padStart(14)
        + (sums(cs, (r, k) => r.goldBought[k]) / cs.length).toFixed(1).padStart(13) + (sums(cs, (r, k) => r.tradeN[k]) / cs.length).toFixed(1).padStart(9) + (sums(cs, (r, k) => r.riders[k]) / cs.length).toFixed(1).padStart(9)
        + (sums(cs, (r, k) => r.ramsRecruited[k]) + ' (' + g.reduce((a, r) => a + r.ramBlows, 0) + ')').padStart(18) + (sums(cs, (r, k) => r.garrisoned[k]) / cs.length).toFixed(1).padStart(10) + (g.reduce((a, r) => a + Object.values(r.breachByKind).reduce((x, y) => x + y, 0), 0) / (g.length || 1)).toFixed(1).padStart(14));
    }
    const merc = cells('ritter').filter(x => x.r.seed <= SEEDS || true).concat(cells('kriegsherr'));
    const withM = merc.filter(x => x.r.kinds[x.k].markt !== undefined).length, withC = merc.filter(x => x.r.kinds[x.k].soeldnerlager !== undefined).length;
    const tM = merc.filter(x => x.r.kinds[x.k].markt !== undefined).map(x => x.r.kinds[x.k].markt), tC = merc.filter(x => x.r.kinds[x.k].soeldnerlager !== undefined).map(x => x.r.kinds[x.k].soeldnerlager);
    console.log('    Ritter und Kriegsherren: Markt fertig bei ' + withM + ' von ' + merc.length + ' (Median ' + med(tM).toFixed(0) + ' s), Söldnerlager bei ' + withC + ' von ' + merc.length + ' (Median ' + med(tC).toFixed(0) + ' s)');
    if (!QUICK) {
      ok(withM >= merc.length * 0.9, 'Ritter und Kriegsherren bauen einen Markt (' + withM + ' von ' + merc.length + ' Häusern, ≥ 90 %)');
      ok(withC >= merc.length * 0.9, 'Ritter und Kriegsherren bauen ein Söldnerlager (' + withC + ' von ' + merc.length + ' Häusern, ≥ 90 %)');
    }
    const knM = cells('knappe');
    console.log('    Knappen: Markt bei ' + knM.filter(x => x.r.kinds[x.k].markt !== undefined).length + ' von ' + knM.length + ', Söldnerlager bei ' + knM.filter(x => x.r.kinds[x.k].soeldnerlager !== undefined).length + ' (keines: der Knappe baut kein Lager und keine Mauern)');
    ok(knM.every(x => x.r.kinds[x.k].soeldnerlager === undefined && x.r.wallsBuilt[x.k] === 0), 'der Knappe baut weder Söldnerlager noch Mauern');
    // stranding: nobody may sit idle next to empty workplaces for a minute (a wall line must never cut peasants off)
    const strand = good.flatMap(r => r.strandMax);
    console.log('    Stranden: längste Zeit mit ≥ 3 Untätigen bei freien Arbeitsplätzen Maximum ' + Math.max(...strand) + ' s, über 60 s: ' + strand.filter(x => x > 60).length + ' von ' + strand.length + ' Häusern');
    ok(strand.every(x => x <= 60), 'kein Haus hat ≥ 3 untätige Bauern bei freien Arbeitsplätzen länger als 60 s am Stück (Maximum ' + Math.max(...strand) + ' s)');
    // the walls themselves: reported as goals
    const wallers = merc.filter(x => x.r.wallsBuilt[x.k] > 0).length;
    goal(wallers >= merc.length * 0.9, 'Ritter und Kriegsherren bauen Mauerstücke (' + wallers + ' von ' + merc.length + ' Häusern)');
    goal(merc.filter(x => x.r.torBuilt[x.k] > 0).length >= merc.length * 0.7, 'die meisten Ritter und Kriegsherren bauen ein Torhaus (' + merc.filter(x => x.r.torBuilt[x.k] > 0).length + ' von ' + merc.length + ')');
    const allBreach = good.reduce((a, r) => a + Object.values(r.breachByKind).reduce((x, y) => x + y, 0), 0), allRams = good.reduce((a, r) => a + r.ramsRecruited.reduce((x, y) => x + y, 0), 0);
    console.log('    Brüche insgesamt ' + allBreach + ' (' + JSON.stringify(good.reduce((o, r) => { for (const k in r.breachByKind) o[k] = (o[k] || 0) + r.breachByKind[k]; return o; }, {})) + '), Rammen ausgebildet ' + allRams + ', Rammschläge ' + good.reduce((a, r) => a + r.ramBlows, 0));
    goal(allBreach > 0, 'in den ganzen Spielen fällt mindestens ein Mauerstück oder Tor (' + allBreach + ' Brüche)');
    goal(allRams > 0, 'in den ganzen Spielen wird mindestens eine Ramme ausgebildet (' + allRams + ')');
    goal(good.reduce((a, r) => a + r.goldSold.reduce((x, y) => x + y, 0), 0) > 0, 'der Markt wird benutzt (verkauft ' + good.reduce((a, r) => a + r.goldSold.reduce((x, y) => x + y, 0), 0) + ' 💰 in allen Spielen)');
  }

  // ---- balance table: 4 ritter bots ----
  const rit = good.filter(r => r.group === 'full-ritter');
  const wins = [0, 0, 0, 0], rankRuhm = [[], [], [], []], ratios = [], fights = [], hmax = [], hruns = [], plun = [];
  for (const r of rit) {
    wins[r.ranking[0].site]++;
    r.ranking.forEach((x, i) => rankRuhm[i].push(x.ruhm));
    ratios.push(r.ranking[r.ranking.length - 1].ruhm > 0 ? r.ranking[0].ruhm / r.ranking[r.ranking.length - 1].ruhm : 99);
    fights.push(r.fight >= 0 ? r.fight - r.fehdeT : 999); plun.push(r.plunders);
    r.hungerMax.forEach(h => hruns.push(h)); hmax.push(Math.max(...r.hungerMax));
  }
  // the kriegsherr table (4 kriegsherr bots) and the torch timing of both tables
  const kri = good.filter(r => r.group === 'full-kriegsherr'), hrunsK = [], hmaxK = [];
  for (const r of kri) { r.hungerMax.forEach(h => hrunsK.push(h)); hmaxK.push(Math.max(...r.hungerMax)); }
  const torch = (rs) => rs.filter(r => r.firstIgnite >= 0).map(r => r.firstIgnite - r.fehdeT);
  const torchR = torch(rit), torchK = torch(kri), RA = Bots.RAID_AFTER_S;
  const stepSim = avg(good.map(r => r.simMs / r.steps)), stepBots = avg(good.map(r => r.botMs / r.steps));
  console.log('\n  Balance-Tabelle: ' + rit.length + ' Spiele mit 4 Ritter-Bots, 12 Min, Seeds 1–' + (SEEDS + EXTRA));
  console.log('    Sieger je Burg   ' + SITE.map((s, i) => s + ' ' + wins[i] + ' (' + pct(wins[i], rit.length) + ')').join(' · '));
  console.log('    Ø Ruhm je Platz  ' + rankRuhm.map((a, i) => (i + 1) + '. ' + avg(a).toFixed(0)).join(' · '));
  console.log('    Sieger / Letzter Ø ' + avg(ratios).toFixed(2) + '×, Median ' + med(ratios).toFixed(2) + '×, Maximum ' + Math.max(...ratios).toFixed(1) + '×, über 4×: ' + ratios.filter(x => x > 4).length + ' von ' + rit.length + ' Spielen');
  console.log('    Plünderungen     ' + plun.reduce((a, b) => a + b, 0) + ' insgesamt (' + (plun.reduce((a, b) => a + b, 0) / rit.length).toFixed(2) + ' je Spiel), in ' + plun.filter(x => x > 0).length + ' von ' + rit.length + ' Spielen');
  console.log('    Fehde → 1. Kampf Median ' + med(fights).toFixed(0) + ' s, Maximum ' + Math.max(...fights).toFixed(0) + ' s, innerhalb von 60 s: ' + fights.filter(x => x <= 60).length + ' von ' + rit.length);
  console.log('    Längster Hunger  Maximum ' + Math.max(...hruns) + ' s, Median je Spiel ' + med(hmax) + ' s, Häuser über 60 s am Stück: ' + hruns.filter(x => x > 60).length + ' von ' + hruns.length + '   (Kriegsherr-Tabelle, ' + kri.length + ' Spiele: Maximum ' + Math.max(...hrunsK) + ' s, über 60 s: ' + hrunsK.filter(x => x > 60).length + ' von ' + hrunsK.length + ')');
  const torchTxt = (t, ra) => t.length ? 'Median ' + med(t).toFixed(0) + ' s nach der Fehde (frühestens ' + Math.min(...t).toFixed(0) + ' s, RAID_AFTER_S ' + ra + ' s)' : 'keiner (RAID_AFTER_S ' + ra + ' s)';
  console.log('    Erster Fackelbrand  Ritter ' + torchTxt(torchR, RA.ritter) + ' · Kriegsherr ' + torchTxt(torchK, RA.kriegsherr));
  console.log('    Schrittzeit      Sim Ø ' + stepSim.toFixed(3) + ' ms + 4 Bots Ø ' + stepBots.toFixed(3) + ' ms je Schritt (' + (1000 * stepBots / 4).toFixed(0) + ' µs je Bot)');
  const evAvg = {}; rit.forEach(r => { for (const k in r.ev) evAvg[k] = (evAvg[k] || 0) + r.ev[k] / rit.length; });
  console.log('    je Spiel         ' + ['attack', 'death', 'ignite', 'cropBurnt', 'ruined', 'trained', 'hunger'].map(k => k + ' ' + (evAvg[k] || 0).toFixed(0)).join(', '));
  console.log('\n  Ziele des Dokuments (4 Ritter-Bots, 12 Min):');
  goal(wins.every(w => w / rit.length >= 0.10 && w / rit.length <= 0.40), 'jede Burg gewinnt 10–40 % der Spiele (' + wins.map(w => pct(w, rit.length)).join(' / ') + ')');
  goal(ratios.every(x => x <= 4), 'der Sieger hat höchstens das 4-fache Ruhm des Letzten (Ø ' + avg(ratios).toFixed(2) + '×, Maximum ' + Math.max(...ratios).toFixed(1) + '×, ' + ratios.filter(x => x > 4).length + ' Spiele darüber)');
  goal(plun.filter(x => x > 0).length >= rit.length / 2, 'in mindestens der Hälfte der Spiele eine Plünderung (' + plun.filter(x => x > 0).length + ' von ' + rit.length + ')');
  goal(fights.every(x => x <= 60), 'der erste Kampf kommt höchstens 60 s nach der Fehde (Maximum ' + Math.max(...fights).toFixed(0) + ' s; seit Phase 1b gilt RAID_AFTER_S: der erste Kampf ist die erste Fackel nach ' + RA.ritter + ' s)');
  goal(fights.every(x => x <= RA.ritter + 30), 'der erste Kampf kommt höchstens RAID_AFTER_S + 30 s nach der Fehde (' + (RA.ritter + 30) + ' s; Maximum ' + Math.max(...fights).toFixed(0) + ' s)');
  goal(hruns.every(x => x <= 60), 'kein Haus hungert länger als 60 s am Stück (Maximum ' + Math.max(...hruns) + ' s, ' + hruns.filter(x => x > 60).length + ' Häuser darüber)');
  // hard (Phase 1b): the user's dead end and starving farms must never come back, and the first torch must not come too early
  ok(rit.length > 0 && kri.length > 0, 'Ritter- und Kriegsherr-Tabelle sind nicht leer (' + rit.length + ' / ' + kri.length + ' Spiele)');
  ok(hruns.every(x => x <= 60), 'Ritter-Tabelle: kein Haus hungert länger als 60 s am Stück (Maximum ' + Math.max(...hruns) + ' s, ' + hruns.filter(x => x > 60).length + ' von ' + hruns.length + ' Häusern darüber)');
  ok(hrunsK.every(x => x <= 60), 'Kriegsherr-Tabelle: kein Haus hungert länger als 60 s am Stück (Maximum ' + Math.max(...hrunsK) + ' s, ' + hrunsK.filter(x => x > 60).length + ' von ' + hrunsK.length + ' Häusern darüber)');
  // Phase 2: the torch raids are back (the fackel is trained at the Söldnerlager for 💰): fires in most matches of the ritter table and of the kriegsherr table
  const raidsR = rit.filter(r => r.firstIgnite >= 0).length, raidsK = kri.filter(r => r.firstIgnite >= 0).length;
  console.log('    Fackelzüge       Ritter-Tabelle: Brand in ' + raidsR + ' von ' + rit.length + ' Spielen · Kriegsherr-Tabelle: in ' + raidsK + ' von ' + kri.length);
  if (!QUICK) ok(raidsR >= rit.length * 0.8 && raidsK >= kri.length * 0.8, 'die Fackelzüge sind zurück: Brand in ' + raidsR + ' von ' + rit.length + ' Ritter- und ' + raidsK + ' von ' + kri.length + ' Kriegsherr-Spielen (≥ 80 %)');
  ok(torchR.every(x => x >= RA.ritter - 1), 'kein Fackelzug der Ritter vor RAID_AFTER_S = ' + RA.ritter + ' s nach der Fehde (frühester Brand ' + Math.min(...torchR).toFixed(0) + ' s)');
  ok(torchK.every(x => x >= RA.kriegsherr - 1), 'kein Fackelzug der Kriegsherren vor RAID_AFTER_S = ' + RA.kriegsherr + ' s nach der Fehde (frühester Brand ' + Math.min(...torchK).toFixed(0) + ' s)');
  ok(good.every(r => !r.ev.pause), 'Bots lassen nie einen Betrieb ruhen (kein pause-Ereignis)');
  goal(stepSim < 2, 'Sim-Schritt Ø < 2 ms (' + stepSim.toFixed(3) + ' ms)');
  ok(stepSim < 2, 'Sim-Schritt Ø < 2 ms mit Bots (' + stepSim.toFixed(3) + ')');
  ok(stepBots < 2, '4 Bots zusammen Ø < 2 ms je Schritt (' + stepBots.toFixed(3) + ')');

  // ---- mixed: 1 kriegsherr against 3 knappe ----
  const mix = good.filter(r => r.group === 'mixed');
  const mwins = mix.filter(r => r.ranking[0].k === r.seat).length;
  const kr = { n: 0, ruhm: 0, razes: 0, kills: 0, people: 0, peak: 0 }, kn = { n: 0, ruhm: 0, razes: 0, kills: 0, people: 0, peak: 0 };
  mix.forEach(r => r.ranking.forEach(x => { const a = x.k === r.seat ? kr : kn; a.n++; a.ruhm += x.ruhm; a.razes += x.by.buildings; a.kills += x.by.kills; a.people += x.people; a.peak += r.peakSold[x.k]; }));
  console.log('\n  Mischspiele: 1 Kriegsherr gegen 3 Knappe, ' + mix.length + ' Spiele (Kriegsherr auf jeder Burg × ' + MIXSEEDS + ' Seeds)');
  console.log('    Kriegsherr gewinnt ' + mwins + ' von ' + mix.length + ' (' + pct(mwins, mix.length) + ')  · Ø Ruhm Kriegsherr ' + (kr.ruhm / kr.n).toFixed(0) + ' (Zerstörungen ' + (kr.razes / kr.n).toFixed(0) + ', Kills ' + (kr.kills / kr.n).toFixed(0) + ', Spitze ' + (kr.peak / kr.n).toFixed(0) + ' Soldaten) · je Knappe ' + (kn.ruhm / kn.n).toFixed(0) + ' (Zerstörungen ' + (kn.razes / kn.n).toFixed(0) + ', Kills ' + (kn.kills / kn.n).toFixed(0) + ', Spitze ' + (kn.peak / kn.n).toFixed(0) + ')');
  if (!QUICK) ok(mwins >= mix.length * 0.7, 'der Kriegsherr gewinnt ≥ 70 % gegen 3 Knappe (' + mwins + ' von ' + mix.length + ')');
  console.log('    Zum Vergleich (Notizen): Phase 1b Burgen 30/10/35/25 %, Sieger/Letzter Ø 1.52×, längster Hunger 25 s, Kriegsherr gegen 3 Knappe 85 %; Phase 2 mit den alten Bots Burgen 35/10/45/10 %, Ø 1.43×, Kriegsherr 75 %, 1 Plünderung, 1. Kampf Median 228 s');

  const total = secs();
  console.log('\n  Laufzeit: ' + total.toFixed(1) + ' s gesamt (' + res.length + ' ganze Spiele gespielt in ' + wall.toFixed(1) + ' s auf ' + SIZE + ' Workern, ' + (res.length * 720 / wall).toFixed(0) + ' Spielsekunden je Sekunde)');
  ok(total <= 300, 'das ganze Skript braucht ≤ 5 Min (' + total.toFixed(0) + ' s)');
  console.log(process.exitCode ? '\nFEHLER aufgetreten' : '\nOK: ' + checks + ' Prüfungen bestanden' + (misses ? ' · ' + misses + ' Ziele des Dokuments nicht erreicht (siehe oben)' : ' · alle Ziele des Dokuments erreicht'));
}, BUDGET);
