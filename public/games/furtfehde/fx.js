// ===== Furt & Fehde fx: the life of the war (docs/FURTFEHDE.md "Fx (fx.js) and sound (sound.js)") =====
// The view (render.js) creates `new FurtFx(THREE, { scene, camera, quality, view })` in setWorld and calls
//   fx.event(ev, state)      every sim event, as it comes out of sim.step()
//   fx.update(state, alpha, { now (ms), dt (s), dayT, sunDir })   once per rendered frame, before the draw
//   fx.pass(camera, viewportHeightPx)   before each scene pass (main and Kampf-Kamera inset): point sizes follow the camera
//   fx.setWorld(world) (new match) · fx.setQuality(q) · fx.setEnabled(bool) · fx.dispose()
// Everything is pooled, nothing is allocated per frame in steady state. Draw calls: 4 on high and on low (budget 8 / 6):
//   S soft alpha Points (smoke, dust, flames, foam, droplets, chips)    A additive Points (sparks, embers, glow, coins, glitter)
//   Q one dynamic quad mesh (CPU-built every frame): arrows, debris, flying fish, ripples and shock rings, order arrows, crossing sweeps,
//     pact arcs, driftwood, birds, 💤 signs      D one InstancedMesh of protection domes (one instance per house with prot > 0)
// What it draws, by source:
//   events   shot (arrows on arcs) clash hit death ignite fireOut cropBurnt bucket ruined build rebuild buildDone chop harvest sow order
//            plunder protEnd crossingOpen pactOn pactOff crown attack (bird flocks flush from fights)
//   state    burning buildings (flames, smoke, embers, glow; replaces the view's stand-in), smouldering ruins, construction dust and chips,
//            chimney smoke, damage smoke (a badly damaged keep also crumbles: grey dust and falling stone chips; orange is for real fire only), wading units
//            (splashes, foam, ripples), protection domes (lords[].prot), Zorn embers (lords[].zorn),
//            a 💤 sign above every resting workplace (buildings[].paused: by order, buildings[].full: its store is full): a billboard badge with a procedural „Zzz“, one quad each, no texture
//   world    driftwood on the flood, rare fish jumps, bird flocks, the water level (land.surf)
// Handles used from the view: view.land (standY, surf, waterDepth), view.world, view.buildingObj(id), view.keepObj(lord), view.colorOf(lord),
// view.cur (light). No art handle is cached across frames (setQuality recreates every actor object).
(function () {
  'use strict';

  // ---------------------------------------------------------------- budgets (one constant each, tuned by measuring)
  const BUDGET = {
    high: { soft: 3200, add: 1800, quads: 1100, rings: 150, bits: 130, orders: 12, logs: 14, birds: [6, 6, 5, 5], density: 1.0 },
    low:  { soft: 1100, add: 560,  quads: 560,  rings: 64,  bits: 56,  orders: 8,  logs: 6,  birds: [5, 5],       density: 0.45 }
  };
  const DOME_R = 7.8, DOME_H = 1.3;      // protection dome: radius and height factor (keep tower ~9 high)
  const SIGN_R = 2.3;                     // 💤 sign: half its width in world units (≈ 60 px on a 1920 px wide picture, readable from the sofa)
  const SIM_HZ = 15;                      // sim steps per second (u.x - u.px is one step)

  const TAU = Math.PI * 2, rnd = Math.random;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), lerp = (a, b, t) => a + (b - a) * t;
  const rr = (a, b) => a + (b - a) * rnd();
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const FW = () => window.FurtWorld;

  // ---------------------------------------------------------------- palette (linear rgb, values above 1 glow when additive)
  const K = { FLAME_HOT: 0, FLAME: 1, FLAME_END: 2, EMBER: 3, SMOKE_D: 4, SMOKE_M: 5, SMOKE_L: 6, WHITE: 7, WATER: 8, WATER_HI: 9, SPARK: 10, DUST: 11,
    WOOD: 12, WOOD_L: 13, LEAF: 14, GOLD: 15, GOLD_S: 16, STEAM: 17, SOOT: 18, GRAIN: 19, SOIL: 20, FOAM: 21, ALERT: 22, GLITTER: 23, STEEL: 24, SILVER: 25, DOMEG: 26, STONE: 27, STONE_L: 28, LORD: 32 };
  const PAL = new Float32Array(40 * 3);
  [
    [2.6, 0.95, 0.07], [2.6, 0.24, 0.012], [0.85, 0.025, 0.0], [3.0, 0.8, 0.1],         // 0 flame hot, 1 flame, 2 flame end, 3 ember (ACES + sRGB: orange needs little green)
    [0.17, 0.155, 0.15], [0.34, 0.32, 0.31], [0.66, 0.66, 0.68], [1, 1, 1],          // 4 smoke dark, 5 smoke mid, 6 smoke light, 7 white
    [0.55, 0.78, 0.95], [1.8, 2.4, 2.8], [3.2, 2.2, 0.8], [0.88, 0.78, 0.58],        // 8 water, 9 water hi, 10 spark, 11 dust
    [0.42, 0.24, 0.10], [0.85, 0.5, 0.15], [0.25, 0.7, 0.18], [3.0, 1.7, 0.25],      // 12 wood, 13 wood light, 14 leaf, 15 gold (additive)
    [0.9, 0.62, 0.08], [0.92, 0.94, 0.97], [0.05, 0.045, 0.04], [0.85, 0.65, 0.2],   // 16 gold soft, 17 steam, 18 soot, 19 grain
    [0.26, 0.17, 0.10], [0.95, 0.97, 1.0], [2.4, 0.1, 0.06], [2.2, 1.9, 1.2],         // 20 soil, 21 foam, 22 alert red, 23 glitter
    [0.75, 0.78, 0.82], [0.8, 0.88, 0.95], [1.0, 0.86, 0.5],                         // 24 steel, 25 silver, 26 dome gold
    [0.4, 0.39, 0.38], [0.6, 0.58, 0.55]                                             // 27 stone chip, 28 stone chip light (neutral greys: a crumbling wall is never orange)
  ].forEach((c, i) => { PAL[i * 3] = c[0]; PAL[i * 3 + 1] = c[1]; PAL[i * 3 + 2] = c[2]; });

  const SOFTK = new Uint8Array(40); [K.SMOKE_D, K.SMOKE_M, K.SMOKE_L, K.STEAM, K.DUST, K.SOOT, K.FOAM, K.SOIL, K.GRAIN].forEach((k) => { SOFTK[k] = 1; });

  // ---------------------------------------------------------------- shaders
  // Point sprites: size in world units -> px via uPx (px per unit at depth 1, set per pass), capped by the GPU's maximum point size.
  const PT_VS = `
    uniform float uPx, uMax; attribute vec4 aCol; attribute float aSize; attribute float aSeed; varying vec4 vCol; varying float vSeed;
    void main() {
      vCol = aCol; vSeed = aSeed; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(aSize * uPx / max(-mv.z, 0.5), 1.0, uMax);
      if (aSize <= 0.0) gl_Position = vec4(3.0, 3.0, 3.0, 1.0);
    }`;
  const PT_FS_ADD = `
    varying vec4 vCol; varying float vSeed;
    void main() {
      vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c); if (r2 > 1.0) discard;
      float a = exp(-r2 * 2.8) * (1.0 - r2 * r2);
      gl_FragColor = vec4(vCol.rgb, vCol.a * a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  // soft billowy disc: the edge wobbles with a per-particle seed, the side facing the sun is a little brighter
  const PT_FS_SOFT = `
    uniform vec2 uLit; varying vec4 vCol; varying float vSeed;
    void main() {
      vec2 c = gl_PointCoord * 2.0 - 1.0; float r = length(c); if (r > 1.0) discard;
      float ang = atan(c.y, c.x);
      float sf = floor(vSeed), sd = vSeed - sf;      // sf 1 = billowy smoke / dust / foam, 0 = crisp (flames, droplets, chips)
      r += (0.1 - 0.05 * sf) * sin(ang * 3.0 + sd * 40.0) + (0.06 - 0.03 * sf) * sin(ang * 5.0 - sd * 23.0 + 1.3) - 0.04;
      float a = mix(smoothstep(1.0, 0.18, r), pow(smoothstep(1.0, 0.0, r), 1.35), sf);
      float lit = 0.88 + 0.2 * dot(c, uLit) * (1.0 - r * 0.4);
      gl_FragColor = vec4(vCol.rgb * lit, vCol.a * a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  // the dynamic quad mesh: one shader, the quad kind picks the pattern
  //  0 streak (arrows, fish): u 0 tail .. 1 head, v across     1 flat solid with soft ends (logs, debris, birds)
  //  2 ring (ripples, shock rings): uv -1..1, p = progress     3 dashed order arrow: u = world distance along, v across
  //  4 sweep glow (crossing opens): uv -1..1                   5 arrow head triangle: u 0 base .. 1 tip, v across
  //  6 💤 sign: a dark round badge with a bold Z and two small z that drift up: uv -1..1 (y up), p = the sign's phase
  const Q_VS = `
    attribute vec2 aUV; attribute vec4 aCol; attribute vec2 aK; varying vec2 vUV; varying vec4 vCol; varying vec2 vK;
    void main() { vUV = aUV; vCol = aCol; vK = aK; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const Q_FS = `
    uniform float uTime; varying vec2 vUV; varying vec4 vCol; varying vec2 vK;
    float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
    // distance to a "Z" of half-size s centred at c (top bar, diagonal, bottom bar), in the sign's uv units
    float zDist(vec2 p, vec2 c, float s) {
      vec2 q = (p - c) / s;
      return min(sdSeg(q, vec2(-0.55, 0.62), vec2(0.55, 0.62)), min(sdSeg(q, vec2(0.55, 0.62), vec2(-0.55, -0.62)), sdSeg(q, vec2(-0.55, -0.62), vec2(0.55, -0.62)))) * s;
    }
    void main() {
      float kind = vK.x, p = vK.y; vec3 col = vCol.rgb; float a = vCol.a;
      if (kind < 0.5) {
        a *= (1.0 - smoothstep(0.5, 1.0, abs(vUV.y))) * smoothstep(0.0, 0.8, vUV.x);
        col = mix(col, vec3(1.0, 0.97, 0.88), smoothstep(0.8, 0.97, vUV.x) * 0.8);
      } else if (kind < 1.5) {
        a *= (1.0 - smoothstep(0.55, 1.0, abs(vUV.y))) * (1.0 - smoothstep(0.75, 1.0, abs(vUV.x)));
      } else if (kind < 2.5) {
        float r = length(vUV), rad = mix(0.3, 0.94, p), w = mix(0.2, 0.06, p);
        a *= (1.0 - smoothstep(0.0, w, abs(r - rad))) * (1.0 - p * p) * (1.0 - smoothstep(0.9, 1.0, r));
      } else if (kind < 3.5) {
        float d = fract((vUV.x - uTime * 2.4) / 2.6);
        float dash = smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.62, 0.7, d));
        float ed = smoothstep(0.5, 1.0, abs(vUV.y));
        col = mix(col, col * 0.16, ed * 0.85);
        a *= dash * (1.0 - smoothstep(0.82, 1.0, abs(vUV.y))) * smoothstep(0.0, 2.5, vUV.x);
      } else if (kind < 4.5) {
        float g = exp(-vUV.x * vUV.x * 2.4) * (1.0 - smoothstep(0.62, 1.0, abs(vUV.y)));
        float tw = 0.72 + 0.28 * sin(vUV.y * 11.0 + uTime * 6.0) * sin(vUV.x * 6.0 - uTime * 4.0);
        a *= g * tw;
        col = mix(col, vec3(1.0), 0.4 * g);
      } else if (kind < 5.5) {
        float ed = abs(vUV.y) - (1.0 - vUV.x);
        if (ed > 0.0) discard;
        col = mix(col, col * 0.16, smoothstep(-0.28, 0.0, ed) * 0.85);
        a *= 1.0 - smoothstep(-0.06, 0.0, ed) * 0.0;
      } else {
        float r = length(vUV);
        float disc = 1.0 - smoothstep(0.93, 0.99, r);
        if (disc <= 0.0) discard;
        float ph = uTime * 0.9 + p * 6.2831;
        float aa = 0.035;
        // the big Z, and two small z that swell and fade one after the other
        float big = 1.0 - smoothstep(0.115 - aa, 0.115 + aa, zDist(vUV, vec2(-0.2, -0.16), 0.40));
        float k1 = 0.55 + 0.45 * sin(ph), k2 = 0.55 + 0.45 * sin(ph - 1.5);
        float mid = (1.0 - smoothstep(0.078 - aa, 0.078 + aa, zDist(vUV, vec2(0.34, 0.2), 0.25))) * k1;
        float sml = (1.0 - smoothstep(0.056 - aa, 0.056 + aa, zDist(vUV, vec2(0.6, 0.55), 0.16))) * k2;
        float ink = max(big, max(mid, sml));
        float rim = smoothstep(0.80, 0.87, r);
        vec3 body = mix(vec3(0.016, 0.032, 0.11), vec3(0.05, 0.08, 0.22), 0.5 - 0.5 * vUV.y);   // dark navy, a little lighter at the bottom
        col = mix(body, vec3(0.55, 0.78, 1.45), rim);
        col = mix(col, vec3(1.5, 1.7, 2.0), ink);
        a *= disc * 0.96;
      }
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const DOME_VS = `
    attribute vec4 aTint; attribute float aPh; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec4 vTint; varying float vPh;
    void main() {
      mat4 im = mat4(1.0);
      #ifdef USE_INSTANCING
      im = instanceMatrix;
      #endif
      vec4 mv = modelViewMatrix * im * vec4(position, 1.0);
      vN = normalize(mat3(modelViewMatrix) * mat3(im) * normal); vV = normalize(-mv.xyz); vP = position; vTint = aTint; vPh = aPh;
      gl_Position = projectionMatrix * mv;
    }`;
  const DOME_FS = `
    uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec4 vTint; varying float vPh;
    void main() {
      float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
      float h = vP.y, ang = atan(vP.z, vP.x);
      float band = 0.5 + 0.5 * sin(h * 14.0 - uTime * 1.7 + vPh);
      float cell = max(abs(cos(ang * 9.0 + uTime * 0.2)), abs(cos(h * 7.0 + 0.3)));
      float grid = smoothstep(0.93, 1.0, cell) * (0.35 + 0.65 * band);
      float a = (0.03 + 0.6 * fr + 0.16 * band * fr + 0.34 * grid) * vTint.a * (0.7 + 0.3 * smoothstep(0.0, 0.25, h));
      vec3 col = mix(vTint.rgb, vec3(1.0, 0.9, 0.55), 0.45 + 0.35 * fr) * (0.9 + 0.9 * fr);
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  // ---------------------------------------------------------------- particle system (CPU sim, one Points draw)
  class PSys {
    constructor(T, n, additive, renderOrder, uni) {
      this.n = n; this.i = 0; this.hw = 0; this.alive = 0; this.soft = !additive;
      this.lite = 1;      // billowy sprites (smoke, dust, foam) darken with the light at dusk; flames and sparks glow regardless
      this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n); this.seed = new Float32Array(n);
      this.vel = new Float32Array(n * 3); this.age = new Float32Array(n); this.life = new Float32Array(n);
      this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.c0 = new Float32Array(n * 4); this.c1 = new Float32Array(n * 4);
      this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.wk = new Float32Array(n);
      const g = this.geo = new T.BufferGeometry();
      this.aPos = new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage); this.aCol = new T.BufferAttribute(this.col, 4).setUsage(T.DynamicDrawUsage);
      this.aSize = new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage); this.aSeed = new T.BufferAttribute(this.seed, 1).setUsage(T.DynamicDrawUsage);
      g.setAttribute('position', this.aPos); g.setAttribute('aCol', this.aCol); g.setAttribute('aSize', this.aSize); g.setAttribute('aSeed', this.aSeed);
      this.attrs = [this.aPos, this.aCol, this.aSize, this.aSeed];
      this.mat = new T.ShaderMaterial({ vertexShader: PT_VS, fragmentShader: additive ? PT_FS_ADD : PT_FS_SOFT, uniforms: uni, transparent: true, depthWrite: false,
        blending: additive ? T.AdditiveBlending : T.NormalBlending, fog: false });
      this.mesh = new T.Points(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder; this.mesh.visible = false;
    }
    // colour keys ci0 -> ci1 (palette indices), alpha a0 -> a1, size s0 -> s1 over `life`; drag per second, grav (negative = buoyant), wk = wind coupling
    spawn(x, y, z, vx, vy, vz, life, s0, s1, ci0, a0, ci1, a1, drag, grav, wk) {
      const k = this.i; this.i = k + 1 >= this.n ? 0 : k + 1; if (k + 1 > this.hw) this.hw = k + 1;
      const p = k * 3, c = k * 4, o0 = ci0 * 3, o1 = ci1 * 3, Ls = SOFTK[ci0] ? this.lite : 1, Le = SOFTK[ci1] ? this.lite : 1;
      this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z; this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
      this.age[k] = 0; this.life[k] = life > 0.01 ? life : 0.01; this.s0[k] = s0; this.s1[k] = s1; this.size[k] = s0; this.seed[k] = rnd() * 0.98 + SOFTK[ci0];
      this.c0[c] = PAL[o0] * Ls; this.c0[c + 1] = PAL[o0 + 1] * Ls; this.c0[c + 2] = PAL[o0 + 2] * Ls; this.c0[c + 3] = a0;
      this.c1[c] = PAL[o1] * Le; this.c1[c + 1] = PAL[o1 + 1] * Le; this.c1[c + 2] = PAL[o1 + 2] * Le; this.c1[c + 3] = a1;
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
        let al = c0[c + 3] + (c1[c + 3] - c0[c + 3]) * u; if (soft && u < 0.12) al *= u / 0.12; col[c + 3] = al;
      }
      this.alive = alive; this.mesh.visible = alive > 0;
      if (alive > 0) {
        const n = this.hw; this.geo.setDrawRange(0, n);
        for (let i = 0; i < 4; i++) { const at = this.attrs[i]; at.clearUpdateRanges(); at.addUpdateRange(0, n * at.itemSize); at.needsUpdate = true; }
      }
    }
    clear() { this.life.fill(0); this.size.fill(0); this.hw = 0; this.i = 0; this.alive = 0; this.mesh.visible = false; }
    dispose() { this.geo.dispose(); this.mat.dispose(); if (this.mesh.parent) this.mesh.parent.remove(this.mesh); }
  }

  // ---------------------------------------------------------------- the dynamic quad mesh (rebuilt on the CPU every frame)
  class QuadMesh {
    constructor(T, cap, uni) {
      this.cap = cap; this.nq = 0;
      this.pos = new Float32Array(cap * 12); this.uv = new Float32Array(cap * 8); this.col = new Float32Array(cap * 16); this.kk = new Float32Array(cap * 8);
      const idx = new Uint16Array(cap * 6);
      for (let q = 0; q < cap; q++) { const v = q * 4, o = q * 6; idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3; }
      const g = this.geo = new T.BufferGeometry();
      this.aPos = new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage); this.aUV = new T.BufferAttribute(this.uv, 2).setUsage(T.DynamicDrawUsage);
      this.aCol = new T.BufferAttribute(this.col, 4).setUsage(T.DynamicDrawUsage); this.aK = new T.BufferAttribute(this.kk, 2).setUsage(T.DynamicDrawUsage);
      g.setAttribute('position', this.aPos); g.setAttribute('aUV', this.aUV); g.setAttribute('aCol', this.aCol); g.setAttribute('aK', this.aK);
      g.setIndex(new T.BufferAttribute(idx, 1));
      this.attrs = [this.aPos, this.aUV, this.aCol, this.aK];
      this.mat = new T.ShaderMaterial({ vertexShader: Q_VS, fragmentShader: Q_FS, uniforms: uni, transparent: true, depthWrite: false, side: T.DoubleSide, fog: false });
      this.mesh = new T.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 9; this.mesh.visible = false;
      g.setDrawRange(0, 0);
    }
    reset() { this.nq = 0; }
    // corners 0..3 in order around the quad (positions + uv), one colour and one (kind, param) per quad
    q(x0, y0, z0, u0, v0, x1, y1, z1, u1, v1, x2, y2, z2, u2, v2, x3, y3, z3, u3, v3, r, g, b, a, kind, p) {
      if (this.nq >= this.cap) return false;
      const n = this.nq++, P = this.pos, U = this.uv, C = this.col, Kk = this.kk, o = n * 12, ou = n * 8, oc = n * 16;
      P[o] = x0; P[o + 1] = y0; P[o + 2] = z0; P[o + 3] = x1; P[o + 4] = y1; P[o + 5] = z1; P[o + 6] = x2; P[o + 7] = y2; P[o + 8] = z2; P[o + 9] = x3; P[o + 10] = y3; P[o + 11] = z3;
      U[ou] = u0; U[ou + 1] = v0; U[ou + 2] = u1; U[ou + 3] = v1; U[ou + 4] = u2; U[ou + 5] = v2; U[ou + 6] = u3; U[ou + 7] = v3;
      for (let j = 0; j < 4; j++) { C[oc + j * 4] = r; C[oc + j * 4 + 1] = g; C[oc + j * 4 + 2] = b; C[oc + j * 4 + 3] = a; Kk[ou + j * 2] = kind; Kk[ou + j * 2 + 1] = p; }
      return true;
    }
    flush() {
      const n = this.nq; this.mesh.visible = n > 0;
      if (!n) return;
      this.geo.setDrawRange(0, n * 6);
      for (let i = 0; i < 4; i++) { const at = this.attrs[i]; at.clearUpdateRanges(); at.addUpdateRange(0, n * 4 * at.itemSize); at.needsUpdate = true; }
    }
    dispose() { this.geo.dispose(); this.mat.dispose(); if (this.mesh.parent) this.mesh.parent.remove(this.mesh); }
  }

  // chimney anchors exist on these kinds (art.js); a thin smoke thread rises while they stand finished
  const CHIMNEY = { huette: 1.0, hof: 0.9, holzfaeller: 0.7, kaserne: 1.2 };
  const STONE = { kaserne: 1, wachturm: 1, brunnen: 1, bergfried: 1 };

  // ---------------------------------------------------------------- the fx class
  class FurtFx {
    constructor(THREE, opts) {
      const T = this.T = THREE; this.scene = opts.scene; this.camera = opts.camera; this.view = opts.view;
      this.quality = opts.quality === 'low' ? 'low' : 'high';
      this.enabled = true; this.world = null; this.land = null; this.frame = 0;
      this.group = new T.Group(); this.group.name = 'fx'; this.scene.add(this.group);
      this.U = { uPx: { value: 1000 }, uMax: { value: 256 }, uTime: { value: 0 }, uLit: { value: new T.Vector2(0.4, 0.8) } };
      try { const gl = this.view.renderer.getContext(), r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE); this.U.uMax.value = Math.min(r[1] || 64, 512); } catch (e) { /* default */ }
      this.v1 = new T.Vector3(); this.v2 = new T.Vector3(); this.v4 = new T.Vector3(); this.m4 = new T.Matrix4(); this.col = new T.Color();
      this.G = { cx: 0, cz: 0, gy: 0, th: 0, lw: 2, ld: 2, h: 2.4 };         // scratch: world geometry of one building
      this.now = 0; this.t = 0; this.dt = 0.016; this.night = 0; this.wx = 0.7; this.wz = 0.25; this.evBudget = 20;
      this.pend = []; this.kindH = new Map(); this.brecs = new Map(); this.lordCol = [0, 1, 2, 3].map(() => [1, 1, 1]);
      this.nWade = 0; this.nFight = 0; this.passCam = this.camera; this.dome = []; this.protOf = [0, 0, 0, 0]; this.lordHex = [null, null, null, null];
      this.build();
      if (this.view.world) this.setWorld(this.view.world);
    }

    // ----- construction of everything quality dependent
    build() {
      const T = this.T, B = BUDGET[this.quality], U = this.U;
      this.B = B; this.dn = B.density;
      this.S = new PSys(T, B.soft, false, 11, U); this.A = new PSys(T, B.add, true, 12, U);
      this.Q = new QuadMesh(T, B.quads, U);
      // protection domes: an upper hemisphere, instanced (4 houses at most)
      const hg = new T.SphereGeometry(1, 40, 20, 0, TAU, 0, Math.PI / 2);
      this.tint = new T.InstancedBufferAttribute(new Float32Array(4 * 4), 4).setUsage(T.DynamicDrawUsage); this.tph = new T.InstancedBufferAttribute(new Float32Array(4), 1);
      hg.setAttribute('aTint', this.tint); hg.setAttribute('aPh', this.tph);
      this.domeMat = new T.ShaderMaterial({ vertexShader: DOME_VS, fragmentShader: DOME_FS, uniforms: { uTime: U.uTime }, transparent: true, depthWrite: false, side: T.DoubleSide,
        blending: T.AdditiveBlending, fog: false });
      this.domeMesh = new T.InstancedMesh(hg, this.domeMat, 4); this.domeMesh.frustumCulled = false; this.domeMesh.count = 0; this.domeMesh.visible = false; this.domeMesh.renderOrder = 10;
      this.domeMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.group.add(this.S.mesh, this.A.mesh, this.Q.mesh, this.domeMesh);
      const mk = (n, f) => { const a = []; for (let i = 0; i < n; i++) a.push(f()); return a; };
      this.rings = mk(B.rings, () => ({ live: false, x: 0, y: 0, z: 0, t0: 0, life: 1, r0: 1, r1: 2, r: 1, g: 1, b: 1, a: 1 })); this.ringI = 0;
      this.bits = mk(B.bits, () => ({ live: false, kind: 0, t0: 0, life: 1, sx: 0, sy: 0, sz: 0, ex: 0, ey: 0, ez: 0, H: 1, len: 1.6, wid: 0.14, r: 1, g: 1, b: 1, vx: 0, vy: 0, vz: 0, yaw: 0, spin: 0, gy: 0, x: 0, y: 0, z: 0, landed: 0, src: 0 })); this.bitI = 0;
      this.orders = mk(B.orders, () => ({ live: false, lord: 0, n: 0, bid: -1, t0: 0, sx: 0, sy: 0, tx: 0, ty: 0, r: 1, g: 1, b: 1 }));
      this.sweeps = mk(4, () => ({ live: false, t0: 0, dur: 2.4, ax: 0, az: 0, bx: 0, bz: 0, wid: 5, kind: 0 }));
      this.arcs = mk(4, () => ({ live: false, t0: 0, ax: 0, az: 0, ay: 0, bx: 0, bz: 0, by: 0, h: 16, ar: 1, ag: 1, ab: 1, br: 1, bg: 1, bb: 1 }));
      this.logs = mk(B.logs, () => ({ live: false, x: 0, z: 0, yaw: 0, ph: 0, a: 0, wait: rr(0, 6), len: 2.6 }));
      this.flocks = []; this.birds = []; this.nextFish = 4; this.sinceClean = 0;
      this.dome = [0, 1, 2, 3].map(() => ({ k: 0, t0: 0 }));
      this.zornAcc = [0, 0, 0, 0];
      if (this.world) this.initWorldData();
    }
    destroy() {
      for (const o of [this.S, this.A, this.Q]) if (o) o.dispose();
      if (this.domeMesh) { this.domeMesh.geometry.dispose(); this.domeMat.dispose(); this.domeMesh.dispose && this.domeMesh.dispose(); if (this.domeMesh.parent) this.domeMesh.parent.remove(this.domeMesh); }
      this.S = this.A = this.Q = this.domeMesh = null;
    }

    // ----- world dependent set-up (new match / quality switch): bird homes, crossing lookup
    setWorld(world) {
      this.world = world || null; this.land = this.view.land || null;
      this.kindH.clear(); this.brecs.clear();
      if (!this.S) return;
      this.S.clear(); this.A.clear(); this.pend.length = 0;
      for (const o of this.orders) o.live = false;
      for (const o of this.sweeps) o.live = false;
      for (const o of this.arcs) o.live = false;
      for (const o of this.rings) o.live = false;
      for (const o of this.bits) o.live = false;
      for (const o of this.logs) { o.live = false; o.wait = rr(0, 6); }
      this.initWorldData();
    }
    initWorldData() {
      const w = this.world; this.flocks = []; this.birds = []; this.cross = new Map();
      if (!w) return;
      for (const c of w.crossings) this.cross.set(c.id, c);
      // bird flocks live above the forests: homes are drawn from the world's trees inside the playable map
      const cand = []; w.trees.forEach((t, i) => { if (t.k >= 0 && t.kind !== 'weide') cand.push(i); });
      const sizes = this.B.birds;
      for (let f = 0; f < sizes.length; f++) {
        const home = cand.length ? w.trees[cand[Math.floor(((f + 0.5) / sizes.length + rr(-0.12, 0.12)) * cand.length) % cand.length]] : { x: rr(-40, 40), y: rr(-30, 30) };
        const fl = { first: this.birds.length, n: sizes[f], hx: home.x, hz: home.y, R: 5 + 1.5 * f, dir: f % 2 ? -1 : 1, scatterUntil: 0, sx: 0, sz: 0, ph: rr(0, TAU) };
        for (let i = 0; i < fl.n; i++) {
          const a = rnd() * TAU, r = fl.R * rr(0.6, 1.2);
          this.birds.push({ x: fl.hx + Math.cos(a) * r, y: 11 + rr(-1.5, 2), z: fl.hz + Math.sin(a) * r, vx: 0, vy: 0, vz: 0, ph: rnd() * TAU, f });
        }
        this.flocks.push(fl);
      }
    }

    setQuality(q) {
      q = q === 'low' ? 'low' : 'high'; if (q === this.quality && this.S) return;
      this.quality = q;
      try { this.destroy(); } catch (e) { /* ignore */ }
      this.build();
      if (this.view.world) this.setWorld(this.view.world);
    }
    // off: nothing is simulated or drawn (the harness toggle; also a cheap way to measure the cost of the fx)
    setEnabled(on) {
      this.enabled = !!on; this.group.visible = this.enabled;
      if (!this.enabled && this.S) { this.S.clear(); this.A.clear(); this.Q.reset(); this.Q.flush(); this.domeMesh.count = 0; this.domeMesh.visible = false; this.pend.length = 0; }
    }
    // before each scene pass: point sprites scale with the viewport height and the projection of the camera that renders next
    pass(camera, vpH) {
      this.passCam = camera || this.camera;
      this.U.uPx.value = (vpH || this.view.H) * 0.5 * this.passCam.projectionMatrix.elements[5];
      const v = this.v4.copy(this.view.sunDir).transformDirection(this.passCam.matrixWorldInverse);   // sun direction in view space -> screen (y down in point coords)
      const l = Math.hypot(v.x, v.y) || 1; this.U.uLit.value.set(v.x / l, -v.y / l);
    }
    dispose() {
      try { this.destroy(); } catch (e) { /* ignore */ }
      if (this.group.parent) this.group.parent.remove(this.group);
    }
    get stats() { return { soft: this.S ? this.S.alive : 0, add: this.A ? this.A.alive : 0, quads: this.Q ? this.Q.nq : 0, domes: this.domeMesh ? this.domeMesh.count : 0, calls: this.drawCalls() }; }
    drawCalls() { return (this.enabled && this.S ? (this.S.mesh.visible ? 1 : 0) + (this.A.mesh.visible ? 1 : 0) + (this.Q.mesh.visible ? 1 : 0) + (this.domeMesh.visible ? 1 : 0) : 0); }

    // ----- helpers -------------------------------------------------------------------------------------------------------
    emit(rate, dt) { const x = rate * dt; let n = x | 0; if (rnd() < x - n) n++; return n; }   // stochastic rounding: no per-emitter accumulators
    cnt(n) { return Math.max(1, Math.round(n * Math.max(0.5, this.dn))); }
    gy(x, y) { return this.land ? this.land.standY(x, y) : 0; }
    wy(x, y) { const h = this.land.standY(x, y), s = this.land.surf; return h > s ? h : s; }       // top of the ground or of the water over it
    wet(x, y) { return this.land ? this.land.surf - this.land.standY(x, y) : -1; }
    later(ms, fn) { this.pend.push({ at: this.now + ms, fn }); }
    lordRGB(l) { const c = this.lordCol[l & 3]; return c; }
    // building geometry in the view's frame (position and yaw of its group), model-local half extents, top height
    geom(b, o) {
      const obj = b.kind === 'bergfried' ? this.view.keepObj(b.lord) : this.view.buildingObj(b.id); if (!obj) return null;
      const g = obj.group; o.cx = g.position.x; o.cz = g.position.z; o.gy = g.position.y; o.th = g.rotation.y; o.obj = obj;
      let ki = this.kindH.get(b.kind);
      if (!ki) {      // per kind, once: model-local footprint and the height of the finished model
        const fp = b.kind === 'bergfried' ? [6, 6] : FW().footprintOf(b.kind, 0);
        ki = { lw: fp[0], ld: fp[1], h: b.kind === 'bergfried' ? 9 : 2.4 };
        const m = obj.mesh, gg = m && m.geometry; if (gg) { if (!gg.boundingBox) gg.computeBoundingBox(); if (gg.boundingBox) ki.h = Math.max(1.2, gg.boundingBox.max.y); }
        this.kindH.set(b.kind, ki);
      }
      o.lw = ki.lw; o.ld = ki.ld; o.h = ki.h; return o;
    }
    // model-local (lx, ly, lz) of the building described by o -> world, into v
    toW(o, lx, ly, lz, v) { const c = Math.cos(o.th), s = Math.sin(o.th); return v.set(o.cx + lx * c + lz * s, o.gy + ly, o.cz - lx * s + lz * c); }
    anchorW(o, a, v) { return this.toW(o, a.position.x, a.position.y, a.position.z, v); }
    findB(state, id) { const B = state && state.buildings; if (B) for (let i = 0; i < B.length; i++) if (B[i].id === id) return B[i]; return null; }

    // ring: a flat ring that grows from r0 to r1 on the ground / water (x, y = ground height, z)
    ring(x, y, z, r0, r1, life, ci, a) {
      const o = this.rings[this.ringI]; this.ringI = (this.ringI + 1) % this.rings.length;
      o.live = true; o.x = x; o.y = y; o.z = z; o.t0 = this.t; o.life = life; o.r0 = r0; o.r1 = r1; o.a = a;
      if (ci >= K.LORD) { const c = this.lordCol[ci - K.LORD]; o.r = c[0]; o.g = c[1]; o.b = c[2]; } else { o.r = PAL[ci * 3]; o.g = PAL[ci * 3 + 1]; o.b = PAL[ci * 3 + 2]; }
    }
    bit(kind) { const o = this.bits[this.bitI]; this.bitI = (this.bitI + 1) % this.bits.length; o.live = true; o.kind = kind; o.t0 = this.t; o.landed = 0; o.r = o.g = o.b = 1; o.len = 1.6; o.wid = 0.14; o.yaw = 0; o.spin = 0; return o; }

    puff(x, y, z, n, rad, spd, s0, s1, life, c0, c1, a0, up, wk) {
      n = this.cnt(n);
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, r = Math.sqrt(rnd()) * rad;
        this.S.spawn(x + Math.cos(a) * r, y + rnd() * 0.3, z + Math.sin(a) * r, Math.cos(a) * spd * rr(0.3, 1), up * rr(0.6, 1.3), Math.sin(a) * spd * rr(0.3, 1),
          life * rr(0.7, 1.2), s0 * rr(0.7, 1.2), s1 * rr(0.7, 1.2), c0, a0, c1, 0, 0.9, -0.1, wk == null ? 0.5 : wk);
      }
    }
    sparks(x, y, z, n, spd, ci, life, size, grav) {
      n = this.cnt(n);
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, e = rr(-0.1, 1.0), s = spd * rr(0.4, 1), c = Math.sqrt(1 - e * e);
        this.A.spawn(x, y, z, Math.cos(a) * c * s, e * s, Math.sin(a) * c * s, life * rr(0.6, 1.2), size, size * 0.25, ci, 1, K.FLAME_END, 0, 0.7, grav == null ? 9 : grav, 0);
      }
    }
    glow(x, y, z, size, a, ci, life) { this.A.spawn(x, y, z, 0, 0, 0, life || 0.07, size, size, ci, a, ci, a, 0, 0, 0); }
    chips(x, y, z, n, spd, ci0, ci1, size) {
      n = this.cnt(n);
      for (let i = 0; i < n; i++) { const a = rnd() * TAU, s = spd * rr(0.4, 1); this.S.spawn(x, y, z, Math.cos(a) * s, rr(2.5, 6), Math.sin(a) * s, rr(0.7, 1.3), size || 0.3, (size || 0.3) * 0.7, rnd() < 0.5 ? ci0 : ci1, 1, ci1, 0.9, 0.3, 12, 0); }
    }
    splash(x, y, z, n, spd, big) {      // water droplets + foam at a water surface
      n = this.cnt(n);
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, s = spd * rr(0.3, 1);
        this.S.spawn(x + rr(-0.3, 0.3), y + 0.1, z + rr(-0.3, 0.3), Math.cos(a) * s, rr(1.6, 4.2) * (big ? 1.3 : 1), Math.sin(a) * s, rr(0.4, 0.8), 0.55 * (big ? 1.4 : 1), 0.2, K.FOAM, 0.9, K.WATER, 0, 0.5, 9, 0);
      }
      this.S.spawn(x, y + 0.08, z, 0, 0.2, 0, 1.1, (big ? 1.6 : 1.0), (big ? 3.0 : 2.0), K.FOAM, 0.35, K.FOAM, 0, 0.5, 0, 0);
      this.ring(x, y + 0.04, z, 0.2, big ? 2.4 : 1.5, 0.9, K.FOAM, 0.7);
    }
    scatter(x, y, r) { for (const f of this.flocks) if (Math.hypot(f.hx - x, f.hz - y) < r + 14) { f.scatterUntil = this.now + 3800; f.sx = x; f.sz = y; } }
    setLordColors() {
      const v = this.view;
      for (let i = 0; i < 4; i++) {
        const hex = v.colorOf ? v.colorOf(i) : '#cccccc'; if (hex === this.lordHex[i]) continue;
        this.lordHex[i] = hex; const c = this.col.set(hex); this.lordCol[i][0] = c.r; this.lordCol[i][1] = c.g; this.lordCol[i][2] = c.b;
        for (let j = 0; j < 3; j++) PAL[(K.LORD + i) * 3 + j] = this.lordCol[i][j];
      }
    }

    // ---------------------------------------------------------------- events ----------------------------------------------------------
    event(ev, state) {
      if (!this.enabled || !this.S || !ev || !this.land) return;
      switch (ev.t) {
        case 'shot': if (this.evBudget > 0) { this.evBudget--; this.onShot(ev); } break;
        case 'clash': if (this.evBudget > 0) { this.evBudget--; this.onClash(ev.x, ev.y); } break;
        case 'hit': if (this.evBudget > 0) { this.evBudget--; this.onHit(ev.x, ev.y); } break;
        case 'death': this.onDeath(ev); break;
        case 'ignite': this.onIgnite(ev, state); break;
        case 'fireOut': this.onFireOut(ev, state); break;
        case 'cropBurnt': this.onCropBurnt(ev, state); break;
        case 'bucket': this.onBucket(ev, state); break;
        case 'ruined': this.onRuined(ev, state); break;
        case 'build': case 'rebuild': this.onBuildStart(ev, state); break;
        case 'buildDone': this.onBuildDone(ev, state); break;
        case 'chop': this.onChop(ev); break;
        case 'harvest': this.onHarvest(ev, state); break;
        case 'sow': this.onSow(ev, state); break;
        case 'order': this.onOrder(ev, state); break;
        case 'plunder': this.onPlunder(ev, state); break;
        case 'protEnd': this.onProtEnd(ev); break;
        case 'crossingOpen': this.onCrossing(ev); break;
        case 'pactOn': this.onPactOn(ev); break;
        case 'pactOff': this.onPactOff(ev); break;
        case 'crown': this.onCrown(ev); break;
        case 'attack': this.onAttack(ev); break;
        default: break;
      }
    }
    keepPos(lord, out, dy) {
      const k = this.view.keepObj(lord); if (!k) return null;
      return out.set(k.group.position.x, k.group.position.y + (dy || 0), k.group.position.z);
    }

    onShot(ev) {
      const f = ev.from, t = ev.to; if (!f || !t) return;
      const src = ev.src || 'bogen', b = this.bit(0);
      const dx = t[0] - f[0], dz = t[1] - f[1], d = Math.hypot(dx, dz);
      b.life = clamp(ev.flight || 0.5, 0.15, 1.6);
      b.sx = f[0]; b.sz = f[1]; b.sy = this.gy(f[0], f[1]) + (src === 'keep' ? 8.6 : src === 'turm' ? 3.3 : 1.05);
      b.ex = t[0]; b.ez = t[1]; b.ey = this.wy(t[0], t[1]) + 0.8;
      b.H = src === 'bogen' ? clamp(0.2 * d + 0.5, 0.8, 6.5) : clamp(0.08 * d + 0.4, 0.6, 3);
      b.len = 1.5; b.wid = 0.17; b.r = 0.98; b.g = 0.9; b.b = 0.7;
      if (src !== 'bogen') { this.puff(b.sx, b.sy, b.sz, 3, 0.3, 0.8, 0.5, 1.4, 0.7, K.SMOKE_L, K.SMOKE_L, 0.35, 0.3, 0.2); this.sparks(b.sx, b.sy, b.sz, 3, 3, K.SPARK, 0.25, 0.28, 4); }
      this.scatter(f[0], f[1], 10);
    }
    onClash(x, y) {
      const h = this.wy(x, y), wet = this.wet(x, y) > 0.05;
      if (wet) { this.splash(x, h, y, 9, 3.2, true); this.glow(x, h + 0.9, y, 1.7, 0.7, K.WHITE, 0.08); }
      else {
        this.puff(x, h + 0.2, y, 4, 0.5, 1.8, 1.3, 4.0, 1.0, K.DUST, K.DUST, 0.75, 1.0, 0.5);
        this.sparks(x, h + 0.9, y, 7, 5.5, K.SPARK, 0.35, 0.5, 9);
        this.glow(x, h + 0.9, y, 2.2, 0.8, K.WHITE, 0.08);
        this.ring(x, h + 0.08, y, 0.3, 1.9, 0.7, K.DUST, 0.65);
      }
      this.scatter(x, y, 14);
    }
    onHit(x, y) {
      const h = this.wy(x, y) + 0.8;
      this.sparks(x, h, y, 4, 4, K.SPARK, 0.3, 0.26, 9); this.glow(x, h, y, 1.1, 0.7, K.WHITE, 0.07);
    }
    onDeath(ev) {
      const x = ev.x, y = ev.y, h = this.wy(x, y), big = ev.kind === 'ritter' ? 1.5 : ev.kind === 'bauer' ? 0.75 : 1.0, l = ev.lord == null ? 0 : ev.lord, ci = K.LORD + (l & 3);
      this.puff(x, h + 0.3, y, 5, 0.45 * big, 1.1, 0.8 * big, 2.5 * big, 0.8, K.STEAM, K.SMOKE_L, 0.7, 0.9, 0.3);
      this.chips(x, h + 0.7, y, 6, 3.2, ci, ci, 0.36);
      for (let i = 0; i < this.cnt(3); i++) this.A.spawn(x + rr(-0.3, 0.3), h + 1.0, y + rr(-0.3, 0.3), rr(-0.3, 0.3), rr(1.4, 2.4), rr(-0.3, 0.3), rr(0.8, 1.3), 0.5, 0.1, K.GOLD, 0.9, K.GLITTER, 0, 0.6, -0.6, 0);
      if (this.wet(x, y) > 0.05) this.splash(x, this.land.surf, y, 6, 2.6, false);
      this.ring(x, h + 0.08, y, 0.4, 2.2, 0.7, ci, 0.8);
      this.scatter(x, y, 16);
    }
    onIgnite(ev, state) {
      const b = this.findB(state, ev.id), o = b && this.geom(b, this.G); if (!o) return;
      this.sparks(o.cx, o.gy + o.h * 0.7, o.cz, 18, 5, K.EMBER, 1.1, 0.34, 6);
      this.puff(o.cx, o.gy + o.h * 0.8, o.cz, 5, o.lw * 0.3, 1.2, 1.2, 4, 2.2, K.SMOKE_D, K.SMOKE_M, 0.7, 2.2, 0.8);
      this.glow(o.cx, o.gy + o.h * 0.6, o.cz, 5, 0.6, K.FLAME, 0.2);
      this.scatter(o.cx, o.cz, 14);
    }
    onFireOut(ev, state) {
      const b = this.findB(state, ev.id), o = b && this.geom(b, this.G); if (!o) return;
      this.puff(o.cx, o.gy + o.h * 0.6, o.cz, 16, o.lw * 0.35, 2.4, 1.4, 5, 2.4, K.STEAM, K.STEAM, 0.75, 3, 1.2);
      this.sparks(o.cx, o.gy + o.h * 0.7, o.cz, 10, 4, K.WATER_HI, 0.8, 0.3, 7);
    }
    onCropBurnt(ev, state) {
      const b = this.findB(state, ev.id), o = b && this.geom(b, this.G); if (!o) return;
      this.puff(o.cx, o.gy + 0.6, o.cz, 10, o.lw * 0.35, 1.8, 1.4, 4.2, 2.6, K.SOOT, K.SMOKE_D, 0.6, 2.2, 0.8);
      this.sparks(o.cx, o.gy + 0.6, o.cz, 12, 3.6, K.EMBER, 1.2, 0.3, 4);
    }
    onBucket(ev, state) {      // a bucket of water flies from the well to the burning building
      const a = this.findB(state, ev.brunnen), b = this.findB(state, ev.id), G2 = this.fG2 || (this.fG2 = { cx: 0, cz: 0, gy: 0, th: 0, lw: 2, ld: 2, h: 2.4 });
      const oa = a && this.geom(a, this.G); if (!oa) return;
      const ax = oa.cx, ay = oa.gy + 1.4, az = oa.cz, ob = b && this.geom(b, G2); if (!ob) return;
      const tau = 0.55, tx = ob.cx - ax, ty = ob.gy + ob.h * 0.6 - ay, tz = ob.cz - az, g = 9;
      for (let i = 0; i < this.cnt(10); i++) {
        const j = rr(0.9, 1.1);
        this.S.spawn(ax, ay, az, tx / tau * j + rr(-0.4, 0.4), (ty + 0.5 * g * tau * tau) / tau + rr(-0.5, 0.5), tz / tau * j + rr(-0.4, 0.4), tau * rr(0.9, 1.05), 0.5, 0.35, K.WATER, 0.95, K.WATER, 0.5, 0, g, 0);
      }
      const cx = ob.cx, cy = ob.gy + ob.h * 0.5, cz = ob.cz;
      this.later(tau * 1000, () => { this.puff(cx, cy, cz, 7, 0.9, 1.6, 1.2, 3.6, 1.4, K.STEAM, K.STEAM, 0.55, 2.0, 1.0); this.sparks(cx, cy, cz, 8, 3.5, K.WATER_HI, 0.6, 0.28, 8); });
    }
    onRuined(ev, state) {
      const b = this.findB(state, ev.id), o = b && this.geom(b, this.G); if (!o) return;
      const area = o.lw * o.ld, bits = Math.min(this.bits.length >> 1, 8);
      this.puff(o.cx, o.gy + 0.8, o.cz, 10 + area * 1.6, Math.max(o.lw, o.ld) * 0.4, 4.5, 2.2, 7.5, 3.0, K.DUST, K.SMOKE_L, 0.8, 2.4, 0.4);
      this.puff(o.cx, o.gy + o.h * 0.6, o.cz, 8, o.lw * 0.3, 1.8, 1.6, 5.5, 3.6, K.SMOKE_D, K.SMOKE_M, 0.75, 3.2, 1.0);
      this.sparks(o.cx, o.gy + o.h * 0.5, o.cz, 18, 6.5, K.WOOD_L, 1.2, 0.4, 14);
      this.chips(o.cx, o.gy + 1, o.cz, 14, 4.5, K.WOOD, K.WOOD_L, 0.42);
      for (let i = 0; i < bits; i++) {      // planks and beams flying out
        const b2 = this.bit(1), a = rnd() * TAU, s = rr(2.5, 6);
        b2.life = rr(1.4, 2.2); b2.x = o.cx + rr(-1, 1); b2.y = o.gy + o.h * rr(0.3, 0.9); b2.z = o.cz + rr(-1, 1); b2.vx = Math.cos(a) * s; b2.vy = rr(3, 7); b2.vz = Math.sin(a) * s;
        b2.yaw = rnd() * TAU; b2.spin = rr(-9, 9); b2.len = rr(0.9, 1.7); b2.wid = 0.22; b2.r = 0.42; b2.g = 0.27; b2.b = 0.14; b2.gy = o.gy;
      }
      this.ring(o.cx, o.gy + 0.1, o.cz, 0.8, Math.max(o.lw, o.ld) * 1.5, 1.0, K.DUST, 0.7);
      this.scatter(o.cx, o.cz, 18);
    }
    onBuildStart(ev, state) {
      const b = this.findB(state, ev.id), o = b && this.geom(b, this.G); if (!o) return;
      this.puff(o.cx, o.gy + 0.3, o.cz, 7, o.lw * 0.4, 1.4, 0.9, 2.8, 1.4, K.DUST, K.DUST, 0.45, 0.5, 0.4);
      this.chips(o.cx, o.gy + 0.8, o.cz, 6, 2.2, K.WOOD, K.WOOD_L, 0.3);
    }
    onBuildDone(ev, state) {
      const b = this.findB(state, ev.id), o = b && this.geom(b, this.G); if (!o) return;
      this.puff(o.cx, o.gy + 0.4, o.cz, 14, Math.max(o.lw, o.ld) * 0.5, 2.8, 1.4, 4.4, 1.6, K.DUST, K.DUST, 0.65, 0.9, 0.3);
      this.ring(o.cx, o.gy + 0.12, o.cz, 0.6, Math.max(o.lw, o.ld) * 1.1 + 1.2, 1.1, K.GOLD_S, 0.9);
      const n = this.cnt(26);
      for (let i = 0; i < n; i++) { const a = rnd() * TAU, s = rr(1.5, 5); this.A.spawn(o.cx, o.gy + o.h * 0.8, o.cz, Math.cos(a) * s, rr(3, 7), Math.sin(a) * s, rr(1.0, 1.7), 0.45, 0.1, i & 1 ? K.GOLD : K.GLITTER, 1, K.GOLD, 0, 0.8, 6, 0.2); }
      this.glow(o.cx, o.gy + o.h * 0.8, o.cz, 7, 0.4, K.GOLD, 0.35);
    }
    onChop(ev) {
      const t = this.world && this.world.trees[ev.tree]; if (!t) return;
      const h = this.gy(t.x, t.y), top = 2.2 * (t.s || 1);
      this.puff(t.x, h + 0.4, t.y, 4, 0.7, 1.6, 0.8, 2.6, 1.2, K.DUST, K.DUST, 0.45, 0.6, 0.3);
      const n = this.cnt(14);
      for (let i = 0; i < n; i++) { const a = rnd() * TAU, s = rr(0.4, 2.6); this.S.spawn(t.x + rr(-0.8, 0.8), h + top * rr(0.6, 1.2), t.y + rr(-0.8, 0.8), Math.cos(a) * s, rr(0.4, 2), Math.sin(a) * s, rr(0.9, 1.7), 0.42, 0.34, K.LEAF, 1, K.LEAF, 0.8, 0.5, 5, 0.6); }
      this.chips(t.x, h + 0.8, t.y, 6, 2.4, K.WOOD, K.WOOD_L, 0.3);
    }
    onHarvest(ev, state) {
      const b = this.findB(state, ev.id), o = b && this.geom(b, this.G); if (!o) return;
      this.puff(o.cx, o.gy + 0.5, o.cz, 8, o.lw * 0.3, 1.4, 0.9, 2.6, 1.3, K.GRAIN, K.DUST, 0.55, 1.0, 0.5);
      for (let i = 0; i < this.cnt(8); i++) this.A.spawn(o.cx + rr(-1.4, 1.4), o.gy + 0.8, o.cz + rr(-1, 1), rr(-0.8, 0.8), rr(2, 4.4), rr(-0.8, 0.8), rr(0.7, 1.2), 0.34, 0.1, K.GOLD, 0.85, K.GRAIN, 0, 0.6, 5, 0.2);
    }
    onSow(ev, state) {
      const b = this.findB(state, ev.id), o = b && this.geom(b, this.G); if (!o) return;
      this.puff(o.cx, o.gy + 0.3, o.cz, 6, o.lw * 0.3, 1.2, 0.8, 2.2, 1.1, K.SOIL, K.DUST, 0.5, 0.6, 0.3);
    }
    onOrder(ev, state) {
      const B = state && state.banners, c = this.lordCol[(ev.lord | 0) & 3];
      let ban = null; if (B) for (let i = 0; i < B.length; i++) if (B[i].lord === ev.lord && B[i].n === ev.n) { ban = B[i]; break; }
      let sx, sy;
      if (ban) { sx = ban.x; sy = ban.y; }
      else { const kp = this.keepPos(ev.lord, this.v1, 0); if (!kp) return; const lr = this.view.lordBy && this.view.lordBy.get(ev.lord); sx = kp.x; sy = kp.z + (lr && lr.site >= 2 ? -4.6 : 4.6); }   // no banner yet: the keep's gate
      let o = null; for (const q of this.orders) if (q.live && q.lord === ev.lord && q.n === ev.n) { o = q; break; }
      if (!o) for (const q of this.orders) if (!q.live) { o = q; break; }
      if (!o) o = this.orders[0];
      o.live = true; o.lord = ev.lord | 0; o.n = ev.n | 0; o.bid = ban ? ban.id : -1; o.t0 = this.t; o.sx = sx; o.sy = sy; o.tx = ev.x; o.ty = ev.y; o.r = c[0]; o.g = c[1]; o.b = c[2];
      const h = this.wy(sx, sy), ci = K.LORD + ((ev.lord | 0) & 3);
      this.ring(sx, h + 0.1, sy, 0.5, 3.2, 0.8, ci, 0.9);
      for (let i = 0; i < this.cnt(8); i++) { const a = rnd() * TAU; this.A.spawn(sx, h + 2.6, sy, Math.cos(a) * 2, rr(1, 3), Math.sin(a) * 2, rr(0.5, 0.9), 0.4, 0.1, K.GLITTER, 0.8, K.GOLD, 0, 0.6, 3, 0); }
      this.scatter(sx, sy, 10);
    }
    onPlunder(ev) {
      const A = this.keepPos(ev.lord, this.v1, 0); if (!A) return;
      const ax = A.x, ay = A.y, az = A.z, att = ev.by == null ? -1 : ev.by;
      // the burst at the plundered keep: coins fly out, smoke and dust roll, sparks fly from the walls
      for (let i = 0; i < this.cnt(46); i++) {
        const a = rnd() * TAU, s = rr(2, 8), x = ax + Math.cos(a) * 2.5, y = ay + 5.5, z = az + Math.sin(a) * 2.5, vx = Math.cos(a) * s, vy = rr(8, 15), vz = Math.sin(a) * s, life = rr(1.3, 2.3);
        this.S.spawn(x, y, z, vx, vy, vz, life, rr(0.55, 0.8), 0.5, K.GOLD_S, 1, K.GOLD_S, 0.95, 0.2, 15, 0);
        if (i % 2 === 0) this.A.spawn(x, y, z, vx, vy, vz, life, rr(0.5, 0.8), 0.2, K.GLITTER, 0.6, K.GOLD, 0, 0.2, 15, 0);
      }
      this.puff(ax, ay + 1, az, 30, 4.5, 4.5, 3.4, 11, 4.4, K.SMOKE_D, K.SMOKE_M, 0.85, 3.8, 1.0);
      this.puff(ax, ay + 0.5, az, 18, 5, 5.5, 2.8, 9, 3.0, K.DUST, K.SMOKE_L, 0.8, 1.4, 0.6);
      this.sparks(ax, ay + 4, az, 34, 9, K.EMBER, 1.6, 0.4, 8);
      this.glow(ax, ay + 5, az, 11, 0.6, K.GOLD, 0.45);
      this.ring(ax, ay + 0.12, az, 1, 11, 1.4, K.GOLD_S, 0.9); this.later(260, () => this.ring(ax, ay + 0.12, az, 1, 9, 1.2, K.WHITE, 0.7));
      this.ring(ax, ay + 0.12, az, 1, 13, 1.7, K.ALERT, 0.55);
      this.scatter(ax, az, 30);
      // the loot flies to the attacker's keep
      const Bp = att >= 0 ? this.keepPos(att, this.v2, 0) : null;
      if (Bp) {
        const bx = Bp.x, by = Bp.y, bz = Bp.z, d = Math.hypot(bx - ax, bz - az), n = Math.min(this.bits.length >> 1, 22);
        for (let i = 0; i < n; i++) {
          const b = this.bit(3); b.life = rr(1.5, 2.1) + d * 0.004; b.t0 = this.t + i * 0.055; b.sx = ax + rr(-2, 2); b.sy = ay + 6; b.sz = az + rr(-2, 2); b.ex = bx + rr(-1.5, 1.5); b.ey = by + 6; b.ez = bz + rr(-1.5, 1.5);
          b.H = 10 + d * 0.22 + rr(-2, 3);
        }
      }
    }
    onProtEnd(ev) {
      const p = this.keepPos(ev.lord, this.v1, 0); if (!p) return;
      const x = p.x, y = p.y, z = p.z, n = this.cnt(50);
      for (let i = 0; i < n; i++) { const a = rnd() * TAU, e = rnd() * 1.2, c = Math.cos(e) * DOME_R; this.A.spawn(x + Math.cos(a) * c, y + Math.sin(e) * DOME_R * DOME_H, z + Math.sin(a) * c, Math.cos(a) * 3, rr(0, 3), Math.sin(a) * 3, rr(0.6, 1.2), 0.55, 0.1, K.GOLD, 1, K.GLITTER, 0, 0.5, 4, 0); }
      this.ring(x, y + 0.12, z, 1, DOME_R + 3, 1.0, K.GOLD_S, 0.9);
    }
    onCrossing(ev) {
      const c = this.cross && this.cross.get(ev.id); if (!c) return;
      let s = null; for (const q of this.sweeps) if (!q.live) { s = q; break; } if (!s) s = this.sweeps[0];
      const e = c.ends && c.ends.length >= 2 ? c.ends : [{ x: c.x - Math.cos(c.rot) * c.len * 0.5, y: c.y - Math.sin(c.rot) * c.len * 0.5 }, { x: c.x + Math.cos(c.rot) * c.len * 0.5, y: c.y + Math.sin(c.rot) * c.len * 0.5 }];
      s.live = true; s.t0 = this.t; s.dur = 2.6; s.ax = e[0].x; s.az = e[0].y; s.bx = e[1].x; s.bz = e[1].y; s.kind = c.kind === 'furt' ? 0 : 1; s.wid = c.kind === 'furt' ? 6.5 : c.kind === 'bruecke' ? 4 : 3.4;
      const h = this.wy(c.x, c.y);
      this.ring(c.x, h + 0.08, c.y, 0.5, 8, 1.6, K.GLITTER, 0.8);
    }
    onPactOn(ev) {
      const A = this.keepPos(ev.a, this.v1, 0), B = this.keepPos(ev.b, this.v2, 0); if (!A || !B) return;
      let s = null; for (const q of this.arcs) if (!q.live) { s = q; break; } if (!s) s = this.arcs[0];
      const ca = this.lordCol[(ev.a | 0) & 3], cb = this.lordCol[(ev.b | 0) & 3];
      s.live = true; s.t0 = this.t; s.ax = A.x; s.ay = A.y + 9.5; s.az = A.z; s.bx = B.x; s.by = B.y + 9.5; s.bz = B.z; s.h = 6 + Math.hypot(B.x - A.x, B.z - A.z) * 0.08;
      s.ar = ca[0]; s.ag = ca[1]; s.ab = ca[2]; s.br = cb[0]; s.bg = cb[1]; s.bb = cb[2];
      for (const P of [A, B]) {
        const x = P.x, y = P.y, z = P.z;
        for (let i = 0; i < this.cnt(20); i++) { const a = rnd() * TAU; this.A.spawn(x, y + 9.4, z, Math.cos(a) * 2.5, rr(1.5, 5), Math.sin(a) * 2.5, rr(0.9, 1.6), 0.5, 0.1, i & 1 ? K.GOLD : K.GLITTER, 1, K.GOLD, 0, 0.7, 2, 0); }
        this.ring(x, y + 0.12, z, 1, 9, 1.3, K.GOLD_S, 0.8);
      }
    }
    onPactOff(ev) {
      if (ev.reason !== 'broken') return;
      const p = this.keepPos(ev.by != null ? ev.by : ev.a, this.v1, 0); if (!p) return;
      this.puff(p.x, p.y + 8, p.z, 12, 1.6, 2.4, 1.6, 5.2, 2.6, K.SMOKE_D, K.SMOKE_M, 0.8, 2.2, 0.8);
      this.sparks(p.x, p.y + 8.5, p.z, 26, 8, K.ALERT, 1.2, 0.4, 7);
      this.ring(p.x, p.y + 0.12, p.z, 1, 10, 1.3, K.ALERT, 0.85);
    }
    onCrown(ev) {
      const p = this.keepPos(ev.lord, this.v1, 0); if (!p) return;
      for (let i = 0; i < this.cnt(40); i++) { const a = rnd() * TAU, r = rr(0, 1.8); this.A.spawn(p.x - 0.5 + Math.cos(a) * r, p.y + 12.6, p.z - 1 + Math.sin(a) * r, Math.cos(a) * 1.6, rr(0.8, 4), Math.sin(a) * 1.6, rr(1.1, 2.0), 0.55, 0.1, i & 1 ? K.GOLD : K.GLITTER, 1, K.GOLD, 0, 0.5, 3, 0.2); }
      this.glow(p.x - 0.5, p.y + 12.6, p.z - 1, 6, 0.5, K.GOLD, 0.5);
    }
    onAttack(ev) {
      const h = this.wy(ev.x, ev.y); this.ring(ev.x, h + 0.1, ev.y, 0.6, 6, 1.2, K.ALERT, 0.85); this.later(300, () => this.ring(ev.x, h + 0.1, ev.y, 0.6, 5, 1.0, K.ALERT, 0.7));
      this.scatter(ev.x, ev.y, 16);
    }

    // ---------------------------------------------------------------- frame update ---------------------------------------------------------
    update(state, alpha, opts) {
      if (!this.enabled || !this.S || !state) return;
      opts = opts || {};
      const view = this.view, land = view.land; if (!land) return;
      const now = opts.now != null ? opts.now : this.now + 16.7;
      let dt = opts.dt != null ? opts.dt : (now - this.now) / 1000; dt = clamp(dt, 0, 0.066);
      this.now = now; this.t = now / 1000; this.dt = dt; this.frame++; this.evBudget = this.B === BUDGET.high ? 22 : 12;
      if (land !== this.land || view.world !== this.world) this.setWorld(view.world);
      alpha = alpha == null ? 1 : alpha;
      this.U.uTime.value = this.t;
      this.night = clamp(view.cur ? view.cur.night : 0, 0, 1); this.S.lite = this.A.lite = clamp(1 - 0.6 * this.night, 0.35, 1);
      this.wx = 0.75 + 0.35 * Math.sin(this.t * 0.11); this.wz = 0.25 + 0.2 * Math.sin(this.t * 0.07 + 1.3);
      this.setLordColors();
      if (this.pend.length) { for (let i = this.pend.length - 1; i >= 0; i--) if (now >= this.pend[i].at) { const f = this.pend[i].fn; this.pend.splice(i, 1); try { f(); } catch (e) { /* ignore */ } } }
      if (dt > 0) {
        this.buildingsFx(state, dt);
        this.unitsFx(state, alpha, dt);
        this.lordsFx(state, dt);
        this.waterLife(state, dt);
        this.birdsStep(dt);
        this.bitsStep(dt);
      }
      this.domes(state, dt);
      this.buildQuads(state, alpha);
      this.S.step(dt, this.wx, this.wz); this.A.step(dt, this.wx, this.wz);
    }

    // ----- buildings: fire, smoke, construction, chimneys --------------------------------------------------------------
    buildingsFx(state, dt) {
      const B = state.buildings, G = this.G, dn = this.dn, v1 = this.v1, S = this.S, A = this.A, night = this.night;
      if (!B) return;
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        let rec = this.brecs.get(b.id); if (!rec) { rec = { last: b.build == null ? 1 : b.build, until: 0, seen: 0 }; this.brecs.set(b.id, rec); }
        rec.seen = this.frame;
        const o = this.geom(b, G); if (!o) continue;
        const fire = b.fire || 0, hp = b.hp == null ? 1 : b.hp, build = b.build == null ? 1 : b.build;
        if (b.kind === 'bergfried') {      // keeps are stone: a damaged keep smokes from the parapet
          if (!b.ruined && hp < 0.55) {
            const k = (0.55 - hp) / 0.55, top = o.obj.anchors && o.obj.anchors.top;
            if (top) { this.anchorW(o, top, v1);
              for (let n = this.emit((0.9 + 3.2 * k) * dn, dt); n > 0; n--) S.spawn(v1.x + rr(-0.6, 0.6), v1.y, v1.z + rr(-0.6, 0.6), rr(-0.2, 0.2), rr(2, 3.2), rr(-0.2, 0.2), rr(3, 4.8), 1.2 + k, 4.5 + 2 * k, K.SMOKE_D, 0.7, K.SMOKE_M, 0, 0.1, -0.2, 1.1);
              if (hp < 0.32) {      // badly damaged: the parapet crumbles — pale dust puffs and stone chips that fall down the wall (grey only: orange flames mean real fire)
                const c = (0.32 - hp) / 0.32;
                for (let n = this.emit((1.6 + 4 * c) * dn, dt); n > 0; n--) S.spawn(v1.x + rr(-0.9, 0.9), v1.y + rr(-0.2, 0.2), v1.z + rr(-0.9, 0.9), rr(-0.6, 0.6), rr(0.3, 0.9), rr(-0.6, 0.6), rr(1.3, 2.2), 0.6, 2.1, K.SMOKE_L, 0.5, K.SMOKE_M, 0, 0.6, 0, 1);
                for (let n = this.emit((2 + 6 * c) * dn, dt); n > 0; n--) S.spawn(v1.x + rr(-1, 1), v1.y + rr(-0.3, 0.1), v1.z + rr(-1, 1), rr(-0.8, 0.8), rr(0.2, 1.4), rr(-0.8, 0.8), rr(1.0, 1.5), rr(0.2, 0.3), 0.14, rnd() < 0.5 ? K.STONE : K.STONE_L, 1, K.STONE, 0.9, 0.15, 11, 0);
              }
            }
          }
          continue;
        }
        if (fire > 0.04 && !b.ruined) this.fireFx(b, o, fire, dt);
        else if (b.ruined) {
          if ((b.burnt || 0) > 0.6) for (let n = this.emit(1.4 * dn, dt); n > 0; n--) S.spawn(o.cx + rr(-o.lw * 0.3, o.lw * 0.3), o.gy + 0.6, o.cz + rr(-o.ld * 0.3, o.ld * 0.3), 0, rr(1, 1.8), 0, rr(3, 4.5), 0.7, 3, K.SMOKE_M, 0.32, K.SMOKE_L, 0, 0.1, -0.1, 1);
        } else if (hp < 0.45 && STONE[b.kind] && build >= 1) {      // damaged stone buildings smoke
          const k = (0.45 - hp) / 0.45;
          for (let n = this.emit((0.7 + 2.2 * k) * dn, dt); n > 0; n--) S.spawn(o.cx + rr(-0.5, 0.5), o.gy + o.h, o.cz + rr(-0.5, 0.5), rr(-0.2, 0.2), rr(1.6, 2.6), rr(-0.2, 0.2), rr(2.6, 4), 0.9, 3.4, K.SMOKE_D, 0.6, K.SMOKE_M, 0, 0.1, -0.2, 1);
        }
        // construction: while `build` rises there are workers on the site (a site without builder stays put)
        if (build > 0 && build < 1 && !b.ruined) {
          if (build > rec.last + 1e-5) rec.until = this.now + 900;
          if (this.now < rec.until) {
            for (let n = this.emit(11 * dn, dt); n > 0; n--) { const lx = rr(-o.lw * 0.45, o.lw * 0.45), lz = rr(-o.ld * 0.45, o.ld * 0.45); this.toW(o, lx, rr(0.8, Math.max(1.6, o.h * 0.9)), lz, v1);
              S.spawn(v1.x, v1.y, v1.z, rr(-1.4, 1.4), rr(2.5, 5.5), rr(-1.4, 1.4), rr(0.7, 1.2), 0.36, 0.22, K.WOOD_L, 1, K.WOOD, 0.9, 0.5, 11, 0); }
            for (let n = this.emit(3 * dn, dt); n > 0; n--) { this.toW(o, rr(-o.lw * 0.4, o.lw * 0.4), rr(0.8, Math.max(1.6, o.h * 0.8)), rr(-o.ld * 0.4, o.ld * 0.4), v1);
              A.spawn(v1.x, v1.y, v1.z, rr(-1, 1), rr(1.5, 3.5), rr(-1, 1), rr(0.25, 0.5), 0.3, 0.06, K.SPARK, 1, K.FLAME, 0, 0.5, 6, 0); }
            for (let n = this.emit(4.5 * dn, dt); n > 0; n--) { const lx = rr(-o.lw * 0.5, o.lw * 0.5), lz = rr(-o.ld * 0.5, o.ld * 0.5); this.toW(o, lx, 0.25, lz, v1);
              S.spawn(v1.x, v1.y, v1.z, rr(-0.6, 0.6), rr(0.4, 1.0), rr(-0.6, 0.6), rr(1.2, 1.9), 0.9, 2.9, K.DUST, 0.5, K.DUST, 0, 0.3, 0, 0.5); }
          }
        }
        rec.last = build;
        // chimney smoke: finished, not burning, not ruined
        if (CHIMNEY[b.kind] && build >= 1 && !b.ruined && fire < 0.25) {
          const an = o.obj.anchors && o.obj.anchors.chimney;
          if (an) { this.anchorW(o, an, v1);
            const k = CHIMNEY[b.kind] * (0.7 + 0.5 * sstep(0.5, 1.0, state.dayT == null ? 0.45 : state.dayT) + 0.3 * night);
            for (let n = this.emit(1.7 * k * dn, dt); n > 0; n--) S.spawn(v1.x + rr(-0.1, 0.1), v1.y, v1.z + rr(-0.1, 0.1), rr(-0.15, 0.15), rr(1.1, 1.8), rr(-0.15, 0.15), rr(3.4, 4.8), 0.65, 2.6, K.SMOKE_L, 0.55, K.SMOKE_M, 0, 0.1, -0.12, 1.3);
          }
        }
      }
      // forget buildings that have vanished
      if (++this.sinceClean > 90) { this.sinceClean = 0; for (const [id, r] of this.brecs) if (r.seen < this.frame - 60) this.brecs.delete(id); }
    }
    fireFx(b, o, fire, dt) {
      const f = Math.min(1, fire), dn = this.dn, S = this.S, A = this.A, v1 = this.v1, hof = b.kind === 'hof', top = o.h;
      const fl = 0.78 + 0.22 * Math.sin(this.t * 17 + b.id * 3) * Math.sin(this.t * 11.3 + b.id);
      // flame bodies (alpha, so they read on a bright day) + hot additive cores
      for (let n = this.emit((14 + 80 * f) * dn, dt); n > 0; n--) {
        let lx, lz, ly, sz;
        if (hof && rnd() < 0.62) { lx = rr(-o.lw * 0.46, o.lw * 0.46); lz = rr(-o.ld * 0.46, o.ld * 0.46); ly = rr(0.05, 0.4); sz = rr(0.9, 1.6) * (0.6 + 0.6 * f); }
        else if (hof) { lx = rr(-2.4, -0.6); lz = rr(-1.9, -0.1); ly = top * rr(0.4, 1.0); sz = (1.5 + 1.3 * f) * rr(0.7, 1.2); }
        else { lx = rr(-o.lw * 0.32, o.lw * 0.32); lz = rr(-o.ld * 0.32, o.ld * 0.32); ly = top * rr(0.35, 1.05); sz = (1.5 + 1.7 * f) * rr(0.7, 1.2); }
        this.toW(o, lx, ly, lz, v1);
        const life = rr(0.55, 1.0) * (0.75 + 0.5 * f);
        S.spawn(v1.x, v1.y, v1.z, rr(-0.35, 0.35), rr(2.2, 4.0) + f * 1.6, rr(-0.35, 0.35), life, sz, 0.3, K.FLAME, 1.0, K.FLAME_END, 0.0, 0.4, -1.4, 0.3);
        if (rnd() < 0.5) A.spawn(v1.x, v1.y - 0.1, v1.z, rr(-0.3, 0.3), rr(1.8, 3.4), rr(-0.3, 0.3), life * 0.7, sz * 0.55, 0.15, K.FLAME_HOT, 0.6, K.FLAME, 0, 0.4, -1.4, 0.3);
      }
      for (let n = this.emit((2 + 18 * f) * dn, dt); n > 0; n--) {      // embers
        this.toW(o, rr(-o.lw * 0.35, o.lw * 0.35), top * rr(0.7, 1.1), rr(-o.ld * 0.35, o.ld * 0.35), v1);
        A.spawn(v1.x, v1.y, v1.z, rr(-1, 1), rr(2.5, 5.5), rr(-1, 1), rr(1.2, 2.6), 0.26, 0.08, K.EMBER, 1, K.FLAME_END, 0, 0.1, -0.5, 1.8);
      }
      for (let n = this.emit((3.2 + 13 * f) * dn, dt); n > 0; n--) {      // the smoke column, readable from the far camera
        this.toW(o, rr(-o.lw * 0.28, o.lw * 0.28), top * 1.05, rr(-o.ld * 0.28, o.ld * 0.28), v1);
        S.spawn(v1.x, v1.y, v1.z, rr(-0.3, 0.3), rr(2.4, 3.6) + f * 1.0, rr(-0.3, 0.3), rr(3.4, 5.2), 1.4 + 0.8 * f, 4.6 + 2.6 * f, K.SMOKE_D, 0.78, K.SMOKE_M, 0, 0.1, -0.2, 1.1);
      }
      this.glow(o.cx, o.gy + top * 0.7, o.cz, (4 + 5 * f) * fl, (0.035 + 0.05 * f) * (1 + 4 * this.night), K.FLAME, 0.07);
    }

    // ----- units: wading splashes and ripples, fight dust ------------------------------------------------------------
    unitsFx(state, alpha, dt) {
      const U = state.units, L = this.land, surf = L.surf, S = this.S, dn = this.dn;
      if (!U) return;
      const thinW = this.nWade > 26 ? 26 / this.nWade : 1, thinF = this.nFight > 40 ? 40 / this.nFight : 1;
      let nw = 0, nf = 0;
      for (let i = 0; i < U.length; i++) {
        const u = U[i], px = u.px == null ? u.x : u.px, py = u.py == null ? u.y : u.py;
        const x = px + (u.x - px) * alpha, y = py + (u.y - py) * alpha, gy = L.standY(x, y), depth = surf - gy;
        const fight = u.anim === 'fight';
        if (depth > 0.03) {
          nw++;
          const sp = Math.hypot(u.x - px, u.y - py) * SIM_HZ, mv = clamp(sp / 2.4, 0, 1.4), ws = thinW * dn;
          const rate = fight ? 5 : 6.5 * mv;
          for (let n = this.emit(rate * ws, dt); n > 0; n--) {
            const a = rnd() * TAU, s = rr(0.4, 1.4);
            S.spawn(x + rr(-0.3, 0.3), surf + 0.1, y + rr(-0.3, 0.3), Math.cos(a) * s, rr(1.4, 3.2), Math.sin(a) * s, rr(0.35, 0.7), 0.5, 0.18, K.FOAM, 0.9, K.WATER, 0, 0.4, 9, 0);
          }
          for (let n = this.emit((fight ? 1.6 : 2.2 * mv) * ws, dt); n > 0; n--) S.spawn(x + rr(-0.35, 0.35), surf + 0.07, y + rr(-0.35, 0.35), 0, 0.1, 0, rr(0.9, 1.4), 0.9, 1.8, K.FOAM, 0.34, K.FOAM, 0, 0.5, 0, 0);
          for (let n = this.emit((fight ? 1.2 : mv > 0.15 ? 2.6 * mv : 0.5) * ws, dt); n > 0; n--) this.ring(x + rr(-0.25, 0.25), surf + 0.03, y + rr(-0.25, 0.25), 0.2, fight ? 1.5 : 1.0, fight ? 0.9 : 0.8, K.FOAM, 0.42);
        } else if (fight) {
          nf++;
          for (let n = this.emit(0.6 * thinF * dn, dt); n > 0; n--) S.spawn(x + rr(-0.5, 0.5), gy + 0.15, y + rr(-0.5, 0.5), rr(-0.4, 0.4), rr(0.3, 0.8), rr(-0.4, 0.4), rr(0.7, 1.1), 0.7, 1.9, K.DUST, 0.26, K.DUST, 0, 0.4, 0, 0.4);
        }
      }
      this.nWade = nw; this.nFight = nf;
    }

    // ----- houses: Zorn embers, the dome's target ------------------------------------------------------------------------
    lordsFx(state, dt) {
      const Ls = state.lords; if (!Ls) return;
      for (let i = 0; i < Ls.length; i++) {
        const l = Ls[i]; if (!l || !(l.zorn > 0)) continue;
        const p = this.keepPos(l.i, this.v1, 0); if (!p) continue;
        const k = clamp(l.zorn / 8, 0.35, 1);
        for (let n = this.emit(7 * k * this.dn, dt); n > 0; n--) { const a = rnd() * TAU, r = rr(1.5, 4); this.A.spawn(p.x + Math.cos(a) * r, p.y + rr(0.5, 7), p.z + Math.sin(a) * r, rr(-0.3, 0.3), rr(1.2, 2.8), rr(-0.3, 0.3), rr(1.0, 1.8), 0.3, 0.08, K.ALERT, 0.9, K.FLAME_END, 0, 0.2, -0.3, 0.8); }
        this.zornAcc[l.i & 3] += dt; if (this.zornAcc[l.i & 3] > 1.6) { this.zornAcc[l.i & 3] = 0; this.ring(p.x, p.y + 0.12, p.z, 3, 7.5, 1.4, K.ALERT, 0.5); }
      }
    }

    // ----- water life: driftwood in the flood, a fish now and then -------------------------------------------------------------
    waterLife(state, dt) {
      const w = this.world, L = this.land; if (!w || !L) return;
      const lvl = L.level, fl = w.flow, FXn = FW().FX;
      // driftwood: only while the water stands high; logs follow the flow field and are put back upstream when they strand or leave the map
      const want = lvl > 0.5 ? Math.min(this.logs.length, Math.round(this.logs.length * sstep(0.5, 0.9, lvl) + 0.5)) : 0;
      let live = 0;
      for (let i = 0; i < this.logs.length; i++) {
        const o = this.logs[i];
        if (o.live) {
          const fi = Math.floor(o.x + 84), fj = Math.floor(o.z + 57);
          if (fi < 0 || fj < 0 || fi >= FXn || fj >= FW().FY) { o.live = false; o.wait = rr(1, 4); continue; }
          const k = (fj * FXn + fi) * 2, fx = fl[k], fz = fl[k + 1];
          const depth = L.surf - L.standY(o.x, o.z), sp = 1.5 * (0.6 + 0.6 * clamp(depth, 0, 1));
          o.x += fx * sp * dt; o.z += fz * sp * dt; o.ph += dt; o.yaw += Math.sin(o.ph * 0.7 + i) * 0.25 * dt;
          if (fx * fx + fz * fz > 0.001) { const ty = Math.atan2(fz, fx), d = Math.atan2(Math.sin(ty - o.yaw), Math.cos(ty - o.yaw)); o.yaw += d * Math.min(1, dt * 0.8); }
          o.a = clamp(o.a + dt * (depth > 0.25 && lvl > 0.4 ? 1 : -1.2), 0, 1);
          if (o.a <= 0 && !(depth > 0.25)) { o.live = false; o.wait = rr(0.5, 3); } else if (Math.abs(o.x) > 80 || Math.abs(o.z) > 52) { o.live = false; o.wait = rr(1, 5); }
          if (o.live) live++;
        } else if (want > live && lvl > 0.5) {
          o.wait -= dt;
          if (o.wait <= 0) { this.spawnLog(o); if (o.live) live++; }
        }
      }
      // a flooded bridge or Steg: spray and foam on the upstream parapet and behind the deck (the water shader adds the white water itself)
      if (L.decks && lvl > 0.3) this.deckSpray(dt, fl, FXn);
      // a fish jumps at calm water
      if (lvl < 0.2) {
        this.nextFish -= dt;
        if (this.nextFish <= 0) { this.nextFish = rr(5, 11); this.fishJump(); }
      }
    }
    deckSpray(dt, fl, FXn) {
      const L = this.land, S = this.S, dn = this.dn, decks = L.decks;
      for (let i = 0; i < decks.length; i++) {
        const d = decks[i], sub = L.surf - d.deck; if (sub < 0.01 || sub > 1.0) continue;
        const fi = Math.floor(d.x + 84), fj = Math.floor(d.y + 57), k = (fj * FXn + fi) * 2, fx = fl[k], fz = fl[k + 1];
        let nx = -d.uy, nz = d.ux; if (nx * fx + nz * fz < 0) { nx = -nx; nz = -nz; }      // across the deck, pointing downstream
        const amt = sstep(0.01, 0.12, sub) * (1 - 0.5 * sstep(0.4, 1.0, sub));
        for (let n = this.emit(26 * amt * dn, dt); n > 0; n--) {
          const al = rr(-d.half, d.half), ax = d.x + d.ux * al, az = d.y + d.uy * al;
          if (L.surf - L.heightAt(ax, az) < 0.1) continue;                                  // the island's dry hump
          const side = rnd() < 0.55 ? -1 : 1, x = ax + nx * (d.wide + 0.1) * side, z = az + nz * (d.wide + 0.1) * side;
          S.spawn(x + rr(-0.2, 0.2), L.surf + 0.1, z + rr(-0.2, 0.2), nx * rr(0.3, 1.6) + rr(-0.4, 0.4), rr(1.3, 3.0), nz * rr(0.3, 1.6) + rr(-0.4, 0.4), rr(0.45, 0.85), rr(0.45, 0.8), 0.2, K.FOAM, 0.95, K.WATER, 0, 0.3, 9, 0);
        }
        for (let n = this.emit(7 * amt * dn, dt); n > 0; n--) {
          const al = rr(-d.half, d.half), ax = d.x + d.ux * al, az = d.y + d.uy * al; if (L.surf - L.heightAt(ax, az) < 0.1) continue;
          const dist = d.wide + rr(0.6, 4.5);
          S.spawn(ax + nx * dist, L.surf + 0.08, az + nz * dist, nx * 0.9, 0.1, nz * 0.9, rr(1.0, 1.7), 1.0, 2.2, K.FOAM, 0.32, K.FOAM, 0, 0.4, 0, 0);
        }
      }
    }
    spawnLog(o) {      // upstream: the west end of the river or the far ends of the streams
      const w = this.world, R = w.rivers[Math.floor(rnd() * Math.min(3, w.rivers.length))], pts = R.pts;
      const i = clamp(Math.floor(rnd() * Math.min(pts.length, 26)), 0, pts.length - 1), p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], a = Math.atan2(q.y - p.y, q.x - p.x);
      o.x = p.x + Math.cos(a + Math.PI / 2) * rr(-1.4, 1.4); o.z = p.y + Math.sin(a + Math.PI / 2) * rr(-1.4, 1.4);
      if (Math.abs(o.x) > 78 || Math.abs(o.z) > 50) { o.wait = rr(0.5, 2); return; }
      o.live = true; o.yaw = a + rr(-0.3, 0.3); o.ph = rr(0, 6); o.a = 0; o.len = rr(2.2, 3.4);
    }
    fishJump() {
      const w = this.world, L = this.land, pts = w.rivers[0].pts;
      for (let tries = 0; tries < 6; tries++) {
        const p = pts[Math.floor(rr(12, pts.length - 12))];
        if (Math.abs(p.x) > 62) continue;
        const x = p.x + rr(-1, 1), z = p.y + rr(-1, 1), d = L.surf - L.standY(x, z);
        if (d < 0.7) continue;
        const a = rnd() * TAU, b = this.bit(2);
        b.life = 0.55; b.sx = x; b.sz = z; b.sy = L.surf; b.ex = x + Math.cos(a) * 1.6; b.ez = z + Math.sin(a) * 1.6; b.ey = L.surf; b.H = 1.3; b.len = 0.9; b.wid = 0.24; b.r = 0.8; b.g = 0.88; b.b = 0.95;
        this.splash(x, L.surf, z, 5, 1.6, false);
        return;
      }
    }

    // ----- birds: flocks circle above the forests and flush from fights -----------------------------------------------
    birdsStep(dt) {
      const now = this.now, B = this.birds;
      for (let f = 0; f < this.flocks.length; f++) {
        const fl = this.flocks[f], scared = now < fl.scatterUntil; fl.ph += dt * 0.4 * fl.dir;
        for (let i = fl.first, e = fl.first + fl.n; i < e; i++) {
          const b = B[i];
          let tx, tz, ty, sp;
          if (scared) { const dx = b.x - fl.sx, dz = b.z - fl.sz, d = Math.hypot(dx, dz) || 1; tx = dx / d * 11 + Math.sin(b.ph) * 2; tz = dz / d * 11 + Math.cos(b.ph) * 2; ty = 3; sp = 3.5; b.ph += dt * 2; }
          else {      // back to the circling orbit around the home point
            const a = fl.ph + (i - fl.first) * 0.9 + Math.sin(b.ph * 0.3) * 0.2, r = fl.R * (0.75 + 0.35 * Math.sin(b.ph * 0.21 + i)), px = fl.hx + Math.cos(a) * r, pz = fl.hz + Math.sin(a) * r;
            const dx = px - b.x, dz = pz - b.z;
            tx = dx * 1.2 + (-Math.sin(a) * fl.dir) * 4.2; tz = dz * 1.2 + (Math.cos(a) * fl.dir) * 4.2; ty = (11 + Math.sin(b.ph * 0.5) * 1.5 - b.y) * 0.8; sp = 1.6; b.ph += dt * 0.7;
            const l = Math.hypot(tx, tz); if (l > 9) { tx *= 9 / l; tz *= 9 / l; }
          }
          const k = Math.min(1, dt * sp);
          b.vx += (tx - b.vx) * k; b.vz += (tz - b.vz) * k; b.vy += ((scared ? 3 : ty) - b.vy) * k;
          b.x += b.vx * dt; b.z += b.vz * dt; b.y = clamp(b.y + b.vy * dt, 6, 22);
        }
      }
    }

    // ----- movers: arrows, debris, fish, coins ----------------------------------------------------------------------------
    bitsStep(dt) {
      const t = this.t;
      for (let i = 0; i < this.bits.length; i++) {
        const b = this.bits[i]; if (!b.live) continue;
        const age = t - b.t0; if (age < 0) continue;
        if (b.kind === 1) {        // debris: physics
          if (!b.landed) {
            b.vy -= 15 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.yaw += b.spin * dt;
            const g = this.gy(b.x, b.z) + 0.12;
            if (b.y < g) { b.y = g; b.landed = t; b.spin = 0; const wet = this.wet(b.x, b.z) > 0.05; if (wet) this.splash(b.x, this.land.surf, b.z, 4, 2, false); else this.puff(b.x, g, b.z, 1, 0.2, 0.5, 0.6, 1.5, 0.7, K.DUST, K.DUST, 0.4, 0.3, 0.2); }
          }
          if ((b.landed && t - b.landed > 1.3) || age > b.life + 1.4) b.live = false;
          continue;
        }
        const u = age / b.life;
        if (u >= 1) {
          b.live = false;
          if (b.kind === 0) {        // an arrow lands
            if (this.wet(b.ex, b.ez) > 0.05) this.splash(b.ex, this.land.surf, b.ez, 3, 1.6, false); else this.puff(b.ex, b.ey - 0.6, b.ez, 2, 0.2, 0.6, 0.5, 1.5, 0.6, K.DUST, K.DUST, 0.4, 0.4, 0.2);
          } else if (b.kind === 2) { this.splash(b.ex, this.land.surf, b.ez, 5, 1.6, false); }
          else if (b.kind === 3) { this.sparks(b.ex, b.ey, b.ez, 5, 3, K.GOLD, 0.6, 0.4, 5); this.glow(b.ex, b.ey, b.ez, 2.4, 0.6, K.GOLD, 0.2); }
          continue;
        }
        if (b.kind === 3) {        // a coin of the loot: bright head with a sparkle trail
          const x = lerp(b.sx, b.ex, u), z = lerp(b.sz, b.ez, u), y = lerp(b.sy, b.ey, u) + b.H * 4 * u * (1 - u);
          this.S.spawn(x, y, z, 0, 0, 0, 0.07, 0.75, 0.75, K.GOLD_S, 1, K.GOLD_S, 1, 0, 0, 0); this.A.spawn(x, y, z, 0, 0, 0, 0.07, 1.4, 1.4, K.GOLD, 0.4, K.GOLD, 0.4, 0, 0, 0);
          for (let n = this.emit(26 * this.dn, dt); n > 0; n--) this.A.spawn(x + rr(-0.2, 0.2), y + rr(-0.2, 0.2), z + rr(-0.2, 0.2), rr(-0.5, 0.5), rr(-0.4, 0.8), rr(-0.5, 0.5), rr(0.35, 0.7), 0.3, 0.05, K.GLITTER, 0.9, K.GOLD, 0, 0.8, 1, 0);
        }
      }
    }

    // ----- protection domes ----------------------------------------------------------------------------------------------------
    domes(state, dt) {
      const Ls = state.lords, m = this.domeMesh, mat = this.m4, tint = this.tint.array, ph = this.tph.array, pr = this.protOf; let n = 0;
      const t = this.t;
      pr[0] = pr[1] = pr[2] = pr[3] = 0;
      if (Ls) for (let j = 0; j < Ls.length; j++) { const q = Ls[j]; if (q && q.i >= 0 && q.i < 4 && q.prot > 0) pr[q.i] = q.prot; }
      for (let i = 0; i < 4; i++) {
        const d = this.dome[i], prot = pr[i];
        const target = prot > 0 ? 1 : 0; d.k += (target - d.k) * (1 - Math.exp(-(target > d.k ? 4.5 : 8) * dt)); if (Math.abs(target - d.k) < 0.004) d.k = target;
        if (d.k <= 0.01) continue;
        const kp = this.keepPos(i, this.v1, 0); if (!kp) continue;
        const blink = prot > 0 && prot < 6 ? 0.55 + 0.45 * Math.sin(t * (7 + (6 - prot) * 2)) : 1;
        const s = 0.4 + 0.6 * d.k, c = this.lordCol[i & 3];
        mat.makeScale(DOME_R * s, DOME_R * DOME_H * s, DOME_R * s); mat.setPosition(kp.x, kp.y - 0.35, kp.z);
        m.setMatrixAt(n, mat);
        tint[n * 4] = c[0]; tint[n * 4 + 1] = c[1]; tint[n * 4 + 2] = c[2]; tint[n * 4 + 3] = d.k * blink; ph[n] = i * 1.7; n++;
      }
      m.count = n; m.visible = n > 0;
      if (n) { m.instanceMatrix.needsUpdate = true; this.tint.needsUpdate = true; this.tph.needsUpdate = true; }
    }

    // ----- everything that is a quad ------------------------------------------------------------------------------------------------
    buildQuads(state, alpha) {
      const Q = this.Q, t = this.t, land = this.land, surf = land.surf, cam = this.camera, ex = cam.position.x, ey = cam.position.y, ez = cam.position.z;
      Q.reset();
      // 1. rings on the ground and on the water
      for (let i = 0; i < this.rings.length; i++) {
        const o = this.rings[i]; if (!o.live) continue;
        const p = (t - o.t0) / o.life; if (p >= 1) { o.live = false; continue; } if (p < 0) continue;
        const r = lerp(o.r0, o.r1, Math.sqrt(p)), x = o.x, y = o.y, z = o.z;
        Q.q(x - r, y, z - r, -1, -1, x + r, y, z - r, 1, -1, x + r, y, z + r, 1, 1, x - r, y, z + r, -1, 1, o.r, o.g, o.b, o.a, 2, p);
      }
      // 2. sweeps over a crossing that opens
      for (let i = 0; i < this.sweeps.length; i++) {
        const s = this.sweeps[i]; if (!s.live) continue;
        const age = t - s.t0, u = age / s.dur; if (u >= 1.05) { s.live = false; continue; }
        const dx = s.bx - s.ax, dz = s.bz - s.az, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
        const e = u < 0 ? 0 : u > 1 ? 1 : u, ease = e * e * (3 - 2 * e), cx = s.ax + dx * ease, cz = s.az + dz * ease, env = sstep(0, 0.12, u) * (1 - sstep(0.85, 1.05, u));
        const hl = 3.4, hw = s.wid * 0.5, y = this.wy(cx, cz) + 0.1;
        Q.q(cx - ux * hl - nx * hw, y, cz - uz * hl - nz * hw, -1, -1, cx + ux * hl - nx * hw, y, cz + uz * hl - nz * hw, 1, -1, cx + ux * hl + nx * hw, y, cz + uz * hl + nz * hw, 1, 1, cx - ux * hl + nx * hw, y, cz - uz * hl + nz * hw, -1, 1, 1.0, 0.96, 0.78, 0.8 * env, 4, 0);
        if (this.dt > 0) for (let n = this.emit(34 * env * this.dn, this.dt); n > 0; n--) {
          const a = rr(-hl, hl), b = rr(-hw, hw), x = cx + ux * a + nx * b, z = cz + uz * a + nz * b;
          this.A.spawn(x, this.wy(x, z) + rr(0.1, 0.5), z, rr(-0.2, 0.2), rr(0.5, 1.5), rr(-0.2, 0.2), rr(0.6, 1.1), rr(0.3, 0.55), 0.08, K.GLITTER, 0.95, K.GOLD, 0, 0.5, -0.3, 0);
        }
      }
      // 3. order arrows: dashed, in the lord's colour, from the banner to its target
      const BN = state.banners;
      for (let i = 0; i < this.orders.length; i++) {
        const o = this.orders[i]; if (!o.live) continue;
        const age = t - o.t0; if (age > 3.0) { o.live = false; continue; }
        const env = sstep(0, 0.25, age) * (1 - sstep(2.3, 3.0, age));
        if (o.bid >= 0 && BN) for (let j = 0; j < BN.length; j++) if (BN[j].id === o.bid) { const b = BN[j], px = b.px == null ? b.x : b.px, py = b.py == null ? b.y : b.py; o.sx = px + (b.x - px) * alpha; o.sy = py + (b.y - py) * alpha; break; }
        this.orderArrow(o, env, age);
      }
      // 4. pact arcs between two keeps
      for (let i = 0; i < this.arcs.length; i++) {
        const s = this.arcs[i]; if (!s.live) continue;
        const age = t - s.t0; if (age > 4.2) { s.live = false; continue; }
        this.arcRibbon(s, age, ex, ey, ez);
      }
      // 5. driftwood
      for (let i = 0; i < this.logs.length; i++) {
        const o = this.logs[i]; if (!o.live || o.a < 0.02) continue;
        const c = Math.cos(o.yaw), s = Math.sin(o.yaw), hl = o.len * 0.5, hw = 0.3, y = surf + 0.06 + 0.03 * Math.sin(o.ph * 2.3 + i), x = o.x, z = o.z;
        Q.q(x - c * hl + s * hw, y, z - s * hl - c * hw, -1, -1, x + c * hl + s * hw, y, z + s * hl - c * hw, 1, -1, x + c * hl - s * hw, y, z + s * hl + c * hw, 1, 1, x - c * hl - s * hw, y, z - s * hl + c * hw, -1, 1, 0.36, 0.24, 0.13, 0.95 * o.a, 1, 0);
      }
      // 6. arrows, debris, fish
      for (let i = 0; i < this.bits.length; i++) {
        const b = this.bits[i]; if (!b.live || b.kind === 3) continue;
        const age = t - b.t0; if (age < 0) continue;
        if (b.kind === 1) {
          const c = Math.cos(b.yaw), s = Math.sin(b.yaw), hl = b.len * 0.5, hw = b.wid, a = b.landed ? 1 - sstep(0.7, 1.3, t - b.landed) : 1;
          Q.q(b.x - c * hl + s * hw, b.y, b.z - s * hl - c * hw, -1, -1, b.x + c * hl + s * hw, b.y, b.z + s * hl - c * hw, 1, -1, b.x + c * hl - s * hw, b.y, b.z + s * hl + c * hw, 1, 1, b.x - c * hl - s * hw, b.y, b.z - s * hl + c * hw, -1, 1, b.r, b.g, b.b, a, 1, 0);
          continue;
        }
        const u = age / b.life; if (u > 1) continue;
        const x = lerp(b.sx, b.ex, u), z = lerp(b.sz, b.ez, u), y = lerp(b.sy, b.ey, u) + b.H * 4 * u * (1 - u);
        let dx = b.ex - b.sx, dy = (b.ey - b.sy) + b.H * 4 * (1 - 2 * u), dz = b.ez - b.sz; const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
        // billboard across the view: side = dir x (eye - p)
        let sx = dy * (ez - z) - dz * (ey - y), sy = dz * (ex - x) - dx * (ez - z), sz = dx * (ey - y) - dy * (ex - x); const sl = Math.hypot(sx, sy, sz) || 1; const w = b.wid * 0.5 / sl; sx *= w; sy *= w; sz *= w;
        const L1 = b.len, hx = x + dx * 0.25, hy = y + dy * 0.25, hz = z + dz * 0.25, tx = x - dx * L1, ty = y - dy * L1, tz = z - dz * L1;
        Q.q(tx - sx, ty - sy, tz - sz, 0, -1, hx - sx, hy - sy, hz - sz, 1, -1, hx + sx, hy + sy, hz + sz, 1, 1, tx + sx, ty + sy, tz + sz, 0, 1, b.r, b.g, b.b, 1, 0, 0);
        if (b.kind === 0) {      // a faint longer trail
          const L2 = L1 * 1.9, ux2 = x - dx * L2, uy2 = y - dy * L2, uz2 = z - dz * L2, w2 = 0.5;
          Q.q(ux2 - sx * w2, uy2 - sy * w2, uz2 - sz * w2, 0, -1, hx - sx * w2, hy - sy * w2, hz - sz * w2, 1, -1, hx + sx * w2, hy + sy * w2, hz + sz * w2, 1, 1, ux2 + sx * w2, uy2 + sy * w2, uz2 + sz * w2, 0, 1, 1, 1, 1, 0.3, 0, 0);
        }
      }
      // 7. birds: a body and two wings seen from above; the flapping shows as the wings' span and sweep changing
      for (let i = 0; i < this.birds.length; i++) {
        const b = this.birds[i], sp = Math.hypot(b.vx, b.vz) || 1, fx = b.vx / sp, fz = b.vz / sp, rx = -fz, rz = fx, scared = this.now < this.flocks[b.f].scatterUntil;
        const fl = Math.sin(t * (scared ? 19 : 11) + b.ph * 3), s = 0.7, span = s * 1.55 * (0.7 + 0.3 * fl), sweep = s * (0.05 - 0.28 * fl), y = b.y;
        // body: a thin dark quad along the flight direction
        Q.q(b.x + fx * s * 0.7 + rx * s * 0.11, y, b.z + fz * s * 0.7 + rz * s * 0.11, 0, 0, b.x + fx * s * 0.7 - rx * s * 0.11, y, b.z + fz * s * 0.7 - rz * s * 0.11, 0, 0,
          b.x - fx * s * 0.6 - rx * s * 0.07, y, b.z - fz * s * 0.6 - rz * s * 0.07, 0, 0, b.x - fx * s * 0.6 + rx * s * 0.07, y, b.z - fz * s * 0.6 + rz * s * 0.07, 0, 0, 0.06, 0.07, 0.09, 0.95, 1, 0);
        for (let w = -1; w <= 1; w += 2) {      // a wing: root front, tip, root back (the 4th corner repeats the 3rd)
          Q.q(b.x + fx * s * 0.3 + rx * w * s * 0.1, y, b.z + fz * s * 0.3 + rz * w * s * 0.1, 0, 0, b.x + rx * w * span - fx * sweep, y, b.z + rz * w * span - fz * sweep, 0, 0,
            b.x - fx * s * 0.45 + rx * w * s * 0.1, y, b.z - fz * s * 0.45 + rz * w * s * 0.1, 0, 0, b.x - fx * s * 0.45 + rx * w * s * 0.1, y, b.z - fz * s * 0.45 + rz * w * s * 0.1, 0, 0, 0.07, 0.08, 0.1, 0.92, 1, 0);
        }
      }
      // 8. 💤 above every resting workplace (by order, or because its store is full): a billboard (screen-aligned, so it reads from the sofa) that bobs over the roof
      const BS = state.buildings;
      if (BS) {
        let ce = null;
        for (let i = 0; i < BS.length; i++) {
          const b = BS[i];
          if (!(b.paused || b.full) || b.ruined || (b.build != null && b.build < 1)) continue;
          const o = this.geom(b, this.G); if (!o) continue;
          if (!ce) { cam.updateMatrixWorld(); ce = cam.matrixWorld.elements; }
          const R = SIGN_R * (1 + 0.04 * Math.sin(t * 2.2 + b.id)), x = o.cx, z = o.cz, y = o.gy + o.h + 1.2 + R * 0.55 + 0.28 * Math.sin(t * 1.5 + b.id * 1.7);
          const rx = ce[0] * R, ry = ce[1] * R, rz = ce[2] * R, ux = ce[4] * R, uy = ce[5] * R, uz = ce[6] * R;   // the camera's right and up
          Q.q(x - rx - ux, y - ry - uy, z - rz - uz, -1, -1, x + rx - ux, y + ry - uy, z + rz - uz, 1, -1, x + rx + ux, y + ry + uy, z + rz + uz, 1, 1, x - rx + ux, y - ry + uy, z - rz + uz, -1, 1, 1, 1, 1, 1, 6, (b.id * 0.137) % 1);
        }
      }
      Q.flush();
    }

    // a dashed ground arrow with a head, following the terrain; the target gets a pulsing ring
    orderArrow(o, env, age) {
      const Q = this.Q, dx = o.tx - o.sx, dy = o.ty - o.sy, len = Math.hypot(dx, dy);
      if (len < 2.5 || env <= 0.01) return;
      const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, HEAD = 2.9, shaft = Math.max(0.5, len - HEAD), ns = clamp(Math.ceil(shaft / 2.4), 1, 26), W = 0.55;
      let px = o.sx, py = o.sy, pz = this.wy(px, py) + 0.16;
      for (let s = 1; s <= ns; s++) {
        const f = s / ns, qx = o.sx + ux * shaft * f, qy = o.sy + uy * shaft * f, qz = this.wy(qx, qy) + 0.16, d0 = shaft * (s - 1) / ns, d1 = shaft * f;
        Q.q(px + nx * W, pz, py + ny * W, d0, 1, qx + nx * W, qz, qy + ny * W, d1, 1, qx - nx * W, qz, qy - ny * W, d1, -1, px - nx * W, pz, py - ny * W, d0, -1, o.r * 1.15, o.g * 1.15, o.b * 1.15, 0.95 * env, 3, 0);
        px = qx; py = qy; pz = qz;
      }
      const bx = o.sx + ux * shaft, by = o.sy + uy * shaft, bz = this.wy(bx, by) + 0.17, tz = this.wy(o.tx, o.ty) + 0.17, HW = 1.25;
      // head: base corners at the end of the shaft, tip at the target (u 0 -> 1, v across; the 4th corner repeats the tip)
      Q.q(bx + nx * HW, bz, by + ny * HW, 0, 1, bx - nx * HW, bz, by - ny * HW, 0, -1, o.tx, tz, o.ty, 1, 0, o.tx, tz, o.ty, 1, 0, o.r * 1.15, o.g * 1.15, o.b * 1.15, 0.97 * env, 5, 0);
      const p = (age * 0.9) % 1, r = lerp(0.6, 2.9, p);      // the target's pulse ring is drawn directly (no pool slot)
      Q.q(o.tx - r, tz + 0.02, o.ty - r, -1, -1, o.tx + r, tz + 0.02, o.ty - r, 1, -1, o.tx + r, tz + 0.02, o.ty + r, 1, 1, o.tx - r, tz + 0.02, o.ty + r, -1, 1, o.r * 1.2, o.g * 1.2, o.b * 1.2, 0.85 * env, 2, p * 0.8);
    }
    // a ribbon arc between two keeps, in both lords' colours, drawn from A to B, then held, then fading
    arcRibbon(s, age, ex, ey, ez) {
      const Q = this.Q, N = 30, grow = clamp(age / 1.3, 0, 1), fade = 1 - sstep(3.1, 4.2, age), W = 0.55;
      if (fade <= 0.01) return;
      let px = 0, py = 0, pz = 0, ok = false;
      for (let i = 0; i <= N; i++) {
        const u = i / N * grow, x = lerp(s.ax, s.bx, u), z = lerp(s.az, s.bz, u), y = lerp(s.ay, s.by, u) + s.h * 4 * u * (1 - u);
        if (ok) {
          const dx = x - px, dy = y - py, dz = z - pz; let sx = dy * (ez - z) - dz * (ey - y), sy = dz * (ex - x) - dx * (ez - z), sz = dx * (ey - y) - dy * (ex - x); const sl = Math.hypot(sx, sy, sz) || 1, w = W / sl; sx *= w; sy *= w; sz *= w;
          const uu = (i - 0.5) / N, wob = 0.75 + 0.25 * Math.sin(this.t * 6 + i * 0.9);
          Q.q(px - sx, py - sy, pz - sz, 0, -1, x - sx, y - sy, z - sz, 0, -1, x + sx, y + sy, z + sz, 0, 1, px + sx, py + sy, pz + sz, 0, 1,
            lerp(s.ar, s.br, uu) * 1.25 * wob + 0.06, lerp(s.ag, s.bg, uu) * 1.25 * wob + 0.05, lerp(s.ab, s.bb, uu) * 1.25 * wob + 0.04, 0.95 * fade, 1, 0);
          if (this.dt > 0 && (i & 3) === 0 && rnd() < 0.5) this.A.spawn(x + rr(-0.3, 0.3), y + rr(-0.3, 0.3), z + rr(-0.3, 0.3), rr(-0.4, 0.4), rr(-0.8, 0.2), rr(-0.4, 0.4), rr(0.5, 0.9), 0.4, 0.08, K.GLITTER, 0.8 * fade, K.GOLD, 0, 0.4, 1, 0);
        }
        px = x; py = y; pz = z; ok = true;
      }
    }
  }

  window.FurtFx = FurtFx;
})();
