registerGame({ key: 'neonspur', label: '⚡ Neonspur', min: 1, settings: {
  map: { label: 'Arena', type: 'choice', default: 'raster', options: [
    { v: 'raster', label: '🟦 Raster' }, { v: 'saeulen', label: '🏛️ Säulenhalle' },
    { v: 'terrassen', label: '🪜 Terrassen' }, { v: 'random', label: '🎲 Zufall' }] },
  bots: { label: 'Bots', type: 'number', default: 1, min: 0, max: 3, step: 1 },
  botLevel: { label: 'Bot-Stärke', type: 'choice', default: 'normal', options: [
    { v: 'easy', label: 'Leicht' }, { v: 'normal', label: 'Normal' }, { v: 'hard', label: 'Schwer' }] },
  tempo: { label: 'Tempo', type: 'choice', default: 'normal', options: [
    { v: 'chill', label: 'Gemütlich' }, { v: 'normal', label: 'Normal' }, { v: 'fast', label: 'Turbo' }] },
  target: { label: 'Rundensiege', type: 'number', default: 3, min: 1, max: 9, step: 1 },
  camera: { label: 'Fernseher', type: 'choice', default: 'split', options: [
    { v: 'split', label: '🎥 Split-Screen' }, { v: 'overview', label: '🗺️ Übersicht' }] },
  extras: { label: 'Turbo & Extras', type: 'choice', default: 'on', options: [
    { v: 'on', label: '🚀 An' }, { v: 'off', label: '⚪ Aus · klassisch' }] },
  quality: { label: 'Grafik', type: 'choice', default: 'high', options: [
    { v: 'high', label: '✨ Voll' }, { v: 'low', label: '🔋 Sparsam' }] }
} });
