// choice settings show their options only, without the label: every option has to say what it is about
registerGame({ key: 'werspricht', label: '🗣️ Wer spricht da?', min: 3, about: 'Alle sagen denselben Satz. Der Fernseher verzerrt die Stimmen: Wer war das?', cat: 'raten', settings: {
  verzerrung: { label: 'Verzerrung', type: 'choice', default: 'mix', options: [{ v: 'mix', label: 'Mal hoch, mal tief' }, { v: 'hoch', label: '🐿️ Streifenhörnchen' }, { v: 'tief', label: '👹 Monster' }] },
  runden: { label: 'Runden', type: 'number', default: 2, min: 1, max: 5, step: 1 },
  wertung: { label: 'Wertung', type: 'choice', default: 'an', options: [{ v: 'an', label: 'Mit Punkten' }, { v: 'aus', label: 'Ohne Punkte' }] }
} });
