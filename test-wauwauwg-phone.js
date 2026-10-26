// Wauwau-WG phone, end to end through the real UI: real screen.html + controller.html
// pages in JSDOM on the in-process bus. Everything a player does is a synthetic tap /
// touch / mouse gesture on the phone's DOM; the checks look at what the TV received
// (recorded by wrapping the screen's active.onMessage), at the TV's authoritative dog
// record, and at what the phone shows. Scene internals (walk.js / park.js / home.js)
// are never read — the TV is only steered through the backbone (jump, api.send).
const { makeDom, makeBus, visible } = require('./test-helpers');

function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function check(cond, msg) { if (cond) console.log('✓ ' + msg); else fail(msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(cond, ms, step) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 2500)) { if (cond()) return true; await sleep(step || 15); }
  return !!cond();
}

const bus = makeBus();
const screen = makeDom('screen.html', 'screen', bus, 'screen');
// the shell's wake-lock fallback plays a hidden <video> on the first gesture; JSDOM cannot
const quiet = (d) => { d.window.HTMLMediaElement.prototype.play = () => Promise.resolve(); return d; };
const phone = (label, opts) => quiet(makeDom('controller.html', 'controller', bus, label, opts));
const c1 = phone('c1');   // Anna, host
const c2 = phone('c2');   // Ben

// ---------- helpers: DOM, TV state, recording ----------
const doc = (d) => d.window.document;
const el = (d, id) => doc(d).getElementById(id);
const txt = (d, id) => el(d, id).textContent;
const open = (d, id) => el(d, id).classList.contains('open');
const has = (d, id, cls) => el(d, id).classList.contains(cls);
const idOf = (label) => bus.handlers[label]._id;
const dbg = () => screen.window.eval('active && active._debug()');
const dogOf = (label) => dbg().dogs[idOf(label)];
// The phone stores its dog in a per-name slot named by the TV (desktop tabs share localStorage).
const slotKey = (d) => { let s = ''; try { s = d.window.sessionStorage.getItem('wauwauwg.slot') || ''; } catch (e) {} return s ? 'wauwauwg.dog.' + s : 'wauwauwg.dog'; };
const stored = (d) => { try { return JSON.parse(d.window.localStorage.getItem(slotKey(d))); } catch (e) { return null; } };
const toasts = (d) => [...doc(d).querySelectorAll('#wwToasts .ww-toast')].map(t => t.textContent);
const simWait = async (s) => { const t0 = dbg().simT; await until(() => dbg().simT >= t0 + s, 8000); };
function attempt(msg, fn) { try { fn(); return true; } catch (e) { fail(msg + ' — ' + e.message); return false; } }

// Every message the TV's game instance receives, in order (recorded in the screen's realm).
function record() {
  screen.window.eval(`window.__rec = []; window.__block = {};
    window.__wrap = function (a) {
      var o = a.onMessage;
      a.onMessage = function (id, d) {
        try { window.__rec.push({ id: id, d: JSON.parse(JSON.stringify(d)) }); } catch (e) {}
        if (d && window.__block[d.t]) return;          // blockTv(): the message is "lost"
        return o.call(a, id, d);
      };
      return a;
    };
    window.__wrap(active);
    (function () { var f = GAMES.wauwauwg; GAMES.wauwauwg = function () { return window.__wrap(f()); }; })();   // later rounds too`);
}
const rec = () => Array.from(screen.window.__rec);
const clearRec = () => { screen.window.__rec.length = 0; };
const blockTv = (type, on) => { screen.window.__block[type] = !!on; };
const got = (label, type) => rec().filter(m => m.id === idOf(label) && m.d.t === type).map(m => m.d);

// ---------- helpers: gestures (JSDOM has no layout: client coords == canvas coords) ----------
function touchEv(d, target, type, x, y, tid, others) {
  const w = d.window, e = new w.Event(type, { bubbles: true, cancelable: true });
  const pt = [{ identifier: tid || 1, clientX: x, clientY: y }];
  Object.defineProperty(e, 'changedTouches', { value: pt });
  Object.defineProperty(e, 'touches', { value: (others || []).concat(type === 'touchend' || type === 'touchcancel' ? [] : pt) });
  target.dispatchEvent(e);
  return e;
}
function mouseEv(d, target, type, x, y) {
  const w = d.window, e = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  (type === 'mousedown' ? target : w).dispatchEvent(e);   // the pads listen on window for move/up
  return e;
}
// Drags along pts; gap = ms between points (0 = one synchronous burst). Returns the touchstart/mousedown event.
async function drag(d, target, pts, o) {
  o = o || {};
  const touch = o.via !== 'mouse', ev = (t, p) => touch ? touchEv(d, target, 'touch' + t, p[0], p[1], o.tid) : mouseEv(d, target, 'mouse' + (t === 'start' ? 'down' : t === 'move' ? 'move' : 'up'), p[0], p[1]);
  const first = ev('start', pts[0]);
  for (let i = 1; i < pts.length; i++) { if (o.gap) await sleep(o.gap); ev('move', pts[i]); }
  if (o.hold) return first;                                  // finger stays down
  if (o.cancel && touch) touchEv(d, target, 'touchcancel', 0, 0, o.tid); else ev('end', pts[pts.length - 1]);
  return first;
}
const line = (a, b, step) => { const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)), r = []; for (let i = 0; i <= n; i++) r.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); return r; };

