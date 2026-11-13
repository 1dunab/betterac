registerGame({ key: 'bandsalat', label: '🎶 Bandsalat', min: 1, settings: {
  stil: { label: 'Stil', type: 'choice', default: 'lofi', options: [{ v: 'lofi', label: '☕ Lofi' }, { v: 'funk', label: '🕺 Funk' }, { v: 'techno', label: '🔊 Techno' }, { v: 'lager', label: '🔥 Lagerfeuer' }] },
  raster: { label: 'Raster', type: 'choice', default: '16', options: [{ v: '16', label: 'Sechzehntel' }, { v: '8', label: 'Achtel' }, { v: 'aus', label: 'Aus (frei)' }] },
  begleitung: { label: 'Begleitung', type: 'choice', default: 'klick', options: [{ v: 'aus', label: 'Aus' }, { v: 'klick', label: 'Klick' }, { v: 'beat', label: 'Leiser Beat' }] }
} });
