(function () {
  const list = [];
  const metaByKey = {};
  const screenGames = {};
  const controllerGames = {};

  window.GAME_LIST = list;
  window.GAME_META = metaByKey;
  window.GAMES = screenGames;
  window.CONTROLLERS = controllerGames;

  // Merge-basiert: meta.js liefert key/label/min/settings (Single Source,
  // von beiden Seiten geladen), screen.js/controller.js nur ihre Factory.
  function registerGame(meta) {
    if (!meta || !meta.key) throw new Error('Game registration needs a key');
    let m = metaByKey[meta.key];
    if (!m) { m = metaByKey[meta.key] = { key: meta.key, label: meta.key, min: 1, settings: {} }; list.push(m); }
    if (meta.label) m.label = meta.label;
    if (meta.min) m.min = meta.min;
    if (meta.settings) m.settings = meta.settings;
    if (meta.about) m.about = meta.about;      // one sentence for the lobby
    if (meta.cat) m.cat = meta.cat;            // lobby category, see GAME_CATS
    if (meta.screen) screenGames[meta.key] = meta.screen;
    if (meta.controller) controllerGames[meta.key] = meta.controller;
  }

  // Lobby categories, in the order the phones show them. A game without `cat` lands in the first one.
  window.GAME_CATS = [
    { key: 'action', label: '🏁 Action' },
    { key: 'duell', label: '⚔️ Duell & Taktik' },
    { key: 'koop', label: '🤝 Zusammen' },
    { key: 'kreativ', label: '🎨 Kreativ' },
    { key: 'raten', label: '🧠 Raten & Reden' }
  ];

  window.registerGame = registerGame;
  globalThis.registerGame = registerGame;
})();
