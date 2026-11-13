// Wer spricht da?: what everybody says. Short, so that a recording lasts two or three seconds.
(function (root) {
  const list = [
    'Ich war es nicht.', 'Wer hat den Kuchen gegessen?', 'Mein Name ist Hase.', 'Heute ist ein schöner Tag.',
    'Ich hätte gern eine Kugel Vanille.', 'Der Hund hat meine Hausaufgaben gefressen.', 'Wo ist die Fernbedienung?',
    'Ich bin ein kleiner Teekessel.', 'Morgen fange ich mit Sport an.', 'Das Paket liegt beim Nachbarn.',
    'Bitte einmal Pommes rot-weiß.', 'Der Bus kommt in drei Minuten.', 'Ich glaube, es regnet gleich.',
    'Hallo, hier spricht der Weihnachtsmann.', 'Achtung, Achtung, eine Durchsage.', 'Ich habe nichts gesehen.',
    'Das ist streng geheim.', 'Noch fünf Minuten, bitte.', 'Die Katze sitzt auf der Tastatur.', 'Wir müssen reden.',
    'Ich hab da mal eine Frage.', 'Alles Gute zum Geburtstag.', 'Guten Abend, meine Damen und Herren.',
    'Es war einmal vor langer Zeit.', 'Ich nehme das Gleiche wie immer.', 'Wer hat hier gepupst?',
    'Der Kühlschrank ist schon wieder leer.', 'Einmal volltanken, bitte.', 'Das WLAN geht schon wieder nicht.',
    'Hilfe, ich bin ein Roboter.', 'Gib mir sofort die Schokolade.', 'Ich bin dann mal im Garten.'
  ];
  if (typeof module === 'object' && module.exports) module.exports = list; else root.WsSentences = list;
})(typeof window !== 'undefined' ? window : globalThis);
