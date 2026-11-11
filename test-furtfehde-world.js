// Regeltests Furt & Fehde: Welt (world.js) – Katalog, Generator, Fairness, Flut-Regel, Wege, Platzierung, Codec, Zeiten.
// Phase 2 (Mauern & Söldner): die neuen Gebäude und Einheiten (hinten angehängt, Codes stabil), Wandlänge footprintOf(kind, rot, len), canPlace für Mauern, Torhaus-Gasse, Burgtor, Markt und
// Söldnerlager, suggest mit len, dieselben Antworten auf dem decodierten Gitter und field mit extra-Kosten (gewichtetes Feld).
const fs = require('fs');
const crypto = require('crypto');
const W = require('./public/games/furtfehde/world.js');
const { GW, GH, HX, HY, FX, FY, CLASSES, CI } = W;
const N = GW * GH;

let checks = 0;
function fail(msg) { console.error('FEHLER: ' + msg); process.exitCode = 1; }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function eq(a, b, msg) { checks++; if (a !== b) fail(msg + ' (erwartet ' + b + ', war ' + a + ')'); }
function near(a, b, tol, msg) { checks++; if (!(Math.abs(a - b) <= tol)) fail(msg + ' (erwartet ' + b + ' ±' + tol + ', war ' + a + ')'); }
const hash = (o) => crypto.createHash('md5').update(JSON.stringify(o)).digest('hex');
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const cache = {};
const world = (seed) => cache[seed] || (cache[seed] = W.make(seed));
const kxy = (k) => ({ x: -71.5 + k % GW, y: -44.5 + Math.floor(k / GW) });
const cellsOf = (w, pred) => { const out = []; for (let k = 0; k < N; k++) if (pred(k)) out.push(k); return out; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const dev = (a) => { const m = mean(a); return Math.max(...a.map(v => Math.abs(v - m) / m)); };

// ---- catalogs and constants ----
{
  eq(GW, 144, 'GW'); eq(GH, 90, 'GH'); eq(W.VRES, 2, 'VRES'); eq(W.BORDER, 12, 'BORDER'); eq(HX, 337, 'HX'); eq(HY, 229, 'HY'); eq(FX, 168, 'FX'); eq(FY, 114, 'FY');
  eq(W.FLOOD_Y, 1.2, 'FLOOD_Y'); eq(W.WADE_MAX, 0.45, 'WADE_MAX'); eq(W.DRY_EPS, 0.05, 'DRY_EPS'); eq(W.WADE_SPEED, 0.45, 'WADE_SPEED');
  eq(CLASSES.map(c => c.key).join(''), 'WFSBMAGTRH', 'Klassen-Schlüssel und Reihenfolge');
  eq(CLASSES.map(c => c.walk).join(','), '0,1,1,1,0.6,1,1,0.7,0,0', 'Gehtempo der Klassen');
  eq(CLASSES.filter(c => c.build).map(c => c.key).join(''), 'AG', 'bebaubare Klassen');
  ok(CLASSES.every(c => /^#[0-9a-f]{6}$/i.test(c.color) && c.name), 'Klassen haben Namen und Farben');
  const sz = (k) => W.BUILDINGS[k].size.join('x') + '/' + W.BUILDINGS[k].mat;
  eq(Object.keys(W.BUILDINGS).join(','), 'bergfried,huette,hof,kornspeicher,lager,holzfaeller,steinbruch,kaserne,wachturm,brunnen,palisade,mauer,torhaus,markt,soeldnerlager', 'Gebäudeliste (Phase 2 hinten angehängt: die Codes 1 + Index bleiben stabil)');
  eq([sz('bergfried'), sz('huette'), sz('hof'), sz('kornspeicher'), sz('lager')].join(' '), '6x6/stein 2x2/holz 5x4/holz 3x3/holz 3x3/holz', 'Gebäude 1');
  eq([sz('holzfaeller'), sz('steinbruch'), sz('kaserne'), sz('wachturm'), sz('brunnen')].join(' '), '2x2/holz 3x3/holz 4x3/stein 2x2/stein 1x1/stein', 'Gebäude 2');
  ok(Object.values(W.BUILDINGS).every(b => b.name && b.icon && b.draft && typeof b.draft === 'object'), 'Gebäude haben name/icon/draft');
  eq([sz('palisade'), sz('mauer'), sz('torhaus'), sz('markt'), sz('soeldnerlager')].join(' '), '1x1/holz 1x1/stein 3x2/stein 4x3/holz 5x4/holz', 'Phase-2-Gebäude (Mauern: Grundmaß 1 Zelle, die Länge kommt dazu)');
  eq(Object.keys(W.UNITS).join(','), 'bauer,speer,bogen,ritter,fackel,reiterschuetze,ramme', 'Einheiten (Phase 2 hinten angehängt)');
  eq(Object.values(W.UNITS).map(u => u.height).join(','), '1,1.15,1.1,1.8,1.05,1.7,1.6', 'Einheitenhöhen');
  eq(Object.keys(W.BUILDINGS).filter(k => W.BUILDINGS[k].wall).join(','), 'palisade,mauer', 'Mauern tragen wall: true'); eq(W.BUILDINGS.mauer.maxLen + '/' + W.BUILDINGS.palisade.maxLen, '4/4', 'Wandlänge 1–4');
  eq([W.isWall('mauer'), W.isWall('palisade'), W.isWall('torhaus'), W.isWall('huette'), W.isWall('zelt')].join(), 'true,true,false,false,false', 'isWall');
  eq([['mauer', 3], ['mauer'], ['torhaus'], ['wachturm'], ['palisade', 4], ['hof'], ['zelt']].map(([k, n]) => W.slotsOf(k, n)).join(), '3,1,4,3,0,0,0', 'slotsOf: Mauer 1 je Zelle, Torhaus 4, Wachturm 3, sonst 0');
  eq(Object.keys(W.BUILDINGS).map(k => W.CODE[k]).join(','), '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15', 'Gebäudecodes = 1 + Index');
  eq(W.surf(0.5), 0.6, 'surf(0.5)'); eq(W.surf(1), 1.2, 'surf(1)');
  eq(W.cellOf(-71.99, -44.99), 0, 'cellOf Ecke'); eq(W.cellOf(71.99, 44.99), N - 1, 'cellOf Gegenecke'); eq(W.cellOf(72, 0), -1, 'cellOf rechts raus'); eq(W.cellOf(0, -45.01), -1, 'cellOf oben raus');
  const c = W.cellXY(GW + 1); near(c.x, -70.5, 1e-9, 'cellXY x'); near(c.y, -43.5, 1e-9, 'cellXY y'); eq(W.cellOf(c.x, c.y), GW + 1, 'cellOf(cellXY)');
}

// ---- no forbidden APIs ----
{
  const src = fs.readFileSync('./public/games/furtfehde/world.js', 'utf8');
  ok(!/Math\.random/.test(src), 'world.js enthält Math.random');
  ok(!/\bDate\b/.test(src), 'world.js enthält Date');
  ok(!/performance\.now|setTimeout|document\.|window\./.test(src.replace(/typeof window[^;]*;/g, '')), 'world.js greift auf Browser-/Zeit-APIs zu');
}

// ---- determinism ----
{
  const sig = (w) => hash([Array.from(w.cls), Array.from(w.hq), Array.from(w.owner), w.trees, w.crossings]);
  for (const seed of [1, 7, 12, 30, 123456]) eq(sig(W.make(seed)), sig(W.make(seed)), 'seed ' + seed + ': deterministisch');
  ok(sig(world(1)) !== sig(world(2)), 'verschiedene Seeds -> verschiedene Karten');
  eq(hash(Array.from(W.make(5).heights)), hash(Array.from(W.make(5).heights)), 'Höhenfeld deterministisch');
  eq(W.make(5).seed, 5, 'Seed gemerkt');
}

// ---- bounds, structure, class table ----
for (const seed of SEEDS) {
  const w = world(seed), T = 'seed ' + seed + ': ';
  eq(w.cls.length, N, T + 'cls-Länge'); eq(w.hq.length, N, T + 'hq-Länge'); eq(w.owner.length, N, T + 'owner-Länge');
  eq(w.heights.length, HX * HY, T + 'heights-Länge'); eq(w.flow.length, FX * FY * 2, T + 'flow-Länge');
  ok(w.cls instanceof Uint8Array && w.hq instanceof Int8Array && w.owner instanceof Int8Array && w.heights instanceof Float32Array && w.flow instanceof Float32Array, T + 'Typed-Array-Typen');
  let bad = 0, badH = 0, badO = 0;
  for (let k = 0; k < N; k++) {
    const c = w.cls[k], q = w.hq[k];
    if (c > 9) bad++;
    if (q < -30 || q > 30) badH++;
    if (w.owner[k] < -1 || w.owner[k] > 3) badO++;
    // class table vs hq (decimetres): W < −0.45, F −0.45…0, S bank/sandbank, B deck, M reed, A 0.2…1.2, G ≥ 1.2
    const okc = c === CI.W ? q <= -5 : c === CI.F ? q >= -4 && q <= -1 : c === CI.S ? q >= 0 && q <= 5 : c === CI.B ? q >= 4 :
      c === CI.M ? q >= 2 && q <= 6 : c === CI.A ? q >= 2 && q <= 11 : c === CI.G ? q >= 12 : q >= 12;
    if (!okc) { bad++; if (bad < 4) console.error('  Zelle', k, 'Klasse', CLASSES[c].key, 'hq', q); }
    if (w.owner[k] >= 0 && (c === CI.W || c === CI.F || c === CI.B)) badO++;   // water and bridges are never owned
  }
  eq(bad, 0, T + 'Klassen gültig und zu hq passend'); eq(badH, 0, T + 'hq im Bereich −30…30'); eq(badO, 0, T + 'owner gültig, Wasser unbesessen');
  ok(w.heights.every(Number.isFinite) && w.flow.every(Number.isFinite), T + 'Höhen/flow endlich');
  eq(w.sites.length, 4, T + '4 Burgen');
  w.sites.forEach((s, i) => {
    eq(s.s, i, T + 'site.s'); ok(s.name, T + 'site.name');
    eq(s.keep.i, s.x + 69, T + 'keep.i'); eq(s.keep.j, s.y + 42, T + 'keep.j');
    let badKeep = 0;
    for (let dj = 0; dj < 6; dj++) for (let di = 0; di < 6; di++) { const k = (s.keep.j + dj) * GW + s.keep.i + di; if (w.owner[k] !== i || w.cls[k] !== CI.G) badKeep++; }
    eq(badKeep, 0, T + 'Bergfried-Fläche besessen und Wiese');
    near(W.heightAt(w, s.x, s.y), 3.5, 0.02, T + 'Burgplateau h = 3.5');
    ok(Math.abs(Math.abs(s.x) - 46) <= 4.2 && Math.abs(Math.abs(s.y) - 27) <= 4.2, T + 'Burg nahe (±46, ±27): ' + s.x + ',' + s.y);
    eq(Math.sign(s.x), i % 2 ? 1 : -1, T + 'Burg-x-Seite'); eq(Math.sign(s.y), i < 2 ? -1 : 1, T + 'Burg-y-Seite');
    // flat radius ≥ 7: every vertex within 7 is at 3.5
    let flat = true;
    for (let a = 0; a < 24; a++) if (Math.abs(W.heightAt(w, s.x + 7 * Math.cos(a * 0.26), s.y + 7 * Math.sin(a * 0.26)) - 3.5) > 0.02) flat = false;
    ok(flat, T + 'Plateau-Radius ≥ 7');
  });
  ok(!w.unfair, T + 'nicht unfair');
}

// ---- the retry fallback: a known-bad sub-seed is completed and flagged unfair ----
{
  const w = W._gen.finishUnfair(3, -216650296);
  eq(w.unfair, true, 'Fallback: unfair-Flag'); ok(w.stats.fails.length > 0, 'Fallback: Verstöße benannt (' + w.stats.fails.join(', ') + ')');
  ok(w.cls.length === N && w.heights.length === HX * HY && w.flow.length === FX * FY * 2 && w.crossings.length === 7 && w.trees.length > 1000 && w.roads.length > 0, 'Fallback-Welt ist vollständig');
  eq(w.stats.sites.length, 4, 'Fallback: stats.sites'); ok(W.encode(w).cls.length > 10, 'Fallback-Welt lässt sich kodieren');
}

// ---- rivers, Werder, crossings, instances ----
for (const seed of SEEDS) {
  const w = world(seed), T = 'seed ' + seed + ': ';
  eq(w.rivers.map(r => r.id).join(','), 'fluss,nordbach,suedbach', T + 'Flüsse');
  const fl = w.rivers[0], nb = w.rivers[1], sb = w.rivers[2];
  ok(fl.pts.every(p => Math.abs(p.x) > 72 || Math.abs(p.y) <= 7), T + 'Fluss |y| ≤ 7 im Spielfeld');
  ok(fl.pts[0].x <= -84 && fl.pts[fl.pts.length - 1].x >= 84, T + 'Fluss läuft bis an den Rand');
  ok(fl.pts.every((p, i) => i === 0 || p.x > fl.pts[i - 1].x), T + 'Fluss von West nach Ost');
  ok(fl.pts.every(p => p.w >= 2.8 && p.w <= 7.2), T + 'Flussbreite plausibel (Wasser 6–9, am Werder breiter)');
  const inMap = (pts) => pts.filter(p => Math.abs(p.y) <= 45);
  const mx = (r) => mean(inMap(r.pts).map(p => p.x));
  ok(Math.abs(mx(nb)) <= 3 && Math.abs(mx(sb)) <= 3, T + 'Bach-x-Mittel innerhalb ±3 (' + mx(nb).toFixed(2) + ' / ' + mx(sb).toFixed(2) + ')');
  const en = nb.pts[nb.pts.length - 1], es = sb.pts[sb.pts.length - 1];
  ok(en.x < 0 && en.x >= -8.3 && es.x > 0 && es.x <= 8.3, T + 'Bäche münden bis 8 von x=0 (Nord west, Süd ost): ' + en.x.toFixed(1) + ' / ' + es.x.toFixed(1));
  near(en.x, -es.x, 2.2, T + 'Mündungen punktsymmetrisch');
  ok(nb.pts[0].y <= -57 && sb.pts[0].y >= 57, T + 'Bäche kommen vom Rand');
  ok(nb.pts.every(p => p.w >= 1 && p.w <= 1.7), T + 'Bachbreite 2–3');
  const wd = w.werder;
  ok(Math.abs(wd.x) <= 2 && wd.rx * 2 >= 16 && wd.rx * 2 <= 20 && wd.ry * 2 >= 5 && wd.ry * 2 <= 8, T + 'Werder Größe/Lage');
  ok(Math.abs(wd.tower.x - wd.x) <= wd.rx - 2 && Math.abs(wd.tower.y - wd.y) <= wd.ry, T + 'Ruine auf der Insel');
  near(W.heightAt(w, wd.tower.x, wd.tower.y), 1.1, 0.35, T + 'Ruinenhügel trocken (h ≈ 1.1)');
  ok(W.heightAt(w, wd.tower.x, wd.tower.y) >= 0.9, T + 'Ruinenhügel trocken bis L ≈ 0.7');
  // crossings
  const cs = w.crossings, by = (id) => cs.find(c => c.id === id);
  eq(cs.map(c => c.id).join(','), 'westfurt,ostfurt,steinbruecke,nordsteg,nordfurt,suedsteg,suedfurt', T + 'Übergänge in Reihenfolge');
  eq(cs.filter(c => c.kind === 'furt' && c.water === 'fluss').length, 2, T + '2 Flussfurten');
  eq(cs.filter(c => c.kind === 'bruecke').length, 1, T + '1 Steinbrücke');
  eq(cs.filter(c => c.kind === 'steg').length, 2, T + '2 Stege');
  eq(cs.filter(c => c.kind === 'furt' && c.water !== 'fluss').length, 2, T + '2 Bachfurten');
  eq(cs.map(c => c.name).join(','), 'Westfurt,Ostfurt,Steinbrücke,Nordsteg,Nordfurt,Südsteg,Südfurt', T + 'Namen');
  eq(by('steinbruecke').spans.length, 2, T + 'Steinbrücke hat 2 Spannen');
  ok(by('westfurt').x >= -52.5 && by('westfurt').x <= -33.5 && by('ostfurt').x >= 33.5 && by('ostfurt').x <= 52.5, T + 'Flussfurten in x ∈ ±[34,52]');
  near(by('steinbruecke').x, wd.xb, 1e-9, T + 'Brücke bei werder.xb'); ok(Math.abs(by('steinbruecke').x - wd.x) <= 4, T + 'Brücke nahe der Werder-Mitte');
  const sep = (a, b) => Math.abs(by(a).y - by(b).y);
  ok(sep('nordsteg', 'nordfurt') >= 9.5 && sep('nordsteg', 'nordfurt') <= 25.5 && sep('suedsteg', 'suedfurt') >= 9.5 && sep('suedsteg', 'suedfurt') <= 25.5, T + 'Steg/Furt 10–25 auseinander');
  for (const c of cs) {
    ok(c.cells.length >= 8 && c.cells.every(k => k >= 0 && k < N), T + c.id + ' hat Zellen');
    ok(c.open > 0 && c.open < 1, T + c.id + ' open gültig (' + c.open + ')');
    ok(c.ends && c.ends.length === 2 && c.joins[0] >= 0 && c.joins[1] >= 0 && c.joins[0] !== c.joins[1], T + c.id + ' verbindet zwei Burgen');
    if (c.kind !== 'furt') ok(c.cells.every(k => w.cls[k] === CI.B), T + c.id + ' nur Brückenzellen');
    ok((c.ends[1].x - c.ends[0].x) * Math.cos(c.rot) + (c.ends[1].y - c.ends[0].y) * Math.sin(c.rot) > 5, T + c.id + ': rot zeigt von ends[0] nach ends[1]');
    ok(c.rot > -Math.PI && c.rot <= Math.PI, T + c.id + ' rot im Bereich');
    if (c.kind === 'steg') ok(c.len >= 4.5 && c.len <= 8, T + c.id + ' Länge');
  }
  const joined = (id) => by(id).joins.slice().sort().join('');
  eq(joined('westfurt'), '02', T + 'Westfurt NW–SW'); eq(joined('ostfurt'), '13', T + 'Ostfurt NO–SO'); eq(joined('steinbruecke'), '12', T + 'Steinbrücke NO–SW');
  eq(joined('nordsteg'), '01', T + 'Nordsteg'); eq(joined('nordfurt'), '01', T + 'Nordfurt'); eq(joined('suedsteg'), '23', T + 'Südsteg'); eq(joined('suedfurt'), '23', T + 'Südfurt');
  // Stege and bridge are 2 cells wide: count B cells across at the middle of the deck
  for (const c of cs.filter(c => c.kind !== 'furt')) {
    const horiz = Math.abs(Math.cos(c.rot)) > 0.7;
    const probe = W.cellOf(c.x, c.y);
    let n = 0;
    for (let d = -3; d <= 3; d++) { const k = horiz ? probe + d * GW : probe + d; if (k >= 0 && k < N && w.cls[k] === CI.B) n++; }
    eq(n, 2, T + c.id + ' ist 2 Zellen breit');
  }
  // forests, rocks, crags, flow
  w.sites.forEach((si, q) => {
    let nearest = 1e9, rmin = 1e9, rmax = 0, forest = 0;
    for (let k = 0; k < N; k++) {
      if (w.owner[k] !== q) continue;
      const d = dist(kxy(k), si);
      if (w.cls[k] === CI.T) { nearest = Math.min(nearest, d); forest++; }
      if (w.cls[k] === CI.R) { rmin = Math.min(rmin, d); rmax = Math.max(rmax, d); }
    }
    ok(nearest >= 8 && nearest <= 16, T + 'Burg ' + q + ': nächster Waldrand 8–16 (' + nearest.toFixed(1) + ')');
    ok(rmin >= 18 && rmax <= 34, T + 'Burg ' + q + ': Fels 18–34 von der Burg (' + rmin.toFixed(1) + '–' + rmax.toFixed(1) + ')');
    // 2 outcrops, 2–4 forest patches: count 8-connected clusters (≥ 6 cells)
    const clusters = (cls, min) => { const seen = new Uint8Array(N); let n = 0; for (let k = 0; k < N; k++) { if (w.cls[k] !== cls || w.owner[k] !== q || seen[k]) continue; let c = 0; const st = [k]; seen[k] = 1; while (st.length) { const a = st.pop(), i = a % GW, j = (a - i) / GW; c++; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue; const nk = nj * GW + ni; if (!seen[nk] && w.cls[nk] === cls && w.owner[nk] === q) { seen[nk] = 1; st.push(nk); } } } if (c >= min) n++; } return n; };
    eq(clusters(CI.R, 6), 2, T + 'Burg ' + q + ': 2 Felsgruppen');
    ok(clusters(CI.T, 15) >= 2 && clusters(CI.T, 15) <= 5, T + 'Burg ' + q + ': 2–4 Waldstücke (' + clusters(CI.T, 15) + ')');
    // flow at the river's centre line runs downstream
  });
  {
    const fl = w.rivers[0].pts, mid = fl.filter(p => Math.abs(p.x) < 80 && p.x % 6 === 0);
    ok(mid.length > 10, T + 'Flussstützpunkte');
    let good = 0;
    for (const p of mid) { const o = ((Math.floor(p.y + 57)) * FX + Math.floor(p.x + 84)) * 2, vx = w.flow[o], vy = w.flow[o + 1]; if (vx > 0.45 && Math.hypot(vx, vy) <= 1.0001) good++; }
    ok(good >= mid.length - 1, T + 'flow auf dem Fluss: stromabwärts, Tempo ≈ 1 (' + good + '/' + mid.length + ')');
    const f = (p) => { const o = ((Math.floor(p.y + 57)) * FX + Math.floor(p.x + 84)) * 2; return [w.flow[o], w.flow[o + 1]]; };
    const streamOk = (pts, sgn) => pts.every((p, i) => {
      if (i === 0 || i === pts.length - 1 || Math.abs(p.y) > 44 || Math.abs(p.y) < 12) return true;
      const t = [pts[i + 1].x - pts[i - 1].x, pts[i + 1].y - pts[i - 1].y], tl = Math.hypot(...t), v = f(p), vl = Math.hypot(...v);
      return vl >= 0.3 && vl <= 0.61 && (v[0] * t[0] + v[1] * t[1]) / (vl * tl) > 0.7 && Math.sign(v[1]) === sgn;
    });
    ok(streamOk(w.rivers[1].pts, 1), T + 'Nordbach: flow stromabwärts (nach Süden), Tempo 0.3–0.6'); ok(streamOk(w.rivers[2].pts, -1), T + 'Südbach: flow stromabwärts (nach Norden)');
    let dry = 0, wet = 0, fp = 0; for (let k = 0; k < N; k++) { const i = k % GW, j = (k - i) / GW, o = ((j + 12) * FX + i + 12) * 2, sp = Math.hypot(w.flow[o], w.flow[o + 1]); if (w.cls[k] === CI.G && w.hq[k] > 14 && sp > 0) dry++; if (w.cls[k] === CI.W && sp > 0.3) wet++; if (w.cls[k] === CI.A && sp > 0.05 && sp < 0.4) fp++; }
    eq(dry, 0, T + 'kein flow auf hoher Wiese'); ok(wet > 800, T + 'flow im tiefen Wasser'); ok(fp > 300, T + 'schwacher flow in der Aue');
  }
  // instances
  ok(w.trees.length > 1200 && w.trees.length < 4000, T + 'Baumzahl plausibel (' + w.trees.length + ')');
  ok(w.trees.every(t => ['laub', 'nadel', 'weide'].includes(t.kind) && t.s > 0.5 && t.s < 2 && t.k === W.cellOf(t.x, t.y)), T + 'Bäume gültig');
  ok(w.trees.every(t => Math.abs(t.x) <= 84 && Math.abs(t.y) <= 57), T + 'Bäume im Rahmen');
  ok(w.trees.filter(t => t.kind === 'weide').length >= 50, T + 'Weiden an den Ufern');
  ok(w.trees.filter(t => t.k >= 0).every(t => ![CI.W, CI.F, CI.B].includes(w.cls[t.k])), T + 'keine Bäume im Wasser oder auf Brücken');
  const segDist = (t, c) => { const nx = Math.cos(c.rot), ny = Math.sin(c.rot), u = Math.max(-c.len / 2, Math.min(c.len / 2, (t.x - c.x) * nx + (t.y - c.y) * ny)); return Math.hypot(t.x - c.x - nx * u, t.y - c.y - ny * u); };
  const tall = w.trees.filter(t => cs.some(c => c.kind === 'furt' ? dist(t, c) < 7 : segDist(t, c) < 2.6 || Math.min(dist(t, { x: c.x - Math.cos(c.rot) * c.len / 2, y: c.y - Math.sin(c.rot) * c.len / 2 }), dist(t, { x: c.x + Math.cos(c.rot) * c.len / 2, y: c.y + Math.sin(c.rot) * c.len / 2 })) < 4));
  eq(tall.length, 0, T + 'keine Bäume direkt an Furten/Brückenenden');
  ok(w.rocks.length >= 40 && w.rocks.every(r => r.k === W.cellOf(r.x, r.y) && (r.k < 0 || w.cls[r.k] === CI.R)), T + 'Felsen auf Felszellen');
  ok(w.deco.length > 300 && w.deco.every(d => ['schilf', 'blume', 'stein', 'busch'].includes(d.kind)), T + 'Dekor');
  ok(w.roads.length >= 8 && w.roads.every(r => r.length >= 3 && r.every(p => Math.abs(p.x) <= 72 && Math.abs(p.y) <= 45)), T + 'Straßen');
  ok(w.roads.every(r => { const k0 = W.cellOf(r[0].x, r[0].y); return k0 >= 0 && w.owner[k0] >= 0; }), T + 'Straßen beginnen auf Burgland');
}

// ---- fairness, flood rule, crossings (30 seeds) ----
const stat = (w, s) => {
  const o = { area: 0, build: 0, aue: 0, forest: 0, rock: 0 }, kp = w.sites[s];
  for (let k = 0; k < N; k++) {
    if (w.owner[k] !== s) continue;
    o.area++;
    if (w.cls[k] === CI.G || w.cls[k] === CI.A) o.build++;
    if (w.cls[k] === CI.A) o.aue++;
    const d = dist(kxy(k), kp);
    if (w.cls[k] === CI.T && d <= 30) o.forest++;
    if (w.cls[k] === CI.R && d <= 34) o.rock++;
  }
  return o;
};
const table = [];
for (const seed of SEEDS) {
  const w = world(seed), T = 'seed ' + seed + ': ', st = [0, 1, 2, 3].map(s => stat(w, s));
  st.forEach((o, s) => eq(JSON.stringify(o), JSON.stringify(w.stats.sites[s]), T + 'stats.sites[' + s + '] stimmt mit den Zellen überein'));
  const col = (f) => st.map(f);
  ok(dev(col(o => o.area)) <= 0.08, T + 'Fläche ±8 % (' + (dev(col(o => o.area)) * 100).toFixed(1) + ')');
  ok(dev(col(o => o.build)) <= 0.10, T + 'Bauland ±10 %');
  ok(Math.min(...col(o => o.forest)) >= 120 && dev(col(o => o.forest)) <= 0.20, T + 'Wald ≥ 120, ±20 %');
  ok(Math.min(...col(o => o.rock)) >= 30 && dev(col(o => o.rock)) <= 0.25, T + 'Fels ≥ 30, ±25 %');
  ok(Math.min(...col(o => o.aue)) >= 60 && dev(col(o => o.aue)) <= 0.25, T + 'Aue ≥ 60, ±25 %');
  // quarters: four of them, none touching (8-neighbourhood)
  let touch = 0;
  for (let k = 0; k < N; k++) {
    const o = w.owner[k]; if (o < 0) continue;
    const i = k % GW, j = (k - i) / GW;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
      const o2 = w.owner[nj * GW + ni];
      if (o2 >= 0 && o2 !== o) touch++;
    }
  }
  eq(touch, 0, T + 'Viertel berühren sich nicht'); ok(st.every(o => o.area > 2000), T + 'jedes Viertel hat Fläche');
  // pairs
  eq(w.stats.pairs.length, 6, T + '6 Paare');
  for (const type of ['bach', 'fluss', 'diagonal']) {
    const ls = w.stats.pairs.filter(p => p.type === type).map(p => p.len);
    eq(ls.length, 2, T + type + ' hat 2 Paare');
    ok((Math.max(...ls) - Math.min(...ls)) / mean(ls) <= 0.12, T + 'Wege ' + type + ' innerhalb 12 % (' + ls.join('/') + ')');
  }
  w.stats.pairs.forEach(p => {
    const r = W.path(w, { x: w.sites[p.a].x + 0.5, y: w.sites[p.a].y + 0.5 }, { x: w.sites[p.b].x + 0.5, y: w.sites[p.b].y + 0.5 }, 0);
    near(r.len, p.len, 0.06, T + 'Paarlänge ' + p.a + '-' + p.b + ' stimmt mit path() überein');
  });
  // flood: L = 1 cuts every keep off, L = 0 connects all
  const kc = w.sites.map(s => W.cellOf(s.x + 0.5, s.y + 0.5)), l1 = W.components(w, 1), l0 = W.components(w, 0);
  eq(new Set(kc.map(k => l1[k])).size, 4, T + 'bei L = 1 erreicht keine Burg eine andere');
  eq(new Set(kc.map(k => l0[k])).size, 1, T + 'bei L = 0 sind alle Burgen verbunden');
  let l1pairs = 0;
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) if (W.field(w, [kc[a]], 1)[kc[b]] < Infinity) l1pairs++;
  eq(l1pairs, 0, T + 'field bei L = 1 unendlich zwischen Burgen');
  // crossing order and values
  const by = (id) => w.crossings.find(c => c.id === id), o = (id) => by(id).open;
  const stegs = [o('nordsteg'), o('suedsteg')], furts = ['westfurt', 'ostfurt', 'nordfurt', 'suedfurt'].map(o);
  ok(o('steinbruecke') > Math.max(...stegs) && Math.min(...stegs) > Math.max(...furts), T + 'Reihenfolge Brücke > Stege > Furten');
  near(o('steinbruecke'), 0.83, 0.06, T + 'Steinbrücke ≈ 0.83'); stegs.forEach(v => near(v, 0.75, 0.06, T + 'Steg ≈ 0.75'));
  furts.forEach(v => ok(v >= 0.04 && v <= 0.15, T + 'Furt open 0.04–0.15 (' + v + ')'));
  ok(Math.abs(o('westfurt') - o('ostfurt')) <= 0.06, T + 'Flussfurten ±0.06');
  table.push({ seed, st, w, kinds: w.stats.pairs });
}

