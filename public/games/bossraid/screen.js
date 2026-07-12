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
  let flash = { color: '#fff', until: 0, dur: 1 };
  let bossHitAt = 0;

  function setFlash(color, ms) { flash = { color, until: performance.now() + ms, dur: ms }; }

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

  // ---------- Boss: MECHA-KERN ----------
  function makeMecha(nPlayers) {
    const core = { x: W / 2, y: 180, r: 42 };
    const maxHp = Math.round(380 * Math.max(1, nPlayers) * (hard ? 1.4 : 1));
    const NODES = 4, nodes = [];
    for (let i = 0; i < NODES; i++) {
      nodes.push({ ang: i / NODES * Math.PI * 2, alive: true, hp: Math.round(maxHp * 0.11), lastShot: nowMs() + 1500 + i * 500, x: 0, y: 0 });
    }
    const b = {
      kind: 'mecha', name: 'MECHA-KERN X-7', color: '#39d8ff', color2: '#ff9f0a',
      hp: maxHp, maxHp, core, nodes, beams: [],
      lastRing: 0, lastWall: 0, lastBeam: 0, rot: 0,
      armored() { return nodes.filter(n => n.alive).length >= 2; },
      phaseNo() { return b.hp > b.maxHp * 2 / 3 ? 1 : b.hp > b.maxHp / 3 ? 2 : 3; },
      update(dt, now) {
        const ph = b.phaseNo();
        core.x = W / 2 + Math.sin(now / 2900) * 90;
        b.rot += dt * (0.5 + ph * 0.22);
        // Orbit-Nodes (Geschütze)
        nodes.forEach((n, i) => {
          n.ang += dt * 0.55;
          n.x = core.x + Math.cos(n.ang) * 96;
          n.y = core.y + Math.sin(n.ang) * 78;
          if (!n.alive) return;
          const gap = ph === 1 ? 2600 : ph === 2 ? 1900 : 1400;
          if (now > n.lastShot + gap) {
            n.lastShot = now;
            const tgt = nearestFighter(n.x, n.y);
            if (tgt) {
              const a = Math.atan2(tgt.y - n.y, tgt.x - n.x);
              fireE(n.x, n.y, Math.cos(a) * 175 * speedMul(), Math.sin(a) * 175 * speedMul(), 6, b.color2);
            }
          }
        });
        // Ring-Bursts (Quadrat-Muster: 4 Arme rotierend)
        const ringGap = ph === 1 ? 1900 : ph === 2 ? 1400 : 1000;
        if (now > b.lastRing + ringGap) {
          b.lastRing = now;
          const arms = ph === 3 ? 6 : 4;
          for (let i = 0; i < arms; i++) {
            const a = b.rot + i / arms * Math.PI * 2;
            for (let k = 0; k < 3; k++) {
              const sp = (95 + k * 34) * speedMul();
              fireE(core.x, core.y, Math.cos(a) * sp, Math.sin(a) * sp, 6, b.color);
            }
          }
        }
        // Bullet-Wand mit Lücke (ab P2)
        if (ph >= 2 && now > b.lastWall + (ph === 3 ? 4200 : 5600)) {
          b.lastWall = now;
          const gapAt = 80 + Math.random() * (W - 160);
          for (let x = 20; x < W; x += 34) {
            if (Math.abs(x - gapAt) < 62) continue;
            fireE(x, 60, 0, 95 * speedMul(), 6, '#ff5db1');
          }
          say('⬇️ WAND!', '#ff5db1', 900, 30);
        }
        // Rotierender Laser (Telegraph → aktiv)
        const beamGap = ph === 1 ? 7000 : ph === 2 ? 5200 : 4200;
        if (now > b.lastBeam + beamGap) {
          b.lastBeam = now;
          const tgt = nearestFighter(core.x, core.y);
          const a0 = tgt ? Math.atan2(tgt.y - core.y, tgt.x - core.x) : Math.PI / 2;
          b.beams.push({ ang: a0, spin: (Math.random() < 0.5 ? 1 : -1) * (0.35 + ph * 0.1), activeAt: now + 900, until: now + 900 + 2600 });
        }
        b.beams = b.beams.filter(beam => now < beam.until);
        b.beams.forEach(beam => {
          if (now > beam.activeAt) {
            beam.ang += beam.spin * dt;
            // Trefferprüfung: Abstand Spieler → Strahl-Halbgerade
            order.forEach(id => {
              const f = fighters[id];
              if (!f || f.hp <= 0) return;
              const dx = f.x - core.x, dy = f.y - core.y;
              const along = dx * Math.cos(beam.ang) + dy * Math.sin(beam.ang);
              if (along < core.r) return;
              const perp = Math.abs(-dx * Math.sin(beam.ang) + dy * Math.cos(beam.ang));
              if (perp < 13) hurtFighter(id, f, now);
            });
          }
        });
      },
      targets() {
        const out = [{ x: core.x, y: core.y, r: core.r, ref: 'core' }];
        nodes.forEach((n, i) => { if (n.alive) out.push({ x: n.x, y: n.y, r: 14, ref: i }); });
        return out;
      },
      damage(ref, dmg, now) {
        if (ref === 'core') {
          b.hp = Math.max(0, b.hp - (b.armored() ? dmg * 0.35 : dmg));
        } else {
          const n = nodes[ref];
          if (!n || !n.alive) return;
          n.hp -= dmg;
          b.hp = Math.max(0, b.hp - dmg * 0.5);
          if (n.hp <= 0) {
            n.alive = false;
            spark(n.x, n.y, b.color2, 24, 240, 4, 700);
            setShake(9, 400);
            say(b.armored() ? '🤖 Geschütz zerstört!' : '💥 KERN VERWUNDBAR!', b.color2, 1600, 34);
          }
        }
      },
      draw(now) {
        const ph = b.phaseNo();
        // Deko-Ringe
        ctx.globalCompositeOperation = 'lighter';
        [66, 96].forEach((r, i) => {
          ctx.strokeStyle = 'rgba(57,216,255,' + (0.25 - i * 0.08) + ')';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([26, 18]);
          ctx.lineDashOffset = (i ? -1 : 1) * now / 24;
          ctx.beginPath(); ctx.ellipse(core.x, core.y, r, r * 0.82, 0, 0, Math.PI * 2); ctx.stroke();
        });
        ctx.setLineDash([]);
        ctx.globalCompositeOperation = 'source-over';
        // Laser
        b.beams.forEach(beam => {
          const ex = core.x + Math.cos(beam.ang) * 1200, ey = core.y + Math.sin(beam.ang) * 1200;
          if (now < beam.activeAt) {
            ctx.strokeStyle = 'rgba(255,90,90,' + (0.3 + Math.sin(now / 70) * 0.2) + ')';
            ctx.lineWidth = 2.5; ctx.setLineDash([10, 10]);
            ctx.beginPath(); ctx.moveTo(core.x, core.y); ctx.lineTo(ex, ey); ctx.stroke();
            ctx.setLineDash([]);
          } else {
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = 'rgba(255,80,80,0.45)'; ctx.lineWidth = 24; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(core.x, core.y); ctx.lineTo(ex, ey); ctx.stroke();
            ctx.strokeStyle = '#ffe1e1'; ctx.lineWidth = 7;
            ctx.beginPath(); ctx.moveTo(core.x, core.y); ctx.lineTo(ex, ey); ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
          }
        });
        // Nodes
        nodes.forEach(n => {
          if (!n.alive) return;
          ctx.globalCompositeOperation = 'lighter';
          drawGlow(n.x, n.y, 12, b.color2, 0.7);
          ctx.globalCompositeOperation = 'source-over';
          ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(now / 400);
          ctx.fillStyle = '#2b1a05'; ctx.strokeStyle = b.color2; ctx.lineWidth = 2.5;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; i ? ctx.lineTo(Math.cos(a) * 11, Math.sin(a) * 11) : ctx.moveTo(11, 0); }
          ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.restore();
        });
        // Kern (rotierendes Sechseck)
        const pulse = 1 + Math.sin(now / (ph === 3 ? 120 : 280)) * 0.05;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(core.x, core.y, core.r * 1.5 * pulse, b.color, 0.6);
        ctx.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.translate(core.x, core.y); ctx.rotate(b.rot * 0.5);
        const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, core.r * pulse);
        grad.addColorStop(0, '#eaffff'); grad.addColorStop(0.5, b.color); grad.addColorStop(1, '#0a2a3d');
        ctx.fillStyle = grad; ctx.strokeStyle = '#bdf3ff'; ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; i ? ctx.lineTo(Math.cos(a) * core.r * pulse, Math.sin(a) * core.r * pulse) : ctx.moveTo(core.r * pulse, 0); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        if (b.armored()) {
          ctx.strokeStyle = 'rgba(255,159,10,' + (0.35 + Math.sin(now / 200) * 0.15) + ')';
          ctx.lineWidth = 4; ctx.setLineDash([12, 9]);
          ctx.beginPath(); ctx.arc(core.x, core.y, core.r + 13, now / 900, now / 900 + Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    };
    return b;
  }

  // ---------- Boss: NEON-DRACHE ----------
  function makeDragon(nPlayers) {
    const maxHp = Math.round(380 * Math.max(1, nPlayers) * (hard ? 1.4 : 1));
    const SEGS = 15, SPACING = 24;
    const b = {
      kind: 'dragon', name: 'NEON-DRACHE', color: '#7bffbf', color2: '#ff5db1',
      hp: maxHp, maxHp,
      core: { x: W / 2, y: 170, r: 22 }, // Kopf (für Laser-Ziel & HUD)
      heading: 0, speed: 130, tgt: { x: W / 2, y: 300 }, tgtAt: 0,
      trail: [], segs: [], flames: [],
      lastVolley: 0, lastCone: 0, lastFlame: 0,
      armored() { return false; },
      phaseNo() { return b.hp > b.maxHp * 2 / 3 ? 1 : b.hp > b.maxHp / 3 ? 2 : 3; },
      update(dt, now) {
        const ph = b.phaseNo();
        b.speed = (125 + ph * 32) * (hard ? 1.15 : 1);
        // Wanderziel
        if (now > b.tgtAt) {
          b.tgtAt = now + 1700 + Math.random() * 1300;
          b.tgt = { x: 70 + Math.random() * (W - 140), y: 80 + Math.random() * (H * 0.62) };
        }
        const want = Math.atan2(b.tgt.y - b.core.y, b.tgt.x - b.core.x);
        let diff = want - b.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        b.heading += clamp(diff, -1.6 * dt, 1.6 * dt);
        b.core.x = clamp(b.core.x + Math.cos(b.heading) * b.speed * dt, 30, W - 30);
        b.core.y = clamp(b.core.y + Math.sin(b.heading) * b.speed * dt, 50, H - 60);
        // Trail + Segmente (Follow the Leader)
        if (dt > 0) b.trail.unshift({ x: b.core.x, y: b.core.y });
        if (b.trail.length > 400) b.trail.length = 400;
        b.segs = [];
        let dist = SPACING, ti = 0;
        for (let s = 0; s < SEGS && ti < b.trail.length - 1; s++) {
          while (ti < b.trail.length - 1) {
            const a = b.trail[ti], c = b.trail[ti + 1];
            const d = Math.hypot(a.x - c.x, a.y - c.y);
            if (d >= dist || ti === b.trail.length - 2) { b.segs.push({ x: c.x, y: c.y }); break; }
            dist -= d; ti++;
          }
          dist = SPACING;
        }
        // Körper-Berührung tut weh
        order.forEach(id => {
          const f = fighters[id];
          if (!f || f.hp <= 0) return;
          if (Math.hypot(f.x - b.core.x, f.y - b.core.y) < 24) { hurtFighter(id, f, now); return; }
          for (const s of b.segs) {
            if (Math.hypot(f.x - s.x, f.y - s.y) < 20) { hurtFighter(id, f, now); break; }
          }
        });
        // Feuerbälle (gezielt)
        const volleyGap = ph === 1 ? 2100 : ph === 2 ? 1500 : 1100;
        if (now > b.lastVolley + volleyGap) {
          b.lastVolley = now;
          const tgt = nearestFighter(b.core.x, b.core.y);
          if (tgt) {
            const a = Math.atan2(tgt.y - b.core.y, tgt.x - b.core.x);
            const n = ph >= 2 ? 3 : 1;
            for (let k = 0; k < n; k++) {
              const aa = a + (k - (n - 1) / 2) * 0.22;
              fireE(b.core.x, b.core.y, Math.cos(aa) * 165 * speedMul(), Math.sin(aa) * 165 * speedMul(), 7, '#ffb03a');
            }
          }
        }
        // Flammenkegel in Blickrichtung
        if (now > b.lastCone + (ph === 3 ? 3400 : 4600)) {
          b.lastCone = now;
          for (let k = 0; k < 9; k++) {
            const aa = b.heading + (k - 4) * 0.14;
            const sp = (120 + Math.random() * 60) * speedMul();
            fireE(b.core.x + Math.cos(b.heading) * 20, b.core.y + Math.sin(b.heading) * 20,
              Math.cos(aa) * sp, Math.sin(aa) * sp, 6, b.color2);
          }
        }
        // P3: brennende Spur am Schwanz
        if (ph === 3 && now > b.lastFlame + 240 && b.segs.length) {
          b.lastFlame = now;
          const tail = b.segs[b.segs.length - 1];
          b.flames.push({ x: tail.x, y: tail.y, r: 17, until: now + 2600 });
        }
        b.flames = b.flames.filter(fl => now < fl.until);
        b.flames.forEach(fl => {
          order.forEach(id => {
            const f = fighters[id];
            if (!f || f.hp <= 0) return;
            if (Math.hypot(f.x - fl.x, f.y - fl.y) < fl.r) hurtFighter(id, f, now);
          });
        });
      },
      targets() {
        const out = [{ x: b.core.x, y: b.core.y, r: 22, ref: 'core' }];
        // Herz-Segment als Weakpoint
        if (b.segs[5]) out.push({ x: b.segs[5].x, y: b.segs[5].y, r: 16, ref: 'heart' });
        return out;
      },
      damage(ref, dmg) {
        b.hp = Math.max(0, b.hp - (ref === 'heart' ? dmg * 1.7 : dmg));
      },
      draw(now) {
        const ph = b.phaseNo();
        // Flammen-Spur
        b.flames.forEach(fl => {
          const left = (fl.until - now) / 2600;
          ctx.globalCompositeOperation = 'lighter';
          drawGlow(fl.x + (Math.random() - 0.5) * 3, fl.y + (Math.random() - 0.5) * 3, fl.r * 0.75, '#ff7a30', 0.5 * left + 0.15);
          ctx.globalCompositeOperation = 'source-over';
        });
        // Körper (hinten → vorne)
        for (let i = b.segs.length - 1; i >= 0; i--) {
          const s = b.segs[i], f = i / SEGS;
          const r = 16 - f * 9;
          const col = i === 5 ? '#fff' : b.color;
          ctx.globalCompositeOperation = 'lighter';
          drawGlow(s.x, s.y, r * 0.9, i === 5 ? b.color2 : b.color, i === 5 ? 0.9 : 0.4);
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = i % 2 ? '#0d3a2a' : '#11533a';
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          if (i === 5) { // Herz-Weakpoint pulsiert
            ctx.fillStyle = b.color2;
            ctx.beginPath(); ctx.arc(s.x, s.y, 6 + Math.sin(now / 160) * 2, 0, Math.PI * 2); ctx.fill();
          }
        }
        // Kopf
        const hx = b.core.x, hy = b.core.y;
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(hx, hy, 26, b.color, 0.7);
        ctx.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.translate(hx, hy); ctx.rotate(b.heading);
        ctx.fillStyle = '#11533a'; ctx.strokeStyle = b.color; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(26, 0); ctx.lineTo(4, -16); ctx.lineTo(-14, -10); ctx.lineTo(-14, 10); ctx.lineTo(4, 16);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Hörner + Augen
        ctx.fillStyle = b.color2;
        ctx.beginPath(); ctx.moveTo(-8, -12); ctx.lineTo(-20, -22); ctx.lineTo(-4, -15); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-8, 12); ctx.lineTo(-20, 22); ctx.lineTo(-4, 15); ctx.closePath(); ctx.fill();
        ctx.fillStyle = ph === 3 ? '#ff4040' : '#fff';
        ctx.beginPath(); ctx.arc(8, -7, 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(8, 7, 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    };
    return b;
  }

  const BOSSES = { kraken: makeKraken, mecha: makeMecha, dragon: makeDragon };

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
    reportWinners(order); // Co-op: Boss besiegt = alle gewinnen
    ebullets = [];
    setShake(16, 1400);
    setFlash('#ffffff', 700);
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
      setFlash(ph === 3 ? '#ff3040' : '#ffffff', 450);
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
      // Triebwerks-Trail
      if (Math.hypot(f.vx, f.vy) > 70 && Math.random() < 0.55 && sparks.length < 380) {
        sparks.push({ x: f.x - f.vx * 0.05, y: f.y - f.vy * 0.05, vx: -f.vx * 0.12, vy: -f.vy * 0.12, born: now, life: 260, color: players[id] ? players[id].color : '#fff', size: 2.2 });
      }
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
          bossHitAt = now;
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
  let vignette = null;
  function drawVignette() {
    if (!vignette) {
      vignette = document.createElement('canvas');
      vignette.width = W; vignette.height = H;
      const g = vignette.getContext('2d');
      const grad = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }
    ctx.drawImage(vignette, 0, 0);
  }

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
      sfx.ambient('drone');
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
      else if (phase === 'win') {
        // Host könnte gegangen sein — Revanche-Button an den neuen Host geben
        const h = hostId();
        order.forEach(o => ac.message(o, { t: 'brEnd', win: true, host: o === h }));
      }
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
        // Hit-Flash: Boss blitzt bei Treffern
        if (now - bossHitAt < 90 && boss.core) {
          ctx.globalCompositeOperation = 'lighter';
          drawGlow(boss.core.x, boss.core.y, boss.core.r * 0.9, '#ffffff', 0.35 * (1 - (now - bossHitAt) / 90));
          ctx.globalCompositeOperation = 'source-over';
        }
        drawZones(now);
        drawFighters(now);
        drawBullets();
        drawSparks(now);
        drawVignette();
        drawHudTop(now);
      }
      // Screen-Flash (Phasenwechsel, Sieg)
      if (now < flash.until) {
        ctx.globalAlpha = 0.55 * (flash.until - now) / flash.dur;
        ctx.fillStyle = flash.color;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    },
    _debug() { return { fighters, boss, phase, ebullets, zones }; }
  };
}});
