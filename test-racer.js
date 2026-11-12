// Rule tests for Micro Racer: simulation (sim.js) and tracks (tracks.js). No DOM, no three.js.
// The heart of it: a car that is out of the picture is out of the heat within OFF_MS, never later.
const Sim = require('./public/games/racer/sim.js');
const Tracks = require('./public/games/racer/tracks.js');
const C = Sim.CONST;

let checks = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function eq(a, b, msg) { checks++; if (a !== b) fail(msg + ' (expected ' + b + ', got ' + a + ')'); }

const DT = 1 / 60;
const OVAL = [[-200, -60], [0, -75], [200, -60], [230, 0], [200, 60], [0, 75], [-200, 60], [-230, 0]];   // long straights, wide bends
const ovalTrack = Sim.buildTrack(OVAL);
// a match on the oval; the ramps, pads and oil are cleared away unless o.furniture (they get in the way of exact checks)
const mk = (ids, o) => {
  const sim = Sim.create(Object.assign({ track: ovalTrack, ids, seed: 7 }, o));
  sim.start();
  if (!(o && o.furniture)) sim.state.features.length = 0;
  return sim;
};

// step for `sec` seconds; each(sim) runs before every step; returns all events
function run(sim, sec, each) {
  const log = [];
  for (let t = 0; t < sec - 1e-9; t += DT) { if (each) each(sim); log.push(...sim.step(DT)); }
  return log;
}
const drive = (ids, opts) => (sim) => { for (const id of ids) { const i = Sim.autoSteer(sim, id, opts && opts[id]); sim.input(id, i.s, i.b); } };
// step until cond(sim) holds (at most 30 s)
function until(sim, cond, each) {
  const log = [];
  for (let t = 0; t < 30 && !cond(sim); t += DT) { if (each) each(sim); log.push(...sim.step(DT)); }
  ok(cond(sim), 'until: reached within 30 s');
  return log;
}
const toRace = (sim) => until(sim, (s) => s.state.phase === 'race');
// throw a car out: hold it far behind `lead` until the picture has dropped it; `others` keep driving
const knock = (sim, id, lead, others) => until(sim, (s) => !R(s, id).alive, (s) => { drive(others)(s); pin(s, id, lead, 60); });
// put a car on the centre line d metres behind (d < 0: ahead of) another one, at the same speed
function pin(sim, id, refId, d) {
  const T = sim.track, a = sim.state.racers[refId], b = sim.state.racers[id];
  const raw = a.idx - Math.round(d / T.segLen), i = ((raw % T.N) + T.N) % T.N, s = T.samples[i];
  b.x = s.x; b.z = s.z; b.idx = i; b.lap = a.lap + Math.floor(raw / T.N); b.progress = b.lap * T.N + i;
  b.heading = Math.atan2(s.tz, s.tx); b.speed = a.speed; b.vx = s.tx * a.speed; b.vz = s.tz * a.speed; b.y = 0; b.vy = 0;
}
const R = (sim, id) => sim.state.racers[id];

