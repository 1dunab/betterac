// ===== Modul: STADT LAND FLUSS ==============================
  // Buchstabe auf dem Screen, Antworten am Handy. Einzigartige
  // gültige Antwort 10 Punkte, doppelte 5, ungültige/leere 0.
  // ============================================================
  registerGame({ key: 'categories', screen: function () {
    const DEFAULT_CATS = ['Stadt', 'Land', 'Fluss', 'Tier', 'Beruf'];
    const LETTERS = 'ABCDEFGHIJKLMNOPRSTUVWZ'.split(''); // ohne Q/X/Y

    let ids = [], totals = {}, roundNo = 0, cfg = { rounds: 3, roundTime: 60 };
    let CATS = DEFAULT_CATS;
    let phase = 'write'; // write | score | final
    let letter = '', unused = [], answers = new Map(), submitted = new Set();
    let deadline = 0, tickInt = null, table = null, roundGained = {};

    const pick = (a) => a[Math.floor(Math.random() * a.length)];

    function sendPhase() {
      const h = hostId();
      ids.forEach(id => ac.message(id, { t: 'slfPhase', phase, host: id === h }));
    }
    function nextRound() {
      roundNo++; phase = 'write'; answers = new Map(); submitted = new Set(); table = null;
      if (!unused.length) unused = LETTERS.slice();
      letter = pick(unused); unused = unused.filter(l => l !== letter);
      deadline = performance.now() + cfg.roundTime * 1000;
      clearInterval(tickInt);
      tickInt = setInterval(() => { if (phase === 'write' && performance.now() >= deadline) finishRound(); }, 200);
      ids.forEach(id => ac.message(id, { t: 'slfRound', letter, cats: CATS, ms: cfg.roundTime * 1000, round: roundNo, of: cfg.rounds }));
    }
    function cleanAnswers(a) {
      const out = {};
      CATS.forEach(cat => { out[cat] = String((a || {})[cat] || '').trim().slice(0, 24); });
      return out;
    }
    function finishRound() {
      clearInterval(tickInt); tickInt = null;
      phase = 'score'; roundGained = {}; table = {};
      ids.forEach(id => { roundGained[id] = 0; });
      CATS.forEach(cat => {
        const rows = ids.map(id => {
          const text = (answers.get(id) || {})[cat] || '';
          const norm = text.toLowerCase();
          const valid = !!norm && norm.startsWith(letter.toLowerCase());
          return { id, text, norm, valid };
        });
        rows.forEach(r => {
          if (!r.valid) { r.points = 0; return; }
          const same = rows.filter(o => o.valid && o.norm === r.norm).length;
          r.points = same > 1 ? 5 : 10;
          roundGained[r.id] += r.points;
        });
        table[cat] = rows;
      });
      ids.forEach(id => {
        totals[id] = (totals[id] || 0) + roundGained[id];
        ac.message(id, { t: 'slfResult', gained: roundGained[id], total: totals[id] });
      });
      sendPhase();
    }

    return {
      start(playerIds, settings) {
        ids = playerIds.slice().sort((a, b) => a - b);
        cfg = { rounds: (settings && settings.rounds) || 3, roundTime: (settings && settings.roundTime) || 60 };
        // Eigene Kategorien aus dem Lobby-Setting (Komma-getrennt), sonst Standard
        const custom = String((settings && settings.cats) || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
        CATS = custom.length >= 2 ? custom : DEFAULT_CATS;
        totals = {}; roundNo = 0; unused = LETTERS.slice();
        nextRound();
      },
      stop() { clearInterval(tickInt); },
      onDisconnect(id) {
        const wasIn = ids.includes(id);
        ids = ids.filter(p => p !== id);
        submitted.delete(id); answers.delete(id); // fehlende Abgabe = leer
        if (!wasIn) return;
        if (ids.length < 2) { endToLobby('Stadt Land Fluss braucht mind. 2 Spieler.'); return; }
        if (phase === 'write' && ids.every(p => submitted.has(p))) finishRound();
        else if (phase !== 'write') sendPhase(); // Host könnte gewechselt haben
      },
      onMessage(id, d) {
        if (!d || !ids.includes(id)) return;
        if (d.t === 'slfAnswers' && phase === 'write' && !submitted.has(id)) {
          answers.set(id, cleanAnswers(d.a));
          submitted.add(id);
          if (ids.every(p => submitted.has(p))) finishRound();
        } else if (d.t === 'slfNext' && id === hostId()) {
          if (phase === 'score') {
            if (roundNo >= cfg.rounds) { phase = 'final'; sendPhase(); }
            else nextRound();
          } else if (phase === 'final') {
            totals = {}; roundNo = 0; unused = LETTERS.slice();
            nextRound();
          }
        }
      },
      render() {
        ctx.fillStyle = '#0d0d1a'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff'; ctx.font = 'bold 30px system-ui,sans-serif';
        ctx.fillText('🏙️ Stadt Land Fluss — Runde ' + roundNo + ' / ' + cfg.rounds, cv.width / 2, 40);

        if (phase === 'write') {
          ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 160px system-ui,sans-serif';
          ctx.fillText(letter, cv.width / 2, 200);
          ctx.fillStyle = '#bf5af2'; ctx.font = 'bold 24px system-ui,sans-serif';
          ctx.fillText(CATS.join('  ·  '), cv.width / 2, 320);
          const sLeft = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
          ctx.fillStyle = sLeft <= 10 ? '#ff453a' : '#fff'; ctx.font = 'bold 48px system-ui,sans-serif';
          ctx.fillText('⏱ ' + sLeft + 's', cv.width / 2, 410);
          ctx.fillStyle = '#888'; ctx.font = '18px system-ui,sans-serif';
          ctx.fillText('✍️ Tippt eure Antworten am Handy — ' + submitted.size + ' / ' + ids.length + ' fertig', cv.width / 2, cv.height - 50);
        }

        if (phase === 'score' && table) {
          const x0 = 150, colW = Math.min(180, (cv.width - x0 - 20) / ids.length);
          // Kopfzeile: Spielernamen
          ids.forEach((id, i) => {
            const x = x0 + i * colW + colW / 2;
            ctx.fillStyle = players[id] ? players[id].color : '#888';
            ctx.beginPath(); ctx.arc(x - 0, 84, 8, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#eee'; fitFont(ctx, shortName(id), colW - 14, 17);
            ctx.fillText(shortName(id), x, 110);
          });
          // Zeilen: Kategorien
          CATS.forEach((cat, r) => {
            const y = 160 + r * 56;
            ctx.textAlign = 'right'; ctx.fillStyle = '#bf5af2'; ctx.font = 'bold 19px system-ui,sans-serif';
            ctx.fillText(cat, x0 - 16, y);
            ctx.textAlign = 'center';
            table[cat].forEach((cell, i) => {
              const x = x0 + i * colW + colW / 2;
              const label = cell.text || '—';
              ctx.fillStyle = cell.points === 0 ? '#666' : '#fff';
              fitFont(ctx, label, colW - 18, 17);
              ctx.fillText(label, x, y - 9);
              ctx.fillStyle = cell.points === 10 ? '#30d158' : cell.points === 5 ? '#ff9f0a' : '#666';
              ctx.font = 'bold 13px system-ui,sans-serif';
              ctx.fillText(cell.points > 0 ? '+' + cell.points : (cell.text ? 'ungültig' : ''), x, y + 13);
            });
          });
          // Punkte
          ids.forEach((id, i) => {
            const x = x0 + i * colW + colW / 2, y = 160 + CATS.length * 56 + 6;
            ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 18px system-ui,sans-serif';
            ctx.fillText('+' + (roundGained[id] || 0), x, y);
            ctx.fillStyle = '#aaa'; ctx.font = '15px system-ui,sans-serif';
            ctx.fillText('Σ ' + (totals[id] || 0), x, y + 24);
          });
          ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 26px system-ui,sans-serif';
          ctx.fillText('Buchstabe: ' + letter, cv.width / 2, cv.height - 76);
          ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '15px system-ui,sans-serif';
          ctx.fillText('⭐ Host tippt am Handy auf Weiter', cv.width / 2, cv.height - 28);
        }

        if (phase === 'final') {
          const board = ids.slice().sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
          ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 44px system-ui,sans-serif';
          ctx.fillText('🏆 ' + nameOf(board[0]) + ' gewinnt!', cv.width / 2, 130);
          ctx.font = 'bold 24px system-ui,sans-serif';
          board.forEach((id, i) => {
            const y = 210 + i * 46;
            ctx.fillStyle = players[id] ? players[id].color : '#888';
            ctx.beginPath(); ctx.arc(cv.width / 2 - 160, y, 12, 0, Math.PI * 2); ctx.fill();
            ctx.textAlign = 'left'; ctx.fillStyle = '#eee';
            ctx.fillText((i + 1) + '. ' + shortName(id), cv.width / 2 - 135, y);
            ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
            ctx.fillText((totals[id] || 0) + ' Punkte', cv.width / 2 + 170, y);
            ctx.textAlign = 'center';
          });
          ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '15px system-ui,sans-serif';
          ctx.fillText('⭐ Host kann am Handy eine neue Partie starten', cv.width / 2, cv.height - 28);
        }
      }
    };
  }});
