/* Isolated room-based, authoritative multiplayer for BREACH. No Party Hub screen required. */
'use strict';
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');
const { Match } = require('./public/games/breach/simulation');
const W = require('./public/games/breach/world');

module.exports = function createBreachServer() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const rooms = new Map();
  const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 128000) ws.send(JSON.stringify(data)); };
  const broadcast = (r, data) => r.clients.forEach(c => send(c.ws, data));
  const roomInfo = r => ({ t: 'room', code: r.code, host: r.host, phase: r.match ? r.match.phase : 'lobby', cfg: r.cfg,
    result: r.match ? r.match.result : null, score: r.match ? r.match.score : [0, 0],
    players: [...r.clients.values()].map(c => ({ id: c.id, name: c.name, team: r.cfg.mode === 'ffa' ? null : r.cfg.mode === 'survival' ? 0 : c.team, ready: !!r.match && r.match.ids.includes(c.id) })) });
  function notify(r) { broadcast(r, roomInfo(r)); }
  function snapshot(m) {
    return { phase: m.phase, remaining: m.remaining, round: m.round, score: m.score, teamKills: m.teamKills, arsenalProgress: m.arsenalProgress, zoneScores: m.zoneScores, zones: m.zones, result: m.result, cfg: { mode: m.cfg.mode, target: m.cfg.target, difficulty: m.cfg.difficulty }, stats: m.stats, bomb: m.bomb, smokes: m.smokes, time: m.time,
      actors: m.actors.map(p => ({ id: p.id, index: p.index, team: p.team, bot: p.bot, x: p.x, z: p.z, y: p.y, yaw: p.yaw, pitch: p.pitch, hp: p.hp, armor: p.armor, alive: p.alive, weapon: p.weapon, ammo: p.ammo, reserve: p.reserve, reload: p.reload, recoil: p.recoil, cooldown: p.cooldown, shotTimer: p.shotTimer, quickFlash: p.quickFlash, spawnShield: p.spawnShield, smoke: p.smoke, plant: p.plant, hurt: p.hurt, hit: p.hit, respawn: p.respawn, steps: p.steps, input: { fire: p.input.fire, aim: p.input.aim } })) };
  }
  function start(r) {
    const teams = {}; r.clients.forEach(c => { teams[c.id] = c.team; });
    if (r.cfg.mode === 'ffa' && !r.cfg.fillBots && r.clients.size < 2) {
      send(r.clients.get(r.host).ws, { t: 'error', message: 'Free for All ohne Bots braucht mindestens zwei Spieler.' }); return;
    }
    if (!['survival', 'ffa'].includes(r.cfg.mode) && !r.cfg.fillBots && ![0, 1].every(t => [...r.clients.values()].some(c => c.team === t))) {
      send(r.clients.get(r.host).ws, { t: 'error', message: 'Ohne Bots muss mindestens ein Spieler in jedem Team sein.' }); return;
    }
    r.match = new Match([...r.clients.keys()], { ...r.cfg, pvp: true, teams }); r.version++; notify(r);
  }
  wss.on('connection', ws => {
    ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
    let client = null, room = null, packets = 0, windowAt = Date.now();
    const joinTimer = setTimeout(() => { if (!client) ws.close(1008, 'Join required'); }, 10000); joinTimer.unref();
    ws.on('error', () => {});
    ws.on('message', raw => {
      if (Date.now() - windowAt > 1000) { packets = 0; windowAt = Date.now(); }
      if (++packets > 100) { ws.close(1008, 'Rate limit'); return; }
      let d; try { d = JSON.parse(raw); } catch { return; }
      if (!d || typeof d !== 'object') return;
      if (d.t === 'join' && !client) {
        const name = typeof d.name === 'string' ? d.name.trim().replace(/[\x00-\x1f]/g, '').slice(0, 18) : '';
        if (!name) { send(ws, { t: 'error', message: 'Bitte gib einen Namen ein.' }); return; }
        const code = typeof d.code === 'string' ? d.code.trim().toUpperCase() : '';
        if (code) {
          if (!/^[A-Z0-9]{5}$/.test(code) || !rooms.has(code)) { send(ws, { t: 'error', message: 'Raum nicht gefunden. Prüfe den Einladungscode.' }); return; }
          room = rooms.get(code);
          if (room.clients.size >= 8) { send(ws, { t: 'error', message: 'Dieser Raum ist voll (maximal 8 Spieler).' }); room = null; return; }
        } else {
          if (rooms.size >= 100) { send(ws, { t: 'error', message: 'Alle Räume sind belegt. Bitte später erneut versuchen.' }); return; }
          let code; do { code = crypto.randomBytes(4).toString('hex').slice(0, 5).toUpperCase(); } while (rooms.has(code));
          room = { code, clients: new Map(), host: null, match: null, version: 0, cfg: { mode: 'tactical', difficulty: 'easy', target: 3, fillBots: true } }; rooms.set(code, room);
        }
        const counts = [0, 0]; room.clients.forEach(c => counts[c.team]++);
        client = { id: crypto.randomBytes(6).toString('hex'), name, ws, team: counts[0] <= counts[1] ? 0 : 1 };
        room.clients.set(client.id, client); if (!room.host) room.host = client.id;
        clearTimeout(joinTimer); send(ws, { t: 'welcome', id: client.id, code: room.code }); notify(room);
      } else if (client && room) {
        if (d.t === 'ping') { send(ws, { t: 'pong', at: d.at }); return; }
        if (d.t === 'input' && room.match) room.match.input(client.id, d.input);
        if (d.t === 'team' && (!room.match || room.match.phase === 'end') && (d.team === 0 || d.team === 1)) { client.team = d.team; notify(room); }
        if (client.id === room.host) {
          if (d.t === 'config' && (!room.match || room.match.phase === 'end')) {
            room.cfg = { mode: typeof d.mode === 'string' && Object.prototype.hasOwnProperty.call(W.modes, d.mode) ? d.mode : 'tactical', difficulty: ['normal', 'hard'].includes(d.difficulty) ? d.difficulty : 'easy', target: [1, 3, 5].includes(d.target) ? d.target : 3, fillBots: d.fillBots !== false }; notify(room);
          }
          if (d.t === 'start' && (!room.match || room.match.phase === 'end')) start(room);
          if (d.t === 'lobby') { room.match = null; notify(room); }
        }
      }
    });
    ws.on('close', () => {
      clearTimeout(joinTimer);
      if (!room || !client) return;
      room.clients.delete(client.id);
      if (!room.clients.size) { rooms.delete(room.code); return; }
      if (room.host === client.id) room.host = room.clients.keys().next().value;
      if (room.match) {
        const p = room.match.actors.find(a => a.id === client.id);
        // A departed human becomes a bot for the current match, preserving team balance.
        if (room.match.cfg.mode === 'ffa') room.match.disconnect(client.id);
        else if (p) { p.bot = true; p.input = {}; p.id = 'bot-departed-' + client.id; room.match.stats[p.id] = room.match.stats[client.id] || { kills: 0, deaths: 0 }; }
        room.match.ids = room.match.ids.filter(id => id !== client.id);
      }
      notify(room);
    });
  });
  let tick = 0, last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now; tick++;
    for (const r of rooms.values()) if (r.match) {
      const oldPhase = r.match.phase; r.match.step(dt);
      if (oldPhase !== r.match.phase) notify(r);
      if (tick % 2 === 0) { const events = r.match.events.splice(0); broadcast(r, { t: 'state', version: r.version, state: snapshot(r.match), events }); }
    }
  }, 1000 / 60); timer.unref();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  }, 10000); heartbeat.unref();
  return {
    upgrade(req, socket, head) { wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req)); },
    close() { clearInterval(timer); clearInterval(heartbeat); wss.clients.forEach(ws => ws.terminate()); wss.close(); }, rooms
  };
};
