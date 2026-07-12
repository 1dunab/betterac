// ===== Modul: MICRO RACER (3D) ==============================
// Micro-Machines-Rennen in echtem 3D (three.js, window.THREE).
// Kamera folgt dem Feld, wer hinten rausfällt ist raus.
// Physik läuft 2D auf der Streckenebene (x/z), gerendert wird 3D.
// ============================================================
registerGame({ key: 'racer', screen: function () {
  const W3 = 960, H3 = 600, ROAD_W = 9;

  // ---------- Biome-Definitionen (Natur-Dioramen) ----------
  const BIOMES = {
    desert: {
      label: 'Wüste', sky: '#8ecdf5', fog: '#e8c48f', ground: '#d9a05b', ground2: '#c98f4a',
      road: '#6b6560', stripe: '#f5efe4',
      deco: [
        { kind: 'cactus', n: 46, c: '#3f9b4f' },
        { kind: 'rock', n: 30, c: '#a8927c' }
      ]
    },
    snow: {
      label: 'Schnee', sky: '#bcd7f5', fog: '#dfeafc', ground: '#eef4fb', ground2: '#d9e6f5',
      road: '#4d5766', stripe: '#e8eef7',
      deco: [
        { kind: 'fir', n: 52, c: '#2f6d4f' },
        { kind: 'rock', n: 22, c: '#b9cde0' }
      ]
    },
    beach: {
      label: 'Strand', sky: '#8ed4f0', fog: '#ffe9c4', ground: '#f2dfae', ground2: '#e8d094',
      road: '#7a7268', stripe: '#fff6df',
      deco: [
        { kind: 'palm', n: 34, c: '#3fae62' },
        { kind: 'rock', n: 18, c: '#c9b391' }
      ],
      water: '#2f9ec9'
    }
  };

  // Handgebaute Kontrollpunkte (x/z), geschlossene Kurve
  const TRACKS = {
    desert: [[-150, -60], [-60, -110], [60, -95], [150, -55], [165, 30], [95, 60], [30, 25], [-40, 55], [-90, 110], [-165, 55]],
    snow: [[-140, -70], [-30, -100], [80, -90], [140, -30], [90, 20], [140, 80], [40, 105], [-45, 60], [-115, 95], [-160, 10]],
    beach: [[-160, -40], [-80, -100], [40, -110], [140, -70], [170, 20], [110, 90], [0, 110], [-100, 90], [-150, 30], [-175, -5]]
  };
  function randomTrack() {
    const pts = [], n = 10;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + (Math.random() - 0.5) * 0.28;
      const r = 95 + Math.random() * 75;
      pts.push([Math.cos(a) * r * 1.25, Math.sin(a) * r]);
    }
    return pts;
  }

  // ---------- Renderer / Canvas (einmalig, über Rennen hinweg) ----------
  let renderer = null, wrap3d = null, hud = null, hctx = null;
  function ensureRenderer() {
    if (renderer) return true;
    const THREE = window.THREE;
    if (!THREE) return false;
    try {
      wrap3d = document.createElement('div');
      wrap3d.style.cssText = 'position:relative; display:none; line-height:0; width:fit-content; margin:0 auto;';
      const c3 = document.createElement('canvas');
      c3.width = W3; c3.height = H3;
      hud = document.createElement('canvas');
      hud.width = W3; hud.height = H3;
      // background/box-shadow explizit neutralisieren — die globale canvas-Regel
      // in screen.html würde das Overlay sonst deckend über die 3D-Szene legen
      hud.style.cssText = 'position:absolute; left:0; top:0; width:100%; height:100%; pointer-events:none;'
        + 'background:transparent; border-radius:0; box-shadow:none; max-width:none; max-height:none;';
      wrap3d.append(c3, hud);
      cv.insertAdjacentElement('afterend', wrap3d);
      hctx = hud.getContext('2d');
      renderer = new THREE.WebGLRenderer({ canvas: c3, antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(W3, H3, false);
      return true;
    } catch (e) {
      if (wrap3d) { wrap3d.remove(); wrap3d = null; }
      renderer = null;
      return false;
    }
  }
  function show3d(on) {
    if (!wrap3d) return;
    wrap3d.style.display = on ? 'block' : 'none';
    cv.style.display = on ? 'none' : '';
  }

  // ---------- Spielzustand ----------
  let THREE, scene, camera, biome, samples = [], segLen = 1, trackLen = 1;
  let racers = {}, order = [], points = {}, targetPoints = 5;
  let phase = 'idle'; // countdown | race | heatOver | final
  let lastT = 0, camPos = null, camAim = null, phaseAt = 0, lastRankSent = 0;
  let heatNo = 0, elimOrder = [], heatWinner = null, champion = null, poofs = [];
  let features = [], parts = [];

  // Fahrphysik (Arcade)
  const MAX_SPEED = 26, ACCEL = 22, TURN = 2.5, GRIP = 7;
  const OFFROAD_FACTOR = 0.42, CAR_R = 1.5;
  const NITRO_MS = 2200, NITRO_CD = 6500, NITRO_BOOST = 1.5;
  // Elimination: Rückstand zum Führenden (Streckenmeter) + Gnadenfrist.
  // Grenze knapp hinter der Kamera-Sicht — wer nichts mehr sieht, ist raus.
  const ELIM_DIST = 36, GRACE_MS = 1600;
  const GRAVITY = 34;

  // ---------- Strecke bauen ----------
  function sampleTrack(ctrl) {
    const pts = ctrl.map(p => new THREE.Vector3(p[0], 0, p[1]));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.55);
    const N = 700;
    samples = [];
    trackLen = curve.getLength();
    segLen = trackLen / N;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t).normalize();
      const n = new THREE.Vector3(-tan.z, 0, tan.x); // links
      samples.push({ p, t: tan, n });
    }
  }

  function ribbon(half, yOff, colorFn) {
    // Baut ein Band entlang der Samples; colorFn(i) -> [r,g,b] oder null für einheitlich
    const N = samples.length;
    const pos = new Float32Array(N * 2 * 3), col = colorFn ? new Float32Array(N * 2 * 3) : null;
    const idx = [];
    for (let i = 0; i < N; i++) {
      const s = samples[i];
      const l = s.p.clone().addScaledVector(s.n, half), r = s.p.clone().addScaledVector(s.n, -half);
      pos.set([l.x, yOff, l.z, r.x, yOff, r.z], i * 6);
      if (col) { const c = colorFn(i); col.set([c[0], c[1], c[2], c[0], c[1], c[2]], i * 6); }
      const a = i * 2, b = ((i + 1) % N) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1); // Winding: Normale nach oben
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function offsetRibbon(center, half, yOff, colorFn) {
    // Band um eine seitlich versetzte Mittellinie (für Curbs)
    const N = samples.length;
    const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 3);
    const idx = [];
    for (let i = 0; i < N; i++) {
      const s = samples[i];
      const l = s.p.clone().addScaledVector(s.n, center + half), r = s.p.clone().addScaledVector(s.n, center - half);
      pos.set([l.x, yOff, l.z, r.x, yOff, r.z], i * 6);
      const c = colorFn(i);
      col.set([c[0], c[1], c[2], c[0], c[1], c[2]], i * 6);
      const a = i * 2, b = ((i + 1) % N) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1); // Winding: Normale nach oben
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const col3 = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

  function decoMesh(kind, c) {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: c });
    if (kind === 'cactus') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 6.5, 7), mat);
      body.position.y = 3.2; g.add(body);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 3, 6), mat);
      arm.position.set(1.5, 4.2, 0); arm.rotation.z = -0.5; g.add(arm);
    } else if (kind === 'fir') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 2, 6), new THREE.MeshLambertMaterial({ color: '#7a5230' }));
      trunk.position.y = 1; g.add(trunk);
      [[3.6, 2.6], [2.9, 4.4], [2.1, 6]].forEach(([r, y]) => {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 3.4, 8), mat);
        cone.position.y = y; g.add(cone);
        const snow = new THREE.Mesh(new THREE.ConeGeometry(r * 0.65, 1.3, 8), new THREE.MeshLambertMaterial({ color: '#f4f9ff' }));
        snow.position.y = y + 1.15; g.add(snow);
      });
    } else if (kind === 'palm') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 7, 6), new THREE.MeshLambertMaterial({ color: '#9c6b3f' }));
      trunk.position.y = 3.5; trunk.rotation.z = 0.12; g.add(trunk);
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.8, 4.6, 4), mat);
        const a = i / 6 * Math.PI * 2;
        leaf.position.set(Math.cos(a) * 1.7 + 0.8, 7.1, Math.sin(a) * 1.7);
        leaf.rotation.set(Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15);
        g.add(leaf);
      }
    } else { // rock
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.6 + Math.random() * 1.6, 0), mat);
      rock.position.y = 0.9; rock.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      g.add(rock);
    }
    return g;
  }

  function distToRoad(x, z) {
    // grobe Distanz zur Streckenmitte (für Deko-Platzierung)
    let best = 1e9;
    for (let i = 0; i < samples.length; i += 6) {
      const dx = samples[i].p.x - x, dz = samples[i].p.z - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function buildScene(biomeKey, ctrl) {
    biome = BIOMES[biomeKey] || BIOMES.desert;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(biome.sky);
    scene.fog = new THREE.Fog(biome.fog, 260, 620);

    scene.add(new THREE.HemisphereLight(biome.sky, biome.ground, 0.95));
    const sun = new THREE.DirectionalLight('#fff7e8', 1.35);
    sun.position.set(140, 190, 80);
    scene.add(sun);

    sampleTrack(ctrl);

    // Boden: großes Diorama-Rund in zwei Tönen
    const ground = new THREE.Mesh(new THREE.CircleGeometry(430, 48), new THREE.MeshLambertMaterial({ color: biome.ground }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.12; scene.add(ground);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 330;
      const patch = new THREE.Mesh(new THREE.CircleGeometry(8 + Math.random() * 22, 14), new THREE.MeshLambertMaterial({ color: biome.ground2 }));
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(Math.cos(a) * r, -0.06, Math.sin(a) * r);
      scene.add(patch);
    }
    if (biome.water) {
      const water = new THREE.Mesh(new THREE.CircleGeometry(1400, 40), new THREE.MeshLambertMaterial({ color: biome.water }));
      water.rotation.x = -Math.PI / 2; water.position.y = -0.55; scene.add(water);
    }

    // Fahrbahn + Mittellinie + Curbs
    scene.add(new THREE.Mesh(ribbon(ROAD_W / 2, 0.02), new THREE.MeshLambertMaterial({ color: biome.road })));
    const dash = ribbon(0.22, 0.06, (i) => (i % 16) < 8 ? col3(biome.stripe) : col3(biome.road));
    scene.add(new THREE.Mesh(dash, new THREE.MeshLambertMaterial({ vertexColors: true })));
    const curbCol = (i) => (i % 12) < 6 ? col3('#e04a3a') : col3('#f2f2f2');
    scene.add(new THREE.Mesh(offsetRibbon(ROAD_W / 2 + 0.45, 0.45, 0.04, curbCol), new THREE.MeshLambertMaterial({ vertexColors: true })));
    scene.add(new THREE.Mesh(offsetRibbon(-ROAD_W / 2 - 0.45, 0.45, 0.04, curbCol), new THREE.MeshLambertMaterial({ vertexColors: true })));

    // Startlinie (Schachbrett-Textur)
    const check = document.createElement('canvas'); check.width = 64; check.height = 16;
    const cc = check.getContext('2d');
    for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) { cc.fillStyle = (x + y) % 2 ? '#111' : '#fff'; cc.fillRect(x * 8, y * 8, 8, 8); }
    const startTex = new THREE.CanvasTexture(check);
    const s0 = samples[0];
    const startGeo = new THREE.PlaneGeometry(ROAD_W, 2.6);
    const start = new THREE.Mesh(startGeo, new THREE.MeshBasicMaterial({ map: startTex }));
    start.rotation.x = -Math.PI / 2;
    start.position.copy(s0.p).y = 0.07;
    start.rotation.z = Math.atan2(s0.t.x, s0.t.z);
    scene.add(start);

    placeFeatures();

    // Deko außerhalb der Strecke verstreuen
    biome.deco.forEach(d => {
      for (let i = 0; i < d.n; i++) {
        for (let tries = 0; tries < 14; tries++) {
          const a = Math.random() * Math.PI * 2, r = 25 + Math.random() * 300;
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          if (distToRoad(x, z) > ROAD_W / 2 + 6) {
            const m = decoMesh(d.kind, d.c);
            const sc = 0.7 + Math.random() * 0.9;
            m.scale.set(sc, sc, sc);
            m.position.set(x, 0, z);
            m.rotation.y = Math.random() * Math.PI * 2;
            scene.add(m);
            break;
          }
        }
      }
    });

    camera = new THREE.PerspectiveCamera(55, W3 / H3, 0.5, 1600);
    camPos = null; camAim = null;
  }

  // ---------- Power-ups auf der Strecke ----------
  function chevronTexture() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#0f7a3d'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#7dffb1'; g.lineWidth = 9; g.lineCap = 'round';
    [14, 38].forEach(y => {
      g.beginPath(); g.moveTo(12, y + 12); g.lineTo(32, y - 2); g.lineTo(52, y + 12); g.stroke();
    });
    return new THREE.CanvasTexture(c);
  }

  function rampMesh(width) {
    // Keil: flach vorne, 1.5 hoch an der Absprungkante (lokal +x = Fahrtrichtung)
    const L = 4.2, H = 1.5, hw = width / 2;
    const v = new Float32Array([
      // schräge Fläche
      -L, 0, -hw, -L, 0, hw, 0, H, hw,
      -L, 0, -hw, 0, H, hw, 0, H, -hw,
      // Rückwand
      0, 0, -hw, 0, H, hw, 0, 0, hw,
      0, 0, -hw, 0, H, -hw, 0, H, hw,
      // Seiten
      -L, 0, -hw, 0, H, -hw, 0, 0, -hw,
      -L, 0, hw, 0, 0, hw, 0, H, hw
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#ff9f0a' }));
  }

  function placeFeatures() {
    features = [];
    const N = samples.length;
    const isStraight = (i) => samples[i].t.dot(samples[(i + 16) % N].t) > 0.995;
    const farFromOthers = (i) => features.every(f => {
      const d = Math.abs(((i - f.idx) % N + N) % N);
      return Math.min(d, N - d) > 55;
    });
    const spots = [];
    for (let i = 40; i < N - 40; i += 7) if (isStraight(i)) spots.push(i);
    shuffle(spots);
    const wanted = [
      { kind: 'ramp', n: 2 }, { kind: 'boost', n: 3 }, { kind: 'oil', n: 3 }
    ];
    for (const w of wanted) {
      let placed = 0;
      for (const i of spots) {
        if (placed >= w.n) break;
        if (!farFromOthers(i)) continue;
        const s = samples[i];
        if (w.kind === 'ramp') {
          const side = Math.random() < 0.5 ? 1 : -1, lat = side * ROAD_W / 4;
          const m = rampMesh(ROAD_W / 2 - 0.4);
          m.position.copy(s.p).addScaledVector(s.n, lat);
          m.rotation.y = -Math.atan2(s.t.z, s.t.x);
          scene.add(m);
          features.push({ kind: 'ramp', idx: i, lat, halfW: ROAD_W / 4 - 0.3 });
        } else if (w.kind === 'boost') {
          const lat = (Math.random() * 2 - 1) * 2;
          const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.6),
            new THREE.MeshBasicMaterial({ map: chevronTexture(), transparent: true, opacity: 0.92 }));
          m.rotation.x = -Math.PI / 2;
          m.rotation.z = Math.atan2(s.t.x, s.t.z) + Math.PI;
          m.position.copy(s.p).addScaledVector(s.n, lat); m.position.y = 0.08;
          scene.add(m);
          features.push({ kind: 'boost', idx: i, lat, halfW: 1.6 });
        } else {
          const lat = (Math.random() * 2 - 1) * 2.4;
          const m = new THREE.Mesh(new THREE.CircleGeometry(1.9, 16),
            new THREE.MeshBasicMaterial({ color: '#15151c', transparent: true, opacity: 0.88 }));
          m.rotation.x = -Math.PI / 2; m.scale.x = 1.35;
          m.position.copy(s.p).addScaledVector(s.n, lat); m.position.y = 0.07;
          scene.add(m);
          features.push({ kind: 'oil', idx: i, lat, halfW: 1.9 });
        }
        placed++;
      }
    }
  }

  // ---------- Partikel (Nitro-Flammen, Staub) ----------
  function spawnPart(x, y, z, vx, vy, vz, color, life, size) {
    if (parts.length > 220) return;
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 5),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    m.position.set(x, y, z);
    scene.add(m);
    parts.push({ m, vx, vy, vz, born: performance.now(), life });
  }
  function updateParts(dt, now) {
    parts = parts.filter(p => {
      const f = (now - p.born) / p.life;
      if (f >= 1) { scene.remove(p.m); return false; }
      p.vy -= 9 * dt;
      p.m.position.x += p.vx * dt; p.m.position.y = Math.max(0.1, p.m.position.y + p.vy * dt); p.m.position.z += p.vz * dt;
      p.m.material.opacity = 0.85 * (1 - f);
      return true;
    });
  }
  function emitRacerParts(r, now, offroad) {
    const dirX = Math.cos(r.heading), dirZ = Math.sin(r.heading);
    if (now < r.nitroUntil || now < r.boostUntil) {
      spawnPart(r.x - dirX * 1.9, r.y + 0.6, r.z - dirZ * 1.9,
        -dirX * 6 + (Math.random() - 0.5) * 2, 1.5, -dirZ * 6 + (Math.random() - 0.5) * 2,
        Math.random() < 0.5 ? '#ff9f0a' : '#ffd60a', 320, 0.3);
    }
    if (r.y <= 0 && offroad && r.speed > 8 && Math.random() < 0.65) {
      spawnPart(r.x - dirX * 1.4, 0.25, r.z - dirZ * 1.4,
        (Math.random() - 0.5) * 3, 2.2, (Math.random() - 0.5) * 3, biome.ground2, 480, 0.34);
    }
    if (r.y <= 0 && Math.abs(r.steer) > 0.65 && r.speed > 16 && Math.random() < 0.5) {
      spawnPart(r.x - dirX * 1.2, 0.2, r.z - dirZ * 1.2,
        (Math.random() - 0.5) * 2.5, 1.6, (Math.random() - 0.5) * 2.5, '#cfcfcf', 380, 0.24);
    }
  }

  // ---------- Autos ----------
  function carMesh(color) {
    const g = new THREE.Group();
    const paint = new THREE.MeshLambertMaterial({ color });
    const dark = new THREE.MeshLambertMaterial({ color: '#1c1f26' });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.75, 1.55), paint);
    body.position.y = 0.75; g.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 1.15), paint);
    nose.position.set(1.95, 0.62, 0); g.add(nose);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 1.15), new THREE.MeshLambertMaterial({ color: '#cfe8ff' }));
    cab.position.set(-0.2, 1.35, 0); g.add(cab);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.16, 1.8), paint);
    wing.position.set(-1.7, 1.35, 0); g.add(wing);
    const wingPost = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), dark);
    wingPost.position.set(-1.62, 1.05, 0); g.add(wingPost);
    [[1.05, 0.95], [1.05, -0.95], [-1.15, 0.95], [-1.15, -0.95]].forEach(([wx, wz]) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.35, 10), dark);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.42, wz);
      g.add(wheel);
    });
    return g;
  }

  function blobShadow() {
    const m = new THREE.Mesh(new THREE.CircleGeometry(2.0, 14),
      new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28 }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  function spawnRacers() {
    racers = {};
    const N = samples.length;
    order.forEach((id, i) => {
      const row = Math.floor(i / 2), side = (i % 2 === 0) ? 1 : -1;
      const si = (((N - 4) - row * Math.ceil(5.5 / segLen)) % N + N) % N;
      const s = samples[si];
      const pos = s.p.clone().addScaledVector(s.n, side * 2.2);
      const heading = Math.atan2(s.t.z, s.t.x);
      const mesh = carMesh(players[id] ? players[id].color : '#999');
      const shadow = blobShadow();
      scene.add(mesh); scene.add(shadow);
      racers[id] = {
        x: pos.x, z: pos.z, y: 0, vy: 0, heading, speed: 0, vx: 0, vz: 0, steer: 0,
        idx: si, lap: 0, progress: si - N, alive: true, dangerSince: 0,
        nitroUntil: 0, nitroReadyAt: 0, nitroReadySent: true, boostUntil: 0, oilUntil: 0,
        mesh, shadow
      };
      syncMesh(racers[id]);
    });
  }

  function syncMesh(r) {
    r.mesh.position.set(r.x, r.y, r.z);
    r.mesh.rotation.y = -r.heading;
    r.mesh.rotation.z = -r.steer * 0.09;
    r.mesh.rotation.x = r.y > 0 ? clamp(-r.vy * 0.02, -0.28, 0.28) : 0;
    r.mesh.visible = r.alive;
    // Blob-Schatten bleibt am Boden und schrumpft beim Sprung
    const sh = 1 / (1 + r.y * 0.14);
    r.shadow.scale.setScalar(sh);
    r.shadow.material.opacity = 0.28 * sh;
    r.shadow.position.set(r.x, 0.04, r.z);
    r.shadow.visible = r.alive;
  }

  function nearestIdx(r) {
    // lokale Suche um den letzten bekannten Index
    const N = samples.length;
    let best = r.idx, bestD = Infinity;
    for (let o = -30; o <= 45; o++) {
      const i = ((r.idx + o) % N + N) % N;
      const dx = samples[i].p.x - r.x, dz = samples[i].p.z - r.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function updateRacer(id, r, dt, now) {
    if (!r.alive) return;
    const prevIdx = r.idx;
    r.idx = nearestIdx(r);
    const s = samples[r.idx];
    const distC = Math.hypot(r.x - s.p.x, r.z - s.p.z);
    const offroad = distC > ROAD_W / 2 + 0.9;

    if (r.y > 0) {
      // Flugphase: keine Lenkung, kein Grip — Ballistik bis zur Landung
      r.vy -= GRAVITY * dt;
      r.y += r.vy * dt;
      r.x += r.vx * dt; r.z += r.vz * dt;
      if (r.y <= 0) {
        r.y = 0; r.vy = 0;
        for (let i = 0; i < 6; i++) {
          spawnPart(r.x + (Math.random() - 0.5) * 2, 0.25, r.z + (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 5, 2.5, (Math.random() - 0.5) * 5, biome.ground2, 420, 0.3);
        }
      }
    } else {
      // Zielgeschwindigkeit: Auto-Gas + Modifikatoren
      let target = MAX_SPEED;
      if (offroad) target *= OFFROAD_FACTOR;
      if (now < r.nitroUntil || now < r.boostUntil) target *= NITRO_BOOST;
      r.speed += clamp(target - r.speed, -ACCEL * 1.4 * dt, ACCEL * dt);

      // Lenken + Grip (Öl = kaum Grip, übersteuert)
      const slippery = now < r.oilUntil;
      r.heading += r.steer * TURN * dt * clamp(r.speed / MAX_SPEED, 0.25, 1) * (slippery ? 1.6 : 1);
      const grip = slippery ? 1.1 : GRIP;
      const fx = Math.cos(r.heading) * r.speed, fz = Math.sin(r.heading) * r.speed;
      const k = Math.min(1, grip * dt);
      r.vx += (fx - r.vx) * k; r.vz += (fz - r.vz) * k;
      r.x += r.vx * dt; r.z += r.vz * dt;

      // Power-ups einsammeln (nur am Boden)
      const N = samples.length;
      for (const f of features) {
        const d = ((r.idx - f.idx) % N + N) % N;
        if (d > 3 && d < N - 3) continue;
        const lat = (r.x - s.p.x) * s.n.x + (r.z - s.p.z) * s.n.z;
        if (Math.abs(lat - f.lat) > f.halfW) continue;
        if (f.kind === 'boost') r.boostUntil = Math.max(r.boostUntil, now + 1300);
        else if (f.kind === 'oil') r.oilUntil = Math.max(r.oilUntil, now + 1300);
        else if (f.kind === 'ramp' && r.speed > 9) { r.vy = 9.5 + r.speed * 0.16; r.y = 0.05; }
      }
    }

    emitRacerParts(r, now, offroad);

    // Fortschritt / Runden
    const N = samples.length;
    if (prevIdx > N - 60 && r.idx < 60) r.lap++;
    else if (prevIdx < 60 && r.idx > N - 60) r.lap--;
    r.progress = r.lap * N + r.idx;

    // Nitro-Cooldown-Meldung
    if (!r.nitroReadySent && now >= r.nitroReadyAt) {
      r.nitroReadySent = true;
      ac.message(id, { t: 'raceYou', nitro: true });
    }
  }

  function collideCars() {
    const ids = order.filter(id => racers[id] && racers[id].alive);
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const A = racers[ids[a]], B = racers[ids[b]];
      const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz) || 0.01;
      if (d < CAR_R * 2) {
        const nx = dx / d, nz = dz / d, push = (CAR_R * 2 - d) / 2;
        A.x -= nx * push; A.z -= nz * push; B.x += nx * push; B.z += nz * push;
        const av = A.vx * nx + A.vz * nz, bv = B.vx * nx + B.vz * nz, kick = (bv - av) * 0.7;
        A.vx += kick * nx; A.vz += kick * nz; B.vx -= kick * nx; B.vz -= kick * nz;
      }
    }
  }

  const aliveIds = () => order.filter(id => racers[id] && racers[id].alive);
  function standings() {
    return order.filter(id => racers[id]).slice()
      .sort((a, b) => (racers[b].alive - racers[a].alive) || (racers[b].progress - racers[a].progress));
  }
  const leaderId = () => standings().find(id => racers[id].alive);

  function sendRanks(now) {
    if (now - lastRankSent < 600) return;
    lastRankSent = now;
    const st = standings();
    st.forEach((id, i) => { if (racers[id].alive) ac.message(id, { t: 'raceYou', rank: i + 1 }); });
  }

  // ---------- Kamera folgt dem Führenden ----------
  function updateCamera(dt) {
    const lead = leaderId();
    const r = lead ? racers[lead] : null;
    let behind, aim;
    if (r) {
      const s = samples[r.idx];
      behind = new THREE.Vector3(r.x, 0, r.z).addScaledVector(s.t, -25);
      behind.y = 14;
      const aheadS = samples[(r.idx + Math.round(20 / segLen)) % samples.length];
      aim = new THREE.Vector3().copy(aheadS.p); aim.y = 1.5;
    } else {
      const s = samples[0];
      behind = s.p.clone().addScaledVector(s.t, -28); behind.y = 15;
      aim = s.p.clone(); aim.y = 2;
    }
    if (!camPos) { camPos = behind.clone(); camAim = aim.clone(); }
    camPos.lerp(behind, Math.min(1, dt * 2.6));
    camAim.lerp(aim, Math.min(1, dt * 3.2));
    camera.position.copy(camPos);
    camera.lookAt(camAim);
  }

  // ---------- Elimination / Heats ----------
  function poofAt(x, z) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9 }));
    m.position.set(x, 1.2, z);
    scene.add(m);
    poofs.push({ m, born: performance.now() });
  }
  function updatePoofs(now) {
    poofs = poofs.filter(p => {
      const f = (now - p.born) / 600;
      if (f >= 1) { scene.remove(p.m); return false; }
      p.m.scale.setScalar(1 + f * 3.2);
      p.m.material.opacity = 0.9 * (1 - f);
      return true;
    });
  }

  function eliminate(id, now) {
    const r = racers[id];
    if (!r || !r.alive) return;
    r.alive = false; r.dangerSince = 0;
    syncMesh(r);
    poofAt(r.x, r.z);
    elimOrder.push(id);
    ac.message(id, { t: 'raceYou', out: true });
    const alive = aliveIds();
    if (alive.length <= 1) endHeat(alive[0] || null, now);
  }

  function checkElimination(now) {
    const lead = leaderId();
    if (!lead) return;
    const lp = racers[lead].progress;
    aliveIds().forEach(id => {
      if (id === lead) { racers[id].dangerSince = 0; return; }
      const r = racers[id];
      const behind = (lp - r.progress) * segLen;
      if (behind > ELIM_DIST) {
        if (!r.dangerSince) {
          r.dangerSince = now;
          ac.message(id, { t: 'raceYou', msg: '⚠️ Du fällst zurück — Vollgas!' });
        } else if (now - r.dangerSince > GRACE_MS) {
          eliminate(id, now);
        }
      } else {
        r.dangerSince = 0;
      }
    });
  }

  function endHeat(winnerId, now) {
    phase = 'heatOver';
    phaseAt = now + 4000;
    heatWinner = winnerId;
    // Gestaffelte Punkte nach Überlebensdauer: erster Rausflieger 0, Sieger n-1
    const ranking = elimOrder.slice();
    if (winnerId !== null) ranking.push(winnerId);
    ranking.forEach((id, i) => { if (points[id] !== undefined) points[id] += i; });
    order.forEach(id => ac.message(id, {
      t: 'raceScore', won: id === winnerId, points: points[id] || 0, target: targetPoints
    }));
  }

  function respawnHeat() {
    Object.values(racers).forEach(r => scene.remove(r.mesh, r.shadow));
    poofs.forEach(p => scene.remove(p.m)); poofs = [];
    parts.forEach(p => scene.remove(p.m)); parts = [];
    heatNo++; elimOrder = []; heatWinner = null;
    spawnRacers();
    phase = 'countdown';
    phaseAt = performance.now() + 3200;
    order.forEach(id => ac.message(id, { t: 'raceState', phase: 'countdown' }));
  }

  function afterHeat() {
    const best = Math.max(...order.map(id => points[id] || 0));
    const leaders = order.filter(id => (points[id] || 0) === best);
    if (best >= targetPoints && leaders.length === 1) {
      phase = 'final';
      champion = leaders[0];
      reportWinners([champion]);
      const h = hostId();
      order.forEach(id => ac.message(id, {
        t: 'raceFinal', winner: id === champion, name: nameOf(champion), host: id === h
      }));
      return;
    }
    respawnHeat();
  }

  // ---------- Simulation ----------
  function simulate(dt, now) {
    if (phase === 'countdown') {
      if (now >= phaseAt) {
        phase = 'race';
        phaseAt = now;
        order.forEach(id => ac.message(id, { t: 'raceState', phase: 'race' }));
      }
      return;
    }
    if (phase === 'heatOver') {
      // Sieger rollt weiter durchs Bild
      order.forEach(id => { const r = racers[id]; if (r && r.alive) { updateRacer(id, r, dt, now); syncMesh(r); } });
      if (now >= phaseAt) afterHeat();
      return;
    }
    if (phase !== 'race') return;
    order.forEach(id => { const r = racers[id]; if (r) updateRacer(id, r, dt, now); });
    collideCars();
    checkElimination(now);
    if (phase !== 'race') return; // Heat kann gerade geendet haben
    order.forEach(id => { const r = racers[id]; if (r) syncMesh(r); });
    sendRanks(now);
  }

  // ---------- HUD (2D-Overlay über dem 3D-Canvas) ----------
  function projectTo2d(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2 * W3, (1 - (v.y + 1) / 2) * H3];
  }

  function drawHud(now) {
    hctx.clearRect(0, 0, W3, H3);
    hctx.textBaseline = 'middle';

    // Namen über den Autos
    hctx.font = 'bold 14px system-ui,sans-serif'; hctx.textAlign = 'center';
    order.forEach(id => {
      const r = racers[id];
      if (!r || !r.alive) return;
      const p = projectTo2d(r.x, 2.6, r.z);
      if (!p) return;
      hctx.fillStyle = 'rgba(0,0,0,.45)';
      const name = shortName(id), w = hctx.measureText(name).width + 12;
      hctx.fillRect(p[0] - w / 2, p[1] - 11, w, 20);
      hctx.fillStyle = players[id] ? players[id].color : '#fff';
      hctx.fillText(name, p[0], p[1]);
    });

    // Titel + Punktestand
    hctx.textAlign = 'left';
    hctx.fillStyle = '#fff'; hctx.font = 'bold 24px system-ui,sans-serif';
    hctx.shadowColor = 'rgba(0,0,0,.55)'; hctx.shadowBlur = 6;
    hctx.fillText('🏎️ ' + biome.label, 18, 28);
    hctx.shadowBlur = 0;
    hctx.textAlign = 'right'; hctx.font = 'bold 15px system-ui,sans-serif';
    const st = standings();
    st.forEach((id, i) => {
      const r = racers[id];
      hctx.fillStyle = 'rgba(0,0,0,.4)';
      hctx.fillRect(W3 - 190, 14 + i * 26, 176, 22);
      hctx.fillStyle = players[id] ? players[id].color : '#888';
      hctx.beginPath(); hctx.arc(W3 - 176, 25 + i * 26, 6, 0, Math.PI * 2); hctx.fill();
      hctx.fillStyle = r.alive ? '#fff' : 'rgba(255,255,255,.45)';
      hctx.fillText((r.alive ? '' : '💥 ') + shortName(id) + ' · ' + (points[id] || 0) + 'P', W3 - 22, 25 + i * 26);
    });

    // Gefahr: Spieler kurz vorm Rausfliegen → roter Puls-Rand + Hinweis
    const inDanger = order.filter(id => racers[id] && racers[id].alive && racers[id].dangerSince);
    if (phase === 'race' && inDanger.length) {
      const pulse = 0.25 + 0.2 * Math.sin(now / 90);
      hctx.strokeStyle = 'rgba(255,60,40,' + pulse + ')';
      hctx.lineWidth = 22;
      hctx.strokeRect(0, 0, W3, H3);
      hctx.textAlign = 'center'; hctx.fillStyle = '#ff6b5e'; hctx.font = 'bold 24px system-ui,sans-serif';
      hctx.shadowColor = 'rgba(0,0,0,.6)'; hctx.shadowBlur = 8;
      hctx.fillText('⚠️ ' + inDanger.map(shortName).join(', ') + ' fällt zurück!', W3 / 2, H3 - 44);
      hctx.shadowBlur = 0;
    }

    // Countdown
    if (phase === 'countdown') {
      const left = Math.ceil((phaseAt - now) / 1000);
      hctx.textAlign = 'center'; hctx.fillStyle = '#fff';
      hctx.font = 'bold 110px system-ui,sans-serif';
      hctx.shadowColor = 'rgba(0,0,0,.6)'; hctx.shadowBlur = 14;
      hctx.fillText(left > 0 ? String(left) : 'GO!', W3 / 2, H3 / 2 - 30);
      if (heatNo > 0) { hctx.font = 'bold 30px system-ui,sans-serif'; hctx.fillText('Heat ' + (heatNo + 1), W3 / 2, H3 / 2 + 50); }
      hctx.shadowBlur = 0;
    } else if (phase === 'race' && now - phaseAt < 1100) {
      hctx.textAlign = 'center'; hctx.fillStyle = '#30d158';
      hctx.font = 'bold 110px system-ui,sans-serif';
      hctx.shadowColor = 'rgba(0,0,0,.6)'; hctx.shadowBlur = 14;
      hctx.fillText('GO!', W3 / 2, H3 / 2 - 30);
      hctx.shadowBlur = 0;
    }

    // Heat-Ende / Turnier-Finale
    if (phase === 'heatOver') {
      hctx.textAlign = 'center';
      hctx.fillStyle = 'rgba(0,0,0,.55)'; hctx.fillRect(0, H3 / 2 - 74, W3, 128);
      hctx.fillStyle = '#ffd60a'; hctx.font = 'bold 44px system-ui,sans-serif';
      hctx.fillText(heatWinner !== null ? '🏁 ' + nameOf(heatWinner) + ' überlebt den Heat!' : '🏁 Heat vorbei!', W3 / 2, H3 / 2 - 26);
      hctx.fillStyle = '#fff'; hctx.font = 'bold 20px system-ui,sans-serif';
      hctx.fillText(standings().map(id => shortName(id) + ' ' + (points[id] || 0)).join('  ·  ') + '   (Ziel: ' + targetPoints + ')', W3 / 2, H3 / 2 + 26);
    }
    if (phase === 'final' && champion !== null) {
      hctx.textAlign = 'center';
      hctx.fillStyle = 'rgba(0,0,0,.62)'; hctx.fillRect(0, 0, W3, H3);
      hctx.fillStyle = '#ffd60a'; hctx.font = 'bold 58px system-ui,sans-serif';
      hctx.fillText('👑 ' + nameOf(champion) + ' gewinnt!', W3 / 2, H3 / 2 - 110);
      const st = order.slice().sort((a, b) => (points[b] || 0) - (points[a] || 0));
      hctx.font = 'bold 26px system-ui,sans-serif';
      st.forEach((id, i) => {
        hctx.fillStyle = players[id] ? players[id].color : '#888';
        hctx.fillText((i + 1) + '.  ' + shortName(id) + ' — ' + (points[id] || 0) + ' Punkte', W3 / 2, H3 / 2 - 40 + i * 40);
      });
      hctx.fillStyle = 'rgba(255,255,255,.6)'; hctx.font = '17px system-ui,sans-serif';
      hctx.fillText('⭐ Host kann am Handy eine Revanche starten', W3 / 2, H3 - 60);
    }

    hctx.textAlign = 'right'; hctx.font = '14px system-ui,sans-serif'; hctx.fillStyle = 'rgba(255,255,255,.75)';
    hctx.fillText('Host kann am Handy abbrechen ✕', W3 - 14, H3 - 14);
  }

  return {
    acceptsJoin: false,
    start(ids, cfg) {
      if (!ensureRenderer()) { endToLobby('3D/WebGL wird von diesem Browser nicht unterstützt 😢'); return; }
      THREE = window.THREE;
      order = ids.slice();
      targetPoints = (cfg && cfg.targetPoints) || 5;
      points = {}; order.forEach(id => { points[id] = 0; });
      let key = (cfg && cfg.track) || 'desert';
      if (key === 'random') {
        const keys = Object.keys(BIOMES);
        buildScene(keys[Math.floor(Math.random() * keys.length)], randomTrack());
      } else {
        buildScene(key, TRACKS[key]);
      }
      spawnRacers();
      heatNo = 0; elimOrder = []; heatWinner = null; champion = null; poofs = [];
      phase = 'countdown';
      phaseAt = performance.now() + 3200;
      lastT = performance.now();
      show3d(true);
      order.forEach(id => ac.message(id, { t: 'raceState', phase: 'countdown' }));
    },
    stop() { show3d(false); scene = null; racers = {}; poofs = []; parts = []; features = []; },
    onDisconnect(id) {
      const r = racers[id];
      if (r) { scene && scene.remove(r.mesh, r.shadow); }
      order = order.filter(o => o !== id);
      elimOrder = elimOrder.filter(o => o !== id);
      delete racers[id]; delete points[id];
      if (order.length < 2) { endToLobby('Micro Racer braucht mind. 2 Spieler.'); return; }
      if (phase === 'race' && aliveIds().length <= 1) endHeat(aliveIds()[0] || null, performance.now());
      else if (phase === 'final' && champion !== null) {
        // Host könnte gegangen sein — Nochmal-Button an den neuen Host geben
        const h = hostId();
        order.forEach(o => ac.message(o, { t: 'raceFinal', winner: o === champion, name: nameOf(champion), host: o === h }));
      }
    },
    onMessage(id, d) {
      if (!d) return;
      if (d.t === 'raceAgain' && id === hostId() && phase === 'final') {
        points = {}; order.forEach(o => { points[o] = 0; });
        champion = null; heatNo = -1;
        respawnHeat();
        return;
      }
      const r = racers[id];
      if (!r || !r.alive) return;
      if (d.t === 'raceSteer') {
        r.steer = clamp(+d.s || 0, -1, 1);
      } else if (d.t === 'raceNitro' && phase === 'race') {
        const now = performance.now();
        if (now >= r.nitroReadyAt) {
          r.nitroUntil = now + NITRO_MS;
          r.nitroReadyAt = now + NITRO_CD;
          r.nitroReadySent = false;
          ac.message(id, { t: 'raceYou', nitro: false });
        }
      }
    },
    render() {
      if (!scene) return;
      const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      simulate(dt, now);
      updatePoofs(now);
      updateParts(dt, now);
      updateCamera(dt);
      renderer.render(scene, camera);
      drawHud(now);
    },
    _debug() { return { racers, samples, phase, standings: standings() }; }
  };
}});
