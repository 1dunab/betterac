// Rückwärtsgang: what to say. Three levels; the hard one is short sentences.
(function (root) {
  const words = {
    leicht: ['Oma', 'Opa', 'Hallo', 'Mama', 'Papa', 'Auto', 'Pizza', 'Kino', 'Sofa', 'Limo', 'Tomate', 'Kakao', 'Radio', 'Uhu', 'Igel',
      'Esel', 'Hose', 'Nase', 'Dose', 'Tasse', 'Lampe', 'Musik', 'Salami', 'Kanu', 'Zebra', 'Lama', 'Mofa', 'Foto', 'Juhu', 'Aua',
      'Miau', 'Kuckuck', 'Banane', 'Melone', 'Kamel', 'Tiger', 'Hupe', 'Nudel', 'Apfel', 'Käse'],
    mittel: ['Ananas', 'Lagerfeuer', 'Schokolade', 'Regenbogen', 'Krokodil', 'Elefant', 'Marmelade', 'Gummibär', 'Spaghetti', 'Fernseher',
      'Kartoffel', 'Dinosaurier', 'Papagei', 'Limonade', 'Wassermelone', 'Staubsauger', 'Kühlschrank', 'Feierabend', 'Kindergarten',
      'Wochenende', 'Geburtstag', 'Schmetterling', 'Kaulquappe', 'Rhabarber', 'Nilpferd', 'Zahnbürste', 'Pfannkuchen', 'Apfelsaft',
      'Tintenfisch', 'Blumenkohl', 'Rollmops', 'Kugelschreiber', 'Hubschrauber', 'Fledermaus', 'Lokomotive', 'Marzipan', 'Abrakadabra',
      'Simsalabim', 'Halleluja', 'Wackelpudding'],
    schwer: ['Ich habe Hunger', 'Wo ist mein Handy?', 'Guten Morgen, Sonnenschein', 'Das ist ja der Hammer', 'Hol mich hier raus',
      'Noch ein Stück Kuchen, bitte', 'Der Hund hat es gefressen', 'Morgen ist auch noch ein Tag', 'Ich glaub, mein Schwein pfeift',
      'Alles hat ein Ende', 'Rückwärts ist auch eine Richtung', 'Das Leben ist kein Ponyhof', 'Einmal Pommes mit Mayo', 'Ich war das nicht',
      'Wer hat an der Uhr gedreht?', 'Houston, wir haben ein Problem', 'Ich bin dann mal weg', 'Da wird der Hund in der Pfanne verrückt',
      'Erst die Arbeit, dann das Vergnügen', 'Wer zuletzt lacht, lacht am besten', 'Heute ist ein schöner Tag', 'Kannst du das bitte wiederholen?',
      'Ich verstehe nur Bahnhof', 'Jetzt geht es um die Wurst', 'Das ist nicht mein Bier', 'Wo geht es hier zum Strand?', 'Ich hätte gern ein Eis',
      'Gleich gibt es Abendbrot', 'Mein Name ist Hase', 'Abwarten und Tee trinken']
  };
  if (typeof module === 'object' && module.exports) module.exports = words; else root.RwWords = words;
})(typeof window !== 'undefined' ? window : globalThis);
