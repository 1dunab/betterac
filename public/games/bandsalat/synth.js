// ===== Bandsalat synth: every instrument made from oscillators and noise, no audio files =====
// BandSynth.create(ctx, out, kit, bass) → { hit(v, t, vel), on(sound, midi, t, vel) → { off(t) }, note(…, dur), applause(t), allOff() }
// Times are AudioContext times. Everything runs through one compressor, so eight people hammering do not clip.
(function (root) {
  // ---- tunables ----
  const MAX_HELD = 20;        // sounding notes of keyboard and bass; the oldest one makes room
  const HOLD_MAX = 8;         // a held note ends by itself after this many seconds (a lost "finger up")
  const TRIM = 1.6;           // after the compressor (which makes up gain by itself): measured so that a full band stays below clipping
  const KITS = {
    soft: { lp: 6500, kickF: 46, kickDur: 0.38, snare: 0.13, hat: 0.7 },
    tight: { lp: 13000, kickF: 52, kickDur: 0.26, snare: 0.16, hat: 1 },
    hard: { lp: 17000, kickF: 50, kickDur: 0.34, snare: 0.18, hat: 1.1 }
  };
  const BASSES = { round: { type: 'triangle', cut: 500, q: 1 }, pluck: { type: 'sawtooth', cut: 1100, q: 3 }, acid: { type: 'sawtooth', cut: 1900, q: 9 } };
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function create(ctx, out, kitName, bassName) {
    const kit = KITS[kitName] || KITS.tight, bassP = BASSES[bassName] || BASSES.round;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24; comp.knee.value = 12; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.15;
    const bus = ctx.createGain(), trim = ctx.createGain();
    trim.gain.value = TRIM;
    bus.connect(comp); comp.connect(trim); trim.connect(out);
    const drumBus = ctx.createBiquadFilter(); drumBus.type = 'lowpass'; drumBus.frequency.value = kit.lp;
    drumBus.connect(bus);
    let noiseBuf = null;
    const held = [];

    // ---- building blocks ----
    function osc(type, f, t, end) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); if (end) o.stop(end); return o; }
    function noise(t, end) {
      if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      s.start(t, Math.random() * 0.9); s.stop(end);
      return s;
    }
    function filt(type, f, q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; }
    // gain that jumps up and dies away
    function decay(t, peak, dur, attack) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + (attack || 0.003));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      return g;
    }
    const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); };
    function sweep(type, f1, f2, t, dur, peak, slide, dest) {
      const o = osc(type, f1, t, t + dur + 0.05);
      o.frequency.exponentialRampToValueAtTime(f2, t + (slide || dur));
      chain(o, decay(t, peak, dur), dest || drumBus);
    }
    function hiss(t, dur, peak, type, f, q, attack) { chain(noise(t, t + dur + 0.05), filt(type, f, q), decay(t, peak, dur, attack), drumBus); }

    // ---- drums and percussion: one-shots ----
    const HITS = {
      kick: (t, v) => { sweep('sine', kit.kickF * 3.2, kit.kickF, t, kit.kickDur, 1.0 * v, 0.07); sweep('triangle', 900, 120, t, 0.03, 0.25 * v); },
      snare: (t, v) => { hiss(t, kit.snare, 0.9 * v, 'highpass', 1400); sweep('triangle', 210, 150, t, 0.1, 0.6 * v); },
      hat: (t, v) => hiss(t, 0.05, 0.4 * v * kit.hat, 'highpass', 7500),
      openhat: (t, v) => hiss(t, 0.3, 0.32 * v * kit.hat, 'highpass', 7000),
      tom: (t, v) => sweep('sine', 210, 100, t, 0.32, 0.85 * v, 0.2),
      crash: (t, v) => { hiss(t, 1.4, 0.55 * v, 'highpass', 4200); hiss(t, 0.5, 0.3 * v, 'bandpass', 9000, 2); },
      clap: (t, v) => { [0, 0.011, 0.023].forEach(d => hiss(t + d, 0.02, 0.5 * v, 'bandpass', 1500, 1.4)); hiss(t + 0.03, 0.17, 0.5 * v, 'bandpass', 1400, 1.2); },
      shaker: (t, v) => hiss(t, 0.09, 0.3 * v, 'bandpass', 6500, 0.9, 0.028),
      tamb: (t, v) => { hiss(t, 0.14, 0.24 * v, 'highpass', 8500); [4300, 5750].forEach(f => chain(osc('square', f, t, t + 0.1), decay(t, 0.03 * v, 0.07), drumBus)); },
      cowbell: (t, v) => { const b = filt('bandpass', 800, 1.2), g = decay(t, 0.22 * v, 0.24); [545, 815].forEach(f => osc('square', f, t, t + 0.3).connect(b)); chain(b, g, drumBus); },
      click: (t, v) => chain(osc('square', 1500, t, t + 0.06), decay(t, 0.3 * v, 0.035), drumBus),
      clickhi: (t, v) => chain(osc('square', 2200, t, t + 0.06), decay(t, 0.4 * v, 0.045), drumBus)
    };

    // ---- keyboard sounds and the bass: a voice is sources → env (written once) → gate (closes on "finger up") ----
    // each builder returns the sources to stop and how long the release takes
    const VOICES = {
      piano(f, t, v, env, midi) {
        const d = Math.max(0.9, Math.min(2.6, 2.4 - (midi - 48) * 0.03));
        const lp = filt('lowpass', Math.min(9000, f * 5 + 1200));
        lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.5), t + 0.7);
        const src = [['triangle', 1, 1], ['sine', 2, 0.28], ['sine', 3, 0.09]].map(([type, m, g]) => { const o = osc(type, f * m, t), a = ctx.createGain(); a.gain.value = g; chain(o, a, lp); return o; });
        env.gain.linearRampToValueAtTime(0.5 * v, t + 0.005); env.gain.exponentialRampToValueAtTime(0.0008, t + d);
        lp.connect(env);
        return { src, rel: 0.14 };
      },
      epiano(f, t, v, env) {      // a little FM: the bell in the attack fades into a round tone
        const car = osc('sine', f, t), m = osc('sine', f, t), idx = ctx.createGain();
        idx.gain.setValueAtTime(f * 1.8, t); idx.gain.exponentialRampToValueAtTime(f * 0.2, t + 0.45);
        chain(m, idx); idx.connect(car.frequency);
        env.gain.linearRampToValueAtTime(0.42 * v, t + 0.005); env.gain.exponentialRampToValueAtTime(0.0008, t + 2.4);
        car.connect(env);
        return { src: [car, m], rel: 0.2 };
      },
      orgel(f, t, v, env) {
        const src = [[1, 0.5], [2, 0.32], [3, 0.16], [4, 0.08]].map(([m, g]) => { const o = osc('sine', f * m, t), a = ctx.createGain(); a.gain.value = g; chain(o, a, env); return o; });
        env.gain.linearRampToValueAtTime(0.3 * v, t + 0.014);
        return { src, rel: 0.07 };
      },
      synth(f, t, v, env) {
        const lp = filt('lowpass', 500, 4);
        lp.frequency.linearRampToValueAtTime(3400, t + 0.03); lp.frequency.exponentialRampToValueAtTime(1300, t + 0.45);
        const src = [-8, 8].map(c => { const o = osc('sawtooth', f, t); o.detune.value = c; o.connect(lp); return o; });
        env.gain.linearRampToValueAtTime(0.16 * v, t + 0.012); env.gain.exponentialRampToValueAtTime(0.11 * v, t + 0.5);
        lp.connect(env);
        return { src, rel: 0.18 };
      },
      glocken(f, t, v, env) {
        const o1 = osc('sine', f * 2, t), o2 = osc('sine', f * 2 * 2.76, t), a = decay(t, 0.3, 0.25, 0.002);
        o1.connect(env); chain(o2, a, env);
        env.gain.linearRampToValueAtTime(0.36 * v, t + 0.003); env.gain.exponentialRampToValueAtTime(0.0008, t + 1.4);
        return { src: [o1, o2], rel: 0.3 };
      },
      bass(f, t, v, env) {
        const lp = filt('lowpass', bassP.cut * 2.2, bassP.q);
        lp.frequency.exponentialRampToValueAtTime(Math.max(140, bassP.cut * 0.4), t + 0.28);
        const o = osc(bassP.type, f, t), sub = osc('sine', f, t), sg = ctx.createGain();
        sg.gain.value = 0.6;
        o.connect(lp); chain(sub, sg, env); lp.connect(env);
        env.gain.linearRampToValueAtTime(0.42 * v, t + 0.006); env.gain.exponentialRampToValueAtTime(0.26 * v, t + 0.3);
        return { src: [o, sub], rel: 0.09 };
      }
    };

    function on(sound, midi, t, vel) {
      const env = ctx.createGain(), gate = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      const vo = (VOICES[sound] || VOICES.piano)(mtof(midi), t, vel === undefined ? 1 : vel, env, midi);
      chain(env, gate, bus);
      const h = { done: false, off(at) {
        if (h.done) return;
        h.done = true;
        at = Math.max(at, t + 0.03);
        gate.gain.setValueAtTime(1, at); gate.gain.setTargetAtTime(0, at, vo.rel / 3);
        vo.src.forEach(o => { try { o.stop(at + vo.rel * 2 + 0.05); } catch (e) {} });
        const i = held.indexOf(h); if (i >= 0) held.splice(i, 1);
      } };
      vo.src.forEach(o => o.stop(t + HOLD_MAX + 1));         // the safety net; an earlier off() overrides it
      gate.gain.setValueAtTime(1, t); gate.gain.setTargetAtTime(0, t + HOLD_MAX, 0.1);
      held.push(h);
      if (held.length > MAX_HELD) held[0].off(ctx.currentTime);
      return h;
    }

    return {
      kit, held,
      hit(v, t, vel) { if (HITS[v]) HITS[v](Math.max(t, ctx.currentTime), vel === undefined ? 1 : vel); },
      on(sound, midi, t, vel) { return on(sound, midi, Math.max(t, ctx.currentTime), vel); },
      note(sound, midi, t, dur, vel) { t = Math.max(t, ctx.currentTime); on(sound, midi, t, vel).off(t + dur); },
      applause(t, dur) {
        const n = Math.round(dur * 60);
        for (let i = 0; i < n; i++) {
          const at = t + Math.random() * dur, fade = 1 - Math.pow((at - t) / dur, 2);
          chain(noise(at, at + 0.06), filt('bandpass', 900 + Math.random() * 2600, 1.2), decay(at, 0.14 * fade + 0.02, 0.03), bus);
        }
      },
      allOff() { held.slice().forEach(h => h.off(ctx.currentTime)); }
    };
  }

  root.BandSynth = { create, KITS, BASSES, MAX_HELD, HOLD_MAX };
})(window);
