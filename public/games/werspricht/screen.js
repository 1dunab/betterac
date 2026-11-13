// ============ Screen-Modul: WER SPRICHT DA? ============
// Alle sprechen denselben Satz ins Handy. Der Fernseher spielt die Stimmen verzerrt ab (schneller und höher oder
// langsamer und tiefer), und alle tippen, wer das war. Regeln: rules.js (läuft in Node). Aufnahmen kommen wie
// bei Rückwärtsgang als fertige 16-kHz-Samples vom Handy (core/voiceclip.js); verzerrt wird erst beim Abspielen.
registerGame({ key: 'werspricht', screen: function () {
  const W = 960, H = 600;
  const MAX_PCM = 300000;             // a recording message longer than this is refused
  const BARS = 96, GAIN = 1.5;
  const FONT = (px, w) => (w || 'bold') + ' ' + px + 'px system-ui,sans-serif';
  const ms = () => performance.now();

  let R = null, C = null, SENT = null, game = null, cfg = {}, started = false;
  let clips = {}, nextRef = 0, names = {}, colors = {};
  let audio = null, sources = [], cueKey = '', sentRev = -1, seenKey = '', reported = false;

  const nm = (id) => names[id] || shortName(id);
  const col = (id) => colors[id] || '#fff';
  const list = (ids) => ids.map(nm).join(', ');
  function remember() { game.state.players.forEach(id => { if (players[id]) { names[id] = shortName(id); colors[id] = players[id].color; } }); }

  // ---------- Abspielen ----------
  function buffer(ref) {
    const c = clips[ref];
    if (!c) return null;
    if (!c.buf) {
      try { c.buf = audio.ctx.createBuffer(1, c.x.length, C.RATE); c.buf.getChannelData(0).set(c.x); }
      catch (e) { const up = C.resample(c.x, C.RATE, audio.ctx.sampleRate); c.buf = audio.ctx.createBuffer(1, up.length, audio.ctx.sampleRate); c.buf.getChannelData(0).set(up); }
    }
    return c.buf;
  }
  function silence() { sources.forEach(s => { try { s.stop(); } catch (e) {} }); sources = []; }
  // (re)start what the rules say the TV plays; the distortion is nothing but another playback speed
  function schedule(now) {
    silence();
    if (!audio) return;
    const ph = game.state.phase;
    game.cues().forEach(q => {
      const startIn = (ph.at + q.at - now) / 1000;
      if (startIn + q.dur / 1000 < 0.05) return;
      const b = buffer(q.ref);
      if (!b) return;
      const s = audio.ctx.createBufferSource(), g = audio.ctx.createGain();
      g.gain.value = GAIN; s.buffer = b; s.playbackRate.value = q.rate; s.connect(g); g.connect(audio.out);
      if (startIn >= 0) s.start(audio.ctx.currentTime + startIn); else s.start(audio.ctx.currentTime, -startIn * q.rate);
      sources.push(s);
    });
  }

  // ---------- Handys ----------
  function sendState(id) {
    const v = game.view(id, ms()), m = Object.assign({}, v, { t: 'wsState', host: id === hostId() });
    if (v.options) m.options = v.options.map(p => ({ id: p, name: nm(p) }));
    if (v.by !== undefined) m.byName = nm(v.by);
    ac.message(id, m);
  }
  const sendAll = () => { remember(); game.state.players.forEach(sendState); };

  function newGame(ids) {
    silence();
    game = R.create({ ids, cfg, sentences: SENT, seed: Math.floor(Math.random() * 1e9) });
    clips = {}; sentRev = -1; seenKey = ''; cueKey = ''; reported = false;
  }
  function notice() {
    const ph = game.state.phase, key = ph.kind + ':' + game.state.t + ':' + (ph.i || 0);
    if (key === seenKey) return;
    seenKey = key;
    if (ph.kind === 'rec') sfx('go');
    else if (ph.kind === 'guess') sfx('whoosh');
    else if (ph.kind === 'reveal') sfx(ph.items[ph.i].right.length ? 'coin' : 'buzz');
    else if (ph.kind === 'over') { sfx('fanfare'); if (!reported) { reported = true; const w = game.winners(); if (w.length) reportWinners(w); } }
  }

  // ---------- Malen ----------
  function text(c, s, x, y, px, color, weight, max) {
    c.fillStyle = color || '#fff';
    if (max) fitFont(c, s, max, px); else c.font = FONT(px, weight);
    c.fillText(s, x, y);
  }
  function wave(c, ref, x, y, w, h, color, p) {
    const cl = clips[ref];
    rr(c, x, y, w, h, 14); c.fillStyle = 'rgba(255,255,255,.05)'; c.fill();
    if (!cl) return;
    const bw = (w - 20) / BARS;
    for (let i = 0; i < BARS; i++) {
      const bh = Math.max(3, cl.env[i] * (h - 16));
      c.fillStyle = p !== null && i / BARS <= p ? color : 'rgba(255,255,255,.28)';
      c.fillRect(x + 10 + i * bw, y + h / 2 - bh / 2, Math.max(1, bw - 2), bh);
    }
  }
  // how far the TV has played the current voice: null before, 0..1 during, 1 after
  function played(now) { const ph = game.state.phase, q = game.cues()[0], t = now - ph.at; return !q || t < q.at ? null : Math.min(1, (t - q.at) / q.dur); }

  function drawRec(c, ph, now) {
    const st = game.state;
    text(c, '🎤 Alle sagen ins Handy:', W / 2, 110, 30, 'rgba(255,255,255,.8)');
    text(c, '„' + ph.text + '“', W / 2, 200, 56, '#ffd60a', 'bold', W - 80);
    text(c, 'Verstell ruhig deine Stimme. Die anderen müssen gleich raten, wer du bist.', W / 2, 262, 20, 'rgba(255,255,255,.7)', 'normal', W - 60);
    const left = Math.max(0, Math.ceil((ph.until - now) / 1000));
    text(c, String(left), W / 2, 350, 84, left <= 5 ? '#ff6b5e' : '#fff');
    const n = st.players.length, tw = Math.min(150, (W - 40) / Math.max(1, n) - 10), x0 = (W - n * (tw + 10) + 10) / 2;
    st.players.forEach((id, i) => {
      const done = !!ph.clips[id], x = x0 + i * (tw + 10);
      rr(c, x, 430, tw, 84, 14); c.fillStyle = done ? col(id) : 'rgba(255,255,255,.08)'; c.fill();
      text(c, done ? '✅' : (Math.floor(now / 400) % 2 ? '🎤' : '🎙️'), x + tw / 2, 460, 28);
      text(c, nm(id), x + tw / 2, 494, 17, done ? '#10141a' : '#fff', 'bold', tw - 12);
    });
  }
  function drawGuess(c, ph, now) {
    const it = ph.items[ph.i], p = played(now);
    text(c, '🗣️ Wer spricht da?', W / 2, 104, 50);
    text(c, 'Stimme ' + (ph.i + 1) + ' von ' + ph.items.length + ' · ' + (it.rate > 1 ? '🐿️ als Streifenhörnchen' : '👹 als Monster'), W / 2, 158, 20, 'rgba(255,255,255,.7)', 'normal');
    wave(c, it.ref, 80, 200, W - 160, 170, '#ffd60a', p);
    text(c, '„' + ph.text + '“', W / 2, 410, 24, 'rgba(255,255,255,.75)', 'normal', W - 120);
    const got = Object.keys(it.guesses).length, of = game.state.players.filter(id => id !== it.id).length;
    text(c, got + ' von ' + of + ' haben getippt', W / 2, 462, 26, got >= of ? '#30d158' : '#fff');
    text(c, 'Tippt am Handy an, wer das war. Wer es ist: nichts anmerken lassen 🤫', W / 2, 504, 18, 'rgba(255,255,255,.6)', 'normal', W - 60);
  }
  function drawReveal(c, ph, now) {
    const it = ph.items[ph.i], p = played(now);
    text(c, 'Das war …', W / 2, 96, 26, 'rgba(255,255,255,.7)', 'normal');
    text(c, nm(it.id) + '!', W / 2, 160, 78, col(it.id), 'bold', W - 120);
    wave(c, it.ref, 180, 220, 600, 110, col(it.id), p);
    text(c, p === null ? '…' : '▶ So klingt ' + nm(it.id) + ' wirklich', W / 2, 356, 18, 'rgba(255,255,255,.6)', 'normal');
    text(c, it.right.length ? '✅ Erkannt von: ' + list(it.right) : '🙈 Niemand hat es erkannt!', W / 2, 420, 28, it.right.length ? '#30d158' : '#ffd60a', 'bold', W - 80);
    if (it.wrong.length) text(c, '🙈 Reingefallen: ' + it.wrong.map(g => nm(g) + ' (tippte ' + nm(it.guesses[g]) + ')').join(', '), W / 2, 468, 20, 'rgba(255,255,255,.8)', 'normal', W - 80);
  }
  function drawOver(c) {
    const st = game.state;
    text(c, '🗣️ Das war\'s!', W / 2, 120, 56, '#ffd60a');
    if (!game.cfg.wertung) return;
    const best = Math.max(0, ...st.players.map(id => st.score[id] || 0));
    st.players.slice().sort((a, b) => (st.score[b] || 0) - (st.score[a] || 0)).slice(0, 8).forEach((id, i) =>
      text(c, (best > 0 && st.score[id] === best ? '🏆 ' : '') + nm(id) + ' · ' + (st.score[id] || 0) + (st.score[id] === 1 ? ' Punkt' : ' Punkte'), W / 2, 210 + i * 38, 26, col(id)));
  }

  function draw(now) {
    const c = ctx, ph = game.state.phase;
    c.fillStyle = '#14121e'; c.fillRect(0, 0, W, H);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    text(c, '🗣️ Wer spricht da?', 18, 30, 22);
    if (ph.round) { c.textAlign = 'right'; text(c, 'Runde ' + ph.round + ' von ' + game.cfg.runden, W - 18, 30, 15, 'rgba(255,255,255,.55)', 'normal'); }
    c.textAlign = 'center';
    if (ph.kind === 'rec') drawRec(c, ph, now); else if (ph.kind === 'guess') drawGuess(c, ph, now); else if (ph.kind === 'reveal') drawReveal(c, ph, now); else drawOver(c);
    c.textAlign = 'right'; c.textBaseline = 'middle';
    text(c, ph.kind === 'over' ? '⭐ Host kann am Handy nochmal starten' : 'Host kann am Handy weitermachen ⏭ oder abbrechen ✕', W - 14, H - 14, 13, 'rgba(255,255,255,.55)', 'normal');
    // without a click on this page the browser keeps the sound locked: say so, or the game seems broken
    const quiet = ph.kind === 'over' ? null : !audio ? '🔇 Kein Ton: einmal auf diese Seite klicken oder eine Taste drücken' : (sfx.muted ? '🔇 Der Ton ist stumm: 🔊 oben anklicken' : null);
    if (quiet) {
      c.textAlign = 'center'; c.font = FONT(24);
      rr(c, W / 2 - 400, H - 96, 800, 56, 20); c.fillStyle = Math.floor(now / 500) % 2 ? '#ff453a' : '#c2281f'; c.fill();
      c.fillStyle = '#fff'; c.fillText(quiet, W / 2, H - 68);
    }
  }

  return {
    acceptsJoin: true,            // who comes later records and guesses along
    start(ids, config) {
      R = window.WsRules; C = window.VoiceClip; SENT = window.WsSentences;
      if (!R || !C || !SENT) { endToLobby('Wer spricht da? konnte nicht geladen werden 😢'); return; }
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
    onReconnect() {},              // the phone says wsHello as soon as it is back in the game
    onMessage(id, d) {
      if (!d || !started || !game.state.players.includes(id)) return;
      const now = ms(), host = id === hostId();
      if (d.t === 'wsHello') { remember(); sendState(id); }
      else if (d.t === 'wsClip') {
        if (typeof d.pcm !== 'string' || d.pcm.length > MAX_PCM) return;
        const x = C.unpack(d.pcm);
        if (!x || x.length < C.RATE * 0.08 || x.length > C.RATE * (C.MAX_SEC + 0.5)) return;
        const ref = ++nextRef, r = game.clip(id, ref, x.length / C.RATE * 1000, now);
        if (r.ok) { clips[ref] = { x, env: C.envelope(x, BARS) }; if (r.old !== undefined) delete clips[r.old]; sfx('pop'); }
      }
      else if (d.t === 'wsGuess') { if (game.guess(id, d.id | 0, now)) sfx('tick'); }
      else if (d.t === 'wsPlay' && host) game.replay(now);
      else if (d.t === 'wsNext' && host) game.skip(now);
      else if (d.t === 'wsRestart' && host && game.state.over) { newGame(game.state.players.slice()); game.start(ms()); }
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
