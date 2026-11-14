registerGame({ key: 'verlies', label: '🎲 Würfelverlies', min: 1, about: 'Würfeln, Monster rufen, Verlies-Wege legen und den Meister der anderen stürzen.', cat: 'duell', settings: {
  bots: { label: 'Bots', type: 'number', default: 1, min: 0, max: 3, step: 1 },
  modus: { label: 'Sieg', type: 'choice', default: 'last', options: [
    { v: 'last', label: '👑 Jeder gegen jeden · der Letzte gewinnt' },
    { v: 'first', label: '⚡ Wer zuerst einen Meister stürzt, gewinnt' },
    { v: 'team', label: '🤝 Zwei gegen zwei (bei 4 Plätzen)' }] },
  herzen: { label: 'Herzen pro Meister', type: 'number', default: 3, min: 1, max: 5, step: 1 },
  lager: { label: 'Wappenlager', type: 'choice', default: '10', options: [
    { v: '10', label: '🎒 Max. 10 Wappen je Sorte' }, { v: '5', label: '🎒 Max. 5 Wappen je Sorte' },
    { v: '20', label: '🎒 Max. 20 Wappen je Sorte' }, { v: '99', label: '🎒 Wappenlager unbegrenzt' }] },
  formel: { label: 'Schaden', type: 'choice', default: 'klassisch', options: [
    { v: 'klassisch', label: '⚔️ Schaden klassisch: Abwehr zieht DEF ab' },
    { v: 'panzer', label: '🛡️ Schaden gepanzert: DEF zählt immer halb' },
    { v: 'kratzer', label: '🩹 Schaden: jeder Treffer mind. 10' }] },
  feld: { label: 'Feld', type: 'choice', default: 'auto', options: [
    { v: 'auto', label: '📐 Feldgröße nach Spielerzahl' }, { v: '15', label: '📐 Feld 15×15' },
    { v: '17', label: '📐 Feld 17×17' }, { v: '19', label: '📐 Feld 19×19' }, { v: '21', label: '📐 Feld 21×21' }] },
  monster: { label: 'Ausgeschieden', type: 'choice', default: 'vanish', options: [
    { v: 'vanish', label: '👻 Monster Ausgeschiedener verschwinden' },
    { v: 'stay', label: '🗿 Monster Ausgeschiedener bleiben als wilde Hindernisse' }] },
  pfade: { label: 'Wege', type: 'choice', default: 'stay', options: [
    { v: 'stay', label: '🧱 Wege Ausgeschiedener bleiben liegen' },
    { v: 'vanish', label: '🧱 Wege Ausgeschiedener zerbröckeln' }] },
  zugzeit: { label: 'Bedenkzeit', type: 'choice', default: '90', options: [
    { v: '90', label: '⏱️ 90 s Bedenkzeit je Schritt' }, { v: '45', label: '⏱️ 45 s Bedenkzeit je Schritt' },
    { v: '150', label: '⏱️ 150 s Bedenkzeit je Schritt' }, { v: '0', label: '⏱️ Ohne Zeitlimit' }] },
  runden: { label: 'Runden', type: 'choice', default: '0', options: [
    { v: '0', label: '♾️ Ohne Rundenlimit' }, { v: '20', label: '🔚 Nach 20 Runden zählen die Herzen' },
    { v: '30', label: '🔚 Nach 30 Runden zählen die Herzen' }] },
  kamera: { label: 'Kamera', type: 'choice', default: 'auto', options: [
    { v: 'auto', label: '🎥 Kamera folgt dem Geschehen' }, { v: 'fest', label: '🗺️ Immer das ganze Feld' }] }
} });
