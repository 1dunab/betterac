// Regeltests Werwolfnacht: Verteilung, Rollen, Nachtauswertung, Abstimmung, Siegprüfung, Chronik, Zufallspartien.
const R = require('./public/games/werwolf/rules.js');

let checks = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function eq(a, b, msg) { checks++; const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) fail(msg + ' (erwartet ' + y + ', war ' + x + ')'); }

// Spiel mit festen Rollen: roles = { id: role }
function mk(roles, seed, names) {
  return R.create({ players: Object.keys(roles), roles, seed: seed || 1, names });
}
// eine ganze Nacht: A = { id: payload }, B = { id: payload }
function night(g, A, B) {
  g.beginNight();
  for (const id in A || {}) { const r = g.act(id, A[id]); if (!r.ok) throw new Error('Aktion A ' + id + ' abgelehnt: ' + r.reason); }
  g.beginStepB();
  for (const id in B || {}) { const r = g.act(id, B[id]); if (!r.ok) throw new Error('Aktion B ' + id + ' abgelehnt: ' + r.reason); }
  return g.endNight();
}
const T = t => ({ target: t });
const count = (m, r) => Object.values(m).filter(x => x === r).length;
const ids = n => Array.from({ length: n }, (_, i) => 'p' + i);
const dead = (res, id) => res.deaths.some(d => d.id === id);
const cause = (res, id) => (res.deaths.find(d => d.id === id) || {}).cause;

// ---------- Verteilung ----------
{
  const auto = n => (n <= 6 ? 1 : n <= 10 ? 2 : n <= 14 ? 3 : 4);
  for (let n = 5; n <= 16; n++) {
    const m = R.deal(ids(n), {}, 42);
    eq(Object.keys(m).length, n, 'deal: alle Spieler bei ' + n);
    eq(count(m, 'wolf'), auto(n), 'deal: Wolfanzahl auto bei ' + n);
    const specials = ['seer', 'witch', 'hunter', 'guard', 'cupid'].reduce((a, k) => a + count(m, k), 0);
    eq(specials, Math.min(5, n - auto(n) - 1), 'deal: Spezialrollen bei ' + n);
    ok(count(m, 'villager') >= 1, 'deal: mindestens 1 Dorfbewohner bei ' + n);
    for (const k of ['seer', 'witch', 'hunter', 'guard', 'cupid']) ok(count(m, k) <= 1, 'deal: ' + k + ' höchstens einmal');
  }
  // Priorität: n=5 → 1 Wolf, max 3 Spezialrollen = Seherin, Hexe, Jäger
  const m5 = R.deal(ids(5), {}, 3);
  ok(count(m5, 'seer') && count(m5, 'witch') && count(m5, 'hunter') && !count(m5, 'guard') && !count(m5, 'cupid'), 'deal: Priorität seer, witch, hunter');
  eq(count(m5, 'villager'), 0 + 1, 'deal: n=5 → 1 Dorfbewohner');
  // manuelle Wölfe + Klemmung
  eq(count(R.deal(ids(5), { wolves: 4 }, 1), 'wolf'), 2, 'deal: 4 Wölfe bei 5 → 2');
  eq(count(R.deal(ids(8), { wolves: 4 }, 1), 'wolf'), 3, 'deal: 4 Wölfe bei 8 → 3');
  eq(count(R.deal(ids(16), { wolves: 1 }, 1), 'wolf'), 1, 'deal: 1 Wolf bei 16');
  eq(count(R.deal(ids(10), { wolves: 0 }, 1), 'wolf'), 1, 'deal: 0 Wölfe → 1');
  // Spezialrollen aus
  const off = R.deal(ids(10), { seer: false, witch: false, hunter: false, guard: false, cupid: false }, 5);
  eq(count(off, 'villager'), 8, 'deal: alles aus → nur Dorfbewohner + Wölfe');
  const some = R.deal(ids(10), { seer: false, witch: false }, 5);
  ok(!count(some, 'seer') && !count(some, 'witch') && count(some, 'hunter') === 1 && count(some, 'guard') === 1 && count(some, 'cupid') === 1, 'deal: deaktivierte Rollen fehlen');
  // Priorität bei Knappheit: n=6 → 1 Wolf, 4 Spezial möglich → seer witch hunter guard
  const m6 = R.deal(ids(6), {}, 9);
  ok(count(m6, 'guard') === 1 && count(m6, 'cupid') === 0, 'deal: n=6 → Beschützer ja, Amor nein');
  // Determinismus
  eq(R.deal(ids(12), {}, 77), R.deal(ids(12), {}, 77), 'deal: gleicher Seed → gleiche Verteilung');
  let diff = false;
  for (let s = 1; s < 20; s++) if (JSON.stringify(R.deal(ids(12), {}, s)) !== JSON.stringify(R.deal(ids(12), {}, 77))) diff = true;
  ok(diff, 'deal: Seeds ergeben unterschiedliche Verteilungen');
}

