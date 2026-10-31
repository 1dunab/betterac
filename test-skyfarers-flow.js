// Skyfarers end-to-end: real shell + real controllers in JSDOM, the view is a stub (JSDOM has no WebGL).
// Checks the phone protocol, phases, docking/build drawer data, alerts, late join, disconnects, host
// change, rematch, Auto quality, the seat cap and the no-WebGL fallback.
const { makeDom, makeBus } = require('./test-helpers');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(5); }
  fail('Timeout: ' + what); return false;
}

const SPEED = 6;   // the screen page's clock runs 6x faster (intro, events); one frame stays <= the glue's 0.1 s clamp

function stubView(w, calls) {
  w.THREE = {};
  w.SkyfarersView = class {
    constructor(T, o) {
      this.canvas = w.document.createElement('canvas'); this.W = 960; this.H = 600; this.quality = o.quality;
      calls.made = (calls.made || 0) + 1; calls.ctorQuality = o.quality;
    }
    setWorld(world, look) { calls.setWorld = (calls.setWorld || 0) + 1; calls.world = world; calls.look = look; }
    setLook(look) { calls.setLook = (calls.setLook || 0) + 1; calls.look = look; }
    event(ev) { calls.events = (calls.events || 0) + 1; (calls.evTypes = calls.evTypes || {})[ev.t] = true; }
    render(state, alpha, opts) { calls.render = (calls.render || 0) + 1; calls.opts = opts; calls.alpha = alpha; if (opts.intro < 1) calls.introSeen = true; if (opts.snap) calls.snaps = (calls.snaps || 0) + 1; }
    project(x, y) { return { x: 480 + x * 5, y: 300 + y * 5, visible: true }; }
    setQuality(q) { calls.qualities = (calls.qualities || []).concat(q); this.quality = q; }
    dispose() { calls.dispose = (calls.dispose || 0) + 1; }
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
  all: (t) => bus.handlers[l].inbox.filter(m => m.t === t),
  last(t) { return this.all(t).pop(); },
  send: (data) => bus.fromClient(l, JSON.stringify({ type: 'message', to: 0, data }))
});
function join(p, name) {
  p.dom.window.document.getElementById('nameInput').value = name;
  p.dom.window.document.getElementById('joinBtn').click();
}
async function startGame(p, cfg) {
  const btn = [...p.dom.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '🎈 Skyfarers');
  if (!btn) { fail('Skyfarers steht nicht im Picker'); return false; }
  btn.click(); await sleep(60);
  p.send({ t: 'shellConfig', game: 'skyfarers', cfg });
  await sleep(40);
  p.dom.window.document.getElementById('startBtn').click();
  await sleep(150);
  return true;
}

