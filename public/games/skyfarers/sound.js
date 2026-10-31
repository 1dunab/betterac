// Skyfarers sounds (screen only): a small WebAudio synth for the airship world — no audio files.
// Same rules as the shell's sfx.js: silent until a gesture on this page unlocks audio, follows the
// 🔊 toggle (sfx.muted) and is a no-op without AudioContext (JSDOM, old browsers).
//
//   SkyfarersSound.play('thunder')   one-shots: propeller thunder roar harpoon cannon hammer crane
//                                    splash horn chime alarm sink
//   SkyfarersSound.engine(level)     propeller loop, level 0..1 (0 / null = off); call as often as you like
//   SkyfarersSound.ambience(mood)    'calm' | 'storm' | 'night' | null — soft crossfading wind/pad layers
(function () {
  'use strict';
  const AC = window.AudioContext || window.webkitAudioContext;
  const noop = function () {};
  const api = { play: noop, engine: noop, ambience: noop, unlock: noop, names: [], supported: false };
  window.SkyfarersSound = api;
  if (!AC) return;

  const VOLUME = 0.5;                 // master; every voice below is mixed quiet on top of this
  let ctx = null, master = null, noiseBuf = null;
  const want = { engine: 0, mood: null };   // wanted state, applied once audio runs
  let eng = null, amb = null, ambTimer = null;
  const lastAt = {};
  const MIN_GAP = 0.06;               // s — the same one-shot never stacks closer than this

  const muted = () => typeof sfx === 'function' && sfx.muted === true;
  const running = () => !!ctx && ctx.state === 'running';

  function unlock() {
    try {
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted() ? 0 : VOLUME;
        master.connect(ctx.destination);
        setInterval(() => { if (master) master.gain.setTargetAtTime(muted() ? 0 : VOLUME, ctx.currentTime, 0.05); }, 400);
      }
      if (ctx.state === 'suspended') ctx.resume().then(sync, noop);
      else sync();
    } catch (e) { ctx = null; }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, unlock, { passive: true }));

  function getNoise() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  // Oscillator with a pitch path [[dt, hz], …], quick attack, exponential decay, optional filter.
  function voice(type, path, t, dur, peak, filter) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(path[0][1], t);
    for (let i = 1; i < path.length; i++) o.frequency.exponentialRampToValueAtTime(path[i][1], t + path[i][0]);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter[0]; f.frequency.value = filter[1]; f.Q.value = filter[2] || 1;
      o.connect(f); out = f;
    }
    out.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // Filtered noise burst; f2 slides the cutoff, att = attack seconds.
  function hiss(t, dur, peak, type, f1, f2, q, att) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = getNoise(); s.loop = true;
    f.type = type; f.frequency.setValueAtTime(f1, t); f.Q.value = q || 1;
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (att || 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.05);
  }

  const SOUNDS = {
    propeller(t) {                    // short whirr: a prop spinning up and settling
      voice('sawtooth', [[0, 70], [0.25, 120], [0.6, 90]], t, 0.65, 0.12, ['lowpass', 420]);
      hiss(t, 0.6, 0.07, 'bandpass', 500, 900, 0.8, 0.15);
    },
    thunder(t) {                      // crack, then a long rolling rumble
      hiss(t, 0.18, 0.5, 'highpass', 1800, 700, 0.7);
      hiss(t + 0.04, 2.6, 0.55, 'lowpass', 520, 70, 0.9, 0.25);
      voice('sine', [[0, 60], [2.0, 32]], t + 0.1, 2.3, 0.4);
    },
    roar(t) {                         // dragon: growl with a hoarse top
      voice('sawtooth', [[0, 90], [0.3, 150], [1.1, 60]], t, 1.2, 0.2, ['lowpass', 520, 2]);
      voice('square', [[0, 140], [0.4, 210], [1.1, 90]], t, 1.1, 0.05, ['bandpass', 700, 3]);
      hiss(t, 1.1, 0.2, 'bandpass', 900, 350, 1.4, 0.1);
    },
    harpoon(t) {                      // whoosh and a taut twang
      hiss(t, 0.3, 0.22, 'bandpass', 700, 3000, 0.9, 0.05);
      voice('triangle', [[0, 520], [0.18, 180]], t + 0.02, 0.28, 0.2);
      voice('sine', [[0, 1040], [0.12, 360]], t + 0.02, 0.2, 0.08);
    },
    cannon(t) {                       // boom with a short noise body
      voice('sine', [[0, 140], [0.35, 38]], t, 0.5, 0.65);
      hiss(t, 0.45, 0.5, 'lowpass', 2400, 120, 0.8);
      hiss(t, 0.06, 0.3, 'highpass', 2000, 0, 0.7);
    },
    hammer(t) {                       // two wooden knocks
      [0, 0.17].forEach((d, i) => {
        voice('square', [[0, 420 - i * 40], [0.05, 180]], t + d, 0.09, 0.22, ['bandpass', 650, 2]);
        hiss(t + d, 0.05, 0.2, 'bandpass', 1300, 600, 1.3);
      });
    },
    crane(t) {                        // winch creak
      voice('sawtooth', [[0, 150], [0.25, 230], [0.55, 170]], t, 0.6, 0.07, ['bandpass', 700, 5]);
      hiss(t, 0.5, 0.05, 'bandpass', 1200, 500, 4, 0.1);
    },
    splash(t) {
      hiss(t, 0.45, 0.28, 'bandpass', 1500, 450, 0.8);
      hiss(t + 0.05, 0.3, 0.14, 'highpass', 3000, 1500, 0.7);
    },
    horn(t) {                         // airship hooter: two stacked, slightly bent notes
      voice('sawtooth', [[0, 196], [0.04, 220], [0.5, 218]], t, 0.55, 0.16, ['lowpass', 900]);
      voice('sawtooth', [[0, 247], [0.04, 277], [0.5, 275]], t, 0.55, 0.12, ['lowpass', 1100]);
    },
    chime(t) {                        // build done: three bell notes
      [659.25, 830.6, 1046.5].forEach((f, i) => {
        voice('sine', [[0, f]], t + i * 0.11, 0.7, 0.2);
        voice('sine', [[0, f * 2.01]], t + i * 0.11, 0.35, 0.05);
      });
    },
    alarm(t) {                        // event warning: three alternating beeps
      for (let i = 0; i < 3; i++) {
        voice('square', [[0, i % 2 ? 560 : 760]], t + i * 0.2, 0.17, 0.12, ['lowpass', 2200]);
      }
    },
    sink(t) {                         // the island goes down
      voice('sine', [[0, 220], [2.2, 40]], t, 2.4, 0.4);
      voice('triangle', [[0, 330], [1.8, 55]], t, 2.0, 0.18);
      hiss(t, 2.4, 0.3, 'lowpass', 1500, 80, 0.8, 0.3);
      for (let i = 0; i < 5; i++) voice('sine', [[0, 300 + i * 90], [0.1, 120 + i * 40]], t + 0.5 + i * 0.28, 0.14, 0.1);
    }
  };
  api.names = Object.keys(SOUNDS);

  // ---- engine loop: two detuned saws + air, pitch and loudness follow `level` ----
  function buildEngine() {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0;
    const s = ctx.createBufferSource(); s.buffer = getNoise(); s.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 600; nf.Q.value = 0.7;
    const ng = ctx.createGain(); ng.gain.value = 0;
    // the propeller beat: a slow tremolo on the engine gain
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 9; lg.gain.value = 0.0; lfo.connect(lg); lg.connect(g.gain);
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    s.connect(nf); nf.connect(ng); ng.connect(master);
    [o1, o2, s, lfo].forEach(n => n.start());
    return { o1, o2, f, g, nf, ng, lfo, lg, s };
  }
  function applyEngine() {
    const lv = Math.max(0, Math.min(1.5, want.engine || 0)), t = ctx.currentTime;
    if (!eng && lv <= 0) return;
    if (!eng) eng = buildEngine();
    eng.o1.frequency.setTargetAtTime(48 + lv * 38, t, 0.15);
    eng.o2.frequency.setTargetAtTime(24 + lv * 19, t, 0.15);
    eng.f.frequency.setTargetAtTime(200 + lv * 380, t, 0.15);
    eng.g.gain.setTargetAtTime(lv > 0 ? 0.05 + lv * 0.07 : 0, t, 0.2);
    eng.ng.gain.setTargetAtTime(lv > 0 ? 0.01 + lv * 0.05 : 0, t, 0.2);
    eng.nf.frequency.setTargetAtTime(500 + lv * 700, t, 0.2);
    eng.lfo.frequency.setTargetAtTime(7 + lv * 6, t, 0.2);
    eng.lg.gain.setTargetAtTime(lv > 0 ? 0.012 : 0, t, 0.2);
  }

  // ---- ambience: wind + pad + rain + night chirps; moods only move the layer levels ----
  const MOODS = {
    calm:  { wind: 0.022, windF: 380, pad: 0.05, chord: [196, 246.94, 293.66], rain: 0,     chirp: 0 },
    storm: { wind: 0.085, windF: 900, pad: 0.03, chord: [82.41, 87.31, 123.47], rain: 0.05, chirp: 0 },
    night: { wind: 0.03,  windF: 300, pad: 0.05, chord: [174.61, 207.65, 261.63], rain: 0,   chirp: 0.007 }
  };
  function buildAmbience() {
    const out = ctx.createGain(); out.gain.value = 1; out.connect(master);
    // wind: noise through a slowly wandering band-pass
    const ws = ctx.createBufferSource(); ws.buffer = getNoise(); ws.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 380; wf.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = 0;
    const wl = ctx.createOscillator(), wlg = ctx.createGain(); wl.frequency.value = 0.11; wlg.gain.value = 140;
    wl.connect(wlg); wlg.connect(wf.frequency);
    ws.connect(wf); wf.connect(wg); wg.connect(out);
    // pad: three sines with a slow swell
    const pg = ctx.createGain(); pg.gain.value = 0; pg.connect(out);
    const pads = [0, 1, 2].map(i => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = MOODS.calm.chord[i];
      o.detune.value = (i - 1) * 6; o.connect(pg); return o;
    });
    const pl = ctx.createOscillator(), plg = ctx.createGain(); pl.frequency.value = 0.17; plg.gain.value = 0.012;
    pl.connect(plg); plg.connect(pg.gain);
    // rain: high-passed noise
    const rs = ctx.createBufferSource(); rs.buffer = getNoise(); rs.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 2800;
    const rg = ctx.createGain(); rg.gain.value = 0;
    rs.connect(rf); rf.connect(rg); rg.connect(out);
    // night chirps: a high sine gated by a fast square LFO
    const co = ctx.createOscillator(); co.frequency.value = 4300;
    const cg = ctx.createGain(); cg.gain.value = 0;
    const cm = ctx.createGain(); cm.gain.value = 0;
    const cl = ctx.createOscillator(); cl.type = 'square'; cl.frequency.value = 6.5;
    const clg = ctx.createGain(); clg.gain.value = 0.5; cl.connect(clg); clg.connect(cm.gain);
    const cl2 = ctx.createOscillator(); cl2.frequency.value = 0.3;
    const cl2g = ctx.createGain(); cl2g.gain.value = 0.5; cl2.connect(cl2g); cl2g.connect(cm.gain);
    co.connect(cm); cm.connect(cg); cg.connect(out);
    const nodes = [ws, wl, ...pads, pl, rs, co, cl, cl2];
    nodes.forEach(n => n.start());
    return { out, wf, wg, pg, pads, rg, cg, nodes };
  }
  function applyAmbience() {
    const t = ctx.currentTime, mood = MOODS[want.mood];
    if (!mood) {
      if (!amb) return;
      const a = amb; amb = null;
      a.out.gain.setTargetAtTime(0, t, 0.6);                 // fade out, then free the nodes
      clearTimeout(ambTimer);
      ambTimer = setTimeout(() => { a.nodes.forEach(n => { try { n.stop(); } catch (e) {} }); try { a.out.disconnect(); } catch (e) {} }, 4000);
      return;
    }
    if (!amb) { clearTimeout(ambTimer); amb = buildAmbience(); amb.out.gain.value = 0; amb.out.gain.setTargetAtTime(1, t, 0.8); }
    const k = 1.1;                                            // time constant: soft ~3 s crossfades
    amb.wg.gain.setTargetAtTime(mood.wind, t, k);
    amb.wf.frequency.setTargetAtTime(mood.windF, t, k);
    amb.pg.gain.setTargetAtTime(mood.pad, t, k);
    amb.pads.forEach((o, i) => o.frequency.setTargetAtTime(mood.chord[i], t, k));
    amb.rg.gain.setTargetAtTime(mood.rain, t, k);
    amb.cg.gain.setTargetAtTime(mood.chirp, t, k);
  }

  function sync() {
    if (!running()) return;
    try { applyEngine(); applyAmbience(); } catch (e) {}
  }

  api.supported = true;
  api.unlock = unlock;
  api.play = function (name) {
    if (!SOUNDS[name] || muted() || !running()) return;       // no gesture yet (or muted) — drop it
    const now = ctx.currentTime;
    if (lastAt[name] != null && now - lastAt[name] < MIN_GAP) return;
    lastAt[name] = now;
    try { SOUNDS[name](now); } catch (e) {}
  };
  api.engine = function (level) {
    const lv = +level > 0 ? +level : 0;
    if (Math.abs(lv - want.engine) < 0.01 && (lv === 0) === (want.engine === 0)) return;   // called every frame: skip no-ops
    want.engine = lv;
    if (running()) try { applyEngine(); } catch (e) {}
  };
  api.ambience = function (mood) {
    const m = MOODS[mood] ? mood : null;
    if (m === want.mood) return;
    want.mood = m;
    if (running()) try { applyAmbience(); } catch (e) {}
  };
})();
