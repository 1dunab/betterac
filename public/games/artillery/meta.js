registerGame({ key: 'artillery', label: '💥 Artillery Hills', min: 2, about: 'Panzer-Duell auf Hügeln: Winkel, Wind und Spezialwaffen.', cat: 'duell', settings: {
  theme: { label: 'Gebiet', type: 'choice', default: 'random', options: [
    { v: 'random', label: '🎲 Zufall' }, { v: 'desert', label: '🌵 Wüste' },
    { v: 'snow', label: '❄️ Schnee' }, { v: 'volcano', label: '🌋 Vulkan' }] }
} });
