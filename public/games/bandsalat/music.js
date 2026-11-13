// ===== Bandsalat rules: styles, scales, chords, the bar clock, the grid, loops and step patterns =====
// No DOM and no sound, so it runs in Node (test-bandsalat.js). Time comes in from outside, in seconds.
// A step is a sixteenth; 16 steps are a bar; the chords go round every four bars.
(function (root) {
  // ---- tunables (honest guesses until real people have played) ----
  const SPB = 16, BARS = 4;
  const COMP = 0.04;                 // a tap is assumed to have happened this many seconds before it arrives at the TV
  const MAX_LOOPS = 3;               // recorded loops per player
  const REC_GAP = 2;                 // a recording starts at the next bar line that is at least this many steps away
  const BPM_MIN = 60, BPM_MAX = 160;
  const MIN_HOLD = 0.5;              // shortest held note, in steps
  const SLEEP = 4 * SPB;             // more steps than this in one go: the tab slept, the gap is skipped
  const VEL = { live: 1, loop: 0.8, seq: 0.8, backing: 0.4, finale: 1 };
  const ROWS = 5;                    // rows of a step pattern

  const DRUMS = ['kick', 'snare', 'hat', 'openhat', 'tom', 'crash'];
  const PERC = ['shaker', 'tamb', 'cowbell', 'clap'];
  const BEAT_ROWS = ['openhat', 'hat', 'clap', 'snare', 'kick'];       // top to bottom on the phone
  const KEY_SOUNDS = ['piano', 'epiano', 'orgel', 'synth', 'glocken'];
  const TONE_SOUNDS = ['pling', 'synth', 'bass'];
  // n: how many pads; hold: the note lasts as long as the finger stays down
  const INSTS = { drums: { n: 6 }, keys: { n: 10, hold: true }, bass: { n: 5, hold: true }, perc: { n: 4 }, seq: { n: 0 } };

  const MINOR = [0, 3, 5, 7, 10], MAJOR = [0, 2, 4, 7, 9];              // five-note scales: nothing in them sounds wrong
  const ch = (name, root, minor) => ({ name, root, minor: !!minor });  // root: semitones above the key note
  const pat = (s) => s.split('').map(c => c === 'x' ? 1 : 0);
  const STYLES = {
    lofi: { label: '☕ Lofi', bpm: 80, swing: 0.18, key: 57, scale: MINOR, kit: 'soft', bass: 'round',
      chords: [ch('Am', 0, 1), ch('F', 8), ch('C', 3), ch('Em', 7, 1)],
      beat: { kick: pat('x.....x...x.....'), snare: pat('....x.......x...'), hat: pat('x.x.x.x.x.x.x.x.') } },
    funk: { label: '🕺 Funk', bpm: 104, swing: 0.1, key: 52, scale: MINOR, kit: 'tight', bass: 'pluck',
      chords: [ch('Em', 0, 1), ch('G', 3), ch('A', 5), ch('C', 8)],
      beat: { kick: pat('x..x......x.....'), snare: pat('....x.......x...'), hat: pat('x.x.x.x.x.x.x.x.') } },
    techno: { label: '🔊 Techno', bpm: 126, swing: 0, key: 53, scale: MINOR, kit: 'hard', bass: 'acid',
      chords: [ch('Fm', 0, 1), ch('Fm', 0, 1), ch('D♭', 8), ch('E♭', 10)],
      beat: { kick: pat('x...x...x...x...'), snare: pat('................'), hat: pat('..x...x...x...x.') } },
    lager: { label: '🔥 Lagerfeuer', bpm: 96, swing: 0.06, key: 60, scale: MAJOR, kit: 'tight', bass: 'round',
      chords: [ch('C', 0), ch('G', 7), ch('Am', 9, 1), ch('F', 5)],
      beat: { kick: pat('x.......x.x.....'), snare: pat('....x.......x...'), hat: pat('x...x...x...x...') } }
  };

  // ready-made patterns for the step grid, rows as on the phone
  const BEAT_PRESETS = [
    { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.' },
    { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    { kick: 'x..x..x...x.....', snare: '....x..x.x..x...', hat: 'x.x.x.x.x.x.x.x.', clap: '....x.......x...' },
    { kick: 'x.........x.....', snare: '........x.......', hat: 'x...x...x...x...', openhat: '..............x.' }
  ];
  const TONE_PRESETS = [        // [step, pitch 0..4 from low to high]
    [[0, 0], [3, 2], [6, 4], [8, 0], [11, 2], [14, 3]],
    [[0, 0], [2, 1], [4, 2], [6, 3], [8, 4], [10, 3], [12, 2], [14, 1]],
    [[0, 0], [4, 0], [7, 2], [8, 0], [12, 0], [14, 4]],
    [[0, 4], [3, 4], [6, 2], [10, 3], [12, 0]]
  ];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mod = (a, n) => ((a % n) + n) % n;
  const zeros = () => new Array(ROWS * SPB).fill(0);
  const cells = (a) => a.join('');

  function keyMidi(style, deg, oct) { return style.key + style.scale[mod(deg, 5)] + 12 * Math.floor(deg / 5) + 12 * (oct || 0); }
  // role: 0 root, 1 third, 2 fifth, 3 spice (the seventh in minor, the sixth in major), 4 octave
  function bassMidi(style, ci, role) {
    const c = style.chords[ci];
    let base = style.key + c.root;
    while (base >= 41) base -= 12;
    return base + [0, c.minor ? 3 : 4, 7, c.minor ? 10 : 9, 12][clamp(role | 0, 0, 4)];
  }
  // which of the ten keyboard keys belong to a chord (the phone lights them up)
  function chordKeys(style, ci) {
    const c = style.chords[ci], tones = [c.root, c.root + (c.minor ? 3 : 4), c.root + 7].map(x => mod(x, 12));
    const out = [];
    for (let d = 0; d < 10; d++) if (tones.includes(mod(style.scale[d % 5], 12))) out.push(d);
    return out;
  }

  function create(o) {
    o = o || {};
    const styleKey = STYLES[o.style] ? o.style : 'lofi', style = STYLES[styleKey];
    const grid = o.grid === 0 || o.grid === 2 ? o.grid : 1;        // 1: sixteenths, 2: eighths, 0: off
    const backing = ['off', 'click', 'beat'].includes(o.backing) ? o.backing : 'click';
    const tr = { bpm: style.bpm, t0: o.t || 0, s0: 0 };
    const st = { styleKey, style, grid, backing, players: {}, order: [], loops: [], over: false, finalAt: null, bar: 0 };
    let cursor = 0, lastBar = -1, nextId = 1;

    const stepDur = () => 15 / tr.bpm;
    const stepOf = (t) => tr.s0 + (t - tr.t0) / stepDur();
    // off-beat sixteenths come a little late when the style swings
    function timeOf(step) {
      const r = Math.round(step), odd = Math.abs(step - r) < 1e-6 && (r & 1);
      return tr.t0 + (step - tr.s0 + (odd ? style.swing : 0)) * stepDur();
    }
    const chordAt = (step) => mod(Math.floor(step / SPB), BARS);
    const loopsOf = (id) => st.loops.filter(l => l.owner === id);

    // one sounding note, ready for the synth and the stage. h: height in the player's lane, 0 low to 1 high
    function mk(owner, inst, n, step, src, x) {
      x = x || {};
      const ci = chordAt(step + 1e-6), p = st.players[owner];
      const e = { t: timeOf(step), step, owner, inst, n, src, vel: VEL[src] || 1 };
      if (inst === 'drums') { e.v = DRUMS[n]; e.h = n / 5; }
      else if (inst === 'perc') { e.v = PERC[n]; e.h = n / 3; }
      else if (inst === 'beat') { e.v = BEAT_ROWS[n]; e.h = 1 - n / 4; }
      else if (inst === 'backing' || inst === 'click') { e.v = x.v; e.h = 0; }
      else if (inst === 'keys') { e.sound = x.sound || 'piano'; e.midi = keyMidi(style, n, x.oct); e.h = clamp((n + 5 + 5 * (x.oct || 0)) / 19, 0, 1); }
      else if (inst === 'bass') { e.sound = 'bass'; e.midi = bassMidi(style, ci, n); e.h = n / 4; }
      else if (inst === 'tone') {
        const s = p ? p.seq.sound : 'pling', up = 4 - n;
        if (s === 'bass') { e.sound = 'bass'; e.midi = bassMidi(style, ci, up); }
        else if (s === 'synth') { e.sound = 'synth'; e.midi = keyMidi(style, up, 0); }
        else { e.sound = 'glocken'; e.midi = keyMidi(style, up + 5, 0); }
        e.h = up / 4; x.dur = 0.9;
      }
      if (x.dur) e.dur = x.dur * stepDur();
      return e;
    }

    function collect(from, to, notes) {
      // step patterns and the backing sit on whole steps
      for (let s = Math.ceil(from); s < to; s++) {
        const col = mod(s, SPB);
        for (const id of st.order) {
          const q = st.players[id].seq;
          for (let r = 0; r < ROWS; r++) {
            if (q.beat[r * SPB + col]) notes.push(mk(id, 'beat', r, s, 'seq'));
            if (q.tone[r * SPB + col]) notes.push(mk(id, 'tone', r, s, 'seq'));
          }
        }
        if (backing === 'click' && col % 4 === 0) notes.push(mk(0, 'click', 0, s, 'backing', { v: col ? 'click' : 'clickhi' }));
        else if (backing === 'beat') for (const v in style.beat) if (style.beat[v][col]) notes.push(mk(0, 'backing', 0, s, 'backing', { v }));
      }
      // loops play from their second round on: the first one was the recording itself
      for (const l of st.loops) for (const e of l.events) {
        const k = Math.max(1, Math.ceil((from - l.start - e.pos) / l.len));
        for (let abs = l.start + e.pos + k * l.len; abs < to; abs += l.len) {
          if (e.skip !== undefined && abs <= e.skip) continue;
          notes.push(mk(l.owner, l.inst, e.n, abs, 'loop', { oct: e.oct, sound: l.sound, dur: INSTS[l.inst].hold ? (e.dur || 1) : 0 }));
        }
      }
    }

    function makeLoop(p, r) {
      r.loop = { id: nextId++, owner: p.id, inst: r.inst, sound: r.sound, start: r.start, len: r.len, events: r.events };
      st.loops.push(r.loop);
    }

    function barInfo(t) {
      const s = stepOf(t), ci = chordAt(s);
      return { bar: ci, chord: style.chords[ci].name, next: style.chords[(ci + 1) % BARS].name, hi: chordKeys(style, ci),
        bpm: tr.bpm, stepMs: Math.round(stepDur() * 1e4) / 10, pos: Math.round(mod(s, SPB) * 100) / 100 };
    }

    const band = {
      state: st, style, tr, stepOf, timeOf, stepDur, chordAt, loopsOf, barInfo,

      join(id) {
        if (st.players[id]) return st.players[id];
        st.order.push(id);
        return (st.players[id] = { id, inst: null, sound: 'piano', oct: 0, len: 1, held: {}, last: {}, rec: null, notes: 0, flash: null,
          seq: { beat: zeros(), tone: zeros(), sound: 'pling', preset: { beat: -1, tone: -1 } } });
      },
      // a player who leaves takes their loops and patterns along. Returns the held notes to let go
      leave(id, t) {
        const offs = band.releaseAll(id, t);
        st.order = st.order.filter(x => x !== id); delete st.players[id];
        st.loops = st.loops.filter(l => l.owner !== id);
        return offs;
      },
      pick(id, inst, t) {
        const p = st.players[id];
        if (!p || (inst !== null && !INSTS[inst])) return [];
        const offs = band.releaseAll(id, t);
        if (p.rec && p.rec.inst !== inst) p.rec = null;
        p.inst = inst; p.last = {};
        return offs;
      },
      set(id, o) {
        const p = st.players[id];
        if (!p || !o) return;
        if (KEY_SOUNDS.includes(o.sound)) p.sound = o.sound;
        if (o.oct === -1 || o.oct === 0 || o.oct === 1) p.oct = o.oct;
        if (o.len === 1 || o.len === 2 || o.len === 4) p.len = o.len;
      },

      // a pad goes down. Returns the notes to play now (none, or one)
      noteOn(id, n, t) {
        const p = st.players[id], I = p && INSTS[p.inst];
        n = n | 0;
        if (!I || st.over || !(n >= 0 && n < I.n)) return [];
        const inst = p.inst, raw = stepOf(t - COMP);
        const slot = grid ? Math.round(raw / grid) * grid : Math.round(raw * 100) / 100;
        if (grid && p.last[n] === slot) return [];           // twice on the same grid line is once
        p.last[n] = slot;
        const e = mk(id, inst, n, slot, 'live', { oct: p.oct, sound: p.sound });
        e.t = Math.max(t, e.t);                              // the nearest grid line may already be over: then now
        let ev = null;
        const r = p.rec;
        if (r && r.inst === inst) {
          const rel = slot - r.start;
          let pos = null, skip;
          if (rel >= -0.5 && rel < r.len - 0.5) pos = Math.max(0, rel);
          else if (rel >= r.len - 0.5 && rel < r.len + 0.5) { pos = 0; skip = r.start + r.len; }   // early for the next "one"
          if (pos !== null && !r.events.some(x => x.pos === pos && x.n === n && x.oct === p.oct)) {
            ev = { pos, n, oct: p.oct, dur: 0 };
            if (skip !== undefined) ev.skip = skip;
            r.events.push(ev);
          }
        }
        if (I.hold) { e.hold = id + ':' + n; p.held[n] = { slot, when: e.t, ev }; }
        p.notes++;
        return [e];
      },
      noteOff(id, n, t) {
        const p = st.players[id], h = p && p.held[n];
        if (!h) return null;
        delete p.held[n];
        const dur = Math.max(MIN_HOLD, stepOf(t - COMP) - h.slot);
        if (h.ev) h.ev.dur = Math.min(dur, SPB * 4);
        return { hold: id + ':' + n, t: Math.max(t, h.when + MIN_HOLD * stepDur()) };
      },
      releaseAll(id, t) {
        const p = st.players[id];
        return p ? Object.keys(p.held).map(n => band.noteOff(id, +n, t)).filter(Boolean) : [];
      },

      // ⏺: record from the next bar line, for as many bars as the player chose. Pressed again: forget it
      rec(id, t) {
        const p = st.players[id];
        if (!p || st.over) return 'no';
        if (p.rec) { p.rec = null; return 'cancel'; }
        if (!INSTS[p.inst] || p.inst === 'seq') return 'no';
        if (loopsOf(id).length >= MAX_LOOPS) return 'full';
        p.rec = { start: Math.ceil((stepOf(t) + REC_GAP) / SPB) * SPB, len: p.len * SPB, inst: p.inst, sound: p.sound, events: [], on: false, loop: null };
        return 'armed';
      },
      del(id, loopId) {
        const n = st.loops.length;
        st.loops = st.loops.filter(l => !(l.owner === id && l.id === loopId));
        return st.loops.length < n;
      },

      // ---- the step grid: one bar of beat and one bar of tones per player ----
      cell(id, kind, r, s, on) {
        const p = st.players[id];
        r = r | 0; s = s | 0;
        if (!p || (kind !== 'beat' && kind !== 'tone') || !(r >= 0 && r < ROWS && s >= 0 && s < SPB)) return false;
        if (on && !p.seq[kind][r * SPB + s]) p.notes++;          // building a pattern counts on the end screen too
        p.seq[kind][r * SPB + s] = on ? 1 : 0;
        return true;
      },
      seqClear(id, kind) {
        const p = st.players[id];
        if (p && (kind === 'beat' || kind === 'tone')) { p.seq[kind] = zeros(); p.seq.preset[kind] = -1; }
      },
      seqPreset(id, kind) {
        const p = st.players[id];
        if (!p || (kind !== 'beat' && kind !== 'tone')) return;
        const list = kind === 'beat' ? BEAT_PRESETS : TONE_PRESETS, i = (p.seq.preset[kind] + 1) % list.length, a = zeros();
        if (kind === 'beat') BEAT_ROWS.forEach((v, r) => { if (list[i][v]) pat(list[i][v]).forEach((on, s) => { a[r * SPB + s] = on; }); });
        else list[i].forEach(([s, up]) => { a[(4 - up) * SPB + s] = 1; });
        p.seq[kind] = a; p.seq.preset[kind] = i; p.notes += a.filter(Boolean).length;
      },
      seqSound(id, s) { const p = st.players[id]; if (p && TONE_SOUNDS.includes(s)) p.seq.sound = s; },

      // ---- host ----
      tempo(delta, t) {
        const s = stepOf(t);
        tr.bpm = clamp(tr.bpm + (delta | 0), BPM_MIN, BPM_MAX); tr.s0 = s; tr.t0 = t;
        return tr.bpm;
      },
      clear() {
        st.loops = [];
        for (const id of st.order) { const p = st.players[id]; p.rec = null; band.seqClear(id, 'beat'); band.seqClear(id, 'tone'); }
      },
      finale(t) {
        if (st.over || st.finalAt !== null) return;
        st.finalAt = Math.ceil((stepOf(t) + 1) / SPB) * SPB;
        for (const id of st.order) st.players[id].rec = null;
      },

      // Call every frame. `ahead`: seconds to look ahead, so that the synth gets its notes before they are due.
      // Returns the notes of loops, patterns and backing, the bar lines crossed and whose phone needs news.
      advance(t, ahead) {
        const out = { notes: [], bars: [], changed: [], finale: false };
        if (st.over) return out;
        const now = stepOf(t), to = stepOf(t + (ahead || 0));
        if (to - cursor > SLEEP) cursor = to - 1;
        if (st.finalAt !== null && to >= st.finalAt) {
          collect(cursor, st.finalAt, out.notes);
          const at = st.finalAt, c0 = style.chords[0];
          [0, c0.minor ? 3 : 4, 7, 12].forEach(x => {
            const e = mk(0, 'keys', 0, at, 'finale', { sound: 'piano', dur: 28 });
            e.midi = style.key + c0.root + x; e.h = 0; out.notes.push(e);
          });
          const b = mk(0, 'bass', 0, at, 'finale', { dur: 24 }); b.midi = bassMidi(style, 0, 0); out.notes.push(b);
          ['crash', 'kick'].forEach(v => out.notes.push(mk(0, 'backing', 0, at, 'finale', { v })));
          st.over = true; st.overT = timeOf(at); out.finale = true;
          for (const id of st.order) out.changed.push(id);
          cursor = to;
          return out;
        }
        // a recording becomes a loop as soon as the look-ahead reaches its end: in time for the second round
        for (const id of st.order) { const p = st.players[id], r = p.rec; if (r && !r.loop && r.events.length && to >= r.start + r.len) makeLoop(p, r); }
        collect(cursor, to, out.notes);
        cursor = to;
        for (const id of st.order) {
          const p = st.players[id], r = p.rec;
          if (!r) continue;
          if (!r.on && now >= r.start) { r.on = true; out.changed.push(id); }
          if (now >= r.start + r.len) {
            if (!r.loop && r.events.length) makeLoop(p, r);
            p.rec = null; p.flash = r.loop ? 'loop' : 'empty'; out.changed.push(id);
          }
        }
        const bar = Math.floor(now / SPB);
        if (bar !== lastBar) { lastBar = bar; st.bar = bar; out.bars.push(barInfo(t)); }
        return out;
      },

      // what a player's phone needs to know about them
      you(id, t) {
        const p = st.players[id];
        if (!p) return null;
        const d = stepDur() * 1000, r = p.rec, flash = p.flash;
        p.flash = null;
        return { inst: p.inst, sound: p.sound, oct: p.oct, len: p.len, notes: p.notes, flash,
          full: loopsOf(id).length >= MAX_LOOPS,
          loops: loopsOf(id).map(l => ({ id: l.id, inst: l.inst, bars: l.len / SPB })),
          rec: r ? { on: r.on, inMs: Math.max(0, Math.round((r.start - stepOf(t)) * d)), lenMs: Math.round(r.len * d) } : null,
          seq: { beat: cells(p.seq.beat), tone: cells(p.seq.tone), sound: p.seq.sound } };
      }
    };
    return band;
  }

  const api = { SPB, BARS, COMP, MAX_LOOPS, ROWS, BPM_MIN, BPM_MAX, STYLES, INSTS, DRUMS, PERC, BEAT_ROWS, KEY_SOUNDS, TONE_SOUNDS,
    BEAT_PRESETS, TONE_PRESETS, keyMidi, bassMidi, chordKeys, create };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BandMusic = api;
})(typeof window !== 'undefined' ? window : globalThis);
