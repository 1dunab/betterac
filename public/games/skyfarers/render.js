// ===== Skyfarers renderer (three.js) =====================================
// One shared view of the sky archipelago over a full day: sky/fog/light keyed by
// state.dayT, weather mood from state.event, actors from sim.state (interpolated),
// instanced clouds and cloud sea, shield dome, bloom + god rays on 'high'.
// Models come from SkyfarersArt (never replace their materials); weather/fauna/
// particles come from SkyfarersFx through the hook at the bottom of the class.
// Plain script; THREE is handed to the constructor. See docs/SKYFARERS.md.
// ===========================================================================
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const wrapPi = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
  const fract = (x) => x - Math.floor(x);
  const hash1 = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

  // decorative clouds stay outside this ellipse (half axes in world units) so they never sit over islands or ships
  const DECO_RX = 62, DECO_RZ = 38, CAM_MIN_X = 55, CAM_MIN_Z = 34, CAM_MARGIN = 8, ASPECT = 1.6;
  const SHIP_Y = 6, SHIP_SCALE = 2.2, DRAGON_Y = 11, SEA_Y = -40, BLOB_Y = -33, SIM_DT = 1 / 30;
  const FALLBACK = ['#ff4d6d', '#4dabff', '#ffd166', '#7bd88f', '#c77dff', '#ff9f43', '#2ec4b6', '#f15bb5'];

  // ---- day keyframes: dayT 0 sunrise · .35 noon · .65 sunset · .75-.98 night · 1 dawn ----
  // zen/hor = sky colours, fog = fog + clear colour, key = sun/moon light, hemS/hemG = hemisphere fill,
  // sea = cloud sea tint, cloud = decorative cloud tint. Numbers: fogD fog density, keyI key light,
  // hemI hemisphere, night 0..1 (glow, stars), thr/bk bloom threshold/strength, rays god ray strength.
  const COLS = ['zen', 'hor', 'fog', 'key', 'hemS', 'hemG', 'sea', 'cloud'];
  const NUMS = ['fogD', 'keyI', 'hemI', 'night', 'thr', 'bk', 'rays'];
  const KF = [
    //  t     zen        hor        fog        key        hemS       hemG       sea        cloud     fogD   keyI hemI night thr  bk   rays
    [0.00, '#4d63b0', '#ffa27c', '#f1b6a2', '#ffb27a', '#a9b0e0', '#8a6a60', '#f2b8ae', '#ffd2c0', 0.0031, 2.3, 1.05, 0.12, 1.2, 0.45, 0.9],
    [0.08, '#5a8fd8', '#ffd2a8', '#ecd2bd', '#ffd9a8', '#b8d4f5', '#8a7a5c', '#fbe0d0', '#fff0e4', 0.0029, 3.0, 1.1, 0.0, 1.4, 0.3, 0.5],
    [0.20, '#3f86e0', '#b8dcff', '#cfe3f4', '#fff3dd', '#bfe0ff', '#8a7a5c', '#ffffff', '#ffffff', 0.0027, 3.4, 1.15, 0.0, 1.6, 0.2, 0.0],
    [0.35, '#3a82e6', '#bfe3ff', '#cfe6f7', '#fff4e0', '#bfe0ff', '#8a7a5c', '#ffffff', '#ffffff', 0.0027, 3.5, 1.15, 0.0, 1.6, 0.2, 0.0],
    [0.50, '#4a80d8', '#c8dcf0', '#e0dcc8', '#ffe8bd', '#c0d4ee', '#8a7a5c', '#fff3e6', '#fff8ee', 0.0028, 3.1, 1.1, 0.0, 1.5, 0.25, 0.1],
    [0.60, '#5878c8', '#ffc08a', '#f2c39a', '#ffc27a', '#c4b4d0', '#8a6a54', '#ffd2b0', '#ffdcc0', 0.0030, 2.8, 1.0, 0.05, 1.2, 0.4, 0.7],
    [0.65, '#4b4fa6', '#ff7a4a', '#e8906a', '#ff8a45', '#b898b8', '#6a4a50', '#f0a090', '#ffb090', 0.0031, 2.1, 0.9, 0.25, 1.0, 0.5, 1.0],
    [0.70, '#262a68', '#b24a78', '#6a4470', '#8a9adf', '#7a70b0', '#3a2c4c', '#8a6aa8', '#9a7ab0', 0.0032, 1.2, 1.1, 0.7, 0.85, 0.6, 0.0],
    [0.78, '#101a48', '#2c3672', '#28306a', '#a9bcff', '#5a6cc0', '#262444', '#56649f', '#7682b4', 0.0030, 2.3, 1.45, 1.0, 0.65, 0.8, 0.0],
    [0.93, '#0e1640', '#2a3270', '#262e66', '#a5b8ff', '#586abc', '#242242', '#52609a', '#7480b0', 0.0030, 2.2, 1.4, 1.0, 0.65, 0.8, 0.0],
    [0.98, '#1c2658', '#8a5a7a', '#5a4a70', '#a0a8e0', '#5a60a0', '#2a2238', '#6a5a90', '#7a6aa0', 0.0031, 0.9, 0.85, 0.7, 0.85, 0.6, 0.2],
    [1.00, '#4d63b0', '#ffa27c', '#f1b6a2', '#ffb27a', '#a9b0e0', '#8a6a60', '#f2b8ae', '#ffd2c0', 0.0031, 2.3, 1.05, 0.12, 1.2, 0.45, 0.9]
  ];

  // ---- shaders ----
  const SKY_VS = 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const SKY_FS = `
    varying vec3 vDir;
    uniform vec3 uZen, uHor, uBot, uSun, uMoon, uSunCol;
    uniform float uNight, uOv, uTime, uSunUp;
    float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    void main(){
      vec3 d = normalize(vDir); float y = d.y;
      vec3 col = mix(uHor, uZen, pow(clamp(y, 0.0, 1.0), 0.5));
      col = mix(col, uBot, smoothstep(0.02, -0.2, y));
      float sd = max(dot(d, uSun), 0.0), clear = 1.0 - uOv * 0.85;
      col += uSunCol * (pow(sd, 5.0) * 0.3 + pow(sd, 80.0) * 0.9 + smoothstep(0.9994, 0.9998, sd) * 3.0) * clear * uSunUp;
      float md = max(dot(d, uMoon), 0.0);
      col += vec3(0.75, 0.82, 1.0) * (smoothstep(0.9988, 0.9993, md) * 1.7 + pow(md, 50.0) * 0.18) * uNight * (1.0 - uOv);
      if (uNight > 0.02 && y > -0.02) {
        vec3 p = d * 70.0, i = floor(p); float h = hash(i);
        if (h > 0.975) {
          vec3 f = fract(p) - 0.5; float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 3.0) + h * 50.0);
          col += vec3(1.0, 0.95, 0.9) * smoothstep(0.38, 0.0, length(f)) * tw * uNight * (1.0 - uOv) * smoothstep(0.0, 0.15, y) * 1.4;
        }
      }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const SHIELD_VS = `
    varying vec3 vN; varying vec3 vV; varying vec3 vL;
    void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vL = normalize(position);
      gl_Position = projectionMatrix * mv; }`;
  const SHIELD_FS = `
    varying vec3 vN; varying vec3 vV; varying vec3 vL;
    uniform vec3 uCol; uniform float uShow, uTime; uniform vec4 uRip[4];
    void main(){
      float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
      vec3 l = normalize(vL); float a = atan(l.z, l.x), b = asin(clamp(l.y, -1.0, 1.0));
      vec2 g = vec2(a * 6.0, b * 9.0 + uTime * 0.15);
      float lines = smoothstep(0.43, 0.5, abs(fract(g.x + 0.5 * floor(g.y)) - 0.5)) + smoothstep(0.45, 0.5, abs(fract(g.y) - 0.5));
      float rip = 0.0;
      for (int i = 0; i < 4; i++) {
        if (uRip[i].w >= 0.0) {
          float d = acos(clamp(dot(l, uRip[i].xyz), -1.0, 1.0)), age = uRip[i].w;
          rip += smoothstep(0.22, 0.0, abs(d - age * 1.5)) * (1.0 - age / 1.1) + smoothstep(0.5, 0.0, d) * (1.0 - age * 2.0) * step(age, 0.5);
        }
      }
      float al = (fr * 0.85 + 0.035 + lines * 0.09 * (0.4 + fr) + rip * 0.7) * uShow;
      gl_FragColor = vec4(uCol * (1.0 + rip * 1.5 + fr), al);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const SEA_VS = 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
  const SEA_FS = `
    varying vec3 vW;
    uniform vec3 uHi, uLo, uFog, uCam, uSun; uniform float uTime, uFogD, uScale, uDay;
    float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; } return s; }
    float ch(vec2 p){ vec2 q = p * uScale + vec2(uTime * 0.004, uTime * 0.0016); float b = fbm(q); float d = fbm(q * 3.1 + b * 1.7 + 4.0); return b * 0.62 + d * 0.5; }
    void main(){
      vec2 p = vW.xz; float h = ch(p);
      vec2 sd = normalize(uSun.xz + vec2(1e-4)) * 2.5;
      float shade = clamp(0.5 + (h - ch(p + sd)) * 11.0, 0.0, 1.0);
      float cover = smoothstep(0.34 + 0.07 * uDay, 0.6 + 0.04 * uDay, h);
      vec3 lit = uHi * (0.62 + 0.55 * shade + 0.25 * smoothstep(0.55, 0.85, h));
      vec3 col = mix(uLo, lit, cover);
      float dist = length(vW - uCam), f = 1.0 - exp(-pow(dist * uFogD, 2.0));
      col = mix(col, uFog, clamp(f, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
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
      gl_FragColor = vec4(min(c * k, vec3(6.0)), 1.0);
    }`;
  const BLUR_FS = `
    varying vec2 vUv; uniform sampler2D tMap; uniform vec2 uStep;
    void main(){
      vec3 c = texture2D(tMap, vUv).rgb * 0.2270270270;
      c += (texture2D(tMap, vUv + uStep * 1.3846153846).rgb + texture2D(tMap, vUv - uStep * 1.3846153846).rgb) * 0.3162162162;
      c += (texture2D(tMap, vUv + uStep * 3.2307692308).rgb + texture2D(tMap, vUv - uStep * 3.2307692308).rgb) * 0.0702702703;
      gl_FragColor = vec4(c, 1.0);
    }`;
  // radial blur towards the sun's screen position: streaks of the bright parts of the picture
  const RAYS_FS = `
    varying vec2 vUv; uniform sampler2D tMap; uniform vec2 uSun; uniform float uDens;
    void main(){
      vec2 d = (uSun - vUv) * uDens / 24.0; vec2 uv = vUv; vec3 acc = vec3(0.0); float w = 1.0;
      for (int i = 0; i < 24; i++) { uv += d; acc += texture2D(tMap, uv).rgb * w; w *= 0.93; }
      gl_FragColor = vec4(acc / 24.0, 1.0);
    }`;
  const COMP_FS = `
    varying vec2 vUv; uniform sampler2D tMain, tB1, tB2, tRay; uniform float uS1, uS2, uRay, uFlash, uVig; uniform vec3 uRayCol;
    void main(){
      vec3 c = texture2D(tMain, vUv).rgb + texture2D(tB1, vUv).rgb * uS1 + texture2D(tB2, vUv).rgb * uS2;
      c += texture2D(tRay, vUv).rgb * uRayCol * uRay;
      c += vec3(0.9, 0.95, 1.0) * uFlash;
      vec2 q = vUv - 0.5; c *= 1.0 - uVig * dot(q, q) * 1.6;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  function radialTexture(T, size, stops) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), r = size / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
    for (const [p, col] of stops) gr.addColorStop(p, col);
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }

  function disposeObj(o) {
    o.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
  }

  class SkyfarersView {
    constructor(THREE, { width = 960, height = 600, quality = 'high' } = {}) {
      const T = this.T = THREE;
      let renderer;
      try { renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }); }
      catch (e) { throw new Error('WebGL nicht verfügbar: ' + e.message); }
      if (!renderer || !renderer.getContext()) throw new Error('WebGL nicht verfügbar');
      this.renderer = renderer;
      this.canvas = renderer.domElement;
      renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
      renderer.info.autoReset = false;
      renderer.setPixelRatio(1);
      this.reqW = width; this.reqH = height;
      this.quality = quality === 'low' ? 'low' : 'high';
      this.scene = new T.Scene();
      this.scene.fog = new T.FogExp2(0xcfe6f7, 0.0027);
      this.camera = new T.PerspectiveCamera(24, width / height, 1, 3200);
      this.drawCalls = 0; this.triangles = 0; this.lastMs = 0;
      this.world = null; this.look = {}; this.fx = null; this.island = null;
      this.sunDir = new T.Vector3(0, 1, 0);
      this.key = new T.Vector3(0, 1, 0);          // shadow-friendly key light direction (never below ~14 deg)
      this.flashV = 0; this.now = 0; this.lastNow = null; this.frame = 0;
      this.ships = new Map(); this.dragons = new Map(); this.isletsO = new Map(); this.bld = [];
      this.breath = new Map(); this.bounce = new Map(); this.ripples = []; this.sinkT0 = null;
      this.mood = { ov: 0, ovT: 0 };
      this.cam = { cx: 0, cz: 0, hw: 55, init: false };
      this.cur = {};
      for (const k of COLS) this.cur[k] = new T.Color();
      for (const k of NUMS) this.cur[k] = 0;
      this.kfc = KF.map((r) => ({ t: r[0], c: COLS.map((_, i) => new T.Color(r[1 + i])), n: r.slice(9) }));
      this._v = new T.Vector3(); this._v2 = new T.Vector3(); this._m = new T.Matrix4(); this._q = new T.Quaternion(); this._s = new T.Vector3(); this._c = new T.Color();
      this.applySize();
      this.initScene();
      this.setQuality(this.quality, true);
    }

    // ---------- sizing ----------
    applySize() {
      const hi = this.quality === 'high', maxW = hi ? 1920 : 960, maxH = hi ? 1200 : 600;
      const s = Math.min(1, maxW / this.reqW, maxH / this.reqH);
      this.W = Math.max(2, Math.round(this.reqW * s)); this.H = Math.max(2, Math.round(this.reqH * s));
      this.renderer.setSize(this.W, this.H, false);
      this.camera.aspect = this.W / this.H; this.camera.updateProjectionMatrix();
    }
    resize(width, height) {
      this.reqW = Math.max(2, width | 0); this.reqH = Math.max(2, height | 0);
      this.applySize(); this.disposePost();
    }

    setQuality(q, init) {
      q = q === 'low' ? 'low' : 'high';
      const changed = q !== this.quality;
      this.quality = q;
      const hi = q === 'high', rd = this.renderer;
      this.applySize();
      rd.shadowMap.enabled = hi;
      rd.shadowMap.type = this.T.PCFShadowMap;
      this.keyLight.castShadow = hi;
      if (!hi) { this.disposePost(); const sm = this.keyLight.shadow; if (sm.map) { sm.map.dispose(); sm.map = null; } }
      this.seaMat.uniforms.uScale.value = hi ? 0.016 : 0.014;
      this.decoMesh.count = hi ? this.decoN : Math.round(this.decoN * 0.5);
      if (this.fx && this.fx.setQuality) this.safeFx(() => this.fx.setQuality(q));
      if (changed && !init) this.rebuild();
      if (init) this.createFx();
    }

    // radial jitter keyed on the vertex position, so shared corners move together: cloudy, lumpy blobs
    puffy(g, amp) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = hash1(Math.round(x * 40) * 3.1 + Math.round(y * 40) * 7.7 + Math.round(z * 40) * 13.3) * 0.6 + hash1(Math.round(x * 9) * 5.1 + Math.round(y * 9) * 2.7 + Math.round(z * 9) * 9.3) * 0.4;
        const k = 1 + (n - 0.5) * amp * 2;
        p.setXYZ(i, x * k, y * k, z * k);
      }
      g.computeVertexNormals(); return g;
    }

    // ---------- scene skeleton: sky, lights, cloud sea, halos, dome ----------
    initScene() {
      const T = this.T, sc = this.scene;
      // sky dome follows the camera
      this.skyMat = new T.ShaderMaterial({
        vertexShader: SKY_VS, fragmentShader: SKY_FS, side: T.BackSide, depthWrite: false, depthTest: false, fog: false,
        uniforms: { uZen: { value: new T.Color() }, uHor: { value: new T.Color() }, uBot: { value: new T.Color() }, uSun: { value: new T.Vector3(0, 1, 0) },
          uMoon: { value: new T.Vector3(0, -1, 0) }, uSunCol: { value: new T.Color() }, uNight: { value: 0 }, uOv: { value: 0 }, uTime: { value: 0 }, uSunUp: { value: 1 } }
      });
      this.sky = new T.Mesh(new T.SphereGeometry(900, 24, 12), this.skyMat);
      this.sky.renderOrder = -100; this.sky.frustumCulled = false; sc.add(this.sky);
      // lights
      this.keyLight = new T.DirectionalLight(0xffffff, 3); this.keyLight.target.position.set(0, 0, 0);
      const sh = this.keyLight.shadow;
      sh.mapSize.set(2048, 2048); sh.camera.left = -46; sh.camera.right = 46; sh.camera.top = 40; sh.camera.bottom = -40; sh.camera.near = 20; sh.camera.far = 320;
      sh.bias = -0.0004; sh.normalBias = 0.06; sh.radius = 2.5;
      this.hemi = new T.HemisphereLight(0xbfe0ff, 0x8a7a5c, 1.1);
      sc.add(this.keyLight, this.keyLight.target, this.hemi);
      // soft round / ring textures
      this.texSoft = radialTexture(T, 128, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]);
      this.texHalo = radialTexture(T, 128, [[0, 'rgba(255,255,255,.55)'], [0.5, 'rgba(255,255,255,.28)'], [0.78, 'rgba(255,255,255,.1)'], [1, 'rgba(255,255,255,0)']]);

      // cloud sea: big flattened blobs far below + a base plane (instanced, vertex-coloured by height)
      const blobHi = this.puffy(new T.IcosahedronGeometry(1, 2), 0.22), blobLo = this.puffy(new T.IcosahedronGeometry(1, 1), 0.2);
      const addShade = (g, lo, hi) => {
        const p = g.attributes.position, c = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) { const k = lerp(lo, hi, clamp(p.getY(i) * 0.5 + 0.5, 0, 1)); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k; }
        g.setAttribute('color', new T.BufferAttribute(c, 3)); return g;
      };
      this.puffGeo = addShade(blobHi, 0.5, 1.0); this.puffGeoLo = addShade(blobLo, 0.5, 1.0);
      this.puffSoft = addShade(this.puffy(new T.SphereGeometry(1, 14, 10), 0.12), 0.8, 1.0);
      this.seaMat = new T.ShaderMaterial({
        vertexShader: SEA_VS, fragmentShader: SEA_FS, fog: false,
        uniforms: { uHi: { value: new T.Color() }, uLo: { value: new T.Color() }, uFog: { value: new T.Color() }, uCam: { value: new T.Vector3() }, uSun: { value: new T.Vector3(0, 1, 0) }, uTime: { value: 0 }, uFogD: { value: 0.001 }, uScale: { value: 0.016 }, uDay: { value: 0 } }
      });
      this.seaPlane = new T.Mesh(new T.PlaneGeometry(6000, 5000).rotateX(-Math.PI / 2), this.seaMat);
      this.seaPlane.position.y = SEA_Y; this.seaPlane.frustumCulled = false; this.seaPlane.renderOrder = -50;
      sc.add(this.seaPlane);
      let rs = 7;
      const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };

      // decorative clouds drifting below the ships: few, small, kept to the frame edges (updateDecor shrinks them
      // when they drift into the play area)
      this.decoN = 56;
      const decoMat = new T.MeshLambertMaterial({ vertexColors: true });
      this.decoMesh = new T.InstancedMesh(this.puffSoft, decoMat, this.decoN);
      this.decoMesh.frustumCulled = false; this.decoMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.decoData = [];
      for (let i = 0, id = 0; i < 10; i++) {
        let x, z; do { x = (rnd() * 2 - 1) * 105; z = (rnd() * 2 - 1) * 70; } while ((x / DECO_RX) ** 2 + (z / DECO_RZ) ** 2 < 1.1);
        const y = -17 + rnd() * 5, n = 5 + (i % 2), sz = 2.4 + rnd() * 1.8;
        for (let k = 0; k < n && id < this.decoN; k++, id++) {
          const a = k * 2.4, rr = k ? sz * (0.6 + 0.5 * rnd()) : 0;
          this.decoData.push({ x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr * 0.7, y: y + (rnd() - 0.4) * 1.2, s: sz * (k ? 0.55 + rnd() * 0.35 : 0.9), sy: 0.55 });
        }
      }
      this.decoMesh.count = this.decoData.length; this.decoN = this.decoData.length;
      for (let i = 0; i < this.decoN; i++) this.decoMesh.setColorAt(i, this._c.setScalar(1));
      sc.add(this.decoMesh);

      // rain clouds (state.clouds): translucent dark puff clusters
      this.rainN = 72;
      this.rainMat = new T.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.66, depthWrite: false });
      this.rainMesh = new T.InstancedMesh(this.puffSoft, this.rainMat, this.rainN);
      this.rainMesh.frustumCulled = false; this.rainMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); this.rainMesh.renderOrder = 5; this.rainMesh.count = 0;
      for (let i = 0; i < this.rainN; i++) this.rainMesh.setColorAt(i, this._c.setScalar(1));
      sc.add(this.rainMesh);

      // ship halos (billboards in player colour behind each ship) and blob shadows on the cloud sea
      this.haloMesh = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: this.texHalo, transparent: true, depthWrite: false, fog: false, opacity: 0.9 }), 12);
      this.haloMesh.frustumCulled = false; this.haloMesh.renderOrder = 10; this.haloMesh.count = 0;
      for (let i = 0; i < 12; i++) this.haloMesh.setColorAt(i, this._c.setScalar(1));
      sc.add(this.haloMesh);
      this.blobMat = new T.MeshBasicMaterial({ map: this.texSoft, color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false });
      this.blobMesh = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.blobMat, 24);
      this.blobMesh.frustumCulled = false; this.blobMesh.count = 0; this.blobMesh.renderOrder = 1;
      sc.add(this.blobMesh);

      // heart glow below the island (additive sprite)
      this.heartGlow = new T.Sprite(new T.SpriteMaterial({ map: this.texSoft, color: 0x7fe8ff, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
      this.heartGlow.position.set(0, -15, 0); this.heartGlow.scale.setScalar(16); this.heartGlow.renderOrder = 6;
      sc.add(this.heartGlow);

      // shield dome
      this.ripU = Array.from({ length: 4 }, () => new T.Vector4(0, 1, 0, -1));
      this.shieldMat = new T.ShaderMaterial({
        vertexShader: SHIELD_VS, fragmentShader: SHIELD_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false,
        uniforms: { uCol: { value: new T.Color('#6fdcff') }, uShow: { value: 0 }, uTime: { value: 0 }, uRip: { value: this.ripU } }
      });
      this.dome = new T.Mesh(new T.SphereGeometry(1, 40, 14, 0, TAU, 0, Math.PI / 2), this.shieldMat);
      this.dome.scale.set(22.5, 15, 22.5); this.dome.visible = false; this.dome.renderOrder = 8;
      sc.add(this.dome);

      // boost flame (shared by every ship, one mesh each, only drawn while boosting)
      this.flameGeo = new T.ConeGeometry(0.28, 1.6, 8, 1, true).rotateZ(Math.PI / 2).translate(-1.55, 0.55, 0);
      this.flameMat = new T.MeshBasicMaterial({ color: 0xffb05a, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false, fog: false, side: T.DoubleSide });

      // gust ribbons: one dynamic mesh (positions + rgba rewritten every frame)
      const GS = 3, GN = 14, GMAX = 8, nv = GMAX * GS * (GN + 1) * 2;
      this.gustCfg = { GS, GN, GMAX };
      const gg = new T.BufferGeometry();
      this.gPos = new T.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(T.DynamicDrawUsage);
      this.gCol = new T.BufferAttribute(new Float32Array(nv * 4), 4).setUsage(T.DynamicDrawUsage);
      const gi = [];
      for (let s = 0; s < GMAX * GS; s++) for (let j = 0; j < GN; j++) { const a = (s * (GN + 1) + j) * 2; gi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      gg.setAttribute('position', this.gPos); gg.setAttribute('color', this.gCol); gg.setIndex(gi); gg.setDrawRange(0, 0);
      this.gustMat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: T.DoubleSide, fog: false });
      this.gustMesh = new T.Mesh(gg, this.gustMat); this.gustMesh.frustumCulled = false; this.gustMesh.renderOrder = 7;
      sc.add(this.gustMesh);

      // floating crates (shared art geometry + material, instanced)
      this.crates = {};
      const A = window.SkyfarersArt;
      this.crateMax = 48;
      this.crateGroup = new T.Group(); sc.add(this.crateGroup);
      this.crateInit = false;
      this.A = A;
    }

    initCrates() {
      const T = this.T, A = this.A;
      if (this.crateInit) return;
      for (const m of Object.values(this.crates)) { this.crateGroup.remove(m); m.dispose(); }
      this.crates = {};
      for (const res of ['holz', 'kristall']) {
        const src = A.crate(T, res, { quality: this.quality });
        const im = new T.InstancedMesh(src.geometry, src.material, this.crateMax);
        im.frustumCulled = false; im.count = 0; im.castShadow = false; im.instanceMatrix.setUsage(T.DynamicDrawUsage);
        this.crates[res] = im; this.crateGroup.add(im);
      }
      this.crateInit = true;
    }

    // ---------- world ----------
    setWorld(world, look) {
      this.world = world || this.world; this.look = look || this.look || {};
      this.clearWorld();
      if (!this.world) return;
      const T = this.T, A = this.A, q = this.quality;
      this.island = A.homeIsland(T, this.world.home, { quality: q });
      this.markShadows(this.island.group, false, true);
      this.scene.add(this.island.group);
      this.initCrates();
      // islets are created lazily from state (ids); pre-build from the world layout so the first frame is smooth
      for (const il of this.world.islets) this.ensureIslet(il.id, il.kind);
      this.cam.init = false;
    }

    setLook(look) {
      this.look = look || {};
      for (const [pid, R] of this.ships) {
        const c = this.colorOf(pid);
        if (c !== R.color) { this.removeShip(pid); }
      }
    }

    colorOf(pid) {
      const L = this.look && this.look[pid];
      if (L && L.color) return L.color;
      return FALLBACK[Math.abs(pid | 0) % FALLBACK.length];
    }

    clearWorld() {
      for (const pid of [...this.ships.keys()]) this.removeShip(pid);
      for (const id of [...this.dragons.keys()]) this.removeDragon(id);
      for (const [id, R] of this.isletsO) { this.scene.remove(R.obj.group); disposeObj(R.obj.group); }
      this.isletsO.clear();
      for (const B of this.bld) if (B && B.obj) { disposeObj(B.obj.group); }
      this.bld = [];
      if (this.island) { this.scene.remove(this.island.group); disposeObj(this.island.group); this.island = null; }
      this.crateInit = false;
      this.sinkT0 = null;
    }

    rebuild() {
      // quality switch: models are built per quality, so recreate every art object
      const w = this.world;
      if (this.crateInit) { for (const m of Object.values(this.crates)) { this.crateGroup.remove(m); m.dispose(); } this.crates = {}; this.crateInit = false; }
      if (w) this.setWorld(w, this.look);
    }

    markShadows(root, cast, recv) {
      root.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = recv; } });
    }

    // ---------- fx hook ----------
    createFx() {
      if (this.fx || !window.SkyfarersFx) return;
      try { this.fx = new window.SkyfarersFx(this.T, { scene: this.scene, camera: this.camera, quality: this.quality, view: this }); }
      catch (e) { console.warn('[SkyfarersView] fx init failed', e); this.fx = null; }
    }
    safeFx(fn) {
      try { fn(); } catch (e) { this._fxErr = (this._fxErr | 0) + 1; if (this._fxErr < 4) console.warn('[SkyfarersView] fx error', e); }
    }

    // handles for fx (read-only)
    shipObj(pid) { const R = this.ships.get(pid); return R ? R.art : null; }
    buildingObj(slot) { const B = this.bld[slot]; return B && B.obj ? B.obj : null; }
    dragonObj(id) { const R = this.dragons.get(id); return R ? R.art : null; }
    isletObj(id) { const R = this.isletsO.get(id); return R ? R.obj : null; }
    flash(s) { this.flashV = Math.max(this.flashV, clamp(s == null ? 1 : s, 0, 1.5)); }

    // ---------- events ----------
    event(ev, state) {
      if (!ev) return;
      const now = this.now;
      switch (ev.t) {
        case 'strike':
          this.flash(ev.absorbed ? 0.3 : ev.target === 'sky' ? 0.45 : 0.8);
          if (ev.absorbed || (state && state.shieldOn)) this.addRipple(ev.x, ev.y);
          break;
        case 'dragonFire': {
          this.breath.set(ev.id, now + 1500);
          if (ev.absorbed && state) { const d = state.dragons.find((q) => q.id === ev.id); if (d) this.addRipple(d.x, d.y); }
          break;
        }
        case 'buildDone': this.bounce.set(ev.slot, now); break;
        case 'sink': this.sinkT0 = now; break;
        case 'shieldOn': this.shieldSnap = false; break;
        default: break;
      }
      if (this.fx) this.safeFx(() => this.fx.event(ev, state));
    }

    addRipple(x, y) {
      const d = this._v.set(x, 13, y).normalize();
      const r = this.ripples.length >= 4 ? this.ripples.shift() : {};
      r.x = d.x; r.y = d.y; r.z = d.z; r.t0 = this.now; this.ripples.push(r);
    }

    // ---------- keyframes and mood ----------
    sampleKeys(dayT) {
      const K = this.kfc, t = clamp(dayT, 0, 1), cur = this.cur;
      let i = 0; while (i < K.length - 2 && t > K[i + 1].t) i++;
      const a = K[i], b = K[i + 1], f = clamp((t - a.t) / (b.t - a.t), 0, 1);
      COLS.forEach((k, j) => cur[k].copy(a.c[j]).lerp(b.c[j], f));
      NUMS.forEach((k, j) => { cur[k] = lerp(a.n[j], b.n[j], f); });
    }

    updateMood(state, dt, now) {
      const cur = this.cur, ms = this.mood, T = this.T;
      const dayT = state && state.dayT != null ? state.dayT : 0.3;
      this.sampleKeys(dayT);
      // weather target: overcast 0..1
      let ovT = 0, tint = 0;
      const ev = state && state.event;
      if (ev) ovT = ev.kind === 'sturm' ? 1 : ev.kind === 'nacht' ? 1 : ev.kind === 'drachen' ? 0.4 : 0;
      else if (state && state.next && state.t != null) {
        const left = state.next.at - state.t;
        if (left < 12 && left > 0 && state.next.kind !== 'drachen') ovT = 0.35 * (1 - left / 12);
      }
      if (ev && ev.kind === 'drachen') tint = 1;
      const sn = this.snap;
      ms.ov += (ovT - ms.ov) * (sn ? 1 : damp(ovT > ms.ov ? 0.8 : 0.5, dt));
      ms.tint = (ms.tint || 0) + (tint - (ms.tint || 0)) * (sn ? 1 : damp(0.8, dt));
      const ov = ms.ov * 1, nt = cur.night, ovd = ov * (1 - 0.3 * nt);
      if (ov > 0.002) {
        const grey = (c, k, br) => { const l = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) * br; c.r = lerp(c.r, l * 0.92, k); c.g = lerp(c.g, l * 0.98, k); c.b = lerp(c.b, l * 1.08, k); };
        grey(cur.zen, ovd, 0.7); grey(cur.hor, ovd, 0.75); grey(cur.fog, ovd, 0.72); grey(cur.key, ovd, 0.9);
        grey(cur.hemS, ovd, 0.88); grey(cur.hemG, ovd, 0.9); grey(cur.sea, ovd, lerp(0.55, 0.85, nt)); grey(cur.cloud, ovd, lerp(0.55, 0.85, nt));
        cur.keyI *= 1 - lerp(0.62, 0.3, nt) * ov; cur.hemI *= 1 - 0.1 * ov; cur.fogD *= 1 + 0.55 * ov; cur.rays *= 1 - ov; cur.night = Math.max(cur.night, 0.2 * ov + cur.night * 0.8);
        cur.night = Math.min(1, cur.night + 0.15 * ov);
      }
      if (ms.tint > 0.002) {   // dragons: a hot, ominous red-orange tint
        const k = ms.tint * 0.35, red = this._c.set('#ff6a3a');
        cur.hor.lerp(red, k); cur.fog.lerp(red, k * 0.6); cur.key.lerp(red, k * 0.5); cur.sea.lerp(red, k * 0.4);
      }
      // sun and moon arcs (sun: dayT 0..0.65 left to right; moon: 0.67..0.97)
      const us = clamp(dayT / 0.65, 0, 1), th = us * Math.PI, sElev = (6 + Math.sin(th) * 58) * Math.PI / 180;
      const ax = -Math.cos(th), az = lerp(-0.45, 0.35, Math.sin(th));
      const hx = Math.hypot(ax, az) || 1;
      this.sunV = (this.sunV || new T.Vector3()).set(ax / hx * Math.cos(sElev), Math.sin(sElev), az / hx * Math.cos(sElev)).normalize();
      const um = clamp((dayT - 0.67) / 0.3, 0, 1), tm = um * Math.PI, mElev = (8 + Math.sin(tm) * 46) * Math.PI / 180;
      const mx = -Math.cos(tm), mz = lerp(-0.3, 0.3, Math.sin(tm)), mh = Math.hypot(mx, mz) || 1;
      this.moonV = (this.moonV || new T.Vector3()).set(mx / mh * Math.cos(mElev), Math.sin(mElev), mz / mh * Math.cos(mElev)).normalize();
      const nb = sstep(0.64, 0.72, dayT) * (1 - sstep(0.97, 1.0, dayT));
      this.sunDir.copy(this.sunV).lerp(this.moonV, nb).normalize();
      this.key.copy(this.sunDir); if (this.key.y < 0.26) { this.key.y = 0.26; this.key.normalize(); }
      // apply
      this.keyLight.color.copy(cur.key);
      this.flashV = Math.max(0, this.flashV - dt * 3.2);
      const fl = this.flashV;
      this.keyLight.intensity = cur.keyI * (1 + fl * 1.2);
      this.keyLight.position.copy(this.key).multiplyScalar(150);
      this.hemi.color.copy(cur.hemS); this.hemi.groundColor.copy(cur.hemG); this.hemi.intensity = cur.hemI * (1 + fl * 2.2);
      const fogC = this.scene.fog.color.copy(cur.fog);
      if (fl > 0.01) fogC.lerp(this._c.set('#dfe8ff'), Math.min(1, fl * 0.5));
      // noon contrast: 0..1, strongest in clear midday light (bluer gaps, less glare, less fog)
      const day = clamp((cur.keyI - 2.6) / 0.8, 0, 1) * (1 - cur.night) * (1 - ov);
      this.scene.fog.density = cur.fogD * 0.45 * (1 - 0.4 * day);
      this.renderer.setClearColor(fogC, 1);
      const U = this.skyMat.uniforms;
      U.uZen.value.copy(cur.zen); U.uHor.value.copy(cur.hor); U.uBot.value.copy(cur.fog);
      U.uSun.value.copy(this.sunV); U.uMoon.value.copy(this.moonV); U.uSunCol.value.copy(cur.key);
      U.uNight.value = cur.night; U.uOv.value = ov; U.uTime.value = now / 1000; U.uSunUp.value = 1 - nb;
      if (fl > 0.01) { U.uZen.value.lerp(this._c.set('#d8e4ff'), Math.min(1, fl * 0.6)); U.uHor.value.lerp(this._c.set('#ffffff'), Math.min(1, fl * 0.6)); }
      const SU = this.seaMat.uniforms, lk = 0.34 * cur.hemI + 0.15 * cur.keyI * (1 + this.flashV);
      SU.uHi.value.copy(cur.sea).multiplyScalar(lk * (1 - 0.1 * day)); SU.uLo.value.copy(cur.zen).lerp(cur.sea, lerp(0.45, 0.08, day)).multiplyScalar((0.5 * lk + 0.05) * (1 - 0.3 * day)); SU.uDay.value = day;
      SU.uFog.value.copy(fogC); SU.uCam.value.copy(this.camera.position); SU.uSun.value.copy(this.key); SU.uTime.value = now / 1000; SU.uFogD.value = cur.fogD * 0.45 * (1 - 0.4 * day);
      this.decoMesh.material.color.copy(cur.cloud).multiplyScalar(0.62); this.decoMesh.material.emissive.copy(cur.cloud).multiplyScalar(0.3 * (0.25 + cur.hemI * 0.3) * (1 - 0.75 * cur.night));
      this.gustMat.color.copy(cur.cloud).lerp(this._c.set('#ffffff'), 0.5);
      this.flameMat.opacity = 0.75;
      this.nightN = clamp(cur.night, 0, 1);
      this.A.setNight(this.nightN);
    }

    // ---------- actors ----------
    addShip(s) {
      const T = this.T, color = this.colorOf(s.pid);
      const art = this.A.ship(T, { color, quality: this.quality });
      art.group.scale.setScalar(SHIP_SCALE); art.group.userData.pid = s.pid;
      this.markShadows(art.group, false, true);
      if (this.quality === 'low') for (const pr of art.props) pr.visible = false;   // budget: three tiny spinning meshes per ship
      const flame = new T.Mesh(this.flameGeo, this.flameMat); flame.visible = false; flame.renderOrder = 6; art.tilt.add(flame);
      this.scene.add(art.group);
      const R = { art, color, flame, bank: 0, bob: hash1(s.pid * 3.7) * TAU, boost: 0, dock: s.docked ? 1 : 0, lift: 0, pwx: 0, init: false };
      this.ships.set(s.pid, R);
      return R;
    }
    removeShip(pid) {
      const R = this.ships.get(pid); if (!R) return;
      this.scene.remove(R.art.group); disposeObj(R.art.group); this.ships.delete(pid);
    }
    addDragon(d) {
      const art = this.A.dragon(this.T, { quality: this.quality });
      art.group.rotation.order = 'YXZ'; art.group.scale.setScalar(1.15); art.group.userData.id = d.id;
      this.markShadows(art.group, false, false);
      this.scene.add(art.group);
      const R = { art, bank: 0, fleeT: 0, ph: hash1(d.id * 9.1) * TAU };
      this.dragons.set(d.id, R); return R;
    }
    removeDragon(id) {
      const R = this.dragons.get(id); if (!R) return;
      this.scene.remove(R.art.group); disposeObj(R.art.group); this.dragons.delete(id);
    }
    ensureIslet(id, kind) {
      let R = this.isletsO.get(id);
      if (R) return R;
      const spec = (this.world && this.world.islets.find((q) => q.id === id)) || { id, kind, r: 4, trees: 10 };
      const obj = this.A.islet(this.T, { kind: spec.kind || kind, r: spec.r || 4, id: spec.id, trees: spec.trees }, { quality: this.quality });
      this.markShadows(obj.group, false, true);
      this.scene.add(obj.group);
      R = { obj, amount: -1, ph: hash1(id * 5.3 + 1) * TAU, r: spec.r || 4 };
      this.isletsO.set(id, R); return R;
    }

    updateShips(state, alpha, dt, t) {
      const seen = new Set(), hi = this.quality === 'high';
      let haloN = 0, blobN = 0;
      const night = this.nightN, cam = this.camera;
      for (const s of state.ships) {
        seen.add(s.pid);
        const R = this.ships.get(s.pid) || this.addShip(s);
        const x = lerp(s.px, s.x, alpha), z = lerp(s.py, s.y, alpha), h = lerp(s.ph, s.h, alpha);
        const turn = (s.h - s.ph) / SIM_DT;
        R.bank += (clamp(-turn / 3.5, -1, 1) - R.bank) * damp(7, dt);
        R.dock += ((s.docked ? 1 : 0) - R.dock) * damp(2.2, dt);
        R.boost += ((s.boosting ? 1 : 0) - R.boost) * damp(8, dt);
        const stun = s.stunned > 0;
        const speed = Math.hypot(s.vx || 0, s.vy || 0);
        const bob = Math.sin(t * 1.7 + R.bob) * 0.22 + Math.sin(t * 0.9 + R.bob * 2) * 0.1;
        const y = lerp(SHIP_Y, 3.8, R.dock) + bob + R.boost * 0.25 + (stun ? Math.sin(t * 12 + R.bob) * 0.12 : 0);
        const g = R.art.group;
        g.position.set(x + (stun ? Math.sin(t * 9 + R.bob) * 0.1 : 0), y, z);
        g.rotation.y = -h + (stun ? Math.sin(t * 7.3) * 0.12 : 0);
        const cargo = s.cargo ? (s.cargo.holz | 0) + (s.cargo.kristall | 0) : 0;
        R.art.anchors.cargo.visible = cargo > 0;
        R.flame.visible = R.boost > 0.04;
        if (R.flame.visible) R.flame.scale.set(0.6 + R.boost * (0.8 + 0.25 * Math.sin(t * 40)), 0.6 + R.boost * 0.5, 0.6 + R.boost * 0.5);
        this.A.animateShip(R.art, { t, speed, bank: R.bank, boosting: !!s.boosting, stunned: stun, night });
        // halo: billboard in the ship's colour
        if (haloN < 12) {
          this._q.copy(cam.quaternion);
          const sz = 5.6 + R.boost * 1.2;
          this._m.compose(this._v.set(x, y - 0.3, z), this._q, this._s.set(sz, sz, 1));
          this.haloMesh.setMatrixAt(haloN, this._m);
          const hc = this._c.set(R.color); hc.multiplyScalar(0.8 + 0.5 * night);
          this.haloMesh.setColorAt(haloN, hc); haloN++;
        }
        if (blobN < 24) blobN = this.addBlob(blobN, x, y, z, 2.6, 0.7);
      }
      for (const pid of [...this.ships.keys()]) if (!seen.has(pid)) this.removeShip(pid);
      this.haloMesh.count = haloN; this.haloMesh.instanceMatrix.needsUpdate = true;
      if (this.haloMesh.instanceColor) this.haloMesh.instanceColor.needsUpdate = true;
      return blobN;
    }

    addBlob(n, x, y, z, r, a) {
      if (n >= 24) return n;
      const k = this.key, sh = Math.min(45, (y - BLOB_Y) / k.y), ox = -k.x * sh, oz = -k.z * sh;
      this._m.compose(this._v.set(x + ox, BLOB_Y, z + oz), this._q.identity(), this._s.set(r * 2 * (1 + sh * 0.01), 1, r * 2 * (1 + sh * 0.01)));
      this.blobMesh.setMatrixAt(n, this._m);
      return n + 1;
    }

    updateIslets(state, alpha, t) {
      for (const il of state.islets) {
        const R = this.ensureIslet(il.id, il.kind);
        const g = R.obj.group, x = lerp(il.px, il.x, alpha), z = lerp(il.py, il.y, alpha);
        g.position.set(x, Math.sin(t * 0.55 + R.ph) * 0.3, z);
        g.rotation.z = Math.sin(t * 0.4 + R.ph * 2) * 0.02; g.rotation.x = Math.sin(t * 0.33 + R.ph) * 0.02;
        const f = il.max ? clamp(il.amount / il.max, 0, 1) : 1;
        if (Math.abs(f - R.amount) > 1e-3) { R.amount = f; R.obj.setAmount(f); }
      }
    }

    updateBuildings(state, alpha, t, now) {
      if (!this.island) return;
      const BLD = window.SkyfarersWorld ? window.SkyfarersWorld.BUILDINGS : null;
      for (let i = 0; i < 7; i++) {
        const sl = state.slots[i]; if (!sl) continue;
        let B = this.bld[i];
        const need = sl.kind ? sl.kind + ':' + (sl.stage || 1) : '';
        if (!B || B.key !== need) {
          if (B && B.obj) { B.obj.group.parent && B.obj.group.parent.remove(B.obj.group); disposeObj(B.obj.group); }
          B = this.bld[i] = { key: need, obj: null, hp: -1, build: -1, ruined: null, aim: 0, aimInit: false };
          if (sl.kind) {
            const obj = this.A.building(this.T, sl.kind, { stage: Math.max(1, sl.stage || 1), quality: this.quality });
            this.markShadows(obj.group, true, true);
            const anchor = this.island.slotAnchors[i]; anchor.add(obj.group);
            B.obj = obj;
          }
        }
        if (!B.obj) continue;
        const o = B.obj;
        if (Math.abs(sl.build - B.build) > 1e-3) { B.build = sl.build; o.setBuild(sl.build); }
        const maxHp = BLD && BLD[sl.kind] ? BLD[sl.kind].hp : 100;
        const hp01 = clamp(sl.hp / maxHp, 0, 1);
        if (Math.abs(hp01 - B.hp) > 0.02 || B.ruined !== !!sl.ruined) { B.hp = hp01; B.ruined = !!sl.ruined; o.setDamage(sl.build >= 1 ? hp01 : 1, !!sl.ruined); }
        const working = sl.build >= 1 && !sl.ruined && sl.fire <= 0.25;
        const a = { working, building: sl.build < 1, night: this.nightN };
        if (sl.kind === 'kanone' && this.world) {
          const hs = this.world.home.slots[i];
          let best = null, bd = 40 * 40;
          for (const d of state.dragons) { const dd = (d.x - hs.x) ** 2 + (d.y - hs.y) ** 2; if (dd < bd) { bd = dd; best = d; } }
          if (best) {
            const tgt = -Math.atan2(best.y - hs.y, best.x - hs.x);
            if (!B.aimInit) { B.aim = tgt; B.aimInit = true; }
            B.aim += wrapPi(tgt - B.aim); a.aim = B.aim;
          } else B.aimInit = false;
        }
        o.animate(t, a);
        // little pop when a building is finished
        const b0 = this.bounce.get(i);
        if (b0 != null) {
          const age = (now - b0) / 1000;
          if (age > 0.9) { this.bounce.delete(i); o.group.scale.setScalar(1); } else o.group.scale.setScalar(1 + 0.14 * Math.sin(age / 0.9 * Math.PI) * (1 - age / 0.9));
        }
      }
    }

    updateDragons(state, alpha, dt, t, now) {
      const seen = new Set(), night = this.nightN;
      for (const d of state.dragons) {
        seen.add(d.id);
        const R = this.dragons.get(d.id) || this.addDragon(d);
        const x = lerp(d.px, d.x, alpha), z = lerp(d.py, d.y, alpha), h = lerp(d.ph, d.h, alpha);
        const turn = (d.h - d.ph) / SIM_DT;
        R.bank += (clamp(-turn * 0.5, -0.7, 0.7) - R.bank) * damp(4, dt);
        const fleeing = d.state === 'flee'; if (fleeing) R.fleeT += dt; else R.fleeT = 0;
        const y = DRAGON_Y + Math.sin(t * 0.9 + R.ph) * 0.8 + R.fleeT * R.fleeT * 1.4;
        const g = R.art.group;
        g.position.set(x, y, z); g.rotation.y = -h; g.rotation.x = R.bank;
        const br = (this.breath.get(d.id) || 0) > now;
        const flap = fleeing ? 1 : d.state === 'approach' ? 0.85 : 0.6;
        R.art.animate(t + R.ph, { flap, breathing: br, fleeing, night });
      }
      for (const id of [...this.dragons.keys()]) if (!seen.has(id)) this.removeDragon(id);
    }

    updateCrates(state, t, blobN) {
      const T = this.T, cnt = { holz: 0, kristall: 0 };
      if (!this.crateInit) return blobN;
      for (const d of state.drops) {
        const pop = sstep(0, 0.35, d.age), fade = d.age > 26 ? (1 - (d.age - 26) / 4) * (0.6 + 0.4 * Math.sin(d.age * 16)) : 1;
        const sc = 1.6 * pop * clamp(fade, 0, 1);
        const both = d.holz > 0 && d.kristall > 0;
        let k = 0;
        for (const res of ['holz', 'kristall']) {
          if (!(d[res] > 0) || cnt[res] >= this.crateMax) continue;
          const off = both ? (k ? 0.5 : -0.5) : 0; k++;
          const y = SHIP_Y - 0.6 + Math.sin(t * 1.8 + d.id * 1.7) * 0.25 + (1 - pop) * 1.5;
          this._q.setFromAxisAngle(this._v2.set(0, 1, 0), d.id * 1.3 + t * 0.4);
          this._m.compose(this._v.set(d.x + off, y, d.y), this._q, this._s.setScalar(sc));
          this.crates[res].setMatrixAt(cnt[res]++, this._m);
          blobN = this.addBlob(blobN, d.x + off, y, d.y, 0.9, 0.5);
        }
      }
      for (const res of ['holz', 'kristall']) { const im = this.crates[res]; im.count = cnt[res]; im.instanceMatrix.needsUpdate = true; }
      return blobN;
    }

    updateGusts(state, t) {
      const { GS, GN, GMAX } = this.gustCfg, P = this.gPos.array, C = this.gCol.array;
      let s = 0;
      for (const g of state.gusts.slice(0, GMAX)) {
        const dx = g.x2 - g.x1, dz = g.y2 - g.y1, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
        const ph = clamp(g.age / g.life, 0, 1), fade = sstep(0, 0.12, ph) * (1 - sstep(0.72, 1, ph));
        for (let k = 0; k < GS; k++, s++) {
          const off = (k - 1) * 1.15, wob = 0.7 + 0.25 * k;
          for (let j = 0; j <= GN; j++) {
            const u = j / GN, env = Math.pow(Math.sin(Math.PI * u), 0.7);
            const lat = off + Math.sin(u * 5 + t * 1.6 + k * 2 + g.id) * wob * env;
            const px = g.x1 + dx * u + nx * lat, pz = g.y1 + dz * u + nz * lat;
            const py = SHIP_Y + 0.2 + Math.sin(u * 6 - t * 2.4 + k + g.id) * 0.45 * env;
            const w = 0.1 + 0.34 * env * (k === 1 ? 1.2 : 0.8);
            const dash = 0.3 + 0.7 * sstep(0.1, 0.95, Math.sin(u * 9 - t * 4.5 + k * 2.1 + g.id) * 0.5 + 0.5);
            const al = fade * dash * env * 0.75;
            const v = (s * (GN + 1) + j) * 2;
            P[v * 3] = px - nx * w; P[v * 3 + 1] = py; P[v * 3 + 2] = pz - nz * w;
            P[v * 3 + 3] = px + nx * w; P[v * 3 + 4] = py; P[v * 3 + 5] = pz + nz * w;
            for (let q = 0; q < 2; q++) { const c = (v + q) * 4; C[c] = C[c + 1] = C[c + 2] = 1; C[c + 3] = al; }
          }
        }
      }
      this.gPos.needsUpdate = true; this.gCol.needsUpdate = true;
      this.gustMesh.geometry.setDrawRange(0, s * GN * 6);
      this.gustMesh.visible = s > 0;
    }

    updateClouds(state, alpha, dt, t) {
      const T = this.T, ov = this.mood.ov, cl = state.clouds || [];
      const base = this._c.set('#c3ccd8').lerp(this._cRain || (this._cRain = new T.Color('#4a5468')), 0.3 + 0.7 * ov).multiplyScalar(1 + 0.7 * this.nightN);
      const tc = this._c3 || (this._c3 = new T.Color());
      let n = 0;
      for (const c of cl) {
        const cx = lerp(c.px, c.x, alpha), cz = lerp(c.py, c.y, alpha), r = c.r;
        const np = 9;
        for (let k = 0; k < np && n < this.rainN; k++, n++) {
          const a = k * 2.4 + c.id * 1.7, f = hash1(c.id * 13 + k), rr = k ? r * (0.2 + 0.55 * f) : 0;
          const s = r * (k ? 0.36 + 0.22 * hash1(c.id * 7 + k) : 0.62) * (1 + 0.05 * Math.sin(t * 0.8 + k + c.id));
          this._m.compose(this._v.set(cx + Math.cos(a) * rr, 7.0 + (k ? (f - 0.3) * 1.4 : 0.6), cz + Math.sin(a) * rr), this._q.identity(), this._s.set(s, s * 0.6, s));
          this.rainMesh.setMatrixAt(n, this._m);
          const shade = 0.78 + 0.35 * hash1(c.id * 3 + k * 5);
          this.rainMesh.setColorAt(n, tc.setRGB(base.r * shade, base.g * shade, base.b * shade));
        }
      }
      this.rainMesh.count = n;
      this.rainMesh.instanceMatrix.needsUpdate = true; if (this.rainMesh.instanceColor) this.rainMesh.instanceColor.needsUpdate = true;
      this.rainMat.opacity = 0.62 + 0.14 * ov;
    }

    updateDecor(state, dt, t) {
      const wx = state.wind ? state.wind.x : 0, wy = state.wind ? state.wind.y : 0;
      this.decoDrift = (this.decoDrift || 0) + dt * (1.3 + wx * 0.25);
      this.decoDriftZ = (this.decoDriftZ || 0) + dt * (0.35 + wy * 0.25);
      const dd = this.decoData, m = this.decoMesh.count;
      for (let i = 0; i < m; i++) {
        const c = dd[i];
        let x = c.x + this.decoDrift, z = c.z + this.decoDriftZ;
        x = ((x + 130) % 260 + 260) % 260 - 130; z = ((z + 90) % 180 + 180) % 180 - 90;
        const edge = Math.min(1, (130 - Math.abs(x)) / 20, (90 - Math.abs(z)) / 14);
        const inner = sstep(0.95, 1.3, Math.hypot(x / DECO_RX, z / DECO_RZ));
        const s = c.s * clamp(edge, 0, 1) * inner;
        this._m.compose(this._v.set(x, c.y, z), this._q.identity(), this._s.set(s, s * c.sy, s));
        this.decoMesh.setMatrixAt(i, this._m);
      }
      this.decoMesh.instanceMatrix.needsUpdate = true;
    }

    updateIslandAndShield(state, dt, t, now, blobN) {
      const isl = this.island; if (!isl) return blobN;
      let sinkS = 0;
      if (this.sinkT0 == null && state.herz != null && state.herz <= 0 && state.over) this.sinkT0 = now;
      if (this.sinkT0 != null) sinkS = Math.max(0, (now - this.sinkT0) / 1000);
      else { /* reset after a rematch */ }
      const g = isl.group;
      g.position.y = -Math.pow(sinkS, 1.9) * 1.3;
      g.rotation.z = Math.min(0.5, sinkS * 0.05) * Math.sin(t * 6 + 1) * (sinkS > 0 ? 1 : 0) + (sinkS > 0 ? sinkS * 0.03 : 0);
      g.rotation.x = sinkS > 0 ? Math.sin(sinkS * 2.1) * 0.03 * sinkS : 0;
      // heart: pulses faster as herz drops
      const herz = state.herz != null ? clamp(state.herz / 100, 0, 1) : 1;
      const rate = 1.6 + (1 - herz) * 4.5, beat = Math.pow(0.5 + 0.5 * Math.sin(t * rate * Math.PI), 3);
      if (isl.heart) isl.heart.scale.setScalar(1 + (0.03 + 0.04 * (1 - herz)) * beat);
      const gc = this.heartGlow.material.color.set('#7fe8ff').lerp(this._c.set('#ff5a4a'), (1 - herz) * 0.8);
      this.heartGlow.material.opacity = (0.28 + 0.3 * beat) * (0.5 + this.nightN * 0.7) * (sinkS > 0 ? Math.max(0, 1 - sinkS / 2) : 1);
      this.heartGlow.position.y = -15 + g.position.y; this.heartGlow.scale.setScalar(15 + beat * 3);
      // shield dome
      const U = this.shieldMat.uniforms, want = state.shieldOn && sinkS === 0 ? 1 : 0;
      U.uShow.value += (want - U.uShow.value) * damp(want ? 6 : 4, dt);
      this.dome.visible = U.uShow.value > 0.01;
      U.uTime.value = t;
      for (let i = 0; i < 4; i++) {
        const r = this.ripples[i];
        if (r && (now - r.t0) / 1000 < 1.3) this.ripU[i].set(r.x, r.y, r.z, (now - r.t0) / 1000);
        else this.ripU[i].set(0, 1, 0, -1);
      }
      this.ripples = this.ripples.filter((r) => (now - r.t0) / 1000 < 1.3);
      // blob shadows of island
      if (sinkS < 1) blobN = this.addBlob(blobN, 0, 0, 0, 17.5, 1);
      return blobN;
    }

    // ---------- camera ----------
    // Frames the content that matters (home island, islets, ships, dragons, crates, strikes + margin) in a 16:10 box
    // between a minimum (home island not oversized) and the full map. The box is damped slowly; ships and dragons
    // are a hard constraint applied after the damping, so none can ever leave the frame.
    updateCamera(state, dt, t, intro) {
      const T = this.T, cam = this.camera, C = this.cam;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, h0 = 1e9, h1 = -1e9, g0 = 1e9, g1 = -1e9;
      const ext = (x, z, r) => { if (x - r < x0) x0 = x - r; if (x + r > x1) x1 = x + r; if (z - r < z0) z0 = z - r; if (z + r > z1) z1 = z + r; };
      const hard = (x, z, r) => { if (x - r < h0) h0 = x - r; if (x + r > h1) h1 = x + r; if (z - r < g0) g0 = z - r; if (z + r > g1) g1 = z + r; };
      const hr = this.world && this.world.home ? this.world.home.r || 20 : 20;
      ext(0, 0, hr);
      for (const il of state.islets) { const R = this.isletsO.get(il.id); ext(il.x, il.y, (R ? R.r : 4) + CAM_MARGIN); }
      for (const s of state.ships) { ext(s.x, s.y, 3 + CAM_MARGIN); hard(s.x, s.y, 4); }
      for (const d of state.dragons) { ext(d.x, d.y, 5 + CAM_MARGIN); hard(d.x, d.y, 6); }
      for (const d of state.drops) ext(d.x, d.y, 1 + CAM_MARGIN);
      for (const k of state.strikes || []) ext(k.x, k.y, CAM_MARGIN);
      let cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const hw = clamp(Math.max(CAM_MIN_X, (x1 - x0) / 2, ASPECT * (z1 - z0) / 2), CAM_MIN_X, 81);
      if (!C.init || this.snap) { C.cx = cx; C.cz = cz; C.hw = hw; C.init = true; }
      const k = damp(0.5, dt);
      C.cx += (cx - C.cx) * k; C.cz += (cz - C.cz) * k; C.hw += (hw - C.hw) * k;
      // hard constraint: widen the damped box until every ship and dragon is inside (ignores the map maximum)
      let W = C.hw;
      if (h1 > h0) W = Math.max(W, C.cx - h0, h1 - C.cx, ASPECT * (C.cz - g0), ASPECT * (g1 - C.cz));
      const HH = W / ASPECT;
      // slow orbit drift and bob
      const az = Math.sin(t * 0.045) * 0.075 + Math.sin(t * 0.021 + 1) * 0.03 + C.cx * 0.0005;
      const el = (56 + Math.sin(t * 0.037 + 2) * 1.6) * Math.PI / 180;
      const ez = 1 - Math.pow(1 - intro, 3);
      const azI = lerp(0.5, 0, ez), elI = lerp(1.25, el, ez);
      const A = az + azI, elev = intro < 1 ? elI : el;
      const dirv = this._v.set(Math.sin(A) * Math.cos(elev), Math.sin(elev), Math.cos(A) * Math.cos(elev));
      const dx = dirv.x, dy = dirv.y, dz = dirv.z;
      const tgt = this._v2.set(C.cx, 0.5 + Math.sin(t * 0.3) * 0.25, C.cz);
      // right / up / forward basis of the camera
      const fx = -dx, fy = -dy, fz = -dz;                    // forward
      let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;   // right = forward x worldUp
      const upx = -rz * fy, upy = rz * fx - rx * fz, upz = rx * fy;   // up = right x forward
      const tanV = Math.tan(cam.fov * Math.PI / 360), tanH = tanV * cam.aspect, M = 0.965;
      let D = 0;
      for (const hy of [0, 12]) for (const sxs of [-1, 1]) for (const szs of [-1, 1]) {
        const px = sxs * W - tgt.x + C.cx, py = hy - tgt.y, pz = szs * HH - tgt.z + C.cz;
        const a = px * fx + py * fy + pz * fz, r = Math.abs(px * rx + pz * rz), u = Math.abs(px * upx + py * upy + pz * upz);
        D = Math.max(D, r / (M * tanH) - a, u / (M * tanV) - a);
      }
      const far = lerp(1.5, 1, ez);
      const dd = D * far;
      cam.position.set(tgt.x + dx * dd, tgt.y + dy * dd + Math.sin(t * 0.5) * 0.35, tgt.z + dz * dd);
      cam.lookAt(tgt);
      cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    }

    // ---------- post (high) ----------
    ensurePost() {
      if (this.post) return this.post;
      const T = this.T, rd = this.renderer, W = this.W, H = this.H;
      const half = rd.extensions.has('EXT_color_buffer_float') || rd.extensions.has('EXT_color_buffer_half_float');
      const type = half ? T.HalfFloatType : T.UnsignedByteType;
      const mk = (w, h, main) => new T.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), { type, format: T.RGBAFormat, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: !!main, samples: main ? 4 : 0, generateMipmaps: false });
      const P = this.post = { main: mk(W, H, true), h1: mk(W / 2, H / 2), h2: mk(W / 2, H / 2), q1: mk(W / 4, H / 4), q2: mk(W / 4, H / 4), r1: mk(W / 2, H / 2) };
      const sm = (fs, uniforms) => new T.ShaderMaterial({ vertexShader: FS_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
      const tex = (t) => ({ value: t });
      P.bright = sm(BRIGHT_FS, { tMap: tex(null), uTexel: { value: new T.Vector2(1 / W, 1 / H) }, uThr: { value: 1 } });
      P.blur = sm(BLUR_FS, { tMap: tex(null), uStep: { value: new T.Vector2() } });
      P.rays = sm(RAYS_FS, { tMap: tex(null), uSun: { value: new T.Vector2(0.5, 1.2) }, uDens: { value: 0.95 } });
      P.comp = sm(COMP_FS, { tMain: tex(P.main.texture), tB1: tex(P.h1.texture), tB2: tex(P.q2.texture), tRay: tex(P.r1.texture), uS1: { value: 0.5 }, uS2: { value: 0.6 }, uRay: { value: 0 }, uFlash: { value: 0 }, uVig: { value: 0.35 }, uRayCol: { value: new T.Color() } });
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
      P.geo = g; P.mesh = new T.Mesh(g, P.bright); P.mesh.frustumCulled = false;
      P.scene = new T.Scene(); P.scene.add(P.mesh); P.cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      return P;
    }
    disposePost() {
      const P = this.post; if (!P) return;
      for (const k of ['main', 'h1', 'h2', 'q1', 'q2', 'r1']) P[k].dispose();
      P.bright.dispose(); P.blur.dispose(); P.rays.dispose(); P.comp.dispose(); P.geo.dispose();
      this.post = null;
    }
    pass(mat, target) { const P = this.post; P.mesh.material = mat; this.renderer.setRenderTarget(target); this.renderer.render(P.scene, P.cam); }
    blurPass(src, dst, dx, dy, w, h) { const P = this.post; P.blur.uniforms.tMap.value = src.texture; P.blur.uniforms.uStep.value.set(dx / w, dy / h); this.pass(P.blur, dst); }
    postPass() {
      const P = this.post, W = this.W, H = this.H, rd = this.renderer, cur = this.cur;
      rd.setScissorTest(false);
      P.bright.uniforms.uThr.value = cur.thr; P.bright.uniforms.tMap.value = P.main.texture;
      this.pass(P.bright, P.h1);
      // god rays from the sun's screen position, only when it is in front of the camera
      const cam = this.camera, sp = this._v.copy(cam.position).addScaledVector(this.sunDir, 1500).project(cam);
      const fwd = this._v2.set(0, 0, -1).applyQuaternion(cam.quaternion), front = this.sunDir.dot(fwd);
      const low = 1 - sstep(0.18, 0.5, this.sunDir.y);   // strongest at low sun (dawn/dusk)
      const rays = cur.rays * sstep(0.0, 0.25, front) * (0.4 + 0.6 * low);
      P.rays.uniforms.tMap.value = P.h1.texture; P.rays.uniforms.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      if (rays > 0.01) this.pass(P.rays, P.r1);
      this.blurPass(P.h1, P.h2, 1, 0, W / 2, H / 2); this.blurPass(P.h2, P.h1, 0, 1, W / 2, H / 2);
      this.blurPass(P.h1, P.q1, 1, 0, W / 4, H / 4); this.blurPass(P.q1, P.q2, 0, 1, W / 4, H / 4);
      this.blurPass(P.q2, P.q1, 1.6, 0, W / 4, H / 4); this.blurPass(P.q1, P.q2, 0, 1.6, W / 4, H / 4);
      const U = P.comp.uniforms;
      U.uS1.value = cur.bk * 0.8; U.uS2.value = cur.bk * 1.0;
      U.uRay.value = rays > 0.01 ? rays * 0.9 : 0; U.uRayCol.value.copy(cur.key).lerp(this._c.set('#ffffff'), 0.3);
      U.uFlash.value = this.flashV * 0.35;
      rd.setRenderTarget(null); rd.setViewport(0, 0, W, H);
      P.mesh.material = P.comp; rd.render(P.scene, P.cam);
    }

    // ---------- public: project ----------
    project(x, y, height) {
      const v = this._v.set(x, height || 0, y).project(this.camera);
      const behind = v.z > 1 || v.z < -1;
      return { x: (v.x * 0.5 + 0.5) * this.W, y: (1 - (v.y * 0.5 + 0.5)) * this.H, visible: !behind && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
    }

    // ---------- render ----------
    norm(st) {
      if (st.ships && st.slots && st.islets && st.clouds && st.gusts && st.drops && st.dragons && st.strikes) return st;
      const o = Object.assign({}, st);
      for (const k of ['ships', 'slots', 'islets', 'clouds', 'gusts', 'drops', 'dragons', 'strikes']) if (!o[k]) o[k] = [];
      return o;
    }

    render(state, alpha, opts) {
      if (!state) return;
      state = this.norm(state);
      const t0 = performance.now();
      opts = opts || {};
      const now = opts.now != null ? opts.now : this.now + 16.7;
      let dt = opts.dt != null ? opts.dt : (this.lastNow == null ? 0.016 : (now - this.lastNow) / 1000);
      dt = clamp(dt, 0, 0.1);
      this.lastNow = now; this.now = now; this.frame++;
      this.snap = !!opts.snap;   // harness/glue: jump damped state (weather, camera) to its target
      if (this.snap) this.cam.init = false;
      alpha = clamp(alpha == null ? 1 : alpha, 0, 1);
      const t = now / 1000, rd = this.renderer, hi = this.quality === 'high';
      rd.info.reset();
      if (!this.island && this.world) this.setWorld(this.world, this.look);
      this.updateMood(state, dt, now);
      let blobN = 0;
      if (this.island) {
        blobN = this.updateShips(state, alpha, dt, t);
        this.updateIslets(state, alpha, t);
        this.updateBuildings(state, alpha, t, now);
        this.updateDragons(state, alpha, dt, t, now);
        blobN = this.updateCrates(state, t, blobN);
        this.updateGusts(state, t);
        this.updateClouds(state, alpha, dt, t);
        for (const [, R] of this.isletsO) { if (blobN < 24) blobN = this.addBlob(blobN, R.obj.group.position.x, 0, R.obj.group.position.z, 5.2, 0.8); }
        blobN = this.updateIslandAndShield(state, dt, t, now, blobN);
      }
      this.updateDecor(state, dt, t);
      this.blobMesh.count = blobN; this.blobMesh.instanceMatrix.needsUpdate = true;
      this.blobMat.opacity = 0.14 + 0.1 * (1 - this.nightN) * (this.cur.keyI / 3.4);
      this.updateCamera(state, dt, t, opts.intro != null ? clamp(opts.intro, 0, 1) : 1);
      this.sky.position.copy(this.camera.position);
      if (this.fx) this.safeFx(() => this.fx.update(state, alpha, { now, dt, dayT: state.dayT, sunDir: this.sunDir }));
      // shadow frustum follows the island; keep the camera of the light centred
      if (hi) {
        const P = this.ensurePost();
        rd.setRenderTarget(P.main); rd.setScissorTest(false); rd.setViewport(0, 0, this.W, this.H);
        rd.clear(); rd.render(this.scene, this.camera);
        this.postPass();
      } else {
        rd.setRenderTarget(null); rd.setScissorTest(false); rd.setViewport(0, 0, this.W, this.H);
        rd.clear(); rd.render(this.scene, this.camera);
      }
      this.drawCalls = rd.info.render.calls; this.triangles = rd.info.render.triangles;
      this.lastMs = performance.now() - t0;
    }

    dispose() {
      if (this.fx) { this.safeFx(() => this.fx.dispose()); this.fx = null; }
      this.clearWorld();
      this.disposePost();
      for (const m of [this.decoMesh, this.rainMesh, this.haloMesh, this.blobMesh]) { m.material.dispose(); m.dispose(); }
      for (const m of Object.values(this.crates)) m.dispose();
      this.puffGeo.dispose(); this.puffGeoLo.dispose(); this.puffSoft.dispose(); this.seaPlane.geometry.dispose(); this.seaMat.dispose();
      this.haloMesh.geometry.dispose(); this.blobMesh.geometry.dispose();
      this.heartGlow.material.dispose(); this.dome.geometry.dispose(); this.shieldMat.dispose();
      this.flameGeo.dispose(); this.flameMat.dispose(); this.gustMesh.geometry.dispose(); this.gustMat.dispose();
      this.sky.geometry.dispose(); this.skyMat.dispose(); this.texSoft.dispose(); this.texHalo.dispose();
      this.keyLight.dispose && this.keyLight.dispose();
      this.renderer.dispose();
      if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
    }
  }

  window.SkyfarersView = SkyfarersView;
})();
