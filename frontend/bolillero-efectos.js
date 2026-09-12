(function(root) {
  'use strict';
  class BolilleroEfectos {
    constructor(cage, env = root) {
      this.cage = cage;
      this.env = env;
      this.nodos = new Set();
      this.sonido = false;
      this.timer = null;
    }
    async activarSonido() {
      const Audio = this.env.AudioContext || this.env.webkitAudioContext;
      if (!Audio) return false;
      try {
        this.audio ||= new Audio();
        if (this.audio.state !== 'running') await this.audio.resume();
        this.sonido = this.audio.state === 'running';
      } catch { this.sonido = false; }
      return this.sonido;
    }
    silenciar() {
      this.sonido = false;
      this.detenerSonido();
    }
    detenerSonido() {
      for (const fuente of this.nodos) {
        try { fuente.stop(); } catch { /* Una fuente puede haber terminado. */ }
      }
      this.nodos.clear();
    }
    choques() {
      const ctx = this.audio;
      if (!this.sonido || ctx?.state !== 'running') return;
      // Golpes cortos: resonancia de la bola y un pequeño impacto de ruido.
      this.ruido ||= ctx.createBuffer(1, Math.ceil(ctx.sampleRate * .035), ctx.sampleRate);
      const muestras = this.ruido.getChannelData(0);
      for (let i = 0; i < muestras.length; i++) muestras[i] = (Math.random() * 2 - 1) * (1 - i / muestras.length);
      for (let i = 0; i < 10; i++) {
        const cuando = ctx.currentTime + i * .055 + Math.random() * .012;
        const tono = ctx.createOscillator();
        const ruido = ctx.createBufferSource(); ruido.buffer = this.ruido;
        const filtro = ctx.createBiquadFilter(); filtro.type = 'highpass'; filtro.frequency.value = 1400;
        const volumen = ctx.createGain();
        volumen.gain.setValueAtTime(.0001, cuando);
        volumen.gain.exponentialRampToValueAtTime(.06 + Math.random() * .025, cuando + .002);
        volumen.gain.exponentialRampToValueAtTime(.0001, cuando + .055);
        tono.frequency.setValueAtTime(380 + Math.random() * 400, cuando);
        tono.frequency.exponentialRampToValueAtTime(140, cuando + .045);
        tono.connect(volumen); ruido.connect(filtro); filtro.connect(volumen); volumen.connect(ctx.destination);
        let terminadas = 0;
        for (const fuente of [tono, ruido]) {
          this.nodos.add(fuente);
          fuente.onended = () => {
            fuente.disconnect(); this.nodos.delete(fuente);
            if (++terminadas === 2) { filtro.disconnect(); volumen.disconnect(); }
          };
          fuente.start(cuando); fuente.stop(cuando + .06);
        }
      }
    }
    cancelar() {
      this.env.clearTimeout(this.timer); this.timer = null;
      this.cage.classList.remove('spinning');
      this.cage.removeAttribute('aria-busy');
      this.detenerSonido();
      this.alParar?.();
    }
    girar(revelar, animar) {
      this.cancelar();
      if (!animar || this.env.document.hidden || this.env.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        revelar(); return;
      }
      this.cage.classList.add('spinning');
      this.cage.setAttribute('aria-busy', 'true');
      this.alGirar?.();
      try { this.choques(); } catch { this.silenciar(); }
      this.timer = this.env.setTimeout(() => {
        this.cancelar();
        revelar();
      }, 650);
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = BolilleroEfectos;
  else root.BolilleroEfectos = BolilleroEfectos;
})(typeof window !== 'undefined' ? window : globalThis);