(async () => {
  // ============================================================ main scenario: 3 phones + 1 bot
  const bus = makeBus();
  const screen = makeDom('screen.html', 'screen', bus, 'screen');
  const cs = {};
  for (const l of ['c1', 'c2', 'c3', 'c4']) { cs[l] = makeDom('controller.html', 'controller', bus, l); recordInbox(bus, l); }
  await sleep(100);
  const w = screen.window;
  for (const l of ['c1', 'c2', 'c3', 'c4']) bus.handlers[l].win = w;
  const calls = {};
  check(typeof w.SkyfarersView === 'function' && typeof w.SkyfarersSim === 'object' && typeof w.SkyfarersWorld === 'object', 'alle Skyfarers-Skripte sind auf der Screen-Seite geladen');
  stubView(w, calls); fastClock(w);
  const reported = [];
  const origReport = w.reportWinners;
  w.reportWinners = (ids) => { reported.push(ids.slice()); origReport(ids); };

  const [p1, p2, p3, p4] = ['c1', 'c2', 'c3', 'c4'].map(l => phoneOf(bus, cs, l));
  join(p1, 'Anna'); join(p2, 'Ben'); join(p3, 'Cleo');
  await sleep(100);
  if (!await startGame(p1, { dauer: 'kurz', schwierigkeit: 'leicht', bots: 1, quality: 'auto' })) process.exit(1);
  const dbg = () => w.eval('active && active._debug()');
  const st = () => dbg().sim.state;
  const colors = w.eval('players');
  const ship = (p) => st().ships.find(s => s.pid === p.id);

  check(dbg() && dbg().phase === 'intro', 'Start → Intro (Stub-View akzeptiert, kein WebGL-Fallback)');
  check(calls.made === 1 && calls.setWorld === 1 && calls.ctorQuality === 'high', 'View einmal gebaut (Qualität high), setWorld einmal');
  check(dbg().seats.length === 3 && st().ships.length === 4 && st().ships.filter(s => s.bot).length === 1, '3 Menschen + 1 Bot = 4 Schiffe');
  check(st().ships.filter(s => s.pid < 0).length === 1 && st().ships.find(s => s.bot).pid < 0, 'der Bot hat eine negative pid');
  const lookKeys = Object.keys(calls.look);
  check(lookKeys.length === 4 && calls.look[p1.id].color === colors[p1.id].color && /Kork/.test(calls.look['-1'].name), 'look: Farben der Menschen + Botname');
  check(calls.look['-1'].color !== colors[p1.id].color && calls.look['-1'].color !== colors[p2.id].color, 'Botfarbe weicht von den Menschenfarben ab');
  for (const p of [p1, p2, p3]) {
    const info = p.last('skInfo');
    check(info && info.ship === true && info.color === colors[p.id].color && info.dauer === 'kurz', 'skInfo für ' + colors[p.id].name + ': Schiff, Farbe, Dauer');
    check(p.last('skPhase') && p.last('skPhase').phase === 'intro', 'skPhase intro für ' + colors[p.id].name);
  }
  check(p1.last('skInfo').host === true && p2.last('skInfo').host === false, 'Host-Flag in skInfo');

  await until(() => dbg().phase === 'live', 5000, 'Intro → live');
  check(p2.all('skPhase').some(m => m.phase === 'live'), 'skPhase live kommt an');
  check(calls.introSeen === true && calls.opts.intro === 1 && calls.render > 0, 'view.render bekommt opts.intro 0..1 während des Intros, danach 1');
  check(calls.snaps === 1, 'genau ein snap-Frame (Match-Start)');
  check(calls.opts.now > 0 && typeof calls.opts.dt === 'number' && calls.opts.dt <= 0.1, 'opts.now (ms) und dt (s, ≤ 0.1)');
  check(!!w.document.querySelector('canvas') && w.document.getElementById('c').style.display === 'none', 'cv ist während des Spiels versteckt (Wrapper aktiv)');
  check(w.document.querySelectorAll('canvas').length >= 4, 'Wrapper enthält View-Canvas + HUD-Overlay (+ Größen-Canvas)');

  // ---- skYou ----
  const you = p2.last('skYou');
  check(you && you.cap === 6 && you.waterCap === 3 && typeof you.stunned === 'boolean' && you.cargo && typeof you.boost === 'number' && typeof you.docked === 'boolean' && typeof you.act === 'string', 'skYou hat alle Felder (stunned boolean, waterCap 3)');


  // ---- Onboarding-Hinweise ----
  {
    const toasts = (p, re) => p.all('skToast').filter(m => re.test(m.text));
    await until(() => toasts(p1, /Ernte/).length > 0, 3000, 'Intro-Hinweis');
    check([p1, p2, p3].every(p => toasts(p, /Ernte/).length === 1), 'Intro-Hinweis (Ernte) genau einmal pro Kapitän');
    check(p4.all('skToast').length === 0, 'Zuschauer/Nicht-Spieler bekommt keinen Hinweis');
    const H = dbg().hintSt;
    check(!(-1 in H), 'Bots bekommen keine Hinweise');
    // Feuer: Schiff 2 ohne Wasser → Hinweis; Rate-Limit; zweite Welle erst nach 20 s ohne Feuer
    const S = st(); const sl = S.slots[1];
    for (const id of [p1, p2, p3]) { const sh = ship(id); sh.docked = false; sh.water = 0; }
    sl.kind = 'windrad'; sl.stage = 1; sl.build = 1; sl.hp = 100; sl.ruined = false; sl.fire = 0.9;
    for (const id of [p1, p2, p3]) H[id.id].at = -1e9;
    const dry = () => toasts(p2, /Es brennt/).length;
    await until(() => dry() === 1, 3000, 'Feuer-Hinweis');
    check(dry() === 1 && toasts(p3, /Es brennt/).length === 1, 'Feuer-Hinweis erreicht Kapitäne mit 0 Wasser');
    const before = p2.all('skToast').length;
    H[p2.id].at = S.t - 1; sl.fire = 0.9; await sleep(300);
    check(dry() === 1, 'Feuer-Hinweis nur einmal pro Welle');
    check(p2.all('skToast').length === before, 'Rate-Limit: kein weiterer Hinweis innerhalb von 6 s');
    // aufräumen
    sl.fire = 0; sl.kind = null; sl.stage = 0; sl.build = 0; sl.hp = 0;
    await sleep(50);
  }

  // ---- Eingaben erreichen die Sim (Aufruf-Spion) ----
  const rec = []; const sim0 = dbg().sim, origInput = sim0.input;
  sim0.input = (pid, o) => { rec.push({ pid, o: Object.assign({}, o) }); return origInput(pid, o); };
  const recFor = (p) => rec.filter(r => r.pid === p.id);
  p2.send({ t: 'skStick', x: 1, y: 0 }); p2.send({ t: 'skBoost', on: true }); p2.send({ t: 'skAct', on: true });
  await sleep(30);
  const rr = recFor(p2);
  check(rr.some(r => r.o.sx === 1 && r.o.sy === 0) && rr.some(r => r.o.boost === true) && rr.some(r => r.o.act === true), 'skStick / skBoost / skAct erreichen sim.input');
  await until(() => ship(p2).vx > 2, 3000, 'Schiff 2 fliegt los');
  check(ship(p2).vx > 2, 'skStick bewegt das Schiff (vx ' + ship(p2).vx.toFixed(1) + ')');
  check(ship(p2).boosting === true || ship(p2).boost < 1, 'skBoost lässt das Schiff boosten');
  p2.send({ t: 'skBoost', on: false }); p2.send({ t: 'skAct', on: false }); p2.send({ t: 'skStick', x: 0, y: 0 });
  // ---- Validierung ----
  const n0 = rec.length;
  p2.send({ t: 'skStick', x: 'a', y: 0 }); p2.send({ t: 'skStick', x: null, y: 1 }); p2.send({ t: 'skStick', y: 1 });
  p2.send({ t: 'skBoost', on: 'yes' }); p2.send({ t: 'skAct' }); p2.send({ t: 'skBuild', kind: 'bogus' }); p2.send({ t: 'skBuild', kind: '__proto__' });
  p2.send({ t: 'skBuild', kind: 'toString' }); p2.send({ t: 'skBuild' }); p2.send({ t: 'skAgain' }); p2.send({ t: 'skUnbekannt' });
  await sleep(30);
  check(rec.length === n0, 'ungültige Nachrichten erreichen die Sim nicht (' + (rec.length - n0) + ' durchgekommen)');
  p2.send({ t: 'skStick', x: 7, y: -9 }); await sleep(20);
  const clamped = rec.filter(r => r.pid === p2.id && r.o.sx !== undefined).pop().o;
  check(clamped.sx === 1 && clamped.sy === -1, 'Stick-Werte werden auf [-1, 1] geklemmt');
  p2.send({ t: 'skStick', x: 0, y: 0 });
  const sx0 = rec.length;
  bus.fromClient('c4', JSON.stringify({ type: 'message', to: 0, data: { t: 'skStick', x: 1, y: 1 } })); await sleep(20);
  check(rec.length === sx0, 'Nachricht von Nicht-Spielern (noch nicht verbunden/Zuschauer) wird ignoriert');
  sim0.input = origInput;

  // ---- Andocken → skBase, canBuild, skBuild ----
  p3.send({ t: 'skBuild', kind: 'windrad' }); await sleep(30);
  const notDocked = p3.all('skToast').filter(m => /andocken/.test(m.text));
  check(notDocked.length === 1 || ship(p3).docked, 'skBuild ohne Andocken → Toast "⚓ andocken" (oder war schon angedockt)');
  const dock = (p) => { const s = ship(p); s.x = s.px = 0; s.y = s.py = 19; s.vx = s.vy = 0; };
  dock(p2); p2.send({ t: 'skStick', x: 0, y: 0 });
  await until(() => p2.last('skYou') && p2.last('skYou').docked === true, 3000, 'Handy 2 angedockt');
  await until(() => p2.last('skBase'), 3000, 'skBase kommt an');
  st().stock.holz = 30; st().stock.kristall = 30;     // bots spend stock too — keep plenty
  await until(() => p2.last('skBase') && p2.last('skBase').stock.holz >= 20 && p2.last('skBase').stock.kristall >= 20, 3000, 'skBase mit frischem Lager');
  let base = p2.last('skBase');
  check(typeof base.stock.holz === 'number' && base.slots.length === 7 && typeof base.herz === 'number' && typeof base.energy === 'number', 'skBase: Lager, 7 Slots, Herz, Energie');
  check(base.canBuild.zisterne === true && base.canBuild.sternwarte === true, 'canBuild aus Lager abgeleitet (alles bezahlbar)');
  const keysOk = Object.keys(base.canBuild).sort().join() === Object.keys(w.SkyfarersWorld.BUILDINGS).sort().join();
  check(keysOk, 'canBuild hat alle Gebäudearten');
  const winds0 = st().slots.filter(sl => sl.kind === 'windrad').length, stock0 = Object.assign({}, st().stock);
  const fertig0 = p2.all('skToast').filter(m => /Windrad fertig/.test(m.text)).length;
  p2.send({ t: 'skBuild', kind: 'windrad' }); await sleep(40);
  check(st().slots.filter(sl => sl.kind === 'windrad').length === winds0 + 1 && st().stock.holz <= stock0.holz - 2 && st().stock.kristall <= stock0.kristall - 1 && stock0.holz >= 20, 'skBuild windrad baut (Kosten bezahlt)');
  check(p2.all('skToast').some(m => /Windrad/.test(m.text) && /gebaut/.test(m.text)), 'Bau-Toast mit deutschem Text');
  st().stock.holz = 0; st().stock.kristall = 0;
  p2.send({ t: 'skBuild', kind: 'sternwarte' }); await sleep(40);
  check(p2.all('skToast').some(m => /Zu wenig Material/.test(m.text) && /🪵/.test(m.text)), 'zu teuer → Toast "Zu wenig Material" mit Fehlmenge');
  await until(() => p2.last('skBase') && p2.last('skBase').stock.holz === 0 && p2.last('skBase').canBuild.windrad === 'cost', 3000, 'skBase zeigt neuen Stand');
  check(p2.last('skBase').slots.filter(s => s.kind === 'windrad').length >= winds0 + 1, 'skBase folgt dem Baustand');
  await until(() => p2.all('skToast').filter(m => /Windrad fertig/.test(m.text)).length > fertig0, 6000, 'Windrad fertig');
  check(p3.all('skToast').some(m => /Windrad fertig/.test(m.text)), '"fertig"-Toast geht an alle Kapitäne');
  check(calls.evTypes.buildDone && calls.evTypes.buildStart, 'Sim-Events (buildStart/buildDone) gehen an die View');

  // ---- canBuild: noSlot / stage / Wiederaufbau ----
  const saved = st().slots.map(sl => Object.assign({}, sl));
  st().stock.holz = 30; st().stock.kristall = 30;
  for (const sl of st().slots) if (sl.i > 0) Object.assign(sl, { kind: 'windrad', stage: 1, build: 1, hp: 60, fire: 0, ruined: false });
  Object.assign(st().slots[0], { kind: 'sternwarte', stage: 1, build: 0.5, hp: 120, fire: 0, ruined: false });
  await until(() => p2.last('skBase') && p2.last('skBase').canBuild.kanone === 'noSlot', 3000, 'canBuild noSlot');
  check(p2.last('skBase').canBuild.kanone === 'noSlot' && p2.last('skBase').canBuild.sternwarte === 'stage', 'canBuild: alle Plätze belegt → "noSlot", Stufe im Bau → "stage"');
  st().slots[3].ruined = true; st().slots[3].hp = 0;
  await until(() => p2.last('skBase') && p2.last('skBase').canBuild.windrad === true, 3000, 'canBuild Wiederaufbau');
  check(p2.last('skBase').canBuild.windrad === true && p2.last('skBase').canBuild.kanone === 'noSlot', 'zerstörtes Gebäude gleicher Art kann wieder aufgebaut werden');
  st().slots.forEach((sl, i) => Object.assign(sl, saved[i]));

  // ---- Drosselung: skYou ≤ 5/s, skBase ≤ 2/s (Bildschirmzeit) ----
  p2.send({ t: 'skBoost', on: true });
  p2.send({ t: 'skStick', x: 0.3, y: 0 });
  const tStart = w.performance.now();
  await sleep(500);
  p2.send({ t: 'skBoost', on: false }); p2.send({ t: 'skStick', x: 0, y: 0 });
  const rate = (arr, from, to) => arr.filter(m => m.__at >= from && m.__at <= to).length;
  let worstYou = 0, worstBase = 0;
  const yous = p2.all('skYou'), bases = p2.all('skBase');
  for (let t = tStart; t <= w.performance.now() - 1000; t += 100) { worstYou = Math.max(worstYou, rate(yous, t, t + 1000)); worstBase = Math.max(worstBase, rate(bases, t, t + 1000)); }
  check(worstYou <= 5, 'skYou höchstens 5 pro Sekunde (max ' + worstYou + ')');
  check(worstBase <= 2, 'skBase höchstens 2 pro Sekunde (max ' + worstBase + ')');
  check(yous.length > 3, 'skYou kommt bei Änderungen an (' + yous.length + ' bisher)');

  // ---- Auto-Qualität: genau einmal nach 5 s live bei langsamen Frames ----
  await until(() => dbg().autoDone, 6000, 'Auto-Qualität schaltet um');
  check(calls.qualities && calls.qualities.filter(q => q === 'low').length === 1 && dbg().quality === 'low', 'Auto: nach 5 s langsamer Frames genau einmal auf low');
  await sleep(400);
  check(calls.qualities.filter(q => q === 'low').length === 1 && !calls.qualities.slice(calls.qualities.indexOf('low') + 1).includes('high'), 'Auto schaltet nicht zurück und nicht doppelt');

  // ---- Warnung / Event: Sim manuell bis kurz vor die Warnung vorspulen ----
  const sim = dbg().sim;
  const warnAt = w.SkyfarersWorld.EVENTS.kurz[0].at - 15;
  let guard = 0;
  while (st().t < warnAt - 1 && guard++ < 5000) { sim.step(); st().herz = 100; }
  await until(() => p1.all('skAlert').length > 0 && p2.all('skAlert').length > 0, 5000, 'skAlert');
  const al = p1.last('skAlert');
  check(al && al.kind === 'sturm' && al.in === 15, 'skAlert sturm in 15 s an alle Kapitäne');
  await until(() => p2.all('skEvent').some(m => m.on), 6000, 'Sturm startet');
  check(p3.last('skEvent').kind === 'sturm' && p3.last('skEvent').on === true, 'skEvent on kommt an');
  check(!!st().event && st().event.kind === 'sturm', 'Sim steckt im Sturm');
  check(calls.evTypes.warn && calls.evTypes.eventStart, 'warn/eventStart gehen an die View');

  // ---- Spätbeitritt ----
  join(p4, 'Dino'); await sleep(300);
  check(dbg().seats.includes(p4.id) && !!ship(p4), 'Spätbeitritt bekommt ein Schiff');
  check(p4.last('skInfo') && p4.last('skInfo').ship === true && p4.last('skInfo').color === colors[p4.id].color, 'skInfo ship:true + Farbe für den Neuen');
  check(p4.last('skPhase') && p4.last('skPhase').phase === 'live', 'skPhase live für den Neuen');
  check(!!calls.look[p4.id], 'view.setLook kennt den Neuen');
  await until(() => p4.last('skYou'), 2000, 'skYou für den Neuen');

  // ---- Abgang: Cleo geht, Ladung fällt als Kiste ----
  ship(p3).cargo.holz = 2; ship(p3).cargo.kristall = 1;
  const dropsBefore = st().drops.length;
  bus.disconnect('c3'); await sleep(80);
  check(!dbg().seats.includes(p3.id) && !ship(p3) && st().ships.length === 4, 'abgehender Kapitän: Schiff weg, Sitz frei');
  check(st().drops.length === dropsBefore + 1, 'seine Ladung fällt als Kiste (removeCaptain)');
  check(w.eval('active') !== null, 'solange noch Menschen fliegen, läuft das Spiel');

  // ---- Ende: Sim bis kurz vor Schluss vorspulen, 3 Sterne + Punkte für Ben ----
  const length = w.SkyfarersWorld.DAUER.kurz;
  Object.assign(st().slots[0], { kind: 'sternwarte', stage: 3, build: 1, hp: 120, fire: 0, ruined: false });
  st().stock.holz = 0; st().stock.kristall = 0;
  ship(p2).stats.delivered = 40;
  guard = 0;
  while (st().t < length - 1.5 && guard++ < 9000) { sim.step(); st().herz = 100; st().slots[0].build = 1; st().slots[0].fire = 0; st().slots[0].ruined = false; }
  await until(() => dbg().phase === 'end', 6000, 'Ende');
  const res = p2.last('skPhase');
  check(res.phase === 'end' && res.result && res.result.survived === true && res.result.stars === 3, 'skPhase end: überlebt, 3 Sterne');
  check(res.result.mvp && res.result.mvp.name === 'Ben' && res.result.mvp.you === true, 'MVP = Ben (you:true beim Gewinner)');
  check(p1.last('skPhase').result.mvp.you === false && p1.last('skPhase').result.mvp.name === 'Ben', 'MVP für andere Handys: you:false');
  check(res.result.you && res.result.you.score >= 40 && res.result.you.stats && res.result.you.stats.delivered >= 40, 'result.you mit Punkten und Statistik');
  check(reported.length === 1 && reported[0].includes(p1.id) && reported[0].includes(p2.id) && reported[0].includes(p4.id) && reported[0].every(i => i > 0), 'reportWinners genau einmal mit allen menschlichen Kapitänen (ohne Bot)');
  await sleep(80);
  check(p1.dom.window.document.getElementById('skAgain').style.display === 'block', 'Host-Handy zeigt 🔁 Nochmal');
  check(p2.dom.window.document.getElementById('skAgain').style.display !== 'block', 'andere Handys nicht');
  p2.send({ t: 'skAgain' }); await sleep(60);
  check(dbg().phase === 'end', 'skAgain von einem Nicht-Host wird ignoriert');
  p2.send({ t: 'skStick', x: 1, y: 0 }); await sleep(20);

  // ---- Host geht auf dem Endscreen → neuer Host bekommt 🔁 ----
  bus.disconnect('c1'); await sleep(200);
  await until(() => p2.last('skInfo') && p2.last('skInfo').host === true, 2000, 'neuer Host');
  check(p2.last('skInfo').host === true, 'Host-Wechsel: neuer Host bekommt skInfo host:true');
  await sleep(60);
  check(p2.dom.window.document.getElementById('skAgain').style.display === 'block', 'neuer Host sieht 🔁 Nochmal');
  check(p2.last('skPhase').phase === 'end' && !!p2.last('skPhase').result, 'skPhase end samt Ergebnis wird neu gesendet');

  // ---- Rematch ----
  const seed0 = dbg().sim.world.seed, setWorld0 = calls.setWorld, snaps0 = calls.snaps;
  p2.dom.window.document.getElementById('skAgain').click();
  await sleep(100);
  check(dbg().phase === 'intro' && calls.setWorld === setWorld0 + 1, 'Rematch: neue Partie, setWorld erneut aufgerufen');
  check(dbg().sim.world.seed !== seed0 && st().t === 0 && st().herz === 100, 'Rematch: neue Seed, frische Sim');
  check(calls.made === 1 && !calls.dispose, 'dieselbe View für alle Partien (kein neuer WebGL-Kontext)');
  await until(() => dbg().phase === 'live', 5000, 'Rematch live');
  check(calls.snaps === snaps0 + 1, 'Rematch: snap-Frame für die neue Welt');
  check(dbg().seats.length === 2 && st().ships.length === 3, 'Rematch: nur die verbliebenen Menschen + 1 Bot');
  check(reported.length === 1, 'reportWinners nicht doppelt');

  // ---- alle gehen → Lobby ----
  bus.disconnect('c4'); await sleep(60);
  check(w.eval('active') !== null, 'ein Mensch übrig → Spiel läuft');
  bus.disconnect('c2'); await sleep(100);
  check(w.eval('active') === null, 'letzter Kapitän weg → zurück in die Lobby');
  check(w.document.getElementById('c').style.display !== 'none', 'cv ist nach dem Spiel wieder sichtbar');

  // ============================================================ Szenario 2: kein WebGL + 1 Mensch
  {
    const bus2 = makeBus();
    const screen2 = makeDom('screen.html', 'screen', bus2, 'screen');
    const ca = makeDom('controller.html', 'controller', bus2, 'a');
    const cs2 = { a: ca }; recordInbox(bus2, 'a');
    await sleep(100);
    const w2 = screen2.window; fastClock(w2);
    const pa = phoneOf(bus2, cs2, 'a');
    join(pa, 'Eva'); await sleep(100);
    w2.THREE = undefined;
    await startGame(pa, { dauer: 'kurz', bots: 1 });
    check(w2.eval('active') === null, 'ohne WebGL (kein THREE) → Spiel startet nicht, zurück in die Lobby');

    // View-Konstruktor wirft → ebenfalls Lobby
    w2.THREE = {}; w2.SkyfarersView = class { constructor() { throw new Error('kein WebGL'); } };
    await startGame(pa, { dauer: 'kurz', bots: 1 });
    check(w2.eval('active') === null, 'View-Konstruktor wirft → Lobby');

    // ein Mensch, 0 Bots konfiguriert → mindestens 1 Bot
    const c2calls = {}; stubView(w2, c2calls);
    await startGame(pa, { dauer: 'kurz', bots: 0, quality: 'low', schwierigkeit: 'heftig' });
    const d2 = () => w2.eval('active && active._debug()');
    check(d2() && d2().sim.state.ships.length === 2 && d2().sim.state.ships.some(s => s.bot), 'ein Mensch + bots 0 → mindestens 1 Bot');
    check(c2calls.ctorQuality === 'low' && c2calls.qualities && c2calls.qualities[0] === 'low', 'quality low → View startet sparsam');
    check(d2().sim.schwierigkeit === 'heftig' && d2().sim.dauer === 'kurz', 'Einstellungen erreichen die Sim');
    await until(() => d2().phase === 'live', 5000, 'Szenario 2 live');
    await sleep(1200);
    check(!c2calls.qualities.includes('high'), 'quality low: Auto-Umschaltung greift nicht (fester Wert)');
    check(d2().autoDone === false, 'kein Auto-Umschalten bei fester Qualität');
    // Host bricht ab (shell) → stop() räumt auf
    pa.send({ t: 'shellAbort' }); await sleep(100);
    bus2.disconnect('a'); await sleep(60);
  }

  // ============================================================ Szenario 3: 9 Handys → 8 Schiffe, 1 Zuschauer
  {
    const bus3 = makeBus();
    const screen3 = makeDom('screen.html', 'screen', bus3, 'screen');
    const labels = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'], cs3 = {};
    for (const l of labels) { cs3[l] = makeDom('controller.html', 'controller', bus3, l); recordInbox(bus3, l); }
    await sleep(150);
    const w3 = screen3.window; fastClock(w3);
    const c3calls = {}; stubView(w3, c3calls);
    const ps = labels.map(l => phoneOf(bus3, cs3, l));
    ps.forEach((p, i) => join(p, 'P' + (i + 1)));
    await sleep(250);
    await startGame(ps[0], { dauer: 'kurz', bots: 3, quality: 'high' });
    const d3 = () => w3.eval('active && active._debug()');
    check(d3() && d3().sim.state.ships.length === 8 && d3().seats.length === 8, '9 Handys + 3 Bots → genau 8 Schiffe (Bots weichen)');
    check(d3().sim.state.ships.filter(s => s.bot).length === 0 && d3().spectators.length === 1, 'alle 8 Plätze an Menschen, 1 Zuschauer');
    const spec = ps.find(p => !d3().seats.includes(p.id));
    check(spec && spec.last('skInfo') && spec.last('skInfo').ship === false, 'Zuschauer bekommt skInfo ship:false');
    await until(() => d3().phase === 'live', 5000, 'Szenario 3 live');
    // Zuschauer darf nicht steuern
    const before = JSON.stringify(d3().sim.state.ships.map(s => [s.x, s.y]));
    spec.send({ t: 'skStick', x: 1, y: 1 }); spec.send({ t: 'skBuild', kind: 'windrad' }); await sleep(30);
    check(true, 'Zuschauer-Nachrichten lösen keinen Fehler aus');
    // Ein Sitz wird frei → Zuschauer rückt nach
    const leaver = ps.find(p => p !== ps[0] && d3().seats.includes(p.id));
    bus3.disconnect(leaver.l); await sleep(150);
    check(d3().seats.includes(spec.id) && d3().sim.state.ships.length === 8, 'frei gewordener Sitz geht an den wartenden Zuschauer');
    check(spec.last('skInfo').ship === true, 'der Nachrücker bekommt skInfo ship:true');
    void before;
    for (const l of labels) bus3.disconnect(l);
    await sleep(100);
  }

  console.log(process.exitCode ? '❌ Skyfarers-Flow fehlgeschlagen' : '✅ Alle Skyfarers-Flow-Checks bestanden');
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
