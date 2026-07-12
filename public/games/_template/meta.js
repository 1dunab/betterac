// TEMPLATE — copy this folder to public/games/<yourkey>/ and replace every
// 'meingame' with your key. This file is loaded by BOTH screen.html and
// controller.html, so key/label/min/settings live in exactly one place.
registerGame({ key: 'meingame', label: '🎮 Mein Spiel', min: 2, settings: {
  // The shell renders this settings UI for the host and passes the values
  // as `cfg` into screen.start(ids, cfg). Types: 'number', 'choice', 'text'.
  ziel: { label: 'Klicks bis Sieg', type: 'number', default: 30, min: 10, max: 100, step: 10 }
} });
