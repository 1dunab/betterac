// Würfelverlies rules: data, dice, placement, movement, combat, abilities, traps, elimination, victory, bots (Node only)
const D = require('./public/games/verlies/data.js');
const R = require('./public/games/verlies/rules.js');
const B = require('./public/games/verlies/bots.js');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }

// ---------- helpers: a board set up by hand ----------
function game(bags, opts) { return R.newGame(Object.assign({ seats: bags.map((bag) => ({ bag })), seed: 7 }, opts || {})); }
function path(st, s, cells) { for (const [x, y] of cells) { const i = R.idx(st, x, y); st.kind[i] = R.PATH; st.owner[i] = s; st.piece[i] = 99; } }
function mon(st, key, s, x, y) {
  const d = D.MONSTERS[key];
  const m = { id: st.nextId++, key, seat: s, at: R.idx(st, x, y), hp: d.hp, maxHp: d.hp, atk: d.atk, def: d.def, moves: 0, attacked: false, extra: 0, atkBuff: 0, used: {}, frozenNow: false, rootNow: false, frozenNext: false, rootNext: false };
  st.mons.push(m); return m;
}
function act(st) { st.turn.stage = 'act'; }
const at = (st, x, y) => R.idx(st, x, y);
const clone = (st) => JSON.parse(JSON.stringify(st));
// try seeds until a roll gives what we want
function rollWhere(st, s, dice, want) {
  for (let seed = 1; seed < 5000; seed++) {
    const c = clone(st); c.rng = seed;
    const r = R.roll(c, s, dice);
    if (r.ok && want(r.ev[0], c)) return { st: c, ev: r.ev[0] };
  }
  return null;
}

// ---------- data ----------
check(D.NETS.length === 11, '11 Würfelnetze');
// fold each net: roll a cube from cell to cell; a real net touches every face exactly once
function folds(cells) {
  const key = (x, y) => x + ',' + y, set = new Set(cells.map(([x, y]) => key(x, y))), down = {};
  const opp = (f) => 5 - f, q = [[cells[0][0], cells[0][1], 0, 1, 2]];
  down[key(cells[0][0], cells[0][1])] = 0;
  while (q.length) {
    const [x, y, d, n, e] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = key(x + dx, y + dy);
      if (!set.has(k) || k in down) continue;
      let nd, nn = n, ne = e;
      if (dx === 1) { nd = e; ne = opp(d); } else if (dx === -1) { nd = opp(e); ne = d; } else if (dy === 1) { nd = opp(n); nn = d; } else { nd = n; nn = opp(d); }
      down[k] = nd; q.push([x + dx, y + dy, nd, nn, ne]);
    }
  }
  const faces = Object.values(down);
  return faces.length === 6 && new Set(faces).size === 6;
}
check(D.NETS.every((n) => n.cells.length === 6 && folds(n.cells)), 'jedes Netz faltet sich zu einem Würfel (6 verschiedene Seiten)');
const canon = (cells) => { const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]), mx = Math.min(...xs), my = Math.min(...ys); return cells.map(([x, y]) => (x - mx) + ',' + (y - my)).sort().join(' '); };
const formOf = {}; let clash = false;
D.ORIENT.forEach((list, i) => list.forEach((o) => { const k = canon(o.cells); if (k in formOf && formOf[k] !== i) clash = true; formOf[k] = i; }));
check(!clash, 'keine zwei Netze sind gedreht oder gespiegelt gleich');
check(D.ORIENT.every((l) => l.length >= 2 && l.every((o) => o.cells.some(([x, y]) => x === 0 && y === 0))), 'jede Lage enthält das Beschwörungsfeld (0,0)');

let diceOk = true, bagsOk = true;
for (const key in D.MONSTERS) {
  const m = D.MONSTERS[key], f = D.facesOf(key);
  if (f.length !== 6 || f.filter((x) => x.c === 'SUM').length !== 5 - m.level || f.some((x) => D.CRESTS.indexOf(x.c) < 0 || x.n < 1 || x.n > 3)) { diceOk = false; fail('Würfel ' + key); }
  if (m.kind === 'monster' && (m.atk % 10 || m.def % 10 || m.hp % 10 || m.hp < 10)) { diceOk = false; fail('Werte in Zehnern: ' + key); }
  for (const ab of m.abil) if (!D.ABIL[ab]) { diceOk = false; fail('Fähigkeit fehlt: ' + ab); }
  if (m.kind === 'item' && !D.ITEMS[m.item]) diceOk = false;
  if (!m.art || !m.name || !m.lore) diceOk = false;
}
check(diceOk, 'jeder Würfel: 6 feste Seiten, 5 − Stufe Beschwörungsseiten, Werte in Zehnern, Fähigkeiten vorhanden');
check(D.facesOf('funke').filter((x) => x.c === 'SUM').length === 4 && D.facesOf('drache').filter((x) => x.c === 'SUM').length === 1, 'Stufe 1: 4 ⭐-Seiten, Stufe 4: 1 ⭐-Seite');
check(JSON.stringify(D.facesOf('hund')) === JSON.stringify(D.facesOf('hund')) && D.facesOf('hund').some((x) => x.c === 'MOV' && x.n === 2), 'Seiten sind fest (Mehrfach-Wappen wie 👣×2)');
for (const k of D.BAG_KEYS) {
  const lv = [0, 0, 0, 0, 0];
  D.BAGS[k].dice.forEach((key) => { lv[D.MONSTERS[key].level]++; });
  if (D.BAGS[k].dice.length !== 15 || lv[1] !== 5 || lv[2] !== 5 || lv[3] !== 3 || lv[4] !== 2) { bagsOk = false; fail('Beutel ' + k + ': ' + lv); }
}
check(bagsOk, 'vier Beutel à 15 Würfel: 5× Stufe 1, 5× Stufe 2 (mit Gegenstand), 3× Stufe 3, 2× Stufe 4');

