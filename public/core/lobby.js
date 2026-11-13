// Party Hub Lobby (Fernseher): das Startmenü als Schaufenster.
// Groß das Spiel, das der Host am Handy gerade ansieht, mit Bild, einem Satz dazu und den Einstellungen;
// darunter ein Filmstreifen mit den Nachbarn; rechts Beitritts-Code, Spieler, Wünsche und Abend-Wertung.
// Jeder kann am Handy blättern und Spiele wünschen (👍); die Wünsche erscheinen hier in Spielerfarbe.
// Solange noch niemand da ist, blättert der Fernseher von selbst durch die Spiele.
//
// Nur auf der Screen-Seite geladen, direkt nach dem Shell-Skript: benutzt dessen Zustand (players, shell,
// GAME_LIST, qrCanvas, …) und stellt renderLobby() und lobbyToast() bereit. Bilder: covers/<key>.jpg (16:10);
// fehlt eins, steht dort das Emoji des Spiels auf einer Farbfläche. Wie die Bilder entstehen: docs/LOBBY.md.
(function () {
  const W = 960, H = 600;
  const IDLE_MS = 7000;                     // nobody here yet: show each game this long
  const FADE_MS = 280;                      // cross-fade when the big picture changes
  const CX = 24, CY = 64, CW = 592, CH = 370;            // the big cover
  const TW = 124, TH = 78, TGAP = 10, TY = 448;          // filmstrip tiles
  const RX = 634, RW = 302;                              // right column
  const FONT = (px, w) => (w || 'bold') + ' ' + px + 'px system-ui,sans-serif';
  const mod = (a, n) => ((a % n) + n) % n;

  const covers = {};
  function cover(key) {
    if (!covers[key]) { covers[key] = new Image(); covers[key].src = 'covers/' + key + '.jpg'; }
    return covers[key];
  }
  const ready = (im) => !!im && im.complete && im.naturalWidth > 0;
  const emojiOf = (g) => String(g.label || '').split(' ')[0];
  const hue = (key) => { let h = 7; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360; return h; };

  // the games in the order the phones list them: by category, then as registered
  let ordered = [], orderedFor = -1;
  function order() {
    if (orderedFor !== GAME_LIST.length) {
      const cats = (window.GAME_CATS || []).map(c => c.key), ci = (g) => Math.max(0, cats.indexOf(g.cat));
      ordered = GAME_LIST.map((g, i) => ({ g, i })).sort((a, b) => ci(a.g) - ci(b.g) || a.i - b.i).map(x => x.g);
      orderedFor = GAME_LIST.length;
    }
    return ordered;
  }
  window.lobbyOrder = order;

  let toasts = [];
  window.lobbyToast = function (text, color) { toasts.push({ text, color: color || '#fff', until: performance.now() + 2800 }); if (toasts.length > 3) toasts.shift(); };

  function text(c, s, x, y, px, color, weight, max) {
    c.fillStyle = color || '#fff';
    if (max) fitFont(c, s, max, px); else c.font = FONT(px, weight);
    c.fillText(s, x, y);
  }
  function card(c, x, y, w, h) { rr(c, x, y, w, h, 14); c.fillStyle = 'rgba(255,255,255,.055)'; c.fill(); }
  // a game's picture, filling the box; without a picture: its emoji on a colour of its own
  function picture(c, g, x, y, w, h, r) {
    const im = cover(g.key);
    c.save(); rr(c, x, y, w, h, r); c.clip();
    if (ready(im)) {
      const k = Math.max(w / im.naturalWidth, h / im.naturalHeight), dw = im.naturalWidth * k, dh = im.naturalHeight * k;
      c.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      const gr = c.createLinearGradient(x, y, x + w, y + h), hu = hue(g.key);
      gr.addColorStop(0, 'hsl(' + hu + ',55%,34%)'); gr.addColorStop(1, 'hsl(' + ((hu + 50) % 360) + ',60%,16%)');
      c.fillStyle = gr; c.fillRect(x, y, w, h);
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.font = FONT(h * 0.5); c.fillText(emojiOf(g), x + w / 2, y + h / 2);
    }
    c.restore();
  }
  function chip(c, s, x, y, bg, fg) {
    c.font = FONT(14); const w = c.measureText(s).width + 20;
    rr(c, x, y, w, 26, 13); c.fillStyle = bg; c.fill();
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = fg || '#fff'; c.fillText(s, x + 10, y + 13.5);
    return w + 8;
  }
  // the host's settings for the chosen game, as one line
  function settingsLine(key) {
    const schema = (GAME_META[key] || {}).settings || {}, cfg = cfgFor(key);
    return Object.keys(schema).map(f => {
      const def = schema[f], v = cfg[f];
      if (def.when && !Object.entries(def.when).every(([k, val]) => cfg[k] === val)) return null;
      if (def.type === 'choice') { const o = (def.options || []).find(o => o.v === v); return o ? o.label : v; }
      if (def.type === 'text') { const s = String(v || ''); return s ? (s.length > 40 ? s.slice(0, 39) + '…' : s) : null; }
      return def.label + ' ' + v + (def.unit || '');
    }).filter(Boolean).join(' · ');
  }
  const wishers = (key) => Object.keys(shell.wishes || {}).map(Number).filter(id => players[id] && shell.wishes[id].includes(key));

  let shownKey = null, prevKey = null, changedAt = 0, stripPos = null, lastT = 0;

  function drawCover(c, g, alpha, hasHost) {
    c.globalAlpha = alpha;
    picture(c, g, CX, CY, CW, CH, 18);
    c.save(); rr(c, CX, CY, CW, CH, 18); c.clip();
    const sh = c.createLinearGradient(0, CY + CH * 0.42, 0, CY + CH);
    sh.addColorStop(0, 'rgba(8,6,16,0)'); sh.addColorStop(0.55, 'rgba(8,6,16,.78)'); sh.addColorStop(1, 'rgba(8,6,16,.94)');
    c.fillStyle = sh; c.fillRect(CX, CY, CW, CH);
    c.restore();
    const cat = (window.GAME_CATS || []).find(k => k.key === g.cat), line = hasHost ? settingsLine(g.key) : '';
    let y = CY + CH - (line ? 118 : 96), x = CX + 22;
    if (cat) x += chip(c, cat.label, x, y - 36, 'rgba(191,90,242,.92)');
    chip(c, 'ab ' + (g.min || 1) + (g.min > 1 ? ' Spielern' : ' Spieler'), x, y - 36, 'rgba(255,255,255,.2)');
    c.textAlign = 'left'; c.textBaseline = 'middle';
    text(c, g.label, CX + 22, y + 18, 40, '#fff', 'bold', CW - 44);
    if (g.about) text(c, g.about, CX + 22, y + 56, 19, 'rgba(255,255,255,.88)', 'normal', CW - 44);
    if (line) text(c, '⚙️ ' + line, CX + 22, y + 86, 14, 'rgba(255,255,255,.6)', 'normal', CW - 44);
    c.globalAlpha = 1;
  }

  window.renderLobby = function () {
    const c = ctx, now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    const list = order(), n = list.length, named = namedIds().sort((a, b) => players[a].seq - players[b].seq), h = hostId();
    const hasHost = named.length > 0;
    const sel = (hasHost ? list.find(g => g.key === shell.selected) : null) || list[Math.floor(now / IDLE_MS) % n];
    if (sel.key !== shownKey) { prevKey = shownKey; shownKey = sel.key; changedAt = now; }

    const bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#17142b'); bg.addColorStop(1, '#0b0a14');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    text(c, '🎉 Party Hub', 24, 34, 28);
    c.font = FONT(28); const tw = c.measureText('🎉 Party Hub').width;
    text(c, n + ' Spiele' + (hasHost ? '' : ' · blättert von selbst, bis jemand mitspielt'), 24 + tw + 16, 37, 15, 'rgba(255,255,255,.5)', 'normal');

    // ---- the big picture, cross-fading from the one before ----
    const fade = Math.min(1, (now - changedAt) / FADE_MS), prev = prevKey && list.find(g => g.key === prevKey);
    if (fade < 1 && prev) drawCover(c, prev, 1, hasHost);
    drawCover(c, sel, fade < 1 && prev ? fade : 1, hasHost);
    // who wished for it
    const fans = wishers(sel.key);
    if (fans.length) {
      let x = CX + CW - 16;
      c.font = FONT(15);
      fans.slice(0, 6).reverse().forEach(id => { const s = shortName(id), w = c.measureText(s).width + 20; x -= w; rr(c, x, CY + 14, w, 28, 14); c.fillStyle = players[id].color; c.fill(); c.textAlign = 'left'; c.fillStyle = '#10141a'; c.fillText(s, x + 10, CY + 28.5); x -= 6; });
      x -= 34; rr(c, x, CY + 14, 34, 28, 14); c.fillStyle = 'rgba(8,6,16,.7)'; c.fill(); c.textAlign = 'center'; c.fillStyle = '#fff'; c.fillText('👍', x + 17, CY + 28.5);
    }

    // ---- filmstrip: the neighbours, the chosen one in the middle ----
    const idx = list.indexOf(sel);
    if (stripPos === null) stripPos = idx;
    const d = mod(idx - stripPos + n / 2, n) - n / 2;
    stripPos = Math.abs(d) < 0.002 ? idx : mod(stripPos + d * Math.min(1, dt * 9), n);
    const base = Math.round(stripPos);
    c.save(); c.beginPath(); c.rect(0, TY - 8, W, TH + 40); c.clip();
    for (let k = -5; k <= 5; k++) {
      const i = base + k, g = list[mod(i, n)], off = (i - stripPos) * (TW + TGAP), x = W / 2 + off - TW / 2, on = mod(i, n) === idx;
      if (x < -TW || x > W) continue;
      c.globalAlpha = on ? 1 : Math.max(0.3, 0.72 - Math.abs(off) / 1400);
      picture(c, g, x, TY, TW, TH, 10);
      if (on) { rr(c, x - 2, TY - 2, TW + 4, TH + 4, 12); c.strokeStyle = '#ffd60a'; c.lineWidth = 3; c.stroke(); }
      c.textAlign = 'center'; c.textBaseline = 'middle';
      text(c, g.label, x + TW / 2, TY + TH + 15, 12, on ? '#ffd60a' : '#fff', 'bold', TW);
      wishers(g.key).slice(0, 5).forEach((id, j) => { c.beginPath(); c.arc(x + TW - 10 - j * 13, TY + 11, 6, 0, Math.PI * 2); c.fillStyle = players[id].color; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#0b0a14'; c.stroke(); });
    }
    c.restore(); c.globalAlpha = 1;

    // ---- right column: join, players, wishes, the evening's score ----
    let y = CY;
    if (qrCanvas) {
      const qs = Math.min(150, qrCanvas.width);
      card(c, RX, y, RW, qs + 20);
      c.imageSmoothingEnabled = false; c.drawImage(qrCanvas, RX + 10, y + 10, qs, qs); c.imageSmoothingEnabled = true;
      c.textAlign = 'left'; c.textBaseline = 'middle';
      text(c, '📱 Mitspielen', RX + qs + 22, y + 34, 18);
      text(c, 'Handy-Kamera auf', RX + qs + 22, y + 64, 13, 'rgba(255,255,255,.65)', 'normal');
      text(c, 'den Code halten', RX + qs + 22, y + 82, 13, 'rgba(255,255,255,.65)', 'normal');
      text(c, joinUrl.replace(/^https?:\/\//, '').replace(/\/controller\.html$/, ''), RX + qs + 22, y + 114, 13, '#ffd60a', 'bold', RW - qs - 32);
      text(c, '/controller.html', RX + qs + 22, y + 132, 12, 'rgba(255,255,255,.5)', 'normal', RW - qs - 32);
      y += qs + 30;
    }
    const joining = connectedIds().length - named.length, two = named.length > 5, rows = two ? Math.ceil(named.length / 2) : named.length;
    const ph = 38 + Math.max(1, rows) * 24 + (joining > 0 ? 20 : 0);
    card(c, RX, y, RW, ph);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    text(c, hasHost ? 'Spieler · ' + named.length : 'Noch niemand da', RX + 14, y + 20, 15, 'rgba(255,255,255,.6)');
    named.slice(0, 12).forEach((id, i) => {
      const px = RX + 14 + (two ? Math.floor(i / rows) * (RW / 2 - 6) : 0), py = y + 46 + (two ? i % rows : i) * 24;
      c.beginPath(); c.arc(px + 7, py, 7, 0, Math.PI * 2); c.fillStyle = players[id].color; c.fill();
      c.textAlign = 'left'; text(c, (two ? shortName(id) : nameOf(id)) + (id === h ? ' ⭐' : ''), px + 22, py + 1, 16, '#fff', 'bold', (two ? RW / 2 : RW) - 44);
    });
    if (!hasHost) text(c, 'Code scannen, Namen tippen, los.', RX + 14, y + 47, 14, 'rgba(255,255,255,.7)', 'normal', RW - 28);
    if (joining > 0) text(c, joining + ' tippt noch einen Namen …', RX + 14, y + ph - 16, 13, 'rgba(255,255,255,.5)', 'normal');
    y += ph + 10;
    // the most wished-for games
    const tally = {}; Object.keys(shell.wishes || {}).forEach(id => { if (players[id]) shell.wishes[id].forEach(k => { tally[k] = (tally[k] || 0) + 1; }); });
    const top = Object.keys(tally).filter(k => GAME_META[k]).sort((a, b) => tally[b] - tally[a]).slice(0, 3);
    if (top.length && y + 34 + top.length * 22 < TY - 14) {
      card(c, RX, y, RW, 34 + top.length * 22);
      text(c, '👍 Gewünscht', RX + 14, y + 19, 15, 'rgba(255,255,255,.6)');
      top.forEach((k, i) => { c.textAlign = 'left'; text(c, GAME_META[k].label, RX + 14, y + 43 + i * 22, 15, '#fff', 'bold', RW - 70); c.textAlign = 'right'; text(c, '× ' + tally[k], RX + RW - 14, y + 43 + i * 22, 15, '#ffd60a'); });
      y += 44 + top.length * 22;
    }
    const st = nightStandings().slice(0, Math.max(0, Math.floor((TY - 14 - y - 34) / 22)));
    if (st.length) {
      card(c, RX, y, RW, 34 + st.length * 22);
      c.textAlign = 'left'; text(c, '🏆 Abend-Wertung', RX + 14, y + 19, 15, '#ffd60a');
      st.forEach((e, i) => { c.textAlign = 'left'; text(c, e.name, RX + 14, y + 43 + i * 22, 15, i ? 'rgba(255,255,255,.75)' : '#fff', 'bold', RW - 70); c.textAlign = 'right'; text(c, String(e.pts), RX + RW - 14, y + 43 + i * 22, 15, i ? 'rgba(255,255,255,.75)' : '#fff'); });
    }

    // ---- what happens next ----
    const need = minFor(sel.key), ok = named.length >= need;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    text(c, !hasHost ? '📱 Scannt den Code und spielt mit'
      : ok ? '⭐ ' + nameOf(h) + ' wählt am Handy und tippt START · alle können blättern und 👍 wünschen'
      : 'Mindestens ' + need + ' Spieler für ' + sel.label + ' · noch ' + (need - named.length), W / 2, H - 22, 17, !hasHost ? '#ffd60a' : ok ? '#30d158' : '#ff9f0a', 'bold', W - 60);

    // the latest wish, top right above the join card
    toasts = toasts.filter(t => t.until > now);
    const t = toasts[toasts.length - 1];
    if (t) {
      c.globalAlpha = Math.min(1, (t.until - now) / 400);
      c.textAlign = 'right'; c.textBaseline = 'middle';
      text(c, t.text, W - 24, 36, 17, t.color, 'bold', W - 24 - (24 + tw + 110));
    }
    c.globalAlpha = 1;
  };
})();
