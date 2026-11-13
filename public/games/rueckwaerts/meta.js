// choice settings show their options only, without the label: every option has to say what it is about
registerGame({ key: 'rueckwaerts', label: '⏪ Rückwärtsgang', min: 1, about: 'Ein Wort rückwärts nachsprechen. Umgedreht kommt meist Unsinn heraus.', cat: 'kreativ', settings: {
  modus: { label: 'Modus', type: 'choice', default: 'alle', options: [{ v: 'alle', label: 'Alle dasselbe Wort' }, { v: 'einzeln', label: 'Jeder sein Wort' }] },
  aufnahme: { label: 'Aufnahme', type: 'choice', default: 'zugleich', options: [{ v: 'zugleich', label: 'Alle nehmen zugleich auf' }, { v: 'reihum', label: 'Reihum aufnehmen' }], when: { modus: 'alle' } },
  woerter: { label: 'Wörter', type: 'choice', default: 'liste', options: [{ v: 'liste', label: 'Wörter vom Spiel' }, { v: 'frei', label: 'Eigene Wörter' }] },
  stufe: { label: 'Stufe', type: 'choice', default: 'mittel', options: [{ v: 'leicht', label: 'Leichte Wörter' }, { v: 'mittel', label: 'Mittlere Wörter' }, { v: 'schwer', label: 'Ganze Sätze' }], when: { woerter: 'liste' } },
  anzahl: { label: 'Wörter', type: 'number', default: 3, min: 1, max: 8, step: 1, when: { modus: 'alle' } },
  runden: { label: 'Runden', type: 'number', default: 1, min: 1, max: 3, step: 1, when: { modus: 'einzeln' } },
  wertung: { label: 'Wertung', type: 'choice', default: 'aus', options: [{ v: 'aus', label: 'Ohne Wertung' }, { v: 'an', label: 'Mit Wertung' }] }
} });
