// ===== Wer spricht da? rules: who has recorded, whose voice is on, who guessed whom =====
// No DOM and no sound, so it runs in Node (test-werspricht.js). A recording is only a handle here (`ref`) with
// its length; the screen keeps the samples. Time comes in from outside, in milliseconds.
//
// A round:  rec     everybody says the same sentence into their phone, all at once
//           guess   one voice after the other is played distorted; everybody but its owner taps who it was
//           reveal  who it was, who got it right, and the voice as it really sounds
// After the last round: over.
(function (root) {
  // ---- tunables ----
  const REC_MS = 45000, REC_GRACE = 2000;       // time to record / after the last one has delivered
  const GUESS_IN = 800, GUESS_MS = 20000;       // pause before a voice / time to guess after it has played
  const REVEAL_IN = 1200, REVEAL_OUT = 3000;    // pause before the real voice / time to read the reveal
  const RATES = { hoch: 1.55, tief: 0.68 };     // playback speed: faster is higher (chipmunk), slower is lower (monster)
  const MIN_VOICES = 2;                         // with fewer recordings there is nothing to guess

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function create(o) {
    const c = o.cfg || {};
    const cfg = { verzerrung: ['hoch', 'tief'].includes(c.verzerrung) ? c.verzerrung : 'mix', runden: clamp(c.runden | 0 || 2, 1, 5), wertung: !(c.wertung === 'aus' || c.wertung === false) };
    const rng = mulberry32(o.seed === undefined ? 1 : o.seed);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const list = o.sentences || ['Ich war es nicht.'];
    let deck = [];
    const sentence = () => { if (!deck.length) deck = shuffle(list.slice()); return deck.pop(); };

    const st = { cfg, players: o.ids.slice(), t: 0, phase: null, score: {}, over: false, rev: 0 };
    st.players.forEach(id => { st.score[id] = 0; });
    const set = (ph) => { st.phase = ph; st.rev++; };
    const here = (id) => st.players.includes(id);
    const allIn = (ph) => st.players.length > 0 && st.players.every(id => ph.clips[id]);

    function nextRound(now) {
      st.t++;
      if (st.t > cfg.runden || !st.players.length) { st.over = true; set({ kind: 'over' }); return; }
      set({ kind: 'rec', round: st.t, text: sentence(), at: now, until: now + REC_MS, clips: {} });
    }
    function closeRec(now) {
      const ph = st.phase, ids = shuffle(Object.keys(ph.clips).map(Number));
      if (ids.length < MIN_VOICES) { nextRound(now); return; }
      const items = ids.map((id, k) => ({ id, ref: ph.clips[id].ref, dur: ph.clips[id].dur, guesses: {}, right: [], wrong: [],
        rate: RATES[cfg.verzerrung] || (rng() < 0.5 ? RATES.hoch : RATES.tief) }));
      set({ kind: 'guess', round: ph.round, text: ph.text, items, voices: ids.slice().sort((a, b) => a - b), i: 0, at: now });
    }
    // who may guess the voice that is on: everybody who is here, except its owner
    const guessers = (it) => st.players.filter(id => id !== it.id);
    function reveal(now) {
      const ph = st.phase, it = ph.items[ph.i];
      for (const g in it.guesses) (it.guesses[g] === it.id ? it.right : it.wrong).push(+g);
      if (cfg.wertung) { it.right.forEach(id => { st.score[id] = (st.score[id] || 0) + 1; }); st.score[it.id] = (st.score[it.id] || 0) + it.wrong.length; }    // fooling somebody pays too
      set(Object.assign({}, ph, { kind: 'reveal', at: now }));
    }
    function afterReveal(now) {
      const ph = st.phase;
      if (ph.i + 1 < ph.items.length) set(Object.assign({}, ph, { kind: 'guess', i: ph.i + 1, at: now })); else nextRound(now);
    }

    const game = {
      state: st, cfg,
      start(now) { nextRound(now); },

      // What the TV plays: [{ at (ms after phase.at), ref, rate, dur (ms as heard), label }]
      cues() {
        const ph = st.phase, it = ph && ph.items ? ph.items[ph.i] : null;
        if (!it) return [];
        if (ph.kind === 'guess') return [{ at: GUESS_IN, ref: it.ref, rate: it.rate, dur: it.dur / it.rate, label: 'verzerrt' }];
        return [{ at: REVEAL_IN, ref: it.ref, rate: 1, dur: it.dur, label: 'echt' }];
      },
      total() { const q = game.cues()[0]; return q ? q.at + q.dur + (st.phase.kind === 'reveal' ? REVEAL_OUT : 0) : 0; },
      busy(now) { return now < st.phase.at + game.total(); },
      playing(now) { const t = now - st.phase.at, q = game.cues().find(x => t >= x.at && t < x.at + x.dur); return q ? q.label : null; },

      // a recording. A second one replaces the first; returns the replaced handle
      clip(id, ref, dur, now) {
        const ph = st.phase;
        if (!ph || ph.kind !== 'rec' || !here(id) || !(dur > 0)) return { ok: false };
        const old = ph.clips[id] ? ph.clips[id].ref : undefined;
        ph.clips[id] = { ref, dur };
        if (allIn(ph)) ph.until = Math.min(ph.until, now + REC_GRACE);
        st.rev++;
        return { ok: true, old };
      },
      // "that was …": may be changed until the reveal. When everybody has guessed, the reveal comes at once
      guess(id, who, now) {
        const ph = st.phase, it = ph && ph.kind === 'guess' ? ph.items[ph.i] : null;
        who = who | 0;
        if (!it || !here(id) || id === it.id || who === id || !ph.voices.includes(who)) return false;
        it.guesses[id] = who; st.rev++;
        if (guessers(it).every(g => it.guesses[g])) reveal(now);
        return true;
      },
      // the host lets everybody hear the voice again
      replay(now) {
        const ph = st.phase;
        if (!ph || ph.kind !== 'guess' || game.busy(now)) return false;
        ph.at = now; st.rev++;
        return true;
      },
      skip(now) {
        const ph = st.phase;
        if (!ph || st.over) return;
        if (ph.kind === 'rec') closeRec(now); else if (ph.kind === 'guess') reveal(now); else if (ph.kind === 'reveal') afterReveal(now);
      },
      step(now) {
        const ph = st.phase;
        if (!ph || st.over) return;
        if (ph.kind === 'rec') { if (now >= ph.until) closeRec(now); }
        else if (ph.kind === 'guess') { if (now >= ph.at + game.total() + GUESS_MS) reveal(now); }
        else if (ph.kind === 'reveal') { if (!game.busy(now)) afterReveal(now); }
      },
      join(id) { if (!here(id)) { st.players.push(id); st.score[id] = st.score[id] || 0; st.rev++; } },
      // who leaves: their voice stays in the round
      leave(id, now) {
        if (!here(id)) return;
        st.players = st.players.filter(x => x !== id);
        const ph = st.phase;
        if (ph && ph.kind === 'rec' && allIn(ph)) ph.until = Math.min(ph.until, now + REC_GRACE);
        st.rev++;
        if (ph && ph.kind === 'guess') { const it = ph.items[ph.i], g = guessers(it); if (g.length && g.every(x => it.guesses[x])) reveal(now); }
      },
      winners() {
        if (!cfg.wertung) return [];
        const best = Math.max(0, ...st.players.map(id => st.score[id] || 0));
        return best > 0 ? st.players.filter(id => st.score[id] === best) : [];
      },

      // what one phone needs to know (the screen adds names)
      view(id, now) {
        const ph = st.phase, v = { phase: ph.kind, wertung: cfg.wertung, round: ph.round || 0, rounds: cfg.runden };
        if (ph.kind === 'rec') {
          v.text = ph.text; v.canRec = here(id); v.done = !!ph.clips[id]; v.left = Math.max(0, ph.until - now);
          v.count = st.players.filter(p => ph.clips[p]).length; v.of = st.players.length;
        } else if (ph.kind === 'guess' || ph.kind === 'reveal') {
          const it = ph.items[ph.i];
          v.i = ph.i + 1; v.n = ph.items.length; v.mine = it.id === id; v.high = it.rate > 1;
          if (ph.kind === 'guess') {
            v.options = v.mine ? [] : ph.voices.filter(x => x !== id); v.guessed = it.guesses[id] || 0;
            v.count = guessers(it).filter(g => it.guesses[g]).length; v.of = guessers(it).length;
            v.busyMs = Math.max(0, ph.at + game.total() - now);
          } else {
            v.by = it.id; v.right = v.mine ? null : it.guesses[id] ? it.guesses[id] === it.id : null;
            v.fooled = it.wrong.length; v.caught = it.right.length;
          }
        } else if (ph.kind === 'over') { v.score = st.score[id] || 0; v.won = game.winners().includes(id); }
        return v;
      }
    };
    return game;
  }

  const api = { create, mulberry32, REC_MS, REC_GRACE, GUESS_IN, GUESS_MS, REVEAL_IN, REVEAL_OUT, RATES, MIN_VOICES };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.WsRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
