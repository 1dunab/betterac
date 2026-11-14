// ===== Würfelverlies — bots: one decision at a time (see docs/VERLIES.md) =====
// plan(st, seat, rand) returns the next action for the seat whose turn it is; answer(st, seat) the reply to a pending attack.
// Actions: { a: 'roll', dice } | { a: 'summon', die } | { a: 'place', shape, ori, x, y } | { a: 'move', mon, to }
//        | { a: 'attack', mon, target } | { a: 'ability', mon, ab, target } | { a: 'end' }
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const D = node ? require('./data.js') : root.VerliesData;
  const R = node ? require('./rules.js') : root.VerliesRules;
  const { MONSTERS, ABIL, ORIENT } = D;
  const LV_VALUE = [0, 1, 1.7, 2.6, 4];

  const foes = (st, s) => st.seats.filter((x) => x.alive && R.enemies(st, s, x.i));
  // steps over the dungeon (monsters ignored) from every cell to the nearest enemy master; Infinity where no path leads
  function field(st, s) {
    const f = new Array(st.w * st.h).fill(Infinity), q = [];
    for (const x of foes(st, s)) { f[x.dm] = 0; q.push(x.dm); }
    for (let k = 0; k < q.length; k++) {
      const i = q[k];
      for (const j of R.nbrs(st, i)) if (st.kind[j] === R.PATH && f[j] === Infinity) { f[j] = f[i] + 1; q.push(j); }
    }
    return f;
  }
  function manhFoe(st, s, i) {
    let best = Infinity;
    for (const x of foes(st, s)) best = Math.min(best, R.dist(st, i, x.dm));
    return best;
  }
  // how far a cell is from hitting a master: path steps if connected, otherwise straight distance plus a penalty
  const far = (st, s, f, i) => (f[i] < Infinity ? f[i] : 40 + manhFoe(st, s, i) * 1.5);

  // ---------- rolling ----------
  function chooseDice(st, s, rand) {
    const free = R.freeDice(st, s);
    if (free.length <= 3) return free;
    const seat = st.seats[s], lv = (k) => MONSTERS[seat.dice[k].key].level;
    const byL = {};
    for (const k of free) (byL[lv(k)] = byL[lv(k)] || []).push(k);
    const onBoard = st.mons.filter((m) => m.seat === s).length;
    const richest = free.slice().sort((a, b) => lv(b) - lv(a));
    if (onBoard >= 4 && rand() < 0.35) return richest.slice(0, 3);       // a crest roll: high dice have few summon faces
    let best = null, bestScore = -1;
    for (const L in byL) {
      const ks = byL[L];
      if (ks.length < 2) continue;
      const p = (5 - L) / 6;
      let pick = ks.slice(0, 3), prob = 3 * p * p * (1 - p) + p * p * p;
      if (pick.length === 2) { prob = p * p; const extra = richest.find((k) => pick.indexOf(k) < 0); if (extra !== undefined) pick.push(extra); }
      let val = LV_VALUE[L] * (onBoard >= 5 ? 0.6 : 1) * (+L === 1 && onBoard < 2 ? 1.4 : 1);
      if (MONSTERS[seat.dice[ks[0]].key].kind === 'item') val *= 0.7;
      const score = prob * val + rand() * 0.25;
      if (score > bestScore) { bestScore = score; best = pick; }
    }
    return best || richest.slice(0, 3);
  }

  // ---------- summoning and placing ----------
  function chooseSummon(st, s) {
    const seat = st.seats[s], opts = st.turn.roll.opts;
    const val = (k) => { const m = MONSTERS[seat.dice[k].key]; return m.kind === 'item' ? 15 : m.atk + m.def + m.hp; };
    return opts.slice().sort((a, b) => val(b) - val(a))[0];
  }
  function choosePlace(st, s, rand) {
    const f = field(st, s), seat = st.seats[s];
    const isItem = MONSTERS[seat.dice[st.turn.chosen].key].kind === 'item';
    let best = null, bestScore = -Infinity;
    for (let sh = 0; sh < ORIENT.length; sh++) for (let o = 0; o < ORIENT[sh].length; o++) {
      for (const [x, y] of R.validAnchors(st, s, sh, o)) {
        const cells = R.pieceCells(st, sh, o, x, y).map(([cx, cy]) => R.idx(st, cx, cy));
        const anchor = R.idx(st, x, y);
        let reachFoe = false, dmin = Infinity;
        for (const c of cells) {
          dmin = Math.min(dmin, manhFoe(st, s, c));
          for (const j of R.nbrs(st, c)) if (st.kind[j] !== R.EMPTY && st.owner[j] !== s && R.enemies(st, s, st.owner[j])) reachFoe = true;
        }
        let score;
        if (isItem) score = -R.dist(st, anchor, seat.dm) * 0.6 - dmin * 0.4;            // items stay near home
        else score = -(2 * manhFoe(st, s, anchor) + dmin) + (reachFoe ? 4 : 0);
        score += rand() * 1.5;
        if (score > bestScore) { bestScore = score; best = { a: 'place', shape: sh, ori: o, x, y }; }
      }
    }
    return best;
  }

  // ---------- the action phase ----------
  function bestAttack(st, s) {
    let best = null, bestScore = 0;
    for (const m of st.mons) {
      if (m.seat !== s || !R.canAttack(st, m)) continue;
      for (const t of R.attackTargets(st, m)) {
        if (t.dm !== undefined) return { a: 'attack', mon: m.id, target: t, score: 1000 };
        const o = R.monById(st, t.mon), def = st.seats[o.seat] && st.seats[o.seat].crests.DEF > 0;
        const r = R.preview(st, m, o, def ? 'defend' : 'none');
        let score = r.dmg >= o.hp ? 50 + o.maxHp : r.dmg;
        if (r.back >= m.hp) score -= 60;
        else score -= r.back * 0.5;
        if (score > bestScore) { bestScore = score; best = { a: 'attack', mon: m.id, target: t, score }; }
      }
    }
    return best;
  }
  function bestAbility(st, s, f) {
    const seat = st.seats[s], cand = [];
    for (const m of st.mons) {
      if (m.seat !== s) continue;
      for (const ab of R.abilitiesOf(m)) {
        if (R.abilityBlock(st, m, ab)) continue;
        const A = ABIL[ab], tg = R.abilityTargets(st, m, ab);
        const enemyAt = (rng) => st.mons.filter((o) => (o.seat < 0 || R.enemies(st, s, o.seat)) && R.dist(st, o.at, m.at) <= rng);
        if (ab === 'bolt' || ab === 'bolt2') {
          const t = tg.map((x) => R.monById(st, x.mon)).sort((a, b) => a.hp - b.hp)[0];
          if (t) cand.push({ score: t.hp <= A.dmg ? 40 + t.maxHp : 12, act: { a: 'ability', mon: m.id, ab, target: { mon: t.id } } });
        } else if (ab === 'breath' || ab === 'wave') {
          const n = enemyAt(A.range).length;
          if (n) cand.push({ score: 15 * n, act: { a: 'ability', mon: m.id, ab, target: {} } });
        } else if (ab === 'heal') {
          const t = tg.map((x) => R.monById(st, x.mon)).filter((o) => o.maxHp - o.hp >= 20).sort((a, b) => a.hp - b.hp)[0];
          if (t) cand.push({ score: 14, act: { a: 'ability', mon: m.id, ab, target: { mon: t.id } } });
        } else if (ab === 'aura') {
          const n = st.mons.filter((o) => o.seat === s && R.dist(st, o.at, m.at) <= A.range && o.maxHp - o.hp >= 10).length;
          if (n) cand.push({ score: 9 * n, act: { a: 'ability', mon: m.id, ab, target: {} } });
        } else if (ab === 'root' || ab === 'freeze') {
          const t = tg.map((x) => R.monById(st, x.mon)).filter((o) => !o.frozenNext && !o.rootNext)
            .sort((a, b) => R.dist(st, a.at, seat.dm) - R.dist(st, b.at, seat.dm))[0];
          if (t && (R.dist(st, t.at, seat.dm) <= 7 || t.atk >= 30) && seat.crests.MAG >= A.cost.MAG + 1) cand.push({ score: 10, act: { a: 'ability', mon: m.id, ab, target: { mon: t.id } } });
        } else if (ab === 'rage') {
          if (R.canAttack(st, m) && R.attackTargets(st, m).length) cand.push({ score: 16, act: { a: 'ability', mon: m.id, ab, target: {} } });
        } else if (ab === 'sprint') {
          if (m.moves >= 1 && !m.attacked && seat.crests.MOV >= 2 && f[m.at] > 1) cand.push({ score: 8, act: { a: 'ability', mon: m.id, ab, target: {} } });
        } else if (ab === 'pit' || ab === 'net') {
          if (seat.crests.TRP < A.cost.TRP + (ab === 'pit' ? 1 : 0)) continue;
          const near = enemyAt(4);
          if (!near.length) continue;
          const c = tg.slice().sort((a, b) => R.dist(st, a.cell, near[0].at) - R.dist(st, b.cell, near[0].at))[0];
          if (c) cand.push({ score: 7, act: { a: 'ability', mon: m.id, ab, target: { cell: c.cell } } });
        }
      }
    }
    cand.sort((a, b) => b.score - a.score);
    return cand[0] || null;
  }
  function bestMove(st, s, f) {
    const seat = st.seats[s];
    const intruders = st.mons.filter((o) => o.seat !== s && (o.seat < 0 || R.enemies(st, s, o.seat)) && R.dist(st, o.at, seat.dm) <= 4);
    const mine = st.mons.filter((m) => m.seat === s && R.canMove(st, m)).sort((a, b) => far(st, s, f, a.at) - far(st, s, f, b.at));
    for (const m of mine) {
      const r = R.reach(st, m);
      if (!r.size) continue;
      // guards: the nearest monster to an intruder walks over to it
      let goal;
      if (intruders.length && R.dist(st, m.at, seat.dm) <= 8) {
        const t = intruders[0];
        goal = (i) => Math.max(0, R.dist(st, i, t.at) - 1) * 3;
      } else goal = (i) => far(st, s, f, i);
      const now = goal(m.at);
      let best = null, bestScore = now - 0.5;
      for (const [to, e] of r) {
        const sc = goal(to) + e.cost * 0.05;
        if (sc < bestScore) { bestScore = sc; best = to; }
      }
      if (best !== null) return { a: 'move', mon: m.id, to: best };
    }
    return null;
  }

  function plan(st, s, rand) {
    rand = rand || Math.random;
    if (st.over || st.turn.seat !== s || st.turn.pending) return null;
    const stage = st.turn.stage;
    if (stage === 'roll') return { a: 'roll', dice: chooseDice(st, s, rand) };
    if (stage === 'summon') return { a: 'summon', die: chooseSummon(st, s) };
    if (stage === 'place') return choosePlace(st, s, rand) || { a: 'unchoose' };
    const f = field(st, s);
    const atk = bestAttack(st, s);
    if (atk && atk.score >= 1000) return atk;
    const ab = bestAbility(st, s, f);                   // { score, act }
    if (ab && (!atk || ab.act.ab === 'rage' || ab.score > atk.score)) return ab.act;
    if (atk) return atk;
    return bestMove(st, s, f) || { a: 'end' };
  }

  // the reply to an attack on one of our monsters
  function answer(st, s) {
    const p = st.turn.pending;
    if (!p || p.seat !== s) return 'none';
    const a = R.monById(st, p.att), t = R.monById(st, p.tgt);
    if (!a || !t) return 'none';
    const COST = { none: 0, defend: 3, counter: 4, dodge: 7, mirror: 9 };
    let best = 'none', bestScore = -Infinity;
    for (const o of p.opts) {
      const r = R.preview(st, a, t, o, p.atk);
      let sc = -(r.dmg >= t.hp ? 100 + t.maxHp : r.dmg) - (COST[o] || 5);
      sc += r.back >= a.hp ? 40 + a.maxHp * 0.5 : r.back * 0.5;
      if (sc > bestScore) { bestScore = sc; best = o; }
    }
    return best;
  }

  // apply an action to the state through the rules; returns the rules' result
  function apply(st, s, act) {
    if (!act) return { ok: false, err: 'kein Plan', ev: [] };
    switch (act.a) {
      case 'roll': return R.roll(st, s, act.dice);
      case 'summon': return R.summon(st, s, act.die);
      case 'unchoose': R.unchoose(st, s); return R.summon(st, s, null);
      case 'place': return R.place(st, s, act.shape, act.ori, act.x, act.y);
      case 'move': return R.move(st, s, act.mon, act.to);
      case 'attack': return R.attack(st, s, act.mon, act.target);
      case 'ability': return R.useAbility(st, s, act.mon, act.ab, act.target);
      default: return R.endTurn(st, s);
    }
  }

  const api = { plan, answer, apply, chooseDice, choosePlace, field };
  if (node) module.exports = api; else root.VerliesBots = api;
})(typeof window !== 'undefined' ? window : globalThis);
