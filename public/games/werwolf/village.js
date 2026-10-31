// Werwolfnacht — the village scene (2D canvas, procedural) -> window.WerwolfVillage
// Static layers are cached in offscreen canvases; only light, fire, smoke, fog, eyes, badges
// and vote arrows are redrawn per frame. Logical size is 960x600 (scaled if width/height differ).
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

  // ---- colour helpers -------------------------------------------------------------------
  let _tmp = null;
  function parseColor(col) {
    try {
      if (!_tmp) _tmp = mk(1, 1).getContext('2d');
      _tmp.fillStyle = '#c8c8c8';
      _tmp.fillStyle = String(col);
      const f = _tmp.fillStyle;
      if (f[0] === '#') {
        return [parseInt(f.slice(1, 3), 16), parseInt(f.slice(3, 5), 16), parseInt(f.slice(5, 7), 16)];
      }
      const m = f.match(/[\d.]+/g);
      if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
    } catch (e) { /* ignore */ }
    return [200, 200, 200];
  }
  // palette modes: mul = per-channel multiplier (night is bluish and dark), gray = desaturation 0..1
  const M_DAY = { mul: [1, 1, 1], gray: 0, night: false };
  const M_NIGHT = { mul: [0.30, 0.38, 0.66], gray: 0, night: true };
  const M_DEAD_DAY = { mul: [0.62, 0.6, 0.6], gray: 0.75, night: false, dead: true };
  const M_DEAD_NIGHT = { mul: [0.22, 0.26, 0.4], gray: 0.8, night: true, dead: true };
  function C(m, r, g, b, a) {
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    r = lerp(r, l, m.gray); g = lerp(g, l, m.gray); b = lerp(b, l, m.gray);
    r = Math.round(clamp(r * m.mul[0], 0, 255)); g = Math.round(clamp(g * m.mul[1], 0, 255)); b = Math.round(clamp(b * m.mul[2], 0, 255));
    return a == null || a === 1 ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  // ---- glow sprites ---------------------------------------------------------------------
  const glowCache = {};
  function glowSprite(r, g, b) {
    const key = r + ',' + g + ',' + b;
    if (glowCache[key]) return glowCache[key];
    const c = mk(64, 64), x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(' + key + ',1)');
    gr.addColorStop(0.3, 'rgba(' + key + ',0.5)');
    gr.addColorStop(0.65, 'rgba(' + key + ',0.14)');
    gr.addColorStop(1, 'rgba(' + key + ',0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return (glowCache[key] = c);
  }
  function drawGlow(ctx, spr, x, y, rx, ry, a) {
    if (a <= 0.003) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(spr, x - rx, y - ry, rx * 2, ry * 2);
  }

  // ---- role data & emblems --------------------------------------------------------------
  const ROLE_NAME = { wolf: 'Werwolf', villager: 'Dorfbewohner', seer: 'Seherin', guard: 'Beschützer', cupid: 'Amor', witch: 'Hexe', hunter: 'Jäger' };
  const ROLE_COLOR = { wolf: '#c9d0e4', villager: '#f0cf6a', seer: '#c49bff', guard: '#6aa6ff', cupid: '#ff6f9e', witch: '#58e598', hunter: '#d9a15e' };
  const INK = '#12162a';

  function heartPath(g, cx, cy, s) {
    g.beginPath();
    g.moveTo(cx, cy + s * 0.9);
    g.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.9, cy - s * 1.1, cx, cy - s * 0.4);
    g.bezierCurveTo(cx + s * 0.9, cy - s * 1.1, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.9);
    g.closePath();
  }

  const ART = {
    wolf(g) {
      // ears
      g.fillStyle = '#8a93ad';
      for (const sx of [-1, 1]) {
        g.beginPath(); g.moveTo(sx * 0.82, -0.12); g.lineTo(sx * 0.66, -0.98); g.lineTo(sx * 0.16, -0.58); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#e48aa0';
        g.beginPath(); g.moveTo(sx * 0.66, -0.3); g.lineTo(sx * 0.6, -0.76); g.lineTo(sx * 0.32, -0.52); g.closePath(); g.fill();
        g.fillStyle = '#8a93ad';
      }
      // head
      g.fillStyle = '#b4bcd2';
      g.beginPath();
      g.moveTo(0, -0.62);
      g.bezierCurveTo(0.5, -0.62, 0.88, -0.36, 0.9, -0.02);
      g.lineTo(0.66, 0.3); g.lineTo(0.3, 0.52); g.lineTo(0.2, 0.88); g.lineTo(0, 0.96);
      g.lineTo(-0.2, 0.88); g.lineTo(-0.3, 0.52); g.lineTo(-0.66, 0.3); g.lineTo(-0.9, -0.02);
      g.bezierCurveTo(-0.88, -0.36, -0.5, -0.62, 0, -0.62);
      g.closePath(); g.fill(); g.stroke();
      // muzzle
      g.fillStyle = '#e9edf6';
      g.beginPath(); g.moveTo(0, 0.1); g.lineTo(0.34, 0.42); g.lineTo(0.2, 0.84); g.lineTo(0, 0.92); g.lineTo(-0.2, 0.84); g.lineTo(-0.34, 0.42); g.closePath(); g.fill();
      // eyes
      for (const sx of [-1, 1]) {
        g.fillStyle = '#ffd23f';
        g.beginPath(); g.moveTo(sx * 0.14, -0.04); g.quadraticCurveTo(sx * 0.4, -0.3, sx * 0.62, -0.12); g.quadraticCurveTo(sx * 0.4, 0.12, sx * 0.14, -0.04); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = INK;
        g.beginPath(); g.ellipse(sx * 0.4, -0.1, 0.05, 0.1, 0, 0, TAU); g.fill();
      }
      // nose + fangs
      g.fillStyle = INK;
      g.beginPath(); g.ellipse(0, 0.74, 0.13, 0.09, 0, 0, TAU); g.fill();
      g.fillStyle = '#fff';
      for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(sx * 0.1, 0.9); g.lineTo(sx * 0.2, 0.9); g.lineTo(sx * 0.14, 1.04); g.closePath(); g.fill(); g.stroke(); }
    },
    villager(g) {
      // pitchfork behind
      g.strokeStyle = '#6b4a2b'; g.lineWidth = 0.12;
      g.beginPath(); g.moveTo(0.52, 1); g.lineTo(0.8, -0.55); g.stroke();
      g.strokeStyle = '#b9c0cf'; g.lineWidth = 0.09;
      g.beginPath(); g.moveTo(0.62, -0.44); g.lineTo(0.98, -0.44); g.moveTo(0.62, -0.44); g.lineTo(0.6, -0.96); g.moveTo(0.8, -0.5); g.lineTo(0.8, -1); g.moveTo(0.98, -0.44); g.lineTo(1, -0.96); g.stroke();
      g.strokeStyle = INK; g.lineWidth = 0.07;
      // face
      g.fillStyle = '#f2c9a0';
      g.beginPath(); g.arc(-0.1, 0.22, 0.56, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = INK;
      g.beginPath(); g.arc(-0.28, 0.2, 0.06, 0, TAU); g.arc(0.08, 0.2, 0.06, 0, TAU); g.fill();
      g.beginPath(); g.arc(-0.1, 0.38, 0.2, 0.2, Math.PI - 0.2); g.stroke();
      g.fillStyle = '#ee9a8a';
      g.beginPath(); g.arc(-0.42, 0.34, 0.07, 0, TAU); g.arc(0.22, 0.34, 0.07, 0, TAU); g.fill();
      // straw hat
      g.fillStyle = '#ecc65c';
      g.beginPath(); g.moveTo(-0.52, -0.1); g.quadraticCurveTo(-0.5, -0.78, -0.1, -0.78); g.quadraticCurveTo(0.3, -0.78, 0.32, -0.1); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#c4413a';
      g.fillRect(-0.5, -0.24, 0.8, 0.12);
      g.fillStyle = '#f4d77c';
      g.beginPath(); g.ellipse(-0.1, -0.1, 0.92, 0.2, 0, 0, TAU); g.fill(); g.stroke();
    },
    seer(g) {
      // base
      g.fillStyle = '#e0b04c';
      g.beginPath(); g.moveTo(-0.55, 0.62); g.lineTo(0.55, 0.62); g.lineTo(0.38, 0.95); g.lineTo(-0.38, 0.95); g.closePath(); g.fill(); g.stroke();
      // ball
      const gr = g.createRadialGradient(-0.2, -0.3, 0.05, 0, -0.05, 0.75);
      gr.addColorStop(0, '#e6d0ff'); gr.addColorStop(0.45, '#9a63f0'); gr.addColorStop(1, '#4a249d');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, -0.08, 0.7, 0, TAU); g.fill(); g.stroke();
      // star inside
      g.fillStyle = '#ffe58a';
      g.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, r = i % 2 ? 0.07 : 0.24; g.lineTo(0.08 + Math.cos(a) * r, 0.02 + Math.sin(a) * r); }
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath(); g.ellipse(-0.3, -0.38, 0.17, 0.09, -0.7, 0, TAU); g.fill();
      // sparkles
      g.fillStyle = '#fff';
      for (const [x, y, s] of [[0.9, -0.7, 0.12], [-0.92, 0.0, 0.09]]) {
        g.beginPath(); g.moveTo(x, y - s * 1.6); g.lineTo(x + s * 0.4, y - s * 0.4); g.lineTo(x + s * 1.6, y); g.lineTo(x + s * 0.4, y + s * 0.4); g.lineTo(x, y + s * 1.6); g.lineTo(x - s * 0.4, y + s * 0.4); g.lineTo(x - s * 1.6, y); g.lineTo(x - s * 0.4, y - s * 0.4); g.closePath(); g.fill();
      }
    },
    guard(g) {
      const path = (k) => {
        g.beginPath();
        g.moveTo(-0.76 * k, -0.82 * k); g.lineTo(0.76 * k, -0.82 * k); g.lineTo(0.76 * k, 0.08 * k);
        g.bezierCurveTo(0.76 * k, 0.6 * k, 0.3 * k, 0.82 * k, 0, 1.0 * k);
        g.bezierCurveTo(-0.3 * k, 0.82 * k, -0.76 * k, 0.6 * k, -0.76 * k, 0.08 * k);
        g.closePath();
      };
      g.fillStyle = '#e0b04c'; path(1); g.fill(); g.stroke();
      g.fillStyle = '#3a78d6'; path(0.82); g.fill();
      g.fillStyle = '#5b97ee';
      g.beginPath(); g.moveTo(-0.62, -0.68); g.lineTo(0, -0.68); g.lineTo(0, 0.8); g.bezierCurveTo(-0.3, 0.64, -0.62, 0.5, -0.62, 0.08); g.closePath(); g.fill();
      g.fillStyle = '#f5f7ff';
      g.fillRect(-0.11, -0.58, 0.22, 1.2); g.fillRect(-0.45, -0.18, 0.9, 0.22);
    },
    cupid(g) {
      g.fillStyle = '#ff4f87'; heartPath(g, 0, -0.02, 0.62); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.ellipse(-0.42, -0.34, 0.16, 0.09, -0.7, 0, TAU); g.fill();
      // arrow
      g.strokeStyle = INK; g.lineWidth = 0.17; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-0.78, 0.78); g.lineTo(0.62, -0.62); g.stroke();
      g.strokeStyle = '#f0d27a'; g.lineWidth = 0.08;
      g.beginPath(); g.moveTo(-0.78, 0.78); g.lineTo(0.62, -0.62); g.stroke();
      g.lineWidth = 0.07; g.strokeStyle = INK; g.fillStyle = '#d9dfec';
      g.beginPath(); g.moveTo(0.98, -0.98); g.lineTo(0.4, -0.78); g.lineTo(0.78, -0.4); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(-0.84, 0.86); g.lineTo(-0.96, 0.46); g.lineTo(-0.6, 0.6); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-0.7, 0.72); g.lineTo(-0.5, 0.34); g.lineTo(-0.36, 0.6); g.closePath(); g.fill(); g.stroke();
    },
    witch(g) {
      // cork + neck
      g.fillStyle = '#9a6b3a';
      g.beginPath(); g.rect(-0.16, -0.98, 0.32, 0.26); g.fill(); g.stroke();
      g.fillStyle = '#dff3f2';
      g.beginPath(); g.moveTo(-0.2, -0.74); g.lineTo(0.2, -0.74); g.lineTo(0.22, -0.2); g.arc(0, 0.32, 0.72, -1.2, Math.PI + 1.2, true); g.lineTo(-0.22, -0.2); g.closePath(); g.fill(); g.stroke();
      // liquid
      g.save();
      g.beginPath(); g.arc(0, 0.32, 0.64, 0, TAU); g.clip();
      g.fillStyle = '#3ddc84';
      g.beginPath(); g.moveTo(-0.8, 0.12); g.quadraticCurveTo(-0.4, -0.04, 0, 0.12); g.quadraticCurveTo(0.4, 0.28, 0.8, 0.12); g.lineTo(0.8, 1); g.lineTo(-0.8, 1); g.closePath(); g.fill();
      g.fillStyle = '#7dffb0'; g.globalAlpha = 0.6; g.fillRect(-0.8, 0.52, 1.6, 0.14); g.globalAlpha = 1;
      g.restore();
      g.beginPath(); g.moveTo(-0.2, -0.74); g.lineTo(0.2, -0.74); g.lineTo(0.22, -0.2); g.arc(0, 0.32, 0.72, -1.2, Math.PI + 1.2, true); g.lineTo(-0.22, -0.2); g.closePath(); g.stroke();
      // bubbles + glint
      g.fillStyle = '#e8fff2';
      g.beginPath(); g.arc(-0.14, 0.34, 0.07, 0, TAU); g.arc(0.2, 0.5, 0.05, 0, TAU); g.arc(0.06, 0.12, 0.04, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath(); g.ellipse(-0.42, 0.18, 0.06, 0.22, 0.4, 0, TAU); g.fill();
      g.fillStyle = '#c49bff';
      g.beginPath(); g.moveTo(0.78, -0.62); g.lineTo(0.84, -0.46); g.lineTo(1, -0.4); g.lineTo(0.84, -0.34); g.lineTo(0.78, -0.18); g.lineTo(0.72, -0.34); g.lineTo(0.56, -0.4); g.lineTo(0.72, -0.46); g.closePath(); g.fill();
    },
    hunter(g) {
      g.lineCap = 'round';
      // bow
      g.strokeStyle = INK; g.lineWidth = 0.2;
      g.beginPath(); g.moveTo(0.12, -0.98); g.quadraticCurveTo(-1.15, 0, 0.12, 0.98); g.stroke();
      g.strokeStyle = '#a06a34'; g.lineWidth = 0.1;
      g.beginPath(); g.moveTo(0.12, -0.98); g.quadraticCurveTo(-1.15, 0, 0.12, 0.98); g.stroke();
      g.strokeStyle = '#f2ead8'; g.lineWidth = 0.04;
      g.beginPath(); g.moveTo(0.12, -0.98); g.lineTo(-0.2, 0); g.lineTo(0.12, 0.98); g.stroke();
      // arrow
      g.strokeStyle = INK; g.lineWidth = 0.16;
      g.beginPath(); g.moveTo(-0.2, 0); g.lineTo(0.85, 0); g.stroke();
      g.strokeStyle = '#e6d3a8'; g.lineWidth = 0.07;
      g.beginPath(); g.moveTo(-0.2, 0); g.lineTo(0.85, 0); g.stroke();
      g.lineWidth = 0.07; g.strokeStyle = INK; g.fillStyle = '#d3dae8';
      g.beginPath(); g.moveTo(1.02, 0); g.lineTo(0.72, -0.2); g.lineTo(0.72, 0.2); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#e0523f';
      g.beginPath(); g.moveTo(-0.2, 0); g.lineTo(-0.02, -0.2); g.lineTo(0.16, -0.2); g.lineTo(0.08, 0); g.lineTo(0.16, 0.2); g.lineTo(-0.02, 0.2); g.closePath(); g.fill(); g.stroke();
    }
  };

  function roleArt(ctx, roleKey, x, y, size) {
    const fn = ART[roleKey];
    if (!fn) return;
    ctx.save();
    ctx.translate(x, y);
    const k = size / 2;
    ctx.scale(k, k);
    ctx.lineWidth = Math.max(0.06, 1.3 / k);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK;
    fn(ctx);
    ctx.restore();
  }

  function crown(ctx, x, y, w) {
    const h = w * 0.62;
    ctx.save();
    ctx.translate(x - w / 2, y - h);
    ctx.beginPath();
    ctx.moveTo(0, h); ctx.lineTo(0, h * 0.28); ctx.lineTo(w * 0.25, h * 0.6); ctx.lineTo(w * 0.5, 0); ctx.lineTo(w * 0.75, h * 0.6); ctx.lineTo(w, h * 0.28); ctx.lineTo(w, h); ctx.closePath();
    ctx.fillStyle = '#ffd23f'; ctx.fill();
    ctx.lineWidth = Math.max(1, w * 0.06); ctx.strokeStyle = '#7a5600'; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = '#ff5a6e';
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.78, w * 0.07, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---- village --------------------------------------------------------------------------
  const WALLS = [[236, 214, 170], [226, 198, 154], [222, 186, 156], [208, 218, 196], [232, 204, 176], [214, 200, 224]];
  const ROOFS = [[184, 74, 58], [140, 78, 46], [58, 122, 128], [104, 86, 164], [166, 92, 44], [90, 138, 60], [170, 60, 90]];

  function Village(opts) {
    opts = opts || {};
    this.width = opts.width || 960;
    this.height = opts.height || 600;
    this.sx = this.width / 960; this.sy = this.height / 600;
    this.players = [];
    this.houses = {};
    this.order = [];
    this._built = false;
    this._tense = 0;
    this._lastNow = null;
    this.setPlayers([]);
  }

  Village.prototype.setPlayers = function (list) {
    this.players = (list || []).slice(0, 16);
    const n = this.players.length;
    this.houses = {};
    this.order = [];
    this.spr = {};
    this._landDirty = true;
    if (!n) { this.layout = { cy: 360, rx: 300, ry: 130, fireY: 372 }; return; }
    const ry = 136 + n * 0.7, rx = clamp(240 + n * 9.5, 300, 392);
    const backY = 232, cy = backY + ry;
    this.layout = { cy, rx, ry, fireY: cy + 10 };
    // arc-length parametrisation of the ellipse (start at the bottom, going clockwise)
    const N = 720, cum = [0], ang = [];
    let px = rx * Math.cos(Math.PI / 2), py = ry * Math.sin(Math.PI / 2);
    ang.push(Math.PI / 2);
    for (let i = 1; i <= N; i++) {
      const a = Math.PI / 2 + (i / N) * TAU;
      const x = rx * Math.cos(a), y = ry * Math.sin(a);
      cum.push(cum[i - 1] + Math.hypot(x - px, y - py)); ang.push(a); px = x; py = y;
    }
    const total = cum[N];
    const baseW = clamp(142 - 4.8 * n, 70, 108);
    const fs = n <= 8 ? 16 : n <= 12 ? 14 : 13;
    let j = 0;
    this.players.forEach((p, i) => {
      const target = ((i + 0.5) / n) * total;
      while (j < N - 1 && cum[j + 1] < target) j++;
      const f = (target - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      const a = lerp(ang[j], ang[j + 1], f);
      const cx = 480 + rx * Math.cos(a), base = cy + ry * Math.sin(a);
      const depth = clamp((base - backY) / (2 * ry), 0, 1);
      const w = baseW * (0.88 + 0.2 * depth);
      const rnd = mulberry32(hashStr(p.id) ^ 0x51ed);
      const bh = w * 0.5, rh = w * 0.44;
      const h = {
        id: p.id, name: String(p.name == null ? p.id : p.name), color: p.color || '#cccccc', rgb: parseColor(p.color || '#cccccc'),
        cx, base, w, bh, rh, depth, fs,
        wall: WALLS[Math.floor(rnd() * WALLS.length)], roof: ROOFS[Math.floor(rnd() * ROOFS.length)],
        seed: rnd() * 10, lit: rnd() < 0.5,
        signW: 0, top: base - bh - rh - w * 0.14
      };
      h.win = [{ dx: -w * 0.29, dy: -bh * 0.6, s: w * 0.19 }, { dx: w * 0.29, dy: -bh * 0.6, s: w * 0.19 }];
      this.houses[p.id] = h;
      this.order.push(h);
    });
    this.order.sort((a, b) => a.base - b.base);
  };

  Village.prototype.houseRect = function (id) {
    const h = this.houses[id];
    if (!h) return null;
    return { x: (h.cx - h.w / 2) * this.sx, y: h.top * this.sy, w: h.w * this.sx, h: (h.base - h.top) * this.sy };
  };

  // ---- cached layers ----
  Village.prototype._ensure = function () {
    if (!this._built) {
      this._built = true;
      const W = 960, H = 600;
      // skies
      const mkSky = (stops) => {
        const c = mk(W, H), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 240);
        stops.forEach((s) => gr.addColorStop(s[0], s[1]));
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        return c;
      };
      this.skyN = mkSky([[0, '#03051a'], [0.5, '#0b1236'], [1, '#1d2b58']]);
      this.skyD = mkSky([[0, '#4f9fe8'], [0.6, '#9fd3ff'], [1, '#e6f4ff']]);
      this.skyS = mkSky([[0, 'rgba(46,38,100,0.0)'], [0.4, 'rgba(176,84,120,0.7)'], [0.8, 'rgba(255,150,90,0.95)'], [1, 'rgba(255,200,120,1)']]);
      // moon
      {
        const c = mk(120, 120), g = c.getContext('2d');
        const gr = g.createRadialGradient(46, 46, 4, 60, 60, 50);
        gr.addColorStop(0, '#fffdf0'); gr.addColorStop(0.7, '#e9e6cf'); gr.addColorStop(1, '#c4c2a8');
        g.fillStyle = gr; g.beginPath(); g.arc(60, 60, 46, 0, TAU); g.fill();
        g.fillStyle = 'rgba(150,150,125,0.38)';
        for (const [x, y, r] of [[44, 48, 9], [72, 40, 6], [76, 74, 11], [50, 78, 6], [66, 58, 4]]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
        this.moon = c;
      }
      // clouds (day = white, night = dark blue)
      const cloud = (r, gg, b) => {
        const c = mk(220, 70), g = c.getContext('2d');
        g.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')';
        for (const [x, y, rr] of [[50, 44, 24], [84, 32, 30], [122, 38, 28], [158, 46, 22], [100, 50, 26]]) { g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill(); }
        g.fillRect(40, 46, 130, 22);
        return c;
      };
      this.cloudD = cloud(255, 255, 255); this.cloudN = cloud(38, 48, 88);
      // fog
      {
        const c = mk(512, 120), g = c.getContext('2d');
        for (let i = 0; i < 7; i++) {
          const x = 70 + i * 62, y = 60 + Math.sin(i * 1.9) * 16, r = 52 + (i % 3) * 14;
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, 'rgba(190,205,235,0.5)'); gr.addColorStop(1, 'rgba(190,205,235,0)');
          g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
        }
        this.fog = c;
      }
      // vignettes
      {
        const v = mk(W, H), g = v.getContext('2d'), gr = g.createRadialGradient(W / 2, H / 2 + 20, 200, W / 2, H / 2 + 20, 600);
        gr.addColorStop(0, 'rgba(0,0,10,0)'); gr.addColorStop(1, 'rgba(0,0,10,0.75)');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        this.vigDark = v;
        const r = mk(W, H), q = r.getContext('2d'), gr2 = q.createRadialGradient(W / 2, H / 2, 180, W / 2, H / 2, 560);
        gr2.addColorStop(0, 'rgba(160,0,20,0)'); gr2.addColorStop(0.6, 'rgba(160,0,20,0.35)'); gr2.addColorStop(1, 'rgba(120,0,15,0.95)');
        q.fillStyle = gr2; q.fillRect(0, 0, W, H);
        this.vigRed = r;
      }
      // dusk tint (horizon glow over the landscape)
      {
        const c = mk(W, H), g = c.getContext('2d'), gr = g.createLinearGradient(0, 120, 0, 420);
        gr.addColorStop(0, 'rgba(255,150,90,0)'); gr.addColorStop(0.3, 'rgba(255,150,90,0.38)'); gr.addColorStop(1, 'rgba(255,120,80,0)');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        this.duskGlow = c;
      }
      // light cone for spotlights
      {
        const c = mk(128, 256), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
        gr.addColorStop(0, 'rgba(255,230,140,0)'); gr.addColorStop(1, 'rgba(255,230,140,0.7)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(48, 0); g.lineTo(80, 0); g.lineTo(128, 256); g.lineTo(0, 256); g.closePath(); g.fill();
        this.cone = c;
      }
      // stars
      const rnd = mulberry32(7);
      this.stars = [];
      for (let i = 0; i < 90; i++) this.stars.push({ x: rnd() * W, y: rnd() * 190, r: rnd() < 0.15 ? 2 : 1, ph: rnd() * 6, sp: 0.8 + rnd() * 2, a: 0.4 + rnd() * 0.6 });
      this.eyes = [];
      for (let i = 0; i < 7; i++) this.eyes.push({ x: 40 + rnd() * 880, y: 190 + rnd() * 14, per: 8000 + rnd() * 7000, ph: rnd(), sp: 6 + rnd() * 3 });
    }
    if (this._landDirty) { this._landDirty = false; this._buildLand(); }
  };

  Village.prototype._buildLand = function () {
    const L = this.layout, W = 960, H = 600;
    const build = (m) => {
      const c = mk(W, H), g = c.getContext('2d'), rnd = mulberry32(99);
      // far hills
      g.fillStyle = C(m, 120, 160, 150);
      g.beginPath(); g.moveTo(0, 210);
      for (let x = 0; x <= W; x += 20) g.lineTo(x, 150 + Math.sin(x * 0.011) * 18 + Math.sin(x * 0.027 + 2) * 10);
      g.lineTo(W, 210); g.closePath(); g.fill();
      g.fillStyle = C(m, 96, 142, 104);
      g.beginPath(); g.moveTo(0, 215);
      for (let x = 0; x <= W; x += 20) g.lineTo(x, 175 + Math.sin(x * 0.016 + 1) * 14 + Math.sin(x * 0.04) * 6);
      g.lineTo(W, 215); g.closePath(); g.fill();
      // forest rows
      const spruce = (x, base, h, r, gg, b) => {
        g.fillStyle = C(m, 60, 40, 28); g.fillRect(x - h * 0.03, base - h * 0.12, h * 0.06, h * 0.12);
        g.fillStyle = C(m, r, gg, b);
        for (let t = 0; t < 4; t++) {
          const ty = base - h * 0.1 - t * h * 0.24, tw = h * (0.32 - t * 0.065);
          g.beginPath(); g.moveTo(x, ty - h * 0.34); g.lineTo(x + tw, ty); g.lineTo(x - tw, ty); g.closePath(); g.fill();
        }
      };
      for (let x = -10; x < W + 20; x += 11 + rnd() * 12) spruce(x, 207 - rnd() * 5, 52 + rnd() * 44, 40, 84, 60);
      // dark forest floor so the eyes stand out at night
      const ff = g.createLinearGradient(0, 168, 0, 214);
      ff.addColorStop(0, 'rgba(0,0,8,0)'); ff.addColorStop(1, 'rgba(0,0,8,' + (m.night ? 0.7 : 0.35) + ')');
      g.fillStyle = ff; g.fillRect(0, 168, W, 46);
      for (let x = -14; x < W + 20; x += 15 + rnd() * 16) spruce(x, 217 + rnd() * 4, 66 + rnd() * 52, 26, 62, 46);
      // ground
      const gr = g.createLinearGradient(0, 205, 0, H);
      gr.addColorStop(0, C(m, 98, 150, 84)); gr.addColorStop(1, C(m, 64, 116, 62));
      g.fillStyle = gr; g.fillRect(0, 210, W, H - 210);
      g.fillStyle = C(m, 40, 76, 44, 0.5);
      g.fillRect(0, 205, W, 8);
      // grass tufts + flowers
      for (let i = 0; i < 320; i++) {
        const x = rnd() * W, y = 225 + rnd() * 370;
        g.strokeStyle = C(m, 46 + rnd() * 30, 100 + rnd() * 40, 50, 0.65); g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x - 3, y); g.lineTo(x - 2, y - 5); g.moveTo(x, y); g.lineTo(x, y - 7); g.moveTo(x + 3, y); g.lineTo(x + 2, y - 5); g.stroke();
      }
      for (let i = 0; i < 46; i++) {
        const x = rnd() * W, y = 240 + rnd() * 350, k = Math.floor(rnd() * 3);
        g.fillStyle = k === 0 ? C(m, 255, 240, 120) : k === 1 ? C(m, 255, 255, 255) : C(m, 250, 140, 170);
        g.beginPath(); g.arc(x, y, 1.8, 0, TAU); g.fill();
      }
      // dirt square
      const cx = 480, cy = L.fireY - 8, rx = L.rx * 0.6, ry = L.ry * 0.74;
      // paths to the doors
      g.lineCap = 'round';
      for (const h of this.order) {
        const sx = cx + (h.cx - cx) * 0.45, sy = cy + (h.base - cy) * 0.45;
        g.strokeStyle = C(m, 176, 142, 98); g.lineWidth = 12 + h.depth * 6;
        g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo((sx + h.cx) / 2, (sy + h.base) / 2 + 6, h.cx, h.base + 2); g.stroke();
      }
      g.beginPath();
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * TAU, k = 1 + Math.sin(a * 5) * 0.03 + Math.sin(a * 3 + 1) * 0.03;
        const x = cx + Math.cos(a) * rx * k, y = cy + Math.sin(a) * ry * k;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      const dg = g.createRadialGradient(cx, cy, 10, cx, cy, rx);
      dg.addColorStop(0, C(m, 190, 156, 108)); dg.addColorStop(1, C(m, 164, 130, 88));
      g.fillStyle = dg; g.fill();
      g.strokeStyle = C(m, 120, 94, 62, 0.8); g.lineWidth = 2; g.stroke();
      for (let i = 0; i < 90; i++) {
        const a = rnd() * TAU, d = Math.sqrt(rnd());
        g.fillStyle = C(m, 140 + rnd() * 60, 118 + rnd() * 40, 90, 0.5);
        g.beginPath(); g.ellipse(cx + Math.cos(a) * rx * d * 0.95, cy + Math.sin(a) * ry * d * 0.95, 4 + rnd() * 4, 2 + rnd() * 2, 0, 0, TAU); g.fill();
      }
      // fire pit
      const fx = 480, fy = L.fireY;
      g.fillStyle = C(m, 40, 30, 28, 0.55); g.beginPath(); g.ellipse(fx, fy + 4, 36, 13, 0, 0, TAU); g.fill();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        g.fillStyle = C(m, 120 + (i % 3) * 18, 118 + (i % 3) * 16, 122 + (i % 3) * 14);
        g.beginPath(); g.ellipse(fx + Math.cos(a) * 29, fy + 2 + Math.sin(a) * 10, 7, 4.6, 0, 0, TAU); g.fill();
        g.strokeStyle = C(m, 40, 40, 50); g.lineWidth = 1; g.stroke();
      }
      g.fillStyle = C(m, 30, 22, 20); g.beginPath(); g.ellipse(fx, fy + 1, 24, 8, 0, 0, TAU); g.fill();
      g.strokeStyle = C(m, 96, 64, 38); g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(fx - 18, fy + 4); g.lineTo(fx + 16, fy - 4); g.moveTo(fx - 16, fy - 3); g.lineTo(fx + 18, fy + 4); g.stroke();
      // corner trees (foreground framing)
      spruce(24, 596, 190, 22, 54, 40); spruce(-6, 560, 150, 24, 58, 42);
      spruce(940, 596, 190, 22, 54, 40); spruce(968, 560, 150, 24, 58, 42);
      return c;
    };
    this.landN = build(M_NIGHT);
    this.landD = build(M_DAY);
  };

  // ---- house sprites ----
  Village.prototype._houseSprite = function (h, alive, night) {
    const key = h.id + '|' + (alive ? 1 : 0) + '|' + (night ? 1 : 0);
    if (this.spr[key]) return this.spr[key];
    const m = alive ? (night ? M_NIGHT : M_DAY) : (night ? M_DEAD_NIGHT : M_DEAD_DAY);
    const bw = h.w, bh = h.bh, rh = h.rh;
    const sw = Math.ceil(bw * 1.34) + 4, sh = Math.ceil(bh + rh + bw * 0.2 + 14);
    const c = mk(sw, sh), g = c.getContext('2d');
    const ox = sw / 2, y0 = sh - 8;
    const wl = h.wall, rf = h.roof, pc = h.rgb;
    // shadow
    g.fillStyle = 'rgba(0,0,10,0.3)';
    g.beginPath(); g.ellipse(ox + bw * 0.05, y0 + 2, bw * 0.62, bw * 0.12, 0, 0, TAU); g.fill();
    // wall
    const wg = g.createLinearGradient(ox - bw / 2, 0, ox + bw / 2, 0);
    wg.addColorStop(0, C(m, wl[0], wl[1], wl[2])); wg.addColorStop(1, C(m, wl[0] * 0.8, wl[1] * 0.8, wl[2] * 0.82));
    g.fillStyle = wg; g.fillRect(ox - bw / 2, y0 - bh, bw, bh);
    // foundation
    g.fillStyle = C(m, 120, 118, 124); g.fillRect(ox - bw / 2, y0 - bw * 0.07, bw, bw * 0.07);
    // timber
    const tb = C(m, 78, 52, 36), tw = Math.max(2, bw * 0.04);
    g.fillStyle = tb;
    g.fillRect(ox - bw / 2, y0 - bh, tw, bh); g.fillRect(ox + bw / 2 - tw, y0 - bh, tw, bh);
    g.fillRect(ox - bw / 2, y0 - bw * 0.1, bw, tw * 0.8);
    g.fillRect(ox - tw / 2, y0 - bh, tw, bh * 0.2);
    g.strokeStyle = tb; g.lineWidth = tw * 0.7;
    g.beginPath(); g.moveTo(ox - bw / 2, y0 - bh * 0.28); g.lineTo(ox - bw * 0.36, y0 - bh * 0.9); g.moveTo(ox + bw / 2, y0 - bh * 0.28); g.lineTo(ox + bw * 0.36, y0 - bh * 0.9); g.stroke();
    // eave shadow
    const es = g.createLinearGradient(0, y0 - bh, 0, y0 - bh + bw * 0.14);
    es.addColorStop(0, 'rgba(10,8,20,0.45)'); es.addColorStop(1, 'rgba(10,8,20,0)');
    g.fillStyle = es; g.fillRect(ox - bw / 2, y0 - bh, bw, bw * 0.14);
    // windows
    for (const w of h.win) {
      const wx = ox + w.dx, wy = y0 + w.dy, s = w.s;
      g.fillStyle = C(m, rf[0] * 0.8, rf[1] * 0.8, rf[2] * 0.8);
      g.fillRect(wx - s * 0.5 - s * 0.26, wy - s * 0.5, s * 0.22, s);
      g.fillRect(wx + s * 0.5 + s * 0.04, wy - s * 0.5, s * 0.22, s);
      g.fillStyle = C(m, 96, 64, 44); g.fillRect(wx - s * 0.58, wy - s * 0.58, s * 1.16, s * 1.16);
      if (!alive) {
        g.fillStyle = C(m, 22, 24, 34); g.fillRect(wx - s * 0.5, wy - s * 0.5, s, s);
      } else if (night) {
        g.fillStyle = C(m, 90, 110, 160); g.fillRect(wx - s * 0.5, wy - s * 0.5, s, s);
      } else {
        const gg = g.createLinearGradient(wx, wy - s / 2, wx + s / 2, wy + s / 2);
        gg.addColorStop(0, 'rgb(205,232,250)'); gg.addColorStop(1, 'rgb(130,176,214)');
        g.fillStyle = gg; g.fillRect(wx - s * 0.5, wy - s * 0.5, s, s);
        g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.moveTo(wx - s * 0.5, wy - s * 0.1); g.lineTo(wx - s * 0.1, wy - s * 0.5); g.lineTo(wx + s * 0.05, wy - s * 0.5); g.lineTo(wx - s * 0.5, wy + s * 0.05); g.fill();
      }
      g.strokeStyle = C(m, 96, 64, 44); g.lineWidth = Math.max(1.2, s * 0.09);
      g.beginPath(); g.moveTo(wx, wy - s / 2); g.lineTo(wx, wy + s / 2); g.moveTo(wx - s / 2, wy); g.lineTo(wx + s / 2, wy); g.stroke();
      if (!alive) {
        g.strokeStyle = C(m, 120, 84, 52); g.lineWidth = Math.max(2.5, s * 0.2);
        g.beginPath(); g.moveTo(wx - s * 0.62, wy - s * 0.3); g.lineTo(wx + s * 0.62, wy + s * 0.22); g.moveTo(wx - s * 0.62, wy + s * 0.2); g.lineTo(wx + s * 0.62, wy - s * 0.32); g.stroke();
      } else if (!night) {
        g.fillStyle = C(m, 90, 70, 46); g.fillRect(wx - s * 0.62, wy + s * 0.5, s * 1.24, s * 0.22);
        for (let i = 0; i < 4; i++) { g.fillStyle = ['#ff6b8a', '#ffd23f', '#fff', '#ff9ad0'][i]; g.beginPath(); g.arc(wx - s * 0.45 + i * s * 0.3, wy + s * 0.5, s * 0.09, 0, TAU); g.fill(); }
      }
    }
    // door in the player's colour
    const dw = bw * 0.22, dh = bh * 0.58, dx = ox - dw / 2, dy = y0 - dh - bw * 0.04;
    g.fillStyle = C(m, 60, 40, 30); g.fillRect(dx - 2, dy - 2, dw + 4, dh + 2);
    g.fillStyle = C(m, pc[0], pc[1], pc[2]);
    g.beginPath(); g.moveTo(dx, dy + dh); g.lineTo(dx, dy + dw * 0.5); g.arc(ox, dy + dw * 0.5, dw / 2, Math.PI, 0); g.lineTo(dx + dw, dy + dh); g.closePath(); g.fill();
    g.strokeStyle = C(m, pc[0] * 0.6, pc[1] * 0.6, pc[2] * 0.6); g.lineWidth = 1;
    g.beginPath(); g.moveTo(ox, dy); g.lineTo(ox, dy + dh); g.moveTo(dx + dw * 0.25, dy + dw * 0.3); g.lineTo(dx + dw * 0.25, dy + dh); g.moveTo(dx + dw * 0.75, dy + dw * 0.3); g.lineTo(dx + dw * 0.75, dy + dh); g.stroke();
    g.fillStyle = C(m, 240, 200, 90); g.beginPath(); g.arc(dx + dw * 0.8, dy + dh * 0.62, Math.max(1.2, bw * 0.014), 0, TAU); g.fill();
    g.fillStyle = C(m, 150, 146, 150); g.fillRect(dx - 3, y0 - bw * 0.04, dw + 6, bw * 0.04);
    if (!alive) {
      g.strokeStyle = C(m, 120, 84, 52); g.lineWidth = Math.max(3, bw * 0.045);
      g.beginPath(); g.moveTo(dx - 3, dy + dh * 0.25); g.lineTo(dx + dw + 3, dy + dh * 0.62); g.moveTo(dx - 3, dy + dh * 0.7); g.lineTo(dx + dw + 3, dy + dh * 0.2); g.stroke();
    }
    // roof (trapezoid slab seen from above)
    const ey = y0 - bh + 3, ty = y0 - bh - rh, ew = bw * 0.58, tw2 = bw * 0.3;
    const rg = g.createLinearGradient(0, ty, 0, ey);
    rg.addColorStop(0, C(m, rf[0] * 0.78, rf[1] * 0.78, rf[2] * 0.78)); rg.addColorStop(1, C(m, rf[0], rf[1], rf[2]));
    g.fillStyle = rg;
    g.beginPath(); g.moveTo(ox - ew, ey); g.lineTo(ox - tw2, ty); g.lineTo(ox + tw2, ty); g.lineTo(ox + ew, ey); g.closePath(); g.fill();
    g.strokeStyle = C(m, rf[0] * 0.5, rf[1] * 0.5, rf[2] * 0.5, 0.8); g.lineWidth = 1;
    const rows = 5;
    for (let r = 1; r <= rows; r++) {
      const t = r / (rows + 1), yy = lerp(ty, ey, t), hw = lerp(tw2, ew, t);
      g.beginPath(); g.moveTo(ox - hw, yy); g.lineTo(ox + hw, yy); g.stroke();
      const step = Math.max(7, bw * 0.12);
      g.beginPath();
      for (let x = -hw + (r % 2) * step * 0.5; x < hw; x += step) { g.moveTo(ox + x, yy); g.lineTo(ox + x, yy + (ey - ty) / (rows + 1)); }
      g.stroke();
    }
    if (!alive) { // missing shingles
      g.fillStyle = 'rgba(10,8,16,0.55)';
      g.beginPath(); g.moveTo(ox - bw * 0.2, ty + rh * 0.35); g.lineTo(ox - bw * 0.04, ty + rh * 0.3); g.lineTo(ox - bw * 0.08, ty + rh * 0.62); g.lineTo(ox - bw * 0.22, ty + rh * 0.58); g.closePath(); g.fill();
    }
    g.fillStyle = C(m, rf[0] * 0.58, rf[1] * 0.58, rf[2] * 0.58);
    g.fillRect(ox - tw2 - 1, ty - 2, tw2 * 2 + 2, 4);
    g.fillStyle = C(m, Math.min(255, rf[0] * 1.15), Math.min(255, rf[1] * 1.15), Math.min(255, rf[2] * 1.15), 0.9);
    g.beginPath(); g.moveTo(ox - ew, ey); g.lineTo(ox + ew, ey); g.lineTo(ox + ew - 2, ey - 3); g.lineTo(ox - ew + 2, ey - 3); g.closePath(); g.fill();
    // chimney
    const chx = ox + bw * 0.2, chw = bw * 0.13, chy = ty - bw * 0.1;
    g.fillStyle = C(m, 150, 90, 74);
    g.fillRect(chx, chy, chw, ty - chy + rh * 0.3);
    g.fillStyle = C(m, 110, 64, 52); g.fillRect(chx, chy, chw * 0.35, ty - chy + rh * 0.3);
    g.fillStyle = C(m, 90, 90, 100); g.fillRect(chx - 2, chy - 3, chw + 4, 4);
    h.chim = { dx: chx + chw / 2 - ox, dy: chy - 3 - y0 };
    // flag
    if (alive) {
      const fxp = ox - tw2 * 0.6, fyp = ty - 2;
      g.strokeStyle = C(m, 70, 50, 40); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(fxp, fyp); g.lineTo(fxp, fyp - bw * 0.2); g.stroke();
      g.fillStyle = C(m, pc[0], pc[1], pc[2]);
      g.beginPath(); g.moveTo(fxp, fyp - bw * 0.2); g.lineTo(fxp + bw * 0.16, fyp - bw * 0.155); g.lineTo(fxp, fyp - bw * 0.11); g.closePath(); g.fill();
    }
    const o = { c, ox, oy: y0 };
    this.spr[key] = o;
    return o;
  };

  Village.prototype._signSprite = function (h, alive) {
    const key = 's' + h.id + '|' + (alive ? 1 : 0);
    if (this.spr[key]) return this.spr[key];
    const maxW = clamp(h.w * 1.4, 72, 116), sh = h.fs + 9;
    const probe = mk(4, 4).getContext('2d');
    let fs = h.fs, name = h.name;
    const font = (s) => 'bold ' + s + 'px system-ui, "Segoe UI", Arial, sans-serif';
    probe.font = font(fs);
    while (fs > 10 && probe.measureText(name).width > maxW - 22) { fs--; probe.font = font(fs); }
    if (probe.measureText(name).width > maxW - 22) {
      while (name.length > 2 && probe.measureText(name + '…').width > maxW - 22) name = name.slice(0, -1);
      name += '…';
    }
    const tw = probe.measureText(name).width, sw = Math.max(Math.min(h.w * 0.8, maxW), tw + 22);
    h.signW = sw;
    const c = mk(sw + 4, sh + 8), g = c.getContext('2d');
    const x = 2, y = 5;
    g.strokeStyle = 'rgba(30,20,12,0.9)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x + sw * 0.22, y); g.lineTo(x + sw * 0.22, 0); g.moveTo(x + sw * 0.78, y); g.lineTo(x + sw * 0.78, 0); g.stroke();
    rr(g, x, y, sw, sh, 5);
    g.fillStyle = alive ? 'rgba(18,16,34,0.88)' : 'rgba(26,26,32,0.88)'; g.fill();
    g.strokeStyle = alive ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.14)'; g.lineWidth = 1; g.stroke();
    // colour tab
    const pc = h.rgb, k = alive ? 1 : 0.35, lum = (pc[0] + pc[1] + pc[2]) / 3;
    g.fillStyle = 'rgb(' + Math.round(lerp(lum, pc[0], k)) + ',' + Math.round(lerp(lum, pc[1], k)) + ',' + Math.round(lerp(lum, pc[2], k)) + ')';
    g.save(); rr(g, x, y, sw, sh, 5); g.clip(); g.fillRect(x, y, 6, sh); g.fillRect(x, y + sh - 3, sw, 3); g.restore();
    g.font = font(fs); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(name, x + sw / 2 + 3, y + sh / 2 + 1);
    g.fillStyle = alive ? '#fff' : '#9aa0b4'; g.fillText(name, x + sw / 2 + 3, y + sh / 2);
    if (!alive) { g.strokeStyle = 'rgba(190,195,215,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + sw / 2 + 3 - tw / 2 - 1, y + sh / 2 + 1); g.lineTo(x + sw / 2 + 3 + tw / 2 + 1, y + sh / 2 + 1); g.stroke(); }
    const o = { c, w: sw + 4, h: sh + 8, sw, sh };
    this.spr[key] = o;
    return o;
  };

  function rr(o, x, y, w, h, r) {
    o.beginPath(); o.moveTo(x + r, y); o.arcTo(x + w, y, x + w, y + h, r); o.arcTo(x + w, y + h, x, y + h, r); o.arcTo(x, y + h, x, y, r); o.arcTo(x, y, x + w, y, r); o.closePath();
  }

  // ---- drawing ----
  Village.prototype._drawFire = function (ctx, now, night, tense) {
    const fx = 480, fy = this.layout.fireY;
    const f1 = 0.85 + 0.15 * Math.sin(now * 0.017) + 0.08 * Math.sin(now * 0.041 + 1);
    ctx.globalCompositeOperation = 'lighter';
    const col = tense > 0.5 ? glowSprite(255, 90, 50) : glowSprite(255, 150, 60);
    drawGlow(ctx, col, fx, fy - 10, 70 * f1, 52 * f1, 0.5 + 0.3 * night);
    // flames
    const tongues = [[-9, 22, 0], [8, 26, 1.3], [0, 36, 2.1], [-3, 28, 3.4], [12, 18, 4.2]];
    for (const [dx, hgt, ph] of tongues) {
      const hh = hgt * (0.75 + 0.35 * Math.sin(now * 0.012 + ph) * f1 + 0.1 * Math.sin(now * 0.03 + ph * 2));
      const sway = Math.sin(now * 0.008 + ph) * 3;
      for (let L = 0; L < 3; L++) {
        const k = 1 - L * 0.32;
        ctx.fillStyle = L === 0 ? 'rgba(255,90,20,0.55)' : L === 1 ? 'rgba(255,170,40,0.6)' : 'rgba(255,240,170,0.7)';
        ctx.beginPath();
        const w = (7 - L * 1.6), bx = fx + dx * k, by = fy + 2;
        ctx.moveTo(bx - w, by);
        ctx.quadraticCurveTo(bx - w * 0.9 + sway * 0.4, by - hh * k * 0.55, bx + sway, by - hh * k);
        ctx.quadraticCurveTo(bx + w * 0.9 + sway * 0.4, by - hh * k * 0.55, bx + w, by);
        ctx.closePath(); ctx.fill();
      }
    }
    // sparks
    ctx.fillStyle = 'rgba(255,200,90,0.9)';
    for (let i = 0; i < 9; i++) {
      const per = 1500 + i * 230, t = ((now + i * 377) % per) / per;
      const x = fx + Math.sin(i * 7.1 + t * 3) * 14 + (t * 8) * Math.sin(i * 3.3), y = fy - 12 - t * 70;
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.fillRect(x, y, 1.8, 1.8);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  Village.prototype._drawHouse = function (ctx, h, sc, now, s, night, lights, hl) {
    const alive = !(sc.alive && sc.alive[h.id] === false);
    const cx = h.cx, base = h.base;
    if (hl) {
      const pulse = 0.65 + 0.35 * Math.sin(now * 0.005);
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, glowSprite(255, 215, 90), cx, base, h.w * 1.0, h.w * 0.38, 0.8 * pulse);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // building
    if (s < 0.999) { const sp = this._houseSprite(h, alive, true); ctx.drawImage(sp.c, cx - sp.ox, base - sp.oy); }
    if (s > 0.001) { const sp = this._houseSprite(h, alive, false); ctx.globalAlpha = s; ctx.drawImage(sp.c, cx - sp.ox, base - sp.oy); ctx.globalAlpha = 1; }
    const spN = this._houseSprite(h, alive, false);
    if (alive) {
      // lit windows
      if (lights > 0.02) {
        const fl = 0.86 + 0.1 * Math.sin(now * 0.007 + h.seed * 9) + 0.05 * Math.sin(now * 0.019 + h.seed);
        ctx.globalCompositeOperation = 'lighter';
        const gs = glowSprite(255, 176, 80);
        for (const w of h.win) {
          const x = cx + w.dx, y = base + w.dy, sz = w.s;
          ctx.globalAlpha = Math.min(1, lights * 0.8 * fl);
          ctx.fillStyle = 'rgb(255,190,90)';
          ctx.fillRect(x - sz * 0.5, y - sz * 0.5, sz, sz);
          drawGlow(ctx, gs, x, y, sz * 1.5, sz * 1.5, lights * 0.5 * fl);
        }
        drawGlow(ctx, gs, cx, base + 3, h.w * 0.62, h.w * 0.16, lights * 0.28 * fl);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      // chimney smoke
      if (h.chim) {
        const sx = cx + h.chim.dx, sy = base + h.chim.dy, nt = 0.6 * night;
        for (let k = 0; k < 3; k++) {
          const t = ((now * 0.00028 + h.seed * 0.37 + k / 3) % 1);
          const r = 3 + t * h.w * 0.16, x = sx + Math.sin(t * 4 + h.seed) * 4 + t * 8, y = sy - t * h.w * 0.55;
          ctx.globalAlpha = (1 - t) * 0.34;
          ctx.fillStyle = nt > 0.3 ? 'rgb(120,130,165)' : 'rgb(235,235,240)';
          ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
    // grave
    if (!alive) {
      const gw = clamp(h.w * 0.27, 17, 27), gx = cx + h.w * 0.54 + gw * 0.2, gy = base + 4;
      ctx.fillStyle = 'rgba(20,16,12,0.5)';
      ctx.beginPath(); ctx.ellipse(gx, gy, gw * 0.8, gw * 0.22, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = night > 0.5 ? '#4a5170' : '#9ca1ae';
      ctx.beginPath(); ctx.ellipse(gx, gy - 1, gw * 0.7, gw * 0.18, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = night > 0.5 ? '#6b7396' : '#c2c7d2';
      ctx.beginPath(); ctx.moveTo(gx - gw * 0.34, gy - 2); ctx.lineTo(gx - gw * 0.34, gy - gw * 0.95); ctx.arc(gx, gy - gw * 0.95, gw * 0.34, Math.PI, 0); ctx.lineTo(gx + gw * 0.34, gy - 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(15,15,30,0.7)'; ctx.lineWidth = 1; ctx.stroke();
      const rv = sc.revealed && sc.revealed[h.id];
      if (rv) {
        const dsz = clamp(h.w * 0.46, 30, 46), dy = gy - gw * 1.3 - dsz * 0.35;
        ctx.fillStyle = 'rgba(14,16,34,0.88)';
        ctx.beginPath(); ctx.arc(gx, dy, dsz * 0.56, 0, TAU); ctx.fill();
        ctx.strokeStyle = ROLE_COLOR[rv] || '#fff'; ctx.lineWidth = 2; ctx.stroke();
        roleArt(ctx, rv, gx, dy, dsz * 0.76);
      } else {
        ctx.strokeStyle = night > 0.5 ? '#8c93b4' : '#5e5a52'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(gx, gy - gw * 0.9); ctx.lineTo(gx, gy - gw * 1.5); ctx.moveTo(gx - gw * 0.2, gy - gw * 1.3); ctx.lineTo(gx + gw * 0.2, gy - gw * 1.3); ctx.stroke();
      }
      // wisp at night
      if (night > 0.3) {
        const t = ((now * 0.00022 + h.seed) % 1);
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, glowSprite(160, 200, 255), gx + Math.sin(t * 9) * 5, gy - gw * 1.2 - t * 36, 7, 9, (1 - t) * 0.45 * night);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
    }
    return spN;
  };

  Village.prototype._drawSign = function (ctx, h, sc, now, hl) {
    const alive = !(sc.alive && sc.alive[h.id] === false);
    const sg = this._signSprite(h, alive), base = h.base, cx = h.cx;
    ctx.drawImage(sg.c, cx - sg.w / 2, base + 2);
    if (hl) {
      ctx.strokeStyle = 'rgba(255,215,90,' + (0.7 + 0.3 * Math.sin(now * 0.006)) + ')'; ctx.lineWidth = 2.5;
      rr(ctx, cx - sg.sw / 2 - 1, base + 6, sg.sw + 2, sg.sh + 2, 6); ctx.stroke();
    }
  };

  Village.prototype._anchor = function (h, top) {
    return { x: h.cx, y: top ? h.top + h.rh * 0.35 : h.base - h.bh * 0.7 };
  };

  Village.prototype._drawVotes = function (ctx, sc, now) {
    const votes = sc.votes || {};
    const byTarget = {};
    for (const v in votes) {
      const t = votes[v];
      if (t == null || !this.houses[t] || !this.houses[v]) continue;
      (byTarget[t] = byTarget[t] || []).push(v);
    }
    const lead = Object.keys(byTarget).reduce((a, k) => Math.max(a, byTarget[k].length), 0);
    for (const t in byTarget) {
      const list = byTarget[t].sort(), th = this.houses[t];
      list.forEach((v, i) => {
        const vh = this.houses[v];
        if (vh === th) { // self vote: little loop above the roof
          const x = vh.cx, y = vh.top - 4;
          ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, y - 12, 12, 0.6, TAU - 0.6 + 0.0); ctx.stroke();
          ctx.strokeStyle = vh.color; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.arc(x, y - 12, 12, 0.6, TAU - 0.6); ctx.stroke();
          return;
        }
        const off = (i - (list.length - 1) / 2) * Math.min(10, th.w * 0.5 / Math.max(1, list.length));
        const a = { x: vh.cx, y: vh.top + vh.rh * 0.1 };
        const b = { x: th.cx + off, y: th.top + th.rh * 0.15 };
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        let nx = b.y - a.y, ny = -(b.x - a.x); const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        if (ny > 0 || (Math.abs(ny) < 0.05 && (nx > 0) !== ((a.x + b.x) / 2 > 480))) { nx = -nx; ny = -ny; }
        const bend = 14 + dist * 0.24;
        const c = { x: (a.x + b.x) / 2 + nx * bend, y: (a.y + b.y) / 2 + ny * bend - 8 };
        // tangent at the end for the arrow head
        let tx = b.x - c.x, ty = b.y - c.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const e = { x: b.x - tx * 3, y: b.y - ty * 3 };
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(8,8,20,0.6)'; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, e.x - tx * 10, e.y - ty * 10); ctx.stroke();
        ctx.strokeStyle = vh.color; ctx.lineWidth = 3.6;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, e.x - tx * 10, e.y - ty * 10); ctx.stroke();
        // head
        const hl = 17, hw = 10.5;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x - tx * hl - ty * hw, e.y - ty * hl + tx * hw); ctx.lineTo(e.x - tx * hl + ty * hw, e.y - ty * hl - tx * hw); ctx.closePath();
        ctx.fillStyle = vh.color; ctx.fill();
        ctx.strokeStyle = 'rgba(8,8,20,0.75)'; ctx.lineWidth = 1.6; ctx.stroke();
        // travelling dot
        const u = ((now / 1100 + hashStr(v) % 7 / 7) % 1), iu = 1 - u;
        const dx = iu * iu * a.x + 2 * iu * u * c.x + u * u * b.x, dy = iu * iu * a.y + 2 * iu * u * c.y + u * u * b.y;
        ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(dx, dy, 2.2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      });
    }
    // count badges
    for (const t in byTarget) {
      const th = this.houses[t], n = byTarget[t].length, top = n === lead && lead > 1;
      const x = th.cx, y = th.top - 16 - (top ? 2 * Math.sin(now * 0.008) : 0), r = 12 + (top ? 2 : 0);
      ctx.fillStyle = 'rgba(8,8,20,0.55)'; ctx.beginPath(); ctx.arc(x + 1, y + 2, r + 2, 0, TAU); ctx.fill();
      ctx.fillStyle = top ? '#ff5a4a' : '#ffd23f'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = top ? '#fff' : '#2a1a00'; ctx.font = 'bold ' + (r + 3) + 'px system-ui, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(n), x, y + 1);
    }
  };

  Village.prototype.draw = function (ctx, scene, now) {
    if (!ctx) return;
    scene = scene || {};
    now = now || 0;
    this._ensure();
    const sky = clamp(scene.sky == null ? 1 : scene.sky, 0, 1);
    const s = smooth(sky), night = 1 - s, dusk = 1 - Math.abs(2 * sky - 1);
    const dt = this._lastNow == null ? 0 : clamp((now - this._lastNow) / 1000, 0, 0.2);
    this._lastNow = now;
    this._tense += ((scene.mood === 'tense' ? 1 : 0) - this._tense) * (1 - Math.exp(-dt * 3.5));
    if (dt === 0 && scene.mood === 'tense') this._tense = 1;
    const tense = this._tense;
    const lights = clamp(1.5 - sky * 2, 0, 1);

    ctx.save();
    if (this.sx !== 1 || this.sy !== 1) ctx.scale(this.sx, this.sy);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // sky
    ctx.drawImage(this.skyN, 0, 0);
    if (s > 0.01) { ctx.globalAlpha = s; ctx.drawImage(this.skyD, 0, 0); }
    if (dusk > 0.02) { ctx.globalAlpha = Math.min(1, dusk * 0.9); ctx.drawImage(this.skyS, 0, 0); }
    ctx.globalAlpha = 1;

    // stars
    const sv = Math.pow(clamp(1 - sky / 0.55, 0, 1), 1.4);
    if (sv > 0.01) {
      ctx.fillStyle = '#fff';
      for (const st of this.stars) {
        ctx.globalAlpha = sv * st.a * (0.55 + 0.45 * Math.sin(now * 0.001 * st.sp + st.ph));
        ctx.fillRect(st.x, st.y, st.r, st.r);
      }
      // shooting star
      const slot = Math.floor(now / 14000), p = (now % 14000) / 14000;
      if (p < 0.05 && sv > 0.5) {
        const r = mulberry32(slot * 31 + 5), x0 = 120 + r() * 520, y0 = 20 + r() * 80, q = p / 0.05;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.globalAlpha = (1 - q) * sv;
        ctx.beginPath(); ctx.moveTo(x0 + q * 160, y0 + q * 60); ctx.lineTo(x0 + q * 160 - 36, y0 + q * 60 - 13); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // moon
    if (night > 0.02) {
      const my = 105 + 100 * s;
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, glowSprite(170, 190, 255), 770, my, 190, 190, 0.5 * night);
      if (tense > 0.02) drawGlow(ctx, glowSprite(255, 40, 40), 770, my, 150, 150, 0.35 * tense * night);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, night * 1.2); ctx.drawImage(this.moon, 710, my - 60);
      ctx.globalAlpha = 1;
    }
    // sun
    const sunA = clamp((sky - 0.2) / 0.35, 0, 1);
    if (sunA > 0.01) {
      const sy = 240 - 140 * smooth((sky - 0.25) / 0.75);
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, glowSprite(255, 190, 110), 770, sy, 230, 230, 0.6 * sunA);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = sunA; ctx.fillStyle = '#fff6d0'; ctx.beginPath(); ctx.arc(770, sy, 28, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // clouds
    for (let i = 0; i < 5; i++) {
      const x = ((i * 290 + now * (0.006 + i * 0.0013)) % 1300) - 220, y = 30 + (i * 37) % 100, sc = 0.8 + (i % 3) * 0.3;
      if (night > 0.02) { ctx.globalAlpha = 0.5 * night; ctx.drawImage(this.cloudN, x, y, 220 * sc, 70 * sc); }
      if (s > 0.02) { ctx.globalAlpha = 0.85 * s; ctx.drawImage(this.cloudD, x, y, 220 * sc, 70 * sc); }
    }
    ctx.globalAlpha = 1;

    // landscape
    if (s < 0.999) ctx.drawImage(this.landN, 0, 0);
    if (s > 0.001) { ctx.globalAlpha = s; ctx.drawImage(this.landD, 0, 0); ctx.globalAlpha = 1; }
    if (dusk > 0.05) { ctx.globalAlpha = dusk * 0.9; ctx.drawImage(this.duskGlow, 0, 0); ctx.globalAlpha = 1; }

    // wolf eyes in the forest
    const ev = Math.pow(night, 1.6);
    if (ev > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      const gs = tense > 0.5 ? glowSprite(255, 50, 40) : glowSprite(255, 190, 50);
      const duty = 0.26 + 0.14 * tense;
      for (const e of this.eyes) {
        const p = (((now / e.per) + e.ph) % 1);
        if (p > duty) continue;
        let a = Math.sin(Math.PI * p / duty);
        if ((Math.floor(now / 140 + e.ph * 50) % 23) === 0) a *= 0.1; // blink
        a *= ev;
        if (a < 0.03) continue;
        ctx.globalAlpha = Math.min(1, a * 1.2);
        ctx.fillStyle = tense > 0.5 ? '#ff5040' : '#ffd24a';
        ctx.fillRect(e.x - 6, e.y, 3.4, 2); ctx.fillRect(e.x + 3, e.y, 3.4, 2);
        drawGlow(ctx, gs, e.x - 4, e.y + 1, 9, 7, a * 0.7); drawGlow(ctx, gs, e.x + 5, e.y + 1, 9, 7, a * 0.7);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }

    // fog (behind houses)
    const fa = 0.26 * night + 0.07 * dusk;
    const fogAt = (k, y, a) => {
      if (a < 0.01) return;
      const x = ((k * 400 + now * (0.012 + k * 0.004)) % 1500) - 400;
      ctx.globalAlpha = a; ctx.drawImage(this.fog, x, y, 700, 150);
    };
    fogAt(0, 170, fa); fogAt(1, 200, fa * 0.9); fogAt(2, 235, fa * 0.7);
    ctx.globalAlpha = 1;

    // fire pool on the ground
    ctx.globalCompositeOperation = 'lighter';
    {
      const f1 = 0.85 + 0.15 * Math.sin(now * 0.017) + 0.08 * Math.sin(now * 0.041 + 1);
      drawGlow(ctx, tense > 0.5 ? glowSprite(255, 70, 40) : glowSprite(255, 140, 60), 480, this.layout.fireY + 4, 280, 120, (0.1 + 0.42 * night) * f1);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // houses (+ fire) back to front
    const hlSet = {};
    for (const id of (scene.highlight || [])) hlSet[id] = true;
    let fireDone = false;
    const fy = this.layout.fireY;
    for (const h of this.order) {
      if (!fireDone && h.base > fy) { this._drawFire(ctx, now, night, tense); fireDone = true; }
      this._drawHouse(ctx, h, scene, now, s, night, lights, !!hlSet[h.id]);
    }
    if (!fireDone) this._drawFire(ctx, now, night, tense);

    // front fog
    fogAt(3, 360, fa * 0.5); fogAt(4, 470, fa * 0.4);
    ctx.globalAlpha = 1;

    // spotlight beams + rings
    for (const h of this.order) {
      if (!hlSet[h.id]) continue;
      const pulse = 0.7 + 0.3 * Math.sin(now * 0.005);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.16 + 0.1 * night) * pulse;
      const bw = h.w * 1.7, bh = h.base - h.top + 70;
      ctx.drawImage(this.cone, h.cx - bw / 2, h.base - bh + 4, bw, bh);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      const rp = ((now / 1400) % 1);
      ctx.strokeStyle = 'rgba(255,220,100,' + (0.8 * (1 - rp)) + ')'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(h.cx, h.base + 4, h.w * (0.6 + rp * 0.45), h.w * (0.17 + rp * 0.1), 0, 0, TAU); ctx.stroke();
    }

    // badges
    const off = scene.offline || {}, rdy = scene.ready || {};
    for (const h of this.order) {
      const dead = scene.alive && scene.alive[h.id] === false;
      if (off[h.id]) {
        const x = h.cx + h.w * 0.46, y = h.top + h.rh * 0.25;
        ctx.fillStyle = 'rgba(14,16,40,0.85)'; ctx.beginPath(); ctx.arc(x, y, 12, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(160,180,255,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.font = '14px "Segoe UI Emoji","Noto Color Emoji","Apple Color Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('💤', x, y + 1);
      }
      if (rdy[h.id] && !dead) {
        const x = h.cx - h.w * 0.46, y = h.top + h.rh * 0.25;
        ctx.fillStyle = '#2ecc71'; ctx.beginPath(); ctx.arc(x, y, 10, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 4.5, y); ctx.lineTo(x - 1, y + 3.6); ctx.lineTo(x + 5, y - 3.6); ctx.stroke();
      }
    }

    // votes
    this._drawVotes(ctx, scene, now);

    // name signs always on top (readable over arrows and badges)
    for (const h of this.order) this._drawSign(ctx, h, scene, now, !!hlSet[h.id]);

    // vignettes
    ctx.globalAlpha = 0.3 + 0.4 * night; ctx.drawImage(this.vigDark, 0, 0);
    if (tense > 0.01) {
      const p = (now % 1100) / 1100;
      const beat = Math.exp(-Math.pow((p - 0.05) * 13, 2)) + 0.6 * Math.exp(-Math.pow((p - 0.27) * 13, 2));
      ctx.globalAlpha = tense * (0.28 + 0.55 * beat); ctx.drawImage(this.vigRed, 0, 0);
      ctx.globalAlpha = tense * 0.1; ctx.fillStyle = '#a00018'; ctx.fillRect(0, 0, 960, 600);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  // ---- end screen roster ----
  Village.prototype.drawRoster = function (ctx, rect, roster, now) {
    Village.drawRoster(ctx, rect, roster, now);
  };

  Village.drawRoster = function (ctx, rect, roster, now) {
    if (!ctx || !roster || !roster.length) return;
    now = now || 0;
    const n = roster.length, W = rect.w, H = rect.h, gap = 10;
    let best = 1, bestScore = -1;
    for (let c = 1; c <= n; c++) {
      const rows = Math.ceil(n / c), cw = (W - gap * (c - 1)) / c, ch = (H - gap * (rows - 1)) / rows;
      const score = Math.min(cw / 2.0, ch * 1.05);
      if (score > bestScore + 0.5) { bestScore = score; best = c; }
    }
    const cols = best, rows = Math.ceil(n / cols);
    const cw = (W - gap * (cols - 1)) / cols, ch = Math.min((H - gap * (rows - 1)) / rows, cw * 0.95);
    const stacked = cw / ch < 1.45;
    const totalH = rows * ch + (rows - 1) * gap, y0 = rect.y + (H - totalH) / 2;
    const pos = {};
    const pulse = 0.6 + 0.4 * Math.sin(now * 0.005);
    const font = (px, b) => (b ? 'bold ' : '') + Math.round(px) + 'px system-ui, "Segoe UI", Arial, sans-serif';
    const cell = (i) => {
      const r = Math.floor(i / cols), inRow = r === rows - 1 ? n - (rows - 1) * cols : cols;
      return { x: rect.x + (W - (inRow * cw + (inRow - 1) * gap)) / 2 + (i % cols) * (cw + gap), y: y0 + r * (ch + gap) };
    };
    roster.forEach((p, i) => { const c = cell(i); pos[p.id] = { x: c.x + cw / 2, y: c.y + ch / 2 }; });
    ctx.save();
    // lovers: dashed link under the cards, heart on top afterwards
    const links = [], done = {};
    roster.forEach((p) => {
      if (p.lover == null || !pos[p.lover] || done[p.id] || done[p.lover]) return;
      done[p.id] = done[p.lover] = true;
      const a = pos[p.id], b = pos[p.lover], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny) || 1, bend = Math.min(40, nl * 0.2);
      const l = { a, b, cx: mx + nx / nl * bend, cy: my + ny / nl * bend };
      links.push(l);
      ctx.strokeStyle = 'rgba(255,90,140,0.9)'; ctx.lineWidth = 3; ctx.setLineDash([7, 6]); ctx.lineDashOffset = -now * 0.02;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(l.cx, l.cy, b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    });
    roster.forEach((p, i) => {
      const { x, y } = cell(i);
      const alive = p.alive !== false, win = !!p.winner;
      // card
      if (win) {
        ctx.strokeStyle = 'rgba(255,210,70,' + (0.12 + 0.12 * pulse) + ')';
        for (let k = 3; k >= 1; k--) { ctx.lineWidth = 4 + k * 5; rr(ctx, x, y, cw, ch, 14); ctx.stroke(); }
      }
      rr(ctx, x, y, cw, ch, 12);
      ctx.fillStyle = alive ? 'rgba(14,16,36,0.92)' : 'rgba(18,18,26,0.9)'; ctx.fill();
      ctx.lineWidth = win ? 3 : 1.5;
      ctx.strokeStyle = win ? 'rgba(255,214,80,0.95)' : alive ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)'; ctx.stroke();
      // colour bar
      ctx.save(); rr(ctx, x, y, cw, ch, 12); ctx.clip();
      ctx.fillStyle = p.color || '#999'; ctx.globalAlpha = alive ? 1 : 0.45;
      if (stacked) ctx.fillRect(x, y, cw, 5); else ctx.fillRect(x, y, 6, ch);
      ctx.restore();
      // emblem
      const ed = stacked ? Math.min(cw * 0.6, ch * 0.5) : Math.min(ch - 18, cw * 0.4);
      const ex = stacked ? x + cw / 2 : x + 14 + ed / 2, ey = stacked ? y + 12 + ed / 2 : y + ch / 2;
      const rc = ROLE_COLOR[p.role] || '#fff';
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.beginPath(); ctx.arc(ex, ey, ed * 0.58, 0, TAU); ctx.fill();
      ctx.strokeStyle = rc; ctx.globalAlpha = alive ? 0.9 : 0.4; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = alive ? 1 : 0.45;
      roleArt(ctx, p.role, ex, ey, ed * 0.86);
      ctx.globalAlpha = 1;
      if (win) crown(ctx, ex, ey - ed * 0.5, ed * 0.5);
      // text
      const tx = stacked ? x + cw / 2 : ex + ed * 0.58 + 12, tw = stacked ? cw - 16 : x + cw - tx - 10;
      ctx.textAlign = stacked ? 'center' : 'left'; ctx.textBaseline = 'alphabetic';
      let nf = clamp(ch * 0.2, 12, 22);
      ctx.font = font(nf, true);
      let nm = String(p.name == null ? '' : p.name);
      while (nf > 11 && ctx.measureText(nm).width > tw) { nf -= 1; ctx.font = font(nf, true); }
      while (nm.length > 2 && ctx.measureText(nm).width > tw) nm = nm.slice(0, -1);
      const ty = stacked ? y + 12 + ed + 4 + nf : y + ch / 2 - ch * 0.04;
      ctx.fillStyle = alive ? '#fff' : '#9aa0b4'; ctx.fillText(nm, tx, ty);
      const rf = clamp(ch * 0.15, 11, 17);
      ctx.font = font(rf, false); ctx.fillStyle = alive ? rc : '#808699';
      ctx.fillText(ROLE_NAME[p.role] || '?', tx, ty + rf + 3);
      // status
      ctx.font = font(rf - 1, false);
      ctx.fillStyle = alive ? '#6fe39a' : '#b87a7a';
      const st = alive ? '● überlebt' : '✝ gestorben';
      if (!stacked || ch > 100) ctx.fillText(st, tx, ty + (rf + 3) * 2 + 1);
      if (win && !stacked) { ctx.font = font(rf - 1, true); ctx.textAlign = 'right'; ctx.fillStyle = '#ffd23f'; ctx.fillText('SIEGER', x + cw - 10, y + 18); }
    });
    for (const l of links) {
      const hx = 0.25 * l.a.x + 0.5 * l.cx + 0.25 * l.b.x, hy = 0.25 * l.a.y + 0.5 * l.cy + 0.25 * l.b.y, hs = 11 + 2 * Math.sin(now * 0.008);
      heartPath(ctx, hx, hy, hs); ctx.fillStyle = '#ff4f87'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
  };

  Village.roleArt = roleArt;
  Village.roleName = (k) => ROLE_NAME[k] || String(k || '');
  Village.roleColor = (k) => ROLE_COLOR[k] || '#ffffff';
  Village.ROLE_NAME = ROLE_NAME;
  Village.ROLE_COLOR = ROLE_COLOR;
  window.WerwolfVillage = Village;
})();
