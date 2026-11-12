// Autoball end to end: the real shell + real controllers in JSDOM. The view is a stub (JSDOM has no WebGL).
// Checks team selection, bots filling up, the stick and boost, goals, leaving and joining mid-match,
// the end, rematch and the fallbacks.
const { makeDom, makeBus, visible } = require('./test-helpers');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(5); }
  fail('Timeout: ' + what); return false;
}

const SPEED = 3;   // the screen's clock runs 3× faster (countdowns, celebrations)
const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const cs = {};
function addPhone(l) {
  cs[l] = makeDom('controller.html', 'controller', bus, l);
  cs[l].window.HTMLMediaElement.prototype.play = () => Promise.resolve();   // the wake-lock video: JSDOM cannot play
  const h = bus.handlers[l], orig = h.deliver; h.inbox = [];
  h.deliver = (m) => { if (m.type === 'message') h.inbox.push(m.data); orig(m); };
  return phone(l);
}
const phone = (l) => ({
  l, get id() { return bus.handlers[l]._id; }, dom: cs[l], $: (id) => cs[l].window.document.getElementById(id),
  all: (t) => bus.handlers[l].inbox.filter(m => m.t === t),
  last(t) { return this.all(t).pop(); },
  send: (data) => bus.fromClient(l, JSON.stringify({ type: 'message', to: 0, data })),
  touch(id, type, x, y) {
    const w = cs[l].window, e = new w.Event(type, { bubbles: true, cancelable: true });
    e.changedTouches = [{ identifier: 7, clientX: x || 0, clientY: y || 0 }];
    w.document.getElementById(id).dispatchEvent(e);
  },
  key(type, key) { const w = cs[l].window; w.document.dispatchEvent(new w.KeyboardEvent(type, { key, bubbles: true, cancelable: true })); }
});
const join = (p, name) => { p.$('nameInput').value = name; p.$('joinBtn').click(); };