// ---- `open` against a brute-force binary search over the whole map ----
{
  const bruteOpen = (w, c) => {
    const blocked = new Uint8Array(N);
    for (const x of w.crossings) if (x !== c) for (const k of x.cells) blocked[k] = 1;
    const a = W.cellOf(c.ends[0].x, c.ends[0].y), b = W.cellOf(c.ends[1].x, c.ends[1].y);
    const conn = (L) => {
      const seen = new Uint8Array(N), st = [a]; seen[a] = 1;
      const okc = (k) => !blocked[k] && W.walk(w, k, L) > 0;
      if (!okc(a)) return false;
      while (st.length) {
        const k = st.pop(), i = k % GW, j = (k - i) / GW;
        if (k === b) return true;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const nk = nj * GW + ni;
          if (seen[nk] || !okc(nk)) continue;
          if (di && dj && (!okc(j * GW + ni) || !okc(nj * GW + i))) continue;
          seen[nk] = 1; st.push(nk);
        }
      }
      return false;
    };
    if (!conn(0)) return -1;
    let lo = 0, hi = 1;
    for (let it = 0; it < 16; it++) { const m = (lo + hi) / 2; if (conn(m)) lo = m; else hi = m; }
    return lo;
  };
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const c of world(seed).crossings) near(bruteOpen(world(seed), c), c.open, 0.002, 'seed ' + seed + ' ' + c.id + ': open stimmt mit Binärsuche überein');
}

