// ===== Modul: REAKTIONSDUELL ================================
  // Warten, bis der Bildschirm GRÜN wird — schnellster Tap gewinnt
  // die Runde. Frühstarter sind für die Runde raus. Best of N,
  // bei Gleichstand Sudden Death zwischen den Führenden.
  // ============================================================
  registerGame({ key: 'reaction', screen: function () {
    let ids = [], participants = [], wins = {}, totalRounds = 5, roundNo = 0;
    let phase = 'armed'; // armed | go | result | final
    let goAt = 0, taps = new Map(), failed = new Set(), lastRound = null;
    let timers = [];

    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
    const sendState = () => participants.forEach(id => ac.message(id, { t: 'rxState', phase }));

    function nextRound(sudden) {
      clearTimers();
      roundNo++; phase = 'armed'; taps = new Map(); failed = new Set(); lastRound = null;
      if (sudden) setBanner('⚔️ Sudden Death: ' + participants.map(nameOf).join(' vs. '), 3000);
      sendState();
      later(() => {
        if (phase !== 'armed') return;
        phase = 'go'; goAt = performance.now(); sendState();
        later(() => { if (phase === 'go') endRound(); }, 5000); // niemand tippt → Runde verfällt
      }, 1500 + Math.random() * 3500);
    }
    function endRound() {
      clearTimers();
      phase = 'result';
      let winner = null, best = Infinity;
      taps.forEach((ms, id) => { if (ms < best) { best = ms; winner = id; } });
      if (winner !== null) wins[winner] = (wins[winner] || 0) + 1;
      lastRound = { winner, times: participants.map(id => ({ id, ms: taps.has(id) ? Math.round(taps.get(id)) : null, early: failed.has(id) })) };
      participants.forEach(id => {
        const res = failed.has(id) ? 'early' : !taps.has(id) ? 'none' : id === winner ? 'win' : 'ok';
        ac.message(id, { t: 'rxYou', res, ms: taps.has(id) ? Math.round(taps.get(id)) : null });
      });
      later(advance, 2600);
    }
    function advance() {
      if (roundNo < totalRounds) { nextRound(false); return; }
      let top = 0; ids.forEach(id => { top = Math.max(top, wins[id] || 0); });
      const leaders = ids.filter(id => (wins[id] || 0) === top);
      if (leaders.length > 1) { participants = leaders; nextRound(true); return; }
      phase = 'final';
      const h = hostId();
      ids.forEach(id => ac.message(id, { t: 'rxPhase', phase: 'final', host: id === h }));
    }

    return {
      start(playerIds, cfg) {
        ids = playerIds.slice().sort((a, b) => a - b);
        participants = ids.slice();
        totalRounds = (cfg && cfg.rounds) || 5;
        wins = {}; roundNo = 0;
        nextRound(false);
      },
      stop() { clearTimers(); },
      onDisconnect(id) {
        const wasIn = ids.includes(id);
        ids = ids.filter(p => p !== id);
        participants = participants.filter(p => p !== id);
        taps.delete(id); failed.delete(id); delete wins[id];
        if (!wasIn) return;
        if (ids.length < 2) { endToLobby('Reaktionsduell braucht mind. 2 Spieler.'); return; }
        if (participants.length === 0) participants = ids.slice();
        if (phase === 'go' && participants.every(p => taps.has(p) || failed.has(p))) endRound();
        else if (phase === 'final') {
          // Host könnte gegangen sein — Nochmal-Button an den neuen Host geben
          const h = hostId();
          ids.forEach(p => ac.message(p, { t: 'rxPhase', phase: 'final', host: p === h }));
        }
      },
      onMessage(id, d) {
        if (!d || !ids.includes(id)) return;
        if (d.t === 'rxAgain' && id === hostId() && phase === 'final') {
          participants = ids.slice(); wins = {}; roundNo = 0;
          nextRound(false);
          return;
        }
        if (d.t !== 'rxTap' || !participants.includes(id)) return;
        if (phase === 'armed') {
          if (!failed.has(id)) { failed.add(id); ac.message(id, { t: 'rxYou', res: 'early', ms: null }); }
        } else if (phase === 'go') {
          if (failed.has(id) || taps.has(id)) return;
          taps.set(id, performance.now() - goAt);
          if (taps.size === 1) later(() => { if (phase === 'go') endRound(); }, 1200); // Sammelfenster nach erstem Tap
          if (participants.every(p => taps.has(p) || failed.has(p))) endRound();
        }
        // result/final: Taps ignorieren
      },
      render() {
        const bg = phase === 'go' ? '#0c3d1e' : phase === 'armed' ? '#3d0c14' : '#0d0d1a';
        ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff'; ctx.font = 'bold 28px system-ui,sans-serif';
        ctx.fillText('⚡ Reaktionsduell — Runde ' + roundNo + ' / ' + totalRounds, cv.width / 2, 40);

        if (phase === 'armed') {
          ctx.fillStyle = '#ff453a'; ctx.font = 'bold 64px system-ui,sans-serif';
          ctx.fillText('Warte auf GRÜN…', cv.width / 2, cv.height / 2 - 20);
          ctx.fillStyle = '#ffb3ad'; ctx.font = '20px system-ui,sans-serif';
          ctx.fillText('Finger bereit — wer zu früh tippt, ist raus! 🔴', cv.width / 2, cv.height / 2 + 50);
        }
        if (phase === 'go') {
          ctx.fillStyle = '#30d158'; ctx.font = 'bold 96px system-ui,sans-serif';
          ctx.fillText('JETZT! ⚡', cv.width / 2, cv.height / 2);
        }
        if (phase === 'result' && lastRound) {
          ctx.fillStyle = lastRound.winner !== null ? '#30d158' : '#ff9f0a'; ctx.font = 'bold 36px system-ui,sans-serif';
          ctx.fillText(lastRound.winner !== null ? '🏅 ' + nameOf(lastRound.winner) + ' gewinnt die Runde!' : 'Keiner hat getroffen… 😴', cv.width / 2, 110);
          ctx.font = 'bold 22px system-ui,sans-serif';
          const sorted = lastRound.times.slice().sort((a, b) => (a.ms === null ? 1e9 : a.ms) - (b.ms === null ? 1e9 : b.ms));
          sorted.forEach((e, i) => {
            const y = 170 + i * 42;
            ctx.fillStyle = players[e.id] ? players[e.id].color : '#888';
            ctx.beginPath(); ctx.arc(cv.width / 2 - 190, y, 11, 0, Math.PI * 2); ctx.fill();
            ctx.textAlign = 'left'; ctx.fillStyle = '#eee';
            ctx.fillText(shortName(e.id), cv.width / 2 - 165, y);
            ctx.textAlign = 'right'; ctx.fillStyle = e.early ? '#ff453a' : e.ms === null ? '#888' : '#fff';
            ctx.fillText(e.early ? '❌ zu früh' : e.ms === null ? '—' : e.ms + ' ms', cv.width / 2 + 190, y);
            ctx.textAlign = 'center';
          });
          ctx.fillStyle = '#888'; ctx.font = '17px system-ui,sans-serif';
          ctx.fillText('Zwischenstand: ' + ids.map(id => shortName(id) + ' ' + (wins[id] || 0)).join('  ·  '), cv.width / 2, cv.height - 40);
        }
        if (phase === 'final') {
          ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 44px system-ui,sans-serif';
          const top = Math.max(...ids.map(id => wins[id] || 0));
          const champ = ids.find(id => (wins[id] || 0) === top);
          ctx.fillText('🏆 ' + nameOf(champ) + ' gewinnt!', cv.width / 2, 130);
          ctx.font = 'bold 24px system-ui,sans-serif';
          const board = ids.slice().sort((a, b) => (wins[b] || 0) - (wins[a] || 0));
          board.forEach((id, i) => {
            const y = 210 + i * 46;
            ctx.fillStyle = players[id] ? players[id].color : '#888';
            ctx.beginPath(); ctx.arc(cv.width / 2 - 160, y, 12, 0, Math.PI * 2); ctx.fill();
            ctx.textAlign = 'left'; ctx.fillStyle = '#eee';
            ctx.fillText((i + 1) + '. ' + shortName(id), cv.width / 2 - 135, y);
            ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
            ctx.fillText((wins[id] || 0) + ' Siege', cv.width / 2 + 170, y);
            ctx.textAlign = 'center';
          });
          ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '15px system-ui,sans-serif';
          ctx.fillText('⭐ Host kann am Handy eine Revanche starten', cv.width / 2, cv.height - 28);
        }
      }
    };
  }});
