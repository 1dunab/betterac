// Würfelverlies end-to-end: real shell + real phones in JSDOM. Lobby, bag choice, rolling by tapping dice, summoning,
// placing, moving, an attack with the defender's prompt, a phone that drops out (a bot takes over), game over, rematch.
const { makeDom, makeBus } = require('./test-helpers');
const R = require('./public/games/verlies/rules.js');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(5); }
  fail('Timeout: ' + what); return false;
}

const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const cs = {};
for (const l of ['c1', 'c2', 'c3']) {
  cs[l] = makeDom('controller.html', 'controller', bus, l);
  const h = bus.handlers[l], orig = h.deliver; h.inbox = [];
  h.deliver = (m) => { if (m.type === 'message') h.inbox.push(m.data); orig(m); };
}
const phone = (l) => ({
  l, get id() { return bus.handlers[l]._id; }, dom: cs[l],
  $: (id) => cs[l].window.document.getElementById(id),
  q: (sel) => cs[l].window.document.querySelector(sel), qa: (sel) => [...cs[l].window.document.querySelectorAll(sel)],
  all: (t) => bus.handlers[l].inbox.filter((m) => m.t === t),
  last(t) { return this.all(t).pop(); },
  send: (data) => bus.fromClient(l, JSON.stringify({ type: 'message', to: 0, data })),
  click(sel) { const b = this.q(sel); if (!b) { fail('kein Knopf ' + sel + ' bei ' + l); return false; } b.click(); return true; }
});