// ---- tracks ----
for (const key of Object.keys(Tracks.TRACKS)) {
  const def = Tracks.TRACKS[key], biome = Tracks.BIOMES[def.biome], T = Sim.buildTrack(def.pts);
  ok(biome && biome.deco.length > 0, key + ': has a biome with scenery');
  ok(T.len > 700 && T.len < 1300, key + ': lap length is sensible (' + T.len.toFixed(0) + ' m)');
  ok(Math.abs(T.segLen - 1) < 0.01, key + ': one sample per metre');
  let maxC = 0, gap = 0;
  T.samples.forEach((s, i) => {
    maxC = Math.max(maxC, Math.abs(s.curv));
    const n = T.samples[(i + 1) % T.N];
    gap = Math.max(gap, Math.hypot(n.x - s.x, n.z - s.z));
  });
  ok(1 / maxC >= 6, key + ': no bend tighter than 6 m (tightest ' + (1 / maxC).toFixed(1) + ')');
  ok(gap < 1.1, key + ': the loop is closed without a jump');
  eq(T.samples.some(s => s.cross), !!def.crossing, key + ': crosses itself only if it says so');
  for (let i = 0; i < 25; i++) ok(Math.abs(T.samples[i].curv) < 0.03, key + ': the start is nearly straight (sample ' + i + ')');

  const sim = Sim.create({ track: T, ids: [1, 2, 3, 4], seed: 11, grip: biome.grip, lava: biome.lava });
  sim.start();
  const st = sim.state, n = (k) => st.features.filter(f => f.kind === k).length;
  ok(n('ramp') >= 1 && n('boost') >= 2 && n('oil') >= 1, key + ': ramps, pads and oil are placed');
  eq(st.boxes.length, 9, key + ': three rows of item boxes');
  eq(st.lava.length > 0, !!biome.lava, key + ': lava only where the biome has it');
  for (const l of st.lava) ok(T.dist(l.x, l.z) - l.r >= C.ROAD_W / 2 + 1, key + ': lava keeps a metre of ground between itself and the road');
  for (const f of st.features) ok(!T.samples[f.idx].cross, key + ': nothing is placed on the crossing');
}
{
  const sim = mk([1, 2], { items: false });
  eq(sim.state.boxes.length, 0, 'items off: no boxes');
  const rng = Sim.mulberry32(5), a = Tracks.pick('random', rng), b = Tracks.pick('desert', rng);
  ok(a.key === 'random' && a.pts.length === 10 && a.biome, 'a random track comes with a biome');
  ok(b.pts === Tracks.TRACKS.desert.pts && b.biomeKey === 'desert', 'a named track is the named track');
}

// ---- determinism ----
{
  const snap = () => { const sim = mk([1, 2, 3], { furniture: true }); run(sim, 20, drive([1, 2, 3])); return JSON.stringify(sim.state.racers) + JSON.stringify(sim.state.features); };
  eq(snap(), snap(), 'same seed, same inputs → same race');
  ok(JSON.stringify(mk([1, 2, 3], { furniture: true, seed: 8 }).state.features) !== JSON.stringify(mk([1, 2, 3], { furniture: true }).state.features), 'another seed places things elsewhere');
}

// ---- start ----
{
  const sim = mk([1, 2, 3, 4]);
  eq(sim.state.phase, 'countdown', 'a match starts with the countdown');
  const x0 = R(sim, 1).x;
  const log = run(sim, 3.1, drive([1, 2, 3, 4]));
  eq(log.filter(e => e.t === 'count').map(e => e.n).join(','), '3,2,1', 'the countdown counts 3, 2, 1');
  eq(R(sim, 1).x, x0, 'nobody moves before the start');
  ok(!log.some(e => e.t === 'go'), 'no start before the countdown is over');
  const log2 = run(sim, 0.2);
  ok(log2.some(e => e.t === 'go') && sim.state.phase === 'race', 'then the race is on');
  // the whole grid is in the picture, and nobody can be thrown out in the first moments
  run(sim, 0.1);
  ok([1, 2, 3, 4].every(id => R(sim, id).vis), 'the whole grid is in the picture at the start');
  pin(sim, 4, 1, 80);
  const early = run(sim, (C.START_SAFE_MS - 400) / 1000, (s) => pin(s, 4, 1, 80));
  ok(R(sim, 4).alive && !early.some(e => e.t === 'out'), 'nobody is out right after the start');
}

