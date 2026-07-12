// E2E-Test Lobby-Restore (Roadmap #3): Ein Screen-Reload im selben Tab
// (simuliert durch einen zweiten Screen mit geseedetem sessionStorage)
// stellt Namen, Farben, Spiel-Auswahl und Settings wieder her —
// niemand landet erneut im Name-Prompt.
const { makeDom, makeBus, visible } = require('./test-helpers');

const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const c1 = makeDom('controller.html', 'controller', bus, 'c1');
const c2 = makeDom('controller.html', 'controller', bus, 'c2');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }

(async () => {
  await sleep(100);
  for (const [dom, name] of [[c1, 'Anna'], [c2, 'Ben']]) {
    dom.window.document.getElementById('nameInput').value = name;
    dom.window.document.getElementById('joinBtn').click();
  }
  await sleep(100);

  // Roadmap #8: Name wird gemerkt (localStorage), Prefill bei Wiederkehr
  const stored = c1.window.localStorage.getItem('playerName');
  console.log('Gespeicherter Name c1:', stored, '(erwartet Anna)');
  if (stored !== 'Anna') fail('Name nicht in localStorage gespeichert');
  const cReturn = makeDom('controller.html', 'controller', bus, 'cReturn', { seedLocal: { playerName: 'Zoe' } });
  await sleep(150);
  const prefill = cReturn.window.document.getElementById('nameInput').value;
  console.log('Prefill bei Wiederkehr:', prefill, '(erwartet Zoe)');
  if (prefill !== 'Zoe') fail('Name-Prefill fehlt');

  // Roadmap #10: 🎲 Zufall wählt nur Spiele, die mit 2 Spielern startbar sind
  const tooBig = ['🕵️ Spion', '🖌️ Fake Artist', '🧪 Hexenschicht'];
  for (let i = 0; i < 5; i++) {
    [...c1.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent === '🎲 Zufall').click();
    await sleep(60);
    const sel = [...c1.window.document.querySelectorAll('#gamePicker button')].find(b => b.classList.contains('sel'));
    if (!sel) { fail('Zufall: keine Auswahl'); break; }
    if (tooBig.includes(sel.textContent)) { fail('Zufall wählte ' + sel.textContent + ' trotz nur 2 Spielern'); break; }
  }
  console.log('🎲 Zufall: 5 Würfe, alle mit 2 Spielern startbar ✓');

  // Host wählt ein anderes Spiel und ändert ein Setting
  const pick = [...c1.window.document.querySelectorAll('#gamePicker button')].find(b => b.textContent.includes('Reaktion'));
  pick.click();
  await sleep(60);
  const plus = c1.window.document.querySelector('#gameSettings .step button:last-child');
  plus.click(); // Runden 5 -> 7
  await sleep(60);

  const snap = screen.window.sessionStorage.getItem('shellSnapshot');
  if (!snap) { fail('Kein Snapshot im sessionStorage'); process.exit(1); }
  console.log('Snapshot gespeichert:', snap.length, 'Zeichen');

  // "Reload": neuer Screen im selben Tab = gleiche sessionStorage-Inhalte
  const screen2 = makeDom('screen.html', 'screen', bus, 'screen2', { seedSession: { shellSnapshot: snap } });
  await sleep(200);

  const v1 = visible(c1), v2 = visible(c2);
  console.log('Views nach Reload:', v1, '|', v2, '(erwartet 2x v-shelllobby — KEIN Name-Prompt)');
  if (v1 !== 'v-shelllobby' || v2 !== 'v-shelllobby') fail('Spieler nach Screen-Reload nicht in der Lobby');

  const hello1 = c1.window.document.getElementById('helloName').textContent;
  console.log('Begrüßung c1:', hello1, '(erwartet Anna)');
  if (!hello1.includes('Anna')) fail('Name nicht wiederhergestellt');

  const sel = [...c1.window.document.querySelectorAll('#gamePicker button')].find(b => b.classList.contains('sel'));
  console.log('Gewähltes Spiel nach Reload:', sel && sel.textContent, '(erwartet Reaktionsduell)');
  if (!sel || !sel.textContent.includes('Reaktion')) fail('Spiel-Auswahl nicht wiederhergestellt');

  const rounds = c1.window.document.querySelector('#gameSettings .step .big');
  console.log('Setting nach Reload:', rounds && rounds.textContent, '(erwartet 7)');
  if (!rounds || rounds.textContent !== '7') fail('Settings nicht wiederhergestellt');

  // Kontrollfall: frischer Spieler ohne Snapshot-Eintrag bekommt den Name-Prompt
  const c3 = makeDom('controller.html', 'controller', bus, 'c3');
  await sleep(150);
  console.log('Neuer Spieler ohne Snapshot:', visible(c3), '(erwartet v-name)');
  if (visible(c3) !== 'v-name') fail('Frischer Spieler bekommt keinen Name-Prompt');

  // Und das Spiel ist nach dem Restore startbar
  c1.window.document.getElementById('startBtn').click();
  await sleep(150);
  console.log('Nach Start:', visible(c1), '(erwartet v-rx)');
  if (visible(c1) !== 'v-rx') fail('Spielstart nach Restore kaputt');

  console.log(process.exitCode ? '❌ Test fehlgeschlagen' : '✅ Alle Checks bestanden');
  process.exit(process.exitCode || 0);
})();
