// ===== Modul: MICRO RACER (3D) — TV glue =====
// Connects sim.js (rules), render.js (three.js) and the phones. Overview: docs/RACER.md.
// The 3D picture has its own canvas (sharp on big screens) with a 2D HUD canvas on top. Both replace
// the shell canvas `cv` while a match runs and are copied into it a few times a second for Mitschauen.

// ---- file scope: one view and one pair of canvases for all matches (no WebGL context leak) ----
let racerView = null, racerViewCtor = null, racerWrap = null, racerHud = null, racerSlow = false;

registerGame({ key: 'racer', screen: function () {
  const W = 960, H = 600, HUD_SCALE = 2;
  const MIRROR_MS = 120, RANK_MS = 500, BUMP_SND_MS = 250, TOAST_MS = 2200;
  const SLOW_FRAME_MS = 30, SLOW_AFTER = 120;       // this many slow frames in a row → drop to 1× resolution
  const ICON = { rocket: '🚀', oil: '🛢️', shield: '🛡️', bolt: '⚡', magnet: '🧲' };
  const FONT = (px, w) => (w || 'bold') + ' ' + px + 'px system-ui,sans-serif';

  let Sim = null, sim = null, view = null, hctx = null, map = null, mini = null;
  let lastT = 0, lastMirror = 0, lastRanks = 0, lastBump = 0, slowFrames = 0, boltFlash = 0;
  let toasts = [], sentRank = {}, nitroPending = {};

  const send = (id, m) => { try { ac.message(id, m); } catch (e) {} };
  const colorOf = (id) => (players[id] && players[id].color) || '#999';

  // ---------- canvases ----------
  function ensureView() {
    const T = window.THREE, C = window.RacerView;
    if (!T || !C) return null;
    if (racerView && racerViewCtor === C) return racerView;
    try { if (racerView) racerView.dispose(); } catch (e) {}
    if (racerWrap) racerWrap.remove();
    racerView = null; racerWrap = null;
    try { racerView = new C(T, { width: W, height: H }); racerViewCtor = C; } catch (e) { racerView = null; return null; }
    racerWrap = document.createElement('div');
    racerWrap.style.cssText = 'position:relative; display:none; line-height:0; width:fit-content; margin:0 auto;';
    racerHud = document.createElement('canvas');
    racerHud.width = W * HUD_SCALE; racerHud.height = H * HUD_SCALE;
    // neutralise the page's global canvas rule, or the overlay would cover the 3D scene
    racerHud.style.cssText = 'position:absolute; left:0; top:0; width:100%; height:100%; pointer-events:none;'
      + 'background:transparent; border-radius:0; box-shadow:none; max-width:none; max-height:none;';
    racerWrap.append(racerView.canvas, racerHud);
    cv.insertAdjacentElement('afterend', racerWrap);
    return racerView;
  }
  function show(on) {
    if (!racerWrap) return;
    racerWrap.style.display = on ? 'block' : 'none';
    cv.style.display = on ? 'none' : '';
  }
  // render as many pixels as the screen really shows (up to 2×), unless this machine proved too slow
  function fitRatio() {
    if (!view || !view.setRatio) return;
    let shown = 0;
    try { shown = view.canvas.getBoundingClientRect().width; } catch (e) {}
    const want = (shown || W) * (window.devicePixelRatio || 1) / W;
    view.setRatio(racerSlow ? 1 : Math.round(clamp(want, 1, 2) * 4) / 4);
  }

  // ---------- phones ----------
  function stateFor() { const st = sim.state; return { t: 'raceState', phase: st.phase, heat: st.heat, items: map.items }; }
  function scoreFor(id) { const st = sim.state; return { t: 'raceScore', won: id === st.heatWinner, points: st.points[id] || 0, target: st.target }; }
  function finalFor(id) { const st = sim.state; return { t: 'raceFinal', winner: id === st.champion, name: nameOf(st.champion), host: id === hostId() }; }

  function toast(text, color) { toasts.push({ text, color: color || '#fff', until: performance.now() + TOAST_MS }); if (toasts.length > 3) toasts.shift(); }

  // the sim's events → phones, sound, effects
  function handle(events) {
    const st = sim.state;
    for (const e of events) {
      const id = e.id;
      if (e.t === 'heat') {
        sentRank = {}; nitroPending = {};
        st.order.forEach(o => { send(o, stateFor()); send(o, { t: 'raceYou', nitro: true, item: null, danger: false }); });
      } else if (e.t === 'count') sfx('beep');
      else if (e.t === 'go') { sfx('go'); st.order.forEach(o => send(o, stateFor())); }
      else if (e.t === 'danger') send(id, { t: 'raceYou', danger: true });
      else if (e.t === 'safe') send(id, { t: 'raceYou', danger: false });
      else if (e.t === 'out') {
        sfx('explosion');
        send(id, { t: 'raceYou', out: true, why: e.why });
        toast(e.why === 'lava' ? '🔥 ' + shortName(id) + ' badet in Lava!' : '💥 ' + shortName(id) + ' ist raus!', colorOf(id));
      } else if (e.t === 'heatEnd') { sfx('coin'); st.order.forEach(o => send(o, scoreFor(o))); }
      else if (e.t === 'final') {
        sfx('fanfare');
        reportWinners([e.champion]);
        st.order.forEach(o => send(o, finalFor(o)));
      } else if (e.t === 'pickup') { sfx('powerup'); send(id, { t: 'raceYou', item: e.item }); }
      else if (e.t === 'use') {
        sfx(e.item === 'oil' ? 'splash' : e.item === 'shield' ? 'pop' : e.item === 'bolt' ? 'explosion' : 'whoosh');
        send(id, { t: 'raceYou', item: null });
        if (e.item === 'bolt') { boltFlash = 1; toast('⚡ ' + shortName(id) + ' lässt es blitzen!', colorOf(id)); }
      } else if (e.t === 'spin') {
        sfx('hit');
        send(id, { t: 'raceYou', msg: '🚀 Getroffen von ' + shortName(e.by) + '!', buzz: true });
      } else if (e.t === 'nitro') { sfx('whoosh'); nitroPending[id] = true; send(id, { t: 'raceYou', nitro: false }); }
      else if (e.t === 'pad') sfx('whoosh');
      else if (e.t === 'land') sfx('thud');
      else if (e.t === 'slip') { sfx('splash'); send(id, { t: 'raceYou', buzz: true }); }
      else if (e.t === 'boom') sfx('hit');
      else if (e.t === 'block') sfx('pop');
      else if (e.t === 'bump') {
        const now = performance.now();
        if (now - lastBump > BUMP_SND_MS) { lastBump = now; sfx('hit'); }
      }
      try { view.event(e, st); } catch (err) { console.error('Micro Racer view: ' + (err.stack || err)); }
    }
  }

  // things the phones learn at a steady rate: place in the field, nitro ready again
  function tickPhones(now) {
    const st = sim.state;
    for (const id in nitroPending) {
      const r = st.racers[id];
      if (!r || !r.alive) { delete nitroPending[id]; continue; }
      if (st.time >= r.nitroReadyAt) { delete nitroPending[id]; send(+id, { t: 'raceYou', nitro: true }); }
    }
    if (st.phase !== 'race' || now - lastRanks < RANK_MS) return;
    lastRanks = now;
    const alive = sim.standings().filter(id => st.racers[id].alive);
    alive.forEach((id, i) => {
      const key = (i + 1) + '/' + alive.length;
      if (sentRank[id] !== key) { sentRank[id] = key; send(id, { t: 'raceYou', rank: i + 1, of: alive.length }); }
    });
  }

  // everything a phone needs after a reload
  function resync(id) {
    const st = sim.state, r = st.racers[id];
    send(id, stateFor());
    if (r) send(id, { t: 'raceYou', nitro: st.time >= r.nitroReadyAt, item: r.item, danger: r.offMs > 0, out: !r.alive || undefined });
    if (r && st.time < r.nitroReadyAt) nitroPending[id] = true;
    delete sentRank[id];
    if (st.phase === 'heatOver') send(id, scoreFor(id));
    else if (st.phase === 'final') send(id, finalFor(id));
  }

  // ---------- HUD (2D overlay) ----------
  function buildMinimap() {
    const S = sim.track.samples;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const s of S) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
    const bw = 148, bh = 96, k = Math.min(bw / (x1 - x0), bh / (z1 - z0));
    const ox = 16 + (bw - (x1 - x0) * k) / 2 + 8, oz = H - 16 - bh - 8 + (bh - (z1 - z0) * k) / 2;
    mini = { X: (x) => ox + (x - x0) * k, Z: (z) => oz + (z - z0) * k, box: [16, H - 16 - bh - 16, bw + 16, bh + 16] };
  }

  const toPx = (p) => [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H];
  function pill(x, y, w, h, fill) { hctx.fillStyle = fill; rr(hctx, x, y, w, h, Math.min(h / 2, 10)); hctx.fill(); }
  function shadowText(text, x, y, blur) {
    hctx.shadowColor = 'rgba(0,0,0,.6)'; hctx.shadowBlur = blur || 6;
    hctx.fillText(text, x, y);
    hctx.shadowBlur = 0;
  }

  function drawHud(now) {
    const st = sim.state, C = Sim.CONST, racing = st.phase === 'race';
    hctx.setTransform(HUD_SCALE, 0, 0, HUD_SCALE, 0, 0);
    hctx.clearRect(0, 0, W, H);
    hctx.textBaseline = 'middle';

    // lightning flash and the red warning frame
    boltFlash = Math.max(0, boltFlash - 0.05);
    if (boltFlash > 0) { hctx.fillStyle = 'rgba(255,255,220,' + (boltFlash * 0.45) + ')'; hctx.fillRect(0, 0, W, H); }
    const lost = racing ? st.order.filter(id => st.racers[id] && st.racers[id].alive && st.racers[id].offMs > 0) : [];
    if (lost.length) {
      hctx.strokeStyle = 'rgba(255,60,40,' + (0.3 + 0.2 * Math.sin(now / 90)) + ')';
      hctx.lineWidth = 18; hctx.strokeRect(0, 0, W, H);
    }

    // name tags over the cars; a car that left the picture gets a marker at the edge with its time running out
    hctx.textAlign = 'center';
    for (const id of st.order) {
      const r = st.racers[id];
      if (!r || !r.alive) continue;
      const label = shortName(id) + (r.item ? ' ' + ICON[r.item] : '');
      if (r.offMs > 0 && racing) {
        const x = clamp((r.sx + 1) / 2 * W, 34, W - 34), y = clamp((1 - r.sy) / 2 * H, 34, H - 34);
        hctx.fillStyle = 'rgba(0,0,0,.6)'; hctx.beginPath(); hctx.arc(x, y, 24, 0, Math.PI * 2); hctx.fill();
        hctx.strokeStyle = colorOf(id); hctx.lineWidth = 5;
        hctx.beginPath(); hctx.arc(x, y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - r.offMs / C.OFF_MS)); hctx.stroke();
        hctx.font = FONT(20); hctx.fillStyle = '#fff'; hctx.fillText('⚠️', x, y + 1);
        hctx.font = FONT(13); hctx.fillStyle = colorOf(id);
        shadowText(shortName(id), x, y < H / 2 ? y + 38 : y - 36, 4);
        continue;
      }
      const p = sim.project(r.x, r.y + 3.1, r.z);
      if (!p.ok) continue;
      const [x, y] = toPx(p);
      hctx.font = FONT(13);
      const w = hctx.measureText(label).width + 14;
      pill(x - w / 2, y - 10, w, 20, 'rgba(0,0,0,.5)');
      hctx.fillStyle = colorOf(id); hctx.fillText(label, x, y + 0.5);
    }

    // top left: where we are
    hctx.textAlign = 'left';
    hctx.font = FONT(22); hctx.fillStyle = '#fff';
    shadowText(map.label + '  ·  Heat ' + st.heat, 18, 26);
    if (st.tempo > 1.005 && racing) {
      hctx.font = FONT(15); hctx.fillStyle = '#ffb347';
      shadowText('🔥 Tempo +' + Math.round((st.tempo - 1) * 100) + ' %', 18, 52);
    }

    // top right: the field with points
    const rows = sim.standings();
    hctx.font = FONT(14);
    rows.forEach((id, i) => {
      const r = st.racers[id], y = 14 + i * 25;
      pill(W - 196, y, 182, 21, 'rgba(0,0,0,.42)');
      hctx.fillStyle = colorOf(id); hctx.beginPath(); hctx.arc(W - 183, y + 10.5, 5.5, 0, Math.PI * 2); hctx.fill();
      hctx.fillStyle = r.alive ? '#fff' : 'rgba(255,255,255,.45)';
      hctx.textAlign = 'left'; hctx.fillText((r.alive ? '' : '💥 ') + shortName(id) + (r.item ? ' ' + ICON[r.item] : ''), W - 172, y + 11);
      hctx.textAlign = 'right'; hctx.fillText((st.points[id] || 0) + ' / ' + st.target, W - 22, y + 11);
    });

    // bottom left: the track from above
    if (mini) {
      const S = sim.track.samples;
      pill(mini.box[0], mini.box[1], mini.box[2], mini.box[3], 'rgba(0,0,0,.38)');
      hctx.strokeStyle = 'rgba(255,255,255,.75)'; hctx.lineWidth = 3; hctx.lineJoin = 'round';
      hctx.beginPath();
      for (let i = 0; i < S.length; i += 5) { const x = mini.X(S[i].x), y = mini.Z(S[i].z); if (i) hctx.lineTo(x, y); else hctx.moveTo(x, y); }
      hctx.closePath(); hctx.stroke();
      for (const id of rows.slice().reverse()) {
        const r = st.racers[id];
        if (!r.alive) continue;
        hctx.fillStyle = colorOf(id); hctx.strokeStyle = '#000'; hctx.lineWidth = 1.2;
        hctx.beginPath(); hctx.arc(mini.X(r.x), mini.Z(r.z), 4.2, 0, Math.PI * 2); hctx.fill(); hctx.stroke();
      }
    }

    // who just went out, who used what
    toasts = toasts.filter(t => t.until > now);
    hctx.textAlign = 'center'; hctx.font = FONT(24);
    toasts.forEach((t, i) => {
      hctx.globalAlpha = clamp((t.until - now) / 400, 0, 1);
      hctx.fillStyle = t.color; shadowText(t.text, W / 2, 92 + i * 32, 8);
    });
    hctx.globalAlpha = 1;
    if (lost.length) {
      hctx.font = FONT(22); hctx.fillStyle = '#ff6b5e';
      shadowText('⚠️ ' + lost.map(shortName).join(', ') + ' — zurück ins Bild!', W / 2, H - 86, 8);
    }

    // start lights
    hctx.textAlign = 'center';
    if (st.phase === 'countdown' || (racing && st.time - st.raceAt < 1000)) {
      const left = st.phase === 'countdown' ? Math.min(3, Math.ceil((st.phaseAt - st.time) / 1000)) : 0;
      pill(W / 2 - 112, H / 2 - 150, 224, 76, 'rgba(0,0,0,.6)');
      for (let i = 0; i < 3; i++) {
        hctx.fillStyle = left === 0 ? '#30d158' : (3 - left >= i ? '#ff3b30' : '#3a3a44');
        hctx.beginPath(); hctx.arc(W / 2 - 68 + i * 68, H / 2 - 112, 24, 0, Math.PI * 2); hctx.fill();
      }
      hctx.font = FONT(96); hctx.fillStyle = left === 0 ? '#30d158' : '#fff';
      shadowText(left > 0 ? String(left) : 'LOS!', W / 2, H / 2 - 10, 14);
    }

    // heat over / tournament over
    if (st.phase === 'heatOver') {
      hctx.fillStyle = 'rgba(0,0,0,.55)'; hctx.fillRect(0, H / 2 - 74, W, 128);
      hctx.fillStyle = '#ffd60a'; hctx.font = FONT(42);
      hctx.fillText(st.heatWinner !== null ? '🏁 ' + nameOf(st.heatWinner) + ' gewinnt Heat ' + st.heat + '!' : '🏁 Heat vorbei!', W / 2, H / 2 - 26);
      hctx.fillStyle = '#fff'; hctx.font = FONT(20);
      hctx.fillText(rows.slice().sort((a, b) => (st.points[b] || 0) - (st.points[a] || 0))
        .map(id => shortName(id) + ' ' + (st.points[id] || 0)).join('  ·  ') + '   (Ziel: ' + st.target + ')', W / 2, H / 2 + 26);
    }
    if (st.phase === 'final' && st.champion !== null) {
      hctx.fillStyle = 'rgba(0,0,0,.62)'; hctx.fillRect(0, 0, W, H);
      hctx.fillStyle = '#ffd60a'; hctx.font = FONT(58);
      hctx.fillText('👑 ' + nameOf(st.champion) + ' gewinnt!', W / 2, H / 2 - 120);
      hctx.font = FONT(26);
      st.order.slice().sort((a, b) => (st.points[b] || 0) - (st.points[a] || 0)).forEach((id, i) => {
        hctx.fillStyle = colorOf(id);
        hctx.fillText((i + 1) + '.  ' + shortName(id) + ' — ' + (st.points[id] || 0) + ' Punkte', W / 2, H / 2 - 50 + i * 38);
      });
      hctx.fillStyle = 'rgba(255,255,255,.6)'; hctx.font = FONT(17, 'normal');
      hctx.fillText('⭐ Host kann am Handy eine Revanche starten', W / 2, H - 56);
    }

    hctx.textAlign = 'right'; hctx.font = FONT(13, 'normal'); hctx.fillStyle = 'rgba(255,255,255,.6)';
    hctx.fillText('Host kann am Handy abbrechen ✕', W - 12, H - 12);
  }

  return {
    acceptsJoin: false,
    start(ids, cfg) {
      Sim = window.RacerSim; view = ensureView();
      const Tracks = window.RacerTracks;
      if (!view || !Sim || !Tracks) { view = null; endToLobby('3D/WebGL wird von diesem Browser nicht unterstützt 😢'); return; }
      cfg = cfg || {};
      const seed = (Math.random() * 0xffffffff) >>> 0;
      map = Tracks.pick(cfg.track || 'desert', Sim.mulberry32(seed));
      map.items = cfg.items !== 'off';
      sim = Sim.create({ pts: map.pts, ids, seed, target: cfg.targetPoints || 5, items: map.items, grip: map.biome.grip, lava: map.biome.lava });
      const colors = {}; ids.forEach(id => { colors[id] = colorOf(id); });
      try { view.setRound(sim, { biome: map.biome, colors }); }
      catch (e) { sim = null; view = null; endToLobby('3D/WebGL wird von diesem Browser nicht unterstützt 😢'); return; }
      hctx = racerHud.getContext('2d');
      buildMinimap();
      toasts = []; boltFlash = 0; slowFrames = 0;
      lastT = performance.now(); lastMirror = 0; lastRanks = 0;
      show(true); fitRatio();
      window.addEventListener('resize', fitRatio);
      handle(sim.start());
    },
    stop() {
      window.removeEventListener('resize', fitRatio);
      show(false);
      try { if (view && view.clear) view.clear(); } catch (e) {}
      sim = null;
    },
    onDisconnect(id) {
      if (!sim) return;
      const wasFinal = sim.state.phase === 'final';
      if (!sim.remove(id)) { endToLobby('Micro Racer braucht mind. 2 Spieler.'); return; }
      // the host may have left: hand the rematch button to the new one
      if (wasFinal && sim.state.champion !== null) sim.state.order.forEach(o => send(o, finalFor(o)));
    },
    canResume(id) { return !!sim && sim.state.order.includes(id); },
    onReconnect(id) { resync(id); },
    onMessage(id, d) {
      if (!d || !sim) return;
      if (d.t === 'raceAgain') { if (id === hostId()) sim.rematch(); }
      else if (d.t === 'raceSteer') sim.input(id, d.s, d.b);
      else if (d.t === 'raceNitro') sim.nitro(id);
      else if (d.t === 'raceItem') sim.useItem(id);
    },
    render() {
      if (!sim) return;
      const now = performance.now(), raw = now - lastT, dt = Math.min(0.05, raw / 1000);
      lastT = now;
      handle(sim.step(dt));
      tickPhones(now);
      try { view.render(sim.state, dt); } catch (e) { if (!view.failed) { view.failed = true; console.error('Micro Racer view: ' + (e.stack || e)); } }
      drawHud(now);
      // Mitschauen reads the shell canvas: give it a copy now and then
      if (now - lastMirror >= MIRROR_MS) {
        lastMirror = now;
        try { ctx.drawImage(view.canvas, 0, 0, W, H); ctx.drawImage(racerHud, 0, 0, W, H); } catch (e) {}
      }
      // too slow at high resolution: stay at 1× for the rest of the evening
      slowFrames = raw > SLOW_FRAME_MS ? slowFrames + 1 : 0;
      if (slowFrames >= SLOW_AFTER && !racerSlow && view.ratio > 1) { racerSlow = true; fitRatio(); }
    },
    _debug() { return sim ? { sim, state: sim.state, racers: sim.state.racers, samples: sim.track.samples, phase: sim.state.phase, standings: sim.standings(), map } : null; }
  };
}});