// ---- field and path ----
{
  const rnd = W.mulberry32(77);
  const w = world(2);
  // a few random reachable pairs per level
  for (const L of [0, 0.1, 0.5, 0.9]) {
    const comp = W.components(w, L), walkable = cellsOf(w, k => comp[k] >= 0);
    let done = 0, tries = 0;
    while (done < 10 && tries++ < 400) {
      const a = walkable[Math.floor(rnd() * walkable.length)], b = walkable[Math.floor(rnd() * walkable.length)];
      if (comp[a] !== comp[b] || dist(kxy(a), kxy(b)) < 8) continue;
      const p = W.path(w, kxy(a), kxy(b), L), T = 'L ' + L + ' ' + a + '→' + b + ': ';
      ok(p && p.length >= 2, T + 'Weg gefunden');
      if (!p) continue;
      done++;
      let blocked = 0;
      for (let n = 1; n < p.length; n++) {
        const A = p[n - 1], B = p[n], len = dist(A, B);
        for (let t = 0; t <= len; t += 0.04) {
          const x = A.x + (B.x - A.x) * t / (len || 1), y = A.y + (B.y - A.y) * t / (len || 1), fx = (x + 72) % 1, fy = (y + 45) % 1;
          if (Math.min(fx, 1 - fx, fy, 1 - fy) < 1e-3) continue;   // exactly on a cell border
          if (!(W.walk(w, W.cellOf(x, y), L) > 0)) blocked++;
        }
      }
      eq(blocked, 0, T + 'Weg betritt nie eine gesperrte Zelle');
      const d = W.field(w, [b], L)[a];
      near(p.cost, d, 1e-3 + 2e-5 * d, T + 'path().cost = field()-Abstand');
      ok(p.time <= p.cost + 1e-3, T + 'geglätteter Weg nicht langsamer als das Gitter (' + p.time.toFixed(2) + ' ≤ ' + p.cost.toFixed(2) + ')');
      ok(p.len >= dist(kxy(a), kxy(b)) - 1e-9, T + 'Länge ≥ Luftlinie');
      near(W.pathTime(w, p, L), p.time, 1e-6, T + 'pathTime stimmt');
    }
    ok(done >= 6, 'L ' + L + ': genug Wegepaare getestet (' + done + ')');
  }
  // field: several targets, reuse of `out`, unreachable cells
  const kcs = w.sites.map(s => W.cellOf(s.x + 0.5, s.y + 0.5)), f0 = W.field(w, [kcs[0]], 0), f3 = W.field(w, [kcs[3]], 0), buf = new Float32Array(N);
  const f03 = W.field(w, [kcs[0], kcs[3]], 0, buf);
  ok(f03 === buf, 'field benutzt das übergebene out-Array');
  let mism = 0; for (let k = 0; k < N; k += 7) if (Math.abs(f03[k] - Math.min(f0[k], f3[k])) > 1e-3) mism++;
  eq(mism, 0, 'field mit 2 Zielen = Minimum der Einzelfelder');
  eq(f0[kcs[0]], 0, 'field am Ziel = 0');
  const deep = cellsOf(w, k => w.cls[k] === CI.W)[0];
  eq(f0[deep], Infinity, 'tiefes Wasser unerreichbar');
  eq(W.path(w, kxy(kcs[0]), kxy(deep), 0), null, 'path zu tiefem Wasser = null'); eq(W.path(w, { x: 100, y: 0 }, kxy(kcs[0]), 0), null, 'path von außerhalb = null');
  eq(W.path(w, kxy(kcs[0]), kxy(kcs[3]), 1), null, 'bei L = 1 gibt es keinen Weg von Burg zu Burg');
  const same = W.path(w, { x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 }, 0); ok(same === null || same.length >= 1, 'path Start = Ziel');
  // a ford is slower than dry land: Westfurt vs. meadow of the same length
  const wf = w.crossings[0], pf = W.path(w, wf.ends[0], wf.ends[1], 0), need = Math.ceil(pf.len) + 2;
  let dryA = null;   // a row of meadow cells long enough for a dry reference route of the same length
  for (let j = 5; j < 40 && !dryA; j++) for (let i = 2; i < 60 && !dryA; i++) {
    let run = 0; while (run < need && w.cls[j * GW + i + run] === CI.G && w.owner[j * GW + i + run] === 0) run++;
    if (run >= need) dryA = { x: -71.5 + i, y: -44.5 + j };
  }
  ok(dryA, 'Referenzstrecke über Wiese gefunden');
  const dryB = { x: dryA.x + pf.len, y: dryA.y }, pd = W.path(w, dryA, dryB, 0);
  ok(pd && Math.abs(pd.len - pf.len) < 0.01 && pd.time / pd.len < 1.12, 'Referenzweg über Land ist schnell (' + (pd.time / pd.len).toFixed(2) + ')');
  ok(pf.time > pd.time + 4 && pf.time / pf.len > pd.time / pd.len * 1.1, 'Furt-Weg ist langsamer als gleich lange Landstrecke (' + pf.time.toFixed(1) + ' vs ' + pd.time.toFixed(1) + ' bei ' + pf.len.toFixed(1) + ')');
  const st = w.crossings[3], ps = W.path(w, st.ends[0], st.ends[1], 0);
  ok(ps.time / ps.len < pf.time / pf.len, 'über einen Steg läuft es sich schneller als durch die Furt');
  // walk()/dry() on the flood rule
  const aue = cellsOf(w, k => w.cls[k] === CI.A && w.hq[k] === 3)[0], fw = cellsOf(w, k => w.cls[k] === CI.F && w.hq[k] === -2)[0];
  eq(W.walk(w, deep, 0), 0, 'walk Tiefwasser'); near(W.walk(w, fw, 0), 0.45, 1e-9, 'walk Flach = Waten'); eq(W.walk(w, aue, 0), 1, 'walk Aue trocken');
  eq(W.dry(w, aue, 0), true, 'Aue trocken bei L=0'); eq(W.dry(w, aue, 0.2), true, 'hq 3 noch trocken bei L=0.2'); eq(W.dry(w, aue, 0.25), false, 'hq 3 bei L=0.25 nicht mehr trocken (aber ohne Waten)');
  eq(W.walk(w, aue, 0.25), 1, 'depth 0 = kein Waten');
  near(W.walk(w, aue, 0.3), 0.45, 1e-9, 'Aue watet bei L=0.3'); eq(W.walk(w, aue, 0.5), 0.45, 'Aue watet noch bei L=0.5'); eq(W.walk(w, aue, 0.7), 0, 'Aue bei L=0.7 zu tief (0.84 − 0.3 > 0.45)');
  eq(W.dry(w, fw, 0), false, 'Flach nie trocken bei L=0');
  const reed = cellsOf(w, k => w.cls[k] === CI.M)[0], forest = cellsOf(w, k => w.cls[k] === CI.T)[0], rock = cellsOf(w, k => w.cls[k] === CI.R)[0];
  near(W.walk(w, reed, 0), 0.6, 1e-9, 'Ried 0.6'); near(W.walk(w, forest, 0), 0.7, 1e-9, 'Wald 0.7'); eq(W.walk(w, rock, 0), 0, 'Fels gesperrt');
  const deck = w.crossings[2].cells.find(k => w.hq[k] === 6);
  eq(W.walk(w, deck, 0.8), 0.45, 'Brücke watet bei L=0.8'); eq(W.walk(w, deck, 0.9), 0, 'Brücke bei L=0.9 zu'); eq(W.walk(w, deck, 0), 1, 'Brücke trocken');
}

