// ============ Screen-Modul: BANDSALAT ============
// Jedes Handy ist ein Instrument, der Fernseher ist die Anlage. Regeln, Takt und Loops: music.js (läuft in Node),
// Klang: synth.js. Diese Datei ist der Kleber: Handy-Protokoll, die Uhr, die Bühne.
registerGame({ key: 'bandsalat', screen: function () {
  const W = 960, H = 600;
  const AHEAD = 0.12;                 // seconds the loops are handed to the synth before they are due
  const EMO = { drums: '🥁', keys: '🎹', bass: '🎸', perc: '🔔', seq: '🎛️' };
  const GRIDS = { '16': 1, '8': 2, aus: 0 }, BACKINGS = { aus: 'off', klick: 'click', beat: 'beat' };
  const GRID_NAMES = { 1: 'Sechzehntel', 2: 'Achtel', 0: 'frei' }, BACK_NAMES = { off: 'aus', click: 'Klick', beat: 'leiser Beat' };
  const FONT = (px, w) => (w || 'bold') + ' ' + px + 'px system-ui,sans-serif';
  const mod = (a, n) => ((a % n) + n) % n;
  const now = () => performance.now() / 1000;

  let M = null, band = null, cfg = {}, started = false;
  let audio = null, synth = null, holds = {};
  let shown = [], toasts = [], hits = {};          // notes on the stage, messages, when each player last played

  function grabAudio() {
    if (synth || !window.BandSynth || !sfx.audio) return;
    audio = sfx.audio();
    if (audio) { try { synth = BandSynth.create(audio.ctx, audio.out, band.style.kit, band.style.bass); } catch (e) { audio = null; } }
  }
  const toAudio = (t) => audio.ctx.currentTime + (t - now());

  function play(e) {
    shown.push(e);
    if (!synth) return;
    const at = toAudio(e.t);
    if (e.v) synth.hit(e.v, at, e.vel);
    else if (e.hold) { if (holds[e.hold]) holds[e.hold].off(at); holds[e.hold] = synth.on(e.sound, e.midi, at, e.vel); }
    else synth.note(e.sound, e.midi, at, e.dur || 0.2, e.vel);
  }
  function release(off) {
    if (!off || !holds[off.hold]) return;
    holds[off.hold].off(toAudio(off.t)); delete holds[off.hold];
  }

  const ids = () => band.state.order;
  function sendYou(id) {
    const y = band.you(id, now());
    if (y) ac.message(id, Object.assign(y, { t: 'bsYou', host: id === hostId(), over: band.state.over, style: band.style.label, bpm: band.tr.bpm }));
  }
  function sendBar(info, id) { const m = Object.assign({ t: 'bsBar' }, info); (id === undefined ? ids() : [id]).forEach(i => ac.message(i, m)); }
  const sendAll = () => ids().forEach(sendYou);
  function hello(id) { sendYou(id); sendBar(band.barInfo(now()), id); }
  function toast(text, color) { toasts.push({ text, color: color || '#fff', until: performance.now() + 2600 }); if (toasts.length > 3) toasts.shift(); }

  function newBand(keep) {
    band = M.create({ style: cfg.stil, grid: GRIDS[cfg.raster], backing: BACKINGS[cfg.begleitung], t: now() });
    shown = []; holds = {}; hits = {};
    (keep || []).forEach(k => { band.join(k.id); band.pick(k.id, k.inst, now()); band.set(k.id, k); });
  }

  // ---------- Bühne ----------
  function drawHeader(c, s) {
    const col = mod(s, 16), beat = Math.floor(col / 4), ci = band.chordAt(s), chords = band.style.chords;
    c.textBaseline = 'middle'; c.textAlign = 'left';
    c.fillStyle = '#fff'; c.font = FONT(26); c.fillText('🎶 Bandsalat', 18, 34);
    c.fillStyle = 'rgba(255,255,255,.65)'; c.font = FONT(16, 'normal');
    c.fillText(band.style.label + ' · ' + band.tr.bpm + ' BPM', 20, 66);
    // the four chords of the round, the current one lit and filling up
    const bw = 100, gap = 8, x0 = (W - 4 * bw - 3 * gap) / 2;
    c.textAlign = 'center';
    chords.forEach((ch, i) => {
      const x = x0 + i * (bw + gap), cur = i === ci && !band.state.over;
      rr(c, x, 18, bw, 56, 12); c.fillStyle = cur ? '#ffd60a' : 'rgba(255,255,255,.08)'; c.fill();
      if (cur) { c.save(); rr(c, x, 18, bw, 56, 12); c.clip(); c.fillStyle = 'rgba(0,0,0,.16)'; c.fillRect(x, 18, bw * col / 16, 56); c.restore(); }
      c.fillStyle = cur ? '#10141a' : 'rgba(255,255,255,.8)'; c.font = FONT(28); c.fillText(ch.name, x + bw / 2, 47);
    });
    for (let i = 0; i < 4; i++) {
      const on = i === beat && !band.state.over, r = on ? 14 - (col % 4) : 9;
      c.beginPath(); c.arc(790 + i * 42, 46, r, 0, Math.PI * 2);
      c.fillStyle = on ? (i === 0 ? '#ff9f0a' : '#fff') : 'rgba(255,255,255,.18)'; c.fill();
    }
  }

  function drawLanes(c, s, t) {
    const list = ids(), top = 100, area = H - 46 - top, lh = Math.min(86, area / Math.max(1, list.length)), h = lh - 6;
    const gx = 214, cw = (W - 20 - gx) / 16, col = mod(s, 16), nh = Math.max(4, Math.min(10, h / 5));
    c.textBaseline = 'middle';
    list.forEach((id, i) => {
      const p = band.state.players[id], y = top + i * lh, color = (players[id] && players[id].color) || '#fff';
      const lit = Math.max(0, 1 - (t - (hits[id] || -9)) / 0.25);
      rr(c, 10, y, W - 20, h, 10); c.fillStyle = 'rgba(255,255,255,' + (0.045 + 0.06 * lit) + ')'; c.fill();
      c.fillStyle = 'rgba(255,255,255,.035)';
      c.fillRect(gx, y, 4 * cw, h); c.fillRect(gx + 8 * cw, y, 4 * cw, h);
      c.fillStyle = color; rr(c, 10, y, 7, h, 3); c.fill();
      c.textAlign = 'left'; c.fillStyle = '#fff';
      fitFont(c, shortName(id), 96, Math.min(20, h * 0.5)); c.fillText(shortName(id), 26, y + h / 2);
      c.font = FONT(Math.min(26, h * 0.6)); c.fillText(EMO[p.inst] || '🤔', 128, y + h / 2);
      const nl = band.loopsOf(id).length;
      c.font = FONT(Math.min(14, h * 0.4));
      if (p.rec) { c.fillStyle = p.rec.on || Math.floor(t * 4) % 2 ? '#ff453a' : 'rgba(255,69,58,.35)'; c.fillText(p.rec.on ? '⏺ REC' : '⏺ gleich', 164, y + h / 2); }
      else if (nl) { c.fillStyle = 'rgba(255,255,255,.7)'; c.fillText('🔁' + nl, 168, y + h / 2); }
      if (!p.inst && !nl && !shown.some(n => n.owner === id)) {
        c.fillStyle = 'rgba(255,255,255,.4)'; c.font = FONT(Math.min(15, h * 0.4), 'normal'); c.fillText('sucht sich am Handy ein Instrument aus…', gx + 12, y + h / 2);
      }
    });
    // what sounded during the last bar: a note stays for one round and fades
    for (const n of shown) {
      const i = list.indexOf(n.owner), age = s - n.step;
      if (i < 0 || age < 0) continue;
      const y = top + i * lh, fresh = age < 0.7, x = gx + mod(n.step, 16) * cw;
      c.globalAlpha = fresh ? 1 : Math.max(0.12, 0.7 - 0.55 * age / 16);
      c.fillStyle = fresh ? '#fff' : (players[n.owner] && players[n.owner].color) || '#fff';
      rr(c, x + 2, y + 4 + (1 - n.h) * (h - 8 - nh), Math.max(6, cw - 4), nh, 3); c.fill();
    }
    c.globalAlpha = 1;
    if (!band.state.over) { c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(gx + col * cw - 1, top - 4, 2, list.length * lh + 2); }
  }

  function drawOver(c) {
    c.fillStyle = 'rgba(8,6,16,.82)'; c.fillRect(0, 0, W, H);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffd60a'; c.font = FONT(60); c.fillText('🎬 Das war\'s!', W / 2, 120);
    c.fillStyle = 'rgba(255,255,255,.75)'; c.font = FONT(22, 'normal');
    c.fillText(band.style.label + ' · ' + (band.state.bar + 1) + ' Takte', W / 2, 176);
    const rows = ids().map(id => band.state.players[id]).sort((a, b) => b.notes - a.notes).slice(0, 8);
    c.font = FONT(24);
    rows.forEach((p, i) => {
      c.fillStyle = (players[p.id] && players[p.id].color) || '#fff';
      c.fillText((EMO[p.inst] || '🎵') + ' ' + shortName(p.id) + ' · ' + p.notes + (p.notes === 1 ? ' Ton' : ' Töne'), W / 2, 236 + i * 36);
    });
    c.fillStyle = 'rgba(255,255,255,.6)'; c.font = FONT(17, 'normal');
    c.fillText('⭐ Host kann am Handy eine Zugabe starten', W / 2, H - 50);
  }

  function draw(t) {
    const c = ctx, s = band.stepOf(t), kick = 1 - (mod(s, 4)) / 4;
    c.fillStyle = '#12101c'; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W / 2, 40, 20, W / 2, 40, 620);
    g.addColorStop(0, 'rgba(150,110,255,' + (band.state.over ? 0.1 : 0.1 + 0.12 * kick * kick) + ')'); g.addColorStop(1, 'rgba(150,110,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    shown = shown.filter(n => s - n.step < 16);
    drawHeader(c, s);
    drawLanes(c, s, t);

    c.textBaseline = 'middle'; c.font = FONT(13, 'normal'); c.fillStyle = 'rgba(255,255,255,.55)';
    c.textAlign = 'left'; c.fillText('Raster: ' + GRID_NAMES[band.state.grid] + ' · Begleitung: ' + BACK_NAMES[band.state.backing], 14, H - 14);
    c.textAlign = 'right'; c.fillText('Host am Handy: Tempo, 🧹 alles aus, 🎬 Finale, ✕ abbrechen', W - 14, H - 14);

    const ms = performance.now();
    toasts = toasts.filter(x => x.until > ms);
    c.textAlign = 'center'; c.font = FONT(22);
    toasts.forEach((x, i) => { c.globalAlpha = clamp((x.until - ms) / 400, 0, 1); c.fillStyle = 'rgba(10,8,20,.8)'; rr(c, W / 2 - 230, H - 96 - i * 40, 460, 34, 17); c.fill(); c.fillStyle = x.color; c.fillText(x.text, W / 2, H - 79 - i * 40); });
    c.globalAlpha = 1;

    if (band.state.over && t >= band.state.overT + 1.2) drawOver(c);
    // without a click on this page the browser keeps the sound locked: say so, or the game seems broken
    const quiet = band.state.over ? null : !synth ? '🔇 Kein Ton: einmal auf diese Seite klicken oder eine Taste drücken' : (sfx.muted ? '🔇 Der Ton ist stumm: 🔊 oben anklicken' : null);
    if (quiet) {
      c.textAlign = 'center'; c.font = FONT(24);
      rr(c, W / 2 - 400, H - 100, 800, 60, 20); c.fillStyle = Math.floor(t * 2) % 2 ? '#ff453a' : '#c2281f'; c.fill();
      c.fillStyle = '#fff'; c.fillText(quiet, W / 2, H - 70);
    }
  }

  return {
    acceptsJoin: true,          // who comes later picks an instrument and plays along
    start(idList, config) {
      M = window.BandMusic;
      if (!M) { endToLobby('Bandsalat konnte nicht geladen werden 😢'); return; }
      cfg = config || {};
      newBand();
      idList.forEach(id => band.join(id));
      started = true; toasts = [];
      sendAll(); sendBar(band.barInfo(now()));
    },
    stop() {
      if (synth) synth.allOff();
      started = false; holds = {};
    },
    onConnect(id) { if (started) band.join(id); },         // the phone says hello as soon as it is in the game
    onDisconnect(id) {
      if (!started || !band.state.players[id]) return;
      band.leave(id, now()).forEach(release);
      if (!ids().length) { endToLobby('Die Band ist nach Hause gegangen.'); return; }
      sendAll();                                            // the host may have changed
    },
    canResume(id) { return started && !!band.state.players[id]; },
    onReconnect(id) { hello(id); },
    onMessage(id, d) {
      if (!d || !started || !band.state.players[id]) return;
      const t = now(), host = id === hostId();
      if (d.t === 'bsHello') hello(id);
      else if (d.t === 'bsOn') { const n = band.noteOn(id, d.n, t); if (n.length) hits[id] = t; n.forEach(play); }
      else if (d.t === 'bsOff') release(band.noteOff(id, d.n | 0, t));
      else if (d.t === 'bsPick') { band.pick(id, d.inst === null ? null : String(d.inst), t).forEach(release); sendYou(id); }
      else if (d.t === 'bsSet') band.set(id, d);
      else if (d.t === 'bsRec') { band.rec(id, t); sendYou(id); }
      else if (d.t === 'bsDel') { band.del(id, d.id | 0); sendYou(id); }
      else if (d.t === 'bsCell') band.cell(id, d.k, d.r, d.s, d.on);
      else if (d.t === 'bsSeqClear') { band.seqClear(id, d.k); sendYou(id); }
      else if (d.t === 'bsSeqPreset') { band.seqPreset(id, d.k); sendYou(id); }
      else if (d.t === 'bsSeqSound') band.seqSound(id, d.s);
      else if (!host) return;
      else if (d.t === 'bsTempo' && !band.state.over) { band.tempo(d.d > 0 ? 4 : -4, t); sendAll(); sendBar(band.barInfo(t)); }
      else if (d.t === 'bsClear' && !band.state.over) { band.clear(); toast('🧹 Alle Loops und Muster sind aus'); sendAll(); }
      else if (d.t === 'bsFinale' && !band.state.over) { band.finale(t); toast('🎬 Letzter Takt!', '#ffd60a'); }
      else if (d.t === 'bsAgain' && band.state.over) {
        newBand(ids().map(k => { const p = band.state.players[k]; return { id: k, inst: p.inst, sound: p.sound, oct: p.oct, len: p.len }; }));
        toast('🎶 Zugabe!', '#30d158');
        sendAll(); sendBar(band.barInfo(now()));
      }
    },
    render() {
      if (!started) return;
      const t = now();
      grabAudio();
      const out = band.advance(t, AHEAD);
      out.notes.forEach(play);
      out.bars.forEach(b => sendBar(b));
      if (out.finale) {
        const at = band.state.overT;
        Object.keys(holds).forEach(k => release({ hold: k, t: at }));
        if (synth) synth.applause(toAudio(at + 0.9), 3.6);
      }
      out.changed.forEach(sendYou);
      draw(t);
    },
    _debug() { return { band, state: band && band.state, synth, shown, holds }; }
  };
}});
