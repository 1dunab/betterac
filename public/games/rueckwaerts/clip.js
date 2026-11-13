// ===== Rückwärtsgang: the sums on a voice recording =====
// No DOM and no WebAudio, so it runs in Node (test-rueckwaerts.js). A recording is a Float32Array of samples.
// The phone cuts and shrinks it (prepare) and sends 16 kHz / 16 bit / mono as base64; the TV unpacks and reverses.
(function (root) {
  const RATE = 16000;        // enough for a voice, and 4 seconds stay below 180 KB as text
  const MAX_SEC = 5;         // a longer recording is cut off
  const SILENT = 0.008;      // a peak below this is "nothing recorded"
  const PAD = 0.05;          // seconds of air left before and after the word
  const FADE = 0.006;        // seconds of fade at both ends, against clicks

  function peakOf(x) { let p = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > p) p = v; } return p; }
  // Cut the silence before and after the word. It matters here: played backwards, silence at the end becomes
  // a pause at the start, and the player would wait for a sound that is not coming.
  function trim(x, rate) {
    const th = Math.max(SILENT, peakOf(x) * 0.06), pad = Math.round(rate * PAD);
    let a = 0, b = x.length - 1;
    while (a < x.length && Math.abs(x[a]) < th) a++;
    while (b > a && Math.abs(x[b]) < th) b--;
    return x.slice(Math.max(0, a - pad), Math.min(x.length, b + 1 + pad));
  }
  function normalize(x) {
    const p = peakOf(x), g = p > 0 ? Math.min(12, 0.9 / p) : 1, out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
    return out;
  }
  // down: average over the samples each new one stands for (a cheap low-pass); up: straight lines in between
  function resample(x, from, to) {
    if (from === to || !x.length) return x;
    const n = Math.max(1, Math.floor(x.length * to / from)), out = new Float32Array(n), step = from / to;
    if (step > 1) {
      for (let i = 0; i < n; i++) { const a = Math.floor(i * step), b = Math.min(x.length, Math.max(a + 1, Math.floor((i + 1) * step))); let s = 0; for (let k = a; k < b; k++) s += x[k]; out[i] = s / (b - a); }
    } else {
      for (let i = 0; i < n; i++) { const p = i * step, a = Math.floor(p), b = Math.min(x.length - 1, a + 1); out[i] = x[a] + (x[b] - x[a]) * (p - a); }
    }
    return out;
  }
  function reverse(x) { const out = new Float32Array(x.length); for (let i = 0; i < x.length; i++) out[i] = x[x.length - 1 - i]; return out; }
  function fade(x, rate) {
    const n = Math.min(Math.round(rate * FADE), x.length >> 1);
    for (let i = 0; i < n; i++) { x[i] *= i / n; x[x.length - 1 - i] *= i / n; }
    return x;
  }
  function pack(x) {
    const b = new Uint8Array(x.length * 2);
    for (let i = 0; i < x.length; i++) { const v = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))); b[2 * i] = v & 255; b[2 * i + 1] = (v >> 8) & 255; }
    let s = '';
    for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
    return btoa(s);
  }
  // returns null for anything that is not base64 of whole 16-bit samples
  function unpack(b64) {
    if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
    let s;
    try { s = atob(b64); } catch (e) { return null; }
    if (s.length % 2) return null;
    const out = new Float32Array(s.length / 2);
    for (let i = 0; i < out.length; i++) { let v = s.charCodeAt(2 * i) | (s.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; out[i] = v / 32767; }
    return out;
  }
  // n peaks from left to right, for drawing the wave
  function envelope(x, n) {
    const out = new Array(n).fill(0), per = x.length / n;
    for (let i = 0; i < n; i++) { let p = 0; for (let k = Math.floor(i * per); k < Math.floor((i + 1) * per) && k < x.length; k++) p = Math.max(p, Math.abs(x[k])); out[i] = p; }
    return out;
  }
  // What the phone does with a fresh recording. null: it was silent.
  function prepare(x, rate) {
    if (!x || !x.length || peakOf(x) < SILENT) return null;
    let y = trim(resample(x, rate, RATE), RATE);
    if (y.length > MAX_SEC * RATE) y = y.slice(0, MAX_SEC * RATE);
    if (y.length < RATE * 0.08) return null;
    y = fade(normalize(y), RATE);
    return { pcm: pack(y), rate: RATE, n: y.length, dur: y.length / RATE };
  }

  const api = { RATE, MAX_SEC, SILENT, peakOf, trim, normalize, resample, reverse, pack, unpack, envelope, prepare };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RwClip = api;
})(typeof window !== 'undefined' ? window : globalThis);
