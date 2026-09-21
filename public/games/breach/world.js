/* Shared, deterministic map geometry. Rendered cover and simulated cover use these same boxes. */
(function (root) {
  'use strict';
  const boxes = [];
  const add = (x, z, w, d, h, kind, color) => boxes.push({ x, z, w, d, h, kind, color });
  // Station perimeter, with a low observation wall facing the planet.
  add(-30, 0, 1, 56, 5.5, 'wall', '#293d4b');
  add(30, 0, 1, 56, 1.1, 'wall', '#566575');
  add(0, -28, 61, 1, 5.5, 'wall', '#293d4b');
  add(0, 28, 61, 1, 4, 'wall', '#253845');
  // Warehouse: open central door and side entrances. Three distinct routes.
  add(-19, -11, 1, 22, 6, 'warehouse', '#354956');
  add(-7, -18, 1, 8, 6, 'warehouse', '#354956');
  add(-7, -3, 1, 6, 6, 'warehouse', '#354956');
  add(-13, -22, 13, 1, 6, 'warehouse', '#354956');
  add(-17, 0, 5, 1, 6, 'warehouse', '#354956');
  add(-8, 0, 3, 1, 6, 'warehouse', '#354956');
  // Colour coded freight creates a readable middle lane and the B yard.
  add(1, 12, 5, 11, 3.2, 'container', '#246570');
  add(-12, 11, 11, 4.5, 3.2, 'container', '#ac5336');
  add(13, 3, 5, 12, 3.2, 'container', '#a56a34');
  add(6, -9, 5, 11, 3.2, 'container', '#376a76');
  add(23, -10, 5, 11, 3.2, 'container', '#934938');
  add(12, -23, 12, 4, 3.2, 'container', '#47637c');
  // Chest-high cover, flanking cover and spawn protection.
  add(-23, 12, 3, 3, 1.25, 'crate', '#8c7251');
  add(-12, -12, 3, 3, 1.25, 'crate', '#897758');
  add(-15, -18, 3, 2, 2.3, 'crate', '#8c7251');
  add(-2, -21, 3, 4, 1.25, 'crate', '#8c7251');
  add(17, -15, 3, 3, 1.25, 'crate', '#8c7251');
  add(23, 12, 4, 3, 1.25, 'crate', '#8c7251');
  add(10, 20, 5, 1.2, 1.2, 'barrier', '#99978c');
  add(-6, 22, 4, 1.2, 1.2, 'barrier', '#99978c');
  const world = {
    modes: {
      tactical: { label: 'Bombenmission', description: 'Bombe auf A oder B legen oder entschärfen. Kein Wiedereinstieg in der Runde.', duration: 90, respawn: false },
      deathmatch: { label: 'Team-Deathmatch', description: 'In 150 Sekunden mehr Abschüsse als das andere Team sammeln. Wiedereinstieg nach 3 Sekunden.', duration: 150, respawn: true },
      ffa: { label: 'Free for All', description: 'Jeder gegen jeden. Freie Waffenwahl, zuerst 15 Abschüsse oder die meisten nach 3 Minuten. Quickscope mit MR-9 und Longbow.', duration: 180, respawn: true, ffa: true },
      arsenal: { label: 'Waffenrennen', description: 'Jeder Team-Abschuss schaltet die nächste Waffe frei. Mit allen 10 Waffen punkten und gewinnen.', duration: 240, respawn: true },
      control: { label: 'Zonenkontrolle', description: 'A und B jeweils 3 Sekunden besetzen. Gehaltene Zonen bringen Punkte; zuerst 60 Punkte gewinnt.', duration: 180, respawn: true },
      survival: { label: 'Überleben', description: 'Gemeinsam 5 Gegnerwellen besiegen. Gefallene und Ausrüstung kommen zur nächsten Welle zurück.', duration: 120, respawn: false, coop: true }
    },
    arsenalOrder: ['pistol', 'smg', 'shotgun', 'carbine', 'rifle', 'burst', 'marksman', 'lmg', 'sniper', 'revolver'],
    controlTarget: 60, survivalWaves: 5, ffaTarget: 15, quickscopeWindow: 0.35,
    ffaSpawns: [{ x: 3.8, z: 24 }, { x: -24, z: -23 }, { x: 26, z: -21 }, { x: -24, z: 5 }, { x: 26, z: 6 }, { x: 0, z: -13 }, { x: -13, z: -7 }, { x: 20, z: 24 }],
    bounds: { minX: -29, maxX: 29, minZ: -27, maxZ: 27 }, boxes,
    sites: [{ key: 'A', x: -13, z: -6, r: 3.5 }, { key: 'B', x: 16, z: -9, r: 3.5 }],
    spawns: [{ x: 3.8, z: 24 }, { x: 6, z: 24 }, { x: -1, z: 24 }, { x: -4, z: 25 }, { x: -10, z: 24 }, { x: -18, z: 24 }, { x: 14, z: 24 }, { x: 20, z: 24 }],
    guards: [{ x: -13, z: -7 }, { x: -24, z: -10 }, { x: 0, z: -13 }, { x: 16, z: -9 }, { x: 26, z: -21 }, { x: -3, z: -25 }, { x: 26, z: -4 }, { x: -24, z: -23 }],
    patrols: [[-24, 5], [-24, -18], [-12, -6], [-3, -7], [2, -18], [17, -4], [17, -18], [26, 6], [5, 4]],
    weapons: {
      rifle: { name: 'AR-7', label: 'Sturmgewehr', hint: 'Vielseitig · ruhiger Rückstoß', mag: 30, reserve: 180, damage: 32, delay: 0.115, reload: 1.45, spread: 0.007, range: 50, color: '#efbc69', shape: 'rifle' },
      smg: { name: 'Vektor', label: 'Maschinenpistole', hint: 'Schnell · stark auf kurze Distanz', mag: 32, reserve: 224, damage: 24, delay: 0.07, reload: 1.15, spread: 0.013, range: 23, color: '#8de0df', shape: 'smg' },
      pistol: { name: 'P12', label: 'Pistole', hint: 'Präzise · schnell nachgeladen', mag: 15, reserve: 120, damage: 43, delay: 0.24, reload: 0.95, spread: 0.004, range: 32, color: '#bdc5d5', shape: 'pistol' },
      shotgun: { name: 'Bulldog', label: 'Schrotflinte', hint: '8 Schrotkugeln · nah sehr stark', mag: 8, reserve: 64, damage: 15, pellets: 8, delay: 0.65, reload: 1.8, spread: 0.1, range: 13, color: '#ffae83', shape: 'shotgun', recoil: 0.6 },
      marksman: { name: 'MR-9', label: 'Präzisionsgewehr', hint: 'Zielfernrohr · präzise Einzelschüsse', mag: 16, reserve: 96, damage: 58, delay: 0.34, reload: 1.5, spread: 0.003, range: 80, zoom: 42, color: '#a7d5b0', shape: 'marksman' },
      sniper: { name: 'Longbow', label: 'Scharfschützengewehr', hint: 'Schnelles Visier · starke Körpertreffer', mag: 6, reserve: 48, damage: 95, scopedDamage: 145, delay: 0.95, reload: 2.1, spread: 0.001, range: 110, zoom: 30, color: '#dad3ff', shape: 'sniper', recoil: 0.7 },
      lmg: { name: 'Atlas', label: 'Leichtes MG', hint: '75 Schuss · schwerer, aber ausdauernd', mag: 75, reserve: 300, damage: 27, delay: 0.105, reload: 2.6, spread: 0.011, range: 48, speed: 0.87, color: '#dfc689', shape: 'lmg' },
      burst: { name: 'Pulse-3', label: 'Salvengewehr', hint: '3er-Salve · kontrollierte Feuerstöße', mag: 30, reserve: 180, damage: 28, delay: 0.075, burst: 3, burstDelay: 0.38, reload: 1.4, spread: 0.005, range: 55, color: '#9bc8ff', shape: 'burst' },
      carbine: { name: 'Kestrel', label: 'Leichter Karabiner', hint: 'Agil · präzise beim Bewegen', mag: 24, reserve: 192, damage: 29, delay: 0.1, reload: 1.1, spread: 0.004, range: 40, speed: 1.07, color: '#a2e5bc', shape: 'carbine' },
      revolver: { name: 'Titan .50', label: 'Schwere Pistole', hint: '6 Schuss · hohe Durchschlagskraft', mag: 6, reserve: 72, damage: 68, delay: 0.42, reload: 1.6, spread: 0.003, range: 45, color: '#e2a6bb', shape: 'revolver', recoil: 0.45 }
    },
    difficulties: {
      easy: { reaction: 1.3, delay: 0.8, damage: 7, spread: 0.13, sight: 22, turn: 2.4 },
      normal: { reaction: 0.95, delay: 0.6, damage: 11, spread: 0.075, sight: 28, turn: 3 },
      hard: { reaction: 0.45, delay: 0.32, damage: 16, spread: 0.026, sight: 34, turn: 4 }
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = world;
  else root.BreachWorld = world;
})(typeof globalThis !== 'undefined' ? globalThis : this);