// ---------- Aufgaben und Aktions-Validierung ----------
{
  const g = mk({ w: 'wolf', v: 'villager', s: 'seer', gd: 'guard', c: 'cupid', h: 'witch', j: 'hunter' });
  ok(g.act('w', T('v')).ok === false, 'act vor beginNight → ok:false');
  eq(g.endNight().ok, false, 'endNight im falschen Zustand');
  eq(g.beginStepB(), null, 'beginStepB im falschen Zustand → null');
  eq(g.vote({}).ok, false, 'vote vor der ersten Nacht → ok:false');
  eq(g.shoot('j', null).ok, false, 'shoot ohne toten Jäger');
  const t = g.beginNight();
  eq(g.beginNight(), null, 'beginNight doppelt → null');
  eq(g.state.night, 1, 'night = 1');
  eq(Object.keys(t).length, 7, 'Aufgabe für jeden Lebenden');
  eq(t.w.kind, 'wolf', 'Wolf-Aufgabe'); eq(t.w.options.sort(), ['c', 'gd', 'h', 'j', 's', 'v'], 'Wolf: nur Nicht-Wölfe');
  eq(t.s.kind, 'seer', 'Seherin-Aufgabe'); ok(!t.s.options.includes('s'), 'Seherin nicht sich selbst');
  eq(t.gd.kind, 'guard', 'Beschützer-Aufgabe'); ok(t.gd.options.includes('gd'), 'Beschützer darf sich schützen');
  eq(t.c.kind, 'cupid', 'Amor-Aufgabe'); eq(t.c.pick, 2, 'Amor pick 2'); ok(t.c.options.includes('c'), 'Amor darf sich selbst');
  eq(t.v.kind, 'suspect', 'Dorfbewohner: suspect'); eq(t.h.kind, 'suspect', 'Hexe in A: suspect'); eq(t.j.kind, 'suspect', 'Jäger: suspect');
  ok(t.v.step === 'A', 'step A');
  ok(!g.stepDone(), 'stepDone false am Anfang');
  // Validierung
  eq(g.act('w', T('w')).ok, false, 'Wolf nicht auf Wolf');
  eq(g.act('w', T('nobody')).ok, false, 'unbekanntes Ziel');
  eq(g.act('w', {}).ok, false, 'leere Nutzlast');
  eq(g.act('w', null).ok, false, 'null-Nutzlast');
  eq(g.act('ghost', T('v')).ok, false, 'unbekannter Spieler');
  eq(g.act('v', T('v')).ok, false, 'Decoy nicht auf sich selbst');
  eq(g.act('s', T('s')).ok, false, 'Seherin nicht auf sich selbst');
  eq(g.act('c', { targets: ['v', 'v'] }).ok, false, 'Amor: gleiches Ziel zweimal');
  eq(g.act('c', { targets: ['v'] }).ok, false, 'Amor: nur ein Ziel');
  eq(g.act('c', T('v')).ok, false, 'Amor: target statt targets');
  eq(g.act('h', { heal: true }).ok, false, 'Hexe-Nutzlast in Schritt A abgelehnt');
  // Wölfe, Beschützer, Decoy dürfen ändern
  eq(g.act('w', T('v')).ok, true, 'Wolf wählt'); eq(g.act('w', T('s')).ok, true, 'Wolf ändert');
  eq(g.packPicks(), { w: 's' }, 'packPicks letzte Wahl');
  g.act('gd', T('v')); eq(g.act('gd', T('gd')).ok, true, 'Beschützer ändert');
  g.act('v', T('w')); eq(g.act('v', T('s')).ok, true, 'Decoy ändert');
  // Seherin: Ergebnis + Sperre
  const sr = g.act('s', T('w'));
  eq(sr, { ok: true, result: { target: 'w', role: 'wolf' } }, 'Seherin sieht Rolle');
  eq(g.act('s', T('v')).ok, false, 'Seherin gesperrt');
  // Amor: Sperre
  eq(g.act('c', { targets: ['v', 's'] }).ok, true, 'Amor wählt');
  eq(g.act('c', { targets: ['v', 'w'] }).ok, false, 'Amor gesperrt');
  ok(!g.stepDone(), 'stepDone false solange Hexe/Jäger fehlen');
  g.act('h', T('v')); g.act('j', T('v'));
  ok(g.stepDone(), 'stepDone wenn alle gehandelt haben');
  eq(g.act('w', T('v')).ok, true, 'Wolf darf bis zum Schritt-Ende ändern');
  // Schritt B
  const b = g.beginStepB();
  eq(g.beginStepB(), null, 'beginStepB doppelt → null');
  eq(g.state.victim, 'v', 'Wolfsziel fixiert');
  eq(b.h.kind, 'witch', 'Hexe-Aufgabe in B'); eq(b.h.victim, 'v', 'Hexe sieht das Opfer'); eq(b.h.canHeal, true, 'canHeal'); eq(b.h.canPoison, true, 'canPoison');
  ok(!b.h.options.includes('h'), 'Hexe: Gift nicht auf sich');
  eq(b.w.kind, 'trust', 'Wolf in B: trust'); eq(b.s.kind, 'trust', 'Seherin in B: trust');
  eq(g.act('w', T('s')).ok, true, 'trust-Wahl'); eq(g.act('s', T('v')).ok, true, 'Seherin in B: trust-Wahl');
  eq(g.act('w', { targets: ['v', 's'] }).ok, false, 'Amor-Nutzlast in B abgelehnt');
  eq(g.act('h', { heal: false, poison: 'h' }).ok, false, 'Gift nicht auf sich selbst');
  eq(g.act('h', { heal: false, poison: 'nobody' }).ok, false, 'Gift auf Unbekannt');
  eq(g.act('h', { heal: true, poison: 'w' }).ok, true, 'Hexe: beides');
  eq(g.act('h', { heal: false, poison: null }).ok, true, 'Hexe: neu senden, letzte zählt');
  const res = g.endNight();
  eq(res.ok, true, 'endNight ok');
  eq(res.deaths, [{ id: 'v', cause: 'wolves' }, { id: 's', cause: 'grief' }], 'Letzte Hexen-Nutzlast (nichts) zählt; Gram der Liebenden');
  eq(res.lovers, ['v', 's'], 'Liebende zurückgegeben');
  eq(g.state.lovers, ['v', 's'], 'state.lovers gesetzt');
  eq(g.act('w', T('v')).ok, false, 'act nach endNight → ok:false');
}

