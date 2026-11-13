// choice settings show their options only, without the label: every option has to say what it is about
registerGame({ key: 'bandsalat', label: '🎶 Bandsalat', min: 1, about: 'Jedes Handy ist ein Instrument. Zusammen entsteht ein Song.', cat: 'kreativ', settings: {
  stil: { label: 'Stil', type: 'choice', default: 'lofi', options: [{ v: 'lofi', label: '☕ Lofi' }, { v: 'funk', label: '🕺 Funk' }, { v: 'techno', label: '🔊 Techno' }, { v: 'lager', label: '🔥 Lagerfeuer' }] },
  raster: { label: 'Raster', type: 'choice', default: '16', options: [{ v: '16', label: 'Raster: Sechzehntel' }, { v: '8', label: 'Raster: Achtel' }, { v: 'aus', label: 'Ohne Raster' }] },
  begleitung: { label: 'Begleitung', type: 'choice', default: 'klick', options: [{ v: 'aus', label: 'Ohne Begleitung' }, { v: 'klick', label: 'Klick' }, { v: 'beat', label: 'Leiser Beat' }] }
} });
