// ===== Micro Racer simulation: track, driving, camera + visibility, items, heats =====
// No three.js and no DOM, so it runs in Node (test-racer.js). Everything random comes from one seed.
// The camera lives here because it decides who is out: a car that leaves the picture is eliminated.
(function (root) {
  // ---- tunables (honest guesses until real people have played) ----
  const ROAD_W = 9, CAR_R = 1.5, SEG = 1;                 // SEG: metres between track samples
  // driving
  const MAX_SPEED = 26, ACCEL = 22, TURN = 2.5, GRIP = 7, OFFROAD_FACTOR = 0.42, GRAVITY = 34;
  const BRAKE_FACTOR = 0.3, BRAKE_DECEL = 60;             // both buttons: down to 30% speed, hard
  const NITRO_MS = 2200, NITRO_CD = 6500, NITRO_BOOST = 1.5, PAD_MS = 1300, OIL_MS = 1300;
  const DRAFT_MIN = 2.5, DRAFT_MAX = 13, DRAFT_SIDE = 1.7, DRAFT_BONUS = 0.09;   // slipstream
  const CATCHUP = 0.06, CATCHUP_DIST = 20;                // chasers get up to +6% top speed
  const TEMPO_AFTER_MS = 25000, TEMPO_PER_S = 0.007, TEMPO_MAX = 0.6;    // a heat gets faster so it ends
  // camera + elimination
  const FOV = 55, ASPECT = 960 / 600;
  const CAM_NEAR = { back: 24, h: 15, ahead: 16 }, CAM_FAR = { back: 34, h: 26, ahead: 10 };
  const ZOOM_FROM = 8, ZOOM_TO = 22, ZOOM_RATE = 1.5, CAM_POS_RATE = 2.6, CAM_AIM_RATE = 3.2;
  const OFF_MS = 800;                // this long out of the picture → out
  const START_SAFE_MS = 2500;        // nobody is out right after the start
  const MAX_BEHIND = 45;             // further back than this never counts as "in the picture"
  const MAX_VIEW = 110;              // nor does a dot on the horizon: metres from the camera
  const EDGE_X = 1.02, EDGE_BOTTOM = -1.02, EDGE_TOP = 1.05;
  const LOST = 30;                   // this far from the road a car makes no more progress
  // heats
  const COUNTDOWN_MS = 3200, HEAT_OVER_MS = 4000, GRID_GAP = 5.5, GRID_SIDE = 2.2;
  // track furniture
  const FEATURE_GAP = 42, RAMPS = 2, PADS = 3, OILS = 2, BOX_ROWS = 3, BOX_LATS = [-2.8, 0, 2.8];
  const BOX_R = 1.9, BOX_RESPAWN_MS = 5000;
  // items
  const ROCKET_SPEED = 48, ROCKET_TURN = 5, ROCKET_MS = 3000, ROCKET_R = 2.2;
  const SPIN_MS = 1000, SPIN_FACTOR = 0.25, SPIN_KEEP = 0.45;
  const DROP_MS = 15000, DROP_ARM_MS = 350, DROP_R = 2.0;
  const SHIELD_MS = 4000, BOLT_MS = 2000, BOLT_FACTOR = 0.6, MAGNET_MS = 2200, MAGNET_BOOST = 1.35;
  const ITEMS = ['rocket', 'oil', 'shield', 'bolt', 'magnet'];
  // what a box gives, by place in the field: the further back, the better
  const WEIGHTS = {
    lead: { oil: 5, shield: 5 },
    mid: { rocket: 4, oil: 2, shield: 2, magnet: 3, bolt: 1 },
    last: { rocket: 4, oil: 1, shield: 2, magnet: 3, bolt: 2 }
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, f) => a + (b - a) * f;
  const TAN_HALF = Math.tan(FOV * Math.PI / 360);

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---- track: closed Catmull-Rom spline through pts, resampled every SEG metres ----
  // sample = { x, z, tx, tz (tangent), nx, nz (left normal), curv (1/radius, >0 bends towards n), cross }
  function buildTrack(pts, tension) {
    const T = tension == null ? 0.55 : tension, n = pts.length, SUB = 80, dense = [];
    const P = (i) => pts[((i % n) + n) % n];
    for (let i = 0; i < n; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let k = 0; k < SUB; k++) {
        const u = k / SUB, u2 = u * u, u3 = u2 * u;
        const h1 = 2 * u3 - 3 * u2 + 1, h2 = u3 - 2 * u2 + u, h3 = -2 * u3 + 3 * u2, h4 = u3 - u2;
        dense.push([
          h1 * p1[0] + h2 * T * (p2[0] - p0[0]) + h3 * p2[0] + h4 * T * (p3[0] - p1[0]),
          h1 * p1[1] + h2 * T * (p2[1] - p0[1]) + h3 * p2[1] + h4 * T * (p3[1] - p1[1])]);
      }
    }
    const M = dense.length, cum = [0];
    for (let i = 0; i < M; i++) { const a = dense[i], b = dense[(i + 1) % M]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const len = cum[M], N = Math.round(len / SEG), segLen = len / N, S = [];
    for (let i = 0, j = 0; i < N; i++) {
      const d = i * segLen;
      while (cum[j + 1] < d) j++;
      const a = dense[j], b = dense[(j + 1) % M], f = (d - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      S.push({ x: lerp(a[0], b[0], f), z: lerp(a[1], b[1], f), tx: 1, tz: 0, nx: 0, nz: 1, curv: 0, cross: false });
    }
    const at = (i) => S[((i % N) + N) % N];
    for (let i = 0; i < N; i++) {
      const a = at(i - 1), b = at(i + 1), l = Math.hypot(b.x - a.x, b.z - a.z) || 1, s = S[i];
      s.tx = (b.x - a.x) / l; s.tz = (b.z - a.z) / l; s.nx = -s.tz; s.nz = s.tx;
    }
    for (let i = 0; i < N; i++) {
      const a = at(i - 4), b = at(i + 4);
      S[i].curv = Math.asin(clamp(a.tx * b.tz - a.tz * b.tx, -1, 1)) / (8 * segLen);
    }
    // where the road crosses itself (figure eight): the view leaves out curbs there
    const far = Math.round(40 / segLen), reach = (ROAD_W + 1) * (ROAD_W + 1);
    for (let i = 0; i < N; i++) for (let j = i + far; j < N; j++) {
      if (N - (j - i) < far) continue;
      const dx = S[i].x - S[j].x, dz = S[i].z - S[j].z;
      if (dx * dx + dz * dz < reach) { S[i].cross = true; S[j].cross = true; }
    }
    const track = { samples: S, N, len, segLen, pts };
    // distance from a point to the centre line (whole track; for placing things, not per frame)
    track.dist = function (x, z) {
      let best = 1e18;
      for (let i = 0; i < N; i++) { const dx = S[i].x - x, dz = S[i].z - z, d = dx * dx + dz * dz; if (d < best) best = d; }
      return Math.sqrt(best);
    };
    return track;
  }

  // ---- one match: heats until somebody reaches the target ----
  // o = { pts | track, ids, seed, target, items (default on), grip (biome factor), lava (pools) }
  function create(o) {
    const rng = mulberry32((o.seed >>> 0) || 1);
    const track = o.track || buildTrack(o.pts);
    const S = track.samples, N = track.N, segLen = track.segLen;
    const mod = (i) => ((i % N) + N) % N;
    const ringDist = (a, b) => { const d = Math.abs(a - b) % N; return Math.min(d, N - d); };
    const gripMul = o.grip || 1, itemsOn = o.items !== false;
    const out = [];                    // events since the last step()
    let rocketNo = 0, dropNo = 0, countN = 0;

    const st = {
      time: 0, phase: 'idle', phaseAt: 0, raceAt: 0, heat: 0, tempo: 1,
      order: o.ids.slice(), points: {}, target: o.target || 5,
      racers: {}, elimOrder: [], heatWinner: null, champion: null,
      features: [], boxes: [], lava: [], drops: [], rockets: [],
      cam: { x: 0, y: 0, z: 0, ax: 0, ay: 0, az: 0, zoom: 0, set: false }
    };
    st.order.forEach(id => { st.points[id] = 0; });
    const cam = st.cam;
    let cb = null;                     // camera basis for project()

    // ---------- track furniture (once per match) ----------
    function layout() {
      const span = Math.round(20 / segLen);
      // how far the road turns away within the next k samples (0 = dead straight)
      const bend = (i, k) => {
        let worst = 0;
        for (let j = 4; j <= k; j += 4) worst = Math.max(worst, 1 - (S[i].tx * S[mod(i + j)].tx + S[i].tz * S[mod(i + j)].tz));
        return worst;
      };
      const nearCross = (i) => { for (let k = -10; k <= 10; k++) if (S[mod(i + k)].cross) return true; return false; };
      const cand = [], taken = [];
      for (let i = Math.round(45 / segLen); i < N - Math.round(40 / segLen); i += 5) if (!nearCross(i)) cand.push(i);
      for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
      // n spots, as straight as possible: try each bend limit in turn
      function want(n, limits, lookK, fn) {
        for (let k = 0; k < n; k++) {
          let hit;
          for (const lim of limits) {
            hit = cand.find(i => bend(i, span * lookK) < lim && taken.every(j => ringDist(i, j) * segLen > FEATURE_GAP));
            if (hit !== undefined) break;
          }
          if (hit === undefined) return;
          taken.push(hit);
          fn(hit, S[hit]);
        }
      }
      const feat = (kind, i, s, lat, halfW) => st.features.push({
        kind, idx: i, lat, halfW, x: s.x + s.nx * lat, z: s.z + s.nz * lat, heading: Math.atan2(s.tz, s.tx) });
      want(RAMPS, [0.004, 0.012], 2, (i, s) => feat('ramp', i, s, (rng() < 0.5 ? 1 : -1) * ROAD_W / 4, ROAD_W / 4 - 0.3));
      want(PADS, [0.005, 0.03, 0.1], 1, (i, s) => feat('boost', i, s, (rng() * 2 - 1) * 2, 1.6));
      if (itemsOn) want(BOX_ROWS, [0.01, 0.06, 0.25], 1, (i, s) => BOX_LATS.forEach(lat => st.boxes.push({
        n: st.boxes.length, idx: i, lat, x: s.x + s.nx * lat, z: s.z + s.nz * lat, readyAt: 0 })));
      want(OILS, [0.005, 0.03, 0.1], 1, (i, s) => feat('oil', i, s, (rng() * 2 - 1) * 2.4, 1.9));

      // lava pools sit just off the road, on the outside of bends where cars slide wide
      for (let k = 0, tries = 0; k < (o.lava || 0) && tries < 400; tries++) {
        const i = 60 + Math.floor(rng() * (N - 90)), s = S[i], r = 3.2 + rng() * 2.2;
        const side = Math.abs(s.curv) > 0.004 ? -Math.sign(s.curv) : (rng() < 0.5 ? 1 : -1);
        const off = ROAD_W / 2 + 1.6 + r, x = s.x + s.nx * side * off, z = s.z + s.nz * side * off;
        if (track.dist(x, z) < off - 0.4) continue;                                   // would reach another piece of road
        if (st.lava.some(l => Math.hypot(l.x - x, l.z - z) < l.r + r + 30)) continue;
        st.lava.push({ x, z, r }); k++;
      }
    }

    // ---------- racers ----------
    function spawn() {
      st.racers = {};
      // the grid: fewest points in front (first heat: by lot)
      const grid = st.order.slice();
      for (let i = grid.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = grid[i]; grid[i] = grid[j]; grid[j] = t; }
      grid.sort((a, b) => st.points[a] - st.points[b]);
      grid.forEach((id, i) => {
        const row = i >> 1, side = i % 2 === 0 ? 1 : -1;
        const si = mod(N - 4 - Math.round(row * GRID_GAP / segLen)), s = S[si];
        st.racers[id] = {
          id, x: s.x + s.nx * side * GRID_SIDE, z: s.z + s.nz * side * GRID_SIDE, y: 0, vy: 0,
          heading: Math.atan2(s.tz, s.tx), speed: 0, vx: 0, vz: 0, steer: 0, brake: false,
          idx: si, lap: -1, progress: si - N, alive: true, offroad: false, draft: 0,
          vis: true, offMs: 0, sx: 0, sy: 0, behind: 0,
          nitroUntil: 0, nitroReadyAt: 0, boostUntil: 0, oilUntil: 0, spinUntil: 0,
          shieldUntil: 0, slowUntil: 0, magnetUntil: 0, magnetTo: null, item: null
        };
      });
      st.boxes.forEach(b => { b.readyAt = 0; });
      st.drops = []; st.rockets = [];
    }

    const alive = () => st.order.filter(id => st.racers[id] && st.racers[id].alive);
    function standings() {
      return st.order.filter(id => st.racers[id]).sort((a, b) =>
        (st.racers[b].alive - st.racers[a].alive) || (st.racers[b].progress - st.racers[a].progress));
    }
    function leader() {
      let best = null;
      for (const id of st.order) { const r = st.racers[id]; if (r && r.alive && (!best || r.progress > best.progress)) best = r; }
      return best;
    }
    // the next car in front on the track (not necessarily in sight)
    function ahead(r) {
      let best = null;
      for (const id of st.order) {
        const q = st.racers[id];
        if (q && q.alive && q !== r && q.progress > r.progress && (!best || q.progress < best.progress)) best = q;
      }
      return best;
    }

    // where on the track a car is: the closest sample near its last one. Far out in the landscape
    // the position is kept, or a lost car would rake in "progress" from the edge of the search window.
    function nearest(idx, x, z) {
      let best = idx, bestD = Infinity;
      for (let k = -30; k <= 45; k++) {
        const i = mod(idx + k), dx = S[i].x - x, dz = S[i].z - z, d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      return bestD > LOST * LOST ? idx : best;
    }

    function updateRacer(r, dt, lead) {
      const t = st.time, prevIdx = r.idx;
      r.idx = nearest(r.idx, r.x, r.z);
      const s = S[r.idx];
      r.offroad = Math.hypot(r.x - s.x, r.z - s.z) > ROAD_W / 2 + 0.9;

      if (r.y > 0) {
        // in the air: no steering, no grip, just ballistics until the landing
        r.vy -= GRAVITY * dt; r.y += r.vy * dt;
        r.x += r.vx * dt; r.z += r.vz * dt;
        if (r.y <= 0) { r.y = 0; r.vy = 0; out.push({ t: 'land', id: r.id }); }
      } else {
        const spin = t < r.spinUntil, slippery = t < r.oilUntil;
        // target speed: the throttle is always open, everything else is a factor
        let target = MAX_SPEED * st.tempo * (1 + DRAFT_BONUS * r.draft
          + (lead ? CATCHUP * clamp((lead.progress - r.progress) * segLen / CATCHUP_DIST, 0, 1) : 0));
        if (r.offroad) target *= OFFROAD_FACTOR;
        if (spin) target *= SPIN_FACTOR;
        else if (r.brake) target *= BRAKE_FACTOR;                 // a brake is a brake, nitro or not
        else if (t < r.nitroUntil || t < r.boostUntil) target *= NITRO_BOOST;
        else if (t < r.magnetUntil) target *= MAGNET_BOOST;
        if (t < r.slowUntil) target *= BOLT_FACTOR;
        r.speed += clamp(target - r.speed, -((spin || r.brake) ? BRAKE_DECEL : ACCEL * 1.4) * dt, ACCEL * dt);

        // steering: slower means a tighter circle, so braking before a hairpin pays off
        const f = Math.sqrt(clamp(r.speed / MAX_SPEED, 0.25, 1));
        r.heading += (spin ? 0 : r.steer) * TURN * dt * f * (slippery ? 1.6 : 1);
        const k = Math.min(1, ((slippery || spin) ? 1.1 : GRIP * gripMul) * dt);
        r.vx += (Math.cos(r.heading) * r.speed - r.vx) * k;
        r.vz += (Math.sin(r.heading) * r.speed - r.vz) * k;
        r.x += r.vx * dt; r.z += r.vz * dt;

        // what is painted on the road here
        const lat = (r.x - s.x) * s.nx + (r.z - s.z) * s.nz;
        for (const ft of st.features) {
          if (ringDist(r.idx, ft.idx) > 3 || Math.abs(lat - ft.lat) > ft.halfW) continue;
          if (ft.kind === 'boost') { if (t >= r.boostUntil) out.push({ t: 'pad', id: r.id }); r.boostUntil = t + PAD_MS; }
          else if (ft.kind === 'oil') { if (t >= r.shieldUntil) slip(r); }
          else if (ft.kind === 'ramp' && r.speed > 9) { r.vy = 9.5 + r.speed * 0.16; r.y = 0.05; out.push({ t: 'jump', id: r.id }); }
        }
      }

      const before = r.lap;
      if (prevIdx > N - 60 && r.idx < 60) r.lap++;
      else if (prevIdx < 60 && r.idx > N - 60) r.lap--;
      if (r.lap > before && r.lap > 0) out.push({ t: 'lap', id: r.id, lap: r.lap });
      r.progress = r.lap * N + r.idx;
    }

    function slip(r) {
      if (st.time >= r.oilUntil) out.push({ t: 'slip', id: r.id });
      r.oilUntil = st.time + OIL_MS;
    }
    function spinOut(r, by) {
      r.spinUntil = st.time + SPIN_MS; r.speed *= SPIN_KEEP;
      out.push({ t: 'spin', id: r.id, by });
    }

    function collide() {
      const ids = alive();
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        const A = st.racers[ids[a]], B = st.racers[ids[b]];
        if (Math.abs(A.y - B.y) > 1.2) continue;      // one of them is jumping over the other
        const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz) || 0.01;
        if (d >= CAR_R * 2) continue;
        const nx = dx / d, nz = dz / d, push = (CAR_R * 2 - d) / 2;
        A.x -= nx * push; A.z -= nz * push; B.x += nx * push; B.z += nz * push;
        const av = A.vx * nx + A.vz * nz, bv = B.vx * nx + B.vz * nz, kick = (bv - av) * 0.7;
        A.vx += kick * nx; A.vz += kick * nz; B.vx -= kick * nx; B.vz -= kick * nz;
        if (Math.abs(bv - av) > 5) out.push({ t: 'bump', a: A.id, b: B.id });
      }
    }

    function slipstream(dt) {
      const ids = alive();
      for (const id of ids) {
        const r = st.racers[id], cx = Math.cos(r.heading), cz = Math.sin(r.heading);
        let on = false;
        for (const od of ids) {
          if (od === id) continue;
          const q = st.racers[od], dx = q.x - r.x, dz = q.z - r.z;
          const fwd = dx * cx + dz * cz, side = dz * cx - dx * cz;
          if (fwd > DRAFT_MIN && fwd < DRAFT_MAX && Math.abs(side) < DRAFT_SIDE && q.speed > 10) { on = true; break; }
        }
        r.draft = clamp(r.draft + (on ? dt / 0.5 : -dt / 0.4), 0, 1);
      }
    }

    // ---------- items ----------
    function roll(r) {
      const st_ = standings().filter(id => st.racers[id].alive), place = st_.indexOf(r.id);
      const w = WEIGHTS[place === 0 ? 'lead' : place === st_.length - 1 ? 'last' : 'mid'];
      let sum = 0; for (const k in w) sum += w[k];
      let x = rng() * sum;
      for (const k in w) { x -= w[k]; if (x < 0) return k; }
      return 'shield';
    }

    function updateItems(dt) {
      const t = st.time, ids = alive();
      for (const id of ids) {
        const r = st.racers[id];
        if (r.y > 1) continue;
        for (const b of st.boxes) {
          if (t < b.readyAt || Math.hypot(b.x - r.x, b.z - r.z) > BOX_R) continue;
          b.readyAt = t + BOX_RESPAWN_MS;
          if (!r.item) { r.item = roll(r); out.push({ t: 'pickup', id, item: r.item, box: b.n }); }
          else out.push({ t: 'box', id, box: b.n });
        }
        for (const l of st.lava) if (r.y <= 0 && Math.hypot(l.x - r.x, l.z - r.z) < l.r) { eliminate(r, 'lava'); break; }
      }
      st.drops = st.drops.filter(d => {
        if (t >= d.until) return false;
        if (t < d.armAt) return true;
        for (const id of ids) {
          const r = st.racers[id];
          if (!r.alive || r.y > 0 || Math.hypot(d.x - r.x, d.z - r.z) > DROP_R) continue;
          if (t < r.shieldUntil) out.push({ t: 'block', id }); else slip(r);
          return false;
        }
        return true;
      });
      st.rockets = st.rockets.filter(k => {
        if (t >= k.until) { out.push({ t: 'fizz', x: k.x, z: k.z }); return false; }
        const tg = st.racers[k.target];
        let ax, az;
        if (tg && tg.alive) { ax = tg.x; az = tg.z; }
        else { k.idx = nearest(k.idx, k.x, k.z); const s = S[mod(k.idx + Math.round(10 / segLen))]; ax = s.x; az = s.z; }
        let diff = Math.atan2(az - k.z, ax - k.x) - k.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        k.heading += clamp(diff, -ROCKET_TURN * dt, ROCKET_TURN * dt);
        k.x += Math.cos(k.heading) * ROCKET_SPEED * dt; k.z += Math.sin(k.heading) * ROCKET_SPEED * dt;
        for (const id of ids) {
          const r = st.racers[id];
          if (id === k.owner || !r.alive || r.y > 2 || Math.hypot(k.x - r.x, k.z - r.z) > ROCKET_R) continue;
          if (t < r.shieldUntil) out.push({ t: 'block', id }); else spinOut(r, k.owner);
          out.push({ t: 'boom', x: k.x, z: k.z });
          return false;
        }
        return true;
      });
    }

    function useItem(id) {
      const r = st.racers[id], t = st.time;
      if (!r || !r.alive || !r.item || st.phase !== 'race') return null;
      const kind = r.item, cx = Math.cos(r.heading), cz = Math.sin(r.heading);
      r.item = null;
      if (kind === 'rocket') {
        const tg = ahead(r);
        st.rockets.push({ n: ++rocketNo, x: r.x + cx * 2.4, z: r.z + cz * 2.4, heading: r.heading, idx: r.idx,
          owner: id, target: tg ? tg.id : null, until: t + ROCKET_MS });
      } else if (kind === 'oil') {
        st.drops.push({ n: ++dropNo, x: r.x - cx * 3, z: r.z - cz * 3, owner: id, armAt: t + DROP_ARM_MS, until: t + DROP_MS });
      } else if (kind === 'shield') {
        r.shieldUntil = t + SHIELD_MS;
      } else if (kind === 'bolt') {
        for (const od of alive()) {
          const q = st.racers[od];
          if (od === id) continue;
          if (t < q.shieldUntil) out.push({ t: 'block', id: od }); else q.slowUntil = t + BOLT_MS;
        }
      } else if (kind === 'magnet') {
        const tg = ahead(r);
        r.magnetUntil = t + MAGNET_MS; r.magnetTo = tg ? tg.id : null;
      }
      out.push({ t: 'use', id, item: kind });
      return kind;
    }

    function nitro(id) {
      const r = st.racers[id];
      if (!r || !r.alive || st.phase !== 'race' || st.time < r.nitroReadyAt) return false;
      r.nitroUntil = st.time + NITRO_MS; r.nitroReadyAt = st.time + NITRO_CD;
      out.push({ t: 'nitro', id });
      return true;
    }

    // ---------- camera: behind the leader, opens up a little when the field stretches ----------
    function updateCamera(dt) {
      const lead = leader(), i = lead ? lead.idx : 0, s = S[i];
      let spread = 0;
      if (lead) for (const id of st.order) { const r = st.racers[id]; if (r && r.alive) spread = Math.max(spread, Math.min(ZOOM_TO, r.behind)); }
      const zt = clamp((spread - ZOOM_FROM) / (ZOOM_TO - ZOOM_FROM), 0, 1);
      cam.zoom = cam.set ? cam.zoom + (zt - cam.zoom) * Math.min(1, dt * ZOOM_RATE) : zt;
      const back = lerp(CAM_NEAR.back, CAM_FAR.back, cam.zoom), h = lerp(CAM_NEAR.h, CAM_FAR.h, cam.zoom);
      const a = S[mod(i + Math.round(lerp(CAM_NEAR.ahead, CAM_FAR.ahead, cam.zoom) / segLen))];
      const px = (lead ? lead.x : s.x) - s.tx * back, pz = (lead ? lead.z : s.z) - s.tz * back;
      const kp = cam.set ? Math.min(1, dt * CAM_POS_RATE) : 1, ka = cam.set ? Math.min(1, dt * CAM_AIM_RATE) : 1;
      cam.x += (px - cam.x) * kp; cam.y += (h - cam.y) * kp; cam.z += (pz - cam.z) * kp;
      cam.ax += (a.x - cam.ax) * ka; cam.ay += (1.5 - cam.ay) * ka; cam.az += (a.z - cam.az) * ka;
      cam.set = true;
      // basis for project(): forward, right, up
      let fx = cam.ax - cam.x, fy = cam.ay - cam.y, fz = cam.az - cam.z;
      const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;          // forward × world-up
      cb = { fx, fy, fz, rx, rz, ux: -rz * fy, uy: rz * fx - rx * fz, uz: rx * fy };          // right × forward
    }

    // world → picture: x, y in -1..1 (y up), d = metres in front of the camera, ok = in front of it at all
    function project(x, y, z) {
      if (!cb) return { x: 0, y: 0, d: 0, ok: false };
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
      const d = dx * cb.fx + dy * cb.fy + dz * cb.fz;
      if (d < 0.5) return { x: dx * cb.rx + dz * cb.rz < 0 ? -2 : 2, y: -2, d, ok: false };
      return { x: (dx * cb.rx + dz * cb.rz) / (d * TAN_HALF * ASPECT), y: (dx * cb.ux + dy * cb.uy + dz * cb.uz) / (d * TAN_HALF), d, ok: true };
    }

    // metres behind the leader, along the track
    function measure() {
      const lead = leader();
      if (lead) for (const id of alive()) { const r = st.racers[id]; r.behind = Math.max(0, (lead.progress - r.progress) * segLen); }
    }

    // ---------- out of the picture → out ----------
    function updateVisibility(dt) {
      const lead = leader();
      if (!lead) return;
      const safe = st.time - st.raceAt < START_SAFE_MS;
      for (const id of alive()) {
        const r = st.racers[id];
        const p = project(r.x, r.y + 0.6, r.z);
        r.sx = p.x; r.sy = p.y;
        r.vis = r === lead || (p.ok && Math.abs(p.x) <= EDGE_X && p.y >= EDGE_BOTTOM && p.y <= EDGE_TOP && p.d <= MAX_VIEW && r.behind <= MAX_BEHIND);
        if (r.vis || st.phase !== 'race') { if (r.offMs) out.push({ t: 'safe', id }); r.offMs = 0; continue; }
        if (safe) continue;
        if (!r.offMs) out.push({ t: 'danger', id });
        r.offMs += dt * 1000;
        if (r.offMs >= OFF_MS) eliminate(r, 'lost');
      }
    }

    // ---------- heats ----------
    function eliminate(r, why) {
      if (!r.alive || st.phase !== 'race') return;
      r.alive = false; r.offMs = 0; r.item = null;
      st.elimOrder.push(r.id);
      out.push({ t: 'out', id: r.id, why, x: r.x, z: r.z });
      const left = alive();
      if (left.length <= 1) endHeat(left.length ? left[0] : null);
    }

    function endHeat(winner) {
      st.phase = 'heatOver'; st.phaseAt = st.time + HEAT_OVER_MS; st.heatWinner = winner;
      // points by how long you lasted: first one out 0, the survivor n-1
      const ranking = st.elimOrder.slice();
      if (winner !== null) ranking.push(winner);
      ranking.forEach((id, i) => { if (st.points[id] !== undefined) st.points[id] += i; });
      out.push({ t: 'heatEnd', winner });
    }

    function newHeat() {
      st.heat++; st.elimOrder = []; st.heatWinner = null; st.tempo = 1;
      spawn();
      st.phase = 'countdown'; st.phaseAt = st.time + COUNTDOWN_MS; countN = 0;
      cam.set = false;
      measure(); updateCamera(0); updateVisibility(0);
      out.push({ t: 'heat', heat: st.heat });
    }

    function afterHeat() {
      const best = Math.max.apply(null, st.order.map(id => st.points[id] || 0));
      const top = st.order.filter(id => (st.points[id] || 0) === best);
      if (best >= st.target && top.length === 1) {
        st.phase = 'final'; st.champion = top[0];
        out.push({ t: 'final', champion: top[0] });
      } else newHeat();
    }

    function step(dt) {
      st.time += dt * 1000;
      const t = st.time;
      if (st.phase === 'countdown') {
        const n = Math.ceil((st.phaseAt - t) / 1000);
        if (n !== countN && n > 0 && n <= 3) { countN = n; out.push({ t: 'count', n }); }
        if (t >= st.phaseAt) { st.phase = 'race'; st.raceAt = t; out.push({ t: 'go' }); }
      } else if (st.phase === 'race') {
        st.tempo = 1 + clamp((t - st.raceAt - TEMPO_AFTER_MS) / 1000 * TEMPO_PER_S, 0, TEMPO_MAX);
        const lead = leader();
        for (const id of alive()) updateRacer(st.racers[id], dt, lead);
        collide();
        slipstream(dt);
        updateItems(dt);
      } else if (st.phase === 'heatOver') {
        for (const id of alive()) updateRacer(st.racers[id], dt, null);   // the winner rolls on through the picture
        if (t >= st.phaseAt) afterHeat();
      }
      if (st.phase !== 'idle') { measure(); updateCamera(dt); updateVisibility(dt); }
      return out.splice(0);
    }

    const sim = { state: st, track, step, project, standings, alive, leader, useItem, nitro };

    sim.start = function () { layout(); st.heat = 0; newHeat(); return out.splice(0); };

    // phone input: s = steering -1..1, b = both buttons held (brake)
    sim.input = function (id, s, b) {
      const r = st.racers[id];
      if (!r || !r.alive) return;
      r.steer = clamp(+s || 0, -1, 1); r.brake = !!b;
    };

    // a player left: false = fewer than two remain, the match cannot go on
    sim.remove = function (id) {
      const r = st.racers[id];
      st.order = st.order.filter(x => x !== id);
      st.elimOrder = st.elimOrder.filter(x => x !== id);
      delete st.racers[id]; delete st.points[id];
      st.rockets.forEach(k => { if (k.target === id) k.target = null; });
      if (st.order.length < 2) return false;
      if (st.phase === 'race' && r && r.alive) { const left = alive(); if (left.length <= 1) endHeat(left.length ? left[0] : null); }
      return true;
    };

    sim.rematch = function () {
      if (st.phase !== 'final') return false;
      st.order.forEach(id => { st.points[id] = 0; });
      st.champion = null; st.heat = 0;
      newHeat();
      return true;
    };

    return sim;
  }

  // A simple driver for the dev page and the tests: aim at the road ahead, brake when the bend is too tight.
  // → { s, b } for sim.input(). o = { look, lane, gain, brake:false }
  function autoSteer(sim, id, o) {
    const r = sim.state.racers[id], S = sim.track.samples, N = sim.track.N, segLen = sim.track.segLen;
    if (!r || !r.alive) return { s: 0, b: false };
    const look = (o && o.look) || 14, lane = (o && o.lane) || 0, gain = (o && o.gain) || 3;
    const at = (m) => S[((r.idx + Math.round(m / segLen)) % N + N) % N];
    const s = at(look);
    let diff = Math.atan2(s.z + s.nz * lane - r.z, s.x + s.nx * lane - r.x) - r.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    let curv = 0;
    for (let m = 6; m <= 22; m += 4) curv = Math.max(curv, Math.abs(at(m).curv));
    const b = !(o && o.brake === false) && r.speed > MAX_SPEED * 0.5 && curv * r.speed > TURN * 0.95;
    return { s: b ? 0 : clamp(diff * gain, -1, 1), b };
  }

  const api = {
    CONST: { ROAD_W, CAR_R, MAX_SPEED, FOV, ASPECT, OFF_MS, START_SAFE_MS, MAX_BEHIND, MAX_VIEW, NITRO_MS, NITRO_CD, COUNTDOWN_MS,
      HEAT_OVER_MS, SPIN_MS, SHIELD_MS, BOLT_MS, MAGNET_MS, BOX_RESPAWN_MS, DROP_MS, OIL_MS, BRAKE_FACTOR, ROCKET_MS, ITEMS },
    buildTrack, create, autoSteer, mulberry32
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RacerSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
