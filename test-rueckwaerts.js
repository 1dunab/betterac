// Rule tests for Rückwärtsgang: clip.js (the sums on a recording) and rules.js (turns, what the TV plays when,
// recap, vote). No DOM, no sound: a recording is a made-up wave or just a number.
const C = require('./public/games/rueckwaerts/clip.js');
const R = require('./public/games/rueckwaerts/rules.js');
const WORDS = require('./public/games/rueckwaerts/words.js');

let checks = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function eq(a, b, msg) { checks++; if (a !== b) fail(msg + ' (expected ' + b + ', got ' + a + ')'); }
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg + ' (expected ' + b + ' ± ' + tol + ', got ' + a + ')');

// ---- words ----
for (const k of R.LEVELS) ok(WORDS[k].length >= 30 && new Set(WORDS[k]).size === WORDS[k].length && WORDS[k].every(w => w.length >= 2 && w.length <= 40), k + ': at least 30 different words that fit the TV');

// ---- clip.js ----
// half a second of silence, one second of a rising tone, half a second of silence, at 48 kHz
function wave(rate, amp) {
  const x = new Float32Array(rate * 2);
  for (let i = rate / 2; i < rate * 1.5; i++) { const t = (i - rate / 2) / rate; x[i] = (amp || 0.3) * Math.sin(2 * Math.PI * (200 + 300 * t) * t); }
  return x;
}
{
  const x = wave(48000);
  near(C.peakOf(x), 0.3, 0.005, 'peak');
  const t = C.trim(x, 48000);
  near(t.length / 48000, 1.1, 0.02, 'trim: the silence goes, 50 ms of air stay on both sides');
  near(C.peakOf(C.normalize(x)), 0.9, 1e-6, 'normalize: the loudest sample is 0.9');
  near(C.peakOf(C.normalize(wave(48000, 0.01))), 0.12, 1e-6, 'a whisper is not blown up more than twelve times');
  const d = C.resample(x, 48000, 16000);
  eq(d.length, 32000, 'resample down: a third of the samples'); near(C.peakOf(d), 0.3, 0.02, 'and still the same wave');
  eq(C.resample(d, 16000, 48000).length, 96000, 'resample up');
  eq(C.resample(x, 48000, 48000), x, 'same rate: untouched');
  const r = C.reverse(new Float32Array([1, 2, 3]));
  eq(Array.from(r).join(), '3,2,1', 'reverse'); eq(Array.from(C.reverse(r)).join(), '1,2,3', 'twice reversed is the original');
  const small = new Float32Array([0, 0.5, -0.5, 1, -1, 0.123]);
  const back = C.unpack(C.pack(small));
  ok(back.length === 6 && small.every((v, i) => Math.abs(v - back[i]) < 1e-4), 'pack and unpack: the same samples come back');
  const big = C.unpack(C.pack(d));
  ok(big.length === d.length && Math.abs(big[20000] - d[20000]) < 1e-4, 'also for a long recording');
  ok(C.unpack('not base64!') === null && C.unpack(42) === null && C.unpack('QUJD') === null, 'unpack refuses what is not 16-bit base64');
  eq(C.envelope(x, 4).map(v => v > 0.1 ? 'x' : '.').join(''), '.xx.', 'the envelope shows where the sound is');

  const p = C.prepare(x, 48000);
  ok(p && p.rate === 16000 && Math.abs(p.dur - 1.1) < 0.03 && p.n === C.unpack(p.pcm).length, 'prepare: cut, shrunk to 16 kHz, packed');
  near(C.peakOf(C.unpack(p.pcm)), 0.9, 0.02, 'and levelled');
  ok(p.pcm.length < 60000, 'a second of speech is under 60 KB of text (' + p.pcm.length + ')');
  eq(C.unpack(p.pcm)[0], 0, 'starts at zero: no click');
  eq(C.prepare(new Float32Array(48000), 48000), null, 'silence is no recording');
  eq(C.prepare(wave(48000, 0.004), 48000), null, 'neither is a recording below the noise floor');
  eq(C.prepare(null, 48000), null, 'nor nothing at all');
  const long = new Float32Array(48000 * 9); for (let i = 0; i < long.length; i++) long[i] = 0.4 * Math.sin(i / 20);
  near(C.prepare(long, 48000).dur, C.MAX_SEC, 0.001, 'a long recording is cut to five seconds');
  // the trick the game is built on: reversed imitation of the reverse is the original
  const a = C.unpack(p.pcm), imitation = C.reverse(a), result = C.reverse(imitation);
  ok(a.every((v, i) => v === result[i]), 'a perfect imitation of the backwards sound, played backwards, is the word');
}

