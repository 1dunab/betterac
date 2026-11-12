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

// opts: seedSession / seedLocal (a reloaded tab or a returning device), and for pages that talk to a real server.js
// instead of the in-process bus: realWs (use jsdom's own WebSocket; the page counts them in window.__sockets),
// url (the page's address, so location.host is the server) and fetch (what the page's fetch() calls).
function makeDom(file, role, bus, label, opts) {
  let html = fs.readFileSync(path.join(PUB, file), 'utf8');
  // <script src> inlinen, damit runScripts:'dangerously' ohne Netz funktioniert
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, p) =>
    '<script>' + fs.readFileSync(path.join(PUB, p.split('?')[0]), 'utf8').replace(/<\/script>/g, '<\\/script>') + '</script>');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: (opts && opts.url) || 'http://localhost:3000/' + file, pretendToBeVisual: true,
    beforeParse(w) {
      // simuliert z.B. sessionStorage, das einen Seiten-Reload im selben Tab überlebt
      if (opts && opts.seedSession) {
        for (const k of Object.keys(opts.seedSession)) w.sessionStorage.setItem(k, opts.seedSession[k]);
      }
      // simuliert localStorage eines wiederkehrenden Geräts (z.B. gemerkter Name)
      if (opts && opts.seedLocal) {
        for (const k of Object.keys(opts.seedLocal)) w.localStorage.setItem(k, opts.seedLocal[k]);
      }
      w.HTMLCanvasElement.prototype.getContext = noopCtx;
      if (opts && opts.fetch) w.fetch = opts.fetch;
      if (opts && opts.realWs) {
        const Real = w.WebSocket;
        w.__sockets = 0;
        w.WebSocket = class extends Real { constructor(...a) { super(...a); w.__sockets++; } };
      } else w.WebSocket = function () {
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
  let screenSecret = null, secrets = 0;   // like server.js: the one screen cannot be stolen, only its own tab (secret) takes the seat back
  const phoneSecrets = new Map();         // like server.js: a phone that comes back with its secret gets its old id again
  return {
    handlers: {},
    register(label, h) { this.handlers[label] = h; },
    // Simuliert einen Verbindungsabbruch (z.B. Host geht) — wie server.js:
    // Client aus der Map entfernen und disconnect an alle anderen broadcasten
    disconnect(label) {
      const entry = [...clients.entries()].find(([, l]) => l === label);
      if (!entry) return;
      clients.delete(entry[0]);
      if (entry[0] === 0) screenSecret = null;
      for (const [, ol] of clients) this.handlers[ol].deliver({ type: 'disconnect', device_id: entry[0] });
    },
    fromClient(label, raw) {
      const msg = JSON.parse(raw);
      if (msg.type === 'kick') {
        // Wie server.js: nur der Screen (ID 0) darf kicken
        const sender = [...clients.entries()].find(([, l]) => l === label);
        if (!sender || sender[0] !== 0) return;
        const id = msg.id | 0, tl = clients.get(id);
        if (id > 0 && tl !== undefined) {
          clients.delete(id); phoneSecrets.delete(id);
          this.handlers[tl].deliver({ type: 'kicked' });
          for (const [, ol] of clients) this.handlers[ol].deliver({ type: 'disconnect', device_id: id });
        }
        return;
      }
      if (msg.type === 'register') {
        if (msg.role === 'screen') {
          const old = clients.get(0);
          if (old && old !== label && !(screenSecret && msg.secret === screenSecret)) { this.handlers[label].deliver({ type: 'busy' }); return; }
          if (!old) screenSecret = 'screen-secret-' + (++secrets);
          else if (old !== label) this.handlers[old].deliver({ type: 'kicked' });
        }
        const back = msg.role !== 'screen' && Number.isInteger(msg.resume) && msg.resume > 0 && typeof msg.secret === 'string'
          && phoneSecrets.get(msg.resume) === msg.secret && !clients.has(msg.resume);
        const id = msg.role === 'screen' ? 0 : back ? msg.resume : nextId++;
        clients.set(id, label);
        if (id > 0 && !phoneSecrets.has(id)) phoneSecrets.set(id, 'phone-secret-' + id);
        this.handlers[label].deliver({ type: 'welcome', device_id: id, code: 'LOCAL', devices: [...clients.keys()], secret: id === 0 ? screenSecret : phoneSecrets.get(id) });
        for (const [oid, ol] of clients) if (oid !== id) this.handlers[ol].deliver({ type: 'connect', device_id: id });
        this.handlers[label]._id = id;
        return;
      }
      if (msg.type === 'message') {
        // Nicht (mehr) registrierte Sender ignorieren (z.B. ein ersetzter Screen)
        const entry = [...clients.entries()].find(([, l]) => l === label);
        if (!entry) return;
        const from = entry[0];
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
