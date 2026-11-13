// Rule tests for Rückwärtsgang: clip.js (the sums on a recording) and rules.js (turns, what the TV plays when,
// recap, vote). No DOM, no sound: a recording is a made-up wave or just a number.
const C = require('./public/core/voiceclip.js');
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
const mk = (cfg, ids, seed) => { const g = R.create({ ids: ids || [1, 2, 3], cfg: Object.assign({ modus: 'einzeln' }, cfg), words: WORDS, seed: seed || 3 }); g.start(0); return g; };
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

// ---- mode "alle dasselbe Wort" ----
const mkAll = (cfg, ids, seed) => { const g = R.create({ ids: ids || [1, 2, 3], cfg: Object.assign({ modus: 'alle' }, cfg), words: WORDS, seed: seed || 3 }); g.start(0); return g; };
{
  eq(R.create({ ids: [1], cfg: {}, words: WORDS }).cfg.modus, 'alle', 'the default mode is "alle"');
  const g = mkAll({ anzahl: 2, wertung: 'an', stufe: 'leicht' }), st = g.state;
  const sp = st.phase.id, others = [1, 2, 3].filter(x => x !== sp);
  ok(st.phase.kind === 'say' && st.phase.round === 1 && WORDS.leicht.includes(st.phase.word), 'round one: a speaker and a word');
  let v = g.view(sp, 0), vo = g.view(others[0], 0);
  ok(v.modus === 'alle' && v.mine && v.canRec && !vo.mine && !vo.canRec && vo.cur === sp && v.rounds === 2, 'only the speaker can record the word');
  ok(!g.clip(others[0], 1, 500, 10).ok, 'nobody else');
  ok(g.clip(sp, 10, 800, 1000).ok && st.phase.kind === 'listen', 'the word is in: everybody listens');
  eq(g.cues().map(c => c.label + c.rev).join(), 'vorfalse,zuruecktrue', 'forwards, then backwards');
  ok(!g.done(sp, 1500) && !g.replay(sp, 1500), 'not while the TV is playing');
  const end = 1000 + g.total();
  ok(!g.done(others[0], end) && !g.replay(others[0], end) && !g.again(others[0], end).ok, 'replay, again and "go" are the speaker\'s');
  ok(g.replay(sp, end) && st.phase.at === end, 'the speaker lets everybody hear it again');
  const back = g.again(sp, end + 5000);
  ok(back.ok && back.old === 10 && st.phase.kind === 'say', 'or says the word again');
  g.clip(sp, 11, 800, end + 6000);
  const t0 = end + 6000 + g.total();
  ok(g.done(sp, t0), 'the speaker says go');
  // everybody at once
  ok(st.phase.kind === 'rec' && st.phase.turn === null && st.phase.until === t0 + R.REC_MS, 'everybody records at once, with a time limit');
  v = g.view(others[0], t0);
  ok(v.canRec && !v.reihum && !v.done && v.count === 0 && v.of === 3 && v.left === R.REC_MS && g.view(sp, t0).canRec, 'every phone may record, the speaker too');
  ok(g.clip(others[0], 21, 700, t0 + 100).ok && g.view(others[0], t0 + 100).done && g.view(sp, t0 + 100).count === 1, 'a recording is in');
  const again = g.clip(others[0], 22, 650, t0 + 200);
  ok(again.ok && again.old === 21 && st.phase.clips[others[0]].ref === 22, 'a second one replaces the first');
  g.clip(sp, 23, 700, t0 + 300);
  eq(st.phase.until, t0 + R.REC_MS, 'two of three: still waiting');
  g.clip(others[1], 24, 900, t0 + 400);
  eq(st.phase.until, t0 + 400 + R.REC_GRACE, 'everybody delivered: a short grace period');
  g.step(t0 + 400 + R.REC_GRACE);
  // the show
  ok(st.phase.kind === 'show' && st.phase.items.length === 3 && st.phase.i === 0, 'the show: three imitations');
  eq(st.phase.items.map(it => it.ref).sort().join(), '22,23,24', 'each player\'s last recording');
  let it = st.phase.items[0], t1 = st.phase.at;
  eq(g.cues().map(c => c.label + c.ref + c.rev).join(), 'ergebnis' + it.ref + 'true', 'an imitation is played backwards');
  eq(g.total(), R.SHOW_IN + it.dur + R.CLAP_MS, 'with time to clap after it');
  const fan = [1, 2, 3].find(x => x !== it.id);
  v = g.view(it.id, t1); vo = g.view(fan, t1);
  ok(v.mine && !v.canClap && vo.canClap && !vo.mine && vo.by === it.id && vo.i === 1 && vo.n === 3, 'everybody but its owner may clap');
  ok(!g.clap(it.id) && !g.clap(9), 'no applause for yourself, none from strangers');
  const rev0 = st.rev;
  for (let i = 0; i < R.CLAP_MAX + 5; i++) g.clap(fan);
  ok(it.total === R.CLAP_MAX && it.claps[fan] === R.CLAP_MAX, 'taps count up to a limit per player');
  eq(st.rev, rev0, 'clapping does not make the screen talk to every phone');
  g.step(t1 + g.total() - 1); eq(st.phase.i, 0, 'still this one');
  g.step(t1 + g.total()); eq(st.phase.i, 1, 'then the next, by itself');
  const second = st.phase.items[1], fan2 = [1, 2, 3].find(x => x !== second.id);
  g.clap(fan2); g.clap(fan2);
  g.skip(t1 + 9000); eq(st.phase.i, 2, 'the host can hurry');
  g.skip(t1 + 9001);
  // the result
  ok(st.phase.kind === 'result' && g.cues().map(c => c.label + c.ref + c.rev).join() === 'original11false', 'after the last one: the original once more');
  ok(st.score[it.id] === R.CLAP_MAX && st.score[second.id] === 2, 'applause is the score');
  ok(g.view(it.id, 0).best && g.view(it.id, 0).claps === R.CLAP_MAX && !g.view(second.id, 0).best && g.view(second.id, 0).claps === 2, 'the phones know their applause and who got the most');
  const t2 = st.phase.at;
  g.step(t2 + g.total());
  ok(st.phase.kind === 'say' && st.phase.round === 2 && st.phase.id !== sp, 'round two: another speaker');
  g.skip(t2 + 20000);
  ok(st.phase.kind === 'over' && st.over && g.winners().join() === String(it.id) && g.view(it.id, 0).won, 'after the last word: over, the most applause wins');
}
{
  // one after the other
  const g = mkAll({ aufnahme: 'reihum', anzahl: 1 }, [1, 2, 3]), st = g.state, sp = st.phase.id;
  g.clip(sp, 1, 500, 0);
  g.step(g.total() + R.LISTEN_WAIT - 1); eq(st.phase.kind, 'listen', 'the speaker has not said go yet');
  g.step(g.total() + R.LISTEN_WAIT);
  ok(st.phase.kind === 'rec' && st.phase.turn !== null, 'after a while recording starts by itself, one player at a time');
  const t0 = st.phase.at, first = st.phase.turn, queue = st.phase.queue.slice();
  eq(queue.length, 2, 'the other two wait');
  let v = g.view(first, t0), vq = g.view(queue[1], t0);
  ok(v.reihum && v.canRec && v.wait === 0 && !vq.canRec && vq.wait === 2 && vq.turn === first, 'the phones know whose turn it is and how long they wait');
  ok(!g.clip(queue[0], 5, 500, t0 + 10).ok, 'not out of turn');
  ok(g.clip(first, 6, 500, t0 + 20).ok && st.phase.turn === queue[0] && st.phase.until === t0 + 20 + R.TURN_MS, 'a recording passes the turn on');
  ok(!g.clip(first, 7, 500, t0 + 30).ok, 'no second go');
  g.step(t0 + 20 + R.TURN_MS);
  eq(st.phase.turn, queue[1], 'who takes too long is passed over');
  g.leave(queue[1], t0 + 40000);
  ok(st.phase.kind === 'show' && st.phase.items.length === 1, 'the last one leaves: the show with what there is');
  ok(g.winners().length === 0 && !g.view(first, 0).canClap, 'scoring off: nobody wins; your own imitation gets no applause from you');
  // nobody imitates; the speaker leaves; a latecomer joins the queue
  const h = mkAll({ anzahl: 2 }, [1, 2]), hs = h.state, s1 = hs.phase.id;
  h.clip(s1, 1, 500, 0); h.skip(10); h.skip(20);
  ok(hs.phase.kind === 'say' && hs.phase.round === 2, 'nobody recorded: no show, next round');
  const s2 = hs.phase.id;
  h.leave(s2, 30);
  ok(hs.phase.kind === 'say' && hs.phase.round === 2 && hs.phase.id === s1, 'the speaker leaves: somebody else speaks this round');
  const k = mkAll({ aufnahme: 'reihum', anzahl: 1 }, [1, 2]), ks = k.state;
  k.clip(ks.phase.id, 1, 500, 0); k.skip(10);
  k.join(7);
  ok(ks.phase.queue.includes(7) && k.view(7, 20).wait === ks.phase.queue.length, 'a latecomer joins the end of the queue');
  const z = mkAll({ anzahl: 1 }, [1, 2]), zs = z.state;
  z.clip(zs.phase.id, 1, 500, 0); z.skip(10);
  z.join(7);
  ok(z.view(7, 20).canRec && z.clip(7, 9, 400, 30).ok, 'with everybody at once a latecomer just records along');
}

console.log(process.exitCode ? '❌ Rückwärtsgang-Regeln fehlgeschlagen' : '✅ Rückwärtsgang: ' + checks + ' Regel-Checks bestanden');