// ---------- Nachtauswertung ----------
{
  const base = { w1: 'wolf', w2: 'wolf', v: 'villager', v2: 'villager', gd: 'guard', h: 'witch', s: 'seer' };
  // ungeschützt
  let g = mk(base); let r = night(g, { w1: T('v'), w2: T('v') });
  eq(r.deaths, [{ id: 'v', cause: 'wolves' }], 'Wolfsopfer stirbt'); eq(g.state.alive.v, false, 'alive false');
  eq(r.hunter, null, 'kein Jäger'); eq(r.lovers, null, 'keine Liebenden');
  // geschützt
  g = mk(base); r = night(g, { w1: T('v'), w2: T('v'), gd: T('v') });
  eq(r.deaths, [], 'geschützt → keiner stirbt'); eq(g.state.guardLast, 'v', 'guardLast gesetzt');
  // Beschützer nicht zweimal hintereinander
  g.beginNight();
  eq(g.act('gd', T('v')).ok, false, 'Beschützer nicht zweimal derselbe');
  eq(g.act('gd', T('gd')).ok, true, 'anderer Spieler ok');
  g.beginStepB(); g.endNight();
  eq(g.state.guardLast, 'gd', 'guardLast wechselt');
  // kein Schutz → guardLast zurückgesetzt, danach wieder erlaubt
  g.beginNight(); g.beginStepB(); g.endNight();
  eq(g.state.guardLast, null, 'ohne Schutz → guardLast null');
  g.beginNight(); eq(g.act('gd', T('gd')).ok, true, 'wieder erlaubt'); g.beginStepB(); g.endNight();
  // geheilt
  g = mk(base); r = night(g, { w1: T('v'), w2: T('v') }, { h: { heal: true } });
  eq(r.deaths, [], 'geheilt → keiner stirbt'); eq(g.state.potions, { heal: false, poison: true }, 'Heiltrank verbraucht');
  // Heiltrank nur auf das echte Opfer, und nur wenn nicht verbraucht
  g = mk(base); g.beginNight(); g.act('w1', T('v')); g.act('w2', T('v')); g.beginStepB();
  eq(g.act('h', { heal: true }).ok, true, 'Heilen mit Opfer');
  g.endNight();
  g.beginNight(); g.act('w1', T('v2')); g.act('w2', T('v2')); const bb = g.beginStepB();
  eq(bb.h.canHeal, false, 'canHeal false nach Verbrauch'); eq(g.act('h', { heal: true }).ok, false, 'Heiltrank nur einmal');
  eq(g.act('h', { poison: 'v' }).ok, true, 'Gift noch da'); r = g.endNight();
  eq(r.deaths.map(d => d.id + ':' + d.cause), ['v2:wolves', 'v:poison'], 'Wolf + Gift');
  eq(g.state.potions, { heal: false, poison: false }, 'beide Tränke weg');
  // kein Opfer → kein Heilen
  g = mk(base); g.beginNight(); const nb = g.beginStepB();
  eq(nb.h.victim, null, 'kein Opfer'); eq(nb.h.canHeal, false, 'kein Opfer → canHeal false');
  eq(g.act('h', { heal: true }).ok, false, 'Heilen ohne Opfer abgelehnt');
  r = g.endNight(); eq(r.deaths, [], 'keine Wahl → keine Toten'); eq(g.state.potions.heal, true, 'Trank unberührt');
  // geschützt UND geheilt: Trank trotzdem verbraucht
  g = mk(base); r = night(g, { w1: T('v'), w2: T('v'), gd: T('v') }, { h: { heal: true } });
  eq(r.deaths, [], 'geschützt+geheilt'); eq(g.state.potions.heal, false, 'Heiltrank auch bei Schutz verbraucht');
  eq(g.chronicle[0].saved, 'both', 'Chronik saved both');
  // Gift hilft kein Schutz
  g = mk(base); r = night(g, { gd: T('v2') }, { h: { poison: 'v2' } });
  eq(r.deaths, [{ id: 'v2', cause: 'poison' }], 'Gift trotz Schutz'); eq(g.state.potions.poison, false, 'Gift verbraucht');
  // Gift auf Opfer, das ohnehin stirbt → einmal tot, Gift verbraucht
  g = mk(base); r = night(g, { w1: T('v'), w2: T('v') }, { h: { poison: 'v' } });
  eq(r.deaths, [{ id: 'v', cause: 'wolves' }], 'doppelt tödlich: nur ein Tod'); eq(g.state.potions.poison, false, 'Gift verbraucht');
  // Hexe stirbt, wirkt aber noch in derselben Nacht
  g = mk(base); r = night(g, { w1: T('h'), w2: T('h') }, { h: { poison: 'w1' } });
  eq(r.deaths.map(d => d.id).sort(), ['h', 'w1'], 'Hexe stirbt, Gift wirkt trotzdem');
  // Hexe heilt sich selbst
  g = mk(base); r = night(g, { w1: T('h'), w2: T('h') }, { h: { heal: true } });
  eq(r.deaths, [], 'Hexe heilt sich selbst');
  // gespaltene Wölfe: Mehrheit
  const three = { a: 'wolf', b: 'wolf', c: 'wolf', x: 'villager', y: 'villager', z: 'villager', q: 'villager' };
  g = mk(three); g.beginNight(); g.act('a', T('x')); g.act('b', T('x')); g.act('c', T('y')); g.beginStepB();
  eq(g.state.victim, 'x', 'Wolfsmehrheit');
  // Gleichstand: deterministisch pro Seed, aus den Besten
  const pick = seed => { const gg = mk(three, seed); gg.beginNight(); gg.act('a', T('x')); gg.act('b', T('y')); gg.act('c', T('z')); gg.beginStepB(); return gg.state.victim; };
  let seen = new Set();
  for (let s = 1; s <= 40; s++) { const v = pick(s); seen.add(v); eq(pick(s), v, 'Tie-Break deterministisch Seed ' + s); }
  ok(seen.size >= 2 && [...seen].every(v => ['x', 'y', 'z'].includes(v)), 'Tie-Break wählt unter den Besten, variiert');
  // 2:2:1 → nur die Spitzenreiter
  const four = { a: 'wolf', b: 'wolf', c: 'wolf', d: 'wolf', x: 'villager', y: 'villager', z: 'villager', q: 'villager', r: 'villager', u: 'villager', k: 'villager' };
  for (let s = 1; s <= 20; s++) {
    const gg = mk(four, s); gg.beginNight(); gg.act('a', T('x')); gg.act('b', T('x')); gg.act('c', T('y')); gg.act('d', T('y')); gg.beginStepB();
    ok(['x', 'y'].includes(gg.state.victim), 'Tie-Break nur unter Spitzenreitern');
  }
  // einzelner Wolf mit Wahl, anderer ohne
  g = mk(base); g.beginNight(); g.act('w2', T('v2')); g.beginStepB(); eq(g.state.victim, 'v2', 'ein Wolf entscheidet');
  // ein toter Wolf zählt nicht
  g = mk(base); g.state.alive.w2 = false; g.beginNight(); eq(Object.keys(g.packPicks()), ['w1'], 'packPicks nur Lebende');
  eq(g.act('w2', T('v')).ok, false, 'tote Spieler handeln nicht');
}

