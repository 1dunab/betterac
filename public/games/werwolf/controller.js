// ============ Controller-Modul: WERWOLFNACHT ============
// Phone UI: private role card (hold to reveal), secret night tasks, ghost view.
// One view, re-rendered idempotently from local state `S` (see docs/WERWOLF.md, "Phone protocol").
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #v-werwolf { background:#090b14; color:#c8cde4; position:relative; -webkit-touch-callout:none; }
  #v-werwolf .wwbar { padding:12px 14px 6px; padding-right:96px; display:flex; align-items:center; justify-content:flex-start; gap:14px; }
  #v-werwolf .wwtitle { font-size:20px; font-weight:800; color:#aab4e8; }
  #v-werwolf .wwtimer { font-size:20px; font-weight:800; color:#8f9ad0; font-variant-numeric:tabular-nums; }
  #wwBody { flex:1; min-height:0; overflow-y:auto; touch-action:pan-y; padding:4px 14px 18px; display:flex; flex-direction:column; gap:12px; box-sizing:border-box; }
  #v-werwolf .wwq { font-size:21px; font-weight:800; color:#e4e7f7; text-align:center; padding:6px 4px 0; line-height:1.25; }
  #v-werwolf .wwsub { font-size:14px; color:#8089ad; text-align:center; line-height:1.35; }
  #v-werwolf .wwlist { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  #v-werwolf .wwp { position:relative; display:flex; align-items:center; gap:9px; min-height:60px; padding:8px 11px; border-radius:14px;
        border:2px solid #20253f; background:#151930; color:#dfe3f7; font-size:17px; font-weight:700; text-align:left; font-family:inherit;
        touch-action:manipulation; overflow:hidden; }
  #v-werwolf .wwp:active { filter:brightness(1.3); }
  #v-werwolf .wwp .dot { flex:none; width:20px; height:20px; border-radius:50%; box-shadow:0 0 0 2px rgba(0,0,0,.35); }
  #v-werwolf .wwp .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #v-werwolf .wwp.sel { border-color:#8fa0ff; background:#262d58; color:#fff; }
  #v-werwolf .wwp.dim { opacity:.45; }
  #v-werwolf .wwp.poison { border-color:#d86bff; background:#3a1f4d; }
  #v-werwolf .wwp.wide { grid-column:1 / -1; justify-content:center; }
  #v-werwolf .wwp .badge { position:absolute; right:6px; top:4px; font-size:11px; font-weight:800; color:#ffb4b4; background:#4a1a22; border-radius:8px; padding:1px 6px; max-width:70%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #v-werwolf .wwstatus { text-align:center; font-size:15px; font-weight:700; color:#8fa0ff; min-height:22px; }
  #v-werwolf .wwfoot { min-height:56px; display:flex; flex-direction:column; gap:10px; }
  #v-werwolf .wwbtn { border:none; border-radius:14px; padding:14px 16px; font-size:18px; font-weight:800; background:#2a3060; color:#e8ebff; font-family:inherit; touch-action:manipulation; }
  #v-werwolf .wwbtn:active { filter:brightness(1.25); }
  #v-werwolf .wwbtn.go { background:#2f7d57; color:#eafff3; }
  #v-werwolf .wwbtn.off { background:#1a1e34; color:#7c85a8; }
  #v-werwolf .wwbtn.warn { background:#6a2a3a; }
  #v-werwolf .wwbtn.on { background:#2f7d57; }
  #v-werwolf .wwbtn.pois.on { background:#7b2fa0; }
  #v-werwolf .wwbtn[disabled] { opacity:.6; }
  #v-werwolf .wwrow { display:flex; gap:10px; } #v-werwolf .wwrow .wwbtn { flex:1; }
  #v-werwolf .wwhold { border-radius:16px; background:#171b34; border:2px dashed #2f3763; color:#8f9ad0; display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:6px; padding:14px; text-align:center; font-weight:800; font-size:17px; min-height:58px; touch-action:none; }
  #v-werwolf .wwhold.big { min-height:270px; }
  #v-werwolf .wwhold .rv { display:none; flex-direction:column; align-items:center; gap:8px; width:100%; }
  #v-werwolf .wwhold.open { border-style:solid; border-color:#8fa0ff; background:#1d2346; color:#fff; }
  #v-werwolf .wwhold.open .ph { display:none; }
  #v-werwolf .wwhold.open .rv { display:flex; }
  #v-werwolf .wwhold .emb { font-size:64px; line-height:1; }
  #v-werwolf .wwhold .rn { font-size:28px; font-weight:900; color:#fff; }
  #v-werwolf .wwhold .rd { font-size:15px; font-weight:600; color:#c8cde4; line-height:1.35; }
  #v-werwolf .wwhold .rt { font-size:13px; font-weight:800; color:#8fa0ff; }
  #v-werwolf .wwhold .pk { font-size:15px; font-weight:700; color:#ffb4b4; }
  #v-werwolf .wwcenter { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; text-align:center; }
  #v-werwolf .wwhuge { font-size:34px; font-weight:900; color:#fff; line-height:1.15; }
  #v-werwolf .wwbig { font-size:26px; font-weight:800; color:#e4e7f7; }
  #v-werwolf .wwcd { font-size:56px; font-weight:900; color:#aab4e8; font-variant-numeric:tabular-nums; }
  #v-werwolf .wwcause { background:#2a1218; border:2px solid #6a2a3a; border-radius:14px; padding:12px; text-align:center; color:#ffc4c4; font-weight:800; font-size:17px; }
  #v-werwolf .wwquiet { background:#1d2346; border-radius:14px; padding:14px; text-align:center; font-size:22px; font-weight:900; color:#fff; }
  #v-werwolf .wwros { display:flex; flex-direction:column; gap:6px; }
  #v-werwolf .wwros .r { display:flex; align-items:center; gap:9px; padding:7px 10px; border-radius:11px; background:#131730; font-size:16px; font-weight:700; }
  #v-werwolf .wwros .r.dead { opacity:.55; }
  #v-werwolf .wwros .r.dead .nm { text-decoration:line-through; }
  #v-werwolf .wwros .r.win { box-shadow:inset 0 0 0 2px #ffd60a; }
  #v-werwolf .wwros .dot { flex:none; width:16px; height:16px; border-radius:50%; }
  #v-werwolf .wwros .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #v-werwolf .wwros .ro { flex:none; color:#aab4e8; font-size:14px; }
  #v-werwolf .wwlines { background:#101328; border-radius:12px; padding:10px 12px; font-size:15px; line-height:1.5; color:#b7bfe0; }
  #v-werwolf .wwh { font-size:13px; font-weight:800; letter-spacing:.04em; color:#6e78a0; text-transform:uppercase; }
