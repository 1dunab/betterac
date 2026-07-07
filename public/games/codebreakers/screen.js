// ===== Modul: CODE BREAKERS ==================================
// ============================================================
registerGame({ key: 'codebreakers', screen: function () {
  const COLORS = [
    { k: 'red', label: 'Rot', c: '#ff2d55' },
    { k: 'blue', label: 'Blau', c: '#0a84ff' },
    { k: 'green', label: 'Grün', c: '#30d158' },
    { k: 'yellow', label: 'Gelb', c: '#ffd60a' }
  ];
  const ROUND_MS = 70000, SHOW_MS = 2400;
  let order = [], scores = {}, seq = {}, pos = {}, seqLen = {}, showUntil = {}, deadline = 0, done = false;
  const pick = () => COLORS[Math.floor(Math.random() * COLORS.length)].k;
  const colorFor = k => (COLORS.find(c => c.k === k) || COLORS[0]).c;
  function makeSeq(id) {
    seq[id] = Array.from({ length: seqLen[id] || 3 }, pick);
    pos[id] = 0;
    showUntil[id] = performance.now() + SHOW_MS;
    if (players[id]) ac.message(id, { t: 'codeRound', len: seq[id].length, showMs: SHOW_MS });
  }
  function finish() {
    done = true;
    const rank = order.slice().sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
    order.forEach(id => { if (players[id]) ac.message(id, { t: 'codeDone', winner: id === rank[0], score: scores[id] || 0, name: nameOf(rank[0]) }); });
  }
  function press(id, key) {
    if (done || performance.now() < (showUntil[id] || 0) || !seq[id]) return;
    if (seq[id][pos[id]] === key) {
      pos[id]++;
      if (pos[id] >= seq[id].length) {
        scores[id] = (scores[id] || 0) + seq[id].length * 100;
        seqLen[id] = Math.min(8, (seqLen[id] || seq[id].length) + 1);
        makeSeq(id);
      } else scores[id] = (scores[id] || 0) + 18;
      ac.message(id, { t: 'codeScore', ok: true, score: scores[id], progress: pos[id], len: seq[id].length });
    } else {
      scores[id] = Math.max(0, (scores[id] || 0) - 40); pos[id] = 0;
      ac.message(id, { t: 'codeScore', ok: false, score: scores[id], progress: 0, len: seq[id].length });
    }
  }
  return {
    acceptsJoin: false,
    start(ids) {
      order = ids.slice(); scores = {}; seq = {}; pos = {}; seqLen = {}; showUntil = {}; done = false; deadline = performance.now() + ROUND_MS;
      order.forEach(id => {
        scores[id] = 0; seqLen[id] = 3;
        if (players[id]) ac.message(id, { t: 'codeStart', ms: ROUND_MS });
        makeSeq(id);
      });
    },
    stop() { done = true; },
    onDisconnect(id) { order = order.filter(o => o !== id); if (!order.length) endToLobby(''); },
    onMessage(id, d) { if (d && d.t === 'codePress') press(id, d.key); },
    render() {
      const now = performance.now(); if (!done && now >= deadline) finish();
      ctx.fillStyle = '#101319'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = 'bold 28px system-ui,sans-serif'; ctx.fillText('🔐 Code Breakers', 20, 34);
      ctx.textAlign = 'right'; ctx.font = 'bold 24px system-ui,sans-serif'; ctx.fillText(Math.max(0, Math.ceil((deadline - now) / 1000)) + 's', cv.width - 20, 34);
      const laneH = (cv.height - 96) / Math.max(1, order.length);
      order.forEach((id, i) => {
        const y = 92 + i * laneH, cx = cv.width / 2;
        const show = now < (showUntil[id] || 0);
        ctx.fillStyle = players[id] ? players[id].color : '#888'; ctx.textAlign = 'left'; ctx.font = 'bold 18px system-ui,sans-serif'; ctx.fillText(shortName(id) + ' · ' + (scores[id] || 0), 24, y + 26);
        const s = seq[id] || [], gap = 14, r = Math.min(24, (cv.width - 260) / Math.max(1, s.length * 2));
        let x = cx - (s.length * r * 2 + (s.length - 1) * gap) / 2 + r;
        s.forEach((k, idx) => {
          ctx.globalAlpha = show || idx < pos[id] ? 1 : 0.18;
          ctx.fillStyle = colorFor(k); ctx.beginPath(); ctx.arc(x, y + laneH / 2, r, 0, Math.PI * 2); ctx.fill();
          if (idx < pos[id]) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); }
          x += r * 2 + gap;
        });
        ctx.globalAlpha = 1;
      });
      const anyShow = order.some(id => now < (showUntil[id] || 0));
      ctx.textAlign = 'center'; ctx.fillStyle = anyShow ? '#ffd60a' : '#30d158'; ctx.font = 'bold 22px system-ui,sans-serif'; ctx.fillText(anyShow ? 'MERKEN!' : 'EINGEBEN!', cv.width / 2, 64);
      if (done) { const rank = order.slice().sort((a, b) => (scores[b] || 0) - (scores[a] || 0)); ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 40px system-ui,sans-serif'; ctx.fillText(nameOf(rank[0]) + ' knackt den Code!', cv.width / 2, cv.height / 2); }
    }
  };
}});