// ---------- Decoys: Misstrauen / Vertrauen ----------
{
  const g = mk({ w: 'wolf', a: 'villager', b: 'villager', c: 'villager', d: 'villager', e: 'villager' });
  g.beginNight();
  g.act('a', T('b')); g.act('b', T('c')); g.act('c', T('b')); g.act('d', T('e')); g.act('e', T('b'));
  g.beginStepB();
  g.act('a', T('d')); g.act('b', T('c')); g.act('c', T('d')); g.act('d', T('c')); g.act('e', T('a'));
  const r = g.endNight();
  eq(r.suspect, 'b', 'suspect: 3× b'); eq(r.trust, null, 'trust: d und c je 2 → Gleichstand → null');
  const h = mk({ w: 'wolf', a: 'villager', b: 'villager', c: 'villager', d: 'villager' });
  h.beginNight(); h.act('a', T('b')); h.act('c', T('d')); h.beginStepB(); h.act('a', T('b')); h.act('b', T('c')); h.act('d', T('c'));
  const r2 = h.endNight();
  eq(r2.suspect, null, 'suspect: nur je 1 → null'); eq(r2.trust, 'c', 'trust: c 2×');
  // Wolf-Wahl zählt nicht als Decoy
  const k = mk({ w: 'wolf', a: 'villager', b: 'villager', c: 'villager' });
  k.beginNight(); k.act('w', T('a')); k.act('b', T('a')); k.beginStepB(); const r3 = k.endNight();
  eq(r3.suspect, null, 'Wolfswahl ist kein Decoy');
}

// ---------- Amor und Liebende ----------
{
  const base = { w: 'wolf', c: 'cupid', a: 'villager', b: 'villager', d: 'villager', e: 'villager' };
  let g = mk(base);
  let r = night(g, { c: { targets: ['a', 'b'] }, w: T('a') });
  eq(r.lovers, ['a', 'b'], 'Liebende gemeldet');
  eq(r.deaths.map(d => d.id + ':' + d.cause), ['a:wolves', 'b:grief'], 'Opfer + Gram in derselben Nacht');
  // Gram andersherum
  g = mk(base); r = night(g, { c: { targets: ['a', 'b'] }, w: T('b') });
  eq(r.deaths.map(d => d.id + ':' + d.cause), ['b:wolves', 'a:grief'], 'Gram in die andere Richtung');
  // Amor nur Nacht 1
  g = mk(base); night(g, { c: { targets: ['a', 'b'] } });
  const t2 = g.beginNight(); eq(t2.c.kind, 'suspect', 'Amor in Nacht 2 → Decoy'); eq(g.act('c', { targets: ['d', 'e'] }).ok, false, 'Amor Nacht 2 abgelehnt');
  g.beginStepB(); r = g.endNight(); eq(r.lovers, null, 'lovers nur in Nacht 1 gemeldet');
  eq(g.state.lovers, ['a', 'b'], 'state.lovers bleibt');
  // Gram durch Abstimmung
  g = mk(base); night(g, { c: { targets: ['a', 'b'] } });
  const ex = g.execute('a'); eq(ex.deaths.map(d => d.id + ':' + d.cause), ['a:vote', 'b:grief'], 'Hinrichtung → Gram');
  // Amor, selbst verliebt
  g = mk(base); r = night(g, { c: { targets: ['c', 'a'] }, w: T('a') });
  eq(r.deaths.map(d => d.id).sort(), ['a', 'c'], 'Amor stirbt aus Gram');
}

