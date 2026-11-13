// ===== Rückwärtsgang rules: whose turn it is, what is said, and what the TV plays when =====
// No DOM and no sound, so it runs in Node (test-rueckwaerts.js). A recording is only a handle here (`ref`) with
// its length; the screen keeps the samples. Time comes in from outside, in milliseconds.
//
// A turn:  say     the player speaks the word                       → recording A
//          listen  the TV plays A forwards, then backwards; the player imitates the backwards sound → recording B
//          reveal  the TV plays B backwards (that should sound like the word), then A again to compare
// After all turns: recap (every original and its result once more), vote (if scoring is on), over.
//
// That is the mode "jeder sein Wort" (einzeln). In the mode "alle dasselbe Wort" (alle) a round goes:
//          say     one player, a different one each round, speaks the word
//          listen  the TV plays it forwards and backwards; the speaker says when everybody is ready
//          rec     everybody imitates the backwards sound: all at once, or one after the other (reihum)
//          show    one imitation after the other is played backwards; the others clap on their phones
//          result  the original once more, and who got how much applause
(function (root) {
  // ---- tunables: the pauses around what the TV plays, in ms ----
  const LISTEN_IN = 500, LISTEN_MID = 700;      // before the original / between original and its reverse
  const DRUM = 1300, COMPARE = 1000;            // drum roll before the result / pause before the original for comparison
  const RECAP_IN = 900, RECAP_MID = 700, RECAP_OUT = 1400;
  const VOTE_MS = 60000;
  // mode "alle"
  const LISTEN_WAIT = 15000;                    // the speaker does not say "go": recording starts by itself after this
  const REC_MS = 45000, REC_GRACE = 2000;       // everybody at once: time for all / after the last one has delivered
  const TURN_MS = 30000;                        // one after the other: time per player
  const SHOW_IN = 700, CLAP_MS = 3500;          // pause before an imitation / time to clap after it
  const RESULT_IN = 900, RESULT_MS = 5000;
  const CLAP_MAX = 20;                          // taps that count, per player and imitation
  const LEVELS = ['leicht', 'mittel', 'schwer'];

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function create(o) {
    const c = o.cfg || {};
    const cfg = { modus: c.modus === 'einzeln' ? 'einzeln' : 'alle', aufnahme: c.aufnahme === 'reihum' ? 'reihum' : 'zugleich',
      woerter: c.woerter === 'frei' ? 'frei' : 'liste', stufe: LEVELS.includes(c.stufe) ? c.stufe : 'mittel',
      runden: clamp(c.runden | 0 || 1, 1, 3), anzahl: clamp(c.anzahl | 0 || 3, 1, 8), wertung: c.wertung === 'an' || c.wertung === true };
    const rng = mulberry32(o.seed === undefined ? 1 : o.seed);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const list = (o.words && o.words[cfg.stufe]) || [];
    let deck = [];
    const word = () => { if (cfg.woerter === 'frei' || !list.length) return null; if (!deck.length) deck = shuffle(list.slice()); return deck.pop(); };

    if (cfg.modus === 'alle') return createAll(o, cfg, rng, shuffle, word);

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
      clap() { return false; },
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
        const ph = st.phase, v = { phase: ph.kind, modus: 'einzeln', wertung: cfg.wertung, frei: cfg.woerter === 'frei' };
        if (ph.id !== undefined) {
          v.cur = ph.id; v.mine = ph.id === id; v.word = ph.word; v.tries = ph.tries; v.busy = ph.kind !== 'say' && game.busy(now);
          v.canRec = v.mine && ph.kind !== 'reveal';
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

  // ===== mode "alle dasselbe Wort" =====
  function createAll(o, cfg, rng, shuffle, word) {
    const st = { cfg, players: o.ids.slice(), order: shuffle(o.ids.slice()), t: 0, phase: null, results: [], score: {}, over: false, rev: 0 };
    st.players.forEach(id => { st.score[id] = 0; });
    const set = (ph) => { st.phase = ph; st.rev++; };
    const here = (id) => st.players.includes(id);
    // the speaker changes every round; who has left is passed over
    function speaker(round) { for (let k = 0; k < st.order.length; k++) { const id = st.order[(round - 1 + k) % st.order.length]; if (here(id)) return id; } return null; }
    function nextRound(now) {
      st.t++;
      const id = st.t <= cfg.anzahl ? speaker(st.t) : null;
      if (id === null) { st.over = true; set({ kind: 'over' }); return; }
      set({ kind: 'say', id, word: word(), round: st.t, at: now });
    }
    function startRec(now) {
      const ph = st.phase, rec = { kind: 'rec', id: ph.id, word: ph.word, round: ph.round, a: ph.a, durA: ph.durA, at: now, clips: {}, turn: null };
      if (cfg.aufnahme === 'reihum') { rec.queue = st.order.filter(here); rec.turn = rec.queue.shift(); rec.until = now + TURN_MS; }
      else rec.until = now + REC_MS;
      set(rec);
    }
    function nextTurn(now) {
      const ph = st.phase;
      do { ph.turn = ph.queue.length ? ph.queue.shift() : null; } while (ph.turn !== null && !here(ph.turn));
      if (ph.turn === null) closeRec(now); else { ph.until = now + TURN_MS; st.rev++; }
    }
    function closeRec(now) {
      const ph = st.phase, items = shuffle(Object.keys(ph.clips).map(Number)).map(id => ({ id, ref: ph.clips[id].ref, dur: ph.clips[id].dur, claps: {}, total: 0 }));
      if (!items.length) { nextRound(now); return; }
      set({ kind: 'show', id: ph.id, word: ph.word, round: ph.round, a: ph.a, durA: ph.durA, items, i: 0, at: now });
    }
    function showOn(now) {
      const ph = st.phase;
      if (++ph.i < ph.items.length) { ph.at = now; st.rev++; return; }
      if (cfg.wertung) ph.items.forEach(it => { st.score[it.id] = (st.score[it.id] || 0) + it.total; });
      set({ kind: 'result', id: ph.id, word: ph.word, round: ph.round, a: ph.a, durA: ph.durA, items: ph.items, at: now });
    }
    const allIn = (ph) => st.players.length > 0 && st.players.every(id => ph.clips[id]);

    const game = {
      state: st, cfg,
      start(now) { nextRound(now); },
      cues() {
        const ph = st.phase;
        if (!ph) return [];
        if (ph.kind === 'listen') return [{ at: LISTEN_IN, ref: ph.a, rev: false, dur: ph.durA, label: 'vor' }, { at: LISTEN_IN + ph.durA + LISTEN_MID, ref: ph.a, rev: true, dur: ph.durA, label: 'zurueck' }];
        if (ph.kind === 'show') { const it = ph.items[ph.i]; return [{ at: SHOW_IN, ref: it.ref, rev: true, dur: it.dur, label: 'ergebnis' }]; }
        if (ph.kind === 'result') return [{ at: RESULT_IN, ref: ph.a, rev: false, dur: ph.durA, label: 'original' }];
        return [];
      },
      total() { const q = game.cues(), last = q[q.length - 1], k = st.phase.kind; return last ? last.at + last.dur + (k === 'show' ? CLAP_MS : k === 'result' ? RESULT_MS : 0) : 0; },
      busy(now) { return now < st.phase.at + game.total(); },
      playing(now) { const t = now - st.phase.at, q = game.cues().find(x => t >= x.at && t < x.at + x.dur); return q ? q.label : null; },

      clip(id, ref, dur, now) {
        const ph = st.phase;
        if (!ph || !here(id) || !(dur > 0)) return { ok: false };
        if (ph.kind === 'say' && ph.id === id) { set({ kind: 'listen', id, word: ph.word, round: ph.round, a: ref, durA: dur, at: now }); return { ok: true }; }
        if (ph.kind !== 'rec' || (ph.turn !== null && ph.turn !== id)) return { ok: false };
        const old = ph.clips[id] ? ph.clips[id].ref : undefined;
        ph.clips[id] = { ref, dur };
        if (ph.turn !== null) nextTurn(now);                                   // one after the other: the next one
        else { if (allIn(ph)) ph.until = Math.min(ph.until, now + REC_GRACE); st.rev++; }
        return { ok: true, old };
      },
      // the speaker says the word again
      again(id, now) {
        const ph = st.phase;
        if (!ph || ph.kind !== 'listen' || ph.id !== id) return { ok: false };
        const old = ph.a;
        set({ kind: 'say', id, word: ph.word, round: ph.round, at: now });
        return { ok: true, old };
      },
      replay(id, now) {
        const ph = st.phase;
        if (!ph || ph.kind !== 'listen' || ph.id !== id || game.busy(now)) return false;
        ph.at = now; st.rev++;
        return true;
      },
      // the speaker: everybody has heard it, record now
      done(id, now) {
        const ph = st.phase;
        if (!ph || ph.kind !== 'listen' || ph.id !== id || game.busy(now)) return false;
        startRec(now);
        return true;
      },
      vote() { return false; },
      // applause for the imitation that is playing. Does not count for yourself, and only so many taps
      clap(id) {
        const ph = st.phase, it = ph && ph.kind === 'show' ? ph.items[ph.i] : null;
        if (!it || it.id === id || !here(id) || (it.claps[id] || 0) >= CLAP_MAX) return false;
        it.claps[id] = (it.claps[id] || 0) + 1; it.total++;
        return true;
      },
      skip(now) {
        const ph = st.phase;
        if (!ph || st.over) return;
        if (ph.kind === 'say' || ph.kind === 'result') nextRound(now);
        else if (ph.kind === 'listen') startRec(now);
        else if (ph.kind === 'rec') { if (ph.turn !== null) nextTurn(now); else closeRec(now); }
        else if (ph.kind === 'show') showOn(now);
      },
      step(now) {
        const ph = st.phase;
        if (!ph || st.over) return;
        if (ph.kind === 'listen') { if (now >= ph.at + game.total() + LISTEN_WAIT) startRec(now); }
        else if (ph.kind === 'rec') { if (now >= ph.until) { if (ph.turn !== null) nextTurn(now); else closeRec(now); } }
        else if (ph.kind === 'show') { if (!game.busy(now)) showOn(now); }
        else if (ph.kind === 'result') { if (!game.busy(now)) nextRound(now); }
      },
      join(id) {
        if (here(id)) return;
        st.players.push(id); st.order.push(id); st.score[id] = st.score[id] || 0;
        if (st.phase && st.phase.kind === 'rec' && st.phase.turn !== null) st.phase.queue.push(id);
        st.rev++;
      },
      leave(id, now) {
        if (!here(id)) return;
        st.players = st.players.filter(x => x !== id);
        const ph = st.phase;
        if (!ph) return;
        if ((ph.kind === 'say' || ph.kind === 'listen') && ph.id === id) { st.t--; nextRound(now); }       // the word goes to the next speaker's round
        else if (ph.kind === 'rec' && ph.turn === id) nextTurn(now);
        else { if (ph.kind === 'rec' && ph.turn === null && allIn(ph)) ph.until = Math.min(ph.until, now + REC_GRACE); st.rev++; }
      },
      winners() {
        if (!cfg.wertung) return [];
        const best = Math.max(0, ...st.players.map(id => st.score[id] || 0));
        return best > 0 ? st.players.filter(id => st.score[id] === best) : [];
      },
      view(id, now) {
        const ph = st.phase, v = { phase: ph.kind, modus: 'alle', wertung: cfg.wertung, frei: cfg.woerter === 'frei', round: ph.round || 0, rounds: cfg.anzahl };
        if (ph.kind === 'over') { v.score = st.score[id] || 0; v.won = game.winners().includes(id); return v; }
        v.cur = ph.id; v.word = ph.word; v.mine = ph.id === id;
        if (ph.kind === 'say') v.canRec = v.mine;
        else if (ph.kind === 'listen') { v.busy = game.busy(now); v.busyMs = Math.max(0, ph.at + game.total() - now); }
        else if (ph.kind === 'rec') {
          v.reihum = ph.turn !== null; v.turn = ph.turn; v.done = !!ph.clips[id]; v.left = Math.max(0, ph.until - now);
          v.count = st.players.filter(p => ph.clips[p]).length; v.of = st.players.length;
          v.canRec = here(id) && (ph.turn === null || ph.turn === id);
          if (v.reihum) v.wait = ph.turn === id ? 0 : ph.queue.indexOf(id) + 1;          // 0: now or already done; n: n-th after the current one
        } else if (ph.kind === 'show') { const it = ph.items[ph.i]; v.i = ph.i + 1; v.n = ph.items.length; v.by = it.id; v.mine = it.id === id; v.canClap = it.id !== id && here(id); }
        else if (ph.kind === 'result') {
          const mine = ph.items.find(it => it.id === id), top = Math.max(0, ...ph.items.map(it => it.total));
          v.claps = mine ? mine.total : null; v.best = top > 0 && !!mine && mine.total === top;
        }
        return v;
      }
    };
    return game;
  }

  const api = { create, mulberry32, LISTEN_IN, LISTEN_MID, DRUM, COMPARE, RECAP_IN, RECAP_MID, RECAP_OUT, VOTE_MS, LEVELS,
    LISTEN_WAIT, REC_MS, REC_GRACE, TURN_MS, SHOW_IN, CLAP_MS, RESULT_IN, RESULT_MS, CLAP_MAX };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RwRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
