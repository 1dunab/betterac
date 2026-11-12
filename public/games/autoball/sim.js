// ===== Autoball simulation: pitch, cars, ball, goals, match flow, bots =====
// No three.js and no DOM, so it runs in Node (test-autoball.js). Fixed ticks of 1/120 s, one seed for
// everything random. Team 0 defends the goal at -x and attacks towards +x; team 1 the other way round.
(function (root) {
  // ---- tunables (honest guesses until real people have played) ----
  const L = 36, WD = 23.5, CORNER = 9;                     // pitch: half length (x), half width (z), corner radius
  const GOAL_HALF = 7, GOAL_DEPTH = 5, GOAL_H = 5.5, POST_R = 0.6;
  const CAR_R = 1.5, CAR_HALF = 0.85, CAR_W = 1.0, CAR_TOP = 1.5;   // against the ball a car is a capsule
  const BALL_R = 1.6, BALL_MASS = 0.15;                     // a car weighs 1
  // driving: the stick says where to go on the TV; the car turns that way and drives
  const MAX_SPEED = 21, ACCEL = 30, BRAKE = 45, TURN_SLOW = 5.2, TURN_FAST = 2.9, GRIP = 8, DEAD = 0.18;
  const BOOST_FACTOR = 1.55, BOOST_ACCEL = 2, BOOST_USE = 1 / 1.6, BOOST_REGEN = 1 / 8, BOOST_START = 0.5, BOOST_MIN = 0.12;
  const PADS = [[-18, -13], [18, -13], [-18, 13], [18, 13]], PAD_R = 2.2, PAD_MS = 7000;
  // ball
  const GRAVITY = 32, GROUND_BOUNCE = 0.6, WALL_BOUNCE = 0.78, ROLL_DRAG = 0.45, AIR_DRAG = 0.08, BALL_MAX = 62;
  const HIT_BOUNCE = 0.55, LIFT = 0.4, LIFT_MAX = 16;
  const ASSIST_MS = 4000;            // a shot that a defender only deflects still belongs to the shooter
  const CAR_WALL = 0.3, CAR_KICK = 0.8;
  // match
  const FIRST_COUNT_MS = 3000, COUNT_MS = 2000, GOAL_MS = 3200, BLAST_R = 22, BLAST = 30;
  const STALE_MS = 8000, STALE_DIST = 2.5, DROP_H = 16;     // a ball that does not get away for this long is dropped in the middle
  const SPOTS = [[-13, 0], [-23, -9], [-23, 9], [-31, 0], [-28, -16], [-28, 16]];
  // bots
  const BOT_THINK_MS = 180, BOT_STICK = 0.88, BOT_NOISE = 0.14, BOT_STUCK_MS = 700, BOT_ESCAPE_MS = 650;
  const H = 1 / 120;
  // arenas: what changes the rules (the looks are in render.js). grip: tyres, roll: how soon the ball stops
  const ARENAS = {
    stadion: { label: '🏟️ Stadion', grip: 1, roll: 1 },
    eis: { label: '🧊 Eishalle', grip: 0.3, roll: 0.3 },
    neon: { label: '🌃 Neon', grip: 1, roll: 1 }
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Keep a circle (o.x, o.z, velocity o.vx, o.vz) of radius rad inside the pitch: a rounded rectangle plus
  // the two goal boxes behind the goal lines. `open` = the goal mouths are open for it (the ball is not when
  // it flies above the crossbar). Returns how hard it hit a wall (speed into the wall), 0 = no contact.
  function confine(o, rad, bounce, open) {
    const ax = Math.abs(o.x), az = Math.abs(o.z), sx = o.x < 0 ? -1 : 1, sz = o.z < 0 ? -1 : 1;
    let hit = 0;
    const wall = (nx, nz) => {                // nx, nz: wall normal pointing into the pitch
      const v = o.vx * nx + o.vz * nz;
      if (v < 0) { o.vx -= (1 + bounce) * v * nx; o.vz -= (1 + bounce) * v * nz; hit = Math.max(hit, -v); }
    };
    if (open && ax > L) {                     // inside a goal box
      if (az > GOAL_HALF - rad) { o.z = sz * (GOAL_HALF - rad); wall(0, -sz); }
      if (ax > L + GOAL_DEPTH - rad) { o.x = sx * (L + GOAL_DEPTH - rad); wall(-sx, 0); }
      return hit;
    }
    if (open && az < GOAL_HALF && ax > L - rad) return 0;      // in the goal mouth: only the posts are in the way
    const hx = L - rad, hz = WD - rad, r = Math.max(0, CORNER - rad);
    const qx = ax - (hx - r), qz = az - (hz - r);
    if (qx > 0 && qz > 0) {                   // corner arc
      const d = Math.hypot(qx, qz);
      if (d > r) {
        const nx = qx / d, nz = qz / d;
        o.x = sx * (hx - r + nx * r); o.z = sz * (hz - r + nz * r);
        wall(-sx * nx, -sz * nz);
      }
    } else {
      if (ax > hx) { o.x = sx * hx; wall(-sx, 0); }
      if (az > hz) { o.z = sz * hz; wall(0, -sz); }
    }
    return hit;
  }

  // the four goal posts are round: a circle bounces off them
  function posts(o, rad, bounce) {
    let hit = 0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const dx = o.x - sx * L, dz = o.z - sz * GOAL_HALF, d = Math.hypot(dx, dz);
      if (d >= rad + POST_R || d < 1e-6) continue;
      const nx = dx / d, nz = dz / d, v = o.vx * nx + o.vz * nz;
      o.x = sx * L + nx * (rad + POST_R); o.z = sz * GOAL_HALF + nz * (rad + POST_R);
      if (v < 0) { o.vx -= (1 + bounce) * v * nx; o.vz -= (1 + bounce) * v * nz; hit = Math.max(hit, -v); }
    }
    return hit;
  }

  // o = { cars: [{ id, team, bot }], seed, minutes, arena (key of ARENAS) }
  function create(o) {
    const rng = mulberry32((o.seed >>> 0) || 1);
    const arena = ARENAS[o.arena] || ARENAS.stadion, gripMul = arena.grip, rollMul = arena.roll;
    const out = [];
    let acc = 0, countN = 0, clockN = 0, nextBot = -1;

    const st = {
      time: 0, phase: 'kickoff', phaseAt: 0, clock: Math.round((o.minutes || 3) * 60000), golden: false,
      score: [0, 0], winner: null, lastGoal: null, kickoffs: 0,
      cars: [], ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, live: true, touch: null, last: [null, null], ax: 0, az: 0, since: 0 },
      pads: PADS.map(p => ({ x: p[0], z: p[1], readyAt: 0 }))
    };
    const ball = st.ball;

    function makeCar(c) {
      if (c.bot && c.id <= nextBot) nextBot = c.id - 1;
      const car = { id: c.id, team: c.team ? 1 : 0, bot: !!c.bot, x: 0, z: 0, heading: 0, speed: 0, vx: 0, vz: 0,
        ix: 0, iz: 0, boost: false, boosting: false, tank: BOOST_START, steer: 0, goals: 0, ownGoals: 0, touches: 0,
        thinkAt: 0, stuckMs: 0, escapeUntil: 0, ex: 0, ez: 0 };
      st.cars.push(car);
      return car;
    }
    (o.cars || []).forEach(makeCar);
    const car = (id) => st.cars.find(c => c.id === id) || null;
    const team = (t) => st.cars.filter(c => c.team === t);

    // ---------- kickoff ----------
    function lineUp() {
      for (const t of [0, 1]) team(t).forEach((c, i) => {
        const s = SPOTS[i % SPOTS.length], dir = t === 0 ? 1 : -1;
        c.x = s[0] * dir; c.z = s[1] * dir + (i >= SPOTS.length ? 4 : 0);
        c.heading = Math.atan2(-c.z, -c.x);
        c.speed = c.vx = c.vz = 0; c.steer = 0; c.boosting = false; c.tank = Math.max(c.tank, BOOST_START);
      });
      ball.x = ball.y = ball.z = ball.vx = ball.vy = ball.vz = 0; ball.live = true; ball.touch = null; ball.last = [null, null];
      ball.ax = ball.az = 0; ball.since = st.time;
    }
    function kickoff() {
      lineUp();
      st.phase = 'kickoff'; st.phaseAt = st.time + (st.kickoffs++ ? COUNT_MS : FIRST_COUNT_MS); countN = 0;
      out.push({ t: 'kickoff' });
    }

    // ---------- cars ----------
    function driveCar(c) {
      const mag = Math.min(1, Math.hypot(c.ix, c.iz));
      const was = c.boosting;
      let target = 0, accel = ACCEL;
      c.boosting = false;
      if (mag > DEAD || c.boost) {
        let diff = 0;
        if (mag > DEAD) {
          diff = wrap(Math.atan2(c.iz, c.ix) - c.heading);
          // a slow car turns almost on the spot, a fast one needs room
          const rate = TURN_SLOW + (TURN_FAST - TURN_SLOW) * clamp(Math.abs(c.speed) / MAX_SPEED, 0, 1);
          c.heading = wrap(c.heading + clamp(diff, -rate * H, rate * H));
        }
        c.steer = clamp(diff * 1.5, -1, 1);
        target = MAX_SPEED * (mag > DEAD ? mag : 1) * Math.max(0.3, Math.cos(diff));   // off the gas while turning round
        if (c.boost && c.tank > (was ? 0 : BOOST_MIN)) {       // an empty tank needs a moment before it fires again
          c.boosting = true; c.tank = Math.max(0, c.tank - BOOST_USE * H);
          target = MAX_SPEED * BOOST_FACTOR * Math.max(0.3, Math.cos(diff)); accel = ACCEL * BOOST_ACCEL;
        }
      } else c.steer = 0;
      if (!c.boosting) c.tank = Math.min(1, c.tank + BOOST_REGEN * H);
      c.speed += clamp(target - c.speed, -BRAKE * H, accel * H);
      const k = Math.min(1, GRIP * gripMul * H);
      c.vx += (Math.cos(c.heading) * c.speed - c.vx) * k;
      c.vz += (Math.sin(c.heading) * c.speed - c.vz) * k;
      c.x += c.vx * H; c.z += c.vz * H;
      if (confine(c, CAR_R, CAR_WALL, true) + posts(c, CAR_R, CAR_WALL) > 0) resync(c);
      for (const p of st.pads) {
        if (st.time < p.readyAt || c.tank >= 1 || Math.hypot(p.x - c.x, p.z - c.z) > PAD_R + 0.6) continue;
        p.readyAt = st.time + PAD_MS; c.tank = 1;
        out.push({ t: 'pad', id: c.id });
      }
    }
    // after a knock the engine speed follows what is left of the velocity along the car
    function resync(c) { c.speed = clamp(c.vx * Math.cos(c.heading) + c.vz * Math.sin(c.heading), -MAX_SPEED, MAX_SPEED * BOOST_FACTOR); }

    function collideCars() {
      const C = st.cars;
      for (let a = 0; a < C.length; a++) for (let b = a + 1; b < C.length; b++) {
        const A = C[a], B = C[b], dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz) || 0.01;
        if (d >= CAR_R * 2) continue;
        const nx = dx / d, nz = dz / d, push = (CAR_R * 2 - d) / 2;
        A.x -= nx * push; A.z -= nz * push; B.x += nx * push; B.z += nz * push;
        const av = A.vx * nx + A.vz * nz, bv = B.vx * nx + B.vz * nz, kick = (bv - av) * CAR_KICK;
        if (kick < 0) { A.vx += kick * nx; A.vz += kick * nz; B.vx -= kick * nx; B.vz -= kick * nz; resync(A); resync(B); }
        if (av - bv > 6) out.push({ t: 'bump', a: A.id, b: B.id });
      }
    }

    // ---------- ball ----------
    // under the crossbar the goal is open; a ball that is already behind the line stays in
    function wallsBall() {
      const open = ball.y + BALL_R * 2 < GOAL_H || Math.abs(ball.x) > L;
      return confine(ball, BALL_R, WALL_BOUNCE, open) + posts(ball, BALL_R, WALL_BOUNCE);
    }

    function moveBall() {
      if (!ball.live) return;
      if (ball.y > 0 || ball.vy > 0) {
        ball.vy -= GRAVITY * H; ball.y += ball.vy * H;
        if (ball.y <= 0) {
          ball.y = 0;
          if (ball.vy < -4) { out.push({ t: 'bounce', power: -ball.vy }); ball.vy = -ball.vy * GROUND_BOUNCE; } else ball.vy = 0;
        }
      }
      const drag = 1 - (ball.y > 0 ? AIR_DRAG : ROLL_DRAG * rollMul) * H;
      ball.vx *= drag; ball.vz *= drag;
      ball.x += ball.vx * H; ball.z += ball.vz * H;
      const hit = wallsBall();
      if (hit > 5) out.push({ t: 'bounce', power: hit });
      const v = Math.hypot(ball.vx, ball.vz);
      if (v > BALL_MAX) { ball.vx *= BALL_MAX / v; ball.vz *= BALL_MAX / v; }
      // wedged in a corner or between two cars: after a while the referee drops it in the middle
      if (Math.hypot(ball.x - ball.ax, ball.z - ball.az) > STALE_DIST) { ball.ax = ball.x; ball.az = ball.z; ball.since = st.time; }
      else if (st.time - ball.since > STALE_MS) {
        ball.x = ball.z = ball.vx = ball.vy = ball.vz = 0; ball.y = DROP_H; ball.touch = null;
        ball.ax = ball.az = 0; ball.since = st.time;
        out.push({ t: 'drop' });
      }
    }

    function hitBall(c) {
      if (!ball.live || ball.y >= CAR_TOP) return;        // the ball flies over the car
      const dx = Math.cos(c.heading), dz = Math.sin(c.heading);
      const along = clamp((ball.x - c.x) * dx + (ball.z - c.z) * dz, -CAR_HALF, CAR_HALF);
      let nx = ball.x - (c.x + dx * along), nz = ball.z - (c.z + dz * along);
      const d = Math.hypot(nx, nz), reach = CAR_W + BALL_R;
      if (d >= reach) return;
      if (d < 1e-6) { nx = dx; nz = dz; } else { nx /= d; nz /= d; }
      ball.x += nx * (reach - d); ball.z += nz * (reach - d);
      // a wall behind the ball: the ball stays inside and the car gives way instead
      const px = ball.x, pz = ball.z;
      wallsBall();
      const back = Math.hypot(ball.x - px, ball.z - pz);
      if (back > 1e-4) { c.x -= nx * back; c.z -= nz * back; }
      const rel = (ball.vx - c.vx) * nx + (ball.vz - c.vz) * nz;
      if (rel >= 0) return;
      const j = -(1 + HIT_BOUNCE) * rel / (1 / BALL_MASS + 1);
      ball.vx += nx * j / BALL_MASS; ball.vz += nz * j / BALL_MASS;
      c.vx -= nx * j; c.vz -= nz * j; resync(c);
      ball.vy = Math.max(ball.vy, Math.min(LIFT_MAX, LIFT * -rel));     // a hard hit lifts the ball
      if (ball.y <= 0) ball.y = 0.01;
      if (!ball.touch || ball.touch.id !== c.id) c.touches++;
      ball.touch = { id: c.id, team: c.team };
      ball.last[c.team] = { id: c.id, at: st.time };
      if (-rel > 3) out.push({ t: 'kick', id: c.id, power: -rel });
    }

    function checkGoal() {
      if (!ball.live || Math.abs(ball.x) < L + BALL_R * 0.6) return;
      // who scored: the last attacker to touch the ball, unless that is long ago and a defender put it in
      const t = ball.x > 0 ? 0 : 1, mine = ball.last[t], theirs = ball.last[1 - t];
      const own = !!theirs && (!mine || (theirs.at > mine.at && st.time - mine.at > ASSIST_MS));
      const who = own ? theirs : mine, by = who ? car(who.id) : null;
      st.score[t]++;
      if (by) { if (own) by.ownGoals++; else by.goals++; }
      st.lastGoal = { team: t, scorer: who ? who.id : null, own, x: ball.x, z: ball.z };
      // the ball bursts and throws the cars around it away
      for (const c of st.cars) {
        const dx = c.x - ball.x, dz = c.z - ball.z, d = Math.hypot(dx, dz) || 1;
        if (d > BLAST_R) continue;
        const f = BLAST * (1 - d / BLAST_R);
        c.vx += dx / d * f; c.vz += dz / d * f; resync(c);
      }
      ball.live = false;
      st.phase = 'goal'; st.phaseAt = st.time + GOAL_MS;
      out.push(Object.assign({ t: 'goal' }, st.lastGoal));
    }

    // ---------- bots ----------
    function think(c) {
      const t = st.time;
      c.thinkAt = t + BOT_THINK_MS;
      // jammed against a wall, the ball or another car: back out towards the middle for a moment
      if (Math.abs(c.speed) < 2.5 && Math.hypot(c.ix, c.iz) > 0.5) c.stuckMs += BOT_THINK_MS; else c.stuckMs = 0;
      if (c.stuckMs >= BOT_STUCK_MS && t >= c.escapeUntil) {
        const a = Math.atan2(-c.z, -c.x) + (rng() - 0.5) * 2.2;
        c.escapeUntil = t + BOT_ESCAPE_MS; c.stuckMs = 0; c.ex = Math.cos(a); c.ez = Math.sin(a);
      }
      if (t < c.escapeUntil) { c.ix = c.ex; c.iz = c.ez; c.boost = false; return; }

      const goalX = c.team === 0 ? L : -L, ownX = -goalX;
      const bx = ball.x + ball.vx * 0.2, bz = ball.z + ball.vz * 0.2;
      const mates = team(c.team).slice().sort((a, b) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b.x - bx, b.z - bz));
      const danger = Math.hypot(bx - ownX, bz) < 17;
      let tx, tz, boost = false;
      if (!ball.live) { tx = ownX * 0.5; tz = c.z * 0.5; }
      else if (mates[0] === c || danger) {
        // where the ball should go: at the goal, or (in front of the own goal) simply away from it
        let gx = danger ? bx - ownX : goalX - bx, gz = danger ? bz : clamp(bz * 0.3, -GOAL_HALF + 2, GOAL_HALF - 2) - bz;
        const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
        const rx = bx - c.x, rz = bz - c.z, dist = Math.hypot(rx, rz) || 1;
        const ahead = rx * gx + rz * gz;                     // > 0: the car is on the right side of the ball
        if (ahead < 1 && danger) { tx = ownX * 0.9; tz = clamp(bz * 0.5, -GOAL_HALF + 2, GOAL_HALF - 2); }   // first get goal-side
        else if (ahead < 1) {                                // wrong side: swing round it in a wide arc
          const side = (gx * (c.z - bz) - gz * (c.x - bx)) < 0 ? -1 : 1;
          tx = bx - gx * 6 - gz * side * 7; tz = bz - gz * 6 + gx * side * 7;
        } else if (ahead / dist > 0.93 || dist < 4) { tx = bx + gx * 3; tz = bz + gz * 3; boost = dist < 16 && c.tank > 0.3; }
        else { tx = bx - gx * (BALL_R + 2.4); tz = bz - gz * (BALL_R + 2.4); }
        // no room behind a ball on the boards: then just hit it from where there is room
        if (Math.abs(tx) > L - 2 || Math.abs(tz) > WD - 2) { tx = clamp(tx, -L + 2, L - 2); tz = clamp(tz, -WD + 2, WD - 2); if (Math.hypot(tx - c.x, tz - c.z) < 3) { tx = bx; tz = bz; } }
      } else { tx = ownX * 0.9 + (bx - ownX * 0.9) * 0.45; tz = bz * 0.45; }       // hold a spot between ball and own goal
      const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz) || 1;
      const a = Math.atan2(dz, dx) + (rng() - 0.5) * 2 * BOT_NOISE, m = BOT_STICK * Math.min(1, d / 2.5);
      c.ix = Math.cos(a) * m; c.iz = Math.sin(a) * m; c.boost = boost;
    }

    // ---------- one tick ----------
    function tick() {
      st.time += H * 1000;
      const t = st.time;
      if (st.phase === 'kickoff') {
        const n = Math.ceil((st.phaseAt - t) / 1000);
        if (n !== countN && n > 0 && n <= 3) { countN = n; out.push({ t: 'count', n }); }
        if (t >= st.phaseAt) { st.phase = 'play'; out.push({ t: 'go' }); }
        return;
      }
      if (st.phase === 'over') return;
      for (const c of st.cars) { if (c.bot && t >= c.thinkAt) think(c); driveCar(c); }
      collideCars();
      for (const c of st.cars) { confine(c, CAR_R, CAR_WALL, true); posts(c, CAR_R, CAR_WALL); }     // shoved by another car: still inside
      if (st.phase === 'play') {
        moveBall();
        for (const c of st.cars) hitBall(c);
        checkGoal();
        for (const c of st.cars) { confine(c, CAR_R, CAR_WALL, true); posts(c, CAR_R, CAR_WALL); }   // pushed by a car or the ball: still inside
        if (st.phase === 'play' && !st.golden) {
          st.clock = Math.max(0, st.clock - H * 1000);
          const n = Math.ceil(st.clock / 1000);
          if (n !== clockN) { clockN = n; if (n <= 10 && n > 0) out.push({ t: 'clock', n }); }
          if (st.clock <= 0) {
            if (st.score[0] !== st.score[1]) finish();
            else { st.golden = true; out.push({ t: 'golden' }); }
          }
        }
      } else if (st.phase === 'goal' && t >= st.phaseAt) {
        if (st.golden || st.clock <= 0) finish(); else kickoff();
      }
    }
    function finish() {
      st.phase = 'over'; st.winner = st.score[0] > st.score[1] ? 0 : 1;
      out.push({ t: 'over', winner: st.winner });
    }

    const sim = { state: st, car, team };

    // advance by dt seconds (in fixed ticks); returns what happened
    sim.step = function (dt) {
      acc += dt;
      while (acc >= H) { acc -= H; tick(); }
      return out.splice(0);
    };

    // phone input: stick x, z as on the TV (right = +x, down = +z), boost held
    sim.input = function (id, x, z, boost) {
      const c = car(id);
      if (!c || c.bot) return;
      x = +x || 0; z = +z || 0;
      const m = Math.hypot(x, z);
      if (m > 1) { x /= m; z /= m; }
      c.ix = x; c.iz = z; c.boost = !!boost;
    };

    // a latecomer: gets a car in front of the own goal
    sim.add = function (c) {
      const k = makeCar(c), dir = k.team === 0 ? -1 : 1;
      k.x = dir * (L - 8); k.z = (rng() - 0.5) * 20; k.heading = dir < 0 ? 0 : Math.PI;
      return k;
    };
    // a car changes its id (bot ↔ player): what it did to the ball stays its own
    function retouch(from, to) { for (const x of [ball.touch, ball.last[0], ball.last[1]]) if (x && x.id === from) x.id = to; }
    // a player leaves: a bot drives the car on. Returns the bot's (negative) id.
    sim.toBot = function (id) {
      const c = car(id);
      if (!c || c.bot) return null;
      c.id = nextBot--; c.bot = true; c.thinkAt = 0;
      retouch(id, c.id);
      return c.id;
    };
    // a player takes over a bot's car
    sim.toHuman = function (botId, id) {
      const c = car(botId);
      if (!c || !c.bot) return false;
      c.id = id; c.bot = false; c.ix = c.iz = 0; c.boost = false;
      retouch(botId, id);
      return true;
    };

    kickoff();
    return sim;
  }

  const api = {
    CONST: { L, WD, CORNER, GOAL_HALF, GOAL_DEPTH, GOAL_H, POST_R, CAR_R, CAR_HALF, CAR_W, CAR_TOP, BALL_R, MAX_SPEED, BOOST_FACTOR, BOOST_START,
      PADS, PAD_R, PAD_MS, FIRST_COUNT_MS, COUNT_MS, GOAL_MS, BALL_MAX, H },
    ARENAS, create, confine, mulberry32
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AutoballSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