// ---------- Jäger ----------
{
  const base = { w: 'wolf', j: 'hunter', a: 'villager', b: 'villager', c: 'villager', d: 'villager', e: 'cupid' };
  // nachts durch Wölfe
  let g = mk(base); let r = night(g, { w: T('j') });
  eq(r.hunter, 'j', 'Jäger tot → hunter'); eq(r.deaths, [{ id: 'j', cause: 'wolves' }], 'Jäger-Tod');
  let s = g.shoot('j', 'w'); eq(s.deaths, [{ id: 'w', cause: 'hunter' }], 'Jäger schießt Wolf'); eq(s.hunter, null, 'kein weiterer Jäger');
  eq(g.shoot('j', 'a').ok, false, 'nur ein Schuss');
  eq(g.checkWin().winner, 'village', 'Dorf gewinnt nach Jägerschuss');
  // durch Gift
  g = mk({ ...base, h: 'witch' }); r = night(g, null, { h: { poison: 'j' } });
  eq(r.hunter, 'j', 'Jäger vergiftet → hunter');
  // Abstimmung
  g = mk(base); night(g, {}); s = g.execute('j'); eq(s.hunter, 'j', 'Jäger hingerichtet → hunter');
  eq(g.shoot('j', 'j').ok, false, 'Jäger nicht auf sich selbst (tot)');
  eq(g.shoot('a', null).ok, false, 'Lebende können nicht schießen');
  eq(g.shoot('j', 'ghost').ok, false, 'ungültiges Ziel; Schuss bleibt');
  s = g.shoot('j', null); eq(s.ok, true, 'Jäger verzichtet'); eq(s.deaths, [], 'kein Schuss, keine Toten');
  eq(g.shoot('j', 'a').ok, false, 'verzichtet = verbraucht');
  // Gram
  g = mk(base); r = night(g, { e: { targets: ['j', 'a'] }, w: T('a') });
  eq(r.deaths.map(d => d.id + ':' + d.cause), ['a:wolves', 'j:grief'], 'Jäger stirbt aus Gram'); eq(r.hunter, 'j', 'Jäger durch Gram → hunter');
  // Jäger erschießt seinen Liebenden → Gram des anderen
  g = mk(base); r = night(g, { e: { targets: ['j', 'a'] }, w: T('j') });
  eq(r.deaths.map(d => d.id), ['j', 'a'], 'Jäger + Gram');
  g = mk({ ...base, f: 'villager' }); r = night(g, { e: { targets: ['b', 'c'] }, w: T('j') });
  s = g.shoot('j', 'b'); eq(s.deaths.map(d => d.id + ':' + d.cause), ['b:hunter', 'c:grief'], 'Schuss auf Liebenden → Gram');
  // Kette endet: Jäger ist Liebender des Opfers, schießt auf sich nicht möglich
  g = mk(base); night(g, { e: { targets: ['j', 'a'] } }); s = g.execute('a');
  eq(s.deaths.map(d => d.id), ['a', 'j'], 'Kette über Gram'); eq(s.hunter, 'j', 'Jäger durch Gram bei Hinrichtung');
  s = g.shoot('j', 'w'); eq(s.hunter, null, 'Kette endet');
  // chronicle shoot
  ok(g.chronicle.some(c => c.type === 'shoot' && c.by === 'j' && c.target === 'w'), 'Chronik: shoot');
}

