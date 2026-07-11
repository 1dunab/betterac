// ===== Modul: SINTFLUT ======================================
// Falling-Sand-Krieg: Ein Bergsee bricht durch, unten stehen
// die Häuser der Spieler. Alle dämmen, graben und sprengen
// gleichzeitig — letzter Trockener gewinnt. Neon-Höhlen-Look
// mit billigem Bloom (Glow-Pass klein rendern, additiv drüber).
// ============================================================
registerGame({ key: 'sintflut', screen: function () {
  const CELL = 3, GW = 320, GH = 200;          // 320x200 Zellen -> 960x600 px
  const W = cv.width, H = cv.height;
  const M = { EMPTY: 0, ROCK: 1, DIRT: 2, SAND: 3, WATER: 4, LAVA: 5, OBSIDIAN: 6, ICE: 7 };

  // Grundfarben je Material [r,g,b] + Flacker-Varianz
  const COLORS = {
    [M.EMPTY]: [10, 8, 22, 0],
    [M.ROCK]: [38, 34, 52, 6],
    [M.DIRT]: [74, 58, 66, 10],
    [M.SAND]: [196, 164, 96, 14],
    [M.WATER]: [38, 190, 235, 34],
    [M.LAVA]: [255, 110, 30, 46],
    [M.OBSIDIAN]: [70, 40, 105, 12],
    [M.ICE]: [170, 225, 255, 20]
  };

  let grid = new Uint8Array(GW * GH);
  let moved = new Uint8Array(GW * GH);
  let flick = new Uint8Array(GW * GH);         // Zell-Rauschen für Schimmern
  let frame = 0, lastT = 0;

  let order = [], cursors = {}, houses = {}, ghost = {};
  let phase = 'run';                            // run | done
  let endAt = 0, startAt = 0, durationMs = 300000, winner = null, ranking = [];
  let announce = null, shake = { mag: 0, until: 0 };
  let waterTarget = 0, lastCount = 0, countAt = 0;
  let spring = { x: GW >> 1, y: 0 };
  let parts = [], tnts = [], lavaOn = false, lastEvent = 0, eventBanner = null;
  let lastYou = 0;

  const idx = (x, y) => y * GW + x;
  const inb = (x, y) => x > 1 && x < GW - 2 && y > 0 && y < GH - 1;
  const get = (x, y) => inb(x, y) ? grid[idx(x, y)] : M.ROCK;
  function say(text, color, ms) { announce = { text, color: color || '#fff', until: performance.now() + (ms || 2200) }; }
  function setShake(mag, ms) { shake.mag = Math.max(shake.mag, mag); shake.until = performance.now() + ms; }

  // ---------- Partikel (Glow-Sprites, Muster aus Space Arena) ----------
  const glowCache = {};
  function glowSprite(color) {
    if (glowCache[color]) return glowCache[color];
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, color); grad.addColorStop(0.4, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    glowCache[color] = c;
    return c;
  }
  function spawnP(x, y, vx, vy, color, life, size) {
    if (parts.length > 320) return;
    parts.push({ x, y, vx, vy, color, life, size, born: performance.now() });
  }
  function splash(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = (0.3 + Math.random() * 0.7) * speed;
      spawnP(x, y, Math.cos(a) * v, Math.sin(a) * v, color, 380 + Math.random() * 340, 2 + Math.random() * 2.5);
    }
  }

  // ---------- Terrain ----------
  function surfaceAt(x) {
    // Talprofil: hohe Flanken, welliger Boden
    const t = x / GW;
    const flank = Math.pow(Math.abs(t - 0.5) * 2, 2.2) * GH * 0.34;
    const wobble = Math.sin(x / 17) * 4 + Math.sin(x / 41 + 2) * 6;
    return Math.round(GH * 0.66 - flank + wobble);
  }

  function makeTerrain() {
    grid.fill(M.EMPTY);
    for (let x = 0; x < GW; x++) {
      const s = surfaceAt(x);
      for (let y = 0; y < GH; y++) {
        if (y >= GH - 5 || x < 2 || x > GW - 3) grid[idx(x, y)] = M.ROCK;
        else if (y >= s) grid[idx(x, y)] = y > s + 26 ? M.ROCK : M.DIRT;
      }
    }
    // Bergsee: Plateau-Becken oben mittig, Wände aus Erde (= sprengbar!)
    const cx = GW >> 1, top = Math.round(GH * 0.10), bw = 46, depth = 22;
    for (let x = cx - bw; x <= cx + bw; x++) {
      for (let y = top; y <= top + depth + 6; y++) {
        const dxr = Math.abs(x - cx);
        if (dxr > bw - 5 || y > top + depth) grid[idx(x, y)] = M.DIRT;   // Wand/Boden
        else grid[idx(x, y)] = y > top + 1 ? M.WATER : M.EMPTY;          // Seewasser (fast randvoll)
      }
    }
    // Massiver Berg unter dem Becken (Erde = ansprengbar für fiese Kanäle)
    for (let x = cx - bw - 6; x <= cx + bw + 6; x++) {
      const s = surfaceAt(x);
      const shoulder = Math.round(Math.abs(x - cx) * 0.55);
      for (let y = top + depth + shoulder; y < s; y++) {
        if (inb(x, y) && grid[idx(x, y)] === M.EMPTY) grid[idx(x, y)] = M.DIRT;
      }
    }
    // Quelle sprudelt ÜBER dem Seespiegel — Pegel steigt, bis er die Wände überläuft
    spring = { x: cx, y: top - 4 };
    flick = new Uint8Array(GW * GH);
    for (let i = 0; i < flick.length; i++) flick[i] = Math.random() * 255;
  }

  function placeHouses() {
    houses = {};
    const n = order.length;
    order.forEach((id, i) => {
      const hx = Math.round(GW * (0.14 + 0.72 * (n === 1 ? 0.5 : i / (n - 1))));
      const s = surfaceAt(hx);
      const w = 16, h = 13;
      const top = s - 4;
      // Nische ins Terrain schneiden (oben offen — das Wasser will rein)
      for (let x = hx - w / 2 - 2; x <= hx + w / 2 + 2; x++) {
        for (let y = top - 6; y <= top + h; y++) {
          if (!inb(x, y)) continue;
          const inNiche = Math.abs(x - hx) <= w / 2 && y >= top && y < top + h;
          if (inNiche) grid[idx(x, y)] = M.EMPTY;
          else if (y >= top + h && y <= top + h + 1) grid[idx(x, y)] = M.ROCK; // fester Boden
        }
      }
      houses[id] = { x: hx, top, w, h, fill: 0, dead: false, deadAt: 0 };
    });
  }

  // ---------- Simulation (Zellular-Automat) ----------
  function trySwap(i, j) {
    grid[j] = grid[i]; grid[i] = M.EMPTY; moved[j] = 1;
  }

  function step() {
    moved.fill(0);
    const ltr = (frame & 1) === 0;
    for (let y = GH - 2; y >= 1; y--) {
      for (let xi = 0; xi < GW; xi++) {
        const x = ltr ? xi : GW - 1 - xi;
        const i = idx(x, y);
        if (moved[i]) continue;
        const c = grid[i];
        if (c === M.SAND) {
          const below = idx(x, y + 1);
          if (grid[below] === M.EMPTY || grid[below] === M.WATER) {
            // Sand sinkt durch Wasser
            const tmp = grid[below];
            grid[below] = M.SAND; grid[i] = tmp; moved[below] = 1;
          } else {
            const d = Math.random() < 0.5 ? 1 : -1;
            if (get(x + d, y + 1) === M.EMPTY) trySwap(i, idx(x + d, y + 1));
            else if (get(x - d, y + 1) === M.EMPTY) trySwap(i, idx(x - d, y + 1));
          }
        } else if (c === M.WATER || c === M.LAVA) {
          if (c === M.LAVA && (frame % 3)) continue;    // Lava fließt zäh
          const below = idx(x, y + 1);
          if (grid[below] === M.EMPTY) { trySwap(i, below); continue; }
          const d = Math.random() < 0.5 ? 1 : -1;
          if (get(x + d, y + 1) === M.EMPTY) { trySwap(i, idx(x + d, y + 1)); continue; }
          if (get(x - d, y + 1) === M.EMPTY) { trySwap(i, idx(x - d, y + 1)); continue; }
          if (get(x + d, y) === M.EMPTY) { trySwap(i, idx(x + d, y)); continue; }
          if (get(x - d, y) === M.EMPTY) { trySwap(i, idx(x - d, y)); continue; }
        }
      }
    }
  }

  // ---------- Wasser-Nachschub (selbstregulierend) ----------
  function replenish(now) {
    if (now - countAt > 700) {
      countAt = now;
      let n = 0;
      for (let i = 0; i < grid.length; i++) if (grid[i] === M.WATER) n++;
      lastCount = n;
      const elapsed = (now - startAt) / 1000;
      waterTarget = 2400 + elapsed * 11;
    }
    if (lastCount < waterTarget) {
      for (let k = 0; k < 5; k++) {
        const x = spring.x + ((Math.random() * 10 - 5) | 0);
        const i = idx(x, spring.y + ((Math.random() * 3) | 0));
        if (grid[i] === M.EMPTY) { grid[i] = M.WATER; lastCount++; }
      }
    }
  }

  // ---------- Häuser / Sieg ----------
  function measureHouses(now) {
    order.forEach(id => {
      const h = houses[id];
      if (!h || h.dead) return;
      let water = 0, lava = 0;
      for (let x = h.x - h.w / 2; x <= h.x + h.w / 2; x++) {
        for (let y = h.top; y < h.top + h.h; y++) {
          const c = grid[idx(x, y)];
          if (c === M.WATER) water++;
          else if (c === M.LAVA) lava++;
        }
      }
      h.fill = Math.min(1, water / (h.w * h.h * 0.62));
      if (lava > 0) { h.fill = 1; drown(id, h, now, true); }
      else if (h.fill >= 1) drown(id, h, now, false);
    });
  }

  function drown(id, h, now, byLava) {
    if (h.dead) return;
    h.dead = true; h.deadAt = now;
    ghost[id] = true;
    ranking.unshift(id);
    say(byLava ? '🌋 ' + nameOf(id) + ' — Haus verglüht!' : '🌊 ' + nameOf(id) + ' ist abgesoffen!', byLava ? '#ff7a30' : '#4cd7ff');
    setShake(8, 500);
    splash(h.x * CELL, (h.top + 4) * CELL, byLava ? '#ff7a30' : '#4cd7ff', 22, 160);
    ac.message(id, { t: 'flYou', ghost: true });
    const dry = order.filter(o => houses[o] && !houses[o].dead);
    if (dry.length <= 1) finish(now, dry[0] !== undefined ? dry[0] : null);
  }

  function finish(now, lastDry) {
    if (phase === 'done') return;
    phase = 'done';
    endAt = now;
    if (lastDry !== null && lastDry !== undefined) {
      winner = lastDry;
      ranking.unshift(lastDry);
    } else {
      // Zeit abgelaufen: trockene Häuser nach Pegel sortieren (niedrigster zuerst)
      const dry = order.filter(o => houses[o] && !houses[o].dead)
        .sort((a, b) => houses[a].fill - houses[b].fill);
      winner = dry[0] !== undefined ? dry[0] : ranking[0];
      for (let i = dry.length - 1; i >= 0; i--) ranking.unshift(dry[i]);
    }
    setShake(6, 600);
    const h = hostId();
    order.forEach(id => ac.message(id, {
      t: 'flEnd', winner: id === winner, name: winner !== null ? nameOf(winner) : '—', host: id === h
    }));
  }

  // ---------- Spieler-Aktionen ----------
  function actAt(id, p, dt, now) {
    const gx = Math.round(p.x / CELL), gy = Math.round(p.y / CELL);
    if (p.sand && p.tank >= 1 && now > p.nextSand) {
      p.nextSand = now + 40;
      let placed = 0;
      for (let k = 0; k < 6 && p.tank >= 1; k++) {
        const x = gx + ((Math.random() * 5 - 2.5) | 0), y = gy + ((Math.random() * 3 - 1.5) | 0);
        if (inb(x, y) && grid[idx(x, y)] === M.EMPTY) { grid[idx(x, y)] = M.SAND; p.tank--; placed++; }
      }
      if (placed) spawnP(p.x, p.y, (Math.random() - 0.5) * 20, 10, '#e8c88a', 220, 1.8);
    }
    if (p.dig && now > p.nextDig) {
      p.nextDig = now + 55;
      let dug = 0;
      for (let x = gx - 2; x <= gx + 2; x++) {
        for (let y = gy - 2; y <= gy + 2; y++) {
          if (!inb(x, y)) continue;
          const c = grid[idx(x, y)];
          if (c === M.DIRT || c === M.SAND || c === M.ICE) { grid[idx(x, y)] = M.EMPTY; dug++; }
        }
      }
      if (dug) spawnP(p.x, p.y, (Math.random() - 0.5) * 30, -22, '#7a5a66', 300, 2);
    }
    // Sand-Tank regeneriert (Geister langsamer)
    p.tank = Math.min(100, p.tank + dt * (ghost[id] ? 2.5 : 6));
  }

  // ---------- Elemente (TNT / Eis / Lava / Events — Welle 2) ----------
  function updateTnts(now) {}
  function updateEvents(now) {}
  function drawTnts(now) {}

  // ---------- Rendering ----------
  const simC = document.createElement('canvas'); simC.width = GW; simC.height = GH;
  const simCtx = simC.getContext('2d');
  const img = simCtx.createImageData(GW, GH);
  const glowC = document.createElement('canvas'); glowC.width = GW >> 2; glowC.height = GH >> 2;
  const glowCtx = glowC.getContext('2d');

  function renderGrid(now) {
    const d = img.data;
    const tick = (now / 100) | 0;
    for (let i = 0; i < grid.length; i++) {
      const c = COLORS[grid[i]];
      const f = c[3] ? ((flick[i] + tick) & 31) / 31 * c[3] - c[3] / 2 : 0;
      const o = i * 4;
      d[o] = c[0] + f; d[o + 1] = c[1] + f; d[o + 2] = c[2] + f; d[o + 3] = 255;
    }
    simCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(simC, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    // Billiger Bloom: klein + weich rendern, additiv drüberlegen
    glowCtx.clearRect(0, 0, glowC.width, glowC.height);
    glowCtx.drawImage(simC, 0, 0, glowC.width, glowC.height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.34;
    ctx.drawImage(glowC, 0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHouse(id, now) {
    const h = houses[id];
    if (!h) return;
    const col = players[id] ? players[id].color : '#888';
    const px = h.x * CELL, pw = h.w * CELL, py = h.top * CELL, ph = h.h * CELL;
    ctx.save();
    ctx.translate(px, py);
    // Haus-Silhouette in der Nische
    ctx.fillStyle = h.dead ? '#1a1620' : '#241d2e';
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    const hw = pw * 0.68, hh = ph * 0.62, hx0 = -hw / 2, hy0 = ph - hh;
    ctx.beginPath();
    ctx.moveTo(hx0 - 4, hy0 + 6);
    ctx.lineTo(0, hy0 - 12);
    ctx.lineTo(hw / 2 + 4, hy0 + 6);
    ctx.lineTo(hw / 2, hy0 + 6); ctx.lineTo(hw / 2, ph); ctx.lineTo(hx0, ph); ctx.lineTo(hx0, hy0 + 6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Fenster: warmes Glühen, erlischt beim Volllaufen / Tod
    const glow = h.dead ? 0 : Math.max(0, 1 - h.fill * 1.15);
    if (glow > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,200,90,' + (0.75 * glow * (0.85 + 0.15 * Math.sin(now / 300 + h.x))) + ')';
      ctx.fillRect(-hw / 4 - 3, hy0 + hh * 0.35, 6, 7);
      ctx.fillRect(hw / 4 - 3, hy0 + hh * 0.35, 6, 7);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (h.dead) {
      ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.font = '16px system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('👻', 0, hy0 + hh * 0.4);
    }
    ctx.restore();
  }

  function drawCursor(id, p, now) {
    const col = players[id] ? players[id].color : '#fff';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = ghost[id] ? 0.45 : 0.85;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = col; ctx.font = 'bold 11px system-ui,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((ghost[id] ? '👻 ' : '') + shortName(id), p.x, p.y - 17);
  }

  function drawParts(now, dt) {
    ctx.globalCompositeOperation = 'lighter';
    parts = parts.filter(p => {
      const f = (now - p.born) / p.life;
      if (f >= 1) return false;
      p.vy += 260 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.globalAlpha = 1 - f;
      const s = glowSprite(p.color);
      ctx.drawImage(s, p.x - p.size * 2, p.y - p.size * 2, p.size * 4, p.size * 4);
      return true;
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHud(now) {
    // Füllstands-Chips oben
    ctx.textBaseline = 'middle'; ctx.font = 'bold 13px system-ui,sans-serif';
    order.forEach((id, i) => {
      const h = houses[id];
      const x = 12 + i * 118, y = 14;
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      rr(ctx, x, y - 10, 110, 20, 8); ctx.fill();
      ctx.fillStyle = players[id] ? players[id].color : '#888';
      ctx.beginPath(); ctx.arc(x + 11, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = 'left';
      if (h && !h.dead) {
        ctx.fillStyle = h.fill > 0.6 ? '#ff9f43' : '#fff';
        ctx.fillText(shortName(id) + ' ' + Math.round(h.fill * 100) + '%', x + 21, y);
        ctx.fillStyle = 'rgba(255,255,255,.25)';
        ctx.fillRect(x + 4, y + 7, 102, 2);
        ctx.fillStyle = '#4cd7ff';
        ctx.fillRect(x + 4, y + 7, 102 * h.fill, 2);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        ctx.fillText('👻 ' + shortName(id), x + 21, y);
      }
    });
    // Timer
    const left = Math.max(0, Math.ceil((startAt + durationMs - now) / 1000));
    ctx.textAlign = 'right'; ctx.fillStyle = left <= 30 ? '#ff9f43' : '#fff';
    ctx.font = 'bold 18px system-ui,sans-serif';
    ctx.fillText(Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'), W - 12, 15);

    if (eventBanner && now < eventBanner.until) {
      ctx.textAlign = 'center';
      const blink = 0.7 + 0.3 * Math.sin(now / 90);
      ctx.fillStyle = eventBanner.color; ctx.globalAlpha = blink;
      ctx.font = 'bold 40px system-ui,sans-serif';
      ctx.shadowColor = eventBanner.color; ctx.shadowBlur = 18;
      ctx.fillText(eventBanner.text, W / 2, 70);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (announce && now < announce.until) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, (announce.until - now) / 500);
      ctx.fillStyle = announce.color;
      ctx.font = 'bold 26px system-ui,sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 8;
      ctx.fillText(announce.text, W / 2, 110);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (phase === 'done') {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#4cd7ff'; ctx.font = 'bold 52px system-ui,sans-serif';
      ctx.shadowColor = '#4cd7ff'; ctx.shadowBlur = 20;
      ctx.fillText(winner !== null ? '🏆 ' + nameOf(winner) + ' bleibt trocken!' : '🌊 Alle abgesoffen!', W / 2, H / 2 - 90);
      ctx.shadowBlur = 0;
      ctx.font = 'bold 22px system-ui,sans-serif';
      ranking.slice(0, 8).forEach((id, i) => {
        ctx.fillStyle = players[id] ? players[id].color : '#888';
        const h = houses[id];
        ctx.fillText((i + 1) + '.  ' + shortName(id) + (h && !h.dead ? ' — ' + Math.round(h.fill * 100) + '%' : ' — 👻'), W / 2, H / 2 - 30 + i * 32);
      });
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '16px system-ui,sans-serif';
      ctx.fillText('⭐ Host kann am Handy eine Revanche starten', W / 2, H - 40);
    }
  }

  function sendYou(now) {
    if (now - lastYou < 700) return;
    lastYou = now;
    order.forEach(id => {
      const p = cursors[id], h = houses[id];
      if (!p) return;
      ac.message(id, { t: 'flYou', fill: h ? h.fill : 0, tank: p.tank, tnt: p.tnt, ice: p.ice });
    });
  }

  return {
    acceptsJoin: false,
    start(ids, cfg) {
      order = ids.slice().sort((a, b) => a - b);
      durationMs = ((cfg && cfg.dauer) || 5) * 60000;
      phase = 'run'; winner = null; ranking = []; ghost = {};
      parts = []; tnts = []; lavaOn = false; eventBanner = null; announce = null;
      frame = 0; lastCount = 0; countAt = 0;
      makeTerrain();
      placeHouses();
      cursors = {};
      order.forEach(id => {
        const h = houses[id];
        cursors[id] = { x: h.x * CELL, y: (h.top - 10) * CELL, vx: 0, vy: 0, sand: false, dig: false,
          tank: 100, tnt: 3, ice: 1, nextSand: 0, nextDig: 0 };
      });
      startAt = performance.now();
      lastT = startAt; lastEvent = startAt;
      say('🌊 Der Bergsee steigt…', '#4cd7ff', 2600);
      order.forEach(id => ac.message(id, { t: 'flState', phase: 'run' }));
      sendYou(0);
    },
    stop() { parts = []; tnts = []; },
    onDisconnect(id) {
      order = order.filter(o => o !== id);
      delete cursors[id]; delete houses[id];
      ranking = ranking.filter(o => o !== id);
      if (order.length < 2) { endToLobby('Sintflut braucht mind. 2 Spieler.'); return; }
      if (phase === 'run') {
        const dry = order.filter(o => houses[o] && !houses[o].dead);
        if (dry.length <= 1) finish(performance.now(), dry[0] !== undefined ? dry[0] : null);
      }
    },
    onMessage(id, d) {
      if (!d) return;
      if (d.t === 'flAgain' && id === hostId() && phase === 'done') {
        this.start(order, { dauer: durationMs / 60000 });
        return;
      }
      const p = cursors[id];
      if (!p || phase !== 'run') return;
      if (d.t === 'flMove') { p.vx = clamp(+d.x || 0, -1, 1); p.vy = clamp(+d.y || 0, -1, 1); }
      else if (d.t === 'flAct') { p.sand = !!d.sand; p.dig = !!d.dig; }
      else if (d.t === 'flTnt') placeTnt(id, p);
      else if (d.t === 'flIce') castIce(id, p);
    },
    render() {
      const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      if (phase === 'run') {
        frame++;
        replenish(now);
        step();
        updateTnts(now);
        updateEvents(now);
        order.forEach(id => {
          const p = cursors[id];
          if (!p) return;
          p.x = clamp(p.x + p.vx * 210 * dt, 8, W - 8);
          p.y = clamp(p.y + p.vy * 210 * dt, 8, H - 8);
          actAt(id, p, dt, now);
        });
        if (frame % 10 === 0) measureHouses(now);
        if (now - startAt >= durationMs) finish(now, null);
        sendYou(now);
      }
      ctx.save();
      if (now < shake.until) {
        const m = shake.mag * (shake.until - now) / 600;
        ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      } else shake.mag = 0;
      renderGrid(now);
      order.forEach(id => drawHouse(id, now));
      drawTnts(now);
      if (phase === 'run') order.forEach(id => { const p = cursors[id]; if (p) drawCursor(id, p, now); });
      drawParts(now, dt);
      drawHud(now);
      ctx.restore();
    },
    _debug() { return { grid, houses, cursors, phase, ranking, lastCount, GW, GH, CELL, M }; }
  };

  // Platzhalter (Welle 2)
  function placeTnt(id, p) {}
  function castIce(id, p) {}
}});
