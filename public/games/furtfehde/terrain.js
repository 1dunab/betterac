// ===== Furt & Fehde terrain: ground, flowing water, vegetation, crossings (docs/FURTFEHDE.md "Terrain API") =====
// FurtTerrain(T, world, { quality }) builds one group: the ground mesh (smooth normals, colour from a painted map),
// ONE water mesh at surf(L) with a custom shader, instanced trees / stumps / rocks / deco, the bridges and the ruin.
//
// Conventions: three X = world x, Z = world y (south), Y up. Everything is in world units; the group sits at the origin.
// Handles for Phase 1 (fx, glue):
//   land.group, land.ground, land.water (meshes) · land.U (shared shader uniforms: uTime, uSurf, uFlood, uMem, uWetAmp, uSunDir, ...)
//   land.level / land.surf (current L and water height) · land.heightAt(x, y) · land.waterDepth(x, y) (> 0 = under water)
//   land.setLevel(L) every frame · land.update(t, dt, light) every frame · land.setTree / setTrees / setBlockers / setGround
// The water surface is a plane at surf(L) = L * FLOOD_Y: what is dry on screen is dry in the rules.
// Flooded bridges and Stege (Phase 1): the water shader gets the deck rectangles (land.decks) as uniforms; above a submerged deck the water is
// shallow and clear (the planks show) and carries white water: streaks along the current, foam lines at both parapets, a wake downstream.
(function () {
  'use strict';
  const FW = window.FurtWorld, FA = window.FurtArt;
  const GW = FW.GW, GH = FW.GH, HX = FW.HX, HY = FW.HY, FX = FW.FX, FY = FW.FY, FLOOD_Y = FW.FLOOD_Y;
  const X0 = -84, Y0 = -57, EXTX = 168, EXTY = 114, PX = 72, PY = 45;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const fract = (x) => x - Math.floor(x);
  const hash1 = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
  function hash2(x, y) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
  }
  const fbm = (x, y) => 0.55 * vnoise(x, y) + 0.3 * vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) + 0.15 * vnoise(x * 4.3 + 9.1, y * 4.3 + 7.7);

  // ---------- ground colour: height ramp (sRGB) + masks (forest floor, rock, cliff, reed) + noise + slope ----------
  const hex3 = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const RAMP = [
    [-1.7, '#2f5d63'], [-0.9, '#4c7c77'], [-0.5, '#8da37d'], [-0.22, '#cdbd8c'], [0.0, '#e4d198'], [0.1, '#d9c78c'], [0.24, '#b4bd62'],
    [0.5, '#76b848'], [1.2, '#7fbc48'], [1.7, '#9cc64c'], [2.7, '#acc455'], [3.6, '#a3b757'], [6.0, '#879f4b']
  ].map((r) => [r[0], hex3(r[1])]);
  function ramp(h, out) {
    let i = 0; while (i < RAMP.length - 2 && h > RAMP[i + 1][0]) i++;
    const a = RAMP[i], b = RAMP[i + 1], t = clamp((h - a[0]) / (b[0] - a[0]), 0, 1), dry = sstep(-0.3, 0.3, h);
    out[0] = lerp(a[1][0], b[1][0], t) * lerp(1, 0.84, dry); out[1] = lerp(a[1][1], b[1][1], t) * lerp(1, 0.9, dry); out[2] = lerp(a[1][2], b[1][2], t) * lerp(1, 0.8, dry);
  }
  const C_FOREST = hex3('#3c6a30'), C_PINE = hex3('#355a2e'), C_ROCK = hex3('#9b978b'), C_CLIFF = hex3('#8b7660'), C_REED = hex3('#86a44f'), C_SLOPE = hex3('#93805a');

  // vertex-grid mask (HX x HY) from a cell predicate: fraction of the four sub-cells around a vertex, then blurred
  function classMask(world, test, blur) {
    const m = new Float32Array(HX * HY), cls = world.cls;
    for (let v = 0; v < HY; v++) for (let u = 0; u < HX; u++) {
      const x = X0 + u / 2, y = Y0 + v / 2;
      let s = 0;
      for (let q = 0; q < 4; q++) {
        const cx = x + (q & 1 ? 0.25 : -0.25), cy = y + (q & 2 ? 0.25 : -0.25), i = Math.floor(cx + PX), j = Math.floor(cy + PY);
        if (i >= 0 && j >= 0 && i < GW && j < GH && test(cls[j * GW + i])) s++;
      }
      m[v * HX + u] = s / 4;
    }
    return blurMask(m, blur);
  }
  function blurMask(m, n) {
    let a = m, b = new Float32Array(m.length);
    for (let it = 0; it < n; it++) {
      for (let v = 0; v < HY; v++) for (let u = 0; u < HX; u++) {
        let s = 0, c = 0;
        for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) {
          const uu = u + du, vv = v + dv; if (uu < 0 || vv < 0 || uu >= HX || vv >= HY) continue;
          s += a[vv * HX + uu]; c++;
        }
        b[v * HX + u] = s / c;
      }
      const t = a; a = b; b = t;
    }
    return a;
  }

  // display heights: the generator's banks and ford bars have steps of a few decimetres within half a unit; a light blur below the flood
  // line (fading out above 2.4) keeps the shoreline and the foam on it smooth. Meshes, heightAt and the actors all use this field.
  function smoothHeights(H) {
    let a = Float32Array.from(H), b = new Float32Array(H.length);
    for (let it = 0; it < 2; it++) {
      for (let v = 0; v < HY; v++) for (let u = 0; u < HX; u++) { const i = v * HX + u; b[i] = (a[v * HX + Math.max(0, u - 1)] + 2 * a[i] + a[v * HX + Math.min(HX - 1, u + 1)]) / 4; }
      for (let v = 0; v < HY; v++) for (let u = 0; u < HX; u++) { const i = v * HX + u; a[i] = (b[Math.max(0, v - 1) * HX + u] + 2 * b[i] + b[Math.min(HY - 1, v + 1) * HX + u]) / 4; }
    }
    const out = new Float32Array(H.length);
    for (let i = 0; i < H.length; i++) out[i] = lerp(a[i], H[i], sstep(1.5, 2.6, H[i]));
    return out;
  }

  // painted colour map at vertex resolution (RGBA8, sRGB). Dry forest floor comes from the trees themselves (also in the border).
  function paintGround(world, H) {
    const px = new Uint8Array(HX * HY * 4);
    const wF = new Float32Array(HX * HY), wP = new Float32Array(HX * HY);
    for (const t of world.trees) {
      if (t.kind === 'weide') continue;
      const u0 = (t.x - X0) * 2, v0 = (t.y - Y0) * 2, R = 3.6, arr = t.kind === 'nadel' ? wP : wF;
      for (let v = Math.max(0, Math.ceil(v0 - R)); v <= Math.min(HY - 1, Math.floor(v0 + R)); v++) for (let u = Math.max(0, Math.ceil(u0 - R)); u <= Math.min(HX - 1, Math.floor(u0 + R)); u++) {
        const d = Math.hypot(u - u0, v - v0) / R; if (d >= 1) continue;
        arr[v * HX + u] += 0.5 * (1 - d) * (1 - d);
      }
    }
    for (let i = 0; i < wF.length; i++) { wF[i] = Math.min(1, wF[i]); wP[i] = Math.min(1, wP[i]); }
    const mRock = classMask(world, (c) => c === FW.CI.R, 2), mCliff = classMask(world, (c) => c === FW.CI.H, 2), mReed = classMask(world, (c) => c === FW.CI.M, 2);
    const c = [0, 0, 0];
    for (let v = 0; v < HY; v++) for (let u = 0; u < HX; u++) {
      const i = v * HX + u, x = X0 + u / 2, y = Y0 + v / 2, h = H[i];
      ramp(h, c);
      const gx = (H[v * HX + Math.min(HX - 1, u + 1)] - H[v * HX + Math.max(0, u - 1)]), gy = (H[Math.min(HY - 1, v + 1) * HX + u] - H[Math.max(0, v - 1) * HX + u]), slope = Math.hypot(gx, gy);
      const sl = sstep(0.5, 1.15, slope) * sstep(0.9, 1.5, h);   // steep dry flanks turn to earth and scree
      let r = lerp(c[0], C_SLOPE[0], sl * 0.8), g = lerp(c[1], C_SLOPE[1], sl * 0.8), b = lerp(c[2], C_SLOPE[2], sl * 0.8);
      const wd = Math.max(wF[i], wP[i]), fc = wP[i] > wF[i] ? C_PINE : C_FOREST, fk = wd * sstep(-0.1, 0.3, h);
      r = lerp(r, fc[0], fk * 0.92); g = lerp(g, fc[1], fk * 0.92); b = lerp(b, fc[2], fk * 0.92);
      const mr = mReed[i] * sstep(0.05, 0.25, h); r = lerp(r, C_REED[0], mr * 0.7); g = lerp(g, C_REED[1], mr * 0.7); b = lerp(b, C_REED[2], mr * 0.7);
      const mk = mRock[i]; r = lerp(r, C_ROCK[0], mk * 0.9); g = lerp(g, C_ROCK[1], mk * 0.9); b = lerp(b, C_ROCK[2], mk * 0.9);
      const mc = mCliff[i]; r = lerp(r, C_CLIFF[0], mc * 0.9); g = lerp(g, C_CLIFF[1], mc * 0.9); b = lerp(b, C_CLIFF[2], mc * 0.9);
      // painterly patches: slow tonal drift plus a warm/cool tint, weaker under water and on rock
      const n1 = fbm(x * 0.075 + 3.1, y * 0.075 - 1.7), n2 = fbm(x * 0.3 - 8.4, y * 0.3 + 2.2), dry = sstep(-0.3, 0.2, h) * (1 - mk * 0.7);
      const br = 1 + (n1 - 0.5) * 0.34 * dry + (n2 - 0.5) * 0.12 * dry, wm = (n2 - 0.5) * 0.12 * dry;
      px[i * 4] = clamp(r * br * (1 + wm), 0, 255); px[i * 4 + 1] = clamp(g * br, 0, 255); px[i * 4 + 2] = clamp(b * br * (1 - wm), 0, 255); px[i * 4 + 3] = 255;
    }
    return px;
  }

  // soft road strokes at 4 px per unit over the full extent (RGBA canvas)
  function paintRoads(world) {
    const cv = document.createElement('canvas'); cv.width = EXTX * 4; cv.height = EXTY * 4;
    const g = cv.getContext('2d');
    g.setTransform(4, 0, 0, 4, -X0 * 4, -Y0 * 4); g.lineCap = g.lineJoin = 'round';
    for (const [w, a] of [[2.3, 0.2], [1.7, 0.4], [1.15, 0.62], [0.7, 0.55]]) {
      g.lineWidth = w; g.strokeStyle = w < 0.8 ? 'rgba(206,176,122,' + a + ')' : 'rgba(184,152,102,' + a + ')';
      for (const r of world.roads) { g.beginPath(); r.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); }
    }
    return cv;
  }

  // tileable noise: rg = ripple slopes, b = height, a = blobby pattern for foam (periodic value noise)
  function paintNoise() {
    const N = 256, rnd = (n, s) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = hash1(i * 1.731 + s * 17.3); return a; };
    const L = { 6: rnd(6, 1), 8: rnd(8, 2), 12: rnd(12, 3), 16: rnd(16, 4), 24: rnd(24, 5), 32: rnd(32, 6), 14: rnd(14, 7) };
    const smp = (n, x, y) => {
      const gx = x / N * n, gy = y / N * n, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const A = L[n], i0 = ((ix % n) + n) % n, i1 = (i0 + 1) % n, j0 = ((iy % n) + n) % n, j1 = (j0 + 1) % n;
      return lerp(lerp(A[j0 * n + i0], A[j0 * n + i1], ux), lerp(A[j1 * n + i0], A[j1 * n + i1], ux), uy);
    };
    const hgt = new Float32Array(N * N), blob = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const r = 1 - Math.abs(2 * smp(12, x, y) - 1);
      hgt[y * N + x] = 0.42 * smp(8, x, y) + 0.26 * smp(16, x, y) + 0.12 * smp(32, x, y) + 0.2 * r * r;
      blob[y * N + x] = 0.55 * smp(6, x, y) + 0.3 * smp(14, x, y) + 0.15 * smp(24, x, y);
    }
    const px = new Uint8Array(N * N * 4), at = (x, y) => hgt[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 7.0, dy = (at(x, y + 1) - at(x, y - 1)) * 7.0, o = (y * N + x) * 4;
      px[o] = clamp(128 - dx * 127, 0, 255); px[o + 1] = clamp(128 - dy * 127, 0, 255); px[o + 2] = clamp(hgt[y * N + x] * 255, 0, 255); px[o + 3] = clamp(blob[y * N + x] * 255, 0, 255);
    }
    return { px, N };
  }

  // ---------- shaders ----------
  const GROUND_VPARS = 'varying vec3 vGW;\nvarying float vEdge;\nuniform vec2 uHazeR;\n';
  const GROUND_VMAIN = `
vGW = position;
vec2 eo = max(abs(position.xz) - vec2(72.0, 45.0), vec2(0.0));
vEdge = smoothstep(uHazeR.x, uHazeR.y, length(eo));
`;
  const GROUND_FPARS = `
varying vec3 vGW;
varying float vEdge;
uniform sampler2D tGround;
uniform sampler2D tRoad;
uniform sampler2D tDyn;
uniform sampler2D tNoise;
uniform float uSurf;
uniform float uMem;
uniform float uWetAmp;
uniform float uFlood;
uniform float uTime;
uniform vec3 uHaze;
`;
  const GROUND_FCOLOR = `
vec3 gcol = texture2D(tGround, vec2((vGW.x + 84.0) * 2.0 + 0.5, (vGW.z + 57.0) * 2.0 + 0.5) / vec2(337.0, 229.0)).rgb;
vec4 gn1 = texture2D(tNoise, vGW.xz * 0.11);
vec4 gn2 = texture2D(tNoise, vGW.xz * 0.58 + 0.3);
float gCloud = smoothstep(0.5, 0.74, texture2D(tNoise, vGW.xz * 0.013 + vec2(uTime * 0.0055, uTime * 0.0018)).a);   // slow cloud shadows drifting over the valley
gcol *= 1.0 - 0.12 * gCloud;
gcol *= 1.0 + (gn1.a - 0.5) * 0.2 + (gn2.b - 0.5) * 0.15;
gcol = mix(gcol, gcol * vec3(1.07, 1.0, 0.88), (gn1.a - 0.5) * 0.45);
vec4 gRoad = texture2D(tRoad, vec2(vGW.x + 84.0, vGW.z + 57.0) / vec2(168.0, 114.0));
gcol = mix(gcol, gRoad.rgb, gRoad.a * 0.9);
vec2 gDuv = vec2(vGW.x + 72.0, vGW.z + 45.0) / vec2(144.0, 90.0);
vec4 gDyn = texture2D(tDyn, clamp(gDuv, 0.0, 1.0)) * step(0.0, min(gDuv.x, gDuv.y)) * step(max(gDuv.x, gDuv.y), 1.0);
gcol = mix(gcol, vec3(0.045, 0.04, 0.036), gDyn.r * 0.9);
gcol = mix(gcol, vec3(0.50, 0.40, 0.27) * (0.8 + 0.4 * gcol.g), gDyn.g * 0.55);
gcol = mix(gcol, vec3(0.42, 0.31, 0.2), gDyn.b * 0.85);
float gAbove = vGW.y - uSurf;
float gShore = 1.0 - smoothstep(0.0, 0.16, gAbove);
float gRecent = uWetAmp * (1.0 - smoothstep(uMem - 0.55, uMem + 0.02, vGW.y)) * step(0.0, gAbove + 0.02);
float gWet = clamp(max(gShore * 0.9, gRecent), 0.0, 1.0);
gcol = mix(gcol, gcol * 0.6 + vec3(0.2, 0.14, 0.08) * 0.35, gWet * 0.85);
diffuseColor.rgb *= gcol;
`;
  const GROUND_FEND = 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, vEdge);\n';

  const WATER_VS = `
uniform float uSurf;
varying vec3 vW;
varying float vG;
void main() {
  vG = position.y;
  vW = vec3(position.x, uSurf, position.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}`;
  // depth = uSurf - ground height, interpolated over the very same triangles as the ground, so the shoreline is exact.
  // Two-phase flow map from tFlow, ripples from tNoise (rg = slopes, a = blobs), foam on shores / sandbanks / fords.
  const WATER_FS = `
varying vec3 vW;
varying float vG;
uniform float uTime, uSurf, uFlood, uQ;
uniform vec3 uSunDir, uSunCol, uAmb, uSky, uHaze;
uniform vec3 cShallow, cMid, cDeep, cMud, cMudG, cMudD, cFoam;
uniform sampler2D tFlow;
uniform sampler2D tNoise;
uniform vec4 uDeckA[4];
uniform vec4 uDeckB[4];
const float CYC = 2.4;
const float SPEED = 1.5;
vec4 flowTex(vec2 p, vec2 fl, vec2 sc, float off) {
  float ph = uTime / CYC + off;
  float p0 = fract(ph), p1 = fract(ph + 0.5);
  float w0 = 1.0 - abs(2.0 * p0 - 1.0);
  vec4 s0 = texture2D(tNoise, (p - fl * (p0 * CYC * SPEED)) * sc + vec2(0.13, 0.71) * off);
  vec4 s1 = texture2D(tNoise, (p - fl * (p1 * CYC * SPEED)) * sc + vec2(0.57, 0.29) + vec2(0.13, 0.71) * off);
  return mix(s1, s0, w0);
}
void main() {
  vec2 fl = texture2D(tFlow, vec2(vW.x + 84.0, vW.z + 57.0) / vec2(168.0, 114.0)).rg * 2.0 - 1.0;
  // flooded decks: once the surface lies above a deck, the deck is the local bed (shallow, clear water over the planks) and the current
  // breaks white over it: streaks along the flow, foam lines at the upstream and downstream parapet, a wake behind the bridge.
  // al = along the deck, ac = across it = along the current; side = which way the water leaves.
  float bed = vG, dFoam = 0.0, dChop = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 dA = uDeckA[i], dB = uDeckB[i];
    float sub = uSurf - dB.z;
    if (dB.x <= 0.0 || sub < -0.05) continue;
    vec2 dl = vW.xz - dA.xy;
    float al = dot(dl, dA.zw), ac = dl.y * dA.z - dl.x * dA.w;
    if (abs(al) > dB.x + 1.6 || abs(ac) > dB.y + 10.5) continue;
    float side = dot(fl, vec2(-dA.w, dA.z)) >= 0.0 ? 1.0 : -1.0, acs = ac * side;
    float onx = 1.0 - smoothstep(dB.x - 0.2, dB.x + 0.1, abs(al));
    float ons = smoothstep(-0.05, 0.0, sub);
    float on = onx * (1.0 - smoothstep(dB.y - 0.1, dB.y + 0.1, abs(ac))) * ons;
    bed = mix(bed, max(bed, dB.z), on);
    float up = -acs - dB.y, dn = acs - dB.y;                           // distance upstream / downstream of the deck's edges
    float wkx = 1.0 - smoothstep(dB.x - 0.6, dB.x + 1.2, abs(al));
    float n1 = texture2D(tNoise, vec2(al * 0.8 + 0.31 * float(i), acs * 0.11 - uTime * 0.9)).a;
    float n2 = texture2D(tNoise, vec2(al * 2.1 + 0.5, acs * 0.23 - uTime * 1.8)).a;
    float nm = mix(n1, n2, 0.5);
    float streak = smoothstep(0.45, 0.62, nm), loose = smoothstep(0.38, 0.7, nm);
    float fade = ons * mix(1.0, 0.75, smoothstep(0.3, 0.9, sub));     // deep water over the deck: calmer, but still white
    float deckWW = on * (0.1 + 0.9 * streak);
    float bow = onx * (1.0 - smoothstep(0.0, 0.9, abs(up + 0.2))) * (0.45 + 0.55 * loose);
    float spill = onx * (1.0 - smoothstep(0.0, 0.7, abs(dn))) * (0.55 + 0.45 * loose);
    float wake = wkx * smoothstep(0.0, 0.4, dn) * (1.0 - smoothstep(2.0, 9.0, dn)) * (0.2 + 0.8 * smoothstep(0.44, 0.64, mix(n1, n2, 0.7)));
    dFoam = max(dFoam, max(deckWW, max(max(bow, spill) * 0.92, wake * 0.85)) * fade);
    dChop = max(dChop, (on + wake) * fade);
  }
  float depth = uSurf - bed;
  if (depth < -0.03) discard;
  float spd = length(fl);
  vec2 p = vW.xz;
  float fast = 1.0 + 0.7 * (1.0 - smoothstep(0.1, 0.6, depth));
  vec2 flv = fl * fast;
  // ripple slopes: streaks along the flow (x- or y-elongated, picked by the flow direction) plus fine chop
  float ax = fl.x * fl.x, ay = fl.y * fl.y, wx = ax / (ax + ay + 1e-4);
  vec4 sA = flowTex(p, flv, vec2(0.05, 0.17), 0.0);
  vec2 sl = sA.rg - 0.5;
  float blob = sA.a;
  if (uQ > 0.5) {
    vec4 sB = flowTex(p, flv, vec2(0.17, 0.05), 0.31);
    vec4 sC = flowTex(p, flv * 1.3, vec2(0.21, 0.21), 0.67);
    sl = mix(sB.rg - 0.5, sA.rg - 0.5, wx) + (sC.rg - 0.5) * (0.7 - 0.5 * uFlood);
    blob = mix(sB.a, sA.a, wx);
  }
  float chop = (0.6 + 1.1 * spd + 0.15 * uFlood + 0.9 * dChop) * (uQ > 0.5 ? 1.0 : 1.5);
  vec3 n = normalize(vec3(sl.x * chop, 1.0, sl.y * chop));
  vec3 V = normalize(cameraPosition - vW);
  vec3 Ls = normalize(uSunDir);
  // colour by depth: clear over sand -> turquoise (wadeable, up to ~0.45) -> deep; olive silt, then brown with the flood
  float dd = max(depth, 0.0);
  vec3 col = mix(cShallow, cMid, smoothstep(0.28, 0.62, dd));
  col = mix(col, cDeep, smoothstep(0.55, 2.0, dd));
  float alpha = mix(0.34, 0.95, smoothstep(0.0, 1.4, dd));
  float flood = uFlood;
  // the flood is silt from the land it covers: strong over the floodplain, weaker in the channel
  float landy = smoothstep(-0.25, 0.35, vG);
  float mudAmt = flood * mix(0.82, 1.0, landy);
  // flood colours by depth: warm brown over the floodplain, olive in between, murky green-teal in the deep current (never grey)
  vec3 silt = mix(cMud, cMudG, smoothstep(0.15, 0.75, dd));
  silt = mix(silt, cMudD, smoothstep(0.8, 1.9, dd));
  float swirl = 0.7 + 0.7 * blob + 0.35 * (sl.x + sl.y);
  col = mix(col, silt * swirl, mudAmt * 0.92);
  alpha = mix(alpha, max(alpha, mix(0.5, 0.93, smoothstep(0.0, 0.7, dd))), mudAmt);
  // shading: flat water is lit by the sky and by the sun from above
  float sunUp = max(Ls.y, 0.0);
  float nl = clamp(dot(n, Ls), 0.0, 1.0);   // wave slopes facing the sun are lit, the others darker: this is what makes it read as water
  vec3 lit = uAmb + uSunCol * mix(0.35 * sunUp, nl, 0.6);
  float cloud = smoothstep(0.5, 0.74, texture2D(tNoise, vW.xz * 0.013 + vec2(uTime * 0.0055, uTime * 0.0018)).a);
  col *= lit * (0.84 + 0.28 * (blob - 0.5)) * (1.0 + 0.6 * (1.0 - smoothstep(0.25, 0.7, Ls.y))) * (1.0 - 0.12 * cloud);   // water stays readable under a low sun
  // sky sheen (fresnel) and sun glints (sharper normals than the shading uses, so sparkles show for every sun)
  float ndv = max(dot(n, V), 0.0);
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 4.0);
  col += uSky * (fres * (0.65 + 0.35 * (1.0 - flood)) + 0.1 * flood * (0.5 + n.z * 0.5 + 0.7 * length(sl)));   // muddy water still mirrors the sky a little
  vec3 H = normalize(Ls + V);
  vec3 ng = normalize(vec3(sl.x * 2.8, 1.0, sl.y * 2.8));
  float nh = max(dot(ng, H), 0.0);
  float glint = pow(nh, 200.0) * 2.2 + smoothstep(0.99, 1.0, nh) * 1.6 + pow(max(dot(n, H), 0.0), 36.0) * 0.18;
  glint *= smoothstep(0.03, 0.25, Ls.y) * (1.0 - flood * 0.35) * smoothstep(0.05, 0.4, dd);
  col += uSunCol * glint * 0.95;
  // foam: lapping shore line, around sandbanks (same thing: small depth), crisp white water on fast shallows (fords), flood froth
  float crest = smoothstep(0.11 + 0.03 * flood, 0.25 + 0.03 * flood, length(sl));
  float wob = (blob - 0.5) * 0.12 + 0.03 * sin(uTime * 1.3 + vW.x * 1.7 + vW.z * 1.3);
  float lap = 0.5 + 0.5 * sin(uTime * 1.5 + blob * 9.0);
  float shore = 1.0 - smoothstep(0.015, 0.2 + 0.05 * lap, depth + wob);
  float sandRim = (1.0 - smoothstep(0.0, 0.07, depth + wob * 0.5)) * 0.5;
  float shallow = 1.0 - smoothstep(0.3, 0.55, dd);
  float ford = shallow * smoothstep(0.3, 0.75, spd) * (crest * 0.95 + 0.1 * smoothstep(0.55, 0.75, blob));
  float froth = flood * smoothstep(0.15, 0.75, spd) * crest * 0.55 * (1.0 - smoothstep(1.0, 1.8, dd));
  float foam = clamp(max(max(max(shore * 0.85 + sandRim, ford * 0.85), froth), dFoam), 0.0, 1.0) * smoothstep(0.0, 0.02, depth);
  col = mix(col, cFoam * (uAmb + uSunCol * 0.5 * sunUp) * 1.15, foam);
  alpha = max(alpha, foam * 0.92);
  alpha *= smoothstep(0.0, 0.035, depth);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec2 eo = max(abs(vW.xz) - vec2(72.0, 45.0), vec2(0.0));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, smoothstep(3.0, 11.5, length(eo)));
}`;

  const TREE_KINDS = ['laub', 'nadel', 'weide'];
  function setTRS(arr, i, x, y, z, yaw, sc) {
    const c = Math.cos(yaw) * sc, s = Math.sin(yaw) * sc, o = i * 16;
    arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -s; arr[o + 3] = 0; arr[o + 4] = 0; arr[o + 5] = sc; arr[o + 6] = 0; arr[o + 7] = 0;
    arr[o + 8] = s; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0; arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }

  class FurtTerrain {
    constructor(T, world, opts) {
      opts = opts || {};
      this.T = T; this.world = world; this.quality = opts.quality === 'low' ? 'low' : 'high';
      this.group = new T.Group(); this.group.name = 'furt-terrain';
      this.level = 0; this.surf = 0; this.mem = 0; this.wetAmp = 0; this.dynDirty = false; this.t = 0;
      this.hidden = { trees: null, rocks: null, deco: null }; this.rects = [];
      this.treeF = new Float32Array(world.trees.length).fill(1); this.treeDirty = true;
      const col = (h) => new T.Color(h);
      this.U = {
        uTime: { value: 0 }, uSurf: { value: 0 }, uFlood: { value: 0 }, uMem: { value: 0 }, uWetAmp: { value: 0 }, uQ: { value: 1 },
        uSunDir: { value: new T.Vector3(0.4, 0.8, 0.3).normalize() }, uSunCol: { value: new T.Color(0.9, 0.85, 0.7) }, uAmb: { value: new T.Color(0.35, 0.4, 0.45) },
        uSky: { value: new T.Color('#9ec8ee') }, uHaze: { value: new T.Vector3(0.85, 0.88, 0.9) }, uHazeR: { value: new T.Vector2(3, 11.5) },
        cShallow: { value: col('#6cc9c4') }, cMid: { value: col('#2aa0bf') }, cDeep: { value: col('#0e5f86') }, cMud: { value: col('#b08648') }, cMudG: { value: col('#86904c') }, cMudD: { value: col('#41705f') }, cFoam: { value: col('#f6f3e8') },
        tGround: { value: null }, tRoad: { value: null }, tDyn: { value: null }, tFlow: { value: null }, tNoise: { value: null },
        // up to 4 decks: A = centre x, z + axis x, z; B = half length, half width, deck top y, 0 (half length 0 = unused)
        uDeckA: { value: [0, 1, 2, 3].map(() => new T.Vector4(0, 0, 1, 0)) }, uDeckB: { value: [0, 1, 2, 3].map(() => new T.Vector4(0, 0, 9, 0)) }
      };
      this._buildTextures();
      this._build();
    }

    // ---------- textures (independent of the quality) ----------
    _buildTextures() {
      const T = this.T, w = this.world, U = this.U;
      this.display = smoothHeights(w.heights);
      const g = new T.DataTexture(paintGround(w, this.display), HX, HY, T.RGBAFormat, T.UnsignedByteType);
      g.colorSpace = T.SRGBColorSpace; g.magFilter = T.LinearFilter; g.minFilter = T.LinearFilter; g.generateMipmaps = false; g.needsUpdate = true;
      const r = new T.CanvasTexture(paintRoads(w)); r.colorSpace = T.SRGBColorSpace; r.minFilter = T.LinearMipmapLinearFilter; r.generateMipmaps = true; r.anisotropy = 4;
      this.dyn = new Uint8Array(GW * GH * 4);
      const d = new T.DataTexture(this.dyn, GW, GH, T.RGBAFormat, T.UnsignedByteType);
      d.magFilter = T.LinearFilter; d.minFilter = T.LinearFilter; d.generateMipmaps = false; d.needsUpdate = true;
      const fp = new Uint8Array(FX * FY * 4);
      for (let i = 0; i < FX * FY; i++) { fp[i * 4] = clamp(Math.round((w.flow[i * 2] * 0.5 + 0.5) * 255), 0, 255); fp[i * 4 + 1] = clamp(Math.round((w.flow[i * 2 + 1] * 0.5 + 0.5) * 255), 0, 255); fp[i * 4 + 3] = 255; }
      const f = new T.DataTexture(fp, FX, FY, T.RGBAFormat, T.UnsignedByteType);
      f.magFilter = T.LinearFilter; f.minFilter = T.LinearFilter; f.generateMipmaps = false; f.needsUpdate = true;
      const nz = paintNoise(), n = new T.DataTexture(nz.px, nz.N, nz.N, T.RGBAFormat, T.UnsignedByteType);
      n.wrapS = n.wrapT = T.RepeatWrapping; n.magFilter = T.LinearFilter; n.minFilter = T.LinearMipmapLinearFilter; n.generateMipmaps = true; n.anisotropy = 4; n.needsUpdate = true;
      U.tGround.value = g; U.tRoad.value = r; U.tDyn.value = d; U.tFlow.value = f; U.tNoise.value = n;
      this.tex = [g, r, d, f, n];
    }

    // ---------- geometry and instances (rebuilt on a quality switch) ----------
    _build() {
      const T = this.T, q = this.quality, hi = q === 'high', w = this.world, U = this.U;
      U.uQ.value = hi ? 1 : 0;
      // height grid used for the mesh: high keeps every vertex inside the playable rectangle and every second one in the border ring,
      // low uses every second vertex everywhere
      const res = hi ? 2 : 1, nu = hi ? HX : (HX + 1) / 2, nv = hi ? HY : (HY + 1) / 2, step = hi ? 1 : 2, hg = new Float32Array(nu * nv);
      const hd = this.display;
      for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) hg[v * nu + u] = hd[v * step * HX + u * step];
      const u0 = 12 * res, u1 = nu - 1 - 12 * res, v0 = 12 * res, v1 = nv - 1 - 12 * res;   // the fine rectangle in vertex indices (x -72..72, y -45..45)
      // seam: odd vertices on the rectangle's edge sit on the coarse edge (2 vertices per coarse quad), so the two meshes meet without cracks
      for (let u = u0 + 1; u < u1; u += 2) { hg[v0 * nu + u] = (hg[v0 * nu + u - 1] + hg[v0 * nu + u + 1]) / 2; hg[v1 * nu + u] = (hg[v1 * nu + u - 1] + hg[v1 * nu + u + 1]) / 2; }
      for (let v = v0 + 1; v < v1; v += 2) { hg[v * nu + u0] = (hg[(v - 1) * nu + u0] + hg[(v + 1) * nu + u0]) / 2; hg[v * nu + u1] = (hg[(v - 1) * nu + u1] + hg[(v + 1) * nu + u1]) / 2; }
      this.grid = { h: hg, nu, nv, res };
      const pos = new Float32Array(nu * nv * 3), nrm = new Float32Array(nu * nv * 3), E = 1.25;
      for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
        const i = v * nu + u, o = i * 3, ua = Math.max(0, u - 1), ub = Math.min(nu - 1, u + 1), va = Math.max(0, v - 1), vb = Math.min(nv - 1, v + 1);
        pos[o] = X0 + u / res; pos[o + 1] = hg[i]; pos[o + 2] = Y0 + v / res;
        const gx = (hg[v * nu + ub] - hg[v * nu + ua]) / ((ub - ua) / res), gz = (hg[vb * nu + u] - hg[va * nu + u]) / ((vb - va) / res);
        const nx = -gx * E, nz = -gz * E, il = 1 / Math.hypot(nx, 1, nz);
        nrm[o] = nx * il; nrm[o + 1] = il; nrm[o + 2] = nz * il;
      }
      const quad = (idx, u, v, s) => {   // two triangles per quad, diagonal by parity (shared by ground and water)
        const a = v * nu + u, b = a + s, c = a + s * nu, d = c + s;
        if (((u / s) + (v / s)) & 1) idx.push(a, c, d, a, d, b); else idx.push(a, c, b, b, c, d);
      };
      const cells = [];   // [u, v, size] of every ground quad
      for (let v = v0; v < v1; v++) for (let u = u0; u < u1; u++) cells.push(u, v, 1);
      for (let v = 0; v < nv - 1; v += 2) for (let u = 0; u < nu - 1; u += 2) { if (u >= u0 && u < u1 && v >= v0 && v < v1) continue; cells.push(u, v, 2); }
      const gi = [], wq = [];
      for (let c = 0; c < cells.length; c += 3) {
        const u = cells[c], v = cells[c + 1], s = cells[c + 2], a = v * nu + u;
        quad(gi, u, v, s);
        const mn = Math.min(hg[a], hg[a + s], hg[a + s * nu], hg[a + s * nu + s]);
        if (mn < FLOOD_Y + 0.03) wq.push(c, mn);
      }
      // water index sorted by the lowest corner: at level L the quads below surf(L) are a prefix (draw range), so a low river costs few triangles
      const order = []; for (let k = 0; k < wq.length; k += 2) order.push(k);
      order.sort((a, b) => wq[a + 1] - wq[b + 1]);
      const wi = [], wmin = new Float32Array(order.length);
      order.forEach((k, n) => { const c = wq[k]; quad(wi, cells[c], cells[c + 1], cells[c + 2]); wmin[n] = wq[k + 1]; });
      this.wmin = wmin;
      const posAttr = new T.BufferAttribute(pos, 3);
      const gg = new T.BufferGeometry(); gg.setAttribute('position', posAttr); gg.setAttribute('normal', new T.BufferAttribute(nrm, 3)); gg.setIndex(new T.BufferAttribute(new Uint32Array(gi), 1));
      gg.computeBoundingSphere(); gg.computeBoundingBox();
      const wg = new T.BufferGeometry(); wg.setAttribute('position', posAttr); wg.setIndex(new T.BufferAttribute(new Uint32Array(wi), 1));
      wg.boundingSphere = gg.boundingSphere; wg.boundingBox = gg.boundingBox;
      // materials: the ground is a patched Standard (high) / Lambert (low) material so it takes lights and shadows like the art models
      const gm = hi ? new T.MeshStandardMaterial({ roughness: 1, metalness: 0 }) : new T.MeshLambertMaterial({});
      gm.onBeforeCompile = (sh) => {
        for (const k of ['uSurf', 'uMem', 'uWetAmp', 'uFlood', 'uTime', 'uHaze', 'uHazeR', 'tGround', 'tRoad', 'tDyn', 'tNoise']) sh.uniforms[k] = U[k];
        sh.vertexShader = sh.vertexShader.replace('void main() {', GROUND_VPARS + 'void main() {').replace('#include <begin_vertex>', '#include <begin_vertex>\n' + GROUND_VMAIN);
        sh.fragmentShader = sh.fragmentShader.replace('void main() {', GROUND_FPARS + 'void main() {').replace('#include <color_fragment>', '#include <color_fragment>\n' + GROUND_FCOLOR)
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + GROUND_FEND);
      };
      gm.customProgramCacheKey = () => 'furt-ground-' + q;
      this.ground = new T.Mesh(gg, gm); this.ground.name = 'ground'; this.ground.receiveShadow = hi; this.ground.frustumCulled = false;
      const wu = {}; for (const k of ['uTime', 'uSurf', 'uFlood', 'uQ', 'uSunDir', 'uSunCol', 'uAmb', 'uSky', 'uHaze', 'cShallow', 'cMid', 'cDeep', 'cMud', 'cMudG', 'cMudD', 'cFoam', 'tFlow', 'tNoise', 'uDeckA', 'uDeckB']) wu[k] = U[k];
      const wm = new T.ShaderMaterial({ vertexShader: WATER_VS, fragmentShader: WATER_FS, uniforms: wu, transparent: true, depthWrite: false, fog: false });
      this.water = new T.Mesh(wg, wm); this.water.name = 'water'; this.water.frustumCulled = false; this.water.renderOrder = 6;
      this.group.add(this.ground, this.water);
      this._waterRange();
      this._buildVegetation();
      this._buildStructures();
      this.setBlockers(this.rects);
      this.treeDirty = true; this._rebuildTrees();
    }
    _waterRange() {
      const m = this.wmin, lim = this.surf + 0.03;
      let lo = 0, hi = m.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (m[mid] < lim) lo = mid + 1; else hi = mid; }
      this.water.geometry.setDrawRange(0, lo * 6); this.water.visible = lo > 0;
    }

    _buildVegetation() {
      const T = this.T, w = this.world, q = this.quality, hi = q === 'high';
      this.veg = new T.Group(); this.veg.name = 'vegetation'; this.group.add(this.veg);
      const out = (x, y) => Math.hypot(Math.max(Math.abs(x) - PX, 0), Math.max(Math.abs(y) - PY, 0));
      const cls = w.cls, CT = FW.CI.T, maxOut = hi ? 8.8 : 5.5;
      // trees: per kind and detail level a full-tree mesh, a stump mesh and (high, inside the shadow map only) a ~8 triangle shadow stand-in
      // sharing the full mesh's matrices. Forest and border trees use the low-poly model (they are seen as a mass), meadow trees and willows the full one.
      this.tsets = [];
      const proxyGeo = {
        laub: new T.OctahedronGeometry(1.3, 0).translate(0, 3.0, 0), nadel: new T.ConeGeometry(1.0, 3.4, 4, 1, true).translate(0, 2.0, 0),
        weide: new T.OctahedronGeometry(1.25, 0).scale(1, 0.62, 1).translate(0, 2.2, 0)
      };
      for (const kind of TREE_KINDS) for (const variant of ['high', 'low']) {
        if (variant === 'high' && !hi) continue;
        const ins = [], outs = [];
        w.trees.forEach((t, i) => {
          if (t.kind !== kind) return;
          const d = out(t.x, t.y); if (d > maxOut) return;
          const forest = t.k < 0 || cls[t.k] === CT, v = hi ? (forest ? 'low' : 'high') : 'low';
          if (v !== variant) return;
          if (!hi && hash1(i * 3.7 + 1) > 0.5) return;
          (d <= 0.01 ? ins : outs).push(i);
        });
        const ids = ins.concat(outs), n = ids.length; if (!n) continue;
        const art = FA.tree(T, kind, { quality: variant });
        const full = new T.InstancedMesh(art.geometry, art.material, n), stump = new T.InstancedMesh(art.stump.geometry, art.stump.material, n);
        for (const m of [full, stump]) { m.frustumCulled = false; m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.count = 0; m.receiveShadow = hi; }
        const info = new Float32Array(n * 6), tint = new T.Color();
        ids.forEach((id, j) => {
          const t = w.trees[id], d = out(t.x, t.y), fade = 1 - sstep(3.2, maxOut, d), h = this.heightAt(t.x, t.y);
          info[j * 6] = t.x; info[j * 6 + 1] = h - 0.04; info[j * 6 + 2] = t.y; info[j * 6 + 3] = hash1(id * 1.9 + 3) * 6.2832; info[j * 6 + 4] = t.s * (0.92 + 0.1 * hash1(id * 5.1)) * Math.max(0.05, fade); info[j * 6 + 5] = hash1(id * 2.3);
          const k = info[j * 6 + 5]; tint.setRGB(0.93 + 0.12 * k, 0.96 + 0.08 * (1 - k), 0.88 + 0.16 * hash1(id * 9.1)); full.setColorAt(j, tint);
        });
        const S = { kind, variant, ids, info, full, stump, n, nIn: ins.length, proxy: null, tint: full.instanceColor.array.slice() };
        this.tsets.push(S); this.veg.add(full, stump);
        if (hi && ins.length) {
          const proxy = new T.InstancedMesh(proxyGeo[kind], new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), n);
          proxy.instanceMatrix = full.instanceMatrix; proxy.frustumCulled = false; proxy.castShadow = true; proxy.count = 0;
          S.proxy = proxy; this.veg.add(proxy);
        }
      }
      for (const k in proxyGeo) if (!hi) proxyGeo[k].dispose();
      this.proxyGeo = hi ? proxyGeo : null;
      // rocks (3 variants) and boulders on the cliff cells, decor (4 kinds): static instances, hidden under buildings
      const crags = [];
      for (let k = 0; k < GW * GH; k++) if (cls[k] === FW.CI.H) {
        const c = FW.cellXY(k);
        for (let n = 0; n < 2; n++) crags.push({ x: c.x + (hash1(k * 3.7 + n) - 0.5) * 0.9, y: c.y + (hash1(k * 5.3 + n * 2) - 0.5) * 0.9, s: 1.0 + 0.9 * hash1(k * 9.7 + n), k });
      }
      this.rockList = w.rocks.concat(crags);
      const items = (list, pred) => { const a = []; list.forEach((o, i) => { if (pred(o, i)) a.push(i); }); return a; };
      this.rk = [];
      for (let v = 0; v < (hi ? 3 : 1); v++) {   // low: one rock model only (fewer draw calls)
        const ids = items(this.rockList, (r, i) => (hi ? i % 3 === v : true) && out(r.x, r.y) <= maxOut && (hi || hash1(i * 4.1) < 0.5)), art = FA.rock(T, { variant: v, quality: q });
        this._staticSet(this.rk, art, ids, this.rockList, (r, i) => ({ s: r.s, yaw: hash1(i * 2.9) * 6.28, dy: -0.04 }), 'rocks');
      }
      this.dk = [];
      const keepOf = { schilf: hi ? 1 : 0.5, blume: hi ? 0.55 : 0.3, stein: 1, busch: hi ? 1 : 0.5 };
      for (const kind of hi ? ['schilf', 'blume', 'stein', 'busch'] : ['schilf', 'blume', 'busch']) {
        const art = FA.deco(T, kind, { quality: q });
        const ids = items(w.deco, (o, i) => o.kind === kind && out(o.x, o.y) <= maxOut && hash1(i * 1.3 + 7) <= keepOf[kind]);
        this._staticSet(this.dk, art, ids, w.deco, (o, i) => ({ s: o.s * (kind === 'schilf' ? 1.1 : 1.0), yaw: hash1(i * 3.3) * 6.28, dy: kind === 'schilf' ? -0.05 : 0 }), 'deco');
      }
    }
    _staticSet(store, art, ids, list, mk, hideKey) {
      const T = this.T, n = ids.length;
      if (!n) { store.push({ mesh: null, ids, info: new Float32Array(0), n: 0, hideKey }); return; }
      const mesh = new T.InstancedMesh(art.geometry, art.material, n);
      mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; mesh.receiveShadow = this.quality === 'high'; mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      const info = new Float32Array(n * 5), tint = new T.Color();
      ids.forEach((id, j) => {
        const o = list[id], p = mk(o, id), h = this.heightAt(o.x, o.y);
        info[j * 5] = o.x; info[j * 5 + 1] = h + p.dy; info[j * 5 + 2] = o.y; info[j * 5 + 3] = p.yaw; info[j * 5 + 4] = p.s;
        const k = hash1(id * 6.1); tint.setRGB(0.92 + 0.14 * k, 0.94 + 0.1 * (1 - k), 0.9 + 0.12 * hash1(id * 8.3)); mesh.setColorAt(j, tint);
      });
      this.veg.add(mesh);
      store.push({ mesh, ids, info, n, hideKey, tint: mesh.instanceColor.array.slice() });
    }

    _buildStructures() {
      const T = this.T, w = this.world, q = this.quality;
      this.struct = new T.Group(); this.struct.name = 'structures'; this.group.add(this.struct);
      this.bridges = {}; this.decks = [];
      for (const c of w.crossings) {
        if (c.kind === 'furt') continue;
        const b = FA.bridge(T, { kind: c.kind === 'steg' ? 'steg' : 'stein', len: c.len, quality: q });
        b.group.position.set(c.x, c.deck != null ? c.deck : 0.5, c.y); b.group.rotation.y = -c.rot; b.group.name = 'bridge-' + c.id;
        this.struct.add(b.group); this.bridges[c.id] = b;
        this.decks.push({ x: c.x, y: c.y, ux: Math.cos(c.rot), uy: Math.sin(c.rot), half: c.len / 2, wide: 1.15, deck: c.deck != null ? c.deck : 0.5 });
      }
      for (let i = 0; i < 4; i++) {
        const d = this.decks[i], A = this.U.uDeckA.value[i], B = this.U.uDeckB.value[i];
        if (d) { A.set(d.x, d.y, d.ux, d.uy); B.set(d.half, d.wide, d.deck, 0); } else { A.set(0, 0, 1, 0); B.set(0, 0, 9, 0); }
      }
      const ru = FA.ruin(T, { quality: q });
      ru.group.position.set(w.werder.tower.x, this.heightAt(w.werder.tower.x, w.werder.tower.y) - 0.02, w.werder.tower.y); ru.group.rotation.y = 0.6; ru.group.name = 'ruin';
      this.struct.add(ru.group); this.ruin = ru;
    }

    // ---------- instance buffers ----------
    _rebuildTrees() {
      const hid = this.hidden.trees, F = this.treeF;
      for (const K of this.tsets) {
        let nf = 0, ns = 0, nin = 0;
        const fa = K.full.instanceMatrix.array, sa = K.stump.instanceMatrix.array, fc = K.full.instanceColor;
        for (let j = 0; j < K.n; j++) {
          const id = K.ids[j]; if (hid && hid[id]) continue;
          const f = F[id], o = j * 6, x = K.info[o], y = K.info[o + 1], z = K.info[o + 2], yaw = K.info[o + 3], s = K.info[o + 4];
          if (f > 0.03) {
            setTRS(fa, nf, x, y, z, yaw, s * (f >= 0.999 ? 1 : lerp(0.22, 1, f)));
            fc.array[nf * 3] = K.tint[j * 3]; fc.array[nf * 3 + 1] = K.tint[j * 3 + 1]; fc.array[nf * 3 + 2] = K.tint[j * 3 + 2];
            if (j < K.nIn) nin = nf + 1;
            nf++;
          } else { setTRS(sa, ns, x, y, z, yaw, s); ns++; }
        }
        K.full.count = nf; K.stump.count = ns; K.full.visible = nf > 0; K.stump.visible = ns > 0;
        K.full.instanceMatrix.needsUpdate = true; K.stump.instanceMatrix.needsUpdate = true; fc.needsUpdate = true;
        if (K.proxy) { K.proxy.count = nin; K.proxy.visible = nin > 0; }
      }
      this.treeDirty = false;
    }
    _rebuildStatic(S) {
      if (!S.n) return;
      const hid = this.hidden[S.hideKey]; let n = 0;
      const a = S.mesh.instanceMatrix.array, ca = S.mesh.instanceColor, base = S.tint;
      for (let j = 0; j < S.n; j++) {
        if (hid && hid[S.ids[j]]) continue;
        const o = j * 5; setTRS(a, n, S.info[o], S.info[o + 1], S.info[o + 2], S.info[o + 3], S.info[o + 4]);
        ca.array[n * 3] = base[j * 3]; ca.array[n * 3 + 1] = base[j * 3 + 1]; ca.array[n * 3 + 2] = base[j * 3 + 2]; n++;
      }
      S.mesh.count = n; S.mesh.visible = n > 0; S.mesh.instanceMatrix.needsUpdate = true; ca.needsUpdate = true;
    }

    // ---------- public API ----------
    heightAt(x, y) {
      const g = this.grid, u = clamp((x - X0) * g.res, 0, g.nu - 1), v = clamp((y - Y0) * g.res, 0, g.nv - 1);
      const u0 = Math.min(Math.floor(u), g.nu - 2), v0 = Math.min(Math.floor(v), g.nv - 2), fu = u - u0, fv = v - v0, h = g.h, a = v0 * g.nu + u0;
      const p = h[a], q = h[a + 1], r = h[a + g.nu], s = h[a + g.nu + 1];
      return p + (q - p) * fu + (r - p) * fv + (p - q - r + s) * fu * fv;
    }
    // where a walker stands: the ground, or the deck while it is on a bridge or Steg (world.heights has no decks, the river bed lies beneath them)
    standY(x, y) {
      let h = this.heightAt(x, y);
      for (const d of this.decks) {
        const dx = x - d.x, dy = y - d.y, along = dx * d.ux + dy * d.uy, across = -dx * d.uy + dy * d.ux;
        if (Math.abs(along) <= d.half && Math.abs(across) <= d.wide && d.deck > h) h = d.deck;
      }
      return h;
    }
    waterDepth(x, y) { return this.surf - this.heightAt(x, y); }
    setLevel(L) {
      L = clamp(+L || 0, 0, 1);
      const moved = L !== this.level; this.level = L; this.surf = FW.surf(L);
      this.U.uSurf.value = this.surf; this.U.uFlood.value = sstep(0.12, 0.95, L);
      if (moved || !this._rangeSet) { this._waterRange(); this._rangeSet = true; }
    }
    // trees: 1 = full, 0 = stump, in between a sapling (scaled). Bulk form takes a Float32Array of the whole world's trees.
    setTree(id, f) { if (id >= 0 && id < this.treeF.length) { const v = clamp(+f, 0, 1); if (this.treeF[id] !== v) { this.treeF[id] = v; this.treeDirty = true; } } }
    setTrees(arr) { if (!arr) return; const n = Math.min(arr.length, this.treeF.length); for (let i = 0; i < n; i++) { const v = clamp(arr[i], 0, 1); if (this.treeF[i] !== v) { this.treeF[i] = v; this.treeDirty = true; } } }
    // rects = [{x0, y0, x1, y1}] (world units): trees, rocks and decor inside are hidden (buildings stand there)
    setBlockers(rects) {
      this.rects = rects || [];
      const w = this.world, R = this.rects, mk = (list, pad) => {
        const a = new Uint8Array(list.length);
        if (R.length) for (let i = 0; i < list.length; i++) {
          const o = list[i];
          for (let r = 0; r < R.length; r++) { const q = R[r]; if (o.x > q.x0 - pad && o.x < q.x1 + pad && o.y > q.y0 - pad && o.y < q.y1 + pad) { a[i] = 1; break; } }
        }
        return a;
      };
      this.hidden.trees = mk(w.trees, 0.8); this.hidden.rocks = mk(this.rockList, 0.4); this.hidden.deco = mk(w.deco, 0.3);
      this.treeDirty = true;
      for (const S of this.rk) this._rebuildStatic(S);
      for (const S of this.dk) this._rebuildStatic(S);
    }
    // dynamic ground layer (GW x GH cells): burnt = scorched, path = trampled, plot = construction dirt (0..1 each)
    setGround(k, o) {
      if (!(k >= 0 && k < GW * GH) || !o) return;
      const d = this.dyn, i = k * 4;
      if (o.burnt != null) d[i] = Math.round(clamp(o.burnt, 0, 1) * 255);
      if (o.path != null) d[i + 1] = Math.round(clamp(o.path, 0, 1) * 255);
      if (o.plot != null) d[i + 2] = Math.round(clamp(o.plot, 0, 1) * 255);
      this.dynDirty = true;
    }
    resetWet() { this.mem = this.surf; this.wetAmp = 0; }
    getGround(k) { const d = this.dyn, i = k * 4; return { burnt: d[i] / 255, path: d[i + 1] / 255, plot: d[i + 2] / 255 }; }
    // t seconds, dt seconds; light = { sunDir (toward the sun), sunCol, amb, sky (THREE.Color, linear), haze (sRGB Vector3/Color) }
    update(t, dt, light) {
      const U = this.U; light = light || {};
      dt = clamp(dt || 0, 0, 0.25); this.t = t;
      U.uTime.value = t;
      if (light.sunDir) U.uSunDir.value.copy(light.sunDir);
      if (light.sunCol) U.uSunCol.value.copy(light.sunCol);
      if (light.amb) U.uAmb.value.copy(light.amb);
      if (light.sky) U.uSky.value.copy(light.sky);
      if (light.haze) U.uHaze.value.set(light.haze.r != null ? light.haze.r : light.haze.x, light.haze.g != null ? light.haze.g : light.haze.y, light.haze.b != null ? light.haze.b : light.haze.z);
      // wet ground: remember the high-water mark and let it sink slowly, so the ground stays dark where the flood has just left
      const surf = this.surf;
      if (surf > this.mem) this.mem = surf; else this.mem = Math.max(surf, this.mem - dt * 0.014);
      this.wetAmp = this.level > 0.03 ? 1 : Math.max(0, this.wetAmp - dt / 70);
      if (this.mem <= surf + 0.001) this.wetAmp = Math.min(this.wetAmp, this.level > 0.03 ? 1 : 0);
      U.uMem.value = this.mem; U.uWetAmp.value = this.wetAmp;
      if (this.dynDirty) { U.tDyn.value.needsUpdate = true; this.dynDirty = false; }
      if (this.treeDirty) this._rebuildTrees();
    }
    get stats() { return FA.stats(this.group); }
    setQuality(q) {
      q = q === 'low' ? 'low' : 'high'; if (q === this.quality) return;
      this._disposeBuild(); this.quality = q; this._build();
    }
    _disposeBuild() {
      this.group.remove(this.ground, this.water, this.veg, this.struct);
      this.ground.geometry.dispose(); this.ground.material.dispose(); this.water.geometry.dispose(); this.water.material.dispose();
      this.veg.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      for (const K of this.tsets) if (K.proxy) K.proxy.material.dispose();
      if (this.proxyGeo) for (const k in this.proxyGeo) this.proxyGeo[k].dispose();
      this.rk = []; this.dk = []; this.tsets = []; this._rangeSet = false;
    }
    dispose() {
      this._disposeBuild();
      for (const t of this.tex) t.dispose();
    }
  }

  window.FurtTerrain = FurtTerrain;
})();
