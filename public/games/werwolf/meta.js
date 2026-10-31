(function () {
  const onOff = (label) => ({ label, type: 'choice', default: 'on', options: [{ v: 'on', label: 'An' }, { v: 'off', label: 'Aus' }] });
  registerGame({ key: 'werwolf', label: '🐺 Werwolfnacht', min: 5, settings: {
    wolves: { label: 'Werwölfe', type: 'choice', default: 'auto', options: [
      { v: 'auto', label: 'Automatisch' }, { v: '1', label: '1' }, { v: '2', label: '2' }, { v: '3', label: '3' }, { v: '4', label: '4' }] },
    seer: onOff('🔮 Seherin'),
    witch: onOff('🧪 Hexe'),
    hunter: onOff('🏹 Jäger'),
    guard: onOff('🛡️ Beschützer'),
    cupid: onOff('💘 Amor'),
    talk: { label: 'Diskussion', type: 'number', default: 180, min: 60, max: 420, step: 30, unit: 's' },
    reveal: { label: 'Rolle beim Tod zeigen', type: 'choice', default: 'on', options: [{ v: 'on', label: 'Ja' }, { v: 'off', label: 'Nein' }] },
    voice: { label: 'Erzählerstimme', type: 'choice', default: 'on', options: [{ v: 'on', label: '🔊 An' }, { v: 'off', label: '🔇 Aus' }] }
  } });
})();
