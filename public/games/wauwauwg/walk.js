// Wauwau-WG — scene "walk" (🦮 Gassi-Runde): a side-scrolling suburban street.
// Owners stroll in their player colors while each phone steers its dog on the
// leash (wwMove), digs at sniff spots for loot (wwDig), picks up after it
// (wwPoop) and calls it back from cat chases (wwHeel).
// Contract: docs/WAUWAUWG.md §Scenes. Screen coordinates are 960×600; the
// street scrolls horizontally only (world x − camX = screen x).
(function () {
  'use strict';
  const WW = window.WW;
  const clamp = WW.clamp;

  // ---------- tunables (honest guesses until people play) ----------
  const CAM_SPEED = 62;            // px/s the street scrolls (the pack's walking pace)
  const DOG_SPEED = 175;           // px/s screen speed at full stick
  const HEEL_SPEED = 95;           // px/s trotting back to heel when the stick is idle
  const CHASE_SPEED = 250;         // px/s while chasing the cat
  const DEADZONE = 0.12;           // stick magnitude that counts as "idle"
  const LEASH = 168;               // px max distance owner feet → dog
  const SEPARATION = 44;           // px dogs keep between each other
  const DIG_TAPS = 6;              // wwDig taps to unearth a spot
  const DIG_HOLD = 0.42;           // s the dig pose (and standstill) holds after a tap
  const DIG_DECAY = 0.12;          // progress lost per s when not digging
  const SNIFF_TIME = 1.4;          // s an idle dog stops at a fresh smell
  const SPOT_EVERY = 11;           // s between sniff spots for a solo dog (more dogs → more often)
  const SPOTS_MAX = 2;             // + one per dog: undug spots around at once
  const POPUP_SHARE = [0.45, 0.06, 0.85]; // share of spots popping up ahead of the dog with the fewest finds: base + per dog, max
  const RESERVE_TIME = 3;          // s a pop-up smell belongs to its dog alone
  const PUDDLE_GAP = [1100, 1800]; // world px between puddles
  const PUDDLE_CLEAN = -25;        // Sauberkeit per splash
  const POOP_FIRST = [14, 32];     // s until a dog's first squat
  const POOP_EVERY = [40, 70];     // s between squats
  const SQUAT_TIME = 1.2;          // s
  const POOP_WINDOW = 7;           // s the phone may pick it up
  const CAT_FIRST = [30, 45];      // s into the walk
  const CAT_AGAIN = [60, 80];      // s until another cat (only long walks get one)
  const CAT_SPEED = 300;           // px/s dash
  const CAT_RANGE = 360;           // px — dogs closer than this give chase
  const CHASE_TIME = 2.5;          // s
  const SEND_GAP = 0.25;           // s between wwWalk updates per dog (≤ 4/s)

  // ---------- street layout (screen y) ----------
  const HOUSE_BASE = 318, FENCE_Y = 352, GRASS_Y = 448, CURB_Y = 508, ROAD_Y = 516;
  const OWNER_Y = 376, BAND_TOP = 396, BAND_BOT = 504;
  const HEEL_DX = 54, HEEL_ROWS = [430, 468, 448, 488];
  const DOG_SCALE = 0.95, OWNER_SCALE = 0.92;
  const FENCE_SEG = 260, PROP_SEG = 300, GATE_W = 40;

  const FONT = 'system-ui,sans-serif';
  const SPOT_KINDS = ['leaves', 'mole', 'bush', 'flowers'];
  const WALLS = ['#f4d6a0', '#f2b8a2', '#cfe3c3', '#bcd6ec', '#f3e5d3', '#e9c6d8', '#fff1c4', '#d8cfe9'];
  const ROOFS = ['#b5523b', '#8f4b3c', '#6d7b8c', '#a3653d', '#556079', '#9b3f45'];
  const DOORS = ['#7a4a2e', '#2f5d8a', '#a33b3b', '#3f6e4a', '#5b4a7a'];
  const SKIN = ['#f1c7a5', '#e2b08f', '#c98d66', '#8d5a3b', '#f6d5bd', '#b97a52'];
  const HAIR = ['#3b2a20', '#7a4b2a', '#d9b26a', '#1d1d1f', '#a33b22', '#8a8580'];
  const PANTS = ['#3b4252', '#2f3e5c', '#4a3f35', '#55606e', '#2e4a3f'];
  const LEAVES = ['#e07a2f', '#c94b2b', '#e9b23c', '#a8642c', '#d9952f'];
  const BLOOMS = ['#ff6b8a', '#ffd60a', '#bf5af2', '#ff9f0a', '#ffffff', '#64d2ff'];
  const CAT_COATS = [['#e8954a', '#c46f2c'], ['#3a3532', '#211e1c'], ['#9a9590', '#6f6a65'], ['#f2ede4', '#cfc5b6']];

  // Deterministic hash → [0,1): the scenery is a pure function of world x,
  // so nothing needs storing and it never flickers.
  function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function ell(o, x, y, rx, ry, rot) { o.beginPath(); o.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, Math.PI * 2); o.fill(); }
  function circ(o, x, y, r) { o.beginPath(); o.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); o.fill(); }
  function star(o, x, y, r) {
    o.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, q = i % 2 ? r * 0.38 : r; o.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
    o.closePath(); o.fill();
  }
  const persp = (y) => 0.84 + 0.22 * clamp((y - BAND_TOP) / (BAND_BOT - BAND_TOP), 0, 1);
  const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
  function drawMole(o, x, y, peek) {
    const hy = y + 8 - 15 * peek;
    o.fillStyle = '#4b4040'; circ(o, x, hy, 8);
    o.fillStyle = '#ffb3c1'; ell(o, x, hy + 2.5, 3, 2.2);
    o.fillStyle = '#111'; circ(o, x - 3.5, hy - 2.5, 1.1); circ(o, x + 3.5, hy - 2.5, 1.1);
    o.fillStyle = '#ffb3c1'; ell(o, x - 7, hy + 5, 3, 2); ell(o, x + 7, hy + 5, 3, 2);
  }

  WW.scenes.walk = function (api) {
    const W = api.W, H = api.H;
    let dogs = {}, order = [];
    let camX = 0;
    let spots = [], puddles = [], poops = [], items = [], parts = [];
    let spotClock = 0, nextPuddleX = 0, spotSeq = 0;
    let cat = null, catAt = 0;
    const bots = {}, sfxAt = {};
    let glowSoft = null, glowGold = null;
    const rnd = () => api.rnd();
    const range = (a) => a[0] + rnd() * (a[1] - a[0]);

    function sound(name, gap) {
      const now = api.time();
      if (sfxAt[name] != null && now - sfxAt[name] < (gap || 0.08)) return;
      sfxAt[name] = now;
      api.sfx(name);
    }

    // ---------- dogs & owners ----------
    function layout() {
      const n = order.length;
      order.forEach((id, i) => { const d = dogs[id]; d.slot = i; d.slotX = W * (i + 1) / (n + 1) - 36; });
    }
    function heelOf(d) { return { x: d.ox + HEEL_DX, y: HEEL_ROWS[d.slot % HEEL_ROWS.length] }; }
    function addDog(id, instant) {
      if (dogs[id] || !api.dog(id)) return;
      const now = api.time();
      const d = dogs[id] = {
        id, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, facing: 1, speed: CAM_SPEED,
        inX: 0, inY: 0, ox: 0, slotX: 0, slot: 0, pull: 0, taut: false,
        digAt: -9, onSpot: null, sniffT: 0, found: 0,
        squatT: 0, nextPoop: now + range(POOP_FIRST), poop: null,
        chaseT: 0, sitT: 0, shakeT: 0, shakeAt: 0,
        mud: 0, wet: 0, alpha: instant ? 1 : 0, scale: DOG_SCALE,
        seed: rnd() * 10, look: ownerLook(id), sentKey: '', sentAt: -9
      };
      order.push(id);
      layout();
      d.ox = d.slotX;
      const h = heelOf(d);
      d.x = d.px = h.x; d.y = d.py = h.y;
      d.scale = DOG_SCALE * persp(d.y);
      if (!instant) for (let i = 0; i < 14; i++) sparkle(d.x + camX + (rnd() - 0.5) * 50, d.y - 30 - rnd() * 30, '#fff3b0');
    }
    function removeDog(id) {
      if (!dogs[id]) return;
      delete dogs[id];
      order = order.filter(o => o !== id);
      spots.forEach(s => { delete s.prog[id]; });
      layout();
    }
    function ownerLook(id) {
      return {
        skin: SKIN[Math.floor(hash(id * 1.7 + 0.3) * SKIN.length)],
        hair: HAIR[Math.floor(hash(id * 2.9 + 0.7) * HAIR.length)],
        pants: PANTS[Math.floor(hash(id * 3.3 + 0.1) * PANTS.length)],
        style: Math.floor(hash(id * 4.1 + 0.9) * 5)
      };
    }
    // Leash geometry: shoulder → hand → collar.
    function collarOf(d) {
      const p = WW.art.points(api.dog(d.id), d.scale);
      return { x: d.x + d.facing * p.head[0] * 0.62, y: d.y + p.head[1] * 0.74 };
    }
    function handOf(d, c) {
      const s = OWNER_SCALE, sx = d.ox + 6 * s, sy = OWNER_Y - 90 * s;
      const ax = c.x - sx, ay = c.y - sy, m = Math.hypot(ax, ay) || 1;
      return { sx, sy, x: sx + ax / m * 30 * s, y: sy + ay / m * 30 * s };
    }
    function frontOf(d) {
      const p = WW.art.points(api.dog(d.id), d.scale);
      return { x: d.x + d.facing * p.w * 0.26, y: d.y };
    }
    function spotUnder(d) {
      const f = frontOf(d);
      const now = api.time();
      for (const s of spots) {
        if (s.dug || (now < s.until && s.forId !== d.id)) continue;   // reserved for another dog
        const dx = (f.x - (s.wx - camX)) / (s.r + 12), dy = (f.y - s.y) / (s.r * 0.55 + 12);
        if (dx * dx + dy * dy <= 1) return s;
      }
      return null;
    }
    const idle = (d) => Math.hypot(d.inX, d.inY) <= DEADZONE;
    const digging = (d, now) => now - d.digAt < DIG_HOLD;

    // ---------- the world ahead ----------
    function makeSpot(wx, y, kind, born, forId) {
      kind = kind || WW.pick(SPOT_KINDS, rnd);
      if (y == null) {
        const onGrass = kind !== 'leaves' || rnd() < 0.5;
        y = onGrass ? GRASS_Y + 14 + rnd() * (BAND_BOT - GRASS_Y - 20) : BAND_TOP + 10 + rnd() * (GRASS_Y - BAND_TOP - 22);
      }
      return {
        seq: ++spotSeq, wx, y, kind, r: kind === 'mole' ? 22 : kind === 'leaves' ? 27 : 28, prog: {}, sniffed: {}, dug: false, wig: -9,
        born, forId, until: born != null ? born + RESERVE_TIME : -9
      };
    }
    function spotFree(x, y) {
      return !spots.some(s => Math.abs(s.wx - camX - x) < 74 && Math.abs(s.y - y) < 44)
        && !puddles.some(p => Math.abs(p.wx - camX - x) < p.rx + 40 && Math.abs(p.y - y) < 30)
        && !order.some(id => Math.abs(dogs[id].x - x) < 40 && Math.abs(dogs[id].y - y) < 24);
    }
    // A smell right ahead of a dog, inside its leash reach. Pop-ups go to the dog
    // with the fewest finds this walk — the dog at the front of the pack would
    // otherwise get first pick of everything scrolling in from the right.
    function spotFor(d, now, popup) {
      for (let k = 0; k < 8; k++) {
        const kind = popup ? (rnd() < 0.6 ? 'mole' : 'leaves') : WW.pick(SPOT_KINDS, rnd);
        const x = clamp(d.x + d.facing * 20 + 30 + rnd() * 90, 70, W - 60);
        const y = kind === 'leaves' && rnd() < 0.5 ? BAND_TOP + 10 + rnd() * (GRASS_Y - BAND_TOP - 22) : GRASS_Y + 14 + rnd() * (BAND_BOT - GRASS_Y - 20);
        if (!spotFree(x, y)) continue;
        const s = makeSpot(x + camX, y, kind, popup ? now : null, d.id);
        spots.push(s);
        if (popup) popFx(s);
        return true;
      }
      return false;
    }
    function popFx(s) {
      if (s.kind === 'mole') {
        for (let i = 0; i < 10; i++) part({ wx: s.wx + (rnd() - 0.5) * 16, y: s.y - 4, vx: (rnd() - 0.5) * 160, vy: -90 - rnd() * 130, g: 560, life: 0.5, max: 0.5, size: 2 + rnd() * 2, color: rnd() < 0.5 ? '#7a5235' : '#93684a', kind: 'dot' });
      } else {
        for (let i = 0; i < 9; i++) part({ wx: s.wx + (rnd() - 0.5) * 70, y: s.y - 80 - rnd() * 50, vx: (rnd() - 0.5) * 30, vy: 40 + rnd() * 40, g: 50, life: 1.1, max: 1.1, size: 3.5, color: WW.pick(LEAVES, rnd), kind: 'leaf', rot: rnd() * 6 });
      }
    }
    function spawnTick(dt, now) {
      spotClock -= dt;
      if (spotClock <= 0) {
        const n = Math.max(1, order.length);
        spotClock = SPOT_EVERY / (0.6 + 0.4 * n) * (0.75 + rnd() * 0.5);
        if (spots.filter(s => !s.dug).length < SPOTS_MAX + n) {
          const need = order.map(id => dogs[id]).filter(d => d.chaseT <= 0)
            .map(d => ({ d, score: d.found + spots.filter(s => !s.dug && s.forId === d.id).length + rnd() * 0.5 }))
            .sort((a, b) => a.score - b.score)[0];
          const share = n > 1 ? Math.min(POPUP_SHARE[2], POPUP_SHARE[0] + POPUP_SHARE[1] * n) : POPUP_SHARE[0];
          if (!(need && rnd() < share && spotFor(need.d, now, true))) spots.push(makeSpot(camX + W + 40 + rnd() * 60));
        }
      }
      while (nextPuddleX < camX + W + 160) {
        const p = { wx: nextPuddleX, y: BAND_TOP + 12 + rnd() * (BAND_BOT - BAND_TOP - 26), rx: 32 + rnd() * 14, ry: 10 + rnd() * 4, hit: {}, rip: -9 };
        if (spots.some(s => Math.abs(s.wx - p.wx) < 80 && Math.abs(s.y - p.y) < 44)) p.wx += 110;
        puddles.push(p);
        nextPuddleX = p.wx + range(PUDDLE_GAP);
      }
    }
    // Front fence along the property line: picket / hedge / wall with a gate gap.
    function fenceSeg(seg) {
      const t = hash(seg * 3.7 + 1);
      return { type: t < 0.38 ? 'picket' : t < 0.74 ? 'hedge' : 'wall', gate: seg * FENCE_SEG + 70 + hash(seg * 5.3 + 2) * 110 };
    }
    function fenceTopAt(wx) {
      const seg = Math.floor(wx / FENCE_SEG), f = fenceSeg(seg);
      if (wx >= f.gate && wx <= f.gate + GATE_W) return FENCE_Y;
      return FENCE_Y - (f.type === 'picket' ? 30 : f.type === 'hedge' ? 40 : 24);
    }

    // ---------- particles ----------
    function part(p) { parts.push(p); if (parts.length > 500) parts.shift(); }
    function sparkle(wx, y, color) {
      part({ wx, y, vx: (rnd() - 0.5) * 70, vy: -30 - rnd() * 60, g: -10, life: 0.8 + rnd() * 0.4, max: 1.2, size: 3 + rnd() * 3, color, kind: 'star' });
    }
    function kickDirt(d, n) {
      const f = frontOf(d);
      for (let i = 0; i < n; i++) {
        part({ wx: f.x + camX, y: d.y - 3, vx: -d.facing * (60 + rnd() * 140), vy: -110 - rnd() * 140, g: 620, life: 0.55, max: 0.55, size: 2 + rnd() * 2.5, color: rnd() < 0.6 ? '#7a5235' : '#9a6c47', kind: 'dot' });
      }
    }
    function spray(d) {
      for (let i = 0; i < 18; i++) {
        const dir = rnd() < 0.5 ? -1 : 1;
        part({ wx: d.x + camX + dir * rnd() * 20, y: d.y - 30 * d.scale - rnd() * 16, vx: dir * (80 + rnd() * 160), vy: -60 - rnd() * 120, g: 520, life: 0.6, max: 0.6, size: 1.6 + rnd() * 2, color: '#b9def5', kind: 'drop' });
      }
    }
    function updateParts(dt) {
      parts.forEach(p => { p.wx += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.life -= dt; if (p.rot != null) p.rot += dt * 5; });
      parts = parts.filter(p => p.life > 0);
    }

    // ---------- events ----------
    function dig(d, now) {
      const s = spotUnder(d);
      if (!s || d.squatT > 0 || d.chaseT > 0) return;
      d.digAt = now; d.sniffT = 0; s.wig = now;
      s.prog[d.id] = Math.min(1, (s.prog[d.id] || 0) + 1 / DIG_TAPS);
      kickDirt(d, 5);
      if (s.kind === 'leaves') {
        const f = frontOf(d);
        part({ wx: f.x + camX, y: d.y - 6, vx: (rnd() - 0.5) * 160, vy: -120 - rnd() * 100, g: 260, life: 0.9, max: 0.9, size: 3.5, color: WW.pick(LEAVES, rnd), kind: 'leaf', rot: rnd() * 6 });
      }
      sound('dig', 0.12);
      if (s.prog[d.id] >= 1) unearth(s, d, now);
    }
    function unearth(s, d, now) {
      s.dug = true;
      d.found++;
      const r = api.find(d.id, WW.rollFind(api.rnd));
      if (!r) return;
      const it = WW.ITEMS[r.item] || WW.ITEMS.coin, rare = !!WW.RARE[r.item];
      const x = s.wx - camX;
      items.push({ wx: s.wx, y: s.y, emoji: it.emoji, t0: now, rare });
      api.event(d.id, r.text, {
        kind: 'find', item: r.item, color: rare ? '#ffd60a' : '#fff',
        floatText: r.coins ? '+' + r.coins + ' 🪙' : it.emoji + ' ' + it.label
      });
      api.love(d.id, 1, 'walk');
      api.needs(d.id, { clean: -2 });
      for (let i = 0; i < 12; i++) part({ wx: s.wx + (rnd() - 0.5) * 20, y: s.y - 4, vx: (rnd() - 0.5) * 220, vy: -150 - rnd() * 160, g: 640, life: 0.7, max: 0.7, size: 2 + rnd() * 3, color: rnd() < 0.5 ? '#7a5235' : '#a3774e', kind: 'dot' });
      for (let i = 0; i < (rare ? 22 : 8); i++) sparkle(s.wx + (rnd() - 0.5) * 40, s.y - 30 - rnd() * 40, rare ? '#ffd60a' : '#fff6c9');
      if (s.kind === 'leaves') for (let i = 0; i < 10; i++) part({ wx: s.wx, y: s.y - 6, vx: (rnd() - 0.5) * 260, vy: -160 - rnd() * 120, g: 240, life: 1.1, max: 1.1, size: 3.5, color: WW.pick(LEAVES, rnd), kind: 'leaf', rot: rnd() * 6 });
      sound('find', 0.15);
      if (rare) { sound('powerup', 0.3); api.float(x, s.y - 110, '✨ Selten! ✨', '#ffd60a'); }
    }
    function splash(d, p, now) {
      p.hit[d.id] = true; p.rip = now;
      d.mud = 1; d.wet = 1; d.shakeAt = now + 0.55;
      api.needs(d.id, { clean: PUDDLE_CLEAN, mood: 3 });   // dogs love mud
      api.event(d.id, 'Platsch! 💦 ' + api.dog(d.id).name + ' ist voller Matsch', { kind: 'bad', floatText: '💦 Platsch!', color: '#9bd2ff' });
      for (let i = 0; i < 16; i++) {
        part({ wx: d.x + camX + (rnd() - 0.5) * 30, y: d.y - 4, vx: (rnd() - 0.5) * 240, vy: -120 - rnd() * 170, g: 720, life: 0.7, max: 0.7, size: 2 + rnd() * 2.5, color: rnd() < 0.5 ? '#8c7b62' : '#a9cde0', kind: 'drop' });
      }
      sound('splash', 0.15);
    }
    function dropPoop(d, now) {
      const p = WW.art.points(api.dog(d.id), d.scale);
      const pp = { wx: d.x - d.facing * p.w * 0.42 + camX, y: d.y + 2, owner: d.id, until: now + POOP_WINDOW, t0: now };
      poops.push(pp);
      d.poop = pp;
      api.event(d.id, '💩 ' + api.dog(d.id).name + ' musste mal — aufsammeln!', { kind: 'info', float: false });
      sound('pop', 0.2);
    }
    function pickUp(d, now) {
      const p = d.poop;
      if (!p || now > p.until) return;
      d.poop = null;
      poops = poops.filter(q => q !== p);
      for (let i = 0; i < 12; i++) sparkle(p.wx + (rnd() - 0.5) * 24, p.y - 10 - rnd() * 16, '#b6ffb0');
      api.love(d.id, 3, 'walk');
      api.coins(d.id, 2);
      api.event(d.id, 'Vorbildlich! +2 🪙', { kind: 'good', floatText: '✨ Vorbildlich!', color: '#b6ffb0' });
      sound('coin', 0.1);
    }
    function heel(d) {
      if (d.chaseT <= 0) return;
      d.chaseT = 0; d.sitT = 0.9;
      api.love(d.id, 2, 'walk');
      api.event(d.id, 'Brav! 🐕 ' + api.dog(d.id).name + ' hört aufs Wort', { kind: 'good', floatText: '🐕 Brav!', color: '#b6ffb0' });
      sound('yip', 0.15);
    }
    function chaseOver(d) {
      api.needs(d.id, { mood: 4, energy: -4 });
      api.event(d.id, '🐈💨 Die Katze ist entwischt!', { kind: 'info', floatText: '🐈💨', color: '#ffd60a' });
    }

    // ---------- the cat ----------
    function spawnCat() {
      let wx = camX + W + 50;
      for (let k = 0; k < 8 && fenceTopAt(wx) >= FENCE_Y; k++) wx += 30;   // never in a gate gap
      cat = { wx, y: fenceTopAt(wx), mode: 'sit', svx: 0, svy: 0, coat: WW.pick(CAT_COATS, rnd) };
    }
    function dash() {
      cat.mode = 'dash'; cat.svx = 150; cat.svy = -170; cat.air = true;
      const cx = cat.wx - camX;
      api.float(cx, cat.y - 46, '🐈 Miau!', '#ffd60a');
      let any = false;
      order.forEach(id => {
        const d = dogs[id];
        if (d.squatT > 0 || Math.hypot(d.x - cx, d.y - cat.y) > CAT_RANGE) return;
        d.chaseT = CHASE_TIME; d.sniffT = 0; d.digAt = -9;
        api.floatAt(id, 'Wuff! Wuff!', '#ffd60a');
        any = true;
      });
      if (any) sound('woof', 0.2);
    }
    function updateCat(dt, now) {
      if (!cat) { if (now >= catAt && order.length) spawnCat(); return; }
      if (cat.mode === 'sit') { if (cat.wx - camX < W * 0.64) dash(); return; }
      if (cat.mode === 'dash') {
        if (cat.air) {
          cat.svy += 900 * dt;
          if (cat.svy > 0 && cat.y >= BAND_TOP + 24) { cat.air = false; const m = Math.hypot(230, 170); cat.svx = 230 / m * CAT_SPEED; cat.svy = 170 / m * CAT_SPEED; }
        }
        cat.wx += (cat.svx + CAM_SPEED) * dt;
        cat.y += cat.svy * dt;
        if (cat.y > H + 40 || cat.wx - camX > W + 60) cat.mode = 'gone';
        if (order.some(id => dogs[id].chaseT > 0)) sound('woof', 0.75);
      }
      if (cat.mode === 'gone' && !order.some(id => dogs[id].chaseT > 0)) { cat = null; catAt = now + range(CAT_AGAIN); }
    }
    function chaseTarget() {
      return cat ? { x: clamp(cat.wx - camX, 30, W - 30), y: clamp(cat.y, BAND_TOP, BAND_BOT) } : { x: W - 30, y: BAND_BOT };
    }

    // ---------- simulation ----------
    function moveDog(d, dt, now) {
      d.px = d.x; d.py = d.y;
      d.alpha = Math.min(1, d.alpha + dt * 2);
      d.mud = Math.max(0, d.mud - dt * 0.12);
      d.wet = Math.max(0, d.wet - dt * 0.25);
      d.sitT -= dt; d.shakeT -= dt; d.sniffT -= dt;
      if (d.squatT > 0) { d.squatT -= dt; if (d.squatT <= 0) dropPoop(d, now); }
      else if (now >= d.nextPoop && d.chaseT <= 0 && !digging(d, now)) { d.squatT = SQUAT_TIME; d.nextPoop = now + range(POOP_EVERY); }
      if (d.shakeAt && now >= d.shakeAt) { d.shakeAt = 0; d.shakeT = 0.75; spray(d); sound('shake', 0.3); }
      // owners hold their slot, leaning when the dog pulls hard
      d.pull *= Math.max(0, 1 - dt * 2.5);
      d.ox += (d.slotX + d.pull - d.ox) * Math.min(1, dt * 3);

      const spd = api.speed(d.id);
      let tx = 0, ty = 0, snap = 7;
      if (d.chaseT > 0) {
        d.chaseT -= dt;
        const c = chaseTarget(), dx = c.x - d.x, dy = c.y - d.y, m = Math.hypot(dx, dy) || 1;
        tx = dx / m * CHASE_SPEED * spd; ty = dy / m * CHASE_SPEED * spd;
        if (d.chaseT <= 0) chaseOver(d);
      } else if (d.squatT > 0 || d.sitT > 0 || digging(d, now) || (d.sniffT > 0 && idle(d))) {
        tx = -CAM_SPEED; snap = 14;            // planted: the street slides by underneath
      } else if (!idle(d)) {
        tx = d.inX * DOG_SPEED * spd; ty = d.inY * DOG_SPEED * spd * 0.7;
      } else {
        const h = heelOf(d);
        puddles.forEach(p => {   // most dogs step around puddles when nobody steers them
          const px = p.wx - camX;
          if (px - p.rx < h.x + 90 && px + p.rx > h.x - 30 && Math.abs(p.y - h.y) < p.ry + 22) {
            h.y = p.y + (h.y >= p.y ? 1 : -1) * (p.ry + 26);
            if (h.y > BAND_BOT || h.y < BAND_TOP) h.y = p.y - Math.sign(h.y - p.y) * (p.ry + 26);
          }
        });
        const dx = h.x - d.x, dy = h.y - d.y, m = Math.hypot(dx, dy);
        if (m > 8) { const v = Math.min(HEEL_SPEED * spd, m * 2.5); tx = dx / m * v; ty = dy / m * v; }
      }
      const k = Math.min(1, dt * snap);
      d.vx += (tx - d.vx) * k; d.vy += (ty - d.vy) * k;
      d.x += d.vx * dt; d.y += d.vy * dt;
    }
    function separate() {
      for (let i = 0; i < order.length; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const a = dogs[order[i]], b = dogs[order[j]];
          const dx = b.x - a.x, dy = (b.y - a.y) * 2.2, m = Math.hypot(dx, dy);
          if (m >= SEPARATION) continue;
          const ux = m > 0.01 ? dx / m : 1, uy = m > 0.01 ? dy / m / 2.2 : 0, push = (SEPARATION - m) * 0.25;
          a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
        }
      }
    }
    function settleDog(d, dt, now) {
      d.y = clamp(d.y, BAND_TOP, BAND_BOT);
      const lx = d.x - d.ox, ly = d.y - OWNER_Y, dist = Math.hypot(lx, ly);
      d.taut = dist > LEASH - 3;
      if (dist > LEASH) {
        d.x = d.ox + lx / dist * LEASH; d.y = OWNER_Y + ly / dist * LEASH;
        if (d.chaseT > 0 || !idle(d)) d.pull = clamp(d.pull + Math.sign(lx) * dt * 70, -26, 26);
      }
      d.y = clamp(d.y, BAND_TOP, BAND_BOT);
      d.x = clamp(d.x, 30, W - 30);
      d.scale = DOG_SCALE * persp(d.y);
      // what the dog actually did (after the leash) decides gait and facing
      const wvx = (d.x - d.px) / dt + CAM_SPEED, wvy = (d.y - d.py) / dt;
      d.speed += (Math.hypot(wvx, wvy) - d.speed) * Math.min(1, dt * 8);
      if (d.chaseT > 0 && cat) d.facing = cat.wx - camX >= d.x ? 1 : -1;
      else if (!digging(d, now) && d.squatT <= 0) { if (wvx > 20) d.facing = 1; else if (wvx < -20) d.facing = -1; }
      // smells: an idle dog stops at each fresh one for a moment
      d.onSpot = spotUnder(d);
      if (!d.onSpot) d.sniffT = Math.min(d.sniffT, 0);
      else if (d.sniffT <= 0 && !d.onSpot.sniffed[d.id] && idle(d) && d.chaseT <= 0 && !digging(d, now)) {
        d.onSpot.sniffed[d.id] = true; d.sniffT = SNIFF_TIME;
      }
      puddles.forEach(p => {
        if (p.hit[d.id]) return;
        const dx = (d.x - (p.wx - camX)) / p.rx, dy = (d.y - p.y) / p.ry;
        if (dx * dx + dy * dy <= 1) splash(d, p, now);
      });
      if (d.poop && now > d.poop.until) d.poop = null;   // missed — it scrolls away
    }
    function poseOf(d, now) {
      if (d.squatT > 0) return 'squat';
      if (d.shakeT > 0) return 'shake';
      if (d.chaseT > 0) return 'run';
      if (digging(d, now)) return 'dig';
      if (d.sitT > 0) return 'sit';
      if (d.sniffT > 0 && idle(d)) return 'eat';     // nose down at a smell
      if (d.speed > 150) return 'run';
      if (d.speed > 14) return 'walk';
      return 'stand';
    }
    function sendState(now) {
      order.forEach(id => {
        const d = dogs[id], s = d.onSpot;
        const st = { dig: s ? 1 : 0, digP: s ? Math.round((s.prog[id] || 0) * 10) / 10 : 0, poop: d.poop ? 1 : 0, cat: d.chaseT > 0 ? 1 : 0 };
        const key = st.dig + '|' + st.digP + '|' + st.poop + '|' + st.cat;
        if (key === d.sentKey || now - d.sentAt < SEND_GAP) return;
        d.sentKey = key; d.sentAt = now;
        api.send(id, Object.assign({ t: 'wwWalk' }, st));
      });
    }

    // ---------- drawing: backdrop ----------
    function drawSky(o) {
      const g = o.createLinearGradient(0, 0, 0, 320);
      g.addColorStop(0, '#79c3f2'); g.addColorStop(0.6, '#c3e8fb'); g.addColorStop(1, '#fdf0d8');
      o.fillStyle = g; o.fillRect(0, 0, W, 330);
      const sg = o.createRadialGradient(820, 78, 10, 820, 78, 130);
      sg.addColorStop(0, 'rgba(255,248,214,.95)'); sg.addColorStop(0.25, 'rgba(255,236,170,.5)'); sg.addColorStop(1, 'rgba(255,236,170,0)');
      o.fillStyle = sg; o.fillRect(690, 0, 270, 210);
      o.fillStyle = '#fff6cf'; circ(o, 820, 78, 30);
      for (let i = 0; i < 6; i++) {
        const span = W + 360, x = ((hash(i * 4.7) * span - camX * 0.06) % span + span) % span - 180;
        const y = 48 + hash(i * 9.2) * 115, s = 0.7 + hash(i * 3.1) * 0.6;
        o.fillStyle = 'rgba(255,255,255,.9)';
        circ(o, x, y, 21 * s); circ(o, x + 25 * s, y - 11 * s, 26 * s); circ(o, x + 52 * s, y - 2 * s, 20 * s);
        ell(o, x + 26 * s, y + 6 * s, 48 * s, 12 * s);
      }
    }
    function hillLine(o, base, amp1, f1, amp2, f2, par, color) {
      o.fillStyle = color;
      o.beginPath(); o.moveTo(0, 330);
      for (let x = 0; x <= W + 24; x += 24) {
        const wx = x + camX * par;
        o.lineTo(x, base - amp1 * Math.sin(wx * f1) - amp2 * Math.sin(wx * f2 + 1.3));
      }
      o.lineTo(W, 330); o.closePath(); o.fill();
    }
    function drawFar(o) {
      hillLine(o, 236, 20, 0.006, 11, 0.017, 0.1, '#b8dcc2');
      hillLine(o, 258, 16, 0.009, 8, 0.023, 0.18, '#a2cfab');
      // far trees (parallax 0.28)
      const P = 0.28, step = 64, off = camX * P;
      for (let k = Math.floor(off / step) - 1; k < Math.floor((off + W) / step) + 2; k++) {
        if (hash(k * 2.3 + 5) < 0.45) continue;
        const x = k * step - off + hash(k * 7.7) * 30, r = 18 + hash(k * 3.9) * 16;
        o.fillStyle = hash(k * 1.1) < 0.5 ? '#86bf88' : '#79b27d';
        circ(o, x, 286 - r * 0.6, r); circ(o, x + r * 0.6, 290 - r * 0.4, r * 0.75);
      }
      o.fillStyle = '#a7d77f'; o.fillRect(0, 286, W, FENCE_Y - 286);   // garden lawns
    }
    function drawWindow(o, cx, cy, lit, box) {
      o.fillStyle = '#fbf8f2'; o.fillRect(cx - 14, cy - 1, 28, 28);
      o.fillStyle = lit ? '#ffe9a8' : '#a9d8f0'; o.fillRect(cx - 11, cy + 2, 22, 22);
      o.fillStyle = 'rgba(255,255,255,.55)';
      o.beginPath(); o.moveTo(cx - 11, cy + 14); o.lineTo(cx - 1, cy + 2); o.lineTo(cx + 5, cy + 2); o.lineTo(cx - 11, cy + 19); o.fill();
      o.fillStyle = '#fbf8f2'; o.fillRect(cx - 1, cy + 2, 2, 22); o.fillRect(cx - 11, cy + 12, 22, 2);
      if (box) {
        o.fillStyle = '#8a5a3a'; o.fillRect(cx - 15, cy + 26, 30, 5);
        for (let i = 0; i < 5; i++) { o.fillStyle = BLOOMS[(i + Math.floor(cx)) % BLOOMS.length]; circ(o, cx - 12 + i * 6, cy + 25, 2.6); }
      }
    }
    function drawHouse(o, lx, i) {
      const w = 150 + hash(i * 3.3) * 60, hgt = 86 + hash(i * 5.7) * 50;
      const x = lx + (250 - w) / 2 + (hash(i * 9.1) - 0.5) * 24, top = HOUSE_BASE - hgt;
      const wall = WALLS[Math.floor(hash(i * 2.9) * WALLS.length)], roof = ROOFS[Math.floor(hash(i * 4.3) * ROOFS.length)];
      const gable = hash(i * 6.1) < 0.72, rh = 40 + hash(i * 1.7) * 22;
      if (gable && hash(i * 8.3) < 0.7) {
        o.fillStyle = '#8d5a45'; o.fillRect(x + w * 0.68, top - rh * 0.75, 14, rh * 0.6);
        o.fillStyle = '#6e4636'; o.fillRect(x + w * 0.68 - 2, top - rh * 0.75 - 5, 18, 6);
      }
      o.fillStyle = wall; o.fillRect(x, top, w, hgt);
      o.fillStyle = 'rgba(0,0,0,.06)'; o.fillRect(x + w * 0.72, top, w * 0.28, hgt);
      o.fillStyle = roof;
      if (gable) {
        o.beginPath(); o.moveTo(x - 12, top + 2); o.lineTo(x + w / 2, top - rh); o.lineTo(x + w + 12, top + 2); o.closePath(); o.fill();
        o.strokeStyle = 'rgba(0,0,0,.13)'; o.lineWidth = 1.5;
        for (let k = 1; k < 4; k++) {
          const yy = top - rh + rh * k / 4, half = (w / 2 + 12) * k / 4;
          o.beginPath(); o.moveTo(x + w / 2 - half, yy); o.lineTo(x + w / 2 + half, yy); o.stroke();
        }
        o.fillStyle = '#fbf8f2'; circ(o, x + w / 2, top - rh * 0.42, 8);
        o.fillStyle = '#a9d8f0'; circ(o, x + w / 2, top - rh * 0.42, 5.5);
      } else {
        o.fillRect(x - 6, top - 12, w + 12, 14);
        o.fillStyle = 'rgba(255,255,255,.25)'; o.fillRect(x - 6, top - 12, w + 12, 3);
      }
      const rows = hgt > 112 ? 2 : 1, cols = w > 182 ? 3 : 2, doorCol = Math.floor(hash(i * 12.7) * cols);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = x + w * (c + 0.5) / cols;
          if (r === rows - 1 && c === doorCol) {
            o.fillStyle = 'rgba(0,0,0,.12)'; o.fillRect(cx - 17, HOUSE_BASE - 46, 34, 6);
            o.fillStyle = DOORS[Math.floor(hash(i * 14.1) * DOORS.length)]; o.fillRect(cx - 12, HOUSE_BASE - 40, 24, 40);
            o.fillStyle = 'rgba(255,255,255,.18)'; o.fillRect(cx - 8, HOUSE_BASE - 35, 16, 12);
            o.fillStyle = '#e8c34a'; circ(o, cx + 7, HOUSE_BASE - 18, 2);
          } else {
            drawWindow(o, cx, top + 16 + r * 46, hash(i * 21.3 + r * 3 + c) < 0.12, hash(i * 17.9 + c) < 0.35);
          }
        }
      }
    }
    function drawBigTree(o, x, i) {
      o.fillStyle = '#7a5536'; o.fillRect(x - 7, HOUSE_BASE - 66, 14, 66);
      o.fillStyle = '#5c9a50'; circ(o, x - 30, HOUSE_BASE - 76, 36); circ(o, x + 32, HOUSE_BASE - 78, 38);
      o.fillStyle = '#6fae5f'; circ(o, x, HOUSE_BASE - 108, 48);
      o.fillStyle = 'rgba(255,255,255,.12)'; circ(o, x - 14, HOUSE_BASE - 124, 18);
      if (hash(i * 5.5) < 0.5) { o.fillStyle = '#e8453c'; [[-20, -96], [18, -84], [4, -128], [-38, -70]].forEach(([dx, dy]) => circ(o, x + dx, HOUSE_BASE + dy, 4)); }
    }
    function drawHouses(o) {
      const P = 0.45, LOT = 250, off = camX * P;
      for (let i = Math.floor(off / LOT) - 1; i <= Math.floor((off + W) / LOT) + 1; i++) {
        const lx = i * LOT - off;
        if (hash(i * 7.1) < 0.14) drawBigTree(o, lx + LOT / 2, i); else drawHouse(o, lx, i);
      }
    }
    function drawGardens(o) {
      const P = 0.72, LOT = 160, off = camX * P;
      for (let i = Math.floor(off / LOT) - 1; i <= Math.floor((off + W) / LOT) + 1; i++) {
        const lx = i * LOT - off;
        if (hash(i * 3.1 + 9) < 0.62) {
          const x = lx + hash(i * 4.4) * 110, r = 14 + hash(i * 6.6) * 10;
          o.fillStyle = '#4f8f3e'; circ(o, x, 338 - r * 0.4, r); circ(o, x + r * 0.9, 340 - r * 0.3, r * 0.8);
          o.fillStyle = '#62a64e'; circ(o, x - r * 0.2, 334 - r * 0.6, r * 0.6);
        }
        if (hash(i * 8.8 + 1) < 0.35) {
          const x = lx + 30 + hash(i * 2.2) * 90;
          o.fillStyle = '#7a5538'; ell(o, x, 344, 26, 6);
          for (let k = 0; k < 7; k++) { o.fillStyle = BLOOMS[(i + k) % BLOOMS.length]; circ(o, x - 20 + k * 6.5, 338 - (k % 2) * 4, 3.2); }
        }
      }
    }
    function drawFences(o) {
      for (let seg = Math.floor(camX / FENCE_SEG) - 1; seg <= Math.floor((camX + W) / FENCE_SEG) + 1; seg++) {
        const f = fenceSeg(seg), x0 = seg * FENCE_SEG - camX, gx = f.gate - camX;
        [[x0, gx], [gx + GATE_W, x0 + FENCE_SEG]].forEach(([a, b]) => {
          if (b < -20 || a > W + 20 || b <= a) return;
          if (f.type === 'picket') {
            o.fillStyle = '#e9e2d3'; o.fillRect(a, FENCE_Y - 24, b - a, 4); o.fillRect(a, FENCE_Y - 12, b - a, 4);
            for (let x = a + 3; x < b - 4; x += 14) {
              o.fillStyle = '#f8f4ec';
              o.beginPath(); o.moveTo(x, FENCE_Y); o.lineTo(x, FENCE_Y - 26); o.lineTo(x + 4.5, FENCE_Y - 31); o.lineTo(x + 9, FENCE_Y - 26); o.lineTo(x + 9, FENCE_Y); o.fill();
              o.fillStyle = 'rgba(0,0,0,.08)'; o.fillRect(x + 7, FENCE_Y - 26, 2, 26);
            }
          } else if (f.type === 'hedge') {
            o.fillStyle = '#3f7f3a'; rr(o, a, FENCE_Y - 38, b - a, 38, 9); o.fill();
            o.fillStyle = '#4f9246';
            for (let x = a + 9; x < b - 4; x += 17) circ(o, x, FENCE_Y - 36, 9);
            o.fillStyle = 'rgba(255,255,255,.1)';
            for (let x = a + 6; x < b - 6; x += 23) circ(o, x + 4, FENCE_Y - 26 + ((x | 0) % 3) * 6, 2.5);
          } else {
            o.fillStyle = '#cdc5b6'; o.fillRect(a, FENCE_Y - 24, b - a, 24);
            o.fillStyle = '#b8af9f'; o.fillRect(a - 2, FENCE_Y - 27, b - a + 4, 5);
            o.fillStyle = 'rgba(120,108,92,.35)';
            o.fillRect(a, FENCE_Y - 12, b - a, 1.5);
            for (let x = a + 13; x < b; x += 26) { o.fillRect(x, FENCE_Y - 22, 1.5, 10); o.fillRect(x + 13 < b ? x + 13 : x, FENCE_Y - 11, 1.5, 11); }
          }
        });
        if (gx > -60 && gx < W + 20) {
          if (f.type === 'picket') { o.fillStyle = '#efe6d2'; o.fillRect(gx + 4, FENCE_Y - 26, GATE_W - 8, 22); o.fillStyle = '#d8cdb6'; o.fillRect(gx + 4, FENCE_Y - 16, GATE_W - 8, 3); }
          else { o.fillStyle = f.type === 'wall' ? '#b8af9f' : '#6f6a62'; o.fillRect(gx - 3, FENCE_Y - 32, 7, 32); o.fillRect(gx + GATE_W - 4, FENCE_Y - 32, 7, 32); }
          o.fillStyle = '#e6dcc8'; o.fillRect(gx + 4, FENCE_Y - 3, GATE_W - 8, 3);   // garden path
        }
      }
    }
    function drawGround(o) {
      o.fillStyle = '#ddd5c7'; o.fillRect(0, FENCE_Y, W, GRASS_Y - FENCE_Y);
      o.strokeStyle = 'rgba(150,138,120,.35)'; o.lineWidth = 1.5;
      const rows = [FENCE_Y, 384, 416, GRASS_Y];
      for (let r = 0; r < 3; r++) {
        const y0 = rows[r], y1 = rows[r + 1], off = r % 2 ? 23 : 0;
        o.beginPath(); o.moveTo(0, y1); o.lineTo(W, y1); o.stroke();
        for (let x = -((camX + off) % 46); x < W; x += 46) { o.beginPath(); o.moveTo(x, y0); o.lineTo(x, y1); o.stroke(); }
      }
      o.fillStyle = 'rgba(0,0,0,.08)'; o.fillRect(0, FENCE_Y, W, 5);
      o.fillStyle = '#8fc96a'; o.fillRect(0, GRASS_Y, W, CURB_Y - GRASS_Y);
      o.fillStyle = 'rgba(255,255,255,.14)'; o.fillRect(0, GRASS_Y, W, 3);
      o.strokeStyle = '#6fae4f'; o.lineWidth = 2; o.lineCap = 'round';
      const step = 23;
      for (let k = Math.floor(camX / step); k < Math.floor(camX / step) + W / step + 2; k++) {
        const x = k * step - camX + hash(k * 1.3) * 12, y = GRASS_Y + 12 + hash(k * 2.1) * (CURB_Y - GRASS_Y - 18);
        o.beginPath(); o.moveTo(x - 4, y - 6); o.lineTo(x, y); o.lineTo(x + 3, y - 7); o.stroke();
        if (hash(k * 5.9) < 0.12) { o.fillStyle = hash(k * 6.1) < 0.5 ? '#ffffff' : '#ffe14d'; circ(o, x + 7, y - 4, 2.4); }
      }
      o.fillStyle = '#d2cbbf'; o.fillRect(0, CURB_Y, W, 4);
      o.fillStyle = '#a69f92'; o.fillRect(0, CURB_Y + 4, W, ROAD_Y - CURB_Y - 4);
      o.fillStyle = '#5d6268'; o.fillRect(0, ROAD_Y, W, H - ROAD_Y);
      o.fillStyle = 'rgba(255,255,255,.06)'; o.fillRect(0, ROAD_Y, W, 6);
      o.fillStyle = '#e8e4da';
      for (let x = -(camX % 100); x < W; x += 100) o.fillRect(x, 568, 50, 5);
    }
    function drawLamp(o, x) {
      o.fillStyle = '#3c4650'; o.fillRect(x - 7, 352, 14, 10);
      o.fillStyle = '#4b5661'; o.fillRect(x - 3, 198, 6, 156);
      o.strokeStyle = '#4b5661'; o.lineWidth = 4; o.lineCap = 'round';
      o.beginPath(); o.moveTo(x, 206); o.quadraticCurveTo(x + 4, 194, x + 22, 198); o.stroke();
      o.fillStyle = '#39434c';
      o.beginPath(); o.moveTo(x + 13, 200); o.lineTo(x + 31, 200); o.lineTo(x + 27, 222); o.lineTo(x + 17, 222); o.closePath(); o.fill();
      o.fillStyle = '#fff3c4'; o.fillRect(x + 18, 205, 8, 13);
    }
    function drawHydrant(o, x) {
      o.fillStyle = 'rgba(0,0,0,.15)'; ell(o, x, 362, 12, 3);
      o.fillStyle = '#9c2e28'; o.fillRect(x - 9, 357, 18, 5);
      o.fillStyle = '#d8453c'; rr(o, x - 7, 334, 14, 24, 4); o.fill();
      o.fillStyle = '#c43a33'; circ(o, x, 335, 8); o.fillRect(x - 12, 341, 24, 6);
      o.fillStyle = '#ee6b62'; o.fillRect(x - 4, 337, 3, 18);
      o.fillStyle = '#b8362f'; o.fillRect(x - 2, 324, 4, 4);
    }
    function drawBench(o, x) {
      o.fillStyle = '#4a4f57'; o.fillRect(x - 27, 340, 4, 21); o.fillRect(x + 23, 340, 4, 21);
      o.fillStyle = '#a86b3c'; o.fillRect(x - 31, 337, 62, 6); o.fillRect(x - 31, 318, 62, 5); o.fillRect(x - 31, 327, 62, 5);
      o.fillStyle = 'rgba(255,255,255,.18)'; o.fillRect(x - 31, 337, 62, 1.5);
      o.fillStyle = '#4a4f57'; o.fillRect(x - 27, 316, 3, 22); o.fillRect(x + 24, 316, 3, 22);
    }
    function drawDispenser(o, x) {
      o.fillStyle = '#56606b'; o.fillRect(x - 2, 318, 4, 44);
      o.fillStyle = '#3c8f5a'; rr(o, x - 11, 300, 22, 26, 4); o.fill();
      o.fillStyle = '#fff'; ell(o, x - 1, 312, 5, 3); circ(o, x + 5, 309, 2.6); o.fillRect(x - 5, 314, 1.5, 4); o.fillRect(x + 2, 314, 1.5, 4);
      o.fillStyle = '#2c6b44'; o.fillRect(x - 4, 326, 8, 8);
    }
    function drawProps(o) {
      for (let seg = Math.floor(camX / PROP_SEG) - 1; seg <= Math.floor((camX + W) / PROP_SEG) + 1; seg++) {
        const base = seg * PROP_SEG - camX;
        if (hash(seg * 7.3) < 0.72) drawLamp(o, base + 30 + hash(seg * 1.9) * 50);
        if (hash(seg * 11.3) < 0.3) drawHydrant(o, base + 140 + hash(seg * 2.3) * 20);
        if (hash(seg * 13.1) < 0.24) drawBench(o, base + 215 + hash(seg * 3.1) * 30);
        else if (hash(seg * 17.9) < 0.3) drawDispenser(o, base + 230);
      }
    }

    // ---------- drawing: things on the street ----------
    function wisps(o, x, y, now, seq, tint) {
      o.lineWidth = tint ? 2.6 : 2; o.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const ph = now * 1.6 + k * 2.1 + seq, a = 0.38 + 0.26 * Math.sin(ph);
        if (tint) { o.strokeStyle = tint; o.globalAlpha = Math.min(1, a + 0.3); } else o.strokeStyle = 'rgba(250,255,215,' + a.toFixed(3) + ')';
        o.beginPath();
        for (let j = 0; j <= 6; j++) {
          const yy = y - 6 - j * 5, xx = x + (k - 1) * 10 + Math.sin(ph * 1.3 + j * 0.9) * 4;
          if (j) o.lineTo(xx, yy); else o.moveTo(xx, yy);
        }
        o.stroke();
      }
      o.globalAlpha = 1;
    }
    function drawSpot(o, s, now) {
      const x = s.wx - camX, y = s.y, r = s.r;
      const wig = now - s.wig < 0.3 ? Math.sin((now - s.wig) * 50) * 2.2 : 0;
      if (s.dug) {
        o.fillStyle = '#7a5235'; ell(o, x, y, r * 0.85, r * 0.32);
        o.fillStyle = '#3e2a1f'; ell(o, x, y, r * 0.6, r * 0.2);
        o.fillStyle = '#93684a';
        for (let i = 0; i < 6; i++) circ(o, x + (hash(s.seq * 3 + i) - 0.5) * r * 2.2, y + (hash(s.seq * 5 + i) - 0.5) * r * 0.6, 2.4);
        if (s.kind === 'leaves') for (let i = 0; i < 5; i++) { o.fillStyle = LEAVES[i % LEAVES.length]; ell(o, x + (hash(s.seq + i * 7) - 0.5) * r * 2.6, y + (hash(s.seq + i * 9) - 0.5) * 10, 5, 2.6, i); }
        return;
      }
      // pop-ups grow in with a little overshoot
      const g = s.born != null ? clamp((now - s.born) / 0.45, 0, 1) : 1;
      o.save();
      if (g < 1) { const k = Math.max(0.01, easeOutBack(g)); o.translate(x, y); o.scale(k, k); o.translate(-x, -y); }
      o.fillStyle = 'rgba(0,0,0,.14)'; ell(o, x, y + 2, r, r * 0.33);
      if (s.kind === 'leaves') {
        for (let i = 0; i < 16; i++) {
          o.fillStyle = LEAVES[Math.floor(hash(s.seq * 11 + i) * LEAVES.length)];
          const px = x + (hash(s.seq * 13 + i) - 0.5) * r * 1.7, py = y - hash(s.seq * 17 + i) * r * 0.55 - 2 + wig * (i % 2 ? 1 : -1);
          ell(o, px, py, 6.5, 3.4, hash(s.seq * 19 + i) * 6);
        }
      } else if (s.kind === 'mole') {
        const t = s.born != null ? now - s.born : 9;   // a mole peeks out of fresh hills
        if (t < 1.9) drawMole(o, x + 2, y - r * 0.55, t < 0.35 ? t / 0.35 : t < 1.4 ? 1 : Math.max(0, 1 - (t - 1.4) / 0.5));
        o.fillStyle = '#7a5235'; o.beginPath(); o.ellipse(x, y, r, r * 0.62, 0, Math.PI, 0); o.fill();
        o.fillStyle = '#93684a'; o.beginPath(); o.ellipse(x - 3, y - 3 + wig, r * 0.62, r * 0.38, 0, Math.PI, 0); o.fill();
        o.fillStyle = '#b9b1a5'; circ(o, x - r * 0.6, y - 2, 2.6); circ(o, x + r * 0.5, y - 4, 2);
      } else if (s.kind === 'bush') {
        const by = y + wig * 0.5;
        o.fillStyle = '#3f7a33'; circ(o, x - r * 0.45, by - r * 0.5, r * 0.55); circ(o, x + r * 0.42, by - r * 0.48, r * 0.6);
        o.fillStyle = '#4f8f3e'; circ(o, x, by - r * 0.85, r * 0.62);
        o.fillStyle = '#6fb054'; circ(o, x - r * 0.18, by - r * 1.05, r * 0.3);
        for (let i = 0; i < 6; i++) { o.fillStyle = i % 2 ? '#ffd1e8' : '#ffffff'; circ(o, x + (hash(s.seq * 7 + i) - 0.5) * r * 1.6, by - r * 0.3 - hash(s.seq * 9 + i) * r * 0.9, 2.6); }
      } else {
        o.fillStyle = '#6b4a33'; ell(o, x, y, r, r * 0.34);
        o.strokeStyle = '#4f8f3e'; o.lineWidth = 2;
        for (let i = 0; i < 7; i++) {
          const fx = x - r * 0.8 + i * r * 0.27, top = y - 10 - hash(s.seq * 3 + i) * 10 + wig;
          o.beginPath(); o.moveTo(fx, y - 1); o.lineTo(fx, top); o.stroke();
          o.fillStyle = BLOOMS[Math.floor(hash(s.seq * 5 + i) * BLOOMS.length)]; circ(o, fx, top, 3.6);
          o.fillStyle = '#ffe9a0'; circ(o, fx, top, 1.3);
        }
      }
      o.restore();
      if (g >= 1) wisps(o, x, y - r * (s.kind === 'bush' ? 1.1 : 0.45), now, s.seq, now < s.until && dogs[s.forId] ? api.color(s.forId) : null);
    }
    function drawPoop(o, p, now) {
      const x = p.wx - camX, y = p.y;
      o.fillStyle = 'rgba(0,0,0,.18)'; ell(o, x, y + 1, 11, 3.5);
      o.fillStyle = '#6b4423'; ell(o, x, y - 3, 10, 4.5); ell(o, x + 0.5, y - 8, 7.5, 4); ell(o, x + 1, y - 12.5, 4.8, 3.4);
      o.beginPath(); o.moveTo(x - 1, y - 14); o.quadraticCurveTo(x + 3, y - 21, x + 4.5, y - 15); o.fill();
      o.fillStyle = 'rgba(255,255,255,.25)'; ell(o, x - 3, y - 9, 2.2, 1.3);
      o.strokeStyle = 'rgba(140,190,90,.65)'; o.lineWidth = 1.6;
      for (let k = 0; k < 2; k++) {
        o.beginPath();
        for (let j = 0; j <= 4; j++) { const yy = y - 18 - j * 4, xx = x - 5 + k * 10 + Math.sin(now * 4 + j + k * 2) * 2.5; if (j) o.lineTo(xx, yy); else o.moveTo(xx, yy); }
        o.stroke();
      }
      o.fillStyle = '#222';
      for (let k = 0; k < 2; k++) circ(o, x + Math.cos(now * 9 + k * 3) * 11, y - 22 + Math.sin(now * 13 + k) * 5, 1.4);
    }
    function drawCat(o, c, now) {
      const x = c.wx - camX, y = c.y, fur = c.coat[0], dark = c.coat[1];
      o.save(); o.translate(x, y);
      o.lineCap = 'round';
      if (c.mode === 'sit') {
        const sw = Math.sin(now * 2.6) * 8;
        o.strokeStyle = fur; o.lineWidth = 4;
        o.beginPath(); o.moveTo(-7, -4); o.quadraticCurveTo(-22, -4, -19 + sw * 0.4, -24 + sw * 0.3); o.stroke();
        o.fillStyle = fur; ell(o, 0, -13, 10, 13);
        o.fillStyle = dark; ell(o, 3, -3, 6, 3);
        o.fillStyle = fur; circ(o, 3, -30, 9.5);
        o.beginPath(); o.moveTo(-5, -34); o.lineTo(-3, -45); o.lineTo(3, -38); o.fill();
        o.beginPath(); o.moveTo(4, -38); o.lineTo(10, -45); o.lineTo(12, -33); o.fill();
        o.fillStyle = '#9be36a'; ell(o, -0.5, -31, 2.1, 2.5); ell(o, 7, -31, 2.1, 2.5);
        o.fillStyle = '#111'; ell(o, -0.5, -31, 0.7, 2); ell(o, 7, -31, 0.7, 2);
        o.fillStyle = '#ff8fa3'; circ(o, 3.3, -27, 1.4);
      } else if (c.mode === 'dash') {
        const g = Math.sin(now * 24) * 7;
        o.strokeStyle = dark; o.lineWidth = 3.4;
        [[-10, g], [-6, -g], [8, -g], [12, g]].forEach(([lx, s]) => { o.beginPath(); o.moveTo(lx, -10); o.lineTo(lx + s, 0); o.stroke(); });
        o.strokeStyle = fur; o.lineWidth = 4;
        o.beginPath(); o.moveTo(-15, -14); o.quadraticCurveTo(-26, -20, -32, -30); o.stroke();
        o.fillStyle = fur; ell(o, 0, -13, 17, 7.5, -0.06);
        circ(o, 17, -18, 7.5);
        o.beginPath(); o.moveTo(13, -22); o.lineTo(14, -31); o.lineTo(18, -24); o.fill();
        o.beginPath(); o.moveTo(19, -24); o.lineTo(23, -31); o.lineTo(24, -20); o.fill();
        o.fillStyle = '#9be36a'; circ(o, 20, -19, 1.8);
      }
      o.restore();
    }
    function drawOwner(o, d, now) {
      const s = OWNER_SCALE, x = d.ox, y = OWNER_Y, col = api.color(d.id), lk = d.look;
      const sw = Math.sin(now * 6.4 + d.seed * 3);
      o.save();
      o.globalAlpha = d.alpha;
      o.fillStyle = 'rgba(0,0,0,.18)'; ell(o, x, y, 20 * s, 5 * s);
      o.lineCap = 'round';
      o.strokeStyle = lk.pants; o.lineWidth = 9 * s;
      [1, -1].forEach(k => { o.beginPath(); o.moveTo(x + k * 3 * s, y - 50 * s); o.lineTo(x + k * 3 * s + k * sw * 11 * s, y - 5 * s); o.stroke(); });
      o.fillStyle = '#2b2b33';
      [1, -1].forEach(k => ell(o, x + k * 3 * s + k * sw * 11 * s + 3 * s, y - 3 * s, 7 * s, 3.6 * s));
      o.strokeStyle = col; o.lineWidth = 7 * s;
      o.beginPath(); o.moveTo(x - 6 * s, y - 88 * s); o.lineTo(x - 6 * s - sw * 10 * s, y - 58 * s); o.stroke();
      o.fillStyle = col; rr(o, x - 15 * s, y - 98 * s, 30 * s, 52 * s, 11 * s); o.fill();
      o.fillStyle = 'rgba(0,0,0,.16)'; rr(o, x + 4 * s, y - 98 * s, 11 * s, 52 * s, 8 * s); o.fill();
      o.fillStyle = 'rgba(255,255,255,.35)'; o.fillRect(x - 1 * s, y - 94 * s, 2 * s, 44 * s);
      const hx = x + s, hy = y - 111 * s;
      if (lk.style === 3) { o.fillStyle = lk.hair; ell(o, hx - 5 * s, hy + 6 * s, 9 * s, 15 * s); }
      o.fillStyle = lk.skin; circ(o, hx, hy, 12.5 * s);
      o.fillStyle = lk.hair;
      if (lk.style === 1) {           // cap
        o.fillStyle = '#f2f2f2'; o.beginPath(); o.arc(hx, hy - 2 * s, 13 * s, Math.PI, 0); o.fill();
        o.fillStyle = col; o.fillRect(hx, hy - 4 * s, 15 * s, 3.5 * s);
      } else if (lk.style === 4) {    // beanie
        o.fillStyle = '#e8e3d8'; o.beginPath(); o.arc(hx, hy - 3 * s, 13 * s, Math.PI, 0); o.fill();
        o.fillStyle = col; circ(o, hx, hy - 17 * s, 4 * s);
      } else {
        o.beginPath(); o.arc(hx, hy - 1 * s, 13 * s, Math.PI * 1.02, Math.PI * 1.98); o.fill();
        if (lk.style === 2) circ(o, hx - 3 * s, hy - 15 * s, 6 * s);
      }
      o.fillStyle = '#2b2b33'; circ(o, hx + 7 * s, hy - 1 * s, 1.6 * s);
      o.restore();
    }
    function drawDog(o, d, now) {
      const dog = api.dog(d.id);
      if (!dog) return;
      const col = api.color(d.id), c = collarOf(d), h = handOf(d, c);
      o.save();
      o.globalAlpha = d.alpha;
      o.lineCap = 'round';
      // the leash arm, then the leash itself (sagging when slack)
      o.strokeStyle = col; o.lineWidth = 7 * OWNER_SCALE;
      o.beginPath(); o.moveTo(h.sx, h.sy); o.lineTo(h.x, h.y); o.stroke();
      o.fillStyle = d.look.skin; circ(o, h.x, h.y, 4);
      const dist = Math.hypot(c.x - h.x, c.y - h.y), sag = clamp((LEASH - dist) * 0.42, 3, 60);
      const mx = (h.x + c.x) / 2, my = Math.max(h.y, c.y) + sag;
      o.strokeStyle = 'rgba(20,20,30,.45)'; o.lineWidth = 4.4;
      o.beginPath(); o.moveTo(h.x, h.y); o.quadraticCurveTo(mx, my, c.x, c.y); o.stroke();
      o.strokeStyle = col; o.lineWidth = 2.4;
      o.beginPath(); o.moveTo(h.x, h.y); o.quadraticCurveTo(mx, my, c.x, c.y); o.stroke();
      o.restore();
      const n = dog.needs, running = d.speed > 150 || d.chaseT > 0;
      WW.art.drawDog(o, dog, d.x, d.y, {
        scale: d.scale, facing: d.facing, pose: poseOf(d, now), t: now + d.seed,
        wag: d.chaseT > 0 ? 1 : 0.25 + 0.75 * n.mood / 100,
        dirt: clamp(Math.max((70 - n.clean) / 70, d.mud * 0.65), 0, 1), wet: d.wet,
        tongue: running || n.energy < 35 || n.water < 30, alpha: d.alpha, collar: api.color(d.id)
      });
    }
    function drawPuddles(o, now) {
      puddles.forEach(p => {
        const x = p.wx - camX;
        if (x < -80 || x > W + 80) return;
        o.fillStyle = '#7d6a52'; ell(o, x, p.y, p.rx + 5, p.ry + 3);
        o.fillStyle = '#8f8068'; ell(o, x, p.y, p.rx, p.ry);
        o.fillStyle = 'rgba(190,225,245,.55)'; ell(o, x - p.rx * 0.22, p.y - p.ry * 0.22, p.rx * 0.48, p.ry * 0.36, -0.08);
        o.fillStyle = 'rgba(255,255,255,.55)'; ell(o, x - p.rx * 0.4, p.y - p.ry * 0.35, p.rx * 0.13, p.ry * 0.16);
        const a = now - p.rip < 1.2 ? (now - p.rip) / 1.2 : ((now * 0.5 + p.wx * 0.01) % 1);
        o.strokeStyle = 'rgba(255,255,255,' + ((now - p.rip < 1.2 ? 0.7 : 0.22) * (1 - a)).toFixed(3) + ')'; o.lineWidth = 1.6;
        o.beginPath(); o.ellipse(x + p.rx * 0.15, p.y, Math.max(0.1, p.rx * (0.2 + a * 0.75)), Math.max(0.1, p.ry * (0.2 + a * 0.75)), 0, 0, Math.PI * 2); o.stroke();
      });
    }
    function drawGroundRings(o, now) {
      spots.forEach(s => {
        if (s.dug) return;
        const who = order.find(id => dogs[id].onSpot === s);
        if (who == null) return;
        o.save();
        o.setLineDash([6, 5]); o.lineDashOffset = -now * 24;
        o.strokeStyle = api.color(who); o.lineWidth = 2.6;
        o.beginPath(); o.ellipse(s.wx - camX, s.y, s.r + 10, s.r * 0.55 + 8, 0, 0, Math.PI * 2); o.stroke();
        o.restore();
      });
      poops.forEach(p => {
        const d = dogs[p.owner];
        if (!d || d.poop !== p) return;
        const k = 0.5 + 0.5 * Math.sin(now * 8);
        o.strokeStyle = api.color(p.owner); o.lineWidth = 2.5; o.globalAlpha = 0.5 + 0.5 * k;
        o.beginPath(); o.ellipse(p.wx - camX, p.y, 16 + k * 4, 7 + k * 2, 0, 0, Math.PI * 2); o.stroke();
        o.globalAlpha = 1;
      });
    }
    function glowSprite(gold) {
      const cnv = document.createElement('canvas');
      cnv.width = cnv.height = 128;
      const g = cnv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, gold ? 'rgba(255,250,200,1)' : 'rgba(255,255,240,.95)');
      gr.addColorStop(0.4, gold ? 'rgba(255,200,40,.55)' : 'rgba(255,240,180,.4)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      return cnv;
    }
    function drawItems(o, now) {
      items.forEach(it => {
        const a = now - it.t0, x = it.wx - camX;
        const rise = Math.min(1, a / 0.45), z = 66 * (1 - (1 - rise) * (1 - rise)) + Math.sin(a * 6) * 3 * rise;
        const sc = a < 0.12 ? a / 0.12 : a > 1.25 ? Math.max(0, 1 - (a - 1.25) / 0.4) : 1;
        if (sc <= 0.01) return;
        const y = it.y - 18 - z;
        if (!glowSoft) { glowSoft = glowSprite(false); glowGold = glowSprite(true); }
        const gs = (it.rare ? 130 : 78) * sc;
        o.globalAlpha = 0.9;
        o.drawImage(it.rare ? glowGold : glowSoft, x - gs / 2, y - gs / 2, gs, gs);
        if (it.rare) {
          o.save(); o.translate(x, y); o.rotate(a * 1.4);
          o.fillStyle = 'rgba(255,214,10,.32)';
          for (let i = 0; i < 8; i++) { o.rotate(Math.PI / 4); o.beginPath(); o.moveTo(0, 0); o.lineTo(-6 * sc, -62 * sc); o.lineTo(6 * sc, -62 * sc); o.fill(); }
          o.restore();
        }
        o.globalAlpha = 1;
        o.font = Math.max(1, Math.round(30 * sc)) + 'px ' + FONT;
        o.textAlign = 'center'; o.textBaseline = 'middle';
        o.fillStyle = '#fff';
        o.fillText(it.emoji, x, y);
      });
    }
    function drawParts(o) {
      parts.forEach(p => {
        const x = p.wx - camX;
        if (x < -20 || x > W + 20) return;
        o.globalAlpha = clamp(p.life / p.max, 0, 1);
        o.fillStyle = p.color;
        if (p.kind === 'star') star(o, x, p.y, p.size);
        else if (p.kind === 'leaf') ell(o, x, p.y, p.size * 1.7, p.size * 0.85, p.rot || 0);
        else if (p.kind === 'drop') ell(o, x, p.y, p.size * 0.8, p.size * 1.3);
        else circ(o, x, p.y, p.size);
      });
      o.globalAlpha = 1;
    }
    function drawBadges(o, now) {
      spots.forEach(s => {
        if (s.dug) return;
        let lead = null, best = 0;
        Object.keys(s.prog).forEach(k => { if (s.prog[k] > best && dogs[k]) { best = s.prog[k]; lead = +k; } });
        const here = order.find(id => dogs[id].onSpot === s);
        if (lead == null && here == null) return;
        const who = lead != null ? lead : here;
        const x = s.wx - camX, y = s.y - s.r * (s.kind === 'bush' ? 1.6 : 1) - 34 + Math.sin(now * 5) * 2;
        o.fillStyle = 'rgba(10,12,24,.72)'; circ(o, x, y, 16);
        o.lineWidth = 4;
        o.strokeStyle = 'rgba(255,255,255,.2)'; o.beginPath(); o.arc(x, y, 12.5, 0, Math.PI * 2); o.stroke();
        if (best > 0) { o.strokeStyle = api.color(who); o.beginPath(); o.arc(x, y, 12.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * best); o.stroke(); }
        o.font = '13px ' + FONT; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillStyle = '#fff';
        o.fillText('🐾', x, y + 1);
      });
    }
    function drawLabels(o) {
      o.font = 'bold 12px ' + FONT; o.textAlign = 'left'; o.textBaseline = 'middle';
      order.forEach(id => {
        const d = dogs[id], name = api.owner(id), tw = o.measureText(name).width, w = tw + 26, x = d.ox - w / 2, y = OWNER_Y - 146;
        o.globalAlpha = 0.95 * d.alpha;
        o.fillStyle = 'rgba(10,12,24,.62)'; rr(o, x, y - 9, w, 18, 9); o.fill();
        o.fillStyle = api.color(id); circ(o, x + 9, y, 4);
        o.fillStyle = '#fff'; o.fillText(name, x + 17, y + 0.5);
      });
      o.globalAlpha = 1;
    }

    return {
      enter(ids) {
        camX = Math.floor(rnd() * 60000);   // a different street every day
        spots = []; puddles = []; poops = []; items = []; parts = []; cat = null;
        catAt = api.time() + range(CAT_FIRST);
        nextPuddleX = camX + 520 + rnd() * 300;
        dogs = {}; order = [];
        ids.forEach(id => addDog(id, true));
        order.forEach(id => spotFor(dogs[id], api.time(), false));   // a fair start: one smell each
        spotClock = 2 + rnd() * 2;
        spawnTick(0, api.time());
      },
      leave() {
        order.forEach(id => api.send(id, { t: 'wwWalk', dig: 0, digP: 0, poop: 0, cat: 0 }));
        spots = []; puddles = []; poops = []; items = []; parts = []; cat = null;
        dogs = {}; order = [];
      },
      addDog(id) { addDog(id, false); },
      removeDog,
      onMessage(id, m) {
        const d = dogs[id];
        if (!d || !m) return;
        const now = api.time();
        if (m.t === 'wwMove') {
          let x = Number(m.x), y = Number(m.y);
          if (!isFinite(x)) x = 0;
          if (!isFinite(y)) y = 0;
          x = clamp(x, -1, 1); y = clamp(y, -1, 1);
          const mag = Math.hypot(x, y);
          if (mag > 1) { x /= mag; y /= mag; }
          d.inX = x; d.inY = y;
          if (mag > DEADZONE) d.sniffT = 0;
        } else if (m.t === 'wwDig') dig(d, now);
        else if (m.t === 'wwPoop') pickUp(d, now);
        else if (m.t === 'wwHeel') heel(d);
      },
      update(dt) {
        if (!(dt > 0)) return;
        const now = api.time();
        camX += CAM_SPEED * dt;
        spawnTick(dt, now);
        spots = spots.filter(s => s.wx - camX > -140);
        puddles = puddles.filter(p => p.wx - camX > -90);
        poops = poops.filter(p => p.wx - camX > -60);
        spots.forEach(s => Object.keys(s.prog).forEach(k => {
          const d = dogs[k];
          if (!d) { delete s.prog[k]; return; }
          if (!digging(d, now)) { s.prog[k] -= DIG_DECAY * dt; if (s.prog[k] <= 0) delete s.prog[k]; }
        }));
        updateCat(dt, now);
        order.forEach(id => moveDog(dogs[id], dt, now));
        separate();
        order.forEach(id => settleDog(dogs[id], dt, now));
        updateParts(dt);
        items = items.filter(it => now - it.t0 < 1.7);
        sendState(now);
      },
      draw(o) {
        const now = api.time();
        drawSky(o);
        drawFar(o);
        drawHouses(o);
        drawGardens(o);
        drawFences(o);
        if (cat && cat.mode === 'sit') drawCat(o, cat, now);
        drawGround(o);
        drawProps(o);
        drawPuddles(o, now);
        drawGroundRings(o, now);
        // depth-sorted: owners walk at the back, then dogs, smells and souvenirs by y
        const list = [];
        order.forEach(id => {
          const d = dogs[id];
          list.push({ y: OWNER_Y + d.slot * 0.01, f: () => drawOwner(o, d, now) });
          list.push({ y: d.y, f: () => drawDog(o, d, now) });
        });
        spots.forEach(s => { const x = s.wx - camX; if (x > -60 && x < W + 60) list.push({ y: s.y, f: () => drawSpot(o, s, now) }); });
        poops.forEach(p => list.push({ y: p.y, f: () => drawPoop(o, p, now) }));
        if (cat && cat.mode === 'dash') list.push({ y: cat.y, f: () => drawCat(o, cat, now) });
        list.sort((a, b) => a.y - b.y).forEach(e => e.f());
        drawItems(o, now);
        drawParts(o);
        drawBadges(o, now);
        drawLabels(o);
      },
      _debug() { return { camX, cat, catAt, spots, puddles, poops, dogs }; },
      dogPos(id) {
        const d = dogs[id], dog = api.dog(id);
        if (!d || !dog) return null;
        const p = WW.art.points(dog, d.scale);
        return { x: d.x + d.facing * p.head[0], y: d.y + p.head[1] - 20 };
      },
      // Harness bot: hunt the nearest free smell, dig it out, clean up, heel sometimes.
      devBot(id, r) {
        const d = dogs[id];
        if (!d) return null;
        const now = api.time();
        const b = bots[id] || (bots[id] = { mx: 0, my: 0, at: -9, digAt: -9, heelAt: null });
        if (d.chaseT > 0) {
          if (b.heelAt == null) b.heelAt = r() < 0.6 ? now + 0.3 + r() * 1.2 : Infinity;
          if (now >= b.heelAt) { b.heelAt = Infinity; return { t: 'wwHeel' }; }
          return null;
        }
        b.heelAt = null;
        if (d.poop && r() < 0.04) return { t: 'wwPoop' };
        const move = (x, y) => {
          if (Math.abs(x - b.mx) + Math.abs(y - b.my) > 0.15 || ((x || y) && now - b.at > 0.6)) {
            b.mx = x; b.my = y; b.at = now;
            return { t: 'wwMove', x, y };
          }
          return null;
        };
        if (spotUnder(d)) {
          if (now - b.digAt > 0.14 + r() * 0.12) { b.digAt = now; return { t: 'wwDig' }; }
          return move(0, 0);
        }
        let best = null, bd = 1e9;
        spots.forEach(s => {
          if (s.dug) return;
          const sx = s.wx - camX;
          if (sx < d.x - 140 || sx > W - 20 || Math.hypot(sx - d.ox, s.y - OWNER_Y) > LEASH + 50) return;
          const taken = Object.keys(s.prog).some(k => +k !== id && s.prog[k] > 0.3);
          const dist = Math.hypot(sx - d.x, s.y - d.y) + (taken ? 140 : 0);
          if (dist < bd) { bd = dist; best = s; }
        });
        if (!best) return move(0, 0);
        const dx = best.wx - camX - d.x, dy = best.y - d.y, m = Math.hypot(dx, dy) || 1;
        return move(Math.round(dx / m * 10) / 10, Math.round(dy / m * 10) / 10);
      }
    };
  };
})();
