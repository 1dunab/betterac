// ===== Modul: BUMPER GEMS ====================================
// ============================================================
registerGame({ key: 'bumpergems', screen: function () {
  const W = cv.width, H = cv.height, R = 18, GEM_R = 8, ROUND_MS = 75000;
  let cars = {}, gems = [], inputs = {}, deadline = 0, lastT = performance.now(), done = false;

  const ids = () => Object.keys(cars).map(Number);
  const alive = () => ids().filter(id => players[id]);
  const rand = (a, b) => a + Math.random() * (b - a);

  function spawnGem() {
    gems.push({ x: rand(50, W - 50), y: rand(80, H - 50), v: Math.random() < 0.14 ? 5 : 1, pulse: Math.random() * 10 });
    if (gems.length > 34) gems.shift();
  }

  function sendState(id) {
    const c = cars[id];
    if (players[id] && c) ac.message(id, { t: 'bumperState', score: c.score, ms: Math.max(0, deadline - performance.now()) });
  }

  function finish() {
    done = true;
    const rank = ids().sort((a, b) => cars[b].score - cars[a].score);
    ids().forEach(id => { if (players[id]) ac.message(id, { t: 'bumperDone', winner: id === rank[0], score: cars[id].score, name: nameOf(rank[0]) }); });
  }

  function step() {
    const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    if (!done && now >= deadline) finish();
    if (done) return;
    if (gems.length < 22) spawnGem();
    ids().forEach(id => {
      const c = cars[id], inp = inputs[id] || { x: 0, y: 0 };
      c.vx += inp.x * 620 * dt; c.vy += inp.y * 620 * dt;
      const sp = Math.hypot(c.vx, c.vy), max = 240;
      if (sp > max) { c.vx = c.vx / sp * max; c.vy = c.vy / sp * max; }
      c.vx *= 0.985; c.vy *= 0.985; c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.x < R) { c.x = R; c.vx *= -0.75; } if (c.x > W - R) { c.x = W - R; c.vx *= -0.75; }
      if (c.y < 70) { c.y = 70; c.vy *= -0.75; } if (c.y > H - R) { c.y = H - R; c.vy *= -0.75; }
    });
    const live = ids();
    for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
      const A = cars[live[a]], B = cars[live[b]], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1;
      if (d < R * 2) {
        const nx = dx / d, ny = dy / d, push = (R * 2 - d) / 2;
        A.x -= nx * push; A.y -= ny * push; B.x += nx * push; B.y += ny * push;
        const av = A.vx * nx + A.vy * ny, bv = B.vx * nx + B.vy * ny, kick = (bv - av) * 0.8;
        A.vx += kick * nx; A.vy += kick * ny; B.vx -= kick * nx; B.vy -= kick * ny;
      }
    }
    for (let gi = gems.length - 1; gi >= 0; gi--) {
      const g = gems[gi];
      for (const id of live) {
        const c = cars[id];
        if (Math.hypot(c.x - g.x, c.y - g.y) < R + GEM_R) {
          c.score += g.v; gems.splice(gi, 1); spawnGem(); sendState(id); break;
        }
      }
    }
  }

  return {
    acceptsJoin: false,
    start(idList) {
      cars = {}; gems = []; inputs = {}; done = false; lastT = performance.now(); deadline = lastT + ROUND_MS;
      idList.forEach((id, i) => {
        const a = -Math.PI / 2 + i * Math.PI * 2 / idList.length;
        cars[id] = { x: W / 2 + Math.cos(a) * 250, y: H / 2 + Math.sin(a) * 160, vx: 0, vy: 0, score: 0 };
        inputs[id] = { x: 0, y: 0 };
        if (players[id]) ac.message(id, { t: 'bumperStart', ms: ROUND_MS });
      });
      for (let i = 0; i < 24; i++) spawnGem();
    },
    stop() { done = true; },
    onDisconnect(id) { delete cars[id]; delete inputs[id]; if (alive().length < 2) endToLobby('Zu wenige Spieler fuer Bumper Gems.'); },
    onMessage(id, d) { if (d && d.t === 'bumperMove' && inputs[id]) inputs[id] = { x: clamp(+d.x || 0, -1, 1), y: clamp(+d.y || 0, -1, 1) }; },
    render() {
      step();
      ctx.fillStyle = '#08111f'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#27405f'; ctx.lineWidth = 2; ctx.strokeRect(12, 62, W - 24, H - 74);
      gems.forEach(g => {
        g.pulse += 0.1; const r = GEM_R + Math.sin(g.pulse) * 1.6;
        ctx.fillStyle = g.v > 1 ? '#ffd60a' : '#64d2ff'; ctx.beginPath(); ctx.moveTo(g.x, g.y - r); ctx.lineTo(g.x + r, g.y); ctx.lineTo(g.x, g.y + r); ctx.lineTo(g.x - r, g.y); ctx.closePath(); ctx.fill();
      });
      ids().forEach(id => {
        const c = cars[id], col = players[id] ? players[id].color : '#888';
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(c.x + c.vx * 0.025, c.y + c.vy * 0.025, 5, 0, Math.PI * 2); ctx.fill();
        ctx.textAlign = 'center'; ctx.font = 'bold 12px system-ui,sans-serif'; ctx.fillText(shortName(id), c.x, c.y - 28);
      });
      const rank = ids().sort((a, b) => cars[b].score - cars[a].score);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = 'bold 28px system-ui,sans-serif'; ctx.fillText('💎 Bumper Gems', 20, 32);
      ctx.font = '15px system-ui,sans-serif'; rank.slice(0, 6).forEach((id, i) => { ctx.fillStyle = players[id] ? players[id].color : '#aaa'; ctx.fillText(shortName(id) + ': ' + cars[id].score, 20 + i * 130, 62); });
      ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = 'bold 24px system-ui,sans-serif'; ctx.fillText(Math.max(0, Math.ceil((deadline - performance.now()) / 1000)) + 's', W - 20, 32);
      if (done) { ctx.textAlign = 'center'; ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 40px system-ui,sans-serif'; ctx.fillText(nameOf(rank[0]) + ' gewinnt!', W / 2, H / 2); }
    }
  };
}});
