/* One set of objective hints for the laptop, phone and independent online view. */
(function (root) {
  'use strict';
  const W = typeof module !== 'undefined' && module.exports ? require('./world') : root.BreachWorld;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  function ranking(s) {
    return s.actors.slice().sort((a, b) => (s.stats[b.id]?.kills || 0) - (s.stats[a.id]?.kills || 0) || (s.stats[a.id]?.deaths || 0) - (s.stats[b.id]?.deaths || 0) || String(a.id).localeCompare(String(b.id)));
  }
  function objective(s, p) {
    const cue = { title: '', detail: '', action: 'ZIEL', progress: 0, ready: false, target: null, distance: 0 };
    const mode = W.modes[s.cfg.mode] || W.modes.tactical;
    if (s.phase === 'end' || s.phase === 'roundOver') {
      cue.title = s.result?.reason || 'Runde beendet'; cue.detail = s.phase === 'end' ? 'Bereit für eine Revanche?' : (s.cfg.mode === 'survival' ? 'Nächste Welle · alle werden geheilt · ' : 'Nächste Runde in ') + Math.max(0, Math.ceil(s.remaining)) + ' s'; return cue;
    }
    if (!p.alive) {
      cue.title = mode.respawn ? 'Wiedereinstieg in ' + Math.max(0, Math.ceil(p.respawn)) + ' s' : 'Dein Team ist noch im Einsatz';
      cue.detail = mode.respawn ? 'Gleich geht es mit voller Ausrüstung weiter' : s.cfg.mode === 'survival' ? 'Du kehrst zur nächsten Welle zurück' : 'Du schaust einem Teammitglied zu'; return cue;
    }
    if (s.phase === 'prep') { cue.title = (s.cfg.mode === 'survival' ? 'Welle ' + s.round + ' / 5' : mode.label) + ' · Start in ' + Math.max(0, Math.ceil(s.remaining)) + ' s'; cue.detail = s.cfg.mode === 'deathmatch' ? 'Abschüsse sammeln · Wiedereinstieg nach 3 s' : s.cfg.mode === 'tactical' ? p.team === 0 ? 'Bombe auf A oder B legen' : 'A und B sichern · Bombe entschärfen' : mode.description; return cue; }
    if (s.cfg.mode === 'ffa') {
      const kills = s.stats[p.id]?.kills || 0, rank = 1 + s.actors.filter(a => (s.stats[a.id]?.kills || 0) > kills).length;
      cue.title = 'PLATZ ' + rank + ' · ' + kills + ' / ' + W.ffaTarget + ' ABSCHÜSSE';
      cue.detail = p.spawnShield > 0 ? 'Startschutz · Schießen beendet den Schutz' : W.weapons[p.weapon].zoom ? 'QUICK SCOPE antippen · PC: kurz rechts, dann links klicken' : 'Jeder ist ein Gegner · Quickscope: MR-9 oder Longbow wählen';
      return cue;
    }
    if (s.cfg.mode === 'arsenal') {
      const stage = s.arsenalProgress[p.team], next = W.arsenalOrder[stage + 1];
      cue.title = 'WAFFENRENNEN · ' + Math.min(stage + 1, 10) + ' / 10 · ' + W.weapons[p.weapon].name;
      cue.detail = next ? 'Nächster Team-Abschuss → ' + W.weapons[next].name : 'Letzter Team-Abschuss gewinnt!'; return cue;
    }
    if (s.cfg.mode === 'survival') {
      const enemies = s.actors.filter(a => a.alive && a.team === 1).length;
      cue.title = 'WELLE ' + s.round + ' / 5 · ' + enemies + ' GEGNER';
      cue.detail = 'Zusammenbleiben · Ausrüstung und Team kehren zwischen Wellen zurück'; return cue;
    }
    if (s.cfg.mode === 'control') {
      const zone = s.zones.reduce((a, b) => distance(p, a) < distance(p, b) ? a : b);
      cue.target = { x: zone.x, z: zone.z, key: zone.key }; cue.distance = Math.round(distance(p, zone)); cue.action = 'EROBERN';
      cue.title = 'ZONEN · ' + Math.floor(s.zoneScores[p.team]) + ' : ' + Math.floor(s.zoneScores[1 - p.team]) + ' / ' + W.controlTarget;
      if (distance(p, zone) >= zone.r) cue.detail = zone.key + ' erreichen · etwa ' + cue.distance + ' m · Zone besetzen';
      else if (zone.contested) cue.detail = zone.key + ' UMKÄMPFT · Gegner aus der Zone drängen';
      else if (zone.owner === p.team) cue.detail = zone.key + ' GESICHERT · +1 Punkt pro Sekunde';
      else { cue.progress = zone.capturing === p.team ? zone.progress : 0; cue.detail = zone.key + ' EROBERN · im Kreis bleiben · ' + Math.max(0, 3 * (1 - cue.progress)).toFixed(1) + ' s'; }
      return cue;
    }
    if (s.cfg.mode === 'deathmatch') {
      cue.title = p.spawnShield > 0 ? 'Startschutz · ' + Math.ceil(p.spawnShield) + ' s' : 'TEAM-DEATHMATCH';
      cue.detail = p.spawnShield > 0 ? 'Schießen beendet den Schutz' : 'Abschüsse sammeln · ' + Math.max(0, Math.ceil(s.remaining)) + ' s übrig'; return cue;
    }
    const nearest = W.sites.reduce((a, b) => distance(p, a) < distance(p, b) ? a : b);
    const target = s.bomb || nearest;
    cue.target = { x: target.x, z: target.z, key: target.site || target.key };
    cue.distance = Math.round(distance(p, target));
    const still = Math.hypot(p.input?.forward || 0, p.input?.strafe || 0) < 0.1 && (p.y || 0) === 0;
    if (s.bomb) {
      if (p.team === 0) { cue.title = 'Bombe auf ' + s.bomb.site + ' sichern'; cue.detail = Math.max(0, Math.ceil(s.bomb.left)) + ' s · Gegner von der Bombe fernhalten'; return cue; }
      cue.action = 'ENTSCHÄRFEN'; cue.title = 'Bombe auf ' + s.bomb.site + ' · ' + Math.max(0, Math.ceil(s.bomb.left)) + ' s';
      if (distance(p, s.bomb) >= 2.8) cue.detail = 'Zur Bombe · noch etwa ' + cue.distance + ' m';
      else if (s.bomb.defuser != null && s.bomb.defuser !== p.id) cue.detail = 'Team entschärft · Deckung geben';
      else {
        cue.ready = still; cue.progress = Math.min(1, s.bomb.defuser === p.id ? s.bomb.defuse / 5 : 0);
        cue.detail = !still ? 'Stehen bleiben zum Entschärfen' : cue.progress > 0 ? 'ENTSCHÄRFEN · ' + (5 - s.bomb.defuse).toFixed(1) + ' s halten' : 'ZIEL / E halten · 5 s entschärfen';
      }
      return cue;
    }
    cue.title = (nearest.key === 'A' ? 'A · BIOLAB' : 'B · REAKTOR') + ' · etwa ' + cue.distance + ' m';
    if (p.team === 1) { cue.detail = 'Zugänge zu A und B sichern'; return cue; }
    cue.action = 'LEGEN';
    if (distance(p, nearest) >= nearest.r) cue.detail = 'A oder B erreichen und die Bombe legen';
    else {
      cue.ready = still; cue.progress = Math.min(1, p.plant / 2.5);
      cue.detail = !still ? 'Stehen bleiben zum Bombenlegen' : cue.progress > 0 ? 'BOMBE LEGEN · ' + (2.5 - p.plant).toFixed(1) + ' s halten' : 'ZIEL / E halten · 2,5 s Bombe legen';
    }
    return cue;
  }
  const api = { objective, ranking };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BreachFeedback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
