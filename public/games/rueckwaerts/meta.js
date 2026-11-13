// choice settings show their options only, without the label: every option has to say what it is about
registerGame({ key: 'rueckwaerts', label: '⏪ Rückwärtsgang', min: 1, settings: {
  woerter: { label: 'Wörter', type: 'choice', default: 'liste', options: [{ v: 'liste', label: 'Wörter vom Spiel' }, { v: 'frei', label: 'Eigene Wörter' }] },
  stufe: { label: 'Stufe', type: 'choice', default: 'mittel', options: [{ v: 'leicht', label: 'Leichte Wörter' }, { v: 'mittel', label: 'Mittlere Wörter' }, { v: 'schwer', label: 'Ganze Sätze' }], when: { woerter: 'liste' } },
  runden: { label: 'Runden', type: 'number', default: 1, min: 1, max: 3, step: 1 },
  wertung: { label: 'Wertung', type: 'choice', default: 'aus', options: [{ v: 'aus', label: 'Ohne Wertung' }, { v: 'an', label: 'Mit Wertung' }] }
} });
