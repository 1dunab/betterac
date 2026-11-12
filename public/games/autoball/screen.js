// ===== Modul: AUTOBALL (3D) — TV glue =====
// Connects sim.js (rules), render.js (three.js) and the phones. Overview: docs/AUTOBALL.md.
// Before the kickoff the teams are picked on the phones (drawn on the shell canvas); the match itself
// runs on a Kit3D stage (3D canvas + HUD), like Micro Racer.

// ---- file scope: one view and one stage for all matches (no WebGL context leak) ----
let autoballStage = null, autoballViewCtor = null;

registerGame({ key: 'autoball', screen: function () {
  const W = 960, H = 600;
  const TEAMS = [{ name: 'Orange', color: '#ff8a1c', icon: '🟠' }, { name: 'Blau', color: '#2e8bff', icon: '🔵' }];
  const BOT_NAMES = ['Kolbe', 'Diesel', 'Zünd', 'Felge', 'Turbo', 'Hupe', 'Auspuff', 'Kupplung'];
  const BOT_ROOF = '#aab2bd';
  const SND_MS = 110, TANK_MS = 200, TOAST_MS = 2600;
  const FONT = (px, w) => (w || 'bold') + ' ' + px + 'px system-ui,sans-serif';

  let cfg = {}, Sim = null, sim = null, view = null, stage = null, hctx = null, started = false;
  let phase = 'teams';               // teams | match (then the sim's own phases count)
  let humans = [], teamOf = {};      // player ids in the order they came, and their team
  let botName = {}, inp = {}, sentTank = {};
  let lastT = 0, lastSnd = 0, lastTank = 0, botNo = 0, toasts = [], banner = null;

  const send = (id, m) => { try { ac.message(id, m); } catch (e) {} };
  const colorOf = (id) => (players[id] && players[id].color) || '#999';
  const count = (t) => humans.filter(id => teamOf[id] === t).length;
  const smaller = () => (count(1) < count(0) ? 1 : 0);
  const nameOfCar = (c) => c.bot ? '🤖 ' + (botName[c.id] || 'Bot') : shortName(c.id);
  const snd = (name, now) => { if (now - lastSnd > SND_MS) { lastSnd = now; sfx(name); } };
  function toast(text, color) { toasts.push({ text, color: color || '#fff', until: performance.now() + TOAST_MS }); if (toasts.length > 3) toasts.shift(); }

  function ensureStage() {
    const T = window.THREE, C = window.AutoballView, Kit = window.Kit3D;
    if (!T || !C || !Kit) return null;
    if (autoballStage && autoballViewCtor === C) return autoballStage;
    try { if (autoballStage) { autoballStage.remove(); autoballStage.view.dispose(); } } catch (e) {}
    autoballStage = null;
    try { autoballStage = new Kit.Stage(new C(T, { width: W, height: H }), cv, W, H); autoballViewCtor = C; } catch (e) { autoballStage = null; }
    return autoballStage;
  }

  // ---------- teams ----------
  // bots fill the smaller team up (and an empty one with at least one car)
  function botsNeeded() {
    if (cfg.bots === 'off') return [0, 0];
    const most = Math.max(count(0), count(1), 1);
    return [most - count(0), most - count(1)];
  }
  function canStart() { const need = botsNeeded(); return count(0) + need[0] > 0 && count(1) + need[1] > 0; }
  function teamsFor(id) {
    const need = botsNeeded();
    return { t: 'abTeams', team: teamOf[id], color: TEAMS[teamOf[id]].color, host: id === hostId(), canStart: canStart(),
      lists: [0, 1].map(t => humans.filter(h => teamOf[h] === t).map(shortName).concat(Array(need[t]).fill('🤖 Bot'))) };
  }
  const sendTeams = () => humans.forEach(id => send(id, teamsFor(id)));

  function startMatch() {
    const cars = humans.map(id => ({ id, team: teamOf[id] })), need = botsNeeded();
    botName = {}; botNo = 0;
    [0, 1].forEach(t => { for (let i = 0; i < need[t]; i++) { const id = -(++botNo); cars.push({ id, team: t, bot: true }); botName[id] = BOT_NAMES[(botNo - 1) % BOT_NAMES.length]; } });
    sim = Sim.create({ cars, seed: (Math.random() * 0xffffffff) >>> 0, minutes: cfg.minutes || 3, arena: cfg.arena });
    try { view.setRound(sim, { arena: cfg.arena, teams: TEAMS.map(t => t.color), roofOf: (c) => c.bot ? BOT_ROOF : colorOf(c.id) }); }
    catch (e) { sim = null; endToLobby('3D/WebGL wird von diesem Browser nicht unterstützt 😢'); return; }
    phase = 'match'; inp = {}; sentTank = {}; toasts = []; banner = null;
    lastT = performance.now();
    stage.show(true);
    sfx('whoosh');
    handle(sim.step(0));          // the first kickoff: tells the phones too
  }

  function backToTeams() {
    if (stage) stage.show(false);
    try { view.clear(); } catch (e) {}
    sim = null; phase = 'teams';
    sendTeams();
  }

  // ---------- phones ----------
  function stateFor(id, text) {
    const st = sim.state, t = teamOf[id];
    return { t: 'abState', phase: st.phase, team: t, color: TEAMS[t].color, roof: colorOf(id), score: st.score.slice(), golden: st.golden,
      won: st.phase === 'over' ? st.winner === t : undefined, host: id === hostId(), text: text || undefined };
  }
  const sendStates = (textFor) => humans.forEach(id => send(id, stateFor(id, textFor && textFor(id))));

  // everything a phone needs when it (re)appears
  function hello(id) {
    if (!humans.includes(id)) return;
    if (phase === 'teams') { send(id, teamsFor(id)); return; }
    send(id, stateFor(id));
    const c = sim.car(id);
    if (c) { sentTank[id] = c.tank; send(id, { t: 'abYou', tank: c.tank }); }
  }

  // the sim's events → phones, sound, effects
  function handle(events) {
    const st = sim.state, now = performance.now();
    for (const e of events) {
      if (e.t === 'kickoff') { banner = null; sendStates(); }
      else if (e.t === 'count') sfx('beep');
      else if (e.t === 'go') { sfx('go'); sendStates(); }
      else if (e.t === 'kick') snd(e.power > 24 ? 'thud' : 'hit', now);
      else if (e.t === 'bounce') { if (e.power > 12) snd('tick', now); }
      else if (e.t === 'bump') snd('hit', now);
      else if (e.t === 'pad') sfx('powerup');
      else if (e.t === 'clock') sfx('tick');
      else if (e.t === 'drop') { sfx('whoosh'); toast('🧑‍⚖️ Schiri-Ball!'); }
      else if (e.t === 'golden') { sfx('buzz'); toast('✨ Golden Goal — das nächste Tor gewinnt!', '#ffd60a'); sendStates(); }
      else if (e.t === 'goal') {
        sfx('explosion'); sfx('coin');
        const by = e.scorer !== null ? sim.car(e.scorer) : null, who = by ? nameOfCar(by) : null;
        banner = { team: e.team, big: e.own ? '🙈 EIGENTOR!' : '⚽ TOR!', small: who ? (e.own ? 'von ' + who : who + ' trifft für ' + TEAMS[e.team].name) : 'für ' + TEAMS[e.team].name };
        sendStates((id) => id === e.scorer ? (e.own ? '🙈 Das war ein Eigentor…' : '⚽ Dein Tor!') : (teamOf[id] === e.team ? '⚽ Tor für euch!' : '😬 Gegentor'));
      } else if (e.t === 'over') {
        sfx('fanfare');
        reportWinners(humans.filter(id => teamOf[id] === e.winner));
        sendStates();
      }
      try { view.event(e, st); } catch (err) { console.error('Autoball view: ' + (err.stack || err)); }
    }
  }

  // the boost tank on the phone, a few times a second
  function tickPhones(now) {
    if (now - lastTank < TANK_MS) return;
    lastTank = now;
    for (const id of humans) {
      const c = sim.car(id);
      if (c && Math.abs((sentTank[id] === undefined ? -1 : sentTank[id]) - c.tank) > 0.03) { sentTank[id] = c.tank; send(id, { t: 'abYou', tank: Math.round(c.tank * 100) / 100 }); }
    }
  }

  // ---------- pictures ----------
  function pill(c, x, y, w, h, fill) { c.fillStyle = fill; rr(c, x, y, w, h, Math.min(h / 2, 10)); c.fill(); }
  function shadowText(c, text, x, y, blur) { c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = blur || 6; c.fillText(text, x, y); c.shadowBlur = 0; }

  // team selection, on the shell canvas
  function drawTeams() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#17301f'); g.addColorStop(1, '#0c1712');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; ctx.font = FONT(56); ctx.fillText('⚽ Autoball', W / 2, 62);
    const arena = (Sim.ARENAS[cfg.arena] || Sim.ARENAS.stadion).label;
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = FONT(19, 'normal');
    ctx.fillText('Wählt eure Teams am Handy  ·  ' + (cfg.minutes || 3) + ' Minuten  ·  ' + arena, W / 2, 112);
    const need = botsNeeded();
    [0, 1].forEach(t => {
      const x = t === 0 ? 70 : 500, y = 150, w = 390, h = 340;
      pill(ctx, x, y, w, h, 'rgba(255,255,255,.07)');
      pill(ctx, x, y, w, 58, TEAMS[t].color);
      ctx.fillStyle = '#10141a'; ctx.font = FONT(28); ctx.fillText('Team ' + TEAMS[t].name, x + w / 2, y + 30);
      const rows = humans.filter(id => teamOf[id] === t).map(id => ({ text: shortName(id), dot: colorOf(id) }))
        .concat(Array(need[t]).fill({ text: '🤖 Bot', dot: null }));
      ctx.font = FONT(26);
      rows.slice(0, 7).forEach((r, i) => {
        const ry = y + 96 + i * 38;
        if (r.dot) { ctx.fillStyle = r.dot; ctx.beginPath(); ctx.arc(x + w / 2 - 110, ry, 9, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = r.dot ? '#fff' : 'rgba(255,255,255,.5)';
        ctx.fillText(r.text, x + w / 2, ry + 1);
      });
      if (!rows.length) { ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = FONT(20, 'normal'); ctx.fillText('noch niemand', x + w / 2, y + 110); }
    });
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = FONT(40); ctx.fillText('VS', W / 2 - 5, 320);
    ctx.font = FONT(22); ctx.fillStyle = canStart() ? '#ffd60a' : '#ff6b5e';
    ctx.fillText(canStart() ? '⭐ Der Host pfeift am Handy an' : 'Beide Teams brauchen mindestens ein Auto', W / 2, 540);
  }

  function drawHud(now) {
    const st = sim.state, c = hctx = stage.begin();
    c.textBaseline = 'middle';

    // name tags over the cars: team colour, with a dot in the colour of the roof
    c.font = FONT(12);
    if (view.toScreen) for (const car of st.cars) {
      const p = view.toScreen(car.x, 3.6, car.z);
      if (!p) continue;
      const label = nameOfCar(car), w = c.measureText(label).width + (car.bot ? 14 : 28);
      c.globalAlpha = car.bot ? 0.7 : 1;
      pill(c, p[0] - w / 2, p[1] - 9, w, 18, TEAMS[car.team].color);
      c.textAlign = 'left';
      if (!car.bot) { c.fillStyle = colorOf(car.id); c.strokeStyle = '#10141a'; c.lineWidth = 1.5; c.beginPath(); c.arc(p[0] - w / 2 + 11, p[1], 5, 0, Math.PI * 2); c.fill(); c.stroke(); }
      c.fillStyle = '#10141a'; c.fillText(label, p[0] - w / 2 + (car.bot ? 7 : 21), p[1] + 0.5);
      c.globalAlpha = 1;
    }

    // scoreboard
    c.textAlign = 'center';
    pill(c, W / 2 - 150, 10, 300, 48, 'rgba(10,14,20,.78)');
    [0, 1].forEach(t => {
      const x = W / 2 + (t === 0 ? -150 : 78);
      pill(c, x + 4, 14, 68, 40, TEAMS[t].color);
      c.fillStyle = '#10141a'; c.font = FONT(30); c.fillText(String(st.score[t]), x + 38, 35);
    });
    const left = Math.ceil(st.clock / 1000);
    c.fillStyle = st.golden ? '#ffd60a' : (left <= 10 ? '#ff6b5e' : '#fff');
    c.font = FONT(st.golden ? 15 : 26);
    c.fillText(st.golden ? 'GOLDEN GOAL' : Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'), W / 2, 35);

    toasts = toasts.filter(t => t.until > now);
    c.font = FONT(24);
    toasts.forEach((t, i) => { c.globalAlpha = clamp((t.until - now) / 400, 0, 1); c.fillStyle = t.color; shadowText(c, t.text, W / 2, 92 + i * 32, 8); });
    c.globalAlpha = 1;

    if (st.phase === 'kickoff') {
      const n = Math.min(3, Math.ceil((st.phaseAt - st.time) / 1000));
      c.fillStyle = '#fff'; c.font = FONT(120); shadowText(c, String(n), W / 2, H / 2 - 20, 16);
    } else if (st.phase === 'goal' && banner) {
      c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(0, H / 2 - 92, W, 150);
      c.fillStyle = TEAMS[banner.team].color; c.font = FONT(84); shadowText(c, banner.big, W / 2, H / 2 - 36, 14);
      c.fillStyle = '#fff'; c.font = FONT(26); c.fillText(banner.small, W / 2, H / 2 + 30);
    } else if (st.phase === 'over') {
      c.fillStyle = 'rgba(0,0,0,.66)'; c.fillRect(0, 0, W, H);
      const w = TEAMS[st.winner];
      c.fillStyle = w.color; c.font = FONT(56); c.fillText('🏆 Team ' + w.name + ' gewinnt!', W / 2, 130);
      c.fillStyle = '#fff'; c.font = FONT(72); c.fillText(st.score[0] + ' : ' + st.score[1], W / 2, 215);
      const rows = st.cars.filter(k => k.goals || k.ownGoals).sort((a, b) => b.goals - a.goals);
      c.font = FONT(24);
      rows.slice(0, 7).forEach((k, i) => {
        c.fillStyle = TEAMS[k.team].color;
        c.fillText(nameOfCar(k) + '  ' + '⚽'.repeat(Math.min(k.goals, 8)) + '🙈'.repeat(Math.min(k.ownGoals, 4)), W / 2, 290 + i * 36);
      });
      c.fillStyle = 'rgba(255,255,255,.6)'; c.font = FONT(17, 'normal');
      c.fillText('⭐ Host kann am Handy eine Revanche starten (mit neuer Teamwahl)', W / 2, H - 56);
    }

    c.textAlign = 'right'; c.font = FONT(13, 'normal'); c.fillStyle = 'rgba(255,255,255,.6)';
    c.fillText('Host kann am Handy abbrechen ✕', W - 12, H - 12);
  }

  return {
    acceptsJoin: true,
    start(ids, config) {
      Sim = window.AutoballSim; stage = ensureStage(); view = stage && stage.view;
      if (!view || !Sim) { view = null; endToLobby('3D/WebGL wird von diesem Browser nicht unterstützt 😢'); return; }
      cfg = config || {};
      humans = ids.slice(); teamOf = {};
      humans.forEach((id, i) => { teamOf[id] = i % 2; });
      phase = 'teams'; sim = null; started = true;
      sendTeams();
    },
    stop() {
      if (stage) stage.show(false);
      try { if (view && view.clear) view.clear(); } catch (e) {}
      sim = null; started = false;
    },
    // a latecomer: into the smaller team; in a running match they take a bot's car if there is one
    onConnect(id) {
      if (!started || humans.includes(id)) return;
      const t = smaller();
      humans.push(id); teamOf[id] = t;
      if (phase === 'teams') { sendTeams(); return; }
      const bot = sim.team(t).find(c => c.bot);
      if (bot) { delete botName[bot.id]; sim.toHuman(bot.id, id); if (view.forget) view.forget(bot); }
      else sim.add({ id, team: t });
      toast('👋 ' + shortName(id) + ' fährt für ' + TEAMS[t].name, TEAMS[t].color);
    },
    onDisconnect(id) {
      if (!started || !humans.includes(id)) return;
      humans = humans.filter(h => h !== id); delete teamOf[id]; delete inp[id];
      if (!humans.length) { endToLobby('Alle Fahrer sind weg.'); return; }
      if (phase === 'teams') { sendTeams(); return; }
      // a bot drives the car on
      const c = sim.car(id), nid = sim.toBot(id);
      if (nid !== null) { botName[nid] = BOT_NAMES[botNo++ % BOT_NAMES.length]; if (view.forget) view.forget(c); }
      if (sim.state.phase === 'over') sendStates();     // the host may have left: hand on the rematch button
    },
    canResume(id) { return started && humans.includes(id); },
    onReconnect(id) { hello(id); },
    onMessage(id, d) {
      if (!d || !started || !humans.includes(id)) return;
      if (d.t === 'abHello') hello(id);
      else if (phase === 'teams') {
        if (d.t === 'abTeam') { teamOf[id] = (d.team === 0 || d.team === 1) ? d.team : 1 - teamOf[id]; sfx('tick'); sendTeams(); }
        else if (d.t === 'abStart' && id === hostId() && canStart()) startMatch();
      } else if (d.t === 'abStick' || d.t === 'abBoost') {
        const i = inp[id] || (inp[id] = { x: 0, z: 0, b: false });
        if (d.t === 'abStick') { i.x = +d.x || 0; i.z = +d.y || 0; } else i.b = !!d.on;
        sim.input(id, i.x, i.z, i.b);
      } else if (d.t === 'abAgain' && id === hostId() && sim.state.phase === 'over') backToTeams();
    },
    render() {
      if (!started) return;
      if (phase === 'teams') { drawTeams(); return; }
      const now = performance.now(), raw = now - lastT, dt = Math.min(0.05, raw / 1000);
      lastT = now;
      handle(sim.step(dt));
      tickPhones(now);
      try { view.render(sim.state, dt); } catch (e) { if (!view.failed) { view.failed = true; console.error('Autoball view: ' + (e.stack || e)); } }
      drawHud(now);
      stage.frame(raw, ctx, now);
    },
    _debug() { return { phase, sim, state: sim && sim.state, humans, teamOf, botName }; }
  };
}});
