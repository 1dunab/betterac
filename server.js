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
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/screen.html';
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// --- WebSocket: Verbindung & Nachrichten-Routing ---
const wss = new WebSocketServer({ server });
const clients = new Map();   // device_id -> ws
let nextControllerId = 1;    // Screen ist immer 0, Controller ab 1

const send = (ws, obj) => { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
function broadcast(obj, exceptId) {
  for (const [id, ws] of clients) if (id !== exceptId) send(ws, obj);
}

wss.on('connection', (ws) => {
  ws.deviceId = undefined;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'register') {
      const id = msg.role === 'screen' ? 0 : nextControllerId++;
      ws.deviceId = id;
      clients.set(id, ws);
      send(ws, { type: 'welcome', device_id: id, code: 'LOCAL', devices: [...clients.keys()] });
      broadcast({ type: 'connect', device_id: id }, id); // andere informieren
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
    if (ws.deviceId !== undefined) {
      clients.delete(ws.deviceId);
      broadcast({ type: 'disconnect', device_id: ws.deviceId });
    }
  });
});

function lanIPs() {
  const out = [], ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) for (const ni of ifs[name]) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  return out;
}
server.listen(PORT, () => {
  const ips = lanIPs();
  console.log(`AirConsole-Local laeuft auf Port ${PORT}.`);
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