// ---------- Abstimmung ----------
{
  const g = mk({ w: 'wolf', a: 'villager', b: 'villager', c: 'villager', d: 'villager', e: 'villager' });
  night(g, {});
  let v = g.vote({ w: 'a', a: 'a', b: 'c', c: 'a', d: null, e: 'a' });
  eq(v.result, 'execute', 'Mehrheit'); eq(v.target, 'a', 'Ziel a'); eq(v.counts, { a: 4, c: 1 }, 'Zählung'); eq(v.nobody, 1, 'Niemand 1');
  v = g.vote({ w: 'a', a: 'b', b: 'a', c: 'b', d: 'b', e: null });
  eq(v.result, 'execute', 'Pluralität reicht'); eq(v.target, 'b', 'b');
  v = g.vote({ w: null, a: null, b: 'a', c: 'a', d: null, e: 'b' });
  eq(v.result, 'none', 'Niemand vorn → none');
  v = g.vote({ w: null, a: null, b: 'a', c: 'a', d: 'b', e: 'b' });
  eq(v.result, 'none', 'Niemand gleichauf → none');
  v = g.vote({ w: null, a: 'a', b: 'a', c: 'a', d: 'b', e: 'b' });
  eq(v.result, 'execute', 'Niemand hinten → Hinrichtung');
  v = g.vote({ w: 'a', a: 'a', b: 'b', c: 'b', d: 'c', e: null });
  eq(v.result, 'tie', 'Gleichstand'); eq(v.tied, ['a', 'b'], 'tied'); eq(v.target, null, 'kein Ziel bei tie');
  // Stichwahl
  v = g.vote({ w: 'a', a: 'b', b: 'a', c: 'b', d: 'c', e: 'a' }, ['a', 'b']);
  eq(v.result, 'execute', 'Stichwahl entscheidet'); eq(v.target, 'a', 'a gewinnt Stichwahl'); eq(v.counts, { a: 3, b: 2 }, 'c-Stimme ungültig');
  v = g.vote({ w: 'a', a: 'b', b: 'a', c: 'b', d: 'c', e: null }, ['a', 'b']);
  eq(v.result, 'tie', 'Stichwahl-Gleichstand liefert tie (Glue: = none)');
  eq(g.vote({}).result, 'none', 'keine Stimmen → none');
  // Tote Stimmgeber / Ziele ignoriert
  g.state.alive.e = false;
  v = g.vote({ e: 'a', w: 'e', a: 'b' });
  eq(v.counts, { b: 1 }, 'Tote weder Wähler noch Ziel');
  eq(g.vote({ a: 'ghost' }).result, 'none', 'unbekanntes Ziel ignoriert');
  // execute
  eq(g.execute('e').ok, false, 'Toten nicht hinrichten');
  eq(g.execute('zz').ok, false, 'Unbekannten nicht hinrichten');
  const ex = g.execute('b'); eq(ex.deaths, [{ id: 'b', cause: 'vote' }], 'execute');
  // falscher Zustand: mitten in der Nacht
  g.beginNight(); eq(g.vote({ a: 'c' }).ok, false, 'vote in der Nacht → ok:false'); eq(g.execute('c').ok, false, 'execute in der Nacht → ok:false');
}

// ---------- Siegprüfung ----------
{
  let g = mk({ w: 'wolf', a: 'villager', b: 'villager' });
  eq(g.checkWin(), null, 'läuft weiter (1 Wolf vs 2)');
  g.state.alive.a = false;
  eq(g.checkWin().winner, 'wolves', 'Gleichstand → Wölfe'); ok(g.state.over && g.state.over.winner === 'wolves', 'state.over gesetzt');
  eq(g.checkWin().winners, ['w'], 'Wölfe-Gewinner');
  g = mk({ w: 'wolf', x: 'wolf', a: 'villager', b: 'seer', c: 'villager' });
  g.state.alive.w = false; g.state.alive.x = false;
  const win = g.checkWin(); eq(win.winner, 'village', 'Dorf gewinnt'); eq(win.winners, ['a', 'b', 'c'], 'Dorf-Gewinner inkl. Toter');
  g = mk({ w: 'wolf', a: 'villager' });
  g.state.alive.w = false; g.state.alive.a = false;
  eq(g.checkWin(), { winner: 'nobody', winners: [] }, 'niemand lebt');
  // Reihenfolge: niemand vor Dorf
  g = mk({ w: 'wolf', a: 'villager', b: 'villager' }); g.state.alive.w = g.state.alive.a = g.state.alive.b = false;
  eq(g.checkWin().winner, 'nobody', 'nobody vor village');
  // gemischte Liebende: nur die zwei übrig → Liebende
  g = mk({ w: 'wolf', x: 'wolf', c: 'cupid', a: 'villager', b: 'villager', d: 'villager' });
  night(g, { c: { targets: ['w', 'a'] } });
  g.state.alive.x = g.state.alive.c = g.state.alive.b = g.state.alive.d = false;
  eq(g.checkWin(), { winner: 'lovers', winners: ['w', 'a'] }, 'Liebende gewinnen vor Wolfs-Parität');
  // gemischt, weitere leben → keine Lover-Wertung; Wolfspartie
  g = mk({ w: 'wolf', x: 'wolf', c: 'cupid', a: 'villager', b: 'villager', d: 'villager' });
  night(g, { c: { targets: ['w', 'a'] } });
  g.state.alive.c = g.state.alive.b = g.state.alive.d = false; // lebt: w, x, a → Wölfe 2 ≥ 1
  const wv = g.checkWin(); eq(wv.winner, 'wolves', 'Wolfs-Parität'); eq(wv.winners, ['x'], 'gemischter Wolf nicht Gewinner');
  // Dorfsieg: gemischter Dorfbewohner ausgeschlossen
  g = mk({ w: 'wolf', x: 'wolf', c: 'cupid', a: 'villager', b: 'villager', d: 'villager', e: 'villager' });
  night(g, { c: { targets: ['x', 'a'] } });
  g.state.alive.w = false; g.state.alive.x = false; // Liebender a stirbt nicht automatisch (Direktmanipulation)
  g.state.alive.a = true;
  // x tot, a lebt, kein Wolf → Dorf; gemischtes a ist ausgeschlossen
  const vw = g.checkWin(); eq(vw.winner, 'village', 'kein Wolf lebt → Dorf'); ok(!vw.winners.includes('a') && !vw.winners.includes('x') && vw.winners.includes('b'), 'Dorf-Gewinner ohne gemischten Liebenden');
  // gleiche Teams: normaler Sieg
  g = mk({ w: 'wolf', c: 'cupid', a: 'villager', b: 'villager', d: 'villager' });
  night(g, { c: { targets: ['a', 'b'] } });
  g.state.alive.w = false; eq(g.checkWin().winners.sort(), ['a', 'b', 'c', 'd'], 'Dorfliebende gewinnen mit dem Dorf');
  // zwei Wölfe verliebt gewinnen als Wölfe
  g = mk({ w: 'wolf', x: 'wolf', c: 'cupid', a: 'villager', b: 'villager', d: 'villager', e: 'villager' });
  night(g, { c: { targets: ['w', 'x'] } });
  g.state.alive.a = g.state.alive.b = g.state.alive.d = false; // 2 Wölfe vs c,e
  eq(g.checkWin().winner, 'wolves', 'Wolfsliebende → Wölfe'); eq(g.state.over.winners, ['w', 'x'], 'beide Wölfe gewinnen');
}

