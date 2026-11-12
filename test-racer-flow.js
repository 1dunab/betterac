// Micro Racer end to end: the real shell + three real controllers in JSDOM. The view is a stub
// (JSDOM has no WebGL). Checks the phone protocol, both-buttons-brake, items, falling out of the
// picture, heats, the final, rematch, reconnect and leaving.
const { makeDom, makeBus, visible } = require('./test-helpers');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(5); }
  fail('Timeout: ' + what); return false;
}

const SPEED = 3;   // the screen's clock runs 3× faster (countdown, pauses)
const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const cs = {};
for (const l of ['c1', 'c2', 'c3']) {
  cs[l] = makeDom('controller.html', 'controller', bus, l);
  // record incoming messages (before the controller handles them)
  cs[l].window.HTMLMediaElement.prototype.play = () => Promise.resolve();   // the wake-lock video: JSDOM cannot play
  const h = bus.handlers[l], orig = h.deliver; h.inbox = [];
  h.deliver = (m) => { if (m.type === 'message') h.inbox.push(m.data); orig(m); };
}
const phone = (l) => ({
  l, get id() { return bus.handlers[l]._id; }, dom: cs[l], $: (id) => cs[l].window.document.getElementById(id),
  all: (t) => bus.handlers[l].inbox.filter(m => m.t === t),
  last(t) { return this.all(t).pop(); },
  send: (data) => bus.fromClient(l, JSON.stringify({ type: 'message', to: 0, data })),
  touch(id, type) { const w = cs[l].window; w.document.getElementById(id).dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true })); },
  key(type, key) { const w = cs[l].window; w.document.dispatchEvent(new w.KeyboardEvent(type, { key, bubbles: true, cancelable: true })); }
});

