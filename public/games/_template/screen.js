// TEMPLATE — a complete, working mini-game: "Blitz-Klicker".
// Everyone hammers the button on their phone; first to reach the target wins.
// It demonstrates the full screen-module contract in ~100 lines:
// lifecycle, per-player state, HUD, winner + host rematch, disconnects.
registerGame({ key: 'meingame', screen: function () {
  // The screen factory is called fresh on every game start — put your
  // per-round state in this closure.
  const W = cv.width, H = cv.height;

  let order = [];          // player ids, sorted
  let clicks = {};         // id -> count
  let ziel = 30;           // target, from settings
  let phase = 'run';       // run | end
  let winner = null;

  return {
    // false = players who join mid-game just spectate until the next round
    acceptsJoin: false,

    // ids: array of device-ids of all named players (sorted ascending)
    // cfg: current values of the settings declared in meta.js
    start(ids, cfg) {
      order = ids.slice();
      ziel = (cfg && cfg.ziel) || 30;
      clicks = {};
      order.forEach(id => { clicks[id] = 0; });
      phase = 'run';
      winner = null;
      // Tell every phone the round started (your own message types —
      // prefix them with your key to avoid collisions):
      order.forEach(id => ac.message(id, { t: 'mgState', phase: 'run', ziel }));
    },

    // Host pressed ✕ abort: stop timers/intervals if you created any.
    stop() {},

    // A player disconnected: clean up, and end the game if it became unplayable.
    onDisconnect(id) {
      order = order.filter(o => o !== id);
      delete clicks[id];
      if (order.length < 2) endToLobby('Zu wenige Spieler.');
    },

    // Message from a phone. ALWAYS validate: is it a player? is the move legal?
    onMessage(id, d) {
      if (!d || clicks[id] === undefined) return;
      if (d.t === 'mgClick' && phase === 'run') {
        clicks[id]++;
        if (clicks[id] >= ziel) {
          phase = 'end';
          winner = id;
          setBanner('🏆 ' + nameOf(id) + ' gewinnt!', 4000);
          const h = hostId();
          order.forEach(o => ac.message(o, { t: 'mgEnd', win: o === id, name: nameOf(id), host: o === h }));
        }
      } else if (d.t === 'mgAgain' && id === hostId() && phase === 'end') {
        // Host rematch — restart with the same settings.
        this.start(order, { ziel });
      }
    },

    // Called every animation frame. There is no separate tick loop:
    // simulate AND draw here, using performance.now() deltas if you need dt.
    render() {
      ctx.fillStyle = '#0d0d1a';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.font = 'bold 34px system-ui,sans-serif';
      ctx.fillText('🎮 Blitz-Klicker — erster bei ' + ziel + '!', W / 2, 50);

      // One progress bar per player, in their color:
      order.forEach((id, i) => {
        const y = 120 + i * 56, w = W - 240;
        ctx.fillStyle = 'rgba(255,255,255,.12)';
        rr(ctx, 120, y, w, 34, 17); ctx.fill();
        ctx.fillStyle = players[id] ? players[id].color : '#888';
        rr(ctx, 120, y, Math.max(34, w * clicks[id] / ziel), 34, 17); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 16px system-ui,sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(shortName(id) + ' · ' + clicks[id], 132, y + 17);
        ctx.textAlign = 'center';
      });

      if (phase === 'end' && winner !== null) {
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 48px system-ui,sans-serif';
        ctx.fillText('🏆 ' + nameOf(winner) + ' gewinnt!', W / 2, H / 2 - 20);
        ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '17px system-ui,sans-serif';
        ctx.fillText('⭐ Host kann am Handy eine Revanche starten', W / 2, H / 2 + 40);
      }
    },

    // Optional but recommended: lets your dev.html bots inspect game state.
    _debug() { return { clicks, order, phase, ziel }; }
  };
}});
