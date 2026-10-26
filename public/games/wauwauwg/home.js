// Wauwau-WG scene "home": the WG living room by day (phase home) and at night
// (phase night). Dogs live here on their own — wander, sniff, scratch, nap,
// play-bow and chase each other — and act out every care action from the
// phones (r.fx from WW.care): hearts, sparkles, eating at their own bowl,
// drinking, begging for treats, a foam bath in the tub and the big shake.
// Contract: docs/WAUWAUWG.md §Scenes.
(function () {
  'use strict';
  const WW = window.WW;
  const TAU = Math.PI * 2;

  // ---------- tunables ----------
  const FLOOR_Y = 345;                         // wall/floor line
  const ROOM_X1 = 788;                         // living room ends, bathroom starts
  const BED_Y = 386;                           // ground line of the beds
  const BED_SPAN = [92, 724], BED_GAP_MAX = 150;
  const BOWL_DX = 34, BOWL_DY = 20;            // bowls flank each bed, a bit in front
  const WANDER = { x0: 70, x1: 740, y0: 428, y1: 524 };
  const ENTRY = { x: -70, y: 474 };            // dogs come in through the WG door (left)
  const DOG_SCALE = 0.92;                      // base size, × depth (back of the room is smaller)
  const WALK = 74, RUN = 185;                  // px/s before WW.speedFactor
  const TROT_FROM = 220;                       // px — care errands farther than this are trotted
  const CARE_HOLD = 1.3;                       // s a pet/brush keeps the dog still
  const EAT_TIME = 2.8, DRINK_TIME = 2.2, SHAKE_TIME = 1.5;
  const WET_DRY_TIME = 24;                     // s until a bathed dog is dry
  const BATH_TIMEOUT = 90;                     // s a dog waits in the tub without news
  const BUBBLE_EVERY = 7, BUBBLE_SHOW = 2.6;   // need thought bubbles
  const TUB = { x0: 812, x1: 950, rim: 398, floor: 450, seat: 22, seats: [884, 846, 922], front: { x: 790, y: 488 } };
  const MAX_PARTS = 360;
  const NEED_BUBBLE = { food: '🍖', water: '💧', clean: '🛁', mood: '🥺', energy: '💤' };
  const FONT = 'system-ui,sans-serif';
  const W = 960;

  const depth = (y) => DOG_SCALE * (0.8 + 0.26 * Math.max(0, Math.min(1, (y - FLOOR_Y) / 190)));
  const lerp = (a, b, k) => a + (b - a) * k;

  WW.scenes.home = function (api) {
    const rnd = api.rnd;
    const actors = {};          // id -> dog actor
    let order = [];             // ids in join order (bed layout)
    const slots = {};           // id -> { x, tx, food, water }
    let parts = [], treats = [];
    let tubSeats = [null, null, null];
    let night = false, t = 0, bg = null;
    const bots = {};

    const R = (a, b) => a + (b - a) * rnd();
    const dogOf = (id) => api.dog(id);

    // ---------- layout ----------
    function layoutBeds() {
      const n = order.length;
      if (!n) return;
      const gap = n > 1 ? Math.min(BED_GAP_MAX, (BED_SPAN[1] - BED_SPAN[0]) / (n - 1)) : 0;
      const mid = (BED_SPAN[0] + BED_SPAN[1]) / 2;
      order.forEach((id, i) => {
        const tx = mid + (i - (n - 1) / 2) * gap;
        const s = slots[id] || (slots[id] = { x: tx, tx, food: 0, water: 0.55 });
        s.tx = tx;
      });
    }
    const bedOf = (id) => slots[id] || { x: 400, tx: 400, food: 0, water: 0 };
    const foodBowl = (id) => ({ x: bedOf(id).x - BOWL_DX, y: BED_Y + BOWL_DY });
    const waterBowl = (id) => ({ x: bedOf(id).x + BOWL_DX, y: BED_Y + BOWL_DY });

    function makeActor(id, x, y, mode) {
      const a = {
        id, x, y, facing: rnd() < 0.5 ? 1 : -1, pose: 'stand', anim: rnd() * 10,
        mode: mode || 'idle', modeT: R(0.5, 2), target: null, partner: null,
        task: null, inBed: false, wet: 0, bubble: null, bubbleT: R(2, BUBBLE_EVERY),
        say: null, hop: null, seat: -1
      };
      actors[id] = a;
      return a;
    }
    function placeInBed(a) {
      const s = bedOf(a.id);
      a.x = s.x; a.y = BED_Y - 1; a.inBed = true; a.pose = 'sleep'; a.facing = 1;
    }

    // ---------- particles ----------
    function spawn(kind, x, y, o) {
      if (parts.length >= MAX_PARTS) parts.shift();
      const p = { kind, x, y, vx: 0, vy: 0, life: 1, max: 1, size: 1, rot: 0, color: null, gy: null };
      Object.assign(p, o);
      p.max = p.life;
      parts.push(p);
    }
    function head(a) {
      const dog = dogOf(a.id);
      if (!dog) return { x: a.x, y: a.y - 50 };
      const sc = depth(a.y), p = WW.art.points(dog, sc);
      const low = a.pose === 'lie' || a.pose === 'sleep';
      const k = low ? 0.5 : (a.pose === 'eat' || a.pose === 'dig') ? 0.55 : a.pose === 'sit' ? 0.97 : 1;
      return { x: a.x + p.head[0] * a.facing, y: a.y + p.head[1] * k };
    }
    function body(a) {
      const dog = dogOf(a.id), sc = depth(a.y), p = dog ? WW.art.points(dog, sc) : { h: 60, w: 80 };
      return { x: a.x, y: a.y - p.h * (a.pose === 'lie' || a.pose === 'sleep' ? 0.25 : 0.45), w: p.w, h: p.h };
    }
    function hearts(a, n) {
      const h = head(a);
      for (let i = 0; i < n; i++) spawn('heart', h.x + R(-14, 14), h.y - R(0, 10), { vx: R(-14, 14), vy: R(-55, -35), life: R(1, 1.5), size: R(0.8, 1.25) });
    }
    function sparkles(a, n) {
      const b = body(a), dog = dogOf(a.id), fur = dog ? WW.art.swatch(dog.breed, dog.coat) : '#caa';
      for (let i = 0; i < n; i++) spawn('spark', b.x + R(-b.w * 0.35, b.w * 0.35), b.y + R(-14, 10), { vy: R(-30, -10), life: R(0.5, 0.9), size: R(0.7, 1.3), rot: R(0, TAU) });
      if (rnd() < 0.7) spawn('tuft', b.x + R(-b.w * 0.3, b.w * 0.3), b.y + R(-6, 6), { vx: R(-20, 20), vy: R(10, 30), life: R(0.8, 1.3), color: fur, size: R(0.8, 1.3), gy: a.y });
    }
    function droplets(a, n, spread) {
      const b = body(a);
      for (let i = 0; i < n; i++) {
        const ang = R(0, TAU);
        spawn('drop', b.x + Math.cos(ang) * b.w * 0.3, b.y + Math.sin(ang) * 10,
          { vx: Math.cos(ang) * R(60, spread || 220), vy: R(-200, -60), life: R(0.6, 1.1), size: R(0.7, 1.3), gy: a.y + R(-4, 16) });
      }
    }
    function zzz(a) {
      const h = head(a);
      spawn('z', h.x + 6 * a.facing, h.y - 6, { vx: R(6, 14) * a.facing, vy: -18, life: 2.2, size: R(0.8, 1.2) });
    }
    function updateParts(dt) {
      for (const p of parts) {
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.kind === 'drop' || p.kind === 'crumb' || p.kind === 'tuft') {
          p.vy += (p.kind === 'tuft' ? 40 : 620) * dt;
          if (p.gy != null && p.y > p.gy) {
            if (p.kind === 'drop' && p.vy > 80) spawn('splat', p.x, p.gy, { life: 0.35, size: p.size });
            p.y = p.gy; p.vx *= 0.3; p.vy = 0;
            if (p.kind !== 'tuft') p.life = Math.min(p.life, 0.25);
          }
        } else if (p.kind === 'heart' || p.kind === 'z') {
          p.vx *= 1 - dt * 0.8;
          p.x += Math.sin((p.max - p.life) * 5 + p.y * 0.05) * dt * 10;
        } else if (p.kind === 'foam') {
          p.vy -= 8 * dt;
        }
      }
      parts = parts.filter(p => p.life > 0);
    }

    // ---------- movement ----------
    function walkTo(a, tx, ty, dt, run) {
      const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
      if (d < 3) { a.x = tx; a.y = ty; return true; }
      if (run === 'errand') run = d > TROT_FROM;
      const sp = (run ? RUN : WALK) * api.speed(a.id) * (depth(a.y) / DOG_SCALE);
      const step = Math.min(d, sp * dt);
      a.x += dx / d * step; a.y += dy / d * step;
      if (Math.abs(dx) > 2) a.facing = dx > 0 ? 1 : -1;
      a.pose = run ? 'run' : 'walk';
      a.inBed = false;
      return false;
    }
    function randomSpot() { return { x: R(WANDER.x0, WANDER.x1), y: R(WANDER.y0, WANDER.y1) }; }
    // Hop along an arc (into / out of the tub). Returns true when landed.
    function hopStep(a, dt) {
      const h = a.hop;
      h.u = Math.min(1, h.u + dt / h.dur);
      a.x = lerp(h.x0, h.x1, h.u);
      a.y = lerp(h.y0, h.y1, h.u) - Math.sin(Math.PI * h.u) * h.lift;
      a.pose = 'jump';
      if (h.u >= 1) { a.hop = null; return true; }
      return false;
    }
    function startHop(a, x1, y1, lift) {
      a.hop = { u: 0, x0: a.x, y0: a.y, x1, y1, lift: lift || 44, dur: 0.5 };
      a.facing = x1 >= a.x ? 1 : -1;
    }

    // ---------- autonomous life ----------
    function setMode(a, mode, time) {
      a.mode = mode; a.modeT = time == null ? R(1.5, 4) : time;
      a.target = null; a.sub = 0;
    }
    function free(a) { return !a.task && ['idle', 'wander', 'sit', 'sniff'].indexOf(a.mode) >= 0; }
    function pickMode(a) {
      const dog = dogOf(a.id);
      if (night) { setMode(a, 'bed'); return; }
      if (api.tired(a.id) || (dog && dog.needs.energy < 30 && rnd() < 0.5)) { setMode(a, 'nap', R(8, 14)); return; }
      const r = rnd();
      if (r < 0.36) setMode(a, 'wander');
      else if (r < 0.5) setMode(a, 'sniff', R(1.8, 3));
      else if (r < 0.6) setMode(a, 'sit', R(2.5, 5));
      else if (r < 0.68) setMode(a, 'lie', R(3.5, 7));
      else if (r < 0.75) setMode(a, 'scratch', R(1.2, 2));
      else if (r < 0.9) { if (!startPlay(a)) setMode(a, 'wander'); }
      else if (r < 0.95) setMode(a, 'nap', R(5, 9));
      else setMode(a, 'wander');
    }
    function startPlay(a) {
      const others = order.map(id => actors[id]).filter(o => o && o !== a && free(o) && !api.tired(o.id));
      if (!others.length) return false;
      const b = others[Math.floor(rnd() * others.length)];
      setMode(a, 'bow', 0.9); a.partner = b.id;
      setMode(b, 'bow', 0.9); b.partner = a.id;
      a.facing = b.x > a.x ? 1 : -1; b.facing = -a.facing;
      api.sfx('yip');
      return true;
    }
    function runMode(a, dt) {
      a.modeT -= dt;
      switch (a.mode) {
        case 'enter': {
          const s = bedOf(a.id);
          if (walkTo(a, s.x + 4, BED_Y + 46, dt, true)) { setMode(a, night ? 'bed' : 'sit', R(1.5, 3)); a.facing = 1; }
          return;
        }
        case 'wake':
          a.pose = 'sleep';
          if (a.modeT <= 0) setMode(a, 'stretch', 0.9);
          return;
        case 'stretch':                       // still on the cushion: a big morning stretch
          a.pose = 'dig';
          if (a.modeT <= 0) { a.inBed = false; a.y = BED_Y + 2; setMode(a, 'wander'); }
          return;
        case 'idle': case 'sit':
          a.pose = a.mode === 'sit' ? 'sit' : 'stand';
          break;
        case 'lie':
          a.pose = 'lie';
          break;
        case 'scratch':
          a.pose = 'sit';
          break;
        case 'wander':
          if (!a.target) a.target = randomSpot();
          if (walkTo(a, a.target.x, a.target.y, dt)) setMode(a, 'idle', R(1, 3));
          else if (a.modeT < -12) setMode(a, 'idle', 1);
          return;
        case 'sniff':
          if (!a.target) { a.target = randomSpot(); a.sub = 0; }
          if (a.sub === 0) { if (walkTo(a, a.target.x, a.target.y, dt) || a.modeT < -10) { a.sub = 1; a.modeT = R(1.8, 3); } return; }
          a.pose = 'eat';
          if (rnd() < dt * 3) { const h = head(a); spawn('puff', h.x + 8 * a.facing, h.y + 10, { vx: 10 * a.facing, vy: -6, life: 0.7, size: R(0.6, 1) }); }
          break;
        case 'bow': {
          a.pose = 'dig';
          if (a.modeT < -1.5) { setMode(a, 'idle', 1); return; }   // partner got busy
          if (a.modeT <= 0) {
            const b = actors[a.partner];
            if (!b || b.partner !== a.id) { setMode(a, 'idle', 1); return; }
            if (a.id < b.id) { setMode(a, 'chase', R(2.6, 3.8)); setMode(b, 'flee', a.modeT); a.partner = b.id; b.partner = a.id; }
          }
          return;
        }
        case 'chase': {
          const b = actors[a.partner];
          if (!b || b.mode !== 'flee' || a.modeT <= 0) { setMode(a, 'idle', R(1, 2)); if (b && b.mode === 'flee') setMode(b, 'idle', R(1, 2)); return; }
          walkTo(a, b.x - 34 * b.facing, b.y, dt, true);
          if (rnd() < dt * 0.8) api.sfx('yip');
          return;
        }
        case 'flee':
          if (!a.target) a.target = randomSpot();
          if (walkTo(a, a.target.x, a.target.y, dt, true)) a.target = randomSpot();
          if (a.modeT <= -1) setMode(a, 'idle', 1.5);
          return;
        case 'nap': case 'bed': {
          const s = bedOf(a.id);
          if (!a.inBed) {
            if (walkTo(a, s.x, BED_Y + 4, dt)) placeInBed(a);
            return;
          }
          a.x = s.x; a.pose = 'sleep';
          if (rnd() < dt * 0.7) zzz(a);
          if (night && rnd() < dt * 0.04) api.sfx('snore');
          if (a.mode === 'nap' && a.modeT <= 0) setMode(a, 'stretch', 0.9);
          return;
        }
      }
      if (a.modeT <= 0) pickMode(a);
    }

    // ---------- care tasks (from onCare) ----------
    const BIG = ['eat', 'drink', 'treat', 'tub', 'shake', 'untub'];
    const busyBig = (a) => a.task && BIG.indexOf(a.task.kind) >= 0;
    function endTask(a) {
      a.task = null;
      if (night) setMode(a, 'bed');
      else setMode(a, 'idle', R(0.8, 2));
    }
    function runTask(a, dt) {
      const k = a.task;
      k.t -= dt;
      switch (k.kind) {
        case 'pet': case 'brush': {
          if (a.inBed) a.pose = 'lie';
          else a.pose = k.kind === 'pet' ? 'sit' : 'stand';
          k.fx -= dt;
          if (k.fx <= 0) { k.fx = 0.22; if (k.kind === 'pet') hearts(a, 1); else sparkles(a, 2); }
          if (k.t <= 0) { a.task = null; if (a.inBed && (night || a.mode === 'nap')) a.pose = 'sleep'; else setMode(a, 'sit', R(1, 2.5)); }
          return;
        }
        case 'eat': case 'drink': {
          const bowl = k.kind === 'eat' ? foodBowl(a.id) : waterBowl(a.id);
          const dog = dogOf(a.id), p = WW.art.points(dog, depth(bowl.y + 6));
          // food is approached from the left (facing right), water from the right
          const side = k.kind === 'eat' ? -1 : 1;
          const tx = bowl.x + side * (p.nose[0] - 4), ty = bowl.y + 6;
          if (k.step === 'go') {
            if (walkTo(a, tx, ty, dt, 'errand') || k.t < -8) { a.x = tx; a.y = ty; k.step = 'do'; k.t = k.kind === 'eat' ? EAT_TIME : DRINK_TIME; }
            return;
          }
          a.facing = -side; a.pose = 'eat';
          const s = bedOf(a.id);
          if (k.kind === 'eat') {
            s.food = Math.max(0, s.food - dt / EAT_TIME);
            k.fx -= dt;
            if (k.fx <= 0) { k.fx = 0.55; api.sfx('crunch'); spawn('crumb', bowl.x + R(-6, 6), bowl.y - 6, { vx: R(-40, 40), vy: R(-120, -60), life: 0.8, size: R(0.7, 1.1), gy: bowl.y + 2 }); }
          } else {
            s.water = Math.max(0.25, s.water - dt / DRINK_TIME * 0.7);
            k.fx -= dt;
            if (k.fx <= 0) { k.fx = 0.4; spawn('drop', bowl.x + R(-5, 5), bowl.y - 4, { vx: R(-50, 50), vy: R(-130, -70), life: 0.6, size: 0.7, gy: bowl.y + 3 }); }
          }
          if (k.t <= 0) { if (k.kind === 'eat') hearts(a, 2); endTask(a); }
          return;
        }
        case 'treat': {
          if (k.step === 'beg') {
            a.pose = 'beg';
            if (k.t <= 0) {
              const h = head(a);
              treats.push({ x0: h.x + R(-180, 180), y0: 60, x1: h.x, y1: h.y + 4, u: 0, id: a.id });   // tossed in from the couch
              k.step = 'fly'; k.t = 0.55;
            }
          } else if (k.step === 'fly') {
            a.pose = 'beg';
            const tr = treats.find(o => o.id === a.id);
            if (tr) { tr.u = Math.min(1, 1 - k.t / 0.55); }
            if (k.t <= 0.12) a.pose = 'jump';
            if (k.t <= 0) { treats = treats.filter(o => o.id !== a.id); k.step = 'chew'; k.t = 0.9; api.sfx('crunch'); hearts(a, 2); }
          } else {
            a.pose = 'sit';
            if (k.t <= 0) endTask(a);
          }
          return;
        }
        case 'tub': {
          if (k.step === 'go') {
            if (walkTo(a, TUB.front.x, TUB.front.y, dt, 'errand') || k.t < -10) {
              a.seat = tubSeats.indexOf(null);
              if (a.seat < 0) { k.step = 'queue'; return; }
              tubSeats[a.seat] = a.id;
              startHop(a, TUB.seats[a.seat], TUB.rim + TUB.seat, 70);
              k.step = 'hop';
              api.sfx('splash');
            }
            return;
          }
          if (k.step === 'queue') {
            a.pose = 'sit'; a.facing = 1;
            const free = tubSeats.indexOf(null);
            if (free >= 0) { a.seat = free; tubSeats[free] = a.id; startHop(a, TUB.seats[free], TUB.rim + TUB.seat, 70); k.step = 'hop'; }
            else if (rnd() < dt * 4) spawn('foam', a.x + R(-20, 20), a.y - R(20, 40), { life: R(0.8, 1.4), size: R(0.6, 1) });
            return;
          }
          if (k.step === 'hop') { if (hopStep(a, dt)) { k.step = 'in'; k.t = BATH_TIMEOUT; a.facing = -1; } return; }
          a.pose = 'sit'; a.facing = -1;
          if (rnd() < dt * 2.5) { const h = head(a); spawn('foam', h.x + R(-16, 16), h.y + R(-14, 6), { vx: R(-8, 8), life: R(0.9, 1.6), size: R(0.5, 1) }); }
          if (k.t <= 0) leaveTub(a, 'untub');      // nobody finished the bath: hop out dry
          return;
        }
        case 'shake': case 'untub': {
          if (k.step === 'hopout') {
            if (hopStep(a, dt)) {
              if (k.kind === 'untub') { endTask(a); return; }
              k.step = 'shake'; k.t = SHAKE_TIME; a.wet = 1; api.sfx('shake');
            }
            return;
          }
          if (k.kind === 'untub') { endTask(a); return; }
          a.pose = 'shake';
          k.fx -= dt;
          if (k.fx <= 0) { k.fx = 0.06; droplets(a, 3); }
          if (k.t <= 0) { sparkles(a, 6); hearts(a, 1); endTask(a); }
          return;
        }
        case 'refuse': {
          a.pose = 'stand';
          k.fx -= dt;
          if (k.fx <= 0) { k.fx = 0.2; a.facing = -a.facing; }
          if (k.t <= 0) endTask(a);
          return;
        }
        case 'sad':
          a.pose = 'sit';
          if (k.t <= 0) endTask(a);
          return;
      }
    }
    function leaveTub(a, kind) {
      // From the tub: hop out first; elsewhere: act right where the dog stands.
      if (a.seat >= 0 && tubSeats[a.seat] === a.id) {
        tubSeats[a.seat] = null; a.seat = -1;
        a.task = { kind, step: 'hopout', t: 3, fx: 0 };
        startHop(a, TUB.front.x - R(0, 40), TUB.front.y + R(-6, 10), 60);
      } else {
        a.task = { kind, step: kind === 'shake' ? 'shake' : 'done', t: SHAKE_TIME, fx: 0 };
        if (kind === 'shake') { a.wet = 1; api.sfx('shake'); }
      }
    }
    function say(a, text, time) { a.say = { text, t: time || 1.4 }; }

    // ---------- drawing ----------
    function buildRoom() {
      const c = document.createElement('canvas');
      c.width = W; c.height = 600;
      const g = c.getContext('2d');
      drawWall(g); drawFloor(g); drawDecor(g); drawBathroom(g);
      // the window pane is cut out: the live sky shows through
      g.clearRect(344, 92, 132, 146);
      drawCurtains(g);
      return c;
    }
    function drawWall(g) {
      g.fillStyle = '#f1dcbf'; g.fillRect(0, 0, ROOM_X1, FLOOR_Y);
      for (let x = 0; x < ROOM_X1; x += 28) { g.fillStyle = (x / 28) % 2 ? '#ecd4b4' : '#f1dcbf'; g.fillRect(x, 0, 14, FLOOR_Y); }
      g.fillStyle = 'rgba(214,170,120,.35)';
      for (let y = 26; y < FLOOR_Y - 20; y += 34) for (let x = 7 + ((y / 34) % 2) * 14; x < ROOM_X1; x += 28) {
        g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 3, y); g.lineTo(x, y + 4); g.lineTo(x - 3, y); g.closePath(); g.fill();
      }
      g.fillStyle = '#d8b48a'; g.fillRect(0, 100, ROOM_X1, 6);                   // picture rail
      g.fillStyle = 'rgba(120,80,40,.12)'; g.fillRect(0, 106, ROOM_X1, 3);
      const sh = g.createLinearGradient(0, FLOOR_Y - 60, 0, FLOOR_Y);
      sh.addColorStop(0, 'rgba(120,80,40,0)'); sh.addColorStop(1, 'rgba(120,80,40,.18)');
      g.fillStyle = sh; g.fillRect(0, FLOOR_Y - 60, ROOM_X1, 60);
      g.fillStyle = '#fff3e2'; g.fillRect(0, FLOOR_Y - 14, ROOM_X1, 14);         // baseboard
      g.fillStyle = 'rgba(120,80,40,.25)'; g.fillRect(0, FLOOR_Y - 14, ROOM_X1, 2);
    }
    function drawFloor(g) {
      const fg = g.createLinearGradient(0, FLOOR_Y, 0, 600);
      fg.addColorStop(0, '#b77d48'); fg.addColorStop(1, '#a06838');
      g.fillStyle = fg; g.fillRect(0, FLOOR_Y, ROOM_X1 + 6, 600 - FLOOR_Y);
      let y = FLOOR_Y, row = 0;
      while (y < 600) {
        const h = 14 + row * 2.2;
        g.fillStyle = row % 2 ? 'rgba(255,220,170,.06)' : 'rgba(80,40,10,.05)';
        g.fillRect(0, y, ROOM_X1 + 6, h);
        g.fillStyle = 'rgba(70,35,10,.28)'; g.fillRect(0, y, ROOM_X1 + 6, 1.5);
        for (let x = (row * 97) % 180; x < ROOM_X1; x += 180) g.fillRect(x, y, 1.5, h);
        y += h; row++;
      }
      // rug
      g.save();
      g.translate(400, 474);
      g.fillStyle = 'rgba(60,30,10,.18)'; g.beginPath(); g.ellipse(4, 6, 262, 50, 0, 0, TAU); g.fill();
      g.fillStyle = '#c4664f'; g.beginPath(); g.ellipse(0, 0, 258, 48, 0, 0, TAU); g.fill();
      g.strokeStyle = '#f3e1c4'; g.lineWidth = 5;
      [0.82, 0.6].forEach(k => { g.beginPath(); g.ellipse(0, 0, 258 * k, 48 * k, 0, 0, TAU); g.stroke(); });
      g.fillStyle = '#e9a65a'; g.beginPath(); g.ellipse(0, 0, 258 * 0.38, 48 * 0.38, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(243,225,196,.7)'; g.lineWidth = 2;
      for (let i = 0; i < 44; i++) {
        const an = i / 44 * TAU, x = Math.cos(an) * 258, yy = Math.sin(an) * 48;
        g.beginPath(); g.moveTo(x, yy); g.lineTo(x * 1.035, yy * 1.12); g.stroke();
      }
      g.restore();
      // doormat
      g.fillStyle = '#7a5a3a'; g.fillRect(8, 350, 104, 16);
      g.fillStyle = '#9b7650'; g.fillRect(12, 353, 96, 10);
    }
    function drawDecor(g) {
      // WG door with name plate
      g.fillStyle = '#e8d6bd'; g.fillRect(12, 124, 92, FLOOR_Y - 124);
      g.fillStyle = '#9c6b45'; g.fillRect(20, 132, 76, FLOOR_Y - 132);
      g.fillStyle = '#8a5c39';
      [[28, 142, 60, 82], [28, 236, 60, 92]].forEach(([x, y, w, h]) => { g.fillRect(x, y, w, h); });
      g.fillStyle = '#a8774f';
      [[31, 145, 54, 76], [31, 239, 54, 86]].forEach(([x, y, w, h]) => { g.fillRect(x, y, w, h); });
      g.fillStyle = '#f6d36b'; g.beginPath(); g.arc(86, 240, 4.5, 0, TAU); g.fill();
      g.fillStyle = '#fff6e5'; rr(g, 30, 162, 56, 24, 6); g.fill();
      g.fillStyle = '#7a4d2c'; g.font = 'bold 11px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('🐾 WG', 58, 174);
      // hooks with leashes (Gassi!)
      g.fillStyle = '#8a6a4a'; g.fillRect(114, 150, 52, 7);
      ['#ff2d55', '#0a84ff', '#30d158', '#ffd60a'].forEach((col, i) => {
        const x = 120 + i * 13;
        g.fillStyle = '#5b4632'; g.fillRect(x - 1, 154, 3, 7);
        g.strokeStyle = col; g.lineWidth = 3; g.beginPath();
        g.moveTo(x, 160); g.bezierCurveTo(x - 6, 200, x + 8, 220, x, 252 - i * 9); g.stroke();
        g.fillStyle = col; g.beginPath(); g.arc(x, 254 - i * 9, 4, 0, TAU); g.fill();
      });
      // picture frames
      g.fillStyle = '#7b5536'; g.fillRect(182, 124, 64, 52);
      g.fillStyle = '#fdf3e1'; g.fillRect(188, 130, 52, 40);
      g.fillStyle = '#e9a65a';
      [[214, 156, 9], [202, 142, 4], [214, 138, 4], [226, 142, 4]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); });
      g.fillStyle = '#7b5536'; g.fillRect(196, 192, 38, 40);
      g.fillStyle = '#bfe3f2'; g.fillRect(200, 196, 30, 32);
      g.fillStyle = '#6fbf73'; g.beginPath(); g.moveTo(200, 228); g.lineTo(212, 210); g.lineTo(222, 222); g.lineTo(230, 214); g.lineTo(230, 228); g.closePath(); g.fill();
      // big plant
      g.save();
      const leaf = (x, y, r, an, col) => { g.fillStyle = col; g.save(); g.translate(x, y); g.rotate(an); g.beginPath(); g.ellipse(0, -r, r * 0.55, r, 0, 0, TAU); g.fill(); g.restore(); };
      [[276, 300, 46, -0.6, '#2f7a4a'], [278, 296, 52, 0.15, '#3c9157'], [280, 300, 44, 0.7, '#2f7a4a'], [270, 304, 36, -1.1, '#3c9157'], [286, 304, 34, 1.15, '#46a063']]
        .forEach(l => leaf.apply(null, l));
      g.restore();
      g.fillStyle = '#c96f4b'; g.beginPath(); g.moveTo(256, 300); g.lineTo(300, 300); g.lineTo(294, FLOOR_Y - 2); g.lineTo(262, FLOOR_Y - 2); g.closePath(); g.fill();
      g.fillStyle = '#b25e3d'; g.fillRect(254, 298, 48, 8);
      // window frame (pane cut out later)
      g.fillStyle = '#fffaf1'; g.fillRect(334, 82, 152, 166);
      g.fillStyle = '#e9dcc8'; g.fillRect(328, 244, 164, 10);                      // sill
      // floor lamp
      g.fillStyle = '#3a3634'; g.fillRect(538, 162, 4, FLOOR_Y - 166);
      g.beginPath(); g.ellipse(540, FLOOR_Y - 3, 18, 5, 0, 0, TAU); g.fill();
      g.fillStyle = '#f4e1b0'; g.beginPath(); g.moveTo(522, 128); g.lineTo(558, 128); g.lineTo(570, 166); g.lineTo(510, 166); g.closePath(); g.fill();
      g.fillStyle = 'rgba(160,120,60,.25)'; g.fillRect(510, 160, 60, 6);
      // shelf + books + clock
      g.fillStyle = '#8f6440'; g.fillRect(584, 160, 176, 8);
      ['#d9534f', '#4f8fd9', '#f0b84a', '#5fb36b', '#9b6bd1', '#e07a3f'].forEach((col, i) => {
        const h = 26 + (i * 7) % 12, w = 9 + (i % 3) * 2;
        g.fillStyle = col; g.fillRect(596 + i * 13, 160 - h, w, h);
        g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(598 + i * 13, 160 - h + 5, w - 4, 2);
      });
      g.fillStyle = '#d07a4f'; g.fillRect(704, 144, 20, 16);
      g.fillStyle = '#4c9a5c'; [[714, 136, 9], [706, 140, 7], [722, 140, 7]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); });
      g.fillStyle = '#7b5536'; g.beginPath(); g.arc(670, 70, 21, 0, TAU); g.fill();
      g.fillStyle = '#fffaf0'; g.beginPath(); g.arc(670, 70, 17, 0, TAU); g.fill();
      // sofa
      g.fillStyle = 'rgba(40,20,10,.18)'; g.beginPath(); g.ellipse(668, FLOOR_Y + 2, 120, 9, 0, 0, TAU); g.fill();
      g.fillStyle = '#356f78'; rr(g, 566, 214, 204, 72, 22); g.fill();               // back
      g.fillStyle = '#3f8089'; rr(g, 578, 268, 180, 50, 12); g.fill();              // seat
      g.fillStyle = '#356f78'; rr(g, 556, 252, 30, 76, 14); g.fill(); rr(g, 750, 252, 30, 76, 14); g.fill(); // arms
      g.fillStyle = 'rgba(255,255,255,.08)'; rr(g, 584, 222, 176, 10, 5); g.fill();
      g.fillStyle = '#2a565d'; g.fillRect(668, 272, 2, 40);
      g.fillStyle = '#f2b950'; rr(g, 592, 236, 44, 38, 12); g.fill();               // cushions
      g.fillStyle = '#e0705a'; rr(g, 700, 238, 46, 36, 12); g.fill();
      g.fillStyle = '#5b3b28'; g.fillRect(574, 326, 7, FLOOR_Y - 326); g.fillRect(756, 326, 7, FLOOR_Y - 326);
    }
    function drawBathroom(g) {
      g.fillStyle = '#c8b39a'; g.fillRect(ROOM_X1, 0, 12, FLOOR_Y);                 // partition
      g.fillStyle = '#e6f2f8'; g.fillRect(800, 0, 160, FLOOR_Y);
      g.fillStyle = '#d2e8f4'; g.fillRect(800, 196, 160, FLOOR_Y - 196);            // tiles
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.5;
      for (let y = 196; y < FLOOR_Y; y += 18) { g.beginPath(); g.moveTo(800, y); g.lineTo(960, y); g.stroke(); }
      for (let x = 800; x < 960; x += 18) { g.beginPath(); g.moveTo(x, 196); g.lineTo(x, FLOOR_Y); g.stroke(); }
      g.fillStyle = '#9cc7de'; g.fillRect(800, 192, 160, 5);
      // bathroom floor tiles
      for (let y = FLOOR_Y; y < 600; y += 22) for (let x = 800; x < 960; x += 22) {
        g.fillStyle = ((x - 800) / 22 + (y - FLOOR_Y) / 22) % 2 ? '#dfe9f0' : '#c7d6e2';
        g.fillRect(x, y, 22, 22);
      }
      g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(794, FLOOR_Y, 6, 600 - FLOOR_Y);
      // shower: rod, curtain, head
      g.fillStyle = '#b8c4cc'; g.fillRect(806, 118, 150, 4);
      g.fillStyle = '#9fd3c7';
      g.beginPath(); g.moveTo(808, 122);
      for (let i = 0; i <= 4; i++) g.quadraticCurveTo(812 + i * 9, 220, 812 + i * 9 + 4, 122);
      g.lineTo(856, 122); g.lineTo(850, 330); g.lineTo(808, 330); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.5)';
      [[822, 170, 4], [838, 214, 5], [826, 262, 3], [842, 296, 4]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); });
      g.fillStyle = '#aab8c2'; g.fillRect(926, 150, 5, 120); g.fillRect(912, 146, 24, 6);
      g.beginPath(); g.ellipse(912, 156, 10, 6, 0, 0, TAU); g.fill();
      // towel rack
      g.fillStyle = '#aab8c2'; g.fillRect(872, 214, 46, 4);
      g.fillStyle = '#ff9fb5'; rr(g, 876, 214, 18, 48, 4); g.fill();
      g.fillStyle = '#8fd0ff'; rr(g, 896, 214, 18, 40, 4); g.fill();
      // mirror
      g.fillStyle = '#9aa9b4'; rr(g, 868, 40, 62, 72, 14); g.fill();
      const mg = g.createLinearGradient(872, 44, 926, 108);
      mg.addColorStop(0, '#eef7fc'); mg.addColorStop(1, '#bcd3e2');
      g.fillStyle = mg; rr(g, 873, 45, 52, 62, 10); g.fill();
      g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(880, 52, 4, 22); g.fillRect(888, 52, 2, 12);
      // bath mat
      g.fillStyle = '#7fb6d9'; rr(g, 770, 492, 70, 18, 8); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; for (let x = 776; x < 834; x += 8) g.fillRect(x, 496, 3, 10);
    }
    function drawCurtains(g) {
      [[312, 1], [508, -1]].forEach(([x, dir]) => {
        g.fillStyle = '#7aa38a';
        g.beginPath(); g.moveTo(x, 74); g.lineTo(x + dir * 40, 74);
        g.quadraticCurveTo(x + dir * 18, 170, x + dir * 34, 266); g.lineTo(x, 266); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(40,70,50,.25)'; g.lineWidth = 2;
        for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + dir * i * 8, 76); g.quadraticCurveTo(x + dir * i * 6, 170, x + dir * i * 9, 264); g.stroke(); }
        g.fillStyle = '#e8c35a'; g.fillRect(x + dir * 12 - 3, 176, 6, 12);
      });
      g.fillStyle = '#8f6440'; g.fillRect(300, 68, 220, 7);
    }
    function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

    function drawSky(o) {
      o.save();
      o.beginPath(); o.rect(344, 92, 132, 146); o.clip();
      const sk = o.createLinearGradient(0, 92, 0, 238);
      if (night) { sk.addColorStop(0, '#0b1236'); sk.addColorStop(1, '#283a78'); }
      else { sk.addColorStop(0, '#6cc2ff'); sk.addColorStop(1, '#cdeeff'); }
      o.fillStyle = sk; o.fillRect(344, 92, 132, 146);
      if (night) {
        o.fillStyle = '#fff6d8'; o.beginPath(); o.arc(442, 124, 15, 0, TAU); o.fill();
        o.fillStyle = '#16205a'; o.beginPath(); o.arc(450, 119, 13, 0, TAU); o.fill();
      } else {
        const sg = o.createRadialGradient(450, 120, 4, 450, 120, 40);
        sg.addColorStop(0, 'rgba(255,248,200,1)'); sg.addColorStop(0.35, 'rgba(255,240,170,.8)'); sg.addColorStop(1, 'rgba(255,240,170,0)');
        o.fillStyle = sg; o.fillRect(410, 92, 66, 70);
        o.fillStyle = 'rgba(255,255,255,.92)';
        [[0, 150, 1], [70, 186, 0.8], [140, 132, 0.7]].forEach(([off, y, s]) => {
          const x = 330 + ((t * 7 + off) % 180);
          o.beginPath(); o.ellipse(x, y, 20 * s, 8 * s, 0, 0, TAU); o.ellipse(x + 12 * s, y - 6 * s, 13 * s, 9 * s, 0, 0, TAU); o.ellipse(x - 12 * s, y - 3 * s, 10 * s, 7 * s, 0, 0, TAU); o.fill();
        });
        // rooftops across the street
        o.fillStyle = '#9fb7c9';
        o.fillRect(344, 206, 40, 32); o.fillRect(392, 196, 34, 42); o.fillRect(432, 212, 44, 26);
        o.fillStyle = '#c86f5a'; o.beginPath(); o.moveTo(388, 196); o.lineTo(409, 180); o.lineTo(430, 196); o.closePath(); o.fill();
      }
      o.restore();
    }
    function drawStars(o) {
      o.save();
      o.beginPath(); o.rect(346, 94, 128, 142); o.clip();
      [[360, 108], [384, 132], [404, 102], [418, 150], [372, 170], [462, 168], [394, 196], [452, 210], [428, 120], [362, 222]].forEach(([x, y], i) => {
        const tw = 0.55 + 0.45 * Math.sin(t * (1.3 + i * 0.37) + i);
        o.fillStyle = 'rgba(255,250,220,' + tw.toFixed(2) + ')';
        o.beginPath(); o.arc(x, y, 1.3 + (i % 3) * 0.4, 0, TAU); o.fill();
      });
      o.fillStyle = '#fff6d8'; o.beginPath(); o.arc(442, 124, 15, 0, TAU); o.fill();
      o.fillStyle = '#1a2560'; o.beginPath(); o.arc(450, 119, 13, 0, TAU); o.fill();
      o.restore();
    }
    function drawClock(o) {
      const cx = 670, cy = 70;
      o.strokeStyle = '#4a3020'; o.lineCap = 'round';
      const m = t * 0.6, hr = t * 0.05;
      o.lineWidth = 2.5; o.beginPath(); o.moveTo(cx, cy); o.lineTo(cx + Math.sin(hr) * 8, cy - Math.cos(hr) * 8); o.stroke();
      o.lineWidth = 1.6; o.beginPath(); o.moveTo(cx, cy); o.lineTo(cx + Math.sin(m) * 13, cy - Math.cos(m) * 13); o.stroke();
      o.fillStyle = '#4a3020'; o.beginPath(); o.arc(cx, cy, 2, 0, TAU); o.fill();
    }
    function drawLampLight(o) {
      o.save();
      o.globalCompositeOperation = 'lighter';
      const lg = o.createRadialGradient(540, 170, 10, 540, 220, 300);
      lg.addColorStop(0, 'rgba(255,200,120,.42)'); lg.addColorStop(0.4, 'rgba(255,170,90,.14)'); lg.addColorStop(1, 'rgba(255,160,80,0)');
      o.fillStyle = lg; o.fillRect(200, 0, 700, 560);
      const pool = o.createRadialGradient(540, 430, 10, 540, 430, 240);
      pool.addColorStop(0, 'rgba(255,190,110,.18)'); pool.addColorStop(1, 'rgba(255,190,110,0)');
      o.fillStyle = pool; o.beginPath(); o.ellipse(540, 430, 260, 90, 0, 0, TAU); o.fill();
      // moonlight falling through the window
      o.fillStyle = 'rgba(150,180,255,.045)';
      o.beginPath(); o.moveTo(346, 238); o.lineTo(476, 238); o.lineTo(560, 470); o.lineTo(300, 470); o.closePath(); o.fill();
      o.restore();
      o.fillStyle = '#ffe9b0'; o.beginPath(); o.moveTo(522, 128); o.lineTo(558, 128); o.lineTo(570, 166); o.lineTo(510, 166); o.closePath(); o.fill();
    }
    function drawBed(o, id) {
      const s = bedOf(id), dog = dogOf(id), col = api.color(id), x = s.x, y = BED_Y;
      const w = order.length > 6 ? 78 : 88;
      o.fillStyle = 'rgba(60,30,10,.22)'; o.beginPath(); o.ellipse(x + 2, y + 4, w / 2 + 4, 10, 0, 0, TAU); o.fill();
      o.fillStyle = shade(col, 0.62); o.beginPath(); o.ellipse(x, y - 4, w / 2, 15, 0, 0, TAU); o.fill();
      o.fillStyle = shade(col, 0.95); o.beginPath(); o.ellipse(x, y - 8, w / 2 - 9, 9, 0, 0, TAU); o.fill();
      o.fillStyle = 'rgba(255,255,255,.18)'; o.beginPath(); o.ellipse(x - 6, y - 10, w / 2 - 20, 4, 0, 0, TAU); o.fill();
      if (dog) {
        o.save();
        o.font = 'bold 11px ' + FONT;
        let f = 11;
        while (o.measureText(dog.name).width > w - 16 && f > 8) { f--; o.font = 'bold ' + f + 'px ' + FONT; }
        o.fillStyle = 'rgba(255,255,255,.92)'; o.textAlign = 'center'; o.textBaseline = 'middle';
        o.fillText(dog.name, x, y + 5);
        o.restore();
      }
    }
    function drawBowl(o, x, y, kind, level) {
      o.fillStyle = 'rgba(60,30,10,.25)'; o.beginPath(); o.ellipse(x + 1, y + 2, 14, 4, 0, 0, TAU); o.fill();
      o.fillStyle = kind === 'food' ? '#d65a4a' : '#4a8fd6';
      o.beginPath(); o.moveTo(x - 13, y - 8); o.lineTo(x + 13, y - 8); o.lineTo(x + 10, y); o.lineTo(x - 10, y); o.closePath(); o.fill();
      o.fillStyle = kind === 'food' ? '#b9473a' : '#3b76b5'; o.beginPath(); o.ellipse(x, y - 8, 13, 3.5, 0, 0, TAU); o.fill();
      if (level > 0.02) {
        if (kind === 'food') {
          o.fillStyle = '#8a5a2b';
          const n = Math.ceil(level * 7);
          for (let i = 0; i < n; i++) { o.beginPath(); o.arc(x - 8 + (i * 37 % 16), y - 9 - (i % 3) * 1.6 * level, 2.6, 0, TAU); o.fill(); }
        } else {
          o.fillStyle = 'rgba(150,215,255,' + (0.5 + 0.5 * level) + ')';
          o.beginPath(); o.ellipse(x, y - 8, 11 * Math.min(1, 0.6 + level * 0.4), 2.6, 0, 0, TAU); o.fill();
        }
      }
    }
    function shade(hex, k) {
      const n = parseInt(String(hex).slice(1), 16);
      if (!isFinite(n)) return hex;
      const c = (v) => Math.round(Math.min(255, v * k + (k > 0.9 ? 255 * (k - 0.9) : 0)));
      return 'rgb(' + c((n >> 16) & 255) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
    }
    function drawDogActor(o, a) {
      const dog = dogOf(a.id);
      if (!dog) return;
      const n = dog.needs, sc = depth(a.y);
      const task = a.task && a.task.kind;
      let wag = 0.15 + 0.85 * n.mood / 100;
      if (task === 'pet' || task === 'treat' || a.mode === 'bow' || a.mode === 'chase' || a.mode === 'flee') wag = 1;
      const tongue = (n.water < 30 || a.mode === 'chase' || a.mode === 'flee' || (task === 'pet' && a.anim % 3 < 1.5)) && a.pose !== 'sleep';
      const dirt = Math.max(0, Math.min(1, (40 - n.clean) / 40));
      // scratching: a quick wobble
      const jx = a.mode === 'scratch' && !a.task ? Math.sin(a.anim * 40) * 1.2 : 0;
      WW.art.drawDog(o, dog, a.x + jx, a.y, { scale: sc, facing: a.facing, pose: a.pose, t: a.anim, wag, dirt, wet: a.wet, tongue, collar: api.color(a.id) });
      if (a.mode === 'scratch' && !a.task) {
        const b = body(a);
        o.strokeStyle = 'rgba(80,50,30,.5)'; o.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) { o.beginPath(); o.arc(b.x - 18 * a.facing * sc, b.y - 6, 6 + i * 4, -0.6, 0.6); o.stroke(); }
      }
      if (n.clean < 25 && a.pose !== 'sleep') drawStink(o, a, n.clean < 12);
    }
    function drawStink(o, a, flies) {
      const b = body(a);
      o.strokeStyle = 'rgba(120,150,60,.65)'; o.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const x = b.x + (i - 1) * 14, ph = a.anim * 3 + i;
        o.beginPath();
        for (let k = 0; k <= 8; k++) { const yy = b.y - 14 - k * 3.2, xx = x + Math.sin(ph + k * 0.8) * 3; if (k) o.lineTo(xx, yy); else o.moveTo(xx, yy); }
        o.stroke();
      }
      if (flies) {
        o.fillStyle = '#222';
        for (let i = 0; i < 2; i++) {
          const an = a.anim * (4 + i) + i * 3, fx = b.x + Math.cos(an) * 22, fy = b.y - 28 + Math.sin(an * 1.7) * 9;
          o.beginPath(); o.arc(fx, fy, 2, 0, TAU); o.fill();
          o.fillStyle = 'rgba(255,255,255,.6)'; o.beginPath(); o.ellipse(fx - 2, fy - 2, 2.2, 1.2, 0.5, 0, TAU); o.fill(); o.fillStyle = '#222';
        }
      }
    }
    function drawTub(o) {
      const { x0, x1, rim, floor } = TUB, cx = (x0 + x1) / 2;
      o.fillStyle = 'rgba(40,60,80,.18)'; o.beginPath(); o.ellipse(cx, floor + 6, 74, 8, 0, 0, TAU); o.fill();
      o.fillStyle = '#d7e3ec'; o.beginPath(); o.ellipse(cx, rim, (x1 - x0) / 2, 11, 0, 0, TAU); o.fill(); // inside back
      o.fillStyle = '#b9d4e8'; o.beginPath(); o.ellipse(cx, rim + 2, (x1 - x0) / 2 - 6, 7, 0, 0, TAU); o.fill(); // water
      // dogs in the tub sit between back and front
      tubSeats.forEach(id => { const a = id != null && actors[id]; if (a && a.task && a.task.kind === 'tub' && a.task.step === 'in') drawDogActor(o, a); });
      // tub body
      const tg = o.createLinearGradient(0, rim, 0, floor);
      tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, '#d4e0ea');
      o.fillStyle = tg;
      o.beginPath(); o.moveTo(x0, rim); o.lineTo(x1, rim);
      o.quadraticCurveTo(x1 + 2, floor - 6, x1 - 18, floor - 4); o.lineTo(x0 + 18, floor - 4);
      o.quadraticCurveTo(x0 - 2, floor - 6, x0, rim); o.closePath(); o.fill();
      o.fillStyle = '#f3f8fb'; o.beginPath(); o.ellipse(cx, rim, (x1 - x0) / 2 + 3, 5, 0, 0, Math.PI); o.fill();
      o.fillStyle = '#d4a63a';
      [[x0 + 18, 1], [x1 - 18, -1]].forEach(([fx]) => { o.beginPath(); o.ellipse(fx, floor, 7, 5, 0, 0, TAU); o.fill(); });
      o.fillStyle = '#c7d2da'; o.fillRect(x1 - 12, rim - 26, 5, 26); o.fillRect(x1 - 24, rim - 28, 17, 5);
      // rubber duck on the rim
      o.fillStyle = '#ffd60a'; o.beginPath(); o.ellipse(x0 + 18, rim - 6, 7, 5, 0, 0, TAU); o.fill();
      o.beginPath(); o.arc(x0 + 23, rim - 12, 4, 0, TAU); o.fill();
      o.fillStyle = '#ff9f0a'; o.fillRect(x0 + 26, rim - 13, 4, 2);
      // foam heaps while somebody bathes
      if (tubSeats.some(id => id != null)) {
        o.fillStyle = 'rgba(255,255,255,.95)';
        for (let i = 0; i < 11; i++) {
          const bx = x0 + 10 + i * 12, by = rim + 1 - Math.abs(Math.sin(i * 1.7 + t * 1.5)) * 2.5;
          o.beginPath(); o.arc(bx, by, 5 + (i % 3) * 1.5, 0, TAU); o.fill();
        }
      }
    }
    function drawParts(o) {
      for (const p of parts) {
        const a = Math.max(0, Math.min(1, p.life / p.max * 1.6));
        o.globalAlpha = a;
        switch (p.kind) {
          case 'heart': drawHeart(o, p.x, p.y, 7 * p.size, '#ff5d8f'); break;
          case 'spark': {
            o.fillStyle = '#fff6b0';
            const s = 6 * p.size * (0.6 + 0.4 * Math.sin(p.life * 20));
            o.save(); o.translate(p.x, p.y); o.rotate(p.rot);
            o.beginPath(); o.moveTo(0, -s); o.lineTo(s * 0.25, -s * 0.25); o.lineTo(s, 0); o.lineTo(s * 0.25, s * 0.25);
            o.lineTo(0, s); o.lineTo(-s * 0.25, s * 0.25); o.lineTo(-s, 0); o.lineTo(-s * 0.25, -s * 0.25); o.closePath(); o.fill();
            o.restore(); break;
          }
          case 'tuft': o.fillStyle = p.color || '#caa'; o.beginPath(); o.arc(p.x, p.y, 2.6 * p.size, 0, TAU); o.arc(p.x + 2.5, p.y - 1, 2 * p.size, 0, TAU); o.fill(); break;
          case 'drop': o.fillStyle = '#7cc8ff'; o.beginPath(); o.ellipse(p.x, p.y, 2.2 * p.size, 3.2 * p.size, 0, 0, TAU); o.fill(); break;
          case 'splat': o.strokeStyle = 'rgba(124,200,255,.8)'; o.lineWidth = 1.2; o.beginPath(); o.ellipse(p.x, p.y, 6 * (1.4 - p.life / p.max), 2, 0, 0, TAU); o.stroke(); break;
          case 'crumb': o.fillStyle = '#7a4b22'; o.beginPath(); o.arc(p.x, p.y, 1.8 * p.size, 0, TAU); o.fill(); break;
          case 'z': o.fillStyle = '#e8ecff'; o.font = 'bold ' + Math.round(12 + (1 - p.life / p.max) * 10) * p.size + 'px ' + FONT; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillText('z', p.x, p.y); break;
          case 'puff': o.fillStyle = 'rgba(230,220,200,.55)'; o.beginPath(); o.arc(p.x, p.y, 4 + (1 - p.life / p.max) * 7, 0, TAU); o.fill(); break;
          case 'foam': {
            const r = 5 * p.size;
            o.fillStyle = 'rgba(255,255,255,.95)'; o.beginPath(); o.arc(p.x, p.y, r, 0, TAU); o.fill();
            o.strokeStyle = 'rgba(160,200,230,.8)'; o.lineWidth = 1; o.stroke();
            o.fillStyle = 'rgba(200,230,255,.9)'; o.beginPath(); o.arc(p.x - r * 0.35, p.y - r * 0.35, r * 0.28, 0, TAU); o.fill();
            break;
          }
        }
      }
      o.globalAlpha = 1;
      for (const tr of treats) {
        const u = tr.u, x = lerp(tr.x0, tr.x1, u), y = lerp(tr.y0, tr.y1, u) - Math.sin(Math.PI * u) * 90;
        o.fillStyle = '#c98a4b'; o.beginPath(); o.arc(x, y, 6, 0, TAU); o.fill();
        o.fillStyle = '#6b3e1e'; [[-2, -2], [2, 1], [-1, 3]].forEach(([dx, dy]) => { o.beginPath(); o.arc(x + dx, y + dy, 1.2, 0, TAU); o.fill(); });
      }
    }
    function drawHeart(o, x, y, s, col) {
      o.fillStyle = col;
      o.beginPath();
      o.moveTo(x, y + s * 0.9);
      o.bezierCurveTo(x - s * 1.4, y, x - s * 0.9, y - s * 1.1, x, y - s * 0.35);
      o.bezierCurveTo(x + s * 0.9, y - s * 1.1, x + s * 1.4, y, x, y + s * 0.9);
      o.fill();
      o.fillStyle = 'rgba(255,255,255,.5)'; o.beginPath(); o.arc(x - s * 0.45, y - s * 0.3, s * 0.22, 0, TAU); o.fill();
    }
    function drawBubble(o, x, y, text, fade) {
      o.globalAlpha = fade;
      o.fillStyle = 'rgba(255,255,255,.95)';
      o.beginPath(); o.ellipse(x, y, 19, 15, 0, 0, TAU); o.fill();
      o.beginPath(); o.arc(x - 12, y + 16, 4, 0, TAU); o.fill();
      o.beginPath(); o.arc(x - 17, y + 23, 2.4, 0, TAU); o.fill();
      o.font = '17px ' + FONT; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillStyle = '#222';
      o.fillText(text, x, y + 1);
      o.globalAlpha = 1;
    }

    function syncActors(ids) {
      ids.forEach(id => { if (!actors[id]) makeActor(id, ENTRY.x, ENTRY.y); if (order.indexOf(id) < 0) order.push(id); });
      order = order.filter(id => ids.indexOf(id) >= 0);
      Object.keys(actors).forEach(k => { if (ids.indexOf(+k) < 0) delete actors[k]; });
      layoutBeds();
      order.forEach(id => { slots[id].x = slots[id].tx; });
    }

    return {
      enter(ids, opts) {
        night = !!(opts && opts.night);
        parts = []; treats = []; tubSeats = [null, null, null];
        syncActors(ids);
        order.forEach((id, i) => {
          const a = actors[id];
          a.task = null; a.hop = null; a.seat = -1; a.say = null; a.bubble = null; a.wet = 0;
          if (night) {
            // home from the park: trot in through the door, then off to bed
            a.x = ENTRY.x - i * 46; a.y = ENTRY.y + (i % 3) * 14; a.inBed = false;
            setMode(a, 'enter');
          } else {
            placeInBed(a);
            setMode(a, 'wake', R(0.6, 3.2));
            slots[id].water = Math.max(slots[id].water, 0.55);
          }
        });
      },
      leave() {
        parts = []; treats = []; tubSeats = [null, null, null];
        order.forEach(id => { const a = actors[id]; if (a) { a.task = null; a.hop = null; a.seat = -1; } });
      },
      addDog(id) {
        // several adoptions at once queue up at the door instead of stacking
        const queued = order.filter(o => actors[o] && actors[o].mode === 'enter' && actors[o].x < 40).length;
        if (!actors[id]) makeActor(id, ENTRY.x - queued * 56, ENTRY.y + R(-10, 20));
        if (order.indexOf(id) < 0) order.push(id);
        layoutBeds();
        const a = actors[id];
        a.task = null; a.inBed = false;
        setMode(a, 'enter');
        const others = order.filter(o => o !== id);
        if (others.length) api.sfx('woof');
      },
      removeDog(id) {
        const a = actors[id];
        if (a && a.seat >= 0 && tubSeats[a.seat] === id) tubSeats[a.seat] = null;
        delete actors[id];
        order = order.filter(o => o !== id);
        treats = treats.filter(o => o.id !== id);
        layoutBeds();
      },
      onMessage() {},
      onCare(id, act, r) {
        const a = actors[id];
        if (!a || !r) return;
        if (a.x < 24 && !a.inBed) a.x = 24;      // still outside the door: step in so we can see it
        const big = busyBig(a);
        switch (r.fx) {
          case 'hearts': case 'sparkle': {
            const kind = r.fx === 'hearts' ? 'pet' : 'brush';
            if (a.task && a.task.kind === kind) a.task.t = CARE_HOLD;
            else if (big || a.hop) { if (kind === 'pet') hearts(a, 1); else sparkles(a, 2); }
            else { a.task = { kind, t: CARE_HOLD, fx: 0 }; if (!a.inBed) a.mode = 'idle'; if (kind === 'pet' && rnd() < 0.25) api.sfx('yip'); }
            return;
          }
          case 'eat': case 'drink': {
            const s = bedOf(id);
            if (r.fx === 'eat') s.food = 1; else s.water = 1;
            if (r.fx === 'drink') api.sfx('slurp');
            if (a.task && a.task.kind === 'tub') return;      // eats after the bath
            a.task = { kind: r.fx, step: 'go', t: 0, fx: 0 };
            a.inBed = false;
            return;
          }
          case 'treat':
            if (big) { hearts(a, 2); return; }
            a.task = { kind: 'treat', step: 'beg', t: 0.7, fx: 0 };   // in bed: begs right on the cushion
            api.sfx('yip');
            return;
          case 'tub':
            if (a.task && a.task.kind === 'tub') return;
            a.task = { kind: 'tub', step: 'go', t: 0, fx: 0 }; a.inBed = false;
            return;
          case 'shake': leaveTub(a, 'shake'); api.sfx('splash'); return;
          case 'untub': if (a.seat >= 0 || (a.task && a.task.kind === 'tub')) leaveTub(a, 'untub'); return;
          case 'refuse':
            if (!big) { a.task = { kind: 'refuse', t: 1.1, fx: 0 }; }
            say(a, act === 'water' ? '💧✋' : act === 'feed' ? '🍖✋' : '🙅', 1.5);
            return;
          default:
            if (!r.ok && !big) { a.task = { kind: 'sad', t: 1.3 }; say(a, '🥺', 1.5); api.sfx('whine'); }
        }
      },
      update(dt) {
        t += dt;
        order.forEach(id => { const s = slots[id]; if (s) s.x += (s.tx - s.x) * Math.min(1, dt * 4); });
        order.forEach(id => {
          const a = actors[id], dog = dogOf(id);
          if (!a || !dog) return;
          a.anim += dt;
          if (a.wet > 0) {
            a.wet = Math.max(0, a.wet - dt / WET_DRY_TIME);
            if (a.wet > 0.25 && rnd() < dt * 2.5) { const b = body(a); spawn('drop', b.x + R(-b.w * 0.3, b.w * 0.3), b.y + 6, { vy: 20, life: 0.6, size: 0.6, gy: a.y }); }
          }
          if (a.hop && !(a.task && (a.task.step === 'hop' || a.task.step === 'hopout'))) a.hop = null;
          if (a.task) runTask(a, dt); else runMode(a, dt);
          if (a.say) { a.say.t -= dt; if (a.say.t <= 0) a.say = null; }
          a.bubbleT -= dt;
          if (a.bubbleT <= 0) {
            a.bubbleT = BUBBLE_EVERY + R(0, 2);
            const need = WW.urgentNeed(dog);
            a.bubble = need && !a.task && a.pose !== 'sleep' ? { text: NEED_BUBBLE[need], t: BUBBLE_SHOW } : null;
          }
          if (a.bubble) { a.bubble.t -= dt; if (a.bubble.t <= 0 || a.task) a.bubble = null; }
        });
        // gentle separation so idle dogs do not stack
        for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
          const a = actors[order[i]], b = actors[order[j]];
          if (!a || !b || a.task || b.task || a.inBed || b.inBed) continue;
          if (a.mode === 'chase' || b.mode === 'chase' || a.mode === 'flee' || b.mode === 'flee') continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          if (Math.abs(dx) < 46 && Math.abs(dy) < 14) {
            const push = (46 - Math.abs(dx)) * dt * 1.5 * (dx >= 0 ? 1 : -1);
            a.x = Math.max(WANDER.x0 - 30, a.x - push); b.x = Math.min(WANDER.x1 + 30, b.x + push);
          }
        }
        updateParts(dt);
      },
      draw(o) {
        if (!bg) bg = buildRoom();
        drawSky(o);
        o.drawImage(bg, 0, 0);
        drawClock(o);
        if (night) {
          o.fillStyle = 'rgba(12,16,48,.58)'; o.fillRect(0, 0, W, 600);
          drawStars(o);
          drawLampLight(o);
        }
        // depth-sorted world: beds, bowls, tub, dogs
        const items = [];
        order.forEach(id => {
          const s = bedOf(id);
          items.push({ y: BED_Y, f: () => drawBed(o, id) });
          items.push({ y: BED_Y + BOWL_DY, f: () => { drawBowl(o, s.x - BOWL_DX, BED_Y + BOWL_DY, 'food', s.food); drawBowl(o, s.x + BOWL_DX, BED_Y + BOWL_DY, 'water', s.water); } });
          const a = actors[id];
          if (a && !(a.task && a.task.kind === 'tub' && a.task.step === 'in')) items.push({ y: a.inBed ? BED_Y + 1 : a.y + 0.2, f: () => drawDogActor(o, a) });
        });
        items.push({ y: TUB.floor, f: () => drawTub(o) });
        items.sort((p, q) => p.y - q.y).forEach(it => it.f());
        if (night) { o.fillStyle = 'rgba(12,16,48,.16)'; o.fillRect(0, 0, W, 600); }
        drawParts(o);
        order.forEach(id => {
          const a = actors[id];
          if (!a) return;
          const h = head(a);
          if (a.say) drawBubble(o, h.x + 18, h.y - 26, a.say.text, Math.min(1, a.say.t * 3));
          else if (a.bubble) drawBubble(o, h.x + 18, h.y - 26, a.bubble.text, Math.min(1, a.bubble.t * 3, (BUBBLE_SHOW - a.bubble.t) * 4));
        });
      },
      dogPos(id) {
        const a = actors[id];
        if (!a) return null;
        const h = head(a);
        return { x: h.x, y: h.y - 16 };
      },
      // Harness bots: a few random care acts per dog so every animation shows up.
      devBot(id, r) {
        const dog = dogOf(id), now = api.time();
        if (!dog || !actors[id]) return null;
        const b = bots[id] || (bots[id] = { next: now + 0.5 + r() * 2.5, bathAt: 0, petUntil: 0, petNext: 0, kind: 'pet' });
        if (b.bathAt && now >= b.bathAt) { b.bathAt = 0; return { t: 'wwCare', act: 'bath' }; }
        if (now < b.petUntil) {
          if (now >= b.petNext) { b.petNext = now + 0.25; return b.kind === 'pet' ? { t: 'wwCare', act: 'pet', zone: WW.pick(WW.SPOTS, r) } : { t: 'wwCare', act: 'brush' }; }
          return null;
        }
        if (now < b.next || b.bathAt) return null;
        b.next = now + 2.5 + r() * 4;
        const n = dog.needs, roll = r();
        if (n.food < 60 && dog.inv.kibble > 0) return { t: 'wwCare', act: 'feed', item: 'kibble' };
        if (n.water < 70) return { t: 'wwCare', act: 'water' };
        if ((n.clean < 60 || roll < 0.12) && dog.inv.shampoo > 0) { b.bathAt = now + 5 + r() * 4; b.next = b.bathAt + 2; return { t: 'wwCare', act: 'bathStart' }; }
        if (roll < 0.5) { b.kind = roll < 0.32 ? 'pet' : 'brush'; b.petUntil = now + 1.5 + r() * 2; return null; }
        if (roll < 0.65 && dog.inv.treat > 0) return { t: 'wwCare', act: 'treat' };
        if (roll < 0.75) return { t: 'wwCare', act: 'feed', item: 'kibble' };   // often refused: shows the head shake
        return null;
      }
    };
  };
})();
