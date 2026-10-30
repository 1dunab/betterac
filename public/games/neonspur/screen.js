// ===== Modul: NEONSPUR (3D light cycles) — TV glue =====
// Verbindet sim.js (Regeln), render.js (three.js) und die Handys. Contract: docs/NEONSPUR.md.
// Der WebGL-Canvas der View wird jede Frame in den Shell-Canvas `cv` geblittet (Mitschauen!),
// darüber zeichnet dieses Modul das HUD (Namen, Punkte, Minimap, Banner).

// ---- File scope: eine View für alle Spiele (kein WebGL-Context-Leak) ----
let nsView = null, nsViewCtor = null;

registerGame({ key: 'neonspur', screen: function () {
  // ---------- Konstanten ----------
  const COUNTDOWN_MS = 3000, ROUND_OVER_MS = 3200, GO_FLASH_MS = 800;
  const MAX_RIDERS = 4;
  const BOTS = [
    { pid: -1, name: '🤖 Volt' }, { pid: -2, name: '🤖 Pixel' }, { pid: -3, name: '🤖 Blitz' }
  ];
  const NEON = ['#00ffd0', '#ff2bd6', '#c8ff00', '#ff7a00', '#8a7bff'];
  const HUE_GAP = 35;                    // Bot-Farbe mind. so weit von Menschen entfernt
  const FONT = (px) => 'bold ' + px + 'px system-ui,sans-serif';
  const HUD = { tag: 24, small: 18, strip: 20, banner: 46, count: 230, mini1: 150, mini2: 116, mini4: 124, mmCell: 3 };

  // ---------- Zustand ----------
  let cfg = {}, THREE_ = null, Sim = null, Maps = null, View = null, view = null;
  let phase = 'idle';                    // countdown | live | roundOver | final
  let seats = [], spectators = [], wins = {}, cams = {}, follow = {};
  let riders = [], riderOf = {}, sim = null, mapDef = null, round = 0;
  let acc = 0, last = 0, phaseAt = 0, liveAt = 0, cdN = 3, lastHost = null;
  let roundWinner = null, matchWinner = null, reported = false;
  let cdPending = {}, soundSeen = {}, timers = [], mm = null, botColor = {};
  let extras = true, feed = [], youSent = {}, held = {}, lastBoostSnd = -1e9;
  const KIND = { boost: { icon: '🔋', color: '#ffe14d' }, jump: { icon: '🦘', color: '#7dff6a' }, shield: { icon: '🛡️', color: '#4da3ff' }, blast: { icon: '💥', color: '#ff5a3c' } };
  const FEED_MAX = 4, FEED_MS = 4000, BOOST_SEND_MS = 166;

  // ---------- Helfer ----------
  const botName = (pid) => (BOTS.find((b) => b.pid === pid) || {}).name || '🤖';
  const nameP = (pid) => pid < 0 ? botName(pid) : nameOf(pid);
  const shortP = (pid) => pid < 0 ? botName(pid) : shortName(pid);
  const colorP = (pid) => pid < 0 ? (botColor[pid] || '#fff') : ((players[pid] && players[pid].color) || '#fff');
  const send = (id, m) => { try { ac.message(id, m); } catch (e) {} };
  const known = () => seats.concat(spectators);
  const later = (fn, ms) => { const t = setTimeout(() => { timers = timers.filter((x) => x !== t); fn(); }, ms); timers.push(t); };

  function hue(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return -999;
    const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 0.08) return -999;           // fast grau: kollidiert mit nichts
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  const hueNear = (a, b) => { const x = hue(a), y = hue(b); if (x < -900 || y < -900) return false; const d = Math.abs(x - y); return Math.min(d, 360 - d) < HUE_GAP; };

  function pickBotColors(nBots, humanColors) {
    const used = humanColors.slice(), out = [];
    for (let i = 0; i < nBots; i++) {
      let c = NEON.find((n) => !used.some((u) => hueNear(n, u)));
      if (!c) c = NEON.find((n) => !used.includes(n)) || NEON[i % NEON.length];
      used.push(c); out.push(c);
    }
    return out;
  }

  function dropView() { nsView = null; nsViewCtor = null; }
  function ensureView() {
    const T = window.THREE, C = window.NeonspurView;
    if (!T || !C) return null;
    if (nsView && nsViewCtor === C) return nsView;
    try { if (nsView && nsView.dispose) nsView.dispose(); } catch (e) {}
    dropView();
    try { nsView = new C(T, { width: cv.width, height: cv.height, quality: cfg.quality === 'low' ? 'low' : 'high' }); nsViewCtor = C; } catch (e) { dropView(); return null; }
    return nsView;
  }

  // ---------- Phone-Protokoll ----------
  function infoFor(id) {
    return { t: 'nsInfo', rider: seats.includes(id), color: colorP(id), cam: cams[id] || 'pov', camToggle: cfg.camera !== 'overview', host: id === hostId(), target: cfg.target, extras };
  }
  function phaseFor(id) {
    return { t: 'nsPhase', phase, n: phase === 'countdown' ? cdN : 0, round, wins: wins[id] || 0,
      winner: roundWinner != null ? nameP(roundWinner) : null,
      champion: matchWinner != null ? nameP(matchWinner) : null, host: id === hostId() };
  }
  const sendInfoAll = () => known().forEach((id) => send(id, infoFor(id)));
  const sendPhaseAll = () => known().forEach((id) => send(id, phaseFor(id)));
  const humanRiders = () => riders.filter((r) => !r.bot && !r.auto);
  const r2 = (v) => Math.round(v * 100) / 100;

  // nsYou immer vollständig (Phone setzt Felder sonst zurück); merkt sich den gesendeten Stand für die Drosselung
  function sendYou(r, over) {
    const s = r.sr, now = performance.now();
    const m = Object.assign({ t: 'nsYou', alive: s.alive, jumpIn: Math.max(0, s.jumpReadyAt - sim.state.time), killer: null,
      boost: extras ? r2(s.boost || 0) : 0, shield: extras && !!s.shield }, over || {});
    youSent[r.pid] = { boost: m.boost, shield: m.shield, at: now };
    send(r.pid, m);
  }
  function syncYou(now) {
    if (!extras) return;
    for (const r of humanRiders()) {
      if (!r.sr.alive) continue;
      const b = r2(r.sr.boost || 0), sh = !!r.sr.shield, o = youSent[r.pid];
      if (!o) { sendYou(r); continue; }
      const edge = (b === 0 && o.boost !== 0) || (b >= 0.98 && o.boost < 0.98);
      if (sh !== o.shield || edge || (Math.abs(b - o.boost) >= 0.05 && now - o.at >= BOOST_SEND_MS)) sendYou(r);
    }
  }
  function pushFeed(text, color) {
    feed.push({ text, color, at: performance.now() });
    if (feed.length > FEED_MAX) feed.shift();
  }

  function killerName(by) {
    if (typeof by === 'number') return nameP(by);
    if (by === 'self') return 'deine eigene Spur';
    if (by === 'wall' || by === 'edge') return 'eine Wand';
    if (by === 'head') return 'Frontalcrash';
    return null;
  }

  // ---------- Runde starten ----------
  function startRound() {
    // Wartende nachrücken lassen (Join mitten im Match), Verschwundene raus
    seats = seats.filter((id) => players[id]);
    spectators = spectators.filter((id) => players[id] && !seats.includes(id));
    while (seats.length < MAX_RIDERS && spectators.length) seats.push(spectators.shift());
    if (!seats.length) { endToLobby('⚡ Neonspur: alle Fahrer sind weg.'); return; }

    let nb = Math.min(cfg.bots | 0, MAX_RIDERS - seats.length);
    if (seats.length + nb < 2) nb = 2 - seats.length;
    const botList = BOTS.slice(0, nb);
    const cols = pickBotColors(nb, seats.map(colorP));
    botColor = {}; botList.forEach((b, i) => { botColor[b.pid] = cols[i]; });

    const list = seats.map((id) => ({ pid: id, human: true, auto: !!cfg.autopilot }))
      .concat(botList.map((b) => ({ pid: b.pid, human: false, auto: false })));
    shuffle(list);                       // Startpositionen rotieren

    const defs = Maps || [];
    mapDef = cfg.map === 'random' ? defs[(Math.random() * defs.length) | 0] : (defs.find((m) => m.key === cfg.map) || defs[0]);
    extras = cfg.extras !== 'off';
    sim = Sim.create({
      map: Sim.parseMap(mapDef),
      riders: list.map((r) => ({ pid: r.pid, bot: !r.human || r.auto, botLevel: r.human ? 'normal' : cfg.botLevel })),
      tempo: cfg.tempo, extras, seed: ((Math.random() * 0x7fffffff) | 0) || 1
    });
    riders = list.map((r, i) => ({ pid: r.pid, bot: !r.human, auto: r.auto, color: colorP(r.pid), name: nameP(r.pid), short: shortP(r.pid), sr: sim.state.riders[i] }));
    riderOf = {}; riders.forEach((r) => { riderOf[r.pid] = r; if (wins[r.pid] == null) wins[r.pid] = 0; });
    const look = {}; riders.forEach((r) => { look[r.pid] = { color: r.color, name: r.short }; });
    try { view.setRound(sim.state, look); } catch (e) {}

    round++; roundWinner = null; follow = {}; cdPending = {}; feed = []; youSent = {}; held = {};
    initMinimap();
    phase = 'countdown'; phaseAt = performance.now(); cdN = 3; acc = 0; last = phaseAt;
    sendInfoAll(); sendPhaseAll();
    humanRiders().forEach((r) => sendYou(r, { alive: true, jumpIn: 0, killer: null }));
    sfx('beep');
  }

  function toLive(now) {
    phase = 'live'; liveAt = now; acc = 0; last = now;
    sfx('go'); sendPhaseAll();
  }

  function endRound(winner) {
    phase = 'roundOver'; phaseAt = performance.now(); roundWinner = winner;
    if (winner != null) {
      wins[winner] = (wins[winner] || 0) + 1;
      if (wins[winner] >= cfg.target) matchWinner = winner;
      sfx('coin');
    } else sfx('sad');
    sendPhaseAll();
  }

  function toFinal() {
    phase = 'final'; phaseAt = performance.now();
    if (matchWinner != null && matchWinner > 0 && !reported) { reported = true; try { reportWinners([matchWinner]); } catch (e) {} }
    sfx('fanfare'); sendPhaseAll();
  }

  function newMatch() {
    wins = {}; matchWinner = null; reported = false; round = 0;
    startRound();
  }

  // ---------- Events ----------
  function playOnce(name) { if (!soundSeen[name]) { soundSeen[name] = 1; sfx(name); } }
  function handleEvents(events) {
    const st = sim.state;
    for (const ev of events) {
      try { view.event(ev, st); } catch (e) {}
      const r = riderOf[ev.pid];
      if (ev.t === 'jump') {
        playOnce(ev.pad ? 'powerup' : 'whoosh');
        if (r && !r.bot && !r.auto && !ev.pad) {
          sendYou(r);
          cdPending[r.pid] = true;
        }
      } else if (ev.t === 'land' || ev.t === 'drop') playOnce('thud');
      else if (ev.t === 'crash') {
        playOnce('explosion');
        if (r && !r.bot && !r.auto) sendYou(r, { alive: false, jumpIn: 0, killer: killerName(ev.by), boost: 0, shield: false });
        if (r) {
          const by = ev.by;
          if (typeof by === 'number') pushFeed(r.short + ' ✖ ' + shortP(by) + 's Spur', r.color);
          else if (by === 'self') pushFeed(r.short + ' ✖ eigene Spur', r.color);
          else if (by === 'wall' || by === 'edge') pushFeed(r.short + ' ✖ Wand', r.color);
          else if (by === 'head') pushFeed(r.short + ' ✖ Frontalcrash', r.color);
        }
      } else if (ev.t === 'item' && r) {
        playOnce('powerup');
        if (!r.bot && !r.auto) send(r.pid, { t: 'nsItem', kind: ev.kind });
        const k = KIND[ev.kind] || KIND.boost;
        pushFeed(k.icon + ' ' + r.short, r.color);
      } else if (ev.t === 'shield' && r) {
        playOnce('hit'); pushFeed('🛡️ ' + r.short + ' bricht durch', r.color);
      } else if (ev.t === 'blast' && r) {
        playOnce('explosion'); pushFeed('💥 ' + r.short, r.color);
      } else if (ev.t === 'boost' && ev.on) {
        const t = performance.now();
        if (t - lastBoostSnd >= 1500) { lastBoostSnd = t; playOnce('whoosh'); }
      } else if (ev.t === 'over' && phase !== 'roundOver' && phase !== 'final') endRound(ev.winner);
    }
  }

  // ---------- Kamera-Ziele ----------
  function viewTarget(id) {
    const me = riderOf[id];
    if (!me) return id;
    if (me.sr.alive) { delete follow[id]; return id; }
    const f = follow[id] && riderOf[follow[id]];
    if (f && f.sr.alive) return f.pid;
    const killer = typeof me.sr.killer === 'number' ? riderOf[me.sr.killer] : null;
    let pick = killer && killer.sr.alive ? killer : null;
    if (!pick) pick = riders.find((r) => r.sr.alive && !r.bot) || riders.find((r) => r.sr.alive);
    if (!pick) return id;
    follow[id] = pick.pid; return pick.pid;
  }
  function currentViews() {
    if (cfg.camera === 'overview' || phase === 'roundOver' || phase === 'final') return { layout: 'overview', views: [], ids: [] };
    const ids = riders.filter((r) => !r.bot).map((r) => r.pid).filter((id) => seats.includes(id)).slice(0, MAX_RIDERS);
    // Sitzreihenfolge (nicht Shuffle-Reihenfolge)
    ids.sort((a, b) => seats.indexOf(a) - seats.indexOf(b));
    return { layout: 'split', ids, views: ids.map((id) => ({ pid: viewTarget(id), cam: cams[id] || 'pov' })) };
  }

  // ---------- Minimap ----------
  function initMinimap() {
    mm = null;
    try {
      const m = sim.state.map, c = document.createElement('canvas'), px = HUD.mmCell;
      c.width = m.w * px; c.height = m.h * px;
      const g = c.getContext('2d'), th = m.theme || {};
      g.fillStyle = '#080a16'; g.fillRect(0, 0, c.width, c.height);
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const i = y * m.w + x;
        if (m.wall[i]) g.fillStyle = '#56628f';
        else if (m.pad[i]) g.fillStyle = '#7dffe6';
        else if (m.floor[i] >= 1) g.fillStyle = '#26315e';
        else if (m.floor[i] > 0) g.fillStyle = '#1a2348';
        else continue;
        g.fillRect(x * px, y * px, px, px);
      }
      mm = { c, g, px, drawn: {}, w: m.w, h: m.h };
    } catch (e) { mm = null; }
  }
  function updateMinimap() {
    if (!mm) return;
    for (const r of riders) {
      const tr = r.sr.trail, from = mm.drawn[r.pid] || 0;
      if (tr.length === from) continue;
      mm.g.fillStyle = r.color;
      for (let i = from; i < tr.length; i++) mm.g.fillRect(tr[i][0] * mm.px, tr[i][1] * mm.px, mm.px, mm.px);
      mm.drawn[r.pid] = tr.length;
    }
  }
  function drawMinimap(x, y, S) {
    if (!mm) return;
    ctx.save();
    ctx.fillStyle = 'rgba(4,6,16,.8)'; rr(ctx, x - 5, y - 5, S + 10, S + 10, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(160,190,255,.5)'; ctx.lineWidth = 2; ctx.stroke();
    const k = S / Math.max(mm.w, mm.h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mm.c, x, y, mm.w * k, mm.h * k);
    if (extras && sim) for (const t of sim.state.items) {
      ctx.fillStyle = (KIND[t.kind] || KIND.boost).color; ctx.strokeStyle = 'rgba(0,0,12,.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x + (t.x + 0.5) * k, y + (t.y + 0.5) * k, 3, 0, 7); ctx.fill(); ctx.stroke();
    }
    for (const r of riders) {
      const s = r.sr;
      const cx = x + (s.x + 0.5) * k, cy = y + (s.y + 0.5) * k;
      if (s.alive) {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.fill();
        ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 7); ctx.fill();
      } else {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(cx - 3, cy - 3); ctx.lineTo(cx + 3, cy + 3); ctx.moveTo(cx + 3, cy - 3); ctx.lineTo(cx - 3, cy + 3); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------- HUD ----------
  function txt(s, x, y, px, color, align) {
    ctx.font = FONT(px); ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, px / 5); ctx.strokeStyle = 'rgba(0,0,12,.85)';
    ctx.strokeText(s, x, y); ctx.fillStyle = color || '#fff'; ctx.fillText(s, x, y);
  }
  function panel(x, y, w, h, border, alpha) {
    ctx.fillStyle = 'rgba(4,6,18,' + (alpha == null ? 0.72 : alpha) + ')'; rr(ctx, x, y, w, h, 12); ctx.fill();
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 2.5; ctx.stroke(); }
  }

  function drawTags(vs) {
    const rects = View.layout(vs.views.length, 'split');
    vs.ids.forEach((id, i) => {
      const rc = rects[i], me = riderOf[id]; if (!rc || !me) return;
      const tgt = vs.views[i].pid, small = rects.length > 1;
      const px = small ? HUD.small + 2 : HUD.tag;
      ctx.font = FONT(px);
      const label = me.short + (extras && me.sr.alive && me.sr.shield ? ' 🛡️' : '');
      const w = ctx.measureText(label).width + 26, h = px + 12, x = rc.x + (rects.length === 4 && rc.x > 0 ? 76 : 12), y = rc.y + (rects.length === 4 && rc.y === 0 ? 46 : 12);   // 2x2: unter der Punkteleiste
      panel(x, y, w, h, me.color, 0.78);
      txt(label, x + 13, y + h / 2 + 1, px, me.color);
      // Sprung-Meter
      const ready = clampN(1 - (me.sr.jumpReadyAt - sim.state.time) / Sim.CONST.JUMP_CD_MS, 0, 1);
      const mx = x, my = y + h + 5, mw = Math.max(70, w);
      ctx.fillStyle = 'rgba(4,6,18,.72)'; rr(ctx, mx, my, mw, 10, 5); ctx.fill();
      if (me.sr.alive) {
        ctx.fillStyle = ready >= 1 ? '#fff' : me.color; rr(ctx, mx + 2, my + 2, Math.max(4, (mw - 4) * ready), 6, 3); ctx.fill();
        if (ready >= 1) txt('⤴', mx + mw + 6, my + 5, 16, '#fff');
      }
      if (extras) {   // Turbo-Meter darunter: Gold, glüht beim Boosten
        const ty = my + 14, b = me.sr.alive ? clampN(me.sr.boost || 0, 0, 1) : 0;
        ctx.fillStyle = 'rgba(4,6,18,.72)'; rr(ctx, mx, ty, mw, 10, 5); ctx.fill();
        if (b > 0) {
          if (me.sr.boosting) { ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 14; }
          ctx.fillStyle = me.sr.boosting ? '#fff3a0' : '#ffc400'; rr(ctx, mx + 2, ty + 2, Math.max(4, (mw - 4) * b), 6, 3); ctx.fill();
          ctx.shadowBlur = 0;
        }
        if (b >= 0.98) txt('🚀', mx + mw + 6, ty + 5, 14, '#fff');
      }
      if (tgt !== id && riderOf[tgt]) {
        const s = '💀 ' + me.short + ' — schaut ' + riderOf[tgt].short + ' zu';
        ctx.font = FONT(px); const sw = ctx.measureText(s).width + 30;
        const cx = rc.x + rc.w / 2, cy = rc.y + rc.h - 28;
        panel(cx - sw / 2, cy - (px + 12) / 2, sw, px + 12, riderOf[tgt].color, 0.8);
        txt(s, cx, cy + 1, px, '#fff', 'center');
      }
    });
    if (rects.length === 4 && vs.views.length === 3) txt('🗺️ Übersicht', rects[3].x + 14, rects[3].y + rects[3].h - 26, HUD.small, '#cfe0ff');
  }
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

  function drawStrip() {
    const target = cfg.target, pips = target <= 5;
    ctx.font = FONT(HUD.strip);
    const items = riders.map((r) => {
      const label = r.short, w = ctx.measureText(label).width + 26 + (pips ? target * 16 : ctx.measureText((wins[r.pid] || 0) + '/' + target).width + 8);
      return { r, label, w: w + 10 };
    });
    const total = items.reduce((a, b) => a + b.w + 8, -8);
    let x = 480 - total / 2; const y = 8, h = HUD.strip + 12;
    for (const it of items) {
      panel(x, y, it.w, h, it.r.color, 0.72);
      const alive = it.r.sr.alive;
      txt(it.label, x + 10, y + h / 2 + 1, HUD.strip, alive ? it.r.color : '#8a8fa8');
      const w0 = ctx.measureText(it.label).width, n = wins[it.r.pid] || 0;
      if (pips) {
        for (let i = 0; i < target; i++) {
          ctx.beginPath(); ctx.arc(x + 10 + w0 + 18 + i * 16, y + h / 2, 5, 0, 7);
          if (i < n) { ctx.fillStyle = it.r.color; ctx.fill(); } else { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.stroke(); }
        }
      } else txt(n + '/' + target, x + 10 + w0 + 10, y + h / 2 + 1, HUD.strip, '#fff');
      x += it.w + 8;
    }
  }

  function drawFeed(now) {
    feed = feed.filter((f) => now - f.at < FEED_MS);
    const px = 19, lh = px + 10;
    ctx.font = FONT(px);
    feed.forEach((f, i) => {
      const age = now - f.at, a = age > FEED_MS - 800 ? Math.max(0, (FEED_MS - age) / 800) : 1;
      const w = ctx.measureText(f.text).width + 24, y = 560 - (feed.length - 1 - i) * (lh + 4) - lh;
      ctx.globalAlpha = a;
      panel(10, y, w, lh, f.color, 0.7);
      txt(f.text, 22, y + lh / 2 + 1, px, '#fff');
    });
    ctx.globalAlpha = 1;
  }

  function drawBanner(lines, color) {
    const px = HUD.banner;
    ctx.font = FONT(px);
    const w = Math.min(900, Math.max.apply(null, lines.map((l) => ctx.measureText(l).width)) + 70), h = lines.length * (px + 14) + 24;
    const x = 480 - w / 2, y = 250 - h / 2;
    panel(x, y, w, h, color, 0.82);
    lines.forEach((l, i) => txt(l, 480, y + 12 + (px + 14) * (i + 0.5), i ? px * 0.55 : px, i ? '#cfe0ff' : '#fff', 'center'));
  }

  function drawFinal() {
    ctx.fillStyle = 'rgba(2,3,12,.72)'; ctx.fillRect(0, 0, cv.width, cv.height);
    const champ = matchWinner != null ? riderOf[matchWinner] : null;
    txt(champ ? '👑 ' + champ.name + ' gewinnt!' : '🤝 Unentschieden', 480, 110, 62, champ ? champ.color : '#fff', 'center');
    const sorted = riders.slice().sort((a, b) => (wins[b.pid] || 0) - (wins[a.pid] || 0));
    sorted.forEach((r, i) => {
      const y = 200 + i * 62, w = 520, x = 480 - w / 2;
      panel(x, y, w, 52, r.color, 0.8);
      txt((i + 1) + '.', x + 18, y + 27, 30, '#aab4d8');
      txt(r.name, x + 70, y + 27, 30, r.color);
      txt('🏆 ' + (wins[r.pid] || 0), x + w - 18, y + 27, 30, '#fff', 'right');
    });
    txt('⭐ Host kann am Handy „Nochmal“ drücken', 480, 200 + sorted.length * 62 + 36, 26, '#ffe27a', 'center');
  }

  function drawHud(now, vs) {
    ctx.save();
    if (phase !== 'final') {
      if (vs.layout === 'split') drawTags(vs);
      drawStrip();
      drawFeed(now);
      if (vs.layout === 'split') {
        const n = vs.views.length;
        if (n === 1) { drawMinimap(960 - HUD.mini1 - 14, 600 - HUD.mini1 - 40, HUD.mini1); }
        else if (n === 2) drawMinimap(960 - HUD.mini2 - 14, 300 - HUD.mini2 / 2, HUD.mini2);
        else if (n >= 3) drawMinimap(480 - HUD.mini4 / 2, 300 - HUD.mini4 / 2, HUD.mini4);
      }
    }
    if (phase === 'countdown') {
      const k = (now - phaseAt) % 1000 / 1000;
      ctx.globalAlpha = 1 - k * 0.5;
      ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 40;
      txt(String(cdN), 480, 290, HUD.count * (1.08 - 0.12 * k), '#fff', 'center');
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    } else if (phase === 'live' && now - liveAt < GO_FLASH_MS) {
      ctx.globalAlpha = 1 - (now - liveAt) / GO_FLASH_MS;
      ctx.shadowColor = '#00ffd0'; ctx.shadowBlur = 40;
      txt('LOS!', 480, 290, 150, '#7dffe6', 'center');
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    } else if (phase === 'roundOver') {
      const w = roundWinner != null ? riderOf[roundWinner] : null;
      drawBanner([w ? '🏁 ' + w.name + ' gewinnt die Runde!' : '🤝 Unentschieden!'], w ? w.color : '#cfe0ff');
    } else if (phase === 'final') drawFinal();
    txt('Host kann am Handy abbrechen ✕', 946, 584, 15, 'rgba(220,230,255,.7)', 'right');
    ctx.restore();
  }

  // ---------- Instanz ----------
  return {
    acceptsJoin: true,

    start(ids, c) {
      cfg = Object.assign({ map: 'raster', bots: 1, botLevel: 'normal', tempo: 'normal', target: 3, camera: 'split', extras: 'on', quality: 'high' }, c || {});
      cfg.target = clampN(cfg.target | 0 || 3, 1, 9);
      Sim = window.NeonspurSim; Maps = window.NeonspurMaps; View = window.NeonspurView; THREE_ = window.THREE;
      view = (Sim && Maps && Maps.length) ? ensureView() : null;
      if (!view) { endToLobby('⚡ Neonspur braucht einen Browser mit WebGL.'); return; }
      try { view.setQuality(cfg.quality === 'low' ? 'low' : 'high'); } catch (e) {}
      sfx.ambient('space');
      seats = ids.slice(0, MAX_RIDERS); spectators = ids.slice(MAX_RIDERS);
      wins = {}; matchWinner = null; reported = false; round = 0; lastHost = hostId();
      startRound();
    },

    stop() {
      timers.forEach(clearTimeout); timers = [];
      phase = 'idle'; sim = null; riders = []; riderOf = {}; mm = null; view = null;
    },

    onConnect(id) {
      if (known().includes(id)) return;
      spectators.push(id);
      // Die Shell schickt enterGame NACH onConnect (Handy setzt sich zurück) → verzögert antworten
      later(() => { if (known().includes(id)) { send(id, infoFor(id)); send(id, phaseFor(id)); } }, 120);
    },

    onDisconnect(id) {
      spectators = spectators.filter((x) => x !== id);
      const wasSeated = seats.includes(id);
      seats = seats.filter((x) => x !== id);
      delete wins[id]; delete cdPending[id]; delete youSent[id];
      if (held[id] && sim) { try { sim.input(id, 'B-'); } catch (e) {} }
      delete held[id];
      if (!wasSeated) return;
      if (!seats.length) { endToLobby('⚡ Neonspur: alle Fahrer sind weg.'); return; }
      if ((phase === 'live' || phase === 'countdown') && sim) {
        const evs = sim.kill(id);
        if (evs.length) handleEvents(evs);
      }
      if (phase === 'final') sendPhaseAll();
    },

    onMessage(id, d) {
      if (!d || typeof d.t !== 'string' || !known().includes(id)) return;
      if (d.t === 'nsTurn') {
        if (phase !== 'live' || !sim || !seats.includes(id) || (d.d !== 'L' && d.d !== 'R')) return;
        sim.input(id, d.d);
      } else if (d.t === 'nsJump') {
        if (phase !== 'live' || !sim || !seats.includes(id)) return;
        sim.input(id, 'J');
      } else if (d.t === 'nsBoost') {
        if (!extras || phase !== 'live' || !sim || !seats.includes(id)) return;
        const r = riderOf[id]; if (!r || !r.sr.alive) return;
        held[id] = !!d.on; sim.input(id, d.on ? 'B+' : 'B-');
      } else if (d.t === 'nsCam' && cfg.camera !== 'overview') {
        cams[id] = (cams[id] || 'pov') === 'pov' ? 'chase' : 'pov';
        send(id, { t: 'nsCamIs', cam: cams[id] });
      } else if (d.t === 'nsAgain') {
        if (phase === 'final' && id === hostId()) newMatch();
      }
    },

    render() {
      if (!sim || !view || phase === 'idle') return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      soundSeen = {};

      // Host-Wechsel → Flags neu senden (Nochmal-Button am neuen Host)
      const h = hostId();
      if (h !== lastHost) { lastHost = h; sendInfoAll(); sendPhaseAll(); }

      if (phase === 'countdown') {
        const el = now - phaseAt, n = 3 - Math.floor(el / (COUNTDOWN_MS / 3));
        if (el >= COUNTDOWN_MS) toLive(now);
        else if (n !== cdN) { cdN = n; sfx('beep'); sendPhaseAll(); }
      } else if (phase === 'roundOver' && now - phaseAt >= ROUND_OVER_MS) {
        if (matchWinner != null) toFinal(); else startRound();
        if (!sim) return;
      }

      let alpha = 1;
      if (phase === 'live') {
        acc += dt * 1000;
        const st = sim.state;
        while (acc >= sim.tickMs && !st.over) {
          const evs = sim.step(); acc -= sim.tickMs;
          handleEvents(evs);
          if (phase !== 'live') break;
        }
        alpha = phase === 'live' ? clampN(acc / sim.tickMs, 0, 1) : 1;
        // Sprung-Cooldown vorbei → Handy bescheid geben (einmal)
        for (const pid in cdPending) {
          const r = riderOf[pid];
          if (r && r.sr.alive && st.time >= r.sr.jumpReadyAt) { delete cdPending[pid]; sendYou(r, { jumpIn: 0 }); }
        }
        syncYou(now);
      }

      const vs = currentViews();
      try { view.render(sim.state, alpha, { layout: vs.layout, views: vs.views, now }); } catch (e) {}
      try { ctx.drawImage(view.canvas, 0, 0, cv.width, cv.height); } catch (e) {}
      updateMinimap();
      drawHud(now, vs);
    },

    _debug() { return { sim, phase, seats, wins, views: currentViewsSafe() }; }
  };

  function currentViewsSafe() { try { return sim ? currentViews() : null; } catch (e) { return null; } }
}});
