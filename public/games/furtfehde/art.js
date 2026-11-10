// ===== Furt & Fehde art (procedural three.js models) ============
// Pure model factories for docs/FURTFEHDE.md "Art API": keeps, buildings, instanced units,
// banners, trees, rocks, deco, bridges, the ruin and props. Warm low-poly, flat shaded,
// vertex colours, merged into as few meshes as possible. Plain script: THREE is passed in
// as the first argument of every factory (no import). Exports window.FurtArt.
//
// How the renderer uses it
//   FurtArt.tick(t)          once per frame, t in seconds (flags, sway, unit animation, flicker)
//   FurtArt.setNight(n01)    glow of windows, torches and flames (0 day .. 1 night)
//   building()/keep()/banner()  each call makes ONE new material (shared program), so the lord colour,
//                            construction progress, damage, burn and growth are per-object uniforms.
//                            Never replace or clone these materials (they carry onBeforeCompile patches).
//   tree()/rock()/deco()     {geometry, material}: shared per quality, use them in an InstancedMesh
//                            (instanceColor tints are honoured, sway phase comes from the instance position).
//   units().create(kind,max) one InstancedMesh per kind; set(i,x,y,z,yaw,anim,phase,rgb,carry):
//                            x,y,z in scene space (y up), yaw = rotation about +y (pass -heading),
//                            anim 0 idle 1 walk 2 fight 3 work, phase in turns (any number, e.g. an id hash),
//                            rgb 0xRRGGBB or '#rrggbb', carry 0 none 1 korn 2 holz 3 stein 4 eimer (bauer only).
//
// Shader attributes (all geometry from here carries them)
//   aTeam  (0..1)  per vertex: the surface takes the lord colour, final = mix(vertexColor, team, aTeam)
//   aGlow  (0..)   per vertex: emissive factor, scaled by the shared night uniform (windows, torches)
//   aWear  (0..1)  per triangle random: soot patches (damage), embers (burnt)
//   aRig   (vec4)  xyz = pivot, w = part id (flag, roof, crops, boom, units' limbs, sway weight)
//   units add per instance: aInst (anim, phase, carry, 0) and aTeamCol (linear rgb)
//   uniforms: shared uTime, uGlow; per material uTeam, uBuild, uGrowth, uWork, uMoving, uDmg, uBurnt (+ uKind, uDims for units)
// ================================================================
(function () {
  'use strict';
  const PI = Math.PI, TAU = PI * 2, sin = Math.sin, cos = Math.cos, abs = Math.abs, sqrt = Math.sqrt;
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
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ---------- palette (warm, saturated but soft: a painted tabletop in late-afternoon sun) ----------
  const palette = {
    thatch: '#dcb24c', thatchDark: '#b88b32', thatchOld: '#a98a3c', straw: '#e6c868',
    timber: '#8a5a34', timberDark: '#5a3920', timberLight: '#b98a55', plank: '#c18c52', plankDark: '#8d5f34',
    plaster: '#eadbb8', plasterWarm: '#e2c694', wattle: '#c9a574',
    stone: '#a49b88', stoneDark: '#756e60', stoneLight: '#cbc2a8', cobble: '#968e7d', mortar: '#d6cdb4',
    roofTile: '#c4553a', roofTileDark: '#963b28', slate: '#566174', shingle: '#a07c52',
    grass: '#6fae45', grassLight: '#98c855', grassDark: '#4a8b3a', dirt: '#9a7448', soil: '#5c3d26', furrow: '#6f4a2c', sand: '#d8c58f',
    leaf: '#5f9d3c', leafLight: '#90c04c', leafDark: '#3e7a34', pine: '#2f6b45', pineLight: '#43875a', bark: '#6b4a30', willow: '#9cc255', willowDark: '#7aa63f',
    rock: '#8d877c', rockDark: '#625d56', rockLight: '#b4ac9b', moss: '#6a9a45',
    cloth: '#efe2c2', sack: '#d8c08a', iron: '#3b3d44', steel: '#b8bcc4', brass: '#e0ac3c', skin: '#e8b48a', skinDark: '#cf9a72',
    hair: '#5a3a22', ember: '#ff8a2a', flame: '#ffb02e', flameHot: '#ffe08a', glass: '#ffd48a', char: '#201a18',
    water: '#4fb8d8', ink: '#1a130c', cream: '#fffaf0', white: '#ffffff'
  };
  const P = palette;

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
  // any of '#rrggbb' | '#rgb' | 0xRRGGBB | {r,g,b} (THREE.Color, already linear) -> linear [r,g,b]
  function colOf(v) {
    if (typeof v === 'number') { const n = v | 0; return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)]; }
    if (typeof v === 'string') return C(v.length === 4 ? '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3] : v);
    if (v && v.r !== undefined) return [v.r, v.g, v.b];
    return C('#ff2d55');
  }
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  // emblem ink: dark on bright lords, cream on dark ones (each charge is a list of convex polygons in a [-1,1]^2 field)
  const inkOn = (team) => (lum(team) > 0.3 ? C(P.ink) : C(P.cream));

  // ---------- emblems: four simple charges in a [-1,1]^2 field (also usable for 2D drawing) ----------
  const ring = (r0, r1, n) => { const out = []; for (let i = 0; i < n; i++) { const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU; out.push([[cos(a0) * r0, sin(a0) * r0], [cos(a0) * r1, sin(a0) * r1], [cos(a1) * r1, sin(a1) * r1], [cos(a1) * r0, sin(a1) * r0]]); } return out; };
  const emblems = [
    { name: 'Balken', fit: 'wide', polys: [[[-1, -0.3], [1, -0.3], [1, 0.3], [-1, 0.3]]] },
    { name: 'Kreuz', fit: 'square', polys: [[[-0.2, -0.85], [0.2, -0.85], [0.2, 0.85], [-0.2, 0.85]], [[-0.85, -0.2], [-0.2, -0.2], [-0.2, 0.2], [-0.85, 0.2]], [[0.2, -0.2], [0.85, -0.2], [0.85, 0.2], [0.2, 0.2]]] },
    { name: 'Sparren', fit: 'square', polys: [[[-0.9, -0.55], [0, 0.45], [0, 0.95], [-0.9, -0.05]], [[0, 0.45], [0.9, -0.55], [0.9, -0.05], [0, 0.95]]] },
    { name: 'Kreis', fit: 'square', polys: ring(0.38, 0.85, 12), disc: { r: 0.85, hole: 0.38 } }
  ];

  // ---------- shared uniforms ----------
  const U = { uTime: { value: 0 }, uGlow: { value: 0.22 } };
  function tick(t) { U.uTime.value = t || 0; }
  function setNight(n) { U.uGlow.value = 0.22 + 1.5 * clamp(n || 0, 0, 1); }

  // ---------- shader patches ----------
  // common vertex/fragment parts. `part` is aRig.w. Part ids differ per shader family (see below).
  const VS_COMMON = `
uniform float uTime;
attribute float aGlow;
attribute float aTeam;
attribute float aWear;
attribute vec4 aRig;
varying float vGlow;
varying float vTeam;
varying float vWear;
varying float vPart;
varying float vVar;
varying vec3 vTeamC;
vec3 rotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }
`;
  // buildings, keeps, banners, bridges, props: parts
  // 0 static (rises while building) | 1 roof (drops in) | 2 flag (waves) | 3 crops (growth) | 4 boom (turns about y)
  // 5 lift (bobs) | 7 ground (always) | 10..13 construction site layers (pegs, footing, frame, scaffold)
  const VS_MAIN_PARS = VS_COMMON + `
uniform vec3 uTeam;
uniform float uBuild;
uniform float uGrowth;
uniform float uWork;
uniform float uMoving;
uniform float uDmg;
uniform float uBurnt;
`;
  const VS_MAIN = `
vec3 transformed = vec3( position );
float part = aRig.w;
float bld = uBuild;
vGlow = aGlow; vTeam = aTeam; vWear = aWear; vPart = part; vVar = 1.0; vTeamC = uTeam;
if (part < 0.5) {
  transformed.y *= smoothstep(0.32, 0.8, bld);
} else if (part < 1.5) {
  float r = smoothstep(0.76, 0.96, bld);
  transformed = mix(aRig.xyz, transformed, r);
  transformed.y += (1.0 - r) * 1.8 - uDmg * 0.06;
} else if (part < 2.5) {
  float d = max(position.x - aRig.x, 0.0);
  float k = 1.0 + 0.8 * uMoving;
  float wv = sin(uTime * 3.6 * k - d * 2.8 + aRig.y * 1.7) + 0.35 * sin(uTime * 6.1 * k - d * 4.6 + 1.3);
  transformed.z += wv * 0.075 * d;
  transformed.y += sin(uTime * 2.7 * k - d * 3.1) * 0.025 * d - uMoving * 0.04 * d;
  transformed.x -= abs(wv) * 0.03 * d;
  transformed = mix(aRig.xyz, transformed, smoothstep(0.9, 1.0, bld));
} else if (part < 3.5) {
  float g = clamp(uGrowth, 0.0, 1.0);
  float h = mix(0.06, 1.0, smoothstep(0.0, 0.62, g)) * (1.0 - 0.82 * uBurnt) * smoothstep(0.86, 1.0, bld);
  transformed.y *= h;
  transformed.x += sin(uTime * 1.9 + position.x * 2.3 + position.z * 1.7) * 0.07 * transformed.y * (1.0 - uBurnt);
} else if (part < 4.5) {
  float a = sin(uTime * 0.8) * (0.1 + 0.85 * uWork);
  vec3 d = transformed - aRig.xyz;
  float c = cos(a), s = sin(a);
  transformed = aRig.xyz + vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
} else if (part < 5.5) {
  transformed.y += sin(uTime * 1.6) * 0.16 * uWork;
} else if (part > 9.5 && part < 13.5) {
  float g = part < 10.5 ? smoothstep(0.0, 0.08, bld) : part < 11.5 ? smoothstep(0.08, 0.3, bld) : part < 12.5 ? smoothstep(0.18, 0.55, bld) : smoothstep(0.22, 0.6, bld);
  if (part > 11.5) g *= 1.0 - smoothstep(0.9, 1.0, bld);
  if (g < 0.004) transformed = vec3(0.0); else transformed.y *= g;
}
`;
  // trees, deco, rocks (instanced): aRig.w = sway amplitude (local units), aRig.xyz unused
  const VS_SWAY_PARS = VS_COMMON + `
uniform vec3 uTeam;
`;
  const VS_SWAY = `
vec3 transformed = vec3( position );
float swPh = 0.0;
vVar = 1.0;
#ifdef USE_INSTANCING
  swPh = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.47;
  vVar = 0.9 + 0.2 * fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
#endif
float swW = aRig.w;
float sw1 = sin(uTime * 1.25 + swPh) * 0.8 + sin(uTime * 2.3 + swPh * 1.9 + position.y) * 0.2;
transformed.x += sw1 * swW;
transformed.z += cos(uTime * 1.0 + swPh * 1.3) * 0.5 * swW;
vGlow = aGlow; vTeam = 0.0; vWear = aWear; vPart = 0.0; vTeamC = uTeam;
`;
  // units: 0 body | 1,2 legs | 3,4 arms | 5 item R (weapon, torch stick, lance) | 6 item L (shield, bow) | 7 arrow
  // 8 tool (bauer, visible while working) | 9 flame (flickers, rides on item R)
  // 10 tail | 11..14 horse legs | 15 horse head | 16 pennant (rides on item R; aGlow = flutter weight)
  // 20..23 carry items (korn, holz, stein, eimer; only the active one is visible)
  const VS_UNIT_PARS = VS_COMMON + `
uniform float uKind;
uniform vec4 uDims;
attribute vec4 aInst;
attribute vec3 aTeamCol;
`;
  const VS_UNIT = `
vec3 transformed = vec3( position );
float part = aRig.w;
float anim = floor(aInst.x + 0.5);
float carry = floor(aInst.z + 0.5);
float ph = aInst.y * 6.2831853;
float K = uKind;
bool isWalk = anim == 1.0;
bool isFight = anim == 2.0;
bool isWork = anim == 3.0;
bool horse = K > 2.5 && K < 3.5;
float rate = horse ? 2.4 : (K > 3.5 ? 2.5 : 2.0);
float wph = uTime * rate * 6.2831853 + ph;
float sn = sin(wph);
float hipY = uDims.x, shY = uDims.y, armZ = uDims.z;
vec3 hip = vec3(0.0, hipY, 0.0);
vec3 sL = vec3(0.0, shY, armZ);
vec3 sR = vec3(0.0, shY, -armZ);
float thL = sin(uTime * 1.3 + ph) * 0.05, thR = -thL;
float lg = 0.0, lean = 0.0, bob = sin(uTime * 1.7 + ph) * 0.006;
float itemAbs = 0.0, itemAbsL = 0.0, hl = 0.0, tailA = 0.0, headA = 0.0;
vec3 itemOff = vec3(0.0), armOffR = vec3(0.0);
float draw = 0.0;
bool arrowOn = false;
if (isWalk) { lg = sn * 0.72; bob = abs(sn) * 0.04; lean = -0.06; thL = -sn * 0.6; thR = sn * 0.6; }
if (K < 0.5) {
  // ---- bauer
  if (isWork) {
    float f = 0.5 + 0.5 * sin(uTime * 4.4 + ph);
    thR = mix(0.5, 2.35, f); thL = thR * 0.92; lean = -0.28 * (1.0 - f); bob = -0.035 * (1.0 - f); lg = 0.0;
  } else if (carry > 0.5) {
    float sw = isWalk ? sn : 0.0;
    if (carry < 1.5) { thR = 2.55; thL = isWalk ? -sw * 0.5 : 0.05; }
    else if (carry < 2.5) { thR = 2.25; thL = isWalk ? -sw * 0.3 : 0.1; }
    else if (carry < 3.5) { thR = 1.15; thL = 1.15; }
    else { thR = 0.4 + sw * 0.15; }
  }
  if (isFight) { float f = 0.5 + 0.5 * sin(uTime * 9.0 + ph); thR = 1.0 + f * 1.4; thL = 1.0 + (1.0 - f) * 1.4; bob = abs(sin(uTime * 9.0 + ph)) * 0.03; }
  itemAbs = thR;
} else if (K < 1.5) {
  // ---- speer: spear upright while marching, thrust while fighting
  itemAbs = isWalk ? sn * 0.04 : 0.0;
  thR = isWalk ? sn * 0.1 : thR; thL = isWalk ? 0.35 : 0.35 + thL;
  itemAbsL = thL;
  if (isFight) {
    float f = fract(uTime * 1.4 + aInst.y);
    float tp = smoothstep(0.0, 0.16, f) - smoothstep(0.16, 0.5, f);
    thR = 1.3 + tp * 0.12; thL = 0.5; itemAbs = -1.38 + tp * 0.06; itemOff = vec3(tp * 0.42, 0.0, 0.0);
    lg = 0.38; lean = -0.08 - tp * 0.12; bob = -0.015;
  }
  if (isWork) { float f = 0.5 + 0.5 * sin(uTime * 4.0 + ph); thR = mix(0.4, 1.6, f); itemAbs = thR - 0.1; lean = -0.12 * (1.0 - f); }
  itemAbsL = thL;
} else if (K < 2.5) {
  // ---- bogen: bow in the left hand, draw and loose while fighting
  itemAbsL = -thL * 0.9;
  if (isWalk) { thL = -sn * 0.4; itemAbsL = -thL * 0.9; }
  if (isFight) {
    float f = fract(uTime * 0.72 + aInst.y);
    draw = smoothstep(0.0, 0.62, f) * (1.0 - smoothstep(0.66, 0.7, f));
    arrowOn = f < 0.68 && f > 0.06;
    thL = 1.48; itemAbsL = 0.0; thR = 1.5; armOffR = vec3(-0.3 * draw, 0.0, 0.0);
    lg = 0.3; lean = 0.05 - 0.04 * draw; bob = 0.0;
  }
  if (isWork) { float f = 0.5 + 0.5 * sin(uTime * 3.6 + ph); thR = mix(0.5, 1.9, f); thL = 0.3; itemAbsL = -0.3; }
  itemAbs = thR;
} else if (!horse) {
  // ---- fackel: torch held up, swung while fighting
  thR = isWalk ? 2.05 + sn * 0.12 : 2.0 + sin(uTime * 1.7 + ph) * 0.05;
  if (isWalk) { thL = -sn * 0.9; lean = -0.14; lg = sn * 0.85; bob = abs(sn) * 0.05; }
  if (isFight) { thR = 1.3 + sin(uTime * 7.0 + ph) * 0.95; thL = 0.5 + sin(uTime * 7.0 + ph + 2.0) * 0.3; lean = -0.1; lg = 0.4; bob = 0.0; }
  if (isWork) { thR = 1.9 + sin(uTime * 3.0 + ph) * 0.3; }
  itemAbs = thR * 0.55;
} else {
  // ---- ritter: gallop, lance couched forward
  thL = 0.35 + (isWalk ? sn * 0.08 : 0.0); thR = 1.15;
  itemAbs = isWalk ? -1.18 + sn * 0.03 : -0.12;
  lean = isWalk ? sn * 0.05 - 0.03 : 0.0;
  bob = isWalk ? abs(sn) * 0.09 : sin(uTime * 1.5 + ph) * 0.01;
  tailA = isWalk ? -0.55 - 0.25 * sn : -0.12 - 0.12 * sin(uTime * 1.1 + ph);
  headA = isWalk ? 0.1 * sn : 0.05 * sin(uTime * 0.9 + ph);
  if (isFight) {
    float f = fract(uTime * 1.3 + aInst.y);
    float tp = smoothstep(0.0, 0.18, f) - smoothstep(0.18, 0.5, f);
    itemAbs = -1.45 + tp * 0.1; itemOff = vec3(tp * 0.5, 0.0, 0.0); thR = 1.3;
    lean = 0.12 + 0.06 * sin(uTime * 5.0 + ph); bob = 0.05 * abs(sin(uTime * 5.0 + ph));
    tailA = -0.35;
  }
  if (isWork) { itemAbs = -0.12; }
}
vec3 p = transformed;
vec3 pv = aRig.xyz;
bool upper = true;
bool hide = false;
float gl = aGlow;
float tm = aTeam;
if (part < 0.5) {
} else if (part < 2.5) {
  upper = false;
  float a = part < 1.5 ? lg : -lg;
  if (horse) a = (part < 1.5 ? 1.0 : -1.0) * (isWalk ? sn * 0.35 : (isFight ? 0.5 : 0.0));
  p = pv + rotZ(p - pv, a);
} else if (part < 3.5) {
  p = sL + rotZ(p - sL, thL);
} else if (part < 4.5) {
  p = sR + rotZ(p - sR, thR) + armOffR;
} else if (part < 5.5) {
  p = sR + rotZ(pv - sR, thR) + armOffR + rotZ(p - pv, itemAbs) + itemOff;
} else if (part < 6.5) {
  p = sL + rotZ(pv - sL, thL) + rotZ(p - pv, itemAbsL);
} else if (part < 7.5) {
  p = sR + rotZ(pv - sR, thR) + armOffR + (p - pv);
  p.x = min(p.x, 0.5);
  hide = !arrowOn;
} else if (part < 8.5) {
  p = sR + rotZ(p - sR, thR);
  hide = !isWork;
} else if (part < 9.5) {
  vec3 fb = pv + vec3(0.0, 0.5, 0.0);
  vec3 q = p - fb;
  float hh = max(q.y, 0.0);
  q.x += sin(uTime * 19.0 + ph) * 0.35 * hh;
  q.z += cos(uTime * 23.0 + ph * 1.3) * 0.35 * hh;
  q.y *= 1.0 + sin(uTime * 17.0 + ph * 2.0) * 0.28 + sin(uTime * 31.0 + ph) * 0.18;
  vec3 baseW = sR + rotZ(pv - sR, thR) + armOffR + rotZ(fb - pv, itemAbs) + itemOff;
  p = baseW + q;
} else if (part < 10.5) {
  p = pv + rotZ(p - pv, tailA);
} else if (part < 15.5) {
  upper = false;
  float o = part < 11.5 ? 0.0 : part < 12.5 ? 0.7 : part < 13.5 ? 3.14159 + 0.4 : 3.14159 + 1.1;
  float a = isWalk ? sin(wph + o) * 0.85 : (isFight ? (part < 12.5 ? 0.7 + 0.5 * sin(uTime * 5.0 + ph + o) : 0.0) : 0.0);
  if (part > 14.5) { upper = true; a = headA; }
  p = pv + rotZ(p - pv, a);
} else if (part < 16.5) {
  float fl = aGlow;
  p = sR + rotZ(pv - sR, thR) + armOffR + rotZ(p - pv, itemAbs) + itemOff;
  float d = max(position.x - pv.x, 0.0);
  p.z += sin(uTime * 9.0 + d * 6.0 + ph) * 0.05 * fl; p.y += cos(uTime * 7.0 + d * 5.0) * 0.03 * fl;
  gl = 0.0;
} else if (part > 19.5) {
  if (part > 22.5) p = sR + rotZ(p - sR, thR);
  hide = carry != part - 19.0;
}
if (hide) {
  transformed = pv;
} else {
  if (upper) p = hip + rotZ(p - hip, lean);
  p.y += bob;
  transformed = p;
}
vGlow = gl; vTeam = tm; vWear = aWear; vPart = part; vTeamC = aTeamCol;
vVar = 0.92 + 0.16 * fract(sin(aInst.y * 91.3 + 7.1) * 437.5853);
`;
  const FS_PARS = `
uniform float uGlow;
uniform float uTime;
uniform float uDmg;
uniform float uBurnt;
uniform float uGrowth;
varying float vGlow;
varying float vTeam;
varying float vWear;
varying float vPart;
varying float vVar;
varying vec3 vTeamC;
`;
  const FS_COLOR = `
vec3 fBase = mix(vColor.rgb * vVar, vTeamC, vTeam);
if (vPart > 2.5 && vPart < 3.5) {
  float cg = clamp(uGrowth, 0.0, 1.0);
  vec3 cc = mix(vec3(0.17, 0.40, 0.08), vec3(0.09, 0.34, 0.05), smoothstep(0.25, 0.6, cg));
  cc = mix(cc, vec3(0.66, 0.43, 0.06), smoothstep(0.6, 1.0, cg));
  fBase = cc * (vColor.g * 1.2);
}
float fBurn = clamp(uBurnt * 1.25 + uDmg * (vWear * 1.5 - 0.1), 0.0, 1.0);
fBase = mix(fBase, vec3(0.03, 0.026, 0.024) * (0.7 + 0.9 * vWear), fBurn * 0.93);
diffuseColor.rgb *= fBase;
`;
  const FS_EMIT = `
float fEmber = step(0.9, vWear) * uBurnt * (1.0 - smoothstep(0.8, 1.0, uBurnt)) * (0.6 + 0.4 * sin(uTime * 6.0 + vWear * 80.0));
totalEmissiveRadiance += fBase * min(vGlow * uGlow, 3.0) + vec3(1.0, 0.38, 0.08) * fEmber * 0.9;
`;
  const SHADERS = { main: [VS_MAIN_PARS, VS_MAIN], sway: [VS_SWAY_PARS, VS_SWAY], unit: [VS_UNIT_PARS, VS_UNIT] };

  function patchShader(sh, mat, kind) {
    const u = mat.userData.u, S = SHADERS[kind];
    sh.uniforms.uTime = U.uTime; sh.uniforms.uGlow = U.uGlow;
    for (const k in u) sh.uniforms[k] = u[k];
    sh.vertexShader = sh.vertexShader.replace('void main() {', S[0] + '\nvoid main() {').replace('#include <begin_vertex>', S[1]);
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', FS_PARS + '\nvoid main() {')
      .replace('#include <color_fragment>', FS_COLOR).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FS_EMIT);
  }

  // One material object per use: they all share the same compiled program (same cache key),
  // so per-building uniforms (team colour, build progress, damage...) cost nothing.
  function newMat(T, q, kind, opts) {
    opts = opts || {};
    const o = { vertexColors: true, flatShading: true };
    if (opts.double) o.side = T.DoubleSide;
    let m;
    if (q === 'low') m = new T.MeshLambertMaterial(o);
    else { o.roughness = 0.9; o.metalness = 0; m = new T.MeshStandardMaterial(o); }
    m.userData.u = {
      uTeam: { value: new T.Color(1, 1, 1) }, uBuild: { value: 1 }, uGrowth: { value: 1 }, uWork: { value: 0 },
      uMoving: { value: 0 }, uDmg: { value: 0 }, uBurnt: { value: 0 }
    };
    if (kind === 'unit') { m.userData.u.uKind = { value: opts.kindId || 0 }; m.userData.u.uDims = { value: new T.Vector4(0.34, 0.62, 0.17, 0) }; }
    m.onBeforeCompile = (sh) => patchShader(sh, m, kind);
    m.customProgramCacheKey = () => 'furt-' + kind + q + (opts.double ? 'd' : '');
    return m;
  }
  const sharedMats = new Map();
  function sharedMat(T, q, kind) {
    const k = q + kind; let m = sharedMats.get(k);
    if (!m) { m = newMat(T, q, kind); sharedMats.set(k, m); }
    return m;
  }
  function setTeam(mat, rgb) { mat.userData.u.uTeam.value.setRGB(rgb[0], rgb[1], rgb[2]); }

  const qOf = (o) => (o && o.quality === 'low' ? 'low' : 'high');
  const segs = (q, hi, lo) => (q === 'low' ? lo : hi);

  // =====================================================================
  // GEOMETRY BUILDER
  // Non-indexed triangles with per-face colour jitter and a vertical shade ramp per primitive.
  // Primitives are base-centred (x, z = centre; y = bottom) unless noted. `push/pop` keep a matrix stack.
  // State: `b.part` / `b.pv` (aRig), `b.team` (default aTeam). Per call: {team, glow, j, sh, sk, dbl}.
  // =====================================================================
  const NO = {};
  const _icoC = new Map();
  function icoTris(T, d) {
    let t = _icoC.get(d);
    if (!t) {
      const g = new T.IcosahedronGeometry(1, d), pa = g.attributes.position, ix = g.index, n = ix ? ix.count : pa.count;
      t = [];
      for (let i = 0; i < n; i += 3) { const tri = []; for (let k = 0; k < 3; k++) { const j = ix ? ix.getX(i + k) : i + k; tri.push([pa.getX(j), pa.getY(j), pa.getZ(j)]); } t.push(tri); }
      _icoC.set(d, t); g.dispose();
    }
    return t;
  }
  // orthonormal frame (v, w) perpendicular to the unit direction d
  function frame(dx, dy, dz) {
    let rx = 0, ry = 1, rz = 0;
    if (abs(dy) > 0.95) { rx = 1; ry = 0; }
    let vx = ry * dz - rz * dy, vy = rz * dx - rx * dz, vz = rx * dy - ry * dx;
    const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
    return [vx, vy, vz, dy * vz - dz * vy, dz * vx - dx * vz, dx * vy - dy * vx];
  }

  class B {
    constructor(T) {
      this.T = T; this.p = []; this.c = []; this.g = []; this.t = []; this.w = []; this.r = [];
      this.m = new T.Matrix4(); this.stack = [];
      this.part = 0; this.pv = [0, 0, 0]; this.team = 0;
      this._q = new T.Quaternion(); this._e = new T.Euler(); this._v = new T.Vector3(); this._s = new T.Vector3(); this._lm = new T.Matrix4();
    }
    get tris() { return this.p.length / 9; }
    push(x, y, z, ry, s, rx, rz) {
      this.stack.push(this.m.clone());
      this._e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); this._q.setFromEuler(this._e);
      this._v.set(x || 0, y || 0, z || 0); const k = s == null ? 1 : s; this._s.set(k, k, k);
      this._lm.compose(this._v, this._q, this._s);
      this.m.multiply(this._lm);
      return this;
    }
    pop() { this.m = this.stack.pop(); return this; }
    X(a) {
      if (!this.stack.length) return a;
      const e = this.m.elements, x = a[0], y = a[1], z = a[2];
      return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
    }
    // part id and pivot (local frame) for the vertices emitted next
    rig(part, pivot) { this.part = part; this.pv = pivot ? this.X(pivot).slice() : [0, 0, 0]; return this; }
    V(x, y, z, r, g, bl, gl, tm, wear) {
      this.p.push(x, y, z); this.c.push(r, g, bl); this.g.push(gl); this.t.push(tm); this.w.push(wear);
      this.r.push(this.pv[0], this.pv[1], this.pv[2], this.part);
    }
    // one triangle from local points; ly = optional per-vertex ramp 0..1 (darker towards 0)
    T3(a, b, c, col, o, ly) {
      a = this.X(a); b = this.X(b); c = this.X(c);
      const j = o.j === undefined ? 0.09 : o.j, sh = o.sh === undefined ? 0.2 : o.sh;
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
      const f = 1 + j * (hpos(cx, cy, cz) * 2 - 1), wm = j * 0.35 * (hpos(cz, cx, cy + 3) * 2 - 1);
      const r = col[0] * f * (1 + wm), g = col[1] * f, bl = col[2] * f * (1 - wm);
      const wear = hpos(cy + cz * 3.1, cx, cz + cy * 1.7), gl = o.glow || 0, tm = o.team === undefined ? this.team : o.team;
      const s0 = ly ? 1 - sh * (1 - ly[0]) : 1, s1 = ly ? 1 - sh * (1 - ly[1]) : 1, s2 = ly ? 1 - sh * (1 - ly[2]) : 1;
      this.V(a[0], a[1], a[2], r * s0, g * s0, bl * s0, gl, tm, wear);
      this.V(b[0], b[1], b[2], r * s1, g * s1, bl * s1, gl, tm, wear);
      this.V(c[0], c[1], c[2], r * s2, g * s2, bl * s2, gl, tm, wear);
    }
    Q(a, b, c, d, col, o, l) {
      this.T3(a, b, c, col, o, l ? [l[0], l[1], l[2]] : null);
      this.T3(a, c, d, col, o, l ? [l[0], l[2], l[3]] : null);
    }
    // quad whose winding is flipped if its normal points towards `ref` (an interior point)
    Qo(a, b, c, d, col, o, l, ref) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const fx = (a[0] + c[0]) / 2 - ref[0], fy = (a[1] + c[1]) / 2 - ref[1], fz = (a[2] + c[2]) / 2 - ref[2];
      if (nx * fx + ny * fy + nz * fz >= 0) this.Q(a, b, c, d, col, o, l);
      else this.Q(a, d, c, b, col, o, l ? [l[0], l[3], l[2], l[1]] : null);
    }
    tri(a, b, c, col, o) { o = o || NO; this.T3(a, b, c, col, o, null); if (o.dbl) this.T3(a, c, b, col, o, null); return this; }
    quad(a, b, c, d, col, o) {
      o = o || NO; this.Q(a, b, c, d, col, o, null);
      if (o.dbl) this.Q(a, d, c, b, col, o, null);
      return this;
    }
    // flat convex polygon, fan from the first point (counter-clockwise seen from the front)
    poly(pts, col, o) {
      o = o || NO;
      for (let i = 1; i < pts.length - 1; i++) { this.T3(pts[0], pts[i], pts[i + 1], col, o, null); if (o.dbl) this.T3(pts[0], pts[i + 1], pts[i], col, o, null); }
      return this;
    }
    // box. sk = faces to skip (default 'b' = bottom): t b f(+z) k(-z) r(+x) l(-x)
    box(sx, sy, sz, x, y, z, col, o) {
      o = o || NO; const sk = o.sk === undefined ? 'b' : o.sk;
      const x0 = x - sx / 2, x1 = x + sx / 2, y0 = y, y1 = y + sy, z0 = z - sz / 2, z1 = z + sz / 2;
      if (sk.indexOf('r') < 0) this.Q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, o, [0, 0, 1, 1]);
      if (sk.indexOf('l') < 0) this.Q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, o, [0, 0, 1, 1]);
      if (sk.indexOf('t') < 0) this.Q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col, o, [1, 1, 1, 1]);
      if (sk.indexOf('b') < 0) this.Q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, o, [0, 0, 0, 0]);
      if (sk.indexOf('f') < 0) this.Q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, o, [0, 0, 1, 1]);
      if (sk.indexOf('k') < 0) this.Q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, o, [0, 0, 1, 1]);
      return this;
    }
    bb(x0, y0, z0, x1, y1, z1, col, o) { return this.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, y0, (z0 + z1) / 2, col, o); }
    // frustum along +y from the base: radius rb at y, rt at y+h. col may be fn(k)->colour. o.rot, o.ex/ez (elliptic), o.cap (cap colour)
    cyl(rt, rb, h, seg, x, y, z, col, o) {
      o = o || NO; const sk = o.sk === undefined ? 'b' : o.sk, rot = o.rot || 0, cf = typeof col === 'function', ex = o.ex || 1, ez = o.ez || 1;
      const y1 = y + h, p0 = [], p1 = [];
      for (let k = 0; k < seg; k++) { const a = rot + (k / seg) * TAU; p0.push([x + cos(a) * rb * ex, y, z + sin(a) * rb * ez]); p1.push([x + cos(a) * rt * ex, y1, z + sin(a) * rt * ez]); }
      const capC = o.cap || (cf ? col(0) : col);
      for (let k = 0; k < seg; k++) {
        const k2 = (k + 1) % seg, c = cf ? col(k) : col;
        if (rt < 1e-5) this.T3(p0[k2], p0[k], [x, y1, z], c, o, [0, 0, 1]);
        else this.Q(p0[k2], p0[k], p1[k], p1[k2], c, o, [0, 0, 1, 1]);
        if (rt >= 1e-5 && sk.indexOf('t') < 0) this.T3([x, y1, z], p1[k2], p1[k], capC, o, [1, 1, 1]);
        if (sk.indexOf('b') < 0) this.T3([x, y, z], p0[k], p0[k2], capC, o, [0, 0, 0]);
      }
      return this;
    }
    cone(r, h, seg, x, y, z, col, o) { return this.cyl(0, r, h, seg, x, y, z, col, o); }
    // icosphere blob centred at x,y,z. o.d detail (0 = 20 tris, 1 = 80), o.s [sx,sy,sz], o.jit radial jitter
    sph(r, x, y, z, col, o) {
      o = o || NO; const tris = icoTris(this.T, o.d || 0), s = o.s || [1, 1, 1], jit = o.jit || 0;
      const vt = (v) => {
        let vx = v[0], vy = v[1], vz = v[2];
        if (jit) { const f = 1 + jit * (hpos(vx * 3.1, vy * 2.7, vz * 3.7) * 2 - 1); vx *= f; vy *= f; vz *= f; }
        return [x + vx * r * s[0], y + vy * r * s[1], z + vz * r * s[2]];
      };
      for (const t of tris) this.T3(vt(t[0]), vt(t[1]), vt(t[2]), col, o, [(t[0][1] + 1) / 2, (t[1][1] + 1) / 2, (t[2][1] + 1) / 2]);
      return this;
    }
    // oriented square beam between two points. t = thickness, o.t2 second thickness, o.caps end faces
    beam(x0, y0, z0, x1, y1, z1, t, col, o) {
      o = o || NO; const t2 = o.t2 || t;
      let dx = x1 - x0, dy = y1 - y0, dz = z1 - z0; const L = Math.hypot(dx, dy, dz) || 1e-6; dx /= L; dy /= L; dz /= L;
      const f = frame(dx, dy, dz), a = t / 2, b2 = t2 / 2;
      const cn = (px, py, pz, su, sv) => [px + f[0] * a * su + f[3] * b2 * sv, py + f[1] * a * su + f[4] * b2 * sv, pz + f[2] * a * su + f[5] * b2 * sv];
      const su = [-1, 1, 1, -1], sv = [-1, -1, 1, 1], A = [], Bc = [];
      for (let i = 0; i < 4; i++) { A.push(cn(x0, y0, z0, su[i], sv[i])); Bc.push(cn(x1, y1, z1, su[i], sv[i])); }
      const ref = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
      for (let i = 0; i < 4; i++) { const i2 = (i + 1) % 4; this.Qo(A[i], A[i2], Bc[i2], Bc[i], col, o, null, ref); }
      if (o.caps) { this.Qo(A[0], A[1], A[2], A[3], o.capCol || col, o, null, ref); this.Qo(Bc[0], Bc[1], Bc[2], Bc[3], o.capCol || col, o, null, ref); }
      return this;
    }
    // oriented round pole between two points (radius r0 at the first, r1 at the second)
    pole(x0, y0, z0, x1, y1, z1, r0, r1, seg, col, o) {
      o = o || NO;
      let dx = x1 - x0, dy = y1 - y0, dz = z1 - z0; const L = Math.hypot(dx, dy, dz) || 1e-6; dx /= L; dy /= L; dz /= L;
      const f = frame(dx, dy, dz), A = [], Bc = [], cf = typeof col === 'function', rot = o.rot || 0;
      for (let k = 0; k < seg; k++) {
        const an = rot + (k / seg) * TAU, cs = cos(an), sn = sin(an);
        A.push([x0 + (f[0] * cs + f[3] * sn) * r0, y0 + (f[1] * cs + f[4] * sn) * r0, z0 + (f[2] * cs + f[5] * sn) * r0]);
        Bc.push([x1 + (f[0] * cs + f[3] * sn) * r1, y1 + (f[1] * cs + f[4] * sn) * r1, z1 + (f[2] * cs + f[5] * sn) * r1]);
      }
      const ref = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], capC = o.cap || (cf ? col(0) : col);
      for (let k = 0; k < seg; k++) {
        const k2 = (k + 1) % seg, c = cf ? col(k) : col;
        if (r1 < 1e-5) this.tri3o(A[k], A[k2], [x1, y1, z1], c, o, ref);
        else this.Qo(A[k], A[k2], Bc[k2], Bc[k], c, o, null, ref);
      }
      if (o.caps) {
        const c0 = [x0, y0, z0], c1 = [x1, y1, z1];
        for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg; this.tri3o(c0, A[k], A[k2], capC, o, [x0 - dx, y0 - dy, z0 - dz], true); if (r1 >= 1e-5) this.tri3o(c1, Bc[k], Bc[k2], capC, o, [x1 + dx, y1 + dy, z1 + dz], true); }
      }
      return this;
    }
    // triangle with its winding fixed against ref: ref interior (normal points away) or, with toward, exterior (normal points to it)
    tri3o(a, b, c, col, o, ref, toward) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const fx = (a[0] + b[0] + c[0]) / 3 - ref[0], fy = (a[1] + b[1] + c[1]) / 3 - ref[1], fz = (a[2] + b[2] + c[2]) / 3 - ref[2];
      let s = nx * fx + ny * fy + nz * fz;
      if (toward) s = -s;
      if (s >= 0) this.T3(a, b, c, col, o, null); else this.T3(a, c, b, col, o, null);
    }
    // gable / hip roof, ridge along x. base len (x) x wid (z) at y, rise h. o: hip 0..1, rows, band (row tone), under, colB, endCol
    roof(len, wid, h, x, y, z, col, o) {
      o = o || NO; const hip = o.hip || 0, L = len / 2, W = wid / 2, rl = Math.max(0, L - hip * W), rows = o.rows || 1, colB = o.colB || col;
      const rc = (k, c) => (o.band && k % 2 ? mul(c, o.band) : c);
      for (let k = 0; k < rows; k++) {
        const t0 = k / rows, t1 = (k + 1) / rows, e0 = lerp(L, rl, t0), e1 = lerp(L, rl, t1), z0 = W * (1 - t0), z1 = W * (1 - t1), y0 = h * t0, y1 = h * t1;
        this.Q([x - e0, y + y0, z + z0], [x + e0, y + y0, z + z0], [x + e1, y + y1, z + z1], [x - e1, y + y1, z + z1], rc(k, col), o, [t0, t0, t1, t1]);
        this.Q([x + e0, y + y0, z - z0], [x - e0, y + y0, z - z0], [x - e1, y + y1, z - z1], [x + e1, y + y1, z - z1], rc(k, colB), o, [t0, t0, t1, t1]);
      }
      const ec = o.endCol || mul(col, 0.86);
      for (let k = 0; k < rows; k++) {
        const t0 = k / rows, t1 = (k + 1) / rows, e0 = lerp(L, rl, t0), e1 = lerp(L, rl, t1), z0 = W * (1 - t0), z1 = W * (1 - t1), y0 = h * t0, y1 = h * t1, c = rc(k, ec);
        const A = [x + e0, y + y0, z + z0], Bq = [x + e0, y + y0, z - z0], Cq = [x + e1, y + y1, z - z1], D = [x + e1, y + y1, z + z1];
        const A2 = [x - e0, y + y0, z - z0], B2 = [x - e0, y + y0, z + z0], C2 = [x - e1, y + y1, z + z1], D2 = [x - e1, y + y1, z - z1];
        if (k === rows - 1 && z1 < 1e-6) { this.T3(A, Bq, Cq, c, o, [t0, t0, t1]); this.T3(A2, B2, C2, c, o, [t0, t0, t1]); }
        else { this.Q(A, Bq, Cq, D, c, o, [t0, t0, t1, t1]); this.Q(A2, B2, C2, D2, c, o, [t0, t0, t1, t1]); }
      }
      if (o.skirt) {
        const sk = o.skirt, sc = o.skirtCol || mul(col, 0.66), so = { ...o, j: 0.1 };
        this.Q([x - L, y - sk, z + W], [x + L, y - sk, z + W], [x + L, y, z + W], [x - L, y, z + W], sc, so, [0, 0, 1, 1]);
        this.Q([x + L, y - sk, z - W], [x - L, y - sk, z - W], [x - L, y, z - W], [x + L, y, z - W], sc, so, [0, 0, 1, 1]);
        this.Q([x + L, y - sk, z + W], [x + L, y - sk, z - W], [x + L, y, z - W], [x + L, y, z + W], sc, so, [0, 0, 1, 1]);
        this.Q([x - L, y - sk, z - W], [x - L, y - sk, z + W], [x - L, y, z + W], [x - L, y, z - W], sc, so, [0, 0, 1, 1]);
      }
      if (o.under !== false) this.Q([x - L, y, z + W], [x - L, y, z - W], [x + L, y, z - W], [x + L, y, z + W], mul(col, 0.45), { ...o, j: 0.04 }, null);
      return this;
    }
    // lofted tube through rings [{y, rx, rz?, x?, z?}] (bottom to top). colf = colour | fn(i,k). o: capTop colour, capBottom colour, a0/a1 arc
    loft(rings, seg, colf, o) {
      o = o || NO; const a0 = o.a0 === undefined ? 0 : o.a0, a1 = o.a1 === undefined ? TAU : o.a1;
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
      for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < seg; k++) {
        const k2 = full ? (k + 1) % seg : k + 1, c = typeof colf === 'function' ? colf(i, k) : colf;
        const ly0 = i / (rings.length - 1), ly1 = (i + 1) / (rings.length - 1);
        this.Q(g[i][k2], g[i][k], g[i + 1][k], g[i + 1][k2], c, o, [ly0, ly0, ly1, ly1]);
      }
      const fan = (row, y, up, c) => {
        let cx = 0, cz = 0; for (const p of row) { cx += p[0]; cz += p[2]; } cx /= row.length; cz /= row.length;
        for (let k = 0; k < seg; k++) { const k2 = full ? (k + 1) % seg : k + 1; if (up) this.T3([cx, y, cz], row[k2], row[k], c, o, null); else this.T3([cx, y, cz], row[k], row[k2], c, o, null); }
      };
      if (o.capTop) fan(g[g.length - 1], rings[rings.length - 1].y, true, o.capTop);
      if (o.capBottom) fan(g[0], rings[0].y, false, o.capBottom);
      return this;
    }
    geo() {
      const T = this.T, g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setAttribute('aGlow', new T.Float32BufferAttribute(this.g, 1));
      g.setAttribute('aTeam', new T.Float32BufferAttribute(this.t, 1));
      g.setAttribute('aWear', new T.Float32BufferAttribute(this.w, 1));
      g.setAttribute('aRig', new T.Float32BufferAttribute(this.r, 4));
      g.computeVertexNormals();
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }
  }

  // flag cloth in the xy plane at z = pz, hanging from a pole at (px, py), extending along +x. Waves in the vertex shader
  // (part 2, pivot = pole attach point). Double-sided; the emblem is laid on both faces.
  function flagCloth(b, px, py, pz, w, h, nx, ny, emblemIdx, teamRgb, o) {
    o = o || NO;
    const prevPart = b.part, prevPv = b.pv, prevTeam = b.team;
    b.rig(2, null); b.pv = b.X([px, py - h * 0.5, pz]).slice();
    const teamC = o.plainCol || [1, 1, 1];
    b.team = 1;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x0 = px + (i / nx) * w, x1 = px + ((i + 1) / nx) * w, y0 = py - (j / ny) * h, y1 = py - ((j + 1) / ny) * h;
      b.quad([x0, y1, pz], [x1, y1, pz], [x1, y0, pz], [x0, y0, pz], teamC, { dbl: !o.single, j: 0.03, sh: 0, team: 1 });
    }
    b.team = 0;
    const em = emblems[emblemIdx == null ? 0 : emblemIdx];
    if (em && !o.noEmblem) {
      const ink = o.ink || [0.95, 0.9, 0.8], cx = px + w * 0.5, cy = py - h * 0.5, wide = em.fit === 'wide';
      const sx = wide ? w * 0.5 : Math.min(w, h) * 0.4, sy = wide ? h * 0.5 : Math.min(w, h) * 0.4, dz = 0.014;
      for (const poly of em.polys) {
        const front = poly.map((q) => [cx + q[0] * sx, cy + q[1] * sy, pz + dz]);
        const back = poly.map((q) => [cx + q[0] * sx, cy + q[1] * sy, pz - dz]).reverse();
        b.poly(front, ink, { j: 0.02, sh: 0, team: 0 });
        b.poly(back, ink, { j: 0.02, sh: 0, team: 0 });
      }
    }
    b.part = prevPart; b.pv = prevPv; b.team = prevTeam;
  }

  // =====================================================================
  // BUILDING HELPERS (decals on walls, windows, doors, props shared by several kinds)
  // Every building is centred on the origin, base at y = 0 (plinths reach slightly below), door on +z.
  // =====================================================================
  const FLAT = { j: 0.04, sh: 0 };
  // decal polygon on a wall face. face: f(+z) k(-z) r(+x) l(-x); pts = [lateral, y] (lateral = world x for f/k, world z for r/l),
  // counter-clockwise as seen from outside; s = wall coordinate; lv = layer (0.015 offset each) against z-fighting
  function decPts(b, face, pts, s, col, lv, o) {
    const e = 0.015 * (lv || 1);
    let q;
    if (face === 'f') q = pts.map((p) => [p[0], p[1], s + e]);
    else if (face === 'k') q = pts.map((p) => [p[0], p[1], s - e]).reverse();
    else if (face === 'r') q = pts.map((p) => [s + e, p[1], p[0]]).reverse();
    else q = pts.map((p) => [s - e, p[1], p[0]]);
    b.poly(q, col, o || FLAT);
  }
  function dec(b, face, c, w, y0, y1, s, col, lv, o) {
    const h = w / 2;
    decPts(b, face, [[c - h, y0], [c + h, y0], [c + h, y1], [c - h, y1]], s, col, lv, o);
  }
  // half-hexagon arch on top of a door/window opening
  function archDec(b, face, c, w, y, s, col, lv) {
    const r = w / 2;
    decPts(b, face, [[c - r, y], [c + r, y], [c + r * 0.5, y + r * 0.87], [c - r * 0.5, y + r * 0.87]], s, col, lv);
  }
  function door(b, face, c, s, w, h, o) {
    o = o || NO; const wood = C(o.wood || P.timberDark), frame = C(o.frame || P.timberLight);
    dec(b, face, c, w + 0.14, 0, h + 0.07, s, frame, 1);
    dec(b, face, c, w, 0, h, s, wood, 2);
    if (!o.low) {
      dec(b, face, c - w * 0.24, 0.03, 0.02, h - 0.02, s, mul(wood, 0.62), 3); dec(b, face, c + w * 0.24, 0.03, 0.02, h - 0.02, s, mul(wood, 0.62), 3);
      dec(b, face, c + w * 0.32, 0.06, h * 0.46, h * 0.53, s, C(P.brass), 4);
    }
  }
  function win(b, face, c, s, y0, w, h, o) {
    o = o || NO; const fr = C(o.frame || P.timberDark);
    dec(b, face, c, w + 0.1, y0 - 0.05, y0 + h + 0.05, s, fr, 1);
    decPts(b, face, [[c - w / 2, y0], [c + w / 2, y0], [c + w / 2, y0 + h], [c - w / 2, y0 + h]], s, C(P.glass), 2, { j: 0.03, sh: 0, glow: 1 });
    if (!o.low) { dec(b, face, c, 0.03, y0, y0 + h, s, fr, 3); dec(b, face, c, w, y0 + h * 0.48, y0 + h * 0.54, s, fr, 3); }
  }
  // half-timber studs and rails on a wall face between lateral c0..c1 and heights y0..y1
  function tface(b, face, c0, c1, y0, y1, s, col, n) {
    const w = 0.09;
    dec(b, face, (c0 + c1) / 2, c1 - c0, y1 - 0.11, y1, s, col, 1); dec(b, face, (c0 + c1) / 2, c1 - c0, y0, y0 + 0.08, s, col, 1);
    for (let i = 0; i <= n; i++) dec(b, face, lerp(c0 + w / 2, c1 - w / 2, i / n), w, y0, y1, s, col, 1);
  }
  // pennant on a pole (part 2: waves in the shader); cloth takes the lord colour
  function pennant(b, x, y, z, ph, w, h, q) {
    ph *= 1.2; w *= 1.3; h *= 1.35;
    b.pole(x, y, z, x, y + ph, z, 0.026, 0.018, 4, C(P.timberDark));
    const yt = y + ph - 0.02, pr = b.part, ppv = b.pv, pt = b.team;
    b.rig(2, [x, yt - h / 2, z]); b.team = 1;
    const one = [1, 1, 1], o = { dbl: true, j: 0.03, sh: 0, team: 1 };
    b.quad([x, yt, z], [x, yt - h, z], [x + w * 0.5, yt - h * 0.83, z], [x + w * 0.5, yt - h * 0.17, z], one, o);
    b.tri([x + w * 0.5, yt - h * 0.17, z], [x + w * 0.5, yt - h * 0.83, z], [x + w, yt - h * 0.5, z], one, o);
    b.part = pr; b.pv = ppv; b.team = pt;
  }
  function merlonRow(b, axis, fixed, from, to, y, step, w, h, t, col, o) {
    const n = Math.max(1, Math.round(Math.abs(to - from) / step)), dir = to > from ? 1 : -1, sp = Math.abs(to - from) / n;
    for (let i = 0; i < n; i++) {
      const c = from + dir * (sp * (i + 0.5));
      if (axis === 'x') b.box(w, h, t, c, y, fixed, col, o); else b.box(t, h, w, fixed, y, c, col, o);
    }
  }
  function sack(b, x, y, z, r, col, q) {
    b.sph(r, x, y + r * 0.8, z, col, { s: [1, 1.1, 0.9], j: 0.1 });
    if (q !== 'low') b.cone(r * 0.35, r * 0.45, 4, x, y + r * 1.65, z, mul(col, 0.8));
  }
  function barrel(b, x, y, z, r, h, q) {
    const w1 = C(P.plank), w2 = C(P.plankDark), sg = q === 'low' ? 5 : 7;
    b.cyl(r, r * 0.88, h * 0.5, sg, x, y, z, (k) => (k % 2 ? w1 : w2), { sk: 'bt' });
    b.cyl(r * 0.88, r, h * 0.5, sg, x, y + h * 0.5, z, (k) => (k % 2 ? w1 : w2), { sk: 'b', cap: mul(w2, 0.9) });
  }
  // horizontal logs (poles) stacked along x or z: nx x ny logs of radius r
  function logPile(b, axis, cx, cz, len, cols, rows, r, col, endCol, y0) {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols - (j % 2); i++) {
      const off = (i - (cols - 1 - (j % 2)) / 2) * r * 2.05, y = (y0 || 0) + r + j * r * 1.75;
      const c = mix(col, C(P.timberLight), ((i * 7 + j * 3) % 5) / 14);
      if (axis === 'x') b.pole(cx - len / 2, y, cz + off, cx + len / 2, y, cz + off, r, r, 5, c, { caps: true, capCol: endCol, cap: endCol });
      else b.pole(cx + off, y, cz - len / 2, cx + off, y, cz + len / 2, r, r, 5, c, { caps: true, cap: endCol });
    }
  }
  // tapered square tower section: half-widths hb (bottom) / ht (top), height h, centred x,z
  function frustumBox(b, hb, ht, h, x, y, z, col, o) {
    o = o || NO;
    const p0 = [[x - hb, y, z - hb], [x + hb, y, z - hb], [x + hb, y, z + hb], [x - hb, y, z + hb]];
    const p1 = [[x - ht, y + h, z - ht], [x + ht, y + h, z - ht], [x + ht, y + h, z + ht], [x - ht, y + h, z + ht]];
    const ref = [x, y + h / 2, z];
    for (let i = 0; i < 4; i++) { const k = (i + 1) % 4; b.Qo(p0[i], p0[k], p1[k], p1[i], typeof col === 'function' ? col(i) : col, o, [0, 0, 1, 1], ref); }
    if (!o.sk || o.sk.indexOf('t') < 0) b.Q(p1[3], p1[2], p1[1], p1[0], typeof col === 'function' ? col(0) : col, o, null);
  }

  // =====================================================================
  // BUILDING KITS. fn(b, q) draws the finished building into builder b (walls part 0, roof part 1, ...)
  // and returns { w, d, h (wall height for the site), stone, anchors }.
  // =====================================================================
  const KINDS = {};
  KINDS.huette = function (b, q) {
    const low = q === 'low', plas = C(P.plasterWarm), beam = C(P.timberDark), thatch = C(P.thatch), thD = C(P.thatchDark);
    b.box(1.64, 0.24, 1.64, 0, -0.14, 0, C(P.stoneDark));
    b.box(1.5, 1.0, 1.5, 0, 0.1, 0, plas, { sk: 'bt' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.11, 1.02, 0.11, sx * 0.75, 0.1, sz * 0.75, beam);
    for (const f of ['f', 'k']) { tface(b, f, -0.7, 0.7, 0.1, 1.1, f === 'f' ? 0.75 : -0.75, beam, 3); }
    for (const f of ['r', 'l']) { tface(b, f, -0.7, 0.7, 0.1, 1.1, f === 'r' ? 0.75 : -0.75, beam, 2); }
    door(b, 'f', 0.28, 0.75, 0.4, 0.76, { low });
    win(b, 'f', -0.35, 0.75, 0.5, 0.3, 0.3, { low });
    win(b, 'r', 0.15, 0.75, 0.5, 0.3, 0.3, { low });
    b.box(0.5, 0.06, 0.24, 0.28, -0.02, 0.88, C(P.stoneLight));                       // doorstep
    // chimney (stone) through the back slope
    b.box(0.3, 1.5, 0.3, -0.5, 0.9, -0.28, C(P.stone));
    b.box(0.38, 0.1, 0.38, -0.5, 2.38, -0.28, C(P.stoneDark));
    // thatched hip roof (part 1: lowered in at the end of construction)
    b.rig(1, [0, 2.4, 0]);
    b.roof(2.0, 2.0, 1.35, 0, 1.1, 0, thatch, { hip: 0.55, rows: 5, band: 0.9, endCol: thD, colB: mul(thatch, 0.95), skirt: 0.16, skirtCol: C(P.thatchOld) });
    b.roof(1.12, 0.36, 0.17, 0, 2.38, 0, [1, 1, 1], { team: 1, under: false, rows: 1 });                           // lord-coloured ridge crest
    b.rig(0, null);
    pennant(b, 0.42, 2.42, 0, 0.6, 0.42, 0.26, q);
    // woodpile at the left wall + a barrel
    logPile(b, 'z', -0.85, 0, 0.9, 2, 2, 0.065, C(P.bark), C(P.timberLight), 0);
    if (!low) barrel(b, 0.75, 0, 0.85, 0.12, 0.3, q);
    return { w: 2, d: 2, h: 1.1, anchors: { door: [0.28, 0, 1.0], chimney: [-0.5, 2.5, -0.28], work: [-0.2, 0, 1.0] } };
  };

  KINDS.hof = function (b, q) {
    const low = q === 'low', plas = C(P.plasterWarm), beam = C(P.timberDark), thatch = C(P.thatch), thD = C(P.thatchDark);
    const fx = -1.5, fz = -1.0;                      // farmhouse centre, NW corner of the 5x4 plot
    b.box(1.64, 0.24, 1.64, fx, -0.14, fz, C(P.stoneDark));
    b.box(1.5, 1.0, 1.5, fx, 0.1, fz, plas, { sk: 'bt' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.11, 1.02, 0.11, fx + sx * 0.75, 0.1, fz + sz * 0.75, beam);
    tface(b, 'f', fx - 0.7, fx + 0.7, 0.1, 1.1, fz + 0.75, beam, 3); tface(b, 'r', fz - 0.7, fz + 0.7, 0.1, 1.1, fx + 0.75, beam, 2);
    tface(b, 'l', fz - 0.7, fz + 0.7, 0.1, 1.1, fx - 0.75, beam, 2);
    door(b, 'f', fx + 0.3, fz + 0.75, 0.4, 0.76, { low }); win(b, 'f', fx - 0.35, fz + 0.75, 0.5, 0.3, 0.3, { low }); win(b, 'r', fz + 0.1, fx + 0.75, 0.5, 0.3, 0.3, { low });
    b.box(0.3, 1.45, 0.3, fx - 0.4, 0.95, fz - 0.3, C(P.stone)); b.box(0.38, 0.1, 0.38, fx - 0.4, 2.38, fz - 0.3, C(P.stoneDark));
    b.rig(1, [fx, 2.3, fz]);
    b.roof(2.0, 2.0, 1.3, fx, 1.1, fz, thatch, { hip: 0.5, rows: 5, band: 0.9, endCol: thD, skirt: 0.16, skirtCol: C(P.thatchOld) });
    b.roof(1.12, 0.36, 0.17, fx, 2.27, fz, [1, 1, 1], { team: 1, under: false, rows: 1 });
    b.rig(0, null);
    pennant(b, fx + 0.4, 2.36, fz, 0.6, 0.42, 0.26, q);
    // the field: soil, furrows (part 7, always there) and crop rows (part 3, grow with uGrowth)
    const soil = C(P.soil), fur = C(P.furrow);
    const regions = [[-0.5, 2.5, -2.0, 2.0], [-2.5, -0.5, 0.0, 2.0]];
    b.rig(7, null);
    for (const [x0, x1, z0, z1] of regions) {
      b.bb(x0 + 0.03, 0.0, z0 + 0.03, x1 - 0.03, 0.05, z1 - 0.03, soil, { sk: 'bt', j: 0.05 });
      b.quad([x0 + 0.03, 0.052, z1 - 0.03], [x1 - 0.03, 0.052, z1 - 0.03], [x1 - 0.03, 0.052, z0 + 0.03], [x0 + 0.03, 0.052, z0 + 0.03], mix(soil, fur, 0.5), FLAT);
    }
    const rowGap = low ? 0.66 : 0.5, step = low ? 0.45 : 0.23, rowsZ = [];
    for (const [x0, x1, z0, z1] of regions) {
      for (let z = z0 + rowGap / 2; z < z1; z += rowGap) {
        // furrow ridge (a low roof lying along x)
        b.roof(x1 - x0 - 0.12, 0.3, 0.075, (x0 + x1) / 2, 0.05, z, fur, { under: false, j: 0.07, endCol: fur });
        rowsZ.push([x0, x1, z]);
      }
    }
    b.rig(3, null);
    const gray = [0.8, 0.8, 0.8];
    for (const [x0, x1, z] of rowsZ) for (let x = x0 + 0.22; x < x1 - 0.1; x += step) {
      const jx = (hash2(Math.round(x * 31), Math.round(z * 37)) - 0.5) * 0.05;
      b.cone(0.15, 0.36 + hash2(Math.round(x * 17), Math.round(z * 29)) * 0.12, 3, x + jx, 0.08, z, gray, { j: 0.12, sk: 'b' });
    }
    b.rig(0, null);
    // low fence around the field's open sides
    const post = C(P.timberLight), rail = C(P.plank);
    const fenceLine = (x0, z0, x1, z1) => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / (low ? 1.0 : 0.62)));
      for (let i = 0; i <= n; i++) { const t = i / n, px = lerp(x0, x1, t), pz = lerp(z0, z1, t); b.box(0.07, 0.4, 0.07, px, 0, pz, post); }
      b.beam(x0, 0.3, z0, x1, 0.3, z1, 0.045, rail); if (!low) b.beam(x0, 0.16, z0, x1, 0.16, z1, 0.04, rail);
    };
    fenceLine(-0.47, 2.0 - 0.04, 2.47, 2.0 - 0.04); fenceLine(2.47, 2.0 - 0.04, 2.47, -2.0 + 0.04); fenceLine(-0.47, -2.0 + 0.04, 2.47, -2.0 + 0.04);
    fenceLine(-2.47, 2.0 - 0.04, -0.5, 2.0 - 0.04); fenceLine(-2.47, 0.04, -2.47, 2.0 - 0.04);
    // scarecrow in the lord's colours
    b.pole(1.7, 0, 0.5, 1.7, 1.15, 0.5, 0.03, 0.03, 4, C(P.timberDark));
    b.beam(1.38, 0.88, 0.5, 2.02, 0.88, 0.5, 0.04, C(P.timberDark));
    b.box(0.34, 0.34, 0.2, 1.7, 0.6, 0.5, [1, 1, 1], { team: 1, sk: 'b' });
    b.sph(0.1, 1.7, 1.2, 0.5, C(P.sack), { s: [1, 1.1, 1] });
    b.cone(0.17, 0.14, 5, 1.7, 1.27, 0.5, C(P.thatchOld));
    return { w: 5, d: 4, h: 1.1, anchors: { door: [fx + 0.3, 0, fz + 1.0], chimney: [fx - 0.4, 2.5, fz - 0.3], work: [1.0, 0, 0.0] }, rect: [fx, fz, 2, 2], farm: true };
  };

  KINDS.kornspeicher = function (b, q) {
    const low = q === 'low', wood = C(P.plank), woodD = C(P.plankDark), shingle = C(P.shingle);
    // staddle stones + floor frame
    for (const px of [-0.95, 0, 0.95]) for (const pz of [-0.6, 0.6]) {
      b.cyl(0.13, 0.19, 0.58, low ? 4 : 5, px, -0.08, pz, C(P.stone), { cap: C(P.stoneLight), sk: 'b' });
      b.cyl(0.24, 0.18, 0.1, low ? 4 : 5, px, 0.5, pz, C(P.stoneLight), { sk: 'b' });
    }
    for (const pz of [-0.6, 0.6]) b.beam(-1.2, 0.68, pz, 1.2, 0.68, pz, 0.14, C(P.timberDark));
    b.box(2.5, 0.1, 1.9, 0, 0.62, 0, woodD, { sk: '' });
    // plank body
    b.box(2.5, 1.2, 1.9, 0, 0.7, 0, wood, { sk: 'bt' });
    for (let i = -4; i <= 4; i++) { dec(b, 'f', i * 0.27, 0.035, 0.72, 1.88, 0.95, woodD, 1); if (!low) dec(b, 'k', i * 0.27, 0.035, 0.72, 1.88, -0.95, woodD, 1); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.13, 1.3, 0.13, sx * 1.25, 0.66, sz * 0.95, C(P.timberDark));
    b.beam(-1.25, 1.84, 0.95, 1.25, 1.84, 0.95, 0.1, C(P.timberDark)); b.beam(-1.25, 1.84, -0.95, 1.25, 1.84, -0.95, 0.1, C(P.timberDark));
    // door with a ladder to the ground
    door(b, 'f', 0.45, 0.95, 0.62, 0.95, { low }); dec(b, 'f', 0.45, 0.62, 0.0, 0.72, 0.95, woodD, 1);
    b.box(0.74, 0.07, 0.3, 0.45, 0.58, 1.12, C(P.timberLight), { sk: '' });
    b.beam(0.18, 0.0, 1.38, 0.18, 0.66, 1.12, 0.05, C(P.timberLight)); b.beam(0.72, 0.0, 1.38, 0.72, 0.66, 1.12, 0.05, C(P.timberLight));
    for (let i = 1; i < 5; i++) b.beam(0.14, 0.13 * i, 1.33 - i * 0.045, 0.76, 0.13 * i, 1.33 - i * 0.045, 0.04, C(P.timberLight));
    win(b, 'f', -0.7, 0.95, 1.2, 0.32, 0.4, { low });
    // roof + trims
    b.rig(1, [0, 2.8, 0]);
    b.roof(2.9, 2.44, 0.95, 0, 1.9, 0, shingle, { rows: 5, band: 0.88, endCol: mul(shingle, 0.75), skirt: 0.1 });
    b.roof(2.96, 0.36, 0.15, 0, 2.78, 0, [1, 1, 1], { team: 1, under: false, rows: 1 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.beam(sx * 1.43, 1.9, sz * 1.2, sx * 1.43, 2.82, 0, 0.1, [1, 1, 1], { team: 1 });
    b.rig(0, null);
    // hoist beam with pulley at the gable
    b.beam(1.2, 2.2, 0, 1.45, 2.2, 0, 0.09, C(P.timberDark)); b.pole(1.42, 1.5, 0, 1.42, 2.2, 0, 0.012, 0.012, 3, C(P.straw));
    b.box(0.12, 0.12, 0.12, 1.42, 1.38, 0, C(P.iron));
    pennant(b, -1.35, 2.8, 0, 0.55, 0.42, 0.26, q);
    // sacks and a barrel by the door
    sack(b, -0.55, 0, 1.35, 0.17, C(P.sack), q); sack(b, -0.9, 0, 1.28, 0.16, mul(C(P.sack), 0.9), q); sack(b, -0.72, 0.28, 1.32, 0.15, C(P.sack), q);
    if (!low) barrel(b, -1.25, 0, 1.25, 0.16, 0.38, q);
    return { w: 3, d: 3, h: 1.9, rect: [0, 0, 2.7, 2.1], anchors: { door: [0.45, 0, 1.4], work: [-0.7, 0, 1.4] } };
  };

  KINDS.lager = function (b, q) {
    const low = q === 'low';
    b.rig(7, null);
    b.bb(-1.46, 0, -1.46, 1.46, 0.05, 1.46, mix(C(P.dirt), C(P.soil), 0.35), { sk: 'b', j: 0.07 });
    for (let i = 0; i < (low ? 4 : 9); i++) { const h = hash2(i, 5), g = hash2(i, 9); b.cyl(0.18 + h * 0.2, 0.22 + h * 0.25, 0.05, 6, (g - 0.5) * 2.4, 0.04, (hash2(i, 13) - 0.5) * 2.4, mix(C(P.cobble), C(P.sand), 0.4), { j: 0.1 }); }
    b.rig(0, null);
    // log piles (along x and z), stone blocks, plank stack
    logPile(b, 'x', -0.3, -0.95, 1.7, 4, 3, 0.1, C(P.bark), C(P.timberLight), 0.04);
    logPile(b, 'z', 1.1, 0.3, 1.5, 3, 2, 0.1, mix(C(P.bark), C(P.timber), 0.4), C(P.plank), 0.04);
    const stoneC = C(P.stoneLight);
    b.box(0.5, 0.3, 0.34, -1.0, 0.04, 0.55, stoneC, { j: 0.12 }); b.box(0.5, 0.3, 0.34, -1.05, 0.34, 0.5, mul(stoneC, 0.92), { j: 0.12 });
    b.box(0.44, 0.28, 0.3, -0.3, 0.04, 0.8, mul(stoneC, 1.05), { j: 0.12 }); b.box(0.4, 0.24, 0.3, -0.95, 0.04, 1.05, mul(stoneC, 0.88), { j: 0.12 });
    for (let i = 0; i < 5; i++) b.box(0.9, 0.05, 0.22, 0.35, 0.04 + i * 0.06, 1.1, mix(C(P.plank), C(P.plankDark), (i % 2) * 0.4), { j: 0.08 });
    // open lean-to over a corner
    for (const [px, pz] of [[0.7, -1.35], [1.3, -1.35], [0.7, -0.6], [1.3, -0.6]]) b.box(0.09, 1.25, 0.09, px, 0.04, pz, C(P.timberDark));
    b.rig(1, [1.0, 1.3, -1.0]);
    b.roof(0.9, 1.0, 0.3, 1.0, 1.29, -0.97, C(P.shingle), { rows: 2, band: 0.9 });
    b.box(0.95, 0.07, 0.12, 1.0, 1.5, -0.97, [1, 1, 1], { team: 1 });
    b.rig(0, null);
    sack(b, 1.0, 0.04, -1.0, 0.17, C(P.sack), q);
    // fence on the back and one side + gate posts
    for (let i = 0; i < 7; i++) { const px = -1.4 + i * 0.47; b.box(0.08, 0.5, 0.08, px, 0, -1.45, C(P.timberLight)); }
    b.beam(-1.4, 0.38, -1.45, 1.42, 0.38, -1.45, 0.05, C(P.plank));
    for (let i = 0; i < 4; i++) b.box(0.08, 0.5, 0.08, -1.45, 0, -1.0 + i * 0.5, C(P.timberLight));
    b.beam(-1.45, 0.38, -1.45, -1.45, 0.38, 0.5, 0.05, C(P.plank));
    pennant(b, -1.45, 0.0, 1.35, 1.3, 0.55, 0.34, q);
    return { w: 3, d: 3, h: 0.6, anchors: { door: [0, 0, 1.5], work: [0, 0, 0.9] } };
  };

  KINDS.holzfaeller = function (b, q) {
    const low = q === 'low', wall = C(P.timber), logC = mix(C(P.timber), C(P.bark), 0.3);
    b.box(1.34, 0.2, 1.24, -0.2, -0.12, -0.25, C(P.stoneDark));
    b.box(1.2, 0.95, 1.1, -0.2, 0.08, -0.25, wall, { sk: 'bt' });
    // horizontal log courses
    for (let i = 0; i < (low ? 3 : 6); i++) {
      const y = 0.12 + i * (low ? 0.3 : 0.15);
      for (const f of ['f', 'k']) dec(b, f, -0.2, 1.2, y, y + 0.045, f === 'f' ? 0.3 : -0.8, mul(logC, 0.55), 1);
      for (const f of ['r', 'l']) dec(b, f, -0.25, 1.1, y, y + 0.045, f === 'r' ? 0.4 : -0.8, mul(logC, 0.55), 1);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.07, 0.07, 1.0, 5, -0.2 + sx * 0.6, 0.08, -0.25 + sz * 0.55, logC);
    door(b, 'f', 0.0, 0.3, 0.36, 0.72, { low, wood: P.timberDark }); win(b, 'f', -0.55, 0.3, 0.45, 0.24, 0.26, { low });
    b.box(0.22, 1.0, 0.22, -0.55, 0.8, -0.55, C(P.stone));
    b.rig(1, [-0.2, 2.0, -0.25]);
    b.roof(1.6, 1.5, 0.85, -0.2, 1.03, -0.25, C(P.shingle), { rows: 4, band: 0.88, endCol: mul(C(P.shingle), 0.75), skirt: 0.08 });
    b.roof(1.66, 0.3, 0.14, -0.2, 1.8, -0.25, [1, 1, 1], { team: 1, under: false, rows: 1 });
    for (const sx of [-1, 1]) b.beam(-0.2 + sx * 0.8, 1.03, 0.5, -0.2 + sx * 0.8, 1.86, -0.25, 0.07, [1, 1, 1], { team: 1 });
    b.rig(0, null);
    pennant(b, -0.95, 1.8, -0.25, 0.5, 0.38, 0.24, q);
    // chopping block with an axe, split-log pile, a stump seat
    b.cyl(0.2, 0.22, 0.38, 7, 0.62, 0, 0.62, C(P.timberLight), { cap: C(P.wattle) });
    b.beam(0.62, 0.38, 0.62, 0.75, 0.82, 0.55, 0.035, C(P.timberDark));
    b.box(0.16, 0.12, 0.04, 0.7, 0.72, 0.58, C(P.steel), { sk: '' });
    logPile(b, 'z', -0.75, 0.62, 0.7, 3, 2, 0.07, C(P.timberLight), C(P.wattle), 0);
    logPile(b, 'x', 0.55, 0.0, 0.7, 2, 1, 0.07, C(P.timberLight), C(P.wattle), 0);
    if (!low) b.cyl(0.14, 0.15, 0.25, 6, 0.1, 0, 0.82, C(P.bark), { cap: C(P.wattle) });
    return { w: 2, d: 2, h: 1.03, rect: [-0.2, -0.25, 1.5, 1.4], anchors: { door: [0, 0, 0.5], chimney: [-0.55, 1.85, -0.55], work: [0.62, 0, 0.9] } };
  };

  const stoneTone = (base, i, k, v) => {
    const h = hash2(i * 17 + 3, k * 5 + 1);
    return mix(mul(base, 0.84 + 0.32 * h), mul(base, 1.08), ((i + k) % 2) * 0.25 + (v || 0));
  };

  KINDS.steinbruch = function (b, q) {
    const low = q === 'low', rock = C(P.rock), wood = C(P.timberDark), rope = C(P.straw);
    b.rig(7, null);
    b.bb(-1.46, 0, -1.46, 1.46, 0.05, 1.46, mix(C(P.rock), C(P.dirt), 0.4), { sk: 'b', j: 0.08 });
    b.rig(0, null);
    // rock face at the back
    b.sph(0.6, -0.55, 0.1, -0.9, rock, { s: [1.3, 1.05, 0.8], jit: 0.22 }); b.sph(0.55, 0.55, 0.0, -0.95, mix(rock, C(P.rockLight), 0.3), { s: [1.2, 1.1, 0.8], jit: 0.25 });
    b.sph(0.4, 1.0, 0.0, -0.55, C(P.rockDark), { s: [1, 0.8, 1], jit: 0.25 });
    if (!low) { b.sph(0.3, -1.1, 0.0, -0.4, mix(rock, C(P.rockDark), 0.4), { jit: 0.25 }); b.sph(0.2, 0.1, 0.0, -0.65, C(P.rockLight), { jit: 0.3 }); }
    // derrick: mast, back stays, turning boom (part 4, pivot at the mast top)
    const mx = -0.85, mz = -0.1, mh = 2.3;
    b.box(0.16, mh, 0.16, mx, 0, mz, wood);
    b.beam(mx, mh - 0.1, mz, mx - 0.5, 0, mz + 0.55, 0.09, wood); b.beam(mx, mh - 0.1, mz, mx - 0.5, 0, mz - 0.55, 0.09, wood);
    b.rig(4, [mx, mh, mz]);
    b.beam(mx - 0.55, mh + 0.02, mz, mx + 1.8, mh + 0.2, mz, 0.12, C(P.timber));
    b.beam(mx + 1.6, mh + 0.18, mz, mx, mh + 0.55, mz, 0.04, rope);
    b.box(0.34, 0.26, 0.3, mx - 0.5, mh - 0.3, mz, C(P.stoneDark));
    b.pole(mx + 1.35, mh + 0.15, mz, mx + 1.35, 1.1, mz, 0.015, 0.015, 3, rope);
    b.box(0.36, 0.28, 0.3, mx + 1.35, 0.82, mz, C(P.stoneLight), { j: 0.12 });
    b.box(0.5, 0.05, 0.05, mx + 1.35, 1.1, mz, C(P.iron));
    b.rig(0, null);
    b.box(0.3, 0.5, 0.04, mx + 0.0, 1.0, mz + 0.1, [1, 1, 1], { team: 1 });
    // cut blocks and a plank ramp
    const stoneC = C(P.stoneLight);
    b.box(0.52, 0.3, 0.38, 0.85, 0.04, 0.9, stoneC, { j: 0.12 }); b.box(0.5, 0.3, 0.38, 0.88, 0.34, 0.88, mul(stoneC, 0.93), { j: 0.12 });
    b.box(0.46, 0.28, 0.36, 0.2, 0.04, 0.75, mul(stoneC, 1.04), { j: 0.12 }); b.box(0.4, 0.26, 0.3, 1.05, 0.04, 0.2, mul(stoneC, 0.88), { j: 0.12 });
    b.push(-0.15, 0.04, 1.2, 0, 1, 0, 0.0);
    b.beam(-0.6, 0.0, 0.18, 0.4, 0.5, 0.18, 0.07, wood); b.beam(-0.6, 0.0, -0.18, 0.4, 0.5, -0.18, 0.07, wood);
    for (let i = 0; i < (low ? 3 : 5); i++) { const t = (i + 0.5) / (low ? 3 : 5); b.beam(-0.6 + t, t * 0.5 + 0.05, -0.22, -0.6 + t, t * 0.5 + 0.05, 0.22, 0.06, C(P.plank), { t2: 0.16 }); }
    b.box(0.3, 0.45, 0.5, 0.52, 0.0, 0, stoneC, { j: 0.1 });
    b.pop();
    // tools and pennant
    b.beam(0.45, 0.0, -1.3, 0.62, 0.95, -1.35, 0.035, wood); b.beam(0.5, 0.88, -1.35, 0.78, 0.88, -1.35, 0.05, C(P.iron));
    if (!low) { b.beam(0.2, 0.0, -1.25, 0.12, 0.8, -1.3, 0.035, wood); b.beam(0.06, 0.8, -1.3, 0.3, 0.74, -1.3, 0.05, C(P.iron)); }
    b.cyl(0.18, 0.2, 0.2, 6, -1.1, 0.04, 0.8, C(P.timber), { cap: C(P.rockDark) });
    pennant(b, 0.8, 0.0, -1.3, 1.5, 0.5, 0.32, q);
    return { w: 3, d: 3, h: 1.4, anchors: { door: [0.2, 0, 1.45], work: [0.0, 0, 0.1] }, boom: true };
  };

  KINDS.kaserne = function (b, q) {
    const low = q === 'low', stD = C(P.stoneDark), stB = C(P.stone), tile = C(P.roofTile), cz = -0.5, hd = 0.85, wallH = 1.6;
    b.box(3.7, 0.26, 1.9, 0, -0.16, cz, stD);
    const nC = low ? 3 : 5, chh = wallH / nC;
    for (let i = 0; i < nC; i++) b.box(3.5, chh, 1.7, 0, 0.1 + i * chh, cz, stoneTone(stB, i, 2, 0), { sk: 'bt', j: 0.07 });
    if (!low) for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 0; i < 3; i++) b.box(0.3, 0.42, 0.3, sx * 1.75, 0.1 + i * 0.5 + (i % 2) * 0.0, cz + sz * hd, mul(C(P.stoneLight), 0.95 + i * 0.03), { sk: 'bt', j: 0.07 });
    door(b, 'f', 0, cz + hd, 0.82, 1.1, { low, wood: P.timberDark, frame: P.stoneLight }); archDec(b, 'f', 0, 0.82, 1.1, cz + hd, C(P.timberDark), 2);
    b.box(1.0, 0.07, 0.3, 0, -0.02, cz + hd + 0.12, C(P.stoneLight));
    for (const wx of [-1.2, 1.2]) win(b, 'f', wx, cz + hd, 0.75, 0.3, 0.5, { low, frame: P.stoneDark });
    for (const wx of [-0.75, 0.75]) win(b, 'k', wx, cz - hd, 0.75, 0.3, 0.5, { low, frame: P.stoneDark });
    win(b, 'r', cz + 0.1, 1.75, 0.8, 0.3, 0.45, { low, frame: P.stoneDark });
    b.box(0.34, 1.4, 0.34, 1.15, 1.3, cz - 0.3, stD); b.box(0.42, 0.1, 0.42, 1.15, 2.65, cz - 0.3, C(P.stone));
    b.rig(1, [0, 2.8, cz]);
    b.roof(3.9, 2.0, 1.15, 0, 1.7, cz, tile, { rows: 6, band: 0.9, endCol: mul(tile, 0.8), skirt: 0.08 });
    b.roof(3.96, 0.34, 0.15, 0, 2.8, cz, [1, 1, 1], { team: 1, under: false, rows: 1 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.beam(sx * 1.95, 1.7, cz + sz * 0.97, sx * 1.95, 2.84, cz, 0.1, [1, 1, 1], { team: 1 });
    for (const sz of [-1, 1]) b.box(3.95, 0.07, 0.09, 0, 1.7, cz + sz * 1.0, [1, 1, 1], { team: 1 });
    b.rig(0, null);
    pennant(b, -1.75, 2.8, cz, 0.9, 0.7, 0.42, q);
    // front yard: two training dummies and a weapon rack with lord-coloured shields
    for (const dx of [-1.3, -0.45]) {
      b.pole(dx, 0, 1.0, dx, 1.2, 1.0, 0.045, 0.04, 5, C(P.timberDark)); b.beam(dx - 0.3, 0.85, 1.0, dx + 0.3, 0.85, 1.0, 0.05, C(P.timberDark));
      b.sph(0.13, dx, 1.25, 1.0, C(P.sack), { s: [1, 1.1, 1] }); b.box(0.2, 0.34, 0.14, dx, 0.58, 1.0, C(P.straw));
    }
    b.beam(1.05, 0, 1.1, 1.05, 1.1, 1.1, 0.07, C(P.timberDark)); b.beam(1.75, 0, 1.1, 1.75, 1.1, 1.1, 0.07, C(P.timberDark));
    b.beam(1.0, 0.95, 1.1, 1.8, 0.95, 1.1, 0.06, C(P.timber)); b.beam(1.0, 0.35, 1.1, 1.8, 0.35, 1.1, 0.06, C(P.timber));
    for (let i = 0; i < 3; i++) { b.pole(1.2 + i * 0.22, 0.03, 1.28, 1.25 + i * 0.22, 1.5, 1.14, 0.018, 0.018, 4, C(P.timberLight)); b.cone(0.045, 0.16, 4, 1.25 + i * 0.22, 1.5, 1.14, C(P.steel)); }
    for (const sx of [1.28, 1.62]) { b.push(sx, 0.5, 1.2, 0, 1, PI / 2); b.cyl(0.2, 0.2, 0.05, 8, 0, -0.025, 0, C(P.plankDark)); b.cyl(0.165, 0.165, 0.012, 8, 0, 0.026, 0, [1, 1, 1], { team: 1, sk: 'b' }); b.pop(); }
    return { w: 4, d: 3, h: 1.7, stone: true, rect: [0, cz, 3.8, 1.9], anchors: { door: [0, 0, 1.3], work: [-0.9, 0, 1.2], chimney: [1.15, 2.8, cz - 0.3] } };
  };

  KINDS.wachturm = function (b, q) {
    const low = q === 'low', stB = C(P.stone), N = low ? 4 : 5, secH = 1.04;
    b.box(1.95, 0.26, 1.95, 0, -0.16, 0, C(P.stoneDark));
    for (let i = 0; i < N; i++) {
      const hb = 0.86 - 0.04 * i * (5 / N), ht = 0.86 - 0.04 * (i + 1) * (5 / N);
      frustumBox(b, hb, ht, secH * 5 / N, 0, 0.1 + i * secH * 5 / N, 0, (k) => stoneTone(stB, i, k, 0), { sk: '', j: 0.07 });
    }
    door(b, 'f', 0, 0.84, 0.44, 0.82, { low, frame: P.stoneLight }); archDec(b, 'f', 0, 0.44, 0.82, 0.84, C(P.timberDark), 2);
    const slit = C(P.char), hwAt = (y) => 0.86 - 0.0385 * (y - 0.1);
    for (const [f, sg] of [['f', 1], ['k', -1], ['r', 1], ['l', -1]]) for (const y of [2.0, 3.5]) dec(b, f, 0, 0.07, y, y + 0.42, sg * hwAt(y), slit, 3);
    // wooden fighting platform: lord-coloured fascia, crenelated hoarding, flag
    const yT = 0.1 + N * secH * 5 / N;
    b.box(1.5, 0.2, 1.5, 0, yT - 0.08, 0, mix(stB, C(P.stoneDark), 0.3), { sk: 'b' });
    b.box(2.0, 0.26, 2.0, 0, yT + 0.1, 0, [1, 1, 1], { team: 1, sk: 'b' });
    b.box(1.86, 0.06, 1.86, 0, yT + 0.36, 0, C(P.plank), { sk: 'b' });
    const hy = yT + 0.4, mc = C(P.timber);
    for (const s of [-1, 1]) {
      merlonRow(b, 'x', s * 0.92, -0.9, 0.9, hy, 0.6, 0.42, 0.55, 0.1, mc, { sk: 'b' });
      merlonRow(b, 'z', s * 0.92, -0.9, 0.9, hy, 0.6, 0.42, 0.55, 0.1, mc, { sk: 'b' });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.13, 0.95, 0.13, sx * 0.92, hy, sz * 0.92, C(P.timberDark));
    b.pole(0, hy, 0, 0, hy + 1.7, 0, 0.03, 0.022, 4, C(P.timberDark));
    pennant(b, 0, hy + 1.1, 0, 0.62, 0.7, 0.42, q);
    b.cyl(0.14, 0.1, 0.12, 6, 0.5, hy, -0.5, C(P.iron)); b.sph(0.1, 0.5, hy + 0.14, -0.5, C(P.ember), { glow: 1.6, sh: 0, j: 0.05, d: 0 });
    return { w: 2, d: 2, h: yT, stone: true, anchors: { door: [0, 0, 1.0], work: [0, 0, 1.0] } };
  };

  KINDS.brunnen = function (b, q) {
    const low = q === 'low', st = C(P.stone), sg = low ? 6 : 8, rimC = C(P.stoneLight);
    b.cyl(0.4, 0.44, 0.58, sg, 0, -0.08, 0, (k) => stoneTone(st, k, 3, 0), { sk: 'bt' });
    const outer = [], inner = [], low2 = [];
    for (let k = 0; k < sg; k++) { const a = (k / sg) * TAU; outer.push([cos(a) * 0.46, 0.52, sin(a) * 0.46]); inner.push([cos(a) * 0.29, 0.52, sin(a) * 0.29]); low2.push([cos(a) * 0.29, 0.18, sin(a) * 0.29]); }
    for (let k = 0; k < sg; k++) {
      const k2 = (k + 1) % sg;
      b.Qo(outer[k], outer[k2], inner[k2], inner[k], rimC, NO, null, [0, 0, 0]);
      const am = ((k + 0.5) / sg) * TAU;
      b.Qo(inner[k], inner[k2], low2[k2], low2[k], mul(st, 0.55), NO, [1, 1, 0, 0], [cos(am) * 3, 0.35, sin(am) * 3]);
    }
    b.poly(low2.map((p) => [p[0], 0.24, p[2]]).reverse(), C(P.water), { sh: 0, j: 0.03, glow: 0.2 });
    for (const sx of [-1, 1]) b.box(0.08, 0.95, 0.08, sx * 0.36, 0.48, 0, C(P.timberDark));
    b.beam(-0.4, 1.38, 0, 0.4, 1.38, 0, 0.07, C(P.timberDark));
    b.pole(-0.42, 1.0, 0, 0.42, 1.0, 0, 0.045, 0.045, 5, C(P.timber), { caps: true });
    b.beam(0.42, 1.0, 0, 0.5, 0.85, 0.08, 0.035, C(P.timberLight));
    b.rig(5, [0, 1.0, 0]);
    b.pole(0, 1.0, 0, 0, 0.64, 0, 0.012, 0.012, 3, C(P.straw));
    b.cyl(0.075, 0.095, 0.15, 6, 0, 0.5, 0, C(P.plank), { cap: C(P.water), sk: 'b' });
    b.rig(1, [0, 1.7, 0]);
    b.roof(0.95, 0.9, 0.4, 0, 1.38, 0, C(P.shingle), { rows: 3, band: 0.88, skirt: 0.06 });
    b.roof(1.0, 0.26, 0.1, 0, 1.74, 0, [1, 1, 1], { team: 1, under: false, rows: 1 });
    b.rig(0, null);
    return { w: 1, d: 1, h: 1.38, stone: true, anchors: { door: [0, 0, 0.6], work: [0, 0, 0.6] }, bucket: true };
  };

  // =====================================================================
  // CONSTRUCTION SITE (pegs and string -> footing -> timber frame -> scaffolding) and CRANE
  // Layers are aRig.w 10..13, the shader grows them with uBuild. One mesh.
  // =====================================================================
  function siteGeo(T, w, d, h, q, outline) {
    const b = new B(T), low = q === 'low', hw = w / 2 - 0.1, hd = d / 2 - 0.1;
    const peg = C(P.timberLight), twine = C(P.straw), pole = C('#a9824f'), plank = C(P.plank), plankD = C(P.plankDark);
    b.rig(10, null);
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]], pts = [];
    for (let i = 0; i < 4; i++) { const a = corners[i], c = corners[(i + 1) % 4]; pts.push(a); if (Math.hypot(c[0] - a[0], c[1] - a[1]) > 2.3) pts.push([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]); }
    pts.forEach((p, i) => { b.box(0.07, 0.42, 0.07, p[0], 0, p[1], peg); if (i < 4 || !low) b.box(0.11, 0.1, 0.02, p[0] + 0.05, 0.28, p[1], [1, 1, 1], { team: 1 }); });
    pts.forEach((p, i) => { const c = pts[(i + 1) % pts.length]; b.beam(p[0], 0.33, p[1], c[0], 0.33, c[1], 0.014, twine); });
    if (outline) {                      // farms: pegs and twine around the whole plot too
      const ow = outline[0] / 2 - 0.08, od = outline[1] / 2 - 0.08, oc = [[-ow, -od], [ow, -od], [ow, od], [-ow, od]], op = [];
      for (let i = 0; i < 4; i++) { const a = oc[i], c = oc[(i + 1) % 4], n = Math.max(1, Math.round(Math.hypot(c[0] - a[0], c[1] - a[1]) / 1.4)); for (let k = 0; k < n; k++) op.push([lerp(a[0], c[0], k / n), lerp(a[1], c[1], k / n)]); }
      op.forEach((pp) => b.box(0.07, 0.42, 0.07, pp[0] - outline[2], 0, pp[1] - outline[3], peg));
      op.forEach((pp, i) => { const c = op[(i + 1) % op.length]; b.beam(pp[0] - outline[2], 0.33, pp[1] - outline[3], c[0] - outline[2], 0.33, c[1] - outline[3], 0.014, twine); });
    }
    // material pile: planks and logs at the back
    for (let i = 0; i < 4; i++) b.box(0.6, 0.045, 0.18, hw - 0.4, 0.04 + i * 0.05, -hd + 0.35, mix(plank, plankD, (i % 2) * 0.5), { j: 0.08 });
    if (!low) { b.pole(-hw + 0.3, 0.07, -hd + 0.2, -hw + 0.85, 0.07, -hd + 0.25, 0.06, 0.06, 5, C(P.bark), { caps: true, cap: C(P.wattle) }); b.pole(-hw + 0.3, 0.07, -hd + 0.4, -hw + 0.85, 0.07, -hd + 0.42, 0.06, 0.06, 5, C(P.bark), { caps: true, cap: C(P.wattle) }); }
    // footing
    b.rig(11, null);
    const ft = C(P.stoneDark), fh = 0.26;
    b.bb(-hw, 0, -hd, hw, fh, -hd + 0.16, ft, { sk: 'b' }); b.bb(-hw, 0, hd - 0.16, hw, fh, hd, ft, { sk: 'b' });
    b.bb(-hw, 0, -hd + 0.16, -hw + 0.16, fh, hd - 0.16, ft, { sk: 'b' }); b.bb(hw - 0.16, 0, -hd + 0.16, hw, fh, hd - 0.16, ft, { sk: 'b' });
    // timber frame
    b.rig(12, null);
    const fr = C(P.timber), top = h + 0.05;
    for (const [px, pz] of corners) b.beam(px, 0, pz, px, top, pz, 0.11, fr);
    const nx = Math.max(0, Math.round(w / 1.2) - 1), nz = Math.max(0, Math.round(d / 1.2) - 1);
    for (let i = 1; i <= nx; i++) { const x = lerp(-hw, hw, i / (nx + 1)); b.beam(x, 0, -hd, x, top, -hd, 0.08, fr); b.beam(x, 0, hd, x, top, hd, 0.08, fr); }
    for (let i = 1; i <= nz; i++) { const z = lerp(-hd, hd, i / (nz + 1)); b.beam(-hw, 0, z, -hw, top, z, 0.08, fr); b.beam(hw, 0, z, hw, top, z, 0.08, fr); }
    for (const y of [top, top * 0.5]) {
      b.beam(-hw, y, -hd, hw, y, -hd, 0.08, fr); b.beam(-hw, y, hd, hw, y, hd, 0.08, fr);
      b.beam(-hw, y, -hd, -hw, y, hd, 0.08, fr); b.beam(hw, y, -hd, hw, y, hd, 0.08, fr);
    }
    if (!low) { b.beam(-hw, 0.1, hd, 0, top * 0.5, hd, 0.06, fr); b.beam(hw, 0.1, hd, 0, top * 0.5, hd, 0.06, fr); }
    // scaffolding (poles, ledgers, planks) just outside the frame
    b.rig(13, null);
    const sw = hw + 0.08, sd = hd + 0.08, sTop = top + 0.45, lv = [];
    for (let y = 0.8; y < sTop - 0.2; y += 0.85) lv.push(y);
    const sp = [[-sw, sd], [sw, sd], [sw, -sd], [-sw, -sd]];
    for (let i = 1; i <= nx; i++) sp.push([lerp(-sw, sw, i / (nx + 1)), sd]);
    for (const p of sp) b.pole(p[0], 0, p[1], p[0], sTop, p[1], 0.032, 0.03, 4, pole);
    lv.forEach((y, li) => {
      b.beam(-sw, y, sd, sw, y, sd, 0.035, pole); b.beam(sw, y, sd, sw, y, -sd, 0.035, pole); b.beam(-sw, y, sd, -sw, y, -sd, 0.035, pole);
      if (li % 2 === 0) for (let i = 0; i < Math.round(w * 2.2); i++) {
        const x0 = lerp(-sw, sw, i / Math.round(w * 2.2)), x1 = lerp(-sw, sw, (i + 1) / Math.round(w * 2.2));
        b.box(x1 - x0 - 0.02, 0.04, 0.4, (x0 + x1) / 2, y, sd + 0.0, i % 2 ? plank : plankD, { j: 0.08, sk: 'b' });
      }
    });
    if (!low) b.beam(-sw, 0.05, sd, sw, lv[Math.min(1, lv.length - 1)], sd, 0.03, pole);
    // ladder
    b.beam(sw - 0.15, 0, sd + 0.3, sw - 0.15, lv[Math.min(1, lv.length - 1)] + 0.5, sd + 0.1, 0.035, pole); b.beam(sw - 0.4, 0, sd + 0.3, sw - 0.4, lv[Math.min(1, lv.length - 1)] + 0.5, sd + 0.1, 0.035, pole);
    for (let i = 1; i < 5; i++) b.beam(sw - 0.4, 0.2 * i + 0.1, sd + 0.28 - i * 0.02, sw - 0.15, 0.2 * i + 0.1, sd + 0.28 - i * 0.02, 0.03, pole);
    return b;
  }
  // crane: the whole mesh turns about its mast (origin), boom pointing +x
  function craneGeo(T, h, len, q) {
    const b = new B(T), wd = C(P.timberDark), wl = C(P.timber), rope = C(P.straw);
    b.box(0.14, h, 0.14, 0, 0, 0, wd);
    b.beam(0, h * 0.7, 0, -0.3, 0, 0.3, 0.07, wl); b.beam(0, h * 0.7, 0, -0.3, 0, -0.3, 0.07, wl); b.beam(0, h * 0.7, 0, 0.35, 0, 0, 0.07, wl);
    b.beam(-0.45, h + 0.02, 0, len, h + 0.08, 0, 0.1, wl);
    b.beam(len * 0.8, h + 0.08, 0, 0, h + 0.5, 0, 0.03, rope);
    b.box(0.3, 0.22, 0.26, -0.45, h - 0.2, 0, C(P.stoneDark));
    b.pole(len - 0.1, h + 0.05, 0, len - 0.1, h - 0.9, 0, 0.012, 0.012, 3, rope);
    b.box(0.14, 0.14, 0.14, len - 0.1, h - 1.05, 0, C(P.iron));
    b.box(0.3, 0.07, 0.07, len - 0.1, h - 0.9, 0, wd);
    return b;
  }

  // =====================================================================
  // RUINS: charred stubs and rubble on the footprint
  // =====================================================================
  function ruinGeo(T, w, d, stone, seed, q, field) {
    const b = new B(T), r = rng(seed), low = q === 'low', hw = w / 2 - 0.1, hd = d / 2 - 0.1;
    const wallC = stone ? C(P.stone) : C(P.timberDark), cinder = C(P.char), ash = mix(C('#3a332f'), C(P.stoneDark), 0.3);
    b.bb(-hw, 0, -hd, hw, 0.07, hd, ash, { sk: 'b', j: 0.12 });
    const stub = (x, z, ax, len, hgt) => {
      const c = mix(mix(wallC, cinder, stone ? 0.2 : 0.55), C(P.stoneLight), stone ? r() * 0.2 : 0);
      if (ax === 'x') b.box(len, hgt, 0.2, x, 0.04, z, c, { j: 0.12 }); else b.box(0.2, hgt, len, x, 0.04, z, c, { j: 0.12 });
    };
    const nS = low ? 2 : 3;
    for (let i = 0; i < nS; i++) {
      const len = w / nS * 0.78, x = lerp(-hw, hw, (i + 0.5) / nS);
      stub(x, -hd, 'x', len, 0.2 + r() * 0.6); stub(x, hd, 'x', len, 0.15 + r() * 0.5);
    }
    for (let i = 0; i < nS; i++) {
      const len = d / nS * 0.7, z = lerp(-hd, hd, (i + 0.5) / nS);
      stub(-hw, z, 'z', len, 0.2 + r() * 0.55); stub(hw, z, 'z', len, 0.15 + r() * 0.5);
    }
    if (!stone) for (const [px, pz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) b.beam(px, 0.04, pz, px + (r() - 0.5) * 0.15, 0.7 + r() * 0.8, pz + (r() - 0.5) * 0.15, 0.1, cinder, { j: 0.15 });
    for (let i = 0; i < (low ? 3 : 6); i++) {
      const a = r() * TAU, rr = Math.sqrt(r()) * Math.min(hw, hd) * 0.85, x = cos(a) * rr * (hw / Math.min(hw, hd)) * 0.9, z = sin(a) * rr * (hd / Math.min(hw, hd)) * 0.9;
      if (r() < 0.55) b.beam(x - 0.4, 0.08 + r() * 0.05, z - 0.2, x + 0.4, 0.16 + r() * 0.3, z + 0.25, 0.07, mix(cinder, wallC, 0.3), { j: 0.15 });
      else b.sph(0.18 + r() * 0.18, x, 0.1, z, mix(wallC, ash, 0.4), { jit: 0.3, s: [1, 0.7, 1] });
    }
    for (let i = 0; i < 3; i++) b.sph(0.08, (r() - 0.5) * hw * 1.2, 0.1, (r() - 0.5) * hd * 1.2, C(P.ember), { glow: 1.2, sh: 0, j: 0.1 });
    if (field) {                        // the burnt-out fields around a farmhouse (positions relative to the house centre)
      const fw = field[0] / 2, fd = field[1] / 2, ox = -field[2], oz = -field[3];
      for (const [x0, x1, z0, z1] of [[-0.5, 2.5, -2.0, 2.0], [-2.5, -0.5, 0.0, 2.0]]) b.bb(ox + x0 + 0.03, 0, oz + z0 + 0.03, ox + x1 - 0.03, 0.04, oz + z1 - 0.03, mix(ash, C(P.soil), 0.12), { sk: 'b', j: 0.12 });
      for (let i = 0; i < 14; i++) b.box(0.05, 0.1 + r() * 0.12, 0.05, ox + (r() * 3 - 0.5), 0.04, oz + (r() * 4 - 2), C(P.char));
    }
    return b;
  }

  // =====================================================================
  // THE KEEP: stone tower (~9 high) with crenels, curtain wall with gate, corner turrets, big waving flag
  // =====================================================================
  function keepBuild(T, q, emblemIdx, ink) {
    const b = new B(T), low = q === 'low';
    const stB = C(P.stone), stD = C(P.stoneDark), stL = C(P.stoneLight), tile = C(P.roofTile), wood = C(P.timberDark), cob = C(P.cobble);
    const one = [1, 1, 1];
    // courtyard
    b.rig(7, null);
    b.bb(-2.95, -0.04, -2.95, 2.95, 0.06, 2.95, cob, { sk: 'b', j: 0.1 });
    for (let i = 0; i < (low ? 6 : 14); i++) { const x = (hash2(i, 3) - 0.5) * 4.6, z = (hash2(i, 7) - 0.5) * 4.6; b.cyl(0.35, 0.4, 0.02, 6, x, 0.06, z, mix(cob, C(P.sand), hash2(i, 11) * 0.5), { j: 0.12 }); }
    b.rig(0, null);
    // curtain wall (courses), gate gap on the front
    const WH = 2.1, WT = 0.45, wallY = [0, 0.7, 1.4];
    const wallSeg = (x0, x1, z0, z1) => {
      wallY.forEach((y, i) => b.bb(x0, y, z0, x1, y + 0.7, z1, stoneTone(stB, i, 4, 0), { sk: 'bt', j: 0.07 }));
    };
    const e = 2.95;
    wallSeg(-e, e, -e, -e + WT);                                    // back
    wallSeg(-e, -e + WT, -e + WT, e - WT); wallSeg(e - WT, e, -e + WT, e - WT);   // sides
    wallSeg(-e, -0.7, e - WT, e); wallSeg(0.7, e, e - WT, e);        // front, split by the gate
    // wall walk + merlons on the outer edge
    const wt = WH + 0.02, mh = 0.42, mstep = low ? 0.95 : 0.6;
    b.bb(-e, WH, -e, e, WH + 0.1, -e + WT + 0.06, stL, { sk: 'b' });
    b.bb(-e, WH, -e + WT, -e + WT + 0.06, WH + 0.1, e - WT, stL, { sk: 'b' }); b.bb(e - WT - 0.06, WH, -e + WT, e, WH + 0.1, e - WT, stL, { sk: 'b' });
    b.bb(-e, WH, e - WT - 0.06, -0.7, WH + 0.1, e, stL, { sk: 'b' }); b.bb(0.7, WH, e - WT - 0.06, e, WH + 0.1, e, stL, { sk: 'b' });
    const my = WH + 0.1, mc = mul(stL, 0.97);
    merlonRow(b, 'x', -e + 0.1, -e + 1.0, e - 1.0, my, mstep, 0.36, mh, 0.2, mc);
    merlonRow(b, 'z', -e + 0.1, -e + 1.0, e - 1.0, my, mstep, 0.36, mh, 0.2, mc);
    merlonRow(b, 'z', e - 0.1, -e + 1.0, e - 1.0, my, mstep, 0.36, mh, 0.2, mc);
    merlonRow(b, 'x', e - 0.1, -e + 1.0, -0.8, my, mstep, 0.36, mh, 0.2, mc); merlonRow(b, 'x', e - 0.1, 0.8, e - 1.0, my, mstep, 0.36, mh, 0.2, mc);
    // gate: stone jambs and lintel, wooden doors, torches
    b.bb(-0.95, 0, e - WT, -0.7, WH + 0.5, e, stL, { sk: 'b' }); b.bb(0.7, 0, e - WT, 0.95, WH + 0.5, e, stL, { sk: 'b' });
    b.bb(-0.95, 1.55, e - WT, 0.95, WH + 0.5, e, stoneTone(stB, 2, 5, 0), { sk: 'b' });
    b.bb(-0.7, 0, e - WT + 0.12, 0.7, 1.55, e - WT + 0.2, wood, { sk: 'b' });
    for (let i = -2; i <= 2; i++) dec(b, 'f', i * 0.26, 0.04, 0.05, 1.5, e - WT + 0.2, mul(wood, 0.6), 1);
    dec(b, 'f', 0, 1.4, 0.45, 0.55, e - WT + 0.2, C(P.iron), 2); dec(b, 'f', 0, 1.4, 1.05, 1.15, e - WT + 0.2, C(P.iron), 2);
    for (const sx of [-1, 1]) { b.box(0.05, 0.4, 0.05, sx * 1.08, 1.2, e + 0.02, wood); b.sph(0.08, sx * 1.08, 1.68, e + 0.02, C(P.flame), { glow: 3.5, sh: 0, j: 0.05 }); }
    b.rig(1, [0, 3.0, e - 0.2]);
    b.roof(2.1, 0.85, 0.5, 0, WH + 0.5, e - 0.45, tile, { rows: 2, band: 0.92 });
    b.rig(0, null);
    // corner turrets
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const tx = sx * 2.07, tz = sz * 2.07, sgm = low ? 6 : 8;
      b.cyl(0.78, 0.84, 3.5, sgm, tx, 0, tz, (k) => stoneTone(stB, k, 6, 0), { sk: 'b', j: 0.07 });
      b.cyl(0.9, 0.8, 0.25, sgm, tx, 3.3, tz, one, { team: 1 });
      b.cyl(0.88, 0.9, 0.12, sgm, tx, 3.55, tz, stL);
      b.rig(1, [tx, 5.2, tz]);
      b.cone(0.92, 1.5, sgm, tx, 3.6, tz, tile, { j: 0.1 });
      b.cone(0.1, 0.5, 4, tx, 5.05, tz, one, { team: 1 });
      b.rig(0, null);
      pennant(b, tx, 5.3, tz, 0.5, 0.55, 0.32, q);
      const fa = Math.atan2(sz, sx);
      b.push(tx, 2.4, tz, -fa); b.box(0.1, 0.5, 0.12, 0.8, 0, 0, C(P.char)); b.pop();
    }
    // central keep tower
    const kz = -1.15, N = low ? 5 : 7, TH = 8.2;
    b.box(3.5, 0.3, 3.5, 0, -0.18, kz, stD);
    for (let i = 0; i < N; i++) {
      const y0 = (i / N) * TH, y1 = ((i + 1) / N) * TH, hb = 1.5 - 0.22 * (y0 / TH), ht = 1.5 - 0.22 * (y1 / TH);
      frustumBox(b, hb, ht, y1 - y0, 0, y0, kz, (k) => stoneTone(stB, i, k, 0), { sk: '', j: 0.07 });
    }
    // corner quoins on the tower
    if (!low) for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 0; i < 8; i++) {
      const y = i * 1.0, hw = 1.5 - 0.22 * ((y + 0.5) / TH);
      b.box(0.26, 0.5, 0.26, sx * (hw - 0.04), y + (i % 2) * 0.05, kz + sz * (hw - 0.04), mul(stL, 0.92 + (i % 3) * 0.04), { sk: 'bt', j: 0.07 });
    }
    // tower portal, steps, windows and slits (south face looks into the yard)
    const hwK = (y) => 1.5 - 0.22 * (y / TH);
    door(b, 'f', 0, kz + hwK(0.6), 0.7, 1.15, { low, frame: P.stoneLight, wood: P.timberDark }); archDec(b, 'f', 0, 0.7, 1.15, kz + hwK(0.6), C(P.timberDark), 2);
    for (let j = 0; j < 3; j++) b.box(1.1 - j * 0.1, 0.3 - j * 0.1, 0.28, 0, -0.03, kz + 1.5 + 0.14 + 0.28 * j, stL);
    const wy = [[2.3, 0.3, 0.5], [4.2, 0.3, 0.55], [6.0, 0.3, 0.55]];
    for (const [y, ww, hh] of wy) {
      const hwy = 1.5 - 0.22 * (y / TH);
      win(b, 'f', -0.55, kz + hwy - 0.0, y, ww, hh, { low, frame: P.stoneDark }); win(b, 'f', 0.55, kz + hwy - 0.0, y, ww, hh, { low, frame: P.stoneDark });
      if (!low) { win(b, 'r', kz, hwy - 0.0, y + 0.1, ww, hh, { low, frame: P.stoneDark }); win(b, 'l', kz, -hwy + 0.0, y + 0.1, ww, hh, { low, frame: P.stoneDark }); win(b, 'k', 0, kz - hwy, y, ww, hh, { low, frame: P.stoneDark }); }
    }
    // lord banner hung on the tower front (static)
    const zAt = (y) => kz + hwK(y) + 0.03;
    b.rig(0, null);
    b.quad([-0.45, 3.0, zAt(3.0)], [0.45, 3.0, zAt(3.0)], [0.45, 5.3, zAt(5.3)], [-0.45, 5.3, zAt(5.3)], one, { team: 1, sh: 0, j: 0.03 });
    b.tri([-0.45, 3.0, zAt(3.0)], [0.0, 2.7, zAt(2.7)], [0.45, 3.0, zAt(3.0)], one, { team: 1, sh: 0, j: 0.03 });
    {
      const em = emblems[emblemIdx || 0], cy = 4.2, wide = em.fit === 'wide';
      for (const poly of em.polys) b.poly(poly.map((p) => { const y = cy + (wide ? 0.42 * 0.8 : 0.32 * 1.3) * p[1]; return [(wide ? 0.42 : 0.32) * p[0], y, zAt(y) + 0.015]; }), ink, { sh: 0, j: 0.02, team: 0 });
    }
    // corbelled parapet, merlons, stair turret, roof platform
    const topHW = 1.5 - 0.22, ty = TH;
    b.box(topHW * 2 + 0.5, 0.45, topHW * 2 + 0.5, 0, ty - 0.1, kz, mul(stL, 0.9), { sk: 'b' });
    b.box(topHW * 2 + 0.55, 0.2, topHW * 2 + 0.55, 0, ty + 0.34, kz, [1, 1, 1], { team: 1, sk: 'bt' });
    b.box(topHW * 2 + 0.3, 0.04, topHW * 2 + 0.3, 0, ty + 0.5, kz, C(P.plank), { sk: 'b', j: 0.1 });
    const pw = topHW + 0.25, py = ty + 0.54;
    for (const s of [-1, 1]) {
      merlonRow(b, 'x', kz + s * pw, -pw + 0.1, pw - 0.1, py, 0.62, 0.4, 0.5, 0.22, mc); merlonRow(b, 'z', s * pw, kz - pw + 0.1, kz + pw - 0.1, py, 0.62, 0.4, 0.5, 0.22, mc);
    }
    b.cyl(0.5, 0.58, 2.6, low ? 5 : 6, topHW - 0.1, ty - 0.2, kz - topHW + 0.1, (k) => stoneTone(stB, k, 8, 0), { sk: 'b' });
    b.rig(1, [topHW - 0.1, ty + 3.0, kz - topHW + 0.1]);
    b.cone(0.75, 1.3, low ? 5 : 6, topHW - 0.1, ty + 2.35, kz - topHW + 0.1, tile, { j: 0.1 });
    b.cone(0.08, 0.5, 4, topHW - 0.1, ty + 3.6, kz - topHW + 0.1, one, { team: 1 });
    b.rig(0, null);
    // flag pole + big waving flag (part 2)
    const fpx = -0.55, fpz = kz + 0.1, fTop = ty + 4.1;
    b.pole(fpx, ty + 0.5, fpz, fpx, fTop + 0.2, fpz, 0.05, 0.035, 5, C(P.timberDark));
    b.sph(0.08, fpx, fTop + 0.28, fpz, C(P.brass), { sh: 0 });
    flagCloth(b, fpx, fTop, fpz, 3.3, 2.1, low ? 4 : 8, low ? 2 : 4, emblemIdx, null, { plainCol: one, ink });
    // courtyard dressing: stable lean-to, barrels, a torch post, a training dummy
    for (const px of [1.4, 2.4]) for (const pz of [0.85, 1.95]) b.box(0.1, 1.5, 0.1, px, 0, pz, wood);
    b.rig(1, [2.0, 1.9, 1.4]);
    b.roof(1.4, 1.3, 0.3, 2.0, 1.45, 1.4, C(P.thatch), { rows: 2, band: 0.92, under: true });
    b.rig(0, null);
    b.box(0.5, 0.3, 1.0, 2.1, 0, 1.4, C(P.straw), { j: 0.15 });
    barrel(b, 1.5, 0, 2.3, 0.2, 0.45, q); barrel(b, 1.2, 0, 2.15, 0.17, 0.38, q);
    if (!low) { sack(b, -2.0, 0, 2.2, 0.2, C(P.sack), q); sack(b, -1.65, 0, 2.3, 0.18, C(P.sack), q); }
    b.pole(-1.6, 0, 0.9, -1.6, 1.2, 0.9, 0.04, 0.035, 4, wood); b.sph(0.08, -1.6, 1.3, 0.9, C(P.flame), { glow: 3.5, sh: 0, j: 0.05 });
    // stairs from the yard onto the tower platform side (visual only)
    return b;
  }

  // =====================================================================
  // PUBLIC: building / keep
  // =====================================================================
  const defCache = new Map();
  function getDef(T, kind, q) {
    const key = q + kind; let d = defCache.get(key);
    if (d) return d;
    const fn = KINDS[kind];
    if (!fn) throw new Error('FurtArt.building: unknown kind ' + kind);
    const b = new B(T), info = fn(b, q);
    const rc = info.rect || [0, 0, info.w, info.d];            // the part of the footprint covered by the building itself
    const mv = (g, dx, dz) => { g.translate(dx, 0, dz); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
    d = {
      info, body: b.geo(),
      site: mv(siteGeo(T, rc[2], rc[3], info.h, q, info.rect ? [info.w, info.d, rc[0], rc[1]] : null).geo(), rc[0], rc[1]),
      crane: craneGeo(T, info.h + 0.7, Math.min(rc[2], rc[3]) * 0.55, q).geo(),
      ruin: mv(ruinGeo(T, rc[2], rc[3], !!info.stone, hash2(kind.length * 31, kind.charCodeAt(0)) * 1e6 + 5, q, info.farm ? [info.w, info.d, rc[0], rc[1]] : null).geo(), rc[0], rc[1])
    };
    defCache.set(key, d);
    return d;
  }
  const _anchor = (T, group, name, p) => { const o = new T.Object3D(); o.name = name; o.position.set(p[0], p[1], p[2]); group.add(o); return o; };

  function building(T, kind, opts) {
    opts = opts || {};
    if (kind === 'bergfried') return keep(T, opts);
    const q = qOf(opts), d = getDef(T, kind, q), info = d.info;
    const mat = newMat(T, q, 'main'); setTeam(mat, colOf(opts.color));
    const u = mat.userData.u, group = new T.Group();
    const body = new T.Mesh(d.body, mat), site = new T.Mesh(d.site, mat), ruinM = new T.Mesh(d.ruin, mat);
    body.name = 'body'; site.name = 'site'; ruinM.name = 'ruin';
    const crane = new T.Mesh(d.crane, mat); crane.name = 'crane';
    const rcI = info.rect || [0, 0, info.w, info.d];
    crane.position.set(rcI[0] + rcI[2] / 2 - 0.45, 0, rcI[1] - rcI[3] / 2 + 0.45);
    body.castShadow = true; body.receiveShadow = true; ruinM.castShadow = true; ruinM.receiveShadow = true; site.receiveShadow = true;
    group.add(body, site, crane, ruinM);
    group.rotation.y = -((opts.rot | 0) % 2) * PI / 2;
    const anchors = {};
    for (const k in info.anchors) if (info.anchors[k]) anchors[k] = _anchor(T, group, k, info.anchors[k]);
    let buildP = 1, ruined = false, lt = null, workV = 0;
    const vis = () => {
      body.visible = !ruined && buildP > 0.33; body.castShadow = buildP >= 0.999;
      site.visible = !ruined && buildP < 0.999; crane.visible = !ruined && buildP < 0.999 && buildP > 0.05; ruinM.visible = ruined;
    };
    function setBuild(p) { buildP = clamp(p == null ? 1 : p, 0, 1); u.uBuild.value = buildP; vis(); }
    function setDamage(hp) { u.uDmg.value = 1 - clamp(hp == null ? 1 : hp, 0, 1); }
    function setBurnt(bn) { u.uBurnt.value = clamp(bn || 0, 0, 1) * (info.stone ? 0.45 : 1); }
    function setRuined(r) { ruined = !!r; vis(); }
    function setGrowth(g) { u.uGrowth.value = clamp(g == null ? 1 : g, 0, 1); }
    function animate(t, a) {
      a = a || {};
      const first = lt == null, dt = first ? 0 : clamp(t - lt, 0, 0.25); lt = t;
      const target = a.working && !ruined && buildP >= 0.999 ? 1 : 0;
      workV = first ? target : lerp(workV, target, 1 - Math.exp(-3 * dt));
      u.uWork.value = workV;
      if (crane.visible) crane.rotation.y = sin(t * 0.8) * 1.0;
      if (a.night != null) setNight(a.night);
    }
    function dispose() { mat.dispose(); }
    setBuild(opts.build == null ? 1 : opts.build); setGrowth(opts.growth == null ? 1 : opts.growth);
    return { group, setBuild, setDamage, setBurnt, setRuined, setGrowth, animate, anchors, kind, dispose, mesh: body, material: mat };
  }

  const keepCache = new Map();
  function keep(T, opts) {
    opts = opts || {};
    const q = qOf(opts), team = colOf(opts.color), em = (opts.emblem | 0) % 4, dark = lum(team) > 0.3, key = q + em + (dark ? 'd' : 'l');
    let d = keepCache.get(key);
    if (!d) {
      const ink = dark ? C(P.ink) : C(P.cream);
      d = { body: keepBuild(T, q, em, ink).geo(), ruin: keepRuinGeo(T, q).geo() };
      keepCache.set(key, d);
    }
    const mat = newMat(T, q, 'main'); setTeam(mat, team);
    const u = mat.userData.u, group = new T.Group(), body = new T.Mesh(d.body, mat), ruinM = new T.Mesh(d.ruin, mat);
    body.castShadow = body.receiveShadow = ruinM.castShadow = ruinM.receiveShadow = true; ruinM.visible = false;
    group.add(body, ruinM);
    const anchors = { flag: _anchor(T, group, 'flag', [-0.55, 12.4, -1.05]), gate: _anchor(T, group, 'gate', [0, 0, 3.25]), top: _anchor(T, group, 'top', [0, 9.0, -1.15]) };
    function setDamage(hp) { u.uDmg.value = 1 - clamp(hp == null ? 1 : hp, 0, 1); }
    function setBurnt(bn) { u.uBurnt.value = clamp(bn || 0, 0, 1) * 0.45; }
    function setRuined(r) { body.visible = !r; ruinM.visible = !!r; }
    return { group, setDamage, setBurnt, setRuined, setBuild() {}, setGrowth() {}, animate() {}, anchors, dispose() { mat.dispose(); }, mesh: body, material: mat };
  }
  function keepRuinGeo(T, q) {
    const b = ruinGeo(T, 6, 6, true, 4242, q), r = rng(9), st = C(P.stone), sd = C(P.stoneDark);
    // a broken tower stump and wall fragments on top of the generic rubble
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.2, hgt = 0.8 + r() * 2.4 * (i % 3 === 0 ? 0.4 : 1);
      b.push(cos(a) * 1.25, 0, -1.15 + sin(a) * 1.25, -a);
      b.box(0.35, hgt, 0.95, 0, 0.04, 0, stoneTone(st, i, 3, 0), { j: 0.12 });
      b.pop();
    }
    for (const [x, z, ax, len] of [[-2.7, 0, 'z', 2.2], [2.7, 1.2, 'z', 1.6], [0, -2.7, 'x', 2.6], [-1.6, 2.7, 'x', 1.4]]) {
      if (ax === 'x') b.box(len, 0.5 + r() * 0.8, 0.45, x, 0.04, z, stoneTone(sd, 1, 2, 0), { j: 0.12 }); else b.box(0.45, 0.5 + r() * 0.8, len, x, 0.04, z, stoneTone(sd, 1, 2, 0), { j: 0.12 });
    }
    return b;
  }

  // visible meshes and (draw-range and instance aware) triangles under root
  function stats(root) {
    let tris = 0, calls = 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      let v = o, vis = true;
      while (v && v !== root) { if (!v.visible) { vis = false; break; } v = v.parent; }
      if (!vis) return;
      const g = o.geometry; let n = g.index ? g.index.count : g.attributes.position.count;
      const dr = g.drawRange; if (dr && isFinite(dr.count)) n = Math.min(n, dr.count);
      tris += (n / 3) * (o.isInstancedMesh ? o.count : 1); calls++;
    });
    return { tris: Math.round(tris), calls };
  }

  // =====================================================================
  // UNITS: one InstancedMesh per kind, animated entirely in the vertex shader (see VS_UNIT).
  // Nose along +x, feet at y = 0. Body parts are tagged with aRig (pivot + part id).
  // =====================================================================
  const UNIT_KINDS = ['bauer', 'speer', 'bogen', 'ritter', 'fackel'];
  const UNIT_DIMS = { bauer: [0.33, 0.62, 0.17], speer: [0.37, 0.7, 0.19], bogen: [0.35, 0.66, 0.14], ritter: [1.1, 1.4, 0.2], fackel: [0.34, 0.64, 0.16] };
  const ONE = [1, 1, 1];

  // legs (parts 1/2) and arms (3/4) of a biped; arms end in hands
  function biped(b, o, low) {
    const { hipY, shY, legZ, armZ } = o;
    for (const [part, sz] of [[1, 1], [2, -1]]) {
      b.rig(part, [0, hipY, sz * legZ]);
      b.box(o.legW || 0.1, hipY, o.legW || 0.1, 0, 0, sz * legZ, o.pants);
      if (!low) b.box(0.16, 0.07, (o.legW || 0.1) + 0.015, 0.03, 0, sz * legZ, o.boot);
    }
    for (const [part, sz] of [[3, 1], [4, -1]]) {
      b.rig(part, [0, shY, sz * armZ]);
      b.box(o.armW || 0.08, o.armL || 0.3, o.armW || 0.08, 0, shY - (o.armL || 0.3), sz * armZ, o.sleeve);
      if (!low) b.box(0.07, 0.075, 0.07, 0, shY - (o.armL || 0.3) - 0.05, sz * armZ, o.skin);
    }
    b.rig(0, null);
  }

  function bauerBuild(T, q) {
    const b = new B(T), low = q === 'low', skin = C(P.skin), tunic = C('#a98a5a'), pants = C('#6b4f36'), boot = C('#3b2a1e'), belt = C(P.timberDark);
    const hipY = 0.33, shY = 0.62, armZ = 0.17, handY = shY - 0.34;
    biped(b, { hipY, shY, legZ: 0.075, armZ, pants, boot, sleeve: mix(tunic, C('#8a6a44'), 0.5), skin }, low);
    b.box(0.25, 0.32, 0.3, 0, hipY - 0.02, 0, tunic); b.box(0.265, 0.045, 0.315, 0, hipY + 0.04, 0, belt);
    if (low) b.box(0.21, 0.22, 0.21, 0, 0.66, 0, skin); else b.sph(0.125, 0, 0.77, 0, skin, { s: [1, 1.05, 1] });
    if (!low) b.sph(0.12, -0.035, 0.81, 0, C(P.hair), { s: [1, 0.8, 1] });
    b.push(-0.02, 0.84, 0, 0, 1, 0, 0.5); b.cone(0.165, 0.2, low ? 5 : 7, 0, 0, 0, ONE, { team: 1 }); b.pop();
    // work tool (part 8: swings with the right arm; visible while working)
    b.rig(8, null);
    b.pole(0, handY, -armZ, 0, -0.06, -armZ, 0.02, 0.02, 4, C(P.timberLight));
    b.box(0.16, 0.08, 0.06, 0, -0.14, -armZ, C(P.steel), { sk: '' });
    if (!low) b.box(0.02, 0.15, 0.05, 0.1, -0.15, -armZ, C(P.steel), { sk: '' });
    // carry slots 20..23: sack, logs, block, bucket
    b.rig(20, [-0.2, 0.6, 0]);
    if (low) b.box(0.2, 0.3, 0.26, -0.2, 0.45, 0, C(P.sack)); else { b.sph(0.17, -0.2, 0.6, 0, C(P.sack), { s: [0.8, 1.15, 1.0], j: 0.1 }); b.cone(0.05, 0.09, 4, -0.2, 0.74, 0, mul(C(P.sack), 0.8)); }
    b.rig(21, [0, 0.75, -0.2]);
    for (const [y, z, r] of (low ? [[0.77, -0.17, 0.07]] : [[0.77, -0.21, 0.065], [0.75, -0.1, 0.06]])) b.pole(-0.4, y, z, 0.38, y, z, r, r, low ? 4 : 5, C(P.bark), { caps: !low, cap: C(P.timberLight) });
    b.rig(22, [0.26, 0.5, 0]);
    b.box(0.34, 0.24, 0.26, 0.27, 0.38, 0, C(P.stoneLight), { j: 0.12, sk: '' });
    b.rig(23, [0, handY, -armZ]);
    b.cyl(0.075, 0.095, 0.15, low ? 5 : 7, 0.02, 0.08, -armZ - 0.04, C(P.plank), { cap: C(P.water), sk: 'b' });
    b.rig(0, null);
    return b;
  }

  function speerBuild(T, q) {
    const b = new B(T), low = q === 'low', skin = C(P.skin), mail = C('#8c9096'), iron = C('#7f858d'), pants = C('#4d4338'), boot = C('#2e241c');
    const hipY = 0.37, shY = 0.7, armZ = 0.19, handY = shY - 0.34;
    biped(b, { hipY, shY, legZ: 0.08, armZ, pants, boot, sleeve: mail, skin, legW: 0.11, armW: 0.085, armL: 0.32 }, low);
    b.box(0.28, 0.37, 0.34, 0, hipY - 0.03, 0, ONE, { team: 1 });                    // lord-coloured surcoat
    b.box(0.3, 0.045, 0.36, 0, hipY + 0.03, 0, C(P.timberDark));
    b.box(0.3, 0.07, 0.4, 0, shY - 0.07, 0, mail);                                    // mail shoulders
    if (low) b.box(0.21, 0.2, 0.21, 0, 0.74, 0, skin); else b.sph(0.125, 0, 0.84, 0, skin, { s: [1, 1.05, 1] });
    b.cyl(0.095, 0.16, 0.13, low ? 6 : 8, 0, 0.87, 0, iron);                           // kettle helmet
    if (!low) { b.cyl(0.2, 0.2, 0.025, 8, 0, 0.87, 0, iron, { sk: '' }); b.box(0.025, 0.12, 0.03, 0.15, 0.76, 0, iron); }
    b.cone(0.07, 0.07, 5, 0, 1.0, 0, C(P.steel));
    // round shield on the left arm (part 6, rigid with the arm): lord-coloured face
    b.rig(6, [0, shY, armZ]);
    b.push(0.1, 0.5, armZ + 0.12, 0, 1, PI / 2);
    b.cyl(0.24, 0.24, 0.05, low ? 7 : 9, 0, -0.025, 0, C(P.plankDark), { sk: low ? 'b' : '' });
    if (low) { const pts = []; for (let k = 0; k < 7; k++) { const a = -(k / 7) * TAU; pts.push([cos(a) * 0.2, 0.027, sin(a) * 0.2]); } b.poly(pts, ONE, { team: 1 }); }
    else b.cyl(0.2, 0.2, 0.012, 9, 0, 0.026, 0, ONE, { team: 1, sk: 'b' });
    if (!low) b.cone(0.05, 0.05, 5, 0, 0.036, 0, C(P.steel));
    b.pop();
    // spear (part 5) with a pennon (part 16)
    b.rig(5, [0, handY, -armZ]);
    b.pole(0.0, 0.05, -armZ - 0.01, 0.0, 1.5, -armZ - 0.01, 0.02, 0.016, 4, C(P.timberLight));
    b.cone(0.05, 0.24, 4, 0.0, 1.5, -armZ - 0.01, C(P.steel));
    b.rig(16, [0, handY, -armZ]);
    b.tri([0.0, 1.46, -armZ - 0.01], [0.0, 1.3, -armZ - 0.01], [0.24, 1.38, -armZ - 0.01], ONE, { team: 1, glow: 1, dbl: true, sh: 0, j: 0.03 });
    b.rig(0, null);
    return b;
  }

  function bogenBuild(T, q) {
    const b = new B(T), low = q === 'low', skin = C(P.skin), pants = C('#5a4a30'), boot = C('#33271c'), hood = C('#587a3c');
    const hipY = 0.35, shY = 0.66, armZ = 0.14, handY = shY - 0.34;
    biped(b, { hipY, shY, legZ: 0.075, armZ, pants, boot, sleeve: C('#9a7e56'), skin }, low);
    b.box(0.25, 0.33, 0.29, 0, hipY - 0.03, 0, ONE, { team: 1 }); b.box(0.265, 0.04, 0.3, 0, hipY + 0.03, 0, C(P.timberDark));
    b.sph(0.12, 0, 0.81, 0, skin, { s: [1, 1.05, 1] });
    b.push(-0.02, 0.85, 0, 0, 1, 0, 0.3); b.cone(0.15, 0.24, low ? 5 : 6, 0, 0, 0, hood); b.pop();
    if (!low) { b.box(0.03, 0.03, 0.12, -0.05, 1.0, 0.0, C(P.cream)); b.cyl(0.158, 0.165, 0.03, 6, 0, 0.83, 0, hood, { sk: '' }); }
    b.pole(-0.15, 0.38, 0.07, -0.21, 0.74, 0.1, 0.05, 0.055, 5, C(P.timber), { caps: !low, cap: C(P.timberDark) });     // quiver
    if (!low) for (let i = 0; i < 3; i++) b.box(0.02, 0.1, 0.02, -0.21 + i * 0.01, 0.8, 0.08 + i * 0.015, C(P.cream));
    // bow (part 6) in the left hand: a bent stick and a string
    b.rig(6, [0, handY, armZ]);
    const hz = 0.1, bh = 0.36;
    b.beam(0.05, handY, hz, 0.02, handY + bh * 0.5, hz, 0.035, C(P.timber)); b.beam(0.02, handY + bh * 0.5, hz, -0.06, handY + bh, hz, 0.03, C(P.timberLight));
    b.beam(0.05, handY, hz, 0.02, handY - bh * 0.5, hz, 0.035, C(P.timber)); b.beam(0.02, handY - bh * 0.5, hz, -0.06, handY - bh, hz, 0.03, C(P.timberLight));
    if (!low) b.beam(-0.06, handY + bh, hz, -0.06, handY - bh, hz, 0.01, C(P.cream));
    // arrow (part 7): nocked at the right hand, visible while drawing
    b.rig(7, [0, handY, -armZ]);
    b.pole(0.0, handY, 0.0, 0.52, handY, 0.0, 0.012, 0.012, 3, C(P.timberLight));
    b.cone(0.03, 0.08, 3, 0.52, handY, 0.0, C(P.steel));
    b.push(0.52, handY, 0.0, 0, 1, 0, -PI / 2); b.cone(0.03, 0.08, 3, 0, 0, 0, C(P.steel)); b.pop();
    b.rig(0, null);
    return b;
  }

  function fackelBuild(T, q) {
    const b = new B(T), low = q === 'low', skin = C(P.skin), tunic = C('#5c4332'), pants = C('#3e3228'), boot = C('#2a2018');
    const hipY = 0.34, shY = 0.64, armZ = 0.16, handY = shY - 0.34;
    biped(b, { hipY, shY, legZ: 0.07, armZ, pants, boot, sleeve: mul(tunic, 1.1), skin, legW: 0.09, armW: 0.075 }, low);
    b.box(0.23, 0.31, 0.28, 0, hipY - 0.02, 0, tunic); b.box(0.25, 0.1, 0.3, 0, shY - 0.1, 0, ONE, { team: 1 });        // lord-coloured scarf over the shoulders
    b.sph(0.12, 0, 0.77, 0, skin, { s: [1, 1.05, 1] });
    if (!low) b.sph(0.115, -0.03, 0.8, 0, C('#2a2018'), { s: [1, 0.8, 1] });
    b.push(-0.03, 0.83, 0, 0, 1, 0, 0.45); b.cone(0.14, 0.28, low ? 5 : 6, 0, 0, 0, ONE, { team: 1 }); b.pop();
    // torch (part 5) and its flame (part 9), the flame glows with the night uniform and flickers
    b.rig(5, [0, handY, -armZ]);
    b.pole(0.0, handY - 0.08, -armZ, 0.0, handY + 0.46, -armZ, 0.022, 0.028, 4, C(P.timberDark));
    b.sph(0.055, 0.0, handY + 0.5, -armZ, C('#3a2a20'), { d: 0, sh: 0 });
    b.rig(9, [0, handY, -armZ]);
    b.cone(0.085, 0.26, 5, 0.0, handY + 0.52, -armZ, C(P.flame), { glow: 3.2, sh: 0, j: 0.06 });
    b.cone(0.05, 0.18, 4, 0.0, handY + 0.52, -armZ, C(P.flameHot), { glow: 4, sh: 0, j: 0.04 });
    b.rig(0, null);
    return b;
  }

  function ritterBuild(T, q) {
    const b = new B(T), low = q === 'low', skin = C(P.skin), coat = C('#7a4d2e'), coatD = C('#5a3822'), dark = C('#2b2019'), mail = C('#8c9096'), steel = C(P.steel);
    const shY = 1.4, armZ = 0.2, handY = shY - 0.34;
    // horse legs (parts 11..14), pivots at the hips
    const legs = [[11, 0.4, 0.15], [12, 0.4, -0.15], [13, -0.42, 0.15], [14, -0.42, -0.15]];
    for (const [part, x, z] of legs) {
      b.rig(part, [x, 0.7, z]);
      b.pole(x, 0.72, z, x + 0.02, 0.07, z, 0.08, 0.045, low ? 4 : 5, coat);
      if (!low) b.box(0.11, 0.08, 0.11, x + 0.03, 0, z, dark);
    }
    b.rig(0, null);
    // barrel, chest, haunches
    b.box(0.42, 0.55, 0.44, 0.34, 0.62, 0, coat); b.box(0.4, 0.5, 0.42, 0.0, 0.66, 0, mul(coat, 1.04)); b.box(0.44, 0.54, 0.44, -0.36, 0.62, 0, coatD);
    // neck and head (part 15: nods)
    b.rig(15, [0.5, 1.1, 0]);
    b.beam(0.46, 1.0, 0, 0.84, 1.52, 0, 0.22, coat, { t2: 0.2, caps: !low });
    b.beam(0.8, 1.52, 0, 1.06, 1.3, 0, 0.17, coat, { t2: 0.15, caps: !low });
    b.box(0.14, 0.12, 0.12, 1.12, 1.19, 0, dark);
    if (!low) { b.cone(0.035, 0.1, 3, 0.78, 1.58, 0.06, coatD); b.cone(0.035, 0.1, 3, 0.78, 1.58, -0.06, coatD); b.beam(0.44, 1.1, 0, 0.78, 1.58, 0, 0.05, dark, { t2: 0.06 }); }
    b.rig(10, [-0.58, 1.08, 0]);
    b.beam(-0.58, 1.08, 0, -0.74, 0.58, 0, 0.1, dark, { t2: 0.09 });                   // tail (part 10)
    b.rig(0, null);
    // caparison in the lord's colour: saddle cloth and flank drapes
    b.box(0.5, 0.07, 0.55, -0.02, 1.08, 0, ONE, { team: 1, sk: low ? 'b' : '' });
    for (const sz of [-1, 1]) { b.box(0.46, 0.36, 0.035, 0.0, 0.7, sz * 0.235, ONE, { team: 1, sk: low ? 'btrl' : '' }); if (!low) b.box(0.48, 0.05, 0.04, 0.0, 0.68, sz * 0.24, C(P.brass), { sk: '' }); }
    // rider: surcoat, legs hugging the flanks, helmet with plume
    b.box(0.27, 0.42, 0.33, -0.05, 1.12, 0, ONE, { team: 1 });
    b.box(0.29, 0.06, 0.38, -0.05, shY - 0.06, 0, mail);
    for (const sz of [-1, 1]) { b.box(0.12, 0.4, 0.1, 0.02, 0.76, sz * 0.27, C('#4d4338')); if (!low) b.box(0.18, 0.07, 0.11, 0.05, 0.72, sz * 0.27, dark); }
    if (low) b.box(0.2, 0.2, 0.2, -0.03, 1.54, 0, skin); else b.sph(0.125, -0.03, 1.64, 0, skin);
    b.cyl(0.15, 0.17, 0.2, low ? 6 : 8, -0.03, 1.6, 0, steel);
    if (!low) b.box(0.03, 0.025, 0.16, 0.12, 1.66, 0, dark);
    b.push(-0.05, 1.8, 0, 0, 1, 0, 0.5); b.cone(0.07, 0.26, 4, 0, 0, 0, ONE, { team: 1 }); b.pop();
    // arms (3, 4), kite shield on the left (6), lance (5) with a pennon (16)
    for (const [part, sz] of [[3, 1], [4, -1]]) {
      b.rig(part, [0, shY, sz * armZ]);
      b.box(0.085, 0.32, 0.085, 0, shY - 0.32, sz * armZ, mail);
      if (!low) b.box(0.075, 0.08, 0.075, 0, shY - 0.4, sz * armZ, C('#5a5a60'));
    }
    b.rig(6, [0, shY, armZ]);
    b.box(0.3, 0.46, 0.045, 0.06, 0.84, armZ + 0.12, ONE, { team: 1, sk: low ? 'b' : '' });
    if (!low) b.box(0.34, 0.05, 0.06, 0.06, 1.28, armZ + 0.12, C(P.brass), { sk: '' });
    if (!low) b.cone(0.05, 0.05, 5, 0.06, 1.0, armZ + 0.16, steel);
    b.rig(5, [0, handY, -armZ]);
    b.pole(0.0, 0.9, -armZ - 0.02, 0.0, 2.15, -armZ - 0.02, 0.026, 0.02, 4, C(P.timberLight));
    b.cone(0.05, 0.3, 4, 0.0, 2.15, -armZ - 0.02, steel);
    b.rig(16, [0, handY, -armZ]);
    b.quad([0.0, 2.1, -armZ - 0.02], [0.0, 1.88, -armZ - 0.02], [0.34, 1.9, -armZ - 0.02], [0.34, 2.06, -armZ - 0.02], ONE, { team: 1, glow: 1, dbl: true, sh: 0, j: 0.03 });
    b.rig(0, null);
    return b;
  }
  const UNIT_BUILD = { bauer: bauerBuild, speer: speerBuild, bogen: bogenBuild, ritter: ritterBuild, fackel: fackelBuild };
  const unitGeoCache = new Map();
  const _rgbCache = new Map();
  function rgbLin(v) {
    let c = _rgbCache.get(v);
    if (!c) { c = new Float32Array(colOf(v)); if (_rgbCache.size > 256) _rgbCache.clear(); _rgbCache.set(v, c); }
    return c;
  }

  function units(T, opts) {
    const q = qOf(opts);
    function create(kind, max) {
      const id = UNIT_KINDS.indexOf(kind);
      if (id < 0) throw new Error('FurtArt.units: unknown kind ' + kind);
      max = Math.max(1, max | 0);
      let g0 = unitGeoCache.get(q + kind);
      if (!g0) { g0 = UNIT_BUILD[kind](T, q).geo(); unitGeoCache.set(q + kind, g0); }
      const geo = new T.BufferGeometry();
      for (const name in g0.attributes) geo.setAttribute(name, g0.attributes[name]);
      const ia = new Float32Array(max * 4), tc = new Float32Array(max * 3);
      const aInst = new T.InstancedBufferAttribute(ia, 4), aTeamCol = new T.InstancedBufferAttribute(tc, 3);
      aInst.setUsage(T.DynamicDrawUsage); aTeamCol.setUsage(T.DynamicDrawUsage);
      geo.setAttribute('aInst', aInst); geo.setAttribute('aTeamCol', aTeamCol);
      const mat = newMat(T, q, 'unit', { kindId: id }), d = UNIT_DIMS[kind];
      mat.userData.u.uDims.value.set(d[0], d[1], d[2], 0);
      const mesh = new T.InstancedMesh(geo, mat, max);
      mesh.frustumCulled = false; mesh.count = 0; mesh.name = 'units-' + kind; mesh.userData.kind = kind;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      let used = 0;
      return {
        mesh, kind, max,
        count(n) { used = clamp(n | 0, 0, max); mesh.count = used; },
        // x, y (up), z in scene space; yaw = rotation about +y (so pass -heading); anim 0 idle 1 walk 2 fight 3 work; phase in turns;
        // rgb = 0xRRGGBB (or '#rrggbb') lord colour; carry 0 none 1 korn 2 holz 3 stein 4 eimer
        set(i, x, y, z, yaw, anim, phase, rgb, carry) {
          if (i < 0 || i >= max) return;
          const c = Math.cos(yaw), s = Math.sin(yaw), m = mesh.instanceMatrix.array, o = i * 16;
          m[o] = c; m[o + 1] = 0; m[o + 2] = -s; m[o + 3] = 0; m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
          m[o + 8] = s; m[o + 9] = 0; m[o + 10] = c; m[o + 11] = 0; m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
          const k = i * 4; ia[k] = anim || 0; ia[k + 1] = phase || 0; ia[k + 2] = carry || 0; ia[k + 3] = 0;
          const col = rgbLin(rgb == null ? 0xffffff : rgb), t3 = i * 3; tc[t3] = col[0]; tc[t3 + 1] = col[1]; tc[t3 + 2] = col[2];
        },
        commit() {
          const n = Math.max(used, 1);
          for (const [attr, stride] of [[mesh.instanceMatrix, 16], [aInst, 4], [aTeamCol, 3]]) {
            attr.clearUpdateRanges(); attr.addUpdateRange(0, n * stride); attr.needsUpdate = true;
          }
        },
        dispose() { mat.dispose(); geo.dispose(); }
      };
    }
    return { quality: q, kinds: UNIT_KINDS, create };
  }

  // =====================================================================
  // BANNER: pole + waving flag in one mesh (DoubleSide material, flag cloth is part 2)
  // =====================================================================
  const bannerCache = new Map();
  function banner(T, opts) {
    opts = opts || {};
    const q = qOf(opts), team = colOf(opts.color), em = (opts.emblem | 0) % 4, dark = lum(team) > 0.3, key = q + em + (dark ? 'd' : 'l');
    let g = bannerCache.get(key);
    if (!g) {
      const b = new B(T), low = q === 'low', wood = C(P.timberDark);
      b.cyl(0.13, 0.3, 0.22, 6, 0, -0.04, 0, mix(C(P.stone), C(P.stoneDark), 0.3));
      b.pole(0, 0.15, 0, 0, 3.2, 0, 0.045, 0.03, 5, wood);
      b.sph(0.065, 0, 3.27, 0, C(P.brass), { sh: 0 });
      flagCloth(b, 0.035, 3.08, 0, 1.4, 0.9, low ? 3 : 5, 2, em, null, { plainCol: ONE, ink: dark ? C(P.ink) : C(P.cream), single: true });
      g = b.geo(); bannerCache.set(key, g);
    }
    const mat = newMat(T, q, 'main', { double: true }); setTeam(mat, team);
    const u = mat.userData.u, group = new T.Group(), mesh = new T.Mesh(g, mat);
    mesh.castShadow = true; group.add(mesh);
    let lt = null, mv = 0;
    function animate(t, a) {
      a = a || {}; const first = lt == null, dt = first ? 0 : clamp(t - lt, 0, 0.25); lt = t;
      const target = a.moving ? 1 : 0; mv = first ? target : lerp(mv, target, 1 - Math.exp(-4 * dt)); u.uMoving.value = mv;
    }
    return { group, animate, mesh, material: mat, dispose() { mat.dispose(); } };
  }

  // =====================================================================
  // NATURE FOR INSTANCING: trees (+ stumps), rocks, deco. Shared materials, geometry cached.
  // aRig.w = sway amplitude, set per primitive with sw().
  // =====================================================================
  const sw = (b, w) => { b.part = w; b.pv = [0, 0, 0]; };
  const natCache = new Map();
  function cached(key, fn) { let v = natCache.get(key); if (!v) { v = fn(); natCache.set(key, v); } return v; }

  function treeBuild(T, kind, q) {
    const b = new B(T), low = q === 'low', bark = C(P.bark), barkD = mul(C(P.bark), 0.75);
    if (kind === 'laub') {
      const lf = C(P.leaf), lfD = C(P.leafDark), lfL = C(P.leafLight);
      sw(b, 0.01); b.cyl(0.11, 0.2, 1.9, low ? 4 : 5, 0, -0.05, 0, bark);
      if (!low) { b.beam(0, 1.5, 0, 0.45, 2.3, 0.15, 0.09, bark); b.beam(0, 1.6, 0, -0.4, 2.35, -0.2, 0.08, bark); }
      sw(b, 0.07); b.sph(1.05, 0, 3.0, 0, lf, { jit: 0.18, s: [1, 0.92, 1] });
      sw(b, 0.09); b.sph(low ? 0.75 : 0.8, 0.55, 2.55, 0.15, lfD, { jit: 0.2 });
      if (!low) { sw(b, 0.09); b.sph(0.75, -0.5, 2.7, -0.2, mix(lf, lfD, 0.4), { jit: 0.2 }); sw(b, 0.11); b.sph(0.7, 0.1, 3.65, 0.1, lfL, { jit: 0.2 }); }
    } else if (kind === 'nadel') {
      const pn = C(P.pine), pnL = C(P.pineLight);
      sw(b, 0.0); b.cyl(0.07, 0.14, 1.1, low ? 4 : 5, 0, -0.05, 0, bark);
      const tiers = low ? [[0.95, 1.5, 0.8], [0.7, 1.4, 1.9], [0.42, 1.3, 2.9]] : [[1.05, 1.3, 0.7], [0.9, 1.2, 1.35], [0.72, 1.15, 2.0], [0.52, 1.05, 2.65], [0.3, 0.9, 3.25]];
      tiers.forEach(([r, h, y], i) => { sw(b, 0.03 + 0.03 * i); b.cone(r, h, low ? 6 : 8, 0, y, 0, mix(pn, pnL, i * 0.18), { j: 0.1, sk: 'b' }); });
    } else {
      const wl = C(P.willow), wlD = C(P.willowDark);
      sw(b, 0.0); b.cyl(0.13, 0.24, 1.7, 6, 0, -0.05, 0, bark);
      if (!low) { b.beam(0, 1.4, 0, 0.7, 2.1, 0.2, 0.12, bark); b.beam(0, 1.5, 0, -0.65, 2.15, -0.25, 0.11, bark); }
      sw(b, 0.07); b.sph(1.25, 0, 2.2, 0, wl, { jit: 0.15, s: [1, 0.62, 1] });
      const n = low ? 5 : 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + hash2(i, 5) * 0.4, rr = 0.95 + hash2(i, 9) * 0.35, x = cos(a) * rr, z = sin(a) * rr, len = 1.5 + hash2(i, 13) * 0.7, wd = 0.22;
        const tx = cos(a + PI / 2), tz = sin(a + PI / 2), ox = cos(a) * 0.18, oz = sin(a) * 0.18;
        sw(b, 0.16);
        b.quad([x - tx * wd, 2.05, z - tz * wd], [x + tx * wd, 2.05, z + tz * wd], [x + ox + tx * 0.03, 2.05 - len, z + oz + tz * 0.03], [x + ox - tx * 0.03, 2.05 - len, z + oz - tz * 0.03], mix(wl, wlD, hash2(i, 3)), { dbl: true, j: 0.1, sh: 0.45 });
      }
    }
    return b;
  }
  function stumpBuild(T, kind, q) {
    const b = new B(T), low = q === 'low', r = kind === 'weide' ? 0.26 : kind === 'laub' ? 0.2 : 0.16;
    sw(b, 0);
    b.cyl(r, r * 1.2, 0.34, low ? 5 : 7, 0, -0.04, 0, C(P.bark), { cap: C(P.timberLight), sk: 'b' });
    if (!low) for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.4; b.beam(cos(a) * r * 0.9, 0.12, sin(a) * r * 0.9, cos(a) * r * 1.5, 0.0, sin(a) * r * 1.5, 0.06, C(P.bark)); }
    return b;
  }
  function tree(T, kind, opts) {
    const q = qOf(opts); if (kind !== 'laub' && kind !== 'nadel' && kind !== 'weide') throw new Error('FurtArt.tree: unknown kind ' + kind);
    const mat = sharedMat(T, q, 'sway');
    return { geometry: cached(q + 'tree' + kind, () => treeBuild(T, kind, q).geo()), material: mat, stump: { geometry: cached(q + 'stump' + kind, () => stumpBuild(T, kind, q).geo()), material: mat } };
  }

  function rockBuild(T, variant, q) {
    const b = new B(T), r = C(P.rock), rD = C(P.rockDark), rL = C(P.rockLight), moss = C(P.moss), ochre = mix(C(P.rock), C('#a58f66'), 0.5);
    sw(b, 0);
    if (variant === 0) {
      b.sph(0.7, 0, 0.22, 0, r, { jit: 0.2, s: [1.15, 0.8, 1] }); b.sph(0.5, 0.65, 0.12, 0.2, rD, { jit: 0.25, s: [1, 0.8, 1] }); b.sph(0.38, -0.5, 0.1, 0.45, ochre, { jit: 0.25 });
      b.sph(0.42, 0.0, 0.62, -0.05, moss, { jit: 0.2, s: [1, 0.4, 1] });
    } else if (variant === 1) {
      b.sph(0.5, 0, 0.55, 0, rL, { jit: 0.2, s: [0.75, 1.55, 0.85] }); b.sph(0.42, 0.55, 0.2, 0.15, r, { jit: 0.25, s: [1, 0.9, 1] });
      b.sph(0.32, -0.45, 0.12, -0.3, rD, { jit: 0.25 }); b.sph(0.22, 0.3, 0.1, 0.7, ochre, { jit: 0.3 });
    } else {
      b.sph(0.45, -0.4, 0.15, 0, r, { jit: 0.25, s: [1.2, 0.7, 1] }); b.sph(0.5, 0.35, 0.17, 0.2, rL, { jit: 0.25, s: [1.1, 0.75, 1] });
      b.sph(0.3, 0.0, 0.1, -0.5, ochre, { jit: 0.25 }); b.sph(0.26, 0.8, 0.08, -0.25, rD, { jit: 0.3 });
    }
    return b;
  }
  function rock(T, opts) {
    opts = opts || {}; const q = qOf(opts), v = ((opts.variant | 0) % 3 + 3) % 3;
    return { geometry: cached(q + 'rock' + v, () => rockBuild(T, v, q).geo()), material: sharedMat(T, q, 'sway') };
  }

  function decoBuild(T, kind, q) {
    const b = new B(T), low = q === 'low';
    if (kind === 'schilf') {
      const n = low ? 5 : 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + hash2(i, 2), lean = 0.12 + hash2(i, 4) * 0.22, h = 1.1 + hash2(i, 6) * 0.8, x = cos(a) * 0.12, z = sin(a) * 0.12;
        const tx = -sin(a), tz = cos(a), tipx = x + cos(a) * lean, tipz = z + sin(a) * lean, wd = 0.045;
        sw(b, 0.1);
        b.quad([x - tx * wd, 0, z - tz * wd], [x + tx * wd, 0, z + tz * wd], [tipx + tx * 0.008, h, tipz + tz * 0.008], [tipx - tx * 0.008, h, tipz - tz * 0.008], mix(C('#8fae4c'), C('#c1c06a'), hash2(i, 8) * 0.6), { dbl: true, j: 0.1, sh: 0.4 });
        if (!low && i % 3 === 0) { sw(b, 0.1); b.cyl(0.035, 0.035, 0.2, 5, tipx * 0.85, h * 0.78, tipz * 0.85, C('#6e4a28'), { j: 0.08 }); }
      }
    } else if (kind === 'blume') {
      const cols = ['#ffffff', '#ffd23f', '#ff7aa8', '#8ab4ff'], n = low ? 3 : 5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + 0.4, rr = 0.06 + hash2(i, 3) * 0.1, x = cos(a) * rr, z = sin(a) * rr, h = 0.28 + hash2(i, 5) * 0.14;
        sw(b, 0.03);
        b.quad([x - 0.012, 0, z], [x + 0.012, 0, z], [x + 0.01, h, z], [x - 0.01, h, z], C('#4f8a35'), { dbl: true, j: 0.05, sh: 0.3 });
        b.cyl(0.0, 0.075, 0.05, 5, x, h, z, C(cols[i % 4]), { j: 0.06, sh: 0 });
      }
      for (let i = 0; i < 3; i++) { const a = i * 2.1; sw(b, 0.02); b.tri([cos(a) * 0.02, 0, sin(a) * 0.02], [cos(a + 0.5) * 0.2, 0.12, sin(a + 0.5) * 0.2], [cos(a - 0.5) * 0.12, 0.02, sin(a - 0.5) * 0.12], C('#5b9a3a'), { dbl: true, sh: 0.2 }); }
    } else if (kind === 'stein') {
      sw(b, 0);
      b.sph(0.22, 0, 0.08, 0, C(P.rock), { jit: 0.25, s: [1.2, 0.65, 1] }); b.sph(0.14, 0.24, 0.05, 0.1, C(P.rockLight), { jit: 0.3, s: [1, 0.7, 1] });
    } else if (kind === 'busch') {
      const g = C(P.leaf), gd = C(P.leafDark);
      sw(b, 0.03); b.sph(0.5, 0, 0.32, 0, g, { jit: 0.2, s: [1.1, 0.8, 1] });
      sw(b, 0.04); b.sph(0.36, 0.42, 0.22, 0.12, gd, { jit: 0.22 });
      if (!low) { sw(b, 0.04); b.sph(0.34, -0.38, 0.24, -0.15, mix(g, C(P.leafLight), 0.4), { jit: 0.22 }); for (let i = 0; i < 3; i++) b.cone(0.03, 0.05, 3, cos(i * 2.3) * 0.3, 0.45 + (i % 2) * 0.1, sin(i * 2.3) * 0.3, C('#c8334a'), { sh: 0 }); }
    } else throw new Error('FurtArt.deco: unknown kind ' + kind);
    return b;
  }
  function deco(T, kind, opts) {
    const q = qOf(opts);
    return { geometry: cached(q + 'deco' + kind, () => decoBuild(T, kind, q).geo()), material: sharedMat(T, q, 'sway') };
  }

  // =====================================================================
  // BRIDGES: along +x, 2 wide, deck top at y = 0, centred on the origin
  // =====================================================================
  function stoneBridgeBuild(T, len, q) {
    const b = new B(T), low = q === 'low', n = Math.max(1, Math.round(len / 5)), span = len / n, pier = 0.9, L = len / 2;
    const st = C(P.stone), stL = C(P.stoneLight), stD = C(P.stoneDark), deckTop = 0, bed = -2.4;
    const springY = -1.05, crownY = -0.42, rise = crownY - springY, N = low ? 4 : 6;
    // underside profile bottom(x): arch openings with piers between
    const arches = []; for (let i = 0; i < n; i++) { const c = -L + span * (i + 0.5); arches.push({ c, r: span / 2 - pier / 2 }); }
    const bottom = (x) => { for (const a of arches) { const u = (x - a.c) / a.r; if (abs(u) < 1) return springY + rise * sqrt(1 - u * u); } return bed; };
    // sample x positions: pier edges and arch points
    const xs = [-L];
    for (const a of arches) { xs.push(a.c - a.r); for (let k = 1; k < N; k++) xs.push(a.c - a.r + (2 * a.r * k) / N); xs.push(a.c + a.r); }
    xs.push(L);
    xs.sort((p, c) => p - c);
    const xsU = xs.filter((v, i) => i === 0 || v - xs[i - 1] > 1e-4);
    for (const sz of [-1, 1]) {
      const z = sz * 1.0;
      for (let i = 0; i < xsU.length - 1; i++) {
        const x0 = xsU[i], x1 = xsU[i + 1];
        const b0 = bottom(x0 + 1e-3), b1 = bottom(x1 - 1e-3);
        const bands = b0 < -1.2 || b1 < -1.2 ? 4 : 2;
        for (let k = 0; k < bands; k++) {
          const t0 = k / bands, t1 = (k + 1) / bands;
          const ya0 = lerp(b0, deckTop, t0), yb0 = lerp(b1, deckTop, t0), ya1 = lerp(b0, deckTop, t1), yb1 = lerp(b1, deckTop, t1);
          const c = stoneTone(st, i, k, 0);
          if (sz > 0) b.Q([x0, ya0, z], [x1, yb0, z], [x1, yb1, z], [x0, ya1, z], c, NO, [t0, t0, t1, t1]);
          else b.Q([x1, yb0, z], [x0, ya0, z], [x0, ya1, z], [x1, yb1, z], c, NO, [t0, t0, t1, t1]);
        }
        // underside of the arch
        if (sz > 0 && b0 > bed + 0.01) b.Q([x0, b0, -1], [x1, b1, -1], [x1, b1, 1], [x0, b0, 1], mul(stD, 0.8), NO, null);
      }
    }
    // pier faces inside the arch openings
    for (const a of arches) {
      b.Q([a.c - a.r, bed, 1], [a.c - a.r, bed, -1], [a.c - a.r, springY, -1], [a.c - a.r, springY, 1], mul(stD, 0.9), NO, null);
      b.Q([a.c + a.r, bed, -1], [a.c + a.r, bed, 1], [a.c + a.r, springY, 1], [a.c + a.r, springY, -1], mul(stD, 0.9), NO, null);
    }
    // end faces and deck
    for (const sx of [-1, 1]) { const x = sx * L; if (sx > 0) b.Q([x, bed, -1], [x, bed, 1], [x, deckTop, 1], [x, deckTop, -1], stD, NO, null); else b.Q([x, bed, 1], [x, bed, -1], [x, deckTop, -1], [x, deckTop, 1], stD, NO, null); }
    const nd = Math.max(2, Math.round(len / 1.2));
    for (let i = 0; i < nd; i++) {
      const x0 = lerp(-L, L, i / nd), x1 = lerp(-L, L, (i + 1) / nd);
      b.Q([x0, deckTop, 1], [x1, deckTop, 1], [x1, deckTop, -1], [x0, deckTop, -1], mix(C(P.cobble), C(P.sand), (i % 2) * 0.25 + 0.1), { j: 0.07, sh: 0 }, null);
    }
    // parapets with capstones and corner posts
    for (const sz of [-1, 1]) {
      b.box(len, 0.5, 0.3, 0, deckTop, sz * 0.87, stoneTone(st, 3, 4, 0), { sk: 'b', j: 0.07 });
      b.box(len + 0.04, 0.09, 0.4, 0, deckTop + 0.5, sz * 0.87, stL, { sk: 'b', j: 0.06 });
      for (const x of [-L + 0.15, L - 0.15]) { b.box(0.46, 0.85, 0.46, x, deckTop, sz * 0.87, stL, { sk: 'b', j: 0.07 }); b.cone(0.3, 0.2, 4, x, deckTop + 0.85, sz * 0.87, stD, { rot: PI / 4 }); }
    }
    // cutwaters at the piers
    if (n > 1 && !low) for (let i = 1; i < n; i++) { const x = -L + span * i; for (const dir of [-1, 1]) b.cone(0.52, 1.5, 4, x, bed + 0.1, dir * 1.0, stoneTone(st, i, 7, 0.1), { rot: PI / 4, sk: 'b', ex: 0.7, ez: 0.4, j: 0.07 }); }
    return b;
  }
  function stegBuild(T, len, q) {
    const b = new B(T), low = q === 'low', L = len / 2, wood = C(P.plank), woodD = C(P.plankDark), post = C(P.timber), bed = -2.0;
    const np = Math.max(4, Math.round(len / (low ? 0.6 : 0.4)));
    for (let i = 0; i < np; i++) {
      const x = lerp(-L, L, (i + 0.5) / np), w = len / np - 0.025, h = (hash2(i, 31) - 0.5) * 0.015;
      b.box(w, 0.07, 1.92, x, -0.07 + h, 0, mix(wood, woodD, hash2(i, 5) * 0.7), { sk: 'blr', j: 0.1, sh: 0.1 });
    }
    for (const sz of [-1, 1]) b.beam(-L, -0.2, sz * 0.75, L, -0.2, sz * 0.75, 0.16, woodD, { t2: 0.2 });
    const nposts = Math.max(2, Math.round(len / 2.4) + 1);
    for (let i = 0; i < nposts; i++) {
      const x = lerp(-L + 0.1, L - 0.1, i / (nposts - 1));
      for (const sz of [-1, 1]) {
        b.beam(x, bed, sz * 0.97, x, 0.95, sz * 0.97, 0.13, post, { t2: 0.13 });
        if (!low) b.box(0.19, 0.06, 0.19, x, 0.95, sz * 0.97, woodD);
      }
      if (!low) b.beam(x, -0.9, -0.97, x, -0.9, 0.97, 0.09, woodD);
      if (!low && i < nposts - 1) { const x2 = lerp(-L + 0.1, L - 0.1, (i + 1) / (nposts - 1)); b.beam(x, -1.6, 0.97, x2, -0.4, 0.97, 0.07, woodD); b.beam(x, -1.6, -0.97, x2, -0.4, -0.97, 0.07, woodD); }
    }
    for (const sz of [-1, 1]) { b.beam(-L, 0.9, sz * 0.97, L, 0.9, sz * 0.97, 0.08, post); b.beam(-L, 0.5, sz * 0.97, L, 0.5, sz * 0.97, 0.07, post); }
    return b;
  }
  function bridge(T, opts) {
    opts = opts || {};
    const q = qOf(opts), len = clamp(+opts.len || 10, 2, 40), kind = opts.kind === 'steg' ? 'steg' : 'stein', lk = Math.round(len * 4) / 4;
    const geo = cached(q + 'bridge' + kind + lk, () => (kind === 'steg' ? stegBuild(T, lk, q) : stoneBridgeBuild(T, lk, q)).geo());
    const mesh = new T.Mesh(geo, sharedMat(T, q, 'main')); mesh.castShadow = mesh.receiveShadow = true;
    const group = new T.Group(); group.add(mesh);
    return { group, mesh };
  }

  // =====================================================================
  // THE RUIN on the Werder (round tower, broken)
  // =====================================================================
  function ruin(T, opts) {
    const q = qOf(opts), low = q === 'low';
    const geo = cached(q + 'ruinTower', () => {
      const b = new B(T), r = rng(2025), st = C(P.stone), stD = C(P.stoneDark), moss = C(P.moss), R = 1.45, n = low ? 8 : 10;
      b.cyl(1.7, 2.1, 0.45, low ? 8 : 10, 0, -0.2, 0, mix(C(P.dirt), moss, 0.45), { j: 0.12, sk: '' });
      const heights = [4.5, 4.0, 3.1, 1.7, 0.9, 0.6, 1.3, 2.6, 4.1, 4.7];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + 0.15, h = heights[i % heights.length] * (0.9 + r() * 0.2), tw = (TAU * R / n) * 1.04;
        if (i === 5 && !low) continue;                                     // the gap where the wall collapsed
        b.push(cos(a) * R, 0, sin(a) * R, -a);
        b.box(0.6, h, tw, 0, 0.0, 0, stoneTone(st, i, 1, 0), { j: 0.1 });
        if (h > 1.8) b.box(0.6, 0.4 + r() * 0.5, tw * 0.55, 0.0, h, (r() - 0.5) * 0.3, stoneTone(st, i, 3, 0.05), { j: 0.12 });
        if (h > 2.5 && i % 2 === 0) { dec(b, 'r', 0, 0.34, h * 0.45, h * 0.45 + 0.7, 0.3, C(P.char), 1); archDec(b, 'r', 0, 0.34, h * 0.45 + 0.7, 0.3, C(P.char), 1); }
        b.pop();
      }
      for (let i = 0; i < (low ? 5 : 9); i++) {
        const a = r() * TAU, rr = 1.9 + r() * 1.4;
        b.push(cos(a) * rr, 0, sin(a) * rr, r() * 3, 1, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3);
        b.box(0.3 + r() * 0.35, 0.25 + r() * 0.3, 0.3 + r() * 0.3, 0, -0.04, 0, stoneTone(stD, i, 2, 0), { j: 0.12 });
        b.pop();
      }
      for (let i = 0; i < (low ? 3 : 6); i++) { const a = r() * TAU, rr = r() * 1.0; b.sph(0.25 + r() * 0.2, cos(a) * rr, 0.1, sin(a) * rr, mix(st, stD, 0.5), { jit: 0.3, s: [1, 0.6, 1] }); }
      for (const [x, y, z] of [[1.0, 4.2, 1.05], [-1.25, 3.1, -0.6], [0.2, 4.6, -1.4]]) b.sph(0.3, x, y, z, moss, { jit: 0.25, s: [1.2, 0.5, 1.2] });
      if (!low) for (let i = 0; i < 4; i++) { const a = i * 1.7 + 0.5, x = cos(a) * (R + 0.34), z = sin(a) * (R + 0.34); b.quad([x - sin(a) * 0.2, 2.2 + i * 0.4, z + cos(a) * 0.2], [x + sin(a) * 0.2, 2.2 + i * 0.4, z - cos(a) * 0.2], [x + sin(a) * 0.12, 0.8 + i * 0.3, z - cos(a) * 0.12], [x - sin(a) * 0.12, 0.8 + i * 0.3, z + cos(a) * 0.12], C('#4f8a35'), { dbl: true, sh: 0.3 }); }
      return b.geo();
    });
    const mesh = new T.Mesh(geo, sharedMat(T, q, 'main')); mesh.castShadow = mesh.receiveShadow = true;
    const group = new T.Group(); group.add(mesh);
    return { group, mesh };
  }

  // =====================================================================
  // PROPS (stockpile dressing): korn sacks, holz log pile, stein blocks, eimer bucket
  // =====================================================================
  function prop(T, kind, opts) {
    const q = qOf(opts);
    const geo = cached(q + 'prop' + kind, () => {
      const b = new B(T), low = q === 'low';
      if (kind === 'korn') {
        sack(b, -0.2, 0, 0.1, 0.19, C(P.sack), q); sack(b, 0.2, 0, 0.08, 0.2, mul(C(P.sack), 0.94), q); sack(b, 0.0, 0, -0.22, 0.19, mul(C(P.sack), 1.04), q); sack(b, 0.0, 0.3, 0.0, 0.18, C(P.sack), q);
      } else if (kind === 'holz') {
        logPile(b, 'x', 0, 0, 0.9, 4, 3, 0.085, C(P.bark), C(P.timberLight), 0);
      } else if (kind === 'stein') {
        const sc = C(P.stoneLight);
        b.box(0.5, 0.26, 0.36, -0.2, 0, 0.1, sc, { j: 0.12 }); b.box(0.46, 0.26, 0.34, 0.25, 0, 0.05, mul(sc, 0.92), { j: 0.12 });
        b.box(0.42, 0.24, 0.32, 0.0, 0.26, 0.08, mul(sc, 1.05), { j: 0.12 }); if (!low) b.box(0.36, 0.22, 0.3, 0.05, 0, -0.32, mul(sc, 0.86), { j: 0.12 });
      } else if (kind === 'eimer') {
        b.cyl(0.12, 0.15, 0.26, low ? 6 : 8, 0, 0, 0, (k) => (k % 2 ? C(P.plank) : C(P.plankDark)), { cap: C(P.water), sk: 'b' });
        b.cyl(0.157, 0.157, 0.025, low ? 6 : 8, 0, 0.06, 0, C(P.iron), { sk: '' });
        if (!low) b.beam(-0.13, 0.26, 0, 0.13, 0.26, 0, 0.02, C(P.iron));
      } else throw new Error('FurtArt.prop: unknown kind ' + kind);
      return b.geo();
    });
    const mesh = new T.Mesh(geo, sharedMat(T, q, 'main')); mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  window.FurtArt = { palette, tick, setNight, keep, building, units, banner, tree, rock, deco, bridge, ruin, prop, emblems, stats };
})();
