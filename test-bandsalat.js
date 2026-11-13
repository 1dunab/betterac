// Rule tests for Bandsalat: music.js — the bar clock, the grid, chords, loops, step patterns, the finale.
// No DOM, no sound.
const M = require('./public/games/bandsalat/music.js');

let checks = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function eq(a, b, msg) { checks++; if (a !== b) fail(msg + ' (expected ' + b + ', got ' + a + ')'); }
const near = (a, b, msg) => ok(Math.abs(a - b) < 1e-6, msg + ' (expected ' + b + ', got ' + a + ')');

// techno: 126 BPM, no swing. One step = 15/126 s
const mk = (o) => M.create(Object.assign({ style: 'techno', grid: 1, backing: 'off', t: 0 }, o));
const SD = 15 / 126;
// run the band from t0 to t1 in frames, collect everything it wants played
function run(b, t0, t1, ahead) {
  const out = { notes: [], bars: [], changed: [], finale: false };
  for (let t = t0; t < t1 - 1e-9; t += 1 / 60) {
    const o = b.advance(t, ahead === undefined ? 0.12 : ahead);
    out.notes.push(...o.notes); out.bars.push(...o.bars); out.changed.push(...o.changed); out.finale = out.finale || o.finale;
  }
  return out;
}

// ---- styles are sane ----
for (const k in M.STYLES) {
  const s = M.STYLES[k];
  ok(s.chords.length === M.BARS && s.scale.length === 5 && s.bpm >= M.BPM_MIN && s.bpm <= M.BPM_MAX, k + ': four chords, five notes, a legal tempo');
  for (const v in s.beat) eq(s.beat[v].length, M.SPB, k + ': backing ' + v + ' has 16 steps');
  for (let ci = 0; ci < 4; ci++) {
    ok(M.chordKeys(s, ci).length >= 2, k + ': chord ' + ci + ' lights up keys');
    for (let r = 0; r < 5; r++) { const m = M.bassMidi(s, ci, r); ok(m >= 29 && m <= 52, k + ': bass note in range (' + m + ')'); }
  }
}
M.BEAT_PRESETS.forEach((p, i) => { for (const v in p) ok(p[v].length === 16 && M.BEAT_ROWS.includes(v), 'beat preset ' + i + ': ' + v); });
M.TONE_PRESETS.forEach((p, i) => ok(p.every(([s, u]) => s >= 0 && s < 16 && u >= 0 && u < 5), 'tone preset ' + i + ' fits the grid'));

// ---- keyboard and bass notes ----
{
  const s = M.STYLES.lofi;      // A minor
  eq(M.keyMidi(s, 0, 0), 57, 'key 0 is the key note');
  eq(M.keyMidi(s, 5, 0), 69, 'key 5 is an octave higher');
  eq(M.keyMidi(s, 2, -1), 57 + 5 - 12, 'octave down');
  eq(M.chordKeys(s, 0).join(), '0,1,3,5,6,8', 'Am lights A, C, E in both octaves');
  eq(M.bassMidi(s, 0, 0), 33, 'bass root of Am');
  eq(M.bassMidi(s, 0, 2) - M.bassMidi(s, 0, 0), 7, 'the fifth');
  eq(M.bassMidi(s, 1, 1) - M.bassMidi(s, 1, 0), 4, 'F is major: major third');
  eq(M.bassMidi(s, 0, 3) - M.bassMidi(s, 0, 0), 10, 'minor chord: the spice is the seventh');
}

// ---- the clock ----
{
  const b = mk();
  near(b.stepOf(SD * 16), 16, 'one bar later is step 16');
  near(b.timeOf(32), SD * 32, 'and back');
  b.tempo(+10, SD * 16);
  eq(b.tr.bpm, 136, 'tempo up');
  near(b.stepOf(SD * 16), 16, 'a tempo change does not jump');
  near(b.stepOf(SD * 16 + 15 / 136), 17, 'from there the steps are shorter');
  b.tempo(+500, 3); eq(b.tr.bpm, M.BPM_MAX, 'tempo is capped');
  const sw = M.create({ style: 'lofi', t: 0 }), d = 15 / 80;
  near(sw.timeOf(2), 2 * d, 'even steps are on time');
  near(sw.timeOf(3), (3 + 0.18) * d, 'odd steps swing');
  eq(sw.chordAt(0), 0, 'bar 1'); eq(sw.chordAt(16), 1, 'bar 2'); eq(sw.chordAt(64), 0, 'bar 5 is bar 1 again');
}

