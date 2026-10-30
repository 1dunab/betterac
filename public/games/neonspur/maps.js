// ===== Neonspur arenas (legend: see docs/NEONSPUR.md) =====
(function (root) {
  // tiny grid builder: g.rect(x, y, w, h, ch), g.set(x, y, ch), g.rows()
  function grid(w, h) {
    const c = [];
    for (let y = 0; y < h; y++) c.push(Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? '#' : '.'));
    const g = {
      set: (x, y, ch) => { c[y][x] = ch; return g; },
      rect: (x, y, rw, rh, ch) => { for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) c[j][i] = ch; return g; },
      rows: () => c.map(r => r.join(''))
    };
    return g;
  }
  // raised block with a 2-wide ramp on one side: side 'N' 'S' 'W' 'E' = where the ramp sits; ramp is one cell deep
  function terrace(g, x, y, w, h, side, at) {
    g.rect(x, y, w, h, '=');
    if (side === 'N') g.rect(at, y - 1, 2, 1, 'v');
    else if (side === 'S') g.rect(at, y + h, 2, 1, '^');
    else if (side === 'W') g.rect(x - 1, at, 1, 2, '>');
    else g.rect(x + w, at, 1, 2, '<');
  }

  // spawns: 0 east / 1 west on one axis (rows offset so they pass each other), 2 south / 3 north on the other
  const spawns = (n, a, b, c, d) => [{ x: 6, y: a, dir: 0 }, { x: n - 7, y: b, dir: 2 }, { x: c, y: 6, dir: 1 }, { x: d, y: n - 7, dir: 3 }];

  // --- Raster: open floor, four small pillars ---
  const raster = grid(44, 44);
  [[12, 12], [30, 12], [12, 30], [30, 30]].forEach(([x, y]) => raster.rect(x, y, 2, 2, '#'));

  // --- Säulenhalle: pillars, low terraces to hop onto, jump pads ---
  const saeulen = grid(48, 48);
  [[12, 10], [34, 10], [8, 32], [37, 35], [16, 16], [31, 31], [23, 23], [14, 36], [38, 18], [28, 12], [20, 28]]
    .forEach(([x, y]) => saeulen.rect(x, y, 2, 2, '#'));
  [[20, 7, 3, 3], [36, 14, 4, 2], [6, 38, 3, 3], [30, 40, 3, 3], [10, 24, 4, 2], [34, 19, 2, 3], [20, 18, 3, 3], [26, 34, 4, 2]]
    .forEach(([x, y, w, h]) => saeulen.rect(x, y, w, h, '='));
  [[17, 8], [30, 22], [18, 24], [26, 38], [4, 12], [42, 40], [24, 14], [12, 28]]
    .forEach(([x, y]) => saeulen.set(x, y, '*'));

  // --- Terrassen: central plateau with ramps, launch pads, side terraces ---
  const terr = grid(52, 52);
  terrace(terr, 18, 18, 16, 16, 'N', 25);
  terr.rect(25, 34, 2, 1, '^'); terr.rect(17, 25, 1, 2, '>'); terr.rect(34, 25, 1, 2, '<');   // S, W, E ramps
  // pads 4 cells before the plateau edge: a jump from there lands right on the rim
  [[21, 14], [30, 14], [21, 37], [30, 37], [14, 21], [14, 30], [37, 21], [37, 30]].forEach(([x, y]) => terr.set(x, y, '*'));
  terr.set(22, 22, '+'); terr.set(29, 29, '+');
  terrace(terr, 6, 6, 8, 6, 'S', 9);
  terrace(terr, 38, 6, 8, 6, 'S', 41);
  terrace(terr, 6, 40, 8, 6, 'N', 9);
  terrace(terr, 38, 40, 8, 6, 'N', 41);

  const T = (floor, grid_, wall, edge, raised, sky) => ({ floor, grid: grid_, wall, edge, raised, sky });
  const api = [
    { key: 'raster', label: 'Raster', theme: T('#05060f', '#1b2a6b', '#0b0f24', '#3d6bff', '#0a1030', '#020208'),
      rows: raster.rows(), spawns: spawns(44, 20, 23, 23, 20) },
    { key: 'saeulen', label: 'Säulenhalle', theme: T('#0a0512', '#4a1a6b', '#180a28', '#d03dff', '#1c0b30', '#05020a'),
      rows: saeulen.rows(), spawns: spawns(48, 21, 26, 26, 21) },
    { key: 'terrassen', label: 'Terrassen', theme: T('#031012', '#0f4a52', '#07191c', '#25f0e0', '#07242a', '#010708'),
      rows: terr.rows(), spawns: spawns(52, 24, 27, 27, 24) }
  ];
  if (typeof module === 'object' && module.exports) module.exports = api; else root.NeonspurMaps = api;
})(typeof window !== 'undefined' ? window : globalThis);
