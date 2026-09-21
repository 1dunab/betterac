'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<body></body>',{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/controller.html'}),w=dom.window;
let controller,heartbeat,now=1000; const packets=[];
w.$=id=>w.document.getElementById(id);w.VIEWS=[];w.registerGame=g=>{controller=g.controller;};w.showView=name=>w.$('v-'+name).classList.add('on');w.updateAbort=()=>{};w.myHost=true;
w.ac={message:(id,d)=>packets.push(JSON.parse(JSON.stringify(d)))};w.AirConsole={SCREEN:0};w.matchMedia=()=>({matches:true});w.HTMLElement.prototype.setPointerCapture=()=>{};
Object.defineProperty(w.performance,'now',{value:()=>now});w.setInterval=fn=>{heartbeat=fn;return 1;};w.clearInterval=()=>{};
for(const f of ['world','input','controller'])w.eval(fs.readFileSync('public/games/breach/'+f+'.js','utf8'));
const state={t:'brState',round:1,epoch:0,host:true,count:2,index:1,hp:100,ammo:30,reserve:180,reload:0,alive:true,phase:'live',weapon:'rifle',yaw:0,pitch:0,mode:'tactical',objective:{title:'A · BIOLAB',detail:'ZIEL halten',progress:0,ready:true,action:'LEGEN'}};
function pointer(type,id){const e=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:id,pointerType:'touch',clientX:200,clientY:200});w.document.querySelector('[data-action=fire]').dispatchEvent(e);}
controller.activate();controller.onMessage(state);pointer('pointerdown',1);assert.equal(packets.at(-1).input.fire,true);
now+=2000;heartbeat();assert.equal(w.$('v-breach').dataset.signal,'lost');assert.match(w.$('br-phone-state').textContent,/KEIN/);assert.equal(w.document.querySelector('[data-action=fire]').disabled,true);assert.ok(packets.slice(-2).every(p=>!p.input.fire));
controller.onMessage(state);assert.equal(w.$('v-breach').dataset.signal,'ready');heartbeat();assert.equal(packets.at(-1).input.fire,false);pointer('pointerdown',2);assert.equal(packets.at(-1).input.fireTap,true);pointer('pointerup',2);
w.$('br-phone-options').click();now+=2000;heartbeat();controller.onMessage(state);pointer('pointerdown',3);assert.equal(!!packets.at(-1).input.fire,false);w.$('br-phone-settings').querySelector('[data-br-close]').click();pointer('pointerdown',4);assert.equal(packets.at(-1).input.fire,true);pointer('pointerup',4);
controller.onMessage({...state,objective:{...state.objective,progress:0.4,detail:'BOMBE LEGEN'}});assert.equal(w.$('br-phone-reload').getAttribute('aria-valuenow'),'40');
controller.onMessage({...state,mode:'deathmatch',alive:false,respawn:2,objective:{title:'Wiedereinstieg in 2 s',detail:'Gleich geht es weiter',progress:0}});assert.match(w.$('br-phone-state').textContent,/WIEDEREINSTIEG/);assert.equal(w.document.querySelector('[data-action=use]').disabled,true);
for(const mode of ['arsenal','control','survival']) {
  controller.onMessage({...state,mode});assert.equal(w.document.querySelector('[data-action=use]').disabled,true);
  assert.equal(w.$('br-phone-weapon').disabled,mode==='arsenal');
  controller.onMessage({...state,mode,alive:false,respawn:2});assert.match(w.$('br-phone-state').textContent,mode==='survival'?/ZUSCHAUEN/:/WIEDEREINSTIEG/);
}
controller.onMessage(state);assert.equal(w.$('br-phone-weapon').disabled,false);assert.equal(w.document.querySelector('[data-action=use]').disabled,false);
// A saved mirrored layout is visible and can be restored without clearing names or connection credentials.
w.localStorage.setItem('playerName','Anna');
w.$('br-phone-options').click();w.$('br-left').checked=true;w.$('br-left').dispatchEvent(new w.Event('change'));
assert.equal(w.document.querySelector('.br-touch').dataset.handed,'left');assert.match(w.$('br-phone-layout').textContent,/Gespiegelt/);
controller.activate();assert.equal(w.document.querySelector('.br-touch').dataset.handed,'left');assert.equal(w.document.querySelectorAll('.br-touch').length,1);
w.$('br-phone-options').click();w.$('br-phone-reset').click();assert.equal(w.document.querySelector('.br-touch').dataset.handed,'right');assert.match(w.$('br-phone-layout').textContent,/Standard/);
assert.equal(w.$('br-left').checked,false);assert.equal(w.$('br-sensitivity').value,'0.8');assert.equal(w.$('br-assist').checked,true);
assert.equal(w.localStorage.getItem('playerName'),'Anna');assert.equal(JSON.parse(w.localStorage.getItem('breach-controls-v2')).leftHanded,false);
controller.activate();assert.equal(w.document.querySelector('.br-touch').dataset.handed,'right');assert.equal(w.document.querySelectorAll('.br-touch').length,1);
w.$('v-breach').classList.remove('on');heartbeat();assert.equal(packets.at(-1).input.reset,true);
dom.window.close();console.log('✓ Phone watchdog resets held input, recovers cleanly, respects open settings, reports progress/respawns and cleans up.');
