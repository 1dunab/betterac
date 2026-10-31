// ===== Werwolfnacht rules: roles, deal, night/vote resolution, win check, chronicle (deterministic, see docs/WERWOLF.md) =====
(function (root) {
  const ROLES = {
    wolf: { name: 'Werwolf', icon: '🐺', team: 'wolves' },
    villager: { name: 'Dorfbewohner', icon: '🧑‍🌾', team: 'village' },
    seer: { name: 'Seherin', icon: '🔮', team: 'village' },
    guard: { name: 'Beschützer', icon: '🛡️', team: 'village' },
    cupid: { name: 'Amor', icon: '💘', team: 'village' },
    witch: { name: 'Hexe', icon: '🧪', team: 'village' },
    hunter: { name: 'Jäger', icon: '🏹', team: 'village' }
  };
  const SPECIAL_ORDER = ['seer', 'witch', 'hunter', 'guard', 'cupid'];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function wolfCount(n, w) {
    const max = Math.max(1, Math.floor((n - 1) / 2));
    let c = w === 'auto' || w == null ? (n <= 6 ? 1 : n <= 10 ? 2 : n <= 14 ? 3 : 4) : Math.round(+w) || 1;
    return Math.min(max, Math.max(1, c));
  }

  // opts: { wolves: 'auto' | 1..4, seer, witch, hunter, guard, cupid } — a special is enabled unless explicitly false
  function deal(ids, opts, seed) {
    opts = opts || {};
    const n = ids.length, w = wolfCount(n, opts.wolves);
    const list = [];
    for (let i = 0; i < w; i++) list.push('wolf');
    let room = n - w - 1;
    for (const k of SPECIAL_ORDER) if (opts[k] !== false && room > 0) { list.push(k); room--; }
    while (list.length < n) list.push('villager');
    const rng = mulberry32((seed >>> 0) || 1);
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)); const t = list[i]; list[i] = list[j]; list[j] = t;
    }
    const out = {};
    ids.forEach((id, i) => { out[id] = list[i]; });
    return out;
  }

  function create(cfg) {
    const players = cfg.players.slice();
    const P = new Map(players.map(p => [String(p), p]));
    const pid = x => (x == null ? undefined : P.get(String(x)));
    const names = cfg.names || {};
    const nm = id => names[id] != null ? String(names[id]) : String(id);
    const roles = Object.assign({}, cfg.roles || deal(players, {}, cfg.seed));
    const rng = mulberry32(((cfg.seed >>> 0) ^ 0x9E3779B9) || 1);
    const alive = {};
    for (const p of players) alive[p] = true;
    const state = {
      night: 0, day: 0, phase: 'idle', alive, roles, lovers: null, victim: null,
      potions: { heal: true, poison: true }, guardLast: null, over: null
    };
    const chronicle = [];
    let tasks = { A: {}, B: {} }, acts = { A: {}, B: {} };
    let pendingHunter = new Set();   // dead hunters who have not shot yet
    let shot = new Set();
    let ended = false;

    const living = () => players.filter(p => alive[p]);
    const isWolf = id => roles[id] === 'wolf';
    const withRole = r => players.find(p => roles[p] === r && alive[p]);
    const fail = reason => ({ ok: false, reason });
    const mixedLovers = () => !!state.lovers && isWolf(state.lovers[0]) !== isWolf(state.lovers[1]);

    // most-named target; ties -> first among the top by player order (callers decide what a tie means)
    function tally(picks) {
      const counts = {};
      for (const t of picks) if (t != null) counts[t] = (counts[t] || 0) + 1;
      let max = 0;
      for (const k in counts) if (counts[k] > max) max = counts[k];
      const top = players.filter(p => counts[p] === max && max > 0);
      return { counts, max, top };
    }

    // kill + grief; pushes into `deaths`; returns the pending hunter id (or null)
    function kill(id, cause, deaths) {
      if (!alive[id]) return;
      alive[id] = false;
      deaths.push({ id, cause });
      if (roles[id] === 'hunter' && !shot.has(id)) pendingHunter.add(id);
      const L = state.lovers;
      if (L && (L[0] === id || L[1] === id)) {
        const other = L[0] === id ? L[1] : L[0];
        if (alive[other]) kill(other, 'grief', deaths);
      }
    }
    const hunterOf = deaths => { const d = deaths.find(x => pendingHunter.has(x.id)); return d ? d.id : null; };

    function makeTask(step, kind, options, extra) {
      return Object.assign({ step, kind, options, pick: kind === 'cupid' ? 2 : 1 }, extra || {});
    }
    function put(step, id, task) {
      if (task.options.length >= task.pick) tasks[step][id] = task;
    }

    function beginNight() {
      if (state.over || state.phase !== 'idle') return null;
      state.night++;
      state.phase = 'A';
      state.victim = null;
      tasks = { A: {}, B: {} }; acts = { A: {}, B: {} };
      const liv = living(), nonWolves = liv.filter(p => !isWolf(p));
      for (const id of liv) {
        const r = roles[id], others = liv.filter(p => p !== id);
        if (r === 'wolf') put('A', id, makeTask('A', 'wolf', nonWolves.slice()));
        else if (r === 'seer') put('A', id, makeTask('A', 'seer', others));
        else if (r === 'guard') put('A', id, makeTask('A', 'guard', liv.filter(p => p !== state.guardLast)));
        else if (r === 'cupid' && state.night === 1 && !state.lovers) put('A', id, makeTask('A', 'cupid', liv.slice()));
        else put('A', id, makeTask('A', 'suspect', others));
      }
      return snapshot('A');
    }
    const snapshot = step => Object.assign({}, tasks[step]);

    function beginStepB() {
      if (state.phase !== 'A') return null;
      state.phase = 'B';
      // fix the wolves' target
      const picks = living().filter(isWolf).map(w => acts.A[w] && acts.A[w].target).filter(t => t != null);
      const t = tally(picks);
      state.victim = t.top.length === 0 ? null : t.top.length === 1 ? t.top[0] : t.top[Math.floor(rng() * t.top.length)];
      const liv = living();
      for (const id of liv) {
        if (roles[id] === 'witch') {
          put('B', id, makeTask('B', 'witch', liv.filter(p => p !== id), {
            victim: state.victim,
            canHeal: state.potions.heal && state.victim != null,
            canPoison: state.potions.poison
          }));
        } else put('B', id, makeTask('B', 'trust', liv.filter(p => p !== id)));
      }
      return snapshot('B');
    }

    function act(id, payload) {
      if (state.phase !== 'A' && state.phase !== 'B') return fail('state');
      const step = state.phase;
      id = pid(id);
      if (id === undefined) return fail('player');
      if (!alive[id]) return fail('dead');
      const task = tasks[step][id];
      if (!task) return fail('notask');
      if (!payload || typeof payload !== 'object') return fail('payload');
      const had = acts[step][id];
      if (had && (task.kind === 'seer' || task.kind === 'cupid')) return fail('locked');
      if (task.kind === 'cupid') {
        const ts = Array.isArray(payload.targets) ? payload.targets.map(pid) : [];
        if (ts.length !== 2 || ts.some(t => t === undefined || !task.options.includes(t)) || ts[0] === ts[1]) return fail('target');
        acts[step][id] = { targets: ts };
        return { ok: true };
      }
      if (task.kind === 'witch') {
        const heal = !!payload.heal;
        let poison = null;
        if (payload.poison != null) {
          poison = pid(payload.poison);
          if (poison === undefined || !task.canPoison || !task.options.includes(poison)) return fail('target');
        }
        if (heal && !task.canHeal) return fail('heal');
        acts[step][id] = { heal, poison };
        return { ok: true };
      }
      const t = pid(payload.target);
      if (t === undefined || !task.options.includes(t)) return fail('target');
      acts[step][id] = { target: t };
      if (task.kind === 'seer') return { ok: true, result: { target: t, role: roles[t] } };
      return { ok: true };
    }

    function packPicks() {
      const out = {};
      for (const w of players) if (roles[w] === 'wolf' && alive[w]) out[w] = (acts.A[w] && acts.A[w].target) || null;
      return out;
    }

    function stepDone() {
      if (state.phase !== 'A' && state.phase !== 'B') return false;
      const step = state.phase;
      return Object.keys(tasks[step]).every(id => acts[step][id]);
    }

    function decoy(step, kind) {
      const picks = [];
      for (const id in tasks[step]) if (tasks[step][id].kind === kind && acts[step][id]) picks.push(acts[step][id].target);
      const t = tally(picks);
      return t.max >= 2 && t.top.length === 1 ? t.top[0] : null;
    }

    function endNight() {
      if (state.phase !== 'B') return fail('state');
      const entry = { type: 'night', night: state.night, wolves: {}, target: state.victim, seer: null, guard: null, cupid: null, witch: null, saved: null, suspect: null, trust: null, deaths: [], hunter: null };
      for (const w of players) if (isWolf(w) && tasks.A[w]) entry.wolves[w] = (acts.A[w] && acts.A[w].target) || null;
      for (const id in tasks.A) {
        const k = tasks.A[id].kind, a = acts.A[id];
        if (!a) continue;
        if (k === 'seer') entry.seer = { by: pid(id), target: a.target, role: roles[a.target] };
        else if (k === 'guard') entry.guard = { by: pid(id), target: a.target };
        else if (k === 'cupid') entry.cupid = { by: pid(id), targets: a.targets.slice() };
      }
      for (const id in tasks.B) {
        if (tasks.B[id].kind === 'witch' && acts.B[id]) entry.witch = { by: pid(id), heal: acts.B[id].heal, poison: acts.B[id].poison };
      }
      // cupid first, so grief applies in the same night
      if (entry.cupid) state.lovers = entry.cupid.targets.slice();
      const guarded = !!entry.guard && entry.guard.target === state.victim && state.victim != null;
      const healed = !!entry.witch && entry.witch.heal && state.victim != null;
      entry.saved = guarded && healed ? 'both' : guarded ? 'guard' : healed ? 'heal' : null;
      const deaths = [];
      if (state.victim != null && !guarded && !healed) kill(state.victim, 'wolves', deaths);
      if (entry.witch && entry.witch.poison != null) kill(entry.witch.poison, 'poison', deaths);
      if (healed) state.potions.heal = false;
      if (entry.witch && entry.witch.poison != null) state.potions.poison = false;
      state.guardLast = entry.guard ? entry.guard.target : null;
      entry.suspect = decoy('A', 'suspect');
      entry.trust = decoy('B', 'trust');
      entry.deaths = deaths.map(d => Object.assign({}, d));
      entry.hunter = hunterOf(deaths);
      chronicle.push(entry);
      state.phase = 'idle';
      state.day = state.night;
      return { ok: true, deaths, lovers: entry.cupid ? state.lovers.slice() : null, suspect: entry.suspect, trust: entry.trust, hunter: entry.hunter };
    }

    function shoot(hunterId, target) {
      hunterId = pid(hunterId);
      if (hunterId === undefined || !pendingHunter.has(hunterId)) return fail('state');
      let t = null;
      if (target != null) {
        t = pid(target);
        if (t === undefined || !alive[t]) return fail('target');
      }
      pendingHunter.delete(hunterId); shot.add(hunterId);
      const deaths = [];
      if (t != null) kill(t, 'hunter', deaths);
      const hunter = hunterOf(deaths);
      chronicle.push({ type: 'shoot', day: state.day, by: hunterId, target: t, deaths: deaths.map(d => Object.assign({}, d)) });
      return { ok: true, deaths, hunter };
    }

    // ballots: { voterId: targetId | null }; candidates: optional array (runoff)
    function vote(ballots, candidates) {
      if (state.over || state.phase !== 'idle' || state.night < 1) return fail('state');
      const cand = candidates ? candidates.map(pid).filter(c => c !== undefined) : null;
      const valid = {}, counts = {};
      let nobody = 0;
      for (const v of Object.keys(ballots || {})) {
        const voter = pid(v);
        if (voter === undefined || !alive[voter]) continue;
        const raw = ballots[v];
        if (raw == null) { valid[voter] = null; nobody++; continue; }
        const t = pid(raw);
        if (t === undefined || !alive[t] || (cand && !cand.includes(t))) continue;
        valid[voter] = t; counts[t] = (counts[t] || 0) + 1;
      }
      const tl = tally(Object.values(valid));
      let result, target = null, tied = [];
      if (tl.max === 0 || nobody >= tl.max) result = 'none';
      else if (tl.top.length === 1) { result = 'execute'; target = tl.top[0]; }
      else { result = 'tie'; tied = tl.top; }
      chronicle.push({ type: 'vote', day: state.day, runoff: !!cand, ballots: Object.assign({}, valid), counts: Object.assign({}, counts), nobody, result, target, tied: tied.slice() });
      return { ok: true, counts, nobody, result, target, tied };
    }

    function execute(id) {
      id = pid(id);
      if (state.over || state.phase !== 'idle' || state.night < 1) return fail('state');
      if (id === undefined || !alive[id]) return fail('target');
      const deaths = [];
      kill(id, 'vote', deaths);
      const hunter = hunterOf(deaths);
      chronicle.push({ type: 'execute', day: state.day, id, deaths: deaths.map(d => Object.assign({}, d)), hunter });
      return { ok: true, deaths, hunter };
    }

    function checkWin() {
      if (state.over) return state.over;
      const liv = living(), wolves = liv.filter(isWolf), rest = liv.filter(p => !isWolf(p));
      const mixed = mixedLovers() ? state.lovers : [];
      let res = null;
      if (liv.length === 0) res = { winner: 'nobody', winners: [] };
      else if (mixed.length && liv.length === 2 && liv.every(p => mixed.includes(p))) res = { winner: 'lovers', winners: mixed.slice() };
      else if (wolves.length === 0) res = { winner: 'village', winners: players.filter(p => !isWolf(p) && !mixed.includes(p)) };
      else if (wolves.length >= rest.length) res = { winner: 'wolves', winners: players.filter(p => isWolf(p) && !mixed.includes(p)) };
      if (res) {
        state.over = res;
        if (!ended) { ended = true; chronicle.push({ type: 'end', winner: res.winner, winners: res.winners.slice() }); }
      }
      return res;
    }

    function ghostLines() {
      if (state.phase === 'idle' && state.night === 0) return [];
      const list = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1];
      const lines = [];
      const byTarget = {};
      for (const w of players) {
        const a = isWolf(w) && tasks.A[w] && acts.A[w];
        if (a) (byTarget[a.target] = byTarget[a.target] || []).push(nm(w));
      }
      for (const t of players) if (byTarget[t]) lines.push('🐺 ' + list(byTarget[t]) + ' wollen ' + nm(t));
      for (const id in tasks.A) {
        const k = tasks.A[id].kind, a = acts.A[id];
        if (!a) continue;
        if (k === 'cupid') lines.push('💘 ' + nm(id) + ' verbindet ' + list(a.targets.map(nm)));
        else if (k === 'seer') lines.push('🔮 ' + nm(id) + ' prüft ' + nm(a.target));
        else if (k === 'guard') lines.push('🛡️ ' + nm(id) + ' schützt ' + nm(a.target));
      }
      for (const id in tasks.B) {
        const a = acts.B[id];
        if (tasks.B[id].kind !== 'witch' || !a) continue;
        if (a.heal) lines.push('🧪 ' + nm(id) + ' heilt ' + nm(state.victim));
        if (a.poison != null) lines.push('🧪 ' + nm(id) + ' vergiftet ' + nm(a.poison));
      }
      return lines;
    }

    return { state, chronicle, beginNight, beginStepB, act, packPicks, stepDone, endNight, shoot, vote, execute, checkWin, ghostLines };
  }

  const api = { ROLES, deal, create };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.WerwolfRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
