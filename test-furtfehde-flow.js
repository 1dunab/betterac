// Furt & Fehde end-to-end: the real shell + real phone pages in JSDOM, the view is a stub (JSDOM has no WebGL); the sim, the bots and the glue are the real thing.
// Scenario 1: 5 phones on 4 houses (one shared) — seating, the whole phone protocol (ffInfo / ffMap / ffLevel / ffPhase / ffYou / ffBoard / ffAlert / ffToast /
//   ffResult), build / recruit / banner / pact round trips, validation, throttling, the phases and the ebb, alerts, the Kampf-Kamera, a late joiner, the end,
//   host change, rematch and the way back to the lobby; Phase 1b: the ffPause round trip + the 13th ffBoard field, ffYou.food, buildDone stays silent;
//   Phase 1b round 2: the 13th field is 0 works · 1 rests by order · 2 rests because its store is full (card text, 💤 sign on the TV), the queue's `wait` flag, advisor tip 5 for recruits
//   nobody can take, the Kaserne texts, and the keep's grey crumbling look (no orange embers).
//   Scenario 2: bots, takeover and the return of a device, reconnect.  Scenario 3: 9 phones → 8 seats + 1 spectator.  Scenario 4: settings (dauer default 20, burgen,
//   staerke, Auflösung, quality) and the no-WebGL fallback.  Scenario 5 (Phase 1b): Auto quality with a stub clock (the median; a 1-s hitch is ignored; nativ → normal cap →
//   Sparsam), the „🔇 Klick oder Taste für Ton“ hint, and sound.js in a sandbox with a fake AudioContext (buildDone silent, the hammer at half volume once per 2 s, the unlock).
//   `sim.pause` / `youOf().food` come from C1: while a sim does not have them yet, this test installs small stand-ins and says so.
const { makeDom } = require('./test-helpers');
const FW = require('./public/games/furtfehde/world.js');
const FS = require('./public/games/furtfehde/sim.js');

let checks = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { checks++; if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (fn()) return true; } catch (e) { /* not yet */ } await sleep(5); }
  fail('Timeout: ' + what); return false;
}

const ONLY = process.argv[2] || '';            // `node test-furtfehde-flow.js 2` runs only scenario 2
const want = (n) => !ONLY || ONLY === String(n);
const SPEED = 6;   // the screen page's clock runs 6x faster (intro, ebb, kampf-kamera); one frame stays <= the glue's 0.1 s clamp

// ---- in-process server bus with device resume (like server.js: a returning phone may take its old id back) ----
function makeBusR() {
  const clients = new Map(); let nextId = 1;
  return {
    handlers: {},
    register(label, h) { this.handlers[label] = h; },
    disconnect(label) {
      const e = [...clients.entries()].find(([, l]) => l === label);
      if (!e) return;
      clients.delete(e[0]);
      for (const [, ol] of clients) this.handlers[ol].deliver({ type: 'disconnect', device_id: e[0] });
    },
    fromClient(label, raw) {
      const msg = JSON.parse(raw);
      if (msg.type === 'register') {
        let id;
        if (msg.role === 'screen') id = 0;
        else if (Number.isInteger(msg.resume) && msg.resume > 0 && msg.secret === 's' + msg.resume && !clients.has(msg.resume)) id = msg.resume;
        else id = nextId++;
        clients.set(id, label);
        this.handlers[label].deliver({ type: 'welcome', device_id: id, code: 'LOCAL', devices: [...clients.keys()], secret: id ? 's' + id : undefined });
        for (const [oid, ol] of clients) if (oid !== id) this.handlers[ol].deliver({ type: 'connect', device_id: id });
        this.handlers[label]._id = id;
        return;
      }
      if (msg.type === 'message') {
        const entry = [...clients.entries()].find(([, l]) => l === label);
        if (!entry) return;
        const from = entry[0];
        if (msg.to === undefined || msg.to === null) { for (const [, ol] of clients) if (ol !== label) this.handlers[ol].deliver({ type: 'message', from, data: msg.data }); }
        else { const l = clients.get(msg.to); if (l) this.handlers[l].deliver({ type: 'message', from, data: msg.data }); }
      }
    }
  };
}

// ---- stub view: records what the glue asks of the view ----
function stubView(w, calls) {
  Object.assign(calls, { made: 0, setWorld: 0, resizes: 0, events: 0, evTypes: {}, qualities: [], insets: [], render: 0, snaps: 0, dispose: 0, inset: null });
  w.THREE = {};
  w.FurtView = class {
    constructor(T, o) {
      this.canvas = w.document.createElement('canvas'); this.W = 960; this.H = 600; this.quality = o.quality; this.insetRect = null;
      calls.made++; calls.ctorQuality = o.quality;
    }
    setWorld(world, lords) { calls.setWorld++; calls.world = world; calls.lords = lords; }
    setQuality(q) { calls.qualities.push(q); this.quality = q; if (q !== 'high') this.insetRect = null; }
    setCap(a, b) { calls.cap = [a, b]; }
    resize(wd, ht) { calls.resizes++; calls.size = [wd, ht]; }
    event(ev) { calls.events++; calls.evTypes[ev.t] = (calls.evTypes[ev.t] || 0) + 1; }
    render(state, alpha, opts) { calls.render++; calls.opts = opts; calls.alpha = alpha; if (opts.snap) calls.snaps++; }
    project(x, y) { return { x: 480 + x * 5, y: 300 + y * 5, visible: true }; }
    inset(rect, focus) {
      if (!rect || this.quality !== 'high') { this.insetRect = null; if (calls.inset) calls.insets.push('off'); calls.inset = null; return; }
      this.insetRect = Object.assign({}, rect); calls.inset = { rect: Object.assign({}, rect), focus: Object.assign({}, focus) }; calls.insetFrames = (calls.insetFrames || 0) + 1;
      if (!calls.insets.length || calls.insets[calls.insets.length - 1] === 'off') calls.insets.push('on');
    }
    dispose() { calls.dispose++; }
  };
}
function fastClock(w) {
  const real = w.performance.now.bind(w.performance), t0 = real();
  w.performance.now = () => t0 + (real() - t0) * SPEED;
}
function recordInbox(bus, l) {
  const h = bus.handlers[l], orig = h.deliver; h.inbox = [];
  h.deliver = (m) => { if (m.type === 'message') { h.inbox.push(m.data); h.inbox[h.inbox.length - 1].__at = h.win ? h.win.performance.now() : 0; } orig(m); };
}
const phoneOf = (bus, cs, l) => ({
  l, get id() { return bus.handlers[l]._id; }, dom: cs[l],
  all: (t) => bus.handlers[l].inbox.filter((m) => m.t === t),
  last(t) { return this.all(t).pop(); },
  clear() { bus.handlers[l].inbox.length = 0; },
  send: (data) => bus.fromClient(l, JSON.stringify({ type: 'message', to: 0, data }))
});
function join(p, name) {
  p.dom.window.document.getElementById('nameInput').value = name;
  p.dom.window.document.getElementById('joinBtn').click();
}
async function startGame(p, cfg, seed) {
  const btn = [...p.dom.window.document.querySelectorAll('#gamePicker button')].find((b) => b.textContent === '🏰 Furt & Fehde');
  if (!btn) { fail('Furt & Fehde steht nicht im Picker'); return false; }
  btn.click(); await sleep(60);
  p.send({ t: 'shellConfig', game: 'furtfehde', cfg });
  await sleep(40);
  return seed;
}
async function launch(p, w, cfg, seed) {
  await startGame(p, cfg);
  w.eval("cfgFor('furtfehde').seed = " + (seed || 0));          // fixed world for the test (the schema has no seed)
  p.dom.window.document.getElementById('startBtn').click();
  await sleep(150);
}

// The real FurtWarmap recomputes a flood mask on every ffLevel and redraws every frame: with six phone pages in one Node process the ebb would crawl.
// So only the first phone keeps the real map; the others get a map that accepts every call (their DOM, messages and toasts stay the real controller).
function lightPhones(cs, labels) {
  for (const l of labels.slice(1)) {
    cs[l].window.FurtWarmap = class { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? function () { return {}; } : undefined), set: (t, k, v) => { t[k] = v; return true; } }); } };
  }
}
function spyBots(w) { const calls = [], real = w.FurtBots.create; w.FurtBots.create = (sim, lord, opts) => { calls.push({ lord, opts: Object.assign({}, opts) }); return real(sim, lord, opts); }; return calls; }
function watchErrors(w) { const errs = []; w.console.error = (...a) => { errs.push(a.map((x) => (x && x.stack) || String(x)).join(' ')); }; return errs; }
const dbgOf = (w) => () => w.eval('active && active._debug()');
const rate = (arr, from, to) => arr.filter((m) => m.__at >= from && m.__at <= to).length;
function worst(arr, per, t0, t1) { let m = 0; for (let t = t0; t <= t1 - per; t += per / 10) m = Math.max(m, rate(arr, t, t + per)); return m; }

const consumed = (inj) => until(() => inj.pending() === 0, 8000, 'die Sim hat die eingeschleusten Ereignisse ausgegeben');   // the glue handles them in the same call
function installSpy(sim) {
  const rec = []; const orig = {};
  for (const fn of ['build', 'cancel', 'recruit', 'banner', 'home', 'pact', 'pause']) {
    if (typeof sim[fn] !== 'function') continue;
    orig[fn] = sim[fn];
    sim[fn] = (...a) => { const r = orig[fn].apply(sim, a); rec.push({ fn, args: a, r }); return r; };
  }
  return { rec, calls: (fn) => rec.filter((x) => x.fn === fn), restore() { for (const fn of Object.keys(orig)) sim[fn] = orig[fn]; } };
}
function injector(sim) {      // adds synthetic events to the output of the next sim.step() (for events that are hard to provoke)
  const real = sim.step; let q = [];
  sim.step = function () { const ev = real.call(sim); if (q.length) { for (const e of q) ev.push(e); q = []; } return ev; };
  return { add: (...e) => { q.push(...e); }, pending: () => q.length, restore() { sim.step = real; } };
}
const keepId = (st, lord) => st.buildings.find((b) => b.kind === 'bergfried' && b.lord === lord).id;
// C1's R5 / R9 (sim.pause, youOf().food) — if the sim under test has no such API yet, a stand-in with the documented behaviour keeps the glue testable
function standIns(sim) {
  const out = { pause: false, food: false };
  if (typeof sim.pause !== 'function') {
    out.pause = true;
    sim.pause = (lord, id, on) => {
      const b = sim.state.buildings.find((x) => x.id === id && x.lord === lord);
      if (!b) return { ok: false, reason: 'none' };
      if (!['hof', 'holzfaeller', 'steinbruch'].includes(b.kind) || b.ruined || b.build < 1) return { ok: false, reason: 'kind' };
      b.paused = !!on; return { ok: true };
    };
  }
  const realYou = sim.youOf;
  if (!realYou(0) || realYou(0).food === undefined) { out.food = true; sim.youOf = (l) => { const y = realYou(l); if (y && !y.food) y.food = { prod: 12 + l, eat: Math.round(y.pop * 60 / FS.CONST.EAT_S) }; return y; }; }
  return out;
}
function spot(w, sim, kind, lord) { return w.FurtWorld.suggest(sim.world, kind, sim.state.lords[lord].site, { L: sim.state.level, occ: sim.occ }); }

