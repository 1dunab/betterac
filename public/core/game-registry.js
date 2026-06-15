(function () {
  const list = [];
  const screenGames = {};
  const controllerGames = {};

  window.GAME_LIST = list;
  window.GAMES = screenGames;
  window.CONTROLLERS = controllerGames;

  function registerGame(meta) {
    if (!meta || !meta.key) throw new Error('Game registration needs a key');
    if (!list.some(g => g.key === meta.key)) list.push({ key: meta.key, label: meta.label || meta.key, min: meta.min || 1 });
    if (meta.screen) screenGames[meta.key] = meta.screen;
    if (meta.controller) controllerGames[meta.key] = meta.controller;
  }

  window.registerGame = registerGame;
  globalThis.registerGame = registerGame;
})();
