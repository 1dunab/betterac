// ===== Skyfarers art (procedural three.js models) =============
// Pure model factories for docs/SKYFARERS.md "Art API": ships, home island, islets,
// buildings, dragon, people, crates. Warm low-poly, flat shaded, vertex colours; every
// model is merged into a handful of meshes. A per-vertex `aGlow` attribute marks
// emissive parts (lanterns, windows, crystals); one shared uniform scales them with
// the night. Plain script: THREE is passed in as the first argument of every factory.
// ============================================================
(function () {
  'use strict';
  const PI = Math.PI, TAU = PI * 2, sin = Math.sin, cos = Math.cos;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hash2 = (x, y) => {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const hpos = (x, y, z) => hash2(Math.round(x * 97) + Math.round(z * 53), Math.round(y * 89) + 7);
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
  }
  const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.3 + vnoise(x * 4.3 + 9.1, y * 4.3 + 3.7) * 0.15;
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ---------- palette ----------
  const palette = {
    wood: '#8a5a34', woodDark: '#5e3b22', woodLight: '#b98a55', plank: '#a8743f', plankDark: '#7a4f2b',
    stone: '#8e9196', stoneDark: '#60656d', stoneLight: '#b9b8b0', rock: '#6f6a72', rockDark: '#463f4d', rockLight: '#8a8290',
    grass: '#6fae45', grassLight: '#98c855', grassDark: '#4a8b3a', moss: '#5f9b55', dirt: '#a07848', soil: '#6e4b2f', sand: '#d8c58f',
    crystal: '#4be6ff', crystalDeep: '#2a8fd8', crystalViolet: '#a46bff', crystalPink: '#ff7ad9',
    roof: '#b9492f', roofDark: '#8a3524', slate: '#4f5d75', thatch: '#c9a23f', brass: '#e0ac3c', brassDark: '#a47a24', copper: '#c26b3c', iron: '#383c47',
    cloth: '#f1e6c8', clothRed: '#c8493a', rope: '#cdb78a', glass: '#ffd48a', water: '#4fb8d8', waterDeep: '#2f86b8',
    leaf: '#55a040', leafDark: '#2f6e3a', pine: '#2f7a4a', pineDark: '#1f5a3a', bark: '#6b4a30', ember: '#ff8a2a', teal: '#1f7a7a', purple: '#5a3a8c', white: '#ffffff', char: '#201a18'
  };

  // ---------- colours (linear working space, like THREE.Color) ----------
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const colCache = new Map();
  function C(h) {
    if (Array.isArray(h)) return h;
    let c = colCache.get(h);
    if (!c) { const n = parseInt(h.slice(1), 16); c = [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)]; colCache.set(h, c); }
    return c;
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const P = palette;

  // ---------- shared materials ----------
  const GLOW = { value: 0.25 };               // uniform shared by every material
  let nightNow = 0;
  function setNight(n) { nightNow = clamp(n || 0, 0, 1); GLOW.value = 0.22 + 1.5 * nightNow; }
  function glowPatch(sh) {
    sh.uniforms.uGlow = GLOW;
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'attribute float aGlow;\nvarying float vGlow;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform float uGlow;\nvarying float vGlow;\nvoid main() {')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlow;');
  }
  const matCache = new Map();
  function getMat(T, quality, kind) {
    const key = quality + kind;
    let m = matCache.get(key);
    if (m) return m;
    const low = quality === 'low';
    const o = { vertexColors: true };
    if (kind === 'double') o.side = T.DoubleSide;
    if (kind === 'water') { o.transparent = true; o.opacity = 0.8; o.depthWrite = false; }
    if (low) m = new T.MeshLambertMaterial(o);
    else { o.roughness = kind === 'water' ? 0.25 : 0.88; o.metalness = kind === 'water' ? 0.1 : 0.02; m = new T.MeshStandardMaterial(o); }
    m.onBeforeCompile = glowPatch;
    matCache.set(key, m);
    return m;
  }

  // ---------- mesh builder ----------
  // Non-indexed triangles with per-face colour jitter and a vertical shade ramp: flat shaded
  // via face normals. `push/pop` keep a matrix stack so sub-assemblies can be placed.
  const _cyl = new Map(), _box = new Map(), _sph = new Map();
  class B {
    constructor(T, skinned) {
      this.T = T; this.p = []; this.c = []; this.g = []; this.si = skinned ? [] : null; this.sw = skinned ? [] : null;
      this.bone = [0, 0, 1]; this.m = new T.Matrix4(); this.stack = [];
      this._lm = new T.Matrix4(); this._mm = new T.Matrix4(); this._q = new T.Quaternion(); this._e = new T.Euler(); this._v = new T.Vector3(); this._s = new T.Vector3();
    }
    get tris() { return this.p.length / 9; }
    get verts() { return this.p.length / 3; }
    push(x, y, z, ry, s, rx, rz) {
      this.stack.push(this.m.clone());
      this._e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); this._q.setFromEuler(this._e);
      this._v.set(x || 0, y || 0, z || 0); const k = s == null ? 1 : s; this._s.set(k, k, k);
      this._lm.compose(this._v, this._q, this._s);
      this.m.multiply(this._lm);
      return this;
    }
    pop() { this.m = this.stack.pop(); return this; }
    // low-level vertex (coordinates already final)
    V(x, y, z, c, glow, sk) {
      this.p.push(x, y, z); this.c.push(c[0], c[1], c[2]); this.g.push(glow || 0);
      if (this.si) {
        const b = sk || this.bone;
        this.si.push(b[0], b[1], 0, 0); this.sw.push(b[2], 1 - b[2], 0, 0);
      }
    }
    // transformed point
    X(a) {
      if (!this.stack.length) return a;
      const e = this.m.elements, x = a[0], y = a[1], z = a[2];
      return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
    }
    // one triangle, local points; col = colour or [c0,c1,c2]; o: {glow, j, bone arrays sk:[sa,sb,sc]}
    tri(a, b, c, col, o) {
      o = o || {};
      a = this.X(a); b = this.X(b); c = this.X(c);
      const per = Array.isArray(col[0]);
      let cc = per ? null : col;
      const j = o.j === undefined ? 0.07 : o.j;
      if (!per && j) {
        const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
        const f = 1 + j * (hpos(cx, cy, cz) * 2 - 1), w = j * 0.35 * (hpos(cz, cx, cy + 3) * 2 - 1);
        cc = [col[0] * f * (1 + w), col[1] * f, col[2] * f * (1 - w)];
      }
      const gl = o.glow || 0, sk = o.sk;
      this.V(a[0], a[1], a[2], per ? col[0] : cc, gl, sk && sk[0]);
      this.V(b[0], b[1], b[2], per ? col[1] : cc, gl, sk && sk[1]);
      this.V(c[0], c[1], c[2], per ? col[2] : cc, gl, sk && sk[2]);
    }
    quad(a, b, c, d, col, o) {
      const sk = o && o.sk;
      this.tri(a, b, c, col, sk ? { ...o, sk: [sk[0], sk[1], sk[2]] } : o);
      this.tri(a, c, d, col, sk ? { ...o, sk: [sk[0], sk[2], sk[3]] } : o);
      if (o && o.double) { this.tri(a, c, b, col, sk ? { ...o, sk: [sk[0], sk[2], sk[1]] } : o); this.tri(a, d, c, col, sk ? { ...o, sk: [sk[0], sk[3], sk[2]] } : o); }
    }
    // add a (cached, indexed or not) THREE geometry
    add(g, x, y, z, col, o) {
      o = o || {};
      const pa = g.attributes.position, ix = g.index;
      if (!g.boundingBox) g.computeBoundingBox();
      const y0 = g.boundingBox.min.y, yh = (g.boundingBox.max.y - y0) || 1;
      if (o.q) this._q.copy(o.q); else { this._e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); this._q.setFromEuler(this._e); }
      this._v.set(x, y, z);
      const s = o.s || [1, 1, 1]; this._s.set(s[0], s[1], s[2]);
      this._lm.compose(this._v, this._q, this._s);
      this._mm.multiplyMatrices(this.m, this._lm);
      const e = this._mm.elements;
      const j = o.j === undefined ? 0.1 : o.j, sh = o.shade === undefined ? 0.2 : o.shade, gl = o.glow || 0;
      const n = ix ? ix.count : pa.count;
      const w = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], ly = [0, 0, 0];
      for (let t = 0; t < n; t += 3) {
        for (let k = 0; k < 3; k++) {
          const i = ix ? ix.getX(t + k) : t + k, px = pa.getX(i), py = pa.getY(i), pz = pa.getZ(i);
          w[k][0] = e[0] * px + e[4] * py + e[8] * pz + e[12];
          w[k][1] = e[1] * px + e[5] * py + e[9] * pz + e[13];
          w[k][2] = e[2] * px + e[6] * py + e[10] * pz + e[14];
          ly[k] = (py - y0) / yh;
        }
        const cx = (w[0][0] + w[1][0] + w[2][0]) / 3, cy = (w[0][1] + w[1][1] + w[2][1]) / 3, cz = (w[0][2] + w[1][2] + w[2][2]) / 3;
        const f = 1 + j * (hpos(cx, cy, cz) * 2 - 1), wm = j * 0.35 * (hpos(cz, cx, cy + 3) * 2 - 1);
        const r = col[0] * f * (1 + wm), gg = col[1] * f, b = col[2] * f * (1 - wm);
        for (let k = 0; k < 3; k++) {
          const sk = 1 - sh * (1 - ly[k]);
          this.V(w[k][0], w[k][1], w[k][2], [r * sk, gg * sk, b * sk], gl);
        }
      }
      return this;
    }
    box(sx, sy, sz, x, y, z, col, o) {
      let g = _box.get(0); if (!g) { g = new this.T.BoxGeometry(1, 1, 1); _box.set(0, g); }
      o = o || {}; return this.add(g, x, y, z, col, { ...o, s: [sx, sy, sz] });
    }
    bbox(x0, y0, z0, x1, y1, z1, col, o) { return this.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, col, o); }
    cyl(rt, rb, h, seg, x, y, z, col, o) {
      const rbN = Math.max(rb, rt), key = seg + ':' + (Math.round((Math.min(rt, rb) / (rbN || 1)) * 100)) + ':' + (rt > rb ? 1 : 0);
      let g = _cyl.get(key);
      if (!g) { g = rt > rb ? new this.T.CylinderGeometry(1, Math.min(rt, rb) / rbN, 1, seg) : new this.T.CylinderGeometry(Math.min(rt, rb) / rbN, 1, 1, seg); _cyl.set(key, g); }
      o = o || {}; return this.add(g, x, y, z, col, { ...o, s: [rbN, h, rbN] });
    }
    cone(r, h, seg, x, y, z, col, o) {
      const key = 'c' + seg; let g = _cyl.get(key);
      if (!g) { g = new this.T.ConeGeometry(1, 1, seg); _cyl.set(key, g); }
      o = o || {}; return this.add(g, x, y, z, col, { ...o, s: [r, h, r] });
    }
    sph(r, x, y, z, col, o) {
      o = o || {}; const ws = o.w || 8, hs = o.h || 6, key = ws + ':' + hs + ':' + (o.half ? 1 : 0);
      let g = _sph.get(key);
      if (!g) { g = new this.T.SphereGeometry(1, ws, hs, 0, TAU, 0, o.half ? PI / 2 : PI); _sph.set(key, g); }
      const s = o.s || [1, 1, 1]; return this.add(g, x, y, z, col, { ...o, s: [r * s[0], r * s[1], r * s[2]] });
    }
    ico(r, x, y, z, col, o) {
      o = o || {}; const d = o.d || 0, key = 'i' + d; let g = _sph.get(key);
      if (!g) { g = new this.T.IcosahedronGeometry(1, d); _sph.set(key, g); }
      const s = o.s || [1, 1, 1]; return this.add(g, x, y, z, col, { ...o, s: [r * s[0], r * s[1], r * s[2]] });
    }
    torus(R, r, x, y, z, col, o) {
      o = o || {}; const key = 't' + (o.rs || 5) + ':' + (o.ts || 12) + ':' + Math.round(r / R * 100); let g = _sph.get(key);
      if (!g) { g = new this.T.TorusGeometry(1, r / R, o.rs || 5, o.ts || 12); _sph.set(key, g); }
      return this.add(g, x, y, z, col, { ...o, s: [R, R, R] });
    }
    // oriented beam of square-ish cross section between two points
    beam(x0, y0, z0, x1, y1, z1, t, col, o) {
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.hypot(dx, dy, dz) || 1e-6;
      this._v.set(dx / L, dy / L, dz / L);
      const q = new this.T.Quaternion().setFromUnitVectors(new this.T.Vector3(1, 0, 0), this._v);
      let g = _box.get(0); if (!g) { g = new this.T.BoxGeometry(1, 1, 1); _box.set(0, g); }
      o = o || {}; const tz = o.tz || t;
      return this.add(g, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, col, { shade: 0.1, ...o, q, s: [L, t, tz] });
    }
    // triangular roof prism: base width w (x) at y, ridge height h, length d along z (centred)
    prism(w, h, d, x, y, z, col, colB, o) {
      o = o || {}; const hw = w / 2, hd = d / 2, cA = col, cB = colB || mul(col, 0.8);
      const A = [x - hw, y, z - hd], Bp = [x + hw, y, z - hd], Cp = [x, y + h, z - hd], D = [x - hw, y, z + hd], E = [x + hw, y, z + hd], F = [x, y + h, z + hd];
      this.quad(A, D, F, Cp, cA, { ...o, j: 0.1 });
      this.quad(E, Bp, Cp, F, cB, { ...o, j: 0.1 });
      this.tri(D, E, F, cB, o); this.tri(Bp, A, Cp, cB, o);
      if (!o.open) this.quad(A, Bp, E, D, mul(cB, 0.6), o);
      return this;
    }
    // swept tube along a polyline; r0 -> r1 radii; col may be fn(i)->colour
    tube(pts, r0, r1, seg, col, o) {
      o = o || {}; const n = pts.length, rings = [];
      let pn = null;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n - 1)];
        let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        let nx, ny, nz;
        if (!pn) {
          const rx = Math.abs(ty) > 0.9 ? 1 : 0, ry = 1 - rx;       // reference axis (rx, ry, 0)
          nx = -tz * ry; ny = tz * rx; nz = tx * ry - ty * rx;      // t x ref
        } else {
          const d = pn[0] * tx + pn[1] * ty + pn[2] * tz;
          nx = pn[0] - tx * d; ny = pn[1] - ty * d; nz = pn[2] - tz * d;
        }
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl; pn = [nx, ny, nz];
        const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
        const u = n > 1 ? i / (n - 1) : 0, r = o.rf ? o.rf(u) : lerp(r0, r1, u), ring = [];
        for (let k = 0; k < seg; k++) {
          const an = (k / seg) * TAU, cs = cos(an) * r, sn = sin(an) * r;
          ring.push([pts[i][0] + nx * cs + bx * sn, pts[i][1] + ny * cs + by * sn, pts[i][2] + nz * cs + bz * sn]);
        }
        rings.push(ring);
      }
      for (let i = 0; i < n - 1; i++) {
        const c = typeof col === 'function' ? col(i) : col;
        for (let k = 0; k < seg; k++) {
          const k2 = (k + 1) % seg;
          this.tri(rings[i][k], rings[i][k2], rings[i + 1][k], c, o);
          this.tri(rings[i][k2], rings[i + 1][k2], rings[i + 1][k], c, o);
        }
      }
      if (o.capEnd) { const e = rings[n - 1], c = pts[n - 1], cc = typeof col === 'function' ? col(n - 2) : col; for (let k = 0; k < seg; k++) this.tri(e[k], c, e[(k + 1) % seg], cc, o); }
      return this;
    }
    // lofted surface through rings. rings[i] = { y, rx, rz, x?, z?, c? } (bottom->top);
    // colf = colour or fn(i,k)->colour; o: {a0,a1 (arc), disp(i,k,p)->p, capTop, capBottom, glow}
    loft(rings, seg, colf, o) {
      o = o || {}; const a0 = o.a0 === undefined ? 0 : o.a0, a1 = o.a1 === undefined ? TAU : o.a1;
      const full = Math.abs((a1 - a0) - TAU) < 1e-6, cols = full ? seg : seg + 1, g = [];
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i], row = [];
        for (let k = 0; k < cols; k++) {
          const an = lerp(a0, a1, k / seg);
          let p = [(r.x || 0) + cos(an) * r.rx, r.y, (r.z || 0) + sin(an) * (r.rz === undefined ? r.rx : r.rz)];
          if (o.disp) p = o.disp(i, k, p, an);
          row.push(p);
        }
        g.push(row);
      }
      const nk = full ? seg : seg;
      for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < nk; k++) {
        const k2 = full ? (k + 1) % seg : k + 1;
        const c = typeof colf === 'function' ? colf(i, k) : colf;
        this.quad(g[i][k], g[i + 1][k], g[i + 1][k2], g[i][k2], c, o);
      }
      const fan = (row, y, up, c) => {
        let cx = 0, cz = 0; for (const p of row) { cx += p[0]; cz += p[2]; } cx /= row.length; cz /= row.length;
        for (let k = 0; k < nk; k++) { const k2 = full ? (k + 1) % seg : k + 1; if (up) this.tri(row[k], row[k2], [cx, y, cz], c, o); else this.tri(row[k2], row[k], [cx, y, cz], c, o); }
      };
      if (o.capTop) fan(g[g.length - 1], rings[rings.length - 1].y, true, typeof o.capTop === 'object' ? o.capTop : (typeof colf === 'function' ? colf(rings.length - 2, 0) : colf));
      if (o.capBottom) fan(g[0], rings[0].y, false, typeof o.capBottom === 'object' ? o.capBottom : (typeof colf === 'function' ? colf(0, 0) : colf));
      return g;
    }
    geo() {
      const T = this.T, g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setAttribute('aGlow', new T.Float32BufferAttribute(this.g, 1));
      if (this.si) { g.setAttribute('skinIndex', new T.Uint16BufferAttribute(this.si, 4)); g.setAttribute('skinWeight', new T.Float32BufferAttribute(this.sw, 4)); }
      g.computeVertexNormals();
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }
    mesh(mat) { return new this.T.Mesh(this.geo(), mat); }
  }

  // bone rig from world-space rest positions: defs = [{ n, p: parentIndex|-1, at: [x,y,z] }]
  function makeBones(T, defs) {
    const bones = defs.map((d) => { const b = new T.Bone(); b.name = d.n; return b; });
    defs.forEach((d, i) => {
      if (d.p < 0) { bones[i].position.set(d.at[0], d.at[1], d.at[2]); return; }
      const pa = defs[d.p].at; bones[i].position.set(d.at[0] - pa[0], d.at[1] - pa[1], d.at[2] - pa[2]); bones[d.p].add(bones[i]);
    });
    return bones;
  }
  function skinned(T, geo, mat, bones) {
    const m = new T.SkinnedMesh(geo, mat);
    m.add(bones[0]); m.updateMatrixWorld(true);
    m.bind(new T.Skeleton(bones));
    m.frustumCulled = false;
    return m;
  }

  // damage tint: keeps the original colours and per-triangle burn weights of a geometry
  function charrable(geo) {
    const col = geo.attributes.color, orig = col.array.slice(), n = col.count, wt = new Float32Array(n), pos = geo.attributes.position;
    for (let i = 0; i < n; i += 3) {
      const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const h = hpos(pos.getX(i) + pos.getZ(i), cy, pos.getZ(i + 1));
      const w = 0.35 + 0.65 * h;
      for (let k = 0; k < 3; k++) wt[i + k] = w * (0.8 + 0.2 * clamp(cy / 4, 0, 1.2));
    }
    return { geo, orig, wt, last: -1 };
  }
  function applyChar(ch, dmg) {
    const q = Math.round(dmg * 20) / 20;
    if (q === ch.last) return; ch.last = q;
    const a = ch.geo.attributes.color.array, o = ch.orig, w = ch.wt;
    for (let i = 0; i < w.length; i++) {
      const s = clamp(q * 1.9 * w[i] - 0.12, 0, 1), k = i * 3;
      const lum = 0.1 + 0.25 * (o[k] + o[k + 1] + o[k + 2]) / 3;
      a[k] = lerp(o[k], lum * 0.55, s); a[k + 1] = lerp(o[k + 1], lum * 0.45, s); a[k + 2] = lerp(o[k + 2], lum * 0.42, s);
    }
    ch.geo.attributes.color.needsUpdate = true;
  }

  const qOf = (o) => (o && o.quality === 'low' ? 'low' : 'high');
  const segs = (q, hi, lo) => (q === 'low' ? lo : hi);

  // =====================================================================
  // SHIP — nose +X, length ~3, keel at y = 0
  // =====================================================================
  function ship(T, opts) {
    opts = opts || {};
    const q = qOf(opts), col = C(opts.color || '#ff5a5a'), mat = getMat(T, q, 'solid'), matD = getMat(T, q, 'double');
    const group = new T.Group(), tilt = new T.Group(); group.add(tilt);
    const NS = segs(q, 18, 12), J = segs(q, 10, 6);
    const hullB = new B(T);
    // ---- hull: lofted U sections, plank rows ----
    const X0 = -1.4, X1 = 1.55, phm = 1.2;
    const wOf = (s) => 0.62 * Math.pow(sin(PI * lerp(0.12, 0.985, s)), 0.6);
    const deckOf = (s) => 0.5 + 0.1 * Math.pow(1 - s, 3) + 0.2 * Math.pow(s, 3);
    const keelOf = (s) => 0.32 * Math.pow(s, 3.5) + 0.12 * Math.pow(1 - s, 4);
    const sec = [];
    for (let i = 0; i <= NS; i++) {
      const s = i / NS, x = lerp(X0, X1, s), w = wOf(s), dk = deckOf(s), kl = keelOf(s), row = [];
      for (let j = 0; j <= J; j++) {
        const ph = lerp(-phm, phm, j / J);
        row.push([x, kl + (dk - kl) * (1 - cos(ph)) / (1 - cos(phm)), w * sin(ph) / sin(phm)]);
      }
      sec.push(row);
    }
    const plankA = C(P.plank), plankB = C(P.plankDark), brass = C(P.brass), woodL = C(P.woodLight);
    const bands = new Set([2, 9, NS - 3]);
    for (let i = 0; i < NS; i++) for (let j = 0; j < J; j++) {
      const top = j === 0 || j === J - 1;
      let c = (j % 2 ? plankA : mix(plankA, plankB, 0.45));
      if (top) c = mix(plankB, [0.05, 0.03, 0.02], 0.2);
      if (bands.has(i)) c = brass;
      hullB.quad(sec[i][j], sec[i][j + 1], sec[i + 1][j + 1], sec[i + 1][j], c, { j: 0.08 });
    }
    // transom plate
    for (let j = 0; j < J; j++) hullB.tri(sec[0][j], sec[0][j + 1], [X0, (sec[0][0][1] + sec[0][J][1]) / 2 + 0.2, 0], mix(plankB, plankA, 0.3));
    // deck planks
    for (let i = 0; i < NS; i++) hullB.quad([sec[i][J][0], sec[i][J][1] + 0.005, sec[i][J][2]], [sec[i][0][0], sec[i][0][1] + 0.005, sec[i][0][2]], [sec[i + 1][0][0], sec[i + 1][0][1] + 0.005, sec[i + 1][0][2]], [sec[i + 1][J][0], sec[i + 1][J][1] + 0.005, sec[i + 1][J][2]], i % 2 ? woodL : mix(woodL, plankA, 0.5), { j: 0.05 });
    // gunwale rails, keel, bowsprit
    for (const sg of [-1, 1]) {
      const pts = []; for (let i = 0; i <= NS; i += 2) { const r = sec[i][sg < 0 ? 0 : J]; pts.push([r[0], r[1] + 0.05, r[2] * 1.02]); }
      hullB.tube(pts, 0.03, 0.03, 4, brass, { j: 0.05 });
      // rail posts
      for (let i = 2; i <= NS - 2; i += 3) { const r = sec[i][sg < 0 ? 0 : J]; hullB.box(0.035, 0.12, 0.035, r[0], r[1] + 0.1, r[2] * 1.0, C(P.woodDark)); }
    }
    hullB.beam(X0 + 0.1, 0.1, 0, X1 - 0.05, keelOf(1) + 0.02, 0, 0.06, C(P.woodDark), { tz: 0.08 });
    hullB.beam(X1 - 0.1, 0.62, 0, X1 + 0.28, 0.82, 0, 0.05, brass);
    // cabin
    const cx = -0.1, wall = C('#e2c394'), beam = C(P.woodDark), roofC = C(P.roof);
    hullB.bbox(cx - 0.62, 0.5, -0.4, cx + 0.62, 1.02, 0.4, wall, { j: 0.07 });
    for (const sx of [-0.62, 0.62]) for (const sz of [-0.4, 0.4]) hullB.bbox(cx + sx - 0.035, 0.5, sz - 0.035, cx + sx + 0.035, 1.04, sz + 0.035, beam);
    hullB.bbox(cx - 0.66, 0.97, -0.44, cx + 0.66, 1.03, 0.44, beam);
    hullB.bbox(cx - 0.66, 0.74, -0.405, cx + 0.66, 0.77, 0.405, beam, { j: 0.04 });
    for (const sz of [-1, 1]) for (const wx of [-0.38, 0, 0.38]) {
      hullB.box(0.17, 0.17, 0.02, cx + wx, 0.86, sz * 0.405, C(P.glass), { glow: 1, shade: 0, j: 0.04 });
      hullB.box(0.2, 0.025, 0.03, cx + wx, 0.76, sz * 0.41, beam);
    }
    for (const sz of [-1, 1]) hullB.box(0.02, 0.17, 0.15, cx + 0.62, 0.86, sz * 0.2, C(P.glass), { glow: 1, shade: 0, j: 0.04 });
    hullB.box(0.02, 0.28, 0.2, cx - 0.62, 0.66, 0, C(P.woodDark));             // back door
    hullB.push(cx, 1.0, 0, PI / 2); hullB.prism(1.0, 0.3, 1.42, 0, 0, 0, roofC, mul(roofC, 0.78)); hullB.pop();
    hullB.bbox(cx - 0.72, 0.99, -0.03, cx + 0.72, 1.02, 0.03, C(P.roofDark));
    // exhaust pipe
    hullB.tube([[-0.55, 1.05, 0.22], [-0.56, 1.28, 0.22], [-0.6, 1.5, 0.22]], 0.045, 0.04, 6, brass, { j: 0.06 });
    hullB.cone(0.075, 0.1, 6, -0.6, 1.53, 0.22, C(P.brassDark), { rx: PI });
    hullB.torus(0.05, 0.012, -0.56, 1.25, 0.22, C(P.brassDark), { rx: PI / 2 });
    // masts for the cloth sails (stern deck)
    for (const sz of [-1, 1]) hullB.cyl(0.02, 0.03, 0.85, 5, -1.1, 0.95, sz * 0.4, C(P.woodDark));
    // lantern posts (the lanterns themselves are glowing meshes parts)
    const lant = [];
    for (const sz of [-1, 1]) {
      const lx = 1.05, lz = sz * 0.3, ly = 0.65;
      hullB.cyl(0.018, 0.022, 0.4, 5, lx, ly + 0.2, lz, brass);
      hullB.beam(lx, ly + 0.39, lz, lx + 0.1, ly + 0.36, lz + sz * 0.05, 0.02, brass);
      const gx = lx + 0.1, gy = ly + 0.24, gz = lz + sz * 0.05;
      hullB.cone(0.085, 0.07, 6, gx, gy + 0.11, gz, C(P.brassDark));
      hullB.cyl(0.062, 0.062, 0.14, 6, gx, gy, gz, C(P.glass), { glow: 1, shade: 0, j: 0.04 });
      hullB.cyl(0.075, 0.06, 0.03, 6, gx, gy - 0.085, gz, C(P.brassDark));
      for (let k = 0; k < 4; k++) hullB.box(0.012, 0.15, 0.012, gx + cos(k * PI / 2 + PI / 4) * 0.062, gy, gz + sin(k * PI / 2 + PI / 4) * 0.062, brass);
      lant.push([gx, gy, gz]);
    }
    // prop nacelles + struts
    const propAt = [[0.05, 0.4, -0.8], [0.05, 0.4, 0.8], [-1.52, 0.6, 0]];
    for (const sz of [-1, 1]) {
      hullB.beam(-0.1, 0.4, sz * 0.5, -0.1, 0.4, sz * 0.8, 0.05, brass);
      hullB.beam(-0.35, 0.62, sz * 0.5, -0.1, 0.42, sz * 0.78, 0.035, C(P.woodDark));
      hullB.cyl(0.07, 0.06, 0.22, 7, -0.06, 0.4, sz * 0.8, C(P.brassDark), { rz: PI / 2 });
    }
    hullB.cyl(0.08, 0.07, 0.2, 7, -1.46, 0.6, 0, C(P.brassDark), { rz: PI / 2 });
    // stern lamp under the cabin door + small anchor decor
    hullB.torus(0.05, 0.012, 1.34, 0.4, 0.12, brass, { rx: PI / 2 });
    const hull = hullB.mesh(mat);
    tilt.add(hull);

    // ---- gas envelope ----
    const eB = new B(T), EY = 2.2, EN = segs(q, 14, 10), ES = segs(q, 16, 12), EX0 = -1.5, EX1 = 1.55;
    const profile = (u) => Math.pow(Math.max(sin(PI * lerp(0.012, 0.988, u)), 0.001), 0.62) * (0.84 + 0.2 * u);
    const envRad = (x) => { const u = (x - EX0) / (EX1 - EX0); return profile(clamp(u, 0, 1)); };
    const ring = (u, k) => ({ y: lerp(EX0, EX1, u), rx: 0.86 * profile(u) * k, rz: 0.8 * profile(u) * k });
    const rings = []; for (let i = 0; i <= EN; i++) rings.push(ring(i / EN, 1));
    const gore = C(P.white);
    eB.push(0, EY, 0, 0, 1, 0, -PI / 2);
    eB.loft(rings, ES, (i, k) => {
      let c = mix(col, gore, (k % 2) * 0.1 + (i % 2) * 0.03);
      if (i === 0 || i === EN - 1) c = mul(c, 0.8);
      return c;
    }, { j: 0.05, capTop: mul(col, 0.8), capBottom: mul(col, 0.8) });
    // rope seams between gores + hoops
    const rope = C(P.rope), ropeD = C(P.brassDark);
    for (let k = 0; k < ES; k += 2) {
      const a = (k / ES) * TAU, d = 0.035;
      eB.loft(rings.map((r) => ({ y: r.y, rx: r.rx * 1.014, rz: r.rz * 1.014 })), 1, rope, { a0: a - d, a1: a + d, j: 0.06 });
    }
    for (const u of [0.22, 0.5, 0.78]) {
      const r = ring(u, 1.018), y = r.y;
      eB.loft([{ ...r, y: y - 0.022 }, { ...r, y: y + 0.022 }], ES, ropeD, { j: 0.05 });
    }
    eB.pop();
    // tail fins (envelope space)
    const finC = mul(col, 0.62);
    for (const an of [PI / 2, PI / 2 + TAU / 3, PI / 2 + TAU * 2 / 3]) {
      const dy = sin(an), dz = cos(an);
      const P0 = (x, rr) => [x, EY + dy * 0.86 * rr, dz * 0.8 * rr];
      const r0 = envRad(-0.7), r1 = envRad(-1.4), r2 = envRad(-1.18);
      const a = P0(-0.55, envRad(-0.55) * 0.98), b = P0(-1.42, r1 * 0.98), c = P0(-1.66, r1 + 0.16), d = P0(-1.1, r2 + 0.3);
      eB.quad(a, b, c, d, finC, { double: true, j: 0.06 });
      eB.tri(a, d, P0(-0.8, r0 + 0.1), mul(finC, 1.1), { j: 0.05 });
    }
    // crest discs
    const zc = 0.8 * envRad(0.35), crestCol = mul(col, 0.55);
    for (const sg of [-1, 1]) {
      eB.cyl(0.29, 0.29, 0.03, segs(q, 16, 10), 0.35, EY, sg * (zc + 0.002), C(P.white), { rx: PI / 2, shade: 0, j: 0.03 });
      eB.cyl(0.235, 0.235, 0.03, segs(q, 16, 10), 0.35, EY, sg * (zc + 0.016), crestCol, { rx: PI / 2, shade: 0, j: 0.05 });
      // five-point star emblem
      const zz = sg * (zc + 0.034), pts = [];
      for (let k = 0; k < 10; k++) { const an = PI / 2 + k * PI / 5, r = k % 2 ? 0.055 : 0.155; pts.push([0.35 + cos(an) * r, EY + sin(an) * r, zz]); }
      for (let k = 0; k < 10; k++) { const a = pts[k], b = pts[(k + 1) % 10]; if (sg > 0) eB.tri([0.35, EY, zz], a, b, C(P.white), { j: 0, glow: 0.08 }); else eB.tri([0.35, EY, zz], b, a, C(P.white), { j: 0, glow: 0.08 }); }
    }
    // harness ropes from deck to the envelope belly
    for (const sx of [-0.9, -0.45, 0, 0.45, 0.9]) for (const sg of [-1, 1]) {
      const ex = sx * 1.0, rr = envRad(ex), ey = EY - 0.86 * rr * cos(0.95), ez = sg * 0.8 * rr * sin(0.95);
      eB.tube([[sx, 0.58, sg * 0.45], [ex, ey, ez]], 0.014, 0.014, 3, rope, { j: 0.05 });
    }
    const balloonMesh = eB.mesh(mat); balloonMesh.position.y = -0.6; const balloon = new T.Group(); balloon.position.y = 0.6; balloon.add(balloonMesh); tilt.add(balloon);

    // ---- propellers ----
    const props = [];
    const mkProp = (R, nb, at) => {
      const b = new B(T);
      b.cone(0.07, 0.14, 6, 0.06, 0, 0, C(P.brass), { rz: -PI / 2 });
      for (let k = 0; k < nb; k++) {
        b.push(0, 0, 0, 0, 1, (k / nb) * TAU);
        b.box(0.022, R, 0.1, 0, R * 0.55, 0, k % 2 ? C(P.woodLight) : C(P.wood), { ry: 0.6, shade: 0.15 });
        b.box(0.03, 0.04, 0.115, 0, R * 1.02, 0, C(P.brass), { ry: 0.6, shade: 0 });
        b.pop();
      }
      const m = b.mesh(mat); m.position.set(at[0], at[1], at[2]); tilt.add(m); props.push(m);
    };
    mkProp(0.3, 3, propAt[0]); mkProp(0.3, 3, propAt[1]); mkProp(0.33, 4, propAt[2]);

    // ---- cloth sails (CPU-animated flutter) ----
    const sb = [], su = [], sg2 = [];
    const sailC = mix(col, C(P.cloth), 0.55), sailC2 = C(P.cloth);
    const SU = 4, SV = 3;
    for (const sz of [-1, 1]) {
      const p00 = [-1.1, 0.72, sz * 0.4], p01 = [-1.1, 1.36, sz * 0.4], p10 = [-1.62, 0.86, sz * 0.52], p11 = [-1.42, 1.18, sz * 0.46];
      const at = (u, v) => [lerp(lerp(p00[0], p10[0], u), lerp(p01[0], p11[0], u), v), lerp(lerp(p00[1], p10[1], u), lerp(p01[1], p11[1], u), v), lerp(lerp(p00[2], p10[2], u), lerp(p01[2], p11[2], u), v)];
      for (let i = 0; i < SU; i++) for (let j = 0; j < SV; j++) {
        const c = (i + j) % 2 ? sailC : mix(sailC, sailC2, 0.5), uv = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map((a) => [a[0] / SU, a[1] / SV]);
        const ps = uv.map((a) => at(a[0], a[1]));
        for (const t3 of (sz > 0 ? [[0, 1, 2], [0, 2, 3]] : [[0, 2, 1], [0, 3, 2]])) for (const k of t3) { sb.push(ps[k][0], ps[k][1], ps[k][2]); su.push(uv[k][0]); sg2.push(sz); }
      }
    }
    const sailCols = []; { let n = 0; for (const sz of [-1, 1]) for (let i = 0; i < SU; i++) for (let j = 0; j < SV; j++) { const c = (i + j) % 2 ? sailC : mix(sailC, sailC2, 0.5); for (let k = 0; k < 6; k++) sailCols.push(c[0], c[1], c[2]); n++; } }
    const sailGeo = new T.BufferGeometry(); const sailPos = new T.Float32BufferAttribute(sb.slice(), 3);
    sailGeo.setAttribute('position', sailPos); sailGeo.setAttribute('color', new T.Float32BufferAttribute(sailCols, 3));
    sailGeo.setAttribute('aGlow', new T.Float32BufferAttribute(new Array(sb.length / 3).fill(0), 1));
    sailGeo.computeVertexNormals();
    const sailMesh = new T.Mesh(sailGeo, matD); tilt.add(sailMesh);
    const sails = [sailMesh];

    // ---- cargo net ----
    const nb = new B(T), netC = C(P.rope), netD = mul(netC, 0.45);
    nb.loft([{ y: 0.02, rx: 0.5, rz: 0.27 }, { y: -0.1, rx: 0.52, rz: 0.3 }, { y: -0.26, rx: 0.4, rz: 0.24 }, { y: -0.4, rx: 0.14, rz: 0.1 }], 10, (i, k) => ((i + k) % 2 ? netC : netD), { capBottom: netD, j: 0.06 });
    nb.box(0.2, 0.14, 0.2, 0.05, -0.17, 0.02, C(P.plank), { j: 0.2 });
    for (const [px, pz] of [[0.4, 0.2], [-0.4, 0.2], [0.4, -0.2], [-0.4, -0.2]]) nb.tube([[px, 0.02, pz], [px * 1.05, 0.12, pz * 1.1]], 0.012, 0.012, 3, netC);
    const cargo = nb.mesh(mat); tilt.add(cargo);

    // ---- anchors ----
    const mkA = (x, y, z, n) => { const o = new T.Object3D(); o.name = n; o.position.set(x, y, z); tilt.add(o); return o; };
    const anchors = { smoke: mkA(-0.6, 1.62, 0.22, 'smoke'), hook: mkA(X1 + 0.3, 0.84, 0, 'hook'), spray: mkA(0.9, 0.7, 0, 'spray'), cargo };
    const lanterns = lant.map((p, i) => mkA(p[0], p[1], p[2], 'lantern' + i));
    const crest = mkA(0.35, EY, 0, 'crest'); crest.position.y = EY;
    return { group, tilt, hull, props, balloon, sails, lanterns, crest, anchors, _sail: { pos: sailPos, base: sb, u: su, side: sg2, mesh: sailMesh }, _ph: 0, _lt: null, _bank: 0, _boost: 0 };
  }

  function animateShip(s, p) {
    p = p || {};
    const t = p.t || 0, dt = s._lt == null ? 0 : clamp(t - s._lt, 0, 0.25); s._lt = t;
    const speed = p.speed || 0, boost = p.boosting ? 1 : 0, stun = p.stunned ? 1 : 0, k = 1 - Math.exp(-8 * dt);
    s._boost = lerp(s._boost, boost, k); s._bank = lerp(s._bank, clamp(p.bank || 0, -1, 1), k);
    const rate = (9 + speed * 1.5 + s._boost * 26) * (stun ? 0.2 + 0.3 * Math.pow(sin(t * 13), 2) : 1);
    s._ph += rate * dt;
    s.props[0].rotation.x = s._ph; s.props[1].rotation.x = -s._ph * 0.93; s.props[2].rotation.x = s._ph * 1.1;
    // roll into turns (+bank = left turn), nose dips when boosting, wobble when stunned
    s.tilt.rotation.x = -s._bank * 0.36 + (stun ? sin(t * 11) * 0.09 : 0);
    s.tilt.rotation.z = -0.06 * s._boost + (stun ? sin(t * 8.3) * 0.07 : 0) + clamp(speed * 0.0025, 0, 0.04);
    s.tilt.position.y = sin(t * 2.1) * 0.025;
    s.balloon.rotation.x = s._bank * 0.07 + sin(t * 1.3) * 0.012;
    const sq = 1 + 0.035 * s._boost;
    s.balloon.scale.set(sq, 1 - 0.025 * s._boost + 0.012 * sin(t * 2.3), 1 + 0.012 * sin(t * 2.3 + 1));
    // sail flutter (travelling wave grows towards the free edge)
    const A = 0.05 + speed * 0.006 + s._boost * 0.07, f = 7 + speed * 0.3 + s._boost * 8, sp = s._sail, arr = sp.pos.array, b = sp.base;
    for (let i = 0; i < sp.u.length; i++) {
      const u = sp.u[i], w = sin(t * f - u * 5.0 + sp.side[i] * 1.7) + 0.4 * sin(t * f * 1.9 - u * 9);
      arr[i * 3] = b[i * 3] - A * 0.4 * u * Math.abs(w) * 0.5;
      arr[i * 3 + 1] = b[i * 3 + 1] + A * 0.2 * u * w * 0.5;
      arr[i * 3 + 2] = b[i * 3 + 2] + A * u * w * sp.side[i] * 0.9 + (stun ? 0.04 * u : 0);
    }
    sp.pos.needsUpdate = true; sp.mesh.geometry.computeVertexNormals();
    if (p.night != null) setNight(p.night);
  }

  // =====================================================================
  // CRATE, HARPOON, PERSON
  // =====================================================================
  function crate(T, res, opts) {
    const q = qOf(opts), b = new B(T), wood = C(P.plank), dark = C(P.woodDark);
    const S = 0.5;
    b.bbox(-S / 2, 0, -S / 2, S / 2, S, S / 2, res === 'kristall' ? C('#5f5864') : wood, { j: 0.12 });
    for (let k = 0; k < 4; k++) b.bbox(-S / 2 - 0.01, 0.02 + k * 0.12, -S / 2 - 0.01, S / 2 + 0.01, 0.1 + k * 0.12, S / 2 + 0.01, k % 2 ? wood : mix(wood, dark, 0.3), { j: 0.15, shade: 0.05 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.bbox(sx * S / 2 - 0.03, 0, sz * S / 2 - 0.03, sx * S / 2 + 0.03, S + 0.01, sz * S / 2 + 0.03, dark);
    b.bbox(-S / 2 - 0.02, S - 0.03, -S / 2 - 0.02, S / 2 + 0.02, S + 0.02, S / 2 + 0.02, dark);
    b.beam(-S / 2, 0.06, S / 2 + 0.015, S / 2, S - 0.06, S / 2 + 0.015, 0.035, dark);
    for (const sx of [-1, 1]) b.box(0.035, 0.035, 0.02, sx * 0.22, 0.44, S / 2 + 0.03, C(P.brass), { shade: 0 });
    if (res === 'kristall') {
      const cs = [P.crystal, P.crystalViolet, P.crystal, P.crystalDeep, P.crystalViolet];
      cs.forEach((c, i) => {
        const a = i * 1.7, r = i ? 0.1 : 0, h = 0.2 + (i % 3) * 0.06;
        b.push(cos(a) * r, S + h / 2 - 0.02, sin(a) * r, 0, 1, (i % 2 ? 0.25 : -0.2), (i % 3 - 1) * 0.2);
        b.cyl(0.0, 0.05, h, 5, 0, 0, 0, C(c), { glow: 0.9, shade: 0.25 }); b.pop();
      });
    } else {
      b.bbox(-0.17, S, -0.17, 0.17, S + 0.02, 0.17, mix(wood, dark, 0.4), { j: 0.2 });
      b.sph(0.1, 0.0, S + 0.05, 0.05, C(P.cloth), { s: [1.2, 0.5, 1.2], j: 0.1 });
    }
    return b.mesh(getMat(T, q, 'solid'));
  }

  function harpoon(T, opts) {
    const q = qOf(opts), b = new B(T);
    b.beam(-0.55, 0, 0, 0.42, 0, 0, 0.04, C(P.wood), { shade: 0.05 });
    b.cone(0.07, 0.3, 4, 0.57, 0, 0, C('#cfd6dc'), { rz: -PI / 2, j: 0.06 });
    for (const sz of [-1, 1]) b.cone(0.045, 0.16, 3, 0.42, 0, sz * 0.05, C('#a9b2ba'), { rz: -PI / 2 + sz * 0.5 });
    b.cyl(0.055, 0.055, 0.04, 6, 0.4, 0, 0, C(P.brass), { rz: PI / 2 });
    for (const sz of [-1, 1]) b.quad([-0.55, 0, 0], [-0.3, 0.0, 0], [-0.33, 0, sz * 0.12], [-0.58, 0, sz * 0.14], C(P.clothRed), { double: true });
    b.quad([-0.55, 0, 0], [-0.3, 0, 0], [-0.33, 0.12, 0], [-0.58, 0.14, 0], C(P.clothRed), { double: true });
    b.tube([[-0.2, 0, 0.02], [-0.3, 0.05, 0.12], [-0.5, -0.02, 0.15], [-0.75, -0.1, 0.12]], 0.012, 0.012, 3, C(P.rope));
    return b.mesh(getMat(T, q, 'double'));
  }

  const personGeo = new Map();
  function person(T, opts) {
    opts = opts || {}; const q = qOf(opts), colH = opts.color || '#4a90d9', key = q + colH;
    const col = C(colH), skin = C('#f0c39a'), hairs = ['#5a3a22', '#2a2320', '#c28a3a', '#8a4a2a'], hair = C(hairs[Math.floor(hpos(col[0] * 9, col[1] * 7, col[2] * 5) * 4) % 4]);
    let geo = personGeo.get(key);
    const defs = [{ n: 'hips', p: -1, at: [0, 0.2, 0] }, { n: 'torso', p: 0, at: [0, 0.2, 0] }, { n: 'head', p: 1, at: [0, 0.4, 0] },
      { n: 'armL', p: 1, at: [0, 0.37, 0.092] }, { n: 'armR', p: 1, at: [0, 0.37, -0.092] }, { n: 'legL', p: 0, at: [0, 0.2, 0.04] }, { n: 'legR', p: 0, at: [0, 0.2, -0.04] }];
    if (!geo) {
      const b = new B(T, true), bone = (i) => { b.bone = [i, 0, 1]; };
      bone(5); b.box(0.06, 0.2, 0.065, 0, 0.1, 0.04, C('#4a3a30')); b.box(0.085, 0.05, 0.07, 0.01, 0.025, 0.04, C('#2a2020'));
      bone(6); b.box(0.06, 0.2, 0.065, 0, 0.1, -0.04, C('#4a3a30')); b.box(0.085, 0.05, 0.07, 0.01, 0.025, -0.04, C('#2a2020'));
      bone(1); b.box(0.11, 0.2, 0.16, 0, 0.3, 0, col); b.box(0.118, 0.035, 0.168, 0, 0.215, 0, C('#3a2a1e'), { shade: 0 });
      b.box(0.04, 0.04, 0.03, 0.058, 0.215, 0, C(P.brass), { shade: 0 });
      bone(3); b.box(0.045, 0.16, 0.045, 0, 0.29, 0.092, col); b.sph(0.025, 0, 0.2, 0.092, skin, { w: 5, h: 4 });
      bone(4); b.box(0.045, 0.16, 0.045, 0, 0.29, -0.092, col); b.sph(0.025, 0, 0.2, -0.092, skin, { w: 5, h: 4 });
      bone(2); b.sph(0.075, 0, 0.47, 0, skin, { w: 7, h: 5 });
      for (const sz of [-1, 1]) b.box(0.012, 0.018, 0.014, 0.07, 0.475, sz * 0.032, C('#2a1a14'), { shade: 0, j: 0 });
      b.sph(0.081, -0.008, 0.49, 0, hair, { w: 7, h: 4, half: true, s: [1, 0.9, 1] });
      b.cone(0.06, 0.1, 6, -0.02, 0.585, 0, mix(col, C(P.white), 0.2), { rz: 0.15 });
      geo = b.geo(); personGeo.set(key, geo);
    }
    const bones = makeBones(T, defs), mesh = skinned(T, geo, getMat(T, q, 'solid'), bones);
    const group = new T.Group(); group.add(mesh);
    const [hips, torso, head, armL, armR, legL, legR] = bones;
    let st = { walk: 0, carry: 0, cheer: 0, panic: 0 };
    function animate(t, a) {
      a = a || {};
      const walk = a.walk || 0, carry = a.carry ? 1 : 0, cheer = a.cheer ? 1 : 0, panic = a.panic ? 1 : 0;
      const ph = t * (6 + 5 * Math.min(walk, 1.5)) + (panic ? t * 8 : 0), sw = Math.min(walk, 1.2) * 0.75 + panic * 0.7;
      legL.rotation.z = sin(ph) * sw; legR.rotation.z = -sin(ph) * sw;
      let al = -sin(ph) * sw * 0.8, ar = sin(ph) * sw * 0.8, ax = 0;
      if (carry) { al = ar = 1.25; ax = 0; }
      if (cheer) { const w = sin(t * 9); al = PI - 0.25 + w * 0.25; ar = PI - 0.25 - w * 0.25; ax = 0.35; }
      if (panic) { al = PI * 0.75 + sin(t * 24) * 0.7; ar = PI * 0.75 + sin(t * 24 + 2) * 0.7; ax = 0.5; }
      armL.rotation.set(-ax, 0, al); armR.rotation.set(ax, 0, ar);
      hips.position.y = 0.2 + Math.abs(sin(ph)) * 0.02 * Math.min(walk, 1.2) + (cheer ? Math.abs(sin(t * 9)) * 0.05 : 0) + (panic ? Math.abs(sin(t * 20)) * 0.03 : 0);
      torso.rotation.z = -0.08 * Math.min(walk, 1) - (carry ? 0.1 : 0) + (cheer ? 0.08 : 0);
      torso.rotation.x = panic ? sin(t * 17) * 0.12 : 0;
      head.rotation.y = panic ? sin(t * 22) * 0.4 : sin(t * 0.9) * 0.15 * (1 - Math.min(walk, 1));
      head.rotation.z = cheer ? -0.2 : 0;
    }
    animate(0, {});
    return { group, animate, mesh };
  }

  // =====================================================================
  // FLOATING ROCK (shared by the home island and the islets)
  // top surface on a polar grid + layered cliff bands narrowing into a rock cone.
  // =====================================================================
  function floatingRock(b, c) {
    const R = c.R, NR = c.NR, NT = c.NT, sd = c.seed || 1;
    const RRf = (th) => R * (1 + c.rimAmp * (fbm(cos(th) * c.rimF + sd * 3.1, sin(th) * c.rimF + sd * 1.7) - 0.5) * 2);
    const top = [];
    for (let i = 0; i <= NR; i++) {
      const row = [], t = i / NR;
      for (let k = 0; k < NT; k++) {
        const th = (k / NT) * TAU, rr = Math.pow(t, 0.92) * RRf(th), x = cos(th) * rr, z = sin(th) * rr;
        row.push([x, c.hOf(x, z, t, th), z]);
      }
      top.push(row);
    }
    // top triangles (counter-clockwise seen from above)
    for (let i = 0; i < NR; i++) for (let k = 0; k < NT; k++) {
      const k2 = (k + 1) % NT, A = top[i][k], Bp = top[i + 1][k], Cc = top[i + 1][k2], D = top[i][k2];
      const col = (p0, p1, p2) => c.topCol((p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3, i / NR);
      if (i === 0) b.tri(A, Cc, Bp, col(A, Bp, Cc), { j: 0.04 });
      else { b.tri(A, Cc, Bp, col(A, Bp, Cc), { j: 0.04 }); b.tri(A, D, Cc, col(A, D, Cc), { j: 0.04 }); }
    }
    // cliff bands
    const bands = [top[NR]];
    const prof = c.profile, amp = c.noiseAmp;
    for (let bi = 0; bi < prof.length; bi++) {
      const [dep, rf] = prof[bi], row = [], tip = bi === prof.length - 1;
      for (let k = 0; k < NT; k++) {
        const th = (k / NT) * TAU, nz = (fbm(cos(th) * 2.4 + bi * 4.1 + sd, sin(th) * 2.4 + bi * 2.3) - 0.5) * 2;
        const rr = RRf(th) * rf * (1 + nz * amp * 0.12) + (tip ? 0 : nz * amp * 0.3);
        const hy = -dep + (hash2(k * 13 + bi, bi * 7 + sd) - 0.5) * amp * 0.5 * (tip ? 0 : 1);
        row.push([cos(th) * rr + (tip ? c.tipX || 0 : 0), hy, sin(th) * rr + (tip ? c.tipZ || 0 : 0)]);
      }
      bands.push(row);
    }
    for (let bi = 0; bi < bands.length - 1; bi++) for (let k = 0; k < NT; k++) {
      const k2 = (k + 1) % NT, A = bands[bi][k], A2 = bands[bi][k2], B1 = bands[bi + 1][k], B2 = bands[bi + 1][k2];
      const col = c.bandCol(bi, k, (A[0] + B2[0]) / 2, (A[1] + B1[1]) / 2, (A[2] + B2[2]) / 2);
      b.quad(A, A2, B2, B1, col, { j: 0.09 });
    }
    return { RRf, top, bands };
  }

  // hanging roots / vines from points on the cliff
  function hangRoots(b, rnd, bands, n, scale, cols) {
    for (let i = 0; i < n; i++) {
      const bi = 1 + Math.floor(rnd() * Math.min(3, bands.length - 2)), k = Math.floor(rnd() * bands[bi].length), p = bands[bi][k];
      const o = Math.hypot(p[0], p[2]) || 1, ox = p[0] / o, oz = p[2] / o, len = (1.4 + rnd() * 3.2) * scale, sw = (rnd() - 0.5) * 0.9 * scale;
      const pts = []; const m = 5;
      for (let s = 0; s <= m; s++) { const u = s / m; pts.push([p[0] * 0.97 + ox * (0.15 + 0.3 * sin(u * PI)) * scale + sw * u * u, p[1] - len * u, p[2] * 0.97 + oz * (0.15 + 0.3 * sin(u * PI)) * scale + sw * 0.5 * sin(u * 3)]); }
      const th = (0.1 + rnd() * 0.08) * scale;
      b.tube(pts, th, th * 0.15, 4, (s) => (s < 2 ? cols[0] : cols[1]), { j: 0.12 });
      if (rnd() < 0.55) { const e = pts[m]; b.ico(0.1 * scale + 0.03, e[0], e[1] - 0.02, e[2], C(rnd() < 0.5 ? P.leaf : P.grassLight), { j: 0.15, shade: 0.1 }); }
    }
  }

  // crystal made of a hex prism and a pointed tip. base at (x,y,z); tilt (rx,rz); glow base/tip
  function crystalAt(b, x, y, z, r, h, col, tipCol, o) {
    o = o || {};
    b.push(x, y, z, o.ry || 0, 1, o.rx || 0, o.rz || 0);
    b.cyl(r * 0.92, r, h * 0.72, 6, 0, h * 0.36, 0, col, { glow: 0.65, shade: 0.3, j: 0.08 });
    b.cone(r * 0.92, h * 0.4, 6, 0, h * 0.72 + h * 0.2, 0, tipCol, { glow: 1.0, shade: 0.1, j: 0.06 });
    b.pop();
  }

  // =====================================================================
  // HOME ISLAND
  // =====================================================================
  function homeIsland(T, home, opts) {
    opts = opts || {}; home = home || {};
    const q = qOf(opts), R = home.r || 16, rnd = rng(1234), low = q === 'low';
    const slots = home.slots || Array.from({ length: 7 }, (_, i) => ({ i, x: i ? 10 * cos((i - 1) * PI / 3) : 0, y: i ? 10 * sin((i - 1) * PI / 3) : 0, angle: (i - 1) * PI / 3 }));
    const group = new T.Group(), b = new B(T), w = new B(T);
    const matS = getMat(T, q, 'solid'), matW = getMat(T, q, 'water');
    // ---- layout ----
    const pond = { x: 0, z: -10.6, r: 2.15 };
    const stream = [[0, -12.5], [0.55, -13.6], [-0.2, -14.7], [0.35, -15.7], [0.2, -17.2]];
    const stor = { x: 4.7, z: 13.0, hw: 1.6, hd: 1.2 };
    const segD = (x, z, a, c) => { const dx = c[0] - a[0], dz = c[1] - a[1], l2 = dx * dx + dz * dz || 1, t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1); return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)); };
    const streamD = (x, z) => { let d = 9; for (let i = 0; i < stream.length - 1; i++) d = Math.min(d, segD(x, z, stream[i], stream[i + 1])); return d; };
    const RRth = (th) => R * (1 + 0.05 * (fbm(cos(th) * 1.9 + 3.1, sin(th) * 1.9 + 1.7) - 0.5) * 2);
    // ---- walk graph ----
    const nodes = [[0, 19.4], [0, RRth(PI / 2) - 0.7], [0, 13.0], [stor.x - stor.hw - 0.45, 13.0]];
    const S0 = nodes.length; for (let k = 0; k < 6; k++) nodes.push([cos(k * PI / 3) * 7.6, sin(k * PI / 3) * 7.6]);
    const M0 = nodes.length; for (let k = 0; k < 6; k++) nodes.push([cos(k * PI / 3 + PI / 6) * 7.0, sin(k * PI / 3 + PI / 6) * 7.0]);
    const A0 = nodes.length; nodes.push([3.4, 0], [0, 3.4], [-3.4, 0], [0, -3.4]);
    const D0 = nodes.length; nodes.push([2.62, 2.62], [-2.62, 2.62], [-2.62, -2.62], [2.62, -2.62]);
    const edges = [[0, 1], [1, 2], [2, 3], [2, M0 + 1]];
    for (let k = 0; k < 6; k++) { edges.push([S0 + k, M0 + k]); edges.push([M0 + k, S0 + (k + 1) % 6]); }
    edges.push([A0, S0], [A0 + 1, M0 + 1], [A0 + 2, S0 + 3], [A0 + 3, M0 + 4]);
    edges.push([A0, D0], [D0, A0 + 1], [A0 + 1, D0 + 1], [D0 + 1, A0 + 2], [A0 + 2, D0 + 2], [D0 + 2, A0 + 3], [A0 + 3, D0 + 3], [D0 + 3, A0]);
    const pathD = (x, z) => { let d = 9; for (const e of edges) d = Math.min(d, segD(x, z, nodes[e[0]], nodes[e[1]])); return d; };
    // ---- terrain ----
    const slotXZ = slots.map((s) => [s.x, s.y]);
    const hOf = (x, z, t, th) => {
      th = th === undefined ? Math.atan2(z, x) : th;
      const r = Math.hypot(x, z), u = r / RRth(th);
      let h = (fbm(x * 0.16 + 3, z * 0.16 + 7) - 0.5) * 1.0 + (fbm(x * 0.5 + 9, z * 0.5 + 2) - 0.5) * 0.25;
      h -= sstep(0.82, 1.0, u) * 0.4;
      h *= 0.35 + 0.65 * sstep(0.5, 1.6, pathD(x, z));
      for (const s of slotXZ) h *= sstep(2.5, 3.7, Math.hypot(x - s[0], z - s[1]));
      h *= sstep(0.0, 1.0, Math.hypot(x, z - 17.0) - 2.2 + (z < 13 ? 9 : 0)); // pier landing stays calm
      const dp = Math.hypot(x - pond.x, z - pond.z) / pond.r;
      h -= 0.62 * (1 - sstep(0.55, 1.5, dp));
      h -= 0.38 * (1 - sstep(0.3, 1.0, streamD(x, z)));
      return h;
    };
    const topCol = (x, y, z, t) => {
      const n = fbm(x * 0.33 + 20, z * 0.33 + 4), n2 = vnoise(x * 1.2, z * 1.2);
      let c = mix(C(P.grassDark), C(P.grassLight), clamp(n * 1.25 - 0.1 + y * 0.35, 0, 1));
      c = mix(c, C(P.moss), sstep(0.62, 0.75, vnoise(x * 0.5 + 40, z * 0.5)) * 0.6);
      c = mix(c, mul(c, 1.12), n2 * 0.3);
      const r = Math.hypot(x, z), rr = RRth(Math.atan2(z, x));
      c = mix(c, C('#b8cf6a'), sstep(rr - 1.3, rr - 0.1, r) * 0.45);
      const dp = Math.hypot(x - pond.x, z - pond.z) / pond.r;
      c = mix(c, C(P.sand), (1 - sstep(1.05, 1.5, dp)) * 0.85);
      c = mix(c, C(P.sand), (1 - sstep(0.4, 0.9, streamD(x, z))) * 0.6);
      for (const s of slotXZ) c = mix(c, C(P.soil), (1 - sstep(2.7, 3.5, Math.hypot(x - s[0], z - s[1]))) * 0.8);
      return c;
    };
    const rock = floatingRock(b, {
      R, NR: segs(q, 24, 14), NT: segs(q, 96, 56), seed: 5, rimAmp: 0.05, rimF: 1.9, noiseAmp: 1.4,
      hOf, topCol,
      profile: [[0.55, 1.0], [1.0, 1.045], [2.3, 0.96], [2.75, 1.01], [4.8, 0.84], [7.6, 0.62], [10.2, 0.4], [12.2, 0.2], [13.9, 0.05]],
      bandCol: (bi, k, x, y, z) => {
        const n = vnoise(k * 0.35 + bi * 7, bi * 3);
        const lay = [mix(C(P.grassDark), C(P.moss), n), C(P.soil), mix(C(P.stoneLight), C('#c9b79a'), n), mix(C('#8a7068'), C('#a0705a'), n), mix(C('#9a8a8a'), C('#b49a84'), n), mix(C('#80728a'), C('#9a7a8a'), n), mix(C('#6f6482'), C('#84708a'), n), mix(C('#625878'), C('#7a6890'), n), C('#6a5c88')];
        return lay[Math.min(bi, lay.length - 1)];
      },
      tipX: 0, tipZ: 0
    });
    const RR = rock.RRf;
    // ---- obstacles for decoration ----
    const obst = [[pond.x, pond.z, pond.r + 0.7], [stor.x, stor.z, 2.6], [0, 17, 2.4], [0, 0, 3.1]];
    for (const s of slotXZ) obst.push([s[0], s[1], 3.3]);
    const free = (x, z, rad) => {
      const r = Math.hypot(x, z), rr = RR(Math.atan2(z, x));
      if (r > rr - 1.0 - rad * 0.5) return false;
      for (const o of obst) if (Math.hypot(x - o[0], z - o[1]) < o[2] + rad) return false;
      if (pathD(x, z) < 0.7 + rad) return false;
      if (streamD(x, z) < 1.0 + rad && z < -9) return false;
      return true;
    };
    const place = (n, rmin, rmax, rad, fn, tries) => {
      let ok = 0, tr = 0;
      while (ok < n && tr++ < (tries || 400)) {
        const a = rnd() * TAU, r = lerp(rmin, rmax, Math.sqrt(rnd())), x = cos(a) * r, z = sin(a) * r;
        if (!free(x, z, rad)) continue;
        fn(x, hOf(x, z), z); obst.push([x, z, rad]); ok++;
      }
    };
    // ---- plots ----
    const stone = C(P.stoneLight), stoneD = C(P.stone);
    slots.forEach((s, si) => {
      const px = s.x, pz = s.y, pr = 2.65, yTop = 0.1, nrg = 3, ns = 14;
      for (let ri = 0; ri < nrg; ri++) for (let k = 0; k < ns; k++) {
        const r0 = (ri / nrg) * pr, r1 = ((ri + 1) / nrg) * pr, a0 = (k / ns) * TAU + ri * 0.2, a1 = ((k + 1) / ns) * TAU + ri * 0.2;
        const p = (r, a) => [px + cos(a) * r, yTop, pz + sin(a) * r];
        const cc = mix(mix(stone, C('#c8b99a'), hash2(si * 31 + ri * 7, k) * 0.5), stoneD, ((ri + k) % 2) * 0.3);
        if (ri === 0) b.tri(p(0, 0), p(r1, a1), p(r1, a0), cc, { j: 0.1 }); else b.quad(p(r0, a0), p(r0, a1), p(r1, a1), p(r1, a0), cc, { j: 0.1 });
      }
      for (let k = 0; k < 18; k++) {            // border stones
        const a = (k / 18) * TAU + 0.1;
        b.push(px + cos(a) * (pr + 0.05), 0.12, pz + sin(a) * (pr + 0.05), -a, 1);
        b.box(0.34, 0.26 + hash2(k, si) * 0.1, 0.52, 0, 0, 0, mix(stoneD, C(P.stoneLight), hash2(si, k * 3)), { j: 0.12 });
        b.pop();
      }
      b.cyl(pr + 0.18, pr + 0.4, 0.4, 18, px, -0.12, pz, C(P.soil), { j: 0.05 });
      if (si === 0) {                           // centre plot: brass compass inlay
        b.cyl(1.55, 1.55, 0.02, 24, px, 0.11, pz, C(P.brassDark), { shade: 0, j: 0.04 });
        b.cyl(1.38, 1.38, 0.025, 24, px, 0.112, pz, mix(stone, C(P.slate), 0.5), { shade: 0, j: 0.06 });
        for (let k = 0; k < 4; k++) b.push(px, 0.125, pz, k * PI / 2).prism(0.22, 0.02, 2.4, 0, 0, 0, C(P.brass), C(P.brass), { open: true }).pop();
      }
    });
    // ---- footpaths ----
    for (const e of edges) {
      const a = nodes[e[0]], c = nodes[e[1]], L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = Math.max(2, Math.ceil(L / 0.6)), nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L;
      if (e[0] === 0 && e[1] === 1) continue;
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n, wd = 0.34 + 0.06 * hash2(i, e[0] * 5 + e[1]);
        const P0 = (t, s) => { const x = lerp(a[0], c[0], t) + nx * s, z = lerp(a[1], c[1], t) + nz * s; return [x, hOf(x, z) + 0.045, z]; };
        const cc = mix(C(P.dirt), C('#c4a070'), hash2(i, e[0] * 9 + e[1] * 3) * 0.6);
        b.quad(P0(t0, -wd), P0(t0, wd), P0(t1, wd), P0(t1, -wd), cc, { j: 0.08 });
        if (hash2(i + 5, e[0] + e[1]) < 0.4) {
          const t = (t0 + t1) / 2, s = (hash2(i, 77) - 0.5) * 0.5, x = lerp(a[0], c[0], t) + nx * s, z = lerp(a[1], c[1], t) + nz * s;
          b.box(0.17, 0.05, 0.13, x, hOf(x, z) + 0.06, z, mix(C(P.stone), C(P.stoneLight), hash2(i, 5)), { ry: hash2(i, 9) * PI, j: 0.12 });
        }
      }
    }
    // ---- storehouse ----
    {
      const sx = stor.x, sz = stor.z, hw = stor.hw, hd = stor.hd, wall = C('#d9b98a'), beam = C(P.woodDark);
      b.bbox(sx - hw - 0.1, -0.1, sz - hd - 0.1, sx + hw + 0.1, 0.35, sz + hd + 0.1, C(P.stone), { j: 0.12 });
      b.bbox(sx - hw, 0.35, sz - hd, sx + hw, 1.55, sz + hd, wall, { j: 0.08 });
      for (const ax of [-1, 1]) for (const az of [-1, 1]) b.bbox(sx + ax * hw - 0.06, 0.35, sz + az * hd - 0.06, sx + ax * hw + 0.06, 1.62, sz + az * hd + 0.06, beam);
      for (const y of [0.35, 1.0, 1.5]) b.bbox(sx - hw - 0.04, y, sz - hd - 0.04, sx + hw + 0.04, y + 0.08, sz + hd + 0.04, beam, { j: 0.08 });
      for (const dx of [-0.9, 0, 0.9]) b.beam(sx + dx - 0.35, 0.4, sz + hd + 0.045, sx + dx + 0.35, 1.0, sz + hd + 0.045, 0.06, beam, { shade: 0 });
      b.push(sx, 1.6, sz, 0); b.prism(hw * 2 + 0.7, 0.95, hd * 2 + 0.7, 0, 0, 0, C(P.roof), mul(C(P.roof), 0.82)); b.pop();
      b.bbox(sx - 0.05, 2.5, sz - hd - 0.35, sx + 0.05, 2.58, sz + hd + 0.35, C(P.roofDark));
      // door on the pier side (-x), windows glow at night
      const dxp = sx - hw - 0.02;
      b.bbox(dxp - 0.04, 0.35, sz - 0.4, dxp + 0.04, 1.35, sz + 0.4, C(P.woodDark));
      b.bbox(dxp - 0.07, 0.35, sz - 0.46, dxp, 1.42, sz - 0.4, beam); b.bbox(dxp - 0.07, 0.35, sz + 0.4, dxp, 1.42, sz + 0.46, beam);
      b.bbox(dxp - 0.07, 1.35, sz - 0.46, dxp, 1.42, sz + 0.46, beam);
      b.box(0.03, 0.05, 0.05, dxp - 0.07, 0.85, sz + 0.28, C(P.brass), { shade: 0 });
      for (const wz of [-0.6, 0.6]) { b.box(0.04, 0.32, 0.32, sx + hw + 0.01, 1.0, sz + wz * 0.6, C(P.glass), { glow: 1, shade: 0, j: 0.04 }); }
      for (const wx of [-0.7, 0.7]) b.box(0.32, 0.3, 0.04, sx + wx, 1.0, sz + hd + 0.01, C(P.glass), { glow: 1, shade: 0, j: 0.04 });
      // hanging lantern + sign above door
      b.bbox(dxp - 0.25, 1.62, sz - 0.5, dxp - 0.2, 1.67, sz + 0.5, beam);
      b.box(0.05, 0.4, 0.7, dxp - 0.1, 1.7, sz, C(P.woodLight), { j: 0.08 });
      // crates, barrels, sacks
      const crateAt = (x, z, s, ry, y0) => { b.box(s, s, s, x, (y0 || 0) + s / 2, z, mix(C(P.plank), C(P.woodDark), hash2(x * 9, z * 9) * 0.5), { ry, j: 0.14 }); b.box(s * 1.04, 0.05, s * 1.04, x, (y0 || 0) + s * 0.9, z, C(P.woodDark), { ry }); };
      crateAt(sx - hw - 0.2, sz - 1.3, 0.6, 0.3); crateAt(sx - hw - 0.1, sz - 1.9, 0.5, -0.2); crateAt(sx - hw - 0.2, sz - 1.4, 0.45, 0.8, 0.6);
      crateAt(sx + 0.8, sz + hd + 0.55, 0.55, 0.1); crateAt(sx + 1.5, sz + hd + 0.5, 0.45, -0.4); crateAt(sx + 1.45, sz + hd + 0.55, 0.38, 0.5, 0.45);
      b.cyl(0.3, 0.3, 0.7, 10, sx - 0.4, 0.35, sz + hd + 0.55, C(P.wood), { j: 0.1 }); for (const y of [0.15, 0.55]) b.cyl(0.32, 0.32, 0.05, 10, sx - 0.4, y, sz + hd + 0.55, C(P.iron), { shade: 0 });
      for (let i = 0; i < 3; i++) b.sph(0.22, sx + hw + 0.5, 0.16, sz - 0.8 + i * 0.45, mix(C(P.cloth), C('#c8b080'), i / 3), { s: [1.2, 0.6, 1], j: 0.1 });
      // chimney
      b.bbox(sx + 0.9, 1.8, sz - 0.2, sx + 1.25, 3.0, sz + 0.15, C(P.stoneDark), { j: 0.12 });
    }
    // ---- dock (pier) ----
    const pierZ0 = RR(PI / 2) - 1.2, pierZ1 = 19.9, pierY = -0.22, deckW = 0.95;
    {
      const nb2 = Math.floor((pierZ1 - pierZ0) / 0.36);
      for (let i = 0; i < nb2; i++) {
        const z0 = pierZ0 + i * 0.36, cc = mix(C(P.plank), C(P.woodLight), hash2(i, 3) * 0.7);
        b.bbox(-deckW, pierY - 0.06, z0 + 0.02, deckW, pierY, z0 + 0.34, cc, { j: 0.1, shade: 0.12 });
      }
      for (const sx of [-0.75, 0.75]) b.bbox(sx - 0.08, pierY - 0.26, pierZ0, sx + 0.08, pierY - 0.06, pierZ1 - 0.1, C(P.woodDark), { j: 0.08 });
      for (let i = 0; i <= 4; i++) { const z = lerp(pierZ0 + 0.8, pierZ1 - 0.6, i / 4); for (const sx of [-1, 1]) b.beam(sx * 0.75, pierY - 0.2, z, sx * 0.78, pierY - 2.4 - i * 0.2, z - 2.2 + i * 0.5, 0.12, C(P.woodDark), { j: 0.1 }); }
      const posts = []; for (let i = 0; i < 4; i++) posts.push(lerp(pierZ0 + 0.6, pierZ1 - 0.3, i / 3));
      for (const sx of [-1, 1]) for (const z of posts) {
        b.cyl(0.1, 0.12, 1.2, 7, sx * deckW, pierY + 0.5, z, C(P.wood), { j: 0.1 }); b.cyl(0.13, 0.13, 0.06, 7, sx * deckW, pierY + 1.12, z, C(P.iron), { shade: 0 });
        b.cyl(0.11, 0.11, 0.08, 7, sx * deckW, pierY + 0.72, z, C(P.rope), { shade: 0 });
      }
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
        const z0 = posts[i], z1 = posts[i + 1], pts = [];
        for (let s = 0; s <= 6; s++) { const u = s / 6; pts.push([sx * deckW, pierY + 1.05 - 0.2 * sin(u * PI), lerp(z0, z1, u)]); }
        b.tube(pts, 0.025, 0.025, 4, C(P.rope), { j: 0.06 });
      }
      for (const sx of [-1, 1]) {                 // end lanterns
        const z = posts[3], y = pierY + 1.2;
        b.cyl(0.02, 0.02, 0.34, 5, sx * deckW, y + 0.15, z, C(P.iron));
        b.cone(0.1, 0.08, 6, sx * deckW, y + 0.55, z, C(P.brassDark));
        b.cyl(0.075, 0.075, 0.2, 6, sx * deckW, y + 0.4, z, C(P.glass), { glow: 1, shade: 0, j: 0.04 });
        b.cyl(0.09, 0.07, 0.03, 6, sx * deckW, y + 0.28, z, C(P.brassDark));
      }
      for (const z of [posts[1], posts[2] + 0.2]) b.cyl(0.14, 0.14, 0.1, 8, 0.4, pierY + 0.05, z, C(P.rope), { shade: 0 });
      b.bbox(0.55, pierY, pierZ1 - 1.5, 1.0, pierY + 0.42, pierZ1 - 1.1, C(P.plank), { j: 0.12 });
      b.cyl(0.26, 0.26, 0.55, 9, -0.55, pierY + 0.28, pierZ1 - 1.2, C(P.wood), { j: 0.1 });
      b.bbox(-0.05, pierY, pierZ0 + 1.3, 0.05, pierY + 1.3, pierZ0 + 1.42, C(P.woodDark));
      b.box(0.55, 0.3, 0.05, 0, pierY + 1.2, pierZ0 + 1.42, C(P.woodLight), { j: 0.1 });
    }
    // ---- fences along the rim ----
    {
      const fp = []; const fr = RR; let acc = 0;
      for (let k = 0; k < 140; k++) {
        const th = (k / 140) * TAU, d90 = Math.abs(((th - PI / 2 + PI) % TAU + TAU) % TAU - PI), d270 = Math.abs(((th - 3 * PI / 2 + PI) % TAU + TAU) % TAU - PI);
        if (d90 < 0.3 || d270 < 0.26) { fp.push(null); continue; }
        const rr = fr(th) - 0.85, x = cos(th) * rr, z = sin(th) * rr; fp.push([x, hOf(x, z), z, th]);
      }
      const nlow = low ? 2 : 1;
      for (let k = 0; k < 140; k += nlow) {
        const p0 = fp[k], p1 = fp[(k + nlow) % 140]; if (!p0) continue;
        if (hash2(k, 17) < 0.07) continue;
        b.cyl(0.05, 0.065, 0.62 + hash2(k, 4) * 0.12, 5, p0[0], p0[1] + 0.3, p0[2], C(P.wood), { j: 0.12 });
        if (p1) for (const hy of [0.22, 0.45]) b.beam(p0[0], p0[1] + hy, p0[2], p1[0], p1[1] + hy, p1[2], 0.04, C(P.plank), { j: 0.1, shade: 0.05 });
        if (k % 14 === 0) {
          b.cyl(0.07, 0.08, 0.5, 5, p0[0], p0[1] + 0.85, p0[2], C(P.woodDark));
          b.cone(0.11, 0.08, 6, p0[0], p0[1] + 1.38, p0[2], C(P.brassDark));
          b.cyl(0.07, 0.07, 0.16, 6, p0[0], p0[1] + 1.2, p0[2], C(P.glass), { glow: 1, shade: 0, j: 0.04 });
        }
      }
    }
    // ---- trees, bushes, rocks, flowers, tufts ----
    const treeSpots = [[30, 13.4], [150, 13.0], [208, 13.2], [330, 13.3]];
    treeSpots.forEach((ts, i) => {
      const th = ts[0] * PI / 180, x = cos(th) * ts[1], z = sin(th) * ts[1], y = hOf(x, z), s = 1.2 + hash2(i, 2) * 0.5;
      obst.push([x, z, 1.8]);
      b.push(x, y, z, hash2(i, 5) * TAU, s);
      b.cyl(0.2, 0.34, 1.9, 7, 0, 0.95, 0, C(P.bark), { j: 0.12 });
      b.tube([[0, 1.2, 0], [0.42, 1.65, 0.1], [0.7, 2.0, 0.1]], 0.1, 0.05, 4, C(P.bark));
      const cols = [C(P.leaf), C(P.leafDark), C(P.grassLight), C('#6cb04a')];
      for (const [cx, cy, cz, cr] of [[0, 2.7, 0, 1.2], [0.8, 2.3, 0.3, 0.9], [-0.7, 2.4, -0.4, 0.95], [0.1, 3.4, 0.1, 0.8], [-0.3, 2.6, 0.8, 0.8]]) b.ico(cr, cx, cy, cz, cols[Math.floor(hash2(cx * 9 + i, cy * 7) * 4) % 4], { d: low ? 0 : 1, j: 0.12, shade: 0.25 });
      if (i % 2 === 0) for (let k = 0; k < 7; k++) b.ico(0.07, cos(k * 2.4) * 1.2, 2.5 + hash2(k, i) * 1.2, sin(k * 2.4) * 1.1, C(i === 0 ? '#ff9fc4' : '#ffe27a'), { shade: 0, j: 0.05, glow: 0 });
      b.pop();
    });
    const bushCols = [C(P.leaf), C(P.leafDark), C('#4f9a4a')];
    place(low ? 6 : 16, 7, 15.2, 0.7, (x, y, z) => {
      const s = 0.55 + rnd() * 0.5;
      b.ico(0.5 * s, x, y + 0.3 * s, z, bushCols[Math.floor(rnd() * 3)], { d: 0, j: 0.14, s: [1.2, 0.85, 1.1] });
      b.ico(0.38 * s, x + 0.4 * s, y + 0.22 * s, z + 0.15 * s, bushCols[Math.floor(rnd() * 3)], { d: 0, j: 0.14 });
      if (rnd() < 0.4) for (let k = 0; k < 4; k++) b.ico(0.05, x + (rnd() - 0.5) * s, y + 0.4 * s + rnd() * 0.3, z + (rnd() - 0.5) * s, C(rnd() < 0.5 ? '#ff6b6b' : '#ffd24a'), { d: 0, shade: 0, j: 0.05 });
    });
    place(low ? 6 : 14, 6, 15.2, 0.5, (x, y, z) => {
      const s = 0.25 + rnd() * 0.45;
      b.ico(s, x, y + s * 0.3, z, mix(C(P.stone), C(P.rockLight), rnd()), { d: 0, j: 0.15, s: [1.2, 0.7, 1], ry: rnd() * 3 });
      if (rnd() < 0.5) b.ico(s * 0.5, x + s, y + s * 0.15, z + s * 0.3, mix(C(P.stoneDark), C(P.stone), rnd()), { d: 0, j: 0.15, s: [1, 0.7, 1] });
    });
    const flowerCols = ['#ff8fb4', '#ffe066', '#ffffff', '#b794f6', '#ff7a59'];
    place(low ? 30 : 110, 3, 15.3, 0.12, (x, y, z) => {
      const fc = C(flowerCols[Math.floor(rnd() * 5)]), h = 0.12 + rnd() * 0.12;
      b.cone(0.012, h, 3, x, y + h / 2, z, C(P.grassDark), { j: 0, shade: 0 });
      b.ico(0.045, x, y + h, z, fc, { d: 0, shade: 0, j: 0.1 });
    });
    place(low ? 40 : 240, 2, 15.4, 0.1, (x, y, z) => {
      const h = 0.16 + rnd() * 0.16;
      for (let k = 0; k < 3; k++) b.cone(0.04, h, 3, x + (k - 1) * 0.05, y + h / 2, z + (k % 2) * 0.04, mix(C(P.grassDark), C(P.grassLight), rnd()), { j: 0.1, shade: 0.1, rz: (k - 1) * 0.25 });
    });
    place(low ? 3 : 8, 8, 15, 0.3, (x, y, z) => {
      b.cyl(0.04, 0.05, 0.16, 5, x, y + 0.08, z, C(P.cloth)); b.sph(0.1, x, y + 0.17, z, C(P.clothRed), { half: true, w: 6, h: 3, shade: 0.1 });
    });
    // ---- heart crystal cradle, roots, vines ----
    hangRoots(b, rnd, rock.bands, low ? 10 : 26, 1.3, [C(P.bark), mix(C(P.bark), C(P.woodLight), 0.4)]);
    for (let i = 0; i < (low ? 24 : 60); i++) {
      const k = Math.floor(rnd() * rock.bands[1].length), p = rock.bands[1][k], o = Math.hypot(p[0], p[2]), L = 0.5 + rnd() * 1.6;
      b.tube([[p[0] * 1.0, p[1] + 0.2, p[2]], [p[0] / o * (o + 0.08), p[1] - L * 0.5, p[2] / o * (o + 0.08)], [p[0] / o * (o + 0.02), p[1] - L, p[2] / o * (o + 0.02)]], 0.03, 0.01, 3, mix(C(P.grassDark), C(P.leaf), rnd()), { j: 0.12 });
    }
    // boulders hugging the cone and glowing veins
    for (let i = 0; i < (low ? 8 : 20); i++) {
      const bi = 2 + Math.floor(rnd() * 5), k = Math.floor(rnd() * rock.bands[bi].length), p = rock.bands[bi][k], s = 0.5 + rnd() * 0.9;
      b.ico(s, p[0], p[1], p[2], mix(C(P.rock), C(P.rockLight), rnd()), { d: 0, j: 0.14, s: [1, 0.8, 1], ry: rnd() * 3 });
    }
    for (let i = 0; i < (low ? 5 : 11); i++) {
      const bi = 3 + Math.floor(rnd() * 4), k = Math.floor(rnd() * rock.bands[bi].length), p = rock.bands[bi][k], o = Math.hypot(p[0], p[2]) || 1;
      const dx = p[0] / o, dz = p[2] / o;
      for (let m = 0; m < 3; m++) crystalAt(b, p[0] + dx * 0.1 + (m - 1) * 0.2, p[1] - 0.2 * m, p[2] + dz * 0.1, 0.1 + 0.05 * m, 0.55 + 0.35 * m, C(i % 2 ? P.crystalDeep : P.crystal), C(P.white), { rx: dz * 1.3, rz: -dx * 1.3 });
    }
    // ---- water: pond, stream, rills, fall ----
    const wCol = (x, z, k) => mix(C(P.waterDeep), C(P.water), clamp(0.5 + 0.5 * (vnoise(x * 1.5 + k, z * 1.5) - 0.3) * 1.6, 0, 1));
    {
      const wy = -0.14, nseg = 18;
      for (let k = 0; k < nseg; k++) {
        const a0 = (k / nseg) * TAU, a1 = ((k + 1) / nseg) * TAU, rr = (a) => pond.r * (1.05 + 0.1 * sin(a * 3 + 1));
        for (const [r0, r1] of [[0, 0.55], [0.55, 1.0]]) {
          const p = (r, a) => [pond.x + cos(a) * rr(a) * r, wy, pond.z + sin(a) * rr(a) * r];
          const cc = wCol(pond.x + cos(a0) * r1, pond.z + sin(a0) * r1, k);
          if (r0 === 0) w.tri(p(0, 0), p(r1, a1), p(r1, a0), cc, { j: 0.04 }); else w.quad(p(r0, a0), p(r0, a1), p(r1, a1), p(r1, a0), cc, { j: 0.04 });
        }
      }
      for (let i = 0; i < 5; i++) { const a = i * 1.26, r = 0.9 + 0.4 * hash2(i, 1); w.cyl(0.2, 0.2, 0.02, 7, pond.x + cos(a) * r, wy + 0.02, pond.z + sin(a) * r, C(P.leaf), { j: 0.1, shade: 0 }); }
      // stream ribbon
      const pts = []; for (let i = 0; i < stream.length - 1; i++) for (let s = 0; s < 3; s++) { const u = s / 3; pts.push([lerp(stream[i][0], stream[i + 1][0], u), lerp(stream[i][1], stream[i + 1][1], u)]); }
      pts.push(stream[stream.length - 1]);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], c = pts[i + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L, wd = 0.36;
        const edgeY = (zz) => -0.15 - sstep(RR(3 * PI / 2) - 1.6, RR(3 * PI / 2), -zz) * 0.3;
        w.quad([a[0] - nx * wd, edgeY(a[1]), a[1] - nz * wd], [a[0] + nx * wd, edgeY(a[1]), a[1] + nz * wd], [c[0] + nx * wd, edgeY(c[1]), c[1] + nz * wd], [c[0] - nx * wd, edgeY(c[1]), c[1] - nz * wd], wCol(a[0], a[1], 3), { j: 0.05 });
      }
    }
    const rimSpots = [];
    const mkFall = (x0, z0, th, wd, len, y0) => {          // water ribbon falling past the cliff
      const ox = cos(th), oz = sin(th);
      const lipX = x0 + ox * 0.9, lipZ = z0 + oz * 0.9;
      const col0 = C('#9fe0f0'), col1 = C('#e6fbff');
      const nx = -oz * wd, nz = ox * wd;
      w.quad([x0 - nx, y0, z0 - nz], [x0 + nx, y0, z0 + nz], [lipX + nx, y0 - 0.25, lipZ + nz], [lipX - nx, y0 - 0.25, lipZ - nz], col0, { j: 0.04 });
      let prev = [lipX, y0 - 0.25, lipZ];
      const m = 5;
      for (let s = 1; s <= m; s++) {
        const u = s / m, xx = lipX + ox * (0.15 + 0.35 * u) * 1.0, zz = lipZ + oz * (0.15 + 0.35 * u), yy = y0 - 0.25 - len * u, wdn = wd * (1 + 0.5 * u);
        const cc = mix(col0, col1, hash2(s, th * 9)); const nxx = -oz * wdn, nzz = ox * wdn;
        w.quad([prev[0] - nx, prev[1], prev[2] - nz], [prev[0] + nx, prev[1], prev[2] + nz], [xx + nxx, yy, zz + nzz], [xx - nxx, yy, zz - nzz], cc, { j: 0.06, double: true });
        prev = [xx, yy, zz];
      }
    };
    {
      const th = 3 * PI / 2, rr = RR(th);
      rimSpots.push({ x: 0.2, y: -0.45, z: -rr - 0.1, nx: 0, nz: -1 });
      mkFall(0.2, -rr + 0.1, th, 0.34, 5.5, -0.45);
      b.ico(0.5, -0.9, -0.1, -rr + 0.2, C(P.rock), { d: 0, s: [1, 0.8, 1] }); b.ico(0.45, 1.0, -0.05, -rr + 0.15, C(P.rockLight), { d: 0, s: [1, 0.8, 1] });
      for (const [deg, len] of [[152, 3.5], [338, 3]]) {
        const t2 = deg * PI / 180, r2 = RR(t2) - 0.1, ox = cos(t2), oz = sin(t2), x2 = ox * r2, z2 = oz * r2, nx = -oz, nz = ox;
        for (let s = 0; s < 6; s++) {
          const u0 = s / 6, u1 = (s + 1) / 6, ra = (u) => r2 - len * (1 - u), wd = 0.2;
          const Q = (u, sg) => { const r = ra(u) + sin(u * 5 + deg) * 0.1 * 0, px = ox * r + nx * sg * wd, pz = oz * r + nz * sg * wd; return [px, hOf(px, pz) + 0.0, pz]; };
          const A = Q(u0, -1), A2 = Q(u0, 1), Bq = Q(u1, 1), B2 = Q(u1, -1); A[1] = A2[1] = Math.max(A[1], -0.08) - 0.03; Bq[1] = B2[1] = Math.max(Bq[1], -0.08) - 0.03;
          w.quad(A, A2, Bq, B2, wCol(px0(A), px1(A), s), { j: 0.05 });
        }
        b.ico(0.45, ox * (r2 - len - 0.3), 0.1, oz * (r2 - len - 0.3), C(P.rock), { d: 0, s: [1, 0.9, 1] });
        rimSpots.push({ x: x2, y: -0.2, z: z2, nx: ox, nz: oz });
        mkFall(x2, z2, t2, 0.2, 3.5, -0.2);
      }
    }
    function px0(a) { return a[0]; } function px1(a) { return a[2]; }

    // ---- meshes ----
    const main = b.mesh(matS); group.add(main);
    const water = w.mesh(matW); water.renderOrder = 2; group.add(water);
    // heart crystal (own mesh so the renderer can pulse it)
    const hb = new B(T), hCol = [C(P.crystal), C(P.crystalDeep), C(P.crystalViolet)];
    hb.push(0, -13.2, 0);
    hb.cyl(0.0, 1.25, 2.6, 6, 0, -2.0, 0, hCol[0], { glow: 0.95, shade: 0.3, j: 0.1, rx: PI });      // lower point
    hb.cyl(1.25, 1.25, 2.4, 6, 0, 0.5, 0, hCol[1], { glow: 0.8, shade: 0.3, j: 0.1 });
    hb.cone(1.25, 1.6, 6, 0, 2.5, 0, hCol[0], { glow: 1, shade: 0.2, j: 0.08 });
    for (let i = 0; i < 6; i++) { const a = i * PI / 3 + 0.3; hb.push(cos(a) * 1.3, -0.4, sin(a) * 1.3); hb.cyl(0.0, 0.34, 2.2 + (i % 3) * 0.5, 5, 0, -1.2, 0, hCol[(i + 1) % 3], { glow: 0.9, rx: PI + sin(a) * 0.45, rz: cos(a) * 0.45 }); hb.pop(); }
    hb.pop();
    const heart = hb.mesh(matS); group.add(heart);
    // anchors
    const mkA = (x, y, z, n) => { const o = new T.Object3D(); o.name = n; o.position.set(x, y, z); group.add(o); return o; };
    const slotAnchors = slots.map((s, i) => mkA(s.x, 0.1, s.y, 'slot' + i));
    const dock = mkA(0, pierY, pierZ1, 'dock'), storehouse = mkA(stor.x - stor.hw - 0.3, 0.4, stor.z, 'storehouse');
    return { group, slotAnchors, dock, storehouse, heart, rim: rimSpots, paths: { nodes, edges }, main, water, hOf, radius: R };
  }

  // =====================================================================
  // ISLETS
  // =====================================================================
  function islet(T, il, opts) {
    opts = opts || {}; il = il || { kind: 'kristall', r: 5, id: 1 };
    const q = qOf(opts), low = q === 'low', kind = il.kind === 'holz' ? 'holz' : 'kristall';
    const R = clamp(il.r || 5, 3, 9), id = (il.id | 0) + (kind === 'holz' ? 17 : 3), rnd = rng(id * 7919 + 13), ds = R / 5;
    const group = new T.Group(), b = new B(T), matS = getMat(T, q, 'solid');
    const hOf = kind === 'holz'
      ? (x, z, t) => (fbm(x * 0.4 + id, z * 0.4) - 0.5) * 0.7 - sstep(0.8, 1, t) * 0.25
      : (x, z, t) => (fbm(x * 0.55 + id, z * 0.55 + 4) - 0.35) * 1.5 * (1 - 0.4 * t) - sstep(0.8, 1, t) * 0.3;
    const topCol = kind === 'holz'
      ? (x, y, z) => { const n = fbm(x * 0.5 + id, z * 0.5); let c = mix(C(P.grassDark), C(P.grassLight), clamp(n * 1.3 - 0.05, 0, 1)); return mix(c, C(P.dirt), sstep(0.7, 0.8, vnoise(x * 0.7 + 9, z * 0.7)) * 0.7); }
      : (x, y, z) => { const n = fbm(x * 0.6 + id, z * 0.6 + 5); let c = mix(C('#3f3a48'), C(P.rock), clamp(n * 1.3, 0, 1)); c = mix(c, C(P.moss), sstep(0.62, 0.72, vnoise(x * 0.6 + 9, z * 0.6 + 2)) * 0.5); return mix(c, C(P.rockLight), clamp(y * 0.25, 0, 0.4)); };
    const rock = floatingRock(b, {
      R, NR: segs(q, 8, 5), NT: segs(q, 36, 24), seed: id, rimAmp: 0.1, rimF: 1.7, noiseAmp: 0.9 * ds, hOf, topCol,
      profile: [[0.45 * ds, 1.0], [1.0 * ds, 1.08], [2.0 * ds, 0.88], [3.4 * ds, 0.68], [5 * ds, 0.44], [6.6 * ds, 0.2], [8 * ds, 0.04]],
      bandCol: (bi, k) => {
        const n = vnoise(k * 0.4 + bi * 5, bi * 2.2 + id);
        const dark = kind === 'kristall';
        const lay = [kind === 'holz' ? mix(C(P.grassDark), C(P.moss), n) : mix(C('#3a3444'), C(P.moss), n * 0.5), kind === 'holz' ? C(P.soil) : C('#4a4252'), mix(C(P.rock), C('#7a5a48'), n * 0.5), mix(dark ? C('#4a4252') : C(P.rockLight), C(P.rock), n), mix(C(P.rock), C(P.rockDark), n), C(P.rockDark), C('#35303f'), C('#2f2a38')];
        return lay[Math.min(bi, lay.length - 1)];
      }
    });
    hangRoots(b, rnd, rock.bands, low ? 6 : 14, 0.9 * ds + 0.2, [C(P.bark), mix(C(P.bark), C(P.woodLight), 0.35)]);
    for (let i = 0; i < (low ? 4 : 9); i++) {
      const bi = 2 + Math.floor(rnd() * 4), k = Math.floor(rnd() * rock.bands[bi].length), p = rock.bands[bi][k], s = (0.3 + rnd() * 0.5) * ds;
      b.ico(s, p[0], p[1], p[2], mix(C(P.rock), C(P.rockLight), rnd()), { d: 0, j: 0.14, s: [1, 0.8, 1] });
    }
    const spots = (n, rmin, rmax, minD) => {
      const out = []; let tr = 0;
      while (out.length < n && tr++ < 500) {
        const a = rnd() * TAU, r = lerp(rmin, rmax, Math.sqrt(rnd())) * R, x = cos(a) * r, z = sin(a) * r;
        if (r > rock.RRf(a) * 0.86) continue;
        let ok = true; for (const o of out) if (Math.hypot(o[0] - x, o[2] - z) < minD * ds) { ok = false; break; }
        if (ok) out.push([x, hOf(x, z, r / R), z]);
      }
      return out;
    };
    let crystals = null, trees = null, stumps = null, nUnits = 0, ranges = null;
    if (kind === 'kristall') {
      for (let v = 0; v < (low ? 4 : 8); v++) {      // glowing cracks running down the cliff
        const k = Math.floor(rnd() * rock.bands[0].length), vp = [];
        for (let bi = 0; bi <= 5; bi++) { const p = rock.bands[bi][k]; vp.push([p[0] * 1.012, p[1] + 0.02, p[2] * 1.012]); }
        b.tube(vp, 0.045, 0.02, 3, C(v % 2 ? P.crystalViolet : P.crystal), { glow: 0.9, shade: 0, j: 0.05 });
      }
      for (const p of spots(low ? 5 : 10, 0.1, 0.9, 0.9)) b.ico((0.2 + rnd() * 0.25) * ds, p[0], p[1] + 0.05, p[2], mix(C(P.rock), C(P.rockLight), rnd()), { d: 0, s: [1.2, 0.7, 1], j: 0.15 });
      const cb = new B(T), sp = spots(8, 0.12, 0.8, 1.7), cc = [P.crystal, P.crystalViolet, P.crystalDeep, P.crystalPink];
      ranges = [0];
      sp.forEach((p, i) => {
        const big = i % 3 === 0 ? 1.25 : 1, hue = i % 2 ? 1 : 0;
        for (let m = 0; m < (low ? 3 : 5); m++) {
          const a = m * 2.1 + i, r = m ? (0.28 + 0.12 * (m % 2)) * ds : 0, h = (m ? 0.8 + 0.5 * ((m * 7 + i) % 3) / 2 : 1.7) * ds * big, rad = (m ? 0.13 : 0.22) * ds * big;
          crystalAt(cb, p[0] + cos(a) * r, p[1] - 0.05, p[2] + sin(a) * r, rad, h, C(hue ? cc[(m % 2) ? 1 : 3] : cc[(m % 2) ? 2 : 0]), mix(C(hue ? P.crystalViolet : P.crystal), C(P.white), 0.45), { rx: m ? sin(a) * 0.38 : 0, rz: m ? -cos(a) * 0.38 : 0 });
        }
        ranges.push(cb.verts);
      });
      nUnits = sp.length;
      crystals = cb.mesh(matS);
    } else {
      const tb = new B(T), sb = new B(T), n = il.trees || (5 + Math.floor(rnd() * 4)), sp = spots(n, 0.12, 0.8, 1.5);
      ranges = [0]; const sranges = [0];
      sp.forEach((p, i) => {
        const pine = rnd() < 0.5, s = (0.85 + rnd() * 0.5) * ds * 1.15;
        tb.push(p[0], p[1], p[2], rnd() * TAU, s);
        if (pine) {
          tb.cyl(0.1, 0.16, 1.0, 6, 0, 0.5, 0, C(P.bark), { j: 0.12 });
          for (let l = 0; l < 4; l++) tb.cone(0.95 - l * 0.2, 0.95 - l * 0.1, low ? 6 : 8, 0, 0.9 + l * 0.6, 0, mix(C(P.pine), C(P.pineDark), (l % 2) * 0.5 + rnd() * 0.2), { j: 0.12, shade: 0.3 });
        } else {
          tb.cyl(0.13, 0.2, 1.3, 6, 0, 0.65, 0, C(P.bark), { j: 0.12 });
          const cl = [C(P.leaf), C(P.leafDark), C(P.grassLight)];
          for (const [cx, cy, cz, cr] of [[0, 1.8, 0, 0.8], [0.5, 1.5, 0.2, 0.55], [-0.45, 1.6, -0.2, 0.6], [0.05, 2.3, 0.1, 0.5]]) tb.ico(cr, cx, cy, cz, cl[Math.floor(hash2(cx * 7 + i, cy * 9) * 3) % 3], { d: low ? 0 : 1, j: 0.12, shade: 0.25 });
        }
        tb.pop(); ranges.push(tb.verts);
        sb.push(p[0], p[1], p[2], 0, s);
        sb.cyl(0.17, 0.2, 0.26, 7, 0, 0.12, 0, C(P.bark), { j: 0.1 }); sb.cyl(0.15, 0.15, 0.02, 7, 0, 0.26, 0, C(P.woodLight), { shade: 0, j: 0.06 });
        for (let r = 1; r <= 2; r++) sb.torus(0.08 * r, 0.006, 0, 0.275, 0, C(P.wood), { rx: PI / 2, rs: 3, ts: 8 });
        sb.pop(); sranges.push(sb.verts);
      });
      nUnits = sp.length; ranges = { tree: ranges, stump: sranges };
      trees = tb.mesh(matS); stumps = sb.mesh(matS);
      // ground clutter on the main mesh
      for (const p of spots(low ? 6 : 16, 0.1, 0.9, 0.5)) { b.ico(0.18 * ds + 0.05, p[0], p[1] + 0.1, p[2], mix(C(P.stone), C(P.stoneLight), rnd()), { d: 0, s: [1.2, 0.7, 1], j: 0.15 }); }
      for (const p of spots(low ? 8 : 22, 0.1, 0.9, 0.45)) { b.cone(0.012, 0.15, 3, p[0], p[1] + 0.07, p[2], C(P.grassDark), { shade: 0 }); b.ico(0.045, p[0], p[1] + 0.15, p[2], C(['#ff8fb4', '#ffe066', '#ffffff'][Math.floor(rnd() * 3)]), { d: 0, shade: 0, j: 0.08 }); }
      for (const p of spots(low ? 2 : 5, 0.3, 0.85, 0.6)) { b.ico(0.32 * ds, p[0], p[1] + 0.15, p[2], C(rnd() < 0.5 ? P.leaf : P.leafDark), { d: 0, s: [1.2, 0.8, 1.1], j: 0.14 }); }
    }
    const main = b.mesh(matS); group.add(main);
    if (crystals) group.add(crystals);
    if (trees) { group.add(trees); group.add(stumps); }
    let lastAmt = -1;
    const setAmount = (f) => {
      f = clamp(f == null ? 1 : f, 0, 1);
      const n = Math.ceil(f * nUnits - 1e-6);
      if (n === lastAmt) return; lastAmt = n;
      if (kind === 'kristall') crystals.geometry.setDrawRange(0, ranges[n]);
      else { trees.geometry.setDrawRange(0, ranges.tree[n]); stumps.geometry.setDrawRange(ranges.stump[n], ranges.stump[nUnits] - ranges.stump[n]); }
    };
    setAmount(1);
    return { group, setAmount, kind, units: nUnits, radius: R };
  }

  // =====================================================================
  // BUILDINGS
  // =====================================================================
  const stoneCol = (base, i, k, v) => {
    const h = hash2(i * 17 + 3, k * 5 + 1);
    return mix(mul(base, 0.8 + 0.4 * h), mul(base, 1.1), ((i + k) % 2) * 0.25 + (v || 0));
  };
  // door / window boxes on a round tower surface at angle `an`; local +x points outwards
  function onTower(b, an, r, y, fn) { b.push(cos(an) * r, y, sin(an) * r, -an); fn(); b.pop(); }
  function archDoor(b, h, w, wood, frame) {
    b.box(0.14, h, w, 0, h / 2, 0, wood, { j: 0.08 });
    b.cyl(w / 2, w / 2, 0.14, 8, 0, h, 0, wood, { rz: PI / 2, j: 0.08, shade: 0 });
    b.box(0.2, h + 0.05, 0.1, 0, h / 2, w / 2 + 0.05, frame); b.box(0.2, h + 0.05, 0.1, 0, h / 2, -w / 2 - 0.05, frame);
    b.cyl(w / 2 + 0.07, w / 2 + 0.07, 0.19, 8, 0, h, 0, frame, { rz: PI / 2, shade: 0 });
    b.cyl(w / 2, w / 2, 0.2, 8, 0, h, 0, wood, { rz: PI / 2, shade: 0 });
    b.box(0.2, h - 0.0, w - 0.02, 0.0, h / 2, 0, wood, { shade: 0.05 });
    b.box(0.06, 0.05, 0.05, 0.12, h * 0.45, w * 0.28, C(P.brass), { shade: 0 });
  }
  function glowWin(b, w, h, frame, round) {
    b.box(0.08, h + 0.1, w + 0.1, 0, 0, 0, frame, { shade: 0 });
    if (round) b.cyl(w / 2 + 0.05, w / 2 + 0.05, 0.08, 7, 0, h / 2, 0, frame, { rz: PI / 2, shade: 0 });
    b.box(0.1, h, w, 0.01, 0, 0, C(P.glass), { glow: 1, shade: 0, j: 0.04 });
    if (round) b.cyl(w / 2, w / 2, 0.1, 7, 0.01, h / 2, 0, C(P.glass), { rz: PI / 2, glow: 1, shade: 0, j: 0.04 });
    b.box(0.12, h + 0.02, 0.03, 0.02, 0, 0, frame, { shade: 0 }); b.box(0.12, 0.03, w, 0.02, 0, 0, frame, { shade: 0 });
  }
  function gearGeo(T, R, teeth, thick, colA, colB) {
    const g = new B(T);
    g.cyl(R * 0.82, R * 0.82, thick, teeth * 2, 0, 0, 0, colA, { rx: PI / 2, shade: 0.1 });
    g.cyl(R * 0.55, R * 0.55, thick * 1.2, teeth, 0, 0, 0, colB, { rx: PI / 2, shade: 0 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; g.beam(cos(a) * R * 0.15, sin(a) * R * 0.15, 0, cos(a) * R * 0.78, sin(a) * R * 0.78, 0, R * 0.1, colA, { tz: thick * 1.3, shade: 0 }); }
    for (let i = 0; i < teeth; i++) { const a = (i / teeth) * TAU; g.box(R * 0.2, R * 0.2 * 1.15, thick, cos(a) * R * 0.92, sin(a) * R * 0.92, 0, colA, { rz: a, shade: 0.1 }); }
    g.cyl(R * 0.14, R * 0.14, thick * 1.8, 8, 0, 0, 0, C(P.iron), { rx: PI / 2, shade: 0 });
    return g;
  }
  // broken wall stubs + debris
  function ruinGeo(T, ext, wallC, accent, rnd) {
    const b = new B(T), y0 = ext.y0 || 0, wood = C(P.woodDark), cinder = C(P.char);
    const stub = (x, z, ry, w, d, hgt) => {
      b.push(x, y0, z, ry);
      b.bbox(-w / 2, 0, -d / 2, w / 2, hgt, d / 2, mix(wallC, cinder, 0.35 + rnd() * 0.3), { j: 0.12 });
      b.prism(w, 0.0001, d, 0, hgt, 0, wallC, wallC, { open: true });
      b.pop();
    };
    if (ext.shape === 'round') {
      const n = 9; for (let i = 0; i < n; i++) { const a = (i / n) * TAU + rnd() * 0.2; stub(cos(a) * ext.r * 0.95, sin(a) * ext.r * 0.95, -a, 0.3, (TAU * ext.r / n) * 0.9, 0.35 + rnd() * rnd() * 2.2); }
    } else {
      const w = ext.w / 2, d = ext.d / 2;
      for (let i = 0; i < 12; i++) {
        const f = i % 4, t = (Math.floor(i / 4) + 0.5) / 3, x = f < 2 ? lerp(-w, w, t) : (f === 2 ? -w : w), z = f < 2 ? (f === 0 ? -d : d) : lerp(-d, d, t);
        stub(x, z, f < 2 ? 0 : PI / 2, (f < 2 ? ext.w : ext.d) / 3.4, 0.28, 0.3 + rnd() * rnd() * 2.0);
      }
    }
    const R = (ext.r || Math.max(ext.w, ext.d) / 2) * 1.05;
    for (let i = 0; i < 28; i++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * R * 1.25, s = 0.12 + rnd() * 0.3, c = rnd() < 0.5 ? mix(wallC, cinder, 0.3) : mix(wood, cinder, 0.4);
      if (rnd() < 0.5) b.box(s, s * 0.7, s * 1.2, cos(a) * r, y0 + s * 0.35, sin(a) * r, c, { ry: rnd() * 3, rz: (rnd() - 0.5) * 0.5, j: 0.15 });
      else b.beam(cos(a) * r - 0.4, y0 + 0.05 + rnd() * 0.25, sin(a) * r - 0.2, cos(a) * r + 0.4, y0 + 0.2 + rnd() * 0.5, sin(a) * r + 0.3, 0.08, c, { j: 0.12 });
    }
    for (let i = 0; i < 3; i++) { const a = rnd() * TAU, r = rnd() * R * 0.6; b.ico(0.07, cos(a) * r, y0 + 0.12, sin(a) * r, C(P.ember), { d: 0, glow: 0.8, shade: 0, j: 0.1 }); }
    b.cyl(R * 0.7, R * 0.95, 0.25, 9, 0, y0 + 0.08, 0, mix(wallC, cinder, 0.5), { j: 0.2 });
    return b;
  }
  function frameGeo(T, ext) {
    const b = new B(T), wd = C(P.wood), wl = C(P.woodLight), hh = ext.y1 - ext.y0, y0 = ext.y0, nl = Math.max(2, Math.round(hh / 1.0));
    if (ext.shape === 'round') {
      const n = 8, r = ext.r * 0.88, pts = []; for (let i = 0; i < n; i++) pts.push([cos(i / n * TAU) * r, sin(i / n * TAU) * r]);
      for (const p of pts) b.beam(p[0], y0, p[1], p[0], y0 + hh, p[1], 0.11, wd, { tz: 0.11 });
      for (let l = 0; l <= nl; l++) for (let i = 0; i < n; i++) { const a = pts[i], c = pts[(i + 1) % n], y = y0 + 0.05 + (hh - 0.1) * l / nl; b.beam(a[0], y, a[1], c[0], y, c[1], 0.09, wl); }
      for (let i = 0; i < n; i++) { const a = pts[i], c = pts[(i + 1) % n]; b.beam(a[0], y0, a[1], c[0], y0 + hh * 0.5, c[1], 0.07, wd); b.beam(c[0], y0, c[1], a[0], y0 + hh * 0.5, a[1], 0.07, wd); }
      b.beam(0, y0, 0, 0, y0 + hh + 0.4, 0, 0.14, wd);
      for (let i = 0; i < n; i += 2) b.beam(pts[i][0], y0 + hh, pts[i][1], 0, y0 + hh + 0.4, 0, 0.08, wl);
    } else {
      const w = ext.w / 2 * 0.96, d = ext.d / 2 * 0.96;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.beam(sx * w, y0, sz * d, sx * w, y0 + hh, sz * d, 0.12, wd, { tz: 0.12 });
      for (const sx of [-1, 0, 1]) { b.beam(sx * w, y0, -d, sx * w, y0 + hh, -d, 0.1, wd); b.beam(sx * w, y0, d, sx * w, y0 + hh, d, 0.1, wd); }
      for (let l = 0; l <= nl; l++) {
        const y = y0 + 0.05 + (hh - 0.1) * l / nl;
        b.beam(-w, y, -d, w, y, -d, 0.09, wl); b.beam(-w, y, d, w, y, d, 0.09, wl); b.beam(-w, y, -d, -w, y, d, 0.09, wl); b.beam(w, y, -d, w, y, d, 0.09, wl);
      }
      b.beam(-w, y0, d, 0, y0 + hh * 0.55, d, 0.07, wd); b.beam(w, y0, -d, 0, y0 + hh * 0.55, -d, 0.07, wd); b.beam(w, y0, d, w, y0 + hh * 0.6, 0, 0.07, wd); b.beam(-w, y0, -d, -w, y0 + hh * 0.6, 0, 0.07, wd);
      b.beam(-w, y0 + hh, 0, w, y0 + hh, 0, 0.11, wd);
    }
    return b;
  }
  function scaffGeo(T, ext) {
    const b = new B(T), pole = C('#a9824f'), pl = C(P.plank), rp = C(P.rope), top = ext.y1 + 0.5, lv = [];
    for (let y = 0.9; y < top - 0.2; y += 0.95) lv.push(y);
    if (ext.shape === 'round') {
      const n = 10, r = ext.r + 0.6, pts = []; for (let i = 0; i < n; i++) pts.push([cos(i / n * TAU + 0.15) * r, sin(i / n * TAU + 0.15) * r]);
      for (const p of pts) b.cyl(0.05, 0.05, top, 5, p[0], top / 2, p[1], pole, { j: 0.1 });
      lv.forEach((y, li) => {
        for (let i = 0; i < n; i++) {
          const a = pts[i], c = pts[(i + 1) % n];
          b.beam(a[0], y, a[1], c[0], y, c[1], 0.05, pole, { j: 0.08 });
          if (li % 2 === 1) {
            const ang0 = i / n * TAU + 0.15, ang1 = (i + 1) / n * TAU + 0.15, ri = ext.r + 0.1;
            b.quad([cos(ang0) * ri, y + 0.03, sin(ang0) * ri], [cos(ang0) * (r + 0.05), y + 0.03, sin(ang0) * (r + 0.05)], [cos(ang1) * (r + 0.05), y + 0.03, sin(ang1) * (r + 0.05)], [cos(ang1) * ri, y + 0.03, sin(ang1) * ri], i % 2 ? pl : mix(pl, C(P.woodLight), 0.5), { j: 0.1, double: true });
          }
        }
      });
      for (let i = 0; i < n; i += 2) { const a = pts[i], c = pts[(i + 1) % n]; b.beam(a[0], 0.1, a[1], c[0], lv[Math.min(2, lv.length - 1)], c[1], 0.04, pole); }
      b.push(r + 0.05, 0, 0, 0); for (const z of [-0.18, 0.18]) b.beam(-0.5, 0, z, 0.15, top * 0.55, z, 0.04, pole); for (let y = 0.3; y < top * 0.5; y += 0.3) b.beam(-0.5 + y / (top * 0.55) * 0.65, y, -0.18, -0.5 + y / (top * 0.55) * 0.65, y, 0.18, 0.03, pole); b.pop();
    } else {
      const w = ext.w / 2 + 0.55, d = ext.d / 2 + 0.55;
      const pp = []; for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) pp.push([sx * w, sz * d]); pp.push([-w, 0], [w, 0]);
      for (const p of pp) b.cyl(0.05, 0.05, top, 5, p[0], top / 2, p[1], pole, { j: 0.1 });
      lv.forEach((y, li) => {
        b.beam(-w, y, -d, w, y, -d, 0.05, pole); b.beam(-w, y, d, w, y, d, 0.05, pole); b.beam(-w, y, -d, -w, y, d, 0.05, pole); b.beam(w, y, -d, w, y, d, 0.05, pole);
        if (li % 2 === 1) for (let i = 0; i < 8; i++) {
          const x0 = lerp(-w, w, i / 8), x1 = lerp(-w, w, (i + 1) / 8), c = i % 2 ? pl : mix(pl, C(P.woodLight), 0.5);
          b.quad([x0, y + 0.03, d - 0.55], [x1, y + 0.03, d - 0.55], [x1, y + 0.03, d], [x0, y + 0.03, d], c, { double: true }); b.quad([x0, y + 0.03, -d], [x1, y + 0.03, -d], [x1, y + 0.03, -d + 0.55], [x0, y + 0.03, -d + 0.55], c, { double: true });
        }
      });
      b.beam(-w, 0.1, d, 0, top * 0.8, d, 0.04, pole); b.beam(w, 0.1, -d, 0, top * 0.8, -d, 0.04, pole); b.beam(-w, 0.1, -d, -w, top * 0.8, 0, 0.04, pole);
      b.push(w - 0.1, 0, d + 0.12, 0); for (const z of [-0.18, 0.18]) b.beam(z, 0, 0, z * 0.2 - 0.25, top * 0.55, 0, 0.04, pole); b.pop();
    }
    // hanging tarp
    const tp = ext.shape === 'round' ? ext.r + 0.62 : ext.w / 2 + 0.6;
    if (ext.shape === 'round') b.quad([-0.9, lv[1] || 1, tp], [0.9, lv[1] || 1, tp], [0.9, (lv[1] || 1) - 0.9, tp], [-0.9, (lv[1] || 1) - 0.9, tp], mix(C(P.cloth), C('#d9c9a0'), 0.4), { double: true });
    return b;
  }
  function craneGeo(T, h, len) {
    // arm group: local origin = pivot at the mast top
    const b = new B(T), wd = C(P.wood), rp = C(P.rope);
    b.cyl(0.09, 0.09, 0.22, 6, 0, 0.08, 0, C(P.iron));
    b.beam(-0.55, 0.08, 0, len, 0.08, 0, 0.09, wd); b.beam(-0.55, 0.0, 0, len, 0.0, 0, 0.06, wd);
    b.beam(0, 0.2, 0, len, 0.1, 0, 0.04, rp); b.beam(0, 0.2, 0, -0.55, 0.1, 0, 0.04, rp);
    b.box(0.35, 0.3, 0.3, -0.7, 0.05, 0, C(P.stoneDark), { j: 0.15 });
    const hx = len - 0.15;
    b.tube([[hx, 0.05, 0], [hx, -0.6, 0], [hx, -1.0, 0]], 0.015, 0.015, 3, rp);
    b.beam(hx - 0.28, -1.05, 0, hx + 0.28, -1.05, 0, 0.07, wd); b.box(0.16, 0.16, 0.16, hx, -1.0, 0, C(P.iron), { shade: 0 });
    b.tube([[hx - 0.25, -1.05, 0], [hx - 0.1, -1.0, 0]], 0.012, 0.012, 3, rp);
    return b;
  }

  // ---------- per-kind definitions ----------
  const KINDS = {};
  KINDS.windrad = function (T, q, stage, rnd) {
    const b = new B(T), mv = [], stone = C('#b9ad98'), R0 = 1.3, R1 = 0.95, H = 3.3, NR = 9, SEG = segs(q, 12, 9);
    const rAt = (y) => lerp(R0, R1, y / H);
    b.cyl(R0 + 0.12, R0 + 0.2, 0.3, SEG, 0, 0.12, 0, C(P.stoneDark), { j: 0.12 });
    const rings = []; for (let i = 0; i <= NR; i++) rings.push({ y: 0.25 + (H - 0.25) * i / NR, rx: lerp(R0, R1, i / NR) });
    b.loft(rings, SEG, (i, k) => stoneCol(stone, i, k, 0.05), { j: 0.07, capTop: mul(stone, 0.7) });
    for (const y of [0.8, 1.7]) b.cyl(rAt(y) + 0.03, rAt(y) + 0.03, 0.07, SEG, 0, y, 0, C(P.woodDark), { shade: 0 });
    // gallery
    b.cyl(rAt(2.55) + 0.55, rAt(2.55) + 0.55, 0.08, SEG + 4, 0, 2.55, 0, C(P.plank), { j: 0.12 });
    for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; b.box(0.05, 0.4, 0.05, cos(a) * (rAt(2.55) + 0.52), 2.78, sin(a) * (rAt(2.55) + 0.52), C(P.woodDark)); }
    b.torus(rAt(2.55) + 0.52, 0.025, 0, 2.97, 0, C(P.wood), { rx: PI / 2, ts: 16, rs: 3 });
    // roof cap
    b.cone(R1 + 0.28, 1.2, SEG, 0, H + 0.55, 0, C(P.roof), { j: 0.1, shade: 0.3 });
    b.cyl(R1 + 0.3, R1 + 0.3, 0.1, SEG, 0, H, 0, C(P.roofDark));
    b.cyl(0.04, 0.04, 0.5, 5, 0, H + 1.4, 0, C(P.brass));
    b.quad([0, H + 1.6, 0], [0, H + 1.6, 0], [0.5, H + 1.45, 0], [0.5, H + 1.7, 0], C(P.clothRed), { double: true });
    // door & windows
    onTower(b, PI / 2 - 0.9, R0 + 0.01, 0.25, () => archDoor(b, 1.0, 0.62, C(P.woodDark), C(P.woodLight)));
    onTower(b, -PI / 2 + 0.3, rAt(1.8), 1.8, () => glowWin(b, 0.26, 0.4, C(P.woodDark), true));
    onTower(b, PI + 0.4, rAt(1.5), 1.5, () => glowWin(b, 0.26, 0.4, C(P.woodDark), true));
    onTower(b, 0.2, rAt(2.0), 1.95, () => glowWin(b, 0.26, 0.4, C(P.woodDark), true));
    // steps
    for (let i = 0; i < 3; i++) { const a = PI / 2 - 0.9; b.push(cos(a) * (R0 + 0.45 + i * 0.0), 0, sin(a) * (R0 + 0.45), -a); b.box(0.45 - i * 0.12, 0.1 * (3 - i), 0.9, 0 - i * 0.14, 0.05 * (3 - i) - 0.02, 0, C(P.stone), { j: 0.12 }); b.pop(); }
    // lean-to shed with sacks
    b.push(-1.9, 0, -0.9, 0.3);
    b.bbox(-0.7, 0, -0.55, 0.7, 0.9, 0.55, C('#c9ab7a'), { j: 0.1 });
    for (const sx of [-0.7, 0.7]) for (const sz of [-0.55, 0.55]) b.bbox(sx - 0.04, 0, sz - 0.04, sx + 0.04, 1.0, sz + 0.04, C(P.woodDark));
    b.push(0, 0.9, 0, 0); b.prism(1.7, 0.45, 1.3, 0, 0, 0, C(P.thatch), C('#a98a30'), { open: true }); b.pop();
    b.box(0.03, 0.5, 0.35, 0.72, 0.4, 0.1, C(P.woodDark));
    b.pop();
    for (let i = 0; i < 4; i++) b.sph(0.2, -0.9 + (i % 2) * 0.35, 0.16 + (i > 1 ? 0.22 : 0), 1.45 - (i > 1 ? 0.2 : 0) + (i % 2) * 0.1, mix(C(P.cloth), C('#c8b080'), i / 4), { s: [1.2, 0.7, 1], j: 0.1 });
    b.cyl(0.28, 0.28, 0.6, 9, 1.55, 0.3, 1.2, C(P.wood), { j: 0.1 }); b.cyl(0.3, 0.3, 0.05, 9, 1.55, 0.15, 1.2, C(P.iron), { shade: 0 });
    // blades (mover): hub at the front of the cap, turning about z
    const bl = new B(T), hubZ = R1 + 0.2, wd = C(P.wood), cl = C(P.cloth), cr = C(P.clothRed);
    bl.cone(0.2, 0.35, 8, 0, 0, 0.25, C(P.brass), { rx: PI / 2, shade: 0.1 }); bl.cyl(0.16, 0.18, 0.3, 8, 0, 0, 0.05, C(P.woodDark), { rx: PI / 2 });
    for (let k = 0; k < 4; k++) {
      bl.push(0, 0, 0.14, 0, 1, 0, k * PI / 2);
      bl.beam(0, 0.15, 0, 0, 2.5, 0, 0.1, wd, { tz: 0.06 });
      bl.beam(-0.02, 0.5, 0, 0.62, 0.5, 0, 0.05, wd); bl.beam(-0.02, 2.35, 0, 0.5, 2.35, 0, 0.05, wd);
      bl.beam(0.62, 0.5, 0, 0.5, 2.35, 0, 0.05, wd);
      for (let s = 0; s < 4; s++) {
        const y0 = 0.5 + s * 0.46, y1 = y0 + 0.46, w0 = 0.62 - s * 0.03, w1 = 0.62 - (s + 1) * 0.03;
        bl.quad([0.05, y0, 0.03], [w0, y0, 0.03], [w1, y1, 0.03], [0.05, y1, 0.03], s % 2 ? cl : cr, { double: true, j: 0.08, shade: 0 });
        bl.beam(0.05, y0, 0.03, w0, y0, 0.03, 0.03, wd);
      }
      bl.box(0.06, 0.12, 0.06, 0, 2.55, 0, C(P.brass), { shade: 0 });
      bl.pop();
    }
    bl.beam(0, 0, -0.45, 0, 0, 0.2, 0.2, C(P.woodDark));
    mv.push({ id: 'blades', b: bl, at: [0, H - 0.05, hubZ + 0.45] });
    return { body: b, movers: mv, ext: { shape: 'round', r: 1.3, y0: 0, y1: H + 0.9 }, ruinCol: stone, anchors: {} };
  };

  KINDS.kanone = function (T, q, stage, rnd) {
    const b = new B(T), mv = [], stone = C('#9c9aa4'), R0 = 1.65, R1 = 1.45, H = 2.6, NR = 8, SEG = segs(q, 12, 9), anch = {};
    b.cyl(R0 + 0.12, R0 + 0.22, 0.3, SEG, 0, 0.12, 0, C(P.stoneDark), { j: 0.12 });
    const rings = []; for (let i = 0; i <= NR; i++) rings.push({ y: 0.25 + (H - 0.25) * i / NR, rx: lerp(R0, R1, i / NR) });
    b.loft(rings, SEG, (i, k) => stoneCol(stone, i, k, 0.0), { j: 0.07 });
    b.cyl(R1 + 0.2, R1 + 0.14, 0.22, SEG, 0, H + 0.04, 0, mix(stone, C(P.stoneLight), 0.3), { j: 0.1 });
    b.cyl(R1 + 0.1, R1 + 0.1, 0.08, SEG, 0, H + 0.15, 0, C(P.plank), { j: 0.1 });
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; b.push(cos(a) * (R1 + 0.12), H + 0.5, sin(a) * (R1 + 0.12), -a); b.box(0.28, 0.5, 0.38, 0, 0, 0, stoneCol(stone, 3, i, 0.1), { j: 0.1 }); b.pop(); }
    onTower(b, PI / 2 + 0.2, R0 + 0.01, 0.25, () => archDoor(b, 0.95, 0.6, C(P.woodDark), C(P.stoneLight)));
    for (let i = 0; i < 3; i++) onTower(b, -0.5 + i * 1.7, lerp(R0, R1, 0.45) + 0.01, 1.4, () => { b.box(0.1, 0.55, 0.12, 0, 0, 0, C('#2b2a30')); b.box(0.12, 0.45, 0.07, 0.01, 0, 0, C(P.glass), { glow: 1, shade: 0, j: 0.03 }); });
    // wall lantern, banner, cannonballs, sandbags
    onTower(b, PI / 2 - 0.45, R0 + 0.05, 1.5, () => { b.box(0.06, 0.06, 0.04, 0, 0.25, 0, C(P.iron)); b.cyl(0.07, 0.07, 0.16, 6, 0.12, 0.1, 0, C(P.glass), { glow: 1, shade: 0, j: 0.03 }); b.cone(0.1, 0.07, 6, 0.12, 0.22, 0, C(P.brassDark)); });
    b.cyl(0.03, 0.03, 1.2, 5, -R1 * 0.7, H + 0.8, -R1 * 0.7, C(P.woodDark));
    b.quad([-R1 * 0.7, H + 1.35, -R1 * 0.7], [-R1 * 0.7, H + 0.95, -R1 * 0.7], [-R1 * 0.7 - 0.05, H + 0.95, -R1 * 0.7 + 0.7], [-R1 * 0.7 - 0.05, H + 1.35, -R1 * 0.7 + 0.7], C(P.clothRed), { double: true, shade: 0 });
    for (let l = 0; l < 3; l++) for (let i = 0; i < 3 - l; i++) b.sph(0.14, 1.9 + l * 0.12 + i * 0.28 - l * 0.0, 0.14 + l * 0.22, -0.9 + l * 0.14, C(P.iron), { w: 6, h: 4, j: 0.06 });
    for (let i = 0; i < 6; i++) { const a = -0.6 + i * 0.28; b.sph(0.22, cos(a) * (R0 + 0.35), 0.16, sin(a) * (R0 + 0.35) + 0.0, mix(C('#c8b080'), C('#b09a68'), (i % 3) / 3), { s: [1.25, 0.65, 1], j: 0.1, ry: -a }); }
    // cannon mover
    const cb = new B(T), brass = C(P.brass), wd = C(P.woodDark);
    cb.bbox(-0.4, 0.0, -0.3, 0.55, 0.22, 0.3, C(P.plank), { j: 0.1 });
    for (const sz of [-1, 1]) { cb.cyl(0.26, 0.26, 0.09, 10, 0.05, 0.14, sz * 0.38, C(P.woodDark), { rx: PI / 2, j: 0.08 }); cb.cyl(0.06, 0.06, 0.12, 6, 0.05, 0.14, sz * 0.38, C(P.iron), { rx: PI / 2, shade: 0 }); cb.bbox(-0.3, 0.2, sz * 0.26 - 0.04, 0.4, 0.44, sz * 0.26 + 0.04, C(P.plank)); }
    cb.push(-0.1, 0.5, 0, 0, 1, 0, 0.18);
    cb.cyl(0.2, 0.28, 2.0, 10, 0.75, 0, 0, brass, { rz: PI / 2, j: 0.06, shade: 0.12 });
    cb.cyl(0.26, 0.26, 0.1, 10, 1.7, 0, 0, C(P.brassDark), { rz: PI / 2, shade: 0 }); cb.cyl(0.24, 0.24, 0.07, 10, 1.1, 0, 0, C(P.brassDark), { rz: PI / 2, shade: 0 });
    cb.cyl(0.25, 0.25, 0.08, 10, 0.35, 0, 0, C(P.brassDark), { rz: PI / 2, shade: 0 });
    cb.sph(0.28, -0.22, 0, 0, brass, { w: 8, h: 6, j: 0.06 });
    cb.cyl(0.15, 0.15, 0.05, 8, 1.76, 0, 0, C('#1c1a1e'), { rz: PI / 2, shade: 0 });
    cb.cyl(0.04, 0.04, 0.16, 5, -0.3, 0.3, 0, C(P.iron));
    cb.pop();
    mv.push({ id: 'cannon', b: cb, at: [0, H + 0.2, 0], mount: true });
    anch.muzzle = { on: 'cannon', at: [1.75, 0.78, 0] };
    return { body: b, movers: mv, ext: { shape: 'round', r: 1.65, y0: 0, y1: H + 0.8 }, ruinCol: stone, anchors: anch };
  };

  KINDS.zisterne = function (T, q, stage, rnd) {
    const b = new B(T), w = new B(T), wd = C(P.wood), wl = C(P.woodLight), pad = C(P.plankDark), cx = -0.55;
    const BASE = 1.0, TOP = 0.75, PH = 2.0;
    b.push(cx, 0, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box(0.5, 0.2, 0.5, sx * BASE, 0.08, sz * BASE, C(P.stone), { j: 0.12 });
      b.beam(sx * BASE, 0.15, sz * BASE, sx * TOP, PH, sz * TOP, 0.17, wd, { tz: 0.17 });
    }
    for (const lv of [0.7, 1.35]) {
      const k = lv / PH, r = lerp(BASE, TOP, k);
      b.beam(-r, lv, -r, r, lv, -r, 0.09, wl); b.beam(-r, lv, r, r, lv, r, 0.09, wl); b.beam(-r, lv, -r, -r, lv, r, 0.09, wl); b.beam(r, lv, -r, r, lv, r, 0.09, wl);
    }
    for (const sg of [-1, 1]) {
      b.beam(-BASE + 0.1, 0.2, sg * BASE, TOP - 0.05, PH - 0.1, sg * TOP, 0.07, pad); b.beam(BASE - 0.1, 0.2, sg * BASE, -TOP + 0.05, PH - 0.1, sg * TOP, 0.07, pad);
      b.beam(sg * BASE, 0.2, -BASE + 0.1, sg * TOP, PH - 0.1, TOP - 0.05, 0.07, pad); b.beam(sg * BASE, 0.2, BASE - 0.1, sg * TOP, PH - 0.1, -TOP + 0.05, 0.07, pad);
    }
    // platform
    b.bbox(-TOP - 0.25, PH, -TOP - 0.25, TOP + 0.25, PH + 0.12, TOP + 0.25, C(P.plank), { j: 0.12 });
    for (let i = 0; i < 6; i++) b.bbox(-TOP - 0.26, PH + 0.1, -TOP - 0.25 + i * 0.35, TOP + 0.26, PH + 0.125, -TOP - 0.25 + i * 0.35 + 0.03, C(P.woodDark), { shade: 0 });
    // barrel (12 staves)
    const BR = 1.12, BH = 1.55, SEG = segs(q, 14, 10), by = PH + 0.12;
    const rings = [{ y: by, rx: BR * 0.9 }, { y: by + BH * 0.3, rx: BR * 1.0 }, { y: by + BH * 0.65, rx: BR * 1.04 }, { y: by + BH, rx: BR * 0.97 }];
    b.loft(rings, SEG, (i, k) => mix(C(P.wood), C(P.woodLight), (k % 2) * 0.3 + hash2(k, i) * 0.2), { j: 0.06, capBottom: C(P.woodDark) });
    for (const [ty, tr] of [[by + 0.18, 0.96], [by + BH * 0.5, 1.04], [by + BH * 0.85, 1.03]]) b.loft([{ y: ty - 0.04, rx: BR * tr + 0.04 }, { y: ty + 0.04, rx: BR * tr + 0.04 }], SEG, C(P.iron), { j: 0.04 });
    b.loft([{ y: by + BH, rx: BR * 0.97 }, { y: by + BH + 0.06, rx: BR * 0.97 }], SEG, C(P.woodLight));
    b.loft([{ y: by + BH + 0.06, rx: BR * 0.88 }, { y: by + BH - 0.12, rx: BR * 0.88 }], SEG, mul(C(P.woodDark), 0.7));
    // ladder + valve + pipes
    b.beam(0.95, 0.1, 0.35, 0.8, PH + 0.5, 0.35, 0.05, wd); b.beam(0.95, 0.1, -0.35, 0.8, PH + 0.5, -0.35, 0.05, wd);
    for (let i = 0; i < 7; i++) { const y = 0.25 + i * 0.32; b.beam(0.93 - y * 0.06, y, -0.35, 0.93 - y * 0.06, y, 0.35, 0.04, wl); }
    b.pop();
    const pipeC = C(P.copper);
    b.tube([[cx + BR * 0.95, by + 0.25, -0.3], [cx + BR * 1.15, by + 0.2, -0.3], [cx + BR * 1.2, 1.6, -0.3], [cx + BR * 1.2, 0.7, -0.3], [cx + 1.75, 0.62, -0.3]], 0.07, 0.07, 6, pipeC, { j: 0.06 });
    b.torus(0.17, 0.03, cx + BR * 1.2, 1.2, -0.3, C(P.brass), { rx: PI / 2 + 0.3, ts: 10, rs: 4 }); b.box(0.04, 0.04, 0.3, cx + BR * 1.2, 1.2, -0.3, C(P.brass));
    b.cone(0.1, 0.12, 6, cx + 1.75, 0.55, -0.3, C(P.copper), { rx: PI });
    b.tube([[cx - 0.2, by + BH + 0.4, 1.2], [cx - 0.6, by + BH + 0.45, 1.0], [cx - 0.5, by + BH + 0.05, 0.75]], 0.06, 0.06, 5, pipeC, { j: 0.06 });   // gutter feed
    b.cone(0.28, 0.26, 8, cx - 0.2, by + BH + 0.5, 1.28, pipeC, { rx: PI, j: 0.06 });
    b.tube([[cx - 0.2, by + BH + 0.38, 1.28], [cx - 0.2, 2.3, 1.55], [cx - 0.2, 0.5, 1.6]], 0.05, 0.05, 5, pipeC);
    // trough with water
    const tx = cx + 1.75, tz = -0.3;
    b.bbox(tx - 0.55, 0.0, tz - 0.3, tx + 0.55, 0.42, tz + 0.3, C(P.plank), { j: 0.12 });
    b.bbox(tx - 0.5, 0.36, tz - 0.25, tx + 0.5, 0.43, tz + 0.25, mul(C(P.woodDark), 0.6), { j: 0.05 });
    for (const sx of [-1, 1]) b.bbox(tx + sx * 0.5 - 0.03, 0, tz - 0.32, tx + sx * 0.5 + 0.03, 0.46, tz + 0.32, C(P.woodDark));
    b.cyl(0.25, 0.25, 0.5, 8, cx - 1.5, 0.25, -1.3, C(P.wood), { j: 0.1 });
    // water tops
    w.cyl(BR * 0.88, BR * 0.88, 0.02, SEG, cx, by + BH - 0.14, 0, C(P.water), { shade: 0, j: 0.1, glow: 0.12 });
    w.box(0.95, 0.02, 0.45, tx, 0.4, tz, C(P.water), { shade: 0, j: 0.1, glow: 0.12 });
    return { body: b, water: w, movers: [], ext: { shape: 'box', w: 1.9, d: 1.9, y0: 0, y1: PH + 1.7, cx }, ruinCol: C(P.plankDark), anchors: {} };
  };

  KINDS.werkstatt = function (T, q, stage, rnd) {
    const b = new B(T), mv = [], W = 3.0, D = 2.2, H = 1.45, plaster = C('#ecdcb6'), beam = C(P.woodDark);
    b.bbox(-W / 2 - 0.12, -0.05, -D / 2 - 0.12, W / 2 + 0.12, 0.35, D / 2 + 0.12, C(P.stone), { j: 0.12 });
    b.bbox(-W / 2, 0.35, -D / 2, W / 2, 0.35 + H, D / 2, plaster, { j: 0.07 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.bbox(sx * W / 2 - 0.07, 0.35, sz * D / 2 - 0.07, sx * W / 2 + 0.07, 0.45 + H, sz * D / 2 + 0.07, beam);
    for (const y of [0.35, 0.35 + H * 0.5, 0.35 + H - 0.02]) { b.bbox(-W / 2 - 0.05, y, -D / 2 - 0.05, W / 2 + 0.05, y + 0.1, D / 2 + 0.05, beam, { j: 0.08 }); }
    for (const x of [-0.6, 0.7]) { b.bbox(x - 0.05, 0.35, D / 2 - 0.02, x + 0.05, 0.35 + H, D / 2 + 0.06, beam); b.bbox(x - 0.05, 0.35, -D / 2 - 0.06, x + 0.05, 0.35 + H, -D / 2 + 0.02, beam); }
    for (const z of [-0.3]) { b.bbox(W / 2 - 0.02, 0.35, z - 0.05, W / 2 + 0.06, 0.35 + H, z + 0.05, beam); b.bbox(-W / 2 - 0.06, 0.35, z - 0.05, -W / 2 + 0.02, 0.35 + H, z + 0.05, beam); }
    b.beam(-W / 2 + 0.05, 0.4, -D / 2 - 0.05, -0.6, 0.35 + H * 0.5, -D / 2 - 0.05, 0.06, beam); b.beam(0.7, 0.4, -D / 2 - 0.05, 1.45, 0.35 + H * 0.5, -D / 2 - 0.05, 0.06, beam);
    // roof (ridge along x)
    b.push(0, 0.35 + H + 0.05, 0, PI / 2); b.prism(D + 0.8, 1.0, W + 0.55, 0, 0, 0, C(P.slate), mul(C(P.slate), 0.8)); b.pop();
    b.bbox(-W / 2 - 0.3, 0.35 + H + 1.0, -0.04, W / 2 + 0.3, 0.35 + H + 1.08, 0.04, C(P.roofDark));
    // chimney
    b.bbox(0.85, 0.35 + H, -0.75, 1.25, 3.3, -0.4, C('#9a5b48'), { j: 0.14 });
    for (let i = 0; i < 6; i++) b.bbox(0.82, 0.5 + H + i * 0.28, -0.78, 1.28, 0.5 + H + i * 0.28 + 0.02, -0.37, mul(C('#9a5b48'), 0.6), { shade: 0 });
    b.bbox(0.8, 3.3, -0.8, 1.3, 3.42, -0.35, C(P.stoneDark));
    b.box(0.2, 0.22, 0.2, 1.05, 3.2, -0.575, C(P.ember), { glow: 0.7, shade: 0, j: 0.05 });
    // forge opening glowing, windows
    b.box(0.55, 0.45, 0.04, 0.2, 0.95, D / 2 + 0.01, C(P.ember), { glow: 1, shade: 0, j: 0.1 });
    b.bbox(-0.12, 0.65, D / 2 - 0.02, 0.52, 0.72, D / 2 + 0.07, beam); b.bbox(-0.12, 1.2, D / 2 - 0.02, 0.52, 1.28, D / 2 + 0.07, beam);
    b.bbox(-0.12, 0.65, D / 2 - 0.02, -0.06, 1.28, D / 2 + 0.07, beam); b.bbox(0.46, 0.65, D / 2 - 0.02, 0.52, 1.28, D / 2 + 0.07, beam);
    b.push(W / 2 + 0.02, 1.0, 0.4, PI / 2); glowWin(b, 0.36, 0.4, beam, false); b.pop();
    b.push(-W / 2 - 0.02, 1.0, 0.4, -PI / 2 + 0.0); glowWin(b, 0.36, 0.4, beam, false); b.pop();
    b.push(-1.25, 0.35, D / 2 + 0.01, PI / 2); archDoor(b, 1.0, 0.55, C(P.woodDark), C(P.woodLight)); b.pop();
    // anvil on stump, bench, grindstone, barrel, coal
    const ax = 1.9, az = 1.15;
    b.cyl(0.3, 0.34, 0.45, 8, ax, 0.22, az, C(P.wood), { j: 0.12 });
    b.bbox(ax - 0.28, 0.45, az - 0.1, ax + 0.28, 0.58, az + 0.1, C('#4b4f5a'), { j: 0.08 });
    b.bbox(ax - 0.12, 0.58, az - 0.07, ax + 0.12, 0.7, az + 0.07, C('#5d6270'), { j: 0.08 });
    b.bbox(ax - 0.2, 0.7, az - 0.12, ax + 0.2, 0.82, az + 0.12, C('#686d7a'), { j: 0.08 });
    b.cone(0.1, 0.3, 4, ax + 0.4, 0.76, az, C('#686d7a'), { rz: -PI / 2 });
    b.beam(ax - 0.5, 0.05, az + 0.45, ax - 0.25, 0.3, az + 0.5, 0.04, C(P.woodLight)); b.box(0.1, 0.1, 0.16, ax - 0.25, 0.32, az + 0.5, C('#555a66'));
    b.bbox(-1.6, 0.0, 1.35, -0.4, 0.5, 1.7, C(P.plank), { j: 0.12 });
    for (const sx of [-1.55, -0.45]) b.bbox(sx - 0.04, 0, 1.36, sx + 0.04, 0.55, 1.4, C(P.woodDark));
    b.cyl(0.19, 0.19, 0.08, 8, -1.3, 0.58, 1.5, C(P.stoneLight), { rx: PI / 2, j: 0.08 }); b.cyl(0.04, 0.04, 0.12, 5, -1.3, 0.58, 1.5, C(P.iron));
    b.box(0.35, 0.05, 0.12, -0.8, 0.52, 1.5, C(P.iron), { ry: 0.3 });
    b.cyl(0.25, 0.25, 0.55, 9, -2.1, 0.27, 0.85, C(P.wood), { j: 0.1 }); b.cyl(0.26, 0.26, 0.04, 9, -2.1, 0.25, 0.85, C(P.iron), { shade: 0 });
    for (let i = 0; i < 8; i++) b.ico(0.1 + (i % 3) * 0.03, -2.0 + (i % 4) * 0.14, 0.08 + (i > 3 ? 0.1 : 0), -0.9 - (i % 3) * 0.12, C('#26232a'), { d: 0, j: 0.2 });
    for (let i = 0; i < 4; i++) b.bbox(1.25 + (i % 2) * 0.3, 0.02 + (i > 1 ? 0.1 : 0), 0.95 + (i % 2) * 0.05 - 1.7, 1.5 + (i % 2) * 0.3, 0.12 + (i > 1 ? 0.1 : 0), 1.1 + (i % 2) * 0.05 - 1.7, mix(C('#c8c8d0'), C('#8c8c98'), i / 4), { j: 0.1 });
    // hanging sign with gear symbol
    b.bbox(-W / 2 - 0.35, 1.7, D / 2 - 0.1, -W / 2 - 0.3, 1.74, D / 2 + 0.7, beam);
    b.box(0.05, 0.4, 0.5, -W / 2 - 0.32, 1.45, D / 2 + 0.5, C(P.woodLight), { j: 0.08 }); b.cyl(0.13, 0.13, 0.06, 8, -W / 2 - 0.36, 1.45, D / 2 + 0.5, C(P.brass), { rz: PI / 2, shade: 0 });
    // gears (movers) on the front wall right of the forge
    const g1 = gearGeo(T, 0.62, 12, 0.1, C(P.brass), C(P.brassDark)), g2 = gearGeo(T, 0.36, 7, 0.1, C(P.copper), C(P.brassDark));
    mv.push({ id: 'gear1', b: g1, at: [-1.05, 1.15, D / 2 + 0.12] });
    mv.push({ id: 'gear2', b: g2, at: [-1.05 + 0.8, 1.15 + 0.64, D / 2 + 0.12] });
    return { body: b, movers: mv, ext: { shape: 'box', w: 3.1, d: 2.3, y0: 0, y1: 2.5 }, ruinCol: plaster, anchors: { chimney: { at: [1.05, 3.45, -0.575] } } };
  };

  KINDS.sternwarte = function (T, q, stage, rnd) {
    const SEG = segs(q, 14, 10), mv = [], anch = {}, stone = C('#c3b9a8'), plaster = C('#e6d3ac');
    const base = new B(T), body = new B(T);
    const tower1 = (b) => {
      const R0 = 1.55, R1 = 1.35, H = 3.1, NR = 9;
      b.cyl(R0 + 0.15, R0 + 0.25, 0.32, SEG, 0, 0.12, 0, C(P.stoneDark), { j: 0.12 });
      const rings = []; for (let i = 0; i <= NR; i++) rings.push({ y: 0.25 + (H - 0.25) * i / NR, rx: lerp(R0, R1, i / NR) });
      b.loft(rings, SEG, (i, k) => stoneCol(stone, i, k, 0.04), { j: 0.07 });
      b.cyl(R1 + 0.25, R1 + 0.15, 0.26, SEG, 0, H + 0.05, 0, mix(stone, C(P.stoneLight), 0.3), { j: 0.1 });
      for (let i = 0; i < SEG; i++) { const a = i / SEG * TAU; b.push(cos(a) * (R1 + 0.05), H - 0.12, sin(a) * (R1 + 0.05), -a); b.box(0.25, 0.3, 0.14, 0, 0, 0, C(P.stone), { j: 0.1 }); b.pop(); }
      b.cyl(R1 + 0.05, R1 + 0.05, 0.08, SEG, 0, H + 0.2, 0, C(P.plank), { j: 0.1 });
      onTower(b, PI / 2, R0 + 0.01, 0.25, () => archDoor(b, 1.1, 0.7, C(P.woodDark), C(P.stoneLight)));
      for (let i = 0; i < 4; i++) onTower(b, -0.7 + i * 1.5 + (i > 1 ? 0.4 : 0), lerp(R0, R1, 0.5), 1.7 + (i % 2) * 0.5, () => glowWin(b, 0.26, 0.45, C(P.woodDark), true));
      b.cyl(R0 - 0.02, R1 + 0.1, 0.08, SEG, 0, 1.0, 0, C(P.brassDark), { shade: 0 });
      for (let i = 0; i < 3; i++) { const a = PI / 2 + i * 0.3 - 0.3; b.push(cos(a) * (R0 + 0.5), 0, sin(a) * (R0 + 0.5), -a); b.box(0.5 - i * 0.12, 0.1 * (3 - i), 1.0, -i * 0.12, 0.05 * (3 - i), 0, C(P.stone), { j: 0.12 }); b.pop(); }
    };
    const floor2 = (b, y0) => {
      const R0 = 1.3, R1 = 1.15, H = 1.7, NR = 5;
      b.cyl(1.75, 1.75, 0.1, SEG + 4, 0, y0 + 0.02, 0, C(P.plank), { j: 0.1 });
      for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; b.box(0.05, 0.42, 0.05, cos(a) * 1.7, y0 + 0.3, sin(a) * 1.7, C(P.brassDark)); }
      b.torus(1.7, 0.03, 0, y0 + 0.5, 0, C(P.brass), { rx: PI / 2, ts: 18, rs: 3 });
      const rings = []; for (let i = 0; i <= NR; i++) rings.push({ y: y0 + 0.07 + (H - 0.07) * i / NR, rx: lerp(R0, R1, i / NR) });
      b.loft(rings, SEG, (i, k) => mix(plaster, mul(plaster, 0.85), hash2(i, k) * 0.5 + (k % 2) * 0.06), { j: 0.06 });
      for (const y of [y0 + 0.07, y0 + H * 0.5, y0 + H - 0.05]) b.cyl(lerp(R0, R1, (y - y0) / H) + 0.04, lerp(R0, R1, (y - y0) / H) + 0.04, 0.1, SEG, 0, y, 0, C(P.brass), { shade: 0 });
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + 0.3; b.push(cos(a) * (R1 + 0.02), y0, sin(a) * (R1 + 0.02), -a); b.box(0.1, H, 0.1, 0, H / 2, 0, C(P.woodDark)); b.pop(); }
      for (let i = 0; i < 4; i++) onTower(b, i * PI / 2 + 0.75 + 0.3, lerp(R0, R1, 0.5), y0 + 0.65, () => glowWin(b, 0.38, 0.65, C(P.brassDark), true));
      b.cyl(R1 + 0.25, R1 + 0.2, 0.2, SEG, 0, y0 + H + 0.05, 0, mix(stone, C(P.stoneLight), 0.3), { j: 0.1 });
    };
    let ext, ruinCol = stone;
    if (stage <= 1) { tower1(body); ext = { shape: 'round', r: 1.55, y0: 0, y1: 3.4 }; }
    else if (stage === 2) { tower1(base); floor2(body, 3.35); ext = { shape: 'round', r: 1.4, y0: 3.35, y1: 5.2, sy: 0 }; }
    else {
      tower1(base); floor2(base, 3.35);
      const yd = 5.15;
      body.cyl(1.22, 1.22, 0.2, SEG, 0, yd + 0.05, 0, C(P.brassDark), { shade: 0.2 });
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; body.push(cos(a) * 1.15, yd, sin(a) * 1.15, -a); body.box(0.08, 0.35, 0.12, 0, 0.2, 0, C(P.brass)); body.pop(); }
      // dome mover: copper hemisphere with ribs, slit, telescope, beacon
      const dm = new B(T), dome = C('#6fb7a4'), cop = C(P.copper);
      dm.sph(1.15, 0, 0, 0, dome, { half: true, w: 14, h: 6, j: 0.07, shade: 0.35 });
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU, pts = []; for (let s = 0; s <= 5; s++) { const el = s / 5 * (PI / 2 - 0.1); pts.push([cos(a) * cos(el) * 1.18, sin(el) * 1.18, sin(a) * cos(el) * 1.18]); }
        dm.tube(pts, 0.04, 0.03, 4, cop, { j: 0.06 });
      }
      dm.torus(1.17, 0.05, 0, 0.0, 0, cop, { rx: PI / 2, ts: 18, rs: 4 });
      // slit towards +x, dark with glowing sky
      dm.push(0, 0, 0, 0); dm.box(0.5, 0.16, 0.0, 0, 0, 0, C(P.cloth), { shade: 0 }); dm.pop();
      dm.box(0.7, 1.0, 0.36, 0.78, 0.58, 0, C('#241f2c'), { rz: -0.62, shade: 0, j: 0.05 });
      dm.beam(0.35, 1.1, -0.2, 1.0, 0.45, -0.2, 0.05, cop); dm.beam(0.35, 1.1, 0.2, 1.0, 0.45, 0.2, 0.05, cop);
      dm.cyl(0.09, 0.09, 0.35, 6, 0, 1.28, 0, C(P.brass)); dm.cone(0.1, 0.2, 6, 0, 1.52, 0, C(P.brassDark));
      dm.ico(0.14, 0, 1.78, 0, C(P.crystal), { glow: 1, shade: 0, d: 0 });
      dm.torus(0.2, 0.02, 0, 1.78, 0, C(P.brass), { rx: PI / 2, ts: 10, rs: 3 });
      mv.push({ id: 'dome', b: dm, at: [0, yd + 0.15, 0] });
      // telescope sits on its own mover so it turns with the dome yet stays separate (cheap): merged into dome mover
      const tl = new B(T);
      tl.push(0, 0, 0, 0, 1, 0, 0.72);
      tl.cyl(0.14, 0.12, 1.5, 9, 0.5, 0, 0, C(P.brass), { rz: PI / 2, j: 0.06, shade: 0.2 });
      tl.cyl(0.19, 0.19, 0.12, 9, 1.3, 0, 0, C(P.brassDark), { rz: PI / 2, shade: 0 }); tl.cyl(0.15, 0.15, 0.04, 9, 1.37, 0, 0, C('#9fe0f0'), { rz: PI / 2, glow: 0.5, shade: 0 });
      tl.cyl(0.17, 0.17, 0.08, 9, -0.1, 0, 0, C(P.brassDark), { rz: PI / 2, shade: 0 });
      tl.pop();
      tl.cyl(0.05, 0.05, 0.7, 5, 0.3, -0.35, 0, C(P.iron));
      mv.push({ id: 'scope', b: tl, at: [0.0, yd + 0.85 + 0.1, 0], parent: 'dome', pitchBase: 0 });
      anch.beacon = { on: 'dome', at: [0, 1.95, 0] };
      ext = { shape: 'round', r: 1.25, y0: 5.1, y1: 7.4 };
    }
    return { base: stage > 1 ? base : null, body, movers: mv, ext, ruinCol, anchors: anch, stage };
  };

  function building(T, kind, opts) {
    opts = opts || {};
    const q = qOf(opts), stage = clamp(opts.stage | 0 || 1, 1, kind === 'sternwarte' ? 3 : 1), fn = KINDS[kind];
    if (!fn) throw new Error('SkyfarersArt.building: unknown kind ' + kind);
    const rnd = rng(hash2(kind.length, stage) * 1e6 + 5), def = fn(T, q, stage, rnd), ext = def.ext;
    const mat = getMat(T, q, 'solid'), matW = getMat(T, q, 'water'), group = new T.Group(), chars = [];
    const addMesh = (b, parent, charr) => { const m = b.mesh(mat); parent.add(m); if (charr !== false) chars.push(charrable(m.geometry)); return m; };
    const cx = ext.cx || 0;
    // foundation plinth (stage 1 only; later stages grow out of the lower floors)
    const fB = new B(T), plinth = C(P.stoneDark);
    if (stage === 1) {
      if (ext.shape === 'round') { fB.cyl(ext.r + 0.3, ext.r + 0.38, 0.28, 12, 0, 0.1, 0, plinth, { j: 0.12 }); fB.cyl(ext.r + 0.1, ext.r + 0.1, 0.04, 12, 0, 0.26, 0, C(P.plankDark)); }
      else { fB.bbox(cx - ext.w / 2 - 0.3, -0.05, -ext.d / 2 - 0.3, cx + ext.w / 2 + 0.3, 0.26, ext.d / 2 + 0.3, plinth, { j: 0.12 }); fB.bbox(cx - ext.w / 2 - 0.2, 0.2, -ext.d / 2 - 0.2, cx + ext.w / 2 + 0.2, 0.28, ext.d / 2 + 0.2, C(P.plankDark), { j: 0.1 }); }
    } else fB.cyl(0.01, 0.01, 0.01, 3, 0, 0, 0, plinth);
    const found = fB.mesh(mat); group.add(found);
    let baseMesh = null; if (def.base) baseMesh = addMesh(def.base, group);
    const fe = frameGeo(T, ext), se = scaffGeo(T, ext), frame = fe.mesh(mat), scaff = se.mesh(mat);
    frame.position.x = 0; group.add(frame); group.add(scaff);
    // crane (arm pivot rotates)
    const cr = new T.Group(), mastH = ext.y1 + 0.9, mastX = ext.shape === 'round' ? ext.r + 1.1 : (ext.w / 2 + 0.95) + cx, mastZ = ext.shape === 'round' ? 0.2 : -ext.d / 2 - 0.2;
    const mB = new B(T); mB.beam(mastX, 0, mastZ, mastX, mastH, mastZ, 0.14, C(P.woodDark), { tz: 0.14 }); mB.beam(mastX - 0.4, 0, mastZ - 0.35, mastX, mastH * 0.7, mastZ, 0.08, C(P.wood)); mB.beam(mastX + 0.4, 0, mastZ - 0.35, mastX, mastH * 0.7, mastZ, 0.08, C(P.wood)); mB.beam(mastX, 0, mastZ + 0.45, mastX, mastH * 0.7, mastZ, 0.08, C(P.wood));
    const mast = mB.mesh(mat); cr.add(mast);
    const armPivot = new T.Group(); armPivot.position.set(mastX, mastH, mastZ);
    const arm = craneGeo(T, mastH, ext.shape === 'round' ? ext.r + 1.0 : ext.w / 2 + 1.0).mesh(mat); armPivot.add(arm); cr.add(armPivot); group.add(cr);
    // body group (grows during construction)
    const bodyG = new T.Group(); group.add(bodyG);
    const bodyM = addMesh(def.body, bodyG);
    let waterM = null; if (def.water) { waterM = def.water.mesh(matW); waterM.renderOrder = 2; bodyG.add(waterM); }
    const movers = {};
    for (const m of def.movers) {
      const pivot = new T.Group(); pivot.position.set(m.at[0], m.at[1], m.at[2]);
      const mm = m.b.mesh(mat); pivot.add(mm); chars.push(charrable(mm.geometry));
      (m.parent && movers[m.parent] ? movers[m.parent] : bodyG).add(pivot);
      if (m.parent && movers[m.parent]) pivot.position.set(m.at[0], m.at[1] - movers[m.parent].position.y, m.at[2]);
      movers[m.id] = pivot;
    }
    const anchors = {};
    for (const [k, v] of Object.entries(def.anchors)) {
      const o = new T.Object3D(); o.name = k; o.position.set(v.at[0], v.at[1], v.at[2]);
      if (v.on && movers[v.on]) movers[v.on].add(o); else group.add(o);
      anchors[k] = o;
    }
    anchors.crane = armPivot;
    // ruin
    const ruinB = ruinGeo(T, ext, def.ruinCol, null, rng(77)), ruin = addMesh(ruinB, group); ruin.visible = false;
    let ruined = false, buildP = 1;
    const vis = () => {
      const p = buildP, fin = p >= 0.999;
      if (baseMesh) baseMesh.visible = true;
      found.visible = stage === 1 && !ruined && !fin && p > 0.001;
      found.scale.y = clamp(p / 0.12, 0.05, 1);
      frame.visible = !ruined && !fin && p > 0.12 && p < 0.78; frame.scale.y = clamp((p - 0.12) / 0.4, 0.03, 1);
      scaff.visible = !ruined && !fin && p > 0.1; scaff.scale.y = clamp((p - 0.1) / 0.25, 0.03, 1);
      cr.visible = !ruined && !fin && p > 0.04;
      bodyG.visible = !ruined && p > 0.5; const e = clamp((p - 0.5) / 0.5, 0, 1); bodyG.scale.y = fin ? 1 : Math.max(0.04, e * e * (3 - 2 * e));
      ruin.visible = ruined;
    };
    function setBuild(p) { buildP = clamp(p == null ? 1 : p, 0, 1); vis(); }
    function setDamage(hp01, isRuined) {
      const d = 1 - clamp(hp01 == null ? 1 : hp01, 0, 1);
      for (const c of chars) applyChar(c, isRuined ? 1 : d);
      ruined = !!isRuined; vis();
    }
    let lt = null, spin = { blades: 0, gear: 0, dome: 0 }, rate = 0;
    function animate(t, a) {
      a = a || {}; const dt = lt == null ? 0 : clamp(t - lt, 0, 0.25); lt = t;
      const working = !!a.working && !ruined, building = !!a.building;
      if (cr.visible) { armPivot.rotation.y = building ? sin(t * 0.8) * 1.1 : sin(t * 0.25) * 0.2; }
      rate = lerp(rate, working ? 1 : 0.08, 1 - Math.exp(-2 * dt));
      if (movers.blades) { spin.blades += (0.2 + rate * 1.7) * dt; movers.blades.rotation.z = -spin.blades; }
      if (movers.gear1) { spin.gear += rate * 0.9 * dt; movers.gear1.rotation.z = -spin.gear; movers.gear2.rotation.z = spin.gear * 12 / 7 + PI / 7; }
      if (movers.dome) { spin.dome += (0.05 + rate * 0.25) * dt; movers.dome.rotation.y = spin.dome; movers.scope.rotation.y = 0; }
      if (movers.cannon) {
        const target = a.aim != null ? a.aim : (working ? sin(t * 0.5) * 0.9 : 0.3);
        movers.cannon.rotation.y += (target - movers.cannon.rotation.y) * (1 - Math.exp(-4 * dt));
      }
      if (a.night != null) setNight(a.night);
    }
    setBuild(opts.build == null ? 1 : opts.build); setDamage(1, false);
    return { group, setBuild, setDamage, animate, anchors, movers, cannon: movers.cannon || null, stage, kind, body: bodyM };
  }

  // =====================================================================
  // DRAGON — wingspan ~8, nose +X, one skinned mesh
  // =====================================================================
  const dragonGeo = new Map();
  function dragon(T, opts) {
    opts = opts || {}; const q = qOf(opts), low = q === 'low';
    const defs = [
      { n: 'root', p: -1, at: [0, 0, 0] }, { n: 'neck1', p: 0, at: [1.0, 0.3, 0] }, { n: 'neck2', p: 1, at: [1.75, 0.65, 0] }, { n: 'head', p: 2, at: [2.45, 0.8, 0] }, { n: 'jaw', p: 3, at: [2.7, 0.66, 0] },
      { n: 'tail1', p: 0, at: [-1.1, 0.0, 0] }, { n: 'tail2', p: 5, at: [-2.1, -0.05, 0] }, { n: 'tail3', p: 6, at: [-3.1, -0.08, 0] }, { n: 'tail4', p: 7, at: [-4.1, -0.1, 0] }, { n: 'tail5', p: 8, at: [-5.1, -0.1, 0] }, { n: 'tail6', p: 9, at: [-6.1, -0.08, 0] },
      { n: 'wl1', p: 0, at: [0.35, 0.5, 0.45] }, { n: 'wl2', p: 11, at: [0.0, 0.85, 1.9] }, { n: 'wl3', p: 12, at: [-0.6, 0.95, 3.4] },
      { n: 'wr1', p: 0, at: [0.35, 0.5, -0.45] }, { n: 'wr2', p: 14, at: [0.0, 0.85, -1.9] }, { n: 'wr3', p: 15, at: [-0.6, 0.95, -3.4] }
    ];
    const key = q;
    let geo = dragonGeo.get(key);
    if (!geo) {
      const b = new B(T, true);
      const teal = C('#1f8a8a'), tealD = C('#13565f'), purple = C('#4b2f82'), purpleL = C('#7a4fc0'), ember = C('#ff8a2a'), belly = C('#f2a24a'), horn = C('#e8dcc0');
      const chain = [3, 2, 1, 0, 5, 6, 7, 8, 9, 10], chx = chain.map((i) => defs[i].at[0]);
      const wOf = (x) => {
        if (x >= chx[0]) return [chain[0], chain[1], 1];
        for (let i = 0; i < chain.length - 1; i++) if (x <= chx[i] && x > chx[i + 1]) { const w = (x - chx[i + 1]) / (chx[i] - chx[i + 1]); return [chain[i], chain[i + 1], w]; }
        return [chain[chain.length - 1], chain[chain.length - 1], 1];
      };
      // ---- spine tube ----
      const st0 = [[2.25, 0.8, 0.26, 0.24], [1.75, 0.66, 0.32, 0.3], [1.4, 0.47, 0.4, 0.37], [1.0, 0.3, 0.55, 0.5], [0.5, 0.17, 0.72, 0.6], [0.0, 0.1, 0.78, 0.62], [-0.6, 0.05, 0.7, 0.55], [-1.1, 0.0, 0.55, 0.45], [-1.6, -0.02, 0.45, 0.36], [-2.1, -0.05, 0.38, 0.3], [-3.1, -0.08, 0.3, 0.24], [-4.1, -0.1, 0.23, 0.18], [-5.1, -0.1, 0.16, 0.12], [-6.1, -0.08, 0.1, 0.07], [-6.6, -0.06, 0.05, 0.04]];
      const st = [], sub = low ? 1 : 2;
      for (let i = 0; i < st0.length - 1; i++) for (let s = 0; s < sub; s++) { const u = s / sub; st.push(st0[i].map((v, k) => lerp(v, st0[i + 1][k], u))); }
      st.push(st0[st0.length - 1]);
      const NS = low ? 7 : 10, rings = st.map((s) => { const row = []; for (let k = 0; k < NS; k++) { const a = (k / NS) * TAU; row.push([s[0], s[1] + s[2] * sin(a), s[3] * cos(a)]); } return row; });
      for (let i = 0; i < st.length - 1; i++) for (let k = 0; k < NS; k++) {
        const k2 = (k + 1) % NS, am = ((k + 0.5) / NS) * TAU, sa = sin(am), w0 = wOf(st[i][0]), w1 = wOf(st[i + 1][0]);
        let c;
        if (sa < -0.3) c = mix(belly, ember, 0.25 + 0.4 * (i % 2)); else if (sa < 0.25) c = mix(teal, tealD, 0.3 + 0.3 * hash2(i, k)); else c = mix(teal, purple, clamp(0.25 + sa * 0.5 + (i % 3) * 0.1, 0, 1));
        b.quad(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k], c, { j: 0.09, sk: [w0, w0, w1, w1] });
      }
      // dorsal spines
      for (let i = 1; i < st.length - 2; i += 1) {
        const s = st[i], h = 0.22 * (0.4 + clamp(s[2] * 1.2, 0.1, 1)) * (i % 2 ? 0.8 : 1);
        b.bone = wOf(s[0]); b.cone(0.07 + s[3] * 0.1, h, 4, s[0], s[1] + s[2] + h * 0.35, 0, i % 3 === 0 ? ember : purpleL, { rz: -0.35, j: 0.1, shade: 0.2 });
      }
      // legs: thick thigh, bent knee, claws
      for (const [lx, ly, lz, bx] of [[0.75, -0.42, 0.5, 0.75], [-0.75, -0.42, 0.45, -0.75]]) for (const sg of [-1, 1]) {
        b.bone = wOf(bx);
        b.sph(0.3, lx, ly + 0.28, sg * (lz - 0.12), tealD, { s: [1, 1, 0.8], w: 7, h: 5, j: 0.1 });
        b.tube([[lx, ly + 0.28, sg * (lz - 0.05)], [lx - 0.22, ly - 0.05, sg * (lz + 0.22)], [lx + 0.1, ly - 0.38, sg * (lz + 0.3)]], 0.18, 0.07, 5, tealD, { j: 0.1 });
        for (let c = -1; c <= 1; c++) b.cone(0.035, 0.2, 4, lx + 0.25, ly - 0.45, sg * (lz + 0.3 + c * 0.07), horn, { rz: -1.35, j: 0.05 });
      }
      // tail fin (diamond vertical + horizontal), weighted to the last tail bones
      b.bone = [10, 9, 0.7];
      const fin = (pts, c, c2) => { b.quad(pts[0], pts[1], pts[2], pts[3], c, { double: true, j: 0.06 }); b.tri(pts[0], pts[1], pts[2], c2, { j: 0.05 }); };
      fin([[-6.0, 0, 0], [-6.7, 0.2, 0], [-7.2, 0.75, 0], [-6.8, 0.15, 0]], purpleL, purple);
      b.quad([-6.2, -0.08, 0], [-6.9, -0.1, 0], [-7.5, -0.7, 0], [-6.9, -0.05, 0], purple, { double: true });
      b.quad([-6.3, -0.06, 0.0], [-7.0, -0.06, 0.0], [-7.7, -0.05, 0.0], [-7.0, -0.05, 0.0], purple, { double: true });
      b.quad([-6.0, -0.08, 0], [-6.9, -0.08, 0.7], [-7.5, -0.08, 0.0], [-6.9, -0.08, -0.7], mix(purpleL, ember, 0.2), { double: true, j: 0.08 });
      b.cone(0.1, 0.5, 4, -6.7, -0.08, 0, ember, { rz: PI / 2 + PI, j: 0.05 });
      // ---- head (head bone) ----
      b.bone = [3, 2, 1];
      b.sph(0.4, 2.7, 0.88, 0, teal, { s: [1.35, 0.85, 0.95], j: 0.1, w: 9, h: 6 });
      b.sph(0.3, 3.2, 0.82, 0, mix(teal, tealD, 0.2), { s: [1.45, 0.6, 0.8], j: 0.1, w: 8, h: 5 });
      b.sph(0.12, 3.52, 0.9, 0.0, tealD, { s: [1, 0.6, 1.6], w: 6, h: 4 });
      for (const sg of [-1, 1]) {
        b.ico(0.045, 3.58, 0.93, sg * 0.1, C('#101820'), { d: 0, shade: 0 });                       // nostrils
        b.ico(0.1, 2.98, 1.0, sg * 0.31, ember, { d: 0, glow: 1, shade: 0, j: 0.04 });               // eyes
        b.ico(0.045, 3.04, 1.0, sg * 0.4, C('#301000'), { d: 0, shade: 0, j: 0 });
        b.box(0.45, 0.07, 0.12, 2.9, 1.12, sg * 0.3, tealD, { rx: sg * 0.2, rz: -0.25, shade: 0 });   // brow
        b.sph(0.14, 2.45, 0.8, sg * 0.4, purple, { s: [1.2, 0.8, 0.5], j: 0.1, w: 6, h: 4 });         // cheek frill
        b.quad([2.5, 0.8, sg * 0.35], [1.95, 1.1, sg * 0.7], [1.8, 0.5, sg * 0.75], [2.4, 0.5, sg * 0.4], purpleL, { double: true, j: 0.08 });  // ear fin
        for (let t = 0; t < (low ? 3 : 5); t++) b.cone(0.03, 0.14, 4, 3.0 + t * 0.14, 0.62, sg * (0.2 - t * 0.012), C('#fffbe8'), { rx: PI, shade: 0, j: 0.02 });  // upper teeth
        // horns
        const hp = []; for (let s = 0; s <= 5; s++) { const u = s / 5; hp.push([2.62 - u * 0.95, 1.12 + u * 0.7 + 0.4 * u * u, sg * (0.22 + u * 0.4)]); }
        b.tube(hp, 0.1, 0.015, 5, (i) => (i < 3 ? horn : mix(horn, ember, 0.5)), { j: 0.08 });
        const hp2 = []; for (let s = 0; s <= 3; s++) { const u = s / 3; hp2.push([2.4 - u * 0.4, 0.9 + u * 0.25, sg * (0.42 + u * 0.35)]); }
        b.tube(hp2, 0.06, 0.012, 4, horn, { j: 0.08 });
      }
      b.beam(2.6, 1.22, 0, 3.0, 1.1, 0, 0.08, purple); b.cone(0.08, 0.3, 4, 2.4, 1.2, 0, purpleL, { rz: 1.2 });
      b.box(0.35, 0.1, 0.2, 3.15, 0.66, 0, C('#a02810'), { glow: 0.9, shade: 0, j: 0.05 });          // glowing throat
      b.bone = [4, 3, 1];
      b.sph(0.26, 3.12, 0.55, 0, mix(tealD, ember, 0.25), { s: [1.5, 0.45, 0.78], j: 0.1, w: 8, h: 5 });
      for (const sg of [-1, 1]) for (let t = 0; t < (low ? 2 : 4); t++) b.cone(0.03, 0.12, 4, 3.05 + t * 0.15, 0.68, sg * (0.18 - t * 0.012), C('#fffbe8'), { shade: 0, j: 0.02 });
      // ---- wings ----
      for (const sg of [1, -1]) {
        const b1 = sg > 0 ? 11 : 14, b2 = b1 + 1, b3 = b1 + 2, W = (x, y, z) => [x, y, z * sg];
        b.bone = [b1, b2, 0.55];
        b.tube([W(0.35, 0.5, 0.45), W(0.2, 0.7, 1.2), W(0.0, 0.85, 1.9)], 0.2, 0.13, 5, teal, { j: 0.08 });
        b.bone = [b2, b3, 0.5];
        b.tube([W(0.0, 0.85, 1.9), W(-0.3, 0.9, 2.6), W(-0.6, 0.95, 3.4)], 0.13, 0.08, 5, teal, { j: 0.08 });
        b.bone = [b3, b3, 1];
        const Wr = W(-0.6, 0.95, 3.4), F = [W(1.4, 0.8, 3.95), W(0.4, 0.97, 4.3), W(-0.8, 0.92, 4.0), W(-1.9, 0.78, 3.2)];
        for (const t of F) b.tube([Wr, t], 0.06, 0.015, 4, purple, { j: 0.06 });
        b.cone(0.07, 0.24, 4, -0.6, 0.98, 3.5 * sg, horn, { rx: sg * 1.4, j: 0.04 });
        const SH = [W(0.35, 0.5, 0.45), [b1, b1, 1]], EL = [W(0.0, 0.85, 1.9), [b2, b2, 1]], WR = [Wr, [b3, b3, 1]], M1 = [W(-1.55, 0.5, 1.7), [b2, b2, 1]], BK = [W(-1.75, 0.3, 0.55), [b1, b1, 1]], BK2 = [W(-1.0, 0.45, 1.1), [b1, b2, 0.5]];
        const FT = F.map((p) => [p, [b3, b3, 1]]), pull = (a, c, f) => { const m = [(a[0][0] + c[0][0]) / 2, (a[0][1] + c[0][1]) / 2, (a[0][2] + c[0][2]) / 2]; return [[lerp(m[0], Wr[0], f), lerp(m[1], Wr[1], f) - 0.08, lerp(m[2], Wr[2], f)], [b3, b3, 1]]; };
        const sc = [pull(FT[0], FT[1], 0.3), pull(FT[1], FT[2], 0.3), pull(FT[2], FT[3], 0.3), pull(FT[3], M1, 0.25)];
        const tri = (A, B2, Cc, col) => { const ord = sg > 0 ? [A, B2, Cc] : [A, Cc, B2]; b.tri(ord[0][0], ord[1][0], ord[2][0], col, { j: 0.09, sk: [ord[0][1], ord[1][1], ord[2][1]] }); };
        const cA = mix(purple, purpleL, 0.15), cB = mix(purple, purpleL, 0.45), cC = mix(purple, teal, 0.35), cD = mix(purple, ember, 0.22);
        tri(WR, FT[0], sc[0], cB); tri(WR, sc[0], FT[1], cA); tri(WR, FT[1], sc[1], cB); tri(WR, sc[1], FT[2], cA);
        tri(WR, FT[2], sc[2], cB); tri(WR, sc[2], FT[3], cC); tri(WR, FT[3], sc[3], cA); tri(WR, sc[3], M1, cC);
        tri(EL, WR, M1, cD); tri(EL, M1, BK2, cA); tri(M1, BK, BK2, cD); tri(SH, EL, BK2, cC); tri(SH, BK2, BK, cA);
      }
      geo = b.geo(); dragonGeo.set(key, geo);
    }
    const bones = makeBones(T, defs), mesh = skinned(T, geo, getMat(T, q, 'double'), bones);
    const group = new T.Group(); group.add(mesh);
    const [root, neck1, neck2, head, jaw] = bones, tails = bones.slice(5, 11), wl = bones.slice(11, 14), wr = bones.slice(14, 17);
    const mouth = new T.Object3D(); mouth.position.set(0.9, -0.12, 0); head.add(mouth); mouth.name = 'mouth';
    let lt = null, ph = 0, br = 0, fl = 0;
    function animate(t, a) {
      a = a || {}; const dt = lt == null ? 0 : clamp(t - lt, 0, 0.25); lt = t;
      const flap = a.flap == null ? 1 : a.flap, k = 1 - Math.exp(-6 * dt);
      br = lerp(br, a.breathing ? 1 : 0, k); fl = lerp(fl, a.fleeing ? 1 : 0, k);
      ph += dt * (4.4 + 2.6 * fl) * (0.5 + 0.5 * flap);
      const up = (v) => v * flap;
      wl[0].rotation.x = -(sin(ph) * 0.55 + 0.12) * (0.25 + 0.75 * flap); wl[1].rotation.x = -sin(ph - 0.8) * 0.4 * flap; wl[2].rotation.x = -sin(ph - 1.6) * 0.35 * flap;
      wr[0].rotation.x = (sin(ph) * 0.55 + 0.12) * (0.25 + 0.75 * flap); wr[1].rotation.x = sin(ph - 0.8) * 0.4 * flap; wr[2].rotation.x = sin(ph - 1.6) * 0.35 * flap;
      wl[1].rotation.y = wr[1].rotation.y = 0;
      root.position.y = -sin(ph) * 0.14 * flap; root.rotation.z = cos(ph) * 0.05 * flap + 0.22 * fl - 0.12 * br;
      const amp = 0.24 * (1 - 0.5 * fl);
      for (let i = 0; i < 6; i++) { tails[i].rotation.y = sin(t * 2.2 - i * 0.75) * amp; tails[i].rotation.z = sin(ph - i * 0.6) * 0.045 * flap - 0.01; }
      neck1.rotation.y = sin(t * 1.3) * 0.09; neck2.rotation.y = sin(t * 1.3 + 1) * 0.11; neck1.rotation.z = 0.05 + 0.1 * br; neck2.rotation.z = -0.04 + 0.12 * br;
      head.rotation.z = 0.12 * br - 0.1 * fl; head.rotation.y = -neck1.rotation.y * 1.5;
      jaw.rotation.z = -(0.08 + 0.55 * br + 0.04 * sin(t * 3));
      if (a.night != null) setNight(a.night);
    }
    animate(0, { flap: 1 });
    return { group, animate, mesh, anchors: { mouth } };
  }

  // scene statistics for the gallery / budgets: visible meshes and (draw-range aware) triangles
  function stats(root) {
    let tris = 0, calls = 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      let v = o; let vis = true; while (v && v !== root) { if (!v.visible) { vis = false; break; } v = v.parent; }
      if (!vis) return;
      const g = o.geometry; let n = g.index ? g.index.count : g.attributes.position.count;
      const dr = g.drawRange; if (dr && isFinite(dr.count)) n = Math.min(n, dr.count);
      tris += n / 3; calls++;
    });
    return { tris: Math.round(tris), calls };
  }

  window.SkyfarersArt = { palette, ship, animateShip, homeIsland, islet, building, dragon, crate, harpoon, person, setNight, stats };
})();
