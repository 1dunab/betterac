registerGame({ key: 'furtfehde', label: '🏰 Furt & Fehde', min: 1, about: 'Burgen bauen, Truppen schicken, Nachbarn überfallen.', cat: 'duell', settings: {
  dauer: { label: 'Dauer', type: 'number', default: 20, min: 6, max: 40, step: 2, unit: ' Min' },
  burgen: { label: 'Burgen', type: 'number', default: 4, min: 2, max: 4, step: 1 },
  staerke: { label: 'Bot-Stärke', type: 'choice', default: 'ritter', options: [
    { v: 'knappe', label: '🛡️ Knappe (leicht)' }, { v: 'ritter', label: '⚔️ Ritter (mittel)' }, { v: 'kriegsherr', label: '👑 Kriegsherr (schwer)' }] },
  burgfrieden: { label: 'Burgfrieden', type: 'choice', default: '120', options: [
    { v: '60', label: '1 Min' }, { v: '120', label: '2 Min' }, { v: '180', label: '3 Min' }] },
  quality: { label: 'Grafik', type: 'choice', default: 'auto', options: [
    { v: 'auto', label: '🤖 Auto' }, { v: 'high', label: '✨ Voll' }, { v: 'low', label: '🔋 Sparsam' }] },
  aufloesung: { label: 'Auflösung', type: 'choice', default: 'normal', options: [
    { v: 'normal', label: 'Normal' }, { v: 'nativ', label: '🔍 Nativ (4K)' }] }
} });
