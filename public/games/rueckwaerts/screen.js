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
    ac.message(id, m);
  }
  const sendAll = () => { remember(); game.state.players.forEach(sendState); };

  function newGame(ids) {
    silence();
    game = R.create({ ids, cfg, words: WORDS, seed: Math.floor(Math.random() * 1e9) });
    clips = {}; sentRev = -1; seenKey = ''; cueKey = ''; reported = false;
  }
  function notice() {
    const ph = game.state.phase, key = ph.kind + ':' + game.state.t + ':' + (ph.i || 0);
    if (key === seenKey) return;
    seenKey = key;
    if (ph.kind === 'say') sfx('pop');
    else if (ph.kind === 'reveal') sfx('whoosh');
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
      ? st.players.slice().sort((a, b) => (st.score[b] || 0) - (st.score[a] || 0)).map(id => ({ id, s: (game.winners().includes(id) ? '🏆 ' : '') + nm(id) + ' · ' + (st.score[id] || 0) + (st.score[id] === 1 ? ' Stimme' : ' Stimmen') }))
      : st.results.map((r, i) => ({ id: r.id, s: nm(r.id) + (r.word ? ' · ' + r.word : '') + (votes[i] ? '  ' + '❤️'.repeat(Math.min(8, votes[i])) : '') }));
    const lh = Math.min(38, 330 / Math.max(1, rows.length));
    rows.slice(0, 12).forEach((r, i) => text(c, r.s, W / 2, 220 + i * lh, Math.min(26, lh * 0.75), col(r.id), 'bold', W - 120));
  }

  function draw(now) {
    const c = ctx, ph = game.state.phase;
    c.fillStyle = '#14121e'; c.fillRect(0, 0, W, H);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    text(c, '⏪ Rückwärtsgang', 18, 30, 22);
    if (ph.id !== undefined) {
      drawTurn(c, ph, now);
      const v = game.view(ph.id, now);
      c.textAlign = 'center';
      text(c, v.next.length ? 'Danach: ' + v.next.map(nm).join(', ') + (v.left > 3 ? ' …' : '') : 'Danach kommt die Show', W / 2, H - 46, 17, 'rgba(255,255,255,.6)', 'normal');
    }
    else if (ph.kind === 'recap') drawRecap(c, ph, now);
    else if (ph.kind === 'vote') drawList(c, '❤️ Wer war am nächsten dran?', 'Stimmt am Handy ab.');
    else drawList(c, '⏪ Das war\'s!', game.cfg.wertung ? '' : (game.state.results.length ? 'Alle Wörter des Abends:' : ''));
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
      R = window.RwRules; C = window.RwClip; WORDS = window.RwWords;
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
        if (game.clip(id, ref, x.length / C.RATE * 1000, now).ok) clips[ref] = { x, env: C.envelope(x, BARS) };
      }
      else if (d.t === 'rwAgain') { const r = game.again(id, now); if (r.ok) delete clips[r.old]; }
      else if (d.t === 'rwPlay') game.replay(id, now);
      else if (d.t === 'rwDone') game.done(id, now);
      else if (d.t === 'rwVote') { if (game.vote(id, d.i | 0)) sfx('tick'); }
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