(async () => {
  await sleep(100);
  const w = screen.window;
  // ---- stub view, faster clock, reportWinners spy ----
  const calls = { made: 0, setRound: 0, render: 0, clear: 0, events: [] };
  check(typeof w.RacerView === 'function' && w.RacerSim && w.RacerTracks, 'tracks.js, sim.js and render.js are loaded on the screen page');
  w.THREE = {};
  w.RacerView = class {
    constructor() { this.canvas = w.document.createElement('canvas'); this.ratio = 1; calls.made++; }
    setRatio() {}
    setRound(sim, look) { calls.setRound++; calls.look = look; }
    event(e) { calls.events.push(e.t); }
    render(state) { calls.render++; calls.state = state; }
    clear() { calls.clear++; }
    dispose() {}
  };
  const real = w.performance.now.bind(w.performance), t0 = real();
  w.performance.now = () => t0 + (real() - t0) * SPEED;
  const reported = [];
  const origReport = w.reportWinners;
  w.reportWinners = (ids) => { reported.push(ids.slice()); origReport(ids); };

  // ---- lobby: three players, pick the racer, settings, start ----
  const [p1, p2, p3] = ['c1', 'c2', 'c3'].map(phone);
  for (const [p, name] of [[p1, 'Anna'], [p2, 'Ben'], [p3, 'Cleo']]) { p.$('nameInput').value = name; p.$('joinBtn').click(); }
  await sleep(100);
  const pick = () => [...p1.dom.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '🏎️ Micro Racer');
  check(!!pick(), 'Micro Racer is in the game picker');
  pick().click(); await sleep(60);
  p1.send({ t: 'shellConfig', game: 'racer', cfg: { track: 'vulkan', targetPoints: 2, items: 'on' } });
  await sleep(40);
  p1.$('startBtn').click();
  await sleep(150);
  const dbg = () => w.eval('active && active._debug()');
  const st = () => dbg().state;
  const car = (p) => st().racers[p.id];
  check(dbg() && dbg().phase === 'countdown', 'start → countdown (the stub view is accepted, no WebGL fallback)');
  check(calls.made === 1 && calls.setRound === 1, 'one view, the round is set');
  check(calls.look.biome.name === 'Vulkan' && Object.keys(calls.look.colors).length === 3, 'the view gets the chosen biome and the players\' colours');
  check(st().lava.length > 0 && st().boxes.length === 9 && st().target === 2, 'the settings reach the sim: lava track, items on, target 2');
  check(w.document.querySelectorAll('canvas').length === 3 && w.document.getElementById('c').style.display === 'none', 'the 3D canvas and its HUD replace the shell canvas');
  for (const p of [p1, p2, p3]) {
    check(visible(p.dom) === 'v-race', 'the phone shows the racer pad');
    const s = p.last('raceState');
    check(s && s.phase === 'countdown' && s.heat === 1 && s.items === true, 'raceState: countdown, heat 1, items on');
    check(!p.$('racePad').classList.contains('noitems'), 'the item button is there');
  }

  // phones in `auto` steer by themselves (through the bus, like a player would), so nobody leaves the road by accident
  const auto = new Set([p1]);
  const pilot = setInterval(() => {
    const d = dbg();
    if (!d) return;
    for (const p of auto) { const r = d.racers[p.id]; if (r && r.alive) { const i = w.RacerSim.autoSteer(d.sim, p.id); p.send({ t: 'raceSteer', s: i.s, b: i.b }); } }
  }, 25);

  await until(() => dbg().phase === 'race', 6000, 'countdown → race');
  check(p2.all('raceState').some(m => m.phase === 'race'), 'raceState race arrives');
  check(calls.render > 0 && calls.events.includes('go'), 'the view renders and hears the sim\'s events');

  // ---- steering, and both buttons = brake ----
  p2.touch('race-left', 'touchstart');
  check(car(p2).steer === -1 && car(p2).brake === false, 'left held → steers left');
  p2.touch('race-right', 'touchstart');
  check(car(p2).steer === 0 && car(p2).brake === true, 'left + right held → brakes, goes straight');
  check(p2.$('racePad').classList.contains('brake') && p2.$('race-left').textContent === '🛑', 'the phone shows the brake');
  check(car(p1).brake === false && car(p3).brake === false, 'only that car brakes');
  p2.touch('race-left', 'touchend');
  check(car(p2).steer === 1 && car(p2).brake === false, 'left released → steers right, brake off');
  check(!p2.$('racePad').classList.contains('brake') && p2.$('race-left').textContent === '↺', 'the brake sign is gone');
  p2.touch('race-right', 'touchend');
  check(car(p2).steer === 0 && car(p2).brake === false, 'both released → straight');
  p3.key('keydown', 'ArrowLeft'); p3.key('keydown', 'ArrowRight');
  check(car(p3).brake === true, 'keyboard: both arrows brake too');
  p3.key('keyup', 'ArrowLeft'); p3.key('keyup', 'ArrowRight');
  check(car(p3).brake === false && car(p3).steer === 0, 'keyboard: released');
  p2.send({ t: 'raceSteer', s: 99, b: 0 });
  check(car(p2).steer === 1, 'steering from the phone is clamped');
  p2.send({ t: 'raceSteer', s: 0, b: false });
  auto.add(p2); auto.add(p3);

  // ---- nitro ----
  p1.touch('race-nitro', 'touchstart');
  check(car(p1).nitroUntil > st().time, 'nitro reaches the sim');
  await until(() => p1.last('raceYou').nitro === false, 1000, 'nitro answer');
  check(p1.$('race-nitro').classList.contains('cooldown'), 'the phone shows the cooldown');
  const nitroUntil = car(p1).nitroUntil;
  p1.touch('race-nitro', 'touchstart');
  check(car(p1).nitroUntil === nitroUntil, 'no second nitro during the cooldown');

  // ---- items: drive through a box, get an item, use it ----
  const box = st().boxes[0];
  box.x = car(p1).x; box.z = car(p1).z;    // put a box right where the car is
  await until(() => car(p1).item !== null, 2000, 'pickup');
  const kind = car(p1).item;
  check(p1.all('raceYou').some(m => m.item === kind) && !p1.$('race-item').classList.contains('empty'), 'the phone holds the item (' + kind + ')');
  p2.touch('race-item', 'touchstart');
  check(car(p1).item === kind, 'somebody else\'s item button does nothing');
  p1.touch('race-item', 'touchstart');
  check(car(p1).item === null, 'using it empties the hand');
  await until(() => p1.last('raceYou').item === null, 1000, 'item answer');
  check(p1.$('race-item').classList.contains('empty'), 'and the phone\'s button');
  check(calls.events.includes('pickup') && calls.events.includes('use'), 'the view sees pickup and use');

  // ---- out of the picture → warning → out ----
  await until(() => st().time - st().raceAt > 2600, 4000, 'start protection over');
  auto.delete(p3);
  car(p3).x += 600;                        // far away from the camera
  await until(() => p3.all('raceYou').some(m => m.danger === true), 2000, 'danger');
  check(p3.$('v-race').classList.contains('danger') && /aus dem Bild/.test(p3.$('raceStatus').textContent), 'the phone warns: out of the picture');
  const dangerAt = st().time;
  await until(() => !car(p3).alive, 3000, 'out');
  check(st().time - dangerAt <= w.RacerSim.CONST.OFF_MS + 400, 'and is out one grace period later (' + Math.round(st().time - dangerAt) + ' ms)');
  check(p3.last('raceYou').out === true && p3.$('racePad').classList.contains('out') && !p3.$('v-race').classList.contains('danger'), 'the phone knows it is out');
  check(dbg().phase === 'race' && car(p1).alive && car(p2).alive, 'the others race on');
  check(!p1.all('raceYou').some(m => m.out), 'nobody else is told they are out');
  const steer0 = car(p3).steer;
  p3.touch('race-nitro', 'touchstart'); p3.send({ t: 'raceSteer', s: steer0 > 0 ? -1 : 1, b: true });
  check(car(p3).steer === steer0 && car(p3).brake === false && car(p3).nitroUntil === 0, 'a car that is out takes no more input');
  const ranks = p1.all('raceYou').filter(m => m.rank);
  check(ranks.length > 0 && ranks[0].of === 3, 'the phones learn their place in the field');

  // ---- heat end, points, final ----
  const winner = st().racers[p1.id].progress >= st().racers[p2.id].progress ? p1 : p2, loser = winner === p1 ? p2 : p1;
  auto.delete(loser);
  car(loser).x += 600;
  await until(() => dbg().phase === 'heatOver', 3000, 'heat over');
  const sc = winner.last('raceScore');
  check(sc && sc.won === true && sc.points === 2 && sc.target === 2, 'raceScore: the survivor gets 2 of 2 points');
  check(loser.last('raceScore').won === false && loser.last('raceScore').points === 1 && p3.last('raceScore').points === 0, 'the others get 1 and 0');
  await until(() => dbg().phase === 'final', 6000, 'final');
  check(reported.length === 1 && reported[0][0] === winner.id, 'the winner is reported for the evening\'s scoreboard');
  check(winner.last('raceFinal').winner === true && loser.last('raceFinal').winner === false && loser.last('raceFinal').name === (winner === p1 ? 'Anna' : 'Ben'), 'raceFinal names the champion');
  check(p1.$('raceAgainBtn').style.display === 'block' && p2.$('raceAgainBtn').style.display === 'none', 'only the host gets the rematch button');

  // ---- rematch ----
  p2.send({ t: 'raceAgain' }); await sleep(60);
  check(dbg().phase === 'final', 'raceAgain from a guest is ignored');
  p1.$('raceAgainBtn').click();
  await until(() => dbg().phase === 'countdown', 2000, 'rematch');
  check(st().heat === 1 && Object.values(st().points).every(x => x === 0), 'the host\'s rematch starts over at heat 1');
  await until(() => p3.all('raceState').length >= 3, 2000, 'new raceState');
  check(!p3.$('racePad').classList.contains('out') && p1.$('raceAgainBtn').style.display === 'none', 'the phones are reset for the new heat');
  check(calls.made === 1 && calls.setRound === 1, 'same view, same diorama for the rematch');

  // ---- a phone reloads: it gets everything again ----
  const n0 = p2.all('raceState').length;
  p2.send({ t: 'shellSync' }); await sleep(60);
  check(p2.all('raceState').length === n0 + 1 && p2.last('raceState').phase === dbg().phase && visible(p2.dom) === 'v-race', 'shellSync → back in the game with the current state');
  check(p2.last('raceYou').nitro === true && p2.last('raceYou').item === null, 'and its own car\'s state');

  clearInterval(pilot);

  // ---- abort, then a second match without items: same view, no boxes ----
  p1.$('abortBtn').click(); await sleep(150);
  check(w.eval('active') === null && visible(p1.dom) === 'v-shelllobby', 'abort → lobby');
  check(w.document.getElementById('c').style.display === '' && calls.clear === 1, 'the shell canvas is back, the scene is freed');
  p1.send({ t: 'shellConfig', game: 'racer', cfg: { track: 'toy', targetPoints: 5, items: 'off' } });
  await sleep(40);
  p1.$('startBtn').click(); await sleep(150);
  check(dbg() && dbg().phase === 'countdown' && calls.made === 1 && calls.setRound === 2, 'second match: the view is reused (no new WebGL context)');
  check(w.document.querySelectorAll('canvas').length === 3, 'and no extra canvases pile up');
  check(st().boxes.length === 0 && p2.last('raceState').items === false && p2.$('racePad').classList.contains('noitems'), 'items off: no boxes, no item button');
  check(dbg().map.key === 'toy' && dbg().samples.some(s => s.cross), 'the figure-eight track is loaded');

  // ---- players leave ----
  bus.disconnect('c3'); await sleep(80);
  check(w.eval('active') !== null && st().order.length === 2 && !st().racers[p3.id], 'one of three leaves: the match goes on');
  bus.disconnect('c2'); await sleep(100);
  check(w.eval('active') === null, 'only one left → back to the lobby');

  // ---- no WebGL: the game refuses politely ----
  const bus2 = makeBus();
  const screen2 = makeDom('screen.html', 'screen', bus2, 'screen');
  const ca = makeDom('controller.html', 'controller', bus2, 'a'), cb = makeDom('controller.html', 'controller', bus2, 'b');
  await sleep(100);
  for (const [d, name] of [[ca, 'Eva'], [cb, 'Finn']]) { d.window.document.getElementById('nameInput').value = name; d.window.document.getElementById('joinBtn').click(); }
  await sleep(100);
  [...ca.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '🏎️ Micro Racer').click(); await sleep(60);
  ca.window.document.getElementById('startBtn').click(); await sleep(150);
  check(screen2.window.eval('active') === null && visible(ca) === 'v-shelllobby', 'without three.js the match does not start and everybody is back in the lobby');

  console.log(process.exitCode ? '❌ Micro-Racer-Flow fehlgeschlagen' : '✅ Alle Micro-Racer-Flow-Checks bestanden');
  process.exit(process.exitCode || 0);
})();
