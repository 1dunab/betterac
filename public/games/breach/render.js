/* Original procedural station, operators and weapons. Uses the repository's local three.js. */
(function () {
  'use strict';
  const W = window.BreachWorld;
  class View {
    constructor(parent) {
      const T = this.T = window.THREE;
      this.parent = parent; this.width = 1280; this.height = 720; this.meshes = new Map(); this.fx = []; this.feed = []; this.rings = []; this.clock = 0;
      this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFShadowMap;
      this.renderer.shadowMap.autoUpdate = false; this.shadowFrame = 0;
      this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
      this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;background:transparent;border:0;border-radius:0;box-shadow:none;touch-action:none';
      this.hud = document.createElement('canvas');
      this.hud.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;background:transparent;border-radius:0;box-shadow:none;pointer-events:none';
      parent.append(this.renderer.domElement, this.hud); this.h = this.hud.getContext('2d');
      this.scene = new T.Scene(); this.scene.background = new T.Color('#101d32'); this.scene.fog = new T.FogExp2('#25394e', 0.0045);
      this.scene.add(new T.HemisphereLight('#b3dcff', '#374b5b', 2.5));
      const sun = new T.DirectionalLight('#c1deff', 3); sun.position.set(-20, 45, 10); sun.castShadow = true;
      Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 }); sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.001;
      this.scene.add(sun);
      const fill = new T.DirectionalLight('#ff927e', 0.8); fill.position.set(30, 15, -40); this.scene.add(fill);
      this.camera = new T.PerspectiveCamera(78, 16 / 9, 0.06, 240); this.camera.rotation.order = 'YXZ';
      this.scene.add(this.camera); this.materials = new Map(); this.unitBox = new T.BoxGeometry(1, 1, 1);
      const bevel = new T.Shape(); bevel.moveTo(-0.42, -0.42); bevel.lineTo(0.42, -0.42); bevel.lineTo(0.42, 0.42); bevel.lineTo(-0.42, 0.42); bevel.closePath();
      this.bevelBox = new T.ExtrudeGeometry(bevel, { depth: 0.84, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.08, bevelThickness: 0.08 }); this.bevelBox.center();
      this.buildWorld(); this.bakeStatic(); this.guns = {};
      Object.keys(W.weapons).forEach(key => { const gun = this.buildGun(key); gun.visible = false; this.guns[key] = gun; this.camera.add(gun); });
      this.gun = this.guns.rifle;
      this.resize();
    }
    mat(color, glow = false) {
      const key = color + glow;
      if (!this.materials.has(key)) this.materials.set(key, glow ? new this.T.MeshBasicMaterial({ color }) : new this.T.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.32 }));
      return this.materials.get(key);
    }
    bakeStatic() {
      // Hundreds of wall panels and light strips become a few GPU instanced draws.
      const groups = new Map();
      this.scene.children.slice().forEach(m => {
        if (m.geometry !== this.unitBox) return;
        const list = groups.get(m.material) || []; list.push(m); groups.set(m.material, list);
      });
      groups.forEach((meshes, material) => {
        const batch = new this.T.InstancedMesh(this.unitBox, material, meshes.length);
        batch.castShadow = !material.isMeshBasicMaterial; batch.receiveShadow = true;
        meshes.forEach((m, i) => { m.updateMatrix(); batch.setMatrixAt(i, m.matrix); this.scene.remove(m); });
        batch.instanceMatrix.needsUpdate = true; batch.computeBoundingSphere(); this.scene.add(batch);
      });
    }
    box(x, y, z, w, h, d, color, parent = this.scene, glow = false) {
      const m = new this.T.Mesh(this.unitBox, this.mat(color, glow)); m.position.set(x, y, z); m.scale.set(w, h, d); m.castShadow = !glow; m.receiveShadow = true; parent.add(m); return m;
    }
    cylinder(x, y, z, r, h, color, parent = this.scene, glow = false) {
      const m = new this.T.Mesh(new this.T.CylinderGeometry(r, r, h, 12), this.mat(color, glow)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
    }
    rounded(x, y, z, w, h, d, color, parent, glow = false) {
      const m = new this.T.Mesh(this.bevelBox, this.mat(color, glow)); m.position.set(x, y, z); m.scale.set(w, h, d); m.castShadow = !glow; parent.add(m); return m;
    }
    surfaceTexture(kind) {
      const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
      if (kind === 'floor') {
        g.fillStyle = '#7c919d'; g.fillRect(0, 0, 512, 512);
        for (let y = 0; y < 512; y += 128) for (let x = 0; x < 512; x += 256) {
          g.fillStyle = ((y / 128 + x / 256) % 2) ? '#8196a0' : '#758c98'; g.fillRect(x + 3, y + 3, 250, 122);
          g.strokeStyle = '#a7b6bd'; g.strokeRect(x + 5, y + 5, 246, 118);
          g.fillStyle = '#465e6c'; for (const dx of [13, 240]) for (const dy of [13, 114]) { g.beginPath(); g.arc(x + dx, y + dy, 2.5, 0, Math.PI * 2); g.fill(); }
          g.fillStyle = '#607986'; for (let n = 0; n < 7; n++) g.fillRect(x + 80 + n * 14, y + 108, 8, 2);
        }
      } else {
        const grad = g.createLinearGradient(0, 0, 0, 512); grad.addColorStop(0, '#54677d'); grad.addColorStop(0.28, '#9babbd'); grad.addColorStop(0.5, '#b7b3ae'); grad.addColorStop(0.65, '#667c9a'); grad.addColorStop(1, '#d0b59e'); g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
        for (let y = 0; y < 512; y += 3) { g.strokeStyle = 'rgba(30,49,78,' + (0.03 + (Math.sin(y * 0.2) + 1) * 0.06) + ')'; g.beginPath(); for (let x = 0; x <= 512; x += 8) g.lineTo(x, y + Math.sin(x * 0.025 + y * 0.03) * 7); g.stroke(); }
      }
      const texture = new this.T.CanvasTexture(c); texture.colorSpace = this.T.SRGBColorSpace; texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy()); return texture;
    }
    halo(x, y, z, color, size) {
      if (!this.haloTexture) {
        const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.15, '#ffffff99'); grad.addColorStop(0.5, '#ffffff20'); grad.addColorStop(1, '#ffffff00'); g.fillStyle = grad; g.fillRect(0, 0, 64, 64); this.haloTexture = new this.T.CanvasTexture(c);
      }
      const sprite = new this.T.Sprite(new this.T.SpriteMaterial({ map: this.haloTexture, color, transparent: true, blending: this.T.AdditiveBlending, depthWrite: false, opacity: 0.55 })); sprite.position.set(x, y, z); sprite.scale.set(size, size, 1); this.scene.add(sprite);
    }
    sign(text, x, y, z, width, color = '#a0fcf1', ry = 0) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 128;
      const g = c.getContext('2d'); g.fillStyle = '#142a38'; g.fillRect(0, 0, 512, 128); g.fillStyle = color;
      g.fillRect(0, 0, 6, 128); let fontSize = 56; g.font = `bold ${fontSize}px monospace`;
      while (g.measureText(text).width > 466) { fontSize -= 2; g.font = `bold ${fontSize}px monospace`; }
      g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(text, 256, 66);
      const map = new this.T.CanvasTexture(c); map.colorSpace = this.T.SRGBColorSpace;
      const mat = new this.T.MeshBasicMaterial({ map, side: this.T.DoubleSide });
      const m = new this.T.Mesh(new this.T.PlaneGeometry(width, width / 4), mat); m.position.set(x, y, z); m.rotation.y = ry; this.scene.add(m); return m;
    }
    buildWorld() {
      const T = this.T;
      const sky = new T.Mesh(new T.SphereGeometry(210, 32, 20), new T.ShaderMaterial({ side: T.BackSide, depthWrite: false,
        vertexShader: 'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: 'varying vec3 vPosition; void main(){float h=normalize(vPosition).y; vec3 color=mix(vec3(0.22,0.29,0.37),vec3(0.025,0.05,0.115),smoothstep(-0.1,0.7,h)); float glow=pow(max(0.0,dot(normalize(vPosition),normalize(vec3(-0.8,0.16,-0.6)))),14.0); gl_FragColor=vec4(color+vec3(0.22,0.12,0.07)*glow,1.0);}' })); this.scene.add(sky);
      this.box(0, -0.3, 0, 63, 0.6, 59, '#475b65');
      const floorTexture = this.surfaceTexture('floor'); floorTexture.wrapS = floorTexture.wrapT = T.RepeatWrapping; floorTexture.repeat.set(9, 9);
      const floor = new T.Mesh(new T.PlaneGeometry(60, 56), new T.MeshStandardMaterial({ map: floorTexture, roughness: 0.64, metalness: 0.3 })); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.012; floor.receiveShadow = true; this.scene.add(floor);
      // Clean inlaid runway strips make routes legible in first person.
      for (const x of [-26.5, -4.2, 19.5, 28]) {
        this.box(x, 0.025, 0, 0.06, 0.035, 51, '#a2ddd8', this.scene, true);
        for (let z = -24; z < 27; z += 4) this.box(x + 0.35, 0.025, z, 0.35, 0.025, 0.7, '#d6bb7d');
      }
      for (const b of W.boxes) {
        const lab = b.kind === 'warehouse', cargo = b.kind === 'container';
        const color = lab ? '#8297a4' : cargo ? (b.x > 10 ? '#655474' : '#426c79') : b.kind === 'crate' ? '#657984' : '#5c707e';
        this.box(b.x, b.h / 2, b.z, b.w, b.h, b.d, color);
        this.box(b.x, 0.22, b.z, b.w + 0.04, 0.44, b.d + 0.04, '#263c4c');
        this.box(b.x, b.h - 0.14, b.z, b.w + 0.05, 0.16, b.d + 0.05, '#23394a');
        if (cargo || lab) {
          const col = cargo && b.x > 10 ? '#e9a182' : '#8be0df';
          this.box(b.x, b.h - 0.34, b.z + b.d / 2 + 0.025, b.w * 0.85, 0.065, 0.03, col, this.scene, true);
          this.box(b.x + b.w / 2 + 0.025, b.h - 0.34, b.z, 0.03, 0.065, b.d * 0.85, col, this.scene, true);
        }
        if (cargo) {
          for (let x = b.x - b.w / 2 + 0.4; x < b.x + b.w / 2; x += 0.65) this.box(x, b.h / 2, b.z + b.d / 2 + 0.04, 0.06, b.h - 0.65, 0.08, '#2e4356');
          for (let z = b.z - b.d / 2 + 0.4; z < b.z + b.d / 2; z += 0.65) this.box(b.x + b.w / 2 + 0.04, b.h / 2, z, 0.08, b.h - 0.65, 0.06, '#2e4356');
          this.sign(b.x > 10 ? 'CRYO / 08' : 'NEXUS / 07', b.x, 1.7, b.z + b.d / 2 + 0.09, Math.min(b.w * 0.75, 3), '#d3e5dc');
          this.box(b.x - b.w / 2 + 0.1, b.h / 2, b.z + b.d / 2 + 0.08, 0.16, b.h - 0.15, 0.1, '#e9b574');
        }
        if (b.kind === 'crate') {
          this.box(b.x, b.h + 0.03, b.z, b.w * 0.8, 0.06, b.d * 0.65, '#344d5e');
          this.box(b.x, b.h * 0.65, b.z + b.d / 2 + 0.025, b.w * 0.6, 0.09, 0.05, '#c1ede0', this.scene, true);
        }
        if (b.kind === 'barrier') for (let x = -b.w / 2 + 0.25; x < b.w / 2; x += 0.5) {
          const m = this.box(b.x + x, 0.65, b.z + b.d / 2 + 0.02, 0.2, 0.75, 0.035, '#edc776'); m.rotation.z = -0.45;
        }
      }
      // Research wing roof and ceiling lights; the wide doors remain open.
      this.box(-13, 6.12, -11, 13, 0.28, 23, '#3d5362');
      for (let z = -19; z < 0; z += 5) this.box(-13, 5.9, z, 7, 0.06, 0.3, '#caf2e7', this.scene, true);
      this.sign('A / BIOLAB', -13, 4.3, 0.57, 8, '#d6f89c');
      this.sign('B / REAKTOR', 29.44, 3.2, -8, 7, '#ffc2af', -Math.PI / 2);
      this.sign('NEXUS · 07', 0, 4.1, -27.4, 11, '#aee8ec');
      this.sign('FORSCHUNG / ZONE 04', -10, 2.8, 27.44, 9, '#aee8ec', Math.PI);
      this.sign('A ← BIOLAB    REAKTOR → B', 2, 4.4, 13, 8, '#bdece4');
      // The reactor is above solid cover; its rings never obstruct a playable route.
      this.reactor = new T.Group(); this.reactor.position.set(23, 5.2, -10); this.scene.add(this.reactor);
      const core = new T.Mesh(new T.IcosahedronGeometry(1.1, 1), new T.MeshStandardMaterial({ color: '#71b8c9', emissive: '#338fa9', emissiveIntensity: 1.1, roughness: 0.2, metalness: 0.5 })); this.reactor.add(core);
      for (let i = 0; i < 3; i++) { const ring = new T.Mesh(new T.TorusGeometry(1.5 + i * 0.3, 0.025, 6, 56), this.mat(i === 1 ? '#ffcaa0' : '#89eef1', true)); ring.rotation.set(i * 0.75, i * 1.1, 0.3); this.reactor.add(ring); }
      this.cylinder(23, 3.7, -10, 1.7, 0.35, '#304859'); this.halo(23, 5.2, -10, '#6bddeb', 6);
      // High gantries frame the station without introducing invisible collision walls.
      for (const z of [-24, 16]) { this.box(0, 8.4, z, 59, 0.42, 0.7, '#617b8d'); this.box(0, 8.13, z, 56, 0.045, 0.13, '#c1e8e5', this.scene, true); }
      for (const [x, y, z, color] of [[-13, 4.8, -8, '#bce6b2'], [23, 5, -10, '#71cced'], [0, 7.5, 16, '#ffcaa1']]) { const light = new T.PointLight(color, 15, 20, 2); light.position.set(x, y, z); this.scene.add(light); }
      for (let z = -20; z <= -5; z += 5) { this.box(-18.35, 3, z, 0.035, 2, 1.6, '#233f4b'); this.box(-18.30, 3, z, 0.025, 1.5, 0.08, '#bdebc2', this.scene, true); this.box(-18.29, 3.5, z, 0.02, 0.08, 1.15, '#bdebc2', this.scene, true); }
      this.siteRings = [];
      for (const site of W.sites) {
        const color = site.key === 'A' ? '#def6a0' : '#f0b48d';
        const ring = new T.Mesh(new T.RingGeometry(site.r - 0.1, site.r, 64), this.mat(color, true).clone()); ring.rotation.x = -Math.PI / 2; ring.position.set(site.x, 0.045, site.z); this.scene.add(ring);
        this.siteRings.push(ring);
        const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
        g.fillStyle = color; g.font = 'bold 180px monospace'; g.textAlign = 'center'; g.fillText(site.key, 128, 190);
        const mark = new T.Mesh(new T.PlaneGeometry(3, 3), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }));
        mark.rotation.x = -Math.PI / 2; mark.position.set(site.x, 0.05, site.z); this.scene.add(mark);
      }
      // Tall perimeter architecture and alien landscape, outside the playable boundary.
      for (let z = -25; z <= 25; z += 10) {
        this.box(30, 3.5, z, 0.55, 7, 0.65, '#7797a8'); this.box(29.68, 3.6, z, 0.08, 5.6, 0.15, '#9fe8ee', this.scene, true);
        this.box(30, 7, z + 4, 0.4, 0.4, 9, '#9aafbf');
      }
      const glass = new T.MeshStandardMaterial({ color: '#8fc8df', transparent: true, opacity: 0.13, roughness: 0.2, metalness: 0.3, side: T.DoubleSide, depthWrite: false });
      const shield = new T.Mesh(new T.PlaneGeometry(55, 5.4), glass); shield.position.set(30, 4, 0); shield.rotation.y = Math.PI / 2; this.scene.add(shield);
      this.box(0, -4, 0, 220, 3, 220, '#253d50');
      for (let i = 0; i < 22; i++) {
        const a = i * 2.399, r = 72 + (i % 3) * 8, h = 12 + (i * 7 % 23);
        const rock = new T.Mesh(new T.ConeGeometry(12 + i % 8, h, 5), this.mat(i % 2 ? '#334d63' : '#2b4359')); rock.position.set(Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r); this.scene.add(rock);
      }
      const planet = new T.Mesh(new T.SphereGeometry(16, 48, 32), new T.MeshStandardMaterial({ map: this.surfaceTexture('planet'), roughness: 1 })); planet.position.set(68, 40, -86); this.scene.add(planet);
      const ring = new T.Mesh(new T.RingGeometry(16, 24, 90), new T.MeshBasicMaterial({ color: '#9db4c8', side: T.DoubleSide, transparent: true, opacity: 0.3 })); ring.position.copy(planet.position); ring.rotation.set(1.15, 0.4, 0.3); this.scene.add(ring);
      const starPositions = [];
      for (let i = 0; i < 500; i++) { const a = i * 2.399, y = 25 + (i * 37 % 130), r = 130; starPositions.push(Math.cos(a) * r, y, Math.sin(a) * r); }
      const stars = new T.BufferGeometry(); stars.setAttribute('position', new T.Float32BufferAttribute(starPositions, 3)); this.scene.add(new T.Points(stars, new T.PointsMaterial({ color: '#d2e6f6', size: 0.16 })));
      for (const [x, z] of [[-26, 22], [26, 22], [-26, -23], [26, -24]]) {
        this.cylinder(x, 4, z, 0.13, 8, '#273b4a'); this.box(x, 8, z, 2, 0.15, 0.65, '#def7fa', this.scene, true);
        this.halo(x, 7.95, z, '#c8eeff', 3);
      }
      this.bombMesh = new T.Group(); this.box(0, 0.2, 0, 0.6, 0.4, 0.4, '#243240', this.bombMesh); this.box(0, 0.43, 0, 0.35, 0.025, 0.18, '#ff795c', this.bombMesh, true); this.scene.add(this.bombMesh); this.bombMesh.visible = false;
    }
    buildGun(key) {
      const T = this.T, g = new T.Group(), w = W.weapons[key], small = ['pistol', 'revolver'].includes(key), long = ['marksman', 'sniper'].includes(key);
      const length = small ? 0.29 : key === 'smg' ? 0.37 : key === 'carbine' ? 0.44 : long ? 0.63 : 0.52;
      const accent = w.color, dark = '#253541', metal = key === 'revolver' ? '#abbac0' : '#728995';
      const part = (x, y, z, a, b, c, color = dark, glow = false) => this.rounded(x, y, z, a, b, c, color, g, glow);
      const barrel = (x, y, z, r, l, color = dark) => { const m = this.cylinder(x, y, z, r, l, color, g); m.rotation.x = Math.PI / 2; return m; };
      part(0, 0, -length / 2, small ? 0.105 : 0.135, small ? 0.11 : 0.16, length, metal);
      part(0, -0.13, -0.1, 0.09, 0.24, 0.13).rotation.x = -0.22;
      part(0, -0.026, -0.1, 0.15, 0.035, 0.13, dark);
      // Trigger guard and machined top rail.
      part(0, -0.15, -0.21, 0.034, 0.025, 0.14); part(0, -0.10, -0.27, 0.03, 0.12, 0.025);
      part(0, 0.09, -length / 2, 0.075, 0.025, length * 0.85);
      for (let i = 0; i < (small ? 4 : 8); i++) part(0, 0.106, -0.085 - i * (length - 0.1) / 8, 0.09, 0.014, 0.015, '#b2c0c2');
      const barrelLength = small ? 0.08 : long ? 0.34 : key === 'shotgun' ? 0.24 : 0.16;
      barrel(0, 0.025, -length - barrelLength / 2, key === 'shotgun' ? 0.043 : 0.026, barrelLength);
      barrel(0, 0.025, -length - barrelLength, small ? 0.032 : 0.042, 0.06, '#435967');
      barrel(0, 0.025, -length - barrelLength - 0.032, small ? 0.022 : 0.029, 0.004, '#07141c');
      if (!small) {
        part(0, -0.018, 0.11, 0.115, 0.16, 0.24); part(0, -0.03, 0.245, 0.13, 0.21, 0.06, '#556e7b');
        part(0, -0.03, -length * 0.75, 0.155, 0.13, length * 0.36, dark);
        for (let i = 0; i < 5; i++) part(0.08, 0.006, -length * 0.6 - i * 0.025, 0.005, 0.032, 0.012, '#0e222d');
        if (key === 'lmg') { part(0, -0.18, -0.28, 0.25, 0.23, 0.2, '#786e53'); barrel(0, 0.16, -0.2, 0.045, 0.15); }
        else if (key === 'shotgun') { barrel(0, -0.045, -length - 0.08, 0.026, 0.24, '#a9b7b8'); part(0, -0.08, -length * 0.8, 0.17, 0.13, 0.23, accent); }
        else part(0, -0.18, key === 'smg' ? -0.15 : -0.3, 0.085, key === 'smg' ? 0.29 : 0.22, 0.13, dark).rotation.x = -0.15;
      }
      if (key === 'revolver') { const drum = this.cylinder(0, -0.005, -0.19, 0.079, 0.12, '#455965', g); drum.rotation.x = Math.PI / 2; for (let i = 0; i < 6; i++) barrel(Math.cos(i * Math.PI / 3) * 0.055, Math.sin(i * Math.PI / 3) * 0.055 - 0.005, -0.256, 0.012, 0.003, '#101d26'); }
      if (long) {
        part(0, 0.14, -0.25, 0.055, 0.1, 0.12); barrel(0, 0.21, -0.27, key === 'sniper' ? 0.07 : 0.055, 0.29);
        barrel(0, 0.21, -0.105, key === 'sniper' ? 0.06 : 0.044, 0.013, '#68c3d2'); part(0.08, 0.05, -0.15, 0.13, 0.024, 0.027, metal);
      } else { part(0, 0.135, -0.07, 0.075, 0.07, 0.035); part(0, 0.16, -0.075, 0.025, 0.01, 0.012, accent, true); part(0, 0.13, -length + 0.03, 0.025, 0.06, 0.022); }
      part(small ? 0.054 : 0.069, 0.005, -length * 0.45, 0.007, 0.025, length * 0.38, accent, true);
      if (key === 'burst') for (let i = 0; i < 3; i++) part(0.07, 0.052, -0.2 - i * 0.045, 0.006, 0.018, 0.025, accent, true);
      // Gloved hands and sleeves, with the support hand absent on sidearms.
      part(0.015, -0.22, -0.04, 0.15, 0.13, 0.2, '#263e4a'); part(0.04, -0.28, 0.11, 0.16, 0.15, 0.3, '#506b79');
      if (!small) { part(-0.045, -0.115, -length * 0.8, 0.15, 0.1, 0.19, '#263e4a'); part(-0.14, -0.2, -length * 0.6, 0.17, 0.13, 0.26, '#506b79').rotation.z = -0.6; }
      const flash = new T.Mesh(new T.ConeGeometry(key === 'shotgun' ? 0.1 : 0.06, 0.23, 6), this.mat('#fff0ba', true)); flash.rotation.x = -Math.PI / 2; flash.position.set(0, 0.025, -length - barrelLength - 0.13); flash.visible = false; g.add(flash); g.userData.flash = flash;
      g.traverse(m => { m.castShadow = false; }); return g;
    }
    operator(p) {
      const T = this.T, g = new T.Group(), color = p.team === 0 ? '#6cbfc5' : '#dc937c', armor = p.team === 0 ? '#354f62' : '#5e4851';
      this.rounded(0, 1.12, 0, 0.56, 0.6, 0.31, armor, g); this.rounded(0, 1.27, -0.18, 0.41, 0.24, 0.08, '#bcc9c4', g);
      this.rounded(0, 1.62, 0, 0.39, 0.39, 0.37, '#4f626c', g); const visor = this.rounded(0, 1.65, -0.195, 0.34, 0.115, 0.055, color, g, true);
      this.rounded(0, 1.49, -0.17, 0.2, 0.1, 0.09, '#243c48', g);
      this.rounded(-0.37, 1.12, 0, 0.2, 0.47, 0.25, armor, g); this.rounded(0.37, 1.12, -0.1, 0.2, 0.47, 0.25, armor, g);
      for (const x of [-0.35, 0.35]) this.rounded(x, 1.37, 0, 0.24, 0.15, 0.29, '#a1b8bb', g);
      for (const x of [-0.14, 0, 0.14]) this.rounded(x, 0.98, -0.18, 0.1, 0.17, 0.09, '#314651', g);
      this.box(0.24, 1.12, -0.42, 0.13, 0.15, 0.66, '#263945', g);
      g.userData.legs = [-0.16, 0.16].map(x => { const leg = new T.Group(); leg.position.set(x, 0.78, 0); g.add(leg); this.rounded(0, -0.31, 0, 0.23, 0.62, 0.27, armor, leg); this.rounded(0, -0.32, -0.14, 0.19, 0.19, 0.1, '#94aeb4', leg); this.rounded(0, -0.68, -0.055, 0.25, 0.17, 0.4, '#253843', leg); return leg; });
      const badge = this.box(0, 1.4, 0.18, 0.28, 0.12, 0.03, color, g, true);
      g.userData.accents = [visor, badge]; g.userData.accents.forEach(m => m.material = m.material.clone());
      const shield = new T.Mesh(new T.TorusGeometry(0.62, 0.035, 6, 32), this.mat('#a8f5e5', true)); shield.rotation.x = Math.PI / 2; shield.position.y = 0.06; shield.visible = false; g.add(shield); g.userData.shield = shield;
      this.scene.add(g); return g;
    }
    resize() {
      const r = this.parent.getBoundingClientRect(), w = Math.max(320, Math.round(r.width)), h = Math.max(200, Math.round(r.height));
      if (w === this.width && h === this.height && this.hud.width === w) return;
      this.width = w; this.height = h; this.renderer.setSize(w, h, false); this.hud.width = w; this.hud.height = h;
    }
    effects(events, names = {}) {
      for (const e of events) {
        if (e.type === 'shot') {
          const geo = new this.T.BufferGeometry().setFromPoints([new this.T.Vector3(e.from.x, e.from.y - 0.07, e.from.z), new this.T.Vector3(e.to.x, e.to.y, e.to.z)]);
          const color = W.weapons[e.weapon]?.color || '#ffdfa8';
          const line = new this.T.Line(geo, new this.T.LineBasicMaterial({ color, transparent: true, opacity: 0.8 })); this.scene.add(line); this.fx.push({ mesh: line, life: 0.075 });
          if (e.audible !== false) {
            const points = [];
            for (let i = 0; i < 7; i++) { const a = i * 2.4, r = 0.08 + i * 0.025; points.push(e.to.x, e.to.y, e.to.z, e.to.x + Math.cos(a) * r, e.to.y + Math.sin(a) * r, e.to.z + Math.sin(i * 1.7) * r); }
            const sparks = new this.T.BufferGeometry(); sparks.setAttribute('position', new this.T.Float32BufferAttribute(points, 3));
            const impact = new this.T.LineSegments(sparks, new this.T.LineBasicMaterial({ color: e.hit ? '#c8f9ec' : '#ffdaa1', transparent: true, opacity: 0.9 })); this.scene.add(impact); this.fx.push({ mesh: impact, life: 0.12 });
          }
        }
        if (e.type === 'kill') this.feed.unshift({ text: (names[e.id] || (String(e.id).startsWith('bot') ? 'Sicherheits-Bot' : 'Operator')) + '  ›  ' + (names[e.target] || 'Sicherheits-Bot') + (e.quickscope ? '  QS' : e.headshot ? '  ◇' : ''), until: this.clock + 4 });
      }
      this.feed = this.feed.slice(0, 4);
    }
    draw(state, ids, names = {}, dt = 0.016, preview = false, aimOverride = null) {
      this.resize(); this.clock += dt;
      if (this.reactor) { this.reactor.rotation.y = this.clock * 0.22; this.reactor.children[0].rotation.z = this.clock * 0.16; }
      for (const p of state.actors) {
        let mesh = this.meshes.get(p.id); if (!mesh) { mesh = this.operator(p); this.meshes.set(p.id, mesh); }
        const old = mesh.position.clone();
        mesh.position.set(p.x, p.y || 0, p.z); mesh.rotation.y = p.yaw; mesh.visible = p.alive;
        mesh.userData.shield.visible = p.spawnShield > 0;
        mesh.userData.accents.forEach(m => m.material.color.set(state.cfg.mode === 'ffa' || p.team === 1 ? '#dc937c' : '#6cbfc5'));
        const walking = old.distanceTo(mesh.position) > 0.004;
        mesh.userData.legs.forEach((leg, i) => { leg.rotation.x = walking ? Math.sin(this.clock * 11 + i * Math.PI) * 0.5 : 0; });
      }
      for (const [id, m] of this.meshes) if (!state.actors.some(p => p.id === id)) m.visible = false;
      for (const f of this.fx) { f.life -= dt; if (f.life <= 0) { this.scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); } }
      this.fx = this.fx.filter(f => f.life > 0);
      if (!this.smokeGroup) { this.smokeGroup = new this.T.Group(); this.scene.add(this.smokeGroup); }
      const smoke = state.smokes || [], required = smoke.length * 3;
      while (this.smokeGroup.children.length > required) {
        const m = this.smokeGroup.children[this.smokeGroup.children.length - 1]; this.smokeGroup.remove(m); m.geometry.dispose(); m.material.dispose();
      }
      while (this.smokeGroup.children.length < required) this.smokeGroup.add(new this.T.Mesh(new this.T.SphereGeometry(1, 18, 12), new this.T.MeshBasicMaterial({ color: '#9aaeb8', transparent: true, opacity: 0.6, depthWrite: false })));
      smoke.forEach((s, i) => {
        for (let n = 0; n < 3; n++) { const m = this.smokeGroup.children[i * 3 + n]; m.position.set(s.x, 0.8 + n * 0.55, s.z); m.scale.setScalar(s.r * (1 - n * 0.16)); m.material.opacity = Math.min(0.6, s.life / 3); }
      });
      this.bombMesh.visible = !!state.bomb;
      this.siteRings.forEach((ring, i) => { const zone = state.cfg.mode === 'control' && state.zones?.[i]; ring.material.color.set(zone ? zone.contested ? '#fff1a1' : zone.owner === 0 ? '#69e8ee' : zone.owner === 1 ? '#ff997e' : '#e0e9d8' : i ? '#f0b48d' : '#def6a0'); });
      if (state.bomb) this.bombMesh.position.set(state.bomb.x, 0, state.bomb.z);
      const h = this.h; h.clearRect(0, 0, this.width, this.height);
      this.renderer.shadowMap.needsUpdate = this.shadowFrame++ % 6 === 0;
      this.renderer.setScissorTest(true);
      const views = preview ? [null] : ids, cols = views.length > 2 ? 2 : 1, rows = Math.ceil(views.length / cols);
      views.forEach((id, i) => {
        const x = (i % cols) * this.width / cols, y = Math.floor(i / cols) * this.height / rows, w = this.width / cols, ht = this.height / rows;
        const owner = state.actors.find(a => a.id === id);
        let p = owner;
        if (p && !p.alive && state.cfg.mode !== 'ffa') p = state.actors.find(a => a.team === p.team && a.alive) || p;
        Object.values(this.guns).forEach(g => { g.visible = false; }); this.gun = this.guns[p?.weapon] || this.guns.rifle;
        this.camera.aspect = w / ht; this.gun.visible = !preview && !!p && p.alive;
        this.camera.fov = p && p.input && p.input.aim ? (W.weapons[p.weapon].zoom || 57) : 78; this.camera.updateProjectionMatrix();
        if (preview || !p) {
          const a = this.clock * 0.022; this.camera.position.set(33 * Math.cos(a), 20, 35 * Math.sin(a) + 12); this.camera.lookAt(-3, 0, -5); this.gun.visible = false;
        } else {
          const local = aimOverride && p.id === owner.id ? aimOverride : p;
          this.camera.rotation.set(local.pitch || 0, local.yaw || 0, 0, 'YXZ');
          this.camera.position.set(p.x, (p.y || 0) + 1.62 + Math.sin((p.steps || 0) * 2.4) * 0.018, p.z);
          const ads = p.input && p.input.aim, reload = p.reload > 0 ? Math.sin(Math.PI * p.reload / W.weapons[p.weapon].reload) : 0, bob = Math.sin((p.steps || 0) * 2.4) * 0.008;
          this.gun.position.set(ads ? 0 : 0.26, (ads ? -0.18 : -0.24) - reload * 0.18 + bob, -0.38 + (p.recoil || 0) * 0.065);
          this.gun.rotation.set(-reload * 0.35 + (p.recoil || 0) * 0.045, reload * 0.15, reload * 0.5 - 0.015);
          this.gun.scale.setScalar(0.84);
          this.gun.userData.flash.visible = p.shotTimer > 0 && state.phase === 'live';
          if (ads && W.weapons[p.weapon].zoom) this.gun.visible = false;
          const ownMesh = this.meshes.get(p.id); if (ownMesh) ownMesh.visible = false;
        }
        this.renderer.setViewport(x, this.height - y - ht, w, ht); this.renderer.setScissor(x, this.height - y - ht, w, ht); this.renderer.render(this.scene, this.camera);
        if (p) { const mesh = this.meshes.get(p.id); if (mesh) mesh.visible = p.alive; }
        if (!preview && owner) { h.save(); h.translate(x, y); h.beginPath(); h.rect(0, 0, w, ht); h.clip(); this.drawHud(state, owner, p, w, ht, names); h.restore(); }
      });
      this.renderer.setScissorTest(false);
    }
    drawHud(s, owner, p, width, height, names) {
      const h = this.h, scale = Math.min(width / 1100, height / (height < 460 ? 440 : 650)), w = width / scale, ht = height / scale;
      h.scale(scale, scale); h.textBaseline = 'middle';
      const text = (str, x, y, size = 15, color = '#e3ece6', align = 'left') => { h.font = `600 ${size}px monospace`; h.fillStyle = color; h.textAlign = align; h.fillText(str, x, y); };
      const panel = (x, y, pw, ph) => { h.fillStyle = 'rgba(9,23,33,.79)'; h.fillRect(x, y, pw, ph); h.strokeStyle = '#5b758755'; h.lineWidth = 1; h.strokeRect(x, y, pw, ph); };
      const grad = h.createLinearGradient(0, ht - 130, 0, ht); grad.addColorStop(0, '#07121a00'); grad.addColorStop(1, '#07121ad9'); h.fillStyle = grad; h.fillRect(0, ht - 130, w, 130);
      panel(w / 2 - 155, 20, 310, 58);
      const mode = W.modes[s.cfg.mode] || W.modes.tactical;
      const ranked = s.cfg.mode === 'ffa' ? BreachFeedback.ranking(s) : [];
      const score = s.cfg.mode === 'ffa' ? [s.stats[owner.id]?.kills || 0, s.stats[ranked[0]?.id]?.kills || 0] : s.cfg.mode === 'deathmatch' ? s.teamKills : s.cfg.mode === 'arsenal' ? s.arsenalProgress : s.cfg.mode === 'control' ? s.zoneScores.map(Math.floor) : s.cfg.mode === 'survival' ? [s.round, s.actors.filter(a => a.alive && a.team === 1).length] : s.score;
      text(score[0], w / 2 - 119, 49, 32, '#9be6e7', 'center'); text(score[1], w / 2 + 119, 49, 32, '#f0b195', 'center');
      if (s.cfg.mode === 'ffa') { text('DU', w / 2 - 119, 27, 8, '#9be6e7', 'center'); text('BESTE', w / 2 + 119, 27, 8, '#f0b195', 'center'); }
      const secs = Math.max(0, Math.ceil(s.bomb ? s.bomb.left : s.remaining));
      text(s.bomb ? '◈ ' + secs : Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'), w / 2, 44, 24, s.bomb ? '#ffbb89' : '#f1f2d9', 'center');
      text(s.cfg.mode === 'tactical' ? 'RUNDE ' + s.round + '  /  ZIEL ' + s.cfg.target : s.cfg.mode === 'survival' ? 'WELLE / 5     GEGNER' : mode.label.toUpperCase() + (s.cfg.mode === 'control' ? ' / 60' : s.cfg.mode === 'arsenal' ? ' / 10' : s.cfg.mode === 'ffa' ? ' / 15' : ''), w / 2, 66, 10, '#8eaaa9', 'center');
      text(s.cfg.mode === 'ffa' ? 'JEDER GEGEN JEDEN' : s.cfg.mode === 'survival' ? 'EURE CREW' : s.cfg.mode === 'tactical' ? owner.team === 0 ? 'ANGRIFF' : 'VERTEIDIGUNG' : owner.team === 0 ? 'TEAM CYAN' : 'TEAM KORALLE', 28, 32, 13, owner.team === 0 ? '#a5ece4' : '#f0b195');
      text('STATION NEXUS', 28, 51, 10, '#c0cfcf');
      // Team radar deliberately omits opponents hidden behind cover.
      panel(28, 70, 148, 141); h.save(); h.translate(102, 140); h.scale(2, 2);
      h.fillStyle = '#78939a66'; W.boxes.forEach(b => h.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d));
      if (['tactical', 'control'].includes(s.cfg.mode)) W.sites.forEach((a, i) => { const z = s.cfg.mode === 'control' && s.zones[i]; h.strokeStyle = z ? z.contested ? '#fff1a1' : z.owner === 0 ? '#69e8ee' : z.owner === 1 ? '#ff997e' : '#e0e9d8' : a.key === 'A' ? '#d7ed95' : '#f4b094'; h.lineWidth = 0.6; h.beginPath(); h.arc(a.x, a.z, a.r, 0, Math.PI * 2); h.stroke(); text(a.key, a.x, a.z, 4.5, h.strokeStyle, 'center'); });
      s.actors.filter(a => a.alive && (s.cfg.mode === 'ffa' ? a.id === owner.id : a.team === owner.team)).forEach(a => { h.fillStyle = a.id === owner.id ? '#ffffff' : '#7bddda'; h.beginPath(); h.arc(a.x, a.z, 1.15, 0, Math.PI * 2); h.fill(); });
      h.translate(p.x, p.z); h.rotate(-p.yaw); h.fillStyle = '#e7f4ce'; h.beginPath(); h.moveTo(0, -3.5); h.lineTo(-1.9, 1); h.lineTo(1.9, 1); h.fill(); h.restore();
      if (ranked.length) {
        panel(28, 220, 195, 78); text('BESTENLISTE', 38, 234, 9, '#c9d9b6');
        ranked.slice(0, 3).forEach((a, i) => { const kills = s.stats[a.id]?.kills || 0, place = 1 + ranked.filter(b => (s.stats[b.id]?.kills || 0) > kills).length; text(place + '. ' + (names[a.id] || 'Bot ' + (a.index + 1)).slice(0, 14) + ' · ' + kills, 38, 254 + i * 16, 11, a.id === owner.id ? '#dfedac' : '#d0dce0'); });
      }
      text(names[owner.id] || 'OPERATOR', 28, ht - 83, 12, '#b5cdcf');
      text(String(Math.ceil(owner.hp)).padStart(3, '0'), 28, ht - 49, 39, owner.hp < 30 ? '#ff997e' : '#e9efdf');
      text('GESUNDHEIT', 29, ht - 19, 10, '#92a8ae');
      text('◇ ' + Math.ceil(owner.armor), 143, ht - 44, 20, '#a9cad5');
      h.fillStyle = '#ddebca'; h.fillRect(28, ht - 4, Math.max(0, owner.hp) * 1.9, 3);
      const weapon = W.weapons[owner.weapon];
      text(weapon.name, w - 29, ht - 87, 13, '#aed5cf', 'right');
      text(owner.reload > 0 ? 'LÄDT …' : owner.ammo + ' / ' + owner.reserve, w - 27, ht - 51, 36, '#e9efdf', 'right');
      text('AUTO-RELOAD  ·  RAUCH ' + owner.smoke, w - 29, ht - 20, 10, '#a8bec5', 'right');
      if (owner.reload > 0) { h.fillStyle = '#415862'; h.fillRect(w - 228, ht - 5, 200, 3); h.fillStyle = weapon.color; h.fillRect(w - 228, ht - 5, 200 * (1 - owner.reload / weapon.reload), 3); }
      text(height < 460 ? 'LINKS BEWEGEN  ·  RECHTS ZIELEN  ·  FEUER HALTEN + ZIEHEN' : s.cfg.mode === 'arsenal' ? 'WASD BEWEGEN  ·  WAFFENWECHSEL AUTOMATISCH' : 'WASD BEWEGEN  ·  1–0 WAFFEN' + (s.cfg.mode === 'tactical' ? '  ·  E INTERAGIEREN' : ''), w / 2, ht - 20, 10, '#b0c1c1', 'center');
      const cx = w / 2, cy = ht / 2, gap = 5 + (p.recoil || 0) * 12;
      if (owner.quickFlash > 0) text('QUICKSCOPE', cx, cy + 43, 15, '#e2d6ff', 'center');
      if (owner.alive) {
        if (owner.input?.aim && weapon.zoom) {
          h.strokeStyle = '#081923'; h.lineWidth = 2; const radius = Math.min(w, ht) * 0.33;
          h.beginPath(); h.arc(cx, cy, radius, 0, Math.PI * 2); h.stroke();
          h.beginPath(); h.moveTo(cx - radius, cy); h.lineTo(cx - 18, cy); h.moveTo(cx + 18, cy); h.lineTo(cx + radius, cy); h.moveTo(cx, cy - radius); h.lineTo(cx, cy - 18); h.moveTo(cx, cy + 18); h.lineTo(cx, cy + radius); h.stroke();
          text(weapon.zoom === 30 ? '3× · LONGBOW' : '2× · MR-9', cx, cy + radius + 16, 10, '#d1e8e0', 'center');
        }
        h.strokeStyle = owner.hit > 0 ? '#ffcc83' : '#def8df'; h.lineWidth = 1.5;
        h.beginPath(); h.moveTo(cx - gap - 6, cy); h.lineTo(cx - gap, cy); h.moveTo(cx + gap, cy); h.lineTo(cx + gap + 6, cy); h.moveTo(cx, cy - gap - 6); h.lineTo(cx, cy - gap); h.moveTo(cx, cy + gap); h.lineTo(cx, cy + gap + 6); h.stroke();
        if (owner.hit > 0) { h.strokeStyle = '#fff4cc'; h.beginPath(); for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { h.moveTo(cx + a * 9, cy + b * 9); h.lineTo(cx + a * 16, cy + b * 16); } h.stroke(); }
      }
      if (owner.hurt > 0) { h.strokeStyle = `rgba(236,100,78,${owner.hurt * 1.8})`; h.lineWidth = 24; h.strokeRect(0, 0, w, ht); }
      this.feed.filter(e => e.until > this.clock).forEach((e, i) => { panel(w - 336, 94 + i * 31, 308, 27); text(e.text, w - 40, 108 + i * 31, 11, '#decbc2', 'right'); });
      const cue = BreachFeedback.objective(s, owner);
      if (owner.alive && s.phase === 'live') {
        let arrow = '';
        if (cue.target && !cue.ready && cue.distance > 3) {
          const bearing = Math.atan2(-(cue.target.x - owner.x), -(cue.target.z - owner.z)) - owner.yaw;
          const relative = Math.atan2(Math.sin(bearing), Math.cos(bearing)); arrow = Math.abs(relative) > 2.5 ? '↶ ' : Math.abs(relative) < 0.3 ? '↑ ' : relative > 0 ? '← ' : '→ ';
        }
        panel(cx - 200, 88, 400, 46); text(arrow + cue.title.toUpperCase(), cx, 103, 15, '#e2eebb', 'center');
        text(cue.detail, cx, 123, 11, '#b9d1d0', 'center');
        if (cue.ready || cue.progress > 0) { panel(cx - 200, cy + 72, 400, 40); text(cue.detail.toUpperCase(), cx, cy + 91, 15, '#e6edb9', 'center'); }
        if (cue.progress > 0) { h.fillStyle = '#dfeda7'; h.fillRect(cx - 200, cy + 112, 400 * cue.progress, 4); }
      }
      if (s.phase === 'prep') {
        panel(cx - 240, 101, 480, 75); text('AUSRÜSTEN. POSITION HALTEN.', cx, 125, 18, '#e8efc5', 'center');
        text(s.cfg.mode === 'arsenal' ? 'JEDER TEAM-ABSCHUSS BRINGT DIE NÄCHSTE WAFFE' : '10 WAFFEN · JEDERZEIT IM ARSENAL WECHSELN', cx, 155, 13, '#b5ccd1', 'center');
        text(cue.detail, cx, ht - 124, 15, '#edf1d1', 'center');
      }
      if (!owner.alive && s.phase === 'live') { panel(cx - 230, ht - 165, 460, 57); text(mode.respawn ? 'WIEDEREINSTIEG IN ' + Math.ceil(owner.respawn) : s.cfg.mode === 'survival' ? 'ZURÜCK ZUR NÄCHSTEN WELLE' : 'ZUSCHAUEN · ' + (names[p.id] || 'TEAM'), cx, ht - 139, 17, '#f0c0a8', 'center'); }
      if (s.phase === 'roundOver' || s.phase === 'end') {
        const draw = s.cfg.mode === 'ffa' ? s.result.winnerId == null : s.result.team === null, won = s.cfg.mode === 'ffa' ? s.result.winnerId === owner.id : s.result.team === owner.team;
        h.fillStyle = '#06141bad'; h.fillRect(0, 0, w, ht); text(draw ? 'UNENTSCHIEDEN' : won ? 'GEWONNEN' : 'VERLOREN', cx, cy - 42, 38, won ? '#dceaa8' : '#f3b598', 'center');
        if (s.cfg.mode === 'ffa' && !draw) text('SIEGER: ' + (names[s.result.winnerId] || 'Sicherheits-Bot'), cx, cy - 12, 13, '#bde1e0', 'center');
        text(s.result.reason.toUpperCase(), cx, cy + 8, 16, '#d4e2e5', 'center'); text(s.phase === 'end' ? 'MATCH BEENDET · REVANCHE IM RAUM' : (s.cfg.mode === 'survival' ? 'NÄCHSTE WELLE IN ' : 'NÄCHSTE RUNDE IN ') + Math.ceil(s.remaining), cx, cy + 49, 12, '#b2c7ce', 'center');
      }
      if (owner.input && owner.input.score) this.scoreboard(s, names, w, ht, text, panel);
    }
    scoreboard(s, names, w, h, text, panel) {
      const height = Math.min(h - 40, Math.max(240, 80 + s.actors.length * 25)), top = (h - height) / 2;
      const row = Math.min(25, (height - 75) / Math.max(1, s.actors.length));
      panel(w / 2 - 250, top, 500, height); text('OPERATOR              K / T / QS', w / 2, top + 30, 16, '#dce8dc', 'center');
      (s.cfg.mode === 'ffa' ? BreachFeedback.ranking(s) : s.actors).forEach((p, i) => text((names[p.id] || 'Bot ' + (p.index + 1)).padEnd(20) + (s.stats[p.id]?.kills || 0) + ' / ' + (s.stats[p.id]?.deaths || 0) + ' / ' + (s.stats[p.id]?.quickscopes || 0), w / 2 - 218, top + 64 + i * row, Math.min(13, row - 3), s.cfg.mode === 'ffa' ? '#d9e8de' : p.team === 0 ? '#a2e5e4' : '#efb59d'));
    }
    dispose() {
      const geo = new Set(), mats = new Set();
      this.scene.traverse(o => { if (o.geometry) geo.add(o.geometry); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); });
      geo.forEach(g => g.dispose()); mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      this.renderer.dispose(); this.renderer.domElement.remove(); this.hud.remove();
    }
  }
  window.BreachView = View;
})();
