// ===== Neonspur renderer (three.js) ==========================
// Neon-noir light-cycle arena: merged static arena, per-rider growing
// light walls, low-poly bikes, pooled effects, pov/chase/overview cameras.
// Look (quality 'high'): space sky + stars, glossy floor with mirrored walls,
// bloom (render targets + shader passes, core three only). Phase 2: Turbo
// flames, grind sparks, holo items, shield bubble, blast shockwave.
// Plain script; THREE is handed to the constructor (window.THREE is set
// by a module script that loads after plain scripts). See docs/NEONSPUR.md.
// ============================================================
(function () {
  'use strict';
  const YAW = [-Math.PI / 2, Math.PI, Math.PI / 2, 0];
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapPi = (a) => { a %= Math.PI * 2; if (a > Math.PI) a -= Math.PI * 2; if (a < -Math.PI) a += Math.PI * 2; return a; };
  const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
  const col3 = (c, k) => [c.r * k, c.g * k, c.b * k];
  const ITEM_COL = { boost: '#3dff8a', jump: '#ffd60a', shield: '#4de1ff', blast: '#ff4d6d' };

  // ---- tiny indexed mesh builder with vertex colours + uvs ----
  class MB {
    constructor() { this.p = []; this.u = []; this.c = []; this.i = []; }
    v(x, y, z, c, u, w) { this.p.push(x, y, z); this.u.push(u || 0, w || 0); this.c.push(c[0], c[1], c[2]); return this.p.length / 3 - 1; }
    quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
    tri(a, b, c) { this.i.push(a, b, c); }
    // quad from four [x,y,z] points with per-vertex colours
    q4(P, C, UV) {
      const ix = [];
      for (let k = 0; k < 4; k++) ix.push(this.v(P[k][0], P[k][1], P[k][2], (Array.isArray(C[0]) ? C[k] : C), UV ? UV[k][0] : 0, UV ? UV[k][1] : 0));
      this.quad(ix[0], ix[1], ix[2], ix[3]);
    }
    get empty() { return !this.i.length; }
    geo(T) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
      g.setIndex(this.i);
      return g;
    }
  }

  // floor / terrace texture: dim grid, hot major lines, soft glow around them (tile wraps every 4 cells)
  // Light-wall bodies fade close to the camera, so a wall you grind along in POV
  // doesn't blow out half the view (constants inline: one shader program for all walls).
  function nearFade(mat) {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying float vNsDepth;\nvoid main() {')
        .replace('#include <project_vertex>', '#include <project_vertex>\n\tvNsDepth = -mvPosition.z;');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying float vNsDepth;\nvoid main() {')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n\tgl_FragColor.rgb *= mix(0.22, 1.0, smoothstep(0.7, 3.6, vNsDepth));');
    };
    return mat;
  }

  function gridTexture(T, bg, line, bright, aniso) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
    const strip = (vertical, o, wd, color, alpha) => {
      g.globalAlpha = alpha; g.fillStyle = color;
      for (const k of [o - 256, o, o + 256]) { if (vertical) g.fillRect(k - wd / 2, 0, wd, 256); else g.fillRect(0, k - wd / 2, 256, wd); }
      g.globalAlpha = 1;
    };
    for (let i = 0; i < 4; i++) {
      const o = i * 64, major = i === 0;
      for (const v of [true, false]) {
        if (major) { strip(v, o, 20, bright, 0.05); strip(v, o, 10, bright, 0.1); strip(v, o, 3, bright, 1); }
        else { strip(v, o, 9, line, 0.1); strip(v, o, 3, line, 1); }
      }
    }
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = aniso;
    return t;
  }
  function dotTexture(T) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }

  // ---- merge primitives into one vertex-coloured geometry (one draw call per bike / item) ----
  function mergeColored(T, list) {
    const pos = [], col = [], idx = [];
    for (const { g, c } of list) {
      const p = g.attributes.position, base = pos.length / 3;
      for (let k = 0; k < p.count; k++) { pos.push(p.getX(k), p.getY(k), p.getZ(k)); col.push(c.r, c.g, c.b); }
      if (g.index) for (let k = 0; k < g.index.count; k++) idx.push(base + g.index.getX(k));
      else for (let k = 0; k < p.count; k++) idx.push(base + k);
      g.dispose();
    }
    const m = new T.BufferGeometry();
    m.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    m.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    m.setIndex(idx);
    return m;
  }

  function buildBikeGeo(T, color) {
    const dark = new T.Color('#1a2033').lerp(color, 0.4), dark2 = new T.Color('#2a3350').lerp(color, 0.55);
    const bright = color.clone().lerp(new T.Color('#ffffff'), 0.25);
    const canopy = color.clone().lerp(new T.Color('#ffffff'), 0.5).multiplyScalar(0.55);
    const L = [];
    L.push({ g: new T.BoxGeometry(0.26, 0.13, 0.7).translate(0, 0.24, 0.02), c: dark });
    L.push({ g: new T.ConeGeometry(0.17, 0.5, 4).rotateY(Math.PI / 4).scale(1, 1, 0.55).rotateX(-Math.PI / 2).translate(0, 0.23, -0.55), c: dark2 });
    L.push({ g: new T.BoxGeometry(0.275, 0.03, 0.62).translate(0, 0.24, 0.02), c: color });   // side stripe
    L.push({ g: new T.BoxGeometry(0.08, 0.03, 0.66).translate(0, 0.315, 0.02), c: bright });  // top stripe
    for (const z of [-0.36, 0.36]) L.push({ g: new T.TorusGeometry(0.2, 0.05, 6, 18).rotateY(Math.PI / 2).translate(0, 0.25, z), c: bright });
    L.push({ g: new T.SphereGeometry(0.125, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.9, 0.85, 1.5).translate(0, 0.3, 0.1), c: canopy });
    return mergeColored(T, L);
  }

  // holo icon per item kind, about 0.7 units tall, centred on the origin
  function buildItemGeo(T, kind, color) {
    const W = new T.Color('#ffffff'), body = color.clone().multiplyScalar(0.45), hot = color.clone().lerp(W, 0.25).multiplyScalar(1.5), white = W.clone().multiplyScalar(1.6);
    const L = [];
    if (kind === 'boost') {            // battery: body + bands + terminal + bolt
      L.push({ g: new T.CylinderGeometry(0.17, 0.17, 0.5, 14).translate(0, -0.03, 0), c: body });
      for (const y of [-0.2, 0.14]) L.push({ g: new T.CylinderGeometry(0.18, 0.18, 0.05, 14).translate(0, y, 0), c: hot });
      L.push({ g: new T.CylinderGeometry(0.075, 0.075, 0.1, 10).translate(0, 0.27, 0), c: white });
      L.push({ g: new T.BoxGeometry(0.1, 0.2, 0.36).rotateZ(0.35).translate(0, -0.03, 0), c: white });
    } else if (kind === 'jump') {      // spring + up arrow
      for (let k = 0; k < 4; k++) L.push({ g: new T.TorusGeometry(0.15 + (k % 2) * 0.03, 0.035, 6, 14).rotateX(Math.PI / 2).translate(0, -0.3 + k * 0.1, 0), c: hot });
      L.push({ g: new T.ConeGeometry(0.17, 0.26, 4).rotateY(Math.PI / 4).translate(0, 0.28, 0), c: white });
      L.push({ g: new T.BoxGeometry(0.1, 0.12, 0.1).translate(0, 0.1, 0), c: hot });
    } else if (kind === 'shield') {    // hex shield: rings + dark disc
      L.push({ g: new T.CylinderGeometry(0.3, 0.3, 0.05, 6).rotateX(Math.PI / 2), c: body });
      L.push({ g: new T.TorusGeometry(0.33, 0.045, 6, 6), c: white });
      L.push({ g: new T.TorusGeometry(0.19, 0.035, 6, 6), c: hot });
      L.push({ g: new T.CylinderGeometry(0.06, 0.06, 0.09, 6).rotateX(Math.PI / 2), c: white });
    } else {                           // blast: spiky star
      L.push({ g: new T.IcosahedronGeometry(0.16, 0), c: white });
      const up = new T.Vector3(0, 1, 0), dirs = [];
      for (const s of [-1, 1]) { dirs.push([s, 0, 0], [0, s, 0], [0, 0, s]); }
      for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) dirs.push([a, b, c]);
      for (const d of dirs) {
        const v = new T.Vector3(d[0], d[1], d[2]).normalize(), q = new T.Quaternion().setFromUnitVectors(up, v), diag = Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) > 1;
        L.push({ g: new T.ConeGeometry(0.07, diag ? 0.22 : 0.32, 5).translate(0, diag ? 0.2 : 0.25, 0).applyQuaternion(q), c: diag ? hot : color.clone().multiplyScalar(1.4) });
      }
    }
    return mergeColored(T, L);
  }

  // ---- shaders ----
  const GL_NOISE = `
    float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
    float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }`;
  const SKY_VS = 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const SKY_FS = `
    varying vec3 vDir;
    uniform vec3 uTop, uMid, uHor, uNebA, uNebB, uPlanet;
    uniform float uTime, uNeb;
    ${GL_NOISE}
    void main(){
      vec3 d = normalize(vDir); float y = d.y;
      vec3 col = mix(uMid, uTop, smoothstep(0.0, 0.85, y));
      col = mix(uMid * 0.22, col, smoothstep(-0.6, 0.04, y));
      col += uHor * exp(-abs(y) * 6.5);
      if (uNeb > 0.5) {
        vec3 q = d * 2.3 + vec3(uTime * 0.006, 0.0, uTime * 0.004);
        float m1 = smoothstep(0.40, 0.82, fbm(q));
        float m2 = smoothstep(0.42, 0.86, fbm(q * 1.6 + vec3(11.3, 2.1, 5.7)));
        float vis = 0.35 + 0.65 * smoothstep(-0.25, 0.3, y);
        col += (uNebA * m1 * 0.9 + uNebB * m2 * 0.8) * vis;
      }
      // ringed planet
      vec3 P = normalize(uPlanet);
      float dp = dot(d, P);
      if (dp > 0.0) {
        vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), P)), B = cross(P, T);
        vec2 c = vec2(dot(d, T), dot(d, B)) / 0.085;
        float cs = cos(0.5), sn = sin(0.5);
        vec2 r2 = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
        float rr = length(vec2(r2.x, r2.y / 0.3));
        float ring = smoothstep(1.35, 1.45, rr) * (1.0 - smoothstep(2.0, 2.15, rr)) * (0.55 + 0.45 * sin(rr * 38.0));
        float len = length(c);
        bool front = r2.y < 0.0;
        if (len < 1.0) {
          vec3 n = vec3(c, sqrt(1.0 - len * len));
          float sh = max(dot(n, normalize(vec3(-0.6, 0.5, 0.65))), 0.0);
          vec3 base = mix(uNebB, uNebA, 0.5 + 0.5 * sin(c.y * 7.0 + 1.5 * sin(c.y * 3.0))) * 0.9 + vec3(0.04);
          col = base * (0.12 + 0.95 * sh) + uHor * 0.9 * pow(1.0 - n.z, 3.0);
          if (front) col = mix(col, uHor * 1.6 + vec3(0.05), ring * 0.55);
        } else col = mix(col, uHor * 1.4 + vec3(0.04), ring * 0.45);
      }
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`;
  const STAR_VS = `
    attribute float aSize; attribute float aPh; attribute vec3 aCol;
    uniform float uTime, uPx; varying vec3 vC; varying float vT;
    void main(){ vC = aCol; vT = 0.62 + 0.38 * sin(uTime * (1.0 + aPh * 0.9) + aPh * 40.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uPx * (0.85 + 0.3 * vT); }`;
  const STAR_FS = `
    varying vec3 vC; varying float vT;
    void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a;
      gl_FragColor = vec4(vC * vT * a * 1.7, 1.0);
      #include <colorspace_fragment>
    }`;
  const FS_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const BRIGHT_FS = `
    varying vec2 vUv; uniform sampler2D tMap; uniform vec2 uTexel; uniform float uThr;
    void main(){
      vec3 c = texture2D(tMap, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tMap, vUv + uTexel * vec2(0.5, -0.5)).rgb
             + texture2D(tMap, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tMap, vUv + uTexel * vec2(0.5, 0.5)).rgb;
      c *= 0.25;
      float b = max(c.r, max(c.g, c.b)); float k = max(b - uThr, 0.0) / max(b, 1e-3);
      gl_FragColor = vec4(c * k, 1.0);
    }`;
  const BLUR_FS = `
    varying vec2 vUv; uniform sampler2D tMap; uniform vec2 uStep;
    void main(){
      vec3 c = texture2D(tMap, vUv).rgb * 0.2270270270;
      c += (texture2D(tMap, vUv + uStep * 1.3846153846).rgb + texture2D(tMap, vUv - uStep * 1.3846153846).rgb) * 0.3162162162;
      c += (texture2D(tMap, vUv + uStep * 3.2307692308).rgb + texture2D(tMap, vUv - uStep * 3.2307692308).rgb) * 0.0702702703;
      gl_FragColor = vec4(c, 1.0);
    }`;
  const COMP_FS = `
    varying vec2 vUv; uniform sampler2D tMain, tB1, tB2; uniform float uS1, uS2;
    void main(){
      vec3 c = texture2D(tMain, vUv).rgb + texture2D(tB1, vUv).rgb * uS1 + texture2D(tB2, vUv).rgb * uS2;
      float m = max(c.r, max(c.g, c.b)); c += vec3(max(m - 1.0, 0.0) * 0.3);   // overbright drifts to white-hot
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      #include <colorspace_fragment>
    }`;

  // ---- growing light wall for one rider ----
  class LightWall {
    constructor(T, w, h, color, TH) {
      this.T = T; this.TH = TH; this.rev = 0;
      const pts = w * h;
      this.bCap = pts * 5 + 16; this.eCap = pts * 4 + 16;
      const mk = (cap) => {
        const g = new T.BufferGeometry();
        const pos = new T.BufferAttribute(new Float32Array(cap * 12), 3), cl = new T.BufferAttribute(new Float32Array(cap * 12), 3);
        pos.setUsage(T.DynamicDrawUsage); cl.setUsage(T.DynamicDrawUsage);
        const idx = new Uint32Array(cap * 6);
        for (let q = 0; q < cap; q++) { const v = q * 4, i = q * 6; idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2; idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3; }
        g.setAttribute('position', pos); g.setAttribute('color', cl); g.setIndex(new T.BufferAttribute(idx, 1));
        g.setDrawRange(0, 0);
        return g;
      };
      this.bGeo = mk(this.bCap); this.eGeo = mk(this.eCap);
      const white = new T.Color('#ffffff');
      // more saturated body, white-hot core
      const sat = color.clone(); const hsl = {}; sat.getHSL(hsl); sat.setHSL(hsl.h, Math.min(1, hsl.s * 1.1 + 0.1), clamp(hsl.l, 0.45, 0.58));
      this.cTop = col3(sat, 0.8); this.cBot = col3(sat, 0.2); this.cSpill = col3(sat, 0.3); this.cNone = [0, 0, 0];
      this.cBand = col3(sat.clone().lerp(white, 0.3), 1.25);
      this.cEdge = col3(sat.clone().lerp(white, 0.5), 1.25);
      this.bMat = nearFade(new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }));
      this.eMat = new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, fog: false });
      this.bMatM = nearFade(new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
      this.eMatM = new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide });
      this.bMatM.color.setScalar(1.5); this.eMatM.color.setScalar(0.9);
      this.body = new T.Mesh(this.bGeo, this.bMat); this.edge = new T.Mesh(this.eGeo, this.eMat);
      this.bodyM = new T.Mesh(this.bGeo, this.bMatM); this.edgeM = new T.Mesh(this.eGeo, this.eMatM);
      for (const m of [this.body, this.edge, this.bodyM, this.edgeM]) m.frustumCulled = false;
      this.body.renderOrder = 5; this.edge.renderOrder = 4; this.bodyM.renderOrder = 0; this.edgeM.renderOrder = 0;
      this.bodyM.scale.y = this.edgeM.scale.y = -1;
      this.reset();
    }
    meshes() { return [this.body, this.edge, this.bodyM, this.edgeM]; }
    setMirror(on) { this.bodyM.visible = this.edgeM.visible = on; }
    reset() { this.built = 0; this.bq = 0; this.eq = 0; this.bGeo.setDrawRange(0, 0); this.eGeo.setDrawRange(0, 0); }
    // write one quad into (pos,col) at quad index q
    wq(pos, col, q, a, b, c, d, ca, cb, cc, cd) {
      const P = pos.array, C = col.array, o = q * 12;
      P[o] = a[0]; P[o + 1] = a[1]; P[o + 2] = a[2]; P[o + 3] = b[0]; P[o + 4] = b[1]; P[o + 5] = b[2];
      P[o + 6] = c[0]; P[o + 7] = c[1]; P[o + 8] = c[2]; P[o + 9] = d[0]; P[o + 10] = d[1]; P[o + 11] = d[2];
      C[o] = ca[0]; C[o + 1] = ca[1]; C[o + 2] = ca[2]; C[o + 3] = cb[0]; C[o + 4] = cb[1]; C[o + 5] = cb[2];
      C[o + 6] = cc[0]; C[o + 7] = cc[1]; C[o + 8] = cc[2]; C[o + 9] = cd[0]; C[o + 10] = cd[1]; C[o + 11] = cd[2];
    }
    // segment between two wall bases (x,z world; h = base height)
    seg(ax, az, ah, bx, bz, bh) {
      const T = this.TH, bp = this.bGeo.attributes.position, bc = this.bGeo.attributes.color, ep = this.eGeo.attributes.position, ec = this.eGeo.attributes.color;
      if (this.bq + 4 > this.bCap || this.eq + 3 > this.eCap) return;
      let dx = bx - ax, dz = bz - az; const l = Math.hypot(dx, dz) || 1; const nx = -dz / l, nz = dx / l;
      this.wq(bp, bc, this.bq++, [ax, ah, az], [bx, bh, bz], [bx, bh + T, bz], [ax, ah + T, az], this.cBot, this.cBot, this.cTop, this.cTop);
      const s = 0.7, no = this.cNone, cs = this.cSpill;   // soft light spill on the floor, fades outwards
      this.wq(bp, bc, this.bq++, [ax + nx * s, ah + 0.02, az + nz * s], [bx + nx * s, bh + 0.02, bz + nz * s], [bx, bh + 0.02, bz], [ax, ah + 0.02, az], no, no, cs, cs);
      this.wq(bp, bc, this.bq++, [ax - nx * s, ah + 0.02, az - nz * s], [bx - nx * s, bh + 0.02, bz - nz * s], [bx, bh + 0.02, bz], [ax, ah + 0.02, az], no, no, cs, cs);
      const m0 = T * 0.5, m1 = m0 + 0.05, cb = this.cBand;   // glowing mid band
      this.wq(bp, bc, this.bq++, [ax, ah + m0, az], [bx, bh + m0, bz], [bx, bh + m1, bz], [ax, ah + m1, az], cb, cb, cb, cb);
      const r = 0.05, ce = this.cEdge;
      this.wq(ep, ec, this.eq++, [ax + nx * r, ah + T, az + nz * r], [bx + nx * r, bh + T, bz + nz * r], [bx - nx * r, bh + T, bz - nz * r], [ax - nx * r, ah + T, az - nz * r], ce, ce, ce, ce);
      this.wq(ep, ec, this.eq++, [ax, ah + T - 0.12, az], [bx, bh + T - 0.12, bz], [bx, bh + T, bz], [ax, ah + T, az], ce, ce, ce, ce);
      this.wq(ep, ec, this.eq++, [ax, ah, az], [bx, bh, bz], [bx, bh + 0.05, bz], [ax, ah + 0.05, az], cb, cb, cb, cb);
    }
    post(x, z, h) {
      const T = this.TH, bp = this.bGeo.attributes.position, bc = this.bGeo.attributes.color, ep = this.eGeo.attributes.position, ec = this.eGeo.attributes.color;
      if (this.bq + 3 > this.bCap || this.eq + 3 > this.eCap) return;
      const r = 0.15, s = 0.4, ce = this.cEdge;
      this.wq(bp, bc, this.bq++, [x - r, h, z], [x + r, h, z], [x + r, h + T, z], [x - r, h + T, z], this.cBot, this.cBot, this.cTop, this.cTop);
      this.wq(bp, bc, this.bq++, [x, h, z - r], [x, h, z + r], [x, h + T, z + r], [x, h + T, z - r], this.cBot, this.cBot, this.cTop, this.cTop);
      this.wq(bp, bc, this.bq++, [x - s, h + 0.02, z - s], [x + s, h + 0.02, z - s], [x + s, h + 0.02, z + s], [x - s, h + 0.02, z + s], this.cSpill, this.cSpill, this.cSpill, this.cSpill);
      this.wq(ep, ec, this.eq++, [x - r, h + T, z - r], [x + r, h + T, z - r], [x + r, h + T, z + r], [x - r, h + T, z + r], ce, ce, ce, ce);
      this.wq(ep, ec, this.eq++, [x - r, h + T - 0.12, z], [x + r, h + T - 0.12, z], [x + r, h + T, z], [x - r, h + T, z], ce, ce, ce, ce);
      this.wq(ep, ec, this.eq++, [x, h + T - 0.12, z - r], [x, h + T - 0.12, z + r], [x, h + T, z + r], [x, h + T, z - r], ce, ce, ce, ce);
    }
    // sync with a rider's trail; attached = wall continues to the live position E
    update(r, alpha, ex, ez) {
      const tr = r.trail || [], n = tr.length, X = (p) => p[0] + 0.5, Z = (p) => p[1] + 0.5;
      const rev = r.trailRev | 0;
      if (n < this.built || rev !== this.rev) { this.reset(); this.rev = rev; }   // walls erased (shield / blast) -> rebuild
      const b0 = this.bq, e0 = this.eq;
      const runStart = (k) => k === 0 || tr[k][3];
      // point j contributes: segment (j-1,j) inside a run, or a post for a lone run start before it; never across brk
      const emit = (j, last, attached, pieces) => {
        if (j === 0) { if (last && !attached) this.post(X(tr[0]), Z(tr[0]), tr[0][2]); return; }
        if (!tr[j][3]) {
          const a = tr[j - 1], p = { ax: X(a), az: Z(a), ah: a[2], bx: X(tr[j]), bz: Z(tr[j]), bh: tr[j][2] };
          if (last && attached) { p.bx = ex; p.bz = ez; p.bh = lerp(a[2], tr[j][2], alpha); }
          if (pieces) pieces.push(p); else this.seg(p.ax, p.az, p.ah, p.bx, p.bz, p.bh);
        } else {
          if (runStart(j - 1)) this.post(X(tr[j - 1]), Z(tr[j - 1]), tr[j - 1][2]);
          if (last && !attached) this.post(X(tr[j]), Z(tr[j]), tr[j][2]);
        }
      };
      while (this.built <= n - 3) { emit(this.built, false, false, null); this.built++; }
      const cb = this.bq, ce = this.eq;
      if (n > 0) {
        const last = tr[n - 1], attached = r.alive && !r.air && last[0] === r.x && last[1] === r.y;
        const pieces = [];
        for (let j = Math.max(0, n - 2); j < n; j++) emit(j, j === n - 1, attached, pieces);
        if (attached) {   // the live wall ends at the bike's tail so the bike stays visible from behind
          let trim = 0.5;
          for (let k = pieces.length - 1; k >= 0 && trim > 0; k--) {
            const p = pieces[k], len = Math.hypot(p.bx - p.ax, p.bz - p.az);
            if (trim >= len) { pieces.splice(k, 1); trim -= len; } else { const f = (len - trim) / len; p.bx = p.ax + (p.bx - p.ax) * f; p.bz = p.az + (p.bz - p.az) * f; p.bh = p.ah + (p.bh - p.ah) * f; trim = 0; }
          }
        }
        for (const p of pieces) this.seg(p.ax, p.az, p.ah, p.bx, p.bz, p.bh);
      }
      const tb = this.bq, te = this.eq;
      this.bq = cb; this.eq = ce;      // tail is volatile, committed cursor stays
      this.bGeo.setDrawRange(0, tb * 6); this.eGeo.setDrawRange(0, te * 6);
      const up = (geo, from, to) => {
        for (const k of ['position', 'color']) {
          const a = geo.attributes[k];
          if (a.clearUpdateRanges) a.clearUpdateRanges();
          if (to > from) { a.addUpdateRange(from * 12, (to - from) * 12); a.needsUpdate = true; }
        }
      };
      up(this.bGeo, b0, tb); up(this.eGeo, e0, te);
    }
    dispose() { this.bGeo.dispose(); this.eGeo.dispose(); this.bMat.dispose(); this.eMat.dispose(); this.bMatM.dispose(); this.eMatM.dispose(); }
  }

  class NeonspurView {
    // Viewport rects, top-left origin, canvas px. 1 -> [full]; 2 -> [top, bottom];
    // 3 and 4 -> 2x2 row-major [TL, TR, BL, BR] (layout(3) returns 4 rects: the 4th is the overview).
    // 'overview' -> one full rect.
    static layout(n, layout, W, H) {
      W = W || 960; H = H || 600;
      if (layout === 'overview' || n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
      if (n === 2) return [{ x: 0, y: 0, w: W, h: H / 2 }, { x: 0, y: H / 2, w: W, h: H / 2 }];
      const w = W / 2, h = H / 2;
      return [{ x: 0, y: 0, w, h }, { x: w, y: 0, w, h }, { x: 0, y: h, w, h }, { x: w, y: h, w, h }];
    }

    constructor(THREE, { width = 960, height = 600, quality = 'high' } = {}) {
      const T = this.T = THREE;
      this.W = width; this.H = height;
      let renderer;
      try { renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
      catch (e) { throw new Error('WebGL nicht verfügbar: ' + e.message); }
      if (!renderer || !renderer.getContext()) throw new Error('WebGL nicht verfügbar');
      this.renderer = renderer;
      renderer.setPixelRatio(1); renderer.setSize(width, height, false);
      renderer.info.autoReset = false;
      this.canvas = renderer.domElement;
      this.scene = new T.Scene();
      this.scene.fog = new T.FogExp2(0x000000, 0.02);
      this.camera = new T.PerspectiveCamera(78, width / height, 0.05, 400);
      const C = (window.NeonspurSim && window.NeonspurSim.CONST) || {};
      this.TRAIL_H = C.TRAIL_H || 0.8; this.WALL_H = C.WALL_H || 3; this.JUMP_H = C.JUMP_H || 1.6;
      this.arena = new T.Group(); this.scene.add(this.arena);
      this.mirror = new T.Group(); this.scene.add(this.mirror);
      this.dyn = []; this.riders = {}; this.cams = {}; this.items = new Map(); this.itemKits = {};
      this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
      this.dot = dotTexture(T);
      this.lastNow = null; this.now = 0; this.map = null; this.drawCalls = 0;
      this.quality = quality === 'low' ? 'low' : 'high';
      this.bloom = null;
      this.initSky();
      this.initFx();
      this.setQuality(this.quality);
    }

    setQuality(q) {
      q = q === 'low' ? 'low' : 'high';
      this.quality = q;
      const hi = q === 'high';
      this.pf = hi ? 1 : 0.4;
      if (this.mirror) this.mirror.visible = hi;
      for (const R of Object.values(this.riders)) { R.wall.setMirror(hi); R.mirror.visible = hi; }
      if (this.floorMat) { this.floorMat.transparent = hi; this.floorMat.opacity = hi ? 0.74 : 1; this.floorMat.depthWrite = !hi; this.floorMat.needsUpdate = true; }
      if (this.skyMat) this.skyMat.uniforms.uNeb.value = hi ? 1 : 0;
      if (this.stars) this.stars.geometry.setDrawRange(0, hi ? this.starN : Math.round(this.starN * 0.4));
      if (!hi && this.bloom) this.disposeBloom();
    }

    // ---------- sky ----------
    initSky() {
      const T = this.T;
      const geo = new T.SphereGeometry(90, 28, 16);
      this.skyMat = new T.ShaderMaterial({
        vertexShader: SKY_VS, fragmentShader: SKY_FS, side: T.BackSide, depthWrite: false, depthTest: false, fog: false,
        uniforms: { uTop: { value: new T.Color() }, uMid: { value: new T.Color() }, uHor: { value: new T.Color() }, uNebA: { value: new T.Color() }, uNebB: { value: new T.Color() },
          uPlanet: { value: new T.Vector3(0.5, 0.3, -0.8) }, uTime: { value: 0 }, uNeb: { value: 1 } }
      });
      this.sky = new T.Mesh(geo, this.skyMat); this.sky.renderOrder = -100; this.sky.frustumCulled = false;
      this.scene.add(this.sky);
      // twinkling stars on a sphere (mostly the upper half), additive points
      const N = this.starN = 900, pos = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N), col = new Float32Array(N * 3);
      let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const tints = [[1, 1, 1], [0.7, 0.8, 1], [1, 0.75, 0.9], [0.75, 1, 0.95]];
      for (let i = 0; i < N; i++) {
        let y = rnd() * 2 - 1; if (rnd() < 0.45) y = Math.abs(y) * 0.95 + 0.05;
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(1 - y * y), R = 80;
        pos[i * 3] = Math.cos(a) * rr * R; pos[i * 3 + 1] = y * R; pos[i * 3 + 2] = Math.sin(a) * rr * R;
        const big = rnd() < 0.08; size[i] = big ? 4.5 + rnd() * 2 : 1.6 + rnd() * 1.8; ph[i] = rnd();
        const t = tints[Math.floor(rnd() * tints.length)], k = big ? 1 : 0.45 + rnd() * 0.5;
        col[i * 3] = t[0] * k; col[i * 3 + 1] = t[1] * k; col[i * 3 + 2] = t[2] * k;
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aSize', new T.BufferAttribute(size, 1));
      g.setAttribute('aPh', new T.BufferAttribute(ph, 1)); g.setAttribute('aCol', new T.BufferAttribute(col, 3));
      this.starMat = new T.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, blending: T.AdditiveBlending, depthWrite: false, depthTest: true, fog: false,
        uniforms: { uTime: { value: 0 }, uPx: { value: 1 } } });
      this.stars = new T.Points(g, this.starMat); this.stars.renderOrder = -99; this.stars.frustumCulled = false;
      this.scene.add(this.stars);
    }

    // ---------- bloom (render targets + shader passes, core three only) ----------
    ensureBloom() {
      if (this.bloom) return this.bloom;
      const T = this.T, rd = this.renderer, W = this.W, H = this.H;
      const half = rd.extensions.has('EXT_color_buffer_float') || rd.extensions.has('EXT_color_buffer_half_float');
      const type = half ? T.HalfFloatType : T.UnsignedByteType;
      const mk = (w, h, main) => new T.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), { type, format: T.RGBAFormat, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: !!main, samples: main ? 4 : 0, generateMipmaps: false });
      const B = this.bloom = { main: mk(W, H, true), h1: mk(W / 2, H / 2), h2: mk(W / 2, H / 2), q1: mk(W / 4, H / 4), q2: mk(W / 4, H / 4) };
      const sm = (fs, uniforms) => new T.ShaderMaterial({ vertexShader: FS_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
      const tex = (t) => ({ value: t });
      B.bright = sm(BRIGHT_FS, { tMap: tex(null), uTexel: { value: new T.Vector2(1 / W, 1 / H) }, uThr: { value: 0.62 } });
      B.blur = sm(BLUR_FS, { tMap: tex(null), uStep: { value: new T.Vector2() } });
      B.comp = sm(COMP_FS, { tMain: tex(B.main.texture), tB1: tex(B.h1.texture), tB2: tex(B.q2.texture), uS1: { value: 0.7 }, uS2: { value: 0.9 } });
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
      B.geo = g; B.mesh = new T.Mesh(g, B.bright); B.mesh.frustumCulled = false;
      B.scene = new T.Scene(); B.scene.add(B.mesh); B.cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      return B;
    }
    disposeBloom() {
      const B = this.bloom; if (!B) return;
      for (const k of ['main', 'h1', 'h2', 'q1', 'q2']) B[k].dispose();
      B.bright.dispose(); B.blur.dispose(); B.comp.dispose(); B.geo.dispose();
      this.bloom = null;
    }
    pass(mat, target) { const B = this.bloom; B.mesh.material = mat; this.renderer.setRenderTarget(target); this.renderer.render(B.scene, B.cam); }
    blurPass(src, dst, dx, dy, w, h) { const B = this.bloom; B.blur.uniforms.tMap.value = src.texture; B.blur.uniforms.uStep.value.set(dx / w, dy / h); this.pass(B.blur, dst); }
    bloomPass() {
      const B = this.bloom, W = this.W, H = this.H, rd = this.renderer;
      rd.setScissorTest(false);
      B.bright.uniforms.tMap.value = B.main.texture; this.pass(B.bright, B.h1);
      this.blurPass(B.h1, B.h2, 1, 0, W / 2, H / 2); this.blurPass(B.h2, B.h1, 0, 1, W / 2, H / 2);
      this.blurPass(B.h1, B.q1, 1, 0, W / 4, H / 4); this.blurPass(B.q1, B.q2, 0, 1, W / 4, H / 4);
      this.blurPass(B.q2, B.q1, 1.6, 0, W / 4, H / 4); this.blurPass(B.q1, B.q2, 0, 1.6, W / 4, H / 4);
      rd.setRenderTarget(null); rd.setScissorTest(false); rd.setViewport(0, 0, W, H);
      B.mesh.material = B.comp; rd.render(B.scene, B.cam);
    }

    // ---------- effects pools ----------
    initFx() {
      const T = this.T, add = (o) => { this.scene.add(o); return o; };
      const ringGeo = new T.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
      const colGeo = new T.CylinderGeometry(1, 1, 1, 14, 1, true).translate(0, 0.5, 0);
      const sphGeo = new T.IcosahedronGeometry(1, 2);
      const coneGeo = new T.ConeGeometry(1, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);   // base at z 0, apex +z (backwards of the bike)
      this.shieldFillGeo = new T.IcosahedronGeometry(0.78, 2); this.shieldWireGeo = new T.IcosahedronGeometry(0.8, 1);
      this.beamGeo = (() => {
        const g = new T.CylinderGeometry(1, 1, 10, 10, 1, true).translate(0, 5, 0), p = g.attributes.position, c = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) { const k = Math.pow(1 - p.getY(i) / 10, 1.8); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k; }
        g.setAttribute('color', new T.BufferAttribute(c, 3)); return g;
      })();
      this.fxGeos = [ringGeo, colGeo, sphGeo, coneGeo, this.shieldFillGeo, this.shieldWireGeo, this.beamGeo];
      this.ringGeo = ringGeo; this.coneGeo = coneGeo;
      const mat = () => new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false });
      this.rings = []; this.cols = []; this.spheres = [];
      for (let i = 0; i < 14; i++) { const m = add(new T.Mesh(ringGeo, mat())); m.visible = false; m.renderOrder = 8; m.frustumCulled = false; this.rings.push({ m, on: false, age: 0, dur: 1, s0: 1, s1: 2, op: 1 }); }
      for (let i = 0; i < 6; i++) { const m = add(new T.Mesh(colGeo, mat())); m.visible = false; m.renderOrder = 8; m.frustumCulled = false; this.cols.push({ m, on: false, age: 0, dur: 1, r0: 1, r1: 1, h0: 1, h1: 1, op: 1 }); }
      for (let i = 0; i < 4; i++) { const m = add(new T.Mesh(sphGeo, Object.assign(mat(), { side: T.FrontSide }))); m.visible = false; m.renderOrder = 8; m.frustumCulled = false; this.spheres.push({ m, on: false, age: 0, dur: 1, s0: 1, s1: 2, op: 1 }); }
      // particles
      const N = this.PN = 420;
      this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3);
      this.pBase = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pMax = new Float32Array(N).fill(1); this.pNext = 0;
      for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -1000;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(this.pPos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('color', new T.BufferAttribute(this.pCol, 3).setUsage(T.DynamicDrawUsage));
      this.pGeo = g;
      this.pMat = new T.PointsMaterial({ size: 0.16, vertexColors: true, map: this.dot, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false });
      this.points = add(new T.Points(g, this.pMat)); this.points.frustumCulled = false; this.points.renderOrder = 9;
      // speed lines (camera space, only drawn in views of a boosting rider)
      const SN = this.slN = 36, sp = new Float32Array(SN * 6), sc = new Float32Array(SN * 6);
      this.slSeed = Array.from({ length: SN }, (_, i) => ({ a: ((i * 0.618034) % 1) * Math.PI * 2, r: 1.0 + ((i * 0.37) % 1) * 2.4, p: (i * 0.2718) % 1, l: 0.9 + ((i * 0.53) % 1) * 1.6, v: 0.7 + ((i * 0.31) % 1) * 0.8 }));
      const sg = new T.BufferGeometry();
      sg.setAttribute('position', new T.BufferAttribute(sp, 3).setUsage(T.DynamicDrawUsage)); sg.setAttribute('color', new T.BufferAttribute(sc, 3).setUsage(T.DynamicDrawUsage));
      this.slGeo = sg;
      this.slMat = new T.LineBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
      this.speedLines = add(new T.LineSegments(sg, this.slMat)); this.speedLines.visible = false; this.speedLines.frustumCulled = false; this.speedLines.renderOrder = 20;
    }
    fxRing(x, y, z, color, dur, s0, s1, op) {
      let f = this.rings.find((r) => !r.on) || this.rings.reduce((a, b) => (a.age / a.dur > b.age / b.dur ? a : b));
      f.on = true; f.age = 0; f.dur = dur; f.s0 = s0; f.s1 = s1; f.op = op; f.m.visible = true; f.m.position.set(x, y + 0.03, z); f.m.material.color.copy(color);
    }
    fxCol(x, y, z, color, dur, r0, r1, h0, h1, op) {
      let f = this.cols.find((r) => !r.on) || this.cols.reduce((a, b) => (a.age / a.dur > b.age / b.dur ? a : b));
      f.on = true; f.age = 0; f.dur = dur; f.r0 = r0; f.r1 = r1; f.h0 = h0; f.h1 = h1; f.op = op; f.m.visible = true; f.m.position.set(x, y, z); f.m.material.color.copy(color);
    }
    fxSphere(x, y, z, color, dur, s0, s1, op) {
      let f = this.spheres.find((r) => !r.on) || this.spheres.reduce((a, b) => (a.age / a.dur > b.age / b.dur ? a : b));
      f.on = true; f.age = 0; f.dur = dur; f.s0 = s0; f.s1 = s1; f.op = op; f.m.visible = true; f.m.position.set(x, y, z); f.m.material.color.copy(color);
    }
    fxSpark(x, y, z, vx, vy, vz, c, life) {
      const i = this.pNext; this.pNext = (this.pNext + 1) % this.PN;
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
      this.pBase[i * 3] = c.r; this.pBase[i * 3 + 1] = c.g; this.pBase[i * 3 + 2] = c.b;
      this.pLife[i] = this.pMax[i] = life; this.pDirty = true;
    }
    fxBurst(x, y, z, color, n, speed, life) {
      const w = new this.T.Color('#ffffff'); n = Math.max(1, Math.round(n * this.pf));
      for (let k = 0; k < n; k++) {
        const i = this.pNext; this.pNext = (this.pNext + 1) % this.PN;
        const a = Math.random() * Math.PI * 2, up = 0.3 + Math.random() * 0.9, s = speed * (0.35 + Math.random() * 0.8);
        this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
        this.pVel[i * 3] = Math.cos(a) * s; this.pVel[i * 3 + 1] = up * speed * 0.8; this.pVel[i * 3 + 2] = Math.sin(a) * s;
        const c = k % 4 === 0 ? color.clone().lerp(w, 0.7) : color;
        this.pBase[i * 3] = c.r * 1.4; this.pBase[i * 3 + 1] = c.g * 1.4; this.pBase[i * 3 + 2] = c.b * 1.4;
        this.pLife[i] = this.pMax[i] = life * (0.6 + Math.random() * 0.6);
      }
      this.pDirty = true;
    }
    updateFx(dt) {
      for (const f of this.rings) if (f.on) {
        f.age += dt; const t = f.age / f.dur;
        if (t >= 1) { f.on = false; f.m.visible = false; continue; }
        const e = 1 - Math.pow(1 - t, 3), s = lerp(f.s0, f.s1, e);
        f.m.scale.set(s, 1, s); f.m.material.opacity = f.op * Math.pow(1 - t, 1.4);
      }
      for (const f of this.cols) if (f.on) {
        f.age += dt; const t = f.age / f.dur;
        if (t >= 1) { f.on = false; f.m.visible = false; continue; }
        f.m.scale.set(lerp(f.r0, f.r1, t), lerp(f.h0, f.h1, t), lerp(f.r0, f.r1, t)); f.m.material.opacity = f.op * Math.pow(1 - t, 1.6);
      }
      for (const f of this.spheres) if (f.on) {
        f.age += dt; const t = f.age / f.dur;
        if (t >= 1) { f.on = false; f.m.visible = false; continue; }
        const s = lerp(f.s0, f.s1, 1 - Math.pow(1 - t, 3)); f.m.scale.setScalar(s); f.m.material.opacity = f.op * Math.pow(1 - t, 1.8);
      }
      if (!this.pDirty) return;
      let any = false;
      for (let i = 0; i < this.PN; i++) {
        if (this.pLife[i] <= 0) continue;
        this.pLife[i] -= dt; const k = i * 3;
        if (this.pLife[i] <= 0) { this.pPos[k + 1] = -1000; this.pCol[k] = this.pCol[k + 1] = this.pCol[k + 2] = 0; continue; }
        any = true;
        this.pVel[k + 1] -= 7 * dt;
        this.pPos[k] += this.pVel[k] * dt; this.pPos[k + 1] += this.pVel[k + 1] * dt; this.pPos[k + 2] += this.pVel[k + 2] * dt;
        if (this.pPos[k + 1] < 0.04) { this.pPos[k + 1] = 0.04; this.pVel[k + 1] *= -0.35; this.pVel[k] *= 0.7; this.pVel[k + 2] *= 0.7; }
        const f = Math.min(1, this.pLife[i] / this.pMax[i] * 1.6);
        this.pCol[k] = this.pBase[k] * f; this.pCol[k + 1] = this.pBase[k + 1] * f; this.pCol[k + 2] = this.pBase[k + 2] * f;
      }
      this.pGeo.attributes.position.needsUpdate = true; this.pGeo.attributes.color.needsUpdate = true;
      this.pDirty = any;
    }

    // ---------- items ----------
    itemKit(kind) {
      let K = this.itemKits[kind]; if (K) return K;
      const T = this.T, color = new T.Color(ITEM_COL[kind] || '#ffffff');
      const add = (o) => new T.MeshBasicMaterial(Object.assign({ transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }, o));
      K = this.itemKits[kind] = {
        color, geo: buildItemGeo(T, kind, color),
        mat: new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, fog: false, color: 0xcccccc }),
        wire: add({ color, wireframe: true, opacity: 0.6 }),
        beam: add({ color, vertexColors: true, opacity: 0.85 }), halo: add({ color, vertexColors: true, opacity: 0.12 }),
        disc: add({ color: color.clone().multiplyScalar(1.3), map: this.dot, opacity: 0.9 })
      };
      return K;
    }
    addItem(it, now) {
      const T = this.T, kind = ITEM_COL[it.kind] ? it.kind : 'boost', K = this.itemKit(kind);
      const g = new T.Group(), icon = new T.Group();
      const solid = new T.Mesh(K.geo, K.mat), wire = new T.Mesh(K.geo, K.wire); wire.scale.setScalar(1.25); solid.frustumCulled = wire.frustumCulled = false;
      icon.add(solid, wire);
      const beam = new T.Mesh(this.beamGeo, K.beam), halo = new T.Mesh(this.beamGeo, K.halo); beam.scale.set(0.06, 1, 0.06); halo.scale.set(0.3, 1, 0.3);
      const disc = new T.Mesh(this.ringGeo, K.disc); disc.scale.setScalar(0.55); disc.position.y = 0.04;
      const pool = new T.Mesh(new T.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2), K.disc.clone()); pool.material.opacity = 0.5; pool.material.map = this.dot; pool.position.y = 0.035;
      for (const m of [beam, halo, disc, pool]) { m.frustumCulled = false; m.renderOrder = 6; }
      g.add(beam, halo, disc, pool, icon);
      g.position.set(it.x + 0.5, it.h || 0, it.y + 0.5);
      this.scene.add(g);
      const o = { id: it.id, kind, g, icon, beam, halo, disc, pool, h: it.h || 0, x: it.x, y: it.y, t0: now, ph: (it.id || 0) * 1.7 };
      this.items.set(it.id, o);
      return o;
    }
    removeItem(id) {
      const o = this.items.get(id); if (!o) return;
      this.scene.remove(o.g); o.pool.geometry.dispose(); o.pool.material.dispose(); this.items.delete(id);
    }
    syncItems(state, now) {
      const list = state.items || [], seen = new Set();
      for (const it of list) { seen.add(it.id); if (!this.items.has(it.id)) this.addItem(it, now); }
      for (const id of Array.from(this.items.keys())) if (!seen.has(id)) this.removeItem(id);
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.007);
      for (const K of Object.values(this.itemKits)) { K.wire.opacity = 0.4 + 0.4 * pulse; K.beam.opacity = 0.65 + 0.3 * pulse; K.halo.opacity = 0.08 + 0.07 * pulse; }
      for (const o of this.items.values()) {
        const age = (now - o.t0) / 1000, k = clamp(age / 0.55, 0, 1), pop = k >= 1 ? 1 : 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);   // ease out back
        const s = Math.max(0.001, pop) * (1 + 0.06 * Math.sin(now * 0.008 + o.ph));
        o.icon.position.y = 0.78 + Math.sin(now * 0.0032 + o.ph) * 0.12; o.icon.rotation.y = now * 0.0017 + o.ph; o.icon.scale.setScalar(s);
        o.halo.visible = o.pool.visible = o.icon.children[1].visible = this.quality === 'high';   // low: only icon, beam and disc
        o.beam.scale.y = o.halo.scale.y = Math.max(0.001, pop); o.disc.rotation.y = -now * 0.002;
        const ds = (0.5 + 0.1 * Math.sin(now * 0.007 + o.ph)) * Math.max(0.001, pop); o.disc.scale.set(ds, 1, ds);
      }
    }

    // ---------- round setup ----------
    clearArena() {
      for (const o of this.dyn) { if (o.dispose) o.dispose(); }
      this.dyn = [];
      while (this.arena.children.length) this.arena.remove(this.arena.children[0]);
      while (this.mirror.children.length) this.mirror.remove(this.mirror.children[0]);
      for (const R of Object.values(this.riders)) {
        this.scene.remove(R.group); this.scene.remove(R.glow); this.scene.remove(R.mirror);
        for (const m of R.wall.meshes()) this.scene.remove(m);
        R.wall.dispose(); R.geo.dispose(); R.mat.dispose(); R.mmat.dispose(); R.gmat.dispose();
        for (const m of R.extraMats) m.dispose();
      }
      for (const id of Array.from(this.items.keys())) this.removeItem(id);
      this.riders = {}; this.cams = {};
    }

    setRound(state, look) {
      const T = this.T, map = state.map; this.map = map; look = look || {};
      this.clearArena();
      for (const f of this.rings) { f.on = false; f.m.visible = false; }
      for (const f of this.cols) { f.on = false; f.m.visible = false; }
      for (const f of this.spheres) { f.on = false; f.m.visible = false; }
      this.pLife.fill(0); for (let i = 0; i < this.PN; i++) { this.pPos[i * 3 + 1] = -1000; this.pCol[i * 3] = this.pCol[i * 3 + 1] = this.pCol[i * 3 + 2] = 0; }
      this.pDirty = true;
      this.lastNow = null;
      const th = map.theme || {};
      const cl = (k, d) => new T.Color(th[k] || d);
      const cFloor = cl('floor', '#05060f'), cGrid = cl('grid', '#1b2a6b'), cWall = cl('wall', '#0b0f24'), cEdge = cl('edge', '#3d6bff'), cRaised = cl('raised', '#0a1030'), cSky = cl('sky', '#020208');
      // sky tinted by the arena theme
      const vio = new T.Color('#8a3cff'), mag = new T.Color('#ff3ca8'), cya = new T.Color('#18c8ff'), su = this.skyMat.uniforms;
      su.uTop.value.copy(cSky).lerp(vio, 0.1).multiplyScalar(1.0);
      su.uMid.value.copy(cSky).lerp(cEdge, 0.25).lerp(vio, 0.2).multiplyScalar(0.55);
      su.uHor.value.copy(cEdge).lerp(vio, 0.5).multiplyScalar(0.34);
      su.uNebA.value.copy(vio).lerp(cEdge, 0.3).multiplyScalar(0.12);
      su.uNebB.value.copy(mag).lerp(cya, 0.35).lerp(cEdge, 0.2).multiplyScalar(0.085);
      this.scene.background = null;
      this.scene.fog.color.copy(cSky).lerp(su.uMid.value, 0.6).multiplyScalar(0.4);
      this.mapColors = { sky: cSky };
      const { w, h } = map, WH = this.WALL_H, white = new T.Color('#ffffff');
      const isWall = (x, y) => x >= 0 && y >= 0 && x < w && y < h && map.wall[y * w + x] === 1;
      const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
      const hex = (c) => '#' + c.getHexString();
      const track = (o) => { this.dyn.push(o); return o; };
      const hi = this.quality === 'high';

      // floor: dark, slightly transparent in high quality so the mirrored walls shine through
      const tFloor = track(gridTexture(T, th.floor || '#05060f', hex(cGrid.clone().multiplyScalar(0.9)), hex(cGrid.clone().lerp(cEdge, 0.8).lerp(white, 0.2)), this.aniso));
      tFloor.repeat.set(w / 4, h / 4);
      const fg = track(new T.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(w / 2, 0, h / 2));
      const fm = this.floorMat = track(new T.MeshBasicMaterial({ map: tFloor, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, transparent: hi, opacity: hi ? 0.74 : 1, depthWrite: !hi }));
      const floor = new T.Mesh(fg, fm); floor.renderOrder = 1; this.arena.add(floor);

      // static geometry builders
      const slab = new MB(), walls = new MB(), glow = new MB();
      const cSlabEdge = col3(cEdge.clone().lerp(white, 0.4), 1.2), cEdgeC = col3(cEdge.clone().lerp(white, 0.1), 1.05), cEdgeDim = col3(cEdge, 0.6);
      const WHITE = [1, 1, 1];
      const sideA = (d, x, y) => (d === 0 ? [[x + 1, y], [x + 1, y + 1]] : d === 1 ? [[x, y + 1], [x + 1, y + 1]] : d === 2 ? [[x, y], [x, y + 1]] : [[x, y], [x + 1, y]]);
      const flat = (A, B, ix, iz, wd, y, c) => glow.q4([[A[0], y, A[1]], [B[0], y, B[1]], [B[0] + ix * wd, y, B[1] + iz * wd], [A[0] + ix * wd, y, A[1] + iz * wd]], c);
      const pillar = (cx, cz, y0, y1, c, hw) => {
        glow.q4([[cx - hw, y0, cz], [cx + hw, y0, cz], [cx + hw, y1, cz], [cx - hw, y1, cz]], c);
        glow.q4([[cx, y0, cz - hw], [cx, y0, cz + hw], [cx, y1, cz + hw], [cx, y1, cz - hw]], c);
      };
      const cPanel = col3(cEdge, 0.32), wallTop = col3(cWall.clone().lerp(cEdge, 0.12), 1), wallLo = col3(cWall, 0.9), wallHi = col3(cWall.clone().lerp(cEdge, 0.16), 1);
      const wallFace = (A, B, ix, iz) => {   // vertical wall face over edge A-B, ix/iz = direction towards the solid
        walls.q4([[A[0], 0, A[1]], [B[0], 0, B[1]], [B[0], WH, B[1]], [A[0], WH, A[1]]], [wallLo, wallLo, wallHi, wallHi]);
        flat(A, B, ix, iz, 0.11, WH + 0.006, cEdgeC);
        flat(A, B, -ix, -iz, 0.07, 0.012, cEdgeDim);
        for (const yy of [1, 2]) {   // faint panel lines along the face
          const t = 0.025, ex = -ix * 0.006, ez = -iz * 0.006;
          glow.q4([[A[0] + ex, yy - t, A[1] + ez], [B[0] + ex, yy - t, B[1] + ez], [B[0] + ex, yy + t, B[1] + ez], [A[0] + ex, yy + t, A[1] + ez]], cPanel);
        }
        const e = 0.012;   // thin bright line right under the top rim
        glow.q4([[A[0] - ix * e, WH - 0.13, A[1] - iz * e], [B[0] - ix * e, WH - 0.13, B[1] - iz * e], [B[0] - ix * e, WH, B[1] - iz * e], [A[0] - ix * e, WH, A[1] - iz * e]], cEdgeC);
      };
      const slabSide = (A, B, ix, iz, hi_, lo) => {
        const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
        slab.q4([[A[0], lo, A[1]], [B[0], lo, B[1]], [B[0], hi_, B[1]], [A[0], hi_, A[1]]],
          [[0.45, 0.45, 0.45], [0.45, 0.45, 0.45], [0.95, 0.95, 0.95], [0.95, 0.95, 0.95]],
          [[(A[0] + A[1]) / 4, lo / 4], [(A[0] + A[1] + len) / 4, lo / 4], [(A[0] + A[1] + len) / 4, hi_ / 4], [(A[0] + A[1]) / 4, hi_ / 4]]);
        flat(A, B, ix, iz, 0.1, hi_ + 0.006, cSlabEdge);
      };
      const topQuad = (x, y, z) => slab.q4([[x, z, y], [x + 1, z, y], [x + 1, z, y + 1], [x, z, y + 1]], WHITE, [[x / 4, y / 4], [(x + 1) / 4, y / 4], [(x + 1) / 4, (y + 1) / 4], [x / 4, (y + 1) / 4]]);
      const padCells = [];

      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (map.wall[i]) {
          walls.q4([[x, WH, y], [x + 1, WH, y], [x + 1, WH, y + 1], [x, WH, y + 1]], wallTop);
          for (let d = 0; d < 4; d++) {
            const nx = x + DX[d], ny = y + DY[d];
            if (inb(nx, ny) && !isWall(nx, ny)) { const s = sideA(d, x, y); wallFace(s[0], s[1], -DX[d], -DY[d]); }
          }
          continue;
        }
        // arena rim where the map has no wall block on its edge
        for (let d = 0; d < 4; d++) if (!inb(x + DX[d], y + DY[d])) { const s = sideA(d, x, y); wallFace(s[0], s[1], -DX[d], -DY[d]); }
        const f = map.floor[i];
        if (f >= 0.99) {
          topQuad(x, y, 1);
          for (let d = 0; d < 4; d++) {
            const nx = x + DX[d], ny = y + DY[d];
            if (!inb(nx, ny) || isWall(nx, ny)) continue;
            const nf = map.floor[ny * w + nx], nr = map.rampDir[ny * w + nx];
            if (nf >= 0.99) continue;
            if (nf > 0.4 && nf < 0.6 && nr === (d + 2) % 4) continue;   // ramp rising into this terrace
            const s = sideA(d, x, y); slabSide(s[0], s[1], -DX[d], -DY[d], 1, 0);
          }
        } else if (f > 0.4) {
          // ramp wedge rising towards rampDir
          const rd = map.rampDir[i] >= 0 ? map.rampDir[i] : 0, dx = DX[rd], dz = DY[rd], px = -dz, pz = dx, cx = x + 0.5, cz = y + 0.5;
          const P = (u, v, hh) => [cx + dx * (u - 0.5) + px * v, hh, cz + dz * (u - 0.5) + pz * v];
          const uv = (p) => [p[0] / 4, p[2] / 4];
          const A = P(0, 0.5, 0), B = P(0, -0.5, 0), C = P(1, -0.5, 1), D = P(1, 0.5, 1);
          slab.q4([A, B, C, D], [[1.0, 1.0, 1.0], [1.0, 1.0, 1.0], [1.0, 1.0, 1.0], [1.0, 1.0, 1.0]], [uv(A), uv(B), uv(C), uv(D)]);
          const side = (a, b) => {
            const lo = [b[0], 0, b[2]], dc = [0.55, 0.55, 0.55];
            slab.v(a[0], a[1], a[2], dc, a[0] / 4, a[2] / 4); slab.v(b[0], b[1], b[2], dc, b[0] / 4, b[2] / 4); slab.v(lo[0], lo[1], lo[2], dc, lo[0] / 4, lo[2] / 4);
            const n = slab.p.length / 3; slab.tri(n - 3, n - 2, n - 1);
          };
          side(A, D); side(B, C);
          // glowing slanted rims + chevrons
          const lift = (p, e) => [p[0], p[1] + e, p[2]];
          for (const s of [1, -1]) {
            const a = P(0, 0.5 * s, 0), b = P(1, 0.5 * s, 1), a2 = P(0, 0.4 * s, 0), b2 = P(1, 0.4 * s, 1);
            glow.q4([lift(a, 0.012), lift(b, 0.012), lift(b2, 0.012), lift(a2, 0.012)], cSlabEdge);
          }
          const hiC = col3(cEdge.clone().lerp(white, 0.55), 1.5);
          for (const u0 of [0.12, 0.52]) {
            for (const s of [1, -1]) {
              const t = 0.1, p0 = P(u0, 0.32 * s, u0), p1 = P(u0 + 0.3, 0, u0 + 0.3), p2 = P(u0 + 0.3 - t, 0, u0 + 0.3 - t), p3 = P(u0 - t, 0.32 * s, u0 - t);
              glow.q4([lift(p0, 0.014), lift(p1, 0.014), lift(p2, 0.014), lift(p3, 0.014)], hiC);
            }
          }
        }
        if (map.pad[i]) padCells.push([x, y, f >= 0.99 ? 1 : 0]);
      }
      // vertical rim pillars at true wall corners (convex/concave/diagonal) so long walls stay calm
      for (let cy = 0; cy <= h; cy++) for (let cx = 0; cx <= w; cx++) {
        const a = isWall(cx - 1, cy - 1), b = isWall(cx, cy - 1), c = isWall(cx - 1, cy), d = isWall(cx, cy);
        const n = a + b + c + d;
        if (n === 0 || n === 4 || (n === 2 && ((a && b) || (c && d) || (a && c) || (b && d)))) continue;
        pillar(cx, cy, 0, WH, cEdgeC, 0.045);
      }

      const tRaised = track(gridTexture(T, hex(cRaised.clone().multiplyScalar(1.5)), hex(cGrid.clone().lerp(cEdge, 0.35)), hex(cEdge.clone().lerp(white, 0.15)), this.aniso));
      const mesh = (mb, mat, parent) => { if (mb.empty) return null; const g = track(mb.geo(this.T)); const m = new T.Mesh(g, mat); m.frustumCulled = false; (parent || this.arena).add(m); return m; };
      mesh(slab, track(new T.MeshBasicMaterial({ map: tRaised, vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
      mesh(walls, track(new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
      const glowMesh = mesh(glow, track(new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
      if (glowMesh) {   // mirrored neon rims, seen through the glossy floor
        const mm = new T.Mesh(glowMesh.geometry, track(new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide })));
        mm.material.color.setScalar(1.5); mm.scale.y = -1; mm.frustumCulled = false; mm.renderOrder = 0; this.mirror.add(mm);
      }

      // jump pads: pulsing discs + rings (two shared materials)
      const padC = cEdge.clone().lerp(new T.Color('#46ffd0'), 0.55).lerp(white, 0.15);
      const disc = new MB(), ring = new MB(), pc = col3(padC, 1.7);
      for (const [x, y, f] of padCells) {
        const cx = x + 0.5, cz = y + 0.5, yy = f + 0.02, N = 24;
        const c0 = disc.v(cx, yy, cz, col3(padC, 1.3));
        for (let k = 0; k < N; k++) disc.v(cx + Math.cos(k / N * 6.2832) * 0.34, yy, cz + Math.sin(k / N * 6.2832) * 0.34, col3(padC, 0.4));
        for (let k = 0; k < N; k++) disc.tri(c0, c0 + 1 + k, c0 + 1 + (k + 1) % N);
        const r0 = ring.p.length / 3;
        for (let k = 0; k < N; k++) {
          const a = k / N * 6.2832, ca = Math.cos(a), sa = Math.sin(a);
          ring.v(cx + ca * 0.38, yy + 0.004, cz + sa * 0.38, pc); ring.v(cx + ca * 0.46, yy + 0.004, cz + sa * 0.46, pc);
        }
        for (let k = 0; k < N; k++) { const a = r0 + k * 2, b = r0 + ((k + 1) % N) * 2; ring.quad(a, a + 1, b + 1, b); }
      }
      const padMat = (op) => track(new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }));
      this.padDiscMat = padMat(0.6); this.padRingMat = padMat(1);
      const m1 = mesh(disc, this.padDiscMat), m2 = mesh(ring, this.padRingMat);
      if (m1) m1.renderOrder = 3; if (m2) m2.renderOrder = 3;
      this.pads = padCells; this.padColor = padC;

      // riders
      const mkAdd = (o) => new T.MeshBasicMaterial(Object.assign({ transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }, o));
      for (const r of state.riders) {
        const lk = look[r.pid] || {}, color = new T.Color(lk.color || '#ffffff');
        const geo = buildBikeGeo(T, color), mat = new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide });
        mat.color.setScalar(1.4);   // stripes and canopy glow in the bloom pass
        const group = new T.Group(); const bm = new T.Mesh(geo, mat); bm.scale.setScalar(1.3); group.add(bm); bm.frustumCulled = false;
        const gmat = new T.MeshBasicMaterial({ map: this.dot, color, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false, fog: false });
        const glowM = new T.Mesh(new T.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), gmat); glowM.frustumCulled = false; glowM.renderOrder = 2;
        // Turbo flame (two cones pointing backwards) and shield bubble, both children of the bike
        const hot = color.clone().lerp(white, 0.5).multiplyScalar(1.5), fl = new T.Group(); fl.position.set(0, 0.25, 0.5); fl.visible = false;
        const fmO = mkAdd({ color: color.clone().multiplyScalar(1.3), opacity: 0.7 }), fmI = mkAdd({ color: white.clone().multiplyScalar(1.4), opacity: 0.95 });
        const fo = new T.Mesh(this.coneGeo, fmO), fi = new T.Mesh(this.coneGeo, fmI); fo.frustumCulled = fi.frustumCulled = false; fo.renderOrder = fi.renderOrder = 7; fl.add(fo, fi); group.add(fl);
        const sh = new T.Group(); sh.position.y = 0.35; sh.visible = false;
        const smF = mkAdd({ color: color.clone().lerp(new T.Color('#4de1ff'), 0.6).multiplyScalar(0.5), opacity: 0.07 }), smW = mkAdd({ color: hot.clone().lerp(new T.Color('#4de1ff'), 0.5).multiplyScalar(0.7), opacity: 0.4, wireframe: true });
        const shF = new T.Mesh(this.shieldFillGeo, smF), shW = new T.Mesh(this.shieldWireGeo, smW); shF.renderOrder = shW.renderOrder = 7; shF.frustumCulled = shW.frustumCulled = false; sh.add(shF, shW); group.add(sh);
        // mirror image of the bike for the glossy floor
        const mmat = new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }); mmat.color.setScalar(2.0);
        const mirror = new T.Group(); mirror.scale.y = -1; const mb = new T.Mesh(geo, mmat); mb.scale.setScalar(1.3); mb.frustumCulled = false; mirror.add(mb);
        const wall = new LightWall(T, w, h, color, this.TRAIL_H);
        wall.setMirror(hi); mirror.visible = hi;
        this.scene.add(group, glowM, mirror);
        for (const m of wall.meshes()) this.scene.add(m);
        this.riders[r.pid] = { pid: r.pid, color, geo, mat, mmat, gmat, group, glow: glowM, mirror, wall, fl, fo, fi, sh, shW, extraMats: [fmO, fmI, smF, smW],
          yaw: YAW[r.dir] || 0, pitch: 0, snap: true, bx: 0, by: 0, bz: 0, aS: 0, bk: 0, em: 0, gr: 0, wasBoost: false };
        this.dyn.push(glowM.geometry);
      }
      this.setQuality(this.quality);
    }

    // ---------- events ----------
    event(ev, state) {
      if (!this.map || !ev) return;
      const T = this.T, R = this.riders[ev.pid], color = R ? R.color : new T.Color('#ffffff');
      const r = state && state.riders ? state.riders.find((q) => q.pid === ev.pid) : null;
      if (ev.t === 'crash') {
        const x = (ev.x != null ? ev.x : r ? r.x : 0) + 0.5, z = (ev.y != null ? ev.y : r ? r.y : 0) + 0.5, y = ev.alt != null ? ev.alt : r ? r.alt : 0;
        this.fxBurst(x, y + 0.3, z, color, 46, 5.2, 1.1);
        this.fxRing(x, y, z, color, 0.9, 0.4, 4.2, 1);
        this.fxRing(x, y, z, new T.Color('#ffffff'), 0.45, 0.2, 2.0, 0.8);
        this.fxCol(x, y, z, color, 0.7, 0.5, 0.25, 0.6, 3.2, 0.7);
      } else if (ev.t === 'jump' && r) {
        const x = (ev.pad ? r.x : r.px) + 0.5, z = (ev.pad ? r.y : r.py) + 0.5, y = ev.pad ? r.palt : r.palt;
        if (ev.pad) {
          this.fxRing(x, y, z, this.padColor, 0.6, 0.3, 1.8, 1);
          this.fxCol(x, y, z, this.padColor, 0.5, 0.42, 0.3, 0.3, 3.0, 0.8);
          this.fxBurst(x, y + 0.1, z, this.padColor, 14, 2.4, 0.6);
        } else {
          this.fxRing(x, y, z, color, 0.35, 0.25, 1.3, 0.9);
          this.fxCol(x, y, z, color, 0.3, 0.3, 0.12, 0.2, 1.5, 0.7);
          this.fxBurst(x, y + 0.1, z, color, 8, 1.8, 0.5);
        }
      } else if (ev.t === 'land' && r) {
        this.fxRing(r.x + 0.5, r.alt, r.y + 0.5, color, 0.45, 0.3, 1.8, 0.9);
        this.fxBurst(r.x + 0.5, r.alt + 0.05, r.y + 0.5, color, 8, 1.8, 0.5);
      } else if (ev.t === 'drop' && r) {
        this.fxRing(r.x + 0.5, r.alt, r.y + 0.5, color, 0.4, 0.3, 1.5, 0.7);
      } else if (ev.t === 'boost' && r) {
        const x = r.x + 0.5, z = r.y + 0.5, y = r.alt;
        if (ev.on) { this.fxRing(x, y, z, color, 0.4, 0.3, 2.0, 0.9); this.fxBurst(x, y + 0.3, z, color.clone().lerp(new T.Color('#ffffff'), 0.4), 14, 3.2, 0.5); }
      } else if (ev.t === 'itemSpawn') {
        const kc = new T.Color(ITEM_COL[ev.kind] || '#ffffff'), x = ev.x + 0.5, z = ev.y + 0.5, y = ev.h || 0;
        this.fxRing(x, y, z, kc, 0.6, 0.2, 1.7, 0.9); this.fxCol(x, y, z, kc, 0.5, 0.35, 0.2, 0.2, 5, 0.6); this.fxBurst(x, y + 0.6, z, kc, 12, 1.8, 0.7);
        if (!this.items.has(ev.id)) this.addItem({ id: ev.id, kind: ev.kind, x: ev.x, y: ev.y, h: ev.h }, this.now);
      } else if (ev.t === 'item') {
        const kc = new T.Color(ITEM_COL[ev.kind] || '#ffffff'), o = this.items.get(ev.id), x = ev.x + 0.5, z = ev.y + 0.5, y = o ? o.h : r ? r.alt : 0;
        this.fxBurst(x, y + 0.7, z, kc, 36, 4.2, 0.9); this.fxRing(x, y, z, kc, 0.55, 0.3, 3.0, 1); this.fxRing(x, y + 0.7, z, new T.Color('#ffffff'), 0.3, 0.1, 1.4, 0.8);
        this.fxCol(x, y, z, kc, 0.5, 0.4, 0.15, 0.4, 5, 0.8);
        if (o) this.removeItem(ev.id);
      } else if (ev.t === 'shield') {
        const sc = new T.Color('#4de1ff'), x = ev.x + 0.5, z = ev.y + 0.5, y = r ? r.alt : 0;
        this.fxSphere(x, y + 0.4, z, sc, 0.5, 0.8, 2.4, 0.3); this.fxRing(x, y, z, sc, 0.5, 0.3, 2.6, 1); this.fxBurst(x, y + 0.4, z, sc.clone().lerp(new T.Color('#ffffff'), 0.4), 24, 6.5, 0.8);
        this.fxCol(x, y, z, sc, 0.4, 0.5, 0.2, 0.4, 2.4, 0.6);
      } else if (ev.t === 'blast') {
        const bc = new T.Color(ITEM_COL.blast), x = ev.x + 0.5, z = ev.y + 0.5, y = r ? r.alt : 0, rr = (ev.r != null ? ev.r : 3) + 0.5;
        this.fxRing(x, y, z, bc, 0.75, 0.5, rr * 1.15, 1); this.fxRing(x, y, z, new T.Color('#ffffff'), 0.45, 0.3, rr * 0.95, 0.9);
        this.fxSphere(x, y + 0.2, z, bc, 0.5, 0.4, rr, 0.4); this.fxCol(x, y, z, bc, 0.6, rr * 0.4, rr, 2.4, 0.4, 0.5);
        this.fxBurst(x, y + 0.4, z, bc, 44, 7.5, 1.0);
      }
    }

    // ---------- per-frame rider poses ----------
    cellFloor(x, y) {
      const m = this.map, cx = Math.floor(x), cy = Math.floor(y);
      if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h || m.wall[cy * m.w + cx]) return 0;
      return m.floor[cy * m.w + cx];
    }
    updateRiders(state, alpha, dt, now) {
      const T = this.T, wcol = new T.Color('#ffd9a0');
      for (const r of state.riders) {
        const R = this.riders[r.pid]; if (!R) continue;
        // per-rider progress within the current move (subticks); falls back to the global alpha
        let a = (r.mp > 0 && r.ms != null) ? Math.min(1, (r.ms + alpha) / r.mp) : alpha;
        if (!r.alive) a = 1;
        if (R.snap) R.aS = a; else if (a < R.aS - 0.3) R.aS = a; else R.aS = Math.max(R.aS, a);   // new move -> wrap; tiny backwards steps are ignored
        a = R.aS;
        const wx = lerp(r.px, r.x, a) + 0.5, wz = lerp(r.py, r.y, a) + 0.5, alt = lerp(r.palt, r.alt, a);
        R.bx = wx; R.by = alt; R.bz = wz;
        const ty = YAW[r.dir] != null ? YAW[r.dir] : R.yaw;
        const tp = clamp(Math.atan2(r.alt - r.palt, 1.0), -0.45, 0.45) * (r.alive ? 1 : 0);
        if (R.snap) { R.yaw = ty; R.pitch = tp; R.snap = false; }
        else { R.yaw += wrapPi(ty - R.yaw) * damp(22, dt); R.pitch += (tp - R.pitch) * damp(9, dt); }
        R.group.visible = R.glow.visible = !!r.alive;
        R.mirror.visible = !!r.alive && this.quality === 'high';
        R.group.position.set(wx, alt, wz);
        R.group.rotation.set(R.pitch, R.yaw, 0, 'YXZ');
        R.mirror.position.set(wx, -alt, wz); R.mirror.rotation.set(-R.pitch, R.yaw, 0, 'YXZ');
        R.glow.position.set(wx, (r.air ? this.cellFloor(wx, wz) : alt) + 0.03, wz);
        R.wall.update(r, a, wx, wz);
        const fx = -Math.sin(R.yaw), fz = -Math.cos(R.yaw);
        // Turbo: flame, wider glow, exhaust sparks
        const boosting = !!(r.boosting && r.alive);
        R.bk += ((boosting ? 1 : 0) - R.bk) * damp(12, dt);
        if (R.bk > 0.04) {
          const f1 = 0.85 + 0.25 * Math.sin(now * 0.045 + r.pid * 3) + 0.15 * Math.sin(now * 0.113 + r.pid);
          R.fl.visible = true; R.fo.scale.set(0.12 * R.bk, 0.12 * R.bk, 1.5 * f1 * R.bk); R.fi.scale.set(0.06 * R.bk, 0.06 * R.bk, 0.9 * f1 * R.bk);
        } else R.fl.visible = false;
        R.gmat.opacity = 0.8 + 0.2 * R.bk; R.glow.scale.setScalar(1 + 0.5 * R.bk);
        if (boosting) {
          R.em += dt * 90 * this.pf;
          while (R.em >= 1) {
            R.em -= 1; const sp = 2.5 + Math.random() * 3.5, j = () => (Math.random() - 0.5) * 1.2;
            this.fxSpark(wx - fx * 0.55, alt + 0.28, wz - fz * 0.55, -fx * sp + j(), 0.3 + Math.random() * 0.8, -fz * sp + j(), R.color.clone().lerp(wcol, Math.random() * 0.6).multiplyScalar(1.5), 0.25 + Math.random() * 0.2);
          }
        }
        // grind sparks on the sides touching a wall (1 = left, 2 = right of the heading)
        if (r.grind && r.alive && !r.air) {
          R.gr += dt * 70 * this.pf;
          while (R.gr >= 1) {
            R.gr -= 1;
            for (const [bit, side] of [[1, (r.dir + 3) % 4], [2, (r.dir + 1) % 4]]) {
              if (!(r.grind & bit)) continue;
              const sp = 1.5 + Math.random() * 3;
              this.fxSpark(wx + DX[side] * 0.42, alt + 0.1, wz + DY[side] * 0.42, -fx * sp + DX[side] * (0.3 + Math.random()), 1.2 + Math.random() * 2.4, -fz * sp + DY[side] * (0.3 + Math.random()), wcol.clone().lerp(R.color, Math.random() * 0.4).multiplyScalar(1.8), 0.2 + Math.random() * 0.25);
            }
          }
        }
        // shield bubble
        R.sh.visible = !!(r.shield && r.alive);
        if (R.sh.visible) { R.sh.scale.setScalar(1 + 0.05 * Math.sin(now * 0.009 + r.pid)); R.shW.rotation.y = now * 0.0007; R.shW.rotation.x = now * 0.0004; }
      }
    }

    // ---------- cameras ----------
    setCamera(cam, R, r, pid, dt, aspect, now) {
      const c = this.camera;
      let cs = this.cams[pid];
      if (!cs) cs = this.cams[pid] = { init: false, px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, pitch: 0, kick: 0 };
      cs.kick += ((r.boosting && r.alive ? 10 : 0) - cs.kick) * damp(5, dt);   // FOV kick while boosting
      const fx = -Math.sin(R.yaw), fz = -Math.cos(R.yaw), m = this.map;
      c.aspect = aspect;
      if (cam === 'chase') {
        c.fov = 70 + cs.kick; c.updateProjectionMatrix();
        const sx = -fz * 0.55, sz = fx * 0.55, dp = [R.bx - fx * 2.6 + sx, R.by + 2.0, R.bz - fz * 2.6 + sz], dl = [R.bx + fx * 3, R.by, R.bz + fz * 3];
        dp[0] = clamp(dp[0], 0.35, m.w - 0.35); dp[2] = clamp(dp[2], 0.35, m.h - 0.35);
        if (!cs.init) { [cs.px, cs.py, cs.pz] = dp; [cs.lx, cs.ly, cs.lz] = dl; cs.init = true; }
        else {
          const kp = damp(11, dt), kl = damp(14, dt);
          cs.px += (dp[0] - cs.px) * kp; cs.py += (dp[1] - cs.py) * kp; cs.pz += (dp[2] - cs.pz) * kp;
          cs.lx += (dl[0] - cs.lx) * kl; cs.ly += (dl[1] - cs.ly) * kl; cs.lz += (dl[2] - cs.lz) * kl;
        }
        // pull the camera in front of wall blocks between it and the bike
        const ex = R.bx, ey = R.by + 0.5, ez = R.bz;
        let t = 1;
        for (let s = 0.1; s <= 1.0001; s += 0.05) {
          const qx = ex + (cs.px - ex) * s, qy = ey + (cs.py - ey) * s, qz = ez + (cs.pz - ez) * s;
          const gx = Math.floor(qx), gz = Math.floor(qz);
          if (gx >= 0 && gz >= 0 && gx < m.w && gz < m.h && m.wall[gz * m.w + gx] && qy < this.WALL_H + 0.1) { t = Math.max(0.15, s - 0.12); break; }
        }
        c.position.set(ex + (cs.px - ex) * t, ey + (cs.py - ey) * t, ez + (cs.pz - ez) * t); c.lookAt(cs.lx, cs.ly, cs.lz);
      } else {
        c.fov = 78 + cs.kick; c.updateProjectionMatrix();
        cs.init = false;
        cs.pitch += (R.pitch * 0.6 - cs.pitch) * damp(6, dt);
        c.position.set(R.bx + fx * 0.22, R.by + 0.55, R.bz + fz * 0.22);
        c.lookAt(c.position.x + fx * 6, c.position.y + Math.tan(cs.pitch) * 6 - 0.15, c.position.z + fz * 6);
      }
      this.speedK = clamp(cs.kick / 8, 0, 1);
      if (this.speedK > 0.05) this.updateSpeedLines(now);
    }
    setOverview(aspect) {
      const c = this.camera, m = this.map, vf = 42, hv = Math.tan(vf * Math.PI / 360), el = 64 * Math.PI / 180;
      c.fov = vf; c.aspect = aspect; c.updateProjectionMatrix();
      const dv = (m.h * Math.sin(el) * 0.5 + this.WALL_H * Math.cos(el) + 1.2) / hv;
      const dh = (m.w * 0.5 * 1.08) / (hv * aspect);
      const d = Math.max(dv, dh);
      c.position.set(m.w / 2, d * Math.sin(el), m.h / 2 + d * Math.cos(el));
      c.lookAt(m.w / 2, 0, m.h / 2 + 0.5);
      this.speedK = 0;
    }
    // streaks in front of the camera (built in camera space, written in world space)
    updateSpeedLines(now) {
      const c = this.camera, k = this.speedK, P = this.slGeo.attributes.position.array, C = this.slGeo.attributes.color.array, e = c.matrixWorld;
      c.updateMatrixWorld(true);
      const v = new this.T.Vector3();
      for (let i = 0; i < this.slN; i++) {
        const s = this.slSeed[i], t = ((s.p + now * 0.0011 * s.v) % 1 + 1) % 1, z = -(0.8 + t * 6.5), x = Math.cos(s.a) * s.r * (0.6 + t * 0.9), y = Math.sin(s.a) * s.r * (0.6 + t * 0.9) * 0.7;
        v.set(x, y, z).applyMatrix4(e); P[i * 6] = v.x; P[i * 6 + 1] = v.y; P[i * 6 + 2] = v.z;
        v.set(x, y, z - s.l * (0.5 + t)).applyMatrix4(e); P[i * 6 + 3] = v.x; P[i * 6 + 4] = v.y; P[i * 6 + 5] = v.z;
        const f = Math.sin(t * Math.PI) * 0.55 * k;
        C[i * 6] = f * 0.6; C[i * 6 + 1] = f * 0.75; C[i * 6 + 2] = f; C[i * 6 + 3] = C[i * 6 + 4] = C[i * 6 + 5] = 0;
      }
      this.slGeo.attributes.position.needsUpdate = true; this.slGeo.attributes.color.needsUpdate = true;
    }

    // ---------- render ----------
    render(state, alpha, opts) {
      if (!this.map) return;
      opts = opts || {};
      const now = opts.now != null ? opts.now : this.now + 16.7;
      const dt = this.lastNow == null ? 0.016 : clamp((now - this.lastNow) / 1000, 0, 0.1);
      this.lastNow = now; this.now = now;
      alpha = clamp(alpha || 0, 0, 1);
      const rd = this.renderer, info = rd.info, hi = this.quality === 'high';
      info.reset();
      this.updateRiders(state, alpha, dt, now);
      this.syncItems(state, now);
      this.updateFx(dt);
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006), slow = 0.5 + 0.5 * Math.sin(now * 0.0021);
      if (this.padDiscMat) { this.padDiscMat.opacity = 0.35 + 0.5 * pulse; this.padRingMat.opacity = 0.65 + 0.35 * pulse; }
      if (this.floorMat) this.floorMat.color.setScalar(0.88 + 0.22 * slow);
      for (const R of Object.values(this.riders)) R.wall.bMat.color.setScalar(0.85 + 0.2 * slow);
      this.skyMat.uniforms.uTime.value = now / 1000; this.starMat.uniforms.uTime.value = now / 1000;
      this.points.visible = true;

      const views = opts.layout === 'overview' ? [] : (opts.views || []);
      const rects = NeonspurView.layout(views.length, opts.layout === 'overview' ? 'overview' : 'split', this.W, this.H);
      if (hi) this.ensureBloom();
      rd.setRenderTarget(hi ? this.bloom.main : null);
      rd.setScissorTest(false);
      rd.setViewport(0, 0, this.W, this.H);
      rd.setClearColor(0x000000, 1); rd.clear();
      rd.setScissorTest(true);
      const g = rects.length > 1 ? 2 : 0;
      for (let i = 0; i < rects.length; i++) {
        const rc = rects[i], vw = views[i];
        const x = rc.x + g / 2, y = this.H - (rc.y + rc.h) + g / 2, w = rc.w - g, h = rc.h - g;
        rd.setViewport(x, y, w, h); rd.setScissor(x, y, w, h);
        const R = vw ? this.riders[vw.pid] : null, r = vw ? state.riders.find((q) => q.pid === vw.pid) : null;
        let hide = false;
        if (R && r) {
          this.scene.fog.density = 0.022;
          this.setCamera(vw.cam, R, r, vw.pid, dt, w / h, now);
          hide = vw.cam !== 'chase';
          if (hide) { R.group.visible = false; R.glow.visible = false; R.mirror.visible = false; }
        } else {
          this.scene.fog.density = 0.0035;
          this.setOverview(w / h);
        }
        this.sky.position.copy(this.camera.position); this.stars.position.copy(this.camera.position);
        this.starMat.uniforms.uPx.value = h / 600;
        this.speedLines.visible = this.speedK > 0.05;
        rd.render(this.scene, this.camera);
        if (hide) { R.group.visible = R.glow.visible = !!r.alive; R.mirror.visible = hi && !!r.alive; }
      }
      this.speedLines.visible = false;
      rd.setScissorTest(false);
      if (hi) this.bloomPass(); else rd.setRenderTarget(null);
      this.drawCalls = info.render.calls;
    }

    dispose() {
      this.clearArena();
      this.disposeBloom();
      for (const f of this.rings) f.m.material.dispose();
      for (const f of this.cols) f.m.material.dispose();
      for (const f of this.spheres) f.m.material.dispose();
      for (const gm of this.fxGeos) gm.dispose();
      for (const K of Object.values(this.itemKits)) { K.geo.dispose(); K.mat.dispose(); K.wire.dispose(); K.beam.dispose(); K.halo.dispose(); K.disc.dispose(); }
      this.sky.geometry.dispose(); this.skyMat.dispose(); this.stars.geometry.dispose(); this.starMat.dispose(); this.slGeo.dispose(); this.slMat.dispose();
      this.pGeo.dispose(); this.pMat.dispose(); this.dot.dispose();
      this.renderer.dispose();
      if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
    }
  }

  window.NeonspurView = NeonspurView;
})();