// ---- the grid ----
{
  const b = mk();
  b.join(1); b.pick(1, 'drums', 0);
  // a tap that arrives 10 ms before step 8 was made about 50 ms before it: the nearest line is step 8, the note waits for it
  let n = b.noteOn(1, 0, 8 * SD - 0.01);
  eq(n.length, 1, 'a note'); eq(n[0].step, 8, 'pulled onto the line'); near(n[0].t, 8 * SD, 'and played on it');
  eq(n[0].v, 'kick', 'pad 0 is the bass drum');
  // a tap arriving just after the line: the line is over, the note plays at once
  n = b.noteOn(1, 1, 12 * SD + 0.02);
  eq(b.noteOn(1, 3, 15 * SD - 0.03)[0].step, 14, 'a tap nearer to the line before belongs to that one');
  eq(n[0].step, 12, 'still that line'); near(n[0].t, 12 * SD + 0.02, 'played now');
  eq(b.noteOn(1, 1, 12 * SD + 0.03).length, 0, 'the same pad twice on one line counts once');
  eq(b.noteOn(1, 2, 12 * SD + 0.03).length, 1, 'another pad on that line is fine');
  eq(b.noteOn(1, 6, 1).length + b.noteOn(1, -1, 1).length + b.noteOn(9, 0, 1).length, 0, 'unknown pads and players are ignored');
  const e8 = mk({ grid: 2 }); e8.join(1); e8.pick(1, 'drums', 0);
  eq(e8.noteOn(1, 0, 5 * SD + M.COMP)[0].step, 6, 'eighths: step 5 goes to 6');
  const free = mk({ grid: 0 }); free.join(1); free.pick(1, 'drums', 0);
  n = free.noteOn(1, 0, 5.3 * SD + M.COMP);
  near(n[0].step, 5.3, 'grid off: the note stays where it was'); near(n[0].t, 5.3 * SD + M.COMP, 'and plays now');
  eq(free.noteOn(1, 0, 5.31 * SD + M.COMP).length, 1, 'grid off: no merging');
}

// ---- held notes ----
{
  const b = mk();
  b.join(1); b.pick(1, 'keys', 0); b.set(1, { sound: 'orgel', oct: 1 });
  const n = b.noteOn(1, 3, 4 * SD + M.COMP)[0];
  eq(n.hold, '1:3', 'a keyboard note is held'); eq(n.sound, 'orgel', 'with the chosen sound'); eq(n.midi, M.keyMidi(M.STYLES.techno, 3, 1), 'in the chosen octave');
  let off = b.noteOff(1, 3, 4 * SD + M.COMP + 0.01);
  eq(off.hold, '1:3', 'released'); near(off.t, 4 * SD + M.COMP + M_minHold(), 'but not shorter than half a step');
  eq(b.noteOff(1, 3, 9), null, 'releasing twice is nothing');
  b.noteOn(1, 1, 2); b.noteOn(1, 2, 2);
  eq(b.pick(1, 'drums', 2.1).length, 2, 'changing the instrument lets go of everything');
  b.set(1, { sound: 'kazoo', oct: 5, len: 3 });
  const p = b.state.players[1];
  ok(p.sound === 'orgel' && p.oct === 1 && p.len === 1, 'nonsense settings are ignored');
  function M_minHold() { return 0.5 * SD; }
}

// ---- bass follows the chords ----
{
  const b = mk({ style: 'lofi' }), d = 15 / 80;
  b.join(1); b.pick(1, 'bass', 0);
  const a = b.noteOn(1, 0, 2 * d)[0], f = b.noteOn(1, 0, 18 * d)[0];
  eq(a.midi, 33, 'bar 1: A'); eq(f.midi, 29, 'bar 2: F');
  // a note pulled onto the bar line belongs to the new bar
  eq(b.noteOn(1, 0, 32 * d - 0.01)[0].midi, M.bassMidi(M.STYLES.lofi, 2, 0), 'just before the line: already the next chord');
}

