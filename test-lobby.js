// The start menu: the game catalogue on the phones (pictures, categories, wishes), the host's choice, and what
// the screen keeps about wishes. Real shell + real controllers in JSDOM.
const { makeDom, makeBus, visible } = require('./test-helpers');
const fs = require('fs');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
const cs = {};
function addPhone(l) {
  cs[l] = makeDom('controller.html', 'controller', bus, l);
  cs[l].window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  const h = bus.handlers[l], orig = h.deliver; h.inbox = [];
  h.deliver = (m) => { if (m.type === 'message') h.inbox.push(m.data); orig(m); };
  return phone(l);
}
const phone = (l) => ({
  l, get id() { return bus.handlers[l]._id; }, dom: cs[l], $: (id) => cs[l].window.document.getElementById(id),
  q: (sel) => cs[l].window.document.querySelector(sel), qa: (sel) => [...cs[l].window.document.querySelectorAll(sel)],
  lobby() { return bus.handlers[l].inbox.filter(m => m.t === 'shell' && m.cmd === 'lobby').pop(); },
  send: (data) => bus.fromClient(l, JSON.stringify({ type: 'message', to: 0, data })),
  card(key) { return this.q('.gcard[data-key="' + key + '"]'); },
  shownCards() { return this.qa('.gcard').filter(c => c.style.display !== 'none').map(c => c.dataset.key); }
});
const join = (p, name) => { p.$('nameInput').value = name; p.$('joinBtn').click(); };

