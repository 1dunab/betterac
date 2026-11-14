// ===== Würfelverlies — the art: monster portraits painted in code, crest glyphs (see docs/VERLIES.md) =====
// Loaded by the screen and the phones. Everything is drawn here, no picture files.
//   VerliesArt.portrait(key, px)  → a cached px×px canvas with the monster's portrait (background included)
//   VerliesArt.crestPath[type]    → SVG path data (viewBox 0 0 24 24) of a crest glyph; crestSVG(type, size) → markup
//   VerliesArt.drawCrest(g, type, x, y, size, color?)
(function (root) {
  const D = root.VerliesData;

  // ---------- colour helpers ----------
  function rgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { const x = rgb(a), y = rgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
  const lit = (c, t) => mix(c, '#ffffff', t), drk = (c, t) => mix(c, '#000000', t);
  function rgba(c, a) { const x = rgb(c); return 'rgba(' + x[0] + ',' + x[1] + ',' + x[2] + ',' + a + ')'; }

  // ---------- crest glyphs ----------
  const crestPath = {
    SUM: 'M12 1.8l2.9 6.4 7 .7-5.3 4.7 1.6 6.9L12 16.9l-6.2 3.6 1.6-6.9L2.1 8.9l7-.7z',
    MOV: 'M3.5 5h4.2l6.6 7-6.6 7H3.5l6.6-7zm7.8 0h4.2l6.6 7-6.6 7h-4.2l6.6-7z',
    ATK: 'M21.5 2.5v4.2L11.2 17l-4.2-4.2L17.3 2.5zM3.2 13.2l1.5-1.5 7.6 7.6-1.5 1.5-1.9-1.9-3.4 3.4-2.3-2.3 3.4-3.4z',
    DEF: 'M12 1.8l8.6 3.3v6.2c0 5.4-3.6 9.6-8.6 11.2-5-1.6-8.6-5.8-8.6-11.2V5.1zm0 3.1v14.9c3.4-1.4 5.6-4.6 5.6-8.5V7.1z',
    MAG: 'M12 1.5l2.3 7.2 7.2 2.3-7.2 2.3L12 20.5l-2.3-7.2-7.2-2.3 7.2-2.3zM19.5 16l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z',
    TRP: 'M1.8 9.5l3 3.6 2.4-3.6 2.4 3.6L12 9.5l2.4 3.6 2.4-3.6 2.4 3.6 3-3.6v2.2c0 5.6-4.6 9.8-10.2 9.8S1.8 17.3 1.8 11.7zM12 2.5c4.4 0 8.2 2.4 9.6 6l-2.3 1.6C18 7.4 15.2 5.6 12 5.6S6 7.4 4.7 10.1L2.4 8.5C3.8 4.9 7.6 2.5 12 2.5z'
  };
  const P2D = {};
  function drawCrest(g, type, x, y, size, color) {
    const c = color || (D.CREST[type] || {}).color || '#fff';
    g.save(); g.translate(x - size / 2, y - size / 2); g.scale(size / 24, size / 24);
    if (typeof Path2D === 'function') {
      const p = P2D[type] || (P2D[type] = new Path2D(crestPath[type]));
      g.fillStyle = c; g.fill(p);
    } else { g.fillStyle = c; g.beginPath(); g.arc(12, 12, 9, 0, 6.283); g.fill(); }
    g.restore();
  }
  const crestSVG = (type, size, color) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" style="display:inline-block;vertical-align:middle"><path fill="' + (color || D.CREST[type].color) + '" d="' + crestPath[type] + '"/></svg>';

  // ---------- painter kit (100×100 units) ----------
  function kit(g) {
    const k = {
      ell(x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2); },
      poly(pts) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); },
      // a closed smooth curve through the points
      blob(pts) {
        g.beginPath();
        const n = pts.length, m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        let s = m(pts[n - 1], pts[0]); g.moveTo(s[0], s[1]);
        for (let i = 0; i < n; i++) { const e = m(pts[i], pts[(i + 1) % n]); g.quadraticCurveTo(pts[i][0], pts[i][1], e[0], e[1]); }
        g.closePath();
      },
      // fill the current path with a lit volume and an outline
      shade(base, cx, cy, r, o) {
        o = o || {};
        const gr = g.createRadialGradient(cx - r * 0.38, cy - r * 0.45, r * 0.08, cx, cy, r * 1.25);
        gr.addColorStop(0, lit(base, o.hi == null ? 0.45 : o.hi)); gr.addColorStop(0.45, base); gr.addColorStop(1, drk(base, o.lo == null ? 0.55 : o.lo));
        g.fillStyle = gr; g.fill();
        if (o.line !== false) { g.lineJoin = 'round'; g.lineWidth = o.lw || 2.2; g.strokeStyle = o.line || drk(base, 0.72); g.stroke(); }
      },
      flat(c, line, lw) { g.fillStyle = c; g.fill(); if (line) { g.lineJoin = 'round'; g.lineWidth = lw || 2; g.strokeStyle = line; g.stroke(); } },
      glow(x, y, r, c, a) {
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgba(c, a == null ? 0.7 : a)); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      },
      // style: glow (bright iris + pupil), slit (cat pupil), socket (dark hole, glowing spark), dot (small shiny bead)
      eye(x, y, r, c, style, tilt) {
        if (style === 'socket') {
          k.ell(x, y, r * 1.25, r, tilt || 0); g.fillStyle = '#07060a'; g.fill();
          k.glow(x, y, r * 2.2, c, 0.55); k.ell(x, y, r * 0.42, r * 0.42); g.fillStyle = lit(c, 0.5); g.fill();
          return;
        }
        if (style === 'dot') { k.ell(x, y, r, r); g.fillStyle = '#0b0a10'; g.fill(); k.ell(x - r * 0.35, y - r * 0.35, r * 0.35, r * 0.35); g.fillStyle = '#fff'; g.fill(); return; }
        k.glow(x, y, r * 2.4, c, 0.45);
        k.ell(x, y, r * 1.15, r * (style === 'slit' ? 0.8 : 1), tilt || 0); g.fillStyle = lit(c, 0.25); g.fill();
        g.lineWidth = 1.2; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
        if (style === 'slit') { k.ell(x, y, r * 0.22, r * 0.78, tilt || 0); } else k.ell(x, y + r * 0.08, r * 0.5, r * 0.55);
        g.fillStyle = '#120d14'; g.fill();
        k.ell(x - r * 0.4, y - r * 0.4, r * 0.28, r * 0.25); g.fillStyle = 'rgba(255,255,255,.9)'; g.fill();
      },
      eyes(xs, y, r, c, style, tilt) { xs.forEach((x, i) => k.eye(x, y, r, c, style, tilt ? (i ? -tilt : tilt) : 0)); },
      fang(x, y, w, h, dir) { k.poly([[x - w / 2, y], [x + w / 2, y], [x, y + h * (dir || 1)]]); k.flat('#fbf6e8', 'rgba(40,20,10,.7)', 1); },
      horn(x, y, len, w, ang, bend, c) {
        // a curved horn from (x,y) pointing at ang (radians), bending by `bend`
        const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        const mx = (x + ex) / 2 + nx * bend, my = (y + ey) / 2 + ny * bend;
        g.beginPath(); g.moveTo(x - nx * w, y - ny * w);
        g.quadraticCurveTo(mx - nx * w * 0.5, my - ny * w * 0.5, ex, ey);
        g.quadraticCurveTo(mx + nx * w * 0.5, my + ny * w * 0.5, x + nx * w, y + ny * w); g.closePath();
        k.shade(c, mx, my, len * 0.6, { lw: 1.6 });
      },
      line(pts, c, w) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); },
      curve(a, c1, b, col, w) { g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo(c1[0], c1[1], b[0], b[1]); g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.stroke(); },
      mouthLine(x1, x2, y, sag, c, w) { k.curve([x1, y], [(x1 + x2) / 2, y + sag], [x2, y], c || 'rgba(20,8,8,.85)', w || 2); },
      grin(cx, y, w, h, teeth) {
        g.beginPath(); g.moveTo(cx - w, y); g.quadraticCurveTo(cx, y + h * 2, cx + w, y); g.quadraticCurveTo(cx, y + h * 0.7, cx - w, y); g.closePath();
        g.fillStyle = '#2a0c0c'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke();
        for (let i = 0; i < (teeth || 0); i++) { const t = (i + 0.5) / teeth, tx = cx - w * 0.8 + t * w * 1.6; k.fang(tx, y + h * 0.55 - Math.abs(t - 0.5) * h * 0.5, w * 0.22, h * 0.7); }
      }
    };
    return k;
  }

  // ---------- backgrounds and effects ----------
  const THEME = {
    glut: ['#5a1a0e', '#1c0805', '#ff8a3d'], wild: ['#1f4a1a', '#081407', '#9be36a'],
    gebein: ['#3a2850', '#100a18', '#c8a8ff'], tiefe: ['#0f3e5a', '#04121c', '#6fe6ff'], item: ['#2b3140', '#0b0d14', '#d8e6ff']
  };
  function seeded(seed) { let s = seed | 0 || 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
  function background(g, k, theme, seed) {
    const t = THEME[theme] || THEME.item;
    const gr = g.createRadialGradient(50, 42, 4, 50, 50, 74);
    gr.addColorStop(0, t[0]); gr.addColorStop(1, t[1]);
    g.fillStyle = gr; g.fillRect(0, 0, 100, 100);
    k.glow(50, 48, 46, t[2], 0.16);
  }
  function effects(g, k, fx, theme, seed, front) {
    const r = seeded(seed + (front ? 99 : 0)), t = THEME[theme] || THEME.item;
    if (fx === 'sparks' || fx === 'embers') {
      for (let i = 0; i < (front ? 7 : 14); i++) {
        const x = r() * 100, y = 20 + r() * 80, s = 0.6 + r() * (fx === 'sparks' ? 1.6 : 1.1);
        k.glow(x, y, s * 4, '#ff9a3a', 0.6); k.ell(x, y, s * 0.7, s * 0.7); g.fillStyle = '#fff1b0'; g.fill();
      }
    } else if (fx === 'flames' && !front) {
      for (let i = 0; i < 9; i++) {
        const x = 4 + i * 11.5 + r() * 4, h = 22 + r() * 26, w = 8 + r() * 5;
        g.beginPath(); g.moveTo(x - w, 100); g.quadraticCurveTo(x - w * 0.6, 100 - h * 0.6, x + r() * 6 - 3, 100 - h); g.quadraticCurveTo(x + w * 0.7, 100 - h * 0.5, x + w, 100); g.closePath();
        const fg = g.createLinearGradient(0, 100 - h, 0, 100); fg.addColorStop(0, 'rgba(255,220,90,0)'); fg.addColorStop(0.5, 'rgba(255,120,30,.55)'); fg.addColorStop(1, 'rgba(200,30,10,.8)');
        g.fillStyle = fg; g.fill();
      }
    } else if (fx === 'leaves') {
      for (let i = 0; i < (front ? 4 : 9); i++) {
        const x = r() * 100, y = r() * 100, a = r() * 6.28, s = 2.5 + r() * 3;
        k.ell(x, y, s, s * 0.45, a); g.fillStyle = rgba(i % 2 ? '#8fd85a' : '#5aa83a', front ? 0.9 : 0.55); g.fill();
      }
    } else if (fx === 'motes') {
      for (let i = 0; i < (front ? 6 : 12); i++) { const x = r() * 100, y = r() * 100; k.glow(x, y, 3 + r() * 4, t[2], 0.55); }
    } else if (fx === 'wisps' && !front) {
      for (let i = 0; i < 5; i++) {
        const y = 15 + r() * 75, x = r() * 30;
        k.curve([x, y], [x + 25 + r() * 20, y - 18 + r() * 10], [x + 60 + r() * 30, y + r() * 10 - 5], rgba(t[2], 0.18), 3 + r() * 3);
      }
    } else if (fx === 'bubbles') {
      for (let i = 0; i < (front ? 5 : 10); i++) {
        const x = r() * 100, y = r() * 100, s = 1.2 + r() * 3.2;
        k.ell(x, y, s, s); g.strokeStyle = rgba('#bff6ff', 0.55); g.lineWidth = 0.8; g.stroke();
        k.ell(x - s * 0.35, y - s * 0.35, s * 0.25, s * 0.25); g.fillStyle = 'rgba(255,255,255,.7)'; g.fill();
      }
    } else if (fx === 'web' && !front) {
      g.strokeStyle = 'rgba(230,220,255,.22)'; g.lineWidth = 0.7;
      for (let a = 0; a < 6; a++) k.line([[100, 0], [100 - Math.cos(a * 0.3) * 50, Math.sin(a * 0.3) * 50]], 'rgba(230,220,255,.22)', 0.7);
      for (let ring = 1; ring <= 4; ring++) { g.beginPath(); g.arc(100, 0, ring * 11, Math.PI * 0.5, Math.PI); g.stroke(); }
    } else if (fx === 'dust') {
      for (let i = 0; i < (front ? 5 : 12); i++) { const x = r() * 100, y = 50 + r() * 50; k.ell(x, y, 0.8 + r() * 1.4, 0.8 + r()); g.fillStyle = 'rgba(200,170,150,.45)'; g.fill(); }
    }
  }

  // ---------- the heads ----------
  // each paints the creature on the 100×100 board; a = the monster's art parameters
  const HEAD = {
    imp(g, k, a) {
      k.horn(36, 30, 14, 3.4, -2.0, -4, '#3a1a10'); k.horn(64, 30, 14, 3.4, -1.14, 4, '#3a1a10');
      k.poly([[27, 50], [6, 36], [24, 62]]); k.shade(a.skin, 18, 50, 14);
      k.poly([[73, 50], [94, 36], [76, 62]]); k.shade(a.skin, 82, 50, 14);
      k.blob([[50, 24], [74, 34], [78, 58], [64, 78], [50, 82], [36, 78], [22, 58], [26, 34]]); k.shade(a.skin, 50, 54, 30);
      k.eyes([39, 61], 50, 7, a.eye, 'slit', 0.25);
      k.curve([31, 40], [38, 36], [45, 42], drk(a.skin, 0.6), 2.4); k.curve([55, 42], [62, 36], [69, 40], drk(a.skin, 0.6), 2.4);
      k.grin(50, 64, 15, 6, 6);
    },
    beetle(g, k, a) {
      for (const s of [-1, 1]) { k.curve([50 + s * 8, 30], [50 + s * 22, 6], [50 + s * 34, 10], '#2a120c', 2.2); k.glow(50 + s * 34, 10, 4, '#ffb347', 0.8); }
      k.ell(50, 54, 36, 32); k.shade(a.skin, 50, 50, 36);
      k.line([[50, 22], [50, 86]], drk(a.skin, 0.75), 2.4);
      g.save(); k.ell(50, 54, 36, 32); g.clip();
      for (let i = 0; i < 6; i++) k.curve([20 + i * 12, 30 + (i % 2) * 10], [26 + i * 10, 52], [18 + i * 13, 80], rgba('#ff7a1a', 0.6), 1.4);
      g.restore();
      k.ell(50, 78, 18, 12); k.shade('#3a1a12', 50, 76, 16);
      k.eyes([42, 58], 76, 4, a.eye, 'glow');
      for (const s of [-1, 1]) { k.horn(50 + s * 8, 86, 12, 2.6, Math.PI / 2 + s * 0.6, -s * 5, '#2a120c'); }
    },
    hound(g, k, a) {
      for (let i = 0; i < 12; i++) { const ang = Math.PI * (0.95 + i * 0.1); k.horn(50, 52, 44, 6, ang, (i % 2 ? 6 : -6), i % 2 ? a.mane : lit(a.mane, 0.25)); }
      k.poly([[24, 40], [20, 8], [42, 28]]); k.shade(a.skin, 28, 26, 14); k.poly([[76, 40], [80, 8], [58, 28]]); k.shade(a.skin, 72, 26, 14);
      k.blob([[50, 22], [74, 30], [80, 52], [70, 70], [50, 74], [30, 70], [20, 52], [26, 30]]); k.shade(a.skin, 50, 48, 30);
      k.blob([[50, 56], [66, 62], [64, 82], [50, 90], [36, 82], [34, 62]]); k.shade(lit(a.skin, 0.2), 50, 70, 16);
      k.ell(50, 62, 7, 5); k.shade('#1a1416', 50, 61, 6, { line: false });
      k.eyes([37, 63], 44, 5.5, a.eye, 'glow', 0.2);
      k.mouthLine(38, 62, 78, 3, '#1a0a08', 2);
      k.fang(42, 78, 4, 8); k.fang(58, 78, 4, 8);
    },
    witch(g, k, a) {
      for (const s of [-1, 1]) {
        const hair = [[50 + s * 16, 34], [50 + s * 30, 50], [50 + s * 27, 94], [50 + s * 20, 84], [50 + s * 13, 92], [50 + s * 12, 52]];
        k.blob(hair); k.shade(a.hair, 50 + s * 22, 60, 24, { lo: 0.45 });
        g.save(); k.blob(hair); g.clip();
        for (let i = 0; i < 6; i++) k.curve([50 + s * (13 + i * 3), 36], [50 + s * (22 + i * 2.5), 62], [50 + s * (12 + i * 3.4), 96], rgba(drk(a.hair, 0.45), 0.55), 1.1);
        g.restore();
      }
      k.blob([[50, 30], [66, 40], [66, 64], [58, 80], [50, 83], [42, 80], [34, 64], [34, 40]]); k.shade(a.skin, 50, 56, 22);
      k.ell(50, 34, 40, 8); k.shade(a.hat, 50, 34, 34);
      k.poly([[30, 33], [52, 2], [62, 6], [70, 33]]); k.shade(a.hat, 52, 20, 22);
      k.line([[33, 30], [67, 30]], '#ff7a3d', 2.4);
      k.eyes([43, 57], 52, 4.2, a.eye, 'slit', 0.15);
      k.poly([[50, 54], [48, 66], [53, 65]]); k.flat(drk(a.skin, 0.2));
      k.curve([42, 72], [52, 76], [59, 70], '#5a1a1a', 2);
    },
    stone(g, k, a) {
      k.poly([[26, 22], [50, 12], [76, 22], [84, 50], [76, 82], [50, 92], [24, 82], [16, 50]]); k.shade(a.skin, 50, 50, 40, { hi: 0.25 });
      for (const c of [[[34, 18], [40, 34], [30, 46]], [[70, 26], [62, 40], [72, 58], [64, 70]], [[46, 72], [52, 82], [44, 92]], [[22, 60], [30, 66]]]) {
        k.line(c, rgba(a.cracks, 0.35), 5); k.line(c, a.cracks, 1.8);
      }
      k.poly([[24, 40], [48, 44], [48, 50], [24, 48]]); k.flat(drk(a.skin, 0.4)); k.poly([[76, 40], [52, 44], [52, 50], [76, 48]]); k.flat(drk(a.skin, 0.4));
      k.eye(36, 52, 5, a.eye, 'slit'); k.eye(64, 52, 5, a.eye, 'slit');
      k.line([[38, 74], [50, 78], [62, 74]], a.cracks, 2.4);
    },
    cat(g, k, a) {
      for (let i = 0; i < 16; i++) { const ang = i / 16 * Math.PI * 2; k.horn(50 + Math.cos(ang) * 8, 52 + Math.sin(ang) * 8, 44, 7, ang, i % 2 ? 7 : -7, i % 2 ? a.mane : '#ffb02e'); }
      k.ell(30, 28, 9, 9); k.shade(a.skin, 30, 28, 9); k.ell(70, 28, 9, 9); k.shade(a.skin, 70, 28, 9);
      k.blob([[50, 26], [72, 34], [76, 56], [64, 78], [50, 84], [36, 78], [24, 56], [28, 34]]); k.shade(a.skin, 50, 52, 30);
      k.ell(42, 68, 9, 7); k.shade(lit(a.skin, 0.35), 42, 66, 8, { line: false }); k.ell(58, 68, 9, 7); k.shade(lit(a.skin, 0.35), 58, 66, 8, { line: false });
      k.poly([[44, 58], [56, 58], [50, 65]]); k.flat('#3a1812');
      k.eyes([38, 62], 47, 5.5, a.eye, 'slit', 0.25);
      k.fang(45, 74, 3.5, 7); k.fang(55, 74, 3.5, 7);
    },
    dragon(g, k, a) {
      k.horn(36, 30, 30, 5, -2.2, -8, lit(a.crest, 0.2)); k.horn(64, 30, 30, 5, -0.94, 8, lit(a.crest, 0.2));
      for (let i = 0; i < 5; i++) k.horn(50, 26 + i * 2, 16 - i * 2, 3, -Math.PI / 2 + (i - 2) * 0.35, 0, a.crest);
      k.poly([[22, 46], [8, 40], [20, 56]]); k.shade(a.skin, 16, 48, 10);
      k.poly([[78, 46], [92, 40], [80, 56]]); k.shade(a.skin, 84, 48, 10);
      k.blob([[50, 22], [72, 30], [80, 50], [70, 66], [62, 88], [50, 94], [38, 88], [30, 66], [20, 50], [28, 30]]); k.shade(a.skin, 50, 52, 36);
      g.save(); k.blob([[50, 22], [72, 30], [80, 50], [70, 66], [62, 88], [50, 94], [38, 88], [30, 66], [20, 50], [28, 30]]); g.clip();
      for (let y = 30; y < 92; y += 7) for (let x = 24 + (y % 2) * 4; x < 80; x += 8) { k.ell(x, y, 3.2, 2.2); g.strokeStyle = rgba(drk(a.skin, 0.6), 0.5); g.lineWidth = 0.8; g.stroke(); }
      g.restore();
      k.poly([[30, 42], [46, 48], [44, 52], [30, 48]]); k.flat(drk(a.skin, 0.5)); k.poly([[70, 42], [54, 48], [56, 52], [70, 48]]); k.flat(drk(a.skin, 0.5));
      k.eye(38, 50, 5, a.eye, 'slit', 0.35); k.eye(62, 50, 5, a.eye, 'slit', -0.35);
      k.ell(44, 82, 2.4, 1.6); g.fillStyle = '#1a0606'; g.fill(); k.ell(56, 82, 2.4, 1.6); g.fill();
      k.mouthLine(36, 64, 72, 4, '#1a0606', 2.2);
      k.fang(40, 72, 3.5, 7); k.fang(60, 72, 3.5, 7); k.fang(45, 74, 2.5, 4.5); k.fang(55, 74, 2.5, 4.5);
    },
    blob(g, k, a) {
      k.blob([[50, 26], [74, 34], [84, 62], [74, 86], [50, 92], [26, 86], [16, 62], [26, 34]]); k.shade(a.skin, 50, 60, 36);
      g.save(); k.blob([[50, 26], [74, 34], [84, 62], [74, 86], [50, 92], [26, 86], [16, 62], [26, 34]]); g.clip();
      const r = seeded(11);
      for (let i = 0; i < 14; i++) { k.ell(14 + r() * 72, 28 + r() * 64, 3 + r() * 5, 2 + r() * 4); g.fillStyle = rgba(lit(a.skin, 0.35), 0.45); g.fill(); }
      g.restore();
      if (a.sprout) { k.curve([50, 28], [50, 18], [52, 12], '#3a6a22', 2.4); k.ell(43, 13, 8, 4, 0.4); k.shade('#8fd85a', 43, 13, 8); k.ell(59, 11, 8, 4, -0.5); k.shade('#8fd85a', 59, 11, 8); }
      k.eyes([38, 62], 56, 7.5, a.eye, 'dot');
      k.curve([42, 72], [50, 78], [58, 72], '#1f3a12', 2.4);
      k.ell(30, 68, 4.5, 2.5); g.fillStyle = 'rgba(255,140,160,.35)'; g.fill(); k.ell(70, 68, 4.5, 2.5); g.fill();
    },
    fox(g, k, a) {
      if (a.thorns) for (let i = 0; i < 10; i++) { const ang = Math.PI * (1.05 + i * 0.09); k.horn(50, 56, 42, 2.4, ang, 0, '#3f6a2a'); }
      k.poly([[22, 44], [14, 6], [44, 30]]); k.shade(a.skin, 26, 26, 16); k.poly([[78, 44], [86, 6], [56, 30]]); k.shade(a.skin, 74, 26, 16);
      k.poly([[24, 34], [20, 16], [36, 30]]); k.flat('#3a1a0c'); k.poly([[76, 34], [80, 16], [64, 30]]); k.flat('#3a1a0c');
      k.blob([[50, 26], [76, 34], [86, 56], [64, 74], [50, 92], [36, 74], [14, 56], [24, 34]]); k.shade(a.skin, 50, 52, 34);
      k.blob([[26, 58], [44, 66], [50, 90], [34, 74]]); k.flat('#fbf1e4'); k.blob([[74, 58], [56, 66], [50, 90], [66, 74]]); k.flat('#fbf1e4');
      k.ell(50, 86, 4.5, 3.5); k.shade('#1a1010', 50, 85, 4, { line: false });
      k.eyes([37, 63], 50, 5, a.eye, 'slit', 0.35);
      k.curve([44, 80], [50, 82], [56, 80], '#2a0a08', 1.6);
    },
    bear(g, k, a) {
      k.ell(26, 28, 11, 11); k.shade(a.skin, 26, 28, 11); k.ell(74, 28, 11, 11); k.shade(a.skin, 74, 28, 11);
      k.ell(26, 28, 5, 5); k.flat(drk(a.skin, 0.4)); k.ell(74, 28, 5, 5); k.flat(drk(a.skin, 0.4));
      k.blob([[50, 22], [76, 30], [84, 56], [72, 80], [50, 88], [28, 80], [16, 56], [24, 30]]); k.shade(a.skin, 50, 52, 36);
      if (a.bark) { g.save(); k.blob([[50, 22], [76, 30], [84, 56], [72, 80], [50, 88], [28, 80], [16, 56], [24, 30]]); g.clip(); for (let i = 0; i < 9; i++) k.curve([16 + i * 9, 22], [20 + i * 9, 50], [14 + i * 9.5, 88], rgba(drk(a.skin, 0.5), 0.45), 1.6); g.restore(); }
      k.ell(50, 68, 16, 13); k.shade(lit(a.skin, 0.35), 50, 66, 15);
      k.ell(50, 61, 6, 4.5); k.shade('#120a06', 50, 60, 5, { line: false });
      k.eyes([37, 63], 48, 4, a.eye, 'glow');
      k.mouthLine(42, 58, 74, 3, '#1a0a04', 2); k.fang(45, 74, 2.8, 5); k.fang(55, 74, 2.8, 5);
      for (const p of [[22, 70], [80, 64]]) { k.ell(p[0], p[1], 6, 3, 0.5); g.fillStyle = 'rgba(110,190,70,.85)'; g.fill(); }
    },
    fairy(g, k, a) {
      for (const s of [-1, 1]) {
        k.ell(50 + s * 30, 34, 22, 12, s * -0.6); g.fillStyle = rgba(a.wings, 0.35); g.fill(); g.strokeStyle = rgba(a.wings, 0.8); g.lineWidth = 1.2; g.stroke();
        k.ell(50 + s * 26, 64, 15, 8, s * 0.5); g.fillStyle = rgba(a.wings, 0.3); g.fill(); g.stroke();
      }
      k.blob([[50, 14], [72, 22], [80, 44], [72, 60], [50, 52], [28, 60], [20, 44], [28, 22]]); k.shade(a.hair, 50, 36, 30);
      k.blob([[50, 32], [64, 40], [66, 60], [50, 76], [34, 60], [36, 40]]); k.shade(a.skin, 50, 54, 20);
      k.blob([[34, 30], [50, 24], [66, 30], [60, 40], [50, 36], [40, 40]]); k.shade(a.hair, 50, 32, 16);
      k.eyes([43, 57], 54, 4.5, a.eye, 'glow');
      k.curve([45, 66], [50, 69], [55, 66], '#7a2a3a', 1.6);
      k.ell(38, 62, 3, 1.8); g.fillStyle = 'rgba(255,120,150,.4)'; g.fill(); k.ell(62, 62, 3, 1.8); g.fill();
      k.glow(50, 86, 10, '#fff8c0', 0.8);
    },
    stag(g, k, a) {
      const ant = (s) => {
        const c = '#e9d8b4';
        k.line([[50 + s * 10, 28], [50 + s * 24, 14], [50 + s * 30, 2]], c, 3.4);
        k.line([[50 + s * 18, 20], [50 + s * 12, 6]], c, 2.6); k.line([[50 + s * 24, 14], [50 + s * 38, 10]], c, 2.6);
        k.line([[50 + s * 28, 6], [50 + s * 40, -2]], c, 2.2);
      };
      ant(-1); ant(1);
      for (const s of [-1, 1]) { k.ell(50 + s * 23, 36, 10, 5, s * 0.5); k.shade(a.skin, 50 + s * 23, 36, 10); }
      k.blob([[50, 24], [66, 30], [68, 52], [60, 80], [50, 92], [40, 80], [32, 52], [34, 30]]); k.shade(a.skin, 50, 54, 30);
      k.blob([[42, 70], [58, 70], [56, 88], [50, 92], [44, 88]]); k.shade(lit(a.skin, 0.3), 50, 80, 10, { line: false });
      k.ell(50, 86, 4.5, 3); k.flat('#1a0e08');
      k.eyes([41, 59], 50, 4, a.eye, 'glow', 0.2);
      if (a.crown) for (let i = 0; i < 3; i++) k.glow(38 + i * 12, 22 - (i === 1 ? 3 : 0), 4, '#fff6b0', 0.9);
    },
    tree(g, k, a) {
      const r = seeded(5);
      for (let i = 0; i < 11; i++) { const x = 16 + r() * 68, y = 8 + r() * 24, s = 10 + r() * 8; k.ell(x, y, s, s * 0.8); k.shade(i % 2 ? a.leaves : lit(a.leaves, 0.2), x, y, s, { lw: 1.4 }); }
      k.poly([[28, 30], [72, 30], [78, 96], [22, 96]]); k.shade(a.skin, 50, 60, 38, { hi: 0.3 });
      g.save(); k.poly([[28, 30], [72, 30], [78, 96], [22, 96]]); g.clip();
      for (let i = 0; i < 7; i++) k.curve([26 + i * 8, 30], [30 + i * 7, 60], [24 + i * 9, 98], rgba(drk(a.skin, 0.55), 0.6), 1.8);
      g.restore();
      for (const x of [38, 62]) { k.ell(x, 52, 7, 6); g.fillStyle = '#0c0806'; g.fill(); k.glow(x, 52, 8, a.eye, 0.7); k.ell(x, 52, 2.6, 2.6); g.fillStyle = lit(a.eye, 0.5); g.fill(); }
      k.ell(50, 74, 8, 5); g.fillStyle = '#140c06'; g.fill();
      k.ell(66, 34, 6, 3, -0.3); g.fillStyle = a.leaves; g.fill();
    },
    griffin(g, k, a) {
      for (const s of [-1, 1]) for (let i = 0; i < 5; i++) k.horn(50 + s * 16, 56, 40 - i * 4, 5, (s < 0 ? Math.PI : 0) + s * (-0.6 + i * 0.28), s * 6, i % 2 ? a.wings : lit(a.wings, 0.2));
      for (let i = 0; i < 5; i++) k.horn(50, 30, 22 - i * 2, 4, -Math.PI / 2 + (i - 2) * 0.32, 0, a.crest);
      k.blob([[50, 20], [70, 28], [76, 50], [66, 68], [50, 74], [34, 68], [24, 50], [30, 28]]); k.shade(a.skin, 50, 46, 30);
      g.beginPath(); g.moveTo(38, 58); g.quadraticCurveTo(50, 50, 62, 58); g.quadraticCurveTo(64, 76, 50, 92); g.quadraticCurveTo(40, 76, 38, 58); g.closePath(); k.shade('#f2b23a', 50, 66, 18);
      k.curve([40, 66], [50, 70], [60, 66], '#7a4a10', 1.4);
      k.eyes([38, 62], 44, 5, a.eye, 'glow', 0.4);
      k.curve([30, 36], [38, 34], [46, 40], drk(a.skin, 0.6), 2.4); k.curve([54, 40], [62, 34], [70, 36], drk(a.skin, 0.6), 2.4);
    },
    rat(g, k, a) {
      k.ell(24, 30, 14, 14); k.shade(a.skin, 24, 30, 14); k.ell(76, 30, 14, 14); k.shade(a.skin, 76, 30, 14);
      k.ell(24, 30, 8, 8); k.flat('#e9a8b8'); k.ell(76, 30, 8, 8); k.flat('#e9a8b8');
      k.blob([[50, 28], [72, 38], [72, 58], [58, 80], [50, 92], [42, 80], [28, 58], [28, 38]]); k.shade(a.skin, 50, 56, 28);
      if (a.bony) { k.line([[50, 30], [50, 52]], drk(a.skin, 0.4), 1.6); for (let i = 0; i < 3; i++) k.line([[44, 36 + i * 6], [56, 36 + i * 6]], drk(a.skin, 0.35), 1.2); }
      k.ell(50, 88, 4.5, 3.5); k.flat('#e06a8a');
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.line([[50 + s * 6, 84], [50 + s * 26, 78 + i * 5]], 'rgba(255,255,255,.55)', 0.8);
      k.eye(40, 56, 4.5, a.eye, 'socket'); k.eye(60, 56, 4.5, a.eye, 'socket');
      k.poly([[46, 92], [54, 92], [53, 99], [47, 99]]); k.flat('#fff6dc', '#5a4a3a', 1);
    },
    worm(g, k, a) {
      for (let i = 6; i >= 0; i--) { const y = 96 - i * 10, x = 50 + Math.sin(i * 0.8) * 6; k.ell(x, y, 26 - i * 0.6, 10); k.shade(i % 2 ? a.skin : lit(a.skin, 0.12), x, y, 24, { lw: 1.6 }); }
      k.ell(52, 30, 24, 18); k.shade(a.skin, 52, 30, 24);
      k.ell(52, 34, 14, 10); g.fillStyle = '#2a0e1a'; g.fill();
      for (let i = 0; i < 10; i++) { const ang = i / 10 * Math.PI * 2, x = 52 + Math.cos(ang) * 12, y = 34 + Math.sin(ang) * 8.5; k.poly([[x, y], [x + Math.cos(ang + 1.8) * 2.4, y + Math.sin(ang + 1.8) * 2], [52 + Math.cos(ang) * 6, 34 + Math.sin(ang) * 4]]); k.flat('#fbf0e0'); }
      k.eyes([36, 68], 22, 3, a.eye, 'dot');
    },
    skull(g, k, a) {
      k.blob([[50, 16], [74, 24], [80, 48], [72, 66], [64, 86], [50, 90], [36, 86], [28, 66], [20, 48], [26, 24]]); k.shade(a.skin, 50, 48, 36, { hi: 0.3 });
      if (a.helm) { g.beginPath(); g.moveTo(18, 46); g.quadraticCurveTo(18, 8, 50, 8); g.quadraticCurveTo(82, 8, 82, 46); g.lineTo(74, 42); g.quadraticCurveTo(50, 28, 26, 42); g.closePath(); k.shade(a.helm, 50, 26, 34); k.poly([[47, 34], [53, 34], [52, 58], [48, 58]]); k.shade(a.helm, 50, 46, 8); for (const x of [30, 50, 70]) { k.ell(x, 16 + (x === 50 ? -3 : 3), 1.8, 1.8); g.fillStyle = lit(a.helm, 0.5); g.fill(); } }
      k.eye(37, 54, 7, a.eye, 'socket'); k.eye(63, 54, 7, a.eye, 'socket');
      k.poly([[50, 62], [46, 70], [54, 70]]); k.flat('#1a1612');
      k.poly([[36, 76], [64, 76], [62, 86], [38, 86]]); k.flat(drk(a.skin, 0.2), drk(a.skin, 0.6), 1.2);
      for (let i = 0; i < 6; i++) k.line([[39 + i * 4.4, 76], [39 + i * 4.4, 86]], drk(a.skin, 0.6), 1);
    },
    wisp(g, k, a) {
      k.glow(50, 52, 46, a.skin, 0.5);
      g.beginPath(); g.moveTo(50, 90); g.bezierCurveTo(20, 88, 18, 56, 34, 40); g.bezierCurveTo(40, 32, 36, 18, 46, 6); g.bezierCurveTo(48, 20, 58, 22, 60, 12); g.bezierCurveTo(70, 26, 62, 32, 70, 40); g.bezierCurveTo(84, 56, 80, 88, 50, 90); g.closePath();
      const gr = g.createRadialGradient(50, 64, 2, 50, 60, 40); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, lit(a.skin, 0.5)); gr.addColorStop(1, rgba(a.skin, 0.25));
      g.fillStyle = gr; g.fill();
      k.ell(41, 60, 4.5, 6); g.fillStyle = a.eye; g.fill(); k.ell(59, 60, 4.5, 6); g.fill();
      k.ell(50, 74, 3.5, 4.5); g.fill();
    },
    knight(g, k, a) {
      for (let i = 0; i < 7; i++) k.horn(50, 18, 30 - i, 5, -Math.PI / 2 - 0.9 + i * 0.12, -8, i % 2 ? a.plume : lit(a.plume, 0.2));
      k.poly([[10, 100], [18, 80], [82, 80], [90, 100]]); k.shade(drk(a.skin, 0.1), 50, 90, 40);
      g.beginPath(); g.moveTo(24, 86); g.lineTo(22, 40); g.quadraticCurveTo(24, 14, 50, 12); g.quadraticCurveTo(76, 14, 78, 40); g.lineTo(76, 86); g.quadraticCurveTo(50, 94, 24, 86); g.closePath(); k.shade(a.skin, 50, 46, 38, { hi: 0.55 });
      k.line([[50, 14], [50, 90]], lit(a.skin, 0.25), 1.6);
      k.poly([[26, 46], [74, 46], [74, 54], [26, 54]]); k.flat('#0a080c');
      k.glow(38, 50, 9, a.eye, 0.8); k.glow(62, 50, 9, a.eye, 0.8);
      k.ell(38, 50, 4, 1.8); g.fillStyle = lit(a.eye, 0.5); g.fill(); k.ell(62, 50, 4, 1.8); g.fill();
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { k.ell(58 + c * 4.5, 64 + r * 5, 1.1, 1.1); g.fillStyle = '#0a080c'; g.fill(); }
    },
    spider(g, k, a) {
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
        const y = 40 + i * 12, kx = 50 + s * (30 + i * 2), ky = y - 18 + i * 3;
        k.line([[50 + s * 14, y], [kx, ky], [50 + s * (44 + i * 2), y + 22]], drk(a.skin, 0.1), 4); k.line([[50 + s * 14, y], [kx, ky], [50 + s * (44 + i * 2), y + 22]], lit(a.skin, 0.2), 1.2);
      }
      k.ell(50, 78, 24, 20); k.shade(a.skin, 50, 76, 24);
      k.poly([[44, 70], [56, 70], [52, 84], [48, 84]]); k.flat('#ff4a8a');
      k.ell(50, 44, 20, 18); k.shade(lit(a.skin, 0.1), 50, 42, 20);
      k.eye(43, 44, 4.5, a.eye, 'glow'); k.eye(57, 44, 4.5, a.eye, 'glow');
      for (const p of [[36, 36], [64, 36], [40, 30], [60, 30], [46, 28], [54, 28]]) { k.ell(p[0], p[1], 1.8, 1.8); g.fillStyle = a.eye; g.fill(); }
      k.horn(45, 56, 10, 2.4, Math.PI / 2 + 0.3, 3, '#1a0e1e'); k.horn(55, 56, 10, 2.4, Math.PI / 2 - 0.3, -3, '#1a0e1e');
      if (a.crown) { k.poly([[38, 22], [42, 12], [46, 20], [50, 8], [54, 20], [58, 12], [62, 22]]); k.shade('#e0b84a', 50, 16, 12, { lw: 1.4 }); }
    },
    lich(g, k, a) {
      k.poly([[8, 100], [20, 46], [50, 14], [80, 46], [92, 100]]); k.shade(a.hood, 50, 50, 46, { hi: 0.25 });
      k.blob([[50, 30], [68, 40], [70, 62], [60, 82], [50, 86], [40, 82], [30, 62], [32, 40]]); g.fillStyle = '#05040a'; g.fill();
      k.blob([[50, 36], [64, 44], [64, 62], [58, 74], [50, 78], [42, 74], [36, 62], [36, 44]]); k.shade(a.skin, 50, 52, 22, { hi: 0.2 });
      k.eye(43, 55, 5, a.eye, 'socket'); k.eye(57, 55, 5, a.eye, 'socket');
      k.poly([[50, 61], [47, 67], [53, 67]]); k.flat('#141018');
      for (let i = 0; i < 5; i++) k.line([[43 + i * 3.5, 71], [43 + i * 3.5, 76]], drk(a.skin, 0.55), 1);
      if (a.crown) { k.poly([[32, 30], [34, 12], [41, 24], [50, 4], [59, 24], [66, 12], [68, 30], [50, 24]]); k.shade('#8a6a2a', 50, 20, 18, { lw: 1.4 }); k.glow(50, 14, 5, a.eye, 0.9); }
    },
    crab(g, k, a) {
      for (const s of [-1, 1]) {
        k.line([[50 + s * 22, 60], [50 + s * 34, 50], [50 + s * 36, 34]], drk(a.skin, 0.2), 5);
        k.blob([[50 + s * 30, 34], [50 + s * 46, 20], [50 + s * 44, 6], [50 + s * 36, 14], [50 + s * 32, 4], [50 + s * 24, 18]]); k.shade(a.skin, 50 + s * 36, 18, 14);
        for (let i = 0; i < 3; i++) k.line([[50 + s * 20, 70 + i * 6], [50 + s * 40, 78 + i * 7], [50 + s * 46, 92 + i * 3]], drk(a.skin, 0.25), 3);
      }
      k.ell(50, 66, 30, 20); k.shade(a.skin, 50, 62, 30);
      for (const s of [-1, 1]) { k.line([[50 + s * 8, 52], [50 + s * 10, 38]], drk(a.skin, 0.2), 2.6); k.ell(50 + s * 10, 36, 5, 5); g.fillStyle = '#f6f2e8'; g.fill(); k.ell(50 + s * 10, 36, 2.6, 2.6); g.fillStyle = a.eye; g.fill(); }
      k.curve([42, 74], [50, 78], [58, 74], drk(a.skin, 0.7), 1.8);
      for (let i = 0; i < 5; i++) { k.ell(34 + i * 8, 58, 2, 1.4); g.fillStyle = rgba(lit(a.skin, 0.5), 0.6); g.fill(); }
    },
    jelly(g, k, a) {
      for (let i = 0; i < 6; i++) { const x = 28 + i * 9; g.beginPath(); g.moveTo(x, 58); g.bezierCurveTo(x - 8, 72, x + 8, 82, x - 2, 98); g.strokeStyle = rgba(lit(a.skin, 0.3), 0.75); g.lineWidth = 3 - (i % 2); g.lineCap = 'round'; g.stroke(); }
      k.glow(50, 44, 40, a.skin, 0.4);
      g.beginPath(); g.moveTo(16, 60); g.bezierCurveTo(14, 18, 86, 18, 84, 60); g.quadraticCurveTo(76, 66, 67, 60); g.quadraticCurveTo(58, 66, 50, 60); g.quadraticCurveTo(42, 66, 33, 60); g.quadraticCurveTo(24, 66, 16, 60); g.closePath();
      const gr = g.createRadialGradient(42, 30, 2, 50, 44, 40); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.4, rgba(a.skin, 0.8)); gr.addColorStop(1, rgba(drk(a.skin, 0.3), 0.85));
      g.fillStyle = gr; g.fill(); g.strokeStyle = rgba(lit(a.skin, 0.6), 0.8); g.lineWidth = 1.6; g.stroke();
      k.eyes([40, 60], 44, 5, '#20103a', 'dot');
      k.curve([45, 52], [50, 56], [55, 52], '#3a1a5a', 1.6);
    },
    mage(g, k, a) {
      k.poly([[10, 100], [22, 48], [50, 12], [78, 48], [90, 100]]); k.shade(a.hood, 50, 52, 46);
      if (a.shell) { g.beginPath(); g.moveTo(38, 26); g.quadraticCurveTo(50, 4, 62, 26); g.closePath(); k.shade('#f4d6c0', 50, 18, 12, { lw: 1.4 }); for (let i = 0; i < 5; i++) k.line([[50, 25], [40 + i * 5, 14 + Math.abs(i - 2) * 2]], '#b88a70', 0.9); }
      k.blob([[50, 34], [66, 44], [66, 64], [58, 80], [50, 84], [42, 80], [34, 64], [34, 44]]); k.shade(a.skin, 50, 58, 22);
      k.eyes([43, 57], 56, 4, a.eye, 'glow');
      k.curve([44, 70], [50, 73], [56, 68], '#1a3a4a', 1.6);
      k.glow(50, 96, 12, '#6fe6ff', 0.8);
      k.line([[30, 40], [36, 62], [32, 84]], rgba(lit(a.hood, 0.3), 0.7), 1.4); k.line([[70, 40], [64, 62], [68, 84]], rgba(lit(a.hood, 0.3), 0.7), 1.4);
    },
    shark(g, k, a) {
      if (a.fin) { k.poly([[44, 26], [58, 0], [62, 28]]); k.shade(a.skin, 55, 16, 14); }
      g.beginPath(); g.moveTo(50, 16); g.bezierCurveTo(80, 18, 90, 50, 84, 70); g.quadraticCurveTo(50, 98, 16, 70); g.bezierCurveTo(10, 50, 20, 18, 50, 16); g.closePath(); k.shade(a.skin, 50, 48, 38);
      g.beginPath(); g.moveTo(22, 66); g.quadraticCurveTo(50, 96, 78, 66); g.quadraticCurveTo(50, 80, 22, 66); g.closePath(); g.fillStyle = '#f2ece2'; g.fill();
      g.beginPath(); g.moveTo(26, 62); g.quadraticCurveTo(50, 86, 74, 62); g.quadraticCurveTo(50, 72, 26, 62); g.closePath(); g.fillStyle = '#3a0c12'; g.fill();
      for (let i = 0; i < 9; i++) { const t = i / 8, x = 28 + t * 44, y = 63 + Math.sin(t * Math.PI) * 8; k.fang(x, y - 1, 4.2, 5); }
      k.eye(28, 46, 3.6, a.eye, 'glow'); k.eye(72, 46, 3.6, a.eye, 'glow');
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.line([[50 + s * (22 + i * 4), 54], [50 + s * (24 + i * 4), 62]], drk(a.skin, 0.5), 1.4);
    },
    octo(g, k, a) {
      for (let i = 0; i < 6; i++) {
        const x = 22 + i * 11.2, s = i < 3 ? -1 : 1;
        g.beginPath(); g.moveTo(x, 66); g.bezierCurveTo(x + s * 4, 82, x - s * 12, 88, x - s * 4 + s * 10, 98);
        g.strokeStyle = drk(a.skin, 0.25); g.lineWidth = 8; g.lineCap = 'round'; g.stroke(); g.strokeStyle = a.skin; g.lineWidth = 5; g.stroke();
        for (let j = 0; j < 3; j++) { k.ell(x - s * j * 2, 76 + j * 7, 1.3, 1.3); g.fillStyle = lit(a.skin, 0.55); g.fill(); }
      }
      k.blob([[50, 8], [72, 16], [80, 40], [74, 64], [50, 74], [26, 64], [20, 40], [28, 16]]); k.shade(a.skin, 50, 40, 36);
      const r = seeded(9);
      for (let i = 0; i < 10; i++) { k.ell(28 + r() * 44, 16 + r() * 36, 1.5 + r() * 2.4, 1.5 + r() * 2); g.fillStyle = rgba(lit(a.skin, 0.4), 0.5); g.fill(); }
      k.eye(38, 52, 6.5, a.eye, 'slit'); k.eye(62, 52, 6.5, a.eye, 'slit');
      k.curve([30, 42], [38, 40], [46, 46], drk(a.skin, 0.6), 2.4); k.curve([54, 46], [62, 40], [70, 42], drk(a.skin, 0.6), 2.4);
    },
    siren(g, k, a) {
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(50, 20); g.bezierCurveTo(50 + s * 44, 20, 50 + s * 30, 70, 50 + s * 44, 100); g.lineTo(50 + s * 18, 100); g.bezierCurveTo(50 + s * 22, 70, 50 + s * 18, 50, 50, 40); g.closePath(); k.shade(a.hair, 50 + s * 26, 60, 34); }
      if (a.fins) for (const s of [-1, 1]) { k.poly([[50 + s * 16, 52], [50 + s * 32, 40], [50 + s * 30, 60]]); k.shade(lit(a.hair, 0.3), 50 + s * 26, 50, 10, { lw: 1.4 }); }
      k.blob([[50, 30], [64, 38], [66, 60], [58, 78], [50, 82], [42, 78], [34, 60], [36, 38]]); k.shade(a.skin, 50, 56, 22);
      k.blob([[34, 34], [50, 22], [66, 34], [60, 40], [50, 34], [40, 40]]); k.shade(a.hair, 50, 32, 16);
      k.eyes([43, 57], 54, 4.4, a.eye, 'glow');
      k.curve([45, 68], [50, 71], [55, 68], '#2a5a6a', 1.6);
      for (let i = 0; i < 5; i++) { k.ell(38 + i * 6, 26 - Math.abs(i - 2) * 2, 2.6, 3.4); k.shade('#f6e6ff', 38 + i * 6, 26, 3, { lw: 0.8 }); }
    },
    serpent(g, k, a) {
      for (let i = 0; i < 5; i++) { const s = i % 2 ? 1 : -1; k.horn(50 + s * (10 + i * 3), 30 + i * 5, 26 - i * 2, 5, (s < 0 ? Math.PI : 0) + s * -0.5, s * 6, a.crest); }
      g.beginPath(); g.moveTo(50, 14); g.bezierCurveTo(78, 16, 84, 44, 74, 62); g.quadraticCurveTo(64, 90, 50, 96); g.quadraticCurveTo(36, 90, 26, 62); g.bezierCurveTo(16, 44, 22, 16, 50, 14); g.closePath(); k.shade(a.skin, 50, 50, 38);
      g.save(); g.clip();
      for (let y = 22; y < 96; y += 8) for (let x = 22 + (y % 16 ? 4 : 0); x < 80; x += 8) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI); g.strokeStyle = rgba(lit(a.skin, 0.4), 0.35); g.lineWidth = 0.9; g.stroke(); }
      g.restore();
      k.eye(36, 46, 5.5, a.eye, 'slit', 0.3); k.eye(64, 46, 5.5, a.eye, 'slit', -0.3);
      k.curve([28, 36], [36, 34], [44, 40], drk(a.skin, 0.6), 2.6); k.curve([56, 40], [64, 34], [72, 36], drk(a.skin, 0.6), 2.6);
      k.grin(50, 70, 18, 6, 8);
      k.ell(44, 60, 1.8, 1.2); g.fillStyle = '#05181c'; g.fill(); k.ell(56, 60, 1.8, 1.2); g.fill();
    },
    rune(g, k, a) {
      k.ell(50, 54, 38, 38); k.shade('#4a4f5c', 50, 50, 38, { hi: 0.25 });
      k.ell(50, 54, 30, 30); g.strokeStyle = rgba(a.skin, 0.5); g.lineWidth = 1.4; g.stroke();
      for (let i = 0; i < 8; i++) { const ang = i / 8 * Math.PI * 2; k.line([[50 + Math.cos(ang) * 31, 54 + Math.sin(ang) * 31], [50 + Math.cos(ang) * 35, 54 + Math.sin(ang) * 35]], rgba(a.skin, 0.7), 1.6); }
      k.glow(50, 54, 30, a.skin, 0.45);
      g.lineWidth = 3.2; g.strokeStyle = lit(a.skin, 0.4); g.lineCap = 'round'; g.lineJoin = 'round';
      if (a.glyph === 'pit') { g.beginPath(); for (let t = 0; t < 14; t += 0.2) { const r = 2 + t * 1.5, x = 50 + Math.cos(t) * r, y = 54 + Math.sin(t) * r; t ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
      else if (a.glyph === 'spring') { g.beginPath(); g.moveTo(50, 32); g.quadraticCurveTo(66, 54, 62, 64); g.arc(50, 62, 12, 0.2, Math.PI - 0.2); g.quadraticCurveTo(34, 54, 50, 32); g.stroke(); }
      else { k.poly([[50, 30], [64, 46], [58, 76], [42, 76], [36, 46]]); g.stroke(); k.line([[36, 46], [64, 46]], lit(a.skin, 0.4), 2); k.line([[50, 30], [50, 76]], lit(a.skin, 0.4), 1.4); }
    }
  };

  const cache = {};
  function portrait(key, px) {
    px = Math.max(16, Math.round(px || 128));
    const id = key + '@' + px;
    if (cache[id]) return cache[id];
    const m = D.MONSTERS[key], c = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = px; c.height = px;
    const g = c.getContext('2d');
    if (!g || !m) return (cache[id] = c);
    g.save(); g.scale(px / 100, px / 100);
    const k = kit(g), a = m.art || {}, theme = m.kind === 'item' ? 'item' : m.bag, seed = key.split('').reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7) & 0xffff;
    try {
      background(g, k, theme, seed);
      effects(g, k, a.fx, theme, seed, false);
      (HEAD[a.head] || HEAD.blob)(g, k, a);
      effects(g, k, a.fx, theme, seed, true);
      // a soft vignette keeps the edge dark for the round tokens
      const v = g.createRadialGradient(50, 50, 36, 50, 50, 72); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)');
      g.fillStyle = v; g.fillRect(0, 0, 100, 100);
    } catch (e) {}
    g.restore();
    return (cache[id] = c);
  }

  root.VerliesArt = { portrait, crestPath, crestSVG, drawCrest, mix, lit, drk, rgba, THEME, kit };
})(typeof window !== 'undefined' ? window : globalThis);
