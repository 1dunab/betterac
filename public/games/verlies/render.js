// ===== Würfelverlies — the TV picture: board, tokens, panels, dice tray, effects (see docs/VERLIES.md) =====
// window.VerliesView: a full-window 2D canvas. screen.js hands it a model every frame (draw) and the rules'
// events as they happen (event); the view animates on its own clock and never changes the game.
(function (root) {
  const D = root.VerliesData, R = root.VerliesRules, A = root.VerliesArt;
  const SERIF = 'Georgia,"Times New Roman",serif', SANS = 'system-ui,"Segoe UI",Arial,sans-serif';
  const T = 64;                         // px per cell in the cached board layers
  const TAU = Math.PI * 2;
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => 1 - Math.pow(1 - clampN(t, 0, 1), 3);
  function rr(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function seeded(seed) { let s = (seed | 0) || 3; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const STAGE_TXT = { roll: 'wählt Würfel', summon: 'darf beschwören', place: 'faltet ein Verlies-Stück aus', act: 'ist am Zug' };

  function View() {
    this.canvas = mk(960, 600);
    this.g = this.canvas.getContext('2d');
    this.W = 960; this.H = 600; this.U = 1;
    this.disp = {}; this.gone = []; this.items = {};
    this.parts = []; this.floats = []; this.shake = 0;
    this.cam = { x: 0, y: 0, z: 1 }; this.camGoal = null; this.manualUntil = 0;
    this.floor = null; this.tiles = null; this.tilesKey = ''; this.anims = [];
    this.dice = null; this.toast = null; this.big = null; this.lastT = 0; this.boardKey = '';
    this.stars = null;
  }
  const V = View.prototype;

  V.resize = function (w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.W = w; this.H = h; this.U = Math.min(w / 1920, h / 1080);
  };

  // a new game (or a rematch): forget every animation and rebuild the board layers
  V.reset = function (st) {
    this.disp = {}; this.gone = []; this.parts = []; this.floats = []; this.anims = []; this.dice = null; this.toast = null; this.big = null;
    this.floor = null; this.tiles = null; this.tilesKey = '';
    this.cam = st ? { x: st.w / 2, y: st.h / 2, z: 1 } : { x: 0, y: 0, z: 1 };
    this.camGoal = null; this.manualUntil = 0;
    this.boardKey = st ? st.w + 'x' + st.h : '';
  };

  // ---------- camera ----------
  V.layout = function (st) {
    const U = this.U, W = this.W, H = this.H;
    const side = Math.round(clampN(W * 0.19, 250 * U, 380 * U));
    const top = Math.round(78 * U), pad = Math.round(16 * U);
    const ax = side + pad, aw = W - 2 * (side + pad), ay = top, ah = H - top - pad;
    const bs = Math.min(aw, ah);
    return { side, top, pad, ax, aw, ay, ah, bx: ax + (aw - bs) / 2, by: ay + (ah - bs) / 2, bs, cs0: st ? bs / st.w : 1 };
  };
  V.toScreen = function (L, x, y) {
    const cs = L.cs0 * this.cam.z;
    return [L.bx + L.bs / 2 + (x - this.cam.x) * cs, L.by + L.bs / 2 + (y - this.cam.y) * cs, cs];
  };
  V.focus = function (rect, st) {
    if (!st) return;
    if (!rect) { this.camGoal = { x: st.w / 2, y: st.h / 2, z: 1 }; return; }
    const span = Math.max(rect[2] - rect[0] + 1, rect[3] - rect[1] + 1, 13);
    const z = clampN(st.w / span, 1, 1.45);
    const half = st.w / z / 2;
    const cx = clampN((rect[0] + rect[2] + 1) / 2, half, st.w - half), cy = clampN((rect[1] + rect[3] + 1) / 2, half, st.h - half);
    this.camGoal = { x: cx, y: cy, z };
  };
  // mouse / keyboard on the TV page: zoom about a point, drag to pan, reset
  V.zoomAt = function (L, sx, sy, f, st) {
    if (!st) return;
    const cs = L.cs0 * this.cam.z, wx = this.cam.x + (sx - L.bx - L.bs / 2) / cs, wy = this.cam.y + (sy - L.by - L.bs / 2) / cs;
    const z = clampN(this.cam.z * f, 0.6, 4);
    this.cam.x = wx - (sx - L.bx - L.bs / 2) / (L.cs0 * z); this.cam.y = wy - (sy - L.by - L.bs / 2) / (L.cs0 * z); this.cam.z = z;
    this.manualUntil = performance.now() + 25000;
  };
  V.pan = function (L, dx, dy) { const cs = L.cs0 * this.cam.z; this.cam.x -= dx / cs; this.cam.y -= dy / cs; this.manualUntil = performance.now() + 25000; };
  V.unpin = function () { this.manualUntil = 0; };

  // ---------- cached board layers ----------
  V.buildFloor = function (st) {
    const c = mk(st.w * T, st.h * T), g = c.getContext('2d'), r = seeded(st.w * 131 + 7);
    g.fillStyle = '#0d0c12'; g.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < st.h; y++) for (let x = 0; x < st.w; x++) {
      const px = x * T, py = y * T, tint = r();
      const base = A.mix('#1d1b24', '#2a2631', tint);
      const gr = g.createLinearGradient(px, py, px + T, py + T);
      gr.addColorStop(0, A.lit(base, 0.08)); gr.addColorStop(1, A.drk(base, 0.25));
      rr(g, px + 2, py + 2, T - 4, T - 4, 5); g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(255,255,255,.035)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px + 4, py + T - 5); g.lineTo(px + 4, py + 4); g.lineTo(px + T - 5, py + 4); g.stroke();
      if (r() < 0.22) { g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.2; g.beginPath(); let cx = px + 8 + r() * (T - 16), cy = py + 8 + r() * (T - 16); g.moveTo(cx, cy); for (let k = 0; k < 3; k++) { cx += (r() - 0.5) * 18; cy += (r() - 0.5) * 18; g.lineTo(cx, cy); } g.stroke(); }
      if (r() < 0.08) { g.fillStyle = 'rgba(70,110,60,.18)'; g.beginPath(); g.ellipse(px + r() * T, py + r() * T, 6 + r() * 8, 4 + r() * 5, r() * 3, 0, TAU); g.fill(); }
    }
    return c;
  };
  // every path tile, with a glowing edge where the path ends and thin seams between pieces
  V.buildTiles = function (st, skip, seats) {
    const c = mk(st.w * T, st.h * T), g = c.getContext('2d');
    const isPath = (i) => st.kind[i] === R.PATH && !(skip && skip.has(st.piece[i]));
    for (let i = 0; i < st.kind.length; i++) {
      if (!isPath(i)) continue;
      const x = R.X(st, i), y = R.Y(st, i), px = x * T, py = y * T, col = seatColor(seats, st.owner[i]);
      const base = A.mix('#4b4655', col, 0.2);
      const gr = g.createLinearGradient(px, py, px + T, py + T);
      gr.addColorStop(0, A.lit(base, 0.16)); gr.addColorStop(0.6, base); gr.addColorStop(1, A.drk(base, 0.3));
      rr(g, px + 1, py + 1, T - 2, T - 2, 4); g.fillStyle = gr; g.fill();
      const ig = g.createRadialGradient(px + T / 2, py + T / 2, 2, px + T / 2, py + T / 2, T * 0.62);
      ig.addColorStop(0, A.rgba(col, 0.2)); ig.addColorStop(1, A.rgba(col, 0));
      g.fillStyle = ig; g.fillRect(px, py, T, T);
      // a faint carved rune in the middle
      g.strokeStyle = A.rgba(A.lit(col, 0.4), 0.12); g.lineWidth = 2;
      g.beginPath(); g.moveTo(px + T / 2, py + T * 0.3); g.lineTo(px + T * 0.7, py + T / 2); g.lineTo(px + T / 2, py + T * 0.7); g.lineTo(px + T * 0.3, py + T / 2); g.closePath(); g.stroke();
    }
    // seams and glowing rims
    g.lineCap = 'round';
    for (let i = 0; i < st.kind.length; i++) {
      if (!isPath(i)) continue;
      const x = R.X(st, i), y = R.Y(st, i), col = seatColor(seats, st.owner[i]);
      const sides = [[1, 0, x * T + T, y * T, x * T + T, y * T + T], [-1, 0, x * T, y * T, x * T, y * T + T], [0, 1, x * T, y * T + T, x * T + T, y * T + T], [0, -1, x * T, y * T, x * T + T, y * T]];
      for (const [dx, dy, x1, y1, x2, y2] of sides) {
        const nx = x + dx, ny = y + dy, inB = R.inside(st, nx, ny), j = inB ? R.idx(st, nx, ny) : -1;
        const nPath = j >= 0 && (isPath(j) || st.kind[j] === R.MASTER);
        if (nPath && st.owner[j] === st.owner[i] && st.piece[j] === st.piece[i]) continue;
        if (nPath && st.owner[j] === st.owner[i]) {      // two pieces of one player: a thin seam
          g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 2; g.shadowBlur = 0;
          g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
          continue;
        }
        const ox = -dx * 3, oy = -dy * 3;
        g.shadowColor = col; g.shadowBlur = 14; g.strokeStyle = A.lit(col, 0.35); g.lineWidth = 3.5;
        g.beginPath(); g.moveTo(x1 + ox + (dy ? 4 : 0), y1 + oy + (dx ? 4 : 0)); g.lineTo(x2 + ox - (dy ? 4 : 0), y2 + oy - (dx ? 4 : 0)); g.stroke();
        g.shadowBlur = 0;
      }
    }
    return c;
  };
  function seatColor(seats, s) { return s >= 0 && seats && seats[s] ? seats[s].color : '#8a8a96'; }

  // ---------- events from the rules → animations ----------
  V.event = function (e, st, seats) {
    const now = performance.now(), at = (i) => [R.X(st, i) + 0.5, R.Y(st, i) + 0.5];
    const col = (s) => seatColor(seats, s);
    if (e.t === 'turn') { this.dice = null; }
    else if (e.t === 'roll') { this.dice = { start: now, seat: e.seat, dice: e.dice, got: e.got, lost: e.lost, level: e.level, opts: e.opts, noRoom: e.noRoom }; }
    else if (e.t === 'place') {
      this.anims.push({ kind: 'piece', piece: e.piece, cells: e.cells, start: now, at: e.at, color: col(e.seat) });
      this.tilesKey = '';
      const c = at(e.at); this.burst(c[0], c[1], col(e.seat), 26, 'spark');
    } else if (e.t === 'summon') {
      const c = at(e.at);
      this.disp[e.mon] = { x: c[0], y: c[1], path: null, born: now + 500, flash: 0 };
      this.anims.push({ kind: 'portal', x: c[0], y: c[1], start: now + 350, color: col(e.seat) });
      this.burst(c[0], c[1], '#fff6c0', 30, 'spark', 0.5);
      this.say('✨ ' + D.MONSTERS[e.key].name + ' erscheint', col(e.seat));
    } else if (e.t === 'item') { const c = at(e.at); this.burst(c[0], c[1], col(e.seat), 14, 'spark'); }
    else if (e.t === 'move') {
      const d = this.disp[e.mon];
      if (d) { d.path = e.path.map(at); d.pstart = now; }
    } else if (e.t === 'attack') {
      const d = this.disp[e.mon], t = at(e.at);
      if (d) d.lunge = { tx: t[0], ty: t[1], start: now };
      if (e.dm !== undefined) { this.shake = Math.max(this.shake, 14); }
    } else if (e.t === 'clash') {
      const t = at(e.at);
      if (e.missed) this.float(t[0], t[1] - 0.3, 'Daneben!', '#bfe8ff');
      else if (e.choice === 'defend') { this.anims.push({ kind: 'shield', x: t[0], y: t[1], start: now }); }
      else if (e.choice === 'mirror') { this.anims.push({ kind: 'shield', x: t[0], y: t[1], start: now, mirror: true }); }
      if (e.choice === 'counter') this.float(t[0], t[1] - 0.6, '↩️ Gegenschlag', '#a6d94a');
      this.burst(t[0], t[1], '#ffd08a', 16, 'spark');
    } else if (e.t === 'damage') {
      const d = this.disp[e.mon], c = d ? [d.x, d.y] : at(e.at);
      if (d) d.flash = now;
      this.float(c[0], c[1] - 0.2, '−' + e.n, '#ff5a4e', 1.25);
      this.shake = Math.max(this.shake, 5 + e.n / 6);
      this.burst(c[0], c[1], '#ff7a4a', 10 + e.n / 2, 'spark');
    } else if (e.t === 'heal') {
      const d = this.disp[e.mon], c = d ? [d.x, d.y] : at(e.at);
      this.float(c[0], c[1] - 0.2, '+' + e.n, '#7dff9a', 1.1);
      this.burst(c[0], c[1], '#7dff9a', 14, 'mote');
    } else if (e.t === 'crystal') { const c = at(e.at); this.float(c[0], c[1] - 0.3, '+' + e.n + ' ✨', '#e070ff'); }
    else if (e.t === 'destroy' || e.t === 'vanish') {
      const d = this.disp[e.mon], c = d ? [d.x, d.y] : at(e.at);
      if (d) this.gone.push({ key: e.key, x: c[0], y: c[1], seat: e.seat, start: now + (e.t === 'destroy' ? 250 : 0) });
      delete this.disp[e.mon];
      this.burst(c[0], c[1], e.t === 'destroy' ? '#ffb070' : '#9a9aaa', e.t === 'destroy' ? 40 : 18, 'shard');
      if (e.t === 'destroy') { this.shake = Math.max(this.shake, 12); this.say('💥 ' + D.MONSTERS[e.key].name + ' zerstört', '#ff8a5a'); }
    } else if (e.t === 'heart') {
      const c = at(e.at);
      this.anims.push({ kind: 'heart', x: c[0], y: c[1], start: now, color: col(e.seat) });
      this.burst(c[0], c[1], '#ff3b5c', 46, 'shard');
      this.shake = Math.max(this.shake, 22);
      this.big = { text: '💔 ' + (seats[e.seat] ? seats[e.seat].name : '') + ' verliert ein Herz!', color: col(e.seat), start: now, dur: 2200 };
    } else if (e.t === 'out') {
      this.big = { text: '💀 ' + (seats[e.seat] ? seats[e.seat].name : '') + ' ist ausgeschieden', color: col(e.seat), start: now + 900, dur: 2800 };
    } else if (e.t === 'trap') {
      const c = at(e.at);
      this.anims.push({ kind: 'trap', x: c[0], y: c[1], start: now, key: e.key });
      this.say((D.ITEMS[e.key].icon) + ' ' + D.ITEMS[e.key].name + ' schnappt zu!', col(e.seat));
    } else if (e.t === 'ability') {
      const c = at(e.at), ab = D.ABIL[e.ab];
      this.anims.push({ kind: 'cast', x: c[0], y: c[1], start: now, ab: e.ab, color: col(e.seat) });
      if (e.tgt) { const t = st.mons.find((m) => m.id === e.tgt); if (t) this.anims.push({ kind: 'bolt', x: c[0], y: c[1], tx: R.X(st, t.at) + 0.5, ty: R.Y(st, t.at) + 0.5, start: now, ab: e.ab }); }
      if (ab.range && ab.target === 'none') this.anims.push({ kind: 'ring', x: c[0], y: c[1], start: now, r: ab.range + 0.5, color: e.ab === 'aura' ? '#7dff9a' : e.ab === 'wave' ? '#5ad1ff' : '#ff7a2a' });
      this.say(ab.icon + ' ' + ab.name, col(e.seat));
    } else if (e.t === 'status') { const c = at(e.at); this.float(c[0], c[1] - 0.4, e.what === 'freeze' ? '❄️ eingefroren' : '🌱 gefesselt', e.what === 'freeze' ? '#bfe8ff' : '#9be36a'); }
    else if (e.t === 'swap') {
      const a = this.disp[e.a], b = this.disp[e.b];
      if (a && b) { const t = [a.x, a.y]; a.x = b.x; a.y = b.y; b.x = t[0]; b.y = t[1]; this.burst(a.x, a.y, '#5ad1ff', 12, 'mote'); this.burst(b.x, b.y, '#5ad1ff', 12, 'mote'); }
    } else if (e.t === 'crumble') { this.tilesKey = ''; for (const i of e.cells) { const c = at(i); this.burst(c[0], c[1], '#6a6470', 4, 'shard'); } }
    else if (e.t === 'over') { this.big = null; this.confettiAt = now; }
  };
  V.say = function (text, color) { this.toast = { text, color, start: performance.now() }; };
  V.float = function (x, y, text, color, scale) { this.floats.push({ x, y, text, color, start: performance.now(), scale: scale || 1 }); };
  V.burst = function (x, y, color, n, kind, delay) {
    const now = performance.now() + (delay || 0) * 1000;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = (kind === 'mote' ? 0.6 : 1.4) + Math.random() * (kind === 'shard' ? 3.4 : 2.2);
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'mote' ? 0.8 : 0), start: now, life: 0.5 + Math.random() * 0.7, color, kind, size: kind === 'shard' ? 0.05 + Math.random() * 0.07 : 0.03 + Math.random() * 0.05, rot: Math.random() * TAU });
    }
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
  };

  // keep display positions in step with the rules (new monsters after a reload, swaps, teleports)
  V.sync = function (st) {
    const live = {};
    for (const m of st.mons) {
      live[m.id] = 1;
      const x = R.X(st, m.at) + 0.5, y = R.Y(st, m.at) + 0.5, d = this.disp[m.id];
      if (!d) this.disp[m.id] = { x, y, path: null, born: 0, flash: 0 };
      else if (!d.path && (Math.abs(d.x - x) > 0.01 || Math.abs(d.y - y) > 0.01)) { d.x += (x - d.x) * 0.35; d.y += (y - d.y) * 0.35; }
    }
    for (const id in this.disp) if (!live[id]) delete this.disp[id];
  };

  // ---------- drawing ----------
  V.draw = function (M) {
    const g = this.g, W = this.W, H = this.H, U = this.U, now = performance.now();
    const dt = Math.min(0.05, (now - (this.lastT || now)) / 1000); this.lastT = now;
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBackdrop(g, W, H, now);
    if (M.phase === 'prep' || !M.st) { this.drawPrep(g, M, now); return; }
    const st = M.st, L = this.layout(st);
    if (this.boardKey !== st.w + 'x' + st.h) this.reset(st);
    this.sync(st);
    // camera
    if (now > this.manualUntil) {
      const goal = this.camGoal || { x: st.w / 2, y: st.h / 2, z: 1 }, k = 1 - Math.exp(-dt * 2.6);
      this.cam.x += (goal.x - this.cam.x) * k; this.cam.y += (goal.y - this.cam.y) * k; this.cam.z += (goal.z - this.cam.z) * k;
    }
    // shake
    this.shake *= Math.exp(-dt * 7);
    const sx = (Math.random() - 0.5) * this.shake * U, sy = (Math.random() - 0.5) * this.shake * U;
    g.save(); g.translate(sx, sy);
    g.save(); g.beginPath(); g.rect(L.ax - L.pad * 0.5, L.ay - L.pad * 0.5, L.aw + L.pad, L.ah + L.pad); g.clip();
    this.drawBoard(g, L, st, M, now, dt);
    g.restore();
    g.restore();
    this.drawPanels(g, L, M, now);
    this.drawTopBar(g, L, M, now);
    this.drawDice(g, L, M, now);
    this.drawLog(g, L, M, now);
    this.drawBig(g, L, M, now);
    if (M.over) this.drawOver(g, L, M, now);
  };

  V.drawBackdrop = function (g, W, H, now) {
    const gr = g.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H / 2, Math.max(W, H) * 0.75);
    gr.addColorStop(0, '#1b1626'); gr.addColorStop(0.6, '#0e0b15'); gr.addColorStop(1, '#060509');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    if (!this.stars) { const r = seeded(99); this.stars = Array.from({ length: 70 }, () => [r(), r(), r()]); }
    for (const [x, y, s] of this.stars) {
      const a = 0.08 + 0.12 * Math.sin(now / 1400 + s * 20);
      g.fillStyle = 'rgba(200,170,255,' + a.toFixed(3) + ')'; g.beginPath(); g.arc(x * W, y * H, (0.8 + s * 1.8) * this.U * 2, 0, TAU); g.fill();
    }
  };

  V.drawBoard = function (g, L, st, M, now, dt) {
    const U = this.U, seats = M.seats;
    const [ox, oy, cs] = this.toScreen(L, 0, 0);
    const bw = st.w * cs, bh = st.h * cs;
    // frame
    const fr = 14 * U * this.cam.z;
    rr(g, ox - fr, oy - fr, bw + 2 * fr, bh + 2 * fr, 10 * U); g.fillStyle = '#2a2230'; g.fill();
    g.lineWidth = 3 * U; g.strokeStyle = '#4a3c50'; g.stroke();
    rr(g, ox - fr * 0.45, oy - fr * 0.45, bw + fr * 0.9, bh + fr * 0.9, 6 * U); g.strokeStyle = 'rgba(214,170,90,.35)'; g.lineWidth = 1.5 * U; g.stroke();
    for (const [cx, cy] of [[ox - fr / 2, oy - fr / 2], [ox + bw + fr / 2, oy - fr / 2], [ox - fr / 2, oy + bh + fr / 2], [ox + bw + fr / 2, oy + bh + fr / 2]]) {
      g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4); g.fillStyle = '#d6aa5a'; g.fillRect(-fr * 0.35, -fr * 0.35, fr * 0.7, fr * 0.7); g.restore();
    }
    if (!this.floor) this.floor = this.buildFloor(st);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.floor, ox, oy, bw, bh);
    // tiles (pieces that are still unfolding are drawn live)
    this.anims = this.anims.filter((a) => now - a.start < (a.kind === 'piece' ? 1100 : 1800));
    const unfolding = new Set(this.anims.filter((a) => a.kind === 'piece').map((a) => a.piece));
    const key = st.pieces.length + ':' + [...unfolding].join(',') + ':' + st.kind.reduce((s, k) => s + k, 0) + ':' + seats.map((x) => x.color).join('');
    if (this.tilesKey !== key) { this.tiles = this.buildTiles(st, unfolding, seats); this.tilesKey = key; }
    g.drawImage(this.tiles, ox, oy, bw, bh);
    for (const a of this.anims) if (a.kind === 'piece') this.drawUnfold(g, L, st, a, now);

    // overlays under the tokens: reach, preview, targets
    if (M.reach) for (const r of M.reach) {
      const [x, y] = this.toScreen(L, R.X(st, r.at), R.Y(st, r.at)), pulse = 0.5 + 0.5 * Math.sin(now / 300 + r.at);
      g.fillStyle = 'rgba(63,208,201,' + (0.16 + 0.1 * pulse).toFixed(3) + ')'; rr(g, x + cs * 0.08, y + cs * 0.08, cs * 0.84, cs * 0.84, cs * 0.12); g.fill();
      g.strokeStyle = 'rgba(120,255,240,.5)'; g.lineWidth = Math.max(1, cs * 0.03); g.stroke();
      g.fillStyle = '#c9fffb'; g.font = '700 ' + Math.round(cs * 0.26) + 'px ' + SANS; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(r.cost, x + cs * 0.5, y + cs * 0.52);
    }
    if (M.preview) this.drawPreview(g, L, st, M, now);

    // masters
    for (const s of st.seats) this.drawMaster(g, L, st, s, M, now);
    // items
    for (const it of st.items) {
      const [x, y] = this.toScreen(L, R.X(st, it.at), R.Y(st, it.at)), col = seatColor(seats, it.seat);
      const cx = x + cs / 2, cy = y + cs / 2, r = cs * 0.3;
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = 'rgba(16,14,22,.85)'; g.fill();
      g.strokeStyle = A.rgba(col, 0.6 + 0.2 * Math.sin(now / 500 + it.at)); g.lineWidth = Math.max(1.5, cs * 0.05); g.stroke();
      g.fillStyle = A.lit(col, 0.4); g.font = '700 ' + Math.round(cs * 0.3) + 'px ' + SERIF; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(it.revealed && D.ITEMS[it.key] ? D.ITEMS[it.key].icon : 'ᛝ', cx, cy + cs * 0.02);
    }
    // monsters: sorted by y so lower ones overlap
    const list = st.mons.slice().sort((a, b) => (this.disp[a.id] ? this.disp[a.id].y : 0) - (this.disp[b.id] ? this.disp[b.id].y : 0));
    for (const m of list) this.drawToken(g, L, st, m, M, now, dt);
    // dying tokens
    this.gone = this.gone.filter((d) => now - d.start < 700);
    for (const d of this.gone) {
      const t = (now - d.start) / 700; if (t < 0) continue;
      const [x, y] = this.toScreen(L, d.x - 0.5, d.y - 0.5);
      g.save(); g.globalAlpha = 1 - t; g.translate(x + cs / 2, y + cs / 2); g.scale(1 + t * 0.6, 1 + t * 0.6); g.rotate(t * 0.6);
      const p = A.portrait(d.key, this.pxFor(cs)); if (p) { g.beginPath(); g.arc(0, 0, cs * 0.38, 0, TAU); g.clip(); g.drawImage(p, -cs * 0.38, -cs * 0.38, cs * 0.76, cs * 0.76); }
      g.restore();
    }
    // targets of an attack the phone is aiming
    if (M.targets) for (const i of M.targets) {
      const [x, y] = this.toScreen(L, R.X(st, i), R.Y(st, i)), p = 0.5 + 0.5 * Math.sin(now / 160);
      g.beginPath(); g.arc(x + cs / 2, y + cs / 2, cs * (0.48 + p * 0.06), 0, TAU); g.strokeStyle = 'rgba(255,80,60,' + (0.6 + p * 0.4).toFixed(3) + ')'; g.lineWidth = cs * 0.07; g.stroke();
      g.save(); g.translate(x + cs / 2, y + cs / 2);
      for (let k = 0; k < 4; k++) { g.rotate(Math.PI / 2); g.beginPath(); g.moveTo(cs * 0.56, 0); g.lineTo(cs * 0.7, 0); g.strokeStyle = '#ff5a3c'; g.lineWidth = cs * 0.05; g.stroke(); }
      g.restore();
    }
    // the defence prompt: who hits whom
    if (M.pending) {
      const a = st.mons.find((m) => m.id === M.pending.att), t = st.mons.find((m) => m.id === M.pending.tgt);
      if (a && t) {
        const [x1, y1] = this.toScreen(L, R.X(st, a.at) + 0.5, R.Y(st, a.at) + 0.5), [x2, y2] = this.toScreen(L, R.X(st, t.at) + 0.5, R.Y(st, t.at) + 0.5);
        g.save(); g.setLineDash([cs * 0.12, cs * 0.1]); g.lineDashOffset = -now / 30;
        g.strokeStyle = '#ff6a4a'; g.lineWidth = cs * 0.08; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.restore();
      }
    }
    // effects
    for (const a of this.anims) this.drawAnim(g, L, st, a, now);
    this.drawParts(g, L, now, dt);
    this.drawFloats(g, L, now);
  };

  V.pxFor = function (cs) { const want = cs * 0.8 * (this.U > 1.2 ? 1 : 1.25); return want > 150 ? 256 : want > 100 ? 160 : want > 64 ? 112 : 72; };

  V.drawUnfold = function (g, L, st, a, now) {
    const t = (now - a.start) / 1000, cs = L.cs0 * this.cam.z;
    const order = a.cells.slice().sort((p, q) => R.dist(st, p, a.at) - R.dist(st, q, a.at));
    order.forEach((i, k) => {
      const lt = clampN((t - k * 0.09) / 0.35, 0, 1);
      if (lt <= 0) return;
      const [x, y] = this.toScreen(L, R.X(st, i), R.Y(st, i)), s = ease(lt);
      g.save(); g.translate(x + cs / 2, y + cs / 2); g.scale(s, s);
      rr(g, -cs / 2 + 1, -cs / 2 + 1, cs - 2, cs - 2, cs * 0.07);
      g.fillStyle = A.mix('#4b4655', a.color, 0.25 + 0.5 * (1 - lt)); g.fill();
      g.shadowColor = a.color; g.shadowBlur = 20 * (1 - lt) + 6; g.strokeStyle = A.lit(a.color, 0.4); g.lineWidth = cs * 0.05; g.stroke();
      g.restore();
    });
  };

  V.drawPreview = function (g, L, st, M, now) {
    const P = M.preview, cs = L.cs0 * this.cam.z, col = P.ok ? '#ffd36a' : '#ff4a4a';
    if (P.anchors) for (const [ax, ay] of P.anchors) {
      const [x, y] = this.toScreen(L, ax + 0.5, ay + 0.5);
      g.beginPath(); g.arc(x, y, cs * 0.07, 0, TAU); g.fillStyle = A.rgba(P.color, 0.55); g.fill();
    }
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    for (const [cx, cy] of P.cells) {
      const [x, y] = this.toScreen(L, cx, cy);
      rr(g, x + cs * 0.05, y + cs * 0.05, cs * 0.9, cs * 0.9, cs * 0.1);
      g.fillStyle = A.rgba(col, P.ok ? 0.3 + 0.16 * pulse : 0.3); g.fill();
      g.save(); g.setLineDash([cs * 0.14, cs * 0.08]); g.lineDashOffset = -now / 40;
      g.strokeStyle = P.ok ? P.color : '#ff7a7a'; g.lineWidth = cs * 0.06; g.stroke(); g.restore();
      if (!P.ok) { g.strokeStyle = 'rgba(255,90,90,.6)'; g.lineWidth = cs * 0.04; g.beginPath(); g.moveTo(x + cs * 0.3, y + cs * 0.3); g.lineTo(x + cs * 0.7, y + cs * 0.7); g.moveTo(x + cs * 0.7, y + cs * 0.3); g.lineTo(x + cs * 0.3, y + cs * 0.7); g.stroke(); }
    }
    if (P.key && P.anchor) {
      const [x, y] = this.toScreen(L, P.anchor[0] + 0.5, P.anchor[1] + 0.5), p = A.portrait(P.key, this.pxFor(cs));
      g.save(); g.globalAlpha = 0.75; g.beginPath(); g.arc(x, y, cs * 0.36, 0, TAU); g.clip(); if (p) g.drawImage(p, x - cs * 0.36, y - cs * 0.36, cs * 0.72, cs * 0.72); g.restore();
    }
    if (!P.ok && P.why) {
      const [x, y] = this.toScreen(L, P.anchor[0] + 0.5, P.anchor[1] - 0.9);
      const txt = { out: '⛔ ragt über den Rand', taken: '⛔ dort liegt schon ein Weg', alone: '⛔ muss an deinen Weg grenzen' }[P.why] || '⛔';
      g.font = '700 ' + Math.round(18 * this.U) + 'px ' + SANS; const w = g.measureText(txt).width + 20 * this.U;
      rr(g, x - w / 2, y - 16 * this.U, w, 32 * this.U, 10 * this.U); g.fillStyle = 'rgba(40,6,10,.88)'; g.fill();
      g.fillStyle = '#ffb0b0'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, x, y);
    }
  };

  V.drawMaster = function (g, L, st, s, M, now) {
    const [x, y, cs] = this.toScreen(L, R.X(st, s.dm), R.Y(st, s.dm)), col = seatColor(M.seats, s.i), cx = x + cs / 2, cy = y + cs / 2;
    const active = st.turn.seat === s.i && !st.over, alive = s.alive;
    // pedestal
    g.save();
    if (active) { const gl = g.createRadialGradient(cx, cy, 2, cx, cy, cs * 1.3); gl.addColorStop(0, A.rgba(col, 0.45 + 0.2 * Math.sin(now / 300))); gl.addColorStop(1, A.rgba(col, 0)); g.fillStyle = gl; g.fillRect(cx - cs * 1.3, cy - cs * 1.3, cs * 2.6, cs * 2.6); }
    g.beginPath();
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + Math.PI / 8; g.lineTo(cx + Math.cos(a) * cs * 0.5, cy + Math.sin(a) * cs * 0.5); }
    g.closePath();
    const pg = g.createLinearGradient(cx, cy - cs / 2, cx, cy + cs / 2); pg.addColorStop(0, alive ? '#5a5266' : '#3a3640'); pg.addColorStop(1, alive ? '#26222c' : '#1a181e');
    g.fillStyle = pg; g.fill(); g.strokeStyle = alive ? A.lit(col, 0.2) : '#555'; g.lineWidth = cs * 0.05; g.stroke();
    // floating crystal
    const bob = alive ? Math.sin(now / 500 + s.i) * cs * 0.04 : 0, h = cs * 0.34;
    if (alive) {
      const cg = g.createLinearGradient(cx - h * 0.5, cy - h, cx + h * 0.5, cy + h);
      cg.addColorStop(0, A.lit(col, 0.7)); cg.addColorStop(0.5, col); cg.addColorStop(1, A.drk(col, 0.5));
      g.shadowColor = col; g.shadowBlur = cs * 0.4;
      g.beginPath(); g.moveTo(cx, cy - h + bob); g.lineTo(cx + h * 0.55, cy + bob); g.lineTo(cx, cy + h + bob); g.lineTo(cx - h * 0.55, cy + bob); g.closePath();
      g.fillStyle = cg; g.fill(); g.shadowBlur = 0; g.strokeStyle = A.lit(col, 0.6); g.lineWidth = cs * 0.02; g.stroke();
      g.beginPath(); g.moveTo(cx - h * 0.55, cy + bob); g.lineTo(cx + h * 0.55, cy + bob); g.strokeStyle = 'rgba(255,255,255,.35)'; g.stroke();
      // crown
      g.fillStyle = '#ffd36a'; g.beginPath();
      const cyc = cy - h - cs * 0.05 + bob;
      g.moveTo(cx - cs * 0.16, cyc); g.lineTo(cx - cs * 0.16, cyc - cs * 0.1); g.lineTo(cx - cs * 0.08, cyc - cs * 0.04); g.lineTo(cx, cyc - cs * 0.13); g.lineTo(cx + cs * 0.08, cyc - cs * 0.04); g.lineTo(cx + cs * 0.16, cyc - cs * 0.1); g.lineTo(cx + cs * 0.16, cyc); g.closePath(); g.fill();
    } else {
      g.fillStyle = '#4a4650';
      for (const [dx, dy, r] of [[-0.18, 0.1, 0.4], [0.15, 0.14, -0.6], [0.02, -0.08, 1.2]]) { g.save(); g.translate(cx + dx * cs, cy + dy * cs); g.rotate(r); g.fillRect(-cs * 0.08, -cs * 0.05, cs * 0.16, cs * 0.1); g.restore(); }
    }
    g.restore();
    // hearts: a small row across the foot of the master's cell
    const n = st.cfg.hearts, hs = Math.min(cs * 0.26, cs * 0.92 / n);
    for (let k = 0; k < n; k++) heart(g, cx + (k - (n - 1) / 2) * hs * 1.05, y + cs * 0.86, hs, k < s.hearts ? '#ff3b5c' : 'rgba(90,80,100,.8)', k < s.hearts);
  };
  function heart(g, x, y, s, c, full) {
    g.save(); g.translate(x, y); g.scale(s / 24, s / 24);
    g.beginPath(); g.moveTo(0, 8); g.bezierCurveTo(-14, -2, -10, -14, 0, -6); g.bezierCurveTo(10, -14, 14, -2, 0, 8); g.closePath();
    if (full) { g.shadowColor = '#ff2050'; g.shadowBlur = 10; }
    g.fillStyle = c; g.fill(); g.shadowBlur = 0;
    g.lineWidth = 1.6; g.strokeStyle = full ? '#ffb3c2' : 'rgba(0,0,0,.5)'; g.stroke();
    g.restore();
  }

  V.drawToken = function (g, L, st, m, M, now, dt) {
    const d = this.disp[m.id]; if (!d) return;
    const cs = L.cs0 * this.cam.z, def = D.MONSTERS[m.key];
    // walking along the path: 7 cells a second
    if (d.path) {
      const t = (now - d.pstart) / 1000 * 7, seg = Math.floor(t);
      if (seg >= d.path.length - 1) { const e = d.path[d.path.length - 1]; d.x = e[0]; d.y = e[1]; d.path = null; }
      else { const a = d.path[seg], b = d.path[seg + 1], f = ease(t - seg); d.x = a[0] + (b[0] - a[0]) * f; d.y = a[1] + (b[1] - a[1]) * f; d.hop = Math.sin((t - seg) * Math.PI) * 0.12; }
    } else d.hop = 0;
    let lx = 0, ly = 0;
    if (d.lunge) {
      const t = (now - d.lunge.start) / 380;
      if (t >= 1) d.lunge = null;
      else { const k = Math.sin(t * Math.PI) * 0.38, dx = d.lunge.tx - d.x, dy = d.lunge.ty - d.y, n = Math.hypot(dx, dy) || 1; lx = dx / n * k; ly = dy / n * k; }
    }
    const born = clampN((now - d.born) / 450, 0, 1);
    if (born <= 0) return;
    const active = st.turn.seat === m.seat && !st.over;
    const bob = active ? Math.sin(now / 420 + m.id) * 0.03 : 0;
    const [x, y] = this.toScreen(L, d.x + lx, d.y + ly - (d.hop || 0) - bob);
    const r = cs * 0.43 * ease(born) * (d.flash && now - d.flash < 160 ? 1.08 : 1), col = seatColor(M.seats, m.seat);
    // shadow
    g.beginPath(); g.ellipse(x, y + cs * 0.36 + bob * cs, r * 0.85, r * 0.28, 0, 0, TAU); g.fillStyle = 'rgba(0,0,0,.45)'; g.fill();
    if (M.sel === m.id) {
      const p = 0.5 + 0.5 * Math.sin(now / 200);
      g.beginPath(); g.arc(x, y, r * (1.22 + p * 0.08), 0, TAU); g.strokeStyle = A.rgba('#fff3a0', 0.6 + 0.4 * p); g.lineWidth = cs * 0.05; g.stroke();
    }
    // ring
    const rg = g.createLinearGradient(x, y - r, x, y + r); rg.addColorStop(0, A.lit(col, 0.45)); rg.addColorStop(1, A.drk(col, 0.35));
    g.beginPath(); g.arc(x, y, r * 1.1, 0, TAU); g.fillStyle = rg; g.fill();
    if (active && (R.canMove(st, m) || R.canAttack(st, m))) { g.shadowColor = col; g.shadowBlur = cs * 0.3; g.strokeStyle = A.lit(col, 0.5); g.lineWidth = cs * 0.03; g.stroke(); g.shadowBlur = 0; }
    // portrait
    const p = A.portrait(m.key, this.pxFor(cs));
    g.save(); g.beginPath(); g.arc(x, y, r * 0.94, 0, TAU); g.clip();
    if (p) g.drawImage(p, x - r * 0.94, y - r * 0.94, r * 1.88, r * 1.88);
    if (m.seat < 0) { g.fillStyle = 'rgba(80,80,90,.55)'; g.fillRect(x - r, y - r, r * 2, r * 2); }
    if (d.flash && now - d.flash < 220) { g.fillStyle = 'rgba(255,60,40,' + (0.55 * (1 - (now - d.flash) / 220)).toFixed(3) + ')'; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.restore();
    // gloss
    g.beginPath(); g.arc(x, y, r * 0.94, Math.PI * 1.1, Math.PI * 1.75); g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = r * 0.08; g.stroke();
    // hp bar
    const bw = r * 1.7, bh = Math.max(3, r * 0.2), bx = x - bw / 2, by = y + r * 0.98;
    rr(g, bx, by, bw, bh, bh / 2); g.fillStyle = 'rgba(10,8,14,.9)'; g.fill();
    const f = clampN(m.hp / m.maxHp, 0, 1), hc = f > 0.6 ? '#55e07a' : f > 0.3 ? '#f2c94c' : '#ff5a4e';
    if (f > 0) { rr(g, bx + 1, by + 1, Math.max(bh - 2, (bw - 2) * f), bh - 2, (bh - 2) / 2); g.fillStyle = hc; g.fill(); }
    const segs = m.maxHp / 10;
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1;
    for (let k = 1; k < segs; k++) { const sx = bx + bw * k / segs; g.beginPath(); g.moveTo(sx, by + 1); g.lineTo(sx, by + bh - 1); g.stroke(); }
    if (cs > 34) { g.fillStyle = '#fff'; g.font = '800 ' + Math.round(bh * 1.25) + 'px ' + SANS; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(m.hp, x, by - 0.5); }
    // level pips
    for (let k = 0; k < def.level; k++) {
      const px = x - (def.level - 1) * r * 0.16 + k * r * 0.32, py = y - r * 1.12;
      g.beginPath(); g.arc(px, py, r * 0.11, 0, TAU); g.fillStyle = '#ffd36a'; g.fill(); g.strokeStyle = '#5a3a10'; g.lineWidth = 1; g.stroke();
    }
    // states
    const badges = [];
    if (m.frozenNow || m.frozenNext) badges.push('❄️');
    else if (m.rootNow || m.rootNext) badges.push('🌱');
    if (m.atkBuff) badges.push('😤');
    if (badges.length) { g.font = Math.round(r * 0.5) + 'px ' + SANS; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(badges.join(''), x + r * 0.9, y - r * 0.8); }
  };

  V.drawAnim = function (g, L, st, a, now) {
    const t = (now - a.start) / 1000; if (t < 0) return;
    const cs = L.cs0 * this.cam.z;
    if (a.kind === 'portal') {
      const [x, y] = this.toScreen(L, a.x, a.y), k = clampN(t / 1.1, 0, 1);
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(x, y, cs * (0.2 + k * (0.7 + i * 0.25)), 0, TAU); g.strokeStyle = A.rgba(a.color, (1 - k) * (0.8 - i * 0.2)); g.lineWidth = cs * 0.06; g.stroke(); }
      const bg = g.createLinearGradient(x, y - cs * 2.5, x, y); bg.addColorStop(0, A.rgba('#fff6c0', 0)); bg.addColorStop(1, A.rgba('#fff6c0', 0.6 * (1 - k)));
      g.fillStyle = bg; g.fillRect(x - cs * 0.25 * (1 - k * 0.5), y - cs * 2.5, cs * 0.5 * (1 - k * 0.5), cs * 2.5);
      g.restore();
    } else if (a.kind === 'shield') {
      const [x, y] = this.toScreen(L, a.x, a.y), k = clampN(t / 0.9, 0, 1);
      g.save(); g.globalAlpha = 1 - k; g.translate(x, y); g.scale(1 + k * 0.3, 1 + k * 0.3);
      A.drawCrest(g, 'DEF', 0, 0, cs * 0.9, a.mirror ? '#d8f4ff' : '#8fb4ff'); g.restore();
    } else if (a.kind === 'heart') {
      const [x, y] = this.toScreen(L, a.x, a.y - 0.6 - t * 0.8), k = clampN(t / 1.6, 0, 1);
      g.save(); g.globalAlpha = 1 - k; heart(g, x - k * cs * 0.3, y, cs * (0.9 + k), '#ff3b5c', true); heart(g, x + k * cs * 0.3, y, cs * (0.9 + k), '#ff3b5c', true); g.restore();
    } else if (a.kind === 'trap') {
      const [x, y] = this.toScreen(L, a.x, a.y), k = clampN(t / 0.8, 0, 1);
      g.save(); g.translate(x, y); g.scale(0.5 + k * 0.8, 0.5 + k * 0.8); g.globalAlpha = 1 - k * k;
      A.drawCrest(g, 'TRP', 0, 0, cs, '#c8ff6a'); g.restore();
    } else if (a.kind === 'cast') {
      const [x, y] = this.toScreen(L, a.x, a.y), k = clampN(t / 0.9, 0, 1);
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) { const ang = i / 6 * TAU + t * 4; g.beginPath(); g.arc(x + Math.cos(ang) * cs * 0.5, y + Math.sin(ang) * cs * 0.5, cs * 0.07 * (1 - k), 0, TAU); g.fillStyle = A.rgba('#e070ff', 1 - k); g.fill(); }
      g.restore();
    } else if (a.kind === 'bolt') {
      const k = clampN(t / 0.5, 0, 1), [x1, y1] = this.toScreen(L, a.x, a.y), [x2, y2] = this.toScreen(L, a.tx, a.ty);
      const px = x1 + (x2 - x1) * ease(k), py = y1 + (y2 - y1) * ease(k);
      const c = a.ab === 'freeze' ? '#bfe8ff' : a.ab === 'root' ? '#9be36a' : a.ab === 'heal' ? '#7dff9a' : a.ab === 'swap' ? '#5ad1ff' : a.ab === 'bolt2' ? '#b07aff' : '#ff8a2a';
      g.save(); g.globalCompositeOperation = 'lighter';
      const gr = g.createRadialGradient(px, py, 0, px, py, cs * 0.5); gr.addColorStop(0, A.rgba('#ffffff', 1 - k * 0.5)); gr.addColorStop(0.3, A.rgba(c, 0.9)); gr.addColorStop(1, A.rgba(c, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(px, py, cs * 0.5, 0, TAU); g.fill(); g.restore();
    } else if (a.kind === 'ring') {
      const [x, y] = this.toScreen(L, a.x, a.y), k = clampN(t / 1, 0, 1);
      g.save(); g.globalCompositeOperation = 'lighter'; g.beginPath(); g.arc(x, y, cs * a.r * ease(k), 0, TAU);
      g.strokeStyle = A.rgba(a.color, 1 - k); g.lineWidth = cs * 0.25 * (1 - k) + 2; g.stroke(); g.restore();
    }
  };

  V.drawParts = function (g, L, now, dt) {
    const cs = L.cs0 * this.cam.z;
    g.save(); g.globalCompositeOperation = 'lighter';
    this.parts = this.parts.filter((p) => (now - p.start) / 1000 < p.life);
    for (const p of this.parts) {
      const t = (now - p.start) / 1000; if (t < 0) continue;
      const k = t / p.life, x = p.x + p.vx * t * (1 - k * 0.4), y = p.y + p.vy * t + (p.kind === 'shard' ? 2.2 * t * t : p.kind === 'mote' ? -0.4 * t : 0.8 * t * t);
      const [sx, sy] = this.toScreen(L, x, y);
      g.globalAlpha = 1 - k;
      if (p.kind === 'shard') { g.save(); g.translate(sx, sy); g.rotate(p.rot + t * 6); g.fillStyle = p.color; g.fillRect(-cs * p.size, -cs * p.size * 0.5, cs * p.size * 2, cs * p.size); g.restore(); }
      else { g.beginPath(); g.arc(sx, sy, cs * p.size * (1 - k * 0.5), 0, TAU); g.fillStyle = p.color; g.fill(); }
    }
    g.restore();
  };
  V.drawFloats = function (g, L, now) {
    const cs = L.cs0 * this.cam.z;
    this.floats = this.floats.filter((f) => now - f.start < 1500);
    for (const f of this.floats) {
      const t = (now - f.start) / 1500, [x, y] = this.toScreen(L, f.x, f.y - t * 0.9);
      g.save(); g.globalAlpha = t < 0.75 ? 1 : 1 - (t - 0.75) * 4;
      const s = Math.round(cs * 0.42 * f.scale * (t < 0.12 ? 0.6 + t * 3.3 : 1));
      g.font = '900 ' + s + 'px ' + SANS; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = s * 0.16; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(f.text, x, y); g.fillStyle = f.color; g.fillText(f.text, x, y);
      g.restore();
    }
  };

  // ---------- around the board ----------
  // which corner each seat's panel takes: next to its master
  function panelSlots(n) {
    if (n <= 2) return ['lb', 'rt'];
    if (n === 3) return ['lb', 'lt', 'rt'];
    return ['lb', 'rt', 'lt', 'rb'];
  }
  V.drawPanels = function (g, L, M, now) {
    const st = M.st, U = this.U, slots = panelSlots(st.n), pw = L.side - 28 * U, ph = 236 * U;
    for (let s = 0; s < st.n; s++) {
      const slot = slots[s], x = slot[0] === 'l' ? 14 * U : this.W - 14 * U - pw, y = slot[1] === 't' ? L.top - 6 * U : this.H - 14 * U - ph;
      this.panel(g, x, y, pw, ph, st.seats[s], M.seats[s], st, M, now);
    }
  };
  V.panel = function (g, x, y, w, h, s, P, st, M, now) {
    const U = this.U, col = P.color, active = st.turn.seat === s.i && !st.over;
    g.save();
    if (active) { g.shadowColor = col; g.shadowBlur = 30 * U * (0.7 + 0.3 * Math.sin(now / 350)); }
    rr(g, x, y, w, h, 18 * U);
    const bg = g.createLinearGradient(x, y, x, y + h); bg.addColorStop(0, active ? A.mix('#1e1828', col, 0.18) : '#191520'); bg.addColorStop(1, '#100d15');
    g.fillStyle = bg; g.fill(); g.shadowBlur = 0;
    g.lineWidth = (active ? 3.5 : 1.5) * U; g.strokeStyle = active ? col : A.rgba(col, 0.45); g.stroke();
    // colour bar + bag emblem
    rr(g, x, y, 12 * U, h, 6 * U); g.fillStyle = col; g.fill();
    const bag = D.BAGS[s.bag];
    g.font = Math.round(30 * U) + 'px ' + SANS; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(bag ? bag.emoji : '🎲', x + 26 * U, y + 34 * U);
    g.fillStyle = s.alive ? '#fff' : '#8a8494'; g.font = '700 ' + Math.round(30 * U) + 'px ' + SERIF;
    let name = P.name || ('Spieler ' + (s.i + 1));
    while (g.measureText(name).width > w - 110 * U && name.length > 3) name = name.slice(0, -2) + '…';
    g.fillText(name, x + 66 * U, y + 34 * U);
    g.font = '600 ' + Math.round(17 * U) + 'px ' + SANS; g.fillStyle = A.rgba(col, 0.95);
    g.fillText((P.bot ? '🤖 ' : '') + D.SEATS[s.i].name + ' · ' + (bag ? bag.name : ''), x + 26 * U, y + 70 * U);
    // hearts
    for (let k = 0; k < st.cfg.hearts; k++) heart(g, x + 44 * U + k * 44 * U, y + 112 * U, 40 * U, k < s.hearts ? '#ff3b5c' : 'rgba(90,80,100,.7)', k < s.hearts);
    // status line
    let status, sc = '#cfc8da';
    if (!s.alive) { status = '💀 ausgeschieden'; sc = '#8a8494'; }
    else if (st.over) status = st.over.winners.indexOf(s.i) >= 0 ? '🏆 Sieg!' : '';
    else if (active) { status = st.turn.pending ? '⚔️ greift an …' : '▶ ' + STAGE_TXT[st.turn.stage]; sc = '#fff'; }
    else if (st.turn.pending && st.turn.pending.seat === s.i) { status = '🛡️ wehrt sich …'; sc = '#ffd36a'; }
    else status = 'wartet';
    if (P.offline && s.alive && !st.over) { status = '💤 weg · Bot spielt'; sc = '#ffb36a'; }
    g.font = '600 ' + Math.round(20 * U) + 'px ' + SANS; g.fillStyle = sc; g.fillText(status, x + 26 * U, y + 158 * U);
    // dice and monsters
    const free = s.dice.filter((d) => !d.used).length, mons = st.mons.filter((m) => m.seat === s.i).length;
    g.font = '600 ' + Math.round(19 * U) + 'px ' + SANS; g.fillStyle = '#b8b0c6';
    g.fillText('🎲 ' + free + ' Würfel   👾 ' + mons + ' Monster', x + 26 * U, y + 198 * U);
    if (active && M.turnLeft > 0 && M.turnTotal > 0) {
      const f = clampN(M.turnLeft / M.turnTotal, 0, 1);
      rr(g, x + 26 * U, y + h - 14 * U, (w - 44 * U), 6 * U, 3 * U); g.fillStyle = 'rgba(255,255,255,.1)'; g.fill();
      rr(g, x + 26 * U, y + h - 14 * U, (w - 44 * U) * f, 6 * U, 3 * U); g.fillStyle = f < 0.2 ? '#ff5a4e' : col; g.fill();
    }
    g.restore();
  };

  V.drawTopBar = function (g, L, M, now) {
    const st = M.st, U = this.U, s = st.turn.seat, P = M.seats[s] || {}, col = P.color || '#fff';
    const cx = this.W / 2, y = 38 * U;
    let text;
    if (st.over) text = '🏆 Spielende';
    else if (st.turn.pending) {
      const d = M.seats[st.turn.pending.seat];
      text = '⚔️ Angriff! ' + (d ? d.name : '') + ' entscheidet über die Abwehr' + (M.defLeft ? ' · ' + M.defLeft + ' s' : '');
    } else text = (P.name || '') + ' ' + STAGE_TXT[st.turn.stage];
    g.font = '700 ' + Math.round(34 * U) + 'px ' + SERIF;
    const tw = g.measureText(text).width, rw = Math.max(620 * U, tw + 330 * U);
    rr(g, cx - rw / 2, y - 28 * U, rw, 56 * U, 28 * U);
    const bg = g.createLinearGradient(cx - rw / 2, 0, cx + rw / 2, 0); bg.addColorStop(0, 'rgba(20,16,28,.6)'); bg.addColorStop(0.5, A.rgba(A.mix('#1a1424', col, 0.25), 0.92)); bg.addColorStop(1, 'rgba(20,16,28,.6)');
    g.fillStyle = bg; g.fill(); g.lineWidth = 2 * U; g.strokeStyle = A.rgba(col, 0.7); g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cx, y + 1 * U);
    g.font = '700 ' + Math.round(17 * U) + 'px ' + SANS; g.fillStyle = 'rgba(255,255,255,.7)';
    g.textAlign = 'left'; g.fillText('Runde ' + st.turn.round + (st.cfg.roundLimit ? ' / ' + st.cfg.roundLimit : ''), cx - rw / 2 + 24 * U, y + 1 * U);
    if (M.turnLeft > 0 && !st.over && !st.turn.pending) { g.textAlign = 'right'; g.fillStyle = M.turnLeft <= 10 ? '#ff7a6a' : 'rgba(255,255,255,.7)'; g.fillText('⏱ ' + M.turnLeft + ' s', cx + rw / 2 - 24 * U, y + 1 * U); }
    // toast under the bar
    if (this.toast && now - this.toast.start < 2600) {
      const t = (now - this.toast.start) / 2600, a = t < 0.1 ? t * 10 : t > 0.8 ? (1 - t) * 5 : 1;
      g.save(); g.globalAlpha = a; g.font = '700 ' + Math.round(24 * U) + 'px ' + SANS;
      const w = g.measureText(this.toast.text).width + 40 * U;
      rr(g, cx - w / 2, y + 40 * U, w, 40 * U, 20 * U); g.fillStyle = 'rgba(12,10,18,.85)'; g.fill(); g.strokeStyle = A.rgba(this.toast.color, 0.8); g.lineWidth = 2 * U; g.stroke();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(this.toast.text, cx, y + 61 * U); g.restore();
    }
  };

  // the tray: the three dice of the last roll, tumbling first
  V.drawDice = function (g, L, M, now) {
    const st = M.st, U = this.U, d = this.dice;
    const slots = panelSlots(st.n), leftFree = slots.indexOf('lt') < 0;
    const x = 14 * U, w = L.side - 28 * U, y0 = leftFree ? L.top + 6 * U : L.top + 250 * U, h = 300 * U;
    if (!d || now - d.start > 30000) return;
    const seatCol = (M.seats[d.seat] || {}).color || '#fff';
    rr(g, x, y0, w, h, 18 * U); g.fillStyle = 'rgba(16,12,22,.82)'; g.fill(); g.lineWidth = 1.5 * U; g.strokeStyle = A.rgba(seatCol, 0.5); g.stroke();
    g.font = '700 ' + Math.round(20 * U) + 'px ' + SERIF; g.fillStyle = '#e8e0f4'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('🎲 Wurf von ' + ((M.seats[d.seat] || {}).name || ''), x + 18 * U, y0 + 26 * U);
    const t = (now - d.start) / 1000, n = d.dice.length, size = Math.min(84 * U, (w - 40 * U) / 3 - 10 * U);
    d.dice.forEach((r, k) => {
      const settle = 0.9 + k * 0.25, rolling = t < settle;
      const cx = x + w / 2 + (k - (n - 1) / 2) * (size + 14 * U);
      const bounce = rolling ? Math.abs(Math.sin(t * 9 + k)) * 18 * U : Math.max(0, Math.sin((t - settle) * 14) * 10 * U * Math.exp(-(t - settle) * 6));
      const cy = y0 + 104 * U - bounce, rot = rolling ? (t * 9 + k * 2) : Math.sin((t - settle) * 18) * 0.15 * Math.exp(-(t - settle) * 5);
      const faces = D.facesOf(r.key), face = rolling ? faces[Math.floor(t * 14 + k * 3) % 6] : faces[r.face];
      this.die(g, cx, cy, size, rot, face, D.MONSTERS[r.key], seatCol, !rolling && face.c === 'SUM' && d.level && D.MONSTERS[r.key].level === d.level);
    });
    if (t > 0.9 + (n - 1) * 0.25 + 0.2) {
      let yy = y0 + 172 * U;
      const gains = D.POOL.filter((c) => d.got[c]);
      g.font = '700 ' + Math.round(22 * U) + 'px ' + SANS; g.textAlign = 'left';
      let xx = x + 18 * U;
      if (!gains.length) { g.fillStyle = '#9a92a8'; g.fillText('keine Wappen', xx, yy); }
      for (const c of gains) {
        A.drawCrest(g, c, xx + 13 * U, yy, 26 * U); g.fillStyle = '#fff'; g.fillText('+' + d.got[c], xx + 30 * U, yy);
        xx += 80 * U;
      }
      yy += 44 * U;
      g.font = '700 ' + Math.round(20 * U) + 'px ' + SANS;
      if (d.opts && d.opts.length) { g.fillStyle = '#ffd36a'; g.fillText('⭐ Beschwörung möglich · Stufe ' + d.level, x + 18 * U, yy); }
      else if (d.noRoom) { g.fillStyle = '#ff9a8a'; g.fillText('⭐ Beschwörung – aber kein Platz', x + 18 * U, yy); }
      else { g.fillStyle = '#9a92a8'; g.fillText('keine Beschwörung', x + 18 * U, yy); }
      const lost = D.POOL.filter((c) => d.lost[c]);
      if (lost.length) { g.fillStyle = '#9a92a8'; g.font = '600 ' + Math.round(16 * U) + 'px ' + SANS; g.fillText('Lager voll: ' + lost.map((c) => d.lost[c] + ' ' + D.CREST[c].name).join(', ') + ' verfallen', x + 18 * U, yy + 34 * U); }
    }
  };
  V.die = function (g, cx, cy, s, rot, face, mon, col, lit) {
    g.save(); g.translate(cx, cy); g.rotate(rot);
    g.shadowColor = lit ? '#ffd36a' : 'rgba(0,0,0,.6)'; g.shadowBlur = lit ? 26 * this.U : 10 * this.U; g.shadowOffsetY = lit ? 0 : 5 * this.U;
    rr(g, -s / 2, -s / 2, s, s, s * 0.18);
    const gr = g.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2); gr.addColorStop(0, '#fbf6ee'); gr.addColorStop(1, '#cfc5b8');
    g.fillStyle = gr; g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.lineWidth = s * 0.05; g.strokeStyle = D.BAGS[mon.bag] ? D.BAGS[mon.bag].color : col; g.stroke();
    A.drawCrest(g, face.c, 0, -s * 0.02, s * 0.56);
    g.font = '900 ' + Math.round(s * 0.26) + 'px ' + SANS; g.textAlign = 'right'; g.textBaseline = 'bottom';
    if (face.c === 'SUM') { g.fillStyle = '#7a4a00'; g.fillText(mon.level, s * 0.44, s * 0.48); }
    else if (face.n > 1) { g.fillStyle = '#3a2a2a'; g.fillText('×' + face.n, s * 0.46, s * 0.48); }
    g.restore();
  };

  V.drawLog = function (g, L, M, now) {
    const U = this.U, st = M.st, slots = panelSlots(st.n), rightFree = slots.indexOf('rb') < 0;
    const x = this.W - L.side + 14 * U, w = L.side - 28 * U, y0 = L.top + 250 * U, y1 = rightFree ? this.H - 18 * U : this.H - 270 * U;
    const lines = (M.log || []).slice(-Math.max(3, Math.floor((y1 - y0 - 40 * U) / (34 * U))));
    if (!lines.length) return;
    rr(g, x, y0, w, y1 - y0, 18 * U); g.fillStyle = 'rgba(16,12,22,.7)'; g.fill(); g.lineWidth = 1.2 * U; g.strokeStyle = 'rgba(255,255,255,.08)'; g.stroke();
    g.font = '700 ' + Math.round(18 * U) + 'px ' + SERIF; g.fillStyle = '#c9bfe0'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('📜 Chronik', x + 16 * U, y0 + 24 * U);
    g.font = '500 ' + Math.round(16 * U) + 'px ' + SANS;
    lines.forEach((l, k) => {
      const yy = y0 + 58 * U + k * 34 * U, age = (now - l.at) / 1000;
      g.globalAlpha = k === lines.length - 1 && age < 0.4 ? age / 0.4 : 1;
      g.beginPath(); g.arc(x + 20 * U, yy, 5 * U, 0, TAU); g.fillStyle = l.color || '#888'; g.fill();
      let txt = l.text; while (g.measureText(txt).width > w - 48 * U && txt.length > 4) txt = txt.slice(0, -2) + '…';
      g.fillStyle = k === lines.length - 1 ? '#fff' : '#bdb5ca'; g.fillText(txt, x + 34 * U, yy);
      g.globalAlpha = 1;
    });
  };

  V.drawBig = function (g, L, M, now) {
    const b = this.big; if (!b) return;
    const t = (now - b.start) / b.dur; if (t < 0) return; if (t > 1) { this.big = null; return; }
    const U = this.U, a = t < 0.12 ? t / 0.12 : t > 0.8 ? (1 - t) * 5 : 1, s = 1 + (1 - ease(Math.min(1, t * 5))) * 0.3;
    g.save(); g.globalAlpha = a; g.translate(this.W / 2, this.H / 2); g.scale(s, s);
    g.font = '800 ' + Math.round(56 * U) + 'px ' + SERIF; const w = g.measureText(b.text).width + 90 * U;
    rr(g, -w / 2, -52 * U, w, 104 * U, 30 * U); g.fillStyle = 'rgba(10,6,14,.88)'; g.fill(); g.lineWidth = 3 * U; g.strokeStyle = b.color; g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.text, 0, 2 * U);
    g.restore();
  };

  V.drawOver = function (g, L, M, now) {
    const U = this.U, st = M.st, t = (now - (this.confettiAt || now)) / 1000;
    g.fillStyle = 'rgba(6,4,10,' + Math.min(0.6, t * 0.5).toFixed(3) + ')'; g.fillRect(0, 0, this.W, this.H);
    const r = seeded(5);
    for (let i = 0; i < 120; i++) {
      const x = r() * this.W, sp = 80 + r() * 160, y = ((r() * this.H + t * sp * U) % (this.H + 40)) - 20;
      g.save(); g.translate(x + Math.sin(t * 2 + i) * 20 * U, y); g.rotate(t * 3 + i);
      g.fillStyle = ['#ffd36a', '#ff3b5c', '#2f8bff', '#2fd36a', '#b45cff'][i % 5]; g.fillRect(-5 * U, -3 * U, 10 * U, 6 * U); g.restore();
    }
    const win = st.over.winners.map((s) => M.seats[s]).filter(Boolean);
    const col = win[0] ? win[0].color : '#ffd36a';
    const k = ease(Math.min(1, t * 1.5));
    g.save(); g.translate(this.W / 2, this.H / 2); g.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k); g.globalAlpha = k;
    rr(g, -480 * U, -170 * U, 960 * U, 340 * U, 40 * U); g.fillStyle = 'rgba(14,10,20,.94)'; g.fill(); g.lineWidth = 4 * U; g.strokeStyle = col; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = Math.round(90 * U) + 'px ' + SANS; g.fillText('👑', 0, -92 * U);
    g.font = '800 ' + Math.round(64 * U) + 'px ' + SERIF; g.fillStyle = '#fff';
    g.fillText(win.length ? win.map((w) => w.name).join(' & ') + (win.length > 1 ? ' gewinnen!' : ' gewinnt!') : 'Unentschieden', 0, 4 * U);
    g.font = '600 ' + Math.round(26 * U) + 'px ' + SANS; g.fillStyle = '#c9bfe0';
    const why = { last: 'als letzter Meister im Verlies', first: 'stürzte als Erste·r einen Meister', team: 'das Team hält das Verlies', limit: 'nach ' + st.over.round + ' Runden: die meisten Herzen' }[st.over.why] || '';
    g.fillText(why, 0, 70 * U);
    g.font = '600 ' + Math.round(20 * U) + 'px ' + SANS; g.fillStyle = 'rgba(255,255,255,.55)';
    g.fillText('Der Host kann am Handy eine neue Partie starten', 0, 128 * U);
    g.restore();
  };

  // ---------- before the game: choosing dice bags ----------
  V.drawPrep = function (g, M, now) {
    const U = this.U, W = this.W, H = this.H, P = M.prep || {};
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 ' + Math.round(92 * U) + 'px ' + SERIF;
    const tg = g.createLinearGradient(0, 70 * U, 0, 180 * U); tg.addColorStop(0, '#ffe6a0'); tg.addColorStop(1, '#c8862a');
    g.fillStyle = tg; g.shadowColor = 'rgba(255,190,90,.45)'; g.shadowBlur = 30 * U; g.fillText('🎲 Würfelverlies', W / 2, 130 * U); g.shadowBlur = 0;
    g.font = '500 ' + Math.round(26 * U) + 'px ' + SANS; g.fillStyle = '#c9bfe0';
    g.fillText('Jeder wählt am Handy einen Würfelbeutel · 15 Würfel, jeder ein Monster' + (P.left ? ' · noch ' + P.left + ' s' : ''), W / 2, 205 * U);
    const keys = D.BAG_KEYS, cw = Math.min(400 * U, (W - 120 * U) / 4 - 24 * U), ch = 470 * U, y = 260 * U;
    keys.forEach((k, i) => {
      const b = D.BAGS[k], x = W / 2 + (i - 1.5) * (cw + 24 * U) - cw / 2;
      rr(g, x, y, cw, ch, 24 * U);
      const bg = g.createLinearGradient(x, y, x, y + ch); bg.addColorStop(0, A.mix('#1a1524', b.color, 0.25)); bg.addColorStop(1, '#100c16');
      g.fillStyle = bg; g.fill(); g.lineWidth = 2 * U; g.strokeStyle = A.rgba(b.color, 0.7); g.stroke();
      g.font = Math.round(54 * U) + 'px ' + SANS; g.fillText(b.emoji, x + cw / 2, y + 52 * U);
      g.font = '800 ' + Math.round(32 * U) + 'px ' + SERIF; g.fillStyle = '#fff'; g.fillText(b.name, x + cw / 2, y + 112 * U);
      // three signature monsters
      const show = [b.dice[0], b.dice[7], b.dice[14]], ps = Math.min(100 * U, (cw - 40 * U) / 3);
      show.forEach((key, j) => {
        const px = x + cw / 2 + (j - 1) * (ps + 10 * U), py = y + 190 * U + Math.sin(now / 600 + i + j) * 4 * U, p = A.portrait(key, 160);
        g.save(); g.beginPath(); g.arc(px, py, ps / 2, 0, TAU); g.clip(); if (p) g.drawImage(p, px - ps / 2, py - ps / 2, ps, ps); g.restore();
        g.beginPath(); g.arc(px, py, ps / 2, 0, TAU); g.lineWidth = 3 * U; g.strokeStyle = b.color; g.stroke();
      });
      g.font = '500 ' + Math.round(19 * U) + 'px ' + SANS; g.fillStyle = '#d8d0e4';
      wrap(g, b.text, x + cw / 2, y + 276 * U, cw - 36 * U, 26 * U);
      // who took it
      const who = (M.seats || []).filter((s, si) => P.bags && P.bags[si] === k);
      who.forEach((s, j) => {
        const yy = y + ch - 40 * U - j * 38 * U;
        rr(g, x + 20 * U, yy - 16 * U, cw - 40 * U, 32 * U, 16 * U); g.fillStyle = A.rgba(s.color, 0.85); g.fill();
        g.fillStyle = '#fff'; g.font = '700 ' + Math.round(18 * U) + 'px ' + SANS; g.fillText((s.bot ? '🤖 ' : '✓ ') + s.name, x + cw / 2, yy);
      });
    });
    // seats
    const seats = M.seats || [], sy = y + ch + 60 * U;
    seats.forEach((s, i) => {
      const sx = W / 2 + (i - (seats.length - 1) / 2) * 300 * U;
      g.beginPath(); g.arc(sx - 100 * U, sy, 14 * U, 0, TAU); g.fillStyle = s.color; g.fill();
      g.font = '700 ' + Math.round(24 * U) + 'px ' + SANS; g.fillStyle = '#fff'; g.textAlign = 'left';
      g.fillText(s.name + (P.bags && P.bags[i] ? ' ✓' : ' …'), sx - 76 * U, sy);
      g.textAlign = 'center';
    });
  };
  function wrap(g, text, x, y, w, lh) {
    const words = text.split(' '); let line = '', yy = y;
    for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (g.measureText(t).width > w && line) { g.fillText(line, x, yy); line = wd; yy += lh; } else line = t; }
    if (line) g.fillText(line, x, yy);
  }

  root.VerliesView = View;
})(typeof window !== 'undefined' ? window : globalThis);
