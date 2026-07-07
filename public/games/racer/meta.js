registerGame({ key: 'racer', label: '🏎️ Micro Racer', min: 2, settings: {
  track: { label: 'Strecke', type: 'choice', default: 'desert', options: [
    { v: 'desert', label: '🌵 Wüste' }, { v: 'snow', label: '❄️ Schnee' },
    { v: 'beach', label: '🏖️ Strand' }, { v: 'random', label: '🎲 Zufall' }] },
  targetPoints: { label: 'Punkte bis Sieg', type: 'number', default: 5, min: 2, max: 10, step: 1 }
} });
