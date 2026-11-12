// Rule tests for Autoball: the simulation (sim.js) — pitch, driving, ball, goals, match flow, bots.
// No DOM, no three.js.
const Sim = require('./public/games/autoball/sim.js');
const C = Sim.CONST;

let checks = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function eq(a, b, msg) { checks++; if (a !== b) fail(msg + ' (expected ' + b + ', got ' + a + ')'); }

const DT = 1 / 60;
// two players by default: 1 plays for team 0 (attacks +x), 2 for team 1
const mk = (cars, o) => Sim.create(Object.assign({ cars: cars || [{ id: 1, team: 0 }, { id: 2, team: 1 }], seed: 7, minutes: 3 }, o));
function run(sim, sec, each) {
  const log = [];
  for (let t = 0; t < sec - 1e-9; t += DT) { if (each) each(sim); log.push(...sim.step(DT)); }
  return log;
}
function until(sim, cond, each, max) {
  const log = [];
  for (let t = 0; t < (max || 30) && !cond(sim); t += DT) { if (each) each(sim); log.push(...sim.step(DT)); }
  ok(cond(sim), 'until: reached in time');
  return log;
}
const toPlay = (sim) => until(sim, (s) => s.state.phase === 'play');
// put a car somewhere, standing still, out of everybody's way by default
function park(sim, id, x, z, heading) { const c = sim.car(id); c.x = x; c.z = z; c.heading = heading || 0; c.speed = c.vx = c.vz = 0; c.ix = c.iz = 0; c.boost = false; return c; }
function ballAt(sim, x, z, vx, vz, y, vy) { const b = sim.state.ball; b.x = x; b.z = z; b.vx = vx || 0; b.vz = vz || 0; b.y = y || 0; b.vy = vy || 0; b.ax = x; b.az = z; b.since = sim.state.time; return b; }
const inside = (o, rad) => Math.abs(o.x) <= C.L + C.GOAL_DEPTH - rad + 1e-6 && Math.abs(o.z) <= C.WD - rad + 1e-6
  && (Math.abs(o.x) <= C.L - rad + 1e-6 || Math.abs(o.z) <= C.GOAL_HALF + 1e-6);

// ---- the pitch ----
{
  const rng = Sim.mulberry32(3);
  let escaped = 0, corner = 0;
  for (let i = 0; i < 4000; i++) {
    const o = { x: (rng() - 0.5) * 140, z: (rng() - 0.5) * 90, vx: (rng() - 0.5) * 60, vz: (rng() - 0.5) * 60 };
    const start = Math.abs(o.x) > C.L || Math.abs(o.z) > C.WD;
    Sim.confine(o, 1.5, 0.5, false);
    if (!inside(o, 1.5) || Math.abs(o.x) > C.L - 1.5 + 1e-6) escaped++;
    if (start && Math.abs(o.x) > C.L - C.CORNER && Math.abs(o.z) > C.WD - C.CORNER
      && Math.hypot(Math.abs(o.x) - (C.L - C.CORNER), Math.abs(o.z) - (C.WD - C.CORNER)) > C.CORNER - 1.5 + 1e-6) corner++;
  }
  eq(escaped, 0, 'with the goals shut, nothing gets past the boards');
  eq(corner, 0, 'the corners are round');
  const low = { x: C.L + 2, z: 0, vx: 10, vz: 0 }, high = { x: C.L + 2, z: 0, vx: 10, vz: 0 };
  Sim.confine(low, 1.6, 0.5, true); Sim.confine(high, 1.6, 0.5, false);
  ok(low.x === C.L + 2 && low.vx === 10, 'an open goal lets things in');
  ok(high.x === C.L - 1.6 && high.vx < 0, 'a shut one is a wall');
  const deep = { x: C.L + 9, z: 12, vx: 20, vz: 20 };
  Sim.confine(deep, 1.6, 0.5, true);
  ok(deep.x === C.L + C.GOAL_DEPTH - 1.6 && deep.z === C.GOAL_HALF - 1.6 && deep.vx < 0 && deep.vz < 0, 'the goal box has a back and sides');
}

