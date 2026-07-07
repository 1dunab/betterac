// ===== Modul: BOSS RAID (Neon-Bullet-Hell, Koop) ============
// Alle Spieler kämpfen gemeinsam gegen einen großen Boss.
// Bewegen + Autoschuss, Klassen-Skill (Tank/Healer/DD),
// Geister-Revive, Wipe = Boss heilt auf Phasenstart.
// ============================================================
registerGame({ key: 'bossraid', screen: function () {
  const W = cv.width, H = cv.height;
  const PLAYER_R = 10, PLAYER_SPEED = 235, SHOT_MS = 270, SHOT_DMG = 3;
  const REVIVE_MS = 1500, INVULN_MS = 1200;
  const SKILLS = {
    tank: { cd: 10000, dur: 3200, label: '🛡️' },
    healer: { cd: 12000, dur: 2400, label: '💚' },
    dd: { cd: 9000, dur: 1400, label: '⚡' }
  };

  let fighters = {}, order = [], boss = null, cfg = {};
  let phase = 'pick'; // pick | fight | wipe | win
  let phaseAt = 0, lastT = 0, hard = false;
  let ebullets = [], pshots = [], sparks = [], zones = [], announce = null;
  let shake = { mag: 0, until: 0 };
  let stars = [];

  // ---------- Glow-Sprites (gecacht, schnell via drawImage + 'lighter') ----------
  const glowCache = {};
  function glowSprite(color, r) {
    const key = color + '|' + r;
    if (glowCache[key]) return glowCache[key];
    const c = document.createElement('canvas');
    c.width = c.height = r * 4;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(r * 2, r * 2, 0, r * 2, r * 2, r * 2);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, r * 4, r * 4);
    glowCache[key] = c;
    return c;
  }
  function drawGlow(x, y, r, color, alpha) {
    const s = glowSprite(color, 16);
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(s, x - r * 2, y - r * 2, r * 4, r * 4);
    ctx.globalAlpha = 1;
  }

  const nowMs = () => performance.now();
  function setShake(mag, ms) { shake.mag = Math.max(shake.mag, mag); shake.until = nowMs() + ms; }
  function say(text, color, ms, size) { announce = { text, color: color || '#fff', until: nowMs() + (ms || 1800), size: size || 44 }; }
  function spark(x, y, color, n, speed, size, life) {
    for (let i = 0; i < n; i++) {
      if (sparks.length > 420) return;
      const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random() * 0.7) * (speed || 160);
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: nowMs(), life: (life || 500) * (0.6 + Math.random() * 0.7), color, size: size || 3 });
    }
  }
  function fireE(x, y, vx, vy, r, color) {
    if (ebullets.length > 520) return;
    ebullets.push({ x, y, vx, vy, r: r || 6, color: color || '#ff5db1' });
  }
  const speedMul = () => hard ? 1.22 : 1;

  // ---------- Boss: VOID-KRAKEN ----------
  function makeKraken(nPlayers) {
    const core = { x: W / 2, y: 178, r: 46 };
    const maxHp = Math.round(380 * Math.max(1, nPlayers) * (hard ? 1.4 : 1));
    const T = 6, tentacles = [];
    for (let i = 0; i < T; i++) {
      tentacles.push({
        baseAng: Math.PI * (0.1 + 0.8 * i / (T - 1)), // fächern nach unten
        hp: Math.round(maxHp * 0.09), maxHp: Math.round(maxHp * 0.09),
        alive: true, segs: [], lastShot: nowMs() + 1200 + i * 420, wave: Math.random() * 9
      });
    }
    const b = {
      kind: 'kraken', name: 'VOID-KRAKEN', color: '#b16bff', color2: '#31e0d2',
      hp: maxHp, maxHp, core, tentacles,
      lastRing: 0, spiralA: 0, lastSpiral: 0, lastRain: 0,
      armored() { return tentacles.filter(t => t.alive).length >= 3; },
      phaseNo() { return b.hp > b.maxHp * 2 / 3 ? 1 : b.hp > b.maxHp / 3 ? 2 : 3; },
      update(dt, now) {
        const ph = b.phaseNo();
        core.x = W / 2 + Math.sin(now / 2300) * 120 * (ph >= 2 ? 1 : 0.4);
        core.y = 178 + Math.sin(now / 1700) * 22;
        // Tentakel-Segmente (Sinus-Ketten)
        tentacles.forEach((t, ti) => {
          t.segs = [];
          if (!t.alive) return;
          let x = core.x, y = core.y, ang = t.baseAng;
          const segN = 9, segLen = 26;
          for (let j = 0; j < segN; j++) {
            ang += Math.sin(now / 640 + t.wave + j * 0.6) * 0.22;
            x += Math.cos(ang) * segLen;
            y += Math.sin(ang) * segLen * 0.9;
            t.segs.push({ x, y });
          }
          // Tentakel-Spitze schießt gezielt
          const gap = (ph === 1 ? 3400 : ph === 2 ? 2500 : 1900);
          if (now > t.lastShot + gap) {
            t.lastShot = now;
            const tip = t.segs[segN - 1], tgt = nearestFighter(tip.x, tip.y);
            if (tgt) {
              const a = Math.atan2(tgt.y - tip.y, tgt.x - tip.x);
              const n = ph >= 2 ? 3 : 1;
              for (let k = 0; k < n; k++) {
                const aa = a + (k - (n - 1) / 2) * 0.2;
                fireE(tip.x, tip.y, Math.cos(aa) * 150 * speedMul(), Math.sin(aa) * 150 * speedMul(), 6, b.color2);
              }
            }
          }
        });
        // Kern-Patterns
        const ringGap = ph === 1 ? 2300 : ph === 2 ? 1800 : 1350;
        if (now > b.lastRing + ringGap) {
          b.lastRing = now;
          const n = ph === 3 ? 24 : 16, off = Math.random() * Math.PI * 2;
          for (let i = 0; i < n; i++) {
            const a = off + i / n * Math.PI * 2;
            fireE(core.x, core.y, Math.cos(a) * 110 * speedMul(), Math.sin(a) * 110 * speedMul(), 7, b.color);
          }
        }
        if (ph >= 2 && now > b.lastSpiral + (ph === 3 ? 70 : 110)) {
          b.lastSpiral = now;
          b.spiralA += 0.42;
          for (const dir of (ph === 3 ? [1, -1] : [1])) {
            const a = b.spiralA * dir;
            fireE(core.x, core.y, Math.cos(a) * 140 * speedMul(), Math.sin(a) * 140 * speedMul(), 5, '#ff5db1');
          }
        }
      },
      targets() {
        const out = [{ x: core.x, y: core.y, r: core.r, ref: 'core' }];
        tentacles.forEach((t, i) => {
          if (t.alive && t.segs.length) {
            const tip = t.segs[t.segs.length - 1], mid = t.segs[4];
            out.push({ x: tip.x, y: tip.y, r: 15, ref: i });
            out.push({ x: mid.x, y: mid.y, r: 13, ref: i });
          }
        });
        return out;
      },
      damage(ref, dmg, now) {
        if (ref === 'core') {
          const eff = b.armored() ? dmg * 0.35 : dmg;
          b.hp = Math.max(0, b.hp - eff);
        } else {
          const t = tentacles[ref];
          if (!t || !t.alive) return;
          t.hp -= dmg;
          b.hp = Math.max(0, b.hp - dmg * 0.5);
          if (t.hp <= 0) {
            t.alive = false;
            const tip = t.segs[t.segs.length - 1] || core;
            spark(tip.x, tip.y, b.color2, 26, 240, 4, 700);
            setShake(9, 420);
            say(b.armored() ? '🐙 Tentakel zerstört!' : '💥 KERN VERWUNDBAR!', '#31e0d2', 1600, 34);
          }
        }
      },
      draw(now) {
        const ph = b.phaseNo();
        // Tentakel
        tentacles.forEach(t => {
          if (!t.alive || !t.segs.length) return;
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = b.color; ctx.lineCap = 'round'; ctx.globalAlpha = 0.33;
          ctx.lineWidth = 17;
          ctx.beginPath(); ctx.moveTo(core.x, core.y);
          t.segs.forEach(s => ctx.lineTo(s.x, s.y)); ctx.stroke();
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = '#3d2a63'; ctx.lineWidth = 9;
          ctx.beginPath(); ctx.moveTo(core.x, core.y);
          t.segs.forEach(s => ctx.lineTo(s.x, s.y)); ctx.stroke();
          t.segs.forEach((s, j) => {
            if (j % 2) return;
            ctx.fillStyle = b.color2; ctx.globalAlpha = 0.75;
            ctx.beginPath(); ctx.arc(s.x, s.y, 3.2 - j * 0.18, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
          });
          const tip = t.segs[t.segs.length - 1];
          drawGlow(tip.x, tip.y, 9, b.color2, 0.8);
        });
        // Kern
        const pulse = 1 + Math.sin(now / (ph === 3 ? 130 : 300)) * 0.06;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(core.x, core.y, core.r * 1.6 * pulse, b.color, 0.6);
        ctx.globalCompositeOperation = 'source-over';
        const grad = ctx.createRadialGradient(core.x - 12, core.y - 14, 4, core.x, core.y, core.r * pulse);
        grad.addColorStop(0, '#e9d9ff'); grad.addColorStop(0.45, b.color); grad.addColorStop(1, '#2a1650');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(core.x, core.y, core.r * pulse, 0, Math.PI * 2); ctx.fill();
        if (b.armored()) {
          ctx.strokeStyle = 'rgba(120,220,255,' + (0.35 + Math.sin(now / 200) * 0.15) + ')';
          ctx.lineWidth = 4; ctx.setLineDash([12, 9]);
          ctx.beginPath(); ctx.arc(core.x, core.y, core.r + 12, now / 900, now / 900 + Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
        // Auge schaut den nächsten Spieler an
        const tgt = nearestFighter(core.x, core.y);
        let ex = 0, ey = 0;
        if (tgt) { const a = Math.atan2(tgt.y - core.y, tgt.x - core.x); ex = Math.cos(a) * 12; ey = Math.sin(a) * 12; }
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(core.x, core.y, 20, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#12041f'; ctx.beginPath(); ctx.arc(core.x + ex, core.y + ey, 9 * (ph === 3 ? 0.7 : 1), 0, Math.PI * 2); ctx.fill();
      }
    };
    return b;
  }

  const BOSSES = { kraken: makeKraken };

  // ---------- Spieler ----------
  function nearestFighter(x, y) {
    let best = null, bd = Infinity;
    order.forEach(id => {
      const f = fighters[id];
      if (!f || f.hp <= 0) return;
      const d = (f.x - x) * (f.x - x) + (f.y - y) * (f.y - y);
      if (d < bd) { bd = d; best = f; }
    });
    return best;
  }

  function spawnFighters() {
    order.forEach((id, i) => {
      const f = fighters[id] || {};
      fighters[id] = {
        cls: f.cls || null,
        x: W / 2 + (i - (order.length - 1) / 2) * 60, y: H - 90,
        vx: 0, vy: 0, mx: 0, my: 0,
        hp: 3, ghost: false, reviveP: 0,
        invulnUntil: 0, lastShot: 0, skillReadyAt: 0, skillUntil: 0, skillSent: true
      };
    });
  }

  function hurtFighter(id, f, now) {
    if (now < f.invulnUntil || f.hp <= 0) return;
    // Tank-Schild blockt (Zone check passiert vorher), hier: Treffer
    f.hp--; f.invulnUntil = now + INVULN_MS;
    setShake(5, 200);
    spark(f.x, f.y, players[id] ? players[id].color : '#fff', 10, 190, 3, 450);
    if (f.hp <= 0) {
      f.ghost = true; f.reviveP = 0;
      ac.message(id, { t: 'brYou', hp: 0, ghost: true });
      say('👻 ' + nameOf(id) + ' ist gefallen!', '#ff5d5d', 1500, 30);
      if (order.every(o => !fighters[o] || fighters[o].hp <= 0)) startWipe(now);
    } else {
      ac.message(id, { t: 'brYou', hp: f.hp });
    }
  }

  function reviveFighter(id, f, hp) {
    f.hp = hp; f.ghost = false; f.reviveP = 0; f.invulnUntil = nowMs() + 1500;
    spark(f.x, f.y, '#7dffb1', 16, 200, 3, 600);
    ac.message(id, { t: 'brYou', hp: f.hp, revived: true });
  }

  function castSkill(id, f, now) {
    if (now < f.skillReadyAt || f.hp <= 0 || phase !== 'fight') return;
    const s = SKILLS[f.cls] || SKILLS.dd;
    f.skillReadyAt = now + s.cd;
    f.skillUntil = now + s.dur;
    f.skillSent = false;
    ac.message(id, { t: 'brYou', skill: false });
    if (f.cls === 'tank') {
      zones.push({ kind: 'shield', owner: id, r: 78, until: now + s.dur });
      say('🛡️ ' + nameOf(id) + ' schützt das Team!', '#6db9ff', 1300, 28);
    } else if (f.cls === 'healer') {
      zones.push({ kind: 'heal', x: f.x, y: f.y, r: 88, until: now + s.dur });
      order.forEach(oid => {
        const o = fighters[oid];
        if (!o) return;
        if (Math.hypot(o.x - f.x, o.y - f.y) < 88) {
          if (o.hp <= 0) reviveFighter(oid, o, 2);
          else if (o.hp < 3) { o.hp++; ac.message(oid, { t: 'brYou', hp: o.hp }); spark(o.x, o.y, '#7dffb1', 8, 150, 3, 500); }
        }
      });
      say('💚 ' + nameOf(id) + ' heilt!', '#7dffb1', 1300, 28);
    } else {
      zones.push({ kind: 'laser', owner: id, until: now + s.dur });
      say('⚡ ' + nameOf(id) + ': MEGA-LASER!', '#ffd60a', 1300, 28);
      setShake(4, s.dur);
    }
  }

  // ---------- Phasen / Wipe / Sieg ----------
  let phaseStartHp = 0, lastPhaseNo = 1;

  function startFight(now) {
    phase = 'fight';
    phaseAt = now;
    ebullets = []; pshots = []; zones = [];
    phaseStartHp = boss.hp;
    lastPhaseNo = boss.phaseNo();
    order.forEach(id => ac.message(id, { t: 'brState', phase: 'fight' }));
    say('⚔️ ' + boss.name + ' erwacht!', boss.color, 2200, 46);
    setShake(8, 500);
  }

  function startWipe(now) {
    phase = 'wipe';
    phaseAt = now + 3400;
    setShake(12, 800);
    say('💀 WIPE!', '#ff5d5d', 3000, 64);
    order.forEach(id => ac.message(id, { t: 'brEnd', win: false }));
  }

  function afterWipe(now) {
    boss.hp = phaseStartHp; // Boss erholt sich auf Phasenstart
    ebullets = []; zones = [];
    spawnFighters();
    order.forEach(id => {
      const f = fighters[id];
      ac.message(id, { t: 'brYou', hp: f.hp, skill: true, msg: 'Neuer Versuch! ⚔️' });
    });
    phase = 'fight';
    phaseAt = now;
    say('Neuer Versuch! ⚔️', '#fff', 1800, 40);
  }

  function startWin(now) {
    phase = 'win';
    phaseAt = now;
    ebullets = [];
    setShake(16, 1400);
    const h = hostId();
    order.forEach(id => ac.message(id, { t: 'brEnd', win: true, host: id === h }));
  }

  // ---------- Simulation ----------
  function simulate(dt, now) {
    if (phase === 'pick') {
      const everyone = order.every(id => fighters[id] && fighters[id].cls);
      if (everyone || now >= phaseAt) {
        order.forEach(id => { const f = fighters[id]; if (f && !f.cls) f.cls = 'dd'; });
        startFight(now);
      }
      return;
    }
    if (phase === 'wipe') { if (now >= phaseAt) afterWipe(now); return; }
    if (phase === 'win') {
      if (Math.random() < 0.14) {
        spark(boss.core.x + (Math.random() - 0.5) * 160, boss.core.y + (Math.random() - 0.5) * 120,
          Math.random() < 0.5 ? boss.color : '#ffd60a', 14, 260, 4, 800);
      }
      return;
    }

    boss.update(dt, now);

    // Phasenwechsel
    const ph = boss.phaseNo();
    if (ph !== lastPhaseNo) {
      lastPhaseNo = ph;
      phaseStartHp = boss.hp;
      ebullets = [];
      setShake(11, 600);
      say('😡 PHASE ' + ph + '!', ph === 3 ? '#ff5d5d' : '#ffd60a', 2000, 54);
    }

    // Spieler bewegen + Autoschuss
    order.forEach(id => {
      const f = fighters[id];
      if (!f) return;
      if (f.hp <= 0) return;
      const k = Math.min(1, 10 * dt);
      f.vx += (f.mx * PLAYER_SPEED - f.vx) * k;
      f.vy += (f.my * PLAYER_SPEED - f.vy) * k;
      f.x = clamp(f.x + f.vx * dt, 16, W - 16);
      f.y = clamp(f.y + f.vy * dt, 90, H - 20);
      if (now - f.lastShot > SHOT_MS) {
        f.lastShot = now;
        const ts = boss.targets();
        let best = null, bd = Infinity;
        ts.forEach(t => { const d = (t.x - f.x) ** 2 + (t.y - f.y) ** 2; if (d < bd) { bd = d; best = t; } });
        if (best) {
          const a = Math.atan2(best.y - f.y, best.x - f.x);
          pshots.push({ x: f.x, y: f.y - 6, vx: Math.cos(a) * 430, vy: Math.sin(a) * 430, color: players[id] ? players[id].color : '#fff' });
        }
      }
      // Geister wiederbeleben (Draufstehen)
      order.forEach(oid => {
        const o = fighters[oid];
        if (!o || o.hp > 0 || !o.ghost) return;
        if (Math.hypot(o.x - f.x, o.y - f.y) < 26) {
          o.reviveP += dt * 1000;
          if (o.reviveP >= REVIVE_MS) reviveFighter(oid, o, 2);
        }
      });
      // Skill-Cooldown-Meldung
      if (!f.skillSent && now >= f.skillReadyAt) { f.skillSent = true; ac.message(id, { t: 'brYou', skill: true }); }
    });
    // Revive-Progress zerfällt
    order.forEach(id => {
      const o = fighters[id];
      if (o && o.ghost) {
        const helper = order.some(hid => { const h = fighters[hid]; return h && h.hp > 0 && Math.hypot(h.x - o.x, h.y - o.y) < 26; });
        if (!helper) o.reviveP = Math.max(0, o.reviveP - dt * 700);
      }
    });

    // Zonen (Schild folgt Tank, Laser zieht Schaden)
    zones = zones.filter(z => now < z.until);
    zones.forEach(z => {
      if (z.kind === 'shield') { const f = fighters[z.owner]; if (f) { z.x = f.x; z.y = f.y; } }
      if (z.kind === 'laser') {
        const f = fighters[z.owner];
        if (f && f.hp > 0 && boss.hp > 0) boss.damage('core', 40 * dt, now);
      }
    });

    // Spieler-Schüsse
    pshots = pshots.filter(s => {
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20) return false;
      for (const t of boss.targets()) {
        if (Math.hypot(s.x - t.x, s.y - t.y) < t.r + 4) {
          boss.damage(t.ref, SHOT_DMG, now);
          spark(s.x, s.y, s.color, 3, 120, 2, 300);
          return false;
        }
      }
      return true;
    });
    if (boss.hp <= 0) { startWin(now); return; }

    // Gegner-Kugeln
    const shields = zones.filter(z => z.kind === 'shield');
    ebullets = ebullets.filter(bu => {
      bu.x += bu.vx * dt; bu.y += bu.vy * dt;
      if (bu.x < -30 || bu.x > W + 30 || bu.y < -30 || bu.y > H + 30) return false;
      for (const sh of shields) {
        if (Math.hypot(bu.x - sh.x, bu.y - sh.y) < sh.r) {
          spark(bu.x, bu.y, '#6db9ff', 3, 100, 2, 280);
          return false;
        }
      }
      for (const id of order) {
        const f = fighters[id];
        if (!f || f.hp <= 0) continue;
        if (Math.hypot(bu.x - f.x, bu.y - f.y) < bu.r + PLAYER_R - 3) {
          hurtFighter(id, f, now);
          return false;
        }
      }
      return true;
    });
  }

  // ---------- Rendering ----------
  function drawBackground(now) {
    ctx.fillStyle = '#06030f';
    ctx.fillRect(0, 0, W, H);
    // Sterne
    ctx.fillStyle = '#fff';
    stars.forEach(s => {
      s.y += s.v; if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
      ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(now / 900 + s.x));
      ctx.fillRect(s.x, s.y, s.s, s.s);
    });
    ctx.globalAlpha = 1;
    // dezentes Grid unten
    ctx.strokeStyle = 'rgba(90,60,180,0.12)'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, H * 0.6); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = H * 0.6; y <= H; y += 34) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  }

  function drawFighters(now) {
    order.forEach(id => {
      const f = fighters[id];
      if (!f) return;
      const col = players[id] ? players[id].color : '#fff';
      if (f.hp <= 0) {
        // Geist + Revive-Ring
        ctx.globalAlpha = 0.55 + Math.sin(now / 260) * 0.15;
        ctx.fillStyle = '#cfd8ff'; ctx.font = '22px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('👻', f.x, f.y);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(160,190,255,.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, 26, 0, Math.PI * 2); ctx.stroke();
        if (f.reviveP > 0) {
          ctx.strokeStyle = '#7dffb1'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(f.x, f.y, 26, -Math.PI / 2, -Math.PI / 2 + (f.reviveP / REVIVE_MS) * Math.PI * 2); ctx.stroke();
        }
        return;
      }
      const blink = now < f.invulnUntil && Math.floor(now / 90) % 2 === 0;
      if (blink) return;
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(f.x, f.y, 15, col, 0.55);
      ctx.globalCompositeOperation = 'source-over';
      const a = Math.atan2((boss ? boss.core.y : 0) - f.y, (boss ? boss.core.x : W / 2) - f.x);
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(9, 9); ctx.lineTo(0, 4); ctx.lineTo(-9, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((SKILLS[f.cls] ? SKILLS[f.cls].label + ' ' : '') + shortName(id), f.x, f.y - 24);
    });
  }

  function drawZones(now) {
    zones.forEach(z => {
      const left = (z.until - now) / 1000;
      if (z.kind === 'shield' && z.x !== undefined) {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(z.x, z.y, z.r * 0.7, '#6db9ff', 0.25);
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(120,190,255,' + (0.5 + Math.sin(now / 120) * 0.2) + ')';
        ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.stroke();
      } else if (z.kind === 'heal') {
        ctx.strokeStyle = 'rgba(125,255,177,' + Math.min(0.7, left) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (1 + (1 - Math.min(1, left / 2)) * 0.15), 0, Math.PI * 2); ctx.stroke();
      } else if (z.kind === 'laser') {
        const f = fighters[z.owner];
        if (!f || f.hp <= 0 || !boss) return;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255,214,10,0.35)'; ctx.lineWidth = 22; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(boss.core.x, boss.core.y); ctx.stroke();
        ctx.strokeStyle = '#fff7d0'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(boss.core.x, boss.core.y); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        spark(boss.core.x, boss.core.y, '#ffd60a', 1, 200, 3, 300);
      }
    });
  }

  function drawBullets() {
    ctx.globalCompositeOperation = 'lighter';
    pshots.forEach(s => { drawGlow(s.x, s.y, 6, s.color, 0.9); });
    ebullets.forEach(b => { drawGlow(b.x, b.y, b.r + 3, b.color, 0.95); });
    ctx.globalCompositeOperation = 'source-over';
    ebullets.forEach(b => {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(1.6, b.r * 0.38), 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawSparks(now) {
    ctx.globalCompositeOperation = 'lighter';
    sparks = sparks.filter(p => {
      const f = (now - p.born) / p.life;
      if (f >= 1) return false;
      p.x += p.vx * 0.016; p.y += p.vy * 0.016;
      drawGlow(p.x, p.y, p.size * (1 - f) + 1, p.color, 1 - f);
      return true;
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHudTop(now) {
    if (!boss) return;
    // Boss-HP-Balken
    const bw = W - 220, bx = 110, by = 26;
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    rr(ctx, bx, by - 9, bw, 18, 9); ctx.fill();
    const fr = boss.hp / boss.maxHp;
    if (fr > 0) {
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, boss.color); g.addColorStop(1, '#ff5db1');
      ctx.fillStyle = g;
      rr(ctx, bx, by - 9, Math.max(10, bw * fr), 18, 9); ctx.fill();
    }
    [1 / 3, 2 / 3].forEach(m => {
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillRect(bx + bw * m - 1, by - 12, 2, 24);
    });
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px system-ui,sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(boss.name, bx, by - 22);
    ctx.textAlign = 'right';
    ctx.fillText('Phase ' + boss.phaseNo() + ' / 3', bx + bw, by - 22);
    // Spieler-Panel
    ctx.textAlign = 'left'; ctx.font = 'bold 13px system-ui,sans-serif';
    order.forEach((id, i) => {
      const f = fighters[id];
      if (!f) return;
      const y = H - 16 - (order.length - 1 - i) * 20;
      ctx.fillStyle = players[id] ? players[id].color : '#888';
      ctx.beginPath(); ctx.arc(16, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = f.hp > 0 ? '#fff' : 'rgba(255,255,255,.5)';
      ctx.fillText(shortName(id) + ' ' + (f.hp > 0 ? '❤'.repeat(f.hp) : '👻'), 27, y);
    });

    if (announce && now < announce.until) {
      const f = (announce.until - now) / 1000;
      ctx.textAlign = 'center'; ctx.globalAlpha = Math.min(1, f * 2);
      ctx.font = 'bold ' + announce.size + 'px system-ui,sans-serif';
      ctx.fillStyle = announce.color;
      ctx.shadowColor = announce.color; ctx.shadowBlur = 18;
      ctx.fillText(announce.text, W / 2, H * 0.42);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (phase === 'win') {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 62px system-ui,sans-serif';
      ctx.shadowColor = '#ffd60a'; ctx.shadowBlur = 24;
      ctx.fillText('🏆 BOSS BESIEGT!', W / 2, H / 2 - 20);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '17px system-ui,sans-serif';
      ctx.fillText('⭐ Host kann am Handy eine Revanche starten', W / 2, H / 2 + 40);
    }
  }

  function drawPick(now) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px system-ui,sans-serif';
    ctx.shadowColor = boss ? boss.color : '#fff'; ctx.shadowBlur = 16;
    ctx.fillText('⚔️ ' + (boss ? boss.name : '') + ' wartet…', W / 2, 90);
    ctx.shadowBlur = 0;
    ctx.font = 'bold 20px system-ui,sans-serif'; ctx.fillStyle = '#aaa';
    ctx.fillText('Wählt eure Klasse auf dem Handy!', W / 2, 132);
    const secs = Math.max(0, Math.ceil((phaseAt - now) / 1000));
    ctx.fillText('Start in ' + secs + 's…', W / 2, H - 40);
    order.forEach((id, i) => {
      const f = fighters[id];
      const x = W / 2 + (i - (order.length - 1) / 2) * 150;
      ctx.fillStyle = players[id] ? players[id].color : '#888';
      ctx.beginPath(); ctx.arc(x, H / 2 + 40, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px system-ui,sans-serif';
      ctx.fillText(shortName(id), x, H / 2 + 70);
      ctx.font = '26px system-ui,sans-serif';
      ctx.fillText(f && f.cls ? (SKILLS[f.cls].label) : '❓', x, H / 2 + 8);
    });
  }

  return {
    acceptsJoin: false,
    start(ids, settings) {
      cfg = settings || {};
      hard = cfg.difficulty === 'hard';
      order = ids.slice().sort((a, b) => a - b);
      fighters = {}; ebullets = []; pshots = []; sparks = []; zones = []; announce = null;
      stars = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 0.15 + Math.random() * 0.5, s: Math.random() < 0.2 ? 2 : 1, a: 0.3 + Math.random() * 0.7 }));
      let kind = cfg.boss || 'kraken';
      if (kind === 'random' || !BOSSES[kind]) {
        const keys = Object.keys(BOSSES);
        kind = keys[Math.floor(Math.random() * keys.length)];
      }
      boss = BOSSES[kind](order.length);
      spawnFighters();
      phase = 'pick';
      phaseAt = performance.now() + 14000;
      lastT = performance.now();
      order.forEach(id => ac.message(id, { t: 'brState', phase: 'pick' }));
    },
    stop() { boss = null; },
    onDisconnect(id) {
      order = order.filter(o => o !== id);
      delete fighters[id];
      if (!order.length) { endToLobby(''); return; }
      if (phase === 'fight' && order.every(o => !fighters[o] || fighters[o].hp <= 0)) startWipe(performance.now());
    },
    onMessage(id, d) {
      const f = fighters[id];
      if (!d || !f) return;
      if (d.t === 'brClass' && phase === 'pick') {
        if (['tank', 'healer', 'dd'].includes(d.cls)) f.cls = d.cls;
      } else if (d.t === 'brMove') {
        f.mx = clamp(+d.x || 0, -1, 1); f.my = clamp(+d.y || 0, -1, 1);
      } else if (d.t === 'brSkill') {
        castSkill(id, f, performance.now());
      } else if (d.t === 'brAgain' && id === hostId() && phase === 'win') {
        this.start(order, cfg);
      }
    },
    render() {
      if (!boss) return;
      const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      simulate(dt, now);
      ctx.save();
      if (now < shake.until) {
        const m = shake.mag * (shake.until - now) / 800;
        ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      } else shake.mag = 0;
      drawBackground(now);
      if (phase === 'pick') {
        boss.update(0, now); // Boss "atmet" schon im Hintergrund
        boss.draw(now);
        ebullets = [];
        drawPick(now);
      } else {
        boss.draw(now);
        drawZones(now);
        drawFighters(now);
        drawBullets();
        drawSparks(now);
        drawHudTop(now);
      }
      ctx.restore();
    },
    _debug() { return { fighters, boss, phase, ebullets, zones }; }
  };
}});
