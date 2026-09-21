/* Independent pointer ownership and latched fire taps: transport ticks never lose a quick shot. */
(function () {
  'use strict';
  class Input {
    constructor(surface, options = {}) {
      this.surface = surface; this.options = options; this.keys = new Set(); this.edges = {}; this.fire = false; this.aim = false;
      this.yaw = 0; this.pitch = 0; this.enabled = false; this.locked = false; this.move = { x: 0, y: 0 }; this.listeners = []; this.scopePulseUntil = 0;
      this.settings = { sensitivity: 0.8, leftHanded: false, assist: true };
      try { this.updateSettings(JSON.parse(localStorage.getItem('breach-controls-v2') || '{}'), false); } catch (_) {}
      const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); this.listeners.push(() => el.removeEventListener(type, fn, opts)); };
      this.on = on;
      on(document, 'keydown', e => {
        if (!this.enabled || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
        if (['KeyW','KeyA','KeyS','KeyD','Space','Tab','KeyE','KeyR','KeyG','ShiftLeft'].includes(e.code) || /^Digit[0-9]$/.test(e.code)) e.preventDefault();
        this.keys.add(e.code);
        if (!e.repeat) {
          delete this.edges.reset;
          if (e.code === 'KeyR') this.edges.reload = true;
          if (e.code === 'KeyG') this.edges.smoke = true;
          if (e.code === 'Space') this.edges.jump = true;
          if (/^Digit[0-9]$/.test(e.code)) this.edges.weapon = Object.keys(window.BreachWorld?.weapons || {rifle:1,smg:1,pistol:1})[(Number(e.code.slice(-1)) + 9) % 10];
          this.changed();
        }
      });
      on(document, 'keyup', e => { this.keys.delete(e.code); this.changed(); });
      on(surface, 'click', () => { if (this.enabled && !options.noPointer && !matchMedia('(pointer: coarse)').matches) this.lock(); });
      on(document, 'pointerlockchange', () => { this.locked = document.pointerLockElement === surface; if (!this.locked) this.clear(); if (options.onLock) options.onLock(this.locked); });
      on(document, 'pointerlockerror', () => { if (options.onLock) options.onLock(false); });
      on(document, 'mousemove', e => { if (this.enabled && this.locked) this.rotate(e.movementX, e.movementY, 0.0021); });
      // Mouse events report each button in a chord; pointerdown only reports the first.
      on(surface, 'mousedown', e => {
        if (!this.enabled || !this.locked || e.sourceCapabilities?.firesTouchEvents) return;
        delete this.edges.reset;
        if (e.button === 0) { this.fire = true; this.edges.fireTap = true; if (this.scoped()) this.edges.aim = true; }
        if (e.button === 2) this.aim = true;
        this.changed();
      });
      on(document, 'mouseup', e => {
        if (!this.locked || e.sourceCapabilities?.firesTouchEvents) return;
        if (e.button === 0) this.fire = false;
        if (e.button === 2) this.aim = false;
        this.changed();
      });
      on(surface, 'contextmenu', e => e.preventDefault());
      on(window, 'blur', () => this.clear());
      on(document, 'visibilitychange', () => { if (document.hidden) this.clear(); });
    }
    updateSettings(value, save = true) {
      if (!value || typeof value !== 'object') return;
      if (typeof value.sensitivity === 'number' && Number.isFinite(value.sensitivity)) this.settings.sensitivity = Math.max(0.3, Math.min(1.8, value.sensitivity));
      if (typeof value.leftHanded === 'boolean') this.settings.leftHanded = value.leftHanded;
      if (typeof value.assist === 'boolean') this.settings.assist = value.assist;
      if (this.pad) this.pad.dataset.handed = this.settings.leftHanded ? 'left' : 'right';
      if (save) try { localStorage.setItem('breach-controls-v2', JSON.stringify(this.settings)); } catch (_) {}
    }
    changed() { if (this.options.onChange) this.options.onChange(); }
    scoped() { return this.aim || performance.now() < this.scopePulseUntil; }
    setContext(mode, weapon, active = true) {
      if (!this.pad) return;
      this.pad.querySelector('[data-action=use]').hidden = mode === 'ffa';
      const quick = this.pad.querySelector('[data-action=quickscope]'); quick.hidden = mode !== 'ffa';
      quick.disabled = !active || !window.BreachWorld?.weapons[weapon]?.zoom;
      quick.title = quick.disabled ? 'MR-9 oder Longbow wählen' : 'Kurz anvisieren und einmal schießen';
    }
    rotate(dx, dy, base = 0.0042) {
      const speed = base * this.settings.sensitivity * (this.scoped() ? 0.5 : 1);
      this.yaw -= dx * speed; this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - dy * speed * 0.85));
    }
    lock() {
      if (!this.surface.requestPointerLock) return;
      try { const promise = this.surface.requestPointerLock(); if (promise?.catch) promise.catch(() => {}); } catch (_) {}
    }
    clear() {
      this.keys.clear(); this.fire = false; this.aim = false; this.use = false; this.scopePulseUntil = 0; this.edges = { reset: true }; this.move = { x: 0, y: 0 };
      if (this.resetTouch) this.resetTouch(); this.changed();
    }
    read() {
      const k = this.keys, active = this.enabled && !document.hidden;
      const input = active ? { forward: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) - this.move.y,
        strafe: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.move.x, yaw: this.yaw, pitch: this.pitch,
        fire: this.fire, aim: this.scoped(), walk: k.has('ShiftLeft') || k.has('ShiftRight'), use: k.has('KeyE') || this.use,
        score: k.has('Tab'), assist: this.settings.assist, ...this.edges } : (this.edges.reset ? { reset: true } : {});
      this.edges = {}; return input;
    }
    touch(parent) {
      const pad = document.createElement('div'); pad.className = 'br-touch'; pad.dataset.handed = this.settings.leftHanded ? 'left' : 'right';
      pad.innerHTML = '<div class="br-move" aria-label="Bewegen"><small>BEWEGEN</small><div class="br-stick"><span></span></div></div><div class="br-look" aria-label="Umsehen"><small>ZIELEN · WISCHEN</small><i>+</i></div><div class="br-actions"><button data-action="smoke" aria-label="RAUCH"><b>◌</b><small>RAUCH</small></button><button data-action="reload" aria-label="LADEN"><b>↻</b><small>LADEN</small></button><button data-action="use" aria-label="E · ZIEL"><b>◇</b><small>ZIEL HALTEN</small></button><button data-action="quickscope" aria-label="QUICK SCOPE" hidden disabled><b>⌖</b><small>QUICK SCOPE</small></button><button data-action="aim" aria-label="VISIER"><b>⊕</b><small>VISIER</small></button><button data-action="fire" class="br-fire" aria-label="FEUER"><b>⊙</b><strong>FEUER</strong><small>HALTEN + ZIEHEN</small></button></div>';
      parent.append(pad); this.pad = pad;
      const roles = new Map(), stick = pad.querySelector('.br-stick'), thumb = stick.querySelector('span');
      const moveZone = pad.querySelector('.br-move'), look = pad.querySelector('.br-look');
      const capture = (el, e, role) => {
        if (!this.enabled || roles.has(role)) return false;
        delete this.edges.reset;
        e.preventDefault(); roles.set(role, { id: e.pointerId, el, x: e.clientX, y: e.clientY });
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        el.classList.add('pressed'); return true;
      };
      const release = e => {
        for (const [role, state] of roles) if (state.id === e.pointerId) {
          roles.delete(role); state.el.classList.toggle('pressed', role === 'aim' && this.aim);
          if (role === 'move') { this.move = { x: 0, y: 0 }; thumb.style.transform = ''; stick.style.left = ''; stick.style.top = ''; }
          if (['fire','use'].includes(role)) this[role] = false;
          if (role === 'fire' && e.type !== 'pointerup') { delete this.edges.fireTap; this.edges.cancelFire = true; }
          if (role === 'quickscope' && e.type !== 'pointerup') { delete this.edges.quickscope; this.edges.cancelQuickscope = true; this.scopePulseUntil = 0; }
          this.changed();
        }
      };
      this.resetTouch = () => {
        pad.querySelectorAll('.pressed').forEach(el => el.classList.remove('pressed')); pad.querySelector('[data-action=aim]').setAttribute('aria-pressed', 'false');
        roles.clear(); thumb.style.transform = ''; stick.style.left = ''; stick.style.top = '';
      };
      const move = e => {
        const owner = roles.get('move'); if (!owner || owner.id !== e.pointerId) return;
        const dx = e.clientX - owner.x, dy = e.clientY - owner.y, length = Math.hypot(dx, dy), magnitude = Math.min(1, Math.max(0, (length - 5) / 43));
        this.move = length ? { x: dx / length * magnitude, y: dy / length * magnitude } : { x: 0, y: 0 };
        thumb.style.transform = `translate(${this.move.x * 37}px,${this.move.y * 37}px)`;
      };
      this.on(moveZone, 'pointerdown', e => {
        if (!capture(moveZone, e, 'move')) return;
        const r = moveZone.getBoundingClientRect(); stick.style.left = (e.clientX - r.left) + 'px'; stick.style.top = (e.clientY - r.top) + 'px'; move(e); this.changed();
      });
      this.on(moveZone, 'pointermove', move);
      this.on(look, 'pointerdown', e => { capture(look, e, 'look'); });
      this.on(look, 'pointermove', e => {
        const owner = roles.get('look'); if (!owner || owner.id !== e.pointerId) return;
        this.rotate(e.clientX - owner.x, e.clientY - owner.y); owner.x = e.clientX; owner.y = e.clientY;
      });
      pad.querySelectorAll('button').forEach(button => {
        const action = button.dataset.action;
        if (action === 'aim') button.setAttribute('aria-pressed', 'false');
        this.on(button, 'pointerdown', e => {
          if (button.disabled || button.hidden || !capture(button, e, action)) return;
          if (action === 'aim') { this.aim = !this.aim; button.setAttribute('aria-pressed', String(this.aim)); button.classList.toggle('pressed', this.aim); }
          else if (['fire','use'].includes(action)) this[action] = true; else this.edges[action] = true;
          if (action === 'quickscope') this.scopePulseUntil = performance.now() + 220;
          if (action === 'fire') { this.edges.fireTap = true; if (this.scoped()) this.edges.aim = true; }
          this.changed();
        });
        this.on(button, 'pointermove', e => {
          const owner = roles.get(action); if (!['fire', 'quickscope'].includes(action) || !owner || owner.id !== e.pointerId) return;
          this.rotate(e.clientX - owner.x, e.clientY - owner.y); owner.x = e.clientX; owner.y = e.clientY;
        });
      });
      this.on(document, 'pointerup', release); this.on(document, 'pointercancel', release); this.on(pad, 'lostpointercapture', release);
    }
    dispose() {
      this.enabled = false; this.clear(); if (document.pointerLockElement === this.surface) document.exitPointerLock();
      this.listeners.forEach(fn => fn()); if (this.pad) this.pad.remove();
    }
  }
  window.BreachInput = Input;
})();