// ---- the point of it all: out of the picture → out, and quickly ----
{
  // car 2 does nothing, car 1 drives the lap: 2 is gone as soon as the picture has left it
  const sim = mk([1, 2], { items: false });
  toRace(sim);
  let blind = 0, worst = 0, dangerAt = null, outAt = null;
  const log = [];
  for (let t = 0; t < 30 && sim.state.phase === 'race'; t += DT) {
    drive([1])(sim);
    for (const e of sim.step(DT)) {
      log.push(e);
      if (e.t === 'danger' && e.id === 2) dangerAt = sim.state.time;
      if (e.t === 'out') outAt = sim.state.time;
    }
    const r = R(sim, 2);
    blind = (r.alive && !r.vis) ? blind + DT : 0;
    worst = Math.max(worst, blind);
  }
  ok(!R(sim, 2).alive && R(sim, 1).alive, 'the car that stays behind is out');
  ok(outAt !== null && outAt - sim.state.raceAt < 12000, 'and that within seconds (after ' + ((outAt - sim.state.raceAt) / 1000).toFixed(1) + ' s)');
  ok(worst <= C.OFF_MS / 1000 + 2 * DT, 'it never drives blind for longer than the grace (' + worst.toFixed(2) + ' s)');
  ok(dangerAt !== null && Math.abs(outAt - dangerAt - C.OFF_MS) < 40, 'the warning comes exactly one grace period before the end');
  const out = log.find(e => e.t === 'out');
  ok(out.id === 2 && out.why === 'lost', 'the event says who and why');
  eq(sim.state.phase, 'heatOver', 'one car left → the heat is over');
  eq(sim.state.heatWinner, 1, 'the survivor wins the heat');
  eq(sim.state.points[1] + ',' + sim.state.points[2], '1,0', 'points: survivor 1, first out 0');
}
{
  // back in the picture before the grace runs out → stays in
  const sim = mk([1, 2], { items: false });
  toRace(sim); run(sim, 4, drive([1, 2]));
  const a = run(sim, 0.5, (s) => { drive([1])(s); pin(s, 2, 1, 70); });
  ok(a.some(e => e.t === 'danger' && e.id === 2) && R(sim, 2).offMs > 300, 'out of sight starts the clock');
  const b = run(sim, 0.5, (s) => { drive([1])(s); pin(s, 2, 1, 10); });
  ok(b.some(e => e.t === 'safe' && e.id === 2) && R(sim, 2).alive && R(sim, 2).offMs === 0, 'back in sight stops and resets it');
  // far behind on the track never counts as "in the picture", wherever the car happens to be on screen
  const c = run(sim, 1.2, (s) => { drive([1])(s); pin(s, 2, 1, -3); R(s, 2).lap -= 1; R(s, 2).progress -= s.track.N; });
  ok(c.some(e => e.t === 'out' && e.id === 2), 'a lapped car next to the leader is still out');
}
{
  // a dot on the horizon is not "in the picture" either: straight on into the landscape, 300 m ahead
  const sim = mk([1, 2], { items: false });
  toRace(sim); run(sim, 4, drive([1, 2]));
  const far = (s) => { pin(s, 2, 1, 4); const r = R(s, 2), q = s.track.samples[r.idx]; r.x += q.tx * 300; r.z += q.tz * 300; };
  far(sim); sim.step(DT);
  const p = sim.project(R(sim, 2).x, 0.6, R(sim, 2).z);
  ok(p.ok && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.d > C.MAX_VIEW, 'the far car is inside the frame, but far away (' + p.d.toFixed(0) + ' m)');
  const log = run(sim, 1.2, (s) => { drive([1])(s); if (R(s, 2).alive) far(s); });
  ok(log.some(e => e.t === 'out' && e.id === 2), 'and that does not save it');
}
{
  // how far the picture reaches: close behind is safe, far behind is not, on every track
  for (const key of Object.keys(Tracks.TRACKS)) {
    const T = Sim.buildTrack(Tracks.TRACKS[key].pts);
    for (const [d, want] of [[14, true], [20, true], [36, false]]) {
      const sim = Sim.create({ track: T, ids: [1, 2], seed: 3, items: false }); sim.start();
      toRace(sim);
      let seen = 0, n = 0;
      run(sim, 25, (s) => {
        drive([1])(s);
        if (s.state.phase !== 'race') return;
        pin(s, 2, 1, d); R(s, 2).offMs = 0;
        if (s.state.time - s.state.raceAt > 6000) { n++; if (R(s, 2).vis) seen++; }
      });
      ok(want ? seen / n > 0.97 : seen / n < 0.03, key + ': ' + d + ' m behind the leader is ' + (want ? 'in' : 'out of') + ' the picture (' + Math.round(seen / n * 100) + '%)');
    }
  }
}
{
  // four bots of different skill on every track: whoever is alive is visible, or about to be out
  for (const key of Object.keys(Tracks.TRACKS)) {
    const biome = Tracks.BIOMES[Tracks.TRACKS[key].biome];
    const sim = Sim.create({ pts: Tracks.TRACKS[key].pts, ids: [1, 2, 3, 4], seed: 21, grip: biome.grip, lava: biome.lava }); sim.start();
    const skill = { 2: { lane: 1.5 }, 3: { lane: -1.5, gain: 2.2 }, 4: { look: 11, gain: 1.6, brake: false } };
    const blind = {}; let worst = 0, firstOut = null;
    for (let t = 0; t < 90; t += DT) {
      drive([1, 2, 3, 4], skill)(sim);
      if (sim.step(DT).some(e => e.t === 'out') && firstOut === null) firstOut = sim.state.time - sim.state.raceAt;
      for (const id of [1, 2, 3, 4]) {
        const r = R(sim, id);
        blind[id] = (sim.state.phase === 'race' && r.alive && !r.vis && sim.state.time - sim.state.raceAt > C.START_SAFE_MS) ? (blind[id] || 0) + DT : 0;
        worst = Math.max(worst, blind[id]);
      }
    }
    ok(worst <= C.OFF_MS / 1000 + 2 * DT, key + ': no bot ever drives blind for longer than the grace (' + worst.toFixed(2) + ' s)');
    ok(firstOut === null || firstOut > 5000, key + ': drivers who stay on the road are not thrown out at once (first out after ' + (firstOut / 1000).toFixed(1) + ' s)');
  }
}

