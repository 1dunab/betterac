// ===== Modul: HIMMELSZÜNDER =================================
// Gemeinsame Feuerwerks-Show über einer Nachtstadt am See:
// Halten lädt das Kaliber, Hochwischen feuert, zweiter Tap zündet.
// Beat-Ringe takten die Show — Sync-Treffer mehrerer Spieler
// geben Multiplikatoren und Zeitlupe. Der See spiegelt alles.
// ============================================================
registerGame({ key: 'himmelszuender', screen: function () {
  const W = cv.width, H = cv.height;
  const SEA_Y = H - 150, GRAV = 150, ROCKET_G = 330;
  const AMMO_COST = { 1: 15, 2: 30, 3: 50 };
  const KAL_PARTS = { 1: 70, 2: 130, 3: 220 };

  let order = [], py = {}, phase = 'run'; // run | end
  let rockets = {}, parts = [], texts = [], rings = [], dets = [];
  let startAt = 0, lastT = 0, timeScale = 1, wavesTotal = 3, wave = 1, waveAt = 0, finaleAt = 0, crowd = 0;
  let announce = null, shake = { mag: 0, until: 0 }, flash = { until: 0, dur: 1 };
  let lastYou = 0, winner = null;

  // ---------- Glow / FX ----------
  const glowCache = {};
  function glowSprite(color) {
    if (glowCache[color]) return glowCache[color];
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    grad.addColorStop(0, color); grad.addColorStop(0.35, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 48, 48);
    glowCache[color] = c;
    return c;
  }
  function drawGlow(x, y, r, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(glowSprite(color), x - r * 2, y - r * 2, r * 4, r * 4);
    ctx.globalAlpha = 1;
  }
  function say(text, color, ms, size) { announce = { text, color: color || '#fff', until: performance.now() + (ms || 1900), size: size || 40 }; }
  function setShake(mag, ms) { shake.mag = Math.max(shake.mag, mag); shake.until = performance.now() + ms; }
  function setFlash(ms) { flash = { until: performance.now() + ms, dur: ms }; }
  function floatText(x, y, text, color, size) {
    texts.push({ x, y, text, color, size: size || 22, born: performance.now(), life: 1100 });
  }
  function spawnP(p) {
    if (parts.length > 2600) return;
    parts.push(Object.assign({ g: GRAV * 0.55, drag: 0.985, size: 2.4, twinkle: false, born: performance.now() }, p));
  }

  // ---------- Explosionen ----------
  function explode(x, y, kaliber, form, color, weak) {
    sfx(weak ? 'hit' : 'explosion');
    const n = weak ? 22 : KAL_PARTS[kaliber] || 70;
    const base = weak ? 60 : 90 + kaliber * 55;
    const cols = [color, color, '#fff7d0', '#ffd60a'];
    for (let i = 0; i < n; i++) {
      const col = cols[(Math.random() * cols.length) | 0];
      if (form === 'ring' && !weak) {
        const a = i / n * Math.PI * 2;
        spawnP({ x, y, vx: Math.cos(a) * base, vy: Math.sin(a) * base, color: col,
          life: 900 + Math.random() * 400, drag: 0.97, g: GRAV * 0.3, twinkle: Math.random() < 0.4 });
      } else if (form === 'willow' && !weak) {
        const a = Math.random() * Math.PI * 2, v = (0.5 + Math.random() * 0.5) * base * 0.8;
        spawnP({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - base * 0.25, color: Math.random() < 0.6 ? '#ffd88a' : col,
          life: 1500 + Math.random() * 900, drag: 0.94, g: GRAV * 0.85, size: 2.1, twinkle: true });
      } else {
        const a = Math.random() * Math.PI * 2, v = (0.25 + Math.random() * 0.75) * base;
        spawnP({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color: col,
          life: 700 + Math.random() * 500, twinkle: Math.random() < 0.3 });
      }
    }
    if (!weak && kaliber >= 3) { setFlash(160); setShake(9, 350); }
    else if (!weak && kaliber === 2) setShake(4, 200);
  }

  // ---------- Beat-Ringe ----------
  const BEAT = 1000, FLASH_MS = 360, CYCLE = BEAT * 4;
  let nextRingAt = 0, finale = false;
  const ringTarget = () => finale ? 0 : (wave >= 3 ? 3 : 2);
  const ringRadius = () => Math.max(44, 74 - (wave - 1) * 12);
  const flashActive = (ring, now) => {
    const ph = (now - ring.born) % CYCLE;
    return ph > BEAT * 3 && ph < BEAT * 3 + FLASH_MS;
  };
  function spawnRing(now) {
    for (let tries = 0; tries < 16; tries++) {
      const x = 120 + Math.random() * (W - 240);
      const y = 70 + Math.random() * (SEA_Y - 300);
      if (rings.some(r => Math.hypot(r.x - x, r.y - y) < 190)) continue;
      rings.push({ x, y, r: ringRadius(), born: now, expireAt: now + CYCLE * 3 });
      return;
    }
  }
  function updateRings(now, dt) {
    rings = rings.filter(r => now < r.expireAt && !r.hit);
    if (rings.length < ringTarget() && now >= nextRingAt) {
      nextRingAt = now + 700;
      spawnRing(now);
    }
  }
  function drawRings(now) {
    rings.forEach(ring => {
      const ph = (now - ring.born) % CYCLE;
      const beatIdx = Math.floor(ph / BEAT);
      const beatPh = (ph % BEAT) / BEAT;
      const flash = flashActive(ring, now);
      const pulse = 1 + 0.07 * Math.sin(beatPh * Math.PI);
      ctx.globalCompositeOperation = 'lighter';
      if (flash) {
        drawGlow(ring.x, ring.y, ring.r * 0.7, '#ffffff', 0.35);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 5;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = 'rgba(140,180,255,' + (0.28 + beatIdx * 0.14) + ')';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([10, 8]);
        ctx.lineDashOffset = -now / 40;
      }
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Beat-Countdown: 3 Punkte füllen sich, der 4. ist der Blitz
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + i / 4 * Math.PI * 2;
        const filled = i <= beatIdx;
        ctx.globalAlpha = filled ? 0.9 : 0.25;
        drawGlow(ring.x + Math.cos(a) * (ring.r + 16), ring.y + Math.sin(a) * (ring.r + 16), 3,
          i === 3 ? '#ffffff' : '#8cb4ff', filled ? 0.9 : 0.25);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    });
  }

  function scoreDetonation(id, x, y, kaliber, now) {
    const col = players[id] ? players[id].color : '#fff';
    let pts, inRing = false, inBeat = false;
    const ring = rings.find(r => !r.hit && Math.hypot(x - r.x, y - r.y) < r.r);
    if (ring) {
      inRing = true;
      inBeat = flashActive(ring, now);
      ring.hit = true;
      pts = kaliber * 10 * (inBeat ? 2 : 1);
    } else {
      pts = finale ? kaliber * 6 : (y < SEA_Y - 60 ? kaliber * 3 : 2);
    }
    if (finale) crowd = Math.min(100, crowd + kaliber * 4);
    py[id].points += pts;
    floatText(x, y - 20, '+' + pts + (inBeat ? ' BEAT!' : ''), inBeat ? '#fff' : col, inBeat ? 28 : 22);
    // Sync: mehrere Spieler treffen Ringe im selben Fenster
    if (inRing) {
      dets.push({ id, t: now, pts, synced: false });
      dets = dets.filter(d => now - d.t < 450);
      const group = dets.filter(d => !d.synced);
      const who = [...new Set(group.map(d => d.id))];
      if (who.length >= 2) {
        group.forEach(d => d.synced = true);
        const mult = who.length;
        timeScale = 0.25;
        setFlash(220);
        setShake(10, 500);
        say('🤝 SYNC ×' + mult + '! ' + who.map(nameOf).join(' + '), '#ffd60a', 2400, 46);
        group.forEach(d => {
          const bonus = d.pts * (mult - 1);
          py[d.id].points += bonus;
          ac.message(d.id, { t: 'hzYou', points: py[d.id].points, sync: true, msg: '🤝 SYNC ×' + mult + '!' });
        });
      }
    }
    return pts;
  }

  // ---------- Raketen ----------
  function slotX(id) {
    const i = order.indexOf(id), n = order.length;
    return W * (0.14 + 0.72 * (n === 1 ? 0.5 : i / (n - 1)));
  }
  function launch(id, d, now) {
    const p = py[id];
    if (phase !== 'run' || rockets[id]) return;
    const kaliber = clamp((+d.kaliber | 0) || 1, 1, 3);
    const cost = AMMO_COST[kaliber];
    if (p.ammo < cost) { ac.message(id, { t: 'hzYou', ammo: p.ammo, msg: '🚫 Zu wenig Pulver — kurz warten!' }); return; }
    p.ammo -= cost;
    let ang = +d.ang;
    if (!isFinite(ang)) ang = -Math.PI / 2;
    // nur nach oben, max ±55° aus der Senkrechten
    ang = clamp(ang, -Math.PI / 2 - 0.96, -Math.PI / 2 + 0.96);
    // Scheitel bleibt im Bild: v_max ~ sqrt(2*g*Himmelshöhe)
    const speed = 290 + clamp(+d.power || 1, 0.3, 3) * 85;
    const x = slotX(id);
    rockets[id] = {
      x, y: SEA_Y - 6, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      kaliber, form: ['peony', 'willow', 'ring'].includes(d.form) ? d.form : 'peony', born: now
    };
    spawnP({ x, y: SEA_Y - 6, vx: (Math.random() - 0.5) * 30, vy: 30, color: '#ffd60a', life: 300, size: 2 });
    sfx('whoosh');
    ac.message(id, { t: 'hzYou', ammo: p.ammo, flying: true });
  }
  function detonate(id, now, weak) {
    const r = rockets[id];
    if (!r) return;
    delete rockets[id];
    const col = players[id] ? players[id].color : '#fff';
    explode(r.x, r.y, r.kaliber, r.form, col, weak);
    const pts = weak ? 0 : scoreDetonation(id, r.x, r.y, r.kaliber, now);
    if (weak) floatText(r.x, r.y, 'pfft…', 'rgba(255,255,255,.5)', 16);
    ac.message(id, { t: 'hzYou', flying: false, points: py[id].points });
  }

  // ---------- Simulation ----------
  const WAVE_MS = 55000, FINALE_MS = 15000;
  function endShow(now) {
    phase = 'end';
    // Publikums-Bonus für alle
    order.forEach(id => { py[id].points += Math.round(crowd); });
    let best = -1;
    order.forEach(id => { if (py[id].points > best) { best = py[id].points; winner = id; } });
    const grade = crowd >= 80 ? '🤩 Legendär!' : crowd >= 50 ? '👏 Starke Show!' : '🙂 Nette Show.';
    const h = hostId();
    order.forEach(id => ac.message(id, {
      t: 'hzEnd', win: id === winner, name: winner !== null ? nameOf(winner) : '—', host: id === h, grade
    }));
  }

  function simulate(dt, now) {
    if (phase !== 'run') return;
    timeScale += (1 - timeScale) * Math.min(1, dt * 3);
    const sdt = dt * timeScale;
    // Wellen-Dramaturgie
    if (!finale && now - waveAt > WAVE_MS) {
      if (wave < wavesTotal) {
        wave++;
        waveAt = now;
        say('🌊 WELLE ' + wave + ' — schneller, kleiner, härter!', '#8cb4ff', 2600, 42);
        order.forEach(id => ac.message(id, { t: 'hzState', msg: '🌊 Welle ' + wave + '!' }));
      } else {
        finale = true;
        finaleAt = now;
        rings = [];
        say('🎇 FREISTIL-FINALE! ALLES RAUS!', '#ffd60a', 3000, 48);
        setShake(8, 700);
        order.forEach(id => { py[id].ammo = 100; ac.message(id, { t: 'hzYou', ammo: 100, msg: '🎇 FINALE — Publikum begeistern!' }); });
      }
    }
    if (finale && now - finaleAt > FINALE_MS) { endShow(now); return; }
    updateRings(now, sdt);
    order.forEach(id => {
      const p = py[id];
      p.ammo = Math.min(100, p.ammo + 11 * dt);
      const r = rockets[id];
      if (!r) return;
      r.vy += ROCKET_G * sdt;
      r.x += r.vx * sdt;
      r.y += r.vy * sdt;
      if (parts.length < 2500 && Math.random() < 0.8) {
        spawnP({ x: r.x, y: r.y, vx: -r.vx * 0.05 + (Math.random() - 0.5) * 20, vy: -r.vy * 0.05 + (Math.random() - 0.5) * 20,
          color: Math.random() < 0.5 ? '#ffd60a' : (players[id] ? players[id].color : '#fff'), life: 340, size: 1.8, g: 40 });
      }
      // verpufft, wenn sie zurückfällt oder rausfliegt
      if (r.y > SEA_Y - 10 && r.vy > 0) detonate(id, now, true);
      else if (r.x < -30 || r.x > W + 30 || r.y < -40) detonate(id, now, true);
    });
    if (now - lastYou > 800) {
      lastYou = now;
      order.forEach(id => ac.message(id, { t: 'hzYou', ammo: py[id].ammo }));
    }
  }

  // ---------- Szene ----------
  let cityC = null, stars = [];
  function buildCity() {
    cityC = document.createElement('canvas');
    cityC.width = W; cityC.height = 130;
    const g = cityC.getContext('2d');
    let x = 0;
    while (x < W) {
      const bw = 34 + Math.random() * 52, bh = 34 + Math.random() * 88;
      g.fillStyle = '#0c0a1c';
      g.fillRect(x, 130 - bh, bw, bh);
      g.fillStyle = 'rgba(255,214,120,0.85)';
      for (let wx = x + 5; wx < x + bw - 6; wx += 9) {
        for (let wy = 130 - bh + 6; wy < 122; wy += 12) {
          if (Math.random() < 0.4) g.fillRect(wx, wy, 3.4, 4.6);
        }
      }
      x += bw + 3;
    }
    stars = Array.from({ length: 120 }, () => ({ x: Math.random() * W, y: Math.random() * (SEA_Y - 180), a: 0.25 + Math.random() * 0.7, tw: Math.random() * 9 }));
  }

  function drawScene(now) {
    const sky = ctx.createLinearGradient(0, 0, 0, SEA_Y);
    sky.addColorStop(0, '#05041a'); sky.addColorStop(0.6, '#0d0a2e'); sky.addColorStop(1, '#2a1650');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, SEA_Y);
    stars.forEach(s => {
      ctx.globalAlpha = s.a * (0.5 + 0.5 * Math.sin(now / 800 + s.tw));
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x, s.y, 1.5, 1.5);
    });
    ctx.globalAlpha = 1;
    // Mond
    ctx.fillStyle = '#efe8d4';
    ctx.beginPath(); ctx.arc(W - 130, 76, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d8d0ba';
    ctx.beginPath(); ctx.arc(W - 138, 70, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W - 122, 84, 4, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(cityC, 0, SEA_Y - 130);
  }

  function drawSea(now) {
    // Spiegelung: den bereits gezeichneten Himmel streifenweise gespiegelt in den See
    ctx.fillStyle = '#060614';
    ctx.fillRect(0, SEA_Y, W, H - SEA_Y);
    const strip = 10, n = Math.ceil((H - SEA_Y) / strip);
    ctx.save();
    ctx.globalAlpha = 0.32;
    for (let i = 0; i < n; i++) {
      const sy = SEA_Y - (i + 1) * strip;
      if (sy < 0) break;
      const off = Math.sin(now / 900 + i * 0.7) * (2 + i * 0.5);
      ctx.drawImage(cv, 0, sy, W, strip, off, SEA_Y + i * strip, W, strip);
    }
    ctx.restore();
    // Wellen-Glanzlinien
    ctx.strokeStyle = 'rgba(120,150,220,0.10)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = SEA_Y + 14 + i * 26;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 16) {
        const yy = y + Math.sin(x / 60 + now / 700 + i) * 2;
        x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    // Uferkante
    ctx.fillStyle = '#0a0820';
    ctx.fillRect(0, SEA_Y - 2, W, 3);
  }

  function drawSlots(now) {
    order.forEach(id => {
      const x = slotX(id), col = players[id] ? players[id].color : '#888';
      ctx.fillStyle = '#141024';
      rr(ctx, x - 20, SEA_Y - 8, 40, 8, 3); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(x, SEA_Y - 6, 7, col, 0.7);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rockets[id] ? 'rgba(255,255,255,.45)' : '#fff';
      ctx.font = 'bold 12px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(shortName(id) + ' · ' + py[id].points, x, SEA_Y + 14);
    });
  }

  function drawParts(now, dt) {
    ctx.globalCompositeOperation = 'lighter';
    parts = parts.filter(p => {
      const f = (now - p.born) / p.life;
      if (f >= 1) return false;
      p.vx *= p.drag; p.vy *= p.drag;
      p.vy += p.g * dt * timeScale;
      p.x += p.vx * dt * timeScale;
      p.y += p.vy * dt * timeScale;
      const a = (1 - f) * (p.twinkle ? (0.4 + 0.6 * Math.abs(Math.sin(now / 90 + p.x))) : 1);
      drawGlow(p.x, p.y, p.size * (1 - f * 0.6) + 0.8, p.color, a);
      return true;
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawTexts(now) {
    texts = texts.filter(t => {
      const f = (now - t.born) / t.life;
      if (f >= 1) return false;
      ctx.globalAlpha = 1 - f;
      ctx.fillStyle = t.color;
      ctx.font = 'bold ' + t.size + 'px system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.text, t.x, t.y - f * 34);
      ctx.globalAlpha = 1;
      return true;
    });
  }

  function drawHud(now) {
    ctx.textBaseline = 'middle';
    if (phase === 'run' && !finale) {
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.font = 'bold 15px system-ui,sans-serif';
      ctx.fillText('🌊 Welle ' + wave + ' / ' + wavesTotal, 14, 20);
      const wleft = Math.max(0, Math.ceil((waveAt + WAVE_MS - now) / 1000));
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.fillText(wleft + 's', 14, 40);
    } else if (finale && phase === 'run') {
      // Publikums-Meter
      const bw = 300, bx = W / 2 - bw / 2;
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      rr(ctx, bx, 12, bw, 16, 8); ctx.fill();
      if (crowd > 0) {
        ctx.fillStyle = '#ffd60a';
        rr(ctx, bx, 12, Math.max(12, bw * crowd / 100), 16, 8); ctx.fill();
      }
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui,sans-serif';
      ctx.fillText('👏 PUBLIKUM ' + Math.round(crowd) + '%', W / 2, 44);
      const fleft = Math.max(0, Math.ceil((finaleAt + FINALE_MS - now) / 1000));
      ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 22px system-ui,sans-serif';
      ctx.fillText(fleft + 's', W / 2, 70);
    }
    if (phase === 'end') {
      // Ambient-Feuerwerk hinter dem Ranking
      if (Math.random() < 0.05) {
        const kal = 1 + ((Math.random() * 2) | 0);
        const id = order[(Math.random() * order.length) | 0];
        explode(100 + Math.random() * (W - 200), 60 + Math.random() * (SEA_Y - 260), kal,
          ['peony', 'willow', 'ring'][(Math.random() * 3) | 0], players[id] ? players[id].color : '#ffd60a', false);
      }
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 50px system-ui,sans-serif';
      ctx.shadowColor = '#ffd60a'; ctx.shadowBlur = 22;
      ctx.fillText('🎆 Show vorbei!', W / 2, 100);
      ctx.shadowBlur = 0;
      const grade = crowd >= 80 ? '🤩 Legendär!' : crowd >= 50 ? '👏 Starke Show!' : '🙂 Nette Show.';
      ctx.fillStyle = '#fff'; ctx.font = 'bold 22px system-ui,sans-serif';
      ctx.fillText('Publikum: ' + Math.round(crowd) + '% — ' + grade, W / 2, 148);
      const st = order.slice().sort((a, b) => py[b].points - py[a].points);
      ctx.font = 'bold 24px system-ui,sans-serif';
      st.slice(0, 8).forEach((id, i) => {
        ctx.fillStyle = players[id] ? players[id].color : '#888';
        ctx.fillText((i + 1) + '.  ' + shortName(id) + ' — ' + py[id].points + ' Punkte' + (i === 0 ? ' 👑' : ''), W / 2, 200 + i * 36);
      });
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '16px system-ui,sans-serif';
      ctx.fillText('⭐ Host kann am Handy eine neue Show starten', W / 2, H - 40);
    }
    if (announce && now < announce.until) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = Math.min(1, (announce.until - now) / 400);
      ctx.font = 'bold ' + announce.size + 'px system-ui,sans-serif';
      ctx.fillStyle = announce.color;
      ctx.shadowColor = announce.color; ctx.shadowBlur = 18;
      ctx.fillText(announce.text, W / 2, 120);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'right'; ctx.font = '13px system-ui,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.textBaseline = 'middle';
    ctx.fillText('Host kann am Handy abbrechen ✕', W - 12, H - 10);
  }

  return {
    acceptsJoin: false,
    start(ids, cfg) {
      order = ids.slice().sort((a, b) => a - b);
      wavesTotal = (cfg && cfg.wellen) || 3;
      py = {}; rockets = {}; parts = []; texts = []; rings = []; dets = [];
      order.forEach(id => { py[id] = { points: 0, ammo: 100 }; });
      phase = 'run'; wave = 1; timeScale = 1; crowd = 0; winner = null;
      finale = false; nextRingAt = 0;
      startAt = performance.now(); lastT = startAt; waveAt = startAt; lastYou = 0;
      buildCity();
      say('🎆 Die Show beginnt!', '#ffd60a', 2400, 44);
      order.forEach(id => ac.message(id, { t: 'hzState', msg: '🎆 Welle 1 — zeig, was du kannst!' }));
    },
    stop() { rockets = {}; parts = []; rings = []; },
    onDisconnect(id) {
      order = order.filter(o => o !== id);
      delete rockets[id]; delete py[id];
      if (!order.length) { endToLobby(''); return; }
      if (phase === 'end') {
        // Host könnte gegangen sein — Nochmal-Button an den neuen Host geben
        const grade = crowd >= 80 ? '🤩 Legendär!' : crowd >= 50 ? '👏 Starke Show!' : '🙂 Nette Show.';
        const h = hostId();
        order.forEach(o => ac.message(o, {
          t: 'hzEnd', win: o === winner, name: winner !== null && py[winner] ? nameOf(winner) : '—', host: o === h, grade
        }));
      }
    },
    onMessage(id, d) {
      if (!d || !py[id]) return;
      const now = performance.now();
      if (d.t === 'hzLaunch') launch(id, d, now);
      else if (d.t === 'hzDet') detonate(id, now, false);
      else if (d.t === 'hzAgain' && id === hostId() && phase === 'end') this.start(order, { wellen: wavesTotal });
    },
    render() {
      const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      simulate(dt, now);
      ctx.save();
      if (now < shake.until) {
        const m = shake.mag * (shake.until - now) / 600;
        ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      } else shake.mag = 0;
      drawScene(now);
      drawRings(now);
      // Raketen
      Object.keys(rockets).forEach(id => {
        const r = rockets[id];
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(r.x, r.y, 4.5, '#fff7d0', 0.95);
        ctx.globalCompositeOperation = 'source-over';
      });
      drawParts(now, dt);
      drawSea(now);
      drawSlots(now);
      drawTexts(now);
      drawHud(now);
      if (now < flash.until) {
        ctx.globalAlpha = 0.5 * (flash.until - now) / flash.dur;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    },
    _debug() { return { py, rockets, rings, phase, wave, parts: parts.length, order }; }
  };
}});
