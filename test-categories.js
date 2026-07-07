// E2E-Test Stadt Land Fluss: Scoring (einzigartig 10 / doppelt 5 / ungültig 0),
// Rundenende bei kompletter Abgabe, Finale + Revanche.
const { makeDom, makeBus, visible } = require('./test-helpers');

const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const c1 = makeDom('controller.html', 'controller', bus, 'c1');
const c2 = makeDom('controller.html', 'controller', bus, 'c2');
const c3 = makeDom('controller.html', 'controller', bus, 'c3');
const all = [c1, c2, c3];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function fill(dom, cat, text) {
  const inp = [...dom.window.document.querySelectorAll('#slfInputs input')].find(i => i.getAttribute('data-cat') === cat);
  inp.value = text;
}
const waitInfo = (d) => d.window.document.getElementById('slfWaitInfo').textContent;

(async () => {
  await sleep(80);
  for (const [dom, name] of [[c1, 'Anna'], [c2, 'Ben'], [c3, 'Cleo']]) {
    dom.window.document.getElementById('nameInput').value = name;
    dom.window.document.getElementById('joinBtn').click();
  }
  await sleep(80);

  const picker = [...c1.window.document.querySelectorAll('#gamePicker button')];
  const btn = picker.find(b => b.textContent.includes('Stadt'));
  if (!btn) { fail('Stadt Land Fluss nicht im Picker'); process.exit(1); }
  btn.click();
  await sleep(50);
  // Runden auf 1 stellen (3 → 2 → 1)
  const roundsRow = [...c1.window.document.querySelectorAll('#gameSettings .step')].find(r => r.textContent.includes('Runden'));
  roundsRow.querySelectorAll('button')[0].click();
  await sleep(30);
  [...c1.window.document.querySelectorAll('#gameSettings .step')].find(r => r.textContent.includes('Runden')).querySelectorAll('button')[0].click();
  await sleep(30);
  // Eigene Kategorien setzen
  const catsInp = [...c1.window.document.querySelectorAll('#gameSettings input[type=text]')][0];
  if (!catsInp) fail('Kein Kategorien-Textfeld in den Settings');
  catsInp.value = 'Pokemon, Promi, Marke';
  catsInp.dispatchEvent(new c1.window.Event('change', { bubbles: true }));
  await sleep(50);
  c1.window.document.getElementById('startBtn').click();
  await sleep(80);

  console.log('Views nach Start:', all.map(visible).join(' | '), '(erwartet 3x v-slf-write)');
  if (!all.every(d => visible(d) === 'v-slf-write')) fail('Nicht alle im Schreib-View');
  const gotCats = [...c2.window.document.querySelectorAll('#slfInputs input')].map(i => i.getAttribute('data-cat'));
  console.log('Kategorien:', gotCats.join(','), '(erwartet Pokemon,Promi,Marke)');
  if (gotCats.join(',') !== 'Pokemon,Promi,Marke') fail('Eigene Kategorien nicht übernommen');
  const L = c1.window.document.getElementById('slfLetter').textContent;
  console.log('Buchstabe:', L);

  // Antworten: Pokemon doppelt (5/5), Promi nur Anna gültig (10), Marke Ben ungültig (0)
  fill(c1, 'Pokemon', L + 'amon'); fill(c1, 'Promi', L + 'apromi');
  fill(c2, 'Pokemon', (L + 'amon').toLowerCase()); fill(c2, 'Marke', '9zzz');
  for (const d of all) { d.window.document.getElementById('slfDone').click(); await sleep(30); }
  await sleep(80);

  console.log('Anna:', waitInfo(c1), '(erwartet +15 · Gesamt: 15)');
  console.log('Ben: ', waitInfo(c2), '(erwartet +5 · Gesamt: 5)');
  console.log('Cleo:', waitInfo(c3), '(erwartet +0 · Gesamt: 0)');
  if (!waitInfo(c1).includes('+15 Punkte · Gesamt: 15')) fail('Anna-Punkte falsch');
  if (!waitInfo(c2).includes('+5 Punkte · Gesamt: 5')) fail('Ben-Punkte falsch');
  if (!waitInfo(c3).includes('+0 Punkte · Gesamt: 0')) fail('Cleo-Punkte falsch');

  // Host sieht Weiter, Gast nicht
  const hn = c1.window.document.getElementById('slfNextBtn'), gn = c2.window.document.getElementById('slfNextBtn');
  console.log('Weiter-Button — Host:', hn.style.display, hn.textContent, '| Gast:', gn.style.display);
  if (hn.style.display === 'none') fail('Host hat keinen Weiter-Button');
  if (gn.style.display !== 'none') fail('Gast hat Weiter-Button');

  // 1 Runde eingestellt → Weiter führt zum Endstand
  hn.click();
  await sleep(80);
  console.log('Finale — Titel:', c2.window.document.getElementById('slfWaitTitle').textContent,
    '| Host-Button:', hn.textContent, '(erwartet 🏆 Endstand! | 🔁 Nochmal)');
  if (!hn.textContent.includes('Nochmal')) fail('Kein Nochmal-Button im Finale');

  // Revanche
  hn.click();
  await sleep(80);
  console.log('Nach Revanche:', all.map(visible).join(' | '), '(erwartet 3x v-slf-write)');
  if (!all.every(d => visible(d) === 'v-slf-write')) fail('Revanche startet keine Schreibrunde');

  console.log(process.exitCode ? '❌ Test fehlgeschlagen' : '✅ Alle Checks bestanden');
  process.exit(process.exitCode || 0);
})();