// ---- rules.js ----
const mk = (cfg, ids, seed) => { const g = R.create({ ids: ids || [1, 2, 3], cfg: cfg || {}, words: WORDS, seed: seed || 3 }); g.start(0); return g; };
{
  const g = mk({ stufe: 'leicht', runden: 2, wertung: 'an' }), st = g.state;
  eq(st.turns.length, 6, 'three players, two rounds: six turns');
  eq(st.turns.slice(0, 3).map(t => t.id).join(), st.turns.slice(3).map(t => t.id).join(), 'the same order in both rounds');
  ok(st.turns.every(t => WORDS.leicht.includes(t.word)) && new Set(st.turns.map(t => t.word)).size === 6, 'six different easy words');
  const p = st.phase.id, other = [1, 2, 3].find(x => x !== p);
  ok(st.phase.kind === 'say' && st.phase.word === st.turns[0].word, 'first turn: say the word');
  let v = g.view(p, 0), vo = g.view(other, 0);
  ok(v.mine && !vo.mine && vo.cur === p && v.word === vo.word && v.left === 5 && v.next.length === 3 && !v.busy, 'the phones know whose turn it is and who comes next');
  ok(!g.clip(other, 1, 800, 10).ok && !g.clip(p, 1, 0, 10).ok, 'only the player whose turn it is can record, and not nothing');
  ok(!g.replay(p, 10) && !g.done(p, 10) && !g.again(p, 10).ok, 'nothing to replay or finish yet');

  // recording A → listen: forwards, then backwards
  ok(g.clip(p, 11, 800, 1000).ok, 'recording A');
  eq(st.phase.kind, 'listen', 'now listen');
  let q = g.cues();
  eq(q.map(c => c.label + ':' + c.ref + ':' + c.rev).join(' '), 'vor:11:false zurueck:11:true', 'the TV plays it forwards, then backwards');
  eq(q[0].at, R.LISTEN_IN, 'after a short pause'); eq(q[1].at, R.LISTEN_IN + 800 + R.LISTEN_MID, 'the reverse follows the original');
  eq(g.total(), R.LISTEN_IN + 800 + R.LISTEN_MID + 800, 'total length');
  eq(g.playing(1000 + R.LISTEN_IN + 10), 'vor', 'playing: forwards'); eq(g.playing(1000 + R.LISTEN_IN + 800 + 10), null, 'pause'); eq(g.playing(1000 + g.total() - 10), 'zurueck', 'backwards');
  ok(g.busy(1000 + g.total() - 1) && !g.busy(1000 + g.total()), 'busy until the last sound is over');
  ok(g.view(p, 1500).busy && g.view(p, 1500).busyMs === g.total() - 500, 'the phone knows how long the TV is still playing');
  ok(!g.replay(p, 1500), 'no replay while it plays'); ok(!g.replay(other, 9000), 'and not by somebody else');
  ok(g.replay(p, 9000) && st.phase.at === 9000 && g.playing(9000 + R.LISTEN_IN + 1) === 'vor', 'replay starts the sequence again');
  // say it again
  const back = g.again(p, 12000);
  ok(back.ok && back.old === 11 && st.phase.kind === 'say' && st.phase.word === st.turns[0].word, 'not happy with the word: say it again, the old recording goes');
  g.clip(p, 12, 900, 13000);
  // recording B → reveal: the result, then the original
  ok(g.clip(p, 13, 1000, 20000).ok, 'recording B');
  eq(st.phase.kind, 'reveal', 'the reveal'); eq(st.phase.tries, 1, 'first try');
  q = g.cues();
  eq(q.map(c => c.label + ':' + c.ref + ':' + c.rev).join(' '), 'ergebnis:13:true original:12:false', 'B backwards, then A to compare');
  eq(q[0].at, R.DRUM, 'after the drum roll');
  ok(!g.clip(p, 99, 500, 20500).ok, 'no third recording');
  const retry = g.again(p, 30000);
  ok(retry.ok && retry.old === 13 && st.phase.kind === 'listen' && st.phase.a === 12, 'try again: back to listening, the word stays');
  g.clip(p, 14, 950, 31000);
  eq(st.phase.tries, 2, 'second try');
  ok(!g.done(other, 32000), 'only the player says when they are done');
  ok(g.done(p, 40000), 'done');
  const r0 = st.results[0];
  ok(st.results.length === 1 && r0.id === p && r0.a === 12 && r0.b === 14 && r0.durB === 950 && r0.tries === 2 && r0.word === st.turns[0].word, 'the result is kept');
  ok(st.phase.kind === 'say' && st.phase.id === st.turns[1].id && st.phase.id !== p, 'next player');
  // the host skips a turn that hangs, and keeps a result
  const p2 = st.phase.id;
  g.skip(41000);
  ok(st.phase.id === st.turns[2].id && st.results.length === 1, 'skipped: no result, next player');
  const p3 = st.phase.id;
  g.clip(p3, 21, 700, 42000); g.clip(p3, 22, 700, 43000); g.skip(44000);
  ok(st.results.length === 2 && st.results[1].id === p3 && st.phase.round === 2, 'host on a reveal: the result counts, round two starts');
  // round two: play through
  let ref = 30, t = 50000;
  for (const id of [p, p2, p3]) { eq(st.phase.id, id, 'round two, same order'); g.clip(id, ++ref, 600, t); g.clip(id, ++ref, 600, t + 1); g.done(id, t + 2); t += 10; }
  // recap
  ok(st.phase.kind === 'recap' && st.phase.i === 0 && st.results.length === 5, 'all turns done: the recap with five results');
  q = g.cues();
  eq(q.map(c => c.label + ':' + c.ref + ':' + c.rev).join(' '), 'original:12:false ergebnis:14:true', 'each result: the original, then what came out');
  v = g.view(other, t);
  ok(v.phase === 'recap' && v.i === 1 && v.n === 5 && v.cur === p && v.word === r0.word, 'the phones know whose result is playing');
  t = st.phase.at;
  g.step(t + g.total() - 1); eq(st.phase.i, 0, 'plays');
  g.step(t + g.total()); eq(st.phase.i, 1, 'and goes on by itself');
  g.skip(t + 100000); g.skip(t + 100001); g.skip(t + 100002); eq(st.phase.i, 4, 'the host can hurry it');
  g.skip(t + 100003);
  // vote
  eq(st.phase.kind, 'vote', 'scoring on: a vote');
  const opts = g.view(p, 0).options;
  ok(opts.length === 5 - st.results.filter(r => r.id === p).length && opts.every(x => x.id !== p), 'everybody chooses among the others\' results');
  const mineIdx = st.results.findIndex(r => r.id === p), theirs = opts[0].i;
  ok(!g.vote(p, mineIdx) && !g.vote(p, 99) && !g.vote(9, theirs), 'not for yourself, not for nothing, not by a stranger');
  ok(g.vote(p, theirs) && g.view(p, 0).voted === theirs, 'a vote');
  g.step(t + 100100); eq(st.phase.kind, 'vote', 'waits for the others');
  const target = st.results.findIndex(r => r.id === p3);
  g.vote(p2, target); g.vote(p3, mineIdx);
  g.step(t + 100200);
  ok(st.phase.kind === 'over' && st.over, 'everybody voted: over');
  eq(st.score[1] + st.score[2] + st.score[3], 3, 'three votes, three points');
  ok(g.winners().length >= 1 && g.winners().every(id => st.score[id] === Math.max(...Object.values(st.score))), 'the most votes win');
  ok(g.view(g.winners()[0], 0).won, 'the phone knows');
}
{
  // without scoring: no vote. Free words. Nobody records: straight to the end
  const g = mk({ woerter: 'frei', wertung: 'aus' }, [1, 2]), st = g.state;
  ok(st.turns.every(t => t.word === null) && g.view(1, 0).frei, 'free words: the player says what they like');
  const a = st.phase.id, b = a === 1 ? 2 : 1;
  g.clip(a, 1, 500, 0); g.clip(a, 2, 500, 1); g.done(a, 2);
  g.clip(b, 3, 500, 3); g.clip(b, 4, 500, 4); g.done(b, 5);
  eq(st.phase.kind, 'recap', 'recap'); g.skip(6); g.skip(7);
  ok(st.phase.kind === 'over' && g.winners().length === 0, 'no vote, no winner');
  const h = mk({}, [1, 2]); h.skip(0); h.skip(1);
  eq(h.state.phase.kind, 'over', 'nobody recorded anything: no recap, over');
  // the vote closes by itself
  const k = mk({ wertung: 'an' }, [1, 2]), ks = k.state;
  for (let i = 0; i < 2; i++) { const id = ks.phase.id; k.clip(id, 1, 500, 0); k.clip(id, 2, 500, 0); k.done(id, 0); }
  k.skip(0); k.skip(0);
  eq(ks.phase.kind, 'vote', 'vote'); k.step(R.VOTE_MS - 1); eq(ks.phase.kind, 'vote', 'open'); k.step(R.VOTE_MS); eq(ks.phase.kind, 'over', 'closed after a minute');
  // one result only: nothing to vote on
  const m = mk({ wertung: 'an' }, [1, 2]), ms = m.state;
  const id = ms.phase.id; m.clip(id, 1, 500, 0); m.clip(id, 2, 500, 0); m.done(id, 0); m.skip(0); m.skip(0);
  eq(ms.phase.kind, 'over', 'results of one player only: no vote');
}
{
  // leaving and joining
  const g = mk({ runden: 2 }, [1, 2, 3]), st = g.state;
  const a = st.phase.id;
  g.clip(a, 1, 500, 0);
  g.leave(a, 10);
  ok(st.phase.kind === 'say' && st.phase.id === st.turns[1].id && st.results.length === 0, 'the player whose turn it is leaves: on to the next');
  const b = st.phase.id;
  g.join(7); g.join(7);
  eq(st.turns.filter(t => t.id === 7).length, 2, 'a latecomer in round one gets a turn in both rounds');
  eq(g.view(b, 0).left, 5, 'the count of turns to come skips who left and includes who came');
  g.clip(b, 2, 500, 20); g.clip(b, 3, 500, 21); g.done(b, 22);
  const c = st.phase.id;
  g.leave(b, 30);
  eq(st.phase.id, c, 'somebody else leaves: the turn goes on');
  g.clip(c, 4, 500, 40); g.clip(c, 5, 500, 41); g.done(c, 42);
  ok(st.phase.round === 2 && st.phase.id === c, 'round two passes over everybody who left');
  g.skip(50);
  eq(st.phase.id, 7, 'then the latecomer');
  g.skip(60); g.skip(61);
  eq(st.phase.kind, 'recap', 'recap'); eq(st.results.map(r => r.id).join(), b + ',' + c, 'with the result of the player who left');
  const late = mk({ runden: 1 }, [1, 2]);
  late.skip(0); late.skip(1);
  late.join(5);
  eq(late.state.turns.filter(t => t.id === 5).length, 0, 'who joins after the turns are over gets none');
}

console.log(process.exitCode ? '❌ Rückwärtsgang-Regeln fehlgeschlagen' : '✅ Rückwärtsgang: ' + checks + ' Regel-Checks bestanden');
