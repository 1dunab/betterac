// E2E-Test Spieleabend-Modus (Roadmap #12): Spiele melden Sieger via
// reportWinners(), die Shell führt die Abend-Wertung, der Host sieht den
// Feierabend-Button (Zwei-Tap), der Champion wird gekürt und die Wertung
// überlebt einen Screen-Reload im Snapshot.
const { makeDom, makeBus, visible } = require('./test-helpers');

const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const c1 = makeDom('controller.html', 'controller', bus, 'c1');
const c2 = makeDom('controller.html', 'controller', bus, 'c2');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
const snapOf = (dom) => JSON.parse(dom.window.sessionStorage.getItem('shellSnapshot') || 'null');

(async () => {
  await sleep(100);
  for (const [dom, name] of [[c1, 'Anna'], [c2, 'Ben']]) {
    dom.window.document.getElementById('nameInput').value = name;
    dom.window.document.getElementById('joinBtn').click();
  }
  await sleep(100);

  // Ohne Punkte: kein Feierabend-Button beim Host
  if (c1.window.document.getElementById('nightBtn').style.display !== 'none') fail('Feierabend-Button ohne Punkte sichtbar');

  // Ein Spiel meldet Sieger (wie es z.B. Reaktion am Endscreen tut)
  screen.window.reportWinners([1]);
  screen.window.reportWinners([1, 2]); // Team-Sieg: mehrere IDs
  screen.window.reportWinners([99]);   // unbekannte ID wird ignoriert
  // Lobby-Update anstoßen (im echten Spiel folgt endToLobby → sendLobby)
  screen.window.reportWinners([]);
  await sleep(50);

  // Wertung landet im Snapshot: Anna 2, Ben 1
  // (sendLobby speichert den Snapshot — Spielwechsel anstoßen)
  const pick = [...c1.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent.includes('Reaktion'));
  pick.click();
  await sleep(80);
  const snap = snapOf(screen);
  console.log('Snapshot night:', JSON.stringify(snap.night));
  if (!snap.night || snap.night[1].pts !== 2 || snap.night[2].pts !== 1) fail('Abend-Wertung nicht korrekt im Snapshot');
  if (snap.night[99]) fail('Unbekannte ID wurde gewertet');
  if (snap.night[1].name !== 'Anna') fail('Name fehlt in der Wertung');

  // Host sieht jetzt den Feierabend-Button, Gast nicht
  if (c1.window.document.getElementById('nightBtn').style.display === 'none') fail('Feierabend-Button beim Host fehlt');
  if (c2.window.document.getElementById('nightBtn').style.display !== 'none') fail('Feierabend-Button beim Gast sichtbar');
  console.log('Feierabend-Button: Host ✓, Gast ✗ ✓');

  // Reload-Sicherheit: neuer Screen mit geseedetem Snapshot behält die Wertung
  const screen2 = makeDom('screen.html', 'screen', bus, 'screen2', { seedSession: { shellSnapshot: JSON.stringify(snap) } });
  await sleep(200);
  const snap2 = snapOf(screen2);
  console.log('Nach Reload night:', JSON.stringify(snap2 && snap2.night));
  if (!snap2 || !snap2.night || snap2.night[1].pts !== 2) fail('Abend-Wertung überlebt den Reload nicht');

  // Feierabend: erster Tap armiert nur, zweiter kürt den Champion
  const btn = c1.window.document.getElementById('nightBtn');
  btn.click();
  await sleep(50);
  let s = snapOf(screen2);
  if (!s.night || !s.night[1]) fail('Erster Feierabend-Tap hat schon gekürt (Bestätigung fehlt)');
  btn.click();
  await sleep(80);
  s = snapOf(screen2);
  console.log('Nach Feierabend night:', JSON.stringify(s.night));
  if (s.night && Object.keys(s.night).length) fail('Wertung nach Feierabend nicht zurückgesetzt');
  if (c1.window.document.getElementById('nightBtn').style.display !== 'none') fail('Feierabend-Button nach Reset noch sichtbar');

  console.log(process.exitCode ? '❌ Test fehlgeschlagen' : '✅ Alle Checks bestanden');
  process.exit(process.exitCode || 0);
})();
