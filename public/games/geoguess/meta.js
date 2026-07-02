registerGame({ key: 'geoguess', label: '📍 Geo-Pin', min: 1, settings: {
  scope: { label: 'Gebiet', type: 'choice', default: 'world', options: [
    { v: 'world', label: 'Welt' }, { v: 'europe', label: 'Europa' }, { v: 'germany', label: 'Deutschland' }] },
  category: { label: 'Kategorie', type: 'choice', default: 'cities', options: [
    { v: 'cities', label: 'Städte' }, { v: 'landmarks', label: 'Orte' }] },
  rounds: { label: 'Runden', type: 'number', default: 5, min: 3, max: 12, step: 1 },
  roundTime: { label: 'Zeit', type: 'number', default: 25, min: 10, max: 60, step: 5, unit: 's' }
} });
