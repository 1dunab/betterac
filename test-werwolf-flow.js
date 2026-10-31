// Werwolfnacht end-to-end: echte Shell + 7 echte Controller in JSDOM, Zeit stark verkürzt
// (WW_TIME_SCALE). Spielt zwei komplette Partien (Dorf gewinnt per Abstimmung, Wölfe gewinnen)
// und prüft Privatsphäre, Nacht-Timing, Hexe, Jäger, Amor, Stichwahl, Host-Rechte, Reconnect, Rematch.
// Jede Warteschleife hat eine Obergrenze und bricht mit einer klaren Meldung ab.
const { makeDom, makeBus } = require('./test-helpers');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(5); }
  throw new Error('Timeout: ' + what);
}

const SCALE = 0.04;   // alle Spielzeiten der Screen-Seite × 0.04
const NAMES = ['Anna', 'Ben', 'Cleo', 'Dennis', 'Emil', 'Finn', 'Greta'];
const LABELS = NAMES.map((_, i) => 'c' + (i + 1));
const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const w = screen.window;
const dbg = () => w.eval('active && active._debug()');
const snap = () => { try { const d = dbg(); return d ? { n: d.nightNo, d: d.dayNo, ph: d.phase, sub: d.sub } : {}; } catch (e) { return {}; } };

const phones = LABELS.map((l) => {
  const dom = makeDom('controller.html', 'controller', bus, l);
  const h = bus.handlers[l], orig = h.deliver; h.inbox = [];
  h.deliver = (m) => {
    if (m.type === 'message' && m.data) { const s = snap(); h.inbox.push(Object.assign({}, m.data, { _n: s.n, _day: s.d, _ph: s.ph, _sub: s.sub, _ts: Date.now() })); }
    orig(m);
  };
  return {
    l, dom, get id() { return bus.handlers[l]._id; },
    all: (t) => bus.handlers[l].inbox.filter(m => m.t === t),
    last(t) { return this.all(t).pop(); },
    get inbox() { return bus.handlers[l].inbox; },
    send: (data) => bus.fromClient(l, JSON.stringify({ type: 'message', to: 0, data }))
  };
});

