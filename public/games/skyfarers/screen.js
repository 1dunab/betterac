// ===== Modul: SKYFARERS (co-op airship game) — TV glue =====
// Verbindet sim.js (Regeln), render.js (three.js) und die Handys. Contract: docs/SKYFARERS.md.
// Die View besitzt einen eigenen WebGL-Canvas; wie beim Racer liegt er samt transparentem HUD-Canvas in einem
// Wrapper, der `cv` während des Spiels ersetzt. Für Mitschauen spiegelt das Modul alle 125 ms View + HUD in `cv`.

// ---- File scope: eine View für alle Partien (kein WebGL-Context-Leak) ----
let skView = null, skViewCtor = null, skWrap = null, skHud = null, skSizer = null;

registerGame({ key: 'skyfarers', screen: function () {
  // ---------- Konstanten ----------
  const MAX_SHIPS = 8, INTRO_MS = 4000, MIRROR_MS = 125;
  const AUTO_AFTER_MS = 5000, AUTO_WINDOW_MS = 3000, AUTO_SLOW_MS = 22;
  const YOU_MS = 200, BASE_MS = 500;                       // Drosselung der Handy-Updates (5/s bzw. 2/s)
  const BOTS = [
    { pid: -1, name: '🤖 Kapitänin Kork' }, { pid: -2, name: "🤖 Käpt'n Kompass" }, { pid: -3, name: '🤖 Maat Möwe' }
  ];
  const PALETTE = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#f783ac', '#b197fc', '#ffa94d', '#3bc9db'];
  const HUE_GAP = 35;
  const KINDS = {
    sturm: { name: '⛈️ Sturm', color: '#7aa8ff' },
    drachen: { name: '🐉 Drachen', color: '#ff7a5c' },
    nacht: { name: '🌩️ Sturmnacht', color: '#b08cff' }
  };
  const FONT = (px) => 'bold ' + Math.round(px) + 'px system-ui,sans-serif';
  const FEED_MAX = 5, FEED_MS = 5000;
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- Zustand ----------
  let cfg = {}, World = null, Sim = null, view = null, blit = false;
  let phase = 'idle';                     // intro | live | end
  let seats = [], spectators = [], meta = {}, botColor = {};
  let sim = null, matchNo = 0, lastHost = null;
  let acc = 0, last = 0, phaseAt = 0, liveAt = 0, mirrorAt = 0, firstFrame = true;
  let soundSeen = {}, soundAt = {}, timers = [], youSent = {}, baseSent = {}, errSeen = {};
  let banners = [], feed = [], endInfo = null, reported = false, endAt = 0;
  let samples = [], autoDone = false, curQuality = 'high', lastDocked = {};
  let hintSt = {}, fireWave = 0, fireOn = false, fireLastT = -1e9, tvHint = {};   // onboarding hints (per captain, sim time)
  let hctx = null, fast = false;               // fast: dev harness fast-forward — no drawing at all

  // ---------- Helfer ----------
  const botName = (pid) => (BOTS.find((b) => b.pid === pid) || {}).name || '🤖';
  const send = (id, m) => { try { ac.message(id, m); } catch (e) {} };
  const known = () => seats.concat(spectators);
  const later = (fn, ms) => { const t = setTimeout(() => { timers = timers.filter((x) => x !== t); fn(); }, ms); timers.push(t); };
  const safe = (label, fn) => { try { return fn(); } catch (e) { if (!errSeen[label]) { errSeen[label] = 1; console.error('Skyfarers ' + label + ':', e); } } };
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const colorP = (pid) => pid < 0 ? (botColor[pid] || '#fff') : ((players[pid] && players[pid].color) || '#fff');
  const nameP = (pid) => pid < 0 ? botName(pid) : nameOf(pid);
  const shipOf = (pid) => sim ? sim.state.ships.find((s) => s.pid === pid) : null;
  const humanShips = () => (sim ? sim.state.ships : []).filter((s) => !s.bot);

  function hue(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return -999;
    const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 0.08) return -999;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  const hueNear = (a, b) => { const x = hue(a), y = hue(b); if (x < -900 || y < -900) return false; const d = Math.abs(x - y); return Math.min(d, 360 - d) < HUE_GAP; };
  function pickBotColors(nBots, humanColors) {
    const used = humanColors.slice(), out = [];
    for (let i = 0; i < nBots; i++) {
      let c = PALETTE.find((n) => !used.some((u) => hueNear(n, u)));
      if (!c) c = PALETTE.find((n) => !used.includes(n)) || PALETTE[i % PALETTE.length];
      used.push(c); out.push(c);
    }
    return out;
  }

  // ---------- Display: View-Singleton + Wrapper (WebGL-Canvas + HUD-Overlay) ----------
  function dropView() {
    if (skWrap) { try { skWrap.remove(); } catch (e) {} }
    skView = null; skViewCtor = null; skWrap = null; skHud = null; skSizer = null;
  }
  function ensureView() {
    const T = window.THREE, C = window.SkyfarersView;
    if (!T || !C) return null;
    if (skView && skViewCtor === C) return skView;
    try { if (skView && skView.dispose) skView.dispose(); } catch (e) {}
    dropView();
    try {
      const v = new C(T, { width: 1920, height: 1200, quality: cfg.quality === 'low' ? 'low' : 'high' });
      // `skSizer` übernimmt die CSS-Box von cv (globale canvas-Regel: max-width/-height + Seitenverhältnis),
      // View und HUD liegen deckungsgleich darüber. Globale canvas-Regel (Hintergrund/Schatten) neutralisieren.
      skWrap = document.createElement('div');
      skWrap.style.cssText = 'position:relative; display:none; line-height:0; width:fit-content; margin:0 auto; border-radius:10px; box-shadow:0 0 50px rgba(120,90,255,.18);';
      skSizer = document.createElement('canvas');
      skSizer.width = 960; skSizer.height = 600;
      skSizer.style.cssText = 'visibility:hidden; box-shadow:none;';
      const layer = 'position:absolute; left:0; top:0; width:100%; height:100%; max-width:none; max-height:none; pointer-events:none; box-shadow:none;';
      v.canvas.style.cssText = layer + 'background:#0d0d1a; border-radius:10px;';
      skHud = document.createElement('canvas');
      skHud.width = v.W || 960; skHud.height = v.H || 600;
      skHud.style.cssText = layer + 'background:transparent; border-radius:10px;';
      skWrap.append(skSizer, v.canvas, skHud);
      cv.insertAdjacentElement('afterend', skWrap);
      skView = v; skViewCtor = C;
    } catch (e) { dropView(); return null; }
    return skView;
  }
  function showWrap(on) {
    if (!skWrap) return;
    skWrap.style.display = on && !blit ? 'block' : 'none';
    cv.style.display = on && !blit ? 'none' : '';
  }
  function syncHudSize() {
    const w = view.W || 960, h = view.H || 600;
    if (skHud.width !== w || skHud.height !== h) { skHud.width = w; skHud.height = h; }
    hctx = skHud.getContext('2d');
  }

  // ---------- Phone-Protokoll ----------
  function infoFor(id) {
    return { t: 'skInfo', ship: seats.includes(id), color: colorP(id), host: id === hostId(), dauer: cfg.dauer };
  }
  function resultFor(id) {
    if (!endInfo) return undefined;
    const me = endInfo.rows.find((r) => r.pid === id);
    return {
      survived: endInfo.survived, stars: endInfo.stars,
      mvp: endInfo.mvp ? { name: endInfo.mvp.name, you: endInfo.mvp.pid === id } : null,
      you: me ? { score: me.score, stats: me.stats } : { score: 0, stats: {} }
    };
  }
  function phaseFor(id) {
    const m = { t: 'skPhase', phase };
    if (phase === 'end') m.result = resultFor(id);
    return m;
  }
  const sendInfoAll = () => known().forEach((id) => send(id, infoFor(id)));
  const sendPhaseAll = () => known().forEach((id) => send(id, phaseFor(id)));
  const toast = (id, text) => send(id, { t: 'skToast', text });
  const toastAll = (text) => seats.forEach((id) => toast(id, text));

  const r2 = (v, k) => Math.round(v * k) / k;
  // nearest harvestable islet in reach (same test as the sim's decideAct) → which resource the button harvests
  function harvestRes(s) {
    const st = sim.state, wi = sim.world.islets;
    let bd = 1e9, res = null;
    for (let i = 0; i < st.islets.length; i++) {
      const isl = st.islets[i];
      if (isl.amount < 1) continue;
      const d = Math.hypot(isl.x - s.x, isl.y - s.y);
      if (d <= wi[i].r + Sim.CONST.HARVEST_R && d < bd) { bd = d; res = isl.kind; }
    }
    return res;
  }
  function youMsg(s) {
    return { t: 'skYou', cargo: { kristall: s.cargo.kristall, holz: s.cargo.holz }, cap: s.cap, water: r2(s.water, 4), waterCap: Sim.CONST.WATER_CAP,
      boost: r2(s.boost, 20), act: s.act, res: s.act === 'harvest' ? harvestRes(s) : null, docked: !!s.docked, stunned: s.stunned > 0 };
  }
  function syncYou(now, force) {
    for (const s of humanShips()) {
      const m = youMsg(s), sig = JSON.stringify(m), o = youSent[s.pid];
      if (o && o.sig === sig) continue;
      if (o && !force && now - o.at < YOU_MS) continue;
      youSent[s.pid] = { sig, at: now };
      send(s.pid, m);
    }
  }

  // What the build drawer may offer — same decision order as sim.build()
  function costOf(kind) {
    const c = World.BUILDINGS[kind].cost, rebuild = sim.state.slots.some((sl) => sl.kind === kind && sl.ruined);
    return rebuild ? { holz: Math.ceil(c.holz * Sim.CONST.REBUILD_COST), kristall: Math.ceil(c.kristall * Sim.CONST.REBUILD_COST), rebuild } : { holz: c.holz, kristall: c.kristall, rebuild };
  }
  function buildStatus(kind) {
    const st = sim.state, B = World.BUILDINGS;
    const co = costOf(kind);
    if (!co.rebuild) {
      if (kind === 'sternwarte') {
        const c = st.slots[0];
        const ok = !c.kind || (c.kind === 'sternwarte' && c.stage < B.sternwarte.stages && c.build >= 1 && !c.ruined);
        if (!ok) return 'stage';
      } else if (!st.slots.some((sl) => sl.i > 0 && !sl.kind)) return 'noSlot';
    }
    if (st.stock.holz < co.holz || st.stock.kristall < co.kristall) return 'cost';
    return true;
  }
  function canBuildMap() {
    const out = {};
    for (const k of Object.keys(World.BUILDINGS)) out[k] = buildStatus(k);
    return out;
  }
  function baseMsg() {
    const st = sim.state;
    return { t: 'skBase', stock: { holz: st.stock.holz, kristall: st.stock.kristall }, energy: Math.round(st.energy), herz: Math.round(st.herz),
      slots: st.slots.map((sl) => ({ i: sl.i, kind: sl.kind, stage: sl.stage, build: r2(sl.build, 20), hp: Math.round(sl.hp), fire: r2(sl.fire, 10), ruined: !!sl.ruined })),
      canBuild: canBuildMap() };
  }
  function syncBase(now) {
    for (const s of humanShips()) {
      if (!s.docked) { delete baseSent[s.pid]; continue; }
      const m = baseMsg(), sig = JSON.stringify(m), o = baseSent[s.pid];
      if (o && o.sig === sig) continue;
      if (o && now - o.at < BASE_MS) continue;
      baseSent[s.pid] = { sig, at: now };
      send(s.pid, m);
    }
  }

  // ---------- HUD-Texte / Feed ----------
  function pushBanner(lines, color, ms) { banners.push({ lines, color: color || '#ffe27a', at: performance.now(), ms: ms || 3800 }); if (banners.length > 3) banners.shift(); }
  function pushFeed(text, color) { feed.push({ text, color: color || '#fff', at: performance.now() }); if (feed.length > FEED_MAX) feed.shift(); }
  const kindName = (k) => (KINDS[k] || {}).name || k;
  const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // ---------- Onboarding-Hinweise (pro Kapitän, höchstens einer alle HINT_GAP Sim-Sekunden, nur Menschen im Spiel) ----------
  const HINT_GAP = 6, WAVE_GAP = 20;
  function windradWorks() { return sim.state.slots.some((sl) => sl.kind === 'windrad' && sl.build >= 1 && !sl.ruined && sl.fire <= Sim.CONST.WORK_FIRE_MAX); }
  function burningSlots() { return sim.state.slots.filter((sl) => sl.fire > 0 && sl.kind && !sl.ruined); }
  function tickHints() {
    const st = sim.state, t = st.t, fires = burningSlots();
    if (fires.length) { if (!fireOn && (fireWave === 0 || t - fireLastT >= WAVE_GAP)) fireWave++; fireOn = true; fireLastT = t; } else fireOn = false;
    const storm = !!st.event && (st.event.kind === 'sturm' || st.event.kind === 'nacht') && windradWorks();
    const anyDocked = st.ships.some((s) => s.docked);
    const slotPos = sim.world.home.slots;
    for (const s of humanShips()) {
      if (!seats.includes(s.pid)) continue;
      const h = hintSt[s.pid] || (hintSt[s.pid] = { at: -1e9, once: {}, wave: {} });
      if (t - h.at < HINT_GAP) continue;
      const total = s.cargo.holz + s.cargo.kristall;
      let key = null, text = null, wave = false;
      if (fires.length && s.water < 1 && h.wave.dry !== fireWave) { key = 'dry'; wave = true; text = '🔥 Es brennt! Flieg durch eine dunkle Regenwolke ☁️ für 💧'; }
      else if (fires.length && s.water >= 1 && h.wave.wet !== fireWave && !fires.some((sl) => Math.hypot(slotPos[sl.i].x - s.x, slotPos[sl.i].y - s.y) <= Sim.CONST.EXTINGUISH_R)) { key = 'wet'; wave = true; text = '💧 Wasser an Bord — flieg zum Feuer und halte den Knopf'; }
      else if (storm && s.docked && !h.once.shield) { key = 'shield'; text = '🛡️ Halt den Schild-Knopf gedrückt, solange der Sturm tobt'; }
      else if (storm && !anyDocked && !h.once.shield2) { key = 'shield2'; text = '🛡️ Einer muss an der Insel den Schild halten!'; }
      else if (st.event && st.event.kind === 'drachen' && !h.once.dragon) { key = 'dragon'; text = '🎯 Flieg nah an einen Drachen und halte den Knopf — Harpune!'; }
      else if (total >= s.cap && !h.once.full) { key = 'full'; text = '📦 Laderaum voll — ab zur Insel, dort wird automatisch entladen'; }
      else if (s.docked && !h.once.dock) { key = 'dock'; text = '🏗️ Angelegt! Unten kannst du bauen'; }
      else if (!h.once.intro) { key = 'intro'; text = '⛏️ Ernte 💎 und 🪵 auf den kleinen Inseln, bring sie zum Steg 🏝️'; }
      if (!key) continue;
      if (wave) h.wave[key] = fireWave; else h.once[key] = 1;
      h.at = t; toast(s.pid, text);
    }
  }

  // ---------- Partie ----------
  function startMatch() {
    seats = seats.filter((id) => players[id]);
    spectators = spectators.filter((id) => players[id] && !seats.includes(id));
    while (seats.length < MAX_SHIPS && spectators.length) seats.push(spectators.shift());
    if (!seats.length) { endToLobby('🎈 Skyfarers: alle Kapitäne sind weg.'); return; }

    let nb = clampN(cfg.bots | 0, 0, BOTS.length);
    if (seats.length === 1 && nb < 1) nb = 1;
    nb = Math.min(nb, MAX_SHIPS - seats.length);
    const botList = BOTS.slice(0, nb), cols = pickBotColors(nb, seats.map(colorP));
    botColor = {}; botList.forEach((b, i) => { botColor[b.pid] = cols[i]; });

    const seed = (cfg.seed ? (cfg.seed + matchNo) : ((Math.random() * 0x7fffffff) | 0)) | 0 || 1;
    matchNo++;
    const world = World.make(seed);
    sim = Sim.create({ seed, world, dauer: cfg.dauer, schwierigkeit: cfg.schwierigkeit,
      captains: seats.map((id) => ({ pid: id, bot: false })).concat(botList.map((b) => ({ pid: b.pid, bot: true }))) });
    // late seat bookkeeping: anybody the sim refused (cannot happen with <= 8) spectates
    seats = seats.filter((id) => { if (shipOf(id)) return true; spectators.push(id); return false; });
    meta = {};
    seats.forEach((id) => { meta[id] = { pid: id, bot: false, name: nameOf(id), short: shortName(id), color: colorP(id) }; });
    botList.forEach((b) => { meta[b.pid] = { pid: b.pid, bot: true, name: b.name, short: b.name, color: botColor[b.pid] }; });
    safe('setWorld', () => view.setWorld(world, lookOf()));

    hintSt = {}; fireWave = 0; fireOn = false; fireLastT = -1e9; tvHint = {};
    banners = []; feed = []; endInfo = null; reported = false; youSent = {}; baseSent = {}; lastDocked = {};
    samples = []; firstFrame = true; soundSeen = {};
    phase = 'intro'; phaseAt = performance.now(); acc = 0; last = phaseAt; mirrorAt = 0;
    sendInfoAll(); sendPhaseAll();
    pushBanner(['🎈 Skyfarers', 'Haltet die Insel bis zum Morgengrauen!'], '#ffe27a', INTRO_MS);
    safe('sound', () => { SkyfarersSound.ambience('calm'); SkyfarersSound.engine(0); });
    sfx('whoosh');
  }
  function lookOf() {
    const look = {};
    Object.keys(meta).forEach((pid) => { look[pid] = { color: meta[pid].color, name: meta[pid].short }; });
    return look;
  }

  function toLive(now) {
    phase = 'live'; liveAt = now; acc = 0; last = now; samples = [];
    sfx('go'); sendPhaseAll();
    syncYou(now, true);
  }

  function mvpOf(rows) {
    const humans = rows.filter((r) => !r.bot && r.score > 0), pool = humans.length ? humans : rows.filter((r) => r.score > 0);
    if (!pool.length) return null;
    return pool.reduce((a, b) => (b.score > a.score ? b : a));
  }
  function toEnd(survived, stars) {
    const st = sim.state;
    const rows = st.ships.map((s) => ({ pid: s.pid, bot: s.bot, name: (meta[s.pid] || {}).name || nameP(s.pid), color: (meta[s.pid] || {}).color || '#fff',
      score: s.score, stats: Object.assign({}, s.stats) })).sort((a, b) => b.score - a.score);
    const mvp = mvpOf(rows);
    endInfo = { survived, stars, rows, mvp, herz: st.herz, day: st.dayT };
    phase = 'end'; phaseAt = performance.now(); endAt = phaseAt;
    if (survived && !reported) {
      reported = true;
      const winners = seats.filter((id) => shipOf(id));
      if (winners.length) safe('reportWinners', () => reportWinners(winners));
    }
    sendPhaseAll();
    sfx(survived ? 'fanfare' : 'sad');
    safe('sound', () => SkyfarersSound.engine(0));
  }

  function newMatch() {
    seats = seats.concat(spectators); spectators = [];
    seats = seats.filter((id) => players[id]);
    seats.sort((a, b) => a - b);
    startMatch();
  }

  // ---------- Events ----------
  function once(name, fn, gapMs) {                // one sound per name per frame, with an optional minimum gap
    if (soundSeen[name]) return;
    const t = performance.now();
    if (gapMs && soundAt[name] != null && t - soundAt[name] < gapMs) return;
    soundSeen[name] = 1; soundAt[name] = t; fn();
  }
  const snd = (name, gapMs) => once('S' + name, () => safe('sound', () => SkyfarersSound.play(name)), gapMs);
  const sx = (name, gapMs) => once('F' + name, () => safe('sfx', () => sfx(name)), gapMs);

  function handleEvents(events) {
    const st = sim.state, B = World.BUILDINGS;
    for (const ev of events) {
      if (!fast) safe('view.event', () => view.event(ev, st));
      const m = meta[ev.pid] || {}, col = m.color;
      switch (ev.t) {
        case 'warn': {
          const k = KINDS[ev.kind] || {};
          pushBanner([kindName(ev.kind) + ' zieht auf!', 'in ' + Math.round(ev.in) + ' Sekunden — alle zur Insel!'], k.color || '#ffb347', 4500);
          snd('alarm'); seats.forEach((id) => send(id, { t: 'skAlert', kind: ev.kind, in: ev.in }));
          break;
        }
        case 'eventStart': {
          const text = ev.kind === 'sturm' ? '⛈️ Der Sturm bricht los!' : ev.kind === 'drachen' ? '🐉 Drachen greifen an!' : '🌩️ Sturmnacht! Haltet bis zum Morgen durch!';
          pushBanner([text], (KINDS[ev.kind] || {}).color, 3800);
          if ((ev.kind === 'sturm' || ev.kind === 'nacht') && !tvHint.shield && windradWorks()) { tvHint.shield = 1; pushFeed('🛡️ Schild: an der Insel anlegen und halten', '#8fd3ff'); }
          if (ev.kind === 'sturm' || ev.kind === 'nacht') snd('thunder'); else snd('roar');
          seats.forEach((id) => send(id, { t: 'skEvent', kind: ev.kind, on: true }));
          break;
        }
        case 'eventEnd': {
          pushBanner([ev.kind === 'sturm' ? '☀️ Der Sturm ist vorüber' : ev.kind === 'drachen' ? '🐉 Die Drachen ziehen ab' : '🌅 Die Nacht ist überstanden'], '#9be58a', 3200);
          seats.forEach((id) => send(id, { t: 'skEvent', kind: ev.kind, on: false }));
          break;
        }
        case 'harvest': sx('tick', 300); break;
        case 'unload': sx('coin', 140); break;
        case 'dock': sx('pop'); break;
        case 'buildStart': {
          snd('hammer', 400);
          pushFeed('🔨 ' + (m.short || '?') + ' baut ' + B[ev.kind].icon + ' ' + B[ev.kind].name, col);
          break;
        }
        case 'buildDone': {
          const b = B[ev.kind], text = ev.kind === 'sternwarte' ? '🔭 Sternwarte Stufe ' + ev.stage + ' fertig!' : b.icon + ' ' + b.name + ' fertig!';
          snd('chime'); pushFeed(text, '#9be58a'); toastAll(text);
          if (ev.kind === 'sternwarte' && ev.stage >= b.stages) { pushBanner(['🔭 Sternwarte vollendet!', 'Der Himmel gehört euch'], '#ffe27a', 4200); sx('fanfare'); }
          break;
        }
        case 'fireStart':
          pushFeed('🔥 Feuer auf der Insel!', '#ff8a5c'); sx('hit', 400);
          if (!tvHint.fire) { tvHint.fire = 1; pushFeed('🔥 Löschen: Wasser aus Regenwolken holen ☁️ → am Feuer Knopf halten', '#6ec6ff'); }
          break;
        case 'fireOut': pushFeed('💧 Feuer gelöscht' + (m.short ? ' von ' + m.short : ''), '#6ec6ff'); break;
        case 'spray': snd('splash', 250); break;
        case 'strike': snd('thunder', 300); break;
        case 'stun': {
          sx('hit'); if (m.short) pushFeed('💫 ' + m.short + ' wurde getroffen', col);
          if (ev.pid > 0) toast(ev.pid, '💫 Getroffen! Fracht verloren');
          break;
        }
        case 'pickup': sx('powerup', 200); break;
        case 'shieldOn': sx('whoosh', 800); break;
        case 'dragonSpawn': snd('roar', 600); break;
        case 'harpoon': snd('harpoon', 150); break;
        case 'cannon': snd('cannon', 150); break;
        case 'dragonHit': sx('hit', 150); break;
        case 'dragonFlee': pushFeed('🐉 Ein Drache flieht!', '#ffb347'); break;
        case 'ruined': pushFeed('🏚️ Ein Gebäude ist zerstört!', '#ff7a5c'); sx('thud'); break;
        case 'repair': snd('hammer', 500); break;
        case 'horn': snd('horn', 300); break;
        case 'herzLow': pushBanner(['💔 Das Herz der Insel schwächelt!'], '#ff6b6b', 3500); snd('alarm'); break;
        case 'sink': snd('sink'); pushBanner(['🌊 Die Insel sinkt…'], '#ff6b6b', 4000); break;
        case 'over': if (phase === 'live') toEnd(!!ev.survived, ev.stars | 0); break;
        default: break;
      }
    }
  }

  function moodFor(st) {
    const k = st.event && st.event.kind;
    if (k === 'sturm' || k === 'nacht') return 'storm';
    return st.dayT >= 0.72 ? 'night' : 'calm';
  }
  function engineLevel(st) {
    if (!st.ships.length) return 0;
    const top = Sim.CONST.SPEED * Sim.CONST.BOOST_MUL;
    let sum = 0;
    for (const s of st.ships) sum += Math.min(1, Math.hypot(s.vx, s.vy) / top);
    return clampN(0.12 + (sum / st.ships.length) * 1.4, 0, 1);
  }

  // ---------- Qualität ----------
  function sampleFrame(now, rawMs) {
    if (rawMs < 1) return;                                       // render called twice in the same instant
    samples.push([now, Math.min(rawMs, 100)]);
    while (samples.length && now - samples[0][0] > AUTO_WINDOW_MS) samples.shift();
    if (cfg.quality !== 'auto' || autoDone || curQuality !== 'high' || phase !== 'live') return;
    if (now - liveAt < AUTO_AFTER_MS || samples.length < 8) return;
    const avg = samples.reduce((a, b) => a + b[1], 0) / samples.length;
    if (avg > AUTO_SLOW_MS) {
      autoDone = true; curQuality = 'low';
      safe('setQuality', () => view.setQuality('low'));
      syncHudSize();
      pushBanner(['🔋 Grafik auf Sparsam gestellt'], '#ffe27a', 3500);
    }
  }

  // ---------- HUD ----------
  let g = null, U = 1;
  function txt(s, x, y, px, color, align) {
    g.font = FONT(px); g.textAlign = align || 'left'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = Math.max(3, px / 5); g.strokeStyle = 'rgba(0,0,12,.85)';
    g.strokeText(s, x, y); g.fillStyle = color || '#fff'; g.fillText(s, x, y);
  }
  function panel(x, y, w, h, border, alpha) {
    g.fillStyle = 'rgba(8,12,28,' + (alpha == null ? 0.72 : alpha) + ')'; rr(g, x, y, w, h, 12 * U); g.fill();
    if (border) { g.strokeStyle = border; g.lineWidth = 2.5 * U; g.stroke(); }
  }
  function fitPx(s, maxW, px) {
    g.font = FONT(px);
    const w = g.measureText(s).width;
    return w > maxW && w > 0 ? Math.max(8, px * maxW / w) : px;
  }
  const dayIcon = (d) => d < 0.1 ? '🌅' : d < 0.55 ? '☀️' : d < 0.72 ? '🌇' : d < 0.97 ? '🌙' : '🌅';

  function sternState(st) {
    const c = st.slots[0];
    if (!c || c.kind !== 'sternwarte') return { done: 0, building: 0 };
    return { done: c.build >= 1 ? c.stage : Math.max(0, c.stage - 1), building: c.build < 1 ? c.build : 0, ruined: c.ruined };
  }

  function drawTopBar(st) {
    const px = 17 * U, h = px + 16 * U, y = 8 * U, pad = 10 * U, gap = 6 * U, barW = 74 * U, barH = 11 * U;
    const dur = World.DAUER[sim.dauer];
    const segs = [];
    segs.push({ text: dayIcon(st.dayT) + ' ' + fmtClock(dur - st.t) });
    // event countdown / running event
    if (st.event) {
      segs.push({ text: kindName(st.event.kind) + ' · ' + fmtClock(st.event.until - st.t), border: (KINDS[st.event.kind] || {}).color, color: '#fff' });
    } else if (st.next) {
      const left = st.next.at - st.t;
      segs.push({ text: kindName(st.next.kind) + ' in ' + fmtClock(left), border: left <= Sim.CONST.WARN_S ? '#ffb347' : null, color: left <= Sim.CONST.WARN_S ? '#ffd9a0' : '#cfe0ff' });
    } else segs.push({ text: '🌅 Fast geschafft' });
    segs.push({ text: '❤️ ' + Math.round(st.herz), bar: st.herz / 100, barColor: st.herz < 30 ? '#ff4d4d' : '#ff7a8a', border: st.herz < 30 ? '#ff4d4d' : null });
    segs.push({ text: (st.shieldOn ? '🛡️ ' : '⚡ ') + Math.round(st.energy), bar: st.energy / 100, barColor: st.shieldOn ? '#7dd3ff' : '#ffd43b' });
    segs.push({ text: '💎 ' + st.stock.kristall + '  🪵 ' + st.stock.holz });
    const ss = sternState(st);
    segs.push({ text: '🔭 ' + ss.done + '/3', bar: (ss.done + ss.building) / 3, barColor: '#b08cff', border: ss.done >= 3 ? '#ffe27a' : null });

    let total = -gap;
    for (const s of segs) {
      g.font = FONT(px); s.w = g.measureText(s.text).width + pad * 2 + (s.bar != null ? barW + 8 * U : 0); total += s.w + gap;
    }
    const k = Math.min(1, (g.canvas.width - 20 * U) / total);   // narrow screens: shrink the bar as a whole
    g.save();
    g.translate(g.canvas.width / 2, 0); g.scale(k, k); g.translate(-total / 2, 0);
    let x = 0;
    for (const s of segs) {
      panel(x, y, s.w, h, s.border || 'rgba(160,190,255,.35)', 0.75);
      txt(s.text, x + pad, y + h / 2 + 1, px, s.color || '#fff');
      if (s.bar != null) {
        g.font = FONT(px);
        const bx = x + pad + g.measureText(s.text).width + 8 * U, by = y + h / 2 - barH / 2;
        g.fillStyle = 'rgba(255,255,255,.16)'; rr(g, bx, by, barW, barH, barH / 2); g.fill();
        const f = clampN(s.bar, 0, 1);
        if (f > 0) { g.fillStyle = s.barColor; rr(g, bx, by, Math.max(barH, barW * f), barH, barH / 2); g.fill(); }
      }
      x += s.w + gap;
    }
    g.restore();
  }

  // One label per ship: name + cargo/water (💫 prefix when stunned). Greedy placement in overlay pixels:
  // keep the previous slot while it is free, else the first free candidate (below, above, diagonals, then
  // radially outwards from the island); pills glide to their slot and get a leader line when displaced.
  const tagPos = {};   // pid → { slot, x, y, at } (pill centre, smoothed)
  let tagBanner = null;   // banner rect (overlay px) of the last frame, to keep labels clear of it
  function shipLabel(s) {
    const bits = [];
    if (s.cargo.kristall) bits.push('💎' + s.cargo.kristall);
    if (s.cargo.holz) bits.push('🪵' + s.cargo.holz);
    if (s.water >= 0.5) bits.push('💧' + Math.floor(s.water + 0.01));
    return { pre: s.stunned > 0 ? '💫 ' : '', bits: bits.length ? ' ' + bits.join(' ') : '' };
  }
  // While a fire burns: pulsing ☁️💧 over every rain cloud so players see where water is
  function drawCloudMarks(st, alpha, now) {
    if (phase !== 'live' || !burningSlots().length) return;
    const W = g.canvas.width, sc = W / (view.W || W), px = 22 * U, pulse = 0.7 + 0.3 * Math.sin(now / 260);
    g.font = FONT(px);
    for (const c of st.clouds) {
      let p; try { p = view.project(c.px + (c.x - c.px) * alpha, c.py + (c.y - c.py) * alpha, 6); } catch (e) { p = null; }
      if (!p || !p.visible) continue;
      g.globalAlpha = pulse * 0.85; g.fillStyle = 'rgba(20,40,90,0.9)'; g.beginPath(); g.ellipse(p.x * sc, p.y * sc, 32 * U, 17 * U, 0, 0, Math.PI * 2); g.fill();
      g.globalAlpha = pulse; txt('☁️💧', p.x * sc, p.y * sc, px, '#cfeaff', 'center');
    }
    g.globalAlpha = 1;
  }

  function drawShipTags(st, alpha, now) {
    const W = g.canvas.width, H = g.canvas.height;
    const sc = W / (view.W || W);
    const px = 15 * U, h = px + 9 * U, m6 = 6 * U, top = 54 * U, items = [];
    g.font = FONT(px);
    let ic = null; try { ic = view.project(0, 0, 0); } catch (e) { ic = null; }
    const icx = ic && ic.visible ? ic.x * sc : W / 2, icy = ic && ic.visible ? ic.y * sc : H / 2;
    for (const s of st.ships) {
      const m = meta[s.pid]; if (!m) continue;
      const x = s.px + (s.x - s.px) * alpha, y = s.py + (s.y - s.py) * alpha;
      let p; try { p = view.project(x, y, 4); } catch (e) { p = null; }
      if (!p || !p.visible) continue;
      const L = shipLabel(s);
      const w = g.measureText(L.pre + m.short + L.bits).width + 16 * U;
      items.push({ s, m, L, w, ax: p.x * sc, ay: p.y * sc });
    }
    items.sort((a, b) => a.s.pid - b.s.pid);
    // obstacles: top bar, banner, feed corner and every ship sprite
    const obst = [{ x: 0, y: 0, w: W, h: top }];
    if (tagBanner) obst.push(tagBanner);
    obst.push({ x: 0, y: H - 5 * (16 * U + 14 * U), w: 340 * U, h: H });
    for (const t of items) obst.push({ x: t.ax - 20 * U, y: t.ay - 24 * U, w: 40 * U, h: 46 * U, own: t });
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const placed = [];
    const free = (r, t) => !obst.some((o) => o.own !== t && hit(r, o)) && !placed.some((o) => hit(r, o));
    const rect = (t, cx, cy) => {
      const x = Math.max(m6, Math.min(W - m6 - t.w, cx - t.w / 2)), y = Math.max(top, Math.min(H - m6 - h, cy - h / 2));
      return { x, y, w: t.w, h: h, cx: x + t.w / 2, cy: y + h / 2 };
    };
    for (const t of items) {
      const dxr = t.ax - icx, dyr = t.ay - icy, dl = Math.hypot(dxr, dyr) || 1, ux = dxr / dl, uy = dyr / dl;
      const below = 26 * U + h / 2, side = t.w / 2 * 0.7;
      const cand = [[0, below], [0, -below - 6 * U], [-side, below], [side, below], [-side, -below - 6 * U], [side, -below - 6 * U]];
      for (let k = 1; k <= 8; k++) {
        const d = 24 * U + k * (h + 4 * U);
        cand.push([ux * d, uy * d], [ux * d - uy * t.w * 0.35, uy * d + ux * h], [ux * d + uy * t.w * 0.35, uy * d - ux * h]);
      }
      // a cluster at the screen edge squeezes the radial slots together: also stack straight
      // down/up and try the inward direction
      for (let k = 1; k <= 6; k++) {
        const d = below + k * (h + 4 * U), r = 24 * U + k * (h + 4 * U);
        cand.push([0, d], [0, -d - 6 * U], [-ux * r, -uy * r]);
      }
      const prev = tagPos[t.s.pid];
      let pick = null, pi = -1;
      if (prev && prev.slot < cand.length) { const r = rect(t, t.ax + cand[prev.slot][0], t.ay + cand[prev.slot][1]); if (free(r, t)) { pick = r; pi = prev.slot; } }
      for (let i = 0; !pick && i < cand.length; i++) { const r = rect(t, t.ax + cand[i][0], t.ay + cand[i][1]); if (free(r, t)) { pick = r; pi = i; } }
      if (!pick) {   // nothing free: least overlap with what is already placed
        let best = 1e18;
        cand.forEach((c, i) => {
          const r = rect(t, t.ax + c[0], t.ay + c[1]); let a = 0;
          for (const o of placed.concat(obst)) if (o.own !== t && hit(r, o)) a += (Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x)) * (Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y));
          if (a < best) { best = a; pick = r; pi = i; }
        });
      }
      placed.push(pick);
      t.slot = pi; t.tr = pick;
    }
    // smooth movement; labels vanish from tagPos when their ship is gone
    const live = {};
    for (const t of items) {
      const p = tagPos[t.s.pid];
      const dt = p ? Math.min(0.1, Math.max(0, (now - p.at) / 1000)) : 0, k = p ? 1 - Math.exp(-dt * 10) : 1;
      const cur = p ? { x: p.x + (t.tr.cx - p.x) * k, y: p.y + (t.tr.cy - p.y) * k } : { x: t.tr.cx, y: t.tr.cy };
      live[t.s.pid] = tagPos[t.s.pid] = { slot: t.slot, x: cur.x, y: cur.y, at: now };
      t.cx = cur.x; t.cy = cur.y;
    }
    for (const k of Object.keys(tagPos)) if (!live[k]) delete tagPos[k];
    // leader lines first (under the pills), then pills
    for (const t of items) {
      const dist = Math.hypot(t.cx - t.ax, t.cy - (t.ay + 26 * U + h / 2));
      if (t.slot === 0 && dist < 6 * U) continue;
      const ex = Math.max(t.cx - t.w / 2, Math.min(t.cx + t.w / 2, t.ax)), ey = t.cy < t.ay ? t.cy + h / 2 : t.cy - h / 2;
      g.strokeStyle = t.m.color; g.globalAlpha = 0.75; g.lineWidth = 2 * U; g.lineCap = 'round';
      g.beginPath(); g.moveTo(t.ax, t.ay + (t.cy < t.ay ? -10 * U : 10 * U)); g.lineTo(ex, ey); g.stroke(); g.globalAlpha = 1;
    }
    for (const t of items) {
      const x = t.cx - t.w / 2, y = t.cy - h / 2;
      panel(x, y, t.w, h, t.m.color, 0.78);
      g.font = FONT(px);
      const w1 = g.measureText(t.L.pre).width, w2 = g.measureText(t.m.short).width;
      txt(t.L.pre, x + 8 * U, t.cy + 1, px, '#fff');
      txt(t.m.short, x + 8 * U + w1, t.cy + 1, px, t.m.color);
      if (t.L.bits) txt(t.L.bits, x + 8 * U + w1 + w2, t.cy + 1, px, '#fff');
    }
  }

  function drawBanners(now) {
    banners = banners.filter((b) => now - b.at < b.ms);
    const b = banners[banners.length - 1];
    if (!b) { tagBanner = null; return; }
    const age = now - b.at, a = age < 250 ? age / 250 : age > b.ms - 500 ? Math.max(0, (b.ms - age) / 500) : 1;
    const px = 40 * U, maxW = g.canvas.width - 80 * U;
    const sizes = b.lines.map((l, i) => fitPx(l, maxW - 60 * U, i ? px * 0.55 : px));
    const w = Math.min(maxW, Math.max.apply(null, b.lines.map((l, i) => { g.font = FONT(sizes[i]); return g.measureText(l).width; })) + 70 * U);
    const lh = sizes.map((s) => s * 1.3), h = lh.reduce((p, c) => p + c, 0) + 24 * U;
    const x = g.canvas.width / 2 - w / 2, y = 112 * U;
    tagBanner = { x, y, w, h };
    g.save(); g.globalAlpha = a;
    panel(x, y, w, h, b.color, 0.82);
    let yy = y + 12 * U;
    b.lines.forEach((l, i) => { txt(l, g.canvas.width / 2, yy + lh[i] / 2, sizes[i], i ? '#cfe0ff' : '#fff', 'center'); yy += lh[i]; });
    g.restore();
  }

  function drawFeed(now) {
    feed = feed.filter((f) => now - f.at < FEED_MS);
    const px = 16 * U, lh = px + 10 * U;
    feed.forEach((f, i) => {
      const age = now - f.at, a = age > FEED_MS - 800 ? Math.max(0, (FEED_MS - age) / 800) : 1;
      g.font = FONT(px);
      const w = g.measureText(f.text).width + 24 * U, y = g.canvas.height - 12 * U - (feed.length - i) * (lh + 4 * U);
      g.globalAlpha = a;
      panel(10 * U, y, w, lh, f.color, 0.7);
      txt(f.text, 22 * U, y + lh / 2 + 1, px, '#fff');
    });
    g.globalAlpha = 1;
  }

  function drawIntro(now) {
    const el = now - phaseAt, a = el < 400 ? el / 400 : el > INTRO_MS - 900 ? Math.max(0, (INTRO_MS - el) / 900) : 1;
    g.save(); g.globalAlpha = a;
    txt('🎈 Skyfarers', g.canvas.width / 2, g.canvas.height * 0.4, 82 * U, '#ffe27a', 'center');
    txt('Haltet die Insel bis zum Morgengrauen!', g.canvas.width / 2, g.canvas.height * 0.4 + 62 * U, 26 * U, '#fff', 'center');
    g.restore();
  }

  function drawEnd(now) {
    const e = endInfo; if (!e) return;
    const delay = e.survived ? 700 : 3200, a = clampN((now - endAt - delay) / 700, 0, 1);
    if (a <= 0) return;
    const W = g.canvas.width, H = g.canvas.height;
    g.save(); g.globalAlpha = a;
    g.fillStyle = 'rgba(3,6,18,.78)'; g.fillRect(0, 0, W, H);
    txt(e.survived ? '🌅 Die Insel hat überlebt!' : '🌊 Die Insel ist gesunken…', W / 2, 62 * U, 44 * U, e.survived ? '#ffe27a' : '#ff8a8a', 'center');
    let stars = '';
    for (let i = 0; i < 3; i++) stars += i < e.stars ? '⭐' : '☆';
    txt(stars, W / 2, 130 * U, 70 * U, e.stars ? '#ffe27a' : '#8a93b0', 'center');
    const sub = e.stars === 3 ? 'Sternwarte vollendet, Herz stark — perfekt!' : e.stars === 2 ? 'Sternwarte vollendet' : e.stars === 1 ? 'Überlebt — baut die Sternwarte für mehr Sterne' : 'Beim nächsten Mal klappt es!';
    txt(sub, W / 2, 182 * U, 20 * U, '#cfe0ff', 'center');
    if (e.mvp) txt('⭐ Kapitän der Runde: ' + e.mvp.name, W / 2, 218 * U, 26 * U, e.mvp.color, 'center');

    const cols = [['📦', 'delivered'], ['🔨', 'built'], ['🔥', 'fires'], ['🐉', 'dragonHits'], ['🔧', 'repairs']];
    const tw = Math.min(W - 60 * U, 760 * U), x0 = W / 2 - tw / 2, rowH = 30 * U, y0 = 252 * U;
    const colW = 74 * U, scoreX = x0 + tw - 16 * U, c0 = scoreX - colW * (cols.length + 1) + colW * 0.2;
    panel(x0 - 8 * U, y0 - 6 * U, tw + 16 * U, rowH * (e.rows.length + 1) + 12 * U, 'rgba(160,190,255,.4)', 0.7);
    cols.forEach((c, i) => txt(c[0], c0 + colW * i + colW * 0.8, y0 + rowH / 2, 18 * U, '#cfe0ff', 'right'));
    txt('Punkte', scoreX, y0 + rowH / 2, 16 * U, '#cfe0ff', 'right');
    e.rows.forEach((r, i) => {
      const y = y0 + rowH * (i + 1);
      txt((r.pid === (e.mvp && e.mvp.pid) ? '⭐ ' : '') + r.name, x0 + 12 * U, y + rowH / 2, fitPx(r.name, 250 * U, 18 * U), r.color);
      cols.forEach((c, k) => txt(String(Math.round(r.stats[c[1]] || 0)), c0 + colW * k + colW * 0.8, y + rowH / 2, 18 * U, '#fff', 'right'));
      txt(String(Math.round(r.score)), scoreX, y + rowH / 2, 20 * U, '#ffe27a', 'right');
    });
    const hy = Math.min(H - 30 * U, y0 + rowH * (e.rows.length + 1) + 44 * U);
    txt('Host (' + shortName(hostId()) + '): 🔁 Nochmal am Handy drücken', W / 2, hy, 22 * U, '#ffe27a', 'center');
    g.restore();
  }

  function drawHud(now, alpha) {
    g = hctx; U = skHud.height / 600;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, skHud.width, skHud.height);
    const st = sim.state;
    g.save();
    if (phase === 'end') {
      tagBanner = null;
      drawEnd(now);
    } else {
      drawCloudMarks(st, alpha, now);
      drawShipTags(st, alpha, now);
      drawTopBar(st);
      drawFeed(now);
      if (phase === 'intro') drawIntro(now); else drawBanners(now);
    }
    g.restore();
  }

  // ---------- Instanz ----------
  return {
    acceptsJoin: true,

    start(ids, c) {
      cfg = Object.assign({ dauer: 'normal', schwierigkeit: 'normal', bots: 1, quality: 'auto' }, c || {});
      Sim = window.SkyfarersSim; World = window.SkyfarersWorld;
      blit = /[?&]blit=1\b/.test(location.search);
      view = (Sim && World) ? ensureView() : null;
      if (!view) { endToLobby('🎈 Skyfarers braucht einen Browser mit WebGL.'); return; }
      curQuality = cfg.quality === 'low' ? 'low' : 'high'; autoDone = false;
      safe('setQuality', () => view.setQuality(curQuality));
      syncHudSize();
      showWrap(true);
      seats = ids.slice(0, MAX_SHIPS); spectators = ids.slice(MAX_SHIPS);
      matchNo = 0; lastHost = hostId();
      startMatch();
    },

    stop() {
      timers.forEach(clearTimeout); timers = [];
      safe('sound', () => { SkyfarersSound.engine(0); SkyfarersSound.ambience(null); });
      showWrap(false); cv.style.display = '';
      phase = 'idle'; sim = null; view = null; hctx = null; endInfo = null;
    },

    onConnect(id) {
      if (!sim || known().includes(id)) return;
      if (phase !== 'end' && seats.length < MAX_SHIPS && shipOf(id) == null && sim.addCaptain(id, false)) {
        seats.push(id);
        meta[id] = { pid: id, bot: false, name: nameOf(id), short: shortName(id), color: colorP(id) };
        safe('setLook', () => view.setLook(lookOf()));
        pushFeed('⚓ ' + meta[id].short + ' kommt an Bord', meta[id].color);
      } else spectators.push(id);
      // Die Shell schickt enterGame NACH onConnect (Handy setzt sich zurück) → verzögert antworten
      later(() => {
        if (!known().includes(id) || !sim) return;
        send(id, infoFor(id)); send(id, phaseFor(id));
        delete youSent[id]; delete baseSent[id];
      }, 120);
    },

    onDisconnect(id) {
      spectators = spectators.filter((x) => x !== id);
      if (!seats.includes(id)) return;
      seats = seats.filter((x) => x !== id);
      delete youSent[id]; delete baseSent[id];
      const m = meta[id];
      if (sim) { sim.removeCaptain(id); delete meta[id]; safe('setLook', () => view.setLook(lookOf())); }
      if (m) pushFeed('⚓ ' + m.short + ' geht vor Anker', m.color);
      // freed ship → first spectator takes the place
      while (sim && phase !== 'end' && spectators.length && seats.length < MAX_SHIPS) {
        const nid = spectators.shift();
        if (!players[nid] || !sim.addCaptain(nid, false)) continue;
        seats.push(nid);
        meta[nid] = { pid: nid, bot: false, name: nameOf(nid), short: shortName(nid), color: colorP(nid) };
        safe('setLook', () => view.setLook(lookOf()));
        send(nid, infoFor(nid)); send(nid, phaseFor(nid));
      }
      if (!seats.length) { endToLobby('🎈 Skyfarers: alle Kapitäne sind weg.'); return; }
    },

    onMessage(id, d) {
      if (!d || typeof d.t !== 'string' || !sim || !seats.includes(id)) return;
      const inGame = phase === 'live' || phase === 'intro';
      switch (d.t) {
        case 'skStick':
          if (!inGame || !isNum(d.x) || !isNum(d.y)) return;
          sim.input(id, { sx: clampN(d.x, -1, 1), sy: clampN(d.y, -1, 1) });
          break;
        case 'skBoost':
          if (!inGame || typeof d.on !== 'boolean') return;
          sim.input(id, { boost: d.on });
          break;
        case 'skAct':
          if (!inGame || typeof d.on !== 'boolean') return;
          sim.input(id, { act: d.on });
          break;
        case 'skBuild': {
          if (phase !== 'live' || typeof d.kind !== 'string' || !Object.prototype.hasOwnProperty.call(World.BUILDINGS, d.kind)) return;
          const b = World.BUILDINGS[d.kind];
          const r = sim.build(id, d.kind);
          if (r.ok) toast(id, '🔨 ' + b.icon + ' ' + b.name + ' wird gebaut');
          else if (r.reason === 'notDocked') toast(id, '⚓ Zum Bauen an der Insel andocken');
          else if (r.reason === 'cost') {
            const co = costOf(d.kind), miss = [];
            if (sim.state.stock.holz < co.holz) miss.push('🪵 ' + (co.holz - sim.state.stock.holz));
            if (sim.state.stock.kristall < co.kristall) miss.push('💎 ' + (co.kristall - sim.state.stock.kristall));
            toast(id, '❌ Zu wenig Material (es fehlt ' + (miss.join(' + ') || 'etwas') + ')');
          } else if (r.reason === 'noSlot') toast(id, '❌ Kein Bauplatz mehr frei');
          else if (r.reason === 'stage') {
            const c = sim.state.slots[0];
            toast(id, c.kind === 'sternwarte' && c.stage >= b.stages && c.build >= 1 ? '🔭 Die Sternwarte ist schon komplett!' : '❌ Erst die aktuelle Stufe fertig bauen');
          } else toast(id, '❌ Das geht gerade nicht');
          delete baseSent[id];                         // show the new stock/slots right away
          break;
        }
        case 'skAgain':
          if (phase === 'end' && id === hostId()) newMatch();
          break;
        default: break;
      }
    },

    render() {
      if (!sim || !view || phase === 'idle') return;
      const now = performance.now();
      const rawMs = now - last, dt = clampN(rawMs / 1000, 0, 0.1); last = now;
      soundSeen = {};

      // Host-Wechsel → Flags neu senden (Nochmal-Button am neuen Host)
      const h = hostId();
      if (h !== lastHost) { lastHost = h; sendInfoAll(); sendPhaseAll(); }

      let alpha = 1, intro = 1;
      if (phase === 'intro') {
        const el = now - phaseAt;
        intro = clampN(el / INTRO_MS, 0, 1);
        if (el >= INTRO_MS) { intro = 1; toLive(now); }
      }
      if (phase === 'live') {
        acc += dt;
        let steps = 0;
        while (acc >= sim.dt && steps < 8 && phase === 'live') {
          const evs = sim.step(); acc -= sim.dt; steps++;
          handleEvents(evs);
          if (sim.state.over) break;
        }
        if (phase === 'live' && sim.state.over) toEnd(sim.state.survived, sim.state.stars);   // 'over' event missed (state advanced from outside)
        if (acc > sim.dt) acc = acc % sim.dt;              // dropped time instead of a death spiral
        alpha = phase === 'live' ? clampN(acc / sim.dt, 0, 1) : 1;
        const st = sim.state;
        for (const s of humanShips()) {                   // dock edge → push the build drawer data immediately
          if (s.docked && !lastDocked[s.pid]) delete baseSent[s.pid];
          lastDocked[s.pid] = s.docked;
        }
        safe('hints', tickHints);
        syncYou(now, false);
        syncBase(now);
        safe('sound', () => { SkyfarersSound.ambience(moodFor(st)); SkyfarersSound.engine(engineLevel(st)); });
        if (!firstFrame) sampleFrame(now, rawMs);
      }

      if (fast) return;
      safe('view.render', () => view.render(sim.state, alpha, { now, dt, intro, snap: firstFrame }));
      firstFrame = false;
      syncHudSize();
      safe('hud', () => drawHud(now, alpha));
      // Mitschauen: View + HUD alle 125 ms in cv; im ?blit=1-Modus jede Frame
      if (blit || now - mirrorAt >= MIRROR_MS) {
        mirrorAt = now;
        safe('mirror', () => { ctx.drawImage(view.canvas, 0, 0, cv.width, cv.height); ctx.drawImage(skHud, 0, 0, cv.width, cv.height); });
      }
    },

    // dev harness only: skip all drawing while fast-forwarding; the next drawn frame snaps weather and camera
    _fast(on) { fast = !!on; if (!fast) firstFrame = true; },

    _debug() { return { sim, phase, view, quality: curQuality, seats, spectators, meta, endInfo, autoDone, hintSt }; }
  };
}});
