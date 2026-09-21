// airconsole-local.js
// Ein "Shim": stellt dieselbe Oberflaeche wie das echte airconsole-x.x.js bereit,
// spricht aber statt der AirConsole-Server den lokalen WebSocket-Server an.
// Dein Spielcode merkt den Unterschied nicht.
(function (window) {
  function AirConsole(opts) {
    opts = opts || {};
    this.device_id = undefined;
    this._role = opts.role || window.__AC_ROLE__ || 'controller';
    this._devices = [];
    // Standard-Callbacks (werden vom Spiel ueberschrieben):
    this.onReady = function () {};
    this.onConnect = function () {};
    this.onDisconnect = function () {};
    this.onMessage = function () {};
    this.onKicked = function () {};
    if (!opts.deferConnect) this._connect();
  }

  AirConsole.SCREEN = 0; // der Screen hat immer Geraete-ID 0

  AirConsole.prototype._connect = function () {
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    var self = this;
    var ws = new WebSocket(proto + '://' + location.host);
    this._ws = ws;
    ws.onopen = function () {
      var resume = null, secret = null;
      if (self._role !== 'screen') {
        try {
          var saved = JSON.parse(sessionStorage.getItem('ac_resume') || 'null');
          if (saved && saved.id && saved.secret) { resume = saved.id; secret = saved.secret; }
        } catch (e) {}
      }
      ws.send(JSON.stringify({ type: 'register', role: self._role, resume: resume, secret: secret }));
    };
    ws.onmessage = function (evt) { self._handle(JSON.parse(evt.data)); };
    ws.onerror = function () { ws.close(); };
    // Reconnect mit Backoff: Handy-Sperre/WLAN-Aussetzer killt den Socket,
    // die alte device_id wird beim Neu-Registrieren wiederverwendet.
    ws.onclose = function () {
      if (self._stopped || self._ws !== ws) return;
      self._retry = Math.min((self._retry || 400) * 2, 5000);
      setTimeout(function () { if (!self._stopped) self._connect(); }, self._retry);
    };
  };

  AirConsole.prototype._handle = function (msg) {
    switch (msg.type) {
      case 'welcome': {
        var known = this._devices;
        this.device_id = msg.device_id;
        this._devices = msg.devices || [];
        this._retry = 0;
        if (this._role !== 'screen' && msg.secret) {
          try { sessionStorage.setItem('ac_resume', JSON.stringify({ id: msg.device_id, secret: msg.secret })); } catch (e) {}
        }
        this.onReady(msg.code);
        // Bereits verbundene Geraete nachmelden (z.B. Controller, die vor
        // einem uebernehmenden Screen da waren) — nur die vorher unbekannten.
        for (var i = 0; i < this._devices.length; i++) {
          var d = this._devices[i];
          if (d !== this.device_id && known.indexOf(d) === -1) this.onConnect(d);
        }
        break;
      }
      case 'connect':
        if (this._devices.indexOf(msg.device_id) === -1) this._devices.push(msg.device_id);
        this.onConnect(msg.device_id);
        break;
      case 'disconnect':
        this._devices = this._devices.filter(function (d) { return d !== msg.device_id; });
        this.onDisconnect(msg.device_id);
        break;
      case 'message':
        this.onMessage(msg.from, msg.data);
        break;
      case 'kicked':
        this._stopped = true; // kein Reconnect — uebernommen oder vom Host entfernt
        if (this._role !== 'screen') {
          // Resume-Daten weg: ein Reload tritt frisch bei statt still zurueckzukommen
          try { sessionStorage.removeItem('ac_resume'); } catch (e) {}
        }
        this.onKicked();
        break;
    }
  };

  // --- Oeffentliche API (wie beim echten AirConsole) ---
  AirConsole.prototype._send = function (obj) {
    // Waehrend eines Reconnects gehen Nachrichten verloren statt zu werfen —
    // fuer Partyspiele ok, der naechste Broadcast bringt den Zustand zurueck.
    if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify(obj));
  };
  AirConsole.prototype.message = function (to, data) {
    this._send({ type: 'message', to: to, data: data });
  };
  AirConsole.prototype.broadcast = function (data) {
    this._send({ type: 'message', to: null, data: data });
  };
  AirConsole.prototype.getDeviceId = function () { return this.device_id; };
  // Nur der Screen darf kicken (der Server prueft den Absender ebenfalls)
  AirConsole.prototype.kick = function (id) { this._send({ type: 'kick', id: id }); };
  AirConsole.prototype.getControllerDeviceIds = function () {
    return this._devices.filter(function (d) { return d > 0; });
  };

  window.AirConsole = AirConsole;
})(window);
