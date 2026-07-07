// ===== Modul: ARTILLERY HILLS ================================
// ============================================================
registerGame({ key: 'artillery', screen: function () {
  const W = cv.width, H = cv.height, GROUND = H - 56;
  const GRAV = 220, TURN_MS = 30000;
  const WEAPONS = {
    rocket: { label: 'Rakete', speed: 4.15, radius: 44, damageRadius: 82, damage: 62, color: '#ffffff' },
    mortar: { label: 'Mörser', speed: 3.45, radius: 62, damageRadius: 112, damage: 76, color: '#ffd60a' },
    needle: { label: 'Nadel', speed: 5.15, radius: 24, damageRadius: 46, damage: 92, color: '#64d2ff' }
  };
  const TANK_TYPES = [
    { label: 'Scout', hp: 85, move: 90, body: 32 },
    { label: 'Kampfpanzer', hp: 110, move: 65, body: 38 },
    { label: 'Brocken', hp: 135, move: 45, body: 44 }
  ];
  let order = [], tanks = {}, terrain = [], turn = 0, wind = 0, projectile = null, phase = 'aim', deadline = 0, winner = null;
  let lastT = performance.now(), endAt = 0, currentId = null, shotTimer = null, lastExplosion = null;

  const aliveIds = () => order.filter(id => tanks[id] && tanks[id].alive);
  const activeId = () => aliveIds()[turn % Math.max(1, aliveIds().length)];
  const terrainY = (x) => terrain[Math.max(0, Math.min(W - 1, Math.round(x)))] || GROUND;
  const tankY = (x) => terrainY(x) - 12;

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

  function settle(id) {
    const t = tanks[id]; if (!t) return;
    t.y = tankY(t.x);
    if (t.y > H + 20) t.alive = false;
  }

  function placeTanks(ids) {
    tanks = {};
    ids.forEach((id, i) => {
      const x = Math.round(80 + i * (W - 160) / Math.max(1, ids.length - 1));
      const type = TANK_TYPES[i % TANK_TYPES.length];
      tanks[id] = { x, y: tankY(x), hp: type.hp, maxHp: type.hp, moveLeft: type.move, type, angle: i < ids.length / 2 ? 45 : 135, power: 58, weapon: 'rocket', alive: true };
    });
  }

  function sendTurn() {
    const id = activeId();
    if (!id) return;
    currentId = id;
    const t = tanks[id];
    deadline = performance.now() + TURN_MS;
    order.forEach(pid => {
      if (!players[pid]) return;
      ac.message(pid, {
        t: 'artilleryTurn',
        active: pid === id,
        name: nameOf(id),
        angle: t.angle,
        power: t.power,
        weapon: t.weapon,
        weapons: Object.keys(WEAPONS).map(key => ({ key, label: WEAPONS[key].label })),
        moveLeft: Math.round(t.moveLeft),
        tankType: t.type.label,
        wind: Math.round(wind),
        hp: t.hp,
        maxHp: t.maxHp,
        ms: TURN_MS
      });
    });
  }

  function nextTurn() {
    if (shotTimer) { clearTimeout(shotTimer); shotTimer = null; }
    projectile = null; phase = 'aim';
    const live = aliveIds();
    if (live.length <= 1) {
      winner = live[0] || null; phase = 'done'; endAt = performance.now() + 4500;
      order.forEach(id => { if (players[id]) ac.message(id, { t: 'artilleryDone', winner: winner === id, name: winner ? nameOf(winner) : 'Niemand' }); });
      return;
    }
    const prevIdx = live.indexOf(currentId);
    turn = prevIdx === -1 ? turn % live.length : (prevIdx + 1) % live.length;
    wind = Math.random() * 80 - 40;
    const next = tanks[live[turn]];
    if (next) next.moveLeft = next.type.move;
    sendTurn();
  }

  function scheduleNextTurn() {
    if (shotTimer) clearTimeout(shotTimer);
    shotTimer = setTimeout(() => nextTurn(), 650);
  }

  function explode(x, y, weaponKey) {
    const w = WEAPONS[weaponKey] || WEAPONS.rocket;
    lastExplosion = { x, y, radius: w.radius, until: performance.now() + 520 };
    for (let tx = Math.max(0, Math.floor(x - w.radius)); tx <= Math.min(W - 1, Math.ceil(x + w.radius)); tx++) {
      const dx = tx - x, dy = Math.sqrt(Math.max(0, w.radius * w.radius - dx * dx));
      if (terrain[tx] < y + dy) terrain[tx] = Math.min(GROUND + 40, y + dy);
    }
    order.forEach(id => {
      const t = tanks[id]; if (!t || !t.alive) return;
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < w.damageRadius) {
        const dmg = Math.round((1 - d / w.damageRadius) * w.damage);
        t.hp = Math.max(0, t.hp - dmg);
        if (t.hp <= 0) t.alive = false;
      }
      settle(id);
    });
  }

  function fire(id, angle, power, weaponKey) {
    const t = tanks[id];
    if (!t || !t.alive || id !== activeId() || projectile || phase !== 'aim') return;
    t.angle = clamp(+angle || t.angle, 5, 175);
    t.power = clamp(+power || t.power, 20, 100);
    if (WEAPONS[weaponKey]) t.weapon = weaponKey;
    const weapon = WEAPONS[t.weapon] || WEAPONS.rocket;
    const a = t.angle * Math.PI / 180, speed = weapon.speed * t.power;
    projectile = { owner: id, weapon: t.weapon, color: weapon.color, x: t.x + Math.cos(a) * 24, y: t.y - Math.sin(a) * 24, vx: Math.cos(a) * speed, vy: -Math.sin(a) * speed };
    phase = 'shot';
    order.forEach(pid => { if (players[pid]) ac.message(pid, { t: 'artilleryWait' }); });
  }

  function moveTank(id, dir) {
    const t = tanks[id];
    if (!t || !t.alive || id !== activeId() || phase !== 'aim' || projectile) return;
    const step = Math.min(8, Math.max(0, t.moveLeft));
    if (step <= 0) return;
    const oldX = t.x;
    const nx = clamp(t.x + (dir < 0 ? -step : step), 28, W - 28);
    const slope = Math.abs(terrainY(nx) - terrainY(t.x));
    if (slope > 28) { ac.message(id, { t: 'artilleryMove', moveLeft: Math.round(t.moveLeft) }); return; }
    t.x = nx;
    t.moveLeft = Math.max(0, t.moveLeft - Math.abs(nx - oldX));
    settle(id);
    ac.message(id, { t: 'artilleryMove', moveLeft: Math.round(t.moveLeft) });
  }

  function update() {
    const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    if (phase === 'aim' && now >= deadline) { const id = activeId(); return id && fire(id, tanks[id].angle, tanks[id].power, tanks[id].weapon); }
    if (phase === 'done') { if (now >= endAt) endToLobby(''); return; }
    if (!projectile) return;
    projectile.vx += wind * dt;
    projectile.vy += GRAV * dt;
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    for (const id of aliveIds()) {
      const t = tanks[id];
      if (Math.hypot(projectile.x - t.x, projectile.y - t.y) < 18) {
        explode(projectile.x, projectile.y, projectile.weapon);
        scheduleNextTurn();
        projectile = null;
        return;
      }
    }
    if (projectile.x < -30 || projectile.x > W + 30 || projectile.y > H + 40) return nextTurn();
    if (projectile.y >= terrainY(projectile.x)) {
      explode(projectile.x, projectile.y, projectile.weapon);
      scheduleNextTurn();
      projectile = null;
    }
  }

  function drawTerrain() {
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x < W; x++) ctx.lineTo(x, terrain[x]);
    ctx.lineTo(W, H); ctx.closePath();
    const g = ctx.createLinearGradient(0, 230, 0, H);
    g.addColorStop(0, '#557a42'); g.addColorStop(0.55, '#334f31'); g.addColorStop(1, '#1b251b');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = '#8fc56d'; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x < W; x++) { if (x === 0) ctx.moveTo(x, terrain[x]); else ctx.lineTo(x, terrain[x]); }
    ctx.stroke();
  }

  function drawTank(id, t) {
    const col = players[id] ? players[id].color : '#888';
    const body = t.type.body;
    ctx.save(); ctx.translate(t.x, t.y);
    ctx.fillStyle = col; ctx.strokeStyle = '#101018'; ctx.lineWidth = 2;
    rr(ctx, -body / 2, -12, body, 18, 6); ctx.fill(); ctx.stroke();
    const a = t.angle * Math.PI / 180;
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(Math.cos(a) * 26, -8 - Math.sin(a) * 26); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(shortName(id), t.x, t.y - 34);
    ctx.fillStyle = '#111'; ctx.fillRect(t.x - 24, t.y - 28, 48, 6);
    ctx.fillStyle = t.hp > 45 ? '#30d158' : t.hp > 20 ? '#ffd60a' : '#ff453a';
    ctx.fillRect(t.x - 24, t.y - 28, 48 * (t.hp / t.maxHp), 6);
  }

  return {
    acceptsJoin: false,
    start(ids) {
      order = ids.slice(); turn = 0; phase = 'aim'; projectile = null; winner = null; lastT = performance.now();
      makeTerrain(); placeTanks(order); wind = Math.random() * 80 - 40; sendTurn();
    },
    stop() { projectile = null; if (shotTimer) { clearTimeout(shotTimer); shotTimer = null; } },
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
        if (WEAPONS[d.weapon]) tanks[id].weapon = d.weapon;
      } else if (d.t === 'artilleryMove') moveTank(id, +d.dir || 0);
      else if (d.t === 'artilleryFire') fire(id, d.angle, d.power, d.weapon);
    },
    render() {
      update();
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#121a33'); sky.addColorStop(0.62, '#223456'); sky.addColorStop(1, '#18251f');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff22'; ctx.beginPath(); ctx.arc(820, 86, 34, 0, Math.PI * 2); ctx.fill();
      drawTerrain();
      order.forEach(id => { const t = tanks[id]; if (t && t.alive) drawTank(id, t); });
    if (projectile) { ctx.fillStyle = projectile.color || '#fff'; ctx.beginPath(); ctx.arc(projectile.x, projectile.y, projectile.weapon === 'mortar' ? 7 : 5, 0, Math.PI * 2); ctx.fill(); }
    if (lastExplosion && performance.now() < lastExplosion.until) {
      const f = (lastExplosion.until - performance.now()) / 520;
      ctx.globalAlpha = f;
      ctx.strokeStyle = '#ffdd66'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(lastExplosion.x, lastExplosion.y, lastExplosion.radius * (1.25 - f * 0.25), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ff7a3033'; ctx.beginPath(); ctx.arc(lastExplosion.x, lastExplosion.y, lastExplosion.radius * 0.72, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      }
      const id = activeId();
      if (phase === 'aim' && id && tanks[id]) {
        const t = tanks[id], a = t.angle * Math.PI / 180;
        ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(t.x, t.y - 8); ctx.lineTo(t.x + Math.cos(a) * 96, t.y - 8 - Math.sin(a) * 96); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.font = 'bold 28px system-ui,sans-serif';
      ctx.fillText(phase === 'done' ? ((winner ? nameOf(winner) : 'Niemand') + ' gewinnt!') : ('💥 ' + nameOf(id) + ' ist dran'), 20, 34);
      ctx.font = '16px system-ui,sans-serif'; ctx.fillStyle = '#ddd';
      ctx.fillText('Wind: ' + Math.round(wind) + '  |  Lebend: ' + aliveIds().length + ' / ' + order.length, 20, 66);
      if (phase === 'aim') {
        const t = tanks[id], w = t ? WEAPONS[t.weapon] || WEAPONS.rocket : WEAPONS.rocket;
        ctx.fillStyle = '#ddd'; ctx.textAlign = 'left'; ctx.font = '15px system-ui,sans-serif';
        ctx.fillText((t ? t.type.label : '') + ' · ' + w.label + ' · Bewegung: ' + (t ? Math.round(t.moveLeft) : 0), 20, 92);
        const secs = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
        ctx.textAlign = 'right'; ctx.fillStyle = secs <= 5 ? '#ff453a' : '#fff'; ctx.font = 'bold 24px system-ui,sans-serif';
        ctx.fillText(secs + 's', W - 20, 34);
      }
    }
  };
}});
