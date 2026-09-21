/* Party Hub adapter: the laptop owns the simulation, each phone owns one split-screen view. */
registerGame({ key: 'breach', screen: function () {
  let model, view, wrap, input, sound, ids = [], cfg, last = 0, sent = 0, reported = false, previousRound = 0, epoch = 0;
  function messageState() {
    if (!model) return;
    ids.forEach(id => {
      const p = model.actors.find(a => a.id === id); if (!p) return;
      ac.message(id, { t: 'brState', epoch, phase: model.phase, round: model.round, hp: Math.ceil(p.hp), ammo: p.ammo, reserve: p.reserve, reload: p.reload, alive: p.alive,
        smoke: p.smoke, weapon: p.weapon, score: model.score, host: id === hostId(), yaw: p.yaw, pitch: p.pitch,
        mode: model.cfg.mode, respawn: p.respawn, spawnShield: p.spawnShield, objective: BreachFeedback.objective(model, p),
        kills: model.stats[id].kills, index: ids.indexOf(id) + 1, count: ids.length });
    });
  }
  function cleanup() {
    if (input) input.dispose(); if (view) view.dispose(); if (sound) sound.dispose();
    if (wrap) wrap.remove(); cv.style.display = ''; input = view = sound = wrap = model = null;
  }
  return {
    acceptsJoin: false,
    canResume(id) { return !!model && ids.includes(id); },
    onReconnect(id) { if (model && ids.includes(id)) { model.input(id, { reset: true }); messageState(); } },
    start(order, options) {
      ids = order.slice(); cfg = options || {}; reported = false;
      if (!window.THREE || !window.BreachView) { endToLobby('BREACH braucht einen Browser mit WebGL 2.'); return; }
      try {
        wrap = document.createElement('div'); wrap.id = 'br-split';
        wrap.style.cssText = 'position:relative;width:min(1200px,calc(100vw - 20px));height:min(750px,calc(100vh - 84px));margin:auto;overflow:hidden;border-radius:8px;';
        cv.insertAdjacentElement('afterend', wrap); view = new BreachView(wrap); sound = new BreachSound();
        input = new BreachInput(view.renderer.domElement); input.enabled = true;
        if (navigator.userActivation?.hasBeenActive) sound.unlock(); cv.style.display = 'none';
        model = new BreachGame.Match(ids, cfg); previousRound = model.round; last = performance.now(); sent = 0; messageState();
      } catch (e) { cleanup(); endToLobby('3D konnte nicht starten. Hardwarebeschleunigung aktivieren.'); }
    },
    stop: cleanup,
    onDisconnect(id) {
      ids = ids.filter(i => i !== id); if (model) model.disconnect(id);
      if (!ids.length) endToLobby('Alle Operator haben den Einsatz verlassen.'); else messageState();
    },
    onMessage(id, d) {
      if (!model || !ids.includes(id) || !d) return;
      if (d.t === 'brInput') model.input(id, d.input);
      if (d.t === 'brAgain' && id === hostId() && model.phase === 'end') {
        model = new BreachGame.Match(ids, cfg); epoch++; reported = false; previousRound = 0; input.yaw = 0; input.pitch = 0; messageState();
      }
    },
    render() {
      if (!model || !view) return;
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (input.locked) model.input(ids[0], input.read());
      model.step(dt);
      if (previousRound !== model.round) { previousRound = model.round; input.yaw = 0; input.pitch = 0; }
      const events = model.events.splice(0), names = {}; ids.forEach(id => names[id] = nameOf(id));
      sound.muted = !!window.sfx?.muted;
      view.effects(events, names); sound.events(events, ids); view.draw(model, ids, names, dt);
      if (now - sent > 100) { sent = now; messageState(); }
      if (model.phase === 'end' && !reported) {
        reported = true;
        if (model.cfg.mode === 'ffa') { if (ids.includes(model.result.winnerId)) reportWinners([model.result.winnerId]); }
        else if (model.result.team === 0) reportWinners(ids);
        messageState();
      }
    },
    _debug() { return model; }
  };
} });
