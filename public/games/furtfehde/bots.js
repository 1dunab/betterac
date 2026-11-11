// ===== Furt & Fehde bots: AI lords that fill empty houses and take over for players who left (see docs/FURTFEHDE.md "Bots") =====
// FurtBots.create(sim, lord, { strength, seed }) → { step(), stats, info(), strength, lord }. strength: 'knappe' | 'ritter' | 'kriegsherr'.
// A bot sees what a player sees (sim.state, sim.youOf, sim.world, sim.occ) and acts only through build, buildWall, cancel, recruit, banner,
// home, pact and trade. It has its own seeded RNG and no clock, and everything it needs is derived from the state at every decision. So a bot
// created in the middle of a match simply continues the house it is given (takeover): it reads the buildings (walls, Markt, camp), the queue,
// the gold and the banners (a banner whose order points into enemy land is adopted as a campaign in progress).
// Phase 2 (Mauern & Söldner): every strength builds a Markt (sells what the full stores would waste, buys 🌾 when hungry); the ritter and the
// kriegsherr add a Söldnerlager (torch squad and horse archers for gold) and one wall line across the approach from the nearest crossing (palisade
// first, a Torhaus in it, towers at its ends, Mauer when stone allows); their banners break enemy walls with a ram and melee, and their archers
// garrison own walls and towers when they defend.
// Glue duties: create the bot after the sim; call bot.step() for every bot-run house before every sim.step(), in a fixed order (it thinks
// by itself every 15 steps, the knappe every 30); stop calling step() when a human takes the house back (its orders just stay as they are).
// Strengths differ only by decisions: thinking speed, attack threshold, build-order quality and target choice (see PROFILES).
(function (root) {
  const isNode = typeof module === 'object' && module.exports;
  const W = isNode ? require('./world.js') : root.FurtWorld;
  const S = isNode ? require('./sim.js') : root.FurtSim;
  const C = S.CONST;
  const GW = W.GW, GH = W.GH, N = GW * GH;
  const hyp = Math.hypot;
  const GOODS = ['korn', 'holz', 'stein'];
  // world centre of a building (its top-left cell is (i, j); cell (i, j) covers x ∈ [−72 + i, −71 + i))
  const fpOf = (b) => W.footprintOf(b.kind, b.rot || 0, b.len);   // (walls are 1 × len)
  const centerOf = (b) => { const fp = fpOf(b); return { x: b.i - 72 + fp[0] / 2, y: b.j - 45 + fp[1] / 2 }; };
  const WOODEN = { huette: 1, hof: 1, kornspeicher: 1, lager: 1, holzfaeller: 1, steinbruch: 1, markt: 1, soeldnerlager: 1 };   // wooden economy buildings: the raid targets (a palisade is wood too, but no raid is worth it)
  const ECON = { hof: 0, huette: 1, kornspeicher: 2, holzfaeller: 3, lager: 4, steinbruch: 5, markt: 6 };      // raid order: fields and huts first
  const MIL = { kaserne: 0, soeldnerlager: 0, wachturm: 1, brunnen: 2, torhaus: 3 };
  const WALLK = { palisade: 1, mauer: 1 };   // wall lines: never a target of their own, a banner breaks them where they bar its way
  const RAID_COOL = 60;   // seconds between two sorties of the torch squad
  // Phase 1b: no torch sortie before this many seconds after the Fehde began (the first probe used to burn a whole village right after the ebb).
  // The knappe never raids. The delay also holds back a field banner that has a torch-bearer in it.
  const RAID_AFTER_S = { knappe: Infinity, ritter: 120, kriegsherr: 60 };
  const FARM_R = 10;   // a field lies within this of a store, or its farmer walks too far
  const KEEP_CORE = 9;   // a Brunnen is not built within this of the keep centre: the keep's own bucket chain (reach 12) guards that ground
  const FEED = 5.0, FEED_KS = 5.5;   // people one farm really feeds: measured with EAT_S 60, KORN_N 3 at 5.1–6.4 (a field at the gate 6.0, one on Aue 11–21 away Ø 5.6, with a Kornspeicher at its door 7.7–9); the strength's `food` scales it
  const REBUILD = ['hof', 'holzfaeller', 'huette', 'kaserne', 'kornspeicher', 'steinbruch', 'brunnen', 'lager', 'wachturm', 'markt', 'soeldnerlager', 'torhaus', 'palisade', 'mauer'];   // order of rebuilding ruins
  const WALL_R = 14, WALL_HALF = 9;   // the wall line crosses the approach this far from the keep centre and runs up to 9 cells to either side of the Torhaus
  const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DY8 = [0, 0, 1, -1, 1, -1, 1, -1];

  // ---- strengths: only decisions differ ----
  //  think  steps between decisions (15 = 1 s)       thr    soldiers in a banner before it marches
  //  knights  recruits riders                       aim    target choice: 'near' | 'crown' (crowned house first) | 'weak'
  //  food   how many people one farm is believed to feed, as a share of the measured FEED (with a granary FEED_KS): below 1 is a safety margin,
  //         above 1 invites hunger. Raids burn crops and sieges stop the farmers, and only a full granary carries a house through that: the ritter
  //         and the kriegsherr plant about twice the fields their people need (0.7–0.8 left 2–3 of 240 houses starving for over a minute in
  //         60 matches, 0.6 none); the knappe plants too few (1.7), which is part of what makes it the easy bot
  //  kas    farms a bot wants before it builds its Kaserne    hutAhead  free housing below which it builds a hut
  //  wells  Brunnen it builds     tower   Wachturm it builds    smart   checks the target's defenders before it marches
  //  spare  peasants kept free of recruiting beyond the work slots    retreat  share of the peak strength below which a banner turns back
  //  raid   torch-bearers in the raiding squad (banner 3), 0 = none; probe  torch-bearers of the first sortie (a probe, not yet a raid)
  //  raidAfter  seconds after the start of the Fehde before the torch squad may leave (RAID_AFTER_S)
  //  burg   size of the Burgwache    mist  chance to misjudge a target (noise)    keep  buildings a banner razes at the edge before it goes for the keep
  //  stock  extra fields kept in reserve from the first minutes on, because a raid takes some (× the farms the people need)
  //  Phase 2:  mix  the soldier mix (shares; the Söldnerlager units only once a camp stands and gold allows)    market  earliest second for the Markt (once the economy stands)
  //  camp   earliest second for the Söldnerlager, 0 = none    spareW  wood that must lie in the store above their price before the camp and the Markt are built (they come from
  //         wood the growth does not need: built at 130–170 s they cost the kriegsherr a fifth of its wins against the knappe)    foresight  buys 🌾 before the house is hungry
  //         (the knappe only notices hunger when it has it)    walls  builds the wall line from the second wallFrom on (planned 30 s before, around what stands then)
  //  reserve  keeps the planned line's ground free of other buildings (a plan from the first minute that did so cost the fields their best land: 51 % wins instead of 74 %)
  //  torM   stone above the Torhaus's price that must lie in the store before it is built (it never is saved for: that cost 25 points of the wins)
  //  ram    brings a Rammbock to a target behind a stone wall    garrison  its archers go up on own walls and towers when it defends
  //  (hutAhead 4 for the kriegsherr: its people were held back by housing; with it the mixed win rate rose from 75 to 85 %. The ritter keeps 2: with 4 it starved in 1 match of 60.)
  const MIX_PLAIN = { speer: 0.53, bogen: 0.47 };                                                              // no camp: Kaserne units only
  const MIX_MERC = { speer: 0.38, bogen: 0.30, ritter: 0.15, reiterschuetze: 0.17 };                           // the doc's mix with the horse archers a share (the torch-bearers form their own squad)
  const PROFILES = {
    knappe:     { think: 30, thr: 14, knights: false, aim: 'near',  food: 1.7,  kas: 4, hutAhead: 0, wells: 1, tower: 0, smart: false, spare: 2, retreat: 0.25, burg: 4, mist: 0.35, raid: 0, probe: 0, keep: 8, stock: 1,   raidAfter: RAID_AFTER_S.knappe,     mix: MIX_PLAIN, market: 330, camp: 0,   spareW: 20, torM: 5, foresight: false, walls: 0, reserve: 0, wallFrom: 0,   ram: false, garrison: false },
    ritter:     { think: 15, thr: 10, knights: true,  aim: 'crown', food: 0.6,  kas: 2, hutAhead: 2, wells: 6, tower: 2, smart: false, spare: 1, retreat: 0.4,  burg: 4, mist: 0.08, raid: 2, probe: 1, keep: 3, stock: 1.2, raidAfter: RAID_AFTER_S.ritter,     mix: MIX_MERC,  market: 260, camp: 240, spareW: 10, torM: 5, foresight: true, walls: 1, reserve: 1, wallFrom: 240, ram: true,  garrison: true },
    kriegsherr: { think: 15, thr: 8,  knights: true,  aim: 'weak',  food: 0.57, kas: 2, hutAhead: 4, wells: 6, tower: 3, smart: true,  spare: 1, retreat: 0.4,  burg: 4, mist: 0, raid: 2, probe: 1, keep: 2, stock: 1.2, raidAfter: RAID_AFTER_S.kriegsherr, mix: MIX_MERC,  market: 250, camp: 230, spareW: 10, torM: 5, foresight: true, walls: 1, reserve: 1, wallFrom: 270, ram: true,  garrison: true }
  };

  const mulberry32 = W.mulberry32 || function (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const costOf = (kind, len) => { const B = C.BUILD[kind], c = B.cost || {}; if (!B.perCell || !(len > 1)) return c; const o = {}; for (const g in c) o[g] = c[g] * len; return o; };   // (a wall piece costs per cell)
  const unitCost = (unit) => C.UNIT[unit].cost || {};
  // Phase 2: a unit can cost 💰 (torch-bearer, horse archer, ram): gold comes from the Markt, so `have` may carry a `gold` entry
  const affordable = (have, cost) => { for (const g of GOODS) if ((cost[g] || 0) > (have[g] || 0)) return false; return (cost.gold || 0) <= (have.gold || 0); };

  function create(sim, lord, opts) {
    opts = opts || {};
    const P = PROFILES[opts.strength] || PROFILES.ritter, strength = PROFILES[opts.strength] ? opts.strength : 'ritter';
    const rng = mulberry32(((opts.seed | 0) ^ Math.imul(lord + 1, 0x9E3779B1)) >>> 0);
    const stats = { thinks: 0, builds: 0, buildFails: 0, rebuilds: 0, cancels: 0, recruits: 0, attacks: 0, retreats: 0, defends: 0, raids: 0, targets: 0, pactYes: 0, pactNo: 0, errors: 0, lastError: '',
      trades: 0, goldIn: 0, goldOut: 0, wallPieces: 0, rams: 0, garrisons: 0, sieges: 0 };
    const noop = { step() {}, stats, info() { return {}; }, strength, lord };
    if (!sim || !sim.state || !W) return noop;
    const world = sim.world, st = sim.state, dt = sim.dt;
    const lrec = st.lords.find(l => l.i === lord);
    if (!lrec || !world) return noop;
    const site = lrec.site, out = site < 2 ? 1 : -1, ss = world.sites[site];
    const gate = { x: ss.x + 0.5, y: ss.y + 3.5 * out };                       // the cell in front of the keep gate
    const keepX = ss.x, keepY = ss.y;
    // Where banner n rests. The field army stands among the farms (torch-bearers are shot as they arrive, and a burning field is not
    // abandoned by the bucket chain because the raiders are dead before they flee-scare it); the torch squad and the guard stay at the gate.
    let fieldPost = null, fieldPostT = -99;
    function homePos(n) {
      if ((n === 1 || n === 2) && fieldPost) return { x: fieldPost.x + (n === 1 ? -2.5 : 2.5), y: fieldPost.y };
      return { x: gate.x + (n - 2) * 7, y: gate.y + out * 8 };   // the sim's default post of banner n
    }
    function updateFieldPost() {
      if (c.t - fieldPostT < 10) return;
      fieldPostT = c.t;
      let x = 0, y = 0, n = 0;
      for (const b of c.mine) if (b.kind === 'hof' && !b.ruined && b.build >= 1) { const q = centerOf(b); x += q.x; y += q.y; n++; }
      fieldPost = n >= 2 ? { x: x / n, y: y / n } : null;
    }
    const offset = (lord * 4 + Math.floor(rng() * 4)) % P.think;                // spreads the bots' thinking over the steps

    // ---- memory: only what cannot be read from the state ----
    const failSpots = [];                  // footprints that sim.build refused for a reason other than cost: [{ i, j, w, h, until }]
    const noSpot = {};                     // kind → time until which suggest found nothing
    const seen = {};                       // building id → { t: first seen as ruin | last progress time, b: last build value }
    const scratch = new Uint8Array(N);     // occ copy with the refused spots stamped in
    let lastValve = -99, noWoodUntil = 0, hungerSince = -1, quarryShed = false, focus = { house: -1, until: 0 };
    const hits = new Map();                // house → time until which it is not a target (unreachable, pact, protected)
    const bn = [null, mkBn(), mkBn(), mkBn()];
    let c = null, threat = null, calmSince = 0;
    let fehdeAt = st.phase === 'fehde' && st.t > 0 ? -Infinity : -1;   // when the Fehde was first seen (a bot created in the middle of it is a takeover: no delay)
    const why = {};                        // last reasons for not acting (debugging aid)
    const trace = Array.isArray(opts.trace) ? opts.trace : null;   // optional log of placement attempts: [t, kind, result]
    function mkBn() { return { mode: 'home', house: -1, bid: -1, tx: 0, ty: 0, peak: 0, t0: 0, prog: 0, hpMark: 2, cool: 0, def: false, raids: 0, razed: 0, skip: new Map(), noHouse: new Map(), px: 0, py: 0, wallHp: 0, ramT: -99 }; }

    // ---- reading the state ----
    function look() {
      const y = sim.youOf(lord);
      if (!y) return false;
      const me = st.lords.find(l => l.i === lord);
      c = { y, me, t: st.t, L: st.level, phase: st.phase, people: y.pop, soldiers: me.soldiers, done: {}, wip: {}, ruins: [], mine: [], keep: null, pact: {}, foes: [] };
      if (c.phase === 'fehde' && fehdeAt === -1) fehdeAt = c.t;
      c.peasants = c.people - c.soldiers;
      c.unst = 0;   // worker slots of finished workplaces nobody stands at (not those that rest because their store is full: R11 sends their crews home on purpose)
      for (const b of st.buildings) {
        if (b.lord !== lord) continue;
        if (b.kind === 'bergfried') { c.keep = b; continue; }
        c.mine.push(b);
        if (b.ruined) c.ruins.push(b);
        else if (b.build >= 1) {
          c.done[b.kind] = (c.done[b.kind] || 0) + 1;
          const wk = C.BUILD[b.kind].workers || 0;
          if (wk && !b.full) c.unst += Math.max(0, wk - (b.workers || 0));
        } else c.wip[b.kind] = (c.wip[b.kind] || 0) + 1;
      }
      for (const p of y.pacts) if (p.state === 'active') c.pact[p.with] = true;
      for (const l of st.lords) if (l.i !== lord && !c.pact[l.i]) c.foes.push(l);
      c.banners = [null, null, null, null];
      for (const b of y.banners) c.banners[b.n] = b;
      return true;
    }
    const have = (k) => (c.done[k] || 0) + (c.wip[k] || 0);
    const wipN = () => { let n = 0; for (const k in c.wip) n += c.wip[k]; return n; };

    // ---- placing buildings ----
    // Every placement is FurtWorld.suggest. To steer it, a scratch copy of the occupancy is handed over: refused spots and cells
    // outside an allowed region are stamped as occupied (255), so suggest only ever sees the region we want.
    const allow = new Uint8Array(N);
    function stamp(occ, i0, j0, w, h) {   // mark a footprint plus its one-cell margin
      for (let dj = -1; dj <= h; dj++) for (let di = -1; di <= w; di++) {
        const ci = i0 + di, cj = j0 + dj;
        if (ci >= 0 && cj >= 0 && ci < GW && cj < GH) occ[cj * GW + ci] = 255;
      }
    }
    // Once the wall line is planned, its ground (cells, Torhaus, tower spots, each with the free cell the placement rules ask for) is kept free of other buildings.
    function reserveWalls(occ) { if (plan && plan.res && P.reserve) for (let n = 0; n < plan.res.length; n++) occ[plan.res[n]] = 255; }
    // The yard in front of the gate is where idle peasants wait and every carrier passes: nothing is built there. (A building that goes up
    // on a route a peasant already holds leaves him stuck, so the busiest ground is kept free.)
    function yardClear(occ) {
      const r = C.YARD_R, ci = Math.floor(gate.x + 72), cj = Math.floor(gate.y + 45);
      for (let j = Math.max(0, cj - r - 1); j <= Math.min(GH - 1, cj + r + 1); j++) for (let i = Math.max(0, ci - r - 1); i <= Math.min(GW - 1, ci + r + 1); i++)
        if (hyp(i - 71.5 - gate.x, j - 44.5 - gate.y) <= r) occ[j * GW + i] = 255;
    }
    // region: null (everywhere) | { near: [{x, y}], r } (within r of a point) | { far: [{x, y, r?}], r } (not within r of any; a point may carry its own r) | { behind: true } (at or behind the keep's back wall)
    function spotFor(kind, region, fake) {
      let occ;
      const now = c.t;
      for (let i = failSpots.length - 1; i >= 0; i--) if (failSpots[i].until < now) failSpots.splice(i, 1);
      {
        scratch.set(sim.occ);
        for (const f of failSpots) stamp(scratch, f.i, f.j, f.w, f.h);
        yardClear(scratch);
        reserveWalls(scratch);
        if (fake) fake(scratch);
        if (region) {
          allow.fill(0);
          if (region.near) for (const p of region.near) {
            const r = p.r || region.r, ci = Math.floor(p.x + 72), cj = Math.floor(p.y + 45);
            for (let j = Math.max(0, cj - r - 1); j <= Math.min(GH - 1, cj + r + 1); j++) for (let i = Math.max(0, ci - r - 1); i <= Math.min(GW - 1, ci + r + 1); i++) {
              const dx = i - 71.5 - p.x, dy = j - 44.5 - p.y;
              if (hyp(dx, dy) > r) continue;
              if (p.sec === 'n' ? dy > 1 : p.sec === 'e' ? dx < -1 : p.sec === 'w' ? dx > 1 : p.sec === 's' ? dy < -1 : false) continue;   // one side of the point only
              allow[j * GW + i] = 1;
            }
          } else if (region.far) {
            allow.fill(1);
            for (const p of region.far) {
              const r = p.r || region.r, ci = Math.floor(p.x + 72), cj = Math.floor(p.y + 45);
              for (let j = Math.max(0, cj - r - 1); j <= Math.min(GH - 1, cj + r + 1); j++) for (let i = Math.max(0, ci - r - 1); i <= Math.min(GW - 1, ci + r + 1); i++)
                if (hyp(i - 71.5 - p.x, j - 44.5 - p.y) <= r) allow[j * GW + i] = 0;
            }
          } else if (region.behind) {
            for (let j = 0; j < GH; j++) { const y = j - 44.5; if ((y - keepY) * out <= 2) for (let i = 0; i < GW; i++) allow[j * GW + i] = 1; }
          }
          for (let k = 0; k < N; k++) if (!allow[k] && !scratch[k]) scratch[k] = 255;
        }
        occ = scratch;
      }
      return W.suggest(world, kind, site, { L: c.L, occ });
    }
    function tryBuild(kind, s) {   // 'ok' | 'cost' | 'fail'
      const r = sim.build(lord, kind, s.i, s.j, s.rot);
      if (r.ok) { stats.builds++; c.wip[kind] = (c.wip[kind] || 0) + 1; return 'ok'; }
      if (r.reason === 'cost') return 'cost';
      stats.buildFails++;
      const fp = W.footprintOf(kind, s.rot);
      failSpots.push({ i: s.i, j: s.j, w: fp[0], h: fp[1], until: c.t + 90 });
      return 'fail';
    }
    // the points a carrier delivers 🌾 to: the keep gate and every Kornspeicher (finished or planned)
    function granaries() {
      const out = [{ x: gate.x, y: gate.y, r: FARM_R + 3 }];   // the keep's yard reaches a little further: the keep itself is big
      for (const b of c.mine) if (b.kind === 'kornspeicher' && !b.ruined) out.push({ x: b.i - 70.5, y: b.j - 41.5, r: FARM_R });
      return out;
    }
    // suggest ranks spots by their distance to the keep's centre and breaks ties by scan order (north first). Carriers deliver at the gate,
    // though, and the gate faces south on the northern sites and north on the southern ones: so the search grows in circles around the
    // delivery points, and the nearest door wins no matter which side of the keep it is on.
    function nearSpot(kind, pts, sec) {
      for (const f of [0.6, 1]) {
        const s = spotFor(kind, { near: pts.map(p => ({ x: p.x, y: p.y, r: Math.round(p.r * f), sec })) });
        if (s) return s;
      }
      return null;
    }
    // Doors face south (rot 0) or west (rot 1), so a field north of a store looks at it while one south of it turns its back and its
    // farmer walks around the house. Candidates from several sides are compared by the distance from the field's door to the
    // nearest store door; a field on good Aue earns a bonus.
    function doorOfSpot(kind, s) {
      const fp = W.footprintOf(kind, s.rot);
      const ci = s.rot ? s.i - 1 : s.i + (fp[0] >> 1), cj = s.rot ? s.j + (fp[1] >> 1) : s.j + fp[1];
      return { x: ci - 71.5, y: cj - 44.5 };
    }
    function currentOcc() {   // the occupancy with the refused spots and the keep yard stamped in
      scratch.set(sim.occ);
      for (const f of failSpots) stamp(scratch, f.i, f.j, f.w, f.h);
      yardClear(scratch);
      reserveWalls(scratch);
      return scratch;
    }
    // fields whose door lies within a few cells of a store door, in both turns (door south, door west); a clear zone stays around the door
    function doorFirst(pts) {
      const out = [], occ = currentOcc();
      for (const p of pts) {
        const dci = Math.floor(p.x + 72), dcj = Math.floor(p.y + 45);
        for (let rot = 0; rot < 2; rot++) {
          const fp = W.footprintOf('hof', rot);
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const ddx = dci + dx, ddy = dcj + dy;
            const i = rot ? ddx + 1 : ddx - (fp[0] >> 1), j = rot ? ddy - (fp[1] >> 1) : ddy - fp[1];
            // keep a clear patch (door cell and its neighbours) in front of the store
            if (i <= dci + 1 && i + fp[0] - 1 >= dci - 1 && j <= dcj + 1 && j + fp[1] - 1 >= dcj - 1) continue;
            if (W.canPlace(world, 'hof', i, j, rot, { lord: site, L: c.L, occ }).ok) out.push({ i, j, rot });
          }
        }
      }
      return out;
    }
    function farmSpot(pts) {
      let best = null, bs = Infinity;
      const rate = (s) => {
        const d = doorOfSpot('hof', s), fp = W.footprintOf('hof', s.rot);
        let gap = Infinity, aue = 0;
        for (const p of pts) if (hyp(d.x - p.x, d.y - p.y) < gap) gap = hyp(d.x - p.x, d.y - p.y);
        if (gap > FARM_R + 3) return;
        for (let dj = 0; dj < fp[1]; dj++) for (let di = 0; di < fp[0]; di++) if (world.cls[(s.j + dj) * GW + s.i + di] === W.CI.A) aue++;
        const score = gap - 6 * aue / (fp[0] * fp[1]) + 0.01 * hyp(s.i - 72 + fp[0] / 2 - keepX, s.j - 45 + fp[1] / 2 - keepY);
        if (score < bs) { bs = score; best = s; }
      };
      for (const s of doorFirst(pts)) rate(s);
      const plain = nearSpot('hof', pts); if (plain) rate(plain);
      if (bs > 4) for (const sec of ['n', 'e', 'w']) { const s = nearSpot('hof', pts, sec); if (s) rate(s); }
      return best;
    }
    // 'ok' | 'cost' | 'nospot' | 'fail' | 'wait'
    function place(kind) {
      const r = place0(kind);
      if (trace) trace.push([+c.t.toFixed(1), kind, r]);
      return r;
    }
    function place0(kind) {
      if ((noSpot[kind] || 0) > c.t) return 'nospot';
      let s = null;
      if (kind === 'hof') {   // fields only within carrying distance of a store; otherwise a granary first, next to fresh farmland
        s = farmSpot(granaries());
        if (!s) {
          if (c.wip.kornspeicher) return 'wait';
          const free = spotFor('hof');
          if (!free) { noSpot.hof = c.t + 20; return 'nospot'; }
          const fp = W.footprintOf('hof', free.rot), code = 1 + Object.keys(W.BUILDINGS).indexOf('hof');
          const k = spotFor('kornspeicher', null, (occ) => {   // pretend the new field is the only one: the granary lands next to it
            for (let k2 = 0; k2 < N; k2++) if (occ[k2] === code) occ[k2] = 255;
            for (let dj = 0; dj < fp[1]; dj++) for (let di = 0; di < fp[0]; di++) occ[(free.j + dj) * GW + free.i + di] = code;
          });
          if (!k) { noSpot.hof = c.t + 20; return 'nospot'; }
          if (!affordable(c.avail, costOf('kornspeicher'))) return 'cost';
          const r = tryBuild('kornspeicher', k);
          if (r === 'ok') c.spent = costOf('kornspeicher');
          return r === 'ok' ? 'granary' : r;
        }
      } else if (kind === 'huette') {
        s = spotFor('huette', { behind: true }) || spotFor('huette');
      } else if (kind === 'holzfaeller') {
        s = nearSpot('holzfaeller', [{ x: gate.x, y: gate.y, r: 18 }]) || spotFor('holzfaeller');
      } else if (kind === 'wachturm') {   // towers shoot torch-bearers first: they belong at the fields, away from the other towers; the extra ones stand at the ends of the wall line
        s = have('wachturm') >= P.tower ? towerSpot() : null;
        if (!s) {
          const fields = [], towers = [];
          for (const b of c.mine) { if (b.ruined) continue; if (b.kind === 'hof') fields.push(centerOf(b)); else if (b.kind === 'wachturm') towers.push(centerOf(b)); }
          let fx = 0, fy = 0; for (const f of fields) { fx += f.x; fy += f.y; }
          if (fields.length) { fx /= fields.length; fy /= fields.length; }
          s = (fields.length && ((towers.length && spotFor('wachturm', { far: towers, r: 12 })) || spotFor('wachturm', { near: [{ x: fx, y: fy, r: 9 }] }))) || spotFor('wachturm');
        }
      } else if (kind === 'markt' || kind === 'soeldnerlager') {   // trade and training need no road: out of harm's way behind the keep
        s = spotFor(kind, { behind: true }) || spotFor(kind);
      } else if (kind === 'torhaus') {   // the gate of the wall line, on the main path (its spot is fixed by the plan)
        if (!plan || plan.noTor || torhausBuilt()) return 'nospot';
        const r = tryBuild('torhaus', { i: plan.ti, j: plan.tj, rot: plan.rot });
        if (r === 'fail' && ++plan.torFail >= 2) plan.noTor = true;
        return r;
      } else if (kind === 'brunnen') {   // wells cover a radius of 12: the keep guards its own core (R6), so a Brunnen goes to the outlying fields and huts, and the next one to another part of the base
        const wells = [];
        for (const b of c.mine) if (b.kind === 'brunnen' && !b.ruined) wells.push(Object.assign(centerOf(b), { r: 6 }));
        const outer = [{ x: keepX, y: keepY, r: KEEP_CORE }, ...wells];   // overlapping reach: two wells share a burning cluster
        s = spotFor('brunnen', { far: outer }) || (wells.length && spotFor('brunnen', { far: wells })) || spotFor('brunnen');
      } else s = spotFor(kind);
      if (!s) { noSpot[kind] = c.t + 20; return 'nospot'; }
      return tryBuild(kind, s);
    }

    // ---- economy ----
    // How many people one farm feeds. Phase 1b measured it (EAT_S 60, KORN_N 3: one person eats a sack a minute): see FEED above. The bot
    // believes only a share of that (the strength's `food`: raids burn fields, farmers flee, soldiers eat too); `adj` learns the real value
    // of this house's land: it falls with every bout of hunger and recovers while the granary is well filled.
    let adj = 1, lastHunger = false, lastT = 0, lowFor = 0;
    function learnFood() {
      const dtT = Math.max(0, c.t - lastT); lastT = c.t;
      const y = c.y, low = y.stock.korn < 5 && c.people >= 8;
      if (y.hunger && !lastHunger) adj = Math.max(0.8, adj - 0.05);
      if (y.hunger) adj = Math.max(0.8, adj - 0.002 * dtT);
      else if (low) { lowFor += dtT; if (lowFor > 30) adj = Math.max(0.8, adj - 0.001 * dtT); }
      else { lowFor = 0; if (y.stock.korn >= 10) adj = Math.min(1.1, adj + 0.003 * dtT); }
      lastHunger = y.hunger;
    }
    const perFarm = () => (c.done.kornspeicher ? FEED_KS : FEED) * P.food * adj / (c.t > 100 ? P.stock : 1);
    const farmsFor = (pop) => Math.ceil(pop / perFarm());
    // woodcutters by population: a dry store does not call for more of them than the house has hands for
    function woodWant() { return 2 + (c.people >= 16 ? 1 : 0) + (c.people >= 26 ? 1 : 0) + (c.people >= 40 ? 1 : 0); }
    function storeFull() {
      const y = c.y;
      return y.stock.holz >= 0.7 * y.cap.holz || y.stock.stein >= 0.7 * y.cap.stein;
    }
    // wooden buildings (finished or planned) that neither the keep's bucket chain nor a Brunnen reaches
    function loose() {
      const wellsAt = [];
      for (const b of c.mine) if (b.kind === 'brunnen' && !b.ruined) wellsAt.push(centerOf(b));
      let n = 0;
      for (const b of c.mine) {
        if (b.ruined || !WOODEN[b.kind]) continue;
        const q = centerOf(b);
        if (hyp(q.x - keepX, q.y - keepY) <= C.KEEP_WELL_R || wellsAt.some(w => hyp(w.x - q.x, w.y - q.y) <= C.BUCKET_R)) continue;
        n++;
      }
      return n;
    }
    // the kinds the house wants next, in priority order (a kind may appear twice when two are wanted)
    function wants() {
      const w = [], y = c.y, F = have('hof'), people = c.people, cap = y.popCap, korn = y.stock.korn, now = c.t;
      const hungry = y.hunger || (korn <= 4 && people >= 8);
      const glut = korn >= 0.8 * y.cap.korn && !y.hunger;
      const needNow = farmsFor(Math.max(people, Math.min(cap, people + 4)));
      const hands = c.unst <= 1 || y.idle >= 1;           // somebody is left to work another field
      const spare = c.peasants - slots() >= 1 || y.idle >= 1;   // a peasant is left over for another workplace (a woodcutter built without one only takes hands from the fields)
      const wood = spare && c.t >= noWoodUntil;
      const free = cap + 4 * (c.wip.huette || 0) - people, wc = have('holzfaeller');   // housing includes the huts already going up
      if (F === 0) w.push('hof');
      if (wc === 0) w.push('holzfaeller');
      if (have('steinbruch') === 0 && (!quarryShed || (y.stock.stein < 8 && korn >= 10))) { w.push('steinbruch'); quarryShed = quarryShed && y.stock.stein >= 8; }
      if (F < 2) w.push('hof');
      // the barracks as soon as there is stone for it: idle hands become soldiers
      const stoneOk = have('steinbruch') > 0 || y.stock.stein >= 8;                                  // a quarry, or stone in the store
      const wantKas = !have('kaserne') && stoneOk && (F >= P.kas || now > 150);                        // (after 150 s the fields are enough: a full granary must not keep the barracks from ever being built)
      if (wantKas && y.stock.stein >= costOf('kaserne').stein) w.push('kaserne');
      // wells cost stone only and one of them turns a torch into a nuisance. The keep puts out fires within KEEP_WELL_R of its centre (R6), so a Brunnen
      // is for the wooden buildings beyond that reach, and only once three of them stand unprotected; right behind the barracks, spread over the base
      if (loose() >= 3 && have('brunnen') < P.wells && (have('steinbruch') > 0 || y.stock.stein >= 4) && (!wantKas || y.stock.stein >= costOf('kaserne').stein + 4 || c.done.kaserne)) w.push('brunnen');
      // wood is what everything else is built from: a dry stock calls for another woodcutter before more fields
      if (y.stock.holz < 6 && wc < woodWant() && F >= 2 && !c.wip.holzfaeller && korn >= 8 && wood) w.push('holzfaeller');
      // food: a stock running dry, or fewer fields than the people need
      if ((hungry || korn < 8) && !c.wip.hof && F < needNow + 3 && hands) w.push('hof');
      if (!glut && F < needNow && hands) w.push('hof');
      if (wc < 2 && F >= 1 && (wc === 0 || wood)) w.push('holzfaeller');
      if (!have('kornspeicher') && F >= 5 && wc >= 2) w.push('kornspeicher');   // a granary: the sacks can pile up beyond the keep's 30 and carry the house through a raid
      // housing follows food, except when fields stand unmanned (then people are what is missing); never while hands sit idle
      if ((free <= P.hutAhead || (c.unst > 0 && free <= 3)) && y.idle < 4) {
        if (c.unst === 0 && !glut && F < farmsFor(cap + 4) - 1 && hands) w.push('hof');
        w.push('huette');
      }
      if (wantKas) w.push('kaserne');
      if (wc < woodWant() && wood) w.push('holzfaeller');
      // Phase 2: the Söldnerlager (torch squad, horse archers) and the Markt (gold) once the barracks and the first fields stand
      const stands = c.done.kaserne && F >= 4 && wc >= 2;
      // (only from wood that is not needed for growth: until the stock is comfortable the fields, huts and recruits come first)
      if (P.camp && !have('soeldnerlager') && stands && now >= P.camp && y.stock.holz >= costOf('soeldnerlager').holz + P.spareW) w.push('soeldnerlager');
      if (!have('markt') && stands && now >= P.market && y.stock.holz >= costOf('markt').holz + P.spareW && (!P.camp || have('soeldnerlager') || now >= P.market + 90)) w.push('markt');
      // a second delivery point for wood and stone: shorter trips, and the keep door is not the only crowded place
      if (have('lager') < 1 && wc >= 2 && F >= 3) w.push('lager');
      else if (storeFull() && have('lager') < 2) w.push('lager');
      if (have('wachturm') < Math.min(P.tower, 1 + Math.floor(F / 5)) && c.done.kaserne && F >= 3 && y.stock.stein >= costOf('wachturm').stein + 2) w.push('wachturm');
      // the Torhaus of the wall line, from spare stone only: after the barracks, the first tower and the wells it is what stone is left for (it is never saved for);
      // then a tower beyond each end of the line, also from spare stone
      if (P.walls && plan && !plan.noTor && !torhausBuilt() && now >= P.wallFrom && c.done.kaserne && F >= 5 && have('wachturm') >= 1 && y.stock.stein >= costOf('torhaus').stein + P.torM) w.push('torhaus');
      if (P.walls && plan && torhausBuilt() && have('wachturm') >= P.tower && have('wachturm') < P.tower + plan.towers.length && y.stock.stein >= costOf('wachturm').stein + 12 && towerSpot()) w.push('wachturm');
      return w;
    }
    function economy() {
      const y = c.y, now = c.t;
      const avail = { korn: y.stock.korn, holz: y.stock.holz, stein: y.stock.stein };
      const spend = (cost) => { for (const g of GOODS) avail[g] -= cost[g] || 0; };
      const wip = wipN() - (c.wip.palisade || 0) - (c.wip.mauer || 0), room = wip < 3;   // (a wall piece under construction does not take the fields' and huts' room)
      c.left = null;
      // stuck sites: no progress for a long time → give the plot up (full refund) and avoid the spot
      for (const b of c.mine) {
        if (b.ruined || b.build >= 1) { delete seen[b.id]; continue; }
        const m = seen[b.id] || (seen[b.id] = { t: now, b: b.build });
        if (b.build > m.b + 1e-6 || b.fire > 0.25) { m.b = b.build; m.t = now; }
        else if (now - m.t > 90) {
          const r = sim.cancel(lord, b.id);
          if (r.ok) { stats.cancels++; const fp = fpOf(b); failSpots.push({ i: b.i, j: b.j, w: fp[0], h: fp[1], until: now + 150 }); delete seen[b.id]; }
        }
      }
      // ruins: rebuild for half the cost when it is quiet around them, clear the forgotten ones
      for (const b of c.ruins) {
        const m = seen[b.id] || (seen[b.id] = { t: now, b: 0 });
        const cost = {};
        for (const g of GOODS) cost[g] = Math.ceil((costOf(b.kind, b.len)[g] || 0) * C.REBUILD_COST);
        const ctr = centerOf(b);
        if (REBUILD.indexOf(b.kind) >= 0 && room && affordable(avail, cost) && !foeNear(ctr.x, ctr.y, 14)) {
          const r = sim.build(lord, b.kind, b.i, b.j, b.rot, b.len);
          if (r.ok) { stats.rebuilds++; spend(cost); delete seen[b.id]; break; }
        }
        if (now - m.t > 200) { const r = sim.cancel(lord, b.id); if (r.ok) { stats.cancels++; delete seen[b.id]; } }
      }
      // Starving while fields stand unmanned and every hand has a job: a workplace that does not make food goes (its workers become idle
      // and take the fields). Wood or stone nobody needs right now is the first to give: a surplus woodcutter, then the quarry once the
      // barracks and wells stand. Demolishing costs only what it cost to build.
      if (y.hunger) { if (hungerSince < 0) hungerSince = now; } else hungerSince = -1;
      if (!quarryShed && c.done.kaserne && y.stock.stein >= 18 && (c.done.brunnen || 0) >= 1 && (y.stock.korn < 10 || c.unst > 0) && now - lastValve > 20) {
        const q = c.mine.find(b => b.kind === 'steinbruch' && !b.ruined && b.build >= 1);
        if (q && sim.cancel(lord, q.id).ok) { quarryShed = true; lastValve = now; stats.cancels++; if (trace) trace.push([+now.toFixed(1), 'valve', 'steinbruch', 'shed']); }
      }
      if (hungerSince >= 0 && now - hungerSince > 30 && c.unst > 0 && y.idle === 0 && now - lastValve > 40) {
        const wcs = c.mine.filter(b => b.kind === 'holzfaeller' && !b.ruined && b.build >= 1), qs = c.mine.filter(b => b.kind === 'steinbruch' && !b.ruined && b.build >= 1);
        let victim = null;
        if (wcs.length >= 2 && y.stock.holz >= 8) { wcs.sort((a, b) => (b.noWood ? 1 : 0) - (a.noWood ? 1 : 0)); victim = wcs[0]; }
        else if (qs.length && c.done.kaserne && y.stock.stein >= 6) victim = qs[0];
        else if (wcs.length >= 2) victim = wcs[wcs.length - 1];
        if (victim && sim.cancel(lord, victim.id).ok) { lastValve = now; noWoodUntil = now + 120; stats.cancels++; if (trace) trace.push([+now.toFixed(1), 'valve', victim.kind, 'demolished']); }
      }
      if (!room) return;
      let built = 0, reserved = false;
      c.avail = avail;
      // once the war can begin, some wood stays in the store for rebuilding what a raid burns (a house with no wood cannot even pay for a woodcutter)
      const reserveW = now < 140 ? 2 : 6;
      for (const kind of wants()) {
        if (built >= 2) break;
        const cost = costOf(kind);
        const spare = kind === 'huette' || kind === 'lager' || kind === 'wachturm' || kind === 'markt' || kind === 'soeldnerlager' || kind === 'torhaus' ? reserveW : 0;
        if (!affordable(avail, cost) || (spare && avail.holz - cost.holz < spare)) {
          if (!reserved) { reserved = true; spend(cost); }   // save for the most urgent unaffordable want: lower ones may only use what is left over
          continue;
        }
        if ((c.wip[kind] || 0) > 0 && (kind === 'kaserne' || kind === 'brunnen' || kind === 'wachturm' || kind === 'lager' || kind === 'markt' || kind === 'soeldnerlager' || kind === 'torhaus')) continue;
        if (kind === 'hof' && (c.wip.hof || 0) >= 2) continue;
        c.spent = null;
        const r = place(kind);
        if (r === 'ok') { spend(cost); built++; }
        else if (r === 'granary') { spend(c.spent); built++; }
        else if (r === 'cost' && !reserved) { reserved = true; spend(cost); }
        if (built + wip >= 3) break;
      }
      c.left = avail;   // what the wants leave over (the first want that could not be paid is already reserved): the wall line may use that
    }
    // ---- walls (ritter, kriegsherr): one line across the approach from the nearest crossing ----
    // The line is planned once from the map: the landing of the nearest crossing in my quarter, and the route from there to my gate. At WALL_R from the keep
    // centre the line crosses that route at right angles, with a Torhaus on the route and up to WALL_HALF cells of wall on either side of it (the cells of a side
    // run outward from the Torhaus); a tower stands beyond each end. The plan is made shortly before the wall starts, around what stands then; its ground is kept free
    // of other buildings from then on (`reserve`: from the first minute that cost the fields their best land, 51 % against 74 % wins for the kriegsherr against
    // 3 knappe), and a side ends where something is in the way.
    // The line is open at both ends, so it strands nobody; still, a pocket cut off by it and the terrain could: every plan must pass a flood fill from the keep
    // gate that reaches the door of every building the house has. Palisade pieces go up one at a time from the wood the economy's wants leave over (they do not
    // take the fields' and huts' room for sites); the Torhaus and the end towers only from stone that nothing else wants (stone is what the wells, the ritters and
    // the first towers need: a Torhaus saved for ahead of them cost 25 points of the mixed win rate); Mauer once stone is plentiful.
    let plan;   // undefined = not looked at yet · null = no usable line here · else { rot, ti, tj, pi, pj, sides: [west|north cells, east|south cells], cut, hold, maxLen, towers, res, torFail, noTor }
    let wk0 = null;   // the cells that can be walked at the lowest water level (the most land there ever is)
    const kxOf = (k) => k % GW - 71.5, kyOf = (k) => Math.floor(k / GW) - 44.5;
    const bq = new Int32Array(N), bseen = new Uint8Array(N);
    // flood fill from the keep gate over the walkable cells (the cells in `lane` are the open lanes of Torhaus buildings): does it reach a free cell next to every building of the house?
    function doorsReached(occv, lane) {
      const g = W.keepGate(world, site);
      if (g < 0) return true;
      bseen.fill(0);
      const open = (k) => wk0[k] === 1 && (!occv[k] || lane.has(k));
      let h = 0, t = 0; bq[t++] = g; bseen[g] = 1;
      while (h < t) {
        const k = bq[h++], i = k % GW, j = (k - i) / GW;
        for (let d = 0; d < 8; d++) {
          const ni = i + DX8[d], nj = j + DY8[d];
          if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const nk = nj * GW + ni;
          if (bseen[nk] || !open(nk)) continue;
          if (d >= 4 && (!open(j * GW + ni) || !open(nj * GW + i))) continue;   // (no corner cutting, as everywhere in the sim)
          bseen[nk] = 1; bq[t++] = nk;
        }
      }
      for (const b of st.buildings) {
        if (b.lord !== lord || b.kind === 'bergfried' || b.ruined || WALLK[b.kind] || b.kind === 'torhaus') continue;
        const fp = fpOf(b);
        let ok = false;
        for (let dj = -1; dj <= fp[1] && !ok; dj++) for (let di = -1; di <= fp[0]; di++) {
          if (di >= 0 && di < fp[0] && dj >= 0 && dj < fp[1]) continue;
          const ci = b.i + di, cj = b.j + dj;
          if (ci >= 0 && cj >= 0 && ci < GW && cj < GH && bseen[cj * GW + ci]) { ok = true; break; }
        }
        if (!ok) return false;
      }
      return true;
    }
    // one candidate: the Torhaus around the lane cell (pi, pj) and the wall cells on both sides of it, each checked with the placement rules of the sim
    function evalLine(rot, pi, pj, baseOk, bestN) {
      const sc = new Uint8Array(sim.occ), CODE = W.CODE;
      const toward = rot === 0 ? (keepY < pj - 44.5 ? -1 : 1) : (keepX < pi - 71.5 ? -1 : 1);   // the Torhaus's second row / column lies on the keep's side first
      const opts = rot === 0 ? [[pi - 1, toward < 0 ? pj - 1 : pj], [pi - 1, toward < 0 ? pj : pj - 1]] : [[toward < 0 ? pi - 1 : pi, pj - 1], [toward < 0 ? pi : pi - 1, pj - 1]];
      for (const [ti, tj] of opts) {
        sc.set(sim.occ);
        if (!W.canPlace(world, 'torhaus', ti, tj, rot, { lord: site, L: 0, occ: sc }).ok) continue;
        const fp = W.footprintOf('torhaus', rot), tw = fp[0], th = fp[1];
        for (let dj = 0; dj < th; dj++) for (let di = 0; di < tw; di++) sc[(tj + dj) * GW + ti + di] = CODE.torhaus;
        const sides = [[], []];
        for (let sd = 0; sd < 2; sd++) for (let m = 1; m <= WALL_HALF; m++) {
          const ci = rot === 0 ? (sd === 0 ? ti - m : ti + 2 + m) : pi, cj = rot === 0 ? pj : (sd === 0 ? tj - m : tj + 2 + m);
          if (!W.canPlace(world, 'palisade', ci, cj, 0, { lord: site, L: 0, occ: sc, len: 1 }).ok) break;
          sc[cj * GW + ci] = CODE.palisade;
          sides[sd].push({ i: ci, j: cj });
        }
        if (sides[0].length + sides[1].length <= bestN) continue;   // (no better than what is known: skip the flood fill)
        const lane = new Set(W.laneOf(ti, tj, rot).cells.map(([a, b]) => b * GW + a));
        if (baseOk && !doorsReached(sc, lane)) continue;
        // a tower beyond each end of the line, in line with it (two rows / columns to try)
        const towers = [];
        for (let sd = 0; sd < 2; sd++) {
          const arr = sides[sd], last = arr.length ? arr[arr.length - 1] : null, tries = [];
          if (rot === 0) { const e = last ? last.i : (sd === 0 ? ti : ti + 2), a = sd === 0 ? e - 2 : e + 1; tries.push([a, pj], [a, pj - 1]); }
          else { const e = last ? last.j : (sd === 0 ? tj : tj + 2), b = sd === 0 ? e - 2 : e + 1; tries.push([pi, b], [pi - 1, b]); }
          for (const [a, b] of tries) if (W.canPlace(world, 'wachturm', a, b, 0, { lord: site, L: 0, occ: sc }).ok) { towers.push({ i: a, j: b }); break; }
        }
        return { rot, ti, tj, pi, pj, sides, towers, n: sides[0].length + sides[1].length, tw, th };
      }
      return null;
    }
    function planWalls() {
      const gateK = W.keepGate(world, site);
      if (gateK < 0) return null;
      if (!wk0) { wk0 = new Uint8Array(N); for (let k = 0; k < N; k++) wk0[k] = W.walk(world, k, 0) > 0 ? 1 : 0; }
      const blk = new Uint8Array(N);
      for (let k = 0; k < N; k++) blk[k] = sim.occ[k] ? 1 : 0;
      const G = W.field(world, [gateK], 0, new Float32Array(N), blk);   // walking time to my gate over everything that is walkable
      let land = -1, lt = Infinity;   // the cell of my quarter next to a crossing that is nearest to my gate
      for (const cr of world.crossings) for (const k of cr.cells) {
        const ci = k % GW, cj = (k - ci) / GW;
        for (let d = 0; d < 8; d++) {
          const ni = ci + DX8[d], nj = cj + DY8[d];
          if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const nk = nj * GW + ni;
          if (world.owner[nk] === site && G[nk] < lt) { lt = G[nk]; land = nk; }
        }
      }
      if (land < 0) return null;
      const route = [];   // from the landing down to the gate
      for (let k = land, guard = 0; guard < 600; guard++) {
        route.push(k);
        if (G[k] <= 0) break;
        const ci = k % GW, cj = (k - ci) / GW;
        let bk = -1, bv = G[k];
        for (let d = 0; d < 8; d++) {
          const ni = ci + DX8[d], nj = cj + DY8[d];
          if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const nk = nj * GW + ni;
          if (G[nk] < bv) { bv = G[nk]; bk = nk; }
        }
        if (bk < 0) break;
        k = bk;
      }
      const baseOk = doorsReached(sim.occ, new Set());
      let best = null;
      for (const dR of [0, 2, -2, 4, -4, 6, -6, 8, -8, 10, 12]) {   // the line may sit nearer to the keep or farther out, wherever there is room around what stands now
        let ix = 0;
        while (ix < route.length - 1 && hyp(kxOf(route[ix]) - keepX, kyOf(route[ix]) - keepY) > WALL_R + dR) ix++;
        const a = route[Math.max(0, ix - 4)], b = route[Math.min(route.length - 1, ix + 4)];
        const rot0 = Math.abs(kxOf(b) - kxOf(a)) > Math.abs(kyOf(b) - kyOf(a)) ? 1 : 0;   // the line runs across the way the route goes (the other way round only as a second try)
        const pk = route[ix], pi0 = pk % GW, pj0 = (pk - pi0) / GW;
        for (const rot of [rot0, 1 - rot0]) for (const sh of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
          const cand = evalLine(rot, rot ? pi0 : pi0 + sh, rot ? pj0 + sh : pj0, baseOk, best ? best.n : 5);
          if (cand && (!best || cand.n > best.n)) best = cand;
          if (best && best.n >= 14) break;
        }
        if (best && best.n >= 14) break;
      }
      if (!best || best.n < 6) return null;
      const res = new Set();   // the ground to keep free: the Torhaus, its lane mouths, the wall cells and the tower spots, each with a free cell around it
      const mark = (ci, cj, w, h) => { for (let dj = -1; dj <= h; dj++) for (let di = -1; di <= w; di++) { const a = ci + di, b = cj + dj; if (a >= 0 && b >= 0 && a < GW && b < GH) res.add(b * GW + a); } };
      mark(best.ti, best.tj, best.tw, best.th);
      for (const [ei, ej] of W.laneOf(best.ti, best.tj, best.rot).ends) mark(ei, ej, 1, 1);
      for (const sd of best.sides) for (const q of sd) mark(q.i, q.j, 1, 1);
      for (const t of best.towers) mark(t.i, t.j, 2, 2);
      return Object.assign(best, { cut: [best.sides[0].length, best.sides[1].length], hold: [0, 0], maxLen: [4, 4], res: Int32Array.from(res), torFail: 0, noTor: false });
    }
    const torhausBuilt = () => !!plan && c.mine.some(b => b.kind === 'torhaus' && b.i === plan.ti && b.j === plan.tj);
    function towerSpot() {   // the next tower of the plan that is not standing yet and can be placed now
      if (!plan) return null;
      for (const t of plan.towers) {
        if (c.mine.some(b => b.kind === 'wachturm' && b.i === t.i && b.j === t.j)) continue;
        if (W.canPlace(world, 'wachturm', t.i, t.j, 0, { lord: site, L: c.L, occ: sim.occ }).ok) return { i: t.i, j: t.j, rot: 0 };
      }
      return null;
    }
    const isWallCell = (q) => { const v = sim.occ[q.j * GW + q.i]; return v === W.CODE.palisade || v === W.CODE.mauer; };
    // the next piece of the line: from the Torhaus outward, the two sides in turn, a run of up to maxLen cells that are still free
    function nextPiece() {
      let pick = null;
      for (let sd = 0; sd < 2; sd++) {
        if (plan.hold[sd] > c.t) continue;
        const arr = plan.sides[sd], n = plan.cut[sd];
        let m = 0;
        while (m < n && isWallCell(arr[m])) m++;
        if (m < n && (!pick || m < pick.m)) pick = { sd, m };
      }
      if (!pick) return null;
      const arr = plan.sides[pick.sd], n = plan.cut[pick.sd];
      let len = 1;
      while (len < plan.maxLen[pick.sd] && pick.m + len < n && sim.occ[arr[pick.m + len].j * GW + arr[pick.m + len].i] === 0) len++;
      const first = pick.sd === 0 ? arr[pick.m + len - 1] : arr[pick.m];   // the piece's top-left cell: the outermost cell of the west / north side, the innermost of the other
      return { sd: pick.sd, m: pick.m, len, i: first.i, j: first.j, rot: plan.rot };
    }
    // No room for a line across the approach (a village that has grown over it): a few pieces where the placement rules put the best wall toward the nearest
    // crossing (suggest with a length), each one only if the flood fill still reaches every door.
    let stubT = -99;
    function stubWall(stock) {
      let n = 0;
      for (const b of c.mine) if (b.kind === 'palisade' || b.kind === 'mauer') n++;
      if (n >= 3 || stock.holz - 4 < 12 || c.t - stubT < 20) return;
      stubT = c.t;
      const sp = W.suggest(world, 'palisade', site, { L: c.L, occ: currentOcc(), len: 4 });
      if (!sp) return;
      const fp = W.footprintOf('palisade', sp.rot, 4), sc = new Uint8Array(sim.occ);
      for (let dj = 0; dj < fp[1]; dj++) for (let di = 0; di < fp[0]; di++) sc[(sp.j + dj) * GW + sp.i + di] = W.CODE.palisade;
      if (!wk0) { wk0 = new Uint8Array(N); for (let k = 0; k < N; k++) wk0[k] = W.walk(world, k, 0) > 0 ? 1 : 0; }
      if (!doorsReached(sc, new Set())) { failSpots.push({ i: sp.i, j: sp.j, w: fp[0], h: fp[1], until: c.t + 120 }); return; }
      const r = sim.buildWall(lord, 'palisade', [[sp.i, sp.j, sp.rot, 4]]);
      if (r.ok) { stats.builds++; stats.wallPieces++; c.wip.palisade = (c.wip.palisade || 0) + 1; stock.holz -= 4; }
      else if (r.reason !== 'cost') failSpots.push({ i: sp.i, j: sp.j, w: fp[0], h: fp[1], until: c.t + 120 });
    }
    function walls() {
      if (!P.walls) return;
      if (plan === undefined || c.t < P.wallFrom || !c.done.kaserne || (c.done.hof || 0) < 4 || c.y.hunger || !c.left || wipN() - (c.wip.palisade || 0) - (c.wip.mauer || 0) >= 2 || (c.wip.palisade || 0) + (c.wip.mauer || 0) >= 1) return;   // one piece at a time, and the other sites come first
      const stock = Object.assign({}, c.left);   // only what the economy's wants leave over
      if (plan === null) { stubWall(stock); return; }
      for (let n = 0; n < 1; n++) {
        const pc = nextPiece();
        if (!pc) break;
        const stoneRich = torhausBuilt() && (c.done.wachturm || 0) >= Math.min(2, P.tower) && stock.stein >= 30 + 2 * pc.len;   // stone to spare: the Wehrgang wall
        const kind = stoneRich ? 'mauer' : 'palisade', cost = costOf(kind, pc.len);
        if (!affordable(stock, cost) || (kind === 'palisade' && stock.holz - cost.holz < 12)) break;
        const r = sim.buildWall(lord, kind, [[pc.i, pc.j, pc.rot, pc.len]]);   // (the wall API: one piece of the line at a time)
        if (r.ok) { stats.builds++; stats.wallPieces++; c.wip[kind] = (c.wip[kind] || 0) + 1; stock.holz -= cost.holz; stock.stein -= cost.stein; if (trace) trace.push([+c.t.toFixed(1), kind, 'wall', pc.len]); continue; }
        if (r.reason === 'cost') break;
        stats.buildFails++;
        if (trace) trace.push([+c.t.toFixed(1), kind, 'wall-' + r.reason, pc.len, pc.i, pc.j, pc.rot]);
        if (r.reason === 'wet') plan.hold[pc.sd] = c.t + 20;   // not dry yet
        else if (pc.len > 1) plan.maxLen[pc.sd] = 1;           // a long run does not fit: single cells
        else plan.cut[pc.sd] = pc.m;                           // something stands there: the side ends before this cell
      }
    }

    // ---- the Markt: sell what the full stores would waste, buy 🌾 when hungry ----
    let lastTrade = -99, ramNeedUntil = -99;
    const PRICE = C.TRADE_PRICE, PACK = C.TRADE_PACK;
    function pendingStone() {   // stone the next wants will ask for
      let n = c.done.kaserne ? 0 : costOf('kaserne').stein;
      if (P.walls && plan && !plan.noTor && !torhausBuilt()) n += costOf('torhaus').stein;
      if (P.tower > have('wachturm')) n += costOf('wachturm').stein;
      return n + 6;
    }
    function goldNeed() {   // gold the next recruits want: the torch squad when its sortie is near, a ram that is waiting for gold
      let need = 0;
      if (P.raid && bn[3].mode === 'home' && c.done.soeldnerlager && fehdeAt !== -1 && c.t >= fehdeAt + P.raidAfter - 45)
        need += Math.max(0, (bn[3].raids === 0 ? P.probe : P.raid) - bannerCount(3) - queued(3)) * (unitCost('fackel').gold || 0);
      if (ramNeedUntil > c.t) need += unitCost('ramme').gold || 0;
      return need;
    }
    function trading() {
      if (!c.done.markt || c.t - lastTrade < 3) return;
      const y = c.y, stock = y.stock, cap = y.cap, people = c.people, gold = stock.gold;
      const trade = (good, side, packs) => {
        const r = sim.trade(lord, good, side, packs);
        if (!r.ok) return;
        stats.trades++; lastTrade = c.t;
        if (side === 'sell') stats.goldIn += r.n * PRICE.sell[good]; else stats.goldOut += r.n * PRICE.buy[good];
      };
      // hungry, or about to be: buy 🌾 (and never sell any then)
      if (y.hunger || (P.foresight && ((stock.korn <= 4 && people >= 8) || (stock.korn < 8 && y.food.prod < y.food.eat)))) {   // (the knappe only notices hunger when it has it)
        const n = Math.min(Math.floor(gold / PRICE.buy.korn), 2, Math.floor((cap.korn - stock.korn) / PACK));
        if (n >= 1) trade('korn', 'buy', n);
        return;
      }
      // sell a good that is nearly at its cap (its workplaces would rest), down to 60 %, and, when the next recruits want gold, whatever is above the reserve
      const need = goldNeed(), reserve = { korn: Math.max(14, 8 + people / 4), holz: 24, stein: 14 + pendingStone() };
      let best = null;
      for (const g of GOODS) {
        const sur = stock[g] - reserve[g];
        if (sur < PACK) continue;
        const full = stock[g] >= 0.78 * cap[g];
        if (!full && !(g !== 'stein' && gold < need)) continue;
        const score = full ? stock[g] / cap[g] : sur / cap[g];
        if (!best || score > best.score) best = { g, sur, full, score };
      }
      if (!best) return;
      let packs = Math.floor(best.sur / PACK);
      if (best.full) packs = Math.min(packs, Math.max(1, Math.floor((stock[best.g] - 0.6 * cap[best.g]) / PACK)));
      else packs = Math.min(packs, Math.ceil((need - gold) / PRICE.sell[best.g]));
      if (packs >= 1) trade(best.g, 'sell', packs);
    }

    // an enemy soldier within r of a point
    function foeNear(x, y, r) {
      for (const u of st.units) if (u.lord !== lord && u.kind !== 'bauer' && u.hp > 0 && !c.pact[u.lord] && hyp(u.x - x, u.y - y) <= r) return true;
      return false;
    }

    // ---- recruiting ----
    function slots() {   // hands the work needs: every worker slot (built or planned) plus builders for the sites under way
      let n = 0;
      for (const k of ['hof', 'holzfaeller', 'steinbruch']) n += have(k) * (C.BUILD[k].workers || 0);
      return n + Math.min(2, wipN());
    }
    const GUARD = ['bogen', 'speer', 'speer', 'bogen', 'speer', 'bogen'];   // archers shoot torch-bearers down; spears hold the door (the archers climb into towers, so two spears come early)
    function pickUnit(avail, forBurg) {
      if (forBurg) {
        const k = GUARD[bannerCount(0) + queued(0)] || (bannerCount(0) % 2 ? 'speer' : 'bogen');
        if (affordable(avail, unitCost(k))) return k;
      }
      const shares = {}, cnt = {};
      let tot = 0;
      for (const k in P.mix) {
        if (k === 'ritter' && !P.knights) continue;
        if ((k === 'fackel' || k === 'reiterschuetze') && !c.done.soeldnerlager) continue;   // the camp's units need a Söldnerlager (and gold)
        shares[k] = P.mix[k]; tot += P.mix[k]; cnt[k] = 0;
      }
      let n = 0;
      for (const u of st.units) if (u.lord === lord && u.kind !== 'bauer' && u.kind !== 'ramme') { if (cnt[u.kind] !== undefined) cnt[u.kind]++; n++; }
      for (const q of c.y.queue) if (q.unit !== 'ramme') { if (cnt[q.unit] !== undefined) cnt[q.unit]++; n++; }
      const order = Object.keys(shares).sort((a, b) => (shares[b] / tot * (n + 1) - cnt[b]) - (shares[a] / tot * (n + 1) - cnt[a]));
      for (const k of order) {
        if (forBurg && k === 'fackel') continue;                  // torch-bearers never guard
        if (affordable(avail, unitCost(k))) return k;
      }
      return null;
    }
    function bannerCount(n) { const b = c.banners[n]; return b ? b.count : 0; }
    function queued(n) { let q = 0; for (const e of c.y.queue) if (e.n === n) q++; return q; }
    // which banner gets the next recruit, and what kind: the raiding squad of torch-bearers, the Burgwache, then the banners one after the other
    let guardN = -1, guardT = 0;   // when the Burgwache last grew: a queue entry that never completes must not hold its place for ever
    // Phase 2: the archers of the Burgwache climb into free slots of the towers and walls near the keep by themselves and then no longer stand at the gate. The guard
    // keeps its size, but its units alternate so that the spears (who hold the door) are not the last to come: see GUARD. The torch squad needs the guard on the ground.
    function groundGuard() { let n = 0; for (const u of st.units) if (u.lord === lord && u.n === 0 && u.kind !== 'bauer' && u.hp > 0 && !u.on) n++; return n; }
    function nextRecruit() {
      const nowG = bannerCount(0);
      if (nowG !== guardN) { guardN = nowG; guardT = c.t; }
      const g = nowG + (c.t - guardT > 60 ? 0 : queued(0));
      if (g < Math.min(2, P.burg)) return { n: 0, guard: true };
      const sq = bn[3];
      if (P.raid && bn[3].mode === 'home') {
        const army = bannerCount(1) + bannerCount(2) + queued(1) + queued(2);
        const want = sq.raids === 0 ? P.probe : (g >= P.burg && army >= P.thr * 0.8 ? P.raid : 0);   // the first sortie is a probe; later squads only once the guard is full and the field army nearly ready
        // (since Phase 2 the torch-bearer is trained at the Söldnerlager for gold: a bot without both has no torch squad)
        if (bannerCount(3) + queued(3) < want && c.done.soeldnerlager && affordable(c.y.stock, unitCost('fackel'))) return { n: 3, unit: 'fackel', guard: true };
      }
      if (g < P.burg) return { n: 0, guard: true };
      const cap = Math.round(P.thr * 1.5);
      for (const k of [1, 2]) {
        if (bn[k].mode === 'home' && bannerCount(k) + queued(k) < cap) return { n: k };
        if (bn[k].mode === 'home' && bannerCount(k) < P.thr) break;   // fill this banner before the next
      }
      if (bannerCount(0) + queued(0) < P.burg + 4) return { n: 0 };    // everybody is away: strengthen the guard
      return null;
    }
    function recruiting() {
      if (!c.done.kaserne || c.y.hunger) return;
      const y = c.y;
      let q = y.queue.length;
      if (q >= 3) return;
      const base = { korn: y.stock.korn, holz: y.stock.holz, stein: y.stock.stein, gold: y.stock.gold };
      for (let g = 0; g < 3 && q < 3; g++) {
        const nr = nextRecruit();
        if (!nr) return;
        // the guard may use every sack; the field army leaves a reserve so that training does not starve the house. Gold: the torch squad uses it all,
        // the rest leaves what the next torch squad or a ram is waiting for
        const avail = { korn: base.korn - (nr.guard ? 5 : 4 + c.people / 12), holz: base.holz - (nr.guard ? 0 : 4), stein: base.stein, gold: base.gold - (nr.unit === 'fackel' ? 0 : goldNeed()) };
        // The sim draws a recruit from the nearest working peasant when nobody is idle, and that is usually a farmer: his field then stands
        // unmanned and the house starves. So soldiers only come from hands that no workplace needs.
        if (c.peasants - q - 1 < Math.max(C.PEASANT_MIN, slots() + P.spare)) return;
        const unit = nr.unit || pickUnit(avail, nr.n === 0);
        if (!unit || !affordable(avail, unitCost(unit))) return;
        const r = sim.recruit(lord, unit, nr.n);
        if (!r.ok) return;
        stats.recruits++; q++;
        const cost = unitCost(unit);
        for (const x of GOODS) base[x] -= cost[x] || 0;
        base.gold -= cost.gold || 0;
        c.y.queue.push({ unit, n: nr.n, p: 0 });
      }
    }

    // ---- travel times ----
    // The travel field of a banner from a start cell, as the sim computes it for the banners of this house (cached for a few seconds): every building blocks, but my
    // Torhaus lanes (and a partner's) are open, a ruined wall piece is passable rubble, and an enemy wall piece or Torhaus is passable at the breach price (BREACH_COST
    // times its kind's factor), so the cheapest way into a walled house leads through its cheapest wall. F = that field; U = the same field without breaking any wall
    // (null when no enemy wall stands): a cell with F below U can only be reached by breaking a wall.
    const Bu = new Uint8Array(N), Bb = new Uint8Array(N), Xc = new Float32Array(N), pieceAt = new Map();
    let fl = null, flT = -99, flL = -1, flFrom = -1;
    function breachMasks() {
      const occ = sim.occ, foe = [];
      for (let k = 0; k < N; k++) Bu[k] = occ[k] ? 1 : 0;
      for (const b of st.buildings) {
        if (!WALLK[b.kind] && b.kind !== 'torhaus') continue;
        const fp = fpOf(b), friendly = b.lord === lord || c.pact[b.lord];
        const lane = b.kind === 'torhaus' && friendly && !b.ruined && b.build >= 1 ? W.laneOf(b.i, b.j, b.rot).cells.map(([a, d]) => d * GW + a) : null;
        for (let dj = 0; dj < fp[1]; dj++) for (let di = 0; di < fp[0]; di++) {
          const k = (b.j + dj) * GW + b.i + di;
          if (b.ruined || (lane && lane.indexOf(k) >= 0)) Bu[k] = 0;   // rubble, an open lane
          else if (!friendly) foe.push(k, b);
        }
      }
      Bb.set(Bu); Xc.fill(0); pieceAt.clear();
      for (let n = 0; n < foe.length; n += 2) { const k = foe[n], b = foe[n + 1]; Bb[k] = 0; Xc[k] = C.BREACH_COST * (C.BREACH_MUL[b.kind] || 1); pieceAt.set(k, b); }
      return foe.length > 0;
    }
    function fieldsFrom(k0) {
      const lv = Math.round(c.L * 100);
      if (fl && flFrom === k0 && flL === lv && c.t - flT < 8) return fl;
      const any = breachMasks();
      const F = W.field(world, [k0], c.L, fl ? fl.F : new Float32Array(N), Bb, any ? Xc : undefined);
      const U = any ? W.field(world, [k0], c.L, fl && fl.U ? fl.U : new Float32Array(N), Bu) : null;
      fl = { F, U, any }; flFrom = k0; flL = lv; flT = c.t;
      return fl;
    }
    // the enemy wall pieces on the cheapest way to cell k (walk down the field from there)
    function routePieces(f, k) {
      const out = [], F = f.F;
      let v = F[k];
      for (let guard = 0; guard < 700 && v > 0 && v < Infinity; guard++) {
        const pc = pieceAt.get(k);
        if (pc && out.indexOf(pc) < 0) out.push(pc);
        const ci = k % GW, cj = (k - ci) / GW;
        let bk = -1, bv = v;
        for (let d = 0; d < 8; d++) {
          const ni = ci + DX8[d], nj = cj + DY8[d];
          if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const nk = nj * GW + ni;
          if (F[nk] < bv) { bv = F[nk]; bk = nk; }
        }
        if (bk < 0) break;
        k = bk; v = bv;
      }
      return out;
    }
    const cellOf = (x, y) => W.cellOf(x, y);
    // cheapest free cell around a building (approach side) and its travel time
    function approach(b, F) {
      const fp = fpOf(b), w = fp[0], h = fp[1];
      let best = Infinity, bk = -1;
      for (let dj = -1; dj <= h; dj++) for (let di = -1; di <= w; di++) {
        if (di >= 0 && di < w && dj >= 0 && dj < h) continue;
        const ci = b.i + di, cj = b.j + dj;
        if (ci < 0 || cj < 0 || ci >= GW || cj >= GH) continue;
        const k = cj * GW + ci, v = F[k];
        if (v < best) { best = v; bk = k; }
      }
      return { t: best, k: bk };
    }

    // ---- campaign: attack, retreat, defend ----
    function scanThreat() {
      threat = null;
      if (!c.keep) return;
      let sx = 0, sy = 0, n = 0, keepN = 0, zone = 24;   // the zone: the keep's reach, or my farthest building plus the alarm distance
      for (const b of c.mine) { const q = centerOf(b), d = hyp(q.x - keepX, q.y - keepY) + 10; if (d > zone) zone = d; }
      for (const u of st.units) {
        if (u.lord === lord || u.kind === 'bauer' || u.hp <= 0 || c.pact[u.lord]) continue;
        if (Math.abs(u.x - keepX) > zone || Math.abs(u.y - keepY) > zone) continue;
        let near = hyp(u.x - keepX, u.y - keepY) <= 20;
        if (near) keepN++;
        else for (const b of c.mine) {
          if (b.ruined) continue;
          const q = centerOf(b);
          if (hyp(u.x - q.x, u.y - q.y) <= 9) { near = true; break; }
        }
        if (near) { sx += u.x; sy += u.y; n++; }
      }
      if (n > 0) threat = { n, keepN, x: sx / n, y: sy / n };
    }
    // the own tower, gatehouse or wall with a free slot that is nearest to the enemies, if one is within reach of them: defending archers go up there (a garrison order)
    function garrisonSpot(t) {
      let best = null, bd = 13;
      for (const b of c.mine) {
        if (b.ruined || b.build < 1) continue;
        const cap = (C.SLOTS[b.kind] || 0) * (b.kind === 'mauer' ? (b.len || 1) : 1);
        if (!cap || (b.garrison || 0) >= cap) continue;
        const q = centerOf(b), d = hyp(q.x - t.x, q.y - t.y);
        if (d < bd) { bd = d; best = q; }
      }
      return best;
    }
    function defendersAtHome() {
      let n = bannerCount(0);
      for (const k of [1, 2, 3]) if (bn[k].mode === 'home' || bn[k].def) n += bannerCount(k);
      return n;
    }
    const orderTo = (n, x, y) => sim.banner(lord, n, x, y);
    function sendHome(n) {
      const h = homePos(n), s = bn[n];
      orderTo(n, h.x, h.y);
      s.mode = 'retreat'; s.def = false; s.cool = c.t + (n === 3 ? RAID_COOL : 12);
    }
    function pickHouse(from, n) {
      const F = fieldsFrom(cellOf(from.x, from.y)).F, s = bn[n];
      let best = null, bs = Infinity;
      for (const l of c.foes) {
        if ((hits.get(l.i) || 0) > c.t || (s.noHouse.get(l.i) || 0) > c.t) continue;
        const ls = world.sites[l.site], lo = l.site < 2 ? 1 : -1;
        const g = cellOf(ls.x + 0.5, ls.y + 3.5 * lo), tt = g >= 0 ? F[g] : Infinity;
        if (!(tt < Infinity)) continue;
        let score = tt;
        if (P.aim === 'crown' || P.aim === 'weak') { if (l.crown) score -= 1000; }
        if (P.aim === 'weak') score += (l.soldiers * 4 + l.people) * 1.5;
        if (focus.house === l.i && focus.until > c.t) score -= 40;
        if (P.mist > 0 && rng() < P.mist) score += 60;
        if (score < bs) { bs = score; best = l; }
      }
      return best;
    }
    // next thing to hit in a house: wooden economy first (fields, huts), then the military buildings, the keep last
    function pickBuilding(house, n, from) {
      const f = fieldsFrom(cellOf(from.x, from.y)), F = f.F, s = bn[n];
      let best = null, bs = Infinity;
      for (const b of st.buildings) {
        if (b.lord !== house.i || b.ruined || b.kind in WALLK) continue;   // (a wall is broken where it bars the way, not aimed at)
        if ((s.skip.get(b.id) || 0) > c.t) continue;
        const isKeep = b.kind === 'bergfried';
        if (isKeep && house.prot > 0) continue;
        if (n === 3 && !(b.kind in WOODEN)) continue;   // torch-bearers: only what burns
        const a = approach(b, F);
        if (!(a.t < Infinity)) continue;
        if (n === 3 && f.U && !(f.U[a.k] - a.t < 0.5)) continue;   // torch-bearers break no wall: only targets they can reach without
        let score = a.t;
        if (n === 3) score += (b.kind === 'hof' ? 0 : 25) + (wellCovers(house.i, b) ? 45 : 0);
        else if (isKeep) score += s.razed >= P.keep ? -500 : 400;   // the edge first, then the keep
        else if (b.kind in ECON) score += (b.kind === 'hof' ? 0 : 6) + ECON[b.kind];
        else score += 60 + (MIL[b.kind] || 0);
        if (score < bs) { bs = score; best = { b, a }; }
      }
      return best;
    }
    // is the building within a finished Brunnen's reach (its bucket chain puts out a torch within seconds)?
    function wellCovers(houseI, b) {
      const q = centerOf(b), hl = st.lords.find(l => l.i === houseI), hs = hl && world.sites[hl.site];
      if (hs && hyp(hs.x - q.x, hs.y - q.y) <= C.KEEP_WELL_R) return true;   // the keep is a well, too (R6)
      for (const o of st.buildings) {
        if (o.lord !== houseI || o.kind !== 'brunnen' || o.ruined || o.build < 1) continue;
        const r = centerOf(o);
        if (hyp(r.x - q.x, r.y - q.y) <= C.BUCKET_R) return true;
      }
      return false;
    }
    // ---- walls in the way: rams and melee ----
    const ramIn = (n) => { for (const u of st.units) if (u.lord === lord && u.n === n && u.kind === 'ramme' && u.hp > 0) return true; return false; };
    const meleeIn = (n) => { let k = 0; for (const u of st.units) if (u.lord === lord && u.n === n && u.hp > 0 && (u.kind === 'speer' || u.kind === 'ritter')) k++; return k; };
    const archersIn = (n) => { let k = 0; for (const u of st.units) if (u.lord === lord && u.n === n && u.hp > 0 && u.kind === 'bogen') k++; return k; };
    // order a Rammbock for banner n from the Kaserne: 'wait' (ordered, or on its way: the banner waits for it) | 'poor' (not now: no gold, no free hands) | 'no' (this bot sieges without)
    function wantRam(n) {
      if (!P.ram || !c.done.kaserne) return 'no';
      const y = c.y, q = y.queue.length, cost = unitCost('ramme');
      if (y.queue.some(e => e.unit === 'ramme' && e.n === n)) return 'wait';
      if (q >= 3 || c.peasants - q - 1 < Math.max(C.PEASANT_MIN, slots() + P.spare)) return 'poor';
      if (!affordable(y.stock, cost)) { ramNeedUntil = c.t + 60; return 'poor'; }   // (the Markt sells goods for the gold: goldNeed)
      if (!sim.recruit(lord, 'ramme', n).ok) return 'poor';
      stats.rams++; stats.recruits++; c.y.queue.push({ unit: 'ramme', n, p: 0 });
      if (trace) trace.push([+c.t.toFixed(1), 'ram', n]);
      return 'wait';
    }
    // hit points (as shares) of the enemy wall pieces near a banner: a breach is under way while they fall
    function wallHpNear(x, y) {
      let t = 0;
      for (const b of st.buildings) { if (b.lord === lord || b.ruined || !(b.kind in WALLK || b.kind === 'torhaus')) continue; const q = centerOf(b); if (hyp(q.x - x, q.y - y) <= 10) t += b.hp; }
      return t;
    }
    // a banner that moves, or breaks a wall near it, makes progress (a ram marches slowly and a breach takes a while)
    function progress(s, g) {
      if (hyp(g.x - s.px, g.y - s.py) >= 1.5) { s.px = g.x; s.py = g.y; s.prog = c.t; }
      const wh = wallHpNear(g.x, g.y);
      if (wh < s.wallHp - 1e-6) s.prog = c.t;
      s.wallHp = wh;
    }
    function launch(n) {
      const g = c.banners[n], s = bn[n], from = { x: g.x, y: g.y };
      const house = pickHouse(from, n);
      if (!house) { why.launch = 'nohouse@' + c.t.toFixed(0); return false; }
      const pk = pickBuilding(house, n, from);
      if (!pk) { hits.set(house.i, c.t + 30); why.launch = 'nobuilding@' + c.t.toFixed(0); return false; }
      if (P.smart && n !== 3) {   // do not march into a bigger army: the target's soldiers near its keep plus its guard
        let def = 0;
        for (const u of st.units) if (u.lord === house.i && u.kind !== 'bauer') def++;
        if (g.count < Math.max(P.thr, def * 0.7)) return false;
      }
      // walls on the cheapest way there: a stone wall or a gate needs a ram (ordered, and the banner waits for it); a wooden one melee soldiers; an archers-only banner
      // never goes against a wall (its arrows do nothing to stone). Where that is not to be had the banner looks for a house that is easier to reach.
      const f = fieldsFrom(cellOf(from.x, from.y)), pcs = f.any ? routePieces(f, pk.a.k) : [];
      if (pcs.length) {
        if (n === 3) { s.noHouse.set(house.i, c.t + 30); return false; }   // the torch squad breaks nothing (pickBuilding does not offer such a target)
        const ram = ramIn(n), stone = pcs.some(b => b.kind !== 'palisade');
        if (stone && !ram) {
          if (wantRam(n) === 'wait') { why.launch = 'ram@' + c.t.toFixed(0); return false; }
          s.noHouse.set(house.i, c.t + 40); why.launch = 'noram@' + c.t.toFixed(0); return false;
        }
        if (!ram && meleeIn(n) < 4) { s.noHouse.set(house.i, c.t + 40); why.launch = 'nomelee@' + c.t.toFixed(0); return false; }
        if (trace) trace.push([+c.t.toFixed(1), 'walls', n, pcs.map(b => b.kind).join(), ram ? 'ram' : '-']);
      }
      const p = W.cellXY(pk.a.k);
      const r = orderTo(n, p.x, p.y);
      if (!r.ok) { hits.set(house.i, c.t + 40); return false; }
      if (r.reason === 'unreachable') { hits.set(house.i, c.t + 40); sendHome(n); return false; }
      Object.assign(s, { mode: 'march', house: house.i, bid: pk.b.id, tx: r.x, ty: r.y, peak: g.count, t0: c.t, prog: c.t, hpMark: 2, def: false, razed: 0, px: g.x, py: g.y, wallHp: wallHpNear(g.x, g.y) });
      if (pcs.length) stats.sieges++;
      if (trace) trace.push([+c.t.toFixed(1), 'launch', n, g.count, house.i, pk.b.kind]);
      focus = { house: house.i, until: c.t + 60 };
      stats.attacks++; stats.targets++;
      if (n === 3) { s.raids++; stats.raids++; }
      return true;
    }
    // the next building of a house that this banner can get to: one behind a stone wall is skipped for a while when the banner has no ram
    function pickReachable(house, n, from) {
      for (let tries = 0; tries < 6; tries++) {
        const pk = pickBuilding(house, n, from);
        if (!pk) return null;
        const f = fieldsFrom(cellOf(from.x, from.y)), pcs = f.any ? routePieces(f, pk.a.k) : [];
        if (pcs.some(b => b.kind !== 'palisade') && !ramIn(n)) { bn[n].skip.set(pk.b.id, c.t + 90); continue; }
        return pk;
      }
      return null;
    }
    function advance(n) {   // the banner finished its building: the next one in the same house, else another house, else home
      const g = c.banners[n], s = bn[n], house = st.lords.find(l => l.i === s.house);
      { const done = st.buildings.find(x => x.id === s.bid); if (!done || done.ruined) s.razed++; }
      if (!house || c.pact[house.i]) { sendHome(n); return; }
      const pk = pickReachable(house, n, { x: g.x, y: g.y });
      if (!pk) {
        hits.set(house.i, c.t + 25);
        const other = pickHouse({ x: g.x, y: g.y }, n);
        if (other && other.i !== house.i) { const p2 = pickReachable(other, n, { x: g.x, y: g.y }); if (p2) { go(n, other, p2); return; } }
        sendHome(n); return;
      }
      if (trace) trace.push([+c.t.toFixed(1), 'next', n, house.i, pk.b.kind]);
      go(n, house, pk);
    }
    function go(n, house, pk) {
      const s = bn[n], g = c.banners[n], p = W.cellXY(pk.a.k);
      const r = orderTo(n, p.x, p.y);
      if (!r.ok || r.reason === 'unreachable') { s.skip.set(pk.b.id, c.t + 60); if (r.reason === 'unreachable') sendHome(n); return; }
      s.house = house.i; s.bid = pk.b.id; s.tx = r.x; s.ty = r.y; s.prog = c.t; s.hpMark = 2; s.px = g.x; s.py = g.y; s.wallHp = wallHpNear(g.x, g.y);
      s.mode = hyp(g.x - r.x, g.y - r.y) <= 5 ? 'siege' : 'march';
    }
    // soldiers a banner needs before it marches; the raiding squad (banner 3) first sends a probe of two, later a full squad
    function need(n) { return n === 3 ? (bn[3].raids === 0 ? P.probe : Math.max(2, P.raid - 1)) : P.thr; }
    // the full squad only leaves a house that stands guard: a full Burgwache and some soldiers in the banners
    const raidOpen = () => fehdeAt !== -1 && c.t >= fehdeAt + P.raidAfter;   // the torch squad may leave: RAID_AFTER_S after the Fehde began (-1: not seen yet)
    const torchIn = (n) => { for (const u of st.units) if (u.lord === lord && u.n === n && u.kind === 'fackel' && u.hp > 0) return true; return false; };
    function launchOk(n) {
      if (n !== 3) return !P.raid || raidOpen() || !torchIn(n);   // a field banner with a torch-bearer in it waits, too (the knappe never raids: no delay)
      if (!P.raid || !raidOpen()) return false;
      if (bn[3].raids === 0) return groundGuard() >= Math.min(2, P.burg);
      return groundGuard() >= P.burg && bannerCount(1) + bannerCount(2) >= 3;
    }
    function campaign() {
      const fehde = c.phase === 'fehde';
      scanThreat();
      if (threat) calmSince = 0; else if (calmSince === 0) calmSince = c.t;
      const dfn = defendersAtHome();
      for (let n = 1; n <= 3; n++) {
        const g = c.banners[n], s = bn[n];
        if (!g || g.count === 0) {   // no soldiers: the banner is at rest (a banner that died out starts over at its post)
          if (s.mode !== 'home') { s.mode = 'home'; s.def = false; if (n === 3) s.cool = c.t + RAID_COOL; }
          continue;
        }
        const h = homePos(n);
        const tgtHome = hyp(g.tx - h.x, g.ty - h.y) <= 20 || hyp(g.tx - gate.x, g.ty - gate.y) <= 14 || nearOwn(g.tx, g.ty);   // (an order onto an own wall or tower is a garrison order)
        const atHome = hyp(g.x - h.x, g.y - h.y) <= 10;
        // reconcile with orders that did not come from us (a plunder sent the banners home, a human gave an order before the takeover)
        if ((s.mode === 'march' || s.mode === 'siege') && tgtHome) { s.mode = 'retreat'; s.cool = c.t + 12; }
        else if (s.mode === 'home' && !tgtHome && !s.def) {
          const house = nearestHouseTo(g.tx, g.ty);
          if (house) { Object.assign(s, { mode: 'siege', house: house.i, bid: -1, tx: g.tx, ty: g.ty, peak: g.count, t0: c.t, prog: c.t, hpMark: 2 }); }
          else sendHome(n);
        }
        if (s.mode !== 'home' && s.mode !== 'retreat' && g.count > s.peak) s.peak = g.count;
        // defence: enemies near the buildings (the raiding squad never defends)
        if (n === 3) { /* raiders go out and come back */ }
        else if (threat && (threat.keepN > 0 || threat.n >= 2)) {
          if (s.mode === 'home' || s.def) {
            const gs = P.garrison && archersIn(n) >= 2 ? garrisonSpot(threat) : null, tx = gs ? gs.x : threat.x, ty = gs ? gs.y : threat.y;
            if (!s.def || hyp(g.tx - tx, g.ty - ty) > 6) { orderTo(n, tx, ty); stats.defends++; if (gs) stats.garrisons++; }
            s.def = true; s.mode = 'home';
            continue;
          }
          if ((s.mode === 'march' || s.mode === 'siege') && threat.keepN >= 2 && threat.n > dfn * 1.1 + 1) { sendHome(n); stats.retreats++; continue; }
        } else if (s.def && c.t - calmSince > 5) { const hp = homePos(n); orderTo(n, hp.x, hp.y); s.def = false; }
        if (s.mode === 'home') {
          if (fehde && !s.def && c.t >= s.cool && atHome && g.count >= need(n) && launchOk(n) && launch(n)) continue;
        } else if (s.mode === 'retreat') {
          if (atHome || c.t > s.cool + 40) { s.mode = 'home'; s.cool = c.t + 10; }
        } else {   // march or siege
          if (g.count < s.peak * P.retreat || g.count <= (n === 3 ? 0 : 2)) { if (trace) trace.push([+c.t.toFixed(1), 'retreat', n, g.count, s.peak]); sendHome(n); stats.retreats++; continue; }
          const house = st.lords.find(l => l.i === s.house);
          if (!house || c.pact[s.house]) { sendHome(n); continue; }
          const b = st.buildings.find(x => x.id === s.bid);
          if (s.mode === 'march') {
            if (!b || b.ruined) { advance(n); continue; }
            if (hyp(g.x - g.tx, g.y - g.ty) <= 5) { s.mode = 'siege'; s.prog = c.t; s.hpMark = b.hp; }
            else { progress(s, g); if (c.t - s.prog > 70) { s.skip.set(s.bid, c.t + 60); advance(n); } }   // (no step forward and no wall giving way for 70 s: stuck, try something else)
          } else {
            if (!b || b.ruined || (b.kind === 'bergfried' && house.prot > 0)) { advance(n); continue; }
            if (b.hp < s.hpMark - 1e-6) { s.hpMark = b.hp; s.prog = c.t; }
            else if (c.t - s.prog > 45) { s.skip.set(s.bid, c.t + 90); advance(n); }
          }
        }
      }
    }
    function nearOwn(x, y) { for (const b of c.mine) { if (b.ruined) continue; const q = centerOf(b); if (hyp(q.x - x, q.y - y) <= 4) return true; } return false; }
    function nearestHouseTo(x, y) {
      let best = null, bd = 1e9;
      for (const l of st.lords) {
        if (l.i === lord) continue;
        const s2 = world.sites[l.site], d = hyp(s2.x - x, s2.y - y);
        if (d < bd) { bd = d; best = l; }
      }
      return best;
    }

    // ---- pacts: never offer, never break; answer offers ----
    function pacts() {
      for (const p of c.y.pacts) {
        if (p.state !== 'incoming') continue;
        const from = st.lords.find(l => l.i === p.with);
        if (!from) continue;
        // accept from a stronger house, or while somebody else is at our throat
        let fought = false;
        if (threat) for (const u of st.units) if (u.lord !== lord && u.lord !== from.i && u.kind !== 'bauer' && u.hp > 0 && hyp(u.x - threat.x, u.y - threat.y) <= 14) { fought = true; break; }
        const stronger = from.soldiers > c.soldiers;
        const r = sim.pact(lord, from.i, stronger || fought);
        if (stronger || fought) { if (r.ok) stats.pactYes++; } else stats.pactNo++;
      }
    }

    // ---- one decision ----
    function think() {
      if (!look()) return;
      stats.thinks++;
      if (P.walls && plan === undefined && c.t >= P.wallFrom - 30) plan = planWalls();   // (shortly before the wall starts, around what stands by then)
      learnFood();
      updateFieldPost();
      scanThreat();
      pacts();
      economy();
      walls();
      trading();
      recruiting();
      campaign();
    }
    function step() {
      if (st.phase === 'over') return;
      const tick = Math.round(st.t / dt);
      if ((tick + offset) % P.think !== 0) return;
      try { think(); } catch (e) { stats.errors++; stats.lastError = String(e && e.stack || e).split('\n').slice(0, 4).join(' | '); }
    }
    function info() {
      return { strength, lord, banners: bn.map(s => s && { mode: s.mode, house: s.house, peak: s.peak, cool: s.cool, def: s.def }), threat, focus, why, adj,
        walls: plan === undefined ? 'unplanned' : plan ? { rot: plan.rot, tor: [plan.ti, plan.tj], cells: plan.n, cut: plan.cut, hold: plan.hold, maxLen: plan.maxLen, towers: plan.towers, torFail: plan.torFail } : null };
    }
    return { step, stats, info, strength, lord };
  }

  const api = { create, PROFILES, RAID_AFTER_S };
  if (isNode) module.exports = api; else root.FurtBots = api;
})(typeof window !== 'undefined' ? window : globalThis);