// ---- field/path/pathTime with a `block` mask (building footprints for the sim; additive, no mask = unchanged) ----
{
  const w = world(2), kcs = w.sites.map(s => W.cellOf(s.x + 0.5, s.y + 0.5)), a = kxy(kcs[0]);
  const none = new Uint8Array(N);
  const f0 = W.field(w, [kcs[3]], 0), fNone = W.field(w, [kcs[3]], 0, undefined, none);
  let diff = 0; for (let k = 0; k < N; k++) if (f0[k] !== fNone[k]) diff++;
  eq(diff, 0, 'field mit leerer block-Maske = ohne Maske');
  const p0 = W.path(w, a, kxy(kcs[2]), 0), pNone = W.path(w, a, kxy(kcs[2]), 0, { block: none });
  eq(JSON.stringify(p0), JSON.stringify(pNone), 'path mit leerer block-Maske = ohne Maske');
  // a wall of blocked cells across the plain route forces a detour (or none) and is never entered
  const wall = new Uint8Array(N), start = kxy(kcs[0]), goal = { x: start.x + 14, y: start.y };
  const direct = W.path(w, start, goal, 0);
  ok(direct, 'block: Ausgangsweg vorhanden');
  for (let j = 0; j < GH; j++) for (const i of [Math.floor(start.x + 72 + 7), Math.floor(start.x + 72 + 8)]) wall[j * GW + i] = 1;   // a full-height wall: no way around within the map
  eq(W.path(w, start, goal, 0, { block: wall }), null, 'block: eine Mauer über die ganze Höhe sperrt den Weg');
  const ff = W.field(w, [W.cellOf(goal.x, goal.y)], 0, undefined, wall);
  eq(ff[kcs[0]], Infinity, 'block: field hinter der Mauer unerreichbar');
  let inWall = 0; for (let k = 0; k < N; k++) if (wall[k] && ff[k] !== Infinity) inWall++;
  eq(inWall, 0, 'block: gesperrte Zellen bekommen nie einen Feldwert');
  // a short block that can be walked around: the path avoids it and is not shorter than the open one
  const lump = new Uint8Array(N), mid = W.cellOf((start.x + goal.x) / 2, start.y);
  for (let dj = -2; dj <= 2; dj++) lump[mid + dj * GW] = 1;
  const around = W.path(w, start, goal, 0, { block: lump });
  ok(around && around.len >= direct.len - 1e-9, 'block: Umweg um ein Hindernis ist nicht kürzer als der freie Weg');
  let hits = 0;
  if (around) for (let n = 1; n < around.length; n++) {
    const A = around[n - 1], B = around[n], len = dist(A, B);
    for (let t = 0; t <= len; t += 0.05) { const x = A.x + (B.x - A.x) * t / (len || 1), y = A.y + (B.y - A.y) * t / (len || 1); if (lump[W.cellOf(x, y)]) hits++; }
  }
  eq(hits, 0, 'block: der Umweg betritt das Hindernis nie');
  // a blocked target still seeds the field into its free neighbours (units walk up to a building)
  const bt = new Uint8Array(N), tk = W.cellOf(goal.x, goal.y); bt[tk] = 1;
  const fb = W.field(w, [tk], 0, undefined, bt);
  ok(fb[tk] === 0 && fb[tk + 1] < Infinity && fb[tk - GW] < Infinity, 'block: ein gesperrtes Ziel speist seine freien Nachbarn');
  ok(W.pathTime(w, p0, 0, none) === W.pathTime(w, p0, 0), 'pathTime mit leerer Maske unverändert');
  eq(W.pathTime(w, [a, goal], 0, wall), Infinity, 'pathTime durch die Mauer = Infinity');
}

