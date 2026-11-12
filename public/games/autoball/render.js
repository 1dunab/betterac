// ===== Autoball view (three.js): stadium, cars, ball, effects =====
// Plain script; THREE is handed to the constructor (window.THREE is set by a module script).
// It draws what sim.js says and decides nothing. Cars, particles and skid marks come from core/kit3d.js.
(function (root) {
  const PARTS = 360, SKIDS = 300;
  // the camera stands still above the near side line: the phone's stick means "this way on the TV"
  const CAM = { fov: 42, x: 0, y: 62, z: 42, ax: 0, ay: 0, az: 1.5 };
  const LOOKS = {
    stadion: { skyTop: '#3f8fe0', sky: '#a9d8f5', out: '#2f3a33', grass: ['#43a355', '#3b964c'], line: '#f4fbf4', board: '#eef3f7', rail: '#2a2f38', stand: '#59616e', sun: '#fff7e8', light: 1 },
    eis: { skyTop: '#0e141f', sky: '#253247', out: '#1c2532', grass: ['#e3f2ff', '#d6eafb'], line: '#3d7fe0', board: '#ffffff', rail: '#c7332b', stand: '#414b5c', sun: '#ffffff', light: 1.05 },
    neon: { night: true, skyTop: '#03041a', sky: '#161538', out: '#0b0c1c', grass: ['#15183a', '#121433'], line: '#00f0ff', board: '#ff2bd6', rail: '#00e5ff', stand: '#1d2040', sun: '#b7c4ff', light: 0.8, hemi: ['#8f9cff', '#2a2f55'] }
  };
  const CROWD = ['#ff8a1c', '#2e8bff', '#f2f2f2', '#ffd60a', '#e04a3a', '#47c96b', '#b266ff', '#3a3f4a'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rnd = (a, b) => a + Math.random() * (b - a);

  class AutoballView {
    constructor(THREE, { width = 960, height = 600 } = {}) {
      const T = this.T = THREE;
      let renderer;
      try { renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!AutoballView.keepBuffer }); }
      catch (e) { throw new Error('WebGL nicht verfügbar: ' + e.message); }
      if (!renderer || !renderer.getContext()) throw new Error('WebGL nicht verfügbar');
      this.renderer = renderer; this.canvas = renderer.domElement;
      this.W = width; this.H = height; this.ratio = 1;
      renderer.setPixelRatio(1); renderer.setSize(width, height, false);
      this.camera = new T.PerspectiveCamera(CAM.fov, width / height, 1, 900);
      this.camera.position.set(CAM.x, CAM.y, CAM.z); this.camera.lookAt(CAM.ax, CAM.ay, CAM.az);
      this.camera.updateMatrixWorld();
      this.v3 = new T.Vector3(); this.q = new T.Quaternion(); this.m4 = new T.Matrix4(); this.col = new T.Color();
      this.scene = null; this.owned = []; this.cars = new Map();
    }

    setRatio(r) {
      r = Math.max(1, Math.min(2, r));
      if (r === this.ratio) return;
      this.ratio = r;
      this.renderer.setPixelRatio(r); this.renderer.setSize(this.W, this.H, false);
    }
    own(x) { this.owned.push(x); return x; }
    clear() {
      for (const x of this.owned) { try { x.dispose(); } catch (e) {} }
      this.owned = []; this.scene = null; this.cars = new Map(); this.fx = null; this.skids = null; this.crowd = null;
    }
    dispose() { this.clear(); try { this.renderer.dispose(); } catch (e) {} }

    lambert(color, o) { return this.own(new this.T.MeshLambertMaterial(Object.assign({ color }, o))); }
    basic(color, o) { return this.own(new this.T.MeshBasicMaterial(Object.assign({ color }, o))); }
    tex(w, h, draw) { return root.Kit3D.canvasTex(this.T, this, w, h, draw); }

    // world → HUD pixels (the HUD is W×H), for name tags
    toScreen(x, y, z) {
      const v = this.v3.set(x, y, z).project(this.camera);
      return [(v.x + 1) / 2 * this.W, (1 - v.y) / 2 * this.H];
    }

    // ---------- a match begins ----------
    // look = { arena, teams: ['#hex', '#hex'], roofOf(car) → '#hex' }
    setRound(sim, look) {
      this.clear();
      const T = this.T, A = this.A = LOOKS[look.arena] || LOOKS.stadion, C = this.C = root.AutoballSim.CONST;
      this.look = look;
      const scene = this.scene = new T.Scene();
      scene.background = new T.Color(A.sky);
      const hemi = A.hemi || [A.sky, A.out];
      this.hemiBase = 1.5 * A.light;
      this.hemi = new T.HemisphereLight(hemi[0], hemi[1], this.hemiBase);
      scene.add(this.hemi);
      const sun = new T.DirectionalLight(A.sun, 2.0 * A.light);
      sun.position.set(40, 90, 50);
      scene.add(sun);
      this.buildSky(); this.buildPitch(); this.buildBoards(); this.buildGoals(); this.buildStands(); this.buildBall(sim.state);
      this.kit = root.Kit3D.carKit(T, this, {});       // (no headlight cones: from above they are only blobs)
      this.fx = new root.Kit3D.Particles(T, this, scene, PARTS);
      this.skids = new root.Kit3D.Skids(T, this, scene, SKIDS);
      this.flash = 0; this.cheer = 0;
    }

    buildSky() {
      const T = this.T, A = this.A;
      const g = this.own(new T.SphereGeometry(700, 20, 12));
      const p = g.attributes.position, col = new Float32Array(p.count * 3);
      const lo = new T.Color(A.sky), hi = new T.Color(A.skyTop), c = new T.Color();
      for (let i = 0; i < p.count; i++) { c.copy(lo).lerp(hi, Math.pow(Math.max(0, p.getY(i) / 700), 0.6)); col.set([c.r, c.g, c.b], i * 3); }
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      this.scene.add(new T.Mesh(g, this.basic('#fff', { vertexColors: true, side: T.BackSide, depthWrite: false })));
      const ground = new T.Mesh(this.own(new T.CircleGeometry(400, 32)), this.lambert(A.out));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.2;
      this.scene.add(ground);
    }

    // the pitch is one painted plane: 10 px per metre
    buildPitch() {
      const T = this.T, A = this.A, C = this.C, K = 10, HX = C.L + C.GOAL_DEPTH + 3, HZ = C.WD + 5;
      const X = (x) => (x + HX) * K, Z = (z) => (z + HZ) * K;
      const tex = this.tex(HX * 2 * K, HZ * 2 * K, (g, w, h) => {
        g.fillStyle = A.out; g.fillRect(0, 0, w, h);
        const field = () => {            // the rounded pitch outline (arcTo: older TV browsers have no roundRect)
          const x = X(-C.L), y = Z(-C.WD), fw = C.L * 2 * K, fh = C.WD * 2 * K, r = C.CORNER * K;
          g.beginPath(); g.moveTo(x + r, y);
          g.arcTo(x + fw, y, x + fw, y + fh, r); g.arcTo(x + fw, y + fh, x, y + fh, r); g.arcTo(x, y + fh, x, y, r); g.arcTo(x, y, x + fw, y, r);
          g.closePath();
        };
        g.save(); field(); g.clip();
        for (let i = 0, x = -C.L; x < C.L; x += 8, i++) { g.fillStyle = A.grass[i % 2]; g.fillRect(X(x), 0, 8 * K + 1, h); }
        g.restore();
        // goal boxes in the colour of the team that defends them
        [0, 1].forEach(t => {
          const x0 = t === 0 ? -C.L - C.GOAL_DEPTH : C.L;
          g.fillStyle = this.look.teams[t]; g.globalAlpha = 0.55;
          g.fillRect(X(x0), Z(-C.GOAL_HALF), C.GOAL_DEPTH * K, C.GOAL_HALF * 2 * K);
          g.globalAlpha = 0.16;
          g.fillRect(X(t === 0 ? -C.L : C.L - 12), Z(-C.GOAL_HALF - 5), 12 * K, (C.GOAL_HALF + 5) * 2 * K);
          g.globalAlpha = 1;
        });
        g.strokeStyle = A.line; g.lineWidth = 4; g.lineJoin = 'round';
        if (A.night) { g.shadowColor = A.line; g.shadowBlur = 14; }
        field(); g.stroke();
        g.beginPath(); g.moveTo(X(0), Z(-C.WD)); g.lineTo(X(0), Z(C.WD)); g.stroke();
        g.beginPath(); g.arc(X(0), Z(0), 9 * K, 0, Math.PI * 2); g.stroke();
        g.strokeRect(X(-C.L), Z(-C.GOAL_HALF - 5), 12 * K, (C.GOAL_HALF + 5) * 2 * K);
        g.strokeRect(X(C.L - 12), Z(-C.GOAL_HALF - 5), 12 * K, (C.GOAL_HALF + 5) * 2 * K);
        g.fillStyle = A.line; g.beginPath(); g.arc(X(0), Z(0), 6, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
      });
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy ? this.renderer.capabilities.getMaxAnisotropy() : 1);
      const mat = A.night ? this.basic('#fff', { map: tex }) : this.lambert('#fff', { map: tex });
      const plane = new T.Mesh(this.own(new T.PlaneGeometry(HX * 2, HZ * 2)), mat);
      plane.rotation.x = -Math.PI / 2;
      this.scene.add(plane);

      // boost pads
      const bolt = this.tex(64, 64, (g) => {
        const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
        gr.addColorStop(0, '#fff7b0'); gr.addColorStop(0.6, '#ffc21c'); gr.addColorStop(1, 'rgba(255,160,0,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
        g.font = 'bold 34px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#7a4b00';
        g.fillText('⚡', 32, 35);
      });
      const padGeo = this.own(new T.CircleGeometry(C.PAD_R, 20));
      this.pads = C.PADS.map(p => {
        const m = new T.Mesh(padGeo, this.basic('#fff', { map: bolt, transparent: true, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.set(p[0], 0.06, p[1]);
        this.scene.add(m);
        return m;
      });
    }

    // the boundary as a closed loop of points; the pieces across the goal mouths are marked as gaps
    boundary() {
      const C = this.C, a = C.L - C.CORNER, b = C.WD - C.CORNER, pts = [];
      const arc = (cx, cz, from) => { for (let k = 0; k <= 8; k++) { const ang = from + Math.PI / 2 * k / 8; pts.push({ x: cx + Math.cos(ang) * C.CORNER, z: cz + Math.sin(ang) * C.CORNER }); } };
      pts.push({ x: C.L, z: -C.GOAL_HALF, gap: true }, { x: C.L, z: C.GOAL_HALF });
      arc(a, b, 0); arc(-a, b, Math.PI / 2);
      pts.push({ x: -C.L, z: C.GOAL_HALF, gap: true }, { x: -C.L, z: -C.GOAL_HALF });
      arc(-a, -b, Math.PI); arc(a, -b, Math.PI * 1.5);
      return pts;
    }

    buildBoards() {
      const T = this.T, A = this.A, pts = this.boundary(), n = pts.length;
      const strip = (y0, y1) => {
        const pos = [];
        for (let i = 0; i < n; i++) {
          const p = pts[i], q = pts[(i + 1) % n];
          if (p.gap) continue;
          pos.push(p.x, y0, p.z, q.x, y0, q.z, q.x, y1, q.z, p.x, y0, p.z, q.x, y1, q.z, p.x, y1, p.z);
        }
        const g = this.own(new T.BufferGeometry());
        g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
        g.computeVertexNormals();
        return g;
      };
      // see-through boards, so that the near one hides nothing, with a solid rail on top
      this.scene.add(new T.Mesh(strip(0, 1.9), this.basic(A.board, { transparent: true, opacity: A.night ? 0.3 : 0.38, side: T.DoubleSide, depthWrite: false })));
      this.scene.add(new T.Mesh(strip(1.9, 2.25), this.basic(A.rail, { side: T.DoubleSide })));
    }

    buildGoals() {
      const T = this.T, C = this.C, scene = this.scene;
      const net = this.tex(64, 64, (g) => {
        g.clearRect(0, 0, 64, 64);
        g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2;
        for (let i = 0; i <= 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
      });
      net.wrapS = net.wrapT = T.RepeatWrapping; net.repeat.set(4, 3);
      const netMat = this.basic('#fff', { map: net, transparent: true, side: T.DoubleSide, depthWrite: false });
      const post = this.own(new T.CylinderGeometry(0.4, 0.4, C.GOAL_H, 10)), bar = this.own(new T.CylinderGeometry(0.4, 0.4, C.GOAL_HALF * 2 + 0.8, 10));
      const back = this.own(new T.PlaneGeometry(C.GOAL_HALF * 2, C.GOAL_H)), side = this.own(new T.PlaneGeometry(C.GOAL_DEPTH, C.GOAL_H)), top = this.own(new T.PlaneGeometry(C.GOAL_DEPTH, C.GOAL_HALF * 2));
      [0, 1].forEach(t => {
        const dir = t === 0 ? -1 : 1, x = dir * C.L, frame = this.lambert(this.look.teams[t]);
        for (const sz of [-1, 1]) { const p = new T.Mesh(post, frame); p.position.set(x, C.GOAL_H / 2, sz * C.GOAL_HALF); scene.add(p); }
        const b = new T.Mesh(bar, frame); b.rotation.x = Math.PI / 2; b.position.set(x, C.GOAL_H, 0); scene.add(b);
        const bk = new T.Mesh(back, netMat); bk.rotation.y = Math.PI / 2; bk.position.set(x + dir * C.GOAL_DEPTH, C.GOAL_H / 2, 0); scene.add(bk);
        for (const sz of [-1, 1]) { const s = new T.Mesh(side, netMat); s.position.set(x + dir * C.GOAL_DEPTH / 2, C.GOAL_H / 2, sz * C.GOAL_HALF); scene.add(s); }
        const tp = new T.Mesh(top, netMat); tp.rotation.x = -Math.PI / 2; tp.position.set(x + dir * C.GOAL_DEPTH / 2, C.GOAL_H, 0); scene.add(tp);
      });
    }

    // stands on the far side and behind the goals (the camera sits where the fourth one would be), with a crowd
    buildStands() {
      const T = this.T, A = this.A, C = this.C, scene = this.scene, ROWS = 6, STEP = 2.3, RISE = 1.5;
      const steps = [], seats = [];
      const row = (r, along, fixed, len, isX) => {
        const h = RISE * (r + 1);
        steps.push(isX ? { x: 0, y: h / 2, z: fixed, sx: len, sy: h, sz: STEP } : { x: fixed, y: h / 2, z: 0, sx: STEP, sy: h, sz: len });
        for (let a = -len / 2 + 1; a < len / 2 - 0.5; a += 1.7) {
          if (Math.random() < 0.12) continue;
          seats.push(isX ? { x: a, y: h, z: fixed, c: pick(CROWD) } : { x: fixed, y: h, z: a, c: pick(CROWD) });
        }
      };
      for (let r = 0; r < ROWS; r++) {
        row(r, 0, -(C.WD + 5 + r * STEP), (C.L + 2) * 2, true);
        row(r, 0, -(C.L + C.GOAL_DEPTH + 5 + r * STEP), C.WD * 2, false);
        row(r, 0, C.L + C.GOAL_DEPTH + 5 + r * STEP, C.WD * 2, false);
      }
      const box = this.own(new T.BoxGeometry(1, 1, 1));
      const st = this.own(new T.InstancedMesh(box, this.lambert(A.stand), steps.length));
      steps.forEach((s, i) => st.setMatrixAt(i, this.m4.makeScale(s.sx, s.sy, s.sz).setPosition(s.x, s.y, s.z)));
      scene.add(st);
      const cm = this.own(new T.InstancedMesh(box, A.night ? this.basic('#fff') : this.lambert('#fff'), seats.length));
      seats.forEach((s, i) => { cm.setMatrixAt(i, this.m4.makeScale(0.9, 1.3, 0.9).setPosition(s.x, s.y + 0.65, s.z)); cm.setColorAt(i, this.col.set(s.c)); });
      cm.instanceMatrix.setUsage(T.DynamicDrawUsage);
      scene.add(cm);
      this.crowd = { mesh: cm, seats };
    }

    buildBall(st) {
      const T = this.T, C = this.C;
      const skin = this.tex(256, 128, (g) => {
        g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, 256, 128);
        g.fillStyle = '#22252d';
        for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) { g.beginPath(); g.arc((i + (r % 2) * 0.5) * 43 + 10, 18 + r * 31, 9.5, 0, 6.3); g.fill(); }
      });
      this.ball = new T.Mesh(this.own(new T.SphereGeometry(C.BALL_R, 22, 16)), this.lambert('#fff', { map: skin }));
      this.ballShadow = new T.Mesh(this.own(new T.CircleGeometry(C.BALL_R * 1.05, 16)), this.basic('#000', { transparent: true, opacity: 0.3, depthWrite: false }));
      this.ballShadow.rotation.x = -Math.PI / 2;
      // a ring on the ground in the colour of the team that touched the ball last
      this.ring = new T.Mesh(this.own(new T.RingGeometry(C.BALL_R * 1.25, C.BALL_R * 1.6, 28)), this.basic('#fff', { transparent: true, opacity: 0.85, depthWrite: false }));
      this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false;
      this.scene.add(this.ball, this.ballShadow, this.ring);
      this.bx = st.ball.x; this.bz = st.ball.z;
    }

    // a car's look changed (a bot took it over, or a player took a bot's): build it anew next frame
    forget(car) {
      const c = this.cars.get(car);
      if (c) { this.scene.remove(c.g, c.shadow); this.cars.delete(car); }
    }

    // what just happened in the sim (the events step() returns)
    event(e, st) {
      if (!this.scene) return;
      const fx = this.fx, team = this.look.teams;
      if (e.t === 'goal') {
        fx.burst(e.x, 2, e.z, 70, [team[e.team], team[e.team], '#ffffff', '#ffd60a'], 26, 1.3, 0.6);
        // confetti rains over the whole pitch
        for (let i = 0; i < 110; i++) fx.puff(rnd(-40, 40), rnd(14, 34), rnd(-24, 24), rnd(-2, 2), rnd(-2, 1), rnd(-2, 2), pick([team[e.team], '#ffffff', '#ffd60a']), rnd(1.6, 2.8), rnd(0.25, 0.45), 6);
        this.flash = 1; this.cheer = 1;
      } else if (e.t === 'kick') {
        const b = st.ball;
        if (e.power > 14) fx.burst(b.x, b.y + 1.2, b.z, 6, ['#ffffff', '#ffe9a8'], 7, 0.3, 0.2);
      } else if (e.t === 'bump') {
        const a = st.cars.find(c => c.id === e.a), b = st.cars.find(c => c.id === e.b);
        if (a && b) fx.burst((a.x + b.x) / 2, 0.9, (a.z + b.z) / 2, 5, ['#ffe9a8', '#ffffff'], 6, 0.3, 0.16);
      } else if (e.t === 'pad') {
        const c = st.cars.find(k => k.id === e.id);
        if (c) fx.burst(c.x, 1, c.z, 10, ['#ffc21c', '#fff7b0'], 7, 0.45, 0.24);
      } else if (e.t === 'drop') {
        fx.burst(0, 1, 0, 14, ['#ffffff'], 8, 0.5, 0.25);
      }
    }

    // ---------- one frame ----------
    render(st, dt) {
      if (!this.scene) return;
      const T = this.T, t = st.time, C = this.C, fx = this.fx, Kit = root.Kit3D;

      // cars (keyed by the sim's car objects: their ids change when a bot takes over)
      for (const [car, c] of this.cars) if (!st.cars.includes(car)) { this.scene.remove(c.g, c.shadow); this.cars.delete(car); }
      for (const car of st.cars) {
        let c = this.cars.get(car);
        if (!c) {
          c = Kit.makeCar(T, this.kit, this, { paint: this.look.teams[car.team], roof: this.look.roofOf(car) });
          c.skidX = c.skidZ = 0;
          this.scene.add(c.g, c.shadow); this.cars.set(car, c);
        }
        Kit.poseCar(c, { x: car.x, y: 0, z: car.z, heading: car.heading, steer: car.steer, brake: false, t }, dt);
        const dx = Math.cos(car.heading), dz = Math.sin(car.heading);
        if (car.boosting) fx.puff(car.x - dx * 1.9, 0.6, car.z - dz * 1.9, -dx * 6 + rnd(-1, 1), 1.5, -dz * 6 + rnd(-1, 1), Math.random() < 0.5 ? '#ff9f0a' : '#ffd60a', 0.32, 0.3);
        const sideways = Math.abs(car.vz * dx - car.vx * dz);
        if (sideways > 6 && Math.hypot(car.x - c.skidX, car.z - c.skidZ) > 1.2) {
          c.skidX = car.x; c.skidZ = car.z;
          const h = Math.atan2(car.vz, car.vx);
          this.skids.mark(car.x - dx * 1.1 - dz * 0.85, car.z - dz * 1.1 + dx * 0.85, h);
          this.skids.mark(car.x - dx * 1.1 + dz * 0.85, car.z - dz * 1.1 - dx * 0.85, h);
        }
      }

      // ball: it rolls the way it moves
      const b = st.ball;
      this.ball.visible = this.ballShadow.visible = b.live;
      this.ring.visible = b.live && !!b.touch;
      if (b.live) {
        const mx = b.x - this.bx, mz = b.z - this.bz, d = Math.hypot(mx, mz);
        if (d > 1e-5 && d < 5) this.ball.quaternion.premultiply(this.q.setFromAxisAngle(this.v3.set(mz / d, 0, -mx / d), d / C.BALL_R));
        this.ball.position.set(b.x, b.y + C.BALL_R, b.z);
        const sh = 1 / (1 + b.y * 0.12);
        this.ballShadow.scale.setScalar(sh); this.ballShadow.material.opacity = 0.3 * sh; this.ballShadow.position.set(b.x, 0.05, b.z);
        if (b.touch) { this.ring.material.color.set(this.look.teams[b.touch.team]); this.ring.position.set(b.x, 0.07, b.z); }
        if (Math.hypot(b.vx, b.vz) > 30 && b.touch) fx.puff(b.x, b.y + C.BALL_R, b.z, rnd(-1, 1), rnd(0, 1), rnd(-1, 1), this.look.teams[b.touch.team], 0.35, 0.4, 0);
      }
      this.bx = b.x; this.bz = b.z;

      // boost pads dim while they recharge
      this.pads.forEach((m, i) => { const ready = t >= st.pads[i].readyAt; m.material.opacity = ready ? 0.8 + 0.2 * Math.sin(t / 200 + i) : 0.18; m.rotation.z = ready ? t / 1500 : 0; });

      // a goal: the scene flashes and the crowd jumps
      this.flash = Math.max(0, this.flash - dt * 2.5);
      this.hemi.intensity = this.hemiBase + this.flash * 1.6;
      if (this.cheer > 0 && this.crowd) {
        this.cheer = Math.max(0, this.cheer - dt / 3);
        const cm = this.crowd.mesh;
        this.crowd.seats.forEach((s, i) => cm.setMatrixAt(i, this.m4.makeScale(0.9, 1.3, 0.9).setPosition(s.x, s.y + 0.65 + Math.abs(Math.sin(t / 130 + i * 1.7)) * 1.1 * this.cheer, s.z)));
        cm.instanceMatrix.needsUpdate = true;
      }

      fx.update(dt);
      this.renderer.render(this.scene, this.camera);
    }
  }

  // dev page only: headless screenshots need the drawing buffer kept after a frame
  AutoballView.keepBuffer = false;
  root.AutoballView = AutoballView;
})(typeof window !== 'undefined' ? window : globalThis);