// ---- recording a loop ----
{
  const b = mk();
  b.join(1); b.pick(1, 'drums', 0);
  eq(b.rec(1, 3 * SD), 'armed', 'armed');
  const r = b.state.players[1].rec;
  eq(r.start, 16, 'starts at the next bar line'); eq(r.len, 16, 'one bar');
  let y = b.you(1, 3 * SD);
  ok(y.rec && !y.rec.on && Math.abs(y.rec.inMs - 13 * SD * 1000) < 2, 'the phone knows how long until it starts');
  b.noteOn(1, 0, 10 * SD);                               // before the recording: not in the loop
  let o = run(b, 3 * SD, 16 * SD + 0.02);
  ok(o.changed.includes(1) && b.state.players[1].rec.on, 'the recording starts on the line');
  b.noteOn(1, 0, 16 * SD - 0.005);                       // a hair early for the "one": belongs to it
  b.noteOn(1, 1, 20 * SD + M.COMP);
  b.noteOn(1, 0, 24 * SD + M.COMP);
  b.noteOn(1, 2, 31 * SD + M.COMP);
  eq(r.events.map(e => e.pos + ':' + e.n).join(' '), '0:0 4:1 8:0 15:2', 'four hits, where they were played');
  o = run(b, 16 * SD + 0.02, 32 * SD + 0.02);
  eq(b.state.players[1].rec, null, 'the recording ends by itself');
  eq(b.state.loops.length, 1, 'and is a loop');
  eq(b.you(1, 33 * SD).flash, 'loop', 'the phone is told'); eq(b.you(1, 33 * SD).flash, null, 'once');
  ok(o.notes.some(n => n.src === 'loop' && n.step === 32 && n.v === 'kick'), 'the loop\'s "one" is ready in time for the second round');
  eq(o.notes.filter(n => n.src === 'loop' && n.step < 32).length, 0, 'the first round is not played by the loop');
  o = run(b, 32 * SD + 0.02, 64 * SD - 0.13);
  const got = o.notes.filter(n => n.src === 'loop').map(n => n.step + ':' + n.v).join(' ');
  eq(got, '36:snare 40:kick 47:hat 48:kick 52:snare 56:kick 63:hat', 'the loop goes round, every note once');
  ok(o.notes.every(n => n.owner === 1 && n.vel < 1), 'loop notes belong to the player and are a little quieter');
  // delete
  eq(b.del(2, b.state.loops[0].id), false, 'nobody else can delete it');
  eq(b.del(1, b.state.loops[0].id), true, 'the owner can');
  eq(run(b, 64 * SD - 0.13, 80 * SD).notes.length, 0, 'silence');
}
{
  // an empty recording, a cancelled one, the limit, two bars, the early "one" of the next round
  const b = mk();
  b.join(1); b.pick(1, 'keys', 0); b.set(1, { len: 2 });
  b.rec(1, 0);
  eq(b.state.players[1].rec.start, 16, 'armed at step 0: the next line, not this one');
  run(b, 0, 49 * SD);
  eq(b.state.loops.length, 0, 'nothing played: no loop'); eq(b.you(1, 49 * SD).flash, 'empty', 'and the phone says so');
  b.rec(1, 49 * SD); eq(b.rec(1, 50 * SD), 'cancel', 'pressed again: forgotten'); eq(b.state.players[1].rec, null, 'gone');
  b.rec(1, 50 * SD);                                     // starts at 64, two bars → until 96
  eq(b.state.players[1].rec.len, 32, 'two bars');
  run(b, 50 * SD, 70 * SD);
  b.noteOn(1, 4, 70 * SD + M.COMP); b.noteOff(1, 4, 74 * SD + M.COMP);
  run(b, 70 * SD, 96 * SD - 0.01, 0);
  b.noteOn(1, 2, 96 * SD - 0.005);                       // early for the "one" of the second round
  const ev = b.state.players[1].rec.events;
  ok(ev.length === 2 && ev[0].pos === 6 && Math.abs(ev[0].dur - 4) < 1e-6, 'a held note keeps its length');
  ok(ev[1].pos === 0 && ev[1].skip === 96, 'the early note is the loop\'s "one"');
  const o = run(b, 96 * SD - 0.01, 160 * SD - 0.13);
  const mine = o.notes.filter(n => n.src === 'loop');
  eq(mine.map(n => n.step).join(), '102,128,134', 'it is not played twice at step 96, and from then on every round');
  near(mine[0].dur, 4 * SD, 'the loop plays the held note as long as it was held');
  b.pick(1, 'drums', 0); b.set(1, { len: 1 });
  for (let i = 0; i < 2; i++) { const t0 = (160 + i * 34) * SD; b.rec(1, t0); run(b, t0, t0 + 17 * SD); b.noteOn(1, 0, t0 + 18 * SD); run(b, t0 + 17 * SD, t0 + 33 * SD); }
  eq(b.loopsOf(1).length, 3, 'three loops');
  eq(b.rec(1, 230 * SD), 'full', 'the fourth is refused'); ok(b.you(1, 230 * SD).full, 'the phone knows');
  // changing the instrument while armed cancels, a pattern player cannot record
  b.del(1, b.loopsOf(1)[0].id);
  b.rec(1, 230 * SD); b.pick(1, 'bass', 230 * SD); eq(b.state.players[1].rec, null, 'other instrument: recording dropped');
  b.pick(1, 'seq', 230 * SD); eq(b.rec(1, 231 * SD), 'no', 'no recording in the step grid');
  // leaving takes the loops along
  b.join(2); b.leave(1, 232 * SD);
  ok(b.state.loops.length === 0 && b.state.order.join() === '2', 'who leaves takes their loops along');
}

