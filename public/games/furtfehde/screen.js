// ===== Modul: FURT & FEHDE (competitive castle-building RTS on a river map) — TV glue =====
// Connects sim.js (rules), bots.js (bot lords), render.js / fx.js / sound.js (picture and sound) and the phones (controller.js).
// Contract: docs/FURTFEHDE.md ("Glue", "Houses and seats", "Match flow", "Phone protocol (Phase 1, binding)" and the Implementation notes).
// The view owns its WebGL canvas; like Skyfarers it sits with a transparent HUD canvas in a wrapper that replaces `cv` while the game runs,
// but here the wrapper FILLS THE WINDOW (internal size = window × DPR, capped per quality; setting `aufloesung: nativ` lifts the cap).
// For "Mitschauen" the glue mirrors view + HUD into `cv` every 125 ms; `?blit=1` (dev harness) shows `cv` instead of the wrapper.

// ---- file scope: one view for all matches (no WebGL context leak) ----
let ffView = null, ffViewCtor = null, ffWrap = null, ffHud = null;

registerGame({ key: 'furtfehde', screen: function () {
  // ---------- constants ----------
  const INTRO_MS = 4000, MIRROR_MS = 125, MAX_STEPS = 8;
  // Auto quality (docs T3): only a sustained slowness counts: the median frame interval over a 10 s window above 40 ms (below 25 fps), not before 30 s into the match;
  // intervals over 250 ms and the 5 s after one (a tab switch, a GC pause, a shader compile) are ignored.
  const AUTO_AFTER_MS = 30000, AUTO_WINDOW_MS = 10000, AUTO_SLOW_MS = 40, AUTO_GLITCH_MS = 250, AUTO_QUIET_MS = 5000, AUTO_MIN_N = 30;
  const AUTO_STORM = 10, AUTO_STORM_MS = 20000;   // (ours) so many long frames within this time are no "hitch" any more: a picture at 4 fps would otherwise never be judged
  const YOU_MS = 520, BOARD_MS = 520, LEVEL_MS = 260, PHASE_MS = 10000, KEEPALIVE_MS = 4000;   // phone throttles: ffYou/ffBoard ≤ 2/s, ffLevel ≤ 4/s
  const HOUSE = ['Haus Falkenstein', 'Haus Wolfsberg', 'Haus Eichenhain', 'Haus Hirschfurt'];   // by site
  const BOT_NAMES = ['🤖 Graf Grimbart', '🤖 Gräfin Gundula', '🤖 Herzog Hagen', '🤖 Baronin Brunhild'];
  const SITES = { 2: [0, 3], 3: [0, 1, 3], 4: [0, 1, 2, 3] };
  const PALETTE = ['#e0453a', '#3a7be0', '#e6b830', '#9a4ad8', '#e8812a', '#d85fa0'];       // bot house colours (no green: the meadows are green)
  const HUE_GAP = 35, SPEC_COLOR = '#c9a45a', MAX_PER_HOUSE = 2;
  const FEED_MS = 9000, FEED_SHOW = 3, HUNGER_HOLD_MS = 4000, ATTACK_HOLD_S = 8;
  const FIGHT_WIN = 2, FIGHT_R = 8, FIGHT_MIN = 8, KK_SHOW_MS = 7000, KK_COOL_MS = 12000, KK_W = 0.30;   // Kampf-Kamera
  const FAMILY = 'system-ui,"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  const FONT = (px) => 'bold ' + Math.round(px) + 'px ' + FAMILY;
  const SERIF = (px) => 'bold italic ' + Math.round(px) + 'px Georgia,"Palatino Linotype",Palatino,"Noto Serif",serif';
  const NEED = { korn: 'Korn', holz: 'Holz', stein: 'Stein' };
  const ART = { furt: 'Die', bruecke: 'Die', steg: 'Der' };                               // article of a crossing's name (Westfurt, Steinbrücke, Nordsteg)
  const CROSS_AT = { furt: 'an der', bruecke: 'an der', steg: 'am' };
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const r2 = (v, k) => Math.round(v * k) / k;
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isInt = (v) => isNum(v) && Math.floor(v) === v;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // ---------- state ----------
  let cfg = {}, World = null, Sim = null, view = null, blit = false, fast = false;
  let phase = 'idle';                       // intro | live | end
  let houses = [], spectators = [], homeOf = {}, bots = {};   // houses[i] = { i, site, base, humans: [ids], bot: null | { name }, color }
  let sim = null, world = null, matchNo = 0, lastHost = null, burg = 120;
  let acc = 0, last = 0, phaseAt = 0, liveAt = 0, endAt = 0, mirrorAt = 0, firstFrame = true;
  let timers = [], errSeen = {}, hooks = {};
  let mapMsg = null, lordsMsg = null, costs = null, rules = null;
  let youAt = {}, boardAt = -1e9, boardSig = '', levelAt = -1e9, levelSent = null, phaseSentFor = null, phaseSentAt = -1e9;
  let feed = [], heraldLog = [], banners = [], endInfo = null, reported = false;   // heraldLog: every herald text of the match (the feed on screen expires)
  let alertAt = {}, activePacts = {}, keepOf = {}, hungerAt = {}, attackedAt = {};
  let samples = [], autoDone = false, curQuality = 'high', glitches = [], glitchUntil = 0, autoFrom = 0, autoEval = 0, capDropped = false;
  let gestureAt = -1e9, gestureFn = null;     // the last click or key on the TV page (the sound hint)
  let hudCache = { at: -1e9, lords: [] }, fightSeen = new Map(), fighters = 0, cluster = null, battle = 0;
  let kk = { on: false, until: 0, cool: 0, x: 0, y: 0, dist: 28, label: '' };
  let hctx = null, HW = 960, HH = 600, sized = '';

  // ---------- helpers ----------
  const send = (id, m) => { try { ac.message(id, m); } catch (e) {} };
  const humans = () => houses.reduce((a, h) => a.concat(h.humans), []);
  const known = () => humans().concat(spectators);
  const houseOfId = (id) => houses.find((h) => h.humans.includes(id)) || null;
  const later = (fn, ms) => { const t = setTimeout(() => { timers = timers.filter((x) => x !== t); fn(); }, ms); timers.push(t); };
  const safe = (label, fn) => { try { return fn(); } catch (e) { if (!errSeen[label]) { errSeen[label] = 1; console.error('Furt & Fehde ' + label + ':', e); } } };
  const colorP = (id) => (players[id] && players[id].color) || '#fff';
  const snd = (fn) => { const S = window.FurtSound; if (S) safe('sound', () => fn(S)); };
  const nowMs = () => performance.now();
  const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const phaseEnd = (st) => st.phase === 'frieden' ? burg : st.phase === 'ebbe' ? burg + Sim.CONST.EBB_S : st.endsAt;   // sim seconds the CURRENT phase ends

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

  // ---------- display: view singleton + full-window wrapper (WebGL canvas + HUD overlay) ----------
  function dropView() {
    if (ffWrap) { try { ffWrap.remove(); } catch (e) {} }
    ffView = null; ffViewCtor = null; ffWrap = null; ffHud = null;
  }
  function ensureView() {
    const T = window.THREE, C = window.FurtView;
    if (!T || !C) return null;
    if (ffView && ffViewCtor === C) return ffView;
    try { if (ffView && ffView.dispose) ffView.dispose(); } catch (e) {}
    dropView();
    try {
      const v = new C(T, { width: 1920, height: 1200, quality: cfg.quality === 'low' ? 'low' : 'high' });
      // The global `canvas` rule of the shell (letterboxed 16:10 box, rounded corners, glow) is neutralised: both canvases fill the wrapper.
      ffWrap = document.createElement('div');
      ffWrap.style.cssText = 'position:fixed; left:0; top:0; width:100vw; height:100vh; z-index:5; display:none; overflow:hidden; background:#0d0d1a; line-height:0;';
      const layer = 'position:absolute; left:0; top:0; width:100%; height:100%; max-width:none; max-height:none; margin:0; border-radius:0; box-shadow:none; pointer-events:none; display:block;';
      v.canvas.style.cssText = layer + 'background:#0d0d1a;';
      ffHud = document.createElement('canvas');
      ffHud.width = v.W || 960; ffHud.height = v.H || 600;
      ffHud.style.cssText = layer + 'background:transparent;';
      ffWrap.append(v.canvas, ffHud);
      document.body.appendChild(ffWrap);
      ffView = v; ffViewCtor = C;
    } catch (e) { dropView(); return null; }
    return ffView;
  }
  function showWrap(on) {
    if (!ffWrap) return;
    ffWrap.style.display = on && !blit ? 'block' : 'none';
    cv.style.display = on && !blit ? 'none' : '';
  }
  // internal size = window × DPR (the view caps it per quality; `nativ` lifts the cap); in blit mode it is cv's own size
  function fit(force) {
    if (!view) return;
    let w, h;
    if (blit) { w = cv.width; h = cv.height; }
    else { const dpr = clampN(window.devicePixelRatio || 1, 1, 3); w = Math.round((window.innerWidth || 960) * dpr); h = Math.round((window.innerHeight || 600) * dpr); }
    const key = w + 'x' + h;
    if (!force && key === sized) return;
    sized = key;
    safe('resize', () => view.resize(w, h));
    syncHudSize();
  }
  function syncHudSize() {
    if (!view || !ffHud) return;
    HW = view.W || 960; HH = view.H || 600;
    if (ffHud.width !== HW || ffHud.height !== HH) { ffHud.width = HW; ffHud.height = HH; }
    hctx = ffHud.getContext('2d');
  }
  // Mitschauen: view + HUD into cv, letterboxed (cv is 16:10, the window may not be); only while viewers exist when the shell tells us
  function mirror() {
    const c = cv.width, d = cv.height, k = Math.min(c / HW, d / HH), w = HW * k, h = HH * k;
    if (Math.abs(w - c) > 1 || Math.abs(h - d) > 1) { ctx.fillStyle = '#0d0d1a'; ctx.fillRect(0, 0, c, d); }
    ctx.drawImage(view.canvas, (c - w) / 2, (d - h) / 2, w, h);
    ctx.drawImage(ffHud, (c - w) / 2, (d - h) / 2, w, h);
  }

  // ---------- houses and seats ----------
  function dealHouses(ids) {
    const sites = SITES[clampN(cfg.burgen | 0, 2, 4)] || SITES[4];
    houses = sites.map((site, i) => ({ i, site, base: HOUSE[site], humans: [], bot: null, color: '#ffffff' }));
    spectators = []; homeOf = {};
    ids.forEach((id, k) => {                                  // round-robin in join order, ≤ 2 per house, the rest spectates
      if (k < houses.length * MAX_PER_HOUSE) { const h = houses[k % houses.length]; h.humans.push(id); homeOf[id] = h.i; } else spectators.push(id);
    });
  }
  function assignColors() {
    const taken = [];
    for (const h of houses) {                                  // a house wears its first human's colour (a duplicate gets a bot colour instead)
      h.color = null;
      if (h.humans.length) { const c = colorP(h.humans[0]); if (!taken.some((t) => t.toLowerCase() === c.toLowerCase())) { h.color = c; taken.push(c); } }
    }
    const need = houses.filter((h) => !h.color), cols = pickBotColors(need.length, taken);
    need.forEach((h, k) => { h.color = cols[k]; });
  }
  const freeBotName = () => BOT_NAMES.find((n) => !houses.some((h) => h.bot && h.bot.name === n)) || BOT_NAMES[0];
  const ownersOf = (h) => h.bot ? h.bot.name : h.humans.map((id) => shortName(id)).join(' & ');
  const displayOf = (h) => h.bot ? h.bot.name : h.base + ' · ' + h.humans.map((id) => nameOf(id)).join(' & ');
  function addBot(h) {
    h.bot = { name: freeBotName() };
    const B = window.FurtBots;
    if (B && sim) safe('bot', () => { bots[h.i] = B.create(sim, h.i, { strength: cfg.staerke, seed: (sim.seed ^ Math.imul(h.i + 1, 0x9E3779B1)) | 0 }); });
  }
  function dropBot(h) { h.bot = null; delete bots[h.i]; }
  function stepBots() { for (const h of houses) { const b = bots[h.i]; if (b) safe('bot.step', () => b.step()); } }   // fixed order: by lord index
  function lookOf() { return houses.map((h) => ({ i: h.i, site: h.site, color: h.color, name: h.base, emblem: h.i })); }

  // ---------- phone protocol: screen → phone ----------
  function costsOf() {
    const C = Sim.CONST, out = { build: {}, units: {}, rebuild: C.REBUILD_COST == null ? 0.5 : C.REBUILD_COST };
    for (const k of Object.keys(C.BUILD)) if (C.BUILD[k].cost) out.build[k] = Object.assign({}, C.BUILD[k].cost);
    for (const u of Object.keys(C.UNIT)) if (C.UNIT[u].cost) out.units[u] = Object.assign({}, C.UNIT[u].cost);
    return out;
  }
  // the numbers the phone's well coverage and storage overview need (docs "Phase 1b addendum"): straight from the sim's tunables
  function rulesOf() {
    const C = Sim.CONST;
    return { bucketR: C.BUCKET_R, keepWellR: C.KEEP_WELL_R, capKeep: C.CAP_KEEP, capKorn: C.CAP_KORN, capLager: C.CAP_LAGER, keepHouses: C.KEEP_HOUSES, hutHouses: C.HUT_HOUSES };
  }
  function lordsOf() {
    return houses.map((h) => ({ i: h.i, site: h.site, color: h.color, name: displayOf(h), emblem: h.i, bot: !!h.bot }));
  }
  function infoFor(id) {
    const h = houseOfId(id), m = { t: 'ffInfo', lord: h ? h.i : -1, color: h ? h.color : SPEC_COLOR, host: id === hostId(), lords: lordsMsg || (lordsMsg = lordsOf()), shared: false, costs, rules };
    if (h && h.humans.length > 1) { const other = h.humans.find((x) => x !== id); if (other != null) m.shared = nameOf(other); }
    return m;
  }
  function mapFor() {
    if (!mapMsg) mapMsg = { t: 'ffMap', grid: World.encode(world), sites: world.sites.map((s) => ({ s: s.s, name: s.name, x: s.x, y: s.y, keep: s.keep })),
      crossings: world.crossings.map((c) => ({ id: c.id, kind: c.kind, water: c.water, name: c.name, x: c.x, y: c.y, rot: c.rot, len: c.len, open: c.open, ends: c.ends, joins: c.joins, spans: c.spans, deck: c.deck })) };
    return mapMsg;
  }
  const levelMsg = () => ({ t: 'ffLevel', L: r2(sim.state.level, 1000) });
  const phaseMsg = () => { const st = sim.state; return { t: 'ffPhase', phase: st.phase, endsAt: r2(phaseEnd(st), 100), now: r2(st.t, 100) }; };
  function youMsg(h) {
    const y = sim.youOf(h.i);
    if (!y) return null;
    for (const q of y.queue) q.p = r2(q.p, 100);
    for (const b of y.banners) { b.x = r2(b.x, 10); b.y = r2(b.y, 10); b.tx = r2(b.tx, 10); b.ty = r2(b.ty, 10); }
    for (const p of y.pacts) p.until = r2(p.until, 100);
    if (y.food) y.food = { prod: Math.round(+y.food.prod || 0), eat: Math.round(+y.food.eat || 0) };   // sacks per minute (R9); an older sim has none
    y.t = 'ffYou';
    return y;
  }
  function boardMsg() {
    const st = sim.state, b = [];
    for (const x of st.buildings) {
      if (x.kind === 'bergfried') continue;                    // the phone draws the keeps from `sites`
      b.push([x.id, x.lord, x.kind, x.i, x.j, x.rot, r2(x.build, 100), r2(x.hp, 100), r2(x.fire, 100), x.ruined ? 1 : 0, x.noWood ? 1 : 0, x.workers | 0, x.paused ? 1 : x.full ? 2 : 0]);   // the 13th field: 0 works · 1 rests by order (💤) · 2 rests because its store is full
    }
    return { t: 'ffBoard', b, banners: st.banners.map((x) => [x.lord, x.n, r2(x.x, 10), r2(x.y, 10), x.count]) };
  }
  function resultFor(id) {
    const h = houseOfId(id), rows = endInfo.ranking;
    return { t: 'ffResult', ranking: rows, you: h ? rows.find((r) => r.lord === h.i) || null : null };
  }
  const sendAll = (m) => known().forEach((id) => send(id, m));
  const sendHouse = (i, m) => { const h = houses[i]; if (h) h.humans.forEach((id) => send(id, m)); };
  const sendInfoAll = () => { lordsMsg = null; known().forEach((id) => send(id, infoFor(id))); };
  const toast = (id, text) => send(id, { t: 'ffToast', text });
  const toastHouse = (i, text) => sendHouse(i, { t: 'ffToast', text });
  // alerts: own-house kinds only to that house, crossing / pact / crown to everybody; `gap` = min seconds (sim time) between two of a kind per house
  function alertHouse(i, kind, text, gap, x, y) {
    const key = kind + ':' + i, t = sim.state.t;
    if (gap && alertAt[key] != null && t - alertAt[key] < gap) return;
    alertAt[key] = t;
    const m = { t: 'ffAlert', kind, text };
    if (isNum(x) && isNum(y)) { m.x = r2(x, 10); m.y = r2(y, 10); }
    sendHouse(i, m);
  }
  const alertAll = (kind, text) => sendAll({ t: 'ffAlert', kind, text });
  // everything a phone needs, in the order the phone expects it (ffMap → ffLevel; ffResult last)
  function sendFull(id) {
    if (!sim) return;
    send(id, infoFor(id)); send(id, mapFor()); send(id, levelMsg()); send(id, phaseMsg());
    const h = houseOfId(id);
    if (h) { const y = youMsg(h); if (y) { y.now = r2(sim.state.t, 100); send(id, y); } }   // every ffYou carries the sim clock
    send(id, boardMsg());
    if (phase === 'end' && endInfo) send(id, resultFor(id));
  }

  // Throttled state updates, every frame while a match runs: ffYou per house and ffBoard are evaluated at most every 520 ms (so ≤ 2/s even while
  // players spam orders; the phone dims a tapped row for 0.6 s anyway), ffLevel every 260 ms (≤ 4/s). `resync` (intro → live) re-sends level and phase.
  function syncPhones(now, resync) {
    const st = sim.state;
    const L = r2(st.level, 1000);
    if (levelSent !== L && (resync || now - levelAt >= LEVEL_MS)) { levelSent = L; levelAt = now; sendAll({ t: 'ffLevel', L }); }
    // a phase message waits until the phones know the level that goes with it (the last ffLevel of the ebb must not trail the "fehde")
    if (levelSent === L && (resync || phaseSentFor !== st.phase || (phase === 'live' && now - phaseSentAt >= PHASE_MS))) { phaseSentFor = st.phase; phaseSentAt = now; sendAll(phaseMsg()); }
    for (const h of houses) {
      if (!h.humans.length) continue;
      const o = youAt[h.i];
      if (o && now - o.at < YOU_MS) continue;
      const m = youMsg(h);
      if (!m) continue;
      const sig = JSON.stringify(m);
      if (o && o.sig === sig && now - o.sent < KEEPALIVE_MS) { o.at = now; continue; }
      youAt[h.i] = { at: now, sent: now, sig };
      m.now = r2(st.t, 100);
      sendHouse(h.i, m);
    }
    if (now - boardAt >= BOARD_MS) {
      boardAt = now;
      const m = boardMsg(), sig = JSON.stringify(m);
      if (sig !== boardSig) { boardSig = sig; sendAll(m); }
    }
  }

  // ---------- herald, banners ----------
  const houseName = (i) => (houses[i] && houses[i].base) || 'Haus ' + (i + 1);
  const crossName = (id) => { const c = world.crossings.find((x) => x.id === id); return c ? c : null; };
  function herald(text, color) {
    feed.push({ text, color: color || '#ffe9b0', at: nowMs() }); if (feed.length > 6) feed.shift();
    heraldLog.push(text); if (heraldLog.length > 200) heraldLog.shift();
  }
  function pushBanner(lines, color, ms) { banners.push({ lines, color: color || '#ffe27a', at: nowMs(), ms: ms || 3800 }); if (banners.length > 3) banners.shift(); }
  const lordColor = (i) => (houses[i] && houses[i].color) || '#cccccc';

  // ---------- Kampf-Kamera ----------
  function nearestLabel(x, y) {
    let best = null, bd = 1e9;
    for (const h of houses) { const s = world.sites[h.site], d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = { text: '⚔️ Kampf um ' + h.base, d, keep: true }; } }
    if (best && bd < 15) return best.text;
    let cb = null, cd = 1e9;
    for (const c of world.crossings) { const d = Math.hypot(c.x - x, c.y - y); if (d < cd) { cd = d; cb = c; } }
    if (cb && cd < 24) return '⚔️ Schlacht ' + (CROSS_AT[cb.kind] || 'an der') + ' ' + cb.name;
    return best ? best.text : '⚔️ Schlacht im Tal';
  }
  function kkStart(x, y, dist, label, now, force) {
    if (kk.on || curQuality !== 'high' || phase !== 'live' || fast) return;
    if (!force && now < kk.cool) return;
    kk = { on: true, until: now + KK_SHOW_MS, cool: 0, x, y, dist, label };
  }
  // soldiers that struck within the last FIGHT_WIN s; the densest group of ≥ FIGHT_MIN within FIGHT_R opens the Kampf-Kamera
  function scanFights(now) {
    const st = sim.state, t = st.t;
    if (st.phase === 'frieden') { fightSeen.clear(); fighters = 0; cluster = null; return; }
    for (const u of st.units) if (u.anim === 'fight') fightSeen.set(u.id, { x: u.x, y: u.y, t });
    const pts = [];
    for (const [id, f] of fightSeen) { if (t - f.t > FIGHT_WIN) fightSeen.delete(id); else pts.push(f); }
    fighters = pts.length;
    let best = null, bn = 0;
    if (pts.length >= FIGHT_MIN) {
      for (const p of pts) {
        let n = 0, sx = 0, sy = 0;
        for (const q of pts) if (Math.abs(q.x - p.x) <= FIGHT_R && Math.abs(q.y - p.y) <= FIGHT_R && Math.hypot(q.x - p.x, q.y - p.y) <= FIGHT_R) { n++; sx += q.x; sy += q.y; }
        if (n > bn) { bn = n; best = { x: sx / n, y: sy / n, n }; }
      }
    }
    cluster = bn >= FIGHT_MIN ? best : null;
    if (cluster) {
      if (!kk.on) kkStart(cluster.x, cluster.y, clampN(25 + Math.sqrt(cluster.n) * 3.2, 30, 46), nearestLabel(cluster.x, cluster.y), now);
      else if (Math.hypot(cluster.x - kk.x, cluster.y - kk.y) < 18) { kk.x = cluster.x; kk.y = cluster.y; }
    }
    battle += (clampN(fighters / 30, 0, 1) - battle) * 0.3;
  }
  function kkFrame(now) {
    if (!view) return;
    if (kk.on && (now >= kk.until || curQuality !== 'high' || phase !== 'live')) { kk.on = false; kk.cool = now + KK_COOL_MS; safe('inset', () => view.inset(null)); return; }
    if (!kk.on) return;
    const w = Math.round(view.W * KK_W), h = Math.round(w * 0.625), m = Math.round(view.H * 0.03);
    safe('inset', () => view.inset({ x: Math.round((view.W - w) / 2), y: view.H - h - m, w, h }, { x: kk.x, y: kk.y, dist: kk.dist }));
  }

  // ---------- match ----------
  function startMatch(ids) {
    ids = ids.filter((id) => players[id]);
    if (!ids.length && !cfg.allbots) { endToLobby('🏰 Furt & Fehde: alle Lords sind weg.'); return; }   // cfg.allbots: dev harness, every house is a bot
    dealHouses(ids); assignColors();
    const seed = (cfg.seed ? (cfg.seed + matchNo) : ((Math.random() * 0x7fffffff) | 0)) | 0 || 1;
    matchNo++;
    burg = clampN(+cfg.burgfrieden || 120, 30, 300);
    try {
      world = World.make(seed);
      sim = Sim.create({ seed, world, dauer: clampN(+cfg.dauer || 20, 6, 40), burgfrieden: burg, lords: houses.map((h) => ({ i: h.i, site: h.site })) });
    } catch (e) { console.error('Furt & Fehde start:', e); sim = null; endToLobby('🏰 Furt & Fehde: Start fehlgeschlagen.'); return; }
    bots = {};
    for (const h of houses) if (!h.humans.length) addBot(h);
    safe('setWorld', () => view.setWorld(world, lookOf()));
    keepOf = {};
    for (const b of sim.state.buildings) if (b.kind === 'bergfried') keepOf[b.id] = b.lord;
    costs = costsOf(); rules = rulesOf(); mapMsg = null; lordsMsg = null;
    youAt = {}; boardSig = ''; boardAt = -1e9; levelSent = null; levelAt = -1e9; phaseSentFor = null; phaseSentAt = -1e9;
    feed = []; heraldLog = []; banners = []; endInfo = null; reported = false; alertAt = {}; activePacts = {}; hungerAt = {}; attackedAt = {};
    samples = []; firstFrame = true; fightSeen = new Map(); fighters = 0; cluster = null; battle = 0; kk = { on: false, until: 0, cool: 0, x: 0, y: 0, dist: 28, label: '' };
    hudCache = { at: -1e9, lords: [] };
    safe('inset', () => view.inset(null));
    fit(true);
    phase = 'intro';
    known().forEach((id) => sendFull(id));
    phaseAt = nowMs(); acc = 0; last = phaseAt; mirrorAt = 0;   // the intro clock starts after all the heavy work above
    levelSent = r2(sim.state.level, 1000); levelAt = phaseAt; phaseSentFor = sim.state.phase; phaseSentAt = phaseAt;
    boardAt = phaseAt; boardSig = JSON.stringify(boardMsg());                          // sendFull just told every phone: the throttled updates start from here
    for (const h of houses) if (h.humans.length) { const m = youMsg(h); if (m) youAt[h.i] = { at: phaseAt, sent: phaseAt, sig: JSON.stringify(m) }; }
    snd((S) => { S.ambience('flood'); S.battle(0); });
    sfx('whoosh');
  }
  function toLive(now) {
    phase = 'live'; liveAt = now; acc = 0; last = now; samples = []; glitches = []; glitchUntil = 0; autoFrom = now; autoEval = 0;
    sfx('go');
    syncPhones(now, true);
  }
  function newMatch() {
    const ids = known().filter((id) => players[id]).sort((a, b) => a - b);
    startMatch(ids);
  }

  // titles of the end screen: the best house of each kind (a tie goes to the better rank)
  function titlesOf(rows) {
    const defs = [
      { icon: '⚔️', name: 'Schlächter', val: (r) => r.stats.kills, what: (v) => v + ' Gegner besiegt' },
      { icon: '🏗️', name: 'Baumeister', val: (r) => r.stats.built, what: (v) => v + ' Gebäude' },
      { icon: '🔥', name: 'Brandstifter', val: (r) => r.stats.ignites, what: (v) => v + (v === 1 ? ' Brand' : ' Brände') },
      { icon: '🤝', name: 'Diplomat', val: (r) => r.stats.betrayals ? 0 : r.stats.pacts, what: (v) => v + (v === 1 ? ' Pakt' : ' Pakte') }
    ];
    const out = [];
    for (const d of defs) {
      let best = null, bv = 0;
      for (const r of rows) { const v = d.val(r) || 0; if (v > bv) { bv = v; best = r; } }
      if (best) out.push({ icon: d.icon, name: d.name, lord: best.lord, text: d.what(bv) });
    }
    return out;
  }
  function toEnd() {
    const rows = (sim.state.ranking || []).map((r) => ({ lord: r.lord, rank: r.rank, ruhm: r.ruhm, people: r.people, soldiers: r.soldiers, buildings: r.buildings, stats: r.stats, by: r.by }));   // the sim's rows, unchanged
    endInfo = { ranking: rows, titles: titlesOf(rows), winner: rows[0] ? rows[0].lord : -1 };
    phase = 'end'; phaseAt = nowMs(); endAt = phaseAt;
    if (kk.on) { kk.on = false; safe('inset', () => view.inset(null)); }
    snd((S) => { S.ambience(null); S.battle(0); });
    const win = houses[endInfo.winner];
    if (!reported && win) {
      reported = true;
      const ids = win.humans.filter((id) => players[id]);
      if (ids.length) safe('reportWinners', () => reportWinners(ids));
    }
    sendAll(phaseMsg());
    known().forEach((id) => send(id, resultFor(id)));
  }

  // ---------- events: view/fx, sound, phones, herald ----------
  const WHAT = { kaserne: 'die Kaserne', wachturm: 'den Wachturm' };
  const BNAME = (k) => (World.BUILDINGS[k] && World.BUILDINGS[k].name) || k;
  function handleEvents(events) {
    for (const ev of events) {
      if (!fast) { safe('view.event', () => view.event(ev, sim.state)); if (ev.t !== 'buildDone') snd((S) => S.event(ev)); }   // buildDone: no sound on the TV (T2), the phone's toast says it
      safe('event ' + ev.t, () => handleEvent(ev));
    }
  }
  function handleEvent(ev) {
    const st = sim.state;
    switch (ev.t) {
      case 'frieden': herald('🌊 Burgfrieden: baut auf, solange das Tal unter Wasser steht!', '#7fc8e8'); break;
      case 'warn':
        herald('🌊 Das Wasser fällt in ' + Math.round(ev.in) + ' Sekunden!', '#ffb347');
        sendAll({ t: 'ffToast', text: '🌊 In ' + Math.round(ev.in) + ' Sekunden fällt das Wasser!' });
        break;
      case 'ebbe':
        herald('🌊 Ebbe! Die Furten werden frei', '#7fc8e8'); pushBanner(['🌊 Ebbe!', 'Das Wasser fällt — die Furten öffnen sich'], '#7fc8e8', 4200);
        break;
      case 'crossingOpen': {
        const c = crossName(ev.id);
        if (!c) break;
        const text = ART[c.kind] + ' ' + c.name + ' ist frei!';
        herald('🌊 ' + text, '#9be0ff'); alertAll('crossing', '🌊 ' + text);
        break;
      }
      case 'fehde':
        herald('⚔️ Die Fehde beginnt!', '#ff7a5c'); pushBanner(['⚔️ Die Fehde beginnt!', 'Alle Furten sind offen — Ruhm den Tapferen!'], '#ff7a5c', 4400);
        break;
      case 'lastMinute': herald('⏳ Die letzte Minute!', '#ff6b6b'); pushBanner(['⏳ Die letzte Minute!'], '#ff6b6b', 3400); break;
      case 'over': if (phase === 'live') toEnd(); break;
      case 'hunger':
        if (ev.on) {
          hungerAt[ev.lord] = nowMs();
          alertHouse(ev.lord, 'hunger', '🍞 Hunger! Das Korn ist aus.', 30);
          const k = 'H' + ev.lord;
          if (alertAt[k] == null || st.t - alertAt[k] >= 60) { alertAt[k] = st.t; herald('🍞 ' + houseName(ev.lord) + ' hungert!', '#ffb347'); }
        }
        break;
      case 'buildDone': {
        const b = st.buildings.find((x) => x.id === ev.id);
        if (!b || b.kind === 'bergfried') break;
        toastHouse(b.lord, '✅ ' + BNAME(b.kind) + ' ist fertig');
        const mil = b.kind === 'kaserne' ? '⚔️ ' + houseName(b.lord) + ' rüstet auf: die Kaserne steht!' : b.kind === 'wachturm' ? '🗼 ' + houseName(b.lord) + ' baut einen Wachturm' : null;
        if (mil) herald(mil, lordColor(b.lord));
        break;
      }
      case 'ignite': {
        const b = st.buildings.find((x) => x.id === ev.id);
        if (!b) break;
        const w = World.footprintOf(b.kind, b.rot || 0);
        alertHouse(b.lord, 'fire', '🔥 ' + BNAME(b.kind) + ' brennt!', 12, b.i - 72 + w[0] / 2, b.j - 45 + w[1] / 2);
        const k = 'F' + b.lord;
        if (alertAt[k] == null || st.t - alertAt[k] >= 20) { alertAt[k] = st.t; herald('🔥 ' + houseName(b.lord) + ' brennt!', '#ff8a4c'); }
        break;
      }
      case 'ruined': {
        const b = st.buildings.find((x) => x.id === ev.id);
        if (!b || b.kind === 'bergfried') break;
        toastHouse(b.lord, '💥 ' + BNAME(b.kind) + ' ist zerstört — ♻️ Wiederaufbau für die Hälfte');
        if (WHAT[b.kind]) herald('💥 ' + houseName(b.lord) + ' verliert ' + WHAT[b.kind], '#ff9a7a');
        break;
      }
      case 'attack': {
        attackedAt[ev.lord] = st.t;
        alertHouse(ev.lord, 'attack', '⚔️ Angriff auf dein Land!', 0, ev.x, ev.y);
        const k = 'A' + ev.lord;
        if (alertAt[k] == null || st.t - alertAt[k] >= 20) { alertAt[k] = st.t; herald('⚔️ ' + houseName(ev.lord) + ' wird angegriffen!', '#ff8a8a'); }
        break;
      }
      case 'hit':
        if (own(keepOf, ev.id)) { const l = st.lords[keepOf[ev.id]]; if (l && !(l.prot > 0)) { const s = world.sites[l.site]; kkStart(s.x, s.y + (l.site < 2 ? 4 : -4), 26, '🏰 Sturm auf ' + houseName(l.i), nowMs()); } }
        break;
      case 'plunder': {
        const d = houses[ev.lord], a = ev.by == null ? null : houses[ev.by];
        if (!d) break;
        herald('🏰 ' + houseName(ev.lord) + ' wurde geplündert!', '#ffd24a');
        pushBanner(['🏰 ' + houseName(ev.lord) + ' wurde geplündert!', a ? 'von ' + a.base + ' — +' + Sim.CONST.RUHM.plunder + ' Ruhm' : 'die Burg steht unter Schutz'], '#ffd24a', 4600);
        alertHouse(ev.lord, 'plunder', '🏰 Dein Haus wurde geplündert!', 0, world.sites[d.site].x, world.sites[d.site].y);
        if (ev.by != null) toastHouse(ev.by, '💰 Beute gemacht: +' + Sim.CONST.RUHM.plunder + ' Ruhm');
        kkStart(world.sites[d.site].x, world.sites[d.site].y + (d.site < 2 ? 4 : -4), 26, '🏰 ' + d.base + ' wird geplündert', nowMs(), true);
        break;
      }
      case 'crown':
        if (ev.lord == null) herald('👑 Die Krone ist wieder frei', '#ffe27a');
        else { herald('👑 ' + houseName(ev.lord) + ' trägt die Krone', '#ffe27a'); alertAll('crown', '👑 ' + houseName(ev.lord) + ' trägt die Krone'); }
        break;
      case 'pactOffer':
        alertHouse(ev.to, 'pact', '🤝 ' + houseName(ev.from) + ' bietet dir einen Pakt an', 0);
        break;
      case 'pactOn':
        activePacts[Math.min(ev.a, ev.b) + '-' + Math.max(ev.a, ev.b)] = 1;
        herald('🤝 Pakt zwischen ' + houseName(ev.a) + ' und ' + houseName(ev.b) + ' für 3 Minuten', '#8fe0a0');
        alertHouse(ev.a, 'pact', '🤝 Pakt mit ' + houseName(ev.b) + ' geschlossen', 0); alertHouse(ev.b, 'pact', '🤝 Pakt mit ' + houseName(ev.a) + ' geschlossen', 0);
        break;
      case 'pactOff': {
        const key = Math.min(ev.a, ev.b) + '-' + Math.max(ev.a, ev.b), was = !!activePacts[key];
        if (ev.reason !== 'declined') delete activePacts[key];
        if (ev.reason === 'broken') {
          const victim = ev.by === ev.a ? ev.b : ev.a;
          herald('🗡️ Verrat! ' + houseName(ev.by) + ' bricht den Pakt mit ' + houseName(victim), '#ff6b6b');
          alertHouse(victim, 'pact', '🗡️ ' + houseName(ev.by) + ' hat den Pakt gebrochen!', 0);
          pushBanner(['🗡️ Verrat!', houseName(ev.by) + ' bricht den Pakt'], '#ff6b6b', 3600);
        } else if (ev.reason === 'expired' && was) {
          herald('🤝 Der Pakt zwischen ' + houseName(ev.a) + ' und ' + houseName(ev.b) + ' ist abgelaufen', '#b8c4a0');
          toastHouse(ev.a, '🤝 Der Pakt ist abgelaufen'); toastHouse(ev.b, '🤝 Der Pakt ist abgelaufen');
        } else if (ev.reason === 'declined') {
          const offerer = ev.by === ev.a ? null : ev.a;   // by === a: the offerer withdrew; otherwise the target declined
          if (offerer != null) toastHouse(offerer, '🤝 ' + houseName(ev.by) + ' lehnt den Pakt ab');
        } else if (ev.reason === 'expired') toastHouse(ev.a, '🤝 Das Angebot ist abgelaufen');
        break;
      }
      default: break;
    }
  }

  // ---------- quality ----------
  const median = (a) => { const v = a.map((x) => x[1]).sort((x, y) => x - y), n = v.length; return n ? (n & 1 ? v[n >> 1] : (v[(n >> 1) - 1] + v[n >> 1]) / 2) : 0; };
  function sampleFrame(now, rawMs) {
    if (rawMs < 1) return;
    if (rawMs > AUTO_GLITCH_MS) { glitches.push(now); glitchUntil = now + AUTO_QUIET_MS; }   // not the picture's fault: skip it and the next 5 s
    else if (now >= glitchUntil) { samples.push([now, rawMs]); while (samples.length && now - samples[0][0] > AUTO_WINDOW_MS) samples.shift(); }
    while (glitches.length && now - glitches[0] > AUTO_STORM_MS) glitches.shift();
    if (cfg.quality !== 'auto' || autoDone || curQuality !== 'high' || phase !== 'live') return;
    if (now - liveAt < AUTO_AFTER_MS || now - autoFrom < AUTO_WINDOW_MS || now - autoEval < 500) return;   // a fresh 10 s window after the start and after every step
    autoEval = now;
    const storm = glitches.length >= AUTO_STORM;
    if (!storm && (samples.length < AUTO_MIN_N || now - samples[0][0] < AUTO_WINDOW_MS * 0.8 || median(samples) <= AUTO_SLOW_MS)) return;
    autoStepDown(now);
  }
  // two steps: with `aufloesung: nativ` the native cap drops to the normal one first; only the next sustained slowness switches to Sparsam. Each step is announced.
  function autoStepDown(now) {
    samples = []; glitches = []; autoFrom = now;
    if (cfg.aufloesung === 'nativ' && !capDropped) {
      capDropped = true;
      safe('setCap', () => view.setCap(0, 0));
      syncHudSize();
      pushBanner(['🔍 Auflösung auf Normal gestellt', 'Das Bild lief zu langsam – die Grafik bleibt voll'], '#ffe27a', 4200);
      return;
    }
    autoDone = true; curQuality = 'low';
    if (kk.on) { kk.on = false; safe('inset', () => view.inset(null)); }
    safe('setQuality', () => view.setQuality('low'));
    syncHudSize();
    pushBanner(['🔋 Grafik auf Sparsam gestellt', 'Das Bild lief zu langsam'], '#ffe27a', 4200);
  }

  // ---------- HUD ----------
  let g = null, U = 1;
  function txt(s, x, y, px, color, align, font) {
    g.font = font || FONT(px); g.textAlign = align || 'left'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = Math.max(3, px / 5); g.strokeStyle = 'rgba(8,6,2,.85)';
    g.strokeText(s, x, y); g.fillStyle = color || '#fff'; g.fillText(s, x, y);
  }
  function panel(x, y, w, h, border, alpha, fill) {
    g.fillStyle = fill || 'rgba(22,16,8,' + (alpha == null ? 0.72 : alpha) + ')'; rr(g, x, y, w, h, 12 * U); g.fill();
    if (border) { g.strokeStyle = border; g.lineWidth = 2.5 * U; g.stroke(); }
  }
  function fitPx(s, maxW, px, font) {
    g.font = font || FONT(px);
    const w = g.measureText(s).width;
    return w > maxW && w > 0 ? Math.max(8, px * maxW / w) : px;
  }
  const textW = (s, px) => { g.font = FONT(px); return g.measureText(s).width; };
  function light(hex, k) {   // a house colour mixed towards white: readable as text on the dark panels
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return '#fff';
    const c = [1, 2, 3].map((i) => Math.round(parseInt(m[i], 16) + (255 - parseInt(m[i], 16)) * k));
    return 'rgb(' + c.join(',') + ')';
  }

  function refreshHud(now) {
    if (now - hudCache.at < 250) return;
    const st = sim.state;
    hudCache.at = now;
    for (const h of houses) {
      const y = sim.youOf(h.i);
      let fire = 0;
      for (const b of st.buildings) if (b.lord === h.i && b.fire > fire) fire = b.fire;
      hudCache.lords[h.i] = { y, fire };
      if (y && y.hunger) hungerAt[h.i] = now;
    }
  }

  // a heater shield in the house colour with the house's emblem (the same charge as on its keep's flag); (x, y) = top-centre
  function lum(hex) { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); return m ? (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255 : 0.5; }
  function shield(cx, y, w, h, color, idx) {
    g.save();
    g.beginPath(); g.moveTo(cx - w / 2, y); g.lineTo(cx + w / 2, y); g.lineTo(cx + w / 2, y + h * 0.52);
    g.quadraticCurveTo(cx + w / 2, y + h * 0.86, cx, y + h); g.quadraticCurveTo(cx - w / 2, y + h * 0.86, cx - w / 2, y + h * 0.52); g.closePath();
    g.fillStyle = color; g.fill(); g.lineJoin = 'round'; g.lineWidth = 2.2 * U; g.strokeStyle = '#f6ecd2'; g.stroke();
    const em = window.FurtArt && window.FurtArt.emblems && window.FurtArt.emblems[idx % 4];
    if (em) {
      const k = (em.fit === 'wide' ? w * 0.4 : w * 0.34), ox = cx, oy = y + h * 0.4;
      g.fillStyle = lum(color) > 0.62 ? '#2b1d0e' : '#f6ecd2';
      for (const poly of em.polys) { g.beginPath(); poly.forEach((q, i) => { const px = ox + q[0] * k, py = oy - q[1] * k * (em.fit === 'wide' ? 1.3 : 1); if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath(); g.fill(); }
    }
    g.restore();
  }

  function clockInfo(st) {
    const left = phaseEnd(st) - st.t, ph = st.phase;
    if (ph === 'frieden') return { text: '🌊 Burgfrieden ' + fmtClock(left), color: left <= 15 ? '#c9731c' : '#2c6f8f', pulse: left <= 15 };
    if (ph === 'ebbe') return { text: '🌊 Ebbe · Pegel ' + Math.round(st.level * 100) + ' %', color: '#3a7fb0' };
    if (left <= Sim.CONST.LAST_S) return { text: '⏳ Letzte Minute ' + fmtClock(left), color: '#c62828', pulse: true };
    return { text: '⚔️ Fehde ' + fmtClock(left), color: '#8f2c22' };
  }
  function drawClock(st, now) {
    const c = clockInfo(st), px = 24 * U, h = px + 18 * U, padX = 20 * U;
    const w = textW(c.text, px) + padX * 2, x = HW / 2 - w / 2, y = 10 * U;
    const pulse = c.pulse ? 0.78 + 0.22 * Math.sin(now / 160) : 1;
    g.save(); g.globalAlpha = pulse;
    panel(x, y, w, h, 'rgba(255,240,200,.55)', 1, c.color);
    g.restore();
    txt(c.text, HW / 2, y + h / 2 + 1, px, '#fff', 'center');
    // match progress under the chip: elapsed share of the whole match, with a tick where the war starts
    const bw = w, by = y + h + 6 * U, bh = 7 * U, f = clampN(st.t / st.endsAt, 0, 1), war = (burg + Sim.CONST.EBB_S) / st.endsAt;
    g.fillStyle = 'rgba(10,8,4,.6)'; rr(g, x, by, bw, bh, bh / 2); g.fill();
    if (f > 0) { g.fillStyle = st.phase === 'fehde' ? '#e0584a' : '#59aee0'; rr(g, x, by, Math.max(bh, bw * f), bh, bh / 2); g.fill(); }
    g.fillStyle = 'rgba(255,240,200,.85)'; g.fillRect(x + bw * clampN(war, 0, 1) - U, by - 2 * U, 2 * U, bh + 4 * U);
    return by + bh;
  }

  function drawHerald(now, top) {
    feed = feed.filter((f) => now - f.at < FEED_MS);
    const items = feed.slice(-FEED_SHOW).reverse(), px = 18 * U, h = px + 14 * U;
    items.forEach((f, i) => {
      const age = now - f.at, a = (age > FEED_MS - 1200 ? Math.max(0, (FEED_MS - age) / 1200) : 1) * (i === 0 ? 1 : 0.82 - i * 0.08), fresh = age < 280 ? age / 280 : 1;
      const w = Math.min(HW * 0.5, textW(f.text, px) + 30 * U), x = HW / 2 - w / 2, y = top + 8 * U + i * (h + 5 * U) + (1 - fresh) * -8 * U;
      g.save(); g.globalAlpha = a;
      panel(x, y, w, h, f.color, 0.74);
      txt(f.text, HW / 2, y + h / 2 + 1, fitPx(f.text, w - 20 * U, px), '#fff', 'center');
      g.restore();
    });
  }

  function drawBanners(now) {
    banners = banners.filter((b) => now - b.at < b.ms);
    const b = banners[banners.length - 1];
    if (!b) return;
    const age = now - b.at, a = age < 250 ? age / 250 : age > b.ms - 500 ? Math.max(0, (b.ms - age) / 500) : 1;
    const px = 38 * U, maxW = HW - 120 * U;
    const sizes = b.lines.map((l, i) => fitPx(l, maxW - 70 * U, i ? px * 0.55 : px));
    const w = Math.min(maxW, Math.max.apply(null, b.lines.map((l, i) => textW(l, sizes[i]))) + 80 * U);
    const lh = sizes.map((s) => s * 1.32), h = lh.reduce((p, c) => p + c, 0) + 28 * U, x = HW / 2 - w / 2, y = HH * 0.2;
    g.save(); g.globalAlpha = a;
    panel(x, y, w, h, b.color, 0.82);
    let yy = y + 14 * U;
    b.lines.forEach((l, i) => { txt(l, HW / 2, yy + lh[i] / 2, sizes[i], i ? '#fbe9c4' : '#fff', 'center'); yy += lh[i]; });
    g.restore();
  }

  function warnIcons(h, st, now) {
    const c = hudCache.lords[h.i] || {}, out = [];
    if (c.fire > 0.05) out.push('🔥');
    if (st.t - (attackedAt[h.i] == null ? -1e9 : attackedAt[h.i]) < ATTACK_HOLD_S) out.push('⚔️');
    if (now - (hungerAt[h.i] == null ? -1e9 : hungerAt[h.i]) < HUNGER_HOLD_MS) out.push('🍞');
    return out;
  }
  function drawLordPanel(h, st, now) {
    const l = st.lords[h.i];
    if (!l) return;
    const c = hudCache.lords[h.i] || {}, y = c.y, w = 228 * U, ph = 100 * U, m = 12 * U, pad = 13 * U;
    const east = h.site % 2 === 1, south = h.site >= 2;
    const x = east ? HW - m - w : m, y0 = south ? HH - m - ph : m;
    g.save();
    panel(x, y0, w, ph, 'rgba(255,240,200,.35)', 0.7);
    g.fillStyle = h.color; rr(g, x, y0, 7 * U, ph, 5 * U); g.fill();
    shield(x + pad + 17 * U, y0 + 10 * U, 30 * U, 36 * U, h.color, h.i);
    const tx = x + pad + 42 * U, mw = w - pad - 42 * U - 10 * U - (l.crown ? 38 * U : 0);
    txt(h.base, tx, y0 + 19 * U, fitPx(h.base, mw, 18 * U), '#fff');
    if (l.crown) txt('👑', x + w - 22 * U, y0 + 19 * U, 22 * U, '#ffe27a', 'center');
    const owners = ownersOf(h);
    txt(owners, tx, y0 + 38 * U, fitPx(owners, w - pad - 42 * U - 10 * U, 13 * U), h.bot ? '#cdd6e8' : '#f4ead0');
    const px = 16 * U;
    txt('⭐ ' + Math.round(l.ruhm) + '   👥 ' + l.people + '   ⚔️ ' + l.soldiers, x + pad + 8 * U, y0 + 62 * U, px, '#fff');
    const s = (y && y.stock) || { korn: 0, holz: 0, stein: 0 };
    txt('🌾 ' + s.korn + '  🪵 ' + s.holz + '  🪨 ' + s.stein, x + pad + 8 * U, y0 + 85 * U, 15 * U, '#f4e6c2');
    // warnings and pacts, right-aligned in the last row
    let rx = x + w - 12 * U;
    const icons = warnIcons(h, st, now).map((ic) => ({ ic }));
    for (const p of (y && y.pacts) || []) if (p.state === 'active') icons.push({ ic: '🤝', col: lordColor(p.with) });
    for (let i = icons.length - 1; i >= 0; i--) {
      const it = icons[i];
      if (it.col) { g.fillStyle = it.col; g.beginPath(); g.arc(rx - 9 * U, y0 + 85 * U, 11.5 * U, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.5 * U; g.stroke(); }   // the partner's colour
      g.globalAlpha = it.col ? 1 : 0.7 + 0.3 * Math.sin(now / 150); txt(it.ic, rx, y0 + 85 * U, 15 * U, '#fff', 'right'); g.globalAlpha = 1; rx -= 24 * U;
    }
    // protection / fury
    if (l.prot > 0) txt('🛡️ ' + fmtClock(l.prot), x + w - 12 * U, y0 + 62 * U, 14 * U, '#ffe9a0', 'right');
    else if (l.zorn > 0) txt('😠 ' + fmtClock(l.zorn), x + w - 12 * U, y0 + 62 * U, 14 * U, '#ff9a8a', 'right');
    g.restore();
  }

  // house names over the keeps (a dark pill with the colour on its left), banner counts over the banners
  function drawKeepTags(st) {
    const sc = HW / (view.W || HW);
    for (const h of houses) {
      const s = world.sites[h.site], l = st.lords[h.i];
      let p; try { p = view.project(s.x, s.y, 15); } catch (e) { p = null; }
      if (!p || !p.visible) continue;
      const keep = st.buildings.find((b) => b.lord === h.i && b.kind === 'bergfried');
      const px = 13 * U, label = h.base.replace('Haus ', '') + (l && l.crown ? ' 👑' : '') + (l && l.prot > 0 ? ' 🛡️' : ''), w = textW(label, px) + 26 * U, hh = px + 10 * U, x = p.x * sc - w / 2, y = p.y * sc - hh / 2;
      panel(x, y, w, hh, h.color, 0.66);
      txt(label, p.x * sc + 4 * U, y + hh / 2 + 1, px, '#fff', 'center');
      g.fillStyle = h.color; g.beginPath(); g.arc(x + 11 * U, y + hh / 2, 5 * U, 0, Math.PI * 2); g.fill();
      if (keep && keep.hp < 0.995 && !(l && l.prot > 0)) {
        const bw = w - 10 * U, bx = x + 5 * U, by = y + hh + 3 * U;
        g.fillStyle = 'rgba(10,8,4,.7)'; rr(g, bx, by, bw, 6 * U, 3 * U); g.fill();
        g.fillStyle = keep.hp < 0.35 ? '#ff4d3a' : '#f0b429'; rr(g, bx, by, Math.max(6 * U, bw * clampN(keep.hp, 0, 1)), 6 * U, 3 * U); g.fill();
      }
    }
  }
  const ROMAN = ['', 'I', 'II', 'III'];
  function drawBannerLabels(st, alpha) {
    const sc = HW / (view.W || HW);
    for (const b of st.banners) {
      if (!b.count) continue;
      const x = b.px + (b.x - b.px) * alpha, y = b.py + (b.y - b.py) * alpha;
      let p; try { p = view.project(x, y, 6.2); } catch (e) { p = null; }
      if (!p || !p.visible) continue;
      const col = lordColor(b.lord), px = 13 * U, label = ROMAN[b.n] + ' · ' + b.count, w = textW(label, px) + 18 * U, hh = px + 8 * U;
      panel(p.x * sc - w / 2, p.y * sc - hh / 2, w, hh, col, 0.74);
      txt(label, p.x * sc, p.y * sc + 1, px, '#fff', 'center');
    }
  }

  function drawKampfLabel() {
    if (!kk.on || !view.insetRect) return;
    const r = view.insetRect, sc = HW / (view.W || HW), px = 17 * U, w = textW(kk.label, px) + 28 * U, hh = px + 12 * U;
    const x = (r.x + r.w / 2) * sc - w / 2, y = r.y * sc - hh - 4 * U;
    panel(x, y, w, hh, '#d9b45a', 0.86);
    txt(kk.label, (r.x + r.w / 2) * sc, y + hh / 2 + 1, px, '#fff', 'center');
  }

  // „🔇 Klick oder Taste für Ton“: the TV's audio context only runs after a click or key on this page (browser autoplay rule). It shows (top left, under the first house) while sound is
  // supported and not muted but the context is not running, until the next click or key; if the browser still keeps it suspended 2.5 s later, it comes back.
  function soundHint(now) {
    const S = window.FurtSound;
    if (!S || !S.supported || S.failed || (typeof sfx === 'function' && sfx.muted === true) || S.state() === 'running') return false;
    return now - gestureAt > 2500;
  }
  function drawSoundHint(now) {
    const px = 15 * U, label = '🔇 Klick oder Taste für Ton', w = textW(label, px) + 26 * U, hh = px + 14 * U, x = 12 * U, y = (12 + 100 + 8) * U;
    g.save(); g.globalAlpha = 0.78 + 0.22 * Math.sin(now / 420);
    panel(x, y, w, hh, 'rgba(255,226,120,.8)', 0.86);
    txt(label, x + w / 2, y + hh / 2 + 1, px, '#ffe9a8', 'center');
    g.restore();
  }

  function drawIntro(now) {
    const el = now - phaseAt, a = el < 400 ? el / 400 : el > INTRO_MS - 800 ? Math.max(0, (INTRO_MS - el) / 800) : 1;
    g.save(); g.globalAlpha = a * 0.55; g.fillStyle = '#0a0804'; g.fillRect(0, 0, HW, HH); g.globalAlpha = a;
    txt('🏰 Furt & Fehde', HW / 2, HH * 0.3, 88 * U, '#ffe9b0', 'center', SERIF(88 * U));
    txt('Baut Burgen, haltet die Furten und gewinnt Ruhm!', HW / 2, HH * 0.3 + 70 * U, 26 * U, '#fff', 'center');
    txt('🌊 Zuerst herrscht Burgfrieden (' + fmtClock(burg) + ') — das Wasser fällt, dann beginnt die Fehde.', HW / 2, HH * 0.3 + 108 * U, 19 * U, '#cfe4f4', 'center');
    houses.forEach((h, i) => {
      const y = HH * 0.5 + i * 40 * U, label = h.base + '  —  ' + ownersOf(h), px = 24 * U, w = textW(label, px);
      shield(HW / 2 - w / 2 - 28 * U, y - 16 * U, 26 * U, 32 * U, h.color, h.i);
      txt(label, HW / 2 - w / 2 - 4 * U, y + 1, px, '#fff');
    });
    g.restore();
  }

  function drawEnd(now) {
    const e = endInfo;
    if (!e) return;
    const a = clampN((now - endAt - 500) / 700, 0, 1);
    if (a <= 0) return;
    g.save(); g.globalAlpha = a;
    g.fillStyle = 'rgba(8,6,3,.82)'; g.fillRect(0, 0, HW, HH);
    const rows = e.ranking, win = rows[0], wh = win ? houses[win.lord] : null;
    txt('🏁 Die Fehde ist entschieden!', HW / 2, 52 * U, 46 * U, '#ffe9b0', 'center', SERIF(46 * U));
    if (wh) {
      const t = '🏆 ' + wh.base + ' · ' + ownersOf(wh);
      txt(t, HW / 2, 108 * U, fitPx(t, HW - 80 * U, 38 * U), light(wh.color, 0.3), 'center');
      txt('⭐ ' + Math.round(win.ruhm) + ' Ruhm — das berühmteste Haus im Tal', HW / 2, 146 * U, 21 * U, '#fff', 'center');
    }
    // ranking: rank, house, then where the Ruhm came from
    const cols = [['⚔️', 'kills'], ['💥', 'buildings'], ['🔥', 'crops'], ['💰', 'plunder'], ['🏘️', 'prosperity'], ['🗡️', 'betrayal']];
    const tw = Math.min(HW - 60 * U, 1060 * U), x0 = HW / 2 - tw / 2, rowH = 52 * U, y0 = 182 * U, colW = 78 * U, scoreX = x0 + tw - 20 * U, c0 = scoreX - 96 * U - colW * cols.length;
    panel(x0 - 10 * U, y0 - 8 * U, tw + 20 * U, rowH * (rows.length + 1) + 16 * U, 'rgba(255,240,200,.35)', 0.7);
    cols.forEach((c, i) => txt(c[0], c0 + colW * i + colW * 0.7, y0 + rowH / 2, 24 * U, '#f4e6c2', 'right'));
    txt('Ruhm', scoreX, y0 + rowH / 2, 20 * U, '#f4e6c2', 'right');
    rows.forEach((r, i) => {
      const h = houses[r.lord], y = y0 + rowH * (i + 1), by = r.by || {};
      if (!h) return;
      shield(x0 + 60 * U, y + rowH / 2 - 19 * U, 28 * U, 36 * U, h.color, h.i);
      txt(['🥇', '🥈', '🥉'][i] || (i + 1) + '.', x0 + 14 * U, y + rowH / 2, 30 * U, '#fff');
      txt(h.base, x0 + 88 * U, y + rowH / 2 - 10 * U, fitPx(h.base, c0 - x0 - 100 * U, 23 * U), light(h.color, 0.35));
      txt(ownersOf(h), x0 + 88 * U, y + rowH / 2 + 14 * U, fitPx(ownersOf(h), c0 - x0 - 100 * U, 14 * U), '#d8cfb8');
      cols.forEach((c, k) => { const v = by[c[1]] || 0; txt(v ? String(Math.round(v)) : '–', c0 + colW * k + colW * 0.7, y + rowH / 2, 21 * U, v < 0 ? '#ff8a7a' : v ? '#fff' : '#8f8878', 'right'); });
      txt(String(Math.round(r.ruhm)), scoreX, y + rowH / 2, 30 * U, '#ffe27a', 'right');
    });
    txt('Ruhm aus:  ⚔️ Gefechten   💥 Zerstörung   🔥 Feldern   💰 Plünderung   🏘️ Wohlstand   🗡️ Verrat', HW / 2, y0 + rowH * (rows.length + 1) + 30 * U, 14 * U, '#cfc6b0', 'center');
    // titles
    const ty = y0 + rowH * (rows.length + 1) + 62 * U, ts = e.titles;
    if (ts.length) {
      const tileW = Math.min(250 * U, (HW - 80 * U) / ts.length - 12 * U), totalW = ts.length * (tileW + 12 * U) - 12 * U;
      ts.forEach((t, i) => {
        const h = houses[t.lord], x = HW / 2 - totalW / 2 + i * (tileW + 12 * U);
        if (!h) return;
        panel(x, ty, tileW, 92 * U, h.color, 0.72);
        txt(t.icon + ' ' + t.name, x + tileW / 2, ty + 24 * U, fitPx(t.icon + ' ' + t.name, tileW - 16 * U, 21 * U), '#fff', 'center');
        txt(h.base, x + tileW / 2, ty + 52 * U, fitPx(h.base, tileW - 16 * U, 17 * U), light(h.color, 0.35), 'center');
        txt(t.text, x + tileW / 2, ty + 74 * U, fitPx(t.text, tileW - 16 * U, 14 * U), '#e8dcc0', 'center');
      });
    }
    const hy = Math.min(HH - 26 * U, ty + (ts.length ? 92 * U : 0) + 42 * U);
    txt('Host (' + (hostId() != null ? shortName(hostId()) : '–') + '): 🔁 Nochmal am Handy drücken', HW / 2, hy, 24 * U, '#ffe27a', 'center');
    g.restore();
  }

  function drawHud(now, alpha) {
    g = hctx; if (!g) return;
    U = HH / 720;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, HW, HH);
    const st = sim.state;
    if (phase === 'end') { drawEnd(now); return; }
    g.save();
    refreshHud(now);
    drawKeepTags(st);
    drawBannerLabels(st, alpha);
    for (const h of houses) drawLordPanel(h, st, now);
    const top = drawClock(st, now);
    drawHerald(now, top);
    drawKampfLabel();
    if (phase === 'live' && soundHint(now)) drawSoundHint(now);
    if (phase === 'intro') drawIntro(now); else drawBanners(now);
    g.restore();
  }

  // ---------- messages from phones (validated; the sim re-validates everything and never throws) ----------
  const missingOf = (cost, stock) => Object.keys(cost || {}).filter((k) => (cost[k] || 0) > ((stock && stock[k]) || 0)).map((k) => NEED[k] || k);
  const REASON_BUILD = {
    lord: '❌ Das geht gerade nicht', kind: '❌ Das geht gerade nicht', phase: '❌ Das Spiel ist vorbei', bounds: '❌ Außerhalb deines Landes', owner: '❌ Nur auf deinem eigenen Land',
    terrain: '❌ Hier kann man nicht bauen', wet: '🌊 Zu nass — das Wasser steht noch', occupied: '❌ Der Platz ist belegt', tight: '❌ Zu eng — lass ein Feld Abstand',
    forest: '🌲 Zu wenig Wald in der Nähe', rock: '🪨 Der Steinbruch braucht Fels am Rand'
  };
  const REASON_PAUSE = { none: '❌ Das gibt es nicht mehr', kind: '❌ Nur Hof, Holzfäller und Steinbruch können ruhen', done: '❌ Nur fertige Betriebe können ruhen', other: '❌ Das geht gerade nicht' };
  function reply(h, text, only) { (only != null ? [only] : h.humans).forEach((id) => toast(id, text)); }
  function handleOrder(id, h, d) {
    switch (d.t) {
      case 'ffBuild': {
        if (typeof d.kind !== 'string' || !own(Sim.CONST.BUILD, d.kind) || d.kind === 'bergfried' || !isInt(d.i) || !isInt(d.j)) return;
        let rot = d.rot;
        if (rot === undefined || rot === false) rot = 0; else if (rot === true) rot = 1;
        if (rot !== 0 && rot !== 1) return;
        const y = sim.youOf(h.i), ruin = sim.state.buildings.some((b) => b.lord === h.i && b.ruined && b.kind === d.kind && b.i === d.i && b.j === d.j && (b.rot | 0) === rot);
        const r = sim.build(h.i, d.kind, d.i, d.j, rot);
        if (r.ok) { reply(h, (ruin ? '♻️ ' + BNAME(d.kind) + ' wird wiederaufgebaut' : '🔨 ' + BNAME(d.kind) + ' wird gebaut'), id); }
        else if (r.reason === 'cost') reply(h, '❌ Zu wenig ' + (missingOf(Sim.CONST.BUILD[d.kind].cost, y && y.stock).join(' und ') || 'Material'), id);
        else reply(h, REASON_BUILD[r.reason] || '❌ Das geht gerade nicht', id);
        return r;
      }
      case 'ffCancel': {
        if (!isInt(d.id) || d.id < 1) return;
        const r = sim.cancel(h.i, d.id);
        if (!r.ok) reply(h, r.reason === 'none' ? '❌ Das gibt es nicht mehr' : '❌ Das geht gerade nicht', id);
        return r;
      }
      case 'ffRecruit': {
        if (typeof d.unit !== 'string' || !own(Sim.CONST.UNIT, d.unit) || d.unit === 'bauer' || !isInt(d.n) || d.n < 0 || d.n > 3) return;
        const y = sim.youOf(h.i), r = sim.recruit(h.i, d.unit, d.n);
        if (r.ok) return r;
        else if (r.reason === 'cost') reply(h, '❌ Zu wenig ' + (missingOf(Sim.CONST.UNIT[d.unit].cost, y && y.stock).join(' und ') || 'Material'), id);
        else if (r.reason === 'kaserne') reply(h, '❌ Dafür braucht ihr erst eine Kaserne', id);
        else if (r.reason === 'pop') reply(h, '❌ Zu wenige Bauern übrig (oder die Warteschlange ist voll)', id);
        else reply(h, '❌ Das geht gerade nicht', id);
        return r;
      }
      case 'ffBanner': {
        if (!isInt(d.n) || d.n < 1 || d.n > 3 || !isNum(d.x) || !isNum(d.y)) return;
        const r = sim.banner(h.i, d.n, clampN(d.x, -200, 200), clampN(d.y, -200, 200));
        if (!r.ok) reply(h, r.reason === 'pact' ? '🤝 Tabu: das Land eures Paktpartners' : '❌ Das geht gerade nicht', id);
        else if (r.reason === 'unreachable') reply(h, '🌊 Kein Weg — die Fahne wartet am Ufer', id);
        else if (r.reason === 'snapped') reply(h, '📍 Die Fahne geht zum nächsten erreichbaren Ort', id);
        return r;
      }
      case 'ffPause': {   // a workplace rests (💤) or works again: the sender's own finished Hof, Holzfäller or Steinbruch
        if (!isInt(d.id) || d.id < 1 || typeof d.on !== 'boolean') return;
        const b = sim.state.buildings.find((x) => x.id === d.id && x.lord === h.i);
        if (!b) { reply(h, REASON_PAUSE.none, id); return { ok: false, reason: 'none' }; }
        if (!(((Sim.CONST.BUILD[b.kind] || {}).workers | 0) > 0)) { reply(h, REASON_PAUSE.kind, id); return { ok: false, reason: 'kind' }; }
        if (b.ruined || b.build < 1) { reply(h, REASON_PAUSE.done, id); return { ok: false, reason: 'kind' }; }
        if (typeof sim.pause !== 'function') { reply(h, REASON_PAUSE.other, id); return { ok: false, reason: 'phase' }; }   // a sim without the rest rule
        const r = sim.pause(h.i, d.id, d.on);
        if (!r.ok) reply(h, r.reason === 'none' ? REASON_PAUSE.none : r.reason === 'kind' ? REASON_PAUSE.kind : REASON_PAUSE.other, id);
        return r;
      }
      case 'ffHome': {
        const r = sim.home(h.i);
        if (!r.ok) reply(h, '❌ Das geht gerade nicht', id);
        return r;
      }
      case 'ffPact': {
        if (!isInt(d.to) || d.to < 0 || d.to >= houses.length || d.to === h.i || typeof d.on !== 'boolean') return;
        const r = sim.pact(h.i, d.to, d.on);
        if (!r.ok) reply(h, r.reason === 'zwei' ? '🤝 Mit nur zwei Häusern gibt es keine Pakte' : r.reason === 'none' ? '🤝 Da gibt es nichts zu beenden' : '❌ Das geht gerade nicht', id);
        else if (d.on && r.state === 'offered') reply(h, '🤝 Angebot an ' + houseName(d.to) + ' gesendet (30 Sek.)', id);
        return r;
      }
      default: return;
    }
  }

  // ---------- instance ----------
  function seatLate(id) {                          // a joiner (or a returning device) → a house, or the spectators
    if (phase === 'end') { spectators.push(id); return null; }
    const back = homeOf[id] != null ? houses[homeOf[id]] : null;
    let h = back && back.humans.length < MAX_PER_HOUSE ? back : null;
    if (!h) h = houses.filter((x) => x.humans.length < MAX_PER_HOUSE).sort((a, b) => a.humans.length - b.humans.length || a.i - b.i)[0] || null;   // bot-run houses (0 humans) come first
    if (!h) { spectators.push(id); return null; }
    const botWas = h.bot ? h.bot.name : null;
    if (botWas) dropBot(h);
    h.humans.push(id); homeOf[id] = h.i;
    herald('👤 ' + shortName(id) + ' übernimmt ' + h.base + (botWas ? ' von ' + botWas : ''), h.color);
    return h;
  }
  // a freed seat goes to the first spectator before a bot takes over (with spectators every house is full, so the freed seat is the only one)
  function fillFromSpectators(prefer) {
    const moved = [];
    while (phase !== 'end' && spectators.length) {
      const h = prefer && prefer.humans.length < MAX_PER_HOUSE ? prefer : houses.filter((x) => x.humans.length < MAX_PER_HOUSE).sort((a, b) => a.humans.length - b.humans.length || a.i - b.i)[0];
      if (!h) break;
      const nid = spectators.shift();
      if (!players[nid]) continue;
      const botWas = h.bot ? h.bot.name : null;
      if (botWas) dropBot(h);
      h.humans.push(nid); homeOf[nid] = h.i; moved.push(nid);
      herald('👤 ' + shortName(nid) + ' übernimmt ' + h.base + (botWas ? ' von ' + botWas : ''), h.color);
    }
    return moved;
  }

  return {
    acceptsJoin: true,

    start(ids, c) {
      cfg = Object.assign({ dauer: 20, burgen: 4, staerke: 'ritter', burgfrieden: '120', quality: 'auto', aufloesung: 'normal' }, c || {});
      Sim = window.FurtSim; World = window.FurtWorld;
      blit = /[?&]blit=1\b/.test(location.search);
      view = (Sim && World) ? ensureView() : null;
      if (!view) { endToLobby('🏰 Furt & Fehde braucht einen Browser mit WebGL.'); return; }
      curQuality = cfg.quality === 'low' ? 'low' : 'high'; autoDone = false; capDropped = false; glitches = []; glitchUntil = 0;
      if (!gestureFn) { gestureFn = () => { gestureAt = nowMs(); }; ['pointerdown', 'keydown', 'touchstart', 'click'].forEach((e) => document.addEventListener(e, gestureFn, true)); }   // the sound hint ends with the next click or key
      safe('setQuality', () => view.setQuality(curQuality));
      safe('setCap', () => view.setCap(cfg.aufloesung === 'nativ' ? 100000 : 0, cfg.aufloesung === 'nativ' ? 100000 : 0));
      sized = ''; syncHudSize();
      showWrap(true);
      matchNo = 0; homeOf = {}; lastHost = hostId();
      startMatch(ids.slice());
    },

    stop() {
      timers.forEach(clearTimeout); timers = [];
      if (gestureFn) { ['pointerdown', 'keydown', 'touchstart', 'click'].forEach((e) => document.removeEventListener(e, gestureFn, true)); gestureFn = null; }
      snd((S) => { S.ambience(null); S.battle(0); });
      if (view) { safe('inset', () => view.inset(null)); safe('clear', () => view.setWorld(null, [])); }
      showWrap(false); cv.style.display = '';
      phase = 'idle'; sim = null; world = null; view = null; hctx = null; endInfo = null; bots = {}; houses = []; spectators = []; kk.on = false;
    },

    onConnect(id) {
      if (!sim || known().includes(id)) return;
      const h = seatLate(id);
      if (h) { lordsMsg = null; sendInfoAll(); }
      // the shell sends enterGame AFTER onConnect (the phone resets itself): answer a moment later
      later(() => { if (sim && known().includes(id)) sendFull(id); }, 120);
    },

    onDisconnect(id) {
      if (!sim) return;
      spectators = spectators.filter((x) => x !== id);
      const h = houseOfId(id);
      if (h) h.humans = h.humans.filter((x) => x !== id);
      if (!known().length) { endToLobby('🏰 Furt & Fehde: alle Lords sind weg.'); return; }
      if (!h) return;
      const moved = fillFromSpectators(h);
      if (!h.humans.length && phase !== 'end') { addBot(h); herald(h.bot.name + ' übernimmt ' + h.base, h.color); }
      sendInfoAll();
      moved.forEach((nid) => sendFull(nid));       // a spectator who got a seat now needs the house's state
    },

    // a phone that reloaded or lost its connection and comes back with the same device id (shell: shellSync → enterGame → onReconnect)
    canResume(id) { return !!sim && known().includes(id); },
    onReconnect(id) { sendFull(id); },

    onMessage(id, d) {
      if (!d || typeof d.t !== 'string' || !sim) return;
      if (d.t === 'ffAgain') { if (phase === 'end' && id === hostId() && known().includes(id)) newMatch(); return; }
      const h = houseOfId(id);
      if (!h || (phase !== 'live' && phase !== 'intro')) return;
      return handleOrder(id, h, d);                // the sim's answer (for the dev harness's stand-in players)
    },

    render() {
      if (!sim || !view || phase === 'idle') return;
      const now = nowMs();
      const rawMs = now - last, dt = clampN(rawMs / 1000, 0, fast ? 5 : 0.1); last = now;

      // host change → resend the flags (the 🔁 button follows ffInfo.host) and the end state
      const host = hostId();
      if (host !== lastHost) { lastHost = host; sendInfoAll(); if (phase === 'end' && endInfo) { sendAll(phaseMsg()); known().forEach((id) => send(id, resultFor(id))); } }

      let alpha = 1;
      if (phase === 'intro' && now - phaseAt >= INTRO_MS) toLive(now);
      if (phase === 'live') {
        acc += dt;
        const maxSteps = fast ? 90 : MAX_STEPS;
        let steps = 0;
        while (acc >= sim.dt && steps < maxSteps && phase === 'live') {
          if (hooks.pre) safe('hook', hooks.pre);
          stepBots();
          const evs = safe('sim.step', () => sim.step()) || []; acc -= sim.dt; steps++;
          handleEvents(evs);
          if (Math.round(sim.state.t / sim.dt) % 4 === 0) scanFights(now);
          if (sim.state.phase === 'over') break;
        }
        if (phase === 'live' && sim.state.phase === 'over') toEnd();   // the `over` event was missed (state advanced from outside)
        if (acc > sim.dt) acc = acc % sim.dt;
        alpha = phase === 'live' ? clampN(acc / sim.dt, 0, 1) : 1;
        if (phase === 'live') {
          syncPhones(now, false);
          snd((S) => { S.ambience(sim.state.level > 0.3 ? 'flood' : 'calm'); S.battle(battle); });
          if (!firstFrame && !fast) sampleFrame(now, rawMs);
        }
      } else if (phase === 'intro') syncPhones(now, false);   // orders given during the title card show up at once

      if (fast) return;
      fit(false);
      kkFrame(now);
      safe('view.render', () => view.render(sim.state, alpha, { now, dt, snap: firstFrame }));
      if (firstFrame && phase === 'intro') { phaseAt = nowMs(); last = phaseAt; }   // the title card counts from the first picture (shader compiles stall the first frame)
      firstFrame = false;
      syncHudSize();
      safe('hud', () => drawHud(now, alpha));
      const watching = typeof viewerCount === 'number' ? viewerCount > 0 : true;
      if (blit || (watching && now - mirrorAt >= MIRROR_MS)) { mirrorAt = now; safe('mirror', mirror); }
    },

    // dev harness only: skip all drawing while fast-forwarding (the next drawn frame snaps); `_hook('pre', fn)` runs before every sim step
    _fast(on) { fast = !!on; if (!fast) firstFrame = true; },
    _hook(name, fn) { hooks[name] = fn; },

    _debug() { return { sim, phase, view, seats: houses, bots, spectators, houses, endInfo, quality: curQuality, autoDone, capDropped, kk, feed, heraldLog, banners, fighters, cluster, hudCache, world, soundHint: soundHint(nowMs()) }; }
  };
}});
