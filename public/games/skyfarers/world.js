// ===== Skyfarers world: catalogs and the seeded archipelago layout (see docs/SKYFARERS.md) =====
(function (root) {
  const HOME_R = 16, DOCK_R = 21, RING_R = 10;
  const W = 160, H = 100;

  const BUILDINGS = {
    windrad:    { name: 'Windrad',       icon: '🌀', cost: { holz: 2, kristall: 1 }, buildS: 6,  hp: 60,  stages: 1 },
    kanone:     { name: 'Kanonenturm',   icon: '💣', cost: { holz: 3, kristall: 2 }, buildS: 10, hp: 80,  stages: 1 },
    zisterne:   { name: 'Zisterne',      icon: '💧', cost: { holz: 3, kristall: 0 }, buildS: 8,  hp: 70,  stages: 1 },
    werkstatt:  { name: 'Werkstatt',     icon: '🔧', cost: { holz: 2, kristall: 2 }, buildS: 8,  hp: 70,  stages: 1 },
    sternwarte: { name: 'Sternwarte',    icon: '🔭', cost: { holz: 9, kristall: 9 }, buildS: 12, hp: 120, stages: 3 }   // cost and buildS are per stage
  };

  // strength scales lightning rate (interval / strength) and the 'lang' second storm is the stronger one
  const NACHT = 1.3;
  const EVENTS = {
    kurz: [
      { kind: 'sturm', at: 70, until: 110, strength: 1 },
      { kind: 'nacht', at: 185, until: 235, strength: NACHT }
    ],
    normal: [
      { kind: 'sturm', at: 90, until: 135, strength: 1 },
      { kind: 'drachen', at: 210, until: 250, strength: 1 },
      { kind: 'nacht', at: 300, until: 355, strength: NACHT }
    ],
    lang: [
      { kind: 'sturm', at: 90, until: 135, strength: 1 },
      { kind: 'drachen', at: 200, until: 240, strength: 1 },
      { kind: 'sturm', at: 300, until: 345, strength: 1.5 },
      { kind: 'nacht', at: 410, until: 470, strength: NACHT }
    ]
  };

  const DAUER = { kurz: 240, normal: 360, lang: 480 };

  const DIFF = {
    leicht: { lightning: 3.5, dragons: { drachen: 2, nacht: 1 }, fire: 0.03, start: { holz: 4, kristall: 2 } },
    normal: { lightning: 2.5, dragons: { drachen: 3, nacht: 2 }, fire: 0.04, start: { holz: 2, kristall: 0 } },
    heftig: { lightning: 1.6, dragons: { drachen: 4, nacht: 3 }, fire: 0.06, start: { holz: 0, kristall: 0 } }
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const ISLET_R = 4, ISLET_TREES = 10, RING_MIN = 30, RING_MAX = 46, RING_XSCALE = 1.5, SPACING = 14;
  const MARGIN = 3;   // keep this much free beyond islet radius + orbit

  function make(seed) {
    const rnd = mulberry32(((seed | 0) ^ 0x7f4a7c15) || 1);
    const kinds = ['kristall', 'holz', 'kristall', 'holz', 'kristall', 'holz', 'kristall'];
    let pts = null;
    for (let round = 0; round < 60 && !pts; round++) {
      const spacing = round < 50 ? SPACING : SPACING - 4;   // relax only in the (practically unreachable) fallback
      const out = [];
      let failed = false;
      for (let k = 0; k < kinds.length && !failed; k++) {
        let placed = false;
        for (let a = 0; a < 400 && !placed; a++) {
          const ang = rnd() * Math.PI * 2, rr = RING_MIN + rnd() * (RING_MAX - RING_MIN);
          const orbitR = 2 + rnd() * 2;
          const x = Math.cos(ang) * rr * RING_XSCALE, y = Math.sin(ang) * rr;
          const mx = W / 2 - ISLET_R - orbitR - MARGIN, my = H / 2 - ISLET_R - orbitR - MARGIN;
          if (Math.abs(x) > mx || Math.abs(y) > my) continue;
          if (out.some(p => Math.hypot(p.ax - x, p.ay - y) < spacing)) continue;
          out.push({ ax: x, ay: y, orbitR, orbitT: 60 + rnd() * 60, phase: rnd() * Math.PI * 2 });
          placed = true;
        }
        if (!placed) failed = true;
      }
      if (!failed) pts = out;
    }
    const islets = pts.map((p, id) => {
      const o = { id, kind: kinds[id], ax: p.ax, ay: p.ay, r: ISLET_R, orbitR: p.orbitR, orbitT: p.orbitT, phase: p.phase };
      if (o.kind === 'holz') o.trees = ISLET_TREES;
      return o;
    });
    const slots = [{ i: 0, x: 0, y: 0, angle: 0 }];
    for (let k = 1; k <= 6; k++) {
      const angle = k * Math.PI / 3;
      slots.push({ i: k, x: Math.cos(angle) * RING_R, y: Math.sin(angle) * RING_R, angle });
    }
    const clouds = [];
    const nc = 2 + Math.floor(rnd() * 2);
    for (let id = 0; id < nc; id++) clouds.push({ id, x: (rnd() * 2 - 1) * 60, y: (rnd() * 2 - 1) * 35, r: 6 + rnd() * 3 });
    return { seed: seed | 0, w: W, h: H, home: { r: HOME_R, dockR: DOCK_R, slots }, islets, clouds };
  }

  function isletPos(islet, t) {
    const a = islet.phase + Math.PI * 2 * t / islet.orbitT;
    return { x: islet.ax + Math.cos(a) * islet.orbitR, y: islet.ay + Math.sin(a) * islet.orbitR };
  }

  const api = { BUILDINGS, EVENTS, DAUER, DIFF, make, isletPos, mulberry32 };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SkyfarersWorld = api;
})(typeof window !== 'undefined' ? window : globalThis);