// ---- field with `extra` costs (a weighted field: what a breach of an enemy wall costs) ----
{
  const w = world(2), kcs = w.sites.map(s => W.cellOf(s.x + 0.5, s.y + 0.5)), start = kxy(kcs[0]), goal = { x: start.x + 14, y: start.y }, gk = W.cellOf(goal.x, goal.y), sk = W.cellOf(start.x, start.y);
  const open = W.field(w, [gk], 0), zero = new Float32Array(N);
  eq(W.field(w, [gk], 0, undefined, undefined, zero)[sk], open[sk], 'extra = 0 überall: das Feld bleibt gleich');
  let diff = 0; const fz = W.field(w, [gk], 0, undefined, undefined, zero); for (let k = 0; k < N; k++) if (fz[k] !== open[k]) diff++;
  eq(diff, 0, 'extra = 0: Zelle für Zelle dasselbe Feld');
  // a full-height wall two cells thick with one gap row that costs 25 per cell: the way through the gap is the open way + 2 × 25
  const wall = new Uint8Array(N), ex = new Float32Array(N), wi = Math.floor(start.x + 72 + 7), row = Math.floor(start.y + 45);
  for (let j = 0; j < GH; j++) for (const i of [wi, wi + 1]) wall[j * GW + i] = 1;
  const none = W.field(w, [gk], 0, undefined, wall);
  eq(none[sk], Infinity, 'ohne Lücke gibt es keinen Weg');
  for (const i of [wi, wi + 1]) { wall[row * GW + i] = 0; ex[row * GW + i] = 25; }
  const gapped = W.field(w, [gk], 0, undefined, wall, ex);
  near(gapped[sk], open[sk] + 50, 1e-3, 'Lücke mit extra 25 je Zelle: offener Weg + 50 (' + gapped[sk].toFixed(2) + ' gegen ' + open[sk].toFixed(2) + ')');
  eq(gapped[W.cellOf(start.x, start.y + 3)] < Infinity, true, 'auch Zellen neben der Linie erreichen das Ziel durch die Lücke');
  let neg = 0; for (let k = 0; k < N; k++) if (gapped[k] < open[k] - 1e-3 && gapped[k] !== Infinity) neg++;
  eq(neg, 0, 'extra macht nie schneller als das freie Feld');
  // a short strip with extra 100 across the straight way, walkable around: the field goes around instead of paying
  const ex2 = new Float32Array(N), mid = W.cellOf((start.x + goal.x) / 2, start.y);
  for (let dj = -2; dj <= 2; dj++) ex2[mid + dj * GW] = 100;
  const around = W.field(w, [gk], 0, undefined, undefined, ex2);
  ok(around[sk] > open[sk] - 1e-6 && around[sk] < open[sk] + 15, 'ein Hindernis mit extra 100 wird umgangen, nicht bezahlt (' + around[sk].toFixed(2) + ' gegen ' + open[sk].toFixed(2) + ')');
  // the cheapest breach wins: two gaps, the nearer one expensive, the farther one cheap
  const ex3 = new Float32Array(N), wall3 = new Uint8Array(N);
  for (let j = 0; j < GH; j++) for (const i of [wi, wi + 1]) wall3[j * GW + i] = 1;
  const far = Math.min(GH - 2, row + 9);
  for (const i of [wi, wi + 1]) { wall3[row * GW + i] = 0; ex3[row * GW + i] = 80; wall3[far * GW + i] = 0; ex3[far * GW + i] = 5; }
  const f3 = W.field(w, [gk], 0, undefined, wall3, ex3);
  ok(f3[sk] < open[sk] + 80 && f3[sk] > open[sk] + 10 - 1e-6, 'bei zwei Lücken wird die billigere gewählt (' + f3[sk].toFixed(1) + ')');
  // timing: a weighted field costs about the same as a plain one
  const buf = new Float32Array(N); let t = process.hrtime.bigint(); for (let n = 0; n < 40; n++) W.field(w, [gk], 0, buf, wall3, ex3); const ms = Number(process.hrtime.bigint() - t) / 1e6 / 40;
  ok(ms < 5, 'field mit extra Ø < 5 ms (' + ms.toFixed(2) + ')');
}

// ---- canPlace: every reason from a constructed case ----
{
  const w = world(2), lord = 0, kp = w.sites[0], own = (k) => w.owner[k] === lord;
  const cp = (kind, i, j, rot, o) => W.canPlace(w, kind, i, j, rot || 0, Object.assign({ lord, L: 0 }, o || {}));
  const rect = (k, wd, ht) => { const i = k % GW, j = (k - i) / GW, out = []; for (let dj = 0; dj < ht; dj++) for (let di = 0; di < wd; di++) out.push((j + dj) * GW + i + di); return out; };
  const spot = W.suggest(w, 'huette', lord);
  ok(spot, 'huette: Vorschlag vorhanden');
  eq(cp('huette', spot.i, spot.j, spot.rot).ok, true, 'ok-Fall: freier Platz');
  // bounds
  for (const [i, j] of [[-1, 10], [GW - 1, 10], [10, -1], [10, GH - 1]]) eq(cp('huette', i, j).reason, 'bounds', 'bounds bei ' + i + ',' + j);
  eq(cp('kaserne', GW - 3, 30, 0).reason, 'bounds', 'bounds: Kaserne rot 0 (4 breit) ragt raus'); ok(cp('kaserne', GW - 3, 30, 1).reason !== 'bounds', 'bounds: Kaserne rot 1 (3 breit) passt');
  eq(cp('huette', 1.5, 3).reason, 'bounds', 'bounds: gebrochene Zelle');
  // owner: another lord's land, and water
  const foreign = cellsOf(w, k => w.owner[k] === 1 && w.owner[k + 1] === 1 && w.owner[k + GW] === 1 && w.owner[k + GW + 1] === 1)[0];
  eq(cp('huette', foreign % GW, Math.floor(foreign / GW)).reason, 'owner', 'owner: fremdes Viertel');
  const wat = cellsOf(w, k => w.cls[k] === CI.W)[0];
  eq(cp('huette', wat % GW, Math.floor(wat / GW)).reason, 'owner', 'owner: Wasser gehört niemandem');
  // terrain: own cells that are not G/A (forest, sand, reed, rock)
  for (const c of [CI.T, CI.S, CI.M, CI.R]) {
    const k = cellsOf(w, k => rect(k, 2, 2).every(own) && rect(k, 2, 2).some(q => w.cls[q] === c) && rect(k, 2, 2).every(q => [CI.G, CI.A, c].includes(w.cls[q])))[0];
    ok(k !== undefined, 'Testzelle für ' + CLASSES[c].key + ' vorhanden');
    if (k !== undefined) eq(cp('huette', k % GW, Math.floor(k / GW)).reason, 'terrain', 'terrain: ' + CLASSES[c].name);
  }
  // wet: the footprint is G/A but not dry at this level
  const wetK = cellsOf(w, k => rect(k, 2, 2).every(q => own(q) && w.cls[q] === CI.A && w.hq[q] >= 2 && w.hq[q] <= 4))[0];
  ok(wetK !== undefined, 'Testzelle nasse Aue vorhanden');
  if (wetK !== undefined) {
    const i = wetK % GW, j = Math.floor(wetK / GW);
    eq(cp('huette', i, j).ok, true, 'Aue bei L=0 trocken und bebaubar'); eq(cp('huette', i, j, 0, { L: 0.4 }).reason, 'wet', 'wet: bei L=0.4 unter Wasser');
  }
  // occupied: occ, the keep itself
  const occ = new Uint8Array(N); occ[spot.j * GW + spot.i + 1] = 1;
  eq(cp('huette', spot.i, spot.j, spot.rot, { occ }).reason, 'occupied', 'occupied: occ belegt');
  eq(cp('huette', kp.keep.i + 2, kp.keep.j + 2).reason, 'occupied', 'occupied: Bergfried zählt immer'); eq(cp('bergfried', spot.i, spot.j).ok, false, 'Bergfried ist nicht platzierbar');
  // tight: a neighbouring building touches the one-cell ring; one free cell between is fine
  const tw = cellsOf(w, k => { const i = k % GW, j = (k - i) / GW; return i + 6 < GW && own(k) && rect(k, 7, 4).every(q => own(q) && (w.cls[q] === CI.G || w.cls[q] === CI.A) && w.hq[q] >= 12); })[0];
  const ti = tw % GW, tj = Math.floor(tw / GW), occT = new Uint8Array(N);
  occT[tj * GW + ti + 2] = 1;
  eq(cp('huette', ti, tj, 0, { occ: occT }).reason, 'tight', 'tight: Nachbarzelle direkt angrenzend');
  occT.fill(0); occT[tj * GW + ti + 3] = 1;
  eq(cp('huette', ti, tj, 0, { occ: occT }).ok, true, 'ok: eine freie Zelle dazwischen');
  occT.fill(0); occT[(tj + 2) * GW + ti + 2] = 1;
  eq(cp('huette', ti, tj, 0, { occ: occT }).reason, 'tight', 'tight: auch diagonal');
  const kk = kp.keep; const left = cp('huette', kk.i - 2, kk.j + 1), gap = cp('huette', kk.i - 3, kk.j + 1);
  ok(left.reason === 'tight' || left.reason === 'terrain' || left.reason === 'owner', 'Bergfried hat 1 Zelle Abstand (' + left.reason + ')');
  // forest / rock requirements
  const fOk = W.suggest(w, 'holzfaeller', lord), rOk = W.suggest(w, 'steinbruch', lord);
  ok(fOk && cp('holzfaeller', fOk.i, fOk.j, fOk.rot).ok, 'Holzfäller: Vorschlag gültig'); ok(rOk && cp('steinbruch', rOk.i, rOk.j, rOk.rot).ok, 'Steinbruch: Vorschlag gültig');
  const scan = (kind, reason) => { for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (cp(kind, i, j).reason === reason) return [i, j]; return null; };
  ok(scan('holzfaeller', 'forest'), 'forest: Holzfäller ohne genug Wald im Umkreis 8 (Fall gefunden)'); ok(scan('steinbruch', 'rock'), 'rock: Steinbruch ohne 2 Felsfelder an der Kante (Fall gefunden)');
  const hs = cp('hof', spot.i, spot.j, 0); ok(hs.reason !== 'forest' && hs.reason !== 'rock', 'andere Gebäude brauchen weder Wald noch Fels');
  // order of reasons: bounds before owner before terrain …
  eq(cp('huette', GW - 1, 10, 0, { lord: 1 }).reason, 'bounds', 'bounds vor owner'); eq(cp('huette', wat % GW, Math.floor(wat / GW), 0, { occ: new Uint8Array(N).fill(1) }).reason, 'owner', 'owner vor occupied');
  ok(W.canPlace(w, 'huette', spot.i, spot.j, 0).ok === false, 'ohne lord gibt es keine Platzierung');
  // rotation swaps the footprint
  const hofSpot = W.suggest(w, 'hof', lord);
  eq(cp('hof', hofSpot.i, hofSpot.j, hofSpot.rot).ok, true, 'Hof-Vorschlag gültig (rot ' + hofSpot.rot + ')');
}

