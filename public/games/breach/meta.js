registerGame({ key: 'breach', label: '🎯 BREACH · Station NEXUS', min: 1, settings: {
  difficulty: { label: 'Bots', type: 'choice', default: 'easy', options: [
    { v: 'easy', label: 'Entspannt' }, { v: 'normal', label: 'Taktisch' }, { v: 'hard', label: 'Veteran' }
  ] },
  target: { label: 'Rundensiege', type: 'number', default: 3, min: 1, max: 5, step: 1, when: { mode: 'tactical' } },
  mode: { label: 'Modus', type: 'choice', default: 'tactical', options: [
    { v: 'tactical', label: 'Bombe legen · Team gegen Bots' }, { v: 'deathmatch', label: 'Team-Deathmatch' },
    { v: 'ffa', label: 'Free for All · jeder gegen jeden' },
    { v: 'arsenal', label: 'Waffenrennen · 10 Waffen' }, { v: 'control', label: 'Zonenkontrolle · A + B' }, { v: 'survival', label: 'Überleben · 5 Wellen' }
  ] },
  fillBots: { label: 'FFA-Gegner', type: 'choice', default: true, when: { mode: 'ffa' }, options: [
    { v: true, label: 'Mit Bots auffüllen' }, { v: false, label: 'Nur wir · ab 2 Spielern' }
  ] }
} });