// ---------- Chronik und ghostLines ----------
{
  const names = { w1: 'Anna', w2: 'Ben', v: 'Cleo', s: 'Dino', gd: 'Fritz', h: 'Gabi', c: 'Hans', j: 'Ida' };
  const g = mk({ w1: 'wolf', w2: 'wolf', v: 'villager', s: 'seer', gd: 'guard', h: 'witch', c: 'cupid', j: 'hunter' }, 5, names);
  eq(g.ghostLines(), [], 'ghostLines vor der Nacht leer');
  g.beginNight();
  g.act('w1', T('v')); g.act('w2', T('v')); g.act('s', T('j')); g.act('gd', T('v')); g.act('c', { targets: ['s', 'v'] });
  const lines = g.ghostLines();
  eq(lines, ['🐺 Anna & Ben wollen Cleo', '🔮 Dino prüft Ida', '🛡️ Fritz schützt Cleo', '💘 Hans verbindet Dino & Cleo'], 'ghostLines Schritt A');
  g.act('w2', T('s'));
  ok(g.ghostLines().includes('🐺 Ben wollen Dino') && g.ghostLines().includes('🐺 Anna wollen Cleo'), 'ghostLines je Ziel');
  g.act('w2', T('v'));
  g.beginStepB(); g.act('h', { heal: true, poison: 'j' });
  const l2 = g.ghostLines();
  ok(l2.includes('🧪 Gabi heilt Cleo') && l2.includes('🧪 Gabi vergiftet Ida'), 'ghostLines Hexe');
  const res = g.endNight();
  const e = g.chronicle[0];
  eq(e.type, 'night', 'Chronik: night'); eq(e.night, 1, 'Chronik: Nachtnummer');
  eq(e.wolves, { w1: 'v', w2: 'v' }, 'Chronik: Wolfswahlen'); eq(e.target, 'v', 'Chronik: Ziel');
  eq(e.seer, { by: 's', target: 'j', role: 'hunter' }, 'Chronik: Seherin'); eq(e.guard, { by: 'gd', target: 'v' }, 'Chronik: Beschützer');
  eq(e.cupid, { by: 'c', targets: ['s', 'v'] }, 'Chronik: Amor'); eq(e.witch, { by: 'h', heal: true, poison: 'j' }, 'Chronik: Hexe');
  eq(e.saved, 'both', 'Chronik: gerettet'); eq(e.deaths, res.deaths, 'Chronik: Tote'); eq(e.hunter, 'j', 'Chronik: Jäger');
  g.shoot('j', 'w1');
  g.vote({ w2: 'h', v: 'h' }); // Stimmen 'v'/'w2' leben
  g.execute('h');
  const types = g.chronicle.map(c => c.type); eq(types, ['night', 'shoot', 'vote', 'execute'], 'Chronik: Reihenfolge');
  const vt = g.chronicle[2]; eq(vt.ballots, { w2: 'h', v: 'h' }, 'Chronik: Stimmen'); eq(vt.result, 'execute', 'Chronik: Ergebnis'); eq(vt.runoff, false, 'Chronik: runoff false');
  for (const p in g.state.alive) if (p !== 'w2') g.state.alive[p] = false;
  ok(g.checkWin() && g.chronicle[g.chronicle.length - 1].type === 'end', 'Chronik: end-Eintrag');
  g.checkWin(); eq(g.chronicle.filter(c => c.type === 'end').length, 1, 'end nur einmal');
  eq(mk({ a: 'wolf', b: 'villager' }).ghostLines().length, 0, 'ghostLines ohne Namen leer');
  const nn = mk({ a: 'wolf', b: 'villager', c: 'villager' }); nn.beginNight(); nn.act('a', T('b'));
  eq(nn.ghostLines(), ['🐺 a wollen b'], 'ghostLines Fallback auf IDs');
}

// ---------- Spielende: nichts geht mehr ----------
{
  const g = mk({ w: 'wolf', a: 'villager' });
  g.state.alive.a = false;
  g.checkWin();
  eq(g.beginNight(), null, 'beginNight nach Spielende → null'); eq(g.vote({}).ok, false, 'vote nach Spielende → ok:false');
}

