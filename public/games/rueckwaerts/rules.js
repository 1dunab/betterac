// ===== Rückwärtsgang rules: whose turn it is, what is said, and what the TV plays when =====
// No DOM and no sound, so it runs in Node (test-rueckwaerts.js). A recording is only a handle here (`ref`) with
// its length; the screen keeps the samples. Time comes in from outside, in milliseconds.
//
// A turn:  say     the player speaks the word                       → recording A
//          listen  the TV plays A forwards, then backwards; the player imitates the backwards sound → recording B
//          reveal  the TV plays B backwards (that should sound like the word), then A again to compare
// After all turns: recap (every original and its result once more), vote (if scoring is on), over.
(function (root) {
  // ---- tunables: the pauses around what the TV plays, in ms ----
  const LISTEN_IN = 500, LISTEN_MID = 700;      // before the original / between original and its reverse
  const DRUM = 1300, COMPARE = 1000;            // drum roll before the result / pause before the original for comparison
  const RECAP_IN = 900, RECAP_MID = 700, RECAP_OUT = 1400;
  const VOTE_MS = 60000;
  const LEVELS = ['leicht', 'mittel', 'schwer'];

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function create(o) {
    const c = o.cfg || {};
    const cfg = { woerter: c.woerter === 'frei' ? 'frei' : 'liste', stufe: LEVELS.includes(c.stufe) ? c.stufe : 'mittel',
      runden: clamp(c.runden | 0 || 1, 1, 3), wertung: c.wertung === 'an' || c.wertung === true };
    const rng = mulberry32(o.seed === undefined ? 1 : o.seed);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const list = (o.words && o.words[cfg.stufe]) || [];
    let deck = [];
    const word = () => { if (cfg.woerter === 'frei' || !list.length) return null; if (!deck.length) deck = shuffle(list.slice()); return deck.pop(); };

    const st = { cfg, players: o.ids.slice(), turns: [], t: -1, phase: null, results: [], score: {}, over: false, rev: 0 };
    const order = shuffle(o.ids.slice());
    for (let r = 1; r <= cfg.runden; r++) order.forEach(id => st.turns.push({ id, round: r, word: word() }));
    st.players.forEach(id => { st.score[id] = 0; });

    const set = (ph) => { st.phase = ph; st.rev++; };
    function nextTurn(now) {
      do { st.t++; } while (st.t < st.turns.length && !st.players.includes(st.turns[st.t].id));
      if (st.t < st.turns.length) { const tu = st.turns[st.t]; set({ kind: 'say', id: tu.id, word: tu.word, round: tu.round, at: now, tries: 0 }); }
      else if (st.results.length) set({ kind: 'recap', i: 0, at: now });
      else finish();
    }
    function afterRecap(now) {
      const owners = new Set(st.results.map(r => r.id));
      if (cfg.wertung && owners.size >= 2 && st.players.length >= 2) set({ kind: 'vote', votes: {}, until: now + VOTE_MS });
      else finish();
    }
    function finish() {
      if (st.phase && st.phase.kind === 'vote') for (const v in st.phase.votes) { const r = st.results[st.phase.votes[v]]; st.score[r.id] = (st.score[r.id] || 0) + 1; }
      st.over = true; set({ kind: 'over' });
    }
    function keep(now) {
      const ph = st.phase;
      st.results.push({ id: ph.id, word: ph.word, a: ph.a, durA: ph.durA, b: ph.b, durB: ph.durB, tries: ph.tries });
      nextTurn(now);
    }
    // what a voter may choose: every result but their own
    const options = (id) => st.results.map((r, i) => ({ i, id: r.id, word: r.word })).filter(x => x.id !== id);

    const game = {
      state: st, cfg,
      start(now) { nextTurn(now); },

      // What the TV plays in the current phase: [{ at (ms after phase.at), ref, rev, dur, label }]
      cues() {
        const ph = st.phase;
        if (!ph) return [];
        if (ph.kind === 'listen') return [{ at: LISTEN_IN, ref: ph.a, rev: false, dur: ph.durA, label: 'vor' }, { at: LISTEN_IN + ph.durA + LISTEN_MID, ref: ph.a, rev: true, dur: ph.durA, label: 'zurueck' }];
        if (ph.kind === 'reveal') return [{ at: DRUM, ref: ph.b, rev: true, dur: ph.durB, label: 'ergebnis' }, { at: DRUM + ph.durB + COMPARE, ref: ph.a, rev: false, dur: ph.durA, label: 'original' }];
        if (ph.kind === 'recap') { const r = st.results[ph.i]; return [{ at: RECAP_IN, ref: r.a, rev: false, dur: r.durA, label: 'original' }, { at: RECAP_IN + r.durA + RECAP_MID, ref: r.b, rev: true, dur: r.durB, label: 'ergebnis' }]; }
        return [];
      },
      total() { const q = game.cues(), last = q[q.length - 1]; return last ? last.at + last.dur + (st.phase.kind === 'recap' ? RECAP_OUT : 0) : 0; },
      busy(now) { return now < st.phase.at + game.total(); },
      playing(now) { const t = now - st.phase.at, q = game.cues().find(x => t >= x.at && t < x.at + x.dur); return q ? q.label : null; },

      // a recording of the player whose turn it is. `dur` in ms. Returns the handle it replaces, if any
      clip(id, ref, dur, now) {
        const ph = st.phase;
        if (!ph || ph.id !== id || !(dur > 0)) return { ok: false };
        if (ph.kind === 'say') { set({ kind: 'listen', id, word: ph.word, round: ph.round, a: ref, durA: dur, at: now, tries: ph.tries }); return { ok: true }; }
        if (ph.kind === 'listen') { set({ kind: 'reveal', id, word: ph.word, round: ph.round, a: ph.a, durA: ph.durA, b: ref, durB: dur, at: now, tries: ph.tries + 1 }); return { ok: true }; }
        return { ok: false };
      },
      // listen: say the word again. reveal: try the backwards part again. Returns the handle that is thrown away
      again(id, now) {
        const ph = st.phase;
        if (!ph || ph.id !== id) return { ok: false };
        if (ph.kind === 'listen') { const old = ph.a; set({ kind: 'say', id, word: ph.word, round: ph.round, at: now, tries: ph.tries }); return { ok: true, old }; }
        if (ph.kind === 'reveal') { const old = ph.b; set({ kind: 'listen', id, word: ph.word, round: ph.round, a: ph.a, durA: ph.durA, at: now, tries: ph.tries }); return { ok: true, old }; }
        return { ok: false };
      },
      // hear it once more, once the TV has finished
      replay(id, now) {
        const ph = st.phase;
        if (!ph || ph.id !== id || (ph.kind !== 'listen' && ph.kind !== 'reveal') || game.busy(now)) return false;
        ph.at = now; st.rev++;
        return true;
      },
      done(id, now) {
        const ph = st.phase;
        if (!ph || ph.kind !== 'reveal' || ph.id !== id) return false;
        keep(now);
        return true;
      },
      vote(id, i) {
        const ph = st.phase;
        if (!ph || ph.kind !== 'vote' || !st.players.includes(id) || !options(id).some(x => x.i === i)) return false;
        ph.votes[id] = i; st.rev++;
        return true;
      },
      // the host's "weiter": skip a turn that hangs, keep a result, next in the recap, close the vote
      skip(now) {
        const ph = st.phase;
        if (!ph || st.over) return;
        if (ph.kind === 'say' || ph.kind === 'listen') nextTurn(now);
        else if (ph.kind === 'reveal') keep(now);
        else if (ph.kind === 'recap') { if (++ph.i >= st.results.length) afterRecap(now); else { ph.at = now; st.rev++; } }
        else if (ph.kind === 'vote') finish();
      },
      step(now) {
        const ph = st.phase;
        if (!ph || st.over) return;
        if (ph.kind === 'recap') { if (!game.busy(now)) game.skip(now); }
        else if (ph.kind === 'vote') {
          const voters = st.players.filter(id => options(id).length);
          if (now >= ph.until || (voters.length && voters.every(id => ph.votes[id] !== undefined))) finish();
        }
      },

      // who comes later gets a turn at the end for every round that is still running
      join(id) {
        if (st.players.includes(id)) return;
        st.players.push(id); st.score[id] = st.score[id] || 0;
        const round = st.phase && st.phase.round ? st.phase.round : cfg.runden + 1;
        for (let r = round; r <= cfg.runden; r++) st.turns.push({ id, round: r, word: word() });
        st.rev++;
      },
      // who leaves: their results stay in the recap, their open turns are passed over
      leave(id, now) {
        if (!st.players.includes(id)) return;
        st.players = st.players.filter(x => x !== id);
        const ph = st.phase;
        if (ph && ph.id === id && ['say', 'listen', 'reveal'].includes(ph.kind)) nextTurn(now); else st.rev++;
      },
      winners() {
        if (!cfg.wertung) return [];
        const best = Math.max(0, ...st.players.map(id => st.score[id] || 0));
        return best > 0 ? st.players.filter(id => st.score[id] === best) : [];
      },

      // what one phone needs to know (the screen adds names)
      view(id, now) {
        const ph = st.phase, v = { phase: ph.kind, wertung: cfg.wertung, frei: cfg.woerter === 'frei' };
        if (ph.id !== undefined) {
          v.cur = ph.id; v.mine = ph.id === id; v.word = ph.word; v.tries = ph.tries; v.busy = ph.kind !== 'say' && game.busy(now);
          v.busyMs = ph.kind !== 'say' ? Math.max(0, ph.at + game.total() - now) : 0;
          const coming = st.turns.slice(st.t + 1).filter(t => st.players.includes(t.id));
          v.left = coming.length; v.next = coming.slice(0, 3).map(t => t.id);
        } else if (ph.kind === 'recap') { const r = st.results[ph.i]; v.i = ph.i + 1; v.n = st.results.length; v.cur = r.id; v.word = r.word; v.mine = r.id === id; }
        else if (ph.kind === 'vote') { v.options = options(id); v.voted = ph.votes[id] === undefined ? -1 : ph.votes[id]; }
        else if (ph.kind === 'over') { v.score = st.score[id] || 0; v.won = game.winners().includes(id); }
        return v;
      }
    };
    return game;
  }

  const api = { create, mulberry32, LISTEN_IN, LISTEN_MID, DRUM, COMPARE, RECAP_IN, RECAP_MID, RECAP_OUT, VOTE_MS, LEVELS };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RwRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