// ---- kickoff ----
{
  const sim = mk([{ id: 1, team: 0 }, { id: 2, team: 1 }, { id: 3, team: 0 }, { id: 4, team: 1 }]);
  const st = sim.state;
  eq(st.phase, 'kickoff', 'a match starts with a kickoff');
  ok(sim.team(0).every(c => c.x < 0) && sim.team(1).every(c => c.x > 0), 'each team stands in its own half');
  ok(st.cars.every(c => Math.cos(c.heading) * -c.x + Math.sin(c.heading) * -c.z > 0), 'everybody faces the ball');
  ok(Math.abs(sim.car(1).x + sim.car(2).x) < 1e-9 && Math.abs(sim.car(3).z + sim.car(4).z) < 1e-9, 'the line-ups mirror each other');
  const x0 = sim.car(1).x;
  const log = run(sim, 2.9, (s) => s.input(1, 1, 0, true));
  eq(log.filter(e => e.t === 'count').map(e => e.n).join(','), '3,2,1', 'the countdown counts 3, 2, 1');
  ok(sim.car(1).x === x0 && st.ball.x === 0 && st.clock === 180000, 'nothing moves and the clock waits');
  ok(run(sim, 0.2).some(e => e.t === 'go') && st.phase === 'play', 'then the ball is free');
}

// ---- driving with the stick ----
{
  const sim = mk();
  toPlay(sim);
  park(sim, 2, 30, 20); sim.state.ball.live = false;         // alone on the pitch
  const c = park(sim, 1, -20, 0, Math.PI / 2);                // facing "down" the TV
  run(sim, 1.5, (s) => s.input(1, 1, 0, false));
  ok(Math.abs(c.heading) < 0.05 && c.x > -10 && c.speed > C.MAX_SPEED * 0.95 && c.speed <= C.MAX_SPEED + 1e-6, 'stick right: the car turns right and drives at full speed');
  run(sim, 0.7, (s) => s.input(1, 0, 0, false));
  ok(Math.abs(c.speed) < 0.5, 'stick released: the car stops');
  const x1 = c.x;
  run(sim, 1.6, (s) => s.input(1, -1, 0, false));
  ok(Math.abs(Math.abs(c.heading) - Math.PI) < 0.1 && c.x < x1, 'stick left: it turns round and drives back');
  park(sim, 1, 0, 0, 0);
  run(sim, 1, (s) => s.input(1, 0.5, 0, false));
  ok(Math.abs(c.speed - C.MAX_SPEED * 0.5) < 0.6, 'half stick, half speed');
  sim.input(1, 30, 40, false);
  ok(Math.abs(Math.hypot(c.ix, c.iz) - 1) < 1e-9, 'the stick is clamped to 1');
  sim.input(1, 'x', null, 0);
  ok(c.ix === 0 && c.iz === 0 && c.boost === false, 'nonsense from a phone is no input');

  // boost
  park(sim, 1, -30, 0, 0); c.tank = 1;
  run(sim, 1, (s) => s.input(1, 1, 0, true));
  ok(c.speed > C.MAX_SPEED * 1.4 && c.boosting && c.tank < 0.5, 'boost: faster, and the tank drains (' + c.tank.toFixed(2) + ')');
  park(sim, 1, -30, 0, 0); c.tank = 0;
  run(sim, 0.5, (s) => s.input(1, 1, 0, true));
  ok(!c.boosting && c.speed <= C.MAX_SPEED + 1e-6, 'empty tank: no boost');
  park(sim, 1, -30, 0, 0);
  run(sim, 4, (s) => s.input(1, 0, 0, false));
  ok(c.tank > 0.45 && c.tank < 0.6, 'the tank refills slowly by itself (' + c.tank.toFixed(2) + ')');
  park(sim, 1, -30, 10, 0); c.tank = 0;
  run(sim, 0.4, (s) => s.input(1, 0, 0, true));
  ok(c.x > -30, 'boost without the stick drives straight on');

  // boost pads
  const pad = sim.state.pads[0];
  park(sim, 1, pad.x, pad.z, 0); c.tank = 0.2;
  const log = run(sim, DT);
  ok(log.some(e => e.t === 'pad' && e.id === 1) && c.tank === 1 && pad.readyAt > sim.state.time, 'a boost pad fills the tank and is used up');
  c.tank = 0.2; run(sim, DT);
  ok(c.tank < 0.3, 'a used pad gives nothing');
  pad.readyAt = sim.state.time; run(sim, DT);
  eq(c.tank, 1, 'it comes back');

  // boards
  park(sim, 1, C.L - 6, -15, 0);
  run(sim, 2, (s) => s.input(1, 1, 0, true));
  ok(c.x <= C.L - C.CAR_R + 1e-6 && Math.abs(c.z + 15) < 1, 'a car cannot drive through the boards');
  park(sim, 1, C.L - 6, 0, 0);
  run(sim, 2, (s) => s.input(1, 1, 0, false));
  ok(c.x > C.L && c.x <= C.L + C.GOAL_DEPTH - C.CAR_R + 1e-6, 'but it can drive into the goal');
}

