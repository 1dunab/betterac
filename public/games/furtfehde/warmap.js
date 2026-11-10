// ===== Furt & Fehde war table: the phone's painted parchment map (docs/FURTFEHDE.md "War table") =====
// Plain script (no three.js, no art.js): window.FurtWarmap. Needs window.FurtWorld (world.js) for canPlace, suggest-compatible occupancy and path.
//
//   const map = new FurtWarmap(canvas, { grid, sites, crossings, me, lords, still })
//     grid      FurtWorld.decode(msg.grid) with grid.crossings = msg.crossings (ffMap)
//     sites     [{ s, name, x, y, keep }], crossings [{ id, kind, name, x, y, rot, len, open, ends, joins, spans? }]
//     me        own lord index; lords [{ i, site, color, name, emblem }] (grid.owner holds site indices: lords[me].site is the own quarter)
//     still     true = no animation (screenshots)
//   map.resize(w, h)                 CSS px; the backing store follows devicePixelRatio (capped at 3)
//   map.setLevel(L)                  water level 0..1: flood water, closing fords, mud where the water went down
//   map.setBoard({ buildings: [{ id, lord, kind, i, j, rot, build, hp, fire, ruined, paused }], banners: [{ lord, n, x, y, count }], fires: [{ x, y, r, fire }] })   ruined = rubble (still blocks its footprint); paused = an own workplace that rests (dimmed, with a 💤 badge)
//   map.view('all' | 'mine', instant)  zoom presets (250 ms animated); the camera turns 'free' after a pan, pinch or wheel
//   map.setTool('ghost' | 'banner' | null)  what one finger does: drag the ghost / grab an own banner pin / pan the map
//   map.setGhost({ kind, i, j, rot } | null); map.getGhost() → { kind, i, j, rot, ok, reason }  (validity = FurtWorld.canPlace with own quarter, level and occupancy)
//   map.rotateGhost(); map.shake(); map.callout(x, y, text, ms); map.pulsePin(n); map.setOrder(n, x, y); map.selPin = n
//   map.setArm(n | 0)                a banner that waits for its target (⚑ mode: tap a banner, then the map): a pulsing gold ring round its pin
//   map.sendBanner(n, x, y)          the tap-to-send order: the same snapping, route check, order line and 'bannerDrop' as dragging the pin there
//   map.setSelected(id | null)       ring around one building (the building card is open; id 'keep' = the own castle); map.ping(x, y, color, ms) a pulsing ring (an alert's place)
//   map.setPartners([lord, …])       houses in a pact with the own house: green ring round their castle, dashed green marks on their buildings
//   map.setCoverage({ r, keepR } | null)   the own house's fire coverage (docs "W1"): a blue wash round the own keep (reach keepR) and every finished Brunnen (reach r), a dashed circle round one under
//                                    construction, the planned Brunnen's disc (the ghost, when it is a 'brunnen') with a brighter outline, and a ring on every own wooden building: blue 💧 = a well reaches
//                                    its centre, orange = nothing does. null = off.
//   map.coverage(r?, keepR?)         → { r, keepR, discs: [{ kind: 'keep' | 'well' | 'plan', id?, x, y, r, live, sel }], marks: [{ id, kind, x, y, cov, gain }], wood, covered, extra, plan }   the numbers behind it
//                                    (wood = own wooden buildings that are not ruins; covered = those a finished well or the keep reaches; extra = those the planned well would add), also when the layer is off
//   spectators: me = -1 → no own quarter, no own pins, only the 'all' view; every building is drawn as a small mark in its house colour
//   map.pick(px, py) → { px, py, x, y, k, i, j, building?, banner?, crossing?, site?, dBuilding?, dCrossing?, dSite? }   (~18 CSS px tolerance; dX = distance in map units)
//   map.on('tap', pick) · ('ghostMove' | 'ghostEnd', ghost) · ('bannerDrag', { n, x, y, snap, route, time }) · ('bannerDrop', { n, x, y, snap, route, time })
//        ('bannerCancel', { n }) · ('view', 'all' | 'mine' | 'free')   a tap on an own pin (no drag) is a 'tap' with pick.banner, never an order
//   map.render(now)                  call every frame: the static parchment layers are cached per zoom preset (re-drawn only on zoom, resize or a
//                                    new camera), the dynamic layer (water, buildings, pins, ghost, route) is drawn when something changed or animates
//   map.perf { frames, sum, max, staticN, maskN, prepMs, … }; map.dispose()
// Touch and mouse are handled on the canvas itself: a drag moves the ghost (it sits above the finger and snaps to cells) or an own banner pin,
// a short press is a tap, two fingers pinch and pan, the mouse wheel zooms.
(function (root) {
  'use strict';
  const GW = 144, GH = 90, N = GW * GH, MX0 = -72, MY0 = -45, TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const INK = '#3b2a1a', PAPER = [234, 218, 176];
  const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const SERIF = '"Palatino Linotype",Palatino,"Book Antiqua","URW Palladio L",Georgia,"Times New Roman",serif';
  const LORD_FALLBACK = ['#e0453a', '#3a7be0', '#e6b830', '#9a4ad8'];
  const NEUTRAL = '#8a7656';

  // ---- seeded value noise (no Math.random: the same map looks the same on every phone) ----
  function hash2(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  const cellRnd = (k, s) => hash2(k % GW, (k / GW) | 0, s);
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  function shadeHex(h, f) { const c = hex(h); return 'rgb(' + Math.round(clamp(c[0] * f, 0, 255)) + ',' + Math.round(clamp(c[1] * f, 0, 255)) + ',' + Math.round(clamp(c[2] * f, 0, 255)) + ')'; }

  // ---- paper: a tileable parchment texture and a neutral grain overlay (generated once per page) ----
  let paperTile = null, grainTile = null;
  function pnoise(x, y, P, s) {   // periodic value noise, period P lattice cells
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), m = (v) => ((v % P) + P) % P;
    const a = hash2(m(ix), m(iy), s), b = hash2(m(ix + 1), m(iy), s), c = hash2(m(ix), m(iy + 1), s), d = hash2(m(ix + 1), m(iy + 1), s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function makePaper() {
    if (paperTile) return;
    const S = 256, mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
    const pc = mk(), gc = mk(), pg = pc.getContext('2d'), gg = gc.getContext('2d');
    const pi = pg.createImageData(S, S), gi = gg.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const n1 = pnoise(x / 64, y / 64, 4, 1), n2 = pnoise(x / 16, y / 16, 16, 2), n3 = pnoise(x / 4, y / 4, 64, 3), n4 = hash2(x, y, 4);
      const f = 0.90 + 0.10 * n1 + 0.045 * (n2 - 0.5) + 0.03 * (n3 - 0.5) + 0.03 * (n4 - 0.5);
      const o = (y * S + x) * 4;
      pi.data[o] = PAPER[0] * f; pi.data[o + 1] = PAPER[1] * f; pi.data[o + 2] = PAPER[2] * f * (0.97 + 0.04 * n1); pi.data[o + 3] = 255;
      const gv = 255 * (0.945 + 0.05 * n3 + 0.035 * n4 + 0.03 * n2);
      gi.data[o] = gv; gi.data[o + 1] = gv * 0.985; gi.data[o + 2] = gv * 0.94; gi.data[o + 3] = 255;
    }
    pg.putImageData(pi, 0, 0); gg.putImageData(gi, 0, 0);
    // fibres: short faint strokes, wrapped around the tile edges so it stays seamless
    const fibre = (g, n, seed, col) => {
      g.lineWidth = 0.6;
      for (let i = 0; i < n; i++) {
        const x = hash2(i, 1, seed) * S, y = hash2(i, 2, seed) * S, a = hash2(i, 3, seed) * TAU, l = 3 + hash2(i, 4, seed) * 9;
        g.strokeStyle = col(hash2(i, 5, seed));
        for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
          g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + Math.cos(a + 0.7) * l * 0.5, y + oy + Math.sin(a + 0.7) * l * 0.5, x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
        }
      }
    };
    fibre(pg, 150, 5, (r) => r < 0.5 ? 'rgba(120,90,50,0.10)' : 'rgba(255,248,225,0.16)');
    fibre(gg, 90, 6, (r) => r < 0.6 ? 'rgba(110,80,40,0.07)' : 'rgba(255,255,250,0.10)');
    paperTile = pc; grainTile = gc;
  }

  // ---- box blur (clamp-to-edge) and marching squares on float rasters ----
  function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H), n = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      const row = y * W; let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, W - 1)];
      for (let x = 0; x < W; x++) { tmp[row + x] = acc / n; acc += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) { out[y * W + x] = acc / n; acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; }
    }
    return out;
  }
  // iso-lines of a float raster as polylines [x0, y0, x1, y1, ...] in raster pixels; `.closed` marks loops
  function contours(f, W, H, level, st) {
    const cw = Math.floor((W - 1) / st), ch = Math.floor((H - 1) / st), row = cw + 1;
    const pts = new Map(), adj = new Map();
    const link = (a, b) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push(b); l = adj.get(b); if (!l) adj.set(b, l = []); l.push(a); };
    for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
      const x = cx * st, y = cy * st, a = f[y * W + x], b = f[y * W + x + st], c = f[(y + st) * W + x + st], d = f[(y + st) * W + x];
      const idx = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = (cy * row + cx) * 2, Lf = T + 1, R = (cy * row + cx + 1) * 2 + 1, B = ((cy + 1) * row + cx) * 2;
      const P = (id, ex, ey) => { if (!pts.has(id)) pts.set(id, [ex, ey]); return id; };
      const eT = () => P(T, x + st * (level - a) / (b - a), y), eR = () => P(R, x + st, y + st * (level - b) / (c - b));
      const eB = () => P(B, x + st * (level - d) / (c - d), y + st), eL = () => P(Lf, x, y + st * (level - a) / (d - a));
      switch (idx) {
        case 1: case 14: link(eL(), eT()); break;
        case 2: case 13: link(eT(), eR()); break;
        case 3: case 12: link(eL(), eR()); break;
        case 4: case 11: link(eR(), eB()); break;
        case 6: case 9: link(eT(), eB()); break;
        case 7: case 8: link(eL(), eB()); break;
        case 5: if ((a + b + c + d) / 4 >= level) { link(eT(), eR()); link(eL(), eB()); } else { link(eL(), eT()); link(eR(), eB()); } break;
        case 10: if ((a + b + c + d) / 4 >= level) { link(eL(), eT()); link(eR(), eB()); } else { link(eT(), eR()); link(eL(), eB()); } break;
      }
    }
    const used = new Set(), lines = [];
    const trace = (start) => {
      const out = []; let cur = start, prev = -1;
      while (cur !== undefined) {
        used.add(cur); const p = pts.get(cur); out.push(p[0], p[1]);
        let nxt; for (const n of adj.get(cur)) if (n !== prev && !used.has(n)) { nxt = n; break; }
        prev = cur; cur = nxt;
      }
      out.closed = adj.get(start).length === 2 && adj.get(prev).indexOf(start) >= 0 && out.length > 6;
      lines.push(out);
    };
    for (const [id, nb] of adj) if (nb.length === 1 && !used.has(id)) trace(id);
    for (const id of adj.keys()) if (!used.has(id)) trace(id);
    return lines;
  }
  // one Chaikin corner-cutting pass (keeps the ends of open lines)
  function chaikin(a) {
    const n = a.length / 2, out = [], closed = a.closed;
    if (n < 3) return a;
    if (!closed) out.push(a[0], a[1]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n, px = a[i * 2], py = a[i * 2 + 1], qx = a[j * 2], qy = a[j * 2 + 1];
      out.push(0.75 * px + 0.25 * qx, 0.75 * py + 0.25 * qy, 0.25 * px + 0.75 * qx, 0.25 * py + 0.75 * qy);
    }
    if (!closed) out.push(a[a.length - 2], a[a.length - 1]);
    out.closed = closed;
    return out;
  }
  function pathPoly(g, a) {
    g.moveTo(a[0], a[1]);
    for (let i = 2; i < a.length; i += 2) g.lineTo(a[i], a[i + 1]);
    if (a.closed) g.closePath();
  }

  // ---- palette: what the washes should look like on parchment (final colours, the paper grain is multiplied on top) ----
  const LAND = [null, null, [236, 220, 164], [206, 180, 128], [172, 184, 108], [160, 196, 108], [204, 214, 140], [126, 164, 96], [190, 186, 174], [160, 136, 106]];
  const WATER_SHALLOW = [172, 214, 212], WATER_DEEP = [64, 116, 158];
  const BKEYS = () => Object.keys(root.FurtWorld.BUILDINGS);

  // ======================================================================================================
  function FurtWarmap(canvas, o) {
    o = o || {};
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.FW = root.FurtWorld;
    this.grid = o.grid;
    this.sites = o.sites || [];
    this.crossings = o.crossings || (o.grid && o.grid.crossings) || [];
    this.lords = o.lords || [];
    this.me = o.me | 0;
    this.still = !!o.still;
    this.dpr = 1; this.w = 0; this.h = 0;
    this.pad = { t: 0, r: 0, b: 0, l: 0 };
    this.cam = { cx: 0, cy: 0, s: 3 }; this.camAnim = null; this.viewName = 'all';
    this.layers = {};
    this.L = 0; this.maskDirty = true; this.maskT = 0; this.lastMaskStamp = 0;
    this.board = { buildings: [], banners: [], fires: [] };
    this.occ = new Uint8Array(N);
    this.bviews = new Map();
    this.orders = {};
    this.ghost = null; this.ghostRes = null; this.shakeT = 0;
    this.tool = null; this.selPin = 0; this.armPin = 0; this.pinPulse = null;
    this.drag = null; this.ptrs = new Map(); this.pan = null; this.pinch = null; this.camT = 0; this.minScale = 1;
    this.maskLive = 0; this.maskVisible = false; this.fog = null; this.otherT = 0;
    this.callouts = []; this.pings = []; this.selId = null; this.partners = null; this.cover = null; this.covCv = null; this.covKey = '';
    this.handlers = {};
    this.dirty = true; this.lastNow = 0;
    this.liftPx = 56; this.bannerLiftPx = 46;
    this.perf = { frames: 0, sum: 0, max: 0, last: 0, staticN: 0, staticMs: 0, maskN: 0, maskMs: 0, prepMs: 0 };
    makePaper();
    const t0 = performance.now();
    this.prepGrid();
    this.perf.prepMs = performance.now() - t0;
    this.bindInput();
    this.resize(canvas.clientWidth || 300, canvas.clientHeight || 200);
  }
  const P = FurtWarmap.prototype;

  P.mySite = function () { const l = this.lords[this.me]; return l && l.site != null ? l.site : this.me; };
  P.lordColor = function (i) { const l = this.lords[i]; return (l && l.color) || LORD_FALLBACK[i & 3]; };
  P.siteColor = function (s) { for (const l of this.lords) if (l && l.site === s) return l.color || LORD_FALLBACK[s & 3]; return NEUTRAL; };
  P.on = function (name, fn) { (this.handlers[name] || (this.handlers[name] = [])).push(fn); return this; };
  P.emit = function (name, d) { const l = this.handlers[name]; if (l) for (const fn of l.slice()) fn(d); };
  P.setLords = function (lords, me) {
    this.lords = lords || []; if (me != null) this.me = me | 0;
    this.layers = {}; this.fog = null; this.dirty = true;
    this.camAnim = null; this.cam = this.presetCam(this.viewName);
    this.recheckGhost();
  };
  P.setPad = function (t, r, b, l) { this.pad = { t: t | 0, r: r | 0, b: b | 0, l: l | 0 }; this.layers = {}; this.camAnim = null; this.cam = this.presetCam(this.viewName); this.dirty = true; };

  // ---- one-time preparation: the painted wash raster and every ink line that follows from the grid ----
  P.prepGrid = function () {
    const g = this.grid, cls = g.cls, hq = g.hq, SC = 4, PW = GW * SC, PH = GH * SC;
    this.SC = SC;
    const laps = this.perf.prepParts = {}; let lapT = performance.now();
    const lap = (name) => { const n = performance.now(); laps[name] = Math.round(n - lapT); lapT = n; };
    const water = new Uint8Array(N), wash = new Uint8Array(N);
    for (let k = 0; k < N; k++) water[k] = cls[k] <= 1 ? 1 : 0;
    for (let k = 0; k < N; k++) {   // a deck over water: the river runs on beneath it
      let w = water[k];
      if (!w && cls[k] === 3) { const i = k % GW, j = (k / GW) | 0; if ((i > 0 && water[k - 1]) || (i < GW - 1 && water[k + 1]) || (j > 0 && water[k - GW]) || (j < GH - 1 && water[k + GW])) w = 1; }
      wash[k] = w;
    }
    this.water = water; this.washWater = wash;
    // per-cell colours: land (with hillshade) and water (by depth)
    const lr = new Float32Array(N), lg = new Float32Array(N), lb = new Float32Array(N), wr = new Float32Array(N), wg = new Float32Array(N), wb = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const i = k % GW, j = (k / GW) | 0, c = cls[k];
      const hxm = hq[j * GW + Math.max(0, i - 1)], hxp = hq[j * GW + Math.min(GW - 1, i + 1)], hym = hq[Math.max(0, j - 1) * GW + i], hyp = hq[Math.min(GH - 1, j + 1) * GW + i];
      const sh = clamp(1 + 0.030 * ((hxp - hxm) + (hyp - hym)), 0.86, 1.13) * (1 + (cellRnd(k, 41) - 0.5) * 0.07);
      const lc = LAND[c] || LAND[2];
      lr[k] = lc[0] * sh; lg[k] = lc[1] * sh; lb[k] = lc[2] * sh;
      const t = water[k] ? Math.pow(clamp((-hq[k] - 1) / 13, 0, 1), 0.8) : 0.5;
      wr[k] = lerp(WATER_SHALLOW[0], WATER_DEEP[0], t); wg[k] = lerp(WATER_SHALLOW[1], WATER_DEEP[1], t); wb[k] = lerp(WATER_SHALLOW[2], WATER_DEEP[2], t);
    }
    lap('cells');
    // smooth organic warp + pigment field at half resolution
    const HW = PW >> 1, HH = PH >> 1, wu = new Float32Array(HW * HH), wv = new Float32Array(HW * HH), pig = new Float32Array(HW * HH);
    for (let y = 0; y < HH; y++) for (let x = 0; x < HW; x++) {
      const u = (x * 2 + 1) / SC, v = (y * 2 + 1) / SC, h = y * HW + x;
      wu[h] = (vnoise(u * 0.62, v * 0.62, 11) - 0.5) * 0.95 + (vnoise(u * 1.7, v * 1.7, 12) - 0.5) * 0.34;
      wv[h] = (vnoise(u * 0.62 + 7.3, v * 0.62 + 3.1, 13) - 0.5) * 0.95 + (vnoise(u * 1.7 + 5.7, v * 1.7 + 9.2, 14) - 0.5) * 0.34;
      pig[h] = 1 + (vnoise(u * 1.3, v * 1.3, 21) - 0.5) * 0.10 + (vnoise(u * 4.1, v * 4.1, 22) - 0.5) * 0.05;
    }
    lap('warp'); this.warpU = wu; this.warpV = wv; this.warpW = HW;
    const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH;
    const cx = cv.getContext('2d'), img = cx.createImageData(PW, PH), d = img.data;
    const waF = new Float32Array(PW * PH), oF = [new Float32Array(PW * PH), new Float32Array(PW * PH), new Float32Array(PW * PH), new Float32Array(PW * PH)];
    const owner = g.owner;
    for (let py = 0; py < PH; py++) {
      const hrow = (py >> 1) * HW;
      for (let px = 0; px < PW; px++) {
        const hi = hrow + (px >> 1), gu = (px + 0.5) / SC + wu[hi] - 0.5, gv = (py + 0.5) / SC + wv[hi] - 0.5;
        const i0 = Math.floor(gu), j0 = Math.floor(gv), fx = gu - i0, fy = gv - j0;
        const ia = i0 < 0 ? 0 : i0 > GW - 1 ? GW - 1 : i0, ib = i0 + 1 < 0 ? 0 : i0 + 1 > GW - 1 ? GW - 1 : i0 + 1;
        const ja = j0 < 0 ? 0 : j0 > GH - 1 ? GH - 1 : j0, jb = j0 + 1 < 0 ? 0 : j0 + 1 > GH - 1 ? GH - 1 : j0 + 1;
        const k00 = ja * GW + ia, k10 = ja * GW + ib, k01 = jb * GW + ia, k11 = jb * GW + ib;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const f00 = wash[k00], f10 = wash[k10], f01 = wash[k01], f11 = wash[k11];
        const wa = w00 * f00 + w10 * f10 + w01 * f01 + w11 * f11, p = py * PW + px;
        waF[p] = wa;
        let o = owner[k00]; if (o >= 0 && o < 4) oF[o][p] += w00;
        o = owner[k10]; if (o >= 0 && o < 4) oF[o][p] += w10;
        o = owner[k01]; if (o >= 0 && o < 4) oF[o][p] += w01;
        o = owner[k11]; if (o >= 0 && o < 4) oF[o][p] += w11;
        let r = 0, gr = 0, b = 0;
        const m = smooth(0.45, 0.55, wa);
        if (m < 1) {
          const a00 = w00 * (1 - f00), a10 = w10 * (1 - f10), a01 = w01 * (1 - f01), a11 = w11 * (1 - f11), sl = a00 + a10 + a01 + a11 || 1e-6;
          r = (a00 * lr[k00] + a10 * lr[k10] + a01 * lr[k01] + a11 * lr[k11]) / sl; gr = (a00 * lg[k00] + a10 * lg[k10] + a01 * lg[k01] + a11 * lg[k11]) / sl; b = (a00 * lb[k00] + a10 * lb[k10] + a01 * lb[k01] + a11 * lb[k11]) / sl;
        }
        if (m > 0) {
          const a00 = w00 * f00, a10 = w10 * f10, a01 = w01 * f01, a11 = w11 * f11, sw = a00 + a10 + a01 + a11 || 1e-6;
          const rim = 1 - 0.10 * (1 - smooth(0.5, 0.95, wa));
          const qr = (a00 * wr[k00] + a10 * wr[k10] + a01 * wr[k01] + a11 * wr[k11]) / sw * rim, qg = (a00 * wg[k00] + a10 * wg[k10] + a01 * wg[k01] + a11 * wg[k11]) / sw * rim, qb = (a00 * wb[k00] + a10 * wb[k10] + a01 * wb[k01] + a11 * wb[k11]) / sw * rim;
          r += (qr - r) * m; gr += (qg - gr) * m; b += (qb - b) * m;
        }
        const pg = pig[hi], q = p * 4;
        d[q] = r * pg; d[q + 1] = gr * pg; d[q + 2] = b * pg; d[q + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
    this.wash = cv; lap('wash');
    // ---- vectors in world units ----
    const toW = (arr) => { const out = new Array(arr.length); for (let i = 0; i < arr.length; i += 2) { out[i] = MX0 + (arr[i] + 0.5) / SC; out[i + 1] = MY0 + (arr[i + 1] + 0.5) / SC; } out.closed = arr.closed; return out; };
    const wob = (arr, amp, seed) => { for (let i = 0; i < arr.length; i += 2) { const x = arr[i], y = arr[i + 1]; arr[i] = x + (vnoise(x * 1.7, y * 1.7, seed) - 0.5) * amp; arr[i + 1] = y + (vnoise(x * 1.7 + 9, y * 1.7 + 4, seed + 1) - 0.5) * amp; } return arr; };
    const smoothLine = (a) => chaikin(chaikin(a));
    const minLen = (a) => a.length >= 8;
    const vec = this.vec = {};
    vec.shore = contours(waF, PW, PH, 0.5, 2).filter(minLen).map((a) => wob(smoothLine(toW(a)), 0.07, 31)); lap('shore');
    const bin = new Float32Array(PW * PH); for (let p = 0; p < bin.length; p++) bin[p] = waF[p] >= 0.5 ? 1 : 0;
    const wide = boxBlur(bin, PW, PH, 10), tight = boxBlur(bin, PW, PH, 4);
    lap('blur'); vec.ripple1 = contours(wide, PW, PH, 0.62, 3).filter(minLen).map((a) => wob(smoothLine(toW(a)), 0.1, 33));
    vec.ripple2 = contours(wide, PW, PH, 0.80, 3).filter(minLen).map((a) => wob(smoothLine(toW(a)), 0.12, 35));
    lap('ripples'); vec.borders = [];
    for (let s = 0; s < 4; s++) {
      let any = false; const f = oF[s]; for (let p = 0; p < f.length; p += 97) if (f[p] > 0.5) { any = true; break; }
      if (!any) { vec.borders.push([]); continue; }
      vec.borders.push(contours(boxBlur(f, PW, PH, SC), PW, PH, 0.62, 3).filter(minLen).map((a) => wob(smoothLine(toW(a)), 0.06, 37)));
    }
    lap('borders');
    // flow strokes: short wavy dashes along the river and the streams, direction from the local shape of the water
    const flow = vec.flow = [], ww = wash, cellAt = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH ? 0 : ww[j * GW + i]);
    for (let cj = 1.4; cj < GH; cj += 2.4) for (let ci = 1.4; ci < GW; ci += 2.4) {
      const jx = ci + (hash2(ci * 7, cj * 11, 51) - 0.5) * 1.5, jy = cj + (hash2(ci * 13, cj * 5, 52) - 0.5) * 1.5;
      const px = clamp(Math.round(jx * SC), 0, PW - 1), py = clamp(Math.round(jy * SC), 0, PH - 1);
      if (tight[py * PW + px] < 0.86) continue;
      let jxx = 0, jyy = 0, jxy = 0;
      for (let dj = -5; dj <= 5; dj++) for (let di = -5; di <= 5; di++) {
        const a = (jx | 0) + di, b = (jy | 0) + dj, gx = (cellAt(a + 1, b) - cellAt(a - 1, b)) * 0.5, gy = (cellAt(a, b + 1) - cellAt(a, b - 1)) * 0.5;
        jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
      }
      const tot = jxx + jyy; if (tot < 1) continue;
      const coh = Math.hypot(jxx - jyy, 2 * jxy) / tot; if (coh < 0.45) continue;
      const th = 0.5 * Math.atan2(2 * jxy, jxx - jyy) + Math.PI / 2;
      let tx = Math.cos(th), ty = Math.sin(th);
      const wx = jx - 72, wy = jy - 45;
      if (Math.abs(tx) >= Math.abs(ty)) { if (tx < 0) { tx = -tx; ty = -ty; } } else if (ty * wy > 0) { tx = -tx; ty = -ty; }   // river flows east, the streams towards the river
      flow.push({ x: wx, y: wy, tx, ty, l: 1.1 + hash2(ci * 3, cj * 17, 53) * 0.9 });
    }
  };

  // ---- camera presets ----
  P.mineRect = function () {
    const g = this.grid, s = this.mySite(), ci = new Int32Array(GW), cj = new Int32Array(GH);
    let n = 0;
    for (let k = 0; k < N; k++) if (g.owner[k] === s) { ci[k % GW]++; cj[(k / GW) | 0]++; n++; }
    if (!n) return { x0: MX0, y0: MY0, x1: 72, y1: 45 };
    const edge = (arr, len, frac, rev) => { let acc = 0; for (let t = 0; t < len; t++) { const q = rev ? len - 1 - t : t; acc += arr[q]; if (acc >= n * frac) return q; } return rev ? len - 1 : 0; };
    let i0 = edge(ci, GW, 0.004, false), i1 = edge(ci, GW, 0.004, true) + 1, j0 = edge(cj, GH, 0.004, false), j1 = edge(cj, GH, 0.004, true) + 1;
    const m = 3.5;
    return { x0: Math.max(MX0 - 1.5, MX0 + i0 - m), y0: Math.max(MY0 - 1.5, MY0 + j0 - m), x1: Math.min(73.5, MX0 + i1 + m), y1: Math.min(46.5, MY0 + j1 + m) };
  };
  P.presetCam = function (name) {
    const r = name === 'mine' && this.me >= 0 ? this.mineRect() : { x0: -74.2, y0: -47.2, x1: 74.2, y1: 47.2 };
    const p = this.pad, aw = Math.max(40, this.w - p.l - p.r), ah = Math.max(40, this.h - p.t - p.b);
    const s = Math.min(aw / (r.x1 - r.x0), ah / (r.y1 - r.y0));
    const mx = (r.x0 + r.x1) / 2, my = (r.y0 + r.y1) / 2;
    return { cx: mx - (p.l + aw / 2 - this.w / 2) / s, cy: my - (p.t + ah / 2 - this.h / 2) / s, s };
  };
  P.resize = function (w, h) {
    w = Math.max(40, Math.round(w)); h = Math.max(40, Math.round(h));
    const dpr = Math.min(3, root.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    if (this.viewName === 'free') this.viewName = 'all';
    this.layers = {}; this.camAnim = null; this.cam = this.presetCam(this.viewName); this.dirty = true; this.minScale = this.presetCam('all').s * 0.94;
  };
  P.view = function (name, instant) {
    if (name !== 'mine' || this.me < 0) name = 'all';
    const to = this.presetCam(name), changed = name !== this.viewName;
    this.viewName = name;
    if (instant || this.still || !this.w) { this.camAnim = null; this.cam = to; }
    else this.camAnim = { from: { cx: this.cam.cx, cy: this.cam.cy, s: this.cam.s }, to, t0: performance.now(), dur: 250 };
    this.dirty = true;
    if (changed) this.emit('view', name);
  };
  P.toScreen = function (x, y) { const c = this.cam; return { x: (x - c.cx) * c.s + this.w / 2, y: (y - c.cy) * c.s + this.h / 2 }; };
  P.toWorld = function (px, py) { const c = this.cam; return { x: (px - this.w / 2) / c.s + c.cx, y: (py - this.h / 2) / c.s + c.cy }; };

  // ======================================================================================================
  // static layer: parchment, washes, ink. Rendered once per zoom preset and cached.
  function haloText(g, text, x, y, fill, halo, lw) { g.lineWidth = lw; g.strokeStyle = halo; g.lineJoin = 'round'; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y); }
  function drawTree(g, x, y, r, conifer, px) {
    g.fillStyle = '#6a4a2a'; g.fillRect(x - r * 0.09, y + r * 0.25, r * 0.18, r * 0.5);
    g.lineWidth = Math.max(0.05, 0.9 * px); g.strokeStyle = 'rgba(34,58,32,0.95)';
    if (conifer) {
      g.fillStyle = '#3f6d3c'; g.beginPath(); g.moveTo(x, y - r * 1.15); g.lineTo(x + r * 0.7, y + r * 0.45); g.lineTo(x - r * 0.7, y + r * 0.45); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(150,196,120,0.6)'; g.beginPath(); g.moveTo(x - r * 0.1, y - r * 0.7); g.lineTo(x - r * 0.42, y + r * 0.2); g.stroke();
    } else {
      g.fillStyle = '#5a8d46'; g.beginPath(); g.arc(x, y, r * 0.74, 0, TAU); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(170,214,130,0.65)'; g.beginPath(); g.arc(x - r * 0.12, y - r * 0.12, r * 0.46, Math.PI * 1.05, Math.PI * 1.6); g.stroke();
    }
  }
  function drawCastle(g, x, y, col, px) {
    const c = hex(col), lw = Math.max(0.05, 1.1 * px), stone = '#d6cdb8', stoneD = '#b9b09a';
    g.fillStyle = rgba(c, 0.28); g.beginPath(); g.ellipse(x, y + 0.2, 3.9, 3.7, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(60,40,20,0.25)'; g.beginPath(); g.ellipse(x + 0.2, y + 2.7, 3.2, 0.7, 0, 0, TAU); g.fill();
    g.lineWidth = lw; g.strokeStyle = INK; g.lineJoin = 'round';
    const box = (x0, y0, w, h, fill) => { g.fillStyle = fill; g.fillRect(x0, y0, w, h); g.strokeRect(x0, y0, w, h); };
    const merl = (x0, y0, w, n, fill) => { const m = w / (2 * n - 1); for (let i = 0; i < n; i++) box(x0 + i * 2 * m, y0 - 0.42, m, 0.42, fill); };
    box(x - 1.5, y + 0.3, 3.0, 2.4, stoneD);                      // curtain wall
    merl(x - 1.5, y + 0.3, 3.0, 4, stoneD);
    for (const sx of [-1, 1]) {                                    // side towers with lord-coloured roofs
      const tx = sx < 0 ? x - 3.0 : x + 1.4;
      box(tx, y - 0.7, 1.6, 3.4, stone); box(tx + 0.55, y + 0.1, 0.5, 0.8, '#5b4630');
      g.fillStyle = col; g.beginPath(); g.moveTo(tx - 0.2, y - 0.7); g.lineTo(tx + 0.8, y - 2.0); g.lineTo(tx + 1.8, y - 0.7); g.closePath(); g.fill(); g.stroke();
    }
    box(x - 1.15, y - 2.1, 2.3, 4.8, stone); merl(x - 1.15, y - 2.1, 2.3, 3, stone);   // central keep
    g.fillStyle = '#4b3522'; g.beginPath(); g.moveTo(x - 0.5, y + 2.7); g.lineTo(x - 0.5, y + 1.7); g.arc(x, y + 1.7, 0.5, Math.PI, 0); g.lineTo(x + 0.5, y + 2.7); g.closePath(); g.fill();
    g.fillRect(x - 0.12, y - 1.2, 0.24, 0.7); g.fillRect(x - 0.12, y - 0.2, 0.24, 0.6);
    g.beginPath(); g.moveTo(x, y - 2.5); g.lineTo(x, y - 4.2); g.stroke();                // pole + pennant
    g.fillStyle = col; g.beginPath(); g.moveTo(x, y - 4.2); g.lineTo(x + 1.8, y - 3.6); g.lineTo(x, y - 3.0); g.closePath(); g.fill(); g.stroke();
  }
  function drawRose(g, x, y, r, px) {
    const lw = Math.max(0.04, 1.0 * px);
    g.save(); g.translate(x, y); g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = INK;
    g.fillStyle = 'rgba(244,234,205,0.55)'; g.beginPath(); g.arc(0, 0, r * 0.62, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.arc(0, 0, r * 0.5, 0, TAU); g.stroke();
    for (let q = 0; q < 8; q++) {
      const a = q * Math.PI / 4 - Math.PI / 2, len = q % 2 ? r * 0.66 : r, w = q % 2 ? 0.14 : 0.2, ca = Math.cos(a), sa = Math.sin(a);
      const bx = -sa * r * w, by = ca * r * w;   // half base, perpendicular to the ray
      g.beginPath(); g.moveTo(ca * len, sa * len); g.lineTo(bx, by); g.lineTo(0, 0); g.closePath(); g.fillStyle = q % 2 ? 'rgba(244,234,205,0.8)' : INK; g.fill(); g.stroke();
      g.beginPath(); g.moveTo(ca * len, sa * len); g.lineTo(-bx, -by); g.lineTo(0, 0); g.closePath(); g.fillStyle = 'rgba(244,234,205,0.9)'; g.fill(); g.stroke();
    }
    g.restore();
  }
  function drawDeck(g, c, from, to, stone, px) {
    const ux = c.ux, uy = c.uy, nx = -uy, ny = ux, sx = c.x - ux * c.len / 2, sy = c.y - uy * c.len / 2, hw = 1.0;
    const p0x = sx + ux * from, p0y = sy + uy * from, p1x = sx + ux * to, p1y = sy + uy * to;
    g.beginPath(); g.moveTo(p0x + nx * hw, p0y + ny * hw); g.lineTo(p1x + nx * hw, p1y + ny * hw); g.lineTo(p1x - nx * hw, p1y - ny * hw); g.lineTo(p0x - nx * hw, p0y - ny * hw); g.closePath();
    g.fillStyle = stone ? '#cfc8b6' : '#b98a52'; g.fill();
    g.lineWidth = Math.max(0.05, 1.3 * px); g.strokeStyle = INK; g.stroke();
    g.lineWidth = Math.max(0.03, 0.8 * px); g.strokeStyle = stone ? 'rgba(80,70,56,0.55)' : 'rgba(72,44,20,0.65)'; g.beginPath();
    const step = stone ? 0.9 : 0.46;
    for (let t = from + step * 0.5; t < to; t += step) { const qx = sx + ux * t, qy = sy + uy * t; g.moveTo(qx + nx * hw, qy + ny * hw); g.lineTo(qx - nx * hw, qy - ny * hw); }
    g.stroke();
    g.lineWidth = Math.max(0.05, 1.5 * px); g.strokeStyle = stone ? 'rgba(70,60,48,0.9)' : 'rgba(60,36,16,0.9)'; g.beginPath();
    for (const sg of [-0.78, 0.78]) { g.moveTo(p0x + nx * hw * sg, p0y + ny * hw * sg); g.lineTo(p1x + nx * hw * sg, p1y + ny * hw * sg); }
    g.stroke();
  }

  P.layer = function (key) {
    let l = this.layers[key];
    if (!l) {
      const t0 = performance.now();
      l = this.layers[key] = this.renderStatic(key);
      this.perf.staticN++; this.perf.staticMs += performance.now() - t0; this.perf.lastStaticMs = performance.now() - t0;
    }
    return l;
  };
  P.renderStatic = function (key, camOverride) {
    const cam = camOverride || this.presetCam(key), dpr = this.dpr, W = this.w, H = this.h, s = cam.s, px = 1 / s;
    const cv = document.createElement('canvas'); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d'), grid = this.grid, cls = grid.cls, hq = grid.hq, vec = this.vec;
    g.fillStyle = g.createPattern(paperTile, 'repeat'); g.fillRect(0, 0, cv.width, cv.height);
    const world = () => g.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - cam.cx * s), dpr * (H / 2 - cam.cy * s));
    const screen = () => g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sp = (x, y) => [(x - cam.cx) * s + W / 2, (y - cam.cy) * s + H / 2];
    const vx0 = cam.cx - W / 2 / s - 2, vx1 = cam.cx + W / 2 / s + 2, vy0 = cam.cy - H / 2 / s - 2, vy1 = cam.cy + H / 2 / s + 2;
    const vis = (x, y, m) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;
    const i0 = clamp(Math.floor(vx0 - MX0), 0, GW - 1), i1 = clamp(Math.ceil(vx1 - MX0), 0, GW - 1), j0 = clamp(Math.floor(vy0 - MY0), 0, GH - 1), j1 = clamp(Math.ceil(vy1 - MY0), 0, GH - 1);
    const far = s < 5;
    world(); g.lineCap = 'round'; g.lineJoin = 'round';
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(this.wash, MX0, MY0, 144, 90);
    // pigment stains
    for (let n = 0; n < 14; n++) {
      const x = MX0 + hash2(n, 1, 81) * 144, y = MY0 + hash2(n, 2, 81) * 90, r = 5 + hash2(n, 3, 81) * 13;
      if (!vis(x, y, r)) continue;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(120,84,36,0.075)'); gr.addColorStop(0.7, 'rgba(120,84,36,0.035)'); gr.addColorStop(1, 'rgba(120,84,36,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // ---- little land marks: grass ticks, sand stipple, reeds ----
    g.strokeStyle = 'rgba(70,104,42,0.55)'; g.lineWidth = Math.max(0.04, 0.9 * px); g.beginPath();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * GW + i, c = cls[k];
      if (c !== 6 && c !== 5) continue;
      if (cellRnd(k, 61) > (c === 5 ? 0.30 : 0.15) * (far ? 0.65 : 1)) continue;
      const x = MX0 + i + 0.2 + cellRnd(k, 62) * 0.6, y = MY0 + j + 0.35 + cellRnd(k, 63) * 0.6, a = 0.17 + 0.1 * cellRnd(k, 64);
      g.moveTo(x - a, y - a * 1.2); g.lineTo(x, y); g.lineTo(x + a * 1.1, y - a * 1.3);
    }
    g.stroke();
    g.fillStyle = 'rgba(110,86,48,0.65)'; const dd = Math.max(0.07, 1.0 * px);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * GW + i; if (cls[k] !== 2) continue;
      for (let n = 0; n < (far ? 4 : 6); n++) g.fillRect(MX0 + i + cellRnd(k, 91 + n) * 0.95, MY0 + j + cellRnd(k, 101 + n) * 0.95, dd, dd);
    }
    g.strokeStyle = 'rgba(80,104,48,0.9)'; g.lineWidth = Math.max(0.04, 1.0 * px); g.beginPath();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * GW + i; if (cls[k] !== 4) continue;
      for (let n = 0; n < 3; n++) {
        const x = MX0 + i + 0.2 + cellRnd(k, 111 + n) * 0.6, y = MY0 + j + 0.7 + cellRnd(k, 121 + n) * 0.25;
        g.moveTo(x, y); g.lineTo(x - 0.2, y - 0.6); g.moveTo(x, y); g.lineTo(x, y - 0.7); g.moveTo(x, y); g.lineTo(x + 0.2, y - 0.6);
      }
    }
    g.stroke();
    // ---- rock outcrops: little boulders with hatching; cliffs: hachures down the slope ----
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * GW + i, c = cls[k];
      if (c === 8) {
        const x = MX0 + i + 0.5 + (cellRnd(k, 131) - 0.5) * 0.4, y = MY0 + j + 0.5 + (cellRnd(k, 132) - 0.5) * 0.4, r = 0.46 + 0.22 * cellRnd(k, 133);
        g.beginPath();
        for (let v = 0; v < 6; v++) { const a = v * TAU / 6 + cellRnd(k, 134) * 1.5, rr = r * (0.78 + 0.4 * cellRnd(k, 140 + v)); g[v ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.85); }
        g.closePath(); g.fillStyle = 'rgba(218,214,202,0.96)'; g.fill(); g.lineWidth = Math.max(0.05, 1.1 * px); g.strokeStyle = 'rgba(66,54,44,0.92)'; g.stroke();
        g.lineWidth = Math.max(0.04, 0.8 * px); g.strokeStyle = 'rgba(66,54,44,0.65)'; g.beginPath();
        g.moveTo(x - r * 0.1, y + r * 0.1); g.lineTo(x + r * 0.45, y - r * 0.3); g.moveTo(x + r * 0.05, y + r * 0.45); g.lineTo(x + r * 0.62, y + r * 0.0); g.stroke();
      } else if (c === 9) {
        const gx = hq[k + (i < GW - 1 ? 1 : 0)] - hq[k - (i > 0 ? 1 : 0)], gy = hq[k + (j < GH - 1 ? GW : 0)] - hq[k - (j > 0 ? GW : 0)], l = Math.hypot(gx, gy) || 1, dx = -gx / l, dy = -gy / l;
        g.lineWidth = Math.max(0.04, 1.0 * px); g.strokeStyle = 'rgba(86,62,40,0.8)'; g.beginPath();
        for (let n = 0; n < 4; n++) {
          const t = (n + 0.5) / 4 - 0.5, bx = MX0 + i + 0.5 - dy * t * 1.0 + (cellRnd(k, 150 + n) - 0.5) * 0.2, by = MY0 + j + 0.5 + dx * t * 1.0 + (cellRnd(k, 160 + n) - 0.5) * 0.2;
          g.moveTo(bx - dx * 0.4, by - dy * 0.4); g.lineTo(bx + dx * 0.4, by + dy * 0.4);
        }
        g.stroke();
      }
    }
    // ---- water: ripples, flow strokes, ink shore ----
    g.strokeStyle = 'rgba(50,96,134,0.32)'; g.lineWidth = Math.max(0.04, 0.9 * px); g.beginPath(); for (const l of vec.ripple1) pathPoly(g, l); g.stroke();
    g.strokeStyle = 'rgba(50,96,134,0.20)'; g.beginPath(); for (const l of vec.ripple2) pathPoly(g, l); g.stroke();
    const nearCross = (x, y) => { for (const c of this.crossings) if (Math.hypot(x - c.x, y - c.y) < (c.kind === 'furt' ? c.len / 2 + 2.6 : c.len / 2 + 2)) return true; return false; };
    g.strokeStyle = 'rgba(38,84,122,0.62)'; g.lineWidth = Math.max(0.04, 1.0 * px); g.beginPath();
    for (const f of vec.flow) {
      if (!vis(f.x, f.y, 2) || nearCross(f.x, f.y)) continue;
      const hl = f.l / 2, nx = -f.ty, ny = f.tx, A = 0.15, ex = f.x + f.tx * hl, ey = f.y + f.ty * hl;
      g.moveTo(f.x - f.tx * hl, f.y - f.ty * hl);
      g.quadraticCurveTo(f.x - f.tx * hl * 0.5 + nx * A, f.y - f.ty * hl * 0.5 + ny * A, f.x, f.y);
      g.quadraticCurveTo(f.x + f.tx * hl * 0.5 - nx * A, f.y + f.ty * hl * 0.5 - ny * A, ex, ey);
      g.moveTo(ex - f.tx * 0.26 + nx * 0.17, ey - f.ty * 0.26 + ny * 0.17); g.lineTo(ex, ey); g.lineTo(ex - f.tx * 0.26 - nx * 0.17, ey - f.ty * 0.26 - ny * 0.17);
    }
    g.stroke();
    g.strokeStyle = 'rgba(70,52,34,0.16)'; g.lineWidth = Math.max(0.1, 3.4 * px); g.beginPath(); for (const l of vec.shore) pathPoly(g, l); g.stroke();
    g.strokeStyle = 'rgba(40,52,62,0.9)'; g.lineWidth = Math.max(0.06, 1.5 * px); g.beginPath(); for (const l of vec.shore) pathPoly(g, l); g.stroke();
    // ---- quarter borders, dashed in the lords' colours ----
    for (let q = 0; q < 4; q++) {
      const lines = vec.borders[q]; if (!lines || !lines.length) continue;
      g.setLineDash([]); g.strokeStyle = 'rgba(244,234,205,0.6)'; g.lineWidth = Math.max(0.1, 4.6 * px); g.beginPath(); for (const l of lines) pathPoly(g, l); g.stroke();
      g.setLineDash([5.5 * px, 3.5 * px]); g.strokeStyle = this.siteColor(q); g.lineWidth = Math.max(0.08, 2.4 * px); g.beginPath(); for (const l of lines) pathPoly(g, l); g.stroke();
    }
    g.setLineDash([]);
    // ---- crossings: dotted fords, plank bridges, stone bridge ----
    for (const c of this.crossings) {
      const e = c.ends && c.ends.length === 2 ? c.ends : null;
      let ux = Math.cos(c.rot), uy = Math.sin(c.rot);
      if (e) { const l = Math.hypot(e[1].x - e[0].x, e[1].y - e[0].y) || 1; ux = (e[1].x - e[0].x) / l; uy = (e[1].y - e[0].y) / l; }
      const cc = { x: c.x, y: c.y, len: c.len, ux, uy };
      if (c.kind === 'furt') {
        const half = c.len / 2 + 1.7, nx = -uy, ny = ux, step = Math.max(0.62, 6 * px), r = Math.max(0.11, 1.15 * px); g.fillStyle = 'rgba(62,42,22,0.92)'; g.beginPath();
        for (const off of [-1.25, 0, 1.25]) for (let t = -half; t <= half + 1e-6; t += step) { const x = c.x + ux * t + nx * off, y = c.y + uy * t + ny * off; g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
        g.fill();
      } else if (c.kind === 'bruecke' && c.spans) { for (const sp2 of c.spans) drawDeck(g, cc, sp2[0], sp2[1], true, px); }
      else drawDeck(g, cc, 0, c.len, c.kind === 'bruecke', px);
    }
    // ---- trees ----
    const trees = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * GW + i; if (cls[k] !== 7) continue;
      const n = far ? 1 : 1 + (cellRnd(k, 171) < 0.5 ? 1 : 0);
      for (let t = 0; t < n; t++) {
        const x = MX0 + i + 0.5 + (cellRnd(k, 172 + t * 3) - 0.5) * 0.9, y = MY0 + j + 0.55 + (cellRnd(k, 173 + t * 3) - 0.5) * 0.9;
        trees.push({ x, y, r: 0.62 + 0.28 * cellRnd(k, 174 + t * 3), c: vnoise(x * 0.11, y * 0.11, 72) < 0.5 });
      }
    }
    trees.sort((a, b) => a.y - b.y);
    for (const t of trees) drawTree(g, t.x, t.y, t.r, t.c, px);
    // ---- castles ----
    for (const st of this.sites) drawCastle(g, st.x, st.y, this.siteColor(st.s), px);
    // rose: in the corner farthest from the own keep (it covers little land, and it stays out of the build area)
    const mine = this.sites.find((q) => q.s === this.mySite()), rx = mine && mine.x > 0 ? -64 : 64, ry = mine && mine.y > 0 ? -38 : 38;
    drawRose(g, rx, ry, 3.1, px);
    // ---- frame ----
    g.strokeStyle = 'rgba(58,40,22,0.85)'; g.lineWidth = Math.max(0.05, 1.8 * px); g.strokeRect(MX0, MY0, 144, 90);
    g.lineWidth = Math.max(0.04, 0.9 * px); g.strokeRect(MX0 - 0.9, MY0 - 0.9, 145.8, 91.8);
    g.fillStyle = 'rgba(58,40,22,0.85)'; for (const [fx, fy] of [[MX0, MY0], [72, MY0], [MX0, 45], [72, 45]]) { const q = Math.max(0.3, 3 * px); g.fillRect(fx - q / 2 - (fx > 0 ? 0 : 0), fy - q / 2, q, q); }
    // ---- text in screen space ----
    screen(); g.textBaseline = 'middle';
    const fs = clamp(s * 2.7, 10, 15), halo = 'rgba(240,228,194,0.92)';
    g.font = 'italic 600 ' + fs + 'px ' + SERIF;
    for (const st of this.sites) {
      const lord = this.lords.find((l) => l && l.site === st.s);
      const p = sp(st.x, st.y - 5.6); g.textAlign = 'center';
      g.font = 'italic 700 ' + clamp(s * 2.9, 10, 16) + 'px ' + SERIF;
      haloText(g, lord && lord.name ? lord.name : st.name, p[0], p[1], lord ? shadeHex(lord.color || '#6a5030', 0.62) : '#6a5a40', halo, 3.4);
    }
    const rp = sp(rx, ry - 4.1); g.font = 'bold ' + clamp(s * 2.6, 9, 14) + 'px ' + SERIF; g.textAlign = 'center'; haloText(g, 'N', rp[0], rp[1], '#3b2a1a', halo, 3);
    // ---- grain, vignette ----
    g.globalCompositeOperation = 'multiply'; g.fillStyle = g.createPattern(grainTile, 'repeat'); g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    const dg = Math.hypot(W, H) / 2, vg = g.createRadialGradient(W / 2, H / 2, dg * 0.62, W / 2, H / 2, dg * 1.02);
    vg.addColorStop(0, 'rgba(70,40,12,0)'); vg.addColorStop(1, 'rgba(70,40,12,0.34)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    return { canvas: cv, cam };
  };

  // ======================================================================================================
  // dynamic layer
  const ROMAN = ['', 'I', 'II', 'III'];
  const REASON_TEXT = { wet: 'Zu nass', owner: 'Nicht dein Land', tight: 'Zu eng', forest: 'Kein Wald in der Nähe', rock: 'Kein Fels daneben', occupied: 'Belegt', terrain: 'Ungeeigneter Boden', bounds: 'Außerhalb der Karte' };
  const REASON_ICON = { wet: '💧', owner: '🚫', tight: '↔️', forest: '🌲', rock: '⛏️', occupied: '⛔', terrain: '🪨', bounds: '🚫' };
  P.REASON_TEXT = REASON_TEXT;

  // Flood water from hq and L (the integer rule: depth = 12·L − hq in decimetres), drawn at 3 px per cell and smoothed up:
  // flooded land, closing fords, a muddy tint on the river, and damp mud where the water recently went down.
  P.updateMask = function (now) {
    const t0 = performance.now(), g = this.grid, hq = g.hq, cls = g.cls, L = this.L, K = 3, MW = GW * K, MH = GH * K;
    if (!this.maskCv) {
      this.maskCv = document.createElement('canvas'); this.maskCv.width = MW; this.maskCv.height = MH;
      this.maskCtx = this.maskCv.getContext('2d'); this.maskImg = this.maskCtx.createImageData(MW, MH);
      this.mWet = new Float32Array(N); this.mDep = new Float32Array(N); this.mRiv = new Float32Array(N); this.mFcl = new Float32Array(N); this.mMud = new Float32Array(N); this.mAct = new Uint8Array(N);
    }
    const wet = this.mWet, dep = this.mDep, riv = this.mRiv, fcl = this.mFcl, mud = this.mMud, act = this.mAct;
    const dt = this.maskT ? clamp((now - this.maskT) / 1000, 0, 3) : 0, decay = dt / 24;
    this.maskT = now;
    let live = 0;
    for (let k = 0; k < N; k++) {
      const d = 12 * L - hq[k], c = cls[k], w = d > 0 ? 1 : 0;
      wet[k] = w; dep[k] = d > 0 ? (d > 12 ? 12 : d) : 0; riv[k] = c <= 1 ? 1 : 0;
      fcl[k] = c === 1 ? smooth(3.7, 5.1, d) : 0;
      if (w) { if (c > 1) mud[k] = 1; } else if (mud[k] > 0) { mud[k] = mud[k] > decay ? mud[k] - decay : 0; if (mud[k] > 0) live++; }
      act[k] = (w || mud[k] > 0 || fcl[k] > 0.01) ? 1 : 0;
    }
    this.maskLive = live; this.maskVisible = L > 0.004 || live > 0;
    if (this.maskVisible) {
      const d = this.maskImg.data, wetB = this.mWetB || (this.mWetB = new Float32Array(N)), wu = this.warpU, wv = this.warpV, HW = this.warpW, SCW = this.SC;
      for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {   // 3×3 binomial blur: rounded flood fronts instead of staircases
        const jm = j > 0 ? j - 1 : 0, jp = j < GH - 1 ? j + 1 : j, im = i > 0 ? i - 1 : 0, ip = i < GW - 1 ? i + 1 : i;
        wetB[j * GW + i] = (wet[jm * GW + im] + 2 * wet[jm * GW + i] + wet[jm * GW + ip] + 2 * wet[j * GW + im] + 4 * wet[j * GW + i] + 2 * wet[j * GW + ip] + wet[jp * GW + im] + 2 * wet[jp * GW + i] + wet[jp * GW + ip]) / 16;
      }
      for (let my = 0; my < MH; my++) {
        const v = (my + 0.5) / K, hrow = ((v * SCW) >> 1) * HW;
        for (let mx = 0; mx < MW; mx++) {
          const u = (mx + 0.5) / K, hi = hrow + ((u * SCW) >> 1);
          const gu = u + wu[hi] - 0.5, gv = v + wv[hi] - 0.5, j0 = Math.floor(gv), i0 = Math.floor(gu), fy = gv - j0, fx = gu - i0;
          const ja = j0 < 0 ? 0 : j0 > GH - 1 ? GH - 1 : j0, jb = j0 + 1 < 0 ? 0 : j0 + 1 > GH - 1 ? GH - 1 : j0 + 1, ia = i0 < 0 ? 0 : i0 > GW - 1 ? GW - 1 : i0, ib = i0 + 1 < 0 ? 0 : i0 + 1 > GW - 1 ? GW - 1 : i0 + 1;
          const k00 = ja * GW + ia, k10 = ja * GW + ib, k01 = jb * GW + ia, k11 = jb * GW + ib, o = (my * MW + mx) * 4;
          if (!(act[k00] | act[k10] | act[k01] | act[k11])) { d[o + 3] = 0; continue; }
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          const wetA = w00 * wetB[k00] + w10 * wetB[k10] + w01 * wetB[k01] + w11 * wetB[k11];
          const depA = w00 * dep[k00] + w10 * dep[k10] + w01 * dep[k01] + w11 * dep[k11];
          const rvA = w00 * riv[k00] + w10 * riv[k10] + w01 * riv[k01] + w11 * riv[k11];
          const fclA = w00 * fcl[k00] + w10 * fcl[k10] + w01 * fcl[k01] + w11 * fcl[k11];
          const mudA = w00 * mud[k00] + w10 * mud[k10] + w01 * mud[k01] + w11 * mud[k11];
          const cover = smooth(0.4, 0.6, wetA);
          let R = 0, G = 0, B = 0, A = 0;
          if (cover > 0.002) {   // flood water continues the river's palette: wadeable turquoise → deep blue, with a little mud tint that grows with the level
            const t = smooth(0, 8, depA), mix = 0.16 * L;
            const fr = lerp(lerp(WATER_SHALLOW[0], WATER_DEEP[0], t), 150, mix), fg = lerp(lerp(WATER_SHALLOW[1], WATER_DEEP[1], t), 128, mix), fb = lerp(lerp(WATER_SHALLOW[2], WATER_DEEP[2], t), 92, mix);
            const aLand = lerp(0.62, 0.9, t), aRiv = 0.2 * L;
            R = lerp(fr, 140, rvA); G = lerp(fg, 124, rvA); B = lerp(fb, 92, rvA);
            A = cover * lerp(aLand, aRiv, rvA);
          }
          if (fclA > 0.01) {   // a ford that has become too deep turns into deep water
            const aF = 0.92 * fclA * smooth(0.45, 0.8, rvA), na = aF + A * (1 - aF);
            if (na > 0) { R = (64 * aF + R * A * (1 - aF)) / na; G = (116 * aF + G * A * (1 - aF)) / na; B = (158 * aF + B * A * (1 - aF)) / na; A = na; }
          }
          const aM = 0.40 * mudA * (1 - cover);
          if (aM > 0.004) { const na = A + aM * (1 - A); R = (R * A + 112 * aM * (1 - A)) / na; G = (G * A + 86 * aM * (1 - A)) / na; B = (B * A + 56 * aM * (1 - A)) / na; A = na; }
          d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = A * 255;
        }
      }
      this.maskCtx.putImageData(this.maskImg, 0, 0);
    }
    this.perf.maskN++; this.perf.maskMs += performance.now() - t0; this.perf.lastMaskMs = performance.now() - t0;
  };
  P.setLevel = function (L) {
    L = clamp(+L || 0, 0, 1);
    if (L === this.L && this.maskCv) return;
    this.L = L; this.maskDirty = true; this.dirty = true; this.recheckGhost();
  };
  P.buildFog = function () {   // parchment haze over land that is not the own quarter (shown while placing buildings)
    const cv = document.createElement('canvas'); cv.width = GW; cv.height = GH;
    const c = cv.getContext('2d'), img = c.createImageData(GW, GH), me = this.mySite(), g = this.grid;
    for (let k = 0; k < N; k++) { const o = k * 4, foreign = g.owner[k] !== me && g.cls[k] > 1; img.data[o] = 236; img.data[o + 1] = 224; img.data[o + 2] = 188; img.data[o + 3] = foreign ? 118 : 0; }
    c.putImageData(img, 0, 0); this.fog = cv;
  };

  // ---- board ----
  P.setBoard = function (b) {
    b = b || {};
    this.board = { buildings: b.buildings || [], banners: b.banners || [], fires: b.fires || [] };
    this.occ.fill(0);
    const keys = BKEYS();
    for (const bd of this.board.buildings) {
      if (bd.kind === 'bergfried' || keys.indexOf(bd.kind) < 0) continue;
      const fp = this.FW.footprintOf(bd.kind, bd.rot | 0), code = 1 + keys.indexOf(bd.kind);
      for (let dj = 0; dj < fp[1]; dj++) for (let di = 0; di < fp[0]; di++) { const k = (bd.j + dj) * GW + bd.i + di; if (k >= 0 && k < N) this.occ[k] = code; }
    }
    const seen = new Set();
    for (const bn of this.board.banners) {
      const key = bn.lord * 8 + bn.n; seen.add(key);
      let v = this.bviews.get(key);
      if (!v) this.bviews.set(key, v = { x: bn.x, y: bn.y, tx: bn.x, ty: bn.y, count: bn.count | 0, lord: bn.lord, n: bn.n });
      v.tx = bn.x; v.ty = bn.y; v.count = bn.count | 0;
    }
    for (const key of Array.from(this.bviews.keys())) if (!seen.has(key)) this.bviews.delete(key);
    this.recheckGhost(); this.dirty = true;
  };
  P.home = function (n) {
    const st = this.sites.find((q) => q.s === this.mySite());
    return st ? { x: st.x + (n - 2) * 7, y: st.y + 12.6 } : { x: 0, y: 0 };
  };
  P.ownPins = function () {
    const out = [];
    if (this.me < 0) return out;
    for (let n = 1; n <= 3; n++) {
      const v = this.bviews.get(this.me * 8 + n), h = this.home(n);
      out.push({ n, x: v ? v.x : h.x, y: v ? v.y : h.y, count: v ? v.count : 0, exists: !!v });
    }
    return out;
  };
  P.setOrder = function (n, x, y) { if (x == null) delete this.orders[n]; else this.orders[n] = { x, y, t: performance.now() }; this.dirty = true; };
  P.callout = function (x, y, text, ms) { this.callouts.push({ x, y, text, until: performance.now() + (ms || 2600) }); this.dirty = true; };
  P.pulsePin = function (n) { this.pinPulse = { n, t0: performance.now() }; this.dirty = true; };
  P.setSelected = function (id) { id = id == null ? null : id; if (id !== this.selId) { this.selId = id; this.dirty = true; } };
  P.ping = function (x, y, color, ms) { this.pings.push({ x, y, color: color || '#d93025', t0: performance.now(), ms: ms || 3600 }); if (this.pings.length > 4) this.pings.shift(); this.dirty = true; };
  P.setPartners = function (list) {
    const set = list && list.length ? new Set(list) : null;
    const a = this.partners ? Array.from(this.partners).sort().join() : '', b = set ? Array.from(set).sort().join() : '';
    if (a === b) return;
    this.partners = set; this.dirty = true;
  };

  // ---- well coverage (docs "W1"): which of the own wooden buildings a finished Brunnen or the keep reaches (the sim's rule: the building's centre within the well's radius of the well's centre) ----
  P.setCoverage = function (o) {
    const next = o && this.me >= 0 ? { r: +o.r > 0 ? +o.r : 12, keepR: +o.keepR > 0 ? +o.keepR : 12 } : null;
    const a = this.cover ? this.cover.r + ',' + this.cover.keepR : '', b = next ? next.r + ',' + next.keepR : '';
    if (a === b) return;
    this.cover = next; this.dirty = true;
  };
  P.coverage = function (r, keepR) {
    const FW = this.FW, cv = this.cover, out = { r: r > 0 ? r : cv ? cv.r : 12, keepR: keepR > 0 ? keepR : cv ? cv.keepR : 12, discs: [], marks: [], wood: 0, covered: 0, extra: 0, plan: null };
    if (this.me < 0) return out;
    const centre = (b) => { const fp = FW.footprintOf(b.kind, b.rot | 0); return { x: MX0 + b.i + fp[0] / 2, y: MY0 + b.j + fp[1] / 2 }; };
    const keep = this.sites.find((q) => q.s === this.mySite()), live = [];   // the sources that put out fires: the keep and the finished wells
    if (keep) { const d = { kind: 'keep', id: 'keep', x: keep.x, y: keep.y, r: out.keepR, live: true, sel: this.selId === 'keep' }; out.discs.push(d); live.push(d); }
    const wood = [];
    for (const b of this.board.buildings) {
      if (b.lord !== this.me || b.ruined || !FW.BUILDINGS[b.kind] || b.kind === 'bergfried') continue;
      if (b.kind === 'brunnen') { const c = centre(b), d = { kind: 'well', id: b.id, x: c.x, y: c.y, r: out.r, live: (b.build == null ? 1 : b.build) >= 1, sel: this.selId === b.id }; out.discs.push(d); if (d.live) live.push(d); }
      else if (FW.BUILDINGS[b.kind].mat === 'holz') wood.push(b);
    }
    const g = this.ghost;
    if (g && g.kind === 'brunnen') { const c = centre({ kind: 'brunnen', i: g.i, j: g.j, rot: g.rot }); out.plan = { kind: 'plan', x: c.x, y: c.y, r: out.r, live: true, sel: false }; out.discs.push(out.plan); }
    for (const b of wood) {
      const c = centre(b), cov = live.some((d) => Math.hypot(c.x - d.x, c.y - d.y) <= d.r), gain = !cov && !!out.plan && Math.hypot(c.x - out.plan.x, c.y - out.plan.y) <= out.plan.r;
      const fp = FW.footprintOf(b.kind, b.rot | 0);
      out.marks.push({ id: b.id, kind: b.kind, x: c.x, y: c.y, x0: MX0 + b.i, y0: MY0 + b.j, w: fp[0], h: fp[1], cov, gain }); if (cov) out.covered++; if (gain) out.extra++;
    }
    out.wood = out.marks.length;
    return out;
  };

  P.setArm = function (n) { n = n | 0; if (n !== this.armPin) { this.armPin = n; this.dirty = true; } };
  // tap-to-send: an order for banner n to (x, y), snapped like a drag-and-drop (crossings, castles, enemy buildings within 4 cells)
  P.sendBanner = function (n, x, y) {
    const pin = this.ownPins().find((q) => q.n === n); if (!pin || !(isFinite(x) && isFinite(y))) return false;
    x = clamp(x, -71.5, 71.5); y = clamp(y, -44.5, 44.5);
    const snap = this.snapTarget(x, y);
    this.dropBanner({ type: 'banner', n, from: { x: pin.x, y: pin.y }, x: snap ? snap.x : x, y: snap ? snap.y : y, snap, route: null, noRoute: false, rt: 0, rx: NaN, ry: NaN });
    return true;
  };

  // ---- ghost ----
  P.setGhost = function (g) {
    if (!g) { this.ghost = null; this.ghostRes = null; this.dirty = true; return; }
    this.ghost = { kind: g.kind, i: g.i | 0, j: g.j | 0, rot: g.rot ? 1 : 0 };
    this.recheckGhost();
  };
  P.recheckGhost = function () {
    const g = this.ghost; if (!g) return;
    this.ghostRes = this.FW.canPlace(this.grid, g.kind, g.i, g.j, g.rot, { lord: this.mySite(), L: this.L, occ: this.occ });
    this.dirty = true;
  };
  P.getGhost = function () {
    const g = this.ghost, r = this.ghostRes;
    return g ? { kind: g.kind, i: g.i, j: g.j, rot: g.rot, ok: !!(r && r.ok), reason: (r && r.reason) || null } : null;
  };
  P.shake = function () { this.shakeT = performance.now(); this.dirty = true; };
  P.rotateGhost = function () {
    const g = this.ghost; if (!g) return;
    const a = this.FW.footprintOf(g.kind, g.rot), b = this.FW.footprintOf(g.kind, g.rot ? 0 : 1);
    g.i = clamp(Math.round(g.i + a[0] / 2 - b[0] / 2), 0, GW - b[0]); g.j = clamp(Math.round(g.j + a[1] / 2 - b[1] / 2), 0, GH - b[1]); g.rot = g.rot ? 0 : 1;
    this.recheckGhost(); this.emit('ghostMove', this.getGhost());
  };
  P.setTool = function (t) {
    this.tool = t === 'ghost' || t === 'banner' ? t : null;
    if (this.tool !== 'ghost' && this.drag && this.drag.type === 'ghost') this.drag = null;
    if (this.tool !== 'banner' && this.drag && this.drag.type === 'banner') this.drag = null;
    this.dirty = true;
  };
  P.dragGhost = function (p, type) {
    const gh = this.ghost; if (!gh) return;
    const lift = type === 'touch' ? Math.min(this.liftPx, Math.max(0, p.y - 6)) : 0;
    const w = this.toWorld(p.x, p.y - lift), fp = this.FW.footprintOf(gh.kind, gh.rot);
    const i = clamp(Math.round(w.x - MX0 - fp[0] / 2), 0, GW - fp[0]), j = clamp(Math.round(w.y - MY0 - fp[1] / 2), 0, GH - fp[1]);
    if (i !== gh.i || j !== gh.j) { gh.i = i; gh.j = j; this.recheckGhost(); }
    this.emit('ghostMove', this.getGhost());
  };

  // ---- banners ----
  P.snapTarget = function (x, y) {
    let best = null, bd = 4 + 1e-6;
    for (const c of this.crossings) {
      let ux = Math.cos(c.rot), uy = Math.sin(c.rot);
      if (c.ends && c.ends.length === 2) { const l = Math.hypot(c.ends[1].x - c.ends[0].x, c.ends[1].y - c.ends[0].y) || 1; ux = (c.ends[1].x - c.ends[0].x) / l; uy = (c.ends[1].y - c.ends[0].y) / l; }
      const ax = x - c.x, ay = y - c.y, t = clamp(ax * ux + ay * uy, -c.len / 2, c.len / 2), d = Math.hypot(ax - ux * t, ay - uy * t);
      if (d < bd) { bd = d; best = { kind: 'crossing', id: c.id, name: c.name, x: c.x, y: c.y }; }
    }
    for (const st of this.sites) {
      const d = Math.hypot(Math.max(Math.abs(x - st.x) - 3, 0), Math.max(Math.abs(y - st.y) - 3, 0)) - 0.3;
      if (d < bd) { bd = d; best = { kind: 'site', id: st.s, name: st.name, x: st.x, y: st.y }; }
    }
    for (const b of this.board.buildings) {
      if (b.lord === this.me || b.kind === 'bergfried' || !this.FW.BUILDINGS[b.kind]) continue;
      const fp = this.FW.footprintOf(b.kind, b.rot | 0), cx = MX0 + b.i + fp[0] / 2, cy = MY0 + b.j + fp[1] / 2;
      const d = Math.hypot(Math.max(Math.abs(x - cx) - fp[0] / 2, 0), Math.max(Math.abs(y - cy) - fp[1] / 2, 0)) - 0.6;
      if (d < bd) { bd = d; best = { kind: 'building', id: b.id, name: this.FW.BUILDINGS[b.kind].name + ' (Feind)', x: cx, y: cy }; }
    }
    return best;
  };
  P.pinGeom = function (x, y, r) { const p = this.toScreen(x, y); return { x: p.x, y: p.y, hx: p.x, hy: p.y - r * 1.7, r }; };
  P.hitPin = function (p) {
    let best = null, bd = 1e9;
    for (const pin of this.ownPins()) {
      const gm = this.pinGeom(pin.x, pin.y, 12), dh = Math.hypot(p.x - gm.hx, p.y - gm.hy), dt = Math.hypot(p.x - gm.x, p.y - gm.y), d = Math.min(dh - 8, dt - 4);
      if (d < 12 && d < bd) { bd = d; best = pin; }
    }
    return best;
  };
  P.beginBannerDrag = function (pin, id, p, type) {
    this.drag = { type: 'banner', id, ptype: type, n: pin.n, from: { x: pin.x, y: pin.y }, x: pin.x, y: pin.y, snap: null, route: null, noRoute: false, rt: 0, rx: NaN, ry: NaN };
    this.selPin = pin.n; this.updateBannerDrag(p);
  };
  P.updateBannerDrag = function (p) {
    const d = this.drag, lift = d.ptype === 'touch' ? Math.min(this.bannerLiftPx, Math.max(0, p.y - 4)) : 0;
    const w = this.toWorld(p.x, p.y - lift), x = clamp(w.x, -71.5, 71.5), y = clamp(w.y, -44.5, 44.5), snap = this.snapTarget(x, y);
    d.snap = snap; d.x = snap ? snap.x : x; d.y = snap ? snap.y : y;
    this.updateRoute(d, performance.now(), false);
    this.emit('bannerDrag', { n: d.n, x: d.x, y: d.y, snap, route: !!d.route, time: d.route ? d.route.time : null });
    this.dirty = true;
  };
  // the route preview (FurtWorld.path costs a few ms): at most every 80 ms; the render loop catches up when the pointer has stopped
  P.updateRoute = function (d, now, force) {
    if (d.x === d.rx && d.y === d.ry) { d.pending = false; return; }
    if (!force && d.rt && now - d.rt < 80) { d.pending = true; return; }
    d.rt = now; d.rx = d.x; d.ry = d.y; d.pending = false;
    const r = this.FW.path(this.grid, d.from, { x: d.x, y: d.y }, this.L);
    d.route = r; d.noRoute = !r; this.dirty = true;
  };
  P.dropBanner = function (d) {
    this.updateRoute(d, performance.now(), true);
    const out = { n: d.n, x: Math.round(d.x * 100) / 100, y: Math.round(d.y * 100) / 100, snap: d.snap, route: !!d.route, time: d.route ? d.route.time : null };
    this.setOrder(d.n, out.x, out.y);
    this.emit('bannerDrop', out);
  };

  // ---- pick: banner > building > crossing > site, ~18 CSS px tolerance ----
  P.pick = function (px, py) {
    const w = this.toWorld(px, py), k = this.FW.cellOf(w.x, w.y), s = this.cam.s, tol = 18 / s;
    const out = { px, py, x: w.x, y: w.y, k, i: k < 0 ? -1 : k % GW, j: k < 0 ? -1 : (k / GW) | 0 };
    let bd = 1e9;
    const bannerCandidates = [];
    for (const pin of this.ownPins()) bannerCandidates.push({ lord: this.me, n: pin.n, x: pin.x, y: pin.y, count: pin.count, own: true, r: 12 });
    for (const v of this.bviews.values()) if (v.lord !== this.me) bannerCandidates.push({ lord: v.lord, n: v.n, x: v.x, y: v.y, count: v.count, own: false, r: 6 });
    for (const b of bannerCandidates) {
      const gm = this.pinGeom(b.x, b.y, b.r), d = Math.min(Math.hypot(px - gm.hx, py - gm.hy) - b.r, Math.hypot(px - gm.x, py - gm.y));
      if (d < 18 && d < bd) { bd = d; out.banner = b; }
    }
    bd = 1e9;
    for (const b of this.board.buildings) {
      if (b.kind === 'bergfried' || !this.FW.BUILDINGS[b.kind]) continue;
      const fp = this.FW.footprintOf(b.kind, b.rot | 0), x0 = MX0 + b.i, y0 = MY0 + b.j;
      const d = Math.hypot(Math.max(x0 - w.x, 0, w.x - (x0 + fp[0])), Math.max(y0 - w.y, 0, w.y - (y0 + fp[1])));
      if (d <= tol && d < bd) { bd = d; out.building = b; out.dBuilding = d; }
    }
    bd = 1e9;
    for (const c of this.crossings) {
      let ux = Math.cos(c.rot), uy = Math.sin(c.rot);
      if (c.ends && c.ends.length === 2) { const l = Math.hypot(c.ends[1].x - c.ends[0].x, c.ends[1].y - c.ends[0].y) || 1; ux = (c.ends[1].x - c.ends[0].x) / l; uy = (c.ends[1].y - c.ends[0].y) / l; }
      const ax = w.x - c.x, ay = w.y - c.y, t = clamp(ax * ux + ay * uy, -c.len / 2, c.len / 2), d = Math.hypot(ax - ux * t, ay - uy * t);
      if (d <= tol && d < bd) { bd = d; out.crossing = c; out.dCrossing = d; }
    }
    bd = 1e9;
    for (const st of this.sites) {
      const d = Math.hypot(Math.max(Math.abs(w.x - st.x) - 3, 0), Math.max(Math.abs(w.y - st.y) - 3, 0));
      if (d <= tol && d < bd) { bd = d; out.site = st; out.dSite = d; }
    }
    return out;
  };

  // ---- free camera: one finger pans the empty map, two fingers pinch and pan, the wheel zooms (desktop) ----
  P.setCam = function (cx, cy, sc) {
    const s = clamp(sc, this.minScale || 1, 18), hw = this.w / 2 / s, hh = this.h / 2 / s;
    this.cam = { cx: hw >= 78 ? 0 : clamp(cx, -78 + hw, 78 - hw), cy: hh >= 51 ? 0 : clamp(cy, -51 + hh, 51 - hh), s };
    if (this.viewName !== 'free') { this.viewName = 'free'; this.camAnim = null; this.emit('view', 'free'); }
    this.camT = performance.now(); this.dirty = true;
  };
  P.freeStale = function () { const f = this.layers.free, c = this.cam; return this.viewName === 'free' && !(f && Math.abs(f.cam.s - c.s) < 1e-6 && Math.abs(f.cam.cx - c.cx) < 1e-6 && Math.abs(f.cam.cy - c.cy) < 1e-6); };
  P.startPinch = function () {
    const ids = Array.from(this.ptrs.keys()), a = this.ptrs.get(ids[0]), b = this.ptrs.get(ids[1]);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, w0 = this.toWorld(mx, my);
    this.pinch = { a: ids[0], b: ids[1], d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), s0: this.cam.s, w0 };
    this.pan = null;
    const d = this.drag;
    if (d) {   // the first finger had already grabbed something: undo that, a pinch is not a drag
      this.drag = null; this.dirty = true;
      if (d.type === 'ghost' && d.prev && this.ghost) { this.ghost.i = d.prev.i; this.ghost.j = d.prev.j; this.recheckGhost(); this.emit('ghostMove', this.getGhost()); }
      else if (d.type === 'banner') this.emit('bannerCancel', { n: d.n });
    }
    a.dead = b.dead = true;   // these fingers no longer tap or drag
  };
  P.movePinch = function () {
    const pc = this.pinch, a = this.ptrs.get(pc.a), b = this.ptrs.get(pc.b); if (!a || !b) return;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, s = clamp(pc.s0 * Math.hypot(a.x - b.x, a.y - b.y) / pc.d0, this.minScale || 1, 18);
    this.setCam(pc.w0.x - (mx - this.w / 2) / s, pc.w0.y - (my - this.h / 2) / s, s);
  };

  // ---- input: touch and mouse on the canvas; one pointer drives the ghost or a banner, a short press is a tap ----
  P.bindInput = function () {
    const cv = this.cv, me = this;
    const rel = (cx, cy) => { const r = cv.getBoundingClientRect(); return { x: (cx - r.left) * (me.w / (r.width || me.w)), y: (cy - r.top) * (me.h / (r.height || me.h)) }; };
    const h = this._h = {
      ts: (e) => { e.preventDefault(); for (const t of e.changedTouches) me.pDown(t.identifier, rel(t.clientX, t.clientY), 'touch'); },
      tm: (e) => { e.preventDefault(); for (const t of e.changedTouches) me.pMove(t.identifier, rel(t.clientX, t.clientY)); },
      te: (e) => { e.preventDefault(); for (const t of e.changedTouches) me.pUp(t.identifier, e.type === 'touchcancel'); },
      md: (e) => { if (e.button) return; e.preventDefault(); me.pDown('m', rel(e.clientX, e.clientY), 'mouse'); },
      mm: (e) => { if (me.ptrs.has('m')) me.pMove('m', rel(e.clientX, e.clientY)); },
      mu: (e) => { if (me.ptrs.has('m')) me.pUp('m', false, rel(e.clientX, e.clientY)); }
    };
    cv.addEventListener('touchstart', h.ts, { passive: false }); cv.addEventListener('touchmove', h.tm, { passive: false });
    cv.addEventListener('touchend', h.te, { passive: false }); cv.addEventListener('touchcancel', h.te, { passive: false });
    cv.addEventListener('mousedown', h.md); window.addEventListener('mousemove', h.mm); window.addEventListener('mouseup', h.mu);
    h.wh = (e) => {
      e.preventDefault(); const p = rel(e.clientX, e.clientY), w0 = me.toWorld(p.x, p.y), s = clamp(me.cam.s * Math.exp(-e.deltaY * 0.0016), me.minScale || 1, 18);
      me.setCam(w0.x - (p.x - me.w / 2) / s, w0.y - (p.y - me.h / 2) / s, s);
    };
    cv.addEventListener('wheel', h.wh, { passive: false });
  };
  P.pDown = function (id, p, type) {
    this.ptrs.set(id, { x: p.x, y: p.y, sx: p.x, sy: p.y, t0: performance.now(), type, moved: false, dead: false });
    if (this.ptrs.size === 2 && !this.pinch) { this.startPinch(); return; }
    if (this.ptrs.size > 1) { this.ptrs.get(id).dead = true; return; }
    if (this.tool === 'banner') { const pin = this.hitPin(p); if (pin) { this.beginBannerDrag(pin, id, p, type); return; } }
    if (this.tool === 'ghost' && this.ghost) { this.drag = { type: 'ghost', id, ptype: type, prev: { i: this.ghost.i, j: this.ghost.j } }; this.dragGhost(p, type); return; }
    this.pan = { id, cx: this.cam.cx, cy: this.cam.cy, x: p.x, y: p.y, on: false };
  };
  P.pMove = function (id, p) {
    const q = this.ptrs.get(id); if (!q) return;
    q.x = p.x; q.y = p.y; if (Math.hypot(p.x - q.sx, p.y - q.sy) > 9) q.moved = true;
    if (this.pinch) { if (id === this.pinch.a || id === this.pinch.b) this.movePinch(); return; }
    if (q.dead) return;
    const pn = this.pan;
    if (pn && pn.id === id) {
      if (!pn.on && q.moved) pn.on = true;
      if (pn.on) this.setCam(pn.cx - (p.x - pn.x) / this.cam.s, pn.cy - (p.y - pn.y) / this.cam.s, this.cam.s);
      return;
    }
    const d = this.drag; if (!d || d.id !== id) return;
    if (d.type === 'banner') this.updateBannerDrag(p); else this.dragGhost(p, d.ptype);
  };
  P.pUp = function (id, cancel, p) {
    const q = this.ptrs.get(id); this.ptrs.delete(id); if (!q) return;
    if (p && !cancel) { q.x = p.x; q.y = p.y; }
    if (this.pinch && (id === this.pinch.a || id === this.pinch.b)) { this.pinch = null; this.dirty = true; return; }
    if (this.pan && this.pan.id === id) { const was = this.pan.on; this.pan = null; if (was) return; }
    if (q.dead) return;
    const d = this.drag;
    if (d && d.id === id) {
      this.drag = null; this.dirty = true;
      if (d.type === 'banner') {
        if (cancel) this.emit('bannerCancel', { n: d.n });
        else if (!q.moved) { this.emit('bannerCancel', { n: d.n }); if (performance.now() - q.t0 < 700) this.emit('tap', this.pick(q.x, q.y)); }   // a tap on a pin picks the banner; it must not send it to the spot above the finger
        else this.dropBanner(d);
      } else this.emit('ghostEnd', this.getGhost());
      return;
    }
    if (!cancel && !q.moved && performance.now() - q.t0 < 700) this.emit('tap', this.pick(q.x, q.y));
  };

  // ---- drawing helpers (screen space, CSS px) ----
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function bubbleW(ctx, text, fs) { ctx.font = 'bold ' + (fs || 13) + 'px system-ui,' + EMOJI; return ctx.measureText(text).width + 16; }
  function bubble(ctx, cx, cy, text, bg, fg, fs, W) {
    fs = fs || 13; const w = bubbleW(ctx, text, fs), h = fs + 10;
    cx = clamp(cx, w / 2 + 4, Math.max(w / 2 + 4, (W || 1e5) - w / 2 - 4));
    rrect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2); ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,250,235,0.95)'; ctx.stroke();
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, cx, cy + 0.5);
  }
  function flame(ctx, x, y, h, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - h);
    ctx.bezierCurveTo(x + h * 0.55, y - h * 0.45, x + h * 0.42, y, x, y); ctx.bezierCurveTo(x - h * 0.42, y, x - h * 0.55, y - h * 0.45, x, y - h); ctx.fill();
  }
  P.drawFlames = function (ctx, x, y, w, h, fire, now) {
    const n = Math.min(4, 1 + Math.floor(fire * 3.2)), t = this.still ? 0 : now / 1000;
    ctx.fillStyle = 'rgba(255,70,24,' + (0.16 + 0.2 * fire) + ')'; ctx.fillRect(x, y, w, h);
    for (let q = 0; q < n; q++) {
      const fx = x + w * (n === 1 ? 0.5 : 0.2 + 0.6 * q / (n - 1)), base = y + h * (0.66 + 0.08 * Math.sin(q * 2.3));
      const fl = 1 + 0.18 * Math.sin(t * 11 + q * 2.1) + 0.1 * Math.sin(t * 17 + q * 1.3), sz = clamp(Math.min(w, h) * 0.55, 9, 24) * (0.62 + 0.5 * fire) * fl;
      flame(ctx, fx, base, sz, '#d9291a'); flame(ctx, fx, base, sz * 0.68, '#ff961c'); flame(ctx, fx, base, sz * 0.38, '#ffe27a');
    }
  };
  P.drawPin = function (ctx, x, y, r, col, label, alpha) {
    const cy = y - r * 1.7, a = Math.acos(1 / 1.7);
    ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(40,24,8,0.30)'; ctx.beginPath(); ctx.ellipse(x + r * 0.2, y + 1, r * 0.6, r * 0.24, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + r * Math.cos(Math.PI / 2 - a), cy + r * Math.sin(Math.PI / 2 - a)); ctx.arc(x, cy, r, Math.PI / 2 - a, Math.PI / 2 + a, true); ctx.closePath();
    ctx.lineWidth = Math.max(2.5, r * 0.22 + 1.5); ctx.strokeStyle = 'rgba(40,26,12,0.85)'; ctx.stroke();
    ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = Math.max(1.4, r * 0.2); ctx.strokeStyle = '#fff7e2'; ctx.stroke();
    if (label) {
      ctx.font = 'bold ' + Math.round(r * (label.length > 2 ? 0.86 : 1.02)) + 'px ' + SERIF; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.6; ctx.strokeStyle = 'rgba(30,20,10,0.75)'; ctx.strokeText(label, x, cy + 1); ctx.fillStyle = '#fff'; ctx.fillText(label, x, cy + 1);
    }
    ctx.restore();
  };
  P.drawBuilding = function (ctx, b, mine, now) {
    const FW = this.FW, B = FW.BUILDINGS[b.kind];
    if (!B || b.kind === 'bergfried') return;
    const fp = FW.footprintOf(b.kind, b.rot | 0), s = this.cam.s, p0 = this.toScreen(MX0 + b.i, MY0 + b.j), x = p0.x, y = p0.y, w = fp[0] * s, h = fp[1] * s;
    if (x > this.w + 4 || y > this.h + 4 || x + w < -4 || y + h < -4) return;
    const col = this.lordColor(b.lord), build = b.build == null ? 1 : b.build;
    if (b.ruined) { this.drawRuin(ctx, b, mine, x, y, w, h, col); return; }
    if (!mine) {   // an enemy building is a small mark in its lord's colour
      ctx.fillStyle = rgba(hex(col), 0.84); ctx.fillRect(x, y, w, h);
      if (B.mat === 'stein') { ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(x + w * 0.28, y + h * 0.28, w * 0.44, h * 0.44); }
      ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(36,24,12,0.9)'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (this.partners && this.partners.has(b.lord)) { ctx.setLineDash([4, 3]); ctx.lineWidth = 2; ctx.strokeStyle = '#2e9e4a'; ctx.strokeRect(x - 2, y - 2, w + 4, h + 4); ctx.setLineDash([]); }
      if (b.fire > 0) this.drawFlames(ctx, x, y, w, h, b.fire, now);
      return;
    }
    const isHof = b.kind === 'hof', m = Math.min(w, h);
    ctx.fillStyle = isHof ? 'rgba(190,198,108,0.97)' : B.mat === 'holz' ? 'rgba(222,180,116,0.97)' : 'rgba(208,204,194,0.97)'; ctx.fillRect(x, y, w, h);
    if (isHof) {
      ctx.strokeStyle = 'rgba(92,108,40,0.6)'; ctx.lineWidth = 1; ctx.beginPath();
      if (w >= h) for (let t = 0.5; t < fp[1]; t += 0.5) { ctx.moveTo(x, y + t * s); ctx.lineTo(x + w, y + t * s); } else for (let t = 0.5; t < fp[0]; t += 0.5) { ctx.moveTo(x + t * s, y); ctx.lineTo(x + t * s, y + h); }
      ctx.stroke();
      ctx.fillStyle = '#c98f58'; ctx.fillRect(x, y, 2 * s, 2 * s); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(46,30,14,0.9)'; ctx.strokeRect(x + 0.5, y + 0.5, 2 * s - 1, 2 * s - 1);
    }
    if (build < 1) {   // scaffolding: pale haze with diagonal stripes
      ctx.fillStyle = 'rgba(240,228,196,0.55)'; ctx.fillRect(x, y, w, h);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.strokeStyle = 'rgba(92,62,32,0.5)'; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let t = -h; t < w; t += 8) { ctx.moveTo(x + t, y + h); ctx.lineTo(x + t + h, y); }
      ctx.stroke(); ctx.restore();
    }
    ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(40,26,12,0.92)'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    const rest = !!b.paused && build >= 1;   // a resting workplace: a cool wash, a dimmed icon and a 💤 badge
    if (rest) { ctx.fillStyle = 'rgba(64,86,132,0.34)'; ctx.fillRect(x, y, w, h); }
    if (m >= 13) {
      ctx.save(); ctx.globalAlpha = build < 1 ? 0.55 : rest ? 0.45 : 1; ctx.font = clamp(m * 0.58, 10, 34) + 'px ' + EMOJI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(B.icon, x + w / 2 + (isHof ? w * 0.12 : 0), y + h / 2 + (isHof ? h * 0.1 : 0) + 1); ctx.restore();
    }
    if (rest) {
      const br = clamp(m * 0.4, 9, 13), bx = x + w - br * 0.4, by = y + br * 0.4;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fillStyle = '#34456b'; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff7e2'; ctx.stroke();
      ctx.save(); ctx.font = Math.round(br * 1.3) + 'px ' + EMOJI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText('💤', bx, by + 1); ctx.restore();
    }
    if (build < 1) {
      const rr = clamp(m * 0.36, 7, 24), cx = x + w / 2, cy = y + h / 2;
      ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(30,20,10,0.5)'; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#fff7e2'; ctx.lineWidth = 4.5 + 2; ctx.beginPath(); ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(build, 0.02, 1)); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 4.5; ctx.stroke();
    }
    if (b.hp != null && b.hp < 0.995) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x + 3, y + h - 7, w - 6, 4);
      ctx.fillStyle = b.hp > 0.5 ? '#5cc24a' : b.hp > 0.25 ? '#e6b830' : '#d6382a'; ctx.fillRect(x + 3, y + h - 7, (w - 6) * clamp(b.hp, 0, 1), 4);
    }
    if (b.fire > 0) this.drawFlames(ctx, x, y, w, h, b.fire, now);
  };
  // a ruin: a dull rubble plot (it still blocks the footprint); the dashed outline in the house colour says whose it is
  P.drawRuin = function (ctx, b, mine, x, y, w, h, col) {
    const s = this.cam.s, m = Math.min(w, h);
    ctx.fillStyle = mine ? 'rgba(168,156,140,0.97)' : 'rgba(132,124,114,0.92)'; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const n = clamp(Math.round(w * h / (s * s) * 0.9), 4, 16), id = (b.id | 0) + 31;
    for (let q = 0; q < n; q++) {   // fallen stones and charred beams, placed by the building id so they never jitter
      const sx = x + (0.08 + 0.84 * hash2(id, q, 201)) * w, sy = y + (0.08 + 0.84 * hash2(id, q, 202)) * h, r = s * (0.28 + 0.34 * hash2(id, q, 203)), a = hash2(id, q, 204) * Math.PI;
      ctx.fillStyle = q % 3 === 0 ? 'rgba(70,58,48,0.8)' : q % 3 === 1 ? 'rgba(206,198,184,0.95)' : 'rgba(120,108,96,0.95)';
      ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.66, a, 0, TAU); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(46,36,28,0.7)'; ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(46,36,28,0.55)'; ctx.lineWidth = 1.2; ctx.beginPath();   // cracks across the plot
    ctx.moveTo(x + w * 0.12, y + h * 0.3); ctx.lineTo(x + w * 0.4, y + h * 0.52); ctx.lineTo(x + w * 0.34, y + h * 0.8);
    ctx.moveTo(x + w * 0.62, y + h * 0.12); ctx.lineTo(x + w * 0.55, y + h * 0.42); ctx.lineTo(x + w * 0.86, y + h * 0.66);
    ctx.stroke(); ctx.restore();
    ctx.setLineDash([6, 4]); ctx.lineWidth = 2.4; ctx.strokeStyle = col; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3); ctx.setLineDash([]);
    ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(40,26,12,0.92)'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (m >= 13) {
      ctx.save(); ctx.globalAlpha = 0.9; ctx.font = clamp(m * 0.5, 10, 30) + 'px ' + EMOJI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🏚️', x + w / 2, y + h / 2 + 1); ctx.restore();
    }
    if (this.partners && this.partners.has(b.lord) && !mine) { ctx.setLineDash([4, 3]); ctx.lineWidth = 2; ctx.strokeStyle = '#2e9e4a'; ctx.strokeRect(x - 2, y - 2, w + 4, h + 4); ctx.setLineDash([]); }
  };
  P.drawGhost = function (ctx, now) {
    const gh = this.ghost; if (!gh) return;
    const FW = this.FW, res = this.ghostRes || { ok: false }, fp = FW.footprintOf(gh.kind, gh.rot), s = this.cam.s, ok = !!res.ok, me = this.mySite(), g = this.grid;
    const p0 = this.toScreen(MX0 + gh.i, MY0 + gh.j), w = fp[0] * s, h = fp[1] * s;
    if (s >= 3.4) {   // snap-grid hint
      const a = this.toScreen(MX0 + Math.max(0, gh.i - 4), MY0 + Math.max(0, gh.j - 4)), b = this.toScreen(MX0 + Math.min(GW, gh.i + fp[0] + 4), MY0 + Math.min(GH, gh.j + fp[1] + 4));
      ctx.strokeStyle = 'rgba(70,48,24,0.17)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = Math.max(0, gh.i - 4); i <= Math.min(GW, gh.i + fp[0] + 4); i++) { const x = this.toScreen(MX0 + i, 0).x; ctx.moveTo(x, a.y); ctx.lineTo(x, b.y); }
      for (let j = Math.max(0, gh.j - 4); j <= Math.min(GH, gh.j + fp[1] + 4); j++) { const y = this.toScreen(0, MY0 + j).y; ctx.moveTo(a.x, y); ctx.lineTo(b.x, y); }
      ctx.stroke();
    }
    let sh = 0;
    if (this.shakeT && !this.still) { const t = (now - this.shakeT) / 380; if (t < 1) sh = Math.sin(t * 30) * 7 * (1 - t); }
    const x = p0.x + sh, y = p0.y;
    ctx.save();
    ctx.fillStyle = ok ? 'rgba(88,200,84,0.58)' : 'rgba(228,66,52,0.52)'; ctx.fillRect(x, y, w, h);
    if (!ok) {   // the cells that break the rule
      ctx.fillStyle = 'rgba(190,24,16,0.34)';
      for (let dj = 0; dj < fp[1]; dj++) for (let di = 0; di < fp[0]; di++) {
        const k = (gh.j + dj) * GW + gh.i + di;
        if (k < 0 || k >= N) continue;
        const bad = g.owner[k] !== me || (g.cls[k] !== 5 && g.cls[k] !== 6) || !FW.dry(g, k, this.L) || this.occ[k] || (g.keep && g.keep[k]);
        if (bad) ctx.fillRect(x + di * s, y + dj * s, s, s);
      }
    }
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,250,235,0.95)'; ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([7, 4]); ctx.lineDashOffset = this.still ? 0 : -((now / 60) % 11); ctx.lineWidth = 2.6; ctx.strokeStyle = ok ? '#14702a' : '#a01c14'; ctx.strokeRect(x, y, w, h); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    const B = FW.BUILDINGS[gh.kind], m = Math.min(w, h);
    ctx.font = clamp(m * 0.6, 11, 36) + 'px ' + EMOJI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = 0.95; ctx.fillText(B.icon, x + w / 2, y + h / 2 + 1); ctx.globalAlpha = 1;
    if (!ok && res.reason) {
      const rx = x + w - 3, ry = y + 3;
      ctx.fillStyle = '#fff7e2'; ctx.beginPath(); ctx.arc(rx, ry, 11, 0, TAU); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#a8221a'; ctx.stroke();
      ctx.font = '13px ' + EMOJI; ctx.fillStyle = '#000'; ctx.fillText(REASON_ICON[res.reason] || '❌', rx, ry + 1);
    }
    ctx.restore();
    if (!ok && res.reason) {
      const by = y - 17 > 14 ? y - 17 : y + h + 17;
      bubble(ctx, x + w / 2, by, REASON_TEXT[res.reason] || 'Geht nicht', '#b3261e', '#fff', 14, this.w);
    }
  };
  P.drawPartners = function (ctx) {   // a green ring and a 🤝 on the castle of every pact partner
    if (!this.partners) return;
    const s = this.cam.s;
    for (const i of this.partners) {
      const l = this.lords[i], st = l && this.sites.find((q) => q.s === l.site); if (!st) continue;
      const p = this.toScreen(st.x, st.y), r = 4.4 * s;
      if (p.x < -r || p.y < -r || p.x > this.w + r || p.y > this.h + r) continue;
      ctx.save(); ctx.setLineDash([7, 5]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,250,235,0.9)'; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#2e9e4a'; ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      const bx = p.x + r * 0.72, by = p.y - r * 0.72;
      ctx.fillStyle = '#2e9e4a'; ctx.beginPath(); ctx.arc(bx, by, 11, 0, TAU); ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff7e2'; ctx.stroke();
      ctx.font = '12px ' + EMOJI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText('🤝', bx, by + 1);
    }
  };
  P.drawSelection = function (ctx, now) {   // the building whose card is open (the own castle: selId 'keep')
    if (this.selId == null) return;
    let b, fp, bx, by;   // the building, its footprint and its top-left corner in map units
    if (this.selId === 'keep') { const k = this.sites.find((q) => q.s === this.mySite()); if (!k) return; b = { lord: this.me }; fp = this.FW.BUILDINGS.bergfried.size; bx = k.x - fp[0] / 2; by = k.y - fp[1] / 2; }
    else { b = this.board.buildings.find((q) => q.id === this.selId); if (!b || !this.FW.BUILDINGS[b.kind]) return; fp = this.FW.footprintOf(b.kind, b.rot | 0); bx = MX0 + b.i; by = MY0 + b.j; }
    const p0 = this.toScreen(bx, by), s = this.cam.s, w = fp[0] * s, h = fp[1] * s;
    const pulse = this.still ? 0.5 : 0.5 + 0.5 * Math.sin(now / 260);
    ctx.save(); ctx.lineJoin = 'round';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(30,20,10,0.55)'; ctx.strokeRect(p0.x - 3, p0.y - 3, w + 6, h + 6);
    ctx.lineWidth = 3.4; ctx.strokeStyle = 'rgba(255,247,226,' + (0.78 + 0.22 * pulse) + ')'; ctx.strokeRect(p0.x - 3, p0.y - 3, w + 6, h + 6);
    const q = Math.min(9, Math.max(5, Math.min(w, h) * 0.3)), x0 = p0.x - 5, y0 = p0.y - 5, x1 = p0.x + w + 5, y1 = p0.y + h + 5;
    ctx.lineWidth = 4; ctx.strokeStyle = this.lordColor(b.lord); ctx.beginPath();   // corner brackets in the house colour
    ctx.moveTo(x0, y0 + q); ctx.lineTo(x0, y0); ctx.lineTo(x0 + q, y0); ctx.moveTo(x1 - q, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + q);
    ctx.moveTo(x0, y1 - q); ctx.lineTo(x0, y1); ctx.lineTo(x0 + q, y1); ctx.moveTo(x1 - q, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 - q); ctx.stroke();
    ctx.restore();
  };
  // the coverage wash: the live discs as ONE shape (overlaps do not pile up, and only the outer edge gets a line); what the planned well would add is tinted stronger.
  // Cached while neither the camera nor the discs change.
  const COVER_FILL = 'rgba(84,156,232,0.17)', COVER_NEW = 'rgba(24,134,250,0.30)', COVER_LINE = 'rgba(28,96,190,0.92)', COVER_BRIGHT = '#1d7cf2', COVER_LW = 2;
  P.drawCoverDiscs = function (ctx, cov, now) {
    const s = this.cam.s, W = this.w, H = this.h, dpr = this.dpr;
    const disc = (d) => { const p = this.toScreen(d.x, d.y); return { x: p.x, y: p.y, r: d.r * s }; };
    const live = cov.discs.filter((d) => d.live && d.kind !== 'plan').map(disc), plan = cov.plan ? [disc(cov.plan)] : [], all = live.concat(plan);
    const key = W + 'x' + H + '@' + dpr + '|' + live.length + '|' + all.map((d) => Math.round(d.x * 10) + ',' + Math.round(d.y * 10) + ',' + Math.round(d.r * 10)).join(';');
    if (all.length && this.covKey !== key) {
      if (!this.covCv) this.covCv = document.createElement('canvas');
      const c = this.covCv, cw = Math.round(W * dpr), ch = Math.round(H * dpr), g = c.getContext('2d');
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; } else { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch); }   // resizing clears it; a plan that moves must not reallocate the canvas every frame
      const path = (list, grow) => { g.beginPath(); for (const d of list) { g.moveTo(d.x + d.r + grow, d.y); g.arc(d.x, d.y, d.r + grow, 0, TAU); } };
      const carve = (list) => { g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; path(list, 0); g.fill(); g.globalCompositeOperation = 'source-over'; };
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      path(all, COVER_LW); g.fillStyle = COVER_LINE; g.fill(); carve(all);                                  // the outline: every disc grown by one line width, minus the discs themselves
      if (plan.length) { path(plan, 0); g.fillStyle = COVER_NEW; g.fill(); carve(live); }                    // the planned well's disc, minus what the others already reach
      path(live, 0); g.fillStyle = COVER_FILL; g.fill();
      this.covKey = key;
    }
    if (all.length) ctx.drawImage(this.covCv, 0, 0, W, H);
    ctx.save(); ctx.lineJoin = 'round';
    for (const d of cov.discs) {
      const lone = !d.live, bright = d.kind === 'plan' || d.sel;
      if (!lone && !bright) continue;
      const q = disc(d);
      if (q.x + q.r < 0 || q.y + q.r < 0 || q.x - q.r > W || q.y - q.r > H) continue;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, TAU);
      if (lone) { ctx.setLineDash([6, 5]); ctx.lineWidth = 4.4; ctx.strokeStyle = 'rgba(255,250,235,0.7)'; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = COVER_LINE; ctx.stroke(); ctx.setLineDash([]); }   // an unfinished well: it puts out nothing yet
      else { ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,250,235,0.9)'; ctx.stroke(); ctx.lineWidth = 3; ctx.strokeStyle = COVER_BRIGHT; ctx.stroke(); }   // the planned well / the one whose card is open
    }
    ctx.restore();
  };
  // a ring on every own wooden building: blue with a drop = a well reaches it; orange = nothing does (a would-be gain of the planned well gets a bright halo)
  function drop(ctx, x, y, h) {   // a small teardrop, h tall, centred on (x, y)
    const r = h * 0.3, cy = y + h * 0.2;
    ctx.beginPath(); ctx.moveTo(x, y - h * 0.5); ctx.bezierCurveTo(x + r * 0.5, y - h * 0.16, x + r, cy - r * 0.9, x + r, cy); ctx.arc(x, cy, r, 0, Math.PI, false);
    ctx.bezierCurveTo(x - r, cy - r * 0.9, x - r * 0.5, y - h * 0.16, x, y - h * 0.5); ctx.closePath();
  }
  P.drawCoverMarks = function (ctx, cov) {
    const s = this.cam.s, rr = clamp(s * 1.25, 4.6, 8);
    ctx.save(); ctx.lineJoin = 'round';
    for (const m of cov.marks) {
      const p = this.toScreen(m.x0, m.y0), cx = p.x + 0.5, cy = p.y + 0.5;   // pinned to the building's top-left corner
      if (cx < -rr - 4 || cy < -rr - 4 || cx > this.w + rr + 4 || cy > this.h + rr + 4) continue;
      if (m.gain) { ctx.beginPath(); ctx.arc(cx, cy, rr + 3, 0, TAU); ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke(); ctx.lineWidth = 1.6; ctx.strokeStyle = COVER_BRIGHT; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU);
      if (m.cov || m.gain) {
        ctx.fillStyle = 'rgba(244,250,255,0.95)'; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = '#2872d0'; ctx.stroke();
        drop(ctx, cx, cy + 0.2, rr * 1.15); ctx.fillStyle = '#2872d0'; ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(255,236,208,0.62)'; ctx.fill(); ctx.lineWidth = 4.2; ctx.strokeStyle = 'rgba(64,30,6,0.55)'; ctx.stroke(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#f5800a'; ctx.stroke();
      }
    }
    ctx.restore();
  };
  P.drawPings = function (ctx, now) {   // a pulsing ring where an alert happened
    for (const pg of this.pings) {
      const age = this.still ? 700 : now - pg.t0, p = this.toScreen(pg.x, pg.y), fade = clamp(1 - age / pg.ms, 0, 1);
      ctx.save(); ctx.lineWidth = 3.4;
      for (let k = 0; k < 2; k++) {
        const ph = ((age / 900) + k * 0.5) % 1, r = 9 + ph * 46;
        ctx.strokeStyle = rgba(hex(pg.color), (1 - ph) * 0.95 * Math.min(1, fade * 2.2)); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
      }
      ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(255,247,226,0.95)'; ctx.fillStyle = pg.color; ctx.beginPath(); ctx.arc(p.x, p.y, 6.5, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  };
  P.drawRoute = function (ctx, d, now) {
    const col = this.lordColor(this.me), a = this.toScreen(d.from.x, d.from.y);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
    if (d.route && d.route.length > 1) d.route.forEach((pt, i) => { const q = this.toScreen(pt.x, pt.y); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    else { const b = this.toScreen(d.x, d.y); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.setLineDash([]); ctx.strokeStyle = 'rgba(40,26,12,0.55)'; ctx.lineWidth = 9; ctx.stroke(); ctx.strokeStyle = 'rgba(250,242,218,0.96)'; ctx.lineWidth = 6.2; ctx.stroke();
    if (d.route) { ctx.strokeStyle = col; ctx.lineWidth = 3.6; ctx.setLineDash([9, 6]); } else { ctx.strokeStyle = '#d2362a'; ctx.lineWidth = 3.6; ctx.setLineDash([7, 7]); }
    ctx.lineDashOffset = this.still ? 0 : -((now / 45) % 18); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    ctx.beginPath(); ctx.arc(a.x, a.y, 5.5, 0, TAU); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff7e2'; ctx.stroke();
  };
  P.drawCrossingNames = function (ctx) {   // serif italic names beside the crossings (above the flood water)
    const s = this.cam.s, fs = clamp(s * 2.7, 10, 15);
    ctx.font = 'italic 600 ' + fs + 'px ' + SERIF; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const c of this.crossings) {
      const river = Math.abs(Math.sin(c.rot)) > 0.7, p = river ? this.toScreen(c.x + 2.4 + (c.kind === 'bruecke' ? 1 : 0), c.y) : this.toScreen(c.x, c.y - 2.4 - fs / s * 0.5);
      if (p.x < -80 || p.x > this.w + 80 || p.y < -20 || p.y > this.h + 20) continue;
      const tw = ctx.measureText(c.name).width;
      if (!river) p.x = clamp(p.x, tw / 2 + 6, this.w - tw / 2 - 6); else if (p.x + tw > this.w - 4) p.x = this.w - 4 - tw;
      ctx.textAlign = river ? 'left' : 'center';
      haloText(ctx, c.name, p.x, p.y, '#4a3018', 'rgba(240,228,194,0.92)', 3.2);
    }
  };
  P.drawLayer = function (ctx, l, alpha) {
    if (alpha <= 0.002) return;
    const c = this.cam, k = c.s / l.cam.s, W = this.w, H = this.h;
    ctx.globalAlpha = alpha;
    ctx.drawImage(l.canvas, W / 2 + (l.cam.cx - c.cx) * c.s - (W / 2) * k, H / 2 + (l.cam.cy - c.cy) * c.s - (H / 2) * k, W * k, H * k);
    ctx.globalAlpha = 1;
  };

  P.stepAnim = function (now) {
    let busy = false;
    const dt = this.lastNow ? clamp((now - this.lastNow) / 1000, 0, 0.1) : 0.016; this.lastNow = now;
    const a = this.camAnim;
    if (a) {
      const t = clamp((now - a.t0) / a.dur, 0, 1), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.camE = e; this.cam = { cx: lerp(a.from.cx, a.to.cx, e), cy: lerp(a.from.cy, a.to.cy, e), s: a.from.s * Math.pow(a.to.s / a.from.s, e) };
      if (t >= 1) { this.camAnim = null; this.cam = a.to; }
      busy = true;
    }
    const k = this.still ? 1 : 1 - Math.exp(-dt * 7);
    for (const v of this.bviews.values()) {
      const dx = v.tx - v.x, dy = v.ty - v.y;
      if (dx * dx + dy * dy > 4e-4) { v.x += dx * k; v.y += dy * k; busy = true; } else { v.x = v.tx; v.y = v.ty; }
      const o = v.lord === this.me ? this.orders[v.n] : null;   // an order line ends when the banner arrives (or after two minutes)
      if (o && (Math.hypot(o.x - v.x, o.y - v.y) < 1.8 || now - o.t > 120000)) { delete this.orders[v.n]; this.dirty = true; }
    }
    if (this.shakeT) { if (now - this.shakeT < 400) busy = true; else { this.shakeT = 0; this.dirty = true; } }
    if (this.callouts.length) { const n0 = this.callouts.length; this.callouts = this.callouts.filter((c) => c.until > now); if (this.callouts.length !== n0) this.dirty = true; busy = busy || this.callouts.length > 0; }
    if (this.pinPulse) { if (now - this.pinPulse.t0 < 1400) busy = true; else { this.pinPulse = null; this.dirty = true; } }
    if (this.pings.length) { const n0 = this.pings.length; this.pings = this.pings.filter((p) => now - p.t0 < p.ms); if (this.pings.length !== n0) this.dirty = true; busy = busy || this.pings.length > 0; }
    if ((this.selId != null || this.armPin) && !this.still) busy = true;   // the selection ring and the armed banner's ring pulse
    return busy;
  };

  P.render = function (now) {
    if (!this.w || !this.grid) return;
    now = now || performance.now();
    const busy = this.stepAnim(now);
    if (!this.maskCv || (this.maskDirty && (this.still || now - this.lastMaskStamp >= 100)) || (this.maskLive > 0 && now - this.lastMaskStamp >= 500)) {
      this.updateMask(now); this.maskDirty = false; this.lastMaskStamp = now; this.dirty = true;
    }
    const fireOn = this.board.buildings.some((b) => b.fire > 0) || this.board.fires.length > 0;
    if (!(this.dirty || busy || this.maskDirty || this.freeStale() || (!this.still && (fireOn || this.ghost || (this.drag && this.drag.type === 'banner'))))) return;
    this.dirty = false;
    const ctx = this.ctx, dpr = this.dpr, W = this.w, H = this.h, staticBefore = this.perf.staticMs;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#d8c89e'; ctx.fillRect(0, 0, W, H);
    const t0 = performance.now(), s = this.cam.s, me = this.me;
    if (this.camAnim) {
      const toMine = this.viewName === 'mine';
      this.drawLayer(ctx, this.layer('all'), 1); this.drawLayer(ctx, this.layer('mine'), toMine ? this.camE : 1 - this.camE);
    } else if (this.viewName === 'free') {
      if (this.freeStale() && !this.ptrs.size && now - this.camT > 130) this.layers.free = this.renderStatic('free', { cx: this.cam.cx, cy: this.cam.cy, s: this.cam.s });
      if (!this.freeStale()) this.drawLayer(ctx, this.layers.free, 1);
      else {   // while the camera moves: the nearest cached preset, stretched
        const A = this.layer('all'), M = this.layer('mine'), ls = Math.log(this.cam.s);
        this.drawLayer(ctx, A, 1); if (Math.abs(ls - Math.log(M.cam.s)) < Math.abs(ls - Math.log(A.cam.s))) this.drawLayer(ctx, M, 1);
      }
    } else this.drawLayer(ctx, this.layer(this.viewName), 1);
    if (!this.otherT && this.me >= 0) this.otherT = setTimeout(() => { this.otherT = 0; if (this.cv) { try { this.layer(this.viewName === 'mine' ? 'all' : 'mine'); } catch (e) { /* ignore */ } } }, 400);
    if (this.maskVisible) { const p = this.toScreen(MX0, MY0); ctx.drawImage(this.maskCv, p.x, p.y, 144 * s, 90 * s); }
    this.drawCrossingNames(ctx);
    if (this.tool === 'ghost') { if (!this.fog) this.buildFog(); const p = this.toScreen(MX0, MY0); ctx.drawImage(this.fog, p.x, p.y, 144 * s, 90 * s); }
    const blds = this.board.buildings, cov = this.cover ? this.coverage() : null;
    if (cov) this.drawCoverDiscs(ctx, cov, now);
    for (const b of blds) if (b.lord !== me) this.drawBuilding(ctx, b, false, now);
    const own = blds.filter((b) => b.lord === me).sort((a, b) => a.j - b.j);
    for (const b of own) this.drawBuilding(ctx, b, true, now);
    if (cov) this.drawCoverMarks(ctx, cov);
    for (const f of this.board.fires) { const p = this.toScreen(f.x, f.y), r = (f.r || 1) * s; this.drawFlames(ctx, p.x - r, p.y - r, r * 2, r * 2, f.fire == null ? 0.6 : f.fire, now); }
    this.drawPartners(ctx);
    this.drawSelection(ctx, now);
    // orders: where each own banner is heading
    const col = this.lordColor(me), pins = this.ownPins();
    for (const pin of pins) {
      const o = this.orders[pin.n]; if (!o || (this.drag && this.drag.type === 'banner' && this.drag.n === pin.n)) continue;
      const a = this.toScreen(pin.x, pin.y), b = this.toScreen(o.x, o.y);
      ctx.setLineDash([3, 7]); ctx.lineCap = 'round'; ctx.lineWidth = 2.6; ctx.strokeStyle = rgba(hex(col), 0.75); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, TAU); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = '#fff7e2'; ctx.stroke();
    }
    const d = this.drag && this.drag.type === 'banner' ? this.drag : null;
    if (d) {
      if (d.pending) this.updateRoute(d, now, this.still);
      this.drawRoute(ctx, d, now);
      if (d.snap) { const q = this.toScreen(d.snap.x, d.snap.y); ctx.setLineDash([5, 4]); ctx.lineWidth = 2.6; ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(q.x, q.y, 17, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1.4; ctx.strokeStyle = '#fff7e2'; ctx.beginPath(); ctx.arc(q.x, q.y, 20, 0, TAU); ctx.stroke(); }
    }
    // banners: enemy ones small, own ones large with their number
    for (const v of this.bviews.values()) if (v.lord !== me) { const p = this.toScreen(v.x, v.y); this.drawPin(ctx, p.x, p.y, 6.5, this.lordColor(v.lord), '', 0.95); }
    for (const pin of pins) {
      if (!pin.exists && this.tool === 'ghost') continue;
      const dragging = d && d.n === pin.n, pos = dragging ? { x: d.x, y: d.y } : pin, p = this.toScreen(pos.x, pos.y), pulse = this.pinPulse && this.pinPulse.n === pin.n ? (now - this.pinPulse.t0) / 1400 : -1;
      if (pulse >= 0 && !this.still) { ctx.lineWidth = 3; ctx.strokeStyle = rgba(hex(col), 1 - pulse); ctx.beginPath(); ctx.arc(p.x, p.y - 20, 18 + pulse * 30, 0, TAU); ctx.stroke(); }
      if (this.tool === 'banner' && !dragging) { ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,247,226,0.9)'; ctx.beginPath(); ctx.arc(p.x, p.y - 20.4, 17, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      if (this.armPin === pin.n && this.tool === 'banner' && !dragging) {   // waits for its target: a gold ring that breathes
        const br = this.still ? 0.5 : 0.5 + 0.5 * Math.sin(now / 240);
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(30,20,10,0.55)'; ctx.beginPath(); ctx.arc(p.x, p.y - 20.4, 23 + br * 3, 0, TAU); ctx.stroke();
        ctx.lineWidth = 3.4; ctx.strokeStyle = 'rgba(255,214,102,' + (0.8 + 0.2 * br) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y - 20.4, 23 + br * 3, 0, TAU); ctx.stroke();
      }
      const big = this.tool === 'banner' || dragging || this.selPin === pin.n || this.armPin === pin.n;
      this.drawPin(ctx, p.x, p.y, big ? 12 : 9, col, ROMAN[pin.n], big ? 1 : 0.7);
      if ((pin.exists || dragging) && big) {
        const txt = '×' + pin.count; ctx.font = 'bold 11px system-ui'; const tw = ctx.measureText(txt).width + 8;
        rrect(ctx, p.x + 8, p.y - 14, tw, 15, 7); ctx.fillStyle = 'rgba(40,28,16,0.88)'; ctx.fill(); ctx.fillStyle = '#fff7e2'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, p.x + 12, p.y - 6);
      }
    }
    if (d) {
      const p = this.toScreen(d.x, d.y), hy = p.y - 12 * 1.7, txt = d.noRoute ? (this.L > 0.55 ? '🌊 Hochwasser' : '✖ Kein Weg') : d.snap ? '📍 ' + d.snap.name : '';
      if (txt) {
        const bw = bubbleW(ctx, txt, 14); let bx = p.x + 22 + bw / 2; if (bx + bw / 2 > W - 4) bx = p.x - 22 - bw / 2;
        bubble(ctx, bx, hy, txt, d.noRoute ? '#b3261e' : 'rgba(46,32,18,0.94)', d.noRoute ? '#fff' : '#fff7e2', 14, W);
      }
    }
    this.drawGhost(ctx, now);
    this.drawPings(ctx, now);
    for (const c of this.callouts) { const p = this.toScreen(c.x, c.y); bubble(ctx, p.x, p.y - 20, c.text, 'rgba(46,32,18,0.92)', '#fff7e2', 13, W); }
    const dt = performance.now() - t0 - (this.perf.staticMs - staticBefore);
    this.perf.frames++; this.perf.sum += dt; this.perf.last = dt; if (dt > this.perf.max) this.perf.max = dt;
  };
  P.resetPerf = function () { const p = this.perf; p.frames = 0; p.sum = 0; p.max = 0; p.last = 0; };
  P.dispose = function () {
    const cv = this.cv, h = this._h;
    if (h) {
      cv.removeEventListener('touchstart', h.ts); cv.removeEventListener('touchmove', h.tm); cv.removeEventListener('touchend', h.te); cv.removeEventListener('touchcancel', h.te);
      cv.removeEventListener('mousedown', h.md); window.removeEventListener('mousemove', h.mm); window.removeEventListener('mouseup', h.mu); cv.removeEventListener('wheel', h.wh);
    }
    clearTimeout(this.otherT); this.layers = {}; this.wash = null; this.maskCv = null; this.covCv = null; this.fog = null; this.handlers = {}; this.cv = null; this.ctx = null;
  };

  root.FurtWarmap = FurtWarmap;
})(window);