// ---------- Zufalls-Partien (Fuzz) ----------
{
  function lcg(seed) { let s = seed >>> 0 || 1; return () => { s = Math.imul(s ^ s >>> 15, 0x2c1b3c6d) + 0x9e3779b9 >>> 0; s ^= s >>> 12; return (s >>> 0) / 4294967296; }; }
  const stats = { nights: 0, winners: {}, maxNights: 0 };
  const GAMES = 500;
  for (let gi = 1; gi <= GAMES; gi++) {
    const rnd = lcg(gi * 7919);
    const pick = a => a[Math.floor(rnd() * a.length)];
    const n = 5 + Math.floor(rnd() * 12);
    const players = ids(n);
    const opts = { wolves: rnd() < 0.5 ? 'auto' : 1 + Math.floor(rnd() * 4) };
    for (const k of ['seer', 'witch', 'hunter', 'guard', 'cupid']) opts[k] = rnd() < 0.7;
    const roles = R.deal(players, opts, gi);
    const g = R.create({ players, roles, seed: gi });
    const roles0 = JSON.stringify(roles);
    let aliveN = n, over = null, nights = 0, hunters = 0;
    const checkAlive = () => {
      const a = players.filter(p => g.state.alive[p]).length;
      ok(a <= aliveN, 'Fuzz ' + gi + ': Lebende nehmen nicht zu'); aliveN = a;
      ok(JSON.stringify(g.state.roles) === roles0, 'Fuzz ' + gi + ': Rollen unverändert');
    };
    const doShoot = (hid) => {
      if (!hid) return;
      const liv = players.filter(p => g.state.alive[p]);
      const t = rnd() < 0.2 || !liv.length ? null : pick(liv);
      const s = g.shoot(hid, t);
      ok(s.ok, 'Fuzz ' + gi + ': Jägerschuss'); hunters++;
      ok(s.hunter == null, 'Fuzz ' + gi + ': keine Jägerkette');
      checkAlive();
    };
    const lovBefore = () => g.state.lovers && g.state.lovers.join();
    for (let n_ = 0; n_ < 80 && !over; n_++) {
      const A = g.beginNight(); nights++;
      ok(A && typeof A === 'object', 'Fuzz ' + gi + ': beginNight liefert Aufgaben');
      for (let pass = 0; pass < 2; pass++) for (const id in A) {
        if (rnd() < 0.15) continue;
        const t = A[id], o = t.options;
        let payload;
        if (t.kind === 'cupid') { const a = pick(o); let b = pick(o); while (b === a) b = pick(o); payload = { targets: [a, b] }; } else payload = { target: pick(o) };
        const r = g.act(id, payload);
        ok(r.ok || t.kind === 'seer' || t.kind === 'cupid', 'Fuzz ' + gi + ': gültige Aktion akzeptiert (' + t.kind + ')');
      }
      const B = g.beginStepB();
      for (const id in B) {
        if (rnd() < 0.15) continue;
        const t = B[id];
        let payload;
        if (t.kind === 'witch') {
          payload = { heal: t.canHeal && rnd() < 0.5, poison: t.canPoison && rnd() < 0.3 ? pick(t.options) : null };
        } else payload = { target: pick(t.options) };
        ok(g.act(id, payload).ok, 'Fuzz ' + gi + ': gültige B-Aktion akzeptiert (' + t.kind + ')');
      }
      const pBefore = JSON.stringify(g.state.potions);
      const r = g.endNight();
      ok(r.ok, 'Fuzz ' + gi + ': endNight ok');
      const pAfter = g.state.potions;
      ok((!pAfter.heal ? true : pBefore.includes('"heal":true')) && (!pAfter.poison ? true : pBefore.includes('"poison":true')), 'Fuzz ' + gi + ': Tränke nur einmal nutzbar');
      checkAlive();
      doShoot(r.hunter);
      if ((over = g.checkWin())) break;
      // Tag
      const liv = players.filter(p => g.state.alive[p]);
      const ballot = cands => { const b = {}; for (const v of liv) if (rnd() > 0.1) b[v] = rnd() < 0.1 ? null : pick(cands || liv); return b; };
      let v = g.vote(ballot());
      ok(v.ok, 'Fuzz ' + gi + ': vote ok');
      if (v.result === 'tie') { ok(v.tied.length >= 2, 'Fuzz ' + gi + ': tied'); v = g.vote(ballot(v.tied), v.tied); if (v.result === 'tie') v = { result: 'none' }; }
      if (v.result === 'execute') { const x = g.execute(v.target); ok(x.ok, 'Fuzz ' + gi + ': execute'); checkAlive(); doShoot(x.hunter); }
      if ((over = g.checkWin())) break;
    }
    ok(over && g.state.over === over, 'Fuzz ' + gi + ': Partie endet mit Sieger');
    ok(['village', 'wolves', 'lovers', 'nobody'].includes(over.winner), 'Fuzz ' + gi + ': Siegerart');
    ok(nights < 80, 'Fuzz ' + gi + ': in sinnvoller Nachtzahl beendet');
    ok(g.chronicle.filter(c => c.type === 'night').length === nights, 'Fuzz ' + gi + ': Chronik hat jede Nacht');
    ok(g.chronicle[g.chronicle.length - 1].type === 'end', 'Fuzz ' + gi + ': Chronik endet mit end');
    const dn = g.chronicle.reduce((a, c) => a + (c.deaths ? c.deaths.length : 0), 0);
    ok(dn === n - players.filter(p => g.state.alive[p]).length, 'Fuzz ' + gi + ': Tote in der Chronik = tatsächliche Tote');
    stats.nights += nights; stats.maxNights = Math.max(stats.maxNights, nights);
    stats.winners[over.winner] = (stats.winners[over.winner] || 0) + 1;
  }
  console.log('Fuzz: ' + GAMES + ' Partien, Ø ' + (stats.nights / GAMES).toFixed(2) + ' Nächte (max ' + stats.maxNights + '), Sieger ' + JSON.stringify(stats.winners));
}

if (!process.exitCode) console.log('OK: ' + checks + ' Prüfungen bestanden');
