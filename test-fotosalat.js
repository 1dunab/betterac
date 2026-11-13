// Rule tests for Fotosalat: rules.js — the order of the mini-games, dealing pictures, hearts and votes,
// the zoom riddle, joining and leaving. No DOM, no pictures: a photo is just a number here.
const R = require('./public/games/fotosalat/rules.js');
const ART = require('./public/games/fotosalat/art.js');
const TASKS = require('./public/games/fotosalat/tasks.js');
const fs = require('fs');

let checks = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function eq(a, b, msg) { checks++; if (a !== b) fail(msg + ' (expected ' + b + ', got ' + a + ')'); }

const mk = (cfg, ids, seed) => { const g = R.create({ ids: ids || [1, 2, 3], cfg: Object.assign({ zeit: 60 }, cfg), arts: ART.length, tasks: TASKS.length, seed: seed || 5 }); g.start(0); return g; };
const kinds = (cfg) => R.planFor(cfg).map(p => p.kind + (p.src ? ':' + p.src : '')).join(' ');
let photoNo = 100;
const shoot = (g, ids, now) => ids.forEach(id => g.photo(id, ++photoNo, now));

// ---- the data ----
ok(ART.length >= 24, 'at least 24 paintings: eight players, three rounds, no painting twice');
ART.forEach(a => ok(a.title && a.by && a.year && a.w > 0 && a.h > 0 && fs.existsSync('./public/games/fotosalat/art/' + a.f), 'painting ' + a.f + ' is there with title and painter'));
eq(new Set(ART.map(a => a.f)).size, ART.length, 'no painting twice in the list');
ok(TASKS.length >= 50 && new Set(TASKS).size === TASKS.length && TASKS.every(t => typeof t === 'string' && t.length > 3 && t.length < 60), 'at least 50 different hunt tasks, short enough for the TV');

// ---- the order of phases ----
eq(kinds({ spiel: 'nachmachen', vorlagen: 'gemaelde', runden: 3 }), 'copy:art copy:art copy:art show over', 'paintings: three rounds, then the show');
eq(kinds({ spiel: 'nachmachen', vorlagen: 'posen', runden: 2 }), 'pose copy:pose pose copy:pose show over', 'own poses: strike one, copy one');
eq(kinds({ spiel: 'nachmachen', vorlagen: 'mix', runden: 3 }), 'copy:art pose copy:pose copy:art show over', 'mixed: painting, pose, painting');
eq(kinds({ spiel: 'jagd', runden: 2 }), 'task gallery task gallery over', 'the hunt');
eq(kinds({ spiel: 'zoom', runden: 1 }), 'zshoot riddle over', 'the zoom riddle');
eq(kinds({ spiel: 'mix', runden: 5 }), 'copy:art show task gallery zshoot riddle over', 'the mixed bag: one round of each');

