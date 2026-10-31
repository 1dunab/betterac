// ===== Skyfarers simulation: rules, hazards, bots (deterministic, see docs/SKYFARERS.md) =====
(function (root) {
  const World = (typeof module === 'object' && module.exports) ? require('./world.js') : root.SkyfarersWorld;
  const B = World.BUILDINGS;

  // ---- tunables (doc numbers unless commented) ----
  const CONST = {
    DT: 1 / 30,                 // fixed step (s)
    MAX_SHIPS: 8,
    // flight
    SPEED: 12, BOOST_MUL: 1.8, ACCEL: 20, TURN: 3.5,
    WIND_PUSH: 0.5,             // storm wind adds wind * WIND_PUSH to the target velocity (u/s)
    BOOST_USE: 0.35, BOOST_REGEN: 0.06, GUST_GAIN: 0.5,
    SHIP_R: 1.2,
    SOFT_X: 76, SOFT_Y: 46,     // beyond this ships are pushed back softly
    EDGE_PUSH: 4,               // target-velocity push per unit beyond the soft edge
    HARD_X: 79, HARD_Y: 49,     // hard clamp
    // gusts
    GUST_EVERY: 6, GUST_EVERY_STORM: 3, GUST_LEN: 20, GUST_LIFE: 5,
    GUST_R: 2.5,                // lateral reach of a gust streak
    // hold, water
    CAP: 6, CAP_BONUS: 2, WATER_CAP: 3, WATER_FILL: 1,
    // stun
    STUN_S: 2.5, STUN_SPEED: 0.4,
    STUN_IMMUNE: 1,             // extra grace after the stun ends
    DROP_LIFE: 30, PICKUP_R: 2.4,
    DROP_DELAY: 1,              // a fresh crate cannot be picked up for this long (the stunned captain does not instantly re-grab it)
    // home
    HOME_R: 16, DOCK_R: 21, RING_R: 10,
    DOCK_SPEED: 5,              // doc leaves it open: docked = inside DOCK_R and slower than this
    UNLOAD_S: 0.15,
    // resources
    CRYSTAL_MAX: 8, CRYSTAL_REGROW: 40, WOOD_MAX: 10, WOOD_REGROW: 34,
    HARVEST_R: 5,               // reach measured from the islet's edge (ships cannot enter the islet circle)
    HARVEST_S: 2.6,
    // actions
    EXTINGUISH_R: 14,           // doc says 12; 14 leaves a workable band outside the dock ring (ships there are not docked)
    SPRAY_S: 0.5, SPRAY_FIRE: 0.35,
    HARPOON_R: 18, HARPOON_S: 0.8, HARPOON_HIT: 0.4,   // hit chance is our addition (separate combat RNG stream)
    CANNON_R: 28, CANNON_S: 1.5, CANNON_HIT: 0.35,
    REPAIR_RATE: 20, REPAIR_HP_PER_WOOD: 50, WERK_HEAL: 2,
    REBUILD_COST: 0.5,
    // energy / shield
    ENERGY_CAP: 100, ENERGY_GEN: 2, ENERGY_STORM_MUL: 2, SHIELD_DRAIN: 16,
    // fire
    FIRE_RAIN: 0.02, FIRE_ZISTERNE: 0.05, FIRE_DAMAGE: 40, FIRE_HEART: 4,
    FIRE_SPREAD_AT: 0.6, FIRE_SPREAD_S: 6, FIRE_SPREAD_LEVEL: 0.2,
    WORK_FIRE_MAX: 0.25,        // a building with more fire than this does not work ("burning")
    // lightning
    STRIKE_DELAY: 0.8, STRIKE_SLOT_P: 0.5, STRIKE_SHIP_P: 0.85,   // cumulative: slot < 0.5 <= ship < 0.85 <= sky
    STRIKE_SLOT_FIRE: 0.8, STRIKE_EMPTY_HEART: 8, STRIKE_SHIP_R: 3,
    // storm
    WIND_MIN: 6, WIND_VAR: 4, WIND_TURN: 0.15, WIND_RAMP: 2,
    CLOUD_STORM_EXTRA: 3,
    // dragons
    DRAGON_HP: 6, DRAGON_SPEED: 10, DRAGON_FLEE_MUL: 1.5, DRAGON_FIRE_EVERY: 4,
    DRAGON_FIRE_LEVEL: 0.9, DRAGON_HEART: 10, DRAGON_TAIL_R: 4,
    DRAGON_R_MIN: 18, DRAGON_R_MAX: 24,
    // heart
    HERZ_REGEN: 0.5, HERZ_LOW: 30, HERZ_LOW_REARM: 50,
    // events
    WARN_S: 15,
    // stars
    STAR_HERZ: 60,
    // bots
    BOT_EVERY: 6, BOT_EVENT_LEAD: 10, BOT_DOCK_R: 19.5, BOT_SPRAY_R: 21.8, BOT_AVOID_R: 18.5
  };
  const C = CONST;
  const TAU = Math.PI * 2;
  const RING = [1, 2, 3, 4, 5, 6];
  const PLAN = ['windrad', 'zisterne', 'kanone', 'werkstatt', 'sternwarte', 'kanone', 'sternwarte', 'windrad', 'sternwarte'];

  const mulberry32 = World.mulberry32;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const wrapPi = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };
  const fin = (v) => (typeof v === 'number' && isFinite(v)) ? v : 0;
  const nbrs = (i) => i === 0 ? [] : [((i) % 6) + 1, ((i + 4) % 6) + 1];   // ring neighbours (next, previous)

  function create(opts) {
    opts = opts || {};
    const seed = (opts.seed | 0) || 1;
    const dauer = World.DAUER[opts.dauer] ? opts.dauer : 'normal';
    const schw = World.DIFF[opts.schwierigkeit] ? opts.schwierigkeit : 'normal';
    const world = opts.world || World.make(seed);
    const diff = World.DIFF[schw], length = World.DAUER[dauer];
    const sched = World.EVENTS[dauer].map(e => ({ kind: e.kind, at: e.at, until: e.until, strength: e.strength, warned: false }));
    const nextObj = sched.map(e => ({ kind: e.kind, at: e.at }));
    const rng = mulberry32(seed ^ 0x5bd1e995);     // world + hazards
    const rngB = mulberry32(seed ^ 0x1b873593);    // bots only
    const rngC = mulberry32(seed ^ 0x2c1b3c6d);    // combat hit rolls
    const rngD = mulberry32(seed ^ 0x3c6ef372);    // dragon breath targets (dragon lifetime depends on player/bot kills)
    const DT = C.DT;
    const home = world.home;
    let evq = [];
    const emit = (o) => { evq.push(o); };

    const st = {
      t: 0, dayT: 0, over: false, survived: false, stars: 0,
      herz: 100, energy: 0, shieldOn: false,
      stock: { holz: diff.start.holz, kristall: diff.start.kristall },
      wind: { x: 0, y: 0 }, event: null, next: nextObj[0] || null,
      ships: [], slots: [], islets: [], clouds: [], gusts: [], drops: [], dragons: [], strikes: []
    };
    for (let i = 0; i < 7; i++) st.slots.push({ i, kind: null, stage: 0, build: 0, hp: 0, fire: 0, ruined: false });
    const igniteT = new Array(7).fill(0), cannonT = new Array(7).fill(0);
    const regrowT = [];
    for (const isl of world.islets) {
      const p = World.isletPos(isl, 0), max = isl.kind === 'kristall' ? C.CRYSTAL_MAX : C.WOOD_MAX;
      st.islets.push({ id: isl.id, kind: isl.kind, x: p.x, y: p.y, px: p.x, py: p.y, amount: max, max });
      regrowT.push(0);
    }
    let cloudId = 0;
    for (const c of world.clouds) { st.clouds.push({ id: c.id, x: c.x, y: c.y, px: c.x, py: c.y, r: c.r }); cloudId = Math.max(cloudId, c.id + 1); }
    const cloudBase = st.clouds.length;
    const cdx = 1.5 + rng(), cdy = (rng() - 0.5) * 0.8;   // cloud drift
    let cloudSpawnT = 0, gustT = 2, gustId = 0, dropId = 0, strikeId = 0, dragonId = 0, spawnCount = 0;
    let tick = 0, nextIdx = 0, active = null, activeStart = 0;
    let windAng = 0, windMag = 0, lightT = 0, herzLowArmed = true;
    const shipBy = new Map(), privBy = new Map();
    const work = { windrad: 0, kanone: 0, zisterne: 0, werkstatt: 0 };
    const cover = new Array(7).fill(0);
    const tmpSlots = [];

    // ---- helpers ----
    function slotMax(sl) { return sl.kind ? B[sl.kind].hp : 0; }
    function isWorking(sl) { return !!sl.kind && sl.build >= 1 && !sl.ruined && sl.fire <= C.WORK_FIRE_MAX; }
    function stormy() { return !!st.event && (st.event.kind === 'sturm' || st.event.kind === 'nacht'); }
    function cargoTotal(s) { return s.cargo.holz + s.cargo.kristall; }
    function sternDone() { const c = st.slots[0]; return c.kind === 'sternwarte' && c.stage >= B.sternwarte.stages && c.build >= 1 && !c.ruined; }

    function mkShip(pid, bot) {
      const k = spawnCount++ % C.MAX_SHIPS, a = 1.2 + k * Math.PI / 4;
      const x = Math.cos(a) * C.BOT_DOCK_R, y = Math.sin(a) * C.BOT_DOCK_R;
      const s = {
        pid, bot: !!bot, x, y, px: x, py: y, vx: 0, vy: 0, h: a, ph: a, boost: 1, boosting: false,
        cargo: { holz: 0, kristall: 0 }, cap: C.CAP, water: 0, act: 'horn', acting: false, docked: true, stunned: 0, score: 0,
        stats: { delivered: 0, built: 0, fires: 0, dragonHits: 0, repairs: 0 }
      };
      const p = {
        inp: { sx: 0, sy: 0, boost: false, act: false }, prevAct: false, cd: 0, unloadT: C.UNLOAD_S, repAcc: 0, repHealed: 0, fireAcc: 0,
        immune: 0, inGust: false, wasDocked: true, tgtSlot: -1, tgtDragon: null, tgtIslet: -1,
        botIdx: shipBy.size, bt: { target: null }
      };
      return [s, p];
    }

    function addCaptain(pid, bot) {
      if (shipBy.has(pid) || st.ships.length >= C.MAX_SHIPS) return false;
      const [s, p] = mkShip(pid, bot);
      p.botIdx = st.ships.length;
      st.ships.push(s); shipBy.set(pid, s); privBy.set(pid, p);
      return true;
    }
    function dropCrate(x, y, holz, kristall) {
      if (holz + kristall <= 0) return;
      const d = { id: dropId++, x, y, holz, kristall, age: 0 };
      st.drops.push(d);
      emit({ t: 'drop', id: d.id, x, y });
    }
    function removeCaptain(pid) {
      const s = shipBy.get(pid);
      if (!s) return false;
      dropCrate(s.x, s.y, s.cargo.holz, s.cargo.kristall);
      st.ships.splice(st.ships.indexOf(s), 1);
      shipBy.delete(pid); privBy.delete(pid);
      return true;
    }
    function input(pid, o) {
      const p = privBy.get(pid);
      if (!p || !o) return;
      const i = p.inp;
      if ('sx' in o || 'sy' in o) {
        let sx = 'sx' in o ? fin(o.sx) : i.sx, sy = 'sy' in o ? fin(o.sy) : i.sy;
        const m = Math.hypot(sx, sy);
        if (m > 1) { sx /= m; sy /= m; }
        i.sx = sx; i.sy = sy;
      }
      if ('boost' in o) i.boost = !!o.boost;
      if ('act' in o) i.act = !!o.act;
    }

    function stun(s, p, by) {
      if (s.stunned > 0 || p.immune > 0) return;
      s.stunned = C.STUN_S; p.immune = C.STUN_S + C.STUN_IMMUNE;
      let n = Math.ceil(cargoTotal(s) / 2), h = 0, k = 0;
      while (n > 0) {
        if (s.cargo.holz >= s.cargo.kristall && s.cargo.holz > 0) { s.cargo.holz--; h++; } else if (s.cargo.kristall > 0) { s.cargo.kristall--; k++; } else break;
        n--;
      }
      emit({ t: 'stun', pid: s.pid, by });
      dropCrate(s.x, s.y, h, k);
    }

    // ---- building ----
    function costFor(kind, rebuild) {
      const c = B[kind].cost;
      return rebuild ? { holz: Math.ceil(c.holz * C.REBUILD_COST), kristall: Math.ceil(c.kristall * C.REBUILD_COST) } : { holz: c.holz, kristall: c.kristall };
    }
    function pickRingSlot(s) {
      const a = Math.atan2(s.y, s.x);
      let best = -1, bd = 1e9;
      for (const i of RING) {
        if (st.slots[i].kind) continue;
        const d = ((a - home.slots[i].angle) % TAU + TAU) % TAU;   // clockwise (decreasing angle) from the ship's side
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    function build(pid, kind) {
      const s = shipBy.get(pid), def = B[kind];
      if (!s || !def || !Object.prototype.hasOwnProperty.call(B, kind)) return { ok: false, reason: 'unknown' };
      if (st.over || !s.docked) return { ok: false, reason: st.over ? 'unknown' : 'notDocked' };
      let slot = null, stage = 1, rebuild = false;
      for (const sl of st.slots) if (sl.kind === kind && sl.ruined) { slot = sl; stage = sl.stage; rebuild = true; break; }
      if (!slot) {
        if (kind === 'sternwarte') {
          const c = st.slots[0];
          if (!c.kind) { slot = c; stage = 1; }
          else if (c.kind === 'sternwarte' && c.stage < def.stages && c.build >= 1 && !c.ruined) { slot = c; stage = c.stage + 1; }
          else return { ok: false, reason: 'stage' };
        } else {
          const i = pickRingSlot(s);
          if (i < 0) return { ok: false, reason: 'noSlot' };
          slot = st.slots[i];
        }
      }
      const cost = costFor(kind, rebuild);
      if (st.stock.holz < cost.holz || st.stock.kristall < cost.kristall) return { ok: false, reason: 'cost' };
      st.stock.holz -= cost.holz; st.stock.kristall -= cost.kristall;
      if (rebuild) { slot.ruined = false; slot.build = 0; slot.hp = def.hp; slot.fire = 0; }
      else if (slot.kind === kind) { slot.stage = stage; slot.build = 0; }   // next Sternwarte stage
      else { slot.kind = kind; slot.stage = 1; slot.build = 0; slot.hp = def.hp; slot.fire = 0; slot.ruined = false; }
      igniteT[slot.i] = 0; cannonT[slot.i] = 0;
      s.stats.built++;
      emit({ t: 'buildStart', slot: slot.i, kind, stage: slot.stage, pid });
      return { ok: true, slot: slot.i };
    }

    // ---- per-step pieces ----
    function updateWork() {
      work.windrad = work.kanone = work.zisterne = work.werkstatt = 0;
      cover.fill(0);
      for (const sl of st.slots) {
        if (!isWorking(sl) || !(sl.kind in work)) continue;
        work[sl.kind]++;
        if (sl.kind === 'zisterne') { cover[sl.i]++; for (const n of nbrs(sl.i)) cover[n]++; }
      }
    }

    function scheduleEvents() {
      if (active && st.t >= active.until - 1e-9) {
        emit({ t: 'eventEnd', kind: active.kind });
        if (active.kind !== 'sturm') for (const d of st.dragons) if (d.state !== 'flee') { d.state = 'flee'; emit({ t: 'dragonFlee', id: d.id }); }
        active = null; st.event = null; st.wind.x = st.wind.y = 0;
      }
      for (let i = nextIdx; i < sched.length; i++) {
        const e = sched[i];
        if (!e.warned && st.t >= e.at - C.WARN_S - 1e-9) { e.warned = true; emit({ t: 'warn', kind: e.kind, in: C.WARN_S }); }
      }
      while (nextIdx < sched.length && st.t >= sched[nextIdx].at - 1e-9) {
        const e = sched[nextIdx++];
        active = e; activeStart = e.at;
        st.event = { kind: e.kind, until: e.until, strength: e.strength };
        emit({ t: 'eventStart', kind: e.kind });
        if (e.kind === 'sturm' || e.kind === 'nacht') {
          windAng = rng() * TAU; windMag = C.WIND_MIN + rng() * C.WIND_VAR;
          lightT = diff.lightning / e.strength;
        }
        if (e.kind === 'drachen' || e.kind === 'nacht') {
          const n = diff.dragons[e.kind] || 0, a0 = rng() * TAU;
          for (let k = 0; k < n; k++) {
            const a = a0 + k * TAU / n, R = C.DRAGON_R_MIN + rng() * (C.DRAGON_R_MAX - C.DRAGON_R_MIN), dir = rng() < 0.5 ? -1 : 1;
            const x = Math.cos(a) * 95, y = Math.sin(a) * 60;
            const d = { id: dragonId++, x, y, px: x, py: y, h: Math.atan2(-y, -x), ph: Math.atan2(-y, -x), hp: C.DRAGON_HP, state: 'approach' };
            st.dragons.push(d);
            dragonPriv[d.id] = { R, dir, ang: a, fireT: 2.5 + k * 0.7 };
            emit({ t: 'dragonSpawn', id: d.id });
          }
        }
      }
      st.next = nextIdx < sched.length ? nextObj[nextIdx] : null;
    }
    const dragonPriv = {};

    function updateWind() {
      if (active && (active.kind === 'sturm' || active.kind === 'nacht')) {
        windAng += C.WIND_TURN * DT;
        const ramp = clamp(Math.min(st.t - activeStart, active.until - st.t) / C.WIND_RAMP, 0, 1);
        st.wind.x = Math.cos(windAng) * windMag * ramp; st.wind.y = Math.sin(windAng) * windMag * ramp;
      } else { st.wind.x = 0; st.wind.y = 0; }
    }

    function updateWorld() {
      for (let i = 0; i < st.islets.length; i++) {
        const isl = st.islets[i], p = World.isletPos(world.islets[i], st.t);
        isl.x = p.x; isl.y = p.y;
        if (isl.amount < isl.max) {
          regrowT[i] += DT;
          const need = isl.kind === 'kristall' ? C.CRYSTAL_REGROW : C.WOOD_REGROW;
          if (regrowT[i] >= need) { regrowT[i] -= need; isl.amount++; }
        } else regrowT[i] = 0;
      }
      // clouds
      const target = cloudBase + (stormy() ? C.CLOUD_STORM_EXTRA : 0);
      const vx = cdx + st.wind.x * 0.15, vy = cdy + st.wind.y * 0.15;
      for (let i = st.clouds.length - 1; i >= 0; i--) {
        const c = st.clouds[i];
        c.x += vx * DT; c.y += vy * DT;
        if (c.x > 80 + c.r) { if (st.clouds.length > target) { st.clouds.splice(i, 1); continue; } c.x = -80 - c.r; c.px = c.x; }
        if (c.x < -80 - c.r) { c.x = 80 + c.r; c.px = c.x; }
        if (c.y > 50 + c.r) { c.y = -50 - c.r; c.py = c.y; } else if (c.y < -50 - c.r) { c.y = 50 + c.r; c.py = c.y; }
      }
      cloudSpawnT -= DT;
      if (st.clouds.length < target && cloudSpawnT <= 0) {
        cloudSpawnT = 2;
        const r = 6 + rng() * 3, y = (rng() * 2 - 1) * 40;
        st.clouds.push({ id: cloudId++, x: -80 - r, y, px: -80 - r, py: y, r });
      }
      // gusts
      for (let i = st.gusts.length - 1; i >= 0; i--) { const g = st.gusts[i]; g.age += DT; if (g.age >= g.life) st.gusts.splice(i, 1); }
      gustT -= DT;
      if (gustT <= 0) {
        gustT += stormy() ? C.GUST_EVERY_STORM : C.GUST_EVERY;
        const x = (rng() * 2 - 1) * 60, y = (rng() * 2 - 1) * 35, a = rng() * TAU;
        st.gusts.push({ id: gustId++, x1: x, y1: y, x2: x + Math.cos(a) * C.GUST_LEN, y2: y + Math.sin(a) * C.GUST_LEN, age: 0, life: C.GUST_LIFE });
      }
      for (let i = st.drops.length - 1; i >= 0; i--) { const d = st.drops[i]; d.age += DT; if (d.age >= C.DROP_LIFE) st.drops.splice(i, 1); }
    }

    function decideAct(s, p) {
      p.tgtSlot = -1; p.tgtDragon = null; p.tgtIslet = -1;
      if (s.docked && stormy() && work.windrad > 0) return 'shield';
      if (s.water > 0) {
        let bd = C.EXTINGUISH_R;
        for (const sl of st.slots) if (sl.fire > 0 && sl.kind && !sl.ruined) {
          const d = Math.hypot(home.slots[sl.i].x - s.x, home.slots[sl.i].y - s.y);
          if (d <= bd) { bd = d; p.tgtSlot = sl.i; }
        }
        if (p.tgtSlot >= 0) return 'extinguish';
      }
      let bd = C.HARPOON_R;
      for (const d of st.dragons) if (d.state !== 'flee') {
        const dd = Math.hypot(d.x - s.x, d.y - s.y);
        if (dd <= bd) { bd = dd; p.tgtDragon = d; }
      }
      if (p.tgtDragon) return 'shoot';
      if (cargoTotal(s) < s.cap) {
        bd = 1e9;
        for (let i = 0; i < st.islets.length; i++) {
          const isl = st.islets[i];
          if (isl.amount < 1) continue;
          const d = Math.hypot(isl.x - s.x, isl.y - s.y);
          if (d <= world.islets[i].r + C.HARVEST_R && d < bd) { bd = d; p.tgtIslet = i; }
        }
        if (p.tgtIslet >= 0) return 'harvest';
      }
      if (s.docked && (st.stock.holz >= 1 || p.repAcc > 0)) {
        let worst = 0;
        for (const sl of st.slots) {
          if (!sl.kind || sl.ruined || sl.build < 1) continue;
          const miss = slotMax(sl) - sl.hp;
          if (miss > worst + 1e-6) { worst = miss; p.tgtSlot = sl.i; }
        }
        if (p.tgtSlot >= 0 && worst > 1e-6) return 'repair';
        p.tgtSlot = -1;
      }
      return 'horn';
    }

    function damageDragon(d, by) {
      if (d.state === 'flee') return;
      d.hp -= 1;
      emit({ t: 'dragonHit', id: d.id, by });
      if (d.hp <= 0) { d.hp = 0; d.state = 'flee'; emit({ t: 'dragonFlee', id: d.id }); }
    }

    function stepShips() {
      // gather capacity and shield use
      let shielding = false;
      const werk = work.werkstatt > 0;
      for (const s of st.ships) {
        const p = privBy.get(s.pid), i = p.inp;
        s.px = s.x; s.py = s.y; s.ph = s.h;
        s.cap = C.CAP + (werk ? C.CAP_BONUS : 0);
        if (s.stunned > 0) s.stunned = Math.max(0, s.stunned - DT);
        if (p.immune > 0) p.immune = Math.max(0, p.immune - DT);
        if (p.cd > 0) p.cd = Math.max(0, p.cd - DT);
        const stunned = s.stunned > 0;
        // boost
        const mag = Math.hypot(i.sx, i.sy);
        s.boosting = i.boost && s.boost > 0.001 && mag > 0.1 && !stunned;
        if (s.boosting) s.boost = Math.max(0, s.boost - C.BOOST_USE * DT); else s.boost = Math.min(1, s.boost + C.BOOST_REGEN * DT);
        // velocity
        const sp = C.SPEED * (s.boosting ? C.BOOST_MUL : 1) * (stunned ? C.STUN_SPEED : 1);
        let tx = i.sx * sp + st.wind.x * C.WIND_PUSH, ty = i.sy * sp + st.wind.y * C.WIND_PUSH;
        if (s.x > C.SOFT_X) tx -= (s.x - C.SOFT_X) * C.EDGE_PUSH; else if (s.x < -C.SOFT_X) tx -= (s.x + C.SOFT_X) * C.EDGE_PUSH;
        if (s.y > C.SOFT_Y) ty -= (s.y - C.SOFT_Y) * C.EDGE_PUSH; else if (s.y < -C.SOFT_Y) ty -= (s.y + C.SOFT_Y) * C.EDGE_PUSH;
        let dvx = tx - s.vx, dvy = ty - s.vy;
        const dm = Math.hypot(dvx, dvy), maxd = C.ACCEL * DT;
        if (dm > maxd) { dvx *= maxd / dm; dvy *= maxd / dm; }
        s.vx += dvx; s.vy += dvy;
        s.x += s.vx * DT; s.y += s.vy * DT;
        s.x = clamp(s.x, -C.HARD_X, C.HARD_X); s.y = clamp(s.y, -C.HARD_Y, C.HARD_Y);
        // gust riding
        let riding = false;
        const spd = Math.hypot(s.vx, s.vy);
        if (spd > 4) for (const g of st.gusts) {
          const gx = g.x2 - g.x1, gy = g.y2 - g.y1, L2 = gx * gx + gy * gy;
          const u = clamp(((s.x - g.x1) * gx + (s.y - g.y1) * gy) / L2, 0, 1);
          if (Math.hypot(g.x1 + gx * u - s.x, g.y1 + gy * u - s.y) < C.GUST_R && (s.vx * gx + s.vy * gy) / (spd * Math.sqrt(L2)) > 0.5) { riding = true; break; }
        }
        if (riding) { s.boost = Math.min(1, s.boost + C.GUST_GAIN * DT); if (!p.inGust) emit({ t: 'gust', pid: s.pid }); }
        p.inGust = riding;
        // heading
        if (spd > 1) {
          const dh = wrapPi(Math.atan2(s.vy, s.vx) - s.h), mt = C.TURN * DT;
          s.h += clamp(dh, -mt, mt);
        }
      }
      // collisions
      for (const s of st.ships) {
        let d = Math.hypot(s.x, s.y), minD = C.HOME_R + C.SHIP_R;
        if (d < minD) {
          const nx = d > 1e-6 ? s.x / d : 1, ny = d > 1e-6 ? s.y / d : 0;
          s.x = nx * minD; s.y = ny * minD;
          const vn = s.vx * nx + s.vy * ny;
          if (vn < 0) { s.vx -= vn * nx; s.vy -= vn * ny; }
        }
        for (const isl of st.islets) {
          const r = world.islets[isl.id].r;
          minD = r + C.SHIP_R;
          const dx = s.x - isl.x, dy = s.y - isl.y;
          d = Math.hypot(dx, dy);
          if (d < minD) {
            const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
            s.x = isl.x + nx * minD; s.y = isl.y + ny * minD;
            const vn = s.vx * nx + s.vy * ny;
            if (vn < 0) { s.vx -= vn * nx; s.vy -= vn * ny; }
          }
        }
      }
      for (let a = 0; a < st.ships.length; a++) for (let b = a + 1; b < st.ships.length; b++) {
        const A = st.ships[a], Bs = st.ships[b], dx = Bs.x - A.x, dy = Bs.y - A.y, d = Math.hypot(dx, dy), minD = C.SHIP_R * 2;
        if (d < minD) {
          const nx = d > 1e-6 ? dx / d : (a % 2 ? 1 : -1), ny = d > 1e-6 ? dy / d : 0, push = (minD - d) * 0.25;
          A.x -= nx * push; A.y -= ny * push; Bs.x += nx * push; Bs.y += ny * push;
        }
      }
      // docking, pickups, water, actions
      for (const s of st.ships) {
        const p = privBy.get(s.pid), i = p.inp;
        const speed = Math.hypot(s.vx, s.vy);
        s.docked = Math.hypot(s.x, s.y) <= C.DOCK_R && speed < C.DOCK_SPEED;
        if (s.docked !== p.wasDocked) { emit({ t: s.docked ? 'dock' : 'undock', pid: s.pid }); p.wasDocked = s.docked; }
        // unload
        if (s.docked && cargoTotal(s) > 0) {
          p.unloadT -= DT;
          if (p.unloadT <= 0) {
            p.unloadT += C.UNLOAD_S;
            const res = s.cargo.kristall > 0 ? 'kristall' : 'holz';
            s.cargo[res]--; st.stock[res]++; s.stats.delivered++;
            emit({ t: 'unload', pid: s.pid, res });
          }
        } else p.unloadT = C.UNLOAD_S;
        // crates
        for (let k = st.drops.length - 1; k >= 0; k--) {
          const d = st.drops[k];
          if (d.age < C.DROP_DELAY || Math.hypot(d.x - s.x, d.y - s.y) > C.PICKUP_R) continue;
          let space = s.cap - cargoTotal(s);
          if (space <= 0) continue;
          const th = Math.min(d.holz, space); space -= th;
          const tk = Math.min(d.kristall, space);
          if (th + tk <= 0) continue;
          s.cargo.holz += th; s.cargo.kristall += tk; d.holz -= th; d.kristall -= tk;
          emit({ t: 'pickup', pid: s.pid, id: d.id });
          if (d.holz + d.kristall <= 0) st.drops.splice(k, 1);
        }
        // water
        for (const c of st.clouds) if (Math.hypot(c.x - s.x, c.y - s.y) < c.r) { s.water = Math.min(C.WATER_CAP, s.water + C.WATER_FILL * DT); break; }
        if (s.docked && work.zisterne > 0) s.water = C.WATER_CAP;
        // context action
        const held = i.act, edge = held && !p.prevAct;
        p.prevAct = held;
        s.act = decideAct(s, p);
        s.acting = false;
        switch (s.act) {
          case 'shield':
            s.acting = held && st.energy > 0;
            if (s.acting) shielding = true;
            break;
          case 'extinguish':
            s.acting = held;
            if (held && p.cd <= 0) {
              const sl = st.slots[p.tgtSlot], f = Math.min(1, s.water), removed = Math.min(sl.fire, C.SPRAY_FIRE * f);
              p.cd = C.SPRAY_S; s.water -= f; sl.fire -= removed;
              p.fireAcc += removed; s.stats.fires = Math.floor(p.fireAcc * 10 + 1e-9);
              emit({ t: 'spray', pid: s.pid, slot: sl.i });
              if (sl.fire <= 1e-9) { sl.fire = 0; emit({ t: 'fireOut', slot: sl.i, pid: s.pid }); }
            }
            break;
          case 'shoot':
            s.acting = held;
            if (held && p.cd <= 0) {
              p.cd = C.HARPOON_S;
              const hit = rngC() < C.HARPOON_HIT;
              emit({ t: 'harpoon', pid: s.pid, dragon: p.tgtDragon.id, hit });
              if (hit) { s.stats.dragonHits++; damageDragon(p.tgtDragon, s.pid); }
            }
            break;
          case 'harvest':
            s.acting = held;
            if (held && p.cd <= 0) {
              p.cd = C.HARVEST_S;
              const isl = st.islets[p.tgtIslet], res = isl.kind;
              isl.amount--; s.cargo[res]++;
              emit({ t: 'harvest', pid: s.pid, res, islet: isl.id });
            }
            break;
          case 'repair':
            s.acting = held;
            if (held) {
              const sl = st.slots[p.tgtSlot];
              if (p.repAcc <= 1e-9 && st.stock.holz >= 1) { st.stock.holz--; p.repAcc += C.REPAIR_HP_PER_WOOD; emit({ t: 'repair', pid: s.pid, slot: sl.i }); }
              if (p.repAcc > 0) {
                const heal = Math.min(C.REPAIR_RATE * DT, p.repAcc, slotMax(sl) - sl.hp);
                sl.hp += heal; p.repAcc -= heal; p.repHealed += heal;
                s.stats.repairs = Math.floor(p.repHealed / C.REPAIR_HP_PER_WOOD + 1e-9);
              }
            }
            break;
          default:
            s.acting = edge;
            if (edge) emit({ t: 'horn', pid: s.pid });
        }
      }
      return shielding;
    }

    function stepSlots() {
      const rain = stormy() ? C.FIRE_RAIN : 0;
      let burning = false;
      for (const sl of st.slots) {
        if (!sl.kind) continue;
        const max = slotMax(sl);
        if (sl.ruined) { sl.fire = 0; continue; }
        if (sl.build < 1) {
          sl.build = Math.min(1, sl.build + DT / B[sl.kind].buildS);
          if (sl.build >= 1) emit({ t: 'buildDone', slot: sl.i, kind: sl.kind, stage: sl.stage });
        } else if (sl.fire <= C.WORK_FIRE_MAX && work.werkstatt > 0 && sl.hp < max) sl.hp = Math.min(max, sl.hp + C.WERK_HEAL * DT);
        if (sl.fire > 0) {
          burning = true;
          sl.fire = Math.min(1, sl.fire + (diff.fire - rain - C.FIRE_ZISTERNE * cover[sl.i]) * DT);
          if (sl.fire <= 0) { sl.fire = 0; emit({ t: 'fireOut', slot: sl.i }); igniteT[sl.i] = 0; continue; }
          sl.hp -= C.FIRE_DAMAGE * sl.fire * DT;
          st.herz -= C.FIRE_HEART * sl.fire * DT;
          if (sl.fire > C.FIRE_SPREAD_AT) {
            igniteT[sl.i] += DT;
            if (igniteT[sl.i] >= C.FIRE_SPREAD_S) {
              igniteT[sl.i] = 0;
              for (const n of nbrs(sl.i)) {
                const t = st.slots[n];
                if (t.kind && !t.ruined && t.fire <= 0) { t.fire = C.FIRE_SPREAD_LEVEL; emit({ t: 'fireStart', slot: n }); break; }
              }
            }
          } else igniteT[sl.i] = 0;
        }
        if (sl.hp <= 0) { sl.hp = 0; sl.ruined = true; sl.fire = 0; emit({ t: 'ruined', slot: sl.i }); }
      }
      return burning;
    }

    function startFire(sl, level) {
      if (!sl.kind || sl.ruined) return;
      const was = sl.fire > 0;
      sl.fire = Math.min(1, Math.max(sl.fire, level));
      if (!was) emit({ t: 'fireStart', slot: sl.i });
    }

    function stepLightning() {
      if (active && (active.kind === 'sturm' || active.kind === 'nacht')) {
        lightT -= DT;
        if (lightT <= 0) {
          lightT += diff.lightning / active.strength;
          const roll = rng(), slotI = Math.floor(rng() * 7), shipI = rng(), sx = (rng() * 2 - 1) * 60, sy = (rng() * 2 - 1) * 35;
          const k = { id: strikeId++, x: sx, y: sy, at: st.t + C.STRIKE_DELAY, target: 'sky' };
          if (roll < C.STRIKE_SLOT_P) { k.target = 'slot'; k.slot = slotI; k.x = home.slots[slotI].x; k.y = home.slots[slotI].y; }
          else if (roll < C.STRIKE_SHIP_P && st.ships.length) {
            const s = st.ships[Math.floor(shipI * st.ships.length)];
            k.target = 'ship'; k.pid = s.pid; k.x = s.x; k.y = s.y;
          }
          st.strikes.push(k);
          emit({ t: 'strikeWarn', id: k.id, x: k.x, y: k.y });
        }
      }
      for (let i = st.strikes.length - 1; i >= 0; i--) {
        const k = st.strikes[i];
        if (st.t < k.at - 1e-9) continue;
        st.strikes.splice(i, 1);
        let absorbed = false;
        const out = { t: 'strike', id: k.id, x: k.x, y: k.y, target: k.target, absorbed: false };
        if (k.target === 'slot') {
          out.slot = k.slot;
          const sl = st.slots[k.slot];
          if (st.shieldOn) absorbed = true;
          else if (!sl.kind) st.herz -= C.STRIKE_EMPTY_HEART;
          else startFire(sl, C.STRIKE_SLOT_FIRE);
        } else if (k.target === 'ship') {
          out.pid = k.pid;
          const s = shipBy.get(k.pid);
          if (s && Math.hypot(s.x - k.x, s.y - k.y) <= C.STRIKE_SHIP_R) stun(s, privBy.get(k.pid), 'lightning');
        }
        out.absorbed = absorbed;
        emit(out);
      }
    }

    function stepDragons() {
      const ships = st.ships;
      for (let i = st.dragons.length - 1; i >= 0; i--) {
        const d = st.dragons[i], dp = dragonPriv[d.id] || (dragonPriv[d.id] = { R: (C.DRAGON_R_MIN + C.DRAGON_R_MAX) / 2, dir: 1, ang: Math.atan2(d.y, d.x), fireT: C.DRAGON_FIRE_EVERY });
        d.px = d.x; d.py = d.y; d.ph = d.h;
        if (d.state === 'approach') {
          const dist = Math.hypot(d.x, d.y);
          if (dist <= dp.R + 1) { d.state = 'circle'; dp.ang = Math.atan2(d.y, d.x); }
          else { d.h = Math.atan2(-d.y, -d.x); d.x += Math.cos(d.h) * C.DRAGON_SPEED * DT; d.y += Math.sin(d.h) * C.DRAGON_SPEED * DT; }
        }
        if (d.state === 'circle') {
          dp.ang += dp.dir * C.DRAGON_SPEED / dp.R * DT;
          // ease onto the circle radius
          const r = Math.hypot(d.x, d.y), nr = r + (dp.R - r) * Math.min(1, 2 * DT);
          d.x = Math.cos(dp.ang) * nr; d.y = Math.sin(dp.ang) * nr;
          d.h = dp.ang + dp.dir * Math.PI / 2;
          dp.fireT -= DT;
          if (dp.fireT <= 0) {
            dp.fireT += C.DRAGON_FIRE_EVERY;
            tmpSlots.length = 0;
            for (const sl of st.slots) if (sl.kind && !sl.ruined) tmpSlots.push(sl.i);
            const pick = rngD();
            if (tmpSlots.length) {
              const si = tmpSlots[Math.floor(pick * tmpSlots.length)];
              emit({ t: 'dragonFire', id: d.id, slot: si, absorbed: st.shieldOn });
              if (!st.shieldOn) startFire(st.slots[si], Math.min(1, st.slots[si].fire + C.DRAGON_FIRE_LEVEL));
            } else {
              emit({ t: 'dragonFire', id: d.id, slot: -1, absorbed: st.shieldOn });
              if (!st.shieldOn) st.herz -= C.DRAGON_HEART;
            }
          }
        }
        if (d.state === 'flee') {
          const r = Math.hypot(d.x, d.y) || 1;
          d.h = Math.atan2(d.y, d.x);
          d.x += d.x / r * C.DRAGON_SPEED * C.DRAGON_FLEE_MUL * DT; d.y += d.y / r * C.DRAGON_SPEED * C.DRAGON_FLEE_MUL * DT;
          if (Math.abs(d.x) > 95 || Math.abs(d.y) > 65) { st.dragons.splice(i, 1); delete dragonPriv[d.id]; continue; }
        } else {
          for (const s of ships) {
            if (Math.hypot(s.x - d.x, s.y - d.y) < C.DRAGON_TAIL_R) stun(s, privBy.get(s.pid), 'dragon');
          }
        }
      }
      // cannons
      for (const sl of st.slots) {
        if (sl.kind !== 'kanone') continue;
        if (cannonT[sl.i] > 0) cannonT[sl.i] -= DT;
        if (!isWorking(sl) || cannonT[sl.i] > 0) continue;
        let best = null, bd = C.CANNON_R;
        for (const d of st.dragons) if (d.state !== 'flee') {
          const dd = Math.hypot(d.x - home.slots[sl.i].x, d.y - home.slots[sl.i].y);
          if (dd <= bd) { bd = dd; best = d; }
        }
        if (best) {
          cannonT[sl.i] = C.CANNON_S;
          emit({ t: 'cannon', slot: sl.i, dragon: best.id });
          if (rngC() < C.CANNON_HIT) damageDragon(best, 'kanone');
        }
      }
    }

    // ---- bots ----
    function botPlan() {
      for (const sl of st.slots) if (sl.kind && sl.ruined) return { kind: sl.kind, cost: costFor(sl.kind, true), wait: false };
      const seen = {};
      const freeRing = RING.some(i => !st.slots[i].kind);
      for (const kind of PLAN) {
        const n = seen[kind] = (seen[kind] || 0) + 1;
        if (kind === 'sternwarte') {
          const c = st.slots[0];
          if (c.kind === 'sternwarte' && c.stage >= n) continue;
          return { kind, cost: costFor(kind, false), wait: c.kind === 'sternwarte' && c.build < 1 };
        }
        let have = 0;
        for (const sl of st.slots) if (sl.kind === kind) have++;
        if (have >= n || !freeRing) continue;
        return { kind, cost: costFor(kind, false), wait: false };
      }
      return null;
    }
    function route(sx, sy, tx, ty) {
      const dx = tx - sx, dy = ty - sy, L2 = dx * dx + dy * dy;
      if (L2 < 1) return [tx, ty];
      const u = clamp(-(sx * dx + sy * dy) / L2, 0, 1), cx = sx + dx * u, cy = sy + dy * u;
      if (cx * cx + cy * cy >= C.BOT_AVOID_R * C.BOT_AVOID_R) return [tx, ty];
      const as = Math.atan2(sy, sx), at = Math.atan2(ty, tx);
      let da = wrapPi(at - as);
      if (Math.abs(da) < 0.05) da = 1;
      const step = Math.sign(da) * Math.min(Math.abs(da), 1);
      return [Math.cos(as + step) * 24, Math.sin(as + step) * 24];
    }
    function steer(s, tx, ty, slow, act) {
      const d = Math.hypot(tx - s.x, ty - s.y);
      let ux = 0, uy = 0;
      if (d > 0.6) {
        const [wx, wy] = route(s.x, s.y, tx, ty), wd = Math.hypot(wx - s.x, wy - s.y) || 1;
        const m = Math.min(1, d / slow);
        ux = (wx - s.x) / wd * m; uy = (wy - s.y) / wd * m;
      }
      ux -= st.wind.x * C.WIND_PUSH / C.SPEED; uy -= st.wind.y * C.WIND_PUSH / C.SPEED;   // hold position against the wind
      input(s.pid, { sx: ux, sy: uy, boost: d > 25 && s.boost > 0.4, act: !!act });
    }
    function dockSpot(s) { const a = Math.atan2(s.y, s.x); return [Math.cos(a) * C.BOT_DOCK_R, Math.sin(a) * C.BOT_DOCK_R]; }
    function nearest(list, s) {
      let best = null, bd = 1e9;
      for (const o of list) { const d = Math.hypot(o.x - s.x, o.y - s.y); if (d < bd) { bd = d; best = o; } }
      return best;
    }

    function botThink(s, p) {
      const total = cargoTotal(s), ev = st.event;
      const plan = botPlan();
      // 1. fires
      let fire = null, fd = 1e9;
      for (const sl of st.slots) if (sl.fire > 0 && sl.kind && !sl.ruined) {
        const hs = home.slots[sl.i], d = Math.hypot(hs.x - s.x, hs.y - s.y);
        if (d < fd) { fd = d; fire = sl; }
      }
      if (fire && s.water > 0.3) {
        const a = fire.i ? home.slots[fire.i].angle : Math.atan2(s.y, s.x);
        steer(s, Math.cos(a) * C.BOT_SPRAY_R, Math.sin(a) * C.BOT_SPRAY_R, 6, true);
        return;
      }
      if (fire && s.water <= 0.3 && st.clouds.length) {
        const c = nearest(st.clouds, s);
        steer(s, c.x, c.y, 6, false);
        return;
      }
      // 2. dragons
      const live = st.dragons.filter(d => d.state !== 'flee');
      if (live.length) {
        const d = nearest(live, s);
        const dx = s.x - d.x, dy = s.y - d.y, L = Math.hypot(dx, dy) || 1;
        let tx = d.x + dx / L * 12, ty = d.y + dy / L * 12;
        const r = Math.hypot(tx, ty);
        if (r < C.BOT_SPRAY_R) { tx *= C.BOT_SPRAY_R / (r || 1); ty *= C.BOT_SPRAY_R / (r || 1); }
        steer(s, tx, ty, 5, true);
        return;
      }
      // 3. storm: shield keeper, water reserves
      const storm = stormy();
      if (storm && work.windrad > 0 && st.energy > 5) {
        let keeper = null;
        for (const o of st.ships) if (o.bot && (!keeper || o.pid < keeper.pid)) keeper = o;
        if (keeper === s) { const [x, y] = dockSpot(s); steer(s, x, y, 7, true); return; }
      }
      if (storm && s.water < 2 && st.clouds.length) {
        const c = nearest(st.clouds, s);
        steer(s, c.x, c.y, 6, false);
        return;
      }
      // 4. logistics
      const soon = ev || (st.next && st.next.at - st.t <= C.BOT_EVENT_LEAD);
      const afford = plan && st.stock.holz >= plan.cost.holz && st.stock.kristall >= plan.cost.kristall && !plan.wait;
      if (s.docked) {
        if (total > 0) { input(s.pid, { sx: 0, sy: 0, boost: false, act: false }); return; }
        if (afford) {
          const r = build(s.pid, plan.kind);
          if (r.ok) { input(s.pid, { sx: 0, sy: 0, act: false }); return; }
        }
        if (s.act === 'repair') { input(s.pid, { sx: 0, sy: 0, boost: false, act: true }); return; }
      }
      const covers = plan && !plan.wait && st.stock.holz + s.cargo.holz >= plan.cost.holz && st.stock.kristall + s.cargo.kristall >= plan.cost.kristall;
      const damaged = st.slots.some(sl => sl.kind && !sl.ruined && sl.build >= 1 && sl.hp < slotMax(sl) - 10) && st.stock.holz >= 1;
      if (total >= s.cap || (total > 0 && (soon || covers)) || (total === 0 && (afford || damaged))) {
        const [x, y] = dockSpot(s);
        steer(s, x, y, 7, false);
        return;
      }
      // gather
      let want;
      if (plan) {
        const dh = plan.cost.holz - st.stock.holz - s.cargo.holz, dk = plan.cost.kristall - st.stock.kristall - s.cargo.kristall;
        want = dk > dh ? 'kristall' : 'holz';
        if (dh <= 0 && dk <= 0) want = st.stock.holz <= st.stock.kristall ? 'holz' : 'kristall';
      } else want = st.stock.holz < 8 ? 'holz' : 'kristall';
      let cand = st.islets.filter(o => o.kind === want && o.amount >= 1);
      if (!cand.length) cand = st.islets.filter(o => o.amount >= 1);
      if (cand.length && total < s.cap) {
        // spread out a little: prefer the nearest, but a bot index shifts the pick
        cand.sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y));
        const isl = cand[(p.botIdx > 0 && cand.length > 1 && rngB() < 0.25) ? 1 : 0] || cand[0];
        p.bt.target = isl.id;
        const r = world.islets[isl.id].r, dx = s.x - isl.x, dy = s.y - isl.y, L = Math.hypot(dx, dy) || 1;
        steer(s, isl.x + dx / L * (r + 2.6), isl.y + dy / L * (r + 2.6), 5, true);
        return;
      }
      if (total > 0) { const [x, y] = dockSpot(s); steer(s, x, y, 7, false); return; }
      const [x, y] = dockSpot(s);
      steer(s, x, y, 7, false);
    }
    function stepBots() {
      for (const s of st.ships) {
        if (!s.bot) continue;
        const p = privBy.get(s.pid);
        if ((tick + p.botIdx) % C.BOT_EVERY === 0) botThink(s, p);
      }
    }

    // ---- end ----
    function finish(survived) {
      st.over = true; st.survived = survived;
      st.stars = survived ? (sternDone() ? (st.herz >= C.STAR_HERZ ? 3 : 2) : 1) : 0;
      if (!survived) emit({ t: 'sink' });
      emit({ t: 'over', survived, stars: st.stars });
    }

    function step() {
      if (st.over) { evq = []; return []; }
      tick++;
      st.t = tick * DT; st.dayT = Math.min(1, st.t / length);
      for (const o of st.islets) { o.px = o.x; o.py = o.y; }
      for (const o of st.clouds) { o.px = o.x; o.py = o.y; }
      for (const d of st.dragons) { d.px = d.x; d.py = d.y; d.ph = d.h; }
      scheduleEvents();
      updateWind();
      updateWork();
      updateWorld();
      stepBots();
      const shielding = stepShips();
      // energy and shield
      const gen = work.windrad * C.ENERGY_GEN * (stormy() ? C.ENERGY_STORM_MUL : 1);
      st.energy = Math.min(C.ENERGY_CAP, st.energy + gen * DT);
      const wasOn = st.shieldOn;
      st.shieldOn = shielding && st.energy > 0;
      if (st.shieldOn) st.energy = Math.max(0, st.energy - C.SHIELD_DRAIN * DT);
      if (st.shieldOn && !wasOn) emit({ t: 'shieldOn' }); else if (!st.shieldOn && wasOn) emit({ t: 'shieldOff' });
      const burning = stepSlots();
      stepLightning();
      stepDragons();
      if (!st.event && !burning && st.herz < 100) st.herz = Math.min(100, st.herz + C.HERZ_REGEN * DT);
      if (herzLowArmed && st.herz < C.HERZ_LOW) { herzLowArmed = false; emit({ t: 'herzLow' }); }
      else if (!herzLowArmed && st.herz >= C.HERZ_LOW_REARM) herzLowArmed = true;
      for (const s of st.ships) {
        const t = s.stats;
        s.score = t.delivered + t.built * 3 + t.fires + t.dragonHits * 2 + t.repairs * 2;
      }
      if (st.herz <= 0) { st.herz = 0; finish(false); }
      else if (st.t >= length - 1e-9) finish(true);
      const out = evq; evq = [];
      return out;
    }

    const sim = { dt: DT, state: st, input, build, addCaptain, removeCaptain, step, world, dauer, schwierigkeit: schw };
    for (const c of (opts.captains || [])) addCaptain(c.pid, c.bot);
    return sim;
  }

  const api = { create, CONST };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SkyfarersSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
