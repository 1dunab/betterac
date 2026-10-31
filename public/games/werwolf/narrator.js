// Werwolfnacht — narrator: German texts + optional speech. -> window.WerwolfNarrator
// Never throws; works without speechSynthesis (JSDOM, old TVs). See docs/WERWOLF.md.
(function () {
  'use strict';

  // ---- roles: article helper ----
  // kind 'def' = bestimmter Artikel, 'indef' = unbestimmter, '' = none (Amor)
  const ROLE = {
    wolf:     { n: 'Werwolf',     art: 'ein',  g: 'm' },
    villager: { n: 'Dorfbewohner', art: 'ein', g: 'm' },
    seer:     { n: 'Seherin',     art: 'die',  g: 'f' },
    guard:    { n: 'Beschützer',  art: 'der',  g: 'm' },
    cupid:    { n: 'Amor',        art: '',     g: 'm' },
    witch:    { n: 'Hexe',        art: 'die',  g: 'f' },
    hunter:   { n: 'Jäger',       art: 'der',  g: 'm' }
  };
  function roleName(key) { return ROLE[key] ? ROLE[key].n : String(key || ''); }
  function rolePhrase(key, acc) {
    const r = ROLE[key];
    if (!r) return key ? String(key) : '';
    if (!r.art) return r.n;
    let art = r.art;
    if (acc && art === 'der') art = 'den';
    if (acc && art === 'ein' && r.g === 'm') art = 'einen';
    return art + ' ' + r.n;
  }
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  // ---- texts: {name} {role} (nominative with article) {roleAcc} {roleName} {n}; {Role} = capitalised ----
  const L = {
    intro: [
      'Willkommen in Düsterwald. Hier schläft das Dorf friedlich, und friedlich ist ein dehnbarer Begriff.',
      'Ein stilles Dorf, ein voller Mond und ein paar sehr verdächtige Nachbarn. Es kann losgehen.',
      'Düsterwald heißt euch willkommen. Das Rudel hat bereits reserviert.',
      'Heute Nacht wird nicht nur geschlafen. Manche von euch haben nämlich Zähne.'
    ],
    roles: [
      'Seht heimlich auf eure Karte. Und bitte, macht dabei ein ehrliches Gesicht.',
      'Jeder bekommt seine Rolle. Behaltet sie für euch, auch wenn es schwerfällt.',
      'Die Rollen sind verteilt. Schaut nach, wer ihr in Wahrheit seid.',
      'Karten prüfen, Pokerface aufsetzen. Wer lächelt, ist schon verdächtig.'
    ],
    nightFalls: [
      'Die Nacht senkt sich über das Dorf. Die Läden schließen sich.',
      'Es wird dunkel in Düsterwald. Jede Tür ist verriegelt, nur nicht jede ehrlich.',
      'Der Mond geht auf, und das Dorf hält den Atem an.',
      'Gute Nacht, Düsterwald. Schlaft schön, falls ihr könnt.',
      'Die Sonne verschwindet hinter den Hügeln. Im Wald raschelt es.'
    ],
    nightDeep: [
      'Tief in der Nacht regt sich etwas. Wer wach ist, ist selbst schuld.',
      'Der Nebel kriecht durch die Gassen. Irgendwo knackt ein Ast.',
      'Alle tun, als ob sie schlafen. Einige tun nur so.',
      'Draußen heult es. Drinnen wird heimlich getuschelt.',
      'Stille. Nur eine Dielenbohle knarrt. Schon wieder.'
    ],
    dawn: [
      'Der Morgen graut. Das Dorf erwacht und zählt durch.',
      'Die ersten Sonnenstrahlen fallen auf die Dächer. Wer fehlt?',
      'Hahnenschrei. Ein Blick in die Runde verrät, wie die Nacht war.',
      'Die Nacht ist vorbei. Öffnet die Läden und seid auf alles gefasst.'
    ],
    deathWolves: [
      '{name} wurde heute Nacht gerissen. Es war {role}.',
      'Spuren im Morgentau: {name} hat das Rudel nicht überlebt. {Role} ist nicht mehr.',
      '{name} liegt vor der Tür. Die Wölfe waren hungrig. Es war {role}.',
      'Ein Schrei im Morgengrauen: {name} ist tot. Gebissen, nicht gestolpert.',
      '{name} kommt nicht mehr zum Frühstück.'
    ],
    deathPoison: [
      '{name} hat einen Trank getrunken, den niemand bestellt hatte. Es war {role}.',
      'Neben {name} steht ein leeres Fläschchen. Giftig, grün und endgültig.',
      '{name} ist an einem Zaubertrank gestorben. Da hat jemand Hexenwerk betrieben.',
      'Seltsamer Geruch, grünlicher Schimmer: {name} wurde vergiftet.'
    ],
    deathGrief: [
      '{name} konnte ohne die große Liebe nicht weiterleben. Es war {role}.',
      'Ein gebrochenes Herz weniger im Dorf: {name} folgt dem Liebsten in den Tod.',
      '{name} ist an gebrochenem Herzen gestorben. Das gibt es wirklich.',
      'Liebe ist stark, Düsterwald ist gnadenlos. {name} folgt in den Tod.'
    ],
    deathHunter: [
      '{name} wurde vom Pfeil des Jägers getroffen. Es war {role}.',
      'Der letzte Schuss sitzt: {name} fällt, {role}.',
      '{name} hat den Pfeil abbekommen. Der Jäger hat nicht gezittert.',
      'Ein Pfeil pfeift durch die Luft. {name} sinkt zu Boden.'
    ],
    deathVote: [
      '{name} wird verbannt. Der Mob war sich einig. Es war {role}.',
      'Das Dorf hat gesprochen: {name} muss gehen. Es war {role}.',
      '{name} hängt der Mehrheit im Weg, und die hat entschieden.',
      'Die Heugabeln zeigen auf {name}. Das Urteil steht.',
      '{name} wird aus dem Dorf getrieben. Hoffentlich zu Recht.'
    ],
    noDeath: [
      'Niemand ist gestorben. Ein Wunder, oder ein sehr guter Plan.',
      'Alle sind noch da. Die Wölfe hatten wohl einen schlechten Abend.',
      'Keine Toten diese Nacht. Das Dorf atmet auf, aber nur kurz.',
      'Das Dorf ist vollzählig. Irgendwer hat offenbar Glück gehabt.',
      'Ruhige Nacht. Zu ruhig, wenn ihr mich fragt.'
    ],
    suspicion: [
      'Am meisten Misstrauen trifft {name}. Dem Dorf ist der Blick nicht ganz geheuer.',
      'Die Stimmung ist klar: {name} ist verdächtig. Aber Verdacht ist kein Beweis.',
      'Flüstern in den Gassen. Der Name, der am häufigsten fällt: {name}.',
      '{name} liegt im Rennen um das größte Misstrauen vorn.'
    ],
    trust: [
      'Das größte Vertrauen genießt {name}. Fragt sich nur, ob zu Recht.',
      '{name} wirkt vertrauenswürdig. Das macht manche erst recht misstrauisch.',
      'Wem glaubt das Dorf? {name}, dem Liebling der Nacht.',
      'Auf {name} lassen die meisten nichts kommen.'
    ],
    hunterRises: [
      '{name} war der Jäger! Mit dem letzten Atem greift er zum Bogen.',
      'Der Jäger fällt nicht allein. {name} legt noch einmal an.',
      '{name} ist der Jäger. Ein letzter Schuss, ein letzter Verdacht.',
      'Der Bogen in der Hand, der Blick kalt: {name} wird nicht still gehen.'
    ],
    dayTalk: [
      'Sprecht miteinander. Wer hat sich verdächtig benommen?',
      'Die Diskussion ist eröffnet. Fasst euch kurz, die Wölfe lauschen mit.',
      'Redet, streitet, beschuldigt. Aber seid bereit, es zu begründen.',
      'Der Tag gehört den Verdächtigungen. Wer schweigt, ist verdächtig. Wer zu viel redet auch.',
      'Tag {n}. Zeit für ein klärendes Gespräch am Dorfbrunnen.'
    ],
    talkHurry: [
      'Die Zeit wird knapp. Kommt zum Punkt.',
      'Noch wenige Augenblicke. Bildet euch eine Meinung.',
      'Die Sonne wandert weiter. Gleich wird abgestimmt.',
      'Letzte Chance für große Reden.'
    ],
    voteOpen: [
      'Die Abstimmung beginnt. Wer soll das Dorf verlassen?',
      'Zeit zu entscheiden. Zeigt auf euren Verdächtigen.',
      'Jetzt zählt jede Stimme. Wählt weise, oder wenigstens laut.',
      'Das Dorf stimmt ab. Mit dem Finger zeigt es sich leicht.'
    ],
    runoff: [
      'Gleichstand. Die Stichwahl entscheidet.',
      'Kein klarer Sieger. Noch einmal, nur unter den Gleichauf liegenden.',
      'Unentschieden, das Dorf zögert. Eine zweite Runde muss her.'
    ],
    noExecution: [
      'Das Dorf kann sich nicht einigen. Niemand wird verbannt.',
      'Keine Mehrheit, kein Urteil. Die Nacht kommt trotzdem.',
      'Heute wird niemand verjagt. Die Wölfe freuen sich leise.',
      'Es bleibt beim Streit. Niemand muss gehen, außer der Schlaf.'
    ],
    ghostsQuiet: [
      'Die Toten sehen alles, sagen aber nichts. Ehrensache.',
      'Geister, bitte schweigen! Ihr dürft nur gucken.',
      'Wer tot ist, schaut zu und hält den Mund. So will es die Etikette.',
      'Ein Geist verrät nichts. Zumindest nicht laut.'
    ],
    winVillage: [
      'Das Dorf hat gewonnen! Die Wölfe sind erledigt, die Läden bleiben offen.',
      'Düsterwald ist gerettet. Die Nacht gehört wieder dem Schlaf.',
      'Sieg für das Dorf! Der letzte Wolf zieht heulend ab.',
      'Die Heugabeln haben gesiegt. Morgen gibt es Kuchen.'
    ],
    winWolves: [
      'Die Wölfe haben gewonnen. Das Dorf gehört jetzt dem Rudel.',
      'Es heult im Dorf. Die Wölfe sind unter sich, und satt.',
      'Sieg für die Wölfe! Der Mond hat es kommen sehen.',
      'Die Wölfe haben den Tisch für sich allein. Das Dorf ist still.'
    ],
    winLovers: [
      'Die Liebenden haben gesiegt! Gegen Dorf und Rudel hielt ihr Herz zusammen.',
      'Zwei Herzen, zwei Überlebende. Amors Pfeil hat sich ausgezahlt.',
      'Sieg der Liebe! Schade nur um den Rest des Dorfes.',
      'Die beiden Verliebten bleiben als Letzte übrig. Wie romantisch, wie unheimlich.'
    ],
    winNobody: [
      'Niemand hat überlebt. Ein ruhiges Dorf, endlich.',
      'Das Dorf ist leer. Auch die Wölfe sind weg. Unentschieden.',
      'Keiner bleibt übrig. Der Wald schweigt.',
      'Alle sind weg, auch ihr. Das war wohl ein Unentschieden.'
    ],
    // ---- extras ----
    stepHurry: [
      'Beeilt euch, die Nacht dauert nicht ewig.',
      'Manche zögern noch. Der Morgen wartet nicht.',
      'Letzte Handgriffe, bevor es hell wird.',
      'Wer noch etwas vorhat, sollte sich sputen.'
    ],
    everyoneReady: [
      'Alle sind bereit. Dann kann es losgehen.',
      'Alle nicken. Das Dorf ist startklar.',
      'Jeder hat Bescheid gewusst. Weiter geht es.',
      'Vollzählig bereit, selten genug.'
    ],
    offline: [
      '{name} hat die Verbindung verloren. Das Dorf wartet nicht lange.',
      '{name} ist gerade weg. Vielleicht eingeschlafen, vielleicht gefressen.',
      'Bei {name} ist das Licht aus. Das Telefon schläft.',
      '{name} ist nicht mehr zu erreichen. Der Wald hat eben Funklöcher.'
    ],
    welcomeBack: [
      '{name} ist wieder da. Verdächtig, dieses Timing.',
      '{name} hat zurückgefunden. Willkommen im Dorf.',
      'Da ist {name} ja wieder. Wo warst du?',
      '{name} ist zurück und tut, als wäre nichts gewesen.'
    ],
    loversBound: [
      'Zwei Herzen wurden verbunden. Wer es ist, erfahren sie unter sich.',
      'Amors Pfeil hat getroffen. Zwei Menschen werden nicht mehr allein sein.',
      'Heimliche Liebe in Düsterwald. Das wird noch Folgen haben.'
    ],
    hunterMiss: [
      'Der Jäger lässt den Bogen sinken. Diesmal trifft er niemanden.',
      '{name} zögert zu lange. Der Pfeil bleibt im Köcher.',
      'Kein Schuss. Der Jäger geht ohne Ziel.'
    ]
  };

  const last = {};
  const SLOT = /\{(Role|role|roleAcc|roleName|name|n)\}/g;

  function line(key, vars) {
    try {
      vars = vars || {};
      const list = L[key];
      if (!list) return String(key);
      const has = (k) => vars[k] != null && vars[k] !== '';
      const need = (t) => {
        const ms = t.match(SLOT) || [];
        return ms.every((m) => {
          const k = m.slice(1, -1);
          return k === 'Role' || k === 'role' || k === 'roleAcc' || k === 'roleName' ? has('role') : has(k);
        });
      };
      let pool = list.filter(need);
      if (!pool.length) pool = list.filter((t) => !/\{\w+\}/.test(t));
      if (!pool.length) pool = list;
      if (has('role')) {
        const withRole = pool.filter((t) => /\{(Role|role|roleAcc|roleName)\}/.test(t));
        if (withRole.length) pool = withRole;
      }
      let idx = -1;
      if (pool.length === 1) idx = 0;
      else {
        do { idx = Math.floor(Math.random() * pool.length); } while (list.indexOf(pool[idx]) === last[key]);
      }
      last[key] = list.indexOf(pool[idx]);
      const rk = vars.role;
      const rep = {
        name: vars.name, n: vars.n,
        role: rolePhrase(rk), Role: cap(rolePhrase(rk)), roleAcc: rolePhrase(rk, true), roleName: roleName(rk)
      };
      return pool[idx].replace(SLOT, (m, k) => (rep[k] == null ? '' : rep[k])).replace(/\s+/g, ' ').trim();
    } catch (e) { return ''; }
  }

  // ---- speech ----
  let voiceOn = true;
  let voice = null;
  const synth = (typeof window !== 'undefined' && window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function') ? window.speechSynthesis : null;

  function pickVoice() {
    try {
      if (!synth) return;
      const vs = synth.getVoices() || [];
      if (!vs.length) return;
      const de = vs.filter((v) => /^de([-_]|$)/i.test(v.lang || ''));
      if (!de.length) { voice = null; return; }
      const score = (v) => {
        let s = 0;
        if (/^de[-_]DE$/i.test(v.lang)) s += 10;
        if (/google/i.test(v.name)) s += 6;
        if (/anna|markus|helena|hedda|katja|conrad|stefan|natural|online/i.test(v.name)) s += 4;
        if (/compact|espeak/i.test(v.name)) s -= 5;
        if (v.localService === false) s += 1;
        return s;
      };
      voice = de.slice().sort((a, b) => score(b) - score(a))[0];
    } catch (e) { voice = null; }
  }
  try {
    pickVoice();
    if (synth && 'onvoiceschanged' in synth) synth.onvoiceschanged = pickVoice;
    else if (synth && synth.addEventListener) synth.addEventListener('voiceschanged', pickVoice);
  } catch (e) { /* ignore */ }

  // Duration estimate (ms): speech ~ 80 ms/char at rate 0.9, plus pauses; silent reading is quicker.
  function estimate(text, spoken) {
    const len = String(text || '').length;
    return spoken ? Math.max(1500, Math.round(len * 80 + 500)) : Math.max(1200, Math.round(len * 55 + 700));
  }

  function say(text) {
    text = String(text == null ? '' : text).trim();
    let spoken = false;
    try {
      if (text && voiceOn && synth) {
        const parts = text.match(/[^.!?]+[.!?]*/g) || [text];
        for (const p of parts) {
          const s = p.trim();
          if (!s) continue;
          const u = new window.SpeechSynthesisUtterance(s);
          u.lang = (voice && voice.lang) || 'de-DE';
          if (voice) u.voice = voice;
          u.rate = 0.9;
          u.pitch = 0.8;
          u.volume = 1;
          synth.speak(u);
        }
        spoken = true;
      }
    } catch (e) { spoken = false; }
    return estimate(text, spoken);
  }

  function setVoice(on) {
    voiceOn = !!on;
    if (!voiceOn) stop();
  }
  function stop() { try { if (synth) synth.cancel(); } catch (e) { /* ignore */ } }
  function available() { return !!synth; }

  window.WerwolfNarrator = {
    line, say, setVoice, stop, available,
    keys: Object.keys(L),
    roleName, rolePhrase
  };
})();