// ---- Nachmachen with paintings ----
{
  const g = mk({ spiel: 'nachmachen', vorlagen: 'gemaelde', runden: 3, wertung: 'an' }), st = g.state;
  eq(st.phase.kind, 'copy', 'starts with copying'); eq(st.rounds, 3, 'three rounds');
  const seen = new Set();
  for (let r = 1, t0 = 0; r <= 3; r++, t0 += 40000 + R.GRACE_MS) {      // each round starts when the one before closed
    const tpl = st.phase.tpl;
    eq(st.phase.round, r, 'round ' + r);
    [1, 2, 3].forEach(id => { ok(tpl[id].art >= 0 && tpl[id].art < ART.length && !seen.has(tpl[id].art), 'everybody gets a painting nobody had yet'); seen.add(tpl[id].art); });
    const v = g.view(1, t0);
    ok(v.phase === 'copy' && v.tpl.art === tpl[1].art && v.left === 60000 && !v.done && v.of === 3, 'the phone knows its painting and the time');
    shoot(g, [1, 2], t0 + 1000);
    g.step(t0 + 30000);
    eq(st.phase.kind + st.phase.round, 'copy' + r, 'two of three delivered: still waiting');
    eq(g.view(1, t0 + 30000).done, true, 'the phone knows it has delivered'); eq(g.view(3, t0 + 30000).count, 2, 'and how many have');
    const first = st.phase.shots[1], again = g.photo(1, ++photoNo, t0 + 31000);
    ok(again.ok && again.old === first && st.phase.shots[1] === photoNo, 'a second photo replaces the first');
    shoot(g, [3], t0 + 40000);
    eq(st.phase.until, t0 + 40000 + R.GRACE_MS, 'everybody delivered: a short grace period');
    g.step(t0 + 40000 + R.GRACE_MS - 1); eq(st.phase.round, r, 'not yet');
    g.step(t0 + 40000 + R.GRACE_MS);
  }
  eq(st.phase.kind, 'show', 'after three rounds: the show'); eq(st.pairs.length, 9, 'nine pairs');
  ok(!g.photo(1, 1, 300000).ok, 'no photos during the show');
  // the show: original alone, then the copy; hearts only for others, only once, only when the copy is visible
  let now = 300000;
  const p0 = st.phase.list[0], other = [1, 2, 3].find(id => id !== p0.by);
  eq(st.phase.step, 0, 'first the original alone');
  ok(!g.heart(other), 'no heart before the copy is shown');
  g.step(now + R.SHOW_ORIG_MS);
  eq(st.phase.step, 1, 'then the copy appears by itself');
  ok(!g.heart(p0.by), 'no heart for your own photo'); ok(g.heart(other), 'a heart for somebody else\'s'); ok(!g.heart(other), 'only one');
  eq(st.score[p0.by], 1, 'a heart is a point');
  const v = g.view(p0.by, now), vo = g.view(other, now);
  ok(v.mine && !vo.mine && vo.hearted && v.i === 1 && v.n === 9 && v.step === 1, 'the phones know whose pair is up');
  g.skip(now);
  eq(st.phase.i, 1, 'the host taps: next pair'); eq(st.phase.step, 0, 'original first again');
  g.skip(now); eq(st.phase.step, 1, 'the host can also reveal early');
  now += 100; g.step(now + R.SHOW_MAX_MS); eq(st.phase.i, 2, 'a pair nobody taps away goes by itself');
  for (let i = 0; i < 40 && st.phase.kind === 'show'; i++) g.skip(now);
  eq(st.phase.kind, 'over', 'after the last pair: over'); ok(st.over, 'flag');
  eq(g.winners().join(), String(p0.by), 'the one heart wins');
  ok(g.view(p0.by, now).won && !g.view(other, now).won && g.view(p0.by, now).score === 1, 'the phones know who won');
  g.skip(now); g.step(now + 1e7); eq(st.phase.kind, 'over', 'over stays over');
}
{
  // nobody delivers: the round has no pairs, the show is skipped
  const g = mk({ spiel: 'nachmachen', vorlagen: 'gemaelde', runden: 1 });
  g.step(60000);
  eq(g.state.phase.kind, 'over', 'no photos at all: straight to the end');
  // without scoring: no hearts, no winner
  const h = mk({ spiel: 'nachmachen', vorlagen: 'gemaelde', runden: 1 });
  shoot(h, [1, 2, 3], 0); h.skip(10); h.skip(20);
  ok(!h.heart(1) && !h.heart(2) && !h.heart(3) && h.winners().length === 0, 'scoring off: no hearts, nobody wins');
}

// ---- Nachmachen with own poses ----
for (let seed = 1; seed <= 30; seed++) {
  const g = mk({ spiel: 'nachmachen', vorlagen: 'posen', runden: 1 }, [1, 2, 3, 4], seed), st = g.state;
  eq(st.phase.kind, 'pose', 'first everybody strikes a pose');
  g.photo(1, 11, 0); g.photo(2, 12, 0); g.photo(3, 13, 0); g.photo(4, 14, 0);
  g.skip(100);
  const tpl = st.phase.tpl;
  ok(st.phase.kind === 'copy' && [1, 2, 3, 4].every(id => tpl[id].pose && tpl[id].by !== id && tpl[id].pose === 10 + tpl[id].by), 'seed ' + seed + ': everybody copies somebody else\'s pose');
  eq(new Set([1, 2, 3, 4].map(id => tpl[id].by)).size, 4, 'seed ' + seed + ': every pose is copied once');
}
{
  // only some strike a pose
  let g = mk({ spiel: 'nachmachen', vorlagen: 'posen', runden: 1 }, [1, 2, 3]);
  g.photo(2, 12, 0); g.skip(100);
  let tpl = g.state.phase.tpl;
  ok(tpl[1].by === 2 && tpl[3].by === 2 && tpl[2].art !== undefined, 'one pose only: the others copy it, its owner gets a painting');
  g = mk({ spiel: 'nachmachen', vorlagen: 'posen', runden: 1 }, [1, 2, 3]);
  g.skip(100);
  ok([1, 2, 3].every(id => g.state.phase.tpl[id].art !== undefined), 'no pose at all: paintings for everybody');
  g = mk({ spiel: 'nachmachen', vorlagen: 'posen', runden: 1 }, [1, 2, 3]);
  g.photo(1, 11, 0); g.photo(2, 12, 0); g.leave(2, 50); g.skip(100);
  tpl = g.state.phase.tpl;
  ok(!tpl[2] && tpl[1].by === 2 && [1, 2].includes(tpl[3].by), 'somebody left after posing: the pose is still copied, they get none');
  // the pair remembers which pose it copied
  g.photo(1, 21, 200); g.skip(300);
  const p = g.state.phase.list[0];
  ok(g.state.phase.kind === 'show' && p.by === 1 && p.shot === 21 && p.tpl.pose === 12 && p.tpl.by === 2, 'the show pairs the pose with its copy');
}

