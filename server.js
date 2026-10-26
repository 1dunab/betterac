// AirConsole-Local: lokaler Signaling- + Relay-Server.
// Ersetzt die AirConsole-Server: weist Geraete-IDs zu und routet Nachrichten im LAN.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const os = require('os');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

// --- Statischer Datei-Server fuer screen.html / controller.html / shim ---
const server = http.createServer((req, res) => {
  // Phones must never combine an old controller script with a new touch layout.
  // This LAN app serves editable files directly, without a fingerprinted build.
  res.setHeader('Cache-Control', 'no-store');
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/info') {
    // Für den Lobby-QR-Code: unter welcher LAN-Adresse sind wir erreichbar?
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // screen: a second screen.html asks "mitschauen oder übernehmen?" instead of kicking
    res.end(JSON.stringify({ port: PORT, ips: lanIPs(), screen: clients.has(0) }));
    return;
  }
  // Landing page instead of the screen: online, a stray click on the bare URL
  // would otherwise take over the one screen slot.
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// --- WebSocket: Verbindung & Nachrichten-Routing ---
const wss = new WebSocketServer({ noServer: true });
const breach = require('./breach-server')();
server.on('upgrade', (req, socket, head) => {
  if (req.url.split('?')[0] === '/breach-ws') breach.upgrade(req, socket, head);
  else wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
server.on('close', () => breach.close());
const clients = new Map();   // device_id -> ws
const secrets = new Map();   // device_id -> Resume-Secret (nur dieser Server-Lauf)
const pendingDisconnects = new Map();
// Mitschauen: viewers get the screen's picture as JPEG frames. They are no
// players — no device id, no connect/disconnect events, nothing they send counts.
const viewers = new Set();
const MAX_VIEWER_BUFFER = 2e6;   // bytes queued per viewer before frames are dropped
const sendViewerCount = () => send(clients.get(0), { type: 'viewers', n: viewers.size });
let nextControllerId = 1;    // Screen ist immer 0, Controller ab 1
const newSecret = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

const send = (ws, obj) => { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
function broadcast(obj, exceptId) {
  for (const [id, ws] of clients) if (id !== exceptId) send(ws, obj);
}

wss.on('connection', (ws) => {
  ws.deviceId = undefined;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (ws.viewer) return;
    if (msg.type === 'register' && msg.role === 'viewer') {
      ws.viewer = true;
      viewers.add(ws);
      send(ws, { type: 'welcome', device_id: -1, code: 'LOCAL', devices: [] });
      sendViewerCount();
      return;
    }

    if (msg.type === 'frame' && ws.deviceId === 0) {
      const out = JSON.stringify({ type: 'frame', data: String(msg.data || '') });
      for (const v of viewers) if (v.readyState === v.OPEN && v.bufferedAmount < MAX_VIEWER_BUFFER) v.send(out);
      return;
    }

    if (msg.type === 'register') {
      let id, silent = false;
      if (msg.role === 'screen') {
        // Es gibt nur einen Screen: ein neuer kickt den alten (z.B. TV-Reload).
        id = 0;
        const old = clients.get(0);
        if (old && old !== ws) { send(old, { type: 'kicked' }); old.deviceId = undefined; old.terminate(); }
      } else if (Number.isInteger(msg.resume) && msg.resume > 0
                 && typeof msg.secret === 'string' && msg.secret.length
                 && secrets.get(msg.resume) === msg.secret) {
        // Reconnect: alte ID nur mit passendem Secret wiederverwenden — sonst koennte
        // ein Geraet mit gespeicherter ID aus einem alten Server-Lauf fremde IDs kapern.
        // Haengt der alte Socket noch in der Map, uebernimmt der neue still.
        id = msg.resume;
        const old = clients.get(id);
        if (old && old !== ws) { old.deviceId = undefined; old.terminate(); silent = true; }
      } else {
        id = nextControllerId++;
      }
      ws.deviceId = id;
      clearTimeout(pendingDisconnects.get(id)); pendingDisconnects.delete(id);
      clients.set(id, ws);
      if (id > 0 && !secrets.has(id)) secrets.set(id, newSecret());
      send(ws, { type: 'welcome', device_id: id, code: 'LOCAL', devices: [...clients.keys()], secret: secrets.get(id) });
      if (!silent) broadcast({ type: 'connect', device_id: id }, id); // andere informieren
      if (id === 0) sendViewerCount();
      return;
    }

    if (msg.type === 'kick' && ws.deviceId === 0) {
      // Host-Tool: Screen wirft einen Controller raus. Socket schliessen und
      // Resume-Secret verwerfen — sonst kaeme das Geraet still wieder zurueck.
      const id = msg.id | 0;
      const target = clients.get(id);
      if (id > 0 && target) {
        clearTimeout(pendingDisconnects.get(id)); pendingDisconnects.delete(id);
        send(target, { type: 'kicked' });
        secrets.delete(id);
        target.deviceId = undefined;
        clients.delete(id);
        target.terminate();
        broadcast({ type: 'disconnect', device_id: id });
      }
      return;
    }

    if (msg.type === 'message') {
      const from = ws.deviceId;
      if (msg.to === undefined || msg.to === null) {
        broadcast({ type: 'message', from, data: msg.data }, from); // broadcast()
      } else {
        send(clients.get(msg.to), { type: 'message', from, data: msg.data }); // message(to,...)
      }
    }
  });

  ws.on('close', () => {
    if (ws.viewer) { viewers.delete(ws); sendViewerCount(); return; }
    // Nur aufraeumen, wenn die ID noch zu diesem Socket gehoert — der verspaetete
    // close eines uebernommenen Sockets darf den Nachfolger nicht loeschen.
    if (ws.deviceId !== undefined && clients.get(ws.deviceId) === ws) {
      const id = ws.deviceId;
      const disconnect = () => {
        pendingDisconnects.delete(id);
        if (clients.get(id) !== ws) return;
        clients.delete(id);
        broadcast({ type: 'disconnect', device_id: id });
      };
      // A page reload closes its socket before the replacement can resume it.
      // Keep that authenticated seat briefly, instead of removing its live actor.
      if (id > 0) pendingDisconnects.set(id, setTimeout(disconnect, 8000));
      else disconnect();
    }
  });
});

// Heartbeat: tote Verbindungen (Handy-Sperre, WLAN weg) fliegen aus der Map,
// damit der Screen den Disconnect mitbekommt.
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 10000);
wss.on('close', () => { clearInterval(heartbeat); for (const timer of pendingDisconnects.values()) clearTimeout(timer); pendingDisconnects.clear(); });

function lanIPs() {
  const out = [], ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) for (const ni of ifs[name]) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  return out;
}
server.listen(PORT, () => {
  const ips = lanIPs();
  console.log(`AirConsole-Local laeuft auf Port ${PORT}.`);
  console.log(`  BREACH:     http://localhost:${PORT}/breach.html (Online-Raeume / Solo)`);
  if (!ips.length) {
    console.log(`  Screen:     http://localhost:${PORT}/screen.html`);
    console.log(`  Controller: http://localhost:${PORT}/controller.html`);
  } else {
    ips.forEach(ip => {
      console.log(`  Screen:     http://${ip}:${PORT}/screen.html`);
      console.log(`  Controller: http://${ip}:${PORT}/controller.html`);
    });
    if (ips.length > 1) console.log('  (mehrere Adressen — nimm die aus deinem WLAN-Adapter)');
  }
});