// ---- brake: both buttons ----
{
  const sim = mk([1, 2], { items: false });
  toRace(sim); run(sim, 4, drive([1, 2]));
  const v0 = R(sim, 2).speed;
  ok(v0 > C.MAX_SPEED * 0.95, 'the throttle is always open (' + v0.toFixed(1) + ')');
  run(sim, 0.6, (s) => { drive([1])(s); s.input(2, 0, true); });
  ok(R(sim, 2).brake && R(sim, 2).speed < C.MAX_SPEED * C.BRAKE_FACTOR * 1.2, 'braking is hard: slow within 0.6 s (' + R(sim, 2).speed.toFixed(1) + ')');
  ok(R(sim, 1).speed > C.MAX_SPEED * 0.95, 'the other car is not affected');
  run(sim, 0.1, (s) => { s.input(2, 0, false); });
  ok(!R(sim, 2).brake && R(sim, 2).speed > C.MAX_SPEED * C.BRAKE_FACTOR, 'letting go: the car pulls away again');
  // slower means a tighter circle
  const circle = (brake) => {
    const s = mk([1, 2], { items: false });
    toRace(s); run(s, 3, drive([1, 2]));
    pin(s, 2, 1, -15);                         // out of the way: a car behind would push the braking one along
    run(s, 1, (q) => q.input(1, 0, brake));
    const r = R(s, 1), h0 = r.heading, x0 = r.x, z0 = r.z;
    let dist = 0, px = x0, pz = z0;
    for (let i = 0; i < 20; i++) { r.speed = brake ? C.MAX_SPEED * C.BRAKE_FACTOR : C.MAX_SPEED; r.offMs = 0; s.input(1, 1, false); s.step(DT); dist += Math.hypot(r.x - px, r.z - pz); px = r.x; pz = r.z; }
    return dist / Math.abs(r.heading - h0);    // metres per radian = turning radius
  };
  const fast = circle(false), slow = circle(true);
  ok(slow < fast * 0.7, 'after braking the turning circle is much tighter (' + slow.toFixed(1) + ' m vs ' + fast.toFixed(1) + ' m)');
}

// ---- nitro ----
{
  const sim = mk([1, 2], { items: false });
  eq(sim.nitro(1), false, 'no nitro during the countdown');
  toRace(sim); run(sim, 3, drive([1, 2]));
  eq(sim.nitro(1), true, 'nitro fires');
  eq(sim.nitro(1), false, 'and then needs to cool down');
  run(sim, 1, drive([1, 2]));
  ok(R(sim, 1).speed > C.MAX_SPEED * 1.3, 'nitro is fast (' + R(sim, 1).speed.toFixed(1) + ')');
  run(sim, C.NITRO_CD / 1000, drive([1, 2]));
  eq(sim.nitro(1), true, 'after the cooldown it fires again');
}

