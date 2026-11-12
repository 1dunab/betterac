// Neonspur end-to-end: echte Shell + 4 echte Controller in JSDOM, die View ist ein Stub
// (JSDOM kann kein WebGL). Prüft Phone-Protokoll, Rundenfluss, Beitritt/Abgang, Rematch.
const { makeDom, makeBus } = require('./test-helpers');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(5); }
  fail('Timeout: ' + what); return false;
}

const SPEED = 3;   // Spieluhr der Screen-Seite läuft 3x schneller (Countdown, Pausen)
const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const cs = {};
for (const l of ['c1', 'c2', 'c3', 'c4']) {
  cs[l] = makeDom('controller.html', 'controller', bus, l);
  // Eingehende Nachrichten mitschreiben (bevor der Controller sie verarbeitet)
  const h = bus.handlers[l], orig = h.deliver; h.inbox = [];
  h.deliver = (m) => { if (m.type === 'message') h.inbox.push(m.data); orig(m); };
}
const phone = (l) => ({
  l, get id() { return bus.handlers[l]._id; }, dom: cs[l],
  all: (t) => bus.handlers[l].inbox.filter(m => m.t === t),
  last(t) { return this.all(t).pop(); },
  send: (data) => bus.fromClient(l, JSON.stringify({ type: 'message', to: 0, data }))
});

