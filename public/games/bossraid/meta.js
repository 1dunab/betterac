registerGame({ key: 'bossraid', label: '🐉 Boss Raid', min: 1, settings: {
  boss: { label: 'Boss', type: 'choice', default: 'kraken', options: [
    { v: 'kraken', label: '🐙 Void-Kraken' }, { v: 'mecha', label: '🤖 Mecha-Kern' },
    { v: 'dragon', label: '🐉 Neon-Drache' }, { v: 'random', label: '🎲 Zufall' }] },
  difficulty: { label: 'Härte', type: 'choice', default: 'normal', options: [
    { v: 'normal', label: 'Normal' }, { v: 'hard', label: 'Albtraum' }] }
} });