// ---- cars bump ----
{
  const sim = mk();
  toPlay(sim); sim.state.ball.live = false;
  park(sim, 1, -10, 0, 0); park(sim, 2, 10, 0, Math.PI);
  const log = run(sim, 1.2, (s) => { s.input(1, 1, 0, false); s.input(2, -1, 0, false); });
  ok(log.some(e => e.t === 'bump'), 'two cars driving at each other bump');
  ok(sim.car(2).x - sim.car(1).x >= C.CAR_R * 2 - 0.05, 'and do not overlap');
}

// ---- the ball ----
{
  const sim = mk();
  toPlay(sim);
  park(sim, 2, 30, 20);
  const c = park(sim, 1, -20, 0, 0), b = ballAt(sim, -8, 0);
  const log = until(sim, (s) => s.state.ball.vx > 5, (s) => s.input(1, 1, 0, false), 3);
  const kick = log.find(e => e.t === 'kick');
  ok(kick && kick.id === 1 && kick.power > 15, 'driving into the ball kicks it');
  ok(b.vx > c.speed && b.vx > C.MAX_SPEED, 'the ball leaves faster than the car (' + b.vx.toFixed(0) + ')');
  ok(c.speed < C.MAX_SPEED * 0.95, 'the car feels the hit');
  ok(b.vy > 5 || b.y > 0, 'a hard hit lifts the ball');
  eq(b.touch.id + ',' + c.touches, '1,1', 'the ball remembers who touched it');
  const far = until(sim, (s) => Math.hypot(s.state.ball.vx, s.state.ball.vz) < 0.5, (s) => s.input(1, 0, 0, false), 60);
  ok(far.some(e => e.t === 'bounce') && Math.abs(b.z) < 3, 'it bounces and rolls out');

  // a ball in the air flies over the car
  toPlay(sim); park(sim, 2, 30, 20);              // (the roll-out may have ended in the goal)
  park(sim, 1, 0, 0, 0); ballAt(sim, 6, 0, -30, 0, 3.5, 8);
  const over = run(sim, 0.35);
  ok(!over.some(e => e.t === 'kick') && sim.state.ball.x < -1, 'a high ball flies over the car');

  // pressed against the boards, the ball stays inside and the car gives way
  park(sim, 1, 0, C.WD - 9, Math.PI / 2); ballAt(sim, 0, C.WD - C.BALL_R - 0.1);
  let worst = 0;
  run(sim, 2, (s) => { s.input(1, 0, 1, true); worst = Math.max(worst, Math.abs(s.state.ball.z)); });
  ok(worst <= C.WD - C.BALL_R + 1e-6 && Math.abs(sim.state.ball.z) <= C.WD - C.BALL_R + 1e-6, 'a car cannot push the ball through the boards');
  const k = sim.car(1), q = sim.state.ball, hx = Math.cos(k.heading), hz = Math.sin(k.heading);
  const along = Math.max(-C.CAR_HALF, Math.min(C.CAR_HALF, (q.x - k.x) * hx + (q.z - k.z) * hz));
  ok(Math.hypot(q.x - k.x - hx * along, q.z - k.z - hz * along) >= C.CAR_W + C.BALL_R - 0.05, 'and the car does not end up inside the ball');
}

