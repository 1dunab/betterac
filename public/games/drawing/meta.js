registerGame({ key: 'drawing', label: '🎨 Drawing Evolution', min: 2, settings: {
  mode: { label: 'Wörter', type: 'choice', default: 'casual', options: [
    { v: 'casual', label: 'Casual' }, { v: 'tiere', label: 'Tiere' }, { v: 'laender', label: 'Länder' },
    { v: 'versaut', label: 'Versaut' }, { v: 'custom', label: 'Eigene' }] },
  drawTime: { label: 'Zeichenzeit', type: 'number', default: 60, min: 10, max: 180, step: 5, unit: 's' },
  guessTime: { label: 'Ratezeit', type: 'number', default: 30, min: 10, max: 120, step: 5, unit: 's' }
} });
