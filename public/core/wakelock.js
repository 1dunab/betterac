// Hält das Display wach — auf beiden Seiten wichtig: Handys dimmen mitten in
// Zuschau-Phasen (Spion!), TVs starten Bildschirmschoner.
// Zwei Wege, weil die Wake-Lock-API einen Secure Context verlangt (https oder
// localhost) — über plain-http im LAN gibt es sie auf den Handys NICHT:
//   1. navigator.wakeLock, wo verfügbar (Screen auf localhost, https-Setups)
//   2. sonst ein unsichtbares 2x2-Loop-Video (NoSleep-Trick), gestartet bei
//      der ersten Berührung (Autoplay-Policy braucht eine User-Geste)
(function () {
  var lock = null, video = null;

  function requestLock() {
    navigator.wakeLock.request('screen')
      .then(function (l) { lock = l; })
      .catch(function () {});
  }

  function playVideo() {
    if (!video) {
      video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.muted = true;
      video.loop = true;
      video.style.cssText = 'position:fixed; width:2px; height:2px; opacity:0.01; pointer-events:none;';
      video.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM5bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmN0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAIAAAACAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHbbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABhm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUZzdGJsAAAAunN0c2QAAAAAAAAAAQAAAKphdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAIAAgBIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAMGF2Y0MBQsAe/+EAGGdCwB7ZH4iIwEQAAAMABAAAAwAoPFi5IAEABWjLg8sgAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAFUgAABVIAAAAGHN0dHMAAAAAAAAAAQAAAAUAAAgAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAUAAAABAAAAKHN0c3oAAAAAAAAAAAAAAAUAAAKDAAAACgAAAAoAAAAJAAAACQAAABRzdGNvAAAAAAAAAAEAAANpAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2MC4xNi4xMDAAAAAIZnJlZQAAArFtZGF0AAACcAYF//9s3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzEwOCAzMWUxOWY5IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MToweDExMSBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49NSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAAtliIQEfJigADYjgAAAAAZBmjgI+oAAAAAGQZpUAj6gAAAABUGaYBD1AAAABUGagD/U';
      document.body.appendChild(video);
    }
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }

  if ('wakeLock' in navigator) {
    requestLock();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') requestLock();
    });
  } else {
    var armed = false;
    function arm() {
      if (!armed) { armed = true; playVideo(); }
      else playVideo();
    }
    ['touchend', 'mousedown', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, arm, true);
    });
    document.addEventListener('visibilitychange', function () {
      if (armed && document.visibilityState === 'visible') playVideo();
    });
  }
})();
