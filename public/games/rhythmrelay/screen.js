// ===== Modul: RHYTHM RELAY ===================================
// ============================================================
registerGame({ key: 'rhythmrelay', screen: function () {
  const DIRS = ['up', 'right', 'down', 'left'], ICON = { up: '↑', right: '→', down: '↓', left: '←' };
  const HIT_Y = cv.height - 110, SPAWN_Y = 92, TRAVEL = 2600, ROUND_MS = 60000;
  let order = [], notes = [], scores = {}, combo = {}, nextSpawn = 0, deadline = 0, done = false;
  const randDir = () => DIRS[Math.floor(Math.random() * DIRS.length)];

  function spawn(now) {
    order.forEach(id => notes.push({ id, dir: randDir(), born: now, hit: now + TRAVEL, done: false }));
    nextSpawn = now + Math.max(520, 980 - Math.min(360, (now - (deadline - ROUND_MS)) / 120));
  }

  function finish() {
    done = true;
    const rank = order.slice().sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
    order.forEach(id => { if (players[id]) ac.message(id, { t: 'rhythmDone', winner: id === rank[0], score: scores[id] || 0, name: nameOf(rank[0]) }); });
  }

  function tap(id, dir) {
    if (done) return;
    let best = null, bestAbs = 9999, now = performance.now();
    notes.forEach(n => {
      if (n.id !== id || n.done || n.dir !== dir) return;
      const delta = Math.abs(now - n.hit);
      if (delta < bestAbs) { best = n; bestAbs = delta; }
    });
    if (best && bestAbs <= 260) {
      best.done = true; combo[id] = (combo[id] || 0) + 1;
      const pts = bestAbs < 85 ? 120 : bestAbs < 170 ? 80 : 45;
      scores[id] = (scores[id] || 0) + pts + Math.min(80, combo[id] * 4);
      ac.message(id, { t: 'rhythmScore', score: scores[id], combo: combo[id], hit: bestAbs < 85 ? 'Perfekt' : 'Gut' });
    } else {
      combo[id] = 0; scores[id] = Math.max(0, (scores[id] || 0) - 20);
      ac.message(id, { t: 'rhythmScore', score: scores[id], combo: 0, hit: 'Daneben' });
    }
  }

  return {
    acceptsJoin: false,
    start(ids) {
      order = ids.slice(); notes = []; scores = {}; combo = {}; done = false;
      const now = performance.now(); deadline = now + ROUND_MS; nextSpawn = now;
      order.forEach(id => { scores[id] = 0; combo[id] = 0; if (players[id]) ac.message(id, { t: 'rhythmStart', ms: ROUND_MS }); });
    },
    stop() { done = true; },
    onDisconnect(id) { order = order.filter(o => o !== id); if (!order.length) endToLobby(''); },
    onMessage(id, d) { if (d && d.t === 'rhythmTap') tap(id, d.dir); },
    render() {
      const now = performance.now();
      if (!done && now >= deadline) finish();
      while (!done && now >= nextSpawn) spawn(now);
      notes = notes.filter(n => !n.done && now - n.hit < 420);
      notes.forEach(n => { if (now - n.hit > 290) { n.done = true; combo[n.id] = 0; } });
      ctx.fillStyle = '#100b22'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = 'bold 28px system-ui,sans-serif'; ctx.fillText('🎵 Rhythm Relay', 20, 32);
      ctx.textAlign = 'right'; ctx.font = 'bold 24px system-ui,sans-serif'; ctx.fillText(Math.max(0, Math.ceil((deadline - now) / 1000)) + 's', cv.width - 20, 32);
      const laneW = cv.width / Math.max(1, order.length);
      order.forEach((id, i) => {
        const x = laneW * i, cx = x + laneW / 2;
        ctx.fillStyle = i % 2 ? '#18102f' : '#130d27'; ctx.fillRect(x, 70, laneW, cv.height - 70);
        ctx.strokeStyle = players[id] ? players[id].color : '#888'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 8, HIT_Y); ctx.lineTo(x + laneW - 8, HIT_Y); ctx.stroke();
        ctx.fillStyle = '#ddd'; ctx.textAlign = 'center'; ctx.font = 'bold 14px system-ui,sans-serif'; ctx.fillText(shortName(id), cx, 92);
        ctx.fillText((scores[id] || 0) + ' · x' + (combo[id] || 0), cx, 116);
      });
      notes.forEach(n => {
        const i = order.indexOf(n.id); if (i < 0) return;
        const laneW = cv.width / Math.max(1, order.length), cx = laneW * i + laneW / 2;
        const p = clamp((now - n.born) / TRAVEL, 0, 1), y = SPAWN_Y + (HIT_Y - SPAWN_Y) * p;
        ctx.fillStyle = players[n.id] ? players[n.id].color : '#64d2ff';
        ctx.beginPath(); ctx.arc(cx, y, 25, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 32px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ICON[n.dir], cx, y);
      });
      if (done) { const rank = order.slice().sort((a, b) => (scores[b] || 0) - (scores[a] || 0)); ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 40px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText(nameOf(rank[0]) + ' gewinnt!', cv.width / 2, cv.height / 2); }
    }
  };
}});