(async () => {
  await sleep(100);
  const reported = [];
  const origReport = w.reportWinners;
  w.reportWinners = (ids) => { reported.push(ids.slice()); origReport(ids); };
  w.WW_TIME_SCALE = SCALE;
  const ms = (x) => x * SCALE;

  // Nacht darf der TV nie "ready"/Stimmen zeigen
  let nightFrames = 0, nightLeak = 0;
  const origDraw = w.WerwolfVillage.prototype.draw;
  w.WerwolfVillage.prototype.draw = function (c, scene) {
    const d = snap();
    if (d.ph === 'night') { nightFrames++; if (Object.keys(scene.ready || {}).length || Object.keys(scene.votes || {}).length) nightLeak++; }
    return origDraw.apply(this, arguments);
  };

  for (const [i, p] of phones.entries()) {
    p.dom.window.document.getElementById('nameInput').value = NAMES[i];
    p.dom.window.document.getElementById('joinBtn').click();
  }
  await sleep(150);
  const host = phones[0], byId = {};
  phones.forEach(p => { byId[p.id] = p; });
  check(phones.every(p => p.id > 0) && new Set(phones.map(p => p.id)).size === 7, '7 Handys sind verbunden');

  const alive = () => dbg().g.state.alive;
  const living = () => Object.keys(alive()).map(Number).filter(i => alive()[i]);
  const roles = () => dbg().roles;
  const ofRole = (r) => Object.keys(roles()).map(Number).filter(i => roles()[i] === r);
  const waitPhase = (ph, sub, t, what) => until(() => { const d = dbg(); return d && d.phase === ph && (!sub || d.sub === sub); }, t || 8000, what || ('Phase ' + ph + (sub ? '.' + sub : '')));
  const types = (p, from) => p.inbox.slice(from).map(m => m.t);
  const taskMsgs = (p, n, step) => p.all('wwTask').filter(m => m._n === n && m.step === step);
  async function waitTasks(n, step, who) {
    const ids = who || living();
    await until(() => ids.every(i => taskMsgs(byId[i], n, step).length >= 1), 8000, 'Aufgaben Nacht ' + n + ' Schritt ' + step);
    await sleep(30);
    return ids;
  }
  const firstTs = (ids, n, step) => Math.min(...ids.map(i => taskMsgs(byId[i], n, step)[0]._ts));
  const lastTs = (ids, n, step) => Math.max(...ids.map(i => taskMsgs(byId[i], n, step)[0]._ts));
  function actStep(n, step, ids, fn) {
    for (const i of ids) {
      const t = taskMsgs(byId[i], n, step)[0], payload = fn(i, roles()[i], t);
      if (payload) byId[i].send(Object.assign({ t: 'wwAct' }, payload));
    }
  }
  const pickOther = (i, t) => (t.options.find(o => o.id !== i) || t.options[0]).id;
  const readyAll = () => phones.forEach(p => p.send({ t: 'wwReady' }));
  const startGame = async (cfg) => {
    phones.forEach(p => { p.inbox.length = 0; });
    host.send({ t: 'shellSelect', game: 'werwolf' }); await sleep(40);
    host.send({ t: 'shellConfig', game: 'werwolf', cfg }); await sleep(40);
    host.send({ t: 'shellStart' });
    await waitPhase('roles', null, 4000, 'Spielstart');
  };
  const voteAll = (map) => Object.keys(map).forEach(k => byId[k].send({ t: 'wwVote', target: map[k] }));
  const hostId = () => w.eval('hostId()');

  try {
    // ======================= Spiel 1: das Dorf gewinnt =======================
    console.log('--- Spiel 1: Dorf gewinnt (Amor, Hexe, Seherin) ---');
    await startGame({ wolves: '2', seer: 'on', witch: 'on', hunter: 'off', guard: 'off', cupid: 'on', talk: 420, reveal: 'on', voice: 'off' });
    const R = roles();
    const wolves = ofRole('wolf'), [seer] = ofRole('seer'), [witch] = ofRole('witch'), [cupid] = ofRole('cupid'), vills = ofRole('villager');
    check(wolves.length === 2 && ofRole('seer').length === 1 && ofRole('witch').length === 1 && ofRole('cupid').length === 1 && vills.length === 2, 'Verteilung: 2 Wölfe, Seherin, Hexe, Amor, 2 Dorfbewohner');
    check(phones.every(p => p.last('wwRole') && p.last('wwRole').role === R[p.id]), 'jedes Handy kennt seine Rolle');
    check(phones.every(p => (R[p.id] === 'wolf') === (Array.isArray(p.last('wwRole').pack) && p.last('wwRole').pack.length === 2)), 'nur die Wölfe bekommen das Rudel (pack)');
    check(host.last('wwRole').host === true && phones[1].last('wwRole').host === false, 'Host-Flag in wwRole');
    check(phones.every(p => { const m = p.last('wwPhase'); return m && m.phase === 'roles' && m.secs === 0; }), 'Phase roles ohne Countdown');

    // Rollenphase endet nicht, solange nicht alle bereit sind
    phones.slice(1).forEach(p => p.send({ t: 'wwReady' }));
    await sleep(ms(4000) + 150);
    check(dbg().phase === 'roles', 'Rollenphase wartet auf den letzten "Bereit"');
    host.send({ t: 'wwReady' });
    await waitPhase('night', null, 4000, 'Rollen → Nacht');

    // ---- Nacht 1, Schritt A ----
    const ids1 = await waitTasks(1, 'A');
    const kindOf = { wolf: 'wolf', seer: 'seer', cupid: 'cupid', witch: 'suspect', villager: 'suspect' };
    check(ids1.length === 7 && ids1.every(i => taskMsgs(byId[i], 1, 'A').length === 1), 'jeder Lebende bekommt genau eine Aufgabe in Schritt A');
    check(ids1.every(i => taskMsgs(byId[i], 1, 'A')[0].kind === kindOf[R[i]]), 'Aufgaben-Arten: Wolf/Seherin/Amor, alle anderen Köder (suspect)');
    check(lastTs(ids1, 1, 'A') - firstTs(ids1, 1, 'A') <= 60, 'alle Aufgaben eines Schritts im selben Tick (' + (lastTs(ids1, 1, 'A') - firstTs(ids1, 1, 'A')) + ' ms)');
    check(ids1.every(i => taskMsgs(byId[i], 1, 'A')[0].options.every(o => o.name && o.color && o.id > 0)), 'Optionen sind {id,name,color}');
    check(phones.every(p => p.all('wwPack').length === 0 || R[p.id] === 'wolf'), 'wwPack nur an Wölfe');
    check(phones.every(p => p.all('wwSeen').length === 0), 'noch kein wwSeen');

    const [V1, V2] = vills, [W1, W2] = wolves;
    // W1 wählt sein Opfer, verliert die Verbindung kurz (shellSync) → alles kommt wieder
    byId[W1].send({ t: 'wwAct', target: V1 });
    await sleep(40);
    check(byId[W2].last('wwPack').picks[W1] === V1, 'Wolf W2 sieht live die Wahl von W1 (wwPack)');
    check(phones.filter(p => R[p.id] !== 'wolf').every(p => p.all('wwPack').length === 0), 'Nicht-Wölfe sehen nie ein wwPack');
    let mark = byId[W1].inbox.length;
    byId[W1].send({ t: 'shellSync' }); await sleep(60);
    let seq = types(byId[W1], mark).filter(t => t.startsWith('ww'));
    check(seq.join() === 'wwRole,wwPhase,wwTask,wwPack', 'Reconnect mitten in der Nacht: wwRole, wwPhase, wwTask, wwPack (' + seq.join() + ')');
    check(byId[W1].last('wwTask').current === V1, 'wwTask.current enthält die bisherige Wahl');
    check(byId[W1].last('wwPhase').phase === 'night' && byId[W1].last('wwPhase').secs === 0, 'Nacht-wwPhase ohne Countdown');
    // W2 wird "offline" (Shell löscht players[id] vor onDisconnect), kommt zurück und kann handeln
    const w2info = JSON.parse(JSON.stringify(w.eval('players')[W2]));
    w.eval('ac.onDisconnect(' + W2 + ')');
    check(dbg().offline[W2] === true, 'Disconnect → Spieler bleibt im Spiel, als offline markiert');
    w.eval('players[' + W2 + '] = ' + JSON.stringify(w2info));
    mark = byId[W2].inbox.length;
    byId[W2].send({ t: 'shellSync' }); await sleep(60);
    seq = types(byId[W2], mark).filter(t => t.startsWith('ww'));
    check(dbg().offline[W2] === false, 'Rückkehr → offline-Flag weg');
    check(seq.slice(0, 3).join() === 'wwRole,wwPhase,wwTask' && byId[W2].last('wwTask').current === null, 'Rückkehrer: wwRole, wwPhase, wwTask (current null)');
    byId[W2].send({ t: 'wwAct', target: V1 }); await sleep(30);
    check(dbg().g.packPicks()[W2] === V1, 'Rückkehrer kann noch handeln (Wahl kam an)');

    // alle anderen handeln sofort
    const tAct = Date.now();
    actStep(1, 'A', ids1.filter(i => i !== W1 && i !== W2), (i, role, t) => {
      if (role === 'seer') return { target: W1 };
      if (role === 'cupid') return { targets: [V1, V2] };
      return { target: seer };
    });
    await sleep(30);
    check(dbg().sub === 'A' || w.performance.now() >= dbg().timers.stepMinAt, 'Schritt A endet nicht vor dem Minimum, obwohl alle schon gehandelt haben');
    check(byId[seer].all('wwSeen').length === 1 && byId[seer].last('wwSeen').role === 'wolf' && byId[seer].last('wwSeen').target.id === W1, 'Seherin sieht die echte Rolle (Wolf)');
    check(phones.filter(p => p.id !== seer).every(p => p.all('wwSeen').length === 0), 'wwSeen geht nur an die Seherin');

    // ---- Schritt B ----
    const idsB = await waitTasks(1, 'B');
    const aDur = firstTs(idsB, 1, 'B') - firstTs(ids1, 1, 'A');
    check(aDur >= ms(12000) - 15, 'Schritt A dauerte ≥ Minimum trotz sofortiger Aktionen (' + aDur + ' ms ≥ ' + ms(12000) + ')');
    check(idsB.every(i => taskMsgs(byId[i], 1, 'B').length === 1), 'jeder Lebende genau eine Aufgabe in Schritt B');
    check(idsB.every(i => taskMsgs(byId[i], 1, 'B')[0].kind === (R[i] === 'witch' ? 'witch' : 'trust')), 'Schritt B: Hexe bekommt witch, alle anderen trust');
    const wt = taskMsgs(byId[witch], 1, 'B')[0];
    check(wt.victim && wt.victim.id === V1 && wt.canHeal === true && wt.canPoison === true, 'Hexen-Aufgabe: Opfer als {id,name,color}, beide Tränke da');
    check(lastTs(idsB, 1, 'B') - firstTs(idsB, 1, 'B') <= 60, 'Schritt-B-Aufgaben im selben Tick');
    actStep(1, 'B', idsB, (i, role, t) => role === 'witch' ? { heal: true, poison: null } : { target: seer });
    await sleep(30);
    check(dbg().sub === 'B' || w.performance.now() >= dbg().timers.stepMinAt, 'Schritt B endet nicht vor dem Minimum');
    await waitPhase('dawn', null, 5000, 'Nacht 1 → Morgen');
    const bDur = Date.now() - firstTs(idsB, 1, 'B');
    check(bDur >= ms(9000) - 15, 'Schritt B dauerte ≥ Minimum (' + bDur + ' ms)');
    check(nightFrames > 20 && nightLeak === 0, 'TV zeigt in der Nacht nie ready-Marken oder Stimmen (' + nightFrames + ' Frames)');
    check(phones.every(p => p.all('wwPhase').filter(m => m.phase === 'night').every(m => m.secs === 0)), 'kein Countdown in der Nacht');
    await waitPhase('day', null, 15000, 'Morgen → Tag');
    check(alive()[V1] === true && living().length === 7, 'Hexe heilt das Opfer: niemand stirbt in Nacht 1');
    check(phones.every(p => p.all('wwDead').length === 0), 'kein wwDead nach Nacht 1');
    check(phones.filter(p => p.all('wwLover').length).map(p => p.id).sort().join() === [V1, V2].sort().join(), 'wwLover geht nur an die zwei Verliebten');
    check(byId[V1].last('wwLover').partner.id === V2 && byId[V2].last('wwLover').partner.id === V1, 'wwLover nennt den jeweils anderen');

    // ---- Tag 1: ⅔-Regel, Host-Skip ----
    check(phones.every(p => p.last('wwPhase').phase === 'day' && p.last('wwPhase').secs > 0), 'Tag-wwPhase mit Countdown');
    [phones[0], phones[1], phones[2], phones[3]].forEach(p => p.send({ t: 'wwTalkReady' }));
    await sleep(120);
    check(dbg().phase === 'day', '4 von 7 bereit reichen nicht (⅔ = 5)');
    phones[1].send({ t: 'wwSkip' }); await sleep(120);
    check(dbg().phase === 'day', 'wwSkip von Nicht-Host wird ignoriert');
    phones[4].send({ t: 'wwTalkReady' });
    await waitPhase('vote', 'collect', 3000, '⅔ bereit → Abstimmung');
    check(true, '5 von 7 bereit → Abstimmung beginnt');

    // ---- Abstimmung: Gleichstand → Stichwahl → wieder Gleichstand → niemand ----
    await until(() => living().every(i => byId[i].last('wwBallot')), 3000, 'wwBallot');
    check(phones.every(p => { const b = p.last('wwBallot'); return b.runoff === false && b.options.length === 7 && b.secs > 0; }), 'alle bekommen den Stimmzettel (7 Optionen, Countdown)');
    const L = living(), A = L[0], B = L[1];
    byId[L[6]].send({ t: 'wwVote', target: 999 }); await sleep(20);
    check(!(L[6] in dbg().ballots), 'ungültiges Stimmziel wird ignoriert');
    voteAll({ [L[0]]: A, [L[1]]: A, [L[2]]: A, [L[3]]: B, [L[4]]: B, [L[5]]: B, [L[6]]: null });
    await waitPhase('runoff', 'collect', 6000, 'Gleichstand → Stichwahl');
    check(true, 'Gleichstand 3:3 → Stichwahl');
    await until(() => living().every(i => byId[i].last('wwBallot') && byId[i].last('wwBallot').runoff), 3000, 'Stichwahl-Stimmzettel');
    check(byId[L[0]].last('wwBallot').options.map(o => o.id).sort().join() === [A, B].sort().join(), 'Stichwahl nur zwischen den Gleichstehenden');
    byId[L[2]].send({ t: 'wwVote', target: L[5] }); await sleep(20);
    check(!(L[2] in dbg().ballots), 'Stichwahl: Stimme für Nicht-Kandidaten wird ignoriert');
    voteAll({ [L[0]]: A, [L[1]]: A, [L[2]]: A, [L[3]]: B, [L[4]]: B, [L[5]]: B, [L[6]]: null });
    await waitPhase('night', null, 15000, 'zweiter Gleichstand → Nacht');
    check(living().length === 7, 'zweiter Gleichstand → niemand wird verbannt');
    check(phones.every(p => p.all('wwDead').length === 0), 'kein Tod durch die Abstimmung');

    // ---- Nacht 2: Wölfe töten V1, Hexe vergiftet W1 ----
    const ids2 = await waitTasks(2, 'A');
    check(!idsHas(ids2, 'cupid') || taskMsgs(byId[cupid], 2, 'A')[0].kind === 'suspect', 'Amor hat in Nacht 2 nur noch eine Köder-Aufgabe');
    actStep(2, 'A', ids2, (i, role, t) => role === 'wolf' ? { target: V1 } : { target: pickOther(i, t) });
    const idsB2 = await waitTasks(2, 'B');
    const wt2 = taskMsgs(byId[witch], 2, 'B')[0];
    check(wt2.canHeal === false && wt2.canPoison === true, 'Hexe: Heiltrank ist verbraucht, Gift noch da');
    actStep(2, 'B', idsB2, (i, role, t) => role === 'witch' ? { heal: false, poison: W1 } : { target: pickOther(i, t) });
    await waitPhase('dawn', null, 5000, 'Nacht 2 → Morgen');
    await waitPhase('day', null, 20000, 'Morgen 2 → Tag 2');
    const dead2 = [V1, V2, W1];
    check(dead2.every(i => !alive()[i]) && living().length === 4, 'Nacht 2: Opfer, Liebeskummer und Gift-Opfer sind tot');
    const wd = {};
    phones.forEach(p => { if (p.all('wwDead').length) wd[p.id] = p.last('wwDead'); });
    check(Object.keys(wd).map(Number).sort().join() === dead2.slice().sort().join(), 'wwDead nur an die Toten');
    check(wd[V1].cause === 'wolves' && wd[V2].cause === 'grief' && wd[W1].cause === 'poison', 'Todesursachen: wolves / grief / poison');
    const dts = [V1, V2, W1].map(i => byId[i].last('wwDead')._ts);
    check(dts[0] < dts[1] && dts[1] < dts[2] && dts[1] - dts[0] >= ms(4000) * 0.8 && dts[2] - dts[1] >= ms(4000) * 0.8, 'Tode werden nacheinander mit Erzähler-Pause angekündigt');
    check(byId[V1].last('wwGhost') && byId[V1].last('wwGhost').roster.every(e => e.role) && byId[V1].last('wwGhost').night.length > 0, 'Geister bekommen wwGhost mit allen Rollen und Nachtzeilen');
    check(phones.filter(p => !(p.id in wd)).every(p => p.all('wwGhost').length === 0), 'Lebende bekommen nie wwGhost');
    byId[V1].send({ t: 'wwTalkReady' }); byId[V1].send({ t: 'wwVote', target: W2 });
    check(!dbg().talkReady[V1], 'Tote können nicht "bereit" melden');

    // ---- Tag 2: Host überspringt, Dorf verbannt den letzten Wolf ----
    host.send({ t: 'wwSkip' });
    await waitPhase('vote', 'collect', 4000, 'Host-wwSkip → Abstimmung');
    check(true, 'Host-wwSkip startet die Abstimmung sofort');
    check(byId[V1].all('wwBallot').filter(m => m._day === 2).length === 0, 'Tote bekommen keinen Stimmzettel');
    byId[V1].send({ t: 'wwVote', target: W2 }); await sleep(20);
    check(!(V1 in dbg().ballots), 'Stimme eines Toten wird ignoriert');
    const lv = living();
    voteAll(Object.fromEntries(lv.map(i => [i, W2])));
    await waitPhase('end', null, 15000, 'Verbannung → Spielende');
    await sleep(80);
    const wins = dbg().over;
    check(wins && wins.winner === 'village', 'Dorf gewinnt');
    check(phones.every(p => p.last('wwEnd') && p.last('wwEnd').winner === 'village'), 'alle bekommen wwEnd');
    check(phones.every(p => p.last('wwEnd').won === !wolves.includes(p.id)), 'won: alle Nicht-Wölfe (auch Tote) haben gewonnen, Wölfe nicht');
    check(phones[0].last('wwEnd').roster.length === 7 && phones[0].last('wwEnd').roster.every(e => e.role && typeof e.won === 'boolean' && typeof e.alive === 'boolean'), 'wwEnd-Roster mit Rolle, alive und won');
    check(reported.length === 1 && reported[0].slice().sort().join() === [seer, witch, cupid, V1, V2].sort().join(), 'reportWinners genau einmal mit den Gewinnern (' + JSON.stringify(reported) + ')');
    await sleep(200);
    check(reported.length === 1, 'auch später kein zweiter reportWinners');
    check(new Set(phones.flatMap(p => p.all('wwDead').map(() => p.id))).size === 4, 'insgesamt vier Geister (Opfer, Liebeskummer, Gift, Verbannter)');

    // ---- Rematch: nur Host ----
    const g1 = dbg().g, rolesBefore = phones.map(p => p.all('wwRole').length);
    phones[2].send({ t: 'wwAgain' }); await sleep(100);
    check(dbg().phase === 'end' && dbg().g === g1, 'wwAgain von Nicht-Host wird ignoriert');
    host.send({ t: 'wwAgain' }); await sleep(100);
    check(dbg().g !== g1 && dbg().phase === 'roles' && dbg().nightNo === 0, 'Host-wwAgain → neue Partie in der Rollenphase');
    check(phones.every((p, i) => p.all('wwRole').length === rolesBefore[i] + 1), 'jedes Handy bekommt eine neue wwRole');
    check(phones.every(p => p.last('wwRole').role === dbg().roles[p.id]), 'neue Rollen stimmen mit dem Spiel überein');
    check(living().length === 7, 'Rematch: alle 7 sind wieder dabei');

    // stop(): zurück in die Lobby, danach kommt nichts mehr
    w.eval('endToLobby()');
    await sleep(60);
    const cnt = phones.map(p => p.inbox.length);
    await sleep(ms(WW(4000)) + 200);
    check(w.eval('active') === null && phones.every((p, i) => p.inbox.slice(cnt[i]).filter(m => m.t.startsWith('ww')).length === 0), 'stop(): keine Timer, nach dem Abbruch kommt nichts mehr');

    // ======================= Spiel 2: die Wölfe gewinnen =======================
    console.log('--- Spiel 2: Wölfe gewinnen (Jäger, Beschützer) ---');
    await sleep(100);
    await startGame({ wolves: '2', seer: 'off', witch: 'off', hunter: 'on', guard: 'on', cupid: 'off', talk: 420, reveal: 'off', voice: 'off' });
    const R2 = roles(), wolves2 = ofRole('wolf'), [hunter] = ofRole('hunter'), [guard] = ofRole('guard'), vil2 = ofRole('villager');
    check(wolves2.length === 2 && vil2.length === 3 && !!hunter && !!guard, 'Verteilung: 2 Wölfe, Jäger, Beschützer, 3 Dorfbewohner');
    readyAll();
    await waitPhase('night', null, 6000, 'Rollen → Nacht');
    // Nacht 1: niemand handelt → Schritt wird am Maximum abgeschnitten
    const i1 = await waitTasks(1, 'A');
    check(i1.every(i => taskMsgs(byId[i], 1, 'A')[0].kind === (R2[i] === 'wolf' ? 'wolf' : R2[i] === 'guard' ? 'guard' : 'suspect')), 'Nacht 1: Wolf/Beschützer/Köder-Aufgaben');
    const iB = await waitTasks(1, 'B');
    const aDur2 = firstTs(iB, 1, 'B') - firstTs(i1, 1, 'A');
    check(aDur2 >= ms(35000) - 20 && aDur2 < ms(35000) + 600, 'ohne Aktionen wird Schritt A erst am Maximum beendet (' + aDur2 + ' ms ≈ ' + ms(35000) + ')');
    check(iB.every(i => taskMsgs(byId[i], 1, 'B').length === 1 && taskMsgs(byId[i], 1, 'B')[0].kind === 'trust'), 'Schritt B läuft auch ohne Hexe (alle trust)');
    await waitPhase('day', null, 15000, 'Nacht 1 → Tag 1');
    const bDur2 = Date.now() - firstTs(iB, 1, 'B');
    check(bDur2 >= ms(25000) - 20, 'Schritt B ebenfalls bis zum Maximum (' + bDur2 + ' ms inkl. Morgen)');
    check(living().length === 7 && phones.every(p => p.all('wwDead').length === 0), 'ohne Wahl der Wölfe stirbt niemand');

    // Tag 1: Host überspringt, alle wählen V_a; Handy-Reconnect während der Abstimmung
    const [Va, Vb, Vc] = vil2;
    host.send({ t: 'wwSkip' });
    await waitPhase('vote', 'collect', 4000, 'Tag 1 → Abstimmung');
    await sleep(40);
    byId[hunter].send({ t: 'wwVote', target: Va }); await sleep(30);
    mark = byId[hunter].inbox.length;
    byId[hunter].send({ t: 'shellSync' }); await sleep(60);
    seq = types(byId[hunter], mark).filter(t => t.startsWith('ww'));
    check(seq.join() === 'wwRole,wwPhase,wwBallot' && byId[hunter].last('wwBallot').current === Va, 'Reconnect in der Abstimmung: wwRole, wwPhase, wwBallot mit current');
    voteAll(Object.fromEntries(living().filter(i => i !== hunter).map(i => [i, Va])));
    await waitPhase('night', null, 15000, 'Abstimmung → Nacht 2');
    check(!alive()[Va] && living().length === 6, 'Abstimmung verbannt den Gewählten');
    check(phones.filter(p => p.all('wwDead').length).map(p => p.id).join() === String(Va) && byId[Va].last('wwDead').cause === 'vote', 'wwDead (vote) nur an den Verbannten');

    // Nacht 2: Wölfe töten den Jäger, Beschützer schützt Vb
    const j = await waitTasks(2, 'A');
    actStep(2, 'A', j, (i, role, t) => role === 'wolf' ? { target: hunter } : role === 'guard' ? { target: Vb } : { target: pickOther(i, t) });
    const jb = await waitTasks(2, 'B');
    actStep(2, 'B', jb, (i, role, t) => ({ target: pickOther(i, t) }));
    await waitPhase('hunter', null, 15000, 'Jäger stirbt → Jäger-Phase');
    await sleep(60);
    check(!alive()[hunter], 'der Jäger ist tot');
    check(byId[hunter].all('wwShootTask').length === 1 && phones.filter(p => p.id !== hunter).every(p => p.all('wwShootTask').length === 0), 'wwShootTask nur an den Jäger');
    check(byId[hunter].last('wwShootTask')._ph === 'hunter' && byId[hunter].last('wwShootTask').secs > 0 && byId[hunter].last('wwShootTask').options.every(o => alive()[o.id]), 'wwShootTask in Phase hunter, nur lebende Ziele, mit Countdown');
    check(phones.every(p => p.last('wwPhase').phase === 'hunter' && p.last('wwPhase').secs > 0), 'Jäger-Phase hat für alle einen Countdown');
    mark = byId[hunter].inbox.length;
    byId[hunter].send({ t: 'shellSync' }); await sleep(60);
    seq = types(byId[hunter], mark).filter(t => t.startsWith('ww'));
    check(seq[0] === 'wwRole' && seq[1] === 'wwPhase' && seq.includes('wwShootTask') && seq.indexOf('wwShootTask') > seq.indexOf('wwPhase'), 'Reconnect des Jägers: wwRole, wwPhase, dann wwShootTask (' + seq.join() + ')');
    phones[(phones.indexOf(byId[wolves2[0]]) + 0)].send({ t: 'wwShoot', target: wolves2[1] }); await sleep(20);
    check(dbg().sub !== 'shot' && alive()[wolves2[1]], 'wwShoot von Nicht-Jäger wird ignoriert');
    byId[hunter].send({ t: 'wwShoot', target: Va }); await sleep(20);
    check(dbg().sub !== 'shot', 'Schuss auf einen Toten wird ignoriert');
    byId[hunter].send({ t: 'wwShoot', target: wolves2[0] });
    await waitPhase('day', null, 15000, 'Schuss → Tag 2');
    check(!alive()[wolves2[0]] && alive()[wolves2[1]], 'der Jäger erschießt einen Wolf');
    check(byId[wolves2[0]].last('wwDead').cause === 'hunter', 'wwDead (hunter) an den Erschossenen');
    check(living().length === 4 && alive()[Vb] && alive()[Vc] && alive()[guard], 'Beschützer-Ziel lebt (4 Lebende)');

    // Tag 2: Dorfbewohner Vb wird verbannt → 1 Wolf gegen 2
    host.send({ t: 'wwSkip' });
    await waitPhase('vote', 'collect', 4000, 'Tag 2 → Abstimmung');
    voteAll(Object.fromEntries(living().map(i => [i, Vb])));
    await waitPhase('night', null, 15000, 'Verbannung → Nacht 3');
    check(!alive()[Vb] && living().length === 3, 'Vb verbannt, noch kein Sieger');

    // Nacht 3: Wolf tötet Vc, Beschützer schützt sich selbst → Wölfe ≥ Dorf
    const k = await waitTasks(3, 'A');
    actStep(3, 'A', k, (i, role, t) => role === 'wolf' ? { target: Vc } : role === 'guard' ? { target: guard } : { target: pickOther(i, t) });
    const kb = await waitTasks(3, 'B');
    actStep(3, 'B', kb, (i, role, t) => ({ target: pickOther(i, t) }));
    await waitPhase('end', null, 15000, 'Nacht 3 → Spielende');
    await sleep(80);
    check(dbg().over && dbg().over.winner === 'wolves', 'Wölfe gewinnen');
    check(phones.every(p => { const e = p.last('wwEnd'); return e && e.winner === 'wolves' && e.won === wolves2.includes(p.id); }), 'won: beide Wölfe (auch der tote) gewonnen, alle anderen nicht');
    check(reported.length === 2 && reported[1].slice().sort().join() === wolves2.slice().sort().join(), 'reportWinners genau einmal pro Partie (Wölfe)');
    check(byId[hunter].last('wwEnd').roster.find(e => e.id === wolves2[1]).alive === true && byId[hunter].last('wwEnd').roster.find(e => e.id === Vc).alive === false, 'wwEnd-Roster: alive-Flags stimmen');
    const deadEnd = Object.keys(alive()).map(Number).filter(i => !alive()[i]);
    check(phones.every(p => p.all('wwGhost').length === 0 || deadEnd.includes(p.id)), 'wwGhost ging nur an Spieler, die am Ende tot sind');
    check(phones.every(p => p.all('wwPhase').filter(m => m.phase === 'night').every(m => m.secs === 0)), 'auch in Spiel 2 nie ein Nacht-Countdown');
    check(nightLeak === 0, 'TV zeigte in beiden Partien nie ready/Stimmen in der Nacht');

    // Host-Rematch mit < 5 verbundenen Spielern → zurück in die Lobby
    for (const i of [3, 4, 5, 6]) { w.eval('delete players[' + phones[i].id + ']'); }
    host.send({ t: 'wwAgain' }); await sleep(100);
    check(w.eval('active') === null, 'Rematch mit weniger als 5 Verbundenen → Lobby');
  } catch (e) {
    fail(e.message);
    if (!/^Timeout/.test(e.message)) console.error(e.stack);
  }
  console.log(process.exitCode ? '❌ Werwolf-Flow fehlgeschlagen' : '✅ Alle Werwolf-Flow-Checks bestanden');
  process.exit(process.exitCode || 0);

  function WW(x) { return x; }
  function idsHas(ids, role) { return ids.some(i => roles()[i] === role); }
})();
setTimeout(() => { console.error('FEHLER: Gesamt-Timeout (100 s)'); process.exit(1); }, 100000);
