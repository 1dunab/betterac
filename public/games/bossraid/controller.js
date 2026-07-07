// ============ Controller-Modul: BOSS RAID ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #brClassPick { display:flex; flex-direction:column; gap:12px; width:100%; max-width:340px; }
  #brClassPick button { border:none; border-radius:16px; padding:16px; font-size:18px; font-weight:800; color:#fff; text-align:left; }
  #brPad { flex:1; display:grid; gap:10px; padding:14px; min-height:0;
           grid-template-columns:1fr 1fr 1fr; grid-template-rows:1fr 1fr 1fr 1.1fr; }
  #brPad button { border:none; border-radius:18px; background:rgba(0,0,0,.30); color:#fff; font-size:32px; font-weight:800; }
  #brPad button:active, #brPad button.on { background:rgba(255,255,255,.30); }
  #br-up { grid-column:2; grid-row:1; } #br-left { grid-column:1; grid-row:2; }
  #br-right { grid-column:3; grid-row:2; } #br-down { grid-column:2; grid-row:3; }
  #br-skill { grid-column:1/span 3; grid-row:4; font-size:22px;
              background:linear-gradient(180deg, rgba(120,60,255,.55), rgba(0,0,0,.30)); }
  #br-skill.cooldown { opacity:.35; }
  #brHearts { letter-spacing:3px; }
</style>
<!-- BOSS RAID: KLASSE WÄHLEN -->
<div id="v-br-pick" class="view"><div class="center">
  <div class="big">Wähle deine Klasse ⚔️</div>
  <div id="brClassPick">
    <button data-cls="tank" style="background:#1e4976">🛡️ TANK<br><span style="font-weight:600; font-size:13px; opacity:.8">Schild-Blase: blockt Kugeln für das Team</span></button>
    <button data-cls="healer" style="background:#1e6e46">💚 HEALER<br><span style="font-weight:600; font-size:13px; opacity:.8">Heilkreis: heilt & belebt Geister wieder</span></button>
    <button data-cls="dd" style="background:#6e2a5e">⚡ DAMAGE<br><span style="font-weight:600; font-size:13px; opacity:.8">Mega-Laser: brutzelt den Boss</span></button>
  </div>
  <div id="brPickInfo" class="muted">Der Kampf startet, wenn alle gewählt haben.</div>
</div></div>
<!-- BOSS RAID: KAMPF -->
<div id="v-br-fight" class="view">
  <div class="bar"><span class="word" id="brCls">⚔️</span><span id="brHearts" class="timer">❤️❤️❤️</span></div>
  <div id="brPad">
    <button id="br-up">↑</button>
    <button id="br-left">←</button>
    <button id="br-right">→</button>
    <button id="br-down">↓</button>
    <button id="br-skill">SKILL</button>
  </div>
  <div id="brStatus" class="muted" style="text-align:center; padding:0 16px 12px">Weiche aus — geschossen wird automatisch!</div>
  <button id="brAgainBtn" class="btn go" style="display:none; margin:0 14px 14px; font-size:18px">🔁 Nochmal</button>
</div>`);
  VIEWS.push('br-pick', 'br-fight');

  const SKILL_LABEL = { tank: '🛡️ SCHILD', healer: '💚 HEILKREIS', dd: '⚡ MEGA-LASER' };
  const CLS_LABEL = { tank: '🛡️ Tank', healer: '💚 Healer', dd: '⚡ Damage' };
  let myCls = null, skillReady = true;

  document.querySelectorAll('#brClassPick button').forEach(b => b.addEventListener('click', () => {
    myCls = b.getAttribute('data-cls');
    $('brPickInfo').textContent = CLS_LABEL[myCls] + ' gewählt — warte auf die anderen…';
    ac.message(AirConsole.SCREEN, { t: 'brClass', cls: myCls });
  }));

  const move = { up: false, down: false, left: false, right: false };
  function sendMove() {
    ac.message(AirConsole.SCREEN, { t: 'brMove', x: (move.right ? 1 : 0) - (move.left ? 1 : 0), y: (move.down ? 1 : 0) - (move.up ? 1 : 0) });
  }
  function bindHold(id, key) {
    const el = $(id);
    const on = (e) => { e.preventDefault(); move[key] = true; el.classList.add('on'); sendMove(); };
    const off = (e) => { e.preventDefault(); move[key] = false; el.classList.remove('on'); sendMove(); };
    el.addEventListener('touchstart', on); el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
    el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
  }
  bindHold('br-up', 'up'); bindHold('br-down', 'down'); bindHold('br-left', 'left'); bindHold('br-right', 'right');

  const skillBtn = $('br-skill');
  const fireSkill = (e) => { e.preventDefault(); if (skillReady) ac.message(AirConsole.SCREEN, { t: 'brSkill' }); };
  skillBtn.addEventListener('touchstart', fireSkill); skillBtn.addEventListener('mousedown', fireSkill);
  function setSkill(ready) {
    skillReady = ready;
    skillBtn.classList.toggle('cooldown', !ready);
    skillBtn.textContent = (ready ? '' : '⏳ ') + (SKILL_LABEL[myCls] || 'SKILL');
  }
  $('brAgainBtn').addEventListener('click', () => ac.message(AirConsole.SCREEN, { t: 'brAgain' }));

  const BRc = {
    activate() {
      myCls = null; skillReady = true;
      Object.keys(move).forEach(k => move[k] = false);
      $('brPickInfo').textContent = 'Der Kampf startet, wenn alle gewählt haben.';
      $('brAgainBtn').style.display = 'none';
      showView('br-pick');
    },
    onMessage(d) {
      if (d.t === 'brState') {
        $('brAgainBtn').style.display = 'none';
        if (d.phase === 'fight') {
          $('brCls').textContent = CLS_LABEL[myCls] || '⚔️';
          setSkill(true);
          $('brStatus').textContent = 'Weiche aus — geschossen wird automatisch!';
          showView('br-fight');
        } else if (d.phase === 'pick') {
          BRc.activate();
        }
      } else if (d.t === 'brYou') {
        if (d.hp !== undefined) $('brHearts').textContent = d.hp > 0 ? '❤️'.repeat(d.hp) : '👻';
        if (d.skill !== undefined) setSkill(!!d.skill);
        if (d.ghost) $('brStatus').textContent = '👻 Du bist ein Geist — Teammates können dich wiederbeleben!';
        else if (d.revived) $('brStatus').textContent = '✨ Wiederbelebt! Weiter geht\'s!';
        else if (d.msg) $('brStatus').textContent = d.msg;
      } else if (d.t === 'brEnd') {
        $('brStatus').textContent = d.win ? '🏆 BOSS BESIEGT!' : '💀 Wipe… Boss erholt sich!';
        if (d.win) $('brAgainBtn').style.display = d.host ? 'block' : 'none';
      }
    }
  };
  registerGame({ key: 'bossraid', controller: BRc });
})();
