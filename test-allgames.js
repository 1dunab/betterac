// Smoke-Test über ALLE registrierten Spiele (Roadmap #4):
// Boot der echten Shell mit 4 Spielern, dann jedes Spiel starten,
// ~1,2s laufen lassen (JSDOM tickt rAF) und wieder abbrechen.
// Bestanden = kein Laufzeitfehler auf Screen oder Controllern.
// WebGL-Spiele dürfen sofort in die Lobby zurückfallen (JSDOM kann kein WebGL).
const { makeDom, makeBus, visible } = require('./test-helpers');

const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const c1 = makeDom('controller.html', 'controller', bus, 'c1');
const c2 = makeDom('controller.html', 'controller', bus, 'c2');
const c3 = makeDom('controller.html', 'controller', bus, 'c3');
const c4 = makeDom('controller.html', 'controller', bus, 'c4');
const all = [screen, c1, c2, c3, c4];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }

// Fehler pro Spiel zuordnen (zusätzlich zum makeDom-onerror, der exitCode setzt)
let currentGame = '(boot)';
const errors = [];
all.forEach((dom, i) => dom.window.addEventListener('error', (e) => {
  errors.push({ game: currentGame, where: i === 0 ? 'screen' : 'c' + i, msg: e.message });
}));

(async () => {
  await sleep(100);
  for (const [dom, name] of [[c1, 'Anna'], [c2, 'Ben'], [c3, 'Cleo'], [c4, 'Dino']]) {
    dom.window.document.getElementById('nameInput').value = name;
    dom.window.document.getElementById('joinBtn').click();
  }
  await sleep(100);

  const games = screen.window.GAME_LIST.slice();
  console.log('Registrierte Spiele:', games.length);

  for (const g of games) {
    currentGame = g.key;
    const before = errors.length;
    // Host wählt das Spiel über den Picker (Label-Match wie ein echter Nutzer)
    const btn = [...c1.window.document.querySelectorAll('#gamePicker button')]
      .find(b => b.textContent === g.label);
    if (!btn) { fail(g.key + ': Picker-Button fehlt'); continue; }
    btn.click();
    await sleep(60);
    c1.window.document.getElementById('startBtn').click();
    await sleep(120);

    // ~1,2s laufen lassen — rAF tickt in JSDOM (pretendToBeVisual)
    await sleep(1200);

    // zurück in die Lobby (Abort ist idempotent, falls das Spiel schon endete)
    c1.window.document.getElementById('abortBtn').click();
    await sleep(150);

    const errs = errors.length - before;
    const inLobby = visible(c1) === 'v-shelllobby';
    console.log((errs ? '❌' : '✅') + ' ' + g.label + (errs ? ' — ' + errs + ' Fehler' : '') + (inLobby ? '' : ' (Lobby nicht erreicht: ' + visible(c1) + ')'));
    if (!inLobby) fail(g.key + ': kehrt nach Abort nicht in die Lobby zurück');
  }

  if (errors.length) {
    errors.forEach(e => console.error('  [' + e.game + '/' + e.where + '] ' + e.msg));
    fail(errors.length + ' Laufzeitfehler über alle Spiele');
  }
  console.log(process.exitCode ? '❌ Smoke-Test fehlgeschlagen' : '✅ Alle Checks bestanden');
  process.exit(process.exitCode || 0);
})();
