// choice settings show their options only, without the label: every option has to say what it is about
registerGame({ key: 'fotosalat', label: '📸 Fotosalat', min: 2, settings: {
  spiel: { label: 'Spiel', type: 'choice', default: 'nachmachen', options: [{ v: 'nachmachen', label: '🖼️ Nachmachen' }, { v: 'zoom', label: '🔍 Zoom-Rätsel' }, { v: 'jagd', label: '🏃 Schnitzeljagd' }, { v: 'mix', label: '🎁 Bunte Tüte' }] },
  vorlagen: { label: 'Vorlagen', type: 'choice', default: 'mix', options: [{ v: 'mix', label: 'Gemälde + Posen' }, { v: 'gemaelde', label: 'Nur Gemälde' }, { v: 'posen', label: 'Nur eigene Posen' }], when: { spiel: 'nachmachen' } },
  runden: { label: 'Runden', type: 'number', default: 3, min: 1, max: 6, step: 1 },
  zeit: { label: 'Zeit pro Foto', type: 'number', default: 90, min: 30, max: 180, step: 15, unit: 's' },
  wertung: { label: 'Wertung', type: 'choice', default: 'aus', options: [{ v: 'aus', label: 'Ohne Wertung' }, { v: 'an', label: 'Mit Wertung' }] }
} });
