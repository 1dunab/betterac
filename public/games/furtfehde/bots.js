// ===== Furt & Fehde bots: AI lords that fill empty houses and take over for players who left (see docs/FURTFEHDE.md "Bots") =====
// FurtBots.create(sim, lord, { strength, seed }) → { step(), stats, info(), strength, lord }. strength: 'knappe' | 'ritter' | 'kriegsherr'.
// A bot sees what a player sees (sim.state, sim.youOf, sim.world, sim.occ) and acts only through build, cancel, recruit, banner,
// home and pact. It has its own seeded RNG and no clock, and everything it needs is derived from the state at every decision. So a bot
// created in the middle of a match simply continues the house it is given (takeover): it reads the buildings, the queue and the
// banners (a banner whose order points into enemy land is adopted as a campaign in progress).
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
  const centerOf = (b) => { const fp = W.footprintOf(b.kind, b.rot || 0); return { x: b.i - 72 + fp[0] / 2, y: b.j - 45 + fp[1] / 2 }; };
  const WOODEN = { huette: 1, hof: 1, kornspeicher: 1, lager: 1, holzfaeller: 1, steinbruch: 1 };   // wooden economy buildings: the raid targets
  const ECON = { hof: 0, huette: 1, kornspeicher: 2, holzfaeller: 3, lager: 4, steinbruch: 5 };      // raid order: fields and huts first
  const MIL = { kaserne: 0, wachturm: 1, brunnen: 2 };
  const MIX = { speer: 0.40, bogen: 0.35, ritter: 0.15, fackel: 0.10 };                               // the doc's soldier mix
  const RAID_COOL = 60;   // seconds between two sorties of the torch squad
  // Phase 1b: no torch sortie before this many seconds after the Fehde began (the first probe used to burn a whole village right after the ebb).
  // The knappe never raids. The delay also holds back a field banner that has a torch-bearer in it.
  const RAID_AFTER_S = { knappe: Infinity, ritter: 120, kriegsherr: 60 };
  const FARM_R = 10;   // a field lies within this of a store, or its farmer walks too far
  const KEEP_CORE = 9;   // a Brunnen is not built within this of the keep centre: the keep's own bucket chain (reach 12) guards that ground
  const FEED = 5.0, FEED_KS = 5.5;   // people one farm really feeds: measured with EAT_S 60, KORN_N 3 at 5.1–6.4 (a field at the gate 6.0, one on Aue 11–21 away Ø 5.6, with a Kornspeicher at its door 7.7–9); the strength's `food` scales it
  const REBUILD = ['hof', 'holzfaeller', 'huette', 'kaserne', 'kornspeicher', 'steinbruch', 'brunnen', 'lager', 'wachturm'];   // order of rebuilding ruins

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
  const PROFILES = {
    knappe:     { think: 30, thr: 14, knights: false, aim: 'near',  food: 1.7,  kas: 4, hutAhead: 0, wells: 1, tower: 0, smart: false, spare: 2, retreat: 0.25, burg: 4, mist: 0.35, raid: 0, probe: 0, keep: 8, stock: 1,   raidAfter: RAID_AFTER_S.knappe },
    ritter:     { think: 15, thr: 10, knights: true,  aim: 'crown', food: 0.6,  kas: 2, hutAhead: 2, wells: 6, tower: 2, smart: false, spare: 1, retreat: 0.4,  burg: 4, mist: 0.08, raid: 3, probe: 1, keep: 3, stock: 1.2, raidAfter: RAID_AFTER_S.ritter },
    kriegsherr: { think: 15, thr: 8,  knights: true,  aim: 'weak',  food: 0.57, kas: 2, hutAhead: 2, wells: 6, tower: 3, smart: true,  spare: 1, retreat: 0.4,  burg: 4, mist: 0, raid: 4, probe: 1, keep: 2, stock: 1.2, raidAfter: RAID_AFTER_S.kriegsherr }
  };

  const mulberry32 = W.mulberry32 || function (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const costOf = (kind) => C.BUILD[kind].cost || {};
  const unitCost = (unit) => C.UNIT[unit].cost || {};
  const affordable = (have, cost) => { for (const g of GOODS) if ((cost[g] || 0) > (have[g] || 0)) return false; return true; };

  function create(sim, lord, opts) {
    opts = opts || {};
    const P = PROFILES[opts.strength] || PROFILES.ritter, strength = PROFILES[opts.strength] ? opts.strength : 'ritter';
    const rng = mulberry32(((opts.seed | 0) ^ Math.imul(lord + 1, 0x9E3779B1)) >>> 0);
    const stats = { thinks: 0, builds: 0, buildFails: 0, rebuilds: 0, cancels: 0, recruits: 0, attacks: 0, retreats: 0, defends: 0, raids: 0, targets: 0, pactYes: 0, pactNo: 0, errors: 0, lastError: '' };
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
    let field = null, fieldT = -99, fieldL = -1, fieldFrom = -1;
    const bn = [null, mkBn(), mkBn(), mkBn()];
    let c = null, threat = null, calmSince = 0;
    let fehdeAt = st.phase === 'fehde' && st.t > 0 ? -Infinity : -1;   // when the Fehde was first seen (a bot created in the middle of it is a takeover: no delay)
    const why = {};                        // last reasons for not acting (debugging aid)
    const trace = Array.isArray(opts.trace) ? opts.trace : null;   // optional log of placement attempts: [t, kind, result]
    function mkBn() { return { mode: 'home', house: -1, bid: -1, tx: 0, ty: 0, peak: 0, t0: 0, prog: 0, hpMark: 2, cool: 0, def: false, raids: 0, razed: 0, skip: new Map() }; }

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
      } else if (kind === 'wachturm') {   // towers shoot torch-bearers first: they belong at the fields, away from the other towers
        const fields = [], towers = [];
        for (const b of c.mine) { if (b.ruined) continue; if (b.kind === 'hof') fields.push(centerOf(b)); else if (b.kind === 'wachturm') towers.push(centerOf(b)); }
        let fx = 0, fy = 0; for (const f of fields) { fx += f.x; fy += f.y; }
        if (fields.length) { fx /= fields.length; fy /= fields.length; }
        s = (fields.length && ((towers.length && spotFor('wachturm', { far: towers, r: 12 })) || spotFor('wachturm', { near: [{ x: fx, y: fy, r: 9 }] }))) || spotFor('wachturm');
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
      // a second delivery point for wood and stone: shorter trips, and the keep door is not the only crowded place
      if (have('lager') < 1 && wc >= 2 && F >= 3) w.push('lager');
      else if (storeFull() && have('lager') < 2) w.push('lager');
      if (have('wachturm') < Math.min(P.tower, 1 + Math.floor(F / 5)) && c.done.kaserne && F >= 3 && y.stock.stein >= costOf('wachturm').stein + 2) w.push('wachturm');
      return w;
    }
    function economy() {
      const y = c.y, now = c.t;
      const avail = { korn: y.stock.korn, holz: y.stock.holz, stein: y.stock.stein };
      const spend = (cost) => { for (const g of GOODS) avail[g] -= cost[g] || 0; };
      const wip = wipN(), room = wip < 3;
      // stuck sites: no progress for a long time → give the plot up (full refund) and avoid the spot
      for (const b of c.mine) {
        if (b.ruined || b.build >= 1) { delete seen[b.id]; continue; }
        const m = seen[b.id] || (seen[b.id] = { t: now, b: b.build });
        if (b.build > m.b + 1e-6 || b.fire > 0.25) { m.b = b.build; m.t = now; }
        else if (now - m.t > 90) {
          const r = sim.cancel(lord, b.id);
          if (r.ok) { stats.cancels++; const fp = W.footprintOf(b.kind, b.rot); failSpots.push({ i: b.i, j: b.j, w: fp[0], h: fp[1], until: now + 150 }); delete seen[b.id]; }
        }
      }
      // ruins: rebuild for half the cost when it is quiet around them, clear the forgotten ones
      for (const b of c.ruins) {
        const m = seen[b.id] || (seen[b.id] = { t: now, b: 0 });
        const cost = {};
        for (const g of GOODS) cost[g] = Math.ceil((costOf(b.kind)[g] || 0) * C.REBUILD_COST);
        const ctr = centerOf(b);
        if (REBUILD.indexOf(b.kind) >= 0 && room && affordable(avail, cost) && !foeNear(ctr.x, ctr.y, 14)) {
          const r = sim.build(lord, b.kind, b.i, b.j, b.rot);
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
        const spare = kind === 'huette' || kind === 'lager' || kind === 'wachturm' ? reserveW : 0;
        if (!affordable(avail, cost) || (spare && avail.holz - cost.holz < spare)) {
          if (!reserved) { reserved = true; spend(cost); }   // save for the most urgent unaffordable want: lower ones may only use what is left over
          continue;
        }
        if ((c.wip[kind] || 0) > 0 && (kind === 'kaserne' || kind === 'brunnen' || kind === 'wachturm' || kind === 'lager')) continue;
        if (kind === 'hof' && (c.wip.hof || 0) >= 2) continue;
        c.spent = null;
        const r = place(kind);
        if (r === 'ok') { spend(cost); built++; }
        else if (r === 'granary') { spend(c.spent); built++; }
        else if (r === 'cost' && !reserved) { reserved = true; spend(cost); }
        if (built + wip >= 3) break;
      }
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
    const GUARD = ['bogen', 'speer', 'bogen', 'speer', 'bogen', 'speer'];   // archers shoot torch-bearers down; spears hold the door
    function pickUnit(avail, forBurg) {
      if (forBurg) {
        const k = GUARD[bannerCount(0) + queued(0)] || (bannerCount(0) % 2 ? 'speer' : 'bogen');
        if (affordable(avail, unitCost(k))) return k;
      }
      const shares = {};
      let tot = 0;
      for (const k in MIX) { if (k === 'ritter' && !P.knights) continue; shares[k] = MIX[k]; tot += MIX[k]; }
      const cnt = { speer: 0, bogen: 0, ritter: 0, fackel: 0 };
      let n = 0;
      for (const u of st.units) if (u.lord === lord && u.kind !== 'bauer') { cnt[u.kind]++; n++; }
      for (const q of c.y.queue) { cnt[q.unit]++; n++; }
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
    function nextRecruit() {
      const nowG = bannerCount(0);
      if (nowG !== guardN) { guardN = nowG; guardT = c.t; }
      const g = nowG + (c.t - guardT > 60 ? 0 : queued(0));
      if (g < Math.min(2, P.burg)) return { n: 0, guard: true };
      const sq = bn[3];
      if (P.raid && bn[3].mode === 'home') {
        const army = bannerCount(1) + bannerCount(2) + queued(1) + queued(2);
        const want = sq.raids === 0 ? P.probe : (g >= P.burg && army >= P.thr * 0.8 ? P.raid : 0);   // the first sortie is a probe; later squads only once the guard is full and the field army nearly ready
        if (bannerCount(3) + queued(3) < want) return { n: 3, unit: 'fackel', guard: true };
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
      const base = { korn: y.stock.korn, holz: y.stock.holz, stein: y.stock.stein };
      for (let g = 0; g < 3 && q < 3; g++) {
        const nr = nextRecruit();
        if (!nr) return;
        // the guard may use every sack; the field army leaves a reserve so that training does not starve the house
        const avail = { korn: base.korn - (nr.guard ? 5 : 4 + c.people / 12), holz: base.holz - (nr.guard ? 0 : 4), stein: base.stein };
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
        c.y.queue.push({ unit, n: nr.n, p: 0 });
      }
    }

    // ---- travel times ----
    // travel-time field from a start cell at the current level (cached for a few seconds); building footprints are blocked
    function fieldFromCell(k0) {
      const lv = Math.round(c.L * 100);
      if (field && fieldFrom === k0 && fieldL === lv && c.t - fieldT < 8) return field;
      field = W.field(world, [k0], c.L, field || new Float32Array(N), sim.occ);
      fieldFrom = k0; fieldL = lv; fieldT = c.t;
      return field;
    }
    const cellOf = (x, y) => W.cellOf(x, y);
    // cheapest free cell around a building (approach side) and its travel time
    function approach(b, F) {
      const fp = W.footprintOf(b.kind, b.rot || 0), w = fp[0], h = fp[1];
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
      const F = fieldFromCell(cellOf(from.x, from.y));
      let best = null, bs = Infinity;
      for (const l of c.foes) {
        if ((hits.get(l.i) || 0) > c.t) continue;
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
      const F = fieldFromCell(cellOf(from.x, from.y)), s = bn[n];
      let best = null, bs = Infinity;
      for (const b of st.buildings) {
        if (b.lord !== house.i || b.ruined) continue;
        if ((s.skip.get(b.id) || 0) > c.t) continue;
        const isKeep = b.kind === 'bergfried';
        if (isKeep && house.prot > 0) continue;
        if (n === 3 && !(b.kind in WOODEN)) continue;   // torch-bearers: only what burns
        const a = approach(b, F);
        if (!(a.t < Infinity)) continue;
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
      const p = W.cellXY(pk.a.k);
      const r = orderTo(n, p.x, p.y);
      if (!r.ok) { hits.set(house.i, c.t + 40); return false; }
      if (r.reason === 'unreachable') { hits.set(house.i, c.t + 40); sendHome(n); return false; }
      Object.assign(s, { mode: 'march', house: house.i, bid: pk.b.id, tx: r.x, ty: r.y, peak: g.count, t0: c.t, prog: c.t, hpMark: 2, def: false, razed: 0 });
      if (trace) trace.push([+c.t.toFixed(1), 'launch', n, g.count, house.i, pk.b.kind]);
      focus = { house: house.i, until: c.t + 60 };
      stats.attacks++; stats.targets++;
      if (n === 3) { s.raids++; stats.raids++; }
      return true;
    }
    function advance(n) {   // the banner finished its building: the next one in the same house, else another house, else home
      const g = c.banners[n], s = bn[n], house = st.lords.find(l => l.i === s.house);
      { const done = st.buildings.find(x => x.id === s.bid); if (!done || done.ruined) s.razed++; }
      if (!house || c.pact[house.i]) { sendHome(n); return; }
      const pk = pickBuilding(house, n, { x: g.x, y: g.y });
      if (!pk) {
        hits.set(house.i, c.t + 25);
        const other = pickHouse({ x: g.x, y: g.y }, n);
        if (other && other.i !== house.i) { const p2 = pickBuilding(other, n, { x: g.x, y: g.y }); if (p2) { go(n, other, p2); return; } }
        sendHome(n); return;
      }
      if (trace) trace.push([+c.t.toFixed(1), 'next', n, house.i, pk.b.kind]);
      go(n, house, pk);
    }
    function go(n, house, pk) {
      const s = bn[n], g = c.banners[n], p = W.cellXY(pk.a.k);
      const r = orderTo(n, p.x, p.y);
      if (!r.ok || r.reason === 'unreachable') { s.skip.set(pk.b.id, c.t + 60); if (r.reason === 'unreachable') sendHome(n); return; }
      s.house = house.i; s.bid = pk.b.id; s.tx = r.x; s.ty = r.y; s.prog = c.t; s.hpMark = 2;
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
      if (bn[3].raids === 0) return bannerCount(0) >= Math.min(2, P.burg);
      return bannerCount(0) >= P.burg && bannerCount(1) + bannerCount(2) >= 3;
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
        const tgtHome = hyp(g.tx - h.x, g.ty - h.y) <= 20 || hyp(g.tx - gate.x, g.ty - gate.y) <= 14;
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
            if (!s.def || hyp(g.tx - threat.x, g.ty - threat.y) > 6) { orderTo(n, threat.x, threat.y); stats.defends++; }
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
            else if (c.t - s.prog > 120) { s.skip.set(s.bid, c.t + 60); advance(n); }
          } else {
            if (!b || b.ruined || (b.kind === 'bergfried' && house.prot > 0)) { advance(n); continue; }
            if (b.hp < s.hpMark - 1e-6) { s.hpMark = b.hp; s.prog = c.t; }
            else if (c.t - s.prog > 45) { s.skip.set(s.bid, c.t + 90); advance(n); }
          }
        }
      }
    }
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
      learnFood();
      updateFieldPost();
      scanThreat();
      pacts();
      economy();
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
      return { strength, lord, banners: bn.map(s => s && { mode: s.mode, house: s.house, peak: s.peak, cool: s.cool, def: s.def }), threat, focus, why, adj };
    }
    return { step, stats, info, strength, lord };
  }

  const api = { create, PROFILES, RAID_AFTER_S };
  if (isNode) module.exports = api; else root.FurtBots = api;
})(typeof window !== 'undefined' ? window : globalThis);
