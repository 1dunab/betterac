// Wauwau-WG sounds (screen only): a tiny WebAudio synth for dog noises — no
// audio files. Same rules as the shell's sfx.js: silent until a gesture on
// this page unlocks audio, follows the 🔊 toggle (sfx.muted), and is a no-op
// without AudioContext (JSDOM, old browsers). Scenes call api.sfx(name) with a
// dog sound (WW.SOUNDS) or any shell palette name, which passes through to sfx().
(function () {
  'use strict';
  const WW = window.WW;
  const AC = window.AudioContext || window.webkitAudioContext;
  const PALETTE = ['pop', 'tick', 'beep', 'go', 'coin', 'powerup', 'buzz', 'hit', 'thud', 'splash', 'whoosh', 'explosion', 'fanfare', 'sad'];
  const VOLUME = 0.42;
  const MIN_GAP = 0.07;            // s — the same dog sound never stacks closer than this

  let ctx = null, master = null, noise = null;
  const lastAt = {};

  function unlock() {
    try {
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = VOLUME;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch (e) { ctx = null; }
  }
  if (AC) ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, unlock));
  const ready = () => ctx && ctx.state === 'running' && !(typeof sfx === 'function' && sfx.muted);
  const jitter = (k) => 1 + (Math.random() - 0.5) * k;   // pure decoration: wall-clock randomness is fine here

  function getNoise() {
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noise;
  }
  // Oscillator with a pitch path [[dt, hz], …] and a quick attack / exponential decay.
  function voice(type, path, t, dur, peak, filter) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(path[0][1], t);
    for (let i = 1; i < path.length; i++) o.frequency.exponentialRampToValueAtTime(path[i][1], t + path[i][0]);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
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
  function hiss(t, dur, peak, type, f1, f2, q) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = getNoise(); s.loop = true;
    f.type = type; f.frequency.setValueAtTime(f1, t); f.Q.value = q || 1;
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  const DOG = {
    woof(t) {             // rough rise-and-fall bark with a noisy onset
      const k = jitter(0.25);
      voice('sawtooth', [[0, 210 * k], [0.03, 360 * k], [0.16, 170 * k]], t, 0.18, 0.5, ['bandpass', 820 * k, 1.4]);
      voice('square', [[0, 110 * k], [0.14, 80 * k]], t, 0.15, 0.12, ['lowpass', 600]);
      hiss(t, 0.07, 0.25, 'bandpass', 1500 * k, 700, 1.2);
    },
    yip(t) {              // small happy bark
      const k = jitter(0.2);
      voice('triangle', [[0, 620 * k], [0.03, 1150 * k], [0.1, 640 * k]], t, 0.12, 0.35);
      hiss(t, 0.04, 0.08, 'bandpass', 2600, 1800, 2);
    },
    squeak(t) {           // rubber toy: two chirps
      voice('square', [[0, 1300], [0.06, 2300]], t, 0.08, 0.12, ['lowpass', 3200]);
      voice('square', [[0, 1500], [0.05, 2100]], t + 0.1, 0.07, 0.1, ['lowpass', 3200]);
    },
    slurp(t) {            // lapping water
      for (let i = 0; i < 5; i++) {
        const s = t + i * 0.075;
        hiss(s, 0.06, 0.16, 'bandpass', 700 * jitter(0.4), 1300, 3);
        voice('sine', [[0, 240], [0.05, 140]], s, 0.06, 0.08);
      }
    },
    crunch(t) {           // kibble
      for (let i = 0; i < 3; i++) hiss(t + i * 0.055 + Math.random() * 0.02, 0.045, 0.2 * jitter(0.5), 'highpass', 2200, 0, 0.7);
    },
    dig(t) {              // paws in dirt
      hiss(t, 0.09, 0.3, 'lowpass', 520, 160);
      hiss(t + 0.11, 0.09, 0.26, 'lowpass', 480, 150);
    },
    find(t) {             // sparkly little arpeggio
      [880, 1175, 1568, 2093].forEach((f, i) => voice('triangle', [[0, f]], t + i * 0.06, 0.16, 0.2));
    },
    shake(t) {            // flappy ears + fur: noise tremolo
      for (let i = 0; i < 9; i++) hiss(t + i * 0.05, 0.045, 0.14 + (i % 2) * 0.06, 'bandpass', 1400, 900, 1.5);
    },
    snore(t) {            // slow, low and quiet
      voice('sawtooth', [[0, 70], [0.6, 62]], t, 0.8, 0.06, ['lowpass', 380]);
      hiss(t, 0.7, 0.04, 'lowpass', 500, 260);
    },
    whine(t) {            // sad little rising-falling whimper
      voice('sine', [[0, 760], [0.18, 980], [0.45, 640]], t, 0.5, 0.14);
    }
  };
  WW.SOUNDS = Object.keys(DOG);

  WW.sound = function (name) {
    if (PALETTE.indexOf(name) >= 0) { if (typeof sfx === 'function') sfx(name); return; }
    if (!DOG[name] || !AC) return;
    if (!ctx) unlock();
    if (!ready()) return;                 // no gesture yet (or muted) — drop it
    const now = ctx.currentTime;
    if (lastAt[name] != null && now - lastAt[name] < MIN_GAP) return;
    lastAt[name] = now;
    try { DOG[name](now); } catch (e) {}
  };
})();
