// Party Hub Mikrofon: holt eine kurze Sprachaufnahme vom Handy in die Seite. Nur auf der Controller-Seite geladen.
//
// Zwei Wege, weil der Browser das Live-Mikrofon (getUserMedia) nur über https oder localhost freigibt:
//   live   Mic.start({ onEnd, onError }) / Mic.stop()   nimmt direkt auf, höchstens Mic.MAX_MS lang
//   Datei  Mic.fileInput({ kind, onStart, onClip, onError })   ein verstecktes Datei-Feld; .click() öffnet die
//          Aufnahme-App des Handys (kind 'audio') oder die Kamera für ein kurzes Video (kind 'video'), aus dem
//          der Ton gelesen wird. Geht auch im Heim-WLAN über http.
// Beide liefern { x: Float32Array, rate }: rohe Samples, ungeschnitten.
(function () {
  'use strict';
  const WHY = { NotAllowedError: 'Das Mikrofon ist nicht erlaubt.', NotFoundError: 'Kein Mikrofon gefunden.', NotReadableError: 'Das Mikrofon ist gerade belegt.',
    SecurityError: 'Der Browser sperrt das Mikrofon.', EncodingError: 'Der Browser kann diese Aufnahme nicht lesen.' };
  const why = (e) => WHY[e && e.name] || 'Die Aufnahme hat nicht geklappt.';
  let ctx = null, rec = null;

  const Mic = {
    MAX_MS: 4500,
    // iPhones bieten für Ton keine Aufnahme-App an, wohl aber die Kamera
    ios: /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    canLive() { return window.isSecureContext === true && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    recording() { return !!rec; },
    audio() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    },

    async start(o) {
      if (rec) return;
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } }); }
      catch (e) { o.onError(why(e)); return; }
      const a = Mic.audio(), src = a.createMediaStreamSource(stream), proc = a.createScriptProcessor(4096, 1, 1), mute = a.createGain(), chunks = [];
      mute.gain.value = 0;
      proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(proc); proc.connect(mute); mute.connect(a.destination);
      const timer = setTimeout(() => Mic.stop(), Mic.MAX_MS);
      rec = { end() {
        clearTimeout(timer);
        src.disconnect(); proc.disconnect(); proc.onaudioprocess = null;
        stream.getTracks().forEach(t => t.stop());
        const n = chunks.reduce((s, c) => s + c.length, 0), x = new Float32Array(n);
        let at = 0; for (const c of chunks) { x.set(c, at); at += c.length; }
        o.onEnd({ x, rate: a.sampleRate });
      } };
      if (o.onStart) o.onStart();
    },
    stop() { if (rec) { const r = rec; rec = null; r.end(); } },

    async decodeFile(file) {
      const data = file.arrayBuffer ? await file.arrayBuffer() : await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsArrayBuffer(file); });
      const buf = await new Promise((ok, no) => { const p = Mic.audio().decodeAudioData(data, ok, no); if (p && p.catch) p.catch(no); });
      const x = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) x[i] += d[i] / buf.numberOfChannels; }
      return { x, rate: buf.sampleRate };
    },
    fileInput(o) {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = o.kind === 'video' ? 'video/*' : 'audio/*'; inp.setAttribute('capture', o.kind === 'video' ? 'user' : '');
      // nicht display:none — manche Handys öffnen die Aufnahme-App dann nicht
      inp.style.cssText = 'position:absolute; left:0; top:0; width:1px; height:1px; opacity:0; pointer-events:none;';
      document.body.appendChild(inp);
      inp.addEventListener('change', async () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        if (o.onStart) o.onStart();
        try { o.onClip(await Mic.decodeFile(file)); }
        catch (e) { o.onError(e && e.name === 'EncodingError' ? WHY.EncodingError : 'Die Aufnahme konnte nicht gelesen werden.'); }
      });
      return inp;
    }
  };
  window.Mic = Mic;
})();
