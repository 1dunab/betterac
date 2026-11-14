// ===== Würfelverlies — the rules engine (see docs/VERLIES.md) =====
// Plain script for the screen, the phones (placement preview) and Node tests. Deterministic: the only
// randomness is the seeded generator in the state. Every action returns { ok, err?, ev: [events] } and
// changes the state in place; nothing here draws, sends or waits.
(function (root) {
  const D = (typeof module === 'object' && module.exports) ? require('./data.js') : root.VerliesData;
  const { POOL, ORIENT, ABIL, UNIVERSAL, ITEMS, MONSTERS, BAGS } = D;

  const DEFAULTS = { size: 0, hearts: 3, cap: 10, formula: 'klassisch', mode: 'last', outMonsters: 'vanish', outPaths: 'stay', roundLimit: 0 };
  const SIZE_FOR = { 1: 15, 2: 15, 3: 17, 4: 19 };
  const EMPTY = 0, PATH = 1, MASTER = 2;

  // mulberry32 on st.rng
  function rnd(st) {
    let t = (st.rng = (st.rng + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---------- board geometry ----------
  // where the masters sit: 2 players face each other, 3 form a triangle, 4 sit on the four sides
  function masterSpots(n, w, h) {
    const cx = (w - 1) >> 1, cy = (h - 1) >> 1, hi = Math.round((h - 1) * 0.16);
    if (n <= 2) return [[cx, h - 1], [cx, 0]].slice(0, Math.max(1, n));
    if (n === 3) return [[cx, h - 1], [0, hi], [w - 1, hi]];
    return [[cx, h - 1], [cx, 0], [0, cy], [w - 1, cy]];
  }
  const SIDES = { 1: ['bottom'], 2: ['bottom', 'top'], 3: ['bottom', 'left', 'right'], 4: ['bottom', 'top', 'left', 'right'] };

  const idx = (st, x, y) => y * st.w + x;
  const inside = (st, x, y) => x >= 0 && y >= 0 && x < st.w && y < st.h;
  const X = (st, i) => i % st.w, Y = (st, i) => (i / st.w) | 0;
  const dist = (st, a, b) => Math.abs(X(st, a) - X(st, b)) + Math.abs(Y(st, a) - Y(st, b));
  function nbrs(st, i) {
    const x = X(st, i), y = Y(st, i), out = [];
    if (x > 0) out.push(i - 1);
    if (x < st.w - 1) out.push(i + 1);
    if (y > 0) out.push(i - st.w);
    if (y < st.h - 1) out.push(i + st.w);
    return out;
  }

  // ---------- a new game ----------
  // opts: { seats: [{ bag }], seed, first (who starts), size, hearts, cap, formula, mode, outMonsters, outPaths, roundLimit }
  function newGame(opts) {
    const cfg = Object.assign({}, DEFAULTS, opts || {});
    const n = Math.max(1, Math.min(4, (cfg.seats || []).length || 2));
    const w = cfg.size || SIZE_FOR[n], h = w;
    const st = {
      w, h, n, cfg: { hearts: cfg.hearts, cap: cfg.cap, formula: cfg.formula, mode: cfg.mode, outMonsters: cfg.outMonsters, outPaths: cfg.outPaths, roundLimit: cfg.roundLimit },
      kind: new Array(w * h).fill(EMPTY), owner: new Array(w * h).fill(-1), piece: new Array(w * h).fill(-1),
      pieces: [], seats: [], mons: [], items: [], nextId: 1, rng: (cfg.seed | 0) || 1,
      turn: null, over: null, teams: cfg.mode === 'team' && n === 4
    };
    const spots = masterSpots(n, w, h);
    for (let s = 0; s < n; s++) {
      const o = (cfg.seats && cfg.seats[s]) || {};
      const bag = BAGS[o.bag] ? o.bag : 'glut';
      const at = idx(st, spots[s][0], spots[s][1]);
      st.kind[at] = MASTER; st.owner[at] = s;
      st.seats.push({
        i: s, alive: true, hearts: cfg.hearts, dm: at, side: SIDES[n][s], bag, out: null, pitUsed: false,
        team: st.teams ? (s < 2 ? 0 : 1) : s,
        crests: { MOV: 0, ATK: 0, DEF: 0, MAG: 0, TRP: 0 },
        dice: BAGS[bag].dice.map((key) => ({ key, used: false }))
      });
    }
    st.turn = { seat: Math.max(0, Math.min(n - 1, cfg.first | 0)), first: Math.max(0, Math.min(n - 1, cfg.first | 0)), round: 1, n: 1, stage: 'roll', roll: null, chosen: null, pending: null };
    beginTurn(st, []);
    return st;
  }

  // ---------- small queries ----------
  const seatOf = (st, s) => st.seats[s];
  const monAt = (st, i) => st.mons.find((m) => m.at === i) || null;
  const monById = (st, id) => st.mons.find((m) => m.id === id) || null;
  const itemAt = (st, i) => st.items.find((t) => t.at === i) || null;
  const friends = (st, a, b) => a === b || (a >= 0 && b >= 0 && st.teams && st.seats[a].team === st.seats[b].team);
  const enemies = (st, a, b) => !friends(st, a, b);
  const has = (m, ab) => MONSTERS[m.key].abil.indexOf(ab) >= 0;
  const freeDice = (st, s) => st.seats[s].dice.map((d, k) => (d.used ? -1 : k)).filter((k) => k >= 0);
  const canPay = (st, s, cost) => Object.keys(cost || {}).every((c) => st.seats[s].crests[c] >= cost[c]);
  function pay(st, s, cost) { for (const c in cost || {}) st.seats[s].crests[c] = Math.max(0, st.seats[s].crests[c] - cost[c]); }
  function gain(st, s, c, n) {
    const p = st.seats[s].crests, before = p[c];
    p[c] = Math.max(0, Math.min(st.cfg.cap, before + n));
    return p[c] - before;
  }
  const turnOf = (st, s) => !st.over && st.turn.seat === s;
  const busy = (st) => !!st.turn.pending;

  // the central damage rule. Values come in tens. formula: klassisch (GBA: undefended = full ATK, defended = ATK − DEF),
  // panzer (DEF always counts half, all of it when defending), kratzer (like klassisch, but a hit always does at least 10)
  function damage(atk, def, defended, formula) {
    atk = Math.max(0, atk | 0); def = Math.max(0, def | 0);
    if (formula === 'panzer') return Math.max(0, atk - (defended ? def : Math.floor(def / 20) * 10));
    if (formula === 'kratzer') return defended ? Math.max(Math.min(10, atk), atk - def) : atk;
    return defended ? Math.max(0, atk - def) : atk;
  }

  // ---------- dimension: placing a piece ----------
  function pieceCells(st, shape, ori, ax, ay) {
    const o = ORIENT[shape] && ORIENT[shape][ori];
    if (!o) return null;
    return o.cells.map(([dx, dy]) => [ax + dx, ay + dy]);
  }
  // { ok, why: 'out' (off the board) | 'taken' (overlaps a path or a master) | 'alone' (touches none of your own tiles) }
  function canPlace(st, s, cells) {
    if (!cells || cells.length !== 6) return { ok: false, why: 'out' };
    for (const [x, y] of cells) if (!inside(st, x, y)) return { ok: false, why: 'out' };
    for (const [x, y] of cells) if (st.kind[idx(st, x, y)] !== EMPTY) return { ok: false, why: 'taken' };
    const touches = cells.some(([x, y]) => nbrs(st, idx(st, x, y)).some((j) => st.kind[j] !== EMPTY && st.owner[j] === s));
    return touches ? { ok: true } : { ok: false, why: 'alone' };
  }
  function validAnchors(st, s, shape, ori) {
    const out = [];
    for (let y = 0; y < st.h; y++) for (let x = 0; x < st.w; x++) if (canPlace(st, s, pieceCells(st, shape, ori, x, y)).ok) out.push([x, y]);
    return out;
  }
  function anyPlacement(st, s) {
    for (let sh = 0; sh < ORIENT.length; sh++) for (let o = 0; o < ORIENT[sh].length; o++)
      for (let y = 0; y < st.h; y++) for (let x = 0; x < st.w; x++) if (canPlace(st, s, pieceCells(st, sh, o, x, y)).ok) return { shape: sh, ori: o, x, y };
    return null;
  }

  // ---------- movement ----------
  // can monster m step onto cell j on its way (not necessarily stop there)?
  function passable(st, m, j) {
    if (st.kind[j] !== PATH) return false;
    const o = monAt(st, j);
    return !o || has(m, 'flug') || (o.seat >= 0 && friends(st, o.seat, m.seat));
  }
  const moveCost = (m, steps) => (has(m, 'flink') ? Math.max(1, steps - 1) : steps);
  // every cell m can reach this turn: Map cell → { steps, cost, prev }
  function reach(st, m) {
    const out = new Map(), budget = st.seats[m.seat] ? st.seats[m.seat].crests.MOV : 0;
    const maxSteps = has(m, 'flink') ? budget + 1 : budget;
    const prev = new Map([[m.at, -1]]), q = [[m.at, 0]];
    for (let k = 0; k < q.length; k++) {
      const [i, d] = q[k];
      if (d >= maxSteps) continue;
      for (const j of nbrs(st, i)) {
        if (prev.has(j) || !passable(st, m, j)) continue;
        prev.set(j, i);
        q.push([j, d + 1]);
        if (!monAt(st, j)) out.set(j, { steps: d + 1, cost: moveCost(m, d + 1), prev: i });
      }
    }
    for (const [j, e] of out) if (e.cost > budget) out.delete(j);
    out.prevOf = prev;
    return out;
  }
  function pathTo(st, m, to) {
    const r = reach(st, m);
    if (!r.has(to)) return null;
    const path = [to];
    for (let i = r.prevOf.get(to); i !== undefined && i !== -1; i = r.prevOf.get(i)) path.unshift(i);
    return path;   // starts with m.at
  }
  function canMove(st, m) {
    if (!m || m.seat < 0 || !turnOf(st, m.seat) || st.turn.stage !== 'act' || busy(st)) return false;
    return !m.frozenNow && !m.rootNow && !m.attacked && m.moves < 1 + (m.extra || 0) && st.seats[m.seat].crests.MOV > 0;
  }

  // ---------- attacks ----------
  function attackCells(st, m) {
    const x = X(st, m.at), y = Y(st, m.at), out = [];
    const far = has(m, 'reich') ? 2 : 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let k = 1; k <= far; k++) {
      if (inside(st, x + dx * k, y + dy * k)) out.push(idx(st, x + dx * k, y + dy * k));
    }
    return out;
  }
  // [{ mon: id } | { dm: seat }]
  function attackTargets(st, m) {
    const out = [];
    for (const j of attackCells(st, m)) {
      const o = monAt(st, j);
      if (o && (o.seat < 0 || enemies(st, m.seat, o.seat))) out.push({ mon: o.id });
      if (st.kind[j] === MASTER) {
        const s = st.owner[j];
        if (st.seats[s].alive && enemies(st, m.seat, s)) out.push({ dm: s });
      }
    }
    return out;
  }
  function canAttack(st, m) {
    if (!m || m.seat < 0 || !turnOf(st, m.seat) || st.turn.stage !== 'act' || busy(st)) return false;
    return !m.frozenNow && !m.attacked && st.seats[m.seat].crests.ATK > 0 && attackTargets(st, m).length > 0;
  }
  // what the defender of an attack on monster t could answer: 'none', 'defend', reaction ability keys
  function defenseOptions(st, t) {
    const out = ['none'];
    if (t.seat < 0) return out;
    if (st.seats[t.seat].crests.DEF > 0) out.push('defend');
    for (const ab of MONSTERS[t.key].abil) if (ABIL[ab].kind === 'reaction' && canPay(st, t.seat, ABIL[ab].cost)) out.push(ab);
    return out;
  }
  // the outcome of an answer, without changing anything: { dmg (to the target), back (to the attacker), heal (attacker), missed }
  function preview(st, a, t, choice, atk) {
    const f = st.cfg.formula, at = atk == null ? a.atk + (a.atkBuff || 0) : atk;
    const r = { dmg: 0, back: 0, heal: 0, missed: false };
    if (choice === 'dodge') r.missed = true;
    else if (choice === 'mirror') r.back += damage(at, t.def, false, f);
    else r.dmg = damage(at, t.def, choice === 'defend', f);
    if (choice === 'counter') r.back += 10;
    if (!r.missed && has(t, 'dornen')) r.back += 10;
    if (r.dmg > 0 && has(a, 'raub')) r.heal = 10;
    return r;
  }

  // ---------- abilities ----------
  function abilitiesOf(m) { return MONSTERS[m.key].abil.filter((ab) => ABIL[ab].kind === 'active').concat(UNIVERSAL); }
  function abilityTargets(st, m, ab) {
    const A = ABIL[ab], out = [];
    if (A.target === 'self' || A.target === 'none') return [{ none: true }];
    if (A.target === 'ally') for (const o of st.mons) { if (o.seat === m.seat && dist(st, o.at, m.at) <= 1) out.push({ mon: o.id }); }
    if (A.target === 'own') for (const o of st.mons) { if (o.seat === m.seat && o.id !== m.id) out.push({ mon: o.id }); }
    if (A.target === 'enemy') for (const o of st.mons) { if ((o.seat < 0 || enemies(st, m.seat, o.seat)) && dist(st, o.at, m.at) <= A.range) out.push({ mon: o.id }); }
    if (A.target === 'cell') for (const j of nbrs(st, m.at)) { if (st.kind[j] === PATH && !monAt(st, j) && !itemAt(st, j)) out.push({ cell: j }); }
    return out;
  }
  // why an ability can't be used right now ('' = it can)
  function abilityBlock(st, m, ab) {
    const A = ABIL[ab];
    if (!A || A.kind !== 'active' || abilitiesOf(m).indexOf(ab) < 0) return 'kann das nicht';
    if (!turnOf(st, m.seat) || st.turn.stage !== 'act' || busy(st)) return 'nicht jetzt';
    if (m.frozenNow) return 'eingefroren';
    if ((m.used || {})[ab]) return 'schon benutzt';
    if (ab === 'pit' && st.seats[m.seat].pitUsed) return 'nur eine Falle pro Zug';
    if (!canPay(st, m.seat, A.cost)) return 'zu wenig ' + Object.keys(A.cost).map((c) => D.CREST[c].emoji).join('');
    if (ab === 'sprint' && m.extra) return 'schon benutzt';
    if (!abilityTargets(st, m, ab).length) return 'kein Ziel';
    return '';
  }

  // ---------- turn flow ----------
  function beginTurn(st, ev) {
    const s = st.turn.seat, seat = st.seats[s];
    seat.pitUsed = false;
    for (const m of st.mons) if (m.seat === s) {
      m.moves = 0; m.attacked = false; m.extra = 0; m.atkBuff = 0; m.used = {};
      m.frozenNow = !!m.frozenNext; m.rootNow = !!m.rootNext || !!m.frozenNext; m.frozenNext = false; m.rootNext = false;
    }
    // items that work at the start of your turn
    for (const t of st.items) {
      if (t.seat !== s) continue;
      const m = monAt(st, t.at);
      if (!m || m.seat !== s) continue;
      if (t.key === 'quelle' && m.hp < m.maxHp) { const h = Math.min(20, m.maxHp - m.hp); m.hp += h; t.revealed = true; ev.push({ t: 'heal', mon: m.id, n: h, src: 'quelle', at: t.at }); }
      if (t.key === 'kristall') { const g = gain(st, s, 'MAG', 2); t.revealed = true; ev.push({ t: 'crystal', seat: s, n: g, at: t.at }); }
    }
    st.turn.stage = freeDice(st, s).length ? 'roll' : 'act';
    st.turn.roll = null; st.turn.chosen = null; st.turn.pending = null;
    ev.push({ t: 'turn', seat: s, round: st.turn.round, n: st.turn.n, noDice: st.turn.stage === 'act' });
  }

  function err(e) { return { ok: false, err: e, ev: [] }; }

  // roll the chosen dice (3, or all that are left)
  function roll(st, s, dice) {
    if (!turnOf(st, s) || st.turn.stage !== 'roll') return err('Gerade nicht würfeln');
    const free = freeDice(st, s), need = Math.min(3, free.length);
    dice = (dice || []).map((k) => k | 0);
    if (dice.length !== need || new Set(dice).size !== need || dice.some((k) => free.indexOf(k) < 0)) return err('Wähle ' + need + ' Würfel');
    const out = [], got = {}, lost = {}, lv = {};
    for (const k of dice) {
      const key = st.seats[s].dice[k].key, faces = D.facesOf(key), fi = Math.floor(rnd(st) * 6), f = faces[fi];
      out.push({ die: k, key, face: fi, c: f.c, n: f.n });
      if (f.c === 'SUM') { const L = MONSTERS[key].level; (lv[L] = lv[L] || []).push(k); }
      else {
        const g = gain(st, s, f.c, f.n);
        got[f.c] = (got[f.c] || 0) + g;
        if (g < f.n) lost[f.c] = (lost[f.c] || 0) + f.n - g;
      }
    }
    let level = 0, opts = [];
    for (const L in lv) if (lv[L].length >= 2) { level = +L; opts = lv[L]; }
    const room = opts.length ? !!anyPlacement(st, s) : true;
    st.turn.roll = { dice: out, got, lost, level, opts: room ? opts : [], noRoom: !room };
    st.turn.stage = opts.length && room ? 'summon' : 'act';
    return { ok: true, ev: [{ t: 'roll', seat: s, dice: out, got, lost, level, opts: st.turn.roll.opts, noRoom: !room }] };
  }

  // pick the die to summon (null = don't summon)
  function summon(st, s, die) {
    if (!turnOf(st, s) || st.turn.stage !== 'summon') return err('Gerade keine Beschwörung');
    if (die === null || die === undefined || die === -1) { st.turn.stage = 'act'; return { ok: true, ev: [{ t: 'nosummon', seat: s }] }; }
    if (st.turn.roll.opts.indexOf(die | 0) < 0) return err('Dieser Würfel kann nicht beschwören');
    st.turn.chosen = die | 0; st.turn.stage = 'place';
    return { ok: true, ev: [{ t: 'chosen', seat: s, die: die | 0, key: st.seats[s].dice[die | 0].key }] };
  }
  function unchoose(st, s) {
    if (!turnOf(st, s) || st.turn.stage !== 'place') return err('Nichts zurückzunehmen');
    st.turn.chosen = null; st.turn.stage = 'summon';
    return { ok: true, ev: [{ t: 'unchosen', seat: s }] };
  }

  // unfold the chosen die: the piece becomes path, the monster (or item) appears on its middle cell (the anchor)
  function place(st, s, shape, ori, x, y) {
    if (!turnOf(st, s) || st.turn.stage !== 'place') return err('Gerade nichts zu platzieren');
    const cells = pieceCells(st, shape | 0, ori | 0, x | 0, y | 0), ok = canPlace(st, s, cells);
    if (!ok.ok) return err({ out: 'Das Stück ragt über den Rand', taken: 'Dort liegt schon ein Weg', alone: 'Das Stück muss an deinen Weg grenzen' }[ok.why]);
    const pid = st.pieces.length, ids = cells.map(([cx, cy]) => idx(st, cx, cy));
    st.pieces.push({ id: pid, seat: s, cells: ids, round: st.turn.round });
    for (const i of ids) { st.kind[i] = PATH; st.owner[i] = s; st.piece[i] = pid; }
    const die = st.seats[s].dice[st.turn.chosen], def = MONSTERS[die.key], at = idx(st, x | 0, y | 0);
    die.used = true;
    const ev = [{ t: 'place', seat: s, piece: pid, cells: ids, at }];
    if (def.kind === 'item') {
      const it = { id: st.nextId++, key: def.item, seat: s, at, revealed: false };
      st.items.push(it);
      ev.push({ t: 'item', seat: s, item: it.id, key: it.key, at });
    } else {
      const m = { id: st.nextId++, key: die.key, seat: s, at, hp: def.hp, maxHp: def.hp, atk: def.atk, def: def.def,
        moves: 0, attacked: false, extra: 0, atkBuff: 0, used: {}, frozenNow: false, rootNow: false, frozenNext: false, rootNext: false, born: st.turn.n };
      st.mons.push(m);
      ev.push({ t: 'summon', seat: s, mon: m.id, key: m.key, at });
    }
    st.turn.chosen = null; st.turn.stage = 'act';
    return { ok: true, ev };
  }

  function move(st, s, id, to) {
    const m = monById(st, id);
    if (!m || m.seat !== s) return err('Kein eigenes Monster');
    if (!canMove(st, m)) return err(m && m.rootNow ? 'Es hängt fest' : m && m.attacked ? 'Nach dem Angriff geht es nicht mehr' : 'Es kann sich gerade nicht bewegen');
    const path = pathTo(st, m, to | 0);
    if (!path) return err('Da kommt es nicht hin');
    const ev = [], walked = [m.at];
    let trap = null;
    for (let k = 1; k < path.length; k++) {
      walked.push(path[k]);
      const t = itemAt(st, path[k]);
      if (t && ITEMS[t.key].trap && enemies(st, t.seat, s) && !monAt(st, path[k])) { trap = t; break; }
    }
    const cost = moveCost(m, walked.length - 1);
    pay(st, s, { MOV: cost });
    m.at = walked[walked.length - 1]; m.moves++;
    ev.push({ t: 'move', seat: s, mon: m.id, path: walked, cost });
    if (trap) {
      const I = ITEMS[trap.key];
      st.items.splice(st.items.indexOf(trap), 1);
      ev.push({ t: 'trap', mon: m.id, key: trap.key, seat: trap.seat, at: trap.at, dmg: I.dmg });
      if (I.root) { m.rootNow = true; m.rootNext = true; }
      m.moves = 99;
      hurt(st, m, I.dmg, ev, trap.seat);
    }
    return { ok: true, ev };
  }

  function hurt(st, m, n, ev, by) {
    if (n <= 0 || st.mons.indexOf(m) < 0) return;
    m.hp = Math.max(0, m.hp - n);
    ev.push({ t: 'damage', mon: m.id, n, hp: m.hp, at: m.at });
    if (m.hp <= 0) {
      st.mons.splice(st.mons.indexOf(m), 1);
      ev.push({ t: 'destroy', mon: m.id, key: m.key, seat: m.seat, at: m.at, by });
    }
  }
  function heal(m, n, ev) {
    const h = Math.min(n, m.maxHp - m.hp);
    if (h > 0) { m.hp += h; ev.push({ t: 'heal', mon: m.id, n: h, at: m.at }); }
  }

  // target: { mon: id } | { dm: seat }. A hit on a monster waits for the defender's answer (st.turn.pending), unless there is none to give
  function attack(st, s, id, target) {
    const m = monById(st, id);
    if (!m || m.seat !== s) return err('Kein eigenes Monster');
    if (!canAttack(st, m)) return err(m.frozenNow ? 'Es ist eingefroren' : m.attacked ? 'Es hat schon angegriffen' : st.seats[s].crests.ATK < 1 ? 'Kein ⚔️ übrig' : 'Niemand in Reichweite');
    target = target || {};
    const ok = attackTargets(st, m).some((t) => (target.dm !== undefined ? t.dm === target.dm : t.mon === target.mon));
    if (!ok) return err('Ziel nicht in Reichweite');
    pay(st, s, { ATK: 1 });
    m.attacked = true;
    if (target.dm !== undefined) {
      const v = st.seats[target.dm];
      v.hearts = Math.max(0, v.hearts - 1);
      const ev = [{ t: 'attack', seat: s, mon: m.id, dm: target.dm, from: m.at, at: v.dm }, { t: 'heart', seat: target.dm, hearts: v.hearts, by: s, at: v.dm }];
      m.atkBuff = 0;
      if (v.hearts <= 0) eliminate(st, target.dm, s, ev);
      return { ok: true, ev };
    }
    const t = monById(st, target.mon), atk = m.atk + (m.atkBuff || 0), opts = defenseOptions(st, t);
    st.turn.pending = { att: m.id, tgt: t.id, seat: t.seat, atk, opts };
    const ev = [{ t: 'attack', seat: s, mon: m.id, tgt: t.id, from: m.at, at: t.at, atk, opts }];
    if (opts.length === 1) { const r = respond(st, t.seat, 'none'); return { ok: true, ev: ev.concat(r.ev) }; }
    return { ok: true, ev, waiting: true };
  }

  // the defender answers a pending attack. `seat` is the defender (or -1 for a neutral monster, which always takes it)
  function respond(st, seat, choice) {
    const p = st.turn.pending;
    if (!p) return err('Kein Angriff offen');
    if (seat !== p.seat) return err('Nicht dein Monster');
    if (p.opts.indexOf(choice) < 0) choice = 'none';
    const a = monById(st, p.att), t = monById(st, p.tgt), ev = [];
    st.turn.pending = null;
    if (!a || !t) return { ok: true, ev };
    if (choice === 'defend') pay(st, seat, { DEF: 1 });
    else if (ABIL[choice]) pay(st, seat, ABIL[choice].cost);
    const r = preview(st, a, t, choice, p.atk);
    ev.push({ t: 'clash', att: a.id, tgt: t.id, choice, dmg: r.dmg, back: r.back, missed: r.missed, atk: p.atk, def: t.def, at: t.at, from: a.at });
    a.atkBuff = 0;
    if (r.dmg > 0) hurt(st, t, r.dmg, ev, a.seat);
    if (r.heal > 0 && st.mons.indexOf(a) >= 0) heal(a, r.heal, ev);
    if (r.back > 0) hurt(st, a, r.back, ev, t.seat);
    return { ok: true, ev };
  }

  // target: { mon } | { cell } | {} depending on the ability
  function useAbility(st, s, id, ab, target) {
    const m = monById(st, id);
    if (!m || m.seat !== s) return err('Kein eigenes Monster');
    const why = abilityBlock(st, m, ab);
    if (why) return err(ABIL[ab] ? ABIL[ab].name + ': ' + why : why);
    const A = ABIL[ab], list = abilityTargets(st, m, ab);
    target = target || {};
    let tg = null;
    if (A.target === 'self' || A.target === 'none') tg = {};
    else if (A.target === 'cell') tg = list.find((x) => x.cell === (target.cell | 0)) || null;
    else tg = list.find((x) => x.mon === target.mon) || null;
    if (!tg) return err(A.name + ': kein gültiges Ziel');
    pay(st, s, A.cost);
    m.used = m.used || {}; m.used[ab] = true;
    const ev = [{ t: 'ability', seat: s, mon: m.id, ab, at: m.at, tgt: tg.mon, cell: tg.cell }];
    const tm = tg.mon ? monById(st, tg.mon) : null;
    if (ab === 'sprint') m.extra = 1;
    else if (ab === 'rage') m.atkBuff = 20;
    else if (ab === 'heal') heal(tm, A.amount, ev);
    else if (ab === 'bolt' || ab === 'bolt2') hurt(st, tm, A.dmg, ev, s);
    else if (ab === 'breath' || ab === 'wave') {
      const hit = st.mons.filter((o) => (o.seat < 0 || enemies(st, s, o.seat)) && dist(st, o.at, m.at) <= A.range);
      for (const o of hit) hurt(st, o, A.dmg, ev, s);
    } else if (ab === 'aura') { for (const o of st.mons.filter((o) => o.seat === s && dist(st, o.at, m.at) <= A.range)) heal(o, A.amount, ev); }
    else if (ab === 'root') { tm.rootNext = true; ev.push({ t: 'status', mon: tm.id, what: 'root', at: tm.at }); }
    else if (ab === 'freeze') { tm.frozenNext = true; ev.push({ t: 'status', mon: tm.id, what: 'freeze', at: tm.at }); }
    else if (ab === 'swap') { const a = m.at; m.at = tm.at; tm.at = a; ev.push({ t: 'swap', a: m.id, b: tm.id, at: m.at, to: tm.at }); }
    else if (A.item) {
      const it = { id: st.nextId++, key: A.item, seat: s, at: tg.cell, revealed: false };
      st.items.push(it);
      if (ab === 'pit') st.seats[s].pitUsed = true;
      ev.push({ t: 'item', seat: s, item: it.id, key: it.key, at: tg.cell });
    }
    return { ok: true, ev };
  }

  // a master lost its last heart
  function eliminate(st, s, by, ev) {
    const seat = st.seats[s];
    if (!seat.alive) return;
    seat.alive = false; seat.out = st.turn.round;
    ev.push({ t: 'out', seat: s, by });
    for (const m of st.mons.filter((m) => m.seat === s)) {
      if (st.cfg.outMonsters === 'stay') { m.was = s; m.seat = -1; ev.push({ t: 'wild', mon: m.id, at: m.at }); }
      else { st.mons.splice(st.mons.indexOf(m), 1); ev.push({ t: 'vanish', mon: m.id, key: m.key, at: m.at }); }
    }
    st.items = st.items.filter((t) => t.seat !== s);
    if (st.cfg.outPaths === 'vanish') {
      const gone = [];
      for (let i = 0; i < st.kind.length; i++) {
        if (st.kind[i] === PATH && st.owner[i] === s && !monAt(st, i)) { st.kind[i] = EMPTY; st.owner[i] = -1; st.piece[i] = -1; gone.push(i); }
      }
      ev.push({ t: 'crumble', seat: s, cells: gone });
    }
    if (st.cfg.mode === 'first' && by >= 0) return finish(st, [by], 'first', ev);
    checkOver(st, ev);
  }
  function checkOver(st, ev) {
    if (st.over) return;
    const alive = st.seats.filter((x) => x.alive);
    if (st.teams) {
      const teams = new Set(alive.map((x) => x.team));
      if (teams.size <= 1) { const tm = alive.length ? alive[0].team : -1; finish(st, st.seats.filter((x) => x.team === tm).map((x) => x.i), 'team', ev); }
    } else if (alive.length <= 1 && st.n > 1) finish(st, alive.map((x) => x.i), 'last', ev);
  }
  function finish(st, winners, why, ev) {
    st.over = { winners, why, round: st.turn.round };
    st.turn.pending = null;
    ev.push({ t: 'over', winners, why });
  }
  // round limit: most hearts, then most life on the board
  function finishByScore(st, ev) {
    const alive = st.seats.filter((x) => x.alive);
    const life = (s) => st.mons.filter((m) => m.seat === s).reduce((a, m) => a + m.hp, 0);
    const score = (x) => x.hearts * 1000 + life(x.i);
    const best = Math.max.apply(null, alive.map(score));
    let win = alive.filter((x) => score(x) === best).map((x) => x.i);
    if (st.teams) { const tm = st.seats[win[0]].team; win = st.seats.filter((x) => x.team === tm).map((x) => x.i); }
    finish(st, win, 'limit', ev);
  }

  function nextSeat(st, s) {
    let nx = s;
    for (let k = 0; k < st.n; k++) { nx = (nx + 1) % st.n; if (st.seats[nx].alive) break; }
    return nx;
  }
  // a new round starts when the turn passes the first player's seat (seats are numbered from the first player on)
  const wraps = (st, s, nx) => ((nx - st.turn.first + st.n) % st.n) <= ((s - st.turn.first + st.n) % st.n);

  function endTurn(st, s) {
    if (!turnOf(st, s)) return err('Du bist nicht dran');
    if (busy(st)) return err('Erst den Angriff abwarten');
    const ev = [{ t: 'endturn', seat: s }];
    for (const m of st.mons) if (m.seat === s) { m.atkBuff = 0; m.frozenNow = false; m.rootNow = false; }
    const nx = nextSeat(st, s);
    if (wraps(st, s, nx)) st.turn.round++;
    st.turn.n++;
    if (st.cfg.roundLimit > 0 && st.turn.round > st.cfg.roundLimit) { st.turn.round = st.cfg.roundLimit; finishByScore(st, ev); return { ok: true, ev }; }
    st.turn.seat = nx;
    beginTurn(st, ev);
    return { ok: true, ev };
  }

  // a player leaves for good (nobody takes over): the master falls, like losing the last heart
  function resign(st, s) {
    if (st.over || !st.seats[s] || !st.seats[s].alive) return { ok: true, ev: [] };
    const ev = [], wasTurn = st.turn.seat === s;
    if (st.turn.pending && st.turn.pending.seat === s) ev.push.apply(ev, respond(st, s, 'none').ev);
    st.seats[s].hearts = 0;
    eliminate(st, s, -1, ev);
    if (!st.over && wasTurn) {
      st.turn.pending = null;
      const nx = nextSeat(st, s);
      if (wraps(st, s, nx)) st.turn.round++;
      st.turn.n++; st.turn.seat = nx;
      beginTurn(st, ev);
    }
    return { ok: true, ev };
  }

  const api = {
    DEFAULTS, SIZE_FOR, EMPTY, PATH, MASTER, rnd, masterSpots, idx, inside, X, Y, dist, nbrs,
    newGame, monAt, monById, itemAt, friends, enemies, has, freeDice, canPay, damage,
    pieceCells, canPlace, validAnchors, anyPlacement, passable, moveCost, reach, pathTo, canMove,
    attackCells, attackTargets, canAttack, defenseOptions, preview, abilitiesOf, abilityTargets, abilityBlock,
    roll, summon, unchoose, place, move, attack, respond, useAbility, endTurn, resign
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VerliesRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
