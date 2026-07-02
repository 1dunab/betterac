// E2E-Test Fake Artist: genau ein Fake, Strich-Rotation, Voting, Auflösung, nächste Runde.
const { makeDom, makeBus, visible } = require('./test-helpers');

const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const c1 = makeDom('controller.html', 'controller', bus, 'c1');
const c2 = makeDom('controller.html', 'controller', bus, 'c2');
const c3 = makeDom('controller.html', 'controller', bus, 'c3');
const all = [c1, c2, c3];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }

function drawStroke(dom) {
  const doc = dom.window.document, pad = doc.getElementById('faPad');
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  const ev = (type, x, y) => new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  pad.dispatchEvent(ev('mousedown', 20, 20));
  pad.dispatchEvent(ev('mousemove', 60, 60));
  dom.window.dispatchEvent(ev('mouseup', 60, 60));
  doc.getElementById('faSend').click();
}

(async () => {
  await sleep(80);
  for (const [dom, name] of [[c1, 'Anna'], [c2, 'Ben'], [c3, 'Cleo']]) {
    dom.window.document.getElementById('nameInput').value = name;
    dom.window.document.getElementById('joinBtn').click();
  }
  await sleep(80);

  // Host wählt Fake Artist und startet
  const picker = [...c1.window.document.querySelectorAll('#gamePicker button')];
  const btn = picker.find(b => b.textContent.includes('Fake Artist'));
  if (!btn) { fail('Fake Artist nicht im Picker!'); process.exit(1); }
  btn.click();
  await sleep(50);
  c1.window.document.getElementById('startBtn').click();
  await sleep(80);

  console.log('Nach Start:', all.map(visible).join(' | '), '(erwartet 3x v-fa-card)');

  // Rollen: genau ein Fake
  const roles = all.map(d => {
    d.window.document.getElementById('faHold').dispatchEvent(new d.window.MouseEvent('mousedown', { bubbles: true }));
    const txt = d.window.document.getElementById('faHold').textContent;
    return txt.includes('FAKE ARTIST') ? 'FAKE' : 'WORT';
  });
  console.log('Rollen:', roles.join(' | '));
  if (roles.filter(r => r === 'FAKE').length !== 1) fail(roles.filter(r => r === 'FAKE').length + ' Fakes statt 1');

  // Alle bestätigen → Zeichenphase
  all.forEach(d => d.window.document.getElementById('faSeenBtn').click());
  await sleep(50);

  // 3 Spieler x 2 Striche (Default) = 6 Züge, Rotation prüfen
  const strokesBy = { c1: 0, c2: 0, c3: 0 };
  for (let turn = 0; turn < 6; turn++) {
    const drawerIdx = all.findIndex(d => visible(d) === 'v-fa-draw');
    if (drawerIdx === -1) { fail('Kein aktiver Zeichner bei Zug ' + turn + ' — Views: ' + all.map(visible).join('|')); break; }
    const waiting = all.filter((d, i) => i !== drawerIdx).every(d => visible(d) === 'v-fa-wait');
    if (!waiting) fail('Andere Spieler nicht im Warte-View bei Zug ' + turn);
    strokesBy['c' + (drawerIdx + 1)]++;
    drawStroke(all[drawerIdx]);
    await sleep(30);
  }
  console.log('Striche pro Spieler:', JSON.stringify(strokesBy), '(erwartet je 2)');
  if (!Object.values(strokesBy).every(n => n === 2)) fail('Rotation ungleichmäßig');

  // Voting
  console.log('Nach Zeichnen:', all.map(visible).join(' | '), '(erwartet 3x v-fa-vote)');
  if (!all.every(d => visible(d) === 'v-fa-vote')) fail('Nicht alle im Vote-View');
  const voteOpts = [...c1.window.document.querySelectorAll('#faVoteList button')].map(b => b.textContent);
  console.log('c1 Vote-Optionen:', voteOpts.join(','), '(erwartet Ben,Cleo — ohne sich selbst)');
  if (voteOpts.includes('Anna')) fail('Eigener Name in Vote-Liste');
  // c1 und c2 stimmen für Cleo, c3 für Anna → Cleo meistgewählt
  for (const [dom, target] of [[c1, 'Cleo'], [c2, 'Cleo'], [c3, 'Anna']]) {
    [...dom.window.document.querySelectorAll('#faVoteList button')].find(b => b.textContent === target).click();
    await sleep(20);
  }
  await sleep(50);

  // Ergebnis: Host sieht Next-Button, Gäste nicht
  console.log('Ergebnis — NextBtn Host:', c1.window.document.getElementById('faNextBtn').style.display,
    '| Gast:', c2.window.document.getElementById('faNextBtn').style.display, '(erwartet inline-block | none)');
  if (c1.window.document.getElementById('faNextBtn').style.display === 'none') fail('Host hat keinen Next-Button');
  if (c2.window.document.getElementById('faNextBtn').style.display !== 'none') fail('Gast hat Next-Button');

  // Nächste Runde
  c1.window.document.getElementById('faNextBtn').click();
  await sleep(50);
  console.log('Runde 2:', all.map(visible).join(' | '), '| Label:', c2.window.document.getElementById('faRoundLbl').textContent);
  if (!all.every(d => visible(d) === 'v-fa-card')) fail('Runde 2 startet nicht mit Rollenkarten');

  console.log(process.exitCode ? '❌ Test fehlgeschlagen' : '✅ Alle Checks bestanden');
  process.exit(process.exitCode || 0);
})();
