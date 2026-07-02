const { makeDom, makeBus, visible } = require('./test-helpers');

const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const c1 = makeDom('controller.html', 'controller', bus, 'c1');
const c2 = makeDom('controller.html', 'controller', bus, 'c2');
const c3 = makeDom('controller.html', 'controller', bus, 'c3');

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