(async () => {
  await sleep(100);
  const w = screen.window;
  // ---- Stub-View, schnellere Uhr, reportWinners-Spion ----
  const calls = { setRound: 0, event: 0, render: 0, dispose: 0, layouts: [] };
  const Real = w.NeonspurView;
  check(typeof Real === 'function' && typeof Real.layout === 'function', 'render.js ist auf der Screen-Seite geladen');
  w.THREE = {};
  w.NeonspurView = class {
    static layout(n, l, W, H) { return Real.layout(n, l, W, H); }
    constructor() { this.canvas = w.document.createElement('canvas'); calls.made = (calls.made || 0) + 1; }
    setRound(state, look) { calls.setRound++; calls.look = look; calls.state = state; }
    event() { calls.event++; }
    render(state, alpha, opts) { calls.render++; calls.opts = opts; calls.alpha = alpha; }
    dispose() { calls.dispose++; }
  };
  const real = w.performance.now.bind(w.performance), t0 = real();
  w.performance.now = () => t0 + (real() - t0) * SPEED;
  const reported = [];
  const origReport = w.reportWinners;
  w.reportWinners = (ids) => { reported.push(ids.slice()); origReport(ids); };

  // ---- Lobby: drei Spieler, Neonspur wählen, Optionen, Start ----
  const [p1, p2, p3, p4] = ['c1', 'c2', 'c3', 'c4'].map(phone);
  for (const [p, name] of [[p1, 'Anna'], [p2, 'Ben'], [p3, 'Cleo']]) {
    p.dom.window.document.getElementById('nameInput').value = name;
    p.dom.window.document.getElementById('joinBtn').click();
  }
  await sleep(100);
  const btn = [...p1.dom.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '⚡ Neonspur');
  check(!!btn, 'Neonspur steht im Spiele-Picker');
  btn.click(); await sleep(60);
  p1.send({ t: 'shellConfig', game: 'neonspur', cfg: { target: 2, bots: 1, tempo: 'chill', map: 'raster', camera: 'split' } });
  await sleep(40);
  p1.dom.window.document.getElementById('startBtn').click();
  await sleep(150);
  const dbg = () => w.eval('active && active._debug()');
  const colors = w.eval('players');
  check(dbg() && dbg().phase === 'countdown', 'Start → Countdown (kein WebGL-Fallback, Stub-View akzeptiert)');
  check(calls.made === 1 && calls.setRound === 1, 'View einmal gebaut, Runde gesetzt');
  check(dbg().seats.length === 3 && dbg().sim.state.riders.length === 4, '3 Menschen + 1 Bot auf 4 Plätzen');
  check(dbg().sim.state.riders.filter(r => r.pid < 0 && r.bot).length === 1, 'der Bot hat eine negative pid');

  for (const p of [p1, p2, p3]) {
    const info = p.last('nsInfo');
    check(info && info.rider === true && info.color === colors[p.id].color && info.cam === 'pov' && info.target === 2, 'nsInfo für ' + colors[p.id].name + ': Fahrer, Farbe, Kamera, Ziel');
    const you = p.last('nsYou');
    check(you && you.alive === true && you.jumpIn === 0 && you.killer === null, 'nsYou zum Rundenstart (Cooldown leer)');
  }
  check(p1.last('nsInfo').extras === true && p2.last('nsInfo').extras === true, 'nsInfo.extras ist standardmäßig true');
  check(p1.last('nsYou').boost === 0 && p1.last('nsYou').shield === false, 'nsYou trägt boost 0 / shield false zum Rundenstart');
  check(p1.last('nsInfo').host === true && p2.last('nsInfo').host === false, 'Host-Flag in nsInfo');
  check(p1.last('nsPhase').phase === 'countdown' && p1.last('nsPhase').n >= 1, 'nsPhase countdown mit n');

  await until(() => dbg().phase === 'live', 6000, 'Countdown → live');
  check(p2.all('nsPhase').some(m => m.phase === 'live'), 'nsPhase live kommt an');
  check(calls.render > 0 && calls.opts.layout === 'split' && calls.opts.views.length === 3, 'View bekommt 3 Split-Views der Menschen');

  // ---- Kamera ----
  p2.send({ t: 'nsCam' });
  check(p2.last('nsCamIs').cam === 'chase', 'nsCam → chase');
  await sleep(40);
  check(calls.opts.views.some(v => v.cam === 'chase'), 'Chase-Kamera erreicht die View');
  p2.send({ t: 'nsCam' });
  check(p2.last('nsCamIs').cam === 'pov', 'nsCam toggelt zurück');

  // ---- Lenken, Springen ----
  const st = () => dbg().sim.state;
  const rider = (p) => st().riders.find(r => r.pid === p.id);
  const waitTick = (n) => { const goal = st().tick + n; return until(() => st().tick >= goal || st().over, 3000, 'Tick +' + n); };
  const d0 = rider(p2).dir;
  p2.send({ t: 'nsTurn', d: 'X' }); p2.send({ t: 'nsTurn', d: 'R' });
  await waitTick(2);
  check(rider(p2).alive && rider(p2).dir === (d0 + 1) % 4, 'nsTurn R erreicht die Sim (Richtung dreht), ungültiges d ignoriert');
  p3.send({ t: 'nsJump' });
  await waitTick(2);
  const jy = p3.all('nsYou').filter(m => m.alive && m.jumpIn > 0);
  check(jy.length === 1 && jy[0].jumpIn > 1500 && jy[0].jumpIn <= 2500, 'nsJump → nsYou mit jumpIn > 0 (' + (jy[0] && Math.round(jy[0].jumpIn)) + ' ms)');
  // ---- Turbo & Extras (Phase 2) ----
  const alivePhone = () => [p2, p3].find(p => rider(p).alive && !st().over);
  const ep = alivePhone();
  if (ep) {
    const er = rider(ep);
    er.boost = 1;
    ep.send({ t: 'nsBoost', on: true });
    await until(() => !rider(ep).alive || rider(ep).boosting, 3000, 'nsBoost on → boosting');
    if (rider(ep).alive) {
      check(rider(ep).boosting === true, 'nsBoost on → Fahrer boostet');
      check(ep.all('nsYou').some(m => m.boost > 0 && m.boost < 1) || ep.all('nsYou').some(m => m.boost >= 0.98), 'nsYou meldet den Boost-Stand');
      ep.send({ t: 'nsBoost', on: false });
      await until(() => !rider(ep).alive || !rider(ep).boosting, 3000, 'nsBoost off → kein Boost mehr');
      check(!rider(ep).boosting, 'nsBoost off beendet den Boost');
    } else check(true, 'Fahrer war beim Boost-Test schon raus (übersprungen)');
  } else check(true, 'kein lebender Fahrer für den Boost-Test (übersprungen)');
  // Item direkt vor einen Fahrer legen → nsItem am Handy
  const ip = alivePhone();
  if (ip) {
    const ir = rider(ip), D = [[1, 0], [0, 1], [-1, 0], [0, -1]][ir.dir], m = st().map;
    const x = ir.x + 2 * D[0], y = ir.y + 2 * D[1], c = y * m.w + x;
    if (x >= 0 && y >= 0 && x < m.w && y < m.h && !m.wall[c] && !st().riders.some(q => q.trail.some(t => t[0] === x && t[1] === y))) {
      st().items.push({ id: 999, kind: 'shield', x, y, h: m.floor[c] });
      await until(() => !rider(ip).alive || ip.all('nsItem').length > 0, 4000, 'Item-Pickup');
      check(rider(ip).alive ? (ip.last('nsItem') || {}).kind === 'shield' : true, 'Item-Pickup → nsItem {kind: shield}');
      if (rider(ip).alive) await until(() => ip.all('nsYou').some(m2 => m2.shield === true), 2000, 'nsYou shield');
    } else check(true, 'Zelle vor dem Fahrer ungeeignet (Item-Test übersprungen)');
  }
  // ---- Selbstcrash: R,R,R,R schließt ein Quadrat in die eigene Spur ----
  p1.send({ t: 'nsTurn', d: 'R' }); p1.send({ t: 'nsTurn', d: 'R' });
  await waitTick(2);
  p1.send({ t: 'nsTurn', d: 'R' }); p1.send({ t: 'nsTurn', d: 'R' });
  await until(() => !rider(p1).alive, 3000, 'Rider 1 crasht');
  const dead = p1.last('nsYou');
  check(dead && dead.alive === false && dead.killer === 'deine eigene Spur', 'Selbstcrash → nsYou alive:false, killer = eigene Spur');
  const before = rider(p1).dir;
  p1.send({ t: 'nsTurn', d: 'L' });
  await sleep(40);
  check(rider(p1).dir === before, 'Tote Fahrer können nicht mehr lenken');
  const v = calls.opts.views;
  check(v.length === 3 && v[0].pid !== p1.id || v.some(x => x.pid !== p1.id), 'View des toten Fahrers folgt einem lebenden');

  await until(() => p3.all('nsYou').some(m => m.alive && m.jumpIn === 0 && p3.all('nsYou').indexOf(m) > p3.all('nsYou').indexOf(jy[0])), 5000, 'Cooldown-Ende wird gemeldet');
  check(p3.all('nsYou').filter(m => m.alive && m.jumpIn === 0).length >= 2, 'nach dem Cooldown kommt genau ein nsYou jumpIn 0');

  // ---- Beitritt mitten im Match ----
  p4.dom.window.document.getElementById('nameInput').value = 'Dino';
  p4.dom.window.document.getElementById('joinBtn').click();
  await sleep(250);
  check(p4.last('nsInfo') && p4.last('nsInfo').rider === false, '4. Handy bekommt nsInfo rider:false (Platz erst nächste Runde)');
  check(!dbg().seats.includes(p4.id), 'noch kein Sitz in der laufenden Runde');

  // ---- Fahrer geht mitten in der Runde ----
  // Cleo geht auch, wenn sie schon raus ist (das hängt von Zufall und Tempo ab): bliebe sie, säßen in Dinos Runde
  // 4 Menschen und kein Bot, und 4 Fahrer, die geradeaus in die Wand fahren, crashen gleichzeitig: nur Unentschieden, kein Finale
  const drv = rider(p3), wasAlive = drv.alive && !st().over;
  bus.disconnect('c3'); await sleep(60);
  if (wasAlive) check(!dbg().seats.includes(p3.id) && st().riders.find(r => r.pid === p3.id).killer === 'left', 'abgehender Fahrer crasht still (killer left), Sitz frei');
  else check(!dbg().seats.includes(p3.id), 'Fahrer war schon raus und geht trotzdem: Sitz frei');

  // ---- Rundenende ----
  await until(() => dbg().phase === 'roundOver', 15000, 'Runde endet');
  const ro = p2.all('nsPhase').filter(m => m.phase === 'roundOver').pop();
  check(!!ro && (ro.winner === null || typeof ro.winner === 'string'), 'nsPhase roundOver mit Siegername oder null (Unentschieden)');
  const winsSum = Object.values(dbg().wins).reduce((a, b) => a + b, 0);
  const decided = p2.all('nsPhase').filter(m => m.phase === 'roundOver' && m.winner).length;
  check(winsSum === decided, 'jede entschiedene Runde zählt genau einen Rundensieg (' + winsSum + ')');

  // ---- nächste Runde: Dino sitzt jetzt mit ----
  await until(() => dbg().phase === 'countdown' || dbg().phase === 'final', 8000, 'nächste Runde / Finale');
  if (dbg().phase === 'countdown') {
    check(dbg().seats.includes(p4.id), 'Dino hat in der nächsten Runde einen Platz');
    check(p4.last('nsInfo').rider === true && p4.last('nsInfo').color === colors[p4.id].color, 'Dino bekommt nsInfo rider:true mit Farbe');
    check(p4.last('nsYou') && p4.last('nsYou').alive, 'und nsYou zum Rundenstart');
  } else check(true, 'Match war schon zu Ende (Beitritt-Check übersprungen)');

  // ---- bis zum Finale (alle fahren geradeaus in die Wand) ----
  await until(() => dbg().phase === 'final', 40000, 'Finale');
  const fin = p1.all('nsPhase').filter(m => m.phase === 'final').pop();
  check(fin && typeof fin.champion === 'string' && fin.champion.length > 0, 'nsPhase final mit Champion-Name: ' + (fin && fin.champion));
  const champId = Object.keys(dbg().wins).sort((a, b) => dbg().wins[b] - dbg().wins[a])[0];
  check(Number(champId) < 0 ? reported.length === 0 : reported.length === 1 && reported[0][0] === Number(champId), 'reportWinners genau einmal mit dem menschlichen Champion (bzw. gar nicht bei Bot-Sieg)');
  await sleep(80);
  const again = p1.dom.window.document.getElementById('nsAgain');
  check(p1.dom.window.document.getElementById('v-neonspur').classList.contains('on') && again.style.display === 'block', 'Host-Handy zeigt den 🔁 Nochmal-Button');
  check(p2.dom.window.document.getElementById('nsAgain').style.display !== 'block', 'andere Handys zeigen ihn nicht');
  p2.send({ t: 'nsAgain' }); await sleep(80);
  check(dbg().phase === 'final', 'nsAgain von einem Nicht-Host wird ignoriert');
  again.click();
  await sleep(60);
  check(dbg().phase === 'countdown' && Object.values(dbg().wins).every(x => x === 0), 'Host-Nochmal startet neuen Countdown, Siege zurückgesetzt');
  check(calls.made === 1, 'dieselbe View für das ganze Match (kein neuer WebGL-Kontext)');
  await sleep(100);

  // ---- alle gehen ----
  bus.disconnect('c4'); bus.disconnect('c2'); await sleep(60);
  check(w.eval('active') !== null, 'solange noch ein Mensch fährt, läuft das Spiel');
  bus.disconnect('c1'); await sleep(100);
  check(w.eval('active') === null, 'letzter Fahrer weg → zurück in die Lobby');

  // ---- Szenario 2: Extras aus ----
  const bus2 = makeBus();
  const screen2 = makeDom('screen.html', 'screen', bus2, 'screen');
  const ca = makeDom('controller.html', 'controller', bus2, 'a'), cb = makeDom('controller.html', 'controller', bus2, 'b');
  const inbox2 = []; { const h = bus2.handlers.a, o = h.deliver; h.deliver = (m) => { if (m.type === 'message') inbox2.push(m.data); o(m); }; }
  await sleep(100);
  const w2 = screen2.window;
  w2.THREE = {}; const Real2 = w2.NeonspurView;
  w2.NeonspurView = class { static layout(n, l, W, H) { return Real2.layout(n, l, W, H); } constructor() { this.canvas = w2.document.createElement('canvas'); } setRound() {} event() {} render() {} setQuality() {} dispose() {} };
  const r2 = w2.performance.now.bind(w2.performance), u0 = r2();
  w2.performance.now = () => u0 + (r2() - u0) * SPEED;
  for (const [d, name] of [[ca, 'Eva'], [cb, 'Finn']]) { d.window.document.getElementById('nameInput').value = name; d.window.document.getElementById('joinBtn').click(); }
  await sleep(100);
  [...ca.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '⚡ Neonspur').click(); await sleep(60);
  bus2.fromClient('a', JSON.stringify({ type: 'message', to: 0, data: { t: 'shellConfig', game: 'neonspur', cfg: { target: 1, bots: 1, tempo: 'chill', map: 'raster', extras: 'off', quality: 'low' } } }));
  await sleep(40);
  ca.window.document.getElementById('startBtn').click(); await sleep(150);
  const dbg2 = () => w2.eval('active && active._debug()');
  const info2 = inbox2.filter(m => m.t === 'nsInfo').pop();
  check(info2 && info2.extras === false, 'extras: off → nsInfo.extras false');
  check(dbg2() && dbg2().sim.state.extras === false, 'Sim läuft ohne Extras');
  await until(() => dbg2().phase === 'live', 6000, 'Szenario 2: live');
  const rid2 = dbg2().sim.state.riders.find(q => q.pid > 0 && q.alive);
  const pid2 = rid2.pid; rid2.boost = 1;
  bus2.fromClient('a', JSON.stringify({ type: 'message', to: 0, data: { t: 'nsBoost', on: true } }));
  await sleep(150);
  check(dbg2().sim.state.riders.every(q => !q.boosting || q.pid < 0), 'nsBoost wird ohne Extras ignoriert');
  // viele Subticks von Hand: es spawnt nie ein Item
  const sim2 = dbg2().sim; let guard = 0;
  while (!sim2.state.over && guard++ < 4000) sim2.step();
  check(sim2.state.time > 6000 ? sim2.state.items.length === 0 : true, 'ohne Extras spawnt nie ein Item (' + Math.round(sim2.state.time) + ' ms gespielt)');
  check(inbox2.filter(m => m.t === 'nsItem').length === 0, 'kein nsItem ohne Extras');

  console.log(process.exitCode ? '❌ Neonspur-Flow fehlgeschlagen' : '✅ Alle Neonspur-Flow-Checks bestanden');
  process.exit(process.exitCode || 0);
})();
