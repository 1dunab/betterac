// Wauwau-WG dog art — procedural canvas drawing of all dogs and toys
// (contract: docs/WAUWAUWG.md §Art). Loaded by screen AND controller; no state, no DOM,
// deterministic (no Math.random), no images, no shadowBlur, never reads from the ctx.
// Side view = a tiny rig (torso, IK legs, neck/head, tail, ears) driven by pose + t;
// the front-view portrait shares palette and breed traits with it.
(function () {
  'use strict';
  const WW = window.WW;
  const art = WW.art = WW.art || {};

  // Relative size per breed (1 = labrador-ish medium dog).
  art.SIZE = { dackel: 0.8, labrador: 1.1, mops: 0.78, husky: 1.05, corgi: 0.8, pudel: 0.95, schaefer: 1.15, mischling: 0.95 };

  // ---------- small helpers ----------
  const PI = Math.PI, TAU = PI * 2, sin = Math.sin, cos = Math.cos;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => k * k * (3 - 2 * k);
  const frac = (v) => v - Math.floor(v);
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  function hash(str) {
    let h = 2166136261;
    str = String(str);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // colors are [r,g,b] arrays while mixing and CSS strings when painting
  const hexCache = {};
  function hex(c) {
    let v = hexCache[c];
    if (!v) {
      let h = String(c).replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const n = parseInt(h, 16) || 0;
      v = hexCache[c] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return v;
  }
  const mx = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const sh = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const tn = (a, k) => mx(a, [255, 255, 255], k);
  const lum = (a) => (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]) / 255;
  function css(a, al) {
    const r = Math.round(clamp(a[0], 0, 255)), g = Math.round(clamp(a[1], 0, 255)), b = Math.round(clamp(a[2], 0, 255));
    return al == null || al >= 1 ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + al.toFixed(3) + ')';
  }

  function coatOf(dog) {
    const b = WW.BREEDS[dog && dog.breed] || WW.BREEDS.mischling;
    return b.coats[(dog && dog.coat) | 0] || b.coats[0];
  }
  art.swatch = function (breed, coat) { return coatOf({ breed, coat }).fur; };
  const breedOf = (dog) => (dog && WW.BREEDS[dog.breed]) ? dog.breed : 'mischling';

  // Palette per dog look (breed, coat, wetness in 1/8 steps), cached. Wet fur is darker
  // and bluish; dark coats get a LIGHT outline so they stay readable on dark scenes.
  const palCache = {};
  const INK = [38, 24, 20];
  function palOf(dog, wet) {
    const wq = Math.round(clamp(num(wet, 0), 0, 1) * 8), key = breedOf(dog) + ((dog && dog.coat) | 0) + '|' + wq;
    let p = palCache[key];
    if (p) return p;
    const c = coatOf(dog), w = wq / 8;
    let f = hex(c.fur), f2 = hex(c.fur2);
    if (w) {
      const wetK = (a) => mx(sh(a, 0.68 + 0.14 * lum(a)), [60, 70, 96], 0.07);
      f = mx(f, wetK(f), w * 0.9); f2 = mx(f2, wetK(f2), w * 0.9);
    }
    const dark = lum(f) < 0.2, dark2 = lum(f2) < 0.2, light = lum(f) > 0.8;
    p = {
      dark, dark2, light, wet: w, raw: f, raw2: f2,
      f: css(f), fD: css(sh(f, 0.84)), fDD: css(sh(f, 0.68)), fL: css(tn(f, dark ? 0.2 : 0.3)), fLL: css(tn(f, dark ? 0.4 : 0.6)),
      far: css(sh(mx(f, [90, 70, 70], dark ? 0.1 : 0), dark ? 0.9 : 0.8)),
      f2a40: css(f2, 0.4), f2a50: css(f2, 0.5), f2a75: css(f2, 0.75), f2La45: css(tn(f2, 0.35), 0.45), f2La50: css(tn(f2, 0.35), 0.5), fLLa: css(tn(f, 0.6), 0.55),
      f2: css(f2), f2D: css(sh(f2, 0.84)), f2L: css(tn(f2, dark2 ? 0.25 : 0.35)), far2: css(sh(f2, 0.8)),
      ol: css(dark ? tn(f, 0.34) : mx(sh(f, 0.46), INK, 0.5)),
      ol2: css(dark2 ? tn(f2, 0.34) : mx(sh(f2, 0.46), INK, 0.5)),
      shade: css(sh(f, 0.74), 0.5), shade0: css(sh(f, 0.6), 0), shadeD: css(mx(sh(f, 0.6), [70, 40, 80], 0.1), 0.42), shadeL: css(sh(f, 0.55), 0.2),
      nose: '#2b1d1b', noseHi: 'rgba(255,255,255,.55)', eye: '#2a1812', pink: '#ff9eb3', pinkD: '#e8708c',
      mouth: '#74202e', tongue: '#ff7e98', tongueD: '#e0516f', white: '#ffffff'
    };
    palCache[key] = p;
    return p;
  }

  // ---------- breed geometry (side view; px of a "100 px" dog, art.SIZE scales it) ----------
  // a/rc/rr = torso half-length, chest and rump radius; belly = ground clearance; lw = leg width.
  // n[xy] = head center from the neck base; hr/sl/s0/s1/sd = cranium radius, snout length, base/tip radius, drop.
  const D = {
    a: 29, rc: 15, rr: 14, belly: 20, tuck: 0.42, lw: 7.4, lp: 5.5, lm: 9, neckR: 0.8,
    nx: 14, ny: -14, hr: 14, sl: 13, s0: 7.4, s1: 5.6, sd: 4.5, brow: 0,
    ear: 'flop', eL: 17, eW: 10, eX: -0.2, eY: -0.5, eRot: 0.3,
    tail: 'sabre', tL: 24, tW: 5.2, tAng: -0.75,
    eye: 3.3, ex: 0.4, ey: -0.1, fluff: 0
  };
  const B = {
    labrador: { a: 30, rc: 16.5, rr: 15, belly: 21, lw: 8.6, nx: 15, ny: -15, hr: 14.8, sl: 14, s0: 8.2, s1: 6.4, ear: 'flop', eL: 17, eW: 10, eX: -0.52, eY: -0.5, tail: 'otter', tL: 26, tW: 8, tAng: -0.1, eye: 3.4, cheek: 0.6 },
    dackel: { sitMax: -0.85, a: 40, rc: 13, rr: 12.2, belly: 9.5, tuck: 0.55, lw: 7.4, lp: 4.5, lm: 6, nx: 15, ny: -12, hr: 12.6, sl: 18, s0: 6.4, s1: 4.7, sd: 3.6, ear: 'long', eL: 25, eW: 11.5, eX: -0.1, eY: -0.35, tail: 'sabre', tL: 28, tW: 5.2, tAng: 0.3, eye: 3 },
    mops: { a: 27, rc: 17.5, rr: 15.5, belly: 15, tuck: 0.2, lw: 9.2, lp: 4.5, lm: 7, nx: 13, ny: -11, hr: 19, sl: 3.5, s0: 11, s1: 9, sd: 1.5, ear: 'button', eL: 12, eW: 10.5, eX: 0.05, eY: -0.6, tail: 'curl', tL: 7, tW: 5, eye: 5, ex: 0.4, ey: -0.12, cheek: 0.66 },
    husky: { a: 30, rc: 16, rr: 14.5, belly: 21, lw: 8, nx: 15, ny: -15.5, hr: 14.8, sl: 14, s0: 8, s1: 5.4, ear: 'erect', eL: 17, eW: 10, eX: -0.1, eY: -0.7, eRot: 0.1, tail: 'bushy', tL: 28, tW: 11, tAng: 1.2, eye: 3.1, fluff: 1, blue: 1 },
    corgi: { sitMax: -0.62, a: 33, rc: 15.6, rr: 14.5, belly: 11, tuck: 0.3, lw: 8, lp: 4.5, lm: 6.5, nx: 15, ny: -14.5, hr: 14.2, sl: 15, s0: 7.2, s1: 5.2, sd: 4, ear: 'erect', eL: 21, eW: 12.5, eX: -0.05, eY: -0.72, eRot: 0.12, tail: 'stub', tL: 5, tW: 6, eye: 3.4, fluff: 0.35 },
    pudel: { a: 27, rc: 14.2, rr: 13.2, belly: 24, lw: 5.6, lp: 6, lm: 10, nx: 13, ny: -17.5, hr: 13.2, sl: 15, s0: 6, s1: 4.4, sd: 3.2, ear: 'curl', eL: 18, eW: 11, eX: -0.1, eY: -0.1, tail: 'pom', tL: 20, tW: 3.4, tAng: 1.0, eye: 3.2, fluff: 0.5, topknot: 1, puffy: 1 },
    schaefer: { a: 32, rc: 16, rr: 14.5, belly: 23, lw: 8, nx: 16, ny: -15.5, hr: 14.2, sl: 16.5, s0: 7.6, s1: 5.3, sd: 3.4, ear: 'erect', eL: 20, eW: 11.5, eX: -0.15, eY: -0.72, eRot: 0.14, tail: 'bushy2', tL: 32, tW: 9, tAng: -0.3, eye: 3.1, fluff: 0.5 },
    mischling: { a: 28, rc: 15, rr: 13.8, belly: 20, lw: 7.4, nx: 14, ny: -14.5, hr: 14, sl: 13.5, s0: 7.2, s1: 5.4, ear: 'mix', eL: 17, eW: 10, tail: 'sabre', tL: 25, tW: 6.6, tAng: 0.6, eye: 3.4 }
  };
  const geoCache = {};
  function geo(breed) {
    let g = geoCache[breed];
    if (!g) {
      g = geoCache[breed] = Object.assign({}, D, B[breed] || B.mischling);
      g.name = g.breed = breed;
      g.cy0 = -(g.belly + g.rc * 0.95);                 // standing torso center height
    }
    return g;
  }

  // ---------- shape helpers (all build paths, the caller strokes/fills) ----------
  // Closed smooth curve through a flat point list [x0,y0,x1,y1,…] (Catmull-Rom as béziers).
  let EX = 0;                                          // outline growth while paintX builds its first (outline) pass
  function blob(c, p, k) {
    k = k || 0.18;
    const n = p.length >> 1;
    if (EX) {                                          // push every control point away from the centroid
      let mx0 = 0, my0 = 0;
      for (let i = 0; i < n; i++) { mx0 += p[i * 2]; my0 += p[i * 2 + 1]; }
      mx0 /= n; my0 /= n;
      const q = new Array(n * 2);
      for (let i = 0; i < n; i++) {
        const dx = p[i * 2] - mx0, dy = p[i * 2 + 1] - my0, d = Math.sqrt(dx * dx + dy * dy) || 1;
        q[i * 2] = p[i * 2] + dx / d * EX; q[i * 2 + 1] = p[i * 2 + 1] + dy / d * EX;
      }
      p = q;
    }
    c.moveTo(p[0], p[1]);
    for (let i = 0; i < n; i++) {
      const i0 = ((i + n - 1) % n) * 2, i1 = i * 2, i2 = ((i + 1) % n) * 2, i3 = ((i + 2) % n) * 2;
      c.bezierCurveTo(p[i1] + (p[i2] - p[i0]) * k, p[i1 + 1] + (p[i2 + 1] - p[i0 + 1]) * k,
        p[i2] - (p[i3] - p[i1]) * k, p[i2 + 1] - (p[i3 + 1] - p[i1 + 1]) * k, p[i2], p[i2 + 1]);
    }
    c.closePath();
  }
  // Hull of two circles (tapered capsule): limbs, necks, snouts, tails.
  function cone(c, x1, y1, r1, x2, y2, r2) {
    r1 += EX; r2 += EX;
    const dx = x2 - x1, dy = y2 - y1, d = Math.sqrt(dx * dx + dy * dy);
    if (d <= Math.abs(r1 - r2) + 0.001) {
      const big = r1 >= r2;
      c.moveTo((big ? x1 : x2) + (big ? r1 : r2), big ? y1 : y2);
      c.arc(big ? x1 : x2, big ? y1 : y2, big ? r1 : r2, 0, TAU);
      return;
    }
    const th = Math.atan2(dy, dx), al = Math.acos((r1 - r2) / d);
    c.moveTo(x1 + r1 * cos(th + al), y1 + r1 * sin(th + al));
    c.arc(x1, y1, r1, th + al, th - al + TAU);
    c.arc(x2, y2, r2, th - al, th + al);
    c.closePath();
  }
  function circ(c, x, y, r) { r += EX; c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
  function ell(c, x, y, rx, ry, rot) {
    rx = Math.max(0.01, rx + EX); ry = Math.max(0.01, ry + EX);
    c.moveTo(x + rx * (rot ? cos(rot) : 1), y + (rot ? rx * sin(rot) : 0)); c.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
  }
  // outline pass + fill pass of the current path (union outline for compound paths)
  function paint(c, fill, ol, ow) {
    if (ow > 0) { c.lineWidth = ow * 2; c.strokeStyle = ol; c.stroke(); }
    c.fillStyle = fill; c.fill();
  }
  // Cheaper outline for big compound shapes: build the path twice, first grown by `ow` in the outline
  // color, then at its real size (filling is several times cheaper than stroking curves).
  function paintX(c, build, fill, ol, ow) {
    EX = ow;
    try { c.beginPath(); build(); c.fillStyle = ol; c.fill(); } finally { EX = 0; }
    c.beginPath(); build(); c.fillStyle = fill; c.fill();
  }
  function line(c, x1, y1, x2, y2, w, col) {
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineWidth = w; c.strokeStyle = col; c.stroke();
  }
  // 2-bone IK from (ax,ay) toward (bx,by): returns [jointX, jointY, endX, endY] (end clamped to the reach).
  // side = +1 bends backward for a leg pointing down, -1 forward.
  function ik(ax, ay, bx, by, l1, l2, side) {
    let dx = bx - ax, dy = by - ay;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const dd = clamp(d, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
    const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    dx /= d; dy /= d;
    return [ax + dx * a - dy * h * side, ay + dy * a + dx * h * side, ax + dx * dd, ay + dy * dd];
  }

  // ---------- rig: breed + pose + time → joint targets ----------
  // World space = dog space: ground y = 0, up = negative y, facing +x. Feet are [x, y, angle]
  // (angle 0 = vertical paw, + = pointing forward); legs are solved with IK at draw time.
  function bones(G) {
    if (!G.fdS) {
      G.fdS = -(G.cy0 + G.rc * 0.12) - G.lp;            // shoulder → wrist when standing
      G.hdH = -(G.cy0 + G.rr * 0.02) - G.lm * 0.97;     // hip → hock when standing
    }
  }
  const tipOf = (G) => [G.hr * 0.35 + G.sl + G.s1 * 0.9, G.hr * 0.28 + G.sd * 0.3];   // nose pad, head-local
  // torso tilt for sitting: the shoulder ends up exactly one front-leg length above the ground
  function sitRotOf(G) {
    if (G.sitRot) return G.sitRot;
    const target = -(G.fdS + G.lp) * 0.98, a = G.a, rc = G.rc, rr = G.rr;
    let lo = -1.5, hi = -0.1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2, sy = 0.8 - rr + (1.55 * a - rr) * sin(m) + 0.12 * rc * cos(m);
      if (sy > target) hi = m; else lo = m;
    }
    return (G.sitRot = clamp((lo + hi) / 2, -1.15, G.sitMax || -0.5));
  }
  function tw(R, lx, ly) { return [R.cx + lx * R.cs - ly * R.sn, R.cy + lx * R.sn + ly * R.cs]; }
  function hw(R, lx, ly) { const c = cos(R.ha), s = sin(R.ha); return [R.H[0] + lx * c - ly * s, R.H[1] + lx * s + ly * c]; }
  // one foot step: stance slides back on the ground, swing lifts and carries forward
  function step(u, duty, stride, lift) {
    if (u < duty) return [stride * (0.5 - u / duty), 0, 0];
    const v = (u - duty) / (1 - duty);
    return [stride * (ease(v) - 0.5), -lift * sin(PI * Math.pow(v, 0.85)), sin(PI * v)];
  }

  function rigOf(G, pose, t, o) {
    bones(G);
    const a = G.a, rc = G.rc, rr = G.rr, cy0 = G.cy0, hr = G.hr;
    const R = {
      pose, G, cx: 0, cy: cy0, rot: 0, cs: 1, sn: 0, k: 1.0, kh: 1.04, ha: 0, jaw: 0, tong: 0, closed: false,
      earSw: 0, earFl: 0, shear: 0, tailA: 0.12, tailW: 1, tailGround: false, wob: 0, hind: 'stand', squint: 0,
      S: null, Hp: null, N: null, H: null, fn: null, ff: null, hn: null, hf: null, curl: false
    };
    const torso = (cx, cy, rot) => { R.cx = cx; R.cy = cy; R.rot = rot; R.cs = cos(rot); R.sn = sin(rot); R.S = tw(R, a * 0.55, rc * 0.12); R.Hp = tw(R, -a * 0.6, rr * 0.02); R.N = tw(R, a * 0.72, -rc * 0.55); };
    const head = (kx, ky, dx, dy, ha) => { R.H = [R.N[0] + G.nx * kx + dx, R.N[1] + G.ny * ky + dy]; R.ha = ha; };
    // rump touches the ground when the torso tilts up (sit / beg)
    const sitY = (rot) => 0.8 - rr - (-a + rr) * sin(rot);
    const stand = () => {
      R.fn = [R.S[0] + 1.5, 0, 0]; R.ff = [R.S[0] - 3.5, 0, 0];
      R.hn = [R.Hp[0] - 1.5, 0, 0.2]; R.hf = [R.Hp[0] + 3.2, 0, 0.2];
    };
    const sitHind = () => {
      R.hn = [R.Hp[0] + 14, 0, 1.45]; R.hf = [R.Hp[0] + 8, 0, 1.45]; R.hind = 'fold';
    };
    const w = t * TAU;

    switch (pose) {
      case 'walk': {
        const f = 2.1, ph = t * f, ww = ph * TAU, st = a * 0.78, lf = 3.2 + G.belly * 0.3;
        torso(0, cy0 + 0.9 * sin(2 * ww + 0.5), 0.014 * sin(2 * ww + 1.2));
        R.k = 1.1; R.kh = 1.14;
        const fn = step(frac(ph + 0.25), 0.64, st, lf), ff = step(frac(ph + 0.75), 0.64, st, lf);
        const hn = step(frac(ph), 0.64, st, lf), hf = step(frac(ph + 0.5), 0.64, st, lf);
        R.fn = [R.S[0] + 3 + fn[0], fn[1], -0.25 * fn[2]]; R.ff = [R.S[0] - 3 + ff[0], ff[1], -0.25 * ff[2]];
        R.hn = [R.Hp[0] - 1 + hn[0], hn[1], 0.2 + 0.5 * hn[2]]; R.hf = [R.Hp[0] + 3 + hf[0], hf[1], 0.2 + 0.5 * hf[2]];
        head(1, 1, 1.4 * sin(2 * ww - 0.3), 1.1 * sin(2 * ww + 0.9), 0.04 + 0.03 * sin(2 * ww));
        R.earSw = 0.2 * sin(2 * ww - 1.3); R.tailA = 0.2;
        break;
      }
      case 'run': {
        const f = 3.1, ph = t * f, ww = ph * TAU, st = a * 1.7, lf = 7 + G.belly * 0.45;
        const bob = 0.5 - 0.5 * cos(ww - 0.5);
        torso(0, cy0 + 2 - 6 * bob, -0.12 * sin(ww - 0.5));
        R.k = 1.2; R.kh = 1.3;
        const fn = step(frac(ph), 0.3, st, lf), ff = step(frac(ph + 0.08), 0.3, st, lf);
        const hn = step(frac(ph + 0.5), 0.3, st, lf), hf = step(frac(ph + 0.58), 0.3, st, lf);
        R.fn = [R.S[0] + 5 + fn[0], fn[1], -0.5 * fn[2]]; R.ff = [R.S[0] - 1 + ff[0], ff[1], -0.5 * ff[2]];
        R.hn = [R.Hp[0] - 3 + hn[0], hn[1], 0.1 + 0.8 * hn[2]]; R.hf = [R.Hp[0] + 1 + hf[0], hf[1], 0.1 + 0.8 * hf[2]];
        head(1.12, 0.78, 3 + 2 * sin(ww - 0.5), 2 * sin(ww + 0.4), 0.08 + 0.1 * sin(ww - 0.5));
        R.earSw = 0.55 + 0.25 * sin(2 * ww); R.tailA = -0.15; R.tailW = 0.55;
        break;
      }
      case 'sit': {
        const rot = sitRotOf(G);
        torso(-1, sitY(rot) + 0.5 * sin(t * 2.2), rot);
        R.k = Math.max(1.02, -R.S[1] / (G.fdS + G.lp) * 1.0); R.fn = [R.S[0] + 3.5, 0, 0]; R.ff = [R.S[0] - 2.5, 0, 0]; sitHind();
        head(0.92, 1.12, 0.6 * sin(t * 0.9), 0.4 * sin(t * 2.2 + 0.6), -0.05 + 0.06 * sin(t * 0.7));
        R.tailGround = true;
        break;
      }
      case 'beg': {
        const rot = clamp(sitRotOf(G) - 0.38, -1.3, -0.7), bounce = 1.3 * sin(t * 6);
        torso(-2, sitY(rot) - 1.2 + bounce, rot);
        const pw = 3.5 * sin(t * 9);
        R.fn = [R.S[0] + 12, R.S[1] + 9 + pw, 0.5]; R.ff = [R.S[0] + 6, R.S[1] + 12 - pw, 0.5]; R.k = 1.0;
        sitHind();
        head(0.78, 1.0, 1.5, 0, -0.42 + 0.07 * sin(t * 5)); R.tong = 1;
        R.tailGround = true;
        break;
      }
      case 'lie': {
        torso(0, -rc * 0.93, 0.015 * sin(t * 2));
        R.k = 1.05; R.fn = [R.S[0] + 26, 0, 1.5]; R.ff = [R.S[0] + 21, 0, 1.5];
        R.hn = [R.Hp[0] + 18, 0, 1.45]; R.hf = [R.Hp[0] + 12, 0, 1.45]; R.hind = 'fold';
        head(0.96, 0.62, 0, 0.5 * sin(t * 2), 0.1);
        R.tailGround = true; R.squint = 0.25;
        break;
      }
      case 'sleep': {
        const br = 1 + 0.032 * sin(t * 1.9);
        torso(-1, -rc * 0.9, 0); R.sx = 0.86; R.sy = br;
        R.k = 1.05; R.fn = [R.S[0] + 20, 0, 1.5]; R.ff = [R.S[0] + 15, 0, 1.5];
        R.hn = [R.Hp[0] + 14, 0, 1.45]; R.hf = [R.Hp[0] + 8, 0, 1.45]; R.hind = 'fold';
        R.ha = 0.3;
        { const f = faceOf(G), c = cos(R.ha), s = sin(R.ha), low = Math.max(hr, f.tipX * s + (f.sy + G.s1 * 0.6) * c);
          R.H = [R.N[0] + G.nx * 0.74, 0.6 - low + 0.45 * sin(t * 1.9)]; }
        R.closed = true; R.earSw = 0.5; R.tailWrap = true; R.tailGround = true;
        break;
      }
      case 'dig': {
        torso(0, cy0 - 1.5, 0.34 + 0.03 * sin(t * 18));
        R.k = 1.06; R.kh = 1.16;
        // scratching: a paw sweeps back along the ground, then lifts and swings forward again
        const ds = (off) => { const u = frac(t * 4.6 + off); return u < 0.5 ? [21 - 20 * (u / 0.5), 0] : [1 + 20 * ease((u - 0.5) / 0.5), -9 * sin(PI * (u - 0.5) / 0.5)]; };
        const p1 = ds(0), p2 = ds(0.5);
        R.fn = [R.S[0] + 1 + p1[0], p1[1], 0.35]; R.ff = [R.S[0] - 3 + p2[0], p2[1], 0.35];
        R.hn = [R.Hp[0] - 4, 0, 0.1]; R.hf = [R.Hp[0] + 3, 0, 0.1];
        head(1.0, 0.5, 5 + 1.5 * sin(t * 9.2), 8 + 1.6 * sin(t * 9.2 + 1), 0.85);
        R.earSw = 0.25 * sin(t * 9.2 + 2); R.tailA = 0.5; R.tailW = 1.4;
        break;
      }
      case 'eat': {
        torso(0, cy0 + 1.2, 0.17);
        R.k = 1.04; stand();
        R.fn = [R.S[0] + 4.5, 0, 0]; R.ff = [R.S[0] - 1.5, 0, 0];
        const chew = sin(t * 11);
        R.ha = 0.95 + 0.05 * chew; R.jaw = 0.18 + 0.2 * Math.max(0, chew);
        // the nose lands where the standing nose is, just above the ground (bowl rim)
        const tip = tipOf(G), c = cos(R.ha), s = sin(R.ha), n0 = standNose(G);
        R.H = [n0[0] - 2 - (tip[0] * c - tip[1] * s), -9 - (tip[0] * s + tip[1] * c) + 0.7 * chew];
        R.tong = o.tongue ? 1 : 0; R.lap = !!o.tongue;
        R.tailA = 0.35;
        break;
      }
      case 'shake': {
        torso(0, cy0 + 1, 0);
        R.k = 1.1; stand();
        R.shear = 0.2 * sin(t * 37); R.wob = sin(t * 37 + PI);
        head(1, 0.96, 2.2 * sin(t * 37 + PI), 0.5, 0.1 * sin(t * 37 + 0.8));
        R.earFl = 1.15 * sin(t * 37 + 1.2); R.tailW = 1.6; R.squint = 0.8;
        break;
      }
      case 'squat': {
        torso(-1, cy0 + 5.5 + 0.35 * sin(t * 26), -0.3);
        R.k = 1.04; R.kh = 1.34;
        R.fn = [R.S[0] + 1, 0, 0]; R.ff = [R.S[0] - 5, 0, 0];
        R.hn = [R.Hp[0] + 2, 0, 0.25]; R.hf = [R.Hp[0] + 8, 0, 0.25];
        head(0.98, 0.92, 0.8, 1.6, 0.02); R.tailA = 1.15; R.tailW = 0.25; R.squint = 0.55;
        break;
      }
      case 'jump': {
        torso(0, cy0 + 5, -0.34);
        R.k = 1.08; R.kh = 1.3;
        const fl = 1.8 * sin(t * 12);
        R.fn = [R.S[0] + 22, R.S[1] + 14 + fl, -0.4]; R.ff = [R.S[0] + 15, R.S[1] + 20 - fl, -0.4];
        R.hn = [R.Hp[0] - 17, R.Hp[1] + 15 - fl, -0.7]; R.hf = [R.Hp[0] - 10, R.Hp[1] + 21 + fl, -0.7];
        head(1.06, 0.86, 2.5, -0.8, -0.18);
        R.earSw = 0.7; R.tailA = 0.35; R.tailW = 0.6; R.tong = o.tongue ? 1 : 0.6;
        break;
      }
      default: {                                           // stand
        torso(0, cy0 + 0.5 * sin(t * 2.3), 0);
        stand();
        head(1, 1, 0.5 * sin(t * 0.8), 0.5 * sin(t * 2.3 + 0.6), 0.03 + 0.03 * sin(t * 0.8));
        R.earSw = 0.05 * sin(t * 1.3);
      }
    }
    // the sleep pose is drawn by its own routine and ignores most of this
    return R;
  }

  // the standing rig is the reference for points(): cached per breed, never animated
  const standCache = {};
  function standRig(G) {
    let R = standCache[G.name];
    if (!R) R = standCache[G.name] = rigOf(G, 'stand', 0, {});
    return R;
  }
  function standNose(G) {
    const R = standRig(G), tip = tipOf(G), c = cos(R.ha), s = sin(R.ha);
    return [R.H[0] + tip[0] * c - tip[1] * s, R.H[1] + tip[0] * s + tip[1] * c];
  }

  // ---------- side view: body parts ----------
  const OW = 1.15;                                   // outline half-width (dog space)

  function solveFront(G, R, ft) {
    const phi = ft[2], wx = ft[0] - sin(phi) * G.lp, wy = ft[1] - cos(phi) * G.lp, L = G.fdS * R.k * 0.5;
    const r = ik(R.S[0], R.S[1], wx, wy, L, L, 1);
    return [R.S[0], R.S[1], r[0], r[1], r[2], r[3], r[2] + sin(phi) * G.lp, r[3] + cos(phi) * G.lp, phi];
  }
  function solveHind(G, R, ft) {
    const phi = ft[2], hx = ft[0] - sin(phi) * G.lm, hy = ft[1] - cos(phi) * G.lm, L = G.hdH * R.kh;
    const r = ik(R.Hp[0], R.Hp[1], hx, hy, L * 0.52, L * 0.5, -1);
    return [R.Hp[0], R.Hp[1], r[0], r[1], r[2], r[3], r[2] + sin(phi) * G.lm, r[3] + cos(phi) * G.lm, phi];
  }
  // leg joints [x0,y0, x1,y1, x2,y2, x3,y3, phi] → path (tapered cones + a flat paw)
  function legPath(c, G, j, front) {
    const lw = G.lw, r0 = lw * (front ? 0.95 : 1.28), r1 = lw * (front ? 0.82 : 0.92), r2 = lw * 0.58, r3 = lw * 0.62;
    cone(c, j[0], j[1], r0, j[2], j[3], r1);
    cone(c, j[2], j[3], r1, j[4], j[5], r2);
    cone(c, j[4], j[5], r2, j[6], j[7], r3);
    ell(c, j[6] + lw * 0.3, j[7] - lw * 0.28, lw * 0.82, lw * 0.5, clamp(j[8] - 0.3, -0.7, 0.7) * 0.5);
  }

  function torsoPts(G, br) {
    const a = G.a, rc = G.rc, rr = G.rr, tk = G.tuck;
    return [
      -a - 1.5, rr * 0.05 * br, -a + rr * 0.32, -rr * 0.84 * br, -a * 0.18, -rc * 0.97 * br, a * 0.42, -rc * 1.0 * br,
      a - rc * 0.12, -rc * 0.7 * br, a + 1.5, rc * 0.08 * br, a - rc * 0.36, rc * 0.84 * br, a * 0.24, rc * 0.98 * br,
      -a * 0.3, rc * (0.98 - tk * 0.5) * br, -a + rr * 0.38, rr * 0.82 * br
    ];
  }
  // torso in its own (rotated) frame
  function torsoPath(c, G, R, br) {
    c.save(); c.translate(R.cx, R.cy); c.rotate(R.rot);
    blob(c, torsoPts(G, br), 0.19);
    c.restore();
  }

  // Tail: chain of cones along a curve; returns nothing, builds the path (or paints the special ones).
  function tailAnchor(R) { return tw(R, -R.G.a * 0.93, -R.G.rr * 0.5); }
  function tailChain(c, G, R, t, o, wag, pts) {
    const root = tailAnchor(R), n = 6, L = G.tL;
    const ty = G.tail, wi = (7 + 16 * wag) * t, amp = (0.07 + 0.5 * wag) * R.tailW;
    let e = G.tAng + R.tailA, bend = 0.5, w0 = G.tW, w1 = G.tW * 0.45;
    if (R.tailWrap && ty !== 'curl' && ty !== 'stub') {            // curled up asleep: around the belly
      const r0 = w0 * 0.5, r1 = w1 * 0.5;
      pts.length = 0;
      const q0 = 0.8;
      pts.push(root[0], root[1], r0 * q0, root[0] - 5, root[1] + 4, r0 * q0 * 0.95, root[0] - 7, -10, r0 * q0 * 0.9, root[0] - 4, -4, r0 * q0 * 0.85,
        root[0] + 4, -2.8, r0 * q0 * 0.7, -G.a * 0.5, -4.5, r1 * q0, -G.a * 0.36, -8.5 + 0.3 * sin(t * 1.9), r1 * q0 * 0.8);
      for (let i = 0; i < pts.length - 3; i += 3) cone(c, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5]);
      return;
    }
    if (ty === 'otter') { bend = -0.15; w1 = G.tW * 0.5; }
    else if (ty === 'bushy2') { bend = 0.55; w0 = G.tW * 0.8; w1 = G.tW * 0.5; }
    else if (ty === 'bushy') { e = 1.3 + R.tailA * 0.4; bend = 2.4; w0 = G.tW * 0.75; w1 = G.tW * 0.55; }
    else if (ty === 'pom') { bend = 0.35; w1 = G.tW; }
    if (R.tailGround) { e = -0.35; bend = 0.35; }
    let psi = PI + R.rot + e, x = root[0], y = root[1], seg = L / n;
    pts.length = 0;
    pts.push(x, y, w0 * 0.5);
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      psi += bend / n * (R.tailGround ? 1 : 1) + (amp * (sin(wi - 0.65 * i) - (i > 1 ? sin(wi - 0.65 * (i - 1)) : 0))) * (R.tailGround ? 0.5 : 1);
      x += cos(psi) * seg; y += sin(psi) * seg;
      let r = lerp(w0, w1, k) * 0.5;
      if (ty === 'bushy' || ty === 'bushy2') r *= (ty === 'bushy' ? 1.15 : 1.1) * (1 + 0.1 * sin(i * 2.4)) * (1 + 0.25 * sin(PI * k));
      if (R.tailGround && y > -r) y = -r;
      pts.push(x, y, r);
    }
    for (let i = 0; i < pts.length - 3; i += 3) cone(c, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5]);
  }
  const tailPts = [];
  const tailBehind = (ty) => ty !== 'bushy' && ty !== 'curl';

  // scalloped puff (pompom / ear / curls): ring of circles around an ellipse
  function puff(c, x, y, rx, ry, n, rr, rot) {
    const cr = rot ? cos(rot) : 1, sr = rot ? sin(rot) : 0;
    for (let i = 0; i < n; i++) {
      const an = i / n * TAU, px = cos(an) * rx, py = sin(an) * ry;
      circ(c, x + px * cr - py * sr, y + px * sr + py * cr, rr);
    }
    ell(c, x, y, rx, ry, rot);
  }

  // ---------- side view: head, ears, face ----------
  function tri(c, x1, y1, x2, y2, x3, y3) {          // triangle, always clockwise (keeps compound fills solid)
    if (EX) {
      const gx = (x1 + x2 + x3) / 3, gy = (y1 + y2 + y3) / 3, g = (x, y, k) => { const dx = x - gx, dy = y - gy, d = Math.sqrt(dx * dx + dy * dy) || 1; return [x + dx / d * EX * k, y + dy / d * EX * k]; };
      const a = g(x1, y1, 1.5), b = g(x2, y2, 1.5), e = g(x3, y3, 1.5);
      x1 = a[0]; y1 = a[1]; x2 = b[0]; y2 = b[1]; x3 = e[0]; y3 = e[1];
    }
    const cr = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
    c.moveTo(x1, y1);
    if (cr >= 0) { c.lineTo(x2, y2); c.lineTo(x3, y3); } else { c.lineTo(x3, y3); c.lineTo(x2, y2); }
    c.closePath();
  }
  // head-local landmarks (origin = cranium center, +x = nose direction)
  function faceOf(G) {
    const hr = G.hr, sy = hr * 0.28 + G.sd * 0.3, sx = hr * 0.35 + G.sl;
    return {
      sx, sy, tipX: sx + G.s1,                        // snout tip center / extreme
      padX: sx + G.s1 * 0.55, padY: sy - G.s1 * 0.4,  // nose pad
      mouthX: hr * 0.5, mouthY: hr * 0.28 + G.s0 * 0.5, // mouth corner
      botX: sx + G.s1 * 0.35, botY: sy + G.s1 * 0.6,   // snout underside at the front
      ex: hr * G.ex, ey: hr * G.ey
    };
  }
  art._face = faceOf;

  function headPath(c, G, fl) {
    const hr = G.hr, f = faceOf(G);
    circ(c, 0, 0, hr);
    cone(c, hr * 0.35, hr * 0.28, G.s0, f.sx, f.sy, G.s1);
    if (G.cheek) circ(c, -hr * 0.05, hr * 0.42, hr * G.cheek);
    if (G.topknot) puff(c, hr * 0.02, -hr * 0.82, hr * 0.74, hr * 0.5, 10, hr * 0.3, 0);
    if (fl > 0.3) {                                   // cheek ruff
      tri(c, -hr * 0.2, hr * 0.62, hr * 0.28, hr * 0.78, -hr * 0.55, hr * 1.18);
      tri(c, -hr * 0.55, hr * 0.38, -hr * 0.2, hr * 0.7, -hr * 1.05, hr * 0.78);
      tri(c, -hr * 0.9, hr * 0.0, -hr * 0.7, hr * 0.55, -hr * 1.28, hr * 0.32);
    }
  }
  function jawPath(c, G, f) {
    const hr = G.hr;
    cone(c, hr * 0.28, hr * 0.5, G.s0 * 0.74, f.sx - G.s1 * 0.12, f.sy + G.s1 * 0.38, G.s1 * 0.66);
  }

  // ear base in head space + hanging/erect shapes
  function earPath(c, G, kind, cut) {
    const w = G.eW, l = G.eL;
    switch (kind) {
      case 'erect': blob(c, [-w * 0.5, 1.5, -w * 0.12, -l * 0.62, w * 0.04, -l, w * 0.5, 1.5, 0, 3.2], 0.15); break;
      case 'semi': blob(c, [-w * 0.5, 1.5, -w * 0.2, -l * 0.7, w * 0.28, -l * 0.95, w * 0.62, -l * 0.58, w * 0.5, 1.5, 0, 3.2], 0.17); break;
      case 'button': blob(c, [-w * 0.5, -1, w * 0.1, -2.5, w * 0.58, l * 0.35, w * 0.12, l * 0.95, -w * 0.35, l * 0.55], 0.2); break;
      case 'curl': puff(c, 0, l * 0.5, w * 0.5, l * 0.5, 9, w * 0.22, 0); break;
      default: blob(c, [-w * 0.5, -1.5, w * 0.1, -2.5, w * 0.58, l * 0.3, w * 0.42, l * 0.8, -w * 0.05, l, -w * 0.5, l * 0.6], 0.2);   // flop / long
    }
  }
  const isUp = (k) => k === 'erect' || k === 'semi';

  function drawEar(c, G, R, P, kind, far, flip, o) {
    const hr = G.hr, up = isUp(kind);
    let th = up ? G.eRot - R.earSw + R.earFl * 0.5 : 0.18 + R.earSw * 0.9 + R.earFl * 0.6;
    if (kind === 'button') th = -0.35 + R.earSw * 0.6;
    let bx = hr * G.eX, by = hr * G.eY;
    if (far) { bx += up ? hr * 0.34 : hr * 0.12; by += up ? -hr * 0.05 : -hr * 0.1; th += up ? 0.12 : -0.1; }
    const body = (far ? P.far : (G.ear === 'long' || (G.breed === 'dackel')) ? P.earC : P.earC), edge = P.ol;
    paintX(c, () => { c.save(); c.translate(bx, by); c.rotate(th); earPath(c, G, kind); c.restore(); }, far ? P.earFar : P.earC, P.ol, OW);
    if (up && !far) {                                   // inner ear
      c.beginPath();
      c.save(); c.translate(bx, by); c.rotate(th); c.scale(0.58, 0.72); c.translate(0, -1.5);
      earPath(c, G, kind);
      c.restore();
      c.fillStyle = P.earIn; c.fill();
    }
    if (kind === 'curl') {                              // curls
      c.save(); c.translate(bx, by); c.rotate(th);
      c.strokeStyle = P.shade; c.lineWidth = 0.9; c.beginPath();
      for (let i = 0; i < 3; i++) { const ax = -1 + i * 2.2, ay = G.eL * (0.3 + i * 0.2), ar = G.eW * 0.16; c.moveTo(ax + ar * cos(0.5), ay + ar * sin(0.5)); c.arc(ax, ay, ar, 0.5, 4.2); }
      c.stroke();
      c.restore();
    }
  }

  function tongueShape(c, G, f, m, t, lap) {
    // hangs from the mouth; panting sway, or flicks forward when lapping
    const sw = sin(t * 13);
    if (lap) {
      cone(c, f.mouthX + 3, f.mouthY + 2.5, 2.4, f.tipX - G.s1 * 0.2 + 3.5 + 2 * sw, f.botY + 1.2 + 1.6 * sw, 2.8);
    } else {
      const len = 5 + 8 * m + 1.1 * sw;
      cone(c, f.mouthX + 3.2, f.mouthY + 1.5, 2.3, f.mouthX + 6 + m * 2.2, f.mouthY + 1.5 + len, 3.2);
    }
  }

  // The whole head: far ear, jaw, skull+snout, markings, near ear, face.
  function drawHead(c, G, R, P, o, t, dog, dirt) {
    const hr = G.hr, f = faceOf(G), br = G.breed, kind = G.ear;
    c.save();
    c.translate(R.H[0], R.H[1]); c.rotate(R.ha);
    const sleeping = R.pose === 'sleep';
    const jaw = Math.max(R.jaw, (o.tongue || R.tong) && !sleeping ? 0.3 + 0.12 * sin(t * 13) : 0);
    const hasTongue = !sleeping && (o.tongue || R.tong > 0);
    const flip = (hash(dog && (dog.uid || dog.name) || 'x') & 1) === 1;
    // far ear first
    if (kind === 'mix') drawEar(c, G, R, P, flip ? 'semi' : 'flop', true, flip, o);
    else drawEar(c, G, R, P, kind === 'long' ? 'flop' : kind, true, flip, o);
    // lower jaw (rotates open) with the dark mouth inside
    if (jaw > 0.02) {
      const hx = hr * 0.45, hy = hr * 0.5, ja = jaw * 0.6;
      c.beginPath();
      circ(c, 0, 0, 0.01);
      c.moveTo(hx, hy - 2); c.lineTo(f.tipX - 1, f.sy + G.s1 * 0.5);
      c.save(); c.translate(hx, hy); c.rotate(ja); c.translate(-hx, -hy);
      c.lineTo(f.tipX - 1, f.sy + G.s1 * 0.5 + 1); c.restore();
      c.closePath(); c.fillStyle = P.mouth; c.fill();
      paintX(c, () => { c.save(); c.translate(hx, hy); c.rotate(ja); c.translate(-hx, -hy); jawPath(c, G, f); c.restore(); }, P.jawC, P.ol, OW);
    }
    if (hasTongue && jaw > 0.02) {
      c.beginPath(); tongueShape(c, G, f, jaw, t, R.lap); paint(c, P.tongue, P.tongueD, 0.8);
    }
    // skull + snout
    paintX(c, () => headPath(c, G, R.fl), P.f, P.ol, OW);
    // markings and shading, clipped to the head
    c.save();
    c.beginPath(); headPath(c, G, R.fl); c.clip();
    headMarks(c, G, R, P, dog);
    if (dirt > 0.3) mudHead(c, G, dog, dirt);
    c.restore();
    // near ear on top of the skull
    if (kind === 'mix') drawEar(c, G, R, P, flip ? 'flop' : 'semi', false, flip, o);
    else drawEar(c, G, R, P, kind === 'long' ? 'flop' : kind, false, flip, o);
    faceDetails(c, G, R, P, o, t, f, jaw);
    c.restore();
  }

  function faceDetails(c, G, R, P, o, t, f, jaw) {
    const hr = G.hr, er = G.eye, sleeping = R.pose === 'sleep';
    // cheek blush
    if (!R.lod) { c.fillStyle = 'rgba(255,120,140,' + (P.dark ? 0.16 : 0.26) + ')';
    c.beginPath(); ell(c, f.ex - hr * 0.25, f.ey + hr * 0.62, hr * 0.24, hr * 0.15, 0); c.fill(); }
    // nose
    c.beginPath(); ell(c, f.padX, f.padY, G.s1 * 0.78, G.s1 * 0.62, 0.12);
    c.fillStyle = P.nose; c.fill();
    c.fillStyle = P.noseHi; c.beginPath(); ell(c, f.padX - G.s1 * 0.18, f.padY - G.s1 * 0.22, G.s1 * 0.28, G.s1 * 0.16, 0.12); c.fill();
    // mouth
    if (jaw < 0.05) {
      c.beginPath(); c.moveTo(f.botX, f.botY - 0.8);
      c.quadraticCurveTo((f.botX + f.mouthX) * 0.5, f.botY + 0.9, f.mouthX, f.mouthY - 0.2);
      c.quadraticCurveTo(f.mouthX - 1.2, f.mouthY - 1.6, f.mouthX - 2.2, f.mouthY - 2.4);
      c.lineWidth = 1.05; c.strokeStyle = P.dark ? 'rgba(255,255,255,.35)' : 'rgba(40,20,14,.7)'; c.lineCap = 'round'; c.stroke();
    }
    // eye
    const ex = f.ex, ey = f.ey;
    const closed = sleeping || R.closed || R.blink;
    if (closed) {
      c.beginPath(); c.moveTo(ex - er * 0.95, ey + 0.2); c.quadraticCurveTo(ex, ey + er * (sleeping ? 0.95 : 0.7), ex + er * 0.95, ey + 0.2);
      c.lineWidth = 1.3; c.strokeStyle = P.dark ? 'rgba(255,255,255,.55)' : P.eye; c.lineCap = 'round'; c.stroke();
    } else {
      const sq = clamp(R.squint, 0, 1), ry = er * (1 - 0.55 * sq);
      if (G.blue) {
        c.beginPath(); ell(c, ex, ey, er * 1.05, ry * 1.05, 0); c.fillStyle = '#2f77b8'; c.fill();
        c.beginPath(); ell(c, ex, ey + ry * 0.12, er * 0.82, ry * 0.8, 0); c.fillStyle = '#8fd6ff'; c.fill();
        c.beginPath(); ell(c, ex + 0.2, ey, er * 0.48, ry * 0.52, 0); c.fillStyle = '#10151c'; c.fill();
      } else {
        c.beginPath(); ell(c, ex, ey, er, ry, 0); c.fillStyle = P.eye; c.fill();
        c.beginPath(); ell(c, ex + 0.1, ey + ry * 0.45, er * 0.62, ry * 0.4, 0); c.fillStyle = 'rgba(190,120,70,.55)'; c.fill();
      }
      c.fillStyle = '#ffffff';
      c.beginPath(); ell(c, ex - er * 0.3, ey - ry * 0.34, er * 0.38, er * 0.38 * (ry / er), 0); c.fill();
      if (!R.lod) { c.beginPath(); ell(c, ex + er * 0.38, ey + ry * 0.38, er * 0.17, er * 0.17 * (ry / er), 0); c.fill(); }
      if (sq > 0.05) {                                     // upper lid
        c.beginPath(); c.moveTo(ex - er * 1.1, ey - ry * 0.1); c.quadraticCurveTo(ex, ey - ry * 1.5, ex + er * 1.1, ey - ry * 0.1);
        c.lineWidth = 1.2; c.strokeStyle = P.dark ? 'rgba(255,255,255,.4)' : P.ol; c.stroke();
      }
    }
    if (P.hasBrow) {                                       // tan / white eyebrow spot
      c.fillStyle = P.browC; c.beginPath(); ell(c, ex + 0.5, ey - er * 1.7, er * 0.62, er * 0.4, -0.2); c.fill();
    }
  }

  // ---------- palette extras per breed (ears, muzzle, brows) ----------
  function pal(dog, wet) {
    const p = palOf(dog, wet);
    if (p.earC) return p;
    const br = breedOf(dog), f = p.raw, f2 = p.raw2;
    const tanPoint = p.dark && !p.dark2 && lum(f2) > lum(f) + 0.15;   // black-and-tan style coats
    const f2dark = lum(f2) < lum(f) - 0.12;                           // markings darker than the coat
    p.tanPoint = tanPoint; p.f2dark = f2dark;
    let ear = p.f, muz = p.f, brow = null, inner = p.pink;
    switch (br) {
      case 'dackel': ear = tanPoint ? p.f : p.f2; if (tanPoint) brow = p.f2; break;
      case 'labrador': ear = p.f2; break;
      case 'mops': ear = p.f2; muz = p.f2; break;
      case 'husky': ear = p.f; muz = p.f2; brow = p.f2; inner = p.f2L; break;
      case 'corgi': ear = p.f; muz = p.f2; inner = '#f6b2b8'; break;
      case 'pudel': ear = p.f; inner = p.pink; break;
      case 'schaefer': ear = f2dark ? p.f2 : p.f; muz = f2dark ? p.f2 : p.f; inner = f2dark ? '#4a3430' : p.pink; break;
      default: ear = p.f2; inner = p.pink;
    }
    p.earC = ear; p.jawC = muz; p.browC = brow; p.earIn = inner; p.muzC = muz;
    p.earFar = br === 'husky' || br === 'corgi' || br === 'schaefer' ? p.fD : css(sh(hex2(ear), 0.8));
    p.hasBrow = !!brow;
    return p;
  }
  // earC may already be a css string → parse back for shading
  function hex2(col) {
    if (col.charAt(0) === '#') return hex(col);
    const m = col.match(/\d+/g);
    return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
  }

  // ---------- mud, drips, shadow ----------
  const mudCache = {};
  function mudOf(dog) {
    const key = String(dog && (dog.uid || dog.name) || 'x');
    let m = mudCache[key];
    if (!m) {
      if (Object.keys(mudCache).length > 48) for (const k in mudCache) delete mudCache[k];
      const r = WW.rng(hash('mud' + key)), list = [];
      for (let i = 0; i < 9; i++) {
        const pts = [], n = 7, base = 2.6 + r() * 3.4;
        for (let k = 0; k < n; k++) { const an = k / n * TAU, rad = base * (0.7 + r() * 0.6); pts.push(cos(an) * rad, sin(an) * rad * 0.85); }
        list.push({ x: r(), y: r(), pts, s: 0.8 + r() * 0.5 });
      }
      m = mudCache[key] = list;
    }
    return m;
  }
  function mudBlob(c, m, x, y, k, al) {
    c.save(); c.translate(x, y); c.scale(m.s * k, m.s * k);
    c.beginPath(); blob(c, m.pts, 0.2);
    c.fillStyle = 'rgba(104,70,40,' + al.toFixed(3) + ')'; c.fill();
    c.lineWidth = 0.7; c.strokeStyle = 'rgba(66,40,22,' + (al * 0.55).toFixed(3) + ')'; c.stroke();
    c.beginPath(); c.save(); c.translate(-0.8, -0.8); c.scale(0.5, 0.5); blob(c, m.pts, 0.2); c.restore();
    c.fillStyle = 'rgba(150,108,66,' + (al * 0.5).toFixed(3) + ')'; c.fill();
    c.restore();
  }
  function mudBody(c, G, dog, dirt) {            // inside the torso frame
    const list = mudOf(dog), a = G.a, rc = G.rc;
    for (let i = 0; i < list.length; i++) {
      const al = clamp(dirt * 9 - i, 0, 1) * 0.86;
      if (al <= 0) break;
      const m = list[i];
      mudBlob(c, m, lerp(-a * 0.85, a * 0.75, m.x), lerp(-rc * 0.35, rc * 0.95, m.y), 1, al);
    }
  }
  function mudHead(c, G, dog, dirt) {
    const list = mudOf(dog), hr = G.hr;
    mudBlob(c, list[0], hr * 0.1, -hr * 0.35, 0.9, clamp((dirt - 0.3) * 3, 0, 1) * 0.85);
    if (dirt > 0.55) mudBlob(c, list[1], hr * 0.65, hr * 0.3, 0.8, clamp((dirt - 0.55) * 3, 0, 1) * 0.85);
  }
  function drips(c, G, R, wet, t, f) {
    const n = Math.round(wet * 4);
    if (n <= 0) return;
    c.fillStyle = 'rgba(165,220,255,.92)';
    for (let i = 0; i < n; i++) {
      const u = frac(t * 0.85 + i * 0.29), x = R.cx + lerp(-G.a * 0.6, G.a * 0.7, ((i * 0.37) % 1)), y0 = R.cy + G.rc * 0.9;
      const dist = Math.max(4, -y0), y = y0 + u * u * dist;
      if (u > 0.96) continue;
      c.beginPath(); c.arc(x, y, 1.3, 0, TAU); c.moveTo(x - 1.1, y - 0.5); c.lineTo(x, y - 3.4); c.lineTo(x + 1.1, y - 0.5); c.fill();
    }
    // chin drop
    const u = frac(t * 0.9 + 0.5), hp = hw(R, f.tipX - 3, f.botY + 1), y = hp[1] + u * u * Math.max(6, -hp[1]);
    if (u < 0.95) { c.beginPath(); c.arc(hp[0], y, 1.2, 0, TAU); c.moveTo(hp[0] - 1, y - 0.4); c.lineTo(hp[0], y - 3); c.lineTo(hp[0] + 1, y - 0.4); c.fill(); }
  }
  function groundShadow(c, G, pose) {
    const low = pose === 'lie' || pose === 'sleep', rx = G.a + (low ? 10 : 16), ry = low ? 5 : 5.8;
    c.fillStyle = 'rgba(24,18,36,.13)'; c.beginPath(); ell(c, 4, 0.6, rx * 1.12, ry * 1.25, 0); c.fill();
    c.fillStyle = 'rgba(24,18,36,.17)'; c.beginPath(); ell(c, 4, 0.8, rx * 0.82, ry * 0.85, 0); c.fill();
  }
  // collar around the neck (default red, `collar` option recolors; false hides it)
  function collar(c, G, R, col, P) {
    const N0 = tw(R, G.a * 0.78, -G.rc * 0.2), H = R.H;
    const k = 0.46, cx = lerp(N0[0], H[0], k), cy = lerp(N0[1], H[1], k);
    const dx = H[0] - N0[0], dy = H[1] - N0[1], d = Math.sqrt(dx * dx + dy * dy) || 1;
    const nr = lerp(G.rc * G.neckR, G.hr * 0.78, k) - 1.0, nxv = -dy / d, nyv = dx / d;       // across the neck
    c.beginPath(); c.moveTo(cx + nxv * nr, cy + nyv * nr); c.lineTo(cx - nxv * nr, cy - nyv * nr);
    c.lineWidth = 3.6 + OW; c.strokeStyle = P.dark ? 'rgba(255,255,255,.3)' : 'rgba(70,24,24,.7)'; c.stroke();
    c.lineWidth = 3.6; c.strokeStyle = col; c.stroke();
    const tx = cx - nxv * nr * 0.2, ty = cy + nyv * nr * 0.9;                                 // tag below the neck line
    c.fillStyle = '#9a6e10'; c.beginPath(); c.arc(tx, ty, 2.3, 0, TAU); c.fill();
    c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(tx, ty, 1.7, 0, TAU); c.fill();
  }
  art._collarAt = function (breed) {                  // anchor math shared with points()
    const G = geo(breed), R = standRig(G), N0 = tw(R, G.a * 0.78, -G.rc * 0.2), k = 0.46;
    return [lerp(N0[0], R.H[0], k), lerp(N0[1], R.H[1], k)];
  };

  // ---------- markings (head + body), clipped by the caller ----------
  function headMarks(c, G, R, P, dog) {
    const hr = G.hr, f = faceOf(G), br = G.breed;
    if (!R.lod) { c.fillStyle = P.shade; c.beginPath(); ell(c, -hr * 0.62, hr * 0.66, hr * 0.85, hr * 0.62, 0); c.fill(); }
    switch (br) {
      case 'dackel':
        if (P.tanPoint) {
          c.fillStyle = P.f2;
          c.beginPath(); ell(c, f.sx - G.sl * 0.1, f.sy + G.s1 * 0.25, G.sl * 0.8, G.s0 * 1.05, 0); c.fill();
          c.beginPath(); ell(c, hr * 0.15, hr * 0.66, hr * 0.38, hr * 0.28, 0); c.fill();
        }
        break;
      case 'mops':
        c.fillStyle = P.f2; c.beginPath(); ell(c, hr * 0.66, hr * 0.3, hr * 0.9, hr * 0.62, 0); c.fill();
        c.strokeStyle = P.shade; c.lineWidth = 0.9; c.lineCap = 'round'; c.beginPath();
        for (let i = 0; i < 2; i++) { const ay = -hr * 0.62 + i * 3.2, ar = hr * 0.42; c.moveTo(hr * 0.12 + ar * cos(3.75), ay + ar * sin(3.75)); c.arc(hr * 0.12, ay, ar, 3.75, 5.0); }
        c.stroke();
        break;
      case 'husky':
        c.fillStyle = P.f2; c.beginPath(); ell(c, hr * 0.5, hr * 0.7, hr * 1.1, hr * 0.5, 0); c.fill();
        c.beginPath(); ell(c, hr * 0.95, hr * 0.12, hr * 0.62, hr * 0.2, 0.15); c.fill();                // snout bridge
        break;
      case 'corgi':
        c.fillStyle = P.f2; c.beginPath(); ell(c, hr * 0.6, hr * 0.7, hr * 1.1, hr * 0.5, 0); c.fill();
        c.beginPath(); ell(c, hr * 0.62, -hr * 0.02, hr * 0.62, hr * 0.13, -0.3); c.fill();               // blaze
        break;
      case 'schaefer':
        c.fillStyle = P.f2dark ? P.f2 : P.f2La45;
        c.beginPath(); ell(c, f.sx - G.sl * 0.1, f.sy + 0.5, G.sl * 0.98, G.s0 * 1.12, 0); c.fill();
        break;
      case 'mischling': {
        const h = hash(dog && (dog.uid || dog.name) || 'x');
        c.fillStyle = P.f2;
        c.beginPath(); ell(c, f.ex + ((h & 4) ? -0.5 : 0), f.ey, hr * 0.4, hr * 0.38, 0.2); c.fill();
        if (h & 8) { c.beginPath(); ell(c, -hr * 0.3, -hr * 0.55, hr * 0.55, hr * 0.38, 0.5); c.fill(); }
        break;
      }
      default: break;
    }
    if (!R.lod) { c.fillStyle = 'rgba(255,255,255,.17)'; c.beginPath(); ell(c, hr * 0.05, -hr * 0.6, hr * 0.62, hr * 0.24, -0.12); c.fill(); }
  }

  function bodyMarks(c, G, R, P, dog, dirt, wet, t) {
    const a = G.a, rc = G.rc, rr = G.rr, br = G.breed;
    c.fillStyle = P.f2;
    switch (br) {
      case 'dackel':
        if (P.tanPoint) {
          c.beginPath(); ell(c, a * 0.92, rc * 0.45, rc * 0.55, rc * 0.62, 0); c.fill();
          c.beginPath(); ell(c, -a * 0.98, rr * 0.45, rr * 0.55, rr * 0.5, 0); c.fill();
        } else { c.fillStyle = P.f2a40; c.beginPath(); ell(c, -a * 0.05, -rc * 0.78, a * 0.92, rc * 0.34, 0); c.fill(); }
        break;
      case 'husky':
        c.beginPath(); ell(c, a * 0.15, rc * 1.08, a * 1.2, rc * 0.55, 0); c.fill();
        c.beginPath(); ell(c, a * 0.98, rc * 0.3, rc * 0.55, rc * 0.78, 0); c.fill();
        break;
      case 'corgi':
        c.beginPath(); ell(c, a * 0.05, rc * 1.1, a * 1.25, rc * 0.62, 0); c.fill();
        c.beginPath(); ell(c, a * 1.0, rc * 0.25, rc * 0.72, rc * 0.95, 0); c.fill();
        break;
      case 'pudel': {
        c.strokeStyle = P.shade; c.lineWidth = 0.9; c.lineCap = 'round'; c.beginPath();
        for (let i = 0; i < 11; i++) {
          const x = lerp(-a * 0.9, a * 0.9, (i * 0.61803) % 1), y = lerp(-rc * 0.85, rc * 0.7, (i * 0.37) % 1);
          c.moveTo(x + 2.6 * cos(0.3), y + 2.6 * sin(0.3)); c.arc(x, y, 2.6, 0.3, 3.9);
        }
        c.stroke();
        break;
      }
      case 'schaefer':
        c.fillStyle = P.f2dark ? P.f2 : P.f2a50;
        c.beginPath(); blob(c, [-a * 1.15, -rr * 0.2, -a * 0.8, -rr * 1.2, -a * 0.1, -rc * 1.25, a * 0.6, -rc * 1.25, a * 0.92, -rc * 0.8,
          a * 0.66, -rc * 0.1, a * 0.2, rc * 0.28, -a * 0.35, rc * 0.4, -a * 0.8, rr * 0.1], 0.2); c.fill();
        break;
      case 'mischling': {
        const r = WW.rng(hash('patch' + (dog && (dog.uid || dog.name) || 'x')));
        for (let i = 0; i < 4; i++) {
          const x = lerp(-a * 0.8, a * 0.75, r()), y = lerp(-rc * 0.55, rc * 0.5, r()), rx = a * (0.18 + r() * 0.25), ry = rc * (0.3 + r() * 0.35);
          c.beginPath(); ell(c, x, y, rx, ry, r() * 3); c.fill();
        }
        break;
      }
      default: break;
    }
    if (!R.lod) {
    const gb = c.createLinearGradient(0, -rc * 0.05, 0, rc * 1.05);
    gb.addColorStop(0, P.shade0); gb.addColorStop(1, P.shadeD);
    c.fillStyle = gb; c.fillRect(-a - 8, -rc * 0.05, 2 * a + 16, rc * 1.2);
    const gs = c.createLinearGradient(0, -rc * 1.02, 0, -rc * 0.35);
    gs.addColorStop(0, P.dark ? 'rgba(255,255,255,.24)' : 'rgba(255,255,255,.36)'); gs.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gs; c.fillRect(-a - 8, -rc * 1.05, 2 * a + 16, rc * 0.75);
    const gh = c.createRadialGradient(-a * 0.5, -rr * 0.25, 1, -a * 0.5, rr * 0.05, rr * 1.05);
    gh.addColorStop(0, 'rgba(255,255,255,.2)'); gh.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gh; c.fillRect(-a - 8, -rr * 1.4, a * 1.6, rr * 2.8);
    }
    if (dirt > 0) mudBody(c, G, dog, dirt);
    if (wet > 0.2) {
      c.strokeStyle = 'rgba(255,255,255,' + (0.4 * wet).toFixed(3) + ')'; c.lineWidth = 1; c.lineCap = 'round';
      for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-a * 0.5 + i * a * 0.5, -rc * 0.7); c.quadraticCurveTo(-a * 0.35 + i * a * 0.5, -rc * 0.5, -a * 0.3 + i * a * 0.5, -rc * 0.42); c.stroke(); }
    }
  }

  // sock / bracelet overlays on the lower legs: [x0,y0, x1,y1, x2,y2, x3,y3] joints
  function legOverlay(c, G, P, j, front, far, dirt, idx, dog) {
    const br = G.breed, lw = G.lw, ok = 0.45;
    let sock = null, from = 4;
    if (br === 'husky') { sock = P.f2; from = 2; }
    else if (br === 'corgi') { sock = P.f2; from = 2; }
    else if (br === 'dackel' && P.tanPoint) { sock = P.f2; from = 2; }
    else if (br === 'mischling' && (hash(dog && (dog.uid || dog.name) || 'x') >> (idx + 4)) & 1) { sock = P.f2; from = 4; }
    if (sock) {
      const mx0 = from === 2 ? lerp(j[2], j[4], 0.35) : j[4], my0 = from === 2 ? lerp(j[3], j[5], 0.35) : j[5];
      c.beginPath();
      cone(c, mx0, my0, (from === 2 ? lw * 0.76 : lw * 0.58) - ok, j[6], j[7], lw * 0.62 - ok);
      cone(c, j[4], j[5], lw * 0.58 - ok, j[6], j[7], lw * 0.62 - ok);
      ell(c, j[6] + lw * 0.3, j[7] - lw * 0.28, lw * 0.82 - ok, lw * 0.5 - ok, 0);
      c.fillStyle = far ? P.far2 : sock; c.fill();
    }
    if (br === 'pudel') {                              // pompom bracelets
      c.beginPath(); puff(c, lerp(j[4], j[6], 0.35), lerp(j[5], j[7], 0.35), lw * 0.95, lw * 0.95, 8, lw * 0.45, 0);
      paint(c, far ? P.far : P.f, P.ol, OW * 0.9);
    }
    if (dirt > 0.2) {                                  // muddy socks
      const al = clamp((dirt - 0.2) * 1.5, 0, 0.8);
      c.beginPath();
      cone(c, lerp(j[4], j[6], 0.0), lerp(j[5], j[7], 0.0), lw * 0.58 - ok, j[6], j[7], lw * 0.62 - ok);
      ell(c, j[6] + lw * 0.3, j[7] - lw * 0.28, lw * 0.82 - ok, lw * 0.5 - ok, 0);
      c.fillStyle = 'rgba(104,70,40,' + al.toFixed(3) + ')'; c.fill();
    }
  }

  // torso frame path: shape + fluff tufts + pudel puffs
  function torsoUnion(c, G, R, br, fl) {
    c.save(); c.translate(R.cx, R.cy); c.rotate(R.rot);
    const a = G.a, rc = G.rc, rr = G.rr, pts = torsoPts(G, br);
    if (R.sx && R.sx !== 1) for (let i = 0; i < pts.length; i += 2) pts[i] *= R.sx;
    blob(c, pts, 0.19);
    if (fl > 0.3) {
      tri(c, a - rc * 0.1, rc * 0.05, a + 3.5, rc * 0.5, a - rc * 0.4, rc * 0.88);
      tri(c, a * 0.4, rc * 0.82, a - rc * 0.45, rc * 0.95, a * 0.72, rc * 1.3);
      tri(c, -a * 0.95, rr * 0.2, -a * 0.6, rr * 0.82, -a - 4.5, rr * 1.02);
    }
    if (R.wet > 0.25) {                                  // wet fur clumps into points
      const sp = 3 + 3 * R.wet;
      for (let i = 0; i < 5; i++) { const x = lerp(-a * 0.6, a * 0.7, i / 4); tri(c, x - 2.4, rc * 0.9, x + 2.4, rc * 0.9, x + 0.5, rc * 0.9 + sp); }
    }
    if (G.puffy) {
      puff(c, a * 0.6, -rc * 0.2, rc * 0.6, rc * 0.78, 10, rc * 0.3, 0);
      puff(c, -a * 0.52, 0, rr * 0.78, rr * 0.92, 9, rr * 0.3, 0);
    }
    c.restore();
  }
  function neckPath(c, G, R) {
    const n0 = tw(R, G.a * 0.78, -G.rc * 0.2);
    cone(c, n0[0], n0[1], G.rc * G.neckR, R.H[0], R.H[1], G.hr * 0.78);
  }

  function drawTail(c, G, P, R, t, wag, behind) {
    const ty = G.tail;
    const wrap = R.tailWrap && ty !== 'curl' && ty !== 'stub', front = wrap || ty === 'curl' || ty === 'bushy';
    if (front === behind) return;
    const root = tailAnchor(R);
    c.beginPath();
    if (ty === 'curl') {
      const sw = 0.25 * sin(t * (6 + 12 * wag)) * (0.3 + wag);
      c.save(); c.translate(root[0] - 1.5, root[1] - 4.5); c.rotate(R.rot + sw);
      c.arc(0, 0, 4.9, 0.5, TAU + 0.1); c.lineCap = 'round';
      c.lineWidth = 4.6 + OW * 2; c.strokeStyle = P.ol; c.stroke();
      c.lineWidth = 4.6; c.strokeStyle = P.f; c.stroke();
      c.beginPath(); c.arc(0.4, 0, 2.2, 1.2, 4.3); c.lineWidth = 1; c.strokeStyle = P.shade; c.stroke();
      c.restore();
      return;
    }
    if (ty === 'stub') {
      const sw = sin(t * (8 + 14 * wag)) * (0.4 + 2.2 * wag) * R.tailW;
      paintX(c, () => puff(c, root[0] - 1.2 + sw * 0.6, root[1] + 0.8, 2.4, 2.6, 7, 1.7, 0), P.f, P.ol, OW);
      return;
    }
    c.beginPath();
    const tailB = () => tailChain(c, G, R, t, null, wag, tailPts);
    if (ty === 'pom') {
      paintX(c, tailB, P.f, P.ol, OW);
      const n = tailPts.length, x = tailPts[n - 3], y = tailPts[n - 2];
      paintX(c, () => puff(c, x, y - 1, 6.2, 6.2, 10, 3.4, 0), P.f, P.ol, OW);
      c.strokeStyle = P.shade; c.lineWidth = 0.9; c.beginPath();
      for (let i = 0; i < 3; i++) { const ax = x - 2 + i * 2.2, ay = y - 1 + (i % 2) * 1.5; c.moveTo(ax + 2 * cos(0.4), ay + 2 * sin(0.4)); c.arc(ax, ay, 2, 0.4, 4); }
      c.stroke();
      return;
    }
    paintX(c, tailB, P.f, P.ol, OW);
    const tipCol = ty === 'bushy' || ty === 'bushy2' || (ty === 'sabre' && G.breed === 'mischling') ? P.f2 : null;
    if (tipCol && (G.breed !== 'schaefer' || P.f2dark)) {                       // white tip / dark top
      c.beginPath();
      const n = tailPts.length / 3, from = (ty === 'bushy2') ? 1 : n - 4;
      for (let i = from * 3; i < tailPts.length - 3; i += 3) cone(c, tailPts[i], tailPts[i + 1], tailPts[i + 2] - 0.7, tailPts[i + 3], tailPts[i + 4], tailPts[i + 5] - 0.7);
      c.fillStyle = ty === 'bushy2' ? P.f2a75 : tipCol; c.fill();
    }
  }

  // toy in the mouth, placed from the head frame
  function mouthToy(c, G, R, key, rot0) {
    const f = faceOf(G), p = hw(R, f.tipX - G.s1 * 0.85, f.botY + 0.5), k = 0.78, ha = R.ha;
    if (key === 'stick') art.drawToy(c, key, p[0] + 1, p[1] - 0.5, k * 1.1, ha - 0.05);
    else if (key === 'frisbee') art.drawToy(c, key, p[0] + 3.5, p[1] + 2.5, k * 0.95, ha + 0.5);
    else if (key === 'duck') art.drawToy(c, key, p[0] + 1.5, p[1] + 1, k * 1.05, ha);
    else art.drawToy(c, key, p[0] + 0.5, p[1] + 1.8, k * 1.0, ha);
  }

  // ---------- side view: assembly ----------
  function drawBody(c, dog, G, P, R, o, t, dirt, wet, wag) {
    const fl = G.fluff * (1 - 0.7 * wet), br = 1 + (R.pose === 'sleep' ? 0.032 * sin(t * 1.9) : 0.012 * sin(t * 2.3));
    const J = { fn: solveFront(G, R, R.fn), ff: solveFront(G, R, R.ff), hn: solveHind(G, R, R.hn), hf: solveHind(G, R, R.hf) };
    R.fl = fl;
    // far legs and the tail that sits behind the body
    paintX(c, () => { legPath(c, G, J.ff, true); legPath(c, G, J.hf, false); }, P.far, P.ol, OW);
    legOverlay(c, G, P, J.ff, true, true, dirt, 0, dog); legOverlay(c, G, P, J.hf, false, true, dirt, 1, dog);
    drawTail(c, G, P, R, t, wag, true);
    // torso + neck + near legs as one silhouette
    paintX(c, () => { torsoUnion(c, G, R, br, fl); neckPath(c, G, R); legPath(c, G, J.hn, false); legPath(c, G, J.fn, true); }, P.f, P.ol, OW);
    // markings, shading, mud: clipped to the torso, drawn in its frame
    c.save();
    c.beginPath(); torsoUnion(c, G, R, br, fl); c.clip();
    c.translate(R.cx, R.cy); c.rotate(R.rot);
    bodyMarks(c, G, R, P, dog, dirt, wet, t);
    c.restore();
    legOverlay(c, G, P, J.hn, false, false, dirt, 2, dog);
    legOverlay(c, G, P, J.fn, true, false, dirt, 3, dog);
    drawTail(c, G, P, R, t, wag, false);
    if (o.collar !== false) collar(c, G, R, typeof o.collar === 'string' ? o.collar : '#e5484d', P);
    drawHead(c, G, R, P, o, t, dog, dirt);
    if (o.mouth) mouthToy(c, G, R, o.mouth);
    if (wet > 0.12) drips(c, G, R, wet, t, faceOf(G));
  }

  // ---------- public: points / size ----------
  function pointsOf(G) {
    if (G.pts) return G.pts;
    const R = standRig(G), f = faceOf(G), c = cos(R.ha), s = sin(R.ha);
    const nx = R.H[0] + f.tipX * c - f.sy * s, ny = R.H[1] + f.tipX * s + f.sy * c;
    let top = R.H[1] - G.hr - (G.topknot ? G.hr * 0.45 : 0);
    if (G.ear === 'erect' || G.ear === 'mix') top = Math.min(top, R.H[1] + G.hr * G.eY - G.eL * 0.96);
    if (G.tail === 'bushy') top = Math.min(top, tailAnchor(R)[1] - 22);
    const col = art._collarAt(G.name), root = tailAnchor(R), e = G.tAng, L = G.tL * 0.9;
    let tail = [root[0] - cos(e) * L, root[1] - sin(e) * L];
    if (G.tail === 'curl') tail = [root[0] - 3, root[1] - 9];
    else if (G.tail === 'stub') tail = [root[0] - 3, root[1] - 1];
    else if (G.tail === 'bushy') tail = [root[0] + 2, root[1] - 18];
    const butt = -G.a - 2;
    return (G.pts = {
      w: nx - butt, h: -top, nose: [nx, ny], head: [col[0] / 0.62, col[1] / 0.74], tail, butt
    });
  }
  art.points = function (dog, scale) {
    const b = pointsOf(geo(breedOf(dog))), s = (art.SIZE[breedOf(dog)] || 1) * num(scale, 1);
    return { w: b.w * s, h: b.h * s, nose: [b.nose[0] * s, b.nose[1] * s], head: [b.head[0] * s, b.head[1] * s], tail: [b.tail[0] * s, b.tail[1] * s] };
  };
  art.dogSize = function (dog, scale) { const p = art.points(dog, scale); return { w: p.w, h: p.h }; };

  const POSES = { stand: 1, walk: 1, run: 1, sit: 1, lie: 1, sleep: 1, dig: 1, eat: 1, shake: 1, beg: 1, squat: 1, jump: 1 };

  // Side view. opts: { scale, facing (1 right, -1 left), pose, t, wag, dirt, wet, mouth (toy key),
  // tongue, alpha, shadow, collar (css color | false) }
  art.drawDog = function (ctx, dog, x, y, o) {
    o = o || {};
    const breed = breedOf(dog), G = geo(breed), s = (art.SIZE[breed] || 1) * num(o.scale, 1);
    if (!(s > 0) || !isFinite(x) || !isFinite(y)) return;
    const t = num(o.t, 0), pose = POSES[o.pose] ? o.pose : 'stand';
    const wet = clamp(num(o.wet, 0), 0, 1), dirt = clamp(num(o.dirt, 0), 0, 1), wag = o.wag == null ? 0.5 : clamp(num(o.wag, 0.5), 0, 1);
    const P = pal(dog, wet);
    const R = rigOf(G, pose, t, { wag, tongue: o.tongue });
    if (o.mouth && pose !== 'sleep') R.jaw = Math.max(R.jaw, 0.32);
    const seed = (hash(dog && (dog.uid || dog.name) || 'x') % 4300) / 1000;
    R.blink = ((t + seed) % 4.3) < 0.12;
    R.lod = s < 0.55 ? 1 : 0; R.wet = wet;
    ctx.save();
    ctx.translate(x, y);
    if (o.alpha != null) { const ga = ctx.globalAlpha; ctx.globalAlpha = (typeof ga === 'number' ? ga : 1) * clamp(num(o.alpha, 1), 0, 1); }
    ctx.scale((o.facing === -1 ? -1 : 1) * s, s);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (o.shadow !== false) groundShadow(ctx, G, pose);
    if (R.shear) ctx.transform(1, 0, R.shear, 1, 0, 0);
    drawBody(ctx, dog, G, P, R, o, t, dirt, wet, wag);
    if (pose === 'shake') shakeLines(ctx, G, R, t);
    ctx.restore();
  };
  function shakeLines(c, G, R, t) {
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.2; c.lineCap = 'round';
    const k = 0.5 + 0.5 * sin(t * 37), y = R.cy;
    for (let i = 0; i < 2; i++) {
      c.beginPath(); c.arc(G.a + 6 + i * 4, y, 10 + i * 5 + k * 2, -0.9, 0.9); c.stroke();
      c.beginPath(); c.arc(-G.a - 6 - i * 4, y, 10 + i * 5 + (1 - k) * 2, PI - 0.9, PI + 0.9); c.stroke();
    }
  }

  // ---------- portrait (front view, sitting) ----------
  // Design space: 200 units tall, centered on (0,0): head top ≈ -80, ear tips ≈ -100, ground ≈ +95.
  const OWP = 1.9;
  const PB = {
    labrador: { hy: -38, hw: 48, hh: 42, mw: 24, mh: 17, ear: 'flop', eX: 44, eY: -54, eL: 44, eW: 21, es: 19, er: 9.4, cheek: 0.6, bw: 46, nose: 1.1 },
    dackel: { hy: -36, hw: 39, hh: 43, mw: 17, mh: 20, ear: 'long', eX: 38, eY: -56, eL: 62, eW: 24, es: 16, er: 8.8, cheek: 0.2, bw: 36, nose: 0.95 },
    mops: { hy: -38, hw: 53, hh: 45, mw: 27, mh: 18, ear: 'button', eX: 37, eY: -72, eL: 22, eW: 24, es: 25, er: 12, cheek: 0.5, bw: 48, nose: 1.25 },
    husky: { hy: -35, hw: 47, hh: 41, mw: 19, mh: 15, ear: 'erect', eX: 32, eY: -62, eL: 40, eW: 27, es: 19, er: 8.8, cheek: 0.55, bw: 46, nose: 1.0, fluff: 1, rot: 0.14 },
    corgi: { hy: -34, hw: 47, hh: 40, mw: 20, mh: 15, ear: 'erect', eX: 34, eY: -61, eL: 41, eW: 33, es: 19, er: 9.2, cheek: 0.5, bw: 46, nose: 1.0, fluff: 0.35, rot: 0.2 },
    pudel: { hy: -34, hw: 37, hh: 40, mw: 15, mh: 17, ear: 'curl', eX: 44, eY: -52, eL: 48, eW: 25, es: 16, er: 8.2, cheek: 0.1, bw: 35, nose: 0.9, topknot: 1 },
    schaefer: { hy: -34, hw: 42, hh: 43, mw: 18, mh: 20, ear: 'erect', eX: 28, eY: -60, eL: 42, eW: 26, es: 17, er: 8.6, cheek: 0.2, bw: 42, nose: 1.0, fluff: 0.5, rot: 0.08 },
    mischling: { hy: -38, hw: 46, hh: 41, mw: 21, mh: 16, ear: 'mix', eX: 40, eY: -58, eL: 38, eW: 21, es: 19, er: 9.4, cheek: 0.5, bw: 44, nose: 1.05 }
  };
  PB.dackel.mys = 3;

  const P_TAIL = { labrador: 'otter', dackel: 'sabre', mops: 'curl', husky: 'bushy', corgi: 'stub', pudel: 'pom', schaefer: 'bushy2', mischling: 'sabre' };

  // body (union): torso pear + haunches; returns nothing, builds the path
  function pBodyPath(c, B, breed, br, fl) {
    const w = B.bw, tw0 = w * 0.64, hips = breed === 'dackel' ? w * 1.25 : w * 1.28, y0 = 2 - (breed === 'dackel' ? 2 : 0);
    blob(c, [-tw0, y0, tw0, y0, w * 0.92, 32, hips * 0.9, 62 * br, hips, 82 * br, w * 0.95, 96 * br, -w * 0.95, 96 * br, -hips, 82 * br, -hips * 0.9, 62 * br, -w * 0.92, 32], 0.2);
    if (fl > 0.3) {                                   // chest ruff
      tri(c, -tw0 * 0.9, 8, -tw0 * 0.1, 26, -tw0 * 1.1, 40); tri(c, tw0 * 0.9, 8, tw0 * 1.1, 40, tw0 * 0.1, 26);
      tri(c, -w * 0.5, 18, w * 0.05, 30, -w * 0.2, 54); tri(c, w * 0.5, 18, w * 0.2, 54, -w * 0.05, 30);
    }
    if (breed === 'pudel') {
      puff(c, 0, 18, w * 0.78, 20, 11, 9, 0);          // mane
      puff(c, -w * 1.02, 78, 13, 15, 8, 6.5, 0); puff(c, w * 1.02, 78, 13, 15, 8, 6.5, 0);
    }
  }
  function pLegPath(c, B, side) {
    const w = B.bw;
    cone(c, side * w * 0.38, 34, 13.5, side * w * 0.42, 86, 11);
    ell(c, side * w * 0.44, 91, 14.5, 8.5, 0);
  }

  // ears of the portrait (front view)
  function pEar(c, B, P, side, kind, o, t, sw) {
    const hy = B.hy, ex = side * B.eX, ey = B.eY;
    c.save();
    if (kind === 'erect' || kind === 'semi') {
      c.translate(ex, ey); c.rotate(side * (B.rot || 0.12) + sw * 0.4);
      const w = B.eW, l = B.eL, semi = kind === 'semi';
      paintX(c, () => {
        if (semi) blob(c, [-w * 0.5, 2, -w * 0.3, -l * 0.7, side * w * 0.1, -l * 0.98, side * w * 0.62, -l * 0.62, w * 0.5, 2, 0, 5], 0.17);
        else blob(c, [-w * 0.5, 2, -w * 0.12, -l * 0.62, w * 0.0, -l, w * 0.14, -l * 0.62, w * 0.5, 2, 0, 5], 0.15);
      }, P.earC, P.ol, OWP);
      c.beginPath(); c.save(); c.scale(0.58, 0.7); c.translate(0, -3);
      if (semi) blob(c, [-w * 0.5, 2, -w * 0.3, -l * 0.7, side * w * 0.1, -l * 0.98, side * w * 0.62, -l * 0.62, w * 0.5, 2, 0, 5], 0.17);
      else blob(c, [-w * 0.5, 2, -w * 0.12, -l * 0.62, w * 0.0, -l, w * 0.14, -l * 0.62, w * 0.5, 2, 0, 5], 0.15);
      c.restore(); c.fillStyle = P.earIn; c.fill();
    } else if (kind === 'curl') {
      c.translate(ex, ey + B.eL * 0.42); c.rotate(side * 0.1 + sw);
      paintX(c, () => puff(c, 0, 0, B.eW * 0.5, B.eL * 0.5, 11, B.eW * 0.26, 0), P.f, P.ol, OWP);
      c.strokeStyle = P.shade; c.lineWidth = 1.4; c.beginPath();
      for (let i = 0; i < 4; i++) { const ax = -3 + (i % 2) * 6, ay = -B.eL * 0.3 + i * B.eL * 0.2, ar = B.eW * 0.17; c.moveTo(ax + ar * cos(0.4), ay + ar * sin(0.4)); c.arc(ax, ay, ar, 0.4, 4.2); }
      c.stroke();
    } else if (kind === 'button') {
      c.translate(ex, ey); c.rotate(-side * 0.55 + sw);
      paintX(c, () => blob(c, [-B.eW * 0.5, -2, B.eW * 0.5, -3, B.eW * 0.55, B.eL * 0.5, 0, B.eL, -B.eW * 0.45, B.eL * 0.5], 0.2), P.earC, P.ol, OWP);
    } else {                                           // flop / long
      c.translate(ex, ey); c.rotate(-side * 0.1 + sw);
      const w = B.eW, l = B.eL;
      paintX(c, () => blob(c, [-w * 0.5, -3, w * 0.5, -3, w * 0.62, l * 0.45, w * 0.35, l * 0.95, -w * 0.15, l, -w * 0.58, l * 0.55], 0.2), P.earC, P.ol, OWP);
      c.beginPath(); c.fillStyle = 'rgba(255,255,255,.12)'; ell(c, -w * 0.12, l * 0.28, w * 0.18, l * 0.22, 0); c.fill();
    }
    c.restore();
  }

  function pTail(c, B, breed, P, t, happy, behind) {
    const ty = P_TAIL[breed], w = B.bw, sw = sin(t * (7 + 11 * happy)) * (0.12 + 0.45 * happy);
    if (ty === 'stub') return;
    if (!behind) return;
    const root = [w * 0.98, 84], pts = [];
    let psi, bend, L, w0, w1, n = 7;
    switch (ty) {
      case 'otter': psi = -0.25; bend = -0.55; L = 46; w0 = 15; w1 = 8; break;
      case 'sabre': psi = -0.6; bend = 0.9; L = 56; w0 = 8; w1 = 3.2; break;
      case 'bushy': psi = -0.9; bend = 1.7; L = 60; w0 = 18; w1 = 15; break;
      case 'bushy2': psi = -0.35; bend = -0.2; L = 58; w0 = 16; w1 = 8; break;
      case 'pom': psi = -1.0; bend = 0.4; L = 42; w0 = 6; w1 = 4; break;
      default: psi = -0.5; bend = 1.2; L = 20; w0 = 9; w1 = 9; n = 6;       // curl
    }
    let x = root[0], y = root[1];
    pts.push(x, y, w0 * 0.5);
    for (let i = 1; i <= n; i++) {
      psi += bend / n + sw * 0.28 * (sin(t * (7 + 11 * happy) - i * 0.7) - (i > 1 ? sin(t * (7 + 11 * happy) - (i - 1) * 0.7) : 0)) * 3.2;
      x += cos(psi) * L / n; y += sin(psi) * L / n;
      let r = lerp(w0, w1, i / n) * 0.5;
      if (ty === 'bushy' || ty === 'bushy2') r *= (1 + 0.1 * sin(i * 2.4)) * (1 + 0.2 * sin(PI * i / n));
      pts.push(x, y, r);
    }
    const chain = () => { for (let i = 0; i < pts.length - 3; i += 3) cone(c, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5]); };
    paintX(c, chain, P.f, P.ol, OWP);
    if (ty === 'pom') paintX(c, () => puff(c, x, y - 2, 9, 9, 10, 5, 0), P.f, P.ol, OWP);
    if ((ty === 'bushy' || ty === 'bushy2') && (breed !== 'schaefer' || P.f2dark)) {
      c.beginPath();
      for (let i = (ty === 'bushy' ? 4 : 1) * 3; i < pts.length - 3; i += 3) cone(c, pts[i], pts[i + 1], pts[i + 2] - 1.4, pts[i + 3], pts[i + 4], pts[i + 5] - 1.4);
      c.fillStyle = ty === 'bushy2' ? P.f2a75 : P.f2; c.fill();
    }
  }

  function pEye(c, x, y, er, P, B, lx, ly, happy, blink, lid, blue, ring) {
    if (happy > 0.72 || blink) {
      c.beginPath();
      if (blink && happy <= 0.72) c.arc(x, y - er * 0.9, er * 1.05, PI * 0.15, PI * 0.85);
      else c.arc(x, y + er * 0.55, er * 1.0, PI * 1.12, PI * 1.88);
      c.lineWidth = 3.4; c.lineCap = 'round'; c.strokeStyle = P.dark ? 'rgba(255,255,255,.7)' : P.eye; c.stroke();
      return;
    }
    const ox = lx * 1.9, oy = ly * 1.3;
    if (ring) { c.fillStyle = 'rgba(255,255,255,.3)'; c.beginPath(); ell(c, x, y, er + 1.6, er * 1.12 + 1.6, 0); c.fill(); }
    c.beginPath(); ell(c, x + ox, y + oy, er, er * 1.12, 0); c.fillStyle = P.eye; c.fill();
    if (blue) {
      c.beginPath(); ell(c, x + ox, y + oy, er * 0.86, er * 0.98, 0); c.fillStyle = '#3a86c4'; c.fill();
      c.beginPath(); ell(c, x + ox, y + oy + er * 0.18, er * 0.66, er * 0.7, 0); c.fillStyle = '#9adfff'; c.fill();
      c.beginPath(); ell(c, x + ox * 1.1, y + oy, er * 0.46, er * 0.52, 0); c.fillStyle = '#10151c'; c.fill();
    } else {
      c.beginPath(); ell(c, x + ox, y + oy + er * 0.42, er * 0.66, er * 0.42, 0); c.fillStyle = 'rgba(200,128,74,.45)'; c.fill();
    }
    c.fillStyle = '#fff';
    c.beginPath(); ell(c, x + ox * 1.3 - er * 0.32, y + oy * 1.3 - er * 0.38, er * 0.36, er * 0.4, 0); c.fill();
    c.beginPath(); ell(c, x + ox * 1.1 + er * 0.4, y + oy + er * 0.42, er * 0.16, er * 0.16, 0); c.fill();
    if (happy > 0.12) {                                // smiling squint: the cheek pushes up as a lid
      const h2 = clamp((happy - 0.12) / 0.6, 0, 1);
      c.beginPath(); c.arc(x, y + er * (1.7 - 1.15 * h2), er * 1.45, 0, TAU); c.fillStyle = lid; c.fill();
    }
  }

  function pHeadMarks(c, B, P, breed, dog, t) {
    const hy = B.hy, hw = B.hw, hh = B.hh, yM = hy + hh * 0.5;
    c.fillStyle = P.shade; c.beginPath(); ell(c, 0, hy + hh * 0.95, hw * 0.95, hh * 0.38, 0); c.fill();                // under the chin
    switch (breed) {
      case 'dackel':
        if (P.tanPoint) {
          c.fillStyle = P.f2; c.beginPath(); ell(c, 0, yM + 2, B.mw * 1.15, B.mh * 1.4, 0); c.fill();
          c.beginPath(); ell(c, -B.es * 1.5, hy + hh * 0.5, 9, 8, 0); c.fill(); c.beginPath(); ell(c, B.es * 1.5, hy + hh * 0.5, 9, 8, 0); c.fill();
        }
        break;
      case 'mops':
        c.fillStyle = P.f2; c.beginPath(); ell(c, 0, hy + hh * 0.28, hw * 0.84, hh * 0.78, 0); c.fill();
        c.strokeStyle = P.shade; c.lineWidth = 1.5; c.lineCap = 'round'; c.beginPath();
        for (let i = 0; i < 3; i++) { const ay = hy - hh * 0.95 + i * 5, ar = 17 - i * 2; c.moveTo(ar * cos(PI * 1.2), ay + ar * sin(PI * 1.2)); c.arc(0, ay, ar, PI * 1.2, PI * 1.8); }
        c.stroke();
        break;
      case 'husky':
        c.fillStyle = P.f2;
        c.beginPath(); ell(c, 0, hy + hh * 0.62, hw * 0.82, hh * 0.58, 0); c.fill();                    // white lower face
        c.beginPath(); blob(c, [-4, hy - hh * 0.95, 4, hy - hh * 0.95, 8, hy + hh * 0.2, 0, hy + hh * 0.5, -8, hy + hh * 0.2], 0.2); c.fill();   // blaze
        c.beginPath(); ell(c, -B.es - 1, hy - 14, 5.5, 3.8, -0.2); c.fill(); c.beginPath(); ell(c, B.es + 1, hy - 14, 5.5, 3.8, 0.2); c.fill();
        break;
      case 'corgi':
        c.fillStyle = P.f2;
        c.beginPath(); ell(c, 0, hy + hh * 0.66, hw * 0.78, hh * 0.52, 0); c.fill();
        c.beginPath(); blob(c, [-3.5, hy - hh * 0.55, 3.5, hy - hh * 0.55, 10, hy + hh * 0.35, 0, hy + hh * 0.7, -10, hy + hh * 0.35], 0.2); c.fill();
        break;
      case 'schaefer':
        c.fillStyle = P.f2dark ? P.f2 : P.f2La50;
        c.beginPath(); ell(c, 0, yM + 3, B.mw * 1.05, B.mh * 1.08, 0); c.fill();
        break;
      case 'mischling': {
        const h = hash(dog && (dog.uid || dog.name) || 'x'), sd = (h & 4) ? 1 : -1;
        c.fillStyle = P.f2;
        c.beginPath(); ell(c, sd * (B.es + 1), hy - 2, 14, 15, 0.3 * sd); c.fill();
        if (h & 8) { c.beginPath(); ell(c, -sd * 18, hy - hh * 0.72, 13, 9, 0.3); c.fill(); }
        break;
      }
      default: break;
    }
    // muzzle: lighter pad (or the breed's marking color)
    const own = breed === 'mops' || breed === 'husky' || breed === 'corgi' || (breed === 'schaefer' && P.f2dark) || (breed === 'dackel' && P.tanPoint);
    if (!own) { c.fillStyle = P.fLLa; c.beginPath(); ell(c, 0, yM + 1, B.mw, B.mh, 0); c.fill(); }
    c.fillStyle = 'rgba(255,255,255,.18)'; c.beginPath(); ell(c, -hw * 0.18, hy - hh * 0.62, hw * 0.46, hh * 0.2, -0.2); c.fill();
  }

  function pSkull(c, B, fl) {
    const hy = B.hy, hw = B.hw, hh = B.hh;
    ell(c, 0, hy, hw, hh, 0);
    if (B.cheek) { circ(c, -hw * 0.6, hy + hh * 0.38, hw * B.cheek * 0.55); circ(c, hw * 0.6, hy + hh * 0.38, hw * B.cheek * 0.55); }
    if (fl > 0.3) {                                    // cheek ruff
      tri(c, -hw * 0.82, hy + hh * 0.05, -hw * 0.7, hy + hh * 0.72, -hw * 1.24, hy + hh * 0.5);
      tri(c, hw * 0.82, hy + hh * 0.05, hw * 1.24, hy + hh * 0.5, hw * 0.7, hy + hh * 0.72);
      tri(c, -hw * 0.62, hy + hh * 0.7, -hw * 0.3, hy + hh * 1.02, -hw * 1.0, hy + hh * 1.0);
      tri(c, hw * 0.62, hy + hh * 0.7, hw * 1.0, hy + hh * 1.0, hw * 0.3, hy + hh * 1.02);
    }
    if (B.topknot) puff(c, 0, hy - hh * 0.8, hw * 0.74, hh * 0.5, 11, hw * 0.28, 0);
  }
  function pBodyMarks(c, B, P, breed, dog, dirt) {
    const w = B.bw;
    c.fillStyle = P.f2;
    switch (breed) {
      case 'husky': c.beginPath(); ell(c, 0, 44, w * 0.62, 46, 0); c.fill(); break;
      case 'corgi': c.beginPath(); ell(c, 0, 50, w * 0.72, 52, 0); c.fill(); break;
      case 'dackel': if (P.tanPoint) { c.beginPath(); ell(c, 0, 30, 15, 22, 0); c.fill(); } break;
      case 'schaefer':
        c.fillStyle = P.f2dark ? P.f2 : P.f2a50;
        c.beginPath(); ell(c, -w * 0.8, 30, 15, 30, 0.12); c.fill(); c.beginPath(); ell(c, w * 0.8, 30, 15, 30, -0.12); c.fill();
        c.beginPath(); ell(c, -w * 1.05, 70, 16, 24, 0.1); c.fill(); c.beginPath(); ell(c, w * 1.05, 70, 16, 24, -0.1); c.fill();
        break;
      case 'mischling': {
        const r = WW.rng(hash('patch' + (dog && (dog.uid || dog.name) || 'x')));
        for (let i = 0; i < 4; i++) { c.beginPath(); ell(c, lerp(-w, w, r()), lerp(20, 85, r()), 9 + r() * 14, 10 + r() * 16, r() * 3); c.fill(); }
        break;
      }
      case 'pudel':
        c.strokeStyle = P.shade; c.lineWidth = 1.4; c.beginPath();
        for (let i = 0; i < 12; i++) { const ax = lerp(-w * 0.9, w * 0.9, (i * 0.618) % 1), ay = lerp(14, 88, (i * 0.37) % 1); c.moveTo(ax + 4.2 * cos(0.3), ay + 4.2 * sin(0.3)); c.arc(ax, ay, 4.2, 0.3, 3.9); }
        c.stroke();
        break;
      default: break;
    }
    c.fillStyle = P.shade; c.beginPath(); ell(c, 0, 74, w * 0.3, 28, 0); c.fill();          // shadow between the legs
    c.fillStyle = 'rgba(255,255,255,' + (P.dark ? 0.14 : 0.2) + ')'; c.beginPath(); ell(c, -w * 0.38, 26, 13, 20, 0.3); c.fill();
    if (dirt > 0) {
      const list = mudOf(dog);
      for (let i = 0; i < 6; i++) {
        const al = clamp(dirt * 6 - i, 0, 1) * 0.86;
        if (al <= 0) break;
        mudBlob(c, list[i + 2 > 8 ? 8 : i + 2], lerp(-w * 0.9, w * 0.9, list[i].x), lerp(30, 92, list[i].y), 1.7, al);
      }
    }
  }
  function pLegOverlay(c, B, P, breed, side, dog, dirt) {
    const w = B.bw, x0 = side * w * 0.405, x1 = side * w * 0.42, ok = 0.9;
    let sock = null;
    if (breed === 'husky' || breed === 'corgi') sock = P.f2;
    else if (breed === 'dackel' && P.tanPoint) sock = P.f2;
    else if (breed === 'mischling' && (hash(dog && (dog.uid || dog.name) || 'x') >> (side > 0 ? 5 : 6)) & 1) sock = P.f2;
    if (sock) {
      c.beginPath(); cone(c, x0, 58, 11.6 - ok, x1, 86, 10 - ok); ell(c, side * w * 0.44, 91, 14.5 - ok, 8.5 - ok, 0);
      c.fillStyle = sock; c.fill();
    }
    if (breed === 'pudel') paintX(c, () => puff(c, x1, 72, 12.5, 12, 9, 6.2, 0), P.f, P.ol, OWP);
    if (dirt > 0.25) {
      c.beginPath(); cone(c, x0, 72, 11 - ok, x1, 86, 10 - ok); ell(c, side * w * 0.44, 91, 14.5 - ok, 8.5 - ok, 0);
      c.fillStyle = 'rgba(104,70,40,' + clamp((dirt - 0.25) * 1.6, 0, 0.8).toFixed(3) + ')'; c.fill();
    }
    c.strokeStyle = P.dark ? 'rgba(255,255,255,.3)' : 'rgba(40,24,20,.5)'; c.lineWidth = 1.2;     // toes
    c.beginPath();
    for (let i = -1; i <= 1; i += 2) { c.moveTo(side * w * 0.44 + i * 4.2, 90); c.lineTo(side * w * 0.44 + i * 4.8, 96); }
    c.stroke();
  }

  art.drawPortrait = function (ctx, dog, cx, cy, size, o) {
    o = o || {};
    const breed = breedOf(dog), B = PB[breed], k = size / 200, c = ctx;
    if (!(k > 0) || !isFinite(cx) || !isFinite(cy)) return;
    const t = num(o.t, 0), happy = clamp(num(o.happy, 0), 0, 1), eat = clamp(num(o.eat, 0), 0, 1);
    const wet = clamp(num(o.wet, 0), 0, 1), dirt = clamp(num(o.dirt, 0), 0, 1), tilt = clamp(num(o.tilt, 0), -1, 1);
    const lx = clamp(num(o.look && o.look.x, 0), -1, 1), ly = clamp(num(o.look && o.look.y, 0), -1, 1);
    const P = pal(dog, wet), h = hash(dog && (dog.uid || dog.name) || 'x'), blink = ((t + (h % 4300) / 1000) % 4.3) < 0.12;
    const fl = (B.fluff || 0) * (1 - 0.7 * wet), br = 1 + 0.012 * sin(t * 2.2);
    const hy = B.hy, hw = B.hw, hh = B.hh, yM = hy + hh * 0.5, kind = B.ear, upSide = (h & 1) ? 1 : -1;
    c.save();
    c.translate(cx, cy); c.scale(k, k); c.lineJoin = 'round'; c.lineCap = 'round';
    c.fillStyle = 'rgba(24,18,36,.13)'; c.beginPath(); ell(c, 0, 94, B.bw * 1.5, 9.5, 0); c.fill();
    c.fillStyle = 'rgba(24,18,36,.17)'; c.beginPath(); ell(c, 0, 94.5, B.bw * 1.2, 7, 0); c.fill();
    pTail(c, B, breed, P, t, happy, true);
    // body, legs, paws
    paintX(c, () => pBodyPath(c, B, breed, br, fl), P.f, P.ol, OWP);
    c.save(); c.beginPath(); pBodyPath(c, B, breed, br, fl); c.clip(); pBodyMarks(c, B, P, breed, dog, dirt); c.restore();
    const hipX = B.bw * 1.28 - 9;
    paintX(c, () => { ell(c, -hipX, 92.5, 12, 6.8, 0); ell(c, hipX, 92.5, 12, 6.8, 0); }, P.f, P.ol, OWP);
    pTail(c, B, breed, P, t, happy, false);
    for (let s = -1; s <= 1; s += 2) { paintX(c, () => pLegPath(c, B, s), P.f, P.ol, OWP); pLegOverlay(c, B, P, breed, s, dog, dirt); }
    if (o.collar !== false) {                          // collar with a tag, under the chin
      c.beginPath(); c.moveTo(-B.bw * 0.6, 4); c.quadraticCurveTo(0, 21, B.bw * 0.6, 4);
      c.lineWidth = 7.6 + OWP; c.strokeStyle = P.dark ? 'rgba(255,255,255,.3)' : 'rgba(70,24,24,.7)'; c.stroke();
      c.lineWidth = 7; c.strokeStyle = typeof o.collar === 'string' ? o.collar : '#e5484d'; c.stroke();
      c.beginPath(); c.arc(0, 21.5, 4.6, 0, TAU); c.fillStyle = '#ffd24a'; c.fill(); c.lineWidth = 1.1; c.strokeStyle = '#a77a12'; c.stroke();
      c.beginPath(); c.arc(-1.2, 20.2, 1.4, 0, TAU); c.fillStyle = 'rgba(255,255,255,.7)'; c.fill();
    }
    // ----- head (swings around the neck) -----
    const pv = hy + hh * 0.9, sw = -tilt * 0.5 + 0.05 * sin(t * 1.7 + 1) + (eat > 0 ? (eat - 0.5) * 0.1 : 0);
    c.save();
    c.translate(lx * 1.8, ly * 1.2 + 0.7 * sin(t * 2.2 + 0.6));
    c.translate(0, pv); c.rotate(tilt + 0.02 * sin(t * 0.8)); c.translate(0, -pv);
    if (kind === 'erect') { pEar(c, B, P, -1, 'erect', o, t, sw); pEar(c, B, P, 1, 'erect', o, t, sw); }
    else if (kind === 'mix') pEar(c, B, P, upSide, 'semi', o, t, sw);
    paintX(c, () => pSkull(c, B, fl), P.f, P.ol, OWP);
    c.save(); c.beginPath(); pSkull(c, B, fl); c.clip();
    pHeadMarks(c, B, P, breed, dog, t);
    if (dirt > 0.3) {
      const list = mudOf(dog);
      mudBlob(c, list[0], -hw * 0.45, hy - hh * 0.3, 1.6, clamp((dirt - 0.3) * 3, 0, 1) * 0.85);
      if (dirt > 0.5) mudBlob(c, list[1], hw * 0.5, hy + hh * 0.15, 1.4, clamp((dirt - 0.5) * 3, 0, 1) * 0.85);
      if (dirt > 0.7) mudBlob(c, list[2], -hw * 0.15, hy + hh * 0.62, 1.3, clamp((dirt - 0.7) * 3, 0, 1) * 0.85);
    }
    c.restore();
    if (kind === 'flop' || kind === 'long' || kind === 'curl' || kind === 'button') { pEar(c, B, P, -1, kind, o, t, sw); pEar(c, B, P, 1, kind, o, t, sw); }
    else if (kind === 'mix') pEar(c, B, P, -upSide, 'flop', o, t, sw);
    pFace(c, B, P, breed, dog, t, happy, eat, !!o.tongue, lx, ly, blink);
    if (wet > 0.12) pDrips(c, B, wet, t);
    c.restore();
    c.restore();
  };

  function pFace(c, B, P, breed, dog, t, happy, eat, tongue, lx, ly, blink) {
    const hy = B.hy, hw = B.hw, hh = B.hh, yM = hy + hh * 0.5, mw = B.mw, mh = B.mh, es = B.es, er = B.er;
    const eyeY = hy + (breed === 'mops' ? 4 : -1), lid = breed === 'mops' || (breed === 'husky') ? P.f2 : P.f;
    // brows and blush first
    if (P.hasBrow && (breed === 'dackel' || breed === 'husky')) {
      c.fillStyle = P.browC;
      c.beginPath(); ell(c, -es, eyeY - er * 1.75, er * 0.7, er * 0.42, -0.15); c.fill();
      c.beginPath(); ell(c, es, eyeY - er * 1.75, er * 0.7, er * 0.42, 0.15); c.fill();
    }
    c.fillStyle = 'rgba(255,110,135,' + (P.dark ? 0.15 : 0.26) + ')';
    c.beginPath(); ell(c, -es - 9, eyeY + er * 1.7, 8, 5, 0); c.fill(); c.beginPath(); ell(c, es + 9, eyeY + er * 1.7, 8, 5, 0); c.fill();
    const blue = breed === 'husky', ring = breed === 'mops';
    pEye(c, -es, eyeY, er, P, B, lx, ly, happy, blink, lid, blue, ring);
    pEye(c, es, eyeY, er, P, B, lx, ly, happy, blink, lid, blue, ring);
    // nose
    const nw = 8.6 * B.nose, nh = 6.2 * B.nose, ny = yM - mh * 0.5;
    c.beginPath(); blob(c, [-nw, ny - nh * 0.55, nw, ny - nh * 0.55, nw * 0.64, ny + nh * 0.55, 0, ny + nh * 1.0, -nw * 0.64, ny + nh * 0.55], 0.22);
    c.fillStyle = P.nose; c.fill();
    c.fillStyle = P.noseHi; c.beginPath(); ell(c, -nw * 0.34, ny - nh * 0.2, nw * 0.3, nh * 0.2, -0.2); c.fill();
    // mouth
    const my = yM + mh * 0.3, open = clamp(Math.max(eat, tongue ? 0.45 : 0), 0, 1);
    const darkMuz = P.dark || breed === 'mops' || (breed === 'schaefer' && P.f2dark), ink = darkMuz ? 'rgba(255,255,255,.42)' : 'rgba(40,20,14,.75)';
    if (open > 0.04) {
      c.beginPath(); ell(c, 0, my + 2 + 3 * open, mw * (0.5 + 0.18 * open), 2 + 9 * open, 0); c.fillStyle = P.mouth; c.fill();
      if (tongue || eat > 0.2) {
        const th = tongue ? 12 : 6;
        c.beginPath(); ell(c, 0, my + 3 + 8 * open + th * 0.4 + (tongue ? 1.5 * sin(t * 12) : 0), 6.6, th, 0);
        paint(c, P.tongue, P.tongueD, 1);
        c.beginPath(); c.moveTo(0, my + 4 + 8 * open); c.lineTo(0, my + 3 + 8 * open + th * 0.8); c.lineWidth = 1; c.strokeStyle = P.tongueD; c.stroke();
      }
      c.beginPath(); c.moveTo(0, ny + nh); c.lineTo(0, my); c.lineWidth = 1.8; c.strokeStyle = ink; c.stroke();
      c.beginPath(); c.moveTo(-mw * 0.72, my - 1); c.quadraticCurveTo(-mw * 0.3, my + 3 + 2 * open, 0, my); c.quadraticCurveTo(mw * 0.3, my + 3 + 2 * open, mw * 0.72, my - 1); c.stroke();
    } else {
      c.beginPath(); c.moveTo(0, ny + nh); c.lineTo(0, my);
      c.moveTo(0, my); c.quadraticCurveTo(-mw * 0.28, my + 7, -mw * 0.74, my - 0.5);
      c.moveTo(0, my); c.quadraticCurveTo(mw * 0.28, my + 7, mw * 0.74, my - 0.5);
      c.lineWidth = 1.9; c.strokeStyle = ink; c.stroke();
    }
    c.fillStyle = P.dark ? 'rgba(255,255,255,.25)' : 'rgba(40,24,20,.32)';                           // whisker dots
    for (let j = 0; j < 3; j++) { c.beginPath(); c.arc(-mw * 0.5 - j * 3.2, yM - 3 + (j % 2) * 3.4, 1, 0, TAU); c.arc(mw * 0.5 + j * 3.2, yM - 3 + (j % 2) * 3.4, 1, 0, TAU); c.fill(); }
  }
  function pDrips(c, B, wet, t) {
    c.fillStyle = 'rgba(165,220,255,.92)';
    const n = Math.round(wet * 4), xs = [-B.hw * 0.5, B.hw * 0.4, -B.hw * 0.15, B.hw * 0.7];
    for (let i = 0; i < n; i++) {
      const u = frac(t * 0.8 + i * 0.27), x = xs[i], y = B.hy + B.hh * 0.9 + u * u * 60;
      if (u > 0.95) continue;
      c.beginPath(); c.arc(x, y, 2.2, 0, TAU); c.moveTo(x - 1.9, y - 0.8); c.lineTo(x, y - 6); c.lineTo(x + 1.9, y - 0.8); c.fill();
    }
  }

  // Which petting spot is at (dx, dy) relative to the portrait center?
  // → 'head' | 'ears' | 'chin' | 'belly' | 'body' | null
  art.portraitZone = function (dog, size, dx, dy) {
    const B = PB[breedOf(dog)], k = size / 200, x = dx / k, y = dy / k, ax = Math.abs(x);
    if (!(k > 0) || !isFinite(x) || !isFinite(y)) return null;
    const kind = B.ear, h = hash(dog && (dog.uid || dog.name) || 'x'), upSide = (h & 1) ? 1 : -1;
    const side = x < 0 ? -1 : 1;
    let ek = kind;
    if (kind === 'mix') ek = side === upSide ? 'semi' : 'flop';
    const up = ek === 'erect' || ek === 'semi';
    const ecy = up ? B.eY - B.eL * 0.5 : B.eY + B.eL * (ek === 'button' ? 0.4 : 0.45);
    const erx = B.eW * (up ? 0.6 : 0.58), ery = B.eL * (ek === 'button' ? 0.5 : 0.55);
    const ex = (ax - B.eX) / erx, ey = (y - ecy) / ery;
    const hx = x / B.hw, hy = (y - B.hy) / B.hh, inHead = hx * hx + hy * hy < 1;
    if (ex * ex + ey * ey < 1 && !(inHead && Math.abs(hy) < 0.5 && ax < B.hw * 0.62)) return 'ears';
    if (inHead || (B.cheek && Math.pow(ax - B.hw * 0.6, 2) + Math.pow(y - B.hy - B.hh * 0.38, 2) < Math.pow(B.hw * B.cheek * 0.55, 2))) return y < B.hy + B.hh * 0.12 ? 'head' : 'chin';
    if (ax < B.hw * 0.7 && y >= B.hy + B.hh * 0.9 && y < 14) return 'chin';
    if (ax < B.bw * 0.5 && y > 36 && y < 94) return 'belly';
    const bx = x / (B.bw * 1.22), by = (y - 52) / 48;
    if (bx * bx + by * by < 1 && y > 0) return 'body';
    return null;
  };

  // ---------- toys ----------
  // Centered at (x, y); scale 1 ≈ 14 px ball. rot in radians.
  art.drawToy = function (ctx, key, x, y, scale, rot) {
    const s = num(scale, 1), c = ctx;
    c.save();
    c.translate(x, y); if (rot) c.rotate(rot); c.scale(s, s);
    c.lineJoin = 'round'; c.lineCap = 'round';
    if (key === 'frisbee') {
      paintX(c, () => ell(c, 0, 1.7, 13, 4.9, 0), '#d41f47', '#7d1029', 0.9);                              // underside rim
      paintX(c, () => ell(c, 0, -0.4, 13, 4.9, 0), '#ff375f', '#9c1536', 0.9);                             // disc
      c.beginPath(); ell(c, 0, -0.9, 10.2, 3.2, 0); c.fillStyle = '#ff6a86'; c.fill();                    // top surface
      c.beginPath(); ell(c, 0, -0.9, 5.4, 1.6, 0); c.lineWidth = 0.9; c.strokeStyle = 'rgba(255,255,255,.6)'; c.stroke();
      c.beginPath(); c.ellipse(0, -0.5, 12.2, 4.3, 0, PI * 1.05, PI * 1.55); c.lineWidth = 1.2; c.strokeStyle = 'rgba(255,255,255,.85)'; c.stroke();
    } else if (key === 'duck') {
      paintX(c, () => { ell(c, -1, 2.6, 9.6, 6.6, 0); circ(c, 5.4, -5.4, 5.2); circ(c, -9.2, -0.2, 2.9); }, '#ffd60a', '#a8700a', 1);
      paintX(c, () => blob(c, [9.4, -6.6, 13.8, -5.6, 14, -3.8, 9.6, -3.6], 0.25), '#ff9f0a', '#a85a06', 0.8);   // beak
      c.beginPath(); ell(c, -2.4, 3, 4.8, 2.9, -0.3); c.fillStyle = '#f3b800'; c.fill();
      c.lineWidth = 0.8; c.strokeStyle = 'rgba(168,112,10,.8)'; c.stroke();
      c.fillStyle = '#2a1812'; c.beginPath(); c.arc(6.9, -6.5, 1.15, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.arc(6.5, -6.9, 0.45, 0, TAU); c.fill();
      c.beginPath(); ell(c, -3.6, -0.6, 3.6, 1.5, -0.4); c.fillStyle = 'rgba(255,255,255,.5)'; c.fill();
    } else if (key === 'stick') {
      c.beginPath(); c.moveTo(-13, 1.8); c.quadraticCurveTo(0, -1.8, 13, -1.8);
      c.moveTo(1.5, -0.6); c.lineTo(6, -6.4);
      c.lineWidth = 5.4; c.strokeStyle = '#4a2c12'; c.stroke();
      c.lineWidth = 3.6; c.strokeStyle = '#8f5d2c'; c.stroke();
      c.beginPath(); c.moveTo(-12, 0.6); c.quadraticCurveTo(0, -3, 12, -3.1); c.lineWidth = 1.1; c.strokeStyle = 'rgba(214,160,100,.8)'; c.stroke();
      c.strokeStyle = 'rgba(60,34,14,.65)'; c.lineWidth = 0.9;
      for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * 5, -0.2 + (i % 2) * 0.6); c.lineTo(i * 5 + 1.6, 1.6); c.stroke(); }
      c.fillStyle = '#e3c496'; c.beginPath(); c.arc(-13, 1.8, 1.9, 0, TAU); c.arc(13, -1.8, 1.9, 0, TAU); c.fill();
    } else {                                           // tennis ball
      paintX(c, () => circ(c, 0, 0, 7), '#cdf03f', '#6b8a12', 0.9);
      c.save(); c.beginPath(); c.arc(0, 0, 7, 0, TAU); c.clip();
      c.beginPath(); c.rect(-9, -9, 18, 18); c.moveTo(4.8, -2.6); c.arc(-2.4, -2.6, 7.2, 0, TAU); c.fillStyle = 'rgba(78,118,0,.24)'; c.fill('evenodd');
      c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,.95)';
      c.beginPath(); c.arc(-9, 0, 8, -0.78, 0.78); c.stroke();
      c.beginPath(); c.arc(9, 0, 8, PI - 0.78, PI + 0.78); c.stroke();
      c.restore();
      c.beginPath(); ell(c, -2.5, -3, 2.3, 1.3, -0.6); c.fillStyle = 'rgba(255,255,255,.6)'; c.fill();
    }
    c.restore();
  };
})();
