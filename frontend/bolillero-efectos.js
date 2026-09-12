(function(root) {
  'use strict';
  class BolilleroEfectos {
    constructor(cage, env = root) {
      this.cage = cage;
      this.env = env;
      this.timer = null;
    }
    cancelar() {
      this.env.clearTimeout(this.timer); this.timer = null;
      this.cage.classList.remove('spinning');
      this.cage.removeAttribute('aria-busy');
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
      this.timer = this.env.setTimeout(() => {
        this.cancelar();
        revelar();
      }, duracion);
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = BolilleroEfectos;
  else root.BolilleroEfectos = BolilleroEfectos;
})(typeof window !== 'undefined' ? window : globalThis);
