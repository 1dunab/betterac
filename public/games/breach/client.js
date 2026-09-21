(function () {
  'use strict';
  window.initBreachApp = function () {
    const $ = id => document.getElementById(id), stage = $('br-stage');
    let view;
    try { view = new BreachView(stage); } catch (e) {
      $('br-fatal').hidden = false; $('br-fatal').textContent = '3D konnte nicht starten. Bitte aktiviere Hardwarebeschleunigung und verwende einen aktuellen Browser mit WebGL 2. ' + e.message; return;
    }
    const sound = new BreachSound(); let ws = null, room = null, myId = null, state = null, local = null, online = false, version = -1, lastRound = -1;
    let playing = false, paused = false, names = {}, lastFrame = performance.now(), lastSend = 0, lastPing = 0, lastSnapshot = 0, stopped = false, currentInput = {};
    const smooth = new Map(), preview = new BreachGame.Match(['preview'], { target: 3 });
    const input = new BreachInput(view.renderer.domElement, { onLock(locked) {
      if (!locked && playing && !matchMedia('(pointer: coarse)').matches) pause();
    } }); input.touch(stage);
    const error = message => { $('br-error').textContent = message; $('br-room-error').textContent = message; };
    const send = data => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
    for (const id of ['br-mode', 'br-solo-mode']) {
      $(id).replaceChildren(); Object.entries(BreachWorld.modes).forEach(([key, mode]) => { const option = document.createElement('option'); option.value = key; option.textContent = mode.label; $(id).append(option); });
    }
    const soloHint = () => { $('br-solo-hint').textContent = BreachWorld.modes[$('br-solo-mode').value].description; };
    $('br-solo-mode').addEventListener('change', soloHint); soloHint();
    try { $('br-name').value = localStorage.getItem('breach-name') || 'Operator'; } catch (_) {}
    const invited = new URLSearchParams(location.search).get('room'); if (invited) $('br-code').value = invited.toUpperCase().slice(0, 5);
    function controlsEnabled(value) { $('br-create').disabled = $('br-join').disabled = !value; }
    function showHome() {
      playing = false; paused = false; input.enabled = false; input.clear(); document.body.classList.remove('br-playing');
      $('br-menu').hidden = false; $('br-home').hidden = false; $('br-room').hidden = true; $('br-pause').hidden = true; $('br-game-tools').hidden = true;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    function showRoom() {
      playing = false; paused = false; input.enabled = false; input.clear(); document.body.classList.remove('br-playing');
      $('br-menu').hidden = false; $('br-home').hidden = true; $('br-room').hidden = false; $('br-pause').hidden = true; $('br-game-tools').hidden = true;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    function beginView(lock = false) {
      playing = true; paused = false; input.enabled = true; sound.unlock();
      $('br-menu').hidden = true; $('br-pause').hidden = true; $('br-game-tools').hidden = false; document.body.classList.add('br-playing');
      if (lock && !matchMedia('(pointer: coarse)').matches) input.lock();
      else if (!input.locked && !matchMedia('(pointer: coarse)').matches) pause();
    }
    function pause() {
      if (!playing) return; paused = true; input.enabled = false; input.clear(); $('br-pause').hidden = false;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    function renderRoom() {
      if (!room) return;
      names = {}; room.players.forEach(p => { names[p.id] = p.name; });
      $('br-room-code').textContent = room.code;
      const isHost = room.host === myId, active = room.phase !== 'lobby' && room.phase !== 'end';
      const mode = BreachWorld.modes[room.cfg.mode], coop = room.cfg.mode === 'survival', ffa = !!mode.ffa;
      $('br-mode-info').textContent = mode.label + ' · ' + mode.description;
      $('br-target').hidden = document.querySelector('label[for=br-target]').hidden = room.cfg.mode !== 'tactical';
      $('br-bots').parentElement.hidden = coop;
      document.querySelectorAll('.br-team').forEach((section, team) => {
        section.hidden = ffa && team === 1;
        section.querySelector('b').textContent = ffa ? 'OPERATOR · JEDER GEGEN JEDEN' : coop ? team ? '02 / GEGNERWELLEN' : '01 / EURE CREW' : room.cfg.mode === 'tactical' ? team ? '02 / VERTEIDIGUNG' : '01 / ANGRIFF' : team ? '02 / TEAM KORALLE' : '01 / TEAM CYAN';
        section.querySelector('small').textContent = ffa ? 'Freie Waffenwahl · keine Teams · 15 Abschüsse' : coop ? team ? '5 Wellen · mehr Gegner und höhere Stärke' : 'Alle Freunde kämpfen gemeinsam.' : room.cfg.mode === 'tactical' ? team ? 'Bombe entschärfen.' : 'Bombe legen.' : room.cfg.mode === 'control' ? 'Zonen besetzen und halten.' : room.cfg.mode === 'arsenal' ? 'Gemeinsam durch alle 10 Waffen.' : 'Mehr Team-Abschüsse sammeln.';
      });
      document.querySelector('.br-room-hint').textContent = coop ? 'Gefallene kehren zur nächsten Welle zurück. Alle starten geheilt und mit voller Munition.' : 'Freie Plätze können mit Bots aufgefüllt werden. Bis zu 8 Freunde pro Raum.';
      $('br-config').hidden = !isHost; $('br-start').hidden = !isHost || active; $('br-watch').hidden = !active;
      ['br-mode', 'br-difficulty', 'br-target', 'br-bots'].forEach(id => $(id).disabled = active);
      $('br-start').firstChild.textContent = room.phase === 'end' ? 'REVANCHE STARTEN ' : 'EINSATZ STARTEN ';
      const winner = ffa ? names[room.result?.winnerId] || 'Sicherheits-Bot' : coop ? room.result?.team === 0 ? 'Crew' : 'Stationswache' : room.cfg.mode === 'tactical' ? room.result?.team === 0 ? 'Angriff' : 'Verteidigung' : room.result?.team === 0 ? 'Team Cyan' : 'Team Koralle';
      const draw = ffa ? room.result?.winnerId == null : room.result?.team === null;
      $('br-room-status').textContent = active ? 'Einsatz läuft. Neue Operator steigen beim nächsten Match ein.' : room.phase === 'end' && room.result ? (draw ? 'Unentschieden' : winner + ' gewinnt') + ' · ' + room.result.reason + '. Bereit für eine Revanche?' : isHost ? ffa ? 'Teilt den Link. Jeder spielt für sich; ihr braucht keine Teams.' : coop ? 'Teilt den Link und überlebt gemeinsam fünf Wellen.' : 'Teilt den Link, wählt eure Teams und startet den Einsatz.' : 'Warte, bis der Host den Einsatz startet.';
      for (const team of [0, 1]) {
        const ul = $('br-team' + team); ul.replaceChildren();
        const list = ffa ? team === 0 ? room.players : [] : room.players.filter(p => p.team === team);
        list.forEach(p => { const li = document.createElement('li'); li.textContent = p.name; const tag = document.createElement('span'); tag.textContent = p.id === myId ? 'DU' : p.id === room.host ? 'HOST' : 'BEREIT'; li.append(tag); ul.append(li); });
        if (coop && team === 1) { const li = document.createElement('li'); li.textContent = 'Stationswache · KI'; ul.append(li); }
        else if (!coop && room.cfg.fillBots && (!ffa || team === 0)) for (let n = list.length; n < (ffa ? 6 : 3); n++) { const li = document.createElement('li'); li.textContent = 'Sicherheits-Bot'; const tag = document.createElement('span'); tag.textContent = 'KI'; li.append(tag); ul.append(li); }
      }
      $('br-mode').value = room.cfg.mode; $('br-difficulty').value = room.cfg.difficulty; $('br-target').value = room.cfg.target; $('br-bots').checked = room.cfg.fillBots;
      document.querySelectorAll('[data-team]').forEach(b => { b.disabled = active || coop || ffa; b.hidden = coop || ffa; });
    }
    function connect(code) {
      const name = $('br-name').value.trim(); if (!name) { error('Gib zuerst deinen Rufnamen ein.'); $('br-name').focus(); return; }
      sound.unlock(); error(''); controlsEnabled(false);
      if (ws) ws.close(); room = null; local = null; state = null; version = -1; lastRound = -1; smooth.clear(); online = true;
      try { localStorage.setItem('breach-name', name); } catch (_) {}
      const socket = ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/breach-ws');
      const timeout = setTimeout(() => { if (socket === ws && !room) { socket.close(); error('Verbindung dauert zu lange. Ist der Spielserver erreichbar?'); controlsEnabled(true); } }, 8000);
      socket.addEventListener('open', () => { if (socket === ws) send({ t: 'join', name, code }); });
      socket.addEventListener('message', event => {
        if (socket !== ws) return; let d; try { d = JSON.parse(event.data); } catch (_) { return; }
        if (d.t === 'welcome') { myId = d.id; controlsEnabled(true); clearTimeout(timeout); }
        if (d.t === 'error') { error(d.message); controlsEnabled(true); }
        if (d.t === 'room') {
          const wasLobby = !room || room.phase === 'lobby' || room.phase === 'end'; room = d; renderRoom();
          if (d.phase === 'lobby' || d.phase === 'end') showRoom();
          else if (wasLobby) beginView(false);
        }
        if (d.t === 'state') {
          state = d.state; lastSnapshot = performance.now();
          if (version !== d.version || lastRound !== state.round) {
            version = d.version; lastRound = state.round; smooth.clear();
            const me = state.actors.find(p => p.id === myId); if (me) { input.yaw = me.yaw; input.pitch = me.pitch; }
          }
          view.effects(d.events, names); sound.events(d.events, myId);
        }
        if (d.t === 'pong') $('br-net').textContent = Math.round(performance.now() - d.at) + ' MS · ' + (room ? room.code : 'ONLINE');
      });
      socket.addEventListener('close', () => {
        clearTimeout(timeout); if (socket !== ws) return; ws = null; room = null; state = null; online = false; controlsEnabled(true); showHome(); error('Verbindung getrennt. Du kannst einem Raum erneut beitreten.');
      });
      socket.addEventListener('error', () => { if (socket === ws) error('Server nicht erreichbar. Starte das Spiel über den Node-Server.'); });
    }
    $('br-create').addEventListener('click', () => connect(''));
    $('br-join').addEventListener('click', () => { const code = $('br-code').value.trim().toUpperCase(); if (!/^[A-Z0-9]{5}$/.test(code)) error('Der Raumcode hat 5 Buchstaben oder Ziffern.'); else connect(code); });
    $('br-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('br-join').click(); });
    $('br-training').addEventListener('click', () => {
      if (ws) { const old = ws; ws = null; old.close(); } room = null; online = false; myId = 'local'; names = { local: $('br-name').value.trim() || 'Operator' };
      local = new BreachGame.Match([myId], { difficulty: 'easy', target: 3, mode: $('br-solo-mode').value }); state = local; lastRound = state.round; input.yaw = 0; input.pitch = 0; smooth.clear(); $('br-net').textContent = 'SOLO · ' + BreachWorld.modes[local.cfg.mode].label.toUpperCase(); beginView(true);
    });
    $('br-start').addEventListener('click', () => { sound.unlock(); send({ t: 'start' }); });
    ['br-mode', 'br-difficulty', 'br-target', 'br-bots'].forEach(id => $(id).addEventListener('change', () => send({ t: 'config', mode: $('br-mode').value, difficulty: $('br-difficulty').value, target: Number($('br-target').value), fillBots: $('br-bots').checked })));
    document.querySelectorAll('[data-team]').forEach(b => b.addEventListener('click', () => send({ t: 'team', team: Number(b.dataset.team) })));
    $('br-copy').addEventListener('click', async () => {
      const url = new URL('breach.html', location.href); url.searchParams.set('room', room.code);
      if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        try { const info = await (await fetch('/info')).json(); if (info.ips && info.ips[0]) url.hostname = info.ips[0]; } catch (_) {}
      }
      try { await navigator.clipboard.writeText(url.href); $('br-copy').textContent = 'LINK KOPIERT ✓'; }
      catch (_) { $('br-invite').hidden = false; $('br-invite').value = url.href; $('br-invite').select(); $('br-copy').textContent = 'LINK UNTEN KOPIEREN'; }
    });
    $('br-leave').addEventListener('click', () => { const old = ws; ws = null; if (old) old.close(); room = null; state = null; online = false; local = null; showHome(); error(''); });
    $('br-resume').addEventListener('click', () => beginView(true)); $('br-watch').addEventListener('click', () => beginView(true));
    $('br-menu-button').addEventListener('click', pause);
    $('br-armory-button').addEventListener('click', pause);
    Object.entries(BreachWorld.weapons).forEach(([key, weapon], i) => {
      const button = document.createElement('button'); button.className = 'br-armory-option'; button.dataset.weapon = key;
      button.innerHTML = `<b style="color:${weapon.color}">${(i + 1) % 10} · ${weapon.name}</b><span>${weapon.label}</span><small>${weapon.mag} SCHUSS · ${weapon.hint}</small>`;
      button.addEventListener('click', () => { beginView(true); delete input.edges.reset; input.edges.weapon = key; }); $('br-armory-grid').append(button);
    });
    $('br-desktop-sensitivity').value = input.settings.sensitivity;
    $('br-desktop-sensitivity').addEventListener('input', e => input.updateSettings({ sensitivity: Number(e.target.value) }));
    $('br-return').addEventListener('click', () => { if (room) showRoom(); else { local = null; state = null; showHome(); } });
    $('br-audio').addEventListener('click', () => { sound.unlock(); sound.muted = !sound.muted; $('br-audio').textContent = sound.muted ? 'TON AUS' : 'TON AN'; });
    $('br-fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('br-app').requestFullscreen(); } catch (_) {} });
    document.addEventListener('keydown', e => { if (e.code === 'Escape' && playing) pause(); });
    function frame(now) {
      if (stopped) return;
      const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
      currentInput = input.read();
      if (local && playing && !paused) {
        local.input(myId, currentInput); local.step(dt); state = local;
        if (lastRound !== local.round) { lastRound = local.round; input.yaw = 0; input.pitch = 0; }
        const events = local.events.splice(0); view.effects(events, names); sound.events(events, myId);
        if (local.phase === 'end') { $('br-return').textContent = 'ZUM START · NEUES TRAINING'; pause(); }
      }
      if (online && ws) {
        // Action edges are sent immediately; held controls are refreshed at 30 Hz.
        if (now - lastSend > 32 || currentInput.fireTap || currentInput.quickscope || currentInput.cancelQuickscope || currentInput.cancelFire || currentInput.reset || currentInput.reload || currentInput.smoke || currentInput.jump || currentInput.weapon) { send({ t: 'input', input: currentInput }); lastSend = now; }
        if (now - lastPing > 2000) { send({ t: 'ping', at: now }); lastPing = now; }
        if (playing && lastSnapshot && now - lastSnapshot > 2000) $('br-net').textContent = 'VERBINDUNG WIRD GEPRÜFT …';
      }
      if (playing && state) {
        let me = state.actors.find(a => a.id === myId);
        const lockedWeapons = state.cfg.mode === 'arsenal';
        $('br-armory-button').disabled = lockedWeapons;
        $('br-pause-mode').textContent = state.phase === 'end' ? state.result.reason : BreachWorld.modes[state.cfg.mode].description;
        if (me) {
          input.setContext(state.cfg.mode, me.weapon, me.alive && state.phase === 'live');
          document.querySelectorAll('.br-armory-option').forEach(b => { b.disabled = lockedWeapons; b.classList.toggle('selected', b.dataset.weapon === me.weapon); });
          input.pad.querySelector('[data-action=use]').disabled = state.cfg.mode !== 'tactical' || !me.alive || state.phase !== 'live';
        }
        const ids = me ? [myId] : [state.actors.find(a => !a.bot)?.id || state.actors[0]?.id];
        let drawn = state;
        if (online) {
          drawn = { ...state, actors: state.actors.map(a => {
            const old = smooth.get(a.id) || { x: a.x, z: a.z, y: a.y }; const blend = 1 - Math.exp(-dt * 25);
            if (Math.hypot(a.x - old.x, a.z - old.z) > 5) Object.assign(old, { x: a.x, y: a.y, z: a.z });
            else { old.x += (a.x - old.x) * blend; old.z += (a.z - old.z) * blend; old.y += (a.y - old.y) * blend; }
            smooth.set(a.id, old); return { ...a, ...old, input: { ...a.input, score: a.id === myId && currentInput.score } };
          }) };
        } else if (me) me.input.score = currentInput.score;
        view.draw(drawn, ids, names, dt, false, me ? { yaw: input.yaw, pitch: input.pitch } : null);
        if (me && me.alive && !paused && Math.hypot(currentInput.forward || 0, currentInput.strafe || 0) > 0.1 && now - sound.lastStep > (currentInput.walk ? 530 : 340)) { sound.tone(65, 0.045, currentInput.walk ? 0.009 : 0.025, 'triangle'); sound.lastStep = now; }
      } else view.draw(preview, [], {}, dt, true);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    window.addEventListener('pagehide', () => { stopped = true; input.dispose(); view.dispose(); sound.dispose(); if (ws) ws.close(); }, { once: true });
    // Read-only entry points for the dev harness and browser QA.
    window.__breach = { get state() { return state; }, get room() { return room; }, get id() { return myId; }, get local() { return local; }, view, input };
  };
})();
