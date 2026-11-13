// Fotosalat: what the scavenger hunt asks for. Everything can be found or made up in a living room.
(function (root) {
  const list = [
    'etwas Rotes', 'etwas Rundes', 'etwas Weiches', 'etwas, das glänzt', 'etwas Winziges', 'etwas Gestreiftes',
    'etwas Grünes', 'etwas Durchsichtiges', 'etwas mit Punkten', 'etwas Goldenes',
    'das Älteste im Raum', 'das Hässlichste im Raum', 'das Teuerste im Raum', 'das Nutzloseste im Raum',
    'etwas, das mit B anfängt', 'etwas, das mit S anfängt', 'etwas, das mit K anfängt', 'etwas, das mit M anfängt',
    'ein Gesicht in einem Gegenstand', 'etwas, das aussieht wie ein Tier', 'etwas, das wie ein Hut aussieht',
    'ein Selfie mit jemand anderem', 'zwei Leute, die sich ähnlich sehen', 'jemand, der gerade lacht',
    'die schönsten Socken', 'eine Hand voller Dinge', 'ein Turm aus drei Sachen', 'dein Schuh an einem seltsamen Ort',
    'dein Lieblingssnack', 'etwas zu trinken', 'etwas, das gut riecht', 'etwas Essbares, das gelb ist',
    'etwas, das Krach macht', 'etwas, das leuchtet', 'etwas mit Knöpfen', 'etwas mit Rädern', 'etwas zum Lesen',
    'etwas, das älter ist als du', 'etwas aus deiner Hosentasche', 'etwas, das du geschenkt bekommen hast',
    'etwas aus Holz', 'etwas aus Metall', 'etwas aus Papier', 'etwas, das lebt', 'etwas, das man aufziehen oder aufdrehen kann',
    'ein Schatten', 'ein Spiegelbild', 'etwas von ganz nah', 'etwas von oben', 'der Blick aus dem Fenster',
    'dein gruseligstes Gesicht', 'dein Siegergesicht', 'eine Superhelden-Pose', 'so tun, als würdest du schlafen',
    'ein Stillleben mit Obst', 'das Unordentlichste im Raum', 'etwas, das hier nicht hingehört', 'ein Herz',
    'die Zahl 7', 'ein Buchstabe aus Gegenständen'
  ];
  if (typeof module === 'object' && module.exports) module.exports = list; else root.FotoTasks = list;
})(typeof window !== 'undefined' ? window : globalThis);
