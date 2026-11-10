// ===== Furt & Fehde world: the river valley "Flusskreuz", catalogs, grid helpers (see docs/FURTFEHDE.md) =====
// Pure data + math, no DOM, no unseeded randomness, no clock: runs in Node (module.exports) and in the browser (global FurtWorld).
(function (root) {
  // ---- grid and flood rule ----
  const GW = 144, GH = 90, VRES = 2, BORDER = 12, HX = 337, HY = 229, FX = 168, FY = 114;
  const FLOOD_Y = 1.2, WADE_MAX = 0.45, DRY_EPS = 0.05, WADE_SPEED = 0.45;
  const X0 = -72 - BORDER, Y0 = -45 - BORDER;   // north-west corner of the height field
  const EPS = 1e-9;
  const FOREST_R = 30, ROCK_R = 34, FOREST_NEED = 12, FOREST_NEED_R = 8;

  const CLASSES = [
    { key: 'W', name: 'Wasser',    walk: 0,   build: false, color: '#2b6f9c' },
    { key: 'F', name: 'Flach',     walk: 1.0, build: false, color: '#7cc3cf' },
    { key: 'S', name: 'Sand',      walk: 1.0, build: false, color: '#e6d7a4' },
    { key: 'B', name: 'Brücke',    walk: 1.0, build: false, color: '#8b6a45' },
    { key: 'M', name: 'Ried',      walk: 0.6, build: false, color: '#95ad66' },
    { key: 'A', name: 'Aue',       walk: 1.0, build: true,  color: '#7fbd54' },
    { key: 'G', name: 'Wiese',     walk: 1.0, build: true,  color: '#b9d06a' },
    { key: 'T', name: 'Wald',      walk: 0.7, build: false, color: '#2f6b3b' },
    { key: 'R', name: 'Fels',      walk: 0,   build: false, color: '#8e9096' },
    { key: 'H', name: 'Steilhang', walk: 0,   build: false, color: '#6d5846' }
  ];
  const CI = {};   // class index by key
  CLASSES.forEach((c, i) => { CI[c.key] = i; });
  const cW = CI.W, cF = CI.F, cS = CI.S, cB = CI.B, cM = CI.M, cA = CI.A, cG = CI.G, cT = CI.T, cR = CI.R, cH = CI.H;
  const WALK = new Float64Array(CLASSES.map(c => c.walk));

  // Footprints are [w, h] at rot 0 (rot 1 swaps). Names, icons, sizes and placement rules are binding; `draft` is Phase 1.
  const BUILDINGS = {
    bergfried:    { name: 'Bergfried',    icon: '🏰', size: [6, 6], mat: 'stein', rule: 'fest auf dem Burgplatz',
                    draft: { hp: 400, houses: 8, store: 'alles', arrows: true } },
    huette:       { name: 'Hütte',        icon: '🏠', size: [2, 2], mat: 'holz',  rule: '',
                    draft: { cost: { holz: 6 }, buildS: 10, hp: 60, houses: 4 } },
    hof:          { name: 'Hof',          icon: '🌾', size: [5, 4], mat: 'holz',  rule: 'Ertrag × (1 + 0,5 · Anteil Aue)',
                    draft: { cost: { holz: 10 }, buildS: 16, hp: 90, workers: 1, aueBonus: 0.5, farmhouse: [2, 2] } },
    kornspeicher: { name: 'Kornspeicher', icon: '🏚️', size: [3, 3], mat: 'holz',  rule: '',
                    draft: { cost: { holz: 12 }, buildS: 14, hp: 100, store: { korn: 60 } } },
    lager:        { name: 'Lagerplatz',   icon: '📦', size: [3, 3], mat: 'holz',  rule: '',
                    draft: { cost: { holz: 8 }, buildS: 10, hp: 80, store: { holz: 80, stein: 40 } } },
    holzfaeller:  { name: 'Holzfäller',   icon: '🪓', size: [2, 2], mat: 'holz',  rule: 'mind. 12 Waldfelder im Umkreis von 8',
                    draft: { cost: { holz: 6 }, buildS: 10, hp: 60, workers: 1 } },
    steinbruch:   { name: 'Steinbruch',   icon: '⛏️', size: [3, 3], mat: 'holz',  rule: 'berührt mind. 2 Felsfelder',
                    draft: { cost: { holz: 12 }, buildS: 14, hp: 100, workers: 2 } },
    kaserne:      { name: 'Kaserne',      icon: '⚔️', size: [4, 3], mat: 'stein', rule: '',
                    draft: { cost: { holz: 10, stein: 14 }, buildS: 24, hp: 220, recruits: true } },
    wachturm:     { name: 'Wachturm',     icon: '🗼', size: [2, 2], mat: 'stein', rule: '',
                    draft: { cost: { holz: 4, stein: 12 }, buildS: 18, hp: 160, arrows: true } },
    brunnen:      { name: 'Brunnen',      icon: '🪣', size: [1, 1], mat: 'stein', rule: 'Löschradius 12',
                    draft: { cost: { stein: 6 }, buildS: 8, hp: 80, bucketR: 12 } }
  };
  const BKEYS = Object.keys(BUILDINGS);
  const WOODEN = BKEYS.filter(k => BUILDINGS[k].mat === 'holz');

  const UNITS = {
    bauer: { name: 'Bauer',        icon: '🧑‍🌾', height: 1.0,  role: 'Arbeiter und Träger (Korn, Holz, Stein, Eimer)',
             draft: { hp: 20, speed: 1.0, carries: ['korn', 'holz', 'stein', 'eimer'] } },
    speer: { name: 'Speerträger',  icon: '🗡️', height: 1.15, role: 'Nahkämpfer, billig, stark gegen Reiter',
             draft: { cost: { korn: 1, holz: 1 }, hp: 40, dmg: 5, speed: 1.0, beats: 'ritter' } },
    bogen: { name: 'Bogenschütze', icon: '🏹', height: 1.1,  role: 'Fernkämpfer',
             draft: { cost: { korn: 1, holz: 2 }, hp: 28, dmg: 4, range: 9, speed: 1.0, beats: 'speer' } },
    ritter:{ name: 'Ritter',       icon: '🐎', height: 1.8,  role: 'schnell und stark, schlägt Bogenschützen',
             draft: { cost: { korn: 2, stein: 2 }, hp: 90, dmg: 9, speed: 1.9, beats: 'bogen' } },
    fackel:{ name: 'Fackelträger', icon: '🔥', height: 1.05, role: 'schnell und zerbrechlich, zündet Felder und Holzbauten an',
             draft: { cost: { korn: 1, holz: 1 }, hp: 18, dmg: 1, speed: 1.6, fire: true } }
  };

  // ---- seeded randomness (independent streams) ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // 2D value noise in 0..1 (quintic fade); hash-based, so it needs no tables
  function makeNoise(seed) {
    const s = seed | 0;
    const hash = (ix, iy) => {
      let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ s;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    return function (x, y) {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
  }
  const fbm = (n, x, y, oct) => {
    let v = 0, amp = 0.5, tot = 0, f = 1;
    for (let o = 0; o < oct; o++) { v += amp * n(x * f + o * 17.3, y * f - o * 9.1); tot += amp; amp *= 0.5; f *= 2.03; }
    return v / tot;
  };
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const hash32 = (a, b) => { let h = Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA6B); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; return h | 0; };

  // ---- grid helpers (work on a world and on a decoded grid) ----
  const surf = (L) => L * FLOOD_Y;
  function cellOf(x, y) {
    const i = Math.floor(x + 72), j = Math.floor(y + 45);
    return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i;
  }
  const cellXY = (k) => ({ x: -71.5 + k % GW, y: -44.5 + Math.floor(k / GW) });
  // bilinear on the vertex field (full extent incl. the border); a decoded grid falls back to hq between cell centres
  function heightAt(g, x, y) {
    if (g.heights) {
      const u = clamp((x - X0) * VRES, 0, HX - 1), v = clamp((y - Y0) * VRES, 0, HY - 1);
      const u0 = Math.min(Math.floor(u), HX - 2), v0 = Math.min(Math.floor(v), HY - 2), fu = u - u0, fv = v - v0, h = g.heights;
      const a = h[v0 * HX + u0], b = h[v0 * HX + u0 + 1], c = h[(v0 + 1) * HX + u0], d = h[(v0 + 1) * HX + u0 + 1];
      return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
    }
    const gx = clamp(x + 71.5, 0, GW - 1), gy = clamp(y + 44.5, 0, GH - 1);
    const i0 = Math.min(Math.floor(gx), GW - 2), j0 = Math.min(Math.floor(gy), GH - 2), fu = gx - i0, fv = gy - j0, q = g.hq, k = j0 * GW + i0;
    return ((q[k] * (1 - fu) + q[k + 1] * fu) * (1 - fv) + (q[k + GW] * (1 - fu) + q[k + GW + 1] * fu) * fv) * 0.1;
  }
  // depth in decimetres: surf(L) − h, all in integers except L
  const depthD = (g, k, L) => L * (FLOOD_Y * 10) - g.hq[k];
  function walk(g, k, L) {
    const s = WALK[g.cls[k]];
    if (s === 0) return 0;
    const d = depthD(g, k, L);
    if (d > WADE_MAX * 10 + EPS) return 0;
    return d > EPS ? s * WADE_SPEED : s;
  }
  const dry = (g, k, L) => depthD(g, k, L) <= -DRY_EPS * 10 + EPS;

  // ---- travel: Dijkstra field and A* path on the cell grid (8 neighbours, no corner cutting) ----
  const N = GW * GH, SQ2 = Math.SQRT2;
  const DXN = [1, -1, 0, 0, 1, 1, -1, -1], DYN = [0, 0, 1, -1, 1, -1, 1, -1], DSTEP = [1, 1, 1, 1, SQ2, SQ2, SQ2, SQ2];
  const _g = new Float32Array(N), _par = new Int32Array(N), _stamp = new Uint32Array(N);
  const _hk = new Float32Array(1 << 18), _hi = new Int32Array(1 << 18);
  let _st = 0, _hn = 0, _popKey = 0;
  function hpush(key, item) {
    let i = _hn++;
    while (i > 0) { const p = (i - 1) >> 1; if (_hk[p] <= key) break; _hk[i] = _hk[p]; _hi[i] = _hi[p]; i = p; }
    _hk[i] = key; _hi[i] = item;
  }
  function hpop() {
    const item = _hi[0]; _popKey = _hk[0];
    const key = _hk[--_hn], it = _hi[_hn];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= _hn) break;
      if (c + 1 < _hn && _hk[c + 1] < _hk[c]) c++;
      if (_hk[c] >= key) break;
      _hk[i] = _hk[c]; _hi[i] = _hi[c]; i = c;
    }
    _hk[i] = key; _hi[i] = it;
    return item;
  }
  // speed factor per cell at level L (walk()) and its inverse (0 = blocked); `block` (Uint8Array, optional): non-zero cells are blocked too
  function speedMap(g, L, block) {
    const sp = new Float32Array(N), inv = new Float32Array(N);
    for (let k = 0; k < N; k++) { const s = block && block[k] ? 0 : walk(g, k, L); sp[k] = s; inv[k] = s > 0 ? 1 / s : 0; }
    return { sp, inv };
  }
  // travel time from every cell to the nearest target (cell indices); Infinity = unreachable. `block` (optional Uint8Array):
  // non-zero cells (building footprints) cannot be entered; a blocked target still seeds the field into its free neighbours.
  function field(g, targets, L, out, block) {
    const { inv } = speedMap(g, L, block);
    const d = out && out.length === N ? out : new Float32Array(N);
    d.fill(Infinity); _hn = 0;
    for (const t of targets) if (t >= 0 && t < N && d[t] !== 0) { d[t] = 0; hpush(0, t); }
    while (_hn > 0) {
      const k = hpop();
      if (_popKey > d[k]) continue;
      const i = k % GW, j = (k - i) / GW, ik = inv[k];
      for (let n = 0; n < 8; n++) {
        const ni = i + DXN[n], nj = j + DYN[n];
        if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
        const nk = nj * GW + ni, inn = inv[nk];
        if (inn === 0) continue;
        if (n >= 4 && (inv[j * GW + ni] === 0 || inv[nj * GW + i] === 0)) continue;   // no corner cutting
        const nd = _popKey + DSTEP[n] * 0.5 * (ik + inn);
        if (nd < d[nk]) { d[nk] = nd; hpush(nd, nk); }
      }
    }
    return d;
  }
  // exact time to walk a straight segment (grid traversal); Infinity if it enters a blocked cell
  function segCost(inv, x0, y0, x1, y1) {
    const px = x0 + 72, py = y0 + 45, dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 1e-9) return 0;
    let cx = Math.floor(px), cy = Math.floor(py);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tx = dx > 0 ? (cx + 1 - px) * tdx : dx < 0 ? (px - cx) * tdx : Infinity;
    let ty = dy > 0 ? (cy + 1 - py) * tdy : dy < 0 ? (py - cy) * tdy : Infinity;
    let t = 0, cost = 0;
    for (let guard = 0; guard < 600; guard++) {
      const tn = Math.min(tx, ty, 1);
      if (tn - t > 1e-9) {
        if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return Infinity;
        const iv = inv[cy * GW + cx];
        if (iv === 0) return Infinity;
        cost += (tn - t) * len * iv;
      }
      if (tn >= 1) break;
      t = tn;
      if (tx < ty) { cx += sx; tx += tdx; }
      else if (ty < tx) { cy += sy; ty += tdy; }
      else { cx += sx; cy += sy; tx += tdx; ty += tdy; }   // exact corner pass: the two side cells are only touched at a point
    }
    return cost;
  }
  // route between two points, smoothed by line of sight; array extras: cost (raw grid optimum), len, time.
  // opt: { look } limits the smoothing, { block } (Uint8Array) blocks extra cells such as building footprints
  function path(g, from, to, L, opt) {
    const a = cellOf(from.x, from.y), b = cellOf(to.x, to.y);
    if (a < 0 || b < 0) return null;
    const { inv } = speedMap(g, L, opt && opt.block);
    if (inv[a] === 0 || inv[b] === 0) return null;
    const gi = b % GW, gj = (b - gi) / GW;
    _st++; _hn = 0;
    _g[a] = 0; _stamp[a] = _st; _par[a] = -1; hpush(0, a);
    let found = false;
    while (_hn > 0) {
      const k = hpop();
      if (k === b) { found = true; break; }
      const gk = _g[k];
      if (_popKey > gk + Math.hypot((k % GW) - gi, Math.floor(k / GW) - gj) + 1e-4) continue;
      const i = k % GW, j = (k - i) / GW, ik = inv[k];
      for (let n = 0; n < 8; n++) {
        const ni = i + DXN[n], nj = j + DYN[n];
        if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
        const nk = nj * GW + ni, inn = inv[nk];
        if (inn === 0) continue;
        if (n >= 4 && (inv[j * GW + ni] === 0 || inv[nj * GW + i] === 0)) continue;
        const ng = gk + DSTEP[n] * 0.5 * (ik + inn);
        if (_stamp[nk] === _st && ng >= _g[nk]) continue;
        _stamp[nk] = _st; _g[nk] = ng; _par[nk] = k;
        hpush(ng + Math.hypot(ni - gi, nj - gj), nk);
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = b; k >= 0; k = _par[k]) cells.push(k);
    cells.reverse();
    const raw = _g[b];
    const pts = cells.map(k => cellXY(k));
    pts[0] = { x: from.x, y: from.y }; pts[pts.length - 1] = { x: to.x, y: to.y };
    // string pulling: skip waypoints while the straight segment is not slower than the grid route it replaces
    const acc = [0];
    for (let n = 1; n < pts.length; n++) acc.push(acc[n - 1] + segCost(inv, pts[n - 1].x, pts[n - 1].y, pts[n].x, pts[n].y));
    const out = [pts[0]];
    let s = 0;
    while (s < pts.length - 1) {
      let best = s + 1;
      for (let e = Math.min(pts.length - 1, s + (opt && opt.look || 48)); e > s + 1; e--) {
        const c = segCost(inv, pts[s].x, pts[s].y, pts[e].x, pts[e].y);
        if (c <= acc[e] - acc[s] + 1e-6) { best = e; break; }
      }
      out.push(pts[best]); s = best;
    }
    let len = 0, time = 0;
    for (let n = 1; n < out.length; n++) { len += Math.hypot(out[n].x - out[n - 1].x, out[n].y - out[n - 1].y); time += segCost(inv, out[n - 1].x, out[n - 1].y, out[n].x, out[n].y); }
    out.cost = raw; out.len = len; out.time = time;
    return out;
  }
  function pathTime(g, pts, L, block) {   // time to walk a polyline (Infinity if it enters a blocked cell)
    const { inv } = speedMap(g, L, block);
    let t = 0;
    for (let n = 1; n < pts.length; n++) t += segCost(inv, pts[n - 1].x, pts[n - 1].y, pts[n].x, pts[n].y);
    return t;
  }

  // ---- placement ----
  const keepCache = new WeakMap();
  function keepMask(g) {   // 1 on the 6x6 keep footprints: from a decoded grid's own mask or from world.sites
    if (g.keep) return g.keep;
    let m = keepCache.get(g);
    if (!m) {
      m = new Uint8Array(N);
      for (const s of g.sites || []) for (let dj = 0; dj < 6; dj++) for (let di = 0; di < 6; di++) m[(s.keep.j + dj) * GW + s.keep.i + di] = 1;
      keepCache.set(g, m);
    }
    return m;
  }
  const footprintOf = (kind, rot) => { const s = BUILDINGS[kind].size; return rot ? [s[1], s[0]] : [s[0], s[1]]; };
  // the two requirement rules (Holzfäller needs forest nearby, Steinbruch must touch rock); null = fine
  function kindRule(g, kind, i, j, w, h) {
    if (kind === 'holzfaeller') {
      const cx = i + w / 2, cy = j + h / 2, R = FOREST_NEED_R;
      let n = 0;
      for (let cj = Math.max(0, Math.floor(cy - R)); cj <= Math.min(GH - 1, Math.ceil(cy + R)); cj++)
        for (let ci = Math.max(0, Math.floor(cx - R)); ci <= Math.min(GW - 1, Math.ceil(cx + R)); ci++)
          if (g.cls[cj * GW + ci] === cT && Math.hypot(ci + 0.5 - cx, cj + 0.5 - cy) <= R) n++;
      return n >= FOREST_NEED ? null : 'forest';
    }
    if (kind === 'steinbruch') {
      let n = 0;
      for (let d = 0; d < w; d++) {
        if (j > 0 && g.cls[(j - 1) * GW + i + d] === cR) n++;
        if (j + h < GH && g.cls[(j + h) * GW + i + d] === cR) n++;
      }
      for (let d = 0; d < h; d++) {
        if (i > 0 && g.cls[(j + d) * GW + i - 1] === cR) n++;
        if (i + w < GW && g.cls[(j + d) * GW + i + w] === cR) n++;
      }
      return n >= 2 ? null : 'rock';
    }
    return null;
  }
  // (i, j) = top-left cell. Checks in the documented order: bounds, owner, terrain, wet, occupied, tight, forest, rock.
  function canPlace(g, kind, i, j, rot, o) {
    o = o || {};
    const B = BUILDINGS[kind], L = o.L || 0, occ = o.occ, lord = o.lord;
    if (!B || kind === 'bergfried') return { ok: false, reason: 'occupied' };   // keeps stand on their site already
    const [w, h] = footprintOf(kind, rot);
    if (i !== (i | 0) || j !== (j | 0) || i < 0 || j < 0 || i + w > GW || j + h > GH) return { ok: false, reason: 'bounds' };
    const keep = keepMask(g);
    const each = (fn) => { for (let dj = 0; dj < h; dj++) for (let di = 0; di < w; di++) if (fn((j + dj) * GW + i + di)) return true; return false; };
    if (each(k => g.owner[k] !== lord)) return { ok: false, reason: 'owner' };
    if (each(k => g.cls[k] !== cG && g.cls[k] !== cA)) return { ok: false, reason: 'terrain' };
    if (each(k => !dry(g, k, L))) return { ok: false, reason: 'wet' };
    const busy = (k) => keep[k] || (occ && occ[k]);
    if (each(busy)) return { ok: false, reason: 'occupied' };
    for (let cj = Math.max(0, j - 1); cj <= Math.min(GH - 1, j + h); cj++)
      for (let ci = Math.max(0, i - 1); ci <= Math.min(GW - 1, i + w); ci++)
        if (busy(cj * GW + ci)) return { ok: false, reason: 'tight' };
    const rule = kindRule(g, kind, i, j, w, h);
    return rule ? { ok: false, reason: rule } : { ok: true };
  }

  // Best spot for a building in the lord's quarter (shared by phones and bots). `occ` values may carry
  // 1 + index of the BUILDINGS key (any non-zero counts as occupied); the heuristics use that when present.
  function suggest(g, kind, lord, o) {
    o = o || {};
    const B = BUILDINGS[kind], L = o.L || 0, occ = o.occ;
    if (!B || kind === 'bergfried') return null;
    const keep = keepMask(g), cls = g.cls, owner = g.owner, W1 = GW + 1;
    const badP = new Int32Array(W1 * (GH + 1)), occP = new Int32Array(W1 * (GH + 1)), aueP = new Int32Array(W1 * (GH + 1));
    let kx = 0, ky = 0, kn = 0;
    for (let k = 0; k < N; k++) if (keep[k] && owner[k] === lord) { kx += k % GW + 0.5; ky += Math.floor(k / GW) + 0.5; kn++; }
    if (!kn) return null;
    const kcx = kx / kn - 72, kcy = ky / kn - 45;
    const code = (key) => 1 + BKEYS.indexOf(key);
    const sums = { aue: [0, 0, 0], tree: [0, 0, 0], rock: [0, 0, 0], field: [0, 0, 0], prod: [0, 0, 0] };
    const add = (s, x, y) => { s[0] += x; s[1] += y; s[2]++; };
    let i0 = GW, i1 = -1, j0 = GH, j1 = -1;
    for (let j = 0; j < GH; j++) {
      let rb = 0, ro = 0, ra = 0;
      for (let i = 0; i < GW; i++) {
        const k = j * GW + i, c = cls[k], mine = owner[k] === lord, od = keep[k] || (occ && occ[k]) ? 1 : 0;
        if (mine) {
          if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
          const x = i - 71.5, y = j - 44.5, dk = Math.hypot(x - kcx, y - kcy);
          if (c === cA) add(sums.aue, x, y);
          else if (c === cT && dk <= FOREST_R) add(sums.tree, x, y);
          else if (c === cR && dk <= ROCK_R) add(sums.rock, x, y);
          if (occ && occ[k] === code('hof')) add(sums.field, x, y);
          if (occ && (occ[k] === code('holzfaeller') || occ[k] === code('steinbruch'))) add(sums.prod, x, y);
        }
        const free = mine && (c === cG || c === cA) && !od && dry(g, k, L);
        rb += free ? 0 : 1; ro += od; ra += mine && c === cA ? 1 : 0;
        const p = (j + 1) * W1 + i + 1, q = j * W1 + i + 1;
        badP[p] = badP[q] + rb; occP[p] = occP[q] + ro; aueP[p] = aueP[q] + ra;
      }
    }
    const rect = (P, a, b, c, d) => P[d * W1 + c] - P[b * W1 + c] - P[d * W1 + a] + P[b * W1 + a];
    const cen = (s) => s[2] ? [s[0] / s[2], s[1] / s[2]] : null;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const K = [kcx, kcy];
    // nearest crossing (world coordinates); without crossing data the map centre stands in for it
    let X = [0, 0], bd = Infinity;
    for (const cr of g.crossings || []) { const d = Math.hypot(cr.x - kcx, cr.y - kcy); if (d < bd) { bd = d; X = [cr.x, cr.y]; } }
    const aue = cen(sums.aue), trees = cen(sums.tree), rocks = cen(sums.rock), fields = cen(sums.field), prod = cen(sums.prod);
    let target = null;   // one point to be close to, per kind
    if (kind === 'kornspeicher') target = fields || (aue ? mid(K, aue) : K);
    else if (kind === 'lager') {
      const src = prod || (trees && rocks ? mid(trees, rocks) : trees || rocks);
      target = src ? mid(K, src) : K;
    } else if (kind === 'kaserne') target = [K[0] + 0.45 * (X[0] - K[0]), K[1] + 0.45 * (X[1] - K[1])];
    else if (kind === 'wachturm') target = X;
    const woody = (v) => v && BKEYS[v - 1] && (WOODEN.indexOf(BKEYS[v - 1]) >= 0) ? 1 : 0;
    let best = null, bestC = Infinity;
    if (i1 < 0) return null;
    for (let rot = 0; rot < (B.size[0] === B.size[1] ? 1 : 2); rot++) {
      const [w, h] = footprintOf(kind, rot);
      for (let j = j0; j + h - 1 <= j1; j++) for (let i = i0; i + w - 1 <= i1; i++) {
        if (rect(badP, i, j, i + w, j + h) || rect(occP, Math.max(0, i - 1), Math.max(0, j - 1), Math.min(GW, i + w + 1), Math.min(GH, j + h + 1))) continue;
        if (kindRule(g, kind, i, j, w, h)) continue;
        const cx = i - 72 + w / 2, cy = j - 45 + h / 2, dk = Math.hypot(cx - kcx, cy - kcy);
        let c;
        if (kind === 'huette' || kind === 'holzfaeller' || kind === 'steinbruch') c = dk;
        else if (kind === 'hof') c = dk - 30 * rect(aueP, i, j, i + w, j + h) / (w * h);
        else if (kind === 'brunnen') {
          let n = 0;
          if (occ) for (let cj = Math.max(0, j - 6); cj <= Math.min(GH - 1, j + 6); cj++) for (let ci = Math.max(0, i - 6); ci <= Math.min(GW - 1, i + 6); ci++) {
            const v = occ[cj * GW + ci];
            if (v && !keep[cj * GW + ci] && Math.hypot(ci - i, cj - j) <= 6 && (v === 1 || woody(v))) n++;
          }
          c = -n + 0.1 * dk;
        } else c = Math.hypot(cx - target[0], cy - target[1]) + 0.02 * dk;
        if (c < bestC - 1e-9) { bestC = c; best = { i, j, rot }; }
      }
    }
    return best;
  }

  // ---- RLE codec for the phones (ffMap) ----
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const ALPHA_IX = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHA.length; i++) ALPHA_IX[ALPHA.charCodeAt(i)] = i;
  function rle(vals) {
    let s = '', i = 0;
    while (i < vals.length) {
      const v = vals[i]; let j = i + 1;
      while (j < vals.length && vals[j] === v) j++;
      s += ALPHA[v] + (j - i > 1 ? j - i : '');
      i = j;
    }
    return s;
  }
  function unrle(str, out, fn) {
    let k = 0, p = 0;
    while (p < str.length) {
      const v = ALPHA_IX[str.charCodeAt(p++)];
      let run = 0;
      while (p < str.length && str.charCodeAt(p) >= 48 && str.charCodeAt(p) <= 57) run = run * 10 + str.charCodeAt(p++) - 48;
      for (let r = run || 1; r > 0 && k < out.length; r--) fn(k++, v);
    }
  }
  // cls = class index; hq = hq + 20 clamped to −20…+25; owner = owner + 1, and keep footprints use 5 + site
  // (so the phone also gets the fixed Bergfried cells; decode() turns that back into owner + keep)
  function encode(w) {
    const keep = keepMask(w);
    const cls = new Array(N), hq = new Array(N), own = new Array(N);
    for (let k = 0; k < N; k++) {
      cls[k] = w.cls[k]; hq[k] = clamp(w.hq[k], -20, 25) + 20;
      own[k] = keep[k] && w.owner[k] >= 0 ? 5 + w.owner[k] : w.owner[k] + 1;
    }
    return { cls: rle(cls), hq: rle(hq), owner: rle(own) };
  }
  function decode(e) {
    const cls = new Uint8Array(N), hq = new Int8Array(N), owner = new Int8Array(N), keep = new Uint8Array(N);
    unrle(e.cls, cls, (k, v) => { cls[k] = v; });
    unrle(e.hq, hq, (k, v) => { hq[k] = v - 20; });
    unrle(e.owner, owner, (k, v) => { if (v >= 5) { owner[k] = v - 5; keep[k] = 1; } else owner[k] = v - 1; });
    return { GW, GH, cls, hq, owner, keep };
  }

  // ===== generator =====
  // Pipeline per attempt (a deterministic sub-seed): layout (centre lines, crossings, keeps) → height field → cells/classes
  // → forest/rock/reed quotas → owner → cheap fairness → crossings' `open` + keep-to-keep paths → instances, flow, roads.
  const MB = 1.45;               // meadow base height far from water
  const KEEP_H = 3.5, PLATEAU_R = 7.6, PLATEAU_FALL = 8;
  const SITE_NAMES = ['Nordwest', 'Nordost', 'Südwest', 'Südost'];
  const SITE_SIGN = [[-1, -1], [1, -1], [-1, 1], [1, 1]];   // [sx, sy] of quarter s

  // C1 Hermite spline through knots {t, v, m?}; a missing slope m is the Catmull-Rom estimate
  function spline(knots) {
    const n = knots.length;
    for (let i = 0; i < n; i++) {
      const k = knots[i];
      if (k.m == null) { const a = knots[Math.max(0, i - 1)], b = knots[Math.min(n - 1, i + 1)]; k.m = (b.v - a.v) / (b.t - a.t); }
    }
    return (t) => {
      let i = 0;
      while (i < n - 2 && t > knots[i + 1].t) i++;
      const a = knots[i], b = knots[i + 1], h = b.t - a.t, s = clamp((t - a.t) / h, 0, 1), s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * a.v + (s3 - 2 * s2 + s) * h * a.m + (-2 * s3 + 3 * s2) * b.v + (s3 - s2) * h * b.m;
    };
  }
  // centre line with per-point half width; keeps arc length, tangents and a smoothed signed curvature
  function makePoly(id, pts) {
    const n = pts.length, P = { id, n, x: new Float64Array(n), y: new Float64Array(n), w: new Float64Array(n), cum: new Float64Array(n),
      kap: new Float64Array(n), tx: new Float64Array(n), ty: new Float64Array(n), pts };
    for (let i = 0; i < n; i++) { P.x[i] = pts[i].x; P.y[i] = pts[i].y; P.w[i] = pts[i].w; }
    const th = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const dx = P.x[i + 1] - P.x[i], dy = P.y[i + 1] - P.y[i];
      P.cum[i + 1] = P.cum[i] + Math.hypot(dx, dy); th[i] = Math.atan2(dy, dx);
    }
    const raw = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) {
      let d = th[i] - th[i - 1];
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      raw[i] = d / ((P.cum[i + 1] - P.cum[i - 1]) / 2);
    }
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let d = -3; d <= 3; d++) { const j = i + d; if (j >= 0 && j < n) { s += raw[j]; c++; } }
      P.kap[i] = s / c;
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dx = P.x[b] - P.x[a], dy = P.y[b] - P.y[a], l = Math.hypot(dx, dy) || 1;
      P.tx[i] = dx / l; P.ty[i] = dy / l;
    }
    return P;
  }
  // arc length at the polyline point nearest to (x, y) (only used on gentle lines)
  function arcNear(P, x, y) {
    let best = 1e18, arc = 0;
    for (let s = 0; s < P.n - 1; s++) {
      const ax = P.x[s], ay = P.y[s], bx = P.x[s + 1], by = P.y[s + 1], abx = bx - ax, aby = by - ay;
      const t = clamp(((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby), 0, 1), d = Math.hypot(x - ax - abx * t, y - ay - aby * t);
      if (d < best) { best = d; arc = P.cum[s] + t * Math.hypot(abx, aby); }
    }
    return arc;
  }
  function polyAt(P, arc) {   // point, unit tangent, half width at an arc length
    let s = 0;
    while (s < P.n - 2 && P.cum[s + 1] < arc) s++;
    const l = P.cum[s + 1] - P.cum[s], t = clamp((arc - P.cum[s]) / l, 0, 1);
    const dx = P.x[s + 1] - P.x[s], dy = P.y[s + 1] - P.y[s];
    return { x: P.x[s] + dx * t, y: P.y[s] + dy * t, tx: dx / l, ty: dy / l, w: lerp(P.w[s], P.w[s + 1], t) };
  }

  // One stream in its downstream frame u (north stream: u = y, south: u = −y; dir = ±1). X(u) is the westward swing of the north
  // stream (the south one is its point mirror): from `a` at the top to xJoin at the mouth, mean ~P.mean over the playable part.
  function streamPts(P, dir, nz) {
    const S = (u) => smooth(P.s0, P.s1, u);
    let fm = 0, cnt = 0;
    for (let u = -45; u <= P.uEnd; u += 1) { fm += S(u); cnt++; }
    fm /= cnt;
    const a = clamp((P.mean - P.xJoin * fm) / (1 - fm), -4, 5);
    const X = (u) => a + (P.xJoin - a) * S(u) + (nz(u * 0.09 + P.ph, P.ph * 0.7) - 0.5) * 2 * P.sway * smooth(5, 9, Math.abs(u - P.steg)) * (1 - smooth(P.uEnd - 16, P.uEnd - 6, u));
    const pts = [], n = Math.ceil((P.uEnd + 66) / 3);
    for (let i = 0; i <= n; i++) {
      const k = i / n, u = i === n ? P.uEnd : -66 + (P.uEnd + 66) * k;
      pts.push({ x: dir * X(u), y: dir * u, w: 1.15 + 0.4 * smooth(0, 1, k) + (nz(u * 0.3 + P.ph, 3.1) - 0.5) * 0.2 });
    }
    return pts;
  }
  // arc length of stream point at downstream coordinate u (points are evenly spaced in u)
  function streamArc(st, u) {
    const f = clamp((u + 66) / (st.P.uEnd + 66) * (st.n - 1), 0, st.n - 1 - 1e-9), i = Math.floor(f);
    return st.cum[i] + (f - i) * (st.cum[i + 1] - st.cum[i]);
  }

  // ---- layout: centre lines, crossing frames, keeps ----
  function buildLayout(r, nz) {
    const lay = {};
    // main river W→E: knots alternate in sign and are roughly point-symmetric; flat and level around the Werder
    const sg = r() < 0.5 ? -1 : 1, xs = [33, 52, 74, 96];
    const east = xs.map((x, i) => ({ t: x, v: sg * (i % 2 ? 1 : -1) * (3.0 + 2.4 * r()) }));
    const west = xs.map((x, i) => ({ t: -x, v: -east[i].v * (0.8 + 0.4 * r()) }));
    const yw = (r() - 0.5) * 1.6, ye = yw + (r() - 0.5) * 0.5;
    let scale = 1, fr = null;
    for (let it = 0; it < 4; it++) {
      const kn = west.slice().reverse().map(k => ({ t: k.t, v: k.v * scale })).concat([{ t: -14, v: yw, m: 0 }, { t: 14, v: ye, m: 0 }], east.map(k => ({ t: k.t, v: k.v * scale })));
      fr = spline(kn);
      let mx = 0;
      for (let x = -72; x <= 72; x += 1) mx = Math.max(mx, Math.abs(fr(x)));
      if (mx <= 6.4) break;
      scale *= 6.2 / mx;
    }
    const wig = (x) => (nz(x / 9, 5.5) - 0.5) * 1.1 * smooth(14, 22, Math.abs(x));
    const yR = (x) => fr(x) + wig(x);
    const wd = { x: (r() - 0.5) * 3, y: yw, rx: 8.2 + 1.3 * r(), ry: 2.9 + 0.5 * r(), wa: 3.0 + 0.4 * r() };
    wd.xb = Math.round(wd.x - 0.9 + 1.8 * r());                               // bridge axis x (a cell boundary), near the island's middle
    wd.tower = { x: wd.x - 5.2 - r(), y: wd.y - 0.4 + 0.8 * r() };
    const Wtot = wd.ry + wd.wa, rpts = [];
    for (let x = -92; x <= 92; x += 2) {
      const bump = 1 - smooth(11, 18, Math.abs(x - wd.x)), w0 = 3.7 + (nz(x / 13, 8.8) - 0.5);
      rpts.push({ x, y: yR(x), w: w0 + (Wtot - w0) * bump });
    }
    lay.river = makePoly('fluss', rpts);
    lay.werder = wd;
    // streams: the far crossing (Nordsteg / Südsteg) is a Steg on a straight stretch, the near one a ford close to the river
    const uFar = -26 - Math.round(8 * r()), uNear = -16 + Math.round(4 * r()), xJ = -(7.0 + 1.0 * r());
    lay.streams = [];
    for (const dir of [1, -1]) {
      const P = { dir, uFar, uNear, steg: uFar, xJoin: xJ * (0.97 + 0.06 * r()), sway: 0.8 + r(), ph: r() * 40, mean: (r() - 0.5) * 1.6 };
      P.uEnd = dir > 0 ? yR(P.xJoin) : -yR(-P.xJoin);          // north joins west of the Werder, south (mirror) east of it
      P.s1 = Math.min(-17, P.uEnd - 3); P.s0 = Math.min(uFar + 7, P.s1 - 9);   // the swing is over before the bridge's causeway
      const st = makePoly(dir > 0 ? 'nordbach' : 'suedbach', streamPts(P, dir, nz));
      st.P = P; lay.streams.push(st);
    }
    // crossing frames: fords follow the water (arc length), decks are axis aligned on a straight stretch
    const hqRiver = r() < 0.5 ? -4 : -3;
    const sandbanks = (wl) => {   // mid-channel bars: they never touch the shores (else their skirts would act as stepping stones)
      const n = 1 + Math.floor(r() * 3), side = r() < 0.5 ? -1 : 1, out = [];
      for (let i = 0; i < n; i++) {
        const rc = 1.15 + 0.3 * r(), cm = Math.max(0, wl - rc - 1.7);
        out.push({ a: (i === 1 ? -side : side) * (4.6 + 0.9 * r() + (i === 2 ? 4.8 : 0)), c: (r() - 0.5) * 2 * cm, ra: 2.5 + 0.55 * r(), rc });
      }
      return out;
    };
    const ford = (id, name, poly, arc, fin, fout, hq, sand) => ({ id, kind: 'furt', water: poly.id, name, poly, arc, fin, fout, hq, sand });
    const xW = Math.round(-51 + 13 * r()), xE = clamp(Math.round(-xW + (r() - 0.5) * 6), 34, 52);
    lay.fords = [
      ford('westfurt', 'Westfurt', lay.river, arcNear(lay.river, xW, yR(xW)), 8.5, 12, hqRiver, sandbanks(3.3)),
      ford('ostfurt', 'Ostfurt', lay.river, arcNear(lay.river, xE, yR(xE)), 8.5, 12, hqRiver, sandbanks(3.3))
    ];
    lay.decks = [{ id: 'steinbruecke', kind: 'bruecke', water: 'fluss', name: 'Steinbrücke', x: wd.xb, y: wd.y, ax: 0, ay: 1, len: 2 * Wtot + 2.6, hq: 6 }];
    for (const st of lay.streams) {
      const P = st.P, nord = P.dir > 0;
      lay.fords.push(ford(nord ? 'nordfurt' : 'suedfurt', nord ? 'Nordfurt' : 'Südfurt', st, streamArc(st, P.uNear), 3.2, 5.6, r() < 0.5 ? -4 : -3, []));
      const pt = polyAt(st, streamArc(st, P.steg));
      lay.decks.push({ id: nord ? 'nordsteg' : 'suedsteg', kind: 'steg', water: st.id, name: nord ? 'Nordsteg' : 'Südsteg', x: pt.x, y: Math.round(P.dir * P.steg), ax: 1, ay: 0, len: 2 * pt.w + 3, hq: 5 });
    }
    // keeps: nominal (±46, ±27) mirrored around the middle with small independent noise, on integer coordinates
    const jx = (r() - 0.5) * 6, jy = (r() - 0.5) * 6;
    lay.keeps = SITE_SIGN.map(([sx, sy]) => ({ x: Math.round(sx * (46 - jx) + (r() - 0.5) * 2.2), y: Math.round(sy * (27 - jy) + (r() - 0.5) * 2.2) }));
    return lay;
  }

  // ---- height field (vertices every 0.5 units over the full extent) ----
  const NV = HX * HY;
  const scans = [0, 1, 2].map(() => ({ D: new Float32Array(NV), S: new Int16Array(NV), U: new Float32Array(NV) }));
  const LINE = [{ V: 8.4, D: 1.65, R: 22 }, { V: 3.3, D: 1.05, R: 10.5 }, { V: 3.3, D: 1.05, R: 10.5 }];   // river, Nordbach, Südbach
  const vx = (u) => X0 + u / VRES, vy = (v) => Y0 + v / VRES;

  // nearest segment of a polyline for every vertex within R (squared distance, segment, fraction)
  function scanLine(P, R, sc) {
    sc.D.fill(1e9);
    for (let s = 0; s < P.n - 1; s++) {
      const ax = P.x[s], ay = P.y[s], abx = P.x[s + 1] - ax, aby = P.y[s + 1] - ay, il = 1 / (abx * abx + aby * aby);
      const u0 = Math.max(0, Math.floor((Math.min(ax, ax + abx) - R - X0) * VRES)), u1 = Math.min(HX - 1, Math.ceil((Math.max(ax, ax + abx) + R - X0) * VRES));
      const v0 = Math.max(0, Math.floor((Math.min(ay, ay + aby) - R - Y0) * VRES)), v1 = Math.min(HY - 1, Math.ceil((Math.max(ay, ay + aby) + R - Y0) * VRES));
      for (let v = v0; v <= v1; v++) {
        const py = vy(v) - ay;
        for (let u = u0; u <= u1; u++) {
          const px = vx(u) - ax;
          let t = (px * abx + py * aby) * il;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = px - abx * t, dy = py - aby * t, d2 = dx * dx + dy * dy, idx = v * HX + u;
          if (d2 < sc.D[idx]) { sc.D[idx] = d2; sc.S[idx] = s; sc.U[idx] = t; }
        }
      }
    }
  }
  // per vertex: arc length along the line and signed lateral offset (+ = left of the flow direction)
  function frameAt(P, sc, idx) {
    const s = sc.S[idx], t = sc.U[idx], l = P.cum[s + 1] - P.cum[s], d = Math.sqrt(sc.D[idx]);
    const tx = (P.x[s + 1] - P.x[s]) / l, ty = (P.y[s + 1] - P.y[s]) / l;
    const u = idx % HX, v = (idx - u) / HX;
    const cross = tx * (vy(v) - (P.y[s] + ty * l * t)) - ty * (vx(u) - (P.x[s] + tx * l * t));
    return { arc: P.cum[s] + t * l, off: cross < 0 ? -d : d, d, s, t };
  }

  // coarse distance to the nearest water edge on a 3-unit lattice (far-field masks for the hills)
  const CL = 3, CW = Math.ceil((168) / CL) + 1, CH = Math.ceil(114 / CL) + 1, coarse = new Float32Array(CW * CH);
  function coarseEdge(lines) {
    const pts = [];
    for (const P of lines) for (let i = 0; i < P.n; i += 2) pts.push(P.x[i], P.y[i], P.w[i]);
    for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
      const x = X0 + i * CL, y = Y0 + j * CL;
      let best = 1e9;
      for (let p = 0; p < pts.length; p += 3) { const d = Math.hypot(x - pts[p], y - pts[p + 1]) - pts[p + 2]; if (d < best) best = d; }
      coarse[j * CW + i] = best;
    }
  }
  function coarseAt(x, y) {
    const gx = clamp((x - X0) / CL, 0, CW - 1.001), gy = clamp((y - Y0) / CL, 0, CH - 1.001), i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    const a = coarse[j * CW + i], b = coarse[j * CW + i + 1], c = coarse[(j + 1) * CW + i], d = coarse[(j + 1) * CW + i + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  // channel cross-section: t = |offset| / half width (0 centre … 1 shore) → bed height; banks and terraces beyond the shore
  const bedAt = (t, D) => -D * (1 - 0.5 * t * t - 0.5 * t * t * t * t);
  const bankAt = (e, V) => { const q = e / V; return q >= 1 ? MB : MB * q * (0.35 + 0.65 * q * q); };

  // base terrain: channels carved with min(), terraces rising from the shore, hills away from the water
  function baseField(lay, nzH, nzD, H, edgeOut) {
    const lines = [lay.river, lay.streams[0], lay.streams[1]];
    for (let l = 0; l < 3; l++) scanLine(lines[l], LINE[l].R, scans[l]);
    coarseEdge(lines);
    for (let v = 0; v < HY; v++) {
      const y = vy(v), qy = Math.max(Math.abs(y) - 45, 0);
      for (let u = 0; u < HX; u++) {
        const idx = v * HX + u, x = vx(u);
        let h = MB, edge = 1e9;
        for (let l = 0; l < 3; l++) {
          const sc = scans[l], d2 = sc.D[idx];
          if (d2 > LINE[l].R * LINE[l].R) continue;
          const P = lines[l], s = sc.S[idx], t = sc.U[idx], d = Math.sqrt(d2);
          const w = P.w[s] + (P.w[s + 1] - P.w[s]) * t, e = d - w;
          if (e < edge) edge = e;
          let hl;
          if (e <= 0) {
            hl = bedAt(d / w, LINE[l].D);
          } else {
            const sl = P.cum[s + 1] - P.cum[s], tx = (P.x[s + 1] - P.x[s]) / sl, ty = (P.y[s + 1] - P.y[s]) / sl;
            const cross = tx * (y - (P.y[s] + ty * sl * t)) - ty * (x - (P.x[s] + tx * sl * t));
            const kap = P.kap[s] + (P.kap[s + 1] - P.kap[s]) * t;
            const f = clamp((cross < 0 ? -1 : 1) * kap * 15, -0.3, 1);
            hl = bankAt(e, LINE[l].V * (1 + 0.9 * f));
          }
          if (hl < h) h = hl;
        }
        // rolling meadow noise (multiplicative: zero at the waterline) and hills / border hills away from the water
        const ec = edge < 1e8 ? edge : coarseAt(x, y), qx = Math.max(Math.abs(x) - 72, 0), q = Math.hypot(qx, qy);
        if (h > 0.02) h *= 1 + 0.3 * (fbm(nzD, x / 5.5, y / 5.5, 2) - 0.5) * 2 * smooth(0.8, 3.5, ec);
        const far = smooth(4.5, 15, ec);
        if (far > 0) {
          const amp = 1.05 + 3.9 * smooth(0, 12, q);
          h += far * amp * (0.1 + 0.9 * Math.pow(fbm(nzH, x / 26, y / 26, 3), 1.25) * 1.6);
        }
        H[idx] = h; edgeOut[idx] = edge < 1e8 ? edge : ec;
      }
    }
  }

  // ---- features stamped into the height field ----
  const lineScan = (lay, P) => scans[P === lay.river ? 0 : P === lay.streams[0] ? 1 : 2];
  function addIsland(lay, H, nzD) {
    const wd = lay.werder, tw = wd.tower;
    const u0 = Math.max(0, Math.floor((wd.x - wd.rx - 3 - X0) * VRES)), u1 = Math.min(HX - 1, Math.ceil((wd.x + wd.rx + 3 - X0) * VRES));
    const v0 = Math.max(0, Math.floor((wd.y - wd.ry - 3 - Y0) * VRES)), v1 = Math.min(HY - 1, Math.ceil((wd.y + wd.ry + 3 - Y0) * VRES));
    for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
      const x = vx(u), y = vy(v), ex = (x - wd.x) / wd.rx, ey = (y - wd.y) / wd.ry, e2 = ex * ex + ey * ey;
      let hi = e2 < 1 ? 0.5 * Math.pow(1 - e2, 0.75) : -3 * (Math.sqrt(e2) - 1);
      if (e2 < 1.2) {
        const dx = x - tw.x, dy = y - tw.y;
        hi += 0.85 * Math.exp(-(dx * dx + dy * dy) / (2 * 2.2 * 2.2)) + (fbm(nzD, x / 2.6, y / 2.6, 2) - 0.5) * 0.14 * (e2 < 1 ? 1 : 0);
      }
      if (hi > H[v * HX + u]) H[v * HX + u] = hi;
    }
  }
  // gravel bar across a channel (flat at the ford level so `open` is exact) plus small dry sandbanks
  function addFord(lay, f, H, sandV, nzD) {
    const P = f.poly, sc = lineScan(lay, P), lv = f.hq / 10, A0 = f.arc - f.fout - 1, A1 = f.arc + f.fout + 1;
    let ux0 = 1e9, ux1 = -1e9, uy0 = 1e9, uy1 = -1e9;
    for (let a = A0; a <= A1; a += 1) { const p = polyAt(P, clamp(a, 0, P.cum[P.n - 1])); ux0 = Math.min(ux0, p.x); ux1 = Math.max(ux1, p.x); uy0 = Math.min(uy0, p.y); uy1 = Math.max(uy1, p.y); }
    const u0 = Math.max(0, Math.floor((ux0 - 9 - X0) * VRES)), u1 = Math.min(HX - 1, Math.ceil((ux1 + 9 - X0) * VRES));
    const v0 = Math.max(0, Math.floor((uy0 - 9 - Y0) * VRES)), v1 = Math.min(HY - 1, Math.ceil((uy1 + 9 - Y0) * VRES));
    for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
      const idx = v * HX + u;
      if (sc.D[idx] > 100) continue;
      const fr = frameAt(P, sc, idx), da = fr.arc - f.arc;
      if (Math.abs(da) > f.fout) continue;
      const wA = 1 - smooth(f.fin, f.fout, Math.abs(da)), lvl = lv + (fbm(nzD, vx(u) * 0.9, vy(v) * 0.9, 1) - 0.5) * 0.03;
      if (H[idx] < lvl) H[idx] += (lvl - H[idx]) * wA;
      for (const sb of f.sand) {
        const e2 = ((da - sb.a) / sb.ra) ** 2 + ((fr.off - sb.c) / sb.rc) ** 2;
        if (e2 >= 1) continue;
        const sh = lv + 0.74 * Math.pow(1 - e2, 0.7);
        if (sh > H[idx]) H[idx] = sh;
        if (e2 < 0.9) sandV[idx] = 1;
      }
    }
  }
  // causeway (h ≈ 0.6, 2 cells wide) from a deck end outwards until the ground is as high as the causeway (stored as dk.reach)
  function addDeck(dk, H) {
    const half = dk.len / 2, reach = [0, 0], g = { heights: H };
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1;
      let e = 0;
      for (; e < 9; e += 0.5) if (heightAt(g, dk.x + dk.ax * sg * (half + e), dk.y + dk.ay * sg * (half + e)) >= 0.64) break;
      reach[side] = e;
    }
    dk.reach = reach;
    const R = half + 15;
    const u0 = Math.max(0, Math.floor((dk.x - R - X0) * VRES)), u1 = Math.min(HX - 1, Math.ceil((dk.x + R - X0) * VRES));
    const v0 = Math.max(0, Math.floor((dk.y - R - Y0) * VRES)), v1 = Math.min(HY - 1, Math.ceil((dk.y + R - Y0) * VRES));
    for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
      const px = vx(u) - dk.x, py = vy(v) - dk.y, du = px * dk.ax + py * dk.ay, ds = -px * dk.ay + py * dk.ax, adu = Math.abs(du);
      if (Math.abs(ds) > 2.4 || adu < half - 0.3 || adu > half + reach[du < 0 ? 0 : 1] + 0.5) continue;
      const idx = v * HX + u, wS = 1 - smooth(1.0, 2.4, Math.abs(ds));
      if (H[idx] < 0.6 && H[idx] > -0.05) H[idx] += (0.6 - H[idx]) * wS;   // never fills a stream or the river
    }
  }
  function addPlateaus(lay, H) {
    const R = PLATEAU_R + PLATEAU_FALL + 0.5;
    for (const kp of lay.keeps) {
      const u0 = Math.max(0, Math.floor((kp.x - R - X0) * VRES)), u1 = Math.min(HX - 1, Math.ceil((kp.x + R - X0) * VRES));
      const v0 = Math.max(0, Math.floor((kp.y - R - Y0) * VRES)), v1 = Math.min(HY - 1, Math.ceil((kp.y + R - Y0) * VRES));
      for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
        const w = 1 - smooth(PLATEAU_R, PLATEAU_R + PLATEAU_FALL, Math.hypot(vx(u) - kp.x, vy(v) - kp.y));
        if (w > 0) { const idx = v * HX + u; H[idx] += (KEEP_H - H[idx]) * w; }
      }
    }
  }
  // cell mean height from the 3×3 vertices (weights 1-2-1 / 2-4-2 / 1-2-1)
  function cellMeans(H, hm) {
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const b = (24 + 2 * j) * HX + 24 + 2 * i;
      hm[j * GW + i] = (H[b] + H[b + 2] + H[b + 2 * HX] + H[b + 2 * HX + 2] + 2 * (H[b + 1] + H[b + HX] + H[b + HX + 2] + H[b + 2 * HX + 1]) + 4 * H[b + HX + 1]) / 16;
    }
  }

  // ---- cells: classes, quarters, forest / rock / reed quotas ----
  const hqOf = (h) => clamp(Math.round(h * 10), -30, 30);
  const baseClass = (q) => q <= -5 ? cW : q < 0 ? cF : q <= 1 ? cS : q <= 11 ? cA : cG;
  const cellCentreV = (i, j) => (25 + 2 * j) * HX + 25 + 2 * i;   // the vertex at a cell centre
  const kx = (k) => k % GW - 71.5, ky = (k) => Math.floor(k / GW) - 44.5;

  // deck + causeway cells of a bridge or Steg (hq overridden: the deck height counts for the flood rule)
  function stampDeck(dk, cls, hq) {
    const half = dk.len / 2, cells = [];
    for (let k = 0; k < N; k++) {
      const px = kx(k) - dk.x, py = ky(k) - dk.y;
      if (Math.abs(px) > half + 16 || Math.abs(py) > half + 16) continue;
      const du = px * dk.ax + py * dk.ay, ds = -px * dk.ay + py * dk.ax, adu = Math.abs(du);
      if (Math.abs(ds) > 1.05) continue;
      if (adu <= half) { cls[k] = cB; hq[k] = dk.hq; cells.push(k); }
      else if (adu <= half + dk.reach[du < 0 ? 0 : 1] + 0.5 && hq[k] <= 7 && hq[k] >= 0) { cls[k] = cB; hq[k] = Math.max(hq[k], 6); cells.push(k); }
    }
    return cells;
  }
  // 4-neighbour flood fill over land from each keep; water, bridges and everything unreachable stay −1
  function floodOwner(cls, keeps, owner) {
    owner.fill(-1);
    const stack = new Int32Array(N), land = (k) => cls[k] !== cW && cls[k] !== cF && cls[k] !== cB;
    keeps.forEach((kp, s) => {
      let sp = 0;
      const k0 = cellOf(kp.x + 0.5, kp.y + 0.5);
      owner[k0] = s; stack[sp++] = k0;
      while (sp) {
        const k = stack[--sp], i = k % GW, j = (k - i) / GW;
        if (i > 0 && owner[k - 1] < 0 && land(k - 1)) { owner[k - 1] = s; stack[sp++] = k - 1; }
        if (i < GW - 1 && owner[k + 1] < 0 && land(k + 1)) { owner[k + 1] = s; stack[sp++] = k + 1; }
        if (j > 0 && owner[k - GW] < 0 && land(k - GW)) { owner[k - GW] = s; stack[sp++] = k - GW; }
        if (j < GH - 1 && owner[k + GW] < 0 && land(k + GW)) { owner[k + GW] = s; stack[sp++] = k + GW; }
      }
    });
  }
  // the n cells of `cands` nearest to (cx, cy) under a noisy distance: an irregular blob
  function blob(cands, cx, cy, n, nzV, used) {
    const arr = [];
    for (const k of cands) {
      if (used[k]) continue;
      const x = kx(k), y = ky(k);
      arr.push([Math.hypot(x - cx, y - cy) * (0.75 + 0.8 * nzV(x * 0.33, y * 0.33)), k]);
    }
    arr.sort((a, b) => a[0] - b[0]);
    return arr.slice(0, n).map(a => a[1]);
  }
  const pickFar = (cands, rnd, taken, minD, kp, d0, d1) => {   // random candidate with d0 ≤ dist(keep) ≤ d1, ≥ minD from taken centres
    for (let tries = 0; tries < 150 && cands.length; tries++) {
      const k = cands[Math.floor(rnd() * cands.length)], x = kx(k), y = ky(k), d = Math.hypot(x - kp.x, y - kp.y);
      if (d < d0 || d > d1 || taken.some(t => Math.hypot(t[0] - x, t[1] - y) < minD)) continue;
      return [x, y];
    }
    return null;
  };

  // rocks (2 outcrops per quarter), then forest patches, then reed patches; equal quotas per quarter
  function placeMasks(lay, w, edgeC, hot, rv, nzV) {
    const { cls, hq, owner } = w, used = new Uint8Array(N), nR = 15 + Math.floor(rv() * 6), nF = 142 + Math.floor(rv() * 50), nM = 12 + Math.floor(rv() * 7);
    for (let s = 0; s < 4; s++) {
      const kp = lay.keeps[s], mine = [];
      for (let k = 0; k < N; k++) if (owner[k] === s) mine.push(k);
      const dk = (k) => Math.hypot(kx(k) - kp.x, ky(k) - kp.y);
      // rocks: 2 outcrops, centres 21–29 from the keep, cells 18.5–33.5
      const rockC = mine.filter(k => cls[k] === cG && hq[k] >= 14 && edgeC[k] >= 6 && !hot[k] && dk(k) >= 18.5 && dk(k) <= 33.5), rc = [];
      for (let o = 0; o < 2; o++) {
        const c = pickFar(rockC, rv, rc, 13, kp, 21, 29);
        if (!c) continue;
        rc.push(c);
        for (const k of blob(rockC, c[0], c[1], nR, nzV, used)) { used[k] = 1; cls[k] = cR; }
      }
      // forest: 2–4 patches, nearest edge 8–16 from the keep, all cells within 29.5 (so the quota counts them exactly)
      const forC = mine.filter(k => cls[k] === cG && hq[k] >= 13 && edgeC[k] >= 4.5 && !hot[k] && dk(k) >= 9 && dk(k) <= 29.5);
      const np = 2 + Math.floor(rv() * 3), wts = [], fc = [];
      let tot = 0;
      for (let p = 0; p < np; p++) { wts.push(0.6 + rv()); tot += wts[p]; }
      let left = nF;
      for (let p = 0; p < np; p++) {
        const n = p === np - 1 ? left : Math.round(nF * wts[p] / tot);
        left -= n;
        const c = pickFar(forC, rv, fc, 14, kp, p === 0 ? 13.5 : 14, p === 0 ? 17 : 25) || pickFar(forC, rv, fc, 9, kp, 12, 27);
        if (!c) continue;
        fc.push(c);
        for (const k of blob(forC, c[0], c[1], n, nzV, used)) { used[k] = 1; cls[k] = cT; }
      }
      // reeds: 2 patches on the low floodplain near the water
      const reedC = mine.filter(k => cls[k] === cA && hq[k] >= 2 && hq[k] <= 6 && edgeC[k] >= 1.2 && edgeC[k] <= 7 && !hot[k] && dk(k) >= 12), mc = [];
      for (let p = 0; p < 2; p++) {
        const c = pickFar(reedC, rv, mc, 14, kp, 0, 1e9);
        if (!c) continue;
        mc.push(c);
        for (const k of blob(reedC, c[0], c[1], p ? Math.floor(nM / 2) : nM - Math.floor(nM / 2), nzV, used)) { used[k] = 1; cls[k] = cM; }
      }
      // crag: one steep rocky knoll per quarter, far out on the meadow (the only cliffs inside the map)
      const cragC = mine.filter(k => cls[k] === cG && hq[k] >= 14 && edgeC[k] >= 8 && !hot[k] && dk(k) >= 29 && dk(k) <= 37);
      for (let t = 0; t < 60 && cragC.length; t++) {
        const k = cragC[Math.floor(rv() * cragC.length)];
        let clear = true;
        for (let dj = -5; dj <= 5 && clear; dj++) for (let di = -5; di <= 5; di++) {
          const q = k + dj * GW + di;
          if (q >= 0 && q < N && (used[q] || (cls[q] !== cG && cls[q] !== cA))) { clear = false; break; }
        }
        if (clear) { lay.crags.push({ s, x: kx(k), y: ky(k) }); break; }
      }
    }
  }

  // lift the terrain under the rock outcrops a little (so they read as outcrops), raise the crags, refresh the cell heights
  // and mark the really steep meadow cells as cliffs (slope from the unclamped cell means)
  function bumpRocks(w, H, nzD, lay) {
    const { cls, hq } = w;
    for (let k = 0; k < N; k++) {
      if (cls[k] !== cR) continue;
      const b = (24 + 2 * Math.floor(k / GW)) * HX + 24 + 2 * (k % GW);
      for (let dv = 0; dv < 3; dv++) for (let du = 0; du < 3; du++) H[b + dv * HX + du] += 0.15 + 0.07 * nzD(du + k * 0.37, dv + k * 0.91);
    }
    for (const c of lay.crags) {
      const u0 = Math.floor((c.x - 7 - X0) * VRES), u1 = Math.ceil((c.x + 7 - X0) * VRES), v0 = Math.floor((c.y - 7 - Y0) * VRES), v1 = Math.ceil((c.y + 7 - Y0) * VRES);
      for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
        const dx = vx(u) - c.x, dy = vy(v) - c.y;
        H[v * HX + u] += 3.1 * Math.exp(-(dx * dx + dy * dy) / (2 * 1.6 * 1.6)) * (0.9 + 0.2 * nzD(u * 0.31, v * 0.27));
      }
    }
    const hm = new Float32Array(N);
    cellMeans(H, hm);
    for (let k = 0; k < N; k++) if (cls[k] === cR || cls[k] === cG || cls[k] === cT) hq[k] = hqOf(hm[k]);
    for (let k = 0; k < N; k++) {
      if (cls[k] !== cG || hq[k] < 12) continue;
      const i = k % GW, j = (k - i) / GW, gx = (hm[j * GW + Math.min(GW - 1, i + 1)] - hm[j * GW + Math.max(0, i - 1)]) / 2, gy = (hm[Math.min(GH - 1, j + 1) * GW + i] - hm[Math.max(0, j - 1) * GW + i]) / 2;
      if (Math.hypot(gx, gy) > 0.8) cls[k] = cH;
    }
  }

  // the part of a crossing that is "the water between the banks": cells of the shallow bar (fords) or the deck + causeway
  function crossingRecords(lay, w, hot) {
    const out = [];
    const mkFord = (f) => {
      const P = f.poly, sc = lineScan(lay, P), c = polyAt(P, f.arc), cells = [], R = f.fout + 9;
      for (let k = 0; k < N; k++) {
        if (Math.abs(kx(k) - c.x) > R || Math.abs(ky(k) - c.y) > R) continue;
        if (w.cls[k] !== cF && w.cls[k] !== cS) continue;
        const idx = cellCentreV(k % GW, Math.floor(k / GW));
        if (sc.D[idx] > 144) continue;
        const fr = frameAt(P, sc, idx), wv = P.w[fr.s] + (P.w[fr.s + 1] - P.w[fr.s]) * fr.t;
        if (Math.abs(fr.arc - f.arc) <= f.fout + 1 && Math.abs(fr.off) <= wv + 1.5) cells.push(k);
      }
      // heading across the water: south for the river, east for the streams
      let rot = Math.atan2(c.tx, -c.ty);
      if (P.id === 'fluss' ? Math.sin(rot) < 0 : Math.cos(rot) < 0) rot += Math.PI;
      if (rot > Math.PI) rot -= 2 * Math.PI;
      return { id: f.id, kind: 'furt', water: P.id, name: f.name, x: c.x, y: c.y, rot, len: 2 * c.w + 1, cells, open: 0, hq: f.hq, fin: f.fin, fout: f.fout };
    };
    const mkDeck = (dk) => ({ id: dk.id, kind: dk.kind, water: dk.water, name: dk.name, x: dk.x, y: dk.y, rot: Math.atan2(dk.ay, dk.ax), len: dk.len, cells: dk.cells, open: 0, hq: dk.hq });
    const order = ['westfurt', 'ostfurt', 'steinbruecke', 'nordsteg', 'nordfurt', 'suedsteg', 'suedfurt'];
    const all = lay.fords.map(mkFord).concat(lay.decks.map(mkDeck));
    for (const id of order) out.push(all.find(c => c.id === id));
    const hotR = (c) => c.kind === 'furt' ? c.fout + 2.5 : c.len / 2 + 7;
    for (const c of out) for (let k = 0; k < N; k++) if (Math.hypot(kx(k) - c.x, ky(k) - c.y) <= hotR(c)) hot[k] = 1;
    return out;
  }
  // bank terminals: walk away from the crossing centre along its axis until dry meadow
  function crossingEnds(w, c) {
    const nx = Math.cos(c.rot), ny = Math.sin(c.rot), ends = [];
    for (const sg of [-1, 1]) {
      let last = null;
      for (let t = c.kind === 'furt' ? c.len / 2 + 1 : c.len / 2 + 2; t < c.len / 2 + 15; t += 0.5) {
        const k = cellOf(c.x + sg * nx * t, c.y + sg * ny * t);
        if (k < 0) break;
        last = k;
        if ((w.cls[k] === cG || w.cls[k] === cA) && w.hq[k] >= 7) break;
      }
      ends.push(last);
    }
    return ends;
  }
  // highest L at which a and b stay connected over walkable cells (maximin path); blocked cells are other crossings
  function widest(w, a, b, blocked, i0, i1, j0, j1) {
    const cap = (k) => blocked[k] || WALK[w.cls[k]] === 0 ? -1 : Math.min(1, (WADE_MAX * 10 + w.hq[k]) / (FLOOD_Y * 10));
    _st++; _hn = 0;
    const ca = cap(a);
    if (ca < 0 || cap(b) < 0) return -1;
    _g[a] = ca; _stamp[a] = _st; hpush(-ca, a);
    while (_hn > 0) {
      const k = hpop();
      if (k === b) return _g[b];
      if (-_popKey < _g[k] - 1e-6) continue;
      const i = k % GW, j = (k - i) / GW, gk = _g[k];
      for (let n = 0; n < 8; n++) {
        const ni = i + DXN[n], nj = j + DYN[n];
        if (ni < i0 || nj < j0 || ni > i1 || nj > j1) continue;
        const nk = nj * GW + ni;
        let c = Math.min(gk, cap(nk));
        if (c < 0) continue;
        if (n >= 4) { c = Math.min(c, cap(j * GW + ni), cap(nj * GW + i)); if (c < 0) continue; }
        if (_stamp[nk] === _st && c <= _g[nk]) continue;
        _stamp[nk] = _st; _g[nk] = c; hpush(-c, nk);
      }
    }
    return -1;
  }

  // ---- one attempt: phase A (terrain, classes, quarters, quotas, cheap fairness) ----
  const spread = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return m ? (Math.max(...a) - Math.min(...a)) / m : 1; };
  const devOf = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return m ? Math.max(...a.map(v => Math.abs(v - m) / m)) : 1; };
  const JOINS = { westfurt: '02', ostfurt: '13', steinbruecke: '12', nordsteg: '01', nordfurt: '01', suedsteg: '23', suedfurt: '23' };   // quarters a crossing connects
  const PAIRS = [[0, 1, 'bach'], [2, 3, 'bach'], [0, 2, 'fluss'], [1, 3, 'fluss'], [0, 3, 'diagonal'], [1, 2, 'diagonal']];

  function phaseA(seed, sub, force) {
    const rl = mulberry32(sub ^ 0x1a2b3c4d), rv = mulberry32(sub ^ 0x5eed0001), rd = mulberry32(sub ^ 0xdec04abc);
    const nzL = makeNoise(sub ^ 0x11111), nzH = makeNoise(sub ^ 0x22222), nzD = makeNoise(sub ^ 0x33333), nzV = makeNoise(sub ^ 0x44444);
    const lay = buildLayout(rl, nzL);
    const H = new Float32Array(NV), edgeV = new Float32Array(NV), sandV = new Uint8Array(NV);
    baseField(lay, nzH, nzD, H, edgeV);
    addIsland(lay, H, nzD);
    for (const f of lay.fords) addFord(lay, f, H, sandV, nzD);
    for (const dk of lay.decks) addDeck(dk, H);
    addPlateaus(lay, H);
    const hm = new Float32Array(N), cls = new Uint8Array(N), hq = new Int8Array(N), owner = new Int8Array(N);
    cellMeans(H, hm);
    for (let k = 0; k < N; k++) {
      hq[k] = hqOf(hm[k]); cls[k] = baseClass(hq[k]);
      if (sandV[cellCentreV(k % GW, Math.floor(k / GW))] && hq[k] >= 0 && hq[k] <= 5) cls[k] = cS;   // ford sandbanks
    }
    for (const dk of lay.decks) dk.cells = stampDeck(dk, cls, hq);
    floodOwner(cls, lay.keeps, owner);
    const sites = lay.keeps.map((kp, s) => ({ s, name: SITE_NAMES[s], x: kp.x, y: kp.y, keep: { i: kp.x + 72 - 3, j: kp.y + 45 - 3 } }));
    const w = { seed, GW, GH, cls, hq, owner, heights: H, flow: null, rivers: null, werder: null, crossings: null, sites, trees: [], rocks: [], deco: [], roads: [], stats: null };
    const ctx = { w, lay, rv, rd, nzV, nzD, edgeV, fails: [], score: 0 };
    // quarters must be real and must not touch (8-neighbourhood)
    const area = [0, 0, 0, 0];
    for (let k = 0; k < N; k++) if (owner[k] >= 0) area[owner[k]]++;
    ctx.area0 = area;
    if (area.some(a => a < 1200)) { ctx.fails.push('quarter too small'); ctx.score += 50; if (!force) return ctx; }
    for (let k = 0; k < N; k++) {
      const o = owner[k];
      if (o < 0) continue;
      const i = k % GW, j = (k - i) / GW;
      let i2 = 0;
      for (let n = 0; n < 8 && i2 === 0; n++) {
        const ni = i + DXN[n], nj = j + DYN[n];
        if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
        const o2 = owner[nj * GW + ni];
        if (o2 >= 0 && o2 !== o) { ctx.fails.push('quarters touch'); ctx.score += 50; if (!force) return ctx; i2 = GW; break; }
      }
    }
    // crossings' cells and the "hot" zone around them (no forest, rock or tall trees there)
    const hot = new Uint8Array(N);
    w.crossings = crossingRecords(lay, w, hot);
    ctx.hot = hot;
    const edgeC = new Float32Array(N);
    for (let k = 0; k < N; k++) edgeC[k] = edgeV[cellCentreV(k % GW, Math.floor(k / GW))];
    lay.crags = [];
    placeMasks(lay, w, edgeC, hot, rv, nzV);
    bumpRocks(w, H, nzD, lay);
    // stats (cells of a quarter only) and the cheap fairness rules
    const st = sites.map((s, q) => {
      const o = { area: 0, build: 0, aue: 0, forest: 0, rock: 0 };
      for (let k = 0; k < N; k++) {
        if (owner[k] !== q) continue;
        o.area++;
        if (cls[k] === cG || cls[k] === cA) o.build++;
        if (cls[k] === cA) o.aue++;
        const d = Math.hypot(kx(k) - s.x, ky(k) - s.y);
        if (cls[k] === cT && d <= FOREST_R) o.forest++;
        if (cls[k] === cR && d <= ROCK_R) o.rock++;
      }
      return o;
    });
    w.stats = { sites: st, pairs: [] };
    const col = (f) => st.map(f);
    const need = (name, ok, excess) => { if (!ok) { ctx.fails.push(name); ctx.score += 10 + excess; } };
    need('area ±8%', devOf(col(o => o.area)) <= 0.08, devOf(col(o => o.area)));
    need('build ±10%', devOf(col(o => o.build)) <= 0.10, devOf(col(o => o.build)));
    need('forest ≥120', Math.min(...col(o => o.forest)) >= 120, 1);
    need('forest ±20%', devOf(col(o => o.forest)) <= 0.20, devOf(col(o => o.forest)));
    need('rock ≥30', Math.min(...col(o => o.rock)) >= 30, 1);
    need('rock ±25%', devOf(col(o => o.rock)) <= 0.25, devOf(col(o => o.rock)));
    need('aue ≥60', Math.min(...col(o => o.aue)) >= 60, 1);
    need('aue ±25%', devOf(col(o => o.aue)) <= 0.25, devOf(col(o => o.aue)));
    ctx.phaseA = ctx.fails.length === 0;
    return ctx;
  }

  // connected components of the walkable cells at level L (labels; −1 = blocked)
  function components(w, L) {
    const lab = new Int32Array(N).fill(-1), stack = new Int32Array(N), sp0 = new Uint8Array(N);
    for (let k = 0; k < N; k++) sp0[k] = walk(w, k, L) > 0 ? 1 : 0;
    let n = 0;
    for (let s = 0; s < N; s++) {
      if (!sp0[s] || lab[s] >= 0) continue;
      let sp = 0; lab[s] = n; stack[sp++] = s;
      while (sp) {
        const k = stack[--sp], i = k % GW, j = (k - i) / GW;
        for (let d = 0; d < 8; d++) {
          const ni = i + DXN[d], nj = j + DYN[d];
          if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const nk = nj * GW + ni;
          if (!sp0[nk] || lab[nk] >= 0) continue;
          if (d >= 4 && (!sp0[j * GW + ni] || !sp0[nj * GW + i])) continue;
          lab[nk] = n; stack[sp++] = nk;
        }
      }
      n++;
    }
    return lab;
  }

  // phase B: crossings' open values and bank terminals, flood cut-off, keep-to-keep paths
  function phaseB(ctx, force) {
    const { w } = ctx, fails = ctx.fails, bad = (name, pts) => { fails.push(name); ctx.score += 1 + (pts || 0); };
    const cs = w.crossings, blockedAll = new Uint8Array(N);
    for (const c of cs) for (const k of c.cells) blockedAll[k] = 1;
    for (const c of cs) {
      const [a, b] = crossingEnds(w, c);
      if (a == null || b == null) { bad('crossing ' + c.id + ' ends'); c.ends = [{ x: c.x, y: c.y }, { x: c.x, y: c.y }]; c.joins = [-1, -1]; c.open = -1; continue; }
      c.ends = [cellXY(a), cellXY(b)];
      c.joins = [w.owner[a], w.owner[b]];
      if (c.joins.slice().sort().join('') !== JOINS[c.id]) { bad('crossing ' + c.id + ' ends'); c.open = -1; continue; }
      const blocked = blockedAll.slice();
      for (const k of c.cells) blocked[k] = 0;
      const ai = Math.min(a % GW, b % GW) - 8, bi = Math.max(a % GW, b % GW) + 8, aj = Math.min(Math.floor(a / GW), Math.floor(b / GW)) - 8, bj = Math.max(Math.floor(a / GW), Math.floor(b / GW)) + 8;
      const o = widest(w, a, b, blocked, Math.max(0, ai), Math.min(GW - 1, bi), Math.max(0, aj), Math.min(GH - 1, bj));
      c.open = o < 0 ? -1 : Math.round(o * 10000) / 10000;
    }
    const byId = (id) => cs.find(c => c.id === id);
    const wf = byId('westfurt'), of = byId('ostfurt'), br = byId('steinbruecke');
    const fordsOk = cs.filter(c => c.kind === 'furt').every(c => c.open >= 0.03 && c.open <= 0.16);
    if (!fordsOk) bad('ford open range');
    if (Math.abs(wf.open - of.open) > 0.06) bad('river fords differ');
    const steg = cs.filter(c => c.kind === 'steg');
    if (!(br.open > Math.max(...steg.map(c => c.open)) && Math.min(...steg.map(c => c.open)) > Math.max(...cs.filter(c => c.kind === 'furt').map(c => c.open)))) bad('crossing order');
    const l1 = components(w, 1), l0 = components(w, 0), kc = w.sites.map(s => cellOf(s.x + 0.5, s.y + 0.5));
    if (new Set(kc.map(k => l1[k])).size !== 4) bad('flood does not cut off', 3);
    if (new Set(kc.map(k => l0[k])).size !== 1) bad('keeps do not connect at L=0', 3);
    if (fails.length && !force) return;
    const pairs = PAIRS.map(([a, b, type]) => {
      const p = path(w, { x: w.sites[a].x + 0.5, y: w.sites[a].y + 0.5 }, { x: w.sites[b].x + 0.5, y: w.sites[b].y + 0.5 }, 0);
      return { a, b, type, len: p ? Math.round(p.len * 10) / 10 : Infinity };
    });
    w.stats.pairs = pairs;
    for (const t of ['bach', 'fluss', 'diagonal']) {
      const sp = spread(pairs.filter(p => p.type === t).map(p => p.len));
      if (!(sp <= 0.12)) bad('pair ' + t + ' ±12%', sp);
    }
    ctx.phaseB = fails.length === 0;
  }

  // ---- phase C: instances, flow, roads (no failure modes) ----
  const r2 = (v) => Math.round(v * 100) / 100;
  function chaikin(pts, it) {
    for (let n = 0; n < it && pts.length > 2; n++) {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y }, { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }
  function phaseC(ctx) {
    const { w, lay, rv, rd, nzV, edgeV, hot } = ctx, { cls, hq, owner, heights } = w, g = { heights };
    const lines = [lay.river, lay.streams[0], lay.streams[1]];
    const landAt = (k) => k >= 0 && cls[k] !== cW && cls[k] !== cF && cls[k] !== cB;
    const treeKind = (x, y) => { const h = heightAt(g, x, y); return h > 2.9 || fbm(nzV, x * 0.07 + 5, y * 0.07, 2) > 0.6 ? 'nadel' : 'laub'; };
    const putTree = (x, y, s, kind) => {
      x = r2(x); y = r2(y);
      if (Math.abs(x) <= 83.7 && Math.abs(y) <= 56.7) w.trees.push({ x, y, s: r2(s), kind, k: cellOf(x, y) });
    };
    // forest: 1–2 trees per T cell
    for (let k = 0; k < N; k++) {
      if (cls[k] !== cT) continue;
      for (let n = rv() < 0.72 ? 2 : 1; n > 0; n--) {
        const x = kx(k) + (rv() - 0.5) * 0.92, y = ky(k) + (rv() - 0.5) * 0.92;
        putTree(x, y, 0.85 + 0.5 * rv(), treeKind(x, y));
      }
    }
    // forest belts in the border (outside the grid), thinned near the water
    for (let y = Y0 + 0.5; y < -Y0; y += 2.1) for (let x = X0 + 0.5; x < -X0; x += 2.1) {
      if (Math.abs(x) < 72 && Math.abs(y) < 45) continue;
      const px = x + (rv() - 0.5) * 1.8, py = y + (rv() - 0.5) * 1.8;
      const u = clamp(Math.round((px - X0) * VRES), 0, HX - 1), v = clamp(Math.round((py - Y0) * VRES), 0, HY - 1);
      if (edgeV[v * HX + u] < 3.2 || fbm(nzV, px * 0.05 + 31, py * 0.05, 2) < 0.47) continue;
      putTree(px, py, 0.9 + 0.6 * rv(), treeKind(px, py));
    }
    // willows along the banks, never near a crossing
    const sx = [], sy = [];
    for (const P of lines) {
      for (let a = 1.5; a < P.cum[P.n - 1]; a += 2.6) {
        const c = polyAt(P, a);
        if (Math.abs(c.x) > 86 || Math.abs(c.y) > 59) continue;
        for (const side of [-1, 1]) {
          if (rv() > 0.8) continue;
          const off = c.w + 0.6 + 1.3 * rv(), x = r2(c.x - c.ty * side * off), y = r2(c.y + c.tx * side * off), k = cellOf(x, y);
          if (k >= 0 && (hot[k] || !landAt(k) || cls[k] === cB)) continue;
          if (k < 0 && Math.abs(x) < 84 && Math.abs(y) < 57 === false) continue;
          if (sx.some((px, i) => Math.hypot(px - x, sy[i] - y) < 2.7)) continue;
          sx.push(x); sy.push(y);
          putTree(x, y, 0.95 + 0.5 * rv(), 'weide');
        }
      }
    }
    // single trees on the meadows (outside the buildable core)
    for (let s = 0; s < 4; s++) {
      const kp = lay.keeps[s], cand = [];
      for (let k = 0; k < N; k++) if (owner[k] === s && cls[k] === cG && hq[k] >= 14 && !hot[k] && edgeV[cellCentreV(k % GW, Math.floor(k / GW))] >= 5 && Math.hypot(kx(k) - kp.x, ky(k) - kp.y) >= 17) cand.push(k);
      const taken = [];
      for (let n = 0; n < 14 && cand.length; n++) {
        const k = cand[Math.floor(rv() * cand.length)], x = kx(k) + (rv() - 0.5) * 0.8, y = ky(k) + (rv() - 0.5) * 0.8;
        if (taken.some(t => Math.hypot(t[0] - x, t[1] - y) < 6)) continue;
        taken.push([x, y]);
        putTree(x, y, 0.8 + 0.5 * rv(), treeKind(x, y));
      }
    }
    // rocks on the outcrops, a few on the border hills
    for (let k = 0; k < N; k++) {
      if (cls[k] !== cR) continue;
      for (let n = rv() < 0.65 ? 2 : 1; n > 0; n--) {
        const x = kx(k) + (rv() - 0.5) * 0.8, y = ky(k) + (rv() - 0.5) * 0.8;
        w.rocks.push({ x: r2(x), y: r2(y), s: r2(0.8 + 0.9 * rv()), k });
      }
    }
    for (let n = 0; n < 40; n++) {
      const x = X0 + 1 + rv() * (-2 * X0 - 2), y = Y0 + 1 + rv() * (-2 * Y0 - 2);
      if (Math.abs(x) < 72 && Math.abs(y) < 45) continue;
      if (heightAt(g, x, y) < 2.8) continue;
      w.rocks.push({ x: r2(x), y: r2(y), s: r2(0.9 + 1.2 * rv()), k: -1 });
    }
    // decor (own random stream): reeds, flowers, stones, bushes
    const dec = (x, y, s, kind) => w.deco.push({ x: r2(x), y: r2(y), s: r2(s), kind });
    for (let k = 0; k < N; k++) {
      if (cls[k] !== cM) continue;
      for (let n = 0; n < 4; n++) dec(kx(k) + (rd() - 0.5) * 0.9, ky(k) + (rd() - 0.5) * 0.9, 0.8 + 0.6 * rd(), 'schilf');
    }
    for (const P of lines) for (let a = 2; a < P.cum[P.n - 1]; a += 3.3) {
      const c = polyAt(P, a);
      if (rd() > 0.45 || Math.abs(c.x) > 80 || Math.abs(c.y) > 54) continue;
      const side = rd() < 0.5 ? -1 : 1, off = c.w + 0.1 + 0.5 * rd(), x = c.x - c.ty * side * off, y = c.y + c.tx * side * off, k = cellOf(x, y);
      if (k >= 0 && hot[k]) continue;
      for (let n = 0; n < 3; n++) dec(x + (rd() - 0.5) * 1.2, y + (rd() - 0.5) * 1.2, 0.7 + 0.5 * rd(), 'schilf');
    }
    for (let s = 0; s < 4; s++) {
      const kp = lay.keeps[s], cand = [], near = [];
      for (let k = 0; k < N; k++) {
        if (owner[k] !== s || hot[k]) continue;
        if (cls[k] === cG && Math.hypot(kx(k) - kp.x, ky(k) - kp.y) >= 10) cand.push(k);
        if (cls[k] === cR) near.push(k);
      }
      for (let c = 0; c < 22 && cand.length; c++) {
        const k = cand[Math.floor(rd() * cand.length)], cx = kx(k), cy = ky(k);
        for (let n = 4 + Math.floor(rd() * 4); n > 0; n--) dec(cx + (rd() - 0.5) * 2.4, cy + (rd() - 0.5) * 2.4, 0.6 + 0.5 * rd(), 'blume');
      }
      for (let c = 0; c < 8 && cand.length; c++) { const k = cand[Math.floor(rd() * cand.length)]; dec(kx(k) + (rd() - 0.5) * 0.8, ky(k) + (rd() - 0.5) * 0.8, 0.8 + 0.6 * rd(), 'busch'); }
      for (let c = 0; c < 10 && near.length; c++) { const k = near[Math.floor(rd() * near.length)]; dec(kx(k) + (rd() - 0.5) * 2.6, ky(k) + (rd() - 0.5) * 2.6, 0.5 + 0.6 * rd(), 'stein'); }
    }
    // the Werder: a few willows on its rim and some green around the ruin (never on the bridge line)
    {
      const wd = lay.werder, away = (x, y) => Math.abs(x - wd.xb) >= 2.6 && Math.hypot(x - wd.tower.x, y - wd.tower.y) >= 3.4;
      for (let n = 0, placed = 0; n < 40 && placed < 3; n++) {
        const ang = rv() * 6.2832, e = 0.72 + 0.16 * rv(), x = wd.x + Math.cos(ang) * wd.rx * e, y = wd.y + Math.sin(ang) * wd.ry * e, k = cellOf(x, y);
        if (k < 0 || !away(x, y) || !landAt(k) || cls[k] === cB) continue;
        putTree(x, y, 0.85 + 0.35 * rv(), 'weide'); placed++;
      }
      for (let n = 0, placed = 0; n < 200 && placed < 26; n++) {
        const ang = rd() * 6.2832, e = Math.sqrt(rd()) * 0.86, x = wd.x + Math.cos(ang) * wd.rx * e, y = wd.y + Math.sin(ang) * wd.ry * e, k = cellOf(x, y);
        if (k < 0 || !away(x, y) || !landAt(k) || cls[k] === cB) continue;
        const kind = placed < 6 ? 'busch' : placed < 9 ? 'stein' : 'blume';
        dec(x, y, 0.6 + 0.6 * rd(), kind); placed++;
      }
    }
    for (let k = 0; k < N; k++) {   // bushes at forest edges, stones on sand
      if (cls[k] === cT) {
        const i = k % GW, j = (k - i) / GW;
        const edge = (i > 0 && cls[k - 1] === cG) || (i < GW - 1 && cls[k + 1] === cG) || (j > 0 && cls[k - GW] === cG) || (j < GH - 1 && cls[k + GW] === cG);
        if (edge && rd() < 0.16) dec(kx(k) + (rd() - 0.5), ky(k) + (rd() - 0.5), 0.7 + 0.6 * rd(), 'busch');
      } else if (cls[k] === cS && !hot[k] && rd() < 0.035) dec(kx(k) + (rd() - 0.5), ky(k) + (rd() - 0.5), 0.4 + 0.5 * rd(), 'stein');
    }
    // flow: downstream direction × speed (river 1, streams 0.6, floodplain 0.25) per unit cell over the full extent
    const flow = new Float32Array(FX * FY * 2);
    for (let fj = 0; fj < FY; fj++) for (let fi = 0; fi < FX; fi++) {
      const idx = (2 * fj + 1) * HX + 2 * fi + 1;
      let bl = -1, be = 1e9, bd = 0, bw = 1;
      for (let l = 0; l < 3; l++) {
        const sc = scans[l], d2 = sc.D[idx];
        if (d2 > LINE[l].R * LINE[l].R) continue;
        const P = lines[l], s = sc.S[idx], t = sc.U[idx], wv = P.w[s] + (P.w[s + 1] - P.w[s]) * t, d = Math.sqrt(d2);
        if (d - wv < be) { be = d - wv; bl = l; bd = d; bw = wv; }
      }
      if (bl < 0) continue;
      let v = 0;
      if (be <= 0) v = (bl ? 0.6 : 1) * (1 - 0.45 * (bd / bw) * (bd / bw));
      else if (heights[idx] < FLOOD_Y) v = 0.25 * (1 - smooth(0.2, 0.9, heights[idx] / FLOOD_Y) * 0.5);
      if (v <= 0) continue;
      const P = lines[bl], s = scans[bl].S[idx], l = P.cum[s + 1] - P.cum[s];
      const o = (fj * FX + fi) * 2;
      flow[o] = (P.x[s + 1] - P.x[s]) / l * v; flow[o + 1] = (P.y[s + 1] - P.y[s]) / l * v;
    }
    w.flow = flow;
    // decorative roads: keep → its nearest crossings, along the cheapest dry route, smoothed
    for (const sIt of w.sites) {
      const cand = [];
      for (const c of w.crossings) {
        const e = c.joins.indexOf(sIt.s);
        if (e < 0) continue;
        const sg = e ? 1 : -1, d = (c.kind === 'furt' ? c.len / 2 + 2.4 : c.len / 2 + 3);
        let tx = c.x + sg * Math.cos(c.rot) * d, ty = c.y + sg * Math.sin(c.rot) * d;
        const k = cellOf(tx, ty);
        if (k < 0 || walk(w, k, 0) <= 0 || owner[k] !== sIt.s) { tx = c.ends[e].x; ty = c.ends[e].y; }
        cand.push({ d: Math.hypot(tx - sIt.x, ty - sIt.y), tx, ty });
      }
      cand.sort((a, b) => a.d - b.d);
      for (const c of cand.slice(0, 3)) {
        const p = path(w, { x: sIt.x + 0.5, y: sIt.y + 0.5 }, { x: c.tx, y: c.ty }, 0, { look: 9 });
        if (!p) continue;
        // start at the keep wall (3.6 from the centre), not inside the footprint
        const kx0 = sIt.x + 0.5, ky0 = sIt.y + 0.5, pts = [];
        let started = false;
        for (let i = 0; i < p.length; i++) {
          const d = Math.hypot(p[i].x - kx0, p[i].y - ky0);
          if (!started) {
            if (d < 3.6) continue;
            started = true;
            const a0 = i ? p[i - 1] : p[i], da = Math.hypot(a0.x - kx0, a0.y - ky0), f = d > da ? clamp((3.6 - da) / (d - da), 0, 1) : 1;
            pts.push({ x: a0.x + (p[i].x - a0.x) * f, y: a0.y + (p[i].y - a0.y) * f });
          }
          pts.push(p[i]);
        }
        if (pts.length < 2) continue;
        w.roads.push(chaikin(pts, 2).map(q => ({ x: r2(q.x), y: r2(q.y) })));
      }
    }
    // final shape of the public fields
    w.rivers = lines.map(P => ({ id: P.id, pts: P.pts.map(q => ({ x: r2(q.x), y: r2(q.y), w: r2(q.w) })) }));
    const wd = lay.werder;
    w.werder = { x: r2(wd.x), y: r2(wd.y), rx: r2(wd.rx), ry: r2(wd.ry), tower: { x: r2(wd.tower.x), y: r2(wd.tower.y) }, wa: r2(wd.wa), xb: wd.xb };
    for (const c of w.crossings) {
      c.x = r2(c.x); c.y = r2(c.y); c.rot = r2(c.rot); c.len = r2(c.len);
      c.deck = c.kind === 'bruecke' ? 0.55 : c.kind === 'steg' ? 0.45 : null;
      if (c.kind === 'bruecke') { const m = 1.3 + wd.wa; c.spans = [[0.7, r2(m + 0.6)], [r2(c.len - m - 0.6), r2(c.len - 0.7)]]; }
    }
    return w;
  }

  // ---- make(seed): retry deterministic sub-seeds until the fairness rules hold ----
  function finishUnfair(seed, sub) {   // the least bad attempt, completed and flagged
    const ctx = phaseA(seed, sub, true);
    phaseB(ctx, true);
    const w = phaseC(ctx);
    w.unfair = true; w.stats.attempts = 24; w.stats.fails = ctx.fails.slice();
    return w;
  }
  function make(seed) {
    seed |= 0;
    let best = null;
    for (let a = 0; a < 24; a++) {
      const sub = hash32(seed, a === 0 ? 0x51ed : a * 7919 + 17);
      const ctx = phaseA(seed, sub);
      if (ctx.phaseA) phaseB(ctx);
      if (!ctx.fails.length) { ctx.w.stats.attempts = a + 1; return phaseC(ctx); }
      if (!best || ctx.score < best.score) best = { score: ctx.score, sub };
    }
    return finishUnfair(seed, best.sub);
  }

  const api = { GW, GH, VRES, BORDER, HX, HY, FX, FY, FLOOD_Y, WADE_MAX, DRY_EPS, WADE_SPEED, CLASSES, CI, BUILDINGS, UNITS,
    make, surf, cellOf, cellXY, heightAt, walk, dry, canPlace, suggest, field, path, pathTime, encode, decode, mulberry32,
    components, keepMask, footprintOf, PAIRS, SITE_NAMES, _gen: { phaseA, phaseB, phaseC, finishUnfair, hash32 } };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FurtWorld = api;
})(typeof window !== 'undefined' ? window : globalThis);