// ---- slipstream and tempo ----
{
  const sim = mk([1, 2], { items: false });
  toRace(sim); run(sim, 3, drive([1, 2]));
  run(sim, 1, (s) => { drive([1, 2])(s); pin(s, 2, 1, 6); });
  ok(R(sim, 2).draft > 0.9 && R(sim, 1).draft === 0, 'right behind another car: slipstream');
  run(sim, 1.5, (s) => { drive([1, 2])(s); pin(s, 2, 1, 6); const r = R(s, 2), q = s.track.samples[r.idx]; r.x += q.nx * 5; r.z += q.nz * 5; r.offMs = 0; });
  eq(R(sim, 2).draft, 0, 'next to it: none');
  eq(sim.state.tempo, 1, 'the first seconds run at normal tempo');
  const s2 = mk([1, 2], { items: false });
  toRace(s2);
  run(s2, 40, (s) => { drive([1])(s); if (s.state.phase === 'race') { pin(s, 2, 1, 8); R(s, 2).offMs = 0; } });
  ok(s2.state.tempo > 1.05, 'a long heat gets faster (' + s2.state.tempo.toFixed(2) + ')');
}

// ---- items ----
{
  const sim = mk([1, 2, 3]);
  toRace(sim); run(sim, 3, drive([1, 2, 3]));
  const st = sim.state, box = st.boxes[0];
  const onBox = (id) => { const r = R(sim, id); r.x = box.x; r.z = box.z; r.y = 0; };
  const keep = (s) => { for (const id of [1, 2, 3]) R(s, id).offMs = 0; };

  // a box gives one item, is gone for a while, and comes back
  onBox(2);
  let log = run(sim, DT);
  const got = log.find(e => e.t === 'pickup');
  ok(got && got.id === 2 && C.ITEMS.includes(got.item) && R(sim, 2).item === got.item, 'driving through a box gives an item');
  ok(box.readyAt > st.time, 'the box is gone');
  onBox(3); log = run(sim, DT);
  ok(!log.some(e => e.t === 'pickup') && R(sim, 3).item === null, 'an empty spot gives nothing');
  box.readyAt = st.time; onBox(2); log = run(sim, DT);
  ok(!log.some(e => e.t === 'pickup') && log.some(e => e.t === 'box'), 'who already holds an item keeps it');
  ok(Math.abs(box.readyAt - (st.time + C.BOX_RESPAWN_MS)) < 20, 'the box comes back after its respawn time');

  // the leader gets defence, the last one attack (the place in the field is forced through the lap counter)
  const tally = (id, laps) => {
    const seen = {}, r = R(sim, id), lap0 = r.lap;
    for (let i = 0; i < 150; i++) { r.item = null; box.readyAt = 0; r.lap = lap0 + laps; onBox(id); keep(sim); sim.step(DT); seen[r.item] = 1; }
    r.lap = lap0;
    return Object.keys(seen).sort().join(',');
  };
  eq(tally(2, 3), 'oil,shield', 'the leader only gets oil and shield');
  const back = tally(2, -3);
  ok(/rocket/.test(back) && /magnet/.test(back) && /bolt/.test(back), 'the last one gets rockets, magnets and lightning (' + back + ')');
}
{
  // rocket: flies to the car in front and spins it
  const sim = mk([1, 2]);
  toRace(sim); run(sim, 3, drive([1, 2]));
  pin(sim, 2, 1, 14); R(sim, 2).item = 'rocket';
  eq(sim.useItem(2), 'rocket', 'the rocket is fired');
  eq(R(sim, 2).item, null, 'and gone from the hand');
  eq(sim.state.rockets[0].target, 1, 'it aims at the car in front');
  const v = R(sim, 1).speed;
  const log = run(sim, 1.5, (s) => { drive([1, 2])(s); R(s, 2).offMs = 0; });
  const spin = log.find(e => e.t === 'spin');
  ok(spin && spin.id === 1 && spin.by === 2, 'it hits');
  eq(sim.state.rockets.length, 0, 'and is used up');
  ok(R(sim, 1).speed < v * 0.6, 'the victim loses its speed');
  eq(sim.useItem(2), null, 'no item, nothing to fire');

  // shield: the next rocket bounces off
  run(sim, 2, drive([1, 2]));
  pin(sim, 2, 1, 14); R(sim, 2).item = 'rocket'; R(sim, 1).item = 'shield';
  sim.useItem(1); sim.useItem(2);
  const log2 = run(sim, 1.5, (s) => { drive([1, 2])(s); R(s, 2).offMs = 0; });
  ok(log2.some(e => e.t === 'block' && e.id === 1) && !log2.some(e => e.t === 'spin'), 'a shield stops the rocket');

  // a rocket without a target follows the road and fizzles out
  pin(sim, 2, 1, 10); sim.step(DT);
  const first = sim.leader().id;
  R(sim, first).item = 'rocket'; sim.useItem(first);
  eq(sim.state.rockets[0].target, null, 'the leader has nobody to aim at');
  const log3 = run(sim, C.ROCKET_MS / 1000 + 0.2, (s) => { drive([1, 2])(s); R(s, 1).offMs = 0; R(s, 2).offMs = 0; });
  ok(log3.some(e => e.t === 'fizz') && sim.state.rockets.length === 0, 'its rocket burns out');
}
{
  // oil, lightning, magnet
  const sim = mk([1, 2, 3]);
  toRace(sim); run(sim, 3, drive([1, 2, 3]));
  const keep = (s) => { for (const id of [1, 2, 3]) R(s, id).offMs = 0; };
  pin(sim, 1, 1, 0); pin(sim, 2, 1, 16); pin(sim, 3, 1, 32);
  R(sim, 1).item = 'oil'; sim.useItem(1);
  eq(sim.state.drops.length, 1, 'oil lands behind the car');
  let log = run(sim, 1.2, (s) => { drive([1, 2, 3])(s); keep(s); });
  ok(log.some(e => e.t === 'slip' && e.id === 2) && sim.state.drops.length === 0, 'the next car slides on it, then it is gone');

  pin(sim, 2, 1, 12); pin(sim, 3, 1, 24);
  R(sim, 2).item = 'shield'; sim.useItem(2);
  R(sim, 3).item = 'bolt'; sim.useItem(3);
  ok(R(sim, 1).slowUntil > sim.state.time && R(sim, 2).slowUntil === 0 && R(sim, 3).slowUntil === 0, 'lightning slows everybody else, except behind a shield');
  run(sim, 1, (s) => { drive([1, 2, 3])(s); keep(s); });
  ok(R(sim, 1).speed < C.MAX_SPEED * 0.75, 'slowed cars are slow');

  run(sim, C.BOLT_MS / 1000 + 2, (s) => { drive([1, 2, 3])(s); keep(s); });
  pin(sim, 2, 1, 12); pin(sim, 3, 1, 24); sim.step(DT);
  R(sim, 3).item = 'magnet'; sim.useItem(3);
  eq(R(sim, 3).magnetTo, 2, 'the magnet grabs the car in front');
  run(sim, 1, (s) => { drive([1, 2, 3])(s); keep(s); });
  ok(R(sim, 3).speed > C.MAX_SPEED * 1.2, 'and pulls (' + R(sim, 3).speed.toFixed(1) + ')');
}
{
  // lava
  const def = Tracks.TRACKS.vulkan, sim = Sim.create({ pts: def.pts, ids: [1, 2, 3], seed: 4, lava: 7 }); sim.start();
  toRace(sim); run(sim, 3, drive([1, 2, 3]));
  const l = sim.state.lava[0], r = R(sim, 3);
  r.x = l.x; r.z = l.z; r.y = 0;
  const out = run(sim, DT).find(e => e.t === 'out');
  ok(out && out.id === 3 && out.why === 'lava', 'driving into lava: out at once');
}