// ---- Phase 2 placement: walls (1 × len), Torhaus, Markt, Söldnerlager ----
{
  const w = world(2), lord = 0, CODE = W.CODE;
  const cp = (kind, i, j, rot, o) => W.canPlace(w, kind, i, j, rot || 0, Object.assign({ lord, L: 0 }, o || {}));
  const fp = (kind, rot, len) => W.footprintOf(kind, rot, len).join('x');
  // footprints: walls are 1 × len (rot 0 along +i, rot 1 along +j), Torhaus 3 × 2 or 2 × 3
  eq([fp('mauer', 0, 4), fp('mauer', 1, 4), fp('palisade', 0, 2), fp('palisade', 1, 3), fp('mauer', 0, 1)].join(' '), '4x1 1x4 2x1 1x3 1x1', 'footprintOf: Mauern 1 × len');
  eq([fp('mauer', 0, 9), fp('mauer', 0, 0), fp('mauer', 0), fp('mauer', 1, -3), fp('mauer', 1, NaN)].join(' '), '4x1 1x1 1x1 1x1 1x1', 'footprintOf: zu lang → 4, schlechte Länge → 1');
  eq([fp('torhaus', 0), fp('torhaus', 1), fp('markt', 0), fp('markt', 1), fp('soeldnerlager', 0), fp('soeldnerlager', 1), fp('huette', 1, 4), fp('kaserne', 1)].join(' '), '3x2 2x3 4x3 3x4 5x4 4x5 2x2 3x4', 'footprintOf: Torhaus, Markt, Söldnerlager (len wirkt nur bei Mauern)');
  // a free 18 × 12 block of own dry meadow
  const area = cellsOf(w, k => { const i = k % GW, j = (k - i) / GW; if (i + 18 > GW || j + 12 > GH) return false; for (let dj = 0; dj < 12; dj++) for (let di = 0; di < 18; di++) { const q = (j + dj) * GW + i + di; if (w.owner[q] !== lord || (w.cls[q] !== CI.G && w.cls[q] !== CI.A) || w.hq[q] < 12) return false; } return true; })[0];
  ok(area !== undefined, 'freier Block gefunden');
  const bi = area % GW, bj = (area - bi) / GW, occ = new Uint8Array(N);
  const put = (kind, i, j, rot, len) => { const [wd, ht] = W.footprintOf(kind, rot, len); for (let dj = 0; dj < ht; dj++) for (let di = 0; di < wd; di++) occ[(bj + j + dj) * GW + bi + i + di] = CODE[kind]; };
  const at = (kind, i, j, rot, len) => cp(kind, bi + i, bj + j, rot, { occ, len });
  // walls: len 1–4, anything else is `bounds`; the free case is ok for every wall kind
  for (const k of ['palisade', 'mauer']) {
    for (let len = 1; len <= 4; len++) { eq(at(k, 2, 2, 0, len).ok, true, k + ' len ' + len + ' rot 0 ok'); eq(at(k, 2, 2, 1, len).ok, true, k + ' len ' + len + ' rot 1 ok'); }
    eq(at(k, 2, 2, 0).ok, true, k + ': ohne len = 1');
    for (const bad of [0, 5, 1.5, -1, NaN, '2', Infinity]) eq(at(k, 2, 2, 0, bad).reason, 'bounds', k + ' len ' + String(bad) + ' → bounds');
  }
  eq(cp('mauer', GW - 3, bj, 0, { len: 4 }).reason, 'bounds', 'Mauer ragt rechts raus: bounds'); eq(cp('mauer', bi, GH - 3, 1, { len: 4 }).reason, 'bounds', 'Mauer ragt unten raus: bounds'); ok(cp('mauer', GW - 4, bj + 3, 0, { len: 4 }).reason !== 'bounds', 'Mauer passt gerade noch (len wird mitgerechnet)');
  eq(cp('huette', bi + 2, bj + 2, 0, { len: 4 }).ok, true, 'len wirkt nur bei Mauern (Hütte ignoriert es)');
  // owner / terrain: another lord's land is `owner`, a ford, bridge or Steg belongs to nobody, and a wall on forest or reed is `terrain`
  const foreign = cellsOf(w, k => w.owner[k] === 1 && w.owner[k + 1] === 1)[0]; eq(cp('mauer', foreign % GW, Math.floor(foreign / GW), 0, { len: 2 }).reason, 'owner', 'Mauer im fremden Viertel: owner');
  for (const cr of w.crossings.slice(0, 7)) { const k = cr.cells[Math.floor(cr.cells.length / 2)]; eq(cp('mauer', k % GW, Math.floor(k / GW), 0, { len: 1 }).ok, false, 'auf der Querung ' + cr.id + ' steht nichts'); eq(cp('palisade', k % GW, Math.floor(k / GW), 1, { len: 2 }).ok, false, 'auch keine Palisade auf ' + cr.id); }
  const forestK = cellsOf(w, k => w.owner[k] === lord && w.cls[k] === CI.T && w.owner[k + 1] === lord)[0]; eq(cp('mauer', forestK % GW, Math.floor(forestK / GW), 0, { len: 2 }).reason, 'terrain', 'Mauer im Wald: terrain');
  // wet: a wall needs dry ground like everything else
  const wetK = cellsOf(w, k => w.owner[k] === lord && w.cls[k] === CI.A && w.hq[k] >= 2 && w.hq[k] <= 4)[0];
  if (wetK !== undefined) { eq(cp('mauer', wetK % GW, Math.floor(wetK / GW), 0, { len: 1 }).ok, true, 'Aue trocken: Mauer ok'); eq(cp('mauer', wetK % GW, Math.floor(wetK / GW), 0, { len: 1, L: 0.5 }).reason, 'wet', 'Aue unter Wasser: wet'); }
  // walls may touch walls: end to end, alongside, diagonally; overlapping is `occupied`
  put('mauer', 4, 4, 0, 4);
  eq(at('mauer', 8, 4, 0, 3).ok, true, 'Mauer Ende an Ende: ok'); eq(at('mauer', 4, 5, 0, 4).ok, true, 'Mauer Seite an Seite: ok'); eq(at('palisade', 8, 5, 1, 2).ok, true, 'Palisade diagonal an der Mauer: ok'); eq(at('palisade', 3, 3, 1, 3).ok, true, 'Palisade am Ende der Mauer, im Winkel: ok');
  eq(at('mauer', 6, 3, 1, 3).reason, 'occupied', 'Mauer über der Mauer: occupied');
  // … but keep the usual gap to every other building: a hut one cell away is `tight`, with a free cell between it is ok
  put('huette', 12, 8, 0); eq(at('mauer', 11, 8, 1, 3).reason, 'tight', 'Mauer dicht an der Hütte: tight'); eq(at('mauer', 11, 10, 0, 2).reason, 'tight', 'Mauer diagonal an der Hütte: tight'); eq(at('mauer', 14, 8, 0, 1).reason, 'tight', 'Mauer auf der anderen Seite: tight'); eq(at('mauer', 9, 8, 1, 3).ok, true, 'eine freie Zelle zur Hütte: ok'); eq(at('palisade', 15, 8, 1, 2).ok, true, 'Palisade mit Abstand zur Hütte: ok');
  // a new house may not touch a wall (plain rule), a Wachturm or Torhaus may
  eq(at('huette', 4, 5, 0).reason, 'tight', 'Hütte an der Mauer: tight'); eq(at('kaserne', 4, 5, 0).reason, 'tight', 'Kaserne an der Mauer: tight'); eq(at('huette', 4, 6, 0).ok, true, 'Hütte mit einer freien Zelle zur Mauer: ok');
  eq(at('wachturm', 4, 5, 0).ok, true, 'Wachturm an der Mauer: ok'); eq(at('wachturm', 8, 3, 0).ok, true, 'Wachturm an der Mauerecke: ok');
  eq(at('wachturm', 10, 8, 0).reason, 'tight', 'Wachturm an der Hütte: tight (nur Mauern dürfen angrenzen)');
  put('wachturm', 2, 8, 0); eq(at('mauer', 4, 8, 0, 3).ok, true, 'Mauer an den Wachturm: ok'); eq(at('mauer', 2, 7, 0, 2).ok, true, 'Mauer an den Wachturm (oben): ok'); eq(at('wachturm', 4, 8, 0).reason, 'tight', 'Wachturm an den Wachturm: tight');
  // Torhaus: 3 × 2 with its lane in the middle column (rot 0) or middle row (rot 1); walls attach to the flanks, never to the lane mouths
  occ.fill(0);
  eq(at('torhaus', 6, 4, 0).ok, true, 'Torhaus rot 0 ok'); eq(at('torhaus', 6, 4, 1).ok, true, 'Torhaus rot 1 ok');
  eq(JSON.stringify(W.laneOf(6, 4, 0)), '{"cells":[[7,4],[7,5]],"ends":[[7,3],[7,6]]}', 'laneOf rot 0: Mittelspalte, Mündungen nördlich und südlich'); eq(JSON.stringify(W.laneOf(6, 4, 1)), '{"cells":[[6,5],[7,5]],"ends":[[5,5],[8,5]]}', 'laneOf rot 1: Mittelzeile, Mündungen westlich und östlich');
  put('torhaus', 6, 4, 0);
  eq(at('mauer', 2, 4, 0, 4).ok, true, 'Mauer an die Westflanke: ok'); eq(at('mauer', 9, 4, 0, 4).ok, true, 'Mauer an die Ostflanke: ok'); eq(at('palisade', 9, 4, 1, 2).ok, true, 'Palisade an die Ostflanke, senkrecht: ok'); eq(at('mauer', 5, 2, 1, 2).ok, true, 'Mauer im Winkel an der Nordwestecke, zwei Zellen von der Mündung: ok');
  eq(at('mauer', 4, 3, 0, 4).reason, 'tight', 'Mauer deckt die Nordmündung: tight'); eq(at('mauer', 8, 3, 0, 2).reason, 'tight', 'Mauer neben der Nordmündung: tight'); eq(at('mauer', 6, 3, 0, 1).reason, 'tight', 'Mauer am Torhaus, nördlich der Westspalte, neben der Mündung: tight'); eq(at('mauer', 7, 6, 0, 1).reason, 'tight', 'Mauer auf der Südmündung: tight'); eq(at('palisade', 6, 7, 0, 3).reason, 'tight', 'Palisade eine Zelle vor der Südmündung: tight'); ok(at('palisade', 6, 8, 0, 3).ok, 'zwei Zellen vor der Mündung: ok');
  occ.fill(0); put('torhaus', 6, 4, 1);   // rot 1: footprint 2 × 3, mouths west and east
  eq(at('mauer', 4, 5, 0, 1).reason, 'tight', 'rot 1: Mauer auf der Westmündung: tight'); eq(at('mauer', 9, 3, 1, 4).reason, 'tight', 'rot 1: Mauer vor der Ostmündung: tight'); eq(at('mauer', 6, 2, 0, 4).ok, true, 'rot 1: Mauer an die Nordflanke: ok'); eq(at('mauer', 6, 7, 0, 4).ok, true, 'rot 1: Mauer an die Südflanke: ok');
  // a Torhaus next to existing walls: the flank may touch, the lane mouths and their surroundings must stay free
  occ.fill(0); put('mauer', 2, 4, 0, 4);
  eq(at('torhaus', 6, 4, 0).ok, true, 'Torhaus an die Mauer gesetzt: ok'); put('palisade', 7, 2, 0, 1); eq(at('torhaus', 6, 4, 0).reason, 'tight', 'Palisade zwei Zellen vor der Mündung: tight'); occ.fill(0); put('mauer', 2, 4, 0, 4); put('huette', 8, 7, 0); eq(at('torhaus', 6, 4, 0).reason, 'tight', 'Hütte vor der Südmündung: tight');
  occ.fill(0); eq(cp('torhaus', bi + 6, 0, 0).reason, 'bounds', 'Torhaus am oberen Rand: die Mündung läge außerhalb (bounds)'); eq(cp('torhaus', bi + 6, GH - 2, 0).reason, 'bounds', 'Torhaus am unteren Rand: bounds');
  // the keep gate: no wall within one cell of it, the cells two away are fine; the keep itself keeps its ring
  const gk = W.keepGate(w, lord), gi = gk % GW, gj = (gk - gi) / GW, kk = w.sites[lord].keep;
  eq(gj, kk.j + 6, 'Burgtor: Zeile unter dem Bergfried (Burg 0 öffnet nach Süden)'); eq(gi, kk.i + 3, 'Burgtor: Spalte 4 des Bergfrieds'); eq([0, 1, 2, 3].map(s => { const g = W.keepGate(w, s), k = w.sites[s].keep; return (g % GW - k.i) + ',' + (Math.floor(g / GW) - k.j); }).join(' '), '3,6 3,6 3,-1 3,-1', 'Burgtore: Süd für Burg 0/1, Nord für 2/3');
  eq(cp('mauer', gi - 1, gj + 1, 0, { len: 3 }).reason, 'tight', 'Mauer eine Zelle vor dem Burgtor: tight'); eq(cp('mauer', gi + 2, gj, 1, { len: 2 }).ok === false || cp('mauer', gi + 2, gj, 1, { len: 2 }).reason === 'tight', true, 'Mauer neben dem Burgtor: nicht erlaubt');
  ok(['ok', 'terrain', 'wet', 'owner'].includes(cp('mauer', gi - 1, gj + 2, 0, { len: 3 }).reason || 'ok'), 'zwei Zellen vor dem Burgtor ist die Lücke groß genug (' + (cp('mauer', gi - 1, gj + 2, 0, { len: 3 }).reason || 'ok') + ')');
  eq(cp('mauer', kk.i - 1, kk.j, 1, { len: 3 }).reason, 'tight', 'Mauer dicht am Bergfried: tight (oder fremd/Gelände davor)'.length ? 'tight' : '');
  // Markt 4 × 3 and Söldnerlager 5 × 4 place like plain buildings (ring of one free cell, rot 1 swaps)
  occ.fill(0);
  eq(at('markt', 3, 3, 0).ok && at('markt', 3, 3, 1).ok && at('soeldnerlager', 3, 3, 0).ok && at('soeldnerlager', 3, 3, 1).ok, true, 'Markt und Söldnerlager: ok');
  put('markt', 4, 4, 0); eq(at('huette', 8, 4, 0).reason, 'tight', 'Hütte dicht am Markt: tight'); eq(at('huette', 9, 4, 0).ok, true, 'Hütte mit einer freien Zelle zum Markt: ok'); eq(at('mauer', 8, 4, 1, 3).reason, 'tight', 'Mauer dicht am Markt: tight'); eq(at('soeldnerlager', 4, 5, 0).reason, 'occupied', 'Söldnerlager über dem Markt: occupied');
  eq(at('markt', 4, 7, 0).reason, 'tight', 'Markt dicht am Markt: tight'); eq(at('markt', 4, 8, 0).ok, true, 'Markt mit einer freien Zelle zum Markt: ok');
  // a ruin or any foreign code in the ring behaves like a building (the generic rule): any non-zero value that is no wall code is not exempt
  occ.fill(0); occ[(bj + 5) * GW + bi + 5] = 1; eq(at('mauer', 6, 5, 0, 2).reason, 'tight', 'fremder occ-Wert: tight'); occ[(bj + 5) * GW + bi + 5] = CODE.mauer; eq(at('mauer', 6, 5, 0, 2).ok, true, 'Mauer-Code im Ring: ok');
  // suggest for walls honours len: the spot is valid for exactly that length (rot 1 is tried only for len > 1)
  for (const k of ['mauer', 'palisade']) for (let len = 1; len <= 4; len++) { const sg = W.suggest(w, k, lord, { L: 0, len }); ok(sg !== null, 'suggest ' + k + ' len ' + len); if (sg) { eq(W.canPlace(w, k, sg.i, sg.j, sg.rot, { lord, L: 0, len }).ok, true, 'suggest ' + k + ' len ' + len + ' ist gültig'); if (len === 1) eq(sg.rot, 0, 'ein einzelnes Stück hat keine Richtung (rot 0)'); } }
  { const o2 = new Uint8Array(N); const a = W.suggest(w, 'mauer', lord, { L: 0, len: 3, occ: o2 }); put('mauer', 0, 0, 0, 1); const sg2 = W.suggest(w, 'torhaus', lord, { L: 0, occ }); ok(a && sg2 && W.canPlace(w, 'torhaus', sg2.i, sg2.j, sg2.rot, { lord, L: 0, occ }).ok, 'suggest torhaus (mit Mauer auf der Karte) gültig'); occ.fill(0); }
  // order of reasons holds for the new kinds: bounds before owner before terrain
  eq(cp('mauer', GW - 1, 10, 0, { len: 4, lord: 1 }).reason, 'bounds', 'bounds vor owner (Mauer)'); const foreign2 = cellsOf(w, k => { const i = k % GW, j = (k - i) / GW; return w.owner[k] === 1 && i > 3 && i < GW - 6 && j > 4 && j < GH - 5 && w.owner[k + 1] === 1 && w.owner[k + 2] === 1; })[0]; eq(cp('torhaus', foreign2 % GW, Math.floor(foreign2 / GW), 0).reason, 'owner', 'Torhaus im fremden Viertel: owner');
}

