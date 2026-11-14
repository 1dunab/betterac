// ===== Würfelverlies — TV glue: seats, bag choice, turn flow, bots, timers, phone protocol (see docs/VERLIES.md) =====
// The rules (rules.js) decide, the bots (bots.js) choose, the view (render.js) draws. This file runs the match:
// it takes the phones' messages, hands them to the rules, feeds the events to the view and tells every phone
// what it may see. Everything is driven from render() with performance.now() deadlines.
(function () {
  const BOT_STEP = 950;        // ms between two bot actions
  const ROLL_PAUSE = 2300;     // after a roll: the dice tumble on the TV
  const DEF_MAX = 20000;       // a defender's time to answer
  const PREP_MAX = 45000;      // choosing dice bags
  const START_PAUSE = 1500;    // all bags chosen → the board appears

  registerGame({ key: 'verlies', screen: function () {
    const D = window.VerliesData, R = window.VerliesRules, B = window.VerliesBots;
    const TS = () => { const s = window.VL_TIME_SCALE; return s > 0 ? s : 1; };
    const ms = (x) => x * TS();
    const nowMs = () => performance.now();
    const send = (id, d) => { try { ac.message(id, d); } catch (e) {} };

    let cfg = {}, seats = [], spect = [], phase = 'prep', st = null, prep = null, rematchBags = null;
    let log = [], preview = null, sel = null, botAt = 0, stepAt = 0, defAt = 0, pendAt = 0, reported = false, lastFocusAt = 0;
    let view = null, wrap = null, blitAt = 0, listeners = [];
    const rand = Math.random;

    // ---------- helpers ----------
    const seatIdx = (id) => seats.findIndex((s) => s.id === id);
    const botSeat = (s) => !!seats[s] && (seats[s].bot || seats[s].offline);
    const color = (s) => (seats[s] ? seats[s].color : '#999');
    const name = (s) => (seats[s] ? seats[s].name : '?');
    const monName = (id) => { const m = st && R.monById(st, id); return m ? D.MONSTERS[m.key].name : 'Ein Monster'; };
    const think = () => (cfg.zugzeit | 0) * 1000;
    function addLog(text, s) { log.push({ text, color: s >= 0 ? color(s) : '#9a92a8', at: nowMs() }); if (log.length > 40) log.shift(); }

    // ---------- the full-window canvas ----------
    function ensureView() {
      if (view) return view;
      view = new window.VerliesView();
      wrap = document.createElement('div'); wrap.id = 'vlWrap';
      wrap.style.cssText = 'position:fixed; inset:0; z-index:5; background:#07060a; line-height:0;';
      view.canvas.style.cssText = 'position:absolute; left:0; top:0; width:100%; height:100%; max-width:none; max-height:none; margin:0; border-radius:0; box-shadow:none; background:#07060a; display:block;';
      wrap.appendChild(view.canvas);
      document.body.appendChild(wrap);
      cv.style.display = 'none';
      // zoom with the wheel, drag to pan, double-click: back to the automatic camera
      let drag = null;
      const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); listeners.push([el, ev, fn]); };
      const pt = (e) => { const r = view.canvas.getBoundingClientRect(), k = view.W / (r.width || 1); return [(e.clientX - r.left) * k, (e.clientY - r.top) * k, k]; };
      on(view.canvas, 'wheel', (e) => { if (!st) return; e.preventDefault(); const [x, y] = pt(e); view.zoomAt(view.layout(st), x, y, e.deltaY < 0 ? 1.12 : 1 / 1.12, st); }, { passive: false });
      on(view.canvas, 'mousedown', (e) => { drag = pt(e); });
      on(window, 'mouseup', () => { drag = null; });
      on(window, 'mousemove', (e) => { if (!drag || !st) return; const p = pt(e); view.pan(view.layout(st), p[0] - drag[0], p[1] - drag[1]); drag = p; });
      on(view.canvas, 'dblclick', () => view.unpin());
      on(window, 'keydown', (e) => {
        if (!st) return;
        const L = view.layout(st), cx = view.W / 2, cy = view.H / 2;
        if (e.key === '+' || e.key === '=') view.zoomAt(L, cx, cy, 1.15, st);
        else if (e.key === '-') view.zoomAt(L, cx, cy, 1 / 1.15, st);
        else if (e.key === '0') view.unpin();
      });
      return view;
    }
    function fit() {
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      let w = Math.round((window.innerWidth || 960) * dpr), h = Math.round((window.innerHeight || 600) * dpr);
      const cap = 3840 * 2160, px = w * h;
      if (px > cap) { const k = Math.sqrt(cap / px); w = Math.round(w * k); h = Math.round(h * k); }
      view.resize(w, h);
    }
    // Mitschauen: the picture into the shell canvas, a few times a second, only while someone watches
    function blit() {
      const watching = typeof viewerCount === 'number' ? viewerCount > 0 : false;
      if (!watching || nowMs() - blitAt < 120) return;
      blitAt = nowMs();
      const c = cv.width, d = cv.height, k = Math.min(c / view.W, d / view.H), w = view.W * k, h = view.H * k;
      ctx.fillStyle = '#07060a'; ctx.fillRect(0, 0, c, d);
      ctx.drawImage(view.canvas, (c - w) / 2, (d - h) / 2, w, h);
    }

    // ---------- seats and bags ----------
    function buildSeats(ids) {
      const humans = ids.slice(0, 4);
      spect = ids.slice(4);
      const total = Math.max(2, Math.min(4, humans.length + (cfg.bots | 0)));
      seats = humans.map((id) => ({ id, bot: false, name: nameOf(id), offline: false }));
      let b = 0;
      while (seats.length < total) seats.push({ id: null, bot: true, name: D.BOT_NAMES[b++ % 4], offline: false });
      seats.forEach((s, i) => { s.color = D.SEATS[i].color; });
    }
    function beginPrep() {
      phase = 'prep'; st = null; preview = null; sel = null; reported = false;
      prep = { bags: seats.map(() => null), deadline: nowMs() + ms(PREP_MAX), doneAt: 0 };
      const free = D.BAG_KEYS.slice();
      seats.forEach((s, i) => {
        if (!s.bot && !s.offline) return;
        const pool = free.length ? free : D.BAG_KEYS;
        prep.bags[i] = pool[Math.floor(rand() * pool.length)];
        const k = free.indexOf(prep.bags[i]); if (k >= 0) free.splice(k, 1);
      });
      log = [];
      if (view) view.reset(null);
      broadcast();
    }
    function chooseBag(s, bag) {
      if (phase !== 'prep' || !D.BAGS[bag]) return;
      prep.bags[s] = bag;
      sfx('pop');
      if (prep.bags.every(Boolean) && !prep.doneAt) prep.doneAt = nowMs() + ms(START_PAUSE);
      broadcast();
    }
    function beginPlay() {
      const n = seats.length;
      let mode = cfg.modus || 'last';
      if (mode === 'team' && n !== 4) { mode = 'last'; setBanner('🤝 Zwei gegen zwei braucht 4 Plätze – jetzt jeder gegen jeden', 5000); }
      st = R.newGame({
        seats: seats.map((s, i) => ({ bag: prep.bags[i] })), seed: (Math.random() * 2147483646 + 1) | 0, first: Math.floor(rand() * n),
        size: cfg.feld === 'auto' ? 0 : (+cfg.feld || 0), hearts: cfg.herzen | 0 || 3, cap: +cfg.lager || 10, formula: cfg.formel,
        mode, outMonsters: cfg.monster, outPaths: cfg.pfade, roundLimit: +cfg.runden || 0
      });
      phase = 'play'; log = []; preview = null; sel = null;
      ensureView(); view.reset(st);
      if (st.teams) addLog('🤝 Rot & Blau gegen Grün & Violett', -1);
      handle({ ok: true, ev: [{ t: 'turn', seat: st.turn.seat, round: 1, n: 1 }] });
      sfx('whoosh');
    }

    // ---------- events → log, sound, camera, phones ----------
    function handle(res) {
      if (!res || !res.ok) return false;
      for (const e of res.ev) {
        if (view) view.event(e, st, seats);
        narrate(e);
      }
      if (st && st.over && phase !== 'over') gameOver();
      broadcast();
      return true;
    }
    function narrate(e) {
      const now = nowMs();
      if (e.t === 'turn') {
        addLog('Runde ' + e.round + ' · ' + name(e.seat) + ' ist dran' + (e.noDice ? ' (keine Würfel mehr)' : ''), e.seat);
        stepAt = now; botAt = Math.max(botAt, now + ms(BOT_STEP)); preview = null; sel = null;
        if (view) view.focus(null, st);
        if (seats[e.seat] && !botSeat(e.seat)) { send(seats[e.seat].id, { t: 'vlBuzz' }); sfx('beep'); }
      } else if (e.t === 'roll') {
        const got = D.POOL.filter((c) => e.got[c]).map((c) => '+' + e.got[c] + ' ' + D.CREST[c].emoji).join(' ');
        addLog(name(e.seat) + ' würfelt: ' + [got, e.opts.length ? '⭐ Beschwörung!' : ''].filter(Boolean).join(' · ') + (got || e.opts.length ? '' : 'nichts Brauchbares'), e.seat);
        botAt = now + ms(ROLL_PAUSE); sfx(e.opts.length ? 'powerup' : 'whoosh');
      } else if (e.t === 'summon') { addLog(name(e.seat) + ' ruft ' + D.MONSTERS[e.key].name + ' (Stufe ' + D.MONSTERS[e.key].level + ')', e.seat); sfx('powerup'); preview = null; }
      else if (e.t === 'place') { sfx('thud'); botAt = now + ms(1300); preview = null; }
      else if (e.t === 'item') { addLog(name(e.seat) + ' versteckt etwas im Verlies', e.seat); }
      else if (e.t === 'nosummon') addLog(name(e.seat) + ' verzichtet auf die Beschwörung', e.seat);
      else if (e.t === 'move') {
        addLog(monName(e.mon) + ' zieht ' + (e.path.length - 1) + ' Feld' + (e.path.length > 2 ? 'er' : ''), e.seat); sfx('pop');
        botAt = now + ms(BOT_STEP + 140 * e.path.length);
      } else if (e.t === 'attack') {
        if (e.dm !== undefined) addLog('⚔️ ' + monName(e.mon) + ' greift ' + name(e.dm) + 's Meister an!', e.seat);
        else { addLog('⚔️ ' + monName(e.mon) + ' greift ' + monName(e.tgt) + ' an', e.seat); pendAt = now; defAt = now + ms(DEF_MAX); }
        sfx('hit'); botAt = now + ms(1400);
      } else if (e.t === 'clash') {
        const verb = e.missed ? 'weicht aus 💫' : e.choice === 'defend' ? 'wehrt ab 🛡️' : e.choice === 'mirror' ? 'spiegelt den Treffer 🪞' : e.choice === 'counter' ? 'schlägt zurück ↩️' : 'steckt ein';
        const t = st && R.monById(st, e.tgt), a = st && R.monById(st, e.att);
        const line = monName(e.tgt) + ' ' + verb + ' · ' + (e.dmg ? '−' + e.dmg + ' LP' : 'kein Schaden') + (e.back ? ' · ' + monName(e.att) + ' −' + e.back : '');
        addLog(line, t ? t.seat : -1);
        // both phones learn how it went
        for (const s of new Set([a && a.seat, t && t.seat])) if (s >= 0 && seats[s] && !botSeat(s)) send(seats[s].id, { t: 'vlToast', text: '⚔️ ' + line, kind: 'info' });
        if (e.choice === 'defend') sfx('thud');
      } else if (e.t === 'damage') sfx('hit');
      else if (e.t === 'destroy') {
        addLog('💥 ' + D.MONSTERS[e.key].name + ' wird zerstört', e.seat); sfx('explosion');
        for (const s of new Set([e.seat, e.by])) if (s >= 0 && seats[s] && !botSeat(s)) send(seats[s].id, { t: 'vlToast', text: '💥 ' + D.MONSTERS[e.key].name + (s === e.seat ? ' (deins)' : '') + ' wurde zerstört', kind: 'info' });
      }
      else if (e.t === 'vanish') { /* the "out" line says it */ }
      else if (e.t === 'heart') {
        addLog('💔 ' + name(e.seat) + ' verliert ein Herz (' + e.hearts + ' übrig)', e.seat); sfx('explosion');
        if (seats[e.seat] && !botSeat(e.seat)) { send(seats[e.seat].id, { t: 'vlToast', text: '💔 Dein Meister wurde getroffen! Noch ' + e.hearts + ' ❤️', kind: 'info' }); send(seats[e.seat].id, { t: 'vlBuzz' }); }
        if (seats[e.by] && !botSeat(e.by)) send(seats[e.by].id, { t: 'vlToast', text: '🎯 Treffer! ' + name(e.seat) + ' hat noch ' + e.hearts + ' ❤️', kind: 'info' });
      }
      else if (e.t === 'trap') {
        if (seats[e.seat] && !botSeat(e.seat)) send(seats[e.seat].id, { t: 'vlToast', text: '🪤 Deine ' + D.ITEMS[e.key].name + ' hat ' + monName(e.mon) + ' erwischt!', kind: 'info' });
      }
      else if (e.t === 'out') { addLog('💀 ' + name(e.seat) + ' ist ausgeschieden', e.seat); sfx('sad'); }
      else if (e.t === 'trap') { addLog(D.ITEMS[e.key].icon + ' ' + monName(e.mon) + ' tappt in eine Falle!', e.seat); sfx('splash'); }
      else if (e.t === 'ability') { addLog(monName(e.mon) + ': ' + D.ABIL[e.ab].icon + ' ' + D.ABIL[e.ab].name, e.seat); sfx('powerup'); botAt = now + ms(1200); }
      else if (e.t === 'heal' && e.src === 'quelle') addLog('⛲ Ein Heilquell heilt ' + monName(e.mon), -1);
      else if (e.t === 'crystal') addLog('💎 Eine Kristallader schenkt ' + name(e.seat) + ' +' + e.n + ' ✨', e.seat);
      else if (e.t === 'endturn') { preview = null; sel = null; }
      if (e.t !== 'turn' && st && seats[st.turn.seat] && !botSeat(st.turn.seat)) stepAt = now;
    }
    function gameOver() {
      phase = 'over';
      const w = st.over.winners;
      addLog('🏆 ' + (w.length ? w.map(name).join(' & ') : 'Niemand') + ' gewinnt', w.length ? w[0] : -1);
      sfx('fanfare');
      if (!reported) { reported = true; reportWinners(w.map((s) => seats[s] && seats[s].id).filter((id) => id !== null && id !== undefined)); }
    }

    // ---------- what each phone sees ----------
    function boardString() {
      let s = '';
      for (let i = 0; i < st.kind.length; i++) s += st.kind[i] === R.EMPTY ? '.' : String.fromCharCode((st.kind[i] === R.MASTER ? 65 : 97) + st.owner[i]);
      return s;
    }
    function gameFor(me) {
      const nil = { MOV: 0, ATK: 0, DEF: 0, MAG: 0, TRP: 0 };
      return {
        w: st.w, h: st.h, n: st.n, teams: st.teams, cfg: st.cfg, board: boardString(),
        seats: st.seats.map((x) => ({ i: x.i, alive: x.alive, hearts: x.hearts, dm: x.dm, side: x.side, bag: x.bag, out: x.out, team: x.team, pitUsed: x.pitUsed,
          crests: x.i === me ? x.crests : nil, dice: x.i === me ? x.dice : x.dice.map((d) => ({ key: '', used: d.used })) })),
        mons: st.mons, items: st.items.map((t) => (t.seat === me || t.revealed ? t : { id: t.id, seat: t.seat, at: t.at, key: '', revealed: false })),
        turn: st.turn, over: st.over, nextId: st.nextId
      };
    }
    function stateFor(id) {
      const me = seatIdx(id), now = nowMs();
      const d = { t: 'vlState', phase, me, host: id === hostId(),
        seats: seats.map((s, i) => ({ name: s.name, color: s.color, bot: s.bot, offline: s.offline, bag: st ? st.seats[i].bag : prep && prep.bags[i] })) };
      if (phase === 'prep' || !st) { d.phase = 'prep'; d.prep = prep ? { bags: prep.bags, left: Math.max(0, Math.ceil((prep.deadline - now) / 1000 / TS())) } : { bags: [], left: 0 }; return d; }
      d.g = gameFor(me);
      d.secs = think() && st.turn.seat === me && !st.turn.pending && !st.over ? Math.max(0, Math.ceil((stepAt + ms(think()) - now) / 1000 / TS())) : 0;
      d.defSecs = st.turn.pending ? Math.max(0, Math.ceil((defAt - now) / 1000 / TS())) : 0;
      return d;
    }
    function broadcast() { for (const s of seats) if (s.id !== null && !s.offline) send(s.id, stateFor(s.id)); for (const id of spect) send(id, stateFor(id)); }
    const toast = (id, text) => send(id, { t: 'vlToast', text });

    // ---------- the model for the view ----------
    function model() {
      const now = nowMs(), M = { phase, st, seats, log, preview, sel: sel ? sel.mon : null, reach: null, targets: null, pending: st && st.turn.pending };
      if (phase === 'prep') M.prep = { bags: prep.bags, left: Math.max(0, Math.ceil((prep.deadline - now) / 1000 / TS())) };
      if (st) {
        M.over = st.over;
        if (think() && !botSeat(st.turn.seat)) { M.turnTotal = think() / 1000; M.turnLeft = Math.max(0, Math.ceil((stepAt + ms(think()) - now) / 1000 / TS())); }
        if (st.turn.pending) M.defLeft = Math.max(0, Math.ceil((defAt - now) / 1000 / TS()));
        if (sel) {
          const m = R.monById(st, sel.mon);
          if (!m) sel = null;
          else if (sel.mode === 'move' && R.canMove(st, m)) M.reach = [...R.reach(st, m)].map(([at, e]) => ({ at, cost: e.cost }));
          else if (sel.mode === 'attack' && R.canAttack(st, m)) M.targets = R.attackTargets(st, m).map((t) => (t.dm !== undefined ? st.seats[t.dm].dm : R.monById(st, t.mon).at));
          else if (sel.mode === 'ability' && D.ABIL[sel.ab]) M.targets = R.abilityTargets(st, m, sel.ab).filter((t) => t.mon || t.cell !== undefined).map((t) => (t.mon ? R.monById(st, t.mon).at : t.cell));
        }
      }
      return M;
    }
    function focusCamera() {
      if (!view || !st || cfg.kamera === 'fest') { if (view && st) view.focus(null, st); return; }
      const now = nowMs();
      let cells = null;
      if (preview) cells = preview.cells.map(([x, y]) => [x, y]);
      else if (st.turn.pending) { const a = R.monById(st, st.turn.pending.att), t = R.monById(st, st.turn.pending.tgt); if (a && t) cells = [a.at, t.at].map((i) => [R.X(st, i), R.Y(st, i)]); }
      if (cells) {
        lastFocusAt = now;
        const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
        view.focus([Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3], st);
      } else if (now - lastFocusAt > 2500) view.focus(null, st);
    }

    // ---------- the clock: bots, timeouts, the bag countdown ----------
    function tick() {
      const now = nowMs();
      if (phase === 'prep') {
        if (now > prep.deadline) prep.bags.forEach((b, i) => { if (!b) chooseBag(i, D.BAG_KEYS[Math.floor(rand() * 4)]); });
        if (!prep.doneAt && prep.bags.every(Boolean)) prep.doneAt = now + ms(START_PAUSE);
        if (prep.doneAt && now > prep.doneAt) beginPlay();
        return;
      }
      if (phase !== 'play' || !st || st.over) return;
      const p = st.turn.pending;
      if (p) {
        // a bot (or a phone that is away, or too slow) answers the attack
        const auto = p.seat < 0 || botSeat(p.seat);
        if ((auto && now - pendAt > ms(900)) || now > defAt) {
          const choice = B.answer(st, p.seat);
          handle(R.respond(st, p.seat, choice));
          botAt = Math.max(botAt, now + ms(1100));
        }
        return;
      }
      const s = st.turn.seat;
      if (botSeat(s)) {
        if (now < botAt) return;
        const act = B.plan(st, s, rand);
        const res = B.apply(st, s, act);
        if (!handle(res)) handle(R.endTurn(st, s));
        if (act && act.a === 'end') botAt = now + ms(BOT_STEP);
        return;
      }
      // a human who lets the clock run out: the autopilot takes this one step
      if (think() && now > stepAt + ms(think())) {
        const stage = st.turn.stage;
        let res;
        if (stage === 'roll') res = B.apply(st, s, B.plan(st, s, rand));
        else if (stage === 'summon') res = R.summon(st, s, null);
        else if (stage === 'place') { R.unchoose(st, s); res = R.summon(st, s, null); }
        else res = R.endTurn(st, s);
        stepAt = now;
        if (seats[s]) toast(seats[s].id, '⏱️ Zeit abgelaufen');
        handle(res);
      }
    }
    // the phones' countdowns tick once a second
    let lastSecond = 0;
    function secondTick() {
      const n = Math.floor(nowMs() / ms(1000));
      if (n === lastSecond) return;
      lastSecond = n;
      if (phase === 'prep' || (st && !st.over && (think() || st.turn.pending))) broadcast();
    }

    // ---------- phone messages ----------
    function onMessage(id, d) {
      if (!d || typeof d.t !== 'string') return;
      const s = seatIdx(id);
      if (d.t === 'vlHello') { send(id, stateFor(id)); return; }
      if (d.t === 'vlAgain') { if (phase === 'over' && id === hostId()) beginPrep(); return; }
      if (s < 0) return;
      if (d.t === 'vlBag') { if (phase === 'prep') chooseBag(s, String(d.bag)); return; }
      if (phase !== 'play' || !st || st.over) return;
      if (d.t === 'vlDefend') {
        const p = st.turn.pending;
        if (p && p.seat === s) handle(R.respond(st, s, String(d.choice)));
        return;
      }
      if (st.turn.seat !== s) return;
      let res = null;
      switch (d.t) {
        case 'vlRoll': res = R.roll(st, s, Array.isArray(d.dice) ? d.dice.slice(0, 3) : []); break;
        case 'vlPick': res = R.summon(st, s, d.die === null || d.die === undefined ? null : d.die | 0); break;
        case 'vlBack': res = R.unchoose(st, s); preview = null; break;
        case 'vlPiece': setPreview(s, d); return;
        case 'vlPlace': res = R.place(st, s, d.shape | 0, d.ori | 0, d.x | 0, d.y | 0); break;
        case 'vlSel': sel = d.mon ? { mon: d.mon | 0, mode: d.mode || null, ab: d.ab || null } : null; return;
        case 'vlMove': res = R.move(st, s, d.mon | 0, d.to | 0); break;
        case 'vlAttack': res = R.attack(st, s, d.mon | 0, d.target && d.target.dm !== undefined ? { dm: d.target.dm | 0 } : { mon: d.target ? d.target.mon | 0 : 0 }); break;
        case 'vlAbility': res = R.useAbility(st, s, d.mon | 0, String(d.ab), d.target || {}); break;
        case 'vlEnd': res = R.endTurn(st, s); break;
        default: return;
      }
      if (res && !res.ok) { toast(id, '⚠️ ' + res.err); sfx('buzz'); send(id, stateFor(id)); return; }
      if (d.t === 'vlMove' || d.t === 'vlAttack' || d.t === 'vlAbility') sel = sel && R.monById(st, sel.mon) ? { mon: sel.mon, mode: null } : null;
      handle(res);
    }
    function setPreview(s, d) {
      if (st.turn.stage !== 'place') { preview = null; return; }
      const shape = d.shape | 0, ori = d.ori | 0, x = d.x | 0, y = d.y | 0, cells = R.pieceCells(st, shape, ori, x, y);
      if (!cells) return;
      const ok = R.canPlace(st, s, cells), key = st.seats[s].dice[st.turn.chosen].key;
      const k = shape + ':' + ori;
      const anchors = preview && preview.k === k ? preview.anchors : R.validAnchors(st, s, shape, ori);
      preview = { k, cells, ok: ok.ok, why: ok.why, anchor: [x, y], key, color: color(s), anchors };
    }

    return {
      acceptsJoin: false,
      start(ids, c) {
        cfg = Object.assign({}, c || {});
        buildSeats(ids);
        ensureView(); fit(); view.reset(null);
        try { sfx.ambient('drone'); } catch (e) {}
        beginPrep();
      },
      stop() {
        for (const [el, ev, fn] of listeners) el.removeEventListener(ev, fn);
        listeners = [];
        if (wrap) { try { wrap.remove(); } catch (e) {} }
        wrap = null; view = null; cv.style.display = '';
        try { sfx.ambient(null); } catch (e) {}
      },
      onMessage,
      canResume(id) { return seatIdx(id) >= 0 || spect.indexOf(id) >= 0; },
      onReconnect(id) {
        const s = seatIdx(id);
        if (s >= 0 && seats[s].offline) { seats[s].offline = false; addLog('🔌 ' + name(s) + ' ist zurück', s); }
        broadcast();
      },
      onDisconnect(id) {
        const k = spect.indexOf(id);
        if (k >= 0) { spect.splice(k, 1); return; }
        const s = seatIdx(id);
        if (s < 0) return;
        seats[s].offline = true;
        if (!seats.some((x) => !x.bot && !x.offline)) { endToLobby('Alle Spieler sind weg'); return; }
        addLog('💤 ' + name(s) + ' ist weg – ein Bot spielt weiter', s);
        if (phase === 'prep' && !prep.bags[s]) chooseBag(s, D.BAG_KEYS[Math.floor(rand() * 4)]);
        botAt = Math.max(botAt, nowMs() + ms(BOT_STEP));
        broadcast();
      },
      render() {
        if (!view) return;
        fit();
        tick();
        secondTick();
        focusCamera();
        if (window.VL_SKIPDRAW) return;            // dev harness: fast-forward without painting every step
        view.draw(model());
        blit();
      },
      _debug() { return { phase, st, seats, prep, preview, sel, log, spect }; }
    };
  } });
})();
