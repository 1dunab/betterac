// Rule tests for "Wer spricht da?": rules.js — recording, the distorted voices, guessing, points. No DOM, no sound.
const R = require('./public/games/werspricht/rules.js');
const SENT = require('./public/games/werspricht/sentences.js');

let checks = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function eq(a, b, msg) { checks++; if (a !== b) fail(msg + ' (expected ' + b + ', got ' + a + ')'); }

ok(SENT.length >= 30 && new Set(SENT).size === SENT.length && SENT.every(s => s.length >= 10 && s.length <= 48), 'at least 30 different sentences, short enough to say in three seconds');
const mk = (cfg, ids, seed) => { const g = R.create({ ids: ids || [1, 2, 3, 4], cfg: cfg || {}, sentences: SENT, seed: seed || 2 }); g.start(0); return g; };
const record = (g, ids, now) => ids.forEach((id, k) => g.clip(id, 100 + id, 2000 + id * 100, now + k));

{
  const g = mk({ runden: 2 }), st = g.state;
  ok(g.cfg.wertung && g.cfg.verzerrung === 'mix', 'points and mixed distortion by default');
  ok(st.phase.kind === 'rec' && SENT.includes(st.phase.text) && st.phase.until === R.REC_MS, 'round one: everybody records the same sentence');
  let v = g.view(1, 0);
  ok(v.canRec && !v.done && v.text === st.phase.text && v.of === 4 && v.left === R.REC_MS && v.rounds === 2, 'every phone may record and knows the sentence');
  ok(g.clip(1, 11, 2000, 100).ok && g.view(1, 100).done && g.view(2, 100).count === 1, 'a recording is in');
  const again = g.clip(1, 12, 2100, 200);
  ok(again.ok && again.old === 11 && st.phase.clips[1].ref === 12, 'a second one replaces the first');
  ok(!g.clip(9, 1, 2000, 300).ok && !g.clip(2, 1, 0, 300).ok, 'not from strangers, not empty');
  ok(!g.guess(1, 2, 300) && !g.replay(300), 'no guessing yet');
  g.clip(2, 13, 2000, 400); g.clip(3, 14, 1500, 500);
  eq(st.phase.until, R.REC_MS, 'three of four: still waiting');
  g.clip(4, 15, 3000, 600);
  eq(st.phase.until, 600 + R.REC_GRACE, 'everybody delivered: a short grace period');
  g.step(600 + R.REC_GRACE);

  // ---- guessing ----
  ok(st.phase.kind === 'guess' && st.phase.items.length === 4 && st.phase.i === 0 && st.phase.voices.join() === '1,2,3,4', 'four voices to guess');
  ok(st.phase.items.every(it => it.rate === R.RATES.hoch || it.rate === R.RATES.tief), 'each one distorted: high or low');
  const it = st.phase.items[0], t0 = st.phase.at, others = [1, 2, 3, 4].filter(x => x !== it.id);
  const q = g.cues();
  ok(q.length === 1 && q[0].ref === it.ref && q[0].rate === it.rate && q[0].at === R.GUESS_IN && Math.abs(q[0].dur - it.dur / it.rate) < 1e-9, 'the TV plays the voice at another speed; a faster voice is shorter');
  eq(g.playing(t0 + R.GUESS_IN + 10), 'verzerrt', 'playing');
  v = g.view(it.id, t0); const vo = g.view(others[0], t0);
  ok(v.mine && v.options.length === 0 && !vo.mine && vo.options.length === 3 && !vo.options.includes(others[0]) && vo.options.includes(it.id) && vo.of === 3, 'everybody but the owner chooses among the other voices');
  eq(vo.high, it.rate > 1, 'the phone knows whether it is the high or the low voice');
  ok(!g.guess(it.id, others[0], t0) && !g.guess(others[0], others[0], t0) && !g.guess(others[0], 9, t0) && !g.guess(9, it.id, t0), 'the owner does not guess; nobody guesses themselves or a stranger');
  ok(g.guess(others[0], others[1], t0 + 100) && g.view(others[0], t0 + 100).guessed === others[1], 'a guess');
  ok(g.guess(others[0], it.id, t0 + 200) && g.view(others[0], t0 + 200).guessed === it.id, 'which can be changed');
  ok(!g.replay(t0 + 300), 'no replay while it plays');
  const end = t0 + g.total();
  ok(g.replay(end) && st.phase.at === end, 'the host lets it play again');
  g.guess(others[1], others[0], end + 100);
  eq(st.phase.kind, 'guess', 'two of three have guessed');
  g.guess(others[2], it.id, end + 200);
  // ---- reveal ----
  ok(st.phase.kind === 'reveal' && st.phase.i === 0, 'everybody guessed: the reveal comes at once');
  eq(it.right.slice().sort().join(), [others[0], others[2]].sort().join(), 'two were right'); eq(it.wrong.join(), String(others[1]), 'one was fooled');
  ok(st.score[others[0]] === 1 && st.score[others[2]] === 1 && st.score[others[1]] === 0 && st.score[it.id] === 1, 'a point for each right guess, and one for the owner per player fooled');
  const rq = g.cues();
  ok(rq[0].rate === 1 && rq[0].dur === it.dur && rq[0].label === 'echt' && rq[0].at === R.REVEAL_IN, 'the TV plays the real voice');
  ok(g.view(others[0], end).right === true && g.view(others[1], end).right === false && g.view(it.id, end).right === null && g.view(it.id, end).fooled === 1 && g.view(others[0], end).by === it.id, 'the phones know whether they were right');
  ok(!g.guess(others[1], it.id, end + 300), 'too late to change');
  const t1 = st.phase.at;
  g.step(t1 + g.total() - 1); eq(st.phase.kind, 'reveal', 'stays for a moment');
  g.step(t1 + g.total());
  ok(st.phase.kind === 'guess' && st.phase.i === 1, 'then the next voice');
  // nobody guesses in time: revealed without points
  const before = JSON.stringify(st.score), t2 = st.phase.at;
  g.step(t2 + g.total() + R.GUESS_MS - 1); eq(st.phase.kind, 'guess', 'waiting for guesses');
  g.step(t2 + g.total() + R.GUESS_MS);
  ok(st.phase.kind === 'reveal' && JSON.stringify(st.score) === before, 'time is up: the reveal, no points');
  // the host hurries through the rest
  for (let i = 0; i < 5; i++) g.skip(1e6);          // reveal, then two more voices with their reveals
  ok(st.phase.kind === 'rec' && st.phase.round === 2, 'after the last voice: round two with a new sentence');
  g.skip(2e6);
  ok(st.phase.kind === 'over' && st.over, 'nobody recorded in the last round: over');
  const best = Math.max(...Object.values(st.score));
  ok(g.winners().length >= 1 && g.winners().every(id => st.score[id] === best) && g.view(g.winners()[0], 0).won, 'the most points win');
}
{
  // distortion settings, no points, too few voices, leaving and joining
  const hi = mk({ verzerrung: 'hoch', runden: 1 }); record(hi, [1, 2, 3, 4], 0); hi.skip(10);
  ok(hi.state.phase.items.every(it => it.rate === R.RATES.hoch), 'chipmunk only');
  const lo = mk({ verzerrung: 'tief', runden: 1 }); record(lo, [1, 2, 3, 4], 0); lo.skip(10);
  ok(lo.state.phase.items.every(it => it.rate === R.RATES.tief) && lo.cues()[0].dur > lo.state.phase.items[0].dur, 'monster only, and a slower voice is longer');
  let rates = new Set();
  for (let seed = 1; seed < 12; seed++) { const m = mk({ runden: 1 }, [1, 2, 3, 4], seed); record(m, [1, 2, 3, 4], 0); m.skip(10); m.state.phase.items.forEach(it => rates.add(it.rate)); }
  eq(rates.size, 2, 'mixed: both appear');

  const n = mk({ wertung: 'aus', runden: 1 }, [1, 2, 3]); record(n, [1, 2, 3], 0); n.skip(10);
  const it = n.state.phase.items[0], o = [1, 2, 3].filter(x => x !== it.id);
  n.guess(o[0], it.id, 20); n.guess(o[1], it.id, 30);
  ok(n.state.phase.kind === 'reveal' && it.right.length === 2 && n.state.score[o[0]] === 0, 'without points the reveal still says who was right');
  n.skip(40); n.skip(50); n.skip(60); n.skip(70); n.skip(80);
  ok(n.state.over && n.winners().length === 0 && !n.view(1, 0).won, 'and nobody wins');

  const few = mk({ runden: 2 }, [1, 2, 3]); few.clip(1, 5, 2000, 0); few.skip(10);
  ok(few.state.phase.kind === 'rec' && few.state.phase.round === 2, 'one voice only: nothing to guess, next round');

  const l = mk({ runden: 1 }, [1, 2, 3, 4]); record(l, [1, 2, 3], 0);
  l.leave(4, 50);
  eq(l.state.phase.until, 50 + R.REC_GRACE, 'the one who had not recorded leaves: everybody else is in');
  l.step(50 + R.REC_GRACE);
  const li = l.state.phase.items[0], lo2 = [1, 2, 3].filter(x => x !== li.id);
  l.join(7);
  ok(l.view(7, 0).options.length === 3 && l.view(7, 0).of === 3, 'a latecomer can guess along');
  l.guess(lo2[0], li.id, 60); l.guess(7, lo2[0], 61);
  eq(l.state.phase.kind, 'guess', 'one guess is still missing');
  l.leave(lo2[1], 70);
  ok(l.state.phase.kind === 'reveal' && li.right.join() === String(lo2[0]) && li.wrong.join() === '7', 'the missing one leaves: everybody left has guessed');
  l.skip(80);
  const next = l.state.phase.items[1];
  ok(l.state.phase.kind === 'guess' && l.view(7, 80).options.includes(lo2[1]), 'a voice of somebody who left can still be the answer');
  ok(next.id !== li.id, 'next voice');
}

console.log(process.exitCode ? '❌ Wer-spricht-da-Regeln fehlgeschlagen' : '✅ Wer spricht da?: ' + checks + ' Regel-Checks bestanden');