// ---------- new games ----------
const g2 = game(['glut', 'wild']), g3 = game(['glut', 'wild', 'gebein']), g4 = game(['glut', 'wild', 'gebein', 'tiefe']);
check(g2.w === 15 && g3.w === 17 && g4.w === 19 && g4.h === 19, 'Feldgröße passend: 15 / 17 / 19, quadratisch');
const pos = (st, s) => [R.X(st, st.seats[s].dm), R.Y(st, st.seats[s].dm)];
check(pos(g2, 0)[1] === 14 && pos(g2, 1)[1] === 0 && pos(g2, 0)[0] === pos(g2, 1)[0], '2 Spieler: Meister unten und oben, gegenüber');
check(pos(g4, 0)[1] === 18 && pos(g4, 1)[1] === 0 && pos(g4, 2)[0] === 0 && pos(g4, 3)[0] === 18, '4 Spieler: unten, oben, links, rechts');
const d3 = [[0, 1], [1, 2], [0, 2]].map(([a, b]) => Math.hypot(pos(g3, a)[0] - pos(g3, b)[0], pos(g3, a)[1] - pos(g3, b)[1]));
check(Math.max(...d3) - Math.min(...d3) <= 3, '3 Spieler: fast gleich weit auseinander (' + d3.map((d) => d.toFixed(1)).join(' / ') + ')');
check(g4.seats.every((s) => s.hearts === 3 && s.dice.length === 15 && D.POOL.every((c) => s.crests[c] === 0)), 'jeder startet mit 3 Herzen, 15 Würfeln, leerem Wappenlager');
check(R.newGame({ seats: [{ bag: 'glut' }, { bag: 'wild' }, { bag: 'glut' }], first: 2 }).turn.seat === 2, 'Startspieler wählbar');

// ---------- placement ----------
{
  const st = game(['glut', 'wild']), [mx, my] = pos(st, 0);
  check(!R.canPlace(st, 0, R.pieceCells(st, 4, 0, mx, my + 1)).ok && R.canPlace(st, 0, R.pieceCells(st, 4, 0, mx, my + 1)).why === 'out', 'Stück über den Rand: ungültig');
  check(R.canPlace(st, 0, R.pieceCells(st, 4, 0, mx, my - 2)).ok, 'Kreuz direkt am eigenen Meister: gültig');
  check(R.canPlace(st, 0, R.pieceCells(st, 4, 0, mx, my - 6)).why === 'alone', 'Stück ohne Verbindung zum eigenen Weg: ungültig');
  check(!R.canPlace(st, 1, R.pieceCells(st, 4, 0, mx, my - 2)).ok, 'am fremden Meister darf man nicht anlegen');
  st.turn.stage = 'place'; st.turn.chosen = 0; st.turn.roll = { opts: [0, 1] };
  const r = R.place(st, 0, 4, 0, mx, my - 2);
  check(r.ok && st.mons.length === 1 && st.mons[0].at === at(st, mx, my - 2) && st.seats[0].dice[0].used && st.turn.stage === 'act', 'Platzieren: 6 Wegfelder, Monster auf dem Mittelfeld, Würfel verbraucht');
  check(st.kind.filter((k) => k === R.PATH).length === 6, 'genau 6 neue Wegfelder');
  check(R.canPlace(st, 0, R.pieceCells(st, 4, 0, mx, my - 3)).why === 'taken', 'Überlappung mit einem Weg: ungültig');
  check(R.validAnchors(st, 0, 0, 0).length > 0 && R.anyPlacement(st, 0), 'gültige Plätze werden gefunden');
}