// ---- suggest: valid for every kind × lord on 10 seeds; 12 buildings in a row ----
{
  const kinds = Object.keys(W.BUILDINGS).filter(k => k !== 'bergfried'), code = (k) => 1 + Object.keys(W.BUILDINGS).indexOf(k);
  const seq = ['hof', 'huette', 'holzfaeller', 'steinbruch', 'kornspeicher', 'lager', 'kaserne', 'huette', 'wachturm', 'brunnen', 'hof', 'huette', 'markt', 'soeldnerlager', 'torhaus', 'mauer', 'palisade'];
  const stampOcc = (occ, kind, s) => { const [w, h] = W.footprintOf(kind, s.rot); for (let dj = 0; dj < h; dj++) for (let di = 0; di < w; di++) occ[(s.j + dj) * GW + s.i + di] = code(kind); };
  let total = 0, near = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const w = world(seed);
    for (let lord = 0; lord < 4; lord++) {
      const T = 'seed ' + seed + ' Burg ' + lord + ': ';
      for (const kind of kinds) {
        const s = W.suggest(w, kind, lord, { L: 0 });
        ok(s !== null, T + kind + ' hat einen Vorschlag');
        if (s) { ok(W.canPlace(w, kind, s.i, s.j, s.rot, { lord, L: 0 }).ok, T + kind + ' Vorschlag ist gültig'); eq(JSON.stringify(s), JSON.stringify(W.suggest(w, kind, lord, { L: 0 })), T + kind + ' deterministisch'); }
      }
      eq(W.suggest(w, 'bergfried', lord), null, T + 'Bergfried: kein Vorschlag');
      const occ = new Uint8Array(N);
      seq.forEach((kind, n) => {
        const s = W.suggest(w, kind, lord, { L: 0, occ });
        ok(s !== null, T + 'Folge ' + (n + 1) + ' ' + kind + ': Vorschlag');
        if (!s) return;
        const r = W.canPlace(w, kind, s.i, s.j, s.rot, { lord, L: 0, occ });
        ok(r.ok, T + 'Folge ' + (n + 1) + ' ' + kind + ' gültig (' + r.reason + ')');
        stampOcc(occ, kind, s); total++;
        const kc = w.sites[lord], c = { x: -72 + s.i + 1, y: -45 + s.j + 1 };
        if (kind === 'huette' && n === 1 && dist(c, kc) <= 14) near++;
      });
      // nothing left → null; a high level leaves few dry cells but stays valid
      eq(W.suggest(w, 'huette', lord, { L: 0, occ: new Uint8Array(N).fill(1) }), null, T + 'alles belegt → null');
      const hi = W.suggest(w, 'huette', lord, { L: 0.6 });
      ok(hi === null || W.canPlace(w, 'huette', hi.i, hi.j, hi.rot, { lord, L: 0.6 }).ok, T + 'Vorschlag bei L=0.6 gültig');
    }
  }
  ok(near >= 36, 'die zweite Hütte steht nahe der Burg (' + near + '/40)');
  // heuristics: Hof prefers Aue, Kaserne sits towards the nearest crossing
  let aueGain = 0, towards = 0, n = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const w = world(seed);
    for (let lord = 0; lord < 4; lord++) {
      const sh = W.suggest(w, 'hof', lord), sk = W.suggest(w, 'kaserne', lord), kc = w.sites[lord];
      const aueShare = (s) => { const [wd, ht] = W.footprintOf('hof', s.rot); let a = 0; for (let dj = 0; dj < ht; dj++) for (let di = 0; di < wd; di++) if (w.cls[(s.j + dj) * GW + s.i + di] === CI.A) a++; return a / (wd * ht); };
      aueGain += aueShare(sh);
      const cr = w.crossings.filter(c => c.joins.includes(lord)).sort((a, b) => dist(a, kc) - dist(b, kc))[0], [kw, kh] = W.footprintOf('kaserne', sk.rot);
      if (dist({ x: -72 + sk.i + kw / 2, y: -45 + sk.j + kh / 2 }, cr) < dist(kc, cr)) towards++;
      n++;
    }
  }
  ok(aueGain / n >= 0.5, 'Hof liegt im Mittel mind. zur Hälfte in der Aue (' + (aueGain / n).toFixed(2) + ')'); ok(towards >= n * 0.9, 'Kaserne liegt zwischen Burg und Übergang (' + towards + '/' + n + ')');
}