(async () => {
  const [p1, p2, p3] = ['c1', 'c2', 'c3'].map(addPhone);
  await sleep(100);
  const w = screen.window;
  const games = w.GAME_LIST, cats = w.GAME_CATS.map(c => c.key);

  // ---- every game brings what the catalogue shows ----
  check(games.length >= 27 && games.every(g => typeof g.about === 'string' && g.about.length > 15 && g.about.length < 90), 'every game has one sentence about itself');
  check(games.every(g => cats.includes(g.cat)), 'every game is in one of the categories');
  check(cats.every(c => games.some(g => g.cat === c)), 'no category is empty');
  const missing = games.filter(g => !fs.existsSync('./public/covers/' + g.key + '.jpg')).map(g => g.key);
  check(missing.length === 0, 'every game has a cover picture' + (missing.length ? ' (missing: ' + missing.join() + ')' : ''));
  check(typeof w.renderLobby === 'function' && typeof w.lobbyToast === 'function', 'the screen has the lobby module');
  const order = w.lobbyOrder().map(g => g.key);
  check(order.length === games.length && order.map(k => cats.indexOf(games.find(g => g.key === k).cat)).every((c, i, a) => i === 0 || a[i - 1] <= c), 'the TV shows the games sorted by category');

  join(p1, 'Anna'); join(p2, 'Ben'); join(p3, 'Cleo');
  await sleep(120);

  // ---- the catalogue on the phones ----
  check([p1, p2, p3].every(p => visible(p.dom) === 'v-shelllobby' && p.qa('.gcard').length === games.length), 'all three phones show a card for every game');
  check(p1.qa('.gcard').map(c => c.dataset.key).join() === order.join(), 'in the same order as the TV');
  const c1 = p1.card('autoball'), meta = games.find(g => g.key === 'autoball');
  check(c1.querySelector('img').getAttribute('src') === 'covers/autoball.jpg' && c1.querySelector('.gamebtn').textContent === meta.label && c1.querySelector('.gabout').textContent === meta.about, 'a card has the picture, the name and the sentence');
  check(/ab 1 Spieler/.test(c1.querySelector('.gmeta').textContent) && /Action/.test(c1.querySelector('.gmeta').textContent), 'and who can play and what kind of game it is');
  check(p1.card('werwolf').classList.contains('far') && /braucht 5 Spieler/.test(p1.card('werwolf').querySelector('.gmeta').textContent) && !c1.classList.contains('far'), 'a game that needs more players says so');
  check(/Hallo, Ben/.test(p2.$('helloName').textContent) && /3 Spieler/.test(p2.$('lobInfo').textContent) && /Host/.test(p1.$('lobInfo').textContent) && !/Host/.test(p2.$('lobInfo').textContent), 'the head says who you are and whether you are the host');
  check(p1.$('hostLobby').style.display === 'block' && p2.$('hostLobby').style.display === 'none' && p2.$('guestLobby').style.display === 'block', 'the host gets START, the others a line about what the host is looking at');

  // categories
  check(p2.qa('#gameCats .catchip').map(b => b.dataset.cat).join() === ['alle', 'wunsch'].concat(cats).join(), 'chips: all, wished, and the categories');
  p2.q('#gameCats .catchip[data-cat="kreativ"]').click();
  const shown = p2.shownCards();
  check(shown.includes('bandsalat') && shown.includes('fotosalat') && !shown.includes('autoball') && shown.filter(k => k !== p2.lobby().selected).every(k => games.find(g => g.key === k).cat === 'kreativ'), 'a category shows its games (and always the one the host has chosen)');
  check(p1.shownCards().length === games.length, 'filtering is each phone\'s own business');
  p2.q('#gameCats .catchip[data-cat="alle"]').click();
  check(p2.shownCards().length === games.length, 'back to all');

  // ---- the host chooses: by a tap on the card ----
  p1.card('fotosalat').click(); await sleep(60);
  check(w.eval('shell.selected') === 'fotosalat', 'the host taps a card: the TV shows that game');
  check(p1.card('fotosalat').classList.contains('cur') && p3.card('fotosalat').classList.contains('cur') && p3.qa('.gcard.cur').length === 1, 'every phone marks it');
  check(p1.qa('#gamePicker .gamebtn.sel').map(b => b.textContent).join() === '📸 Fotosalat', 'the name button carries the selection');
  check(p1.$('gameSettings').parentElement === p1.card('fotosalat') && /Nachmachen/.test(p1.$('gameSettings').textContent), 'the host\'s card opens with the game\'s settings');
  check(!p3.$('gameSettings').closest('.gcard') && p3.$('gameSettings').style.display === 'none', 'the others see no settings');
  check(/Anna wählt: 📸 Fotosalat/.test(p3.$('guestLobby').textContent) && /START · 📸 Fotosalat/.test(p1.$('startBtn').textContent), 'the bars at the bottom name the game');
  [...p1.$('gameSettings').querySelectorAll('button')].find(b => b.textContent === '🔍 Zoom-Rätsel').click(); await sleep(60);
  check(w.eval('cfgFor("fotosalat").spiel') === 'zoom' && w.eval('shell.selected') === 'fotosalat', 'a tap on a setting inside the card sets it and does not choose anything else');
  p3.card('geoguess').querySelector('.gamebtn').click(); await sleep(60);
  check(w.eval('shell.selected') === 'fotosalat', 'a guest cannot choose');

  // ---- wishes ----
  check(w.eval('shell.wishes[' + p3.id + ']').join() === 'geoguess' && p3.card('geoguess').querySelector('.gwish').classList.contains('on'), 'a guest\'s tap on a card is a wish');
  check(p1.card('geoguess').querySelector('.gwish').textContent === '👍 1' && !p1.card('geoguess').querySelector('.gwish').classList.contains('on') && p1.lobby().wish.geoguess === 1, 'everybody sees the count, only the wisher\'s thumb is lit');
  p2.card('geoguess').querySelector('.gwish').click(); p2.card('werwolf').querySelector('.gwish').click(); await sleep(60);
  check(p1.lobby().wish.geoguess === 2 && p1.lobby().wish.werwolf === 1 && p2.lobby().mine.join() === 'geoguess,werwolf', 'more wishes');
  p1.card('geoguess').querySelector('.gwish').click(); await sleep(60);
  check(w.eval('shell.selected') === 'fotosalat' && p1.lobby().wish.geoguess === 3, 'the host\'s thumb wishes too and does not choose');
  p2.q('#gameCats .catchip[data-cat="wunsch"]').click();
  check(p2.shownCards().sort().join() === 'fotosalat,geoguess,werwolf', 'the "wished" chip shows what anybody wished for (and the chosen game)');
  p2.q('#gameCats .catchip[data-cat="alle"]').click();
  p2.card('werwolf').querySelector('.gwish').click(); await sleep(60);
  check(!p1.lobby().wish.werwolf && p2.lobby().mine.join() === 'geoguess', 'a second tap takes the wish back');
  for (const k of ['racer', 'slither', 'spy']) p2.card(k).querySelector('.gwish').click();
  await sleep(60);
  check(p2.lobby().mine.join() === 'racer,slither,spy' && p1.lobby().wish.geoguess === 2, 'three wishes each: a fourth pushes the oldest out');
  p2.send({ t: 'shellWish', game: 'nope' }); p2.send({ t: 'shellWish' }); await sleep(40);
  check(p2.lobby().mine.length === 3, 'a wish for a game that does not exist is ignored');
  check(p1.q('#wishTop').style.display !== 'none' && p1.$('lobTools').style.display === 'flex' && p2.$('lobTools').style.display === 'none', 'the host gets "most wished", the others no tools');
  p1.q('#wishTop').click(); await sleep(60);
  check(w.eval('shell.selected') === 'geoguess', '"most wished" chooses the game with the most thumbs');

  // ---- starting fulfils the wish; leaving takes wishes along ----
  p1.$('startBtn').click(); await sleep(150);
  check(w.eval('activeKey') === 'geoguess', 'START starts it');
  p1.$('abortBtn').click(); await sleep(150);
  check(visible(p1.dom) === 'v-shelllobby' && !p1.lobby().wish.geoguess && p2.lobby().mine.join() === 'racer,slither,spy', 'back in the lobby the played game is no longer wished for, the other wishes stay');
  check(p1.qa('.gcard').length === games.length && p1.card('geoguess').classList.contains('cur'), 'the catalogue is still there');
  bus.disconnect('c2'); await sleep(80);
  check(!p1.lobby().wish.racer && w.eval('shell.wishes[' + p2.id + ']') === undefined, 'who leaves takes their wishes along');

  // ---- the 👥 drawer keeps the rarely used host tools out of the way ----
  check(p1.$('hostMore').style.display === 'none' && p1.$('playerAdmin').children.length > 0, 'renaming and removing players sit in a drawer');
  p1.$('moreBtn').click();
  check(p1.$('hostMore').style.display === 'block', 'which the 👥 button opens');

  // ---- the lobby draws without errors: idle, with players, with wishes and a score ----
  w.eval('reportWinners([' + p1.id + '])');
  let threw = null;
  try { w.eval('renderLobby()'); bus.disconnect('c1'); bus.disconnect('c3'); await sleep(60); w.eval('renderLobby()'); } catch (e) { threw = e; }
  check(!threw, 'the TV lobby draws with players and with nobody there' + (threw ? ' (' + threw.message + ')' : ''));

  console.log(process.exitCode ? '❌ Lobby-Checks fehlgeschlagen' : '✅ Alle Lobby-Checks bestanden');
  process.exit(process.exitCode || 0);
})();
