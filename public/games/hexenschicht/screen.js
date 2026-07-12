// ===== Modul: HEXENSCHICHT ==================================
// Koop-Hexenküche: Zutaten spawnen auf den Handys, jeder hat EIN
// Werkzeug — Zutaten fliegen per Wurf sichtbar über den Screen von
// Spieler zu Spieler, werden verarbeitet und im Kessel verrührt.
// ============================================================
registerGame({ key: 'hexenschicht', screen: function () {
  const W = cv.width, H = cv.height;
  const POT = { x: W / 2, y: 350, r: 86 };
  const ING = ['auge', 'pilz', 'kraut', 'knochen', 'kaefer', 'kristall'];
  const ICONS = { auge: '👁️', pilz: '🍄', kraut: '🌿', knochen: '🦴', kaefer: '🪲', kristall: '💎' };
  const TOOL_ICON = { hacken: '🔪', moersern: '🥣', brennen: '🔥', kessel: '🍲' };
  const POTIONS = ['Trank der Nacht', 'Elixier des Grauens', 'Warzensud', 'Nebeltrunk', 'Feuerbrause', 'Schlaftrunk', 'Krötenlikör', 'Morgengrusel'];
  const ING_COLOR = { auge: '#cfe8ff', pilz: '#ff7a6b', kraut: '#7dffb1', knochen: '#f2ead8', kaefer: '#b58cff', kristall: '#6bd7ff' };

  let order = [], tools = {}, availTools = [];
  let items = {}, nextUid = 1, flights = [];
  let recipes = [], potReadyIdx = -1;
  let score = 0, potions = 0, phase = 'run', startAt = 0, durationMs = 240000, lastSpawn = 0;
  let sudColor = '#3fae62', sudFlash = null, rotated = false;
  let parts = [], announce = null, shake = { mag: 0, until: 0 }, lastT = 0;

  // ---------- FX (Standard-Kit) ----------
  const glowCache = {};
  function glowSprite(color) {
    if (glowCache[color]) return glowCache[color];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color); grad.addColorStop(0.4, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    glowCache[color] = c;
    return c;
  }
  function drawGlow(x, y, r, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(glowSprite(color), x - r * 2, y - r * 2, r * 4, r * 4);
    ctx.globalAlpha = 1;
  }
  function say(text, color, ms, size) { announce = { text, color: color || '#fff', until: performance.now() + (ms || 1900), size: size || 38 }; }
  function setShake(mag, ms) { shake.mag = Math.max(shake.mag, mag); shake.until = performance.now() + ms; }
  function spark(x, y, color, n, speed, size, life, g) {
    for (let i = 0; i < n; i++) {
      if (parts.length > 380) return;
      const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random() * 0.7) * speed;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: g || 0, color, size: size || 3, born: performance.now(), life: life * (0.6 + Math.random() * 0.8) });
    }
  }

  // ---------- Setup ----------
  function assignTools(shift) {
    tools = {};
    const pool = ['hacken', 'moersern', 'brennen'];
    const n = order.length;
    order.forEach((id, i) => {
      const k = ((i + (shift || 0)) % n + n) % n;
      tools[id] = k === 0 ? 'kessel' : pool[(k - 1) % pool.length];
    });
    availTools = [...new Set(order.map(id => tools[id]).filter(t => t !== 'kessel'))];
  }
  const kesselId = () => order.find(id => tools[id] === 'kessel');
  const itemsOf = (id) => Object.values(items).filter(it => it.owner === id);
  const nextStep = (it) => it.done >= it.steps.length ? 'fertig' : it.steps[it.done];

  function sendSetup(msg) {
    order.forEach(id => {
      ac.message(id, {
        t: 'hxSetup', tool: tools[id], msg: msg || null,
        targets: order.filter(o => o !== id).map(o => ({
          id: o, name: shortName(o), color: players[o] ? players[o].color : '#888', tool: tools[o]
        }))
      });
    });
  }
  function sendInv(id) {
    if (tools[id] === 'kessel') return;
    ac.message(id, {
      t: 'hxInv',
      items: itemsOf(id).slice(0, 3).map(it => ({ uid: it.uid, type: it.type, steps: it.steps, done: it.done, next: nextStep(it) }))
    });
  }
  function sendScore(msg) {
    order.forEach(id => ac.message(id, { t: 'hxScore', score, msg: msg || null }));
  }

  // ---------- Rezepte ----------
  function newRecipe() {
    const usedNames = recipes.map(r => r.name);
    const name = POTIONS.filter(p => !usedNames.includes(p))[(Math.random() * (POTIONS.length - usedNames.length)) | 0] || POTIONS[0];
    const nIng = 2 + (Math.random() < 0.4 ? 1 : 0);
    const types = shuffle(ING.slice()).slice(0, nIng);
    const needs = types.map((type, i) => {
      const nSteps = i === 0 ? 1 : (Math.random() < 0.5 ? 1 : 2);
      const steps = shuffle(availTools.slice()).slice(0, Math.min(nSteps, availTools.length));
      return { type, steps, got: false };
    });
    return { name, needs };
  }

  function checkPotReady() {
    const wasReady = potReadyIdx;
    potReadyIdx = recipes.findIndex(r => r.needs.every(n => n.got));
    const kid = kesselId();
    if (kid !== undefined && (potReadyIdx >= 0) !== (wasReady >= 0)) {
      ac.message(kid, { t: 'hxKessel', ready: potReadyIdx >= 0 });
      if (potReadyIdx >= 0) say('🌀 UMRÜHREN, ' + nameOf(kid) + '!', '#7dffb1', 2200, 34);
    }
  }

  // ---------- Zutaten ----------
  function spawnItem(now) {
    if (now - lastSpawn < 1500) return;
    // Bedarf: fehlende Rezept-Zutaten, für die noch kein Exemplar unterwegs ist
    const have = Object.values(items).map(it => it.type);
    const missing = [];
    recipes.forEach(r => r.needs.forEach(n => {
      if (!n.got && !have.includes(n.type)) missing.push(n);
    }));
    if (!missing.length) return;
    const holders = order.filter(id => tools[id] !== 'kessel' && itemsOf(id).length < 3);
    if (!holders.length) return;
    lastSpawn = now;
    const need = missing[(Math.random() * missing.length) | 0];
    const owner = holders[(Math.random() * holders.length) | 0];
    const uid = nextUid++;
    items[uid] = { uid, type: need.type, steps: need.steps.slice(), done: 0, owner };
    sendInv(owner);
  }

  // ---------- Werfen / Flüge ----------
  function slotPos(id) {
    const i = order.indexOf(id), n = order.length;
    return { x: W * (0.12 + 0.76 * (n === 1 ? 0.5 : i / (n - 1))), y: H - 52 };
  }
  function startThrow(id, it, to) {
    const from = slotPos(id);
    const target = tools[to] === 'kessel' ? { x: POT.x, y: POT.y - 30 } : slotPos(to);
    it.owner = null;
    flights.push({ it, to, x0: from.x, y0: from.y - 20, x1: target.x, y1: target.y, born: performance.now(), dur: 760 });
    sendInv(id);
  }
  function updateFlights(now) {
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      const t = (now - f.born) / f.dur;
      if (t < 1) continue;
      flights.splice(i, 1);
      const it = f.it;
      if (tools[f.to] === 'kessel') { potIn(it, now); continue; }
      if (f.to === undefined || !order.includes(f.to)) { delete items[it.uid]; continue; }
      if (itemsOf(f.to).length >= 3) {
        // Empfänger voll: klatscht an die Wand
        delete items[it.uid];
        spark(f.x1, f.y1 - 30, ING_COLOR[it.type] || '#8a6', 14, 170, 3, 500, 240);
        say('💥 ' + ICONS[it.type] + ' klatscht an die Wand!', '#ff9f43', 1400, 26);
        continue;
      }
      it.owner = f.to;
      sendInv(f.to);
    }
  }

  // ---------- Kessel ----------
  function potFail(reason) {
    score = Math.max(0, score - 30);
    sudFlash = { color: '#3fdc50', until: performance.now() + 900 };
    spark(POT.x, POT.y - 40, '#3fdc50', 26, 200, 4, 700, -60);
    setShake(9, 450);
    say('🤢 ' + reason + ' (−30)', '#3fdc50', 1900, 30);
    sendScore('🤢 Der Kessel rülpst! −30');
  }
  function potIn(it, now) {
    const uid = it.uid;
    delete items[uid];
    if (nextStep(it) !== 'fertig') { potFail(ICONS[it.type] + ' war noch nicht fertig!'); return; }
    const r = recipes.find(rc => rc.needs.some(n => !n.got && n.type === it.type));
    if (!r) { potFail(ICONS[it.type] + ' braucht gerade niemand!'); return; }
    r.needs.find(n => !n.got && n.type === it.type).got = true;
    score += 15;
    sudColor = ING_COLOR[it.type] || sudColor;
    spark(POT.x, POT.y - 46, ING_COLOR[it.type] || '#7dffb1', 12, 130, 3, 500, -40);
    sendScore(null);
    checkPotReady();
  }
  function stir(id, now) {
    if (tools[id] !== 'kessel' || potReadyIdx < 0) return;
    const r = recipes[potReadyIdx];
    score += 100;
    potions++;
    spark(POT.x, POT.y - 60, '#fff', 30, 260, 3.5, 800, 140);
    spark(POT.x, POT.y - 60, '#ffd60a', 20, 200, 3, 700, 140);
    setShake(7, 400);
    say('🍾 ' + r.name + ' fertig! +100', '#ffd60a', 2400, 36);
    recipes[potReadyIdx] = newRecipe();
    potReadyIdx = -1;
    sendScore('🍾 ' + r.name + '! +100');
    checkPotReady();
    const kid = kesselId();
    if (kid !== undefined) ac.message(kid, { t: 'hxKessel', ready: potReadyIdx >= 0 });
  }

  // ---------- Simulation ----------
  function simulate(now) {
    if (phase !== 'run') return;
    spawnItem(now);
    updateFlights(now);
    // Halbzeit: Werkzeuge rotieren
    if (!rotated && now - startAt > durationMs / 2) {
      rotated = true;
      assignTools(1);
      say('🔄 WERKZEUG-WECHSEL!', '#bf5af2', 2600, 44);
      setShake(8, 600);
      sendSetup('🔄 Neues Werkzeug!');
      order.forEach(sendInv);
      const kid = kesselId();
      if (kid !== undefined) ac.message(kid, { t: 'hxKessel', ready: potReadyIdx >= 0 });
    }
    if (now - startAt >= durationMs) {
      phase = 'end';
      const h = hostId();
      order.forEach(id => ac.message(id, { t: 'hxEnd', score, potions, host: id === h }));
    }
  }

  // ---------- Rendering ----------
  function drawKitchen(now) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#170b26'); g.addColorStop(0.7, '#241436'); g.addColorStop(1, '#120a1c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Regal mit Deko
    ctx.fillStyle = '#3a2450';
    ctx.fillRect(0, 96, W, 6);
    ctx.font = '22px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ['🕯️', '⚗️', '📜', '🕸️', '🔮', '🦇', '🧹', '🕯️'].forEach((e, i) => {
      ctx.globalAlpha = 0.85;
      ctx.fillText(e, W * (0.08 + i * 0.12), 96);
      ctx.globalAlpha = 1;
    });
    // Boden
    ctx.fillStyle = '#1b1028';
    ctx.fillRect(0, H - 90, W, 90);
  }

  function drawPot(now) {
    // Feuer unterm Kessel
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const fx = POT.x + (Math.random() - 0.5) * POT.r;
      drawGlow(fx, POT.y + 52, 10 + Math.random() * 8, Math.random() < 0.5 ? '#ff9f43' : '#ff5f2e', 0.5);
    }
    ctx.globalCompositeOperation = 'source-over';
    // Kessel
    ctx.fillStyle = '#14101c';
    ctx.strokeStyle = '#463a58'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(POT.x, POT.y, POT.r, POT.r * 0.68, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Sud
    const flash = sudFlash && now < sudFlash.until;
    const col = flash ? sudFlash.color : sudColor;
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(POT.x, POT.y - 22, POT.r * 0.66, col, 0.65);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.ellipse(POT.x, POT.y - 22, POT.r * 0.8, POT.r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // Blasen
    if (Math.random() < 0.4 && parts.length < 360) {
      parts.push({ x: POT.x + (Math.random() - 0.5) * POT.r * 1.3, y: POT.y - 22, vx: (Math.random() - 0.5) * 12, vy: -28 - Math.random() * 30, g: -14, color: col, size: 2 + Math.random() * 3, born: now, life: 900 });
    }
    if (potReadyIdx >= 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(125,255,177,' + (0.5 + Math.sin(now / 140) * 0.3) + ')';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(POT.x, POT.y, POT.r + 12, (POT.r + 12) * 0.68, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#7dffb1'; ctx.font = 'bold 17px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🌀 RÜHREN!', POT.x, POT.y + POT.r * 0.68 + 22);
    }
  }

  function drawRecipes(now) {
    recipes.forEach((r, ri) => {
      const x = ri === 0 ? 16 : W - 246, y = 110, w = 230, h = 34 + r.needs.length * 34;
      ctx.fillStyle = 'rgba(38,26,58,.92)';
      ctx.strokeStyle = potReadyIdx === ri ? '#7dffb1' : '#5a4478';
      ctx.lineWidth = potReadyIdx === ri ? 3 : 2;
      rr(ctx, x, y, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e8d5ff'; ctx.font = 'bold 15px system-ui,sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('📜 ' + r.name, x + 12, y + 18);
      r.needs.forEach((n, i) => {
        const yy = y + 46 + i * 34;
        ctx.font = '20px system-ui,sans-serif';
        ctx.globalAlpha = n.got ? 0.4 : 1;
        ctx.fillText(ICONS[n.type], x + 12, yy);
        ctx.font = '15px system-ui,sans-serif';
        ctx.fillStyle = '#bfa8dd';
        ctx.fillText(n.steps.map(s => TOOL_ICON[s]).join(' → ') + ' → 🍲', x + 44, yy);
        if (n.got) {
          ctx.fillStyle = '#7dffb1'; ctx.font = 'bold 18px system-ui,sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText('✓', x + w - 12, yy);
          ctx.textAlign = 'left';
        }
        ctx.fillStyle = '#e8d5ff';
        ctx.globalAlpha = 1;
      });
    });
  }

  function drawSlots(now) {
    order.forEach(id => {
      const s = slotPos(id), col = players[id] ? players[id].color : '#888';
      const isK = tools[id] === 'kessel';
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(s.x, s.y, 16, col, 0.4);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#241436';
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s.x, s.y, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = '20px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(TOOL_ICON[tools[id]], s.x, s.y + 1);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui,sans-serif';
      ctx.fillText(shortName(id), s.x, s.y - 34);
      // Inventar-Punkte
      if (!isK) {
        const n = itemsOf(id).length;
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i < n ? col : 'rgba(255,255,255,.18)';
          ctx.beginPath(); ctx.arc(s.x - 12 + i * 12, s.y + 32, 4, 0, Math.PI * 2); ctx.fill();
        }
      }
    });
  }

  function drawFlights(now) {
    flights.forEach(f => {
      const t = Math.min(1, (now - f.born) / f.dur);
      const x = f.x0 + (f.x1 - f.x0) * t;
      const y = f.y0 + (f.y1 - f.y0) * t - Math.sin(t * Math.PI) * 150;
      // Funkel-Trail
      if (parts.length < 370) {
        parts.push({ x, y, vx: (Math.random() - 0.5) * 26, vy: (Math.random() - 0.5) * 26, g: 60, color: ING_COLOR[f.it.type] || '#ffd60a', size: 2, born: now, life: 380 });
      }
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(x, y, 12, ING_COLOR[f.it.type] || '#ffd60a', 0.55);
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '26px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ICONS[f.it.type], x, y);
    });
  }

  function drawFx(now, dt) {
    ctx.globalCompositeOperation = 'lighter';
    parts = parts.filter(p => {
      const f = (now - p.born) / p.life;
      if (f >= 1) return false;
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      drawGlow(p.x, p.y, p.size * (1 - f) + 1, p.color, 1 - f);
      return true;
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHud(now) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 30px system-ui,sans-serif';
    ctx.fillText(score + 'P', W / 2, 26);
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = 'bold 14px system-ui,sans-serif';
    ctx.fillText('🍾 ' + potions, W / 2, 52);
    const left = Math.max(0, Math.ceil((startAt + durationMs - now) / 1000));
    ctx.textAlign = 'right'; ctx.fillStyle = left <= 30 ? '#ff9f43' : '#fff';
    ctx.font = 'bold 20px system-ui,sans-serif';
    ctx.fillText(Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'), W - 14, 24);
    if (announce && now < announce.until) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, (announce.until - now) / 400);
      ctx.font = 'bold ' + announce.size + 'px system-ui,sans-serif';
      ctx.fillStyle = announce.color;
      ctx.shadowColor = announce.color; ctx.shadowBlur = 16;
      ctx.fillText(announce.text, W / 2, 190);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (phase === 'end') {
      ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 52px system-ui,sans-serif';
      ctx.shadowColor = '#ffd60a'; ctx.shadowBlur = 22;
      ctx.fillText('🧪 Schichtende!', W / 2, H / 2 - 90);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 30px system-ui,sans-serif';
      ctx.fillText(score + ' Punkte · 🍾 ' + potions + ' Tränke', W / 2, H / 2 - 24);
      const grade = potions >= 8 ? '🏆 Meisterhexen!' : potions >= 5 ? '🌟 Solide Sudelei!' : potions >= 3 ? '🙂 Geht so — mehr werfen, weniger reden!' : '💀 Die Oberhexe ist NICHT zufrieden.';
      ctx.fillStyle = '#bfa8dd'; ctx.font = 'bold 22px system-ui,sans-serif';
      ctx.fillText(grade, W / 2, H / 2 + 26);
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '16px system-ui,sans-serif';
      ctx.fillText('⭐ Host kann am Handy eine neue Schicht starten', W / 2, H - 46);
    }
    ctx.textAlign = 'right'; ctx.font = '13px system-ui,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fillText('Host kann am Handy abbrechen ✕', W - 12, H - 8);
  }

  return {
    acceptsJoin: false,
    start(ids, cfg) {
      order = ids.slice().sort((a, b) => a - b);
      durationMs = ((cfg && cfg.dauer) || 4) * 60000;
      score = 0; potions = 0; phase = 'run'; rotated = false;
      items = {}; flights = []; parts = []; announce = null; nextUid = 1;
      sudColor = '#3fae62'; sudFlash = null; potReadyIdx = -1; lastSpawn = 0;
      assignTools(0);
      recipes = [newRecipe(), newRecipe()];
      startAt = performance.now();
      lastT = startAt;
      sendSetup('Schicht läuft — ran an den Kessel!');
      order.forEach(sendInv);
      sendScore(null);
      say('🧪 Die Schicht beginnt!', '#bf5af2', 2400, 42);
    },
    stop() { items = {}; flights = []; parts = []; },
    onDisconnect(id) {
      const wasKessel = tools[id] === 'kessel';
      order = order.filter(o => o !== id);
      Object.values(items).forEach(it => { if (it.owner === id) delete items[it.uid]; });
      if (order.length < 3) { endToLobby('Hexenschicht braucht mind. 3 Hexen.'); return; }
      assignTools(rotated ? 1 : 0);
      recipes = recipes.map(r => r.needs.every(n => n.steps.every(s => availTools.includes(s))) ? r : newRecipe());
      sendSetup(wasKessel ? '🍲 Der Kessel braucht dich!' : null);
      order.forEach(sendInv);
      checkPotReady();
    },
    onMessage(id, d) {
      if (!d) return;
      if (d.t === 'hxAgain' && id === hostId() && phase === 'end') {
        this.start(order, { dauer: durationMs / 60000 });
        return;
      }
      if (phase !== 'run') return;
      const now = performance.now();
      if (d.t === 'hxThrow') {
        const it = items[d.uid];
        if (it && it.owner === id && order.includes(d.to) && d.to !== id) startThrow(id, it, d.to);
      } else if (d.t === 'hxDone') {
        const it = items[d.uid];
        if (!it || it.owner !== id || tools[id] !== nextStep(it)) return;
        if (tools[id] === 'brennen' && +d.q > 95) {
          // verkohlt!
          delete items[it.uid];
          score = Math.max(0, score - 10);
          const s = slotPos(id);
          spark(s.x, s.y - 30, '#5a5a5a', 12, 140, 3, 600, -40);
          say('🔥 ' + nameOf(id) + ' verkohlt ' + ICONS[it.type] + '! (−10)', '#ff9f43', 1600, 26);
          sendScore(null);
          sendInv(id);
          return;
        }
        it.done++;
        const s = slotPos(id);
        spark(s.x, s.y - 30, ING_COLOR[it.type] || '#fff', 8, 110, 2.5, 400, -30);
        sendInv(id);
      } else if (d.t === 'hxStir') {
        stir(id, now);
      }
    },
    render() {
      const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      simulate(now);
      ctx.save();
      if (now < shake.until) {
        const m = shake.mag * (shake.until - now) / 600;
        ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      } else shake.mag = 0;
      drawKitchen(now);
      drawPot(now);
      drawRecipes(now);
      drawSlots(now);
      drawFlights(now);
      drawFx(now, dt);
      drawHud(now);
      ctx.restore();
    },
    _debug() { return { items, tools, recipes, flights, score, potions, potReadyIdx, phase, order }; }
  };
}});
