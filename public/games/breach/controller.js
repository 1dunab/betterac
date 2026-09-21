(function () {
  'use strict';
  const weapons = window.BreachWorld.weapons;
  document.body.insertAdjacentHTML('beforeend', `
  <style>
  #v-breach{background:radial-gradient(ellipse at 70% 0,#203f50,#0c202d 75%);color:#edf3e1;position:relative;overflow:hidden}
  #br-phone-head{height:48px;flex-shrink:0;display:flex;align-items:center;gap:12px;padding:8px 145px 4px 17px;font:700 17px monospace;letter-spacing:2px}
  #br-phone-slot{font:9px monospace;letter-spacing:1px;color:#b4d2ce;border-left:1px solid #557786;padding-left:10px}
  #br-phone-telemetry{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:5px 18px;height:49px;flex-shrink:0;background:#9bbcc008;border-bottom:1px solid #9ebdb523}
  #br-phone-stats{font:700 18px monospace;color:#dfedb0;white-space:nowrap;flex-shrink:0}#br-phone-health{font:700 15px monospace;color:#9bddda}#br-phone-state{font:9px monospace;letter-spacing:1px;color:#a9c9cc;margin-top:4px}
  #br-phone-status{font:11px monospace;color:#b2c9c8;max-width:50%;line-height:1.5;text-align:right}
  #br-phone-reload{height:3px;flex-shrink:0;background:#284452}#br-phone-reload span{height:100%;display:block;width:0;background:#e4efad;transition:width .08s linear}
  #br-phone-tools{display:flex;gap:8px;height:39px;flex-shrink:0;padding:6px 15px 0}#br-phone-tools button{border:1px solid #779ca741;border-radius:8px;background:#1c3947;color:#bcd9d6;padding:5px 10px;font:10px monospace;min-height:30px}#br-phone-weapon{flex:1;text-align:left;color:#e2eebd!important}
  #br-phone-pad{position:relative;flex:1;min-height:200px;touch-action:none;overflow:hidden}
  #br-phone-help{padding:7px 10px 10px;text-align:center;font:9px monospace;color:#8dabb4;flex-shrink:0}
  #v-breach[data-signal=lost] #br-phone-pad{opacity:.4}#v-breach[data-signal=lost] #br-phone-state{color:#ffc18d}
  #v-breach .br-actions button.br-ready{border-color:#ddecac;box-shadow:0 0 18px #ddea9c35}
  #br-phone-again{position:absolute;bottom:15px;left:calc(50% - 120px);width:240px;z-index:10;background:#deebae;color:#233631;border:0;border-radius:12px;padding:16px;font:bold 13px monospace}
  .br-phone-sheet{position:absolute;inset:48px 7px 7px;z-index:80;background:#102b3bf7;backdrop-filter:blur(18px);border:1px solid #a2c4ba55;border-radius:16px;padding:17px;display:flex;flex-direction:column;gap:12px;overflow:auto}.br-phone-sheet[hidden]{display:none}
  .br-sheet-head{display:flex;justify-content:space-between;align-items:center;font:700 17px monospace;color:#deecb0}.br-sheet-head button{border:1px solid #9dbab55c;border-radius:8px;background:#284650;color:#dce9da;padding:9px 14px;font:12px monospace}
  #br-phone-loadout{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}.br-weapon-card{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:13px;border:1px solid #88a9b647;border-radius:10px;background:#213f50;color:#daebdf;text-align:left;min-height:91px}.br-weapon-card strong{font:700 17px monospace}.br-weapon-card small{font:10px monospace;color:#aac0c6}.br-weapon-card .br-w-stat{color:#d2dfb7;font-size:10px}.br-weapon-card.selected{border-color:#deedac;background:#82964226;box-shadow:inset 3px 0 #deedac}
  #br-phone-settings label{display:flex;align-items:center;justify-content:space-between;gap:16px;font:13px monospace;min-height:42px;color:#d3e1da}#br-phone-settings input[type=range]{width:100%;accent-color:#ddebaf;min-height:42px}#br-phone-settings input[type=checkbox]{width:22px;height:22px;accent-color:#ddebaf}#br-phone-settings p{font:12px monospace;line-height:1.7;color:#9db7c0}#br-phone-online{color:#d5e8af;font:12px monospace}
  #br-phone-reset{min-height:44px;flex-shrink:0;border:1px solid #a2c4ba66;border-radius:8px;background:#284650;color:#deecb0;font:12px monospace;padding:10px}#br-phone-layout{font:12px monospace;color:#deecb0}
  @media(orientation:landscape){#br-phone-head{height:33px;padding-top:5px;font-size:14px}#br-phone-telemetry{height:37px;padding:3px 18px}#br-phone-stats{font-size:16px}#br-phone-health{font-size:13px}#br-phone-state{font-size:8px;margin-top:2px}#br-phone-status{font-size:10px;max-width:58%}#br-phone-tools{position:absolute;top:2px;left:36%;right:145px;height:30px;padding:0;z-index:4}#br-phone-tools button{font-size:9px;padding:3px 7px;min-height:27px}#br-phone-help{padding:3px;height:16px;font-size:8px}#br-phone-pad{min-height:195px}#br-phone-loadout{grid-template-columns:repeat(5,1fr)}.br-weapon-card{min-height:95px;padding:10px}.br-weapon-card strong{font-size:14px}.br-weapon-card small{font-size:9px}.br-phone-sheet{padding:13px}}
  </style>
  <div id="v-breach" class="view">
    <div id="br-phone-head">BREACH <span id="br-phone-slot">NEXUS</span></div>
    <div id="br-phone-telemetry"><div><span id="br-phone-health">100 HP</span><div id="br-phone-state">VERBINDEN …</div></div><strong id="br-phone-stats">30 / 180</strong><div id="br-phone-status">Links bewegen · rechts zielen</div></div>
    <div id="br-phone-reload" role="progressbar" aria-label="Fortschritt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
    <div id="br-phone-tools"><button id="br-phone-weapon">AR-7 ▾</button><button id="br-phone-options" aria-label="Steuerung einstellen">⚙ STEUERUNG</button><button id="br-phone-full" aria-label="Controller im Vollbild">⛶</button></div>
    <div id="br-phone-pad"></div>
    <div id="br-phone-help">FEUER halten + ziehen · Nachladen automatisch · Waffenauswahl jederzeit</div>
    <button id="br-phone-again" hidden>🔁 REVANCHE</button>
    <section id="br-phone-armory" class="br-phone-sheet" role="dialog" aria-modal="true" aria-label="Waffenkammer" hidden><div class="br-sheet-head">WAFFENKAMMER <button data-br-close>SCHLIESSEN ✕</button></div><div id="br-phone-loadout"></div></section>
    <section id="br-phone-settings" class="br-phone-sheet" role="dialog" aria-modal="true" aria-label="Steuerung" hidden><div class="br-sheet-head">DEINE STEUERUNG <button data-br-close>SCHLIESSEN ✕</button></div><div id="br-phone-layout" role="status"></div><button id="br-phone-reset">STANDARDSTEUERUNG WIEDERHERSTELLEN</button><label for="br-sensitivity">Ziel-Empfindlichkeit <strong id="br-sensitivity-value"></strong></label><input id="br-sensitivity" type="range" min="0.3" max="1.8" step="0.1"><label for="br-left">Linkshänder · Seiten tauschen<input id="br-left" type="checkbox"></label><label for="br-assist">Sanfte Zielhilfe im Koop<input id="br-assist" type="checkbox"></label><p>Quer halten und beide Daumen nutzen. Links kannst du überall aufsetzen; der Stick folgt deinem Finger. Rechts wischen zum Umsehen oder FEUER halten und ziehen. VISIER antippen schaltet die Zielansicht ein oder aus und macht kleine Zielbewegungen ruhiger. Die Einstellungen bleiben auf diesem Handy gespeichert.</p><a id="br-phone-online" href="breach.html" target="_blank" rel="noopener">Auf eigenem Bildschirm online spielen ↗</a></section>
  </div>`);
  VIEWS.push('breach');
  let input = null, timer = null, round = -1, epoch = -1, running = false, lastStateAt = 0, signalLost = false;
  const sheetOpen = () => [...document.querySelectorAll('#v-breach .br-phone-sheet')].some(el => !el.hidden);
  function signal(lost) {
    if (signalLost === lost) return;
    signalLost = lost; $('v-breach').dataset.signal = lost ? 'lost' : 'ready';
    input.clear(); input.enabled = !lost && !sheetOpen();
    if (lost) {
      $('br-phone-state').textContent = 'KEIN BILDSCHIRM-SIGNAL'; $('br-phone-status').textContent = 'Bildschirm prüfen · Eingaben pausiert';
      input.pad.querySelector('[data-action=fire]').disabled = true;
    }
  }
  const send = () => {
    if (!input || !running) return;
    if (!$('v-breach').classList.contains('on')) { running = false; input.clear(); input.enabled = false; ac.message(AirConsole.SCREEN, { t: 'brInput', input: { reset: true } }); clearInterval(timer); timer = null; return; }
    if (performance.now() - lastStateAt > 1800) signal(true);
    ac.message(AirConsole.SCREEN, { t: 'brInput', input: input.read() });
  };
  const closeSheet = () => { document.querySelectorAll('#v-breach .br-phone-sheet').forEach(el => el.hidden = true); if (input) input.enabled = !signalLost; };
  const openSheet = id => { document.querySelectorAll('#v-breach .br-phone-sheet').forEach(el => el.hidden = true); input.clear(); input.enabled = false; $(id).hidden = false; };
  $('br-phone-weapon').addEventListener('click', () => openSheet('br-phone-armory'));
  $('br-phone-options').addEventListener('click', () => openSheet('br-phone-settings'));
  document.querySelectorAll('[data-br-close]').forEach(b => b.addEventListener('click', closeSheet));
  Object.entries(weapons).forEach(([key,w],index) => {
    const button = document.createElement('button'); button.className = 'br-weapon-card'; button.dataset.brWeapon = key;
    button.innerHTML = `<strong style="color:${w.color}">${w.name}</strong><small>${w.label}</small><small>${w.hint}</small><span class="br-w-stat">${w.mag} SCHUSS · ${w.reload.toFixed(2)} s LADEN</span>`;
    button.addEventListener('click', () => { closeSheet(); input.edges.weapon = key; send(); }); $('br-phone-loadout').append(button);
  });
  function showSettings() { $('br-sensitivity').value = input.settings.sensitivity; $('br-sensitivity-value').textContent = input.settings.sensitivity.toFixed(1) + '×'; $('br-left').checked = input.settings.leftHanded; $('br-assist').checked = input.settings.assist; $('br-phone-layout').textContent = input.settings.leftHanded ? 'Gespiegelt · rechts bewegen, links zielen' : 'Standard · links bewegen, rechts zielen'; }
  $('br-sensitivity').addEventListener('input', () => { input.updateSettings({ sensitivity: Number($('br-sensitivity').value) }); showSettings(); });
  $('br-left').addEventListener('change', () => { input.clear(); input.updateSettings({ leftHanded: $('br-left').checked }); showSettings(); });
  $('br-assist').addEventListener('change', () => input.updateSettings({ assist: $('br-assist').checked }));
  $('br-phone-reset').addEventListener('click', () => { input.clear(); input.updateSettings({ sensitivity: 0.8, leftHanded: false, assist: true }); showSettings(); });
  $('br-phone-full').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else { await document.documentElement.requestFullscreen(); try { await screen.orientation.lock('landscape'); } catch (_) {} } } catch (_) {} });
  $('br-phone-again').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'brAgain' }));
  registerGame({ key: 'breach', controller: {
    activate() {
      running = false; if (input) input.dispose(); if (timer) clearInterval(timer);
      input = new BreachInput($('br-phone-pad'), { noPointer: true, onChange: send }); input.touch($('br-phone-pad')); input.enabled = true;
      input.yaw = 0; input.pitch = 0; round = epoch = -1; signalLost = false; lastStateAt = performance.now(); $('v-breach').dataset.signal = 'ready'; closeSheet(); showSettings();
      $('br-phone-again').hidden = true; showView('breach'); running = true; timer = setInterval(send, 33);
    },
    onMessage(d) {
      if (d.t !== 'brState' || !input) return;
      lastStateAt = performance.now(); signal(false);
      if (d.round !== round || d.epoch !== epoch) { round = d.round; epoch = d.epoch; input.clear(); input.yaw = d.yaw; input.pitch = d.pitch; }
      myHost = d.host; updateAbort();
      const slot = d.count === 2 ? (d.index === 1 ? 'OBEN' : 'UNTEN') : 'ANSICHT ' + d.index;
      $('br-phone-slot').textContent = slot; $('br-phone-health').textContent = d.hp + ' HP';
      $('br-phone-stats').textContent = d.reload > 0 ? '↻ ' + d.reload.toFixed(1) + ' s' : d.ammo + ' / ' + d.reserve;
      const cue = d.objective || { title: '', detail: 'A oder B erreichen · ZIEL halten', progress: 0, ready: false };
      const mode = BreachWorld.modes[d.mode] || BreachWorld.modes.tactical;
      input.setContext(d.mode, d.weapon, d.alive && d.phase === 'live');
      $('br-phone-state').textContent = d.phase === 'prep' ? (d.mode === 'survival' ? 'WELLE ' : 'AUSRÜSTEN · RUNDE ') + d.round : ['end', 'roundOver'].includes(d.phase) ? 'RUNDE BEENDET' : !d.alive ? mode.respawn ? 'WIEDEREINSTIEG · ' + Math.ceil(d.respawn) + ' s' : 'ZUSCHAUEN' : d.spawnShield > 0 ? 'STARTSCHUTZ · ' + Math.ceil(d.spawnShield) + ' s' : d.reload > 0 ? 'AUTO-NACHLADEN' : d.ammo === 0 && d.reserve === 0 ? 'RESERVE LEER · WAFFE WECHSELN' : mode.label.toUpperCase();
      $('br-phone-status').textContent = cue.progress > 0 || cue.ready || !d.alive ? cue.detail : cue.title;
      $('br-phone-help').textContent = cue.detail || 'FEUER halten + ziehen · Nachladen automatisch';
      $('br-phone-weapon').textContent = weapons[d.weapon].name + (d.mode === 'arsenal' ? ' · AUTO-WECHSEL' : ' ▾'); $('br-phone-weapon').disabled = d.mode === 'arsenal';
      const progress = Math.round(100 * (cue.progress > 0 ? cue.progress : d.reload > 0 ? 1 - d.reload / weapons[d.weapon].reload : 0));
      $('br-phone-reload').firstElementChild.style.width = progress + '%'; $('br-phone-reload').setAttribute('aria-valuenow', progress); $('br-phone-reload').setAttribute('aria-label', cue.progress > 0 ? cue.action : 'Nachladen');
      document.querySelectorAll('[data-br-weapon]').forEach(b => { b.classList.toggle('selected', b.dataset.brWeapon === d.weapon); b.disabled = d.mode === 'arsenal'; });
      input.pad.querySelector('[data-action=fire]').disabled = !d.alive || d.phase !== 'live';
      const use = input.pad.querySelector('[data-action=use]'); use.disabled = !d.alive || d.phase !== 'live' || d.mode !== 'tactical'; use.classList.toggle('br-ready', cue.ready);
      use.querySelector('small').textContent = cue.ready ? cue.action === 'ENTSCHÄRFEN' ? 'ENTSCH.' : 'LEGEN' : 'ZIEL HALTEN';
      $('br-phone-again').hidden = !(d.phase === 'end' && d.host);
    }
  } });
})();
