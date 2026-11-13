registerGame({ key: 'skyfarers', label: '🎈 Skyfarers', min: 1, about: 'Luftschiff-Crew verteidigt gemeinsam eine fliegende Insel.', cat: 'koop', settings: {
  dauer: { label: 'Tageslänge', type: 'choice', default: 'normal', options: [
    { v: 'kurz', label: '⏱️ Kurz · 4 Min' }, { v: 'normal', label: '☀️ Normal · 6 Min' }, { v: 'lang', label: '🌙 Lang · 8 Min' }] },
  schwierigkeit: { label: 'Unwetter', type: 'choice', default: 'normal', options: [
    { v: 'leicht', label: '🌤️ Mild' }, { v: 'normal', label: '⛈️ Normal' }, { v: 'heftig', label: '🌪️ Heftig' }] },
  bots: { label: 'Bot-Kapitäne', type: 'number', default: 1, min: 0, max: 3, step: 1 },
  quality: { label: 'Grafik', type: 'choice', default: 'auto', options: [
    { v: 'auto', label: '🤖 Auto' }, { v: 'high', label: '✨ Voll' }, { v: 'low', label: '🔋 Sparsam' }] }
} });