// ---- encode / decode: roundtrip and equal answers on the decoded grid ----
{
  let okPhase2 = 0;
  for (const seed of [1, 2, 3, 9]) {
    const w = world(seed), e = W.encode(w), g = W.decode(e), T = 'seed ' + seed + ': ';
    ok(['cls', 'hq', 'owner'].every(f => /^([A-Za-z]\d*)+$/.test(e[f])), T + 'RLE-Format');
    ok(e.cls.length < 9000 && e.hq.length < 14000 && e.owner.length < 2500, T + 'Codec kompakt (' + e.cls.length + '/' + e.hq.length + '/' + e.owner.length + ')');
    eq(g.GW, GW, T + 'decode GW'); eq(g.GH, GH, T + 'decode GH');
    let bad = 0, badH = 0, badO = 0;
    for (let k = 0; k < N; k++) {
      if (g.cls[k] !== w.cls[k]) bad++;
      if (g.hq[k] !== Math.max(-20, Math.min(25, w.hq[k]))) badH++;
      if (g.owner[k] !== w.owner[k]) badO++;
    }
    eq(bad, 0, T + 'cls roundtrip'); eq(badH, 0, T + 'hq roundtrip (−20…25)'); eq(badO, 0, T + 'owner roundtrip');
    const km = W.keepMask(w); let badK = 0; for (let k = 0; k < N; k++) if (km[k] !== g.keep[k]) badK++;
    eq(badK, 0, T + 'Bergfried-Maske roundtrip');
    g.crossings = w.crossings;   // the phone gets these with ffMap
    for (const L of [0, 0.2, 0.45, 0.7, 1]) { let d = 0; for (let k = 0; k < N; k++) if (W.walk(w, k, L) !== W.walk(g, k, L) || W.dry(w, k, L) !== W.dry(g, k, L)) d++; eq(d, 0, T + 'walk/dry gleich bei L=' + L); }
    const rnd = W.mulberry32(seed * 31);
    let pl = 0;
    for (let n = 0; n < 600; n++) {
      const kind = Object.keys(W.BUILDINGS)[1 + Math.floor(rnd() * 9)], i = Math.floor(rnd() * GW), j = Math.floor(rnd() * GH), rot = rnd() < 0.5 ? 0 : 1, lord = Math.floor(rnd() * 4), L = [0, 0.3][n % 2];
      const a = W.canPlace(w, kind, i, j, rot, { lord, L }), b = W.canPlace(g, kind, i, j, rot, { lord, L });
      if (a.ok !== b.ok || a.reason !== b.reason) pl++;
    }
    eq(pl, 0, T + 'canPlace gleich auf dem decodierten Gitter');
    // Phase 2: every kind (walls with len), with an occupancy full of walls, towers, gates and houses scattered around the quarters
    const occ2 = new Uint8Array(N), ks = Object.keys(W.BUILDINGS);
    for (let n = 0; n < 160; n++) { const kind = ks[1 + Math.floor(rnd() * 14)], rot = rnd() < 0.5 ? 0 : 1, [fw, fh] = W.footprintOf(kind, rot, 1 + Math.floor(rnd() * 4)), i = Math.floor(rnd() * (GW - fw)), j = Math.floor(rnd() * (GH - fh)); for (let dj = 0; dj < fh; dj++) for (let di = 0; di < fw; di++) occ2[(j + dj) * GW + i + di] = W.CODE[kind]; }
    let pl2 = 0;
    for (let n = 0; n < 1500; n++) {
      const kind = ks[1 + Math.floor(rnd() * 14)], i = Math.floor(rnd() * GW), j = Math.floor(rnd() * GH), rot = rnd() < 0.5 ? 0 : 1, lord = Math.floor(rnd() * 4), len = 1 + Math.floor(rnd() * 4);
      const a = W.canPlace(w, kind, i, j, rot, { lord, L: 0, occ: occ2, len }), b = W.canPlace(g, kind, i, j, rot, { lord, L: 0, occ: occ2, len });
      if (a.ok !== b.ok || a.reason !== b.reason) pl2++;
      if (a.ok) okPhase2++;
    }
    eq(pl2, 0, T + 'canPlace (alle Arten, Mauern mit len, belegtes Gitter) gleich auf dem decodierten Gitter');
    for (let s = 0; s < 4; s++) eq(W.keepGate(w, s), W.keepGate(g, s), T + 'Burgtor ' + s + ' gleich auf dem decodierten Gitter');
    let su = 0;
    for (let lord = 0; lord < 4; lord++) for (const kind of Object.keys(W.BUILDINGS).slice(1)) if (JSON.stringify(W.suggest(w, kind, lord)) !== JSON.stringify(W.suggest(g, kind, lord))) su++;
    eq(su, 0, T + 'suggest gleich auf dem decodierten Gitter');
    const kc = w.sites.map(s => W.cellOf(s.x + 0.5, s.y + 0.5)), fa = W.field(w, [kc[0]], 0), fb = W.field(g, [kc[0]], 0);
    let fd = 0; for (let k = 0; k < N; k += 5) if (fa[k] !== fb[k]) fd++;
    eq(fd, 0, T + 'field gleich'); const pa = W.path(w, w.sites[0], w.sites[3], 0), pb = W.path(g, w.sites[0], w.sites[3], 0);
    eq(JSON.stringify(pa), JSON.stringify(pb), T + 'path gleich'); near(W.heightAt(g, 0, 0), W.heightAt(w, 0, 0), 1.5, T + 'heightAt grob gleich auf decodiertem Gitter');
  }
  ok(okPhase2 >= 20, 'unter den Zufallsplatzierungen sind genug gültige, damit der Vergleich etwas prüft (' + okPhase2 + ')');
  eq(W.encode(world(1)).cls, W.encode(world(1)).cls, 'encode deterministisch');
  const small = W.decode({ cls: 'G' + N, hq: 'W' + N, owner: 'A' + N }); ok(small.cls[0] === CI.G && small.hq[N - 1] === 2 && small.owner[5] === -1, 'decode: Lauflängen ohne und mit Zahl');
}

// ---- timings ----
{
  const t0 = process.hrtime.bigint(); let att = 0, mx = 0;
  for (let s = 101; s <= 130; s++) { const t = process.hrtime.bigint(); const w = W.make(s); mx = Math.max(mx, Number(process.hrtime.bigint() - t) / 1e6); att += w.stats.attempts; ok(!w.unfair, 'seed ' + s + ': nicht unfair'); }
  const makeAvg = Number(process.hrtime.bigint() - t0) / 1e6 / 30;
  const w = world(3), kc = w.sites.map(s => W.cellOf(s.x + 0.5, s.y + 0.5)), buf = new Float32Array(N);
  let t = process.hrtime.bigint();
  for (let n = 0; n < 60; n++) W.field(w, [kc[n % 4]], [0, 0.2, 0.5][n % 3], buf);
  const fieldAvg = Number(process.hrtime.bigint() - t) / 1e6 / 60;
  t = process.hrtime.bigint(); let pn = 0, pmax = 0;
  for (let n = 0; n < 60; n++) { const a = w.sites[n % 4], b = w.sites[(n + 1 + (n >> 2) % 3) % 4], q = process.hrtime.bigint(); if (W.path(w, a, b, 0)) pn++; pmax = Math.max(pmax, Number(process.hrtime.bigint() - q) / 1e6); }
  const pathAvg = Number(process.hrtime.bigint() - t) / 1e6 / 60;
  t = process.hrtime.bigint(); for (let n = 0; n < 40; n++) W.suggest(w, 'hof', n % 4, { L: 0 });
  const sugAvg = Number(process.hrtime.bigint() - t) / 1e6 / 40;
  console.log('\n  Zeiten: make Ø ' + makeAvg.toFixed(0) + ' ms (max ' + mx.toFixed(0) + ', Ø ' + (att / 30).toFixed(1) + ' Versuche, 30 Seeds inkl. Aufwärmen) · field Ø ' + fieldAvg.toFixed(2) + ' ms · path Ø ' + pathAvg.toFixed(2) + ' ms (max ' + pmax.toFixed(1) + ', ' + pn + '/60 Wege) · suggest(hof) Ø ' + sugAvg.toFixed(2) + ' ms');
  ok(makeAvg < 200, 'make Ø < 200 ms (' + makeAvg.toFixed(0) + ')'); ok(fieldAvg < 5, 'field Ø < 5 ms (' + fieldAvg.toFixed(2) + ')'); ok(pathAvg < 3, 'path Ø < 3 ms (' + pathAvg.toFixed(2) + ')');
  ok(pn === 60, 'alle Burg-zu-Burg-Wege gefunden');
}

// ---- fairness table ----
{
  const f = (a) => a.map(v => String(v).padStart(4)).join(' ');
  console.log('\n  Fairness (30 Seeds): je Burg NW NO SW SO');
  console.log('  seed  Fläche              Bauland             Aue                Wald≤30          Fels≤34          Abw. Fl/Bau/Aue %   Wege bach/fluss/diag (Streuung %)   Versuche');
  for (const r of table) {
    const c = (fn) => r.st.map(fn), sp = (t) => { const l = r.w.stats.pairs.filter(p => p.type === t).map(p => p.len); return ((Math.max(...l) - Math.min(...l)) / mean(l) * 100).toFixed(1); };
    const lens = (t) => r.w.stats.pairs.filter(p => p.type === t).map(p => Math.round(p.len)).join('/');
    console.log('  ' + String(r.seed).padStart(4) + '  ' + f(c(o => o.area)) + '   ' + f(c(o => o.build)) + '   ' + f(c(o => o.aue)) + '   ' + f(c(o => o.forest)) + '   ' + f(c(o => o.rock)) + '   ' +
      [dev(c(o => o.area)), dev(c(o => o.build)), dev(c(o => o.aue))].map(v => (v * 100).toFixed(1).padStart(4)).join(' ') + '   ' +
      ['bach', 'fluss', 'diagonal'].map(t => lens(t) + ' (' + sp(t) + ')').join('  ') + '   ' + r.w.stats.attempts);
  }
  const all = (fn) => table.map(fn);
  console.log('  Fläche ±' + (Math.max(...all(r => dev(r.st.map(o => o.area)))) * 100).toFixed(1) + ' % max · Bauland ±' + (Math.max(...all(r => dev(r.st.map(o => o.build)))) * 100).toFixed(1) +
    ' % · Aue ±' + (Math.max(...all(r => dev(r.st.map(o => o.aue)))) * 100).toFixed(1) + ' % · open: Furten ' + Math.min(...table.flatMap(r => r.w.crossings.filter(c => c.kind === 'furt').map(c => c.open))) + '–' +
    Math.max(...table.flatMap(r => r.w.crossings.filter(c => c.kind === 'furt').map(c => c.open))) + ', Stege ' + [...new Set(table.flatMap(r => r.w.crossings.filter(c => c.kind === 'steg').map(c => c.open)))].join('/') +
    ', Brücke ' + [...new Set(table.map(r => r.w.crossings[2].open))].join('/') + ' · Versuche Ø ' + mean(all(r => r.w.stats.attempts)).toFixed(1) + ' (max ' + Math.max(...all(r => r.w.stats.attempts)) + ')');
}

console.log(process.exitCode ? '\nFEHLER aufgetreten' : '\nOK: ' + checks + ' Prüfungen bestanden');
