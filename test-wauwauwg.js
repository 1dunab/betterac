// Wauwau-WG: core rules (pure, in a vm) + the screen backbone's phone protocol,
// driven by raw bus phones (no controller UI): adoption, sanitizing, care,
// shop, day/night, Hund des Tages, backup restore, guards.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { makeDom, makeBus } = require('./test-helpers');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- core.js in isolation ----------
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'public/games/wauwauwg/core.js'), 'utf8'), sandbox);
const WW = sandbox.WW;

(function coreTests() {
  const d = WW.newDog({ name: '  <Bello>\n', breed: 'dackel', coat: 9 });
  check(d.name === 'Bello' && d.breed === 'dackel' && d.coat === 2, 'newDog cleans the name and clamps the coat');
  check(d.coins === 30 && d.inv.kibble === 3 && d.toys.join() === 'ball', 'newDog hands out the starter kit');
  check(WW.newDog({ breed: 'katze' }).breed === 'mischling', 'unknown breeds become Mischling');
  check(WW.newDog({ breed: 'constructor' }).breed === 'mischling' && WW.sanitizeDog({ breed: '__proto__' }) === null && WW.sanitizeDog({ breed: 'toString' }) === null, 'prototype keys are no breeds (no TV crash)');

  check(WW.sanitizeDog(null) === null && WW.sanitizeDog({}) === null && WW.sanitizeDog({ breed: 'katze' }) === null, 'sanitizeDog rejects garbage');
  const s = WW.sanitizeDog({
    uid: 'abc123', name: 'X'.repeat(40), breed: 'husky', coat: 1,
    needs: { food: -5, water: 500, clean: 'x', mood: 50 }, love: 12.7, coins: 1e9,
    inv: { kibble: 4, rocket: 5, treat: -3 }, toys: ['frisbee', 'laser'], finds: { gem: 2, bomb: 1 }
  });
  check(s.uid === 'abc123' && s.name.length === WW.NAME_MAX, 'sanitizeDog keeps a valid uid and caps the name');
  check(s.needs.food === 0 && s.needs.water === 100 && s.needs.clean === 60 && s.needs.energy === 60, 'sanitizeDog clamps and defaults needs');
  check(s.coins === WW.COINS_MAX && s.love === 12, 'sanitizeDog clamps coins and love');
  check(s.inv.kibble === 4 && s.inv.treat === 0 && !('rocket' in s.inv), 'sanitizeDog drops unknown/negative inventory');
  check(s.toys.join() === 'ball,frisbee', 'sanitizeDog keeps known toys and always the ball');
  check(s.finds.gem === 2 && !('bomb' in s.finds), 'sanitizeDog keeps only known finds');
  check(WW.sanitizeDog({ uid: 'NOPE!', breed: 'mops' }).uid !== 'NOPE!', 'sanitizeDog replaces an invalid uid');

  // care
  const dog = WW.newDog({ name: 'Keks', breed: 'mops' }), td = WW.newToday();
  dog.needs.food = 40;
  let r = WW.care(dog, td, 'feed', 'meat');
  check(!r.ok && dog.needs.food === 40, 'feeding meat without a can fails and changes nothing');
  r = WW.care(dog, td, 'feed', 'kibble');
  check(r.ok && r.fx === 'eat' && dog.needs.food === 75 && dog.inv.kibble === 2 && r.love === 4, 'kibble feeds (+35), uses one portion, hungry dog gives 4 love');
  dog.needs.food = 95;
  r = WW.care(dog, td, 'feed', 'kibble');
  check(!r.ok && r.fx === 'refuse' && dog.inv.kibble === 2, 'a full dog refuses food and keeps the portion');
  dog.needs.water = 30;
  r = WW.care(dog, td, 'water');
  check(r.ok && dog.needs.water === 100 && r.love === 3, 'water fills up, thirsty dog gives 3 love');
  check(!WW.care(dog, td, 'water').ok, 'no water when not thirsty');
  const fav = WW.favoriteSpot(dog), other = WW.SPOTS.find(z => z !== fav);
  check(WW.SPOTS.indexOf(fav) >= 0 && WW.favoriteSpot(dog) === fav, 'favorite spot is stable');
  r = WW.care(dog, td, 'pet', fav);
  check(r.love === 2 && /Lieblingsstelle/.test(r.text), 'petting the favorite spot: 2 love and a one-time hint');
  const again = WW.care(dog, td, 'pet', fav);
  check(again.text === null, 'the favorite-spot hint shows once per day');
  let petLove = r.love + again.love;
  for (let i = 0; i < 30; i++) petLove += WW.care(dog, td, 'pet', other).love;
  check(petLove === WW.LOVE_CAPS.pet, 'petting love is capped per day (' + WW.LOVE_CAPS.pet + ')');
  dog.needs.clean = 20; dog.inv.shampoo = 0;
  check(!WW.care(dog, td, 'bathStart').ok && !WW.care(dog, td, 'bath').ok && dog.needs.clean === 20, 'no bath without shampoo');
  dog.inv.shampoo = 1;
  r = WW.care(dog, td, 'bath');
  check(r.ok && r.fx === 'shake' && dog.needs.clean === 100 && dog.inv.shampoo === 0 && r.love === 6, 'bath: clean 100, uses shampoo, dirty dog gives 6 love');
  check(WW.care(dog, td, 'dance').ok === false, 'unknown care acts are rejected');

  // shop
  const b = WW.newDog({ breed: 'pudel' });
  check(!WW.buy(b, 'frisbee').ok && b.coins === 30, 'frisbee (35) is too expensive for the starter coins');
  check(WW.buy(b, 'duck').ok && b.coins === 10 && b.toys.indexOf('duck') >= 0, 'buying a toy');
  check(!WW.buy(b, 'duck').ok, 'a toy can only be bought once');
  check(WW.buy(b, 'kibble').ok && b.inv.kibble === 4 && b.coins === 6, 'buying a consumable');
  check(!WW.buy(b, 'crown').ok && !WW.buy(b, 'nope').ok, 'finds and unknown items are not for sale');
  const tdb = WW.newToday();
  check(!WW.sell(b, 'gem', tdb).ok, 'cannot sell what you do not have');
  b.finds.gem = 1;
  r = WW.sell(b, 'gem', tdb);
  check(r.ok && b.coins === 31 && !('gem' in b.finds) && tdb.coins === 25, 'selling a find pays out and counts for today');

  // finds
  const rng = WW.rng(42), f = WW.newDog({ breed: 'corgi' }), tdf = WW.newToday();
  r = WW.giveFind(f, tdf, 'coin', rng);
  check(r.item === 'coin' && r.coins >= 4 && r.coins <= 12 && f.coins === 30 + r.coins, 'coin finds pay 4–12 Taler');
  r = WW.giveFind(f, tdf, 'stick', rng);
  check(f.toys.indexOf('stick') >= 0 && r.coins === 0, 'a found stick becomes a toy');
  r = WW.giveFind(f, tdf, 'stick', rng);
  check(r.coins === 2, 'a second stick is traded for 2 Taler');
  WW.giveFind(f, tdf, 'shoe', rng);
  check(f.finds.shoe === 1 && f.stats.finds === 4 && tdf.finds.join() === 'stick,shoe', 'finds land in the bag and today\'s list');
  const counts = {};
  for (let i = 0; i < 4000; i++) { const k = WW.rollFind(rng); counts[k] = (counts[k] || 0) + 1; }
  check(Object.keys(counts).every(k => WW.ITEMS[k]) && counts.coin > counts.sock && counts.sock > (counts.crown || 0), 'loot table rolls valid items with sane weights');

  // decay + misc
  const n = WW.newDog({ breed: 'labrador' });
  n.needs = { food: 50, water: 50, clean: 50, mood: 50, energy: 50 };
  WW.decay(n, 60, 'home');
  check(Math.abs(n.needs.food - 43) < 1e-9 && Math.abs(n.needs.energy - 56) < 1e-9 && Math.abs(n.needs.mood - 49) < 1e-9, 'one minute at home decays by the home rates');
  n.needs = { food: 10, water: 10, clean: 50, mood: 50, energy: 50 };
  WW.decay(n, 60, 'home');
  check(Math.abs(n.needs.mood - (50 - 1 - 2 * WW.LOW_MOOD_DRAIN)) < 1e-9, 'low food and water drain mood');
  check(WW.loveLevel(0) === 0 && WW.loveLevel(25) === 1 && WW.loveLevel(449) === 4 && WW.loveLevel(9999) === 5, 'love levels');
  n.needs.energy = 0;
  check(WW.speedFactor(n) === 0.5 && WW.isTired(n), 'exhausted dogs are slow and tired');
})();

