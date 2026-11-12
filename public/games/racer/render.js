// ===== Micro Racer view (three.js): diorama, cars, items, particles =====
// Plain script; THREE is handed to the constructor (window.THREE is set by a module script).
// It draws what sim.js says and decides nothing. The camera, too, comes from the sim.
// The car, the particles and the skid marks come from core/kit3d.js (shared with Autoball).
(function (root) {
  const PARTS = 320, SKIDS = 420, AMBIENT = 420;
  const ITEM_COLOR = { rocket: '#ff5a3c', oil: '#8a6cff', shield: '#4db8ff', bolt: '#ffe14d', magnet: '#ff4fa3' };
  const TOY_COLORS = ['#ff4d4d', '#ffb52e', '#ffe14d', '#47c96b', '#3fa3ff', '#b266ff', '#ff7ab8'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rnd = (a, b) => a + Math.random() * (b - a);

  class RacerView {
    constructor(THREE, { width = 960, height = 600 } = {}) {
      const T = this.T = THREE;
      let renderer;
      try { renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!RacerView.keepBuffer }); }
      catch (e) { throw new Error('WebGL nicht verfügbar: ' + e.message); }
      if (!renderer || !renderer.getContext()) throw new Error('WebGL nicht verfügbar');
      this.renderer = renderer; this.canvas = renderer.domElement;
      this.W = width; this.H = height; this.ratio = 1;
      renderer.setPixelRatio(1); renderer.setSize(width, height, false);
      this.camera = new T.PerspectiveCamera((root.RacerSim && root.RacerSim.CONST.FOV) || 55, width / height, 0.5, 1800);
      this.scene = null; this.owned = [];
      this.cars = {}; this.rockets = new Map(); this.drops = new Map(); this.boxes = []; this.pulse = [];
      this.fx = null; this.skids = null; this.flash = 0;
      this.col = new T.Color();
    }

    // sharper picture on big screens: ratio 1..2 (the canvas keeps its 960×600 layout size)
    setRatio(r) {
      r = Math.max(1, Math.min(2, r));
      if (r === this.ratio) return;
      this.ratio = r;
      this.renderer.setPixelRatio(r); this.renderer.setSize(this.W, this.H, false);
    }

    own(x) { this.owned.push(x); return x; }

    clear() {
      for (const x of this.owned) { try { x.dispose(); } catch (e) {} }
      this.owned = []; this.scene = null;
      this.cars = {}; this.rockets = new Map(); this.drops = new Map(); this.boxes = []; this.pulse = [];
      this.fx = null; this.skids = null; this.flash = 0;
    }

    dispose() { this.clear(); try { this.renderer.dispose(); } catch (e) {} }

    // ---------- small builders ----------
    lambert(color, o) { return this.own(new this.T.MeshLambertMaterial(Object.assign({ color }, o))); }
    basic(color, o) { return this.own(new this.T.MeshBasicMaterial(Object.assign({ color }, o))); }
    canvasTex(w, h, draw) { return root.Kit3D.canvasTex(this.T, this, w, h, draw); }
    // a mesh lying flat on the ground whose local +y points along `heading`
    flat(mesh, x, z, heading, y) {
      const g = new this.T.Group();
      mesh.rotation.x = -Math.PI / 2;
      g.add(mesh);
      g.position.set(x, y, z);
      g.rotation.y = Math.atan2(-Math.cos(heading), -Math.sin(heading));
      this.scene.add(g);
      return g;
    }
    // many copies of a few parts: one InstancedMesh per part
    // parts = [{ geo, mat, m?: Matrix4, tint? }], spots = [{ x, y?, z, yaw?, sx, sy, sz, color? }]
    instances(parts, spots) {
      const T = this.T, base = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0);
      const pos = new T.Vector3(), scl = new T.Vector3(), m = new T.Matrix4();
      for (const part of parts) {
        const im = this.own(new T.InstancedMesh(part.geo, part.mat, spots.length));
        spots.forEach((s, i) => {
          q.setFromAxisAngle(up, s.yaw || 0);
          base.compose(pos.set(s.x, s.y || 0, s.z), q, scl.set(s.sx, s.sy, s.sz));
          im.setMatrixAt(i, part.m ? m.multiplyMatrices(base, part.m) : base);
          if (part.tint) im.setColorAt(i, this.col.set(s.color || '#fff'));
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        this.scene.add(im);
      }
    }
    place(x, y, z, rx, ry, rz) {
      const T = this.T;
      return new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0)), new T.Vector3(1, 1, 1));
    }

    // ---------- a match begins: build the whole diorama ----------
    // look = { biome (from tracks.js), colors: { id: '#hex' } }
    setRound(sim, look) {
      this.clear();
      const T = this.T, B = this.biome = look.biome;
      this.sim = sim; this.track = sim.track; this.colors = look.colors || {};
      this.ROAD_W = (root.RacerSim && root.RacerSim.CONST.ROAD_W) || 9;
      const scene = this.scene = new T.Scene();
      scene.background = new T.Color(B.sky);
      scene.fog = new T.Fog(B.fog, B.night ? 170 : 260, B.night ? 540 : 620);
      const hemi = B.hemi || [B.sky, B.ground];
      this.hemiBase = 1.5 * B.light;
      this.hemi = new T.HemisphereLight(hemi[0], hemi[1], this.hemiBase);
      scene.add(this.hemi);
      const sun = new T.DirectionalLight(B.sun, 2.1 * B.light);
      sun.position.set(140, 190, 80);
      scene.add(sun);
      this.buildSky(); this.buildGround(); this.buildRoad(); this.buildStart();
      this.buildFurniture(sim.state); this.buildDeco(sim.state); this.buildKits();
    }

    buildSky() {
      const T = this.T, B = this.biome, scene = this.scene;
      const g = this.own(new T.SphereGeometry(1500, 20, 12));
      const p = g.attributes.position, col = new Float32Array(p.count * 3);
      const lo = new T.Color(B.sky), hi = new T.Color(B.skyTop), c = new T.Color();
      for (let i = 0; i < p.count; i++) {
        c.copy(lo).lerp(hi, Math.pow(Math.max(0, p.getY(i) / 1500), 0.6));
        col.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      scene.add(new T.Mesh(g, this.basic('#fff', { vertexColors: true, side: T.BackSide, fog: false, depthWrite: false })));

      if (B.night) {
        const n = 320, pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, e = rnd(0.08, 1.4);
          pos.set([Math.cos(a) * Math.cos(e) * 1400, Math.sin(e) * 1400, Math.sin(a) * Math.cos(e) * 1400], i * 3);
        }
        const sg = this.own(new T.BufferGeometry());
        sg.setAttribute('position', new T.BufferAttribute(pos, 3));
        scene.add(new T.Points(sg, this.own(new T.PointsMaterial({ color: '#dfe6ff', size: 2.2, sizeAttenuation: false, fog: false }))));
      }
      if (B.hills) {
        // far hills, already tinted towards the haze (they sit beyond the fog range)
        const c2 = new T.Color(B.hills).lerp(new T.Color(B.fog), 0.45), spots = [];
        for (let i = 0; i < 28; i++) {
          const a = i / 28 * Math.PI * 2 + rnd(-0.08, 0.08), r = rnd(470, 620), h = rnd(50, 140), w = rnd(70, 130);
          spots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: h / 2 - 3, yaw: rnd(0, 6), sx: w, sy: h, sz: w });
        }
        this.instances([{ geo: this.own(new T.ConeGeometry(1, 1, 6)), mat: this.lambert(c2, { flatShading: true, fog: false }) }], spots);
      }
      if (!B.night && !B.lava && !B.wood) {
        const spots = [];
        for (let i = 0; i < 9; i++) {
          const a = rnd(0, 6.28), r = rnd(150, 700), y = rnd(150, 230), cx = Math.cos(a) * r, cz = Math.sin(a) * r;
          for (let k = 0; k < 4; k++) spots.push({ x: cx + rnd(-40, 40), y: y + rnd(-6, 6), z: cz + rnd(-22, 22), sx: rnd(28, 55), sy: rnd(9, 15), sz: rnd(20, 36) });
        }
        this.instances([{ geo: this.own(new T.SphereGeometry(1, 8, 6)), mat: this.basic('#ffffff', { fog: false, transparent: true, opacity: 0.88 }) }], spots);
      }
    }

    buildGround() {
      const T = this.T, B = this.biome, scene = this.scene;
      let mat;
      if (B.wood) {
        // floorboards: the room's floor is the ground
        const tex = this.canvasTex(256, 256, (g) => {
          g.fillStyle = B.ground; g.fillRect(0, 0, 256, 256);
          for (let i = 0; i < 4; i++) {
            g.fillStyle = i % 2 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.05)'; g.fillRect(0, i * 64, 256, 64);
            g.fillStyle = 'rgba(70,40,10,.55)'; g.fillRect(0, i * 64, 256, 2); g.fillRect((i * 97) % 256, i * 64, 2, 64);
            g.strokeStyle = 'rgba(90,55,20,.18)';
            for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(0, i * 64 + 8 + k * 11); g.bezierCurveTo(80, i * 64 + k * 13, 170, i * 64 + 20 + k * 9, 256, i * 64 + 8 + k * 11); g.stroke(); }
          }
        });
        tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(36, 36);
        mat = this.lambert('#ffffff', { map: tex });
      } else mat = this.lambert(B.ground);
      const ground = new T.Mesh(this.own(new T.CircleGeometry(430, 48)), mat);
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.12; scene.add(ground);
      if (!B.wood) {
        const spots = [];
        for (let i = 0; i < 28; i++) {
          const a = rnd(0, 6.28), r = rnd(40, 370), s = rnd(8, 30);
          spots.push({ x: Math.cos(a) * r, y: -0.06, z: Math.sin(a) * r, sx: s, sy: 1, sz: s * rnd(0.6, 1), yaw: rnd(0, 3) });
        }
        const g = this.own(new T.CircleGeometry(1, 14)); g.rotateX(-Math.PI / 2);
        this.instances([{ geo: g, mat: this.lambert(B.ground2) }], spots);
      }
      if (B.water) {
        const water = new T.Mesh(this.own(new T.CircleGeometry(1400, 40)), this.lambert(B.water));
        water.rotation.x = -Math.PI / 2; water.position.y = -0.55; scene.add(water);
      }
    }

    // a band along the track; segFn(i) says whether the piece from sample i to i+1 exists (default: all)
    strip(center, half, y, segFn, skipCross) {
      const T = this.T, S = this.track.samples, N = S.length;
      const pos = new Float32Array(N * 6), nor = new Float32Array(N * 6), idx = [];
      for (let i = 0; i < N; i++) {
        const s = S[i];
        pos.set([s.x + s.nx * (center + half), y, s.z + s.nz * (center + half), s.x + s.nx * (center - half), y, s.z + s.nz * (center - half)], i * 6);
        nor.set([0, 1, 0, 0, 1, 0], i * 6);
        if ((segFn && !segFn(i)) || (skipCross && (s.cross || S[(i + 1) % N].cross))) continue;
        const a = i * 2, b = ((i + 1) % N) * 2;
        idx.push(a, b, a + 1, a + 1, b, b + 1);       // winding: faces up
      }
      const g = this.own(new T.BufferGeometry());
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setAttribute('normal', new T.BufferAttribute(nor, 3));
      g.setIndex(idx);
      return g;
    }

    buildRoad() {
      const T = this.T, B = this.biome, scene = this.scene, W = this.ROAD_W;
      // at night the paint glows (unlit material)
      const paint = (c) => B.night ? this.basic(c) : this.lambert(c);
      const stripe = paint(B.stripe), curb = [paint(B.curb[0]), paint(B.curb[1])];
      scene.add(new T.Mesh(this.strip(0, W / 2, 0.02), this.lambert(B.road)));
      scene.add(new T.Mesh(this.strip(0, 0.2, 0.05, (i) => (i % 14) < 7, true), stripe));
      for (const side of [1, -1]) {
        scene.add(new T.Mesh(this.strip(side * (W / 2 - 0.3), 0.09, 0.05, null, true), stripe));
        for (const k of [0, 1]) scene.add(new T.Mesh(this.strip(side * (W / 2 + 0.45), 0.45, 0.04, (i) => (Math.floor(i / 3) % 2) === k, true), curb[k]));
      }
    }

    checker(cols, rows) {
      return this.canvasTex(cols * 8, rows * 8, (g) => {
        for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); }
      });
    }

    buildStart() {
      const T = this.T, W = this.ROAD_W, s = this.track.samples[0], h = Math.atan2(s.tz, s.tx);
      const line = new T.Mesh(this.own(new T.PlaneGeometry(W, 2.6)), this.basic('#fff', { map: this.checker(10, 2) }));
      this.flat(line, s.x, s.z, h, 0.07);
      // the start arch: two posts and a chequered banner (low enough that the camera flies over it)
      const arch = new T.Group(), post = this.own(new T.BoxGeometry(0.6, 6.4, 0.6)), dark = this.lambert('#2a2d36');
      for (const side of [1, -1]) { const p = new T.Mesh(post, dark); p.position.set(0, 3.2, side * (W / 2 + 1.5)); arch.add(p); }
      const tex = this.checker(16, 2);
      const banner = new T.Mesh(this.own(new T.BoxGeometry(0.3, 1.5, W + 3.6)), this.basic('#fff', { map: tex }));
      banner.position.y = 6.3; arch.add(banner);
      arch.position.set(s.x, 0, s.z); arch.rotation.y = -h;
      this.scene.add(arch);
    }

    // ramps, boost pads, oil, item boxes, lava
    buildFurniture(st) {
      const T = this.T, scene = this.scene, W = this.ROAD_W;
      const chevron = this.canvasTex(64, 64, (g) => {
        g.fillStyle = '#0f7a3d'; g.fillRect(0, 0, 64, 64);
        g.strokeStyle = '#7dffb1'; g.lineWidth = 9; g.lineCap = 'round';
        [14, 38].forEach(y => { g.beginPath(); g.moveTo(12, y + 12); g.lineTo(32, y - 2); g.lineTo(52, y + 12); g.stroke(); });
      });
      const padGeo = this.own(new T.PlaneGeometry(2.8, 3.8)), oilGeo = this.own(new T.CircleGeometry(1.9, 18));
      const padMat = this.basic('#fff', { map: chevron, transparent: true, opacity: 0.92 });
      const oilMat = this.basic('#15151c', { transparent: true, opacity: 0.88 });
      this.pulse.push(padMat);
      // wedge: flat in front, 1.5 high at the take-off edge (local +x = direction of travel)
      const L = 4.2, H = 1.5, hw = (W / 2 - 0.4) / 2;
      const rampGeo = this.own(new T.BufferGeometry());
      rampGeo.setAttribute('position', new T.BufferAttribute(new Float32Array([
        -L, 0, -hw, -L, 0, hw, 0, H, hw, -L, 0, -hw, 0, H, hw, 0, H, -hw,       // slope
        0, 0, -hw, 0, H, hw, 0, 0, hw, 0, 0, -hw, 0, H, -hw, 0, H, hw,          // back
        -L, 0, -hw, 0, H, -hw, 0, 0, -hw, -L, 0, hw, 0, 0, hw, 0, H, hw         // sides
      ]), 3));
      rampGeo.computeVertexNormals();
      const rampMat = this.lambert('#ff9f0a'), arrowMat = this.basic('#fff', { map: chevron });
      const arrowGeo = this.own(new T.PlaneGeometry(hw * 1.5, 2.4));
      // the arrow lies on the slope: its up-edge points up the ramp, its normal away from the slope
      const cl = L / Math.hypot(L, H), sl = H / Math.hypot(L, H);
      const onSlope = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(
        new T.Vector3(0, 0, 1), new T.Vector3(cl, sl, 0), new T.Vector3(-sl, cl, 0)));
      for (const f of st.features) {
        if (f.kind === 'ramp') {
          const g = new T.Group(), m = new T.Mesh(rampGeo, rampMat), a = new T.Mesh(arrowGeo, arrowMat);
          a.quaternion.copy(onSlope);
          a.position.set(-L / 2 - sl * 0.05, H / 2 + cl * 0.05, 0);
          g.add(m, a); g.position.set(f.x, 0, f.z); g.rotation.y = -f.heading;
          scene.add(g);
        } else if (f.kind === 'boost') {
          this.flat(new T.Mesh(padGeo, padMat), f.x, f.z, f.heading, 0.08);
        } else {
          const m = new T.Mesh(oilGeo, oilMat); m.scale.x = 1.35;
          this.flat(m, f.x, f.z, f.heading, 0.07);
        }
      }

      // item boxes: a spinning "?" cube
      const qTex = this.canvasTex(64, 64, (g) => {
        const gr = g.createLinearGradient(0, 0, 64, 64);
        gr.addColorStop(0, '#ff5fa2'); gr.addColorStop(0.5, '#ffd84d'); gr.addColorStop(1, '#4dd2ff');
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
        g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, 59, 59);
        g.fillStyle = '#fff'; g.font = 'bold 50px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 4;
        g.fillText('?', 32, 36);
      });
      const boxGeo = this.own(new T.BoxGeometry(1.5, 1.5, 1.5)), boxMat = this.basic('#fff', { map: qTex });
      this.boxes = st.boxes.map(b => {
        const m = new T.Mesh(boxGeo, boxMat);
        m.position.set(b.x, 1.4, b.z); scene.add(m);
        return m;
      });

      // lava: a glowing pool with a dark crust
      if (st.lava.length) {
        const lavaTex = this.canvasTex(128, 128, (g) => {
          const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
          gr.addColorStop(0, '#fff2a8'); gr.addColorStop(0.35, '#ffb02e'); gr.addColorStop(0.8, '#ff5a14'); gr.addColorStop(1, '#8a1f08');
          g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
          g.fillStyle = 'rgba(90,20,5,.5)';
          for (let i = 0; i < 16; i++) { g.beginPath(); g.ellipse(rnd(10, 118), rnd(10, 118), rnd(3, 10), rnd(2, 5), rnd(0, 3), 0, 6.3); g.fill(); }
        });
        const circ = this.own(new T.CircleGeometry(1, 22)), lavaMat = this.basic('#fff', { map: lavaTex, fog: false, transparent: true }), rim = this.basic('#191112');
        this.pulse.push(lavaMat);
        for (const l of st.lava) {
          const a = new T.Mesh(circ, rim); a.rotation.x = -Math.PI / 2; a.scale.setScalar(l.r + 0.7); a.position.set(l.x, 0.03, l.z);
          const b = new T.Mesh(circ, lavaMat); b.rotation.x = -Math.PI / 2; b.scale.setScalar(l.r); b.position.set(l.x, 0.06, l.z);
          scene.add(a, b);
        }
      }
    }

    // ---------- scenery ----------
    // a free spot off the road: margin = metres from the road edge, r0..r1 = distance from the middle of the map
    spot(st, margin, r0, r1) {
      for (let tries = 0; tries < 14; tries++) {
        const a = rnd(0, 6.283), r = rnd(r0, r1), x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (this.track.dist(x, z) < this.ROAD_W / 2 + margin) continue;
        if (st.lava.some(l => Math.hypot(l.x - x, l.z - z) < l.r + margin)) continue;
        return { x, z };
      }
      return null;
    }

    buildDeco(st) {
      const T = this.T, flat = { flatShading: true };
      const cyl = (a, b, h, n) => this.own(new T.CylinderGeometry(a, b, h, n));
      const cone = (r, h, n) => this.own(new T.ConeGeometry(r, h, n));
      const box1 = () => { const g = this.own(new T.BoxGeometry(1, 1, 1)); g.translate(0, 0.5, 0); return g; };
      const scatter = (parts, n, margin, r0, r1, each) => {
        const spots = [];
        for (let i = 0; i < n; i++) { const p = this.spot(st, margin, r0, r1); if (p) spots.push(Object.assign(p, { yaw: rnd(0, 6.283) }, each())); }
        this.instances(parts, spots);
      };
      const uni = (a, b) => () => { const s = rnd(a, b); return { sx: s, sy: s, sz: s }; };

      for (const d of this.biome.deco) {
        if (d.kind === 'cactus') {
          const mat = this.lambert(d.c, flat);
          scatter([
            { geo: cyl(0.9, 1.1, 6.5, 7), mat, m: this.place(0, 3.2, 0) },
            { geo: cyl(0.55, 0.6, 3, 6), mat, m: this.place(1.5, 4.2, 0, 0, 0, -0.5) },
            { geo: cyl(0.5, 0.55, 2.4, 6), mat, m: this.place(-1.35, 3.1, 0, 0, 0, 0.55) }
          ], d.n, 6, 25, 325, uni(0.7, 1.6));
        } else if (d.kind === 'fir') {
          const mat = this.lambert(d.c, flat), snow = this.lambert('#f4f9ff', flat), parts = [
            { geo: cyl(0.5, 0.6, 2, 6), mat: this.lambert('#7a5230'), m: this.place(0, 1, 0) }];
          [[3.6, 2.6], [2.9, 4.4], [2.1, 6]].forEach(([r, y]) => {
            parts.push({ geo: cone(r, 3.4, 8), mat, m: this.place(0, y, 0) });
            parts.push({ geo: cone(r * 0.65, 1.3, 8), mat: snow, m: this.place(0, y + 1.15, 0) });
          });
          scatter(parts, d.n, 6, 25, 325, uni(0.7, 1.6));
        } else if (d.kind === 'palm') {
          const mat = this.lambert(d.c, flat), leaf = cone(0.8, 4.6, 4), parts = [
            { geo: cyl(0.45, 0.7, 7, 6), mat: this.lambert('#9c6b3f'), m: this.place(0, 3.5, 0, 0, 0, 0.12) }];
          for (let i = 0; i < 6; i++) {
            const a = i / 6 * Math.PI * 2;
            parts.push({ geo: leaf, mat, m: this.place(Math.cos(a) * 1.7 + 0.8, 7.1, Math.sin(a) * 1.7, Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15) });
          }
          scatter(parts, d.n, 6, 25, 325, uni(0.7, 1.6));
        } else if (d.kind === 'rock') {
          scatter([{ geo: this.own(new T.DodecahedronGeometry(1, 0)), mat: this.lambert(d.c, flat), m: this.place(0, 0.45, 0, 0.6, 0, 0.4) }],
            d.n, 6, 25, 325, () => ({ sx: rnd(1.6, 3.4), sy: rnd(1.3, 2.8), sz: rnd(1.6, 3.4) }));
        } else if (d.kind === 'deadtree') {
          const mat = this.lambert(d.c, flat);
          scatter([
            { geo: cyl(0.22, 0.5, 6, 5), mat, m: this.place(0, 3, 0) },
            { geo: cyl(0.1, 0.2, 2.8, 4), mat, m: this.place(0.9, 4.6, 0, 0, 0, -0.9) },
            { geo: cyl(0.1, 0.18, 2.2, 4), mat, m: this.place(-0.7, 3.8, 0.3, 0.3, 0, 0.8) }
          ], d.n, 6, 25, 325, uni(0.8, 1.5));
        } else if (d.kind === 'tower') {
          // the skyline stands well back from the road: the camera must never fly through a wall
          const win = this.canvasTex(64, 128, (g) => {
            g.fillStyle = '#0b0d1e'; g.fillRect(0, 0, 64, 128);
            for (let y = 0; y < 16; y++) for (let x = 0; x < 6; x++) {
              if (Math.random() < 0.45) continue;
              g.fillStyle = pick(['#ffd97a', '#ffd97a', '#7ae7ff', '#ff7adf', '#fff3c4']);
              g.fillRect(4 + x * 10, 4 + y * 8, 6, 4);
            }
          });
          scatter([{ geo: box1(), mat: this.basic('#fff', { map: win }) }], d.n, 42, 60, 400,
            () => ({ yaw: pick([0, Math.PI / 2]), sx: rnd(12, 24), sy: rnd(18, 70), sz: rnd(12, 24) }));
        } else if (d.kind === 'lamp') {
          // street lamps stand along the road, alternating sides
          const S = this.track.samples, N = S.length, spots = [], off = this.ROAD_W / 2 + 2.4;
          const step = Math.round(N / d.n);
          for (let i = 0, k = 0; i < N - step / 2; i += step, k++) {
            const s = S[i], side = k % 2 ? 1 : -1;
            if (s.cross) continue;
            spots.push({ x: s.x + s.nx * side * off, z: s.z + s.nz * side * off, sx: 1, sy: 1, sz: 1 });
          }
          const glow = this.canvasTex(64, 64, (g) => {
            const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
            gr.addColorStop(0, 'rgba(255,225,150,.55)'); gr.addColorStop(1, 'rgba(255,225,150,0)');
            g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
          });
          const disc = this.own(new T.CircleGeometry(6, 18)); disc.rotateX(-Math.PI / 2);
          this.instances([
            { geo: cyl(0.12, 0.16, 5.5, 5), mat: this.lambert('#3a3f55'), m: this.place(0, 2.75, 0) },
            { geo: this.own(new T.SphereGeometry(0.45, 8, 6)), mat: this.basic('#ffe9a8'), m: this.place(0, 5.6, 0) },
            { geo: disc, mat: this.basic('#fff', { map: glow, transparent: true, depthWrite: false, blending: T.AdditiveBlending }), m: this.place(0, 0.09, 0) }
          ], spots);
        } else if (d.kind === 'block') {
          scatter([{ geo: box1(), mat: this.lambert('#fff'), tint: true }], d.n, 7, 25, 330,
            () => { const s = rnd(2.6, 5.5); return { sx: s, sy: s, sz: s, color: pick(TOY_COLORS) }; });
        } else if (d.kind === 'pencil') {
          const shaft = cyl(0.9, 0.9, 20, 6), tip = cone(0.9, 2.6, 6), lead = cone(0.32, 0.95, 6);
          scatter([
            { geo: shaft, mat: this.lambert('#fff'), tint: true, m: this.place(0, 0.9, 0, 0, 0, Math.PI / 2) },
            { geo: tip, mat: this.lambert('#e8c79a'), m: this.place(-11.3, 0.9, 0, 0, 0, Math.PI / 2) },
            { geo: lead, mat: this.lambert('#2b2b33'), m: this.place(-12.15, 0.9, 0, 0, 0, Math.PI / 2) }
          ], d.n, 16, 40, 330, () => ({ sx: 1, sy: 1, sz: 1, color: pick(TOY_COLORS) }));
        } else if (d.kind === 'ball') {
          scatter([{ geo: this.own(new T.SphereGeometry(1, 14, 10)), mat: this.lambert('#fff'), tint: true, m: this.place(0, 1, 0) }], d.n, 8, 25, 330,
            () => { const s = rnd(1.8, 3.6); return { sx: s, sy: s, sz: s, color: pick(TOY_COLORS) }; });
        } else if (d.kind === 'die') {
          const dots = this.canvasTex(64, 64, (g) => {
            g.fillStyle = '#fafafa'; g.fillRect(0, 0, 64, 64);
            g.strokeStyle = '#d0d0d8'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 61, 61);
            g.fillStyle = '#22242c';
            [[16, 16], [48, 16], [32, 32], [16, 48], [48, 48]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 6, 0, 6.3); g.fill(); });
          });
          scatter([{ geo: box1(), mat: this.lambert('#fff', { map: dots }) }], d.n, 8, 25, 330, uni(3, 4.2));
        }
      }
    }

    // ---------- shared parts for cars, rockets, particles ----------
    buildKits() {
      const T = this.T, scene = this.scene, Kit = root.Kit3D;
      this.kit = Object.assign(Kit.carKit(T, this, { night: this.biome.night }), {
        beam: this.own(new T.BoxGeometry(0.16, 0.16, 1)),
        rocketBody: this.own(new T.CylinderGeometry(0.28, 0.28, 1.5, 8)), rocketNose: this.own(new T.ConeGeometry(0.3, 0.6, 8)),
        rocketFin: this.own(new T.BoxGeometry(0.5, 0.06, 0.9)),
        white: this.lambert('#f2f2f2'), red: this.lambert('#ff3b30'),
        drop: this.own(new T.CircleGeometry(1.9, 16)), dropMat: this.basic('#241a3a', { transparent: true, opacity: 0.9 })
      });
      this.kit.rocketBody.rotateZ(-Math.PI / 2); this.kit.rocketNose.rotateZ(-Math.PI / 2);
      this.fx = new Kit.Particles(T, this, scene, PARTS);
      this.skids = new Kit.Skids(T, this, scene, SKIDS);

      // weather: snowflakes fall, embers rise (a box of points that travels with the camera)
      this.weather = null;
      const amb = this.biome.ambient;
      if (amb) {
        const pos = new Float32Array(AMBIENT * 3);
        for (let i = 0; i < AMBIENT; i++) pos.set([rnd(-70, 70), rnd(0, 45), rnd(-70, 70)], i * 3);
        const g = this.own(new T.BufferGeometry());
        g.setAttribute('position', new T.BufferAttribute(pos, 3));
        const dot = this.canvasTex(32, 32, (c) => { c.fillStyle = '#fff'; c.beginPath(); c.arc(16, 16, 14, 0, 6.3); c.fill(); });
        const pts = new T.Points(g, this.own(new T.PointsMaterial({ color: amb === 'snow' ? '#ffffff' : '#ffb14d', size: amb === 'snow' ? 0.55 : 0.4,
          map: dot, alphaTest: 0.5, transparent: true, opacity: 0.9, fog: false })));
        pts.frustumCulled = false;
        scene.add(pts);
        this.weather = { pos, g, vy: amb === 'snow' ? -9 : 5 };
      }
    }

    makeCar(id) {
      const T = this.T, c = root.Kit3D.makeCar(T, this.kit, this, { paint: this.colors[id] });
      c.beam = new T.Mesh(this.kit.beam, this.basic(ITEM_COLOR.magnet, { transparent: true, opacity: 0.7 }));
      c.beam.visible = false;
      c.skidX = 0; c.skidZ = 0;
      this.scene.add(c.g, c.shadow, c.beam);
      return this.cars[id] = c;
    }

    puff(...a) { this.fx.puff(...a); }
    burst(...a) { this.fx.burst(...a); }
    skid(x, z, heading) { this.skids.mark(x, z, heading); }

    // what just happened in the sim (the events step() returns)
    event(e, st) {
      if (!this.scene) return;
      const r = e.id != null && st.racers[e.id];
      if (e.t === 'out') {
        this.burst(e.x, 1, e.z, 30, e.why === 'lava' ? ['#ff5a14', '#ffb02e', '#fff2a8'] : ['#ffb347', '#ffd60a', '#8a8f9a', '#ffffff'], 14, 0.9, 0.55);
      } else if (e.t === 'land' && r) {
        this.burst(r.x, 0.3, r.z, 7, [this.biome.ground2], 5, 0.45, 0.32);
      } else if ((e.t === 'pickup' || e.t === 'box') && r) {
        this.burst(r.x, 1.4, r.z, 12, ['#ff5fa2', '#ffd84d', '#4dd2ff', '#ffffff'], 7, 0.5, 0.26);
      } else if (e.t === 'spin' && r) {
        this.burst(r.x, 1, r.z, 14, ['#ff5a3c', '#ffd60a', '#555b66'], 9, 0.7, 0.4);
      } else if (e.t === 'boom' || e.t === 'fizz') {
        this.burst(e.x, 1, e.z, e.t === 'boom' ? 18 : 6, ['#ff5a3c', '#ffb347', '#cfcfcf'], e.t === 'boom' ? 11 : 4, 0.6, 0.38);
      } else if (e.t === 'block' && r) {
        this.burst(r.x, 1.2, r.z, 12, ['#6ad6ff', '#ffffff'], 8, 0.45, 0.26);
      } else if (e.t === 'bump') {
        const a = st.racers[e.a], b = st.racers[e.b];
        if (a && b) this.burst((a.x + b.x) / 2, 0.9, (a.z + b.z) / 2, 5, ['#ffe9a8', '#ffffff'], 6, 0.3, 0.16);
      } else if (e.t === 'slip' && r) {
        this.burst(r.x, 0.4, r.z, 6, ['#15151c', '#3a3a48'], 5, 0.5, 0.3);
      } else if (e.t === 'use' && e.item === 'bolt') {
        this.flash = 1;
      }
    }

    // ---------- one frame ----------
    render(st, dt) {
      if (!this.scene) return;
      const T = this.T, t = st.time, K = this.kit, C = (root.RacerSim && root.RacerSim.CONST) || {};

      // cars
      for (const id in this.cars) if (!st.racers[id]) { const c = this.cars[id]; this.scene.remove(c.g, c.shadow, c.beam); delete this.cars[id]; }
      for (const id of st.order) {
        const r = st.racers[id];
        if (!r) continue;
        const c = this.cars[id] || this.makeCar(id);
        c.g.visible = c.shadow.visible = r.alive;
        c.beam.visible = false;
        if (!r.alive) continue;
        root.Kit3D.poseCar(c, { x: r.x, y: r.y, z: r.z, heading: r.heading, steer: r.steer, brake: r.brake, vy: r.vy, t,
          spin: t < r.spinUntil ? 1 - (r.spinUntil - t) / (C.SPIN_MS || 1000) : 0, small: t < r.slowUntil, shield: t < r.shieldUntil }, dt);
        // magnet: a beam to the car it pulls towards
        const tg = t < r.magnetUntil && st.racers[r.magnetTo];
        if (tg && tg.alive) {
          c.beam.visible = true;
          c.beam.position.set((r.x + tg.x) / 2, 1, (r.z + tg.z) / 2);
          c.beam.lookAt(tg.x, 1, tg.z);
          c.beam.scale.z = Math.hypot(tg.x - r.x, tg.z - r.z);
        }
        this.exhaust(r, c, t);
      }

      // item boxes, pads and lava breathe
      this.boxes.forEach((m, i) => {
        const b = st.boxes[i], k = b ? Math.max(0, Math.min(1, (t - b.readyAt) / 300)) : 0;
        m.visible = k > 0;
        m.scale.setScalar(k); m.rotation.y = t / 500 + i; m.rotation.x = 0.35;
        m.position.y = 1.45 + Math.sin(t / 320 + i) * 0.22;
      });
      this.pulse.forEach((m, i) => { m.opacity = 0.82 + 0.16 * Math.sin(t / 160 + i); });

      // rockets and dropped oil come and go with the sim's lists
      this.sync(this.rockets, st.rockets, (k) => {
        const g = new T.Group(), body = new T.Mesh(K.rocketBody, K.white), nose = new T.Mesh(K.rocketNose, K.red), fin = new T.Mesh(K.rocketFin, K.red);
        nose.position.x = 1.05; fin.position.x = -0.6; g.add(body, nose, fin);
        return g;
      }, (g, k) => {
        g.position.set(k.x, 0.95, k.z); g.rotation.y = -k.heading;
        const cx = Math.cos(k.heading), cz = Math.sin(k.heading);
        this.puff(k.x - cx * 1.1, 0.95, k.z - cz * 1.1, -cx * 5 + rnd(-1, 1), rnd(0, 1.5), -cz * 5 + rnd(-1, 1), pick(['#ff9f0a', '#ffd60a', '#d8d8d8']), 0.3, 0.28, 0);
      });
      this.sync(this.drops, st.drops, () => { const m = new T.Mesh(K.drop, K.dropMat); m.rotation.x = -Math.PI / 2; return m; },
        (m, d) => { m.position.set(d.x, 0.075, d.z); });

      this.fx.update(dt);
      this.updateWeather(st, dt);

      // lightning: the whole scene flashes
      this.flash = Math.max(0, this.flash - dt * 3);
      this.hemi.intensity = this.hemiBase + this.flash * 2.5;

      const cam = st.cam;
      this.camera.position.set(cam.x, cam.y, cam.z);
      this.camera.lookAt(cam.ax, cam.ay, cam.az);
      this.renderer.render(this.scene, this.camera);
    }

    // keep a Map of meshes in step with a sim list (entries carry a unique n)
    sync(map, list, make, update) {
      const seen = new Set();
      for (const k of list) {
        seen.add(k.n);
        let m = map.get(k.n);
        if (!m) { m = make(k); map.set(k.n, m); this.scene.add(m); }
        update(m, k);
      }
      for (const [n, m] of map) if (!seen.has(n)) { this.scene.remove(m); map.delete(n); }
    }

    // flames, dust, tyre smoke, skid marks
    exhaust(r, c, t) {
      const dx = Math.cos(r.heading), dz = Math.sin(r.heading), ground = r.y <= 0;
      if (t < r.nitroUntil || t < r.boostUntil) {
        this.puff(r.x - dx * 1.9, r.y + 0.6, r.z - dz * 1.9, -dx * 6 + rnd(-1, 1), 1.5, -dz * 6 + rnd(-1, 1), Math.random() < 0.5 ? '#ff9f0a' : '#ffd60a', 0.32, 0.3);
      } else if (t < r.magnetUntil && Math.random() < 0.5) {
        this.puff(r.x - dx * 1.7, r.y + 0.6, r.z - dz * 1.7, -dx * 3, 1, -dz * 3, ITEM_COLOR.magnet, 0.3, 0.2);
      }
      if (ground && r.offroad && r.speed > 8 && Math.random() < 0.65) {
        this.puff(r.x - dx * 1.4, 0.25, r.z - dz * 1.4, rnd(-1.5, 1.5), 2.2, rnd(-1.5, 1.5), this.biome.ground2, 0.48, 0.34);
      }
      if (r.draft > 0.6 && Math.random() < 0.5) {
        this.puff(r.x + dx * 1.5 - dz * rnd(-1, 1), 0.9, r.z + dz * 1.5 + dx * rnd(-1, 1), -dx * 14, 0, -dz * 14, '#ffffff', 0.22, 0.09, 0);
      }
      if (t < r.slowUntil && Math.random() < 0.3) this.puff(r.x + rnd(-1, 1), 1.6, r.z + rnd(-1, 1), 0, 2, 0, ITEM_COLOR.bolt, 0.3, 0.14, 0);
      // sliding sideways, braking hard or spinning leaves rubber on the road
      const sideways = Math.abs(r.vz * dx - r.vx * dz);
      const sliding = ground && !r.offroad && r.speed > 6 && (sideways > 5.5 || (r.brake && r.speed > 9) || t < r.spinUntil || t < r.oilUntil);
      if (sliding) {
        if (Math.hypot(r.x - c.skidX, r.z - c.skidZ) > 1.2) {
          c.skidX = r.x; c.skidZ = r.z;
          const h = Math.atan2(r.vz, r.vx);
          this.skid(r.x - dx * 1.1 - dz * 0.85, r.z - dz * 1.1 + dx * 0.85, h);
          this.skid(r.x - dx * 1.1 + dz * 0.85, r.z - dz * 1.1 - dx * 0.85, h);
        }
        if (Math.random() < 0.5) this.puff(r.x - dx * 1.2, 0.2, r.z - dz * 1.2, rnd(-1.2, 1.2), 1.6, rnd(-1.2, 1.2), '#d4d4d4', 0.38, 0.24);
      }
    }

    updateWeather(st, dt) {
      const w = this.weather;
      if (!w) return;
      const cx = st.cam.ax, cz = st.cam.az, pos = w.pos;
      for (let i = 0; i < AMBIENT; i++) {
        const k = i * 3;
        let x = pos[k] + Math.sin(i + st.time / 900) * dt * 1.5, y = pos[k + 1] + w.vy * dt * (0.6 + (i % 5) * 0.2), z = pos[k + 2];
        if (y < 0) y += 45; else if (y > 45) y -= 45;
        if (x - cx > 70) x -= 140; else if (x - cx < -70) x += 140;
        if (z - cz > 70) z -= 140; else if (z - cz < -70) z += 140;
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      }
      w.g.attributes.position.needsUpdate = true;
    }
  }

  // dev page only: headless screenshots need the drawing buffer kept after a frame
  RacerView.keepBuffer = false;
  root.RacerView = RacerView;
})(typeof window !== 'undefined' ? window : globalThis);