// ---------- rolling and summoning ----------
{
  const st = game(['glut', 'wild']); st.turn.seat = 0;
  check(!R.roll(st, 0, [0, 1]).ok && !R.roll(st, 0, [0, 0, 1]).ok && !R.roll(st, 1, [0, 1, 2]).ok, 'Würfeln: genau 3 verschiedene eigene Würfel, nur wer dran ist');
  const s = rollWhere(st, 0, [0, 1, 2], (e) => e.dice.filter((d) => d.c === 'SUM').length >= 2);
  check(s && s.st.turn.stage === 'summon' && s.ev.level === 1 && s.ev.opts.length >= 2, 'zwei ⭐ Stufe 1 → Beschwörung möglich');
  const n = rollWhere(st, 0, [0, 5, 10], (e) => e.dice.filter((d) => d.c === 'SUM').length >= 2);
  check(!n || n.ev.opts.length === 0, 'drei ⭐ verschiedener Stufen → keine Beschwörung');
  const one = rollWhere(st, 0, [0, 1, 2], (e) => e.dice.filter((d) => d.c === 'SUM').length === 1);
  const gained = one && D.POOL.reduce((a, c) => a + one.st.seats[0].crests[c], 0);
  check(one && one.st.turn.stage === 'act' && gained === one.ev.dice.filter((d) => d.c !== 'SUM').reduce((a, d) => a + d.n, 0), 'ohne Paar: Wappen ins Lager, weiter zu den Aktionen');
  const c = clone(st); c.cfg.cap = 2; c.seats[0].crests.MOV = 2;
  const capped = rollWhere(c, 0, [5, 6, 7], (e) => e.dice.some((d) => d.c === 'MOV'));
  check(capped && capped.st.seats[0].crests.MOV === 2 && capped.ev.lost.MOV > 0, 'Lagergrenze: überzählige Wappen verfallen');
  if (s) {
    const x = s.st, die = x.turn.roll.opts[0];
    check(!R.summon(x, 0, 9).ok && R.summon(x, 0, die).ok && x.turn.stage === 'place', 'nur gewürfelte Paar-Würfel sind beschwörbar');
    check(R.unchoose(x, 0).ok && x.turn.stage === 'summon' && R.summon(x, 0, null).ok && x.turn.stage === 'act', 'Zurück und Verzicht möglich');
    check(!x.seats[0].dice[die].used, 'Verzicht verbraucht keinen Würfel');
  }
  const u = clone(st); u.seats[0].dice[0].used = true;
  check(!R.roll(u, 0, [0, 1, 2]).ok, 'verbrauchte Würfel lassen sich nicht mehr werfen');
  const few = clone(st); few.seats[0].dice.forEach((d, k) => { d.used = k > 1; });
  check(R.roll(few, 0, [0, 1]).ok, 'mit nur 2 übrigen Würfeln wirft man 2');
  const none = clone(st); none.seats[0].dice.forEach((d) => { d.used = true; }); none.turn.seat = 1; R.endTurn(none, 1);
  check(none.turn.seat === 0 && none.turn.stage === 'act', 'ohne Würfel geht es direkt zu den Aktionen');
}

// ---------- movement ----------
{
  const st = game(['glut', 'wild']); act(st);
  path(st, 0, [[2, 7], [3, 7], [4, 7], [5, 7], [6, 7]]); path(st, 1, [[7, 7], [8, 7]]); path(st, 0, [[3, 8]]);
  const m = mon(st, 'funke', 0, 2, 7);
  st.seats[0].crests.MOV = 10;
  const r = R.reach(st, m);
  check(r.has(at(st, 6, 7)) && r.get(at(st, 6, 7)).cost === 4 && r.has(at(st, 8, 7)), 'Bewegung entlang der Wege, auch über fremde Wege');
  check(!r.has(at(st, 3, 6)) && !r.has(at(st, 4, 8)), 'keine leeren Felder, keine Diagonalen');
  const e = mon(st, 'moos', 1, 5, 7);
  check(!R.reach(st, m).has(at(st, 6, 7)), 'ein feindliches Monster blockiert den Weg');
  const own = mon(st, 'kaefer', 0, 4, 7);
  check(R.reach(st, m).has(at(st, 3, 8)) && !R.reach(st, m).has(at(st, 4, 7)), 'durch eigene Monster hindurch, aber nicht darauf');
  st.mons.splice(st.mons.indexOf(own), 1); st.mons.splice(st.mons.indexOf(e), 1);
  const fly = mon(st, 'fee', 0, 3, 8); st.mons.push(Object.assign({}, e, { id: 77, at: at(st, 4, 7) }));
  check(R.reach(st, fly).has(at(st, 5, 7)), 'Flug: über Monster hinweg');
  st.mons = st.mons.filter((x) => x.id !== 77 && x !== fly);
  st.seats[0].crests.MOV = 3;
  check(!R.reach(st, m).has(at(st, 6, 7)) && R.reach(st, m).has(at(st, 5, 7)), 'nicht weiter als die 👣 reichen');
  const fx = mon(st, 'fuchs', 0, 8, 7); st.seats[0].crests.MOV = 1;
  check(R.reach(st, fx).has(at(st, 6, 7)) && R.reach(st, fx).get(at(st, 6, 7)).cost === 1, 'Flink: 2 Felder für 1 👣');
  st.seats[0].crests.MOV = 10;
  check(R.move(st, 0, m.id, at(st, 5, 7)).ok && st.seats[0].crests.MOV === 7 && m.at === at(st, 5, 7), 'Ziehen kostet 👣 pro Feld');
  check(!R.move(st, 0, m.id, at(st, 4, 7)).ok, 'jedes Monster zieht nur einmal pro Zug');
  check(!R.move(st, 1, fx.id, at(st, 7, 7)).ok, 'fremde Monster lassen sich nicht ziehen');
  st.seats[0].crests.MOV = 0;
  check(!R.canMove(st, fx) && !R.move(st, 0, fx.id, at(st, 7, 7)).ok && st.seats[0].crests.MOV === 0, 'ohne 👣 keine Bewegung, das Lager wird nie negativ');
}