// ---- goals ----
{
  const sim = mk([{ id: 1, team: 0 }, { id: 2, team: 1 }, { id: 3, team: 0 }]);
  const st = sim.state;
  toPlay(sim);
  park(sim, 2, -30, 20);
  const near = park(sim, 3, 36, 9);               // stands next to the goal
  const c = park(sim, 1, 20, 0, 0); ballAt(sim, 30, 0);
  let log = until(sim, (s) => s.state.phase === 'goal', (s) => s.input(1, 1, 0, true), 5);
  const g = log.find(e => e.t === 'goal');
  ok(g && g.team === 0 && g.scorer === 1 && g.own === false, 'ball in the +x goal: team 0 scores, the shooter is named');
  eq(st.score.join(':') + ',' + c.goals, '1:0,1', 'the score and the scorer\'s tally go up');
  ok(!st.ball.live, 'the ball is gone');
  ok(Math.hypot(near.vx, near.vz) > 8 && near.vz > 0 && near.vx < 0, 'the blast throws a car standing near the goal away');
  const clock = st.clock;
  log = until(sim, (s) => s.state.phase === 'kickoff', null, 5);
  ok(st.clock === clock, 'the clock stands during the celebration');
  ok(st.ball.live && st.ball.x === 0 && sim.car(1).x < 0 && sim.car(1).speed === 0, 'new kickoff from the centre');
  const t0 = st.time;
  toPlay(sim);
  ok(Math.abs(st.time - t0 - C.COUNT_MS) < 20, 'later countdowns are shorter');

  // own goal: only team 1 touched it
  park(sim, 1, -30, 20); park(sim, 3, -30, -20);
  const d = park(sim, 2, 20, 0, 0); ballAt(sim, 30, 0);
  log = until(sim, (s) => s.state.phase === 'goal', (s) => s.input(2, 1, 0, true), 5);
  const og = log.find(e => e.t === 'goal');
  ok(og.team === 0 && og.own === true && og.scorer === 2 && d.ownGoals === 1 && d.goals === 0, 'the defender puts it in: own goal');
  eq(st.score.join(':'), '2:0', 'it counts for the other team');

  // a shot the defender only deflects belongs to the shooter; a touch long ago does not count any more
  for (const [ago, own, who] of [[1000, false, 1], [6000, true, 2]]) {
    until(sim, (s) => s.state.phase === 'play', null, 8);
    for (const id of [1, 2, 3]) park(sim, id, -30, id * 8 - 16);
    const b = ballAt(sim, C.L - 4, 0, 30, 0);
    b.last[0] = { id: 1, at: st.time - ago }; b.last[1] = { id: 2, at: st.time - 200 };
    until(sim, (s) => s.state.phase === 'goal', null, 2);
    ok(st.lastGoal.own === own && st.lastGoal.scorer === who, 'attacker touched it ' + ago / 1000 + ' s ago, then the defender: ' + (own ? 'own goal' : 'the attacker\'s goal'));
  }

  // crossbar and post
  until(sim, (s) => s.state.phase === 'play', null, 8);
  for (const id of [1, 2, 3]) park(sim, id, -30, id * 8 - 16);
  ballAt(sim, C.L - 6, 0, 40, 0, 3.4, 4);
  log = run(sim, 0.6);
  ok(st.phase === 'play' && st.ball.vx < 0 && log.some(e => e.t === 'bounce'), 'too high: the ball comes back off the crossbar');
  ballAt(sim, C.L - 8, C.GOAL_HALF, 30, 0);
  run(sim, 0.5);
  ok(st.phase === 'play' && st.ball.vx < 0, 'the post is in the way');
  ballAt(sim, C.L - 8, C.GOAL_HALF - 3, 30, 0);
  until(sim, (s) => s.state.phase === 'goal', null, 2);
  const ng = st.lastGoal;
  ok(ng.team === 0 && ng.scorer === null && ng.own === false, 'next to the post it goes in (nobody touched it: no scorer)');
}

// ---- clock, golden goal, the end ----
{
  const sim = mk(null, { minutes: 0.2 });        // 12 seconds
  const st = sim.state;
  toPlay(sim);
  park(sim, 1, -30, 20); park(sim, 2, 30, 20);
  const log = until(sim, (s) => s.state.golden, (s) => { const b = s.state.ball; b.ax = b.x + 9; }, 15);   // (keep the referee away)
  eq(log.filter(e => e.t === 'clock').map(e => e.n).join(','), '10,9,8,7,6,5,4,3,2,1', 'the last ten seconds are counted down');
  ok(log.some(e => e.t === 'golden') && st.phase === 'play' && st.clock === 0, '0 : 0 at the end → golden goal, play goes on');
  ballAt(sim, -C.L + 4, 0, -30, 0);
  let l2 = until(sim, (s) => s.state.phase === 'goal', null, 2);
  ok(l2.some(e => e.t === 'goal' && e.team === 1), 'team 1 scores');
  l2 = until(sim, (s) => s.state.phase === 'over', null, 5);
  ok(l2.some(e => e.t === 'over' && e.winner === 1) && st.winner === 1, 'the golden goal ends the match');
  const x = sim.car(1).x; run(sim, 1, (s) => s.input(1, 1, 0, true));
  eq(sim.car(1).x, x, 'after the end nothing moves');

  const s2 = mk(null, { minutes: 0.2 });
  toPlay(s2); park(s2, 1, -30, 20); park(s2, 2, 30, 20);
  ballAt(s2, C.L - 4, 0, 30, 0);
  until(s2, (s) => s.state.phase === 'kickoff', null, 6);
  const l3 = until(s2, (s) => s.state.phase === 'over', (s) => { const b = s.state.ball; b.ax = b.x + 9; }, 20);
  ok(l3.some(e => e.t === 'over' && e.winner === 0) && !s2.state.golden, 'a lead when the clock runs out wins without extra time');
}

