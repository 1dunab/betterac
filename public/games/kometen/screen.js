// ===== Modul: KOMETEN-KLATSCHE ==============================
// Neon-Volleyball: Zwei Teams schmettern sich einen brennenden
// Kometen über den Screen. Wisch am Handy = Abflugwinkel + Power.
// Rally beschleunigt; wer den Kometen in die Rückwand lässt,
// schenkt dem Gegner-Team einen Punkt.
// ============================================================
registerGame({ key: 'kometen', screen: function () {
  const W = cv.width, H = cv.height, R = 10;
  const TEAM_COL = ['#ff2d55', '#0a84ff'];
  const TEAM_NAME = ['Team Rot', 'Team Blau'];
  const MATCH_MS = 180000;

  let order = [], teams = [[], []], teamOf = {}, score = [0, 0], ziel = 7;
  let balls = [], rally = 0, phase = 'serve'; // serve | play | point | end
  let phaseAt = 0, startAt = 0, lastT = 0, serveTeam = 0, winnerTeam = null, golden = false;
  let hotState = {}, lockUntil = {};
  let parts = [], waves = [], announce = null, shake = { mag: 0, until: 0 };

  // ---------- Glow / FX (Standard-Kit) ----------
  const glowCache = {};
  function glowSprite(color) {
    if (glowCache[color]) return glowCache[color];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color); grad.addColorStop(0.4, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    glowCache[color] = c;
    return c;
  }
  function drawGlow(x, y, r, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(glowSprite(color), x - r * 2, y - r * 2, r * 4, r * 4);
    ctx.globalAlpha = 1;
  }
  function say(text, color, ms, size) { announce = { text, color: color || '#fff', until: performance.now() + (ms || 1800), size: size || 44 }; }
  function setShake(mag, ms) { shake.mag = Math.max(shake.mag, mag); shake.until = performance.now() + ms; }
  function spark(x, y, color, n, speed, size, life) {
    for (let i = 0; i < n; i++) {
      if (parts.length > 400) return;
      const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random() * 0.7) * speed;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0, color, size: size || 3, born: performance.now(), life: life * (0.6 + Math.random() * 0.8) });
    }
  }
  function confetti(team) {
    const x0 = team === 0 ? W * 0.25 : W * 0.75;
    for (let i = 0; i < 60; i++) {
      parts.push({
        x: x0 + (Math.random() - 0.5) * 200, y: H * 0.3 + (Math.random() - 0.5) * 100,
        vx: (Math.random() - 0.5) * 260, vy: -120 - Math.random() * 180, g: 340,
        color: Math.random() < 0.7 ? TEAM_COL[team] : '#ffd60a',
        size: 2.5 + Math.random() * 2.5, born: performance.now(), life: 900 + Math.random() * 700
      });
    }
  }

  // ---------- Teams / Zonen ----------
  function buildTeams() {
    teams = [[], []]; teamOf = {};
    order.forEach((id, i) => {
      const t = i % 2;
      teams[t].push(id);
      teamOf[id] = t;
    });
  }
  function bandOf(id) {
    const t = teamOf[id], list = teams[t], i = list.indexOf(id);
    const bh = H / list.length;
    return { y0: i * bh, y1: (i + 1) * bh, team: t };
  }
  function zoneHolder(ball) {
    // Wessen Band ist der Ball gerade? (nur in der Hälfte, in die er fliegt)
    const t = ball.vx < 0 ? 0 : 1;
    const onHalf = t === 0 ? ball.x < W / 2 : ball.x > W / 2;
    if (!onHalf) return null;
    const list = teams[t];
    if (!list.length) return null;
    const i = Math.min(list.length - 1, Math.max(0, Math.floor(ball.y / (H / list.length))));
    return list[i];
  }
  function syncHot() {
    const hot = {};
    balls.forEach(b => { const h = zoneHolder(b); if (h !== null) hot[h] = true; });
    order.forEach(id => {
      const on = !!hot[id] && phase === 'play';
      if (hotState[id] !== on) {
        hotState[id] = on;
        ac.message(id, { t: 'kkTurn', hot: on });
      }
    });
  }

  // ---------- Ball ----------
  const rallySpeed = () => Math.min(560, 195 + rally * 15);
  function spawnBall(x, y, ang, speed) {
    balls.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, hot: false });
  }
  function serve(now) {
    phase = 'serve';
    phaseAt = now + 1200;
    balls = [];
    rally = 0;
  }
  function launchServe() {
    const dir = serveTeam === 0 ? 0 : Math.PI; // Verlierer-Team schlägt Richtung Gegner auf
    const ang = dir + (Math.random() - 0.5) * 0.7;
    spawnBall(W / 2 + (serveTeam === 0 ? -60 : 60), H * (0.3 + Math.random() * 0.4), ang, 185);
    phase = 'play';
  }

  function pointFor(team, now) {
    score[team]++;
    confetti(team);
    setShake(9, 450);
    say('🎉 Punkt für ' + TEAM_NAME[team] + '!', TEAM_COL[team], 1600, 40);
    serveTeam = 1 - team;
    order.forEach(id => ac.message(id, {
      t: 'kkScore', a: score[0], b: score[1],
      msg: teamOf[id] === team ? '🎉 Punkt für euch!' : '💥 ' + TEAM_NAME[team] + ' punktet…'
    }));
    if (score[team] >= ziel || golden) { endMatch(team); return; }
    serve(now);
    phaseAt = now + 1600;
  }

  function endMatch(team) {
    phase = 'end';
    winnerTeam = team;
    setShake(12, 800);
    balls = [];
    const h = hostId();
    order.forEach(id => ac.message(id, {
      t: 'kkEnd', win: teamOf[id] === team, name: TEAM_NAME[team], host: id === h
    }));
  }

  // ---------- Swipe-Return ----------
  function handleSwipe(id, d, now) {
    if (phase !== 'play' || now < (lockUntil[id] || 0)) return;
    const t = teamOf[id];
    // returnbarer Ball: in meinem Band, am nächsten an meiner Rückwand
    let best = null, bestDepth = -1;
    balls.forEach(b => {
      if (zoneHolder(b) !== id) return;
      const depth = t === 0 ? W / 2 - b.x : b.x - W / 2;
      if (depth > bestDepth) { bestDepth = depth; best = b; }
    });
    if (!best) {
      // Whiff: kurzer Lockout gegen Panik-Gewische
      lockUntil[id] = now + 550;
      ac.message(id, { t: 'kkFx', lock: true });
      return;
    }
    // Richtung: Wisch zählt, aber immer Richtung Gegnerhälfte
    const toEnemy = t === 0 ? 1 : -1;
    let dx = (+d.dx || 0) * toEnemy > 0 ? +d.dx : 0.4 * toEnemy;
    let dy = +d.dy || 0;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    if (Math.abs(dx) < 0.35) { dx = 0.35 * toEnemy; const s = Math.sign(dy) || 1; dy = s * Math.sqrt(1 - dx * dx); }
    rally++;
    const power = clamp(+d.power || 1, 0.3, 3);
    const speed = rallySpeed() * (0.88 + 0.16 * Math.min(1.6, power));
    best.vx = dx * speed; best.vy = dy * speed;
    best.hot = false;
    waves.push({ x: best.x, y: best.y, born: now, life: 380, r1: 60, color: players[id] ? players[id].color : '#fff' });
    spark(best.x, best.y, TEAM_COL[t], 8, 180, 2.5, 400);
    setShake(3, 140);
  }

  // ---------- Simulation ----------
  function simulate(dt, now) {
    if (phase === 'serve' && now >= phaseAt) launchServe();
    if (phase !== 'play') { syncHot(); return; }
    if (!golden && now - startAt > MATCH_MS) {
      if (score[0] !== score[1]) { endMatch(score[0] > score[1] ? 0 : 1); return; }
      golden = true;
      say('⚡ GOLDEN GOAL — nächster Punkt gewinnt!', '#ffd60a', 3000, 38);
    }
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy); }
      if (b.y > H - R) { b.y = H - R; b.vy = -Math.abs(b.vy); }
      // Trail
      if (parts.length < 380) {
        parts.push({ x: b.x - b.vx * 0.02, y: b.y - b.vy * 0.02, vx: -b.vx * 0.06 + (Math.random() - 0.5) * 24, vy: -b.vy * 0.06 + (Math.random() - 0.5) * 24, g: 0, color: Math.random() < 0.6 ? '#ff9f43' : '#ffd27a', size: 2.6, born: now, life: 300 });
      }
      if (b.x < -R) { balls.splice(i, 1); pointFor(1, now); return; }
      if (b.x > W + R) { balls.splice(i, 1); pointFor(0, now); return; }
    }
    syncHot();
  }

  // ---------- Rendering ----------
  function drawArena(now) {
    ctx.fillStyle = '#05030c';
    ctx.fillRect(0, 0, W, H);
    // Team-Hälften hauchzart getönt
    for (const t of [0, 1]) {
      const g = ctx.createLinearGradient(t === 0 ? 0 : W, 0, W / 2, 0);
      g.addColorStop(0, TEAM_COL[t] + '22'); g.addColorStop(1, TEAM_COL[t] + '00');
      ctx.fillStyle = g;
      ctx.fillRect(t === 0 ? 0 : W / 2, 0, W / 2, H);
    }
    // Bänder + Namen
    for (const t of [0, 1]) {
      const list = teams[t], bh = H / Math.max(1, list.length);
      list.forEach((id, i) => {
        const y = i * bh, col = players[id] ? players[id].color : '#888';
        const on = hotState[id];
        if (i > 0) {
          ctx.strokeStyle = TEAM_COL[t] + '33'; ctx.lineWidth = 1;
          ctx.setLineDash([8, 10]);
          ctx.beginPath();
          ctx.moveTo(t === 0 ? 0 : W / 2, y); ctx.lineTo(t === 0 ? W / 2 : W, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (on) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.12 + 0.05 * Math.sin(now / 90);
          ctx.fillStyle = col;
          ctx.fillRect(t === 0 ? 0 : W / 2, y, W / 2, bh);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,.55)';
        ctx.font = 'bold 13px system-ui,sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = t === 0 ? 'left' : 'right';
        ctx.fillText((on ? '👋 ' : '') + shortName(id), t === 0 ? 10 : W - 10, y + bh / 2);
      });
    }
    // Mittellinie
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(190,120,255,.5)'; ctx.lineWidth = 3;
    ctx.setLineDash([14, 12]);
    ctx.lineDashOffset = -now / 30;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawBalls(now) {
    balls.forEach(b => {
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(b.x, b.y, R * 2.1, '#ff7a30', 0.8);
      drawGlow(b.x, b.y, R * 1.1, '#ffd27a', 0.95);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#fff7e8';
      ctx.beginPath(); ctx.arc(b.x, b.y, R * 0.55, 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawFx(now, dt) {
    ctx.globalCompositeOperation = 'lighter';
    waves = waves.filter(w => {
      const f = (now - w.born) / w.life;
      if (f >= 1) return false;
      ctx.strokeStyle = w.color; ctx.globalAlpha = 0.7 * (1 - f);
      ctx.lineWidth = 3 * (1 - f) + 1;
      ctx.beginPath(); ctx.arc(w.x, w.y, 8 + w.r1 * f, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      return true;
    });
    parts = parts.filter(p => {
      const f = (now - p.born) / p.life;
      if (f >= 1) return false;
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      drawGlow(p.x, p.y, p.size * (1 - f) + 1, p.color, 1 - f);
      return true;
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHud(now) {
    // Score
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 42px system-ui,sans-serif';
    ctx.fillStyle = TEAM_COL[0];
    ctx.fillText(String(score[0]), W / 2 - 70, 36);
    ctx.fillStyle = TEAM_COL[1];
    ctx.fillText(String(score[1]), W / 2 + 70, 36);
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = 'bold 20px system-ui,sans-serif';
    ctx.fillText(':', W / 2, 34);
    ctx.font = 'bold 13px system-ui,sans-serif';
    ctx.fillText('Ziel: ' + ziel, W / 2, 58);
    // Timer / Golden Goal
    if (!golden) {
      const left = Math.max(0, Math.ceil((startAt + MATCH_MS - performance.now()) / 1000));
      ctx.textAlign = 'right'; ctx.fillStyle = left <= 20 ? '#ffd60a' : 'rgba(255,255,255,.6)';
      ctx.font = 'bold 17px system-ui,sans-serif';
      ctx.fillText(Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'), W - 14, 20);
    } else {
      ctx.textAlign = 'right'; ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 17px system-ui,sans-serif';
      ctx.fillText('⚡ GOLDEN GOAL', W - 14, 20);
    }
    // Rally-Zähler
    if (phase === 'play' && rally >= 3) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.textAlign = 'center';
      const size = Math.min(120, 34 + rally * 5);
      ctx.font = 'bold ' + size + 'px system-ui,sans-serif';
      ctx.fillStyle = 'rgba(190,120,255,' + Math.min(0.5, 0.14 + rally * 0.022) + ')';
      ctx.fillText(String(rally), W / 2, H / 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (phase === 'serve') {
      ctx.textAlign = 'center'; ctx.fillStyle = TEAM_COL[serveTeam];
      ctx.font = 'bold 22px system-ui,sans-serif';
      ctx.fillText('Aufschlag ' + TEAM_NAME[serveTeam] + '…', W / 2, H / 2 + 60);
    }
    if (announce && now < announce.until) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, (announce.until - now) / 400);
      ctx.font = 'bold ' + announce.size + 'px system-ui,sans-serif';
      ctx.fillStyle = announce.color;
      ctx.shadowColor = announce.color; ctx.shadowBlur = 18;
      ctx.fillText(announce.text, W / 2, H * 0.3);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (phase === 'end' && winnerTeam !== null) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = TEAM_COL[winnerTeam];
      ctx.font = 'bold 58px system-ui,sans-serif';
      ctx.shadowColor = TEAM_COL[winnerTeam]; ctx.shadowBlur = 24;
      ctx.fillText('🏆 ' + TEAM_NAME[winnerTeam] + ' gewinnt!', W / 2, H / 2 - 50);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 30px system-ui,sans-serif';
      ctx.fillText(score[0] + ' : ' + score[1], W / 2, H / 2 + 10);
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '16px system-ui,sans-serif';
      ctx.fillText('⭐ Host kann am Handy eine Revanche starten', W / 2, H - 46);
    }
    ctx.textAlign = 'right'; ctx.font = '13px system-ui,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fillText('Host kann am Handy abbrechen ✕', W - 12, H - 12);
  }

  return {
    acceptsJoin: false,
    start(ids, cfg) {
      order = ids.slice().sort((a, b) => a - b);
      ziel = (cfg && cfg.ziel) || 7;
      score = [0, 0]; winnerTeam = null; golden = false;
      parts = []; waves = []; announce = null; hotState = {}; lockUntil = {};
      buildTeams();
      order.forEach(id => ac.message(id, {
        t: 'kkTeam', team: teamOf[id], color: players[id] ? players[id].color : '#fff'
      }));
      order.forEach(id => ac.message(id, { t: 'kkScore', a: 0, b: 0 }));
      startAt = performance.now();
      lastT = startAt;
      serveTeam = Math.random() < 0.5 ? 0 : 1;
      serve(startAt);
      phaseAt = startAt + 2200;
      say('☄️ Erster bis ' + ziel + ' gewinnt!', '#fff', 2000, 34);
    },
    stop() { balls = []; parts = []; },
    onDisconnect(id) {
      const t = teamOf[id];
      order = order.filter(o => o !== id);
      buildTeams();
      delete hotState[id];
      if (order.length < 2 || !teams[0].length || !teams[1].length) {
        if (phase !== 'end' && t !== undefined && teams[1 - t].length) { endMatch(1 - t); return; }
        endToLobby('Kometen-Klatsche braucht beide Teams.');
      }
    },
    onMessage(id, d) {
      if (!d) return;
      if (d.t === 'kkAgain' && id === hostId() && phase === 'end') {
        this.start(order, { ziel });
        return;
      }
      if (d.t === 'kkSwipe' && teamOf[id] !== undefined) handleSwipe(id, d, performance.now());
    },
    render() {
      const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      simulate(dt, now);
      ctx.save();
      if (now < shake.until) {
        const m = shake.mag * (shake.until - now) / 600;
        ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      } else shake.mag = 0;
      drawArena(now);
      drawBalls(now);
      drawFx(now, dt);
      drawHud(now);
      ctx.restore();
    },
    _debug() { return { balls, teams, teamOf, score, rally, phase, hotState }; }
  };
}});
