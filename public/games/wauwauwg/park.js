// Wauwau-WG scene "park" — the lawn after the walk. Owners stand on the path at
// the front and throw toys (wwThrow); dogs chase, catch in the air, steal each
// other's toys and bring them back for love and Taler. World coordinates:
// x = front-plane pixels (480 = screen center), z = depth into the park
// (0 = front edge, DEPTH = back fence), h = height above the grass.
// Contract: docs/WAUWAUWG.md §Scenes.
(function () {
  'use strict';
  const WW = window.WW;

  // ---------- tunables (honest guesses until people play) ----------
  const CX = 480;                          // vanishing center (screen x)
  const FRONT_Y = 516, BACK_Y = 238;       // screen y of the lawn's front edge / back fence
  const DEPTH = 360;                       // playable depth in world units
  const FAR_SCALE = 0.56;                  // sprite scale at the back fence
  const HALF_W = 430;                      // dogs + toys stay within CX ± HALF_W on screen
  const DOG_SCALE = 0.86, TOY_SCALE = 1.35, OWNER_SCALE = 0.8;
  const OWNER_Z = -16, DROP_Z = 22, DROP_DX = 42;
  const RUN = 240, TROT = 180, WALK = 64;  // world units/s before breed + needs factors
  const ACCEL = 1300;
  const PICK_R = 24, CATCH_R = 30, CATCH_H = 92;
  const HOP_H = 46, HOP_TIME = 0.42, THROW_TIME = 0.45;
  const TOY_TIMEOUT = 10, TOY_HARD_TIMEOUT = 18;
  const LONELY_TOY = 2.5;                  // s on the grass before any dog may grab it
  const STEAL_CLOSER = 0.85;               // a thief must be this much closer than the owner's dog
  const NO_OWNER_CHANCE = 0.6;             // someone fetches when the owner's dog can't
  const AIR_BONUS = 2;                     // extra Taler for a catch before the toy touched grass
  const REST_GAIN = 14, REST_UNTIL = 24;   // energy/min while lying down; get up at this energy
  const SEP = 34;                          // dogs keep this distance
  const SOUND_GAP = 0.12, MAX_PARTS = 420;
  const BREED_SPEED = { dackel: 0.86, mops: 0.82, corgi: 0.9, pudel: 1, labrador: 1.06, husky: 1.1, schaefer: 1.1, mischling: 1 };
  const TOY = {
    ball: { speed: [150, 330], up: [240, 400], g: 900, bounce: 0.52, roll: 230, drag: 0, spin: 9, catchP: 0.55 },
    frisbee: { speed: [165, 255], up: [110, 170], g: 260, bounce: 0.1, roll: 560, drag: 0.1, spin: 0, catchP: 0.85, glide: true },
    duck: { speed: [110, 220], up: [230, 330], g: 900, bounce: 0.62, roll: 320, drag: 0, spin: 7, catchP: 0.35, erratic: 110 },
    stick: { speed: [150, 300], up: [250, 380], g: 900, bounce: 0.25, roll: 430, drag: 0, spin: 14, catchP: 0.45 }
  };
  const POSS = { ball: 'deinen Tennisball', frisbee: 'dein Frisbee', duck: 'deine Quietsche-Ente', stick: 'dein Stöckchen' };
  const SKINS = ['#f2c9a5', '#e2ae86', '#c68a62', '#8f5b3d', '#f7dcc4'];
  const HAIRS = ['#3a2a20', '#6b4a2b', '#caa165', '#1e1a18', '#a5532c', '#d9c6a3', '#5b5b66'];
  const DUST = '#e3d3a6', FONT = 'system-ui,sans-serif', TAU = Math.PI * 2;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const scaleAt = (z) => 1 - (1 - FAR_SCALE) * z / DEPTH;
  function proj(x, z, h) {
    const s = scaleAt(z);
    return { x: CX + (x - CX) * s, y: FRONT_Y - (FRONT_Y - BACK_Y) * z / DEPTH - (h || 0) * s, s };
  }
  // world x limits at depth z that keep a sprite on screen (with margin m)
  const xMin = (z, m) => CX - (HALF_W - m) / scaleAt(Math.max(0, z));
  const xMax = (z, m) => CX + (HALF_W - m) / scaleAt(Math.max(0, z));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const PLAY = ['playGo', 'playWait', 'bow', 'zoom', 'follow'];

  WW.scenes.park = function (api) {
    const W = api.W, H = api.H;
    const deco = WW.rng(4711);   // static decoration only — never touches the gameplay rnd
    const fx = WW.rng(815);      // particle jitter (visual only)
    let dogs = {}, owners = {}, toys = [], parts = [], sent = {}, sounds = {};
    let bg = null, uid = 0, lonelyT = 0;
    const flowers = [], clouds = [], flies = [];
    buildDecor();

    // ---------- helpers ----------
    function sound(name) {
      const now = api.time();
      if (sounds[name] != null && now - sounds[name] < SOUND_GAP) return;
      sounds[name] = now;
      api.sfx(name);
    }
    const toyById = (u) => toys.find(t => t.uid === u) || null;
    const toyOf = (id) => toys.find(t => t.owner === id) || null;
    const each = (fn) => Object.keys(dogs).forEach(k => fn(dogs[k]));
    function spot() {
      const z = 40 + (api.rnd() + api.rnd()) / 2 * (DEPTH - 80);
      const u = api.rnd() + api.rnd() - 1;       // −1..1, center-biased
      return { x: CX + u * (HALF_W - 70) / scaleAt(z), z };
    }
    function handPos(o) { const p = proj(o.x + 17 * OWNER_SCALE, OWNER_Z, 58 * OWNER_SCALE); return { x: p.x, y: p.y }; }
    function headPos(d) {
      const dog = api.dog(d.id), p = proj(d.x, d.z, d.hop), s = p.s * DOG_SCALE;
      const head = dog ? WW.art.points(dog, s).head : [30 * s, -60 * s];
      return { x: p.x + head[0] * d.facing, y: p.y + head[1] };
    }
    function able(d) {
      return !!d && !d.resting && !d.carry && d.state !== 'pickup' && d.state !== 'celebrate' && !!api.dog(d.id);
    }
    function mark(d, text, color) { d.mark = text; d.markT = 0.8; d.markC = color; }

    // ---------- particles (screen space) ----------
    function add(p) { if (parts.length < MAX_PARTS) parts.push(p); }
    function puff(x, y, s, n, c) {
      for (let i = 0; i < n; i++) add({ k: 'dust', x: x + (fx() - 0.5) * 18 * s, y: y - fx() * 4 * s, vx: (fx() - 0.5) * 60 * s, vy: -(8 + fx() * 22) * s, g: 0, r: (3 + fx() * 4) * s, life: 0, max: 0.4 + fx() * 0.35, c: c || DUST });
    }
    function flick(x, y, s, n) {
      for (let i = 0; i < n; i++) add({ k: 'blade', x, y, vx: (fx() - 0.5) * 150 * s, vy: -(90 + fx() * 130) * s, g: 560, r: (3 + fx() * 3) * s, rot: fx() * 6, vr: (fx() - 0.5) * 20, life: 0, max: 0.45 + fx() * 0.3, c: fx() < 0.5 ? '#3f9c3a' : '#79cc5d' });
    }
    function sparkle(x, y, n) {
      add({ k: 'ring', x, y, r: 6, life: 0, max: 0.38, c: '#fff6c4' });
      for (let i = 0; i < n; i++) {
        const a = fx() * TAU, v = 60 + fx() * 150;
        add({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, g: 180, r: 2 + fx() * 2.6, life: 0, max: 0.45 + fx() * 0.35, c: fx() < 0.5 ? '#fff3a0' : '#ffffff' });
      }
    }
    function floatGlyph(x, y, t, c, size, vy, max, wob) {
      add({ k: 'text', t, x, y, vx: (fx() - 0.5) * 16, vy: vy || -36, g: 0, r: size || 15, life: 0, max: max || 1.1, c, wob: !!wob });
    }
    function leaves(x, y, n) {
      for (let i = 0; i < n; i++) add({ k: 'leaf', x: x + (fx() - 0.5) * 20, y, vx: (fx() - 0.5) * 70, vy: -(30 + fx() * 60), g: 140, r: 2.5 + fx() * 2, rot: fx() * 6, vr: (fx() - 0.5) * 10, life: 0, max: 0.9 + fx() * 0.5, c: fx() < 0.5 ? '#3f8f3f' : '#5fae4f' });
    }

    // ---------- owners ----------
    function makeOwner(id) {
      const h = (id * 2654435761) >>> 0;
      return { id, x: null, tx: CX, throwT: 0, cheerT: 0, lastToy: 'ball', skin: SKINS[h % SKINS.length], hair: HAIRS[(h >>> 5) % HAIRS.length], style: (h >>> 9) % 3, ph: (h % 97) / 15 };
    }
    // Owners line up on the front path, ordered like the player cards below.
    function layoutOwners(snap) {
      const ids = Object.keys(owners).map(Number).sort((a, b) => a - b);
      const n = ids.length, span = Math.min(660, 170 * (n - 1)), so = scaleAt(OWNER_Z);
      ids.forEach((id, i) => {
        const sx = n === 1 ? CX : CX - span / 2 + span * i / (n - 1);
        const o = owners[id];
        o.tx = CX + (sx - CX) / so;
        if (snap || o.x == null) o.x = o.tx;
      });
    }

    // ---------- dogs ----------
    function makeDog(id) {
      const o = owners[id];
      return {
        id, x: (o ? o.tx : CX) + DROP_DX, z: DROP_Z + 4, vx: 0, vz: 0, facing: 1,
        state: 'roam', target: spot(), timer: 0, speedMul: 3.2, sit: false,
        chase: null, carry: null, partner: null, lead: false, hop: 0, hopT: 0, hopK: 1,
        resting: false, restT: 0, saidTired: false, missUntil: 0, mark: null, markT: 0, markC: '#fff',
        zT: 0, sniffT: 0, flowerSide: 1, ph: api.rnd() * 10
      };
    }
    function toIdle(d, time) {
      if (d.chase != null) { const t = toyById(d.chase); if (t) t.chasers = t.chasers.filter(c => c !== d.id); d.chase = null; }
      d.state = 'idle'; d.timer = time; d.sit = api.rnd() < 0.3;
    }
    function unpair(d) {
      const p = d.partner != null ? dogs[d.partner] : null;
      d.partner = null;
      if (p && p.partner === d.id) { p.partner = null; if (PLAY.indexOf(p.state) >= 0) toIdle(p, 0.6); }
    }
    // Steering with limited acceleration; returns the distance to the target.
    function steer(d, target, speed, dt) {
      let tvx = 0, tvz = 0, gap = 0;
      if (target) {
        const dx = target.x - d.x, dz = target.z - d.z;
        gap = Math.hypot(dx, dz);
        if (gap > 2) { const k = speed * Math.min(1, gap / 36) / gap; tvx = dx * k; tvz = dz * k; }
      }
      const ax = tvx - d.vx, az = tvz - d.vz, al = Math.hypot(ax, az), m = ACCEL * dt;
      if (al > m) { d.vx += ax / al * m; d.vz += az / al * m; } else { d.vx = tvx; d.vz = tvz; }
      d.x += d.vx * dt; d.z += d.vz * dt;
      d.z = clamp(d.z, 8, DEPTH - 14);
      d.x = clamp(d.x, xMin(d.z, 46), xMax(d.z, 46));
      if (Math.abs(d.vx) > 16) d.facing = d.vx > 0 ? 1 : -1;
      return gap;
    }
    function pickActivity(d) {
      const r = api.rnd();
      if (r < 0.4) { d.state = 'roam'; d.target = spot(); d.speedMul = 0.8 + api.rnd() * 0.6; d.sit = false; }
      else if (r < 0.65) {
        const f = nearestFlower(d);
        d.state = 'sniffGo'; d.sit = false;
        d.flowerSide = api.rnd() < 0.5 ? 1 : -1;
        d.target = { x: f.x - d.flowerSide * 30, z: clamp(f.z + (api.rnd() - 0.5) * 14, 10, DEPTH - 16) };
      } else if (r < 0.83 && startPlay(d)) { /* paired up */ }
      else { d.state = 'idle'; d.sit = true; d.timer = 1.4 + api.rnd() * 2.4; }
    }
    function nearestFlower(d) {
      const sorted = flowers.slice().sort((a, b) => dist(a, d) - dist(b, d));
      return sorted[api.rnd() < 0.7 ? 0 : Math.min(1, sorted.length - 1)];
    }
    function startPlay(d) {
      let best = null, bd = 320;
      each(e => {
        if (e === d || e.resting || e.carry || e.chase != null || e.partner != null) return;
        if (['idle', 'roam', 'sniff', 'sniffGo'].indexOf(e.state) < 0) return;
        const g = dist(d, e);
        if (g < bd) { bd = g; best = e; }
      });
      if (!best) return false;
      d.state = 'playGo'; d.partner = best.id; d.sit = false;
      best.state = 'playWait'; best.partner = d.id; best.timer = 3.5; best.sit = false;
      return true;
    }
    function startBow(d, p) {
      [d, p].forEach(x => { x.state = 'bow'; x.timer = 0.8; x.hopT = HOP_TIME; x.hopK = 0.32; x.sit = false; });
      d.lead = true; p.lead = false;
      d.facing = p.x > d.x ? 1 : -1; p.facing = -d.facing;
      const a = proj((d.x + p.x) / 2, (d.z + p.z) / 2, 64);
      floatGlyph(a.x, a.y, '💛', '#ffd60a', 18 * a.s, -30, 1.2);
      sound('yip');
    }
    function startRest(d, dog) {
      if (d.partner != null) unpair(d);
      if (d.chase != null) toIdle(d, 0);
      d.resting = true; d.restT = 0; d.state = 'rest'; d.zT = 0.4; d.sit = false;
      if (!d.saidTired) {
        d.saidTired = true;
        api.event(d.id, '😴 ' + dog.name + ' ist zu müde zum Spielen', { kind: 'bad', floatText: '😴' });
        sound('whine');
      }
      syncHud(d.id);
    }

    // ---------- toys ----------
    function integrate(t, P, dt) {
      t.vh -= P.g * dt;
      if (P.drag) { const k = Math.max(0, 1 - P.drag * dt); t.vx *= k; t.vz *= k; }
      if (t.curve) t.vx += t.curve * dt;
      t.x += t.vx * dt; t.z += t.vz * dt; t.h += t.vh * dt;
      let wall = false;
      if (t.z > DEPTH - 6) { t.z = DEPTH - 6; t.vz = -Math.abs(t.vz) * 0.3; t.vx *= 0.7; wall = true; }
      const lo = xMin(t.z, 18), hi = xMax(t.z, 18);
      if (t.x < lo) { t.x = lo; t.vx = Math.abs(t.vx) * 0.4; wall = true; }
      else if (t.x > hi) { t.x = hi; t.vx = -Math.abs(t.vx) * 0.4; wall = true; }
      return wall;
    }
    // Where will it first touch the grass? Dogs run there while it flies.
    function predict(t, P) {
      const c = { x: t.x, z: t.z, h: t.h, vx: t.vx, vz: t.vz, vh: t.vh, curve: t.curve };
      for (let i = 0; i < 400; i++) { integrate(c, P, 1 / 60); if (c.h <= 0 && c.vh < 0) break; }
      return { x: c.x, z: clamp(c.z, 8, DEPTH - 14) };
    }
    function throwToy(id, key, dx, dy, power) {
      const o = owners[id], P = TOY[key] || TOY.ball;
      let ax = clamp(dx, -1, 1), az = Math.max(0.25, -clamp(dy, -1, 1));
      const l = Math.hypot(ax, az);
      ax /= l; az /= l;
      const sp = lerp(P.speed[0], P.speed[1], power);
      const t = {
        uid: ++uid, key, owner: id, x: o.x + 17 * OWNER_SCALE, z: OWNER_Z + 6, h: 60,
        vx: ax * sp, vz: az * sp, vh: lerp(P.up[0], P.up[1], power),
        rot: 0, vrot: P.spin * (api.rnd() < 0.5 ? -1 : 1), wob: 0, curve: P.glide ? (api.rnd() - 0.5) * 80 : 0,
        state: 'flight', touched: false, air: false, stolen: false, age: 0, groundT: 0, squash: 0,
        carrier: null, chasers: [], trail: [], hb: null
      };
      t.land = predict(t, P);
      toys.push(t);
      o.throwT = 0.001; o.lastToy = key;
      sound('whoosh');
      assignChasers(t);
      syncHud(id);
    }
    // The owner's dog always goes; a closer dog may try to steal it.
    function chaseChance(d) {
      const n = api.dog(d.id).needs;
      return clamp(0.12 + n.mood / 260 + (n.energy - 40) / 320, 0.06, 0.6);
    }
    function assignChasers(t) {
      const own = dogs[t.owner], ownOk = able(own);
      if (ownOk) chase(own, t);
      const ownD = ownOk ? dist(own, t.land) : Infinity;
      let best = null, bd = Infinity;
      each(d => {
        if (d.id === t.owner || !able(d) || d.chase != null) return;
        const g = dist(d, t.land);
        if (g < bd && g < ownD * STEAL_CLOSER) { bd = g; best = d; }
      });
      if (best && api.rnd() < (ownOk ? chaseChance(best) : NO_OWNER_CHANCE)) chase(best, t);
    }
    function chase(d, t) {
      if (d.chase != null && d.chase !== t.uid) { const old = toyById(d.chase); if (old) old.chasers = old.chasers.filter(c => c !== d.id); }
      if (d.partner != null) unpair(d);
      d.state = 'chase'; d.chase = t.uid; d.sit = false;
      if (t.chasers.indexOf(d.id) < 0) t.chasers.push(d.id);
      mark(d, '!', '#ffd60a');
      sound('yip');
    }
    function loseChase(d, t, winner) {
      if (!d) return;
      d.chase = null;
      if (t && winner != null && winner !== d.id && t.owner === d.id) { d.state = 'sad'; d.timer = 1.1; d.sit = true; mark(d, '❓', '#fff'); }
      else toIdle(d, 0.3 + api.rnd() * 0.5);
    }
    function grab(d, t, air) {
      t.chasers.forEach(c => { if (c !== d.id && dogs[c]) loseChase(dogs[c], t, d.id); });
      t.chasers = [d.id];
      t.state = 'carried'; t.carrier = d.id; t.air = air; t.trail = []; t.h = 0;
      d.carry = t.uid; d.chase = null;
      d.state = air ? 'return' : 'pickup'; d.timer = 0.25;
      const hp = headPos(d);
      if (air) { sparkle(hp.x, hp.y, 16); api.floatAt(d.id, '✨ Fang!', '#fff6a8'); sound('coin'); }
      else sound('tick');
      if (t.owner !== d.id) {
        t.stolen = true;
        api.floatAt(d.id, 'Geklaut! 😂', '#ffd60a');
        const thief = api.dog(d.id);
        if (owners[t.owner] && thief) api.event(t.owner, '😂 ' + thief.name + ' hat ' + (POSS[t.key] || 'dein Spielzeug') + ' geklaut!', { kind: 'info', float: false });
        sound('woof');
      }
      syncHud(t.owner);
    }
    // Credit always goes to the dog that brings a toy back.
    function deliver(d) {
      const t = toyById(d.carry), id = d.id, o = owners[id], dog = api.dog(id);
      d.carry = null;
      d.state = 'celebrate'; d.timer = 1.3; d.facing = -1; d.sit = false;
      if (!t) return;
      if (!dog) { killToy(t); return; }
      if (o) o.cheerT = 0.9;
      const love = api.love(id, 2, 'fetch');
      const coins = api.coins(id, 1 + (t.air ? AIR_BONUS : 0));
      api.stat(id, 'fetches');
      api.needs(id, { energy: -3, mood: 4 });
      const gain = [love ? '+' + love + ' ❤️' : '', coins ? '+' + coins + ' 🪙' : ''].filter(Boolean).join(' ');
      const it = WW.ITEMS[t.key] || WW.ITEMS.ball;
      const text = t.stolen ? '😏 ' + dog.name + ' bringt dir Beute! ' + gain
        : t.air ? '✨ ' + dog.name + ' fängt in der Luft! ' + gain
        : it.emoji + ' Brav, ' + dog.name + '! ' + gain;
      api.event(id, text.trim(), { kind: 'good', floatText: gain || '🐾', color: '#ff8fab' });
      sound('woof');
      const hp = headPos(d);
      for (let i = 0; i < 3; i++) floatGlyph(hp.x + (fx() - 0.5) * 26, hp.y, '♥', '#ff6f91', 13 + fx() * 6, -40 - fx() * 30, 1 + fx() * 0.4);
      if (t.stolen && owners[t.owner] && o) handBack(t, id);
      else killToy(t);
      syncHud(id);
    }
    // The thief's owner tosses the loot back to its rightful owner.
    function handBack(t, fromId) {
      const a = handPos(owners[fromId]), b = handPos(owners[t.owner]);
      t.state = 'handback'; t.carrier = null; t.chasers = [];
      t.hb = { ax: a.x, ay: a.y, bx: b.x, by: b.y, t: 0, dur: 0.75 };
      owners[fromId].throwT = 0.001;
      sound('whoosh');
    }
    function killToy(t) {
      t.state = 'gone';
      each(d => {
        if (d.chase === t.uid) { d.chase = null; toIdle(d, 0.4); }
        if (d.carry === t.uid) { d.carry = null; if (d.state === 'return' || d.state === 'pickup') toIdle(d, 0.4); }
      });
      toys = toys.filter(x => x !== t);
      syncHud(t.owner);
    }
    // A toy nobody fetched pops back into its owner's hand.
    function poofBack(t, at) {
      sparkle(at.x, at.y, 8);
      puff(at.x, at.y, 1, 5, '#ffffff');
      sound('pop');
      const o = owners[t.owner];
      if (o) o.cheerT = Math.max(o.cheerT, 0.3);
      killToy(t);
    }
    function updateToy(t, dt) {
      const P = TOY[t.key] || TOY.ball;
      t.age += dt;
      t.squash = Math.max(0, t.squash - dt * 6);
      if (t.state === 'flight') {
        const wall = integrate(t, P, dt);
        t.rot += t.vrot * dt; t.wob += dt * 10;
        const p = proj(t.x, t.z, t.h);
        t.trail.push([p.x, p.y]);
        if (t.trail.length > 7) t.trail.shift();
        if (wall && t.h < 70) { leaves(p.x, p.y, 6); sound('thud'); }
        if (t.h <= 0 && t.vh < 0) {
          t.h = 0;
          if (t.z < 8) { t.z = 8; t.vz = Math.abs(t.vz) * 0.3; }
          const g = proj(t.x, t.z, 0);
          t.touched = true;
          if (-t.vh > 95 && P.bounce > 0.15) {
            t.vh = -t.vh * P.bounce; t.vx *= 0.78; t.vz *= 0.78;
            if (P.erratic) { t.vx += (api.rnd() - 0.5) * P.erratic * 2; t.vz += (api.rnd() - 0.5) * P.erratic; t.vrot = -t.vrot; }
            t.squash = 1;
            flick(g.x, g.y, g.s, 5);
            puff(g.x, g.y, g.s, 2);
            sound(t.key === 'duck' ? 'squeak' : 'tick');
          } else {
            t.vh = 0; t.state = 'ground'; t.groundT = 0; t.trail = []; t.squash = 0.7;
            flick(g.x, g.y, g.s, 4);
            puff(g.x, g.y, g.s, 4);
            if (t.key === 'duck') sound('squeak');
          }
        }
      } else if (t.state === 'ground') {
        const sp = Math.hypot(t.vx, t.vz);
        if (sp > 0.5) {
          const ns = Math.max(0, sp - P.roll * dt), k = ns / sp;
          t.vx *= k; t.vz *= k;
          t.z = clamp(t.z + t.vz * dt, 8, DEPTH - 8);
          t.x = clamp(t.x + t.vx * dt, xMin(t.z, 18), xMax(t.z, 18));
          if (t.key !== 'frisbee') t.rot += (t.vx >= 0 ? 1 : -1) * ns * dt / 7;
        } else { t.vx = 0; t.vz = 0; }
        t.groundT += dt;
        t.chasers = t.chasers.filter(c => dogs[c] && dogs[c].chase === t.uid);
        if ((t.groundT > TOY_TIMEOUT && !t.chasers.length) || t.groundT > TOY_HARD_TIMEOUT) poofBack(t, proj(t.x, t.z, 8));
      } else if (t.state === 'carried') {
        const d = dogs[t.carrier];
        if (!d || d.carry !== t.uid) { t.state = 'ground'; t.groundT = 0; t.carrier = null; t.chasers = []; }
        else { t.x = d.x; t.z = d.z; }
      } else if (t.state === 'handback') {
        t.hb.t += dt;
        if (t.hb.t >= t.hb.dur) {
          const o = owners[t.owner];
          if (o) o.cheerT = Math.max(o.cheerT, 0.35);
          sound('pop');
          killToy(t);
        }
      }
    }
    // Toys lying around unclaimed tempt the nearest idle dog.
    function lonely(dt) {
      lonelyT += dt;
      if (lonelyT < 0.5) return;
      lonelyT = 0;
      toys.forEach(t => {
        if (t.state !== 'ground' || t.chasers.length || t.groundT < LONELY_TOY) return;
        const own = dogs[t.owner];
        if (able(own) && own.chase == null) { chase(own, t); return; }
        let best = null, bd = Infinity;
        each(d => { if (able(d) && d.chase == null) { const g = dist(d, t); if (g < bd) { bd = g; best = d; } } });
        if (best && api.rnd() < 0.3) chase(best, t);
      });
    }

    // ---------- dog brain ----------
    function updateChase(d, dog, sp, dt) {
      const t = toyById(d.chase);
      if (!t || (t.state !== 'flight' && t.state !== 'ground')) { loseChase(d, t, t ? t.carrier : null); return; }
      steer(d, (t.state === 'flight' && !t.touched) ? t.land : t, RUN * sp, dt);
      const gap = Math.hypot(t.x - d.x, t.z - d.z), now = api.time();
      if (t.state === 'flight' && t.h > 10 && t.h < CATCH_H && gap < CATCH_R && !d.hopT && now > d.missUntil) {
        d.hopT = HOP_TIME; d.hopK = 1;
        const p = (TOY[t.key] || TOY.ball).catchP * (0.6 + dog.needs.energy / 250);
        if (api.rnd() < p) grab(d, t, !t.touched);
        else { d.missUntil = now + 0.8; mark(d, '💨', '#fff'); }
      } else if (t.h < 10 && gap < PICK_R) grab(d, t, false);
    }
    function updateDog(d, dt) {
      const dog = api.dog(d.id);
      if (!dog) return;
      const sp = (BREED_SPEED[dog.breed] || 1) * api.speed(d.id);
      if (d.hopT > 0) {
        d.hopT = Math.max(0, d.hopT - dt);
        d.hop = Math.sin(Math.PI * (1 - d.hopT / HOP_TIME)) * HOP_H * d.hopK;
        if (!d.hopT) { d.hop = 0; const g = proj(d.x, d.z, 0); puff(g.x, g.y, g.s, 3); }
      }
      if (d.markT > 0) d.markT -= dt;
      // Tired dogs lie down (after delivering what they carry) and nap until rested.
      if (!d.resting && !d.carry && api.tired(d.id)) startRest(d, dog);
      if (d.resting) {
        if (!api.tired(d.id) && dog.needs.energy >= REST_UNTIL) { d.resting = false; toIdle(d, 0.6); syncHud(d.id); }
        else {
          api.needs(d.id, { energy: REST_GAIN * dt / 60 });
          steer(d, null, 0, dt);
          d.restT += dt; d.zT -= dt;
          if (d.zT <= 0) { d.zT = 1.6; const hp = headPos(d); floatGlyph(hp.x + 6 * d.facing, hp.y - 6, '💤', '#eef4ff', 12 + 6 * proj(d.x, d.z, 0).s, -18, 1.8, true); }
          return;
        }
      }
      switch (d.state) {
        case 'idle':
          steer(d, null, 0, dt);
          d.timer -= dt;
          if (d.timer <= 0) pickActivity(d);
          break;
        case 'roam':
          if (steer(d, d.target, WALK * d.speedMul * sp, dt) < 12) toIdle(d, 0.8 + api.rnd() * 1.8);
          break;
        case 'sniffGo':
          if (steer(d, d.target, WALK * sp, dt) < 10) { d.state = 'sniff'; d.timer = 1.4 + api.rnd() * 1.6; d.facing = d.flowerSide; }
          break;
        case 'sniff': {
          steer(d, null, 0, dt);
          d.timer -= dt; d.sniffT -= dt;
          if (d.sniffT <= 0) {
            d.sniffT = 0.4;
            const p = proj(d.x, d.z, 0), pts = WW.art.points(dog, p.s * DOG_SCALE);
            floatGlyph(p.x + pts.nose[0] * d.facing, p.y - 6 * p.s, '~', 'rgba(255,255,255,.85)', 10 + 4 * p.s, -18, 0.7);
          }
          if (d.timer <= 0) toIdle(d, 0.6);
          break;
        }
        case 'chase': updateChase(d, dog, sp, dt); break;
        case 'pickup':
          steer(d, null, 0, dt);
          d.timer -= dt;
          if (d.timer <= 0) d.state = 'return';
          break;
        case 'return': {
          const o = owners[d.id];
          if (!o) { const t = toyById(d.carry); if (t) poofBack(t, proj(d.x, d.z, 20)); d.carry = null; toIdle(d, 0.5); break; }
          if (steer(d, { x: o.x + DROP_DX, z: DROP_Z }, TROT * sp, dt) < 10) deliver(d);
          break;
        }
        case 'celebrate': case 'sad':
          steer(d, null, 0, dt);
          d.timer -= dt;
          if (d.timer <= 0) toIdle(d, 0.4);
          break;
        case 'playGo': {
          const p = dogs[d.partner];
          if (!p || p.partner !== d.id) { d.partner = null; toIdle(d, 0.4); break; }
          if (steer(d, p, RUN * 0.55 * sp, dt) < 56) startBow(d, p);
          break;
        }
        case 'playWait': {
          steer(d, null, 0, dt);
          const p = dogs[d.partner];
          if (p) d.facing = p.x > d.x ? 1 : -1;
          d.timer -= dt;
          if (!p || d.timer <= 0) { unpair(d); toIdle(d, 0.4); }
          break;
        }
        case 'bow':
          steer(d, null, 0, dt);
          d.timer -= dt;
          if (d.timer <= 0) {
            if (d.lead) { d.state = 'zoom'; d.target = spot(); }
            else d.state = 'follow';
            d.timer = 2.6;
          }
          break;
        case 'zoom':
          if (steer(d, d.target, RUN * 0.8 * sp, dt) < 16) d.target = spot();
          d.timer -= dt;
          if (d.timer <= 0) { unpair(d); toIdle(d, 0.8); }
          break;
        case 'follow': {
          const p = dogs[d.partner];
          if (!p) { d.partner = null; toIdle(d, 0.4); break; }
          steer(d, p, RUN * 0.78 * sp, dt);
          d.timer -= dt;
          if (d.timer <= 0) { unpair(d); toIdle(d, 0.8); }
          break;
        }
        case 'rest': toIdle(d, 0.4); break;
        default: toIdle(d, 0.5);
      }
    }
    function separate() {
      const list = Object.keys(dogs).map(k => dogs[k]);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j], dx = b.x - a.x, dz = (b.z - a.z) * 1.6, g = Math.hypot(dx, dz);
          if (g > 0.01 && g < SEP) {
            const k = (SEP - g) / g * 0.25;
            a.x -= dx * k; b.x += dx * k; a.z -= dz / 1.6 * k; b.z += dz / 1.6 * k;
          }
        }
      }
    }

    // ---------- phone HUD (wwPark, only on change) ----------
    function syncHud(id, force) {
      const d = dogs[id];
      if (!d) return;
      const t = toyOf(id);
      const st = { ready: t ? 0 : 1, tired: (d.resting || api.tired(id)) ? 1 : 0, toy: t ? t.key : null };
      const key = st.ready + '|' + st.tired + '|' + st.toy;
      if (!force && sent[id] === key) return;
      sent[id] = key;
      api.send(id, { t: 'wwPark', ready: st.ready, tired: st.tired, toy: st.toy });
    }

    // ---------- decoration ----------
    function buildDecor() {
      const PATCH = [[-0.62, 0.8], [0.58, 0.86], [-0.14, 0.56], [0.7, 0.36], [-0.8, 0.24], [0.16, 0.18]];
      const COLS = ['#fffaf0', '#ffd60a', '#ff8fb1', '#c9a2ff', '#ff7a6b', '#ffffff'];
      PATCH.forEach(([u, p], i) => {
        const z = p * DEPTH, f = { x: CX + u * (HALF_W - 40) / scaleAt(z), z, items: [] };
        const n = 7 + Math.floor(deco() * 4), c1 = COLS[i % COLS.length], c2 = COLS[(i + 2) % COLS.length];
        for (let k = 0; k < n; k++) {
          f.items.push({ dx: (deco() - 0.5) * 60, dz: (deco() - 0.5) * 26, h: 6 + deco() * 7, r: 2.6 + deco() * 1.4, c: deco() < 0.6 ? c1 : c2, ph: deco() * TAU });
        }
        f.items.sort((a, b) => b.dz - a.dz);
        flowers.push(f);
      });
      [[110, 70, 1.1, 7], [450, 104, 0.8, 5], [700, 52, 1.25, 9], [930, 120, 0.7, 4]].forEach(c => clouds.push({ x: c[0], y: c[1], s: c[2], sp: c[3] }));
      flies.push({ patch: 2, ph: 0.4, c: '#ffe066' }, { patch: 0, ph: 2.2, c: '#ffb3e1' }, { patch: 3, ph: 4.1, c: '#bfe3ff' });
    }
    function hill(c, base, amp, freq, ph, col) {
      c.beginPath(); c.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) c.lineTo(x, base - amp * (Math.sin(x * freq + ph) * 0.6 + Math.sin(x * freq * 2.3 + ph * 1.7) * 0.4));
      c.lineTo(W, H); c.closePath(); c.fillStyle = col; c.fill();
    }
    function tree(c, x, base, size, col) {
      c.fillStyle = '#7a5434'; c.fillRect(x - size * 0.08, base - size * 0.9, size * 0.16, size * 0.9);
      c.fillStyle = col;
      [[0, -1.3, 0.6], [-0.42, -1.02, 0.47], [0.42, -1.04, 0.5], [0, -0.82, 0.52]].forEach(b => {
        c.beginPath(); c.arc(x + b[0] * size, base + b[1] * size, b[2] * size, 0, TAU); c.fill();
      });
      c.fillStyle = 'rgba(255,255,255,.13)'; c.beginPath(); c.arc(x - 0.2 * size, base - 1.42 * size, 0.28 * size, 0, TAU); c.fill();
      c.fillStyle = 'rgba(0,40,0,.13)'; c.beginPath(); c.arc(x + 0.26 * size, base - 0.76 * size, 0.38 * size, 0, TAU); c.fill();
    }
    function bush(c, x, y, s, col) {
      [[-14, -6, 13], [0, -12, 16], [15, -6, 13], [6, -2, 11], [-6, -2, 11]].forEach(b => {
        c.fillStyle = col; c.beginPath(); c.arc(x + b[0] * s, y + b[1] * s, b[2] * s, 0, TAU); c.fill();
      });
      c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.arc(x - 4 * s, y - 18 * s, 6 * s, 0, TAU); c.fill();
    }
    function paintBackground(c) {
      // sky + sun
      let gr = c.createLinearGradient(0, 0, 0, 210);
      gr.addColorStop(0, '#62b9ef'); gr.addColorStop(0.75, '#bde6fb'); gr.addColorStop(1, '#e4f6fc');
      c.fillStyle = gr; c.fillRect(0, 0, W, 240);
      gr = c.createRadialGradient(836, 78, 8, 836, 78, 160);
      gr.addColorStop(0, 'rgba(255,250,210,.95)'); gr.addColorStop(0.22, 'rgba(255,238,170,.5)'); gr.addColorStop(1, 'rgba(255,238,170,0)');
      c.fillStyle = gr; c.fillRect(660, 0, 320, 250);
      c.fillStyle = '#fff9da'; c.beginPath(); c.arc(836, 78, 30, 0, TAU); c.fill();
      // hills + back meadow + tree line
      hill(c, 168, 15, 0.009, 1.2, 'rgba(160,212,160,.95)');
      hill(c, 186, 11, 0.014, 3.9, '#a3d593');
      gr = c.createLinearGradient(0, 192, 0, BACK_Y);
      gr.addColorStop(0, '#addf8c'); gr.addColorStop(1, '#94cf72');
      c.fillStyle = gr; c.fillRect(0, 194, W, BACK_Y - 192);
      const TREES = ['#4f9d4c', '#5aaa55', '#47924a', '#62b05a'];
      for (let i = 0; i < 19; i++) {
        const x = i * 54 + deco() * 30 - 10;
        if (x > 610 && x < 870) continue;                 // keep the pond view open
        tree(c, x, 205 + deco() * 6, 18 + deco() * 13, TREES[i % TREES.length]);
      }
      [[598, 204], [884, 206], [258, 203]].forEach(([x, b]) => {   // poplars
        c.fillStyle = '#7a5434'; c.fillRect(x - 2, b - 14, 4, 14);
        c.fillStyle = '#4a944a'; c.beginPath(); c.ellipse(x, b - 40, 10, 30, 0, 0, TAU); c.fill();
        c.fillStyle = 'rgba(255,255,255,.1)'; c.beginPath(); c.ellipse(x - 3, b - 48, 4, 16, 0, 0, TAU); c.fill();
      });
      tree(c, -6, 222, 52, '#4c984a');
      tree(c, 972, 224, 56, '#529f4d');
      // pond
      c.fillStyle = '#82c066'; c.beginPath(); c.ellipse(742, 219, 116, 16, 0, 0, TAU); c.fill();
      gr = c.createLinearGradient(0, 205, 0, 232);
      gr.addColorStop(0, '#7fd0f2'); gr.addColorStop(1, '#3f9fcc');
      c.fillStyle = gr; c.beginPath(); c.ellipse(742, 219, 106, 12, 0, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.ellipse(712, 214, 56, 2.2, 0, 0, TAU); c.fill();
      [[690, 222, 9], [790, 217, 7], [760, 226, 6]].forEach(([x, y, r]) => {
        c.fillStyle = '#4f9a45'; c.beginPath(); c.ellipse(x, y, r, r * 0.38, 0, 0.35, TAU - 0.2); c.lineTo(x, y); c.fill();
      });
      c.fillStyle = '#ff9fc4'; c.beginPath(); c.arc(792, 215, 2.4, 0, TAU); c.fill();
      [[630, 1], [648, -1], [852, 1], [838, -1]].forEach(([x, lean]) => {
        for (let k = 0; k < 4; k++) {
          const bx = x + k * 4, top = 196 + deco() * 8;
          c.strokeStyle = '#4f8f3c'; c.lineWidth = 1.6;
          c.beginPath(); c.moveTo(bx, 226); c.quadraticCurveTo(bx + lean * 2, 212, bx + lean * 4, top); c.stroke();
          if (k % 2 === 0) { c.fillStyle = '#7a4e2a'; c.beginPath(); c.ellipse(bx + lean * 4, top + 3, 1.8, 4.5, lean * 0.2, 0, TAU); c.fill(); }
        }
      });
      // bench + lamp
      c.save(); c.translate(168, 217); c.scale(0.6, 0.6);
      c.fillStyle = '#6b4a2e'; c.fillRect(-38, -16, 5, 16); c.fillRect(33, -16, 5, 16); c.fillRect(-40, -40, 4, 26); c.fillRect(36, -40, 4, 26);
      c.fillStyle = '#b07a46'; c.fillRect(-46, -20, 92, 6); c.fillRect(-46, -38, 92, 5); c.fillRect(-46, -30, 92, 5);
      c.restore();
      c.fillStyle = '#3f4d48'; c.fillRect(318, 160, 3, 58); c.fillRect(313, 214, 13, 4);
      c.fillStyle = '#2f3a36'; c.fillRect(312, 150, 15, 4); c.fillStyle = '#fff1b8'; c.fillRect(314, 154, 11, 9);
      // lawn + converging mowing stripes + grass texture
      gr = c.createLinearGradient(0, BACK_Y, 0, FRONT_Y + 10);
      gr.addColorStop(0, '#98d774'); gr.addColorStop(1, '#5db84a');
      c.fillStyle = gr; c.fillRect(0, BACK_Y - 2, W, FRONT_Y + 12 - BACK_Y);
      c.fillStyle = 'rgba(255,255,255,.065)';
      for (let i = -15; i <= 15; i += 2) {
        const x0 = CX + i * 96, x1 = x0 + 96;
        const f0 = proj(x0, -14, 0), f1 = proj(x1, -14, 0), b0 = proj(x0, DEPTH, 0), b1 = proj(x1, DEPTH, 0);
        c.beginPath(); c.moveTo(f0.x, f0.y); c.lineTo(f1.x, f1.y); c.lineTo(b1.x, b1.y); c.lineTo(b0.x, b0.y); c.closePath(); c.fill();
      }
      const TONES = ['rgba(40,110,40,.3)', 'rgba(255,255,255,.15)', 'rgba(60,130,45,.26)', 'rgba(130,196,90,.35)'];
      c.lineWidth = 1;
      for (let i = 0; i < 1500; i++) {
        const p = Math.pow(deco(), 0.85), y = FRONT_Y + 8 - (FRONT_Y + 8 - BACK_Y) * p, x = deco() * W, len = 2 + 5 * (1 - p);
        c.strokeStyle = TONES[(deco() * TONES.length) | 0];
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + (deco() - 0.5) * 2, y - len); c.stroke();
      }
      flowers.forEach(f => {   // darker clumps under the flower patches
        const p = proj(f.x, f.z, 0);
        c.fillStyle = 'rgba(50,120,45,.22)'; c.beginPath(); c.ellipse(p.x, p.y, 44 * p.s, 13 * p.s, 0, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(45,115,40,.6)'; c.lineWidth = 1.2;
        for (let k = 0; k < 14; k++) {
          const bx = p.x + (deco() - 0.5) * 70 * p.s, by = p.y + (deco() - 0.5) * 18 * p.s;
          c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + (deco() - 0.5) * 4, by - (5 + deco() * 6) * p.s); c.stroke();
        }
      });
      // back fence + bushes
      for (let x = 6; x < W; x += 44) {
        c.fillStyle = '#c0915c'; c.fillRect(x, BACK_Y - 24, 6, 26);
        c.fillStyle = '#a07344'; c.fillRect(x + 3, BACK_Y - 24, 3, 26);
        c.fillStyle = '#d7aa74'; c.beginPath(); c.moveTo(x, BACK_Y - 24); c.lineTo(x + 3, BACK_Y - 28); c.lineTo(x + 6, BACK_Y - 24); c.fill();
      }
      c.fillStyle = '#d2a46e'; c.fillRect(0, BACK_Y - 19, W, 4); c.fillRect(0, BACK_Y - 10, W, 4);
      c.fillStyle = 'rgba(90,60,30,.25)'; c.fillRect(0, BACK_Y - 15, W, 1.5); c.fillRect(0, BACK_Y - 6, W, 1.5);
      [[34, 0.9], [96, 0.7], [402, 0.8], [470, 0.62], [560, 0.75], [930, 0.95]].forEach(([x, s]) => bush(c, x, BACK_Y + 3, s, '#4a9a48'));
      // front path where the owners stand
      const PY = FRONT_Y + 6;
      gr = c.createLinearGradient(0, PY, 0, H);
      gr.addColorStop(0, '#ecdaab'); gr.addColorStop(1, '#d3b67e');
      c.fillStyle = gr; c.fillRect(0, PY, W, H - PY);
      c.fillStyle = 'rgba(120,90,40,.16)'; c.fillRect(0, PY, W, 3);
      const PEB = ['#c8ab76', '#f3e6c4', '#b39765', '#e0c995'];
      for (let i = 0; i < 240; i++) {
        c.fillStyle = PEB[i % PEB.length];
        c.beginPath(); c.ellipse(deco() * W, PY + 5 + deco() * (H - PY - 5), 1 + deco() * 1.8, 0.8 + deco(), 0, 0, TAU); c.fill();
      }
      c.strokeStyle = '#5bb54a'; c.lineWidth = 1.4;
      for (let x = 0; x < W; x += 3.5) {
        c.beginPath(); c.moveTo(x, PY + 2); c.lineTo(x + (deco() - 0.5) * 3, PY - 2 - deco() * 6); c.stroke();
      }
    }

    // ---------- drawing ----------
    function drawClouds(g) {
      clouds.forEach(cl => {
        g.fillStyle = 'rgba(255,255,255,.93)';
        [[0, 0, 22], [20, -9, 18], [38, 0, 20], [17, 5, 19], [-18, 4, 14], [54, 5, 13]].forEach(b => {
          g.beginPath(); g.arc(cl.x + b[0] * cl.s, cl.y + b[1] * cl.s, b[2] * cl.s, 0, TAU); g.fill();
        });
        g.fillStyle = 'rgba(170,200,225,.25)';
        g.beginPath(); g.ellipse(cl.x + 18 * cl.s, cl.y + 14 * cl.s, 38 * cl.s, 6 * cl.s, 0, 0, TAU); g.fill();
      });
    }
    function drawPondGlints(g, tm) {
      [[700, 217], [748, 222], [796, 220]].forEach(([x, y], i) => {
        const a = (Math.sin(tm * 2.2 + i * 2.1) + 1) / 2;
        g.fillStyle = 'rgba(255,255,255,' + (0.75 * a).toFixed(3) + ')';
        g.beginPath(); g.ellipse(x + Math.sin(tm * 0.6 + i) * 6, y, 6 * a + 1, 1.2, 0, 0, TAU); g.fill();
      });
    }
    function drawFlowers(g, tm) {
      flowers.forEach(f => f.items.forEach(it => {
        const p = proj(f.x + it.dx, f.z + it.dz, 0), s = p.s, sw = Math.sin(tm * 1.7 + it.ph) * 1.8 * s;
        const cx = p.x + sw, cy = p.y - it.h * s, r = it.r * s;
        g.strokeStyle = '#3d8a3a'; g.lineWidth = 1.3 * s;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(cx, cy); g.stroke();
        g.fillStyle = it.c;
        for (let i = 0; i < 5; i++) {
          const a = i * 1.2566 + it.ph;
          g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, r * 0.68, 0, TAU); g.fill();
        }
        g.fillStyle = '#ffc93c'; g.beginPath(); g.arc(cx, cy, r * 0.5, 0, TAU); g.fill();
      }));
    }
    function drawFlies(g, tm) {
      flies.forEach(b => {
        const f = flowers[b.patch];
        const p = proj(f.x + Math.sin(tm * 0.7 + b.ph) * 60, f.z + Math.cos(tm * 0.5 + b.ph * 1.3) * 22, 34 + Math.sin(tm * 2.1 + b.ph) * 12);
        const s = p.s, flap = Math.abs(Math.sin(tm * 13 + b.ph));
        g.fillStyle = b.c;
        g.beginPath(); g.ellipse(p.x - 3 * s, p.y, 4.5 * s * flap + 0.8, 3.4 * s, -0.4, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(p.x + 3 * s, p.y, 4.5 * s * flap + 0.8, 3.4 * s, 0.4, 0, TAU); g.fill();
        g.fillStyle = '#3a3a3a'; g.fillRect(p.x - 0.7, p.y - 2.6 * s, 1.4, 5.2 * s);
      });
    }
    function arm(g, sx, sy, a, col, skin) {
      const L = 25, ex = sx + Math.sin(a) * L, ey = sy + Math.cos(a) * L;
      g.strokeStyle = col; g.lineWidth = 8; g.lineCap = 'round';
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + (ex - sx) * 0.8, sy + (ey - sy) * 0.8); g.stroke();
      g.fillStyle = skin; g.beginPath(); g.arc(ex, ey, 4.6, 0, TAU); g.fill();
      return { x: ex, y: ey };
    }
    // Owners seen from behind — we stand with them looking into the park.
    function drawOwner(g, o, tm) {
      const p = proj(o.x, OWNER_Z, 0), s = p.s * OWNER_SCALE, col = api.color(o.id);
      const cheer = o.cheerT > 0;
      const bob = cheer ? -Math.abs(Math.sin(tm * 13)) * 6 : Math.sin(tm * 1.6 + o.ph) * 0.8;
      g.save(); g.translate(p.x, p.y); g.scale(s, s);
      g.fillStyle = 'rgba(60,40,10,.22)'; g.beginPath(); g.ellipse(0, 0, 25, 6, 0, 0, TAU); g.fill();
      g.fillStyle = '#3a3f5c';
      rr(g, -12, -40 + bob, 10, 40 - bob, 4); g.fill();
      rr(g, 2, -40 + bob, 10, 40 - bob, 4); g.fill();
      g.fillStyle = '#26262f';
      g.beginPath(); g.ellipse(-7, -1, 7, 4, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(7, -1, 7, 4, 0, 0, TAU); g.fill();
      g.fillStyle = col; rr(g, -17, -84 + bob, 34, 48, 13); g.fill();
      g.fillStyle = 'rgba(0,0,0,.15)'; rr(g, -17, -50 + bob, 34, 14, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,.14)'; rr(g, -13, -82 + bob, 9, 30, 5); g.fill();
      const sy = -78 + bob, tp = o.throwT > 0 ? o.throwT / THROW_TIME : -1;
      let aR = 0.3, aL = 0.3;
      if (cheer) { aR = 2.7 + Math.sin(tm * 13) * 0.25; aL = 2.7 - Math.sin(tm * 13) * 0.25; }
      else if (tp >= 0) aR = tp < 0.25 ? lerp(0.3, -0.5, tp / 0.25) : tp < 0.55 ? lerp(-0.5, 2.9, (tp - 0.25) / 0.3) : lerp(2.9, 0.3, (tp - 0.55) / 0.45);
      const hand = arm(g, 14, sy, aR, col, o.skin);
      arm(g, -14, sy, -aL, col, o.skin);
      g.fillStyle = o.skin; g.fillRect(-4, -92 + bob, 8, 9);
      g.beginPath(); g.arc(-12, -97 + bob, 3.2, 0, TAU); g.fill();
      g.beginPath(); g.arc(12, -97 + bob, 3.2, 0, TAU); g.fill();
      g.fillStyle = o.hair; g.beginPath(); g.arc(0, -99 + bob, 12.5, 0, TAU); g.fill();
      if (o.style === 1) { g.beginPath(); g.arc(0, -113 + bob, 6, 0, TAU); g.fill(); }
      else if (o.style === 2) { g.beginPath(); g.ellipse(0, -84 + bob, 5, 11, 0, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(-4, -104 + bob, 5, 0, TAU); g.fill();
      if (!toyOf(o.id) && tp < 0 && !cheer) WW.art.drawToy(g, o.lastToy, hand.x + 1, hand.y + 5, 0.95, 0);
      g.restore();
    }
    function drawTag(g, o) {
      const p = proj(o.x, OWNER_Z, 0), name = api.owner(o.id);
      g.font = 'bold 12px ' + FONT;
      const w = g.measureText(name).width + 24, y = p.y - 128 * p.s * OWNER_SCALE;
      g.fillStyle = 'rgba(12,14,28,.62)'; rr(g, p.x - w / 2, y - 9, w, 18, 9); g.fill();
      g.fillStyle = api.color(o.id); g.beginPath(); g.arc(p.x - w / 2 + 9, y, 4, 0, TAU); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(name, p.x + 5, y);
    }
    function poseOf(d) {
      const spd = Math.hypot(d.vx, d.vz);
      if (d.resting) return d.restT > 2.5 ? 'sleep' : 'lie';
      if (d.hopT > 0) return 'jump';
      if (d.state === 'sniff' || d.state === 'pickup') return 'eat';
      if (d.state === 'celebrate') return 'beg';
      if (d.sit && spd < 10) return 'sit';
      return spd > 150 ? 'run' : spd > 12 ? 'walk' : 'stand';
    }
    function drawDogSprite(g, d, tm) {
      const dog = api.dog(d.id);
      if (!dog) return;
      const p = proj(d.x, d.z, 0), s = p.s * DOG_SCALE, lift = d.hop * p.s;
      if (lift > 0.5) {
        const k = Math.min(0.6, lift / 80);
        g.fillStyle = 'rgba(30,60,20,' + (0.24 * (1 - k)).toFixed(3) + ')';
        g.beginPath(); g.ellipse(p.x, p.y, 36 * s * (1 - k * 0.5), 6 * s * (1 - k * 0.5), 0, 0, TAU); g.fill();
      }
      // a soft ring in the owner's color tells "which one is mine" from the couch
      g.strokeStyle = api.color(d.id); g.globalAlpha = 0.6; g.lineWidth = 2.4 * p.s;
      g.beginPath(); g.ellipse(p.x, p.y, 40 * s, 8 * s, 0, 0, TAU); g.stroke();
      g.globalAlpha = 1;
      const carried = d.carry != null ? toyById(d.carry) : null;
      const st = d.state, n = dog.needs;
      WW.art.drawDog(g, dog, p.x, p.y - lift, {
        scale: s, facing: d.facing, pose: poseOf(d), t: tm + d.ph,
        wag: d.resting ? 0 : st === 'sad' ? 0.1 : (st === 'celebrate' || st === 'chase' || PLAY.indexOf(st) >= 0) ? 1 : 0.55,
        dirt: n.clean < 45 ? (45 - n.clean) / 45 : 0,
        tongue: !d.resting && (st === 'chase' || st === 'return' || st === 'celebrate' || st === 'zoom' || n.energy < 40),
        mouth: carried ? carried.key : null, collar: api.color(d.id),
        shadow: lift <= 0.5
      });
      if (d.markT > 0 && d.mark) {
        const hp = headPos(d), a = Math.min(1, d.markT * 3);
        g.globalAlpha = a;
        g.font = 'bold ' + Math.round(16 + 6 * p.s) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillText(d.mark, hp.x + 1, hp.y - 20 * p.s - (0.8 - d.markT) * 14 + 1);
        g.fillStyle = d.markC; g.fillText(d.mark, hp.x, hp.y - 20 * p.s - (0.8 - d.markT) * 14);
        g.globalAlpha = 1;
      }
    }
    function drawToyShadow(g, t, tm) {
      if (t.state !== 'flight' && t.state !== 'ground') return;
      const p = proj(t.x, t.z, 0), k = Math.min(0.7, t.h / 320), r = 8.5 * p.s * TOY_SCALE * (1 - k * 0.5);
      g.fillStyle = 'rgba(30,60,20,' + (0.32 * (1 - k)).toFixed(3) + ')';
      g.beginPath(); g.ellipse(p.x, p.y, r, r * 0.36, 0, 0, TAU); g.fill();
      if (t.state === 'ground') {            // a lying toy pulses softly so it reads from the couch
        const a = 0.25 + 0.2 * Math.sin(tm * 5 + t.uid);
        g.strokeStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')'; g.lineWidth = 2 * p.s;
        g.beginPath(); g.ellipse(p.x, p.y, r * 1.9, r * 0.7, 0, 0, TAU); g.stroke();
      }
    }
    function drawToySprite(g, t) {
      let x, y, s, rot;
      if (t.state === 'handback') {
        const k = Math.min(1, t.hb.t / t.hb.dur);
        x = lerp(t.hb.ax, t.hb.bx, k); y = lerp(t.hb.ay, t.hb.by, k) - Math.sin(Math.PI * k) * 80; s = 1.05; rot = k * 9;
      } else {
        const p = proj(t.x, t.z, t.h);
        x = p.x; y = p.y; s = p.s;
        rot = t.key === 'frisbee' ? (t.state === 'flight' ? Math.sin(t.wob) * 0.3 : 0) : t.rot;
      }
      const r = 7 * s * TOY_SCALE;
      if (t.trail.length > 1) {
        g.fillStyle = '#ffffff';
        t.trail.forEach((q, i) => {
          const k = i / t.trail.length;
          g.globalAlpha = 0.05 + 0.25 * k;
          g.beginPath(); g.arc(q[0], q[1] - r, r * (0.25 + 0.4 * k), 0, TAU); g.fill();
        });
        g.globalAlpha = 1;
      }
      g.save(); g.translate(x, y);
      g.scale(1 + 0.32 * t.squash, 1 - 0.28 * t.squash);
      WW.art.drawToy(g, t.key, 0, -r, s * TOY_SCALE, rot);
      g.restore();
    }
    function drawParts(g) {
      parts.forEach(p => {
        const k = p.life / p.max, a = Math.max(0, 1 - k);
        if (p.k === 'dust') {
          g.globalAlpha = 0.55 * a; g.fillStyle = p.c;
          g.beginPath(); g.arc(p.x, p.y, p.r * (1 + k * 1.4), 0, TAU); g.fill();
        } else if (p.k === 'blade' || p.k === 'leaf') {
          g.globalAlpha = a; g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
          g.fillStyle = p.c;
          if (p.k === 'blade') g.fillRect(-p.r / 2, -0.8, p.r, 1.6);
          else { g.beginPath(); g.ellipse(0, 0, p.r, p.r * 0.5, 0, 0, TAU); g.fill(); }
          g.restore();
        } else if (p.k === 'spark') {
          g.globalCompositeOperation = 'lighter'; g.globalAlpha = a; g.fillStyle = p.c;
          g.beginPath(); g.moveTo(p.x, p.y - p.r * 2); g.lineTo(p.x + p.r * 0.6, p.y); g.lineTo(p.x, p.y + p.r * 2); g.lineTo(p.x - p.r * 0.6, p.y); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(p.x - p.r * 2, p.y); g.lineTo(p.x, p.y + p.r * 0.6); g.lineTo(p.x + p.r * 2, p.y); g.lineTo(p.x, p.y - p.r * 0.6); g.closePath(); g.fill();
          g.globalCompositeOperation = 'source-over';
        } else if (p.k === 'ring') {
          g.globalAlpha = a; g.strokeStyle = p.c; g.lineWidth = 3 * a + 0.5;
          g.beginPath(); g.arc(p.x, p.y, p.r + k * 36, 0, TAU); g.stroke();
        } else if (p.k === 'text') {
          g.globalAlpha = Math.min(1, a * 1.6); g.fillStyle = p.c;
          g.font = 'bold ' + Math.round(p.r) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(p.t, p.x + (p.wob ? Math.sin(p.life * 3) * 6 : 0), p.y);
        }
      });
      g.globalAlpha = 1;
    }

    return {
      enter(ids) {
        dogs = {}; owners = {}; toys = []; parts = []; sent = {}; sounds = {}; lonelyT = 0;
        ids.forEach(id => { owners[id] = makeOwner(id); });
        layoutOwners(true);
        ids.forEach(id => { dogs[id] = makeDog(id); syncHud(id, true); });
      },
      leave() {
        Object.keys(owners).forEach(k => api.send(+k, { t: 'wwPark', ready: 1, tired: 0, toy: null }));
        each(d => { d.chase = null; d.carry = null; });
        toys = []; parts = []; sent = {};
      },
      addDog(id) {
        if (dogs[id]) return;
        owners[id] = makeOwner(id);
        layoutOwners(false);
        owners[id].x = owners[id].tx;
        dogs[id] = makeDog(id);
        const p = proj(owners[id].x, OWNER_Z, 0);
        puff(p.x, p.y, 1, 8, '#ffffff');
        syncHud(id, true);
      },
      removeDog(id) {
        const d = dogs[id];
        if (d && d.carry != null) {
          const t = toyById(d.carry);
          d.carry = null;
          if (t) { if (t.owner !== id && owners[t.owner]) poofBack(t, proj(d.x, d.z, 20)); else killToy(t); }
        }
        toys.filter(t => t.owner === id).forEach(killToy);
        each(o => { if (o.partner === id) { o.partner = null; if (PLAY.indexOf(o.state) >= 0) toIdle(o, 0.5); } });
        delete dogs[id]; delete owners[id]; delete sent[id];
        layoutOwners(false);
      },
      onMessage(id, d) {
        if (!d || d.t !== 'wwThrow') return;
        const dog = api.dog(id);
        if (!dog || !dogs[id] || !owners[id]) return;
        const key = String(d.toy || ''), it = WW.ITEMS[key];
        // A rejected throw (toy still out, e.g. being carried back) re-sends the
        // real state, so the phone's pad doesn't stay in its throw animation.
        if (!it || it.kind !== 'toy' || dog.toys.indexOf(key) < 0 || toyOf(id)) { syncHud(id, true); return; }
        throwToy(id, key, num(d.dx, 0), num(d.dy, -1), clamp(num(d.power, 0.6), 0.15, 1));
      },
      update(dt) {
        Object.keys(owners).forEach(k => {
          const o = owners[k];
          o.x += (o.tx - o.x) * Math.min(1, dt * 3);
          if (o.throwT > 0) { o.throwT += dt; if (o.throwT >= THROW_TIME) o.throwT = 0; }
          if (o.cheerT > 0) o.cheerT = Math.max(0, o.cheerT - dt);
        });
        toys.slice().forEach(t => updateToy(t, dt));
        each(d => updateDog(d, dt));
        separate();
        lonely(dt);
        parts.forEach(p => {
          p.life += dt; p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; p.vy = (p.vy || 0) + (p.g || 0) * dt;
          if (p.vr) p.rot += p.vr * dt;
        });
        parts = parts.filter(p => p.life < p.max);
        clouds.forEach(cl => { cl.x += cl.sp * dt; if (cl.x > W + 90) cl.x = -90; });
        Object.keys(owners).forEach(k => syncHud(+k));
      },
      draw(g) {
        const tm = api.time();
        if (!bg) {
          bg = document.createElement('canvas');
          bg.width = W; bg.height = H;
          paintBackground(bg.getContext('2d'));
        }
        g.drawImage(bg, 0, 0);
        drawClouds(g);
        drawPondGlints(g, tm);
        drawFlowers(g, tm);
        toys.forEach(t => drawToyShadow(g, t, tm));
        const list = [];
        each(d => list.push({ z: d.z, f: () => drawDogSprite(g, d, tm) }));
        toys.forEach(t => {
          if (t.state === 'flight' || t.state === 'ground') list.push({ z: t.state === 'flight' && t.z < 24 ? -100 : t.z, f: () => drawToySprite(g, t) });
        });
        Object.keys(owners).forEach(k => list.push({ z: OWNER_Z, f: () => drawOwner(g, owners[k], tm) }));
        list.sort((a, b) => b.z - a.z);
        list.forEach(e => e.f());
        toys.forEach(t => { if (t.state === 'handback') drawToySprite(g, t); });
        drawParts(g);
        drawFlies(g, tm);
        Object.keys(owners).forEach(k => drawTag(g, owners[k]));
      },
      dogPos(id) {
        const d = dogs[id], dog = api.dog(id);
        if (!d || !dog) return null;
        const p = proj(d.x, d.z, d.hop), pts = WW.art.points(dog, p.s * DOG_SCALE);
        return { x: p.x + pts.head[0] * d.facing * 0.5, y: p.y - pts.h - 8 };
      },
      // Harness only: bots throw a random owned toy whenever their hand is free.
      devBot(id, rnd) {
        const dog = api.dog(id);
        if (!dog || !dogs[id] || !owners[id] || toyOf(id) || rnd() > 0.018) return null;
        const toy = dog.toys[Math.floor(rnd() * dog.toys.length)] || 'ball';
        const dx = rnd() * 1.6 - 0.8, dy = -(0.3 + rnd() * 0.7), l = Math.hypot(dx, dy);
        return { t: 'wwThrow', toy, dx: dx / l, dy: dy / l, power: 0.3 + rnd() * 0.7 };
      }
    };
  };
})();