// ---- the hunt ----
{
  const g = mk({ spiel: 'jagd', runden: 2, wertung: 'an' }), st = g.state;
  const t1 = st.phase.task;
  ok(st.phase.kind === 'task' && t1 >= 0 && t1 < TASKS.length && g.view(1, 0).task === t1, 'a task for everybody');
  shoot(g, [1, 3], 1000);
  g.step(60000);
  eq(st.phase.kind, 'gallery', 'time is up: the gallery'); eq(st.phase.items.length, 2, 'with the two photos that came');
  eq(g.view(2, 60000).options.slice().sort().join(), '1,3', 'who took none can vote for both'); eq(g.view(1, 60000).options.join(), '3', 'nobody can vote for themselves');
  ok(!g.vote(1, 1) && !g.vote(1, 2) && !g.vote(9, 1), 'not for yourself, not for somebody without a photo, not by a stranger');
  ok(g.vote(1, 3) && g.vote(2, 3) && g.vote(3, 1), 'votes');
  ok(g.vote(2, 1), 'a vote can be changed'); eq(g.view(2, 60000).voted, 1, 'the phone knows its vote');
  eq(st.score[1] + st.score[3], 0, 'votes count when the gallery closes');
  g.skip(61000);
  ok(st.score[1] === 2 && st.score[3] === 1, 'counted');
  ok(st.phase.kind === 'task' && st.phase.round === 2 && st.phase.task !== t1, 'second round: another task');
  g.step(61000 + 60000);
  eq(st.phase.kind, 'over', 'nobody found anything: no gallery');
  eq(g.winners().join(), '1', 'winner');
  const u = mk({ spiel: 'jagd', runden: 1 });
  shoot(u, [1, 2], 0); u.skip(1);
  ok(!u.vote(1, 2), 'scoring off: no votes');
  u.step(1 + R.GALLERY_MS); eq(u.state.phase.kind, 'over', 'the gallery closes by itself');
}

// ---- the zoom riddle ----
{
  const g = mk({ spiel: 'zoom', runden: 1, wertung: 'an' }, [1, 2, 3]), st = g.state;
  eq(st.phase.kind, 'zshoot', 'first everybody photographs something');
  ok(!g.focus(1, 0.2, 0.2), 'no zoom point before the photo');
  shoot(g, [1, 2], 0);
  ok(g.focus(1, 0.2, 0.8) && !g.focus(1, 2, 0.5), 'the zoom point, inside the photo only');
  eq(JSON.stringify(g.view(1, 0).focus), '{"x":0.2,"y":0.8}', 'the phone gets it back'); eq(g.view(2, 0).focus.x, 0.5, 'default: the middle');
  g.photo(1, 77, 10); eq(g.view(1, 10).focus.x, 0.5, 'a new photo starts in the middle again');
  g.focus(1, 0.2, 0.8);
  g.skip(1000);
  eq(st.phase.kind, 'riddle', 'then the riddles'); eq(st.phase.items.length, 2, 'two photos');
  let it = st.phase.items[0];
  const mine = it.id === 1 ? it : st.phase.items[1];
  ok(mine.ref === 77 && mine.x === 0.2 && mine.y === 0.8, 'photo and zoom point travel together');
  eq(Math.round(g.zoom(1000)), R.ZOOM_START, 'starts zoomed in'); ok(g.zoom(1000 + R.ZOOM_MS / 2) < R.ZOOM_START / 2 && g.zoom(1000 + R.ZOOM_MS / 2) > 1, 'zooms out');
  const owner = it.id, a = [1, 2, 3].find(x => x !== owner);
  const v = g.view(owner, 1000), va = g.view(a, 1000);
  ok(v.owner && !va.owner && v.options.length === 2 && !v.options.includes(owner) && va.by === owner && v.solved === null, 'the photographer gets the others to choose from');
  ok(!g.guess(a, a, 2000) && !g.guess(owner, owner, 2000) && !g.guess(owner, 9, 2000), 'only the photographer decides, never for themselves or a stranger');
  ok(g.guess(owner, a, 1000 + R.ZOOM_MS * 0.2), 'called early');
  ok(st.score[a] === 3 && st.score[owner] === 1, 'early: three points, one for the photo');
  eq(g.zoom(1000 + R.ZOOM_MS * 0.2), 1, 'solved: the whole photo'); eq(g.view(a, 0).solved, a, 'the phones know who got it');
  ok(!g.guess(owner, a, 9000), 'once');
  g.step(1000 + R.ZOOM_MS * 0.2 + R.SOLVED_MS);
  eq(st.phase.i, 1, 'next riddle');
  it = st.phase.items[1];
  const t0 = st.phase.startAt;
  g.step(t0 + R.ZOOM_MS - 1); eq(st.phase.solved, null, 'runs');
  g.step(t0 + R.ZOOM_MS); eq(st.phase.solved.by, 0, 'nobody called it: shown anyway');
  const before = JSON.stringify(st.score);
  ok(!g.guess(it.id, a, t0 + R.ZOOM_MS + 1) && JSON.stringify(st.score) === before, 'too late for points');
  g.step(t0 + R.ZOOM_MS + R.SOLVED_MS);
  eq(st.phase.kind, 'over', 'over');
  // points by thirds; "nobody" gives none; the host can move on
  const h = mk({ spiel: 'zoom', runden: 1, wertung: 'an' }, [1, 2]);
  shoot(h, [1, 2], 0); h.skip(0);
  let o = h.state.phase.items[0].id, x = o === 1 ? 2 : 1;
  h.guess(o, x, R.ZOOM_MS * 0.5); eq(h.state.score[x], 2, 'middle third: two points');
  h.skip(R.ZOOM_MS); eq(h.state.phase.i, 1, 'host: next riddle');
  o = h.state.phase.items[1].id; x = o === 1 ? 2 : 1;
  h.skip(R.ZOOM_MS + 5); eq(h.state.phase.solved.by, 0, 'host on an open riddle: show it');
  ok(!h.guess(o, x, R.ZOOM_MS + 6), 'then it is closed');
  h.skip(R.ZOOM_MS + 7); eq(h.state.phase.kind, 'over', 'and on');
}