// ---- the step grid ----
{
  const b = mk();
  b.join(1); b.join(2);
  ok(b.cell(1, 'beat', 4, 0, 1) && b.cell(1, 'beat', 3, 4, 1) && b.cell(2, 'tone', 4, 2, 1), 'cells set');
  ok(!b.cell(1, 'beat', 5, 0, 1) && !b.cell(1, 'beat', 0, 16, 1) && !b.cell(1, 'x', 0, 0, 1) && !b.cell(7, 'beat', 0, 0, 1), 'outside the grid: refused');
  let o = run(b, 0, 32 * SD - 0.13);
  eq(o.notes.map(n => n.step + ':' + (n.v || n.sound)).join(' '), '0:kick 2:glocken 4:snare 16:kick 18:glocken 20:snare', 'patterns play every bar, without anybody picking an instrument');
  eq(o.notes[1].midi, M.keyMidi(M.STYLES.techno, 5, 0), 'pling: bottom row is the key note, an octave up');
  b.seqSound(2, 'bass'); b.seqSound(2, 'tuba');
  o = run(b, 32 * SD - 0.13, 48 * SD - 0.13);
  const bs = o.notes.find(n => n.owner === 2);
  ok(bs.sound === 'bass' && bs.midi === M.bassMidi(M.STYLES.techno, 2, 0) && bs.dur > 0, 'as a bass the bottom row is the chord\'s root');
  b.cell(1, 'beat', 4, 0, 0);
  eq(b.you(1, 0).seq.beat.split('1').length - 1, 1, 'a cell switched off');
  b.seqPreset(1, 'beat');
  const y = b.you(1, 0).seq.beat;
  eq(y.slice(4 * 16), 'x...x...x...x...'.replace(/x/g, '1').replace(/\./g, '0'), 'preset 1: four on the floor in the kick row');
  b.seqPreset(1, 'beat'); ok(b.you(1, 0).seq.beat !== y, 'the next press brings the next preset');
  b.seqPreset(1, 'tone'); eq(b.you(1, 0).seq.tone.split('1').length - 1, M.TONE_PRESETS[0].length, 'a tone preset');
  b.seqClear(1, 'beat'); eq(+b.you(1, 0).seq.beat, 0, 'cleared');
  b.clear();
  eq(+b.you(2, 0).seq.tone + +b.you(1, 0).seq.tone, 0, 'the host\'s broom clears everybody\'s');
}

// ---- backing, bar lines ----
{
  const b = mk({ backing: 'click' });
  let o = run(b, 0, 32 * SD - 0.13);
  eq(o.notes.map(n => n.step + n.v).join(' '), '0clickhi 4click 8click 12click 16clickhi 20click 24click 28click', 'the click: quarters, the "one" higher');
  eq(o.bars.map(x => x.chord + '>' + x.next).join(' '), 'Fm>Fm Fm>D♭', 'a message per bar line with this chord and the next');
  ok(o.bars[0].bpm === 126 && Math.abs(o.bars[0].stepMs - SD * 1000) < 0.1 && o.bars[0].hi.length > 0, 'with tempo and the keys to light');
  const bb = mk({ backing: 'beat' });
  o = run(bb, 0, 16 * SD - 0.13);
  ok(o.notes.filter(n => n.v === 'kick').length === 4 && o.notes.every(n => n.owner === 0 && n.vel < 0.5), 'the quiet beat');
  // a tab that slept does not play the gap in one burst
  o = bb.advance(200, 0.12);
  ok(o.notes.length < 12, 'after a long sleep only the present is played (' + o.notes.length + ')');
}

// ---- the finale ----
{
  const b = mk({ backing: 'click' });
  b.join(1); b.pick(1, 'drums', 0); b.cell(1, 'beat', 4, 0, 1);
  run(b, 0, 20 * SD);
  b.rec(1, 20 * SD);
  b.finale(20 * SD);
  eq(b.state.finalAt, 32, 'the song ends on the next bar line'); eq(b.state.players[1].rec, null, 'recordings are dropped');
  const o = run(b, 20 * SD, 40 * SD);
  ok(o.finale && b.state.over, 'over');
  const last = o.notes.filter(n => n.src === 'finale');
  ok(last.length === 7 && last.every(n => n.step === 32) && last.filter(n => n.sound === 'piano').length === 4, 'a last chord with bass and cymbal');
  ok(!o.notes.some(n => n.step >= 32 && n.src !== 'finale'), 'nothing else after it');
  ok(o.changed.includes(1), 'the phones are told');
  eq(b.noteOn(1, 0, 41 * SD).length, 0, 'after the end nothing plays');
  eq(run(b, 40 * SD, 60 * SD).notes.length, 0, 'and the band is silent');
  eq(b.you(1, 0).notes, 1, 'what a player did is counted for the end screen: here one cell of a pattern');
}

console.log(process.exitCode ? '❌ Bandsalat-Regeln fehlgeschlagen' : '✅ Bandsalat: ' + checks + ' Regel-Checks bestanden');
