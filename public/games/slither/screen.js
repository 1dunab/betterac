// ===== Modul: SLITHER =======================================
  // ============================================================
  registerGame({ key: 'slither', screen: function () {
    const WORLD = { cx: 480, cy: 300, r: 285 }, dt = 1 / 30, SPEED = 135, BOOST = 235, TURN = 3.6;
    const START = 16, MAXP = 480, FOOD_TARGET = 130, MINB = 12, BCOST = 6;
    let sw = {}, food = [], sim = null, running = false;
    const ids = () => Object.keys(sw).map(Number);
    const d2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
    const thick = (w) => 11 + Math.min(w.mass, 300) * 0.06;
    const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); return 'rgb(' + Math.round(((n >> 16) & 255) * f) + ',' + Math.round(((n >> 8) & 255) * f) + ',' + Math.round((n & 255) * f) + ')'; };
    function spawnFood(x, y, v, big) { food.push({ x, y, v: v || 1, r: big ? 5 : 3, c: 'hsl(' + Math.floor(Math.random() * 360) + ',90%,65%)' }); }
    function topUp() { while (food.length < FOOD_TARGET) { const a = Math.random() * Math.PI * 2, rr2 = Math.random() * WORLD.r * 0.97; spawnFood(WORLD.cx + Math.cos(a) * rr2, WORLD.cy + Math.sin(a) * rr2, 1, false); } if (food.length > 600) food.splice(0, food.length - 600); }
    function spawn(id) {
      const w = sw[id], a = Math.random() * Math.PI * 2, rr2 = Math.random() * WORLD.r * 0.6;
      const sx = WORLD.cx + Math.cos(a) * rr2, sy = WORLD.cy + Math.sin(a) * rr2;
      w.angle = Math.random() * Math.PI * 2; w.x = sx; w.y = sy; w.pts = [];
      for (let i = 0; i < START; i++) w.pts.push({ x: sx - Math.cos(w.angle) * i * SPEED * dt, y: sy - Math.sin(w.angle) * i * SPEED * dt });
      w.mass = 10; w.steer = 0; w.boost = false; w.alive = true; w.dead = false;
    }
    function ensure(id) { if (!sw[id]) sw[id] = { mass: 10, steer: 0, boost: false, alive: false, dead: false, pts: [] }; }
    function kill(id) { const w = sw[id]; if (!w || w.dead) return; w.dead = true; w.alive = false; for (let i = 0; i < w.pts.length; i += 3) spawnFood(w.pts[i].x, w.pts[i].y, 2 + Math.random() * 2, true); w.pts = []; w.respawnAt = performance.now() + 1800; }
    function simulate() {
      const now = performance.now();
      for (const id of ids()) {
        const w = sw[id];
        if (w.dead) { if (now >= w.respawnAt) spawn(id); continue; }
        if (!w.alive) continue;
        w.angle += w.steer * TURN * dt;
        const boosting = w.boost && w.mass > MINB, sp = boosting ? BOOST : SPEED;
        w.x += Math.cos(w.angle) * sp * dt; w.y += Math.sin(w.angle) * sp * dt; w.pts.unshift({ x: w.x, y: w.y });
        if (boosting) { w.mass = Math.max(MINB, w.mass - BCOST * dt); w._d = (w._d || 0) + 1; if (w._d >= 5) { w._d = 0; const t = w.pts[w.pts.length - 1]; if (t) spawnFood(t.x, t.y, 1, true); } }
        const rEat = thick(w) / 2 + 6;
        for (let i = food.length - 1; i >= 0; i--) { const lim = rEat + food[i].r; if (d2(w.pts[0], food[i]) < lim * lim) { w.mass += food[i].v; food.splice(i, 1); } }
        const target = Math.max(START, Math.min(MAXP, START + Math.floor(w.mass * 1.1)));
        while (w.pts.length > target) w.pts.pop();
      }
      const live = ids().filter(id => sw[id].alive && !sw[id].dead), kills = new Set();
      for (const id of live) { const w = sw[id], lim = WORLD.r - thick(w) / 2; if (d2(w.pts[0], { x: WORLD.cx, y: WORLD.cy }) > lim * lim) kills.add(id); }
      for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) { const A = sw[live[a]], B = sw[live[b]], rr2 = thick(A) / 2 + thick(B) / 2; if (d2(A.pts[0], B.pts[0]) < rr2 * rr2) { kills.add(live[a]); kills.add(live[b]); } }
      for (const idA of live) { const A = sw[idA], hr = thick(A) / 2; for (const idB of live) { if (idA === idB) continue; const B = sw[idB], lim = hr + thick(B) / 2, l2 = lim * lim; for (let i = 6; i < B.pts.length; i += 2) { if (d2(A.pts[0], B.pts[i]) < l2) { kills.add(idA); break; } } } }
      kills.forEach(kill); topUp();
      if (ids().length === 0) endToLobby('');
    }
    function strokePath(pts) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); }
    return {
      acceptsJoin: true,
      start(idList) { running = true; sw = {}; food = []; idList.forEach(id => { ensure(id); spawn(id); }); topUp(); sim = setInterval(simulate, 33); },
      stop() { running = false; if (sim) { clearInterval(sim); sim = null; } },
      onConnect(id) { ensure(id); spawn(id); },
      onDisconnect(id) { const w = sw[id]; if (w && w.pts) for (let i = 0; i < w.pts.length; i += 3) spawnFood(w.pts[i].x, w.pts[i].y, 2, true); delete sw[id]; },
      onMessage(id, d) { const w = sw[id]; if (!w || !d) return; if (typeof d.steer === 'number') w.steer = Math.max(-1, Math.min(1, d.steer)); if (typeof d.boost === 'boolean') w.boost = d.boost; },
      render() {
        ctx.fillStyle = '#05050a'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.beginPath(); ctx.arc(WORLD.cx, WORLD.cy, WORLD.r, 0, Math.PI * 2); ctx.fillStyle = '#0b0b16'; ctx.fill();
        ctx.save(); ctx.strokeStyle = 'rgba(90,140,255,0.55)'; ctx.lineWidth = 4; ctx.shadowColor = 'rgba(90,140,255,0.8)'; ctx.shadowBlur = 20; ctx.beginPath(); ctx.arc(WORLD.cx, WORLD.cy, WORLD.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        for (const f of food) { ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill(); }
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const id of ids()) {
          const w = sw[id]; if (!w.alive || !w.pts || w.pts.length < 2) continue;
          const col = players[id] ? players[id].color : '#888', TH = thick(w);
          ctx.strokeStyle = shade(col, 0.55); ctx.lineWidth = TH + 4; strokePath(w.pts);
          ctx.strokeStyle = col; ctx.lineWidth = TH; strokePath(w.pts);
          const hh = w.pts[0], ex = Math.cos(w.angle), ey = Math.sin(w.angle), px = -ey, py = ex;
          ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(hh.x, hh.y, TH * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
          for (const s of [1, -1]) { const cxx = hh.x + ex * TH * 0.25 + px * s * TH * 0.3, cyy = hh.y + ey * TH * 0.25 + py * s * TH * 0.3; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cxx, cyy, TH * 0.28, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(cxx + ex * TH * 0.12, cyy + ey * TH * 0.12, TH * 0.14, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = 'bold 14px system-ui,sans-serif';
        ids().filter(id => sw[id].alive).sort((a, b) => sw[b].mass - sw[a].mass).slice(0, 6).forEach((id, i) => { ctx.fillStyle = players[id] ? players[id].color : '#888'; ctx.fillText(shortName(id) + ': ' + Math.floor(sw[id].mass), 12, 12 + i * 18); });
      }
    };
  }});

  // ============================================================
