// Gemeinsame Test-Infrastruktur: JSDOM-Seiten + Fake-Server-Bus
// (gleiches Protokoll wie server.js, aber in-process ohne Netz).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, 'public');

function noopCtx() {
  // Methoden geben ein Objekt zurueck, das weitere Aufrufe schluckt
  // (z.B. createLinearGradient(...).addColorStop(...)).
  const sub = new Proxy({}, { get: () => function () {}, set: () => true });
  return new Proxy({}, { get: (t, k) => {
    if (k === 'measureText') return () => ({ width: 10 });
    return typeof k === 'string' ? function () { return sub; } : undefined;
  }, set: () => true });
}

function makeDom(file, role, bus, label) {
  let html = fs.readFileSync(path.join(PUB, file), 'utf8');
  // <script src> inlinen, damit runScripts:'dangerously' ohne Netz funktioniert
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, p) =>
    '<script>' + fs.readFileSync(path.join(PUB, p), 'utf8').replace(/<\/script>/g, '<\\/script>') + '</script>');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost:3000/' + file, pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = noopCtx;
      w.WebSocket = function () {
        const ws = { readyState: 1, OPEN: 1, send: (raw) => bus.fromClient(label, raw) };
        setTimeout(() => ws.onopen && ws.onopen(), 0);
        bus.register(label, { deliver: (obj) => ws.onmessage && ws.onmessage({ data: JSON.stringify(obj) }) });
        return ws;
      };
      w.onerror = (msg) => { console.error(label + ' Laufzeitfehler: ' + msg); process.exitCode = 1; };
    }
  });
  return dom;
}

// Mini-Server-Nachbau (gleiches Protokoll wie server.js)
function makeBus() {
  const clients = new Map(); let nextId = 1;
  return {
    handlers: {},
    register(label, h) { this.handlers[label] = h; },
    // Simuliert einen Verbindungsabbruch (z.B. Host geht) — wie server.js:
    // Client aus der Map entfernen und disconnect an alle anderen broadcasten
    disconnect(label) {
      const entry = [...clients.entries()].find(([, l]) => l === label);
      if (!entry) return;
      clients.delete(entry[0]);
      for (const [, ol] of clients) this.handlers[ol].deliver({ type: 'disconnect', device_id: entry[0] });
    },
    fromClient(label, raw) {
      const msg = JSON.parse(raw);
      if (msg.type === 'register') {
        const id = msg.role === 'screen' ? 0 : nextId++;
        clients.set(id, label);
        this.handlers[label].deliver({ type: 'welcome', device_id: id, code: 'LOCAL', devices: [...clients.keys()] });
        for (const [oid, ol] of clients) if (oid !== id) this.handlers[ol].deliver({ type: 'connect', device_id: id });
        this.handlers[label]._id = id;
        return;
      }
      if (msg.type === 'message') {
        const from = [...clients.entries()].find(([, l]) => l === label)[0];
        if (msg.to === undefined || msg.to === null) {
          for (const [oid, ol] of clients) if (ol !== label) this.handlers[ol].deliver({ type: 'message', from, data: msg.data });
        } else {
          const l = clients.get(msg.to);
          if (l) this.handlers[l].deliver({ type: 'message', from, data: msg.data });
        }
      }
    }
  };
}

const visible = (dom) => [...dom.window.document.querySelectorAll('.view.on')].map(v => v.id).join(',');

module.exports = { makeDom, makeBus, visible };
