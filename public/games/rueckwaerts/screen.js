// ============ Screen-Modul: RÜCKWÄRTSGANG ============
// Ein Wort einsprechen, rückwärts anhören, das Kauderwelsch nachsprechen — und umgedreht soll wieder das Wort
// herauskommen. Wer dran ist und was der Fernseher wann abspielt, steht in rules.js (läuft in Node); das Rechnen
// auf den Aufnahmen in clip.js. Diese Datei hält die Aufnahmen, spielt sie ab und malt die Bühne.
registerGame({ key: 'rueckwaerts', screen: function () {
  const W = 960, H = 600;
  const MAX_PCM = 300000;             // a recording message longer than this is refused (5 s are about 215 000 characters)
  const BARS = 96, GAIN = 1.5;        // bars of the drawn wave; recordings are played a little louder than they arrive
  const FONT = (px, w) => (w || 'bold') + ' ' + px + 'px system-ui,sans-serif';
  const ms = () => performance.now();
  const backwards = (w) => Array.from(w).reverse().join('');

  let R = null, C = null, WORDS = null, game = null, cfg = {}, started = false;
  let clips = {}, nextRef = 0, names = {}, colors = {};
  let audio = null, sources = [], cueKey = '', sentRev = -1, seenKey = '', reported = false;
  let hands = [], clapAt = 0;              // applause: 👏 flying up, and when the last clap sounded

  const nm = (id) => names[id] || shortName(id);
  const col = (id) => colors[id] || '#fff';
  function remember() { game.state.players.forEach(id => { if (players[id]) { names[id] = shortName(id); colors[id] = players[id].color; } }); }

  // ---------- Abspielen ----------
  function buffer(ref, rev) {
    const c = clips[ref], k = rev ? 'rev' : 'fwd';
    if (!c) return null;
    if (!c[k]) {
      const data = rev ? C.reverse(c.x) : c.x;
      try { c[k] = audio.ctx.createBuffer(1, data.length, C.RATE); c[k].getChannelData(0).set(data); }
      catch (e) {                     // a browser that refuses 16 kHz buffers: bring the samples up to its own rate
        const up = C.resample(data, C.RATE, audio.ctx.sampleRate);
        c[k] = audio.ctx.createBuffer(1, up.length, audio.ctx.sampleRate); c[k].getChannelData(0).set(up);
      }
    }
    return c[k];
  }
  function silence() { sources.forEach(s => { try { s.stop(); } catch (e) {} }); sources = []; }
  // (re)start what the rules say the TV plays in this phase; sounds already under way start in the middle
  function schedule(now) {
    silence();
    if (!audio) return;
    const ph = game.state.phase;
    game.cues().forEach(q => {
      const startIn = (ph.at + q.at - now) / 1000;
      if (startIn + q.dur / 1000 < 0.05) return;
      const b = buffer(q.ref, q.rev);
      if (!b) return;
      const s = audio.ctx.createBufferSource(), g = audio.ctx.createGain();
      g.gain.value = GAIN; s.buffer = b; s.connect(g); g.connect(audio.out);
      if (startIn >= 0) s.start(audio.ctx.currentTime + startIn); else s.start(audio.ctx.currentTime, -startIn);
      sources.push(s);
    });
  }

  // ---------- Handys ----------
  function sendState(id) {
    const v = game.view(id, ms()), m = Object.assign({}, v, { t: 'rwState', host: id === hostId() });
    if (v.cur !== undefined) m.curName = nm(v.cur);
    if (v.next) { m.nextNames = v.next.map(nm); m.soon = v.next[0] === id; }
    if (v.options) m.options = v.options.map(o => ({ i: o.i, label: nm(o.id) + (o.word ? ' · ' + o.word : '') }));
    if (v.by !== undefined) m.byName = nm(v.by);
    if (v.turn) m.turnName = nm(v.turn);
    ac.message(id, m);
  }
  const sendAll = () => { remember(); game.state.players.forEach(sendState); };

  function newGame(ids) {
    silence();
    game = R.create({ ids, cfg, words: WORDS, seed: Math.floor(Math.random() * 1e9) });
    clips = {}; sentRev = -1; seenKey = ''; cueKey = ''; reported = false; hands = [];
  }
  function notice() {
    const ph = game.state.phase, key = ph.kind + ':' + game.state.t + ':' + (ph.i || 0);
    if (key === seenKey) return;
    seenKey = key;
    if (ph.kind === 'say') sfx('pop');
    else if (ph.kind === 'reveal' || ph.kind === 'show') sfx('whoosh');
    else if (ph.kind === 'rec') sfx('go');
    else if (ph.kind === 'result') sfx('coin');
    else if (ph.kind === 'over') { sfx('fanfare'); if (!reported) { reported = true; const w = game.winners(); if (w.length) reportWinners(w); } }
    else if (ph.kind === 'vote' || ph.kind === 'recap') sfx('go');
  }

  // ---------- Malen ----------
  function text(c, s, x, y, px, color, weight, max) {
    c.fillStyle = color || '#fff';
    if (max) fitFont(c, s, max, px); else c.font = FONT(px, weight);
    c.fillText(s, x, y);
  }
  // a recording as bars. `rev` draws it right to left; `p` (0..1) is how far the TV has played it
  function wave(c, ref, rev, x, y, w, h, color, p) {
    const cl = clips[ref];
    rr(c, x, y, w, h, 14); c.fillStyle = 'rgba(255,255,255,.05)'; c.fill();
    if (!cl) return;
    const bw = (w - 20) / BARS;
    for (let i = 0; i < BARS; i++) {
      const v = cl.env[rev ? BARS - 1 - i : i], bh = Math.max(3, v * (h - 16));
      c.fillStyle = p !== null && i / BARS <= p ? color : 'rgba(255,255,255,.28)';
      c.fillRect(x + 10 + i * bw, y + h / 2 - bh / 2, Math.max(1, bw - 2), bh);
    }
  }
  // how far the cue with this label has been played: null before, 0..1 during, 1 after
  function played(label, now) {
    const ph = game.state.phase, q = game.cues().find(x => x.label === label), t = now - ph.at;
    return !q || t < q.at ? null : Math.min(1, (t - q.at) / q.dur);
  }

  function drawTurn(c, ph, now) {
    const who = nm(ph.id), color = col(ph.id), play = game.playing(now), busy = game.state.phase.kind !== 'say' && game.busy(now);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    text(c, '🎤 ' + who + ' ist dran', W / 2, 96, 34, color);
    if (ph.kind === 'say') {
      if (ph.word) { text(c, 'Sag ins Handy:', W / 2, 190, 24, 'rgba(255,255,255,.7)', 'normal'); text(c, ph.word, W / 2, 290, 110, '#fff', 'bold', W - 80); }
      else { text(c, 'Sag ein Wort oder einen kurzen Satz', W / 2, 250, 44, '#fff', 'bold', W - 80); text(c, 'Was du willst. Sprich es deutlich ins Handy.', W / 2, 310, 22, 'rgba(255,255,255,.7)', 'normal'); }
      return;
    }
    if (ph.word) text(c, ph.word, W / 2, 150, 30, 'rgba(255,255,255,.85)', 'bold', W - 80);
    if (ph.kind === 'listen') {
      const pv = played('vor', now), pr = played('zurueck', now), back = pr !== null;
      text(c, play === 'vor' ? '▶ So klingt es vorwärts …' : play === 'zurueck' ? '◀ … und so rückwärts!' : busy ? '…' : '🎤 ' + who + ', sprich das Rückwärts-Wort nach!', W / 2, 215, 30, back ? '#ffd60a' : '#fff', 'bold', W - 60);
      wave(c, ph.a, back, 80, 260, W - 160, 170, back ? '#ffd60a' : color, back ? pr : pv);
      if (back && ph.word) text(c, '„' + backwards(ph.word) + '“', W / 2, 480, 44, '#ffd60a', 'bold', W - 80);
    } else {
      const pe = played('ergebnis', now), po = played('original', now);
      text(c, pe === null ? '🥁 Und umgedreht klingt das so …' : play === 'ergebnis' ? '◀ Der Versuch von ' + who + ', umgedreht' : play === 'original' ? '▶ Zum Vergleich: das Original' : busy ? '…' : 'Nochmal versuchen oder weiter? ' + who + ' entscheidet am Handy.', W / 2, 215, 28, '#fff', 'bold', W - 60);
      wave(c, ph.b, true, 80, 250, W - 160, 120, '#ffd60a', pe);
      wave(c, ph.a, false, 80, 384, W - 160, 120, color, po);
      c.textAlign = 'left'; text(c, 'Versuch ' + ph.tries, 92, 264, 14, 'rgba(255,255,255,.6)', 'normal'); text(c, 'Original', 92, 398, 14, 'rgba(255,255,255,.6)', 'normal');
    }
  }

  // ---- mode "alle dasselbe Wort" ----
  function tiles(c, ph, now, y) {
    const list = game.state.players, n = list.length, tw = Math.min(150, (W - 40) / Math.max(1, n) - 10), x0 = (W - n * (tw + 10) + 10) / 2;
    list.forEach((id, i) => {
      const done = !!ph.clips[id], on = ph.turn === id, x = x0 + i * (tw + 10);
      rr(c, x, y, tw, 84, 14); c.fillStyle = done ? col(id) : 'rgba(255,255,255,.08)'; c.fill();
      if (on) { c.strokeStyle = '#ffd60a'; c.lineWidth = 4; c.stroke(); }
      text(c, done ? '✅' : on || ph.turn === null ? (Math.floor(now / 400) % 2 ? '🎤' : '🎙️') : '⏳', x + tw / 2, y + 30, 28);
      text(c, nm(id), x + tw / 2, y + 64, 17, done ? '#10141a' : '#fff', 'bold', tw - 12);
    });
  }
  function drawAll(c, ph, now) {
    const who = nm(ph.id), color = col(ph.id), play = game.playing(now), busy = game.busy(now);
    c.textAlign = 'right'; c.textBaseline = 'middle';
    text(c, 'Wort ' + ph.round + ' von ' + game.cfg.anzahl, W - 18, 30, 15, 'rgba(255,255,255,.55)', 'normal');
    c.textAlign = 'center';
    if (ph.kind === 'say') {
      text(c, '🎤 ' + who + ' spricht vor', W / 2, 96, 34, color);
      if (ph.word) { text(c, 'Sag ins Handy:', W / 2, 190, 24, 'rgba(255,255,255,.7)', 'normal'); text(c, ph.word, W / 2, 290, 110, '#fff', 'bold', W - 80); }
      else { text(c, 'Sag ein Wort oder einen kurzen Satz', W / 2, 250, 44, '#fff', 'bold', W - 80); }
      text(c, 'Gleich sprechen es alle rückwärts nach.', W / 2, 400, 22, 'rgba(255,255,255,.7)', 'normal');
    } else if (ph.kind === 'listen') {
      const pv = played('vor', now), pr = played('zurueck', now), back = pr !== null;
      if (ph.word) text(c, ph.word, W / 2, 110, 36, 'rgba(255,255,255,.9)', 'bold', W - 80);
      text(c, play === 'vor' ? '▶ So klingt es vorwärts …' : play === 'zurueck' ? '◀ … und so rückwärts!' : busy ? '…' : '👂 Alle gehört? ' + who + ' gibt am Handy das Startzeichen.', W / 2, 190, 28, back && busy ? '#ffd60a' : '#fff', 'bold', W - 60);
      wave(c, ph.a, back, 80, 240, W - 160, 170, back ? '#ffd60a' : color, back ? pr : pv);
      if (back && ph.word) text(c, '„' + backwards(ph.word) + '“', W / 2, 462, 44, '#ffd60a', 'bold', W - 80);
    } else if (ph.kind === 'rec') {
      text(c, ph.turn === null ? '🎤 Alle sprechen das Rückwärts-Wort nach!' : '🎤 ' + nm(ph.turn) + ' spricht nach', W / 2, 100, 36, ph.turn === null ? '#fff' : col(ph.turn), 'bold', W - 60);
      if (ph.word) text(c, '„' + backwards(ph.word) + '“', W / 2, 190, 60, '#ffd60a', 'bold', W - 80);
      text(c, ph.turn === null ? 'Jeder ins eigene Handy. Geht ruhig ein Stück auseinander.' : 'Einer nach dem anderen. Aufgelöst wird erst in der Show.', W / 2, 252, 20, 'rgba(255,255,255,.7)', 'normal', W - 60);
      const left = Math.max(0, Math.ceil((ph.until - now) / 1000));
      text(c, String(left), W / 2, 340, 84, left <= 5 ? '#ff6b5e' : '#fff');
      tiles(c, ph, now, 420);
    } else if (ph.kind === 'show') {
      const it = ph.items[ph.i], others = Math.max(1, game.state.players.filter(p => p !== it.id).length);
      text(c, '🔊 ' + nm(it.id), W / 2, 100, 46, col(it.id), 'bold', W - 200);
      text(c, ph.i + 1 + ' von ' + ph.items.length + (ph.word ? ' · gesucht: ' + ph.word : ''), W / 2, 150, 18, 'rgba(255,255,255,.6)', 'normal', W - 80);
      wave(c, it.ref, true, 80, 190, W - 160, 160, '#ffd60a', played('ergebnis', now));
      // the applause meter: full when everybody else has clapped about half of what counts
      const full = Math.min(1, it.total / (others * 10));
      rr(c, 180, 392, 600, 30, 15); c.fillStyle = 'rgba(255,255,255,.1)'; c.fill();
      if (full > 0) { rr(c, 180, 392, Math.max(30, 600 * full), 30, 15); c.fillStyle = full >= 1 ? '#ff2d55' : '#ff9f0a'; c.fill(); }
      text(c, '👏 ' + it.total, W / 2, 408, 20);
      text(c, play ? 'Hört zu …' : 'Hat es geklungen wie das Wort? Dann klatscht am Handy! 👏', W / 2, 458, 22, 'rgba(255,255,255,.8)', 'normal', W - 80);
      hands = hands.filter(h => now - h.at < 1100);
      hands.forEach(h => { const k = (now - h.at) / 1100; c.globalAlpha = 1 - k; text(c, '👏', h.x, 380 - k * 190, 40); });
      c.globalAlpha = 1;
    } else if (ph.kind === 'result') {
      const rows = ph.items.slice().sort((a, b) => b.total - a.total), top = Math.max(1, rows[0].total);
      text(c, play === 'original' || played('original', now) === null ? '▶ Und so klang das Original' : 'Applaus für „' + (ph.word || 'das Wort von ' + who) + '“', W / 2, 96, 30, '#fff', 'bold', W - 80);
      wave(c, ph.a, false, 180, 130, 600, 90, color, played('original', now));
      const lh = Math.min(48, 300 / rows.length);
      rows.slice(0, 8).forEach((it, i) => {
        const y = 256 + i * lh, w = 380 * it.total / top;
        c.textAlign = 'right'; text(c, (it.total && it.total === rows[0].total ? '👑 ' : '') + nm(it.id), 330, y, Math.min(24, lh * 0.55), col(it.id), 'bold', 280);
        rr(c, 346, y - lh * 0.3, Math.max(8, w), lh * 0.6, 8); c.fillStyle = col(it.id); c.fill();
        c.textAlign = 'left'; text(c, '👏 ' + it.total, 356 + Math.max(8, w), y, Math.min(22, lh * 0.5));
      });
      c.textAlign = 'center';
    }
  }

  function drawRecap(c, ph, now) {
    const r = game.state.results[ph.i];
    c.textAlign = 'center'; c.textBaseline = 'middle';
    text(c, '🎬 Die Show · ' + (ph.i + 1) + ' von ' + game.state.results.length, W / 2, 96, 26, 'rgba(255,255,255,.75)');
    text(c, nm(r.id) + (r.word ? ': ' + r.word : ''), W / 2, 160, 48, col(r.id), 'bold', W - 80);
    wave(c, r.a, false, 80, 220, W - 160, 130, col(r.id), played('original', now));
    wave(c, r.b, true, 80, 364, W - 160, 130, '#ffd60a', played('ergebnis', now));
    c.textAlign = 'left'; text(c, 'Original', 92, 234, 14, 'rgba(255,255,255,.6)', 'normal'); text(c, 'Rückwärts nachgesprochen und umgedreht', 92, 378, 14, 'rgba(255,255,255,.6)', 'normal');
  }

  function drawList(c, title, sub) {
    const st = game.state;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    text(c, title, W / 2, 110, 52, '#ffd60a', 'bold', W - 80);
    if (sub) text(c, sub, W / 2, 166, 22, 'rgba(255,255,255,.75)', 'normal', W - 80);
    const votes = {}; if (st.phase.kind === 'vote') Object.values(st.phase.votes).forEach(i => { votes[i] = (votes[i] || 0) + 1; });
    const rows = st.over && game.cfg.wertung
      ? st.players.slice().sort((a, b) => (st.score[b] || 0) - (st.score[a] || 0)).map(id => ({ id, s: (game.winners().includes(id) ? '🏆 ' : '') + nm(id) + ' · ' + (st.score[id] || 0) + (game.cfg.modus === 'alle' ? ' 👏' : st.score[id] === 1 ? ' Stimme' : ' Stimmen') }))
      : st.results.map((r, i) => ({ id: r.id, s: nm(r.id) + (r.word ? ' · ' + r.word : '') + (votes[i] ? '  ' + '❤️'.repeat(Math.min(8, votes[i])) : '') }));
    const lh = Math.min(38, 330 / Math.max(1, rows.length));
    rows.slice(0, 12).forEach((r, i) => text(c, r.s, W / 2, 220 + i * lh, Math.min(26, lh * 0.75), col(r.id), 'bold', W - 120));
  }

  function draw(now) {
    const c = ctx, ph = game.state.phase;
    c.fillStyle = '#14121e'; c.fillRect(0, 0, W, H);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    text(c, '⏪ Rückwärtsgang', 18, 30, 22);
    if (game.cfg.modus === 'alle' && ph.kind !== 'over') drawAll(c, ph, now);
    else if (ph.id !== undefined) {
      drawTurn(c, ph, now);
      const v = game.view(ph.id, now);
      c.textAlign = 'center';
      text(c, v.next.length ? 'Danach: ' + v.next.map(nm).join(', ') + (v.left > 3 ? ' …' : '') : 'Danach kommt die Show', W / 2, H - 46, 17, 'rgba(255,255,255,.6)', 'normal');
    }
    else if (ph.kind === 'recap') drawRecap(c, ph, now);
    else if (ph.kind === 'vote') drawList(c, '❤️ Wer war am nächsten dran?', 'Stimmt am Handy ab.');
    else drawList(c, '⏪ Das war\'s!', game.cfg.wertung ? (game.cfg.modus === 'alle' ? 'Der Applaus des Abends:' : '') : (game.state.results.length ? 'Alle Wörter des Abends:' : ''));
    c.textAlign = 'right'; c.textBaseline = 'middle';
    text(c, ph.kind === 'over' ? '⭐ Host kann am Handy nochmal starten' : 'Host kann am Handy weitermachen ⏭ oder abbrechen ✕', W - 14, H - 14, 13, 'rgba(255,255,255,.55)', 'normal');
    // without a click on this page the browser keeps the sound locked: say so, or the game seems broken
    const quiet = ph.kind === 'over' ? null : !audio ? '🔇 Kein Ton: einmal auf diese Seite klicken oder eine Taste drücken' : (sfx.muted ? '🔇 Der Ton ist stumm: 🔊 oben anklicken' : null);
    if (quiet) {
      c.textAlign = 'center'; c.font = FONT(24);
      rr(c, W / 2 - 400, H - 110, 800, 56, 20); c.fillStyle = Math.floor(now / 500) % 2 ? '#ff453a' : '#c2281f'; c.fill();
      c.fillStyle = '#fff'; c.fillText(quiet, W / 2, H - 82);
    }
  }

  return {
    acceptsJoin: true,            // who comes later gets a turn at the end
    start(ids, config) {
      R = window.RwRules; C = window.VoiceClip; WORDS = window.RwWords;
      if (!R || !C || !WORDS) { endToLobby('Rückwärtsgang konnte nicht geladen werden 😢'); return; }
      cfg = config || {};
      newGame(ids);
      game.start(ms());
      started = true;
    },
    stop() { silence(); started = false; clips = {}; },
    onConnect(id) { if (started) game.join(id); },
    onDisconnect(id) {
      if (!started || !game.state.players.includes(id)) return;
      game.leave(id, ms());
      if (!game.state.players.length) endToLobby('Alle sind weg.');
    },
    canResume(id) { return started && game.state.players.includes(id); },
    onReconnect() {},              // the phone says rwHello as soon as it is back in the game
    onMessage(id, d) {
      if (!d || !started || !game.state.players.includes(id)) return;
      const now = ms(), host = id === hostId();
      if (d.t === 'rwHello') { remember(); sendState(id); }
      else if (d.t === 'rwClip') {
        if (typeof d.pcm !== 'string' || d.pcm.length > MAX_PCM) return;
        const x = C.unpack(d.pcm);
        if (!x || x.length < C.RATE * 0.08 || x.length > C.RATE * (C.MAX_SEC + 0.5)) return;
        const ref = ++nextRef;
        const r = game.clip(id, ref, x.length / C.RATE * 1000, now);
        if (r.ok) { clips[ref] = { x, env: C.envelope(x, BARS) }; if (r.old !== undefined) delete clips[r.old]; }
      }
      else if (d.t === 'rwAgain') { const r = game.again(id, now); if (r.ok) delete clips[r.old]; }
      else if (d.t === 'rwPlay') game.replay(id, now);
      else if (d.t === 'rwDone') game.done(id, now);
      else if (d.t === 'rwVote') { if (game.vote(id, d.i | 0)) sfx('tick'); }
      else if (d.t === 'rwClap') {
        if (!game.clap(id)) return;
        hands.push({ at: now, x: 180 + Math.random() * 600, color: col(id) });
        if (now - clapAt > 45) { clapAt = now; sfx('hit'); }       // many phones hammering: not every tap makes a sound
      }
      else if (d.t === 'rwNext' && host) game.skip(now);
      else if (d.t === 'rwRestart' && host && game.state.over) { newGame(game.state.players.slice()); game.start(ms()); }
    },
    render() {
      if (!started) return;
      const now = ms();
      if (!audio && sfx.audio) audio = sfx.audio();
      game.step(now);
      const ph = game.state.phase, key = ph.kind + ':' + game.state.t + ':' + (ph.i || 0) + ':' + (ph.at || 0) + ':' + (audio ? 1 : 0);
      if (key !== cueKey) { cueKey = key; schedule(now); }
      if (game.state.rev !== sentRev) { sentRev = game.state.rev; notice(); sendAll(); }
      draw(now);
    },
    _debug() { return { game, state: game && game.state, clips, sources }; }
  };
}});
