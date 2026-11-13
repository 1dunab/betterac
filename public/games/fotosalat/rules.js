// ===== Fotosalat rules: which mini-game runs when, who gets which picture, votes, the zoom riddle's points =====
// No DOM and no pictures, so it runs in Node (test-fotosalat.js). A photo is only a handle here (`ref`): the screen
// keeps the pictures. Time comes in from outside, in milliseconds.
//
// The game is a list of phases:
//   pose    everybody strikes a pose for the others to copy          (Nachmachen with the players' own poses)
//   copy    everybody re-enacts their picture: a painting or somebody else's pose
//   show    pair by pair: the original, then the copy next to it
//   task    scavenger hunt: everybody photographs what the TV asks for
//   gallery all photos of the hunt side by side
//   zshoot  everybody photographs something in the room for the zoom riddle
//   riddle  one photo after the other zooms out; the photographer says who called it first
//   over
(function (root) {
  // ---- tunables (honest guesses until real people have played) ----
  const GRACE_MS = 3000;          // everybody has delivered: this long for a last retake, then on
  const SHOW_ORIG_MS = 3500;      // the original alone before the copy appears
  const SHOW_MAX_MS = 30000;      // a pair stays until the host taps, at most this long
  const GALLERY_MS = 45000;
  const ZOOM_MS = 30000, SOLVED_MS = 5000, ZOOM_START = 14;      // the riddle starts 14× zoomed in
  const SHOOT = ['pose', 'copy', 'task', 'zshoot'];

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // which phases a game consists of
  function planFor(cfg) {
    const p = [], R = cfg.runden;
    if (cfg.spiel === 'jagd') for (let r = 1; r <= R; r++) p.push({ kind: 'task', round: r }, { kind: 'gallery', round: r });
    else if (cfg.spiel === 'zoom') for (let r = 1; r <= R; r++) p.push({ kind: 'zshoot', round: r }, { kind: 'riddle', round: r });
    else if (cfg.spiel === 'mix') p.push({ kind: 'copy', src: 'art', round: 1 }, { kind: 'show', round: 1 }, { kind: 'task', round: 2 }, { kind: 'gallery', round: 2 }, { kind: 'zshoot', round: 3 }, { kind: 'riddle', round: 3 });
    else {
      for (let r = 1; r <= R; r++) {
        const src = cfg.vorlagen === 'gemaelde' ? 'art' : cfg.vorlagen === 'posen' ? 'pose' : (r % 2 ? 'art' : 'pose');
        if (src === 'pose') p.push({ kind: 'pose', round: r });
        p.push({ kind: 'copy', src, round: r });
      }
      p.push({ kind: 'show', round: R });       // three rounds, then the big show
    }
    p.push({ kind: 'over' });
    return p;
  }

  function create(o) {
    const c = o.cfg || {};
    const cfg = {
      spiel: ['nachmachen', 'zoom', 'jagd', 'mix'].includes(c.spiel) ? c.spiel : 'nachmachen',
      vorlagen: ['mix', 'gemaelde', 'posen'].includes(c.vorlagen) ? c.vorlagen : 'mix',
      runden: clamp(c.runden | 0 || 3, 1, 6), zeit: clamp(c.zeit | 0 || 90, 10, 600), wertung: c.wertung === 'an' || c.wertung === true
    };
    const rng = mulberry32(o.seed === undefined ? 1 : o.seed);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const plan = planFor(cfg);
    const st = { cfg, players: o.ids.slice(), score: {}, plan, at: -1, phase: null, pairs: [], poses: {}, last: null, galleries: [], riddles: [],
      rounds: cfg.spiel === 'mix' ? 3 : cfg.runden, over: false, rev: 0 };
    st.players.forEach(id => { st.score[id] = 0; });
    const decks = { art: [], task: [] }, sizes = { art: o.arts || 1, task: o.tasks || 1 };
    function draw(kind) {           // no painting and no task twice, as long as the supply lasts
      if (!decks[kind].length) decks[kind] = shuffle(Array.from({ length: sizes[kind] }, (x, i) => i));
      return decks[kind].pop();
    }

    // who copies what. A pose never goes back to the player who struck it
    function deal(src) {
      const tpl = {};
      if (src === 'pose') {
        const owners = shuffle(Object.keys(st.poses).map(Number));
        if (owners.length >= 2) owners.forEach((id, i) => { const from = owners[(i + 1) % owners.length]; if (st.players.includes(id)) tpl[id] = { pose: st.poses[from], by: from }; });
        st.players.forEach(id => {
          const others = owners.filter(x => x !== id);
          if (!tpl[id] && others.length) { const from = others[Math.floor(rng() * others.length)]; tpl[id] = { pose: st.poses[from], by: from }; }
        });
      }
      st.players.forEach(id => { if (!tpl[id]) tpl[id] = { art: draw('art') }; });
      return tpl;
    }

    function build(item, now) {
      const until = now + cfg.zeit * 1000, base = { kind: item.kind, round: item.round };
      if (item.kind === 'pose') return Object.assign(base, { until, shots: {} });
      if (item.kind === 'copy') return Object.assign(base, { until, shots: {}, src: item.src, tpl: deal(item.src) });
      if (item.kind === 'task') return Object.assign(base, { until, shots: {}, task: draw('task') });
      if (item.kind === 'zshoot') return Object.assign(base, { until, shots: {}, focus: {} });
      if (item.kind === 'show') {
        const list = st.pairs.filter(p => !p.shown);
        return list.length ? Object.assign(base, { list, i: 0, step: 0, stepAt: now }) : null;
      }
      if (item.kind === 'gallery') {
        const items = shuffle(Object.keys(st.last || {}).map(Number)).map(id => ({ id, ref: st.last[id] }));
        if (!items.length) return null;
        const g = Object.assign(base, { task: st.lastTask, items, votes: {}, until: now + GALLERY_MS });
        st.galleries.push(g);
        return g;
      }
      if (item.kind === 'riddle') {
        const items = shuffle(Object.keys(st.last || {}).map(Number)).map(id => Object.assign({ id }, st.last[id]));
        if (!items.length) return null;
        items.forEach(it => st.riddles.push(it));
        return Object.assign(base, { items, i: 0, startAt: now, solved: null });
      }
      st.over = true;
      return base;
    }
    // on to the next phase; one with nothing to show (nobody took a photo) is skipped
    function next(now) {
      do { st.at++; st.phase = build(plan[st.at], now); } while (!st.phase);
      st.rev++;
    }
    // a photo phase ends: keep what was delivered for the phase that shows it
    function close(now) {
      const ph = st.phase;
      if (ph.kind === 'pose') st.poses = ph.shots;
      else if (ph.kind === 'copy') Object.keys(ph.shots).map(Number).forEach(id => st.pairs.push({ round: ph.round, by: id, tpl: ph.tpl[id], shot: ph.shots[id], hearts: [], shown: false }));
      else if (ph.kind === 'task') { st.last = ph.shots; st.lastTask = ph.task; }
      else if (ph.kind === 'zshoot') { st.last = {}; for (const id in ph.shots) st.last[id] = Object.assign({ ref: ph.shots[id] }, ph.focus[id] || { x: 0.5, y: 0.5 }); }
      else if (ph.kind === 'gallery') { if (cfg.wertung) for (const v in ph.votes) st.score[ph.votes[v]] = (st.score[ph.votes[v]] || 0) + 1; }
      next(now);
    }
    function showOn(now) {
      const ph = st.phase;
      if (ph.step === 0) { ph.step = 1; ph.stepAt = now; st.rev++; return; }
      ph.list[ph.i].shown = true;
      if (++ph.i >= ph.list.length) { next(now); return; }
      ph.step = 0; ph.stepAt = now; st.rev++;
    }
    function riddleOn(now) {
      const ph = st.phase;
      if (++ph.i >= ph.items.length) { next(now); return; }
      ph.startAt = now; ph.solved = null; st.rev++;
    }
    const allIn = (ph) => st.players.length > 0 && st.players.every(id => ph.shots[id] !== undefined);
    const hurry = (ph, now) => { if (allIn(ph)) ph.until = Math.min(ph.until, now + GRACE_MS); };

    const game = {
      state: st, cfg,
      start(now) { next(now); },

      // a photo arrives. A second one replaces the first. Returns the replaced handle, so the screen can drop that picture
      photo(id, ref, now) {
        const ph = st.phase;
        if (!ph || !SHOOT.includes(ph.kind) || !st.players.includes(id)) return { ok: false };
        const old = ph.shots[id];
        ph.shots[id] = ref;
        if (ph.kind === 'zshoot') delete ph.focus[id];        // a new photo: the zoom starts in the middle again
        hurry(ph, now); st.rev++;
        return { ok: true, old };
      },
      // zoom riddle: where on the photo the zoom starts (0..1)
      focus(id, x, y) {
        const ph = st.phase;
        if (!ph || ph.kind !== 'zshoot' || ph.shots[id] === undefined || !(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return false;
        ph.focus[id] = { x, y };
        return true;
      },
      heart(id) {
        const ph = st.phase, p = ph && ph.kind === 'show' && ph.step === 1 ? ph.list[ph.i] : null;
        if (!cfg.wertung || !p || p.by === id || !st.players.includes(id) || p.hearts.includes(id)) return false;
        p.hearts.push(id); st.score[p.by] = (st.score[p.by] || 0) + 1; st.rev++;
        return true;
      },
      vote(id, target) {
        const ph = st.phase;
        if (!cfg.wertung || !ph || ph.kind !== 'gallery' || id === target || !st.players.includes(id) || !ph.items.some(it => it.id === target)) return false;
        ph.votes[id] = target; st.rev++;
        return true;
      },
      // zoom riddle: the photographer says who called it first (0: nobody, show it)
      guess(id, who, now) {
        const ph = st.phase, it = ph && ph.kind === 'riddle' ? ph.items[ph.i] : null;
        who = who | 0;
        if (!it || ph.solved || it.id !== id || who === id || (who && !st.players.includes(who))) return false;
        const p = game.progress(now);
        ph.solved = { by: who, at: now };
        if (cfg.wertung && who) { st.score[who] = (st.score[who] || 0) + (p < 1 / 3 ? 3 : p < 2 / 3 ? 2 : 1); st.score[id] = (st.score[id] || 0) + 1; }
        st.rev++;
        return true;
      },
      progress(now) { const ph = st.phase; return ph && ph.kind === 'riddle' ? clamp((now - ph.startAt) / ZOOM_MS, 0, 1) : 0; },
      zoom(now) { const ph = st.phase; return !ph || ph.kind !== 'riddle' || ph.solved ? 1 : Math.pow(ZOOM_START, 1 - game.progress(now)); },

      // the host's "weiter": do not wait any longer / next pair / next riddle
      skip(now) {
        const ph = st.phase;
        if (!ph || st.over) return;
        if (SHOOT.includes(ph.kind) || ph.kind === 'gallery') close(now);
        else if (ph.kind === 'show') showOn(now);
        else if (ph.kind === 'riddle') { if (ph.solved) riddleOn(now); else { ph.solved = { by: 0, at: now }; st.rev++; } }
      },
      step(now) {
        const ph = st.phase;
        if (!ph || st.over) return;
        if (SHOOT.includes(ph.kind) || ph.kind === 'gallery') { if (now >= ph.until) close(now); }
        else if (ph.kind === 'show') { if (now - ph.stepAt >= (ph.step ? SHOW_MAX_MS : SHOW_ORIG_MS)) showOn(now); }
        else if (ph.kind === 'riddle') {
          if (!ph.solved) { if (now - ph.startAt >= ZOOM_MS) { ph.solved = { by: 0, at: now }; st.rev++; } }
          else if (now - ph.solved.at >= SOLVED_MS) riddleOn(now);
        }
      },

      // who comes later takes part from the running phase on; in a copy phase they get a painting
      join(id) {
        if (st.players.includes(id)) return;
        st.players.push(id); st.score[id] = st.score[id] || 0;
        if (st.phase && st.phase.kind === 'copy') st.phase.tpl[id] = { art: draw('art') };
        st.rev++;
      },
      // who leaves: their photos stay in the show
      leave(id, now) {
        if (!st.players.includes(id)) return;
        st.players = st.players.filter(x => x !== id);
        if (st.phase && SHOOT.includes(st.phase.kind)) hurry(st.phase, now);
        st.rev++;
      },
      winners() {
        if (!cfg.wertung) return [];
        const best = Math.max(0, ...st.players.map(id => st.score[id] || 0));
        return best > 0 ? st.players.filter(id => st.score[id] === best) : [];
      },

      // what one phone needs to know (the screen adds names and pictures)
      view(id, now) {
        const ph = st.phase, v = { phase: ph.kind, round: ph.round || 0, rounds: st.rounds, wertung: cfg.wertung, spiel: cfg.spiel, in: st.players.includes(id) };
        if (SHOOT.includes(ph.kind)) {
          v.left = Math.max(0, ph.until - now); v.done = ph.shots[id] !== undefined;
          v.count = st.players.filter(p => ph.shots[p] !== undefined).length; v.of = st.players.length;
          if (ph.kind === 'copy') v.tpl = ph.tpl[id] || null;
          if (ph.kind === 'task') v.task = ph.task;
          if (ph.kind === 'zshoot') v.focus = ph.focus[id] || { x: 0.5, y: 0.5 };
        } else if (ph.kind === 'show') {
          const p = ph.list[ph.i];
          v.i = ph.i + 1; v.n = ph.list.length; v.step = ph.step; v.mine = p.by === id; v.by = p.by; v.hearted = p.hearts.includes(id);
        } else if (ph.kind === 'gallery') {
          v.task = ph.task; v.voted = ph.votes[id] || 0; v.options = ph.items.filter(it => it.id !== id).map(it => it.id);
        } else if (ph.kind === 'riddle') {
          const it = ph.items[ph.i];
          v.i = ph.i + 1; v.n = ph.items.length; v.by = it.id; v.owner = it.id === id; v.solved = ph.solved ? ph.solved.by : null;
          v.options = st.players.filter(p => p !== it.id);
        } else if (ph.kind === 'over') { v.score = st.score[id] || 0; v.won = game.winners().includes(id); }
        return v;
      }
    };
    return game;
  }

  const api = { create, planFor, mulberry32, GRACE_MS, SHOW_ORIG_MS, SHOW_MAX_MS, GALLERY_MS, ZOOM_MS, SOLVED_MS, ZOOM_START };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FotoRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