// ---- the mixed bag, joining and leaving ----
{
  const g = mk({ spiel: 'mix' }, [1, 2]), st = g.state;
  eq(st.rounds, 3, 'three rounds');
  g.join(3); g.join(3);
  ok(st.players.length === 3 && st.phase.tpl[3].art !== undefined && ![st.phase.tpl[1].art, st.phase.tpl[2].art].includes(st.phase.tpl[3].art), 'a latecomer gets a painting of their own right away');
  shoot(g, [1, 2], 0);
  eq(st.phase.until, 60000, 'with the latecomer missing there is no hurry');
  g.leave(3, 500);
  eq(st.phase.until, 500 + R.GRACE_MS, 'they leave: now everybody has delivered');
  ok(!g.photo(3, 1, 600).ok, 'who left cannot send photos');
  g.step(500 + R.GRACE_MS);
  eq(st.phase.kind, 'show', 'the show of this one round'); eq(st.phase.list.length, 2, 'two pairs');
  g.leave(st.phase.list[0].by, 4000);
  eq(st.phase.list.length, 2, 'who leaves stays in the show');
  g.skip(4000); g.skip(4000); g.skip(4000); g.skip(4000);
  eq(st.phase.kind, 'task', 'then the hunt');
  shoot(g, st.players, 5000); g.skip(5001);
  eq(st.phase.kind, 'gallery', 'gallery'); g.skip(5002);
  eq(st.phase.kind, 'zshoot', 'then the zoom riddle'); shoot(g, st.players, 6000); g.skip(6001);
  eq(st.phase.kind, 'riddle', 'riddle'); g.skip(6002); g.skip(6003);
  eq(st.phase.kind, 'over', 'over');
}

// ---- many players, many rounds: paintings run out only then, and the supply starts again ----
{
  const g = mk({ spiel: 'nachmachen', vorlagen: 'gemaelde', runden: 6 }, [1, 2, 3, 4, 5, 6, 7, 8]);
  const seen = [];
  for (let r = 0; r < 6; r++) { seen.push(...Object.values(g.state.phase.tpl).map(t => t.art)); g.skip(r); }
  eq(new Set(seen.slice(0, 24)).size, 24, 'eight players, three rounds: 24 different paintings');
  ok(seen.every(a => a >= 0 && a < ART.length), 'after that they come round again');
}

console.log(process.exitCode ? '❌ Fotosalat-Regeln fehlgeschlagen' : '✅ Fotosalat: ' + checks + ' Regel-Checks bestanden');
