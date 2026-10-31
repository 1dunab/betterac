// ===== Skyfarers fx — the living layer: fire, rain, lightning, waterfalls, fauna, inhabitants =====
// The view (render.js) creates `new SkyfarersFx(THREE, { scene, camera, quality, view })` and calls
// event / update / setQuality / dispose.  Everything is pooled: two point-sprite particle systems (additive +
// soft alpha), one rain LineSegments, one fog InstancedMesh, one jellyfish and one bird InstancedMesh and
// up to PEOPLE skinned inhabitants.  Draw calls: high <= 2+1+1+1+1+20 (+3 harpoons in flight), low <= 14.
// Docs: docs/SKYFARERS.md ("Fx API", "Implementation notes").
(function () {
  'use strict';

  // ---------------------------------------------------------------- budgets (one constant each, tuned on device)
  const BUDGET = {
    high: { particles: 4200, rain: 1100, jelly: [16, 14, 12], birds: [15, 15], people: 20, banks: 8, density: 1.0 },
    low:  { particles: 1100, rain: 420,  jelly: [8, 7],        birds: [7, 7],   people: 8,  banks: 4, density: 0.42 }
  };
  const SHIP_Y = 6;                 // cruise altitude (render.js)
  const DOME_R = 22.5;              // shield dome radius (render.js)

  const TAU = Math.PI * 2, rnd = Math.random;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), lerp = (a, b, t) => a + (b - a) * t;
  const rr = (a, b) => a + (b - a) * rnd();
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---------------------------------------------------------------- palette (linear, HDR values glow with bloom)
  const K = { LANTERN: 37, JELLY_P: 38, JELLY_B: 39, FLAME_HOT: 0, FLAME: 1, FLAME_END: 2, EMBER: 3, SMOKE_D: 4, SMOKE_M: 5, SMOKE_L: 6, WHITE: 7, WATER: 8, WATER_HI: 9, BOLT: 10, BOLT_GLOW: 11, SPARK: 12,
    DUST: 13, WOOD: 14, CRYSTAL: 15, STEAM: 16, MIST: 17, WOOD_L: 18, LEAF: 19, CONF: 20, DOMESPARK: 26, SCORCH: 27, FW: 28, GOLD: 33, WARN: 34, BUCKET: 35, STONE: 36 };
  const PAL = [
    [3.2, 1.7, 0.5], [2.4, 0.75, 0.12], [0.8, 0.12, 0.03], [3.0, 1.5, 0.35], [0.10, 0.09, 0.09], [0.30, 0.28, 0.27], [0.72, 0.72, 0.74], [1, 1, 1],
    [0.25, 0.58, 1.0], [1.8, 2.4, 2.8], [3.0, 3.2, 4.6], [0.45, 0.65, 2.4], [3.2, 2.6, 1.2], [0.52, 0.45, 0.36], [0.55, 0.34, 0.15], [0.35, 1.7, 2.1],
    [0.92, 0.94, 0.97], [0.82, 0.9, 1.0], [0.9, 0.55, 0.15], [0.3, 0.85, 0.25],
    [2.6, 0.4, 0.5], [0.4, 1.4, 2.6], [2.6, 2.2, 0.4], [0.5, 2.2, 0.7], [2.2, 0.5, 2.4], [2.6, 1.2, 0.3],      // 20..25 confetti
    [0.6, 1.5, 2.2], [0.15, 0.12, 0.1], [1.4, 0.9, 2.6], [2.8, 1.0, 1.8], [0.4, 2.6, 2.2], [2.6, 2.6, 1.0],      // 26..31 (28..31 fireworks)
    [0.5, 0.5, 0.5], [3.0, 2.2, 0.6], [1.6, 2.6, 4.0], [0.28, 0.5, 0.8], [0.34, 0.31, 0.28],                      // 32.., GOLD 33, WARN 34, BUCKET 35, STONE 36
    [2.6, 1.5, 0.5], [1.8, 0.4, 1.1], [0.3, 1.0, 2.0]                                                              // 37 lantern, 38/39 jelly halo (pink / blue)
  ];

  // ---------------------------------------------------------------- shaders
  const PT_VS = `
    uniform float uPx, uMax; attribute vec4 aCol; attribute float aSize; varying vec4 vCol;
    void main() {
      vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = min(aSize * uPx / max(-mv.z, 0.5), uMax);
      if (aSize <= 0.0) gl_Position = vec4(3.0, 3.0, 3.0, 1.0);
    }`;
  const PT_FS_ADD = `
    varying vec4 vCol;
    void main() {
      vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c); if (r2 > 1.0) discard;
      float a = exp(-r2 * 2.8) * (1.0 - r2 * r2);
      gl_FragColor = vec4(vCol.rgb, vCol.a * a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const PT_FS_SOFT = `
    varying vec4 vCol;
    void main() {
      vec2 c = gl_PointCoord * 2.0 - 1.0; float r = length(c); if (r > 1.0) discard;
      float ang = atan(c.y, c.x);
      r += 0.1 * sin(ang * 3.0 + vCol.a * 40.0) + 0.06 * sin(ang * 5.0 - vCol.r * 30.0);
      float a = smoothstep(1.0, 0.15, r);
      gl_FragColor = vec4(vCol.rgb, vCol.a * a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const RAIN_VS = `
    uniform float uTime, uI; uniform vec3 uC, uSize, uWind; uniform float uLen, uSpd;
    attribute vec4 aR; attribute float aEnd; varying float vA;
    void main() {
      float sp = uSpd * (0.85 + 0.3 * aR.w);
      float f = fract(aR.y - uTime * sp / uSize.y);
      vec3 p = vec3(uC.x + (aR.x - 0.5) * uSize.x, uC.y + f * uSize.y, uC.z + (aR.z - 0.5) * uSize.z);
      p.xz += uWind.xz * (f - 0.5) * uSize.y * 0.12;
      vec3 dir = normalize(vec3(uWind.x * 0.12, -1.0, uWind.z * 0.12));
      p -= dir * uLen * aEnd;
      vA = (1.0 - 0.8 * aEnd) * smoothstep(0.0, 0.06, f) * (1.0 - 0.8 * smoothstep(0.45, 0.95, f)) * step(aR.w, uI);
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`;
  const RAIN_FS = `
    uniform vec3 uCol; varying float vA;
    void main() {
      if (vA < 0.01) discard;
      gl_FragColor = vec4(uCol, vA * 0.2);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const FOG_VS = `
    attribute float aSeed; varying vec2 vUv; varying float vS;
    void main() { vUv = uv; vS = aSeed; mat4 im = mat4(1.0);
      #ifdef USE_INSTANCING
      im = instanceMatrix;
      #endif
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * im * vec4(position, 1.0); }`;
  const FOG_FS = `
    uniform vec3 uCol; uniform float uA; varying vec2 vUv; varying float vS;
    void main() {
      vec2 c = vUv * 2.0 - 1.0; float d = length(c);
      d += 0.2 * sin(c.x * 3.1 + vS * 9.0) * sin(c.y * 2.7 + vS * 5.0) + 0.1 * sin(c.x * 7.0 - c.y * 5.0 + vS * 3.0);
      float a = smoothstep(1.0, 0.1, d) * uA;
      gl_FragColor = vec4(uCol, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const JELLY_VS = `
    uniform float uTime; attribute vec2 aPart; attribute vec2 aInst; varying vec2 vP; varying float vH; varying float vY;
    void main() {
      float ph = aInst.x, pulse = sin(uTime * 2.2 + ph); vec3 p = position; vY = position.y;
      if (aPart.x < 0.5) { p.xz *= 1.0 + 0.16 * pulse; p.y *= 1.0 - 0.14 * pulse; }
      else { float k = aPart.y; p.xz *= 1.0 + 0.16 * pulse * (1.0 - k); p.y *= 1.0 + 0.1 * pulse;
        p.x += sin(uTime * 2.0 + ph - k * 4.0) * 0.14 * k; p.z += cos(uTime * 1.7 + ph - k * 4.0) * 0.14 * k; }
      mat4 im = mat4(1.0);
      #ifdef USE_INSTANCING
      im = instanceMatrix;
      #endif
      vP = aPart; vH = aInst.y;
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * im * vec4(p, 1.0);
    }`;
  const JELLY_FS = `
    uniform float uNight, uLite; varying vec2 vP; varying float vH; varying float vY;
    void main() {
      vec3 base = mix(vec3(0.95, 0.22, 0.6), vec3(0.12, 0.62, 1.0), vH);
      float bell = vP.x < 0.5 ? 1.0 : 0.0;
      vec3 col = base * (0.5 + 0.25 * clamp(vY * 2.0, 0.0, 1.0) * bell + 0.3 * (1.0 - bell)) * (0.75 * uLite + 0.25) ;
      col *= 1.0 + uNight * 1.1;
      float a = bell > 0.5 ? 0.72 : 0.55 * (1.0 - vP.y * 0.65);
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const BIRD_VS = `
    uniform float uTime; attribute float aW; attribute float aPh; varying float vS;
    void main() {
      vec3 p = position; p.y += aW * sin(uTime * 11.0 + aPh) * 0.32; vS = aW;
      mat4 im = mat4(1.0);
      #ifdef USE_INSTANCING
      im = instanceMatrix;
      #endif
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * im * vec4(p, 1.0);
    }`;
  const BIRD_FS = `
    uniform vec3 uCol; varying float vS;
    void main() { gl_FragColor = vec4(uCol * (1.0 - 0.25 * abs(vS)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  // ---------------------------------------------------------------- particle system (CPU sim, one Points draw)
  class PSys {
    constructor(T, n, additive, renderOrder, uni) {
      this.n = n; this.i = 0; this.hw = 0; this.alive = 0; this.soft = !additive; this.lite = 1;
      this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
      this.vel = new Float32Array(n * 3); this.age = new Float32Array(n); this.life = new Float32Array(n);
      this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.c0 = new Float32Array(n * 4); this.c1 = new Float32Array(n * 4);
      this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.wk = new Float32Array(n);
      const g = this.geo = new T.BufferGeometry();
      this.aPos = new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage); this.aCol = new T.BufferAttribute(this.col, 4).setUsage(T.DynamicDrawUsage);
      this.aSize = new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage);
      g.setAttribute('position', this.aPos); g.setAttribute('aCol', this.aCol); g.setAttribute('aSize', this.aSize);
      this.mat = new T.ShaderMaterial({ vertexShader: PT_VS, fragmentShader: additive ? PT_FS_ADD : PT_FS_SOFT, uniforms: uni, transparent: true, depthWrite: false,
        blending: additive ? T.AdditiveBlending : T.NormalBlending, fog: false });
      this.mesh = new T.Points(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder; this.mesh.visible = false;
    }
    spawn(x, y, z, vx, vy, vz, life, s0, s1, ci0, a0, ci1, a1, drag, grav, wk) {
      const k = this.i; this.i = k + 1 >= this.n ? 0 : k + 1; if (k + 1 > this.hw) this.hw = k + 1;
      const p = k * 3, c = k * 4, A = PAL[ci0], B = PAL[ci1], L = this.soft ? this.lite : 1;
      this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z; this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
      this.age[k] = 0; this.life[k] = life > 0.01 ? life : 0.01; this.s0[k] = s0; this.s1[k] = s1; this.size[k] = s0;
      this.c0[c] = A[0] * L; this.c0[c + 1] = A[1] * L; this.c0[c + 2] = A[2] * L; this.c0[c + 3] = a0;
      this.c1[c] = B[0] * L; this.c1[c + 1] = B[1] * L; this.c1[c + 2] = B[2] * L; this.c1[c + 3] = a1;
      this.col[c] = this.c0[c]; this.col[c + 1] = this.c0[c + 1]; this.col[c + 2] = this.c0[c + 2]; this.col[c + 3] = a0;
      this.drag[k] = drag || 0; this.grav[k] = grav || 0; this.wk[k] = wk || 0;
    }
    step(dt, wx, wz) {
      const { pos, vel, age, life, size, col, s0, s1, c0, c1, drag, grav, wk } = this, soft = this.soft;
      let alive = 0;
      for (let k = 0, hw = this.hw; k < hw; k++) {
        const L = life[k]; if (L <= 0) continue;
        const a = age[k] + dt;
        if (a >= L) { life[k] = 0; size[k] = 0; continue; }
        age[k] = a; alive++;
        const u = a / L, p = k * 3, c = k * 4, d = drag[k], w = wk[k];
        if (d > 0) { const f = Math.max(0, 1 - d * dt); vel[p] *= f; vel[p + 1] *= f; vel[p + 2] *= f; }
        vel[p + 1] -= grav[k] * dt;
        pos[p] += (vel[p] + wx * w) * dt; pos[p + 1] += vel[p + 1] * dt; pos[p + 2] += (vel[p + 2] + wz * w) * dt;
        size[k] = s0[k] + (s1[k] - s0[k]) * u;
        col[c] = c0[c] + (c1[c] - c0[c]) * u; col[c + 1] = c0[c + 1] + (c1[c + 1] - c0[c + 1]) * u; col[c + 2] = c0[c + 2] + (c1[c + 2] - c0[c + 2]) * u;
        let al = c0[c + 3] + (c1[c + 3] - c0[c + 3]) * u; if (soft && u < 0.14) al *= u / 0.14; col[c + 3] = al;
      }
      this.alive = alive; this.mesh.visible = alive > 0;
      this.geo.setDrawRange(0, this.hw);
      this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
    }
    dispose() { this.geo.dispose(); this.mat.dispose(); if (this.mesh.parent) this.mesh.parent.remove(this.mesh); }
  }

  // ---------------------------------------------------------------- the fx class
  class SkyfarersFx {
    constructor(THREE, opts) {
      const T = this.T = THREE; this.scene = opts.scene; this.camera = opts.camera; this.view = opts.view;
      this.quality = opts.quality === 'low' ? 'low' : 'high';
      this.group = new T.Group(); this.group.name = 'fx'; this.scene.add(this.group);
      this.eulJ = new T.Euler(); this.eulB = new T.Euler(); this.v1 = new T.Vector3(); this.v2 = new T.Vector3(); this.v3 = new T.Vector3(); this.v4 = new T.Vector3();
      this.m4 = new T.Matrix4(); this.q4 = new T.Quaternion(); this.sc = new T.Vector3(); this.up = new T.Vector3(0, 1, 0);
      this.now = 0; this.t = 0; this.dt = 0.016; this.night = 0; this.ov = 0; this.lite = 1;
      this.wx = 0; this.wz = 0; this.rainI = 0; this.fogI = 0.4;
      this.isl = null; this.acc = new Float32Array(512);
      this.slotW = new Float32Array(7 * 3);
      this.sinkT0 = null; this.pend = [];                // delayed scripted bits {at, fn}
      this.pxU = { uPx: { value: 1000 }, uMax: { value: 256 } };
      try { const gl = this.view.renderer.getContext(), r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE); this.pxU.uMax.value = Math.min(r[1] || 64, 400); } catch (e) { /* default */ }
      this.build();
    }

    // ----- construction of everything quality dependent
    build() {
      const T = this.T, B = BUDGET[this.quality], hi = this.quality === 'high';
      this.B = B; this.dn = B.density;
      this.S = new PSys(T, Math.round(B.particles * 0.55), false, 11, this.pxU);       // soft alpha (smoke, dust, steam, water)
      this.A = new PSys(T, Math.round(B.particles * 0.45), true, 12, this.pxU);        // additive (fire, sparks, bolts, glow)
      this.group.add(this.S.mesh, this.A.mesh);
      this.initRain(B); this.initFog(B); this.initJelly(B); this.initBirds(B);
      this.movers = []; for (let i = 0; i < 40; i++) this.movers.push({ live: false, type: 0, t0: 0, dur: 1, sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, arc: 0, c: 0, tk: 0, tid: 0, hit: 0, extra: 0, ox: 0, oz: 0 });
      this.moverN = this.movers.length;
      this.harp = []; const art = window.SkyfarersArt;
      if (art && art.harpoon) for (let i = 0; i < 3; i++) { try { const m = art.harpoon(T); m.scale.setScalar(2.2); m.visible = false; this.group.add(m); this.harp.push(m); } catch (e) { /* optional */ } }
      this.warns = []; for (let i = 0; i < 6; i++) this.warns.push({ live: false, id: -1, x: 0, z: 0, y: 0, t0: 0 });
      this.bolts = []; for (let i = 0; i < 6; i++) this.bolts.push({ live: false, n: 0, pts: new Float32Array(3 * 40), t0: 0, w: 1, again: false, br: 0 });
      this.jets = []; for (let i = 0; i < 10; i++) this.jets.push({ live: false, pid: 0, slot: 0, until: 0 });
      this.dFire = new Map();                                // dragon id -> {until, slot, absorbed}
      this.gustFx = []; for (let i = 0; i < 4; i++) this.gustFx.push({ live: false, pid: 0, until: 0 });
      this.nextAmbient = 3; this.cheerUntil = 0; this.cheerSlot = -1; this.panicUntil = 0; this.dockWave = 0;
      this.people = []; this.pCount = 0; this.pCarry = { walk: 0, carry: 0, cheer: 0, panic: 0 };
      this.scan = 0; this.fires = []; this.sites = []; this.nWork = 0; this.sinkDone = false;
      if (this.isl) this.setIsland(this.isl);
    }

    destroy() {
      for (const p of [this.S, this.A]) if (p) p.dispose();
      for (const o of [this.rain, this.fogMesh, this.jelly, this.birdMesh]) if (o) { o.geometry.dispose(); o.material.dispose(); if (o.parent) o.parent.remove(o); if (o.dispose) o.dispose(); }
      if (this.harp) for (const m of this.harp) { if (m.parent) m.parent.remove(m); }
      this.disposePeople();
      this.S = this.A = this.rain = this.fogMesh = this.jelly = this.birdMesh = null;
    }
    disposePeople() {
      if (!this.people) return;
      for (const p of this.people) { if (p.art.group.parent) p.art.group.parent.remove(p.art.group); if (p.art.mesh && p.art.mesh.skeleton) p.art.mesh.skeleton.dispose(); }
      this.people = [];
    }

    initRain(B) {
      const T = this.T, n = B.rain, g = new T.BufferGeometry();
      const pos = new Float32Array(n * 2 * 3), aR = new Float32Array(n * 2 * 4), aE = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const x = rnd(), y = rnd(), z = rnd(), w = i / n;           // w orders the streaks, so uI thins them out evenly
        for (let e = 0; e < 2; e++) { const v = i * 2 + e; aR.set([x, y, z, w], v * 4); aE[v] = e; }
      }
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aR', new T.BufferAttribute(aR, 4)); g.setAttribute('aEnd', new T.BufferAttribute(aE, 1));
      this.rainU = { uTime: { value: 0 }, uI: { value: 0 }, uC: { value: new T.Vector3(0, -6, 0) }, uSize: { value: new T.Vector3(210, 44, 140) }, uWind: { value: new T.Vector3() },
        uLen: { value: 2.2 }, uSpd: { value: 38 }, uCol: { value: new T.Color(0.7, 0.8, 1.0) } };
      const mat = new T.ShaderMaterial({ vertexShader: RAIN_VS, fragmentShader: RAIN_FS, uniforms: this.rainU, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false });
      this.rain = new T.LineSegments(g, mat); this.rain.frustumCulled = false; this.rain.renderOrder = 13; this.rain.visible = false;
      this.group.add(this.rain);
    }

    initFog(B) {
      const T = this.T, n = B.banks, g = new T.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
      this.fogU = { uCol: { value: new T.Color(1, 1, 1) }, uA: { value: 0.2 } };
      const mat = new T.ShaderMaterial({ vertexShader: FOG_VS, fragmentShader: FOG_FS, uniforms: this.fogU, transparent: true, depthWrite: false, fog: false });
      const m = this.fogMesh = new T.InstancedMesh(g, mat, n); m.frustumCulled = false; m.renderOrder = 4;
      const seed = new Float32Array(n); this.fogD = [];
      for (let i = 0; i < n; i++) { seed[i] = rnd() * 10; this.fogD.push({ x: rr(-110, 110), z: rr(-65, 65), y: rr(-7, 0.7), s: rr(36, 70), sy: rr(0.45, 0.8), sp: rr(0.5, 1.3), rot: rnd() * TAU }); }
      g.setAttribute('aSeed', new T.InstancedBufferAttribute(seed, 1));
      this.group.add(m);
    }

    initJelly(B) {
      const T = this.T, pos = [], part = [], idx = [];
      const SEG = 8, RINGS = 4;
      for (let r = 0; r <= RINGS; r++) {                      // bell dome, open at the bottom
        const th = (r / RINGS) * Math.PI / 2, ry = Math.sin(th) * 0.5, rad = Math.cos(th) * 0.5;
        for (let s = 0; s < SEG; s++) { const a = (s / SEG) * TAU; pos.push(Math.cos(a) * rad, ry, Math.sin(a) * rad); part.push(0, 0); }
      }
      for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) { const a = r * SEG + s, b = r * SEG + (s + 1) % SEG, c = (r + 1) * SEG + s, d = (r + 1) * SEG + (s + 1) % SEG; idx.push(a, c, b, b, c, d); }
      for (let q = 0; q < 6; q++) {                           // tentacles: thin strips hanging below
        const a = (q / 6) * TAU + 0.3, bx = Math.cos(a) * 0.36, bz = Math.sin(a) * 0.36, nx = -Math.sin(a) * 0.035, nz = Math.cos(a) * 0.035, base = pos.length / 3;
        for (let k = 0; k <= 4; k++) { const u = k / 4, y = -u * (1.0 + (q % 3) * 0.35), w = 1 - u * 0.6; pos.push(bx - nx * w, y, bz - nz * w, bx + nx * w, y, bz + nz * w); part.push(1, u, 1, u); }
        for (let k = 0; k < 4; k++) { const i0 = base + k * 2; idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('aPart', new T.Float32BufferAttribute(part, 2)); g.setIndex(idx);
      const total = B.jelly.reduce((a, b) => a + b, 0), inst = new Float32Array(total * 2);
      this.jellyU = { uTime: { value: 0 }, uNight: { value: 0 }, uLite: { value: 1 } };
      const mat = new T.ShaderMaterial({ vertexShader: JELLY_VS, fragmentShader: JELLY_FS, uniforms: this.jellyU, transparent: true, depthWrite: false, side: T.DoubleSide, fog: false });
      const m = this.jelly = new T.InstancedMesh(g, mat, total); m.frustumCulled = false; m.renderOrder = 9;
      this.jData = []; let k = 0;
      B.jelly.forEach((cnt, sw) => {
        for (let i = 0; i < cnt; i++, k++) {
          inst[k * 2] = rnd() * TAU; inst[k * 2 + 1] = clamp(0.5 + (rnd() - 0.5) * 0.7 + (sw % 2 ? 0.3 : -0.3), 0, 1);
          this.jData.push({ hue: inst[k * 2 + 1], sw, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ph: rnd() * TAU, s: rr(1.5, 2.6), ox: rr(-1, 1), oy: rr(-1, 1), oz: rr(-1, 1) });
        }
      });
      g.setAttribute('aInst', new T.InstancedBufferAttribute(inst, 2));
      // swarm anchors (x, y, z) and drift radius
      this.swarms = [[-54, 3.2, 20], [47, 1.5, -30], [10, 0.5, 40], [-26, 2.5, -40]].slice(0, B.jelly.length).map((a, i) => ({ ax: a[0], ay: a[1], az: a[2], x: a[0], y: a[1], z: a[2], p: i * 2.1 }));
      this.jInit = false;
      this.group.add(m);
    }

    initBirds(B) {
      const T = this.T, pos = [], aW = [], aPh = [];
      const tri = (a, b, c, wa, wb, wc) => { pos.push(...a, ...b, ...c); aW.push(wa, wb, wc); };
      tri([0.5, 0, 0], [-0.35, 0, 0.1], [-0.35, 0, -0.1], 0, 0, 0);                     // body
      tri([0.2, 0, 0.04], [-0.3, 0, 0.06], [-0.05, 0, 0.78], 0, 0, 1);                  // wings (tip carries the flap weight)
      tri([0.2, 0, -0.04], [-0.05, 0, -0.78], [-0.3, 0, -0.06], 0, -1, 0);
      aW[aW.length - 2] = 1;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('aW', new T.Float32BufferAttribute(aW, 1));
      const total = B.birds.reduce((a, b) => a + b, 0), ph = new Float32Array(total);
      for (let i = 0; i < total; i++) ph[i] = rnd() * TAU;
      g.setAttribute('aPh', new T.InstancedBufferAttribute(ph, 1));
      this.birdU = { uTime: { value: 0 }, uCol: { value: new T.Color(0.07, 0.08, 0.11) } };
      const mat = new T.ShaderMaterial({ vertexShader: BIRD_VS, fragmentShader: BIRD_FS, uniforms: this.birdU, side: T.DoubleSide, fog: false });
      const m = this.birdMesh = new T.InstancedMesh(g, mat, total); m.frustumCulled = false; m.renderOrder = 8;
      this.bData = []; this.flocks = [];
      let k = 0;
      B.birds.forEach((cnt, f) => {
        const fl = { first: k, n: cnt, cx: 0, cz: 0, cy: 10, mx: 0, my: 0, mz: 0, mvx: 0, mvz: 0, scatterUntil: 0, sx: 0, sz: 0, R: 6.5 + f * 1.5, dir: f % 2 ? -1 : 1 };
        for (let i = 0; i < cnt; i++, k++) {
          const a = rnd() * TAU, r = fl.R * rr(0.7, 1.2);
          this.bData.push({ x: Math.cos(a) * r, y: 10 + rr(-1.5, 1.5), z: Math.sin(a) * r, vx: -Math.sin(a) * 5 * fl.dir, vy: 0, vz: Math.cos(a) * 5 * fl.dir, f });
        }
        this.flocks.push(fl);
      });
      this.bInit = false;
      this.group.add(m);
    }

    // ----- island dependent set-up (graph of the footpaths); view.island is a fresh object after a quality switch
    setIsland(isl) {
      this.isl = isl; this.disposePeople();
      this.nodes = null;
      if (!isl || !isl.paths) return;
      const nd = isl.paths.nodes, N = nd.length, INF = 1e9;
      const dist = new Float32Array(N * N).fill(INF), nxt = new Int16Array(N * N).fill(-1);
      this.nodes = nd; this.N = N; this.nodeY = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        dist[i * N + i] = 0; nxt[i * N + i] = i;
        const x = nd[i][0], z = nd[i][1]; this.nodeY[i] = Math.hypot(x, z) > 15 ? -0.2 : this.hOf(x, z);
      }
      for (const e of isl.paths.edges) {
        const a = e[0], b = e[1], d = Math.hypot(nd[a][0] - nd[b][0], nd[a][1] - nd[b][1]);
        dist[a * N + b] = dist[b * N + a] = d; nxt[a * N + b] = b; nxt[b * N + a] = a;
      }
      for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) { const dik = dist[i * N + k]; if (dik >= INF) continue; for (let j = 0; j < N; j++) { const nd2 = dik + dist[k * N + j]; if (nd2 < dist[i * N + j]) { dist[i * N + j] = nd2; nxt[i * N + j] = nxt[i * N + k]; } } }
      this.nxt = nxt;
    }
    hOf(x, z) { const h = this.isl && this.isl.hOf ? this.isl.hOf(x, z) : 0; return isFinite(h) ? h : 0; }

    // ----- helpers
    islandY() { return this.isl && this.isl.group ? this.isl.group.position.y : 0; }
    anchorPos(obj, out, lx, ly, lz) {                      // world position of an anchor (+ local offset), tolerant of null
      if (!obj) return null;
      obj.updateWorldMatrix(true, false);
      return out.set(lx || 0, ly || 0, lz || 0).applyMatrix4(obj.matrixWorld);
    }
    shipAnchor(pid, name, out) {
      const R = this.view.shipObj(pid); if (!R) return null;
      const a = R.anchors && R.anchors[name]; if (a && a.isObject3D) return this.anchorPos(a, out);
      return out.copy(R.group.position);
    }
    shipPos(pid, out) { const R = this.view.shipObj(pid); return R ? out.copy(R.group.position) : null; }
    dragonPos(id, out) { const D = this.view.dragonObj(id); return D ? out.copy(D.group.position) : null; }
    slotPos(i, out, dy) {
      i |= 0; if (i < 0 || i > 6) return out.set(0, dy || 0, 0);
      const w = this.slotW; return out.set(w[i * 3], w[i * 3 + 1] + (dy || 0), w[i * 3 + 2]);
    }
    take(idx, x) { const a = this.acc[idx] + x, n = Math.floor(a); this.acc[idx] = a - n; return n; }
    domePoint(x, z, out) { return out.set(x, 13, z).normalize().multiplyScalar(DOME_R); }
    later(delayMs, fn) { this.pend.push({ at: this.now + delayMs, fn }); }

    // generic emit helpers ------------------------------------------------------
    burstSparks(x, y, z, n, spd, ci, life, size, grav) {
      n = Math.max(1, Math.round(n * Math.max(0.5, this.dn)));
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, e = rr(-0.2, 1.0), s = spd * rr(0.4, 1), c = Math.sqrt(1 - e * e);
        this.A.spawn(x, y, z, Math.cos(a) * c * s, e * s, Math.sin(a) * c * s, life * rr(0.6, 1.2), size, size * 0.2, ci, 1, K.FLAME_END, 0, 0.6, grav == null ? 6 : grav, 0);
      }
    }
    puff(x, y, z, n, rad, spd, size0, size1, life, ci0, ci1, a0, up, wk) {
      n = Math.max(1, Math.round(n * Math.max(0.55, this.dn)));
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, r = Math.sqrt(rnd()) * rad;
        this.S.spawn(x + Math.cos(a) * r, y + rnd() * 0.3, z + Math.sin(a) * r, Math.cos(a) * spd * rr(0.3, 1), up * rr(0.6, 1.3), Math.sin(a) * spd * rr(0.3, 1),
          life * rr(0.7, 1.2), size0 * rr(0.7, 1.2), size1 * rr(0.7, 1.2), ci0, a0, ci1, 0, 0.5, -0.1, wk == null ? 0.6 : wk);
      }
    }
    glow(x, y, z, size, a, ci, life) { this.A.spawn(x, y, z, 0, 0, 0, life || 0.07, size, size, ci, a, ci, a, 0, 0, 0); }

    // ---------------------------------------------------------------- events
    event(ev, state) {
      if (!ev || !this.S) return;
      const v1 = this.v1, v2 = this.v2, v3 = this.v3, now = this.now;
      switch (ev.t) {
        case 'fireStart': { this.slotPos(ev.slot, v1, 1); this.burstSparks(v1.x, v1.y, v1.z, 18, 5, K.EMBER, 1.2, 0.35); this.puff(v1.x, v1.y, v1.z, 6, 1.2, 1.5, 1.2, 4, 2.4, K.SMOKE_D, K.SMOKE_M, 0.7, 2.5, 1); break; }
        case 'fireOut': this.steamBurst(ev.slot); break;
        case 'ruined': { this.slotPos(ev.slot, v1, 0.5); this.puff(v1.x, v1.y, v1.z, 22, 2.2, 3.5, 1.8, 6, 2.8, K.DUST, K.SMOKE_L, 0.7, 2.2, 0.4); this.puff(v1.x, v1.y + 1, v1.z, 8, 1.5, 1.5, 1.4, 5, 3.4, K.SMOKE_D, K.SMOKE_M, 0.7, 3, 1);
          this.burstSparks(v1.x, v1.y + 1, v1.z, 14, 6, K.WOOD_L, 1.3, 0.35, 12); break; }
        case 'repair': { this.slotPos(ev.slot, v1, 1.5); this.burstSparks(v1.x + rr(-1, 1), v1.y, v1.z + rr(-1, 1), 6, 3.5, K.GOLD, 0.6, 0.3, 8); break; }
        case 'spray': this.addJet(ev.pid, ev.slot, 650); break;
        case 'strikeWarn': this.addWarn(ev.id, ev.x, ev.y, this.targetKind(ev)); break;
        case 'strike': this.doStrike(ev, state); break;
        case 'stun': { if (this.shipAnchor(ev.pid, 'smoke', v1)) { this.puff(v1.x, v1.y, v1.z, 12, 0.5, 2, 0.8, 3, 1.8, K.SMOKE_D, K.SMOKE_M, 0.8, 1.8, 1); this.burstSparks(v1.x, v1.y + 0.5, v1.z, 10, 5, K.SPARK, 0.6, 0.35, 5); } break; }
        case 'shieldOn': case 'shieldOff': { const on = ev.t === 'shieldOn'; for (let i = 0; i < Math.round(46 * Math.max(0.5, this.dn)); i++) { const a = rnd() * TAU, y = rnd() * 7;
          const r = Math.sqrt(Math.max(1, DOME_R * DOME_R - y * y)); this.A.spawn(Math.cos(a) * r, y + 1, Math.sin(a) * r, 0, on ? 1.5 : 0.3, 0, rr(0.5, 1.1), 0.6, 0.1, K.DOMESPARK, 0.9, K.BOLT_GLOW, 0, 0.5, 0, 0); } break; }
        case 'dragonFire': this.dFire.set(ev.id, { until: now + 1500, slot: ev.slot, absorbed: !!ev.absorbed }); break;
        case 'harpoon': this.launchHarpoon(ev); break;
        case 'cannon': this.fireCannon(ev); break;
        case 'dragonHit': { if (this.dragonPos(ev.id, v1)) { this.burstSparks(v1.x, v1.y, v1.z, 12, 6, K.SPARK, 0.6, 0.45, 4); this.puff(v1.x, v1.y, v1.z, 5, 0.8, 1.5, 1, 3, 1.2, K.SMOKE_L, K.SMOKE_M, 0.5, 0.5, 0.5); } break; }
        case 'dragonFlee': { if (this.dragonPos(ev.id, v1)) { this.burstSparks(v1.x, v1.y, v1.z, 38, 8, K.EMBER, 1.6, 0.6, 2); this.puff(v1.x, v1.y, v1.z, 10, 1.5, 2.5, 1.5, 5, 2.2, K.SMOKE_D, K.SMOKE_M, 0.7, 1, 0.5); } break; }
        case 'dragonSpawn': { if (this.dragonPos(ev.id, v1)) this.puff(v1.x, v1.y, v1.z, 6, 1.5, 2, 2, 6, 2.5, K.SMOKE_D, K.SMOKE_M, 0.5, 0.5, 0.5); break; }
        case 'unload': this.launchCrate(ev.pid, ev.res); break;
        case 'harvest': this.doHarvest(ev, state); break;
        case 'gust': { let g = null; for (const q of this.gustFx) if (!q.live || q.pid === ev.pid) { g = q; break; } if (g) { g.live = true; g.pid = ev.pid; g.until = now + 1400; } break; }
        case 'buildStart': { this.slotPos(ev.slot, v1, 1.2); this.burstSparks(v1.x, v1.y, v1.z, 16, 4.5, K.SPARK, 0.7, 0.35, 8); this.chips(v1.x, v1.y, v1.z, 14, 1.8); this.puff(v1.x, 0.3, v1.z, 8, 2.2, 1.6, 1.0, 3.2, 1.8, K.DUST, K.DUST, 0.5, 0.3, 0.4); break; }
        case 'buildDone': this.buildDone(ev); break;
        case 'horn': { if (this.shipPos(ev.pid, v1)) { for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; this.A.spawn(v1.x, v1.y + 0.8, v1.z, Math.cos(a) * 9, 0.4, Math.sin(a) * 9, 0.5, 0.45, 0.2, K.WHITE, 0.5, K.WHITE, 0, 0.9, 0, 0); }
          this.scatterBirds(v1.x, v1.z, 34, 3200); } break; }
        case 'dock': { this.dockWave = now + 5500; if (this.shipPos(ev.pid, v1)) this.puff(v1.x, 0.2, v1.z, 5, 1.2, 1.2, 0.8, 2.4, 1.4, K.DUST, K.DUST, 0.35, 0.3, 0.4); break; }
        case 'drop': this.puff(ev.x, 5.5, ev.y, 4, 0.4, 0.8, 0.5, 1.4, 0.8, K.WHITE, K.WHITE, 0.4, 0.2, 0.2); break;
        case 'pickup': { if (this.shipPos(ev.pid, v1)) this.burstSparks(v1.x, v1.y + 0.5, v1.z, 10, 3.5, K.GOLD, 0.6, 0.3, 2); break; }
        case 'sink': this.startSink(); break;
        case 'herzLow': { for (let i = 0; i < 20; i++) { const a = rnd() * TAU; this.A.spawn(Math.cos(a) * 1.5, -13 + this.islandY(), Math.sin(a) * 1.5, Math.cos(a) * 3, rr(1, 4), Math.sin(a) * 3, 1.2, 0.6, 0.1, K.FLAME, 0.9, K.FLAME_END, 0, 0.5, 0, 0); } break; }
        case 'over': if (ev.survived) { for (let i = 0; i < 9; i++) this.later(i * 450, () => this.firework(rr(-14, 14), rr(18, 28), rr(-9, 9), null)); } break;
        default: break;
      }
    }

    targetKind(ev) { return ev.target === 'slot' || ev.slot != null ? 1 : 0; }

    steamBurst(slot) {
      const v1 = this.v1; this.slotPos(slot, v1, 0.8);
      this.puff(v1.x, v1.y, v1.z, 30, 1.6, 2.2, 1.4, 5.5, 2.4, K.STEAM, K.STEAM, 0.75, 3.2, 1.2);
      this.burstSparks(v1.x, v1.y, v1.z, 12, 4, K.WATER_HI, 0.8, 0.3, 6);
    }
    chips(x, y, z, n, spd) {
      n = Math.max(2, Math.round(n * Math.max(0.5, this.dn)));
      for (let i = 0; i < n; i++) { const a = rnd() * TAU, s = spd * rr(0.4, 1); this.S.spawn(x, y, z, Math.cos(a) * s, rr(2, 5), Math.sin(a) * s, rr(0.7, 1.3), 0.3, 0.2, rnd() < 0.5 ? K.WOOD : K.WOOD_L, 1, K.WOOD, 0.9, 0.5, 11, 0); }
    }

    addJet(pid, slot, ms) {
      let j = null; for (const q of this.jets) if (q.live && q.pid === pid) { j = q; break; }
      if (!j) for (const q of this.jets) if (!q.live) { j = q; break; }
      if (!j) return; j.live = true; j.pid = pid; j.slot = slot; j.until = Math.max(j.until, this.now + ms);
    }
    addWarn(id, x, z, kind) {
      let w = null; for (const q of this.warns) if (q.live && q.id === id) { w = q; break; }
      if (!w) for (const q of this.warns) if (!q.live) { w = q; break; }
      if (!w) w = this.warns[0];
      if (w.live && w.id === id) return;
      w.live = true; w.id = id; w.x = x; w.z = z; w.t0 = this.now; w.y = kind ? 0.5 : SHIP_Y - 0.6;
    }

    // ----- lightning
    makeBolt(b, x0, y0, z0, x1, y1, z1, jag) {
      // midpoint displacement on a vertical-ish line, 16 segments
      const N = 16, p = b.pts; b.n = N + 1;
      for (let i = 0; i <= N; i++) { const u = i / N, e = (i === 0 || i === N) ? 0 : 1, k = Math.sin(u * Math.PI) * jag * e; p[i * 3] = lerp(x0, x1, u) + (rnd() - 0.5) * 2 * k; p[i * 3 + 1] = lerp(y0, y1, u); p[i * 3 + 2] = lerp(z0, z1, u) + (rnd() - 0.5) * 2 * k; }
    }
    emitBolt(b, life, a, size) {
      const p = b.pts, n = b.n, A = this.A;
      for (let i = 0; i < n - 1; i++) {
        const ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2], dx = p[i * 3 + 3] - ax, dy = p[i * 3 + 4] - ay, dz = p[i * 3 + 5] - az;
        const len = Math.hypot(dx, dy, dz), steps = Math.max(1, Math.ceil(len / (size * 0.65)));
        for (let s = 0; s < steps; s++) {
          const u = s / steps, x = ax + dx * u, y = ay + dy * u, z = az + dz * u;
          A.spawn(x, y, z, 0, 0, 0, life, size, size * 0.7, K.BOLT, a, K.BOLT, 0, 0, 0, 0);
          if ((s & 1) === 0) A.spawn(x, y, z, 0, 0, 0, life * 1.3, size * 3.4, size * 3.4, K.BOLT_GLOW, a * 0.28, K.BOLT_GLOW, 0, 0, 0, 0);
        }
      }
    }
    spawnBolt(tx, ty, tz, big) {
      let b = null; for (const q of this.bolts) if (!q.live) { b = q; break; } if (!b) b = this.bolts[0];
      const top = 40, x0 = tx + rr(-5, 5), z0 = tz + rr(-5, 5);
      this.makeBolt(b, x0, top, z0, tx, ty, tz, big ? 3.2 : 2.2);
      b.live = true; b.t0 = this.now; b.again = false; b.w = big ? 1 : 0.7;
      this.emitBolt(b, 0.3, 1, big ? 0.85 : 0.6);
      // a few side branches
      const br = this.bolts[(this.bolts.indexOf(b) + 1) % this.bolts.length];
      for (let k = 0; k < 2; k++) {
        const i = 3 + Math.floor(rnd() * 9), p = b.pts, ex = p[i * 3] + rr(-9, 9), ez = p[i * 3 + 2] + rr(-9, 9), ey = p[i * 3 + 1] - rr(8, 16);
        const t2 = this.tmpBranch || (this.tmpBranch = { n: 0, pts: new Float32Array(3 * 40) });
        this.makeBolt(t2, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], ex, ey, ez, 1.6); this.emitBolt(t2, 0.22, 0.8, 0.4);
      }
      void br;
    }
    doStrike(ev, state) {
      const v1 = this.v1, v2 = this.v2;
      for (const w of this.warns) if (w.live && w.id === ev.id) w.live = false;
      let x = ev.x, z = ev.y, y = ev.target === 'slot' ? 1.0 : ev.target === 'ship' ? SHIP_Y - 0.5 : -1;
      if (ev.target === 'ship' && ev.pid != null && this.shipPos(ev.pid, v1) && Math.hypot(v1.x - x, v1.z - z) < 4) { x = v1.x; z = v1.z; y = v1.y; }
      if (ev.target === 'slot') { this.slotPos(ev.slot, v1, 1.2); x = v1.x; z = v1.z; y = v1.y; }
      const absorbed = ev.absorbed || (state && state.shieldOn && ev.target !== 'sky');
      if (absorbed) {
        this.domePoint(x, z, v2); this.spawnBolt(v2.x, v2.y, v2.z, true);
        for (let i = 0; i < Math.round(40 * Math.max(0.5, this.dn)); i++) { const a = rnd() * TAU, s = rr(3, 9); this.A.spawn(v2.x, v2.y, v2.z, Math.cos(a) * s + v2.x * 0.1, rr(-3, 6), Math.sin(a) * s + v2.z * 0.1, rr(0.3, 0.9), 0.55, 0.1, K.DOMESPARK, 1, K.BOLT_GLOW, 0, 1, 5, 0); }
        this.glow(v2.x, v2.y, v2.z, 7, 0.6, K.DOMESPARK, 0.25);
        return;
      }
      this.spawnBolt(x, y, z, true);
      const gs = ev.target === 'sky' ? 0.45 : 1; this.glow(x, y + 0.5, z, 9 * gs, 0.7, K.BOLT, 0.3); this.glow(x, y + 0.5, z, 4 * gs, 1, K.WHITE, 0.15);
      this.burstSparks(x, y + 0.3, z, 40, 9, K.SPARK, 0.8, 0.5, 9);
      for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; this.A.spawn(x, y + 0.2, z, Math.cos(a) * 14, 0.3, Math.sin(a) * 14, 0.3, 0.7, 0.2, K.BOLT, 0.9, K.BOLT_GLOW, 0, 1.5, 0, 0); }
      if (ev.target === 'slot') {
        this.S.spawn(x, 0.35, z, 0, 0, 0, 10, 3.4, 3.6, K.SCORCH, 0.55, K.SCORCH, 0, 0, 0, 0);
        this.puff(x, 0.5, z, 8, 1.2, 1.6, 1.0, 3.5, 2.2, K.SMOKE_D, K.SMOKE_M, 0.7, 2.5, 1);
      } else if (ev.target === 'ship') { this.puff(x, y, z, 6, 0.5, 2, 0.8, 2.6, 1.6, K.SMOKE_D, K.SMOKE_M, 0.8, 1.5, 1); }
      this.scatterBirds(x, z, 30, 3500);
    }

    // ----- movers (scripted flights: crates, shards, buckets, cannon balls, harpoons, rockets)
    mover(type, delay, dur, sx, sy, sz, tx, ty, tz, arc, c) {
      let m = null; for (let i = 0; i < this.moverN; i++) if (!this.movers[i].live) { m = this.movers[i]; break; }
      if (!m) return null;
      m.live = true; m.type = type; m.t0 = this.now + delay; m.dur = dur * 1000; m.sx = sx; m.sy = sy; m.sz = sz; m.tx = tx; m.ty = ty; m.tz = tz; m.arc = arc; m.c = c; m.tk = 0; m.tid = 0; m.hit = 0; m.extra = 0;
      return m;
    }
    launchCrate(pid, res) {
      const v1 = this.v1, v2 = this.v2; if (!this.shipAnchor(pid, 'cargo', v1)) return;
      if (!this.isl) return;
      this.anchorPos(this.isl.storehouse, v2, 0.7, 1.0, 0);
      this.mover(0, 0, 0.75, v1.x, v1.y - 0.4, v1.z, v2.x, v2.y, v2.z, 4.5, res === 'kristall' ? K.CRYSTAL : K.WOOD);
      this.burstSparks(v1.x, v1.y - 0.3, v1.z, 5, 2.5, res === 'kristall' ? K.CRYSTAL : K.WOOD_L, 0.5, 0.25, 6);
    }
    doHarvest(ev, state) {
      const v1 = this.v1, v2 = this.v2; const kr = ev.res === 'kristall', c = kr ? K.CRYSTAL : K.WOOD;
      let il = null; if (state && state.islets) for (const q of state.islets) if (q.id === ev.islet) il = q;
      const R = il ? this.view.isletObj(il.id) : null;
      if (R) v1.copy(R.group.position); else if (!this.shipPos(ev.pid, v1)) return;
      v1.y = 1.4;
      if (!this.shipAnchor(ev.pid, 'hook', v2)) return;
      this.burstSparks(v1.x, v1.y, v1.z, kr ? 14 : 8, 4, kr ? K.CRYSTAL : K.LEAF, 0.7, 0.35, 7);
      if (!kr) this.chips(v1.x, v1.y, v1.z, 8, 2);
      for (let i = 0; i < 4; i++) { const m = this.mover(1, i * 80, 0.55, v1.x + rr(-0.8, 0.8), v1.y, v1.z + rr(-0.8, 0.8), v2.x, v2.y, v2.z, 3, c); if (m) { m.tk = 1; m.tid = ev.pid; } }
    }
    launchHarpoon(ev) {
      const v1 = this.v1, v2 = this.v2; if (!this.shipAnchor(ev.pid, 'hook', v1) || !this.dragonPos(ev.dragon, v2)) return;
      const m = this.mover(3, 0, 0.42, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, 0.6, K.WHITE); if (m) { m.tk = 2; m.tid = ev.dragon; m.hit = ev.hit ? 1 : 0; }
    }
    fireCannon(ev) {
      const v1 = this.v1, v2 = this.v2, B = this.view.buildingObj(ev.slot);
      const mz = B && B.anchors && B.anchors.muzzle;
      if (mz) this.anchorPos(mz, v1); else this.slotPos(ev.slot, v1, 2.4);
      if (!this.dragonPos(ev.dragon, v2)) v2.set(v1.x * 1.6, 11, v1.z * 1.6);
      const dx = v2.x - v1.x, dz = v2.z - v1.z, L = Math.hypot(dx, dz) || 1;
      this.glow(v1.x, v1.y, v1.z, 4.5, 1, K.SPARK, 0.12); this.glow(v1.x, v1.y, v1.z, 2.2, 1, K.WHITE, 0.08);
      for (let i = 0; i < Math.round(14 * Math.max(0.5, this.dn)); i++) { const s = rr(5, 11); this.A.spawn(v1.x, v1.y, v1.z, dx / L * s + rr(-2, 2), rr(-1, 3), dz / L * s + rr(-2, 2), rr(0.2, 0.5), 0.5, 0.1, K.SPARK, 1, K.FLAME_END, 0, 1, 2, 0); }
      this.puff(v1.x, v1.y, v1.z, 9, 0.5, 1.8, 0.8, 3.4, 2, K.SMOKE_M, K.SMOKE_L, 0.7, 0.8, 0.8);
      const m = this.mover(2, 0, 0.8, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, 5, K.SMOKE_D); if (m) { m.tk = 2; m.tid = ev.dragon; }
    }
    buildDone(ev) {
      const v1 = this.v1; this.slotPos(ev.slot, v1, 0.5);
      this.puff(v1.x, 0.4, v1.z, 18, 2.4, 3.2, 1.6, 5, 1.8, K.DUST, K.DUST, 0.7, 0.9, 0.3);
      this.chips(v1.x, v1.y + 1, v1.z, 8, 2.5);
      const nc = Math.round(54 * Math.max(0.5, this.dn));
      for (let i = 0; i < nc; i++) { const a = rnd() * TAU, s = rr(1.5, 6); this.S.spawn(v1.x, v1.y + 1.2, v1.z, Math.cos(a) * s, rr(4, 9), Math.sin(a) * s, rr(2, 3.4), 0.34, 0.3, K.CONF + (i % 6), 1, K.CONF + (i % 6), 0.85, 1.1, 5.5, 0.2); }
      this.glow(v1.x, v1.y + 1.5, v1.z, 8, 0.4, K.GOLD, 0.4);
      this.cheerUntil = this.now + 3800; this.cheerSlot = ev.slot;
      if (ev.kind === 'sternwarte' && (ev.stage | 0) >= 3) for (let i = 0; i < 7; i++) this.later(i * 520, () => this.rocket(v1.x + rr(-5, 5), v1.z + rr(-5, 5)));
    }
    rocket(x, z) { const m = this.mover(5, 0, 0.9, x, 4, z, x + rr(-3, 3), rr(17, 25), z + rr(-3, 3), 0, K.GOLD); void m; }
    firework(x, y, z, ci) {
      const col = ci == null ? K.FW + Math.floor(rnd() * 4) : ci, n = Math.round(70 * Math.max(0.5, this.dn));
      this.glow(x, y, z, 12, 0.5, col, 0.25);
      for (let i = 0; i < n; i++) {
        const u = rr(-1, 1), a = rnd() * TAU, c = Math.sqrt(1 - u * u), s = rr(6, 9);
        this.A.spawn(x, y, z, Math.cos(a) * c * s, u * s, Math.sin(a) * c * s, rr(1.4, 2.2), 0.75, 0.15, col, 1, i & 1 ? K.GOLD : col, 0, 1.6, 2.5, 0);
      }
    }
    startSink() { if (this.sinkT0 == null) { this.sinkT0 = this.now; this.sinkDone = false; const iy = this.islandY(); const R = this.isl ? (this.isl.radius || 16) : 16;
      for (let i = 0; i < Math.round(60 * Math.max(0.5, this.dn)); i++) { const a = rnd() * TAU; this.S.spawn(Math.cos(a) * R, iy + rr(-8, 0), Math.sin(a) * R, Math.cos(a) * rr(2, 6), rr(0, 3), Math.sin(a) * rr(2, 6), rr(3, 5), 4, 14, K.DUST, 0.8, K.SMOKE_L, 0, 0.3, 0, 0.3); } } }
    scatterBirds(x, z, r, ms) {
      if (!this.flocks) return;
      for (const f of this.flocks) if (Math.hypot(f.cx - x, f.cz - z) < r + 10) { f.scatterUntil = this.now + ms; f.sx = x; f.sz = z; }
    }

    // ---------------------------------------------------------------- frame update
    update(state, alpha, opts) {
      if (!this.S || !state) return;
      opts = opts || {};
      const view = this.view, now = opts.now != null ? opts.now : this.now + 16.7;
      let dt = opts.dt != null ? opts.dt : (now - this.now) / 1000; dt = clamp(dt, 0, 0.066);
      this.now = now; this.t = now / 1000; this.dt = dt;
      if (view.island !== this.isl) this.setIsland(view.island);
      const isl = this.isl;
      this.night = clamp(view.nightN || 0, 0, 1); this.ov = view.mood ? clamp(view.mood.ov || 0, 0, 1) : 0;
      this.lite = clamp(1 - 0.62 * this.night - 0.22 * this.ov, 0.28, 1); this.S.lite = this.lite;
      this.wx = (state.wind ? state.wind.x : 0) + 0.7; this.wz = (state.wind ? state.wind.y : 0) + 0.25;
      this.pxU.uPx.value = view.H * 0.5 * this.camera.projectionMatrix.elements[5];
      if (isl) { for (let i = 0; i < 7; i++) { const a = isl.slotAnchors && isl.slotAnchors[i]; if (a) { this.anchorPos(a, this.v1); this.slotW[i * 3] = this.v1.x; this.slotW[i * 3 + 1] = this.v1.y; this.slotW[i * 3 + 2] = this.v1.z; } } }
      if (this.pend.length) { for (let i = this.pend.length - 1; i >= 0; i--) if (now >= this.pend[i].at) { const f = this.pend[i].fn; this.pend.splice(i, 1); try { f(); } catch (e) { /* ignore */ } } }
      if (dt > 0) {
        this.hazards(state, dt);
        this.strikes(state, dt);
        this.economy(state, dt);
        this.islandLife(state, dt);
        this.shipsFx(state, dt);
        this.movers_(state, dt);
      }
      this.weather(state, dt);
      this.fauna(state, dt);
      if (dt > 0 || !this.people.length) this.inhabitants(state, dt);
      this.S.step(dt, this.wx, this.wz); this.A.step(dt, this.wx, this.wz);
    }

    // ----- fire, spray, dragon breath, stun
    hazards(state, dt) {
      const slots = state.slots || [], dn = this.dn, v1 = this.v1, v2 = this.v2, S = this.S, A = this.A, night = this.night, t = this.t;
      for (let i = 0; i < slots.length && i < 7; i++) {
        const s = slots[i]; if (!s.kind) continue;
        const f = s.fire || 0, bx = this.slotW[i * 3], by = this.slotW[i * 3 + 1], bz = this.slotW[i * 3 + 2];
        if (f > 0.02 && !s.ruined) {
          const fr = Math.min(1, f), big = i === 0 ? 1.15 : 1, rad = (0.7 + 1.3 * fr) * big;
          for (let n = this.take(i, dt * (12 + 80 * fr) * dn); n > 0; n--) {          // flame bodies (opaque-ish, so they read on a bright day too)
            const a = rnd() * TAU, r = Math.sqrt(rnd()) * rad, sz = (1.9 + 2.6 * fr) * rr(0.7, 1.2), life = rr(0.55, 1.0) * (0.75 + fr * 0.5);
            S.spawn(bx + Math.cos(a) * r, by + 0.3 + rnd() * 0.8, bz + Math.sin(a) * r, rr(-0.4, 0.4), rr(1.8, 3.4) + fr * 1.8, rr(-0.4, 0.4), life, sz, 0.35, K.FLAME, 0.95, K.FLAME_END, 0.0, 0.4, -1.5, 0.4);
            if (rnd() < 0.6) A.spawn(bx + Math.cos(a) * r * 0.6, by + 0.3 + rnd() * 0.6, bz + Math.sin(a) * r * 0.6, rr(-0.3, 0.3), rr(1.8, 3.2), rr(-0.3, 0.3), life * 0.8, sz * 0.7, 0.2, K.FLAME_HOT, 0.8, K.FLAME, 0, 0.4, -1.5, 0.4);
          }
          for (let n = this.take(8 + i, dt * (3 + 22 * fr) * dn); n > 0; n--) {          // embers
            const a = rnd() * TAU, r = rnd() * rad;
            A.spawn(bx + Math.cos(a) * r, by + 1 + rnd(), bz + Math.sin(a) * r, rr(-1, 1), rr(2.5, 5.5), rr(-1, 1), rr(1.2, 2.8), 0.28, 0.1, K.EMBER, 1, K.FLAME_END, 0, 0.1, -0.5, 1.8);
          }
          for (let n = this.take(16 + i, dt * (3.5 + 14 * fr) * dn); n > 0; n--) {       // smoke column, readable from the far camera
            const a = rnd() * TAU, r = rnd() * rad * 0.6;
            S.spawn(bx + Math.cos(a) * r, by + 1.4, bz + Math.sin(a) * r, rr(-0.3, 0.3), rr(3, 4.4) + fr * 1.2, rr(-0.3, 0.3), rr(4, 6), 2.0 + fr * 0.8, 6.5 + fr * 5, K.SMOKE_D, 0.85, K.SMOKE_M, 0, 0.1, -0.1, 1.3);
          }
          const fl = 0.75 + 0.25 * Math.sin(t * 17 + i * 3) * Math.sin(t * 11.3 + i);
          A.spawn(bx, by + 1.2, bz, 0, 0, 0, 0.07, (5 + 6 * fr) * fl, (5 + 6 * fr) * fl, K.FLAME, (0.16 + 0.14 * fr) * (1 + night), K.FLAME, (0.16 + 0.14 * fr) * (1 + night), 0, 0, 0);
          A.spawn(bx, by + 0.3, bz, 0, 0, 0, 0.07, 4.2 * fl, 4.2 * fl, K.FLAME_HOT, 0.18 + 0.12 * fr, K.FLAME_HOT, 0.2, 0, 0, 0);
        } else if (s.ruined) {
          for (let n = this.take(24 + i, dt * 1.2 * dn); n > 0; n--) S.spawn(bx + rr(-0.8, 0.8), by + 0.6, bz + rr(-0.8, 0.8), 0, rr(1, 1.8), 0, rr(3, 4.5), 0.7, 3, K.SMOKE_M, 0.32, K.SMOKE_L, 0, 0.1, -0.1, 1);
        }
        // construction: chips and sparks at the scaffold, dust at the foot
        if (s.build > 0 && s.build < 1 && !s.ruined) {
          for (let n = this.take(32 + i, dt * 5 * dn); n > 0; n--) { this.chips(bx + rr(-1.8, 1.8), by + rr(1, 3.2), bz + rr(-1.8, 1.8), 1, 1.2); }
          for (let n = this.take(40 + i, dt * 4 * dn); n > 0; n--) A.spawn(bx + rr(-2, 2), by + rr(1.4, 3.4), bz + rr(-2, 2), rr(-1, 1), rr(1, 3), rr(-1, 1), rr(0.3, 0.6), 0.28, 0.05, K.SPARK, 1, K.FLAME, 0, 0.5, 6, 0);
          for (let n = this.take(48 + i, dt * 1.6 * dn); n > 0; n--) S.spawn(bx + rr(-2.2, 2.2), by + 0.3, bz + rr(-2.2, 2.2), rr(-0.5, 0.5), rr(0.3, 0.8), rr(-0.5, 0.5), rr(1.2, 2), 0.8, 2.4, K.DUST, 0.3, K.DUST, 0, 0.3, 0, 0.5);
        }
        // working chimney
        if (s.kind === 'werkstatt' && s.build >= 1 && !s.ruined && f <= 0.25) {
          const B = this.view.buildingObj(i);
          if (B && B.anchors && B.anchors.chimney && this.anchorPos(B.anchors.chimney, v1)) this.chimney(v1, 56 + i, dt, 6);
        }
      }
      // jets of water
      for (const j of this.jets) {
        if (!j.live) continue;
        if (this.now > j.until) { j.live = false; continue; }
        if (!this.shipAnchor(j.pid, 'spray', v1)) { j.live = false; continue; }
        this.slotPos(j.slot, v2, 1.0);
        const dx = v2.x - v1.x, dy = v2.y - v1.y, dz = v2.z - v1.z, tau = 0.5 + Math.hypot(dx, dz) * 0.018, g = 9;
        const vx = dx / tau, vz = dz / tau, vy = (dy + 0.5 * g * tau * tau) / tau;
        for (let n = this.take(64 + (j.pid & 7), dt * 150 * dn); n > 0; n--) {
          const k = rnd() * dt;                        // sub-frame offset along the jet
          S.spawn(v1.x + vx * k, v1.y + vy * k, v1.z + vz * k, vx + rr(-0.5, 0.5), vy + rr(-0.5, 0.5), vz + rr(-0.5, 0.5), tau * rr(0.92, 1.06), 0.85, 0.6, K.WATER, 0.95, K.WATER, 0.55, 0, g, 0);
          if (rnd() < 0.35) A.spawn(v1.x, v1.y, v1.z, vx + rr(-0.6, 0.6), vy + rr(-0.6, 0.6), vz + rr(-0.6, 0.6), tau, 0.28, 0.2, K.WATER_HI, 0.55, K.WATER, 0.1, 0, g, 0);
        }
        for (let n = this.take(72 + (j.pid & 7), dt * 36 * dn); n > 0; n--) {      // splash + steam where it lands
          A.spawn(v2.x + rr(-0.6, 0.6), v2.y, v2.z + rr(-0.6, 0.6), rr(-2, 2), rr(2, 5), rr(-2, 2), rr(0.4, 0.8), 0.35, 0.1, K.WATER_HI, 0.8, K.WATER, 0, 0.4, 9, 0);
          if (rnd() < 0.55) S.spawn(v2.x + rr(-0.8, 0.8), v2.y + 0.4, v2.z + rr(-0.8, 0.8), rr(-0.6, 0.6), rr(1.5, 2.8), rr(-0.6, 0.6), rr(1.1, 1.8), 1.2, 4, K.STEAM, 0.6, K.STEAM, 0, 0.3, -0.5, 1);
        }
      }
      // state-driven jets: a ship that is extinguishing sprays at the nearest burning slot
      for (const sh of state.ships || []) {
        if (sh.act !== 'extinguish' || !sh.acting) continue;
        let best = -1, bd = 1e9; for (let i = 0; i < slots.length; i++) if (slots[i].fire > 0.02) { const d = Math.hypot(this.slotW[i * 3] - sh.x, this.slotW[i * 3 + 2] - sh.y); if (d < bd) { bd = d; best = i; } }
        if (best >= 0 && bd < 20) this.addJet(sh.pid, best, 350);
      }
      // dragon breath
      for (const [id, d] of this.dFire) {
        if (this.now > d.until) { this.dFire.delete(id); continue; }
        const D = this.view.dragonObj(id); if (!D) continue;
        const mouth = D.anchors && D.anchors.mouth ? this.anchorPos(D.anchors.mouth, v1) : v1.copy(D.group.position);
        if (!mouth) continue;
        let tx, ty, tz;
        if (d.absorbed) { this.domePoint(v1.x, v1.z, v2); tx = v2.x; ty = v2.y; tz = v2.z; } else if (d.slot >= 0) { this.slotPos(d.slot, v2, 1.2); tx = v2.x; ty = v2.y; tz = v2.z; } else { tx = 0; ty = -2; tz = 0; }
        const dx = tx - v1.x, dy = ty - v1.y, dz = tz - v1.z, L = Math.hypot(dx, dy, dz) || 1, sp = 24, life = Math.max(0.25, L / sp);
        const px = v1.x, py = v1.y, pz = v1.z, ux = dx / L, uy = dy / L, uz = dz / L, spread = 0.2 * sp * 0.5;
        for (let n = this.take(96, dt * 160 * dn); n > 0; n--) {
          const k = rnd() * dt, j = sp * rr(0.85, 1.05);
          A.spawn(px + ux * sp * k, py + uy * sp * k, pz + uz * sp * k, ux * j + rr(-spread, spread), uy * j + rr(-spread, spread), uz * j + rr(-spread, spread), life * rr(0.9, 1.05), 0.6, 3.4, K.FLAME_HOT, 0.8, K.FLAME_END, 0, 0.1, 0, 0);
        }
        for (let n = this.take(97, dt * 24 * dn); n > 0; n--) S.spawn(px + ux * rnd() * L * 0.6, py + uy * rnd() * L * 0.6, pz + uz * rnd() * L * 0.6, rr(-1, 1), rr(0.5, 2), rr(-1, 1), rr(1.2, 2), 1, 3.6, K.SMOKE_D, 0.5, K.SMOKE_M, 0, 0.3, -0.3, 1);
        if (d.absorbed) {
          for (let n = this.take(98, dt * 70 * dn); n > 0; n--) { const a = rnd() * TAU, s = rr(3, 8); A.spawn(tx, ty, tz, Math.cos(a) * s, rr(-2, 5), Math.sin(a) * s, rr(0.3, 0.8), 0.5, 0.08, rnd() < 0.5 ? K.DOMESPARK : K.EMBER, 1, K.BOLT_GLOW, 0, 1, 5, 0); }
          this.glow(tx, ty, tz, 6, 0.5, K.DOMESPARK, 0.07);
        } else {
          for (let n = this.take(98, dt * 60 * dn); n > 0; n--) A.spawn(tx + rr(-1, 1), ty + rr(-0.3, 0.6), tz + rr(-1, 1), rr(-1, 1), rr(2, 5), rr(-1, 1), rr(0.5, 1), 1.8, 0.4, K.FLAME_HOT, 0.8, K.FLAME_END, 0, 0.4, -1, 0);
          this.glow(tx, ty, tz, 7, 0.28, K.FLAME, 0.07);
        }
      }
      // dragons that flee leave an ember trail
      for (const dr of state.dragons || []) {
        if (dr.state !== 'flee') continue;
        const D = this.view.dragonObj(dr.id); if (!D) continue;
        for (let n = this.take(104 + (dr.id & 3), dt * 40 * dn); n > 0; n--) {
          A.spawn(D.group.position.x + rr(-1.5, 1.5), D.group.position.y + rr(-0.5, 0.8), D.group.position.z + rr(-1.5, 1.5), rr(-1, 1), rr(0, 2), rr(-1, 1), rr(0.6, 1.4), 0.5, 0.1, K.EMBER, 1, K.FLAME_END, 0, 0.1, 0.3, 0.2);
        }
      }
    }

    chimney(p, key, dt, size) {
      for (let n = this.take(key, dt * 4 * this.dn); n > 0; n--)
        this.S.spawn(p.x + rr(-0.1, 0.1), p.y, p.z + rr(-0.1, 0.1), rr(-0.15, 0.15), rr(1.2, 1.9), rr(-0.15, 0.15), rr(3, 4.4), 0.45, size * 0.4, K.SMOKE_L, 0.5, K.SMOKE_M, 0, 0.1, -0.15, 1.2);
    }

    // ----- lightning telegraph + ambient bolts
    strikes(state, dt) {
      const now = this.now, A = this.A;
      for (const s of state.strikes || []) this.addWarn(s.id, s.x, s.y, s.target === 'slot' ? 1 : 0);
      for (const w of this.warns) {
        if (!w.live) continue;
        const el = (now - w.t0) / 1000;
        if (el > 1.25) { w.live = false; continue; }
        const p = clamp(el / 0.8, 0, 1), pulse = 0.65 + 0.35 * Math.sin(el * 28), n = Math.round(46 * Math.max(0.5, this.dn));
        const rad = lerp(4.6, 2.6, p), bright = (0.55 + 0.6 * p) * pulse;
        for (let ring = 0; ring < 2; ring++) {
          const R = ring ? rad * 0.55 : rad;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU + el * (ring ? -3 : 2), j = 1 + (rnd() - 0.5) * 0.22;
            A.spawn(w.x + Math.cos(a) * R * j, w.y + 0.2 + (rnd() - 0.5) * 0.15, w.z + Math.sin(a) * R * j, 0, 0, 0, 0.05, ring ? 0.7 : 0.95, ring ? 0.7 : 0.95, K.WARN, bright * (ring ? 0.7 : 1) * (0.5 + rnd() * 0.5), K.WARN, 0, 0, 0, 0);
          }
        }
        this.glow(w.x, w.y + 0.3, w.z, 5 + 3 * p, 0.35 * pulse, K.BOLT_GLOW, 0.05);
        for (let n2 = this.take(112, dt * 30 * this.dn); n2 > 0; n2--) A.spawn(w.x + rr(-2, 2), w.y, w.z + rr(-2, 2), rr(-0.6, 0.6), rr(4, 8), rr(-0.6, 0.6), rr(0.5, 1), 0.4, 0.1, K.BOLT, 0.9, K.BOLT_GLOW, 0, 0, 0, 0);
        for (let h = 0; h < 5; h++) A.spawn(w.x, w.y + 1.5 + h * 2.4, w.z, 0, 0, 0, 0.05, 1.2, 1.2, K.BOLT_GLOW, 0.22 * p * pulse, K.BOLT_GLOW, 0, 0, 0, 0);
      }
      // bolt flicker: a second, shorter strike of the same polyline
      for (const b of this.bolts) {
        if (!b.live) continue;
        const el = (now - b.t0) / 1000;
        if (!b.again && el > 0.1) { b.again = true; this.emitBolt(b, 0.16, 0.9, 0.55); }
        if (el > 0.5) b.live = false;
      }
      // ambient far bolts while it storms
      if (this.rainI > 0.5) {
        this.nextAmbient -= dt;
        if (this.nextAmbient <= 0) {
          this.nextAmbient = rr(3, 7.5);
          const side = rnd() < 0.5 ? -1 : 1, x = side * rr(52, 85), z = rr(-48, 48);
          this.spawnBolt(x, -4, z, false); this.glow(x, 2, z, 12, 0.35, K.BOLT_GLOW, 0.3);
          if (this.view.flash) this.view.flash(0.22);
          this.scatterBirds(x, z, 40, 2500);
        }
      }
    }

    // ----- economy movers, gusts
    economy(state, dt) {
      const A = this.A, v1 = this.v1;
      for (const g of this.gustFx) {
        if (!g.live) continue; if (this.now > g.until) { g.live = false; continue; }
        if (!this.shipPos(g.pid, v1)) continue;
        for (let n = this.take(120 + (g.pid & 7), dt * 60 * this.dn); n > 0; n--) A.spawn(v1.x + rr(-1.6, 1.6), v1.y + rr(-0.6, 0.9), v1.z + rr(-1.6, 1.6), rr(-1, 1), rr(-0.5, 1.2), rr(-1, 1), rr(0.5, 1.1), 0.35, 0.05, K.WHITE, 0.9, K.WATER_HI, 0, 0.5, 0, 0);
      }
      for (const g of state.gusts || []) {
        const ph = g.age / g.life; if (ph < 0.08 || ph > 0.8) continue;
        const dx = g.x2 - g.x1, dz = g.y2 - g.y1, len = Math.hypot(dx, dz) || 1;
        for (let n = this.take(130 + (g.id & 7), dt * 9 * this.dn); n > 0; n--) {
          const u = rnd();
          A.spawn(g.x1 + dx * u + rr(-1.4, 1.4), SHIP_Y + rr(-0.2, 0.7), g.y1 + dz * u + rr(-1.4, 1.4), dx / len * 4, rr(-0.2, 0.5), dz / len * 4, rr(0.6, 1.2), 0.32, 0.05, K.WHITE, 0.8, K.WATER_HI, 0, 0.5, 0, 0);
        }
      }
    }

    movers_(state, dt) {
      const now = this.now, v1 = this.v1, v2 = this.v2, A = this.A, S = this.S;
      for (let i = 0; i < this.moverN; i++) {
        const m = this.movers[i]; if (!m.live) continue;
        if (now < m.t0) continue;
        let u = (now - m.t0) / m.dur;
        if (m.tk === 2 && this.dragonPos(m.tid, v2)) { m.tx = v2.x; m.ty = v2.y; m.tz = v2.z; }
        else if (m.tk === 1 && this.shipAnchor(m.tid, 'hook', v2)) { m.tx = v2.x; m.ty = v2.y; m.tz = v2.z; }
        if (u >= 1) { this.arrive(m); m.live = false; continue; }
        const e = m.type === 3 ? u : u * u * (3 - 2 * u) * 0.0 + u;
        const x = lerp(m.sx, m.tx, e), z = lerp(m.sz, m.tz, e), y = lerp(m.sy, m.ty, e) + m.arc * 4 * u * (1 - u);
        switch (m.type) {
          case 0: case 1: {                                   // crate / shard: bright head + sparkle trail
            const kr = m.c === K.CRYSTAL, sz = m.type === 0 ? 0.75 : 0.42;
            A.spawn(x, y, z, 0, 0, 0, 0.05, sz * 1.9, sz * 1.9, kr ? K.CRYSTAL : K.GOLD, 0.45, kr ? K.CRYSTAL : K.GOLD, 0, 0, 0, 0);
            S.spawn(x, y, z, 0, 0, 0, 0.05, sz, sz, m.c, 1, m.c, 1, 0, 0, 0);
            for (let n = this.take(150 + (i & 15), dt * 40 * this.dn); n > 0; n--) A.spawn(x + rr(-0.2, 0.2), y + rr(-0.2, 0.2), z + rr(-0.2, 0.2), rr(-0.6, 0.6), rr(-0.4, 0.8), rr(-0.6, 0.6), rr(0.35, 0.7), 0.26, 0.04, kr ? K.CRYSTAL : K.SPARK, 0.9, K.WHITE, 0, 0.8, 1, 0);
            break;
          }
          case 2: {                                           // cannon ball
            S.spawn(x, y, z, 0, 0, 0, 0.05, 0.75, 0.75, K.SMOKE_D, 1, K.SMOKE_D, 1, 0, 0, 0);
            A.spawn(x, y, z, 0, 0, 0, 0.05, 1.3, 1.3, K.FLAME, 0.5, K.FLAME, 0, 0, 0, 0);
            for (let n = this.take(180, dt * 50 * this.dn); n > 0; n--) S.spawn(x, y, z, rr(-0.3, 0.3), rr(0, 0.5), rr(-0.3, 0.3), rr(0.8, 1.4), 0.5, 1.9, K.SMOKE_M, 0.55, K.SMOKE_L, 0, 0.4, 0, 0.5);
            break;
          }
          case 3: {                                           // harpoon: mesh + wispy rope trail
            const H = this.harp[0]; let h = null; for (const q of this.harp) if (!q.visible || q.userData.m === m) { h = q; break; } void H;
            if (h) {
              h.visible = true; h.userData.m = m; h.position.set(x, y, z);
              v1.set(m.tx - m.sx, m.ty - m.sy, m.tz - m.sz).normalize();
              this.q4.setFromUnitVectors(this.v3.set(1, 0, 0), v1); h.quaternion.copy(this.q4);
            }
            for (let n = this.take(190, dt * 90 * this.dn); n > 0; n--) S.spawn(x + rr(-0.1, 0.1), y + rr(-0.1, 0.1), z + rr(-0.1, 0.1), 0, 0, 0, rr(0.35, 0.7), 0.38, 0.1, K.WHITE, 0.8, K.WHITE, 0, 0, 0, 0);
            break;
          }
          case 4: case 6: {                                   // water bucket handed along the line
            S.spawn(x, y, z, 0, 0, 0, 0.05, 0.5, 0.5, K.BUCKET, 1, K.BUCKET, 1, 0, 0, 0);
            A.spawn(x, y, z, rr(-0.5, 0.5), rr(0, 1), rr(-0.5, 0.5), 0.3, 0.25, 0.05, K.WATER_HI, 0.8, K.WATER, 0, 0.5, 4, 0);
            break;
          }
          case 5: {                                           // firework rocket
            for (let n = this.take(210, dt * 120 * this.dn); n > 0; n--) A.spawn(x, y, z, rr(-0.5, 0.5), rr(-3, -1), rr(-0.5, 0.5), rr(0.3, 0.7), 0.45, 0.05, K.GOLD, 1, K.FLAME_END, 0, 0.6, 2, 0);
            this.glow(x, y, z, 1.6, 0.8, K.SPARK, 0.05);
            break;
          }
          default: break;
        }
      }
      for (const h of this.harp) if (h.visible && !(h.userData.m && h.userData.m.live && h.userData.m.type === 3)) h.visible = false;
    }
    arrive(m) {
      const x = m.tx, y = m.ty, z = m.tz;
      switch (m.type) {
        case 0: this.burstSparks(x, y, z, 12, 3.5, m.c === K.CRYSTAL ? K.CRYSTAL : K.GOLD, 0.7, 0.3, 4); this.glow(x, y, z, 2.5, 0.5, m.c === K.CRYSTAL ? K.CRYSTAL : K.GOLD, 0.2); break;
        case 1: this.burstSparks(x, y, z, 3, 2, m.c === K.CRYSTAL ? K.CRYSTAL : K.GOLD, 0.4, 0.25, 2); break;
        case 2: this.burstSparks(x, y, z, 14, 7, K.FLAME, 0.7, 0.6, 3); this.glow(x, y, z, 4, 0.6, K.SPARK, 0.15); this.puff(x, y, z, 5, 0.6, 1.5, 1, 3.4, 1.6, K.SMOKE_D, K.SMOKE_M, 0.7, 0.5, 0.6); break;
        case 3: if (m.hit) { this.burstSparks(x, y, z, 14, 6, K.SPARK, 0.6, 0.4, 4); this.glow(x, y, z, 3, 0.5, K.WHITE, 0.12); } else this.puff(x, y, z, 3, 0.4, 1, 0.5, 1.6, 1.1, K.WHITE, K.WHITE, 0.4, 0.2, 0.2); break;
        case 4: this.burstSparks(x, y, z, 6, 3, K.WATER_HI, 0.5, 0.3, 8); this.puff(x, y, z, 4, 0.5, 1.2, 0.8, 2.8, 1.2, K.STEAM, K.STEAM, 0.5, 1.4, 0.8); break;
        case 5: this.firework(x, y, z, null); break;
        default: break;
      }
    }

    // ----- waterfalls, chimneys
    islandLife(state, dt) {
      const isl = this.isl; if (!isl) return;
      const iy = this.islandY(), dn = this.dn, S = this.S, A = this.A, v1 = this.v1;
      if (this.sinkT0 == null && state.over && state.herz != null && state.herz <= 0) this.startSink();
      if (this.sinkT0 != null && state.herz > 0 && !state.over) { this.sinkT0 = null; }
      const sunk = iy < -1.5;
      if (this.sinkT0 != null) {
        const el = (this.now - this.sinkT0) / 1000;
        if (el < 9) {
          const R = isl.radius || 16;
          for (let n = this.take(300, dt * 55 * dn * (1 - el / 12)); n > 0; n--) { const a = rnd() * TAU, r = R * rr(0.7, 1.15); S.spawn(Math.cos(a) * r, iy + rr(-6, 0.5), Math.sin(a) * r, Math.cos(a) * rr(1, 3), rr(0.5, 2.5), Math.sin(a) * rr(1, 3), rr(3, 5.5), 3.5, 13, K.DUST, 0.55, K.SMOKE_L, 0, 0.3, 0, 0.3); }
          for (let n = this.take(301, dt * 40 * dn); n > 0; n--) { const a = rnd() * TAU, r = R * rr(0.2, 1); S.spawn(Math.cos(a) * r, iy + rr(0, 2), Math.sin(a) * r, Math.cos(a) * rr(1, 5), rr(1, 6), Math.sin(a) * rr(1, 5), rr(1.5, 3), rr(0.4, 0.8), 0.3, K.STONE, 1, K.STONE, 0.8, 0.1, 9, 0); }
        }
      }
      if (sunk) return;
      // waterfalls: falling water particles continue past the modelled ribbon, mist fades into the cloud sea
      const rim = isl.rim;
      if (rim) for (let i = 0; i < rim.length; i++) {
        const r = rim[i], main = i === 0, ox = r.nx, oz = r.nz;
        for (let n = this.take(320 + i, dt * (main ? 46 : 22) * dn); n > 0; n--) {
          const side = rr(-0.3, 0.3) * (main ? 1 : 0.6);
          S.spawn(r.x + ox * 1.0 - oz * side, r.y + iy - 0.3, r.z + oz * 1.0 + ox * side, ox * rr(0.9, 2.0), rr(-0.5, 0.2), oz * rr(0.9, 2.0), rr(1.8, 2.8), 0.55, 1.0, K.WATER_HI, 0.6, K.MIST, 0, 0, 8, 0);
        }
        for (let n = this.take(330 + i, dt * (main ? 10 : 6) * dn); n > 0; n--)
          S.spawn(r.x + ox * rr(1.5, 3.5) + rr(-0.4, 0.4), r.y + iy - (main ? 8 : 4.5) - rnd() * 4, r.z + oz * rr(1.5, 3.5) + rr(-0.4, 0.4), ox * rr(0.6, 1.6) + this.wx * 0.1, rr(-0.5, 0.2), oz * rr(0.6, 1.6) + this.wz * 0.1, rr(2.8, 4.4), 2.4, main ? 9 : 6, K.MIST, 0.5, K.MIST, 0, 0.4, 0, 0.6);
      }
      // storehouse chimney (only drifts a little: a quiet village)
      if (isl.storehouse && this.anchorPos(isl.storehouse, v1, 1.05, 2.75, 0)) this.chimney(v1, 340, dt, 4);
      // rain splashes on the island top
      if (this.rainI > 0.05) {
        for (let n = this.take(350, dt * 70 * this.rainI * dn); n > 0; n--) {
          const a = rnd() * TAU, r = Math.sqrt(rnd()) * 15, x = Math.cos(a) * r, z = Math.sin(a) * r;
          A.spawn(x, this.hOf(x, z) + iy + 0.1, z, rr(-0.6, 0.6), rr(1.5, 3.2), rr(-0.6, 0.6), rr(0.18, 0.34), 0.4, 0.12, K.WATER_HI, 0.55, K.WATER_HI, 0, 0.3, 14, 0);
        }
      }
    }

    // ----- ship exhaust, prop wash, stun smoke
    shipsFx(state, dt) {
      const A = this.A, S = this.S, v1 = this.v1, dn = this.dn, t = this.t;
      let idx = 0;
      for (const sh of state.ships || []) {
        const key = 400 + (idx++ & 7) * 4, R = this.view.shipObj(sh.pid); if (!R) continue;
        const sp = Math.hypot(sh.vx || 0, sh.vy || 0);
        const rear = R.art && R.art.props && R.art.props[2] ? R.art.props[2] : null;
        if (rear) this.anchorPos(rear, v1); else v1.copy(R.group.position);
        if (sp > 1 && !sh.docked) {
          for (let n = this.take(key, dt * (3 + sp * 0.8) * dn); n > 0; n--) S.spawn(v1.x + rr(-0.2, 0.2), v1.y + rr(-0.2, 0.2), v1.z + rr(-0.2, 0.2), -(sh.vx || 0) * 0.1 + rr(-0.3, 0.3), rr(-0.1, 0.4), -(sh.vy || 0) * 0.1 + rr(-0.3, 0.3), rr(0.9, 1.5), 0.3, 1.35, K.WHITE, 0.22, K.WHITE, 0, 0.8, 0, 0.3);
        }
        if (sh.boosting) {
          const ux = sp > 0.1 ? (sh.vx || 0) / sp : Math.cos(sh.h || 0), uz = sp > 0.1 ? (sh.vy || 0) / sp : Math.sin(sh.h || 0);
          for (let n = this.take(key + 1, dt * 60 * dn); n > 0; n--) A.spawn(v1.x, v1.y, v1.z, -ux * rr(5, 9) + rr(-0.5, 0.5), rr(-0.5, 0.5), -uz * rr(5, 9) + rr(-0.5, 0.5), rr(0.25, 0.55), 0.5, 0.08, K.FLAME_HOT, 0.9, K.FLAME_END, 0, 0.6, 0, 0);
        }
        if (sh.stunned > 0) {
          if (this.shipAnchor(sh.pid, 'smoke', v1)) {
            for (let n = this.take(key + 2, dt * 28 * dn); n > 0; n--) S.spawn(v1.x + rr(-0.2, 0.2), v1.y, v1.z + rr(-0.2, 0.2), rr(-0.4, 0.4) - (sh.vx || 0) * 0.15, rr(1.2, 2.2), rr(-0.4, 0.4) - (sh.vy || 0) * 0.15, rr(1.4, 2.4), 0.6, 2.8, K.SMOKE_D, 0.75, K.SMOKE_M, 0, 0.3, -0.3, 1);
            for (let n = this.take(key + 3, dt * 14 * dn); n > 0; n--) A.spawn(v1.x, v1.y, v1.z, rr(-2, 2), rr(1, 4), rr(-2, 2), rr(0.3, 0.6), 0.3, 0.05, K.SPARK, 1, K.FLAME, 0, 0.5, 6, 0);
          }
          const R2 = R.group.position;
          for (let k = 0; k < 3; k++) { const a = t * 5 + k * TAU / 3; A.spawn(R2.x + Math.cos(a) * 1.5, R2.y + 3.2 + Math.sin(a * 2) * 0.1, R2.z + Math.sin(a) * 1.5, 0, 0, 0, 0.05, 0.75, 0.75, K.SPARK, 1, K.SPARK, 0, 0, 0, 0); }
        }
      }
    }

    // ----- weather: rain, fog banks
    weather(state, dt) {
      const ev = state.event, kind = ev ? ev.kind : null, storm = kind === 'sturm' || kind === 'nacht';
      let target = kind === 'nacht' ? 1 : kind === 'sturm' ? 0.72 : 0;
      if (!storm && state.next && (state.next.kind === 'sturm' || state.next.kind === 'nacht') && state.next.at - state.t < 10 && state.next.at - state.t > 0) target = 0.16;
      this.rainI += (target - this.rainI) * Math.min(1, dt * 1.1);
      const r = this.rain, U = this.rainU;
      r.visible = this.rainI > 0.015;
      if (r.visible) {
        U.uTime.value = this.t; U.uI.value = this.rainI;
        U.uWind.value.set(state.wind ? state.wind.x : 0, 0, state.wind ? state.wind.y : 0);
        U.uCol.value.setRGB(0.42 + 0.3 * this.night, 0.52 + 0.3 * this.night, 0.78 + 0.3 * this.night);
      }
      const fogTarget = 0.4 + 0.6 * (storm ? 1 : this.ov) + (state.dayT < 0.12 ? 0.35 * (1 - state.dayT / 0.12) : 0);
      this.fogI += (fogTarget - this.fogI) * Math.min(1, dt * 0.5);
      const fc = this.view.scene && this.view.scene.fog ? this.view.scene.fog.color : null;
      const c = this.fogU.uCol.value; if (fc) { if (!this.white) this.white = new this.T.Color(1, 1, 1); c.copy(fc).lerp(this.white, 0.35); }
      this.fogU.uA.value = clamp(0.12 * this.fogI, 0.05, 0.26) * (0.8 + 0.4 * (1 - this.night));
      if (dt > 0) {
        const m = this.fogMesh, q = this.q4.identity();
        for (let i = 0; i < this.fogD.length; i++) {
          const d = this.fogD[i];
          d.x += (this.wx * 0.5 + 0.8) * d.sp * dt; d.z += this.wz * 0.3 * d.sp * dt;
          if (d.x > 125) { d.x = -125; d.z = rr(-65, 65); }
          this.m4.compose(this.v1.set(d.x, d.y, d.z), q.setFromAxisAngle(this.up, d.rot), this.sc.set(d.s, 1, d.s * d.sy)); m.setMatrixAt(i, this.m4);
        }
        m.instanceMatrix.needsUpdate = true;
      }
    }

    // ----- jellyfish and birds
    fauna(state, dt) {
      this.jellyU.uTime.value = this.t; this.jellyU.uNight.value = this.night; this.jellyU.uLite.value = this.lite;
      this.birdU.uTime.value = this.t;
      this.birdU.uCol.value.setRGB(0.07 + 0.05 * this.night, 0.08 + 0.05 * this.night, 0.11 + 0.08 * this.night);
      if (dt <= 0) return;
      const t = this.t, ships = state.ships || [], m4 = this.m4, q = this.q4, sc = this.sc, v = this.v1, up = this.up;
      // --- jellyfish
      const jg = 0.16 * sstep(0.1, 0.7, this.night);   // soft inner halo, one additive particle per jelly
      for (const s of this.swarms) {
        s.p += dt * 0.05;
        const wob = 9 * (1 + 0.2 * Math.sin(s.p * 5));
        s.x = s.ax + Math.sin(s.p * 2.1) * wob + (this.wx - 0.7) * 0.4 * Math.sin(s.p); s.z = s.az + Math.cos(s.p * 1.7 + 1) * wob * 0.7; s.y = s.ay + Math.sin(s.p * 3.3) * 1.2;
        for (const sh of ships) { const R = this.view.shipObj(sh.pid); if (!R) continue; const dx = s.x - R.group.position.x, dz = s.z - R.group.position.z, d = Math.hypot(dx, dz); if (d < 14 && d > 0.1) { s.ax += dx / d * (1 - d / 14) * 2.2 * dt; s.az += dz / d * (1 - d / 14) * 2.2 * dt; } }
        s.ax += (clamp(s.ax, -62, 62) - s.ax) * 0.5 * dt; s.az += (clamp(s.az, -38, 38) - s.az) * 0.5 * dt;
      }
      if (!this.jInit) { for (const j of this.jData) { const s = this.swarms[j.sw]; j.x = s.x + j.ox * 6; j.y = s.y + j.oy * 2; j.z = s.z + j.oz * 6; } this.jInit = true; }
      for (let i = 0; i < this.jData.length; i++) {
        const j = this.jData[i], s = this.swarms[j.sw];
        const tx = s.x + j.ox * 6 + Math.sin(t * 0.3 + j.ph) * 2.4, ty = s.y + j.oy * 2 + Math.sin(t * 0.5 + j.ph * 2) * 0.8, tz = s.z + j.oz * 6 + Math.cos(t * 0.27 + j.ph) * 2.4;
        j.vx += (tx - j.x) * 0.6 * dt; j.vy += (ty - j.y) * 0.6 * dt; j.vz += (tz - j.z) * 0.6 * dt;
        for (const sh of ships) {
          const R = this.view.shipObj(sh.pid); if (!R) continue;
          const dx = j.x - R.group.position.x, dz = j.z - R.group.position.z, d = Math.hypot(dx, dz);
          if (d < 9 && d > 0.05) { const f = (1 - d / 9) * 14 * dt; j.vx += dx / d * f; j.vz += dz / d * f; j.vy += (1 - d / 9) * 1.5 * dt; }
        }
        const dr = Math.max(0, 1 - 1.6 * dt); j.vx *= dr; j.vy *= dr; j.vz *= dr;
        j.x += j.vx * dt; j.y += j.vy * dt; j.z += j.vz * dt;
        const bob = Math.sin(t * 2.2 + j.ph) * 0.12, tilt = clamp(j.vx * 0.1, -0.4, 0.4), tz2 = clamp(j.vz * 0.1, -0.4, 0.4);
        this.eulJ.set(tz2, j.ph, -tilt, 'XYZ'); q.setFromEuler(this.eulJ);
        m4.compose(v.set(j.x, j.y + bob, j.z), q, sc.set(j.s, j.s, j.s)); this.jelly.setMatrixAt(i, m4);
        if (jg > 0.02) this.A.spawn(j.x, j.y + bob + 0.3, j.z, 0, 0, 0, Math.max(0.07, dt * 1.5), j.s * 1.7, j.s * 1.7, j.hue > 0.5 ? K.JELLY_B : K.JELLY_P, jg, j.hue > 0.5 ? K.JELLY_B : K.JELLY_P, jg, 0, 0, 0);
      }
      this.jelly.instanceMatrix.needsUpdate = true;
      // --- birds
      const roost = this.night > 0.75, visible = !roost;
      this.birdMesh.visible = visible;
      if (!visible) return;
      const islets = state.islets || [];
      for (let f = 0; f < this.flocks.length; f++) {
        const fl = this.flocks[f], il = islets.length ? islets[(f * 3 + 1) % islets.length] : null;
        const hx = il ? il.x : (f ? 40 : -40), hz = il ? il.y : (f ? -26 : 24);
        fl.cx = hx; fl.cz = hz; fl.cy = 9.5 + f * 1.5;
        if (!this.bInit) for (let i = 0; i < fl.n; i++) { const b = this.bData[fl.first + i]; b.x += hx; b.z += hz; b.y = fl.cy + rr(-1, 1); }
        let mx = 0, my = 0, mz = 0, mvx = 0, mvz = 0;
        for (let i = 0; i < fl.n; i++) { const b = this.bData[fl.first + i]; mx += b.x; my += b.y; mz += b.z; mvx += b.vx; mvz += b.vz; }
        mx /= fl.n; my /= fl.n; mz /= fl.n; mvx /= fl.n; mvz /= fl.n;
        const scat = this.now < fl.scatterUntil;
        for (let i = 0; i < fl.n; i++) {
          const b = this.bData[fl.first + i];
          let ax = (mx - b.x) * 0.25 + (mvx - b.vx) * 0.5, ay = (my - b.y) * 0.1, az = (mz - b.z) * 0.25 + (mvz - b.vz) * 0.5;
          for (let k = 0; k < fl.n; k++) { if (k === i - 0) continue; const o = this.bData[fl.first + k], dx = b.x - o.x, dz = b.z - o.z, dy = b.y - o.y, d2 = dx * dx + dz * dz + dy * dy; if (d2 < 2.6 && d2 > 0.0001) { const d = Math.sqrt(d2), s = (1.6 - d) * 6; ax += dx / d * s; ay += dy / d * s; az += dz / d * s; } }
          // circle the islet
          const rx = b.x - hx, rz = b.z - hz, rd = Math.hypot(rx, rz) || 1, w = scat ? 0.15 : 1;
          ax += (-rx / rd) * (rd - fl.R) * 1.4 * w + (-rz / rd) * -fl.dir * 4.5 * w * -1; az += (-rz / rd) * (rd - fl.R) * 1.4 * w + (rx / rd) * -fl.dir * 4.5 * w * -1;
          ay += (fl.cy + Math.sin(t * 0.7 + i) * 1.2 - b.y) * 1.2;
          for (const sh of ships) { const R = this.view.shipObj(sh.pid); if (!R) continue; const dx = b.x - R.group.position.x, dz = b.z - R.group.position.z, dy = b.y - R.group.position.y, d = Math.hypot(dx, dz, dy * 0.6); if (d < 9 && d > 0.1) { const s = (1 - d / 9) * 55; ax += dx / d * s; az += dz / d * s; ay += dy / d * s * 0.5; } }
          if (scat) { const dx = b.x - fl.sx, dz = b.z - fl.sz, d = Math.hypot(dx, dz) || 1; ax += dx / d * 28; az += dz / d * 28; ay += 6; }
          b.vx += ax * dt; b.vy += ay * dt; b.vz += az * dt;
          const sp = Math.hypot(b.vx, b.vy * 0.5, b.vz), vmax = scat ? 15 : 7.5, vmin = 4;
          if (sp > vmax) { const k = vmax / sp; b.vx *= k; b.vy *= k; b.vz *= k; } else if (sp < vmin && sp > 0.01) { const k = vmin / sp; b.vx *= k; b.vz *= k; }
          b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          if (b.y < 5) b.vy += 4 * dt;
          // orientation: nose (+x) along the velocity, banking into the turn
          const yaw = Math.atan2(-b.vz, b.vx), pitch = Math.atan2(b.vy, Math.hypot(b.vx, b.vz));
          this.eulB.set(clamp(-(ax * -b.vz + az * b.vx) / (sp * 40 + 1), -0.6, 0.6), yaw, pitch, 'YXZ');
          q.setFromEuler(this.eulB);
          m4.compose(v.set(b.x, b.y, b.z), q, sc.setScalar(1.35)); this.birdMesh.setMatrixAt(fl.first + i, m4);
        }
      }
      this.bInit = true;
      this.birdMesh.instanceMatrix.needsUpdate = true;
    }

    // ----- inhabitants
    inhabitants(state, dt) {
      const isl = this.isl, art = window.SkyfarersArt; if (!isl || !this.nodes || !art || !art.person) return;
      const slots = state.slots || [], now = this.now, iy = this.islandY(), B = this.B;
      // world scan (every ~0.35 s): burning slots, construction sites, working buildings, panic
      this.scan -= dt;
      if (this.scan <= 0) {
        this.scan = 0.35; this.fires.length = 0; this.sites.length = 0; let work = 0;
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i]; if (!s.kind) continue;
          if (s.fire > 0.12 && !s.ruined) this.fires.push(i);
          if (s.build < 1 && !s.ruined) this.sites.push(i);
          if (s.build >= 1 && !s.ruined && s.fire <= 0.25) work++;
        }
        this.nWork = work;
        let dragons = 0; for (const d of state.dragons || []) if (d.state !== 'flee') dragons++;
        if (dragons > 0) this.panicUntil = now + 2500;
        this.docked = 0; for (const sh of state.ships || []) if (sh.docked) this.docked++;
        if (this.docked > 0) this.dockWave = Math.max(this.dockWave, now + 600);
        this.assignBuckets();
      }
      const want = clamp(4 + 2 * this.nWork, 4, B.people);
      if (this.people.length < want && !this.sinkT0) this.addPerson();
      const cnt = this.sinkT0 != null ? 0 : want;
      const cheer = now < this.cheerUntil, panic = now < this.panicUntil, anim = this.pCarry;
      for (let i = 0; i < this.people.length; i++) {
        const p = this.people[i], on = i < cnt && iy > -1.5; p.art.group.visible = on; if (!on) continue;
        if (dt > 0) this.stepPerson(p, i, dt, cheer, panic);
        p.art.group.position.set(p.x, p.y + iy, p.z); p.art.group.rotation.y = -p.face;
        anim.walk = p.moving ? p.speed / 1.8 : 0; anim.carry = p.carry || p.job === 3; anim.cheer = p.cheering || p.job === 4; anim.panic = p.panicking;
        p.art.animate(this.t + p.ph, anim);
        if (this.night > 0.4 && dt > 0) this.glow(p.x, p.y + iy + 1.0, p.z, 1.1, 0.5 * sstep(0.4, 0.8, this.night), K.LANTERN, Math.max(0.07, dt * 1.5));
        if (p.carry && dt > 0) this.S.spawn(p.x, p.y + iy + 1.05, p.z, 0, 0, 0, 0.05, 0.42, 0.42, p.carryC, 1, p.carryC, 1, 0, 0, 0);
      }
    }
    addPerson() {
      const art = window.SkyfarersArt, i = this.people.length, cols = ['#4a90d9', '#d9534f', '#e0a030', '#5cb85c', '#9b59b6', '#e67e22', '#16a09a', '#d35d9a'];
      let a; try { a = art.person(this.T, { color: cols[i % cols.length], quality: this.quality }); } catch (e) { return; }
      a.group.scale.setScalar(2.6); a.group.visible = false; this.group.add(a.group);
      const n = Math.floor(rnd() * this.N), x = this.nodes[n][0], z = this.nodes[n][1];
      this.people.push({ art: a, x, z, y: this.nodeY[n], face: rnd() * TAU, speed: 1.7 * rr(0.88, 1.15), cur: n, dst: n, hasFinal: false, tx: x, tz: z, job: 0, phase: 0, wait: rr(0, 2), moving: false,
        carry: false, carryC: K.WOOD, cheering: false, panicking: false, ph: rnd() * 20, ox: rr(-0.3, 0.3), oz: rr(-0.3, 0.3), bucketIdx: -1, bx: 0, bz: 0, site: -1, until: 0 });
    }
    nearestNode(x, z) { let b = 0, bd = 1e9; for (let i = 0; i < this.N; i++) { const d = (this.nodes[i][0] - x) ** 2 + (this.nodes[i][1] - z) ** 2; if (d < bd) { bd = d; b = i; } } return b; }
    goNode(p, node, fx, fz) {
      p.dst = node; p.hasFinal = fx != null; p.tx = fx != null ? fx : this.nodes[node][0]; p.tz = fz != null ? fz : this.nodes[node][1];
      p.cur = this.nearestNode(p.x, p.z);
    }
    slotFront(slot, out) {                                  // a node next to a building and a standing point just before it
      const k = slot === 0 ? 3.0 : 6.9, sx = this.slotW[slot * 3], sz = this.slotW[slot * 3 + 2], d = Math.hypot(sx, sz) || 1;
      out.x = sx - (sx / d) * (slot === 0 ? 0 : 3.1) + (slot === 0 ? Math.cos(rnd() * TAU) * k : 0); out.z = sz - (sz / d) * (slot === 0 ? 0 : 3.1) + (slot === 0 ? Math.sin(rnd() * TAU) * k : 0);
      void k;
      return out;
    }
    assignBuckets() {
      // up to 5 inhabitants form a line from the pond to the burning slot (job 3)
      if (!this.people.length) return;
      if (!this.fires.length) { for (const p of this.people) if (p.job === 3) { p.job = 0; p.wait = 0; } return; }
      const slot = this.fires.reduce((a, b) => (this.sfire(a) >= this.sfire(b) ? a : b), this.fires[0]);
      const n = Math.min(this.fires.length > 1 ? 6 : 5, Math.floor(this.people.length * 0.75));
      const sx = 0, sz = -8.0, tx = this.slotW[slot * 3] * 0.8, tz = this.slotW[slot * 3 + 2] * 0.8;
      for (let k = 0; k < this.people.length; k++) {
        const p = this.people[k];
        if (k < n) {
          const u = (k + 0.5) / n; p.job = 3; p.bucketIdx = k; p.bx = lerp(sx, tx, u); p.bz = lerp(sz, tz, u); p.bslot = slot;
          if (!p.moving || p.bset !== slot) { this.goNode(p, this.nearestNode(p.bx, p.bz), p.bx, p.bz); p.bset = slot; }
        } else if (p.job === 3) { p.job = 0; p.wait = 0; }
      }
      this.bucketN = n; this.bucketSlot = slot;
    }
    sfire(i) { return this.lastState && this.lastState.slots[i] ? this.lastState.slots[i].fire : 0; }

    stepPerson(p, idx, dt, cheer, panic) {
      const now = this.now;
      p.cheering = false; p.panicking = false; p.moving = false;
      this.lastState = this.lastState || null;
      let spd = p.speed;
      // global moods override the job
      if (panic && p.job !== 3) { p.panicking = true; spd = 4.4; if (p.job !== 9 || (p.dst === p.cur && !p.hasFinal) || p.wait <= 0) { p.job = 9; p.wait = 0.9; this.goNode(p, Math.floor(rnd() * this.N)); p.hasFinal = false; } p.wait -= dt; }
      else if (p.job === 9) { p.job = 0; p.wait = rr(0, 1.5); }
      if (cheer && p.job !== 3 && this.cheerSlot >= 0 && !p.panicking) {
        if (p.job !== 4 && Math.hypot(p.x - this.slotW[this.cheerSlot * 3], p.z - this.slotW[this.cheerSlot * 3 + 2]) < 11) { p.job = 4; p.until = this.cheerUntil - rr(0, 700); const f = this.slotFront(this.cheerSlot, this.fr || (this.fr = { x: 0, z: 0 })); this.goNode(p, this.nearestNode(f.x, f.z), f.x + p.ox * 2, f.z + p.oz * 2); }
      } else if (p.job === 4 && now > p.until) { p.job = 0; p.wait = rr(0, 1); }
      // dock greeters
      if (p.job === 0 && now < this.dockWave && (idx & 3) === 1 && p.job !== 5) { p.job = 5; p.until = now + rr(2500, 4500); this.goNode(p, 1, this.nodes[1][0] + p.ox, this.nodes[1][1] - 1.2 - (idx % 3) * 0.5); }
      if (p.job === 5 && now > p.until) { p.job = 0; p.wait = rr(0.5, 2); }
      const moving = this.walkStep(p, spd, dt);
      p.moving = moving;
      if (p.job === 5 && !moving) { p.cheering = true; p.face += (Math.atan2(19.9 - p.z, 0.2 - p.x) - p.face) * Math.min(1, dt * 6); }
      if (p.job === 4 && !moving) p.cheering = true;
      if (p.job === 3 && !moving) {                        // standing in the bucket line
        p.face += (Math.atan2((p.bslot != null ? this.slotW[p.bslot * 3 + 2] : 0) - p.z, (p.bslot != null ? this.slotW[p.bslot * 3] : 0) - p.x) - p.face) * Math.min(1, dt * 5);
        if (p.bucketIdx === 0) this.bucketTick(dt);
      }
      if (p.job === 0 && !moving) {
        p.wait -= dt;
        if (p.wait <= 0) this.pickJob(p, idx);
      }
      if (p.job === 1 && !moving) this.carryStep(p);
      if (p.job === 2 && !moving) { p.wait -= dt; if (p.wait <= 0 || now > p.until) { p.job = 0; p.wait = rr(0.2, 1); } else p.face += Math.sin(this.t * 0.7 + idx) * dt * 0.8; }
    }
    bucketTick(dt) {                                       // buckets fly along the line once in a while
      this.bAcc = (this.bAcc || 0) + dt; if (this.bAcc < 0.55) return; this.bAcc = 0;
      const ps = []; for (const p of this.people) if (p.job === 3 && p.bucketIdx >= 0) ps[p.bucketIdx] = p;
      const iy = this.islandY(), n = this.bucketN || 0;
      for (let k = 0; k < n; k++) {
        const a = ps[k]; if (!a) continue; const b = ps[k + 1];
        const m = this.mover(4, k * 90, 0.38, a.x, a.y + iy + 0.9, a.z, b ? b.x : this.slotW[this.bucketSlot * 3], b ? b.y + iy + 0.9 : this.slotW[this.bucketSlot * 3 + 1] + 1.5, b ? b.z : this.slotW[this.bucketSlot * 3 + 2], 0.5, K.BUCKET);
        if (m) m.type = k === n - 1 ? 4 : 6;
      }
    }
    pickJob(p, idx) {
      const r = rnd();
      const free = this.fr || (this.fr = { x: 0, z: 0 });
      if (this.sites.length && (idx % 3) !== 2 && r < 0.85) {
        p.site = this.sites[Math.floor(rnd() * this.sites.length)]; p.job = 1; p.phase = 0; p.carry = false;
        this.goNode(p, 3, this.nodes[3][0] + p.ox * 0.5, this.nodes[3][1] + p.oz * 0.5); return;
      }
      if (this.nWork > 0 && r < 0.38) {                                          // stand at a working building
        const slots = this.lastSlots || []; void slots;
        const s = this.pickWorking(); if (s >= 0) { this.slotFront(s, free); p.job = 2; p.until = this.now + rr(5000, 11000); p.wait = rr(4, 9); this.goNode(p, this.nearestNode(free.x, free.z), free.x + p.ox, free.z + p.oz); return; }
      }
      p.job = 0; p.wait = rr(0.6, 3); this.goNode(p, Math.floor(rnd() * this.N)); p.hasFinal = false;
    }
    pickWorking() { const list = this.workList || (this.workList = []); list.length = 0; const st = this.lastState; if (st) for (let i = 0; i < st.slots.length; i++) { const s = st.slots[i]; if (s.kind && s.build >= 1 && !s.ruined && s.fire <= 0.25) list.push(i); } return list.length ? list[Math.floor(rnd() * list.length)] : -1; }
    carryStep(p) {
      if (!p.carry) {                                      // at the storehouse: pick up, then head to the site
        if (!this.sites.includes(p.site)) { p.job = 0; p.wait = 0.5; return; }
        p.carry = true; p.carryC = rnd() < 0.5 ? K.WOOD : K.WOOD_L;
        const f = this.slotFront(p.site, this.fr || (this.fr = { x: 0, z: 0 }));
        this.goNode(p, this.nearestNode(f.x, f.z), f.x + p.ox, f.z + p.oz);
      } else {                                             // at the site: drop the crate
        p.carry = false; const iy = this.islandY();
        this.puff(p.x, p.y + iy + 0.2, p.z, 2, 0.3, 0.6, 0.5, 1.3, 0.9, K.DUST, K.DUST, 0.45, 0.2, 0.3);
        if (rnd() < 0.5) this.chips(p.x, p.y + iy + 0.6, p.z, 2, 1);
        p.job = this.sites.includes(p.site) && rnd() < 0.6 ? 2 : 0; p.until = this.now + rr(1500, 3500); p.wait = rr(0.8, 2);
      }
    }
    walkStep(p, spd, dt) {                                 // advance along the path graph; returns true while moving
      let tx, tz;
      if (p.cur !== p.dst) {
        const nx = this.nxt[p.cur * this.N + p.dst];
        if (nx < 0) { p.cur = p.dst; return false; }
        tx = this.nodes[nx][0] + p.ox * (nx < 2 ? 0.2 : 1); tz = this.nodes[nx][1] + p.oz * (nx < 2 ? 0.2 : 1);
        if (this.stepTo(p, tx, tz, spd, dt, 0.25)) p.cur = nx;
        return true;
      }
      if (p.hasFinal) { if (this.stepTo(p, p.tx, p.tz, spd, dt, 0.12)) { p.hasFinal = false; return false; } return true; }
      return false;
    }
    stepTo(p, tx, tz, spd, dt, eps) {
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d < eps) return true;
      const s = Math.min(d, spd * dt);
      p.x += dx / d * s; p.z += dz / d * s;
      const want = Math.atan2(dz, dx); let df = want - p.face; df = Math.atan2(Math.sin(df), Math.cos(df)); p.face += df * Math.min(1, dt * 10);
      const r = Math.hypot(p.x, p.z); p.y = r > 15 ? -0.2 : this.hOf(p.x, p.z);
      return d - s < eps;
    }

    // ---------------------------------------------------------------- lifecycle
    setQuality(q) {
      q = q === 'low' ? 'low' : 'high'; if (q === this.quality && this.S) return;
      this.quality = q;
      try { this.destroy(); } catch (e) { /* ignore */ }
      this.build();
    }
    dispose() {
      try { this.destroy(); } catch (e) { /* ignore */ }
      if (this.group.parent) this.group.parent.remove(this.group);
    }
  }

  // keep the latest state for the inhabitants' queries without extra arguments
  const origUpdate = SkyfarersFx.prototype.update;
  SkyfarersFx.prototype.update = function (state, alpha, opts) { this.lastState = state; return origUpdate.call(this, state, alpha, opts); };
  window.SkyfarersFx = SkyfarersFx;
})();
