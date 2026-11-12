registerGame({ key: 'racer', label: '🏎️ Micro Racer', min: 2, settings: {
  track: { label: 'Strecke', type: 'choice', default: 'desert', options: [
    { v: 'desert', label: '🌵 Wüste' }, { v: 'snow', label: '❄️ Schnee' },
    { v: 'beach', label: '🏖️ Strand' }, { v: 'vulkan', label: '🌋 Vulkan' },
    { v: 'city', label: '🌃 Neonstadt' }, { v: 'toy', label: '🧸 Kinderzimmer' },
    { v: 'random', label: '🎲 Zufall' }] },
  items: { label: 'Items', type: 'choice', default: 'on', options: [
    { v: 'on', label: '🎁 An' }, { v: 'off', label: '⚪ Aus' }] },
  targetPoints: { label: 'Punkte bis Sieg', type: 'number', default: 5, min: 2, max: 15, step: 1 }
} });
