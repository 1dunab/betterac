registerGame({ key: 'categories', label: '🏙️ Stadt Land Fluss', min: 2, settings: {
  rounds: { label: 'Runden', type: 'number', default: 3, min: 1, max: 8, step: 1 },
  roundTime: { label: 'Zeit', type: 'number', default: 60, min: 30, max: 120, step: 10, unit: 's' }
} });