// ---------- backbone protocol with raw bus phones ----------
const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
function phone(label) {
  const p = { label, id: null, inbox: [] };
  bus.register(label, { deliver: (m) => {
    if (m.type === 'welcome') p.id = m.device_id;
    if (m.type === 'message') p.inbox.push(m.data);
  } });
  bus.fromClient(label, JSON.stringify({ type: 'register', role: 'controller' }));
  p.send = (data) => bus.fromClient(label, JSON.stringify({ type: 'message', to: 0, data }));
  p.last = (t) => p.inbox.filter(m => m.t === t).pop();
  p.all = (t) => p.inbox.filter(m => m.t === t);
  return p;
}
const dbg = () => screen.window.eval('active && active._debug()');

(async () => {
  await sleep(100);
  const p1 = phone('p1'), p2 = phone('p2');
  p1.send({ t: 'shellName', name: 'Anna' });
  p2.send({ t: 'shellName', name: 'Ben' });
  p1.send({ t: 'shellSelect', game: 'wauwauwg' });
  p1.send({ t: 'shellStart' });
  check(p1.inbox.some(m => m.t === 'shell' && m.cmd === 'enterGame' && m.game === 'wauwauwg'), 'host starts Wauwau-WG');
  check(dbg().phase === 'home' && dbg().day === 1, 'the day starts at home');

  p1.send({ t: 'wwHello', dog: null });
  check(p1.last('wwAdopt') && p1.last('wwAdopt').backup === null, 'a phone without a dog is sent to the Tierheim');
  p1.send({ t: 'wwAdoptDone', name: 'Krümel', breed: 'dackel', coat: 1 });
  const you1 = p1.last('wwYou');
  check(you1 && you1.dog.name === 'Krümel' && you1.dog.coat === 1 && you1.dog.coins === 30, 'adoption creates the dog with the starter kit');
  check(p1.last('wwPhase').phase === 'home' && p1.last('wwPhase').host === true, 'wwPhase tells the phone the phase and host flag');

  const saved = WW.newDog({ name: 'Balu', breed: 'husky', coat: 2 });
  saved.uid = 'balu000001'; saved.coins = 77; saved.needs.food = 999; saved.inv.rocket = 3;
  p2.send({ t: 'wwHello', dog: saved });
  const you2 = p2.last('wwYou');
  check(you2 && you2.dog.uid === 'balu000001' && you2.dog.coins === 77 && you2.dog.needs.food === 100 && !you2.dog.inv.rocket, 'a returning dog is sanitized and keeps its uid');
  check(p2.last('wwPhase').host === false, 'guests are not host');

  // care + shop
  p1.send({ t: 'wwCare', act: 'feed', item: 'kibble' });
  check(p1.last('wwYou').dog.inv.kibble === 2 && p1.last('wwYou').today.love === 1, 'feeding is applied by the screen and answered at once');
  p1.send({ t: 'wwBuy', item: 'frisbee' });
  check(p1.last('wwEvent').kind === 'bad' && /Zu wenig/.test(p1.last('wwEvent').text), 'buying without enough Taler fails with a toast');
  p1.send({ t: 'wwBuy', item: 'treat' });
  check(p1.last('wwEvent').kind === 'good' && p1.last('wwYou').dog.inv.treat === 4, 'buying a treat works');
  p1.send({ t: 'wwCare', act: 'teleport' });
  p1.send({ t: 'wwBuy', item: { evil: true } });
  p1.send({ t: 'wwThrow', toy: 'ball', dx: 0, dy: -1, power: 1 });
  check(true, 'junk messages do not crash the screen');

  // day → night: Hund des Tages, scoreboard, next day
  p1.send({ t: 'wwCare', act: 'treat' });
  p1.send({ t: 'wwCare', act: 'treat' });                // Krümel: 1 + 2 + 2 love today
  p2.send({ t: 'wwCare', act: 'pet', zone: 'head' });   // Balu: at most 2
  p2.send({ t: 'wwNext' });
  check(dbg().phase === 'home', 'wwNext outside the night is ignored');
  dbg().jump('walk');
  check(p1.last('wwPhase').phase === 'walk', 'phase changes reach the phones');
  p1.send({ t: 'wwBuy', item: 'treat' });
  check(/nur morgens und abends/.test(p1.last('wwEvent').text), 'the shop is closed during the walk');
  dbg().jump('night');
  const night1 = p1.last('wwNight');
  check(night1 && night1.rows.length === 2 && night1.rows[0].dog === 'Krümel' && night1.rows[0].best && night1.rows[0].you, 'night summary ranks by love today and marks the best dog');
  const score = screen.window.eval('nightScore');
  check(score[p1.id] && score[p1.id].pts === 1 && !score[p2.id], 'Hund des Tages counts for the evening scoreboard');
  p2.send({ t: 'wwNext' });
  check(dbg().phase === 'night', 'only the host starts the next day');
  dbg().night.at = -10;
  p1.send({ t: 'wwNext' });
  check(dbg().phase === 'home' && dbg().day === 2 && p1.last('wwPhase').day === 2, 'host starts day 2');
  check(p1.last('wwYou').dog.days === 1 && p1.last('wwYou').today.love === 0, 'a lived day is counted and today resets');

  // backup memory: Ben leaves, comes back on a new phone without localStorage
  p2.send({ t: 'wwBuy', item: 'treat' });               // a change after the night's backup
  const baluLast = JSON.parse(JSON.stringify(dbg().dogs[p2.id]));
  bus.disconnect('p2');
  await sleep(20);
  const p3 = phone('p3');
  p3.send({ t: 'shellName', name: 'Ben' });
  check(p3.inbox.some(m => m.t === 'shell' && m.cmd === 'enterGame'), 'a late joiner enters the running WG');
  p3.send({ t: 'wwHello', dog: null });
  const offer = p3.last('wwAdopt');
  check(offer && offer.backup && offer.backup.name === 'Balu', 'the TV offers Ben his dog back from its backup');
  p3.send({ t: 'wwRestore' });
  check(p3.last('wwYou') && p3.last('wwYou').dog.uid === 'balu000001', 'restoring brings back the same dog');
  check(p3.last('wwYou').dog.coins === baluLast.coins && p3.last('wwYou').dog.inv.treat === baluLast.inv.treat, 'the backup taken when the phone dropped has the latest state');
  check(p3.last('wwYou').slot === 'ben', 'wwYou names the phone storage slot after the owner');

  // move out
  p3.send({ t: 'wwMoveOut' });
  check(p3.last('wwAdopt') && p3.last('wwAdopt').backup === null && !dbg().dogs[p3.id], 'moving out frees the seat for a new adoption');

  // last player leaves → lobby
  bus.disconnect('p1'); bus.disconnect('p3');
  await sleep(20);
  check(!screen.window.eval('active'), 'an empty WG returns to the lobby');

  console.log(process.exitCode ? '❌ Test fehlgeschlagen' : '✅ Alle Checks bestanden');
  process.exit(process.exitCode || 0);
})();
