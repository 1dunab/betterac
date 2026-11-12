// ===== Micro Racer: tracks and biomes (data only; sim.js, render.js and the tests read it) =====
(function (root) {
  // The figure eight: a lemniscate that crosses itself at 90° in the middle (x = a·cos t, z = a/2·sin 2t)
  function eight(a, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = i / n * Math.PI * 2;
      pts.push([Math.round(a * Math.cos(t)), Math.round(a / 2 * Math.sin(2 * t))]);
    }
    return pts;
  }

  // Closed loops of control points [x, z]; sim.js runs a Catmull-Rom spline through them.
  const TRACKS = {
    desert: { label: '🌵 Wüste', biome: 'desert',
      pts: [[-150, -60], [-60, -110], [60, -95], [150, -55], [165, 30], [95, 60], [30, 25], [-40, 55], [-90, 110], [-165, 55]] },
    snow: { label: '❄️ Schnee', biome: 'snow',
      pts: [[-140, -70], [-30, -100], [80, -90], [140, -30], [90, 20], [140, 80], [40, 105], [-45, 60], [-115, 95], [-160, 10]] },
    beach: { label: '🏖️ Strand', biome: 'beach',
      pts: [[-160, -40], [-80, -100], [40, -110], [140, -70], [170, 20], [110, 90], [0, 110], [-100, 90], [-150, 30], [-175, -5]] },
    vulkan: { label: '🌋 Vulkan', biome: 'vulkan',
      pts: [[-165, -30], [-120, -95], [-30, -105], [30, -62], [95, -100], [160, -70], [172, 5], [115, 42], [45, 18], [-8, 52], [38, 88], [22, 120], [-55, 122], [-135, 92], [-178, 30]] },
    city: { label: '🌃 Neonstadt', biome: 'city',
      pts: [[-118, -94], [-65, -96], [-25, -62], [28, -62], [66, -96], [158, -88], [172, -14], [136, 24], [170, 62], [146, 106], [34, 100], [0, 66], [-58, 66], [-92, 102], [-160, 96], [-176, 4], [-162, -84]] },
    toy: { label: '🧸 Kinderzimmer', biome: 'toy', crossing: true, pts: eight(150, 16) }
  };

  // Looks, plus the two values the rules read: grip (tyre grip factor) and lava (number of lava pools).
  const BIOMES = {
    desert: {
      name: 'Wüste', skyTop: '#4a9fe6', sky: '#9bd3f7', fog: '#e8c48f', ground: '#d9a05b', ground2: '#c98f4a',
      road: '#6b6560', stripe: '#f5efe4', curb: ['#e04a3a', '#f2f2f2'], sun: '#fff7e8', light: 1, hills: '#c9925c',
      deco: [{ kind: 'cactus', n: 46, c: '#3f9b4f' }, { kind: 'rock', n: 30, c: '#a8927c' }]
    },
    snow: {
      name: 'Schnee', skyTop: '#7fb0e8', sky: '#c6dcf6', fog: '#dfeafc', ground: '#eef4fb', ground2: '#d9e6f5',
      road: '#4d5766', stripe: '#e8eef7', curb: ['#3d7fe0', '#f4f8ff'], sun: '#ffffff', light: 1, hills: '#c2d3ea',
      grip: 0.62, ambient: 'snow',
      deco: [{ kind: 'fir', n: 52, c: '#2f6d4f' }, { kind: 'rock', n: 22, c: '#b9cde0' }]
    },
    beach: {
      name: 'Strand', skyTop: '#3fa6e0', sky: '#9bdcf3', fog: '#ffe9c4', ground: '#f2dfae', ground2: '#e8d094',
      road: '#7a7268', stripe: '#fff6df', curb: ['#ff8a3c', '#ffffff'], sun: '#fff7e8', light: 1, water: '#2f9ec9',
      deco: [{ kind: 'palm', n: 34, c: '#3fae62' }, { kind: 'rock', n: 18, c: '#c9b391' }]
    },
    vulkan: {
      name: 'Vulkan', skyTop: '#160b16', sky: '#7a2c1c', fog: '#4f2620', ground: '#4a3d3c', ground2: '#3a2f2f',
      road: '#77716f', stripe: '#ffb347', curb: ['#ff7b1c', '#2a2223'], sun: '#ffc9a8', light: 1, hills: '#2b1f20',
      lava: 7, ambient: 'embers', hemi: ['#ffc4a6', '#4a3a3a'],
      deco: [{ kind: 'rock', n: 44, c: '#5a4c4d' }, { kind: 'deadtree', n: 26, c: '#241e1f' }]
    },
    city: {
      name: 'Neonstadt', night: true, skyTop: '#03041a', sky: '#161538', fog: '#1b1740', ground: '#171a28', ground2: '#20243c',
      road: '#30354a', stripe: '#00f0ff', curb: ['#ff2bd6', '#00e5ff'], sun: '#b7c4ff', light: 0.75, hemi: ['#8f9cff', '#2a2f55'],
      deco: [{ kind: 'tower', n: 54 }, { kind: 'lamp', n: 34 }]
    },
    toy: {
      name: 'Kinderzimmer', skyTop: '#f4e3c2', sky: '#f6e6c8', fog: '#ecd3a8', ground: '#c99a62', ground2: '#b98850',
      road: '#3f4652', stripe: '#ffe14d', curb: ['#ffd60a', '#23262e'], sun: '#fff3da', light: 1, wood: true,
      deco: [{ kind: 'block', n: 40 }, { kind: 'pencil', n: 16 }, { kind: 'ball', n: 14 }, { kind: 'die', n: 12 }]
    }
  };

  // Random track: ten points on a dented oval
  function randomPts(rng) {
    const pts = [], n = 10;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + (rng() - 0.5) * 0.28;
      const r = 95 + rng() * 75;
      pts.push([Math.cos(a) * r * 1.25, Math.sin(a) * r]);
    }
    return pts;
  }

  // Settings key → { key, label, biomeKey, biome, pts }
  function pick(key, rng) {
    if (TRACKS[key]) { const t = TRACKS[key]; return { key, label: t.label, biomeKey: t.biome, biome: BIOMES[t.biome], pts: t.pts }; }
    const keys = Object.keys(BIOMES), b = keys[Math.floor(rng() * keys.length)];
    return { key: 'random', label: '🎲 ' + BIOMES[b].name, biomeKey: b, biome: BIOMES[b], pts: randomPts(rng) };
  }

  const api = { TRACKS, BIOMES, randomPts, pick };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RacerTracks = api;
})(typeof window !== 'undefined' ? window : globalThis);