// ---- a wedged ball is dropped in the middle ----
{
  const sim = mk();
  toPlay(sim); park(sim, 1, -30, 20); park(sim, 2, 30, 20);
  const b = ballAt(sim, 30, 24.5);
  const log = until(sim, (s) => s.state.ball.y > 10, null, 12);
  ok(log.some(e => e.t === 'drop') && b.x === 0 && b.z === 0, 'a ball that lies around for 8 s is dropped at the centre');
  until(sim, (s) => s.state.ball.y === 0 && s.state.ball.vy === 0, null, 6);
  ok(Math.abs(b.x) < 0.01, 'and lands there');
}

// ---- bots, leaving, joining ----
{
  const sim = mk([{ id: 1, team: 0 }, { id: 2, team: 1 }, { id: -1, team: 1, bot: true }]);
  toPlay(sim);
  sim.input(-1, 1, 0, true);
  run(sim, 0.5);
  ok(sim.car(-1).bot && Math.hypot(sim.car(-1).ix, sim.car(-1).iz) > 0, 'a bot steers by itself');
  const before = sim.car(-1).x;
  run(sim, 1);
  ok(sim.car(-1).x !== before, 'and drives');
  // a player leaves: a bot takes the car
  park(sim, 1, 20, 0, 0); ballAt(sim, 26, 0);
  until(sim, (s) => s.state.ball.touch && s.state.ball.touch.id === 1, (s) => s.input(1, 1, 0, false), 3);
  const nid = sim.toBot(1);
  ok(nid < -1 && sim.car(1) === null && sim.car(nid).bot && sim.car(nid).team === 0, 'toBot: the car stays, a bot with a new id drives it');
  eq(sim.state.ball.touch.id, nid, 'its last touch goes with it');
  eq(sim.toBot(99), null, 'unknown ids are ignored');
  // a player takes a bot's car
  eq(sim.toHuman(nid, 5), true, 'toHuman: a player takes over a bot car');
  ok(sim.car(5) && !sim.car(5).bot && sim.car(5).ix === 0, 'and it waits for their input');
  eq(sim.toHuman(2, 6), false, 'a human\'s car cannot be taken');
  // a latecomer gets a new car
  const k = sim.add({ id: 7, team: 1 });
  ok(sim.team(1).includes(k) && k.x > 0 && Math.abs(k.x) < C.L, 'add: a new car in front of its own goal');
}
{
  // bots against bots: goals fall, nothing leaves the pitch, the match ends, the same seed plays the same match
  const play = (seed, n) => {
    const cars = [];
    for (let i = 0; i < n; i++) { cars.push({ id: -1 - 2 * i, team: 0, bot: true }); cars.push({ id: -2 - 2 * i, team: 1, bot: true }); }
    const sim = Sim.create({ cars, seed, minutes: 2 });
    let goals = 0, bad = 0, t = 0;
    while (sim.state.phase !== 'over' && t < 500) {
      goals += sim.step(DT).filter(e => e.t === 'goal').length; t += DT;
      const b = sim.state.ball;
      if (!(Math.abs(b.x) <= C.L + C.GOAL_DEPTH && Math.abs(b.z) <= C.WD - C.BALL_R + 1e-6 && b.y >= 0)) bad++;
      for (const c of sim.state.cars) if (!inside(c, C.CAR_R - 0.01)) bad++;
    }
    return { goals, bad, over: sim.state.phase === 'over', score: sim.state.score.join(':'), time: Math.round(sim.state.time) };
  };
  let goals = 0;
  for (const [seed, n] of [[1, 1], [2, 2], [3, 3], [4, 2]]) {
    const r = play(seed, n);
    goals += r.goals;
    ok(r.over, n + 'v' + n + ' bots: the match ends (' + r.score + ')');
    eq(r.bad, 0, n + 'v' + n + ' bots: ball and cars stay on the pitch');
  }
  ok(goals >= 6, 'bots score goals (' + goals + ' in four matches)');
  const a = play(9, 2), b = play(9, 2);
  eq(a.score + '@' + a.time, b.score + '@' + b.time, 'same seed → same match');
}

console.log(process.exitCode ? '❌ Autoball: Regeltests fehlgeschlagen' : '✅ Autoball: ' + checks + ' Checks bestanden');