(async () => {
  // ============================================================ Scenario 1: 5 phones on 4 houses (one shared)
  if (want(1)) {
    const bus = makeBusR();
    const screen = makeDom('screen.html', 'screen', bus, 'screen');
    const cs = {};
    for (const l of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) { cs[l] = makeDom('controller.html', 'controller', bus, l); recordInbox(bus, l); }
    lightPhones(cs, Object.keys(cs));
    await sleep(150);
    const w = screen.window, calls = {};
    for (const l of Object.keys(cs)) bus.handlers[l].win = w;
    check(['FurtWorld', 'FurtSim', 'FurtBots', 'FurtArt', 'FurtFx', 'FurtView', 'FurtSound'].every((k) => typeof w[k] !== 'undefined'), 'alle Furt-&-Fehde-Skripte sind auf der Screen-Seite geladen (meta → world → sim → bots → art → terrain → fx → render → sound → screen)');
    check(['FurtWorld', 'FurtWarmap'].every((k) => typeof cs.c1.window[k] !== 'undefined') && cs.c1.window.CONTROLLERS.furtfehde && cs.c1.window.GAME_META.furtfehde, 'die Handy-Seite lädt meta → world → warmap → controller');
    stubView(w, calls); fastClock(w);
    const glueErr = watchErrors(w);
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:,';   // JSDOM has no canvas: the shell's own Mitschauen stream needs this
    w.eval('viewerCount = 2');               // Mitschauen viewers exist: the glue mirrors view + HUD into cv (the code path runs, nothing may throw)
    const soundEv = []; const realSE = w.FurtSound.event; w.FurtSound.event = (ev) => { soundEv.push(ev.t); return realSE(ev); };
    const reported = []; const origReport = w.reportWinners; w.reportWinners = (ids) => { reported.push(ids.slice()); origReport(ids); };
    const [p1, p2, p3, p4, p5, p6] = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((l) => phoneOf(bus, cs, l));
    join(p1, 'Anna'); join(p2, 'Ben'); join(p3, 'Cleo'); join(p4, 'Dino'); join(p5, 'Eva');
    await sleep(150);
    const gm = w.GAME_META.furtfehde;
    check(gm && gm.label === '🏰 Furt & Fehde' && gm.min === 1 && ['dauer', 'burgen', 'staerke', 'burgfrieden', 'quality', 'aufloesung'].every((k) => gm.settings[k]), 'meta.js: Label, min 1 und die sechs Einstellungen');
    check(gm.settings.dauer.default === 20 && gm.settings.dauer.max === 40 && gm.settings.dauer.min === 6 && gm.settings.burgen.default === 4 && gm.settings.staerke.default === 'ritter' && gm.settings.burgfrieden.default === '120' && gm.settings.quality.default === 'auto' && gm.settings.aufloesung.default === 'normal', 'meta.js: Vorgaben 20 Min (6 … 40) · 4 Burgen · Ritter · 2 Min Burgfrieden · Auto · Normal');
    check(gm.settings.staerke.label === 'Bot-Stärke' && gm.settings.staerke.options.map((o) => o.v + '=' + o.label).join('|') === 'knappe=🛡️ Knappe (leicht)|ritter=⚔️ Ritter (mittel)|kriegsherr=👑 Kriegsherr (schwer)', 'meta.js: „Bot-Stärke“ mit Knappe (leicht) · Ritter (mittel) · Kriegsherr (schwer)');
    await launch(p1, w, { dauer: 6, burgen: 4, staerke: 'knappe', burgfrieden: '60', quality: 'high', aufloesung: 'normal' }, 11);
    const dbg = dbgOf(w), st = () => dbg().sim.state, colors = w.eval('players');
    const ids = [p1.id, p2.id, p3.id, p4.id, p5.id];
    const stand = standIns(dbg().sim);       // C1's sim.pause / youOf().food, if they are not there yet
    if (stand.pause || stand.food) console.log('Hinweis: ' + [stand.pause && 'sim.pause', stand.food && 'youOf().food'].filter(Boolean).join(' und ') + ' fehlt(en) noch (C1) – der Test läuft gegen ' + (stand.pause && stand.food ? 'Stand-ins' : 'einen Stand-in'));

    // ---- seating, colours, the view ----
    check(dbg() && dbg().phase === 'intro', 'Start → Intro (Stub-View akzeptiert, kein WebGL-Fallback)');
    check(calls.made === 1 && calls.setWorld === 1 && calls.ctorQuality === 'high' && calls.resizes >= 1 && calls.cap[0] === 0 && calls.cap[1] === 0, 'View einmal gebaut (high), setWorld einmal, Größe gesetzt, Auflösung normal → setCap(0, 0)');
    const H = () => dbg().houses;
    check(H().length === 4 && H().map((h) => h.site).join() === '0,1,2,3', '4 Burgen auf den Plätzen 0, 1, 2, 3');
    check(H()[0].humans.join() === [p1.id, p5.id].join() && H()[1].humans.join() === String(p2.id) && H()[2].humans.join() === String(p3.id) && H()[3].humans.join() === String(p4.id), 'Sitze reihum in Beitrittsreihenfolge: Anna → I, Ben → II, Cleo → III, Dino → IV, Eva teilt Haus I');
    check(H().every((h) => h.bot === null) && Object.keys(dbg().bots).length === 0 && dbg().spectators.length === 0, 'kein Bot und kein Zuschauer, wenn alle Häuser besetzt sind');
    check(calls.lords.length === 4 && calls.lords[0].color === colors[p1.id].color && calls.lords[1].color === colors[p2.id].color && calls.lords[2].color === colors[p3.id].color && calls.lords[3].color === colors[p4.id].color, 'view.setWorld: Hausfarbe = Spielerfarbe des ersten Menschen');
    check(calls.lords.every((l, i) => l.i === i && l.emblem === i && l.site === i && typeof l.name === 'string' && /^Haus /.test(l.name)), 'view.setWorld: lords { i, site, color, name, emblem } mit Emblem = Lord-Index');
    check(st().lords.length === 4 && st().endsAt === 360 && dbg().sim.world === calls.world, 'Einstellungen erreichen die Sim: 6 Min = 360 s, dieselbe Welt in Sim und View');

    // ---- ffInfo ----
    const ci = FS.CONST;
    for (const [p, lord] of [[p1, 0], [p2, 1], [p3, 2], [p4, 3], [p5, 0]]) {
      const info = p.last('ffInfo');
      check(info && info.lord === lord && info.color === colors[ids[lord]].color && info.lords.length === 4, 'ffInfo für ' + colors[p.id].name + ': Haus ' + (lord + 1) + ', Hausfarbe, 4 Lords');
    }
    const info1 = p1.last('ffInfo'), info2 = p2.last('ffInfo');
    check(info1.host === true && info2.host === false && p5.last('ffInfo').host === false, 'Host-Flag nur am Host (Anna)');
    check(info1.lords.map((l) => l.i).join() === '0,1,2,3' && info1.lords.every((l) => l.bot === false && l.emblem === l.i && typeof l.color === 'string'), 'ffInfo.lords nach Lord-Index geordnet, bot:false');
    check(info1.lords[0].name === 'Haus Falkenstein · Anna & Eva' && info1.lords[1].name === 'Haus Wolfsberg · Ben' && info1.lords[3].name === 'Haus Hirschfurt · Dino', 'Anzeigename = Hausname · Spielernamen („Anna & Eva“)');
    check(info1.shared === 'Eva' && p5.last('ffInfo').shared === 'Anna' && info2.shared === false && p3.last('ffInfo').shared === false, 'shared = Name des Mitspielers, nur am geteilten Haus');
    check(info1.rules && Object.keys(info1.rules).sort().join() === 'bucketR,capKeep,capKorn,capLager,hutHouses,keepHouses,keepWellR' && info1.rules.bucketR === ci.BUCKET_R && info1.rules.keepWellR === ci.KEEP_WELL_R && info1.rules.capKeep === ci.CAP_KEEP && info1.rules.capKorn === ci.CAP_KORN && info1.rules.capLager === ci.CAP_LAGER && info1.rules.keepHouses === ci.KEEP_HOUSES && info1.rules.hutHouses === ci.HUT_HOUSES, 'ffInfo.rules aus FurtSim.CONST (bucketR, keepWellR, capKeep, capKorn, capLager, keepHouses, hutHouses)');
    check([p1, p2, p3, p4, p5].every((p) => JSON.stringify(p.last('ffInfo').rules) === JSON.stringify(info1.rules)) && typeof info1.rules.bucketR === 'number' && info1.rules.bucketR > 0 && info1.rules.keepHouses > 0, 'ffInfo.rules kommt bei allen Handys gleich an (Zahlen > 0)');
    check(info1.costs && info1.costs.rebuild === ci.REBUILD_COST && info1.costs.build.hof.holz === ci.BUILD.hof.cost.holz && info1.costs.build.kaserne.stein === ci.BUILD.kaserne.cost.stein && info1.costs.units.ritter.stein === ci.UNIT.ritter.cost.stein && !('bergfried' in info1.costs.build) && !('bauer' in info1.costs.units), 'ffInfo.costs aus FurtSim.CONST (Gebäude, Einheiten, Wiederaufbau)');

    // ---- ffMap, ffLevel, ffPhase ----
    for (const p of [p1, p2, p3, p4, p5]) {
      const m = p.last('ffMap');
      check(m && typeof m.grid.cls === 'string' && typeof m.grid.hq === 'string' && typeof m.grid.owner === 'string' && m.sites.length === 4 && m.crossings.length >= 5 && m.crossings.every((c) => !('cells' in c) && Array.isArray(c.ends) && typeof c.open === 'number'), 'ffMap bei ' + colors[p.id].name + ': codiertes Gitter, 4 Plätze, Furten ohne cells, mit ends/open');
    }
    const order1 = cs.c1 && bus.handlers.c1.inbox.map((m) => m.t);
    check(order1.indexOf('ffMap') >= 0 && order1.indexOf('ffLevel') > order1.indexOf('ffMap'), 'ffLevel folgt direkt auf ffMap');
    check(p1.last('ffLevel').L === 1, 'ffLevel L = 1 (alles überflutet)');
    const ph0 = p2.last('ffPhase');
    check(ph0 && ph0.phase === 'frieden' && ph0.endsAt === 60 && ph0.now === 0, 'ffPhase frieden: endsAt = Ende des Burgfriedens (60 s), now = 0');
    check(cs.c1.window.document.getElementById('ffWait').classList.contains('show') === false && /Burgfrieden/.test(cs.c1.window.document.getElementById('ffPhase').textContent), 'die echte Handy-Seite baut die Karte auf und zeigt den Phasen-Chip „Burgfrieden“');

    await until(() => dbg().phase === 'live', 6000, 'Intro → live');
    check(p2.all('ffPhase').length >= 2, 'ffPhase wird beim Übergang in die Partie erneut gesendet (Uhr abgleichen)');
    check(calls.snaps === 1 && calls.opts.now > 0 && typeof calls.opts.dt === 'number' && calls.opts.dt <= 0.1, 'genau ein snap-Frame; opts.now (ms) und dt (s, ≤ 0.1)');
    check(w.document.getElementById('c').style.display === 'none' && w.document.body.lastElementChild.querySelectorAll('canvas').length === 2 || [...w.document.querySelectorAll('canvas')].length >= 3, 'cv ist versteckt, der Wrapper trägt View- und HUD-Canvas');
    check(typeof w.document.querySelector('canvas') !== 'undefined' && [...w.document.querySelectorAll('div')].some((d) => d.style.position === 'fixed' && d.style.width === '100vw' && d.style.height === '100vh'), 'der Wrapper füllt das Fenster (fixed, 100vw × 100vh)');
    await until(() => p1.last('ffYou') && p2.last('ffBoard') && p6.all('ffYou').length === 0, 3000, 'ffYou / ffBoard');

    // ---- ffYou / ffBoard ----
    const you = p3.last('ffYou');
    check(you && you.stock.korn === ci.START.korn && you.stock.holz === ci.START.holz && you.stock.stein === ci.START.stein && you.cap.korn === ci.CAP_KEEP && you.pop === ci.START_PEASANTS && you.popCap === ci.KEEP_HOUSES && typeof you.idle === 'number' && you.hunger === false && Array.isArray(you.queue) && you.ruhm === 0 && you.crown === false, 'ffYou: Lager, Kapazität, Volk, Wohnraum, idle, hunger, Warteschlange, Ruhm, Krone');
    check(typeof you.now === 'number' && Array.isArray(you.banners) && Array.isArray(you.pacts) && you.pacts.length === 3 && you.pacts.every((x) => x.state === 'none' && typeof x.with === 'number' && x.with !== 2), 'ffYou: now (Sim-Sekunden), banners und pacts der drei anderen Häuser');
    check(p3.all('ffYou').length >= 1 && p3.all('ffYou').every((m) => typeof m.now === 'number') && p2.all('ffPhase').every((m) => typeof m.now === 'number' && typeof m.endsAt === 'number'), 'jedes ffYou trägt now, jedes ffPhase endsAt und now (auch das erste nach ffMap)');
    check(p1.last('ffYou') && p5.last('ffYou') && p1.last('ffYou').stock.holz === p5.last('ffYou').stock.holz, 'beide Handys des geteilten Hauses bekommen denselben Stand');
    await until(() => p3.last('ffYou') && p3.last('ffYou').food, 3000, 'ffYou.food');
    { const f = p3.last('ffYou').food, y3 = p3.last('ffYou');
      check(f && Number.isInteger(f.prod) && Number.isInteger(f.eat) && f.prod >= 0 && f.eat >= 0 && Object.keys(f).sort().join() === 'eat,prod', 'ffYou.food = { prod, eat }: ganze Säcke pro Minute');
      check(stand.food || f.eat === Math.round(y3.pop * 60 / ci.EAT_S), 'ffYou.food.eat = round(Leute · 60 / EAT_S) (R9)' + (stand.food ? ' [Stand-in]' : '')); }
    check(p6.all('ffYou').length === 0 && p6.all('ffBoard').length === 0, 'ein Handy ohne Haus (noch nicht beigetreten) bekommt nichts');
    const board0 = p2.last('ffBoard');
    check(board0 && Array.isArray(board0.b) && Array.isArray(board0.banners) && board0.b.every((r) => r.length === 13 && r[2] !== 'bergfried' && (r[12] === 0 || r[12] === 1 || r[12] === 2)), 'ffBoard: Zeilen mit 13 Feldern [id, lord, kind, i, j, rot, build, hp, fire, ruined, noWood, workers, rest 0/1/2], ohne Bergfried');

    // ---- orders: build ----
    const sim = dbg().sim, S = st(), spy = installSpy(sim);
    let inj = injector(sim);
    const hofSpot = spot(w, sim, 'hof', 0);
    p1.send({ t: 'ffBuild', kind: 'hof', i: hofSpot.i, j: hofSpot.j, rot: hofSpot.rot }); await sleep(40);
    const hofB = S.buildings.find((b) => b.lord === 0 && b.kind === 'hof');
    check(!!hofB && hofB.i === hofSpot.i && hofB.build < 1 && S.t > 0, 'ffBuild erreicht die Sim: der Hof steht als Baustelle');
    check(p1.all('ffToast').some((m) => /Hof wird gebaut/.test(m.text)) && !p5.all('ffToast').some((m) => /Hof wird gebaut/.test(m.text)), 'Erfolgs-Toast „🔨 Hof wird gebaut“ nur beim Absender');
    await until(() => (p2.last('ffBoard') || { b: [] }).b.some((r) => r[2] === 'hof' && r[1] === 0), 2000, 'ffBoard zeigt den Hof');
    const hofRow = p2.last('ffBoard').b.find((r) => r[2] === 'hof');
    check(hofRow.length === 13 && hofRow[12] === 0 && hofRow[3] === hofSpot.i && hofRow[4] === hofSpot.j && hofRow[5] === hofSpot.rot && hofRow[6] >= 0 && hofRow[6] <= 1 && hofRow[7] > 0, 'ffBoard-Zeile des Hofs: Position, Drehung, build/hp 0..1');
    await until(() => p1.last('ffYou').stock.holz <= 25 - ci.BUILD.hof.cost.holz + 3, 2000, 'ffYou zeigt den bezahlten Hof');
    const shared = spot(w, sim, 'huette', 0);
    p5.send({ t: 'ffBuild', kind: 'huette', i: shared.i, j: shared.j, rot: shared.rot }); await sleep(40);
    check(S.buildings.some((b) => b.lord === 0 && b.kind === 'huette'), 'auch das zweite Handy des geteilten Hauses darf bauen');
    p2.send({ t: 'ffBuild', kind: 'hof', i: hofSpot.i, j: hofSpot.j, rot: hofSpot.rot }); await sleep(40);
    check(p2.all('ffToast').some((m) => /eigenen Land/.test(m.text)) && S.buildings.filter((b) => b.kind === 'hof').length === 1, 'Bauplatz im fremden Land → Toast „❌ Nur auf deinem eigenen Land“ (Grund-Code nicht roh)');
    sim.dev.stock(2, { holz: 0 });
    const s3 = spot(w, sim, 'hof', 2);
    p3.send({ t: 'ffBuild', kind: 'hof', i: s3.i, j: s3.j, rot: s3.rot }); await sleep(40);
    check(p3.all('ffToast').some((m) => /Zu wenig Holz/.test(m.text)) && !S.buildings.some((b) => b.lord === 2 && b.kind === 'hof'), 'zu wenig Holz → Toast „❌ Zu wenig Holz“');
    sim.dev.stock(2, { holz: 25 });
    p3.send({ t: 'ffBuild', kind: 'wachturm', i: 5, j: 5, rot: 0 }); await sleep(30);
    check(p3.all('ffToast').filter((m) => /❌|🌊/.test(m.text)).length >= 2 && p3.all('ffToast').every((m) => !/^(owner|cost|bounds|wet|occupied|terrain|tight)$/.test(m.text)), 'Ablehnungen kommen als deutsche Toasts, nie als Grund-Code');

    // ---- orders: cancel ----
    const holz0 = sim.youOf(0).stock.holz;
    p1.send({ t: 'ffCancel', id: hofB.id }); await sleep(40);
    check(!S.buildings.some((b) => b.id === hofB.id) && sim.youOf(0).stock.holz === holz0 + ci.BUILD.hof.cost.holz, 'ffCancel: Baustelle weg, volle Rückerstattung');
    p1.send({ t: 'ffCancel', id: 999999 }); await sleep(30);
    check(p1.all('ffToast').some((m) => /gibt es nicht mehr/.test(m.text)), 'ffCancel einer unbekannten id → Toast „❌ Das gibt es nicht mehr“');

    // ---- orders: recruit, banner, home ----
    p1.send({ t: 'ffRecruit', unit: 'speer', n: 1 }); await sleep(40);
    check(p1.all('ffToast').some((m) => /Kaserne/.test(m.text)) && sim.youOf(0).queue.length === 0, 'ffRecruit ohne Kaserne → Toast „Dafür braucht ihr erst eine Kaserne“');
    const ks = spot(w, sim, 'kaserne', 0), placed = sim.dev.place(0, 'kaserne', ks.i, ks.j, ks.rot);
    check(placed.ok === true, 'Testhilfe: eine fertige Kaserne steht');
    sim.dev.stock(0, { korn: 30, holz: 30, stein: 20 });
    p1.send({ t: 'ffRecruit', unit: 'speer', n: 1 }); p1.send({ t: 'ffRecruit', unit: 'speer', n: 1 }); await sleep(40);
    check(sim.youOf(0).queue.length === 2 && spy.calls('recruit').some((x) => x.args[1] === 'speer' && x.args[2] === 1 && x.r.ok), 'ffRecruit: zwei Speerträger in der Warteschlange von Fahne I');
    await until(() => (p1.last('ffYou').queue || []).length >= 1, 2000, 'ffYou zeigt die Warteschlange');
    check(p1.last('ffYou').queue.every((q) => q.unit === 'speer' && q.n === 1 && q.p >= 0 && q.p <= 1), 'ffYou.queue: { unit, n, p } mit p 0..1');
    await until(() => S.banners.some((b) => b.lord === 0 && b.n === 1 && b.count >= 1), 8000, 'die erste Fahne entsteht');
    const gate = { x: dbg().world.sites[0].x + 0.5, y: dbg().world.sites[0].y + 3.5 };
    p1.send({ t: 'ffBanner', n: 1, x: gate.x + 4, y: gate.y + 5 }); await sleep(40);
    check(spy.calls('banner').some((x) => x.args[0] === 0 && x.args[1] === 1 && x.r.ok), 'ffBanner erreicht die Sim');
    await until(() => (p1.last('ffYou').banners || []).some((b) => b.n === 1 && Math.abs(b.tx - (gate.x + 4)) < 1.6), 2500, 'ffYou.banners trägt das Ziel');
    const yb = p1.last('ffYou').banners.find((b) => b.n === 1);
    check(yb && typeof yb.x === 'number' && typeof yb.tx === 'number' && yb.count >= 1, 'ffYou.banners: { n, count, x, y, tx, ty }');
    await until(() => (p2.last('ffBoard') || { banners: [] }).banners.some((b) => b[0] === 0 && b[1] === 1 && b[4] >= 1), 3000, 'ffBoard.banners');
    const brow = p2.last('ffBoard').banners.find((b) => b[0] === 0 && b[1] === 1);
    check(brow.length === 5 && brow[4] >= 1, 'ffBoard.banners: [lord, n, x, y, count]');
    const mid = dbg().world.werder;
    p1.send({ t: 'ffBanner', n: 1, x: mid.x, y: mid.y }); await sleep(40);
    check(p1.all('ffToast').some((m) => /Kein Weg|nächsten erreichbaren/.test(m.text)), 'ffBanner auf ein unerreichbares Ziel (Hochwasser) → Toast „🌊 Kein Weg …“ bzw. „nächsten erreichbaren Ort“');
    p1.send({ t: 'ffHome' }); await sleep(30);
    check(spy.calls('home').length === 1 && spy.calls('home')[0].args[0] === 0, 'ffHome erreicht die Sim');

    // ---- the real phone (c1 keeps the real war map): food balance by 🌾, the first recruit toasts where to send the troops ----
    {
      const ph1 = cs.c1.window, d1 = ph1.document;
      await until(() => /^\+\d+ −\d+$/.test(d1.getElementById('ffFood').textContent), 3000, 'die Nahrungsbilanz am Handy');
      const f = p1.last('ffYou').food;
      check(d1.getElementById('ffFood').classList.contains('show') && d1.getElementById('ffFood').classList.contains(f.prod >= f.eat ? 'pos' : 'neg') && d1.getElementById('ffKorn').contains(d1.getElementById('ffFood')), 'Handy: „+p −e“ steht bei 🌾 (grün bei genug Ernte, sonst rot): ' + d1.getElementById('ffFood').textContent);
      await until(() => ph1.__ff.st.bld.some((b) => b.kind === 'kaserne' && b.build >= 1), 3000, 'die Kaserne steht auf dem Handy');
      sim.dev.stock(0, { korn: 40, holz: 40, stein: 20 });
      await until(() => (p1.last('ffYou').stock.korn | 0) >= 30, 3000, 'das Handy sieht das Lager');
      check(ph1.__ff.st.recruited === false, 'Handy: noch kein Rekrut in dieser Partie');
      const nrec = spy.calls('recruit').length;
      d1.getElementById('ffUnit-bogen').click(); d1.getElementById('ffUnit-speer').click();
      await sleep(950);
      const tt = Array.from(d1.querySelectorAll('.ff-toast')).map((t) => t.textContent);
      check(spy.calls('recruit').length >= nrec + 2 && tt.filter((t) => /Ausgebildete Truppen schickst du unter ⚑ Fahnen los/.test(t)).length === 1, 'Handy: der erste Rekrut der Partie sagt einmal „Ausgebildete Truppen schickst du unter ⚑ Fahnen los“ (' + tt.length + ' Toast(s))');
      check(/Fahnen/.test(d1.getElementById('ffMode-banner').textContent) && /Schicken|schicken/.test(d1.getElementById('ffSend').textContent || 'schicken'), 'Handy: der Reiter heißt „Fahnen“, „📍 Schicken“ ist da');
      // the ❓ guide: it pulses in the Burgfrieden until it has been opened once on this device; ✕ and the back gesture close it
      check(st().phase === 'frieden' && d1.getElementById('ffHelp').classList.contains('pulse') && !ph1.localStorage.getItem('ffGuideSeen'), 'Handy: das ❓ pulsiert im Burgfrieden, solange die Anleitung nie offen war');
      d1.getElementById('ffHelp').click();
      check(d1.getElementById('ffGuide').classList.contains('show') && !d1.getElementById('ffHelp').classList.contains('pulse') && ph1.localStorage.getItem('ffGuideSeen') === '1' && ph1.history.state && ph1.history.state.ffGuide === 1, 'Handy: ❓ öffnet die Anleitung, das Pulsen endet, „gesehen“ steht im localStorage, die Zurück-Geste hat einen Eintrag');
      ph1.history.back(); await until(() => !d1.getElementById('ffGuide').classList.contains('show'), 2500, 'die Zurück-Geste schließt die Anleitung');
      check(!d1.getElementById('ffGuide').classList.contains('show'), 'Handy: die Zurück-Geste (history.back) schließt die Anleitung');
      d1.getElementById('ffHelp').click(); d1.getElementById('ffGuideX').click(); await sleep(150);
      d1.getElementById('ffHelp').click(); await sleep(60);
      check(d1.getElementById('ffGuide').classList.contains('show'), 'Handy: nach ✕ lässt sich die Anleitung sofort wieder öffnen (das späte popstate von ✕ schließt sie nicht)');
      d1.getElementById('ffGuideX').click(); await sleep(150);
      check(!d1.getElementById('ffGuide').classList.contains('show'), 'Handy: ✕ schließt die Anleitung');
      // ffInfo.rules reaches the real phone, the top bar shows every cap, and a tap on a good opens the 📦 Lager sheet (W2): numbers from ffYou and the rules, three ways to close it
      check(JSON.stringify(ph1.__ff.st.rules) === JSON.stringify(info1.rules), 'Handy: ffInfo.rules wird übernommen (' + JSON.stringify(ph1.__ff.st.rules) + ')');
      { const you = () => ph1.__ff.st.you, cap = () => you().cap, capTxt = (id) => d1.querySelector('#' + id + ' .cap').textContent;
        check(capTxt('ffKorn') === '/' + cap().korn && capTxt('ffHolz') === '/' + cap().holz && capTxt('ffStein') === '/' + cap().stein && cap().korn === ci.CAP_KEEP, 'Handy: die Kopfleiste zeigt die Kappen („🌾 ' + (you().stock.korn | 0) + capTxt('ffKorn') + '“)');
        check(!d1.getElementById('ffLager').classList.contains('show'), 'Handy: das Lager-Blatt ist zu, solange niemand tippt');
        d1.getElementById('ffHolz').click();
        check(d1.getElementById('ffLager').classList.contains('show') && ph1.history.state && ph1.history.state.ffLager === 1, 'Handy: ein Tipp aufs Holz öffnet das „📦 Lager“-Blatt, die Zurück-Geste hat einen Eintrag');
        const row = (id, sel) => d1.querySelector('#ffLg-' + id + ' ' + sel).textContent;
        check(['korn', 'holz', 'stein'].every((r) => row(r, '.amt') === String(you().stock[r] | 0) && row(r, '.cp') === '/ ' + cap()[r]) && row('pop', '.amt') === String(you().pop | 0) && row('pop', '.cp') === '/ ' + you().popCap, 'Handy: das Blatt zeigt Menge und Kappe jedes Guts und die Leute (' + row('korn', '.amt') + ' ' + row('korn', '.cp') + ', 👥 ' + row('pop', '.amt') + ' ' + row('pop', '.cp') + ')');
        check(row('korn', '.lg-src').indexOf('Bergfried ' + ci.CAP_KEEP) === 0 && row('holz', '.lg-src').indexOf('Bergfried ' + ci.CAP_KEEP) === 0 && row('pop', '.lg-src').indexOf('Bergfried ' + ci.KEEP_HOUSES) === 0, 'Handy: das Blatt sagt, woher der Platz kommt („' + row('korn', '.lg-src') + '“ · „' + row('pop', '.lg-src') + '“)');
        check(/^Ernte \+\d+ · Verbrauch −\d+ pro Min$/.test(row('korn', '.lg-note')) && /^👷 /.test(row('pop', '.lg-note')), 'Handy: Korn zeigt „Ernte +p · Verbrauch −e pro Min“, Leute die freien Bauern („' + row('korn', '.lg-note') + '“ · „' + row('pop', '.lg-note') + '“)');
        ph1.history.back(); await until(() => !d1.getElementById('ffLager').classList.contains('show'), 2500, 'die Zurück-Geste schließt das Lager-Blatt');
        check(!d1.getElementById('ffLager').classList.contains('show'), 'Handy: die Zurück-Geste (history.back) schließt das Lager-Blatt');
        d1.getElementById('ffKorn').click(); d1.getElementById('ffLagerX').click(); await sleep(150);
        d1.getElementById('ffStein').click(); await sleep(60);
        check(d1.getElementById('ffLager').classList.contains('show'), 'Handy: nach ✕ lässt sich das Lager-Blatt sofort wieder öffnen (das späte popstate von ✕ schließt es nicht)');
        d1.getElementById('ffLager').click(); await sleep(150);
        check(!d1.getElementById('ffLager').classList.contains('show'), 'Handy: ein Tipp neben das Blatt schließt es');
      }
    }

    // ---- orders: pause (R5, P5): a workplace rests; the board's 13th field flips ----
    {
      sim.dev.stock(0, { korn: 15 });   // (below the cap: with a full 🌾 store the Hof would rest by itself and the 13th field would say 2, see the R11 block below)
      const sp1 = spot(w, sim, 'hof', 0), farm = sim.dev.place(0, 'hof', sp1.i, sp1.j, sp1.rot);
      check(farm.ok === true, 'Testhilfe: ein fertiger Hof zum Ruhen');
      const row = (p) => (p.last('ffBoard') || { b: [] }).b.find((r) => r[0] === farm.id);
      await until(() => row(p5) && row(p2), 2500, 'ffBoard zeigt den fertigen Hof');
      check(row(p5).length === 13 && row(p5)[12] === 0, 'ffBoard: das 13. Feld (paused) ist 0, solange der Betrieb arbeitet');
      const n0 = spy.calls('pause').length; p1.clear(); p5.clear();
      p1.send({ t: 'ffPause', id: farm.id, on: true });
      await until(() => row(p5) && row(p5)[12] === 1, 3000, 'ffBoard: paused = 1');
      const pc = spy.calls('pause');
      check(pc.length === n0 + 1 && pc[n0].args[0] === 0 && pc[n0].args[1] === farm.id && pc[n0].args[2] === true && pc[n0].r.ok === true && S.buildings.find((b) => b.id === farm.id).paused === true, 'ffPause erreicht sim.pause(0, id, true); das Gebäude ruht' + (stand.pause ? ' [Stand-in]' : ''));
      check(row(p2)[12] === 1 && row(p1)[12] === 1, 'die 13. Spalte kommt bei allen Handys an (auch bei fremden Häusern und beim Mitspieler)');
      check(!p1.all('ffToast').some((m) => /❌/.test(m.text)), 'ein erlaubtes ffPause bringt keinen Fehler-Toast');
      p5.send({ t: 'ffPause', id: farm.id, on: true }); await sleep(40);
      check(spy.calls('pause').length === n0 + 2 && row(p5)[12] === 1, 'zweimal ruhen lassen ist in Ordnung (ok, bleibt 1)');
      p5.clear(); p1.send({ t: 'ffPause', id: farm.id, on: false });
      await until(() => row(p5) && row(p5)[12] === 0, 3000, 'ffBoard: paused = 0');
      check(S.buildings.find((b) => b.id === farm.id).paused === false && spy.calls('pause').pop().args[2] === false, '▶ Weiterarbeiten: ffPause on:false, die 13. Spalte kippt zurück');
      { // the same through the real phone's building card
        const ph1 = cs.c1.window, d1 = ph1.document;
        await until(() => ph1.__ff.st.byId[farm.id] && ph1.__ff.st.byId[farm.id].truth === false, 3000, 'das Handy kennt den Hof');
        ph1.__ff.openCard(ph1.__ff.st.byId[farm.id]);
        check(!d1.getElementById('ffCPause').hidden && /Ruhen lassen/.test(d1.getElementById('ffCPause').textContent) && /1 Bauer sät und erntet Korn/.test(d1.getElementById('ffCWozu').textContent) && /Aue/.test(d1.getElementById('ffCWohin').textContent), 'Handy: die Hofkarte bietet „💤 Ruhen lassen“ und zeigt Wozu · Wohin · Wie viele');
        const n1 = spy.calls('pause').length;
        d1.getElementById('ffCPause').click();
        await until(() => S.buildings.find((b) => b.id === farm.id).paused === true && ph1.__ff.st.byId[farm.id].truth === true, 3000, 'ffPause vom echten Handy → Sim → Brett → Handy');
        check(spy.calls('pause').length === n1 + 1 && /💤 ruht – die Arbeiter sind frei/.test(d1.getElementById('ffCState').textContent) && /Weiterarbeiten/.test(d1.getElementById('ffCPause').textContent) && ph1.__ff.map.board.buildings.find((b) => b.id === farm.id).paused === true, 'Handy: Karte steht auf „💤 ruht – die Arbeiter sind frei“, Knopf „▶ Weiterarbeiten“, die Karte zeigt das 💤');
        d1.getElementById('ffCPause').click();
        await until(() => S.buildings.find((b) => b.id === farm.id).paused === false && ph1.__ff.st.byId[farm.id].truth === false, 3000, '▶ Weiterarbeiten vom echten Handy');
        check(!/ruht/.test(d1.getElementById('ffCState').textContent) && /Ruhen lassen/.test(d1.getElementById('ffCPause').textContent), 'Handy: nach ▶ steht die Karte wieder auf „arbeitet / wartet“');
        ph1.__ff.closeCard();
      }
      // refusals: German toasts, the sim never asked, the board unchanged
      const refusals = [
        [{ t: 'ffPause', id: keepId(S, 0), on: true }, /Nur Hof, Holzfäller und Steinbruch/, 'der Bergfried'],
        [{ t: 'ffPause', id: S.buildings.find((b) => b.lord === 0 && b.kind === 'huette' && !b.ruined) ? S.buildings.find((b) => b.lord === 0 && b.kind === 'huette' && !b.ruined).id : keepId(S, 0), on: true }, /Nur Hof, Holzfäller und Steinbruch/, 'eine Hütte'],
        [{ t: 'ffPause', id: keepId(S, 2), on: true }, /gibt es nicht mehr/, 'ein Gebäude eines anderen Hauses'],
        [{ t: 'ffPause', id: 987654, on: true }, /gibt es nicht mehr/, 'eine unbekannte id']
      ];
      const nr = spy.calls('pause').length;
      for (const [msg, re, what] of refusals) { p1.clear(); p1.send(msg); await sleep(40); check(p1.all('ffToast').some((m) => re.test(m.text) && /^❌/.test(m.text)), 'Ablehnung (' + what + '): deutscher Toast ❌ …'); }
      const sx = spot(w, sim, 'hof', 0), sb = sim.build(0, 'hof', sx.i, sx.j, sx.rot);   // an unfinished workplace
      if (sb.ok) { p1.clear(); p1.send({ t: 'ffPause', id: sb.id, on: true }); await sleep(40); check(p1.all('ffToast').some((m) => /Nur fertige Betriebe können ruhen/.test(m.text)), 'Ablehnung (eine Baustelle): „Nur fertige Betriebe können ruhen“'); sim.cancel(0, sb.id); }
      check(spy.calls('pause').length === nr, 'abgelehnte ffPause erreichen sim.pause nicht (' + (spy.calls('pause').length - nr) + ' von ' + (refusals.length + (sb.ok ? 1 : 0)) + ')');
      check(row(p5)[12] === 0, 'das Brett bleibt nach den Ablehnungen unverändert');
      sim.cancel(0, farm.id);
    }

    // ---- R11 (round 2): a workplace whose store is full rests by itself: the board's 13th field is 2, the card says so, „💤 Ruhen lassen“ stays possible, a rest by order wins ----
    {
      const sp2 = spot(w, sim, 'hof', 0), farm2 = sim.dev.place(0, 'hof', sp2.i, sp2.j, sp2.rot);
      check(farm2.ok === true, 'Testhilfe: ein fertiger Hof, dessen Korn wir voll halten');
      const row2 = (p) => (p.last('ffBoard') || { b: [] }).b.find((r) => r[0] === farm2.id), fb = () => S.buildings.find((b) => b.id === farm2.id);
      const realStep = sim.step;   // the house eats during a step: top the 🌾 store up to its cap before every step, so the Hof stays full for the whole test
      sim.step = function () { sim.dev.stock(0, { korn: sim.youOf(0).cap.korn }); return realStep.call(sim); };
      try {
        await until(() => row2(p5) && row2(p5)[12] === 2, 4000, 'ffBoard: 13. Feld = 2 (Lager voll)');
        check(fb().full === true && fb().paused === false && row2(p5)[11] === 0 && row2(p5).length === 13, 'das Brett sagt 2, wenn das Korn am Deckel steht: buildings[].full, nicht pausiert, keine Arbeiter (12. Feld 0)');
        check(row2(p2)[12] === 2 && row2(p1)[12] === 2, 'die 2 kommt bei allen Handys an (auch bei fremden Häusern)');
        const ph1 = cs.c1.window, d1 = ph1.document;
        await until(() => ph1.__ff.st.byId[farm2.id] && ph1.__ff.st.byId[farm2.id].full === true, 3000, 'das Handy kennt den vollen Betrieb');
        const pb = ph1.__ff.st.byId[farm2.id];
        check(pb.full === true && pb.paused === false && pb.truth === false, 'Handy: die 2 heißt full, nicht ruht (paused und truth bleiben false)');
        ph1.__ff.openCard(pb);
        check(/📦 Lager voll – die Arbeiter sind frei/.test(d1.getElementById('ffCState').textContent) && d1.getElementById('ffCState').className === 'rest', 'Handy: die Karte sagt „📦 Lager voll – die Arbeiter sind frei“');
        check(!d1.getElementById('ffCPause').hidden && /Ruhen lassen/.test(d1.getElementById('ffCPause').textContent), 'Handy: „💤 Ruhen lassen“ bleibt möglich');
        check(ph1.__ff.map.board.buildings.find((b) => b.id === farm2.id).paused === false, 'Handy: die Karte zeigt kein 💤 (das bleibt dem Befehl vorbehalten)');
        const n1 = spy.calls('pause').length;
        d1.getElementById('ffCPause').click();
        await until(() => fb().paused === true && row2(p5)[12] === 1 && ph1.__ff.st.byId[farm2.id].truth === true, 3000, 'ein Befehl zum Ruhen gewinnt gegen „voll“: 13. Feld = 1');
        check(spy.calls('pause').length === n1 + 1 && fb().full === false && /💤 ruht – die Arbeiter sind frei/.test(d1.getElementById('ffCState').textContent), 'ruhen auf Befehl: paused, nicht full, das Brett sagt 1, die Karte „💤 ruht“');
        d1.getElementById('ffCPause').click();
        await until(() => fb().paused === false && row2(p5)[12] === 2 && ph1.__ff.st.byId[farm2.id].full === true, 3000, '▶ Weiterarbeiten: zurück auf 2 (das Lager ist noch voll)');
        check(fb().full === true && /📦 Lager voll/.test(d1.getElementById('ffCState').textContent), 'nach ▶ steht der Hof wieder auf „Lager voll“ (die Karte auch)');
        ph1.__ff.closeCard();
      } finally { sim.step = realStep; }
      sim.dev.stock(0, { korn: 5 });
      await until(() => row2(p5) && row2(p5)[12] === 0, 4000, 'ffBoard: wieder Platz → 13. Feld = 0');
      check(fb().full === false, 'wieder Platz im Lager: full false, das Brett sagt 0');
      sim.cancel(0, farm2.id);
    }

    // ---- round 2: the Kaserne texts, the queue's `wait` flag („⏳ wartet auf einen freien Bauern“) and advisor tip 5 for recruits nobody can take ----
    {
      const ph1 = cs.c1.window, d1 = ph1.document, F = ph1.__ff;
      check(/⚔️ bildet Bauern zu Soldaten aus – jede Kaserne 3 zugleich/.test(F.INFO.kaserne.wozu) && F.INFO.kaserne.viele === '1; eine zweite bildet doppelt so schnell aus', 'Handy: die Kaserne-Texte („jede Kaserne 3 zugleich“, „eine zweite bildet doppelt so schnell aus“)');
      check(F.GUIDE.some((g) => g.id === 'truppen' && g.lines.some((l) => /Jede bildet 3 Bauern zugleich aus, mit einer zweiten geht es doppelt so schnell/.test(l) && true)) && F.GUIDE.some((g) => g.id === 'korn' && g.lines.some((l) => /Volles Lager/.test(l))), 'Handy: die Anleitung erklärt die Kasernen und das volle Lager');
      const you0 = JSON.parse(JSON.stringify(p1.last('ffYou')));
      const give = (o) => bus.handlers.c1.deliver({ type: 'message', from: 0, data: Object.assign({}, you0, o, { t: 'ffYou' }) });   // the screen's ffYou, with a queue we choose (the next real one overwrites it)
      const q3 = [{ unit: 'speer', n: 1, p: 0, wait: true }, { unit: 'bogen', n: 1, p: 0, wait: true }, { unit: 'speer', n: 2, p: 0.4, wait: false }];
      const base = { hunger: false, pop: 6, popCap: 12, food: { prod: 12, eat: 6 } };
      F.st.tipSnooze = { 1: 1e15, 2: 1e15, 3: 1e15, 4: 1e15 };   // only tip 5 may speak
      const tip = () => { F.renderTip(); return d1.getElementById('ffTip').classList.contains('show') ? d1.getElementById('ffTipTx').textContent : ''; };
      const chips = (cls) => d1.querySelectorAll('#ffQueue .ff-q' + (cls || '')).length, cap = () => { const c = d1.querySelector('#ffQueue .ff-qwait'); return c ? c.textContent : ''; };
      give(Object.assign({ idle: 0, queue: q3 }, base));
      check(/^👷 Niemand frei für die Ausbildung – bau Hütten oder lass einen Betrieb 💤 ruhen$/.test(tip()), 'Berater Tipp 5: Rekruten warten und niemand ist frei → „Niemand frei für die Ausbildung – bau Hütten oder lass einen Betrieb 💤 ruhen“ (war: «' + tip() + '»)');
      check(chips() === 3 && chips('.wait') === 2 && /^⏳ /.test(d1.querySelector('#ffQueue .ff-q.wait').textContent) && cap() === '⏳ wartet auf einen freien Bauern', 'Handy: die Warteschlange markiert die zwei Rekruten ohne Bauern mit ⏳ und sagt „⏳ wartet auf einen freien Bauern“');
      check(F.st.tip && F.st.tip.id === 5 && F.st.tip.go.guide === 'korn' && F.tipCtx().waiting === 2, 'der Tipp ist Nr. 5 und führt in die Anleitung „Leute & Korn“; tipCtx().waiting = 2');
      d1.getElementById('ffTipTx').click(); check(d1.getElementById('ffGuide').classList.contains('show') && d1.getElementById('ffGuideNav-korn').classList.contains('on'), 'ein Tipp auf den Berater öffnet „Leute & Korn“'); d1.getElementById('ffGuideX').click();
      give(Object.assign({ idle: 2, queue: q3 }, base));
      check(!/Niemand frei für die Ausbildung/.test(tip()) && chips('.wait') === 0 && cap() === '', 'ist jemand frei, gibt es weder den Tipp noch das ⏳ (der Rekrut bekommt ihn in der nächsten Sekunde)');
      give(Object.assign({ idle: 0, queue: q3.map((e) => ({ unit: e.unit, n: e.n, p: e.p })) }, base));
      check(!/Niemand frei für die Ausbildung/.test(tip()) && chips('.wait') === 0 && F.tipCtx().waiting === 0, 'ein älterer Bildschirm ohne wait-Flag: kein Rekruten-Tipp, kein ⏳ (nichts wird geraten)');
      give(Object.assign({ idle: 0, queue: [{ unit: 'speer', n: 1, p: 0.5, wait: false }, { unit: 'speer', n: 1, p: 0.1, wait: false }] }, base));
      check(!/Niemand frei für die Ausbildung/.test(tip()) && chips('.wait') === 0, 'Rekruten, die schon einen Bauern haben, lösen weder Tipp noch ⏳ aus');
      F.st.tipSnooze = {}; F.renderTip();
    }

    // ---- order spam does not break the 2/s cap (orders no longer short-cut the throttle) ----
    {
      sim.dev.stock(0, { korn: 60, holz: 60, stein: 60 });
      const tS = w.performance.now();
      for (let k = 0; k < 14; k++) { p1.send({ t: 'ffRecruit', unit: k % 2 ? 'bogen' : 'speer', n: 1 + (k % 3) }); p5.send({ t: 'ffBanner', n: 1, x: gate.x + (k % 5), y: gate.y + 4 }); await sleep(25); }
      await sleep(400);
      const tE = w.performance.now(), yw = worst(p1.all('ffYou'), 1000, tS, tE), bw = worst(p2.all('ffBoard'), 1000, tS, tE);
      check(rate(p1.all('ffYou'), tS, tE) >= 2 && yw <= 2 && bw <= 2, 'Befehls-Spam (28 Befehle in ' + ((tE - tS) / 1000).toFixed(1) + ' s Bildschirmzeit): ffYou max ' + yw + '/s, ffBoard max ' + bw + '/s (≤ 2)');
    }

    // ---- validation: garbage never reaches the sim ----
    const n0 = spy.rec.length;
    const bad = [
      null, 'x', 5, [], {}, { t: 7 }, { t: 'ffBuild' }, { t: 'ffBuild', kind: 'bogus', i: 1, j: 1 }, { t: 'ffBuild', kind: '__proto__', i: 1, j: 1 }, { t: 'ffBuild', kind: 'toString', i: 1, j: 1 },
      { t: 'ffBuild', kind: 'bergfried', i: 1, j: 1 }, { t: 'ffBuild', kind: 'hof', i: 'a', j: 1 }, { t: 'ffBuild', kind: 'hof', i: 1.5, j: 1 }, { t: 'ffBuild', kind: 'hof', i: NaN, j: 1 },
      { t: 'ffBuild', kind: 'hof', i: 1, j: 1, rot: 2 }, { t: 'ffBuild', kind: 'hof', i: 1, j: 1, rot: 'x' }, { t: 'ffCancel' }, { t: 'ffCancel', id: 'a' }, { t: 'ffCancel', id: 0 }, { t: 'ffCancel', id: -3 },
      { t: 'ffRecruit' }, { t: 'ffRecruit', unit: 'bauer', n: 1 }, { t: 'ffRecruit', unit: 'drache', n: 1 }, { t: 'ffRecruit', unit: 'speer', n: 4 }, { t: 'ffRecruit', unit: 'speer', n: -1 }, { t: 'ffRecruit', unit: 'speer', n: 1.5 },
      { t: 'ffRecruit', unit: '__proto__', n: 1 }, { t: 'ffBanner' }, { t: 'ffBanner', n: 0, x: 1, y: 1 }, { t: 'ffBanner', n: 4, x: 1, y: 1 }, { t: 'ffBanner', n: 1, x: 'a', y: 1 }, { t: 'ffBanner', n: 1, x: NaN, y: 1 }, { t: 'ffBanner', n: 1, x: 1 },
      { t: 'ffPact' }, { t: 'ffPact', to: 0, on: true }, { t: 'ffPact', to: 9, on: true }, { t: 'ffPact', to: -1, on: true }, { t: 'ffPact', to: 1, on: 'yes' }, { t: 'ffPact', to: 1.5, on: true }, { t: 'ffUnbekannt' },
      { t: 'ffPause' }, { t: 'ffPause', id: 'a', on: true }, { t: 'ffPause', id: 3 }, { t: 'ffPause', id: 3, on: 'yes' }, { t: 'ffPause', id: 3, on: 1 }, { t: 'ffPause', id: 0, on: true }, { t: 'ffPause', id: -2, on: false }, { t: 'ffPause', id: 2.5, on: true }, { t: 'ffPause', id: NaN, on: true }
    ];
    for (const m of bad) p1.send(m);
    await sleep(50);
    check(spy.rec.length === n0, 'ungültige Nachrichten erreichen die Sim nicht (' + (spy.rec.length - n0) + ' von ' + bad.length + ' durchgekommen)');
    const sx0 = spy.rec.length;
    bus.fromClient('c6', JSON.stringify({ type: 'message', to: 0, data: { t: 'ffBuild', kind: 'hof', i: hofSpot.i, j: hofSpot.j, rot: 0 } })); await sleep(30);
    check(spy.rec.length === sx0, 'Nachrichten von Handys ohne Haus (noch nicht beigetreten) werden ignoriert');
    p1.send({ t: 'ffBanner', n: 2, x: 9999, y: -9999 }); await sleep(30);
    const clampedCall = spy.calls('banner').filter((x) => x.args[1] === 2).pop();
    check(clampedCall && Math.abs(clampedCall.args[2]) <= 200 && Math.abs(clampedCall.args[3]) <= 200, 'Banner-Koordinaten werden vor der Sim geklemmt');
    p3.send({ t: 'ffAgain' }); await sleep(30);
    check(dbg().phase === 'live', 'ffAgain während der Partie wird ignoriert');

    // ---- pacts: offer → accept → break ----
    p1.clear(); p2.clear(); p3.clear(); p5.clear();
    p1.send({ t: 'ffPact', to: 1, on: true }); await sleep(60);
    check(p1.all('ffToast').some((m) => /Angebot an Haus Wolfsberg/.test(m.text)), 'Pakt-Angebot: Toast beim Anbieter');
    check(p2.all('ffAlert').some((a) => a.kind === 'pact' && /Haus Falkenstein/.test(a.text)) && p1.all('ffAlert').length === 0 && p3.all('ffAlert').filter((a) => a.kind === 'pact').length === 0, 'ffAlert pact geht nur an das Zielhaus');
    await until(() => (p2.last('ffYou') || { pacts: [] }).pacts.some((x) => x.with === 0 && x.state === 'incoming'), 1500, 'ffYou: eingehendes Angebot');
    check(p2.last('ffYou').pacts.find((x) => x.with === 0).until > p2.last('ffYou').now, 'ffYou.pacts: incoming mit absolutem until (Sim-Sekunden)');
    p2.send({ t: 'ffPact', to: 0, on: true }); await sleep(60);
    check(S.pacts.some((x) => x.a === 0 && x.b === 1 && x.until > S.t), 'Annahme: der Pakt ist aktiv (Sim)');
    check(p1.all('ffAlert').some((a) => a.kind === 'pact' && /Pakt mit Haus Wolfsberg/.test(a.text)) && p5.all('ffAlert').some((a) => a.kind === 'pact') && p2.all('ffAlert').some((a) => a.kind === 'pact' && /Pakt mit Haus Falkenstein/.test(a.text)), 'ffAlert pact an beide Häuser (auch das zweite Handy)');
    check(dbg().heraldLog.some((x) => /Pakt zwischen Haus Falkenstein und Haus Wolfsberg für 3 Minuten/.test(x)), 'Herold: „🤝 Pakt zwischen … für 3 Minuten“');
    await until(() => (p1.last('ffYou') || { pacts: [] }).pacts.some((x) => x.with === 1 && x.state === 'active'), 1500, 'ffYou: aktiver Pakt');
    const ruhm0 = S.lords[0].ruhm;   // (Wohlstands-Ruhm kommt mit der Sim-Zeit dazu: gezählt wird der Verrat selbst)
    p1.send({ t: 'ffPact', to: 1, on: false }); await sleep(60);
    check(sim.dev.lord(0).by.betrayal === ci.RUHM.betray && S.lords[0].ruhm - ruhm0 <= ci.RUHM.betray + 1 && S.lords[0].ruhm - ruhm0 >= ci.RUHM.betray && S.lords[1].zorn > 0, 'Verrat: −5 Ruhm für den Brecher (' + ruhm0 + ' → ' + S.lords[0].ruhm + '), Zorn für das Opfer');
    check(p2.all('ffAlert').some((a) => a.kind === 'pact' && /gebrochen/.test(a.text)) && dbg().heraldLog.some((x) => /Verrat! Haus Falkenstein bricht den Pakt mit Haus Wolfsberg/.test(x)), 'Verrat: ffAlert an das Opfer, Herold „🗡️ Verrat! …“');
    check(spy.calls('pact').length >= 3, 'ffPact (an-/zusagen, brechen) erreicht die Sim');

    // ---- alerts routed by house (synthetic events) ----
    for (const p of [p1, p2, p3, p4, p5]) p.clear();
    const ownHof = sim.dev.place(2, 'hof', s3.i, s3.j, s3.rot);
    const kx = dbg().world.sites[1], kx0 = dbg().world.sites[0];
    inj.add({ t: 'attack', lord: 1, x: kx.x + 2, y: kx.y + 6 }, { t: 'ignite', id: ownHof.id, by: 0 }, { t: 'hunger', lord: 3, on: true });
    await consumed(inj);
    const kinds = (p) => p.all('ffAlert').map((a) => a.kind).sort().join();
    check(kinds(p2) === 'attack' && kinds(p3) === 'fire' && kinds(p4) === 'hunger' && kinds(p1) === '' && kinds(p5) === '', 'attack · fire · hunger: ffAlert nur an das betroffene Haus');
    const atk = p2.all('ffAlert')[0];
    check(atk.x === kx.x + 2 && atk.y === kx.y + 6 && /Angriff/.test(atk.text), 'ffAlert attack trägt x, y (Ping auf der Karte) und deutschen Text');
    check(p3.all('ffAlert')[0].x !== undefined && /brennt/.test(p3.all('ffAlert')[0].text), 'ffAlert fire: Ort und Text');
    check(dbg().heraldLog.some((x) => /Haus Eichenhain brennt/.test(x)) && dbg().heraldLog.some((x) => /Haus Wolfsberg wird angegriffen/.test(x)), 'Herold: „🔥 Haus Eichenhain brennt!“ und „⚔️ Haus Wolfsberg wird angegriffen!“');
    inj.add({ t: 'hunger', lord: 3, on: true }, { t: 'hunger', lord: 3, on: false }, { t: 'hunger', lord: 3, on: true }); await consumed(inj);
    check(p4.all('ffAlert').filter((a) => a.kind === 'hunger').length === 1, 'hunger flappt: ffAlert gedrosselt (höchstens einer pro 30 s)');
    inj.add({ t: 'plunder', lord: 0, by: 1, loot: { korn: 3, holz: 3, stein: 0 } }); await consumed(inj);
    check(dbg().kk.on && /Haus Falkenstein wird geplündert/.test(dbg().kk.label) && calls.inset && Math.abs(calls.inset.focus.x - kx0.x) < 2, 'plunder öffnet die Kampf-Kamera an der Burg (auch ohne Schlacht, trotz Abklingzeit)');
    check(kinds(p1) === 'plunder' && kinds(p5) === 'plunder' && p2.all('ffToast').some((m) => /Beute/.test(m.text)) && dbg().heraldLog.some((x) => /Haus Falkenstein wurde geplündert!/.test(x)), 'plunder: ffAlert an das geplünderte Haus (beide Handys), Beute-Toast an den Plünderer, Herold');
    const cid = dbg().world.crossings.find((c) => c.name === 'Steinbrücke').id;
    inj.add({ t: 'crossingOpen', id: cid }, { t: 'crown', lord: 2 }); await consumed(inj);
    check([p1, p2, p3, p4, p5].every((p) => p.all('ffAlert').some((a) => a.kind === 'crossing' && /Die Steinbrücke ist frei!/.test(a.text)) && p.all('ffAlert').some((a) => a.kind === 'crown' && /Haus Eichenhain trägt die Krone/.test(a.text))), 'crossing und crown gehen an alle');
    check(dbg().heraldLog.some((x) => /Die Steinbrücke ist frei!/.test(x)) && dbg().heraldLog.some((x) => /Haus Eichenhain trägt die Krone/.test(x)), 'Herold: „🌊 Die Steinbrücke ist frei!“ · „👑 … trägt die Krone“');
    check(calls.evTypes.attack && calls.evTypes.plunder && calls.evTypes.crossingOpen && calls.evTypes.crown, 'jedes Sim-Ereignis geht an view.event (auch die injizierten)');
    check(soundEv.includes('plunder') && soundEv.includes('crossingOpen') && soundEv.includes('attack') && soundEv.includes('build'), 'jedes Sim-Ereignis geht an FurtSound.event (außer buildDone)');
    { // T2: a finished building makes no sound on the TV; the phone still toasts it
      const done = S.buildings.find((b) => b.lord === 2 && b.kind !== 'bergfried'), before = soundEv.length, plays = [], realPlay = w.FurtSound.play; w.FurtSound.play = (...a) => { plays.push(a[0]); return realPlay.apply(w.FurtSound, a); };
      p3.clear(); inj.add({ t: 'buildDone', id: done.id }); await consumed(inj); await sleep(30);
      w.FurtSound.play = realPlay;
      check(!soundEv.slice(before).includes('buildDone') && plays.length === 0 && !soundEv.includes('buildDone') && calls.evTypes.buildDone >= 1, 'buildDone: kein FurtSound-Aufruf, kein Ton (die View bekommt es trotzdem für den Staub)');
      check(p3.all('ffToast').some((m) => /ist fertig/.test(m.text)), 'buildDone: das Handy bekommt weiter „✅ … ist fertig“'); }
    inj.restore(); spy.restore();

    // ---- phases and the ebb: warn → ebbe → crossings → fehde ----
    for (const p of [p1, p2, p3, p4, p5]) p.clear();
    sim.dev.stock(0, { korn: 30, holz: 30 }); sim.dev.stock(1, { korn: 30 }); sim.dev.stock(2, { korn: 30 }); sim.dev.stock(3, { korn: 30 });
    let guard = 0;
    while (S.t < 60 - 16 && guard++ < 5000) sim.step();                // the first minute passes without the glue (its events are lost, the state is not)
    await until(() => p2.all('ffToast').some((m) => /In 15 Sekunden fällt das Wasser/.test(m.text)), 4000, 'warn-Toast');
    check(dbg().heraldLog.some((x) => /Das Wasser fällt in 15 Sekunden/.test(x)), 'Warnung 15 s vor der Ebbe: Toast und Herold');
    await until(() => p3.all('ffPhase').some((m) => m.phase === 'ebbe'), 20000, 'ffPhase ebbe');
    const eb = p3.all('ffPhase').find((m) => m.phase === 'ebbe');
    check(eb.endsAt === 60 + ci.EBB_S && eb.now >= 59.9 && eb.now < 62, 'ffPhase ebbe: endsAt = Ende der Ebbe (60 s Burgfrieden + EBB_S), now = Sim-Sekunden');
    await until(() => p4.all('ffLevel').length >= 8, 40000, 'das Wasser fällt');         // a natural slice of the ebb: the glue runs it itself
    inj = injector(sim); const opened = [];
    guard = 0;
    while (S.t < 60 + ci.EBB_S - 0.4 && guard++ < 5000) for (const e of sim.step()) if (e.t === 'crossingOpen') opened.push(e);   // the rest of the ebb is skipped; its crossing events go to the glue
    inj.add(...opened);
    await consumed(inj);
    const lv = p4.all('ffLevel').map((m) => m.L);
    check(lv.length >= 8 && lv.slice(0, 8).every((v, i) => i === 0 || v <= lv[i - 1]) && lv[0] <= 1 && lv[0] > 0.5, 'ffLevel fällt während der Ebbe monoton (' + lv.length + ' Meldungen, ab ' + lv[0] + ')');
    await until(() => p1.all('ffPhase').some((m) => m.phase === 'fehde'), 40000, 'ffPhase fehde');
    const fe = p1.all('ffPhase').find((m) => m.phase === 'fehde');
    check(fe.endsAt === 360 && st().phase === 'fehde' && p1.last('ffLevel').L === 0, 'ffPhase fehde: endsAt = Spielende (360 s); ffLevel 0');
    const crossAl = p2.all('ffAlert').filter((a) => a.kind === 'crossing');
    check(opened.length >= 3 && crossAl.length === dbg().world.crossings.length && crossAl.every((a) => /ist frei!$/.test(a.text)), 'jede sich öffnende Furt / Brücke wird allen gemeldet (' + crossAl.length + ' ffAlert crossing, davon ' + opened.length + ' aus dem übersprungenen Teil)');
    inj.restore();
    check(dbg().heraldLog.some((x) => /Die Fehde beginnt/.test(x)) && p3.all('ffPhase').filter((m) => m.phase === 'ebbe').length >= 1, 'Herold „⚔️ Die Fehde beginnt!“');
    const tEb0 = bus.handlers.c3.inbox.find((m) => m.t === 'ffPhase' && m.phase === 'ebbe').__at, tEb1 = bus.handlers.c3.inbox.find((m) => m.t === 'ffPhase' && m.phase === 'fehde').__at;
    check(worst(p4.all('ffLevel'), 1000, tEb0, tEb1) <= 4, 'ffLevel höchstens 4 pro Sekunde (max ' + worst(p4.all('ffLevel'), 1000, tEb0, tEb1) + ')');
    check(worst(p2.all('ffYou'), 1000, tEb0, tEb1) <= 2 && worst(p2.all('ffBoard'), 1000, tEb0, tEb1) <= 2, 'ffYou und ffBoard höchstens 2 pro Sekunde (max ' + worst(p2.all('ffYou'), 1000, tEb0, tEb1) + ' / ' + worst(p2.all('ffBoard'), 1000, tEb0, tEb1) + ')');
    await until(() => bus.handlers.c2.inbox.filter((m) => m.t === 'ffPhase' && m.phase === 'fehde').length >= 2, 9000, 'ffPhase alle 10 s');
    check(bus.handlers.c2.inbox.filter((m) => m.t === 'ffPhase' && m.phase === 'fehde').length >= 2, 'ffPhase wird alle 10 s erneut gesendet');

    // ---- Kampf-Kamera ----
    await until(() => !dbg().kk.on, 4000, 'die Plünderungs-Kamera schließt');
    check(calls.insets.join() === 'on,off' && calls.inset === null, 'die Kampf-Kamera schließt nach 7 s mit view.inset(null)');
    const insetsBefore = calls.insets.length;
    const sx = dbg().world.sites[0], fx = sx.x + 6, fy = sx.y + 14;
    for (let k = 0; k < 12; k++) { sim.dev.spawn(0, 'speer', fx + (k % 4) * 0.9, fy + Math.floor(k / 4) * 0.9, 1); sim.dev.spawn(1, 'speer', fx + 4.2 + (k % 4) * 0.9, fy + Math.floor(k / 4) * 0.9, 1); }
    sim.banner(0, 1, fx + 2.6, fy + 0.9); sim.banner(1, 1, fx + 2.6, fy + 0.9);      // both banners hold the spot: the soldiers stay and fight
    await until(() => dbg().kk.on, 6000, 'die Kampf-Kamera öffnet');
    const kk = calls.inset && { rect: Object.assign({}, calls.inset.rect), focus: Object.assign({}, calls.inset.focus) }, fightersAtOpen = dbg().fighters, kkLabel = dbg().kk.label;   // the opening frame has run completely
    check(kk && kk.rect.w === Math.round(960 * 0.30) && kk.rect.h === Math.round(kk.rect.w * 0.625) && kk.rect.x === Math.round((960 - kk.rect.w) / 2) && kk.rect.y + kk.rect.h < 600, 'view.inset: unten Mitte, 30 % der Breite, Rect in internen px');
    check(kk && Math.hypot(kk.focus.x - (fx + 1.3), kk.focus.y - (fy + 0.5)) < 8 && kk.focus.dist >= 24 && kk.focus.dist <= 42, 'view.inset: Fokus auf der Schlacht (' + (kk && kk.focus.x.toFixed(1)) + ', ' + (kk && kk.focus.y.toFixed(1)) + ')');
    check(/^⚔️ (Schlacht|Kampf)/.test(kkLabel) && fightersAtOpen >= 8, 'Beschriftung mit der nächsten Furt / Burg: «' + kkLabel + '» (' + fightersAtOpen + ' Kämpfer)');
    await until(() => calls.insetFrames > 3 || !dbg().kk.on, 4000, 'die Kampf-Kamera läuft mehrere Frames');
    check(calls.insetFrames > 3, 'view.inset wird jeden Frame erneuert, solange sie läuft (' + calls.insetFrames + ' Frames)');
    await until(() => !dbg().kk.on, 5000, 'die Kampf-Kamera schließt nach 7 s');
    check(calls.insets.length === insetsBefore + 2 && calls.inset === null, 'nach 7 s: view.inset(null)');
    const ks1 = dbg().kk.cool;
    for (let k = 0; k < 6; k++) { sim.dev.spawn(2, 'speer', fx - 12 + (k % 3) * 0.9, fy + 9 + Math.floor(k / 3) * 0.9, 1); sim.dev.spawn(3, 'speer', fx - 9.4 + (k % 3) * 0.9, fy + 9 + Math.floor(k / 3) * 0.9, 1); }
    await sleep(900);
    check(ks1 > 0 && (!dbg().kk.on || w.performance.now() >= ks1), 'Abklingzeit: direkt danach öffnet sich die Kampf-Kamera nicht erneut');
    for (const u of [...S.units]) if (u.kind === 'speer') sim.dev.kill(u);

    // ---- late joiner ----
    join(p6, 'Fiona'); await until(() => p6.last('ffMap'), 6000, 'Fiona bekommt den ganzen Stand');   // sendFull: ffInfo, ffMap, ffLevel, ffPhase, ffYou, ffBoard in one call
    check(H()[1].humans.join() === [p2.id, p6.id].join() && dbg().spectators.length === 0, 'Spätbeitritt: das Haus mit den wenigsten Menschen (Wolfsberg, lowest first) nimmt Fiona auf');
    const fi = p6.last('ffInfo');
    check(fi && fi.lord === 1 && fi.color === calls.lords[1].color && fi.shared === 'Ben' && p2.last('ffInfo').shared === 'Fiona', 'Spätbeitritt: ffInfo mit Haus, Hausfarbe und shared; Ben erfährt von Fiona');
    check(p6.last('ffMap') && p6.last('ffLevel') && p6.last('ffPhase') && p6.last('ffYou') && p6.last('ffBoard'), 'Spätbeitritt: der Handy-Stand kommt vollständig (ffMap, ffLevel, ffPhase, ffYou, ffBoard)');
    check(p1.last('ffInfo').lords[1].name === 'Haus Wolfsberg · Ben & Fiona', 'ffInfo.lords wird für alle aktualisiert („Ben & Fiona“)');
    check(dbg().heraldLog.some((x) => /Fiona übernimmt Haus Wolfsberg/.test(x)), 'Herold: „👤 Fiona übernimmt Haus Wolfsberg“');

    // ---- the end: ranking, titles, reportWinners once ----
    for (const p of [p1, p2, p3, p4, p5, p6]) p.clear();
    S.lords[2].ruhm = 50; S.lords[0].ruhm = 20; S.lords[1].ruhm = 10; S.lords[3].ruhm = 5;
    sim.dev.stock(3, { korn: 0 }); sim.dev.lord(0).stats.kills = 99; sim.dev.lord(1).stats.built = 99; sim.dev.lord(3).stats.ignites = 99;
    guard = 0;
    while (S.t < 360 - 1.2 && guard++ < 9000) { sim.step(); S.lords.forEach((l, i) => { l.ruhm = [20, 10, 50, 5][i]; }); }
    await until(() => dbg().phase === 'end', 6000, 'Ende');
    await until(() => p1.last('ffResult') && p6.last('ffResult'), 2000, 'ffResult');
    const rs = p3.last('ffResult');
    check(Array.isArray(rs.ranking) && rs.ranking.length === 4 && rs.ranking.map((r) => r.lord).join() === '2,0,1,3' && rs.ranking.every((r, i) => r.rank === i + 1 && typeof r.ruhm === 'number' && r.stats && r.by), 'ffResult: die Ranglisten-Zeilen der Sim (rank, lord, ruhm, stats, by), Reihenfolge nach Ruhm');
    check(rs.you && rs.you.lord === 2 && p1.last('ffResult').you.lord === 0, 'ffResult.you = die eigene Zeile');
    check(p3.last('ffPhase').phase === 'over' && p3.last('ffPhase').endsAt === 360, 'ffPhase over zusammen mit ffResult');
    check(reported.length === 1 && reported[0].join() === String(p3.id), 'reportWinners genau einmal, mit den Menschen des Siegerhauses (Cleo)');
    const tt = dbg().endInfo.titles;
    check(tt.find((t) => t.name === 'Schlächter').lord === 0 && tt.find((t) => t.name === 'Baumeister').lord === 1 && tt.find((t) => t.name === 'Brandstifter').lord === 3 && tt.find((t) => t.name === 'Diplomat').lord === 1, 'Titel: Schlächter, Baumeister, Brandstifter, Diplomat (Pakt ohne Verrat: Ben, nicht der Brecher Anna)');
    check(soundEv.includes('over') && !dbg().kk.on, 'Spielende: FurtSound.event(over), keine Kampf-Kamera');
    check(/Ende/.test(cs.c3.window.document.getElementById('ffPhase').textContent) && cs.c3.window.document.getElementById('ffEnd').classList.contains('show') && /Sieg/.test(cs.c3.window.document.getElementById('ffEndT').textContent), 'die echte Handy-Seite zeigt den Endbildschirm („🏆 Sieg für dein Haus!“)');
    check(p1.dom.window.document.getElementById('ffAgain').style.display === 'block' && p2.dom.window.document.getElementById('ffAgain').style.display !== 'block', 'nur das Host-Handy zeigt 🔁 Nochmal');
    p2.send({ t: 'ffAgain' }); await sleep(80);
    check(dbg().phase === 'end', 'ffAgain von einem Nicht-Host wird ignoriert');
    const sBefore = calls.setWorld;
    p6.send({ t: 'ffBuild', kind: 'huette', i: 1, j: 1, rot: 0 }); await sleep(30);
    check(calls.setWorld === sBefore, 'nach dem Ende werden Befehle ignoriert');

    // ---- host leaves on the end screen → the new host gets 🔁 ----
    for (const p of [p2, p3]) p.clear();
    bus.disconnect('c1'); await sleep(250);
    await until(() => p2.last('ffInfo') && p2.last('ffInfo').host === true, 2000, 'neuer Host');
    check(p2.last('ffInfo').host === true && p3.last('ffInfo').host === false, 'Host-Wechsel: nur der neue Host (Ben) bekommt ffInfo host:true');
    check(p2.last('ffPhase') && p2.last('ffPhase').phase === 'over' && p2.last('ffResult'), 'Host-Wechsel: der Endstand wird neu gesendet');
    await sleep(60);
    check(p2.dom.window.document.getElementById('ffAgain').style.display === 'block', 'neuer Host sieht 🔁 Nochmal');
    check(H()[0].humans.join() === String(p5.id) && H()[0].bot === null, 'Anna weg, Eva bleibt im Endbild als Mensch im Haus (kein Bot-Wechsel nach dem Ende)');

    // ---- rematch ----
    const seed0 = dbg().sim.seed, setWorld0 = calls.setWorld, snaps0 = calls.snaps, map0 = p3.all('ffMap').length;
    p2.dom.window.document.getElementById('ffAgain').click();
    await sleep(250);
    check(['intro', 'live'].includes(dbg().phase) && calls.setWorld === setWorld0 + 1 && dbg().sim.seed !== seed0 && dbg().sim.state.t < 20, 'Rematch: neue Partie, neue Welt-Seed, frische Sim, setWorld erneut');
    check(calls.made === 1 && !calls.dispose, 'dieselbe View für alle Partien (kein neuer WebGL-Kontext)');
    check(p3.all('ffMap').length === map0 + 1 && p3.last('ffPhase').phase === 'frieden', 'Rematch: neue ffMap und ffPhase frieden an alle');
    check(!cs.c3.window.document.getElementById('ffEnd').classList.contains('show'), 'Rematch: die Handys verlassen den Endbildschirm');
    check(H().map((h) => h.humans.length).join() === '2,1,1,1' && H()[0].humans.join() === [p2.id, p6.id].join(), 'Rematch: Sitze neu verteilt — Ben, Cleo, Dino, Eva reihum, Fiona teilt Haus I');
    check(H().reduce((a, h) => a + h.humans.length, 0) === 5 && H().every((h) => h.humans.length >= 1), 'Rematch: Ben, Cleo, Dino, Eva, Fiona auf allen vier Häusern');
    await until(() => dbg().phase === 'live', 6000, 'Rematch live');
    check(calls.snaps === snaps0 + 1, 'Rematch: ein snap-Frame für die neue Welt');
    check(reported.length === 1, 'reportWinners nicht doppelt');

    // ---- everybody leaves → lobby ----
    for (const l of ['c3', 'c4', 'c5', 'c6']) bus.disconnect(l);
    await sleep(120);
    check(w.eval('active') !== null, 'ein Mensch übrig → die Partie läuft weiter (ein Bot übernimmt)');
    check(dbg().houses.some((h) => h.bot) && dbg().houses.filter((h) => h.humans.length).length === 1, 'die verlassenen Häuser sind Bot-Häuser');
    bus.disconnect('c2'); await sleep(150);
    check(w.eval('active') === null, 'letzter Mensch weg → zurück in die Lobby');
    check(w.document.getElementById('c').style.display !== 'none' && ![...w.document.querySelectorAll('div')].some((d) => d.style.position === 'fixed' && d.style.width === '100vw' && d.style.display === 'block'), 'cv ist nach dem Spiel wieder sichtbar, der Wrapper weg');
    check(calls.setWorld >= 3 && calls.dispose === 0, 'die View wurde beim Verlassen geleert (setWorld(null)), nicht zerstört');
    check(glueErr.length === 0, 'der Glue hat in der ganzen Partie keinen Fehler geloggt (HUD, Spiegel, Ereignisse, Kampf-Kamera)' + (glueErr.length ? ': ' + glueErr[0].slice(0, 200) : ''));
  }

  // ============================================================ Scenario 2: bots, takeover and return, Auto quality, reconnect
  if (want(2)) {
    const bus = makeBusR();
    const screen = makeDom('screen.html', 'screen', bus, 'screen');
    const cs = {};
    for (const l of ['a', 'b', 'c']) { cs[l] = makeDom('controller.html', 'controller', bus, l); recordInbox(bus, l); }
    lightPhones(cs, ['a', 'b', 'c']);
    await sleep(150);
    const w = screen.window, calls = {};
    for (const l of Object.keys(cs)) bus.handlers[l].win = w;
    stubView(w, calls); fastClock(w);
    const glueErr = watchErrors(w), botCalls = spyBots(w);
    const reported = []; const origReport = w.reportWinners; w.reportWinners = (ids) => { reported.push(ids.slice()); origReport(ids); };
    const [pa, pb, pc] = ['a', 'b', 'c'].map((l) => phoneOf(bus, cs, l));
    join(pa, 'Anna'); join(pb, 'Ben'); await sleep(120);
    await launch(pa, w, { dauer: 6, burgen: 4, staerke: 'kriegsherr', burgfrieden: '60', quality: 'auto', aufloesung: 'normal' }, 21);
    const dbg = dbgOf(w), st = () => dbg().sim.state, colors = w.eval('players'), H = () => dbg().houses;
    check(H()[0].humans.join() === String(pa.id) && H()[1].humans.join() === String(pb.id) && H()[2].humans.length === 0 && H()[3].humans.length === 0, 'zwei Menschen auf vier Häusern: Haus III und IV bleiben übrig');
    check(H()[2].bot && H()[3].bot && H()[2].bot.name === '🤖 Graf Grimbart' && H()[3].bot.name === '🤖 Gräfin Gundula' && H()[0].bot === null, 'Bot-Häuser tragen Botnamen (Graf Grimbart, Gräfin Gundula)');
    check(Object.keys(dbg().bots).join() === '2,3' && botCalls.map((c) => c.lord).join() === '2,3' && botCalls.every((c) => c.opts.strength === 'kriegsherr' && typeof c.opts.seed === 'number'), 'FurtBots.create(sim, lord, { strength, seed }) pro Bot-Haus, Stärke aus der Einstellung (Kriegsherr)');
    check(dbg().sim.state.endsAt > 0 && dbg().sim.state.endsAt === 360, 'Dauer aus der Einstellung (6 Min) erreicht die Sim');
    const hn = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 360 - d); };
    const hueOf = (hex) => { const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 0.08) return -999; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
    check([2, 3].every((i) => H().slice(0, 2).every((h) => hn(hueOf(H()[i].color), hueOf(h.color)) >= 35)) && H()[2].color !== H()[3].color, 'Botfarben weichen im Farbton von den Menschenfarben ab (pickBotColors)');
    const info = pa.last('ffInfo');
    check(info.lords[2].bot === true && info.lords[2].name === '🤖 Graf Grimbart' && info.lords[0].bot === false, 'ffInfo.lords: bot:true und der Botname als Anzeigename');
    await until(() => dbg().phase === 'live', 6000, 'live');
    check(!dbg().autoDone && dbg().quality === 'high' && !calls.qualities.includes('low'), 'Auto schaltet beim Start der Partie nicht sofort um (frühestens nach 30 s Spielzeit, siehe Szenario 5)');
    await until(() => st().buildings.some((b) => b.lord === 2 && b.kind !== 'bergfried') && st().buildings.some((b) => b.lord === 3 && b.kind !== 'bergfried'), 8000, 'die Bots bauen');
    check(true, 'die Bots handeln vor jedem Sim-Schritt: beide bauen (' + st().buildings.filter((b) => b.lord >= 2 && b.kind !== 'bergfried').length + ' Gebäude)');
    check(Object.values(dbg().bots).every((b) => !b.stats || b.stats.errors === 0), 'die Bots melden keine Fehler');
    const sim = dbg().sim, realStep = sim.step; let order = [];
    const bot2 = dbg().bots[2], realBot = bot2.step;
    bot2.step = () => { order.push('bot'); return realBot(); };
    sim.step = function () { order.push('sim'); return realStep.call(sim); };
    await sleep(120);
    bot2.step = realBot; sim.step = realStep;
    check(order.length > 4 && order.every((x, i) => i === 0 || x !== order[i - 1] || x === 'sim') && order.indexOf('bot') < order.indexOf('sim') + 2, 'der Bot wird vor jedem Sim-Schritt gesteppt (Bot, Sim, Bot, Sim …)');
    // ---- takeover: Ben leaves, a bot runs his house ----
    const benId = pb.id, secret = 's' + benId;
    bus.disconnect('b'); await sleep(150);
    check(H()[1].humans.length === 0 && H()[1].bot && H()[1].bot.name === '🤖 Herzog Hagen' && dbg().bots[1] && botCalls.length === 3 && botCalls[2].lord === 1 && botCalls[2].opts.strength === 'kriegsherr', 'der letzte Mensch eines Hauses geht → ein Bot übernimmt (Herzog Hagen, gleiche Stärke)');
    check(dbg().heraldLog.some((x) => /Herzog Hagen übernimmt Haus Wolfsberg/.test(x)), 'Herold: „🤖 Herzog Hagen übernimmt Haus Wolfsberg“');
    check(pa.last('ffInfo').lords[1].bot === true && pa.last('ffInfo').lords[1].name === '🤖 Herzog Hagen', 'ffInfo wird an alle neu gesendet (Anna sieht den Bot)');
    check(w.eval('active') !== null && H()[1].color === calls.lords[1].color, 'die Partie läuft weiter, die Hausfarbe bleibt');

    // ---- the same device comes back (resume with its secret) ----
    cs.b2 = makeDom('controller.html', 'controller', bus, 'b2', { seedSession: { ac_resume: JSON.stringify({ id: benId, secret }) } }); recordInbox(bus, 'b2'); bus.handlers.b2.win = w; lightPhones(cs, ['x', 'b2']);
    await sleep(150);
    const pb2 = phoneOf(bus, cs, 'b2');
    check(pb2.id === benId, 'Testbus: das Gerät kommt mit derselben Geräte-ID zurück');
    join(pb2, 'Ben'); await until(() => pb2.last('ffMap'), 6000, 'Ben (zurück) bekommt den ganzen Stand');
    check(H()[1].humans.join() === String(benId) && H()[1].bot === null && !dbg().bots[1], 'dasselbe Gerät kehrt zurück: sein Haus gehört wieder ihm, der Bot tritt ab');
    check(pb2.last('ffInfo') && pb2.last('ffInfo').lord === 1 && pb2.last('ffMap') && pb2.last('ffYou') && pb2.last('ffBoard') && pb2.last('ffPhase'), 'der zurückgekehrte Spieler bekommt den vollständigen Stand');
    check(pa.last('ffInfo').lords[1].bot === false && /Ben/.test(pa.last('ffInfo').lords[1].name), 'ffInfo an alle: Haus II ist wieder menschlich');
    check(dbg().heraldLog.some((x) => /Ben übernimmt Haus Wolfsberg von 🤖 Herzog Hagen/.test(x)), 'Herold: „👤 Ben übernimmt Haus Wolfsberg von 🤖 Herzog Hagen“');

    // ---- a new device joins late: a bot-run house first ----
    join(pc, 'Cleo'); await until(() => pc.last('ffMap'), 6000, 'Cleo bekommt den ganzen Stand');
    check(H()[2].humans.join() === String(pc.id) && H()[2].bot === null && H()[3].bot, 'ein neuer Spieler bekommt zuerst ein Bot-Haus (Graf Grimbart tritt ab, Gundula bleibt)');
    check(Object.keys(dbg().bots).join() === '3' && pc.last('ffInfo').lord === 2 && pc.last('ffInfo').shared === false, 'der abgetretene Bot läuft nicht mehr, Cleo hat Haus III allein');

    // ---- reconnect without disconnect: shellSync → the whole state again ----
    pc.clear();
    pc.send({ t: 'shellSync' }); await until(() => pc.last('ffMap'), 6000, 'Neuverbindung: ganzer Stand');
    check(['ffInfo', 'ffMap', 'ffLevel', 'ffPhase', 'ffYou', 'ffBoard'].every((t) => pc.last(t)), 'Neuverbindung desselben Handys (shellSync): canResume/onReconnect schicken den ganzen Stand');
    check(w.eval('active.canResume(' + pc.id + ')') === true && w.eval('active.canResume(99)') === false, 'canResume nur für bekannte Geräte');

    // ---- an own banner reaches the host's end screen: rematch keeps the bots ----
    for (const l of ['a', 'b2', 'c']) bus.disconnect(l);
    await sleep(150);
    check(w.eval('active') === null, 'alle Menschen weg → Lobby');
    check(glueErr.length === 0, 'Bots, Übernahme, Rückkehr und Auto-Qualität ohne geloggten Fehler' + (glueErr.length ? ': ' + glueErr[0].slice(0, 200) : ''));
  }

  // ============================================================ Scenario 3: 9 phones → 8 seats + 1 spectator
  if (want(3)) {
    const bus = makeBusR();
    const screen = makeDom('screen.html', 'screen', bus, 'screen');
    const labels = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'], cs = {};
    for (const l of labels) { cs[l] = makeDom('controller.html', 'controller', bus, l); recordInbox(bus, l); }
    lightPhones(cs, labels);
    await sleep(200);
    const w = screen.window, calls = {};
    for (const l of labels) bus.handlers[l].win = w;
    stubView(w, calls); fastClock(w);
    const glueErr = watchErrors(w);
    const ps = labels.map((l) => phoneOf(bus, cs, l));
    ps.forEach((p, i) => join(p, 'P' + (i + 1)));
    await sleep(300);
    await launch(ps[0], w, { dauer: 6, burgen: 4, staerke: 'ritter', burgfrieden: '60', quality: 'high', aufloesung: 'normal' }, 31);
    const dbg = dbgOf(w), H = () => dbg().houses;
    check(H().length === 4 && H().every((h) => h.humans.length === 2 && h.bot === null) && dbg().spectators.length === 1, '9 Handys → 4 Häuser mit je 2 Menschen, 1 Zuschauer');
    check(H().map((h) => h.humans[0]).join() === [1, 2, 3, 4].map((k) => ps[k - 1].id).join() && H().map((h) => h.humans[1]).join() === [5, 6, 7, 8].map((k) => ps[k - 1].id).join(), 'Sitze: erst eine Person pro Haus, dann die zweite');
    const spec = ps.find((p) => dbg().spectators.includes(p.id));
    const sinfo = spec.last('ffInfo');
    check(sinfo && sinfo.lord === -1 && sinfo.lords.length === 4 && sinfo.shared === false && sinfo.color === '#c9a45a', 'Zuschauer bekommt ffInfo lord:-1');
    check(spec.last('ffMap') && spec.last('ffPhase') && spec.last('ffLevel'), 'Zuschauer bekommt die Karte, den Pegel und die Phase');
    await until(() => dbg().phase === 'live', 6000, 'live');
    await until(() => spec.last('ffBoard'), 3000, 'Zuschauer: ffBoard');
    check(spec.all('ffYou').length === 0 && spec.last('ffBoard'), 'Zuschauer bekommt ffBoard, aber kein ffYou');
    const sim = dbg().sim, spy = installSpy(sim), inj = injector(sim);
    spec.send({ t: 'ffBuild', kind: 'hof', i: 10, j: 10, rot: 0 }); spec.send({ t: 'ffHome' }); spec.send({ t: 'ffPact', to: 1, on: true }); spec.send({ t: 'ffAgain' }); await sleep(40);
    check(spy.rec.length === 0 && dbg().phase === 'live', 'Zuschauer-Befehle lösen nichts aus');
    inj.add({ t: 'crossingOpen', id: dbg().world.crossings[0].id }, { t: 'attack', lord: 0, x: 0, y: 0 }); await consumed(inj);
    check(spec.all('ffAlert').some((a) => a.kind === 'crossing') && !spec.all('ffAlert').some((a) => a.kind === 'attack'), 'Zuschauer bekommen nur die öffentlichen Meldungen (Furt frei), nie Alarme fremder Häuser');
    inj.restore(); spy.restore();
    const leaver = ps.find((p) => p !== ps[0] && p !== spec && H()[2].humans.includes(p.id)), leaverHouse = H().find((h) => h.humans.includes(leaver.id));
    bus.disconnect(leaver.l); await sleep(200);
    check(leaverHouse.humans.includes(spec.id) && dbg().spectators.length === 0 && leaverHouse.bot === null, 'ein Sitz wird frei → der wartende Zuschauer rückt nach, kein Bot');
    check(spec.last('ffInfo').lord === leaverHouse.i && spec.last('ffYou'), 'der Nachrücker bekommt ffInfo mit Haus und ffYou');
    for (const l of labels) bus.disconnect(l);
    await sleep(120);
    check(w.eval('active') === null, 'alle weg → Lobby');
    check(glueErr.length === 0, 'neun Handys ohne geloggten Fehler' + (glueErr.length ? ': ' + glueErr[0].slice(0, 200) : ''));
  }

  // ============================================================ Scenario 4: settings and the WebGL fallbacks
  if (want(4)) {
    const bus = makeBusR();
    const screen = makeDom('screen.html', 'screen', bus, 'screen');
    const ca = makeDom('controller.html', 'controller', bus, 'a'); const cs = { a: ca }; recordInbox(bus, 'a');
    await sleep(120);
    const w = screen.window; fastClock(w);
    const pa = phoneOf(bus, cs, 'a'); bus.handlers.a.win = w;
    join(pa, 'Eva'); await sleep(120);
    w.THREE = undefined;
    await launch(pa, w, { dauer: 6 }, 41);
    check(w.eval('active') === null, 'ohne WebGL (kein THREE) → das Spiel startet nicht, zurück in die Lobby');
    w.THREE = {}; w.FurtView = class { constructor() { throw new Error('kein WebGL'); } };
    await launch(pa, w, { dauer: 6 }, 41);
    check(w.eval('active') === null, 'View-Konstruktor wirft → Lobby');
    const calls = {}; stubView(w, calls); const glueErr = watchErrors(w), botCalls = spyBots(w);
    await launch(pa, w, { dauer: 8, burgen: 3, staerke: 'knappe', burgfrieden: '180', quality: 'low', aufloesung: 'nativ' }, 41);
    const dbg = dbgOf(w), st = () => dbg().sim.state;
    check(dbg() && dbg().houses.map((h) => h.site).join() === '0,1,3' && st().lords.map((l) => l.site).join() === '0,1,3', 'Burgen 3 → die Plätze 0, 1, 3 (Lord-Index = Position in dieser Liste)');
    check(dbg().houses[0].humans.length === 1 && dbg().houses[1].bot && dbg().houses[2].bot && Object.keys(dbg().bots).join() === '1,2' && botCalls.length === 2 && botCalls.every((c) => c.opts.strength === 'knappe'), 'ein Mensch + zwei Bots; Stärke Knappe');
    check(st().endsAt === 480 && pa.last('ffPhase').endsAt === 180, 'Dauer 8 Min = 480 s, Burgfrieden 3 Min → ffPhase.endsAt 180');
    check(calls.ctorQuality === 'low' && calls.qualities[0] === 'low' && calls.cap[0] >= 3840 && calls.cap[1] >= 2160, 'Grafik Sparsam → die View startet auf low; Auflösung Nativ → view.setCap hebt die Obergrenze (4K)');
    check(pa.last('ffInfo').lords.length === 3 && calls.lords.length === 3 && pa.last('ffMap').sites.length === 4, 'ffInfo und view.setWorld kennen nur die 3 Lords (ffMap alle 4 Plätze)');
    await until(() => dbg().phase === 'live', 6000, 'live');
    check(calls.size[0] === w.innerWidth && calls.size[1] === w.innerHeight, 'Anzeige: die interne Größe ist Fenstergröße × DPR (' + calls.size.join('×') + ')');
    w.innerWidth = 1280; w.innerHeight = 720; await sleep(150);
    check(calls.size[0] === 1280 && calls.size[1] === 720, 'Fenstergröße geändert → view.resize(1280, 720) ohne Neuaufbau');
    w.devicePixelRatio = 2; await sleep(150);
    check(calls.size[0] === 2560 && calls.size[1] === 1440, 'DPR 2 → view.resize(2560, 1440) (die View kappt pro Qualität, „nativ“ hebt die Kappe)');
    w.devicePixelRatio = 1;
    await sleep(1000);
    check(!calls.qualities.includes('high') && dbg().autoDone === false, 'Grafik Sparsam: keine Auto-Umschaltung');
    pa.send({ t: 'ffPact', to: 1, on: true }); await sleep(60);
    check(pa.all('ffToast').some((m) => /Angebot an Haus Wolfsberg|Angebot an 🤖/.test(m.text)) || pa.all('ffToast').some((m) => /Angebot an/.test(m.text)), 'mit 3 Häusern sind Pakte möglich: Angebot an ein Bot-Haus → Toast „🤝 Angebot an … gesendet“');
    pa.send({ t: 'shellAbort' }); await sleep(120);
    check(w.eval('active') === null && w.document.getElementById('c').style.display !== 'none', 'Host bricht ab → stop() räumt auf');
    await launch(pa, w, { dauer: 6, burgen: 2, staerke: 'ritter', burgfrieden: '60', quality: 'high', aufloesung: 'normal' }, 41);
    check(dbg().houses.map((h) => h.site).join() === '0,3' && dbg().houses[1].bot, 'Burgen 2 → die Plätze 0 und 3 (diagonal), ein Mensch + ein Bot');
    pa.clear(); pa.send({ t: 'ffPact', to: 1, on: true }); await sleep(60);
    check(pa.all('ffToast').some((m) => /Mit nur zwei Häusern gibt es keine Pakte/.test(m.text)), 'zwei Häuser: Pakt-Angebot → Toast „Mit nur zwei Häusern gibt es keine Pakte“');
    const d4 = dbg(); check(['sim', 'phase', 'view', 'seats', 'bots'].every((k) => k in d4) && d4.seats === d4.houses, '_debug() liefert { sim, phase, view, seats, bots }');
    pa.send({ t: 'shellAbort' }); await sleep(120);
    w.eval('delete gameCfg.furtfehde');            // the shell remembers what the host chose: forget it, so meta.js's own defaults decide
    await launch(pa, w, {}, 41);
    check(w.eval('active') && w.eval('active._debug().sim.state.endsAt') === 20 * 60 && w.eval('active._debug().sim.state.lords.length') === 4, 'ohne Einstellungen: Dauer 20 Min (= 1200 s), 4 Burgen — die Vorgaben aus meta.js');
    pa.send({ t: 'shellAbort' }); await sleep(120);
    await launch(pa, w, { dauer: 40 }, 41);
    check(w.eval('active._debug().sim.state.endsAt') === 40 * 60, 'Dauer 40 Min (das neue Maximum) erreicht die Sim ungekürzt');
    pa.send({ t: 'shellAbort' }); await sleep(100);
    bus.disconnect('a'); await sleep(60);
    check(glueErr.length === 0, 'Einstellungen und Rückfälle ohne geloggten Fehler' + (glueErr.length ? ': ' + glueErr[0].slice(0, 200) : ''));
  }

  // ============================================================ Scenario 5: Auto quality with a stub clock (T3), the sound hint (T6), sound.js in a sandbox (T2, T6)
  if (want(5)) {
    // ---- sound.js with a fake AudioContext: no sound for buildDone, the hammer at half volume once per 2 s overall, the unlock on the first gesture ----
    {
      const vm = require('vm'), fs = require('fs'), path = require('path'), src = fs.readFileSync(path.join(__dirname, 'public/games/furtfehde/sound.js'), 'utf8');
      const sandbox = (initial, opts) => {
        opts = opts || {};
        const log = { ctx: 0, osc: 0, resumes: 0, values: [] }, L = {}; let clock = 100000;
        const param = () => ({ set value(v) { log.values.push(v); }, get value() { return 0; }, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
        const base = () => ({ connect() { return this; }, disconnect() {}, start() {}, stop() {}, frequency: param(), Q: param(), gain: param(), detune: param(), pan: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
        class FakeAC {
          constructor() { if (opts.throws) throw new Error('no audio device'); this.state = initial; this.sampleRate = 8000; this.destination = base(); log.ctx++; }
          get currentTime() { return clock / 1000; }
          resume() { log.resumes++; if (opts.rejectFirst && log.resumes === 1) return Promise.reject(new Error('needs a click')); this.state = 'running'; return Promise.resolve(); }
          createGain() { return base(); } createOscillator() { log.osc++; return base(); } createBiquadFilter() { return base(); } createBufferSource() { return base(); }
          createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) }; } createDynamicsCompressor() { return base(); } createStereoPanner() { return base(); }
        }
        const win = { AudioContext: FakeAC }, box = { window: win, document: { addEventListener: (ev, fn) => { (L[ev] = L[ev] || []).push(fn); } }, setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout, Math, Float32Array, Promise, console,
          Date: { now: () => clock }, sfx: Object.assign(function () {}, { muted: false }) };
        win.window = win; vm.runInNewContext(src, box);
        return { S: win.FurtSound, log, L, tick: (ms) => { clock += ms; } };
      };
      const tickP = () => new Promise((r) => setImmediate(r));
      const a = sandbox('suspended');
      check(a.S.supported === true && a.S.failed === false && a.S.state() === 'none', 'sound.js: AudioContext da, noch kein Kontext vor der ersten Geste (state none)');
      a.S.event({ t: 'buildDone', id: 5 });
      check(a.S.stats.queued === 0 && a.log.osc === 0, 'sound.js: buildDone macht keinen Ton — nicht einmal vorgemerkt');
      a.S.event({ t: 'build', id: 5 });
      check(a.S.stats.queued === 1, 'sound.js: ein „build“ vor der Geste wird vorgemerkt (der Test sieht also Töne)');
      a.L.pointerdown[0](); await tickP(); await tickP();
      check(a.log.ctx === 1 && a.S.state() === 'running' && a.log.resumes === 1 && a.log.osc > 0 && a.log.values.includes(0.25), 'sound.js: die erste Geste (pointerdown) weckt den Kontext; der vorgemerkte Hammer läuft mit Lautstärke 0,25 (halb so laut)');
      a.L.click[0](); a.L.keydown[0](); await tickP();
      check(a.log.ctx === 1 && a.log.resumes === 1, 'sound.js: weitere Klicks und Tasten machen nichts mehr (kein zweiter Kontext, kein erneutes resume)');
      a.tick(100000); a.log.osc = 0; a.S.event({ t: 'build', id: 6 });
      const first = a.log.osc;
      a.tick(500); a.S.event({ t: 'build', id: 7 }); a.S.event({ t: 'rebuild', id: 8 });
      check(first > 0 && a.log.osc === first, 'sound.js: höchstens ein Hammer pro 2 s insgesamt (build und rebuild teilen sich die Pause)');
      a.tick(1700); a.S.event({ t: 'rebuild', id: 8 });
      check(a.log.osc > first, 'sound.js: nach 2 s darf der Hammer wieder (auch als rebuild)');
      const n2 = a.log.osc; a.tick(5000); a.S.event({ t: 'buildDone', id: 9 });
      check(a.log.osc === n2, 'sound.js: buildDone bleibt auch bei laufendem Ton stumm');
      a.S.event({ t: 'crossingOpen', id: 'westfurt' });
      check(a.log.osc > n2, 'sound.js: andere Ereignisse klingen weiter (die Furt-Glocke)');
      const b = sandbox('suspended', { rejectFirst: true });
      b.L.pointerdown[0](); await tickP(); await tickP();
      check(b.S.state() === 'suspended' && b.log.resumes === 1, 'sound.js: lässt der Browser den ersten Versuch nicht zu, bleibt der Kontext schlafend');
      b.L.click[0](); await tickP(); await tickP();
      check(b.S.state() === 'running' && b.log.resumes === 2, 'sound.js: der nächste Klick weckt ihn (click ist ebenfalls eine Geste)');
      const c = sandbox('running', { throws: true });
      c.L.pointerdown[0]();
      check(c.S.failed === true && c.S.state() === 'none', 'sound.js: ohne Audiogerät steht failed = true (der Hinweis „Klick für Ton“ bleibt dann weg)');
    }

    // ---- fx.js (T1): a 💤 sign over every resting workplace — its quads are built on the CPU, so a THREE that accepts everything is enough (no WebGL) ----
    {
      const vm = require('vm'), fs = require('fs'), path = require('path');
      const deep = () => new Proxy(function () {}, { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' || k === 'then' ? undefined : deep()), set: (t, k, v) => { try { t[k] = v; } catch (e) { /* a function's own name */ } return true; }, apply: () => deep(), construct: () => deep() });
      const THREE = new Proxy({ DynamicDrawUsage: 1, AdditiveBlending: 2, NormalBlending: 1, DoubleSide: 2 }, { get: (t, k) => (k in t ? t[k] : deep()) });
      const win = { FurtWorld: FW, THREE }, box = { window: win, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, console };
      win.window = win; vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'public/games/furtfehde/fx.js'), 'utf8'), box);
      const world = FW.make(11), cam = { position: { x: 0, y: 140, z: 90 }, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, updateMatrixWorld() {}, projectionMatrix: { elements: new Array(16).fill(1) } };
      const objs = new Map(), view = { renderer: { getContext() { throw new Error('no GL here'); } }, world, W: 960, H: 600, cur: { night: 0 }, sunDir: {}, lordBy: new Map(), colorOf: () => '#e0453a',
        land: { standY: () => 0, surf: 0, level: 0, heightAt: () => 0, waterDepth: () => 0 }, keepObj: () => null, buildingObj: (id) => objs.get(id) || null };
      const mk = (id, kind, x, z, extra) => { objs.set(id, { group: { position: { x, y: 0, z }, rotation: { y: 0 } }, mesh: null, anchors: {} }); return Object.assign({ id, lord: 0, kind, i: 0, j: 0, rot: 0, build: 1, hp: 1, fire: 0, burnt: 0, ruined: false, growth: 1, workers: 1, paused: false }, extra); };
      const fx = new win.FurtFx(THREE, { scene: new THREE.Scene(), camera: cam, quality: 'high', view });
      const blds = [mk(1, 'steinbruch', -40, -20, { paused: true }), mk(2, 'hof', -30, -10, { paused: true }), mk(3, 'holzfaeller', -20, 0), mk(4, 'steinbruch', -10, 10, { paused: true, ruined: true }), mk(5, 'hof', 0, 20, { paused: true, build: 0.4 })];
      const state = { buildings: blds, units: [], banners: [], lords: [], dayT: 0.45, level: 0, t: 1 };
      const signs = () => { const out = []; for (let n = 0; n < fx.Q.nq; n++) if (fx.Q.kk[n * 8] === 6) out.push(n); return out; };
      fx.update(state, 1, { now: 1000, dt: 0.016 });
      check(signs().length === 2, 'fx: ein 💤-Schild pro ruhendem, fertigem Betrieb (Steinbruch und Hof ja; arbeitender Holzfäller, Ruine und Baustelle nein): ' + signs().length);
      { const n = signs()[0], P = fx.Q.pos, cx = [0, 1, 2].map((a) => (P[n * 12 + a] + P[n * 12 + 3 + a] + P[n * 12 + 6 + a] + P[n * 12 + 9 + a]) / 4), width = P[n * 12 + 3] - P[n * 12];
        check(Math.abs(cx[0] + 40) < 0.01 && Math.abs(cx[2] + 20) < 0.5 && cx[1] > 3.5 && width > 3.5 && width < 6 && fx.Q.kk[n * 8 + 1] >= 0 && fx.Q.kk[n * 8 + 1] < 1, 'fx: das Schild schwebt über dem Dach (y ' + cx[1].toFixed(1) + '), ist ' + width.toFixed(1) + ' Einheiten breit und steht zur Kamera'); }
      blds[1].paused = false; blds[2].paused = true; fx.update(state, 1, { now: 1016, dt: 0.016 });
      check(signs().length === 2, 'fx: das Schild folgt dem Zustand (Hof arbeitet wieder: weg; Holzfäller ruht: da)');
      blds.forEach((b) => { b.paused = false; }); fx.update(state, 1, { now: 1032, dt: 0.016 });
      check(signs().length === 0, 'fx: ohne ruhende Betriebe gibt es kein Schild (es ist ein Viereck im vorhandenen Quad-Mesh: kein zusätzlicher Draw-Call)');
      // round 2: a workplace that rests because its store is full (buildings[].full) gets the sign, too; a ruin or a site still gets none; one that does both gets a single sign
      blds[2].full = true; blds[3].full = true; blds[4].full = true; fx.update(state, 1, { now: 1048, dt: 0.016 });
      check(signs().length === 1, 'fx: ein Betrieb mit vollem Lager (full) bekommt das 💤-Schild (Holzfäller ja; Ruine und Baustelle nein): ' + signs().length);
      blds[1].paused = true; blds[2].paused = true; fx.update(state, 1, { now: 1064, dt: 0.016 });
      check(signs().length === 2, 'fx: wer auf Befehl ruht und voll ist, bekommt nur ein Schild (Hof ruht, Holzfäller ruht und ist voll → 2 Schilder): ' + signs().length);
      blds.forEach((b) => { b.paused = false; b.full = false; }); fx.update(state, 1, { now: 1080, dt: 0.016 });
      check(signs().length === 0, 'fx: wieder Platz im Lager → keine Schilder');
      // round 2: a badly damaged keep crumbles in grey (dust, smoke, stone chips that fall) and never throws orange embers; a real fire still does
      view.keepObj = () => ({ group: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 } }, mesh: null, anchors: { top: { position: { x: 0, y: 9, z: 0 } } } });
      fx.v1 = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };   // (the proxy THREE makes a vector that holds no coordinates)
      const keepB = { id: 90, lord: 0, kind: 'bergfried', i: 0, j: 0, rot: 0, build: 1, hp: 0.2, fire: 0, burnt: 0, ruined: false, growth: 1, workers: 0, paused: false, full: false };
      const kstate = { buildings: [keepB], units: [], banners: [], lords: [], dayT: 0.45, level: 0, t: 1 };
      const grey = (P) => { let bad = 0, n = 0, chips = 0; for (let k = 0; k < P.hw; k++) { if (P.life[k] <= 0) continue; n++; if (P.grav[k] === 11) chips++; if (Math.max(P.c0[k * 4], P.c0[k * 4 + 1], P.c0[k * 4 + 2]) - Math.min(P.c0[k * 4], P.c0[k * 4 + 1], P.c0[k * 4 + 2]) > 0.08) bad++; } return { bad, n, chips }; };
      fx.S.clear(); fx.A.clear(); const gs = { bad: 0, n: 0, chips: 0 };   // (the emitters are random: add up what is alive after each of 150 frames)
      for (let f = 0; f < 150; f++) { fx.update(kstate, 1, { now: 2000 + f * 100, dt: 0.1 }); const g = grey(fx.S); gs.bad += g.bad; gs.n += g.n; gs.chips += g.chips; }
      check(fx.A.hw === 0, 'fx: ein schwer beschädigter Bergfried (HP 20 %) wirft keine leuchtenden Funken mehr (additive Teilchen: ' + fx.A.hw + ')');
      check(gs.n > 800 && gs.bad === 0, 'fx: …sondern nur graue Teilchen: Rauch, Staub und Steinsplitter (' + gs.n + ' Teilchen-Bilder, davon ' + gs.bad + ' nicht grau)');
      check(gs.chips > 100, 'fx: Steinsplitter fallen von der Brüstung (' + gs.chips + ' Teilchen-Bilder mit Schwerkraft)');
      const hutB = mk(7, 'huette', 20, 20, { fire: 0.8, hp: 0.8 }), fstate = { buildings: [hutB], units: [], banners: [], lords: [], dayT: 0.45, level: 0, t: 1 };
      fx.S.clear(); fx.A.clear(); for (let f = 0; f < 30; f++) fx.update(fstate, 1, { now: 4000 + f * 100, dt: 0.1 });
      check(fx.A.hw > 0, 'fx: ein echtes Feuer (Holzhütte brennt) wirft weiter leuchtende Funken – Orange bleibt dem Feuer vorbehalten (' + fx.A.hw + ' additive Teilchen)');
    }

    const bus = makeBusR();
    const screen = makeDom('screen.html', 'screen', bus, 'screen');
    const ca = makeDom('controller.html', 'controller', bus, 'a'); const cs = { a: ca }; recordInbox(bus, 'a');
    await sleep(120);
    const w = screen.window, pa = phoneOf(bus, cs, 'a'); bus.handlers.a.win = w;
    join(pa, 'Eva'); await sleep(120);
    const calls = {}; stubView(w, calls); const glueErr = watchErrors(w);
    // the HUD canvas records its text (JSDOM has no canvas), so the sound hint can be seen
    const texts = [], sub = new Proxy({}, { get: () => function () {}, set: () => true });
    const rec = new Proxy({}, { get: (t, k) => k === 'measureText' ? () => ({ width: 10 }) : (k === 'fillText' || k === 'strokeText') ? (tx) => { texts.push(String(tx)); } : typeof k === 'string' ? function () { return sub; } : undefined, set: () => true });
    w.HTMLCanvasElement.prototype.getContext = function () { return rec; };
    w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };   // the shell's own key handler starts a keep-awake video
    // the stub clock: only the test moves it, frame by frame (the shell's own rAF calls see no time pass: interval 0, ignored)
    let fake = w.performance.now(); w.performance.now = () => fake;
    const dbg = dbgOf(w), adv = (ms, step) => { for (let t = 0; t < ms; t += step) { fake += step; w.eval('active.render()'); } };
    const until2 = (cond, step, maxMs) => { const t0 = fake; while (!cond() && fake - t0 < maxMs) adv(step, step); return (fake - t0) / 1000; };
    const hasBanner = (re) => dbg().banners.some((b) => re.test(b.lines.join(' ')));

    // ---- Auto with `aufloesung: nativ`: two steps, announced ----
    await launch(pa, w, { dauer: 20, burgen: 3, staerke: 'knappe', burgfrieden: '60', quality: 'auto', aufloesung: 'nativ' }, 51);
    check(calls.made === 1 && calls.cap && calls.cap[0] >= 3840 && calls.qualities[0] === 'high', 'Auto + Nativ: die View startet auf Voll mit angehobener Obergrenze (4K)');
    adv(4300, 33);
    check(dbg().phase === 'live', 'mit der Stub-Uhr geht es durch das Intro in die Partie');
    adv(40000, 33);
    check(!dbg().autoDone && !dbg().capDropped && calls.qualities.join() === 'high' && calls.cap[0] >= 3840, 'Auto: 40 s bei 30 Bildern/s (33 ms) → nichts passiert');
    fake += 1000; w.eval('active.render()');               // a 1-second hitch (a tab switch, a GC pause)
    adv(14000, 33);
    check(!dbg().autoDone && !dbg().capDropped && calls.qualities.join() === 'high' && calls.cap[0] >= 3840, 'Auto: ein einzelner 1-s-Ruckler löst nichts aus (Zwischenräume über 250 ms und die 5 s danach zählen nicht)');
    adv(2000, 45);
    check(!dbg().capDropped && !dbg().autoDone, 'Auto: nach 2 s bei 45 ms noch keine Entscheidung (der Median über 10 s entscheidet)');
    const d1 = until2(() => dbg().capDropped, 45, 20000);
    check(dbg().capDropped && d1 <= 12 && calls.cap[0] === 0 && calls.cap[1] === 0 && !dbg().autoDone && calls.qualities.join() === 'high', 'Auto: bei anhaltenden 45 ms fällt zuerst die Auflösung auf Normal (setCap(0, 0), nach ' + (d1 + 2).toFixed(1) + ' s), die Grafik bleibt Voll');
    check(hasBanner(/Auflösung auf Normal gestellt/), 'der Fernseher sagt den ersten Schritt an: „🔍 Auflösung auf Normal gestellt“');
    const d2 = until2(() => dbg().autoDone, 45, 30000);
    check(dbg().autoDone && dbg().quality === 'low' && calls.qualities.join() === 'high,low' && d2 >= 9.5 && d2 <= 18, 'Auto: erst die nächste anhaltende Langsamkeit schaltet auf Sparsam (frühestens nach einem neuen 10-s-Fenster: ' + d2.toFixed(1) + ' s)');
    check(hasBanner(/Grafik auf Sparsam gestellt/) && !dbg().kk.on, 'der Fernseher sagt auch den zweiten Schritt an: „🔋 Grafik auf Sparsam gestellt“; keine Kampf-Kamera auf low');
    adv(25000, 45);
    check(calls.qualities.join() === 'high,low' && dbg().autoDone, 'Auto schaltet danach nicht noch einmal (und nicht zurück)');

    // ---- Auto with the normal resolution: the first sustained slowness goes straight to Sparsam ----
    pa.send({ t: 'shellAbort' }); await sleep(120);
    const q0 = calls.qualities.length;
    await launch(pa, w, { dauer: 20, burgen: 3, staerke: 'knappe', burgfrieden: '60', quality: 'auto', aufloesung: 'normal' }, 52);
    adv(4300, 33); adv(35000, 33);
    check(dbg().phase === 'live' && !dbg().autoDone && calls.qualities.slice(q0).join() === 'high', 'Auto + Normal: Voll, solange es flüssig läuft');
    const d3 = until2(() => dbg().autoDone, 45, 25000);
    check(dbg().autoDone && !dbg().capDropped && calls.qualities.slice(q0).join() === 'high,low' && d3 <= 12, 'Auto + Normal: ohne angehobene Obergrenze gibt es nur einen Schritt — direkt auf Sparsam (nach ' + (d3).toFixed(1) + ' s)');

    // ---- a picture so slow that EVERY frame is over 250 ms is no „hitch“ any more (ours): ten long frames within 20 s are judged as sustained slowness ----
    pa.send({ t: 'shellAbort' }); await sleep(120);
    {
      const q1 = calls.qualities.length;
      await launch(pa, w, { dauer: 20, burgen: 3, staerke: 'knappe', burgfrieden: '60', quality: 'auto', aufloesung: 'normal' }, 54);
      adv(4300, 33); adv(33000, 33);
      check(dbg().phase === 'live' && !dbg().autoDone, 'Auto (Dauerruckeln): bei 30 Bildern/s nach 30 s noch auf Voll');
      const d4 = until2(() => dbg().autoDone, 300, 40000);
      check(dbg().autoDone && calls.qualities.slice(q1).join() === 'high,low' && d4 <= 8, 'Auto: bei 3 Bildern/s (jedes Bild über 250 ms, zehn in 20 s) wird nicht „ignoriert“, sondern Sparsam gewählt (nach ' + d4.toFixed(1) + ' s)');
    }

    // ---- the sound hint (T6): „🔇 Klick oder Taste für Ton“ while the context is not running, until the next click or key ----
    {
      const S = w.FurtSound, keep = { supported: S.supported, state: S.state, failed: S.failed };
      pa.send({ t: 'shellAbort' }); await sleep(120);
      await launch(pa, w, { dauer: 20, burgen: 3, staerke: 'knappe', burgfrieden: '60', quality: 'high', aufloesung: 'normal' }, 53);
      adv(4300, 33); adv(500, 33);
      const hint = () => texts.some((tx) => /Klick oder Taste für Ton/.test(tx));
      texts.length = 0; adv(200, 33);
      check(!dbg().soundHint && !hint(), 'ohne AudioContext (JSDOM, alte Browser) kein Ton-Hinweis');
      S.supported = true; S.state = () => 'suspended'; S.failed = false;
      texts.length = 0; adv(200, 33);
      check(dbg().soundHint && hint(), 'Ton wird unterstützt, der Kontext schläft → das HUD zeigt „🔇 Klick oder Taste für Ton“');
      w.document.dispatchEvent(new w.Event('click')); texts.length = 0; adv(300, 33);
      check(!dbg().soundHint && !hint(), 'ein Klick blendet den Hinweis aus');
      adv(3000, 33); texts.length = 0; adv(100, 33);
      check(dbg().soundHint && hint(), 'schläft der Kontext trotzdem weiter, kommt der Hinweis nach 2,5 s zurück');
      w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'a' })); S.state = () => 'running'; adv(3000, 33); texts.length = 0; adv(100, 33);
      check(!dbg().soundHint && !hint(), 'läuft der Kontext, ist der Hinweis dauerhaft weg');
      S.state = () => 'suspended'; w.eval('sfx.muted = true'); texts.length = 0; adv(100, 33);
      check(!dbg().soundHint && !hint(), 'stumm geschaltet (🔇 der Shell) → kein Hinweis');
      w.eval('sfx.muted = false'); S.failed = true; texts.length = 0; adv(100, 33);
      check(!dbg().soundHint && !hint(), 'kein Audiogerät (failed) → kein Hinweis');
      Object.assign(S, keep);
    }
    pa.send({ t: 'shellAbort' }); await sleep(100);
    bus.disconnect('a'); await sleep(60);
    check(glueErr.length === 0, 'Auto-Qualität, Ton-Hinweis und Stub-Uhr ohne geloggten Fehler' + (glueErr.length ? ': ' + glueErr[0].slice(0, 200) : ''));
  }

  console.log(process.exitCode ? '\n❌ Furt-&-Fehde-Flow fehlgeschlagen' : '\n✅ Alle ' + checks + ' Furt-&-Fehde-Flow-Checks bestanden');
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
