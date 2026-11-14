// ===== Würfelverlies — the data: crests, dice nets, abilities, monsters, dice bags (see docs/VERLIES.md) =====
// Plain script for the screen, the phones and Node tests. Nothing here changes during a game.
(function (root) {
  // crest types. SUM never goes into the pool, the other five do
  const CRESTS = ['SUM', 'MOV', 'ATK', 'DEF', 'MAG', 'TRP'];
  const POOL = ['MOV', 'ATK', 'DEF', 'MAG', 'TRP'];
  const CREST = {
    SUM: { name: 'Beschwörung', emoji: '⭐', color: '#f5c542' },
    MOV: { name: 'Bewegung', emoji: '👣', color: '#3fd0c9' },
    ATK: { name: 'Angriff', emoji: '⚔️', color: '#ff6b3d' },
    DEF: { name: 'Abwehr', emoji: '🛡️', color: '#8fb4ff' },
    MAG: { name: 'Magie', emoji: '✨', color: '#e070ff' },
    TRP: { name: 'Falle', emoji: '🕸️', color: '#a6d94a' }
  };
  const LETTER = { M: 'MOV', A: 'ATK', D: 'DEF', G: 'MAG', T: 'TRP' };

  // the eleven nets of a cube; `s` is the cell where the monster appears (a middle face)
  const NETS = [
    { rows: ['X...', 'XXXX', 'X...'], s: [1, 1], name: 'Haken' },
    { rows: ['X...', 'XXXX', '.X..'], s: [1, 1], name: 'Sichel' },
    { rows: ['X...', 'XXXX', '..X.'], s: [1, 1], name: 'Welle' },
    { rows: ['X...', 'XXXX', '...X'], s: [1, 1], name: 'Zickzack' },
    { rows: ['.X..', 'XXXX', '.X..'], s: [1, 1], name: 'Kreuz' },
    { rows: ['.X..', 'XXXX', '..X.'], s: [1, 1], name: 'Schwinge' },
    { rows: ['XX..', '.XXX', '.X..'], s: [2, 1], name: 'Kralle' },
    { rows: ['XX..', '.XXX', '..X.'], s: [2, 1], name: 'Anker' },
    { rows: ['XX..', '.XXX', '...X'], s: [2, 1], name: 'Schlange' },
    { rows: ['XX..', '.XX.', '..XX'], s: [1, 1], name: 'Treppe' },
    { rows: ['XXX..', '..XXX'], s: [2, 0], name: 'Stufe' }
  ];
  NETS.forEach((n) => {
    n.cells = [];
    n.rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === 'X') n.cells.push([x, y]); });
  });

  // every orientation of a net (4 turns × mirrored or not, duplicates dropped), cells relative to the summon cell
  const ORIENT = NETS.map((n) => {
    const out = [], seen = {};
    for (let f = 0; f < 2; f++) for (let r = 0; r < 4; r++) {
      const cells = n.cells.map(([x, y]) => {
        let px = x - n.s[0], py = y - n.s[1];
        if (f) px = -px;
        for (let k = 0; k < r; k++) { const t = px; px = -py; py = t; }
        return [px, py];
      });
      const key = cells.map((c) => c[0] + ',' + c[1]).sort().join(' ');
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({ r, f, cells });
    }
    return out;
  });

  // abilities: one system for everything a monster can do beyond moving and hitting.
  // kind: passive (always on), active (in your own turn, paid with crests), reaction (when it is attacked)
  // target: self | ally (self or a neighbour of your own) | enemy (monster within `range`) | own (any own monster)
  //         | cell (free path cell next to it) | none (area effect around it)
  const ABIL = {
    flug: { name: 'Flug', icon: '🪽', kind: 'passive', text: 'Zieht über andere Monster hinweg.' },
    flink: { name: 'Flink', icon: '💨', kind: 'passive', text: 'Eine Bewegung kostet 1 👣 weniger (mindestens 1).' },
    dornen: { name: 'Glühende Haut', icon: '🔥', kind: 'passive', text: 'Wer es angreift, erleidet 10 Schaden.' },
    raub: { name: 'Lebensraub', icon: '🩸', kind: 'passive', text: 'Heilt sich um 10, wenn es Schaden anrichtet.' },
    reich: { name: 'Fangarme', icon: '🦑', kind: 'passive', text: 'Greift auch 2 Felder weit in gerader Linie an.' },
    sprint: { name: 'Sprint', icon: '⚡', kind: 'active', cost: { MAG: 1 }, target: 'self', text: 'Darf sich in diesem Zug noch einmal bewegen.' },
    rage: { name: 'Raserei', icon: '😤', kind: 'active', cost: { MAG: 2 }, target: 'self', text: '+20 ATK für den nächsten Angriff in diesem Zug.' },
    heal: { name: 'Heilung', icon: '🌿', kind: 'active', cost: { MAG: 2 }, target: 'ally', amount: 20, text: '+20 LP für sich oder ein eigenes Monster daneben.' },
    bolt: { name: 'Feuerball', icon: '☄️', kind: 'active', cost: { MAG: 2 }, target: 'enemy', range: 3, dmg: 10, text: '10 Schaden an einem Feind bis 3 Felder weit, ohne Abwehr.' },
    bolt2: { name: 'Seelenblitz', icon: '💀', kind: 'active', cost: { MAG: 3 }, target: 'enemy', range: 3, dmg: 20, text: '20 Schaden an einem Feind bis 3 Felder weit, ohne Abwehr.' },
    breath: { name: 'Feueratem', icon: '🐉', kind: 'active', cost: { MAG: 3 }, target: 'none', range: 1, dmg: 20, text: '20 Schaden an allen Feinden direkt daneben.' },
    wave: { name: 'Flutwelle', icon: '🌊', kind: 'active', cost: { MAG: 3 }, target: 'none', range: 2, dmg: 10, text: '10 Schaden an allen Feinden bis 2 Felder weit.' },
    aura: { name: 'Heilende Aura', icon: '💚', kind: 'active', cost: { MAG: 3 }, target: 'none', range: 2, amount: 20, text: '+20 LP für alle eigenen Monster bis 2 Felder weit.' },
    root: { name: 'Wurzelgriff', icon: '🌱', kind: 'active', cost: { MAG: 2 }, target: 'enemy', range: 2, text: 'Ein Feind bis 2 Felder weit kann sich im nächsten Zug nicht bewegen.' },
    freeze: { name: 'Frostbann', icon: '❄️', kind: 'active', cost: { MAG: 2 }, target: 'enemy', range: 2, text: 'Ein Feind bis 2 Felder weit kann im nächsten Zug nichts tun.' },
    swap: { name: 'Gezeitentausch', icon: '🔄', kind: 'active', cost: { MAG: 2 }, target: 'own', text: 'Tauscht den Platz mit einem anderen eigenen Monster.' },
    net: { name: 'Netzfalle', icon: '🕸️', kind: 'active', cost: { TRP: 1 }, target: 'cell', item: 'netz', text: 'Legt verdeckt ein Netz neben sich: 20 Schaden, das Opfer hängt einen Zug fest.' },
    counter: { name: 'Gegenschlag', icon: '↩️', kind: 'reaction', cost: { TRP: 1 }, text: 'Wenn es angegriffen wird: der Angreifer erleidet danach 10 Schaden.' },
    dodge: { name: 'Ausweichen', icon: '💫', kind: 'reaction', cost: { TRP: 2 }, text: 'Wenn es angegriffen wird: der Angriff geht daneben.' },
    mirror: { name: 'Spiegelschild', icon: '🪞', kind: 'reaction', cost: { TRP: 3 }, text: 'Wenn es angegriffen wird: der Angreifer bekommt den Schaden selbst ab.' },
    // every monster has this one (once per turn per player)
    pit: { name: 'Falle stellen', icon: '🕳️', kind: 'active', cost: { TRP: 2 }, target: 'cell', item: 'pit', text: 'Gräbt verdeckt eine Grube neben sich: 10 Schaden, das Opfer bleibt stehen.' }
  };
  const UNIVERSAL = ['pit'];

  // items: what an item die brings, and the traps abilities lay. Everyone sees that something lies there, only the owner sees what
  const ITEMS = {
    grube: { name: 'Fallgrube', icon: '🕳️', trap: true, dmg: 20, text: 'Verdeckte Falle: Ein Feind, der hineintritt, erleidet 20 Schaden und bleibt stehen.' },
    quelle: { name: 'Heilquell', icon: '⛲', text: 'Steht zu Beginn deines Zuges ein eigenes Monster darauf: +20 LP.' },
    kristall: { name: 'Kristallader', icon: '💎', text: 'Steht zu Beginn deines Zuges ein eigenes Monster darauf: +2 ✨.' },
    netz: { name: 'Netz', icon: '🕸️', trap: true, dmg: 20, root: true, text: 'Verdecktes Netz: 20 Schaden, das Opfer hängt einen Zug fest.' },
    pit: { name: 'Grube', icon: '🕳️', trap: true, dmg: 10, text: 'Verdeckte Grube: 10 Schaden, das Opfer bleibt stehen.' }
  };

  // ---- the monsters. Stats come in tens, like the original dice game. faces: the non-summon faces (M A D G T, digit = ×2/×3) ----
  // art: parameters for the portrait painter in art.js
  const M = {};
  function mon(key, o) { M[key] = Object.assign({ key, abil: [], kind: 'monster' }, o); }

  // 🔥 Glutschmiede
  mon('funke', { name: 'Funkenwicht', level: 1, atk: 20, def: 0, hp: 10, bag: 'glut', faces: 'MA', lore: 'Kichert, wenn es irgendwo brennt.',
    art: { head: 'imp', skin: '#ff8a3d', eye: '#fff3a0', horns: 'small', mouth: 'grin', fx: 'sparks' } });
  mon('kaefer', { name: 'Glutkäfer', level: 1, atk: 10, def: 10, hp: 20, bag: 'glut', faces: 'MD', lore: 'Sein Panzer glimmt wie Kohle.',
    art: { head: 'beetle', skin: '#7a2a1a', eye: '#ffb347', mouth: 'mandible', fx: 'embers' } });
  mon('hund', { name: 'Schmiedehund', level: 2, atk: 30, def: 10, hp: 20, bag: 'glut', faces: 'M2AG', abil: ['sprint'], lore: 'Jagt Funken, bis sie ausgehen.',
    art: { head: 'hound', skin: '#5a5560', eye: '#ffcf4a', ears: 'pointy', mouth: 'fangs', fx: 'embers', mane: '#ff7a2f' } });
  mon('hexe', { name: 'Aschenhexe', level: 2, atk: 20, def: 10, hp: 20, bag: 'glut', faces: 'GGM', abil: ['bolt'], lore: 'Liest die Zukunft in der Asche.',
    art: { head: 'witch', skin: '#c9b3a4', eye: '#ff5a2a', hat: '#2b1d22', hair: '#e9e1d6', mouth: 'smirk', fx: 'sparks' } });
  mon('golem', { name: 'Lavagolem', level: 3, atk: 30, def: 30, hp: 30, bag: 'glut', faces: 'DAMD2', abil: ['dornen'], lore: 'Unter der Kruste kocht es.',
    art: { head: 'stone', skin: '#3d3634', eye: '#ffae2b', cracks: '#ff6a1a', mouth: 'none', fx: 'embers' } });
  mon('loewe', { name: 'Flammenlöwe', level: 3, atk: 40, def: 10, hp: 30, bag: 'glut', faces: 'A2MAM', abil: ['rage'], lore: 'Seine Mähne ist ein Lagerfeuer.',
    art: { head: 'cat', skin: '#e0a44a', eye: '#fff07a', ears: 'round', mouth: 'fangs', mane: '#ff5a1f', fx: 'flames' } });
  mon('drache', { name: 'Vulkandrache', level: 4, atk: 50, def: 30, hp: 40, bag: 'glut', faces: 'A2M2GDA', abil: ['flug', 'breath'], lore: 'Schläft in Kratern, träumt von Gold.',
    art: { head: 'dragon', skin: '#b3261e', eye: '#ffe14a', horns: 'long', mouth: 'fangs', fx: 'flames', crest: '#ffb02e' } });

  // 🌿 Wildwuchs
  mon('moos', { name: 'Moosling', level: 1, atk: 10, def: 10, hp: 20, bag: 'wild', faces: 'MD', lore: 'Wächst, wo niemand hinsieht.',
    art: { head: 'blob', skin: '#5e9a3a', eye: '#f5ffd0', mouth: 'smile', fx: 'leaves', sprout: true } });
  mon('fuchs', { name: 'Dornfuchs', level: 1, atk: 20, def: 0, hp: 10, bag: 'wild', faces: 'M2A', abil: ['flink'], lore: 'Schneller als sein eigener Schatten.',
    art: { head: 'fox', skin: '#d8742c', eye: '#c8ff6a', ears: 'pointy', mouth: 'smirk', fx: 'leaves', thorns: true } });
  mon('baer', { name: 'Rindenbär', level: 2, atk: 30, def: 20, hp: 20, bag: 'wild', faces: 'ADM', lore: 'Brummt, und der Wald hält den Atem an.',
    art: { head: 'bear', skin: '#6b4a2f', eye: '#ffd36a', ears: 'round', mouth: 'fangs', fx: 'leaves', bark: true } });
  mon('fee', { name: 'Kräuterfee', level: 2, atk: 10, def: 10, hp: 20, bag: 'wild', faces: 'GGM', abil: ['flug', 'heal'], lore: 'Riecht nach Minze und Gewitter.',
    art: { head: 'fairy', skin: '#bfe6a8', eye: '#3a7a2a', hair: '#ffd2f0', wings: '#bfffe6', mouth: 'smile', fx: 'motes' } });
  mon('hirsch', { name: 'Hirschkönig', level: 3, atk: 30, def: 20, hp: 30, bag: 'wild', faces: 'M2ADM', abil: ['sprint'], lore: 'Sein Geweih trägt Moos und Sterne.',
    art: { head: 'stag', skin: '#8a5a34', eye: '#dfffb0', horns: 'antler', mouth: 'none', fx: 'motes', crown: true } });
  mon('wurzel', { name: 'Wurzelhüter', level: 3, atk: 20, def: 30, hp: 40, bag: 'wild', faces: 'D2GTA', abil: ['root'], lore: 'Älter als die Wege, die er bewacht.',
    art: { head: 'tree', skin: '#5b4630', eye: '#a8ff5a', mouth: 'none', fx: 'leaves', leaves: '#4f9a35' } });
  mon('greif', { name: 'Waldgreif', level: 4, atk: 40, def: 30, hp: 40, bag: 'wild', faces: 'M2A2DGM', abil: ['flug', 'aura'], lore: 'Sein Schrei weckt schlafende Samen.',
    art: { head: 'griffin', skin: '#e8dcc0', eye: '#ffb22e', mouth: 'beak', wings: '#7a9a46', fx: 'motes', crest: '#5d8a32' } });

  // 💀 Gebeinkammer
  mon('ratte', { name: 'Knochenratte', level: 1, atk: 20, def: 0, hp: 10, bag: 'gebein', faces: 'MA', lore: 'Nagt am Gerippe der Welt.',
    art: { head: 'rat', skin: '#d9d2c3', eye: '#b06aff', ears: 'round', mouth: 'buck', fx: 'wisps', bony: true } });
  mon('wurm', { name: 'Grabwurm', level: 1, atk: 10, def: 10, hp: 20, bag: 'gebein', faces: 'TM', lore: 'Gräbt, bis es dunkel wird. Und weiter.',
    art: { head: 'worm', skin: '#9a6b86', eye: '#ffe0f0', mouth: 'ring', fx: 'dust' } });
  mon('wache', { name: 'Skelettwache', level: 2, atk: 20, def: 20, hp: 20, bag: 'gebein', faces: 'DAT', abil: ['counter'], lore: 'Hält Wache. Seit dreihundert Jahren.',
    art: { head: 'skull', skin: '#e6dfcf', eye: '#7cf0ff', helm: '#5b6470', mouth: 'teeth', fx: 'wisps' } });
  mon('irrlicht', { name: 'Irrlicht', level: 2, atk: 20, def: 0, hp: 20, bag: 'gebein', faces: 'GMT', abil: ['flug', 'dodge'], lore: 'Wer ihm folgt, kommt nie an.',
    art: { head: 'wisp', skin: '#8ff7ff', eye: '#0b2a40', mouth: 'o', fx: 'wisps' } });
  mon('ritter', { name: 'Gruftritter', level: 3, atk: 30, def: 30, hp: 30, bag: 'gebein', faces: 'ADTM', abil: ['raub'], lore: 'Sein Schwur überdauerte sein Herz.',
    art: { head: 'knight', skin: '#4a4f5c', eye: '#ff3355', plume: '#7a1530', mouth: 'none', fx: 'wisps' } });
  mon('spinne', { name: 'Spinnenkönigin', level: 3, atk: 30, def: 10, hp: 30, bag: 'gebein', faces: 'T2AMT', abil: ['net'], lore: 'Webt Fäden zwischen Gestern und Morgen.',
    art: { head: 'spider', skin: '#2e2238', eye: '#ff4a8a', mouth: 'mandible', fx: 'web', crown: true } });
  mon('lich', { name: 'Schattenfürst', level: 4, atk: 40, def: 30, hp: 40, bag: 'gebein', faces: 'G2ATDM', abil: ['bolt2', 'mirror'], lore: 'Trägt eine Krone aus Mitternacht.',
    art: { head: 'lich', skin: '#cfc6b3', eye: '#9b5cff', hood: '#241a33', mouth: 'teeth', fx: 'wisps', crown: true } });

  // 🌊 Tiefenflut
  mon('krabbe', { name: 'Riffkrabbe', level: 1, atk: 10, def: 20, hp: 10, bag: 'tiefe', faces: 'DM', lore: 'Läuft seitwärts, denkt geradeaus.',
    art: { head: 'crab', skin: '#e2553a', eye: '#1a1a22', mouth: 'mandible', fx: 'bubbles' } });
  mon('qualle', { name: 'Glimmqualle', level: 1, atk: 10, def: 0, hp: 20, bag: 'tiefe', faces: 'GM', abil: ['flug'], lore: 'Leuchtet, wenn sie träumt.',
    art: { head: 'jelly', skin: '#c58cff', eye: '#ffffff', mouth: 'smile', fx: 'bubbles' } });
  mon('muschel', { name: 'Muschelmagier', level: 2, atk: 20, def: 10, hp: 20, bag: 'tiefe', faces: 'GMD', abil: ['freeze'], lore: 'Hört das Meer in jeder Muschel.',
    art: { head: 'mage', skin: '#9fd9d0', eye: '#e6fbff', hood: '#2a5f8a', mouth: 'smirk', fx: 'bubbles', shell: true } });
  mon('hai', { name: 'Sägehai', level: 2, atk: 30, def: 10, hp: 20, bag: 'tiefe', faces: 'AMM', abil: ['sprint'], lore: 'Riecht Angst über drei Riffe hinweg.',
    art: { head: 'shark', skin: '#6c8aa6', eye: '#ffef6a', mouth: 'fangs', fx: 'bubbles', fin: true } });
  mon('krake', { name: 'Tiefseekrake', level: 3, atk: 30, def: 20, hp: 30, bag: 'tiefe', faces: 'AMGD', abil: ['reich'], lore: 'Acht Arme, acht Pläne.',
    art: { head: 'octo', skin: '#8a3a7a', eye: '#ffd84a', mouth: 'none', fx: 'bubbles' } });
  mon('nixe', { name: 'Nixenorakel', level: 3, atk: 20, def: 20, hp: 30, bag: 'tiefe', faces: 'G2MDT', abil: ['swap', 'heal'], lore: 'Singt Lieder, die erst morgen wahr werden.',
    art: { head: 'siren', skin: '#a8e0d8', eye: '#3affd8', hair: '#3a6aff', mouth: 'smile', fx: 'bubbles', fins: true } });
  mon('levi', { name: 'Leviathan', level: 4, atk: 50, def: 20, hp: 40, bag: 'tiefe', faces: 'A2M2GDA', abil: ['wave'], lore: 'Wenn er gähnt, kippen Ozeane.',
    art: { head: 'serpent', skin: '#1f6a7a', eye: '#b8ff3a', horns: 'fins', mouth: 'fangs', fx: 'bubbles', crest: '#42d6c0' } });

  // item dice (level 2): they bring an item instead of a monster
  function item(key, o) { M[key] = Object.assign({ key, abil: [], kind: 'item', item: key, level: 2 }, o); }
  item('grube', { name: 'Fallgrube', faces: 'TMT', lore: 'Ein Loch. Mit Absicht.', art: { head: 'rune', skin: '#a6d94a', glyph: 'pit' } });
  item('quelle', { name: 'Heilquell', faces: 'GDM', lore: 'Das Wasser erinnert sich an Wunden.', art: { head: 'rune', skin: '#5ad1ff', glyph: 'spring' } });
  item('kristall', { name: 'Kristallader', faces: 'GGM', lore: 'Die Wände singen hier leise.', art: { head: 'rune', skin: '#e070ff', glyph: 'crystal' } });

  // ---- dice ----
  // a die: the monster key and its six fixed faces. Level L has 5−L summon faces
  function facesOf(key) {
    const m = M[key], out = [];
    for (let i = 0; i < 5 - m.level; i++) out.push({ c: 'SUM', n: 1 });
    const re = /([MADGT])(\d?)/g;
    let x;
    while ((x = re.exec(m.faces))) out.push({ c: LETTER[x[1]], n: x[2] ? +x[2] : 1 });
    return out;
  }

  // ---- dice bags: 15 dice each. 5×L1, 4×L2 + 1 item die, 3×L3, 2×L4 ----
  const BAGS = {
    glut: { name: 'Glutschmiede', emoji: '🔥', color: '#ff7a3d', text: 'Angriffslustig: hohe Angriffswerte, Feuerzauber und ein Drache.',
      dice: ['funke', 'funke', 'funke', 'kaefer', 'kaefer', 'hund', 'hund', 'hexe', 'hexe', 'grube', 'golem', 'golem', 'loewe', 'drache', 'drache'] },
    wild: { name: 'Wildwuchs', emoji: '🌿', color: '#6fd04a', text: 'Flink und zäh: schnelle Tiere, Heilung und Wurzelfesseln.',
      dice: ['moos', 'moos', 'moos', 'fuchs', 'fuchs', 'baer', 'baer', 'fee', 'fee', 'quelle', 'hirsch', 'hirsch', 'wurzel', 'greif', 'greif'] },
    gebein: { name: 'Gebeinkammer', emoji: '💀', color: '#b48cff', text: 'Hinterhältig: Fallen, Gegenschläge und Lebensraub.',
      dice: ['ratte', 'ratte', 'ratte', 'wurm', 'wurm', 'wache', 'wache', 'irrlicht', 'irrlicht', 'grube', 'ritter', 'ritter', 'spinne', 'lich', 'lich'] },
    tiefe: { name: 'Tiefenflut', emoji: '🌊', color: '#3fb6ff', text: 'Listig: lange Arme, Frost, Platztausch und eine Flutwelle.',
      dice: ['krabbe', 'krabbe', 'krabbe', 'qualle', 'qualle', 'muschel', 'muschel', 'hai', 'hai', 'kristall', 'krake', 'krake', 'nixe', 'levi', 'levi'] }
  };
  const BAG_KEYS = Object.keys(BAGS);

  // seats: colour and where the master sits. Player 1 red at the bottom, 2 blue at the top, 3 green left, 4 violet right
  const SEATS = [
    { name: 'Rot', color: '#ff3b4e', glow: '#ff6a78', side: 'bottom' },
    { name: 'Blau', color: '#2f8bff', glow: '#6aaeff', side: 'top' },
    { name: 'Grün', color: '#2fd36a', glow: '#6cf09a', side: 'left' },
    { name: 'Violett', color: '#b45cff', glow: '#cf93ff', side: 'right' }
  ];
  const BOT_NAMES = ['Grimbart', 'Morla', 'Zinder', 'Kauz'];

  const api = { CRESTS, POOL, CREST, NETS, ORIENT, ABIL, UNIVERSAL, ITEMS, MONSTERS: M, facesOf, BAGS, BAG_KEYS, SEATS, BOT_NAMES };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VerliesData = api;
})(typeof window !== 'undefined' ? window : globalThis);
