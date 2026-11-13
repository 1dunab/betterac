// Party Hub Foto-Knopf: holt ein Foto vom Handy in die Seite — über die Kamera-App, nicht über die Live-Kamera.
// Die Live-Kamera (getUserMedia) gibt der Browser nur über https frei; ein Datei-Feld mit `capture` geht auch
// im Heim-WLAN über http. Nur auf der Controller-Seite geladen.
//
// API:
//   Snap.bind(button, { facing, onStart, onPhoto, onError })   Knopf öffnet die Kamera-App; onPhoto({ url, w, h })
//   Snap.shrink(file, max, quality)                            Bild verkleinern → { url (JPEG-Daten-URL), w, h }
(function () {
  'use strict';
  const Snap = {
    MAX: 720,          // längste Seite in Pixeln: scharf genug für den Fernseher, klein genug für eine Nachricht
    QUALITY: 0.72,     // JPEG; ein Foto wiegt damit etwa 30 bis 100 KB

    async shrink(file, max, quality) {
      let src = null;
      // dreht Hochkant-Fotos richtig herum; ältere Browser kennen die Option nicht und nehmen den <img>-Weg
      if (window.createImageBitmap) { try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = null; } }
      if (!src) src = await new Promise((ok, no) => {
        const im = new Image();
        im.onload = () => ok(im); im.onerror = () => no(new Error('Das Foto konnte nicht gelesen werden.'));
        im.src = URL.createObjectURL(file);
      });
      const k = Math.min(1, (max || Snap.MAX) / Math.max(src.width, src.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      return { url: c.toDataURL('image/jpeg', quality || Snap.QUALITY), w: c.width, h: c.height };
    },

    bind(button, o) {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', o.facing || 'environment');
      // nicht display:none — manche Handys öffnen die Kamera dann nicht
      inp.style.cssText = 'position:absolute; left:0; top:0; width:1px; height:1px; opacity:0; pointer-events:none;';
      document.body.appendChild(inp);
      button.addEventListener('click', () => { inp.value = ''; inp.click(); });
      inp.addEventListener('change', async () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        if (o.onStart) o.onStart();
        try { o.onPhoto(await Snap.shrink(file, o.max, o.quality)); }
        catch (e) { if (o.onError) o.onError((e && e.message) || 'Das Foto konnte nicht gelesen werden.'); }
      });
      return inp;
    }
  };
  window.Snap = Snap;
})();