// ---------- combat, defence, damage formula ----------
check(R.damage(30, 10, false, 'klassisch') === 30 && R.damage(30, 10, true, 'klassisch') === 20 && R.damage(10, 30, true, 'klassisch') === 0, 'Schaden klassisch: ohne Abwehr ATK, mit Abwehr ATK − DEF, nie negativ');
check(R.damage(30, 20, false, 'panzer') === 20 && R.damage(30, 20, true, 'panzer') === 10, 'Schaden gepanzert: DEF zählt immer halb');
check(R.damage(20, 30, true, 'kratzer') === 10 && R.damage(30, 10, false, 'kratzer') === 30, 'Schaden kratzer: mit Abwehr mindestens 10');
{
  const st = game(['glut', 'wild']); act(st);
  path(st, 0, [[3, 7], [4, 7]]); path(st, 1, [[5, 7], [6, 7]]);
  const a = mon(st, 'hund', 0, 4, 7), t = mon(st, 'baer', 1, 5, 7), far = mon(st, 'moos', 1, 6, 7);
  st.seats[0].crests.ATK = 3; st.seats[1].crests.DEF = 2;
  check(R.attackTargets(st, a).length === 1 && R.attackTargets(st, a)[0].mon === t.id, 'Angriff nur auf Nachbarn (orthogonal)');
  const r = R.attack(st, 0, a.id, { mon: t.id });
  check(r.ok && r.waiting && st.turn.pending && st.turn.pending.opts.indexOf('defend') >= 0 && st.seats[0].crests.ATK === 2, 'Angriff kostet 1 ⚔️ und wartet auf die Abwehr');
  check(!R.endTurn(st, 0).ok && !R.respond(st, 0, 'defend').ok, 'während der Abwehr: kein Zugende, nur der Verteidiger antwortet');
  R.respond(st, 1, 'defend');
  check(t.hp === 10 && st.seats[1].crests.DEF === 1 && !st.turn.pending, 'Abwehr: 30 − 20 = 10 Schaden, 1 🛡️ bezahlt');
  check(!R.attack(st, 0, a.id, { mon: t.id }).ok && !R.canMove(st, a), 'nur ein Angriff pro Zug, danach keine Bewegung');
  const b = mon(st, 'funke', 0, 3, 7);
  check(R.attackTargets(st, b).length === 0, 'zu weit weg: kein Ziel');
  const st2 = clone(st); const k2 = st2.mons.find((m) => m.key === 'baer'); k2.hp = 10; st2.mons.find((m) => m.key === 'hund').attacked = false; st2.seats[1].crests.DEF = 0;
  const r2 = R.attack(st2, 0, st2.mons.find((m) => m.key === 'hund').id, { mon: k2.id });
  check(r2.ok && !r2.waiting && !st2.mons.some((m) => m.key === 'baer') && r2.ev.some((e) => e.t === 'destroy'), 'ohne Abwehrmöglichkeit sofort: 0 LP → zerstört und vom Feld');
}
{
  // reach (Fangarme), thorns, lifesteal, counter, dodge, mirror
  const st = game(['tiefe', 'glut']); act(st);
  path(st, 0, [[3, 7], [4, 7]]); path(st, 1, [[5, 7], [6, 7]]);
  const k = mon(st, 'krake', 0, 4, 7), gol = mon(st, 'golem', 1, 6, 7);
  st.seats[0].crests.ATK = 5;
  check(R.attackTargets(st, k).some((t) => t.mon === gol.id), 'Fangarme: 2 Felder weit in gerader Linie');
  R.attack(st, 0, k.id, { mon: gol.id }); R.respond(st, 1, 'none');
  check(!st.mons.includes(gol), 'Krake trifft aus 2 Feldern: 30 Schaden, Golem zerstört');
  check(k.hp === 20, 'Glühende Haut: der Angreifer erleidet 10');
  const s3 = game(['gebein', 'glut']); act(s3); path(s3, 0, [[3, 7], [4, 7]]); path(s3, 1, [[5, 7]]);
  const rit = mon(s3, 'ritter', 0, 4, 7), vic = mon(s3, 'loewe', 1, 5, 7); rit.hp = 10; s3.seats[0].crests.ATK = 2;
  R.attack(s3, 0, rit.id, { mon: vic.id });
  check(rit.hp === 20 && !s3.mons.includes(vic), 'Lebensraub: +10 LP nach einem Treffer');
  const s4 = game(['glut', 'gebein']); act(s4); path(s4, 0, [[4, 7]]); path(s4, 1, [[5, 7]]);
  const h = mon(s4, 'hund', 0, 4, 7), w = mon(s4, 'wache', 1, 5, 7); s4.seats[0].crests.ATK = 3; s4.seats[1].crests.TRP = 5; s4.seats[1].crests.DEF = 1;
  R.attack(s4, 0, h.id, { mon: w.id });
  check(s4.turn.pending.opts.join() === 'none,defend,counter', 'Verteidiger sieht: einstecken, abwehren, Gegenschlag');
  R.respond(s4, 1, 'counter');
  check(h.hp === 10 && s4.seats[1].crests.TRP === 4, 'Gegenschlag: Angreifer −10, 1 🕸️ bezahlt');
  const s5 = game(['glut', 'gebein']); act(s5); path(s5, 0, [[4, 7]]); path(s5, 1, [[5, 7]]);
  const h5 = mon(s5, 'hund', 0, 4, 7), ir = mon(s5, 'irrlicht', 1, 5, 7); s5.seats[0].crests.ATK = 3; s5.seats[1].crests.TRP = 2;
  R.attack(s5, 0, h5.id, { mon: ir.id }); R.respond(s5, 1, 'dodge');
  check(ir.hp === 20 && s5.seats[1].crests.TRP === 0, 'Ausweichen: kein Schaden');
  const s6 = game(['glut', 'gebein']); act(s6); path(s6, 0, [[4, 7]]); path(s6, 1, [[5, 7]]);
  const h6 = mon(s6, 'loewe', 0, 4, 7), li = mon(s6, 'lich', 1, 5, 7); s6.seats[0].crests.ATK = 3; s6.seats[1].crests.TRP = 3;
  R.attack(s6, 0, h6.id, { mon: li.id }); R.respond(s6, 1, 'mirror');
  check(li.hp === 40 && !s6.mons.includes(h6), 'Spiegelschild: der Angreifer bekommt die 40 selbst ab');
  check(!R.respond(s6, 1, 'mirror').ok, 'kein Angriff offen → keine Antwort');
}

