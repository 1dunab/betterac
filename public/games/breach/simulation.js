/* Rendering-independent authoritative simulation: collision, sight, bot navigation and round rules. */
(function (root) {
  'use strict';
  const W = typeof module !== 'undefined' && module.exports ? require('./world') : root.BreachWorld;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const finite = (v, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
  function blocked(x, z, radius = 0.35) {
    const b = W.bounds;
    return x < b.minX + radius || x > b.maxX - radius || z < b.minZ + radius || z > b.maxZ - radius ||
      W.boxes.some(o => Math.abs(x - o.x) < o.w / 2 + radius && Math.abs(z - o.z) < o.d / 2 + radius);
  }
  function rayBox(o, d, b, max = 120) {
    let near = 0, far = max;
    for (const k of ['x', 'y', 'z']) {
      if (Math.abs(d[k]) < 0.000001) { if (o[k] < b.min[k] || o[k] > b.max[k]) return Infinity; }
      else {
        const a = (b.min[k] - o[k]) / d[k], c = (b.max[k] - o[k]) / d[k];
        near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c));
        if (far < near) return Infinity;
      }
    }
    return near;
  }
  const cover = W.boxes.map(b => ({ min: { x: b.x - b.w / 2, y: 0, z: b.z - b.d / 2 }, max: { x: b.x + b.w / 2, y: b.h, z: b.z + b.d / 2 } }));
  function wallDistance(o, d, max = 120) { return Math.min(max, ...cover.map(b => rayBox(o, d, b, max))); }
  function direction(yaw, pitch) { return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) }; }
  function move(p, dx, dz) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
    for (let i = 0; i < n; i++) {
      if (!blocked(p.x + dx / n, p.z)) p.x += dx / n;
      if (!blocked(p.x, p.z + dz / n)) p.z += dz / n;
    }
  }
  // A small navigation grid is shared by all bots; no scene raycasts or network calls.
  const CELL = 1.5, COLS = 39, ROWS = 35;
  const pos = i => ({ x: -28.5 + (i % COLS) * CELL, z: -25.5 + Math.floor(i / COLS) * CELL });
  const open = Array.from({ length: COLS * ROWS }, (_, i) => !blocked(pos(i).x, pos(i).z, 0.5));
  function nearest(p) {
    let best = -1, dd = Infinity;
    for (let i = 0; i < open.length; i++) if (open[i]) { const d = dist(p, pos(i)); if (d < dd) { best = i; dd = d; } }
    return best;
  }
  function pathTo(a, b) {
    const start = nearest(a), goal = nearest(b);
    if (start < 0 || goal < 0) return [];
    const queue = [start], prev = new Int32Array(open.length).fill(-1); prev[start] = start;
    for (let q = 0; q < queue.length && prev[goal] < 0; q++) {
      const i = queue[q];
      for (const k of [i - COLS, i + COLS, i % COLS ? i - 1 : -1, i % COLS < COLS - 1 ? i + 1 : -1]) {
        if (k >= 0 && k < open.length && open[k] && prev[k] === -1) { prev[k] = i; queue.push(k); }
      }
    }
    if (prev[goal] < 0) return [];
    const out = [];
    for (let i = goal; i !== start; i = prev[i]) out.push(pos(i));
    out.push(pos(start)); return out.reverse();
  }
  class Match {
    constructor(ids, cfg = {}) {
      this.random = cfg.random || Math.random;
      const mode = typeof cfg.mode === 'string' && Object.prototype.hasOwnProperty.call(W.modes, cfg.mode) ? cfg.mode : 'tactical';
      this.cfg = { difficulty: ['normal', 'hard'].includes(cfg.difficulty) ? cfg.difficulty : 'easy', target: mode === 'survival' ? W.survivalWaves : clamp(Math.round(finite(cfg.target, 3)), 1, 5), mode, pvp: mode === 'ffa' || !!cfg.pvp && mode !== 'survival', teams: cfg.teams || {}, fillBots: cfg.fillBots !== false };
      this.time = 0; this.round = 0; this.score = [0, 0]; this.teamKills = [0, 0]; this.events = []; this.actors = [];
      this.arsenalProgress = [0, 0]; this.zoneScores = [0, 0]; this.zones = W.sites.map(s => ({ ...s, owner: null, capturing: null, progress: 0, contested: false }));
      this.ids = [...new Set(ids)]; this.stats = {}; this.ids.forEach(id => { this.stats[id] = { kills: 0, deaths: 0 }; });
      this.resetRound();
    }
    emit(type, data = {}) { this.events.push({ type, ...data }); }
    enemy(a, b) { return a.id !== b.id && (this.cfg.mode === 'ffa' || a.team !== b.team); }
    resetRound() {
      this.round++; this.phase = 'prep'; this.remaining = 5; this.bomb = null; this.smokes = []; this.result = null; this.actors = [];
      const teamIndex = [0, 0];
      this.ids.forEach((id, i) => {
        const team = this.cfg.pvp ? (this.cfg.teams[id] === 1 ? 1 : 0) : 0;
        const spawns = team ? W.guards : W.spawns;
        this.actors.push(this.actor(id, team, this.cfg.mode === 'ffa' ? W.ffaSpawns[i % W.ffaSpawns.length] : spawns[teamIndex[team]++ % spawns.length], false, i));
      });
      if (this.cfg.mode === 'ffa') {
        const count = this.cfg.fillBots ? Math.max(0, 6 - this.ids.length) : this.ids.length < 2 ? 1 : 0;
        for (let i = 0; i < count; i++) this.actors.push(this.actor('bot-ffa-' + i, 1, W.ffaSpawns[(this.ids.length + i) % W.ffaSpawns.length], true, this.ids.length + i));
      } else if (this.cfg.pvp) {
        if (this.cfg.fillBots) for (const team of [0, 1]) {
          const n = this.actors.filter(a => a.team === team).length;
          for (let i = n; i < 3; i++) this.actors.push(this.actor('bot' + team + '-' + i, team, (team ? W.guards : W.spawns)[i], true, i));
        }
      } else {
        const count = this.cfg.mode === 'survival' ? Math.min(8, this.ids.length + this.round + (this.cfg.difficulty === 'easy' ? 0 : this.cfg.difficulty === 'normal' ? 1 : 2)) : this.cfg.difficulty === 'easy' ? Math.min(4, this.ids.length + 1) : this.cfg.difficulty === 'normal' ? Math.min(6, this.ids.length + 2) : Math.min(8, this.ids.length + 4);
        for (let i = 0; i < count; i++) this.actors.push(this.actor('bot' + i, 1, W.guards[i % W.guards.length], true, i));
      }
      this.emit('round', { round: this.round });
    }
    actor(id, team, spawn, bot, index) {
      if (!this.stats[id]) this.stats[id] = { kills: 0, deaths: 0 };
      const weapon = this.cfg.mode === 'arsenal' ? W.arsenalOrder[Math.min(this.arsenalProgress[team], W.arsenalOrder.length - 1)] : !bot && this.loadouts && this.loadouts[id] || 'rifle', w = W.weapons[weapon];
      const inventory = {}; Object.entries(W.weapons).forEach(([key, item]) => { inventory[key] = { ammo: item.mag, reserve: item.reserve }; });
      return { id, team, bot, index, x: spawn.x, z: spawn.z, y: 0, vy: 0, yaw: team ? Math.PI : 0, pitch: 0,
        hp: (bot && !this.cfg.pvp && this.cfg.difficulty === 'easy' ? 80 : 100) + (bot && this.cfg.mode === 'survival' ? (this.round - 1) * 8 : 0), armor: bot ? 0 : !this.cfg.pvp && this.cfg.difficulty === 'easy' ? 65 : 40, alive: true, weapon, inventory, ammo: w.mag, reserve: w.reserve, reload: 0,
        cooldown: bot ? 0.8 : 0, recoil: 0, smoke: 1, input: {}, inputAt: this.time, plant: 0, hit: 0, hurt: 0,
        queuedShot: false, queueUntil: 0, burstLeft: 0, shotTimer: 0, spawnShield: 0, lastDamage: -10, quickQueued: false, quickAt: 0, aimStarted: -10, quickFlash: 0,
        route: [], navAt: 0, thinkAt: 0, target: null, patrol: index % W.patrols.length, respawn: 0, steps: 0 };
    }
    input(id, raw) {
      const p = this.actors.find(a => a.id === id && !a.bot);
      if (!p || !raw || typeof raw !== 'object') return;
      p.inputAt = this.time;
      const wasAiming = p.input.aim === true;
      p.input = { forward: clamp(finite(raw.forward), -1, 1), strafe: clamp(finite(raw.strafe), -1, 1),
        turn: clamp(finite(raw.turn), -1, 1), tilt: clamp(finite(raw.tilt), -1, 1),
        fire: raw.fire === true, aim: raw.aim === true, walk: raw.walk === true, use: raw.use === true, assist: raw.assist === true };
      if (raw.fireTap === true && this.phase === 'live' && p.alive) { p.queuedShot = true; p.queueUntil = this.time + 3.2; }
      if (raw.cancelFire === true) { p.queuedShot = false; p.burstLeft = 0; p.input.fire = false; }
      if (raw.quickscope === true && this.cfg.mode === 'ffa' && W.weapons[p.weapon].zoom && p.alive && this.phase === 'live' && !p.quickQueued) {
        p.quickQueued = true; p.quickAt = this.time + 0.1; p.queueUntil = this.time + 3.2;
      }
      if (raw.cancelQuickscope === true) p.quickQueued = false;
      p.input.aim = p.input.aim || p.quickQueued;
      if (p.input.aim && !wasAiming) p.aimStarted = this.time;
      if (raw.reset === true) { p.queuedShot = false; p.quickQueued = false; p.burstLeft = 0; p.input = {}; }
      if (p.alive && this.phase !== 'end' && this.phase !== 'roundOver') {
        if (typeof raw.yaw === 'number') p.yaw = angle(finite(raw.yaw, p.yaw));
        if (typeof raw.pitch === 'number') p.pitch = clamp(finite(raw.pitch, p.pitch), -1.35, 1.35);
        if (raw.reload === true) this.reload(p);
        if (raw.jump === true && p.y === 0) p.vy = 4.4;
        if (raw.smoke === true) this.throwSmoke(p);
      }
      if (this.cfg.mode !== 'arsenal' && p.alive && ['prep', 'live'].includes(this.phase) && typeof raw.weapon === 'string' && Object.prototype.hasOwnProperty.call(W.weapons, raw.weapon)) this.switchWeapon(p, raw.weapon);
    }
    switchWeapon(p, key) {
      if (key === p.weapon) return;
      p.inventory[p.weapon] = { ammo: p.ammo, reserve: p.reserve };
      p.weapon = key; p.ammo = p.inventory[key].ammo; p.reserve = p.inventory[key].reserve; p.reload = 0;
      p.burstLeft = 0; p.queuedShot = false; p.quickQueued = false; p.aimStarted = -10; p.cooldown = Math.max(p.cooldown, 0.28); p.recoil = 0;
      (this.loadouts || (this.loadouts = {}))[p.id] = key; this.emit('weapon', { id: p.id, weapon: key });
    }
    reload(p) {
      const w = W.weapons[p.weapon];
      if (this.cfg.mode === 'arsenal' && p.reserve === 0) p.reserve = w.reserve;
      if (p.reload <= 0 && p.ammo < w.mag && p.reserve > 0) { p.reload = w.reload; this.emit('reload', { id: p.id }); }
    }
    throwSmoke(p) {
      if (!p.smoke || this.phase !== 'live') return;
      p.smoke--;
      const d = direction(p.yaw, 0), reach = Math.max(0.5, wallDistance({ x: p.x, y: 1.4, z: p.z }, d, 10) - 0.7);
      this.smokes.push({ x: p.x + d.x * reach, z: p.z + d.z * reach, life: 10, r: 3.4 });
      this.emit('smoke', { id: p.id });
    }
    visible(a, b) {
      const origin = { x: a.x, y: a.y + 1.5, z: a.z }, target = { x: b.x, y: b.y + 1.3, z: b.z };
      const dx = target.x - origin.x, dy = target.y - origin.y, dz = target.z - origin.z, len = Math.hypot(dx, dy, dz);
      if (wallDistance(origin, { x: dx / len, y: dy / len, z: dz / len }, len) < len - 0.1) return false;
      return !this.smokes.some(s => {
        const t = clamp(((s.x - a.x) * dx + (s.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        return Math.hypot(a.x + dx * t - s.x, a.z + dz * t - s.z) < s.r;
      });
    }
    shoot(p) {
      if (this.phase !== 'live' || !p.alive || p.cooldown > 0 || p.reload > 0) return false;
      if (p.quickQueued && this.time < p.quickAt) return false;
      if (!p.ammo) { this.reload(p); return false; }
      const w = W.weapons[p.weapon], difficulty = W.difficulties[this.cfg.difficulty];
      const quickscope = !!w.zoom && p.input.aim === true && this.time - p.aimStarted <= W.quickscopeWindow;
      if (quickscope) p.quickFlash = 0.6;
      if (w.burst && !p.bot && p.burstLeft <= 0) p.burstLeft = Math.min(w.burst, p.ammo);
      p.ammo--; p.shotTimer = 0.075; p.queuedShot = false; p.quickQueued = false; p.spawnShield = 0;
      if (p.burstLeft > 0) p.burstLeft--;
      p.cooldown = p.bot ? difficulty.delay : w.burst && p.burstLeft === 0 ? w.burstDelay : w.delay;
      const moving = Math.hypot(p.input.forward || 0, p.input.strafe || 0) > 0.2;
      const spread = p.bot ? difficulty.spread : w.spread * (p.input.aim ? (w.pellets ? 0.8 : 0.3) : 1) * (moving && !p.input.walk ? 1.6 : 1) + p.recoil * 0.006;
      const o = { x: p.x, y: p.y + 1.62, z: p.z };
      let yaw = p.yaw, pitch = p.pitch;
      // Gentle bullet assistance is limited to cooperative play against visible bots.
      if (!p.bot && !this.cfg.pvp && p.input.assist) {
        const candidates = this.actors.filter(a => a.alive && a.bot && a.team !== p.team && this.visible(p, a)).map(a => ({ a,
          yaw: Math.atan2(-(a.x - p.x), -(a.z - p.z)), pitch: Math.atan2(a.y + 1.2 - o.y, dist(p, a)) }));
        candidates.sort((a, b) => Math.abs(angle(a.yaw - yaw)) - Math.abs(angle(b.yaw - yaw)));
        const target = candidates[0];
        if (target && Math.abs(angle(target.yaw - yaw)) < 0.065 && Math.abs(target.pitch - pitch) < 0.08) { yaw = target.yaw; pitch = target.pitch; }
      }
      const killsBefore = this.teamKills[p.team];
      const pellets = p.bot ? 1 : w.pellets || 1;
      for (let i = 0; i < pellets && this.phase === 'live'; i++) this.fireRay(p, o, direction(yaw + (this.random() - 0.5) * spread, pitch + (this.random() - 0.5) * spread), w, i === 0, quickscope);
      p.recoil = Math.min(1.5, p.recoil + (w.recoil || 0.18));
      if (!p.ammo) { p.burstLeft = 0; this.reload(p); }
      // A multi-pellet kill still advances only one stage: every weapon must be used.
      if (this.cfg.mode === 'arsenal' && this.teamKills[p.team] > killsBefore) this.advanceArsenal(p.team);
      return true;
    }
    advanceArsenal(team) {
      const stage = ++this.arsenalProgress[team];
      if (stage >= W.arsenalOrder.length) { this.finish(team, 'Alle 10 Waffen gemeistert'); return; }
      const key = W.arsenalOrder[stage], w = W.weapons[key];
      for (const actor of this.actors.filter(a => a.team === team)) {
        this.switchWeapon(actor, key); actor.ammo = w.mag; actor.reserve = w.reserve;
      }
      this.emit('advance', { team, stage, weapon: key });
    }
    captureZones(dt) {
      for (const zone of this.zones) {
        const present = [0, 1].map(team => this.actors.some(p => p.alive && p.team === team && p.y < 0.4 && dist(p, zone) < zone.r));
        zone.contested = present[0] && present[1];
        const team = present[0] ? 0 : present[1] ? 1 : null;
        if (zone.contested) { /* Occupants must clear the enemy before capturing or scoring. */ }
        else if (team === null || team === zone.owner) { zone.progress = 0; zone.capturing = null; }
        else {
          if (zone.capturing !== team) { zone.capturing = team; zone.progress = 0; }
          zone.progress = Math.min(1, zone.progress + dt / 3);
          if (zone.progress >= 1 - 1e-9) { zone.owner = team; zone.progress = 0; zone.capturing = null; this.emit('capture', { team, zone: zone.key }); }
        }
        if (zone.owner !== null && !zone.contested && zone.capturing === null) this.zoneScores[zone.owner] += dt;
      }
      this.zoneScores = this.zoneScores.map(n => n >= W.controlTarget - 1e-9 ? W.controlTarget : n);
      if (this.zoneScores.some(n => n >= W.controlTarget - 1e-9) || this.remaining <= 0) {
        const [a, b] = this.zoneScores, equal = Math.abs(a - b) < 1e-6;
        this.finish(equal ? null : a > b ? 0 : 1, Math.floor(a + 1e-6) + ' : ' + Math.floor(b + 1e-6) + ' Zonenpunkte');
      }
    }
    fireRay(p, o, d, w, audible, quickscope = false) {
      let nearestHit = wallDistance(o, d), victim = null, headshot = false;
      for (const a of this.actors) if (a.alive && this.enemy(p, a)) {
        const body = rayBox(o, d, { min: { x: a.x - 0.32, y: a.y + 0.15, z: a.z - 0.32 }, max: { x: a.x + 0.32, y: a.y + 1.35, z: a.z + 0.32 } });
        const head = rayBox(o, d, { min: { x: a.x - 0.24, y: a.y + 1.35, z: a.z - 0.24 }, max: { x: a.x + 0.24, y: a.y + 1.85, z: a.z + 0.24 } });
        const hit = Math.min(body, head);
        if (hit < nearestHit) { nearestHit = hit; victim = a; headshot = head < body; }
      }
      const protectedSpawn = victim && victim.spawnShield > 0;
      this.emit('shot', { id: p.id, weapon: p.weapon, audible, from: o, to: { x: o.x + d.x * nearestHit, y: o.y + d.y * nearestHit, z: o.z + d.z * nearestHit }, hit: !!victim && !protectedSpawn });
      if (victim && !protectedSpawn) {
        const falloff = clamp((w.range || 50) / Math.max(nearestHit, 1), w.pellets ? 0.15 : 0.5, 1);
        let damage = p.bot ? W.difficulties[this.cfg.difficulty].damage : (p.input.aim && w.scopedDamage || w.damage) * falloff * (headshot ? w.pellets ? 1.5 : 2.8 : 1);
        const absorb = Math.min(victim.armor, damage * 0.45); victim.armor -= absorb; damage -= absorb;
        victim.hp = Math.max(0, victim.hp - damage); victim.hurt = 0.35; victim.lastDamage = this.time; p.hit = 0.15;
        this.emit('hit', { id: p.id, target: victim.id, headshot });
        if (victim.hp <= 0) {
          victim.alive = false; victim.respawn = 3; victim.plant = 0;
          if (this.cfg.mode !== 'ffa') this.teamKills[p.team]++;
          if (this.stats[p.id]) this.stats[p.id].kills++;
          if (this.stats[victim.id]) this.stats[victim.id].deaths++;
          if (quickscope) this.stats[p.id].quickscopes = (this.stats[p.id].quickscopes || 0) + 1;
          this.emit('kill', { id: p.id, target: victim.id, headshot, quickscope });
          if (this.cfg.mode === 'ffa' && this.stats[p.id].kills >= W.ffaTarget) this.finishIndividual(p.id, W.ffaTarget + ' Abschüsse erreicht');
        }
      }
    }
    bot(p, dt) {
      const difficulty = W.difficulties[this.cfg.difficulty];
      const humans = this.actors.filter(a => this.enemy(p, a) && a.alive);
      const seen = humans.filter(a => dist(p, a) < difficulty.sight && this.visible(p, a)).sort((a, b) => dist(p, a) - dist(p, b));
      const target = seen[0];
      if (target) {
        p.plant = 0;
        if (p.target !== target.id) { p.target = target.id; p.cooldown = Math.max(p.cooldown, difficulty.reaction); }
        const aim = Math.atan2(-(target.x - p.x), -(target.z - p.z));
        p.yaw += clamp(angle(aim - p.yaw), -dt * difficulty.turn, dt * difficulty.turn);
        p.pitch = Math.atan2(target.y + 1.15 - (p.y + 1.62), dist(p, target));
        if (Math.abs(angle(aim - p.yaw)) < 0.12) this.shoot(p);
        if (dist(p, target) > 10) move(p, -Math.sin(p.yaw) * dt * 1.2, -Math.cos(p.yaw) * dt * 1.2);
        p.route = []; return;
      }
      p.target = null; p.pitch = 0;
      let goal;
      if (this.bomb) goal = this.bomb;
      else if (this.cfg.mode === 'control') {
        const choices = this.zones.filter(z => z.owner !== p.team || z.contested || z.capturing !== null);
        goal = (choices.length ? choices : this.zones)[p.index % (choices.length || this.zones.length)];
      }
      else if (this.cfg.mode === 'survival' && humans.length) goal = humans.slice().sort((a, b) => dist(p, a) - dist(p, b))[0];
      else if (p.team === 0 && this.cfg.mode === 'tactical') goal = W.sites[p.index % 2];
      else { const patrol = W.patrols[p.patrol]; goal = { x: patrol[0], z: patrol[1] }; if (dist(p, goal) < 1.5) p.patrol = (p.patrol + 3) % W.patrols.length; }
      if (this.bomb && dist(p, goal) < 1.9) {
        if (p.team === 1 && !this.bomb.defuser) { this.bomb.defuser = p.id; this.bomb.defuse += dt; }
        return;
      }
      if (!this.bomb && p.team === 0 && dist(p, goal) < 2 && this.cfg.mode === 'tactical') {
        p.plant += dt;
        if (p.plant >= 2.5) { this.bomb = { x: goal.x, z: goal.z, site: goal.key, left: 25, defuse: 0, defuser: null }; this.emit('plant', { site: goal.key }); p.plant = 0; }
        return;
      }
      p.plant = 0;
      if (this.time >= p.navAt || !p.route.length) { p.route = pathTo(p, goal); p.navAt = this.time + 1.2 + p.index * 0.08; }
      while (p.route.length && dist(p, p.route[0]) < 0.45) p.route.shift();
      if (p.route.length) {
        const next = p.route[0], len = dist(p, next), speed = this.bomb ? 3.2 : 2.2;
        p.yaw = Math.atan2(-(next.x - p.x), -(next.z - p.z));
        move(p, (next.x - p.x) / len * dt * speed, (next.z - p.z) / len * dt * speed);
      }
    }
    finish(team, reason) {
      if (this.phase !== 'live') return;
      if (team !== null) this.score[team]++; this.result = { team, reason };
      this.phase = this.cfg.mode === 'survival' ? (team === 1 || this.round >= W.survivalWaves ? 'end' : 'roundOver') : this.score[team] >= this.cfg.target || this.cfg.mode !== 'tactical' ? 'end' : 'roundOver';
      this.remaining = 4.5; this.emit('result', { team, reason, final: this.phase === 'end' });
    }
    finishIndividual(winnerId, reason) {
      if (this.phase !== 'live') return;
      this.result = { team: null, winnerId, reason }; this.phase = 'end'; this.remaining = 0;
      this.emit('result', { winnerId, reason, final: true });
    }
    step(seconds) {
      const dt = clamp(finite(seconds), 0, 0.05); this.time += dt;
      if (this.phase === 'end') return;
      this.remaining -= dt;
      this.smokes.forEach(s => s.life -= dt); this.smokes = this.smokes.filter(s => s.life > 0);
      if (this.phase === 'roundOver') { if (this.remaining <= 0) this.resetRound(); return; }
      if (this.phase === 'prep' && this.remaining <= 0) { this.phase = 'live'; this.remaining = W.modes[this.cfg.mode].duration; this.emit('live'); }
      const oldDefuser = this.bomb && this.bomb.defuser;
      if (this.bomb) this.bomb.defuser = null;
      for (let index = 0; index < this.actors.length; index++) {
        const p = this.actors[index];
        if (!p.alive) {
          if (this.phase === 'live' && W.modes[this.cfg.mode].respawn && (p.respawn -= dt) <= 0) {
            const options = this.cfg.mode === 'ffa' ? W.ffaSpawns : p.team === 1 ? W.guards : W.spawns;
            const enemies = this.actors.filter(a => a.alive && this.enemy(p, a));
            const living = this.actors.filter(a => a.alive);
            const score = point => Math.min(...enemies.map(e => dist(point, e)), 100) - (living.some(a => dist(point, a) < 1.2) ? 1000 : 0);
            const spawn = options.slice().sort((a, b) => score(b) - score(a))[0];
            this.actors[index] = this.actor(p.id, p.team, spawn, p.bot, p.index);
            this.actors[index].spawnShield = 2;
            this.emit('respawn', { id: p.id });
          }
          continue;
        }
        p.cooldown = Math.max(0, p.cooldown - dt); p.recoil = Math.max(0, p.recoil - dt * 1.7); p.hit = Math.max(0, p.hit - dt); p.hurt = Math.max(0, p.hurt - dt); p.shotTimer = Math.max(0, p.shotTimer - dt);
        p.spawnShield = Math.max(0, p.spawnShield - dt);
        p.quickFlash = Math.max(0, p.quickFlash - dt);
        if (p.reload > 0) {
          p.reload -= dt;
          if (p.reload <= 0) { const n = Math.min(W.weapons[p.weapon].mag - p.ammo, p.reserve); p.ammo += n; p.reserve -= n; p.reload = 0; this.emit('loaded', { id: p.id }); }
        }
        if (p.bot) { if (this.phase === 'live') this.bot(p, dt); continue; }
        if (this.time - p.inputAt > 0.7) { p.input = {}; p.queuedShot = false; p.quickQueued = false; p.burstLeft = 0; }
        if (this.time > p.queueUntil) { p.queuedShot = false; p.quickQueued = false; }
        const i = p.input;
        p.yaw = angle(p.yaw + (i.turn || 0) * dt * 2.4); p.pitch = clamp(p.pitch - (i.tilt || 0) * dt * 1.8, -1.35, 1.35);
        p.vy -= dt * 13; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0) p.vy = 0;
        if (this.phase !== 'live') continue;
        const f = i.forward || 0, s = i.strafe || 0, len = Math.max(1, Math.hypot(f, s)), speed = (i.walk || i.aim ? 2.6 : 4.8) * (W.weapons[p.weapon].speed || 1);
        move(p, (-Math.sin(p.yaw) * f + Math.cos(p.yaw) * s) / len * speed * dt, (-Math.cos(p.yaw) * f - Math.sin(p.yaw) * s) / len * speed * dt);
        p.steps += Math.hypot(f, s) * dt * speed;
        if (!p.ammo && p.reserve > 0) this.reload(p);
        if (i.fire || p.queuedShot || p.quickQueued || p.burstLeft > 0) this.shoot(p);
        if (!this.cfg.pvp && this.cfg.difficulty === 'easy' && this.time - p.lastDamage > 6) p.hp = Math.min(100, p.hp + dt * 7);
        const site = W.sites.find(a => dist(p, a) < a.r);
        if (i.use && p.team === 0 && site && !this.bomb && this.cfg.mode === 'tactical' && p.y === 0 && Math.hypot(f, s) < 0.1) {
          p.plant += dt;
          if (p.plant >= 2.5) { this.bomb = { x: site.x, z: site.z, site: site.key, left: 25, defuse: 0, defuser: null }; this.emit('plant', { site: site.key }); p.plant = 0; }
        } else p.plant = 0;
        if (i.use && p.team === 1 && this.bomb && dist(p, this.bomb) < 2.8 && !this.bomb.defuser && Math.hypot(f, s) < 0.1 && p.y === 0) {
          this.bomb.defuser = p.id; this.bomb.defuse += dt;
        }
      }
      if (this.phase !== 'live') return;
      if (this.cfg.mode === 'ffa') {
        if (this.actors.length === 1) this.finishIndividual(this.actors[0].id, 'Letzter Operator im Einsatz');
        else if (this.remaining <= 0) {
          const ranked = this.actors.slice().sort((a, b) => this.stats[b.id].kills - this.stats[a.id].kills);
          const best = ranked[0], tie = !best || ranked[1] && this.stats[ranked[1].id].kills === this.stats[best.id].kills;
          this.finishIndividual(tie ? null : best.id, tie ? 'Gleich viele Abschüsse' : this.stats[best.id].kills + ' Abschüsse · Zeit abgelaufen');
        }
        return;
      }
      if (this.cfg.mode === 'control') { this.captureZones(dt); return; }
      if (this.cfg.mode === 'arsenal') {
        if (this.remaining <= 0) { const [a, b] = this.arsenalProgress; this.finish(a === b ? null : a > b ? 0 : 1, a + ' : ' + b + ' Waffenstufen'); }
        return;
      }
      if (this.cfg.mode === 'survival') {
        if (!this.actors.some(a => a.alive && a.team === 0)) this.finish(1, 'Team in Welle ' + this.round + ' ausgeschaltet');
        else if (!this.actors.some(a => a.alive && a.team === 1)) this.finish(0, this.round === W.survivalWaves ? 'Alle 5 Wellen überlebt' : 'Welle ' + this.round + ' geschafft');
        else if (this.remaining <= 0) this.finish(1, 'Welle ' + this.round + ': Zeit abgelaufen');
        return;
      }
      if (this.cfg.mode === 'deathmatch') {
        if (this.remaining <= 0) {
          const [attack, defence] = this.teamKills;
          this.finish(attack === defence ? null : attack > defence ? 0 : 1, attack + ' : ' + defence + ' Abschüsse');
        }
        return;
      }
      const alive = this.actors.filter(a => a.alive);
      if (!alive.some(a => a.team === 1)) { this.finish(0, 'Sektor gesichert'); return; }
      if (!alive.some(a => a.team === 0) && !this.bomb) { this.finish(1, 'Team ausgeschaltet'); return; }
      if (this.bomb) {
        this.bomb.left -= dt;
        // Only one defender can defuse, and any interruption resets progress.
        if (!this.bomb.defuser || (oldDefuser && oldDefuser !== this.bomb.defuser)) this.bomb.defuse = 0;
        if (this.bomb.defuse >= 5) this.finish(1, 'Bombe entschärft');
        else if (this.bomb.left <= 0) { this.emit('detonate'); this.finish(0, 'Ziel zerstört'); }
      } else if (this.remaining <= 0) this.finish(1, 'Zeit abgelaufen');
    }
    disconnect(id) { this.ids = this.ids.filter(p => p !== id); this.actors = this.actors.filter(p => p.id !== id); }
  }
  const api = { Match, blocked, wallDistance, rayBox, move, pathTo, direction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BreachGame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
