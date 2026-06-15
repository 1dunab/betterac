// ============ Controller-Modul: LIGHT CYCLES ============
  const LCc = {
    activate() { showView('lc'); },
    onMessage() {}
  };
  document.querySelectorAll('#pad2 button[data-turn]').forEach(btn => {
    const fire = (e) => { e.preventDefault(); ac.message(AirConsole.SCREEN, { turn: btn.getAttribute('data-turn') }); };
    btn.addEventListener('touchstart', fire); btn.addEventListener('mousedown', fire);
  });
registerGame({ key: 'lightcycles', label: '🏍️ Light Cycles', min: 2, controller: LCc });
