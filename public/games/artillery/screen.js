// ===== Modul: ARTILLERY HILLS ================================
// Rundenbasierte Panzer-Artillerie im Worms-Stil: verformbares
// Terrain, Wind, Biome (Wüste/Schnee/Vulkan), Partikel-Explosionen,
// Spezialwaffen aus Versorgungskisten.
// ============================================================
registerGame({ key: 'artillery', screen: function () {
  const W = cv.width, H = cv.height, GROUND = H - 56;
  const GRAV = 220, TURN_MS = 30000;
  const WEAPONS = {
    rocket: { label: 'Rakete', speed: 4.15, radius: 44, damageRadius: 82, damage: 62, color: '#ffe9c4' },
    mortar: { label: 'Mörser', speed: 3.45, radius: 62, damageRadius: 112, damage: 76, color: '#ffd60a' },
    needle: { label: 'Nadel', speed: 5.15, radius: 24, damageRadius: 46, damage: 92, color: '#64d2ff' },
    // Spezialwaffen — nur mit Munition aus Versorgungskisten
    cluster: { label: '💣 Cluster', speed: 4.0, radius: 24, damageRadius: 46, damage: 24, color: '#9ef01a', special: 'cluster' },
    roller: { label: '🛢️ Roller', speed: 4.3, radius: 42, damageRadius: 80, damage: 58, color: '#ffb347', special: 'roller' },
    napalm: { label: '🔥 Napalm', speed: 3.9, radius: 20, damageRadius: 34, damage: 16, color: '#ff6b3d', special: 'napalm' },
    airstrike: { label: '✈️ Luftschlag', speed: 4.2, radius: 16, damageRadius: 22, damage: 8, color: '#ff5d5d', special: 'airstrike' },
    // interne Kind-Projektile
    bomblet: { label: 'Bomblet', speed: 0, radius: 22, damageRadius: 44, damage: 26, color: '#9ef01a', special: 'child' },
    strikebomb: { label: 'Bombe', speed: 0, radius: 34, damageRadius: 66, damage: 42, color: '#ff5d5d', special: 'child' }
  };
  const CRATE_KINDS = ['cluster', 'roller', 'napalm', 'airstrike', 'repair'];
  const TANK_TYPES = [
    { label: 'Scout', hp: 85, move: 90, body: 32 },
    { label: 'Kampfpanzer', hp: 110, move: 65, body: 38 },
    { label: 'Brocken', hp: 135, move: 45, body: 44 }
  ];

  // ---------- Biome ----------
  const THEMES = {
    desert: {
      label: 'Wüste', deco: 'cactus',
      sky: [['#6cb2e8', 0], ['#a8d4f0', 0.5], ['#f7d9a8', 1]],
      sun: { x: 810, y: 84, r: 30, c: '#fff3c4' },
      cloud: 'rgba(255,255,255,0.85)',
      terrEdge: '#f0dca6', terrTop: '#d9a05b', terrDeep: '#6e4f2e', debris: '#b8895033'
    },
    snow: {
      label: 'Schnee', deco: 'fir',
      sky: [['#4a5f8e', 0], ['#8ba3cc', 0.55], ['#e8d5e0', 1]],
      sun: { x: 140, y: 96, r: 24, c: '#ffe9ec', pale: true },
      cloud: 'rgba(230,238,250,0.8)',
      terrEdge: '#ffffff', terrTop: '#dfe9f5', terrDeep: '#5f7292', debris: '#c8d4e8'
    },
    volcano: {
      label: 'Vulkan', deco: 'deadtree', night: true, lava: true,
      sky: [['#0b081c', 0], ['#2a1230', 0.5], ['#8a2c18', 1]],
      moon: { x: 790, y: 74, r: 26 },
      cloud: 'rgba(60,36,56,0.55)',
      terrEdge: '#6a5261', terrTop: '#3d3440', terrDeep: '#16101a', debris: '#5a4a55'
    }
  };
  let theme = THEMES.desert;
  let clouds = [], stars = [], decos = [];

  let order = [], tanks = {}, terrain = [], turn = 0, wind = 0, phase = 'aim', deadline = 0, winner = null;
  let lastT = performance.now(), endAt = 0, currentId = null, nextTurnAt = 0;
  let projectiles = [], parts = [], flashes = [], wrecks = [], crates = [], flames = [];
  let announce = null, shake = { mag: 0, until: 0 }, lastDraw = performance.now();

  const aliveIds = () => order.filter(id => tanks[id] && tanks[id].alive);
  const activeId = () => aliveIds()[turn % Math.max(1, aliveIds().length)];
  const terrainY = (x) => terrain[Math.max(0, Math.min(W - 1, Math.round(x)))] || GROUND;
  const tankY = (x) => terrainY(x) - 12;
  const slopeAt = (x) => terrainY(x + 4) - terrainY(x - 4);

  function say(text, color, ms) { announce = { text, color: color || '#fff', until: performance.now() + (ms || 1900) }; }
  function setShake(mag, ms) { shake.mag = Math.max(shake.mag, mag); shake.until = performance.now() + ms; }

  // ---------- Partikel ----------
  function spawnP(p) {
    if (parts.length > 460) return;
    parts.push(Object.assign({ born: performance.now(), g: 0, drag: 1, size: 3, rot: 0, vr: 0, add: false, grow: 0 }, p));
  }
  function firePuff(x, y, n, base) {
    const cols = ['#ffd27a', '#ff9f43', '#ff5f2e', '#fff3c4'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.25 + Math.random() * 0.75) * base;
      spawnP({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - base * 0.18, g: -46, drag: 0.92,
        life: 320 + Math.random() * 320, color: cols[Math.floor(Math.random() * cols.length)], size: 3 + Math.random() * 4, add: true });
    }
  }
  function smokePuff(x, y, n, dark) {
    for (let i = 0; i < n; i++) {
      spawnP({ x: x + (Math.random() - 0.5) * 14, y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 34, vy: -26 - Math.random() * 52, g: -14, drag: 0.985,
        life: 900 + Math.random() * 900, color: dark ? '#2c2c34' : '#6b6b74', size: 6 + Math.random() * 9, grow: 5 });
    }
  }
  function debrisBurst(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 120 + Math.random() * 240;
      spawnP({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 420, drag: 0.995,
        life: 700 + Math.random() * 800, color: color || theme.terrDeep, size: 2 + Math.random() * 3.5,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, shape: 'rect' });
    }
  }

  // ---------- Explosion ----------
  function explode(x, y, weaponKey) {
    const w = WEAPONS[weaponKey] || WEAPONS.rocket;
    flashes.push({ x, y, r: w.radius * 1.2, born: performance.now(), life: 150 });
    firePuff(x, y, Math.round(w.radius / 2.4), 150 + w.radius);
    smokePuff(x, y, 8 + Math.round(w.radius / 9), theme.night);
    debrisBurst(x, y, 10 + Math.round(w.radius / 6));
    setShake(Math.min(15, 4 + w.radius / 5), 420);
    for (let tx = Math.max(0, Math.floor(x - w.radius)); tx <= Math.min(W - 1, Math.ceil(x + w.radius)); tx++) {
      const dx = tx - x, dy = Math.sqrt(Math.max(0, w.radius * w.radius - dx * dx));
      if (terrain[tx] < y + dy) terrain[tx] = Math.min(GROUND + 40, y + dy);
    }
    order.forEach(id => {
      const t = tanks[id]; if (!t || !t.alive) return;
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < w.damageRadius) {
        const dmg = Math.round((1 - d / w.damageRadius) * w.damage);
        damageTank(id, t, dmg);
      }
      settle(id);
    });
    hitCrates(x, y, w.radius);
  }

  function damageTank(id, t, dmg) {
    if (dmg <= 0 || !t.alive) return;
    t.hp = Math.max(0, t.hp - dmg);
    t.hitAt = performance.now();
    if (t.hp <= 0) {
      t.alive = false;
      wrecks.push({ x: t.x, body: t.type.body });
      flashes.push({ x: t.x, y: t.y, r: 58, born: performance.now(), life: 180 });
      firePuff(t.x, t.y, 26, 240);
      smokePuff(t.x, t.y, 16, true);
      debrisBurst(t.x, t.y - 6, 14, players[id] ? players[id].color : '#888');
      setShake(13, 550);
      say('💀 ' + nameOf(id) + ' wurde zerstört!', '#ff6b5e');
    }
  }

  function settle(id) {
    const t = tanks[id]; if (!t) return;
    t.y = tankY(t.x);
    if (t.y > H + 20) t.alive = false;
  }

  // ---------- Terrain / Szene ----------
  function makeTerrain() {
    terrain = [];
    const seeds = [
      { amp: 38, wave: 170, off: Math.random() * 9 },
      { amp: 24, wave: 83, off: Math.random() * 9 },
      { amp: 15, wave: 41, off: Math.random() * 9 }
    ];
    for (let x = 0; x < W; x++) {
      let y = GROUND - 70;
      seeds.forEach(s => y += Math.sin(x / s.wave + s.off) * s.amp);
      terrain[x] = Math.max(250, Math.min(GROUND, y));
    }
  }

  function makeScenery() {
    clouds = Array.from({ length: 4 }, () => ({
      x: Math.random() * W, y: 40 + Math.random() * 110, s: 0.7 + Math.random() * 0.9
    }));
    stars = theme.night ? Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * 240, a: 0.3 + Math.random() * 0.7, tw: Math.random() * 9 })) : [];
    decos = [];
    for (let i = 0; i < 7; i++) {
      const x = 30 + Math.random() * (W - 60);
      if (order.some(id => tanks[id] && Math.abs(tanks[id].x - x) < 50)) continue;
      decos.push({ x, s: 0.7 + Math.random() * 0.7, flip: Math.random() < 0.5 });
    }
  }

  function placeTanks(ids) {
    tanks = {};
    ids.forEach((id, i) => {
      const x = Math.round(80 + i * (W - 160) / Math.max(1, ids.length - 1));
      const type = TANK_TYPES[i % TANK_TYPES.length];
      tanks[id] = { x, y: tankY(x), hp: type.hp, maxHp: type.hp, moveLeft: type.move, type,
        angle: i < ids.length / 2 ? 45 : 135, power: 58, weapon: 'rocket', alive: true,
        ammo: {}, hitAt: 0 };
    });
  }

  // ---------- Züge ----------
  function weaponList(t) {
    const out = Object.keys(WEAPONS).filter(k => !WEAPONS[k].special).map(k => ({ key: k, label: WEAPONS[k].label }));
    Object.keys(t.ammo).forEach(k => {
      if (t.ammo[k] > 0 && WEAPONS[k]) out.push({ key: k, label: WEAPONS[k].label + ' ×' + t.ammo[k] });
    });
    return out;
  }

  function turnMsg(pid, id, remainMs) {
    const t = tanks[id];
    return {
      t: 'artilleryTurn', active: pid === id, name: nameOf(id),
      angle: t.angle, power: t.power, weapon: t.weapon,
      weapons: weaponList(t),
      moveLeft: Math.round(t.moveLeft), tankType: t.type.label,
      wind: Math.round(wind), hp: t.hp, maxHp: t.maxHp, ms: remainMs
    };
  }

  function sendTurn() {
    const id = activeId();
    if (!id) return;
    currentId = id;
    const t = tanks[id];
    if (WEAPONS[t.weapon].special && !(t.ammo[t.weapon] > 0)) t.weapon = 'rocket';
    deadline = performance.now() + TURN_MS;
    order.forEach(pid => {
      if (!players[pid]) return;
      ac.message(pid, turnMsg(pid, id, TURN_MS));
    });
  }

  function nextTurn() {
    nextTurnAt = 0;
    projectiles = []; phase = 'aim';
    const live = aliveIds();
    if (live.length <= 1) {
      winner = live[0] !== undefined ? live[0] : null; phase = 'done'; endAt = performance.now() + 5000;
      if (winner !== null) reportWinners([winner]);
      order.forEach(id => { if (players[id]) ac.message(id, { t: 'artilleryDone', winner: winner === id, name: winner !== null ? nameOf(winner) : 'Niemand' }); });
      return;
    }
    const prevIdx = live.indexOf(currentId);
    turn = prevIdx === -1 ? turn % live.length : (prevIdx + 1) % live.length;
    wind = Math.random() * 80 - 40;
    const next = tanks[live[turn]];
    if (next) next.moveLeft = next.type.move;
    maybeDropCrate();
    sendTurn();
  }

  // ---------- Versorgungskisten ----------
  let turnCounter = 0;
  function maybeDropCrate() {
    turnCounter++;
    if (turnCounter % 2 !== 0 || crates.length >= 2) return;
    for (let tries = 0; tries < 14; tries++) {
      const x = 60 + Math.random() * (W - 120);
      if (order.some(id => tanks[id] && tanks[id].alive && Math.abs(tanks[id].x - x) < 80)) continue;
      crates.push({ x, y: -30, landed: false, sway: Math.random() * 9,
        content: CRATE_KINDS[Math.floor(Math.random() * CRATE_KINDS.length)] });
      say('📦 Versorgung im Anflug!', '#ffd60a', 1600);
      return;
    }
  }
  function updateCrates(dt, now) {
    crates.forEach(c => {
      if (c.landed) return;
      c.y += 78 * dt;
      c.x += Math.sin(now / 500 + c.sway) * 8 * dt;
      if (c.y >= terrainY(c.x) - 9) { c.y = terrainY(c.x) - 9; c.landed = true; smokePuff(c.x, c.y + 6, 2, theme.night); }
    });
  }
  function hitCrates(x, y, r) {
    for (let i = crates.length - 1; i >= 0; i--) {
      const c = crates[i];
      if (Math.hypot(c.x - x, c.y - y) < r + 14) {
        debrisBurst(c.x, c.y, 8, '#a8763e');
        say('📦 Kiste zerstört! 💥', '#ff9f0a', 1400);
        crates.splice(i, 1);
      }
    }
  }
  function pickupCrates(id, t) {
    for (let i = crates.length - 1; i >= 0; i--) {
      const c = crates[i];
      if (!c.landed || Math.abs(c.x - t.x) > 26) continue;
      if (c.content === 'repair') {
        t.hp = Math.min(t.maxHp, t.hp + 30);
        say('🔧 ' + nameOf(id) + ' repariert +30 HP!', '#30d158');
      } else {
        t.ammo[c.content] = (t.ammo[c.content] || 0) + 1;
        say('📦 ' + nameOf(id) + ': ' + WEAPONS[c.content].label + ' ×' + t.ammo[c.content] + '!', '#ffd60a');
      }
      firePuff(c.x, c.y, 6, 70);
      crates.splice(i, 1);
      // aktualisierte Waffenliste/HP an den Sammler, Restzeit beibehalten
      if (players[id]) ac.message(id, turnMsg(id, currentId, Math.max(1000, deadline - performance.now())));
    }
  }
  function drawCrates(now) {
    crates.forEach(c => {
      ctx.save(); ctx.translate(c.x, c.y);
      if (!c.landed) {
        // Fallschirm
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(0, -26, 17, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.4;
        [[-15, -24], [0, -28], [15, -24]].forEach(([lx, ly]) => {
          ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(0, -6); ctx.stroke();
        });
      }
      ctx.fillStyle = '#a8763e'; ctx.strokeStyle = '#6e4a24'; ctx.lineWidth = 2;
      rr(ctx, -11, -9, 22, 18, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e8c88a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, 1);
      ctx.restore();
    });
  }

  // ---------- Schießen / Bewegen ----------
  function launch(owner, x, y, vx, vy, weaponKey) {
    const w = WEAPONS[weaponKey] || WEAPONS.rocket;
    projectiles.push({ owner, weapon: weaponKey, color: w.color, x, y, vx, vy, smokeAt: 0, born: performance.now() });
  }

  function fire(id, angle, power, weaponKey) {
    const t = tanks[id];
    if (!t || !t.alive || id !== activeId() || projectiles.length || phase !== 'aim') return;
    t.angle = clamp(+angle || t.angle, 5, 175);
    t.power = clamp(+power || t.power, 20, 100);
    if (WEAPONS[weaponKey] && (!WEAPONS[weaponKey].special || t.ammo[weaponKey] > 0)) t.weapon = weaponKey;
    const w = WEAPONS[t.weapon] || WEAPONS.rocket;
    if (w.special) t.ammo[t.weapon]--;
    const a = t.angle * Math.PI / 180, speed = w.speed * t.power;
    launch(id, t.x + Math.cos(a) * 24, t.y - 8 - Math.sin(a) * 24, Math.cos(a) * speed, -Math.sin(a) * speed, t.weapon);
    firePuff(t.x + Math.cos(a) * 26, t.y - 8 - Math.sin(a) * 26, 6, 90);
    setShake(3, 150);
    phase = 'shot';
    order.forEach(pid => { if (players[pid]) ac.message(pid, { t: 'artilleryWait' }); });
  }

  function moveTank(id, dir) {
    const t = tanks[id];
    if (!t || !t.alive || id !== activeId() || phase !== 'aim' || projectiles.length) return;
    const step = Math.min(8, Math.max(0, t.moveLeft));
    if (step <= 0) return;
    const oldX = t.x;
    const nx = clamp(t.x + (dir < 0 ? -step : step), 28, W - 28);
    const slope = Math.abs(terrainY(nx) - terrainY(t.x));
    if (slope > 28) { ac.message(id, { t: 'artilleryMove', moveLeft: Math.round(t.moveLeft) }); return; }
    t.x = nx;
    t.moveLeft = Math.max(0, t.moveLeft - Math.abs(nx - oldX));
    settle(id);
    pickupCrates(id, t);
    // Staub beim Fahren
    spawnP({ x: t.x, y: t.y + 8, vx: (oldX - t.x) * 3, vy: -14, g: 60, drag: 0.97, life: 380, color: theme.terrDeep, size: 2.6 });
    ac.message(id, { t: 'artilleryMove', moveLeft: Math.round(t.moveLeft) });
  }

  // ---------- Simulation ----------
  function update() {
    const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    if (phase === 'aim' && now >= deadline) { const id = activeId(); if (id) fire(id, tanks[id].angle, tanks[id].power, tanks[id].weapon); }
    if (phase === 'done') { if (now >= endAt) endToLobby(''); return; }
    updateCrates(dt, now);

    for (let pi = projectiles.length - 1; pi >= 0; pi--) {
      const p = projectiles[pi];
      const w = WEAPONS[p.weapon] || WEAPONS.rocket;

      if (p.rolling) {
        // Roller: folgt dem Gefälle, zündet bei Stillstand, Timeout oder Panzer-Kontakt
        p.vx += slopeAt(p.x) * 42 * dt;
        p.vx *= 0.995;
        p.x += p.vx * dt;
        p.y = terrainY(p.x) - 5;
        p.roll = (p.roll || 0) + p.vx * dt * 0.14;
        let boomNow = now - p.rollStart > 2600 || (now - p.rollStart > 700 && Math.abs(p.vx) < 7);
        for (const id of aliveIds()) {
          const t = tanks[id];
          if (id !== p.owner && Math.hypot(p.x - t.x, p.y - t.y) < 20) { boomNow = true; break; }
        }
        if (p.x < 4 || p.x > W - 4) boomNow = true;
        if (boomNow) { explode(p.x, p.y, p.weapon); projectiles.splice(pi, 1); }
        continue;
      }

      p.vx += wind * dt;
      p.vy += GRAV * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Cluster teilt sich am Scheitelpunkt
      if (w.special === 'cluster' && !p.split && p.vy > 0) {
        p.split = true;
        firePuff(p.x, p.y, 6, 80);
        for (let i = 0; i < 5; i++) {
          launch(p.owner, p.x, p.y, p.vx * 0.55 + (i - 2) * 42, p.vy * 0.4, 'bomblet');
        }
        projectiles.splice(pi, 1);
        continue;
      }
      // Rauch-Trail
      if (now > p.smokeAt) {
        p.smokeAt = now + 34;
        spawnP({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 12, vy: -8, g: -10, drag: 0.99,
          life: 620, color: theme.night ? '#5a4a55' : '#9a9aa4', size: 2.6, grow: 2.2 });
      }
      let boom = false;
      for (const id of aliveIds()) {
        const t = tanks[id];
        if (Math.hypot(p.x - t.x, p.y - t.y) < 18) { boom = true; break; }
      }
      if (!boom && p.y >= terrainY(p.x)) boom = true;
      if (boom) {
        const bx = p.x, by = Math.min(p.y, terrainY(p.x));
        if (w.special === 'roller') {
          p.rolling = true; p.rollStart = now; p.y = terrainY(p.x) - 5;
          smokePuff(bx, by, 3, theme.night);
          continue;
        }
        explode(bx, by, p.weapon);
        if (w.special === 'napalm') {
          for (let i = 0; i < 9; i++) {
            flames.push({ x: bx + (Math.random() - 0.5) * 30, vx: p.vx * 0.2 + (Math.random() - 0.5) * 70, born: now, life: 2900 + Math.random() * 900 });
          }
        } else if (w.special === 'airstrike') {
          say('✈️ LUFTSCHLAG!', '#ff5d5d', 1400);
          for (let i = 0; i < 3; i++) {
            launch(p.owner, clamp(bx + (i - 1) * 74, 20, W - 20), -24 - i * 52, wind * 0.25, 130, 'strikebomb');
          }
        }
        projectiles.splice(pi, 1);
        continue;
      }
      if (p.x < -30 || p.x > W + 30 || p.y > H + 40) projectiles.splice(pi, 1);
    }

    // Napalm-Flammen: fließen hangabwärts, brennen, verletzen
    flames = flames.filter(fl => {
      const age = now - fl.born;
      if (age > fl.life) return false;
      fl.vx += slopeAt(fl.x) * 26 * dt;
      fl.vx *= 0.96;
      fl.x = clamp(fl.x + fl.vx * dt, 2, W - 2);
      if (Math.random() < 0.3) {
        spawnP({ x: fl.x + (Math.random() - 0.5) * 8, y: terrainY(fl.x) - 4, vx: (Math.random() - 0.5) * 16, vy: -34 - Math.random() * 30,
          g: -30, drag: 0.96, life: 300 + Math.random() * 240, color: Math.random() < 0.5 ? '#ff9f43' : '#ffd27a', size: 2.5 + Math.random() * 3, add: true });
      }
      if (Math.random() < 0.05) smokePuff(fl.x, terrainY(fl.x) - 8, 1, true);
      order.forEach(id => {
        const t = tanks[id];
        if (!t || !t.alive || now < (t.burnAt || 0)) return;
        if (Math.hypot(t.x - fl.x, t.y - (terrainY(fl.x) - 4)) < 24) {
          t.burnAt = now + 380;
          damageTank(id, t, 5);
        }
      });
      return true;
    });

    // Feuer kann auch in der Ziel-Phase töten — Zug/Spielende dann sauber weiterreichen
    if (phase === 'aim' && (aliveIds().length <= 1 || (currentId !== null && tanks[currentId] && !tanks[currentId].alive))) nextTurn();

    // Zugwechsel zeitbasiert (kein setTimeout — spielt mit Sim-Uhren und stop() sauber zusammen)
    if (phase === 'shot' && !projectiles.length) {
      if (!nextTurnAt) nextTurnAt = now + 700;
      else if (now >= nextTurnAt) nextTurn();
    } else {
      nextTurnAt = 0;
    }
  }

  // ---------- Zeichnen ----------
  function drawSky(now) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    theme.sky.forEach(([c, s]) => sky.addColorStop(s, c));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    if (theme.lava) {
      const g = ctx.createLinearGradient(0, H - 220, 0, H);
      g.addColorStop(0, 'rgba(255,90,30,0)'); g.addColorStop(1, 'rgba(255,110,40,0.4)');
      ctx.fillStyle = g; ctx.fillRect(0, H - 220, W, 220);
    }
    stars.forEach(s => {
      ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(now / 700 + s.tw));
      ctx.fillStyle = '#fff'; ctx.fillRect(s.x, s.y, 1.6, 1.6);
    });
    ctx.globalAlpha = 1;
    if (theme.sun) {
      const s = theme.sun;
      ctx.globalAlpha = s.pale ? 0.7 : 1;
      const g = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, s.r * 2.6);
      g.addColorStop(0, s.c); g.addColorStop(0.4, s.c + 'aa'); g.addColorStop(1, s.c + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (theme.moon) {
      const m = theme.moon;
      ctx.fillStyle = '#e8e2d4'; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9c2b2';
      [[-8, -4, 5], [6, 6, 4], [3, -9, 3]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(m.x + dx, m.y + dy, r, 0, Math.PI * 2); ctx.fill(); });
    }
    // Wolken driften mit dem Wind — verrät die Richtung
    clouds.forEach(c => {
      c.x += wind * 0.016;
      if (c.x < -90) c.x = W + 80; if (c.x > W + 90) c.x = -80;
      ctx.fillStyle = theme.cloud;
      [[0, 0, 34], [26, 6, 26], [-26, 7, 24], [8, -10, 24]].forEach(([dx, dy, r]) => {
        ctx.beginPath(); ctx.ellipse(c.x + dx * c.s, c.y + dy * c.s, r * c.s, r * 0.62 * c.s, 0, 0, Math.PI * 2); ctx.fill();
      });
    });
  }

  function drawTerrain() {
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x < W; x++) ctx.lineTo(x, terrain[x]);
    ctx.lineTo(W, H); ctx.closePath();
    const g = ctx.createLinearGradient(0, 230, 0, H);
    g.addColorStop(0, theme.terrTop); g.addColorStop(1, theme.terrDeep);
    ctx.fillStyle = g; ctx.fill();
    // Oberflächen-Kante (Gras/Schnee/Asche)
    ctx.strokeStyle = theme.terrEdge; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let x = 0; x < W; x += 2) { x === 0 ? ctx.moveTo(x, terrain[x]) : ctx.lineTo(x, terrain[x]); }
    ctx.stroke();
  }

  function drawDeco() {
    decos.forEach(d => {
      const y = terrainY(d.x);
      ctx.save(); ctx.translate(d.x, y); ctx.scale(d.flip ? -d.s : d.s, d.s);
      if (theme.deco === 'cactus') {
        ctx.fillStyle = '#3f9b4f';
        rr(ctx, -4, -34, 8, 34, 4); ctx.fill();
        rr(ctx, -14, -26, 8, 4, 2); ctx.fill();
        rr(ctx, -14, -26, 4, 12, 2); ctx.fill();
        rr(ctx, 6, -20, 8, 4, 2); ctx.fill();
        rr(ctx, 10, -20, 4, 9, 2); ctx.fill();
      } else if (theme.deco === 'fir') {
        ctx.fillStyle = '#7a5230'; ctx.fillRect(-2.5, -8, 5, 8);
        ctx.fillStyle = '#2f6d4f';
        [[-16, -6, 16], [-13, -20, 13], [-9, -32, 9]].forEach(([x0, y0, w2]) => {
          ctx.beginPath(); ctx.moveTo(x0, y0 + 12); ctx.lineTo(0, y0 - 6); ctx.lineTo(-x0, y0 + 12); ctx.closePath(); ctx.fill();
        });
        ctx.fillStyle = '#f4f9ff';
        ctx.beginPath(); ctx.moveTo(-9, -26); ctx.lineTo(0, -38); ctx.lineTo(9, -26); ctx.closePath(); ctx.fill();
      } else {
        ctx.strokeStyle = '#241a20'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -26); ctx.stroke();
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(-10, -26); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(9, -30); ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawWreck(wk) {
    const y = terrainY(wk.x) - 8;
    ctx.save(); ctx.translate(wk.x, y);
    ctx.fillStyle = '#1c1a1e'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    rr(ctx, -wk.body / 2, -8, wk.body, 14, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2e2a30';
    ctx.beginPath(); ctx.arc(-wk.body / 5, -10, 5, Math.PI, 0); ctx.fill();
    ctx.restore();
  }

  function drawTank(id, t, now) {
    const col = players[id] ? players[id].color : '#888';
    const body = t.type.body;
    const flash = now - t.hitAt < 130;
    ctx.save(); ctx.translate(t.x, t.y);
    const tilt = Math.atan2(slopeAt(t.x), 8) * 0.5;
    ctx.rotate(tilt);
    // Ketten
    ctx.fillStyle = '#22242c';
    rr(ctx, -body / 2 - 2, -4, body + 4, 10, 5); ctx.fill();
    ctx.fillStyle = '#3a3d48';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(-body / 2 + 4 + i * (body - 8) / 3, 1, 2.6, 0, Math.PI * 2); ctx.fill(); }
    // Wanne + Turm
    ctx.fillStyle = flash ? '#ffffff' : col; ctx.strokeStyle = '#101018'; ctx.lineWidth = 2;
    rr(ctx, -body / 2, -13, body, 12, 5); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -14, body / 4.4, Math.PI, 0); ctx.fill(); ctx.stroke();
    // Rohr
    const a = t.angle * Math.PI / 180;
    ctx.strokeStyle = flash ? '#fff' : '#dcdce4'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(Math.cos(a) * 26, -15 - Math.sin(a) * 26); ctx.stroke();
    ctx.restore();
    // Name + HP
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(shortName(id), t.x, t.y - 38);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(t.x - 24, t.y - 32, 48, 6);
    ctx.fillStyle = t.hp > 45 ? '#30d158' : t.hp > 20 ? '#ffd60a' : '#ff453a';
    ctx.fillRect(t.x - 24, t.y - 32, 48 * (t.hp / t.maxHp), 6);
  }

  function drawParts(now, dt) {
    parts = parts.filter(p => {
      const f = (now - p.born) / p.life;
      if (f >= 1) return false;
      p.vx *= p.drag; p.vy *= p.drag;
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const size = p.size + (p.grow || 0) * f;
      if (p.add) ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - f) * (p.add ? 0.9 : 0.75);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      return true;
    });
    flashes = flashes.filter(fl => {
      const f = (now - fl.born) / fl.life;
      if (f >= 1) return false;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85 * (1 - f);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(fl.x, fl.y, fl.r * (0.5 + f * 0.7), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      return true;
    });
  }

  function drawWind() {
    const n = Math.min(5, Math.ceil(Math.abs(wind) / 9));
    const dir = wind >= 0 ? 1 : -1;
    ctx.font = 'bold 16px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ddd';
    ctx.fillText('Wind', 20, 66);
    for (let i = 0; i < 5; i++) {
      ctx.globalAlpha = i < n ? 1 : 0.22;
      ctx.fillStyle = dir > 0 ? '#7dffb1' : '#64d2ff';
      ctx.fillText(dir > 0 ? '→' : '←', 64 + i * 15, 66);
    }
    ctx.globalAlpha = 1;
  }

  return {
    acceptsJoin: false,
    start(ids, cfg) {
      order = ids.slice(); turn = 0; phase = 'aim'; winner = null; lastT = performance.now();
      projectiles = []; parts = []; flashes = []; wrecks = []; crates = []; flames = []; announce = null;
      turnCounter = 0;
      let key = (cfg && cfg.theme) || 'random';
      if (key === 'random' || !THEMES[key]) {
        const keys = Object.keys(THEMES);
        key = keys[Math.floor(Math.random() * keys.length)];
      }
      theme = THEMES[key];
      makeTerrain(); placeTanks(order); makeScenery();
      wind = Math.random() * 80 - 40;
      sendTurn();
    },
    stop() { projectiles = []; flames = []; nextTurnAt = 0; },
    onDisconnect(id) {
      if (tanks[id]) tanks[id].alive = false;
      if (aliveIds().length < 2) endToLobby('Zu wenige Spieler fuer Artillery Hills.');
      else if (id === currentId && phase === 'aim') nextTurn();
    },
    onMessage(id, d) {
      if (!d || !d.t || !tanks[id]) return;
      if (d.t === 'artilleryAim' && id === activeId() && phase === 'aim') {
        tanks[id].angle = clamp(+d.angle || tanks[id].angle, 5, 175);
        tanks[id].power = clamp(+d.power || tanks[id].power, 20, 100);
        if (WEAPONS[d.weapon] && (!WEAPONS[d.weapon].special || tanks[id].ammo[d.weapon] > 0)) tanks[id].weapon = d.weapon;
      } else if (d.t === 'artilleryMove') moveTank(id, +d.dir || 0);
      else if (d.t === 'artilleryFire') fire(id, d.angle, d.power, d.weapon);
    },
    render() {
      update();
      const now = performance.now();
      ctx.save();
      if (now < shake.until) {
        const m = shake.mag * (shake.until - now) / 700;
        ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      } else shake.mag = 0;
      drawSky(now);
      drawTerrain();
      drawDeco();
      drawCrates(now);
      wrecks.forEach(drawWreck);
      order.forEach(id => { const t = tanks[id]; if (t && t.alive) drawTank(id, t, now); });
      // Napalm-Bodenfeuer (Glow am Terrain)
      flames.forEach(fl => {
        const fy = terrainY(fl.x) - 3;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5 + Math.random() * 0.3;
        ctx.fillStyle = '#ff7a30';
        ctx.beginPath(); ctx.arc(fl.x, fy, 7 + Math.random() * 3, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      });
      // Projektile mit Glow
      projectiles.forEach(p => {
        if (p.rolling) {
          // rollendes Fass
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.roll || 0);
          ctx.fillStyle = '#ffb347'; ctx.strokeStyle = '#7a4a12'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = '#7a4a12'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.stroke();
          ctx.restore();
          return;
        }
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, (p.weapon === 'mortar' ? 7 : 5) * 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.weapon === 'mortar' ? 7 : 5, 0, Math.PI * 2); ctx.fill();
      });
      drawParts(now, Math.min(0.05, Math.max(0.001, (now - lastDraw) / 1000)));
      lastDraw = now;
      // Ziellinie
      const id = activeId();
      if (phase === 'aim' && id && tanks[id]) {
        const t = tanks[id], a = t.angle * Math.PI / 180;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(t.x, t.y - 15); ctx.lineTo(t.x + Math.cos(a) * 96, t.y - 15 - Math.sin(a) * 96); ctx.stroke();
        ctx.setLineDash([]);
      }
      // HUD
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.font = 'bold 26px system-ui,sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6;
      ctx.fillText(phase === 'done' ? ((winner !== null ? nameOf(winner) : 'Niemand') + ' gewinnt! 🏆') : ('💥 ' + nameOf(id) + ' ist dran'), 20, 32);
      ctx.shadowBlur = 0;
      drawWind();
      if (phase === 'aim') {
        const t = tanks[id], w = t ? WEAPONS[t.weapon] || WEAPONS.rocket : WEAPONS.rocket;
        ctx.fillStyle = '#eee'; ctx.font = '15px system-ui,sans-serif';
        ctx.fillText((t ? t.type.label : '') + ' · ' + w.label + ' · Bewegung: ' + (t ? Math.round(t.moveLeft) : 0), 20, 92);
        const secs = Math.max(0, Math.ceil((deadline - now) / 1000));
        ctx.textAlign = 'right'; ctx.fillStyle = secs <= 5 ? '#ff453a' : '#fff'; ctx.font = 'bold 24px system-ui,sans-serif';
        ctx.fillText(secs + 's', W - 20, 32);
      }
      if (announce && now < announce.until) {
        ctx.textAlign = 'center'; ctx.font = 'bold 30px system-ui,sans-serif';
        ctx.fillStyle = announce.color;
        ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 8;
        ctx.fillText(announce.text, W / 2, 130);
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    },
    _debug() { return { tanks, terrain, projectiles, phase, crates, theme }; }
  };
}});