(async () => {
  const [p1, p2, p3] = ['c1', 'c2', 'c3'].map(addPhone);
  await sleep(100);
  const w = screen.window;
  // ---- stub view, faster clock, reportWinners spy ----
  const calls = { made: 0, setRound: 0, render: 0, clear: 0, forget: 0, events: [] };
  check(typeof w.AutoballView === 'function' && w.AutoballSim && w.Kit3D, 'sim.js, render.js and kit3d.js are loaded on the screen page');
  w.THREE = {};
  w.AutoballView = class {
    constructor() { this.canvas = w.document.createElement('canvas'); this.ratio = 1; calls.made++; }
    setRatio() {}
    setRound(sim, look) { calls.setRound++; calls.look = look; }
    event(e) { calls.events.push(e.t); }
    render() { calls.render++; }
    forget() { calls.forget++; }
    toScreen() { return [100, 100]; }
    clear() { calls.clear++; }
    dispose() {}
  };
  const real = w.performance.now.bind(w.performance), t0 = real();
  w.performance.now = () => t0 + (real() - t0) * SPEED;
  const reported = [];
  const origReport = w.reportWinners;
  w.reportWinners = (ids) => { reported.push(ids.slice()); origReport(ids); };

  // ---- lobby → team selection ----
  join(p1, 'Anna'); join(p2, 'Ben'); join(p3, 'Cleo');
  await sleep(100);
  const pick = () => [...p1.dom.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '⚽ Autoball');
  check(!!pick(), 'Autoball is in the game picker');
  pick().click(); await sleep(60);
  p1.send({ t: 'shellConfig', game: 'autoball', cfg: { minutes: 2, arena: 'eis', bots: 'fill' } });
  await sleep(40);
  p1.$('startBtn').click();
  await sleep(150);
  const dbg = () => w.eval('active && active._debug()');
  const st = () => dbg().state;
  const car = (p) => dbg().sim.car(p.id);
  check(dbg() && dbg().phase === 'teams' && calls.made === 1 && calls.setRound === 0, 'start → team selection (the view exists, no match yet)');
  check(w.document.getElementById('c').style.display !== 'none', 'the team screen is drawn on the shell canvas');
  check([p1, p2, p3].every(p => visible(p.dom) === 'v-abteams'), 'the phones show the team selection');
  check(p1.last('abTeams').team === 0 && p2.last('abTeams').team === 1 && p3.last('abTeams').team === 0, 'teams are dealt out in turn');
  check(p1.last('abTeams').lists[1].join() === 'Ben,🤖 Bot' && p1.last('abTeams').lists[0].join() === 'Anna,Cleo', 'a bot will fill the smaller team');
  check(p1.$('abStart').style.display === 'block' && p2.$('abStart').style.display === 'none', 'only the host can kick off');
  check(/Blau/.test(p2.$('abTeamName').textContent) && /Orange/.test(p1.$('abTeamName').textContent), 'each phone shows its team');

  p3.$('abSwitch').click(); await sleep(40);
  check(p3.last('abTeams').team === 1 && p1.last('abTeams').lists[0].join() === 'Anna,🤖 Bot' && p1.last('abTeams').lists[1].join() === 'Ben,Cleo', 'switching teams moves the player, and the bot to the other side');
  p2.send({ t: 'abStart' }); await sleep(40);
  check(dbg().phase === 'teams', 'a guest cannot kick off');
  p3.$('abSwitch').click(); await sleep(40);

  // ---- kickoff ----
  p1.$('abStart').click(); await sleep(100);
  check(dbg().phase === 'match' && st().phase === 'kickoff' && calls.setRound === 1 && calls.look.arena === 'eis', 'the host kicks off: the match is built in the chosen arena');
  check(st().cars.length === 4 && st().cars.filter(c => c.bot).length === 1 && st().cars.find(c => c.bot).team === 1, 'three players and one bot, two against two');
  check(st().clock === 120000, 'two minutes on the clock');
  check(w.document.getElementById('c').style.display === 'none' && w.document.querySelectorAll('canvas').length === 3, 'the 3D stage replaces the shell canvas');
  check([p1, p2, p3].every(p => visible(p.dom) === 'v-abpad'), 'the phones show the pad');
  const s1 = p1.last('abState');
  check(s1.phase === 'kickoff' && s1.team === 0 && s1.score.join(':') === '0:0' && s1.host === true && p2.last('abState').team === 1, 'abState: kickoff, team, score, host');
  check(calls.look.roofOf(car(p1)) === s1.roof && calls.look.roofOf(st().cars.find(c => c.bot)) !== s1.roof, 'the roof is the player\'s own colour, bots have a grey one');

  await until(() => st().phase === 'play', 6000, 'kickoff → play');
  check(p1.all('abState').some(m => m.phase === 'play') && calls.render > 0 && calls.events.includes('go'), 'play starts, the view renders and hears events');

  // ---- stick and boost ----
  p1.touch('ab-stick', 'touchstart', 100, 100);
  p1.touch('ab-stick', 'touchmove', 131, 100);
  await sleep(70);
  p1.touch('ab-stick', 'touchmove', 200, 100);
  check(Math.abs(car(p1).ix - 1) < 0.01 && Math.abs(car(p1).iz) < 0.01, 'thumb to the right → stick fully right');
  p1.touch('ab-stick', 'touchmove', 200, 300);
  await sleep(70);
  p1.touch('ab-stick', 'touchmove', 200, 301);
  check(car(p1).iz > 0.9, 'thumb down → the car is told to drive down the TV');
  p1.touch('ab-stick', 'touchend', 200, 301);
  check(car(p1).ix === 0 && car(p1).iz === 0, 'thumb lifted → stick in the middle');
  p1.touch('ab-boost', 'touchstart');
  check(car(p1).boost === true && car(p2).boost === false, 'boost held');
  await until(() => p1.all('abYou').some(m => m.tank < 0.45), 3000, 'tank message');
  check(/%/.test(p1.$('abTank').style.width), 'the phone shows the tank draining');
  p1.touch('ab-boost', 'touchend');
  check(car(p1).boost === false, 'boost released');
  p2.key('keydown', 'd'); p2.key('keydown', ' ');
  check(car(p2).ix === 1 && car(p2).boost === true, 'keyboard: D steers right, space boosts');
  p2.key('keyup', 'd'); p2.key('keyup', ' ');
  check(car(p2).ix === 0 && car(p2).boost === false, 'keyboard: released');
  p2.send({ t: 'abStick', x: 50, y: 'x' });
  check(Math.abs(car(p2).ix - 1) < 1e-9 && car(p2).iz === 0, 'nonsense from a phone is clamped');
  p2.send({ t: 'abStick', x: 0, y: 0 });

  // ---- a goal ----
  const C = w.AutoballSim.CONST;
  const shoot = (p) => { const b = st().ball; b.x = C.L - 3; b.z = 0; b.y = 0; b.vx = 30; b.vz = 0; b.vy = 0; b.last[0] = { id: p.id, at: st().time }; };
  shoot(p1);
  await until(() => st().phase === 'goal', 2000, 'goal');
  await sleep(30);
  check(st().score.join(':') === '1:0' && car(p1).goals === 1 && calls.events.includes('goal'), 'the ball is in: 1 : 0, Anna scored');
  check(p1.last('abState').text === '⚽ Dein Tor!' && p3.last('abState').text === '⚽ Tor für euch!' && p2.last('abState').text === '😬 Gegentor', 'each phone hears what the goal means for it');
  check(p2.last('abState').score.join(':') === '1:0' && /1 : 0/.test(p2.$('abScore').textContent), 'the phones show the score');
  await until(() => st().phase === 'play', 8000, 'next kickoff');

  // ---- leaving and joining in the middle of a match ----
  const cleoCar = car(p3);
  bus.disconnect('c3'); await sleep(80);
  check(w.eval('active') !== null && cleoCar.bot && cleoCar.id < 0 && st().cars.length === 4 && calls.forget === 1, 'Cleo leaves: a bot drives her car on');
  const p4 = addPhone('c4');
  await sleep(100); join(p4, 'Dino'); await sleep(150);
  check(visible(p4.dom) === 'v-abpad' && p4.last('abState') && p4.last('abState').team === 0, 'Dino joins mid-match and gets the pad');
  check(cleoCar.id === p4.id && !cleoCar.bot && st().cars.length === 4, 'he takes over the bot\'s car in the team with fewer players');
  const p5 = addPhone('c5');
  await sleep(100); join(p5, 'Eva'); await sleep(150);
  check(st().cars.length === 4 && car(p5) && car(p5).team === 1 && !car(p5).bot && !st().cars.some(c => c.bot), 'Eva takes the last bot\'s car: now it is two real players against two');
  const p6 = addPhone('c6');
  await sleep(100); join(p6, 'Finn'); await sleep(150);
  check(st().cars.length === 5 && car(p6) && car(p6).team === 0 && visible(p6.dom) === 'v-abpad', 'no bot left: Finn gets a new car');
  p4.send({ t: 'abStick', x: -1, y: 0 });
  check(car(p4).ix === -1, 'the latecomer drives');

  // ---- phone reload ----
  const n0 = p2.all('abState').length;
  p2.send({ t: 'shellSync' }); await sleep(60);
  check(p2.all('abState').length > n0 && visible(p2.dom) === 'v-abpad', 'shellSync → back on the pad with the current state');

  // ---- the end ----
  st().clock = 400;
  await until(() => st().phase === 'over', 3000, 'over');
  await sleep(30);
  check(st().winner === 0 && calls.events.includes('over'), 'time is up at 1 : 0: team Orange wins');
  check(reported.length === 1 && reported[0].slice().sort().join() === [p1.id, p4.id, p6.id].sort().join(), 'the winning team\'s players are reported for the evening');
  check(p1.last('abState').won === true && p2.last('abState').won === false && /gewonnen/.test(p1.$('abStatus').textContent) && /Verloren/.test(p2.$('abStatus').textContent), 'the phones know who won');
  check(p1.$('abAgain').style.display === 'block' && p2.$('abAgain').style.display === 'none', 'only the host gets the rematch button');

  // ---- rematch → team selection again ----
  p2.send({ t: 'abAgain' }); await sleep(40);
  check(dbg().phase === 'match', 'abAgain from a guest is ignored');
  p1.$('abAgain').click(); await sleep(80);
  check(dbg().phase === 'teams' && [p1, p2, p4, p5, p6].every(p => visible(p.dom) === 'v-abteams'), 'the host\'s rematch goes back to the team selection');
  check(w.document.getElementById('c').style.display === '' && calls.clear === 1, 'the shell canvas is back, the scene is freed');
  check(p1.last('abTeams').lists[0].length === 3 && p1.last('abTeams').lists[1].length === 3, 'three against two: one bot will fill up');
  p1.$('abStart').click(); await sleep(100);
  check(dbg().phase === 'match' && calls.made === 1 && calls.setRound === 2 && st().score.join(':') === '0:0', 'second match: same view, fresh score');

  // ---- abort; without bots both teams need a car ----
  p1.$('abortBtn').click(); await sleep(150);
  check(w.eval('active') === null && visible(p1.dom) === 'v-shelllobby', 'abort → lobby');
  for (const l of ['c4', 'c5', 'c6']) bus.disconnect(l);
  await sleep(80);
  p1.send({ t: 'shellConfig', game: 'autoball', cfg: { minutes: 2, arena: 'neon', bots: 'off' } });
  await sleep(40);
  p1.$('startBtn').click(); await sleep(150);
  check(dbg().phase === 'teams' && p1.last('abTeams').lists.map(l => l.join()).join('|') === 'Anna|Ben', 'bots off: no bots in the lists');
  p2.$('abSwitch').click(); await sleep(40);
  check(p1.last('abTeams').canStart === false && p1.$('abStart').disabled === true, 'everybody in one team: no kickoff');
  p1.$('abStart').click(); await sleep(60);
  check(dbg().phase === 'teams', 'and the button does nothing');
  p2.$('abSwitch').click(); await sleep(40);
  p1.$('abStart').click(); await sleep(100);
  check(dbg().phase === 'match' && st().cars.length === 2 && !st().cars.some(c => c.bot), 'one against one without bots');

  // ---- everybody leaves ----
  bus.disconnect('c2'); await sleep(80);
  check(w.eval('active') !== null && st().cars.find(c => c.team === 1).bot, 'Ben leaves: a bot stands in, Anna plays on');
  bus.disconnect('c1'); await sleep(100);
  check(w.eval('active') === null, 'nobody left → back to the lobby');

  // ---- no WebGL: the game refuses politely ----
  const bus2 = makeBus();
  const screen2 = makeDom('screen.html', 'screen', bus2, 'screen');
  const ca = makeDom('controller.html', 'controller', bus2, 'a');
  await sleep(100);
  ca.window.document.getElementById('nameInput').value = 'Eva'; ca.window.document.getElementById('joinBtn').click();
  await sleep(100);
  [...ca.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '⚽ Autoball').click(); await sleep(60);
  ca.window.document.getElementById('startBtn').click(); await sleep(150);
  check(screen2.window.eval('active') === null && visible(ca) === 'v-shelllobby', 'without three.js the match does not start and everybody is back in the lobby');

  console.log(process.exitCode ? '❌ Autoball-Flow fehlgeschlagen' : '✅ Alle Autoball-Flow-Checks bestanden');
  process.exit(process.exitCode || 0);
})();
