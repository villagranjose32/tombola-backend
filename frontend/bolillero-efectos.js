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
    choques(duracion = 650) {
      const ctx = this.audio;
      if (!this.sonido || ctx?.state !== 'running') return;
      // Secuencia electrónica ascendente, similar al giro de una tragamonedas.
      const notas = [523.25, 659.25, 783.99, 1046.5];
      const intervalo = .075;
      const cantidad = Math.max(8, Math.floor((duracion - 80) / (intervalo * 1000)));
      for (let i = 0; i < cantidad; i++) {
        const cuando = ctx.currentTime + i * intervalo;
        const tono = ctx.createOscillator();
        const volumen = ctx.createGain();
        tono.type = i % 4 === 3 ? 'triangle' : 'square';
        tono.frequency.setValueAtTime(notas[i % notas.length], cuando);
        tono.frequency.exponentialRampToValueAtTime(notas[i % notas.length] * 1.08, cuando + .055);
        volumen.gain.setValueAtTime(.0001, cuando);
        volumen.gain.exponentialRampToValueAtTime(i % 4 === 3 ? .055 : .035, cuando + .006);
        volumen.gain.exponentialRampToValueAtTime(.0001, cuando + .065);
        tono.connect(volumen); volumen.connect(ctx.destination);
        this.nodos.add(tono);
        tono.onended = () => {
          tono.disconnect(); volumen.disconnect(); this.nodos.delete(tono);
        };
        tono.start(cuando); tono.stop(cuando + .07);
      }
    }
    cancelar() {
      this.env.clearTimeout(this.timer); this.timer = null;
      this.cage.classList.remove('spinning');
      this.cage.removeAttribute('aria-busy');
      this.detenerSonido();
      this.alParar?.();
    }
    girar(revelar, animar, duracion = 650) {
      duracion = Math.max(650, Math.min(8000, Number(duracion) || 650));
      this.cancelar();
      if (!animar || this.env.document.hidden || this.env.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        revelar(); return;
      }
      this.cage.classList.add('spinning');
      this.cage.setAttribute('aria-busy', 'true');
      this.alGirar?.(duracion);
      try { this.choques(duracion); } catch { this.silenciar(); }
      this.timer = this.env.setTimeout(() => {
        this.cancelar();
        revelar();
      }, duracion);
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = BolilleroEfectos;
  else root.BolilleroEfectos = BolilleroEfectos;
})(typeof window !== 'undefined' ? window : globalThis);
