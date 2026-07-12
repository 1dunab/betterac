// E2E-Test Host-Tools (Roadmap #13): Der Host kann Spieler in der Lobby
// umbenennen (✏️→✓) und kicken (✖ mit Zwei-Tap-Bestätigung); sich selbst
// kicken geht nicht, Nicht-Hosts werden ignoriert, der Gekickte sieht
// eine Meldung und resumed nicht still zurück.
const { makeDom, makeBus, visible } = require('./test-helpers');

const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const c1 = makeDom('controller.html', 'controller', bus, 'c1');
const c2 = makeDom('controller.html', 'controller', bus, 'c2');
const c3 = makeDom('controller.html', 'controller', bus, 'c3');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
const adminRows = (dom) => [...dom.window.document.querySelectorAll('#playerAdmin > div')].slice(1); // ohne "Spieler:"-Kopf

(async () => {
  await sleep(100);
  for (const [dom, name] of [[c1, 'Anna'], [c2, 'Ben'], [c3, 'Carl']]) {
    dom.window.document.getElementById('nameInput').value = name;
    dom.window.document.getElementById('joinBtn').click();
  }
  await sleep(100);

  // Host (Anna) sieht die Spielerliste, Gäste nicht
  let rows = adminRows(c1);
  console.log('Admin-Zeilen beim Host:', rows.length, '(erwartet 3)');
  if (rows.length !== 3) fail('Spielerliste beim Host fehlt/falsch');
  if (adminRows(c2).length !== 0) fail('Spielerliste beim Gast sichtbar');
  // Eigene Zeile hat keinen Kick-Button
  const own = rows.find(r => r.textContent.includes('(du)'));
  if (!own || [...own.querySelectorAll('button')].some(b => b.textContent.includes('✖'))) fail('Eigene Zeile kickbar');

  // Umbenennen: Ben -> Bernd (✏️ öffnet Input, ✓ sendet)
  const benRow = rows.find(r => r.textContent.includes('Ben'));
  const edit = [...benRow.querySelectorAll('button')].find(b => b.textContent === '✏️');
  edit.click();
  benRow.querySelector('input').value = 'Bernd';
  edit.click(); // jetzt ✓
  await sleep(80);
  const hello2 = c2.window.document.getElementById('helloName').textContent;
  console.log('Ben nach Rename:', hello2, '(erwartet Bernd)');
  if (!hello2.includes('Bernd')) fail('Rename kam nicht beim Spieler an');

  // Nicht-Host darf nicht kicken
  bus.fromClient('c2', JSON.stringify({ type: 'message', to: 0, data: { t: 'shellKick', id: 1 } }));
  await sleep(80);
  if (visible(c1) !== 'v-shelllobby') fail('Nicht-Host konnte den Host kicken');

  // Kick: erster Tap armiert nur, zweiter wirft Carl raus
  const carlRow = adminRows(c1).find(r => r.textContent.includes('Carl'));
  const kick = [...carlRow.querySelectorAll('button')].find(b => b.textContent.includes('✖'));
  kick.click();
  await sleep(60);
  if (visible(c3) !== 'v-shelllobby') fail('Erster Kick-Tap hat schon gekickt (Bestätigung fehlt)');
  kick.click();
  await sleep(100);
  const kickedMsg = c3.window.document.body.textContent;
  console.log('Carl sieht:', kickedMsg.includes('Der Host hat dich entfernt') ? 'Kick-Meldung ✓' : kickedMsg.slice(0, 60));
  if (!kickedMsg.includes('Der Host hat dich entfernt')) fail('Gekickter sieht keine Meldung');
  if (c3.window.sessionStorage.getItem('ac_resume')) fail('Resume-Daten des Gekickten nicht gelöscht');
  rows = adminRows(c1);
  console.log('Admin-Zeilen nach Kick:', rows.length, '(erwartet 2)');
  if (rows.length !== 2) fail('Gekickter noch in der Liste');

  console.log(process.exitCode ? '❌ Test fehlgeschlagen' : '✅ Alle Checks bestanden');
  process.exit(process.exitCode || 0);
})();