// ---- heats, points, tournament ----
{
  const sim = mk([1, 2, 3], { items: false, target: 3 });
  toRace(sim); run(sim, 3, drive([1, 2, 3]));
  knock(sim, 3, 1, [1, 2]);
  eq(sim.state.phase, 'race', 'first one out, the heat goes on');
  let log = knock(sim, 2, 1, [1]);
  ok(log.some(e => e.t === 'heatEnd' && e.winner === 1), 'second one out ends the heat');
  eq([1, 2, 3].map(id => sim.state.points[id]).join(','), '2,1,0', 'points by how long you lasted');
  eq(sim.nitro(1), false, 'no nitro after the heat');
  const t0 = sim.state.time;
  log = until(sim, (s) => s.state.phase === 'countdown', drive([1]));
  ok(log.some(e => e.t === 'heat' && e.heat === 2), 'the next heat starts by itself');
  ok(Math.abs(sim.state.time - t0 - C.HEAT_OVER_MS) < 40, 'after the pause');
  ok([1, 2, 3].every(id => R(sim, id).alive && R(sim, id).speed === 0), 'everybody is back on the grid');
  ok(R(sim, 3).progress >= R(sim, 2).progress && R(sim, 2).progress > R(sim, 1).progress, 'fewest points start in front');

  // 1 wins again: 4 points ≥ target 3 → champion
  toRace(sim); run(sim, 3, drive([1, 2, 3]));
  knock(sim, 3, 1, [1, 2]); knock(sim, 2, 1, [1]);
  log = until(sim, (s) => s.state.phase !== 'heatOver', drive([1]));
  ok(log.some(e => e.t === 'final' && e.champion === 1) && sim.state.phase === 'final' && sim.state.champion === 1, 'target reached alone → tournament won');
  run(sim, 5);
  eq(sim.state.phase, 'final', 'the final screen stays');
  eq(sim.rematch(), true, 'rematch');
  eq(sim.state.phase + ',' + sim.state.heat + ',' + sim.state.points[1], 'countdown,1,0', 'starts over at heat 1 with no points');
  eq(sim.rematch(), false, 'no rematch in the middle of a match');
}
{
  // a tie at the target goes on until one is alone in front
  const sim = mk([1, 2], { items: false, target: 1 });
  sim.state.points[1] = 1;
  toRace(sim); run(sim, 3, drive([1, 2]));
  knock(sim, 1, 2, [2]);
  const log = until(sim, (s) => s.state.phase !== 'heatOver', drive([2]));
  ok(!log.some(e => e.t === 'final') && sim.state.heat === 2 && sim.state.phase === 'countdown', '1 : 1 at target 1 → another heat');
}

