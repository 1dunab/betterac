// Party Hub Sound-Engine: winziger WebAudio-Synth, keine Audio-Dateien.
// Nur auf der Screen-Seite geladen — der TV ist die Soundanlage des Abends.
//
// API (Palette: siehe games/README.md):
//   sfx('explosion')        Einmal-Sound abspielen
//   sfx.ambient('wind')     Ambient-Loop starten (ersetzt einen laufenden)
//   sfx.ambient(null)       Ambient stoppen (macht die Shell bei Spielende)
//   sfx.setMuted(bool)      global stumm (persistiert), sfx.muted zum Lesen
//
// Browser-Autoplay-Policy: der AudioContext läuft erst nach der ersten
// Nutzer-Geste auf DIESER Seite (Klick/Taste, z.B. der ⛶- oder 🔊-Button).
// Ein vorher gewünschter Ambient-Loop wird gemerkt und dann nachgestartet.
// Ohne AudioContext (JSDOM, alte Browser) ist alles ein stiller No-Op.
(function () {
  'use strict';
  const AC = window.AudioContext || window.webkitAudioContext;
  const noop = function () {};
  if (!AC) {
    const stub = noop;
    stub.ambient = noop; stub.setMuted = noop; stub.muted = false;
    window.sfx = stub;
    return;
  }

  let ctx = null, master = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('sfxMuted') === '1'; } catch (e) {}
  let ambientStop = null, pendingAmbient = null;

  function ensureCtx() {
    if (ctx) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
  }
  const running = () => ctx && ctx.state === 'running';

  // Erst eine Geste auf der Seite schaltet Audio frei (Autoplay-Policy)
  function arm() {
    ensureCtx();
    if (ctx.state === 'suspended') ctx.resume();
    if (running() && pendingAmbient) { const a = pendingAmbient; pendingAmbient = null; sfx.ambient(a); }
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, arm));

  // --- Bausteine ---
  function getNoise() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  // Ton mit Attack/Decay-Hüllkurve; f2 = optionales Pitch-Gleiten
  function tone(type, f1, f2, t, dur, peak) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f1, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // Rausch-Impuls durch Filter (Explosionen, Treffer, Wasser)
  function burst(t, dur, peak, filterType, f1, f2) {
    const s = ctx.createBufferSource(); s.buffer = getNoise(); s.loop = true;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = filterType; f.frequency.setValueAtTime(f1, t);
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.05);
  }

  // --- Palette (Namen sind API — siehe games/README.md) ---
  const SOUNDS = {
    pop:       (t) => tone('sine', 520, 180, t, 0.10, 0.35),               // Spieler-Join, UI-Blubb
    tick:      (t) => tone('square', 1900, 0, t, 0.03, 0.10),              // Auswahl, leiser Klick
    beep:      (t) => tone('sine', 660, 0, t, 0.12, 0.30),                 // Countdown-Schlag
    go:        (t) => { tone('sine', 990, 0, t, 0.35, 0.35); tone('square', 990, 0, t, 0.18, 0.08); }, // Startsignal
    coin:      (t) => { tone('square', 880, 0, t, 0.07, 0.18); tone('square', 1320, 0, t + 0.08, 0.12, 0.18); }, // Punkt/Erfolg
    powerup:   (t) => tone('sine', 300, 950, t, 0.30, 0.30),               // Aufsteigender Sweep
    buzz:      (t) => tone('sawtooth', 110, 90, t, 0.25, 0.25),            // Fehler/Frühstart
    hit:       (t) => burst(t, 0.09, 0.35, 'bandpass', 900, 500),          // Einschlag klein
    thud:      (t) => { tone('sine', 95, 40, t, 0.16, 0.5); burst(t, 0.08, 0.2, 'lowpass', 300, 120); }, // Aufprall dumpf
    splash:    (t) => burst(t, 0.35, 0.3, 'bandpass', 1400, 500),          // Wasser
    whoosh:    (t) => burst(t, 0.4, 0.25, 'bandpass', 300, 2600),          // Spielstart, Flug
    explosion: (t) => { burst(t, 0.7, 0.8, 'lowpass', 3200, 90); tone('sine', 110, 38, t, 0.5, 0.6); },
    fanfare:   (t) => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
                   tone('triangle', f, 0, t + i * 0.13, i === 3 ? 0.6 : 0.16, 0.30)); },
    sad:       (t) => { tone('triangle', 392, 0, t, 0.22, 0.25); tone('triangle', 311, 0, t + 0.24, 0.5, 0.25); },
  };

  // --- Ambient-Loops: laufen bis ersetzt/gestoppt, jeder gibt stop() zurück ---
  function lfo(target, freq, depth, base) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; g.gain.value = depth;
    target.value = base;
    o.connect(g); g.connect(target); o.start();
    return () => { o.stop(); };
  }
  const AMBIENTS = {
    wind: () => {   // Wetter draußen (Sintflut & Co.)
      const s = ctx.createBufferSource(); s.buffer = getNoise(); s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      const g = ctx.createGain(); g.gain.value = 0.05;
      const stopL = lfo(f.frequency, 0.13, 230, 460);
      s.connect(f); f.connect(g); g.connect(master); s.start();
      return () => { s.stop(); stopL(); };
    },
    drone: () => {  // Bedrohlich tief (Boss Raid)
      const os = [55, 55.7].map(fr => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; return o; });
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 190;
      const g = ctx.createGain();
      const stopL = lfo(g.gain, 0.09, 0.014, 0.035);
      os.forEach(o => { o.connect(f); o.start(); });
      f.connect(g); g.connect(master);
      return () => { os.forEach(o => o.stop()); stopL(); };
    },
    space: () => {  // Weiter, leerer Raum (Arena, Racer)
      const os = [110, 165].map(fr => { const o = ctx.createOscillator(); o.frequency.value = fr; return o; });
      const g = ctx.createGain();
      const stopL = lfo(g.gain, 0.2, 0.012, 0.028);
      os.forEach(o => { o.connect(g); o.start(); });
      g.connect(master);
      return () => { os.forEach(o => o.stop()); stopL(); };
    },
    rain: () => {   // Prasseln (Regen-Events)
      const s = ctx.createBufferSource(); s.buffer = getNoise(); s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3600;
      const g = ctx.createGain(); g.gain.value = 0.030;
      s.connect(f); f.connect(g); g.connect(master); s.start();
      return () => { s.stop(); };
    },
  };

  function sfx(name) {
    if (muted || !SOUNDS[name]) return;
    ensureCtx();
    if (!running()) return; // noch keine Geste — Einmal-Sound einfach fallenlassen
    try { SOUNDS[name](ctx.currentTime); } catch (e) {}
  }
  sfx.ambient = function (name) {
    if (ambientStop) { try { ambientStop(); } catch (e) {} ambientStop = null; }
    pendingAmbient = null;
    if (!name || !AMBIENTS[name]) return;
    ensureCtx();
    if (!running()) { pendingAmbient = name; return; } // nach der ersten Geste nachholen
    try { ambientStop = AMBIENTS[name](); } catch (e) {}
  };
  sfx.setMuted = function (m) {
    muted = !!m;
    sfx.muted = muted;
    try { localStorage.setItem('sfxMuted', muted ? '1' : '0'); } catch (e) {}
    if (master) master.gain.value = muted ? 0 : 0.6;
  };
  sfx.muted = muted;
  window.sfx = sfx;
})();
