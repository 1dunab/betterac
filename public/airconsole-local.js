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
    this._connect();
  }

  AirConsole.SCREEN = 0; // der Screen hat immer Geraete-ID 0

  AirConsole.prototype._connect = function () {
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    var self = this;
    var ws = new WebSocket(proto + '://' + location.host);
    this._ws = ws;
    ws.onopen = function () { ws.send(JSON.stringify({ type: 'register', role: self._role })); };
    ws.onmessage = function (evt) { self._handle(JSON.parse(evt.data)); };
  };

  AirConsole.prototype._handle = function (msg) {
    switch (msg.type) {
      case 'welcome':
        this.device_id = msg.device_id;
        this._devices = msg.devices || [];
        this.onReady(msg.code);
        break;
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
    }
  };

  // --- Oeffentliche API (wie beim echten AirConsole) ---
  AirConsole.prototype.message = function (to, data) {
    this._ws.send(JSON.stringify({ type: 'message', to: to, data: data }));
  };
  AirConsole.prototype.broadcast = function (data) {
    this._ws.send(JSON.stringify({ type: 'message', to: null, data: data }));
  };
  AirConsole.prototype.getDeviceId = function () { return this.device_id; };
  AirConsole.prototype.getControllerDeviceIds = function () {
    return this._devices.filter(function (d) { return d > 0; });
  };

  window.AirConsole = AirConsole;
})(window);
