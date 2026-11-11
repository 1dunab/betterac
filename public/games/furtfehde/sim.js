// ===== Furt & Fehde simulation: the rules engine (deterministic, see docs/FURTFEHDE.md "Phase 1") =====
// Peasants carry every sack and log, soldiers march in banners, fields burn, keeps get plundered and the water decides who can
// cross. Pure rules: no DOM, no clock, no unseeded randomness. step() advances a fixed 1/15 s and returns that step's events.
// Public objects in sim.state carry only the documented fields; each also owns a hidden, non-enumerable `_` with its private
// bookkeeping (so JSON.stringify(sim.state) is a clean snapshot and never circular).
(function (root) {
  const W = (typeof module === 'object' && module.exports) ? require('./world.js') : root.FurtWorld;
  const GW = W.GW, GH = W.GH, N = GW * GH;
  const BKEYS = Object.keys(W.BUILDINGS);   // occupancy code of a building = 1 + its index here (bergfried = 1)
  const GOODS = ['korn', 'holz', 'stein'];            // carried, stored and capped
  const PAY = ['korn', 'holz', 'stein', 'gold'];      // everything a price can name (gold has no store, no cap and is never carried)
  const WALLS = ['palisade', 'mauer'];                // the wall lines (1 × len); with the Torhaus they are the "wall pieces" a breach attacks
  const MIL = ['kaserne', 'wachturm', 'soeldnerlager', 'torhaus'];   // razeMil buildings (+5 Ruhm when destroyed)

  // ---- tunables (the doc's numbers unless a comment says otherwise; B3 may tune them against the bot tournament) ----
  const CONST = {
    DT: 1 / 15,                       // fixed step (s)
    // match flow
    DAUER_MIN: 12, BURGFRIEDEN_S: 120,   // defaults of create(): match length (min) and flood truce (s)
    EBB_S: 25,                        // the ebb: level 1 → 0 linear over this long
    WARN_S: 15,                       // `warn` comes this long before the ebb
    LAST_S: 60,                       // `lastMinute` this long before the end
    // people and food
    START: { korn: 20, holz: 25, stein: 0 }, START_PEASANTS: 6,
    KEEP_HOUSES: 8, HUT_HOUSES: 4,    // housing: the keep plus every finished hut
    ARRIVE_S: 6,                      // a peasant arrives at the gate this often while people < popCap, 🌾 ≥ 1 and not hungry (below FLOOR peasants hunger does not stop them)
    EAT_S: 60,                        // the house eats people / EAT_S sacks of 🌾 per second (R4: one person eats one sack a minute)
    HUNGER_WORK: 0.6,                 // work speed while hungry (🌾 = 0)
    LEAVE_S: 15, LEAVE_WALK: 14,      // while hungry one peasant leaves this often; he walks this far outwards, then is gone
    FLOOR: 4,                         // R1 never a dead end: hunger never drives a house below this many peasants, and below it a peasant arrives every ARRIVE_S even when hungry
    GATE_SAFE_R: 8,                   // (ours) R10: only an R1 arrival (a peasant who comes because the house is hungry or out of 🌾 and below FLOOR) waits while an enemy soldier stands within this of the gate (a besieged, starving house is no Ruhm farm); the next one comes once it is clear. Normal arrivals ignore it: they are the house's reinforcements
    FOOD_LOW: 6,                      // R3 food first: while the house is hungry or has less 🌾 than this, empty Hof slots are filled before recruits and sites
    CAP_KEEP: 30, CAP_KORN: 60, CAP_LAGER: 60,   // store caps: keep 30 of each; Kornspeicher +60 🌾; Lagerplatz +60 🪵 and +60 🪨
    RETRY_S: 2,                       // a carrier whose store is full retries this often
    FULL_WAIT_S: 8,                   // R11: a carrier who finds no room at the store gives up after this long (his load is lost) and is free; a workplace whose store is at its cap takes no workers and sends its idle crew away. (Every sack that fits restarts the wait: he keeps delivering while there is room)
    ASSIGN_S: 1,                      // idle peasants are re-assigned this often (per house)
    ROUTES_PER_STEP: 2,               // (ours) A* routes planned per step; others head straight on and plan next step (a mass flight must not hitch)
    YARD_R: 4,                        // idle peasants wait within this distance of the gate
    PULL_WAIT_S: 3,                   // (ours) a site or recruit with nobody idle for this long pulls a worker off his job
    // work cycles
    WOOD_R: 10, CHOP_S: 5, REGROW_S: 120, STAND_AT: 0.6, WOOD_N: 3,   // woodcutter: reach, chop time, regrowth, "standing again" level, logs per trip
    QUARRY_S: 8, STONE_N: 2,          // stonecutter: work time, blocks per trip
    SOW_S: 6, GROW_S: 45, HARVEST_S: 6, KORN_N: 3, YIELD: 6, AUE_BONUS: 0.5,   // farm: yield = round(YIELD · (1 + AUE_BONUS · share of Aue)); R4: sacks per trip 2 → 3
    JITTER: 0.15,                     // (ours) ± relative spread on work timers, so crews do not move in lockstep
    WORK_FIRE: 0.25,                  // workers stop while their building burns above this
    FLEE_R: 6, CALM_R: 10, FLEE_RESUME_S: 8,   // a peasant flees an enemy soldier within FLEE_R, resumes 8 s after none is within CALM_R
    BUCKET_R: 12, BUCKET_MAX: 4, BUCKET_MIN: 2, BUCKET_RATE: 0.06,   // fire chain: radius, peasants per well, minimum, fire removed per peasant and second
    KEEP_WELL_R: 12,                  // R6 Burgbrunnen: the keep is a well too; its chain fights fires on own buildings whose centre is within this of the keep centre
    BUCKET_FILL_S: 0.5, BUCKET_POUR_S: 0.8,   // (ours) filling the bucket at the well, pouring it at the fire
    PEASANT_MIN: 2, QUEUE_MAX: 12,    // (ours) recruit refuses ('pop') when it would leave fewer peasants than this, or the queue is this long
    TRAIN_PAR: 3,                     // (ours) R12: at most this many recruits per finished Kaserne are on their way to it or in training there at once (a second Kaserne trains twice as fast)
    REBUILD_COST: 0.5, SITE_HP_MIN: 0.1,
    // buildings (costs in goods, build time in s at full work speed, hp)
    BUILD: {
      bergfried:    { hp: 3000 },
      huette:       { cost: { holz: 4 },            buildS: 8,  hp: 120 },
      hof:          { cost: { holz: 5 },            buildS: 10, hp: 160, workers: 1 },
      kornspeicher: { cost: { holz: 6 },            buildS: 12, hp: 200 },
      lager:        { cost: { holz: 5 },            buildS: 10, hp: 180 },
      holzfaeller:  { cost: { holz: 3 },            buildS: 8,  hp: 120, workers: 1 },
      steinbruch:   { cost: { holz: 6 },            buildS: 12, hp: 200, workers: 2 },
      kaserne:      { cost: { holz: 8, stein: 8 },  buildS: 18, hp: 500 },
      wachturm:     { cost: { holz: 2, stein: 10 }, buildS: 16, hp: 600 },
      brunnen:      { cost: { stein: 4 },           buildS: 6,  hp: 250 },
      // Phase 2 (perCell: cost, build time and hp are per cell of the piece, so a piece of len 4 costs, takes and holds four times as much)
      palisade:     { cost: { holz: 1 },            buildS: 2,  hp: 150, perCell: true },
      mauer:        { cost: { stein: 2 },           buildS: 4,  hp: 450, perCell: true },
      torhaus:      { cost: { holz: 4, stein: 12 }, buildS: 20, hp: 1400 },
      markt:        { cost: { holz: 10 },           buildS: 14, hp: 300 },
      soeldnerlager:{ cost: { holz: 12 },           buildS: 16, hp: 350 }
    },
    // units (train = training time in s; cd = cooldown between blows; range in cell units, centre to centre; at = the building that trains it)
    UNIT: {
      bauer:  {                                       hp: 25,  dmg: 2,  cd: 1.5, range: 1.0, speed: 2.4, r: 0.3 },
      speer:  { cost: { korn: 2, holz: 2 },  train: 4, hp: 60,  dmg: 8,  cd: 1.0, range: 1.3, speed: 2.6, r: 0.35, at: 'kaserne' },
      bogen:  { cost: { korn: 2, holz: 3 },  train: 4, hp: 40,  dmg: 6,  cd: 1.4, range: 9,   speed: 2.6, r: 0.35, at: 'kaserne' },
      ritter: { cost: { korn: 4, stein: 3 }, train: 6, hp: 140, dmg: 14, cd: 1.2, range: 1.5, speed: 4.2, r: 0.6,  at: 'kaserne' },
      // Phase 2: the torch-bearer moved to the Söldnerlager and costs gold; the Reiterschütze (horse archer) is new; the Rammbock (dmg = per blow against buildings, none against people) comes from the Kaserne
      fackel: { cost: { gold: 2, korn: 1 },  train: 2, hp: 30,  dmg: 0,  cd: 0,   range: 1.2, speed: 4.0, r: 0.3,  at: 'soeldnerlager' },
      reiterschuetze: { cost: { gold: 6, korn: 2 }, train: 4, hp: 70, dmg: 6, cd: 1.3, range: 8, speed: 4.4, r: 0.6, at: 'soeldnerlager' },
      ramme:  { cost: { holz: 10, gold: 4 }, train: 10, hp: 400, dmg: 60, cd: 2.0, range: 1.6, speed: 1.6, r: 0.9, at: 'kaserne' }
    },
    VS: { speer: { ritter: 2 }, bogen: { fackel: 1.5 }, ritter: { bogen: 2, reiterschuetze: 1.5 }, reiterschuetze: { speer: 1.5, fackel: 1.5 } },   // damage multipliers by matchup
    VS_BUILDING: { speer: 1, ritter: 0.6, bogen: 0.3, reiterschuetze: 0.3, ramme: 1 },                            // damage against buildings (bauer and fackel deal none)
    VS_WALL: { speer: 0.4, ritter: 0.25, ramme: 1 },                               // blows against a wall piece or a Torhaus (instead of VS_BUILDING); an arrow does the share below of its damage
    ARROW_WALL: { stein: 0, holz: 0.15 },                                          // … against a stone wall (Mauer, Torhaus) and a wooden one (Palisade)
    ARROW_RAM: 0.25,                  // arrows (archers, towers, keeps) deal this share against a Rammbock; melee blows full
    WADE_DEALT: 0.7, WADE_TAKEN: 1.25, ZORN_MUL: 1.25, ZORN_S: 60,
    // banners and fighting
    SCAN_S: 0.5,                      // every soldier looks for an enemy this often
    AGGRO_MELEE: 6, AGGRO_BOGEN: 10, LEASH: 12, RETALIATE_R: 14, NOENG_S: 3,   // (ours) after a leash break a soldier ignores enemies for NOENG_S
    GUARD_R: 16, GUARD_SELF_R: 8, GUARD_LEASH: 20,   // Burgwache: enemies within 16 of the keep or 8 of itself; (ours) leash from the keep
    SLOT_GAP: 1.3, SLOT_ROW: 6, FOLLOW_R: 5,   // formation rows of up to 6, spacing 1.3; farther than FOLLOW_R from the slot a soldier follows the travel field
    SNAP_R: 12, SIEGE_R: 3, HOLD_FRAC: 0.25,   // order snapping reach; "within 3 of an enemy building" attacks it; (ours) a banner halts when this share fights
    TORCH_R: 15, TORCH_DODGE_R: 3, TORCH_START: 14,   // torch-bearers: next target within 15 of the banner target, dodge melee within 3, start raiding when the banner is this near
    SEP: 0.5,                         // separation: share of an overlap corrected per step
    COH_LAG: 2.5, COH_SPAN: 6, COH_MIN: 0.15,   // (ours) the leader slows when the formation lags: full speed up to COH_LAG, falling to COH_MIN over COH_SPAN
    CHASE_S: 1, CHASE_GAIN: 0.4, GIVEUP_S: 1.5,   // (ours) a chase that closes less than CHASE_GAIN in CHASE_S is dropped; the soldier then ignores enemies for GIVEUP_S
    STRIKE_ANIM_S: 0.4, DODGE_S: 0.4, CLASH_S: 0.6,   // (ours) fight pose after a blow, torch-bearer sidestep, spacing of `clash` events per 4 × 4 spot
    PACT_ZONE: 6,                     // banner targets within this of a partner's buildings are refused
    // arrows
    KEEP: { range: 12, dmg: 6, cd: 2 }, TOWER: { range: 12, dmg: 7, cd: 1.5 },
    ARROW_FACKEL: 2,                  // R7 keep and tower arrows deal this much more against a torch-bearer (they pick torch-bearers first anyway)
    FLIGHT_MIN: 0.35, FLIGHT_MAX: 0.7,   // arrow flight time (s), by distance
    // fire
    FIRE_GROW: 0.03, FIRE_DMG: 20,    // fire grows per second; HP damage per second = FIRE_DMG · fire
    SPREAD_AT: 0.6, SPREAD_AFTER_S: 8, SPREAD_FIRE: 0.2, SPREAD_R: 3, SPREAD_R_HOF: 4,   // above 0.6 for 8 s (R8: was 5) ignites buildings within 3 (fields 4) with fire 0.2
    CROP_BURN_AT: 0.3, BURNT_FADE_S: 60, IGNITE: 0.5,   // fire above this burns the crop; scorch fades over 60 s; one torch adds 0.5
    // Ruhm and the crown
    RUHM: { kill: 1, killRitter: 2, raze: 3, razeMil: 5, crop: 1, plunder: 20, prosperity: 1, betray: -5 },   // razeMil: kaserne, wachturm, soeldnerlager, torhaus; a destroyed palisade or mauer gives nothing
    PROSPER_S: 30, PROSPER_PEOPLE: 8, CROWN_S: 5, CROWN_LEAD: 10, CROWN_MUL: 1.5, CROP_RUHM_AT: 0.3,
    // keep plunder
    LOOT: 0.5, PLUNDER_HP: 0.3, PROT_S: 60, HOME_R: 16,
    // pacts
    PACT_S: 180, OFFER_S: 30,
    RENEW_S: 60,                      // (F2 P1) in the last RENEW_S of an active pact `pact(…, true)` is a renewal offer; when both houses have offered, the pact's end moves PACT_S further
    PACT_GRACE_S: 30,                 // (F2 P2) after a pact has run out (not when it is broken) the two houses stay friends this long: no blows, no sieges, the gate lanes stay open
    ABZUG_PAD: 4,                     // (F2 P2) at that expiry a banner aimed within PACT_ZONE + ABZUG_PAD of the other house's buildings is sent home, like plunder protection does
    ALERT_S: 10,                      // at most one `attack` event per house in this time
    // Phase 2: gold and the Markt (docs/FURTFEHDE.md "Phase 2")
    TRADE_PACK: 5,                    // a trade moves this many goods per pack
    TRADE_PRICE: { sell: { korn: 1, holz: 1, stein: 2 }, buy: { korn: 3, holz: 3, stein: 5 } },   // 💰 per pack: what a pack of goods sells for / what a pack costs
    // walls and gates
    BREACH_COST: 60,                  // a banner's travel field treats an enemy wall or closed gate cell as passable at this much extra; with no open way the field leads to the cheapest breach
    BREACH_MUL: { palisade: 0.4, mauer: 1, torhaus: 1 },   // (ours) × BREACH_COST by kind: a wooden wall is cheaper to break than a stone one
    RUBBLE_SLOW: 0.6,                 // a ruined wall piece or gate is passable rubble at this share of the ground speed
    // Wehrgang
    SLOTS: { mauer: 1, torhaus: 4, wachturm: 3 },   // archer slots: a Mauer has this many per cell
    GARRISON_RANGE: 3,                // a garrisoned archer shoots this much farther
    GARRISON_ARMOR: 0.5,              // arrows deal this share against a garrisoned archer; melee cannot reach him at all
    GARRISON_TOUCH: 1, GARRISON_NEAR: 4,   // an order within TOUCH of an own garrisonable building sends the banner's archers into the free slots of such buildings within NEAR of the order
    GARRISON_FALL: 0.2,               // archers drop out of a ruined building with this share of their hit points lost
    GARRISON_ENTER_R: 1.1, GARRISON_WALK_R: 7, GARRISON_S: 1,   // (ours) an archer climbs in when within ENTER_R of the footprint; farther than WALK_R he travels with the banner; free slots are handed out every GARRISON_S
    GARRISON_DROP_R: 4, GARRISON_RETRY_S: 5,   // (ours) an archer leaving a wall looks for a free cell within DROP_R; one who finds no way in gives his slot up for RETRY_S
    // Rammbock and Reiterschütze
    WALL_PIECES_MAX: 64,              // (ours) buildWall takes at most this many pieces per call
    SLOT_LOS_R: 1.5,                  // (ours) a soldier within FOLLOW_R of its slot walks straight to it, unless a wall or building is in the way and it is farther than this: then it follows the field around
    RAM_R: 3,                         // the ram attacks the nearest enemy wall, gate or building within this
    KITE_R: 3, KITE_S: 0.4            // a Reiterschütze backs away from a melee enemy within KITE_R while reloading; (ours) it keeps its direction this long
  };

  const C = CONST, UN = C.UNIT;
  const J = { IDLE: 0, TOWORK: 1, WORK: 2, CARRY: 3, RETURN: 4, FETCH: 5, BUILD: 6, RECRUIT: 7, BUCKET: 8, FLEE: 9, LEAVE: 10 };   // peasant jobs
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const RANK = { ramme: -1, ritter: 0, speer: 1, fackel: 2, bogen: 3, reiterschuetze: 3 };   // formation order: the ram in front, riders next, archers (horse archers too) at the back
  const GOOD_OF = { hof: 'korn', holzfaeller: 'holz', steinbruch: 'stein' };   // R11: the good a workplace makes, i.e. the store whose cap can rest it
  const HC = 4, HW = 36, HH = 23;                              // spatial hash: 4 × 4 cells
  const FOOD_WIN = 60;                                         // R9: youOf().food.prod is the 🌾 delivered over a rolling window of this many one-second buckets
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);   // (a kind name from outside may be 'constructor')
  const num = (v) => typeof v === 'number' && isFinite(v);
  const int = (v) => typeof v === 'number' && isFinite(v) && v === Math.floor(v);
  const cellAt = (x, y) => { const i = Math.floor(x + 72), j = Math.floor(y + 45); return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i; };
  const ckx = (k) => -71.5 + k % GW, cky = (k) => -44.5 + Math.floor(k / GW);
  const ihash = (a, b) => { let h = Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA6B); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; return (h >>> 0) / 4294967296; };
  const hid = (o, p) => Object.defineProperty(o, '_', { value: p });   // attach the private record, hidden from enumeration and JSON

  // private record of every person (peasant or soldier); one shape keeps the hot loops monomorphic
  class UP {
    constructor() {
      this.job = J.IDLE; this.ws = 0; this.t = 0; this.idleT = 0;          // peasant job, sub-state, timer, "do not assign before"
      this.wb = null; this.site = null; this.qe = null; this.tree = -1;    // workplace, site being built, recruit entry, reserved tree
      this.res = null; this.load = 0; this.rest = 0; this.store = null; this.fwait = 0;   // carried good, amount, sacks left at the farm, chosen store, time waited for room at it (R11)
      this.dx = 0; this.dy = 0; this.pl = undefined; this.pi = 0; this.stuck = 0; this.gv = -1;   // walk destination, route (undefined = not planned, null = straight), progress
      this.yx = 0; this.yy = 0; this.ox = 0; this.moved = false;            // yard spot, lateral offset at a door, moved this step
      this.calm = 0; this.foe = null; this.tb = null; this.tu = null;       // flee calm timer, nearest enemy soldier, building / unit target
      this.bn = null; this.slot = 0; this.scan = 0; this.cd = 0; this.noEng = 0; this.animT = 0;   // soldier: banner, slot index, scan countdown, cooldowns
      this.lastAtt = null; this.lastD = 0; this.progT = 0; this.wx = 0; this.wy = 0; this.wT = 0; this.mode = 0;   // retaliation target, chase progress, field waypoint
      this.dead = false; this.sub = 0; this.tw = 0; this.mat = null; this.rep = 0; this.ax = 0; this.ay = 0; this.dodgeT = 0;   // walk purpose, timer length, builder's material, replans, torch dodge / kite direction
      this.on = null; this.si = -1; this.gb = null; this.gs = -1; this.gT = 0; this.swing = 0;   // Wehrgang: building and slot he stands in, building and slot reserved for him, "do not look for a slot before"; the ram's swing timer
    }
  }

  function create(opts) {
    opts = opts || {};
    const seed = (opts.seed | 0) || 1;
    const world = opts.world || W.make(seed);
    const DT = C.DT, TPS = Math.round(1 / DT);
    const dauer = num(opts.dauer) && opts.dauer > 0 ? Math.min(opts.dauer, 240) : C.DAUER_MIN;
    const burg = num(opts.burgfrieden) && opts.burgfrieden >= 0 ? opts.burgfrieden : C.BURGFRIEDEN_S;
    const tEbbe = Math.round(burg * TPS), tFehde = tEbbe + Math.round(C.EBB_S * TPS), tEnd = Math.max(Math.round(dauer * 60 * TPS), tFehde + 1);
    const rEco = W.mulberry32(seed ^ 0x5bd1e995);   // work-timer jitter, leaving directions
    const rCom = W.mulberry32(seed ^ 0x1b873593);   // arrow flight jitter, cooldown phases

    const st = {
      t: 0, dayT: 0, level: 1, phase: tEbbe > 0 ? 'frieden' : 'ebbe', endsAt: tEnd * DT,
      lords: [], buildings: [], units: [], banners: [],
      trees: new Float32Array(world.trees.length).fill(1), treeV: 0,
      pacts: [], ranking: null   // pacts: { a, b, until } active · { a, b, offerUntil } an offer (a → b) · { a, b, until, grace: true } the Abzug's grace after a pact ran out (F2)
    };
    const units = st.units, bldgs = st.buildings, trees = st.trees;
    let tick = 0, nextId = 1, ev = [], lastMinute = false, crownI = -1, crownT = 0;
    const emit = (o) => { ev.push(o); };

    // ---- lords ----
    const LP = [], LA = [];   // private records by position and by lord index i
    const crossOpened = new Array(world.crossings.length).fill(false);
    const arrows = [], regrow = [], tres = new Int32Array(world.trees.length), tlock = new Uint8Array(world.trees.length);
    const allBanners = [];
    const clashAt = new Float32Array(HW * HH).fill(-9);

    // ---- grids at the current water level (bucketed, so the flood rule is exact between two thresholds) ----
    const sp = new Float32Array(N), wet = new Uint8Array(N), blk = new Uint8Array(N), occ = new Uint8Array(N), lab = new Int32Array(N), stack = new Int32Array(N);
    const bAt = new Array(N).fill(null);   // the building on a cell (a ruin as well); null = none
    const rub = new Uint8Array(N);         // 1 = passable rubble: a ruined wall piece or gatehouse
    const hq = world.hq;
    let gridKey = -99, Lq = 1, gridVer = 0, labVer = -1;
    const pathCache = new Map();
    let routeBudget = 0;   // A* routes still allowed in this step
    const bucketOf = (L) => L >= 1 ? 25 : L <= 0 ? -1 : Math.floor(L * 24);
    function markFieldsDirty() { pathCache.clear(); for (const bn of allBanners) bn.fDirty = true; }
    // anything that changes what a unit can walk on (a building, a ruin, the water, a pact that opens or closes a gate lane): views, labels, routes and fields are rebuilt lazily
    function gridChanged() { gridVer++; markFieldsDirty(); }
    function refreshGrids() {
      const b = bucketOf(st.level);
      if (b === gridKey) return;
      gridKey = b; Lq = b >= 25 ? 1 : b < 0 ? 0 : (b + 0.5) / 24;
      for (let k = 0; k < N; k++) { const s = W.walk(world, k, Lq) * (rub[k] ? C.RUBBLE_SLOW : 1); sp[k] = s; wet[k] = 12 * Lq - hq[k] > 1e-9 ? 1 : 0; blk[k] = s === 0 || (occ[k] && !rub[k]) ? 1 : 0; }
      gridChanged();
    }
    // ---- who can walk where: the base mask `blk` (water, rock, every building; a Torhaus lane is a wall for everybody) and, per house, its VIEW: the lane
    // cells of its own and its pact partners' finished gatehouses opened. A house's peasants and banners move by its view. A travel field (`fviewOf`) also counts
    // an enemy wall piece or gatehouse as passable at BREACH_COST, so a banner with no open way is led to the cheapest breach. Rebuilt only after a grid or pact change.
    const friendly = (lp, m) => m === lp.i || allied(lp.i, m);
    function laneCells(b) { const ln = W.laneOf(b.i, b.j, b.rot).cells; return [ln[0][1] * GW + ln[0][0], ln[1][1] * GW + ln[1][0]]; }
    function viewOf(lp) {
      if (lp.vVer === gridVer) return lp.V;
      lp.vVer = gridVer;
      let any = false;
      for (const b of bldgs) if (b._.gate && b.build >= 1 && !b.ruined && friendly(lp, b.lord)) { any = true; break; }
      if (!any) return (lp.V = blk);
      const V = lp.Vbuf || (lp.Vbuf = new Uint8Array(N));
      V.set(blk);
      for (const b of bldgs) if (b._.gate && b.build >= 1 && !b.ruined && friendly(lp, b.lord)) for (const k of laneCells(b)) if (sp[k] > 0) V[k] = 0;
      return (lp.V = V);
    }
    const breachable = (lp, b) => b._.piece && !b.ruined && b.lord !== lp.i && hostile(lp.i, b.lord);   // an enemy wall piece or gatehouse
    function fviewOf(lp) {   // { B: block mask, X: extra costs or null } for travel fields and orders
      if (lp.fVer === gridVer) return lp.F;
      lp.fVer = gridVer;
      const V = viewOf(lp);
      let any = false;
      for (const b of bldgs) if (breachable(lp, b)) { any = true; break; }
      if (!any) return (lp.F = { B: V, X: null });
      const B = lp.FB || (lp.FB = new Uint8Array(N)), X = lp.FX || (lp.FX = new Float32Array(N));
      B.set(V); X.fill(0);
      for (const b of bldgs) {
        if (!breachable(lp, b)) continue;
        const bp = b._, c = C.BREACH_COST * (C.BREACH_MUL[b.kind] || 1);
        for (let dj = 0; dj < bp.h; dj++) for (let di = 0; di < bp.w; di++) { const k = (b.j + dj) * GW + b.i + di; if (sp[k] > 0) { B[k] = 0; X[k] = c; } }
      }
      return (lp.F = { B, X });
    }
    // connected free areas of the walkable, unoccupied cells (8 neighbours, no corner cutting); recomputed lazily
    function computeLabels(Bm, out) {
      out.fill(-1);
      let n = 0;
      for (let s = 0; s < N; s++) {
        if (Bm[s] || out[s] >= 0) continue;
        let top = 0; out[s] = n; stack[top++] = s;
        while (top) {
          const k = stack[--top], i = k % GW, j = (k - i) / GW;
          for (let d = 0; d < 8; d++) {
            const ni = i + DX[d], nj = j + DY[d];
            if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
            const nk = nj * GW + ni;
            if (Bm[nk] || out[nk] >= 0) continue;
            if (d >= 4 && (Bm[j * GW + ni] || Bm[nj * GW + i])) continue;
            out[nk] = n; stack[top++] = nk;
          }
        }
        n++;
      }
      return out;
    }
    function labels() {   // the base mask's areas (what tests and house-less code see)
      if (labVer === gridVer) return lab;
      labVer = gridVer;
      return computeLabels(blk, lab);
    }
    function labelsOf(lp) {   // the areas as house lp's units can walk them
      const V = viewOf(lp);
      if (V === blk) return labels();
      if (lp.labVer !== gridVer) { lp.labVer = gridVer; computeLabels(V, lp.lab || (lp.lab = new Int32Array(N))); }
      return lp.lab;
    }
    function labelsB(lp) {    // … counting enemy walls and gates as passable (where a banner may be sent)
      const F = fviewOf(lp);
      if (F.B === blk) return labels();
      if (F.B === viewOf(lp)) return labelsOf(lp);
      if (lp.labBVer !== gridVer) { lp.labBVer = gridVer; computeLabels(F.B, lp.labB || (lp.labB = new Int32Array(N))); }
      return lp.labB;
    }
    // the free cell nearest to (x, y) within r that lies in the same area as cell `ref` (for house lp, as its units walk: or with `breach`, as its banners may be sent); -1 if none
    function snapCell(x, y, r, ref, lp, breach) {
      const B = breach ? fviewOf(lp).B : viewOf(lp), L = breach ? labelsB(lp) : labelsOf(lp), rl = ref >= 0 ? L[ref] : -2, k0 = cellAt(x, y);
      if (rl < 0) return -1;
      if (k0 >= 0 && !B[k0] && L[k0] === rl) return k0;
      const i0 = Math.floor(x + 72), j0 = Math.floor(y + 45), R = Math.ceil(r);
      let best = -1, bd = Infinity;
      for (let j = Math.max(0, j0 - R); j <= Math.min(GH - 1, j0 + R); j++) for (let i = Math.max(0, i0 - R); i <= Math.min(GW - 1, i0 + R); i++) {
        const k = j * GW + i;
        if (B[k] || L[k] !== rl) continue;
        const d = Math.hypot(i + 0.5 - 72 - x, j + 0.5 - 45 - y);
        if (d <= r + 1e-9 && d < bd - 1e-9) { bd = d; best = k; }
      }
      return best;
    }

    // ---- spatial hash of the people (rebuilt every step) ----
    const hHead = new Int32Array(HW * HH);
    let hNext = new Int32Array(1024);
    const QB = new Int32Array(8192);
    let QN = 0;
    const hb = (x, y) => clamp(Math.floor((x + 72) / HC), 0, HW - 1) + HW * clamp(Math.floor((y + 45) / HC), 0, HH - 1);
    function hashBuild() {
      hHead.fill(-1);
      if (hNext.length < units.length) hNext = new Int32Array(units.length * 2);
      for (let i = units.length - 1; i >= 0; i--) {   // reverse insertion, so a bucket lists the lowest index first
        const u = units[i];
        if (u.hp <= 0) continue;
        const b = hb(u.x, u.y);
        hNext[i] = hHead[b]; hHead[b] = i;
      }
    }
    function near(x, y, r) {   // fills QB[0..QN) with indices of the units in the buckets that touch the square of half-width r
      QN = 0;
      const bx0 = clamp(Math.floor((x - r + 72) / HC), 0, HW - 1), bx1 = clamp(Math.floor((x + r + 72) / HC), 0, HW - 1);
      const by0 = clamp(Math.floor((y - r + 45) / HC), 0, HH - 1), by1 = clamp(Math.floor((y + r + 45) / HC), 0, HH - 1);
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++)
        for (let i = hHead[by * HW + bx]; i >= 0 && QN < QB.length; i = hNext[i]) QB[QN++] = i;
    }

    // ---- line of sight, movement ----
    function losClear(x0, y0, x1, y1, B) {   // true if the straight segment touches no blocked cell (of mask B: a house's view)
      let cx = Math.floor(x0 + 72), cy = Math.floor(y0 + 45);
      const ex = Math.floor(x1 + 72), ey = Math.floor(y1 + 45);
      if (cx < 0 || cy < 0 || cx >= GW || cy >= GH || B[cy * GW + cx]) return false;
      if (cx === ex && cy === ey) return true;
      const dx = x1 - x0, dy = y1 - y0, sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
      const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity, px = x0 + 72, py = y0 + 45;
      let tx = dx > 0 ? (cx + 1 - px) * tdx : dx < 0 ? (px - cx) * tdx : Infinity;
      let ty = dy > 0 ? (cy + 1 - py) * tdy : dy < 0 ? (py - cy) * tdy : Infinity;
      for (let g = 0; g < 400; g++) {
        if (tx < ty) { cx += sx; tx += tdx; } else if (ty < tx) { cy += sy; ty += tdy; } else { cx += sx; cy += sy; tx += tdx; ty += tdy; }
        if (cx < 0 || cy < 0 || cx >= GW || cy >= GH || B[cy * GW + cx]) return false;
        if (cx === ex && cy === ey) return true;
      }
      return false;
    }
    // move by (dx, dy), sliding along blocked cells; true only if the unit really moved
    // (a zero-length slide must not count, or a walker pressed against a wall never notices it is stuck)
    function nudge(u, dx, dy, B) {   // B = the view of the mover's house
      const ox = u.x, oy = u.y;
      const nx = clamp(u.x + dx, -71.9, 71.9), ny = clamp(u.y + dy, -44.9, 44.9);
      let k = cellAt(nx, ny);
      if (k >= 0 && !B[k]) { u.x = nx; u.y = ny; }
      else if (nx !== ox && (k = cellAt(nx, u.y)) >= 0 && !B[k]) u.x = nx;
      else if (ny !== oy && (k = cellAt(u.x, ny)) >= 0 && !B[k]) u.y = ny;
      const mx = u.x - ox, my = u.y - oy;
      return mx * mx + my * my > 1e-12;
    }
    function unstick(u, B) {   // a unit on a blocked cell (a building went up under it) steps to the nearest free one
      const i0 = Math.floor(u.x + 72), j0 = Math.floor(u.y + 45);
      for (let r = 1; r <= 10; r++) {
        let best = -1, bd = 1e9;
        for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
          if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r || i < 0 || j < 0 || i >= GW || j >= GH) continue;
          const k = j * GW + i;
          if (B[k]) continue;
          const d = (i + 0.5 - 72 - u.x) * (i + 0.5 - 72 - u.x) + (j + 0.5 - 45 - u.y) * (j + 0.5 - 45 - u.y);
          if (d < bd) { bd = d; best = k; }
        }
        if (best >= 0) { u.x = ckx(best); u.y = cky(best); return; }
      }
    }
    function moveToward(u, p, tx, ty, speed) {   // one step toward a point at `speed` (terrain and wading factor applied)
      const dx = tx - u.x, dy = ty - u.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-6) { p.moved = false; return; }
      const k = cellAt(u.x, u.y), f = k >= 0 && sp[k] > 0 ? sp[k] : 0.5, step = Math.min(d, speed * f * DT);
      p.moved = nudge(u, dx / d * step, dy / d * step, viewOf(LA[u.lord]));
      if (p.moved) u.h = Math.atan2(dy, dx);
    }
    // route for a peasant, cached per (from cell, to cell) until the water level or a building changes;
    // null = no way, undefined = not planned yet (this step's budget is spent)
    function routeFor(x0, y0, x1, y1, lp) {   // by the walker's house view (its own gate lanes are open)
      const a = cellAt(x0, y0), b = cellAt(x1, y1);
      if (a < 0 || b < 0) return null;
      const key = (a * 16384 + b) * 16 + lp.k, hit = pathCache.get(key);
      if (hit !== undefined) return hit;
      if (routeBudget <= 0) return undefined;
      routeBudget--;
      if (pathCache.size > 4000) pathCache.clear();   // a long quiet game never invalidates the cache: keep it bounded
      const r = W.path(world, { x: x0, y: y0 }, { x: x1, y: y1 }, Lq, { block: viewOf(lp) }), out = r ? r.slice(1) : null;
      pathCache.set(key, out);
      return out;
    }
    function walkTo(p, x, y) { p.dx = x; p.dy = y; p.pl = undefined; p.pi = 0; p.stuck = 0; p.rep = 0; }
    // walk one step toward (p.dx, p.dy): 1 = arrived, -1 = no way, 0 = under way
    function stepWalk(u, p, speed) {
      const fx = p.dx - u.x, fy = p.dy - u.y;
      if (fx * fx + fy * fy < 0.0625) { p.moved = false; return 1; }
      if (p.pl !== undefined && p.gv !== gridVer) p.pl = undefined;   // a building or the water changed the grid: replan
      if (p.pl === undefined) {
        if (losClear(u.x, u.y, p.dx, p.dy, viewOf(LA[u.lord]))) { p.pl = null; p.gv = gridVer; }
        else {
          const r = routeFor(u.x, u.y, p.dx, p.dy, LA[u.lord]);
          if (r === null) return -1;
          if (r === undefined) { moveToward(u, p, p.dx, p.dy, speed); return 0; }   // no route yet: head straight on, plan next step
          p.pl = r; p.pi = 0; p.gv = gridVer;
        }
      }
      let tx = p.dx, ty = p.dy;
      if (p.pl !== null) {
        while (p.pi < p.pl.length) {
          const q = p.pl[p.pi];
          if ((q.x - u.x) * (q.x - u.x) + (q.y - u.y) * (q.y - u.y) < 0.09) p.pi++; else { tx = q.x; ty = q.y; break; }
        }
      }
      moveToward(u, p, tx, ty, speed);
      if (p.moved) p.stuck = 0;
      else if ((p.stuck += DT) > 1.2) {   // blocked: replan once through the A* route, then give up
        p.stuck = 0;
        if (p.rep > 0) return -1;
        const r = routeFor(u.x, u.y, p.dx, p.dy, LA[u.lord]);
        if (r === null) return -1;
        if (r === undefined) { p.stuck = 1.2; return 0; }   // budget spent: try again next step
        p.rep++; p.pl = r; p.pi = 0; p.gv = gridVer;
      }
      return 0;
    }

    // ---- lord helpers ----
    const lordOf = (i) => (typeof i === 'number' && LA[i]) || null;
    let M = 4;   // pact matrices are M × M by lord index
    let PM = new Float64Array(16), OF = new Float64Array(16);   // active pact end / offer expiry (a → b), 0 = none
    let RN = new Float64Array(16), GR = new Float64Array(16);   // (F2) renewal offer of a to b (the pact end it was made for) / end of the Abzug grace after an expired pact (both ways), 0 = none
    // friends: pact partners, and (P2) a house whose pact ran out less than PACT_GRACE_S ago. A broken pact leaves no grace (P3).
    const allied = (a, b) => PM[a * M + b] > 0 || GR[a * M + b] > 0;
    const hostile = (a, b) => a !== b && PM[a * M + b] <= 0 && GR[a * M + b] <= 0;
    function addRuhm(lp, amt, cat, vs) {   // vs = the lord the Ruhm is won against (the crown multiplies it)
      if (!lp || !amt) return;
      if (vs && amt > 0 && crownI === vs.i) amt = Math.round(amt * C.CROWN_MUL * 2) / 2;
      lp.pub.ruhm += amt; lp.by[cat] = (lp.by[cat] || 0) + amt;
    }
    function attackAlert(lp, x, y) {
      if (st.t - lp.alertT < C.ALERT_S) return;
      lp.alertT = st.t; emit({ t: 'attack', lord: lp.i, x, y });
    }

    // ---- buildings ----
    const rectDist = (bp, x, y) => Math.hypot(Math.max(bp.x0 - x, 0, x - bp.x1), Math.max(bp.y0 - y, 0, y - bp.y1));
    // hp follows construction (10 % at the start, in proportion to the work) minus the damage taken; public hp is 0..1
    const refreshHp = (b) => { const bp = b._; bp.hpAbs = Math.max(0, (C.SITE_HP_MIN + (1 - C.SITE_HP_MIN) * b.build) * bp.maxHp - bp.dmg); b.hp = bp.hpAbs / bp.maxHp; };
    // paint a building's cells: code, building, rubble (a ruined wall piece or gatehouse is passable rubble at RUBBLE_SLOW, every other ruin still blocks), blocked
    function stampOcc(b, on) {
      const bp = b._, rubble = on && b.ruined && bp.piece;
      for (let dj = 0; dj < bp.h; dj++) for (let di = 0; di < bp.w; di++) {
        const k = (b.j + dj) * GW + b.i + di;
        occ[k] = on ? bp.code : 0; bAt[k] = on ? b : null; rub[k] = rubble ? 1 : 0;
        sp[k] = W.walk(world, k, Lq) * (rubble ? C.RUBBLE_SLOW : 1);
        blk[k] = sp[k] === 0 || (occ[k] && !rub[k]) ? 1 : 0;
      }
      gridChanged();
    }
    function capOf(lp, g) {   // store cap of a good: keep 30, Kornspeicher +60 🌾, Lagerplatz +60 🪵 and 🪨
      let c = C.CAP_KEEP;
      for (const b of lp.bld) {
        if (b.ruined || b.build < 1) continue;
        if (g === 'korn' ? b.kind === 'kornspeicher' : b.kind === 'lager') c += g === 'korn' ? C.CAP_KORN : C.CAP_LAGER;
      }
      return c;
    }
    function popCap(lp) {
      let c = C.KEEP_HOUSES;
      for (const b of lp.bld) if (b.kind === 'huette' && b.build >= 1 && !b.ruined) c += C.HUT_HOUSES;
      return c;
    }
    const finished = (lp, kind) => { for (const b of lp.bld) if (b.kind === kind && b.build >= 1 && !b.ruined) return true; return false; };
    const syncGold = (lp) => { lp.pub.gold = lp.stock.gold; };   // state.lords[].gold follows the stock
    // R11: a finished workplace whose good is at its store cap rests of itself (`full`; not one that rests by order, that is `paused`). The job assignment and
    // the work cycles go by this flag, which stepLord refreshes at the start of every step (pause() refreshes it at once)
    const SFULL = { korn: -1, holz: -1, stein: -1 };   // scratch: 1 = at the cap, 0 = room left, -1 = not looked at yet
    function syncFull(lp) {
      SFULL.korn = SFULL.holz = SFULL.stein = -1;
      for (const b of lp.bld) {
        const g = GOOD_OF[b.kind];
        if (!g) continue;
        let f = false;
        if (b.build >= 1 && !b.ruined && !b.paused) { if (SFULL[g] < 0) SFULL[g] = lp.stock[g] >= capOf(lp, g) ? 1 : 0; f = SFULL[g] === 1; }
        b.full = f;
        if (f && b.noWood) b.noWood = false;   // a resting hut is not looking for trees
      }
    }
    // the cell a worker stands on to use a building: the documented door, else the closest free cell around it in the gate's area
    function findDoor(lp, kind, i, j, rot, len) {
      const fp = W.footprintOf(kind, rot, len), fw = fp[0], fh = fp[1], L = labelsOf(lp), V = viewOf(lp), rl = lp.gateCell >= 0 ? L[lp.gateCell] : -1;
      if (rl < 0) return -1;
      const di = rot ? i - 1 : i + (fw >> 1), dj = rot ? j + (fh >> 1) : j + fh;
      const ok = (ci, cj) => ci >= 0 && cj >= 0 && ci < GW && cj < GH && !V[cj * GW + ci] && L[cj * GW + ci] === rl;
      if (ok(di, dj)) return dj * GW + di;
      for (let r = 1; r <= 2; r++) {
        let best = -1, bd = 1e9;
        for (let cj = j - r; cj < j + fh + r; cj++) for (let ci = i - r; ci < i + fw + r; ci++) {
          const o = Math.max(Math.max(i - ci, 0, ci - (i + fw - 1)), Math.max(j - cj, 0, cj - (j + fh - 1)));
          if (o !== r || !ok(ci, cj)) continue;
          const d = (ci - di) * (ci - di) + (cj - dj) * (cj - dj);
          if (d < bd) { bd = d; best = cj * GW + ci; }
        }
        if (best >= 0) return best;
      }
      return -1;
    }
    function costOf(kind, rebuild, len) {   // a wall piece costs per cell (len cells); a rebuilt ruin half of that, rounded up
      const B = C.BUILD[kind], c = B.cost || {}, out = { korn: 0, holz: 0, stein: 0 }, m = B.perCell ? len || 1 : 1;
      for (const g of GOODS) out[g] = rebuild ? Math.ceil((c[g] || 0) * m * C.REBUILD_COST) : (c[g] || 0) * m;
      return out;
    }
    function mkBuilding(lp, kind, i, j, rot, build, doorK, len) {
      len = len || 1;
      const B = C.BUILD[kind], fp = W.footprintOf(kind, rot, len), x0 = -72 + i, y0 = -45 + j, hp = B.hp * (B.perCell ? len : 1), slots = (C.SLOTS[kind] || 0) * (kind === 'mauer' ? len : 1);
      const b = { id: nextId++, lord: lp.i, kind, i, j, rot, build, hp: 1, fire: 0, burnt: 0, ruined: false, growth: kind === 'hof' ? 0 : 1, workers: 0, paused: false, full: false, len, garrison: 0 };
      if (kind === 'holzfaeller') b.noWood = false;
      const bp = {
        lp, w: fp[0], h: fp[1], x0, y0, x1: x0 + fp[0], y1: y0 + fp[1], cx: x0 + fp[0] / 2, cy: y0 + fp[1] / 2, code: 1 + BKEYS.indexOf(kind),
        maxHp: hp, hpAbs: hp, dmg: 0, paid: null, door: doorK, dx: ckx(doorK), dy: cky(doorK), workers: [], builder: null, max: B.workers || 0,
        wood: W.BUILDINGS[kind].mat === 'holz', fireBy: -1, spreadT: 0, yieldN: 0, cands: null, cd: 0, torchBy: null, lastBy: -1, dead: false,
        wall: WALLS.indexOf(kind) >= 0, gate: kind === 'torhaus', len,                       // wall line / gatehouse: the "pieces" a breach attacks
        cap: slots, gs: slots ? new Array(slots).fill(null) : null, gres: slots ? new Array(slots).fill(null) : null   // Wehrgang: archer slots, the archers standing in them, slots reserved for archers on their way
      };
      bp.piece = bp.wall || bp.gate;
      hid(b, bp);
      refreshHp(b);
      if (kind === 'hof') {
        let a = 0;
        for (let dj = 0; dj < bp.h; dj++) for (let di = 0; di < bp.w; di++) if (world.cls[(j + dj) * GW + i + di] === W.CI.A) a++;
        bp.yieldN = Math.round(C.YIELD * (1 + C.AUE_BONUS * a / (bp.w * bp.h)));
      }
      lp.bld.push(b); bldgs.push(b);
      return b;
    }
    function fellFootprint(b) {   // trees under a new building are cut for good
      const bp = b._;
      let any = false;
      for (let id = 0; id < world.trees.length; id++) {
        const t = world.trees[id];
        if (t.k < 0) continue;
        const ci = t.k % GW, cj = (t.k - ci) / GW;
        if (ci >= b.i && ci < b.i + bp.w && cj >= b.j && cj < b.j + bp.h) { if (!tlock[id]) any = true; tlock[id] = 1; trees[id] = 0; }
      }
      if (any) st.treeV++;
    }
    function gatherTrees(b) {   // the woodcutter's candidate trees: standing-capable trees within WOOD_R of the hut
      const bp = b._, out = [];
      for (let id = 0; id < world.trees.length; id++) {
        const t = world.trees[id];
        if (t.k >= 0 && t.kind !== 'weide' && Math.hypot(t.x - bp.cx, t.y - bp.cy) <= C.WOOD_R) out.push(id);
      }
      bp.cands = out;
    }
    function completeBuilding(b) {
      const bp = b._;
      b.build = 1; refreshHp(b);
      if (bp.gate) gridChanged();   // a finished gatehouse opens its lane for its owner and pact partners
      if (b.kind === 'holzfaeller') gatherTrees(b);
      if (!bp.wall) bp.lp.stats.built++;
      emit({ t: 'buildDone', id: b.id });
    }
    function removeBuilding(b) {
      const bp = b._, lp = bp.lp;
      for (const u of bp.workers.slice()) releaseJob(u, u._);
      if (bp.builder) releaseJob(bp.builder, bp.builder._);
      if (b.fire > 0) { b.fire = 0; emit({ t: 'fireOut', id: b.id }); }
      stampOcc(b, false);
      lp.bld.splice(lp.bld.indexOf(b), 1); bldgs.splice(bldgs.indexOf(b), 1);
      bp.dead = true;
      evacuate(b, 0, -1);   // (the archers step down unhurt)
    }

    // ---- damage, ruins, plunder ----
    function damageBuilding(b, dmg, by, fire) {   // by = lord index or -1
      if (b.ruined || !(dmg > 0)) return;
      const bp = b._, lp = bp.lp;
      if (b.kind === 'bergfried' && lp.pub.prot > 0) return;   // a plundered keep is invulnerable while it recovers
      if (by >= 0) { bp.lastBy = by; if (by !== lp.i && !fire) attackAlert(lp, bp.cx, bp.cy); }
      bp.dmg += dmg; refreshHp(b);
      if (bp.hpAbs > 0) return;
      if (b.kind === 'bergfried') plunder(lp, lordOf(by) || lordOf(bp.lastBy));
      else ruinBuilding(b, by);
    }
    function ruinBuilding(b, by) {
      const bp = b._, lp = bp.lp;
      b.ruined = true; b.hp = 0; bp.hpAbs = 0; b.paused = false; b.full = false;   // a ruin does not rest (and a rebuild starts fresh)
      if (b.fire > 0) { b.fire = 0; emit({ t: 'fireOut', id: b.id }); }
      for (const u of bp.workers.slice()) releaseJob(u, u._);
      if (bp.builder) releaseJob(bp.builder, bp.builder._);
      if (bp.piece) stampOcc(b, true);   // a ruined wall piece or gatehouse is passable rubble (every other ruin keeps blocking)
      emit({ t: 'ruined', id: b.id, by: by >= 0 ? by : null });
      evacuate(b, C.GARRISON_FALL, by);   // the archers on it drop to the nearest free cell, a fifth of their hit points lost
      if (bp.piece) emit({ t: 'breach', id: b.id, lord: lp.i, kind: b.kind, x: bp.cx, y: bp.cy, by: by >= 0 ? by : null });
      const k = by >= 0 && by !== lp.i ? LA[by] : null;
      if (k && !bp.wall) { addRuhm(k, MIL.indexOf(b.kind) >= 0 ? C.RUHM.razeMil : C.RUHM.raze, 'buildings', lp); k.stats.razed++; }   // (a wall line gives no Ruhm: a cheap palisade must not be a Ruhm farm)
    }
    function plunder(dl, al) {   // the keep of `dl` fell to `al`: loot, the Burgwache dies, the keep stands again under protection
      const keep = dl.keepB, loot = { korn: 0, holz: 0, stein: 0, gold: 0 };
      if (al && al !== dl) {
        for (const g of GOODS) {
          const take = Math.floor(dl.stock[g] * C.LOOT), got = Math.min(take, Math.max(0, capOf(al, g) - al.stock[g]));
          dl.stock[g] -= take; al.stock[g] += got; loot[g] = got;
        }
        { const take = Math.floor(dl.stock.gold * C.LOOT); dl.stock.gold -= take; al.stock.gold += take; loot.gold = take; syncGold(dl); syncGold(al); }   // gold has no cap: the attacker gets all of the half
        addRuhm(al, C.RUHM.plunder, 'plunder', dl); al.stats.plunders++;
      }
      for (const u of units.slice()) if (u.hp > 0 && u.lord === dl.i && u.n === 0 && u.kind !== 'bauer') killUnit(u, al ? al.i : -1, true);
      keep._.dmg = keep._.maxHp * (1 - C.PLUNDER_HP); refreshHp(keep);
      dl.pub.prot = C.PROT_S;
      emit({ t: 'plunder', lord: dl.i, by: al ? al.i : null, loot });
      const kb = keep._;   // other houses' banners marching on this keep are called home
      for (const o of LP) {
        if (o === dl) continue;
        for (const bn of o.bn) if (bn.n > 0 && Math.hypot(bn.tx - kb.cx, bn.ty - kb.cy) <= C.HOME_R) sendHome(bn);
      }
      for (const u of units) if (u.hp > 0 && u._.tb === keep) u._.tb = null;
    }

    // ---- fire ----
    function setFire(b, level, by) {   // light a wooden building (or raise its fire); `ignite` only when it was not burning
      const bp = b._;
      if (!bp.wood || b.ruined) return false;
      const was = b.fire;
      b.fire = Math.min(1, Math.max(b.fire, level));
      if (by >= 0) bp.fireBy = by;
      if (was <= 0 && b.fire > 0) emit({ t: 'ignite', id: b.id, by: by >= 0 ? by : null });
      return true;
    }
    function spreadFire(b) {
      const bp = b._;
      for (const o of bldgs) {
        if (o === b || o.ruined || !o._.wood || o.fire >= C.SPREAD_FIRE) continue;
        const ob = o._, gap = Math.hypot(Math.max(ob.x0 - bp.x1, bp.x0 - ob.x1, 0), Math.max(ob.y0 - bp.y1, bp.y0 - ob.y1, 0));
        if (gap <= (o.kind === 'hof' ? C.SPREAD_R_HOF : C.SPREAD_R)) setFire(o, C.SPREAD_FIRE, bp.fireBy);
      }
    }
    function burnCrop(b) {   // fire above 0.3 destroys the crop: growth back to 0, the field turns black
      const bp = b._;
      if (b.growth > 0) {
        const was = b.growth;
        b.growth = 0; b.burnt = 1;
        emit({ t: 'cropBurnt', id: b.id });
        const k = bp.fireBy >= 0 && bp.fireBy !== b.lord ? LA[bp.fireBy] : null;
        if (k && was > C.CROP_RUHM_AT) { addRuhm(k, C.RUHM.crop, 'crops', bp.lp); k.stats.crops++; }
      } else b.burnt = 1;
    }
    function stepFire() {
      for (const b of bldgs.slice()) {   // a ruin removes nothing from bldgs, but be safe against cancel() in the loop
        const bp = b._;
        if (!bp.wood || b.ruined) continue;
        if (b.fire > 0) {
          b.fire = Math.min(1, b.fire + C.FIRE_GROW * DT);
          damageBuilding(b, C.FIRE_DMG * b.fire * DT, bp.fireBy, true);
          if (b.ruined) continue;
          if (b.fire > C.SPREAD_AT) { if ((bp.spreadT += DT) >= C.SPREAD_AFTER_S) { bp.spreadT = 0; spreadFire(b); } } else bp.spreadT = 0;
          if (b.kind === 'hof' && b.fire > C.CROP_BURN_AT) burnCrop(b);
          if (b.burnt < b.fire) b.burnt = b.fire;
        } else {
          bp.spreadT = 0;
          if (b.burnt > 0) b.burnt = Math.max(0, b.burnt - DT / C.BURNT_FADE_S);
        }
        if (b.kind === 'hof' && !b.ruined && b.growth > 0 && b.growth < 1) b.growth = Math.min(1, b.growth + DT / C.GROW_S);
      }
    }

    // ---- Wehrgang: archers (bogen only) stand in the slots of a finished Mauer (one per cell), Torhaus (4) and Wachturm (3). Inside they shoot GARRISON_RANGE
    // farther, arrows deal GARRISON_ARMOR against them and melee cannot reach them; they keep their banner. units[].on / .slot and buildings[].garrison show it. ----
    let GX = 0, GY = 0;   // scratch result of slotXY()
    const garrisonable = (b) => b._.cap > 0 && b.build >= 1 && !b.ruined && !b._.dead;
    function slotXY(b, s) {   // the ground position of slot s: along the wall top (Mauer), on the four tower cells (Torhaus), three places on the platform (Wachturm)
      const bp = b._;
      if (b.kind === 'mauer') { GX = bp.x0 + (b.rot ? 0.5 : s + 0.5); GY = bp.y0 + (b.rot ? s + 0.5 : 0.5); }
      else if (b.kind === 'torhaus') { GX = bp.x0 + 0.5 + (b.rot ? s & 1 : (s >> 1) * 2); GY = bp.y0 + 0.5 + (b.rot ? (s >> 1) * 2 : s & 1); }
      else { GX = bp.cx + (s === 0 ? -0.45 : s === 1 ? 0.45 : 0); GY = bp.cy + (s === 2 ? 0.5 : -0.35); }
    }
    function unreserve(u, p) { if (p.gb) { if (p.gb._.gres && p.gb._.gres[p.gs] === u) p.gb._.gres[p.gs] = null; p.gb = null; p.gs = -1; } }
    function enterGarrison(u, p, b, s) {
      const bp = b._;
      unreserve(u, p);
      p.on = b; p.si = s; bp.gs[s] = u; b.garrison++;
      slotXY(b, s); u.x = GX; u.y = GY; u.on = b.id; u.slot = s;
      p.tu = null; p.tb = null; p.noEng = 0; p.scan = 1;
      emit({ t: 'garrison', lord: u.lord, id: b.id, unit: u.id, on: true });
    }
    // out of the Wehrgang: onto the nearest free cell of his house's area; `hurt` = share of his hit points lost (a collapsing wall), by = who brought it down
    function leaveGarrison(u, p, hurt, by) {
      const b = p.on;
      if (!b) return;
      const bp = b._;
      if (bp.gs[p.si] === u) bp.gs[p.si] = null;
      b.garrison--; p.on = null; p.si = -1; u.on = null; u.slot = -1; p.tu = null; p.scan = 1;
      const lp = LA[u.lord], c = snapCell(u.x, u.y, C.GARRISON_DROP_R, lp.gateCell, lp);
      if (c >= 0) { u.x = ckx(c); u.y = cky(c); }
      emit({ t: 'garrison', lord: u.lord, id: b.id, unit: u.id, on: false });
      if (hurt > 0) damageUnit(u, hurt * UN[u.kind].hp, by);
    }
    function dropSlot(u, p) {   // he died or left the game: free his slot and his reservation without moving him
      if (p.on) { const bp = p.on._; if (bp.gs[p.si] === u) bp.gs[p.si] = null; p.on.garrison--; p.on = null; p.si = -1; u.on = null; u.slot = -1; }
      unreserve(u, p);
    }
    function evacuate(b, hurt, by) {   // everybody out (a ruin, or the building was torn down), and every reservation void
      const bp = b._;
      if (!bp.cap) return;
      for (const u of bp.gs.slice()) if (u) leaveGarrison(u, u._, hurt, by);
      bp.gres.fill(null);
      for (const u of units) if (u._.gb === b) { u._.gb = null; u._.gs = -1; }
    }
    // an order on or within GARRISON_TOUCH of an own garrisonable building is a garrison order, anchored there
    function garrisonAt(lp, x, y) {
      for (const b of lp.bld) if (garrisonable(b) && rectDist(b._, x, y) <= C.GARRISON_TOUCH) return true;
      return false;
    }
    // after a new order: archers inside or on their way to a building that no longer fits the order (not near the new anchor, or no garrison order at all) leave / lose their slot
    function retargetGarrison(bn) {
      if (bn.n === 0) return;
      for (const u of bn.members) {
        const p = u._, b = p.on || p.gb;
        if (!b) continue;
        if (bn.gar && garrisonable(b) && rectDist(b._, bn.gx, bn.gy) <= C.GARRISON_NEAR) continue;
        if (p.on) leaveGarrison(u, p, 0, -1); else unreserve(u, p);
      }
    }
    // every GARRISON_S: hand the free slots to archers without one — a banner with a garrison order uses the buildings within GARRISON_NEAR of its anchor, nearest slot first;
    // the Burgwache uses every free slot within GUARD_R of the keep, nearest the gate first. Each slot goes to the nearest archer still waiting.
    const GSL = [];
    function planGarrison(lp) {
      for (const bn of lp.bn) {
        if (bn.n !== 0 && !bn.gar) continue;
        let archers = null;
        for (const u of bn.members) { const p = u._; if (u.kind === 'bogen' && u.hp > 0 && !p.on && !p.gb && p.gT <= st.t) (archers || (archers = [])).push(u); }
        if (!archers) continue;
        const guard = bn.n === 0, ax = guard ? lp.gx : bn.gx, ay = guard ? lp.gy : bn.gy;
        GSL.length = 0;
        for (const b of lp.bld) {
          if (!garrisonable(b)) continue;
          const bp = b._;
          if (!guard && rectDist(bp, ax, ay) > C.GARRISON_NEAR) continue;
          for (let sl = 0; sl < bp.cap; sl++) {
            if (bp.gs[sl] || bp.gres[sl]) continue;
            slotXY(b, sl);
            if (guard && Math.hypot(GX - lp.kx, GY - lp.ky) > C.GUARD_R) continue;
            GSL.push({ b, s: sl, d: Math.hypot(GX - ax, GY - ay) });
          }
        }
        GSL.sort((a, c) => a.d - c.d || a.b.id - c.b.id || a.s - c.s);
        for (const q of GSL) {
          if (!archers.length) break;
          slotXY(q.b, q.s);
          let bi = 0, bd = Infinity;
          for (let n = 0; n < archers.length; n++) { const v = archers[n], d = (v.x - GX) * (v.x - GX) + (v.y - GY) * (v.y - GY); if (d < bd) { bd = d; bi = n; } }
          const u = archers.splice(bi, 1)[0], p = u._;
          p.gb = q.b; p.gs = q.s; q.b._.gres[q.s] = u; p.progT = 0; p.lastD = 1e9;
        }
      }
    }

    // ---- people: creation, death, jobs ----
    function yardSpot(lp, id, p) {   // an idle peasant waits within YARD_R of the gate, on the outward side
      for (let t = 0; t < 6; t++) {
        const R = C.YARD_R, x = lp.gx + (ihash(id, 21 + t) - 0.5) * 1.3 * R, y = lp.gy + lp.out * (0.15 + ihash(id, 41 + t) * 0.6) * R, k = cellAt(x, y);
        if (k >= 0 && !viewOf(lp)[k]) { p.yx = x; p.yy = y; return; }
      }
      p.yx = lp.gx; p.yy = lp.gy;
    }
    function mkUnit(lp, kind, x, y, n) {
      const un = UN[kind], h = lp.out * Math.PI / 2;
      const u = { id: nextId++, lord: lp.i, kind, x, y, px: x, py: y, h, ph: h, hp: un.hp, anim: 'idle', carry: null, n, on: null, slot: -1 };
      const p = new UP();
      hid(u, p);
      p.scan = 1 + (u.id % 8); p.cd = rCom() * 0.5;
      yardSpot(lp, u.id, p); walkTo(p, p.yx, p.yy);
      units.push(u);
      return u;
    }
    function leaveCrew(u, p) {   // off the workplace's crew, but the job in hand goes on (a carrier of a paused workplace still delivers)
      if (!p.wb) return;
      const bp = p.wb._, ix = bp.workers.indexOf(u);
      if (ix >= 0) bp.workers.splice(ix, 1);
      p.wb.workers = bp.workers.length; p.wb = null;
    }
    function releaseJob(u, p) {   // drop whatever the peasant was doing (the load is lost) and send him to the yard
      leaveCrew(u, p);
      if (p.site) { if (p.site._.builder === u) p.site._.builder = null; p.site = null; }
      if (p.qe) { if (p.qe.u === u) { p.qe.u = null; p.qe.p = 0; } p.qe = null; }
      if (p.tree >= 0) { if (tres[p.tree] === u.id) tres[p.tree] = 0; p.tree = -1; }
      if (p.tb && p.tb._.torchBy === u) p.tb._.torchBy = null;
      p.tb = null; p.tu = null; p.store = null; p.res = null; p.load = 0; p.rest = 0;
      p.job = J.IDLE; p.ws = 0; p.t = 0; p.tw = 0; p.sub = 0; p.ox = 0;
      walkTo(p, p.yx, p.yy);
    }
    function removeUnit(u) {   // gone without a death (a hungry peasant left)
      if (u._.dead) return;
      u._.dead = true; u.hp = 0; releaseJob(u, u._);
    }
    function killUnit(v, by, silent) {   // by = killing lord's index or -1; silent: no Ruhm (a plunder wiped the Burgwache)
      const p = v._, lp = LA[v.lord];
      if (p.dead) return;   // (hp alone cannot tell: the blow that kills has already taken it to 0)
      p.dead = true; v.hp = 0;
      emit({ t: 'death', id: v.id, lord: v.lord, kind: v.kind, x: v.x, y: v.y, by: by >= 0 ? by : null });
      dropSlot(v, p);
      releaseJob(v, p);
      if (p.bn) leaveBanner(v, p);
      lp.stats.lost++;
      const k = by >= 0 && by !== v.lord ? LA[by] : null;
      if (k && !silent) { addRuhm(k, v.kind === 'ritter' ? C.RUHM.killRitter : C.RUHM.kill, 'kills', lp); k.stats.kills++; }
    }
    const startTimer = (p, base) => { p.t = 0; p.tw = base * (1 + (rEco() - 0.5) * 2 * C.JITTER); };
    function pickStore(lp, res, x, y) {   // the finished store that accepts the good and is nearest; the keep wins ties
      let best = lp.keepB, bd = Math.hypot(lp.keepB._.dx - x, lp.keepB._.dy - y);
      for (const b of lp.bld) {
        if (b.ruined || b.build < 1 || b === lp.keepB) continue;
        if (res === 'korn' ? b.kind !== 'kornspeicher' : b.kind !== 'lager') continue;
        const d = Math.hypot(b._.dx - x, b._.dy - y);
        if (d < bd - 1e-9) { bd = d; best = b; }
      }
      return best;
    }
    function startWorker(u, b) {
      const p = u._, bp = b._;
      releaseJob(u, p);
      p.job = J.TOWORK; p.sub = 0; p.wb = b; bp.workers.push(u); b.workers = bp.workers.length;
      p.ox = bp.max > 1 ? (bp.workers.length % 2 ? -0.3 : 0.3) : 0;
      walkTo(p, bp.dx + p.ox, bp.dy);
    }
    function startBuilder(u, b) {
      const p = u._, bp = b._, paid = bp.paid || {};
      releaseJob(u, p);
      p.job = J.FETCH; p.site = b; bp.builder = u;
      p.mat = (paid.holz || 0) >= (paid.stein || 0) ? 'holz' : 'stein';   // the larger part of the cost is what he carries
      p.store = pickStore(LA[u.lord], p.mat, u.x, u.y);
      walkTo(p, p.store._.dx, p.store._.dy);
    }
    function startRecruit(u, qe, kas) {
      const p = u._;
      releaseJob(u, p);
      p.job = J.RECRUIT; p.ws = 0; p.qe = qe; qe.u = u; p.store = kas;
      walkTo(p, kas._.dx, kas._.dy);
    }
    function startBucket(u, br, target) {
      const p = u._;
      releaseJob(u, p);
      p.job = J.BUCKET; p.ws = 0; p.store = br; p.tb = target;
      walkTo(p, br._.dx, br._.dy);
      emit({ t: 'bucket', brunnen: br.id, id: target.id });
    }
    function startFlee(u, p) {
      releaseJob(u, p);
      p.job = J.FLEE; p.calm = 0;
    }
    function startLeave(u, p, lp) {
      releaseJob(u, p);
      p.job = J.LEAVE; p.t = 0;
      const a = (rEco() - 0.5) * 1.6, x = lp.gx + Math.sin(a) * C.LEAVE_WALK, y = lp.gy + lp.out * Math.cos(a) * C.LEAVE_WALK;
      const k = snapCell(x, y, 8, lp.gateCell, lp);
      if (k >= 0) walkTo(p, ckx(k), cky(k)); else walkTo(p, lp.gx, lp.gy);
    }
    function startCarry(u, p) {   // the load in p.res / p.load goes to the nearest store
      const lp = LA[u.lord];
      p.job = J.CARRY; p.ws = 0;
      p.store = pickStore(lp, p.res, u.x, u.y);
      walkTo(p, p.store._.dx, p.store._.dy);
    }
    function deliver(u, p, lp) {   // true when the whole load is in; a full store takes nothing and the carrier waits
      const g = p.res, room = capOf(lp, g) - lp.stock[g];
      if (room <= 0) return false;
      const n = Math.min(p.load, room);
      lp.stock[g] += n; p.load -= n;
      if (g === 'korn') lp.fw[lp.fwI] += n;   // R9: counts into the current second of the 60-s food window
      emit({ t: 'deliver', lord: lp.i, res: g, n, store: p.store.id });
      if (p.load > 0) return false;
      p.res = null;
      return true;
    }
    function failWalk(u, p) {   // no way to where he was going: give the job up and rest a moment
      if (p.site) p.site._.unreachT = st.t + 5;
      releaseJob(u, p); p.idleT = 3;
    }
    // idle peasants of a house are assigned in the doc's priority: bucket chain, (food first:) empty Hof slots, recruits, construction sites, worker slots
    // R2: a site or recruit pulls the nearest quarry worker first, then the nearest woodcutter, and never a farmer; only the bucket chain (`any`) may pull anyone
    function takeWorker(lp, x, y, any) {   // pull a peasant off a normal job (not one that carries goods or fetches)
      let best = null, br = 9, bd = Infinity;
      for (const u of units) {
        if (u.lord !== lp.i || u.kind !== 'bauer' || u.hp <= 0) continue;
        const p = u._, j = p.job;
        if (j !== J.TOWORK && j !== J.WORK && j !== J.RETURN) continue;
        const wk = p.wb ? p.wb.kind : '', rank = any || wk === 'steinbruch' ? 0 : wk === 'holzfaeller' ? 1 : 9;
        if (rank > 1) continue;
        const d = (u.x - x) * (u.x - x) + (u.y - y) * (u.y - y);
        if (rank < br || (rank === br && d < bd)) { br = rank; bd = d; best = u; }
      }
      if (best) releaseJob(best, best._);
      return best;
    }
    const wellR = (br) => br.kind === 'bergfried' ? C.KEEP_WELL_R : C.BUCKET_R;   // reach of a well: the keep's own (R6) or a Brunnen's
    // R12: the finished training house of this kind (Kaserne or Söldnerlager) nearest to (x, y) that has a free place, i.e. fewer than TRAIN_PAR recruits other than `self` are on their way to it or in training there
    function freeTrainer(lp, at, x, y, self) {
      let best = null, bd = Infinity;
      for (const b of lp.bld) {
        if (b.kind !== at || b.build < 1 || b.ruined) continue;
        let n = 0;
        for (const q of lp.queue) if (q.u && q.u !== self && q.u._.store === b) n++;
        if (n >= C.TRAIN_PAR) continue;
        const d = Math.hypot(b._.dx - x, b._.dy - y);
        if (d < bd - 1e-9) { bd = d; best = b; }
      }
      return best;
    }
    function assignJobs(lp) {
      const idle = [];
      for (const u of units) if (u.lord === lp.i && u.kind === 'bauer' && u.hp > 0 && u._.job === J.IDLE && u._.idleT <= 0) idle.push(u);
      let nd = Infinity;   // squared distance of the last nearestIx() hit
      const nearestIx = (x, y) => {   // index in `idle` of the peasant nearest to (x, y), or -1
        let bi = -1; nd = Infinity;
        for (let n = 0; n < idle.length; n++) { const u = idle[n], d = (u.x - x) * (u.x - x) + (u.y - y) * (u.y - y); if (d < nd) { nd = d; bi = n; } }
        return bi;
      };
      const nearest = (x, y) => { const i = nearestIx(x, y); return i < 0 ? null : idle.splice(i, 1)[0]; };
      // 1. bucket chain at a burning building within reach of a finished well (up to 4 per well; below 2, pull the nearest workers).
      //    The keep is a well, too (R6 Burgbrunnen): its peasants fill their buckets at the gate and it reaches KEEP_WELL_R from the keep centre.
      for (const br of lp.bld) {
        if ((br.kind !== 'brunnen' && br.kind !== 'bergfried') || br.build < 1 || br.ruined) continue;
        const brp = br._, R = wellR(br);
        let target = null, td = Infinity;
        for (const b of lp.bld) {
          if (b.fire <= 0 || b.ruined || b.kind === 'bergfried') continue;
          const d = Math.hypot(b._.cx - brp.cx, b._.cy - brp.cy);
          if (d <= R && d < td) { td = d; target = b; }
        }
        if (!target) continue;
        let have = 0;
        for (const u of units) if (u.lord === lp.i && u.hp > 0 && u._.job === J.BUCKET && u._.store === br) have++;
        while (have < C.BUCKET_MAX) {
          let u = nearest(brp.dx, brp.dy);
          if (!u && have < C.BUCKET_MIN) u = takeWorker(lp, brp.dx, brp.dy, true);
          if (!u) break;
          startBucket(u, br, target); have++;
        }
      }
      // 1b. food first (R3): a hungry house, or one with little 🌾, fills its empty Hof slots before recruits and sites
      if (lp.hungry || lp.stock.korn < C.FOOD_LOW) {
        for (const b of lp.bld) {
          const bp = b._;
          if (b.kind !== 'hof' || b.build < 1 || b.ruined || b.paused || b.full || b.fire > C.WORK_FIRE) continue;
          while (bp.workers.length < bp.max) { const u = nearest(bp.dx, bp.dy); if (!u) break; startWorker(u, b); }
        }
      }
      // 2. queued recruits walk to the nearest finished training house of their kind (Kaserne, or Söldnerlager for torch-bearers and horse archers) with a free place
      //    (R12: TRAIN_PAR recruits per house are on their way or in training, so two Kasernen train twice as fast)
      const kas = [];   // finished training houses, each with the recruits already assigned to it
      for (const b of lp.bld) if ((b.kind === 'kaserne' || b.kind === 'soeldnerlager') && b.build >= 1 && !b.ruined) kas.push({ b, n: 0 });
      if (kas.length) {
        for (const q of lp.queue) if (q.u) { const s = q.u._.store; for (const k of kas) if (k.b === s) { k.n++; break; } }
        for (const qe of lp.queue) {
          if (qe.u) continue;
          const at = UN[qe.unit].at;
          let pk = null, pi = -1, pd = Infinity, gk = null, gd = Infinity;
          for (const k of kas) {
            if (k.b.kind !== at || k.n >= C.TRAIN_PAR) continue;
            const i = nearestIx(k.b._.dx, k.b._.dy);
            if (i >= 0 && nd < pd - 1e-9) { pd = nd; pk = k; pi = i; }   // the idle peasant and the Kaserne with room that are nearest to each other
            const g = (k.b._.dx - lp.gx) * (k.b._.dx - lp.gx) + (k.b._.dy - lp.gy) * (k.b._.dy - lp.gy);
            if (g < gd - 1e-9) { gd = g; gk = k; }                        // (for a worker who has to be pulled off his job: the Kaserne with room nearest to the gate)
          }
          if (!gk) continue;   // every house of this kind is full (or gone): this order waits for a place, the others may go on
          let u = null, k = pk;
          if (pk) u = idle.splice(pi, 1)[0];
          else { qe.wait = (qe.wait || 0) + C.ASSIGN_S; if (qe.wait >= C.PULL_WAIT_S) { k = gk; u = takeWorker(lp, k.b._.dx, k.b._.dy); } }
          if (!u) continue;
          qe.wait = 0; startRecruit(u, qe, k.b); k.n++;
        }
      }
      // 3. construction sites without a builder
      for (const b of lp.bld) {
        if (b.build >= 1 || b.ruined) continue;
        const bp = b._;
        if (bp.builder || (bp.unreachT || 0) > st.t || b.fire > C.WORK_FIRE) continue;
        let u = nearest(bp.dx, bp.dy);
        if (!u) { bp.wait = (bp.wait || 0) + C.ASSIGN_S; if (bp.wait >= C.PULL_WAIT_S) u = takeWorker(lp, bp.dx, bp.dy); }
        if (!u) continue;
        bp.wait = 0; startBuilder(u, b);
      }
      // 4. empty worker slots of finished workplaces (a resting workplace gets no workers: one that rests by order, or R11 one whose store is full)
      for (const b of lp.bld) {
        const bp = b._;
        if (b.build < 1 || b.ruined || b.paused || b.full || !bp.max || b.fire > C.WORK_FIRE) continue;
        while (bp.workers.length < bp.max) { const u = nearest(bp.dx, bp.dy); if (!u) break; startWorker(u, b); }
      }
    }

    // ---- the peasant state machine ----
    function pickTree(b, bp) {   // nearest standing, free tree of the hut that can be walked to
      const L = labelsOf(bp.lp), V = viewOf(bp.lp), rl = L[bp.door];
      let best = -1, bd = Infinity;
      for (const id of bp.cands) {
        if (trees[id] < C.STAND_AT || tlock[id] || tres[id]) continue;
        const t = world.trees[id];
        if (V[t.k] || L[t.k] !== rl) continue;
        const d = (t.x - bp.cx) * (t.x - bp.cx) + (t.y - bp.cy) * (t.y - bp.cy);
        if (d < bd) { bd = d; best = id; }
      }
      return best;
    }
    function workWood(u, p, b, bp, wf) {
      if (p.ws === 0) {   // choose a tree and walk to its foot, on the hut's side
        if (b.full) { releaseJob(u, p); return 'idle'; }   // R11: the wood store is full, so no new cycle starts: he is free for other work
        if ((p.t -= DT) > 0) return 'idle';
        const id = pickTree(b, bp);
        if (id < 0) { b.noWood = true; p.t = C.RETRY_S; return 'idle'; }
        b.noWood = false; tres[id] = u.id; p.tree = id;
        const t = world.trees[id], d = Math.hypot(bp.dx - t.x, bp.dy - t.y) || 1;
        let sx = t.x + (bp.dx - t.x) / d * 0.9, sy = t.y + (bp.dy - t.y) / d * 0.9;
        const k = cellAt(sx, sy);
        if (k < 0 || viewOf(LA[u.lord])[k]) { sx = t.x; sy = t.y; }
        walkTo(p, sx, sy); p.job = J.TOWORK; p.sub = 1;
        return 'walk';
      }
      const t = world.trees[p.tree];
      u.h = Math.atan2(t.y - u.y, t.x - u.x);
      p.t += DT * wf;
      if (p.t >= p.tw) {   // the tree falls and regrows from a stump
        const id = p.tree;
        trees[id] = 0; tres[id] = 0; p.tree = -1; regrow.push(id); st.treeV++;
        emit({ t: 'chop', lord: u.lord, tree: id });
        p.res = 'holz'; p.load = C.WOOD_N;
        startCarry(u, p);
        return 'walk';
      }
      return 'work';
    }
    function workQuarry(u, p, b, bp, wf) {
      if (p.tw <= 0) {   // a new cycle
        if (b.full) { releaseJob(u, p); return 'idle'; }   // R11: the stone store is full: he is free for other work
        startTimer(p, C.QUARRY_S);
      }
      p.t += DT * wf;
      if (p.t >= p.tw) { p.tw = 0; p.res = 'stein'; p.load = C.STONE_N; startCarry(u, p); return 'walk'; }
      return 'work';
    }
    function farmTrip(u, p) {   // carry the next KORN_N sacks of the harvest to a store
      p.load = Math.min(C.KORN_N, p.rest); p.rest -= p.load; p.res = 'korn';
      startCarry(u, p);
    }
    function workFarm(u, p, b, bp, wf) {
      switch (p.ws) {
        case 0:   // decide what the field needs
          if (p.rest > 0) { farmTrip(u, p); return 'walk'; }   // (the rest of a harvest is hauled on whatever the store says: it keeps delivering while there is room)
          if (b.full) { releaseJob(u, p); return 'idle'; }     // R11: nowhere to put a harvest, so no new cycle starts (not even sowing): he is free; the field keeps growing and stays ripe
          if (b.growth >= 1) { startTimer(p, C.HARVEST_S); p.ws = 3; }
          else if (b.growth > 0) p.ws = 2;
          else if (b.fire <= 0) { startTimer(p, C.SOW_S); p.ws = 1; }
          return 'idle';
        case 1:   // sowing
          if (b.fire > 0) { p.ws = 0; return 'idle'; }
          p.t += DT * wf;
          if (p.t >= p.tw) { b.growth = 0.05; emit({ t: 'sow', id: b.id }); p.ws = 2; }
          return 'work';
        case 2:   // the field grows by itself; the farmer waits at the farmhouse
          if (b.full) { releaseJob(u, p); return 'idle'; }     // R11: he would only stand there: he is free, the field grows on without him
          if (b.growth >= 1 || b.growth <= 0) p.ws = 0;
          return 'idle';
        default:  // harvesting
          if (b.growth < 1) { p.ws = 0; return 'idle'; }
          p.t += DT * wf;
          if (p.t >= p.tw) {
            if (b.full) { releaseJob(u, p); return 'idle'; }   // R11: the store filled up meanwhile: the crop stays ripe in the field instead of being hauled to a full store
            b.growth = 0; p.ws = 0; p.rest = bp.yieldN;
            emit({ t: 'harvest', id: b.id, n: bp.yieldN });
            farmTrip(u, p);
            return 'walk';
          }
          return 'work';
      }
    }
    function fleeScan(u, p) {
      if (p.job === J.LEAVE) return;
      const fleeing = p.job === J.FLEE, R = fleeing ? C.CALM_R : C.FLEE_R;
      near(u.x, u.y, R);
      let best = null, bd = R * R + 1e-9;
      for (let q = 0; q < QN; q++) {
        const v = units[QB[q]];
        if (v.hp <= 0 || v.kind === 'bauer' || v.lord === u.lord || !hostile(u.lord, v.lord)) continue;
        const d = (v.x - u.x) * (v.x - u.x) + (v.y - u.y) * (v.y - u.y);
        if (d < bd) { bd = d; best = v; }
      }
      p.foe = best;
      if (fleeing) { if (best) p.calm = 0; else p.calm += 8 * DT; }
      else if (best) startFlee(u, p);
    }
    function douse(b, amount) {
      if (b.fire <= 0) return;
      b.fire = Math.max(0, b.fire - amount);
      if (b.fire <= 0) { b.fire = 0; emit({ t: 'fireOut', id: b.id }); }
    }
    function nextFire(lp, br) {   // the burning building of the house nearest to the well (a Brunnen or the keep), within its reach
      let target = null, td = Infinity;
      const R = wellR(br);
      for (const b of lp.bld) {
        if (b.fire <= 0 || b.ruined || b.kind === 'bergfried') continue;
        const d = Math.hypot(b._.cx - br._.cx, b._.cy - br._.cy);
        if (d <= R && d < td) { td = d; target = b; }
      }
      return target;
    }
    function finishTraining(u, p, lp, qe) {   // the peasant becomes the soldier and walks to his banner slot
      lp.queue.splice(lp.queue.indexOf(qe), 1);
      const bn = lp.bn[qe.n];
      bn.queued--;
      p.qe = null; p.store = null; p.job = J.IDLE; p.ws = 0; p.t = 0;
      u.kind = qe.unit; u.hp = UN[qe.unit].hp; u.carry = null; u.anim = 'idle';
      joinBanner(u, p, bn);
      emit({ t: 'trained', lord: lp.i, id: u.id, unit: qe.unit });
    }
    function updatePeasant(u, p, lp) {
      const wf = lp.hungry ? C.HUNGER_WORK : 1, spd = UN.bauer.speed;
      let anim = 'idle', carry = null;
      p.moved = false;
      if (((tick + u.id) & 7) === 0) fleeScan(u, p);
      switch (p.job) {
        case J.IDLE: {
          if (p.idleT > 0) p.idleT -= DT;
          stepWalk(u, p, spd);
          anim = p.moved ? 'walk' : 'idle';
          break;
        }
        case J.TOWORK: {
          const b = p.wb;
          if (!b || b.ruined || b._.dead) { releaseJob(u, p); break; }
          const r = stepWalk(u, p, spd);
          if (r === 1) {
            p.job = J.WORK; p.ws = 0; p.t = 0;
            if (p.sub === 1) { p.ws = 1; startTimer(p, C.CHOP_S); }
            p.sub = 0;
          } else if (r < 0) failWalk(u, p);
          anim = p.moved ? 'walk' : 'idle';
          break;
        }
        case J.WORK: {
          const b = p.wb;
          if (!b || b.ruined || b._.dead) { releaseJob(u, p); break; }
          if (b.fire > C.WORK_FIRE) break;   // the workplace burns: wait it out
          anim = b.kind === 'holzfaeller' ? workWood(u, p, b, b._, wf) : b.kind === 'steinbruch' ? workQuarry(u, p, b, b._, wf) : workFarm(u, p, b, b._, wf);
          if (p.job === J.CARRY) carry = p.res;
          break;
        }
        case J.CARRY: {
          carry = p.res;
          if (p.ws === 0) {
            if (p.store.ruined || p.store._.dead) { p.store = pickStore(lp, p.res, u.x, u.y); walkTo(p, p.store._.dx, p.store._.dy); }
            const r = stepWalk(u, p, spd);
            if (r === 1) { p.ws = 1; p.t = 0; p.fwait = 0; }
            else if (r < 0) { failWalk(u, p); carry = null; }
            anim = p.moved ? 'walk' : 'idle';
          } else if ((p.t -= DT) <= 0) {   // at the store: unload, or wait for room
            const had = p.load;
            if (deliver(u, p, lp)) {
              carry = null;
              if (p.wb) { p.job = J.RETURN; walkTo(p, p.wb._.dx + p.ox, p.wb._.dy); } else releaseJob(u, p);
            } else {
              if (p.load < had) p.fwait = 0;   // part of it fitted: he keeps delivering while there is room, the wait starts over
              if (p.fwait >= C.FULL_WAIT_S - 1e-9) { releaseJob(u, p); carry = null; }   // R11: still no room: the load is lost and he is free for other work (a full store frees its workers)
              else { p.fwait += C.RETRY_S; p.t = C.RETRY_S; }
            }
          }
          break;
        }
        case J.RETURN: {
          const b = p.wb;
          if (!b || b.ruined || b._.dead) { releaseJob(u, p); break; }
          const r = stepWalk(u, p, spd);
          if (r === 1) { p.job = J.WORK; p.ws = 0; p.t = 0; p.tw = 0; }
          else if (r < 0) failWalk(u, p);
          anim = p.moved ? 'walk' : 'idle';
          break;
        }
        case J.FETCH: {
          const s = p.site;
          if (!s || s.ruined || s._.dead || s.build >= 1) { releaseJob(u, p); break; }
          if (p.store.ruined || p.store._.dead) { p.store = pickStore(lp, p.mat, u.x, u.y); walkTo(p, p.store._.dx, p.store._.dy); }
          const r = stepWalk(u, p, spd);
          if (r === 1) { p.res = p.mat; p.load = 1; p.job = J.BUILD; p.ws = 0; walkTo(p, s._.dx, s._.dy); }
          else if (r < 0) failWalk(u, p);
          anim = p.moved ? 'walk' : 'idle';
          break;
        }
        case J.BUILD: {
          const s = p.site;
          if (!s || s.ruined || s._.dead || s.build >= 1) { releaseJob(u, p); break; }
          if (p.ws === 0) {   // carrying the material to the site
            carry = p.res;
            const r = stepWalk(u, p, spd);
            if (r === 1) { p.res = null; p.load = 0; p.ws = 1; carry = null; }
            else if (r < 0) { failWalk(u, p); carry = null; }
            anim = p.moved ? 'walk' : 'idle';
          } else if (s.fire <= C.WORK_FIRE) {   // building
            const sp0 = s._, bd = C.BUILD[s.kind], dp = DT * wf / (bd.buildS * (bd.perCell ? s.len : 1));   // (a wall piece takes buildS per cell)
            s.build = Math.min(1, s.build + dp); refreshHp(s);
            u.h = Math.atan2(sp0.cy - u.y, sp0.cx - u.x);
            anim = 'work';
            if (s.build >= 1) { completeBuilding(s); releaseJob(u, p); anim = 'idle'; }
          }
          break;
        }
        case J.RECRUIT: {
          const qe = p.qe;
          if (!qe || lp.queue.indexOf(qe) < 0) { releaseJob(u, p); break; }
          let k = p.store;
          if (!k || k.ruined || k._.dead) {   // the training house is gone: the nearest other one of its kind with a free place (R12), or back to the yard
            k = freeTrainer(lp, UN[qe.unit].at, u.x, u.y, u);
            if (!k) { releaseJob(u, p); break; }
            p.store = k; p.ws = 0; p.t = 0; qe.p = 0; walkTo(p, k._.dx, k._.dy);
          }
          if (p.ws === 0) {
            const r = stepWalk(u, p, spd);
            if (r === 1) { p.ws = 1; p.t = 0; } else if (r < 0) failWalk(u, p);
            anim = p.moved ? 'walk' : 'idle';
          } else {
            const train = UN[qe.unit].train;
            p.t += DT * wf; qe.p = Math.min(1, p.t / train); anim = 'work';
            if (p.t >= train) { finishTraining(u, p, lp, qe); anim = 'idle'; }
          }
          break;
        }
        case J.BUCKET: {
          const br = p.store;
          if (!br || br.ruined || br._.dead || br.build < 1) { releaseJob(u, p); break; }
          if (!p.tb || p.tb.fire <= 0 || p.tb.ruined || p.tb._.dead) {   // the fire is out: the next one, or home
            p.tb = nextFire(lp, br);
            if (!p.tb) { releaseJob(u, p); break; }
            p.ws = 0; p.res = null; walkTo(p, br._.dx, br._.dy);
            emit({ t: 'bucket', brunnen: br.id, id: p.tb.id });
          }
          const brp = br._, wr = wellR(br);   // every bucket peasant within reach of the well takes fire off the building
          if ((u.x - brp.cx) * (u.x - brp.cx) + (u.y - brp.cy) * (u.y - brp.cy) <= wr * wr) douse(p.tb, C.BUCKET_RATE * DT);
          if (p.ws === 0) {
            const r = stepWalk(u, p, spd);
            if (r === 1) { p.ws = 1; p.t = C.BUCKET_FILL_S; } else if (r < 0) failWalk(u, p);
            anim = p.moved ? 'walk' : 'idle';
          } else if (p.ws === 1) {   // fill the bucket
            anim = 'work'; if ((p.t -= DT) <= 0) { p.res = 'eimer'; p.ws = 2; walkTo(p, p.tb._.dx, p.tb._.dy); }
          } else if (p.ws === 2) {   // carry it to the fire
            carry = 'eimer';
            const r = stepWalk(u, p, spd);
            if (r === 1) { p.ws = 3; p.t = C.BUCKET_POUR_S; } else if (r < 0) failWalk(u, p);
            anim = p.moved ? 'walk' : 'idle';
          } else {                   // pour
            carry = 'eimer'; anim = 'work';
            if ((p.t -= DT) <= 0) { p.res = null; p.ws = 0; walkTo(p, br._.dx, br._.dy); }
          }
          break;
        }
        case J.FLEE: {
          const f = p.foe;
          p.cd -= DT;
          if (f && f.hp > 0 && hostile(u.lord, f.lord) && (f.x - u.x) * (f.x - u.x) + (f.y - u.y) * (f.y - u.y) <= 1.69) {   // cornered: hit back
            u.h = Math.atan2(f.y - u.y, f.x - u.x); anim = 'fight';
            if (p.cd <= 0) { p.cd = UN.bauer.cd; hitUnit(u, UN.bauer, f); }
            break;
          }
          stepWalk(u, p, spd * 1.15);
          anim = p.moved ? 'walk' : 'idle';
          if (p.calm >= C.FLEE_RESUME_S) releaseJob(u, p);
          break;
        }
        default: {   // LEAVE
          p.t += DT;
          const r = stepWalk(u, p, spd);
          anim = p.moved ? 'walk' : 'idle';
          if (r !== 0 || p.t > 25) { removeUnit(u); emit({ t: 'leave', lord: u.lord }); }
        }
      }
      u.anim = anim; u.carry = carry;
    }

    // ---- banners: leader point, formation slots, travel field ----
    let SX = 0, SY = 0, SC = false, WPX = 0, WPY = 0;   // scratch results of slotPos() (SC: the slot collapsed onto the leader) and fieldWaypoint()
    const SCAN_STEPS = Math.max(1, Math.round(C.SCAN_S * TPS)), GAR_STEPS = Math.max(1, Math.round(C.GARRISON_S * TPS));
    function homeOf(lp, n) {   // default post of banner n (0 = Burgwache): in front of the gate, on free ground of the keep's area
      const x = lp.gx + (n === 0 ? 0 : (n - 2) * 7), y = lp.gy + lp.out * (n === 0 ? 6 : 8), k = snapCell(x, y, C.SNAP_R, lp.gateCell, lp);
      if (k < 0) return { x: lp.gx, y: lp.gy };
      return k === cellAt(x, y) ? { x, y } : { x: ckx(k), y: cky(k) };
    }
    function resetBanner(bn) {
      const h = homeOf(bn.lp, bn.n);
      bn.tx = bn.x = h.x; bn.ty = bn.y = h.y; bn.arrived = true; bn.fDirty = true; bn.fx = 0; bn.fy = bn.lp.out; bn.lk = cellAt(h.x, h.y); bn.gar = false; bn.breach = null;
    }
    function mkBanner(lp, n) {
      const bn = { lp, n, id: lp.i * 4 + n, members: [], queued: 0, x: 0, y: 0, tx: 0, ty: 0, fx: 0, fy: lp.out, field: null, fDirty: true, fNeed: false, fCool: 0,
        march: 2.6, rosterV: 0, slotV: -1, engaged: 0, lagSum: 0, lagN: 0, lag: 0, sieges: [], siegeT: 0, pub: null, arrived: true, stuckT: 0, lk: -1, nearT: false,
        breach: null, gar: false, gx: 0, gy: 0 };   // breach: the enemy wall piece the halted banner is attacking; gar/gx/gy: garrison order and its anchor
      resetBanner(bn);
      allBanners.push(bn);
      return bn;
    }
    function syncBanner(bn) {   // a banner exists while it has a soldier or a recruit in training; n = 1..3 are shown in state.banners
      const ex = bn.members.length > 0 || bn.queued > 0;
      if (ex && !bn.pub && bn.n > 0) {
        bn.pub = { id: bn.id, lord: bn.lp.i, n: bn.n, x: bn.x, y: bn.y, px: bn.x, py: bn.y, count: 0, moving: false, tx: bn.tx, ty: bn.ty };
        st.banners.push(bn.pub); st.banners.sort((a, b) => a.id - b.id);
      } else if (!ex && bn.pub) {
        st.banners.splice(st.banners.indexOf(bn.pub), 1); bn.pub = null;
        resetBanner(bn);   // a banner that died out starts over at its post
      }
    }
    function recalcMarch(bn) { let m = Infinity; for (const u of bn.members) if (UN[u.kind].speed < m) m = UN[u.kind].speed; bn.march = m === Infinity ? 2.6 : m; }
    function joinBanner(u, p, bn) {
      p.bn = bn; p.mode = 0; p.tu = null; p.tb = null; p.noEng = 0; p.wT = 0; p.progT = 0; p.lastD = 1e9;
      u.n = bn.n;
      bn.members.push(u); bn.rosterV++; recalcMarch(bn); syncBanner(bn);
    }
    function leaveBanner(u, p) {
      const bn = p.bn;
      p.bn = null;
      const ix = bn.members.indexOf(u);
      if (ix >= 0) bn.members.splice(ix, 1);
      bn.rosterV++; recalcMarch(bn); syncBanner(bn);
    }
    function sortRoster(bn) {   // riders in front, then spears and torch-bearers, archers at the back
      const arr = bn.members.slice().sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.id - b.id);
      for (let i = 0; i < arr.length; i++) arr[i]._.slot = i;
      bn.slotV = bn.rosterV;
    }
    function slotPos(bn, p) {   // world position of a soldier's slot; a slot in water or a wall collapses onto the leader
      const m = bn.members.length, row = (p.slot / C.SLOT_ROW) | 0, col = p.slot - row * C.SLOT_ROW, cols = Math.min(C.SLOT_ROW, m - row * C.SLOT_ROW);
      const off = (col - (cols - 1) / 2) * C.SLOT_GAP, back = row * C.SLOT_GAP;
      const x = bn.x - bn.fx * back - bn.fy * off, y = bn.y - bn.fy * back + bn.fx * off, k = cellAt(x, y);
      const V = viewOf(bn.lp), L = labelsOf(bn.lp);
      if (k < 0 || V[k] || (bn.lk >= 0 && L[k] !== L[bn.lk])) { SX = bn.x; SY = bn.y; SC = true; } else { SX = x; SY = y; SC = false; }
    }
    function ensureField(bn) {
      const t = cellAt(bn.tx, bn.ty);
      if (t < 0) return false;
      if (!bn.field) bn.field = new Float32Array(N);
      const F = fviewOf(bn.lp);   // the house's view, with enemy walls and gates passable at BREACH_COST
      W.field(world, [t], Lq, bn.field, F.B, F.X);
      bn.fDirty = false; bn.fCool = 1;   // a dirty field is recomputed at most once a second (new orders always recompute at once)
      return true;
    }
    // a point a few cells down the banner's travel field from (x, y), as far as line of sight reaches. WM = which step of the descent it is (0 = the very next cell: nothing
    // farther is in sight), WK = that cell; the caller looks at WK to see whether the way leads into an enemy wall
    const DESC = new Int32Array(8);
    let WM = 0, WK = -1;
    function fieldWaypoint(bn, x, y) {
      const f = bn.field, FB = fviewOf(bn.lp).B, V = viewOf(bn.lp);
      let k = cellAt(x, y);
      if (!f || k < 0 || f[k] === Infinity) return false;
      let v = f[k], ci = k % GW, cj = (k - ci) / GW, n = 0;
      for (let s = 0; s < 7; s++) {
        let best = -1, bv = v;
        for (let d = 0; d < 8; d++) {
          const ni = ci + DX[d], nj = cj + DY[d];
          if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const nk = nj * GW + ni, nv = f[nk];
          if (nv < bv && !(d >= 4 && (FB[cj * GW + ni] || FB[nj * GW + ci]))) { bv = nv; best = nk; }
        }
        if (best < 0) break;
        DESC[n++] = best; k = best; v = bv; ci = k % GW; cj = (k - ci) / GW;
        if (v === 0) break;
      }
      if (n === 0) return false;
      for (let m = n - 1; m >= 0; m--) {
        const c = DESC[m], last = f[c] === 0, px = last ? bn.tx : ckx(c), py = last ? bn.ty : cky(c);
        if (m === 0 || losClear(x, y, px, py, V)) { WPX = px; WPY = py; WM = m; WK = c; return true; }
      }
      return false;
    }
    function moveLeader(bn, eng) {   // the leader point walks down the travel field at the slowest member's pace
      const n = bn.members.length, d = Math.hypot(bn.tx - bn.x, bn.ty - bn.y);
      if (n === 0) { bn.x = bn.tx; bn.y = bn.ty; bn.lk = cellAt(bn.x, bn.y); bn.arrived = true; return; }
      if (d < 0.4) { bn.arrived = true; return; }
      bn.arrived = false;
      if (eng > 0 && eng >= Math.ceil(n * C.HOLD_FRAC)) return;   // a fight: the banner halts
      if (bn.breach) {   // standing at an enemy wall: the banner halts until the piece falls (or the way no longer leads through it, e.g. a neighbour fell first)
        const t = bn.breach;
        let hold = !(t.ruined || t._.dead || !hostile(bn.lp.i, t.lord));
        if (hold && bn.field && fieldWaypoint(bn, bn.x, bn.y)) hold = WM === 0 && bAt[WK] === t;
        if (hold) { bn.stuckT = 0; return; }
        bn.breach = null; bn.fDirty = true; bn.fCool = 0;
      }
      if (!bn.field) ensureField(bn);
      let wx = bn.tx, wy = bn.ty;
      const V = viewOf(bn.lp);
      if (bn.field && fieldWaypoint(bn, bn.x, bn.y)) {
        wx = WPX; wy = WPY;
        const wb = WM === 0 ? bAt[WK] : null;
        if (wb && breachable(bn.lp, wb) && rectDist(wb._, bn.x, bn.y) <= C.SIEGE_R) { bn.breach = wb; bn.siegeT = 0; bn.stuckT = 0; return; }   // the way leads through an enemy wall or gate: attack that piece
      } else if (!losClear(bn.x, bn.y, wx, wy, V)) {   // no route known yet: wait for a fresh field, give up after a while
        bn.fDirty = true;
        if ((bn.stuckT += DT) > 9) { bn.tx = bn.x; bn.ty = bn.y; bn.arrived = true; bn.stuckT = 0; }
        return;
      }
      const k = bn.lk, f = k >= 0 && sp[k] > 0 ? sp[k] : 0.5, coh = clamp(1 - (bn.lag - C.COH_LAG) / C.COH_SPAN, C.COH_MIN, 1);
      const ex = wx - bn.x, ey = wy - bn.y, el = Math.hypot(ex, ey) || 1, step = Math.min(el, bn.march * f * coh * DT);
      if (nudge(bn, ex / el * step, ey / el * step, V)) {
        bn.stuckT = 0;
        bn.fx += (ex / el - bn.fx) * 0.15; bn.fy += (ey / el - bn.fy) * 0.15;
        const l = Math.hypot(bn.fx, bn.fy) || 1; bn.fx /= l; bn.fy /= l;
        bn.lk = cellAt(bn.x, bn.y);
      } else if ((bn.stuckT += DT) > 3) bn.fDirty = true;
    }
    function pickSieges(bn) {   // enemy buildings the standing banner is on or within SIEGE_R of, and the wall piece a halted banner is breaking
      const out = bn.sieges;
      out.length = 0;
      if (bn.n === 0 || !bn.members.length) return;
      if (bn.breach && !bn.breach.ruined) out.push(bn.breach);
      if (!bn.arrived) return;
      for (const o of LP) {
        if (o === bn.lp || !hostile(bn.lp.i, o.i)) continue;
        for (const b of o.bld) {
          if (b.ruined || b === bn.breach || (b.kind === 'bergfried' && o.pub.prot > 0)) continue;
          if (rectDist(b._, bn.x, bn.y) <= C.SIEGE_R) out.push(b);
        }
      }
    }
    function stepBanners() {
      let recomputed = false;
      for (const bn of allBanners) {
        const eng = bn.engaged;
        bn.engaged = 0;
        bn.lag = bn.lagN ? bn.lagSum / bn.lagN : 0; bn.lagSum = 0; bn.lagN = 0;
        if (bn.slotV !== bn.rosterV) sortRoster(bn);
        if (bn.fCool > 0) bn.fCool -= DT;
        const lk = cellAt(bn.x, bn.y), V = viewOf(bn.lp);
        if (lk < 0 || V[lk]) { unstick(bn, V); bn.lk = cellAt(bn.x, bn.y); bn.fDirty = true; }   // a building went up under the leader point
        if (bn.fDirty && bn.fCool <= 0 && !recomputed && (bn.fNeed || !bn.arrived) && ensureField(bn)) recomputed = true;
        bn.fNeed = false;
        moveLeader(bn, eng);
        bn.nearT = Math.hypot(bn.tx - bn.x, bn.ty - bn.y) <= C.TORCH_START;
        if ((bn.siegeT -= DT) <= 0) { bn.siegeT = C.SCAN_S; pickSieges(bn); }
      }
    }
    function setTarget(bn, x, y, ga) {   // a new order: the travel field is recomputed at once. ga = { x, y }: a garrison order anchored at that point
      bn.tx = x; bn.ty = y; bn.arrived = false; bn.stuckT = 0; bn.breach = null;
      bn.gar = !!ga; if (ga) { bn.gx = ga.x; bn.gy = ga.y; }
      if (!(bn.members.length || bn.queued)) { bn.x = x; bn.y = y; bn.lk = cellAt(x, y); bn.arrived = true; }   // nobody to lead yet: a rally point
      else ensureField(bn);
      if (bn.pub) { bn.pub.tx = x; bn.pub.ty = y; }
      for (const u of bn.members) u._.wT = 0;
      retargetGarrison(bn);
      emit({ t: 'order', lord: bn.lp.i, n: bn.n, x, y });
    }
    function sendHome(bn) { const h = homeOf(bn.lp, bn.n); setTarget(bn, h.x, h.y); }
    function retargetBlocked() {   // a new building may stand on a banner's target: the target moves to the nearest free cell (an enemy wall piece is a fine target: it will be attacked)
      for (const bn of allBanners) {
        const k = cellAt(bn.tx, bn.ty);
        if (k >= 0 && !fviewOf(bn.lp).B[k]) continue;
        const ref = bn.members.length && bn.lk >= 0 && !viewOf(bn.lp)[bn.lk] ? bn.lk : bn.lp.gateCell, c = snapCell(bn.tx, bn.ty, C.SNAP_R, ref, bn.lp, true);
        if (c < 0) { const h = homeOf(bn.lp, bn.n); bn.tx = h.x; bn.ty = h.y; } else { bn.tx = ckx(c); bn.ty = cky(c); }
        bn.fDirty = true; bn.fCool = 0; bn.arrived = false;
        if (bn.pub) { bn.pub.tx = bn.tx; bn.pub.ty = bn.ty; }
      }
    }

    // ---- fighting ----
    function dmgVs(u, un, t) {   // a blow or arrow of a soldier against a unit: matchup, wading and Zorn
      let m = un.dmg * ((C.VS[u.kind] && C.VS[u.kind][t.kind]) || 1), k = cellAt(u.x, u.y);
      if (k >= 0 && wet[k]) m *= C.WADE_DEALT;
      k = cellAt(t.x, t.y);
      if (k >= 0 && wet[k]) m *= C.WADE_TAKEN;
      if (LA[u.lord].pub.zorn > 0) m *= C.ZORN_MUL;
      return m;
    }
    function damageUnit(v, dmg, by, src) {
      if (v.hp <= 0) return;
      v.hp -= dmg;
      if (by !== v.lord) attackAlert(LA[v.lord], v.x, v.y);
      if (src && src.hp > 0) v._.lastAtt = src;
      if (v.hp <= 0) killUnit(v, by);
    }
    function hitUnit(u, un, t) {   // a melee blow lands now
      damageUnit(t, dmgVs(u, un, t), u.lord, u);
      emit({ t: 'hit', id: t.id, x: t.x, y: t.y });
      const b = hb(t.x, t.y);
      if (st.t - clashAt[b] > C.CLASH_S) { clashAt[b] = st.t; emit({ t: 'clash', x: (u.x + t.x) / 2, y: (u.y + t.y) / 2 }); }
    }
    function flightOf(d, range) { return clamp(C.FLIGHT_MIN + (C.FLIGHT_MAX - C.FLIGHT_MIN) * (d / range) + (rCom() - 0.5) * 0.06, C.FLIGHT_MIN, C.FLIGHT_MAX); }
    function shoot(u, un, t, rng) {   // an archer's arrow: damage comes on arrival (rng = his reach, longer from a wall)
      const flight = flightOf(Math.hypot(t.x - u.x, t.y - u.y), rng || un.range);
      arrows.push({ at: tick + Math.max(1, Math.round(flight * TPS)), tu: t, tb: null, dmg: dmgVs(u, un, t), by: u.lord, src: u });
      emit({ t: 'shot', from: [u.x, u.y], to: [t.x, t.y], flight, src: 'bogen' });
    }
    function dmgBuilding(u, un, b) {   // a wall piece or gatehouse takes VS_WALL from blows and ARROW_WALL (stone 0, wood 0.15) from arrows, every other building VS_BUILDING
      const bp = b._;
      let m = un.dmg * (bp.piece ? (un.range > 3 ? (bp.wood ? C.ARROW_WALL.holz : C.ARROW_WALL.stein) : (C.VS_WALL[u.kind] || 0)) : (C.VS_BUILDING[u.kind] || 0));
      const k = cellAt(u.x, u.y);
      if (k >= 0 && wet[k]) m *= C.WADE_DEALT;
      if (LA[u.lord].pub.zorn > 0) m *= C.ZORN_MUL;
      return m;
    }
    function strikeBuilding(u, un, b) {
      const bp = b._, d = dmgBuilding(u, un, b);
      if (d <= 0) return;
      if (un.range > 3) {
        const flight = flightOf(rectDist(bp, u.x, u.y), un.range);
        arrows.push({ at: tick + Math.max(1, Math.round(flight * TPS)), tu: null, tb: b, dmg: d, by: u.lord, src: u });
        emit({ t: 'shot', from: [u.x, u.y], to: [bp.cx, bp.cy], flight, src: 'bogen' });
      } else {
        damageBuilding(b, d, u.lord);
        emit({ t: 'hit', id: b.id, x: clamp(u.x, bp.x0, bp.x1), y: clamp(u.y, bp.y0, bp.y1) });
      }
    }
    function stepArrows() {
      if (!arrows.length) return;
      let w = 0;
      for (let i = 0; i < arrows.length; i++) {
        const a = arrows[i];
        if (a.at > tick) { arrows[w++] = a; continue; }
        if (a.tu) { if (a.tu.hp > 0) { damageUnit(a.tu, a.dmg * (a.tu._.on ? C.GARRISON_ARMOR : 1) * (a.tu.kind === 'ramme' ? C.ARROW_RAM : 1), a.by, a.src); emit({ t: 'hit', id: a.tu.id, x: a.tu.x, y: a.tu.y }); } }
        else if (a.tb && !a.tb.ruined && !a.tb._.dead) { damageBuilding(a.tb, a.dmg, a.by); emit({ t: 'hit', id: a.tb.id, x: a.tb._.cx, y: a.tb._.cy }); }
      }
      arrows.length = w;
    }
    // keeps and watchtowers shoot the nearest enemy in range, torch-bearers first
    function stepTowers() {
      for (const lp of LP) for (const b of lp.bld) {
        if (b.kind !== 'bergfried' && b.kind !== 'wachturm') continue;
        const bp = b._;
        if (b.ruined || b.build < 1 || (bp.cd -= DT) > 0) continue;
        const spec = b.kind === 'bergfried' ? C.KEEP : C.TOWER, R2 = spec.range * spec.range;
        near(bp.cx, bp.cy, spec.range);
        let best = null, bf = false, bd = Infinity;
        for (let q = 0; q < QN; q++) {
          const v = units[QB[q]];
          if (v.hp <= 0 || v.lord === lp.i || !hostile(lp.i, v.lord)) continue;
          const d = (v.x - bp.cx) * (v.x - bp.cx) + (v.y - bp.cy) * (v.y - bp.cy), f = v.kind === 'fackel';
          if (d > R2) continue;
          if (!best || (f && !bf) || (f === bf && d < bd)) { best = v; bf = f; bd = d; }
        }
        if (!best) { bp.cd = 0.5; continue; }
        bp.cd = spec.cd;
        let m = spec.dmg;
        const k = cellAt(best.x, best.y);
        if (bf) m *= C.ARROW_FACKEL;   // R7: a torch-bearer is shot to pieces
        if (k >= 0 && wet[k]) m *= C.WADE_TAKEN;
        if (lp.pub.zorn > 0) m *= C.ZORN_MUL;
        const flight = flightOf(Math.sqrt(bd), spec.range);
        arrows.push({ at: tick + Math.max(1, Math.round(flight * TPS)), tu: best, tb: null, dmg: m, by: lp.i, src: null });
        emit({ t: 'shot', from: [bp.cx, bp.cy], to: [best.x, best.y], flight, src: b.kind === 'bergfried' ? 'keep' : 'turm' });
      }
    }
    function scanAlarms() {   // the Burgwache reacts to anything within GUARD_R of its keep
      for (const lp of LP) {
        near(lp.kx, lp.ky, C.GUARD_R);
        let best = null, bd = C.GUARD_R * C.GUARD_R;
        for (let q = 0; q < QN; q++) {
          const v = units[QB[q]];
          if (v.hp <= 0 || v.lord === lp.i || !hostile(lp.i, v.lord)) continue;
          const d = (v.x - lp.kx) * (v.x - lp.kx) + (v.y - lp.ky) * (v.y - lp.ky);
          if (d < bd) { bd = d; best = v; }
        }
        lp.alarm = best;
      }
    }

    // ---- the soldier ----
    function scanSoldier(u, p, un, bn, lp) {   // every 0.5 s: leash, then the nearest enemy, else a building of the standing banner
      slotPos(bn, p);
      const guard = bn.n === 0;
      if (guard ? Math.hypot(u.x - lp.kx, u.y - lp.ky) > C.GUARD_LEASH : Math.hypot(u.x - SX, u.y - SY) > C.LEASH) { p.tu = null; p.tb = null; p.noEng = C.NOENG_S; return; }
      if (p.noEng > 0) return;
      const R = un.range > 3 ? C.AGGRO_BOGEN : C.AGGRO_MELEE, Rg = guard ? Math.max(R, C.GUARD_SELF_R) : R;
      near(u.x, u.y, Rg);
      let best = null, bd = Rg * Rg + 1e-9;
      const melee = un.range <= 3;   // (a melee soldier cannot reach an archer on a wall)
      for (let q = 0; q < QN; q++) {
        const v = units[QB[q]];
        if (v.hp <= 0 || v.lord === u.lord || !hostile(u.lord, v.lord) || (melee && v._.on)) continue;
        const d = (v.x - u.x) * (v.x - u.x) + (v.y - u.y) * (v.y - u.y);
        if (d < bd) { bd = d; best = v; }
      }
      if (guard && lp.alarm && lp.alarm.hp > 0 && !(melee && lp.alarm._.on)) {
        const a = lp.alarm, d = (a.x - u.x) * (a.x - u.x) + (a.y - u.y) * (a.y - u.y);
        if (!best || d < bd) { best = a; bd = d; }
      }
      const la = p.lastAtt;   // whoever hit me from beyond my own reach is fought too
      if (!best && la && la.hp > 0 && hostile(u.lord, la.lord) && !(melee && la._.on) && (la.x - u.x) * (la.x - u.x) + (la.y - u.y) * (la.y - u.y) <= C.RETALIATE_R * C.RETALIATE_R) best = la;
      if (best) {
        if (!p.tu || best === p.tu || Math.sqrt(bd) + 1 < Math.hypot(p.tu.x - u.x, p.tu.y - u.y)) { if (p.tu !== best) { p.progT = 0; p.lastD = 1e9; } p.tu = best; }
        p.tb = null;
      } else if (!p.tu && bn.sieges.length && un.dmg > 0) {
        let bb = null, bbd = Infinity;
        for (const b of bn.sieges) { if (b.ruined || dmgBuilding(u, un, b) <= 0) continue; const d = rectDist(b._, u.x, u.y); if (d < bbd) { bbd = d; bb = b; } }   // (an arrow that cannot scratch a stone wall is no reason to stand at it)
        if (bb !== p.tb) { p.progT = 0; p.lastD = 1e9; }
        p.tb = bb;
      }
    }
    function approach(u, p, tx, ty, d, speed) {   // close in on a target; a chase that gains nothing for a second is dropped
      moveToward(u, p, tx, ty, speed);
      if ((p.progT += DT) >= C.CHASE_S) {
        if (d > p.lastD - C.CHASE_GAIN) { p.tu = null; p.tb = null; p.noEng = C.GIVEUP_S; }
        p.lastD = d; p.progT = 0;
      }
    }
    function fightUnit(u, p, un, bn) {
      const t = p.tu, dx = t.x - u.x, dy = t.y - u.y, d = Math.sqrt(dx * dx + dy * dy);
      u.h = Math.atan2(dy, dx); bn.engaged++;
      if (d > un.range) { approach(u, p, t.x, t.y, d, un.speed); return p.moved ? 'walk' : 'idle'; }
      p.progT = 0; p.lastD = 1e9;
      if (p.cd <= 0) {
        p.cd = un.cd; p.animT = C.STRIKE_ANIM_S;
        if (un.range > 3) shoot(u, un, t); else hitUnit(u, un, t);
      }
      return 'fight';
    }
    function fightBuilding(u, p, un, bn) {
      const b = p.tb, bp = b._, d = rectDist(bp, u.x, u.y);
      bn.engaged++;
      if (d > un.range) {
        u.h = Math.atan2(bp.cy - u.y, bp.cx - u.x);
        approach(u, p, clamp(u.x, bp.x0, bp.x1), clamp(u.y, bp.y0, bp.y1), d, un.speed);
        return p.moved ? 'walk' : 'idle';
      }
      p.progT = 0; p.lastD = 1e9;
      u.h = Math.atan2(bp.cy - u.y, bp.cx - u.x);
      if (p.cd <= 0) { p.cd = un.cd; p.animT = C.STRIKE_ANIM_S; strikeBuilding(u, un, b); }
      return 'fight';
    }
    function formation(u, p, un, bn) {   // follow the travel field while far from the slot, then walk onto it
      slotPos(bn, p);
      const dx = SX - u.x, dy = SY - u.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 12) { bn.lagSum += d; bn.lagN++; }
      if (d < (SC ? 2.2 : 0.25)) { u.h = Math.atan2(bn.fy, bn.fx); return 'idle'; }   // (a collapsed slot is a crowd around the leader: no shuffling)
      let tx = SX, ty = SY;
      if (d > C.FOLLOW_R || (d > C.SLOT_LOS_R && !losClear(u.x, u.y, SX, SY, viewOf(bn.lp)))) {   // far from the slot, or a wall or building in between: follow the field around it
        bn.fNeed = true;
        if (bn.field) {
          if (--p.wT <= 0 || (p.wx - u.x) * (p.wx - u.x) + (p.wy - u.y) * (p.wy - u.y) < 0.5) {
            if (fieldWaypoint(bn, u.x, u.y)) { p.wx = WPX; p.wy = WPY; } else { p.wx = SX; p.wy = SY; }
            p.wT = 6;
          }
          tx = p.wx; ty = p.wy;
        }
      }
      moveToward(u, p, tx, ty, d < 4 ? Math.min(un.speed, bn.march * 1.15 + d) : un.speed);
      return p.moved ? 'walk' : 'idle';
    }
    function pickTorchTarget(u, bn, lp) {   // an enemy wooden building within TORCH_R of the banner target that is not burning or claimed
      let best = null, bd = Infinity;
      for (const o of LP) {
        if (o === lp || !hostile(lp.i, o.i)) continue;
        for (const b of o.bld) {
          const bp = b._;
          if (!bp.wood || b.ruined || b.fire > 0.1 || (bp.torchBy && bp.torchBy !== u && bp.torchBy.hp > 0)) continue;
          if (rectDist(bp, bn.tx, bn.ty) > C.TORCH_R) continue;
          const d = rectDist(bp, u.x, u.y);
          if (d < bd) { bd = d; best = b; }
        }
      }
      return best;
    }
    function updateTorch(u, p, un, bn, lp) {   // torch-bearers run to a target building and light it; they never fight and dodge melee units
      if (p.dodgeT > 0) {
        p.dodgeT -= DT;
        moveToward(u, p, u.x + p.ax * 3, u.y + p.ay * 3, un.speed);
        return p.moved ? 'walk' : 'idle';
      }
      if (((tick + u.id) % 3) === 0) {
        near(u.x, u.y, C.TORCH_DODGE_R);
        let ax = 0, ay = 0;
        for (let q = 0; q < QN; q++) {
          const v = units[QB[q]];
          if (v.hp <= 0 || (v.kind !== 'speer' && v.kind !== 'ritter') || v.lord === u.lord || !hostile(u.lord, v.lord)) continue;
          const dx = u.x - v.x, dy = u.y - v.y, d2 = dx * dx + dy * dy;
          if (d2 < C.TORCH_DODGE_R * C.TORCH_DODGE_R && d2 > 1e-6) { const d = Math.sqrt(d2); ax += dx / d; ay += dy / d; }
        }
        if (ax !== 0 || ay !== 0) { const l = Math.hypot(ax, ay); p.ax = ax / l; p.ay = ay / l; p.dodgeT = C.DODGE_S; }
      }
      if (p.tb && (p.tb.ruined || p.tb._.dead || p.tb.fire > 0.1 || !hostile(u.lord, p.tb.lord))) { if (p.tb._.torchBy === u) p.tb._.torchBy = null; p.tb = null; }
      if (!p.tb && bn.nearT && --p.scan <= 0) {
        p.scan = SCAN_STEPS;
        const b = pickTorchTarget(u, bn, lp);
        if (b) { p.tb = b; b._.torchBy = u; p.progT = 0; p.lastD = 1e9; }
      }
      if (!p.tb) return formation(u, p, un, bn);
      const b = p.tb, bp = b._, d = rectDist(bp, u.x, u.y);
      if (d > un.range) {
        u.h = Math.atan2(bp.cy - u.y, bp.cx - u.x);
        moveToward(u, p, clamp(u.x, bp.x0, bp.x1), clamp(u.y, bp.y0, bp.y1), un.speed);
        if ((p.progT += DT) >= C.CHASE_S) { if (d > p.lastD - C.CHASE_GAIN) { bp.torchBy = null; p.tb = null; } p.lastD = d; p.progT = 0; }
        return p.moved ? 'walk' : 'idle';
      }
      setFire(b, b.fire + C.IGNITE, u.lord);   // the torch goes in; the next building is picked on the next scan
      lp.stats.ignites++;
      bp.torchBy = null; p.tb = null; p.scan = 1;
      return 'work';
    }
    // The Rammbock deals no damage to people. It attacks the nearest enemy wall, gate or building within RAM_R; the blow lands at the end of its swing (cd 2 s, shown as 'fight').
    // With nothing near it keeps its place at the front of the banner.
    function updateRam(u, p, un, bn, lp) {
      if (!p.tb && p.noEng <= 0 && --p.scan <= 0) {
        p.scan = SCAN_STEPS;
        let best = bn.breach && !bn.breach.ruined && rectDist(bn.breach._, u.x, u.y) <= C.RAM_R ? bn.breach : null, bd = C.RAM_R + 1e-9;   // (the piece its banner is breaking comes first)
        if (!best) for (const o of LP) {
          if (o === lp || !hostile(lp.i, o.i)) continue;
          for (const b of o.bld) {
            if (b.ruined || (b.kind === 'bergfried' && o.pub.prot > 0)) continue;
            const d = rectDist(b._, u.x, u.y);
            if (d < bd) { bd = d; best = b; }
          }
        }
        if (best) { p.tb = best; p.swing = 0; p.progT = 0; p.lastD = 1e9; }
      }
      const b = p.tb;
      if (!b) { p.swing = 0; return formation(u, p, un, bn); }
      const bp = b._, d = rectDist(bp, u.x, u.y);
      u.h = Math.atan2(bp.cy - u.y, bp.cx - u.x);
      if (d > un.range) {   // up to the target (a chase that gains nothing is dropped, as for every soldier)
        p.swing = 0;
        approach(u, p, clamp(u.x, bp.x0, bp.x1), clamp(u.y, bp.y0, bp.y1), d, un.speed);
        return p.moved ? 'walk' : 'idle';
      }
      p.progT = 0; p.lastD = 1e9;
      if (p.swing <= 0) p.swing = un.cd;   // begin the swing
      if ((p.swing -= DT) <= 0) {   // … and the blow lands at its end; the next swing begins at once
        p.swing = un.cd;
        const dm = dmgBuilding(u, un, b);
        if (dm > 0) {
          damageBuilding(b, dm, u.lord);
          emit({ t: 'hit', id: b.id, x: clamp(u.x, bp.x0, bp.x1), y: clamp(u.y, bp.y0, bp.y1) });
          emit({ t: 'ram', id: b.id, x: clamp(u.x, bp.x0, bp.x1), y: clamp(u.y, bp.y0, bp.y1) });
        }
      }
      return 'fight';
    }
    // The Reiterschütze shoots on the move (it keeps following its banner while a target is within reach) and backs away from a melee enemy within KITE_R while it reloads.
    function updateRider(u, p, un, bn, lp) {
      if (p.dodgeT > 0) p.dodgeT -= DT;
      if (((tick + u.id) % 3) === 0) {
        near(u.x, u.y, C.KITE_R);
        let ax = 0, ay = 0;
        for (let q = 0; q < QN; q++) {
          const v = units[QB[q]];
          if (v.hp <= 0 || v.lord === u.lord || !hostile(u.lord, v.lord) || v._.on || v.kind === 'bauer') continue;
          const uv = UN[v.kind];
          if (uv.dmg <= 0 || uv.range > 3) continue;   // melee soldiers only
          const dx = u.x - v.x, dy = u.y - v.y, d2 = dx * dx + dy * dy;
          if (d2 < C.KITE_R * C.KITE_R && d2 > 1e-6) { const d = Math.sqrt(d2); ax += dx / d; ay += dy / d; }
        }
        if ((ax !== 0 || ay !== 0) && p.cd > 0) { const l = Math.hypot(ax, ay); p.ax = ax / l; p.ay = ay / l; p.dodgeT = C.KITE_S; }
      }
      if (--p.scan <= 0) { p.scan = SCAN_STEPS; scanSoldier(u, p, un, bn, lp); }
      let anim;
      const t = p.tu;
      if (p.dodgeT > 0) { moveToward(u, p, u.x + p.ax * 3, u.y + p.ay * 3, un.speed); anim = p.moved ? 'walk' : 'idle'; }
      else if (t) {
        const dx = t.x - u.x, dy = t.y - u.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > un.range) { bn.engaged++; approach(u, p, t.x, t.y, d, un.speed); anim = p.moved ? 'walk' : 'idle'; }
        else { p.progT = 0; p.lastD = 1e9; anim = formation(u, p, un, bn); }   // in reach: keep riding with the banner and shoot on the way
      } else anim = p.tb ? fightBuilding(u, p, un, bn) : formation(u, p, un, bn);
      if (t && t.hp > 0 && p.cd <= 0) {
        const dx = t.x - u.x, dy = t.y - u.y;
        if (dx * dx + dy * dy <= un.range * un.range) { p.cd = un.cd; p.animT = C.STRIKE_ANIM_S; if (!p.moved) u.h = Math.atan2(dy, dx); shoot(u, un, t); }
      }
      return anim;
    }
    // an archer on a wall: he stays, shoots the nearest enemy within his raised reach and is no target for melee
    function updateGarrisoned(u, p, un, bn, lp) {
      const b = p.on;
      if (b.ruined || b._.dead || b.build < 1) { leaveGarrison(u, p, 0, -1); return 'idle'; }
      const R = un.range + C.GARRISON_RANGE;
      if (--p.scan <= 0) {
        p.scan = SCAN_STEPS;
        near(u.x, u.y, R);
        let best = null, bd = R * R + 1e-9;
        for (let q = 0; q < QN; q++) {
          const v = units[QB[q]];
          if (v.hp <= 0 || v.lord === u.lord || !hostile(u.lord, v.lord)) continue;
          const d = (v.x - u.x) * (v.x - u.x) + (v.y - u.y) * (v.y - u.y);
          if (d < bd) { bd = d; best = v; }
        }
        p.tu = best;
      }
      const t = p.tu;
      if (!t) return 'idle';
      const dx = t.x - u.x, dy = t.y - u.y;
      if (t.hp <= 0 || !hostile(u.lord, t.lord) || dx * dx + dy * dy > R * R) { p.tu = null; return 'idle'; }
      u.h = Math.atan2(dy, dx);
      if (p.cd <= 0) { p.cd = un.cd; p.animT = C.STRIKE_ANIM_S; shoot(u, un, t, R); }
      return 'idle';
    }
    // an archer with a reserved slot: close to the building he walks straight to it and climbs in; null = not yet near (the normal banner logic moves him)
    function walkToGarrison(u, p, un) {
      const b = p.gb, bp = b._;
      if (!garrisonable(b) || bp.gres[p.gs] !== u) { unreserve(u, p); return null; }
      const d = rectDist(bp, u.x, u.y);
      if (d <= C.GARRISON_ENTER_R) { enterGarrison(u, p, b, p.gs); return 'idle'; }
      if (d > C.GARRISON_WALK_R) return null;
      u.h = Math.atan2(bp.cy - u.y, bp.cx - u.x);
      moveToward(u, p, clamp(u.x, bp.x0, bp.x1), clamp(u.y, bp.y0, bp.y1), un.speed);
      if ((p.progT += DT) >= C.CHASE_S) {   // no way in (something is in the way): give the slot up for a while
        if (d > p.lastD - C.CHASE_GAIN) { unreserve(u, p); p.gT = st.t + C.GARRISON_RETRY_S; return 'idle'; }
        p.lastD = d; p.progT = 0;
      }
      return p.moved ? 'walk' : 'idle';
    }
    function updateSoldier(u, p, lp) {
      const un = UN[u.kind], bn = p.bn;
      p.moved = false; p.cd -= DT;
      if (p.noEng > 0) p.noEng -= DT;
      if (p.animT > 0) p.animT -= DT;
      if (p.tu && (p.tu.hp <= 0 || !hostile(u.lord, p.tu.lord) || (p.tu._.on && !p.on && un.range <= 3))) p.tu = null;
      if (p.tb && u.kind !== 'fackel' && (p.tb.ruined || p.tb._.dead || !hostile(u.lord, p.tb.lord) || (p.tb.kind === 'bergfried' && LA[p.tb.lord].pub.prot > 0))) p.tb = null;
      let anim = null;
      if (p.on) anim = updateGarrisoned(u, p, un, bn, lp);
      else if (u.kind === 'fackel') anim = updateTorch(u, p, un, bn, lp);
      else if (u.kind === 'ramme') anim = updateRam(u, p, un, bn, lp);
      else if (u.kind === 'reiterschuetze') anim = updateRider(u, p, un, bn, lp);
      else if (p.gb) anim = walkToGarrison(u, p, un);   // on his way into a wall or tower (null while he is still far away: he travels with his banner)
      if (anim === null) {
        if (--p.scan <= 0) { p.scan = SCAN_STEPS; scanSoldier(u, p, un, bn, lp); }
        anim = p.tu ? fightUnit(u, p, un, bn) : p.tb ? fightBuilding(u, p, un, bn) : formation(u, p, un, bn);
      }
      u.anim = anim === 'idle' && p.animT > 0 ? 'fight' : anim;
      u.carry = null;
    }
    function separate() {   // people push each other apart by their radii; workers stand firm
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.hp <= 0 || u._.on) continue;
        const ru = UN[u.kind].r;
        near(u.x, u.y, 1.4);
        for (let q = 0; q < QN; q++) {
          const j = QB[q];
          if (j <= i) continue;
          const v = units[j];
          if (v.hp <= 0 || v._.on) continue;
          const rv = UN[v.kind].r, rr = ru + rv, dx = v.x - u.x, dy = v.y - u.y, d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr) continue;
          let nx, ny, d = Math.sqrt(d2);
          if (d < 1e-3) { const a = ihash(u.id, v.id) * 6.2832; nx = Math.cos(a); ny = Math.sin(a); d = 0; } else { nx = dx / d; ny = dy / d; }
          const push = (rr - d) * C.SEP;
          let wu = rv / rr, wv = ru / rr;
          if (u.anim === 'work') { wu = 0; wv = 1; } else if (v.anim === 'work') { wu = 1; wv = 0; }
          if (wu > 0) nudge(u, -nx * push * wu, -ny * push * wu, viewOf(LA[u.lord]));
          if (wv > 0) nudge(v, nx * push * wv, ny * push * wv, viewOf(LA[v.lord]));
        }
      }
    }

    // ---- the house: arrivals, eating, hunger, prosperity, timers ----
    function leaveOne(lp) {   // a hungry house loses its newest idle peasant (else its newest peasant), but never below FLOOR peasants (R1)
      let n = 0, pick = null;
      for (const u of units) if (u.lord === lp.i && u.kind === 'bauer' && u.hp > 0 && u._.job !== J.LEAVE) n++;
      if (n <= C.FLOOR) return;
      for (let i = units.length - 1; i >= 0 && !pick; i--) { const u = units[i]; if (u.lord === lp.i && u.kind === 'bauer' && u.hp > 0 && u._.job === J.IDLE) pick = u; }
      for (let i = units.length - 1; i >= 0 && !pick; i--) { const u = units[i]; if (u.lord === lp.i && u.kind === 'bauer' && u.hp > 0 && u._.job !== J.LEAVE && !u._.qe) pick = u; }
      if (pick) startLeave(pick, pick._, lp);
    }
    function foeAtGate(lp) {   // an enemy soldier within GATE_SAFE_R of the gate (a plain scan: stepLord runs before this step's hashBuild)
      const R2 = C.GATE_SAFE_R * C.GATE_SAFE_R;
      for (const v of units) {
        if (v.hp <= 0 || v.kind === 'bauer' || !hostile(lp.i, v.lord)) continue;
        if ((v.x - lp.gx) * (v.x - lp.gx) + (v.y - lp.gy) * (v.y - lp.gy) <= R2) return true;
      }
      return false;
    }
    function stepLord(lp) {
      const pub = lp.pub;
      syncFull(lp);   // R11: which workplaces rest because their store is full
      if (tick % TPS === 0) { lp.fwI = (lp.fwI + 1) % FOOD_WIN; lp.fw[lp.fwI] = 0; }   // R9: the food window moves on by one second
      // the timer runs only while a peasant could arrive; below FLOOR peasants they come even when hungry or out of 🌾 (R1: never a dead end)
      const normal = lp.stock.korn >= 1 && !lp.hungry;   // a normal arrival (food and no hunger) …
      if (pub.people < popCap(lp) && (normal || pub.people - pub.soldiers < C.FLOOR)) {
        if ((lp.arriveT += DT) >= C.ARRIVE_S - 1e-9) {
          if (!normal && foeAtGate(lp)) lp.arriveT = C.ARRIVE_S;   // R10: … is a reinforcement and comes during a siege; only an R1 arrival (hungry or out of 🌾) waits at the threshold for a clear gate
          else {
            lp.arriveT = 0;
            const u = mkUnit(lp, 'bauer', lp.gx, lp.gy, -1);
            u._.job = J.IDLE; pub.people++;
            emit({ t: 'arrive', lord: lp.i });
          }
        }
      } else lp.arriveT = 0;
      lp.eatAcc += pub.people * DT / C.EAT_S;   // everybody eats; a missing sack waits for the next delivery
      while (lp.eatAcc >= 1) { if (lp.stock.korn >= 1) { lp.stock.korn--; lp.eatAcc--; } else { lp.eatAcc = 1; break; } }
      const hungry = lp.stock.korn < 1 && pub.people > 0;
      if (hungry !== lp.hungry) { lp.hungry = hungry; pub.hunger = hungry; lp.leaveT = 0; emit({ t: 'hunger', lord: lp.i, on: hungry }); }
      if (hungry) { if ((lp.leaveT += DT) >= C.LEAVE_S - 1e-9) { lp.leaveT = 0; leaveOne(lp); } }
      if ((lp.prosT += DT) >= C.PROSPER_S - 1e-9) { lp.prosT = 0; addRuhm(lp, Math.floor(pub.people / C.PROSPER_PEOPLE) * C.RUHM.prosperity, 'prosperity'); }
      if (pub.prot > 0 && (pub.prot -= DT) <= 1e-6) { pub.prot = 0; emit({ t: 'protEnd', lord: lp.i }); }
      if (pub.zorn > 0) pub.zorn = Math.max(0, pub.zorn - DT);
    }
    function stepRegrow() {
      if (!regrow.length) return;
      let w = 0, changed = false;
      for (const id of regrow) {
        if (tlock[id]) continue;
        const was = trees[id];
        trees[id] = Math.min(1, was + DT / C.REGROW_S);
        if (was < C.STAND_AT && trees[id] >= C.STAND_AT) changed = true;
        if (trees[id] < 1) regrow[w++] = id; else changed = true;
      }
      regrow.length = w;
      if (changed || tick % TPS === 0) st.treeV++;   // saplings grow quietly: the view hears about it once a second
    }

    // ---- crown, pacts, ranking ----
    function updateCrown() {
      let a = null, b = null;
      for (const lp of LP) {
        const r = lp.pub.ruhm;
        if (!a || r > a.pub.ruhm) { b = a; a = lp; } else if (!b || r > b.pub.ruhm) b = lp;
      }
      const holder = a && a.pub.ruhm - (b ? b.pub.ruhm : 0) >= C.CROWN_LEAD ? a.i : -1;
      if (holder === crownI) return;
      crownI = holder;
      for (const lp of LP) lp.pub.crown = lp.i === holder;
      emit({ t: 'crown', lord: holder >= 0 ? holder : null });
    }
    function syncPacts() {
      const out = [];
      for (const a of LP) for (const b of LP) if (a.i < b.i && PM[a.i * M + b.i] > 0) out.push({ a: a.i, b: b.i, until: PM[a.i * M + b.i] });
      for (const a of LP) for (const b of LP) if (a !== b && OF[a.i * M + b.i] > 0) out.push({ a: a.i, b: b.i, offerUntil: OF[a.i * M + b.i] });
      for (const a of LP) for (const b of LP) if (a.i < b.i && GR[a.i * M + b.i] > 0) out.push({ a: a.i, b: b.i, until: GR[a.i * M + b.i], grace: true });   // (the Abzug: the view still opens the gates for the two)
      st.pacts.length = 0;
      for (const o of out) st.pacts.push(o);
    }
    // P2 Abzug: when a pact runs out, the banners of `lp` (not its Burgwache) aimed within PACT_ZONE + ABZUG_PAD of a building of `other` go home, the way plunder protection sends them
    function abzug(lp, other) {
      const R = C.PACT_ZONE + C.ABZUG_PAD;
      for (const bn of lp.bn) {
        if (bn.n === 0) continue;
        for (const b of other.bld) if (rectDist(b._, bn.tx, bn.ty) <= R) { sendHome(bn); break; }
      }
    }
    function stepPacts() {
      let changed = false, gate = false;
      for (const a of LP) for (const b of LP) {
        if (a === b) continue;
        const ab = a.i * M + b.i, ba = b.i * M + a.i;
        if (OF[ab] > 0 && OF[ab] <= st.t + 1e-9) { OF[ab] = 0; changed = true; emit({ t: 'pactOff', a: a.i, b: b.i, reason: 'expired' }); }
        if (a.i > b.i) continue;   // what follows is per pair
        if (PM[ab] > 0 && PM[ab] <= st.t + 1e-9) {   // the pact ran out (P2): peace for PACT_GRACE_S more, and the banners aimed at the other's land go home
          PM[ab] = PM[ba] = 0; RN[ab] = RN[ba] = 0; GR[ab] = GR[ba] = st.t + C.PACT_GRACE_S; changed = true;
          emit({ t: 'pactOff', a: a.i, b: b.i, reason: 'expired', grace: GR[ab] });
          abzug(a, b); abzug(b, a);
        }
        if (GR[ab] > 0 && GR[ab] <= st.t + 1e-9) { GR[ab] = GR[ba] = 0; changed = true; gate = true; }   // the grace is over: hostile again, the gate lanes close
      }
      if (changed) syncPacts();
      if (gate) gridChanged();
    }
    function makeRanking() {
      const rows = LP.map(lp => {
        let buildings = 0;
        for (const b of lp.bld) if (b.kind !== 'bergfried' && !b._.wall && b.build >= 1 && !b.ruined) buildings++;
        return { rank: 0, lord: lp.i, ruhm: lp.pub.ruhm, people: lp.pub.people, soldiers: lp.pub.soldiers, buildings, stats: Object.assign({}, lp.stats), by: Object.assign({}, lp.by) };
      });
      rows.sort((a, b) => b.ruhm - a.ruhm || b.people - a.people || b.buildings - a.buildings || a.lord - b.lord);
      rows.forEach((r, i) => { r.rank = i + 1; });
      return rows;
    }

    // ---- phases and the water ----
    function stepPhases() {
      const L = tick < tEbbe ? 1 : tick < tFehde ? 1 - (tick - tEbbe) / (tFehde - tEbbe) : 0;
      st.level = L;
      if (tick === 1) emit({ t: tEbbe > 0 ? 'frieden' : 'ebbe' });
      if (tEbbe > 0 && tick === tEbbe - Math.round(C.WARN_S * TPS) && tick >= 1) emit({ t: 'warn', kind: 'ebbe', in: C.WARN_S });
      if (tick === tEbbe && tEbbe > 0) emit({ t: 'ebbe' });
      if (tick === tFehde) emit({ t: 'fehde' });
      if (!lastMinute && tick >= tEnd - Math.round(C.LAST_S * TPS)) { lastMinute = true; emit({ t: 'lastMinute' }); }
      st.phase = tick >= tFehde ? 'fehde' : tick >= tEbbe ? 'ebbe' : 'frieden';
      world.crossings.forEach((c, i) => {
        if (crossOpened[i] || !(c.open >= 0) || L > c.open + 1e-9) return;
        crossOpened[i] = true;
        emit({ t: 'crossingOpen', id: c.id });
        markFieldsDirty();
      });
      refreshGrids();
    }

    // ---- one step ----
    function step() {
      if (st.phase === 'over') { ev = []; return []; }
      tick++; st.t = tick * DT; st.dayT = Math.min(1, st.t / st.endsAt); routeBudget = C.ROUTES_PER_STEP;
      for (const u of units) { u.px = u.x; u.py = u.y; u.ph = u.h; }
      for (const b of st.banners) { b.px = b.x; b.py = b.y; }
      stepPhases();
      for (const lp of LP) stepLord(lp);
      hashBuild();
      if (tick % SCAN_STEPS === 0) scanAlarms();
      for (const lp of LP) if ((tick + lp.k * 5) % TPS === 0) assignJobs(lp);
      for (const lp of LP) if ((tick + lp.k * 5 + 2) % GAR_STEPS === 0) planGarrison(lp);
      stepRegrow();
      stepBanners();
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.hp <= 0) continue;
        const k = cellAt(u.x, u.y);
        if (!u._.on) { const V = viewOf(LA[u.lord]); if (k < 0 || V[k]) unstick(u, V); }   // (a garrisoned archer stands on a wall: that cell is blocked on purpose)
        if (u.kind === 'bauer') updatePeasant(u, u._, LA[u.lord]); else updateSoldier(u, u._, LA[u.lord]);
      }
      stepFire();
      stepTowers();
      stepArrows();
      separate();
      let w = 0;
      for (const lp of LP) { lp.pub.people = 0; lp.pub.soldiers = 0; }
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.hp <= 0) continue;
        units[w++] = u;
        const pub = LA[u.lord].pub;
        pub.people++;
        if (u.kind !== 'bauer') pub.soldiers++;
      }
      units.length = w;
      for (const bn of allBanners) {
        syncBanner(bn);
        const pb = bn.pub;
        if (!pb) continue;
        const m = bn.members;
        if (m.length) {
          let sx = 0, sy = 0;
          for (const u of m) { sx += u.x; sy += u.y; }
          pb.x = sx / m.length; pb.y = sy / m.length;
        } else { pb.x = bn.x; pb.y = bn.y; }
        pb.count = m.length; pb.moving = !bn.arrived && bn.engaged === 0; pb.tx = bn.tx; pb.ty = bn.ty;
      }
      if ((crownT -= DT) <= 0) { crownT = C.CROWN_S; updateCrown(); }
      for (const lp of LP) lp.pub.gold = lp.stock.gold;
      stepPacts();
      if (tick >= tEnd) {
        st.phase = 'over';
        st.ranking = makeRanking();
        emit({ t: 'over', ranking: st.ranking });
      }
      const out = ev;
      ev = [];
      return out;
    }

    // ---- public API ----
    const bad = (reason) => ({ ok: false, reason });
    // `len` is for the wall lines only (palisade, mauer: 1..4 cells, default 1; anything else is 'bounds'); a ruin is rebuilt only with its own len
    function build(lord, kind, i, j, rot, len) {
      const lp = lordOf(lord);
      if (!lp) return bad('lord');
      if (typeof kind !== 'string' || !own(C.BUILD, kind) || kind === 'bergfried' || !own(W.BUILDINGS, kind)) return bad('kind');
      if (st.phase === 'over') return bad('phase');
      if (rot === undefined || rot === null || rot === false) rot = 0; else if (rot === true) rot = 1;
      if (!int(i) || !int(j) || (rot !== 0 && rot !== 1)) return bad('bounds');
      if (W.isWall(kind)) { if (len === undefined || len === null) len = 1; if (!int(len) || len < 1 || len > W.BUILDINGS[kind].maxLen) return bad('bounds'); } else len = 1;
      let ruin = null;   // a ruin of the same kind on exactly this footprint is rebuilt for half the cost and keeps its id
      for (const b of lp.bld) if (b.ruined && b.kind === kind && b.i === i && b.j === j && b.rot === rot && b.len === len) { ruin = b; break; }
      if (!ruin) {
        const r = W.canPlace(world, kind, i, j, rot, { lord: lp.site, L: st.level, occ, len });
        if (!r.ok) return bad(r.reason);
      }
      const door = ruin ? ruin._.door : findDoor(lp, kind, i, j, rot, len);
      if (door < 0) return bad('wet');   // no dry way from the keep to its door
      const cost = costOf(kind, !!ruin, len);
      for (const g of GOODS) if (cost[g] > lp.stock[g]) return bad('cost');
      for (const g of GOODS) lp.stock[g] -= cost[g];
      if (ruin) {
        const bp = ruin._;
        ruin.ruined = false; ruin.build = 0; ruin.fire = 0; ruin.burnt = 0; ruin.growth = kind === 'hof' ? 0 : 1;
        bp.dmg = 0; refreshHp(ruin); bp.paid = cost; bp.builder = null; bp.fireBy = -1; bp.spreadT = 0; bp.wait = 0; bp.unreachT = 0;
        if (bp.piece) stampOcc(ruin, true);
        emit({ t: 'rebuild', id: ruin.id });
        return { ok: true, id: ruin.id };
      }
      const b = mkBuilding(lp, kind, i, j, rot, 0, door, len);
      b._.paid = cost;
      stampOcc(b, true); fellFootprint(b); retargetBlocked();
      emit({ t: 'build', lord: lp.i, id: b.id, kind });
      return { ok: true, id: b.id };
    }
    // A line of wall pieces [[i, j, rot, len], …] placed in order while the stock lasts. Answers { ok, placed, reason? }: ok = at least one piece stands;
    // `reason` (when not every piece was placed) is why the first one failed. A piece that cannot be placed is skipped, but an empty stock ends the line ('cost').
    function buildWall(lord, kind, pieces) {
      const lp = lordOf(lord);
      if (!lp) return { ok: false, placed: 0, reason: 'lord' };
      if (typeof kind !== 'string' || !WALLS.includes(kind)) return { ok: false, placed: 0, reason: 'kind' };
      if (st.phase === 'over') return { ok: false, placed: 0, reason: 'phase' };
      if (!Array.isArray(pieces) || pieces.length === 0 || pieces.length > C.WALL_PIECES_MAX) return { ok: false, placed: 0, reason: 'bounds' };
      let placed = 0, why;
      for (const pc of pieces) {
        const r = Array.isArray(pc) ? build(lord, kind, pc[0], pc[1], pc[2], pc[3]) : bad('bounds');
        if (r.ok) { placed++; continue; }
        if (!why) why = r.reason;
        if (r.reason === 'cost') break;
      }
      return placed ? (why ? { ok: true, placed, reason: why } : { ok: true, placed }) : { ok: false, placed: 0, reason: why || 'bounds' };
    }
    // The Markt: sell packs of TRADE_PACK goods for 💰 or buy them. Answers { ok, n, reason? } with n = packs traded; a trade that stops short
    // (not enough goods or gold: 'cost', store full: 'cap') still gives ok with the reason; n = 0 is ok: false.
    function trade(lord, good, side, packs) {
      const lp = lordOf(lord), no = (reason) => ({ ok: false, n: 0, reason });
      if (!lp) return no('lord');
      if (side !== 'sell' && side !== 'buy') return no('side');
      if (GOODS.indexOf(good) < 0) return no('good');
      if (!int(packs) || packs < 1) return no('packs');
      if (st.phase === 'over') return no('phase');
      if (!finished(lp, 'markt')) return no('markt');
      const P = C.TRADE_PACK, price = C.TRADE_PRICE[side][good];
      let n = packs, why;
      if (side === 'sell') {
        const have = Math.floor(lp.stock[good] / P);
        if (have < n) { n = have; why = 'cost'; }
      } else {
        const afford = Math.floor(lp.stock.gold / price), room = Math.max(0, Math.floor((capOf(lp, good) - lp.stock[good]) / P));
        if (afford < n) { n = afford; why = 'cost'; }
        if (room < n) { n = room; why = 'cap'; }
      }
      if (n < 1) return no(why);
      if (side === 'sell') { lp.stock[good] -= n * P; lp.stock.gold += n * price; } else { lp.stock.gold -= n * price; lp.stock[good] += n * P; }
      syncGold(lp);
      emit({ t: 'trade', lord: lp.i, good, side, n, gold: n * price });
      return why ? { ok: true, n, reason: why } : { ok: true, n };
    }
    function cancel(lord, id) {
      const lp = lordOf(lord);
      if (!lp) return bad('lord');
      if (st.phase === 'over') return bad('phase');
      const b = lp.bld.find(x => x.id === id);
      if (!b) return bad('none');
      if (b.kind === 'bergfried') return bad('kind');
      if (b.build < 1 && !b.ruined && b._.paid) for (const g of GOODS) lp.stock[g] += b._.paid[g] || 0;   // a site is refunded in full
      removeBuilding(b);
      emit({ t: 'cancel', id });
      return { ok: true };
    }
    // R5: a finished workplace with worker slots (hof, holzfaeller, steinbruch) can rest and work again later
    function pause(lord, id, on) {
      const lp = lordOf(lord);
      if (!lp) return bad('lord');
      if (st.phase === 'over') return bad('phase');
      const b = lp.bld.find(x => x.id === id);
      if (!b) return bad('none');
      if (!b._.max || b.build < 1 || b.ruined) return bad('kind');
      on = !!on;
      if (b.paused === on) return { ok: true };
      b.paused = on;
      if (on) {   // the crew goes to the yard at once; a carrier delivers his load first and then goes idle instead of returning
        for (const u of b._.workers.slice()) { const p = u._; if (p.job === J.CARRY && p.load > 0) leaveCrew(u, p); else releaseJob(u, p); }
      }
      syncFull(lp);   // a workplace that rests by order is not `full` (and one that works again may be)
      emit({ t: 'pause', id: b.id, on });   // (when it is switched off, assignJobs fills the slots again in its normal order)
      return { ok: true };
    }
    function recruit(lord, unit, n) {
      const lp = lordOf(lord);
      if (!lp) return bad('lord');
      if (typeof unit !== 'string' || !own(UN, unit) || unit === 'bauer') return bad('unit');
      if (!(n === 0 || n === 1 || n === 2 || n === 3)) return bad('banner');
      if (st.phase === 'over') return bad('phase');
      const at = UN[unit].at;   // the house that trains it: 'kaserne', or 'lager' (the Söldnerlager) for torch-bearers and horse archers
      if (!finished(lp, at)) return bad(at === 'kaserne' ? 'kaserne' : 'lager');
      const peasants = lp.pub.people - lp.pub.soldiers;
      if (lp.queue.length >= C.QUEUE_MAX || peasants - lp.queue.length - 1 < C.PEASANT_MIN) return bad('pop');
      const cost = UN[unit].cost;
      for (const g of PAY) if ((cost[g] || 0) > lp.stock[g]) return bad('cost');
      for (const g of PAY) lp.stock[g] -= cost[g] || 0;
      syncGold(lp);
      const bn = lp.bn[n];
      lp.queue.push({ unit, n, p: 0, u: null, wait: 0 });
      bn.queued++; syncBanner(bn);
      emit({ t: 'recruit', lord: lp.i, unit, n });
      return { ok: true };
    }
    function inPactZone(lp, x, y) {
      for (const o of LP) {
        if (o === lp || PM[lp.i * M + o.i] <= 0) continue;
        for (const b of o.bld) if (rectDist(b._, x, y) <= C.PACT_ZONE) return true;
      }
      return false;
    }
    function banner(lord, n, x, y) {
      const lp = lordOf(lord);
      if (!lp) return bad('lord');
      if (!(n === 1 || n === 2 || n === 3) || !num(x) || !num(y)) return bad('none');
      if (st.phase === 'over') return bad('phase');
      const bn = lp.bn[n];
      x = clamp(x, -71.9, 71.9); y = clamp(y, -44.9, 44.9);
      if (inPactZone(lp, x, y)) return { ok: false, reason: 'pact', x: bn.tx, y: bn.ty };
      const L = labelsB(lp), FB = fviewOf(lp).B, from = bn.members.length && bn.lk >= 0 && !viewOf(lp)[bn.lk] ? bn.lk : lp.gateCell, rl = from >= 0 ? L[from] : -1, k0 = cellAt(x, y);
      let tx = x, ty = y, reason;
      if (!(k0 >= 0 && !FB[k0] && rl >= 0 && L[k0] === rl)) {   // (an enemy wall piece or gate counts as reachable: the banner breaks it)
        const k = snapCell(x, y, C.SNAP_R, from, lp, true);
        if (k >= 0) { tx = ckx(k); ty = cky(k); reason = 'snapped'; } else { tx = lp.gx; ty = lp.gy; reason = 'unreachable'; }
      }
      if (reason && inPactZone(lp, tx, ty)) return { ok: false, reason: 'pact', x: bn.tx, y: bn.ty };
      const ga = garrisonAt(lp, x, y);   // the order point itself (before snapping) lies on or within 1 of an own garrisonable building
      setTarget(bn, tx, ty, ga ? { x, y } : null);
      const r = reason ? { ok: true, x: tx, y: ty, reason } : { ok: true, x: tx, y: ty };
      if (ga) r.garrison = true;   // (the archers of this banner will take the free slots near the order)
      return r;
    }
    function home(lord) {
      const lp = lordOf(lord);
      if (!lp || st.phase === 'over') return { ok: false };
      for (let n = 1; n <= 3; n++) { const bn = lp.bn[n]; if (bn.members.length || bn.queued) sendHome(bn); }
      return { ok: true };
    }
    function pact(lord, to, on) {
      const a = lordOf(lord), b = lordOf(to);
      if (!a || !b) return { ok: false, reason: 'lord', state: 'none' };
      if (a === b) return { ok: false, reason: 'self', state: 'none' };
      if (LP.length <= 2) return { ok: false, reason: 'zwei', state: 'none' };
      if (st.phase === 'over') return { ok: false, reason: 'phase', state: 'none' };
      const ab = a.i * M + b.i, ba = b.i * M + a.i;
      if (on) {
        if (PM[ab] > 0) {   // an active pact: in its last RENEW_S `on` is a renewal offer (P1), before that it changes nothing (renew: null)
          if (PM[ab] - st.t > C.RENEW_S + 1e-9) return { ok: true, state: 'active', renew: null };
          if (RN[ba] > 0) {   // the partner offered first: the pact's end moves PACT_S further; `pactOn.a` is the first to offer, as for a new pact
            PM[ab] = PM[ba] = PM[ab] + C.PACT_S; RN[ab] = RN[ba] = 0;
            a.stats.pacts++; b.stats.pacts++;
            emit({ t: 'pactOn', a: b.i, b: a.i, until: PM[ab] });
            syncPacts();
            return { ok: true, state: 'active', renew: 'renewed' };
          }
          if (RN[ab] <= 0) { RN[ab] = PM[ab]; emit({ t: 'pactRenewOffer', from: a.i, to: b.i }); }
          return { ok: true, state: 'active', renew: 'offered' };
        }
        if (OF[ba] > 0) {   // the other side offered first: the pact is on
          OF[ba] = 0; OF[ab] = 0; PM[ab] = PM[ba] = st.t + C.PACT_S; GR[ab] = GR[ba] = 0;   // (a new pact ends a grace that was still running)
          a.stats.pacts++; b.stats.pacts++;
          emit({ t: 'pactOn', a: b.i, b: a.i, until: PM[ab] });
          syncPacts(); gridChanged();   // (partners walk through each other's gates now)
          return { ok: true, state: 'active' };
        }
        if (OF[ab] <= 0) emit({ t: 'pactOffer', from: a.i, to: b.i });
        OF[ab] = st.t + C.OFFER_S;
        syncPacts();
        return { ok: true, state: 'offered' };
      }
      if (OF[ba] > 0) { OF[ba] = 0; emit({ t: 'pactOff', a: b.i, b: a.i, reason: 'declined', by: a.i }); syncPacts(); return { ok: true, state: 'none' }; }
      if (OF[ab] > 0) { OF[ab] = 0; emit({ t: 'pactOff', a: a.i, b: b.i, reason: 'declined', by: a.i }); syncPacts(); return { ok: true, state: 'none' }; }
      if (PM[ab] > 0) {   // betrayal: Ruhm lost, the victim's fury lasts a minute (P3: no grace, and a pending renewal offer is void)
        PM[ab] = PM[ba] = 0; RN[ab] = RN[ba] = 0;
        addRuhm(a, C.RUHM.betray, 'betrayal'); a.stats.betrayals++;
        b.pub.zorn = C.ZORN_S;
        emit({ t: 'pactOff', a: a.i, b: b.i, reason: 'broken', by: a.i });
        syncPacts(); gridChanged();
        return { ok: true, state: 'none' };
      }
      return { ok: false, reason: 'none', state: 'none' };
    }
    function youOf(lord) {
      const lp = lordOf(lord);
      if (!lp) return null;
      let idle = 0;
      for (const u of units) if (u.lord === lp.i && u.kind === 'bauer' && u._.job === J.IDLE) idle++;
      const pub = lp.pub, banners = [], pacts = [];
      let prod = 0;
      for (let k = 0; k < FOOD_WIN; k++) prod += lp.fw[k];
      for (const bn of lp.bn) if (bn.members.length || bn.queued) {
        let x = bn.x, y = bn.y;
        if (bn.members.length) { x = 0; y = 0; for (const u of bn.members) { x += u.x; y += u.y; } x /= bn.members.length; y /= bn.members.length; }
        banners.push({ n: bn.n, count: bn.members.length, x, y, tx: bn.tx, ty: bn.ty });
      }
      for (const o of LP) {
        if (o === lp) continue;
        const ab = lp.i * M + o.i, ba = o.i * M + lp.i;
        // renew: 'offered' = this house has offered to renew an active pact, 'incoming' = the partner has (P1); null otherwise
        if (PM[ab] > 0) pacts.push({ with: o.i, state: 'active', until: PM[ab], renew: RN[ab] > 0 ? 'offered' : RN[ba] > 0 ? 'incoming' : null });
        else if (OF[ab] > 0) pacts.push({ with: o.i, state: 'offered', until: OF[ab], renew: null });
        else if (OF[ba] > 0) pacts.push({ with: o.i, state: 'incoming', until: OF[ba], renew: null });
        else pacts.push({ with: o.i, state: 'none', until: 0, renew: null });
      }
      return {
        stock: { korn: lp.stock.korn, holz: lp.stock.holz, stein: lp.stock.stein, gold: lp.stock.gold },
        cap: { korn: capOf(lp, 'korn'), holz: capOf(lp, 'holz'), stein: capOf(lp, 'stein') },
        pop: pub.people, popCap: popCap(lp), idle, hunger: lp.hungry,
        queue: lp.queue.map(q => ({ unit: q.unit, n: q.n, p: q.p, wait: !q.u })),   // wait: no peasant has been sent to the Kaserne for this recruit (yet)
        ruhm: pub.ruhm, crown: pub.crown, banners, pacts,
        food: { prod, eat: Math.round(pub.people * 60 / C.EAT_S) }   // R9: sacks per minute: 🌾 delivered over the last 60 s, and what everybody eats
      };
    }

    // ---- test hooks (not part of the game API) ----
    const dev = {
      lord: (i) => lordOf(i),                                   // private record of a house: stock, bld, queue, bn, stats …
      stock: (i, goods) => { const lp = lordOf(i); if (goods) Object.assign(lp.stock, goods); syncGold(lp); return lp.stock; },
      spawn(i, kind, x, y, n) {                                 // a ready soldier (n = banner 0..3) or, for 'bauer', a peasant
        const lp = lordOf(i), u = mkUnit(lp, kind, x, y, kind === 'bauer' ? -1 : n);
        if (kind !== 'bauer') joinBanner(u, u._, lp.bn[n]);
        u.px = x; u.py = y;
        return u;
      },
      place(i, kind, ci, cj, rot, len) {                        // a finished building, free of charge
        const lp = lordOf(i), keep = Object.assign({}, lp.stock);
        for (const g of GOODS) lp.stock[g] += 999;
        const r = build(i, kind, ci, cj, rot, len);
        for (const g of GOODS) lp.stock[g] = keep[g];
        if (!r.ok) return r;
        const b = lp.bld.find(x => x.id === r.id);
        b._.paid = null; dev.finish(b);
        return Object.assign({ b }, r);
      },
      finish(b) { if (b.build < 1) { b.build = 1; completeBuilding(b); } },
      damage: (b, dmg, by) => damageBuilding(b, dmg, by === undefined ? -1 : by),
      fire: (b, level, by) => setFire(b, level, by === undefined ? -1 : by),
      kill: (u, by) => killUnit(u, by === undefined ? -1 : by),
      occ, blk, labels, field: (bn) => { ensureField(bn); return bn.field; },
      view: (i) => viewOf(lordOf(i)),                           // the cells house i's units cannot enter (its own and its partners' gate lanes open)
      fview: (i) => fviewOf(lordOf(i)),                         // { B, X }: the same with enemy wall pieces passable, and what entering them costs
      bAt: (k) => bAt[k], rub,                                  // the building on a cell, the rubble flags
      level: () => Lq, tick: () => tick, units: () => units
    };

    // ---- setup ----
    {
      const specs = [], seenI = {}, seenS = {};
      const given = Array.isArray(opts.lords) && opts.lords.length ? opts.lords : [0, 1, 2, 3].map(i => ({ i, site: i }));
      for (const s of given) {
        if (!s || !int(s.i) || s.i < 0 || s.i > 15 || !int(s.site) || s.site < 0 || s.site > 3 || seenI[s.i] || seenS[s.site]) continue;
        seenI[s.i] = seenS[s.site] = true; specs.push({ i: s.i, site: s.site });
      }
      if (!specs.length) for (let i = 0; i < 4; i++) specs.push({ i, site: i });
      M = Math.max(4, ...specs.map(s => s.i + 1));
      PM = new Float64Array(M * M); OF = new Float64Array(M * M); RN = new Float64Array(M * M); GR = new Float64Array(M * M);
      refreshGrids();
      for (const spec of specs) {
        const site = world.sites[spec.site], out = spec.site < 2 ? 1 : -1;
        const pub = { i: spec.i, site: spec.site, emblem: spec.i, crown: false, ruhm: 0, people: 0, soldiers: 0, prot: 0, zorn: 0, hunger: false, gold: 0 };
        const lp = {
          i: spec.i, k: LP.length, site: spec.site, out, kx: site.x, ky: site.y, gx: site.x + 0.5, gy: site.y + 3.5 * out, gateCell: cellAt(site.x + 0.5, site.y + 3.5 * out),
          pub, stock: { korn: C.START.korn, holz: C.START.holz, stein: C.START.stein, gold: 0 }, bld: [], queue: [], bn: [], keepB: null,
          arriveT: 0, eatAcc: 0, hungry: false, leaveT: 0, prosT: 0, alertT: -99, alarm: null, fw: new Int32Array(FOOD_WIN), fwI: 0,
          vVer: -1, V: null, fVer: -1, F: null, labVer: -1, labBVer: -1, garT: 0,   // cached view of the house (see viewOf), its breach view and areas, next Wehrgang slot hand-out
          by: { kills: 0, buildings: 0, crops: 0, plunder: 0, prosperity: 0, betrayal: 0 },
          stats: { kills: 0, lost: 0, razed: 0, crops: 0, plunders: 0, built: 0, ignites: 0, pacts: 0, betrayals: 0 }
        };
        hid(pub, lp);
        LP.push(lp); LA[spec.i] = lp; st.lords.push(pub);
      }
      for (const lp of LP) {
        const site = world.sites[lp.site], keep = mkBuilding(lp, 'bergfried', site.keep.i, site.keep.j, 0, 1, lp.gateCell);
        keep._.dx = lp.gx; keep._.dy = lp.gy;
        stampOcc(keep, true);
        lp.keepB = keep;
      }
      for (const lp of LP) for (let n = 0; n <= 3; n++) lp.bn[n] = mkBanner(lp, n);
      // warm up the route code once here (match start, behind the intro card), so the first real route does not hitch a frame
      { const lp = LP[0], f = new Float32Array(N), to = { x: lp.bn[1].x, y: lp.bn[1].y }; for (let r = 0; r < 3; r++) { W.field(world, [lp.gateCell], Lq, f, occ); W.path(world, { x: lp.gx, y: lp.gy }, to, Lq, { block: occ }); } }
      for (const lp of LP) {
        for (let n = 0; n < C.START_PEASANTS; n++) {
          const u = mkUnit(lp, 'bauer', lp.gx, lp.gy, -1), p = u._;
          u.x = u.px = p.yx; u.y = u.py = p.yy;
        }
        lp.pub.people = C.START_PEASANTS;
      }
    }

    return { dt: DT, state: st, world, seed, occ, build, buildWall, cancel, pause, recruit, trade, banner, home, pact, step, youOf, dev };
  }

  const api = { create, CONST };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FurtSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
