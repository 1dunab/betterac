// ===== Modul: DRAWING EVOLUTION =============================
  // ============================================================
  registerGame({ key: 'drawing', label: '🎨 Drawing Evolution', min: 2, screen: function () {
    const WORD_PACKS = {
      casual: ['Sonne','Mond','Baum','Haus','Auto','Fahrrad','Pizza','Banane','Roboter','Rakete','Drache','Burg','Regenbogen','Schneemann','Krone','Geist','Vulkan','Insel','Leuchtturm','Brille','Gitarre','Trommel','Fußball','Eistüte','Kaktus','Pilz','Ampel','Regenschirm','Kerze','Geschenk','Ballon','Anker','Kompass','Schatzkarte','Brücke','Windmühle','Zelt','Heißluftballon','Ufo','Planet','Komet','Blitz','Schneeflocke','Einhorn','Meerjungfrau','Hexe','Zauberer','Ritter','Pirat','Astronaut'],
      tiere: ['Hund','Katze','Elefant','Giraffe','Löwe','Tiger','Affe','Zebra','Krokodil','Schlange','Frosch','Pinguin','Eule','Fuchs','Bär','Igel','Eichhörnchen','Wal','Hai','Delfin','Krake','Qualle','Schildkröte','Pferd','Kuh','Schwein','Schaf','Huhn','Ente','Biene','Schmetterling','Marienkäfer','Spinne','Fledermaus','Kamel','Känguru','Faultier','Flamingo','Pfau','Eisbär'],
      laender: ['Deutschland','Frankreich','Italien','Spanien','Portugal','England','Irland','Niederlande','Belgien','Schweiz','Österreich','Griechenland','Türkei','Ägypten','Marokko','Nigeria','Kenia','Südafrika','Brasilien','Argentinien','Mexiko','Kanada','USA','Kuba','Japan','China','Indien','Thailand','Australien','Neuseeland','Russland','Schweden','Norwegen','Island','Polen','Finnland'],
      versaut: ['Tanga','Stringtanga','Kondom','Dildo','Vibrator','Handschellen','Peitsche','Strapse','Reizwäsche','Dessous','Stripperstange','Striptease','Lapdance','Zungenkuss','Knutschfleck','Morgenlatte','Nackedei','Hintern','Busen','Sexpuppe','Liebesschaukel','Rotlichtviertel','Sexshop','Pornoheft','Domina','FKK-Strand','Nacktbaden','Höschen','Spanner','Aktmodell']
    };
    const RECAP_STEP_MS = 2600;
    let cfg = { drawTime: 60, guessTime: 30, mode: 'casual' };
    let order = [], N = 0, chains = [], round = 0, sub = 'draw', assign = {}, subm = {}, deadline = 0, phaseMs = 1, graceUntil = 0;
    let collectSubm = {}, rChain = 0, rShown = 1, rAcc = 0, dstate = 'collect', tick = null, closing = false;
    const chainFor = (p, r) => ((p - r) % N + N) % N;
    function clearT() { if (tick) { clearInterval(tick); tick = null; } }
    function capFor(e, i) { const who = e.by === null ? '' : nameOf(e.by); return (i === 0) ? (e.by === null ? 'Startwort' : (who + 's Wort')) : (e.type === 'drawing' ? (who + ' zeichnete') : (who + ' riet')); }

    function startRound(r) {
      round = r; sub = r % 2 === 0 ? 'draw' : 'guess'; assign = {}; subm = {};
      order.forEach((id, p) => assign[id] = chainFor(p, r));
      phaseMs = (sub === 'draw' ? cfg.drawTime : cfg.guessTime) * 1000; deadline = performance.now() + phaseMs; graceUntil = 0;
      order.forEach(id => { const last = chains[assign[id]][chains[assign[id]].length - 1]; if (sub === 'draw') ac.message(id, { t: 'draw', word: last.word, ms: phaseMs }); else ac.message(id, { t: 'guess', strokes: last.strokes || [], ms: phaseMs }); });
    }
    function doSubmit(id, payload) { if (!order.includes(id) || (subm[id] && subm[id].done)) return; subm[id] = Object.assign({ done: true }, payload); ac.message(id, { t: 'wait' }); if (order.every(p => subm[p] && subm[p].done)) finalize(); }
    function finalize() {
      if (closing) return; closing = true;
      order.forEach(id => { const c = assign[id], s = subm[id]; if (sub === 'draw') chains[c].push({ type: 'drawing', by: id, strokes: (s && s.strokes) || [] }); else chains[c].push({ type: 'word', by: id, word: ((s && s.text) || '').trim() || '—' }); });
      closing = false;
      if (round + 1 < N) startRound(round + 1); else { dstate = 'preRecap'; clearT(); sendPre(); }
    }
    function sendPre() { const h = hostId(); order.forEach(id => { if (players[id]) ac.message(id, { t: 'prerecap', host: id === h }); }); }
    function sendRecapV() { const h = hostId(); order.forEach(id => { if (players[id]) ac.message(id, { t: 'recap', host: id === h }); }); }
    function advance() { rAcc = 0; const len = chains[rChain].length; if (rShown < len) rShown++; else if (rChain < N - 1) { rChain++; rShown = 1; } else { dstate = 'done'; } }

    function buildCanvas() {
      const margin = 40, titleH = 90, gap = 20, capH = 30, rowPad = 34, W = 1400;
      const maxN = Math.max(2, ...chains.map(c => c.length));
      const cw = Math.min(170, Math.floor((W - 2 * margin - (maxN - 1) * gap) / maxN));
      const rowH = cw + capH + rowPad, H = titleH + chains.length * rowH + margin;
      const oc = document.createElement('canvas'); oc.width = W; oc.height = H; const o = oc.getContext('2d');
      o.fillStyle = '#fff'; o.fillRect(0, 0, W, H); o.fillStyle = '#111'; o.textAlign = 'center'; o.textBaseline = 'middle'; o.font = 'bold 42px system-ui,sans-serif'; o.fillText('Drawing Evolution', W / 2, titleH / 2);
      chains.forEach((ch, ci) => {
        const n = ch.length, totalW = n * cw + (n - 1) * gap; let x = (W - totalW) / 2; const y = titleH + ci * rowH;
        for (let i = 0; i < n; i++) {
          const e = ch[i];
          if (e.type === 'drawing') { o.strokeStyle = '#ccc'; o.lineWidth = 2; rr(o, x, y, cw, cw, 10); o.stroke(); drawStrokesOn(o, e.strokes, x + 2, y + 2, cw - 4, cw - 4); }
          else { o.fillStyle = i === 0 ? '#fff6d6' : '#eef'; rr(o, x, y, cw, cw, 12); o.fill(); o.strokeStyle = i === 0 ? '#e0b400' : '#bbc'; o.lineWidth = 2; rr(o, x, y, cw, cw, 12); o.stroke(); o.fillStyle = '#111'; o.textAlign = 'center'; o.textBaseline = 'middle'; o.font = 'bold ' + fitFont(o, e.word, cw - 16, 26) + 'px system-ui,sans-serif'; o.fillText(e.word, x + cw / 2, y + cw / 2); }
          o.fillStyle = '#555'; o.font = '14px system-ui,sans-serif'; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillText(capFor(e, i), x + cw / 2, y + cw + capH / 2);
          if (i < n - 1) { o.fillStyle = '#999'; o.font = 'bold 22px system-ui,sans-serif'; o.fillText('→', x + cw + gap / 2, y + cw / 2); }
          x += cw + gap;
        }
      });
      return oc;
    }

    function chips(yPos, doneFn) {
      const totalW = order.length * 120; let x = cv.width / 2 - totalW / 2 + 60;
      order.forEach(id => {
        const done = doneFn(id);
        ctx.fillStyle = players[id] ? players[id].color : '#888'; ctx.globalAlpha = done ? 1 : 0.4; ctx.beginPath(); ctx.arc(x, yPos, 22, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff'; ctx.font = 'bold 16px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(done ? '✓' : '…', x, yPos);
        ctx.fillStyle = '#bbb'; ctx.font = '13px system-ui,sans-serif'; ctx.fillText(shortName(id), x, yPos + 36); x += 120;
      });
    }

    return {
      acceptsJoin: false,
      start(idList, settings) {
        if (settings) cfg = settings;
        order = idList.slice(); N = order.length; dstate = 'play';
        if (cfg.mode === 'custom') { dstate = 'collect'; collectSubm = {}; order.forEach(id => ac.message(id, { t: 'prompt' })); }
        else { const pack = WORD_PACKS[cfg.mode] || WORD_PACKS.casual; const words = shuffle(pack.slice()).slice(0, N); chains = order.map((id, c) => [{ type: 'word', by: null, word: words[c] }]); startRound(0); }
        tick = setInterval(() => { const now = performance.now(); if (dstate === 'play' && now >= deadline) { if (graceUntil === 0) graceUntil = now + 1500; else if (now >= graceUntil) finalize(); } if (dstate === 'recap') { rAcc += 120; if (rAcc >= RECAP_STEP_MS) advance(); } }, 120);
      },
      stop() { clearT(); },
      onConnect(id) { /* Spät-Beitritt: nur Zuschauer */ },
      onDisconnect(id) {
        if (!order.includes(id)) return;
        if (dstate === 'collect' || dstate === 'play') endToLobby('Ein Spieler ist raus — zurück zur Lobby.');
        else if (dstate === 'preRecap') sendPre();
        else if (dstate === 'recap') sendRecapV();
      },
      onMessage(id, d) {
        if (!d || !d.t) return;
        if (d.t === 'word' && dstate === 'collect') {
          if (order.includes(id) && collectSubm[id] === undefined) { collectSubm[id] = (d.text || '').trim(); ac.message(id, { t: 'wait' }); if (order.every(p => collectSubm[p] !== undefined)) finalizeCollect(); }
        } else if (d.t === 'drawing' && dstate === 'play' && sub === 'draw') doSubmit(id, { strokes: d.strokes });
        else if (d.t === 'guess' && dstate === 'play' && sub === 'guess') doSubmit(id, { text: d.text });
        else if (d.t === 'startRecap' && id === hostId() && dstate === 'preRecap') { dstate = 'recap'; rChain = 0; rShown = 1; rAcc = 0; sendRecapV(); }
        else if (d.t === 'advance' && dstate === 'recap') advance();
        else if (d.t === 'save' && id === hostId()) this.save();
      },
      canSave() { return chains.length > 0 && (dstate === 'preRecap' || dstate === 'recap' || dstate === 'done'); },
      save() { if (!chains.length) return; const a = document.createElement('a'); a.href = buildCanvas().toDataURL('image/png'); a.download = 'drawing-evolution.png'; document.body.appendChild(a); a.click(); a.remove(); },
      render() {
        ctx.fillStyle = '#0d0d1a'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (dstate === 'collect') {
          ctx.fillStyle = '#bf5af2'; ctx.font = 'bold 40px system-ui,sans-serif'; ctx.fillText('💭 Denkt euch ein Wort aus!', cv.width / 2, 120);
          const done = order.filter(id => collectSubm[id] !== undefined).length;
          ctx.fillStyle = '#fff'; ctx.font = 'bold 48px system-ui,sans-serif'; ctx.fillText(done + ' / ' + N + ' eingereicht', cv.width / 2, 240);
          chips(390, id => collectSubm[id] !== undefined);
          ctx.fillStyle = '#777'; ctx.font = '16px system-ui,sans-serif'; ctx.fillText('Es geht weiter, sobald alle ein Wort haben', cv.width / 2, 480);
        } else if (dstate === 'play') {
          const rem = Math.max(0, deadline - performance.now()), secs = Math.ceil(rem / 1000), frac = clamp(rem / phaseMs, 0, 1);
          ctx.fillStyle = sub === 'draw' ? '#ffd60a' : '#64d2ff'; ctx.font = 'bold 44px system-ui,sans-serif'; ctx.fillText(sub === 'draw' ? '✏️  ZEICHNEN' : '❓  RATEN', cv.width / 2, 80);
          ctx.fillStyle = '#888'; ctx.font = '20px system-ui,sans-serif'; ctx.fillText('Runde ' + (round + 1) + ' / ' + N, cv.width / 2, 124);
          const cx = cv.width / 2, cy = 270, R = 80; ctx.lineWidth = 12; ctx.strokeStyle = '#222'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = sub === 'draw' ? '#ffd60a' : '#64d2ff'; ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = 'bold 52px system-ui,sans-serif'; ctx.fillText(secs, cx, cy);
          chips(430, id => subm[id] && subm[id].done);
        } else if (dstate === 'preRecap') {
          ctx.fillStyle = '#30d158'; ctx.font = 'bold 46px system-ui,sans-serif'; ctx.fillText('✅ Alle Runden geschafft!', cv.width / 2, cv.height / 2 - 30);
          ctx.fillStyle = '#ddd'; ctx.font = '22px system-ui,sans-serif'; ctx.fillText('Host (' + nameOf(hostId() || order[0]) + ') startet den Rückblick', cv.width / 2, cv.height / 2 + 28);
        } else if (dstate === 'recap' || dstate === 'done') {
          ctx.fillStyle = '#fff'; ctx.font = 'bold 34px system-ui,sans-serif'; ctx.fillText(dstate === 'done' ? '🎉 Evolution komplett!' : ('🎬 Evolution ' + (rChain + 1) + ' / ' + N), cv.width / 2, 50);
          const chn = chains[dstate === 'done' ? N - 1 : rChain], shownN = dstate === 'done' ? chn.length : rShown, n = chn.length, gap = 22;
          const cw = Math.min(150, Math.floor((cv.width - 80 - (n - 1) * gap) / n)), totalW = n * cw + (n - 1) * gap;
          let x = (cv.width - totalW) / 2; const y = 220, capY = y + cw + 28;
          for (let i = 0; i < n; i++) {
            const e = chn[i], shown = i < shownN;
            if (shown) {
              if (e.type === 'drawing') { ctx.save(); ctx.strokeStyle = '#444'; ctx.lineWidth = 2; rr(ctx, x, y, cw, cw, 10); ctx.stroke(); ctx.restore(); drawStrokesOn(ctx, e.strokes, x + 2, y + 2, cw - 4, cw - 4); }
              else { ctx.fillStyle = '#1a1a2e'; rr(ctx, x, y, cw, cw, 12); ctx.fill(); ctx.strokeStyle = i === 0 ? '#ffd60a' : '#555'; ctx.lineWidth = 2; rr(ctx, x, y, cw, cw, 12); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold ' + fitFont(ctx, e.word, cw - 16, 26) + 'px system-ui,sans-serif'; ctx.fillText(e.word, x + cw / 2, y + cw / 2); }
              ctx.fillStyle = e.by === null ? '#ffd60a' : (players[e.by] ? players[e.by].color : '#aaa'); ctx.font = '14px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(capFor(e, i), x + cw / 2, capY);
            } else { ctx.fillStyle = '#15151f'; rr(ctx, x, y, cw, cw, 10); ctx.fill(); }
            if (i < n - 1) { ctx.fillStyle = i < shownN - 1 ? '#888' : '#333'; ctx.font = 'bold 22px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('→', x + cw + gap / 2, y + cw / 2); }
            x += cw + gap;
          }
          ctx.fillStyle = '#777'; ctx.font = '16px system-ui,sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(dstate === 'done' ? 'Speichern unten · Host bricht ab für neue Runde' : 'Läuft automatisch · „Weiter" am Handy springt vor', cv.width / 2, cv.height - 40);
        }
      }
    };
    function finalizeCollect() {
      if (closing) return; closing = true;
      const fb = shuffle(WORD_PACKS.casual.slice());
      chains = order.map((id, c) => { let w = (collectSubm[id] || '').trim(); if (!w) w = fb[c % fb.length]; return [{ type: 'word', by: id, word: w }]; });
      closing = false; dstate = 'play'; startRound(0);
    }
  }});

  // ============================================================
