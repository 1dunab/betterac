// ============ Controller-Modul: WÜRFELVERLIES ============
// The phone is the player's private table: dice pool, crest pool, own monsters, every action.
// The screen sends vlState (what this phone may see, see docs/VERLIES.md); the phone runs the same rules.js
// on it to show what is possible right away (reach, targets, valid places), the screen checks again.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #v-verlies { background:radial-gradient(circle at 50% 0%, #241a30, #100c16 70%); }
  #vlHead { display:flex; align-items:center; gap:10px; padding:10px 14px 6px; flex:none; }
  #vlDot { width:18px; height:18px; border-radius:50%; flex:none; box-shadow:0 0 10px currentColor; }
  #vlName { font:700 20px Georgia,serif; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #vlHearts { font-size:18px; letter-spacing:1px; white-space:nowrap; }
  #vlClock { font-weight:800; font-size:16px; min-width:44px; text-align:right; color:#ffd36a; }
  #vlStatus { padding:0 14px 6px; font-size:15px; color:#d8cfe6; flex:none; min-height:20px; }
  #vlStatus b { color:#fff; }
  #vlCrests { display:flex; gap:6px; padding:0 10px 8px; flex:none; }
  .vlc { flex:1; display:flex; flex-direction:column; align-items:center; gap:1px; background:#1d1727; border-radius:12px; padding:6px 2px 4px; border:1px solid rgba(255,255,255,.06); }
  .vlc b { font-size:20px; line-height:1; }
  .vlc.full b { color:#ffd36a; }
  .vlc.zero { opacity:.45; }
  #vlMain { flex:1; min-height:0; overflow-y:auto; touch-action:pan-y; scrollbar-width:thin; scrollbar-color:#3a3048 transparent; -webkit-overflow-scrolling:touch; padding:2px 12px 12px; display:flex; flex-direction:column; gap:10px; }
  #vlFoot { flex:none; display:flex; gap:8px; padding:8px 12px 12px; background:rgba(10,8,14,.75); border-top:1px solid rgba(255,255,255,.07); }
  #vlFoot:empty { display:none; }
  #vlFoot .vlbtn { flex:1; font-size:18px; padding:14px 8px; }
  .vlbtn { border:none; border-radius:14px; padding:14px 12px; font-size:17px; font-weight:800; background:#33293f; color:#fff; min-height:52px; }
  .vlbtn:disabled { opacity:.38; }
  .vlbtn.go { background:linear-gradient(#ffd36a,#e0a030); color:#2a1800; }
  .vlbtn.red { background:#b3263a; }
  .vlbtn.blue { background:#2f6bd6; }
  .vlbtn.sel { outline:3px solid #ffd36a; }
  .vlhint { font-size:14px; color:#b8aec8; line-height:1.35; text-align:center; }
  .vlcard { background:linear-gradient(#211a2c,#18121f); border-radius:16px; padding:10px; border:2px solid rgba(255,255,255,.07); display:flex; flex-direction:column; gap:8px; }
  .vlcard.pick { border-color:#ffd36a; box-shadow:0 0 18px rgba(255,211,106,.35); }
  .vlcard.used { opacity:.38; }
  .vlrow { display:flex; align-items:center; gap:10px; }
  .vlpt { width:64px; height:64px; border-radius:50%; flex:none; border:3px solid #444; background:#111; }
  .vlpt.big { width:120px; height:120px; }
  .vlnm { font:700 18px Georgia,serif; }
  .vlsub { font-size:13px; color:#b8aec8; }
  .vlstats { display:flex; gap:10px; font-size:14px; font-weight:700; color:#e8e0f4; flex-wrap:wrap; }
  .vlfaces { display:flex; gap:3px; }
  .vlface { width:30px; height:30px; border-radius:7px; background:#efe8dc; display:flex; align-items:center; justify-content:center; position:relative; }
  .vlface i { position:absolute; right:1px; bottom:-1px; font:900 10px system-ui; color:#3a2a2a; font-style:normal; }
  .vlacts { display:flex; gap:6px; flex-wrap:wrap; }
  .vlacts .vlbtn { flex:1 1 40%; padding:12px 6px; font-size:15px; min-height:46px; }
  .vlhp { height:8px; border-radius:4px; background:#0a080e; overflow:hidden; flex:1; }
  .vlhp > div { height:100%; border-radius:4px; }
  .vltabs { display:flex; gap:6px; }
  .vltabs .vlbtn { flex:1; padding:10px 4px; font-size:15px; min-height:44px; }
  .vldice { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .vldie { background:#1d1727; border-radius:14px; padding:8px; border:2px solid transparent; display:flex; flex-direction:column; gap:6px; align-items:center; text-align:center; }
  .vldie.pick { border-color:#ffd36a; background:#2d2433; }
  .vldie.used { opacity:.3; }
  .vldie .vlpt { width:54px; height:54px; }
  .vldie .vlfaces { flex-wrap:wrap; justify-content:center; }
  .vldie .vlfaces { gap:2px; }
  .vldie .vlface { width:22px; height:22px; }
  #vlBoardWrap { position:relative; }
  #vlBoard { width:100%; aspect-ratio:1/1; display:block; background:#0b0910; border-radius:12px; margin:0; touch-action:none; }
  #vlZoom { position:absolute; right:8px; top:8px; min-height:40px; padding:6px 12px; font-size:15px; }
  .vlpad { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
  .vlpad .vlbtn { font-size:22px; padding:10px 0; min-height:50px; }
  .vlbig { font:800 24px Georgia,serif; text-align:center; }
  #vlModal { position:fixed; inset:0; z-index:900; background:rgba(6,4,10,.86); display:none; align-items:center; justify-content:center; padding:14px; box-sizing:border-box; }
  #vlModal.on { display:flex; }
  #vlModalBox { width:100%; max-width:460px; max-height:100%; overflow-y:auto; touch-action:pan-y; background:linear-gradient(#271d33,#16111d); border-radius:20px; padding:16px; display:flex; flex-direction:column; gap:10px; border:2px solid #ff6a4a; }
  #vlRoll { position:fixed; inset:0; z-index:850; display:none; flex-direction:column; align-items:center; justify-content:center; gap:22px; background:rgba(8,6,12,.9); perspective:700px; }
  #vlRoll.on { display:flex; }
  .vlcubes { display:flex; gap:26px; }
  .vlcube { width:76px; height:76px; position:relative; transform-style:preserve-3d; }
  .vlcube > div { position:absolute; inset:0; border-radius:12px; background:linear-gradient(135deg,#fffaf2,#d6ccbe); border:3px solid #b9a98f; display:flex; align-items:center; justify-content:center; box-sizing:border-box; backface-visibility:hidden; }
  .vlcube > div i { position:absolute; right:5px; bottom:2px; font:900 15px system-ui; font-style:normal; color:#3a2a2a; }
  .vlcube.lit > div:first-child { box-shadow:0 0 26px #ffd36a; border-color:#ffd36a; }
  #vlRollText { font:700 20px system-ui; text-align:center; min-height:56px; padding:0 20px; }
  #vlToast { position:fixed; left:12px; right:12px; top:10px; z-index:950; background:#2a1a24; border:2px solid #ff6a4a; border-radius:14px; padding:12px; font-weight:700; text-align:center; display:none; }
  #vlToast.info { background:#221c2c; border-color:#ffd36a; }
  .vlbag { border-radius:18px; padding:12px; display:flex; flex-direction:column; gap:8px; border:3px solid transparent; background:#1d1727; }
  .vlbag.pick { border-color:#ffd36a; }
  .vlbag .vlpt { width:56px; height:56px; }
  .vlseat { display:inline-flex; align-items:center; gap:6px; background:#2a2234; border-radius:12px; padding:4px 10px; font-size:14px; font-weight:700; margin:2px; }
  .vlseat span { width:12px; height:12px; border-radius:50%; display:inline-block; }
</style>
<div id="v-verlies" class="view">
  <div id="vlHead"><span id="vlDot"></span><span id="vlName">Würfelverlies</span><span id="vlHearts"></span><span id="vlClock"></span></div>
  <div id="vlStatus"></div>
  <div id="vlCrests"></div>
  <div id="vlMain"></div>
  <div id="vlFoot"></div>
</div>
<div id="vlModal"><div id="vlModalBox"></div></div>
<div id="vlRoll"><div class="vlcubes" id="vlCubes"></div><div id="vlRollText"></div><button id="vlRollOk" class="vlbtn go" style="min-width:200px">Weiter</button></div>
<div id="vlToast"></div>`);
  VIEWS.push('verlies');

  const D = window.VerliesData, R = window.VerliesRules, A = window.VerliesArt;
  const toScreen = (m) => ac.message(AirConsole.SCREEN, m);
  const vib = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const crest = (c, n) => A.crestSVG(c, n || 22);
  const costTxt = (cost) => Object.keys(cost || {}).map((c) => cost[c] + ' ' + D.CREST[c].emoji).join(' ');
  const STAGE_TXT = { roll: 'wählt Würfel', summon: 'beschwört', place: 'legt ein Verlies-Stück', act: 'ist am Zug' };

  let S = null, G = null, me = -1;            // the last vlState, its game rebuilt for rules.js, my seat
  let ui = null;                               // local choices, reset by activate()
  let lastMain = '', lastRollN = 0, lastPend = '', toastTimer = null, rollTimer = null;
  const resetUi = () => { ui = { tab: 'mons', pick: [], mon: null, mode: null, ab: null, dest: null, cell: null, piece: null, zoom: false, vp: null, endAsk: 0, info: null }; };
  resetUi();

  // ---------- the game as rules.js wants it ----------
  function rebuild(g) {
    const st = { w: g.w, h: g.h, n: g.n, teams: g.teams, cfg: g.cfg, kind: [], owner: [], piece: [], pieces: [], seats: g.seats, mons: g.mons, items: g.items, turn: g.turn, over: g.over, nextId: g.nextId, rng: 1 };
    for (let i = 0; i < g.board.length; i++) {
      const c = g.board.charCodeAt(i);
      if (c === 46) { st.kind.push(R.EMPTY); st.owner.push(-1); }
      else if (c >= 97) { st.kind.push(R.PATH); st.owner.push(c - 97); }
      else { st.kind.push(R.MASTER); st.owner.push(c - 65); }
      st.piece.push(-1);
    }
    return st;
  }
  const myTurn = () => !!G && !G.over && me >= 0 && G.turn.seat === me;
  const mine = () => (G ? G.mons.filter((m) => m.seat === me) : []);
  const seatName = (s) => (S && S.seats[s] ? S.seats[s].name : '?');
  const seatColor = (s) => (S && S.seats[s] ? S.seats[s].color : '#888');

  // ---------- small pieces of markup ----------
  function facesHTML(key, big) {
    return '<div class="vlfaces">' + D.facesOf(key).map((f) => '<div class="vlface">' + crest(f.c, big ? 22 : 18) + (f.c === 'SUM' ? '<i>' + D.MONSTERS[key].level + '</i>' : f.n > 1 ? '<i>×' + f.n + '</i>' : '') + '</div>').join('') + '</div>';
  }
  const pt = (key, cls, col) => '<canvas class="vlpt ' + (cls || '') + '" data-pt="' + key + '" width="128" height="128" style="border-color:' + (col || '#444') + '"></canvas>';
  function paintPortraits(root) {
    root.querySelectorAll('canvas[data-pt]').forEach((c) => {
      const p = A.portrait(c.dataset.pt, c.width);
      const g = c.getContext('2d');
      if (p && g) { try { g.drawImage(p, 0, 0, c.width, c.height); } catch (e) {} }
    });
  }
  const stars = (n) => '★'.repeat(n);
  function hpBar(m) {
    const f = Math.max(0, Math.min(1, m.hp / m.maxHp)), c = f > 0.6 ? '#55e07a' : f > 0.3 ? '#f2c94c' : '#ff5a4e';
    return '<div class="vlhp"><div style="width:' + (f * 100).toFixed(0) + '%;background:' + c + '"></div></div><b style="font-size:14px">' + m.hp + '/' + m.maxHp + '</b>';
  }
  function abilityLines(key) {
    return D.MONSTERS[key].abil.map((ab) => { const A2 = D.ABIL[ab]; return '<div class="vlsub">' + A2.icon + ' <b>' + A2.name + '</b>' + (A2.cost ? ' (' + costTxt(A2.cost) + ')' : '') + ': ' + esc(A2.text) + '</div>'; }).join('');
  }
  function monInfoHTML(key, m) {
    const d = D.MONSTERS[key];
    const kind = d.kind === 'item' ? 'Gegenstand' : 'Stufe ' + d.level + ' ' + stars(d.level);
    let h = '<div class="vlrow">' + pt(key, 'big', D.BAGS[d.bag] ? D.BAGS[d.bag].color : '#888') + '<div><div class="vlnm" style="font-size:22px">' + esc(d.name) + '</div><div class="vlsub">' + kind + '</div>';
    if (d.kind !== 'item') h += '<div class="vlstats"><span>⚔️ ATK ' + d.atk + '</span><span>🛡️ DEF ' + d.def + '</span><span>❤️ LP ' + (m ? m.hp + '/' + m.maxHp : d.hp) + '</span></div>';
    h += '</div></div>';
    if (d.kind === 'item') h += '<div class="vlsub">' + esc(D.ITEMS[d.item].text) + '</div>';
    h += abilityLines(key) + '<div class="vlsub">Würfelseiten:</div>' + facesHTML(key, true) + '<div class="vlsub"><i>„' + esc(d.lore) + '“</i></div>';
    return h;
  }

  // ---------- the mini board ----------
  function boardHTML() { return '<div id="vlBoardWrap"><canvas id="vlBoard" width="400" height="400"></canvas><button id="vlZoom" class="vlbtn">' + (ui.zoom ? '🗺️ Ganz' : '🔍 Nah') + '</button></div>'; }
  // what to show on it: { reach: Map, targets: [cells], piece: { cells, ok }, anchors: [[x,y]], cells: [cells to tap] }
  let boardOpts = {};
  function viewport() {
    const n = ui.zoom ? Math.min(G.w, 9) : G.w;
    if (!ui.vp || ui.vp.n !== n) {
      let fx = G.w / 2, fy = G.h / 2;
      const m = ui.mon && R.monById(G, ui.mon);
      if (ui.piece) { fx = ui.piece.x + 0.5; fy = ui.piece.y + 0.5; }
      else if (m) { fx = R.X(G, m.at) + 0.5; fy = R.Y(G, m.at) + 0.5; }
      else if (me >= 0 && G.seats[me]) { fx = R.X(G, G.seats[me].dm) + 0.5; fy = R.Y(G, G.seats[me].dm) + 0.5; }
      ui.vp = { n, x0: Math.max(0, Math.min(G.w - n, fx - n / 2)), y0: Math.max(0, Math.min(G.h - n, fy - n / 2)) };
    }
    return ui.vp;
  }
  function drawBoard() {
    const c = $('vlBoard'); if (!c || !G) return;
    const px = Math.round((c.clientWidth || 360) * Math.min(2, window.devicePixelRatio || 1));
    if (c.width !== px) { c.width = px; c.height = px; }
    const g = c.getContext('2d'); if (!g) return;
    const vp = viewport(), cs = px / vp.n;
    const sx = (x) => (x - vp.x0) * cs, sy = (y) => (y - vp.y0) * cs;
    g.fillStyle = '#0b0910'; g.fillRect(0, 0, px, px);
    for (let i = 0; i < G.kind.length; i++) {
      const x = R.X(G, i), y = R.Y(G, i);
      if (x < vp.x0 - 1 || y < vp.y0 - 1 || x > vp.x0 + vp.n || y > vp.y0 + vp.n) continue;
      const k = G.kind[i];
      g.fillStyle = k === R.EMPTY ? '#1d1a24' : k === R.PATH ? A.mix('#3a3542', seatColor(G.owner[i]), 0.35) : seatColor(G.owner[i]);
      g.fillRect(sx(x) + 1, sy(y) + 1, cs - 2, cs - 2);
      if (k === R.MASTER) { g.fillStyle = '#fff'; g.font = '700 ' + Math.round(cs * 0.6) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(G.seats[G.owner[i]].alive ? '👑' : '💀', sx(x) + cs / 2, sy(y) + cs / 2); }
    }
    const O = boardOpts;
    if (O.reach) for (const [i, e] of O.reach) {
      const x = R.X(G, i), y = R.Y(G, i);
      g.fillStyle = i === ui.dest ? 'rgba(255,211,106,.75)' : 'rgba(63,208,201,.45)'; g.fillRect(sx(x) + 2, sy(y) + 2, cs - 4, cs - 4);
      g.fillStyle = '#fff'; g.font = '800 ' + Math.round(cs * 0.4) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e.cost, sx(x) + cs / 2, sy(y) + cs / 2);
    }
    if (O.cells) for (const i of O.cells) { const x = R.X(G, i), y = R.Y(G, i); g.fillStyle = i === ui.cell ? 'rgba(255,211,106,.8)' : 'rgba(166,217,74,.45)'; g.fillRect(sx(x) + 2, sy(y) + 2, cs - 4, cs - 4); }
    if (O.anchors) { g.fillStyle = A.rgba(seatColor(me), 0.7); for (const [x, y] of O.anchors) { g.beginPath(); g.arc(sx(x) + cs / 2, sy(y) + cs / 2, cs * 0.12, 0, 6.283); g.fill(); } }
    // items: own ones with their icon
    for (const t of G.items) {
      const x = R.X(G, t.at), y = R.Y(G, t.at);
      g.fillStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.arc(sx(x) + cs / 2, sy(y) + cs / 2, cs * 0.32, 0, 6.283); g.fill();
      g.font = Math.round(cs * 0.45) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = seatColor(t.seat);
      g.fillText(t.key && D.ITEMS[t.key] ? D.ITEMS[t.key].icon : '?', sx(x) + cs / 2, sy(y) + cs / 2);
    }
    for (const m of G.mons) {
      const x = R.X(G, m.at), y = R.Y(G, m.at), cx = sx(x) + cs / 2, cy = sy(y) + cs / 2, r = cs * 0.44;
      g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.fillStyle = m.seat < 0 ? '#777' : seatColor(m.seat); g.fill();
      const p = A.portrait(m.key, cs > 40 ? 112 : 72);
      g.save(); g.beginPath(); g.arc(cx, cy, r * 0.84, 0, 6.283); g.clip(); if (p) g.drawImage(p, cx - r * 0.84, cy - r * 0.84, r * 1.68, r * 1.68); g.restore();
      if (m.id === ui.mon) { g.strokeStyle = '#ffd36a'; g.lineWidth = Math.max(2, cs * 0.08); g.beginPath(); g.arc(cx, cy, r + 1, 0, 6.283); g.stroke(); }
    }
    if (O.targets) for (const i of O.targets) {
      const x = R.X(G, i), y = R.Y(G, i);
      g.strokeStyle = i === ui.cell ? '#ffd36a' : '#ff4a3a'; g.lineWidth = Math.max(2, cs * 0.09);
      g.beginPath(); g.arc(sx(x) + cs / 2, sy(y) + cs / 2, cs * 0.47, 0, 6.283); g.stroke();
    }
    if (O.piece) {
      for (const [x, y] of O.piece.cells) {
        if (!R.inside(G, x, y)) continue;
        g.fillStyle = O.piece.ok ? 'rgba(255,211,106,.8)' : 'rgba(255,60,60,.7)'; g.fillRect(sx(x) + 1, sy(y) + 1, cs - 2, cs - 2);
        g.strokeStyle = O.piece.ok ? '#fff6d0' : '#ffd0d0'; g.lineWidth = Math.max(2, cs * 0.08); g.strokeRect(sx(x) + 2, sy(y) + 2, cs - 4, cs - 4);
      }
      const k = D.MONSTERS[G.seats[me].dice[G.turn.chosen].key], p = A.portrait(k.key, 112), cx = sx(ui.piece.x) + cs / 2, cy = sy(ui.piece.y) + cs / 2;
      g.save(); g.globalAlpha = 0.9; g.beginPath(); g.arc(cx, cy, cs * 0.4, 0, 6.283); g.clip(); if (p) g.drawImage(p, cx - cs * 0.4, cy - cs * 0.4, cs * 0.8, cs * 0.8); g.restore();
    }
  }
  // tap and drag on the board
  let drag = null;
  function cellAt(e) {
    const c = $('vlBoard'), r = c.getBoundingClientRect(), vp = viewport();
    const x = Math.floor(vp.x0 + (e.clientX - r.left) / (r.width || 1) * vp.n), y = Math.floor(vp.y0 + (e.clientY - r.top) / (r.height || 1) * vp.n);
    return R.inside(G, x, y) ? [x, y] : null;
  }
  document.addEventListener('pointerdown', (e) => { if (e.target && e.target.id === 'vlBoard') { drag = { x: e.clientX, y: e.clientY, moved: false, vx: ui.vp ? ui.vp.x0 : 0, vy: ui.vp ? ui.vp.y0 : 0 }; e.preventDefault(); } });
  document.addEventListener('pointermove', (e) => {
    if (!drag || !G || !ui.vp) return;
    const c = $('vlBoard'); if (!c) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 10) drag.moved = true;
    if (drag.moved && ui.zoom) {
      const k = ui.vp.n / (c.getBoundingClientRect().width || 1);
      ui.vp.x0 = Math.max(0, Math.min(G.w - ui.vp.n, drag.vx - dx * k)); ui.vp.y0 = Math.max(0, Math.min(G.h - ui.vp.n, drag.vy - dy * k));
      drawBoard();
    }
  });
  document.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved || !G || !e.target || e.target.id !== 'vlBoard') return;
    const c = cellAt(e); if (c) tapCell(c[0], c[1]);
  });
  function tapCell(x, y) {
    const i = R.idx(G, x, y);
    if (G.turn.stage === 'place' && ui.piece && myTurn()) { ui.piece.x = x; ui.piece.y = y; pieceChanged(); return; }
    if (ui.mode === 'move' && boardOpts.reach && boardOpts.reach.has(i)) { ui.dest = i; vib(15); render(true); return; }
    if ((ui.mode === 'ability' || ui.mode === 'attack') && boardOpts.cells && boardOpts.cells.indexOf(i) >= 0) { ui.cell = i; vib(15); render(true); return; }
    if ((ui.mode === 'ability' || ui.mode === 'attack') && boardOpts.targets && boardOpts.targets.indexOf(i) >= 0) { ui.cell = i; vib(15); render(true); return; }
    const m = G.mons.find((o) => o.at === i);
    if (m && m.seat === me) { selectMon(m.id, null); return; }
    if (m) { ui.info = { key: m.key, mon: m }; render(true); }
  }

  // ---------- placing a piece ----------
  function orientKey(cells) { return cells.map((c) => c[0] + ',' + c[1]).sort().join(' '); }
  function turnPiece(how) {
    const o = D.ORIENT[ui.piece.shape][ui.piece.ori].cells;
    const t = o.map(([x, y]) => (how === 'rot' ? [-y, x] : [-x, y]));
    const want = orientKey(t), list = D.ORIENT[ui.piece.shape];
    const k = list.findIndex((x) => orientKey(x.cells) === want);
    if (k >= 0) ui.piece.ori = k;
    pieceChanged();
  }
  function firstPlacement() {
    let best = null, bd = Infinity;
    const cx = G.w / 2, cy = G.h / 2;
    for (let sh = 0; sh < D.ORIENT.length; sh++) for (let o = 0; o < D.ORIENT[sh].length; o++) {
      for (const [x, y] of R.validAnchors(G, me, sh, o)) { const d = Math.hypot(x - cx, y - cy) + sh * 0.01; if (d < bd) { bd = d; best = { shape: sh, ori: o, x, y }; } }
    }
    return best || { shape: 0, ori: 0, x: R.X(G, G.seats[me].dm), y: R.Y(G, G.seats[me].dm) };
  }
  // the nearest valid spot for this shape; if there is none, the next shape that fits somewhere
  function suggest() {
    const P = ui.piece;
    for (let k = 0; k < D.ORIENT.length * 8; k++) {
      const anchors = R.validAnchors(G, me, P.shape, P.ori);
      if (anchors.length) {
        const cur = anchors.findIndex(([x, y]) => x === P.x && y === P.y);
        const pick = cur >= 0 ? anchors[(cur + 1) % anchors.length] : anchors.slice().sort((a, b) => Math.hypot(a[0] - P.x, a[1] - P.y) - Math.hypot(b[0] - P.x, b[1] - P.y))[0];
        P.x = pick[0]; P.y = pick[1]; pieceChanged(); return;
      }
      P.ori++; if (P.ori >= D.ORIENT[P.shape].length) { P.ori = 0; P.shape = (P.shape + 1) % D.ORIENT.length; }
    }
  }
  function pieceChanged() {
    const P = ui.piece;
    P.x = Math.max(0, Math.min(G.w - 1, P.x)); P.y = Math.max(0, Math.min(G.h - 1, P.y));
    toScreen({ t: 'vlPiece', shape: P.shape, ori: P.ori, x: P.x, y: P.y });
    if (ui.zoom && ui.vp) { ui.vp.x0 = Math.max(0, Math.min(G.w - ui.vp.n, P.x + 0.5 - ui.vp.n / 2)); ui.vp.y0 = Math.max(0, Math.min(G.h - ui.vp.n, P.y + 0.5 - ui.vp.n / 2)); }
    render(true);
  }

  // ---------- choosing a monster and an action ----------
  function selectMon(id, mode, ab) {
    ui.mon = id; ui.mode = mode; ui.ab = ab || null; ui.dest = null; ui.cell = null; ui.endAsk = 0;
    if (mode === 'move' || mode === 'attack' || mode === 'ability') { ui.zoom = G.w > 13; ui.vp = null; }
    toScreen({ t: 'vlSel', mon: id, mode: mode === 'abilities' ? null : mode, ab: ab || null });
    render(true);
  }
  function backToList() { ui.mon = null; ui.mode = null; ui.ab = null; ui.dest = null; ui.cell = null; ui.zoom = false; ui.vp = null; toScreen({ t: 'vlSel', mon: null }); render(true); }

  // ---------- screens ----------
  function renderHead() {
    const s = me >= 0 && S.seats[me];
    $('vlDot').style.background = s ? s.color : '#666'; $('vlDot').style.color = s ? s.color : '#666';
    $('vlName').textContent = s ? s.name : '👀 Zuschauer';
    const gs = G && me >= 0 ? G.seats[me] : null;
    $('vlHearts').textContent = gs ? '❤️'.repeat(gs.hearts) + '🖤'.repeat(Math.max(0, G.cfg.hearts - gs.hearts)) : '';
    $('vlClock').textContent = S.phase === 'prep' ? (S.prep.left ? S.prep.left + ' s' : '') : S.defSecs && G && G.turn.pending && G.turn.pending.seat === me ? S.defSecs + ' s' : S.secs ? '⏱ ' + S.secs : '';
    let st = '';
    if (S.phase === 'prep') st = 'Wähle deinen Würfelbeutel';
    else if (G.over) st = '🏆 Spielende';
    else if (me >= 0 && !G.seats[me].alive) st = '💀 Du bist ausgeschieden – schau zu';
    else if (G.turn.pending) st = G.turn.pending.seat === me ? '<b>⚠️ Du wirst angegriffen!</b>' : '⚔️ Angriff läuft …';
    else if (myTurn()) st = '<b>▶ Du bist dran!</b> Runde ' + G.turn.round;
    else st = '<span style="color:' + seatColor(G.turn.seat) + '">●</span> ' + esc(seatName(G.turn.seat)) + ' ' + STAGE_TXT[G.turn.stage] + ' · Runde ' + G.turn.round;
    $('vlStatus').innerHTML = st;
    const cr = $('vlCrests');
    if (G && me >= 0) {
      const p = G.seats[me].crests;
      cr.innerHTML = D.POOL.map((c) => '<div class="vlc' + (p[c] >= G.cfg.cap ? ' full' : '') + (p[c] ? '' : ' zero') + '">' + crest(c, 22) + '<b>' + p[c] + '</b></div>').join('');
      cr.style.display = '';
    } else cr.style.display = 'none';
  }

  function prepHTML() {
    const mineBag = S.prep.bags[me];
    let h = '<div class="vlhint">Jeder Beutel hat 15 Würfel: 5× Stufe 1, 4× Stufe 2 + ein Gegenstand, 3× Stufe 3 und 2× Stufe 4.</div>';
    for (const k of D.BAG_KEYS) {
      const b = D.BAGS[k], who = S.seats.map((s, i) => (S.prep.bags[i] === k ? '<span class="vlseat"><span style="background:' + s.color + '"></span>' + esc(s.name) + '</span>' : '')).join('');
      const show = [...new Set(b.dice)].filter((x) => D.MONSTERS[x].kind !== 'item');
      h += '<div class="vlbag' + (mineBag === k ? ' pick' : '') + '" style="background:linear-gradient(' + A.mix('#1d1727', b.color, 0.28) + ',#16111d)">' +
        '<div class="vlrow"><span style="font-size:34px">' + b.emoji + '</span><div><div class="vlnm" style="font-size:22px">' + b.name + '</div><div class="vlsub">' + esc(b.text) + '</div></div></div>' +
        '<div class="vlrow" style="gap:4px;flex-wrap:wrap">' + show.map((x) => pt(x, '', b.color)).join('') + '</div>' +
        (who ? '<div>' + who + '</div>' : '') +
        (me >= 0 ? '<button class="vlbtn ' + (mineBag === k ? 'go' : '') + '" data-bag="' + k + '">' + (mineBag === k ? '✓ Gewählt' : 'Diesen Beutel nehmen') + '</button>' : '') + '</div>';
    }
    return h;
  }

  function diceHTML(selectable) {
    const dice = G.seats[me].dice;
    const order = dice.map((d, k) => k).sort((a, b) => (dice[a].used - dice[b].used) || (D.MONSTERS[dice[a].key].level - D.MONSTERS[dice[b].key].level));
    return '<div class="vldice">' + order.map((k) => {
      const d = dice[k], m = D.MONSTERS[d.key], pick = ui.pick.indexOf(k) >= 0;
      return '<div class="vldie' + (d.used ? ' used' : '') + (pick ? ' pick' : '') + '" ' + (selectable && !d.used ? 'data-die="' + k + '"' : '') + '>' +
        pt(d.key, '', D.BAGS[m.bag] ? D.BAGS[m.bag].color : '#9aa') + '<div style="font-weight:800;font-size:14px">' + esc(m.name) + '</div>' +
        '<div class="vlsub">' + (m.kind === 'item' ? 'Gegenstand · ' : '') + 'Stufe ' + m.level + ' <span style="color:#ffd36a">' + stars(m.level) + '</span>' + (d.used ? ' · im Spiel' : '') + '</div>' + facesHTML(d.key) + '</div>';
    }).join('') + '</div>';
  }

  function monCardHTML(m, withActs) {
    const d = D.MONSTERS[m.key];
    let flags = [];
    if (m.frozenNow) flags.push('❄️ eingefroren'); else if (m.rootNow) flags.push('🌱 gefesselt');
    if (withActs && myTurn()) { if (m.moves) flags.push('👣 gezogen'); if (m.attacked) flags.push('⚔️ hat angegriffen'); }
    let h = '<div class="vlcard' + (ui.mon === m.id ? ' pick' : '') + '"><div class="vlrow">' + pt(m.key, '', seatColor(m.seat)) +
      '<div style="flex:1;min-width:0"><div class="vlnm">' + esc(d.name) + ' <span style="color:#ffd36a;font-size:14px">' + stars(d.level) + '</span></div>' +
      '<div class="vlstats"><span>⚔️ ' + (m.atk + (m.atkBuff || 0)) + '</span><span>🛡️ ' + m.def + '</span></div>' +
      '<div class="vlrow" style="gap:6px">' + hpBar(m) + '</div>' + (d.abil.length ? '<div class="vlsub">' + d.abil.map((ab) => D.ABIL[ab].icon + ' ' + D.ABIL[ab].name).join(' · ') + '</div>' : '') +
      (flags.length ? '<div class="vlsub">' + flags.join(' · ') + '</div>' : '') + '</div></div>';
    if (withActs) {
      const busy = !!G.turn.pending;
      const canAb = R.abilitiesOf(m).some((ab) => !R.abilityBlock(G, m, ab));
      h += '<div class="vlacts">' +
        '<button class="vlbtn blue" data-act="move" data-mon="' + m.id + '"' + (R.canMove(G, m) && !busy ? '' : ' disabled') + '>👣 Bewegen</button>' +
        '<button class="vlbtn red" data-act="attack" data-mon="' + m.id + '"' + (R.canAttack(G, m) && !busy ? '' : ' disabled') + '>⚔️ Angreifen</button>' +
        '<button class="vlbtn" data-act="abilities" data-mon="' + m.id + '"' + (canAb && !busy ? '' : ' disabled') + '>✨ Fähigkeit</button>' +
        '<button class="vlbtn" data-info="' + m.id + '">ℹ️ Info</button></div>';
    }
    return h + '</div>';
  }

  function targetLabel(m, t) {
    if (t.dm !== undefined) return '👑 Meister von ' + esc(seatName(t.dm)) + ' · −1 Herz';
    const o = R.monById(G, t.mon), d = D.MONSTERS[o.key];
    const r = R.preview(G, m, o, 'none'), rd = R.preview(G, m, o, 'defend');
    return esc(d.name) + ' <span style="color:' + seatColor(o.seat) + '">(' + esc(o.seat < 0 ? 'wild' : seatName(o.seat)) + ')</span><br><span class="vlsub">LP ' + o.hp + ' · DEF ' + o.def + ' · Schaden ' + r.dmg + (rd.dmg !== r.dmg ? ' (mit Abwehr ' + rd.dmg + ')' : '') + (r.back ? ' · du nimmst ' + r.back : '') + '</span>';
  }

  function actHTML(foot) {
    const m = ui.mon && R.monById(G, ui.mon);
    boardOpts = {};
    // a mode that no longer fits (it moved, it attacked, crests ran out) falls back to the list
    if (m && ((ui.mode === 'move' && !R.canMove(G, m)) || (ui.mode === 'attack' && !R.canAttack(G, m)) || (ui.mode === 'ability' && R.abilityBlock(G, m, ui.ab)))) ui.mode = null;
    if (!m || m.seat !== me || !ui.mode) {
      if (!m || m.seat !== me) ui.mon = null;
      ui.mode = null;
      const list = mine();
      let h = list.length ? '' : '<div class="vlhint">Noch keine Monster im Verlies. Beende den Zug und würfle nächste Runde neu.</div>';
      h += list.map((x) => monCardHTML(x, true)).join('');
      if (list.length) h += boardHTML();
      foot.push(endBtn());
      return h;
    }
    let h = monCardHTML(m, false);
    if (ui.mode === 'move') {
      const reach = R.reach(G, m); boardOpts.reach = reach;
      h += '<div class="vlhint">Tippe ein Feld an. Die Zahl sagt, wie viele 👣 der Weg kostet.</div>' + boardHTML();
      const e = ui.dest !== null && reach.get(ui.dest);
      foot.push('<button class="vlbtn" data-back="1">↩ Zurück</button>');
      foot.push('<button class="vlbtn go" data-go="move"' + (e ? '' : ' disabled') + '>' + (e ? '✓ Hierhin (' + e.cost + ' 👣)' : 'Feld wählen') + '</button>');
    } else if (ui.mode === 'attack') {
      const ts = R.attackTargets(G, m);
      boardOpts.targets = ts.map((t) => (t.dm !== undefined ? G.seats[t.dm].dm : R.monById(G, t.mon).at));
      h += '<div class="vlhint">Wen greifst du an? Kostet 1 ⚔️.</div>';
      h += ts.map((t, k) => '<button class="vlbtn red" style="text-align:left" data-tgt="' + k + '">⚔️ ' + targetLabel(m, t) + '</button>').join('') + boardHTML();
      foot.push('<button class="vlbtn" data-back="1">↩ Zurück</button>');
    } else if (ui.mode === 'abilities') {
      h += R.abilitiesOf(m).map((ab) => {
        const A2 = D.ABIL[ab], why = R.abilityBlock(G, m, ab);
        return '<button class="vlbtn" style="text-align:left" data-ab="' + ab + '"' + (why ? ' disabled' : '') + '>' + A2.icon + ' ' + A2.name + ' · ' + costTxt(A2.cost) + '<br><span class="vlsub">' + esc(A2.text) + (why ? ' — ' + esc(why) : '') + '</span></button>';
      }).join('');
      foot.push('<button class="vlbtn" data-back="1">↩ Zurück</button>');
    } else if (ui.mode === 'ability') {
      const A2 = D.ABIL[ui.ab], ts = R.abilityTargets(G, m, ui.ab);
      h += '<div class="vlcard"><div class="vlnm">' + A2.icon + ' ' + A2.name + ' · ' + costTxt(A2.cost) + '</div><div class="vlsub">' + esc(A2.text) + '</div></div>';
      let ready = false;
      if (A2.target === 'self' || A2.target === 'none') ready = true;
      else if (A2.target === 'cell') { boardOpts.cells = ts.map((t) => t.cell); ready = ui.cell !== null && boardOpts.cells.indexOf(ui.cell) >= 0; h += '<div class="vlhint">Tippe auf ein grünes Feld neben dem Monster.</div>'; }
      else {
        boardOpts.targets = ts.map((t) => R.monById(G, t.mon).at);
        h += ts.map((t) => { const o = R.monById(G, t.mon); return '<button class="vlbtn' + (ui.cell === o.at ? ' sel' : '') + '" style="text-align:left" data-tcell="' + o.at + '">' + esc(D.MONSTERS[o.key].name) + ' <span style="color:' + seatColor(o.seat) + '">(' + esc(o.seat < 0 ? 'wild' : o.seat === me ? 'deins' : seatName(o.seat)) + ')</span> · LP ' + o.hp + '/' + o.maxHp + '</button>'; }).join('');
        ready = ui.cell !== null && boardOpts.targets.indexOf(ui.cell) >= 0;
      }
      h += boardHTML();
      foot.push('<button class="vlbtn" data-back="abilities">↩ Zurück</button>');
      foot.push('<button class="vlbtn go" data-go="ability"' + (ready ? '' : ' disabled') + '>' + A2.icon + ' Wirken</button>');
    }
    return h;
  }
  function endBtn() {
    const open = mine().some((m) => R.canMove(G, m) || R.canAttack(G, m));
    return '<button class="vlbtn ' + (ui.endAsk > Date.now() ? 'red' : 'go') + '" data-end="1"' + (G.turn.pending ? ' disabled' : '') + '>' + (ui.endAsk > Date.now() ? 'Wirklich? Noch Züge möglich' : '⏭ Zug beenden') + '</button>';
  }

  function rollHTML(foot) {
    const free = R.freeDice(G, me), need = Math.min(3, free.length);
    ui.pick = ui.pick.filter((k) => free.indexOf(k) >= 0).slice(0, need);
    const lv = ui.pick.map((k) => D.MONSTERS[G.seats[me].dice[k].key].level);
    const odds = summonOdds(lv);
    foot.push('<button class="vlbtn" data-clear="1"' + (ui.pick.length ? '' : ' disabled') + '>✕</button>');
    foot.push('<button class="vlbtn go" data-roll="1"' + (ui.pick.length === need ? '' : ' disabled') + ' style="flex:3">🎲 Werfen (' + ui.pick.length + '/' + need + ')</button>');
    const tip = ui.pick.length === need ? (odds > 0 ? '<b style="color:#ffd36a">⭐ Chance auf Beschwörung: ' + Math.round(odds * 100) + ' %</b>' : '<b>Ohne zwei gleiche Stufen keine Beschwörung – nur Wappen.</b>') : '';
    return '<div class="vlhint">Wähle ' + need + ' Würfel. Zeigen zwei die ⭐ derselben Stufe, darfst du eins der Monster rufen. ' + tip + '</div>' + diceHTML(true);
  }

  // chance that at least two of the dice show the summon star of the same level (level L has 5 − L of them)
  function summonOdds(levels) {
    let p = 0;
    for (let mask = 0; mask < (1 << levels.length); mask++) {
      let q = 1; const cnt = {};
      levels.forEach((L, i) => { const ps = (5 - L) / 6; if (mask & (1 << i)) { q *= ps; cnt[L] = (cnt[L] || 0) + 1; } else q *= 1 - ps; });
      if (Object.keys(cnt).some((L) => cnt[L] >= 2)) p += q;
    }
    return p;
  }

  function summonHTML(foot) {
    const r = G.turn.roll;
    let h = '<div class="vlbig">⭐ Beschwörung! Stufe ' + r.level + '</div><div class="vlhint">Such dir eins aus. Sein Würfel wird zum Verlies-Stück und ist danach verbraucht.</div>';
    h += r.opts.map((k) => { const key = G.seats[me].dice[k].key; return '<div class="vlcard">' + monInfoHTML(key) + '<button class="vlbtn go" data-pick="' + k + '">⭐ ' + esc(D.MONSTERS[key].name) + ' rufen</button></div>'; }).join('');
    foot.push('<button class="vlbtn" data-pick="none">Nicht beschwören</button>');
    return h;
  }

  function placeHTML(foot) {
    if (!ui.piece) { ui.piece = firstPlacement(); ui.vp = null; toScreen({ t: 'vlPiece', shape: ui.piece.shape, ori: ui.piece.ori, x: ui.piece.x, y: ui.piece.y }); }
    const P = ui.piece, cells = R.pieceCells(G, P.shape, P.ori, P.x, P.y), ok = R.canPlace(G, me, cells);
    boardOpts = { piece: { cells, ok: ok.ok }, anchors: R.validAnchors(G, me, P.shape, P.ori) };
    const key = G.seats[me].dice[G.turn.chosen].key;
    const why = { out: '⛔ Das Stück ragt über den Rand', taken: '⛔ Da liegt schon ein Weg', alone: '⛔ Muss an deinen Weg oder Meister grenzen' }[ok.why] || '';
    let h = '<div class="vlrow">' + pt(key, '', seatColor(me)) + '<div><div class="vlnm">' + esc(D.MONSTERS[key].name) + '</div><div class="vlsub">Tippe aufs Feld: dort erscheint es. Punkte = gültige Plätze für diese Form.</div></div></div>';
    h += boardHTML();
    h += '<div class="vlhint" style="color:' + (ok.ok ? '#9be36a' : '#ff9a9a') + ';font-weight:700">' + (ok.ok ? '✓ Passt!' : why) + '</div>';
    h += '<div class="vlrow"><button class="vlbtn" data-shape="-1" style="flex:1">◀</button><div style="flex:2;text-align:center;font-weight:800">Form ' + (P.shape + 1) + '/11<br><span class="vlsub">' + D.NETS[P.shape].name + '</span></div><button class="vlbtn" data-shape="1" style="flex:1">▶</button></div>';
    h += '<div class="vlpad"><button class="vlbtn" data-rot="rot">⟳</button><button class="vlbtn" data-mv="0,-1">⬆</button><button class="vlbtn" data-rot="flip">⇋</button>' +
      '<button class="vlbtn" data-mv="-1,0">⬅</button><button class="vlbtn" data-suggest="1">💡</button><button class="vlbtn" data-mv="1,0">➡</button>' +
      '<button class="vlbtn" data-unpick="1" style="font-size:15px">↩ Monster</button><button class="vlbtn" data-mv="0,1">⬇</button><span></span></div>';
    foot.push('<button class="vlbtn go" data-place="1"' + (ok.ok ? '' : ' disabled') + '>✓ Hier ausfalten</button>');
    return h;
  }

  function waitHTML() {
    let h = '<div class="vltabs"><button class="vlbtn' + (ui.tab === 'mons' ? ' sel' : '') + '" data-tab="mons">👾 Monster</button><button class="vlbtn' + (ui.tab === 'dice' ? ' sel' : '') + '" data-tab="dice">🎲 Würfel</button><button class="vlbtn' + (ui.tab === 'board' ? ' sel' : '') + '" data-tab="board">🗺️ Feld</button></div>';
    boardOpts = {};
    if (ui.tab === 'dice' && me >= 0) h += diceHTML(false);
    else if (ui.tab === 'board' || me < 0) h += boardHTML();
    else { const l = mine(); h += l.length ? l.map((m) => monCardHTML(m, false)).join('') : '<div class="vlhint">Noch keine Monster im Verlies.</div>'; }
    return h;
  }

  function overHTML(foot) {
    const w = G.over.winners, won = w.indexOf(me) >= 0;
    let h = '<div class="vlbig" style="font-size:34px;margin-top:20px">' + (won ? '🏆 Gewonnen!' : w.length ? '👑 ' + w.map((s) => esc(seatName(s))).join(' & ') + ' gewinnt' : 'Unentschieden') + '</div>';
    h += '<div class="vlhint">' + ({ last: 'Der letzte Meister im Verlies.', first: 'Wer zuerst einen Meister stürzt, gewinnt.', team: 'Das Team hält das Verlies.', limit: 'Rundenlimit: die meisten Herzen zählen.' }[G.over.why] || '') + '</div>';
    h += S.seats.map((s, i) => '<div class="vlcard"><div class="vlrow"><span style="width:16px;height:16px;border-radius:50%;background:' + s.color + '"></span><b style="flex:1">' + esc(s.name) + '</b>' + (w.indexOf(i) >= 0 ? '🏆' : '') + ' ' + '❤️'.repeat(G.seats[i].hearts) + '</div><div class="vlsub">' + G.seats[i].dice.filter((d) => d.used).length + ' Würfel gerufen · ' + G.mons.filter((m) => m.seat === i).length + ' Monster übrig</div></div>').join('');
    if (S.host) foot.push('<button class="vlbtn go" data-again="1">🔁 Nochmal (Beutel neu wählen)</button>');
    else h += '<div class="vlhint">Der Host kann eine neue Partie starten.</div>';
    return h;
  }

  // ---------- render ----------
  function render(force) {
    if (!S) return;
    renderHead();
    const foot = [];
    let h;
    if (S.phase === 'prep') h = prepHTML();
    else if (!G) h = '';
    else if (G.over) h = overHTML(foot);
    else if (me < 0 || !G.seats[me].alive) h = '<div class="vlhint">' + (me < 0 ? '👀 Du schaust zu.' : '💀 Dein Meister ist gefallen. Du kannst weiter zuschauen.') + '</div>' + (boardOpts = {}, boardHTML());
    else if (!myTurn()) h = waitHTML();
    else if (G.turn.stage === 'roll') h = rollHTML(foot);
    else if (G.turn.stage === 'summon') h = summonHTML(foot);
    else if (G.turn.stage === 'place') h = placeHTML(foot);
    else h = actHTML(foot);
    const key = h + '|' + foot.join('');
    if (force || key !== lastMain) {
      const main = $('vlMain'), top = main.scrollTop;
      main.innerHTML = h; $('vlFoot').innerHTML = foot.join('');
      paintPortraits(main);
      main.scrollTop = top;
      lastMain = key;
    }
    drawBoard();
    renderModal();
  }

  // the defence prompt and the info card
  function renderModal() {
    const box = $('vlModalBox'), modal = $('vlModal');
    const p = G && !G.over ? G.turn.pending : null;
    if (p && p.seat === me) {
      const k = p.att + ':' + p.tgt + ':' + G.turn.n;
      if (k !== lastPend) {
        lastPend = k; vib([60, 40, 60]);
        const a = R.monById(G, p.att), t = R.monById(G, p.tgt);
        if (!a || !t) return;
        const LBL = { none: '😬 Einstecken', defend: '🛡️ Abwehren (1 🛡️)' };
        let h = '<div class="vlbig" style="color:#ff8a6a">⚠️ Angriff!</div><div class="vlrow" style="justify-content:center;gap:14px">' + pt(a.key, '', seatColor(a.seat)) + '<span style="font-size:30px">⚔️</span>' + pt(t.key, '', seatColor(me)) + '</div>';
        h += '<div class="vlhint"><b>' + esc(D.MONSTERS[a.key].name) + '</b> (' + esc(seatName(a.seat)) + ', ATK ' + p.atk + ') greift deinen <b>' + esc(D.MONSTERS[t.key].name) + '</b> an (LP ' + t.hp + ', DEF ' + t.def + ').</div>';
        for (const o of p.opts) {
          const r = R.preview(G, a, t, o, p.atk), A2 = D.ABIL[o];
          const label = LBL[o] || (A2.icon + ' ' + A2.name + ' (' + costTxt(A2.cost) + ')');
          const res = r.missed ? 'kein Schaden' : (r.dmg ? '−' + r.dmg + ' LP' + (r.dmg >= t.hp ? ' 💀' : '') : 'kein Schaden') + (r.back ? ' · Angreifer −' + r.back : '');
          h += '<button class="vlbtn ' + (o === 'none' ? '' : 'go') + '" data-def="' + o + '">' + label + '<br><span style="font-size:14px;font-weight:600">' + res + '</span></button>';
        }
        h += '<div class="vlhint" id="vlDefClock"></div>';
        box.innerHTML = h; paintPortraits(box); box.style.borderColor = '#ff6a4a'; box.dataset.k = 'def';
      }
      const c = $('vlDefClock'); if (c) c.textContent = S.defSecs ? '⏱ ' + S.defSecs + ' s – danach entscheidet der Autopilot' : '';
      modal.classList.add('on');
      return;
    }
    lastPend = '';
    if (ui.info) {
      const k = 'info:' + ui.info.key + ':' + (ui.info.mon ? ui.info.mon.id + ':' + ui.info.mon.hp : '');
      if (box.dataset.k !== k) {
        box.innerHTML = monInfoHTML(ui.info.key, ui.info.mon) + '<button class="vlbtn go" data-close="1">Schließen</button>';
        box.style.borderColor = '#8a7aa8'; paintPortraits(box); box.dataset.k = k;
      }
      modal.classList.add('on');
      return;
    }
    box.dataset.k = '';
    modal.classList.remove('on');
  }

  // the dice tumble on the phone that rolled
  function showRoll(r) {
    const box = $('vlCubes'), FACES = ['rotateY(0deg)', 'rotateY(180deg)', 'rotateY(90deg)', 'rotateY(-90deg)', 'rotateX(90deg)', 'rotateX(-90deg)'];
    box.innerHTML = r.dice.map((d, k) => {
      const faces = D.facesOf(d.key), order = [d.face].concat([0, 1, 2, 3, 4, 5].filter((i) => i !== d.face));
      const lit = d.c === 'SUM' && r.level && D.MONSTERS[d.key].level === r.level;
      return '<div class="vlcube' + (lit ? ' lit' : '') + '" id="vlCube' + k + '" style="transform:rotateX(' + (700 + k * 200) + 'deg) rotateY(' + (520 + k * 150) + 'deg) translateY(-120px);transition:transform ' + (1.1 + k * 0.25) + 's cubic-bezier(.2,.8,.25,1.08)">' +
        order.map((fi, j) => { const f = faces[fi]; return '<div style="transform:' + FACES[j] + ' translateZ(38px)">' + crest(f.c, 44) + (f.c === 'SUM' ? '<i>' + D.MONSTERS[d.key].level + '</i>' : f.n > 1 ? '<i>×' + f.n + '</i>' : '') + '</div>'; }).join('') + '</div>';
    }).join('');
    $('vlRollText').innerHTML = '';
    $('vlRoll').classList.add('on');
    vib(30);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      r.dice.forEach((d, k) => { const c = $('vlCube' + k); if (c) c.style.transform = 'rotateX(-14deg) rotateY(' + (k - 1) * 12 + 'deg)'; });
    }));
    clearTimeout(rollTimer);
    rollTimer = setTimeout(() => {
      const got = D.POOL.filter((c) => r.got[c]).map((c) => '<span style="white-space:nowrap">' + crest(c, 24) + ' +' + r.got[c] + '</span>').join(' &nbsp; ');
      $('vlRollText').innerHTML = (got || 'Keine Wappen') + '<br>' + (r.opts.length ? '<span style="color:#ffd36a">⭐ Beschwörung möglich – Stufe ' + r.level + '!</span>' : r.noRoom ? 'Beschwörung – aber kein Platz im Verlies' : '<span style="opacity:.7">Keine Beschwörung</span>') +
        (D.POOL.some((c) => r.lost[c]) ? '<br><span class="vlsub">Lager voll – ein Teil verfällt</span>' : '');
      if (r.opts.length) vib([40, 40, 80]);
    }, 1500);
  }
  $('vlRollOk').addEventListener('click', () => { $('vlRoll').classList.remove('on'); clearTimeout(rollTimer); });

  function toastMsg(text, kind) {
    const t = $('vlToast'); t.textContent = text; t.className = kind === 'info' ? 'info' : ''; t.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, kind === 'info' ? 3200 : 2600);
  }

  // ---------- taps ----------
  $('v-verlies').addEventListener('click', onTap);
  $('vlModal').addEventListener('click', onTap);
  function onTap(e) {
    const b = e.target.closest ? e.target.closest('button, [data-die]') : null;
    if (!b || b.disabled || !S) return;
    const ds = b.dataset;
    vib(12);
    if (ds.bag) { toScreen({ t: 'vlBag', bag: ds.bag }); return; }
    if (ds.again) { toScreen({ t: 'vlAgain' }); return; }
    if (ds.tab) { ui.tab = ds.tab; ui.vp = null; render(true); return; }
    if (ds.close) { ui.info = null; render(true); return; }
    if (ds.def) { $('vlModal').classList.remove('on'); toScreen({ t: 'vlDefend', choice: ds.def }); return; }
    if (b.id === 'vlZoom') { ui.zoom = !ui.zoom; ui.vp = null; render(true); return; }
    if (!G) return;
    if (ds.die) {
      const k = +ds.die, i = ui.pick.indexOf(k), need = Math.min(3, R.freeDice(G, me).length);
      if (i >= 0) ui.pick.splice(i, 1); else { if (ui.pick.length >= need) ui.pick.shift(); ui.pick.push(k); }
      render(true); return;
    }
    if (ds.clear) { ui.pick = []; render(true); return; }
    if (ds.roll) { toScreen({ t: 'vlRoll', dice: ui.pick.slice() }); ui.pick = []; return; }
    if (ds.pick) { ui.piece = null; toScreen({ t: 'vlPick', die: ds.pick === 'none' ? null : +ds.pick }); return; }
    if (ds.unpick) { ui.piece = null; toScreen({ t: 'vlBack' }); return; }
    if (ds.shape) { const P = ui.piece; P.shape = (P.shape + (+ds.shape) + D.ORIENT.length) % D.ORIENT.length; P.ori = 0; pieceChanged(); return; }
    if (ds.rot) { turnPiece(ds.rot); return; }
    if (ds.mv) { const [dx, dy] = ds.mv.split(',').map(Number); ui.piece.x += dx; ui.piece.y += dy; pieceChanged(); return; }
    if (ds.suggest) { suggest(); return; }
    if (ds.place) { const P = ui.piece; toScreen({ t: 'vlPlace', shape: P.shape, ori: P.ori, x: P.x, y: P.y }); return; }
    if (ds.act) { selectMon(+ds.mon, ds.act); return; }
    if (ds.info) { const m = R.monById(G, +ds.info); if (m) { ui.info = { key: m.key, mon: m }; render(true); } return; }
    if (ds.back) { if (ds.back === 'list') backToList(); else if (ds.back === 'abilities') selectMon(ui.mon, 'abilities'); else selectMon(ui.mon, null); return; }
    if (ds.go === 'move') { const to = ui.dest; selectMon(ui.mon, null); toScreen({ t: 'vlMove', mon: ui.mon, to }); return; }
    if (ds.tgt !== undefined) {
      const m = R.monById(G, ui.mon), t = m && R.attackTargets(G, m)[+ds.tgt];
      if (t) { const id = ui.mon; selectMon(id, null); toScreen({ t: 'vlAttack', mon: id, target: t }); }
      return;
    }
    if (ds.ab) { selectMon(ui.mon, 'ability', ds.ab); return; }
    if (ds.tcell !== undefined) { ui.cell = +ds.tcell; render(true); return; }
    if (ds.go === 'ability') {
      const A2 = D.ABIL[ui.ab], id = ui.mon, ab = ui.ab;
      let target = {};
      if (A2.target === 'cell') target = { cell: ui.cell };
      else if (A2.target !== 'self' && A2.target !== 'none') { const o = G.mons.find((x) => x.at === ui.cell); target = { mon: o ? o.id : 0 }; }
      selectMon(id, null); toScreen({ t: 'vlAbility', mon: id, ab, target });
      return;
    }
    if (ds.end) {
      const open = mine().some((m) => R.canMove(G, m) || R.canAttack(G, m));
      if (open && ui.endAsk < Date.now()) { ui.endAsk = Date.now() + 2500; render(true); setTimeout(() => render(true), 2600); return; }
      ui.endAsk = 0; backToListQuiet(); toScreen({ t: 'vlEnd' }); return;
    }
  }
  function backToListQuiet() { ui.mon = null; ui.mode = null; ui.ab = null; ui.dest = null; ui.cell = null; ui.zoom = false; ui.vp = null; }

  registerGame({ key: 'verlies', controller: {
    activate() {
      S = null; G = null; me = -1; lastMain = ''; lastRollN = 0; lastPend = ''; resetUi(); boardOpts = {};
      $('vlMain').innerHTML = '<div class="vlhint" style="margin-top:30px">🎲 Gleich geht\'s los …</div>'; $('vlFoot').innerHTML = '';
      $('vlModal').classList.remove('on'); $('vlRoll').classList.remove('on');
      showView('verlies');
      toScreen({ t: 'vlHello' });
    },
    onMessage(d) {
      if (d.t === 'vlToast') { toastMsg(d.text, d.kind); vib(d.kind === 'info' ? 25 : [30, 30, 30]); return; }
      if (d.t === 'vlBuzz') { vib([80, 60, 80]); return; }
      if (d.t !== 'vlState') return;
      const prevTurn = G ? G.turn.n : 0, prevStage = G ? G.turn.stage : '';
      S = d; me = d.me;
      if (typeof myHost !== 'undefined' && myHost !== d.host) { myHost = d.host; updateAbort(); }
      G = d.g ? rebuild(d.g) : null;
      if (G) {
        if (G.turn.n !== prevTurn) { resetUi(); }
        if (G.turn.stage !== 'place') ui.piece = null;
        if (G.turn.stage !== prevStage && G.turn.stage === 'act') { ui.mon = null; ui.mode = null; }
        // my roll: tumble the dice once
        const r = G.turn.roll;
        if (r && G.turn.seat === me && lastRollN !== G.turn.n) { lastRollN = G.turn.n; showRoll(r); }
        if (ui.mon && !R.monById(G, ui.mon)) backToListQuiet();
      } else if (d.phase === 'prep') resetUi();
      render();
    }
  } });
})();
