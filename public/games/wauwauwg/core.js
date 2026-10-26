// Wauwau-WG shared core: catalogs + pure rules. Loaded by the screen AND the
// controller (and by test-wauwauwg.js in a vm). No DOM, no canvas — the art
// lives in dogart.js. The screen is authoritative: it applies these rules and
// pushes the resulting dog record to the phone, which only persists it.
// Balance numbers are honest guesses until real humans play — tune them here.
(function (root) {
  'use strict';
  const WW = root.WW = root.WW || {};
  WW.VERSION = 1;
  WW.scenes = WW.scenes || {};   // home.js / walk.js / park.js register here (screen only)

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  // Own keys only: a phone sending breed 'constructor' must not reach Object.prototype.
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  WW.clamp = clamp;

  // ---------- Breeds ----------
  // fur = main coat color, fur2 = markings (mask, saddle, chest, ears…).
  // dogart.js decides where each breed puts fur2.
  WW.BREEDS = {
    dackel: { label: 'Dackel', coats: [
      { label: 'Rotbraun', fur: '#b5652b', fur2: '#8a4518' },
      { label: 'Schwarz-Loh', fur: '#2b2420', fur2: '#c27a3a' },
      { label: 'Creme', fur: '#e8c590', fur2: '#cfa368' }] },
    labrador: { label: 'Labrador', coats: [
      { label: 'Blond', fur: '#e9c98c', fur2: '#d7b071' },
      { label: 'Schoko', fur: '#6b4026', fur2: '#55301b' },
      { label: 'Schwarz', fur: '#26221f', fur2: '#3a3430' }] },
    mops: { label: 'Mops', coats: [
      { label: 'Beige', fur: '#e3c9a0', fur2: '#2a2522' },
      { label: 'Apricot', fur: '#e2a86a', fur2: '#2a2522' },
      { label: 'Schwarz', fur: '#28231f', fur2: '#141110' }] },
    husky: { label: 'Husky', coats: [
      { label: 'Grau-Weiß', fur: '#8d949c', fur2: '#f4f4f2' },
      { label: 'Schwarz-Weiß', fur: '#2e3034', fur2: '#f4f4f2' },
      { label: 'Rot-Weiß', fur: '#b36a3c', fur2: '#f6efe6' }] },
    corgi: { label: 'Corgi', coats: [
      { label: 'Rot-Weiß', fur: '#d9873e', fur2: '#fbf4ea' },
      { label: 'Dreifarbig', fur: '#2d2622', fur2: '#fbf4ea' },
      { label: 'Zobel', fur: '#a8763f', fur2: '#fbf4ea' }] },
    pudel: { label: 'Pudel', coats: [
      { label: 'Weiß', fur: '#f5f1ea', fur2: '#e6dfd3' },
      { label: 'Apricot', fur: '#e8b27a', fur2: '#d99a5e' },
      { label: 'Schwarz', fur: '#2a2728', fur2: '#1d1a1b' }] },
    schaefer: { label: 'Schäferhund', coats: [
      { label: 'Schwarz-Braun', fur: '#c07a3a', fur2: '#26201c' },
      { label: 'Schwarz', fur: '#2a2522', fur2: '#1b1715' },
      { label: 'Weiß', fur: '#f3eee4', fur2: '#e2d9c8' }] },
    mischling: { label: 'Mischling', coats: [
      { label: 'Gefleckt', fur: '#f1e7d6', fur2: '#6b4a32' },
      { label: 'Braun', fur: '#9a6b45', fur2: '#f1e7d6' },
      { label: 'Grau', fur: '#8f8a85', fur2: '#e9e4dc' }] }
  };
  WW.BREED_KEYS = Object.keys(WW.BREEDS);
  WW.isBreed = (k) => own(WW.BREEDS, k);
  WW.NAME_IDEAS = ['Bello', 'Luna', 'Balu', 'Frieda', 'Krümel', 'Socke', 'Paul', 'Nala', 'Keks',
    'Bruno', 'Mila', 'Wuffi', 'Pünktchen', 'Rudi', 'Lotte', 'Olli', 'Emmi', 'Fiete', 'Sesam'];
  WW.NAME_MAX = 12;

  // ---------- Needs (0 = urgent, 100 = perfect) ----------
  WW.NEEDS = ['food', 'water', 'clean', 'mood', 'energy'];
  WW.NEED_INFO = {
    food: { label: 'Futter', emoji: '🍖', color: '#ff9f0a' },
    water: { label: 'Wasser', emoji: '💧', color: '#64d2ff' },
    clean: { label: 'Sauberkeit', emoji: '✨', color: '#bf5af2' },
    mood: { label: 'Laune', emoji: '😊', color: '#ffd60a' },
    energy: { label: 'Energie', emoji: '⚡', color: '#30d158' }
  };
  WW.LOW = 25; // below this a need counts as low: mood drains, hints show
  // Change per MINUTE of play, by activity (= current phase). Needs never
  // change while the game is not running — no Tamagotchi guilt between evenings.
  WW.RATES = {
    home: { food: -7, water: -9, clean: -1, energy: 6, mood: -1 },
    walk: { food: -9, water: -14, clean: -4, energy: -9, mood: 3 },
    park: { food: -9, water: -14, clean: -2, energy: -7, mood: 2 },
    night: { food: -4, water: -5, clean: -0.5, energy: 8, mood: 0 }
  };
  WW.LOW_MOOD_DRAIN = 4; // extra mood loss per minute for each low food/water/clean

  // ---------- Day structure (seconds per phase; night waits for the host) ----------
  WW.PHASES = ['home', 'walk', 'park', 'night'];
  WW.DAY = {
    kurz: { home: 45, walk: 65, park: 55 },
    normal: { home: 70, walk: 100, park: 80 },
    lang: { home: 110, walk: 160, park: 130 }
  };
  WW.PHASE_INFO = {
    home: { label: 'Morgen in der WG', emoji: '☀️' },
    walk: { label: 'Gassi-Runde', emoji: '🦮' },
    park: { label: 'Ab in den Park', emoji: '🎾' },
    night: { label: 'Feierabend', emoji: '🌙' }
  };

  // ---------- Love (Zuneigung, persistent bond) ----------
  WW.LOVE_LEVELS = [0, 25, 70, 150, 270, 450];
  WW.LOVE_NAMES = ['Neu in der WG', 'Schnuppernd', 'Vertraut', 'Kumpel', 'Bester Freund', 'Seelenhund'];
  // Max love per day and source — caring well beats spamming.
  WW.LOVE_CAPS = { pet: 12, brush: 10, treat: 6, fetch: 20, walk: 15, care: 30 };
  WW.loveLevel = function (love) {
    let l = 0;
    for (let i = 0; i < WW.LOVE_LEVELS.length; i++) if (love >= WW.LOVE_LEVELS[i]) l = i;
    return l;
  };
  WW.SPOTS = ['head', 'ears', 'chin', 'belly'];
  // Every dog has a favorite petting spot, stable per dog (derived from uid).
  WW.favoriteSpot = function (dog) {
    let h = 0;
    const s = String(dog.uid || dog.name || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return WW.SPOTS[h % WW.SPOTS.length];
  };

  // ---------- Items ----------
  // kind: use = consumable in dog.inv, toy = permanent in dog.toys,
  // find = sellable walk loot in dog.finds, coin = instant Taler (walk loot).
  WW.ITEMS = {
    kibble: { label: 'Trockenfutter', emoji: '🥣', kind: 'use', price: 4, desc: 'Macht satt (+35 🍖)' },
    meat: { label: 'Fleischdose', emoji: '🥫', kind: 'use', price: 10, desc: 'Festmahl (+60 🍖, gute Laune)' },
    treat: { label: 'Leckerli', emoji: '🍪', kind: 'use', price: 2, desc: 'Kleine Belohnung (+😊)' },
    shampoo: { label: 'Shampoo', emoji: '🧴', kind: 'use', price: 6, desc: 'Für ein Schaumbad' },
    ball: { label: 'Tennisball', emoji: '🎾', kind: 'toy', price: null, desc: 'Der Klassiker' },
    frisbee: { label: 'Frisbee', emoji: '🥏', kind: 'toy', price: 35, desc: 'Fliegt weit — Fang in der Luft gibt Bonus' },
    duck: { label: 'Quietsche-Ente', emoji: '🦆', kind: 'toy', price: 20, desc: 'Hüpft wild und quietscht' },
    stick: { label: 'Stöckchen', emoji: '🪵', kind: 'toy', price: null, desc: 'Beim Gassi gefunden' },
    coin: { label: 'Taler', emoji: '🪙', kind: 'coin' },
    sock: { label: 'Einzelne Socke', emoji: '🧦', kind: 'find', sell: 2 },
    shoe: { label: 'Alter Turnschuh', emoji: '👟', kind: 'find', sell: 4 },
    oldbone: { label: 'Alter Knochen', emoji: '🦴', kind: 'find', sell: 3 },
    shell: { label: 'Muschel', emoji: '🐚', kind: 'find', sell: 6 },
    key: { label: 'Rostiger Schlüssel', emoji: '🗝️', kind: 'find', sell: 10 },
    gem: { label: 'Glitzerstein', emoji: '💎', kind: 'find', sell: 25 },
    watch: { label: 'Taschenuhr', emoji: '⌚', kind: 'find', sell: 40 },
    crown: { label: 'Spielzeugkrone', emoji: '👑', kind: 'find', sell: 60 }
  };
  WW.SHOP = ['kibble', 'meat', 'treat', 'shampoo', 'frisbee', 'duck'];
  WW.TOYS = Object.keys(WW.ITEMS).filter(k => WW.ITEMS[k].kind === 'toy');
  WW.USES = Object.keys(WW.ITEMS).filter(k => WW.ITEMS[k].kind === 'use');
  WW.FINDS = Object.keys(WW.ITEMS).filter(k => WW.ITEMS[k].kind === 'find');
  // Walk loot table [item, weight]; rarer = more valuable.
  WW.FIND_TABLE = [['coin', 30], ['sock', 16], ['shoe', 12], ['oldbone', 12], ['stick', 8],
    ['shell', 9], ['key', 6], ['gem', 4], ['watch', 2], ['crown', 1]];
  WW.RARE = { gem: 1, watch: 1, crown: 1 };   // TV/phone celebrate these
  WW.STARTER = { coins: 30, inv: { kibble: 3, meat: 0, treat: 3, shampoo: 2 }, toys: ['ball'] };
  WW.INV_MAX = 99;
  WW.COINS_MAX = 99999;

  // ---------- Dog record ----------
  WW.cleanName = function (s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, WW.NAME_MAX).trim();
  };
  function newUid(rnd) {
    let s = '';
    for (let i = 0; i < 10; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor((rnd || Math.random)() * 36)];
    return s;
  }
  WW.newDog = function (spec, rnd) {
    spec = spec || {};
    const breed = WW.isBreed(spec.breed) ? spec.breed : 'mischling';
    const coats = WW.BREEDS[breed].coats.length;
    return {
      v: WW.VERSION,
      uid: newUid(rnd),
      name: WW.cleanName(spec.name) || 'Wuffi',
      breed,
      coat: clamp(spec.coat | 0, 0, coats - 1),
      born: Date.now(),
      days: 0,
      needs: { food: 80, water: 80, clean: 90, mood: 75, energy: 90 },
      love: 0,
      coins: WW.STARTER.coins,
      inv: Object.assign({}, WW.STARTER.inv),
      toys: WW.STARTER.toys.slice(),
      finds: {},
      stats: { walks: 0, fetches: 0, baths: 0, finds: 0 }
    };
  };
  // Phones are friends, but localStorage can be stale or hand-edited:
  // everything a phone sends goes through here. Returns a clean copy or null.
  WW.sanitizeDog = function (raw) {
    if (!raw || typeof raw !== 'object' || !WW.isBreed(raw.breed)) return null;
    const d = WW.newDog({ name: raw.name, breed: raw.breed, coat: raw.coat });
    if (typeof raw.uid === 'string' && /^[a-z0-9]{4,16}$/.test(raw.uid)) d.uid = raw.uid;
    d.born = clamp(num(raw.born, d.born), 0, 8.64e15);
    d.days = clamp(Math.floor(num(raw.days, 0)), 0, 100000);
    const n = raw.needs || {};
    WW.NEEDS.forEach(k => { d.needs[k] = Math.round(clamp(num(n[k], 60), 0, 100) * 10) / 10; });
    d.love = clamp(Math.floor(num(raw.love, 0)), 0, 1e6);
    d.coins = clamp(Math.floor(num(raw.coins, 0)), 0, WW.COINS_MAX);
    const inv = raw.inv || {};
    d.inv = {};
    WW.USES.forEach(k => { d.inv[k] = clamp(Math.floor(num(inv[k], 0)), 0, WW.INV_MAX); });
    const toys = Array.isArray(raw.toys) ? raw.toys : [];
    d.toys = WW.TOYS.filter(k => k === 'ball' || toys.indexOf(k) >= 0);
    const finds = raw.finds || {};
    d.finds = {};
    WW.FINDS.forEach(k => { const c = clamp(Math.floor(num(finds[k], 0)), 0, WW.INV_MAX); if (c) d.finds[k] = c; });
    const st = raw.stats || {};
    Object.keys(d.stats).forEach(k => { d.stats[k] = clamp(Math.floor(num(st[k], 0)), 0, 1e7); });
    return d;
  };

  // Per-day, per-dog session stats (not persisted): love/coins earned, finds, love caps.
  WW.newToday = function () { return { love: 0, coins: 0, finds: [], caps: {} }; };

  WW.addLove = function (dog, today, n, source) {
    if (!(n > 0)) return 0;
    const cap = WW.LOVE_CAPS[source];
    const used = today.caps[source] || 0;
    const add = cap == null ? n : Math.max(0, Math.min(n, cap - used));
    today.caps[source] = used + add;
    dog.love += add;
    today.love += add;
    return add;
  };
  WW.addCoins = function (dog, today, n) {
    const before = dog.coins;
    dog.coins = clamp(dog.coins + Math.round(n), 0, WW.COINS_MAX);
    if (today && dog.coins > before) today.coins += dog.coins - before;
    return dog.coins - before;
  };
  WW.changeNeeds = function (dog, delta) {
    Object.keys(delta || {}).forEach(k => {
      if (k in dog.needs) dog.needs[k] = clamp(dog.needs[k] + num(delta[k], 0), 0, 100);
    });
  };

  // ---------- Simulation helpers ----------
  WW.decay = function (dog, dt, activity) {
    const r = WW.RATES[activity] || WW.RATES.home, n = dog.needs, k = dt / 60;
    let mood = r.mood;
    if (n.food < WW.LOW) mood -= WW.LOW_MOOD_DRAIN;
    if (n.water < WW.LOW) mood -= WW.LOW_MOOD_DRAIN;
    if (n.clean < WW.LOW) mood -= WW.LOW_MOOD_DRAIN;
    n.food = clamp(n.food + r.food * k, 0, 100);
    n.water = clamp(n.water + r.water * k, 0, 100);
    n.clean = clamp(n.clean + r.clean * k, 0, 100);
    n.energy = clamp(n.energy + r.energy * k, 0, 100);
    n.mood = clamp(n.mood + mood * k, 0, 100);
  };
  // Movement speed multiplier for scenes: tired/thirsty/hungry dogs dawdle.
  WW.speedFactor = function (dog) {
    const n = dog.needs;
    let f = 1;
    if (n.energy < 30) f -= 0.4 * (30 - n.energy) / 30;
    if (n.water < 15) f -= 0.1;
    if (n.food < 15) f -= 0.1;
    return Math.max(0.5, f);
  };
  WW.isTired = function (dog) { return dog.needs.energy < 15; };
  // Lowest need, for hints ("Hunger!") — null when all are fine.
  WW.urgentNeed = function (dog) {
    let worst = null;
    WW.NEEDS.forEach(k => { if (dog.needs[k] < WW.LOW && (!worst || dog.needs[k] < dog.needs[worst])) worst = k; });
    return worst;
  };
  WW.wakeUp = function (dog) {
    dog.needs.energy = clamp(dog.needs.energy + 45, 0, 100);
    dog.needs.mood = clamp(dog.needs.mood + 5, 0, 100);
  };
  WW.endDay = function (dog) { dog.days++; };

  // ---------- Care (home/night phases) ----------
  // Returns { ok, text, fx, love }. fx is the animation hint for the TV scene:
  // hearts | sparkle | drink | eat | treat | tub | shake | untub | refuse | null.
  WW.care = function (dog, today, act, arg) {
    const n = dog.needs, name = dog.name;
    const res = (ok, text, fx, love) => ({ ok, text: text || null, fx: fx || null, love: love || 0 });
    switch (act) {
      case 'pet': {
        const fav = arg && arg === WW.favoriteSpot(dog);
        n.mood = clamp(n.mood + (fav ? 8 : 4), 0, 100);
        const love = WW.addLove(dog, today, fav ? 2 : 1, 'pet');
        let text = null;
        if (fav && !today.favFound) { today.favFound = true; text = '💕 Lieblingsstelle gefunden!'; }
        return res(true, text, 'hearts', love);
      }
      case 'brush': {
        if (n.clean < 85) n.clean = Math.min(85, n.clean + 3);
        n.mood = clamp(n.mood + 1, 0, 100);
        return res(true, null, 'sparkle', WW.addLove(dog, today, 1, 'brush'));
      }
      case 'water': {
        if (n.water >= 90) return res(false, name + ' hat keinen Durst 💧', 'refuse');
        const gain = 100 - n.water;
        n.water = 100;
        return res(true, '💧 Schlabber, schlabber!', 'drink', WW.addLove(dog, today, gain >= 40 ? 3 : 1, 'care'));
      }
      case 'feed': {
        const item = arg === 'meat' ? 'meat' : 'kibble';
        if (!(dog.inv[item] > 0)) return res(false, 'Kein ' + WW.ITEMS[item].label + ' mehr — ab in den Laden 🛒', null);
        if (n.food >= 90) return res(false, name + ' ist satt 😌', 'refuse');
        const was = n.food;
        dog.inv[item]--;
        n.food = clamp(n.food + (item === 'meat' ? 60 : 35), 0, 100);
        n.mood = clamp(n.mood + (item === 'meat' ? 10 : 3), 0, 100);
        return res(true, item === 'meat' ? '🥫 Festmahl!' : '🥣 Mampf, mampf!', 'eat', WW.addLove(dog, today, was < 60 ? 4 : 1, 'care'));
      }
      case 'treat': {
        if (!(dog.inv.treat > 0)) return res(false, 'Keine Leckerlis mehr — ab in den Laden 🛒', null);
        dog.inv.treat--;
        n.mood = clamp(n.mood + 12, 0, 100);
        n.food = clamp(n.food + 3, 0, 100);
        return res(true, null, 'treat', WW.addLove(dog, today, 2, 'treat'));
      }
      case 'bathStart':
        if (!(dog.inv.shampoo > 0)) return res(false, 'Kein Shampoo 🧴 — ab in den Laden 🛒', null);
        return res(true, null, 'tub');
      case 'bath': {
        if (!(dog.inv.shampoo > 0)) return res(false, 'Kein Shampoo 🧴 — ab in den Laden 🛒', 'untub');
        const was = n.clean;
        dog.inv.shampoo--;
        n.clean = 100;
        n.mood = clamp(n.mood + 5, 0, 100);
        dog.stats.baths++;
        return res(true, '🛁 Blitzsauber!', 'shake', WW.addLove(dog, today, was < 60 ? 6 : 2, 'care'));
      }
      case 'bathCancel':
        return res(true, null, 'untub');
    }
    return res(false, null, null);
  };

  // ---------- Shop ----------
  WW.buy = function (dog, key) {
    const it = WW.ITEMS[key];
    if (!it || WW.SHOP.indexOf(key) < 0) return { ok: false, text: 'Gibt es hier nicht' };
    if (it.kind === 'toy' && dog.toys.indexOf(key) >= 0) return { ok: false, text: it.emoji + ' ' + it.label + ' hast du schon' };
    if (it.kind === 'use' && dog.inv[key] >= WW.INV_MAX) return { ok: false, text: 'Der Schrank ist voll' };
    if (dog.coins < it.price) return { ok: false, text: 'Zu wenig Taler 🪙 (' + it.price + ' nötig)' };
    dog.coins -= it.price;
    if (it.kind === 'toy') dog.toys.push(key);
    else dog.inv[key] = (dog.inv[key] || 0) + 1;
    return { ok: true, text: it.emoji + ' ' + it.label + ' gekauft' };
  };
  WW.sell = function (dog, key, today) {
    const it = WW.ITEMS[key];
    if (!it || it.kind !== 'find' || !(dog.finds[key] > 0)) return { ok: false, text: 'Nichts zu verkaufen', coins: 0 };
    dog.finds[key]--;
    if (!dog.finds[key]) delete dog.finds[key];
    WW.addCoins(dog, today, it.sell);
    return { ok: true, text: it.emoji + ' verkauft: +' + it.sell + ' 🪙', coins: it.sell };
  };

  // ---------- Walk loot ----------
  WW.rollFind = function (rnd) {
    let total = 0;
    WW.FIND_TABLE.forEach(e => { total += e[1]; });
    let r = (rnd || Math.random)() * total;
    for (const [key, w] of WW.FIND_TABLE) { if ((r -= w) < 0) return key; }
    return 'coin';
  };
  // Applies a find to the dog. Returns { item, coins, text } (text for the phone toast).
  WW.giveFind = function (dog, today, key, rnd) {
    const it = own(WW.ITEMS, key) ? WW.ITEMS[key] : WW.ITEMS.coin;
    dog.stats.finds++;
    if (it.kind === 'coin') {
      const c = 4 + Math.floor((rnd || Math.random)() * 9);
      WW.addCoins(dog, today, c);
      return { item: 'coin', coins: c, text: '🪙 ' + c + ' Taler gefunden!' };
    }
    if (it.kind === 'toy') {
      if (dog.toys.indexOf(key) >= 0) {
        WW.addCoins(dog, today, 2);
        return { item: key, coins: 2, text: it.emoji + ' Noch ein ' + it.label + ' — gegen 2 🪙 getauscht' };
      }
      dog.toys.push(key);
      if (today) today.finds.push(key);
      return { item: key, coins: 0, text: it.emoji + ' ' + it.label + ' gefunden — neues Spielzeug!' };
    }
    dog.finds[key] = Math.min(WW.INV_MAX, (dog.finds[key] || 0) + 1);
    if (today) today.finds.push(key);
    return { item: key, coins: 0, text: it.emoji + ' ' + it.label + ' gefunden!' };
  };

  // Seeded PRNG (mulberry32) — deterministic harness runs and tests.
  WW.rng = function (seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  WW.pick = function (arr, rnd) { return arr[Math.floor((rnd || Math.random)() * arr.length)]; };
})(typeof window !== 'undefined' ? window : globalThis);
