const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, 'public');

function noopCtx() {
  return new Proxy({}, { get: (t, k) => {
    if (k === 'measureText') return () => ({ width: 10 });
    return typeof k === 'string' ? function () {} : undefined;
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
const clients = new Map(); let nextId = 1;
const bus = {
  handlers: {},
  register(label, h) { this.handlers[label] = h; },
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

const screen = makeDom('screen.html', 'screen', bus, 'screen');
const c1 = makeDom('controller.html', 'controller', bus, 'c1');
const c2 = makeDom('controller.html', 'controller', bus, 'c2');
const c3 = makeDom('controller.html', 'controller', bus, 'c3');

const visible = (dom) => [...dom.window.document.querySelectorAll('.view.on')].map(v => v.id).join(',');

setTimeout(() => {
  // 1) Namen setzen
  for (const [dom, name] of [[c1, 'Anna'], [c2, 'Ben'], [c3, 'Cleo']]) {
    dom.window.document.getElementById('nameInput').value = name;
    dom.window.document.getElementById('joinBtn').click();
  }
  setTimeout(() => {
    console.log('Nach Join — c1:', visible(c1), '| c2:', visible(c2), '| c3:', visible(c3));
    // 2) Host (c1) wählt Spion & startet
    const picker = [...c1.window.document.querySelectorAll('#gamePicker button')];
    console.log('Spiele im Picker:', picker.map(b => b.textContent).join(' | '));
    const spyBtn = picker.find(b => b.textContent.includes('Spion'));
    if (!spyBtn) { console.error('Spion nicht im Picker!'); process.exit(1); }
    spyBtn.click();
    setTimeout(() => {
      c1.window.document.getElementById('startBtn').click();
      setTimeout(() => {
        console.log('Nach Start — c1:', visible(c1), '| c2:', visible(c2), '| c3:', visible(c3));
        // 3) Rollen prüfen: genau ein Spion
        const roles = [c1, c2, c3].map(d => {
          d.window.document.getElementById('spyHold').dispatchEvent(new d.window.MouseEvent('mousedown', { bubbles: true }));
          const txt = d.window.document.getElementById('spyHold').textContent;
          return txt.includes('SPION') ? 'SPION' : 'WORT:' + (txt.match(/Wort:(\S+)/) || ['', '?'])[1];
        });
        console.log('Rollen:', roles.join(' | '));
        const spies = roles.filter(r => r === 'SPION').length;
        if (spies !== 1) { console.error('FEHLER: ' + spies + ' Spione statt 1'); process.exitCode = 1; }
        // 4) Alle bestätigen
        [c1, c2, c3].forEach(d => d.window.document.getElementById('spySeenBtn').click());
        setTimeout(() => {
          console.log('Nach Bestätigung — c1:', visible(c1), 'RevealBtn sichtbar:', c1.window.document.getElementById('spyRevealBtn').style.display);
          // 5) Host deckt auf, dann nächste Runde
          c1.window.document.getElementById('spyRevealBtn').click();
          setTimeout(() => {
            console.log('Nach Aufdecken — NextBtn Host:', c1.window.document.getElementById('spyNextBtn').style.display,
              '| NextBtn Gast:', c2.window.document.getElementById('spyNextBtn').style.display);
            c1.window.document.getElementById('spyNextBtn').click();
            setTimeout(() => {
              console.log('Runde 2 — c2 Ansicht:', visible(c2), '| Label:', c2.window.document.getElementById('spyRoundLbl').textContent);
              console.log(process.exitCode ? '❌ Test fehlgeschlagen' : '✅ Alle Checks bestanden');
              process.exit(process.exitCode || 0);
            }, 50);
          }, 50);
        }, 50);
      }, 50);
    }, 50);
  }, 80);
}, 80);
