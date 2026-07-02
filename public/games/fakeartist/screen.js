// ===== Modul: FAKE ARTIST ===================================
  // Alle zeichnen reihum je einen Strich zum geheimen Wort —
  // aber einer kennt es nicht. Danach wird abgestimmt.
  // ============================================================
  registerGame({ key: 'fakeartist', screen: function () {
    const WORDS = {
      'Tiere': ['Elefant','Pinguin','Krokodil','Schnecke','Delfin','Adler','Oktopus','Giraffe','Biene','Igel','Flamingo','Hai','Katze','Dinosaurier'],
      'Gegenstände': ['Regenschirm','Zahnbürste','Leiter','Kompass','Taschenlampe','Zelt','Gitarre','Brille','Rakete','Schlüssel','Fahrrad','Ampel'],
      'Essen & Trinken': ['Pizza','Sushi','Brezel','Eis','Popcorn','Banane','Spiegelei','Burger','Donut','Wassermelone'],
      'Orte': ['Strand','Leuchtturm','Burg','Zirkus','Vulkan','Windmühle','Baustelle','Achterbahn','Iglu','Pyramide'],
      'Fantasie': ['Drache','Zombie','Zauberer','Pirat','Vampir','Alien','Meerjungfrau','Ritter','Geist','Einhorn']
    };
    const BOARD = { x: 40, y: 96, w: 590, h: 440 };

    let ids = [], fake = null, word = '', category = '', turnsPer = 2;
    let phase = 'reveal', confirmed = new Set(), votes = new Map(), round = 0, lastWord = '';
    let queue = [], turnIdx = 0, allStrokes = [], result = null;

    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const currentId = () => (phase === 'draw' && turnIdx < queue.length) ? queue[turnIdx] : null;

    function newRound() {
      round++; phase = 'reveal'; confirmed = new Set(); votes = new Map();
      allStrokes = []; turnIdx = 0; result = null;
      category = pick(Object.keys(WORDS));
      do { word = pick(WORDS[category]); } while (word === lastWord && WORDS[category].length > 1);
      lastWord = word;
      fake = pick(ids);
      const order = shuffle(ids.slice());
      queue = [];
      for (let t = 0; t < turnsPer; t++) order.forEach(p => queue.push(p));
      const h = hostId();
      ids.forEach(id => ac.message(id, {
        t: 'faRole', fake: id === fake, word: id === fake ? '' : word, hint: category,
        round, host: id === h
      }));
    }
    function sendTurn() {
      const cur = currentId();
      if (cur === null) { startVote(); return; }
      const turnNo = allStrokes.filter(e => e.by === cur).length + 1;
      ids.forEach(id => {
        if (id === cur) ac.message(id, { t: 'faTurn', color: players[id] ? players[id].color : '#fff', strokes: allStrokes.map(e => e.s), turn: turnNo, of: turnsPer });
        else ac.message(id, { t: 'faWait', current: nameOf(cur) });
      });
    }
    function startVote() {
      phase = 'vote'; votes = new Map();
      const options = ids.map(id => ({ id, name: nameOf(id) }));
      ids.forEach(id => ac.message(id, { t: 'faVote', options }));
    }
    function resolve(reason) {
      phase = 'result';
      const count = new Map();
      for (const target of votes.values()) count.set(target, (count.get(target) || 0) + 1);
      let top = 0; count.forEach(n => { if (n > top) top = n; });
      const leaders = ids.filter(id => (count.get(id) || 0) === top && top > 0);
      result = { caught: leaders.length === 1 && leaders[0] === fake, count, reason: reason || '' };
      const h = hostId();
      ids.forEach(id => ac.message(id, { t: 'faPhase', phase: 'result', host: id === h }));
    }
    function validStroke(s) {
      if (!s || !Array.isArray(s.p) || !s.p.length || s.p.length > 2000) return null;
      const w = Math.max(0.002, Math.min(0.08, +s.w || 0.012));
      const c = /^#[0-9a-fA-F]{6}$/.test(s.c) ? s.c : '#111111';
      const p = s.p.map(pt => [Math.max(0, Math.min(1, +pt[0] || 0)), Math.max(0, Math.min(1, +pt[1] || 0))]);
      return { c, w, p };
    }

    return {
      start(playerIds, cfg) {
        ids = playerIds.slice().sort((a, b) => a - b);
        turnsPer = (cfg && cfg.turns) || 2;
        round = 0;
        newRound();
      },
      stop() {},
      onDisconnect(id) {
        const wasIn = ids.includes(id);
        const wasCurrent = currentId() === id;
        ids = ids.filter(p => p !== id);
        if (!wasIn) return;
        if (ids.length < 3) { endToLobby('Fake Artist braucht mind. 3 Spieler.'); return; }
        confirmed.delete(id); votes.delete(id);
        if (id === fake && phase !== 'result') { resolve('Der Fake Artist hat das Spiel verlassen! 😱'); return; }
        queue = queue.filter((p, i) => i < turnIdx || p !== id);
        if (phase === 'reveal' && ids.every(p => confirmed.has(p))) { phase = 'draw'; sendTurn(); }
        else if (phase === 'draw' && wasCurrent) sendTurn();
        else if (phase === 'vote' && ids.every(p => votes.has(p))) resolve();
      },
      onMessage(id, d) {
        if (!d || !ids.includes(id)) return;
        if (d.t === 'faSeen' && phase === 'reveal') {
          confirmed.add(id);
          if (ids.every(p => confirmed.has(p))) { phase = 'draw'; sendTurn(); }
        } else if (d.t === 'faStroke' && phase === 'draw' && id === currentId()) {
          const s = validStroke(d.s);
          if (!s) return;
          allStrokes.push({ by: id, s });
          turnIdx++;
          if (turnIdx >= queue.length) startVote(); else sendTurn();
        } else if (d.t === 'faVoteFor' && phase === 'vote' && ids.includes(d.target) && d.target !== id) {
          votes.set(id, d.target);
          if (ids.every(p => votes.has(p))) resolve();
        } else if (d.t === 'faNext' && id === hostId() && phase === 'result') {
          newRound();
        }
      },
      render() {
        ctx.fillStyle = '#0d0d1a'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff'; ctx.font = 'bold 32px system-ui,sans-serif';
        ctx.fillText('🖌️ Fake Artist — Runde ' + round, cv.width / 2, 40);
        ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 20px system-ui,sans-serif';
        ctx.fillText('Kategorie: ' + category, cv.width / 2, 74);

        // Gemeinschaftsbild
        drawStrokesOn(ctx, allStrokes.map(e => e.s), BOARD.x, BOARD.y, BOARD.w, BOARD.h);

        // Spielerliste rechts
        const lx = BOARD.x + BOARD.w + 30;
        ctx.font = 'bold 18px system-ui,sans-serif';
        ids.forEach((id, i) => {
          const y = BOARD.y + 20 + i * 38;
          ctx.fillStyle = players[id] ? players[id].color : '#888';
          ctx.beginPath(); ctx.arc(lx, y, 10, 0, Math.PI * 2); ctx.fill();
          ctx.textAlign = 'left'; ctx.fillStyle = '#eee';
          let suffix = '';
          if (phase === 'reveal') suffix = confirmed.has(id) ? ' ✅' : ' ⏳';
          else if (phase === 'draw' && id === currentId()) suffix = ' ◀ malt';
          else if (phase === 'vote') suffix = votes.has(id) ? ' 🗳️' : ' ⏳';
          else if (phase === 'result') suffix = '  ' + (result.count.get(id) || 0) + ' ⨯';
          ctx.fillText(shortName(id) + suffix, lx + 18, y);
          ctx.textAlign = 'center';
        });

        ctx.fillStyle = '#888'; ctx.font = '17px system-ui,sans-serif';
        if (phase === 'reveal') ctx.fillText('Schaut auf euer Handy — ' + confirmed.size + ' / ' + ids.length + ' bereit', cv.width / 2, cv.height - 34);
        if (phase === 'draw') { const cur = currentId(); if (cur !== null) ctx.fillText('🖌️ ' + nameOf(cur) + ' zeichnet einen Strich… (' + (turnIdx + 1) + '/' + queue.length + ')', cv.width / 2, cv.height - 34); }
        if (phase === 'vote') ctx.fillText('🗳️ Wer ist der Fake Artist? Stimmt auf dem Handy ab — ' + votes.size + ' / ' + ids.length, cv.width / 2, cv.height - 34);
        if (phase === 'result') {
          ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, cv.height / 2 - 92, cv.width, 184);
          ctx.fillStyle = result.caught ? '#30d158' : '#ff9f0a'; ctx.font = 'bold 34px system-ui,sans-serif';
          ctx.fillText(result.reason || (result.caught ? '🎉 Ertappt! ' + nameOf(fake) + ' war der Fake Artist!' : '😏 Der Fake Artist entkommt: ' + nameOf(fake)), cv.width / 2, cv.height / 2 - 34);
          ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 28px system-ui,sans-serif';
          ctx.fillText('Das Wort: „' + word + '“', cv.width / 2, cv.height / 2 + 18);
          ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '15px system-ui,sans-serif';
          ctx.fillText('⭐ Host startet am Handy die nächste Runde', cv.width / 2, cv.height / 2 + 62);
        }
      }
    };
  }});