(async () => {
  await sleep(100);
  const w = screen.window;
  w.VL_TIME_SCALE = 0.04;                       // bag countdown, bot pauses, defence time: 25× faster
  const reported = [], origReport = w.reportWinners;
  w.reportWinners = (ids) => { reported.push(ids.slice()); origReport(ids); };
  const [p1, p2, p3] = ['c1', 'c2', 'c3'].map(phone);
  for (const [p, name] of [[p1, 'Anna'], [p2, 'Ben']]) { p.$('nameInput').value = name; p.$('joinBtn').click(); }
  await sleep(100);
  const btn = p1.qa('#gamePicker button').find((b) => b.textContent === '🎲 Würfelverlies');
  check(!!btn, 'Würfelverlies steht im Spiele-Picker');
  btn.click(); await sleep(40);
  p1.send({ t: 'shellConfig', game: 'verlies', cfg: { bots: 1, zugzeit: '0', feld: '15', herzen: 2 } });
  await sleep(40);
  p1.$('startBtn').click();
  await sleep(120);
  const dbg = () => w.eval('active && active._debug()');
  check(dbg() && dbg().phase === 'prep', 'Start → Beutelwahl');
  check(dbg().seats.length === 3 && dbg().seats[2].bot && dbg().seats[0].color === '#ff3b4e' && dbg().seats[1].color === '#2f8bff' && dbg().seats[2].color === '#2fd36a', '2 Menschen + 1 Bot: Rot, Blau, Grün');
  check(dbg().prep.bags[2] && !dbg().prep.bags[0], 'der Bot hat schon einen Beutel, die Menschen noch nicht');
  check(w.document.querySelector('#vlWrap canvas') && w.document.getElementById('c').style.display === 'none', 'Vollbild-Canvas des Spiels ersetzt die Shell-Leinwand');
  const s1 = p1.last('vlState');
  check(s1 && s1.phase === 'prep' && s1.me === 0 && s1.host === true && p2.last('vlState').me === 1 && p2.last('vlState').host === false, 'vlState: Phase, eigener Platz, Host-Flag');
  check(p1.qa('[data-bag]').length === 4, 'Handy zeigt 4 Beutel zur Wahl');
  p1.click('[data-bag="glut"]'); p2.click('[data-bag="tiefe"]');
  await sleep(30);
  check(dbg().prep.bags[0] === 'glut' && dbg().prep.bags[1] === 'tiefe', 'Beutelwahl per Tipp kommt an');
  await until(() => dbg().phase === 'play', 3000, 'alle Beutel → Spielbeginn');
  const st = () => dbg().st;
  check(st().w === 15 && st().n === 3 && st().cfg.hearts === 2 && st().seats[0].bag === 'glut', 'Brett 15×15, 3 Meister, 2 Herzen, Beutel übernommen');

  // ---- Anna's turn (if Ben starts, he rolls and passes) ----
  const benPasses = () => {
    if (st().turn.seat !== 1 || st().turn.pending) return;
    if (st().turn.stage === 'roll') p2.send({ t: 'vlRoll', dice: R.freeDice(st(), 1).slice(0, 3) });
    if (st().turn.stage === 'summon') p2.send({ t: 'vlPick', die: null });
    if (st().turn.stage === 'act') p2.send({ t: 'vlEnd' });
  };
  await until(() => { benPasses(); return st().turn.seat === 0 && st().turn.stage === 'roll' && !st().turn.pending; }, 15000, 'Anna ist dran');
  await sleep(20);
  check(p1.last('vlBuzz') !== undefined, 'Zugbeginn: das Handy brummt');
  check(p1.qa('[data-die]').length === 15, 'Würfelpool: 15 Würfel antippbar');
  check(p1.q('[data-roll]').disabled, 'Werfen erst mit 3 Würfeln');
  for (const k of [0, 1, 2]) p1.click('[data-die="' + k + '"]');
  check(!p1.q('[data-roll]').disabled && /74 %/.test(p1.$('vlMain').textContent), '3 Funkenwichte gewählt: Werfen frei, Chance 74 %');
  // a seed where two stars come up
  for (let seed = 1; seed < 3000; seed++) {
    const c = JSON.parse(JSON.stringify(st())); c.rng = seed;
    const r = R.roll(c, 0, [0, 1, 2]);
    if (r.ok && r.ev[0].opts.length >= 2) { st().rng = seed; break; }
  }
  p1.click('[data-roll]');
  await sleep(30);
  check(st().turn.stage === 'summon' && st().turn.roll.level === 1, 'Wurf: Beschwörung Stufe 1');
  check(p1.$('vlRoll').classList.contains('on') && p1.qa('#vlCubes .vlcube').length === 3, 'Handy zeigt die 3 rollenden Würfel');
  p1.click('#vlRollOk');
  check(p1.qa('[data-pick]').length >= 3, 'Beschwörungskarten + „Nicht beschwören“');
  p1.click('[data-pick]:not([data-pick="none"])');
  await sleep(30);
  check(st().turn.stage === 'place', 'Monster gewählt → Verlies-Stück platzieren');
  check(dbg().preview && dbg().preview.ok && dbg().preview.anchors.length > 0, 'Handy schickt einen gültigen Vorschlag, der Fernseher zeigt die Vorschau');
  p1.click('[data-mv="1,0"]'); p1.click('[data-rot="rot"]'); await sleep(20);
  check(dbg().preview.cells.length === 6, 'Verschieben und Drehen erreichen die Vorschau');
  p1.click('[data-suggest]'); await sleep(20);
  check(dbg().preview.ok, '💡 springt auf einen gültigen Platz');
  p1.click('[data-place]'); await sleep(30);
  const mine = () => st().mons.filter((m) => m.seat === 0);
  check(mine().length === 1 && mine()[0].key === 'funke' && st().turn.stage === 'act' && st().seats[0].dice.filter((d) => d.used).length === 1, 'Funkenwicht steht im Verlies, sein Würfel ist verbraucht');
  check(dbg().log.some((l) => /ruft Funkenwicht/.test(l.text)), 'Chronik: „Anna ruft Funkenwicht“');

  // ---- moving ----
  const m = mine()[0];
  st().seats[0].crests.MOV = 3; st().seats[0].crests.ATK = 2;
  p1.send({ t: 'vlHello' }); await sleep(20);
  check(p1.qa('[data-act="move"]:not([disabled])').length === 1, 'Aktionsmenü: Bewegen ist frei');
  p1.click('[data-act="move"]'); await sleep(20);
  check(dbg().sel && dbg().sel.mode === 'move' && dbg().sel.mon === m.id, 'Bewegen gewählt: der Fernseher zeigt die Reichweite');
  const reach = [...R.reach(st(), m).keys()];
  check(reach.length > 0, 'es gibt erreichbare Felder');
  p1.send({ t: 'vlMove', mon: m.id, to: 0 }); await sleep(20);
  check(/kommt es nicht hin/.test((p1.last('vlToast') || {}).text || ''), 'unerreichbares Ziel: Fehlermeldung aufs Handy');
  const to = reach[0], cost = R.reach(st(), m).get(to).cost;
  p1.send({ t: 'vlMove', mon: m.id, to }); await sleep(20);
  check(m.at === to && st().seats[0].crests.MOV === 3 - cost, 'Ziehen kommt an, 👣 werden abgezogen');

  // ---- attack and the defender's answer ----
  const free = R.nbrs(st(), m.at).find((j) => st().kind[j] === R.EMPTY);
  st().kind[free] = R.PATH; st().owner[free] = 1;
  st().mons.push({ id: 900, key: 'krabbe', seat: 1, at: free, hp: 10, maxHp: 10, atk: 10, def: 20, moves: 0, attacked: false, extra: 0, atkBuff: 0, used: {}, frozenNow: false, rootNow: false, frozenNext: false, rootNext: false });
  st().seats[1].crests.DEF = 1;
  p1.send({ t: 'vlHello' }); await sleep(20);
  p1.click('[data-act="attack"]'); await sleep(20);
  check(p1.qa('[data-tgt]').length === 1 && /Riffkrabbe/.test(p1.q('[data-tgt]').textContent), 'Angreifen: Ziel-Liste mit Schadensvorschau');
  p1.click('[data-tgt="0"]'); await sleep(30);
  check(st().turn.pending && st().turn.pending.seat === 1 && st().seats[0].crests.ATK === 1, 'Angriff wartet auf Ben');
  check(p2.$('vlModal').classList.contains('on') && p2.qa('[data-def]').length === 2, 'Bens Handy: Abwehr-Dialog mit Einstecken / Abwehren');
  p1.click('[data-end]'); await sleep(10);
  check(st().turn.seat === 0, 'Zugende geht nicht, solange die Abwehr offen ist');
  p2.click('[data-def="defend"]'); await sleep(30);
  const crab = st().mons.find((x) => x.id === 900);
  check(!st().turn.pending && crab && crab.hp === 10 && st().seats[1].crests.DEF === 0, 'Abwehr: 20 − 20 = 0 Schaden, 🛡️ bezahlt');
  check(!p2.$('vlModal').classList.contains('on'), 'Dialog schließt sich');

  // ---- end of turn, Ben drops out ----
  p1.send({ t: 'vlHello' }); await sleep(20);
  p1.click('[data-end]'); await sleep(10);
  if (st().turn.seat === 0) { p1.click('[data-end]'); await sleep(20); }
  check(st().turn.seat !== 0, 'Zug beendet → der Nächste ist dran');
  bus.disconnect('c2'); await sleep(20);
  check(dbg().seats[1].offline && dbg().log.some((l) => /Ben ist weg/.test(l.text)), 'Ben ist weg: ein Bot spielt für ihn');
  await until(() => st().turn.seat === 0 && !st().turn.pending, 20000, 'Bots spielen Ben und Grün weiter, bis Anna wieder dran ist');
  check(st().turn.round >= 2, 'Runde ' + st().turn.round);

  // ---- game over: Anna's monsters next to both masters, one heart each ----
  const g = st();
  g.turn.stage = 'act';
  const put = (dm, key) => {
    const j = R.nbrs(g, dm).find((k) => !R.monAt(g, k) && g.kind[k] !== R.MASTER);
    g.kind[j] = R.PATH; if (g.owner[j] < 0) g.owner[j] = 0;
    g.mons.push({ id: 950 + dm, key, seat: 0, at: j, hp: 20, maxHp: 20, atk: 20, def: 0, moves: 0, attacked: false, extra: 0, atkBuff: 0, used: {}, frozenNow: false, rootNow: false, frozenNext: false, rootNext: false });
    return 950 + dm;
  };
  g.seats[1].hearts = 1; g.seats[2].hearts = 1; g.seats[0].crests.ATK = 5;
  const a1 = put(g.seats[1].dm, 'kaefer'), a2 = put(g.seats[2].dm, 'kaefer');
  p1.send({ t: 'vlHello' }); await sleep(20);
  p1.click('[data-act="attack"][data-mon="' + a1 + '"]'); await sleep(20);
  const dmBtn = p1.qa('[data-tgt]').findIndex((b) => /Meister/.test(b.textContent));
  check(dmBtn >= 0, 'Ziel „Meister von Ben“ in der Liste');
  p1.click('[data-tgt="' + dmBtn + '"]'); await sleep(30);
  check(!st().seats[1].alive && !st().over, 'Bens Meister fällt, das Spiel geht weiter');
  p1.click('[data-act="attack"][data-mon="' + a2 + '"]'); await sleep(20);
  p1.click('[data-tgt="' + p1.qa('[data-tgt]').findIndex((b) => /Meister/.test(b.textContent)) + '"]'); await sleep(40);
  check(st().over && st().over.winners.join() === '0' && dbg().phase === 'over', 'Grüns Meister fällt: Anna gewinnt');
  check(reported.length === 1 && reported[0].join() === String(p1.id), 'reportWinners mit Annas id');
  check(/Gewonnen/.test(p1.$('vlMain').textContent) && p1.q('[data-again]'), 'Anna sieht „Gewonnen“ und als Host „Nochmal“');
  p1.click('[data-again]'); await sleep(30);
  check(dbg().phase === 'prep' && !dbg().prep.bags[0], 'Nochmal → neue Beutelwahl');

  // ---- a third phone joins: it watches ----
  p3.$('nameInput').value = 'Cleo'; p3.$('joinBtn').click(); await sleep(40);
  check(bus.handlers.c3.inbox.some((m) => m.t === 'shell' && m.cmd === 'spectate'), 'wer mitten im Spiel kommt, schaut zu');

  // ---- the host ends it ----
  p1.send({ t: 'shellAbort' }); await sleep(40);
  check(!w.eval('active') && !w.document.querySelector('#vlWrap canvas') && w.document.getElementById('c').style.display === '', 'Abbruch: Spiel-Canvas weg, Shell-Leinwand zurück');
  console.log(process.exitCode ? '❌ Würfelverlies-Flow fehlgeschlagen' : '✅ Würfelverlies-Flow ok');
  process.exit(process.exitCode || 0);
})();
