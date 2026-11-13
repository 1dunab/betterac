// ============ Screen-Modul: FOTOSALAT ============
// Mini-Spiele mit der Handy-Kamera: Nachmachen, Zoom-Rätsel, Schnitzeljagd. Die Regeln (wer bekommt welches Bild,
// wann geht es weiter, Herzen und Punkte) stehen in rules.js und laufen in Node. Diese Datei hält die Fotos,
// spricht mit den Handys und malt die Bühne. Fotos liegen nur hier im Speicher und sind nach dem Spiel weg.
registerGame({ key: 'fotosalat', screen: function () {
  const W = 960, H = 600;
  const MAX_URL = 600000;             // a photo message longer than this is refused (a phone sends about 30 to 130 KB)
  const GAMES = { nachmachen: '🖼️ Nachmachen', zoom: '🔍 Zoom-Rätsel', jagd: '🏃 Schnitzeljagd', mix: '🎁 Bunte Tüte' };
  const FONT = (px, w) => (w || 'bold') + ' ' + px + 'px system-ui,sans-serif';
  const ms = () => performance.now();

  let R = null, ART = [], TASKS = [], game = null, cfg = {}, started = false;
  let pics = {}, nextRef = 0, artImgs = {}, names = {}, colors = {};
  let sentRev = -1, sentTpl = {}, seenKey = '', reported = false, floaters = [];

  // ---------- Fotos ----------
  function store(url) { const ref = ++nextRef, img = new Image(); img.src = url; pics[ref] = { img, url }; return ref; }
  const pic = (ref) => (pics[ref] ? pics[ref].img : null);
  function artImg(i) {
    if (!artImgs[i]) { artImgs[i] = new Image(); artImgs[i].src = 'games/fotosalat/art/' + ART[i].f; }
    return artImgs[i];
  }
  const ready = (img) => !!img && img.complete && img.naturalWidth > 0;
  const tplImg = (tpl) => (tpl.art !== undefined ? artImg(tpl.art) : pic(tpl.pose));
  const nm = (id) => names[id] || shortName(id);
  const col = (id) => colors[id] || '#fff';
  function remember() { game.state.players.forEach(id => { if (players[id]) { names[id] = shortName(id); colors[id] = players[id].color; } }); }

  // ---------- Handys ----------
  function sendState(id, fresh) {
    const v = game.view(id, ms()), m = Object.assign({}, v, { t: 'fsState', host: id === hostId(), key: game.state.at });
    if (v.tpl) {
      if (v.tpl.art !== undefined) { const a = ART[v.tpl.art]; m.tpl = { art: 'games/fotosalat/art/' + a.f, title: a.title, by: a.by + ', ' + a.year }; }
      else {
        m.tpl = { pose: true, by: nm(v.tpl.by) };
        // somebody else's pose travels to the phone once per phase (and again after a reload)
        if ((fresh || sentTpl[id] !== v.tpl.pose) && pics[v.tpl.pose]) { sentTpl[id] = v.tpl.pose; ac.message(id, { t: 'fsTpl', url: pics[v.tpl.pose].url }); }
      }
    }
    if (v.task !== undefined) m.task = TASKS[v.task];
    if (v.options) m.options = v.options.map(p => ({ id: p, name: nm(p) }));
    if (v.by !== undefined) m.byName = nm(v.by);
    if (v.solved) m.solvedName = nm(v.solved);
    ac.message(id, m);
  }
  const sendAll = () => { remember(); game.state.players.forEach(id => sendState(id)); };

  function newGame() {
    game = R.create({ ids: game ? game.state.players : [], cfg, arts: ART.length, tasks: TASKS.length, seed: Math.floor(Math.random() * 1e9) });
    pics = {}; sentTpl = {}; sentRev = -1; seenKey = ''; reported = false; floaters = [];
  }

  // a sound for what just happened, and the winners once
  function notice() {
    const st = game.state, ph = st.phase, key = st.at + ':' + (ph.i || 0) + ':' + (ph.step || 0) + ':' + (ph.solved ? 1 : 0);
    if (key === seenKey) return;
    seenKey = key;
    if (ph.kind === 'show') sfx(ph.step ? 'coin' : 'whoosh');
    else if (ph.kind === 'riddle') sfx(ph.solved ? (ph.solved.by ? 'coin' : 'sad') : 'whoosh');
    else if (ph.kind === 'over') { sfx('fanfare'); if (!reported) { reported = true; const w = game.winners(); if (w.length) reportWinners(w); } }
    else sfx('go');
  }

  // ---------- Malen ----------
  function mat(c, x, y, w, h) { rr(c, x, y, w, h, 14); c.fillStyle = '#0b0b13'; c.fill(); }
  // a picture inside a box, whole and centred
  function frame(c, img, x, y, w, h, waiting) {
    mat(c, x, y, w, h);
    if (!ready(img)) { c.fillStyle = 'rgba(255,255,255,.3)'; c.font = FONT(Math.min(64, h / 3)); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(waiting || '…', x + w / 2, y + h / 2); return; }
    const k = Math.min((w - 12) / img.naturalWidth, (h - 12) / img.naturalHeight), dw = img.naturalWidth * k, dh = img.naturalHeight * k;
    c.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  // the zoom riddle: a cut-out around the chosen point, `z` times enlarged
  function zoomed(c, img, fx, fy, z, x, y, w, h) {
    mat(c, x, y, w, h);
    if (!ready(img)) return;
    const iw = img.naturalWidth, ih = img.naturalHeight, k = Math.min((w - 12) / iw, (h - 12) / ih), dw = iw * k, dh = ih * k;
    const sw = iw / z, sh = ih / z, sx = clamp(fx * iw - sw / 2, 0, iw - sw), sy = clamp(fy * ih - sh / 2, 0, ih - sh);
    c.drawImage(img, sx, sy, sw, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function text(c, s, x, y, px, color, weight, max) {
    c.fillStyle = color || '#fff';
    if (max) fitFont(c, s, max, px); else c.font = FONT(px, weight);
    c.fillText(s, x, y);
  }

  function drawShoot(c, ph, now) {
    const st = game.state, T = {
      pose: ['🕺 Mach eine Pose vor!', 'Die anderen müssen sie gleich nachstellen. Je schräger, desto besser.'],
      copy: ['🖼️ Stell dein Bild nach!', 'Dein Bild steht auf dem Handy. Requisiten, Helfer, alles erlaubt.'],
      task: ['🏃 Los, fotografiert:', ''],
      zshoot: ['🔍 Fotografiert etwas hier im Raum!', 'Die anderen müssen es gleich erraten. Tippt danach auf die Stelle, an der das Zoomen anfängt.']
    }[ph.kind];
    c.textAlign = 'center'; c.textBaseline = 'middle';
    text(c, T[0], W / 2, 150, 44, '#fff', 'bold', W - 80);
    if (ph.kind === 'task') text(c, '„' + TASKS[ph.task] + '“', W / 2, 235, 64, '#ffd60a', 'bold', W - 80);
    else text(c, T[1], W / 2, 205, 20, 'rgba(255,255,255,.7)', 'normal', W - 80);
    const left = Math.max(0, Math.ceil((ph.until - now) / 1000));
    text(c, String(left), W / 2, 335, 96, left <= 10 ? '#ff6b5e' : '#fff');
    const n = st.players.length, tw = Math.min(150, (W - 40) / Math.max(1, n) - 10), x0 = (W - n * (tw + 10) + 10) / 2;
    st.players.forEach((id, i) => {
      const done = ph.shots[id] !== undefined, x = x0 + i * (tw + 10);
      rr(c, x, 430, tw, 96, 14); c.fillStyle = done ? col(id) : 'rgba(255,255,255,.08)'; c.fill();
      text(c, done ? '✅' : (Math.floor(now / 500) % 2 ? '📷' : '📸'), x + tw / 2, 462, 30);
      text(c, nm(id), x + tw / 2, 503, 18, done ? '#10141a' : '#fff', 'bold', tw - 12);
    });
  }

  function drawShow(c, ph, now) {
    const p = ph.list[ph.i], bw = 430, bh = 400, y = 96;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    frame(c, tplImg(p.tpl), 40, y, bw, bh);
    if (p.tpl.art !== undefined) { const a = ART[p.tpl.art]; text(c, a.title, 40 + bw / 2, y + bh + 26, 22, '#fff', 'bold', bw); text(c, a.by + ', ' + a.year, 40 + bw / 2, y + bh + 52, 16, 'rgba(255,255,255,.65)', 'normal', bw); }
    else text(c, 'Pose von ' + nm(p.tpl.by), 40 + bw / 2, y + bh + 30, 22, col(p.tpl.by), 'bold', bw);
    if (ph.step) {
      frame(c, pic(p.shot), 490, y, bw, bh);
      text(c, 'nachgestellt von ' + nm(p.by), 490 + bw / 2, y + bh + 30, 24, col(p.by), 'bold', bw);
      if (game.cfg.wertung) text(c, '❤️ ' + p.hearts.length, 490 + bw / 2, y + bh + 62, 22);
    } else {
      mat(c, 490, y, bw, bh);
      text(c, '?', 490 + bw / 2, y + bh / 2 - 10 + Math.sin(now / 90) * 6, 150, 'rgba(255,255,255,.35)');
      text(c, 'Wer hat das nachgestellt … 🥁', 490 + bw / 2, y + bh + 30, 22, 'rgba(255,255,255,.7)', 'normal', bw);
    }
    floaters = floaters.filter(f => now - f.at < 1300);
    floaters.forEach(f => { const k = (now - f.at) / 1300; c.globalAlpha = 1 - k; text(c, '❤️', f.x, y + bh - 30 - k * 220, 44); });
    c.globalAlpha = 1;
    text(c, ph.i + 1 + ' / ' + ph.list.length, W / 2, 62, 18, 'rgba(255,255,255,.6)', 'normal');
  }

  function drawGallery(c, ph) {
    const votes = {}; Object.values(ph.votes).forEach(t => { votes[t] = (votes[t] || 0) + 1; });
    c.textAlign = 'center'; c.textBaseline = 'middle';
    text(c, '„' + TASKS[ph.task] + '“', W / 2, 92, 34, '#ffd60a', 'bold', W - 80);
    const n = ph.items.length, cols = n <= 4 ? n : Math.ceil(n / 2), rows = n <= 4 ? 1 : 2;
    const cw = (W - 40 - (cols - 1) * 12) / cols, ch = (430 - (rows - 1) * 12) / rows;
    ph.items.forEach((it, i) => {
      const x = 20 + (i % cols) * (cw + 12), y = 126 + Math.floor(i / cols) * (ch + 12);
      frame(c, pic(it.ref), x, y, cw, ch - 30);
      text(c, nm(it.id) + (votes[it.id] ? '  ' + '❤️'.repeat(Math.min(8, votes[it.id])) : ''), x + cw / 2, y + ch - 13, 18, col(it.id), 'bold', cw);
    });
  }

  function drawRiddle(c, ph, now) {
    const it = ph.items[ph.i], x = 170, y = 96, w = 620, h = 400, p = game.progress(now);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    zoomed(c, pic(it.ref), it.x, it.y, game.zoom(now), x, y, w, h);
    if (!ph.solved) {
      text(c, '🔍 Was ist das? Ruft es laut!', W / 2, 62, 28);
      rr(c, x, y + h + 14, w, 12, 6); c.fillStyle = 'rgba(255,255,255,.12)'; c.fill();
      rr(c, x, y + h + 14, Math.max(12, w * (1 - p)), 12, 6); c.fillStyle = p > 0.66 ? '#ff6b5e' : '#ffd60a'; c.fill();
      text(c, 'Foto von ' + nm(it.id) + ' · ' + nm(it.id) + ' tippt am Handy an, wer es zuerst hatte', W / 2, y + h + 52, 17, 'rgba(255,255,255,.7)', 'normal', W - 60);
    } else {
      text(c, ph.solved.by ? '✅ ' + nm(ph.solved.by) + ' hat\'s erkannt!' : '🤷 Niemand hat\'s erkannt', W / 2, 62, 30, ph.solved.by ? col(ph.solved.by) : '#fff');
      text(c, 'Foto von ' + nm(it.id), W / 2, y + h + 34, 20, col(it.id));
    }
    text(c, ph.i + 1 + ' / ' + ph.items.length, W - 60, 62, 18, 'rgba(255,255,255,.6)', 'normal');
  }

  function drawOver(c) {
    const st = game.state;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    text(c, '📸 Das war\'s!', W / 2, 130, 60, '#ffd60a');
    let y = 200;
    if (game.cfg.wertung) {
      const best = Math.max(0, ...st.players.map(id => st.score[id] || 0));
      st.players.slice().sort((a, b) => (st.score[b] || 0) - (st.score[a] || 0)).slice(0, 6).forEach((id, i) => {
        text(c, (best > 0 && st.score[id] === best ? '🏆 ' : '') + nm(id) + ' · ' + (st.score[id] || 0) + (st.score[id] === 1 ? ' Punkt' : ' Punkte'), W / 2, y + i * 34, 24, col(id));
      });
      y += Math.min(6, st.players.length) * 34 + 10;
    }
    // a strip of what was photographed
    const refs = Object.keys(pics).map(Number).filter(r => ready(pics[r].img)).slice(-7), n = refs.length, s = Math.min(120, (W - 60) / Math.max(1, n) - 10);
    refs.forEach((r, i) => frame(c, pics[r].img, (W - n * (s + 10) + 10) / 2 + i * (s + 10), Math.max(y, 330), s, s));
    text(c, '⭐ Host kann am Handy nochmal starten · 💾 oben speichert die Fotos', W / 2, H - 50, 17, 'rgba(255,255,255,.6)', 'normal');
  }

  function draw(now) {
    const c = ctx, st = game.state, ph = st.phase;
    c.fillStyle = '#15131f'; c.fillRect(0, 0, W, H);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    text(c, '📸 Fotosalat', 18, 28, 22);
    text(c, GAMES[game.cfg.spiel] + (ph.round ? ' · Runde ' + ph.round + ' von ' + st.rounds : ''), 18, 54, 15, 'rgba(255,255,255,.6)', 'normal');
    if (ph.kind === 'show') drawShow(c, ph, now);
    else if (ph.kind === 'gallery') drawGallery(c, ph);
    else if (ph.kind === 'riddle') drawRiddle(c, ph, now);
    else if (ph.kind === 'over') drawOver(c);
    else drawShoot(c, ph, now);
    if (ph.kind !== 'over') {
      c.textAlign = 'right'; c.textBaseline = 'middle';
      text(c, ph.kind === 'show' || ph.kind === 'gallery' || ph.kind === 'riddle' ? 'Host tippt am Handy weiter ⏭' : 'Host kann am Handy weitermachen ⏭ oder abbrechen ✕', W - 14, H - 14, 13, 'rgba(255,255,255,.55)', 'normal');
    }
  }

  // ---------- 💾: alle Fotos als ein Bild ----------
  function album() {
    const st = game.state, blocks = [];
    st.pairs.forEach(p => blocks.push({ imgs: [tplImg(p.tpl), pic(p.shot)], cap: (p.tpl.art !== undefined ? ART[p.tpl.art].title : 'Pose von ' + nm(p.tpl.by)) + ' · ' + nm(p.by) }));
    st.galleries.forEach(g => g.items.forEach(it => blocks.push({ imgs: [pic(it.ref)], cap: '„' + TASKS[g.task] + '“ · ' + nm(it.id) })));
    st.riddles.forEach(it => blocks.push({ imgs: [pic(it.ref)], cap: 'Zoom-Rätsel · ' + nm(it.id) }));
    return blocks;
  }
  const loaded = () => album().filter(b => b.imgs.every(ready));
  function buildCanvas() {
    const blocks = loaded(), S = 300, G = 14, CW = 1280, cv2 = document.createElement('canvas');
    let x = G, y = 70 + G;
    const pos = blocks.map(b => { const w = b.imgs.length * S + (b.imgs.length - 1) * 4; if (x + w + G > CW) { x = G; y += S + 44; } const p = { x, y }; x += w + G; return p; });
    cv2.width = CW; cv2.height = y + S + 54;
    const c = cv2.getContext('2d');
    c.fillStyle = '#15131f'; c.fillRect(0, 0, cv2.width, cv2.height);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    text(c, '📸 Fotosalat', G, 40, 36);
    blocks.forEach((b, i) => {
      b.imgs.forEach((img, k) => frame(c, img, pos[i].x + k * (S + 4), pos[i].y, S, S));
      c.textAlign = 'left'; text(c, b.cap, pos[i].x + 4, pos[i].y + S + 18, 18, 'rgba(255,255,255,.85)', 'bold', b.imgs.length * S);
    });
    return cv2;
  }

  return {
    acceptsJoin: true,            // who comes later takes photos from the running round on
    start(ids, config) {
      R = window.FotoRules; ART = window.FotoArt || []; TASKS = window.FotoTasks || [];
      if (!R || !ART.length || !TASKS.length) { endToLobby('Fotosalat konnte nicht geladen werden 😢'); return; }
      cfg = config || {};
      game = null; newGame();
      ids.forEach(id => game.join(id));
      game.start(ms());
      started = true;
    },
    stop() { started = false; pics = {}; },
    onConnect(id) { if (started) game.join(id); },
    onDisconnect(id) {
      if (!started || !game.state.players.includes(id)) return;
      game.leave(id, ms());
      if (!game.state.players.length) endToLobby('Alle Fotografen sind weg.');
    },
    canResume(id) { return started && game.state.players.includes(id); },
    onReconnect() {},              // the phone says fsHello as soon as it is back in the game; that answer carries everything
    onMessage(id, d) {
      if (!d || !started || !game.state.players.includes(id)) return;
      const now = ms(), host = id === hostId();
      if (d.t === 'fsHello') { remember(); sendState(id, true); }
      else if (d.t === 'fsPhoto') {
        if (typeof d.url !== 'string' || d.url.length > MAX_URL || d.url.indexOf('data:image/jpeg;base64,') !== 0) return;
        const ref = store(d.url), r = game.photo(id, ref, now);
        if (!r.ok) delete pics[ref]; else { if (r.old !== undefined) delete pics[r.old]; sfx('pop'); }
      }
      else if (d.t === 'fsFocus') game.focus(id, +d.x, +d.y);
      else if (d.t === 'fsHeart') { if (game.heart(id)) { sfx('tick'); floaters.push({ at: now, x: 560 + Math.random() * 290 }); } }
      else if (d.t === 'fsVote') { if (game.vote(id, d.id | 0)) sfx('tick'); }
      else if (d.t === 'fsGuess') game.guess(id, d.id | 0, now);
      else if (d.t === 'fsNext' && host) game.skip(now);
      else if (d.t === 'fsAgain' && host && game.state.over) { newGame(); game.start(ms()); }
    },
    render() {
      if (!started) return;
      const now = ms();
      game.step(now);
      if (game.state.rev !== sentRev) { sentRev = game.state.rev; notice(); sendAll(); }
      draw(now);
    },
    canSave() { return started && album().length > 0 && ['show', 'gallery', 'riddle', 'over'].includes(game.state.phase.kind); },
    save() { if (!loaded().length) return; const a = document.createElement('a'); a.href = buildCanvas().toDataURL('image/jpeg', 0.9); a.download = 'fotosalat.jpg'; a.click(); },
    _debug() { return { game, state: game && game.state, pics, album, buildCanvas }; }
  };
}});
