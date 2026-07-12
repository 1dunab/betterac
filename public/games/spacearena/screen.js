// ===== Modul: SPACE ARENA (Neon-Dogfight) ===================
// Last Ship Standing: Asteroids-Trägheit, Wrap-Around-Ränder,
// zerbrechende Asteroiden, Power-ups und ein schwarzes Loch,
// das als Sudden Death wächst. Überlebender kriegt den Punkt.
// ============================================================
registerGame({ key: 'spacearena', screen: function () {
  const W = cv.width, H = cv.height, CX = W / 2, CY = H / 2;
  const TURN = 3.4, THRUST = 300, TURBO_THRUST = 470, VMAX = 340, TURBO_VMAX = 450;
  const SHIP_R = 12, FIRE_MS = 230, BULLET_SPEED = 470, BULLET_TTL = 1100;
  const SUDDEN_AT = 50000, HOLE_R = 22, HOLE_R_MAX = 92, G_FORCE = 4.0e6;

  let ships = {}, order = [], points = {}, targetPoints = 3;
  let bullets = [], asteroids = [], powerups = [], stars = [], shoots = [];
  let debris = [], sparks = [], waves = [], sucks = [], holeDust = [];
  let phase = 'countdown'; // countdown | fight | roundOver | final
  let phaseAt = 0, fightAt = 0, roundNo = 0, lastT = 0, champion = null, roundWinner = null;
  let announce = null, shake = { mag: 0, until: 0 }, flash = { color: '#fff', until: 0, dur: 1 };
  let hole = { r: HOLE_R, target: HOLE_R, sudden: false };
  let lastPow = 0;

  // ---------- Glow-Sprites (additiv, gecacht) ----------
  const glowCache = {};
  function glowSprite(color) {
    if (glowCache[color]) return glowCache[color];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color); grad.addColorStop(0.35, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    glowCache[color] = c;
    return c;
  }
  function drawGlow(x, y, r, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(glowSprite(color), x - r * 2, y - r * 2, r * 4, r * 4);
    ctx.globalAlpha = 1;
  }
  function setShake(mag, ms) { shake.mag = Math.max(shake.mag, mag); shake.until = performance.now() + ms; }
  function setFlash(color, ms) { flash = { color, until: performance.now() + ms, dur: ms }; }
  function say(text, color, ms, size) { announce = { text, color: color || '#fff', until: performance.now() + (ms || 1800), size: size || 40 }; }
  function spark(x, y, color, n, speed, size, life) {
    for (let i = 0; i < n; i++) {
      if (sparks.length > 420) return;
      const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random() * 0.7) * (speed || 180);
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: performance.now(), life: (life || 500) * (0.6 + Math.random() * 0.8), color, size: size || 3 });
    }
  }
  const wrapX = (x) => (x % W + W) % W;
  const wrapY = (y) => (y % H + H) % H;
  // kürzeste Distanz im Wrap-Raum
  function wdx(a, b) { let d = b - a; if (d > W / 2) d -= W; if (d < -W / 2) d += W; return d; }
  function wdy(a, b) { let d = b - a; if (d > H / 2) d -= H; if (d < -H / 2) d += H; return d; }
  const wdist = (x1, y1, x2, y2) => Math.hypot(wdx(x1, x2), wdy(y1, y2));

  // ---------- Explosionen & Verschlucken ----------
  function explodeShip(id, s, now) {
    const col = players[id] ? players[id].color : '#fff';
    for (let i = 0; i < 5; i++) {
      debris.push({
        x: s.x, y: s.y,
        vx: s.vx * 0.3 + (Math.random() - 0.5) * 260, vy: s.vy * 0.3 + (Math.random() - 0.5) * 260,
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 12,
        size: 4 + Math.random() * 7, color: col, born: now, life: 850 + Math.random() * 400
      });
    }
    waves.push({ x: s.x, y: s.y, born: now, life: 480, r1: 76, color: col });
    spark(s.x, s.y, col, 18, 260, 3.4, 600);
    spark(s.x, s.y, '#ffd60a', 8, 200, 2.6, 450);
    setShake(9, 380);
  }
  function suckObject(x, y, color, size) {
    const a = Math.atan2(y - CY, x - CX);
    sucks.push({ ang: a, dist: Math.hypot(x - CX, y - CY), color, size, born: performance.now(), life: 650 });
  }

  function killShip(id, s, now, cause, killerId) {
    if (!s.alive) return;
    if (s.shield && cause !== 'hole') {
      s.shield = false;
      waves.push({ x: s.x, y: s.y, born: now, life: 350, r1: 46, color: '#6db9ff' });
      spark(s.x, s.y, '#6db9ff', 12, 200, 3, 450);
      s.protUntil = now + 900;
      ac.message(id, { t: 'saYou', msg: '🛡️ Schild hat dich gerettet!' });
      return;
    }
    s.alive = false;
    if (cause === 'hole') {
      suckObject(s.x, s.y, players[id] ? players[id].color : '#fff', 13);
      say('🌀 ' + nameOf(id) + ' wurde verschluckt!', '#b16bff', 1800, 34);
    } else {
      explodeShip(id, s, now);
      if (killerId !== undefined && killerId !== id) say('💥 ' + nameOf(killerId) + ' zerlegt ' + nameOf(id) + '!', '#ff9f0a', 1700, 34);
      else if (cause === 'asteroid') say('☄️ ' + nameOf(id) + ' küsst einen Asteroiden!', '#c9b391', 1700, 32);
      else if (cause === 'ram') say('💥 ' + nameOf(id) + ' zerschellt!', '#ff9f0a', 1600, 32);
    }
    ac.message(id, { t: 'saYou', dead: true });
    checkRoundEnd(now);
  }

  // ---------- Asteroiden ----------
  function asteroidVerts() {
    const v = [];
    for (let i = 0; i < 10; i++) v.push(0.72 + Math.random() * 0.5);
    return v;
  }
  function spawnAsteroid(x, y, size, vx, vy) {
    asteroids.push({
      x, y, size, r: size === 3 ? 32 : size === 2 ? 20 : 11,
      vx: vx !== undefined ? vx : (Math.random() - 0.5) * 70,
      vy: vy !== undefined ? vy : (Math.random() - 0.5) * 70,
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 1.6,
      verts: asteroidVerts()
    });
  }
  function breakAsteroid(idx, now) {
    const a = asteroids[idx];
    asteroids.splice(idx, 1);
    spark(a.x, a.y, '#c9b391', a.size * 6, 170, 3, 550);
    if (a.size > 1) {
      for (let i = 0; i < 2; i++) {
        const ang = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 50;
        spawnAsteroid(a.x, a.y, a.size - 1, a.vx * 0.5 + Math.cos(ang) * sp, a.vy * 0.5 + Math.sin(ang) * sp);
      }
    }
    setShake(3, 150);
  }

  // ---------- Power-ups ----------
  const POWS = {
    shield: { icon: '🛡️', color: '#6db9ff' },
    triple: { icon: '⚡', color: '#ffd60a' },
    turbo: { icon: '🚀', color: '#7dffb1' }
  };
  function spawnPowerup(now) {
    const kinds = Object.keys(POWS);
    for (let tries = 0; tries < 12; tries++) {
      const x = 60 + Math.random() * (W - 120), y = 60 + Math.random() * (H - 120);
      if (Math.hypot(x - CX, y - CY) < 130) continue;
      if (order.some(id => ships[id] && ships[id].alive && wdist(x, y, ships[id].x, ships[id].y) < 90)) continue;
      powerups.push({ x, y, kind: kinds[Math.floor(Math.random() * kinds.length)], vx: (Math.random() - 0.5) * 24, vy: (Math.random() - 0.5) * 24, born: now });
      return;
    }
  }

  // ---------- Runden ----------
  function spawnRound(now) {
    roundNo++;
    bullets = []; powerups = []; debris = []; waves = []; sucks = [];
    hole.r = HOLE_R; hole.target = HOLE_R; hole.sudden = false;
    lastPow = now + 2500;
    const n = order.length;
    order.forEach((id, i) => {
      const a = -Math.PI / 2 + i / n * Math.PI * 2;
      ships[id] = {
        x: CX + Math.cos(a) * 235, y: CY + Math.sin(a) * 175,
        vx: 0, vy: 0, ang: a + Math.PI / 2, // tangential — nicht direkt ins Loch
        turn: 0, thrust: false, fire: false, lastFire: 0,
        alive: true, shield: false, tripleUntil: 0, turboUntil: 0,
        protUntil: now + 4700, flame: 0
      };
    });
    asteroids = [];
    for (let i = 0; i < 6; i++) {
      for (let tries = 0; tries < 16; tries++) {
        const x = Math.random() * W, y = Math.random() * H;
        if (Math.hypot(x - CX, y - CY) < 140) continue;
        if (order.some(id => wdist(x, y, ships[id].x, ships[id].y) < 120)) continue;
        spawnAsteroid(x, y, 3);
        break;
      }
    }
    phase = 'countdown';
    phaseAt = now + 3000;
    order.forEach(id => ac.message(id, { t: 'saState', phase: 'countdown', round: roundNo }));
  }

  function checkRoundEnd(now) {
    if (phase !== 'fight') return;
    const alive = order.filter(id => ships[id] && ships[id].alive);
    if (alive.length > 1) return;
    phase = 'roundOver';
    phaseAt = now + 3400;
    roundWinner = alive[0] !== undefined ? alive[0] : null;
    if (roundWinner !== null) {
      points[roundWinner] = (points[roundWinner] || 0) + 1;
      say('🏆 ' + nameOf(roundWinner) + ' überlebt!', '#ffd60a', 2800, 48);
      setFlash('#ffffff', 300);
    } else {
      say('☠️ Doppel-K.O. — kein Punkt!', '#aaa', 2600, 40);
    }
    order.forEach(id => ac.message(id, { t: 'saYou', points: points[id] || 0, target: targetPoints }));
  }

  function afterRound(now) {
    const best = Math.max(...order.map(id => points[id] || 0));
    const leaders = order.filter(id => (points[id] || 0) === best);
    if (best >= targetPoints && leaders.length === 1) {
      phase = 'final';
      champion = leaders[0];
      setFlash('#ffd60a', 500);
      const h = hostId();
      order.forEach(id => ac.message(id, { t: 'saFinal', winner: id === champion, name: nameOf(champion), host: id === h }));
      return;
    }
    spawnRound(now);
  }

  // ---------- Simulation ----------
  function gravity(x, y, dt, mul) {
    const dx = CX - x, dy = CY - y;
    const d2 = Math.max(dx * dx + dy * dy, 1200);
    const a = G_FORCE / d2 * (mul || 1) * (hole.sudden ? 1.9 : 1) * dt;
    const d = Math.sqrt(d2);
    return [dx / d * a, dy / d * a];
  }

  function simulate(dt, now) {
    if (phase === 'countdown') { if (now >= phaseAt) { phase = 'fight'; fightAt = now; order.forEach(id => ac.message(id, { t: 'saState', phase: 'fight' })); } return; }
    if (phase === 'roundOver') { if (now >= phaseAt) afterRound(now); }
    if (phase === 'final') return;

    // Sudden Death: das Loch wächst
    if (phase === 'fight' && !hole.sudden && now - fightAt > SUDDEN_AT) {
      hole.sudden = true;
      hole.target = HOLE_R_MAX;
      say('🌀 DAS LOCH WÄCHST!', '#b16bff', 2600, 52);
      setShake(10, 900);
      setFlash('#b16bff', 350);
    }
    hole.r += (hole.target - hole.r) * Math.min(1, dt * 0.4);

    // Schiffe
    order.forEach(id => {
      const s = ships[id];
      if (!s || !s.alive) return;
      const turbo = now < s.turboUntil;
      s.ang += s.turn * TURN * dt;
      if (s.thrust) {
        const p = turbo ? TURBO_THRUST : THRUST;
        s.vx += Math.cos(s.ang) * p * dt;
        s.vy += Math.sin(s.ang) * p * dt;
        s.flame = Math.min(1, s.flame + dt * 8);
      } else s.flame = Math.max(0, s.flame - dt * 6);
      const [gx, gy] = gravity(s.x, s.y, dt);
      s.vx += gx; s.vy += gy;
      const damp = Math.pow(0.42, dt);
      s.vx *= damp; s.vy *= damp;
      const sp = Math.hypot(s.vx, s.vy), max = turbo ? TURBO_VMAX : VMAX;
      if (sp > max) { s.vx = s.vx / sp * max; s.vy = s.vy / sp * max; }
      s.x = wrapX(s.x + s.vx * dt);
      s.y = wrapY(s.y + s.vy * dt);
      // Triebwerks-Partikel
      if (s.flame > 0.3 && sparks.length < 380 && Math.random() < 0.7) {
        const bx = s.x - Math.cos(s.ang) * 13, by = s.y - Math.sin(s.ang) * 13;
        sparks.push({ x: bx, y: by, vx: -Math.cos(s.ang) * 130 + (Math.random() - 0.5) * 40, vy: -Math.sin(s.ang) * 130 + (Math.random() - 0.5) * 40, born: now, life: 280, color: turbo ? '#7dffb1' : '#ff9f0a', size: 2.6 });
      }
      // Feuern
      if (s.fire && now - s.lastFire > FIRE_MS && phase === 'fight') {
        s.lastFire = now;
        const triple = now < s.tripleUntil;
        const angs = triple ? [-0.18, 0, 0.18] : [0];
        angs.forEach(off => {
          const a = s.ang + off;
          bullets.push({
            x: s.x + Math.cos(a) * 15, y: s.y + Math.sin(a) * 15,
            vx: Math.cos(a) * BULLET_SPEED + s.vx * 0.45, vy: Math.sin(a) * BULLET_SPEED + s.vy * 0.45,
            owner: id, born: now, color: players[id] ? players[id].color : '#fff'
          });
        });
      }
      // Loch-Horizont
      if (Math.hypot(s.x - CX, s.y - CY) < hole.r + 7 && now > s.protUntil) killShip(id, s, now, 'hole');
    });

    // Schiff vs. Schiff (Rammen)
    const alive = order.filter(id => ships[id] && ships[id].alive);
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
      const A = ships[alive[i]], B = ships[alive[j]];
      if (wdist(A.x, A.y, B.x, B.y) < SHIP_R * 2 - 2) {
        if (now > A.protUntil) killShip(alive[i], A, now, 'ram');
        if (now > B.protUntil) killShip(alive[j], B, now, 'ram');
      }
    }

    // Kugeln
    bullets = bullets.filter(b => {
      if (now - b.born > BULLET_TTL) return false;
      const [gx, gy] = gravity(b.x, b.y, dt, 0.65);
      b.vx += gx; b.vy += gy;
      b.x = wrapX(b.x + b.vx * dt);
      b.y = wrapY(b.y + b.vy * dt);
      if (Math.hypot(b.x - CX, b.y - CY) < hole.r + 3) { suckObject(b.x, b.y, b.color, 3); return false; }
      // vs. Asteroiden
      for (let ai = 0; ai < asteroids.length; ai++) {
        const a = asteroids[ai];
        if (wdist(b.x, b.y, a.x, a.y) < a.r) { breakAsteroid(ai, now); return false; }
      }
      // vs. Schiffe
      for (const id of order) {
        const s = ships[id];
        if (!s || !s.alive || id === b.owner || now < s.protUntil) continue;
        if (wdist(b.x, b.y, s.x, s.y) < SHIP_R + 3) {
          killShip(id, s, now, 'shot', b.owner);
          return false;
        }
      }
      return true;
    });

    // Asteroiden
    for (let ai = asteroids.length - 1; ai >= 0; ai--) {
      const a = asteroids[ai];
      const [gx, gy] = gravity(a.x, a.y, dt, 0.5);
      a.vx += gx; a.vy += gy;
      a.x = wrapX(a.x + a.vx * dt);
      a.y = wrapY(a.y + a.vy * dt);
      a.rot += a.vr * dt;
      if (Math.hypot(a.x - CX, a.y - CY) < hole.r + a.r * 0.4) {
        suckObject(a.x, a.y, '#c9b391', a.r * 0.6);
        asteroids.splice(ai, 1);
        continue;
      }
      for (const id of order) {
        const s = ships[id];
        if (!s || !s.alive || now < s.protUntil) continue;
        if (wdist(a.x, a.y, s.x, s.y) < a.r + SHIP_R - 3) {
          killShip(id, s, now, 'asteroid');
          if (!s.alive) { breakAsteroid(ai, now); break; }
        }
      }
    }

    // Power-ups
    if (phase === 'fight' && now > lastPow + 6500 && powerups.length < 3) { lastPow = now; spawnPowerup(now); }
    for (let pi = powerups.length - 1; pi >= 0; pi--) {
      const p = powerups[pi];
      const [gx, gy] = gravity(p.x, p.y, dt, 0.3);
      p.vx += gx; p.vy += gy;
      p.x = wrapX(p.x + p.vx * dt);
      p.y = wrapY(p.y + p.vy * dt);
      if (Math.hypot(p.x - CX, p.y - CY) < hole.r + 6) { suckObject(p.x, p.y, POWS[p.kind].color, 6); powerups.splice(pi, 1); continue; }
      for (const id of order) {
        const s = ships[id];
        if (!s || !s.alive) continue;
        if (wdist(p.x, p.y, s.x, s.y) < 22) {
          if (p.kind === 'shield') { s.shield = true; ac.message(id, { t: 'saYou', msg: '🛡️ Schild aktiv!' }); }
          else if (p.kind === 'triple') { s.tripleUntil = now + 8000; ac.message(id, { t: 'saYou', msg: '⚡ Triple-Shot!' }); }
          else { s.turboUntil = now + 6000; ac.message(id, { t: 'saYou', msg: '🚀 Turbo!' }); }
          spark(p.x, p.y, POWS[p.kind].color, 12, 180, 3, 500);
          powerups.splice(pi, 1);
          break;
        }
      }
    }

    // Akkretions-Staub
    if (holeDust.length < 46 && Math.random() < 0.5) {
      const a = Math.random() * Math.PI * 2;
      holeDust.push({ ang: a, dist: hole.r + 40 + Math.random() * 70, va: 1.6 + Math.random() * 1.6, vd: 12 + Math.random() * 16 });
    }
    holeDust = holeDust.filter(d => {
      d.ang += d.va * dt * (1 + (hole.sudden ? 0.8 : 0));
      d.dist -= d.vd * dt * (hole.sudden ? 2.2 : 1);
      return d.dist > hole.r * 0.55;
    });
  }

  // ---------- Rendering ----------
  let vignette = null;
  function drawVignette() {
    if (!vignette) {
      vignette = document.createElement('canvas');
      vignette.width = W; vignette.height = H;
      const g = vignette.getContext('2d');
      const grad = g.createRadialGradient(CX, CY, H * 0.45, CX, CY, H * 0.95);
      grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.5)');
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
    }
    ctx.drawImage(vignette, 0, 0);
  }

  function drawBackground(now, dt) {
    ctx.fillStyle = '#040210';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    stars.forEach(s => {
      s.x = wrapX(s.x - s.v * dt * 8);
      ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(now / 800 + s.y));
      ctx.fillRect(s.x, s.y, s.s, s.s);
    });
    ctx.globalAlpha = 1;
    // Sternschnuppen
    if (Math.random() < 0.004 && shoots.length < 2) {
      shoots.push({ x: Math.random() * W, y: Math.random() * H * 0.5, vx: -420 - Math.random() * 200, vy: 160 + Math.random() * 120, born: now });
    }
    ctx.globalCompositeOperation = 'lighter';
    shoots = shoots.filter(sh => {
      const age = (now - sh.born) / 900;
      if (age >= 1) return false;
      sh.x += sh.vx * dt; sh.y += sh.vy * dt;
      ctx.strokeStyle = 'rgba(180,210,255,' + (0.5 * (1 - age)) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(sh.x - sh.vx * 0.08, sh.y - sh.vy * 0.08); ctx.stroke();
      return true;
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHole(now) {
    // Akkretionsscheibe
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(CX, CY, hole.r * 1.7, '#b16bff', hole.sudden ? 0.55 : 0.35);
    [1.55, 2.1].forEach((m, i) => {
      ctx.strokeStyle = 'rgba(177,107,255,' + (0.4 - i * 0.14) + ')';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([16, 12]);
      ctx.lineDashOffset = (i ? -1 : 1) * now / 8;
      ctx.beginPath(); ctx.ellipse(CX, CY, hole.r * m, hole.r * m * 0.86, now / 4000, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.setLineDash([]);
    holeDust.forEach(d => {
      drawGlow(CX + Math.cos(d.ang) * d.dist, CY + Math.sin(d.ang) * d.dist * 0.9, 2.4, '#d9b8ff', 0.7);
    });
    ctx.globalCompositeOperation = 'source-over';
    // Ereignishorizont
    const grad = ctx.createRadialGradient(CX, CY, hole.r * 0.2, CX, CY, hole.r);
    grad.addColorStop(0, '#000'); grad.addColorStop(0.75, '#06010d'); grad.addColorStop(1, '#2a1650');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(CX, CY, hole.r, 0, Math.PI * 2); ctx.fill();
  }

  function drawShipAt(x, y, s, id, now) {
    const col = players[id] ? players[id].color : '#fff';
    // Flamme
    if (s.flame > 0.05) {
      const fl = s.flame * (0.7 + Math.random() * 0.5);
      const bx = x - Math.cos(s.ang) * 12, by = y - Math.sin(s.ang) * 12;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = now < s.turboUntil ? '#7dffb1' : '#ff9f0a';
      ctx.save(); ctx.translate(bx, by); ctx.rotate(s.ang);
      ctx.beginPath(); ctx.moveTo(0, -5 * fl); ctx.lineTo(-16 * fl, 0); ctx.lineTo(0, 5 * fl); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(x, y, 15, col, 0.5);
    ctx.globalCompositeOperation = 'source-over';
    const blink = now < s.protUntil && Math.floor(now / 130) % 2 === 0;
    ctx.save(); ctx.translate(x, y); ctx.rotate(s.ang + Math.PI / 2);
    ctx.globalAlpha = blink ? 0.35 : 1;
    ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(10, 11); ctx.lineTo(0, 5); ctx.lineTo(-10, 11); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
    if (s.shield) {
      ctx.strokeStyle = 'rgba(120,190,255,' + (0.55 + Math.sin(now / 150) * 0.2) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, SHIP_R + 8, 0, Math.PI * 2); ctx.stroke();
    }
    if (now < s.tripleUntil) drawGlow(x, y - 20, 3, '#ffd60a', 0.9);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(shortName(id), x, y - 26);
  }

  function drawShips(now) {
    order.forEach(id => {
      const s = ships[id];
      if (!s || !s.alive) return;
      drawShipAt(s.x, s.y, s, id, now);
      // Wrap-Geister an den Rändern
      if (s.x < 40) drawShipAt(s.x + W, s.y, s, id, now);
      if (s.x > W - 40) drawShipAt(s.x - W, s.y, s, id, now);
      if (s.y < 40) drawShipAt(s.x, s.y + H, s, id, now);
      if (s.y > H - 40) drawShipAt(s.x, s.y - H, s, id, now);
    });
  }

  function drawAsteroids(now) {
    asteroids.forEach(a => {
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(a.x, a.y, a.r * 0.55, '#8b7f9e', 0.22);
      ctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.rot);
      ctx.fillStyle = '#2a2140'; ctx.strokeStyle = '#c3b6dd'; ctx.lineWidth = 2.2;
      ctx.beginPath();
      a.verts.forEach((v, i) => {
        const ang = i / a.verts.length * Math.PI * 2;
        const px = Math.cos(ang) * a.r * v, py = Math.sin(ang) * a.r * v;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    });
  }

  function drawPowerups(now) {
    powerups.forEach(p => {
      const pu = POWS[p.kind];
      const pulse = 1 + Math.sin(now / 200 + p.born) * 0.15;
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(p.x, p.y, 12 * pulse, pu.color, 0.6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = pu.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 13 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '14px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(pu.icon, p.x, p.y + 1);
    });
  }

  function drawBullets() {
    ctx.globalCompositeOperation = 'lighter';
    bullets.forEach(b => {
      drawGlow(b.x, b.y, 5, b.color, 0.9);
      ctx.strokeStyle = b.color; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022); ctx.stroke();
      ctx.globalAlpha = 1;
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFx(now, dt) {
    // Trümmer-Shards
    debris = debris.filter(d => {
      const f = (now - d.born) / d.life;
      if (f >= 1) return false;
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.vx *= 0.99; d.vy *= 0.99;
      d.rot += d.vr * dt;
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
      ctx.globalAlpha = 1 - f;
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.moveTo(0, -d.size); ctx.lineTo(d.size * 0.8, d.size * 0.6); ctx.lineTo(-d.size * 0.8, d.size * 0.4); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
      return true;
    });
    // Schockwellen
    ctx.globalCompositeOperation = 'lighter';
    waves = waves.filter(w => {
      const f = (now - w.born) / w.life;
      if (f >= 1) return false;
      ctx.strokeStyle = w.color; ctx.globalAlpha = 0.7 * (1 - f);
      ctx.lineWidth = 3.5 * (1 - f) + 1;
      ctx.beginPath(); ctx.arc(w.x, w.y, 6 + w.r1 * f, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      return true;
    });
    // Funken
    sparks = sparks.filter(p => {
      const f = (now - p.born) / p.life;
      if (f >= 1) return false;
      p.x += p.vx * dt; p.y += p.vy * dt;
      drawGlow(p.x, p.y, p.size * (1 - f) + 1, p.color, 1 - f);
      return true;
    });
    // Verschluck-Spiralen
    sucks = sucks.filter(su => {
      const f = (now - su.born) / su.life;
      if (f >= 1) { spark(CX, CY, su.color, 4, 90, 2, 300); return false; }
      const ang = su.ang + f * 7, dist = su.dist * (1 - f) + hole.r * 0.4 * f;
      const x = CX + Math.cos(ang) * dist, y = CY + Math.sin(ang) * dist;
      drawGlow(x, y, su.size * (1 - f) + 1.5, su.color, 1 - f * 0.6);
      return true;
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHud(now) {
    // Punkte
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = 'bold 14px system-ui,sans-serif';
    order.forEach((id, i) => {
      const s = ships[id];
      const y = 22 + i * 22;
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(10, y - 10, 150, 20);
      ctx.fillStyle = players[id] ? players[id].color : '#888';
      ctx.beginPath(); ctx.arc(22, y, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s && s.alive ? '#fff' : 'rgba(255,255,255,.45)';
      ctx.fillText((s && s.alive ? '' : '💀 ') + shortName(id) + ' · ' + (points[id] || 0), 33, y);
    });
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px system-ui,sans-serif';
    ctx.fillText('Runde ' + roundNo + ' — Ziel: ' + targetPoints + 'P', W - 14, 22);
    if (phase === 'fight' && !hole.sudden) {
      const left = Math.max(0, Math.ceil((SUDDEN_AT - (now - fightAt)) / 1000));
      if (left <= 10) { ctx.fillStyle = '#b16bff'; ctx.fillText('🌀 ' + left + 's', W - 14, 46); }
    }
    // Countdown
    if (phase === 'countdown') {
      const leftS = Math.ceil((phaseAt - now) / 1000);
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.font = 'bold 100px system-ui,sans-serif';
      ctx.shadowColor = '#b16bff'; ctx.shadowBlur = 22;
      ctx.fillText(leftS > 0 ? String(leftS) : 'GO!', CX, CY - 90);
      ctx.shadowBlur = 0;
    } else if (phase === 'fight' && now - fightAt < 900) {
      ctx.textAlign = 'center'; ctx.fillStyle = '#7dffb1';
      ctx.font = 'bold 100px system-ui,sans-serif';
      ctx.shadowColor = '#7dffb1'; ctx.shadowBlur = 22;
      ctx.fillText('GO!', CX, CY - 90);
      ctx.shadowBlur = 0;
    }
    // Announcement
    if (announce && now < announce.until) {
      const f = (announce.until - now) / 1000;
      ctx.textAlign = 'center'; ctx.globalAlpha = Math.min(1, f * 2);
      ctx.font = 'bold ' + announce.size + 'px system-ui,sans-serif';
      ctx.fillStyle = announce.color;
      ctx.shadowColor = announce.color; ctx.shadowBlur = 16;
      ctx.fillText(announce.text, CX, H * 0.3);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    // Finale
    if (phase === 'final' && champion !== null) {
      ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 56px system-ui,sans-serif';
      ctx.shadowColor = '#ffd60a'; ctx.shadowBlur = 24;
      ctx.fillText('👑 ' + nameOf(champion) + ' beherrscht das All!', CX, CY - 100);
      ctx.shadowBlur = 0;
      const st = order.slice().sort((a, b) => (points[b] || 0) - (points[a] || 0));
      ctx.font = 'bold 24px system-ui,sans-serif';
      st.forEach((id, i) => {
        ctx.fillStyle = players[id] ? players[id].color : '#888';
        ctx.fillText((i + 1) + '.  ' + shortName(id) + ' — ' + (points[id] || 0) + ' Punkte', CX, CY - 30 + i * 38);
      });
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '16px system-ui,sans-serif';
      ctx.fillText('⭐ Host kann am Handy eine Revanche starten', CX, H - 50);
    }
    ctx.textAlign = 'right'; ctx.font = '13px system-ui,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText('Host kann am Handy abbrechen ✕', W - 12, H - 12);
  }

  return {
    acceptsJoin: false,
    start(ids, cfg) {
      order = ids.slice().sort((a, b) => a - b);
      targetPoints = (cfg && cfg.targetPoints) || 3;
      points = {}; order.forEach(id => { points[id] = 0; });
      ships = {}; sparks = []; debris = []; waves = []; sucks = []; holeDust = []; shoots = [];
      champion = null; roundNo = 0;
      stars = Array.from({ length: 110 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 0.4 + Math.random() * 1.6, s: Math.random() < 0.18 ? 2 : 1, a: 0.25 + Math.random() * 0.75 }));
      lastT = performance.now();
      spawnRound(performance.now());
      order.forEach(id => ac.message(id, { t: 'saYou', points: 0, target: targetPoints }));
    },
    stop() { ships = {}; bullets = []; asteroids = []; },
    onDisconnect(id) {
      order = order.filter(o => o !== id);
      delete ships[id]; delete points[id];
      if (order.length < 2) { endToLobby('Space Arena braucht mind. 2 Spieler.'); return; }
      if (phase === 'final' && champion !== null) {
        // Host könnte gegangen sein — Nochmal-Button an den neuen Host geben
        const h = hostId();
        order.forEach(o => ac.message(o, { t: 'saFinal', winner: o === champion, name: nameOf(champion), host: o === h }));
        return;
      }
      checkRoundEnd(performance.now());
    },
    onMessage(id, d) {
      if (!d) return;
      if (d.t === 'saAgain' && id === hostId() && phase === 'final') {
        this.start(order, { targetPoints });
        return;
      }
      const s = ships[id];
      if (!s) return;
      if (d.t === 'saCtl') {
        s.turn = clamp(+d.turn || 0, -1, 1);
        s.thrust = !!d.thrust;
        s.fire = !!d.fire;
      }
    },
    render() {
      const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      simulate(dt, now);
      ctx.save();
      if (now < shake.until) {
        const m = shake.mag * (shake.until - now) / 700;
        ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      } else shake.mag = 0;
      drawBackground(now, dt);
      drawHole(now);
      drawAsteroids(now);
      drawPowerups(now);
      drawBullets();
      drawShips(now);
      drawFx(now, dt);
      drawVignette();
      drawHud(now);
      if (now < flash.until) {
        ctx.globalAlpha = 0.5 * (flash.until - now) / flash.dur;
        ctx.fillStyle = flash.color;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    },
    _debug() { return { ships, bullets, asteroids, powerups, phase, points, hole }; }
  };
}});