// Longest straight run (horizontal or vertical) inside one portrait zone, or any zone → a rub path.
function zoneRun(d, zone) {
  const P = d.window.__wwPhone, L = P.home.L, dog = P.S.dog, art = d.window.WW.art, STEP = 3;
  const hit = (x, y) => { const z = art.portraitZone(dog, L.size, x - L.cx, y - L.cy); return zone ? z === zone : !!z; };
  const lo = -0.6 * L.size, hi = 0.6 * L.size;
  let best = null;
  const consider = (a, b) => { if (!best || Math.hypot(b[0] - a[0], b[1] - a[1]) > Math.hypot(best.b[0] - best.a[0], best.b[1] - best.a[1])) best = { a, b }; };
  for (let u = lo; u <= hi; u += STEP) {
    let h = null, v = null;
    for (let w = lo; w <= hi; w += STEP) {
      if (hit(L.cx + w, L.cy + u)) { h = h ? [h[0], [L.cx + w, L.cy + u]] : [[L.cx + w, L.cy + u], [L.cx + w, L.cy + u]]; consider(h[0], h[1]); } else h = null;
      if (hit(L.cx + u, L.cy + w)) { v = v ? [v[0], [L.cx + u, L.cy + w]] : [[L.cx + u, L.cy + w], [L.cx + u, L.cy + w]]; consider(v[0], v[1]); } else v = null;
    }
  }
  return best;
}
// Back and forth along the run until the path is at least minLen px long.
function rubPath(run, minLen) {
  const len = Math.max(Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]), 3), passes = Math.ceil(minLen / len), pts = [];
  for (let k = 0; k < passes; k++) pts.push(...(k % 2 ? line(run.b, run.a, 4) : line(run.a, run.b, 4)));
  return pts;
}
// A raster sweep over the dog (for the bath mini-game).
function sweepPath(d) {
  const L = d.window.__wwPhone.home.L, pts = [];
  let k = 0;
  for (let y = L.cy - L.size * 0.46; y <= L.cy + L.size * 0.2; y += 10, k++) {
    const a = L.cx - L.size * 0.4, b = L.cx + L.size * 0.4;
    pts.push(...(k % 2 ? line([b, y], [a, y], 8) : line([a, y], [b, y], 8)));
  }
  return pts;
}

