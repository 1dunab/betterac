// ===== Neonspur simulation: rules, collisions, bots (deterministic, see docs/NEONSPUR.md) =====
(function (root) {
  // ---- tunables ----
  const TRAIL_H = 0.8, JUMP_H = 1.6, JUMP_LEN = 4, JUMP_CD_MS = 2500, WALL_H = 3;
  const TEMPO = {
    chill: { start: 5.5, accel: 0.06, max: 9 },
    normal: { start: 7, accel: 0.10, max: 12 },
    fast: { start: 9, accel: 0.14, max: 15 }
  };
  const BOOST_GAIN = 0.04, BOOST_USE = 0.07, ITEM_EVERY_MS = 6000, ITEM_MAX = 3, BLAST_R = 3, ITEM_MIN_DIST = 4;
  const ITEM_KINDS = ['boost', 'jump', 'shield', 'blast'];
  const QUEUE_MAX = 2;
  // bots
  const FLOOD_CAP = { normal: 160, hard: 240 };
  const STRAIGHT_BONUS = 3, TIE_NOISE = 2, WIGGLE_P = 0.04, WIGGLE_BONUS = 8;
  const DEAD_END = 20, JUMP_MARGIN = 15, HARD_JUMP_MUL = 1.6, HARD_JUMP_ADD = 25;
  const HEAD_PENALTY = 60, CUT_W = 0.5, CUT_AHEAD = 4, TERRACE_JUMP_P = 0.4;
  const EASY_LOOK = 2, EASY_LATE_P = 0.5, EASY_WIGGLE_P = 0.1;
  const NORMAL_LATE_P = 0.45, ITEM_W = { normal: 6, hard: 10 }, ITEM_R = { normal: 5, hard: 12 };

  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const altAt = (base, k) => base + JUMP_H * 4 * (k / JUMP_LEN) * (1 - k / JUMP_LEN);

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---- map ----
  function parseMap(def) {
    const rows = def.rows, h = rows.length, w = rows[0].length, n = w * h;
    const map = { key: def.key, label: def.label, w, h, theme: def.theme,
      floor: new Float32Array(n), wall: new Uint8Array(n), rampDir: new Int8Array(n).fill(-1),
      pad: new Uint8Array(n), spawns: (def.spawns || []).map(s => ({ x: s.x, y: s.y, dir: s.dir })) };
    for (let y = 0; y < h; y++) {
      if (rows[y].length !== w) throw new Error('row ' + y + ' has wrong length');
      for (let x = 0; x < w; x++) {
        const c = rows[y][x], i = y * w + x;
        if (c === '.') continue;
        else if (c === '#') map.wall[i] = 1;
        else if (c === '=') map.floor[i] = 1;
        else if (c === '*') map.pad[i] = 1;
        else if (c === '+') { map.pad[i] = 1; map.floor[i] = 1; }
        else if (c === '>' || c === 'v' || c === '<' || c === '^') { map.floor[i] = 0.5; map.rampDir[i] = '>v<^'.indexOf(c); }
        else throw new Error('unknown map char "' + c + '" at ' + x + ',' + y);
      }
    }
    return map;
  }

  // Outcome of one move (pure). s = { x, y, alt, air, k, base }; self = rider index.
  // → { ok:false, by, x, y, alt } | { ok:true, x, y, alt, air, k, base, land?, drop? }
  function resolve(m, W, s, dir, takeoff, self) {
    const nx = s.x + DX[dir], ny = s.y + DY[dir];
    let air = s.air, k = s.k, base = s.base;
    if (takeoff && !air) { air = true; k = 0; base = m.floor[s.y * m.w + s.x]; }
    if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) return { ok: false, by: 'edge', x: nx, y: ny, alt: air ? altAt(base, k + 1) : s.alt };
    const i = ny * m.w + nx, f = m.floor[i], owner = W.owner[i];
    const fail = (by, a, light) => ({ ok: false, by, x: nx, y: ny, alt: a, light: !!light, cell: i });
    const wallBy = () => owner === self ? 'self' : W.pids[owner];
    if (!air) {
      if (m.wall[i]) return fail('wall', s.alt);
      const ci = s.y * m.w + s.x, fa = m.floor[ci], df = f - fa;
      if (df > 0.5) return fail('wall', fa);
      const rc = m.rampDir[ci], rn = m.rampDir[i];
      if ((rc >= 0 && rc % 2 !== dir % 2) || (rn >= 0 && rn % 2 !== dir % 2)) return fail('wall', fa);
      if (owner >= 0) return fail(wallBy(), f, true);
      return { ok: true, x: nx, y: ny, alt: f, air: false, k: 0, base: f, drop: df <= -1 };
    }
    k++;
    const a = altAt(base, k);
    if (m.wall[i]) return fail('wall', Math.max(a, 0));
    if (owner >= 0 && a < f + TRAIL_H) return fail(wallBy(), Math.max(a, 0), true);
    if (a <= f) {
      if (altAt(base, k - 1) < f - 0.01) return fail('wall', Math.max(a, 0));
      const rn = m.rampDir[i];
      if (rn >= 0 && rn % 2 !== dir % 2) return fail('wall', f);
      return { ok: true, x: nx, y: ny, alt: f, air: false, k: 0, base: f, land: true };
    }
    return { ok: true, x: nx, y: ny, alt: a, air: true, k, base };
  }

  // Simulate a flight straight in `dir` (first move may take off) until landing/crash.
  function flight(m, W, s, dir, takeoff, self) {
    const cells = [];
    let cur = s, tk = takeoff;
    for (let n = 0; n < 12; n++) {
      const res = resolve(m, W, cur, dir, tk, self);
      tk = false;
      if (!res.ok) return { ok: false, landed: false, cells, by: res.by };
      cells.push({ x: res.x, y: res.y, alt: res.alt });
      if (!res.air) return { ok: true, landed: true, cells, end: res };
      cur = res;
    }
    return { ok: false, landed: false, cells, by: 'long' };
  }

  function create(opts) {
    const map = opts.map, tempo = TEMPO[opts.tempo] || TEMPO.normal, rnd = mulberry32((opts.seed | 0) || 1);
    const irnd = mulberry32((((opts.seed | 0) || 1) * 7919 + 13) | 0);   // items: independent of bot choices
    const extras = opts.extras !== false;
    const n = map.w * map.h;
    const W = { owner: new Int16Array(n).fill(-1), pids: [], seen: new Int32Array(n), q: new Int32Array(n), stamp: 0 };
    const rs = [], ints = [];
    const state = { map, tick: 0, time: 0, speed: tempo.start, over: false, winner: null, riders: rs, items: [], extras };
    const sim = { state, tickMs: 1000 / (tempo.start * 2) };
    let nextItemAt = ITEM_EVERY_MS, itemId = 0;

    (opts.riders || []).slice(0, map.spawns.length).forEach((cfg, slot) => {
      const sp = map.spawns[slot], f = map.floor[sp.y * map.w + sp.x];
      rs.push({ pid: cfg.pid, slot, bot: !!cfg.bot, level: cfg.botLevel || 'normal', alive: true,
        x: sp.x, y: sp.y, dir: sp.dir, alt: f, px: sp.x, py: sp.y, pdir: sp.dir, palt: f,
        air: false, jumpReadyAt: 0, trail: [[sp.x, sp.y, f, 1]], deadAt: null, killer: null,
        mp: 2, ms: 0, boost: 0, boosting: false, grind: 0, shield: false, trailRev: 0 });
      ints.push({ queue: [], jumpReq: false, padJump: false, k: 0, base: f, held: false });
      W.pids.push(cfg.pid);
      W.owner[sp.y * map.w + sp.x] = slot;
    });

    const sOf = (i) => ({ x: rs[i].x, y: rs[i].y, alt: rs[i].alt, air: rs[i].air, k: ints[i].k, base: ints[i].base });
    const isHead = (o, x, y) => rs[o].alive && !rs[o].air && rs[o].x === x && rs[o].y === y;

    // bounded flood fill over drivable neighbours (ramp axis ignored: cheap estimate)
    function flood(sx, sy, cap) {
      const m = map, w = m.w, st = ++W.stamp, q = W.q, seen = W.seen;
      let h = 0, t = 0;
      const i0 = sy * w + sx;
      seen[i0] = st; q[t++] = i0;
      while (h < t && t < cap) {
        const i = q[h++], x = i % w, y = (i - x) / w;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= w || ny >= m.h) continue;
          const j = ny * w + nx;
          if (seen[j] === st || m.wall[j] || W.owner[j] >= 0 || m.floor[j] - m.floor[i] > 0.5) continue;
          seen[j] = st; q[t++] = j;
        }
      }
      return t;
    }

    // ---- bots ----
    // easy: short sight, often reacts late, wanders; never boosts, jumps or fetches items
    function thinkEasy(i) {
      const r = rs[i], it = ints[i], s = sOf(i);
      if (r.air || it.padJump) return;
      const L = (r.dir + 3) % 4, R = (r.dir + 1) % 4;
      const run = (d) => { let c = s, k = 0; for (; k < EASY_LOOK; k++) { const q = resolve(map, W, c, d, false, i); if (!q.ok) break; c = q; } return k; };
      const a = run(r.dir);
      if (a >= EASY_LOOK) {
        if (rnd() < EASY_WIGGLE_P) { const side = rnd() < 0.5 ? 'L' : 'R'; if (run(side === 'L' ? L : R) >= 1) it.queue.push(side); }
        return;
      }
      if (rnd() < EASY_LATE_P) return;   // reacts a move late
      const l = run(L), rr = run(R);
      if (l === 0 && rr === 0) return;
      it.queue.push(l === 0 ? 'R' : rr === 0 ? 'L' : (rnd() < 0.5 ? 'L' : 'R'));
    }

    // item pull: bonus for a candidate cell that gets closer to a wanted item
    function itemPull(r, res, level, bestG, cap) {
      let v = 0;
      const rad = ITEM_R[level], W0 = ITEM_W[level];
      for (const t of state.items) {
        if (Math.abs(t.h - r.alt) > 0.5 && !r.air) continue;
        const d0 = Math.abs(t.x - r.x) + Math.abs(t.y - r.y);
        if (d0 > rad) continue;
        const d1 = Math.abs(t.x - res.x) + Math.abs(t.y - res.y);
        let w = W0;
        if (t.kind === 'jump') w *= 0.5;
        if (t.kind === 'blast' && level === 'hard' && bestG < cap * 0.5) w *= 3;   // boxed in: blast frees space
        if (d1 < d0) v += w; else if (d1 > d0) v -= w * 0.3;
      }
      return v;
    }

    function think(i) {
      const r = rs[i], it = ints[i], m = map;
      it.queue.length = 0; it.jumpReq = false;
      if (r.level === 'easy') return thinkEasy(i);
      const hard = r.level === 'hard', level = hard ? 'hard' : 'normal', cap = FLOOD_CAP[level];
      const s = sOf(i), dirs = [r.dir, (r.dir + 1) % 4, (r.dir + 3) % 4], cmds = [null, 'R', 'L'];
      const push = (j) => { if (cmds[j]) it.queue.push(cmds[j]); };
      const landScore = (f) => f.landed ? flood(f.end.x, f.end.y, cap) : -1;
      it.held = false;

      if (r.air || it.padJump) {   // steer an ongoing / forced flight towards the best landing
        let best = -1e9, bj = 0;
        for (let j = 0; j < 3; j++) {
          const f = flight(m, W, s, dirs[j], !r.air, i);
          const v = (f.landed ? landScore(f) : -100) + (j === 0 ? 4 : 0) + rnd() * TIE_NOISE;
          if (v > best) { best = v; bj = j; }
        }
        return push(bj);
      }

      // hard: cells next to other riders' heads are risky; cutting bonus targets the nearest enemy
      let heads = null, aim = null;
      if (hard) {
        let bd = 1e9;
        for (let o = 0; o < rs.length; o++) {
          if (o === i || !rs[o].alive) continue;
          (heads || (heads = [])).push(rs[o]);
          const d = Math.abs(rs[o].x - r.x) + Math.abs(rs[o].y - r.y);
          if (d < bd) { bd = d; aim = rs[o]; }
        }
      }
      const wiggle = rnd() < WIGGLE_P ? 1 + (rnd() < 0.5 ? 1 : 0) : 0;
      const fl = [-1, -1, -1], rr = [null, null, null];
      let bestG = -1, bj = 0, rawBest = -1;
      // normal bots now and then notice a light wall straight ahead too late (architecture they always see)
      if (!hard && rnd() < NORMAL_LATE_P) { const ahead = resolve(m, W, s, dirs[0], false, i); if (!ahead.ok && ahead.light) return; }
      for (let j = 0; j < 3; j++) {
        const res = resolve(m, W, s, dirs[j], false, i);
        if (!res.ok) continue;
        rr[j] = res; fl[j] = flood(res.x, res.y, cap);
        if (fl[j] > rawBest) rawBest = fl[j];
      }
      for (let j = 0; j < 3; j++) {
        const res = rr[j];
        if (!res) continue;
        let v = fl[j] + (j === 0 ? STRAIGHT_BONUS : 0) + rnd() * TIE_NOISE + (wiggle && j === wiggle ? WIGGLE_BONUS : 0);
        if (hard) {
          if (heads) for (const o of heads) if (Math.abs(res.x - o.x) + Math.abs(res.y - o.y) <= 1) v -= HEAD_PENALTY;
          if (aim && v > cap * 0.7) {
            const tx = Math.max(0, Math.min(m.w - 1, aim.x + DX[aim.dir] * CUT_AHEAD)), ty = Math.max(0, Math.min(m.h - 1, aim.y + DY[aim.dir] * CUT_AHEAD));
            v -= (Math.abs(res.x - tx) + Math.abs(res.y - ty)) * CUT_W;
          }
          if (m.floor[res.y * m.w + res.x] > r.alt) v += 2;   // hard bots like climbing
        }
        if (extras && state.items.length && fl[j] >= cap * 0.5) v += itemPull(r, res, level, rawBest, cap);
        if (v > bestG) { bestG = v; bj = j; }
      }
      // turbo: normal only to escape a tight spot, hard also to grab an item or cut an enemy off
      if (extras && r.boost > 0.15 && bestG >= 0) {
        if (rawBest < cap * 0.4) it.held = true;
        else if (hard) {
          const c = resolve(m, W, s, dirs[bj], false, i);
          if (c.ok && fl[bj] >= cap * 0.7) {
            for (const t of state.items) {
              const d0 = Math.abs(t.x - r.x) + Math.abs(t.y - r.y), d1 = Math.abs(t.x - c.x) + Math.abs(t.y - c.y);
              if (d0 <= 9 && d1 < d0 && Math.abs(t.h - r.alt) <= 0.5) it.held = true;
            }
            if (aim && r.boost > 0.4) {
              const d0 = Math.abs(aim.x - r.x) + Math.abs(aim.y - r.y), d1 = Math.abs(aim.x - c.x) + Math.abs(aim.y - c.y);
              if (d0 <= 10 && d0 >= 3 && d1 < d0 && aim.dir !== (dirs[bj] + 2) % 4) it.held = true;
            }
          }
        }
      }
      const canJump = state.time >= r.jumpReadyAt;
      if (canJump && (bestG < DEAD_END || (hard && bestG < cap * 0.6))) {
        let jb = -1, jj = 0;
        for (let j = 0; j < 3; j++) {
          const f = flight(m, W, s, dirs[j], true, i);
          const v = landScore(f) + (f.landed ? rnd() * TIE_NOISE : 0);
          if (v > jb) { jb = v; jj = j; }
        }
        if (jb > 0 && (hard ? jb > Math.max(bestG, 0) * HARD_JUMP_MUL + HARD_JUMP_ADD * (bestG < 0 ? 0 : 1) : jb > Math.max(bestG, 0) + JUMP_MARGIN)) {
          push(jj); it.jumpReq = true; return;
        }
      }
      if (hard && canJump && r.alt < 1) {   // deliberate terrace climb: land on a raised cell 4 ahead
        const tx = r.x + DX[r.dir] * JUMP_LEN, ty = r.y + DY[r.dir] * JUMP_LEN;
        if (tx >= 0 && ty >= 0 && tx < m.w && ty < m.h && !m.wall[ty * m.w + tx] && m.floor[ty * m.w + tx] >= 1 && rnd() < TERRACE_JUMP_P) {
          const f = flight(m, W, s, r.dir, true, i);
          if (f.landed && f.end.alt >= 1 && flood(f.end.x, f.end.y, cap) >= 40) { it.jumpReq = true; return; }
        }
      }
      if (bestG >= 0) push(bj);   // all fatal → just go straight
    }

    // ---- erasing light walls ----
    // drop points from the owner's trail; the point after a gap starts a new run (brk)
    function eraseCells(o, pred) {
      const r = rs[o], old = r.trail, out = [];
      let cut = false;
      for (const p of old) {
        if (pred(p[0], p[1])) { W.owner[p[1] * map.w + p[0]] = -1; cut = true; continue; }
        if (cut) { p[3] = 1; cut = false; }
        out.push(p);
      }
      if (out.length !== old.length) { r.trail = out; r.trailRev++; return true; }
      return false;
    }

    function blast(i, ev) {
      const r = rs[i], x0 = r.x, y0 = r.y;
      for (let o = 0; o < rs.length; o++) {
        eraseCells(o, (x, y) => Math.abs(x - x0) <= BLAST_R && Math.abs(y - y0) <= BLAST_R && !rs.some((q, qi) => isHead(qi, x, y)));
      }
      ev.push({ t: 'blast', pid: r.pid, x: x0, y: y0, r: BLAST_R });
    }

    function collect(i, ev) {
      const r = rs[i];
      for (let k = 0; k < state.items.length; k++) {
        const t = state.items[k];
        if (t.x !== r.x || t.y !== r.y || (r.air && r.alt >= t.h + TRAIL_H)) continue;
        state.items.splice(k, 1);
        ev.push({ t: 'item', pid: r.pid, kind: t.kind, id: t.id, x: t.x, y: t.y });
        if (t.kind === 'boost') r.boost = 1;
        else if (t.kind === 'jump') r.jumpReadyAt = state.time;
        else if (t.kind === 'shield') r.shield = true;
        else blast(i, ev);
        break;
      }
    }

    function spawnItem(ev) {
      const m = map;
      for (let tries = 0; tries < 60; tries++) {
        const x = (irnd() * m.w) | 0, y = (irnd() * m.h) | 0, c = y * m.w + x;
        if (m.wall[c] || W.owner[c] >= 0 || m.rampDir[c] >= 0 || m.pad[c]) continue;
        if (state.items.some(t => t.x === x && t.y === y)) continue;
        if (rs.some(q => q.alive && Math.max(Math.abs(q.x - x), Math.abs(q.y - y)) < ITEM_MIN_DIST)) continue;
        const t = { id: ++itemId, kind: ITEM_KINDS[(irnd() * ITEM_KINDS.length) | 0], x, y, h: m.floor[c] };
        state.items.push(t);
        ev.push({ t: 'itemSpawn', id: t.id, kind: t.kind, x, y, h: t.h });
        return;
      }
    }

    // after a move: charge/spend turbo and decide the speed of the next move
    function updBoost(i, ev) {
      const r = rs[i], want = ints[i].held && r.boost > 0 && extras;
      if (r.boosting !== want) { r.boosting = want; ev.push({ t: 'boost', pid: r.pid, on: want }); }
      r.mp = want ? 1 : 2;
    }

    // ---- step: one subtick ----
    sim.step = function () {
      if (state.over) return [];
      const ev = [], m = map, plan = [], movers = [];
      const dt = sim.tickMs;
      for (let i = 0; i < rs.length; i++) if (rs[i].alive) { rs[i].ms++; if (rs[i].ms >= rs[i].mp) movers.push(i); }
      for (const i of movers) if (rs[i].bot) think(i);

      for (const i of movers) {
        const r = rs[i], it = ints[i];
        r.px = r.x; r.py = r.y; r.pdir = r.dir; r.palt = r.alt;
        if (it.queue.length) {
          r.dir = (r.dir + (it.queue.shift() === 'R' ? 1 : 3)) % 4;
          ev.push({ t: 'turn', pid: r.pid, dir: r.dir });
        }
        let takeoff = false;
        if (!r.air) {
          if (it.padJump) takeoff = true;
          else if (it.jumpReq && state.time >= r.jumpReadyAt) {
            takeoff = true; r.jumpReadyAt = state.time + JUMP_CD_MS;
            ev.push({ t: 'jump', pid: r.pid, pad: false });
          }
        }
        it.jumpReq = false; it.padJump = false;
        let res = resolve(m, W, sOf(i), r.dir, takeoff, i);
        if (!res.ok && res.light && r.shield) {   // shield: drive through (and erase) a light wall
          const c = res.cell, o = W.owner[c], cx = c % m.w, cy = (c - cx) / m.w;
          if (!isHead(o, cx, cy)) {
            W.owner[c] = -1;
            const again = resolve(m, W, sOf(i), r.dir, takeoff, i);
            if (again.ok) {
              W.owner[c] = o; eraseCells(o, (x, y) => x === cx && y === cy);
              r.shield = false; res = again;
              ev.push({ t: 'shield', pid: r.pid, x: cx, y: cy });
            } else W.owner[c] = o;
          }
        }
        plan[i] = res;
      }

      // same-cell collisions among this subtick's movers (walls laid now are not in W yet)
      const headHit = [];
      for (const a of movers) {
        if (!plan[a].ok) continue;
        for (const b of movers) {
          if (b <= a) continue;
          const pa = plan[a], pb = plan[b];
          if (pb.ok && pa.x === pb.x && pa.y === pb.y && Math.abs(pa.alt - pb.alt) < TRAIL_H) { headHit[a] = headHit[b] = true; }
        }
      }

      for (const i of movers) {
        const r = rs[i], res = plan[i], it = ints[i];
        r.ms = 0;
        if (!res.ok || headHit[i]) {
          const by = res.ok ? 'head' : res.by;
          r.alive = false; r.deadAt = state.tick; r.killer = by; r.boosting = false;
          if (by !== 'edge') { r.x = res.x; r.y = res.y; }
          r.alt = res.alt; r.air = false;
          ev.push({ t: 'crash', pid: r.pid, x: r.x, y: r.y, alt: res.alt, by });
          continue;
        }
        r.x = res.x; r.y = res.y; r.alt = res.alt; r.air = res.air; it.k = res.k; it.base = res.base;
        const wasBoost = r.boosting;
        r.grind = 0;
        if (!res.air) {
          const ci = r.y * m.w + r.x;
          W.owner[ci] = i;
          r.trail.push([r.x, r.y, m.floor[ci], res.land ? 1 : 0]);
          if (res.land) ev.push({ t: 'land', pid: r.pid });
          if (res.drop) ev.push({ t: 'drop', pid: r.pid });
          if (m.pad[ci]) { it.padJump = true; ev.push({ t: 'jump', pid: r.pid, pad: true }); }
          if (extras) {
            for (let s = 0; s < 2; s++) {
              const d = (r.dir + (s ? 1 : 3)) % 4, sx = r.x + DX[d], sy = r.y + DY[d];
              if (sx < 0 || sy < 0 || sx >= m.w || sy >= m.h) continue;
              const si = sy * m.w + sx;
              if (m.wall[si] || W.owner[si] >= 0) { r.grind |= s ? 2 : 1; r.boost = Math.min(1, r.boost + BOOST_GAIN); }
            }
          }
        }
        if (extras) {
          if (wasBoost) r.boost = Math.max(0, r.boost - BOOST_USE);
          collect(i, ev);
          updBoost(i, ev);
        }
      }

      state.tick++;
      state.time += dt;
      state.speed = Math.min(tempo.max, tempo.start + tempo.accel * state.time / 1000);
      sim.tickMs = 1000 / (state.speed * 2);

      if (extras && state.time >= nextItemAt) {
        nextItemAt += ITEM_EVERY_MS;
        if (state.items.length < ITEM_MAX) spawnItem(ev);
      }

      checkOver(ev);
      return ev;
    };

    function checkOver(ev) {
      const alive = rs.filter(r => r.alive);
      if (alive.length <= 1) {
        state.over = true;
        state.winner = alive.length ? alive[0].pid : null;
        ev.push({ t: 'over', winner: state.winner });
      }
    }

    // A player left mid-round: crash in place (by 'left'); returns events like step().
    sim.kill = function (pid) {
      const r = rs.find(q => q.pid === pid);
      if (!r || !r.alive || state.over) return [];
      r.alive = false; r.deadAt = state.tick; r.killer = 'left'; r.air = false; r.boosting = false;
      const ev = [{ t: 'crash', pid, x: r.x, y: r.y, alt: r.alt, by: 'left' }];
      checkOver(ev);
      return ev;
    };

    sim.input = function (pid, cmd) {
      const i = rs.findIndex(r => r.pid === pid);
      if (i < 0 || !rs[i].alive || rs[i].bot) return;
      const it = ints[i];
      if (cmd === 'L' || cmd === 'R') { if (it.queue.length < QUEUE_MAX) it.queue.push(cmd); }
      else if (cmd === 'J') it.jumpReq = true;
      else if (cmd === 'B+') it.held = true;
      else if (cmd === 'B-') it.held = false;
    };

    // Cells/altitudes a jump of rider `pid` would pass (takeoff now, heading `dir`, default current).
    sim.jumpPath = function (pid, dir) {
      const i = rs.findIndex(r => r.pid === pid);
      if (i < 0) return null;
      return flight(map, W, sOf(i), dir == null ? rs[i].dir : dir, !rs[i].air, i);
    };

    // Would the rider's next grounded move in `dir` be safe? { ok, by } (shield and other riders' simultaneous moves ignored).
    sim.probe = function (pid, dir) {
      const i = rs.findIndex(r => r.pid === pid);
      if (i < 0) return null;
      const r = rs[i], f = map.floor[r.y * map.w + r.x];
      const res = resolve(map, W, { x: r.x, y: r.y, alt: f, air: false, k: 0, base: f }, dir, false, i);
      return { ok: res.ok, by: res.ok ? null : res.by };
    };

    return sim;
  }

  const api = { CONST: { TRAIL_H, JUMP_H, JUMP_LEN, JUMP_CD_MS, WALL_H, TEMPO, BOOST_GAIN, BOOST_USE, ITEM_EVERY_MS, ITEM_MAX, BLAST_R }, parseMap, create };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.NeonspurSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
