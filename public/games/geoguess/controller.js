// ============ Controller-Modul: GEO-PIN ============
// Injiziert seine Views selbst — controller.html muss nur das Skript einbinden.
(function () {
  document.body.insertAdjacentHTML('beforeend', `
<style>
  #geoMap { background:#0e1726; margin:0 10px; border-radius:10px; flex:1; min-height:320px; }
</style>
<!-- GEO-PIN -->
<div id="v-geo" class="view">
  <div class="bar"><span class="word">📍 <span id="geoTarget">Geo-Pin</span></span><span id="geoTimer" class="timer">–</span></div>
  <canvas id="geoMap" width="600" height="700"></canvas>
  <div class="tools" style="justify-content:center">
    <button id="geoSubmit" class="btn go">Pin setzen</button>
  </div>
  <div id="geoStatus" class="muted" style="text-align:center; padding:0 16px 14px">Tippe auf die Karte.</div>
</div>`);
  VIEWS.push('geo');

  const geoCanvas = $('geoMap'), geoCtx = geoCanvas.getContext('2d');
  let geoScope = 'world', geoPin = null, geoSent = false, geoActive = false, geoView = GeoMap.initialView();
  let geoDrag = null, geoPinch = null;
  const geoPoint = (e) => {
    const r = geoCanvas.getBoundingClientRect(), t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) / r.width * geoCanvas.width, y: (t.clientY - r.top) / r.height * geoCanvas.height };
  };
  const touchPoint = (touch) => {
    const r = geoCanvas.getBoundingClientRect();
    return { x: (touch.clientX - r.left) / r.width * geoCanvas.width, y: (touch.clientY - r.top) / r.height * geoCanvas.height };
  };
  const touchDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function geoRect() { return GeoMap.rect(geoCanvas, geoScope, geoView); }
  function geoProject(lng, lat, R) { return GeoMap.project(lng, lat, R); }
  function geoUnproject(x, y, R) { return GeoMap.unproject(x, y, R); }
  function renderGeoMap(actual) {
    const R = GeoMap.drawBase(geoCtx, geoCanvas, geoScope, geoView);
    geoCtx.strokeStyle = '#60708c'; geoCtx.lineWidth = 2; geoCtx.strokeRect(R.x, R.y, R.w, R.h);
    if (geoPin) { const p = geoProject(geoPin.lng, geoPin.lat, R); geoCtx.fillStyle = '#ffd60a'; geoCtx.beginPath(); geoCtx.arc(p[0], p[1], 10, 0, Math.PI * 2); geoCtx.fill(); }
    if (actual) { const p = geoProject(actual.lng, actual.lat, R); geoCtx.strokeStyle = '#ff453a'; geoCtx.fillStyle = '#fff'; geoCtx.lineWidth = 3; geoCtx.beginPath(); geoCtx.arc(p[0], p[1], 10, 0, Math.PI * 2); geoCtx.fill(); geoCtx.stroke(); }
  }
  function submitGeoPin() {
    if (geoSent) return;
    geoSent = true; stopTimer();
    if (geoPin) ac.message(AirConsole.SCREEN, { t: 'pin', lat: geoPin.lat, lng: geoPin.lng });
    $('geoSubmit').disabled = true; $('geoSubmit').style.opacity = 0.5; $('geoStatus').textContent = 'Warte auf die Auswertung...';
  }
  function setGeoPinAt(p) {
    if (!geoActive || geoSent) return;
    const R = geoRect();
    if (p.x < R.x || p.y < R.y || p.x > R.x + R.w || p.y > R.y + R.h) return;
    geoPin = geoUnproject(p.x, p.y, R); $('geoStatus').textContent = 'Pin gesetzt. Du kannst ihn bis Ablauf noch verschieben.'; renderGeoMap();
  }
  function geoStartDrag(p) { geoDrag = { sx: p.x, sy: p.y, x: p.x, y: p.y, panX: geoView.panX, panY: geoView.panY, moved: false }; }
  function geoMoveDrag(p) {
    if (!geoDrag || !geoActive || geoSent) return;
    const dx = p.x - geoDrag.x, dy = p.y - geoDrag.y;
    geoDrag.moved = geoDrag.moved || Math.hypot(p.x - geoDrag.sx, p.y - geoDrag.sy) > 9;
    geoView.panX += dx; geoView.panY += dy; geoDrag.x = p.x; geoDrag.y = p.y;
    GeoMap.clampView(geoView); renderGeoMap();
  }
  geoCanvas.addEventListener('mousedown', e => { if (!geoActive || geoSent) return; e.preventDefault(); geoStartDrag(geoPoint(e)); });
  window.addEventListener('mousemove', e => { if (geoDrag) { e.preventDefault(); geoMoveDrag(geoPoint(e)); } });
  window.addEventListener('mouseup', e => { if (!geoDrag) return; const d = geoDrag; geoDrag = null; if (!d.moved) setGeoPinAt(geoPoint(e)); });
  geoCanvas.addEventListener('touchstart', e => {
    if (!geoActive || geoSent) return; e.preventDefault();
    if (e.touches.length >= 2) {
      const a = touchPoint(e.touches[0]), b = touchPoint(e.touches[1]);
      geoPinch = { dist: touchDist(a, b), zoom: geoView.zoom, panX: geoView.panX, panY: geoView.panY, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      geoDrag = null;
    } else geoStartDrag(geoPoint(e));
  });
  geoCanvas.addEventListener('touchmove', e => {
    if (!geoActive || geoSent) return; e.preventDefault();
    if (e.touches.length >= 2 && geoPinch) {
      const a = touchPoint(e.touches[0]), b = touchPoint(e.touches[1]), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nextZoom = geoPinch.zoom * (touchDist(a, b) / Math.max(1, geoPinch.dist));
      geoView.zoom = nextZoom;
      geoView.panX = geoPinch.panX + (mid.x - geoPinch.mid.x);
      geoView.panY = geoPinch.panY + (mid.y - geoPinch.mid.y);
      GeoMap.clampView(geoView); renderGeoMap();
    } else if (e.touches.length === 1) geoMoveDrag(geoPoint(e));
  });
  geoCanvas.addEventListener('touchend', e => {
    if (geoPinch && e.touches.length < 2) geoPinch = null;
    if (!geoDrag) return;
    const d = geoDrag; geoDrag = null;
    if (!d.moved && e.changedTouches && e.changedTouches[0]) setGeoPinAt(touchPoint(e.changedTouches[0]));
  });
  $('geoSubmit').addEventListener('click', submitGeoPin);
  const GEOc = {
    activate() { geoActive = false; geoPin = null; geoSent = false; geoView = GeoMap.initialView(); showView('geo'); renderGeoMap(); },
    onMessage(d) {
      if (d.t === 'geoStart') {
        geoScope = d.scope || 'world'; geoPin = null; geoSent = false; geoActive = true; geoView = GeoMap.initialView();
        $('geoTarget').textContent = d.name; $('geoSubmit').disabled = false; $('geoSubmit').style.opacity = 1; $('geoStatus').textContent = 'Tippe zum Setzen, ziehe zum Verschieben, zoome mit zwei Fingern.';
        showView('geo'); renderGeoMap(); startTimer(d.ms, $('geoTimer'), submitGeoPin);
      } else if (d.t === 'geoReveal') {
        geoActive = false; stopTimer(); renderGeoMap({ lat: d.lat, lng: d.lng });
        $('geoTimer').textContent = '-';
        $('geoStatus').textContent = d.dist === null ? 'Kein Pin gesetzt. Gesamt: ' + d.total + ' Punkte' : d.dist + ' km daneben, +' + d.points + ' Punkte. Gesamt: ' + d.total;
      } else if (d.t === 'geoDone') {
        geoActive = false; stopTimer(); $('geoTarget').textContent = 'Endstand'; $('geoStatus').textContent = 'Schaut auf den großen Bildschirm.'; renderGeoMap();
      }
    }
  };

  registerGame({ key: 'geoguess', label: '📍 Geo-Pin', min: 1, controller: GEOc });
})();