// ---------- the masters, elimination, victory ----------
{
  const st = game(['glut', 'wild']); act(st);
  const [mx, my] = pos(st, 1);
  path(st, 1, [[mx, my + 1], [mx, my + 2]]);
  const a = mon(st, 'funke', 0, mx, my + 1);
  st.seats[0].crests.ATK = 5;
  check(R.attackTargets(st, a).some((t) => t.dm === 1), 'ein Monster neben dem fremden Meister kann ihn angreifen');
  R.attack(st, 0, a.id, { dm: 1 });
  check(st.seats[1].hearts === 2 && !st.turn.pending, 'Treffer am Meister: −1 Herz, keine Abwehr');
  st.seats[1].hearts = 1; a.attacked = false;
  const r = R.attack(st, 0, a.id, { dm: 1 });
  check(!st.seats[1].alive && st.over && st.over.winners.join() === '0' && r.ev.some((e) => e.t === 'out') && r.ev.some((e) => e.t === 'over'), 'letztes Herz weg → ausgeschieden, letzter Spieler gewinnt');
}
{
  const st = game(['glut', 'wild', 'gebein']); act(st);
  const [mx, my] = pos(st, 1);
  path(st, 1, [[mx + 1, my], [mx + 2, my]]); path(st, 0, [[5, 9]]);
  const a = mon(st, 'funke', 0, mx + 1, my), b = mon(st, 'moos', 1, mx + 2, my), c = mon(st, 'ratte', 2, 5, 9);
  st.seats[0].crests.ATK = 5; st.seats[1].hearts = 1;
  R.attack(st, 0, a.id, { dm: 1 });
  check(!st.seats[1].alive && !st.over && !st.mons.includes(b), '3 Spieler: einer fällt, seine Monster verschwinden, das Spiel geht weiter');
  check(st.kind[at(st, mx + 2, my)] === R.PATH, 'seine Wege bleiben liegen (Standard)');
  R.endTurn(st, 0);
  check(st.turn.seat === 2, 'der Ausgeschiedene wird übersprungen');
  const s2 = game(['glut', 'wild', 'gebein'], { outMonsters: 'stay', outPaths: 'vanish' }); act(s2);
  path(s2, 1, [[mx + 1, my], [mx + 2, my], [mx + 3, my]]);
  const a2 = mon(s2, 'funke', 0, mx + 1, my), b2 = mon(s2, 'moos', 1, mx + 2, my); s2.seats[0].crests.ATK = 5; s2.seats[1].hearts = 1;
  R.attack(s2, 0, a2.id, { dm: 1 });
  check(b2.seat === -1 && s2.mons.includes(b2) && s2.kind[at(s2, mx + 3, my)] === R.EMPTY && s2.kind[at(s2, mx + 2, my)] === R.PATH, 'Option: Monster bleiben als wilde Hindernisse, Wege zerbröckeln (außer unter Monstern)');
  a2.attacked = false; s2.seats[0].crests.ATK = 5;
  check(R.attackTargets(s2, a2).some((t) => t.mon === b2.id), 'wilde Monster kann jeder angreifen');
  const s3 = game(['glut', 'wild', 'gebein'], { mode: 'first' }); act(s3);
  path(s3, 1, [[mx + 1, my]]); const a3 = mon(s3, 'funke', 0, mx + 1, my); s3.seats[0].crests.ATK = 1; s3.seats[1].hearts = 1;
  R.attack(s3, 0, a3.id, { dm: 1 });
  check(s3.over && s3.over.winners.join() === '0' && s3.over.why === 'first', 'Modus „erster Sturz“: wer einen Meister stürzt, gewinnt sofort');
}
{
  const st = game(['glut', 'wild', 'gebein', 'tiefe'], { mode: 'team' }); act(st);
  check(st.teams && st.seats[0].team === st.seats[1].team && st.seats[2].team === st.seats[3].team && st.seats[0].team !== st.seats[2].team, 'Teammodus: Rot & Blau gegen Grün & Violett');
  path(st, 0, [[5, 9], [6, 9], [7, 9]]);
  const a = mon(st, 'funke', 0, 5, 9), mate = mon(st, 'moos', 1, 6, 9);
  st.seats[0].crests.ATK = 3; st.seats[0].crests.MOV = 3;
  check(R.attackTargets(st, a).length === 0, 'Teammitglieder greift man nicht an');
  check(R.reach(st, a).has(at(st, 7, 9)), 'durch Monster des Partners hindurch');
  st.seats[2].alive = false; st.seats[3].hearts = 1;
  const [mx, my] = pos(st, 3); path(st, 3, [[mx - 1, my]]); const b = mon(st, 'ratte', 0, mx - 1, my);
  R.attack(st, 0, b.id, { dm: 3 });
  check(st.over && st.over.winners.sort().join() === '0,1' && st.over.why === 'team', 'Team gewinnt, wenn beide gegnerischen Meister fallen');
}
{
  const st = game(['glut', 'wild'], { roundLimit: 2 }); act(st);
  st.seats[1].hearts = 2;
  let guard = 0;
  while (!st.over && guard++ < 10) { act(st); R.endTurn(st, st.turn.seat); }
  check(st.over && st.over.why === 'limit' && st.over.winners.join() === '0', 'Rundenlimit: die meisten Herzen gewinnen');
}
{
  const st = game(['glut', 'wild', 'gebein']); st.turn.seat = 1;
  R.resign(st, 1);
  check(!st.seats[1].alive && st.turn.seat === 2 && !st.over, 'Aufgeben am Zug: Meister fällt, der Nächste ist dran');
}

