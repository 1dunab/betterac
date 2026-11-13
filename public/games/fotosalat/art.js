// Fotosalat: the paintings to re-enact. All of them are in the public domain (the painters died more than
// 70 years ago; American Gothic was published in 1930). The files are scaled-down copies from Wikimedia Commons,
// the sources are listed in docs/FOTOSALAT.md. Loaded by the screen only: phones get file and title in their state.
(function (root) {
  const list = [
    { f: "mona-lisa.jpg", title: "Mona Lisa", by: "Leonardo da Vinci", year: "um 1503", w: 429, h: 640 },
    { f: "der-schrei.jpg", title: "Der Schrei", by: "Edvard Munch", year: "1893", w: 516, h: 640 },
    { f: "perlenohrring.jpg", title: "Das Mädchen mit dem Perlenohrring", by: "Jan Vermeer", year: "um 1665", w: 540, h: 640 },
    { f: "wanderer.jpg", title: "Der Wanderer über dem Nebelmeer", by: "Caspar David Friedrich", year: "um 1818", w: 500, h: 640 },
    { f: "armer-poet.jpg", title: "Der arme Poet", by: "Carl Spitzweg", year: "1839", w: 640, h: 500 },
    { f: "american-gothic.jpg", title: "American Gothic", by: "Grant Wood", year: "1930", w: 531, h: 640 },
    { f: "van-gogh.jpg", title: "Selbstbildnis", by: "Vincent van Gogh", year: "1889", w: 507, h: 640 },
    { f: "napoleon.jpg", title: "Bonaparte beim Überschreiten der Alpen", by: "Jacques-Louis David", year: "1801", w: 526, h: 640 },
    { f: "adam.jpg", title: "Die Erschaffung Adams", by: "Michelangelo", year: "um 1511", w: 640, h: 291 },
    { f: "whistlers-mutter.jpg", title: "Whistlers Mutter", by: "James McNeill Whistler", year: "1871", w: 640, h: 569 },
    { f: "verzweifelter.jpg", title: "Der Verzweifelte", by: "Gustave Courbet", year: "um 1844", w: 640, h: 524 },
    { f: "hermelin.jpg", title: "Die Dame mit dem Hermelin", by: "Leonardo da Vinci", year: "um 1490", w: 476, h: 640 },
    { f: "milchmaedchen.jpg", title: "Dienstmagd mit Milchkrug", by: "Jan Vermeer", year: "um 1658", w: 571, h: 640 },
    { f: "arnolfini.jpg", title: "Die Arnolfini-Hochzeit", by: "Jan van Eyck", year: "1434", w: 468, h: 640 },
    { f: "der-kuss.jpg", title: "Der Kuss", by: "Gustav Klimt", year: "1908", w: 638, h: 640 },
    { f: "duerer.jpg", title: "Selbstbildnis im Pelzrock", by: "Albrecht Dürer", year: "1500", w: 463, h: 640 },
    { f: "kartenspieler.jpg", title: "Die Kartenspieler", by: "Paul Cézanne", year: "um 1895", w: 640, h: 525 },
    { f: "marat.jpg", title: "Der Tod des Marat", by: "Jacques-Louis David", year: "1793", w: 497, h: 640 },
    { f: "kavalier.jpg", title: "Der lachende Kavalier", by: "Frans Hals", year: "1624", w: 526, h: 640 },
    { f: "goethe.jpg", title: "Goethe in der Campagna", by: "J. H. W. Tischbein", year: "1787", w: 640, h: 507 },
    { f: "flaming-june.jpg", title: "Flaming June", by: "Frederic Leighton", year: "1895", w: 639, h: 640 },
    { f: "buecherwurm.jpg", title: "Der Bücherwurm", by: "Carl Spitzweg", year: "um 1850", w: 344, h: 640 },
    { f: "washington.jpg", title: "Washington überquert den Delaware", by: "Emanuel Leutze", year: "1851", w: 640, h: 410 },
    { f: "blue-boy.jpg", title: "Der Knabe in Blau", by: "Thomas Gainsborough", year: "um 1770", w: 440, h: 640 },
    { f: "schokoladenmaedchen.jpg", title: "Das Schokoladenmädchen", by: "Jean-Étienne Liotard", year: "um 1744", w: 396, h: 640 },
    { f: "seifenblasen.jpg", title: "Die Seifenblasen", by: "Jean Siméon Chardin", year: "um 1734", w: 517, h: 640 },
    { f: "bar-folies.jpg", title: "Bar in den Folies-Bergère", by: "Édouard Manet", year: "1882", w: 640, h: 478 }
  ];
  if (typeof module === 'object' && module.exports) module.exports = list; else root.FotoArt = list;
})(typeof window !== 'undefined' ? window : globalThis);