(async () => {
  await sleep(150);

  // ================= join, pick the game, start =================
  for (const [d, name] of [[c1, 'Anna'], [c2, 'Ben']]) { el(d, 'nameInput').value = name; el(d, 'joinBtn').click(); }
  await sleep(80);
  const pick = [...doc(c1).querySelectorAll('#gamePicker button')].find(b => b.textContent === '🐶 Wauwau-WG');
  check(!!pick, 'the host finds 🐶 Wauwau-WG in the game picker');
  pick.click();
  await sleep(50);
  check([...doc(c1).querySelectorAll('#gamePicker .sel')].map(b => b.textContent).join() === '🐶 Wauwau-WG', 'the picker marks Wauwau-WG as selected');
  el(c1, 'startBtn').click();
  await sleep(150);
  check(dbg() && dbg().phase === 'home' && dbg().day === 1, 'the TV runs day 1 at home');
  check(visible(c1) === 'v-ww-adopt' && visible(c2) === 'v-ww-adopt', 'both phones show the Tierheim');
  record();

  // ================= Tierheim: browse, name, adopt =================
  const WW = c1.window.WW, keys = WW.BREED_KEYS, B = WW.BREEDS;
  check(el(c1, 'wwBreedDots').children.length === keys.length && el(c1, 'wwBreedDots').querySelectorAll('.on').length === 1, 'the Tierheim shows one dot per breed, one active');
  check(txt(c1, 'wwBreedName') === B[keys[0]].label && [...el(c1, 'wwCoats').children].filter(b => b.style.display !== 'none').length === 3, 'it starts at the first breed with 3 coats');
  check(WW.NAME_IDEAS.indexOf(el(c1, 'wwNameInput').value) >= 0, 'the name field is pre-filled with a name idea');
  el(c1, 'wwBreedPrev').click();
  check(txt(c1, 'wwBreedName') === B[keys[keys.length - 1]].label, '◀ wraps around to the last breed');
  el(c1, 'wwBreedNext').click(); el(c1, 'wwBreedNext').click();
  check(txt(c1, 'wwBreedName') === B[keys[1]].label, '▶ steps to the next breed (Labrador)');
  el(c1, 'wwCoats').children[2].click();
  check(el(c1, 'wwCoats').children[2].classList.contains('sel') && txt(c1, 'wwCoatName').indexOf(B[keys[1]].coats[2].label) === 0, 'tapping a coat swatch selects it');
  el(c1, 'wwCoats').children[1].click();
  el(c1, 'wwNameInput').value = '  Krümel ';
  el(c1, 'wwNameInput').dispatchEvent(new c1.window.Event('input', { bubbles: true }));
  check(txt(c1, 'wwAdoptBtn') === '🐾 Krümel adoptieren!', 'the adopt button carries the typed name');
  el(c1, 'wwNameInput').value = ' Krümel ';          // padded, as typed on a phone: the dice must still not repeat it
  for (let i = 0; i < 25; i++) {
    el(c1, 'wwNameDice').click();
    if (WW.NAME_IDEAS.indexOf(el(c1, 'wwNameInput').value) < 0 || el(c1, 'wwNameInput').value === 'Krümel') { fail('🎲 rolled "' + el(c1, 'wwNameInput').value + '"'); break; }
    el(c1, 'wwNameInput').value = ' Krümel ';
  }
  check(true, '🎲 always rolls a name idea other than the current one (25 rolls)');
  el(c1, 'wwNameInput').value = 'Krümel';
  el(c1, 'wwNameInput').dispatchEvent(new c1.window.Event('input', { bubbles: true }));

  // Ben: a swipe on the portrait browses (touch), a tap pets the dog without browsing
  const nameBefore = txt(c2, 'wwBreedName');
  await drag(c2, el(c2, 'wwAdoptCanvas'), [[260, 150], [200, 152], [110, 150]], { gap: 5 });
  check(txt(c2, 'wwBreedName') !== nameBefore && txt(c2, 'wwBreedName') === B[keys[1]].label, 'swiping left on the portrait shows the next breed');
  await drag(c2, el(c2, 'wwAdoptCanvas'), [[150, 150], [152, 151]], { via: 'mouse' });
  check(txt(c2, 'wwBreedName') === B[keys[1]].label, 'a plain tap on the portrait does not change the breed');

  clearRec();
  blockTv('wwAdoptDone', true);                     // the answer is "on the wire"
  el(c1, 'wwAdoptBtn').click(); el(c1, 'wwAdoptBtn').click();
  const adopt1 = got('c1', 'wwAdoptDone');
  check(adopt1.length === 1 && adopt1[0].name === 'Krümel' && adopt1[0].breed === keys[1] && adopt1[0].coat === 1, 'adopting sends name, breed and coat — once, even on a double tap');
  check(el(c1, 'wwAdoptBtn').disabled && visible(c1) === 'v-ww-adopt', 'the button locks while the TV has not answered');
  await sleep(3150);
  check(!el(c1, 'wwAdoptBtn').disabled, 'it unlocks again when the TV stays silent, so the player can retry');
  blockTv('wwAdoptDone', false);
  el(c1, 'wwAdoptBtn').click();
  check(got('c1', 'wwAdoptDone').length === 2, 'the retry goes through');
  const krum = dogOf('c1');
  check(krum && krum.name === 'Krümel' && krum.breed === keys[1] && krum.coat === 1 && krum.coins === 30, 'the TV created Krümel with the starter kit');
  check(visible(c1) === 'v-ww-home' && txt(c1, 'wwHomeName') === 'Krümel' && txt(c1, 'wwCoins') === '🪙 30', 'the phone moved into the home view with name and Taler');
  check(toasts(c1).some(t => /Willkommen zuhause, Krümel/.test(t)), 'a welcome toast greets the new dog');
  check(stored(c1) && stored(c1).uid === krum.uid && stored(c1).name === 'Krümel', 'localStorage holds the dog after the first wwYou');
  check(slotKey(c1) === 'wauwauwg.dog.anna', 'the TV-named slot is the owner name (wauwauwg.dog.anna)');
  check(visible(c2) === 'v-ww-adopt', 'Ben is still in the Tierheim');
  const benName = el(c2, 'wwNameInput').value;
  el(c2, 'wwAdoptBtn').click();
  const ben = dogOf('c2');
  check(ben && ben.name === benName && ben.breed === keys[1], 'Ben adopted the dog he was looking at, under the suggested name');
  const benUid = ben.uid, benJson = c2.window.localStorage.getItem(slotKey(c2));
  check(benJson && JSON.parse(benJson).uid === benUid, "Ben's phone stored his dog");

  // ================= home: status, care gestures =================
  await until(() => c1.window.__wwPhone.home.L);
  check(el(c1, 'wwNeeds').children.length === 5 && el(c1, 'wwNeeds').children[0].querySelector('i').style.width === '80%', 'five need bars show the dog\'s needs');
  check(/^Tag 1 · ☀️ Morgen in der WG · \d+:\d\d$/.test(txt(c1, 'wwPhaseLine')), 'the sub line shows day, phase and the countdown');
  const badge = (k) => el(c1, 'wwTool-' + k).querySelector('.ww-badge').textContent;
  check(badge('feed') === '3' && badge('treat') === '3' && badge('bath') === '2', 'tool badges count food, treats and shampoo');

  // treat
  clearRec();
  el(c1, 'wwTool-treat').click();
  check(got('c1', 'wwCare').length === 1 && got('c1', 'wwCare')[0].act === 'treat', 'the 🍪 tool sends wwCare treat');
  check(dogOf('c1').inv.treat === 2 && dogOf('c1').needs.mood > 75 && badge('treat') === '2', 'the TV used up a treat, the dog is happier, the badge follows');

  // feeding: picker, empty can, kibble, full dog
  clearRec();
  el(c1, 'wwTool-feed').click();
  check(open(c1, 'wwFeedPick') && el(c1, 'wwFeed-kibble').querySelector('small').textContent === '× 3' && has(c1, 'wwFeed-meat', 'empty'), 'the 🥣 tool opens the food picker (kibble ×3, can empty)');
  el(c1, 'wwFeed-meat').click();
  check(got('c1', 'wwCare').length === 0 && toasts(c1).some(t => /Fleischdose/.test(t)) && !open(c1, 'wwFeedPick'), 'an empty can is refused on the phone with a toast, nothing is sent');
  el(c1, 'wwTool-feed').click(); el(c1, 'wwFeed-kibble').click();
  check(got('c1', 'wwCare').some(m => m.act === 'feed' && m.item === 'kibble') && dogOf('c1').inv.kibble === 2 && dogOf('c1').needs.food === 100, 'feeding kibble sends wwCare feed and fills the bowl on the TV');
  el(c1, 'wwTool-feed').click(); el(c1, 'wwFeed-kibble').click();
  check(dogOf('c1').inv.kibble === 2 && toasts(c1).some(t => /satt/.test(t)), 'a full dog refuses the second portion and keeps it');

  // water
  el(c1, 'wwTool-water').click();
  check(dogOf('c1').needs.water === 100, '💧 refills the water bowl');
  el(c1, 'wwTool-water').click();
  check(toasts(c1).some(t => /keinen Durst/.test(t)), 'a second water tap is refused by the TV ("hat keinen Durst")');

  // petting: rub the favorite spot with a real mouse drag
  const fav = WW.favoriteSpot(dogOf('c1'));
  const favRun = zoneRun(c1, fav);
  check(!!favRun, 'the portrait offers a petting zone for the favorite spot (' + fav + ')');
  let love0 = dogOf('c1').love;
  clearRec();
  const flood = rubPath(favRun, 600);
  await drag(c1, el(c1, 'wwHomeCanvas'), flood, { via: 'mouse' });
  const pets = got('c1', 'wwCare').filter(m => m.act === 'pet');
  check(pets.length === 1 && pets[0].zone === fav, 'a long burst of rubbing sends exactly one counted stroke, tagged with the zone (' + fav + ')');
  check(dogOf('c1').love === love0 + 2 && toasts(c1).some(t => /Lieblingsstelle/.test(t)), 'rubbing the favorite spot (' + fav + ') earns 2 love and the "Lieblingsstelle" hint');
  const bagLove = () => { const s = [...el(c1, 'wwBagBody').querySelectorAll('.ww-stat')].find(x => /Zuneigung/.test(x.textContent)); return s && s.querySelector('b').textContent; };
  el(c1, 'wwBagBtn').click();
  check(bagLove() === '❤️ ' + dogOf('c1').love, 'the bag shows the dog\'s love');
  el(c1, 'wwBag').querySelector('.ww-close').click();
  await simWait(0.4); await sleep(280);
  await drag(c1, el(c1, 'wwHomeCanvas'), rubPath(favRun, 300), { via: 'touch', gap: 0 });
  check(got('c1', 'wwCare').filter(m => m.act === 'pet').length === 2 && dogOf('c1').love === love0 + 4, 'a second stroke after the gap counts again (touch path)');
  el(c1, 'wwBagBtn').click();
  check(bagLove() === '❤️ ' + dogOf('c1').love, 'petting alone updates the bag\'s love figure');
  el(c1, 'wwBag').querySelector('.ww-close').click();

  // brushing
  el(c1, 'wwTool-brush').click();
  check(has(c1, 'wwTool-brush', 'sel') && !has(c1, 'wwTool-pet', 'sel'), 'the brush tool gets selected');
  const anyRun = zoneRun(c1, null);
  await simWait(0.3); await sleep(280);
  love0 = dogOf('c1').love;
  clearRec();
  await drag(c1, el(c1, 'wwHomeCanvas'), rubPath(anyRun, 300), { via: 'mouse' });
  check(got('c1', 'wwCare').some(m => m.act === 'brush') && dogOf('c1').love === love0 + 1, 'brushing sends wwCare brush and earns a bit of love');
  el(c1, 'wwTool-pet').click();

  // bath: cancel, then the three-step mini-game with real scrubbing
  clearRec();
  el(c1, 'wwTool-bath').click();
  check(has(c1, 'wwBathBar', 'open') && got('c1', 'wwCare').some(m => m.act === 'bathStart') && /Einschäumen/.test(txt(c1, 'wwBathStep')), 'the 🛁 tool starts the bath (bar shows step 1)');
  el(c1, 'wwTool-treat').click();
  check(!got('c1', 'wwCare').some(m => m.act === 'treat'), 'the other tools are locked during the bath');
  el(c1, 'wwBathCancel').click();
  check(!has(c1, 'wwBathBar', 'open') && got('c1', 'wwCare').some(m => m.act === 'bathCancel') && dogOf('c1').inv.shampoo === 2, 'cancelling the bath costs no shampoo');
  clearRec();
  el(c1, 'wwTool-bath').click();
  const P1 = c1.window.__wwPhone;
  await sleep(40);
  const sw = sweepPath(c1);
  let step = 0, sweeps = 0;
  for (; sweeps < 8 && P1.home.bath; sweeps++) { await drag(c1, el(c1, 'wwHomeCanvas'), sw, { via: sweeps % 2 ? 'touch' : 'mouse' }); if (P1.home.bath && P1.home.bath.step > step) step = P1.home.bath.step; }
  check(!P1.home.bath && step >= 2 && sweeps <= 5, 'scrubbing foam → rinse → towel completes the bath in ' + sweeps + ' sweeps');
  const bath = got('c1', 'wwCare').filter(m => m.act === 'bath');
  check(bath.length === 1 && dogOf('c1').inv.shampoo === 1 && dogOf('c1').needs.clean === 100 && dogOf('c1').stats.baths === 1, 'the finished bath uses one shampoo and makes the dog clean');
  check(!has(c1, 'wwBathBar', 'open') && !has(c1, 'wwTool-pet', 'off'), 'the tools come back after the bath');

  // ================= shop & bag =================
  el(c1, 'wwShopBtn').click();
  check(open(c1, 'wwShop') && open(c1, 'wwDim') && el(c1, 'wwShopList').querySelectorAll('.ww-item').length === WW.SHOP.length, 'the 🛒 sheet lists every shop item');
  const price = (k) => el(c1, 'wwShopList').querySelector('.ww-price[data-item="' + k + '"]');
  check(price('frisbee').classList.contains('poor') && /35/.test(price('frisbee').textContent) && !price('duck').classList.contains('poor'), 'the shop greys out what the dog cannot afford');
  clearRec();
  price('duck').click();
  check(got('c1', 'wwBuy').length === 1 && got('c1', 'wwBuy')[0].item === 'duck', 'buying the duck sends wwBuy');
  check(dogOf('c1').coins === 10 && dogOf('c1').toys.indexOf('duck') >= 0 && txt(c1, 'wwCoins') === '🪙 10' && txt(c1, 'wwShopCoins') === '🪙 10', 'the TV charged 20 Taler and the duck is in the dog\'s toys');
  check(price('duck').classList.contains('owned') && /Hast du/.test(price('duck').textContent), 'the shop marks the duck as owned');
  price('duck').click();
  check(got('c1', 'wwBuy').length === 1 && toasts(c1).some(t => /hast du schon/.test(t)), 'tapping an owned toy only toasts');
  price('frisbee').click();
  check(dogOf('c1').coins === 10 && !dogOf('c1').toys.includes('frisbee') && toasts(c1).some(t => /Zu wenig Taler/.test(t)), 'a purchase the dog cannot afford fails with the TV\'s toast');
  price('kibble').click();
  check(dogOf('c1').coins === 6 && dogOf('c1').inv.kibble === 3 && /im Schrank: 3/.test(el(c1, 'wwShopList').querySelector('.ww-item[data-item="kibble"] .ww-tx span').textContent), 'a consumable lands in the cupboard');
  el(c1, 'wwShop').querySelector('.ww-close').click();
  check(!open(c1, 'wwShop') && !open(c1, 'wwDim'), 'the ✕ closes the sheet');
  el(c1, 'wwShopBtn').click(); el(c1, 'wwDim').click();
  check(!open(c1, 'wwShop'), 'tapping the dimmed background closes it as well');

  // bag: a walk find can be sold
  el(c1, 'wwBagBtn').click();
  check(open(c1, 'wwBag') && /Tennisball/.test(txt(c1, 'wwBagBody')) && /Quietsche-Ente/.test(txt(c1, 'wwBagBody')) && /Trockenfutter × 3/.test(txt(c1, 'wwBagBody')), 'the 🎒 sheet lists supplies and toys');
  attempt('api.find', () => dbg().api.find(idOf('c1'), 'sock'));
  await until(() => el(c1, 'wwBagBody').querySelector('.ww-price.sell[data-item="sock"]'), 3000);
  const sell = el(c1, 'wwBagBody').querySelector('.ww-price.sell[data-item="sock"]');
  check(!!sell && /Einzelne Socke/.test(txt(c1, 'wwBagBody')), 'a find appears in the bag with a sell button');
  if (sell) {
    const coins0 = dogOf('c1').coins;
    clearRec();
    sell.click();
    check(got('c1', 'wwSell').length === 1 && dogOf('c1').coins === coins0 + 2 && !dogOf('c1').finds.sock, 'selling the sock sends wwSell and pays 2 Taler');
    check(!el(c1, 'wwBagBody').querySelector('.ww-price.sell[data-item="sock"]'), 'the sold find leaves the bag');
  }
  el(c1, 'wwBag').querySelector('.ww-close').click();

  // hundepass
  el(c1, 'wwMenuBtn').click();
  check(open(c1, 'wwMenu') && txt(c1, 'wwPassName') === 'Krümel' && /Labrador/.test(txt(c1, 'wwPassBreed')) && /Zuneigung/.test(txt(c1, 'wwPassToday')), 'the ☰ Hundepass shows name, breed and today\'s stats');
  el(c1, 'wwMenu').querySelector('.ww-close').click();

  // persistence follows the TV's record
  await until(() => stored(c1) && stored(c1).coins === dogOf('c1').coins && stored(c1).inv.kibble === 3, 3000);
  check(stored(c1) && stored(c1).coins === dogOf('c1').coins && stored(c1).toys.includes('duck') && stored(c1).stats.baths === 1, 'localStorage keeps up with every wwYou (coins, toys, stats)');

  // ================= a returning phone brings its dog back =================
  const benStored = c2.window.localStorage.getItem(slotKey(c2));
  bus.disconnect('c2');
  await sleep(60);
  check(!dbg().dogs[idOf('c2')], 'when Ben\'s phone drops, his dog leaves the TV');
  const c3 = phone('c3', { seedLocal: { 'wauwauwg.dog': benStored, playerName: 'Ben' } });   // pre-slot record → migrates
  await sleep(150);
  el(c3, 'joinBtn').click();
  await sleep(100);
  check(dogOf('c3') && dogOf('c3').uid === benUid, 'a new phone with the stored record brings the same dog back (same uid on the TV)');
  check(visible(c3) === 'v-ww-home' && txt(c3, 'wwHomeName') === ben.name, 'it goes straight home — no Tierheim');
  check(stored(c3) && stored(c3).uid === benUid, 'and keeps it in its own localStorage');
  check(slotKey(c3) === 'wauwauwg.dog.ben' && c3.window.localStorage.getItem('wauwauwg.dog') === null, 'a pre-slot record migrates into the name slot');

  // the TV remembers by name: a phone without a record is offered the dog
  bus.disconnect('c3');
  await sleep(60);
  const c4 = phone('c4');
  await sleep(150);
  el(c4, 'nameInput').value = 'Ben'; el(c4, 'joinBtn').click();
  await sleep(100);
  check(visible(c4) === 'v-ww-adopt' && open(c4, 'wwRestoreCard') && txt(c4, 'wwRestoreText').indexOf(ben.name) >= 0, 'a phone without a dog is offered its backup dog by the TV');
  el(c4, 'wwRestoreNo').click();
  check(!open(c4, 'wwRestoreCard') && visible(c4) === 'v-ww-adopt', '"Nein" closes the offer and stays in the Tierheim');
  attempt('hello', () => c4.window.eval("ac.message(AirConsole.SCREEN, { t: 'wwHello', dog: null })"));
  check(open(c4, 'wwRestoreCard'), 'the offer comes back after a fresh hello');
  clearRec();
  el(c4, 'wwRestoreYes').click();
  check(got('c4', 'wwRestore').length === 1 && dogOf('c4') && dogOf('c4').uid === benUid && visible(c4) === 'v-ww-home', '"Ja" restores the dog and leaves the Tierheim');
  check(stored(c4) && stored(c4).uid === benUid, 'the restored dog is saved on the new phone');

  // ================= Gassi =================
  await simWait(0.3);
  clearRec();
  dbg().jump('walk');
  await sleep(300);
  check(visible(c1) === 'v-ww-walk' && /Gassi mit Krümel/.test(txt(c1, 'wwWalkTitle')), 'the phase change moves the phone to the walk view');
  check(/⏱ \d+:\d\d/.test(txt(c1, 'wwWalkTime')) && /Zieh am Feld/.test(txt(c1, 'wwWalkHint')), 'the walk view shows the countdown and a drag hint');
  const pad = el(c1, 'wwWalkPad');
  const dn = await drag(c1, pad, [[160, 200], [185, 190], [215, 170], [230, 155]], { gap: 70 });
  const mv = got('c1', 'wwMove');
  check(dn.defaultPrevented, 'the pad swallows the touch (no page scroll)');
  check(mv.length >= 3 && mv[0].x > 0.2 && mv[0].y < 0 && mv.every(m => Math.abs(m.x) <= 1 && Math.abs(m.y) <= 1), 'dragging up-right sends wwMove with x > 0, y < 0 (screen axes) within [-1, 1]');
  check(mv[mv.length - 1].x === 0 && mv[mv.length - 1].y === 0, 'releasing the pad sends wwMove 0,0');
  await sleep(80);
  clearRec();
  const burst = line([160, 200], [90, 150], 3);
  await drag(c1, pad, burst, { gap: 0 });
  check(got('c1', 'wwMove').length === 2 && got('c1', 'wwMove')[0].x < 0 && got('c1', 'wwMove')[1].x === 0, 'a burst of ' + burst.length + ' moves is throttled to the first move plus the release');
  // a second finger is ignored while the first one steers; lifting it does not stop the dog
  await sleep(80);
  await drag(c1, pad, [[160, 200], [185, 190]], { hold: true, tid: 1 });
  await sleep(80);
  clearRec();
  const f1 = [{ identifier: 1, clientX: 185, clientY: 190 }];
  touchEv(c1, pad, 'touchstart', 60, 60, 2, f1); touchEv(c1, pad, 'touchmove', 70, 70, 2, f1); touchEv(c1, pad, 'touchend', 70, 70, 2, f1);
  check(got('c1', 'wwMove').length === 0, 'a second finger on the leash pad is ignored');
  touchEv(c1, pad, 'touchmove', 215, 170, 1);
  touchEv(c1, pad, 'touchend', 215, 170, 1);
  check(got('c1', 'wwMove').length === 2 && got('c1', 'wwMove')[0].x > 0 && got('c1', 'wwMove')[1].x === 0, 'the first finger keeps steering and its release stops the dog');
  clearRec();
  await drag(c1, pad, [[160, 200], [160, 120]], { gap: 70, cancel: true });
  const mvc = got('c1', 'wwMove');
  check(mvc.length >= 2 && mvc[mvc.length - 1].x === 0 && mvc[mvc.length - 1].y === 0, 'a cancelled touch also stops the dog');
  // the hint state is pushed by the TV: gate the three buttons on it (injected via the backbone api)
  const tv = (label, msg) => dbg().api.send(idOf(label), msg);
  clearRec();
  tv('c1', { t: 'wwWalk', dig: 0, digP: 0, poop: 0, cat: 0 });
  el(c1, 'wwDigBtn').click(); el(c1, 'wwPoopBtn').click(); el(c1, 'wwHeelBtn').click();
  check(rec().length === 0 && toasts(c1).some(t => /Schnüffelstelle/.test(t)), 'with nothing to do, dig / poop / heel send nothing');
  tv('c1', { t: 'wwWalk', dig: 1, digP: 0.4, poop: 0, cat: 0 });
  check(has(c1, 'wwDigBtn', 'on') && el(c1, 'wwDigProg').style.width === '40%' && /buddeln/.test(txt(c1, 'wwWalkHint')), 'a smell lights up 🐾 Buddeln with progress and a hint');
  el(c1, 'wwDigBtn').click(); el(c1, 'wwDigBtn').click();
  check(got('c1', 'wwDig').length === 1, 'dig taps closer than 80 ms apart collapse into one wwDig');
  await sleep(100);
  el(c1, 'wwDigBtn').click();
  check(got('c1', 'wwDig').length === 2, 'the next tap after the gap goes through');
  tv('c1', { t: 'wwWalk', dig: 0, digP: 0, poop: 1, cat: 0 });
  check(has(c1, 'wwPoopBtn', 'on') && /aufsammeln/.test(txt(c1, 'wwWalkHint')), 'a puddle of trouble lights up 💩');
  el(c1, 'wwPoopBtn').click();
  check(got('c1', 'wwPoop').length === 1 && !has(c1, 'wwPoopBtn', 'on'), 'picking up sends wwPoop once and disarms the button');
  tv('c1', { t: 'wwWalk', dig: 0, digP: 0, poop: 0, cat: 1 });
  check(has(c1, 'wwHeelBtn', 'on') && /Katze/.test(txt(c1, 'wwWalkHint')), 'a cat lights up 🛑 Bei Fuß');
  el(c1, 'wwHeelBtn').click();
  check(got('c1', 'wwHeel').length === 1 && !has(c1, 'wwHeelBtn', 'on'), 'calling the dog back sends wwHeel once');
  attempt('find event', () => dbg().api.event(idOf('c1'), '💎 Glitzerstein gefunden!', { kind: 'find', item: 'gem', float: false }));
  check(has(c1, 'wwFindCard', 'show') && txt(c1, 'wwFindEmoji') === '💎' && el(c1, 'wwFindRare').style.display !== 'none' && !toasts(c1).some(t => /Glitzerstein/.test(t)), 'a rare find pops up as a card on the walk view');
  attempt('odd find', () => dbg().api.event(idOf('c1'), 'Etwas Seltsames', { kind: 'find', item: 'constructor', float: false }));
  check(txt(c1, 'wwFindEmoji') === '🎁' && !has(c1, 'wwFindCard', 'rare'), 'an item name like "constructor" is just an unknown item');

  // a finger still down when the phase flips must not kill the pad for the next day
  await drag(c1, pad, [[160, 200], [200, 170]], { hold: true, tid: 5 });

  // ================= Park =================
  clearRec();
  dbg().jump('park');
  await sleep(250);
  check(visible(c1) === 'v-ww-park' && /Park mit Krümel/.test(txt(c1, 'wwParkTitle')), 'the phone follows the TV to the park');
  check(/Nach oben wischen/.test(txt(c1, 'wwParkHint')), 'the park hint explains the swipe');
  const toyBtns = [...el(c1, 'wwToyPicker').children];
  check(toyBtns.map(b => b.dataset.toy).join() === 'ball,duck' && toyBtns[0].classList.contains('sel') && toyBtns.every(b => !b.disabled), 'the toy picker offers the dog\'s toys, ball selected');
  const tp = el(c1, 'wwThrowPad');
  await drag(c1, tp, [[160, 330], [161, 329]], { via: 'mouse' });
  await drag(c1, tp, [[160, 120], [170, 230], [175, 330]], { via: 'mouse', gap: 5 });
  await drag(c1, tp, [[80, 250], [150, 248], [250, 249]], { gap: 5 });
  check(got('c1', 'wwThrow').length === 0, 'a tap, a downward swipe and a sideways swipe do not throw');
  check(toasts(c1).some(t => /Nach oben wischen/.test(t)), 'a wrong swipe explains itself with a toast');
  toyBtns[1].click();
  check(toyBtns[1].classList.contains('sel') && !toyBtns[0].classList.contains('sel'), 'tapping the duck selects it');
  clearRec();
  await drag(c1, tp, [[160, 330], [165, 270], [172, 200], [180, 120]], { gap: 8 });
  const th = got('c1', 'wwThrow');
  check(th.length === 1 && th[0].toy === 'duck', 'an upward swipe throws the selected toy');
  check(th[0] && th[0].dy < -0.9 && th[0].dx > 0 && Math.abs(Math.hypot(th[0].dx, th[0].dy) - 1) < 0.03 && th[0].power > 0 && th[0].power <= 1, 'the throw carries a normalized direction (up, slightly right) and power in (0, 1]');
  await drag(c1, tp, [[160, 330], [165, 270], [172, 200], [180, 120]], { gap: 8 });
  check(got('c1', 'wwThrow').length === 1 && /holt die Ente/.test(txt(c1, 'wwParkHint')), 'the toy is out: no second throw, the hint says the dog is fetching');
  check([...el(c1, 'wwToyPicker').children].every(b => b.disabled), 'the toy picker is locked while the dog fetches');
  // the TV never reports the toy back (message lost): after the guard time the pad takes the toy back
  const realNow = c1.window.performance.now.bind(c1.window.performance);
  c1.window.performance.now = () => realNow() + 30000;           // the phone's clock runs 30 s ahead from here on
  await sleep(120);
  check(/Nach oben wischen/.test(txt(c1, 'wwParkHint')) && [...el(c1, 'wwToyPicker').children].every(b => !b.disabled), 'a silent TV does not leave the throw pad dead');
  await drag(c1, tp, [[160, 330], [165, 270], [172, 200], [180, 120]], { gap: 8 });
  check(got('c1', 'wwThrow').length === 2, 'and the next swipe throws again');
  tv('c1', { t: 'wwPark', ready: 1, tired: 1, toy: null });
  check(/müde/.test(txt(c1, 'wwParkHint')), 'a tired dog gets a pause hint');

  // ================= Feierabend =================
  clearRec();
  dbg().jump('night');
  await sleep(250);
  check(visible(c1) === 'v-ww-home' && open(c1, 'wwNightCard') && /Tagesbilanz · Tag 1/.test(txt(c1, 'wwNightTitle')), 'the night summary opens on the host\'s phone');
  const rows = [...el(c1, 'wwNightRows').children];
  const today1 = dbg().today[idOf('c1')];
  check(rows.length === 2 && rows[0].classList.contains('you') && rows[0].classList.contains('best') && /Krümel/.test(rows[0].textContent) && rows[0].textContent.indexOf('+' + today1.love + ' ❤️') >= 0, 'rows are ranked by love, Krümel is marked as Hund des Tages and "you"');
  check(/Hund des Tages/.test(txt(c1, 'wwNightBest')), 'the headline names the Hund des Tages');
  check(open(c4, 'wwNightCard') && el(c4, 'wwNextBtn').style.display === 'none' && el(c4, 'wwNightWait').style.display !== 'none', 'a guest sees the summary but only a "host starts soon" note');
  check(el(c1, 'wwNextBtn').style.display !== 'none' && el(c1, 'wwNightWait').style.display === 'none', 'the host sees the ☀️ Nächster Tag button');
  check(doc(c1).body.classList.contains('ww-host') && !doc(c4).body.classList.contains('ww-host'), 'only the host phone reserves room for the ✕ Abbrechen button');
  // the night has care too: hide the card, give a treat, bring the card back
  el(c1, 'wwNightClose').click();
  check(!open(c1, 'wwNightCard') && el(c1, 'wwNightOpen').style.display !== 'none', '"Noch ein bisschen kuscheln" hides the card and offers 🌙 Bilanz');
  c1.window.eval("ac.message(AirConsole.SCREEN, { t: 'wwHello', dog: null })");   // a resync: TV answers with phase, dog and the same summary
  check(!open(c1, 'wwNightCard'), 'the same summary arriving again does not pop the closed card open');
  clearRec();
  el(c1, 'wwTool-treat').click();
  check(got('c1', 'wwCare').length === 1 && dogOf('c1').inv.treat === 1, 'care still works at night');
  el(c1, 'wwTool-treat').click(); el(c1, 'wwTool-treat').click();
  check(got('c1', 'wwCare').length === 2 && dogOf('c1').inv.treat === 0 && toasts(c1).some(t => /Keine Leckerlis/.test(t)) && el(c1, 'wwTool-treat').querySelector('.ww-badge').classList.contains('zero'), 'with no treats left the 🍪 tool only toasts and the badge turns red');
  el(c1, 'wwNightOpen').click();
  check(open(c1, 'wwNightCard'), '🌙 Bilanz brings the card back');
  clearRec();
  el(c1, 'wwNextBtn').click();
  check(got('c1', 'wwNext').length === 1 && dbg().phase === 'night', 'tapping too early sends wwNext, but the TV keeps the night');
  dbg().night.at = -10;
  el(c1, 'wwNextBtn').click();
  await sleep(120);
  check(dbg().phase === 'home' && dbg().day === 2, 'the host\'s tap starts day 2');
  check(visible(c1) === 'v-ww-home' && !open(c1, 'wwNightCard') && /Tag 2 · ☀️/.test(txt(c1, 'wwPhaseLine')) && visible(c4) === 'v-ww-home', 'both phones are back in the morning view');
  check(toasts(c1).some(t => /Guten Morgen/.test(t)) && dogOf('c1').days === 1, 'a good-morning toast, and the lived day is counted');

  // the leash pad still answers after the walk was interrupted mid-drag
  dbg().jump('walk');
  await sleep(250);
  clearRec();
  await drag(c1, el(c1, 'wwWalkPad'), [[160, 200], [130, 235]], { gap: 70, tid: 6 });
  check(got('c1', 'wwMove').length >= 2, 'the leash pad works again on day 2 (a stale finger did not block it)');
  dbg().jump('home');

  // ================= a hostile or confused TV must not hurt the phone =================
  let junk = 0, crashed = 0;
  const bad = (msg) => { junk++; if (!attempt('junk ' + (msg && msg.t) + ' crashed the phone', () => tv('c1', msg))) crashed++; };
  const nameBefore1 = txt(c1, 'wwHomeName'), viewBefore = visible(c1);
  bad({ t: 'wwNight', host: true, rows: [{ owner: '<b>x</b>', dog: '<img src=x onerror="window.__pwned=1">', love: 1, coins: 2, finds: ['gem', '<i>', '__proto__'], best: true, you: false }] });
  check(!el(c1, 'wwNightRows').querySelector('img, [onerror]') && /<img/.test(txt(c1, 'wwNightRows')) && !c1.window.__pwned && !/undefined/.test(txt(c1, 'wwNightRows')), 'names from the TV are rendered as text, never as HTML');
  bad({ t: 'wwNight', rows: 'nope' }); bad({ t: 'wwNight', rows: [null, 5, { dog: { a: 1 } }] });
  bad({ t: 'wwEvent', text: '<img src=x onerror="window.__pwned=1">', kind: 'good "><b>' });
  check(!doc(c1).querySelector('#wwToasts img, #wwToasts b') && !c1.window.__pwned && toasts(c1).some(t => /<img/.test(t)), 'toast text from the TV stays text');
  bad({ t: 'wwEvent', text: { a: 1 }, kind: 5 }); bad({ t: 'wwEvent', text: null });
  check(!toasts(c1).some(t => /object/i.test(t)), 'a non-string toast text is dropped');
  bad({ t: 'wwYou', dog: { breed: 'dackel' } });
  bad({ t: 'wwYou', dog: { breed: 'labrador', needs: 5, inv: 'x', toys: null, finds: 7, stats: [], coins: 'many', name: { x: 1 } }, today: 'x', level: 'high' });
  bad({ t: 'wwYou', dog: null }); bad({ t: 'wwYou' });
  check(txt(c1, 'wwHomeName') === nameBefore1 && visible(c1) === viewBefore && stored(c1).uid === dogOf('c1').uid, 'broken wwYou records are ignored — screen and localStorage keep the real dog');
  bad({ t: 'wwPhase', phase: 'hax', day: 3, left: 5, host: true });
  bad({ t: 'wwPhase', phase: 'home', day: 'x', left: NaN, host: 1 });
  check(visible(c1) === viewBefore && /^Tag \d/.test(txt(c1, 'wwPhaseLine')) && !/NaN/.test(txt(c1, 'wwPhaseLine')), 'junk wwPhase leaves the view and the countdown sane');
  bad({ t: 'wwWalk', dig: 'x', digP: {}, poop: [], cat: null }); bad({ t: 'wwPark', ready: 'x', tired: {}, toy: { a: 1 } });
  bad({ t: 'wwUnknown', x: 1 }); bad(null);
  check(crashed === 0 && junk >= 15, 'none of ' + junk + ' junk messages crashed the phone');
  tv('c1', { t: 'wwEvent', text: '🐾 Alles gut', kind: 'good' });
  check(toasts(c1).some(t => /Alles gut/.test(t)) && visible(c1) === viewBefore, 'and it still answers real ones');
  tv('c1', { t: 'wwPhase', phase: 'home', day: 2, left: 30, host: true });

  // ================= moving out takes two taps =================
  clearRec();
  el(c1, 'wwMenuBtn').click();
  el(c1, 'wwMoveOutBtn').click();
  check(has(c1, 'wwMoveOutBtn', 'armed') && got('c1', 'wwMoveOut').length === 0 && !!dogOf('c1') && !!stored(c1), 'the first tap on 🏠 Hund abgeben only arms the button');
  el(c1, 'wwMoveOutBtn').click();
  await sleep(60);
  check(got('c1', 'wwMoveOut').length === 1 && !dogOf('c1') && visible(c1) === 'v-ww-adopt' && !open(c1, 'wwMenu'), 'the second tap moves the dog out and returns to the Tierheim');
  check(stored(c1) === null, 'the phone forgets the dog');
  // a wwYou that was already on the wire when the dog moved out arrives first, then the TV's wwAdopt
  attempt('late wwYou', () => tv('c1', { t: 'wwYou', dog: krum, today: { love: 0, coins: 0, finds: [] }, level: 0 }));
  tv('c1', { t: 'wwAdopt', backup: null });
  check(visible(c1) === 'v-ww-adopt' && stored(c1) === null, 'a late wwYou cannot bring a moved-out dog back for good (wwAdopt clears the local copy)');

  // ================= the host drops at night: the next phone takes over =================
  bus.disconnect('c1');
  await sleep(80);
  dbg().jump('night');
  await sleep(150);
  check(open(c4, 'wwNightCard') && el(c4, 'wwNextBtn').style.display !== 'none' && el(c4, 'wwNightWait').style.display === 'none', 'when the host leaves, the next phone gets the ☀️ Nächster Tag button');
  dbg().night.at = -10;
  el(c4, 'wwNextBtn').click();
  await sleep(100);
  check(dbg().phase === 'home' && dbg().day === 3 && dogOf('c4').days === 2, 'the new host starts day 3');

  // ================= a reconnecting phone resyncs, even in the middle of a bath =================
  clearRec();
  el(c4, 'wwTool-bath').click();
  check(has(c4, 'wwBathBar', 'open'), 'Ben starts a bath');
  const nDogs = Object.keys(dbg().dogs).length;
  c4.window.eval('CONTROLLERS.wauwauwg.activate()');          // what the shell does when the socket came back
  await sleep(80);
  check(got('c4', 'wwCare').some(m => m.act === 'bathCancel') && !has(c4, 'wwBathBar', 'open'), 'a reconnect lets the dog out of the tub');
  check(visible(c4) === 'v-ww-home' && txt(c4, 'wwHomeName') === ben.name && Object.keys(dbg().dogs).length === nDogs && dogOf('c4').uid === benUid && /Tag 3/.test(txt(c4, 'wwPhaseLine')), 'it comes back to the same dog, the same day and no second dog');

  // ================= next game night: abort, start again on the same pages =================
  el(c4, 'abortBtn').click();
  await sleep(100);
  check(!dbg() && visible(c4) === 'v-shelllobby', 'the host aborts: back to the lobby');
  const again = [...doc(c4).querySelectorAll('#gamePicker button')].find(b => b.textContent === '🐶 Wauwau-WG');
  again.click(); await sleep(50);
  clearRec();
  blockTv('wwHello', true);                          // the TV does not hear the first hello
  el(c4, 'startBtn').click();
  await sleep(150);
  check(visible(c4) === 'v-ww-hi' && got('c4', 'wwHello').length === 1, 'a new game: the phone waits in the "Dein Hund wird geweckt" view');
  await sleep(2700);
  check(got('c4', 'wwHello').length === 2 && visible(c4) === 'v-ww-hi', 'it asks again when nobody answers');
  blockTv('wwHello', false);
  await until(() => visible(c4) === 'v-ww-home', 4500);
  check(dbg() && dbg().day === 1 && dogOf('c4') && dogOf('c4').uid === benUid && dogOf('c4').days === 2, 'a new game starts on day 1 with the same dog (days lived: 2)');
  check(visible(c4) === 'v-ww-home' && !open(c4, 'wwNightCard') && !open(c4, 'wwShop') && !has(c4, 'wwBathBar', 'open') && /Tag 1 ·/.test(txt(c4, 'wwPhaseLine')), 'the phone starts clean — no open sheets or leftovers from the last game');

  console.log(process.exitCode ? '❌ Test fehlgeschlagen' : '✅ Alle Checks bestanden');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); console.log('❌ Test fehlgeschlagen'); process.exit(1); });
