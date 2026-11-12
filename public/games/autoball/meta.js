registerGame({ key: 'autoball', label: '⚽ Autoball', min: 1, settings: {
  minutes: { label: 'Spielzeit', type: 'number', default: 3, min: 2, max: 6, step: 1, unit: 'min' },
  arena: { label: 'Arena', type: 'choice', default: 'stadion', options: [
    { v: 'stadion', label: '🏟️ Stadion' }, { v: 'eis', label: '🧊 Eishalle' }, { v: 'neon', label: '🌃 Neon' }] },
  bots: { label: 'Bots', type: 'choice', default: 'fill', options: [
    { v: 'fill', label: '🤖 Füllen auf' }, { v: 'off', label: '⚪ Keine' }] }
} });
