// ===== Modul: LIGHT CYCLES ==================================
  // ============================================================
  registerGame({ key: 'lightcycles', label: '🏍️ Light Cycles', min: 2, screen: function () {
    const CELL = 12, COLS = Math.floor(cv.width / CELL), ROWS = Math.floor(cv.height / CELL);
    let gp = {}, occupied = new Set(), st = 'countdown', bann = '', cd = null, tick = null, starters = 0, wins = {}, running = false;
    const k = (x, y) => x + ',' + y;
    const present = () => Object.keys(gp).map(Number);
    const aliveIds = () => present().filter(id => gp[id].alive);
    const turn = (dir, way) => way === 'left' ? { x: dir.y, y: -dir.x } : { x: -dir.y, y: dir.x };
    function clearT() { if (cd) { clearInterval(cd); cd = null; } if (tick) { clearInterval(tick); tick = null; } }
    function startRound() {
      clearT(); const ids = present();
      if (ids.length < 2) { endToLobby('Light Cycles braucht mind. 2 Spieler.'); return; }
      occupied = new Set();
      ids.forEach((id, i) => {
        const p = gp[id], left = i % 2 === 0;
        p.x = left ? 5 : COLS - 6; p.y = Math.floor(ROWS * (i + 1) / (ids.length + 1));
        p.dir = left ? { x: 1, y: 0 } : { x: -1, y: 0 }; p.nextDir = { x: p.dir.x, y: p.dir.y };
        p.alive = true; p.trail = [[p.x, p.y]]; occupied.add(k(p.x, p.y));
      });
      starters = ids.length; st = 'countdown'; bann = '3'; let n = 3;
      cd = setInterval(() => { n--; bann = n > 0 ? String(n) : 'LOS!'; if (n < 0) { clearInterval(cd); cd = null; st = 'playing'; bann = ''; tick = setInterval(step, 85); } }, 700);
    }
    function step() {
      const alive = aliveIds(), intended = {};
      alive.forEach(id => { const p = gp[id]; p.dir = p.nextDir; intended[id] = [p.x + p.dir.x, p.y + p.dir.y]; });
      const tc = {}; alive.forEach(id => { const key = k(intended[id][0], intended[id][1]); tc[key] = (tc[key] || 0) + 1; });
      const dead = new Set();
      alive.forEach(id => { const [nx, ny] = intended[id], key = k(nx, ny); if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || occupied.has(key) || tc[key] > 1) dead.add(id); });
      alive.forEach(id => { if (dead.has(id)) gp[id].alive = false; else { const [nx, ny] = intended[id], p = gp[id]; p.x = nx; p.y = ny; occupied.add(k(nx, ny)); p.trail.push([nx, ny]); } });
      const surv = aliveIds();
      if (starters >= 2 && surv.length <= 1) return over(surv[0]);
      if (surv.length === 0) return over(undefined);
    }
    function over(winId) {
      clearT(); st = 'over';
      if (winId !== undefined) { wins[winId] = (wins[winId] || 0) + 1; bann = nameOf(winId) + ' gewinnt! 🏆'; } else bann = 'Unentschieden!';
      setTimeout(() => { if (running) { if (present().length >= 2) startRound(); else endToLobby('Light Cycles braucht mind. 2 Spieler.'); } }, 3000);
    }
    return {
      acceptsJoin: true,
      start(ids) { running = true; gp = {}; wins = {}; ids.forEach(id => gp[id] = { alive: false }); startRound(); },
      stop() { running = false; clearT(); },
      onConnect(id) { gp[id] = { alive: false }; },
      onDisconnect(id) { delete gp[id]; },
      onMessage(id, d) { if (d && d.turn && st === 'playing' && gp[id] && gp[id].alive) gp[id].nextDir = turn(gp[id].dir, d.turn); },
      render() {
        ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
        for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, cv.height); ctx.stroke(); }
        for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(cv.width, y * CELL); ctx.stroke(); }
        present().forEach(id => {
          const p = gp[id]; if (!p.trail) return;
          const col = players[id] ? players[id].color : '#888';
          ctx.fillStyle = col; p.trail.forEach(([cx, cy]) => ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL));
          if (p.alive) { ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.fillRect(p.x * CELL, p.y * CELL, CELL, CELL); ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.fillRect(p.x * CELL + 3, p.y * CELL + 3, CELL - 6, CELL - 6); }
        });
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = 'bold 14px system-ui,sans-serif';
        present().sort((a, b) => (wins[b] || 0) - (wins[a] || 0)).forEach((id, i) => { ctx.fillStyle = players[id] ? players[id].color : '#888'; ctx.fillText(shortName(id) + ': ' + (wins[id] || 0), 10, 10 + i * 18); });
        if (bann) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, cv.height / 2 - 36, cv.width, 72); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 38px system-ui,sans-serif'; ctx.fillText(bann, cv.width / 2, cv.height / 2); }
      }
    };
  }});

  // ============================================================
