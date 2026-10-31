// ===== Werwolfnacht — TV glue: phases, timers, HUD, phone protocol (see docs/WERWOLF.md) =====
// The rules (rules.js), narrator (narrator.js) and the village scene (village.js) do the work;
// this file runs the game flow and talks to the phones. Everything is driven from render()
// with performance.now() deadlines — no intervals, no timeouts (nothing to clear in stop()).

(function () {
// ---- timing (ms, unscaled). Every value is multiplied by window.WW_TIME_SCALE (harness/tests) ----
const WW_ROLES_MIN = 4000;         // roles: earliest end even when everyone is ready
const WW_ROLES_MAX = 60000;        // roles: cut
const WW_NIGHT_INTRO_MIN = 3500;   // "Die Nacht senkt sich" — tasks go out after it
const WW_STEP_A_MIN = 12000;       // night step A: at least this long (+ random extra)
const WW_STEP_A_MAX = 35000;       //   … and at most this long
const WW_STEP_B_MIN = 9000;
const WW_STEP_B_MAX = 25000;
const WW_STEP_RAND = 5000;         // random 0..5 s added to every step minimum
const WW_DAWN_MIN = 2800;          // dawn line
const WW_LOVERS_MIN = 2500;
const WW_DEATH_MIN = 4000;         // one death announcement (card + line)
const WW_BARO_MIN = 3500;          // barometer card
const WW_QUIET_MIN = 2500;         // "Geister, bitte schweigen"
const WW_HUNTER_INTRO_MIN = 3000;
const WW_HUNTER_MAX = 20000;
const WW_VOTE_MAX = 75000;
const WW_RUNOFF_MAX = 45000;
const WW_VOTE_STEP = 450;          // gap between revealed arrows
const WW_VOTE_RESULT = 5200;       // result card
const WW_VERDICT_MIN = 3500;
const WW_HURRY_AT = 30000;         // talkHurry when this much of the talk is left
const WW_END_ROSTER = 14000;       // end: roster view …
const WW_END_PAGE = 9000;          //   … then chronicle pages of this length
const WW_TOAST = 4500;

registerGame({ key: 'werwolf', screen: function () {
  const TS = () => { const s = window.WW_TIME_SCALE; return s > 0 ? s : 1; };
  const ms = (x) => x * TS();
  const FONT = 'system-ui,"Segoe UI",Arial,sans-serif';
  const N = window.WerwolfNarrator, R = window.WerwolfRules, V = window.WerwolfVillage;
  const L = (k, v) => N.line(k, v);
  const nowMs = () => performance.now();

  const PHASE_SKY = { roles: 0.3, night: 0, dawn: 0.6, hunter: 0.7, day: 1, vote: 0.85, runoff: 0.8, verdict: 0.6 };
  const DEATH_KEY = { wolves: 'deathWolves', poison: 'deathPoison', grief: 'deathGrief', hunter: 'deathHunter', vote: 'deathVote' };
  const CAUSE_TXT = { wolves: 'von den Werwölfen gerissen', poison: 'vergiftet', grief: 'an gebrochenem Herzen gestorben', hunter: 'vom Jäger erschossen', vote: 'vom Dorf verbannt' };
  const CAUSE_SHORT = { wolves: 'Wölfe', poison: 'Gift', grief: 'Liebeskummer', hunter: 'Pfeil', vote: 'Dorf' };
  const WIN_TXT = { village: '🏆 Das Dorf gewinnt!', wolves: '🐺 Die Werwölfe gewinnen!', lovers: '💘 Das Liebespaar gewinnt!', nobody: '☠️ Niemand überlebt' };
  const WIN_KEY = { village: 'winVillage', wolves: 'winWolves', lovers: 'winLovers', nobody: 'winNobody' };

  const village = new V({ width: 960, height: 600 });

  // ---------- per-game state ----------
  let cfg = {}, started = false, reveal = true;
  let ids = [], info = {}, g = null, seed = 1;
  let ph = 'roles', sub = '', deadline = 0, lastBeepS = 0;
  let offline = {}, shownDead = {}, causeOf = {}, loverOf = {}, seenOf = {};
  let nightNo = 0, dayNo = 0, quietSaid = false, reported = false;
  // roles
  let roleReady = {}, rolesStart = 0, rolesMaxAt = 0, rolesMinAt = 0;
  // night
  let stepTasks = {}, acted = {}, cur = {}, stepMinAt = 0, stepMaxAt = 0, tasksSent = false, nightRes = null;
  let ghostDirty = false, ghostAt = 0;
  // day / vote
  let talkReady = {}, hurried = false, ballots = {}, cands = null, revVotes = {};
  // hunter
  let hunterId = null, hunterTarget, hunterDone = false, hunterMinAt = 0, hunterNext = 'day';
  // end
  let over = null, endAt = 0, endPages = null, endForce = null;  // endForce: debug only (_endView)
  // presentation
  let sky = 0.3, lastT = 0, lastHost = null, ambNow = '', banner2 = '';
  let subT = null, card = null, toastT = null, highlight = [];
  let seqQ = null, seqAt = 0, seqThen = null;

  // ---------- helpers ----------
  const P = (id) => { const i = info[id] || { id, name: String(id), color: '#999' }; return { id: i.id, name: i.name, color: i.color }; };
  const nm = (id) => (info[id] ? info[id].name : String(id));
  const idOf = (x) => ids.find((i) => String(i) === String(x));
  const living = () => ids.filter((i) => g.state.alive[i]);
  const isAlive = (i) => !!(g && g.state.alive[i]);
  const roleOf = (i) => g.state.roles[i];
  const send = (id, d) => { try { ac.message(id, d); } catch (e) {} };
  const secsLeft = () => (deadline ? Math.max(1, Math.ceil((deadline - nowMs()) / 1000)) : 0);
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

  function setSub(text, dur) {
    const t = nowMs();
    subT = { text, at: t, until: t + Math.max(dur, ms(1500)) + ms(1200) };
  }
  // narrator line on the TV + speech; returns how long the phase should wait (scaled)
  function announce(text, minMs) {
    const d = Math.max(N.say(text) * TS(), ms(minMs || 0));
    setSub(text, d);
    return d;
  }
  function toast(text) { toastT = { text, until: nowMs() + ms(WW_TOAST) + 1500 }; }

  // sequences: a list of functions, each starts something and returns how long to wait before the next
  function seq(list, then) { seqQ = list.slice(); seqThen = then || null; seqAt = nowMs(); }
  function seqTick(t) {
    if (!seqQ) return false;
    if (t < seqAt) return true;
    if (seqQ.length) { const w = seqQ.shift()(); seqAt = t + (w || 0); return true; }
    const th = seqThen; seqQ = null; seqThen = null;
    if (th) th();
    return true;
  }

  // ---------- phone messages ----------
  function hostFlag(id) { return id === hostId(); }
  function phaseMsg(id) {
    const timed = ph === 'day' || ph === 'vote' || ph === 'runoff' || ph === 'hunter';
    return { t: 'wwPhase', phase: ph, night: nightNo, day: dayNo, secs: timed ? secsLeft() : 0, alive: !shownDead[id], host: hostFlag(id) };
  }
  function roster(forEnd) {
    const win = over ? over.winners : [];
    return ids.map((i) => {
      const e = Object.assign(P(i), { role: roleOf(i), alive: forEnd ? isAlive(i) : !shownDead[i] });
      if (forEnd) e.won = win.indexOf(i) >= 0;
      return e;
    });
  }
  function sendGhost(id) { send(id, { t: 'wwGhost', roster: roster(false), night: g.ghostLines() }); }
  function sendGhosts() { ids.forEach((i) => { if (shownDead[i]) sendGhost(i); }); }
  function sendPhaseAll() { ids.forEach((i) => send(i, phaseMsg(i))); }
  function sendEnd(id) {
    send(id, { t: 'wwEnd', winner: over.winner, won: over.winners.indexOf(id) >= 0, roster: roster(true), host: hostFlag(id) });
  }
  function sendRole(id) {
    const d = { t: 'wwRole', role: roleOf(id), host: hostFlag(id) };
    if (roleOf(id) === 'wolf') d.pack = ids.filter((i) => roleOf(i) === 'wolf').map(P);
    send(id, d);
  }
  function taskMsg(id) {
    const t = stepTasks[id];
    const m = { t: 'wwTask', step: t.step, kind: t.kind, options: t.options.map(P), pick: t.pick };
    if (t.kind === 'witch') { m.victim = t.victim == null ? null : P(t.victim); m.canHeal = !!t.canHeal; m.canPoison = !!t.canPoison; }
    if (acted[id] && (t.kind === 'seer' || t.kind === 'cupid')) m.locked = true;
    m.current = cur[id] === undefined ? null : cur[id];
    return m;
  }
  function sendTasks() { Object.keys(stepTasks).forEach((k) => { const id = idOf(k); if (id !== undefined) send(id, taskMsg(id)); }); }
  function sendPack() {
    const picks = g.packPicks();
    ids.forEach((i) => { if (isAlive(i) && roleOf(i) === 'wolf') send(i, { t: 'wwPack', picks }); });
  }
  function ballotMsg(id) {
    const m = { t: 'wwBallot', options: (cands || living()).map(P), runoff: !!cands, secs: secsLeft() };
    if (id in ballots) m.current = ballots[id];
    return m;
  }

  function setPhase(p, s, dl) {
    ph = p; sub = s || ''; deadline = dl || 0; lastBeepS = 0;
    const amb = p === 'night' ? 'wind' : '';
    if (amb !== ambNow) { ambNow = amb; try { sfx.ambient(amb || null); } catch (e) {} }
    if (p !== 'end') sendPhaseAll();
    sendGhosts();
  }

  // ---------- game start ----------
  function begin(list) {
    ids = list.slice();
    info = {};
    ids.forEach((id) => { const p = players[id]; info[id] = { id, name: p && p.name ? p.name : 'Spieler ' + id, color: p && p.color ? p.color : '#999999' }; });
    const on = (k) => cfg[k] !== 'off';
    const opts = { wolves: cfg.wolves === 'auto' || cfg.wolves == null ? 'auto' : +cfg.wolves, seer: on('seer'), witch: on('witch'), hunter: on('hunter'), guard: on('guard'), cupid: on('cupid') };
    seed = Math.floor(Math.random() * 0x7fffffff) + 1;
    const names = {}; ids.forEach((i) => { names[i] = info[i].name; });
    g = R.create({ players: ids, roles: R.deal(ids, opts, seed), seed, names });
    reveal = cfg.reveal !== 'off';
    N.setVoice(cfg.voice !== 'off');
    village.setPlayers(ids.map((i) => info[i]));
    offline = {}; shownDead = {}; causeOf = {}; loverOf = {}; seenOf = {};
    nightNo = 0; dayNo = 0; quietSaid = false; reported = false;
    roleReady = {}; stepTasks = {}; acted = {}; cur = {}; tasksSent = false; nightRes = null;
    talkReady = {}; ballots = {}; cands = null; revVotes = {}; hunterId = null; over = null; endPages = null;
    subT = null; card = null; toastT = null; highlight = []; seqQ = null; seqThen = null; ambNow = '';
    started = true;
    lastHost = hostId();
    sky = PHASE_SKY.roles; lastT = nowMs();
    enterRoles();
  }

  function enterRoles() {
    ids.forEach(sendRole);
    setPhase('roles');
    const t = nowMs();
    rolesStart = t; rolesMinAt = t + ms(WW_ROLES_MIN); rolesMaxAt = t + ms(WW_ROLES_MAX);
    const a = L('intro'), b = L('roles');
    seq([() => announce(a, 2000), () => announce(b, 2000)], null);
  }

  // ---------- night ----------
  function enterNight() {
    nightNo = g.state.night + 1;
    stepTasks = {}; acted = {}; cur = {}; tasksSent = false; nightRes = null; highlight = []; revVotes = {}; card = null;
    setPhase('night', 'intro');
    sfx('whoosh');
    seq([() => announce(L('nightFalls', { n: nightNo }), WW_NIGHT_INTRO_MIN)], startStepA);
  }
  function stepTimes(min, max) {
    const t = nowMs();
    stepMinAt = t + ms(min) + Math.random() * ms(WW_STEP_RAND);
    stepMaxAt = t + ms(max);
  }
  function startStepA() {
    stepTasks = g.beginNight() || {};
    acted = {}; cur = {}; sub = 'A'; tasksSent = true;
    stepTimes(WW_STEP_A_MIN, WW_STEP_A_MAX);
    sendTasks();
    sendPack();       // wolves: empty pick board (only they receive it)
    ghostDirty = true;
  }
  function stepComplete() {
    return Object.keys(stepTasks).every((k) => { const id = idOf(k); return acted[id] || offline[id]; });
  }
  function startStepB() {
    stepTasks = g.beginStepB() || {};
    acted = {}; cur = {}; sub = 'B';
    stepTimes(WW_STEP_B_MIN, WW_STEP_B_MAX);
    sendTasks();
    setSub(L('nightDeep'), ms(WW_STEP_B_MIN));
    ghostDirty = true;
  }
  function endNight() {
    nightRes = g.endNight();
    tasksSent = false; stepTasks = {};
    dayNo = g.state.day;
    enterDawn(nightRes);
  }

  // ---------- dawn / deaths ----------
  function announceDeath(d) {
    const id = d.id, role = roleOf(id);
    shownDead[id] = true; causeOf[id] = d.cause;
    const text = L(DEATH_KEY[d.cause] || 'deathWolves', { name: nm(id), role: reveal ? role : undefined });
    const t = nowMs();
    const wait = announce(text, WW_DEATH_MIN);
    card = { kind: 'death', id, role: reveal ? role : null, cause: d.cause, at: t, until: t + wait };
    highlight = [id];
    if (d.cause === 'vote') sfx('thud');
    sfx('sad');
    send(id, { t: 'wwDead', cause: d.cause });
    sendGhosts();
    return wait;
  }
  function deathItems(deaths) {
    const items = deaths.map((d) => () => announceDeath(d));
    if (deaths.length && !quietSaid) {
      quietSaid = true;
      items.push(() => { card = null; highlight = []; return announce(L('ghostsQuiet'), WW_QUIET_MIN); });
    }
    return items;
  }
  function enterDawn(res) {
    setPhase('dawn');
    const items = [() => announce(L('dawn', { n: dayNo }), WW_DAWN_MIN)];
    if (res.lovers) {
      items.push(() => {
        res.lovers.forEach((a, i) => { const b = res.lovers[1 - i]; loverOf[a] = b; send(a, { t: 'wwLover', partner: P(b) }); });
        return announce(L('loversBound'), WW_LOVERS_MIN);
      });
    }
    if (res.deaths.length) deathItems(res.deaths).forEach((f) => items.push(f));
    else items.push(() => { sfx('pop'); return announce(L('noDeath'), WW_DEATH_MIN); });
    items.push(() => { card = null; highlight = []; return 0; });
    const baro = (key, id, icon, label) => {
      if (id == null || !isAlive(id)) return;
      items.push(() => {
        const t = nowMs(), wait = announce(L(key, { name: nm(id) }), WW_BARO_MIN);
        card = { kind: 'baro', id, icon, label, at: t, until: t + wait };
        highlight = [id];
        return wait;
      });
    };
    if (res.hunter || !g.checkWin()) { baro('suspicion', res.suspect, '👀', 'Das Dorf beäugt:'); baro('trust', res.trust, '🤝', 'Vertrauen genießt:'); }
    items.push(() => { card = null; highlight = []; return 0; });
    seq(items, () => (res.hunter ? enterHunter(res.hunter, 'day') : afterResolution('day')));
  }

  function afterResolution(next) {
    card = null; highlight = [];
    const w = g.checkWin();
    if (w) { endGame(w); return; }
    if (next === 'day') enterDay(); else enterNight();
  }

  // ---------- hunter ----------
  function enterHunter(hid, next) {
    hunterId = hid; hunterTarget = undefined; hunterDone = false; hunterNext = next;
    const t = nowMs();
    setPhase('hunter', '', t + ms(WW_HUNTER_MAX));
    hunterMinAt = t + announce(L('hunterRises', { name: nm(hid) }), WW_HUNTER_INTRO_MIN);
    highlight = [hid];
    send(hid, { t: 'wwShootTask', options: living().map(P), secs: secsLeft() });
  }
  function resolveHunter() {
    const hid = hunterId, tg = hunterTarget === undefined ? null : hunterTarget;
    deadline = 0; sub = 'shot'; hunterId = null;
    const r = g.shoot(hid, tg);
    const items = [];
    if (tg == null || !r.ok) items.push(() => announce(L('hunterMiss', { name: nm(hid) }), 2500));
    else deathItems(r.deaths).forEach((f) => items.push(f));
    seq(items, () => afterResolution(hunterNext));
  }

  // ---------- day ----------
  function enterDay() {
    talkReady = {}; hurried = false; revVotes = {}; ballots = {}; cands = null;
    setPhase('day', 'talk', nowMs() + ms((cfg.talk || 180) * 1000));
    announce(L('dayTalk', { n: dayNo }), 2500);
    sfx('pop');
  }
  function talkNeeded() { return Math.ceil(living().filter((i) => !offline[i]).length * 2 / 3 - 1e-9); }
  function talkCount() { return living().filter((i) => talkReady[i]).length; }

  // ---------- vote / runoff ----------
  function enterVote(c) {
    cands = c || null; ballots = {}; revVotes = {};
    setPhase(c ? 'runoff' : 'vote', 'collect', nowMs() + ms(c ? WW_RUNOFF_MAX : WW_VOTE_MAX));
    announce(c ? L('runoff') : L('voteOpen'), 2500);
    living().forEach((i) => send(i, ballotMsg(i)));
  }
  function voteComplete() { return living().every((i) => (i in ballots) || offline[i]); }
  function resolveVote() {
    const runoff = !!cands;
    deadline = 0; sub = 'reveal';
    const r = g.vote(ballots, cands || undefined);
    const arrows = [];
    ids.forEach((v) => { if (isAlive(v) && ballots[v] != null && isAlive(ballots[v]) && (!cands || cands.indexOf(ballots[v]) >= 0)) arrows.push([v, ballots[v]]); });
    const items = [() => { setSub('🗳️ Die Stimmen werden gezählt …', ms(1500)); return ms(900); }];
    arrows.forEach(([v, tg]) => items.push(() => { revVotes[v] = tg; sfx('tick'); return ms(WW_VOTE_STEP); }));
    items.push(() => {
      const t = nowMs();
      card = { kind: 'vote', r, runoff, at: t, until: t + ms(WW_VOTE_RESULT) };
      highlight = r.result === 'execute' ? [r.target] : r.result === 'tie' ? r.tied.slice() : [];
      sfx(r.result === 'execute' ? 'buzz' : 'pop');
      return ms(WW_VOTE_RESULT);
    });
    seq(items, () => {
      card = null; highlight = [];
      if (r.result === 'execute') enterVerdict(r.target);
      else if (r.result === 'tie' && !runoff) enterVote(r.tied.slice());
      else enterVerdict(null);
    });
  }

  function enterVerdict(target) {
    setPhase('verdict');
    if (target == null) { seq([() => announce(L('noExecution'), WW_VERDICT_MIN)], () => afterResolution('night')); return; }
    const r = g.execute(target);
    const items = deathItems(r.deaths || []);
    seq(items, () => (r.hunter ? enterHunter(r.hunter, 'night') : afterResolution('night')));
  }

  // ---------- end ----------
  function endGame(res) {
    over = res; endAt = nowMs(); endPages = null;
    setPhase('end');
    subT = null;
    announce(L(WIN_KEY[res.winner] || 'winNobody'), 4000);
    sfx('fanfare');
    if (!reported) { reported = true; reportWinners(res.winners.filter((i) => players[i])); }
    ids.forEach(sendEnd);
  }
  function restart() {
    const list = Object.keys(players).map(Number).filter((i) => players[i] && players[i].named).sort((a, b) => a - b);
    if (list.length < 5) { endToLobby('🐺 Zu wenige Spieler für eine neue Runde (mindestens 5)'); return; }
    list.forEach((i) => { if (!info[i]) send(i, { t: 'shell', cmd: 'enterGame', game: 'werwolf', host: i === hostId() }); });
    N.stop();
    begin(list);
  }

  // ---------- per-frame logic ----------
  function tickPhase(t) {
    if (ph === 'roles') {
      const everyone = ids.every((i) => roleReady[i] || offline[i]);
      if ((everyone && t >= rolesMinAt) || t >= rolesMaxAt) {
        if (everyone) setSub(L('everyoneReady'), 0);
        enterNight();
      }
    } else if (ph === 'night') {
      if (!tasksSent) return;
      if (sub === 'A' && ((stepComplete() && t >= stepMinAt) || t >= stepMaxAt)) startStepB();
      else if (sub === 'B' && ((stepComplete() && t >= stepMinAt) || t >= stepMaxAt)) endNight();
    } else if (ph === 'hunter') {
      if (sub === 'shot') return;
      if ((hunterDone || offline[hunterId]) && t >= hunterMinAt) resolveHunter();
      else if (t >= deadline) resolveHunter();
    } else if (ph === 'day') {
      const skip = sub === 'skip';
      if (skip || t >= deadline || (talkNeeded() > 0 && talkCount() >= talkNeeded())) { deadline = 0; enterVote(null); return; }
      if (!hurried && deadline - t <= ms(WW_HURRY_AT)) { hurried = true; announce(L('talkHurry'), 1500); }
    } else if ((ph === 'vote' || ph === 'runoff') && sub === 'collect') {
      if (voteComplete() || t >= deadline) resolveVote();
    }
    // last 5 seconds of a public countdown
    if (deadline && (ph === 'day' || ph === 'vote' || ph === 'runoff' || ph === 'hunter')) {
      const s = Math.ceil((deadline - t) / TS() / 1000);
      if (s >= 1 && s <= 5 && s !== lastBeepS) { lastBeepS = s; sfx('beep'); }
    }
  }

  function update(t, dt) {
    const h = hostId();
    if (h !== lastHost) { lastHost = h; resendHost(); }
    if (ghostDirty && t - ghostAt >= 500) { ghostDirty = false; ghostAt = t; sendGhosts(); }
    if (!seqTick(t)) tickPhase(t);
    // sky eases toward the phase target
    let target = PHASE_SKY[ph];
    if (ph === 'end' && over) target = { village: 1, wolves: 0.05, lovers: 0.6, nobody: 0.2 }[over.winner];
    if (target == null) target = sky;
    const rate = 0.8 / clampN(TS(), 0.1, 1);
    sky += (target - sky) * (1 - Math.exp(-dt * rate));
  }
  function resendHost() {
    if (ph === 'end' && over) ids.forEach(sendEnd); else sendPhaseAll();
  }

  // ---------- drawing ----------
  function wrap(c, text, maxW, maxLines) {
    const words = String(text).split(' '), lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (line && c.measureText(test).width > maxW) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    if (maxLines && lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
    return lines;
  }
  const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };
  const easeBack = (x) => { x = clampN(x, 0, 1); const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

  function title() {
    if (ph === 'roles') return '🎴 Rollen verteilt — ' + ids.filter((i) => roleReady[i]).length + '/' + ids.length + ' bereit';
    if (ph === 'night') return '🌙 Nacht ' + nightNo;
    if (ph === 'dawn') return '🌅 Der Morgen graut';
    if (ph === 'hunter') return '🏹 Der Jäger schießt';
    if (ph === 'day') return '☀️ Tag ' + dayNo + ' — Diskussion' + (talkNeeded() > 0 ? '   ✓ ' + talkCount() + '/' + living().length : '');
    if (ph === 'vote') return sub === 'reveal' ? '🗳️ Abstimmung — Ergebnis' : '🗳️ Abstimmung';
    if (ph === 'runoff') return sub === 'reveal' ? '⚖️ Stichwahl — Ergebnis' : '⚖️ Stichwahl';
    if (ph === 'verdict') return '⚖️ Das Urteil';
    if (ph === 'end') return endView(nowMs()) === 'chronik' ? '📜 Chronik ' + (endPage + 1) + '/' + (endPages ? endPages.length : 1) : '🏁 Spielende';
    return '';
  }
  function countdown(t) {
    if (!deadline || sub === 'reveal' || sub === 'shot') return null;
    if (ph !== 'day' && ph !== 'vote' && ph !== 'runoff' && ph !== 'hunter') return null;
    return Math.max(0, (deadline - t) / TS() / 1000);
  }

  function drawBanner(c, t) {
    const txt = title();
    if (!txt) return;
    c.save();
    c.font = 'bold 24px ' + FONT;
    const w = Math.max(260, c.measureText(txt).width + 56), x = 480 - w / 2;
    rr(c, x, 10, w, 42, 21); c.fillStyle = 'rgba(8,10,26,0.8)'; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = 'rgba(170,180,240,0.4)'; c.stroke();
    c.fillStyle = '#eef0ff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(txt, 480, 32);
    const cd = countdown(t);
    if (cd != null) {
      const cx = x + w + 10;
      rr(c, cx, 10, 96, 42, 21); c.fillStyle = cd <= 10 ? 'rgba(120,20,30,0.88)' : 'rgba(8,10,26,0.8)'; c.fill();
      c.stroke();
      c.font = 'bold 28px ' + FONT; c.fillStyle = cd <= 10 ? '#ffd0d0' : '#eef0ff';
      c.fillText(mmss(cd), cx + 48, 32);
    }
    c.restore();
  }

  function drawSub(c, t) {
    if (!subT || t > subT.until) return;
    const a = clampN((subT.until - t) / 600, 0, 1) * clampN((t - subT.at) / 180, 0, 1);
    c.save();
    c.globalAlpha = a;
    c.font = '20px ' + FONT;
    const lines = wrap(c, subT.text, 770, 2), h = 18 + lines.length * 26, y = 60;   // top: the bottom is full of house name signs
    rr(c, 480 - 400, y, 800, h, 14); c.fillStyle = 'rgba(6,8,22,0.82)'; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = 'rgba(170,180,240,0.35)'; c.stroke();
    c.fillStyle = '#f2f3ff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    lines.forEach((l, i) => c.fillText(l, 480, y + 22 + i * 26));
    c.restore();
  }

  function drawToast(c, t) {
    if (!toastT || t > toastT.until) return;
    const a = clampN((toastT.until - t) / 500, 0, 1);
    c.save(); c.globalAlpha = a; c.font = 'bold 19px ' + FONT;
    const w = c.measureText(toastT.text).width + 40;
    rr(c, 14, 558, w, 34, 17); c.fillStyle = 'rgba(30,32,70,0.9)'; c.fill();
    c.fillStyle = '#e6e8ff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(toastT.text, 14 + w / 2, 576);
    c.restore();
  }

  function cardFrame(c, w, h, accent, e, a) {
    const cx = 480, cy = 300;
    c.globalAlpha = a;
    c.translate(cx, cy); c.scale(e, e); c.translate(-cx, -cy);
    rr(c, cx - w / 2, cy - h / 2, w, h, 20);
    c.fillStyle = 'rgba(12,10,28,0.93)'; c.fill();
    c.lineWidth = 3.5; c.strokeStyle = accent; c.stroke();
  }
  function drawCard(c, t) {
    if (!card || t > card.until) return;
    const e = easeBack((t - card.at) / 340), a = clampN((card.until - t) / 400, 0, 1) * clampN((t - card.at) / 120, 0, 1);
    c.save();
    c.textBaseline = 'middle';
    if (card.kind === 'death') {
      const w = 470, h = 176, x = 480 - w / 2, y = 300 - h / 2, col = (info[card.id] || {}).color || '#fff';
      cardFrame(c, w, h, col, e, a);
      c.beginPath(); c.arc(x + 88, 300, 60, 0, Math.PI * 2); c.fillStyle = 'rgba(40,36,70,0.95)'; c.fill();
      c.lineWidth = 3; c.strokeStyle = card.role ? V.roleColor(card.role) : '#8a8fb5'; c.stroke();
      if (card.role) V.roleArt(c, card.role, x + 88, 300, 88);
      else { c.fillStyle = '#c8cbe8'; c.font = 'bold 72px ' + FONT; c.textAlign = 'center'; c.fillText('?', x + 88, 304); }
      c.textAlign = 'left';
      c.fillStyle = col; c.beginPath(); c.arc(x + 178, y + 40, 9, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff'; fitFont(c, nm(card.id), 250, 34); c.fillText(nm(card.id), x + 196, y + 40);
      c.font = '19px ' + FONT; c.fillStyle = '#ffb4b4';
      wrap(c, '☠️ ' + (CAUSE_TXT[card.cause] || ''), 270, 2).forEach((l, i) => c.fillText(l, x + 168, y + 82 + i * 24));
      c.font = 'bold 26px ' + FONT;
      c.fillStyle = card.role ? V.roleColor(card.role) : '#a0a5cc';
      c.fillText(card.role ? V.roleName(card.role) : 'Rolle bleibt geheim', x + 168, y + 138);
    } else if (card.kind === 'baro') {
      const w = 470, h = 120, x = 480 - w / 2, col = (info[card.id] || {}).color || '#fff';
      cardFrame(c, w, h, col, e, a);
      c.textAlign = 'center'; c.fillStyle = '#c9cdf0'; c.font = 'bold 24px ' + FONT;
      c.fillText(card.icon + ' ' + card.label, 480, 300 - 26);
      c.fillStyle = '#fff'; fitFont(c, nm(card.id), 400, 40); c.fillText(nm(card.id), 480, 300 + 20);
    } else if (card.kind === 'vote') {
      const r = card.r, w = 640, h = 150;
      const col = r.result === 'execute' ? '#ff6b6b' : '#a9afdc';
      cardFrame(c, w, h, col, e, a);
      let head;
      if (r.result === 'execute') head = '⚖️ ' + nm(r.target) + ' wird verbannt';
      else if (r.result === 'tie') head = card.runoff ? '⚖️ Wieder Gleichstand — niemand geht' : '⚖️ Gleichstand: ' + r.tied.map(nm).join(' & ');
      else head = card.runoff ? '⚖️ Wieder keine Mehrheit — niemand geht' : '🤷 Niemand wird verbannt';
      c.textAlign = 'center'; c.fillStyle = '#fff'; fitFont(c, head, 600, 30); c.fillText(head, 480, 300 - 30);
      const parts = ids.filter((i) => r.counts[i]).sort((a, b) => r.counts[b] - r.counts[a]).map((i) => nm(i) + ' ' + r.counts[i]);
      if (r.nobody) parts.push('🤷 Niemand ' + r.nobody);
      c.fillStyle = '#c9cdf0'; c.font = '19px ' + FONT;
      wrap(c, parts.length ? parts.join('  ·  ') : 'Keine Stimmen', 600, 2).forEach((l, i) => c.fillText(l, 480, 300 + 14 + i * 26));
    }
    c.restore();
  }

  // ---- end screens ----
  const endCycle = () => ms(WW_END_ROSTER) + (endPages ? endPages.length : 1) * ms(WW_END_PAGE);
  let endPage = 0;
  function endView(t) {
    if (endForce) { endPage = 0; return endForce; }
    const pos = (t - endAt) % endCycle();
    if (pos < ms(WW_END_ROSTER)) return 'roster';
    endPage = Math.min((endPages ? endPages.length : 1) - 1, Math.floor((pos - ms(WW_END_ROSTER)) / ms(WW_END_PAGE)));
    return 'chronik';
  }
  function chronicleBlocks() {
    const nmList = (a) => a.map(nm).join(' & ');
    const blocks = [];
    let last = null;
    const block = (head, key) => { if (!last || last.key !== key) { last = { key, head, parts: [] }; blocks.push(last); } return last; };
    for (const e of g.chronicle) {
      if (e.type === 'night') {
        const b = block('🌙 Nacht ' + e.night, 'n' + e.night), p = b.parts;
        const groups = {};
        Object.keys(e.wolves).forEach((w) => { const tg = e.wolves[w]; if (tg != null) (groups[tg] = groups[tg] || []).push(nm(idOf(w))); });
        const gk = Object.keys(groups);
        if (gk.length) gk.forEach((tg) => p.push('🐺 ' + groups[tg].join(' & ') + ' → ' + nm(idOf(tg)))); else p.push('🐺 Rudel ohne Wahl');
        if (e.guard) p.push('🛡️ ' + nm(e.guard.by) + ' schützt ' + nm(e.guard.target));
        if (e.seer) p.push('🔮 ' + nm(e.seer.by) + ' prüft ' + nm(e.seer.target) + ' (' + V.roleName(e.seer.role) + ')');
        if (e.cupid) p.push('💘 ' + nm(e.cupid.targets[0]) + ' ♥ ' + nm(e.cupid.targets[1]));
        if (e.witch && e.witch.heal) p.push('🧪 ' + nm(e.witch.by) + ' heilt ' + nm(e.target));
        if (e.witch && e.witch.poison != null) p.push('🧪 ' + nm(e.witch.by) + ' vergiftet ' + nm(e.witch.poison));
        if (e.saved) p.push('✨ Opfer gerettet');
        if (e.deaths.length) e.deaths.forEach((d) => p.push('☠️ ' + nm(d.id) + ' stirbt (' + CAUSE_SHORT[d.cause] + ')')); else p.push('🌤️ niemand stirbt');
        last = null;
      } else if (e.type === 'vote') {
        const b = block('☀️ Tag ' + e.day, 'd' + e.day);
        const counts = Object.keys(e.counts).sort((a, c) => e.counts[c] - e.counts[a]).map((k) => nm(idOf(k)) + ' ' + e.counts[k]);
        if (e.nobody) counts.push('Niemand ' + e.nobody);
        b.parts.push((e.runoff ? '⚖️ Stichwahl: ' : '🗳️ Abstimmung: ') + (counts.join(', ') || 'keine Stimmen') + (e.result === 'tie' ? ' → Gleichstand' : e.result === 'none' ? ' → niemand' : ''));
      } else if (e.type === 'execute') {
        const b = block('☀️ Tag ' + e.day, 'd' + e.day);
        e.deaths.forEach((d, i) => b.parts.push(i === 0 ? '⚖️ ' + nm(d.id) + ' wird verbannt (' + V.roleName(roleOf(d.id)) + ')' : '☠️ ' + nm(d.id) + ' stirbt (' + CAUSE_SHORT[d.cause] + ')'));
      } else if (e.type === 'shoot') {
        const b = block('☀️ Tag ' + e.day, 'd' + e.day);
        if (e.target == null) b.parts.push('🏹 ' + nm(e.by) + ' schießt daneben');
        else e.deaths.forEach((d, i) => b.parts.push(i === 0 ? '🏹 ' + nm(e.by) + ' erschießt ' + nm(d.id) : '☠️ ' + nm(d.id) + ' stirbt (' + CAUSE_SHORT[d.cause] + ')'));
      }
    }
    return blocks;
  }
  function buildPages(c) {
    c.font = '18px ' + FONT;
    const pages = [[]], H = 440;
    let used = 0;
    chronicleBlocks().forEach((b) => {
      const lines = wrap(c, b.parts.join(' · '), 800, 0);
      const h = 30 + lines.length * 25 + 14;
      if (used + h > H && pages[pages.length - 1].length) { pages.push([]); used = 0; }
      pages[pages.length - 1].push({ head: b.head, lines });
      used += h;
    });
    return pages;
  }
  function drawEnd(c, t) {
    const view = endView(t);
    c.save();
    c.fillStyle = view === 'chronik' ? 'rgba(4,6,20,0.92)' : 'rgba(4,6,20,0.74)'; c.fillRect(0, 0, 960, 600);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (view === 'roster') {
      c.fillStyle = '#ffd23f'; c.font = 'bold 36px ' + FONT;
      c.fillText(WIN_TXT[over.winner] || '🏁 Spiel vorbei', 480, 84);
      const lov = g.state.lovers;
      const list = ids.map((i) => ({ id: i, name: nm(i), color: info[i].color, role: roleOf(i), alive: isAlive(i), winner: over.winners.indexOf(i) >= 0, lover: lov && lov.indexOf(i) >= 0 ? lov[1 - lov.indexOf(i)] : null }));
      village.drawRoster(c, { x: 30, y: 116, w: 900, h: 428 }, list, t);
      c.fillStyle = '#9aa0cc'; c.font = '18px ' + FONT;
      if (hostId() != null) c.fillText('Der Host kann am Handy ein neues Spiel starten 🔁', 480, 566);
    } else {
      if (!endPages) endPages = buildPages(c);
      const page = endPages[Math.min(endPage, endPages.length - 1)] || [];
      let y = 84;
      c.textAlign = 'left';
      page.forEach((b) => {
        c.fillStyle = '#aeb6ff'; c.font = 'bold 21px ' + FONT; c.fillText(b.head, 70, y + 12);
        c.fillStyle = '#e6e8fa'; c.font = '18px ' + FONT;
        b.lines.forEach((l, i) => c.fillText(l, 90, y + 40 + i * 25));
        y += 30 + b.lines.length * 25 + 14;
      });
    }
    c.restore();
  }

  function sceneNow() {
    const alive = {}, revealed = {}, ready = {}, off = {};
    ids.forEach((i) => {
      alive[i] = !shownDead[i];
      if (offline[i]) off[i] = true;
      if (ph === 'end' || (shownDead[i] && reveal)) revealed[i] = roleOf(i);
    });
    if (ph === 'roles') ids.forEach((i) => { if (roleReady[i]) ready[i] = true; });
    if (ph === 'day') ids.forEach((i) => { if (talkReady[i] && isAlive(i)) ready[i] = true; });
    if (ph === 'end') { ids.forEach((i) => { alive[i] = isAlive(i); }); }
    return { sky, alive, revealed, offline: off, highlight, votes: revVotes, ready, mood: ph === 'vote' || ph === 'runoff' || ph === 'verdict' ? 'tense' : 'calm' };
  }

  function draw(t) {
    village.draw(ctx, sceneNow(), t);
    if (ph === 'end' && over) { drawEnd(ctx, t); drawBanner(ctx, t); return; }
    drawCard(ctx, t);
    drawBanner(ctx, t);
    drawSub(ctx, t);
    drawToast(ctx, t);
  }

  // ---------- messages from the phones ----------
  function onAct(id, d) {
    if (ph !== 'night' || !tasksSent || !isAlive(id)) return;
    const task = stepTasks[id];
    if (!task) return;
    let payload;
    if (task.kind === 'cupid') payload = { targets: d.targets };
    else if (task.kind === 'witch') payload = { heal: d.heal, poison: d.poison };
    else payload = { target: d.target };
    const r = g.act(id, payload);
    if (!r || !r.ok) return;
    acted[id] = true;
    if (task.kind === 'cupid') cur[id] = (d.targets || []).map(idOf);
    else if (task.kind === 'witch') cur[id] = { heal: !!d.heal && !!task.canHeal, poison: d.poison == null ? null : idOf(d.poison) };
    else cur[id] = idOf(d.target);
    if (task.kind === 'wolf') sendPack();
    if (task.kind === 'seer' && r.result) {
      const m = { t: 'wwSeen', target: P(r.result.target), role: r.result.role };
      seenOf[id] = { night: nightNo, msg: m };
      send(id, m);
    }
    ghostDirty = true;
  }

  function validVoteTarget(x) {
    if (x == null) return null;
    const i = idOf(x);
    if (i === undefined || !isAlive(i)) return undefined;
    if (cands && cands.indexOf(i) < 0) return undefined;
    return i;
  }

  function sendAllFor(id) {
    // wwRole first, wwPhase second, then whatever belongs to this phase
    sendRole(id);
    if (ph === 'end' && over) { sendEnd(id); return; }
    send(id, phaseMsg(id));
    if (loverOf[id] != null) send(id, { t: 'wwLover', partner: P(loverOf[id]) });
    if (shownDead[id]) { send(id, { t: 'wwDead', cause: causeOf[id] }); sendGhost(id); }
    if (ph === 'night' && tasksSent && isAlive(id)) {
      if (stepTasks[id]) send(id, taskMsg(id));
      if (roleOf(id) === 'wolf') send(id, { t: 'wwPack', picks: g.packPicks() });
    }
    if (seenOf[id] && seenOf[id].night === nightNo && (ph === 'night' || ph === 'dawn')) send(id, seenOf[id].msg);
    if (ph === 'hunter' && id === hunterId && !hunterDone && sub !== 'shot') send(id, { t: 'wwShootTask', options: living().map(P), secs: secsLeft() });
    if ((ph === 'vote' || ph === 'runoff') && sub === 'collect' && isAlive(id)) send(id, ballotMsg(id));
  }

  return {
    acceptsJoin: false,

    start(list, config) {
      cfg = config || {};
      begin(list);
    },
    stop() {
      started = false; seqQ = null; seqThen = null; deadline = 0;
      try { N.stop(); } catch (e) {}
      try { sfx.ambient(null); } catch (e) {}
    },

    canResume(id) { return started && !!info[id]; },
    onReconnect(id) {
      if (!started || !info[id]) return;
      if (offline[id]) { offline[id] = false; toast('🔌 ' + L('welcomeBack', { name: nm(id) })); }
      sendAllFor(id);
    },
    onDisconnect(id) {
      if (!started || !info[id]) return;
      offline[id] = true;
      toast('💤 ' + L('offline', { name: nm(id) }));
      if (ids.every((i) => offline[i])) { endToLobby('🐺 Alle haben das Dorf verlassen'); return; }
      const h = hostId();
      if (h !== lastHost) { lastHost = h; resendHost(); }
    },

    onMessage(id, d) {
      if (!started || !d || !info[id]) return;
      switch (d.t) {
        case 'wwReady': if (ph === 'roles') roleReady[id] = true; break;
        case 'wwAct': onAct(id, d); break;
        case 'wwShoot': {
          if (ph !== 'hunter' || id !== hunterId || hunterDone || sub === 'shot') break;
          const tg = idOf(d.target);
          if (tg === undefined || !isAlive(tg)) break;
          hunterTarget = tg; hunterDone = true;
          break;
        }
        case 'wwTalkReady': if (ph === 'day' && isAlive(id)) talkReady[id] = true; break;
        case 'wwSkip': if (ph === 'day' && id === hostId()) sub = 'skip'; break;
        case 'wwVote': {
          if ((ph !== 'vote' && ph !== 'runoff') || sub !== 'collect' || !isAlive(id)) break;
          const tg = validVoteTarget(d.target);
          if (tg !== undefined) ballots[id] = tg;
          break;
        }
        case 'wwAgain': if (ph === 'end' && id === hostId()) restart(); break;
      }
    },

    render() {
      const t = nowMs();
      if (!started) return;
      const dt = clampN((t - lastT) / 1000, 0, 0.1);
      lastT = t;
      update(t, dt);
      if (!started) return;
      draw(t);
    },

    _endView(v) { endForce = v || null; },
    _debug() {
      return {
        g, phase: ph, sub, roles: g ? g.state.roles : {}, offline, ids, info, over,
        timers: { deadline, stepMinAt, stepMaxAt, rolesMaxAt, seq: seqQ ? seqQ.length : 0 },
        consts: { ROLES_MIN: WW_ROLES_MIN, ROLES_MAX: WW_ROLES_MAX, STEP_A_MIN: WW_STEP_A_MIN, STEP_A_MAX: WW_STEP_A_MAX, STEP_B_MIN: WW_STEP_B_MIN, STEP_B_MAX: WW_STEP_B_MAX, STEP_RAND: WW_STEP_RAND, HUNTER_MAX: WW_HUNTER_MAX, VOTE_MAX: WW_VOTE_MAX, RUNOFF_MAX: WW_RUNOFF_MAX },
        scale: TS(), nightNo, dayNo, shownDead, talkReady, ballots, hunterId, cands
      };
    }
  };
}});
})();
