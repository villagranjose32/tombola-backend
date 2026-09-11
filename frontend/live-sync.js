/* Estado autoritativo, recuperación móvil y transporte compartido por la vista en vivo. */
(function (root) {
  'use strict';
  class LiveSync {
    constructor({baseUrl, token, onState, onStatus, onCommunity = () => {}, spectator = true, env = root}) {
      this.env = env;
      this.baseUrl = baseUrl;
      this.token = token;
      this.onState = onState;
      this.onCommunity = onCommunity;
      this.spectator = spectator;
      this.onStatus = onStatus;
      this.running = false;
      this.sequence = -1;
      this.state = null;
      this.socket = null;
      this.attempt = 0;
      this.timers = new Map();
      this.listeners = [];
      this.synced = false;
      this.http = null;
    }
    now() { return this.env.Date.now(); }
    timer(name, fn, ms, repeat = false) {
      this.clear(name);
      const id = (repeat ? this.env.setInterval : this.env.setTimeout)(() => {
        if (!repeat) this.timers.delete(name);
        if (this.running) fn();
      }, ms);
      this.timers.set(name, {id, repeat});
    }
    clear(name) {
      const timer = this.timers.get(name);
      if (timer) (timer.repeat ? this.env.clearInterval : this.env.clearTimeout)(timer.id);
      this.timers.delete(name);
    }
    status() {
      if (!this.running) return;
      const offline = this.env.navigator.onLine === false || (this.failedContact && (!this.lastContact || this.now() - this.lastContact > 10000));
      const live = !offline && this.socket?.readyState === 1 && this.synced;
      this.onStatus({text: offline ? 'Sin conexión' : live ? 'En vivo' : 'Reconectando…', stale: !live});
    }
    listen(target, name, fn) {
      target.addEventListener(name, fn);
      this.listeners.push(() => target.removeEventListener(name, fn));
    }
    start() {
      if (this.running) return;
      this.running = true;
      this.synced = false;
      this.listen(this.env.window, 'online', () => this.recover(true));
      this.listen(this.env.window, 'offline', () => { this.failedContact = true; this.drop(); this.status(); });
      this.listen(this.env.window, 'pageshow', () => this.recover());
      this.listen(this.env.window, 'focus', () => this.recover());
      this.listen(this.env.document, 'visibilitychange', () => { if (!this.env.document.hidden) this.recover(); });
      this.timer('poll', () => this.pull(), 5000, true);
      this.connect();
      this.pull();
      this.status();
    }
    stop() {
      this.running = false;
      this.drop();
      this.listeners.splice(0).forEach(remove => remove());
      [...this.timers.keys()].forEach(name => this.clear(name));
      this.http?.controller.abort();
      this.http = null;
    }
    drop() {
      this.synced = false;
      ['open', 'heartbeat', 'pong', 'resync'].forEach(name => this.clear(name));
      this.awaitingSnapshot = false;
      const socket = this.socket;
      this.socket = null;
      if (socket) {
        socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
        socket.close();
      }
    }
    fail() {
      this.drop();
      this.failedContact = true;
      this.status();
      this.schedule();
    }
    schedule() {
      if (!this.running || this.timers.has('retry') || this.env.navigator.onLine === false) return;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5));
      this.timer('retry', () => this.connect(), delay);
    }
    connect() {
      if (!this.running || this.socket || this.env.navigator.onLine === false) return;
      this.clear('retry');
      let socket;
      try { socket = new this.env.WebSocket(this.baseUrl.replace(/^http/, 'ws') + '/ws?sorteo=' + encodeURIComponent(this.token) + '&espectador=' + (this.spectator ? '1' : '0')); }
      catch { this.failedContact = true; this.status(); this.schedule(); return; }
      this.socket = socket;
      this.timer('open', () => this.fail(), 8000);
      socket.onopen = () => {
        if (socket !== this.socket) return;
        this.clear('open');
        this.lastPong = this.now();
        this.requestSnapshot();
        this.timer('heartbeat', () => {
          if (this.timers.has('pong')) return;
          if (!this.send({type: 'PING'})) return;
          this.timer('pong', () => this.fail(), 8000);
        }, 22000, true);
      };
      socket.onclose = socket.onerror = () => { if (socket === this.socket) this.fail(); };
      socket.onmessage = event => {
        if (socket !== this.socket) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (!message || typeof message !== 'object') return;
        if (message.type === 'COMMUNITY_UPDATE') { this.onCommunity(message.comunidad); return; }
        if (message.type === 'PONG') { this.lastPong = this.now(); this.clear('pong'); return; }
        if (message.type === 'SYNC_ERROR') { this.fail(); this.pull(); return; }
        if (message.type === 'STATE_SNAPSHOT') this.accept(message, true, true);
        else if (message.type === 'STATE_UPDATE') this.accept(message, false, true);
      };
    }
    send(message) {
      if (this.socket?.readyState !== 1) return false;
      try { this.socket.send(JSON.stringify(message)); return true; }
      catch { this.fail(); return false; }
    }
    requestSnapshot() {
      if (!this.running || this.awaitingSnapshot || this.socket?.readyState !== 1) return;
      this.synced = false;
      this.awaitingSnapshot = true;
      if (this.send({type: 'RESYNC', salaId: this.state?.salaId || this.token, secuencia: this.sequence})) {
        this.timer('resync', () => { this.fail(); this.pull(); }, 8000);
      } else this.awaitingSnapshot = false;
      this.status();
    }
    accept(message, snapshot, websocket) {
      if (!this.running || !Number.isSafeInteger(message.secuencia) || message.secuencia < 0 ||
          !message.salaId || !Array.isArray(message.numerosExtraidos) || typeof message.estado !== 'string' ||
          (this.state && message.salaId !== this.state.salaId)) return;
      if (message.secuencia < this.sequence) return;
      if (message.comunidad) this.onCommunity(message.comunidad);
      if (!snapshot && message.secuencia === this.sequence) return;
      if (!snapshot && (this.sequence < 0 || message.secuencia !== this.sequence + 1 || !this.synced)) {
        this.requestSnapshot();
        this.pull();
        return;
      }
      this.lastContact = this.now();
      this.failedContact = false;
      if (websocket && snapshot) {
        this.clear('resync');
        this.awaitingSnapshot = false;
        this.synced = true;
        this.attempt = 0;
      }
      if (message.secuencia > this.sequence) {
        const animate = !snapshot && this.sequence >= 0 && message.accion === 'extraida';
        this.sequence = message.secuencia;
        this.state = message;
        this.onState(message, {animate, snapshot});
      }
      this.status();
    }
    async pull() {
      if (!this.running || this.http || this.env.navigator.onLine === false) { this.status(); return; }
      const request = {controller: new this.env.AbortController()};
      this.http = request;
      this.timer('http', () => request.controller.abort(), 8000);
      try {
        const response = await this.env.fetch(this.baseUrl + '/vivo/' + encodeURIComponent(this.token), {
          cache: 'no-store', signal: request.controller.signal
        });
        if (!response.ok) throw new Error('Estado no disponible');
        const data = await response.json();
        if (this.running && this.http === request) this.accept(data, true, false);
      } catch {
        if (this.running && this.http === request) { this.failedContact = true; this.status(); }
      } finally {
        if (this.http === request) { this.clear('http'); this.http = null; }
      }
    }
    recover(force = false) {
      if (!this.running) return;
      // Una suspensión puede congelar timers y conservar un socket que ya murió.
      if (force || this.socket?.readyState !== 1 || this.now() - (this.lastPong || 0) > 30000) {
        this.drop();
        this.clear('retry');
        this.connect();
      } else this.requestSnapshot();
      // Descartar una petición que quedó congelada durante la suspensión.
      this.http?.controller.abort();
      this.http = null;
      this.clear('http');
      this.pull();
      this.status();
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = LiveSync;
  else root.LiveSync = LiveSync;
})(typeof window !== 'undefined' ? window : globalThis);
