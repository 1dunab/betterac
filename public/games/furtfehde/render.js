// ===== Furt & Fehde renderer (three.js), view v0 (docs/FURTFEHDE.md "View API") =====
// One fixed camera over the whole river valley, light keyed by state.dayT, the terrain from FurtTerrain, actors from the
// actor state (interpolated with alpha): keeps per lord, buildings by id, units (one InstancedMesh per kind), banners,
// blob shadows. Models come from FurtArt (never replace their materials). Fx hook: window.FurtFx, like Skyfarers.
// Plain script; THREE is handed to the constructor.
//
// Handles for Phase 1 (fx, glue):
//   view.land (FurtTerrain) · view.sunDir (toward the sun) · view.cur (current light: key, hemS, hemG, haze, night)
//   view.buildingObj(id) · view.keepObj(lord) · view.bannerObj(id) -> the FurtArt object (group, anchors, ...)
//   view.project(x, y, h) -> internal canvas px · view.W / view.H (internal size) · view.drawCalls / triangles / lastMs
//   view.render(state, alpha, { now (ms), dt (s), snap, draw: false })   draw:false = update only (fast-forward in harnesses)
//   view.inset(rect, focus) -> the Kampf-Kamera (picture-in-picture close-up, high only), view.insetRect / insetCalls / insetTris / insetMs (see below)
//   view.event(ev, state) -> window.FurtFx (fx.js, created by setWorld): every sim event; the fx hook also gets pass(camera, viewportHeight) per scene pass
//   Phase 2 (docs "Phase 2 — Mauern & Söldner", TV): wall pieces are built with their `len`; a Torhaus opens its doors (eased setOpen) while an own or a partner unit stands in its lane
//   (FurtWorld.laneOf) and calls view.onGate({ id, lord, x, z }) when it starts to open (the glue plays the creak); garrisoned units (u.on) stand on the slot anchor of their building
//   (art slot = sim slot), facing outwards until they aim; the Rammbock swing is locked to the `ram` events (the log hits when the blow lands) and the struck piece shakes.
// Coordinates: world (x, y) -> three (X = x, Z = y, Y = up); heading h: 0 = +x, counter-clockwise towards +y; yaw = -h.
(function () {
  'use strict';
  const FW = window.FurtWorld, FA = window.FurtArt;
  const TAU = Math.PI * 2, RAD = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const fract = (x) => x - Math.floor(x);
  const hash1 = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
  const lerpAngle = (a, b, t) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return a + d * t; };

  const PX = 72, PY = 45;              // playable half extents
  const FOV = 24, ELEV = 58;           // the game camera: narrow lens, 58 degrees above the horizon, looking north
  const BLOB_MAX = 1500, FIRE_MAX = 150, SMOKE_MAX = 110;
  const INSET_FOV = 34, INSET_EL = 40;   // the Kampf-Kamera: a closer, lower camera, also looking north
  const FRAME_OUT = '#241a10', FRAME_IN = '#d9b45a';   // its picture frame (2 px dark outside, 2 px gold inside), drawn with scissored clears
  const ANIM = { idle: 0, walk: 1, fight: 2, work: 3 }, CARRY = { korn: 1, holz: 2, stein: 3, eimer: 4 };
  const UNIT_CAP = { bauer: 460, speer: 340, bogen: 300, ritter: 160, fackel: 120, reiterschuetze: 240, ramme: 60 };
  const BLOB_R = { bauer: 0.52, speer: 0.55, bogen: 0.55, ritter: 1.15, fackel: 0.5, reiterschuetze: 0.95, ramme: 0.8 };
  const BLOB_LONG = { ritter: 1.35, reiterschuetze: 1.3, ramme: 1.9 };   // blob shadows of the long units (horses, the ram) are stretched along the heading
  const RAM_CD = 2.0, RAM_F = 0.68, RAM_LEAD = 0.05;                 // the ram's swing: period (the sim's cd), the phase at which the log is fully forward (art.js), the lag between a sim event and its picture (s)
  const GATE_HOLD = 0.7, GATE_OPEN_K = 6, GATE_CLOSE_K = 3.2;        // Torhaus: how long the doors stay open after the last friend left (s), easing rates of opening / closing
  const GARRISON_TURN = 5, GARRISON_AIM_S = 3.5;                     // garrisoned archers: turn rate; how long they keep facing their last target before they look outwards again (s)
  const SHAKE_S = 0.5;                                               // a struck wall piece shakes for this long

  // ---- day keyframes: dayT 0 morning sun from the east . .45 noon . .8 warm afternoon . 1 golden dusk from the west ----
  // az = sun azimuth in degrees (0 = east, 90 = south, 180 = west; below 0 or above 180 = north side, so low suns glint on the
  // water towards the camera), el = elevation, key = sun colour, keyI = its intensity, hemS/hemG = hemisphere sky/ground,
  // hemI = hemisphere intensity, haze = the colour the frame edges and the clear colour fade to, expo = exposure.
  const COLS = ['key', 'hemS', 'hemG', 'haze'];
  const KF = [
    //  t     az   el  key        keyI  hemS       hemG       hemI  haze       expo
    [0.00, -26, 19, '#ffbe80', 2.35, '#b4c4ec', '#8f7860', 0.95, '#e9cfba', 1.0],
    [0.12, -12, 31, '#ffdfae', 2.75, '#c2d8f6', '#8c7a5e', 1.0, '#dfe0dc', 1.0],
    [0.28, 38, 49, '#fff0d2', 2.95, '#cfe4fb', '#8a7a5c', 1.05, '#d4e4ee', 1.0],
    [0.45, 92, 65, '#fff4dc', 3.0, '#d3e9ff', '#8d7d5e', 1.1, '#d8e8ec', 1.0],
    [0.62, 138, 46, '#ffe4b4', 2.85, '#cddff4', '#8a7658', 1.05, '#ead9be', 1.0],
    [0.80, 168, 32, '#ffcd88', 2.6, '#c8d2ee', '#86694f', 1.0, '#efd0ac', 1.0],
    [0.92, 192, 17, '#ffa860', 2.7, '#d0b8c8', '#8a6450', 1.12, '#eebb98', 1.06],
    [1.00, 208, 9, '#ff8c48', 2.4, '#cba8b4', '#76503e', 1.1, '#dba0a2', 1.12]
  ];

  class FurtView {
    constructor(THREE, { width = 960, height = 600, quality = 'high' } = {}) {
      const T = this.T = THREE;
      let renderer;
      try { renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }); }
      catch (e) { throw new Error('WebGL nicht verfügbar: ' + e.message); }
      if (!renderer || !renderer.getContext()) throw new Error('WebGL nicht verfügbar');
      this.renderer = renderer; this.canvas = renderer.domElement;
      renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
      renderer.info.autoReset = false; renderer.setPixelRatio(1);
      this.reqW = width; this.reqH = height;
      this.quality = quality === 'low' ? 'low' : 'high';
      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(FOV, width / height, 40, 700);
      this.drawCalls = 0; this.triangles = 0; this.lastMs = 0; this.frame = 0; this.now = 0; this.lastNow = null;
      this.world = null; this.lords = []; this.lordBy = new Map(); this.land = null; this.fx = null; this.dbg = null; this.snap = false;
      this.sunDir = new T.Vector3(0, 1, 0); this.keyDir = new T.Vector3(0, 1, 0);
      this.cur = { az: 0, el: 40, keyI: 2.5, hemI: 1, expo: 1, night: 0, key: new T.Color(), hemS: new T.Color(), hemG: new T.Color(), haze: new T.Color() };
      this.kfc = KF.map((r) => ({ t: r[0], az: r[1], el: r[2], keyI: r[4], hemI: r[7], expo: r[9], c: COLS.map((_, i) => new T.Color(r[[3, 5, 6, 8][i]])) }));
      this._sunCol = new T.Color(); this._amb = new T.Color(); this._haze = new T.Vector3();
      this._v = new T.Vector3(); this._v2 = new T.Vector3(); this._m = new T.Matrix4(); this._q = new T.Quaternion(); this._s = new T.Vector3();
      this.keeps = new Map(); this.ruinKeeps = []; this.bld = new Map(); this.banners = new Map(); this.uk = {};
      this.gates = []; this.gar = new Map(); this.ramT = new Map(); this.pactSet = new Set(); this.onGate = null; this.dt = 0.016;   // Phase 2: gatehouses this frame, garrisoned units' facing, rams' blow times, active pacts (a * 16 + b), the gate hook
      this.blockSig = ''; this.treeV = -1;
      this.capW = 0; this.capH = 0;               // 0 = the quality's default cap (see applySize)
      this.insetReq = null; this.insetRect = null; this.insetCam = null; this.insetCur = null; this.insetOn = false;
      this.insetCalls = 0; this.insetTris = 0; this.insetMs = 0;
      this.applySize();
      this.initScene();
      this.setQuality(this.quality, true);
    }

    // ---------- sizing and quality ----------
    applySize() {
      const hi = this.quality === 'high', maxW = this.capW || (hi ? 1920 : 960), maxH = this.capH || (hi ? 1200 : 600);
      const s = Math.min(1, maxW / this.reqW, maxH / this.reqH);
      this.W = Math.max(2, Math.round(this.reqW * s)); this.H = Math.max(2, Math.round(this.reqH * s));
      this.renderer.setSize(this.W, this.H, false);
      this.camera.aspect = this.W / this.H; this.camera.updateProjectionMatrix();
      this.frameGame();
    }
    resize(width, height) { this.reqW = Math.max(2, width | 0); this.reqH = Math.max(2, height | 0); this.applySize(); }
    // Override the internal-size cap (e.g. native 4K); 0 restores the quality's default cap.
    setCap(maxW, maxH) { this.capW = maxW > 0 ? maxW | 0 : 0; this.capH = maxH > 0 ? maxH | 0 : 0; this.applySize(); }

    setQuality(q, init) {
      q = q === 'low' ? 'low' : 'high';
      const changed = q !== this.quality;
      this.quality = q;
      const hi = q === 'high', rd = this.renderer;
      this.applySize();
      rd.shadowMap.enabled = hi; rd.shadowMap.type = this.T.PCFShadowMap;
      this.keyLight.castShadow = hi;
      if (!hi) { const sm = this.keyLight.shadow; if (sm.map) { sm.map.dispose(); sm.map = null; } this.inset(null); }
      if (this.fx && this.fx.setQuality) this.safeFx(() => this.fx.setQuality(q));
      if (changed && !init) this.rebuild();
    }
    rebuild() { if (this.world) this.setWorld(this.world, this.lords); }

    // ---------- scene skeleton ----------
    initScene() {
      const T = this.T, sc = this.scene;
      this.keyLight = new T.DirectionalLight(0xffffff, 3);
      const sh = this.keyLight.shadow;
      sh.mapSize.set(2048, 2048); sh.bias = -0.0004; sh.normalBias = 0.05; sh.radius = 2;
      sh.camera.near = 10; sh.camera.far = 500;
      this.hemi = new T.HemisphereLight(0xcfe6ff, 0x8a7a5c, 1.05);
      sc.add(this.keyLight, this.keyLight.target, this.hemi);
      // soft round blob for the unit shadows
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      this.texBlob = new T.CanvasTexture(cv); this.texBlob.colorSpace = T.SRGBColorSpace;
      this.blobMat = new T.MeshBasicMaterial({ map: this.texBlob, color: 0x1a1208, transparent: true, opacity: 0.36, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      this.blob = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.blobMat, BLOB_MAX);
      this.blob.frustumCulled = false; this.blob.count = 0; this.blob.renderOrder = 3; this.blob.instanceMatrix.setUsage(T.DynamicDrawUsage);
      sc.add(this.blob);
      this.actors = new T.Group(); this.actors.name = 'actors'; sc.add(this.actors);
      this.initFire();
    }
    // v0 stand-in for the Phase 1 fire fx: camera-facing flame cards (additive) and smoke puffs over burning buildings, 2 draw calls at most.
    // It switches itself off while a FurtFx instance exists (the real fx draws fire then) and comes back if the fx failed to initialise.
    initFire() {
      const T = this.T, mk = (stops) => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 64;
        const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 38, 2, 32, 36, 30);
        for (const [p, c] of stops) gr.addColorStop(p, c);
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
        const tx = new T.CanvasTexture(cv); tx.colorSpace = T.SRGBColorSpace; return tx;
      };
      this.texFlame = mk([[0, 'rgba(255,226,140,.95)'], [0.3, 'rgba(255,158,44,.8)'], [0.65, 'rgba(240,84,18,.38)'], [1, 'rgba(220,50,10,0)']]);
      this.texSmoke = mk([[0, 'rgba(66,58,52,.8)'], [0.6, 'rgba(66,58,52,.38)'], [1, 'rgba(66,58,52,0)']]);
      const geo = new T.PlaneGeometry(1, 1);
      this.flame = new T.InstancedMesh(geo, new T.MeshBasicMaterial({ map: this.texFlame, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }), FIRE_MAX);
      this.smoke = new T.InstancedMesh(geo, new T.MeshBasicMaterial({ map: this.texSmoke, transparent: true, depthWrite: false, fog: false }), SMOKE_MAX);
      for (const m of [this.flame, this.smoke]) { m.frustumCulled = false; m.count = 0; m.visible = false; m.instanceMatrix.setUsage(T.DynamicDrawUsage); this.scene.add(m); }
      this.smoke.renderOrder = 7; this.flame.renderOrder = 8;
    }
    updateFire(t) {
      const fx = !!this.fx;
      let nf = 0, ns = 0;
      if (!fx) {
        const fa = this.flame.instanceMatrix.array, sa = this.smoke.instanceMatrix.array, q = this.camera.quaternion, m = this._m, v = this._v, sc = this._s;
        for (const [id, r] of this.bld) {
          const burning = r.fire > 0.04 && !r.ruined, smolder = r.ruined && r.burnt > 0.6;
          if (!burning && !smolder) continue;
          const w = r.rect.x1 - r.rect.x0, d = r.rect.y1 - r.rect.y0, cx = (r.rect.x0 + r.rect.x1) / 2, cz = (r.rect.y0 + r.rect.y1) / 2, gy = r.obj.group.position.y;
          if (burning) {
            const K = Math.min(7, 2 + Math.round(r.fire * 6));
            for (let k = 0; k < K && nf < FIRE_MAX; k++, nf++) {
              const h1 = hash1(id * 7.3 + k * 1.7), h2 = hash1(id * 3.1 + k * 5.9), fl = 0.8 + 0.3 * Math.sin(t * 9 + id + k * 2.3) + 0.12 * Math.sin(t * 17 + k), sz = (0.9 + 0.8 * h1) * (0.6 + 0.7 * r.fire) * fl;
              m.compose(v.set(cx + (h1 - 0.5) * w * 0.7, gy + 1.0 + h2 * 1.1 + sz * 0.5, cz + (h2 - 0.5) * d * 0.7), q, sc.set(sz * 0.72, sz * 1.65, 1)); m.toArray(fa, nf * 16);
            }
          }
          for (let k = 0, P = burning ? 4 : 2; k < P && ns < SMOKE_MAX; k++, ns++) {
            const age = fract(t * 0.26 + hash1(id * 2.7 + k * 0.37)), sz = (0.9 + age * 2.8) * (burning ? 1 : 0.7) * Math.sin(age * Math.PI);
            m.compose(v.set(cx + 0.9 * age + (hash1(id + k) - 0.5), gy + 2.2 + age * 6.5, cz - 0.4 * age), q, sc.set(sz, sz, 1)); m.toArray(sa, ns * 16);
          }
        }
        this.flame.instanceMatrix.needsUpdate = true; this.smoke.instanceMatrix.needsUpdate = true;
      }
      this.flame.count = nf; this.flame.visible = nf > 0; this.smoke.count = ns; this.smoke.visible = ns > 0;
    }

    // ---------- the world ----------
    setWorld(world, lords) {
      this.clearWorld();
      this.world = world; this.lords = lords || this.lords || [];
      this.lordBy.clear(); for (const l of this.lords) this.lordBy.set(l.i, l);
      if (!world) return;
      const T = this.T, q = this.quality;
      this.land = new window.FurtTerrain(T, world, { quality: q });
      this.scene.add(this.land.group);
      // keeps: one per seated lord, a grey ruin on empty sites (decor)
      const seated = new Set();
      // The gates face the river (Phase 1): sites 0/1 (north) open south = the model as built, sites 2/3 (south) are turned by pi.
      for (const l of this.lords) {
        const s = world.sites[l.site]; if (!s) continue;
        seated.add(l.site);
        const art = FA.keep(T, { color: l.color, emblem: l.emblem | 0, quality: q });
        art.group.position.set(s.x, this.land.heightAt(s.x, s.y), s.y); art.group.rotation.y = s.s >= 2 ? Math.PI : 0;
        this.actors.add(art.group); this.keeps.set(l.i, { art, site: s, lord: l.i, hp: -1, burnt: -1, ruined: null });
      }
      for (const s of world.sites) {
        if (seated.has(s.s)) continue;
        const art = FA.keep(T, { color: '#8a8478', emblem: 0, quality: q });
        art.setRuined(true); art.group.position.set(s.x, this.land.heightAt(s.x, s.y), s.y); art.group.rotation.y = s.s >= 2 ? Math.PI : 0;
        this.actors.add(art.group); this.ruinKeeps.push(art);
      }
      this.createUnits();
      this.blockSig = ''; this.treeV = -1; this.setBlockers([]);
      this.frameGame();
      this.createFx();
      if (this.fx && this.fx.setWorld) this.safeFx(() => this.fx.setWorld(world));
    }
    createUnits() {
      const T = this.T, kit = FA.units(T, { quality: this.quality });
      for (const k of Object.keys(UNIT_CAP)) { const u = kit.create(k, UNIT_CAP[k]); u.mesh.castShadow = false; this.actors.add(u.mesh); this.uk[k] = u; }
    }
    clearWorld() {
      for (const [, r] of this.keeps) { this.actors.remove(r.art.group); r.art.dispose(); }
      for (const a of this.ruinKeeps) { this.actors.remove(a.group); a.dispose(); }
      for (const [, r] of this.bld) { this.actors.remove(r.obj.group); r.obj.dispose(); }
      for (const [, r] of this.banners) { this.actors.remove(r.art.group); r.art.dispose(); }
      for (const k in this.uk) { this.actors.remove(this.uk[k].mesh); this.uk[k].dispose(); }
      this.keeps.clear(); this.ruinKeeps = []; this.bld.clear(); this.banners.clear(); this.uk = {};
      this.gates.length = 0; this.gar.clear(); this.ramT.clear(); this.pactSet.clear();
      if (this.land) { this.scene.remove(this.land.group); this.land.dispose(); this.land = null; }
    }
    // keep rects always block trees; buildings add theirs
    setBlockers(rects) {
      const all = rects.slice();
      for (const [, r] of this.keeps) all.push({ x0: r.site.x - 4, y0: r.site.y - 4, x1: r.site.x + 4, y1: r.site.y + 4 });
      for (const a of this.ruinKeeps) all.push({ x0: a.group.position.x - 4, y0: a.group.position.z - 4, x1: a.group.position.x + 4, y1: a.group.position.z + 4 });
      if (this.land) this.land.setBlockers(all);
    }

    // ---------- keyframes ----------
    sample(dayT) {
      const K = this.kfc, t = clamp(dayT, 0, 1), cur = this.cur;
      let i = 0; while (i < K.length - 2 && t > K[i + 1].t) i++;
      const a = K[i], b = K[i + 1], f = clamp((t - a.t) / (b.t - a.t), 0, 1);
      for (const k of ['az', 'el', 'keyI', 'hemI', 'expo']) cur[k] = lerp(a[k], b[k], f);
      COLS.forEach((k, j) => cur[k].copy(a.c[j]).lerp(b.c[j], f));
      cur.night = sstep(0.85, 1.0, t);
    }
    updateLight(dayT) {
      this.sample(dayT);
      const cur = this.cur, az = cur.az * RAD, el = cur.el * RAD;
      this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
      this.keyDir.copy(this.sunDir); if (this.keyDir.y < 0.27) { this.keyDir.y = 0.27; this.keyDir.normalize(); }
      this.keyLight.color.copy(cur.key); this.keyLight.intensity = cur.keyI;
      this.hemi.color.copy(cur.hemS); this.hemi.groundColor.copy(cur.hemG); this.hemi.intensity = cur.hemI;
      this.renderer.toneMappingExposure = cur.expo;
      this.renderer.setClearColor(cur.haze, 1);
      cur.haze.getRGB(this._rgb || (this._rgb = { r: 0, g: 0, b: 0 }), this.T.SRGBColorSpace);
      this._haze.set(this._rgb.r, this._rgb.g, this._rgb.b);
      this._sunCol.copy(cur.key).multiplyScalar(cur.keyI / Math.PI);
      this._amb.copy(cur.hemG).lerp(cur.hemS, 0.8).multiplyScalar(cur.hemI / Math.PI);
      FA.setNight(cur.night);
    }

    // ---------- camera ----------
    // Closed-form framing of the playable box (+ a thin margin) for any aspect: a few fixed-point steps on the distance and on the
    // target's north-south offset, so the map sits centred in the frame whatever the aspect.
    frameGame() {
      const cam = this.camera, el = ELEV * RAD, tanV = Math.tan(cam.fov * RAD / 2), tanH = tanV * cam.aspect, M = 0.968;
      const f = [0, -Math.sin(el), -Math.cos(el)], up = [0, Math.cos(el), -Math.sin(el)];
      const ext = (D, tz) => {
        const px = 0, py = 1.5 + Math.sin(el) * D, pz = tz + Math.cos(el) * D;
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const sx of [-1, 1]) for (const hy of [-0.5, 9]) for (const sz of [-1, 1]) {
          const rx = sx * (PX + 1) - px, ry = hy - py, rz = sz * (PY + 1) - pz;
          const a = ry * f[1] + rz * f[2], nx = rx / (a * tanH), ny = (ry * up[1] + rz * up[2]) / (a * tanV);
          x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
        }
        return { x0, x1, y0, y1 };
      };
      let D = 220, tz = 0;
      for (let it = 0; it < 14; it++) {
        const e = ext(D, tz), hw = Math.max(e.x1, -e.x0), hh = (e.y1 - e.y0) / 2;
        D *= Math.max(hw, hh) / M;
        const e0 = ext(D, tz), e1 = ext(D, tz + 1), c0 = (e0.y0 + e0.y1) / 2, c1 = (e1.y0 + e1.y1) / 2;
        if (Math.abs(c1 - c0) > 1e-9) tz -= c0 / (c1 - c0);
      }
      this.game = { tx: 0, ty: 1.5, tz, dist: D, el: ELEV, az: 0 };
      if (!this.dbg) this.applyCam();
    }
    camPreset(name) {
      const w = this.world; if (!w) return null;
      const cr = (id) => w.crossings.find((c) => c.id === id) || w.crossings[0], s0 = w.sites[0];
      if (name === 'ford') { const c = cr('westfurt'); return { tx: c.x, ty: 0.2, tz: c.y, dist: 48, el: 46, az: 0 }; }
      if (name === 'bridge') { const c = cr('steinbruecke'); return { tx: c.x + 0.5, ty: 0.3, tz: c.y, dist: 42, el: 36, az: 38 }; }
      if (name === 'castle') return { tx: s0.x + 1.5, ty: 4.2, tz: s0.y + 3, dist: 74, el: 41, az: 12 };
      if (name === 'stream') { const c = cr('nordsteg'); return { tx: c.x, ty: 0.2, tz: c.y, dist: 40, el: 44, az: -12 }; }
      return null;
    }
    // preset name | { x, y, dist, el, az } | null = the game camera
    debugCam(p) {
      if (typeof p === 'string') { const c = this.camPreset(p); this.dbg = c; }
      else if (p && typeof p === 'object') this.dbg = { tx: p.x, ty: p.h != null ? p.h : 0.3, tz: p.y, dist: p.dist || 50, el: p.el || 45, az: p.az || 0 };
      else this.dbg = null;
      this.applyCam();
    }
    applyCam() {
      const c = this.dbg || this.game; if (!c) return;
      const cam = this.camera, el = c.el * RAD, az = (c.az || 0) * RAD;
      cam.position.set(c.tx + Math.sin(az) * Math.cos(el) * c.dist, c.ty + Math.sin(el) * c.dist, c.tz + Math.cos(az) * Math.cos(el) * c.dist);
      cam.near = Math.max(4, c.dist * 0.25); cam.far = c.dist * 3.2 + 120; cam.updateProjectionMatrix();
      cam.lookAt(c.tx, c.ty, c.tz); cam.updateMatrixWorld();
    }
    project(x, y, height) {
      const v = this._v.set(x, height || 0, y).project(this.camera);
      const behind = v.z > 1 || v.z < -1;
      return { x: (v.x * 0.5 + 0.5) * this.W, y: (1 - (v.y * 0.5 + 0.5)) * this.H, visible: !behind && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
    }
    // fit the key light's shadow camera around what the frame shows
    fitShadow() {
      if (this.quality !== 'high') return;
      const L = this.keyLight, sc = L.shadow.camera, c = this.dbg, pts = [];
      let cx = 0, cz = 0, rx = PX + 1.5, rz = PY + 1.5;
      if (c) { cx = c.tx; cz = c.tz; rx = rz = Math.max(14, c.dist * 0.5); }
      for (const sx of [-1, 1]) for (const hy of [-1.8, 12]) for (const sz of [-1, 1]) pts.push(this._v2.clone().set(cx + sx * rx, hy, cz + sz * rz));
      L.position.set(cx, 1, cz).addScaledVector(this.keyDir, 260); L.target.position.set(cx, 1, cz);
      L.updateMatrixWorld(); L.target.updateMatrixWorld();
      sc.position.copy(L.position); sc.lookAt(L.target.position); sc.updateMatrixWorld();
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const p of pts) { p.applyMatrix4(sc.matrixWorldInverse); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      const tex = (x1 - x0) / 2048; x0 = Math.floor(x0 / tex) * tex; y0 = Math.floor(y0 / tex) * tex;
      sc.left = x0; sc.right = x1; sc.bottom = y0; sc.top = y1; sc.near = Math.max(1, -z1 - 6); sc.far = -z0 + 6; sc.updateProjectionMatrix();
    }

    // ---------- fx hook ----------
    createFx() {
      if (this.fx || !window.FurtFx) return;
      try { this.fx = new window.FurtFx(this.T, { scene: this.scene, camera: this.camera, quality: this.quality, view: this }); }
      catch (e) { console.warn('[FurtView] fx init failed', e); this.fx = null; }
    }
    safeFx(fn) { try { fn(); } catch (e) { this._fxErr = (this._fxErr | 0) + 1; if (this._fxErr < 4) console.warn('[FurtView] fx error', e); } }
    event(ev, state) {
      if (this.fx && this.fx.event) this.safeFx(() => this.fx.event(ev, state));
      if (ev && ev.t === 'ram') this.safeFx(() => this.onRam(ev, state));   // Phase 2: the swing of the ram that struck, the shake of the piece
    }
    buildingObj(id) { const r = this.bld.get(id); return r ? r.obj : null; }
    keepObj(lord) { const r = this.keeps.get(lord); return r ? r.art : null; }
    bannerObj(id) { const r = this.banners.get(id); return r ? r.art : null; }

    // ---------- actors ----------
    colorOf(lord) { const l = this.lordBy.get(lord); return l ? l.color : '#cccccc'; }
    emblemOf(lord) { const l = this.lordBy.get(lord); return l ? l.emblem | 0 : 0; }

    updateBuildings(state, t) {
      const T = this.T, land = this.land, q = this.quality, seen = new Set();
      let sig = '';
      this.gates.length = 0;
      for (const b of state.buildings || []) {
        if (b.kind === 'bergfried') {   // the keep is built in setWorld; this entry only drives its state
          const k = this.keeps.get(b.lord);
          if (k) {
            if (Math.abs(b.hp - k.hp) > 0.005) { k.hp = b.hp; k.art.setDamage(b.hp == null ? 1 : b.hp); }
            const bn = Math.max(b.burnt || 0, (b.fire || 0) * 0.6);
            if (Math.abs(bn - k.burnt) > 0.005) { k.burnt = bn; k.art.setBurnt(bn); }
            if (k.ruined !== !!b.ruined) { k.ruined = !!b.ruined; k.art.setRuined(k.ruined); }
          }
          continue;
        }
        seen.add(b.id);
        const len = b.len > 1 ? b.len | 0 : 1;   // Phase 2: wall pieces (palisade, mauer) are 1 × len cells; part of the key, so a rebuilt line of another length is a new model
        const key = b.kind + ':' + b.lord + ':' + (b.rot | 0) + ':' + b.i + ':' + b.j + ':' + len;
        sig += key + ';';
        let r = this.bld.get(b.id);
        if (r && r.key !== key) { this.removeBuilding(b.id, r); r = null; }
        if (!r) {
          const obj = FA.building(T, b.kind, { color: this.colorOf(b.lord), quality: q, rot: b.rot | 0, len });
          const fp = FW.footprintOf(b.kind, b.rot | 0, len), x0 = -PX + b.i, y0 = -PY + b.j, cx = x0 + fp[0] / 2, cy = y0 + fp[1] / 2;
          const h = (land.heightAt(cx, cy) * 2 + land.heightAt(x0, y0) + land.heightAt(x0 + fp[0], y0) + land.heightAt(x0, y0 + fp[1]) + land.heightAt(x0 + fp[0], y0 + fp[1])) / 6;
          obj.group.position.set(cx, h - 0.02, cy); obj.group.rotation.y = -(b.rot | 0) * Math.PI / 2;
          this.actors.add(obj.group);
          const cells = [];
          for (let dj = 0; dj < fp[1]; dj++) for (let di = 0; di < fp[0]; di++) cells.push((b.j + dj) * FW.GW + b.i + di);
          r = { key, obj, kind: b.kind, lord: b.lord, rot: b.rot | 0, len, fire: 0, cells, rect: { x0, y0, x1: x0 + fp[0], y1: y0 + fp[1] }, build: -1, hp: -1, burnt: -1, ruined: null, growth: -1, plot: -1, scorch: -1,
            base: { x: cx, y: h - 0.02, z: cy }, shake: null, slots: obj.anchors && obj.anchors.slots ? obj.anchors.slots.length : 0, slotCache: null, outH: null, gate: null };
          if (b.kind === 'torhaus') r.gate = { r, id: b.id, lord: b.lord, box: this.laneBox(b), open: 0, set: -1, hold: -1, want: false, ok: false, up: false };
          this.bld.set(b.id, r);
        }
        const o = r.obj, build = b.build == null ? 1 : b.build;
        if (Math.abs(build - r.build) > 0.002) { r.build = build; o.setBuild(build); }
        if (Math.abs((b.hp == null ? 1 : b.hp) - r.hp) > 0.005) { r.hp = b.hp == null ? 1 : b.hp; o.setDamage(r.hp); }
        const bn = Math.max(b.burnt || 0, (b.fire || 0) * 0.55);
        r.fire = b.fire || 0;
        if (Math.abs(bn - r.burnt) > 0.005) { r.burnt = bn; o.setBurnt(bn); }
        if (r.ruined !== !!b.ruined) { r.ruined = !!b.ruined; o.setRuined(r.ruined); }
        if (b.growth != null && Math.abs(b.growth - r.growth) > 0.002) { r.growth = b.growth; o.setGrowth(b.growth); }
        if (r.shake) this.shakePiece(r, t);
        if (r.gate) { const G = r.gate; G.want = false; G.ok = build >= 1 && !b.ruined; this.gates.push(G); }   // the units loop decides whether a friend stands in its lane
        o.animate(t, { working: build >= 1 && !b.ruined && !(b.fire > 0.05) });
        if (q === 'low' && build < 1) { if (!r.crane) r.crane = o.group.getObjectByName('crane'); if (r.crane) r.crane.visible = false; }   // low: no crane (a draw call less)
        // ground under the building: construction dirt while it is being built, scorched earth once burnt
        const plot = b.kind === 'hof' ? 0 : 1 - sstep(0.9, 1.0, build), sc = clamp(Math.max(b.burnt || 0, (b.fire || 0) * 0.5) * (b.kind === 'hof' ? 1 : 0.7), 0, 1);
        if (Math.abs(plot - r.plot) > 0.02 || Math.abs(sc - r.scorch) > 0.02) {
          r.plot = plot; r.scorch = sc;
          for (const k of r.cells) land.setGround(k, { plot, burnt: sc });
        }
      }
      for (const [id, r] of [...this.bld]) if (!seen.has(id)) this.removeBuilding(id, r);
      if (sig !== this.blockSig) {
        this.blockSig = sig;
        const rects = []; for (const [, r] of this.bld) rects.push(r.rect);
        this.setBlockers(rects);
      }
    }
    // Torhaus: the lane (its two cells and the two cells outside its mouths) as a box in world units; a unit of the owner or of a pact partner inside it opens the doors
    laneBox(b) {
      const L = FW.laneOf(b.i, b.j, b.rot | 0), cs = L.cells.concat(L.ends);
      let i0 = 1e9, i1 = -1e9, j0 = 1e9, j1 = -1e9;
      for (const c of cs) { i0 = Math.min(i0, c[0]); i1 = Math.max(i1, c[0]); j0 = Math.min(j0, c[1]); j1 = Math.max(j1, c[1]); }
      return { x0: -PX + i0, x1: -PX + i1 + 1, z0: -PY + j0, z1: -PY + j1 + 1 };
    }
    // the doors follow the lane: open at once when a friend steps in (and the creak plays), shut a moment after the last one has left; both eased
    updateGates(dt, t) {
      for (const G of this.gates) {
        const want = G.ok && G.want;
        if (want) G.hold = t + GATE_HOLD;
        const target = G.ok && (want || t < G.hold) ? 1 : 0;
        if (target === 1 && !G.up) {
          G.up = true;
          if (G.open < 0.25 && !this.snap && this.onGate) { const r = G.r; try { this.onGate({ id: G.id, lord: G.lord, x: r.base.x, z: r.base.z }); } catch (e) { /* a hook must not stop the picture */ } }
        } else if (target === 0) G.up = false;
        if (this.snap) G.open = target; else G.open += (target - G.open) * (1 - Math.exp(-(target > G.open ? GATE_OPEN_K : GATE_CLOSE_K) * dt));
        if (Math.abs(G.open - target) < 0.004) G.open = target;
        if (Math.abs(G.open - G.set) > 0.002) { G.set = G.open; G.r.obj.setOpen(G.open); }
      }
    }
    // a struck piece trembles along the blow (its own model moves, the camera does not): a damped oscillation for SHAKE_S; the archers on it ride along (slot anchors follow the group)
    shakePiece(r, t) {
      const sk = r.shake, age = t - sk.t0, g = r.obj.group;
      if (age >= SHAKE_S) { r.shake = null; g.position.set(r.base.x, r.base.y, r.base.z); r.slotCache = null; return; }
      if (age < 0) return;
      const a = sk.amp * Math.exp(-age * 9) * Math.sin(age * 42);
      g.position.set(r.base.x + sk.dx * a, r.base.y + Math.abs(a) * 0.12, r.base.z + sk.dz * a);
    }
    // the direction an archer on this building looks when nothing draws his eye: away from the keep of his house (the normal of a wall, the way out of a gatehouse)
    outHeading(r) {
      if (r.outH != null) return r.outH;
      const k = this.keeps.get(r.lord), ru = r.rect, cx = (ru.x0 + ru.x1) / 2, cz = (ru.y0 + ru.y1) / 2;
      let ox = k ? cx - k.site.x : 0, oz = k ? cz - k.site.y : 1;
      if (Math.abs(ox) + Math.abs(oz) < 1e-3) oz = 1;
      if (r.kind === 'mauer' || r.kind === 'palisade' || r.kind === 'torhaus') { if (r.rot) { ox = ox >= 0 ? 1 : -1; oz = 0; } else { oz = oz >= 0 ? 1 : -1; ox = 0; } }
      return (r.outH = Math.atan2(oz, ox));
    }
    // where a garrisoned unit stands: the art slot of its building with the same index (the sim and the model number the slots of a Torhaus differently; the view maps s to s),
    // and which way he faces. → the scratch object { x, y, z, h } or null (the building is not in the scene (yet))
    garrisonPlace(u, t, dt) {
      const r = this.bld.get(u.on); if (!r || !r.slots) return null;
      const n = r.slots, s = u.slot | 0, idx = s >= 0 && s < n ? s : ((s % n) + n) % n;
      let p;
      if (r.shake) p = r.obj.slotWorld(idx, this._v);
      else {
        const c = r.slotCache || (r.slotCache = []);
        if (!c[idx]) { const v = r.obj.slotWorld(idx, this._v); if (v) c[idx] = { x: v.x, y: v.y, z: v.z }; }
        p = c[idx];
      }
      if (!p) return null;
      const out = this.outHeading(r), h = u.h == null ? out : u.h;
      let G = this.gar.get(u.id);
      if (!G) { G = { h: out, last: h, aim: -1e9, seen: 0 }; this.gar.set(u.id, G); }
      G.seen = this.frame;
      if (u.anim === 'fight' || Math.abs(lerpAngle(0, h - G.last, 1)) > 0.002) G.aim = t;   // he shot, or the sim turned him towards a target
      G.last = h;
      G.h = lerpAngle(G.h, t - G.aim < GARRISON_AIM_S ? h : out, 1 - Math.exp(-GARRISON_TURN * dt));
      const o = this._gp || (this._gp = { x: 0, y: 0, z: 0, h: 0 });
      o.x = p.x; o.y = p.y; o.z = p.z; o.h = G.h;
      return o;
    }
    // the blow's picture: the nearest ram swings so that its log is fully forward when the blow lands (art.js: f = fract(uTime / 2 + phase), forward at f = .68), and the struck piece shakes
    onRam(ev, state) {
      const t = this.now / 1000 + RAM_LEAD;
      let best = null, bd = 9;
      for (const u of (state && state.units) || []) { if (u.kind !== 'ramme') continue; const d = Math.hypot(u.x - ev.x, u.y - ev.y); if (d < bd) { bd = d; best = u; } }
      if (best) { let R = this.ramT.get(best.id); if (!R) { R = { hit: t, ph: NaN, seen: this.frame }; this.ramT.set(best.id, R); } R.hit = t; }
      const r = this.bld.get(ev.id);
      if (r && !r.ruined) {
        let dx = best ? ev.x - best.x : r.base.x - ev.x, dz = best ? ev.y - best.y : r.base.z - ev.y;
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        r.shake = { t0: t, dx, dz, amp: r.kind === 'palisade' ? 0.085 : r.kind === 'torhaus' ? 0.04 : r.kind === 'mauer' ? 0.05 : 0.06 };
        r.slotCache = null;
      }
    }
    ramPhase(u, t, dt) {
      if (u.anim !== 'fight') { this.ramT.delete(u.id); return hash1(u.id * 0.731); }
      let R = this.ramT.get(u.id);
      if (!R) { R = { hit: t + RAM_CD, ph: NaN, seen: 0 }; this.ramT.set(u.id, R); }   // a swing that begins now ends with its blow one period later
      R.seen = this.frame;
      const want = fract(RAM_F - fract(R.hit / RAM_CD));
      if (R.ph !== R.ph) R.ph = want;
      else { let d = want - R.ph; d -= Math.round(d); R.ph = fract(R.ph + d * (1 - Math.exp(-8 * dt))); }
      return R.ph;
    }
    removeBuilding(id, r) {
      this.actors.remove(r.obj.group); r.obj.dispose(); this.bld.delete(id);
      if (this.land) for (const k of r.cells) this.land.setGround(k, { plot: 0, burnt: 0 });
      this.blockSig = '#';
    }

    updateUnits(state, alpha, t) {
      const land = this.land, cnt = {}, sc = this.sunDir, dt = this.dt, gates = this.gates, ng = gates.length, pacts = this.pactSet;
      for (const k in this.uk) cnt[k] = 0;
      const ox = -sc.x * 0.35, oz = -sc.z * 0.35, bm = this.blob.instanceMatrix.array;
      let nb = 0, garN = 0, ramN = 0;
      pacts.clear();
      if (ng) for (const p of state.pacts || []) if (p.until > 0) { pacts.add(p.a * 16 + p.b); pacts.add(p.b * 16 + p.a); }   // active pacts only (an offer has `offerUntil`): partners may use each other's gates
      for (const u of state.units || []) {
        const U = this.uk[u.kind]; if (!U) continue;
        const i = cnt[u.kind]; if (i >= U.max) continue;
        cnt[u.kind] = i + 1;
        if (u.on != null) {   // Wehrgang: an archer on a wall, gatehouse or tower stands on the slot anchor (no blob shadow: he is up there)
          const gp = this.garrisonPlace(u, t, dt);
          if (gp) { U.set(i, gp.x, gp.y, gp.z, -gp.h, ANIM[u.anim] | 0, hash1(u.id * 0.731), this.colorOf(u.lord), 0); garN++; continue; }
        }
        const x = lerp(u.px == null ? u.x : u.px, u.x, alpha), y = lerp(u.py == null ? u.y : u.py, u.y, alpha), h = u.ph == null ? u.h : lerpAngle(u.ph, u.h, alpha);
        const gy = land.standY(x, y);
        let phase = hash1(u.id * 0.731);
        if (u.kind === 'ramme') { phase = this.ramPhase(u, t, dt); ramN++; }
        U.set(i, x, gy, y, -h, ANIM[u.anim] | 0, phase, this.colorOf(u.lord), CARRY[u.carry] | 0);
        for (let g = 0; g < ng; g++) {   // a friend (own or pact partner) in a Torhaus lane: its doors open
          const G = gates[g], b = G.box;
          if (!G.want && G.ok && x >= b.x0 && x <= b.x1 && y >= b.z0 && y <= b.z1 && (u.lord === G.lord || pacts.has(u.lord * 16 + G.lord))) G.want = true;
        }
        if (nb < BLOB_MAX) {
          const r = (BLOB_R[u.kind] || 0.5) * 2, c = Math.cos(-h), s = Math.sin(-h), sx = r * (BLOB_LONG[u.kind] || 1), o = nb * 16;
          bm[o] = c * sx; bm[o + 1] = 0; bm[o + 2] = -s * sx; bm[o + 3] = 0; bm[o + 4] = 0; bm[o + 5] = 1; bm[o + 6] = 0; bm[o + 7] = 0;
          bm[o + 8] = s * r; bm[o + 9] = 0; bm[o + 10] = c * r; bm[o + 11] = 0; bm[o + 12] = x + ox; bm[o + 13] = gy + 0.07; bm[o + 14] = y + oz; bm[o + 15] = 1; nb++;
        }
      }
      if (this.gar.size > garN + 16) for (const [id, G] of this.gar) if (G.seen !== this.frame) this.gar.delete(id);   // archers that left a wall or died
      if (this.ramT.size > ramN + 8) for (const [id, R] of this.ramT) if (R.seen !== this.frame) this.ramT.delete(id);
      for (const k in this.uk) { this.uk[k].count(cnt[k]); this.uk[k].commit(); }
      this.blob.count = nb; this.blob.instanceMatrix.needsUpdate = true;
    }

    updateBanners(state, alpha, t) {
      const seen = new Set(), land = this.land;
      for (const b of state.banners || []) {
        seen.add(b.id);
        let r = this.banners.get(b.id);
        if (!r) {
          const art = FA.banner(this.T, { color: this.colorOf(b.lord), emblem: this.emblemOf(b.lord), quality: this.quality });
          art.mesh.castShadow = false; art.group.scale.setScalar(1.55);
          this.actors.add(art.group); r = { art }; this.banners.set(b.id, r);
        }
        const x = lerp(b.px == null ? b.x : b.px, b.x, alpha), y = lerp(b.py == null ? b.y : b.py, b.y, alpha);
        r.art.group.position.set(x, land.standY(x, y) - 0.05, y);
        r.art.animate(t, { moving: !!b.moving });
      }
      for (const [id, r] of [...this.banners]) if (!seen.has(id)) { this.actors.remove(r.art.group); r.art.dispose(); this.banners.delete(id); }
    }

    // ---------- render ----------
    render(state, alpha, opts) {
      if (!state || !this.world || !this.land) return;
      const t0 = performance.now();
      opts = opts || {};
      const now = opts.now != null ? opts.now : this.now + 16.7;
      let dt = opts.dt != null ? opts.dt : (this.lastNow == null ? 0.016 : (now - this.lastNow) / 1000);
      dt = clamp(dt, 0, 0.1);
      this.lastNow = now; this.now = now; this.frame++; this.snap = !!opts.snap; this.dt = dt;
      alpha = clamp(alpha == null ? 1 : alpha, 0, 1);
      const t = now / 1000, rd = this.renderer, hi = this.quality === 'high', land = this.land;
      rd.info.reset();
      // the Phase 0 harness sends full lords (with colour); the Phase 1 sim state has none (the glue supplies them via setWorld), so never replace
      if (state.lords) for (let i = 0; i < state.lords.length; i++) { const l = state.lords[i]; if (l && l.color) this.lordBy.set(l.i, l); }
      this.updateLight(state.dayT == null ? 0.45 : state.dayT);
      FA.tick(t);
      land.setLevel(state.level || 0);
      land.update(t, dt, { sunDir: this.sunDir, sunCol: this._sunCol, amb: this._amb, sky: this.cur.hemS, haze: this._haze });
      if (state.trees && state.treeV !== this.treeV) { this.treeV = state.treeV; land.setTrees(state.trees); }
      this.updateBuildings(state, t);
      this.updateUnits(state, alpha, t);
      this.updateGates(dt, t);
      this.updateBanners(state, alpha, t);
      this.updateFire(t);
      if (opts.snap) land.resetWet();
      if (this.fx) this.safeFx(() => this.fx.update(state, alpha, { now, dt, dayT: state.dayT, sunDir: this.sunDir }));
      if (opts.draw === false) { this.lastMs = performance.now() - t0; return; }
      this.fitShadow();
      rd.setRenderTarget(null); rd.setScissorTest(false); rd.setViewport(0, 0, this.W, this.H);
      if (this.fx && this.fx.pass) this.safeFx(() => this.fx.pass(this.camera, this.H));
      rd.clear(); rd.render(this.scene, this.camera);
      this.drawCalls = rd.info.render.calls; this.triangles = rd.info.render.triangles;   // the main pass only; the inset has its own counters
      if (this.insetReq && hi) this.drawInset(dt);
      this.lastMs = performance.now() - t0;
    }

    // ---------- Kampf-Kamera: picture-in-picture close-up ----------
    // view.inset(rect, focus): a second camera of the same scene, rendered after the main pass into a scissored viewport with a frame.
    //   rect = { x, y, w, h } in internal canvas px (origin top-left, like view.project); focus = { x, y, dist } in world units: the camera
    //   looks at (x, y) from the south, dist away; call it every frame to follow a fight (the focus is eased), inset(null) turns it off.
    //   High quality only (a no-op on low): it costs a second scene pass (the shadow map of the main pass is reused).
    // view.insetRect = the clamped rect while it is on (null otherwise: the HUD draws its label from it);
    // view.insetCalls / insetTris / insetMs = the cost of the last inset pass (not included in drawCalls / triangles).
    inset(rect, focus) {
      if (!rect || !focus || this.quality !== 'high') {
        this.insetReq = null; this.insetRect = null; this.insetOn = false; this.insetCalls = 0; this.insetTris = 0; this.insetMs = 0; return;
      }
      const W = this.W, H = this.H, w = clamp(Math.round(rect.w), 32, W), h = clamp(Math.round(rect.h), 32, H);
      const r = this.insetRect || (this.insetRect = { x: 0, y: 0, w: 0, h: 0 }), q = this.insetReq || (this.insetReq = { x: 0, y: 0, dist: 28 });
      r.x = clamp(Math.round(rect.x), 0, W - w); r.y = clamp(Math.round(rect.y), 0, H - h); r.w = w; r.h = h;
      q.x = focus.x; q.y = focus.y; q.dist = clamp(focus.dist || 28, 10, 90);
    }
    drawInset(dt) {
      const T = this.T, rd = this.renderer, r = this.insetRect, rq = this.insetReq, t0 = performance.now(), c0 = rd.info.render.calls, k0 = rd.info.render.triangles;
      if (!this.insetCam) this.insetCam = new T.PerspectiveCamera(INSET_FOV, 1, 4, 300);
      const cam = this.insetCam;
      let f = this.insetCur;
      if (!this.insetOn || !f) { f = this.insetCur = { x: rq.x, y: rq.y, dist: rq.dist }; this.insetOn = true; }   // the first frame after turning on snaps
      else { const k = 1 - Math.exp(-3.5 * dt); f.x += (rq.x - f.x) * k; f.y += (rq.y - f.y) * k; f.dist += (rq.dist - f.dist) * k; }
      if (r.x + r.w > this.W || r.y + r.h > this.H) { r.w = Math.min(r.w, this.W); r.h = Math.min(r.h, this.H); r.x = Math.min(r.x, this.W - r.w); r.y = Math.min(r.y, this.H - r.h); }   // the canvas shrank since the last inset() call
      const el = INSET_EL * RAD, gy = this.land.standY(f.x, f.y) + 0.8;
      cam.aspect = r.w / r.h; cam.near = Math.max(2, f.dist * 0.2); cam.far = f.dist * 3 + 80; cam.updateProjectionMatrix();
      cam.position.set(f.x, gy + Math.sin(el) * f.dist, f.y + Math.cos(el) * f.dist); cam.lookAt(f.x, gy, f.y); cam.updateMatrixWorld();
      // frame: scissored clears (no draw calls), growing boxes in the frame colours, then the picture itself in the inner box
      const vy = this.H - (r.y + r.h), box = (e) => { rd.setViewport(r.x - e, vy - e, r.w + 2 * e, r.h + 2 * e); rd.setScissor(r.x - e, vy - e, r.w + 2 * e, r.h + 2 * e); };
      rd.setScissorTest(true);
      box(4); rd.setClearColor(FRAME_OUT, 1); rd.clear(true, true, true);
      box(2); rd.setClearColor(FRAME_IN, 1); rd.clear(true, true, true);
      box(0); rd.setClearColor(this.cur.haze, 1); rd.clear(true, true, true);
      if (this.fx && this.fx.pass) this.safeFx(() => this.fx.pass(cam, r.h));
      const sm = rd.shadowMap, au = sm.autoUpdate; sm.autoUpdate = false;   // the main pass has just rendered the shadow map: reuse it
      rd.render(this.scene, cam);
      sm.autoUpdate = au;
      rd.setScissorTest(false); rd.setViewport(0, 0, this.W, this.H);
      this.insetCalls = rd.info.render.calls - c0; this.insetTris = rd.info.render.triangles - k0; this.insetMs = performance.now() - t0;
    }

    dispose() {
      if (this.fx) { this.safeFx(() => this.fx.dispose()); this.fx = null; }
      this.clearWorld();
      this.blob.dispose(); this.blob.geometry.dispose(); this.blobMat.dispose(); this.texBlob.dispose();
      for (const m of [this.flame, this.smoke]) { m.dispose(); m.material.dispose(); } this.flame.geometry.dispose(); this.texFlame.dispose(); this.texSmoke.dispose();
      this.keyLight.dispose && this.keyLight.dispose();
      this.renderer.dispose();
      if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
    }
  }

  window.FurtView = FurtView;
})();
