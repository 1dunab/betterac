// Wauwau-WG — loaded by BOTH screen.html and controller.html.
// Design + message protocol: docs/WAUWAUWG.md
registerGame({ key: 'wauwauwg', label: '🐶 Wauwau-WG', min: 1, settings: {
  tag: { label: 'Tageslänge', type: 'choice', default: 'normal', options: [
    { v: 'kurz', label: 'Kurz (~3 min)' },
    { v: 'normal', label: 'Normal (~5 min)' },
    { v: 'lang', label: 'Lang (~8 min)' }
  ] }
} });