// ---- players leave ----
{
  const sim = mk([1, 2, 3], { items: false });
  toRace(sim); run(sim, 3, drive([1, 2, 3]));
  eq(sim.remove(3), true, 'three minus one: goes on');
  ok(!R(sim, 3) && sim.state.order.length === 2 && sim.state.points[3] === undefined && sim.state.phase === 'race', 'the leaver is gone from the race and the table');
  run(sim, 1, drive([1, 2]));
  const s2 = mk([1, 2, 3], { items: false });
  toRace(s2); run(s2, 3, drive([1, 2, 3]));
  knock(s2, 3, 1, [1, 2]);
  eq(s2.remove(1), true, 'the leader leaves a race of two alive');
  eq(s2.state.phase + ',' + s2.state.heatWinner, 'heatOver,2', 'the other one wins the heat');
  eq(s2.remove(2), false, 'one player left: the match cannot go on');
}

// ---- camera and projection ----
{
  const sim = mk([1, 2], { items: false });
  toRace(sim); run(sim, 5, drive([1, 2]));
  const a = sim.leader(), p = sim.project(a.x, 0.6, a.z), cam = sim.state.cam;
  ok(p.ok && Math.abs(p.x) < 0.5 && Math.abs(p.y) < 0.6, 'the leader is in the middle of the picture');
  const back = sim.project(cam.x - (cam.ax - cam.x), 0, cam.z - (cam.az - cam.z));
  ok(!back.ok, 'what is behind the camera is not in the picture');
  ok(cam.y >= 14 && cam.y <= 27, 'the camera flies between its near and far height');
  const tight = cam.zoom;
  run(sim, 3, (s) => { drive([1])(s); pin(s, 2, 1, 22); R(s, 2).offMs = 0; });
  ok(sim.state.cam.zoom > tight + 0.3, 'it opens up when the field stretches');
}

console.log(process.exitCode ? '❌ Micro Racer: Regeltests fehlgeschlagen' : '✅ Micro Racer: ' + checks + ' Checks bestanden');