</style>
<div id="v-werwolf" class="view">
  <div class="wwbar"><span class="wwtitle" id="wwTitle">🐺 Werwolfnacht</span><span class="wwtimer" id="wwTimer"></span></div>
  <div id="wwBody"></div>
</div>`);
  VIEWS.push('werwolf');

  const SCREEN = () => AirConsole.SCREEN;
  const send = (d) => ac.message(SCREEN(), d);
  const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms || 15); } catch (e) {} };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ROLES = {
    wolf: { icon: '🐺', name: 'Werwolf', team: 'Team Werwölfe', desc: 'Jede Nacht wählt das Rudel gemeinsam ein Opfer. Tagsüber: unauffällig bleiben!' },
    villager: { icon: '🧑‍🌾', name: 'Dorfbewohner', team: 'Team Dorf', desc: 'Du hast keine Spezialfähigkeit — aber eine Stimme. Finde die Werwölfe!' },
    seer: { icon: '🔮', name: 'Seherin', team: 'Team Dorf', desc: 'Jede Nacht darfst du die Rolle eines Spielers ansehen. Dein erster Blick ist endgültig.' },
    guard: { icon: '🛡️', name: 'Beschützer', team: 'Team Dorf', desc: 'Jede Nacht schützt du jemanden vor den Wölfen — nie zweimal hintereinander denselben.' },
    cupid: { icon: '💘', name: 'Amor', team: 'Team Dorf', desc: 'In der ersten Nacht verkuppelst du zwei Spieler. Stirbt einer, stirbt auch der andere.' },
    witch: { icon: '🧪', name: 'Hexe', team: 'Team Dorf', desc: 'Ein Heiltrank rettet das Wolfsopfer, ein Gifttrank tötet jemanden. Jeder nur einmal.' },
    hunter: { icon: '🏹', name: 'Jäger', team: 'Team Dorf', desc: 'Wenn du stirbst, nimmst du mit einem letzten Schuss jemanden mit.' }
  };
  const roleOf = (k) => ROLES[k] || { icon: '❔', name: String(k || '?'), team: '', desc: '' };
  const CAUSES = {
    wolves: 'Die Werwölfe haben dich geholt.', poison: 'Die Hexe hat dich vergiftet.',
    grief: 'Du bist an gebrochenem Herzen gestorben.', hunter: 'Der Jäger hat dich erschossen.',
    vote: 'Das Dorf hat dich verurteilt.'
  };
  const WINS = {
    village: '🏆 Das Dorf gewinnt!', wolves: '🐺 Die Werwölfe gewinnen!',
    lovers: '💘 Das Liebespaar gewinnt!', nobody: '☠️ Niemand überlebt'
  };

  // ---------- local state ----------
  let S, T, holding = null, tickInt = null;
  function reset() {
    S = {
      role: null, pack: [], host: false, ready: false, phase: null, night: 0, day: 0, key: '', alive: true, endAt: 0,
      task: null, packPicks: {}, seen: null, lover: null, dead: null, ghost: null, shoot: null, shootSent: false,
      ballot: null, vote: undefined, talkReady: false, end: null
    };
    T = null;
    holding = null;
  }
  reset();

  const body = $('wwBody');

  // ---------- task model ----------
  function newT(task) {
    return { task, sel: [], heal: false, poison: null, saved: false, locked: !!task.locked, sentCupid: false };
  }
  const nameOfOpt = (task, id) => { const o = (task.options || []).find((p) => String(p.id) === String(id)); return o ? o.name : '?'; };

  // ---------- rendering helpers ----------
  function playerBtn(p, cls, attrs, badge) {
    return '<button class="wwp ' + (cls || '') + '" ' + (attrs || '') + '><span class="dot" style="background:' + esc(p.color || '#888') + '"></span>' +
      '<span class="nm">' + esc(p.name) + '</span>' + (badge || '') + '</button>';
  }
  function holdCard(key, label, inner, big) {
    return '<div class="wwhold' + (big ? ' big' : '') + (holding === key ? ' open' : '') + '" data-hold="' + key + '">' +
      '<span class="ph">' + label + '</span><div class="rv">' + inner + '</div></div>';
  }
  function roleInner() {
    const r = roleOf(S.role);
    let h = '<span class="emb">' + r.icon + '</span><span class="rn">' + esc(r.name) + '</span><span class="rd">' + esc(r.desc) + '</span><span class="rt">' + esc(r.team) + '</span>';
    if (S.role === 'wolf' && S.pack.length) h += '<span class="pk">Dein Rudel: ' + S.pack.map((p) => esc(p.name)).join(', ') + '</span>';
    return h;
  }
  function roleHold(big) {
    return holdCard('role', big ? '👆<br>Gedrückt halten,<br>um deine Rolle zu sehen<br><span style="font-size:13px;font-weight:600">Niemandem zeigen! 🤫</span>' : '🎴 Meine Rolle — halten', roleInner(), big);
  }
  function loverHold() {
    if (!S.lover) return '';
    return holdCard('lover', '💘 Dein Liebespaar — halten',
      '<span class="emb" style="font-size:44px">💘</span><span class="rn" style="font-size:22px">Du bist verliebt in ' + esc(S.lover.name) + '.</span>' +
      '<span class="rd">Stirbt einer von euch, stirbt auch der andere.</span>');
  }
  function bar(title) { $('wwTitle').textContent = title; }
  function rosterHtml(list, winners) {
    return '<div class="wwros">' + (list || []).map((p) => {
      const r = roleOf(p.role);
      return '<div class="r' + (p.alive === false ? ' dead' : '') + (p.won || (winners && winners[p.id]) ? ' win' : '') + '"><span class="dot" style="background:' + esc(p.color || '#888') + '"></span>' +
        '<span class="nm">' + esc(p.name) + '</span><span class="ro">' + r.icon + ' ' + esc(r.name) + (p.alive === false ? ' 💀' : '') + '</span></div>';
    }).join('') + '</div>';
  }
  const hostBtns = {
    skip: () => S.host && S.phase === 'day' ? '<button class="wwbtn warn" data-a="skip">⏭️ Abstimmung jetzt starten</button>' : ''
  };

  // ---------- screens ----------
  function screenRoles() {
    bar('🎴 Deine Rolle');
    return roleHold(true) +
      (S.ready ? '<div class="wwsub" style="font-size:16px">Warte auf die anderen…</div>'
        : '<button class="wwbtn go" data-a="ready">✅ Bereit</button>');
  }

  function screenNight() {
    bar('🌙 Nacht ' + (S.night || ''));
    let h = '';
    if (S.seen) {
      const r = roleOf(S.seen.role);
      h += holdCard('seen', '🔮 Ergebnis — halten', '<span class="rd" style="font-size:18px;color:#fff">🔮 <b>' + esc(S.seen.target.name) + '</b> ist …</span><span class="emb" style="font-size:44px">' + r.icon + '</span><span class="rn" style="font-size:24px">' + (S.seen.role === 'witch' ? 'die Hexe' : esc(r.name)) + '</span>');
    }
    if (!T) return h + '<div class="wwcenter"><div class="wwq">Die Nacht ist still …</div><div class="wwsub">Warte, bis es dämmert.</div></div>';
    const t = T.task, kind = t.kind, opts = t.options || [];
    const questions = {
      wolf: 'Wen holt das Rudel heute?', seer: 'Wessen Rolle willst du sehen?', guard: 'Wen beschützt du heute Nacht?',
      cupid: 'Wer soll sich verlieben? (2 wählen)', suspect: 'Wem misstraust du am meisten?', trust: 'Wem vertraust du am meisten?'
    };
    let q = questions[kind] || 'Wähle jemanden.';
    if (kind === 'witch') {
      const v = t.victim, vn = v == null ? null : (typeof v === 'object' ? v.name : (nameOfOpt(t, v) !== '?' ? nameOfOpt(t, v) : 'dich'));
      q = '🧪 ' + (vn ? 'Die Wölfe haben ' + esc(vn) + ' gewählt' : 'Die Wölfe haben niemanden gewählt');
    }
    h += '<div class="wwq">' + q + '</div>';
    if (kind === 'witch') {
      h += '<div class="wwrow">' +
        (t.canHeal ? '<button class="wwbtn' + (T.heal ? ' on' : ' off') + '" data-a="heal">💚 Heilen</button>' : '') +
        (t.canPoison ? '<button class="wwbtn pois' + (T.poison != null ? ' on' : ' off') + '" data-a="poisonclr">☠️ Vergiften' + (T.poison != null ? ': ' + esc(nameOfOpt(t, T.poison)) : '') + '</button>' : '') +
        '</div>';
    }
    // pack badges (wolves)
    const badges = {};
    if (kind === 'wolf') {
      S.pack.forEach((w) => { const tg = S.packPicks[w.id]; if (tg != null) (badges[tg] = badges[tg] || []).push(w.name); });
    }
    const pickKind = kind === 'witch' ? 'poison' : 'pick';
    h += '<div class="wwlist">' + opts.map((p) => {
      let sel = false;
      if (kind === 'witch') sel = T.poison != null && String(T.poison) === String(p.id);
      else sel = T.sel.some((x) => String(x) === String(p.id));
      const dim = T.locked && !sel || (kind === 'witch' && !t.canPoison);
      const b = badges[p.id] ? '<span class="badge">🐺 ' + badges[p.id].map(esc).join(', ') + '</span>' : '';
      return playerBtn(p, (sel ? (kind === 'witch' ? 'poison' : 'sel') : '') + (dim ? ' dim' : ''), 'data-a="' + pickKind + '" data-id="' + esc(p.id) + '"', b);
    }).join('') + '</div>';
    // status line (same slot for every kind)
    let st = '';
    if (kind === 'cupid') st = T.sentCupid ? '✓ Gespeichert' : (T.sel.length === 2 ? 'Bereit zum Verkuppeln' : 'Noch ' + (2 - T.sel.length) + ' wählen');
    else if (kind === 'witch') st = T.saved ? '✓ Gespeichert' : '';
    else st = T.sel.length ? '✓ Gewählt: ' + esc(nameOfOpt(t, T.sel[0])) : 'Tippe auf einen Namen';
    h += '<div class="wwstatus">' + st + '</div>';
    let foot = '';
    if (kind === 'cupid' && !T.sentCupid) foot = '<button class="wwbtn' + (T.sel.length === 2 ? ' go' : ' off') + '" data-a="cupid">💘 Verkuppeln</button>';
    else if (kind === 'witch') foot = '<button class="wwbtn' + (T.saved ? ' off' : ' go') + '" data-a="witchdone">✓ Fertig</button>';
    return h + '<div class="wwfoot">' + foot + '</div>';
  }

  function screenWait(title, big, sub) {
    bar(title);
    return '<div class="wwcenter"><div class="wwhuge">' + big + '</div>' + (sub ? '<div class="wwsub">' + sub + '</div>' : '') + '</div>' + loverHold() + (S.role ? roleHold(false) : '');
  }

  function screenDay() {
    bar('☀️ Tag ' + (S.day || ''));
    return '<div class="wwq">☀️ Tag ' + (S.day || '') + ' — diskutiert!</div>' +
      '<div class="wwcenter"><div class="wwcd" id="wwCd"></div></div>' +
      (S.talkReady ? '<button class="wwbtn on" disabled>✅ Bereit — warte auf die anderen</button>' : '<button class="wwbtn go" data-a="talkready">✋ Bereit zur Abstimmung</button>') +
      hostBtns.skip() + loverHold() + roleHold(false);
  }

  function screenBallot() {
    const b = S.ballot, runoff = b.runoff;
    bar(runoff ? '⚖️ Stichwahl' : '🗳️ Abstimmung');
    return '<div class="wwq">' + (runoff ? '⚖️ Stichwahl — wer soll gehen?' : '🗳️ Wer soll gehen?') + '</div>' +
      '<div class="wwlist">' + (b.options || []).map((p) => playerBtn(p, S.vote != null && String(S.vote) === String(p.id) ? 'sel' : '', 'data-a="vote" data-id="' + esc(p.id) + '"')).join('') +
      '<button class="wwp wide' + (S.vote === null ? ' sel' : '') + '" data-a="vote" data-id="">🤷 Niemand</button></div>' +
      '<div class="wwstatus">' + (S.vote === undefined ? 'Tippe auf einen Namen' : S.vote === null ? '✓ Gewählt: Niemand' : '✓ Gewählt: ' + esc(nameOfOpt(b, S.vote))) + '</div>';
  }

  function screenShoot() {
    bar('🏹 Letzter Schuss');
    const s = S.shoot;
    return '<div class="wwq">🏹 Du stirbst — wen nimmst du mit?</div>' +
      '<div class="wwlist">' + (s.options || []).map((p) => playerBtn(p, S.shootSent === String(p.id) ? 'sel' : '', 'data-a="shoot" data-id="' + esc(p.id) + '"' + (S.shootSent ? '' : ''))).join('') + '</div>' +
      '<div class="wwstatus">' + (S.shootSent ? '✓ Schuss abgegeben' : '') + '</div>';
  }

  function screenGhost() {
    bar('👻 Geist');
    const g = S.ghost || { roster: [], night: [] };
    let h = '<div class="wwcause"><div style="font-size:22px">💀 Du bist tot</div>' + (S.dead && CAUSES[S.dead] ? '<div style="font-weight:600;margin-top:4px">' + esc(CAUSES[S.dead]) + '</div>' : '') + '</div>' +
      '<div class="wwquiet">👻 Psst — Geister reden nicht!</div>';
    if (S.phase === 'day') h += '<div class="wwcd" id="wwCd" style="text-align:center;font-size:40px"></div>' + hostBtns.skip();
    if (g.night && g.night.length) h += '<div class="wwh">Diese Nacht</div><div class="wwlines">' + g.night.map((l) => '<div>' + esc(l) + '</div>').join('') + '</div>';
    h += '<div class="wwh">Alle Rollen</div>' + rosterHtml(g.roster);
    return h;
  }

  function screenEnd() {
    bar('🏁 Spielende');
    const e = S.end;
    return '<div class="wwcenter" style="flex:none;padding:10px 0"><div class="wwhuge">' + (WINS[e.winner] || '🏁 Spiel vorbei') + '</div>' +
      '<div class="wwbig">' + (e.won ? 'Du hast gewonnen 🎉' : 'Du hast verloren 😢') + '</div></div>' +
      rosterHtml(e.roster) +
      (S.host ? '<button class="wwbtn go" data-a="again" style="margin-top:6px">🔁 Neues Spiel</button>' : '<div class="wwsub">Warte auf den Host …</div>');
  }

  function render() {
    let h;
    const ph = S.phase;
    if (S.end) h = screenEnd();
    else if (S.shoot && ph === 'hunter') h = screenShoot();
    else if (!S.alive) h = screenGhost();
    else if (!S.role && !ph) { bar('🐺 Werwolfnacht'); h = '<div class="wwcenter"><div class="wwbig">Gleich geht es los …</div><div class="wwsub">Halte dein Handy bereit.</div></div>'; }
    else if (ph === 'roles' || !ph) h = screenRoles();
    else if (ph === 'night') h = screenNight();
    else if (ph === 'dawn') h = screenWait('🌅 Morgen', '🌅 Der Morgen graut …', 'Schaut auf den Bildschirm.');
    else if (ph === 'hunter') h = screenWait('🏹 Jäger', '🏹 Ein Schuss fällt …', 'Schaut auf den Bildschirm.');
    else if (ph === 'day') h = screenDay();
    else if ((ph === 'vote' || ph === 'runoff') && S.ballot) h = screenBallot();
    else if (ph === 'vote' || ph === 'runoff') h = screenWait('🗳️ Abstimmung', '🗳️ Die Abstimmung beginnt …');
    else if (ph === 'verdict') h = screenWait('⚖️ Urteil', '⚖️ Das Urteil …', 'Schaut auf den Bildschirm.');
    else h = screenWait('🐺 Werwolfnacht', '…');
    body.innerHTML = h;
    tick();
  }

  // ---------- countdown ----------
  function tick() {
    const showT = S.endAt && !S.end && S.phase !== 'night' && S.phase !== 'roles';
    const s = showT ? Math.max(0, Math.ceil((S.endAt - performance.now()) / 1000)) : null;
    $('wwTimer').textContent = s == null ? '' : s + ' s';
    const cd = $('wwCd'); if (cd) cd.textContent = s == null ? '' : s;
  }
  function setSecs(secs) {
    S.endAt = secs > 0 ? performance.now() + secs * 1000 : 0;
    if (!tickInt) tickInt = setInterval(tick, 250);
  }

  // ---------- hold to reveal ----------
  function holdOn(e) {
    const el = e.target.closest && e.target.closest('[data-hold]');
    if (!el) return;
    e.preventDefault();
    holding = el.dataset.hold; el.classList.add('open');
  }
  function holdOff() {
    if (!holding) return;
    holding = null;
    body.querySelectorAll('.wwhold.open').forEach((el) => el.classList.remove('open'));
  }
  body.addEventListener('touchstart', holdOn, { passive: false });
  body.addEventListener('mousedown', holdOn);
  ['touchend', 'touchcancel'].forEach((n) => { body.addEventListener(n, holdOff); document.addEventListener(n, holdOff); });
  window.addEventListener('mouseup', holdOff);
  window.addEventListener('blur', holdOff);
  body.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- actions ----------
  const findOpt = (opts, id) => (opts || []).find((p) => String(p.id) === String(id));
  body.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-a]');
    if (!el || el.disabled) return;
    const a = el.dataset.a, id = el.dataset.id;
    buzz();
    if (a === 'ready') { S.ready = true; render(); send({ t: 'wwReady' }); }
    else if (a === 'talkready') { S.talkReady = true; render(); send({ t: 'wwTalkReady' }); }
    else if (a === 'skip') { if (S.host) send({ t: 'wwSkip' }); }
    else if (a === 'again') { if (S.host) send({ t: 'wwAgain' }); }
    else if (a === 'vote') {
      const o = id === '' ? null : findOpt(S.ballot && S.ballot.options, id);
      if (id !== '' && !o) return;
      S.vote = o ? o.id : null; render(); send({ t: 'wwVote', target: S.vote });
    }
    else if (a === 'shoot') {
      if (S.shootSent) return;
      const o = findOpt(S.shoot && S.shoot.options, id); if (!o) return;
      S.shootSent = String(o.id); render(); send({ t: 'wwShoot', target: o.id });
    }
    else if (T) taskAction(a, id);
  });

  function taskAction(a, id) {
    const t = T.task, kind = t.kind;
    if (a === 'pick') {
      if (T.locked) return;
      const o = findOpt(t.options, id); if (!o) return;
      if (kind === 'cupid') {
        if (T.sentCupid) return;
        const i = T.sel.findIndex((x) => String(x) === String(o.id));
        if (i >= 0) T.sel.splice(i, 1); else { T.sel.push(o.id); if (T.sel.length > 2) T.sel.shift(); }
        render();
      } else {
        T.sel = [o.id];
        if (kind === 'seer') T.locked = true; // first pick is final
        render(); send({ t: 'wwAct', target: o.id });
      }
    } else if (a === 'cupid') {
      if (T.sel.length !== 2 || T.sentCupid) return;
      T.sentCupid = true; T.locked = true; render(); send({ t: 'wwAct', targets: T.sel.slice() });
    } else if (a === 'heal') {
      if (!t.canHeal) return;
      T.heal = !T.heal; T.saved = false; render();
    } else if (a === 'poison') {
      if (!t.canPoison) return;
      const o = findOpt(t.options, id); if (!o) return;
      T.poison = String(T.poison) === String(o.id) ? null : o.id; T.saved = false; render();
    } else if (a === 'poisonclr') {
      if (T.poison != null) { T.poison = null; T.saved = false; render(); }
    } else if (a === 'witchdone') {
      T.saved = true; render();
      send({ t: 'wwAct', heal: !!(T.heal && t.canHeal), poison: t.canPoison && T.poison != null ? T.poison : null });
    }
  }

  // ---------- messages ----------
  function onPhase(d) {
    const key = d.phase + '|' + d.night + '|' + d.day;
    if (key !== S.key) {
      // new phase: drop transient per-phase data
      S.key = key; T = null; S.shoot = null; S.shootSent = false; S.ballot = null; S.vote = undefined; S.talkReady = false;
      if (d.phase !== 'night') { S.packPicks = {}; if (d.phase !== 'dawn') S.seen = null; }
      if (d.phase === 'night' && d.night !== S.night) S.seen = null;
    }
    S.phase = d.phase; S.night = d.night || 0; S.day = d.day || 0;
    S.alive = d.alive !== false;
    if (S.alive) S.dead = null;
    if (d.host !== undefined) { S.host = !!d.host; myHost = S.host; updateAbort(); }
    setSecs(d.secs || 0);
  }

  const Ww = {
    activate() {
      reset();
      if (tickInt) { clearInterval(tickInt); tickInt = null; }
      showView('werwolf');
      render();
    },
    onMessage(d) {
      if (!d || typeof d.t !== 'string') return;
      switch (d.t) {
        case 'wwRole':
          if (S.end) { reset(); }
          S.role = d.role; S.pack = d.pack || [];
          if (d.host !== undefined) { S.host = !!d.host; myHost = S.host; updateAbort(); }
          break;
        case 'wwPhase': onPhase(d); break;
        case 'wwTask':
          { const old = T; T = newT(d);
            if (old && old.task.kind === d.kind && old.task.step === d.step) { T.sel = old.sel; T.heal = old.heal; T.poison = old.poison; T.saved = old.saved; T.sentCupid = old.sentCupid; T.locked = T.locked || old.locked; } }
          break;
        case 'wwPack': S.packPicks = d.picks || {}; break;
        case 'wwSeen': S.seen = { target: d.target || {}, role: d.role }; break;
        case 'wwLover': S.lover = d.partner || null; break;
        case 'wwDead': S.alive = false; S.dead = d.cause; break;
        case 'wwGhost': S.ghost = { roster: d.roster || [], night: d.night || [] }; break;
        case 'wwShootTask':
          S.shoot = d; S.shootSent = false; setSecs(d.secs || 0); break;
        case 'wwBallot':
          S.ballot = d; setSecs(d.secs || 0); break;
        case 'wwEnd':
          S.end = { winner: d.winner, won: !!d.won, roster: d.roster || [] };
          if (d.host !== undefined) { S.host = !!d.host; myHost = S.host; updateAbort(); }
          break;
        default: return;
      }
      showView('werwolf');
      render();
    }
  };
  registerGame({ key: 'werwolf', controller: Ww });
})();
