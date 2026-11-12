// ===== Kit3D: shared three.js pieces for the car games (Micro Racer, Autoball) =====
// Plain script, no three.js import: THREE is handed in. Nothing here knows any game's rules.
//   carKit / makeCar / poseCar   the low-poly car
//   Particles, Skids             one InstancedMesh each
//   Stage                        a WebGL canvas with a 2D HUD canvas on top, in place of the shell canvas
// `bin` is whatever collects disposables: any object with own(x) → x.
(function (root) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rnd = (a, b) => a + Math.random() * (b - a);

  function canvasTex(T, bin, w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = bin.own(new T.CanvasTexture(c));
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  // ---------- the car ----------
  // geometry and materials every car of a scene shares. o = { night }
  function carKit(T, bin, o) {
    const night = !!(o && o.night);
    const lambert = (c) => bin.own(new T.MeshLambertMaterial({ color: c }));
    const side = (pts, depth) => {
      const sh = new T.Shape();
      pts.forEach(([x, y], i) => i ? sh.lineTo(x, y) : sh.moveTo(x, y));
      const g = bin.own(new T.ExtrudeGeometry(sh, { depth, bevelEnabled: false }));
      g.translate(0, 0, -depth / 2);
      return g;
    };
    const wheel = bin.own(new T.CylinderGeometry(0.44, 0.44, 0.36, 12)); wheel.rotateX(Math.PI / 2);
    const hub = bin.own(new T.CylinderGeometry(0.2, 0.2, 0.38, 8)); hub.rotateX(Math.PI / 2);
    const glowTex = canvasTex(T, bin, 64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,244,200,.7)'); gr.addColorStop(1, 'rgba(255,244,200,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    });
    return {
      night,
      body: side([[-1.62, 0.3], [1.6, 0.3], [1.68, 0.62], [0.78, 0.8], [-1.15, 0.86], [-1.64, 0.82]], 1.62),
      cabin: side([[0.74, 0.79], [0.3, 1.22], [-0.66, 1.25], [-1.1, 0.85]], 1.36),
      roof: bin.own(new T.BoxGeometry(1.02, 0.07, 1.3)),
      wing: bin.own(new T.BoxGeometry(0.4, 0.1, 1.86)), post: bin.own(new T.BoxGeometry(0.12, 0.42, 0.12)),
      lamp: bin.own(new T.BoxGeometry(0.1, 0.16, 0.34)), wheel, hub,
      dark: lambert('#1c1f26'), glass: lambert(night ? '#2a3a66' : '#bfe0ff'), chrome: lambert('#cfd4dc'),
      head: bin.own(new T.MeshBasicMaterial({ color: '#fff6c8' })),
      shadow: bin.own(new T.CircleGeometry(2.0, 14)),
      shield: bin.own(new T.SphereGeometry(2.5, 16, 10)),
      glow: bin.own(new T.PlaneGeometry(7, 5)),
      glowMat: bin.own(new T.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending }))
    };
  }

  // one car. o = { paint, roof (default: paint) } → { g, shadow, ... }; the caller adds g and shadow to its scene.
  // Local axes: +x forward, +y up, +z the car's right.
  function makeCar(T, K, bin, o) {
    const paint = bin.own(new T.MeshLambertMaterial({ color: o.paint || '#999' }));
    const top = o.roof ? bin.own(new T.MeshLambertMaterial({ color: o.roof })) : paint;
    const g = new T.Group(), tilt = new T.Group();
    g.add(tilt);
    const add = (geo, mat, x, y, z, to) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); (to || tilt).add(m); return m; };
    add(K.body, paint, 0, 0, 0); add(K.cabin, K.glass, 0, 0, 0); add(K.roof, top, -0.18, 1.27, 0);
    add(K.wing, top, -1.5, 1.32, 0); add(K.post, K.dark, -1.45, 1.06, 0.55); add(K.post, K.dark, -1.45, 1.06, -0.55);
    add(K.lamp, K.head, 1.66, 0.62, 0.52); add(K.lamp, K.head, 1.66, 0.62, -0.52);
    const tail = bin.own(new T.MeshBasicMaterial({ color: '#7a0c0c' }));
    add(K.lamp, tail, -1.64, 0.7, 0.52); add(K.lamp, tail, -1.64, 0.7, -0.52);
    const front = [];
    [[1.05, 0.9, true], [1.05, -0.9, true], [-1.1, 0.9, false], [-1.1, -0.9, false]].forEach(([x, z, steer]) => {
      const piv = new T.Group(); piv.position.set(x, 0.44, z); tilt.add(piv);
      add(K.wheel, K.dark, 0, 0, 0, piv); add(K.hub, K.chrome, 0, 0, 0, piv);
      if (steer) front.push(piv);
    });
    const shield = add(K.shield, bin.own(new T.MeshBasicMaterial({ color: '#6ad6ff', transparent: true, opacity: 0.26, depthWrite: false })), 0, 1, 0, g);
    shield.visible = false;
    if (K.night) { const gl = add(K.glow, K.glowMat, 5, 0.1, 0, g); gl.rotation.set(-Math.PI / 2, 0, 0); }
    const shadow = new T.Mesh(K.shadow, bin.own(new T.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false })));
    shadow.rotation.x = -Math.PI / 2;
    return { g, tilt, front, tail, shield, shadow, scale: 1 };
  }

  // put a car where the sim says. p = { x, y, z, heading, steer, brake, vy, spin (0..1 through a spin-out), small, shield, t (ms) }
  function poseCar(c, p, dt) {
    const y = p.y || 0;
    c.g.position.set(p.x, y, p.z);
    c.g.rotation.y = -p.heading;
    c.tilt.rotation.set(-(p.steer || 0) * 0.08, p.spin ? -p.spin * Math.PI * 4 : 0,
      y > 0 ? Math.max(-0.28, Math.min(0.28, (p.vy || 0) * 0.02)) : (p.brake ? -0.05 : 0));
    c.scale += ((p.small ? 0.6 : 1) - c.scale) * Math.min(1, dt * 8);
    c.tilt.scale.setScalar(c.scale);
    c.front.forEach(w => { w.rotation.y = -(p.steer || 0) * 0.5; });
    c.tail.color.set(p.brake ? '#ff2a2a' : '#7a0c0c');
    c.shield.visible = !!p.shield;
    if (p.shield) c.shield.scale.setScalar(1 + Math.sin((p.t || 0) / 90) * 0.05);
    // the blob shadow stays on the ground and shrinks under a jumping car
    const sh = 1 / (1 + y * 0.14);
    c.shadow.scale.setScalar(sh * c.scale); c.shadow.material.opacity = 0.28 * sh;
    c.shadow.position.set(p.x, 0.04, p.z);
  }

  // ---------- particles: little spheres that fly, fall and shrink away ----------
  class Particles {
    constructor(T, bin, scene, cap) {
      this.cap = cap || 320; this.list = [];
      this.m4 = new T.Matrix4(); this.col = new T.Color();
      const pm = this.mesh = bin.own(new T.InstancedMesh(bin.own(new T.SphereGeometry(1, 6, 5)),
        bin.own(new T.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.9 })), this.cap));
      pm.instanceMatrix.setUsage(T.DynamicDrawUsage); pm.setColorAt(0, this.col.set('#fff')); pm.count = 0; pm.frustumCulled = false;
      scene.add(pm);
    }
    puff(x, y, z, vx, vy, vz, color, life, size, grav) {
      if (this.list.length >= this.cap) return;
      this.list.push({ x, y, z, vx, vy, vz, color, life, size, age: 0, grav: grav == null ? 9 : grav });
    }
    burst(x, y, z, n, colors, speed, life, size) {
      for (let i = 0; i < n; i++) {
        const a = rnd(0, 6.283), s = rnd(0.3, 1) * speed;
        this.puff(x, y, z, Math.cos(a) * s, rnd(0.3, 1) * speed * 0.8, Math.sin(a) * s, pick(colors), rnd(0.6, 1) * life, rnd(0.7, 1.2) * size);
      }
    }
    update(dt) {
      const pm = this.mesh, P = this.list;
      let n = 0;
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        p.age += dt;
        if (p.age >= p.life) continue;
        p.vy -= p.grav * dt;
        p.x += p.vx * dt; p.y = Math.max(0.1, p.y + p.vy * dt); p.z += p.vz * dt;
        const s = p.size * (1 - p.age / p.life * 0.85);
        pm.setMatrixAt(n, this.m4.makeScale(s, s, s).setPosition(p.x, p.y, p.z));
        pm.setColorAt(n, this.col.set(p.color));
        P[n++] = p;
      }
      P.length = n;
      pm.count = n;
      pm.instanceMatrix.needsUpdate = true;
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
    }
  }

  // ---------- skid marks: a ring buffer of dark dashes on the ground ----------
  class Skids {
    constructor(T, bin, scene, cap) {
      this.cap = cap || 420; this.n = 0; this.m4 = new T.Matrix4();
      const g = bin.own(new T.PlaneGeometry(0.34, 1.7)); g.rotateX(-Math.PI / 2);
      const sk = this.mesh = bin.own(new T.InstancedMesh(g, bin.own(new T.MeshBasicMaterial({ color: '#101014', transparent: true, opacity: 0.22, depthWrite: false })), this.cap));
      sk.instanceMatrix.setUsage(T.DynamicDrawUsage); sk.count = 0; sk.frustumCulled = false;
      scene.add(sk);
    }
    mark(x, z, heading) {
      const sk = this.mesh;
      sk.setMatrixAt(this.n % this.cap, this.m4.makeRotationY(Math.PI / 2 - heading).setPosition(x, 0.045, z));
      this.n++;
      sk.count = Math.min(this.n, this.cap);
      sk.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- stage ----------
  // The view's WebGL canvas (sharp on big screens) with a 2D HUD canvas on top. Both stand in for the shell
  // canvas while a match runs and are copied into it a few times a second, because Mitschauen reads that one.
  // view = { canvas, ratio, setRatio(r) }; shell = the shell's canvas `cv`.
  let slow = false;                 // this machine proved too slow for more than 1×: stays for the evening
  const SLOW_FRAME_MS = 30, SLOW_AFTER = 120, MIRROR_MS = 120;
  class Stage {
    constructor(view, shell, W, H, hudScale) {
      this.view = view; this.shell = shell; this.W = W; this.H = H; this.hudScale = hudScale || 2;
      this.slowFrames = 0; this.lastMirror = 0;
      this.wrap = document.createElement('div');
      this.wrap.style.cssText = 'position:relative; display:none; line-height:0; width:fit-content; margin:0 auto;';
      this.hud = document.createElement('canvas');
      this.hud.width = W * this.hudScale; this.hud.height = H * this.hudScale;
      // neutralise the page's global canvas rule, or the overlay would cover the 3D scene
      this.hud.style.cssText = 'position:absolute; left:0; top:0; width:100%; height:100%; pointer-events:none;'
        + 'background:transparent; border-radius:0; box-shadow:none; max-width:none; max-height:none;';
      this.wrap.append(view.canvas, this.hud);
      shell.insertAdjacentElement('afterend', this.wrap);
      this.fit = () => this.fitRatio();
    }
    // the HUD's 2D context, scaled so that drawing uses W×H coordinates, and cleared
    begin() {
      const c = this.hud.getContext('2d');
      c.setTransform(this.hudScale, 0, 0, this.hudScale, 0, 0);
      c.clearRect(0, 0, this.W, this.H);
      return c;
    }
    show(on) {
      this.wrap.style.display = on ? 'block' : 'none';
      this.shell.style.display = on ? 'none' : '';
      if (on) { this.slowFrames = 0; this.fitRatio(); window.addEventListener('resize', this.fit); }
      else window.removeEventListener('resize', this.fit);
    }
    // render as many pixels as the screen really shows (up to 2×), unless this machine proved too slow
    fitRatio() {
      if (!this.view.setRatio) return;
      let shown = 0;
      try { shown = this.view.canvas.getBoundingClientRect().width; } catch (e) {}
      const want = (shown || this.W) * (window.devicePixelRatio || 1) / this.W;
      this.view.setRatio(slow ? 1 : Math.round(Math.max(1, Math.min(2, want)) * 4) / 4);
    }
    // call once per frame after drawing: rawMs = time since the last frame, ctx = the shell canvas' 2D context
    frame(rawMs, ctx, now) {
      if (now - this.lastMirror >= MIRROR_MS) {
        this.lastMirror = now;
        try { ctx.drawImage(this.view.canvas, 0, 0, this.W, this.H); ctx.drawImage(this.hud, 0, 0, this.W, this.H); } catch (e) {}
      }
      this.slowFrames = rawMs > SLOW_FRAME_MS ? this.slowFrames + 1 : 0;
      if (this.slowFrames >= SLOW_AFTER && !slow && this.view.ratio > 1) { slow = true; this.fitRatio(); }
    }
    remove() { this.show(false); this.wrap.remove(); }
  }

  root.Kit3D = { canvasTex, carKit, makeCar, poseCar, Particles, Skids, Stage };
})(typeof window !== 'undefined' ? window : globalThis);
