(function () {
  'use strict';
  class Sound {
    constructor() {
      this.ctx = null; this.muted = false; this.lastStep = 0; this.arm = () => this.unlock();
      ['pointerdown', 'keydown'].forEach(type => document.addEventListener(type, this.arm));
    }
    unlock() { try { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); } catch (_) {} }
    tone(freq, duration, volume, type = 'sine') {
      if (!this.ctx || this.muted) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, c.currentTime); o.frequency.exponentialRampToValueAtTime(freq * 0.4, c.currentTime + duration);
      g.gain.setValueAtTime(volume, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + duration);
    }
    shot(near, weapon = 'rifle') {
      const profiles = { rifle: [120, 0.11], smg: [175, 0.075], pistol: [190, 0.09], shotgun: [65, 0.21], marksman: [90, 0.15], sniper: [55, 0.25], lmg: [95, 0.13], burst: [160, 0.08], carbine: [145, 0.09], revolver: [75, 0.18] }, [pitch, duration] = profiles[weapon] || profiles.rifle;
      if (!this.ctx || this.muted) return; const c = this.ctx, n = Math.floor(c.sampleRate * duration), b = c.createBuffer(1, n, c.sampleRate), a = b.getChannelData(0);
      for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      const source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain(); source.buffer = b; filter.type = 'lowpass'; filter.frequency.value = near ? 2600 : 1000; gain.gain.value = near ? 0.24 : 0.05;
      source.connect(filter); filter.connect(gain); gain.connect(c.destination); source.start(); this.tone(near ? pitch : pitch * 0.7, duration, near ? 0.13 : 0.02, 'triangle');
    }
    events(events, id) {
      const own = actorId => Array.isArray(id) ? id.includes(actorId) : actorId === id;
      for (const e of events) {
        if (e.type === 'shot' && e.audible !== false) this.shot(own(e.id), e.weapon);
        if (e.type === 'loaded' && own(e.id)) this.tone(620, 0.045, 0.04, 'triangle');
        if (e.type === 'hit' && own(e.id)) this.tone(e.headshot ? 1300 : 900, 0.07, 0.035);
        if (e.type === 'reload' && own(e.id)) this.tone(260, 0.12, 0.08, 'square');
        if (e.type === 'plant') this.tone(900, 0.4, 0.05);
        if (e.type === 'live') this.tone(600, 0.25, 0.07);
        if (e.type === 'advance') this.tone(1050, 0.22, 0.05, 'triangle');
        if (e.type === 'capture') this.tone(750, 0.35, 0.05, 'triangle');
        if (e.type === 'detonate') { this.shot(true); this.tone(60, 1.2, 0.2, 'sawtooth'); }
        if (e.type === 'result') this.tone(420, 0.6, 0.08, 'triangle');
      }
    }
    dispose() { ['pointerdown', 'keydown'].forEach(type => document.removeEventListener(type, this.arm)); if (this.ctx) this.ctx.close().catch(() => {}); }
  }
  window.BreachSound = Sound;
})();
