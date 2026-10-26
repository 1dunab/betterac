// Wauwau-WG — TV backbone: lifecycle, the authoritative dog records, the day
// (home → walk → park → night), phone sync, the backup memory and the HUD.
// The world itself is drawn by scenes (home.js / walk.js / park.js) that
// register on WW.scenes — contract and message protocol: docs/WAUWAUWG.md.
registerGame({ key: 'wauwauwg', screen: function () {
  const W = cv.width, H = cv.height;
  const HUD_TOP = 34, HUD_BOTTOM = 62;      // scenes keep gameplay between these
  const BACKUP_KEY = 'wauwauwg.backup', BACKUP_MAX = 30;
  const SYNC_URGENT = 0.15, SYNC_IDLE = 2;  // s between wwYou pushes (event / decay only)
  const BACKUP_EVERY = 20;                  // s
  const PHASE_RESEND = 5;                   // s — refreshes phone countdowns + host flag
  const TITLE_TIME = 2.6;                   // s phase title card
  const NIGHT_MIN = 3;                      // s before the host may start the next day
  const CARE_GAP = 0.18;                    // s between counted pet/brush strokes
  const FONT = 'system-ui,sans-serif';

  // Messages can arrive BEFORE start() (the test bus is synchronous: a phone
  // answers enterGame with wwHello immediately), so per-player state lives in
  // the factory closure and start() merges instead of resetting.
  let order = [];                       // player ids in the game (with or without dog)
  const dogs = {};                      // id -> dog record (authoritative while playing)
  const today = {};                     // id -> WW.newToday()
  const sync = {};                      // id -> { dirty, urgent, last }
  const careAt = {};                    // id -> simT of last counted pet/brush
  let cfg = { tag: 'normal' }, rnd = Math.random;
  let started = false, day = 1, phase = 'home', phaseT = 0, phaseLen = 0;
  let simT = 0, lastNow = 0, backupAt = 0, resendAt = 0;
  const scenes = {};
  let scene = null;
  let title = null, floats = [], toasts = [], night = null, nightBottom = 0;

  const dogIds = () => order.filter(id => dogs[id]);
  const todayOf = (id) => today[id] || (today[id] = WW.newToday());

  // ---------- phone sync ----------
  function markDirty(id, urgent) {
    const s = sync[id] || (sync[id] = { dirty: false, urgent: false, last: -99 });
    s.dirty = true;
    if (urgent) s.urgent = true;
  }
  function sendYou(id) {
    const dog = dogs[id];
    if (!dog) return;
    const td = todayOf(id);
    // slot = the phone's storage slot (owner name): desktop tabs share localStorage
    ac.message(id, { t: 'wwYou', dog, today: { love: td.love, coins: td.coins, finds: td.finds.slice() }, level: WW.loveLevel(dog.love), slot: nameKey(id) });
    const s = sync[id] || (sync[id] = {});
    s.dirty = false; s.urgent = false; s.last = simT;
  }
  function flushSync() {
    dogIds().forEach(id => {
      const s = sync[id];
      if (s && s.dirty && simT - s.last >= (s.urgent ? SYNC_URGENT : SYNC_IDLE)) sendYou(id);
    });
  }
  function sendPhase(id) {
    ac.message(id, { t: 'wwPhase', phase, day, left: phaseLen ? Math.max(0, Math.ceil(phaseLen - phaseT)) : -1, host: id === hostId() });
  }
  const sendPhaseAll = () => order.forEach(sendPhase);
  function sendNight(id) {
    if (!night) return;
    ac.message(id, {
      t: 'wwNight', host: id === hostId(),
      rows: night.rows.map(r => ({ owner: r.owner, dog: r.dog, love: r.love, coins: r.coins, finds: r.finds, best: night.best.indexOf(r.id) >= 0, you: r.id === id }))
    });
  }

  // ---------- feedback ----------
  // Phone toast (+ vibration) and, unless float === false, a TV floater above the dog.
  function event(id, text, o) {
    o = o || {};
    if (!text) return;
    ac.message(id, { t: 'wwEvent', text, kind: o.kind || 'info', item: o.item || null });
    if (o.float !== false) floatAt(id, o.floatText || text, o.color);
  }
  function floatAt(id, text, color) {
    const p = scene && scene.dogPos ? scene.dogPos(id) : null;
    if (p) addFloat(p.x, p.y, text, color);
  }
  // Floaters born at the same spot stack upwards instead of overlapping.
  function addFloat(x, y, text, color) {
    const near = floats.filter(f => simT - f.t0 < 0.7 && Math.abs(f.x - x) < 90 && Math.abs(f.y0 - y) < 26).length;
    floats.push({ x, y: y - near * 24, y0: y, text, color: color || '#fff', t0: simT });
  }
  function tvToast(text) { toasts.push({ text, t0: simT }); if (toasts.length > 3) toasts.shift(); }
  function checkLevel(id, before) {
    const dog = dogs[id], l = dog ? WW.loveLevel(dog.love) : 0;
    if (dog && l > before) {
      event(id, '💖 ' + dog.name + ' & du: ' + WW.LOVE_NAMES[l] + '!', { kind: 'good', floatText: '💖 ' + WW.LOVE_NAMES[l], color: '#ff6f91' });
      api.sfx('powerup');
    }
  }

  // ---------- the scene API (see docs/WAUWAUWG.md §Scenes) ----------
  const api = {
    W, H, TOP: HUD_TOP, BOTTOM: H - HUD_BOTTOM,
    rnd: () => rnd(),
    time: () => simT,
    phase: () => phase,
    day: () => day,
    ids: dogIds,
    dog: (id) => dogs[id] || null,
    color: (id) => (players[id] && players[id].color) || '#888',
    owner: (id) => shortName(id),
    speed: (id) => dogs[id] ? WW.speedFactor(dogs[id]) : 1,
    tired: (id) => !!dogs[id] && WW.isTired(dogs[id]),
    love(id, n, source) {
      const dog = dogs[id];
      if (!dog) return 0;
      const before = WW.loveLevel(dog.love);
      const add = WW.addLove(dog, todayOf(id), n, source);
      if (add) { markDirty(id, true); checkLevel(id, before); }
      return add;
    },
    coins(id, n) {
      if (!dogs[id]) return 0;
      const add = WW.addCoins(dogs[id], todayOf(id), n);
      markDirty(id, true);
      return add;
    },
    needs(id, delta) { if (dogs[id]) { WW.changeNeeds(dogs[id], delta); markDirty(id, false); } },
    find(id, key) {
      if (!dogs[id]) return null;
      const r = WW.giveFind(dogs[id], todayOf(id), key, rnd);
      markDirty(id, true);
      return r;
    },
    stat(id, key, n) {
      const dog = dogs[id];
      if (dog && key in dog.stats) { dog.stats[key] += n == null ? 1 : n; markDirty(id, false); }
    },
    event,
    float: (x, y, text, color) => addFloat(x, y, text, color),
    floatAt,
    send: (id, msg) => ac.message(id, msg),
    sfx: (name) => { if (WW.sound) WW.sound(name); else sfx(name); }
  };

  // Keeps the game playable while a scene file is still a placeholder.
  function fallbackScene(key) {
    let ids = [];
    const pos = (i) => ({ x: 110 + (i % 8) * 105, y: 430 });
    return {
      enter(list) { ids = list.slice(); },
      leave() {},
      addDog(id) { if (ids.indexOf(id) < 0) ids.push(id); },
      removeDog(id) { ids = ids.filter(o => o !== id); },
      onMessage() {},
      update() {},
      draw(o) {
        o.fillStyle = key === 'home' ? (phase === 'night' ? '#1c1f3a' : '#3a2f45') : key === 'walk' ? '#35506b' : '#2f5a3a';
        o.fillRect(0, 0, W, H);
        o.fillStyle = 'rgba(255,255,255,.08)'; o.fillRect(0, 440, W, H - 440);
        o.fillStyle = 'rgba(255,255,255,.35)'; o.font = 'bold 20px ' + FONT; o.textAlign = 'center'; o.textBaseline = 'middle';
        o.fillText('(Szene „' + key + '“ folgt)', W / 2, 120);
        ids.forEach((id, i) => {
          const p = pos(i);
          WW.art.drawDog(o, dogs[id], p.x, p.y, { pose: phase === 'night' ? 'sleep' : 'stand', t: simT, wag: 0.6 });
        });
      },
      dogPos(id) { const i = ids.indexOf(id); return i < 0 ? null : { x: pos(i).x, y: pos(i).y - 90 }; }
    };
  }
  function sceneFor(p) {
    const key = p === 'night' ? 'home' : p;
    if (!scenes[key]) scenes[key] = WW.scenes[key] ? WW.scenes[key](api) : fallbackScene(key);
    return scenes[key];
  }

  // ---------- day / phases ----------
  function setPhase(p) {
    if (scene && scene.leave) scene.leave();
    phase = p; phaseT = 0;
    phaseLen = p === 'night' ? 0 : ((WW.DAY[cfg.tag] || WW.DAY.normal)[p] || 60);
    scene = sceneFor(p);
    scene.enter(dogIds(), { day, night: p === 'night' });
    title = { text: WW.PHASE_INFO[p].emoji + ' ' + WW.PHASE_INFO[p].label, sub: 'Tag ' + day, t0: simT };
    if (p === 'walk') dogIds().forEach(id => api.stat(id, 'walks'));
    sfx.ambient(p === 'walk' || p === 'park' ? 'wind' : null);
    api.sfx('go');
    if (p === 'night') beginNight();
    sendPhaseAll();
  }
  function nextPhase() { setPhase(WW.PHASES[Math.min(WW.PHASES.indexOf(phase) + 1, WW.PHASES.length - 1)]); }
  function beginNight() {
    const ids = dogIds();
    let best = [], max = 0;
    ids.forEach(id => {
      const l = todayOf(id).love;
      if (l > max) { max = l; best = [id]; } else if (l === max && l > 0) best.push(id);
    });
    night = {
      at: simT, best,
      rows: ids.map(id => ({ id, owner: nameOf(id), dog: dogs[id].name, love: todayOf(id).love, coins: todayOf(id).coins, finds: todayOf(id).finds.slice() }))
        .sort((a, b) => b.love - a.love)
    };
    if (ids.length >= 2 && best.length) { reportWinners(best); api.sfx('fanfare'); }
    ids.forEach(id => { WW.endDay(dogs[id]); sendYou(id); });
    saveBackup();
    order.forEach(sendNight);
  }
  function nextDay() {
    day++;
    night = null;
    order.forEach(id => { today[id] = WW.newToday(); });
    dogIds().forEach(id => WW.wakeUp(dogs[id]));
    setPhase('home');
    dogIds().forEach(sendYou);
  }

  // ---------- dogs joining / leaving ----------
  function addDog(id, dog, isNew) {
    // A dog (uid) lives only once in the WG: a phone that came back under a new
    // device id takes its dog along from the stale seat.
    order.forEach(o => { if (o !== id && dogs[o] && dogs[o].uid === dog.uid) removeDog(o); });
    if (order.indexOf(id) < 0) order.push(id);
    dogs[id] = dog;
    todayOf(id);
    if (scene && scene.addDog) scene.addDog(id);
    tvToast(isNew ? '🐶 ' + dog.name + ' zieht in die WG ein!' : '🏠 ' + dog.name + ' ist da!');
    api.sfx(isNew ? 'powerup' : 'woof');
    saveBackup([id]);
    sendPhase(id);
    sendYou(id);
    if (night) sendNight(id);
  }
  function removeDog(id) {
    if (!dogs[id]) return;
    if (scene && scene.removeDog) scene.removeDog(id);
    delete dogs[id];
  }
  function onHello(id, raw) {
    if (dogs[id]) { sendPhase(id); sendYou(id); if (night) sendNight(id); return; }
    const dog = WW.sanitizeDog(raw);
    if (dog) { addDog(id, dog, false); return; }
    const b = backupFor(id);
    ac.message(id, { t: 'wwAdopt', backup: b ? { name: b.name, breed: b.breed, coat: b.coat } : null });
    sendPhase(id);
  }

  // ---------- care + shop ----------
  function onCare(id, d) {
    if (phase !== 'home' && phase !== 'night') return;
    const act = String(d.act || '');
    if (act === 'pet' || act === 'brush') {
      if (careAt[id] != null && simT - careAt[id] < CARE_GAP) return;
      careAt[id] = simT;
    }
    const dog = dogs[id], before = WW.loveLevel(dog.love);
    const r = WW.care(dog, todayOf(id), act, act === 'pet' ? d.zone : d.item);
    if (r.text) event(id, r.text, { kind: r.ok ? 'good' : 'bad', float: r.ok && act !== 'pet' });
    if (r.love >= 2 && act !== 'pet' && act !== 'brush') floatAt(id, '+' + r.love + ' ❤️', '#ff6f91');
    if (scene && scene.onCare) scene.onCare(id, act, r);
    checkLevel(id, before);
    sendYou(id);              // direct phone actions answer at once
  }
  function onShop(id, d) {
    if (phase !== 'home' && phase !== 'night') { event(id, '🛒 Der Laden hat nur morgens und abends offen', { kind: 'bad', float: false }); return; }
    const dog = dogs[id], key = String(d.item || '');
    const r = d.t === 'wwBuy' ? WW.buy(dog, key) : WW.sell(dog, key, todayOf(id));
    event(id, r.text, { kind: r.ok ? 'good' : 'bad', float: false });
    if (r.ok) { api.sfx('coin'); if (d.t === 'wwBuy') floatAt(id, WW.ITEMS[key].emoji); }
    sendYou(id);
  }

  // ---------- backup memory (screen localStorage, keyed by player name) ----------
  // A phone's localStorage is per origin — a new LAN IP or a new phone would
  // orphan the dog. The TV remembers every dog by owner name and offers it back.
  // The shell drops players[id] BEFORE onDisconnect, so remember each seat's key.
  const seatKey = {};
  function nameKey(id) {
    if (!players[id]) return seatKey[id] || '';
    const k = String(nameOf(id) || '').trim().toLowerCase();
    return (seatKey[id] = /^spieler \d+$/.test(k) ? '' : k);   // shell default names are not identities
  }
  function loadBackup() {
    try { const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || '{}'); return b && typeof b === 'object' ? b : {}; } catch (e) { return {}; }
  }
  function saveBackup(ids) {
    try {
      const b = loadBackup();
      (ids || dogIds()).forEach(id => { const k = nameKey(id); if (k && dogs[id]) b[k] = { t: Date.now(), dog: dogs[id] }; });
      Object.keys(b).sort((x, y) => (b[y].t || 0) - (b[x].t || 0)).slice(BACKUP_MAX).forEach(k => { delete b[k]; });
      localStorage.setItem(BACKUP_KEY, JSON.stringify(b));
    } catch (e) {}
  }
  function dropBackup(id) {
    try { const b = loadBackup(); delete b[nameKey(id)]; localStorage.setItem(BACKUP_KEY, JSON.stringify(b)); } catch (e) {}
  }
  function backupFor(id) {
    const k = nameKey(id), e = k && loadBackup()[k];
    const dog = e && WW.sanitizeDog(e.dog);
    return dog && !dogIds().some(o => dogs[o].uid === dog.uid) ? dog : null;
  }

  // ---------- simulation ----------
  function step(dt) {
    if (!started) return;
    simT += dt;
    const ids = dogIds();
    if (phaseLen && ids.length) {          // the day waits while nobody has a dog yet
      phaseT += dt;
      if (phaseT >= phaseLen) nextPhase();
    }
    dogIds().forEach(id => { WW.decay(dogs[id], dt, phase); markDirty(id, false); });
    if (scene) scene.update(dt);
    floats = floats.filter(f => simT - f.t0 < 1.8);
    toasts = toasts.filter(t => simT - t.t0 < 3.5);
    flushSync();
    if (simT - backupAt > BACKUP_EVERY) { backupAt = simT; saveBackup(); }
    if (simT - resendAt > PHASE_RESEND) { resendAt = simT; if (phaseLen) sendPhaseAll(); }
  }

  // ---------- drawing (HUD on top of the scene) ----------
  const PHASE_COLOR = { home: '#ffd60a', walk: '#64d2ff', park: '#30d158', night: '#bf8cff' };
  const ease = (k) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);
  function txt(s, x, y, size, color, align, weight) {
    ctx.font = (weight || 'bold') + ' ' + size + 'px ' + FONT;
    ctx.fillStyle = color; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }
  // Text with a dark rim: readable on the bright flat and at night alike.
  function outlined(s, x, y, size, color, align, weight) {
    ctx.font = (weight || 'bold') + ' ' + size + 'px ' + FONT;
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size * 0.24); ctx.strokeStyle = 'rgba(24,16,34,.78)';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  }
  function heart(x, y, s, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.4, y, x - s * 0.9, y - s * 1.1, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.9, y - s * 1.1, x + s * 1.4, y, x, y + s * 0.9);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
  }
  function panel(x, y, w, h, r, fill, border) {
    ctx.fillStyle = 'rgba(0,0,0,.3)'; rr(ctx, x + 2, y + 4, w, h, r); ctx.fill();
    ctx.fillStyle = fill; rr(ctx, x, y, w, h, r); ctx.fill();
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 2; rr(ctx, x + 1, y + 1, w - 2, h - 2, r - 1); ctx.stroke(); }
  }
  function drawTopBar() {
    const g = ctx.createLinearGradient(0, 0, 0, HUD_TOP);
    g.addColorStop(0, 'rgba(14,12,30,.82)'); g.addColorStop(1, 'rgba(14,12,30,.62)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, HUD_TOP);
    const inf = WW.PHASE_INFO[phase], col = PHASE_COLOR[phase];
    ctx.fillStyle = col; rr(ctx, 8, 6, 62, HUD_TOP - 12, 11); ctx.fill();
    txt('Tag ' + day, 39, HUD_TOP / 2 + 1, 14, '#1a1426');
    txt(inf.emoji + ' ' + inf.label, 80, HUD_TOP / 2 + 1, 16, '#fff', 'left');
    if (phaseLen && !dogIds().length) {
      txt('⏸ Die Uhr läuft, sobald ein Hund da ist', W - 12, HUD_TOP / 2 + 1, 14, 'rgba(255,255,255,.8)', 'right', '600');
    } else if (phaseLen) {
      const left = Math.max(0, Math.ceil(phaseLen - phaseT)), bw = 170, bx = W - bw - 70;
      ctx.fillStyle = 'rgba(255,255,255,.14)'; rr(ctx, bx, 12, bw, 10, 5); ctx.fill();
      ctx.fillStyle = col; rr(ctx, bx, 12, Math.max(10, bw * (1 - phaseT / phaseLen)), 10, 5); ctx.fill();
      const urgent = left <= 10 && (simT % 1) < 0.5;
      txt('⏱ ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'), W - 12, HUD_TOP / 2 + 1, 16, urgent ? col : '#fff', 'right');
    } else if (phase === 'night') {
      txt('⭐ Host startet am Handy den nächsten Tag', W - 12, HUD_TOP / 2 + 1, 14, 'rgba(255,255,255,.8)', 'right', '600');
    }
  }
  function drawCard(id, x, y, w, h) {
    const dog = dogs[id], col = api.color(id);
    panel(x, y, w, h, 12, 'rgba(20,18,40,.9)', dog ? col : null);
    if (!dog) {
      ctx.setLineDash([5, 4]); ctx.strokeStyle = col; ctx.lineWidth = 2; rr(ctx, x + 1, y + 1, w - 2, h - 2, 11); ctx.stroke(); ctx.setLineDash([]);
      const dots = '.'.repeat(1 + Math.floor(simT * 2) % 3);
      txt('🏠', x + 22, y + h / 2, 20, '#fff');
      ctx.save(); fitFont(ctx, shortName(id), w - 50, 14); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(shortName(id), x + 40, y + 17); ctx.restore();
      txt('adoptiert' + dots, x + 40, y + 34, 12, 'rgba(255,255,255,.6)', 'left', '600');
      return;
    }
    // portrait medallion
    const narrow = w < 150, r = narrow ? 15 : h / 2 - 6, mx = x + 6 + r, my = y + h / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
    ctx.clip();
    WW.art.drawPortrait(ctx, dog, mx, my + r * 0.55, r * 2.7, { t: simT + id * 1.7, happy: dog.needs.mood > 75 ? 0.6 : 0, dirt: Math.max(0, (40 - dog.needs.clean) / 40) });
    ctx.restore();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.stroke();
    const tx = mx + r + 8, tw = x + w - 8 - tx, level = WW.loveLevel(dog.love);
    const wide = tw >= 112;
    ctx.save();
    fitFont(ctx, dog.name, wide ? tw - 54 : tw, 15);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(dog.name, tx, y + 14);
    ctx.restore();
    if (wide) {
      for (let i = 0; i < 5; i++) heart(x + w - 46 + i * 9.5, y + 14, 4.2, i < level ? '#ff6f91' : 'rgba(255,255,255,.12)', i < level ? null : 'rgba(255,255,255,.25)');
    } else {
      heart(mx + r * 0.8, my + r * 0.62, 7.5, '#ff6f91', 'rgba(20,18,40,.9)');
      txt(String(level), mx + r * 0.8, my + r * 0.62 + 0.5, 9, '#fff');
    }
    ctx.save();
    ctx.font = '600 ' + fitFont(ctx, shortName(id), tw, 11) + 'px ' + FONT;   // never read ctx.font (JSDOM)
    ctx.fillStyle = 'rgba(255,255,255,.58)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(shortName(id), tx, y + 29);
    ctx.restore();
    // need bars (low ones blink red) + an emoji badge for the most urgent need
    const bw = tw / 5;
    WW.NEEDS.forEach((k, i) => {
      const v = dog.needs[k], bx = tx + i * bw, low = v < WW.LOW;
      ctx.fillStyle = 'rgba(255,255,255,.12)'; rr(ctx, bx, y + h - 13, bw - 3, 6, 3); ctx.fill();
      ctx.fillStyle = low && (simT * 2 % 1) < 0.5 ? '#ff453a' : WW.NEED_INFO[k].color;
      rr(ctx, bx, y + h - 13, Math.max(4, (bw - 3) * v / 100), 6, 3); ctx.fill();
    });
    const urgent = WW.urgentNeed(dog);
    if (urgent) {
      const pulse = 1 + 0.18 * Math.sin(simT * 7);
      ctx.fillStyle = '#ff453a'; ctx.beginPath(); ctx.arc(mx + r * 0.75, my - r * 0.72, 9 * pulse, 0, Math.PI * 2); ctx.fill();
      txt(WW.NEED_INFO[urgent].emoji, mx + r * 0.75, my - r * 0.72 + 1, Math.round(11 * pulse), '#fff');
    }
  }
  function drawCards() {
    const ids = order.slice(0, 8), n = ids.length;
    if (!n) return;
    const gap = 8, w = Math.min(224, (W - 16 - gap * (n - 1)) / n), h = 52;
    let x = (W - (w * n + gap * (n - 1))) / 2;
    ids.forEach(id => { drawCard(id, x, H - h - 6, w, h); x += w + gap; });
  }
  function drawFloats() {
    floats.forEach(f => {
      const a = (simT - f.t0) / 1.8;
      ctx.globalAlpha = Math.max(0, 1 - a * a);
      const size = Math.round(17 * (0.7 + 0.3 * ease(a * 6)));
      ctx.font = 'bold ' + size + 'px ' + FONT;
      const half = ctx.measureText(f.text).width / 2 + 6;   // keep the whole text on screen
      outlined(f.text, clamp(f.x, half, W - half), Math.max(HUD_TOP + 12, f.y - ease(a) * 46), size, f.color);
    });
    ctx.globalAlpha = 1;
  }
  function drawToasts() {
    toasts.forEach((t, i) => {
      const a = simT - t.t0, alpha = Math.max(0, Math.min(1, a * 4, (3.5 - a) * 2));
      // at night the summary owns the top: toasts stack up from above the cards
      const y = (phase === 'night' && night ? H - HUD_BOTTOM - 44 - (toasts.length - 1 - i) * 40 : HUD_TOP + 10 + i * 40) - (1 - ease(a * 4)) * 14;
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 17px ' + FONT;
      const w = ctx.measureText(t.text).width + 40;
      panel(W / 2 - w / 2, y, w, 32, 16, 'rgba(24,20,44,.9)', 'rgba(255,214,10,.55)');
      txt(t.text, W / 2, y + 17, 17, '#fff');
    });
    ctx.globalAlpha = 1;
  }
  function drawTitle() {
    if (!title) return;
    const a = (simT - title.t0) / TITLE_TIME;
    if (a >= 1) { title = null; return; }
    const col = PHASE_COLOR[phase];
    ctx.globalAlpha = Math.max(0, Math.min(1, a * 8, (1 - a) * 4));
    ctx.font = 'bold 38px ' + FONT;
    const w = Math.max(360, ctx.measureText(title.text).width + 90), h = 96;
    const top = phase === 'night' && night ? nightBottom + 16 : 196;   // never on top of the summary
    const x = (W - w) / 2, y = top - (1 - ease(a * 5)) * 40;
    panel(x, y, w, h, 22, 'rgba(22,18,42,.9)', col);
    txt(title.text, W / 2, y + 38, 38, '#fff');
    txt('🐾 ' + title.sub + ' 🐾', W / 2, y + 74, 17, col, 'center', '700');
    ctx.globalAlpha = 1;
  }
  function drawNight() {
    if (!night) return;
    const rows = night.rows.slice(0, 8), showBest = night.best.length && night.rows.length >= 2;
    const rowH = 27, top = showBest ? 76 : 50, w = 620;
    const h = top + Math.max(1, rows.length) * rowH + 10;
    const x = (W - w) / 2, y = HUD_TOP + 10;
    nightBottom = y + h;
    panel(x, y, w, h, 18, 'rgba(18,16,46,.9)', 'rgba(191,140,255,.7)');
    txt('🌙 Tagesbilanz · Tag ' + day, W / 2, y + 26, 21, '#fff');
    if (showBest) {
      const names = night.best.map(id => (night.rows.find(r => r.id === id) || {}).dog).filter(Boolean).join(' & ');
      txt('👑 Hund des Tages: ' + names, W / 2, y + 54, 16, '#ffd60a', 'center', '700');
    }
    if (!rows.length) txt('Heute war noch kein Hund in der WG.', W / 2, y + top + 12, 14, 'rgba(255,255,255,.7)', 'center', '600');
    rows.forEach((r, i) => {
      const ry = y + top + 10 + i * rowH, best = showBest && night.best.indexOf(r.id) >= 0;
      if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,.05)'; rr(ctx, x + 14, ry - 12, w - 28, 24, 8); ctx.fill(); }
      ctx.fillStyle = (players[r.id] && players[r.id].color) || '#888';
      ctx.beginPath(); ctx.arc(x + 30, ry, 5, 0, Math.PI * 2); ctx.fill();
      txt((best ? '👑 ' : '') + r.dog, x + 42, ry, 16, best ? '#ffd60a' : '#fff', 'left');
      txt(r.owner, x + 228, ry, 12, 'rgba(255,255,255,.55)', 'left', '600');
      heart(x + 352, ry, 5, '#ff6f91');
      txt('+' + r.love, x + 362, ry, 15, '#fff', 'left');
      txt('🪙 +' + r.coins, x + 420, ry, 15, '#fff', 'left', '600');
      const finds = r.finds.slice(0, 5).map(k => (WW.ITEMS[k] || {}).emoji || '').join(' ');
      txt(finds, x + w - 24, ry, 14, '#fff', 'right', '600');
    });
  }
  function drawWaiting() {
    const w = 700, h = 262, x = (W - w) / 2, y = 92;
    panel(x, y, w, h, 24, 'rgba(22,18,42,.88)', '#ffd60a');
    txt('🏠 Willkommen in der Wauwau-WG!', W / 2, y + 40, 30, '#fff');
    txt('Wer zieht heute ein? Adoptiert eure Hunde am Handy 📱', W / 2, y + 76, 17, '#ffd60a', 'center', '600');
    const keys = WW.BREED_KEYS, step = (w - 40) / keys.length;
    keys.forEach((k, i) => {
      const cx = x + 20 + step * (i + 0.5), cy = y + 166;
      const bob = Math.sin(simT * 2.2 + i * 0.9) * 2;
      ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.beginPath(); ctx.arc(cx, cy - 4, 36, 0, Math.PI * 2); ctx.fill();
      WW.art.drawPortrait(ctx, { breed: k, coat: (i + Math.floor(simT / 3)) % WW.BREEDS[k].coats.length, uid: k }, cx, cy + bob, 84, { t: simT + i * 0.7, happy: Math.sin(simT + i) > 0.6 ? 1 : 0, tongue: i % 3 === 0 });
      txt(WW.BREEDS[k].label, cx, y + 232, 12, 'rgba(255,255,255,.75)', 'center', '700');
    });
  }
  function draw() {
    if (scene) scene.draw(ctx);
    else { ctx.fillStyle = '#1b2433'; ctx.fillRect(0, 0, W, H); }
    drawFloats();
    drawTopBar();
    drawCards();
    if (phase === 'night') drawNight();
    if (started && !dogIds().length) drawWaiting();
    drawTitle();
    drawToasts();
  }

  return {
    acceptsJoin: true,   // latecomers adopt or bring their dog any time
    start(ids, c) {
      cfg = Object.assign({ tag: 'normal' }, c || {});
      rnd = cfg.seed != null ? WW.rng(cfg.seed) : Math.random;
      ids.forEach(id => { if (order.indexOf(id) < 0) order.push(id); todayOf(id); });
      started = true; day = 1; simT = 0; lastNow = 0;
      setPhase('home');
    },
    stop() {
      if (scene && scene.leave) scene.leave();
      saveBackup();
      started = false;
    },
    onConnect(id) { if (order.indexOf(id) < 0) order.push(id); todayOf(id); },
    canResume(id) { return order.indexOf(id) >= 0; },
    onReconnect(id) { sendPhase(id); if (dogs[id]) sendYou(id); if (night) sendNight(id); },
    onDisconnect(id) {
      if (dogs[id]) { saveBackup([id]); tvToast('💤 ' + dogs[id].name + ' macht ein Nickerchen'); removeDog(id); }
      order = order.filter(o => o !== id);
      delete sync[id];
      if (!order.length) { endToLobby('🐾 Die WG ist leer — bis bald!'); return; }
      sendPhaseAll();                         // the host may have changed
      if (night) order.forEach(sendNight);
    },
    onMessage(id, d) {
      if (!d || typeof d.t !== 'string' || !players[id]) return;
      if (order.indexOf(id) < 0) order.push(id);
      const dog = dogs[id];
      switch (d.t) {
        case 'wwHello': onHello(id, d.dog); return;
        case 'wwAdoptDone':
          if (dog) sendYou(id);
          else addDog(id, WW.newDog({ name: d.name, breed: d.breed, coat: d.coat }, rnd), true);
          return;
        case 'wwRestore': {
          if (dog) return;
          const b = backupFor(id);
          if (b) addDog(id, b, false); else ac.message(id, { t: 'wwAdopt', backup: null });
          return;
        }
        case 'wwMoveOut':
          if (!dog) return;
          tvToast('👋 ' + dog.name + ' zieht aus');
          removeDog(id); dropBackup(id);
          ac.message(id, { t: 'wwAdopt', backup: null });
          return;
        case 'wwCare': if (dog) onCare(id, d); return;
        case 'wwBuy': case 'wwSell': if (dog) onShop(id, d); return;
        case 'wwNext':
          if (phase !== 'night' || !night || id !== hostId()) return;
          if (simT - night.at >= NIGHT_MIN) nextDay();
          else event(id, '🌙 Einen Moment — erst die Tagesbilanz genießen', { kind: 'info', float: false });
          return;
        default:
          if (dog && scene && scene.onMessage) scene.onMessage(id, d);
      }
    },
    render() {
      const now = performance.now() / 1000;
      const dt = lastNow ? clamp(now - lastNow, 0, 0.05) : 0;
      lastNow = now;
      step(dt);
      draw();
    },
    _debug() {
      return {
        phase, day, phaseT, phaseLen, simT, order, dogs, today, night, scene, api,
        jump(p) { if (WW.PHASES.indexOf(p) >= 0) setPhase(p); }
      };
    }
  };
}});
