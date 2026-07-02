// ===== Modul: SPION =========================================
  // Ein Spieler kennt das Wort nicht (nur die Kategorie als Hinweis).
  // Reihum sagt jeder ein Wort dazu — wer ist der Spion?
  // Handys werden nur zum Ansehen der Rolle gebraucht.
  // ============================================================
  registerGame({ key: 'spy', label: '🕵️ Spion', min: 3, screen: function () {
    const WORDS = {
      'Orte': ['Strand','Krankenhaus','Schule','Flughafen','Kino','Schwimmbad','Bibliothek','Casino','Zoo','Bauernhof','U-Boot','Raumstation','Gefängnis','Supermarkt','Friedhof','Baustelle'],
      'Essen & Trinken': ['Pizza','Sushi','Döner','Spaghetti','Kaffee','Pfannkuchen','Currywurst','Käsefondue','Eis','Popcorn','Gulasch','Smoothie','Brezel','Raclette'],
      'Tiere': ['Elefant','Pinguin','Krokodil','Faultier','Delfin','Adler','Hamster','Oktopus','Giraffe','Biene','Känguru','Igel','Flamingo','Hai'],
      'Berufe': ['Feuerwehrmann','Pilot','Zahnarzt','Friseur','Astronaut','Koch','Polizist','Lehrer','Gärtner','Clown','Schornsteinfeger','DJ','Bestatter','Schiedsrichter'],
      'Gegenstände': ['Regenschirm','Zahnbürste','Staubsauger','Leiter','Kompass','Kopfhörer','Taschenlampe','Gießkanne','Fernbedienung','Zelt','Bügeleisen','Mikroskop'],
      'Sport & Freizeit': ['Fußball','Yoga','Klettern','Schach','Angeln','Skifahren','Bowling','Tischtennis','Reiten','Darts','Camping','Karaoke'],
      'Fantasie': ['Drache','Zombie','Zauberer','Pirat','Superheld','Vampir','Alien','Meerjungfrau','Ritter','Geist','Werwolf','Fee']
    };

    let ids = [], spy = null, word = '', category = '', startIdx = 0;
    let phase = 'reveal', confirmed = new Set(), round = 0, lastWord = '';
    let running = false;

    const pick = (a) => a[Math.floor(Math.random() * a.length)];

    function sendPhase() {
      const h = hostId();
      ids.forEach(id => ac.message(id, { t: 'spyPhase', phase, host: id === h }));
    }
    function newRound() {
      round++; confirmed = new Set(); phase = 'reveal';
      const cats = Object.keys(WORDS);
      category = pick(cats);
      do { word = pick(WORDS[category]); } while (word === lastWord && WORDS[category].length > 1);
      lastWord = word;
      spy = pick(ids);
      startIdx = Math.floor(Math.random() * ids.length);
      const h = hostId();
      ids.forEach(id => ac.message(id, {
        t: 'spyRole', spy: id === spy, word: id === spy ? '' : word, hint: category,
        round, host: id === h
      }));
    }
    function orderFromStart() {
      const out = [];
      for (let i = 0; i < ids.length; i++) out.push(ids[(startIdx + i) % ids.length]);
      return out;
    }
    function expose(reason) {
      phase = 'exposed';
      if (reason) setBanner(reason, 5000);
      sendPhase();
    }

    return {
      start(playerIds) {
        running = true;
        ids = playerIds.slice().sort((a, b) => a - b);
        newRound();
      },
      stop() { running = false; },
      onDisconnect(id) {
        const wasIn = ids.includes(id);
        ids = ids.filter(p => p !== id);
        if (!wasIn) return;
        if (ids.length < 3) { endToLobby('Spion braucht mind. 3 Spieler.'); return; }
        confirmed.delete(id);
        if (id === spy && phase !== 'exposed') { expose('Der Spion hat das Spiel verlassen! 😱'); return; }
        if (phase === 'reveal' && ids.every(p => confirmed.has(p))) { phase = 'discuss'; sendPhase(); }
        else sendPhase(); // Host könnte gewechselt haben
      },
      onMessage(id, d) {
        if (!d || !ids.includes(id)) return;
        if (d.t === 'spySeen' && phase === 'reveal') {
          confirmed.add(id);
          if (ids.every(p => confirmed.has(p))) { phase = 'discuss'; sendPhase(); }
        } else if (d.t === 'spyReveal' && id === hostId() && phase === 'discuss') {
          expose('');
        } else if (d.t === 'spyNext' && id === hostId() && phase === 'exposed') {
          newRound();
        }
      },
      render() {
        ctx.fillStyle = '#0d0d1a'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff'; ctx.font = 'bold 36px system-ui,sans-serif';
        ctx.fillText('🕵️ Spion — Runde ' + round, cv.width / 2, 52);

        if (phase === 'reveal') {
          ctx.fillStyle = '#bf5af2'; ctx.font = 'bold 24px system-ui,sans-serif';
          ctx.fillText('Schaut auf euer Handy und merkt euch eure Rolle!', cv.width / 2, 110);
          ctx.font = 'bold 20px system-ui,sans-serif';
          ids.forEach((id, i) => {
            const col = 2, perCol = Math.ceil(ids.length / col);
            const c = Math.floor(i / perCol), rIdx = i % perCol;
            const bx = cv.width / 2 - 210 + c * 240, y = 180 + rIdx * 42;
            ctx.fillStyle = players[id] ? players[id].color : '#888';
            ctx.beginPath(); ctx.arc(bx, y, 11, 0, Math.PI * 2); ctx.fill();
            ctx.textAlign = 'left'; ctx.fillStyle = '#eee';
            ctx.fillText(shortName(id) + '  ' + (confirmed.has(id) ? '✅' : '⏳'), bx + 20, y);
            ctx.textAlign = 'center';
          });
          ctx.fillStyle = '#888'; ctx.font = '16px system-ui,sans-serif';
          ctx.fillText(confirmed.size + ' / ' + ids.length + ' bereit', cv.width / 2, cv.height - 50);
        }

        if (phase === 'discuss') {
          const ord = orderFromStart();
          ctx.fillStyle = '#30d158'; ctx.font = 'bold 30px system-ui,sans-serif';
          ctx.fillText('▶ ' + nameOf(ord[0]) + ' beginnt!', cv.width / 2, 120);
          ctx.fillStyle = '#aaa'; ctx.font = '18px system-ui,sans-serif';
          ctx.fillText('Reihum sagt jeder EIN Wort, das zum Begriff passt.', cv.width / 2, 158);
          ctx.fillText('📵 Handys könnt ihr jetzt weglegen.', cv.width / 2, 186);
          // Reihenfolge als Kreis-Liste
          ctx.font = 'bold 22px system-ui,sans-serif';
          ord.forEach((id, i) => {
            const y = 250 + i * 40;
            ctx.fillStyle = players[id] ? players[id].color : '#888';
            ctx.beginPath(); ctx.arc(cv.width / 2 - 140, y, 11, 0, Math.PI * 2); ctx.fill();
            ctx.textAlign = 'left'; ctx.fillStyle = i === 0 ? '#fff' : '#bbb';
            ctx.fillText((i + 1) + '. ' + shortName(id) + (i === 0 ? '  ◀ Start' : ''), cv.width / 2 - 115, y);
            ctx.textAlign = 'center';
          });
          ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '15px system-ui,sans-serif';
          ctx.fillText('⭐ Host kann am Handy den Spion aufdecken', cv.width / 2, cv.height - 28);
        }

        if (phase === 'exposed') {
          ctx.fillStyle = '#ff3b30'; ctx.font = 'bold 42px system-ui,sans-serif';
          ctx.fillText('Der Spion war: ' + nameOf(spy) + ' 🕵️', cv.width / 2, cv.height / 2 - 60);
          ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 32px system-ui,sans-serif';
          ctx.fillText('Das Wort: „' + word + '“', cv.width / 2, cv.height / 2 + 6);
          ctx.fillStyle = '#888'; ctx.font = '18px system-ui,sans-serif';
          ctx.fillText('Kategorie: ' + category, cv.width / 2, cv.height / 2 + 48);
          ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '15px system-ui,sans-serif';
          ctx.fillText('⭐ Host startet am Handy die nächste Runde', cv.width / 2, cv.height - 28);
        }
      }
    };
  }});
