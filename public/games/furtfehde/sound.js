// Furt & Fehde sounds (screen only): a small WebAudio synth for the valley at war, no audio files.
// Same rules as the shell's sfx.js and Skyfarers' sound.js: silent until a gesture on this page unlocks audio, follows the 🔊 toggle
// (sfx.muted) and is a quiet no-op without AudioContext (JSDOM, old browsers). What was asked for before the unlock is remembered:
// the wanted ambience / battle level is applied once audio runs, and one-shots from the last 1.5 s are replayed.
//
//   FurtSound.play(name, { vol, force })   one-shots, names in FurtSound.names (force skips the rate rules; for the harness):
//                                       combat  clash arrow horn (an order) alarm (a house is attacked)
//                                       work    hammer chop stone crackle (fire) collapse (a building falls)
//                                       water   bell (a crossing opens) splash
//                                       events  cheer (plunder) fanfare (herald) chime (pact) sting (betrayal)
//   FurtSound.ambience(mood)          'calm' (birds + river) | 'flood' (rushing water + rumble) | 'battle' (distant war drums) | null; soft ~3 s crossfades
//   FurtSound.battle(level01)         a drum and clash layer on top of any mood; tempo, drums and the rate of clashes follow the number of fighters
//   FurtSound.event(ev [, { force }]) a sim event (docs "Events") -> the fitting sound, rate limited; the glue can just forward every event
//   FurtSound.unlock()                called by the first pointer / key / touch / click itself; the glue need not call it
//   FurtSound.supported / failed / names / moods / state() ('none' | 'suspended' | 'running') / stats { nodes, plays, queued, errors } (the glue's „🔇 Klick oder Taste für Ton“ hint reads supported, failed and state)
//   Quiet building (docs T2): `buildDone` makes no sound; the hammer of build / rebuild plays at half its old volume, at most once per 2 s overall.
(function () {
  'use strict';
  const AC = window.AudioContext || window.webkitAudioContext;
  const noop = function () {};
  const NAMES = ['clash', 'arrow', 'horn', 'alarm', 'hammer', 'chop', 'stone', 'crackle', 'collapse', 'bell', 'splash', 'cheer', 'fanfare', 'chime', 'sting'];
  const api = { play: noop, ambience: noop, battle: noop, event: noop, unlock: noop, state: () => 'none', names: NAMES.slice(), moods: ['calm', 'flood', 'battle'], supported: false, failed: false,
    stats: { nodes: 0, plays: 0, queued: 0, errors: [] } };
  window.FurtSound = api;
  if (!AC) return;

  const VOLUME = 0.55;                 // master; every voice below is mixed quiet on top of this
  const st = api.stats;
  let ctx = null, master = null, noiseBuf = null, busy = 0;
  const want = { mood: null, battle: 0 };      // wanted state, applied once audio runs
  const queue = [];                            // one-shots asked for before the unlock: { name, vol, at }
  let amb = null, ambTimer = null, drumTimer = null, drumNext = 0, drumStep = 0, birdTimer = null;
  const lastAt = {};
  const MIN_GAP = { clash: 0.05, arrow: 0.05, splash: 0.08 }, DEF_GAP = 0.12;   // s: the same one-shot never stacks closer than this
  const LOW_PRIO = { clash: 1, arrow: 1, splash: 1, hammer: 1, stone: 1 };

  const muted = () => typeof sfx === 'function' && sfx.muted === true;
  const running = () => !!ctx && ctx.state === 'running';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = Math.random, rr = (a, b) => a + (b - a) * rnd();

  // ---- the context: created by the first gesture (autoplay policy), resumed, then everything waiting is applied ----
  function unlock() {
    try {
      if (ctx && ctx.state === 'running') return;                     // nothing to do: every later click and key comes through here
      if (!ctx) {
        ctx = new AC(); st.nodes++;
        master = gain(muted() ? 0 : VOLUME);
        const comp = ctx.createDynamicsCompressor(); st.nodes++;       // many voices at once (a big fight) must not clip
        comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
        master.connect(comp); comp.connect(ctx.destination);
        setInterval(() => { if (master) master.gain.setTargetAtTime(muted() ? 0 : VOLUME, ctx.currentTime, 0.05); }, 400);
      }
      if (ctx.state !== 'running') ctx.resume().then(sync, noop); else sync();   // 'suspended', or 'interrupted' on iOS
    } catch (e) { ctx = null; api.failed = true; note('unlock', e); }   // no audio device: the glue stops asking for a click
  }
  // pointerdown / touchstart may create the context, but some browsers only let a click, a key or the end of a touch resume it: listen to all of them
  if (typeof document !== 'undefined') ['pointerdown', 'keydown', 'touchstart', 'click', 'pointerup', 'touchend'].forEach((ev) => document.addEventListener(ev, unlock, { passive: true }));
  function note(what, e) { if (st.errors.length < 20) st.errors.push(what + ': ' + (e && e.message ? e.message : e)); }

  // ---- node factories (every node is counted: stats.nodes) ----
  function gain(v) { st.nodes++; const g = ctx.createGain(); if (v != null) g.gain.value = v; return g; }
  function biq(type, f, q) { st.nodes++; const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q == null ? 1 : q; return b; }
  function osc(type, f) { st.nodes++; const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  function getNoise() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  function noise(loop) { st.nodes++; const s = ctx.createBufferSource(); s.buffer = getNoise(); s.loop = loop !== false; return s; }
  function panner(p) { if (!ctx.createStereoPanner) return null; st.nodes++; const n = ctx.createStereoPanner(); n.pan.value = p; return n; }
  function track(node) { busy++; node.onended = () => { busy--; }; }

  // Oscillator with a pitch path [[dt, hz], ...], attack, exponential decay, optional filter ['type', hz, q].
  function voice(out, type, path, t, dur, peak, filter, att) {
    const o = osc(type, path[0][1]), g = gain(0.0001);
    o.frequency.setValueAtTime(path[0][1], t);
    for (let i = 1; i < path.length; i++) o.frequency.exponentialRampToValueAtTime(path[i][1], t + Math.max(path[i][0], 0.001));
    const a = att || Math.min(0.02, dur / 4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let src = o;
    if (filter) { const f = biq(filter[0], filter[1], filter[2]); o.connect(f); src = f; }
    src.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05); track(o);
  }
  // Filtered noise burst; f2 slides the cutoff (0 = no slide), att = attack seconds.
  function hiss(out, t, dur, peak, type, f1, f2, q, att) {
    const s = noise(true), f = biq(type, f1, q), g = gain(0.0001);
    f.frequency.setValueAtTime(f1, t);
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (att || 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, rnd() * 1.2); s.stop(t + dur + 0.05); track(s);
  }

  // ---------------------------------------------------------------- one-shots: (t = start time, o = the node to connect to)
  const SOUNDS = {
    clash(t, o) {                     // steel on steel: a hard noise tick, two inharmonic ringing partials, a thud
      const k = rr(0.9, 1.1);
      hiss(o, t, 0.09, 0.3, 'highpass', 2600 * k, 1400, 0.8, 0.003);
      voice(o, 'square', [[0, 1480 * k], [0.05, 1180 * k]], t, 0.14, 0.07, ['bandpass', 1900, 5]);
      voice(o, 'triangle', [[0, 2330 * k], [0.12, 2200 * k]], t, 0.2, 0.05, ['highpass', 1600]);
      voice(o, 'sine', [[0, 200 * k], [0.06, 90]], t, 0.12, 0.2);
    },
    arrow(t, o) {                     // a whoosh that rises, and the twang of the string
      hiss(o, t, 0.26, 0.16, 'bandpass', 800, 3400, 0.9, 0.05);
      voice(o, 'triangle', [[0, 480], [0.16, 190]], t, 0.24, 0.14);
      voice(o, 'sine', [[0, 960], [0.1, 380]], t, 0.16, 0.05);
    },
    horn(t, o) {                      // a war horn: stacked, slowly swelling sawtooths with a little bend
      [[146.8, 0.15], [220, 0.1], [293.7, 0.06]].forEach(([f, v]) => voice(o, 'sawtooth', [[0, f * 0.94], [0.18, f], [0.8, f * 0.985]], t, 0.95, v, ['lowpass', 820, 1.2], 0.14));
      hiss(o, t, 0.9, 0.04, 'bandpass', 500, 700, 1.0, 0.2);
    },
    alarm(t, o) {                     // an urgent signal, twice: low note, then the high one
      for (let i = 0; i < 2; i++) {
        voice(o, 'sawtooth', [[0, 392]], t + i * 0.55, 0.18, 0.12, ['lowpass', 1500, 1.5]);
        voice(o, 'sawtooth', [[0, 523.25]], t + i * 0.55 + 0.2, 0.3, 0.14, ['lowpass', 1500, 1.5]);
      }
    },
    hammer(t, o) {                    // three wooden knocks
      [0, 0.19, 0.4].forEach((d, i) => {
        voice(o, 'square', [[0, 430 - i * 30], [0.05, 180]], t + d, 0.09, 0.2, ['bandpass', 650, 2]);
        hiss(o, t + d, 0.05, 0.2, 'bandpass', 1300, 600, 1.3, 0.003);
      });
    },
    chop(t, o) {                      // two axe hits, the creak of the trunk, a rustle of leaves and the thud
      [0, 0.28].forEach((d, i) => {
        voice(o, 'sine', [[0, 240 - i * 30], [0.06, 85]], t + d, 0.13, 0.32);
        hiss(o, t + d, 0.06, 0.2, 'bandpass', 1500, 700, 1.4, 0.003);
      });
      voice(o, 'sawtooth', [[0, 120], [0.35, 180], [0.7, 90]], t + 0.55, 0.75, 0.04, ['bandpass', 600, 6]);
      hiss(o, t + 0.8, 0.5, 0.12, 'lowpass', 1800, 300, 0.8, 0.08);
      voice(o, 'sine', [[0, 80], [0.25, 40]], t + 1.1, 0.35, 0.4);
    },
    stone(t, o) {                     // a mason's chisel: bright chinks and gravel
      [0, 0.2, 0.37].forEach((d, i) => {
        voice(o, 'triangle', [[0, 2100 + i * 260], [0.04, 1400]], t + d, 0.12, 0.12, ['highpass', 900]);
        hiss(o, t + d, 0.05, 0.14, 'highpass', 3500, 2000, 0.9, 0.002);
        voice(o, 'sine', [[0, 300], [0.05, 150]], t + d, 0.08, 0.15);
      });
    },
    crackle(t, o) {                   // fire catches: a whoomph, then pops and a flickering bed
      hiss(o, t, 0.5, 0.18, 'lowpass', 500, 2200, 0.8, 0.12);
      for (let i = 0; i < 16; i++) hiss(o, t + 0.05 + rnd() * 1.3, 0.012 + rnd() * 0.02, 0.1 + rnd() * 0.18, 'highpass', 1500 + rnd() * 2500, 0, 0.9, 0.001);
      hiss(o, t + 0.1, 1.3, 0.05, 'bandpass', 700, 500, 0.5, 0.2);
    },
    collapse(t, o) {                  // a building falls: a rumble, a deep boom and a rain of timbers
      hiss(o, t, 1.6, 0.4, 'lowpass', 900, 60, 0.9, 0.05);
      voice(o, 'sine', [[0, 90], [1.2, 32]], t, 1.4, 0.5);
      for (let i = 0; i < 9; i++) {
        const d = i * 0.09 + rnd() * 0.05;
        hiss(o, t + d, 0.1, 0.18, 'bandpass', 700 + rnd() * 1600, 400, 1.2, 0.004);
        voice(o, 'square', [[0, 180 + rnd() * 200], [0.06, 90]], t + d, 0.1, 0.07, ['lowpass', 600]);
      }
    },
    bell(t, o) {                      // a crossing is free: one deep bell stroke with a slow beating decay
      const f0 = 392;
      [[1, 0.26, 2.6], [1.004, 0.2, 2.4], [2.0, 0.14, 1.7], [2.76, 0.1, 1.2], [4.07, 0.05, 0.7], [5.4, 0.03, 0.4]].forEach(([m, v, d]) => voice(o, 'sine', [[0, f0 * m]], t, d, v));
      hiss(o, t, 0.05, 0.1, 'highpass', 3000, 0, 0.8, 0.002);
    },
    splash(t, o) {
      const k = rr(0.85, 1.15);
      hiss(o, t, 0.45, 0.28, 'bandpass', 1500 * k, 450, 0.8);
      hiss(o, t + 0.05, 0.3, 0.14, 'highpass', 3000, 1500, 0.7);
    },
    cheer(t, o) {                     // a crowd: swelling bands of noise, shouts, a patter of applause
      [[600, 0.1, 0], [1000, 0.12, 0.1], [1700, 0.06, 0.2]].forEach(([f, v, d]) => hiss(o, t + d, 2.2, v, 'bandpass', f, f * 1.15, 1.2, 0.5));
      for (let i = 0; i < 6; i++) voice(o, 'sawtooth', [[0, 300 + rnd() * 120], [0.25, 420 + rnd() * 120]], t + 0.2 + i * 0.18, 0.3, 0.025, ['bandpass', 1100, 2]);
      for (let i = 0; i < 14; i++) hiss(o, t + 0.6 + rnd() * 1.4, 0.03, 0.1, 'bandpass', 1800 + rnd() * 1800, 0, 1, 0.001);
    },
    fanfare(t, o) {                   // brass: three short notes and a long one
      [[392, 0, 0.16], [523.25, 0.17, 0.16], [659.25, 0.34, 0.16], [783.99, 0.52, 0.95]].forEach(([f, d, len]) => {
        voice(o, 'sawtooth', [[0, f]], t + d, len, 0.11, ['lowpass', 1700, 0.8], 0.02);
        voice(o, 'square', [[0, f * 1.005]], t + d, len, 0.05, ['lowpass', 1300], 0.02);
        voice(o, 'sawtooth', [[0, f * 0.5]], t + d, len, 0.06, ['lowpass', 700], 0.02);
      });
    },
    chime(t, o) {                     // a pact: four bright bell notes going up
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        voice(o, 'sine', [[0, f]], t + i * 0.12, 0.9, 0.18);
        voice(o, 'sine', [[0, f * 2.01]], t + i * 0.12, 0.4, 0.05);
      });
    },
    sting(t, o) {                     // betrayal: a dark, dissonant stab with a falling pitch
      voice(o, 'sawtooth', [[0, 110], [0.7, 98]], t, 0.8, 0.14, ['lowpass', 700]);
      voice(o, 'sawtooth', [[0, 155.6], [0.7, 140]], t, 0.8, 0.12, ['lowpass', 700]);
      voice(o, 'square', [[0, 233], [0.6, 207]], t + 0.02, 0.6, 0.05, ['lowpass', 900]);
      hiss(o, t, 0.25, 0.2, 'bandpass', 900, 300, 1.2, 0.005);
      voice(o, 'sine', [[0, 60], [0.5, 35]], t, 0.6, 0.35);
    }
  };

  // ---------------------------------------------------------------- ambience layers
  const MOODS = {      // layer levels (gain); birds is a factor for the chirp rate, drums the base level of the distant drum bed
    calm:   { river: 0.05, babble: 0.018, wind: 0.012, rush: 0,    rumble: 0,    birds: 1, drums: 0 },
    flood:  { river: 0.025, babble: 0,    wind: 0.03,  rush: 0.11, rumble: 0.09, birds: 0, drums: 0 },
    battle: { river: 0.02, babble: 0,     wind: 0.022, rush: 0,    rumble: 0.02, birds: 0, drums: 0.35 }
  };
  function layer(out, srcNode, ftype, f, q, g0) { const f2 = biq(ftype, f, q), g = gain(g0 || 0); srcNode.connect(f2); f2.connect(g); g.connect(out); return { f: f2, g }; }
  function lfo(rate, depth, target) { const o = osc('sine', rate), g = gain(depth); o.connect(g); g.connect(target); return o; }
  function buildAmbience() {
    const out = gain(0); out.connect(master);
    const nodes = [], start = (n) => { nodes.push(n); return n; };
    const nz = () => start(noise(true));
    const river = layer(out, nz(), 'bandpass', 650, 0.45), babble = layer(out, nz(), 'highpass', 2600, 0.7), wind = layer(out, nz(), 'bandpass', 420, 0.6);
    const rush = layer(out, nz(), 'lowpass', 1100, 0.7), roar = layer(out, nz(), 'bandpass', 260, 0.5), rumbleN = layer(out, nz(), 'lowpass', 90, 0.8);
    const rumble = gain(0); rumble.connect(out);
    [41, 43.7].forEach((f) => { const o = start(osc('sine', f)); o.connect(rumble); });
    start(lfo(0.17, 220, river.f.frequency)); start(lfo(0.11, 140, wind.f.frequency)); start(lfo(0.9, 0.006, babble.g.gain)); start(lfo(0.08, 0.015, rush.g.gain));
    nodes.forEach((n) => n.start(0));
    // the chirps and the drums are scheduled from timers, into their own buses
    const birdBus = gain(0); birdBus.connect(out);
    const drumBus = gain(0); drumBus.connect(master);
    return { out, river, babble, wind, rush, roar, rumbleN, rumble, birdBus, drumBus, nodes, birds: 0, drums: 0 };
  }
  function applyAmbience() {
    const t = ctx.currentTime, mood = MOODS[want.mood];
    if (!mood) {
      if (amb) {
        const a = amb; a.birds = 0; a.drums = 0;
        a.out.gain.setTargetAtTime(0, t, 0.6);                    // fade out, then free the nodes (the drum bus keeps following battle())
        clearTimeout(ambTimer);
        ambTimer = setTimeout(() => { a.nodes.forEach((n) => { try { n.stop(); } catch (e) { /* stopped */ } }); try { a.out.disconnect(); } catch (e) { /* gone */ } if (amb === a && !want.mood && want.battle < 0.02) amb = null; }, 4000);
      }
      applyBattle(); return;
    }
    if (!amb) { clearTimeout(ambTimer); amb = buildAmbience(); amb.out.gain.value = 0; }
    amb.out.gain.setTargetAtTime(1, t, 0.8);
    const k = 1.1;                                                // soft ~3 s crossfades
    amb.river.g.gain.setTargetAtTime(mood.river, t, k); amb.babble.g.gain.setTargetAtTime(mood.babble, t, k); amb.wind.g.gain.setTargetAtTime(mood.wind, t, k);
    amb.rush.g.gain.setTargetAtTime(mood.rush, t, k); amb.roar.g.gain.setTargetAtTime(mood.rush * 0.8, t, k);
    amb.rumble.gain.setTargetAtTime(mood.rumble, t, k); amb.rumbleN.g.gain.setTargetAtTime(mood.rumble * 1.6, t, k);
    amb.birds = mood.birds;
    if (mood.birds > 0 && !birdTimer) birdTimer = setInterval(birdTick, 650);
    if (mood.birds <= 0 && birdTimer) { clearInterval(birdTimer); birdTimer = null; }
    applyBattle();
  }

  // birds: short phrases of sine whistles, panned around
  function chirp(out, t, f0, f1, dur, vol, pan) {
    const o = osc('sine', f0), g = gain(0.0001), p = panner(pan);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); if (p) { g.connect(p); p.connect(out); } else g.connect(out);
    o.start(t); o.stop(t + dur + 0.03); track(o);
  }
  function birdTick() {
    if (!running() || !amb || !(amb.birds > 0) || muted() || rnd() > 0.5 * amb.birds) return;
    const t = ctx.currentTime + 0.02, pan = rr(-0.8, 0.8), out = amb.birdBus, sp = Math.floor(rnd() * 4), base = rr(2600, 3800);
    amb.birdBus.gain.setTargetAtTime(0.05, t, 0.3);
    if (sp === 0) for (let i = 0; i < 3; i++) chirp(out, t + i * 0.11, base + i * 220, base + i * 220 + 380, 0.1, 0.5, pan);                  // a rising whistle
    else if (sp === 1) for (let i = 0; i < 4; i++) chirp(out, t + i * 0.09, base, base * 0.9, 0.06, 0.45, pan);                                // tsi-tsi-tsi-tsi
    else if (sp === 2) for (let i = 0; i < 9; i++) chirp(out, t + i * 0.035, base + (i & 1 ? 260 : -260), base + (i & 1 ? 200 : -200), 0.028, 0.35, pan);   // a trill
    else chirp(out, t, base * 1.25, base * 0.8, 0.3, 0.5, pan);                                                                               // a falling slur
  }

  // ---- the battle layer: war drums on a timer (lookahead scheduling) + random clashes and shouts, all following `want.battle` ----
  const KICK = [1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0], TOM = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1], RIM = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0];
  function drumHit(bus, t, kind, v) {
    if (kind === 0) { voice(bus, 'sine', [[0, 125], [0.12, 50]], t, 0.45, 0.9 * v); hiss(bus, t, 0.08, 0.4 * v, 'lowpass', 240, 0, 0.7, 0.002); }
    else if (kind === 1) { voice(bus, 'sine', [[0, 200], [0.1, 98]], t, 0.28, 0.5 * v); hiss(bus, t, 0.05, 0.15 * v, 'lowpass', 500, 0, 0.7, 0.002); }
    else hiss(bus, t, 0.05, 0.22 * v, 'bandpass', 1900, 0, 1.5, 0.001);
  }
  function drumTick() {
    if (!running() || !amb) return;
    const lv = want.battle, base = MOODS[want.mood] ? MOODS[want.mood].drums : 0, eff = Math.max(base * 0.3, lv);
    if (muted() || (lv < 0.02 && base <= 0)) return;
    const bus = amb.drumBus, now = ctx.currentTime, bpm = 76 + 50 * eff, stepT = 60 / bpm / 2;
    if (drumNext < now) { drumNext = now + 0.05; drumStep = 0; }
    while (drumNext < now + 0.14) {
      const s = drumStep % 16, v = 0.75 + 0.25 * rnd();
      if (KICK[s]) drumHit(bus, drumNext, 0, v);
      if (TOM[s] && eff > 0.35) drumHit(bus, drumNext, 1, v);
      if (RIM[s] && eff > 0.65) drumHit(bus, drumNext, 2, v);
      drumNext += stepT; drumStep++;
    }
    if (lv > 0.12 && rnd() < lv * 0.11) SOUNDS.clash(now + 0.01, amb.clashBus || (amb.clashBus = (() => { const g = gain(0.4); g.connect(master); return g; })()));
    if (lv > 0.25 && rnd() < lv * 0.012) hiss(amb.clashBus || master, now + 0.01, 0.5, 0.1, 'bandpass', rr(450, 900), 0, 1.1, 0.12);      // a shout from the lines
  }
  function applyBattle() {
    if (!amb && want.battle >= 0.02) { amb = buildAmbience(); amb.out.gain.value = 0; }      // the battle layer also runs without a mood
    if (!amb) return;
    const t = ctx.currentTime, mood = MOODS[want.mood], base = mood ? mood.drums : 0, lv = want.battle;
    amb.drumBus.gain.setTargetAtTime(clamp(base * 0.22 + lv * 0.35, 0, 0.7), t, 0.4);
    if (amb.clashBus) amb.clashBus.gain.setTargetAtTime(0.15 + 0.35 * lv, t, 0.4);
    const need = lv >= 0.02 || base > 0;
    if (need && !drumTimer) { drumNext = 0; drumTimer = setInterval(drumTick, 30); }
    if (!need && drumTimer) { clearInterval(drumTimer); drumTimer = null; }
  }

  // ---------------------------------------------------------------- the public API
  function sync() {
    if (!running()) return;
    try {
      applyAmbience();
      const now = Date.now();
      while (queue.length) { const q = queue.shift(); if (now - q.at < 1500) run(q.name, q.vol); }
      st.queued = 0;
    } catch (e) { note('sync', e); }
  }
  function run(name, vol) {
    let out = master;
    if (vol != null && Math.abs(vol - 1) > 0.02) { out = gain(clamp(vol, 0, 2)); out.connect(master); }
    SOUNDS[name](ctx.currentTime + 0.005, out);
    st.plays++;
  }
  api.supported = true;
  api.unlock = unlock;
  api.state = () => (ctx ? ctx.state : 'none');
  api.play = function (name, opts) {
    if (!SOUNDS[name] || muted()) return;
    const vol = opts && opts.vol != null ? +opts.vol : 1;
    if (!running()) {      // no gesture yet: remember the last few for the unlock
      queue.push({ name, vol, at: Date.now() }); if (queue.length > 6) queue.shift(); st.queued = queue.length; return;
    }
    const now = ctx.currentTime, gap = MIN_GAP[name] != null ? MIN_GAP[name] : DEF_GAP;
    if (!(opts && opts.force)) {      // force: the dev harness plays every name regardless of the rules below
      if (lastAt[name] != null && now - lastAt[name] < gap) return;
      if (busy > 90 && LOW_PRIO[name]) return;                 // a big fight: the small sounds give way
    }
    lastAt[name] = now;
    try { run(name, vol); } catch (e) { note(name, e); }
  };
  api._tick = function () { try { birdTick(); drumTick(); } catch (e) { note('tick', e); } };      // test hook: one pass of the timers (birds, drums, clashes)
  api.ambience = function (mood) {
    const m = MOODS[mood] ? mood : null;
    if (m === want.mood) return;
    want.mood = m;
    if (running()) try { applyAmbience(); } catch (e) { note('ambience', e); }
  };
  api.battle = function (level) {
    const lv = clamp(+level || 0, 0, 1);
    if (Math.abs(lv - want.battle) < 0.01 && (lv === 0) === (want.battle === 0)) return;      // called every frame: skip no-ops
    want.battle = lv;
    if (running()) try { applyBattle(); } catch (e) { note('battle', e); }
  };
  // sim events -> sounds: [name, volume, min gap in s, optional shared key for the gap]; one table, so the glue does not need its own switch.
  // `buildDone` is not here on purpose: the phone's toast says a building is finished (a chime on every one was too much).
  const EV = {
    shot: ['arrow', 0.5, 0.09], clash: ['clash', 0.55, 0.07], hit: ['clash', 0.28, 0.1], order: ['horn', 0.8, 1.2], attack: ['alarm', 0.9, 4], lastMinute: ['alarm', 0.8, 5],
    build: ['hammer', 0.25, 2, 'hammer'], rebuild: ['hammer', 0.25, 2, 'hammer'], chop: ['chop', 0.6, 0.4], harvest: ['stone', 0.3, 1.2], ignite: ['crackle', 0.7, 0.6],
    cropBurnt: ['crackle', 0.5, 0.8], ruined: ['collapse', 1, 0.5], fireOut: ['splash', 0.7, 0.5], bucket: ['splash', 0.35, 0.3], crossingOpen: ['bell', 0.9, 1],
    plunder: ['cheer', 1, 2], pactOn: ['chime', 0.9, 1], crown: ['fanfare', 0.55, 2], fehde: ['horn', 1, 5], over: ['fanfare', 1, 5], protEnd: ['chime', 0.4, 1]
  };
  const evAt = {};
  api.event = function (ev, opts) {
    if (!ev || !ev.t) return;
    let m = EV[ev.t];
    if (ev.t === 'pactOff') m = ev.reason === 'broken' ? ['sting', 1, 2] : null;
    if (!m) return;
    const force = !!(opts && opts.force), now = Date.now() / 1000, key = m[3] || ev.t;
    if (!force && evAt[key] != null && now - evAt[key] < m[2]) return;
    evAt[key] = now;
    api.play(m[0], { vol: m[1], force });
  };
})();
