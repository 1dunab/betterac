// ============ Controller-Modul: SLITHER ============
  const slState = { left: false, right: false, boost: false };
  function slSend() { ac.message(AirConsole.SCREEN, { steer: (slState.right ? 1 : 0) - (slState.left ? 1 : 0), boost: slState.boost }); }
  function slBind(id, key) {
    const el = $(id);
    const on = (e) => { e.preventDefault(); slState[key] = true; el.classList.add('on'); slSend(); };
    const off = (e) => { e.preventDefault(); slState[key] = false; el.classList.remove('on'); slSend(); };
    el.addEventListener('touchstart', on); el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
    el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
  }
  slBind('sl-left', 'left'); slBind('sl-right', 'right'); slBind('sl-boost', 'boost');
  const SLc = { activate() { slState.left = slState.right = slState.boost = false; showView('sl'); }, onMessage() {} };
registerGame({ key: 'slither', label: '🐍 Slither', min: 1, controller: SLc });
