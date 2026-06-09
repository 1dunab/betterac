// ===== Modul: GEO-PIN =======================================
  // ============================================================
  registerGame({ key: 'geoguess', label: '📍 Geo-Pin', min: 1, screen: function () {
    const PACKS = window.__GEO_PACKS__ || {};
    const HALF = { world: 1500, europe: 400, germany: 120 };
    let order = [], scores = {}, scope = 'world', cat = 'cities', rounds = 5, roundTime = 25;
    let targets = [], idx = 0, phase = 'guess', pins = {}, deadline = 0, revealAt = 0, tick = null, running = false;
    let mapView = window.GeoMap ? GeoMap.initialView() : { zoom: 1, panX: 0, panY: 0 };
    let mapCache = null, mapCacheKey = '';

    function haversine(a, b) {
      const R = 6371, k = Math.PI / 180;
      const dLat = (b.lat - a.lat) * k, dLng = (b.lng - a.lng) * k, la1 = a.lat * k, la2 = b.lat * k;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    const scoreFor = (d) => Math.round(5000 * Math.exp(-d / HALF[scope]));
    function mapRect() { return GeoMap.rect(cv, scope, mapView); }
    const project = (lng, lat, R) => GeoMap.project(lng, lat, R);
    function drawMap(R) {
      const key = scope + ':' + cv.width + 'x' + cv.height + ':' + mapView.zoom + ':' + mapView.panX + ':' + mapView.panY;
      if (!mapCache || mapCacheKey !== key) {
        mapCache = document.createElement('canvas');
        mapCache.width = cv.width; mapCache.height = cv.height;
        GeoMap.drawBase(mapCache.getContext('2d'), mapCache, scope, mapView);
        mapCacheKey = key;
      }
      ctx.drawImage(mapCache, 0, 0);
      ctx.strokeStyle = '#4a5a73'; ctx.lineWidth = 2; ctx.strokeRect(R.x, R.y, R.w, R.h);
    }

    function startRound() {
      phase = 'guess'; pins = {}; const t = targets[idx]; deadline = performance.now() + roundTime * 1000;
      order.forEach(id => { if (players[id]) ac.message(id, { t: 'geoStart', scope, name: t.n, ms: roundTime * 1000 }); });
    }
    function reveal() {
      if (phase !== 'guess') return; phase = 'reveal'; const t = targets[idx];
      order.forEach(id => {
        const p = pins[id]; let dist = null, pts = 0;
        if (p) { dist = haversine({ lat: p.lat, lng: p.lng }, { lat: t.y, lng: t.x }); pts = scoreFor(dist); }
        scores[id] = (scores[id] || 0) + pts;
        if (players[id]) ac.message(id, { t: 'geoReveal', dist: dist === null ? null : Math.round(dist), points: pts, total: scores[id], lat: t.y, lng: t.x });
      });
      revealAt = performance.now() + 6000;
    }
    function next() {
      if (idx + 1 < targets.length) { idx++; startRound(); }
      else { phase = 'done'; order.forEach(id => { if (players[id]) ac.message(id, { t: 'geoDone' }); }); }
    }

    return {
      acceptsJoin: true,
      start(idList, settings) {
        running = true; const s = settings || {};
        scope = s.scope || 'world'; cat = s.category || 'cities'; rounds = s.rounds || 5; roundTime = s.roundTime || 25;
        mapView = GeoMap.initialView(); mapCache = null; mapCacheKey = '';
        order = idList.slice(); scores = {}; order.forEach(id => scores[id] = 0);
        const pack = PACKS[scope] || PACKS.world || {};
        const pool = (pack[cat] || pack.cities || []).slice();
        if (!pool.length) { endToLobby('Geo-Pin hat keine Kartendaten gefunden.'); return; }
        targets = shuffle(pool).slice(0, Math.min(rounds, pool.length)); idx = 0;
        startRound();
        tick = setInterval(() => { const now = performance.now(); if (phase === 'guess' && now >= deadline) reveal(); else if (phase === 'reveal' && now >= revealAt) next(); }, 200);
      },
      stop() { if (tick) { clearInterval(tick); tick = null; } running = false; },
      onConnect(id) { if (!order.includes(id)) order.push(id); if (scores[id] === undefined) scores[id] = 0; if (phase === 'guess' && players[id] && targets[idx]) { const t = targets[idx]; ac.message(id, { t: 'geoStart', scope, name: t.n, ms: Math.max(3000, deadline - performance.now()) }); } },
      onDisconnect(id) { delete pins[id]; order = order.filter(o => o !== id); if (order.length === 0) endToLobby(''); },
      onMessage(id, d) {
        if (!d || !d.t) return;
        if (d.t === 'pin' && phase === 'guess' && order.includes(id)) { pins[id] = { lat: +d.lat, lng: +d.lng }; if (order.every(o => pins[o])) reveal(); }
      },
      render() {
        ctx.fillStyle = '#0d0d1a'; ctx.fillRect(0, 0, cv.width, cv.height);
        if (phase === 'done') {
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = '#ffd60a'; ctx.font = 'bold 40px system-ui,sans-serif'; ctx.fillText('🏆 Endstand', cv.width / 2, 64);
          const rank = order.slice().sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
          ctx.font = 'bold 26px system-ui,sans-serif';
          rank.forEach((id, i) => { const y = 130 + i * 42; ctx.textAlign = 'left'; ctx.fillStyle = players[id] ? players[id].color : '#888'; ctx.beginPath(); ctx.arc(cv.width / 2 - 170, y, 12, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#eee'; ctx.fillText((i + 1) + '. ' + nameOf(id), cv.width / 2 - 150, y); ctx.textAlign = 'right'; ctx.fillStyle = '#bbb'; ctx.fillText((scores[id] || 0) + ' Pkt', cv.width / 2 + 190, y); });
          ctx.textAlign = 'center'; ctx.fillStyle = '#777'; ctx.font = '16px system-ui,sans-serif'; ctx.fillText('Host bricht ab für neue Runde', cv.width / 2, cv.height - 36);
          return;
        }
        const R = mapRect(); drawMap(R); const t = targets[idx];
        if (!t) {
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = '#fff'; ctx.font = 'bold 28px system-ui,sans-serif';
          ctx.fillText('Geo-Pin lädt...', cv.width / 2, 48);
          return;
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = phase === 'guess' ? '#ffd60a' : '#30d158'; ctx.font = 'bold 30px system-ui,sans-serif';
        ctx.fillText(phase === 'guess' ? ('📍 Wo liegt: ' + t.n + ' ?') : ('✅ ' + t.n), 20, 32);
        ctx.textAlign = 'right'; ctx.fillStyle = '#aaa'; ctx.font = '18px system-ui,sans-serif'; ctx.fillText('Runde ' + (idx + 1) + ' / ' + targets.length, cv.width - 20, 32);
        if (phase === 'guess') {
          const secs = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
          ctx.textAlign = 'right'; ctx.fillStyle = secs <= 5 ? '#ff453a' : '#fff'; ctx.font = 'bold 24px system-ui,sans-serif'; ctx.fillText(secs + 's', cv.width - 20, 64);
          ctx.textAlign = 'left'; let cx = 20; order.forEach(id => { ctx.globalAlpha = pins[id] ? 1 : 0.35; ctx.fillStyle = players[id] ? players[id].color : '#888'; ctx.beginPath(); ctx.arc(cx + 8, 64, 8, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; cx += 22; });
        } else {
          const tp = project(t.x, t.y, R);
          order.forEach(id => { const p = pins[id]; if (!p) return; const pp = project(p.lng, p.lat, R); ctx.strokeStyle = players[id] ? players[id].color : '#888'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(pp[0], pp[1]); ctx.lineTo(tp[0], tp[1]); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = players[id] ? players[id].color : '#888'; ctx.beginPath(); ctx.arc(pp[0], pp[1], 6, 0, Math.PI * 2); ctx.fill(); });
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff453a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(tp[0], tp[1], 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#ff453a'; ctx.beginPath(); ctx.arc(tp[0], tp[1], 3, 0, Math.PI * 2); ctx.fill();
          const secs = Math.max(0, Math.ceil((revealAt - performance.now()) / 1000));
          ctx.textAlign = 'right'; ctx.fillStyle = '#888'; ctx.font = '15px system-ui,sans-serif'; ctx.fillText('Nächste Runde in ' + secs + 's', cv.width - 20, 64);
          const rank = order.slice().sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
          ctx.textAlign = 'left'; ctx.font = '15px system-ui,sans-serif'; ctx.textBaseline = 'bottom';
          rank.slice(0, 6).forEach((id, i) => { ctx.fillStyle = players[id] ? players[id].color : '#888'; ctx.fillText(shortName(id) + ': ' + (scores[id] || 0), 20 + (i % 3) * 150, cv.height - 14 - Math.floor(i / 3) * 20); });
        }
      }
    };
  }});
