'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<div id="surface"></div>', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost' });
const w = dom.window;
w.matchMedia = () => ({ matches: true });
w.HTMLElement.prototype.setPointerCapture = function () {};
w.HTMLElement.prototype.releasePointerCapture = function () {};
w.eval(fs.readFileSync('public/games/breach/input.js', 'utf8'));
const surface = w.document.getElementById('surface');
const input = new w.BreachInput(surface, { noPointer: true }); input.enabled = true; input.touch(surface);
const fire = surface.querySelector('[data-action="fire"]'), reload = surface.querySelector('[data-action="reload"]');
const pointer = (el, type, id, x = 150, y = 100) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0 }); el.dispatchEvent(e); };
let failures = 0;
function test(name, fn) { input.clear(); try { fn(); console.log('✓ ' + name); } catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); } }
test('A short fire tap survives release before the next transport tick', () => {
  pointer(fire, 'pointerdown', 1); pointer(fire, 'pointerup', 1);
  const p = input.read(); assert.equal(p.fire, false); assert.equal(p.fireTap, true); assert.equal(!!input.read().fireTap, false);
  assert.equal(!!p.reset, false);
  const { Match } = require('./public/games/breach/simulation');
  const model = new Match(['a', 'b'], { pvp: true, teams: { a: 0, b: 1 }, fillBots: false }); model.phase = 'live'; model.input('a', p); model.step(1 / 60); assert.equal(model.actors[0].ammo, 29);
});
test('Releasing another touch or a compatibility mouse event never stops a held fire finger', () => {
  pointer(fire, 'pointerdown', 2); pointer(reload, 'pointerdown', 3); pointer(reload, 'pointerup', 3);
  w.document.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  assert.equal(input.read().fire, true); pointer(fire, 'pointerup', 2); assert.equal(input.read().fire, false);
});
test('Only the pointer owning the fire button can release it', () => {
  pointer(fire, 'pointerdown', 4); pointer(fire, 'pointerup', 99); assert.equal(input.read().fire, true);
  pointer(fire, 'pointercancel', 4); assert.equal(input.read().fire, false);
});
test('A cancelled touch removes an unsent tap and cancels a shot already queued by the simulation', () => {
  const { Match } = require('./public/games/breach/simulation');
  const model = new Match(['a', 'b'], { pvp: true, teams: { b: 1 }, fillBots: false }); model.phase = 'live';
  const actor = model.actors[0]; actor.cooldown = 0.1;
  pointer(fire, 'pointerdown', 32); model.input('a', input.read()); assert.equal(actor.queuedShot, true);
  pointer(fire, 'pointercancel', 32); const cancelled = input.read(); assert.equal(cancelled.cancelFire, true); model.input('a', { ...cancelled, forward: 1 });
  for (let n = 0; n < 15; n++) model.step(1 / 60); assert.equal(actor.ammo, 30); assert.ok(actor.z < 24);
  pointer(fire, 'pointerdown', 33); pointer(fire, 'pointercancel', 33); assert.equal(!!input.read().fireTap, false);
});
test('Aim and fire dragging can coexist and blur releases everything', () => {
  pointer(fire, 'pointerdown', 5); const yaw = input.yaw; pointer(fire, 'pointermove', 5, 190, 100);
  assert.ok(input.yaw < yaw); assert.equal(input.read().fire, true); w.dispatchEvent(new w.Event('blur'));
  const p = input.read(); assert.equal(p.fire, false); assert.equal(p.forward, 0); assert.equal(!!p.fireTap, false);
  pointer(fire, 'pointerdown', 6); assert.equal(input.read().fire, true);
});
test('Disabled controls send one reset edge without flooding the online transport', () => {
  input.enabled = false; assert.equal(input.read().reset, true); assert.equal(!!input.read().reset, false); input.enabled = true;
});
test('Touch sights toggle so two thumbs can move and fire while aiming', () => {
  const aim = surface.querySelector('[data-action="aim"]');
  pointer(aim, 'pointerdown', 40); pointer(aim, 'pointerup', 40); assert.equal(input.read().aim, true); assert.equal(aim.getAttribute('aria-pressed'), 'true');
  pointer(fire, 'pointerdown', 41); assert.equal(input.read().aim, true); pointer(fire, 'pointerup', 41); assert.equal(input.read().aim, true);
  pointer(aim, 'pointerdown', 42); pointer(aim, 'pointerup', 42); assert.equal(input.read().aim, false);
  pointer(aim, 'pointerdown', 43); pointer(aim, 'pointerup', 43); input.clear(); assert.equal(input.read().aim, false); assert.equal(aim.getAttribute('aria-pressed'), 'false');
});
test('Control settings persist and reject invalid sensitivity', () => {
  input.updateSettings({ sensitivity: 0.6, leftHanded: true, assist: false }); assert.equal(input.pad.dataset.handed, 'left');
  input.updateSettings({ sensitivity: NaN }); assert.equal(input.settings.sensitivity, 0.6);
  const second = new w.BreachInput(surface, { noPointer: true }); assert.equal(second.settings.sensitivity, 0.6); assert.equal(second.settings.leftHanded, true); assert.equal(second.settings.assist, false); second.dispose();
});
test('Quickscope uses one latched edge, supports dragging and never leaves a cancelled shot', () => {
  // World data determines whether the currently selected weapon supports this action.
  w.BreachWorld = require('./public/games/breach/world'); input.setContext('ffa', 'sniper');
  const quick = surface.querySelector('[data-action="quickscope"]'); assert.equal(quick.hidden, false); assert.equal(quick.disabled, false);
  const yaw = input.yaw; pointer(quick, 'pointerdown', 51); pointer(quick, 'pointermove', 51, 170, 100); pointer(quick, 'pointerup', 51);
  const p = input.read(); assert.equal(p.quickscope, true); assert.equal(p.aim, true); assert.equal(p.fire, false); assert.ok(input.yaw < yaw); assert.equal(!!input.read().quickscope, false);
  pointer(quick, 'pointerdown', 52); pointer(quick, 'pointercancel', 52); const cancelled = input.read(); assert.equal(cancelled.cancelQuickscope, true); assert.equal(!!cancelled.quickscope, false); assert.equal(cancelled.aim, false);
  input.setContext('ffa', 'rifle'); assert.equal(quick.disabled, true); pointer(quick, 'pointerdown', 53); assert.equal(!!input.read().quickscope, false);
  input.setContext('tactical', 'sniper'); assert.equal(quick.hidden, true); assert.equal(surface.querySelector('[data-action=use]').hidden, false);
});
test('Fast mouse right-left-release preserves the scoped shot until the next tick', () => {
  input.locked = true;
  const mouse = (target, type, button) => target.dispatchEvent(new w.MouseEvent(type, { bubbles: true, button }));
  mouse(surface, 'mousedown', 2); mouse(surface, 'mousedown', 0); mouse(w.document, 'mouseup', 0); mouse(w.document, 'mouseup', 2);
  const tap = input.read(); assert.equal(tap.fireTap, true); assert.equal(tap.aim, true); assert.equal(tap.fire, false); assert.equal(input.read().aim, false); input.locked = false;
});
test('Mouse buttons remain independent when aiming and firing together', () => {
  input.locked = true;
  const mouse = (target, type, button) => target.dispatchEvent(new w.MouseEvent(type, { bubbles: true, button }));
  mouse(surface, 'mousedown', 2); assert.equal(input.read().aim, true);
  mouse(surface, 'mousedown', 0); const both = input.read(); assert.equal(both.fire, true); assert.equal(both.fireTap, true); assert.equal(both.aim, true);
  mouse(w.document, 'mouseup', 0); const scoped = input.read(); assert.equal(scoped.fire, false); assert.equal(scoped.aim, true);
  mouse(surface, 'mousedown', 0); input.read(); mouse(w.document, 'mouseup', 2);
  const firing = input.read(); assert.equal(firing.fire, true); assert.equal(firing.aim, false);
  mouse(w.document, 'mouseup', 0); assert.equal(input.read().fire, false); input.locked = false;
});
input.dispose(); dom.window.close(); if (failures) process.exitCode = 1;