// ---------- abilities ----------
{
  const st = game(['glut', 'wild']); act(st);
  path(st, 0, [[2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [3, 8]]); path(st, 1, [[7, 7], [8, 7]]);
  const hund = mon(st, 'hund', 0, 2, 7), hexe = mon(st, 'hexe', 0, 3, 8), foe = mon(st, 'baer', 1, 6, 7);
  st.seats[0].crests.MOV = 10; st.seats[0].crests.MAG = 10;
  R.move(st, 0, hund.id, at(st, 3, 7));
  check(R.abilityBlock(st, hund, 'sprint') === '' && R.useAbility(st, 0, hund.id, 'sprint', {}).ok && R.move(st, 0, hund.id, at(st, 4, 7)).ok, 'Sprint: ein zweites Mal ziehen');
  check(R.abilityBlock(st, hund, 'sprint') !== '', 'jede Fähigkeit nur einmal pro Zug');
  check(R.abilityTargets(st, hexe, 'bolt').some((t) => t.mon === foe.id) === (R.dist(st, hexe.at, foe.at) <= 3), 'Feuerball: Reichweite 3');
  hexe.at = at(st, 4, 8); path(st, 0, [[4, 8]]);
  const before = foe.hp; R.useAbility(st, 0, hexe.id, 'bolt', { mon: foe.id });
  check(foe.hp === before - 10 && st.seats[0].crests.MAG === 7, 'Feuerball: 10 Schaden ohne Abwehr, 2 ✨');
  check(!R.useAbility(st, 0, hexe.id, 'heal', { mon: hexe.id }).ok, 'Fähigkeiten, die das Monster nicht hat, gehen nicht');
}
{
  const st = game(['wild', 'tiefe']); act(st);
  path(st, 0, [[2, 7], [3, 7], [4, 7], [5, 7]]); path(st, 1, [[6, 7], [7, 7]]);
  const fee = mon(st, 'fee', 0, 2, 7), baer = mon(st, 'baer', 0, 3, 7), wur = mon(st, 'wurzel', 0, 4, 7), foe = mon(st, 'hai', 1, 6, 7);
  st.seats[0].crests.MAG = 20; baer.hp = 0 + 5;
  R.useAbility(st, 0, fee.id, 'heal', { mon: baer.id });
  check(baer.hp === 20, 'Heilung: +20 LP, nicht über das Maximum');
  R.useAbility(st, 0, wur.id, 'root', { mon: foe.id });
  check(foe.rootNext, 'Wurzelgriff: Ziel ist für den nächsten Zug gefesselt');
  R.endTurn(st, 0); act(st); st.seats[1].crests.MOV = 5; st.seats[1].crests.ATK = 5; st.seats[1].crests.MAG = 2;
  check(st.turn.seat === 1 && foe.rootNow && !R.canMove(st, foe) && R.abilityBlock(st, foe, 'sprint') === '', 'gefesselt: kann sich im eigenen Zug nicht bewegen, aber zaubern');
  R.endTurn(st, 1);
  check(!foe.rootNow && !foe.rootNext, 'danach ist die Fessel weg');
  act(st); st.seats[0].crests.MAG = 20;
  const greif = mon(st, 'greif', 0, 5, 7); wur.hp = 10; baer.hp = 10;
  R.useAbility(st, 0, greif.id, 'aura', {});
  check(wur.hp === 30 && baer.hp === 20, 'Heilende Aura: alle eigenen Monster bis 2 Felder');
}
{
  const st = game(['tiefe', 'glut']); act(st);
  path(st, 0, [[2, 7], [3, 7], [9, 9]]); path(st, 1, [[4, 7], [5, 7]]);
  const mu = mon(st, 'muschel', 0, 3, 7), nixe = mon(st, 'nixe', 0, 2, 7), lev = mon(st, 'levi', 0, 9, 9), f1 = mon(st, 'funke', 1, 4, 7), f2 = mon(st, 'kaefer', 1, 5, 7);
  st.seats[0].crests.MAG = 20;
  R.useAbility(st, 0, mu.id, 'freeze', { mon: f1.id });
  R.endTurn(st, 0); act(st); st.seats[1].crests.ATK = 5; st.seats[1].crests.MOV = 5; st.seats[1].crests.TRP = 5;
  check(f1.frozenNow && !R.canAttack(st, f1) && !R.canMove(st, f1) && R.abilityBlock(st, f1, 'pit') === 'eingefroren', 'Frostbann: im nächsten Zug weder ziehen noch angreifen noch zaubern');
  R.endTurn(st, 1); act(st);
  const a0 = nixe.at, b0 = lev.at;
  R.useAbility(st, 0, nixe.id, 'swap', { mon: lev.id });
  check(nixe.at === b0 && lev.at === a0, 'Gezeitentausch: Plätze getauscht');
  R.useAbility(st, 0, lev.id, 'wave', {});
  check(!st.mons.includes(f1) && f2.hp === 20, 'Flutwelle: 10 an allen Feinden bis 2 Felder (der dritte steht zu weit weg)');
  const dr = game(['glut', 'wild']); act(dr); path(dr, 0, [[5, 5], [5, 6], [4, 5], [6, 5]]); path(dr, 1, [[5, 4]]);
  const drache = mon(dr, 'drache', 0, 5, 5), v1 = mon(dr, 'baer', 1, 5, 4), own = mon(dr, 'funke', 0, 5, 6); dr.seats[0].crests.MAG = 3;
  R.useAbility(dr, 0, drache.id, 'breath', {});
  check(!dr.mons.includes(v1), 'Feueratem: 20 an Feinden daneben');
  check(own.hp === 10, 'Feueratem trifft keine eigenen Monster');
}

// ---------- traps and items ----------
{
  const st = game(['gebein', 'glut']); act(st);
  path(st, 0, [[3, 7], [4, 7]]); path(st, 1, [[5, 7], [6, 7], [7, 7], [8, 7]]);
  const sp = mon(st, 'spinne', 0, 4, 7), runner = mon(st, 'hund', 1, 8, 7);
  st.seats[0].crests.TRP = 5;
  check(R.abilityTargets(st, sp, 'net').some((t) => t.cell === at(st, 5, 7)), 'Netzfalle: auf ein freies Wegfeld daneben');
  R.useAbility(st, 0, sp.id, 'net', { cell: at(st, 5, 7) });
  check(st.items.length === 1 && st.items[0].key === 'netz' && st.seats[0].crests.TRP === 4, 'Netz liegt verdeckt, 1 🕸️ bezahlt');
  R.useAbility(st, 0, sp.id, 'pit', { cell: at(st, 3, 7) });
  check(st.items.length === 2 && st.seats[0].pitUsed && R.abilityBlock(st, sp, 'pit') !== '', 'Falle stellen: jeder kann es, einmal pro Zug');
  R.endTurn(st, 0); act(st); st.seats[1].crests.MOV = 10;
  const r = R.move(st, 1, runner.id, at(st, 5, 7));
  check(r.ok && r.ev.some((e) => e.t === 'trap' && e.key === 'netz') && !st.mons.includes(runner) && st.items.length === 1, 'Feind tritt ins Netz: 20 Schaden (Hund zerstört), das Netz ist verbraucht');
  const s2 = game(['gebein', 'glut']); act(s2); path(s2, 0, [[3, 7], [4, 7], [5, 7], [6, 7]]);
  const own = mon(s2, 'ratte', 0, 6, 7); s2.items.push({ id: 90, key: 'pit', seat: 0, at: at(s2, 5, 7), revealed: false }); s2.seats[0].crests.MOV = 5;
  check(R.move(s2, 0, own.id, at(s2, 3, 7)).ok && own.at === at(s2, 3, 7) && s2.items.length === 1, 'eigene Fallen lösen nicht aus');
  const s3 = game(['glut', 'wild']); act(s3); path(s3, 0, [[3, 7], [4, 7]]); path(s3, 1, [[5, 7], [6, 7], [7, 7]]);
  const vic = mon(s3, 'loewe', 1, 7, 7); s3.items.push({ id: 91, key: 'grube', seat: 0, at: at(s3, 6, 7), revealed: false });
  s3.turn.seat = 1; s3.seats[1].crests.MOV = 5;
  const r3 = R.move(s3, 1, vic.id, at(s3, 4, 7));
  check(r3.ok && vic.at === at(s3, 6, 7) && vic.hp === 10 && r3.ev.find((e) => e.t === 'move').cost === 1 && s3.seats[1].crests.MOV === 4, 'Fallgrube: 20 Schaden, stehen bleiben, nur gelaufene Felder kosten');
  const s4 = game(['wild', 'tiefe']); path(s4, 0, [[3, 7]]); path(s4, 1, [[9, 9]]);
  const h = mon(s4, 'baer', 0, 3, 7); h.hp = 5; s4.items.push({ id: 92, key: 'quelle', seat: 0, at: at(s4, 3, 7), revealed: false });
  const k = mon(s4, 'krabbe', 1, 9, 9); s4.items.push({ id: 93, key: 'kristall', seat: 1, at: at(s4, 9, 9), revealed: false });
  s4.turn.seat = 1; act(s4); R.endTurn(s4, 1);
  check(h.hp === 20 && s4.items[0].revealed, 'Heilquell: +20 LP zu Beginn des eigenen Zuges');
  act(s4); R.endTurn(s4, 0);
  check(s4.seats[1].crests.MAG === 2, 'Kristallader: +2 ✨ zu Beginn des eigenen Zuges');
}

// ---------- bots play whole games ----------
function botGame(bags, seed, opts) {
  const st = R.newGame(Object.assign({ seats: bags.map((bag) => ({ bag })), seed }, opts || {}));
  let r = seed * 7 + 1; const rand = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  let steps = 0, fails = 0, neg = false;
  while (!st.over && steps < 6000) {
    steps++;
    if (st.turn.pending) { R.respond(st, st.turn.pending.seat, B.answer(st, st.turn.pending.seat)); continue; }
    const s = st.turn.seat, res = B.apply(st, s, B.plan(st, s, rand));
    if (!res.ok) { fails++; R.endTurn(st, s); }
    for (const x of st.seats) for (const c of D.POOL) if (x.crests[c] < 0 || x.crests[c] > st.cfg.cap) neg = true;
  }
  return { st, steps, fails, neg };
}
let allEnd = true, noFail = true, noNeg = true, rounds = [];
const t0 = Date.now();
for (const n of [2, 3, 4]) for (let seed = 1; seed <= 4; seed++) {
  const g = botGame(D.BAG_KEYS.slice(0, n).map((b, i) => D.BAG_KEYS[(i + seed) % 4]), seed);
  if (!g.st.over) allEnd = false;
  if (g.fails) noFail = false;
  if (g.neg) noNeg = false;
  rounds.push(n + 'P:' + g.st.turn.round);
}
const team = botGame(D.BAG_KEYS, 3, { mode: 'team' });
check(allEnd && team.st.over, 'Bot-Partien mit 2, 3 und 4 Spielern (und im Team) enden (' + rounds.join(' ') + ')');
check(noFail && !team.fails, 'Bots machen nur gültige Züge');
check(noNeg, 'Wappenlager bleibt immer zwischen 0 und der Grenze');
const a1 = botGame(['glut', 'tiefe'], 9), a2 = botGame(['glut', 'tiefe'], 9);
check(JSON.stringify(a1.st.over) === JSON.stringify(a2.st.over) && a1.steps === a2.steps, 'gleicher Seed → gleiche Partie (deterministisch)');
console.log('(' + (Date.now() - t0) + ' ms für die Bot-Partien)');
